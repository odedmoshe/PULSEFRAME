import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FLASH_GRID, FlashAnalyser, flashCells } from './flashAnalysis.ts';

const W = 96, H = 96;
/** An RGBA frame: `paint(x, y)` gives [r, g, b] in 0…255. */
function frame(paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = paint(x, y); out.set([r, g, b, 255], (y * W + x) * 4); }
  return out;
}
const flat = (v: number) => frame(() => [v, v, v]);
/** Analyse `seconds` of video at `fps`, frame k drawn by `at(k)`. */
function analyse(fps: number, seconds: number, at: (k: number) => Uint8ClampedArray) {
  const a = new FlashAnalyser(fps);
  const cache = new Map<Uint8ClampedArray, ReturnType<typeof flashCells>>();
  for (let k = 0; k < Math.round(fps * seconds); k++) { const f = at(k); let c = cache.get(f); if (!c) cache.set(f, (c = flashCells(f, W, H))); a.push(c); }
  return a.report();
}
const BLACK = flat(0), WHITE = flat(255), GREY = flat(128);
/** Alternates two frames `perSecond` full cycles a second (each cycle = one flash: up and down). */
const alternate = (fps: number, perSecond: number, a: Uint8ClampedArray, b: Uint8ClampedArray) => (k: number) => (Math.floor((k / fps) * perSecond * 2) % 2 === 0 ? a : b);

describe('photosensitivity check of rendered frames', () => {
  it('full-frame black/white: three flashes a second pass, four fail, at 24, 30 and 60 frames a second', () => {
    for (const fps of [24, 30, 60]) {
      expect(analyse(fps, 4, alternate(fps, 3, BLACK, WHITE)).verdict, `${fps} fps, 3/s`).toBe('pass');
      const r = analyse(fps, 4, alternate(fps, 4, BLACK, WHITE));
      expect(r.verdict, `${fps} fps, 4/s`).toBe('fail');
      expect(r.ranges[0]!.kind).toBe('general');
      expect(r.ranges[0]!.flashesPerSecond).toBeGreaterThanOrEqual(4);
      expect(r.ranges[0]!.area).toBe(1); // every cell of the frame flashed
    }
  });

  it('a change smaller than a tenth of the luminance range, or one whose darker state is above 0.8, is no flash', () => {
    const a = flat(200), b = flat(214); // luminance 0.58 → 0.67: less than 0.1 apart
    expect(analyse(30, 3, alternate(30, 10, a, b)).verdict).toBe('pass');
    const c = flat(236), d = flat(255); // 0.84 ↔ 1.0: the darker state is above 0.8
    expect(analyse(30, 3, alternate(30, 10, c, d)).verdict).toBe('pass');
  });

  it('a slow fade is no flash; a flash at the very start of the video is counted', () => {
    expect(analyse(30, 5, (k) => flat(Math.round(127 + 127 * Math.sin(k / 30 * Math.PI)))).verdict).toBe('pass'); // half a cycle a second
    const r = analyse(30, 2, alternate(30, 5, WHITE, BLACK));
    expect(r.verdict).toBe('fail');
    expect(r.ranges[0]!.from).toBe(0);
  });

  it('area: a small patch flashing fast passes; a third of the frame flashing fails, wherever it is, and the range says how much of the frame', () => {
    const patch = (on: boolean, x0: number, y0: number, size: number) => frame((x, y) => (on && x >= x0 && x < x0 + size && y >= y0 && y < y0 + size ? [255, 255, 255] : [0, 0, 0]));
    // 1/8 of the width and height: about 1.6% of the frame, 14% of a 10-degree window
    const small = [patch(false, 40, 40, 12), patch(true, 40, 40, 12)];
    expect(analyse(30, 3, (k) => small[Math.floor(k / 3) % 2]!).verdict).toBe('pass');
    for (const [x0, y0] of [[0, 0], [32, 32], [64, 64], [16, 48]] as const) {
      const big = [patch(false, x0, y0, 32), patch(true, x0, y0, 32)];
      const r = analyse(30, 3, (k) => big[Math.floor(k / 3) % 2]!);
      expect(r.verdict, `${x0},${y0}`).toBe('fail');
      expect(r.ranges[0]!.area).toBeGreaterThan(0.05);
      expect(r.ranges[0]!.area).toBeLessThan(1);
    }
  });

  it('red: saturated red alternating with black four times a second fails as a red flash even when its luminance change alone would be small', () => {
    const DARK_RED = frame(() => [120, 0, 0]); // luminance of 120 linear red ≈ 0.04: no general transition from black
    const r = analyse(30, 3, alternate(30, 4, BLACK, DARK_RED));
    expect(r.ranges.map((x) => x.kind)).toEqual(['red']);
    // the same rate in a red that is not saturated (red with as much green and blue) is no red flash
    const PINK = frame(() => [120, 70, 70]);
    expect(analyse(30, 3, alternate(30, 4, BLACK, PINK)).ranges.filter((x) => x.kind === 'red')).toEqual([]);
  });

  it('ranges: a burst of flashing in the middle is reported with its place; before and after it the video passes', () => {
    // 2 s grey, 1.5 s of 5 flashes a second, 2 s grey
    const r = analyse(30, 5.5, (k) => (k >= 60 && k < 105 ? alternate(30, 5, BLACK, WHITE)(k) : GREY));
    expect(r.verdict).toBe('fail');
    expect(r.ranges).toHaveLength(1);
    expect(r.ranges[0]!.from).toBeGreaterThanOrEqual(60 - 30);
    expect(r.ranges[0]!.to).toBeLessThan(105 + 30);
    expect(r.frames).toBe(165);
  });

  it('any steady alternation: the verdict is "fail" exactly when it is faster than three flashes a second (property)', () => {
    fc.assert(fc.property(fc.constantFrom(24, 25, 30, 50, 60), fc.integer({ min: 1, max: 14 }), (fps, halfPeriodFrames) => {
      // a square wave that changes every `halfPeriodFrames` frames: fps / (2 · halfPeriodFrames) flashes a second
      const perSecond = fps / (2 * halfPeriodFrames);
      const r = analyse(fps, 4, (k) => (Math.floor(k / halfPeriodFrames) % 2 === 0 ? BLACK : WHITE));
      // more than six transitions fit in one second exactly when 7 changes fit in a window of fps frames
      const transitionsInASecond = Math.floor((Math.round(fps) - 1) / halfPeriodFrames) + 1;
      expect(r.verdict, `${fps} fps, ${perSecond.toFixed(2)}/s`).toBe(transitionsInASecond > 6 ? 'fail' : 'pass');
    }), { numRuns: 70 });
  });

  it('cells are block means of linear light; a frame of any size gives the same cells for the same picture', () => {
    const c = flashCells(WHITE, W, H);
    expect(c.cols).toBe(FLASH_GRID);
    expect(Math.min(...c.rgb)).toBeCloseTo(1, 6);
    const big = new Uint8ClampedArray(640 * 360 * 4).fill(255);
    expect(Math.min(...flashCells(big, 640, 360).rgb)).toBeCloseTo(1, 6);
    const half = flashCells(frame((x) => (x < W / 2 ? [255, 255, 255] : [0, 0, 0])), W, H);
    expect(half.rgb[0]).toBeCloseTo(1, 6);
    expect(half.rgb[(FLASH_GRID - 1) * 3]).toBeCloseTo(0, 6);
  });
});
