/**
 * cleanup.speech «שיפור דיבור» (ADR-0013), stage 2. PLACEHOLDER of the lead's contracts pass: W2 replaces this file.
 * Contract (core audioEffects.ts row, plan section "Lead contracts" 7): low cut, presence EQ, phrase leveller and a sample-peak
 * limiter that always runs last, all on blocks anchored to the timeline grid; look-ahead ≤ aheadMs (250 ms), 0 and DRY at
 * amount 0; finite warm; bound = 10^(ceilingDb/20), strict.
 *
 * Until then it processes nothing: create() and bound() throw 'not implemented: W2', so a voice that would run it fails honestly
 * (export reports the error, the preview plays the clip dry and names the reason). reach() declares nothing so plans can be made.
 */
import type { FxProcessor } from '../kernel.ts';
import type { BoundedKernel } from '../design.ts';

export const speech: BoundedKernel = {
  type: 'cleanup.speech', version: 1, stage: 2,
  reach: () => ({ warm: 0, tail: 0, ahead: 0 }),
  bound(): number { throw new Error('not implemented: W2 (cleanup.speech kernel)'); },
  create(): FxProcessor { throw new Error('not implemented: W2 (cleanup.speech kernel)'); },
};
