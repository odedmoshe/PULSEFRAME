/**
 * The motion path's vertex moves (pathMove.ts, used by MotionPath.tsx) write only the axis the gesture moved: the other axis
 * keeps its exact value, also when that value is interpolated or a key value off the 1e-4 grid (a REST/MCP edit).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, transformAt, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { dragTarget, vertexMoveOps, vertexNudgeOps } from './pathMove.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `pm${seed++}_`, actor: 'test' });

/** A 60-frame title with x keyed at 0, 10 and 30, and y keyed as given. */
function clipWith(yKeys: [number, number, string][]): Clip {
  let doc = createProject({ id: 'prj_pm', name: 'Path move', width: 1280, height: 720, frameRate: R });
  const r = tx(doc, [{ op: 'add_text', args: { text: 'מסלול', start: f(12), duration: f(60), transform: { x: 0.1, y: 0.2 } } }]);
  doc = r.doc;
  const clipId = (r.results[0]!.output as { clipId: string }).clipId;
  const keys: [string, number, number, string][] = [
    ['x', 0, -0.2, 'linear'], ['x', 10, 0.05, 'ease-in-out'], ['x', 30, 0.3, 'linear'],
    ...yKeys.map(([fr, v, e]) => ['y', fr, v, e] as [string, number, number, string]),
  ];
  doc = tx(doc, keys.map(([property, fr, value, easing]) => ({ op: 'set_keyframe', args: { clipId, property, time: f(fr), value, easing } }))).doc;
  return findClip(doc, clipId)!.clip;
}
const props = (ops: OpCall[]) => ops.map((o) => (o.args as { property: string }).property);
const yAt = (c: Clip, fr: number) => transformAt(c, T.add(c.start, f(fr))).y;

describe('vertex moves write only the moved axis', () => {
  it('ArrowRight with a y key off the 1e-4 grid at the vertex: one x op, no y op', () => {
    const c = clipWith([[10, 0.0987654321, 'linear'], [30, 0.2, 'linear']]);
    const ops = vertexNudgeOps(c, R, 10, 0.01, 0);
    expect(props(ops)).toEqual(['x']);
    const x = (ops[0]!.args as { keys: { value: number }[] }).keys[0]!.value;
    expect(x).toBe(0.06);
  });
  it('ArrowDown with an interpolated x at the vertex frame: one y op, no x op', () => {
    const c = clipWith([[0, 0, 'linear'], [15, 0.1, 'linear'], [30, 0.2, 'linear']]);
    // frame 15: x is interpolated (ease-in-out between 10 and 30), y has a key
    expect(props(vertexNudgeOps(c, R, 15, 0, 0.01))).toEqual(['y']);
  });
  it('a horizontal drag with y interpolated (ease-in-out, off the grid): no y op, no new y key', () => {
    const c = clipWith([[0, 0, 'ease-in-out'], [30, 0.1, 'linear']]);
    const before = yAt(c, 10);
    expect(Object.is(Math.round(before * 1e4) / 1e4, before)).toBe(false); // the case the reviewer found
    const tr = transformAt(c, T.add(c.start, f(10)));
    const to = dragTarget({ x: tr.x, y: tr.y }, { x: 40, y: 0 }, { w: 640, h: 360 }, 6);
    expect(to.y).toBeUndefined();
    const ops = vertexMoveOps(c, R, 10, to);
    expect(props(ops)).toEqual(['x']);
    expect((ops[0]!.args as { keys: { value: number }[] }).keys[0]!.value).toBe(Math.round((tr.x + 40 / 640) * 1e4) / 1e4);
  });
  it('a vertical drag: no x op even when x is interpolated', () => {
    const c = clipWith([[0, 0, 'linear'], [15, 0.05, 'linear']]);
    const tr = transformAt(c, T.add(c.start, f(15)));
    const to = dragTarget({ x: tr.x, y: tr.y }, { x: 0, y: -30 }, { w: 640, h: 360 }, 6);
    expect(to.x).toBeUndefined();
    expect(props(vertexMoveOps(c, R, 15, to))).toEqual(['y']);
  });
  it('the centre snap applies only to a moved axis: an untouched y within 6 px of the centre keeps its value', () => {
    const c = clipWith([[0, 0.004, 'linear'], [10, 0.00512345, 'linear'], [30, 0.006, 'linear']]);
    const tr = transformAt(c, T.add(c.start, f(10)));
    expect(Math.abs(tr.y * 360)).toBeLessThanOrEqual(6);
    const to = dragTarget({ x: tr.x, y: tr.y }, { x: 25, y: 0 }, { w: 640, h: 360 }, 6);
    expect(to).toEqual({ x: tr.x + 25 / 640 });
    expect(props(vertexMoveOps(c, R, 10, to))).toEqual(['x']);
  });
  it('a moved axis still snaps to the centre and rounds; no axis moved makes no op', () => {
    expect(dragTarget({ x: 0.02, y: 0.3 }, { x: -10, y: 4 }, { w: 640, h: 360 }, 6)).toEqual({ x: 0, y: 0.3 + 4 / 360 });
    const c = clipWith([[0, 0, 'linear'], [10, 0.1, 'linear']]);
    expect(vertexMoveOps(c, R, 10, {})).toEqual([]);
    expect(vertexNudgeOps(c, R, 10, 0, 0)).toEqual([]);
  });
});
