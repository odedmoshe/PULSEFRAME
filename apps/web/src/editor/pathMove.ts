/**
 * Where a motion path vertex move lands (MotionPath.tsx; ADR-0019 W3). Pure, so the rule is testable without a DOM.
 *
 * Only the axes the gesture actually moved are snapped, rounded to 1e-4 and written. An axis the gesture did not move keeps
 * the exact value the clip has at that frame (an interpolated value, or a key value set over REST or MCP, is generally not on
 * a 1e-4 grid), so pathEdits.ts moveVertexOps makes no op for it and the path elsewhere stays unchanged exactly (plan §5).
 */
import * as T from '@pulseframe/time';
import { moveVertexOps, transformAt, type Clip, type OpCall } from '@pulseframe/core';

export const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

/** The new value of each moved axis (transform units, before rounding); an axis left out was not moved. */
export interface VertexTarget { x?: number; y?: number }

/**
 * The target of a pointer drag: an axis along which the pointer moved (a non-zero delta in CSS px) takes start + delta / size,
 * snapped to the centre (0) within snapPx; an axis along which it did not move is left out.
 */
export function dragTarget(start: { x: number; y: number }, dpx: { x: number; y: number }, size: { w: number; h: number }, snapPx: number): VertexTarget {
  const out: VertexTarget = {};
  if (dpx.x !== 0) { const v = start.x + dpx.x / size.w; out.x = Math.abs(v * size.w) <= snapPx ? 0 : v; }
  if (dpx.y !== 0) { const v = start.y + dpx.y / size.h; out.y = Math.abs(v * size.h) <= snapPx ? 0 : v; }
  return out;
}

/**
 * The ops that move the vertex at clip-local `frame` of `c` (the clip as the document holds it when the commit's turn comes):
 * the moved axes rounded to 1e-4, the others at their exact current value, and never an op for an axis that was not moved.
 */
export function vertexMoveOps(c: Clip, rate: T.Rate, frame: number, to: VertexTarget): OpCall[] {
  if (to.x === undefined && to.y === undefined) return [];
  const tr = transformAt(c, T.add(c.start, T.frameTime(frame, rate)));
  const x = to.x === undefined ? tr.x : round4(to.x);
  const y = to.y === undefined ? tr.y : round4(to.y);
  return moveVertexOps(c, rate, frame, x, y).ops.filter((o) => {
    const p = (o.args as { property?: string }).property;
    return p === 'x' ? to.x !== undefined : p === 'y' ? to.y !== undefined : true;
  });
}

/** The ops of an arrow-key nudge by (dx, dy) transform units: only the axis with a non-zero step is written. */
export function vertexNudgeOps(c: Clip, rate: T.Rate, frame: number, dx: number, dy: number): OpCall[] {
  const tr = transformAt(c, T.add(c.start, T.frameTime(frame, rate)));
  return vertexMoveOps(c, rate, frame, { ...(dx !== 0 ? { x: tr.x + dx } : {}), ...(dy !== 0 ? { y: tr.y + dy } : {}) });
}
