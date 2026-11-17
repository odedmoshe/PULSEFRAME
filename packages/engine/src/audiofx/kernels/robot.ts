/**
 * voice.robot «רובוט» (ADR-0010 plan section 4), stage 3 (texture), exclusive voice. Finite memory (pure).
 * Ring modulation by the 4096-entry sine table at pitchHz, whose phase is exactly ((pitchHz·(at+n)) mod sr)/sr in integers;
 * then a 3-tap metallic comb FIR at 5.5, 11 and 16.5 ms with gains 0.5, 0.3 and 0.2 times metal; then the Padé drive, k = 1.5.
 * Mixed with the dry sound by amount. Not a vocoder: the words stay as spoken.
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DRY, fxParams, msToSamples, type BoundedKernel } from '../design.ts';
import { sineAt } from '../tables.ts';
import { makeDrive, pade } from './drive.ts';

const TYPE = 'voice.robot';
const DRIVE = makeDrive(1.5);
const COMB_MS = [5.5, 11, 16.5] as const, COMB_GAIN = [0.5, 0.3, 0.2] as const;
/** Integer carrier phase at timeline sample t: (pitchHz·t) mod sampleRate, in [0, sampleRate). */
export const carrierPhase = (pitchHz: number, sampleRate: number, t: number): number => (((pitchHz * t) % sampleRate) + sampleRate) % sampleRate;
/** The carrier at timeline sample t, exactly as the kernel computes it (closed form). */
export const robotCarrier = (pitchHz: number, sampleRate: number, t: number): number => sineAt(carrierPhase(pitchHz, sampleRate, t) / sampleRate);
/** The robot's drive (for tests: the output for a constant input is drive(input·carrier) at metal 0, amount 1). */
export const robotDrive = (x: number): number => pade(DRIVE.k * x) * DRIVE.post;

function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  return { q, taps: COMB_MS.map((ms) => Math.max(1, msToSamples(ms, sampleRate))) };
}

export const robot: BoundedKernel = {
  type: TYPE, version: 1, stage: 3,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : Math.max(...d.taps), tail: 0 };
  },
  bound: () => 1,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const sr = ctx.sampleRate, at = ctx.at, pitch = Math.round(d.q.num('pitchHz')), metal = d.q.num('metal');
    const [d1, d2, d3] = d.taps as [number, number, number];
    const g1 = metal * COMB_GAIN[0], g2 = metal * COMB_GAIN[1], g3 = metal * COMB_GAIN[2];
    const N = d3 + 1, rl = new Float64Array(N), rr = new Float64Array(N);
    let pos = 0;
    const k = DRIVE.k, post = DRIVE.post, wet = d.q.num('amount'), dry = 1 - wet;
    return {
      process(buf, frames, n0) {
        let ph = carrierPhase(pitch, sr, at + n0);
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const s = sineAt(ph / sr);
          ph += pitch;
          if (ph >= sr) ph -= sr;
          const xl = buf[j]!, xr = buf[j + 1]!;
          const ml = xl * s, mr = xr * s;
          rl[pos] = ml; rr[pos] = mr;
          let p1 = pos - d1, p2 = pos - d2, p3 = pos - d3;
          if (p1 < 0) p1 += N;
          if (p2 < 0) p2 += N;
          if (p3 < 0) p3 += N;
          const cl = ml + g1 * rl[p1]! + g2 * rl[p2]! + g3 * rl[p3]!;
          const cr = mr + g1 * rr[p1]! + g2 * rr[p2]! + g3 * rr[p3]!;
          pos = pos + 1 === N ? 0 : pos + 1;
          buf[j] = dry * xl + wet * pade(k * cl) * post;
          buf[j + 1] = dry * xr + wet * pade(k * cr) * post;
        }
      },
    };
  },
};
