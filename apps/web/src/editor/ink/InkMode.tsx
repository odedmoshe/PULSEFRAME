/**
 * «ציור» — the drawing mode over the stage (wave 8 ink, version 1). Lead pre-pass: the mount points and these empty stubs; W3 builds
 * them against core inkContract.ts / inkOps.ts, inkKeys.ts, the ids of ink.testids.ts and the words of ink.strings.ts. Until then
 * nothing is shown (INK_UI_BUILT false): no dead button.
 *
 * What W3 builds (the contract; ink-plan §3.6 as corrected by ink-verify):
 * - InkModeButton in StageHeader.tsx; Shift+D (inkKeys INK_MODE_CHORD) through a command `ink.toggle` W3 adds to COMMANDS. Paused frame
 *   only: while playing the button is disabled with «אפשר לצייר רק כשהסרטון עצור…».
 * - InkMode beside CanvasHandles (App.tsx): pointer capture over the canvas (first pointer only; touch ignored while a pen touches),
 *   coalesced events, each point rounded ONCE to INK_UNIT from the frame centre; t = round(e.timeStamp − strokeStart), never accumulated;
 *   the gap to the previous stroke capped at INK_GAP_CAP_MS; at pen-up core simplifyInkStroke; a stroke over MAX_STROKE_POINTS continues
 *   as a new stroke (status «הקו היה ארוך…»); raw points capped at MAX_RAW_STROKE_POINTS.
 * - The wet stroke on the `wet` canvas while the pen is down; at pen-up it is cleared and the GHOST shows the session: the session's
 *   strokes applied locally as add_ink with play 'all' (ink-verify C2: the whole drawing, never the first 33 ms) through the editor's
 *   ghost path (editor.showGhost, as PerformView), drawn by the compositor. Nothing is stored before «סיום».
 * - «סיום»/Enter: ONE editor.commit of add_ink (play 'drawn'): one transaction, one undo; then the status «הציור מופיע בהדרגה. לחצו רווח
 *   כדי לראות»; no automatic seek. «ביטול»/Escape: asks first when there are strokes (discardConfirm). Ctrl+Z removes the last session
 *   stroke; with none, «אין קווים לביטול בציור הזה», never the project undo. Keys: inkKeyAction in the capture phase.
 * - No localStorage mirror (cut). No eraser, no re-opening (cut).
 */
/** True once W3 has built the mode (StageHeader and App mount it only then). */
export const INK_UI_BUILT = false;

export function InkModeButton() {
  return null;
}
export function InkMode({ canvas }: { canvas: HTMLCanvasElement | null }) {
  void canvas;
  return null;
}
