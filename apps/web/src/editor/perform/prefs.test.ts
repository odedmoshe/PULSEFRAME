import { describe, expect, it } from 'vitest';
import { DEFAULT_QUANTISE } from '@pulseframe/core';
import { PERFORM_PREFS_KEY } from './contract.ts';
import { calibrationState, defaultPrefs, loadPrefs, offsetSeconds, parsePrefs, savePrefs } from './prefs.ts';

const store = (text: string | null) => ({ getItem: (k: string) => (k === PERFORM_PREFS_KEY ? text : null) });

describe('perform prefs', () => {
  it('survives a corrupt value: not JSON, a number, an array, null', () => {
    for (const text of ['{nope', '7', '[]', 'null', '"x"', '']) expect(loadPrefs(store(text))).toEqual(defaultPrefs());
    expect(loadPrefs(store(null))).toEqual(defaultPrefs());
  });
  it('survives a storage that throws, and says so when it cannot save', () => {
    const boom = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(loadPrefs(boom)).toEqual(defaultPrefs());
    expect(savePrefs(defaultPrefs(), boom)).toBe(false);
    expect(savePrefs(defaultPrefs(), null)).toBe(false);
    const kept: Record<string, string> = {};
    expect(savePrefs(defaultPrefs(), { setItem: (k, v) => { kept[k] = v; } })).toBe(true);
    expect(JSON.parse(kept[PERFORM_PREFS_KEY]!)).toEqual(defaultPrefs());
  });
  it('keeps the good fields next to broken ones', () => {
    const p = parsePrefs({ tap: { offsetMs: 'x', outputLatencyMs: 10, calibratedAt: 'never' }, settings: { snap: 'half', tempo: 'double', strength: 0.5, parity: 1 }, noFlashes: 'yes', bankId: 'gpu', bank: [1, 2], camera: { settleSeconds: 99, leadSeconds: 0.2, sway: 0.5 } });
    expect(p.tap).toBeNull();
    expect(p.settings).toEqual({ snap: 'half', tempo: 'double', strength: 0.5, parity: 1 });
    expect(p.noFlashes).toBe(false);
    expect(p.bankId).toBe('gpu');
    expect(p.bank).toBeNull();
    expect(p.camera).toEqual({ settleSeconds: 0.6, leadSeconds: 0.2, sway: 0.5 });
  });
  it('round-trips a stored calibration and defaults to the decided snap (nearest beat, full strength)', () => {
    const d = defaultPrefs();
    expect(d.settings).toEqual(DEFAULT_QUANTISE);
    const p = parsePrefs({ ...d, tap: { offsetMs: 42.5, outputLatencyMs: 20, calibratedAt: '2026-11-18T10:00:00.000Z' } });
    expect(p.tap).toEqual({ offsetMs: 42.5, outputLatencyMs: 20, calibratedAt: '2026-11-18T10:00:00.000Z' });
  });
  it('is not calibrated until a calibration is stored, and again when the output latency drifts more than 20 ms', () => {
    const p = parsePrefs({ tap: { offsetMs: 40, outputLatencyMs: 30, calibratedAt: '2026-11-18T10:00:00.000Z' } });
    expect(calibrationState(defaultPrefs(), 30)).toEqual({ state: 'none' });
    expect(calibrationState(p, 30).state).toBe('ok');
    expect(calibrationState(p, null).state).toBe('ok');
    expect(calibrationState(p, 50).state).toBe('ok'); // exactly the limit
    expect(calibrationState(p, 50.5).state).toBe('stale');
    expect(offsetSeconds(calibrationState(p, 30))).toBeCloseTo(0.04, 9);
    expect(offsetSeconds(calibrationState(p, 90))).toBe(0);
    expect(offsetSeconds({ state: 'none' })).toBe(0);
  });
});
