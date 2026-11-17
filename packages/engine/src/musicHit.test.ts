import { describe, expect, it } from 'vitest';
import type { BeatPosition } from '@pulseframe/core';
import { motionAt, musicHit } from './gpu.ts';
/** A least gap between hits that count, as an effect may ask for: a little over a third of a second. */
const STROBE_MIN_GAP = (1 + Math.LN2 / 20) / 3 + 1e-6;

/**
 * A moment `position` beats into music whose beats are `period` seconds apart from timeline second 0, with the beats
 * around it listed as the beat grid lists them (two seconds each way). `meter` > 0 gives the music bars of that many beats.
 */
const at = (position: number, period = 0.5, meter = 0, followedFrom = -Infinity): BeatPosition => {
  const now = position * period, hits: BeatPosition['hits'] = [];
  for (let k = Math.max(0, Math.ceil((now - 2) / period - 1e-9)); k * period <= now + 2 + 1e-9; k++) hits.push({ t: k * period, index: k });
  return { clipId: 'c', beat: position, sinceBar: meter ? position - Math.floor(position / meter + 1e-9) * meter : position, period, sinceFirstBar: position, at: now, hits, followedFrom };
};
/** The moments (seconds) at which a strobe following this music starts a flash, found by walking through `seconds` of it in steps of a millisecond. */
function flashTimes(p: Record<string, unknown>, period: number, meter: number, seconds: number): number[] {
  const out: number[] = [];
  let before = Infinity;
  for (let ms = 0; ms <= seconds * 1000; ms++) {
    const since = musicHit(p, at(ms / 1000 / period, period, meter), STROBE_MIN_GAP)!.since;
    if (since < before) out.push(Number((ms / 1000 - since).toFixed(6)));
    before = since;
  }
  return out;
}

describe('effects that follow the music', () => {
  it('a steady effect ignores the music; with no analysed music a following effect keeps its steady behaviour', () => {
    expect(musicHit({ follow: 'steady' }, at(3.2))).toBeNull();
    expect(musicHit({ follow: 'music' }, null)).toBeNull();
    const steady = motionAt('motion.pulse', { amount: 0.2, bpm: 120, decay: 6 }, 0.5);
    expect(motionAt('motion.pulse', { amount: 0.2, bpm: 120, decay: 6, follow: 'music' }, 0.5, null)).toEqual(steady);
  });
  it('the hit falls on the beat, on every Nth beat counted from the bar, and thins out when hits would come faster than allowed', () => {
    expect(musicHit({ follow: 'music' }, at(7))!.phase).toBeCloseTo(0, 9);
    expect(musicHit({ follow: 'music' }, at(7.25))!.phase).toBeCloseTo(0.25, 9);
    expect(musicHit({ follow: 'music', every: 2 }, at(3))!.phase).toBeCloseTo(0.5, 9); // beat 3 of the bar is half-way between hits on beats 2 and 4
    expect(musicHit({ follow: 'music', every: 2 }, at(4))!.phase).toBeCloseTo(0, 9);
    expect(musicHit({ follow: 'music', every: 2 }, at(4))!.period).toBeCloseTo(1, 9);
    // beats a quarter of a second apart are four a second: with at least a third of a second between hits only every second beat hits
    const thin = musicHit({ follow: 'music' }, at(5, 0.25), STROBE_MIN_GAP)!;
    expect(thin.period).toBeCloseTo(0.5, 9); expect(thin.phase).toBeCloseTo(0.5, 9); expect(thin.since).toBeCloseTo(0.25, 9);
    expect(1 / musicHit({ follow: 'music' }, at(5, 0.1), STROBE_MIN_GAP)!.period).toBeLessThanOrEqual(3 + 1e-9);
  });
  it('hits are counted from the first bar start and do not start again at each bar', () => {
    // every = 8 on four-beat bars: beat 4 is half-way between the hits on beats 0 and 8, not a hit (it used to be one)
    expect(at(4, 0.5, 4).sinceBar).toBeCloseTo(0, 9);
    expect(musicHit({ follow: 'music', every: 8 }, at(4, 0.5, 4))!.phase).toBeCloseTo(0.5, 9);
    expect(musicHit({ follow: 'music', every: 8 }, at(8, 0.5, 4))!.phase).toBeCloseTo(0, 9);
    expect(musicHit({ follow: 'music', every: 8 }, at(8, 0.5, 4))!.period).toBeCloseTo(4, 9);
    // every = 2 on three-beat bars: beats 0, 2, 4, 6…, an even second apart (they used to be 0, 2, 3, 5, 6…)
    expect(musicHit({ follow: 'music', every: 2 }, at(3, 0.5, 3))!.phase).toBeCloseTo(0.5, 9);
    expect(flashTimes({ follow: 'music', every: 2 }, 0.5, 3, 4)).toEqual([0, 1, 2, 3, 4]);
    // before the first bar start the count is negative, and still every second beat
    const early: BeatPosition = { ...at(0), sinceFirstBar: -3, hits: [{ t: -1.5, index: -3 }, { t: -1, index: -2 }, { t: -0.5, index: -1 }, { t: 0, index: 0 }], at: -1 };
    expect(musicHit({ follow: 'music', every: 2 }, { ...early, sinceFirstBar: -2 })!.phase).toBeCloseTo(0, 9);
    expect(musicHit({ follow: 'music', every: 2 }, early, STROBE_MIN_GAP)!.since).toBeCloseTo(0, 9); // at -1 s the hit is beat -2
    expect(musicHit({ follow: 'music', every: 2 }, { ...early, at: -0.6 }, STROBE_MIN_GAP)!.since).toBeCloseTo(0.4, 9); // beat -1 is not a hit
  });
  it('with a smallest gap, two hits that count are never closer than it: fast music with bars is thinned evenly across bar lines', () => {
    for (const [period, meter, every] of [[0.15, 4, 1], [0.2, 3, 1], [0.2, 3, 2], [0.156, 4, 1], [0.1, 4, 3], [1 / 3, 4, 1], [0.05, 4, 1]] as const) {
      const times = flashTimes({ follow: 'music', every }, period, meter, 12);
      const gaps = times.slice(1).map((t, i) => t - times[i]!);
      expect(times.length, `${period}`).toBeGreaterThan(12); // more than one flash a second: thinned, not silenced
      expect(Math.min(...gaps), `${period} s beats in bars of ${meter}, every ${every}`).toBeGreaterThanOrEqual(STROBE_MIN_GAP - 1e-6);
      expect(Math.max(...gaps) - Math.min(...gaps), `${period}`).toBeLessThan(3e-6); // and evenly: the same number of beats between all of them (the times here are rounded to a microsecond)
    }
    // 0.15 s beats: every third beat (0.45 s), also across the bar line where the count used to restart
    expect(flashTimes({ follow: 'music' }, 0.15, 4, 2)).toEqual([0, 0.45, 0.9, 1.35, 1.8]);
  });
  it('a hit close after another one does not count, whatever the thinning decided, also when the other one belongs to other music', () => {
    // beats half a second apart with an extra one 0.1 s after two of them, then (from second 10) a few 0.35 s apart with
    // two more squeezed in 0.2 s apart: the median gap is fine nearly everywhere, so next to nothing is thinned, but a
    // hit less than a third of a second after another hit is dropped
    const beats = [...Array.from({ length: 12 }, (_, k) => k * 0.5), 1.1, 3.1, 10, 10.35, 10.7, 10.9, 11.1, 11.45, 11.8].sort((x, y) => x - y);
    const uneven = (now: number): BeatPosition => ({ clipId: 'c', beat: 0, sinceBar: 0, period: 0.5, sinceFirstBar: 0, at: now, hits: beats.map((t, index) => ({ t, index })).filter((h) => Math.abs(h.t - now) <= 2), followedFrom: -Infinity });
    const starts = new Set<number>();
    for (let ms = 0; ms <= 13000; ms++) { const since = musicHit({ follow: 'music' }, uneven(ms / 1000), STROBE_MIN_GAP)!.since; if (Number.isFinite(since)) starts.add(Number((ms / 1000 - since).toFixed(6))); }
    // 1.1 and 3.1 are dropped; so is 10.9 (0.2 s after 10.7), and 11.1 too: 10.9 lies 0.2 s before it, although 10.9
    // itself did not count. 11.45 is thinned out (around it only every second hit is kept).
    expect([...starts]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 10, 10.35, 10.7, 11.8]);
    // 1.1 and 3.1 are less than the smallest gap after a hit; a third of a second is no longer enough: the gap leaves room for a flash that is first seen late
    expect(STROBE_MIN_GAP).toBeGreaterThan(1 / 3); expect(STROBE_MIN_GAP).toBeLessThan(0.345);
    // Other music was followed until second 1 and its last beat fell at 0.8 s (it is listed with its own number): that
    // beat and this music's beat at 1.0 are too close, and only one of them counts (which one follows from their
    // numbers). With that beat at 0.6 s instead, both count. (Before, every change of music silenced the next third of
    // a second whatever the beats were, also between two pieces of one cut clip.)
    const handOver = (last: number, number: number) => (now: number): BeatPosition => { const b = at(now / 0.5, 0.5, 4); return { ...b, hits: [{ t: last, index: number }, ...b.hits.filter((h) => h.t >= 1)].filter((h) => Math.abs(h.t - now) <= 2) }; };
    const startsOf = (position: (now: number) => BeatPosition) => { const out = new Set<number>(); for (let ms = 0; ms <= 3000; ms++) { const since = musicHit({ follow: 'music' }, position(ms / 1000), STROBE_MIN_GAP)!.since; if (Number.isFinite(since)) out.add(Number((ms / 1000 - since).toFixed(6))); } return [...out]; };
    expect(startsOf(handOver(0.8, 36))).toEqual([0.8, 1.5, 2, 2.5, 3]);
    expect(startsOf(handOver(0.8, 37))).toEqual([1, 1.5, 2, 2.5, 3]);
    expect(startsOf(handOver(0.6, 37))).toEqual([0.6, 1, 1.5, 2, 2.5, 3]);
    // a hit from before a moment without music is not picked up again when music is followed once more
    expect(musicHit({ follow: 'music' }, at(2.4, 0.5, 4), STROBE_MIN_GAP)!.since).toBeCloseTo(0.2, 9);
    expect(musicHit({ follow: 'music' }, at(2.4, 0.5, 4, 1.1), STROBE_MIN_GAP)!.since).toBe(Infinity); // followed again only since 1.1 s; the hit at 1.0 s was before that
    expect(musicHit({ follow: 'music' }, at(3.1, 0.5, 4, 1.1), STROBE_MIN_GAP)!.since).toBeCloseTo(0.05, 9); // the hit at 1.5 s is the first one after it
  });
  it('the zoom pulse is largest on a detected beat whatever the clock says, and a following shake dies away between hits', () => {
    const p = { amount: 0.2, bpm: 77, offset: 0, decay: 6, follow: 'music' };
    expect(motionAt('motion.pulse', p, 12.345, at(9)).scale).toBeCloseTo(1.2, 9);
    expect(motionAt('motion.pulse', p, 12.345, at(9.9)).scale).toBeLessThan(1.01);
    const s = { amount: 0.03, speed: 8, seed: 4, follow: 'music' };
    const onHit = motionAt('motion.shake', s, 1.234, at(2)), late = motionAt('motion.shake', s, 1.234, at(2.9)), steady = motionAt('motion.shake', { ...s, follow: 'steady' }, 1.234);
    expect(onHit).toEqual(steady); // on the hit it is the full, steady shake
    expect(Math.abs(late.dx)).toBeLessThan(Math.abs(onHit.dx) * 0.02 + 1e-12);
    expect(late.scale).toBe(onHit.scale); // the zoom that hides the edges does not pump
  });
});
