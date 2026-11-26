/**
 * Colour curves in this browser (wave 8 grade; proof G1). window.__pfGradeCurveHash(sets) runs core's gradeCurveTables here and returns
 * each set's gradeCurveTablesDigest, which the proof compares with Node's for the same 40 point sets (the presets, the identity and 37
 * from a fixed integer generator). Not __pfCurveHash: that is the keyframe proof's hook (grade-verify C1). No server, no document, no
 * canvas: the same function Node runs. Until W1 builds the tables it answers { built: false }.
 */
import { GRADE_CURVE_TABLES_BUILT, gradeCurveTables, gradeCurveTablesDigest, type GradeCurves } from '@pulseframe/core';

export interface GradeCurveHashResult { built: boolean; digests: string[]; ms: number }
export function gradeCurveHash(sets: GradeCurves[]): GradeCurveHashResult {
  const t = performance.now();
  if (!GRADE_CURVE_TABLES_BUILT) return { built: false, digests: [], ms: 0 };
  const digests = sets.map((c) => gradeCurveTablesDigest(gradeCurveTables(c)));
  return { built: true, digests, ms: +(performance.now() - t).toFixed(2) };
}
if (typeof window !== 'undefined') (window as unknown as { __pfGradeCurveHash: typeof gradeCurveHash }).__pfGradeCurveHash = gradeCurveHash;
