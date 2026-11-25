/**
 * voiceActivity (W1; plan §4.1 with C6): the level measurement of a narration from synthetic waveform peaks (labelled test data,
 * built here as the waveform derivative would: min/max per 256 samples of a 48 kHz mono decode). The fixture times are the proof's
 * narration.wav table (story-decisions.md §4: bursts 0.5–3.0, 4.5–7.0, 8.2–13.0, 15.0–18.0, 18.3–23.5 s over a −60 dBFS floor).
 */
import { describe, expect, it } from 'vitest';
import { VOICE_ALGO, VOICE_RATE, VOICE_RULES, voiceOnsets } from './storyContract.ts';
import { isqrt, VOICE_ACTIVITY_BUILT, voiceActivity } from './voiceActivity.ts';

const BUCKET = VOICE_RULES.samplesPerBucket;
/** Seeded generator (mulberry32), test data only. */
function seeded(seed: number) {
  let a = seed | 0;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Peaks of a file of `seconds` with tone bursts (seconds, amplitude) over a floor of peak amplitude `floor` (0 = digital silence). */
function peaksOf(seconds: number, bursts: readonly [number, number][], o: { floor?: number; amp?: number; seed?: number } = {}) {
  const total = Math.round(seconds * VOICE_RATE), buckets = Math.ceil(total / BUCKET);
  const rnd = seeded(o.seed ?? 7), floor = o.floor ?? 33, amp = o.amp ?? 12_000;
  const peaks = new Int16Array(2 * buckets);
  const spans = bursts.map(([s, e]) => [Math.round(s * VOICE_RATE), Math.round(e * VOICE_RATE)] as const);
  let k = 0; // bursts are given in time order
  for (let b = 0; b < buckets; b++) {
    const from = b * BUCKET, to = Math.min(total, from + BUCKET);
    while (k < spans.length && spans[k]![1] <= from) k++;
    const loud = k < spans.length && spans[k]![0] < to;
    const v = loud ? amp - Math.floor(rnd() * 200) : floor ? Math.max(1, Math.round(floor * (0.6 + 0.8 * rnd()))) : 0;
    peaks[2 * b] = -v; peaks[2 * b + 1] = v;
  }
  return { peaks, total };
}
const NARRATION: [number, number][] = [[0.5, 3.0], [4.5, 7.0], [8.2, 13.0], [15.0, 18.0], [18.3, 23.5]];
const ms = (samples: number) => (samples * 1000) / VOICE_RATE;

describe('voiceActivity', () => {
  it('is built, and isqrt is exact', () => {
    expect(VOICE_ACTIVITY_BUILT).toBe(true);
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 99, 100, 101, 2 ** 30, 32768 * 32768, 32768 * 32768 - 1]) expect(isqrt(n)).toBe(Math.floor(Math.sqrt(n)) - (Math.floor(Math.sqrt(n)) ** 2 > n ? 1 : 0));
  });
  it('S1: the narration fixture gives four ranges, each start 0–90 ms before its burst, each end 0–150 ms after, the 0.3 s pause inside the fourth', () => {
    const { peaks, total } = peaksOf(24, NARRATION);
    const m = voiceActivity(peaks, total);
    expect(m.algo).toBe(VOICE_ALGO);
    expect(m.flat).toBe(false);
    expect(m.ranges).toHaveLength(4);
    const expected: [number, number][] = [[0.5, 3.0], [4.5, 7.0], [8.2, 13.0], [15.0, 23.5]];
    for (const [i, r] of m.ranges.entries()) {
      const [s, e] = expected[i]!;
      const before = s * 1000 - ms(r.start), after = ms(r.end) - e * 1000;
      expect({ i, before: before >= 0 && before <= 90, after: after >= 0 && after <= 150 }).toEqual({ i, before: true, after: true });
      expect(Number.isInteger(r.start) && Number.isInteger(r.end)).toBe(true);
    }
    // no edge inside a burst
    for (const r of m.ranges) for (const [s, e] of NARRATION) { expect(ms(r.start) > s * 1000 && ms(r.start) < e * 1000).toBe(false); expect(ms(r.end) > s * 1000 && ms(r.end) < e * 1000).toBe(false); }
    expect(ms(m.ranges[3]!.start) < 18_000 && ms(m.ranges[3]!.end) > 18_300).toBe(true);
    expect(Number.isInteger(m.noiseDb10) && Number.isInteger(m.voiceDb10)).toBe(true);
    expect(m.noiseDb10).toBeLessThan(-550);
    expect(m.voiceDb10).toBeGreaterThan(-100);
    expect(voiceOnsets(m)).toEqual(m.ranges.map((r) => r.start));
  });
  it('S1b, C6: digital silence between the bursts gives the same four ranges (the floor is clamped to 16, never 0)', () => {
    const noisy = peaksOf(24, NARRATION), gated = peaksOf(24, NARRATION, { floor: 0 });
    const g = voiceActivity(gated.peaks, gated.total);
    expect(g.flat).toBe(false);
    expect(g.ranges).toEqual(voiceActivity(noisy.peaks, noisy.total).ranges);
    expect(g.noiseDb10).toBe(Math.round(200 * Math.log10(VOICE_RULES.noiseClamp / 32768)));
  });
  it('S2: a steady noise, true silence, or a file too quiet is flat: no ranges, both levels given', () => {
    const steady = peaksOf(10, [], { floor: 3000 });
    const f = voiceActivity(steady.peaks, steady.total);
    expect(f).toMatchObject({ flat: true, ranges: [] });
    expect(f.noiseDb10).toBeLessThan(0);
    expect(voiceOnsets(f)).toEqual([]);
    const zero = peaksOf(5, [], { floor: 0 });
    expect(voiceActivity(zero.peaks, zero.total)).toMatchObject({ flat: true, ranges: [] });
    const quiet = peaksOf(10, [[2, 4]], { floor: 2, amp: 200 }); // −44 dBFS bursts: under the −40 dBFS minimum
    expect(voiceActivity(quiet.peaks, quiet.total)).toMatchObject({ flat: true, ranges: [] });
    expect(voiceActivity(new Int16Array(0), 0)).toMatchObject({ flat: true, ranges: [] });
  });
  it('a click shorter than 120 ms is dropped; a pause under 350 ms is bridged; a 1 s pause splits', () => {
    const { peaks, total } = peaksOf(12, [[1, 3], [3.25, 4], [6, 6.05], [8, 9], [10, 11]]);
    const m = voiceActivity(peaks, total);
    expect(m.ranges.map((r) => [Math.round(ms(r.start) / 100) / 10, Math.round(ms(r.end) / 100) / 10])).toEqual([[0.9, 4.1], [7.9, 9.1], [9.9, 11.1]]);
  });
  it('ranges are clamped to the file, the peaks past totalSamples are ignored, and the answer is the same every time', () => {
    const { peaks, total } = peaksOf(5, [[0, 1], [4, 5]]);
    const m = voiceActivity(peaks, total);
    expect(m.ranges[0]!.start).toBe(0);
    expect(m.ranges.at(-1)!.end).toBe(total);
    expect(voiceActivity(peaks, total)).toEqual(m);
    const cut = voiceActivity(peaks, 3 * VOICE_RATE);
    expect(cut.ranges.at(-1)!.end).toBeLessThanOrEqual(3 * VOICE_RATE);
  });
  it('at most 2000 ranges, then truncated', () => {
    const bursts: [number, number][] = Array.from({ length: 2100 }, (_, i) => [i * 0.8 + 0.2, i * 0.8 + 0.5]);
    const { peaks, total } = peaksOf(2100 * 0.8 + 1, bursts);
    const m = voiceActivity(peaks, total);
    expect(m.ranges).toHaveLength(VOICE_RULES.maxRanges);
    expect(m.truncated).toBe(true);
  });
});
