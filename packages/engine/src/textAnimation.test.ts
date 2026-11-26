import { describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_ANIMATION, TEXT_ANIM_IN, TEXT_ANIM_LOOP, TEXT_ANIM_OUT, type TextAnimation } from '@pulseframe/core';
import { hasArabicScript, needsLineLayout, pieceRects, textAtRest, unitPose, unitProgress, unitRanges, widenStretches, writeProgress } from './textAnimation.ts';

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

describe('blur and write-on (ADR-0012)', () => {
  const frame = (a: Partial<TextAnimation>, k: number, total = 4) => at(a, k / 30, total); // frame k of a 120-frame title
  it('the blur entrance sharpens monotonically to no blur at all, and is absent at rest; the blur exit is the same backwards', () => {
    for (const count of [1, 5]) for (const i of [0, count - 1]) {
      const blurs = Array.from({ length: 24 }, (_, k) => unitPose(frame({ in: 'blur', inFrames: 20 }, k), i, count, true).blur ?? 0);
      for (let k = 1; k < blurs.length; k++) expect(blurs[k]!, `unit ${i} of ${count}, frame ${k}`).toBeLessThanOrEqual(blurs[k - 1]!);
      expect(blurs[0]).toBeGreaterThan(0);
      expect(blurs[0]).toBeLessThanOrEqual(0.25);
      expect(blurs[19]).toBe(0); // the last frame of the entrance
      expect(unitPose(frame({ in: 'blur', inFrames: 20 }, 19), i, count, true)).toEqual(REST); // no blur field at all at rest
      const alphas = Array.from({ length: 21 }, (_, k) => unitPose(frame({ in: 'blur', inFrames: 20 }, k), i, count, true).alpha);
      for (let k = 1; k < alphas.length; k++) expect(alphas[k]!).toBeGreaterThanOrEqual(alphas[k - 1]!);
    }
    const out = Array.from({ length: 21 }, (_, k) => unitPose(frame({ out: 'blur', outFrames: 20 }, 99 + k), 0, 1, true));
    expect(out[0]).toEqual(REST); // frame 99: the frame before the exit
    for (let k = 1; k < out.length; k++) { expect(out[k]!.blur ?? 0).toBeGreaterThanOrEqual(out[k - 1]!.blur ?? 0); expect(out[k]!.alpha).toBeLessThanOrEqual(out[k - 1]!.alpha); }
    expect(out[20]!.alpha).toBe(0);
    expect(out[20]!.blur).toBeCloseTo(0.25, 12);
    expect(textAtRest(frame({ in: 'blur', inFrames: 20 }, 19))).toBe(true);
    expect(textAtRest(frame({ in: 'blur', inFrames: 20 }, 18))).toBe(false);
  });
  it('write-on: each unit takes its share of the entrance by its measured width, one after another; the shares add up to the whole', () => {
    const widths = [30, 10, 20, 40];
    // the shares: unit i is written from Σ_{j<i} w / Σw to Σ_{j≤i} w / Σw
    expect([0, 1, 2, 3].map((i) => writeProgress(widths, i, 0.3))).toEqual([1, 0, 0, 0]);
    expect(writeProgress(widths, 1, 0.35)).toBeCloseTo(0.5, 12);
    expect(writeProgress(widths, 2, 0.5)).toBeCloseTo(0.5, 12);
    expect([0, 1, 2, 3].map((i) => writeProgress(widths, i, 1))).toEqual([1, 1, 1, 1]);
    expect([0, 1, 2, 3].map((i) => writeProgress(widths, i, 0))).toEqual([0, 0, 0, 0]);
    for (const ws of [widths, [5], [1, 1, 1], [12.5, 0, 7, 33.1, 2], [0, 0]]) {
      const total = ws.reduce((a, b) => a + b, 0), share = (i: number) => (total > 0 ? ws[i]! / total : 1 / ws.length);
      expect(ws.reduce((n, _, i) => n + share(i), 0)).toBeCloseTo(1, 12); // the shares sum to 1
      for (let k = 0; k <= 200; k++) {
        const t = k / 200, r = ws.map((_, i) => writeProgress(ws, i, t));
        // written so far = t: the units are written at a steady pace, by width
        expect(r.reduce((n, x, i) => n + x * share(i), 0), `${ws} t=${t}`).toBeCloseTo(t, 9);
        // sequential: a unit starts only when every unit before it is complete
        for (let i = 1; i < r.length; i++) if (r[i]! > 0) expect(r[i - 1], `${ws} t=${t} unit ${i}`).toBe(1);
      }
    }
  });
  it('write-on poses: a unit not yet begun is invisible; a unit being written shows part of itself; at rest nothing is left of it', () => {
    const a = { in: 'write' as const, inFrames: 10, by: 'letter' as const };
    const widths = [20, 20, 20, 20];
    const pose = (k: number, i: number) => unitPose(frame(a, k), i, 4, true, widths);
    expect(pose(0, 0).alpha).toBe(1); expect(pose(0, 0).reveal).toBeCloseTo(0.4, 12); // frame 0 is step 1 of 10: 0.1 of the title = 0.4 of the first letter
    expect(pose(0, 1).alpha).toBe(0);
    expect(pose(3, 1).reveal).toBeCloseTo(0.6, 12); // 0.4 of the title
    for (let i = 0; i < 4; i++) expect(pose(9, i)).toEqual(REST);
    // without the widths every unit gets an equal share
    expect(unitPose(frame(a, 3), 1, 4, true).reveal).toBeCloseTo(0.6, 12);
  });
  it('textAtRest is unchanged for every entrance, exit and loop', () => {
    // the rule as it was before the blur and write-on entrances existed (the typewriter counts from the first frame)
    const before = (x: TextAnimation & { local: number; total: number; fps: number }) => {
      if (x.loop) return false;
      if (x.in && (x.in === 'typewriter' ? x.local : x.local + 1 / x.fps) < x.inFrames / x.fps - 1e-9) return false;
      if (x.out && x.local - (x.total - x.outFrames / x.fps) + 1 / x.fps > 1e-9) return false;
      return true;
    };
    for (const kind of [null, ...TEXT_ANIM_IN]) for (const out of [null, ...TEXT_ANIM_OUT]) for (const loop of [null, ...TEXT_ANIM_LOOP]) for (const n of [1, 7, 20]) for (let k = 0; k < 120; k += 3) {
      const x = frame({ in: kind, out, loop, inFrames: n, outFrames: n }, k);
      expect(textAtRest(x), `${kind}/${out}/${loop} ${n} frame ${k}`).toBe(before(x));
    }
  });
  it('Arabic script is found in any of its blocks; Hebrew and Latin are not it', () => {
    for (const t of ['مرحبا', 'abc ﻼ', 'ﭐ', 'ہ']) expect(hasArabicScript(t), t).toBe(true);
    for (const t of ['שלום', 'Hello', 'שָׁלוֹם 2026', '']) expect(hasArabicScript(t), t).toBe(false);
  });
});

describe('titles with both writing directions in one line', () => {
  const letters = (w: string) => Array.from(w);
  it('a line with letters of both directions needs the browser\'s layout, whichever way it is laid out and whatever animates', () => {
    for (const line of ['קנו iPhone 15 עכשיו', 'מבצע Black Friday!', 'ראיתי Netflix: אתמול', 'I said שלום! today', 'iPhoneשל', 'مرحبا world', 'Привет שלום'])
      for (const base of ['rtl', 'ltr'] as const) for (const by of ['word', 'letter'] as const) expect(needsLineLayout(line, base, by), `${line} ${base} ${by}`).toBe(true);
  });
  it('(reported) so does a line of one direction that is laid out in the other: the last line of a wrapped title, or a title set against its text', () => {
    // "מבצע ענק רק היום Black Friday!" wrapped so that "Friday!" is alone on the second line: the paragraph is right-to-left, and the "!" is shown on the left of Friday
    for (const by of ['word', 'letter'] as const) {
      expect(needsLineLayout('Friday!', 'rtl', by)).toBe(true);
      expect(needsLineLayout('החנות!', 'ltr', by)).toBe(true); // "Black Friday מבצע ענק על כל החנות!" wrapped: a left-to-right paragraph
      expect(needsLineLayout('שלום עולם!', 'ltr', by)).toBe(true); // direction set to ltr on a Hebrew title
      expect(needsLineLayout('Hello world!', 'rtl', by)).toBe(true); // direction set to rtl on an English title
      expect(needsLineLayout('Friday!', 'ltr', by)).toBe(false);
      expect(needsLineLayout('החנות!', 'rtl', by)).toBe(false);
    }
  });
  it('plain lines are placed word by word: one direction, laid out in it, nothing the browser would reorder', () => {
    for (const by of ['word', 'letter'] as const) {
      for (const line of ['ONE TWO THREE', '12:30 – 14:00', 'Hello, world! (2)', 'Über 50% (heute)!', 'Привет, мир', '中文 title', 'Sale 🔥 -50%', '']) expect(needsLineLayout(line, 'ltr', by), line).toBe(false);
      for (const line of ['שלום עולם', 'שלום, עולם! (באמת)', 'שָׁלוֹם', 'מבצע ענק 🔥', 'חדש — עכשיו…', '"שלום" ו־\'עולם\'', '']) expect(needsLineLayout(line, 'rtl', by), line).toBe(false);
    }
    // numbers in a Hebrew line: fine word by word (the browser places the number inside its word), not letter by letter: "50%!" is shown as 50% with the "!" on its left
    for (const line of ['קנו 15 עכשיו!', 'עד 50% הנחה', 'עד 50%!', 'רק ₪99.90', '12:30 – 14:00', '2026!', '(50%)']) {
      expect(needsLineLayout(line, 'rtl', 'word'), line).toBe(false);
      expect(needsLineLayout(line, 'rtl', 'letter'), line).toBe(true);
    }
    // Arabic script: word by word without digits; never letter by letter (its letters join), and not with digits (they are ordered by rules of their own)
    expect(needsLineLayout('مرحبا بالعالم!', 'rtl', 'word')).toBe(false);
    expect(needsLineLayout('مرحبا بالعالم!', 'rtl', 'letter')).toBe(true);
    expect(needsLineLayout('مرحبا 50%', 'rtl', 'word')).toBe(true);
    expect(needsLineLayout('مرحبا ٥٠', 'rtl', 'word')).toBe(true);
    // anything else in a right-to-left line: letters of other scripts than Latin, symbols that are letters to the browser, flags, hidden direction marks
    for (const line of ['שלום 中文', 'שלום ℹ', 'שלום 🇮🇱', 'שלום Ⓜ', 'א × ב', 'שלום\u200E!', 'מחיר: 5\u00A0₪']) expect(needsLineLayout(line, 'rtl', 'word'), line).toBe(true);
    for (const line of ['abc\u200Fdef', 'abc \u202Edef', 'price ٥٠', 'ab \u{10900}']) expect(needsLineLayout(line, 'ltr', 'word'), line).toBe(true);
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
