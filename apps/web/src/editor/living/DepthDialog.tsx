/**
 * The depth dialog «ציור עומק» (wave 8 living track; W3 builds it). A modal with a focus trap: Escape cancels and focus returns to
 * «ציירו עומק» (living-depth-open). The photo upright at fit size with the nearness drawn over it from core depthGrid itself (light =
 * near, dark = far, with the legend in words, no colour coding), so what the owner paints is the grid the pass reads. Tools: «קו אופק»
 * (drag, or arrow keys in 1/100 steps), a soft brush «קרוב / רחוק» (keys 1/2), «גודל מכחול», «בטלו משיכה אחרונה» (pops the last
 * stroke; Ctrl+Z inside the dialog does the same; there is no stroke list), «מחקו את כל המשיכות», «בלי קו אופק», «שמירה» (the caller
 * commits once) and «ביטול». The pointer note depth.pointerNote is shown. Test ids: living.testids.ts.
 */
import type { ClipDepth } from '@pulseframe/core';

export interface DepthDialogProps {
  /** the clip's depth, or core LIVING_RAMP_START when it has none (shown, never stored until Save) */
  start: ClipDepth;
  /** the picture as shown (asset image width/height): only the aspect counts */
  shown: { width: number; height: number };
  onSave(depth: ClipDepth): void;
  onCancel(): void;
}
export function DepthDialog(_props: DepthDialogProps) {
  return null;
}
