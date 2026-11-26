/**
 * tone.bassboost «הגברת באס» (ADR-0010 plan section 4), stage 2 (tone).
 * RBJ low shelf (S = 1) at freqHz with gain amount·gainDb, make-up gain −gain/3 dB, then a rational soft limit above −1 dBFS:
 * |y| = t + (1 − t)·u/(1 + u) with u = (|v| − t)/(1 − t), t = −1 dBFS (slope 1 at t, never reaching 1).
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { cascadeWarm, dbToGain, DRY, fxParams, lowShelf, type BoundedKernel } from '../design.ts';
import { Cascade } from './biquad.ts';

const TYPE = 'tone.bassboost';
const T = dbToGain(-1), ROOM = 1 - T, INV = 1 / ROOM;
/** The soft limit (odd, Lipschitz 1, |y| < 1). */
export const softLimit = (v: number): number => {
  if (v > T) { const u = (v - T) * INV; return T + (ROOM * u) / (1 + u); }
  if (v < -T) { const u = (-v - T) * INV; return -(T + (ROOM * u) / (1 + u)); }
  return v;
};
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  const gain = q.num('amount') * q.num('gainDb');
  return { q, shelf: lowShelf(q.num('freqHz'), gain, sampleRate), makeup: dbToGain(-gain / 3) };
}

export const bassboost: BoundedKernel = {
  type: TYPE, version: 1, stage: 2,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : cascadeWarm([d.shelf], d.makeup), tail: 0 };
  },
  bound: () => 1,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const f = new Cascade([d.shelf]), m = d.makeup;
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          buf[j] = softLimit(f.tick(buf[j]!, 0) * m);
          buf[j + 1] = softLimit(f.tick(buf[j + 1]!, 1) * m);
        }
      },
    };
  },
};
