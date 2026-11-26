/** The curve graph's editing rules (W2; grade-plan §3.7, grade-verify C11; proof G11, G12). */
import { describe, it } from 'vitest';

describe('curve editing (W2)', () => {
  it.todo('↑ five times on point 2 raises its output by 5; Shift steps 8; outputs clamp to 0..255');
  it.todo('←/→ move the input, clamped to the neighbours ±4; end points move vertically only');
  it.todo('a drag of point 2 past point 3 stops 4 short of it (G12)');
  it.todo('Enter adds a point half-way to the next (the previous for the last) with y = table[x]; refused as noRoom under a gap of 8 and as full at 12 points');
  it.todo('Delete removes an interior point and focus goes to its left neighbour; an end point is refused as endPoint');
  it.todo('every result passes core gradeCurveIssue');
  it.todo('the block: per handled key preventDefault and stopPropagation on keydown (SpeedCurves.tsx precedent); a commit once per keyup/pointerup; no aria-live on the status line, refusals only in the live region');
});
