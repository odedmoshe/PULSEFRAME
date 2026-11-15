/**
 * Beat tracking by signal analysis (no model). Spectral-flux onset envelope, tempo from its autocorrelation,
 * beats from dynamic programming (after Ellis, "Beat Tracking by Dynamic Programming", 2007), so the grid can follow
 * moderate tempo drift. It assumes music with a steady pulse; speech, ambient sound or rubato give low confidence.
 * Known limits: it locks onto the strongest broadband onsets, so music whose off-beats are louder than its beats can be
 * tracked half a beat off, and tempo can be reported at double or half the musical tempo. Results are editable for that reason.
 */
export interface BeatResult { bpm: number | null; confidence: number; beats: number[] /* seconds */ }

export const BEAT_SR = 22050;
const N = 1024, HOP = 256;
const FPS = BEAT_SR / HOP;

function fftMag(re: Float64Array, im: Float64Array) {
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

/** Onset strength per hop: half-wave-rectified log-spectral flux, with its slow trend removed, normalised to unit deviation. */
export function onsetEnvelope(x: Float32Array): Float64Array {
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

/**
 * An onset is strongest in the envelope at the first frame whose window fully contains it, so its time is the frame's start
 * plus about one window minus one and a half hops (measured on synthetic clicks in beats.test.ts; resolution is one hop, 11.6 ms).
 */
export const ONSET_OFFSET_S = (N - 1.5 * HOP) / BEAT_SR;

export function detectBeats(x: Float32Array): BeatResult {
  const o = onsetEnvelope(x);
  const T_ = o.length;
  if (T_ < FPS * 4) return { bpm: null, confidence: 0, beats: [] };
  // --- tempo: autocorrelation with a broad preference around 120 BPM (resolves the octave ambiguity the usual way)
  const minLag = Math.floor((60 / 200) * FPS), maxLag = Math.ceil((60 / 60) * FPS);
  const ac = new Float64Array(maxLag * 2 + 2);
  for (let lag = 0; lag < ac.length; lag++) { let s = 0; for (let t = lag; t < T_; t++) s += o[t]! * o[t - lag]!; ac[lag] = s / (T_ - lag); }
  let best = -1, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * FPS) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.8) ** 2);
    const score = (ac[lag]! + 0.5 * ac[lag * 2]!) * prior;
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  if (best < 0 || ac[0]! <= 0) return { bpm: null, confidence: 0, beats: [] };
  // parabolic refinement of the autocorrelation peak
  const y0 = ac[best - 1] ?? ac[best]!, y1 = ac[best]!, y2 = ac[best + 1] ?? ac[best]!;
  const denom = y0 - 2 * y1 + y2;
  const period = best + (denom < 0 ? (0.5 * (y0 - y2)) / denom : 0);
  // Confidence: how periodic the onset pattern is at the chosen tempo, with the envelope's mean removed
  // (the envelope is non-negative, so its raw autocorrelation is far above zero even for noise).
  let mean = 0;
  for (let t = 0; t < T_; t++) mean += o[t]!;
  mean /= T_;
  const confidence = Math.max(0, Math.min(1, (y1 - mean * mean) / Math.max(1e-9, ac[0]! - mean * mean)));
  // --- beats: dynamic programming. score[t] = onset[t] + max over previous beats of (score - penalty for deviating from the period)
  const alpha = 100;
  const score = new Float64Array(T_), back = new Int32Array(T_).fill(-1);
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < T_; t++) {
    let bestPrev = -1, bestVal = 0;
    for (let d = lo; d <= hi && t - d >= 0; d++) {
      const v = score[t - d]! - alpha * Math.log(d / period) ** 2;
      if (bestPrev < 0 || v > bestVal) { bestVal = v; bestPrev = t - d; }
    }
    score[t] = o[t]! + (bestPrev >= 0 ? bestVal : 0);
    back[t] = bestPrev;
  }
  let end = T_ - 1;
  for (let t = Math.max(0, T_ - Math.round(period)); t < T_; t++) if (score[t]! > score[end]!) end = t;
  const frames: number[] = [];
  for (let t = end; t >= 0; t = back[t]!) frames.push(t);
  frames.reverse();
  // The tracker extends the grid at the period through silence. Drop leading and trailing beats that have no onset under them,
  // so the grid starts and ends with the music.
  const strength = frames.map((f) => { let m = 0; for (let k = Math.max(0, f - 3); k <= Math.min(T_ - 1, f + 3); k++) m = Math.max(m, o[k]!); return m; });
  const sorted = strength.slice().sort((a, b) => a - b);
  const floor = 0.25 * (sorted[sorted.length >> 1] ?? 0);
  let a = 0, b = frames.length;
  while (a < b && strength[a]! < floor) a++;
  while (b > a && strength[b - 1]! < floor) b--;
  frames.splice(b);
  frames.splice(0, a);
  const beats = frames.map((f) => Number((f / FPS + ONSET_OFFSET_S).toFixed(4)));
  // tempo reported from the tracked beats (median interval), which follows the music better than the single autocorrelation lag
  const iv = beats.slice(1).map((b, i) => b - beats[i]!).sort((a, b) => a - b);
  const med = iv.length ? iv[iv.length >> 1]! : (period / FPS);
  return { bpm: Number((60 / med).toFixed(2)), confidence: Number(confidence.toFixed(3)), beats };
}
