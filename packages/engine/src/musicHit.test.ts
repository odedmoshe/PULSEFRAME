import { describe, expect, it } from 'vitest';
import type { BeatPosition } from '@pulseframe/core';
import { motionAt, musicHit, STROBE_MIN_GAP } from './gpu.ts';

/**
 * A moment `position` beats into music whose beats are `period` seconds apart from timeline second 0, with the beats
 * around it listed as the beat grid lists them (two seconds each way). `meter` > 0 gives the music bars of that many beats.
 */
const at = (position: number, period = 0.5, meter = 0, musicBefore: number | null = null): BeatPosition => {
  const now = position * period, hits: BeatPosition['hits'] = [];
  for (let k = Math.max(0, Math.ceil((now - 2) / period - 1e-9)); k * period <= now + 2 + 1e-9; k++) hits.push({ t: k * period, index: k });
  return { clipId: 'c', beat: position, sinceBar: meter ? position - Math.floor(position / meter + 1e-9) * meter : position, period, sinceFirstBar: position, at: now, hits, musicBefore };
};
/** The moments (seconds) at which a strobe following this music starts a flash, found by walking through `seconds` of it in steps of a millisecond. */
function flashTimes(p: Record<string, unknown>, period: number, meter: number, seconds: number, musicBefore: number | null = null): number[] {
  const out: number[] = [];
  let before = Infinity;
  for (let ms = 0; ms <= seconds * 1000; ms++) {
    const since = musicHit(p, at(ms / 1000 / period, period, meter, musicBefore), STROBE_MIN_GAP)!.since;
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
  it('a hit close after another one does not count, whatever the thinning decided; nor does one right after other music stopped', () => {
    // beats half a second apart with an extra one 0.1 s after two of them, then (from second 10) a few 0.35 s apart with
    // two more squeezed in 0.2 s apart: the median gap is fine nearly everywhere, so next to nothing is thinned, but a
    // hit less than a third of a second after another hit is dropped
    const beats = [...Array.from({ length: 12 }, (_, k) => k * 0.5), 1.1, 3.1, 10, 10.35, 10.7, 10.9, 11.1, 11.45, 11.8].sort((x, y) => x - y);
    const uneven = (now: number): BeatPosition => ({ clipId: 'c', beat: 0, sinceBar: 0, period: 0.5, sinceFirstBar: 0, at: now, hits: beats.map((t, index) => ({ t, index })).filter((h) => Math.abs(h.t - now) <= 2), musicBefore: null });
    const starts = new Set<number>();
    for (let ms = 0; ms <= 13000; ms++) { const since = musicHit({ follow: 'music' }, uneven(ms / 1000), STROBE_MIN_GAP)!.since; if (Number.isFinite(since)) starts.add(Number((ms / 1000 - since).toFixed(6))); }
    // 1.1 and 3.1 are dropped; so is 10.9 (0.2 s after 10.7), and 11.1 too: 10.9 lies 0.2 s before it, although 10.9
    // itself did not count. 11.45 is thinned out (around it only every second hit is kept).
    expect([...starts]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 10, 10.35, 10.7, 11.8]);
    // other music was followed until second 1: this music's hits at 1.0 and 1.25 are too close to it, 1.5 is the first that counts
    expect(flashTimes({ follow: 'music' }, 0.5, 4, 3, 1).filter((t) => t >= 0)).toEqual([1.5, 2, 2.5, 3]);
    expect(musicHit({ follow: 'music' }, at(2.4, 0.5, 4, 1), STROBE_MIN_GAP)!.since).toBe(Infinity); // 1.2 s: nothing has counted yet
    expect(musicHit({ follow: 'music' }, at(2.4, 0.5, 4), STROBE_MIN_GAP)!.since).toBeCloseTo(0.2, 9);
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
