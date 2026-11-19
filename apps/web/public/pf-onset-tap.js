// Measurement tap for tests (enabled only when window.__pfAudioTap is set): sample-accurate onset times and 50 ms level windows.
// Served as a static file so the page's content security policy can forbid blob: and inline scripts.
registerProcessor('pf-onset-tap', class extends AudioWorkletProcessor {
  constructor() { super(); this.quiet = 0; this.peak = 0; this.n = 0; this.t0 = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const f = currentFrame + i, a = Math.abs(ch[i]);
      if (f >= this.quiet && a > 0.15) { this.port.postMessage(f / sampleRate); this.quiet = f + sampleRate * 0.3; }
      // Level windows of 50 ms: the peak of each window, stamped with the window's start time on the audio clock.
      if (this.n === 0) this.t0 = f;
      if (a > this.peak) this.peak = a;
      if (++this.n >= sampleRate * 0.05) { this.port.postMessage({ t: this.t0 / sampleRate, peak: this.peak }); this.n = 0; this.peak = 0; }
    }
    return true;
  }
});
