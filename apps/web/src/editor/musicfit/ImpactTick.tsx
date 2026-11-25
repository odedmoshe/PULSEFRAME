/**
 * The ◆ tick of a marked moment on a timeline clip, and the join tick on a shortened song's clip (wave 7 musicfit track). BUILDER C
 * builds it (Timeline.tsx mounts it inside each clip while MUSICFIT_UI_BUILT): position from core timelineOfSource for the clip's
 * impact (only while the clip shows it) and for provenance.fitted.joinAt; aria-hidden (the clip's own label says it is marked).
 */
import type { Clip, ProjectDocument } from '@pulseframe/core';

export function ImpactTick({ doc, clip, pps }: { doc: ProjectDocument; clip: Clip; pps: number }) {
  void doc; void clip; void pps;
  return null;
}
