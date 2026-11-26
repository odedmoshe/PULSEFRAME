/**
 * proof:living's engine fixtures must be ones the product accepts: set_living_picture refuses a move faster than the comfort rule of
 * thumb (core livingMaxAmount, verifier C1), so a slide at amount 1 needs a clip long enough for it. The first integration run of the
 * proof failed every engine check on a 90-frame clip (max 0.32); this keeps the fixture and the rule in step.
 */
import { describe, expect, it } from 'vitest';
import { livingMaxAmount } from '@pulseframe/core';
import { LIVING_ENGINE_FIXTURE } from './living-proof.engine.ts';

describe('living proof fixtures', () => {
  it('the engine part\'s clip takes a slide at amount 1 with ease-in-out, and is the shortest that does (from 90 frames up)', () => {
    const { frames, fps } = LIVING_ENGINE_FIXTURE;
    expect(livingMaxAmount(frames, fps, 'slide', 'ease-in-out')).toBeGreaterThanOrEqual(1);
    expect(frames === 90 || livingMaxAmount(frames - 1, fps, 'slide', 'ease-in-out') < 1).toBe(true);
    expect(LIVING_ENGINE_FIXTURE.sample).toEqual({ mid: Math.round((frames - 1) / 2), last: frames - 1, quarters: [0, 1, 2, 3, 4].map((k) => Math.round((k * (frames - 1)) / 4)) });
  });
});
