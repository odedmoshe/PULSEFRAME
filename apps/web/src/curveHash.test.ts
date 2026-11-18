/**
 * The cross-host curve hash (curveHash.ts; keyframes-proof P12 compares Chromium with Node). The sampling of the new curves
 * needs keyframe W1, so the hash itself is skipped, labelled, while curves.ts CURVES_BUILT is false.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { CURVES_BUILT, EASINGS, pathPoints, transformAt } from '@pulseframe/core';
import { CURVE_HASH_SAMPLES, curveHash, curveHashKeys, curveHashTime, curveSamples, pathPointsMs, pathTimingClip, ulpDistance } from './curveHash.ts';

describe('curve hash', () => {
  it('covers every easing and the shutter taps of 8 and 16, with frames before the first key', () => {
    expect(EASINGS).toHaveLength(13);
    const tss = new Set<number>();
    let before = 0;
    for (let i = 0; i < CURVE_HASH_SAMPLES; i += 97) { const t = curveHashTime(i); tss.add(t.timescale); if (T.isNegative(t)) before++; }
    expect(before).toBeGreaterThan(0);
    expect(curveHashTime(0)).toEqual(T.frameTime(-5, { num: 30, den: 1 }));
    expect(curveHashKeys('bezier').every((k) => k.bezier?.length === 4)).toBe(true);
    expect(curveHashKeys('linear').every((k) => k.bezier === undefined)).toBe(true);
  });
  it('ulpDistance counts representable doubles between two values, across zero too', () => {
    expect(ulpDistance(1, 1)).toBe(0);
    expect(ulpDistance(1, 1 + Number.EPSILON)).toBe(1);
    expect(ulpDistance(0.1, 0.1 + 2 * 2 ** -56)).toBe(2);
    expect(ulpDistance(0, -0)).toBe(1);
    expect(ulpDistance(5e-324, -5e-324)).toBe(3);
    expect(ulpDistance(-0.5, -0.5 - 2 ** -53)).toBe(1);
  });
  it('curveSamples are the samples the hash is taken of', async () => {
    const xs = curveSamples(), buf = new ArrayBuffer(xs.length * 8), v = new DataView(buf);
    xs.forEach((x, i) => v.setFloat64(i * 8, x, true));
    const hex = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buf)), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe((await curveHash()).sha256);
  });
  it.skipIf(!CURVES_BUILT)('is deterministic: two runs give the same SHA-256 of 100 000 samples', async () => {
    const a = await curveHash(), b = await curveHash();
    expect(a.samples).toBe(100_000);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.sha256).toBe(a.sha256);
  });
  it.skipIf(!CURVES_BUILT)('the timing clip: pathPoints gives 600 points equal to transformAt', () => {
    const clip = pathTimingClip();
    const pts = pathPoints(clip, { num: 30, den: 1 });
    expect(pts).toHaveLength(600);
    for (const p of pts) { const tr = transformAt(clip, T.frameTime(p.frame, { num: 30, den: 1 })); expect(Object.is(p.x, tr.x) && Object.is(p.y, tr.y)).toBe(true); }
    expect(pathPointsMs(3).points).toBe(600);
  });
});
