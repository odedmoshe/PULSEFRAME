/**
 * cleanup.dehum «הסרת זמזום» (ADR-0013), stage 2. PLACEHOLDER of the lead's contracts pass: W1 replaces this file.
 * Contract (core audioEffects.ts row, plan section "Lead contracts" 7): RBJ notches (design.ts notch) at k·mainsHz·ctx.speed for
 * k ≤ harmonics, none below 20 Hz or at or above 0.45·sr; y = x − amount·(x − notch(x)); zero look-ahead; warm ≤ 3 s at speeds
 * 0.25–4; bound = l1 norm of the impulse response.
 *
 * Until then it processes nothing: create() and bound() throw 'not implemented: W1', so a voice that would run it fails honestly
 * (export reports the error, the preview plays the clip dry and names the reason). reach() declares nothing so plans can be made.
 */
import type { FxProcessor } from '../kernel.ts';
import type { BoundedKernel } from '../design.ts';

export const dehum: BoundedKernel = {
  type: 'cleanup.dehum', version: 1, stage: 2,
  reach: () => ({ warm: 0, tail: 0, ahead: 0 }),
  bound(): number { throw new Error('not implemented: W1 (cleanup.dehum kernel)'); },
  create(): FxProcessor { throw new Error('not implemented: W1 (cleanup.dehum kernel)'); },
};
