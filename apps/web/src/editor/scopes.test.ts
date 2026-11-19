import { describe, expect, it } from 'vitest';
import { analyse } from './Scopes.tsx';

describe('scope analysis', () => {
  it('counts each channel, places luma by column, and reports range, average, crushed and clipped shares', () => {
    // 4 × 2: left half black, right half white on the top row; mid grey 128 on the bottom row, with one pure red pixel
    const px = (r: number, g: number, b: number) => [r, g, b, 255];
    const data = new Uint8ClampedArray([...px(0, 0, 0), ...px(0, 0, 0), ...px(255, 255, 255), ...px(255, 255, 255), ...px(128, 128, 128), ...px(128, 128, 128), ...px(128, 128, 128), ...px(255, 0, 0)]);
    const { hist, wave, stats } = analyse(data, 4, 2);
    expect([hist[0]![0], hist[0]![128], hist[0]![255]]).toEqual([2, 3, 3]);
    expect([hist[1]![0], hist[1]![128], hist[1]![255]]).toEqual([3, 3, 2]);
    expect(wave[0 * 256 + 0]).toBe(1);        // column 0 has one black pixel
    expect(wave[0 * 256 + 128]).toBe(1);      // and one grey
    expect(wave[3 * 256 + 255]).toBe(1);      // column 3: white
    expect(wave[3 * 256 + 54]).toBe(1);       // and red, whose BT.709 luma is 54
    expect(stats).toMatchObject({ min: 0, max: 255, mean: Math.round(((0 + 0 + 255 + 255 + 128 * 3 + 54) / 8) * 10) / 10, crushedPct: 25, clippedPct: 25 });
    // vectorscope: the seven grey-scale pixels sit in the centre; pure red lies up (Cr at its maximum) and left of centre (Cb negative)
    const { vec } = analyse(data, 4, 2);
    expect(vec[64 * 128 + 64]).toBe(7);
    const red = [...vec].findIndex((c, i) => c === 1 && i !== 64 * 128 + 64);
    expect([Math.floor(red / 128), red % 128]).toEqual([1, 50]);
    expect(stats.saturationPct).toBeCloseTo(((Math.hypot((0 - 54.2) / 1.8556, (255 - 54.2) / 1.5748) / 127.5) / 8) * 100, 0);
  });
  it('an empty picture gives zeros, not NaN', () => {
    expect(analyse(new Uint8ClampedArray(0), 0, 0).stats).toEqual({ min: 0, max: 0, mean: 0, crushedPct: 0, clippedPct: 0, saturationPct: 0 });
  });
});
