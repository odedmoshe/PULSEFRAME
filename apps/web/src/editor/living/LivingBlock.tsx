/**
 * The «תמונה חיה» block of the object inspector's «תנועה» tab (wave 8 living track; W3 builds it). Mounted by InspectorObject.tsx
 * behind LIVING_UI_BUILT for one selected photo clip, so nothing shows until it is built (no dead button).
 * What W3 builds (living-plan §3.6 as corrected): «הפכו לתמונה חיה» opens DepthDialog with core LIVING_RAMP_START pre-filled (C13);
 * «שמירה» commits ONE set_living_picture carrying the depth (one undo). Then the move chips push|slide (a radio group, arrow keys, RTL
 * order), the amount slider capped at core livingMaxAmount with the capped line, the depth line, «ציירו עומק» (later edits:
 * set_clip_depth), the lines living.drawnNote, living.ruleOfThumb, living.gpu, living.replaced (from output.replacedMotion), refit, and
 * «הסירו תמונה חיה» (remove:true; the depth stays, said by living.removeKeepsDepth). Test ids: living.testids.ts.
 */
import type { MediaClip } from '@pulseframe/core';

/** W3 sets this when the block and the dialog are built and the a11y states pass. */
export const LIVING_UI_BUILT: boolean = false;

export function LivingBlock(_props: { clip: MediaClip }) {
  return null;
}
