/**
 * Motion path edits (ADR-0019 W3, pathEdits.ts). The pure parts (the points, the vertices, the shape of the ops) run on any
 * tree; the parts that APPLY the ops need keyframe W1 (the range form of replace_clip_keyframes and curves.ts splitSegment),
 * so they are skipped, labelled, while curves.ts CURVES_BUILT is false, and run once W1 is merged.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, bendOps, createProject, creativeProjection, CURVES_BUILT, diffEntities, findClip, moveVertexOps, pathPoints, transformAt, validateProject, vertexFrames,
  type Clip, type EntityChange, type OpCall, type ProjectDocument,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `pe${seed++}_`, actor: 'test' });
const restore = (doc: ProjectDocument, changes: EntityChange[], side: 'before' | 'after') => applyTransaction(doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c[side] })) } }], { idSeed: `pu${seed++}_`, actor: 'test', allowInternal: true });
const built = it.skipIf(!CURVES_BUILT); // needs keyframe W1 (range form, splitSegment)

/** A 90-frame title with x keyed at the given frames (values and easings), y static at 0.2. */
function titled(xKeys: [number, number, string][], yKeys: [number, number, string][] = [], frames = 90): { doc: ProjectDocument; clipId: string } {
  let doc = createProject({ id: 'prj_path', name: 'Path', width: 1280, height: 720, frameRate: R });
  const r = tx(doc, [{ op: 'add_text', args: { text: 'מסלול', start: f(12), duration: f(frames), transform: { x: 0.1, y: 0.2 } } }]);
  doc = r.doc;
  const clipId = (r.results[0]!.output as { clipId: string }).clipId;
  const ops: OpCall[] = [
    ...xKeys.map(([fr, value, easing]) => ({ op: 'set_keyframe', args: { clipId, property: 'x', time: f(fr), value, easing } })),
    ...yKeys.map(([fr, value, easing]) => ({ op: 'set_keyframe', args: { clipId, property: 'y', time: f(fr), value, easing } })),
  ];
  if (ops.length) doc = tx(doc, ops).doc;
  return { doc, clipId };
}
const clipOf = (doc: ProjectDocument, id: string): Clip => findClip(doc, id)!.clip;
const shown = (c: Clip, frame: number) => transformAt(c, T.add(c.start, f(frame)));
/** Apply, check validity, undo and redo through the entity diff (as the store does). */
function applyExact(doc: ProjectDocument, ops: OpCall[]) {
  const r = tx(doc, ops);
  expect(validateProject(r.doc)).toEqual([]);
  const changes = diffEntities(doc, r.doc);
  expect(creativeProjection(restore(r.doc, changes, 'before').doc)).toBe(creativeProjection(doc));
  return r.doc;
}

describe('pathPoints and vertexFrames', () => {
  it('pathPoints equals transformAt on every frame (Object.is), x and y', () => {
    const { doc, clipId } = titled([[0, -0.3, 'ease-in-out'], [30, 0.25, 'ease-out'], [61, 0.05, 'hold'], [75, 0.3, 'linear']], [[10, -0.1, 'ease-in'], [50, 0.3, 'linear']]);
    const c = clipOf(doc, clipId);
    const pts = pathPoints(c, R);
    expect(pts.map((p) => p.frame)).toEqual(Array.from({ length: 90 }, (_, i) => i));
    for (const p of pts) { const tr = shown(c, p.frame); expect(Object.is(p.x, tr.x) && Object.is(p.y, tr.y)).toBe(true); }
  });
  it('an unkeyed axis is its static value; a clip without keys is a single still point per frame', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [89, 0.5, 'linear']]);
    for (const p of pathPoints(clipOf(doc, clipId), R)) expect(p.y).toBe(0.2);
  });
  it('decimates above max and keeps every key frame', () => {
    const { doc, clipId } = titled([[0, -0.3, 'linear'], [333, 0.1, 'ease-in'], [1001, 0.2, 'linear'], [1799, 0.3, 'linear']], [], 1800);
    const c = clipOf(doc, clipId);
    const pts = pathPoints(c, R);
    expect(pts.length).toBeLessThanOrEqual(600);
    const frames = pts.map((p) => p.frame);
    for (const k of [0, 333, 1001, 1799]) expect(frames).toContain(k);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    for (const p of pts) { const tr = shown(c, p.frame); expect(Object.is(p.x, tr.x)).toBe(true); }
    expect(pathPoints(c, R, 50).length).toBeLessThanOrEqual(50);
  });
  it('vertexFrames: frames inside the clip with an x or y key, ascending, without duplicates', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [30, 0.1, 'linear'], [60, 0.2, 'linear']], [[30, 0.1, 'linear'], [45, 0.3, 'linear']]);
    expect(vertexFrames(clipOf(doc, clipId), R)).toEqual([0, 30, 45, 60]);
  });
  it('vertexFrames leaves out keys a trim left before the clip start', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [30, 0.1, 'linear'], [60, 0.2, 'linear']]);
    const trimmed = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(12 + 20) } }]).doc;
    const c = clipOf(trimmed, clipId);
    expect(vertexFrames(c, R)).toEqual([10, 40]);
    for (const p of pathPoints(c, R)) expect(Object.is(p.x, shown(c, p.frame).x)).toBe(true);
  });
  built('with the new curves (overshoot, smooth, bounce, bezier) too', () => {
    const { doc, clipId } = titled([[0, -0.3, 'overshoot'], [30, 0.25, 'smooth'], [50, 0.05, 'bounce'], [75, 0.3, 'linear']], [[10, -0.1, 'spring'], [50, 0.3, 'linear']]);
    const c = clipOf(doc, clipId);
    for (const p of pathPoints(c, R)) { const tr = shown(c, p.frame); expect(Object.is(p.x, tr.x) && Object.is(p.y, tr.y)).toBe(true); }
  });
});

describe('moveVertexOps', () => {
  it('a move that changes one axis makes one op; both axes two; none zero (≤ 2 ops per gesture)', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [30, 0.2, 'linear'], [60, 0, 'linear']]);
    const c = clipOf(doc, clipId);
    expect(moveVertexOps(c, R, 30, 0.2, 0.2).ops).toEqual([]);
    const one = moveVertexOps(c, R, 30, 0.25, 0.2);
    expect(one.ops).toHaveLength(1);
    expect(one.ops[0]).toEqual({ op: 'replace_clip_keyframes', args: { clipId, property: 'x', keys: [{ time: f(30), value: 0.25, easing: 'linear' }], from: f(30), to: f(30) } });
    expect(one.exact).toBe(true);
    const two = moveVertexOps(c, R, 30, 0.25, 0.3);
    expect(two.ops).toHaveLength(2);
    expect(two.ops.every((o) => o.op === 'replace_clip_keyframes')).toBe(true);
  });
  it('the unkeyed axis is keyed at every vertex with its static value and the other axis\'s curves', () => {
    const { doc, clipId } = titled([[0, 0, 'ease-in'], [30, 0.2, 'ease-out'], [60, 0, 'linear']]);
    const { ops } = moveVertexOps(clipOf(doc, clipId), R, 30, 0.2, 0.35);
    expect(ops).toEqual([{ op: 'replace_clip_keyframes', args: { clipId, property: 'y', from: f(0), to: f(60), keys: [
      { time: f(0), value: 0.2, easing: 'ease-in' }, { time: f(30), value: 0.35, easing: 'ease-out' }, { time: f(60), value: 0.2, easing: 'linear' },
    ] } }]);
  });
  it('values are clamped to the channel range', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [30, 0.2, 'linear']]);
    const { ops } = moveVertexOps(clipOf(doc, clipId), R, 30, 1e9, 0.2);
    const k = (ops[0]!.args as { keys: { value: number }[] }).keys[0]!;
    expect(Number.isFinite(k.value) && k.value < 1e9).toBe(true);
  });
  built('on an unkeyed axis every other frame keeps its value (Object.is); one undo step restores the document exactly', () => {
    const { doc, clipId } = titled([[0, -0.2, 'ease-in'], [30, 0.2, 'ease-out'], [60, 0, 'linear'], [80, 0.1, 'linear']]);
    const before = clipOf(doc, clipId);
    const { ops, exact } = moveVertexOps(before, R, 30, 0.2, 0.4);
    expect(ops).toHaveLength(1);
    expect(exact).toBe(true);
    const after = clipOf(applyExact(doc, ops), clipId);
    for (let fr = 0; fr < 90; fr++) {
      const b = shown(before, fr), a = shown(after, fr);
      expect(Object.is(a.x, b.x)).toBe(true); // the untouched axis, every frame
      if (fr <= 0 || fr >= 60) expect(Object.is(a.y, b.y)).toBe(true); // outside the two segments around the moved vertex
    }
    expect(shown(after, 30).y).toBe(0.4);
  });
  built('a missing key on a keyed axis is inserted by splitSegment: the curve keeps its shape before the drag value', () => {
    const { doc, clipId } = titled([[0, -0.2, 'linear'], [60, 0.2, 'linear']], [[0, 0, 'linear'], [30, 0.1, 'linear'], [60, 0, 'linear']]);
    const before = clipOf(doc, clipId);
    const { ops, exact } = moveVertexOps(before, R, 30, shown(before, 30).x + 0.05, 0.1);
    expect(ops).toHaveLength(1);
    expect(exact).toBe(true);
    const after = clipOf(applyExact(doc, ops), clipId);
    expect(after.keyframes!.x!.map((k) => k.time)).toEqual([f(0), f(30), f(60)]);
    expect(shown(after, 30).x).toBeCloseTo(0.05, 12);
  });
  built('every gesture on random paths makes at most 2 ops, and they apply', () => {
    let rnd = 7;
    const r = () => ((rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648);
    const easings = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'hold', 'smooth', 'gentle', 'overshoot', 'spring'];
    for (let n = 0; n < 40; n++) {
      const xs: [number, number, string][] = [[0, r() - 0.5, easings[n % easings.length]!], [20 + Math.floor(r() * 20), r() - 0.5, easings[(n + 3) % easings.length]!], [70, r() - 0.5, 'linear']];
      const ys: [number, number, string][] = n % 2 ? [[10, r() - 0.5, easings[(n + 5) % easings.length]!], [60, r() - 0.5, 'linear']] : [];
      const { doc, clipId } = titled(xs, ys);
      const c = clipOf(doc, clipId);
      const v = vertexFrames(c, R);
      const fr = v[Math.floor(r() * v.length)]!;
      const mv = moveVertexOps(c, R, fr, r() - 0.5, r() - 0.5);
      expect(mv.ops.length).toBeLessThanOrEqual(2);
      tx(doc, mv.ops);
      const i = Math.floor(r() * (v.length - 1));
      const bd = bendOps(c, R, v[i]!, v[i + 1]!, r() - 0.5, r() - 0.5);
      expect(bd.ops.length).toBeLessThanOrEqual(2);
      tx(doc, bd.ops);
    }
  });
});

describe('bendOps', () => {
  it('the vertex goes at floor((a + b) / 2), with smooth on both sides; a segment without a middle frame gives no ops', () => {
    const { doc, clipId } = titled([[0, 0, 'linear'], [31, 0.2, 'linear']], [[0, 0, 'linear'], [31, 0.1, 'ease-in']]);
    const c = clipOf(doc, clipId);
    const r = bendOps(c, R, 0, 31, 0.3, -0.1);
    expect(r.frame).toBe(15);
    expect(r.ops).toHaveLength(2);
    for (const [i, p] of (['x', 'y'] as const).entries()) {
      const a = r.ops[i]!.args as { property: string; keys: { time: T.RationalTime; value: number; easing: string }[]; from: T.RationalTime; to: T.RationalTime };
      expect(a.property).toBe(p);
      expect(a.keys.map((k) => k.easing)).toEqual(['smooth', 'smooth']);
      expect(a.keys[1]).toEqual({ time: f(15), value: p === 'x' ? 0.3 : -0.1, easing: 'smooth' });
      expect(a.from).toEqual(f(0));
      expect(a.to).toEqual(f(15));
    }
    expect(bendOps(c, R, 10, 11, 0, 0).ops).toEqual([]);
  });
  it('an unkeyed axis is keyed at the other axis\'s keys at its static value, the bent segment smooth', () => {
    const { doc, clipId } = titled([[0, 0, 'ease-in'], [30, 0.2, 'linear'], [60, 0.1, 'linear']]);
    const r = bendOps(clipOf(doc, clipId), R, 30, 60, 0.15, 0.4);
    expect(r.frame).toBe(45);
    const y = r.ops.find((o) => (o.args as { property: string }).property === 'y')!.args as { keys: { time: T.RationalTime; value: number; easing: string }[] };
    expect(y.keys).toEqual([{ time: f(0), value: 0.2, easing: 'ease-in' }, { time: f(30), value: 0.2, easing: 'smooth' }, { time: f(45), value: 0.4, easing: 'smooth' }, { time: f(60), value: 0.2, easing: 'linear' }]);
    expect(r.ops.length).toBeLessThanOrEqual(2);
  });
  built('applied: the path goes through the pointer at the middle frame, smooth on both sides, one undo step', () => {
    const { doc, clipId } = titled([[0, -0.3, 'linear'], [40, 0.3, 'linear'], [80, 0, 'linear']]);
    const before = clipOf(doc, clipId);
    const r = bendOps(before, R, 0, 40, 0, 0.35);
    const after = clipOf(applyExact(doc, r.ops), clipId);
    expect(shown(after, 20).x).toBe(0);
    expect(shown(after, 20).y).toBe(0.35);
    const xs = after.keyframes!.x!;
    expect(xs.find((k) => T.eq(k.time, f(0)))!.easing).toBe('smooth');
    expect(xs.find((k) => T.eq(k.time, f(20)))!.easing).toBe('smooth');
    // the rest of the path outside the bent segment moved by at most what bendOps reported
    for (let fr = 41; fr < 90; fr++) {
      expect(Math.abs(shown(after, fr).x - shown(before, fr).x)).toBeLessThanOrEqual(r.maxDeviation.x);
      expect(Object.is(shown(after, fr).y, shown(before, fr).y)).toBe(true);
    }
    expect(r.exact).toBe(r.maxDeviation.x === 0 && r.maxDeviation.y === 0);
  });
});
