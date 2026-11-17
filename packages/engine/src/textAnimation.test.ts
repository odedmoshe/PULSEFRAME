import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_ANIMATION, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type TextAnimation } from '@pulseframe/core';
import { mixesDirections, pieceRects, textAtRest, unitPose, unitProgress, unitRanges, widenStretches } from './textAnimation.ts';

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
      // the exit is the last 30 frames of the 120: the frame before them (frame 89) is at rest, the last frame (119) shows nothing
      for (let i = 0; i < 5; i++) { expect(unitPose(at(a, 89 / 30), i, 5, false), kind).toEqual(REST); expect(unitPose(at(a, 119 / 30), i, 5, false).alpha, kind).toBe(0); expect(unitPose(at(a, 4), i, 5, false).alpha, kind).toBe(0); }
      expect(textAtRest(at(a, 89 / 30))).toBe(true);
      expect(textAtRest(at(a, 3))).toBe(false);
      expect(textAtRest(at(a, 3.5))).toBe(false);
      expect(unitPose(at(a, 3), 0, 5, false).alpha, kind).toBeLessThan(1); // frame 90: the first unit has begun to leave
      expect(unitPose(at(a, 3), 4, 5, false), kind).toEqual(REST); // the last one not yet
    }
    expect(textAtRest(at({ in: 'fade', out: 'fade', inFrames: 30, outFrames: 30 }, 2))).toBe(true);
  });
  it('an exit is complete on the last frame that is rendered, and an entrance shows its first step on the first', () => {
    const frame = (a: Partial<TextAnimation>, k: number, total = 4) => at(a, k / 30, total); // frame k of a 120-frame title
    // (reported) the last frame of the clip is one frame before its end: every unit must be gone there, whatever the kind and count
    for (const kind of TEXT_ANIM_OUT) for (const n of [1, 2, 3, 7, 30]) for (const count of [1, 2, 9]) {
      const a = { out: kind, outFrames: n };
      for (let i = 0; i < count; i++) expect(unitPose(frame(a, 119), i, count, false).alpha, `${kind} ${n} frames, unit ${i} of ${count}`).toBe(0);
      for (let i = 0; i < count; i++) expect(unitPose(frame(a, 119 - n), i, count, false), `${kind} ${n}`).toEqual(REST); // and nothing has moved on the frame before the exit
      expect(textAtRest(frame(a, 119 - n))).toBe(true);
      expect(textAtRest(frame(a, 120 - n))).toBe(false);
    }
    // a one-frame exit (it used to do nothing): the title is gone on the last frame
    expect(unitPose(frame({ out: 'fade', outFrames: 1 }, 119), 0, 1, false).alpha).toBe(0);
    expect(unitPose(frame({ out: 'fade', outFrames: 1 }, 118), 0, 1, false)).toEqual(REST);
    // a three-frame fade of one unit, out and in: thirds
    const fade = (a: Partial<TextAnimation>, k: number) => unitPose(frame(a, k), 0, 1, false).alpha;
    expect([116, 117, 118, 119].map((k) => fade({ out: 'fade', outFrames: 3 }, k))).toEqual([1, 2 / 3, 1 / 3, 0].map((x) => expect.closeTo(x, 9)));
    expect([0, 1, 2, 3].map((k) => fade({ in: 'fade', inFrames: 3 }, k))).toEqual([1 / 3, 2 / 3, 1, 1].map((x) => expect.closeTo(x, 9)));
    // the first frame of every entrance already shows something of the first unit; the entrance is at rest on its last frame
    for (const kind of TEXT_ANIM_IN) for (const n of [1, 2, 5, 30]) {
      const a = { in: kind, inFrames: n };
      expect(unitPose(frame(a, 0), 0, 6, false).alpha, `${kind} ${n}`).toBeGreaterThan(0);
      if (kind !== 'typewriter') {
        for (let i = 0; i < 6; i++) expect(unitPose(frame(a, n - 1), i, 6, false), `${kind} ${n}`).toEqual(REST);
        expect(textAtRest(frame(a, n - 1))).toBe(true);
        if (n > 1) expect(textAtRest(frame(a, n - 2))).toBe(false);
      }
    }
    // the typewriter keeps its own timing: one unit on the first frame, the last one on the last frame of the entrance
    const typed = (k: number) => Array.from({ length: 5 }, (_, i) => unitPose(frame({ in: 'typewriter', inFrames: 10 }, k), i, 5, false).alpha);
    expect(typed(0)).toEqual([1, 0, 0, 0, 0]); expect(typed(7)).toEqual([1, 1, 1, 1, 0]); expect(typed(8)).toEqual([1, 1, 1, 1, 1]);
    expect(textAtRest(frame({ in: 'typewriter', inFrames: 10 }, 9))).toBe(false); expect(textAtRest(frame({ in: 'typewriter', inFrames: 10 }, 10))).toBe(true);
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

describe('titles with both writing directions in one line', () => {
  const letters = (w: string) => Array.from(w);
  it('a line is mixed when it has Hebrew (or Arabic) letters and Latin, Greek or Cyrillic letters; digits and marks alone do not mix it', () => {
    for (const line of ['קנו iPhone 15 עכשיו', 'מבצע Black Friday!', 'ראיתי Netflix: אתמול', 'I said שלום! today', 'iPhoneשל', 'مرحبا world', 'Привет שלום']) expect(mixesDirections(line), line).toBe(true);
    for (const line of ['שלום עולם', 'ONE TWO THREE', 'קנו 15 עכשיו!', 'עד 50% הנחה', '12:30 – 14:00', 'Hello, world! (2)', '']) expect(mixesDirections(line), line).toBe(false);
  });
  it('the pieces of a line are its words or its letters, in reading order, without the spaces', () => {
    const line = 'קנו iPhone 15';
    expect(unitRanges(line, 'word', letters).map(([s, e]) => line.slice(s, e))).toEqual(['קנו', 'iPhone', '15']);
    expect(unitRanges(line, 'letter', letters).map(([s, e]) => line.slice(s, e)).join('')).toBe('קנוiPhone15');
    expect(unitRanges('a  b', 'word', letters)).toEqual([[0, 1], [3, 4]]); // two spaces
    expect(unitRanges('ab c', 'letter', (w) => (w === 'ab' ? ['ab'] : Array.from(w)))).toEqual([[0, 2], [3, 4]]); // a letter with its marks stays one piece
  });
  // A stand-in for the browser's answer: every character is 10 wide, and `order` gives the characters' places on screen from the left.
  const layout = (order: number[]) => ({ getSelectionRects: (start: number, end: number) => order.map((c, place) => ({ c, place })).filter((x) => x.c >= start && x.c < end).map((x) => ({ x: x.place * 10, width: 10 })) });
  it('the place of each piece is what the browser reports for it in the whole line, and a word may be in two places', () => {
    // "אב cd!" in a right-to-left line: on screen "!cd בא", so the logical characters 0…5 sit at places 6, 5, (space) 4, 2, 3, 1 → order by place:
    const line = 'אב cd!', metrics = layout([5, 3, 4, 2, 1, 0]);
    const words = pieceRects(metrics, line, unitRanges(line, 'word', letters), 60)!;
    expect(words[0]).toEqual([{ x: 40, width: 10 }, { x: 50, width: 10 }]); // the Hebrew word on the right
    expect(words[1]).toEqual([{ x: 0, width: 10 }, { x: 10, width: 10 }, { x: 20, width: 10 }]); // "cd!" with its "!" at the far left
    expect(pieceRects(metrics, line, unitRanges(line, 'letter', letters), 60)!.map((p) => p[0]!.x)).toEqual([50, 40, 10, 20, 0]);
  });
  it('without the browser method, or with answers that do not add up to the line, there are no places: the line then animates as one piece', () => {
    const line = 'אב cd!', ranges = unitRanges(line, 'word', letters);
    expect(pieceRects({ width: 60 }, line, ranges, 60)).toBeNull(); // the method does not exist
    expect(pieceRects(null, line, ranges, 60)).toBeNull();
    expect(pieceRects({ getSelectionRects: () => { throw new Error('no'); } }, line, ranges, 60)).toBeNull();
    expect(pieceRects({ getSelectionRects: () => [] }, line, ranges, 60)).toBeNull(); // a piece without a place
    expect(pieceRects(layout([5, 3, 4, 2, 1, 0]), line, ranges, 80)).toBeNull(); // the places cover less than the line
    expect(pieceRects({ getSelectionRects: (s: number, e: number) => [{ x: -30, width: (e - s) * 10 }] }, line, ranges, 60)).toBeNull(); // measured from somewhere else
    expect(pieceRects({ getSelectionRects: (s: number, e: number) => [{ x: 0, width: (e - s) * 10 }] }, line, ranges, 60)).toBeNull(); // everything on the same spot
    expect(pieceRects({ getSelectionRects: () => [{ x: Number.NaN, width: 10 }] }, line, ranges, 60)).toBeNull();
  });
  it('windows are widened into free space only: half of the gap to a neighbour, the full pad at the ends of the line, nothing where pieces touch', () => {
    const wide = widenStretches([[{ x: 0, width: 20 }], [{ x: 30, width: 20 }, { x: 50, width: 10 }], [{ x: 100, width: 10 }]], 8);
    expect(wide).toEqual([[{ x: -8, width: 33 }], [{ x: 25, width: 25 }, { x: 50, width: 18 }], [{ x: 92, width: 26 }]]);
  });
});
