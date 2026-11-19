/**
 * texture.8bit «8 ביט» (ADR-0010 plan section 4), stage 3 (texture). Finite memory: warm-up k − 1.
 * Sample-and-hold every k = round(sr/(rateKhz·1000)) samples, anchored to the timeline grid ((at+n) mod k = 0 takes a new
 * sample), then quantisation to round(x·L)/L with L = 2^(bits−1), clamped to [−L, L−1] so there are at most 2^bits levels.
 * Mixed with the dry sound by amount. Aliasing is the intended sound.
 */
import type { AudioFxParams } from '@pulseframe/core';
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DRY, fxParams, type BoundedKernel } from '../design.ts';

const TYPE = 'texture.8bit';
/** Hold length in samples at this rate. */
export const holdLength = (rateKhz: number, sampleRate: number): number => Math.max(1, Math.round(sampleRate / (rateKhz * 1000)));
function design(p: Readonly<AudioFxParams>, sampleRate: number) {
  const q = fxParams(TYPE, p);
  return { q, k: holdLength(q.num('rateKhz'), sampleRate), L: 1 << (Math.round(q.num('bits')) - 1) };
}

export const bitcrush: BoundedKernel = {
  type: TYPE, version: 1, stage: 3,
  reach(p, sampleRate) {
    const d = design(p, sampleRate);
    return { warm: d.q.identity ? 0 : d.k - 1, tail: 0 };
  },
  bound: () => 1,
  create(p, ctx: FxContext): FxProcessor {
    const d = design(p, ctx.sampleRate);
    if (d.q.identity) return DRY;
    const k = d.k, L = d.L, lo = -L, hi = L - 1, inv = 1 / L, at = ctx.at;
    const wet = d.q.num('amount'), dry = 1 - wet;
    let hl = 0, hr = 0;
    const q = (v: number) => { const r = Math.round(v * L); return (r < lo ? lo : r > hi ? hi : r) * inv; };
    return {
      process(buf, frames, n0) {
        let c = (((at + n0) % k) + k) % k;
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const xl = buf[j]!, xr = buf[j + 1]!;
          if (c === 0) { hl = xl; hr = xr; }
          c = c + 1 === k ? 0 : c + 1;
          buf[j] = dry * xl + wet * q(hl);
          buf[j + 1] = dry * xr + wet * q(hr);
        }
      },
    };
  },
};
