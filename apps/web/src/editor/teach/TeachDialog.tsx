/**
 * The dialog «החילו גם על…» (wave 8 teach; teach-plan.md §3.8 with teach-verify's cuts). BUILDER W3 (sonnet) owns this file after
 * the pre-pass. What it shows, in order (TEACH_TESTIDS names each element):
 *  1. «מה שעשיתם ב־"<שם הקליפ>"»: one tick per part of the derive answer (api.deriveLesson), in its order, with the part's words
 *     (teach.strings part.*) and its detail; the window line (S.window, the heuristic labelled) and its stop; a collapsed «לא נלמד (N)»
 *     with each reason (S.why). An accepted proposal is never in a lesson (the window stops there).
 *  2. «על אילו קליפים»: the clips of the source's sequence, the timeline selection ticked, «כל הקליפים במסלול», at most 200.
 *  3. One row per clip from core planApplyLesson on state.doc (applies / partly / skipped, with each skip's reason through
 *     translateRefusal or S.noSound).
 *  4. The honest lines: S.lookNoPreview whenever a look or an effect part is ticked (there are no before/after stills in version 1),
 *     S.lookNoAdapter when the editor reports no graphics adapter, S.sameSteps with the paste-attributes pointer, S.lightWarning for a
 *     part whose effect has a stir class light* (effects.ts), S.absolute.
 *  5. «החלה על N קליפים» (Enter): editor.commitExact([{ op: 'apply_lesson', args: lessonArgsOf(…) }], LESSON_LABEL, revision, key); a stale
 *     revision shows S.stale and plans again (as PasteAttributesDialog does); then the undo toast with «ביטול».
 * ds Dialog, modal, RTL from lang, focus kept inside, Escape closes, focus back to the opener (craft.state.ts closeSurface's rule);
 * no focus is moved in a later task (deferredFocus.test.ts). Disabled with a toast while a format is viewed (S.notInFormat).
 * HONEST UNTIL BUILT: TEACH_UI_BUILT false renders nothing.
 */
import type { ReactElement } from 'react';

/** True once W3 has built the chip and this dialog (TeachChip and the palette entry read it too). */
export const TEACH_UI_BUILT: boolean = false;

export function TeachDialog(_props: { clipId: string }): ReactElement | null {
  if (!TEACH_UI_BUILT) return null;
  return null; // W3
}
