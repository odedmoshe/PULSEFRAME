/**
 * Photosensitivity check of rendered frames: does a stretch of the video flash more than three times in any one second
 * over a large enough area? (The general-flash and red-flash thresholds of WCAG 2.3.1 / the ITU-R BT.1702 family of
 * guidelines, as screen-size fractions rather than viewing angles.)
 *
 * It reads the pictures that were actually rendered, so it covers everything that can make a screen flash, whatever
 * made it: effects, transitions, motion presets, cuts between bright and dark shots, keyframes, the user's own footage.
 * It is a guide, not a certification. The frame is divided into a grid of cells (24 × 24); the 10-degree visual field
 * of the guidelines (341 × 256 pixels on a 1024 × 768 screen: a third of the width and of the height) is a window of
 * 8 × 8 cells, slid one cell at a time.
 *
 * Definitions used (per cell):
 * - relative luminance L of the cell's mean linear colour: 0.2126 R + 0.7152 G + 0.0722 B;
 * - a general transition is a change of L by at least 0.1 from the last extreme in the opposite direction, where the
 *   darker of the two is below 0.8; a flash is a pair of opposing transitions;
 * - a red transition is a change by at least 20 of the red value max(0, (R − G − B) × 320), on linear R, G, B, where one
 *   of the two states is saturated red (R / (R + G + B) ≥ 0.8);
 * - a cell is flashing on a frame when the one-second window of frames ending there holds more than six transitions of
 *   one kind (more than three flashes);
 * - a frame fails when, in some window, more than a quarter of the cells are flashing at once (the guidelines' "combined
 *   area of flashes occurring concurrently", 25% of the 10-degree field). A cell partly covered by a flashing object
 *   counts whole, so the check errs on the side of reporting.
 * - the rate a failing stretch reports is the same rule asked for a higher count: the most transitions that more than a
 *   quarter of one window each reached, halved ("flashes a second over the failing area"). The busiest single cell is
 *   reported apart; it can be far higher (a barcode strip changing every frame) without failing on its own.
 *
 * Frames are fed one at a time (streaming), so an export can check what it encodes without keeping the frames.
 */

/** Per frame: the mean linear colour of each cell of a coarse grid. */
export interface FlashCells { cols: number; rows: number; /** linear R, G, B per cell, row by row */ rgb: Float32Array }
export interface FlashRange {
  /** First and last frame of the failing stretch (inclusive). */
  from: number;
  to: number;
  kind: 'general' | 'red';
  /**
   * Flashes a second over the failing area: the most transitions T, in a second ending on some frame of the stretch, that
   * more than a quarter of the cells of one 10-degree window each reached (at least T), halved (a flash is two
   * transitions). This is the verdict's own area rule asked for T instead of 7, so a failing stretch always reads more
   * than 3 (7 transitions read 3.5).
   */
  flashesPerSecond: number;
  /**
   * The busiest single cell of the stretch: its transitions in one second, halved. One cell is far less than the area the
   * rule needs (a fast barcode strip can read 14 here while the area that fails flashes 5 times a second), so this is a
   * pointer to where the picture changes fastest, not the rate of the failing flash.
   */
  busiestCellFlashesPerSecond: number;
  /** Share of the frame (0…1) covered by the blocks that failed somewhere in the stretch; 1 when the whole frame failed. */
  area: number;
}
export interface FlashReport {
  fps: number;
  frames: number;
  verdict: 'pass' | 'fail';
  ranges: FlashRange[];
  /**
   * Over the whole video, failing or not: the most flashes a second over more than a quarter of some 10-degree window
   * (as FlashRange.flashesPerSecond). The check fails exactly where this is above 3; at 3 a video passes at the limit.
   */
  areaPeak: { general: number; red: number };
}

/** Cells per side of the grid; the window of the 10-degree field is a third of it in each direction. */
export const FLASH_GRID = 24;
const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => toLinear(i));

/** The cells of one RGBA frame (8-bit, sRGB, straight or premultiplied over an opaque picture: alpha is ignored). */
export function flashCells(rgba: ArrayLike<number>, width: number, height: number, grid = FLASH_GRID): FlashCells {
  const rgb = new Float32Array(grid * grid * 3), count = new Float32Array(grid * grid);
  // every pixel would be exact but slow for large frames; a regular sample of at most ~256 × 256 points is enough for block means
  const step = Math.max(1, Math.floor(Math.min(width, height) / 256));
  for (let y = 0; y < height; y += step) {
    const cy = Math.min(grid - 1, Math.floor((y * grid) / height));
    for (let x = 0; x < width; x += step) {
      const cx = Math.min(grid - 1, Math.floor((x * grid) / width)), i = (y * width + x) * 4, c = cy * grid + cx;
      for (let j = 0; j < 3; j++) rgb[c * 3 + j] = rgb[c * 3 + j]! + LINEAR[rgba[i + j]! | 0]!;
      count[c] = count[c]! + 1;
    }
  }
  for (let c = 0; c < grid * grid; c++) { const k = count[c]! || 1; for (let j = 0; j < 3; j++) rgb[c * 3 + j] = rgb[c * 3 + j]! / k; }
  return { cols: grid, rows: grid, rgb };
}

/**
 * Counts transitions of one signal with hysteresis: a transition completes when the value has moved at least `step` from
 * the last extreme in the other direction and `qualifies(extreme state, current state)` holds. Before the first
 * transition both the lowest and the highest value so far are candidates to measure from.
 */
class Transitions<S> {
  private started = false;
  private lo = { v: Infinity, s: undefined as S | undefined };
  private hi = { v: -Infinity, s: undefined as S | undefined };
  private ext = { v: 0, s: undefined as S | undefined };
  private dir = 0;
  constructor(private readonly step: number, private readonly qualifies: (from: { v: number; s: S }, to: { v: number; s: S }) => boolean) {}
  /** Feed the next value and its state; true when a transition completes on it. */
  next(v: number, s: S): boolean {
    const now = { v, s };
    if (!this.started) {
      if (v < this.lo.v) this.lo = now;
      if (v > this.hi.v) this.hi = now;
      const rise = v - this.lo.v >= this.step && this.qualifies(this.lo as { v: number; s: S }, now);
      const fall = this.hi.v - v >= this.step && this.qualifies(this.hi as { v: number; s: S }, now);
      if (!rise && !fall) return false;
      this.started = true; this.dir = rise ? 1 : -1; this.ext = now;
      return true;
    }
    if (this.dir > 0 ? v > this.ext.v : v < this.ext.v) { this.ext = now; return false; } // further the same way: a new extreme
    if (Math.abs(v - this.ext.v) >= this.step && this.qualifies(this.ext as { v: number; s: S }, now)) { this.dir = -this.dir; this.ext = now; return true; }
    return false;
  }
}

const luminance = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const redValue = (r: number, g: number, b: number) => Math.max(0, (r - g - b) * 320);
const saturatedRed = (r: number, g: number, b: number) => r + g + b > 0 && r / (r + g + b) >= 0.8;

type RGB = [number, number, number];
interface Cell { general: Transitions<null>; red: Transitions<RGB>; /** frames of the transitions in the last second */ gTimes: number[]; rTimes: number[] }

/** Streaming analyser: feed cells frame by frame, then read the report. */
export class FlashAnalyser {
  private cells: Cell[] = [];
  private frame = 0;
  private readonly block: number;
  /**
   * Frames that failed: kind, the transitions over the failing area (areaCount), the most transitions of any one cell, and
   * which cells were flashing.
   */
  private failing: { frame: number; kind: 'general' | 'red'; count: number; busiest: number; flashing: Uint8Array }[] = [];
  /** The most transitions of each kind any one cell had in any one-second window so far (peak()). */
  private highest = { general: 0, red: 0 };
  /** The highest areaCount of each kind on any frame so far (report().areaPeak, in transitions). */
  private highestArea = { general: 0, red: 0 };
  constructor(readonly fps: number, private readonly grid = FLASH_GRID) {
    if (!(fps > 0)) throw new RangeError('frame rate must be positive');
    this.block = Math.max(1, Math.round(grid / 3));
    for (let c = 0; c < grid * grid; c++) this.cells.push({
      general: new Transitions<null>(0.1, (a, b) => Math.min(a.v, b.v) < 0.8), // the darker state below 0.8
      red: new Transitions<RGB>(20, (a, b) => saturatedRed(...a.s) || saturatedRed(...b.s)), // one of the two states saturated red
      gTimes: [], rTimes: [],
    });
  }
  push(cells: FlashCells): void {
    const G = this.grid;
    if (cells.cols !== G || cells.rows !== G) throw new RangeError(`cells must be ${G} × ${G}`);
    const window = Math.max(1, Math.round(this.fps)); // frames in one second
    const counts = { general: new Int32Array(G * G), red: new Int32Array(G * G) };
    const most = { general: 0, red: 0 };
    this.cells.forEach((cell, c) => {
      const r = cells.rgb[c * 3]!, g = cells.rgb[c * 3 + 1]!, b = cells.rgb[c * 3 + 2]!;
      if (cell.general.next(luminance(r, g, b), null)) cell.gTimes.push(this.frame);
      if (cell.red.next(redValue(r, g, b), [r, g, b])) cell.rTimes.push(this.frame);
      for (const [times, kind] of [[cell.gTimes, 'general'], [cell.rTimes, 'red']] as const) {
        while (times.length && times[0]! <= this.frame - window) times.shift();
        counts[kind][c] = times.length;
        if (times.length > most[kind]) most[kind] = times.length;
      }
    });
    for (const kind of ['general', 'red'] as const) {
      if (most[kind] > this.highest[kind]) this.highest[kind] = most[kind];
      const area = this.areaCount(counts[kind], most[kind]);
      if (area > this.highestArea[kind]) this.highestArea[kind] = area;
      // the verdict: a frame fails when more than a quarter of some window flashes more than three times (> 6 transitions)
      if (area > 6) {
        const f = new Uint8Array(G * G);
        for (let c = 0; c < G * G; c++) if (counts[kind][c]! > 6) f[c] = 1;
        this.failing.push({ frame: this.frame, kind, count: area, busiest: most[kind], flashing: f });
      }
    }
    this.frame++;
  }
  /** Whether more than a quarter of the cells of some window (block × block, slid one cell at a time) have at least `t` transitions. */
  private quarterAtLeast(counts: Int32Array, t: number): boolean {
    const G = this.grid, B = this.block, sum = new Int32Array((G + 1) * (G + 1));
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) sum[(y + 1) * (G + 1) + x + 1] = (counts[y * G + x]! >= t ? 1 : 0) + sum[y * (G + 1) + x + 1]! + sum[(y + 1) * (G + 1) + x]! - sum[y * (G + 1) + x]!;
    for (let y = 0; y + B <= G; y++) for (let x = 0; x + B <= G; x++) {
      const n = sum[(y + B) * (G + 1) + x + B]! - sum[y * (G + 1) + x + B]! - sum[(y + B) * (G + 1) + x]! + sum[y * (G + 1) + x]!;
      if (n * 4 > B * B) return true;
    }
    return false;
  }
  /**
   * Transitions over the area on this frame: the largest T (0 … `most`) such that more than a quarter of the cells of some
   * window had at least T transitions in the second ending here. The frame fails exactly when this is above 6, so the
   * number and the verdict are one rule. Monotone in T (a cell with T + 1 also has T), so found by bisection.
   */
  private areaCount(counts: Int32Array, most: number): number {
    let lo = 0, hi = most; // quarterAtLeast(counts, 0) is always true
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.quarterAtLeast(counts, mid)) lo = mid; else hi = mid - 1; }
    return lo;
  }
  /**
   * The most transitions (of luminance, and of saturated red) that any one cell had in any one-second window of the frames
   * pushed so far, whatever the area. A cell flashes above 6 (more than three flashes a second), so this says how close
   * a picture comes to the limit even where it passes (the trend-pack proofs read it per transition, ADR-0012).
   */
  peak(): { general: number; red: number } {
    return { ...this.highest };
  }
  report(): FlashReport {
    const window = Math.max(1, Math.round(this.fps));
    const ranges: FlashRange[] = [];
    for (const kind of ['general', 'red'] as const) {
      const hits = this.failing.filter((f) => f.kind === kind);
      let cur: { from: number; to: number; most: number; busiest: number; covered: Uint8Array } | null = null;
      const close = () => {
        if (!cur) return;
        ranges.push({ from: cur.from, to: cur.to, kind, flashesPerSecond: cur.most / 2, busiestCellFlashesPerSecond: cur.busiest / 2, area: Number((cur.covered.reduce((s, v) => s + v, 0) / cur.covered.length).toFixed(3)) });
        cur = null;
      };
      for (const h of hits) {
        const from = Math.max(0, h.frame - window + 1); // the one-second window that failed ends on this frame
        if (cur && from <= cur.to + 1) { cur.to = h.frame; cur.most = Math.max(cur.most, h.count); cur.busiest = Math.max(cur.busiest, h.busiest); for (let i = 0; i < h.flashing.length; i++) cur.covered[i] = cur.covered[i]! | h.flashing[i]!; }
        else { close(); cur = { from, to: h.frame, most: h.count, busiest: h.busiest, covered: h.flashing.slice() }; }
      }
      close();
    }
    ranges.sort((a, b) => a.from - b.from || (a.kind < b.kind ? -1 : 1));
    return { fps: this.fps, frames: this.frame, verdict: ranges.length ? 'fail' : 'pass', ranges, areaPeak: { general: this.highestArea.general / 2, red: this.highestArea.red / 2 } };
  }
}
