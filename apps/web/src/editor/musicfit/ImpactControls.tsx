/**
 * «סימון הרגע» and «אל הפעימה» in the clip's Beat tab (wave 7 musicfit track). BUILDER C builds it (InspectorObject.tsx BeatTab mounts it
 * while MUSICFIT_UI_BUILT): «סימון הרגע» marks the source time the playhead shows; the line «הרגע 4 פריימים אחרי הפעימה» from core
 * planImpact (the same function the op uses); «אל הפעימה» / «אל תחילת התיבה» with earlier / later; after it the residual sentence and
 * musicfit.uncalibrated; musicfit.impactKept says a marked clip is kept on regeneration. Never the word «מסונכרן».
 */
import type { Clip } from '@pulseframe/core';

export function ImpactControls({ clip }: { clip: Extract<Clip, { type: 'media' }> }) {
  void clip;
  return null;
}
