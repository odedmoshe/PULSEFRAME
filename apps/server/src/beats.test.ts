import { describe, expect, it } from 'vitest';
import { BEAT_SR, detectBeats } from './beats.ts';
import { beatF1, drumLoop } from './beats.fixtures.ts';

describe('beat tracking (synthetic drum loops)', () => {
  it.each([[90], [100], [120], [128], [140]])('finds %d BPM and its beat positions', (bpm) => {
    const { x, beats } = drumLoop(() => bpm, 24);
    const r = detectBeats(x);
    expect(Math.abs(r.bpm! - bpm)).toBeLessThan(1.5);
    expect(beatF1(r.beats, beats).f1).toBeGreaterThan(0.92);
    expect(r.confidence).toBeGreaterThan(0.2);
  });
  it('follows a slow tempo drift (120 → 127 BPM)', () => {
    const { x, beats } = drumLoop((t) => 120 + (7 * t) / 24, 24);
    expect(beatF1(detectBeats(x).beats, beats).f1).toBeGreaterThan(0.9);
  });
  it('beat times are accurate to about one analysis hop', () => {
    const { x, beats } = drumLoop(() => 120, 24);
    const found = detectBeats(x).beats;
    const errs = beats.map((b) => Math.min(...found.map((f) => Math.abs(f - b))));
    errs.sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(0.015);
  });
  it('is deterministic and reports nothing for silence or very short audio', () => {
    const { x } = drumLoop(() => 120, 12);
    expect(detectBeats(x)).toEqual(detectBeats(x));
    expect(detectBeats(new Float32Array(BEAT_SR * 10)).beats.length).toBeLessThanOrEqual(1);
    expect(detectBeats(new Float32Array(BEAT_SR * 10)).confidence).toBe(0);
    expect(detectBeats(new Float32Array(BEAT_SR * 2))).toEqual({ bpm: null, confidence: 0, beats: [] });
  });
});
