/**
 * cleanup.dehum «הסרת זמזום» (ADR-0013), stage 2: mains hum and its first harmonics removed with narrow RBJ notches (design.ts
 * notch) at k·mainsHz·speed for k ≤ harmonics, the clip speed included because pitch follows speed (FxContext.speed): hum
 * recorded at 50 Hz is heard at 100 Hz at speed 2. Notches below 20 Hz or at or above 0.45·sr are left out. Every notch has the
 * same bandwidth in Hz (design.ts dehumBandwidthHz), so sound between the notches is untouched (225 Hz and 1 kHz change by less
 * than 0.2 dB with 50 Hz hum and the defaults).
 *
 *   y = x − amount·(x − notches(x)) = (1 − amount)·x + amount·notches(x)      (Cascade, Float64 state per channel)
 *
 * Causal, no look-ahead. warm = the smallest W with amount·Σ_{k≥W}|h[k]| ≤ 2^-24 (at most 3 s at speeds 0.25–4); bound = the l1
 * norm of the impulse response (strict). Measured on synthetic hum; nobody has listened to it yet.
 */
import type { FxContext, FxProcessor } from '../kernel.ts';
import { dehumDesign, DRY, type BoundedKernel } from '../design.ts';
import { Cascade } from './biquad.ts';

const TYPE = 'cleanup.dehum';

export const dehum: BoundedKernel = {
  type: TYPE, version: 1, stage: 2,
  reach(p, sampleRate, speed = 1) {
    const d = dehumDesign(p, sampleRate, speed);
    return { warm: d.warm, tail: 0 };
  },
  /** At speed 1 (bound() has no speed): the l1 norm of the impulse response. */
  bound: (p, sampleRate) => dehumDesign(p, sampleRate, 1).bound,
  create(p, ctx: FxContext): FxProcessor {
    const d = dehumDesign(p, ctx.sampleRate, ctx.speed);
    if (d.identity) return DRY;
    const f = new Cascade(d.sections), wet = d.amount, dry = 1 - wet;
    if (wet === 1) {
      return {
        process(buf, frames) {
          for (let i = 0, j = 0; i < frames; i++, j += 2) { buf[j] = f.tick(buf[j]!, 0); buf[j + 1] = f.tick(buf[j + 1]!, 1); }
        },
      };
    }
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const xl = buf[j]!, xr = buf[j + 1]!;
          buf[j] = dry * xl + wet * f.tick(xl, 0);
          buf[j + 1] = dry * xr + wet * f.tick(xr, 1);
        }
      },
    };
  },
};
