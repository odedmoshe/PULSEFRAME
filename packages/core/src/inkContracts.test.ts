/**
 * Lead contract of «ציור חי» (wave 8 ink pre-pass; inkContract.ts, inkOps.ts): the packed form is canonical and exact, the caps are
 * the computed ones, the kind is registered on the carrier, add_ink / edit_ink place, refuse and undo exactly, split and trim-start
 * keep the drawing continuous, agents see counts and a box only. W1 owns this file after the pre-pass (the todo rows are W1's).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, drawnKinds, drawnSummary, INK_COORD_MAX, INK_HEADER_MAX, INK_MAX_CHARS, INK_STROKE_OVERHEAD_MAX,
  inkDocumentPoints, inkDrawnMs, InkPayloadSchema, inkStrokeProgress, isDrawnClip, isInkPayload, MAX_CLIP_POINTS, MAX_CLIP_STROKES, MAX_DOC_POINTS,
  MAX_DRAW_MS, MAX_STROKE_POINTS, OpError, packInkPoints, ProjectSchema, restoreEntities, timeline, unpackInkPoints, validateProject,
  type DrawnClip, type InkPayload, type InkStrokeIn, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seq = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `ink${seq++}_`, actor: 'test' });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const project = () => createProject({ id: 'prj_ink', name: 'I', width: 1920, height: 1080, frameRate: R });
const line = (over: Partial<InkStrokeIn> = {}, n = 5): InkStrokeIn => ({ brush: 'marker', color: '#ffcc00', width: 80, at: 0, x: Array.from({ length: n }, (_, j) => 1000 + 100 * (j % 100)), y: Array.from({ length: n }, () => -500), t: Array.from({ length: n }, (_, j) => 20 * j), ...over });
const inkOf = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).filter((c): c is DrawnClip => isDrawnClip(c) && isInkPayload(c.drawn));
function acceptAndUndo(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

describe('the packed form', () => {
  it('round-trips exactly, 8 characters a point, at the int16 and uint16 bounds', () => {
    const p = { x: [0, INK_COORD_MAX, -INK_COORD_MAX, -1, 1], y: [-INK_COORD_MAX, 0, INK_COORD_MAX, 255, -256], t: [0, 0, 65_535, 65_536, 131_071] };
    const s = packInkPoints(p);
    expect(s).toHaveLength(40);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(unpackInkPoints(s)).toEqual(p);
    expect(() => packInkPoints({ x: [0, 0], y: [0, 0], t: [0, 65_536] })).toThrow(RangeError);
    expect(() => packInkPoints({ x: [32_768], y: [0], t: [0] })).toThrow(RangeError);
    expect(() => packInkPoints({ x: [0], y: [0], t: [5] })).toThrow(RangeError);
  });
  it('is canonical: any 8n-character string decodes and packs back to itself; a non-zero first step is refused by the schema', () => {
    let r = 7;
    const rnd = () => (r = (Math.imul(r, 1103515245) + 12345) >>> 0);
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (let k = 0; k < 200; k++) {
      const pts = Array.from({ length: 8 * (1 + (rnd() % 20)) }, () => A[rnd() % 64]).join('');
      const u = unpackInkPoints(pts);
      const shifted = { ...u, t: u.t.map((v) => v - u.t[0]!) }; // the first step is what the canonical rule pins
      const again = unpackInkPoints(packInkPoints(shifted));
      expect(again).toEqual(shifted);
    }
    const ok = packInkPoints({ x: [1, 2], y: [3, 4], t: [0, 10] });
    const payload = (pts: string) => ({ kind: 'ink', v: 1, play: 'drawn', speed: '1', strokes: [{ brush: 'marker', color: '#FFCC00', width: 80, at: 0, n: pts.length / 8, pts }] });
    expect(InkPayloadSchema.safeParse(payload(ok)).success).toBe(true);
    const badFirst = packInkPoints({ x: [1], y: [3], t: [0] }).slice(0, 5) + 'B' + 'AA';
    expect(InkPayloadSchema.safeParse(payload(badFirst)).success).toBe(false);
    expect(InkPayloadSchema.safeParse({ ...payload(ok), strokes: [{ ...payload(ok).strokes[0]!, n: 3 }] }).success).toBe(false);
    expect(InkPayloadSchema.safeParse({ ...payload(ok), strokes: [{ ...payload(ok).strokes[0]!, color: '#ffcc00' }] }).success).toBe(false);
    expect(InkPayloadSchema.safeParse({ ...payload(ok), offset: T.ZERO }).success).toBe(false);
  });
  it('the caps: a stroke\'s longest JSON overhead and the payload at the clip caps fit INK_MAX_CHARS exactly as computed', () => {
    const big = { brush: 'highlighter', color: '#000000', width: 800, at: MAX_DRAW_MS, n: MAX_STROKE_POINTS, pts: '' };
    expect(JSON.stringify(big).length + 1).toBe(INK_STROKE_OVERHEAD_MAX);
    const per = MAX_CLIP_POINTS / MAX_CLIP_STROKES;
    const stroke = { brush: 'highlighter', color: '#000000', width: 800, at: MAX_DRAW_MS, n: per, pts: 'A'.repeat(8 * per) };
    const p = { kind: 'ink', v: 1, play: 'drawn', speed: '1', offset: { value: `-${'9'.repeat(15)}`, timescale: 2 ** 53 - 1 }, strokes: Array.from({ length: MAX_CLIP_STROKES }, () => stroke) };
    expect(InkPayloadSchema.safeParse(p).success).toBe(true);
    expect(JSON.stringify({ ...p, strokes: [] }).length).toBeLessThanOrEqual(INK_HEADER_MAX);
    expect(JSON.stringify(p).length).toBeLessThanOrEqual(INK_MAX_CHARS);
    expect(INK_MAX_CHARS).toBe(80_928);
    expect(8 * MAX_DOC_POINTS).toBe(192_000); // ink-verify I13: the document's packed points at the cap
  });
});

describe('the kind on the carrier', () => {
  it('is registered on import, so a document with a drawing parses', () => {
    expect(drawnKinds()).toContain('ink');
    const r = tx(project(), [{ op: 'add_ink', args: { start: f(30), strokes: [line()] } }]);
    expect(ProjectSchema.safeParse(JSON.parse(JSON.stringify(r.doc))).success).toBe(true);
  });
});

describe('add_ink', () => {
  it('places one clip on a titles track, anchor at the box centre, points packed around it; default length = drawing time up + 2 s; undo exact', () => {
    const r = acceptAndUndo(project(), [{ op: 'add_ink', args: { start: f(30), strokes: [line(), line({ brush: 'neon', at: 300, color: '#00FFAA' }, 3)] } }]);
    const [c] = inkOf(r.doc);
    expect(c).toBeTruthy();
    const p = c!.drawn as InkPayload;
    expect(p.strokes.map((s) => [s.brush, s.color, s.n])).toEqual([['marker', '#FFCC00', 5], ['neon', '#00FFAA', 3]]);
    expect(unpackInkPoints(p.strokes[0]!.pts)).toEqual({ x: [-200, -100, 0, 100, 200], y: [0, 0, 0, 0, 0], t: [0, 20, 40, 60, 80] });
    expect(c!.transform.x).toBeCloseTo((1200 * 1080) / (10_000 * 1920), 12);
    expect(c!.transform.y).toBe(-0.05);
    expect(c!.duration).toEqual(f(Math.ceil(0.34 * 30) + 60)); // the neon stroke ends at 340 ms
    const tl = JSON.stringify(timeline(r.doc));
    expect(tl).not.toContain(p.strokes[0]!.pts);
    expect(drawnSummary(p)).toMatchObject({ kind: 'ink', strokes: 2, points: 8, brushes: { marker: 1, neon: 1 }, drawMs: 340, play: 'drawn', speed: '1' });
  });
  it('refuses with the ink wording (details.ink names the row)', () => {
    const doc = project();
    const code = (strokes: InkStrokeIn[]) => (refusal(() => tx(doc, [{ op: 'add_ink', args: { start: f(0), strokes } }])).details as { ink?: string }).ink;
    expect(code([line({ y: [0] })])).toBe('lengths');
    expect(code([line({ t: [5, 6, 7, 8, 9] })])).toBe('time');
    expect(code([line({ t: [0, 10, 5, 20, 30] })])).toBe('time');
    expect(code([line({ t: [0, 70_000, 70_001, 70_002, 70_003] })])).toBe('gap');
    expect(code([line({ x: [40_000, 0, 0, 0, 0] })])).toBe('coord');
    expect(code([line({ x: [-20_000, 0, 0, 0, 20_000] })])).toBe('span');
    expect(code([line({ at: MAX_DRAW_MS })])).toBe('long');
    expect(code(Array.from({ length: 5 }, () => line({}, MAX_STROKE_POINTS)))).toBe('tooLarge');
  });
  it('the document cap is enforced here, not in validation: a split near the cap is accepted, the next add is refused', () => {
    let doc = project();
    const big = (k: number) => ({ op: 'add_ink', args: { start: f(k * 400), strokes: Array.from({ length: 4 }, () => line({}, MAX_STROKE_POINTS)) } });
    for (let k = 0; k < 3; k++) doc = tx(doc, [big(k)]).doc;
    expect(inkDocumentPoints(doc)).toBe(MAX_DOC_POINTS);
    const first = inkOf(doc)[0]!;
    doc = acceptAndUndo(doc, [{ op: 'split_clip', args: { clipId: first.id, at: T.add(first.start, f(10)) } }]).doc;
    expect(inkDocumentPoints(doc)).toBe(MAX_DOC_POINTS + MAX_CLIP_POINTS);
    expect((refusal(() => tx(doc, [{ op: 'add_ink', args: { start: f(2000), strokes: [line({}, 1)] } }])).details as { ink?: string }).ink).toBe('documentFull');
  });
});

describe('time: the play rule, split and trim-start', () => {
  it('D(t) = floor((offset + t + 1/fps)·1000) ms; play all shows everything; a split right half continues the drawing', () => {
    const r = tx(project(), [{ op: 'add_ink', args: { start: f(30), duration: f(90), strokes: [line({}, 40)] } }]);
    const c = inkOf(r.doc)[0]!;
    const p = c.drawn as InkPayload;
    expect(inkDrawnMs(p, T.ZERO, R)).toBe(33);
    expect(inkDrawnMs(p, f(3), R)).toBe(133);
    expect(inkDrawnMs({ ...p, play: 'all' }, T.ZERO, R)).toBe(Infinity);
    const split = acceptAndUndo(r.doc, [{ op: 'split_clip', args: { clipId: c.id, at: f(50) } }]).doc;
    const [left, right] = inkOf(split).sort((a, b) => T.cmp(a.start, b.start));
    expect((left!.drawn as InkPayload).offset).toBeUndefined();
    expect((right!.drawn as InkPayload).offset).toEqual(T.normalize(f(20)));
    // the same timeline frame shows the same drawing time on either side of the cut
    for (const k of [50, 61, 100]) expect(inkDrawnMs(right!.drawn as InkPayload, T.sub(f(k), right!.start), R)).toBe(inkDrawnMs(p, T.sub(f(k), c.start), R));
    const trimmed = acceptAndUndo(r.doc, [{ op: 'trim_clip', args: { clipId: c.id, edge: 'start', to: f(37) } }]).doc;
    expect((inkOf(trimmed)[0]!.drawn as InkPayload).offset).toEqual(T.normalize(f(7)));
  });
  it('inkStrokeProgress: integer reach, one division for the partial segment', () => {
    const t = [0, 10, 10, 40];
    expect(inkStrokeProgress(100, t, 99)).toEqual({ points: 0, frac: 0 });
    expect(inkStrokeProgress(100, t, 100)).toEqual({ points: 1, frac: 0 });
    expect(inkStrokeProgress(100, t, 105)).toEqual({ points: 1, frac: 0.5 });
    expect(inkStrokeProgress(100, t, 110)).toEqual({ points: 3, frac: 0 });
    expect(inkStrokeProgress(100, t, 120)).toEqual({ points: 3, frac: 1 / 3 });
    expect(inkStrokeProgress(100, t, 140)).toEqual({ points: 4, frac: 0 });
    expect(inkStrokeProgress(100, t, Infinity)).toEqual({ points: 4, frac: 0 });
  });
});

describe('edit_ink and the text ops', () => {
  it('changes play and adds the fade as opacity keys in one undo; refuses a title, nothing to change, and every text op refuses a drawing', () => {
    let r = tx(project(), [{ op: 'add_ink', args: { start: f(0), duration: f(60), strokes: [line()] } }]);
    const id = inkOf(r.doc)[0]!.id;
    r = acceptAndUndo(r.doc, [{ op: 'edit_ink', args: { clipId: id, play: 'all', fadeOut: true } }]);
    const c = inkOf(r.doc)[0]!;
    expect((c.drawn as InkPayload).play).toBe('all');
    expect(c.keyframes?.opacity?.length).toBeGreaterThan(0);
    expect((refusal(() => tx(r.doc, [{ op: 'edit_ink', args: { clipId: id } }])).details as { ink?: string }).ink).toBe('nothing');
    const t = tx(r.doc, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(10) } }]);
    const titleId = t.results[0]!.output!.clipId as string;
    expect((refusal(() => tx(t.doc, [{ op: 'edit_ink', args: { clipId: titleId, play: 'all' } }])).details as { ink?: string }).ink).toBe('notInk');
    expect(refusal(() => tx(r.doc, [{ op: 'update_text', args: { clipId: id, text: 'x' } }])).code).toBe('drawn_not_text');
  });
});

describe('builders (W1)', () => {
  it.todo('simplifyInkStroke: consecutive duplicates dropped (first keeps its time); RDP at eps 6 with an explicit stack; farthest first, lowest index on a tie; a closed loop measured from A; first and last points kept');
  it.todo('simplifyInkStroke: a property test against a brute-force RDP on 200 seeded raw strokes (doubles), and every kept point within eps of the raw polyline');
  it.todo('simplifyInkStroke at MAX_RAW_STROKE_POINTS: one timing sample recorded, not gated');
  it.todo('inheritedIds and the fuzz meet add_ink / edit_ink (rows in ops-fuzz.gen.ts genInk; fixed steps in ops-fuzz.test.ts)');
});
