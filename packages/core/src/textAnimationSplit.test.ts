import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, validateProject, OpError, type Clip, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fi = (t: T.RationalTime) => T.frameIndexAt(t, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ta${n++}_`, actor: 'test' });
type TextClip = Extract<Clip, { type: 'text' }>;
const titles = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c): c is TextClip => c.type === 'text').sort((a, b) => T.cmp(a.start, b.start));
const shape = (c: TextClip) => [fi(c.start), fi(c.duration), c.animation ? { in: c.animation.in, out: c.animation.out, loop: c.animation.loop } : null] as const;

/** A 120-frame title with a 20-frame entrance and a 15-frame exit (and, optionally, a loop). */
function project(animation: Record<string, unknown> = { in: 'fade', inFrames: 20, out: 'fade', outFrames: 15 }, frames = 120) {
  const r = tx(createProject({ id: 'prj_ta', name: 'TA' }), [{ op: 'add_text', args: { text: 'one two three four', start: f(0), duration: f(frames) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  return { doc: tx(r.doc, [{ op: 'set_text_animation', args: { clipId, animation } }]).doc, clipId };
}
/** What set_text_animation itself requires: entrance plus exit fit in the clip. */
function fits(d: ProjectDocument) {
  for (const c of titles(d)) {
    const a = c.animation;
    if (!a) continue;
    expect(a.in || a.out || a.loop, c.id).toBeTruthy(); // a part with nothing animating has no animation field
    expect((a.in ? a.inFrames : 0) + (a.out ? a.outFrames : 0), c.id).toBeLessThanOrEqual(fi(c.duration));
    // and the op accepts the same animation again on that part
    expect(() => tx(d, [{ op: 'set_text_animation', args: { clipId: c.id, animation: a } }])).not.toThrow();
  }
}

describe('a title with a text animation that is divided', () => {
  it('split_clip: the entrance stays with the first part, the exit with the last', () => {
    const { doc, clipId } = project();
    const d = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(50) } }]).doc;
    expect(validateProject(d)).toEqual([]);
    expect(titles(d).map(shape)).toEqual([[0, 50, { in: 'fade', out: null, loop: null }], [50, 70, { in: null, out: 'fade', loop: null }]]);
    expect(titles(d)[0]!.animation!.inFrames).toBe(20);
    expect(titles(d)[1]!.animation!.outFrames).toBe(15);
    fits(d);
  });

  it('cut_range in the middle (with and without ripple) and insert_gap follow the same rule', () => {
    const { doc } = project();
    for (const [ops, want] of [
      [[{ op: 'cut_range', args: { start: f(50), end: f(60) } }], [[0, 50], [50, 60]]],
      [[{ op: 'cut_range', args: { start: f(50), end: f(60), ripple: false } }], [[0, 50], [60, 60]]],
      [[{ op: 'insert_gap', args: { at: f(50), duration: f(10) } }], [[0, 50], [60, 70]]],
    ] as [OpCall[], number[][]][]) {
      const d = tx(doc, ops).doc;
      expect(validateProject(d)).toEqual([]);
      const t = titles(d);
      expect(t.map((c) => [fi(c.start), fi(c.duration)]), ops[0]!.op).toEqual(want);
      expect([t[0]!.animation?.in, t[0]!.animation?.out], ops[0]!.op).toEqual(['fade', null]);
      expect([t[1]!.animation?.in, t[1]!.animation?.out], ops[0]!.op).toEqual([null, 'fade']);
      fits(d);
    }
  });

  it('three parts: the middle one has no animation left; with a loop every part keeps the loop', () => {
    const plain = project();
    const d = tx(plain.doc, [{ op: 'split_clip', args: { clipId: plain.clipId, at: f(40) } }, { op: 'cut_range', args: { start: f(80), end: f(90) } }]).doc;
    expect(titles(d).map(shape)).toEqual([[0, 40, { in: 'fade', out: null, loop: null }], [40, 40, null], [80, 30, { in: null, out: 'fade', loop: null }]]);
    expect('animation' in titles(d)[1]!).toBe(false);
    const looped = project({ in: 'rise', inFrames: 20, out: 'sink', outFrames: 15, loop: 'wave' });
    const e = tx(looped.doc, [{ op: 'split_clip', args: { clipId: looped.clipId, at: f(40) } }, { op: 'insert_gap', args: { at: f(80), duration: f(5) } }]).doc;
    expect(titles(e).map((c) => shape(c)[2])).toEqual([{ in: 'rise', out: null, loop: 'wave' }, { in: null, out: null, loop: 'wave' }, { in: null, out: 'sink', loop: 'wave' }]);
    fits(e);
  });

  it('a cut that only takes the head or the tail off leaves one part, which keeps both ends and still fits', () => {
    const { doc } = project();
    const head = tx(doc, [{ op: 'cut_range', args: { start: f(0), end: f(30) } }]).doc;
    expect(titles(head).map(shape)).toEqual([[0, 90, { in: 'fade', out: 'fade', loop: null }]]);
    const tail = tx(doc, [{ op: 'cut_range', args: { start: f(100), end: f(120) } }]).doc;
    expect(titles(tail).map(shape)).toEqual([[0, 100, { in: 'fade', out: 'fade', loop: null }]]);
    // down to 25 frames: the 20-frame entrance stays whole, the exit gets the 5 frames that are left
    const short = tx(doc, [{ op: 'cut_range', args: { start: f(0), end: f(95) } }]).doc;
    expect(titles(short).map((c) => [fi(c.duration), c.animation!.inFrames, c.animation!.outFrames])).toEqual([[25, 20, 5]]);
    fits(short);
  });

  it('short leftovers get an animation that fits them instead of one that never finishes', () => {
    const { doc } = project();
    const d = tx(doc, [{ op: 'cut_range', args: { start: f(5), end: f(110) } }]).doc; // leaves 5 and 10 frames
    const t = titles(d);
    expect(t.map((c) => fi(c.duration))).toEqual([5, 10]);
    expect([t[0]!.animation!.in, t[0]!.animation!.inFrames, t[0]!.animation!.out]).toEqual(['fade', 5, null]);
    expect([t[1]!.animation!.in, t[1]!.animation!.out, t[1]!.animation!.outFrames]).toEqual([null, 'fade', 10]);
    fits(d);
  });

  it('any sequence of splits, cuts and inserted gaps: one entrance at the first part, one exit at the last, everything fits', () => {
    fc.assert(fc.property(
      fc.array(fc.tuple(fc.constantFrom('split', 'cut', 'gap'), fc.integer({ min: 0, max: 139 }), fc.integer({ min: 1, max: 30 })), { minLength: 1, maxLength: 6 }),
      fc.boolean(),
      (steps, loop) => {
        const p = project({ in: 'pop', inFrames: 20, out: 'lift', outFrames: 15, ...(loop ? { loop: 'pulse' } : {}) });
        let d = p.doc;
        for (const [kind, at, len] of steps) {
          try {
            if (kind === 'split') { const c = titles(d).find((x) => fi(x.start) < at && at < fi(x.start) + fi(x.duration)); if (c) d = tx(d, [{ op: 'split_clip', args: { clipId: c.id, at: f(at) } }]).doc; }
            else if (kind === 'cut') d = tx(d, [{ op: 'cut_range', args: { start: f(at), end: f(at + len) } }]).doc;
            else d = tx(d, [{ op: 'insert_gap', args: { at: f(at), duration: f(len) } }]).doc;
          } catch (e) { expect(e).toBeInstanceOf(OpError); }
        }
        expect(validateProject(d)).toEqual([]);
        const t = titles(d);
        fits(d);
        // never an entrance after the first part or an exit before the last
        t.forEach((c, i) => { if (i > 0) expect(c.animation?.in ?? null).toBeNull(); if (i < t.length - 1) expect(c.animation?.out ?? null).toBeNull(); });
        for (const c of t) expect(c.animation?.loop ?? null).toBe(loop ? 'pulse' : null);
      },
    ), { numRuns: 120 });
  });
});
