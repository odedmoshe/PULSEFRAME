/** The slope-aware tolerance of proof:grade (grade-verify C6) is pinned: changing a number here needs the lead, not a failing run. */
import { describe, expect, it } from 'vitest';
import { curveTolerance, NEUTRAL_OPAQUE_CODES, GENTLE_OPAQUE_CODES, GENTLE_STEP_MAX, GENTLE_TRANSLUCENT_CODES, localStep, maxStep, NotACheck, STEEP_BASE_CODES, STEEP_STEP_MIN, straightFromPremultiplied } from './grade-proof.tolerance.ts';

describe('grade proof tolerance', () => {
  it('pins the numbers', () => {
    expect([NEUTRAL_OPAQUE_CODES, GENTLE_STEP_MAX, STEEP_STEP_MIN, GENTLE_OPAQUE_CODES, GENTLE_TRANSLUCENT_CODES, STEEP_BASE_CODES]).toEqual([1, 3, 40, 2, 3, 0.5]);
  });
  it('gives 2 / 3 codes on gentle curves and 0.5 + S·δ₀ on steep opaque pixels', () => {
    expect(curveTolerance('gentle-opaque', 3)).toBe(2);
    expect(curveTolerance('gentle-translucent', 1)).toBe(3);
    expect(curveTolerance('steep-opaque', 88, 0.01)).toBeCloseTo(1.38, 10);
  });
  it('refuses to be a check outside its bands: no translucent-steep, no middle slopes, no steep without a measured δ₀', () => {
    expect(() => curveTolerance('gentle-opaque', 4)).toThrow(NotACheck);
    expect(() => curveTolerance('gentle-translucent', 40)).toThrow(NotACheck);
    expect(() => curveTolerance('steep-opaque', 39, 0.01)).toThrow(NotACheck);
    expect(() => curveTolerance('steep-opaque', 88)).toThrow(NotACheck);
    expect(() => curveTolerance('steep-opaque', 88, Number.NaN)).toThrow(NotACheck);
  });
  it('reads steps the way the pass reads the table, and un-premultiplies the 8-bit value', () => {
    const t = Array.from({ length: 256 }, (_, v) => (v < 124 ? 0 : v > 128 ? 255 : [0, 40, 128, 215, 255][v - 124]!));
    expect(maxStep(t)).toBe(88);
    expect(localStep(t, 126 / 255)).toBe(88);
    expect(localStep(t, 1)).toBe(0);
    expect(straightFromPremultiplied(64, 128)).toBe(0.5);
    expect(straightFromPremultiplied(200, 128)).toBe(1);
    expect(() => straightFromPremultiplied(1, 0)).toThrow(RangeError);
  });
});
