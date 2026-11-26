/**
 * The Inspector line «למדתי N שלבים מהקליפ הזה · החילו גם על…» (wave 8 teach). Mounted once in Inspector.tsx under the clip header
 * (lead pre-pass line). BUILDER W3 owns this file after the pre-pass:
 * - the owner's own session only (state.actor 'user:local'); a single selected clip, the master document (no format viewed);
 * - fetches api.deriveLesson when the inspected clip changes and after a revision event that names the clip or a partner, debounced
 *   300 ms; a 501 or any failure shows nothing (never a dead button);
 * - shows only for ≥ 1 learnable part: a plain button (TEACH_TESTIDS.chip, data-count), reachable with Tab, never a popup; Enter
 *   opens the dialog (teachSurface.set({ clipId })).
 * HONEST UNTIL BUILT: while core LESSON_OPS_BUILT (W1) or TEACH_UI_BUILT (W3) is false it renders nothing. The integrator checks the
 * server is built too (LESSON_SERVER_BUILT) before both are left on.
 */
import type { ReactElement } from 'react';
import { LESSON_OPS_BUILT } from '@pulseframe/core';
import { TEACH_UI_BUILT } from './TeachDialog.tsx';

export function TeachChip(): ReactElement | null {
  if (!LESSON_OPS_BUILT || !TEACH_UI_BUILT) return null;
  return null; // W3
}
