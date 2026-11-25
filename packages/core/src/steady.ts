/**
 * Pure maths of stabilisation (wave 7 stabilise track; stabilise-decisions.md §2.3, §2.8; plan §4.3–4.4 as corrected).
 *
 * STEADY_MATHS_V1 — FROZEN WITH VERSION 1 OF set_clip_stabilise. The operation stores a zoom (and a strength chosen by bisection)
 * computed here, and the op log is replayed and compared byte for byte (packages/evals/src/commit-equivalence.test.ts). A later
 * change to ANY rule below that can move a single bit of steadyPose, neededZoom, limitToCover or planStabilise must: register
 * set_clip_stabilise version 2 with the new maths beside the old one (the old functions stay, unchanged, for replaying version 1),
 * add an optional `v` to ClipStabiliseSchema that selects the maths a clip is drawn with (absent = 1), and bump STEADY_MATHS_V1's
 * successor. The cross-runtime digest STEADY_SELFTEST_DIGEST below (also compared in headless Chromium) fails on such a change.
 *
 * Arithmetic: only + − × / on IEEE-754 doubles, in a fixed order, plus the exact helpers Math.round, floor, trunc, abs, min, max
 * — never Math.sin, cos, tan, exp, log, pow, atan, hypot or sqrt (a unit test reads this file and fails if it does). JavaScript
 * has no fused multiply-add and each of these operations is correctly rounded, so Node and Chromium give the same bits.
 * The rotation and log-scale of a composed motion are sums of the stored integers (exact); translations are doubles composed
 * afresh for every frame from the stored integers (nothing is carried from one frame to the next, so nothing accumulates).
 *
 * Units: a similarity about the picture centre, p' = e^l·R(r)·p + t, with p and t in units of the source picture's WIDTH (the
 * content rectangle is [−½, ½] × [−h, h], h = srcH / (2·srcW)), r in radians clockwise (y down), l = ln(scale).
 * A stored sample D(j) is the motion of the static scene from frame j−1 to frame j (it maps a point of frame j−1 to frame j).
 *
 * Rules (each function below states the one it keeps):
 * - Links. Sample j links frame j−1 to frame j when it is ok or weak; a `start` sample never links; an `unknown` run of 1–2
 *   samples is bridged with the mean of its immediate ok/weak neighbours (one or both; state kept, still counted as unknown) and
 *   is a boundary when neither neighbour is measured; a longer unknown run is a boundary at every one of its samples.
 * - Window: symmetric truncated. For frame k with half-window R (steadyContract steadyHalfWindow) inside its linked segment
 *   [lo, hi], R_eff = min(R, k−lo, hi−k); weights w(d) = ((R_eff+1)² − d²)² (the biweight times (R_eff+1)⁴, integers);
 *   B(k) = Σ_{|d|≤R_eff} w(|d|)·M(k→k+d) / Σ w, parameter by parameter, where M(k→j) is composed from the deltas between k and j.
 *   A steady pan (constant translation) gets exactly no correction (the forward and backward terms of each distance are added
 *   first and cancel exactly), as does a steady turn or zoom about the centre; a constant motion that turns AND translates keeps
 *   a second-order residual of the parameter-wise mean (steady.test.ts records it: 9.7e-4 of the width at strength 100 for
 *   0.04°/frame with a 0.2 %/frame pan). The correction falls to none at a boundary.
 * - The correction drawn on frame k is B(k): content point p is drawn where the neighbouring frames, on average, show it.
 *   (The pre-pass header said "the inverse of B(k)"; with the kernel's convention — D maps frame j−1 to frame j, see
 *   apps/server/src/vision/steady.ts PairMeasure.sim — B(k) itself is the correction; a one-frame shake test pins it.)
 * - Outside every stretch: the pose of the nearest measured frame (the earlier on a tie), state `outside`; nothing extrapolated.
 * - Cover: neededZoom is closed form (one division per corner and axis); limitToCover scales the pose toward identity by one
 *   gain found with 20 bisection steps from [0, 1]; identity always covers at zoom ≥ 1, so no empty edge is ever shown.
 * - Poses are cached per stretch object × half-window R (R is a function of strength × rate) in a WeakMap, shared by evaluate and
 *   planStabilise; the cache never changes a result.
 */
import * as T from '@pulseframe/time';
import { fitScale, type Fit } from './geometry.ts';
import type { MediaClip, ProjectDocument, Transform } from './schema.ts';
import { sourceFrameIndexAt } from './speed.ts';
import {
  SST, STEADY_MIN_STRENGTH, STEADY_SCALE_UNIT, STEADY_ANGLE_UNIT, STEADY_STATES, STEADY_UNIT, steadyHalfWindow, stretchEnd,
  type CameraMotion, type CameraStretch,
} from './steadyContract.ts';
import { velocityOffsets } from './transitionTiming.ts';
import type { LimitedFrame, SetClipStabiliseOutput } from './steadyOps.ts';

/** A similarity about the picture centre: r radians clockwise, l = ln(scale), tx/ty in source-width units. */
export interface Similarity { r: number; l: number; tx: number; ty: number }
export type SteadyPoseState = 'ok' | 'weak' | 'unknown' | 'start' | 'outside';
/** The correction for one source frame. boundary: the window was truncated by a boundary (weaker smoothing there). */
export interface SteadyPose extends Similarity { state: SteadyPoseState; boundary: boolean }
export interface StabilisePlan {
  strength: number; zoomPm: number; areaPercent: number;
  measured: SetClipStabiliseOutput['measured'];
  strengthLowered: boolean;
  limitedFrames: LimitedFrame[];
}
export interface ClipFrames { first: number; last: number; /** Frames a velocity ramp or a transition handle reaches outside [first, last]. */ reach: { first: number; last: number } }

export const IDENTITY_POSE: Readonly<Similarity> = Object.freeze({ r: 0, l: 0, tx: 0, ty: 0 });
const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------- elementary functions ----------------------------------------------------------------
/**
 * [sin x, cos x]. Rule: x is reduced by the nearest whole turn (Math.round(x / 2π)), divided by 8 (exact), the Taylor series of
 * sin to y¹⁵ and of cos to y¹⁶ is evaluated by Horner's rule in this fixed order, then three doublings (sin 2y = 2·s·c,
 * cos 2y = 1 − 2·s²). Within 1e-12 of Math over |x| ≤ 100 (steady.test.ts, S8); exactly [0, 1] at 0.
 */
export function sinCos(x: number): [number, number] {
  const k = Math.round(x / TWO_PI);
  const y = (x - k * TWO_PI) / 8;
  const y2 = y * y;
  let s = y * (1 - (y2 / 6) * (1 - (y2 / 20) * (1 - (y2 / 42) * (1 - (y2 / 72) * (1 - (y2 / 110) * (1 - (y2 / 156) * (1 - y2 / 210)))))));
  let c = 1 - (y2 / 2) * (1 - (y2 / 12) * (1 - (y2 / 30) * (1 - (y2 / 56) * (1 - (y2 / 90) * (1 - (y2 / 132) * (1 - (y2 / 182) * (1 - y2 / 240)))))));
  for (let i = 0; i < 3; i++) { const s2 = 2 * s * c; c = 1 - 2 * s * s; s = s2; }
  return [s, c];
}
/**
 * e^x. Rule: x is halved (exactly) at least three times and until |y| ≤ 1/8, the Taylor series to y¹³ is evaluated by Horner's
 * rule, then squared once per halving. Within 1e-12 (relative) of Math.exp over |x| ≤ 1; exactly 1 at 0.
 */
export function expm(x: number): number {
  if (!Number.isFinite(x)) return x > 0 ? Infinity : x < 0 ? 0 : NaN;
  let y = x, h = 0;
  while (h < 3 || Math.abs(y) > 0.125) { y /= 2; h++; }
  let e = 1 + y * (1 + (y / 2) * (1 + (y / 3) * (1 + (y / 4) * (1 + (y / 5) * (1 + (y / 6) * (1 + (y / 7) * (1 + (y / 8) * (1 + (y / 9) * (1 + (y / 10) * (1 + (y / 11) * (1 + (y / 12) * (1 + y / 13))))))))))));
  for (let i = 0; i < h; i++) e *= e;
  return e;
}

// ---------------------------------------------------------------- similarities ----------------------------------------------------------------
/** a after b: (a ∘ b)(p) = a(b(p)) = e^(la+lb)·R(ra+rb)·p + e^la·R(ra)·tb + ta. */
export function compose(a: Similarity, b: Similarity): Similarity {
  const [s, c] = sinCos(a.r), e = expm(a.l);
  return { r: a.r + b.r, l: a.l + b.l, tx: e * (c * b.tx - s * b.ty) + a.tx, ty: e * (s * b.tx + c * b.ty) + a.ty };
}
/** The inverse: p = e^−l·R(−r)·(p' − t), so r' = −r, l' = −l, t' = −e^−l·R(−r)·t. */
export function inverse(a: Similarity): Similarity {
  const [s, c] = sinCos(a.r), e = expm(-a.l);
  return { r: -a.r, l: -a.l, tx: -(e * (c * a.tx + s * a.ty)), ty: -(e * (-s * a.tx + c * a.ty)) };
}

// ---------------------------------------------------------------- one stretch, prepared once ----------------------------------------------------------------
const OKW = (code: number | undefined) => code === SST.ok || code === SST.weak;
/** A stretch's links and deltas, worked out once per stretch object. Doubled integers (d2 = 2·d, or the sum of two neighbours). */
interface Prep {
  n: number;
  /** link[j] = 1 when sample j links frame j−1 to frame j (j ≥ 1). */
  link: Uint8Array;
  /** Per sample: rotation and log-scale as doubled integers; cos, sin, e^l, e^−l of the delta; translation in width units. */
  r2: Float64Array; l2: Float64Array; cs: Float64Array; sn: Float64Array; ex: Float64Array; exn: Float64Array; tx: Float64Array; ty: Float64Array;
  /** Per frame: the first and last frame of its linked segment. */
  lo: Int32Array; hi: Int32Array;
}
const preps = new WeakMap<CameraStretch, Prep>();
/**
 * Rule (links): sample j ≥ 1 links when ok/weak (its own delta); an unknown run u..v of at most 2 samples links each of its
 * samples with the mean of the ok/weak samples among u−1 and v+1 (the immediate neighbours inside the stretch; sample 0 is a
 * start and never counts) when there is at least one; otherwise, and for a longer unknown run and every start, no link.
 */
function prepare(s: CameraStretch): Prep {
  const hit = preps.get(s);
  if (hit) return hit;
  const n = s.st.length;
  const p: Prep = {
    n, link: new Uint8Array(n), r2: new Float64Array(n), l2: new Float64Array(n), cs: new Float64Array(n).fill(1), sn: new Float64Array(n), ex: new Float64Array(n).fill(1), exn: new Float64Array(n).fill(1),
    tx: new Float64Array(n), ty: new Float64Array(n), lo: new Int32Array(n), hi: new Int32Array(n),
  };
  const dx2 = new Float64Array(n), dy2 = new Float64Array(n);
  const take = (j: number, x2: number, y2: number, r2: number, l2: number) => { p.link[j] = 1; dx2[j] = x2; dy2[j] = y2; p.r2[j] = r2; p.l2[j] = l2; };
  for (let j = 1; j < n; j++) {
    const code = s.st[j];
    if (OKW(code)) { take(j, 2 * s.dx[j]!, 2 * s.dy[j]!, 2 * s.dr[j]!, 2 * s.dz[j]!); continue; }
    if (code !== SST.unknown) continue;
    let u = j, v = j;
    while (u - 1 >= 1 && s.st[u - 1] === SST.unknown) u--;
    while (v + 1 < n && s.st[v + 1] === SST.unknown) v++;
    if (v - u + 1 > 2) continue;
    const nb = [u - 1, v + 1].filter((k) => k >= 1 && k < n && OKW(s.st[k]));
    if (nb.length === 2) take(j, s.dx[nb[0]!]! + s.dx[nb[1]!]!, s.dy[nb[0]!]! + s.dy[nb[1]!]!, s.dr[nb[0]!]! + s.dr[nb[1]!]!, s.dz[nb[0]!]! + s.dz[nb[1]!]!);
    else if (nb.length === 1) take(j, 2 * s.dx[nb[0]!]!, 2 * s.dy[nb[0]!]!, 2 * s.dr[nb[0]!]!, 2 * s.dz[nb[0]!]!);
  }
  for (let j = 1; j < n; j++) {
    if (!p.link[j]) continue;
    const [sn, cs] = sinCos(p.r2[j]! / (2 * STEADY_ANGLE_UNIT));
    p.sn[j] = sn; p.cs[j] = cs;
    p.ex[j] = expm(p.l2[j]! / (2 * STEADY_SCALE_UNIT)); p.exn[j] = expm(-p.l2[j]! / (2 * STEADY_SCALE_UNIT));
    p.tx[j] = dx2[j]! / (2 * STEADY_UNIT); p.ty[j] = dy2[j]! / (2 * STEADY_UNIT);
  }
  for (let i = 0, lo = 0; i < n; i++) { if (i > 0 && !p.link[i]) lo = i; p.lo[i] = lo; }
  for (let i = n - 1, hi = n - 1; i >= 0; i--) { if (i < n - 1 && !p.link[i + 1]) hi = i; p.hi[i] = hi; }
  preps.set(s, p);
  return p;
}

/**
 * Rule (window, smoothing): the correction of frame i of a prepared stretch at half-window R. R_eff = min(R, i−lo, hi−i); for
 * d = 1..R_eff the forward motion M(i→i+d) = D(i+d) ∘ M(i→i+d−1) and the backward motion M(i→i−d) = D(i−d+1)⁻¹ ∘ M(i→i−d+1)
 * are composed; the two are added first, then weighted by w(d) = ((R_eff+1)² − d²)²; d = 0 adds the identity with weight
 * (R_eff+1)⁴. Rotation and log-scale sums are exact integers (doubled); the mean divides once at the end.
 */
function windowPose(p: Prep, i: number, R: number): [number, number, number, number, boolean] {
  const re = Math.min(R, i - p.lo[i]!, p.hi[i]! - i);
  if (re <= 0) return [0, 0, 0, 0, R > 0];
  const W = (re + 1) * (re + 1);
  let sw = W * W, sR = 0, sL = 0, sX = 0, sY = 0;
  let fr = 0, fl = 0, fx = 0, fy = 0, br = 0, bl = 0, bx = 0, by = 0;
  for (let d = 1; d <= re; d++) {
    const j = i + d; // forward: apply D(j)
    const nx = p.ex[j]! * (p.cs[j]! * fx - p.sn[j]! * fy) + p.tx[j]!;
    const ny = p.ex[j]! * (p.sn[j]! * fx + p.cs[j]! * fy) + p.ty[j]!;
    fx = nx; fy = ny; fr += p.r2[j]!; fl += p.l2[j]!;
    const k = i - d + 1; // backward: apply D(k)⁻¹
    const ux = bx - p.tx[k]!, uy = by - p.ty[k]!;
    bx = p.exn[k]! * (p.cs[k]! * ux + p.sn[k]! * uy);
    by = p.exn[k]! * (-p.sn[k]! * ux + p.cs[k]! * uy);
    br -= p.r2[k]!; bl -= p.l2[k]!;
    const w = (W - d * d) * (W - d * d);
    sw += 2 * w;
    sR += w * (fr + br); sL += w * (fl + bl); sX += w * (fx + bx); sY += w * (fy + by);
  }
  return [sR / sw / (2 * STEADY_ANGLE_UNIT), sL / sw / (2 * STEADY_SCALE_UNIT), sX / sw, sY / sw, re < R];
}

/** Poses of a stretch at one half-window, filled frame by frame on demand. */
interface PoseCache { done: Uint8Array; v: Float64Array }
const poseCaches = new WeakMap<CameraStretch, Map<number, PoseCache>>();
function stretchPose(s: CameraStretch, i: number, R: number): Similarity & { boundary: boolean } {
  let byR = poseCaches.get(s);
  if (!byR) poseCaches.set(s, (byR = new Map()));
  let c = byR.get(R);
  if (!c) byR.set(R, (c = { done: new Uint8Array(s.st.length), v: new Float64Array(5 * s.st.length) }));
  if (!c.done[i]) {
    const [r, l, tx, ty, b] = windowPose(prepare(s), i, R);
    c.v[5 * i] = r; c.v[5 * i + 1] = l; c.v[5 * i + 2] = tx; c.v[5 * i + 3] = ty; c.v[5 * i + 4] = b ? 1 : 0;
    c.done[i] = 1;
  }
  return { r: c.v[5 * i]!, l: c.v[5 * i + 1]!, tx: c.v[5 * i + 2]!, ty: c.v[5 * i + 3]!, boundary: c.v[5 * i + 4] === 1 };
}

/** The stretch holding source frame `frame`, or the nearest measured frame of any stretch (the earlier on a tie). */
function locate(motion: CameraMotion, frame: number): { s: CameraStretch; i: number; outside: boolean } {
  let best: { s: CameraStretch; at: number; dist: number } | null = null;
  for (const s of motion.stretches) {
    const end = stretchEnd(s);
    if (frame >= s.from && frame < end) return { s, i: frame - s.from, outside: false };
    const at = frame < s.from ? s.from : end - 1;
    const dist = Math.abs(frame - at);
    if (!best || dist < best.dist || (dist === best.dist && at < best.at)) best = { s, at, dist };
  }
  if (!best) throw new Error('camera motion without stretches');
  return { s: best.s, i: best.at - best.s.from, outside: true };
}
const stateName = (code: number | undefined): Exclude<SteadyPoseState, 'outside'> => STEADY_STATES[code ?? 0] ?? 'unknown';

/**
 * The correction of source frame `frame` at a strength for a file numbered at `rate` (rules above). state: the frame's own
 * sample state, or `outside` (then the pose is the nearest measured frame's).
 */
export function steadyPose(motion: CameraMotion, frame: number, strength: number, rate: { num: number; den: number }): SteadyPose {
  const R = steadyHalfWindow(strength, rate);
  const at = locate(motion, frame);
  const pose = stretchPose(at.s, at.i, R);
  return { ...pose, state: at.outside ? 'outside' : stateName(at.s.st[at.i]) };
}

// ---------------------------------------------------------------- cover ----------------------------------------------------------------
/**
 * Rule (cover): the window [−½, ½] × [−h, h] is covered at zoom Z when every window corner c maps back inside the content
 * rectangle: q = e^−l·R(−r)·(c/Z − t). With a = e^−l·R(−r)·c and b = e^−l·R(−r)·t, q = a·u − b (u = 1/Z), and each corner and
 * axis bounds u by (b ± limit)/a; neededZoom = 1 / (the smallest bound). Infinity when the translation alone leaves the picture
 * (|b| ≥ limit). Corners suffice: both rectangles are convex. The smallest zoom with which the corrected picture covers the
 * window; halfHeight = srcH / (2·srcW).
 */
export function neededZoom(pose: Similarity, halfHeight: number): number {
  const [s, c] = sinCos(pose.r), e = expm(-pose.l);
  const bx = e * (c * pose.tx + s * pose.ty), by = e * (-s * pose.tx + c * pose.ty);
  if (!(Math.abs(bx) < 0.5) || !(Math.abs(by) < halfHeight)) return Infinity;
  let u = Infinity;
  for (const cx of [-0.5, 0.5]) for (const cy of [-halfHeight, halfHeight]) {
    const ax = e * (c * cx + s * cy), ay = e * (-s * cx + c * cy);
    if (ax > 0) u = Math.min(u, (bx + 0.5) / ax); else if (ax < 0) u = Math.min(u, (bx - 0.5) / ax);
    if (ay > 0) u = Math.min(u, (by + halfHeight) / ay); else if (ay < 0) u = Math.min(u, (by - halfHeight) / ay);
  }
  return 1 / u;
}
const scaled = (p: Similarity, g: number): Similarity => ({ r: p.r * g, l: p.l * g, tx: p.tx * g, ty: p.ty * g });
/**
 * Rule (cover limit): when the pose needs more than `zoom`, it is scaled toward identity by one gain g: lo = 0 (identity,
 * which covers at any zoom ≥ 1), hi = 1; 20 steps of mid = (lo + hi)/2, lo = mid when it covers, else hi = mid; the pose at lo.
 * limited = the pose had to be weakened. The result always covers.
 */
export function limitToCover(pose: Similarity, zoom: number, halfHeight: number): { pose: Similarity; limited: boolean } {
  if (neededZoom(pose, halfHeight) <= zoom) return { pose: { r: pose.r, l: pose.l, tx: pose.tx, ty: pose.ty }, limited: false };
  let lo = 0, hi = 1;
  for (let k = 0; k < 20; k++) { const mid = (lo + hi) / 2; if (neededZoom(scaled(pose, mid), halfHeight) <= zoom) lo = mid; else hi = mid; }
  return { pose: scaled(pose, lo), limited: true };
}

// ---------------------------------------------------------------- the clip ----------------------------------------------------------------
const trackOf = (doc: ProjectDocument, clipId: string) => {
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) if (t.clips.some((c) => c.id === clipId)) return t;
  return undefined;
};
/**
 * The first and last source frame the clip shows now (sourceFrameIndexAt at its first and last timeline frame, the rule of
 * apps/server/src/tracking.ts trackingRange), and the reach: those widened by the source frames evaluate.ts draws for this clip
 * outside them — its own velocity ramp (the incoming side shows frames before its start) and the handle it plays on after its
 * end while the next clip's transition runs (with that transition's ramp). A clip whose file has no video gives frame 0.
 */
export function clipSourceFrames(doc: ProjectDocument, clip: MediaClip): ClipFrames {
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  if (!asset?.video) return { first: 0, last: 0, reach: { first: 0, last: 0 } };
  const rate = doc.settings.frameRate, one = T.frameTime(1, rate);
  const video = { ...asset, video: asset.video };
  const at = (t: T.RationalTime) => sourceFrameIndexAt(video, clip, t, rate);
  const end = T.add(clip.start, clip.duration);
  const a = at(clip.start), b = at(T.max(clip.start, T.sub(end, one)));
  const first = Math.min(a, b), last = Math.max(a, b);
  let lo = first, hi = last;
  const see = (t: T.RationalTime) => { const f = at(t); if (f < lo) lo = f; if (f > hi) hi = f; };
  const ownFrames = T.frameCount(clip.duration, rate);
  const tr = clip.transition;
  if (tr?.velocity) for (let local = 0; local < Math.min(tr.frames, ownFrames); local++) {
    const back = velocityOffsets(tr.frames, tr.velocity, local).in;
    if (back) see(T.sub(T.add(clip.start, T.frameTime(local, rate)), T.frameTime(back, rate)));
  }
  const next = trackOf(doc, clip.id)?.clips.find((c): c is MediaClip => c.type === 'media' && c.id !== clip.id && T.eq(c.start, end) && !!c.transition);
  if (next?.transition) {
    const nt = next.transition;
    for (let local = 0; local < Math.min(nt.frames, T.frameCount(next.duration, rate)); local++)
      see(T.add(end, T.frameTime(local + (nt.velocity ? velocityOffsets(nt.frames, nt.velocity, local).out : 0), rate)));
  }
  return { first, last, reach: { first: lo, last: hi } };
}

/**
 * Rule (counting): a source frame inside a stretch counts as its sample's state, except a `start` frame, which counts as the
 * sample that links it to the next frame when that one is ok or weak (its place in its shot is measured), else as unknown; a
 * frame no stretch holds counts as outside.
 */
function countState(motion: CameraMotion, frame: number): 'ok' | 'weak' | 'unknown' | 'outside' {
  for (const s of motion.stretches) {
    if (frame < s.from || frame >= stretchEnd(s)) continue;
    const i = frame - s.from;
    let code = s.st[i];
    if (code === SST.start) code = OKW(s.st[i + 1]) ? s.st[i + 1] : SST.unknown;
    return code === SST.ok ? 'ok' : code === SST.weak ? 'weak' : 'unknown';
  }
  return 'outside';
}
/** Counts of the clip's own source frames [first, last] (every source frame between them: the smoothing reads them all). */
export function measuredFrames(motion: CameraMotion | undefined, frames: Pick<ClipFrames, 'first' | 'last'>): SetClipStabiliseOutput['measured'] {
  const m = { frames: frames.last - frames.first + 1, ok: 0, weak: 0, unknown: 0, outside: 0 };
  for (let f = frames.first; f <= frames.last; f++) m[motion ? countState(motion, f) : 'outside']++;
  return m;
}
/** The crop condition in integers: 100·(1 − 10⁶/z²) ≤ maxCrop ⇔ 100·(z² − 10⁶) ≤ maxCrop·z². */
const cropFits = (zoomPm: number, maxCrop: number) => 100 * (zoomPm * zoomPm - 1_000_000) <= maxCrop * zoomPm * zoomPm;
/** The largest zoom (1/1000) whose crop is at most maxCrop percent of the area, by integer search. */
function zoomForCrop(maxCrop: number): number {
  let lo = 1000, hi = 2000;
  if (cropFits(hi, maxCrop)) return hi;
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (cropFits(mid, maxCrop)) lo = mid; else hi = mid; }
  return lo;
}
/** Rule (zoom): ceil(1000 · the largest neededZoom over the frames), at least 1000, at most 2000 (Infinity → 2000). */
const zoomPmOf = (need: number) => Math.max(1000, Math.min(2000, Math.ceil(1000 * need)));

/**
 * What set_clip_stabilise stores and the block shows while the slider moves.
 * - Frames: the clip's reach (clipSourceFrames: shown frames, its ramp and its handle), every source frame in it, so the zoom
 *   stays valid after a speed change. measured: the clip's own frames [first, last] (countState).
 * - zoomPm given: stored as is (maxCrop is then ignored). Otherwise without maxCrop: zoomPmOf(strength).
 * - maxCrop: when the asked strength's zoom fits (integer test cropFits), it is kept. Otherwise the strength is bisected in
 *   integers on [STEADY_MIN_STRENGTH, asked]: lo always a strength whose zoom was computed and fits, hi one that does not
 *   (at most 7 plans); the result is lo (verified by construction). When even the floor does not fit: strength
 *   STEADY_MIN_STRENGTH with the largest zoom that fits maxCrop, and the cover limit engages (limitedFrames).
 * - limitedFrames: runs [from, to) of source frames whose pose needs more than the zoom (exactly where limitToCover limits);
 *   reason 'reach' outside [first, last].
 */
export function planStabilise(doc: ProjectDocument, clip: MediaClip, opts: { strength: number; maxCrop?: number; zoomPm?: number }): StabilisePlan {
  const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
  const motion = doc.analyses?.[clip.assetId]?.cameraMotion;
  const frames = clipSourceFrames(doc, clip);
  const measured = measuredFrames(motion, frames);
  const asked = Math.max(1, Math.min(100, Math.trunc(opts.strength)));
  if (!asset?.video || !motion) {
    const z = opts.zoomPm ?? 1000;
    return { strength: asked, zoomPm: z, areaPercent: area(z), measured, strengthLowered: false, limitedFrames: [] };
  }
  const rate = asset.video.frameRate, hh = asset.video.height / (2 * asset.video.width);
  const lo = frames.reach.first, hi = frames.reach.last;
  const needAt = (s: number) => { let m = 1; for (let f = lo; f <= hi; f++) { const z = neededZoom(steadyPose(motion, f, s, rate), hh); if (z > m) m = z; } return zoomPmOf(m); };
  let strength = asked, zoomPm: number, lowered = false;
  if (opts.zoomPm !== undefined) zoomPm = opts.zoomPm;
  else if (opts.maxCrop === undefined) zoomPm = needAt(asked);
  else {
    const maxCrop = opts.maxCrop;
    const top = needAt(asked);
    if (cropFits(top, maxCrop) || asked <= STEADY_MIN_STRENGTH) {
      zoomPm = cropFits(top, maxCrop) ? top : zoomForCrop(maxCrop);
      lowered = false;
    } else {
      lowered = true;
      const floor = needAt(STEADY_MIN_STRENGTH);
      if (!cropFits(floor, maxCrop)) { strength = STEADY_MIN_STRENGTH; zoomPm = zoomForCrop(maxCrop); }
      else {
        let a = STEADY_MIN_STRENGTH, za = floor, b = asked;
        while (b - a > 1) { const mid = Math.floor((a + b) / 2), zm = needAt(mid); if (cropFits(zm, maxCrop)) { a = mid; za = zm; } else b = mid; }
        strength = a; zoomPm = za;
      }
    }
  }
  const zoom = zoomPm / 1000;
  const limitedFrames: LimitedFrame[] = [];
  for (let f = lo; f <= hi; f++) {
    if (!(neededZoom(steadyPose(motion, f, strength, rate), hh) > zoom)) continue;
    const reason = f < frames.first || f > frames.last ? 'reach' : 'clip';
    const last = limitedFrames.at(-1);
    if (last && last.to === f && last.reason === reason) last.to = f + 1; else limitedFrames.push({ from: f, to: f + 1, reason });
  }
  return { strength, zoomPm, areaPercent: area(zoomPm), measured, strengthLowered: lowered, limitedFrames };
}
const area = (zoomPm: number) => Math.round(1000 * (1 - 1_000_000 / (zoomPm * zoomPm))) / 10;

/**
 * Where the content is drawn: the clip's own placement with the correction nested inside it (equal to compositor2d withTransform of
 * own, then translate(zoom·t·w) · rotate(r) · scale(zoom·e^l)). Privacy regions, followers and the track picker use it.
 * With f = fitScale(...), w = srcW·f: scale = own.scale·zoom·e^l; rotation = own.rotation + r·180/π; and the offset
 * own.scale·R(own.rotation)·(zoom·t·w) in frame px is added to the own centre. Not part of the frozen maths (nothing stored).
 */
export function contentTransform(own: Transform, pose: Similarity, zoom: number, frameW: number, frameH: number, fit: Fit, srcW: number, srcH: number): { x: number; y: number; scale: number; rotation: number } {
  const w = srcW * fitScale(frameW, frameH, srcW, srcH, fit);
  const [s, c] = sinCos((own.rotation * Math.PI) / 180);
  const vx = zoom * pose.tx * w, vy = zoom * pose.ty * w;
  const ox = own.scale * (c * vx - s * vy), oy = own.scale * (s * vx + c * vy);
  return { x: own.x + ox / frameW, y: own.y + oy / frameH, scale: own.scale * zoom * expm(pose.l), rotation: own.rotation + (pose.r * 180) / Math.PI };
}

/** Counts per state and the runs to review (weak, unknown, start inside a stretch), at most 200; as tracking.ts trackSummary. */
export function cameraMotionSummary(motion: CameraMotion): { samples: number; counts: Record<'unknown' | 'ok' | 'weak' | 'start', number>; review: { from: number; to: number; state: 'weak' | 'unknown' | 'start' }[] } {
  const counts = { unknown: 0, ok: 0, weak: 0, start: 0 };
  const review: { from: number; to: number; state: 'weak' | 'unknown' | 'start' }[] = [];
  let samples = 0;
  for (const s of motion.stretches)
    s.st.forEach((code, i) => {
      const name = stateName(code);
      counts[name]++; samples++;
      if (name === 'ok' || (name === 'start' && i === 0)) return;
      const f = s.from + i, prev = review.at(-1);
      if (prev && prev.state === name && name !== 'start' && prev.to === f) prev.to++;
      else if (review.length < 200) review.push({ from: f, to: f + 1, state: name });
    });
  return { samples, counts, review };
}

// ---------------------------------------------------------------- cross-runtime digest ----------------------------------------------------------------
/** Two 32-bit hashes of the bytes of the float64 values (FNV-1a and djb2-xor), as 16 hex digits. */
function digestOf(values: Float64Array): string {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let a = 0x811c9dc5, b = 5381;
  for (let i = 0; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i]!, 0x01000193) >>> 0; b = (Math.imul(b, 33) ^ bytes[i]!) >>> 0; }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}
/**
 * Digest of steadyPose (r, l, tx, ty) and neededZoom over every frame of a motion's stretches at each strength: the browser
 * selftest (window.__pfSteadyHash, proof S7) and Node compare it bit for bit. Values are written as little-endian float64.
 */
export function steadyPoseDigest(motion: CameraMotion, strengths: readonly number[], rate: { num: number; den: number }, halfHeight = 9 / 32): string {
  const out: number[] = [];
  for (const k of strengths) for (const s of motion.stretches) for (let f = s.from; f < stretchEnd(s); f++) {
    const p = steadyPose(motion, f, k, rate);
    out.push(p.r, p.l, p.tx, p.ty, neededZoom(p, halfHeight));
  }
  const v = new Float64Array(out.length), dv = new DataView(v.buffer);
  out.forEach((x, i) => dv.setFloat64(8 * i, x, true));
  return digestOf(v);
}
/**
 * A fixed synthetic camera motion for the selftest (integer hash, no randomness): 2 stretches, 300 + 120 frames, a slow pan with
 * shake, rotation and zoom wobble, a cut, a weak run, unknown runs of 1, 2 and 4 samples.
 */
export function steadySelftestMotion(): CameraMotion {
  const h = (k: number) => { let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return ((x >>> 0) % 2001) - 1000; };
  const stretch = (from: number, n: number, salt: number): CameraStretch => {
    const st = Array.from({ length: n }, (_, i) => (i === 0 || i === 150 ? SST.start : i >= 40 && i < 46 ? SST.weak : i === 70 || i === 90 || i === 91 || (i >= 200 && i < 204) ? SST.unknown : SST.ok));
    const z = (i: number, k: number) => (st[i] === SST.ok || st[i] === SST.weak ? k : 0);
    return {
      from, st,
      dx: st.map((_, i) => z(i, 150 + h(i * 4 + salt))), dy: st.map((_, i) => z(i, -40 + h(i * 4 + 1 + salt))),
      dr: st.map((_, i) => z(i, 3 * h(i * 4 + 2 + salt))), dz: st.map((_, i) => z(i, 2 * h(i * 4 + 3 + salt))),
      origin: { method: 'selftest', params: {}, createdAt: '', createdBy: '' },
    };
  };
  return { stretches: [stretch(0, 300, 0), stretch(400, 120, 7)] };
}
/** steadyPoseDigest(steadySelftestMotion(), [1, 50, 100], 30 fps). Changing it means changing STEADY_MATHS_V1: see the header. */
export const STEADY_SELFTEST_DIGEST = '79bce733c0e94af7';
/** The selftest: the digest computed here and whether it equals the frozen one. */
export function steadySelftest(): { digest: string; expected: string; ok: boolean } {
  const digest = steadyPoseDigest(steadySelftestMotion(), [1, 50, 100], { num: 30, den: 1 });
  return { digest, expected: STEADY_SELFTEST_DIGEST, ok: digest === STEADY_SELFTEST_DIGEST };
}
