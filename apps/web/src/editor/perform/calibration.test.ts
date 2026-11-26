import { describe, expect, it } from 'vitest';
import { analyseCalibration, clickTimesMs, heardPerfMs, mad, median, outputLatencyMs, scheduleClicks, type ClickContext } from './calibration.ts';
import { CALIBRATION } from './contract.ts';

/** Seeded jitter (mulberry32): synthetic taps, never a person's. */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const clicks = clickTimesMs(1000);
const tapsAt = (offset: number, jitter: number, seed = 1, skip: (i: number) => boolean = () => false) => { const r = rng(seed); return clicks.flatMap((c, i) => (skip(i) ? [] : [c + offset + (r() * 2 - 1) * jitter])); };

describe('calibration statistics', () => {
  it('schedules 16 clicks 600 ms apart (100 BPM)', () => {
    expect(clicks).toHaveLength(CALIBRATION.clicks);
    expect(clicks[1]! - clicks[0]!).toBeCloseTo(600, 9);
    expect(clicks[15]! - clicks[0]!).toBeCloseTo(9000, 9);
  });
  it('median and median absolute deviation', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(mad([1, 2, 3, 4, 100])).toBe(1);
    expect(median([])).toBeNaN();
  });
  it('recovers a steady offset from taps 5 to 16 and ignores the first four', () => {
    // the first four taps are wild (the person is finding the beat); a 70 ms late tapper
    const taps = tapsAt(70, 8, 3).map((t, i) => (i < 4 ? t + 200 * (i % 2 ? 1 : -1) : t));
    const r = analyseCalibration(clicks, taps);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.offsetMs).toBeGreaterThan(62); expect(r.offsetMs).toBeLessThan(78); expect(r.used).toBe(12); expect(r.madMs).toBeLessThan(10); }
  });
  it('handles an early tapper (negative offset)', () => {
    const r = analyseCalibration(clicks, tapsAt(-35, 5, 9));
    expect(r.ok && r.offsetMs < -30 && r.offsetMs > -40).toBe(true);
  });
  it('rejects an unsteady run: a median absolute deviation over 40 ms', () => {
    const r = analyseCalibration(clicks, tapsAt(0, 140, 5));
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.reason).toBe('unsteady'); expect(r.madMs).toBeGreaterThan(40); }
  });
  it('accepts a deviation just under the limit and rejects just over (explicit offsets)', () => {
    const mk = (spread: number) => clicks.map((c, i) => c + (i % 2 ? spread : -spread)); // MAD = spread
    expect(analyseCalibration(clicks, mk(39)).ok).toBe(true);
    expect(analyseCalibration(clicks, mk(41)).ok).toBe(false);
  });
  it('rejects a run with too few counted taps (fewer than 8 of clicks 5 to 16)', () => {
    const r = analyseCalibration(clicks, tapsAt(20, 5, 2, (i) => i >= 4 && i < 10)); // six counted clicks without a tap
    expect(r).toMatchObject({ ok: false, reason: 'too_few', used: 6 });
    expect(analyseCalibration(clicks, [])).toMatchObject({ ok: false, reason: 'too_few', used: 0 });
  });
  it('a tap belongs to its nearest click (a tap 320 ms late is 280 ms early for the next click); a double tap counts once', () => {
    expect(analyseCalibration(clicks, clicks.map((c) => c + 320))).toMatchObject({ ok: true, offsetMs: -280 });
    const doubled = [...tapsAt(30, 3, 4), ...tapsAt(30, 3, 4).map((t) => t + 90)];
    const r = analyseCalibration(clicks, doubled);
    expect(r.ok && Math.abs(r.offsetMs - 30) < 6 && r.used === 12).toBe(true);
  });
});

describe('clicks on a context', () => {
  const fakeCtx = (): ClickContext & { starts: number[] } => {
    const starts: number[] = [];
    const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
    return {
      starts, currentTime: 5, outputLatency: 0.03, baseLatency: 0.01, destination: {},
      getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 20000 }),
      createOscillator: () => ({ frequency: { value: 0 }, connect: (n: unknown) => n, start: (w: number) => { starts.push(w); }, stop() {} }),
      createGain: () => ({ gain: param(), connect: (n: unknown) => n }),
    };
  };
  it('schedules 16 clicks on the context clock and maps them to performance time through the output timestamp', () => {
    const c = fakeCtx();
    const times = scheduleClicks(c, 1);
    expect(c.starts).toEqual(times);
    expect(times[0]).toBeCloseTo(6, 9);
    expect(times[15]! - times[0]!).toBeCloseTo(9, 9);
    expect(heardPerfMs(c, 6)).toBeCloseTo(21000, 6);
  });
  it('without an output timestamp the context clock less its output latency maps the click', () => {
    const c = { ...fakeCtx(), getOutputTimestamp: undefined };
    expect(heardPerfMs(c, 6, 10000)).toBeCloseTo(10000 + (6 - (5 - 0.03)) * 1000, 6);
  });
  it('states the output latency the way syncStats does (output + base, ms)', () => {
    expect(outputLatencyMs(fakeCtx())).toBe(40);
    expect(outputLatencyMs({})).toBe(0);
  });
});
