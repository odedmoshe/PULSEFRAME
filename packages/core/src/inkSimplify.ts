/**
 * Simplification of one stroke at pen-up (wave 8 ink; inkContract.ts). W1 builds the body; the editor calls it once per stroke.
 */
import { INK_SIMPLIFY_EPS, InkNotBuiltError, type InkPoints } from './inkContract.ts';

/**
 * ink-plan §4.1 as corrected by C11 (doubles, no BigInt; the input is capped at MAX_RAW_STROKE_POINTS by the editor): drop consecutive
 * duplicate (x, y) (the first keeps its time), then Ramer–Douglas–Peucker with an explicit stack at tolerance `eps` (INK_UNIT), the
 * farthest point first and on a tie the lowest index; a closed loop (A = B) measures |P − A|. Kept points keep their own t.
 * Deterministic; the result's first and last points are the input's.
 */
export function simplifyInkStroke(p: InkPoints, eps: number = INK_SIMPLIFY_EPS): InkPoints {
  void p; void eps;
  throw new InkNotBuiltError('simplifyInkStroke');
}
