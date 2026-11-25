/**
 * Track send (wave 7), engine contract: the limiter's ceiling sits on the 16-bit grid; the plan carries the limiter only when the
 * project has one. The it.todo rows name what workers A (limiter, sound checks) and B (picture checks) must make pass.
 */
import { describe, expect, it } from 'vitest';
import { createProject } from '@pulseframe/core';
import { audioPlan } from './audio.ts';
import { limiterCeilingLinear, limiterWindow } from './masterLimiter.ts';

describe('send: engine contract', () => {
  it('the ceiling, written to 16 bits, never rounds above itself', () => {
    for (let tenth = -90; tenth <= 0; tenth++) {
      const db = tenth / 10, c = limiterCeilingLinear(db);
      expect(Math.round(c * 32768), `${db}`).toBeLessThanOrEqual(Math.floor(10 ** (db / 20) * 32767));
      expect(c).toBeLessThanOrEqual(10 ** (db / 20));
    }
    expect(limiterWindow(48000)).toEqual({ lookahead: 240, release: 5760 });
  });
  it('AudioPlan.limiter is present only when settings.limiter is', () => {
    const doc = createProject({ id: 'prj_sl', name: 'sl' });
    expect('limiter' in audioPlan(doc)).toBe(false);
    expect(audioPlan({ ...doc, settings: { ...doc.settings, limiter: { ceiling: -1 } } }).limiter).toEqual({ ceiling: -1 });
  });
  it.todo('A: MasterLimiter: a property test finds no output sample over limiterCeilingLinear(ceiling) (masterLimiter.test.ts)');
  it.todo('A: MasterLimiter: samples more than lookahead + release after the last limited sample equal the delayed input bit for bit');
  it.todo('A: MasterLimiter: the same seeded input gives the same hash as public/pf-master-limiter.js (selftest page, proof L6)');
  it.todo('A: SoundCheck: 3 full-scale samples in a 0.1 s block are clipped, 2 are not; −60 dBFS RMS for 2 s is silence, 1.9 s is not (soundCheck.test.ts)');
  it.todo('B: PictureCheck: 15 black frames at 30 fps are found, 14 are not; frozen only while moving (pictureCheck.test.ts)');
});
