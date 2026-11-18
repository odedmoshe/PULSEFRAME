/**
 * The keys baseline (ADR-0019 step 0; keys-baseline.lib.ts) samples what it says: the five v1 easings at 2000 distinct rational
 * times, frames at five rates, shutter taps and times outside the keys. The comparison with docs/evidence/keys-baseline.json is
 * `pnpm baseline:keys --check` (the lead records it before W1 changes animation.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { V1_EASINGS } from '@pulseframe/core';
import { baselineKeys, baselineTimes, float64Hex, keysBaseline } from './keys-baseline.lib.ts';

describe('keys baseline', () => {
  it('2000 distinct times, before, inside and after the keys; five easings; Float64 bits in hex', () => {
    const ts = baselineTimes();
    expect(ts).toHaveLength(2000);
    expect(new Set(ts.map((t) => T.toSeconds(t))).size).toBeGreaterThan(1500);
    const keys = baselineKeys('linear');
    expect(ts.some((t) => T.lt(t, keys[0]!.time))).toBe(true);
    expect(ts.some((t) => T.lt(keys[keys.length - 1]!.time, t))).toBe(true);
    const r = keysBaseline();
    expect(Object.keys(r.samples)).toEqual([...V1_EASINGS]);
    for (const e of V1_EASINGS) expect(r.samples[e]).toHaveLength(2000);
    expect(float64Hex(1)).toBe('3ff0000000000000');
    expect(float64Hex(-0)).not.toBe(float64Hex(0));
  });
});
