import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { CURVES, CURVES_BUILT, sampleKeyframes, type CurveHandles, type Easing } from '@pulseframe/core';
import { CURVE_POINTS, TILE_RANGE, dragHandle, handleFromPoint, nudgeHandle, pointFromHandle, previewPoints, setHandleField, tilePoints, turnsBackLocal } from './curvePicker.math.ts';

const keys = (easing: Easing, bezier?: CurveHandles) => [{ time: T.rt(0, 1), value: 0, easing, ...(bezier ? { bezier } : {}) }, { time: T.rt(1, 1), value: 1, easing: 'linear' as const }];
const V1: Easing[] = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'];
const same = (a: readonly { y: number }[], b: readonly number[]) => a.every((p, i) => Object.is(p.y, b[i]));

describe('thumbnails come from the one sampler', () => {
  const sampled = (easing: Easing, bezier?: CurveHandles) => Array.from({ length: 41 }, (_, i) => sampleKeyframes(keys(easing, bezier), T.rt(i, 40), TILE_RANGE));
  it('41 points equal sampleKeyframes, Object.is (the earlier curves)', () => {
    for (const e of V1) { const p = tilePoints(e); expect(p).toHaveLength(CURVE_POINTS); expect(same(p, sampled(e))).toBe(true); expect(p[0]!.x).toBe(0); expect(p[40]!.x).toBe(1); }
  });
  it.skipIf(!CURVES_BUILT)('41 points equal sampleKeyframes for every curve of the library and a custom one', () => {
    for (const c of CURVES) expect(same(tilePoints(c.id), sampled(c.id))).toBe(true);
    const h: CurveHandles = [0.2, -0.5, 0.7, 1.5];
    expect(same(tilePoints('bezier', h), sampled('bezier', h))).toBe(true);
  });
  it('the preview is in channel units and stepped for an integer parameter', () => {
    const p = previewPoints('linear', undefined, { min: 0, max: 10 }, false);
    expect(p[20]!.y).toBeCloseTo(5, 9);
    const s = previewPoints('linear', undefined, { min: 0, max: 10 }, true);
    expect(s.every((q) => Number.isInteger(q.y))).toBe(true);
    expect(s[0]!.y).toBe(0); expect(s[40]!.y).toBe(10);
  });
});

describe('handle maths', () => {
  it('keeps x in [0, 1] and y in [−1, 2] for any pointer position (1e4 random)', () => {
    let a = 12345;
    const rnd = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    let h: CurveHandles = [0.25, 0.1, 0.75, 0.9];
    for (let i = 0; i < 10000; i++) {
      const which = (i % 2) as 0 | 1;
      h = dragHandle(h, which, (rnd() - 0.5) * 600, (rnd() - 0.5) * 600, 128);
      for (const j of [0, 2]) expect(h[j]!).toBeGreaterThanOrEqual(0), expect(h[j]!).toBeLessThanOrEqual(1);
      for (const j of [1, 3]) expect(h[j]!).toBeGreaterThanOrEqual(-1), expect(h[j]!).toBeLessThanOrEqual(2);
      h = nudgeHandle(h, which, (rnd() - 0.5) * 3, (rnd() - 0.5) * 6);
      expect(h[0]).toBeLessThanOrEqual(1); expect(h[3]).toBeGreaterThanOrEqual(-1); expect(h[3]).toBeLessThanOrEqual(2);
    }
  });
  it('maps the corners and round-trips a handle', () => {
    expect(handleFromPoint(0, 0, 128)).toEqual({ x: 0, y: 2 });
    expect(handleFromPoint(128, 128, 128)).toEqual({ x: 1, y: -1 });
    const p = pointFromHandle(0.4, 0.5, 128);
    expect(handleFromPoint(p.x, p.y, 128)).toEqual({ x: 0.4, y: 0.5 });
  });
  it('number inputs clamp and ignore text that is not a number', () => {
    const h: CurveHandles = [0.2, 0.2, 0.8, 0.8];
    expect(setHandleField(h, 0, '5')).toEqual([1, 0.2, 0.8, 0.8]);
    expect(setHandleField(h, 1, '-7')).toEqual([0.2, -1, 0.8, 0.8]);
    expect(setHandleField(h, 3, '9')).toEqual([0.2, 0.2, 0.8, 2]);
    expect(setHandleField(h, 1, '')).toBe(h);
    expect(setHandleField(h, 1, 'abc')).toBe(h);
  });
  it('knows which curves turn back', () => {
    expect(turnsBackLocal('overshoot')).toBe(true);
    expect(turnsBackLocal('smooth')).toBe(false);
    expect(turnsBackLocal('bezier', [0.2, 1.2, 0.8, 1])).toBe(true);
    expect(turnsBackLocal('bezier', [0.2, 0, 0.8, 1])).toBe(false);
    expect(CURVES.filter((c) => c.turnsBack).every((c) => turnsBackLocal(c.id))).toBe(true);
  });
});
