/**
 * Picture checks of an export (wave 7, track send; send-decisions C10). A HEURISTIC on the 24 × 24 flash cells every export
 * already computes (flashAnalysis.ts flashCells: block means of a ≤ 256 × 256 sample, so a small moving detail can be missed):
 *
 * - black: every cell's linear R, G and B at or under the linear value of 8-bit level 4, for at least ⌈fps/2⌉ frames (0.5 s:
 *   15 frames at 30 fps; 14 are not reported);
 * - frozen: every cell bit-equal to the previous frame's while the document says a video plays (core pictureExpectation
 *   `moving`), for a stretch of at least ⌈2·fps⌉ frames counted from the frame the picture stopped changing. A black frame is not
 *   counted as frozen (it is reported as black).
 *
 * Streaming, O(cells) per frame; the same cells on both server routes (stored cells are exact), so the same runs.
 */
import { CHECK_LIMITS } from '@pulseframe/core';
import type { FlashCells } from './flashAnalysis.ts';

export interface PictureRun { kind: 'black' | 'frozen'; fromFrame: number; toFrame: number; measured: Record<string, number> }
export const PICTURE_CHECK_BUILT = true;

/** sRGB 8-bit level → linear, the formula of flashAnalysis.ts, rounded to float32 as the cells are. */
const linear8 = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
/**
 * The black limit on a cell's channel. A cell is a float32 mean of float32 table values, so a cell of pixels all at level 4
 * can come out one float32 step above the table value: the limit allows 1e-6 relative over it (far under the step to level 5).
 */
export const BLACK_CELL_LIMIT = Math.fround(linear8(CHECK_LIMITS.blackLevel8)) * (1 + 1e-6);
/** ⌈fps · num/den⌉ frames for a duration of num/den seconds (integers). */
export const framesFor = (fps: { num: number; den: number }, s: { num: number; den: number }) => Math.ceil((fps.num * s.num) / (fps.den * s.den) - 1e-12);

export class PictureCheck {
  private readonly minBlack: number;
  private readonly minFrozen: number;
  private frame = 0;
  private cells = 0;
  private prev: Float32Array | null = null;
  private out: PictureRun[] = [];
  private black: { from: number; brightest: number } | null = null;
  /** frozen: the frame the picture stopped changing (the first of the equal ones) and how many frames since then were moving */
  private frozen: { from: number; moving: number } | null = null;
  constructor(readonly fps: { num: number; den: number }) {
    if (!Number.isInteger(fps.num) || !Number.isInteger(fps.den) || fps.num <= 0 || fps.den <= 0) throw new Error(`PictureCheck: bad rate ${fps.num}/${fps.den}`);
    this.minBlack = framesFor(fps, CHECK_LIMITS.blackSeconds);
    this.minFrozen = framesFor(fps, CHECK_LIMITS.frozenSeconds);
  }
  /** The cells of the next exported frame, and whether the document says a video plays on it. */
  push(cells: FlashCells, moving: boolean): void {
    const k = this.frame++, rgb = cells.rgb;
    this.cells = cells.cols * cells.rows;
    let brightest = 0;
    for (let i = 0; i < rgb.length; i++) if (rgb[i]! > brightest) brightest = rgb[i]!;
    const isBlack = brightest <= BLACK_CELL_LIMIT;
    if (isBlack) this.black = this.black ? { from: this.black.from, brightest: Math.max(this.black.brightest, brightest) } : { from: k, brightest };
    else this.endBlack(k);
    // frozen: equal to the previous frame (bit for bit), not black, and a video should be playing
    const same = !!this.prev && this.prev.length === rgb.length && equal(this.prev, rgb);
    if (same && moving && !isBlack) this.frozen = this.frozen ? { from: this.frozen.from, moving: this.frozen.moving + 1 } : { from: k - 1, moving: 1 };
    else this.endFrozen(k);
    this.prev = rgb.slice();
  }
  /** Every run found, ended at the last pushed frame. Runs are [fromFrame, toFrame) in exported frames. */
  runs(): PictureRun[] {
    this.endBlack(this.frame);
    this.endFrozen(this.frame);
    return [...this.out].sort((a, b) => a.fromFrame - b.fromFrame || (a.kind < b.kind ? -1 : 1));
  }
  private endBlack(at: number) {
    const b = this.black;
    this.black = null;
    if (b && at - b.from >= this.minBlack) this.out.push({ kind: 'black', fromFrame: b.from, toFrame: at, measured: { frames: at - b.from, minFrames: this.minBlack, brightestCellLinear: b.brightest, limitLinear: BLACK_CELL_LIMIT, level8: CHECK_LIMITS.blackLevel8 } });
  }
  private endFrozen(at: number) {
    const z = this.frozen;
    this.frozen = null;
    if (z && at - z.from >= this.minFrozen) this.out.push({ kind: 'frozen', fromFrame: z.from, toFrame: at, measured: { frames: at - z.from, minFrames: this.minFrozen, unchangedFramesWhileVideoPlays: z.moving, cellsCompared: this.cells } });
  }
}
function equal(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
