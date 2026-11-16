import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_ANIMATION, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type TextAnimation } from '@pulseframe/core';
import { textAtRest, unitPose, unitProgress } from './textAnimation.ts';

const at = (a: Partial<TextAnimation>, local: number, total = 4) => ({ ...DEFAULT_TEXT_ANIMATION, ...a, local, total, fps: 30 });
const REST = { alpha: 1, dx: 0, dy: 0, scale: 1 };

describe('text animation as numbers', () => {
  it('units start one after another and all finish exactly when the phase ends', () => {
    const n = 8, length = 1;
    for (let i = 1; i < n; i++) expect(unitProgress(i, n, 0.3, length)).toBeLessThanOrEqual(unitProgress(i - 1, n, 0.3, length)); // later units are behind
    expect(unitProgress(0, n, 0, length)).toBe(0);
    for (let i = 0; i < n; i++) { expect(unitProgress(i, n, length, length)).toBe(1); expect(unitProgress(i, n, 0, length)).toBe(0); }
    expect(unitProgress(n - 1, n, length - 1e-6, length)).toBeLessThan(1);
    expect(unitProgress(0, 1, 0.5, 1)).toBe(0.5); // a single unit takes the whole phase
  });
  it('every entrance ends at rest, every exit starts at rest and ends invisible; in between the title is at rest', () => {
    for (const kind of TEXT_ANIM_IN) {
      const a = { in: kind, inFrames: 30 };
      for (let i = 0; i < 5; i++) expect(unitPose(at(a, 1), i, 5, false), kind).toEqual(REST);
      expect(textAtRest(at(a, 1))).toBe(true);
      expect(textAtRest(at(a, 0.5))).toBe(false);
      const early = unitPose(at(a, 0.01), 4, 5, false);
      expect(early.alpha, kind).toBe(0); // the last unit has not begun
    }
    for (const kind of TEXT_ANIM_OUT) {
      const a = { out: kind, outFrames: 30 };
      for (let i = 0; i < 5; i++) { expect(unitPose(at(a, 3), i, 5, false), kind).toEqual(REST); expect(unitPose(at(a, 4), i, 5, false).alpha, kind).toBe(0); }
      expect(textAtRest(at(a, 3))).toBe(true);
      expect(textAtRest(at(a, 3.5))).toBe(false);
    }
    expect(textAtRest(at({ in: 'fade', out: 'fade', inFrames: 30, outFrames: 30 }, 2))).toBe(true);
  });
  it('typewriter shows whole units only, in reading order; a slide comes from the side reading starts on', () => {
    const a = { in: 'typewriter' as const, inFrames: 30 };
    const shown = (t: number) => Array.from({ length: 10 }, (_, i) => unitPose(at(a, t), i, 10, false).alpha);
    expect(shown(0)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(shown(0.5)).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(shown(1).every((x) => x === 1)).toBe(true);
    expect(unitPose(at({ in: 'slide', inFrames: 30 }, 0.1), 0, 3, false).dx).toBeLessThan(0); // English: from the left
    expect(unitPose(at({ in: 'slide', inFrames: 30 }, 0.1), 0, 3, true).dx).toBeGreaterThan(0); // Hebrew: from the right
    expect(unitPose(at({ out: 'slide', outFrames: 30 }, 3.8), 0, 3, true).dx).toBeLessThan(0); // and leaves toward the left
  });
  it('a loop never rests, stays small, repeats exactly for the same moment, and differs between units', () => {
    for (const kind of TEXT_ANIM_LOOP) {
      const a = { loop: kind };
      expect(textAtRest(at(a, 2))).toBe(false);
      const p = unitPose(at(a, 1.234), 3, 9, false), q = unitPose(at(a, 1.234), 3, 9, false), other = unitPose(at(a, 1.234), 4, 9, false);
      expect(p).toEqual(q);
      expect(p).not.toEqual(other);
      expect(p.alpha).toBe(1);
      expect(Math.abs(p.dx) <= 0.2 && Math.abs(p.dy) <= 0.2 && Math.abs(p.scale - 1) <= 0.1, kind).toBe(true);
    }
  });
  it('the pop overshoots once and settles at exactly full size', () => {
    const a = { in: 'pop' as const, inFrames: 30 };
    const scales = Array.from({ length: 31 }, (_, f) => unitPose(at(a, f / 30), 0, 1, false).scale);
    expect(Math.max(...scales)).toBeGreaterThan(1.02);
    expect(scales[30]).toBe(1);
    expect(scales[0]).toBeLessThan(0.5);
  });
});
