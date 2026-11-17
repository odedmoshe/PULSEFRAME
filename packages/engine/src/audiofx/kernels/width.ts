/**
 * utility.width «רוחב סטריאו» (ADR-0010 plan section 4), stage 6 (motion). Stateless.
 * M = (L+R)/2, S = w·(L−R)/2, out = (M + S, M − S): w = 0 gives L === R exactly, w = 1 is the dry sound (left out of the plan),
 * w = 2 doubles the side signal. A mono source has no side signal, so width does nothing to it.
 */
import type { FxContext, FxProcessor } from '../kernel.ts';
import { DRY, fxParams, type BoundedKernel } from '../design.ts';

const TYPE = 'utility.width';
export const width: BoundedKernel = {
  type: TYPE, version: 1, stage: 6,
  reach: () => ({ warm: 0, tail: 0 }),
  bound: (p) => Math.max(1, fxParams(TYPE, p).num('stereoWidth')),
  create(p, _ctx: FxContext): FxProcessor {
    const q = fxParams(TYPE, p);
    if (q.identity) return DRY;
    const w = q.num('stereoWidth');
    return {
      process(buf, frames) {
        for (let i = 0, j = 0; i < frames; i++, j += 2) {
          const l = buf[j]!, r = buf[j + 1]!;
          const m = (l + r) * 0.5, s = w * (l - r) * 0.5;
          buf[j] = m + s;
          buf[j + 1] = m - s;
        }
      },
    };
  },
};
