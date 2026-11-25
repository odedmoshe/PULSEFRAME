/**
 * Master limiter (wave 7, track send). Worker A's file: `limiterCeilingLinear` is the lead's (it fixes the ceiling on the 16-bit
 * grid); the kernel is a stub until A lands it (send-decisions C11):
 *   r = min(1, c / max(|L|, |R|)); m = AnchoredMin of r over the last M = round(0.005·rate) pushed; q = min(m, min(1, q_prev + k)),
 *   k = 1 / (0.12·rate) (linear release, exactly 1 after at most 120 ms); gain = AnchoredSum(q) / M (a division);
 *   out = input delayed M − 1 × gain, clamped to ±c. +, −, ×, ÷, min only: the same bits in Node and Chromium.
 * Export (apps/server/src/audiomix.ts) is the reference; preview runs the same kernel in public/pf-master-limiter.js.
 * No DOM or Node imports.
 */
/** The ceiling as a linear amplitude on the 16-bit grid: ⌊10^(ceiling/20)·32767⌋ / 32768, so the written file never exceeds it. */
export function limiterCeilingLinear(ceilingDb: number): number {
  return Math.floor(10 ** (ceilingDb / 20) * 32767) / 32768;
}
/** Look-ahead window M (samples, 5 ms) and release length (samples, 120 ms) at a rate. */
export const limiterWindow = (sampleRate: number) => ({ lookahead: Math.max(1, Math.round(0.005 * sampleRate)), release: Math.round(0.12 * sampleRate) });
export const MASTER_LIMITER_BUILT = false;
export interface LimiterStats { maxReductionDb: number; limitedSamples: number; lastLimitedSample: number | null }
/** Stereo brick-wall limiter. Latency = lookahead − 1 samples (the caller compensates; sample count unchanged). */
export class MasterLimiter {
  readonly latency: number;
  constructor(readonly sampleRate: number, readonly ceilingDb: number) { this.latency = limiterWindow(sampleRate).lookahead - 1; }
  /** Process one block in place order (inputs and outputs may be the same arrays). */
  process(inL: Float32Array, inR: Float32Array, outL: Float32Array, outR: Float32Array): void { void inL; void inR; void outL; void outR; throw new Error('MasterLimiter.process is not built yet (send A)'); }
  /** Gain reduction of the last processed sample, in dB (≤ 0), for the meter. */
  reductionDb(): number { throw new Error('MasterLimiter.reductionDb is not built yet (send A)'); }
  stats(): LimiterStats { throw new Error('MasterLimiter.stats is not built yet (send A)'); }
}
