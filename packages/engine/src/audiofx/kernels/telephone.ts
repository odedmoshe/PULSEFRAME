/**
 * voice.telephone «טלפון» (ADR-0010 plan section 4), stage 3 (texture), exclusive voice, seeded.
 * Line hiss first (seeded Gaussian, mono, so it is band-limited with the voice; at the output it measures −60 + 24·hiss dBFS
 * RMS, none at hiss 0), then a 4th-order Butterworth high-pass at 300 Hz and low-pass at 3400 Hz (two RBJ sections each),
 * then the Padé drive with k = 1 + 9·grit. Mixed with the dry sound by amount. A DSP effect, not voice conversion.
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { butterworth4, calibratedNoise, cascadeWarm, DRY, fxParams, type BoundedKernel } from '../design.ts';
import { gauss } from '../noise.ts';
import { Cascade } from './biquad.ts';
import { makeDrive, pade } from './drive.ts';

const TYPE = 'voice.telephone';
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  const sections = [...butterworth4('high', 300, sampleRate), ...butterworth4('low', 3400, sampleRate)];
  const dr = makeDrive(1 + 9 * q.num('grit'));
  const hiss = q.num('hiss');
  return { q, sections, dr, hissAmp: hiss > 0 ? calibratedNoise(-60 + 24 * hiss, sections, dr.lipschitz) : 0 };
}

export const telephone: BoundedKernel = {
  type: TYPE, version: 1, stage: 3,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : cascadeWarm(d.sections, d.dr.lipschitz), tail: 0 };
  },
  bound: () => 1,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const f = new Cascade(d.sections), k = d.dr.k, post = d.dr.post, a = d.hissAmp, seed = ctx.seed, at = ctx.at;
    const wet = d.q.num('amount'), dry = 1 - wet;
    return {
      process(buf, frames, n0) {
        const t0 = at + n0;
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const nz = a === 0 ? 0 : gauss(seed, t0 + i) * a;
          const xl = buf[j]!, xr = buf[j + 1]!;
          buf[j] = dry * xl + wet * pade(k * f.tick(xl + nz, 0)) * post;
          buf[j + 1] = dry * xr + wet * pade(k * f.tick(xr + nz, 1)) * post;
        }
      },
    };
  },
};
