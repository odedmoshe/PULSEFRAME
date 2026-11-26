/**
 * «עקומות» — the curves block under the grade's sliders (wave 8 grade; grade-plan §3.7 with grade-verify C3, C11). W2 builds it; until
 * CURVES_UI_BUILT it renders nothing (a stub never shows a dead control). Mounted by InspectorObject.tsx ColourTab after ManualGrade.
 * What W2 puts here: GRADE_TESTIDS.block (data-state ready | no-gpu with look.gpu.needed when there is no adapter), the channel tabs
 * (role=tablist, follows RTL), the graph (svg dir=ltr; the current channel solid, the others thin and dashed with R/G/B letters at
 * their right end; a faint identity diagonal, quarter gridlines), points as SpeedCurves.tsx does them (role=slider,
 * aria-orientation=vertical, aria-label pointLabel, aria-valuetext pointValueText, a transparent hit circle GRADE_CURVE_HIT_RADIUS),
 * the «כניסה» / «יציאה» number fields of the focused point (commit on change), a visible status line WITHOUT aria-live (refusals only
 * in the live region), the three ready-made curves with grade.presetsUnseen, reset (set_grade_curves curves null). Live preview through
 * editor.previewGrade once per animation frame, one commit per release, then previewGrade(id, null) after the commit resolves.
 */
import type { Clip } from '@pulseframe/core';

/** W2 sets this when the block is built and grade-proof.ui.ts G11 passes. */
export const CURVES_UI_BUILT = false;

export function CurvesBlock(props: { clip: Clip }) {
  void props;
  if (!CURVES_UI_BUILT) return null;
  return null;
}
