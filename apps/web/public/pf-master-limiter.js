// Master limiter for preview (wave 7, track send; send-decisions C11). A hand-written copy of packages/engine/src/masterLimiter.ts
// and of AnchoredMin/AnchoredSum (packages/engine/src/audiofx/anchored.ts), served as a static file so the page's content security
// policy can forbid blob: and inline scripts. It must give the same bits as the engine kernel: masterLimiter.test.ts runs this file
// in Node against the kernel, and proof:send L6 runs it in Chromium's OfflineAudioContext. Change both or neither.
//
// processorOptions: { ceiling: linear ceiling on the 16-bit grid (engine limiterCeilingLinear, computed by the page),
//                     lookahead: M samples (engine limiterWindow), release: k = 1 / (0.12 · sampleRate) is computed here,
//                     startSample?: timeline index of the first sample (default currentFrame at the first call) }
// Messages to the page: { reductionDb, t } every 50 ms of audio — the largest reduction (dB, ≤ 0) in that window, t its start frame.
class AnchoredMin {
  constructor(L) { this.L = L; this.cur = new Float64Array(L).fill(Infinity); this.suf = new Float64Array(L).fill(Infinity); this.pre = Infinity; this.nextT = NaN; this.nextO = 0; }
  push(t, v) {
    const L = this.L, cur = this.cur;
    let o = this.nextO;
    if (t !== this.nextT) { o = t % L; if (o < 0) o += L; }
    this.nextT = t + 1;
    this.nextO = o + 1 === L ? 0 : o + 1;
    cur[o] = v;
    const pre = o === 0 ? v : v < this.pre ? v : this.pre;
    this.pre = pre;
    if (o === L - 1) {
      const suf = this.suf;
      let m = Infinity;
      for (let i = L - 1; i >= 0; i--) { const c = cur[i]; if (c < m) m = c; suf[i] = m; }
      return m;
    }
    const s = this.suf[o + 1];
    return s < pre ? s : pre;
  }
}
class AnchoredSum {
  constructor(L) { this.L = L; this.cur = new Float64Array(L); this.suf = new Float64Array(L); this.pre = 0; this.nextT = NaN; this.nextO = 0; }
  push(t, v) {
    const L = this.L, cur = this.cur;
    let o = this.nextO;
    if (t !== this.nextT) { o = t % L; if (o < 0) o += L; }
    this.nextT = t + 1;
    this.nextO = o + 1 === L ? 0 : o + 1;
    cur[o] = v;
    const pre = o === 0 ? v : this.pre + v;
    this.pre = pre;
    if (o === L - 1) {
      const suf = this.suf;
      let s = 0;
      for (let i = L - 1; i >= 0; i--) { s += cur[i]; suf[i] = s; }
      return s;
    }
    return this.suf[o + 1] + pre;
  }
}
registerProcessor('pf-master-limiter', class extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const M = o.lookahead;
    this.M = M; this.c = o.ceiling; this.k = 1 / (0.12 * sampleRate);
    this.minW = new AnchoredMin(M); this.sumW = new AnchoredSum(M);
    this.ringL = new Float64Array(M); this.ringR = new Float64Array(M);
    this.pos = 0; this.t = typeof o.startSample === 'number' ? o.startSample : null; this.q = 1; this.pushed = 0;
    this.win = 0; this.winMin = 1; this.winT = 0; this.winLen = Math.round(sampleRate * 0.05);
  }
  process(inputs, outputs) {
    const input = inputs[0] || [], out = outputs[0];
    const outL = out[0], outR = out[1] || out[0], n = outL.length;
    const inL = input[0], inR = input[1] || input[0]; // no input connected: silence; mono: heard in both channels
    const M = this.M, c = this.c, k = this.k, ringL = this.ringL, ringR = this.ringR;
    if (this.t === null) this.t = currentFrame;
    let pos = this.pos, t = this.t, q = this.q;
    for (let i = 0; i < n; i++) {
      const xl = inL ? inL[i] : 0, xr = inR ? inR[i] : 0;
      const al = xl < 0 ? -xl : xl, ar = xr < 0 ? -xr : xr, pk = al > ar ? al : ar;
      const r = pk > c ? c / pk : 1;
      const m = this.minW.push(t, r);
      const rel = q + k;
      q = rel < 1 ? rel : 1;
      if (m < q) q = m;
      const g = this.sumW.push(t, q) / M;
      ringL[pos] = xl;
      ringR[pos] = xr;
      pos = pos + 1 === M ? 0 : pos + 1;
      let yl = ringL[pos] * g, yr = ringR[pos] * g;
      if (yl > c) yl = c; else if (yl < -c) yl = -c;
      if (yr > c) yr = c; else if (yr < -c) yr = -c;
      outL[i] = yl;
      if (outR !== outL) outR[i] = yr;
      // the meter (observation only): the smallest gain of each 50 ms window; the first M − 1 outputs (the delay line's initial
      // silence, averaged over fewer than M values) are no reduction of any sound
      if (this.win === 0) { this.winT = t; this.winMin = 1; }
      if (++this.pushed >= M && g < this.winMin) this.winMin = g;
      if (++this.win >= this.winLen) { this.port.postMessage({ t: this.winT, reductionDb: this.winMin < 1 ? 20 * Math.log10(this.winMin) : 0 }); this.win = 0; }
      t++;
    }
    this.pos = pos; this.t = t; this.q = q;
    return true;
  }
});
