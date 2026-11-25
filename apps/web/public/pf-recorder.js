// The story recorder's AudioWorklet (W2; contract apps/web/src/editor/story/recorder.contract.ts, engine recorder.ts). Served as a
// static file so the page's content security policy can forbid blob: and inline scripts.
// Mono: the first channel of the first input (the stream is opened with channelCount 1 and the node is explicit mono). Each sample
// is turned into 16-bit PCM (x < 0 ? x·32768 : x·32767, rounded, clamped); a sample at or beyond full scale counts as clipped.
// Posts { samples: Int16Array, peak, clipped } every `blockSamples` samples (at least 2048), the buffer transferred. It holds no
// microphone itself: the engine stops the tracks and closes the context, which ends this processor. Nothing is played back
// (numberOfOutputs 0) and nothing is sent anywhere but to the engine on this page.
registerProcessor('pf-recorder', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const asked = options && options.processorOptions && options.processorOptions.blockSamples;
    this.size = Math.max(2048, Math.floor(Number(asked) || 2048));
    this.buf = new Int16Array(this.size);
    this.n = 0; this.peak = 0; this.clipped = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      let v = x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
      if (x >= 1 || x <= -1) this.clipped++;
      if (v > 32767) v = 32767; else if (v < -32768) v = -32768;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
      this.buf[this.n++] = v;
      if (this.n === this.size) {
        const samples = this.buf;
        this.port.postMessage({ samples, peak: this.peak, clipped: this.clipped }, [samples.buffer]);
        this.buf = new Int16Array(this.size); this.n = 0; this.peak = 0; this.clipped = 0;
      }
    }
    return true;
  }
});
