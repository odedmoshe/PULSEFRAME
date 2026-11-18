/** The typed grid arithmetic of the incremental proof's expectations (incremental-fixtures.ts): cells of a frame range and the segment count of a full export. */
import { describe, expect, it } from 'vitest';
import { A_LAYOUT, cellsOf, segmentCount } from './incremental-fixtures.ts';

describe('incremental proof expectations', () => {
  it('cells of the layout stretches', () => {
    expect(cellsOf(A_LAYOUT.t1.start, A_LAYOUT.t1.start + A_LAYOUT.t1.frames)).toEqual([10, 11]);
    expect(cellsOf(1190, 1215)).toEqual([19, 20]);
    expect(cellsOf(1006, 1047)).toEqual([16, 17]);
    expect(cellsOf(450, 615)).toEqual([7, 8, 9, 10]);
    expect(cellsOf(120, 180)).toEqual([2]);
  });
  it('segment counts: a 1 or 2 frame tail joins the last cell', () => {
    expect(segmentCount(1801)).toBe(30);
    expect(segmentCount(1802)).toBe(30);
    expect(segmentCount(1803)).toBe(31);
    expect(segmentCount(1800)).toBe(30);
    expect(segmentCount(18000)).toBe(300);
    expect(segmentCount(300)).toBe(5);
  });
});
