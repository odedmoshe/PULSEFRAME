/**
 * Master limiter (wave 7, track send; send-decisions C11). A stereo look-ahead brick-wall limiter, the same bits in Node (export,
 * apps/server/src/audiomix.ts — the reference) and in Chromium (preview: the hand-written copy in apps/web/public/pf-master-limiter.js,
 * kept equal to this file by masterLimiter.test.ts and proof:send L6).
 *
 * THE RULE, per stereo sample at timeline index t (x = the input, c = limiterCeilingLinear(ceilingDb)):
 *   r_t   = min(1, c / max(|L_t|, |R_t|))                           the gain that would put this sample exactly at the ceiling
 *   m_t   = min of r over [t − M + 1, t]   (AnchoredMin, M = round(0.005·rate), 5 ms)
 *   q_t   = min(m_t, min(1, q_{t−1} + k))  k = 1 / (0.12·rate)       linear release: from any q > 0 back to exactly 1 within 120 ms
 *   g_t   = AnchoredSum(q over [t − M + 1, t]) / M                    a division, so M ones give exactly 1
 *   out_t = x_{t − M + 1} · g_t, clamped to ±c                        the input delayed by M − 1 samples
 * Why the output never passes c: every q_j in g_t's window [t − M + 1, t] is ≤ m_j, and every m_j's own window contains t − M + 1,
 * so q_j ≤ r_{t−M+1}; the average g_t is then ≤ r_{t−M+1} = c / peak(x_{t−M+1}). The clamp only removes the last rounding ulp.
 * Why untouched sound is bit-identical: where no r < 1 lies within M + release samples, every q in the window is exactly 1, the
 * sum is exactly M, g = M / M = 1 and x · 1 = x.
 * Why a range export equals the full export 125 ms after its start: the state is finite (M values of r and q, the last q and M
 * delayed samples), the windows are anchored to the timeline index (anchored.ts), and q forgets its start within the release.
 *
 * Only +, −, ×, ÷, comparisons and Math.abs-free sign tests run per sample (no transcendental Math): the same bits in every
 * IEEE-754 double engine. Math.log10 appears only in the stats for the meter and the report, never in the signal.
 * No DOM or Node imports.
 */
import { AnchoredMin, AnchoredSum } from './audiofx/anchored.ts';

/** The ceiling as a linear amplitude on the 16-bit grid: ⌊10^(ceiling/20)·32767⌋ / 32768, so the written file never exceeds it. */
export function limiterCeilingLinear(ceilingDb: number): number {
  return Math.floor(10 ** (ceilingDb / 20) * 32767) / 32768;
}
/** Look-ahead window M (samples, 5 ms) and release length (samples, 120 ms) at a rate. */
export const limiterWindow = (sampleRate: number) => ({ lookahead: Math.max(1, Math.round(0.005 * sampleRate)), release: Math.round(0.12 * sampleRate) });
export const MASTER_LIMITER_BUILT = true;
export interface LimiterStats {
  /** the largest gain reduction applied, in dB (≤ 0; 0 when nothing was limited) */
  maxReductionDb: number;
  /** output samples (stereo frames) whose gain was below 1 */
  limitedSamples: number;
  /** timeline index of the last output sample whose gain was below 1, null when none */
  lastLimitedSample: number | null;
}
/** Stereo brick-wall limiter. Latency = lookahead − 1 samples (the caller compensates; sample count unchanged). */
export class MasterLimiter {
  readonly latency: number;
  /** look-ahead M, in samples */
  readonly lookahead: number;
  /** the ceiling as a linear amplitude on the 16-bit grid */
  readonly ceiling: number;
  private readonly k: number;
  private readonly minW: AnchoredMin;
  private readonly sumW: AnchoredSum;
  /** the last M input samples (ring); the slot after the one just written holds the sample pushed M − 1 ago */
  private readonly ringL: Float64Array;
  private readonly ringR: Float64Array;
  private pos = 0;
  /** timeline index of the next input sample */
  private t: number;
  private q = 1;
  /** samples pushed so far: the first M − 1 outputs carry the delay line's initial silence, and their gain (an average over fewer
   *  than M pushed values) is not a reduction of any sound, so they are left out of the stats and the meter */
  private pushed = 0;
  private lastGain = 1;
  private minGain = 1;
  private limited = 0;
  private lastLimited: number | null = null;
  /**
   * `startSample` is the timeline index of the first input sample (the windows are anchored to it, so a range export and the
   * full export share one grid). Output sample i of the stream is input sample i − latency; the first `latency` outputs are the
   * delay line's initial silence.
   */
  constructor(readonly sampleRate: number, readonly ceilingDb: number, startSample = 0) {
    const w = limiterWindow(sampleRate);
    this.lookahead = w.lookahead;
    this.latency = w.lookahead - 1;
    this.ceiling = limiterCeilingLinear(ceilingDb);
    this.k = 1 / (0.12 * sampleRate);
    this.minW = new AnchoredMin(w.lookahead);
    this.sumW = new AnchoredSum(w.lookahead);
    this.ringL = new Float64Array(w.lookahead);
    this.ringR = new Float64Array(w.lookahead);
    this.t = startSample;
  }
  /** Process one block in place order (inputs and outputs may be the same arrays). */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void {
    const M = this.lookahead, c = this.ceiling, k = this.k, ringL = this.ringL, ringR = this.ringR, n = inL.length;
    let pos = this.pos, t = this.t, q = this.q, g = this.lastGain, pushed = this.pushed;
    for (let i = 0; i < n; i++) {
      const xl = inL[i]!, xr = inR[i]!;
      const al = xl < 0 ? -xl : xl, ar = xr < 0 ? -xr : xr, pk = al > ar ? al : ar;
      const r = pk > c ? c / pk : 1;
      const m = this.minW.push(t, r);
      const rel = q + k;
      q = rel < 1 ? rel : 1;
      if (m < q) q = m;
      g = this.sumW.push(t, q) / M;
      ringL[pos] = xl;
      ringR[pos] = xr;
      pos = pos + 1 === M ? 0 : pos + 1; // now the oldest slot: the sample pushed M − 1 ago
      let yl = ringL[pos]! * g, yr = ringR[pos]! * g;
      if (yl > c) yl = c; else if (yl < -c) yl = -c;
      if (yr > c) yr = c; else if (yr < -c) yr = -c;
      outL[i] = yl;
      outR[i] = yr;
      if (++pushed >= M && g < 1) {
        this.limited++;
        this.lastLimited = t - (M - 1);
        if (g < this.minGain) this.minGain = g;
      }
      t++;
    }
    this.pos = pos; this.t = t; this.q = q; this.lastGain = pushed >= M ? g : 1; this.pushed = pushed;
  }
  /** Gain reduction of the last processed sample, in dB (≤ 0), for the meter. */
  reductionDb(): number { return this.lastGain < 1 ? 20 * Math.log10(this.lastGain) : 0; }
  stats(): LimiterStats {
    return { maxReductionDb: this.minGain < 1 ? 20 * Math.log10(this.minGain) : 0, limitedSamples: this.limited, lastLimitedSample: this.lastLimited };
  }
}

/**
 * The seeded input of the bit-equality check (masterLimiter.test.ts, proof:send L6): `seconds` of stereo at `sampleRate` made with
 * integer arithmetic only (xorshift32 noise and triangle bursts), so Node and Chromium build the same Float32 values. Quiet noise,
 * then bursts that rise to 2.4 × full scale, then quiet again: the limiter holds, releases and leaves the rest untouched.
 */
export function limiterFixture(sampleRate: number, seconds: number, seed = 0x9e3779b9): { left: Float32Array; right: Float32Array } {
  const n = Math.round(sampleRate * seconds);
  const left = new Float32Array(n), right = new Float32Array(n);
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 - 0.5; }; // [−0.5, 0.5)
  const period = Math.max(2, Math.round(sampleRate / 110)); // a 110 Hz triangle
  for (let i = 0; i < n; i++) {
    const phase = (i % period) / period;
    const tri = phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase; // −1 … 1
    const sec = Math.floor((i * 4) / sampleRate) % 8; // eight quarter-second sections, repeating
    const level = sec === 2 ? 2.4 : sec === 3 ? 1.1 : sec === 5 ? 0.6 : 0; // loud, a little over, under the ceiling, silent
    left[i] = 0.05 * rnd() + level * tri;
    right[i] = 0.05 * rnd() - level * 0.8 * tri;
  }
  return { left, right };
}
/** Run the kernel over a whole input in blocks of `block` frames (as a worklet is called: 128) and return interleaved stereo. */
export function limiterRun(input: { left: Float32Array; right: Float32Array }, sampleRate: number, ceilingDb: number, block = 128, startSample = 0): { out: Float32Array; stats: LimiterStats } {
  const lim = new MasterLimiter(sampleRate, ceilingDb, startSample);
  const n = input.left.length, ol = new Float32Array(n), or = new Float32Array(n);
  for (let a = 0; a < n; a += block) {
    const b = Math.min(n, a + block);
    lim.process(input.left.subarray(a, b), input.right.subarray(a, b), ol.subarray(a, b), or.subarray(a, b));
  }
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[i * 2] = ol[i]!; out[i * 2 + 1] = or[i]!; }
  return { out, stats: lim.stats() };
}
