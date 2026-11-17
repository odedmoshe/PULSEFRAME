import { describe, expect, it } from 'vitest';
import { nextTileIndex, tabStopIndex } from './styleTiles.nav.ts';

describe('style tile roving focus', () => {
  it('has exactly one tab stop: the chosen tile, else the first', () => {
    expect(tabStopIndex(['a', 'b', 'c'], 'c')).toBe(2);
    expect(tabStopIndex(['a', 'b', 'c'], null)).toBe(0);
    expect(tabStopIndex(['a', 'b', 'c'], 'zzz')).toBe(0);
  });
  it('arrows follow the reading direction and stop at the ends', () => {
    expect(nextTileIndex('ArrowLeft', 1, 5, 3, true)).toBe(2);
    expect(nextTileIndex('ArrowRight', 1, 5, 3, true)).toBe(0);
    expect(nextTileIndex('ArrowRight', 1, 5, 3, false)).toBe(2);
    expect(nextTileIndex('ArrowRight', 4, 5, 3, false)).toBe(4);
  });
  it('up and down move a row; Home and End jump', () => {
    expect(nextTileIndex('ArrowDown', 0, 8, 3, true)).toBe(3);
    expect(nextTileIndex('ArrowUp', 1, 8, 3, true)).toBe(0);
    expect(nextTileIndex('Home', 5, 8, 3, true)).toBe(0);
    expect(nextTileIndex('End', 5, 8, 3, true)).toBe(7);
    expect(nextTileIndex('a', 5, 8, 3, true)).toBeNull();
  });
});
