import { speechRequestSchema, voiceTokenSchema } from "../../shared/contracts";
import { ScribeSession } from "./scribe";
import { toBands } from "./bands";

type Capture = "ready" | "connecting" | "listening" | "transcribing";
type Playback = "ready" | "loading" | "speaking";
export type VoiceSnapshot = { state: Capture | Playback; partial: string; muted: boolean };
export type VoiceCallbacks = { onTranscript: (text: string) => void; onError: (message: string) => void };
type Turn = {
  abort: AbortController;
  context: AudioContext;
  stream?: MediaStream;
  session?: ScribeSession;
  worklet?: AudioWorkletNode;
  nodes: AudioNode[];
  analyser?: AnalyserNode;
  spectrum?: Uint8Array<ArrayBuffer>;
  timer?: ReturnType<typeof setTimeout>;
  flush?: () => void;
  flushCapture?: () => Promise<void>;
};
const failure = "Voice is unavailable. Please try again or type your question.";

async function post(path: string, body: unknown, limit: number, signal: AbortSignal) {
  const response = await fetch(path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    credentials: "same-origin", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(failure); }
  if (path === "/api/speech" && !response.headers.get("Content-Type")?.startsWith("audio/mpeg")) {
    await response.body.cancel();
    throw new Error(failure);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error(failure);
      chunks.push(value);
    }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

// Owns browser resources separately from React and from the Scribe wire protocol.
export class VoiceController {
  private capture: Capture = "ready";
  private playback: Playback = "ready";
  private current?: Turn;
  private snapshot: VoiceSnapshot = { state: "ready", partial: "", muted: false };

  constructor(private callbacks: VoiceCallbacks, private changed: (snapshot: VoiceSnapshot) => void) {}

  setCallbacks(callbacks: VoiceCallbacks) { this.callbacks = callbacks; }

  private update(patch: Partial<VoiceSnapshot> = {}) {
    this.snapshot = { ...this.snapshot, ...patch, state: this.capture !== "ready" ? this.capture : this.playback };
    this.changed(this.snapshot);
  }

  cancel = () => {
    const turn = this.current;
    this.current = undefined;
    if (turn) {
      turn.abort.abort();
      turn.session?.close();
      turn.flush?.();
      if (turn.worklet) {
        turn.worklet.port.onmessage = null;
        turn.worklet.port.close();
      }
      turn.stream?.getTracks().forEach(track => track.stop());
      turn.nodes.forEach(node => node.disconnect());
      clearTimeout(turn.timer);
      void turn.context.close().catch(() => {});
    }
    this.capture = "ready";
    this.playback = "ready";
    this.update({ partial: "" });
  };

  private failed(turn: Turn) {
    if (this.current !== turn) return;
    this.cancel();
    this.callbacks.onError(failure);
  }

  private meter(turn: Turn, source: AudioNode) {
    const analyser = turn.context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    analyser.minDecibels = -85;
    analyser.maxDecibels = -25;
    source.connect(analyser);
    turn.nodes.push(analyser);
    turn.analyser = analyser;
    turn.spectrum = new Uint8Array(analyser.frequencyBinCount);
  }

  // Pull into the drawing loop's reusable buffer, never publish audio frames to React.
  readBands = (out: Float32Array): boolean => {
    const turn = this.current;
    if (!turn?.analyser || !turn.spectrum || turn.context.state !== "running"
      || (this.capture !== "listening" && this.playback !== "speaking")) {
      out.fill(0);
      return false;
    }
    turn.analyser.getByteFrequencyData(turn.spectrum);
    toBands(turn.spectrum, turn.context.sampleRate, turn.analyser.fftSize, 16, out);
    return true;
  };

  start = async () => {
    this.cancel(); // Explicit interruption: playback is released before microphone access.
    let turn: Turn | undefined;
    try {
      turn = { abort: new AbortController(), context: new AudioContext({ sampleRate: 16000 }), nodes: [] };
      const active = turn;
      this.current = active;
      this.capture = "connecting";
      this.update();
      active.timer = setTimeout(() => this.failed(active), 20_000);
      await active.context.resume();
      if (this.current !== active) return;
      if (active.context.state !== "running" || active.context.sampleRate !== 16000) throw new Error(failure);
      const stream = await new Promise<MediaStream>((resolve, reject) => {
        const aborted = () => reject(new Error(failure));
        active.abort.signal.addEventListener("abort", aborted, { once: true });
        navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false }).then(stream => {
          active.abort.signal.removeEventListener("abort", aborted);
          if (active.abort.signal.aborted) stream.getTracks().forEach(track => track.stop());
          resolve(stream);
        }, error => {
          active.abort.signal.removeEventListener("abort", aborted);
          reject(error);
        });
      });
      if (this.current !== active) { stream.getTracks().forEach(track => track.stop()); return; }
      active.stream = stream;
      const bytes = await post("/api/voice/token", {}, 8192, active.abort.signal);
      if (this.current !== active) return;
      const token = voiceTokenSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
      const query = new URLSearchParams({ token: token.token, model_id: token.modelId, audio_format: "pcm_16000", commit_strategy: "manual" });
      active.session = new ScribeSession(new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`),
        partial => { if (this.current === active) this.update({ partial }); }, () => this.failed(active));
      await active.session.ready;
      if (this.current !== active) return;
      await active.context.audioWorklet.addModule("/pcm-capture.js");
      if (this.current !== active) return;
      const source = active.context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(active.context, "pcm-capture");
      active.worklet = worklet;
      active.nodes.push(source, worklet);
      let flushed: (() => void) | undefined;
      worklet.port.onmessage = event => {
        if (this.current !== active) return;
        if (event.data instanceof ArrayBuffer) {
          try { active.session?.send(new Uint8Array(event.data)); } catch { this.failed(active); }
        } else if (event.data?.stopped) flushed?.();
      };
      active.flush = () => flushed?.();
      // A silent output keeps the worklet processing without feeding the microphone to speakers.
      source.connect(worklet);
      worklet.connect(active.context.destination);
      this.meter(active, source);
      this.capture = "listening";
      this.update();
      clearTimeout(active.timer);
      active.timer = setTimeout(() => {
        if (this.current !== active) return;
        this.cancel();
        this.callbacks.onError("Recording reached 30 seconds and was canceled. Hold again for a shorter question, then release to send.");
      }, 30_000);
      // Save a flushing operation on the turn; it runs before the manual commit.
      active.flushCapture = () => new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(failure)), 1000);
        flushed = () => { clearTimeout(timeout); resolve(); };
        worklet.port.postMessage({ stop: true });
      });
    } catch {
      if (turn) this.failed(turn);
      else this.callbacks.onError(failure);
    }
  };

  stop = async () => {
    const turn = this.current;
    if (!turn || this.capture === "ready" || this.capture === "transcribing") return;
    if (this.capture === "connecting") { this.cancel(); return; }
    this.capture = "transcribing";
    clearTimeout(turn.timer);
    this.update();
    try {
      await turn.flushCapture?.();
      if (this.current !== turn) return;
      turn.stream?.getTracks().forEach(track => track.stop());
      turn.nodes.forEach(node => node.disconnect());
      const text = await turn.session!.commit();
      if (this.current !== turn) return;
      this.cancel();
      if (text) this.callbacks.onTranscript(text);
      else this.callbacks.onError("No speech was detected. Please try again or type your question.");
    } catch { this.failed(turn); }
  };

  speak = async (revision: number) => {
    this.cancel();
    if (this.snapshot.muted) return;
    let turn: Turn | undefined;
    try {
      const request = speechRequestSchema.parse({ revision });
      turn = { abort: new AbortController(), context: new AudioContext(), nodes: [] };
      const active = turn;
      this.current = active;
      this.playback = "loading";
      this.update();
      active.timer = setTimeout(() => this.failed(active), 20_000);
      await active.context.resume();
      if (this.current !== active) return;
      if (active.context.state !== "running") throw new Error(failure);
      const bytes = await post("/api/speech", request, 1_048_576, active.abort.signal);
      if (this.current !== active) return;
      const audio = await active.context.decodeAudioData(bytes.buffer);
      if (this.current !== active) return;
      const source = active.context.createBufferSource();
      source.buffer = audio;
      active.nodes.push(source);
      source.connect(active.context.destination);
      source.onended = () => { if (this.current === active) this.cancel(); };
      this.playback = "speaking";
      source.start(0, 0, Math.min(audio.duration, 30));
      active.abort.signal.addEventListener("abort", () => { source.onended = null; source.stop(); }, { once: true });
      this.meter(active, source);
      clearTimeout(active.timer);
      active.timer = setTimeout(() => { if (this.current === active) this.cancel(); }, 30_000);
      this.update();
    } catch {
      if (turn) this.failed(turn);
      else this.callbacks.onError(failure);
    }
  };

  toggleMute = () => {
    const muted = !this.snapshot.muted;
    if (muted && this.playback !== "ready") this.cancel();
    this.update({ muted });
  };
}
