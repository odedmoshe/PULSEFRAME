/**
 * The curve graph's editing rules (wave 8 grade; grade-plan §3.7 with grade-verify C11), pure, for CurvesBlock.tsx (W2 builds both).
 * Keyboard on a focused point (handled on keydown with preventDefault + stopPropagation per handled key, as SpeedCurves.tsx does, so
 * arrows and Delete never reach the editor): ↑/↓ output ±1 (Shift ±8); ←/→ input ±1 (Shift ±8), physically along the input axis
 * (the graph is LTR in both languages), clamped to the neighbours ±GRADE_CURVE_MIN_GAP; end points move vertically only; Enter adds a
 * point half-way to the next one (the previous one for the last point) ON the current curve (y = table[x], so the picture does not
 * change until it moves), refused under GRADE_CURVE_ADD_MIN_GAP or at GRADE_CURVE_MAX_POINTS; Delete/Backspace removes an interior
 * point (focus to its left neighbour), refused on an end point; Escape during a drag cancels it. Pointer: drag a point with the same
 * clamps (no reordering, no dropping a point by dragging it off). NO double-click to add a point (cut). Every result is a valid curve.
 */
import type { GradeCurve } from '@pulseframe/core';

export const GRADE_CURVE_KEY_STEP = 1;
export const GRADE_CURVE_SHIFT_STEP = 8;
/** Enter adds a point only between two points at least this far apart (so both new gaps are ≥ GRADE_CURVE_MIN_GAP). */
export const GRADE_CURVE_ADD_MIN_GAP = 8;
/** A point's transparent hit circle, in graph pixels (WCAG 2.5.8: 24 px across; the visible dot keeps SpeedCurves' r = 6). */
export const GRADE_CURVE_HIT_RADIUS = 12;

export type CurveEditRefusal = 'endPoint' | 'noRoom' | 'full';
export class GradeCurveEditNotBuilt extends Error { constructor(what: string) { super(`${what}: the curve graph is not built in this build yet`); } }

/** The curve with point `index` moved by (dx, dy) code values, clamped as above. */
export function movePoint(curve: GradeCurve, index: number, dx: number, dy: number): GradeCurve {
  void curve; void index; void dx; void dy;
  throw new GradeCurveEditNotBuilt('movePoint');
}
/** Enter on point `index`: the new curve and the new point's index, or why not. `table` is core gradeCurveTable(curve). */
export function addPointAfter(curve: GradeCurve, index: number, table: Uint8Array): { curve: GradeCurve; index: number } | { refused: CurveEditRefusal } {
  void curve; void index; void table;
  throw new GradeCurveEditNotBuilt('addPointAfter');
}
/** Delete on point `index`: the new curve and the index that takes focus, or why not. */
export function deletePoint(curve: GradeCurve, index: number): { curve: GradeCurve; focus: number } | { refused: CurveEditRefusal } {
  void curve; void index;
  throw new GradeCurveEditNotBuilt('deletePoint');
}
