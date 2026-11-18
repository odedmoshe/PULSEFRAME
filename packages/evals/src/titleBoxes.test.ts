/** The title-box measurement of proof:packs P13 on drawn rectangles: a box is what changed, and touching boxes overlap. */
import { describe, expect, it } from 'vitest';
import { diffBox, overlappingPairs, TITLE_DIFF_THRESHOLD } from './titleBoxes.ts';

const W = 100, H = 80;
const pic = (fill: number) => new Uint8Array(W * H * 4).fill(fill);
const paint = (m: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y * W + x) * 4; m[i] = m[i + 1] = m[i + 2] = v; } return m; };

describe('diffBox', () => {
  it('is the box of the changed pixels, null when nothing changed, and ignores a change at or under the threshold', () => {
    expect(diffBox(pic(40), paint(pic(40), 10, 20, 30, 25, 255), W, H)).toEqual({ x0: 10, y0: 20, x1: 30, y1: 25 });
    expect(diffBox(pic(40), pic(40), W, H)).toBeNull();
    expect(diffBox(pic(40), paint(pic(40), 0, 0, 99, 79, 40 + TITLE_DIFF_THRESHOLD), W, H)).toBeNull();
  });
});
describe('overlappingPairs', () => {
  it('finds boxes that share a pixel, and not boxes side by side', () => {
    const a = { key: 'a', box: { x0: 0, y0: 0, x1: 10, y1: 10 } }, b = { key: 'b', box: { x0: 10, y0: 10, x1: 20, y1: 20 } }, c = { key: 'c', box: { x0: 0, y0: 11, x1: 9, y1: 30 } };
    expect(overlappingPairs([a, b, c])).toEqual([['a', 'b', { x0: 10, y0: 10, x1: 10, y1: 10 }]]);
    expect(overlappingPairs([a, c])).toEqual([]);
  });
});
