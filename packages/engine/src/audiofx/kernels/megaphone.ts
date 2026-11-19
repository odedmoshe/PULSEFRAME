/**
 * voice.megaphone «מגפון» (ADR-0010 plan section 4), stage 3 (texture), exclusive voice.
 * High-pass 500 Hz and low-pass 4000 Hz (4th-order Butterworth each), a +6 dB peak at 1.8 kHz (Q 1.5), the Padé drive with
 * k = 1 + 9·drive, then a two-tap horn comb w + 0.35·w[n − 3 ms]. Mixed with the dry sound by amount.
 * Honest limit: no oversampling, so strong drive aliases (the registry's limits text says so).
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { butterworth4, cascadeWarm, DRY, fxParams, msToSamples, peaking, type BoundedKernel } from '../design.ts';
import { Cascade } from './biquad.ts';
import { makeDrive, pade } from './drive.ts';

const TYPE = 'voice.megaphone';
export const HORN_GAIN = 0.35;
export const HORN_MS = 3;
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  const sections = [...butterworth4('high', 500, sampleRate), ...butterworth4('low', 4000, sampleRate), peaking(1800, 6, 1.5, sampleRate)];
  return { q, sections, dr: makeDrive(1 + 9 * q.num('drive')), horn: Math.max(1, msToSamples(HORN_MS, sampleRate)) };
}

export const megaphone: BoundedKernel = {
  type: TYPE, version: 1, stage: 3,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : d.horn + cascadeWarm(d.sections, d.dr.lipschitz * (1 + HORN_GAIN)), tail: 0 };
  },
  bound: () => 1 + HORN_GAIN,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const f = new Cascade(d.sections), k = d.dr.k, post = d.dr.post, D = d.horn;
    const hl = new Float64Array(D), hr = new Float64Array(D);
    let pos = 0;
    const wet = d.q.num('amount'), dry = 1 - wet;
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const xl = buf[j]!, xr = buf[j + 1]!;
          const wl = pade(k * f.tick(xl, 0)) * post, wr = pade(k * f.tick(xr, 1)) * post;
          const cl = wl + HORN_GAIN * hl[pos]!, cr = wr + HORN_GAIN * hr[pos]!;
          hl[pos] = wl; hr[pos] = wr;
          pos = pos + 1 === D ? 0 : pos + 1;
          buf[j] = dry * xl + wet * cl;
          buf[j + 1] = dry * xr + wet * cr;
        }
      },
    };
  },
};
