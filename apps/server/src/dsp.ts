/**
 * Shared signal code of the model-free analyses (moved out of beats.ts for the multicam envelope, ADR-0020): an in-place radix-2
 * FFT and the log-spectral-flux onset strength. The beat tracker's output is byte-identical across the move
 * (beats.golden.test.ts).
 */

/** In-place radix-2 complex FFT of (re, im); the length must be a power of two. After it, |X[k]| = hypot(re[k], im[k]). */
export function fftMag(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]!; re[i] = re[j]!; re[j] = tr; const ti = im[i]!; im[i] = im[j]!; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b]! * cr - im[b]! * ci, xi = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - xr; im[b] = im[a]! - xi; re[a] = re[a]! + xr; im[a] = im[a]! + xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

/**
 * Onset strength per hop: half-wave-rectified log-spectral flux of an n-point Hann frame every `hop` samples, with its slow trend
 * (about half a second at `fps` hops per second) removed, normalised to unit deviation. The beat tracker's onset envelope.
 */
export function onsetStrength(x: Float32Array, N: number, HOP: number, FPS: number): Float64Array {
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const env = new Float64Array(frames);
  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  let prev = new Float64Array(N / 2);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < N; i++) { re[i] = x[t * HOP + i]! * win[i]!; im[i] = 0; }
    fftMag(re, im);
    const cur = new Float64Array(N / 2);
    let flux = 0;
    for (let k = 0; k < N / 2; k++) { cur[k] = Math.log1p(1000 * Math.hypot(re[k]!, im[k]!)); const d = cur[k]! - prev[k]!; if (d > 0) flux += d; }
    env[t] = t === 0 ? 0 : flux;
    prev = cur;
  }
  // remove the local mean (about half a second), keep the positive part
  const half = Math.round(FPS / 4);
  const out = new Float64Array(frames);
  let sum = 0;
  for (let t = 0; t < Math.min(frames, half); t++) sum += env[t]!;
  for (let t = 0; t < frames; t++) {
    const lo = Math.max(0, t - half), hi = Math.min(frames - 1, t + half);
    if (t + half < frames && t > 0) sum += env[t + half]!;
    if (t - half - 1 >= 0) sum -= env[t - half - 1]!;
    out[t] = Math.max(0, env[t]! - sum / (hi - lo + 1));
  }
  let m2 = 0;
  for (let t = 0; t < frames; t++) m2 += out[t]! * out[t]!;
  const sd = Math.sqrt(m2 / Math.max(1, frames)) || 1;
  for (let t = 0; t < frames; t++) out[t] = out[t]! / sd;
  return out;
}
