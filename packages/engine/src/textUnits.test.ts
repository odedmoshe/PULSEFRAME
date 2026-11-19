/**
 * How an animating title is put on the canvas, checked without a browser: the real `drawGraph` draws into a stand-in
 * canvas that only records the calls (TEST STAND-IN: every character is 10 wide; no bidi, no glyphs). What it can show is
 * WHICH text is drawn WHERE and through which window, not what a browser makes of it.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument, type TextAnimation } from '@pulseframe/core';
import { drawGraph, evaluate } from './index.ts';
import type { Ctx2D } from './compositor2d.ts';

const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `u${seed++}_`, actor: 'test' });

interface Drawn { text: string; x: number; y: number; direction: string; windows: { x: number; width: number }[] | null }
/**
 * The recording canvas. `order` (optional) is the answer of a browser that can tell where it put a range of a line: for the
 * line given, the logical character numbers from the left of the screen to the right.
 */
function canvas(order?: { line: string; fromLeft: number[] }) {
  const fills: Drawn[] = [], strokes: Drawn[] = [];
  let m = { x: 0, y: 0, k: 1 }, clip: Drawn['windows'] = null, path: { x: number; width: number }[] = [];
  const stack: { m: typeof m; clip: Drawn['windows'] }[] = [];
  const state: Record<string, unknown> = { direction: 'ltr' };
  const record = (into: Drawn[]) => (text: string, x: number, y: number) => into.push({ text, x: m.x + x * m.k, y: m.y + y * m.k, direction: String(state.direction), windows: clip });
  const api: Record<string, unknown> = {
    save: () => stack.push({ m: { ...m }, clip }), restore: () => { const s = stack.pop()!; m = s.m; clip = s.clip; },
    setTransform: () => { m = { x: 0, y: 0, k: 1 }; }, translate: (x: number, y: number) => { m.x += x * m.k; m.y += y * m.k; }, scale: (k: number) => { m.k *= k; }, rotate: () => {},
    getTransform: () => ({ a: m.k, b: 0 }),
    fillRect: () => {}, roundRect: () => {}, fill: () => {},
    beginPath: () => { path = []; }, rect: (x: number, _y: number, width: number) => { path.push({ x: m.x + x * m.k, width: width * m.k }); }, clip: () => { clip = path; },
    measureText: (text: string) => ({
      width: text.length * 10,
      ...(order && text === order.line ? { getSelectionRects: (start: number, end: number) => order.fromLeft.map((c, place) => ({ c, place })).filter((p) => p.c >= start && p.c < end).map((p) => ({ x: p.place * 10, width: 10 })) } : {}),
    }),
    fillText: record(fills), strokeText: record(strokes),
  };
  const ctx = new Proxy(api, { get: (t, k: string) => (k in t ? t[k] : state[k]), set: (_t, k: string, v) => { state[k] = v; return true; } }) as unknown as Ctx2D;
  return { ctx, fills, strokes };
}
/** Draw frame 30 of a title with this text and animation (null = no animation) and return what was drawn. */
async function draw(text: string, animation: Partial<TextAnimation> | null, order?: { line: string; fromLeft: number[] }, frame: { width?: number; direction?: 'rtl' | 'ltr' } = {}) {
  let r = tx(createProject({ id: 'prj_u', name: 'U', width: frame.width ?? 1280, height: 720 }), [{ op: 'add_text', args: { text, start: f(0), duration: f(90), ...(frame.direction ? { style: { direction: frame.direction } } : {}) } }]);
  if (animation) r = tx(r.doc, [{ op: 'set_text_animation', args: { clipId: r.results[0]!.output!.clipId as string, animation } }]);
  const c = canvas(order);
  await drawGraph(c.ctx, evaluate(r.doc, f(30)), async () => null);
  return c;
}

// "קנו iPhone 15 עכשיו": characters 0-2 קנו, 4-9 iPhone, 11-12 "15", 14-18 עכשיו. Full bidi (ICU and FriBidi agree, see the
// review) shows, from the left: עכשיו iPhone 15 קנו, the Hebrew words with their letters right to left.
const MIXED = 'קנו iPhone 15 עכשיו';
const FULL_BIDI = [18, 17, 16, 15, 14, 13, 4, 5, 6, 7, 8, 9, 10, 11, 12, 3, 2, 1, 0];

describe('an animating title is drawn where the title at rest is', () => {
  it('(reported) a line with both directions, where the browser cannot say where its words are: the whole line moves as one piece, drawn exactly like the line at rest', async () => {
    const rest = await draw(MIXED, null);
    expect(rest.fills).toHaveLength(1);
    for (const by of ['word', 'letter', 'line'] as const) {
      const moving = await draw(MIXED, { by, loop: 'pulse' });
      // one piece: the same text, the same direction, the same left edge (the pulse scales it about its own middle)
      expect(moving.fills.map((d) => d.text), by).toEqual([MIXED]);
      expect(moving.fills[0]!.direction).toBe(rest.fills[0]!.direction);
      const scale = (moving.fills[0]!.x - 640) / (rest.fills[0]!.x - 640);
      expect(scale).toBeGreaterThan(0.9); expect(scale).toBeLessThan(1.1);
      expect(moving.fills[0]!.windows).toBeNull();
    }
    // with an entrance the line arrives as a whole, and on the frame the entrance ends it is the plain title
    expect((await draw(MIXED, { by: 'word', in: 'rise', inFrames: 60 })).fills.map((d) => d.text)).toEqual([MIXED]);
    expect((await draw(MIXED, { by: 'word', in: 'rise', inFrames: 31 })).fills).toEqual(rest.fills);
  });

  it('where the browser can say where it put each word or letter, each is the whole line seen through a window on that place', async () => {
    const rest = await draw(MIXED, null);
    const left = rest.fills[0]!.x; // the line is 190 wide
    const words = await draw(MIXED, { by: 'word', loop: 'wave' }, { line: MIXED, fromLeft: FULL_BIDI });
    // four units in reading order, every one the whole line at the place it has at rest (the wave only moves it up and down)
    expect(words.fills.map((d) => d.text)).toEqual([MIXED, MIXED, MIXED, MIXED]);
    for (const d of words.fills) { expect(d.x).toBeCloseTo(left, 6); expect(d.direction).toBe('rtl'); }
    // the windows, from the left edge of the line: קנו at 160-190, iPhone at 60-120, "15" at 130-150 (right of iPhone, where the browser has it), עכשיו at 0-50;
    // each widened by half the space to its neighbour (5), and by a quarter of the font size at the ends of the line; touching stretches of one word overlap by a hair
    const span = (d: Drawn) => [Math.min(...d.windows!.map((w) => w.x)) - left + 0.5, Math.max(...d.windows!.map((w) => w.x + w.width)) - left - 0.5].map((x) => Math.round(x)); // without the half pixel of overlap
    expect(words.fills.map(span)).toEqual([[155, 201], [55, 125], [125, 155], [-11, 55]]);
    expect(words.strokes.map(span)).toEqual(words.fills.map(span)); // the outline goes through the same windows
    const letters = await draw(MIXED, { by: 'letter', loop: 'wave' }, { line: MIXED, fromLeft: FULL_BIDI });
    expect(letters.fills).toHaveLength(16);
    expect(letters.fills.every((d) => d.text === MIXED && Math.abs(d.x - left) < 1e-6)).toBe(true);
    expect(letters.fills.slice(0, 5).map((d) => Math.round((d.windows![0]!.x + 0.5 - left) / 10))).toEqual([18, 17, 16, 6, 7]); // the left edges, in characters: ק נ ו from the right end, then i P where the browser put them
  });

  it('a line of one direction keeps moving word by word and letter by letter', async () => {
    const en = await draw('ONE TWO THREE', { by: 'word', loop: 'wave' });
    expect(en.fills.map((d) => d.text)).toEqual(['ONE', 'TWO', 'THREE']);
    expect(en.fills.map((d) => Math.round(d.x - en.fills[0]!.x))).toEqual([0, 40, 80]);
    const he = await draw('אחת שתיים שלוש', { by: 'word', loop: 'wave' });
    expect(he.fills.map((d) => d.text)).toEqual(['אחת', 'שתיים', 'שלוש']);
    expect(he.fills.map((d) => Math.round(d.x - he.fills[2]!.x))).toEqual([110, 50, 0]); // reading order starts at the right
    expect((await draw('ONE TWO THREE', { by: 'letter', loop: 'wave' })).fills.map((d) => d.text).join('')).toBe('ONETWOTHREE');
    expect([...en.fills, ...he.fills].every((d) => d.windows === null)).toBe(true);
    // digits do not make a Hebrew line mixed
    expect((await draw('קנו 15 עכשיו', { by: 'word', loop: 'wave' })).fills.map((d) => d.text)).toEqual(['קנו', '15', 'עכשיו']);
  });

  it('(reported) a line of one direction laid out in the other moves as one piece, drawn like the line at rest: the last line of a wrapped title, a title set against its text', async () => {
    // [text, how it is laid out, the line in question]: at rest the browser puts the "!" of each of these lines on the
    // other side than a word drawn on its own would have it (full bidi: "!Friday" in a right-to-left paragraph)
    const cases: [string, { width?: number; direction?: 'rtl' | 'ltr' }, string][] = [
      ['מבצע ענק רק היום Black Friday!', { width: 300 }, 'Friday!'], // wraps: "Friday!" alone on the second line of a right-to-left paragraph
      ['Black Friday מבצע ענק על כל החנות!', { width: 300 }, 'החנות!'], // wraps: "החנות!" alone on the second line of a left-to-right paragraph
      ['שלום עולם!', { direction: 'ltr' }, 'שלום עולם!'],
      ['Hello world!', { direction: 'rtl' }, 'Hello world!'],
    ];
    for (const [text, frame, line] of cases) {
      const rest = (await draw(text, null, undefined, frame)).fills.find((d) => d.text === line)!;
      expect(rest, text).toBeDefined();
      for (const by of ['word', 'letter'] as const) {
        const moving = (await draw(text, { by, loop: 'wave' }, undefined, frame)).fills; // the wave moves a piece up and down only
        const piece = moving.filter((d) => line.includes(d.text) && d.y > rest.y - 20 && d.y < rest.y + 20);
        expect(piece.map((d) => d.text), `${text} by ${by}`).toEqual([line]); // not its words or letters
        expect(piece[0]!.direction, `${text} by ${by}`).toBe(rest.direction); // it used to be drawn in the direction of its own letters
        expect(piece[0]!.x, `${text} by ${by}`).toBeCloseTo(rest.x, 6);
        expect(piece[0]!.windows).toBeNull();
      }
      // where the browser can say where it put things, the pieces are windows on the whole line, in the line's direction
      const order = { line, fromLeft: Array.from(line, (_, i) => i) };
      const windows = (await draw(text, { by: 'word', loop: 'wave' }, order, frame)).fills.filter((d) => d.text === line);
      expect(windows.length, text).toBe(line.split(' ').length);
      expect(windows.every((d) => d.direction === rest.direction && Math.abs(d.x - rest.x) < 1e-6 && d.windows !== null), text).toBe(true);
    }
  });

  it('a Hebrew line with numbers: word by word each word is drawn in the line\'s direction (the browser puts "!" left of 50%), letter by letter the line moves as one piece', async () => {
    const words = await draw('עד 50%! היום', { by: 'word', loop: 'wave' });
    expect(words.fills.map((d) => [d.text, d.direction])).toEqual([['עד', 'rtl'], ['50%!', 'rtl'], ['היום', 'rtl']]);
    expect(words.fills.map((d) => Math.round(d.x - words.fills[2]!.x))).toEqual([100, 50, 0]); // right to left, the number in its place in the reading order
    expect((await draw('עד 50%! היום', { by: 'letter', loop: 'wave' })).fills.map((d) => d.text)).toEqual(['עד 50%! היום']);
    expect((await draw('שלום עולם!', { by: 'letter', loop: 'wave' })).fills.map((d) => d.text).join('')).toBe('שלוםעולם!'); // without numbers: letter by letter
    const letters = (await draw('אב גד!', { by: 'letter', loop: 'wave' })).fills;
    expect(letters.map((d) => Math.round(d.x - letters[4]!.x))).toEqual([50, 40, 20, 10, 0]); // from the right; the "!" ends up leftmost, as at rest
    expect(letters.every((d) => d.direction === 'rtl')).toBe(true);
  });
});
