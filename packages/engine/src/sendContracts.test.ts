/**
 * Track send (wave 7), engine contract: the limiter's ceiling sits on the 16-bit grid; the plan carries the limiter only when the
 * project has one. What workers A and B built is tested in masterLimiter.test.ts, soundCheck.test.ts and pictureCheck.test.ts.
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
});
