/**
 * Picture checks (wave 7 send, C10; proof K5): 15 black frames at 30 fps are a finding, 14 are not; a frozen picture is a
 * finding only while the document says a video plays, for at least 2 s; a black stretch is not also called frozen.
 */
import { describe, expect, it } from 'vitest';
import { flashCells, type FlashCells } from './flashAnalysis.ts';
import { BLACK_CELL_LIMIT, framesFor, PictureCheck } from './pictureCheck.ts';

const W = 64, H = 36;
/** A frame of one 8-bit grey level, or noise from a seed (every frame different). */
const grey = (v: number): FlashCells => flashCells(new Uint8Array(W * H * 4).fill(v), W, H);
const noise = (seed: number): FlashCells => { const a = new Uint8Array(W * H * 4); let s = seed * 2654435761 >>> 0; for (let i = 0; i < a.length; i++) { s = (s * 1103515245 + 12345) >>> 0; a[i] = s >>> 24; } return flashCells(a, W, H); };
const fps30 = { num: 30, den: 1 };
const run = (frames: [FlashCells, boolean][], fps = fps30) => { const c = new PictureCheck(fps); for (const [f, m] of frames) c.push(f, m); return c.runs(); };
const seq = (n: number, f: (k: number) => FlashCells, moving = true): [FlashCells, boolean][] => Array.from({ length: n }, (_, k) => [f(k), moving]);

describe('PictureCheck (engine, heuristic on flash cells)', () => {
  it('B: 15 black frames at 30 fps are found, 14 are not (proof K5)', () => {
    const found = run([...seq(10, noise), ...seq(15, () => grey(0)), ...seq(10, (k) => noise(100 + k))]);
    expect(found).toEqual([{ kind: 'black', fromFrame: 10, toFrame: 25, measured: expect.objectContaining({ frames: 15, minFrames: 15 }) }]);
    expect(run([...seq(10, noise), ...seq(14, () => grey(0)), ...seq(10, (k) => noise(100 + k))])).toEqual([]);
    expect(framesFor({ num: 30000, den: 1001 }, { num: 1, den: 2 })).toBe(15);
    expect(framesFor({ num: 25, den: 1 }, { num: 1, den: 2 })).toBe(13);
    expect(framesFor(fps30, { num: 2, den: 1 })).toBe(60);
  });
  it('level 4 is black, level 5 is not; the limit is a float32 step over the level-4 table value at most', () => {
    expect(run(seq(15, () => grey(4)))).toHaveLength(1);
    expect(run(seq(30, () => grey(5)), fps30).filter((r) => r.kind === 'black')).toEqual([]);
    expect(Math.max(...grey(4).rgb)).toBeLessThanOrEqual(BLACK_CELL_LIMIT);
    expect(Math.min(...grey(5).rgb)).toBeGreaterThan(BLACK_CELL_LIMIT);
  });
  it('B: frozen only while moving; 60 equal frames (2 s at 30 fps) while a video plays are found, 59 are not', () => {
    const still = noise(7);
    const at = (n: number, moving: boolean) => run([...seq(5, (k) => noise(200 + k)), ...seq(n, () => still, moving), ...seq(5, (k) => noise(300 + k))]);
    expect(at(60, true)).toEqual([{ kind: 'frozen', fromFrame: 5, toFrame: 65, measured: expect.objectContaining({ frames: 60, unchangedFramesWhileVideoPlays: 59 }) }]);
    expect(at(59, true)).toEqual([]);
    expect(at(120, false)).toEqual([]); // a still photo or a title: no video plays
    // a stretch that stops "moving" halfway is cut there
    const half = run([...seq(3, (k) => noise(400 + k)), ...seq(50, () => still, true), ...seq(50, () => still, false)]);
    expect(half).toEqual([]);
  });
  it('a black stretch is black only, never also frozen, and runs end at the last frame', () => {
    const r = run(seq(90, () => grey(0), true));
    expect(r.map((x) => [x.kind, x.fromFrame, x.toFrame])).toEqual([['black', 0, 90]]);
  });
  it('the same cells give the same runs (both routes feed the same cells)', () => {
    const frames = [...seq(20, (k) => noise(k)), ...seq(70, () => noise(5)), ...seq(16, () => grey(0)), ...seq(3, (k) => noise(900 + k))];
    expect(run(frames)).toEqual(run(frames.map(([c, m]) => [{ ...c, rgb: Float32Array.from(c.rgb) }, m])));
  });
});
