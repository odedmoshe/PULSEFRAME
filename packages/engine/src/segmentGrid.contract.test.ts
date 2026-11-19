/**
 * The lead's contract for the segment grid (ADR-0024, plan "Verifier" [high] #1 and corrected note C), checked against W1's
 * bodies once they exist; skipped while segmentGrid.ts still holds the lead stubs. W1's own segmentGrid.test.ts adds more.
 * The low rates are here on purpose: any positive project rate is valid (core RateSchema, the REST NewProject route), and at
 * 1/1 or 1/2 two seconds is 2 or 1 frames, so without the MIN_SEGMENT_FRAMES floor on segFrames every interior cell would be a
 * 1–2 frame segment, which the stream-copy join cannot join exactly (it loses a frame).
 */
import { describe, expect, it } from 'vitest';
import { MIN_SEGMENT_FRAMES, SEGMENT_SECONDS } from '@pulseframe/core';
import { segmentFrames, segmentGrid } from './segmentGrid.ts';

const built = (() => { try { segmentFrames({ num: 30, den: 1 }); return true; } catch { return false; } })();

/** The rates the property runs over: common ones, both sides of 1.25 fps (where 2 s rounds to 2 or 3 frames), and very low ones. */
const RATES = [[30000, 1001], [24000, 1001], [25, 1], [60, 1], [5, 4], [6, 5], [1, 1], [1, 2], [1, 3], [3, 4], [1, 1000]] as const;

/** Small deterministic generator (mulberry32), so a failure names a reproducible case. */
function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe.skipIf(!built)('segment grid contract (ADR-0024)', () => {
  it('segFrames is 2 seconds of frames with a floor of MIN_SEGMENT_FRAMES', () => {
    expect(segmentFrames({ num: 30000, den: 1001 })).toBe(60);
    expect(segmentFrames({ num: 24000, den: 1001 })).toBe(48);
    expect(segmentFrames({ num: 25, den: 1 })).toBe(50);
    expect(segmentFrames({ num: 5, den: 4 })).toBe(3);
    expect(segmentFrames({ num: 1, den: 1 })).toBe(MIN_SEGMENT_FRAMES);
    expect(segmentFrames({ num: 1, den: 2 })).toBe(MIN_SEGMENT_FRAMES);
    for (const [num, den] of RATES) expect(segmentFrames({ num, den })).toBe(Math.max(MIN_SEGMENT_FRAMES, Math.round((SEGMENT_SECONDS * num) / den)));
  });
  it('at 1 fps, 7 frames are two segments of 3 and 4 frames (not 2, 2, 3)', () => {
    const seg = segmentFrames({ num: 1, den: 1 });
    expect(segmentGrid(0, 7, seg).map((s) => s.frames)).toEqual([3, 4]);
  });
  it('over every rate and random ranges: exact cover in order, no segment under 3 frames unless alone, untouched cells equal the grid', () => {
    const next = rng(24);
    for (const [num, den] of RATES) {
      const seg = segmentFrames({ num, den });
      const cases: [number, number][] = [[0, 1], [0, 2], [seg - 1, 2], [seg - 2, 4], [seg - 2, seg + 4], [1, seg * 3 + 1], [0, seg * 5 + 2]];
      for (let i = 0; i < 60; i++) cases.push([Math.floor(next() * seg * 6), 1 + Math.floor(next() * seg * 8)]);
      for (const [firstFrame, frames] of cases) {
        const label = `${num}/${den} segFrames ${seg} range ${firstFrame}+${frames}`;
        const g = segmentGrid(firstFrame, frames, seg);
        let at = 0;
        for (const s of g) {
          expect(s.first, label).toBe(at);
          expect(s.index, label).toBe(Math.floor((firstFrame + s.first) / seg));
          if (g.length > 1) expect(s.frames, label).toBeGreaterThanOrEqual(MIN_SEGMENT_FRAMES);
          expect(s.frames, label).toBeLessThanOrEqual(Math.max(seg + 4, frames <= 2 ? frames : 0));
          const a = firstFrame + s.first;
          // a segment that starts and ends on the grid is exactly one cell, the same cell a full export has
          if (a % seg === 0 && (a + s.frames) % seg === 0) expect(s.frames, label).toBe(seg);
          at += s.frames;
        }
        expect(at, label).toBe(frames);
        if (frames <= 2) expect(g, label).toHaveLength(1);
      }
    }
  });
});
