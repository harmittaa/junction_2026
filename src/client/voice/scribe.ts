const failure = "Transcription failed. Please try again or type your question.";

// Direct documented manual-commit transport; no permanent credential enters this module.
export class ScribeSession {
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready: Promise<void>;
  private finalResolve?: (text: string) => void;
  private finalReject?: (error: Error) => void;
  private result?: Promise<string>;
  private closed = false;
  private committed: string[] = [];
  private timer: ReturnType<typeof setTimeout>;

  constructor(private socket: WebSocket, private onError: () => void) {
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.timer = setTimeout(() => this.fail(), 10_000);
    socket.addEventListener("message", this.message);
    socket.addEventListener("error", this.fail);
    socket.addEventListener("close", this.fail);
  }

  private message = (event: MessageEvent) => {
    if (this.closed) return;
    try {
      if (typeof event.data !== "string" || event.data.length > 32_768) return this.fail();
      const data = JSON.parse(event.data);
      if (data.message_type === "session_started") {
        clearTimeout(this.timer);
        this.readyResolve();
      } else if (data.message_type === "committed_transcript" && typeof data.text === "string") {
        this.committed.push(data.text);
        if (this.committed.join(" ").length > 2000) return this.fail();
        if (this.finalResolve) {
          this.finalResolve(this.committed.join(" ").trim());
          this.close();
        }
      } else if (data.error || data.message_type === "invalid_request") this.fail();
    } catch { this.fail(); }
  };

  private fail = () => {
    if (this.closed) return;
    this.readyReject(new Error(failure));
    this.finalReject?.(new Error(failure));
    this.close();
    this.onError();
  };

  send(bytes: Uint8Array) {
    if (this.closed) throw new Error(failure);
    // Room for a full 30-second backlog sent when the session opens after capture started.
    if (this.socket.bufferedAmount > 1_500_000) { this.fail(); throw new Error(failure); }
    this.socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: btoa(String.fromCharCode(...bytes)), sample_rate: 16000, commit: false }));
  }

  commit(): Promise<string> {
    if (this.result) return this.result;
    if (this.closed) return Promise.reject(new Error(failure));
    this.result = new Promise((resolve, reject) => { this.finalResolve = resolve; this.finalReject = reject; });
    clearTimeout(this.timer);
    this.timer = setTimeout(this.fail, 10_000);
    try {
      this.socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: "", sample_rate: 16000, commit: true }));
    } catch { this.fail(); }
    return this.result;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timer);
    this.readyReject(new Error(failure));
    this.finalReject?.(new Error(failure));
    this.socket.removeEventListener("message", this.message);
    this.socket.removeEventListener("error", this.fail);
    this.socket.removeEventListener("close", this.fail);
    this.socket.close();
  }
}
