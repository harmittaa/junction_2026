class PcmCapture extends AudioWorkletProcessor {
  samples = [];
  stopped = false;
  constructor() {
    super();
    this.port.onmessage = () => {
      this.stopped = true;
      this.flush();
      this.port.postMessage({ stopped: true });
    };
  }
  flush() {
    if (!this.samples.length) return;
    const bytes = new ArrayBuffer(this.samples.length * 2);
    const view = new DataView(bytes);
    this.samples.forEach((sample, index) => view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true));
    this.samples = [];
    this.port.postMessage(bytes, [bytes]);
  }
  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      this.samples.push(Math.max(-1, Math.min(1, sample)));
      if (this.samples.length >= 2048) this.flush();
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
