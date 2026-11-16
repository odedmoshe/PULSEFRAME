import { describe, expect, it } from 'vitest';
import { motionAt, musicHit } from './gpu.ts';

const at = (sinceBar: number, period = 0.5) => ({ clipId: 'c', beat: sinceBar, sinceBar, period });

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
    // beats a quarter of a second apart are four a second: with a ceiling of three a second only every second beat hits
    const thin = musicHit({ follow: 'music' }, at(5, 0.25), 3)!;
    expect(thin.period).toBeCloseTo(0.5, 9); expect(thin.phase).toBeCloseTo(0.5, 9);
    expect(1 / musicHit({ follow: 'music' }, at(5, 0.1), 3)!.period).toBeLessThanOrEqual(3 + 1e-9);
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
