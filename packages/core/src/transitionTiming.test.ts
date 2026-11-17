/**
 * Timing of transitions (ADR-0012, transitionTiming.ts). The exhaustive properties are W1's (the todos below); what is
 * here pins the one promise the contracts rely on: without a beat lock, progress is exactly the value it always had.
 */
import { describe, expect, it } from 'vitest';
import { smooth, switchFrame, transitionProgress } from './transitionTiming.ts';

describe('transition timing', () => {
  it('without a beat lock, progress is bit-equal to the ease every transition had before, and switchFrame is the old middle', () => {
    for (let n = 1; n <= 150; n++) for (let l = 0; l < n; l++) expect(transitionProgress(l, n, null)).toBe(smooth((l + 1) / (n + 1)));
    for (const n of [1, 2, 3, 29, 30]) expect(switchFrame(n, null)).toBe(Math.ceil((n - 1) / 2));
  });
  it.todo('for n = 1..150 and every k in 1..n−1: progress strictly increasing, inside (0,1); switchFrame is the first frame with p >= 0.5 (W1)');
  it.todo('velocity for v = 2, 3, 4 and n = 1..150: l + out and l − in strictly increasing; in(n−1) = 0; max(l + out) + 1 = outFrames and in(0) = headFrames (W1)');
  it.todo('lightEnvelope is 1 on the switch frame, 0 outside D frames, symmetric, and 1 for n = 1 (W1)');
  it.todo('beatSwitchFrame with beats at frames 70, 75, 80 and the window 60..88 returns 15; a tie returns the earlier beat (W1)');
});
