/**
 * cleanup.denoise «הפחתת רעש» (ADR-0013), stage 2. PLACEHOLDER of the lead's contracts pass: W1 replaces this file.
 * Contract (core audioEffects.ts row, plan section "Lead contracts" 7): STFT power-subtraction gate with the fixed profile of
 * core voiceClean.ts (decodeNoiseProfile), frames on the timeline grid ((ctx.at + n) % H === 0), finite memory, look-ahead
 * ≤ aheadMs (50 ms) at every rate and speed, 0 and DRY at amount 0; bound 2 (checked by measurement).
 *
 * Until then it processes nothing: create() and bound() throw 'not implemented: W1', so a voice that would run it fails honestly
 * (export reports the error, the preview plays the clip dry and names the reason). reach() declares nothing so plans can be made.
 */
import type { FxProcessor } from '../kernel.ts';
import type { BoundedKernel } from '../design.ts';

export const denoise: BoundedKernel = {
  type: 'cleanup.denoise', version: 1, stage: 2,
  reach: () => ({ warm: 0, tail: 0, ahead: 0 }),
  bound(): number { throw new Error('not implemented: W1 (cleanup.denoise kernel)'); },
  create(): FxProcessor { throw new Error('not implemented: W1 (cleanup.denoise kernel)'); },
};
