import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintTranscriptionToken, synthesizeSpeech } from "../src/server/providers/elevenlabs";
import { VoiceController, type VoiceSnapshot } from "../src/client/voice/controller";
import { ScribeSession } from "../src/client/voice/scribe";
import { toBands } from "../src/client/voice/bands";

const safeError = "Voice service is unavailable. Please try typing instead.";
describe("speech frequency bands", () => {
  it.each([16000, 48000])("maps speech bins and mirrors low-to-high bands at %i Hz", sampleRate => {
    const bytes = new Uint8Array(256);
    expect([...toBands(bytes, sampleRate, 512)]).toEqual(Array(32).fill(0));
    // 100–126 Hz: 125 Hz at 16k; no bin center at 48k, so nearest is 93.75 Hz.
    bytes[sampleRate === 16000 ? 4 : 1] = 255;
    expect(toBands(bytes, sampleRate, 512)[24]).toBe(1);
    bytes.fill(0);
    // Band 9 spans 796.8–1003 Hz. At 16k: bins 26–32; at 48k: bins 9–10.
    const start = sampleRate === 16000 ? 26 : 9;
    const end = sampleRate === 16000 ? 33 : 11;
    bytes.fill(255, start, end);
    bytes[start] = 0;
    bytes[200] = 255; // Outside the speech range, must not affect any bar.
    const bars = toBands(bytes, sampleRate, 512);
    expect(bars).toHaveLength(32);
    expect(bars[1]).toBeCloseTo(sampleRate === 16000 ? 6 / 7 : 1 / 2);
    expect(bars[14]).toBe(bars[1]);
    for (let band = 0; band < 16; band++) {
      expect(bars[(24 + band) % 32]).toBe(bars[23 - band]);
    }
    expect(bars[24]).toBe(0); // Low frequencies at the top.
    expect(bars[7]).toBe(0); // High frequencies at the bottom.
    expect([...bars].every(value => value >= 0 && value <= 1)).toBe(true);
    expect([...toBands(new Uint8Array(256).fill(255), sampleRate, 512)]).toEqual(Array(32).fill(1));
  });
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("GEMINI_API_KEY", "fake-gemini");
  vi.stubEnv("ELEVENLABS_API_KEY", "private-fixture-key");
  vi.stubEnv("SESSION_SECRET", "test-session-secret-with-32-characters");
  vi.stubEnv("ELEVENLABS_STT_MODEL", "scribe_v3_live");
  vi.stubEnv("ELEVENLABS_TTS_MODEL", "fixture-tts-model");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "fixture-voice");
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("server voice adapter", () => {
  it("normalizes token output and uses configured synthesis with bounded text", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ token: "single-use", extra: "not exposed" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([73, 68, 51])));
    vi.stubGlobal("fetch", fetcher);
    await expect(mintTranscriptionToken()).resolves.toEqual({ token: "single-use", modelId: "scribe_v3_live" });
    await expect(synthesizeSpeech("a".repeat(600))).resolves.toEqual(new Uint8Array([73, 68, 51]));
    const [url, options] = fetcher.mock.calls[1];
    expect(url).toContain("text-to-speech/fixture-voice?output_format=mp3_44100_128");
    expect(JSON.parse(options.body)).toEqual({ text: "a".repeat(600), model_id: "fixture-tts-model" });
    await expect(synthesizeSpeech("a".repeat(601))).rejects.toThrow(safeError);
    await expect(synthesizeSpeech("  ")).rejects.toThrow(safeError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    () => new Response("provider-body-with-private-key", { status: 429 }),
    () => Response.json({ token: 12 }),
    () => new Response("not json"),
    () => new Response("x".repeat(8193)),
  ])("redacts HTTP, malformed and oversized token failures", async response => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
    await expect(mintTranscriptionToken()).rejects.toThrow(safeError);
  });

  it("cancels oversized audio streams rather than buffering them indefinitely", async () => {
    const canceled = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1_048_577)); }, cancel: canceled,
    }))));
    await expect(synthesizeSpeech("Hello")).rejects.toThrow(safeError);
    expect(canceled).toHaveBeenCalledOnce();
  });

  it("propagates caller cancellation and the HTTP deadline without exposing causes", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(new Error("private transport data")));
    })));
    const abort = new AbortController();
    const canceled = expect(mintTranscriptionToken(abort.signal)).rejects.toThrow(safeError);
    abort.abort();
    await canceled;
    // AbortSignal.timeout uses native timers; inspect that the composed deadline is present
    // separately from Vitest's fake clock by using a real timer for this one request.
    vi.useRealTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1);
      return controller.signal;
    });
    await expect(synthesizeSpeech("Hi")).rejects.toThrow(safeError);
    expect(timeout).toHaveBeenCalledWith(15_000);
    timeout.mockRestore();
  });
});

class Socket extends EventTarget {
  static instances: Socket[] = [];
  bufferedAmount = 0;
  closed = false;
  sent: { message_type: string; audio_base_64: string; commit: boolean; sample_rate: number }[] = [];
  constructor(readonly url = "") { super(); Socket.instances.push(this); }
  send(message: string) { this.sent.push(JSON.parse(message)); }
  close() { this.closed = true; }
  receive(message: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  asWebSocket() { return this as unknown as WebSocket; }
}

describe("manual Scribe wire transport", () => {
  it("sends PCM then commits, waits for committed text (not partial/final), and closes once", async () => {
    const socket = new Socket();
    const session = new ScribeSession(socket.asWebSocket(), vi.fn());
    socket.receive({ message_type: "session_started" });
    await session.ready;
    session.send(new Uint8Array([0, 128, 255, 127]));
    expect(socket.sent[0]).toEqual({ message_type: "input_audio_chunk", audio_base_64: "AID/fw==", sample_rate: 16000, commit: false });
    const result = session.commit();
    expect(session.commit()).toBe(result);
    expect(socket.sent[1]).toEqual({ message_type: "input_audio_chunk", audio_base_64: "", sample_rate: 16000, commit: true });
    socket.receive({ message_type: "partial_transcript", text: "How much" });
    socket.receive({ message_type: "final_transcript", text: "not committed yet" });
    expect(socket.closed).toBe(false);
    socket.receive({ message_type: "committed_transcript", text: "How much did I spend?" });
    await expect(result).resolves.toBe("How much did I spend?");
    expect(socket.closed).toBe(true);
    socket.receive({ message_type: "partial_transcript", text: "stale" });
    await expect(result).resolves.toBe("How much did I spend?");
  });

  it.each(["cancel", "error", "timeout", "close"])("settles pending commit safely on %s", async mode => {
    const socket = new Socket();
    const error = vi.fn();
    const session = new ScribeSession(socket.asWebSocket(), error);
    socket.receive({ message_type: "session_started" });
    await session.ready;
    const result = expect(session.commit()).rejects.toThrow("Transcription failed.");
    if (mode === "cancel") session.close();
    if (mode === "error") socket.receive({ message_type: "quota_exceeded", error: "secret provider data" });
    if (mode === "close") socket.dispatchEvent(new Event("close"));
    if (mode === "timeout") await vi.advanceTimersByTimeAsync(10_001);
    await result;
    expect(socket.closed).toBe(true);
    expect(error).toHaveBeenCalledTimes(mode === "cancel" ? 0 : 1);
  });
});

class Node {
  connected = false;
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
}
class Source extends Node {
  buffer?: unknown;
  onended: (() => void) | null = null;
  duration = 0;
  stopped = false;
  start(_when: number, _offset: number, duration: number) { this.duration = duration; }
  stop() { this.stopped = true; }
}
class Context {
  static instances: Context[] = [];
  sampleRate: number;
  state = "running";
  destination = new Node();
  source = new Source();
  energy = 64;
  audioWorklet = { addModule: async () => {} };
  constructor(options?: { sampleRate: number }) { this.sampleRate = options?.sampleRate ?? 48000; Context.instances.push(this); }
  async resume() {}
  async close() { this.state = "closed"; }
  createMediaStreamSource() { return new Node(); }
  createAnalyser() { return Object.assign(new Node(), { fftSize: 512, frequencyBinCount: 256, getByteFrequencyData: (samples: Uint8Array) => samples.fill(this.energy) }); }
  createBufferSource() { return this.source; }
  async decodeAudioData() { return { duration: 45 }; }
}
class Worklet extends Node {
  static instances: Worklet[] = [];
  port = {
    onmessage: (event: { data: unknown }) => { void event; },
    close: () => {},
    postMessage: () => {
      this.port.onmessage({ data: new Uint8Array([1, 2]).buffer });
      this.port.onmessage({ data: { stopped: true } });
    },
  };
  constructor() { super(); Worklet.instances.push(this); }
}

async function drain() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

describe("browser voice lifecycle", () => {
  let controller: VoiceController;
  let snapshot: VoiceSnapshot;
  let transcript: ReturnType<typeof vi.fn>;
  let error: ReturnType<typeof vi.fn>;
  let track: { stop: ReturnType<typeof vi.fn> };
  let microphone: ReturnType<typeof vi.fn>;
  let changed: ReturnType<typeof vi.fn>;
  let warning: ReturnType<typeof vi.spyOn>;
  const bands = new Float32Array(32);
  function expectInactiveBands() {
    bands.fill(1);
    expect(controller.readBands(bands)).toBe(false);
    expect([...bands]).toEqual(Array(32).fill(0));
  }
  beforeEach(() => {
    Socket.instances = []; Context.instances = []; Worklet.instances = [];
    warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    transcript = vi.fn(); error = vi.fn(); track = { stop: vi.fn() };
    microphone = vi.fn(async () => ({ getTracks: () => [track] }));
    vi.stubGlobal("AudioContext", Context);
    vi.stubGlobal("AudioWorkletNode", Worklet);
    vi.stubGlobal("WebSocket", Socket);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: microphone } });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("fetch", vi.fn(async (path: string) => path === "/api/voice/token"
      ? Response.json({ token: "single-use-fixture", modelId: "scribe_v3_live" })
      : new Response(new Uint8Array([73, 68, 51]), { headers: { "Content-Type": "audio/mpeg" } })));
    changed = vi.fn(value => { snapshot = value; });
    controller = new VoiceController({ onTranscript: transcript, onError: error }, changed);
  });
  afterEach(() => { controller.cancel(); warning.mockRestore(); });

  async function listen() {
    const starting = controller.start();
    await drain();
    const socket = Socket.instances.at(-1)!;
    expect(new URL(socket.url).searchParams.get("commit_strategy")).toBe("manual");
    socket.receive({ message_type: "session_started" });
    await starting;
    return socket;
  }

  it("flushes microphone before commit and delivers only final text after stop", async () => {
    const socket = await listen();
    expect(snapshot!.state).toBe("listening");
    expect(controller.readBands(bands)).toBe(true);
    expect([...bands]).toEqual(Array(32).fill(Math.fround(64 / 255)));
    const notifications = changed.mock.calls.length;
    socket.receive({ message_type: "partial_transcript", text: "Groceries" });
    socket.receive({ message_type: "final_transcript", text: "not committed" });
    expect(changed).toHaveBeenCalledTimes(notifications);
    expect(snapshot!).toEqual({ state: "listening", muted: false });
    expect(transcript).not.toHaveBeenCalled();
    const stopping = controller.stop();
    await drain();
    expect(socket.sent.map(message => message.commit)).toEqual([false, true]);
    expect(track.stop).toHaveBeenCalled();
    expect(socket.closed).toBe(false);
    expect(snapshot!.state).toBe("transcribing");
    expectInactiveBands();
    socket.receive({ message_type: "committed_transcript", text: "Groceries last October?" });
    await stopping;
    expect(transcript).toHaveBeenCalledExactlyOnceWith("Groceries last October?");
    expect(snapshot!).toEqual({ state: "ready", muted: false });
    expectInactiveBands();
    expect(Context.instances[0].state).toBe("closed");
    expect(error).not.toHaveBeenCalled();
  });

  it("cancels an overlong hold without sending, including after release", async () => {
    const socket = await listen();
    socket.receive({ message_type: "partial_transcript", text: "unfinished" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(snapshot!.state).toBe("listening");
    await vi.advanceTimersByTimeAsync(1);
    expect(snapshot!).toEqual({ state: "ready", muted: false });
    expect(error).toHaveBeenCalledExactlyOnceWith("Recording reached 30 seconds and was canceled. Hold again for a shorter question, then release to send.");
    expect(track.stop).toHaveBeenCalled();
    expect(socket.closed).toBe(true);
    await controller.stop();
    socket.receive({ message_type: "committed_transcript", text: "unfinished" });
    expect(transcript).not.toHaveBeenCalled();
    expect(socket.sent.some(message => message.commit)).toBe(false);
    expectInactiveBands();
    await listen();
    expect(snapshot!.state).toBe("listening");
  });

  it("ignores late transcription after a new turn and releases capture on cancellation", async () => {
    const old = await listen();
    const stopping = controller.stop();
    await drain();
    controller.cancel();
    old.receive({ message_type: "committed_transcript", text: "stale" });
    await stopping;
    expect(old.closed).toBe(true);
    expect(transcript).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(snapshot!.state).toBe("ready");
    await listen();
    controller.cancel();
    expect(Context.instances.every(context => context.state === "closed")).toBe(true);
  });

  it("stops playback before microphone access; mute only cancels output", async () => {
    await controller.speak(7);
    expect(snapshot!.state).toBe("speaking");
    expect(controller.readBands(bands)).toBe(true);
    expect([...bands]).toEqual(Array(32).fill(Math.fround(64 / 255)));
    expect(Context.instances[0].source.duration).toBe(30);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ revision: 7 });
    microphone.mockImplementationOnce(async () => {
      expect(Context.instances[0].source.stopped).toBe(true);
      return { getTracks: () => [track] };
    });
    await listen();
    controller.cancel();
    await controller.speak(8);
    const captures = microphone.mock.calls.length;
    controller.toggleMute();
    expect(snapshot!).toMatchObject({ state: "ready", muted: true });
    expectInactiveBands();
    await controller.speak(9);
    expectInactiveBands();
    controller.toggleMute();
    expect(microphone.mock.calls.length).toBe(captures);
    expect(snapshot!.muted).toBe(false);
  });

  it("caps playback wall time and returns to ready", async () => {
    await controller.speak(10);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(snapshot!.state).toBe("ready");
    expectInactiveBands();
    expect(Context.instances[0].source.stopped).toBe(true);
  });

  it("ignores decoded audio arriving after cancellation", async () => {
    let decoded!: (audio: { duration: number }) => void;
    const decode = vi.spyOn(Context.prototype, "decodeAudioData").mockReturnValueOnce(new Promise(resolve => { decoded = resolve; }));
    const speaking = controller.speak(12);
    await drain();
    controller.cancel();
    decoded({ duration: 5 });
    await speaking;
    expect(snapshot!.state).toBe("ready");
    expectInactiveBands();
    expect(Context.instances[0].source.duration).toBe(0);
    expect(error).not.toHaveBeenCalled();
    decode.mockRestore();
  });

  it("recovers from socket failure during capture without submitting partial text", async () => {
    const socket = await listen();
    socket.receive({ message_type: "partial_transcript", text: "unfinished" });
    socket.dispatchEvent(new Event("error"));
    expect(snapshot!).toEqual({ state: "ready", muted: false });
    expectInactiveBands();
    expect(track.stop).toHaveBeenCalled();
    expect(transcript).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith("Voice transcription was interrupted. Please try again or type your question.");
    expect(warning).toHaveBeenCalledExactlyOnceWith("Voice failed", { phase: "transcription" });
    await listen();
    expect(snapshot!.state).toBe("listening");
  });

  it("releases a microphone granted after cancellation", async () => {
    let grant!: (value: { getTracks: () => typeof track[] }) => void;
    microphone.mockReturnValueOnce(new Promise(resolve => { grant = resolve; }));
    const starting = controller.start();
    await drain();
    controller.cancel();
    await starting; // Cancel settles even while the browser permission dialog is unanswered.
    grant({ getTracks: () => [track] });
    await drain();
    expect(track.stop).toHaveBeenCalled();
    expect(Socket.instances).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it("handles permission denial, autoplay denial and API errors with typing recovery", async () => {
    microphone.mockRejectedValueOnce(new Error("Permission denied"));
    await controller.start();
    expect(snapshot!.state).toBe("ready");
    const resume = vi.spyOn(Context.prototype, "resume").mockRejectedValueOnce(new Error("autoplay"));
    await controller.speak(1);
    resume.mockRestore();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "private", retryable: true }, { status: 503 })));
    await controller.speak(2);
    await controller.start();
    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "Could not start the microphone. Check microphone permission, then hold again or type your question.",
      "Could not play the spoken reply. Try Play reply or continue typing.",
      "Could not load the spoken reply. Read the reply or try Play reply.",
      "Could not connect to voice transcription. Please try again or type your question.",
    ]);
    expect(warning.mock.calls).toEqual(["microphone", "playback", "speech", "token"].map(phase => ["Voice failed", { phase }]));
    expect(snapshot!.state).toBe("ready");
    expectInactiveBands();
    expect(Context.instances.every(context => context.state === "closed")).toBe(true);
  });

  it("bounds suspended reply startup, makes no speech request, and allows a later replay", async () => {
    let resumeLate!: () => void;
    const resume = vi.spyOn(Context.prototype, "resume").mockImplementationOnce(function (this: Context) {
      this.state = "suspended";
      return new Promise<void>(resolve => { resumeLate = resolve; });
    });
    try {
      const speaking = controller.speak(3);
      await drain();
      expect(snapshot!.state).toBe("loading");
      expect(fetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(snapshot!.state).toBe("ready");
      expect(error).toHaveBeenCalledExactlyOnceWith("Could not play the spoken reply. Try Play reply or continue typing.");
      expect(warning).toHaveBeenCalledExactlyOnceWith("Voice failed", { phase: "playback" });
      expect(Context.instances[0].state).toBe("closed");
      resumeLate();
      await speaking;
      expect(fetch).not.toHaveBeenCalled();
      await controller.speak(3);
      expect(snapshot!.state).toBe("speaking");
      expect(fetch).toHaveBeenCalledOnce();
      Context.instances[1].source.onended!();
      expect(Context.instances.every(context => context.state === "closed")).toBe(true);
    } finally { resume.mockRestore(); }
  });

  it.each([
    ["capture", "Could not capture microphone audio"],
    ["flush", "Could not finish recording"],
    ["transcript", "Could not finish transcription"],
    ["playback", "Could not play the spoken reply"],
  ])("identifies %s failure without exposing data and releases resources", async (phase, message) => {
    const source = vi.spyOn(Context.prototype, "createMediaStreamSource");
    const decode = vi.spyOn(Context.prototype, "decodeAudioData");
    try {
      if (phase === "capture") source.mockImplementationOnce(() => { throw new Error("private device data"); });
      if (phase === "playback") {
        decode.mockRejectedValueOnce(new Error("private audio data"));
        await controller.speak(2);
      } else {
        const socket = await listen();
        if (phase !== "capture") {
          if (phase === "flush") Worklet.instances[0].port.postMessage = () => {};
          const stopping = controller.stop();
          await vi.advanceTimersByTimeAsync(phase === "flush" ? 1001 : 10_001);
          await stopping;
        }
        expect(socket.closed).toBe(true);
        expect(track.stop).toHaveBeenCalled();
      }
      expect(error).toHaveBeenCalledOnce();
      expect(error.mock.calls[0][0]).toContain(message);
      expect(warning).toHaveBeenCalledExactlyOnceWith("Voice failed", { phase });
      expect(transcript).not.toHaveBeenCalled();
      expect(snapshot!.state).toBe("ready");
      expectInactiveBands();
      expect(Context.instances.every(context => context.state === "closed")).toBe(true);
    } finally { source.mockRestore(); decode.mockRestore(); }
  });

  it("reads changing audio without publishing per-frame snapshots, then clears on playback end", async () => {
    for (const start of [() => listen(), () => controller.speak(1)]) {
      await start();
      const context = Context.instances.at(-1)!;
      const notifications = changed.mock.calls.length;
      for (let frame = 0; frame < 60; frame++) {
        context.energy = frame * 4;
        expect(controller.readBands(bands)).toBe(true);
        expect(bands[0]).toBeCloseTo(frame * 4 / 255);
      }
      expect(changed).toHaveBeenCalledTimes(notifications);
    }
    Context.instances.at(-1)!.source.onended!();
    expect(snapshot!.state).toBe("ready");
    expectInactiveBands();
  });
});
