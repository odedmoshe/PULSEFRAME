/**
 * Motion path edits (ADR-0019, W3; the lead's contracts commit fixed the signatures): the path of a clip's x/y keys on the
 * stage, and the operations a vertex drag or a bend makes. Pure; the editor calls them inside commit(() => …), so they read
 * the clip as it is when the edit's turn comes.
 *
 * The path is the clip's OWN x/y, sampled exactly as animation.ts transformAt samples them (sampleKeyframes with
 * TRANSFORM_RANGE at the clip-local frame time), so it is the curve preview, render_frame and export draw (ADR-0005). A clip
 * that follows a motion track (clip.follow, ADR-0015) is not drawn in wave 1: its on-screen path is the follow post-pass's
 * (engine follow.ts resolveFollows) and comes with ADR-0015's monitor path overlay in wave 2 (wave4-decisions.md); the editor
 * states that reason instead (i18n keys.path.follower).
 *
 * Writes: replace_clip_keyframes in its RANGE form (shortsContract.ts: from/to, the keys outside the range are kept, also keys
 * before the clip start that a trim or split left; new keys are never negative), at most one per axis, so ≤ 2 ops per gesture
 * and one undo step. An axis whose value does not change gets no op.
 * - A vertex move on an axis WITHOUT keys keys that axis at every key time of the other axis, with its static value and the
 *   other axis's curves, the moved frame taking the new value: every segment that does not touch the moved key is flat at the
 *   static value, so the path elsewhere is unchanged exactly (a + 0·shape = a for every curve, curves.ts smoothValue too).
 * - On a keyed axis an existing key at the frame keeps its curve and takes the new value; a missing one is inserted with
 *   curves.ts splitSegment (every curve, v1 included: these are new edits, not replays of set_keyframe), so the curve keeps its
 *   shape; `exact` is false when that insertion was approximate. A segment whose start key lies before the clip start (a trim
 *   or split left it) cannot be rewritten (new keys are never negative): the key is then added alone, and exact is false.
 * - A bend inserts an x+y vertex at floor((a + b) / 2) through the pointer, with 'smooth' on the segment that ends there and the
 *   one that starts there. maxDeviation (transform units, per axis) is how far the path moved on the frames of the clip outside
 *   the axis's own bent segment (Steffen slopes of 'smooth' neighbours follow the new key); exact is true when both are 0 and
 *   the pointer was inside the channel range.
 */
import * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Clip } from './schema.ts';
import type { Keyframe } from './keyframe.ts';
import { sampleKeyframes, TRANSFORM_RANGE } from './animation.ts';
import { splitSegment } from './curves.ts';

/** One point of the path, in transform units (fractions of the frame width/height from the centre). */
export interface PathPoint { frame: number; x: number; y: number }
type Axis = 'x' | 'y';
const OTHER: Record<Axis, Axis> = { x: 'y', y: 'x' };
/** The most points pathPoints returns by default (key frames are kept above it). */
export const PATH_MAX_POINTS = 600;

const framesOf = (clip: Clip, rate: T.Rate) => Math.max(0, T.frameCount(clip.duration, rate));
const keysOf = (clip: Clip, p: Axis): readonly Keyframe[] => clip.keyframes?.[p] ?? [];
/** The value of one axis at a clip-local frame, as transformAt computes it. */
const valueAt = (clip: Clip, p: Axis, local: T.RationalTime): number => {
  const keys = keysOf(clip, p);
  return keys.length ? sampleKeyframes(keys, local, TRANSFORM_RANGE[p]) : clip.transform[p];
};
const clampTo = (p: Axis, v: number) => { const r = TRANSFORM_RANGE[p]; return v < r.min ? r.min : v > r.max ? r.max : v; };
/** A key as stored: `bezier` only with easing 'bezier' (as ops.ts storedKey). */
const key = (time: T.RationalTime, value: number, k: Pick<Keyframe, 'easing' | 'bezier'>): Keyframe =>
  k.easing === 'bezier' && k.bezier ? { time, value, easing: 'bezier', bezier: [...k.bezier] as Keyframe['bezier'] } : { time, value, easing: k.easing };
const copy = (k: Keyframe): Keyframe => key(k.time, k.value, k);
/** The axis's keys after a range write: the keys outside [from, to] kept, the new ones put in time order. */
const afterRange = (keys: readonly Keyframe[], from: T.RationalTime, to: T.RationalTime, fresh: readonly Keyframe[]): Keyframe[] =>
  [...keys.filter((k) => T.lt(k.time, from) || T.lt(to, k.time)), ...fresh].sort((a, b) => T.cmp(a.time, b.time));
const rangeOp = (clip: Clip, p: Axis, fresh: Keyframe[]): OpCall => ({
  op: 'replace_clip_keyframes',
  args: { clipId: clip.id, property: p, keys: fresh, from: fresh[0]!.time, to: fresh[fresh.length - 1]!.time },
});

/** transformAt's x and y for each frame of [0, frame count); decimated above `max` (default 600) points, every key frame kept. */
export function pathPoints(clip: Clip, rate: T.Rate, max: number = PATH_MAX_POINTS): PathPoint[] {
  const n = framesOf(clip, rate);
  if (n === 0) return [];
  let frames: number[];
  if (n <= max) frames = Array.from({ length: n }, (_, f) => f);
  else {
    const keep = new Set<number>(vertexFrames(clip, rate));
    keep.add(0); keep.add(n - 1);
    const even = Math.max(2, max - keep.size);
    for (let i = 0; i < even; i++) keep.add(Math.round((i * (n - 1)) / (even - 1)));
    frames = [...keep].sort((a, b) => a - b);
  }
  const xs = keysOf(clip, 'x'), ys = keysOf(clip, 'y');
  return frames.map((frame) => {
    const t = T.frameTime(frame, rate);
    return { frame, x: xs.length ? sampleKeyframes(xs, t, TRANSFORM_RANGE.x) : clip.transform.x, y: ys.length ? sampleKeyframes(ys, t, TRANSFORM_RANGE.y) : clip.transform.y };
  });
}

/** Frames inside the clip where x or y has a key, ascending. */
export function vertexFrames(clip: Clip, rate: T.Rate): number[] {
  const n = framesOf(clip, rate);
  const out = new Set<number>();
  for (const p of ['x', 'y'] as const) for (const k of keysOf(clip, p)) {
    if (!T.isFrameAligned(k.time, rate)) continue;
    const f = T.frameIndexAt(k.time, rate);
    if (f >= 0 && f < n) out.add(f);
  }
  return [...out].sort((a, b) => a - b);
}

interface AxisEdit { op: OpCall | null; exact: boolean; after: readonly Keyframe[] }

/** Put `v` on axis p at clip-local time t (moveVertexOps): the rules in the header. */
function moveAxis(clip: Clip, rate: T.Rate, p: Axis, t: T.RationalTime, raw: number): AxisEdit {
  const keys = keysOf(clip, p);
  const v = clampTo(p, raw);
  if (Object.is(valueAt(clip, p, t), v)) return { op: null, exact: true, after: keys };
  if (!keys.length) {
    // key it at every key time of the other axis (never before the clip start), static value and the other axis's curves
    const stat = clip.transform[p];
    const fresh: Keyframe[] = [];
    let placed = false;
    for (const o of keysOf(clip, OTHER[p])) {
      if (T.isNegative(o.time)) continue;
      if (!placed && T.lt(t, o.time)) { fresh.push(key(t, v, { easing: 'linear' })); placed = true; }
      const on = T.eq(o.time, t);
      fresh.push(key(o.time, on ? v : stat, o));
      if (on) placed = true;
    }
    if (!placed) fresh.push(key(t, v, { easing: 'linear' }));
    return { op: rangeOp(clip, p, fresh), exact: true, after: fresh };
  }
  const at = keys.findIndex((k) => T.eq(k.time, t));
  if (at >= 0) {
    const fresh = [key(t, v, keys[at]!)];
    return { op: rangeOp(clip, p, fresh), exact: true, after: afterRange(keys, t, t, fresh) };
  }
  const hi = keys.findIndex((k) => T.lt(t, k.time));
  if (hi <= 0) {
    // before the first key or after the last: the new key takes the other axis's curve at this frame (else straight)
    const o = keysOf(clip, OTHER[p]).find((k) => T.eq(k.time, t));
    const fresh = [key(t, v, o ?? { easing: 'linear' })];
    return { op: rangeOp(clip, p, fresh), exact: true, after: afterRange(keys, t, t, fresh) };
  }
  const a = keys[hi - 1]!, b = keys[hi]!;
  if (T.isNegative(a.time)) {
    const fresh = [key(t, v, a)];
    return { op: rangeOp(clip, p, fresh), exact: false, after: afterRange(keys, t, t, fresh) };
  }
  const split = splitSegment(keys, t, rate, TRANSFORM_RANGE[p]);
  const fresh = split.keys.filter((k) => T.lte(a.time, k.time) && T.lte(k.time, b.time)).map((k) => (T.eq(k.time, t) ? key(t, v, k) : copy(k)));
  return { op: rangeOp(clip, p, fresh), exact: split.exact, after: afterRange(keys, a.time, b.time, fresh) };
}

/**
 * Move the vertex at `frame` to (x, y) (transform units): ≤ 2 replace_clip_keyframes. An axis with no keys is keyed at every
 * vertex with its static value and the same curves, so the path elsewhere is unchanged exactly; a missing key on a keyed axis
 * is inserted with curves.ts splitSegment (`exact` false when that insertion was approximate).
 */
export function moveVertexOps(clip: Clip, rate: T.Rate, frame: number, x: number, y: number): { ops: OpCall[]; exact: boolean } {
  const t = T.frameTime(frame, rate);
  const ex = moveAxis(clip, rate, 'x', t, x), ey = moveAxis(clip, rate, 'y', t, y);
  return { ops: [ex.op, ey.op].filter((o): o is OpCall => !!o), exact: ex.exact && ey.exact };
}

/** Insert a 'smooth' key with value v at t on axis p, the segment ending there made 'smooth' too (bendOps). */
function bendAxis(clip: Clip, rate: T.Rate, p: Axis, t: T.RationalTime, raw: number): AxisEdit & { clamped: boolean; span: [number, number] } {
  const keys = keysOf(clip, p);
  const v = clampTo(p, raw);
  const clamped = !Object.is(v, raw);
  const smooth = { easing: 'smooth' as const };
  const n = framesOf(clip, rate);
  if (!keys.length) {
    const stat = clip.transform[p];
    const others = keysOf(clip, OTHER[p]).filter((o) => !T.isNegative(o.time));
    const fresh: Keyframe[] = [];
    let prev = -1;
    for (const o of others) if (T.lt(o.time, t)) prev++;
    others.forEach((o, i) => { if (!T.eq(o.time, t)) fresh.push(key(o.time, stat, i === prev ? smooth : o)); });
    fresh.push(key(t, v, smooth));
    fresh.sort((a, b) => T.cmp(a.time, b.time));
    return { op: rangeOp(clip, p, fresh), exact: !clamped, after: fresh, clamped, span: [prev >= 0 ? T.frameIndexAt(others[prev]!.time, rate) : 0, others[prev + 1] ? T.frameIndexAt(others[prev + 1]!.time, rate) : n] };
  }
  const at = keys.findIndex((k) => T.eq(k.time, t));
  const hi = at >= 0 ? at + 1 : keys.findIndex((k) => T.lt(t, k.time));
  const lo = at >= 0 ? at - 1 : hi < 0 ? keys.length - 1 : hi - 1; // the key the segment ending at t starts from (-1: none)
  const next = hi >= 0 && hi < keys.length ? keys[hi]! : null;
  const prevKey = lo >= 0 ? keys[lo]! : null;
  const fresh: Keyframe[] = [];
  let exact = !clamped;
  if (prevKey && !T.isNegative(prevKey.time)) fresh.push(key(prevKey.time, prevKey.value, smooth));
  else if (prevKey) exact = false; // a key before the clip start cannot be rewritten: its segment keeps its curve
  fresh.push(key(t, v, smooth));
  const after = afterRange(keys, fresh[0]!.time, t, fresh);
  const span: [number, number] = [prevKey ? T.frameIndexAt(prevKey.time, rate) : 0, next ? T.frameIndexAt(next.time, rate) : n];
  return { op: rangeOp(clip, p, fresh), exact, after, clamped, span };
}

/** Insert an x+y vertex at floor((a + b) / 2) through (x, y), with 'smooth' on both sides of it. */
export function bendOps(clip: Clip, rate: T.Rate, a: number, b: number, x: number, y: number): { ops: OpCall[]; frame: number; exact: boolean; maxDeviation: { x: number; y: number } } {
  const frame = Math.floor((a + b) / 2);
  if (frame <= Math.min(a, b) || frame >= Math.max(a, b)) return { ops: [], frame, exact: true, maxDeviation: { x: 0, y: 0 } };
  const t = T.frameTime(frame, rate);
  const n = framesOf(clip, rate);
  const dev = { x: 0, y: 0 };
  const ops: OpCall[] = [];
  let exact = true;
  for (const p of ['x', 'y'] as const) {
    const e = bendAxis(clip, rate, p, t, p === 'x' ? x : y);
    if (e.op) ops.push(e.op);
    exact &&= e.exact;
    // how far the rest of the path moved: the frames of the clip outside the axis's own bent segment
    const before = keysOf(clip, p);
    for (let f = 0; f < n; f++) {
      if (f >= e.span[0] && f <= e.span[1]) continue;
      const tf = T.frameTime(f, rate);
      const was = before.length ? sampleKeyframes(before, tf, TRANSFORM_RANGE[p]) : clip.transform[p];
      const now = e.after.length ? sampleKeyframes(e.after, tf, TRANSFORM_RANGE[p]) : clip.transform[p];
      const d = Math.abs(now - was);
      if (d > dev[p]) dev[p] = d;
    }
  }
  return { ops, frame, exact: exact && dev.x === 0 && dev.y === 0, maxDeviation: dev };
}
