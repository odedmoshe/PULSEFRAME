/**
 * Picture checks of an export (wave 7, track send). Worker B's file; a stub until B lands it. A HEURISTIC on the 24 × 24 flash
 * cells every export already computes (flashAnalysis.ts flashCells): black = every cell's R, G, B at or under the linear value of
 * 8-bit level 4 for at least 0.5 s; frozen = every cell equal to the previous frame's for at least 2 s while the document says a
 * video plays (core exportChecks.ts pictureExpectation). Same cells on both server routes, so the same findings.
 */
import type { FlashCells } from './flashAnalysis.ts';
export interface PictureRun { kind: 'black' | 'frozen'; fromFrame: number; toFrame: number; measured: Record<string, number> }
export const PICTURE_CHECK_BUILT = false;
export class PictureCheck {
  constructor(readonly fps: { num: number; den: number }) {}
  /** The cells of the next exported frame, and whether the document says a video plays on it. */
  push(cells: FlashCells, moving: boolean): void { void cells; void moving; throw new Error('PictureCheck.push is not built yet (send B)'); }
  runs(): PictureRun[] { throw new Error('PictureCheck.runs is not built yet (send B)'); }
}
