/**
 * Pure maths of stabilisation (wave 7 stabilise track; stabilise-decisions.md §2.3, §2.8; plan §4.3–4.4). W2 BUILDS THE BODIES; the
 * lead's pre-pass fixed the signatures. STEADY_MATHS_V1: the results are replayed byte for byte (packages/evals/src/commit-equivalence)
 * because set_clip_stabilise stores a zoom computed here, so this file uses only + − × / in a fixed order — never Math.sin, cos, tan,
 * exp, log, pow, atan or hypot (a unit test reads this file and fails if it does) — and Node and Chromium give the same bits.
 *
 * Units: a similarity about the picture centre, p' = e^l·R(r)·p + t, with p and t in units of the source picture's WIDTH
 * (the content rectangle is [−½, ½] × [−h, h], h = srcH / (2·srcW)), r in radians clockwise, l = ln(scale).
 *
 * Rules W2 keeps:
 * - Window: symmetric truncated. For frame k with half-window R (steadyContract steadyHalfWindow) and nearest boundaries lo ≤ k ≤ hi
 *   (first/last sample of a stretch, a `start` sample, an `unknown` run longer than 2), R_eff = min(R, k−lo, hi−k); weights
 *   w(d) = (1 − (d/(R_eff+1))²)²; B(k) = Σ w·M(k→j) / Σ w. A steady pan gets exactly no correction. Unknown runs of 1–2 frames are
 *   bridged with the mean of the nearest measured deltas on each side (state kept). The correction is the inverse of B(k).
 * - Outside every stretch: the pose of the nearest measured frame, state `outside` (nothing extrapolated, as trackSampleAt).
 * - Cover: limitToCover scales the pose toward identity by one gain found with 20 bisection steps; identity always covers, so no
 *   empty edge is ever shown. Poses are cached per stretch object × strength × rate (WeakMap), shared with planStabilise.
 */
import type { Fit } from './geometry.ts';
import type { MediaClip, ProjectDocument, Transform } from './schema.ts';
import type { CameraMotion } from './steadyContract.ts';
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

const notBuilt = (fn: string): never => { throw new Error(`steady.ts ${fn}: not built yet (wave 7 stabilise, W2)`); };

/** [sin x, cos x] by a Taylor series after dividing by 8, then three doublings. Within 1e-12 of Math over |x| ≤ π. */
export function sinCos(x: number): [number, number] { void x; return notBuilt('sinCos'); }
/** e^x by a Taylor series after dividing by 8, then three squarings. Within 1e-12 (relative) of Math.exp over |x| ≤ 1. */
export function expm(x: number): number { void x; return notBuilt('expm'); }
/** a after b: (a ∘ b)(p) = a(b(p)). */
export function compose(a: Similarity, b: Similarity): Similarity { void a; void b; return notBuilt('compose'); }
export function inverse(a: Similarity): Similarity { void a; return notBuilt('inverse'); }
/** The correction of source frame `frame` at a strength for a file numbered at `rate`. */
export function steadyPose(motion: CameraMotion, frame: number, strength: number, rate: { num: number; den: number }): SteadyPose { void motion; void frame; void strength; void rate; return notBuilt('steadyPose'); }
/** The smallest zoom with which the corrected picture covers the window; halfHeight = srcH / (2·srcW). */
export function neededZoom(pose: Similarity, halfHeight: number): number { void pose; void halfHeight; return notBuilt('neededZoom'); }
/** The pose scaled toward identity until it covers at `zoom`; limited = the pose had to be weakened. */
export function limitToCover(pose: Similarity, zoom: number, halfHeight: number): { pose: Similarity; limited: boolean } { void pose; void zoom; void halfHeight; return notBuilt('limitToCover'); }
/** The first and last source frame the clip shows now (sourceFrameIndexAt, as apps/server/src/tracking.ts trackingRange), and the reach of ramps and handles. */
export function clipSourceFrames(doc: ProjectDocument, clip: MediaClip): ClipFrames { void doc; void clip; return notBuilt('clipSourceFrames'); }
/** What set_clip_stabilise stores and the block shows while the slider moves. maxCrop: bisect the strength in [5, strength], then verify. */
export function planStabilise(doc: ProjectDocument, clip: MediaClip, opts: { strength: number; maxCrop?: number; zoomPm?: number }): StabilisePlan { void doc; void clip; void opts; return notBuilt('planStabilise'); }
/**
 * Where the content is drawn: the clip's own placement with the correction nested inside it (equal to compositor2d withTransform of
 * own, then translate(zoom·t·w) · rotate(r) · scale(zoom·e^l)). Privacy regions, followers and the track picker use it.
 */
export function contentTransform(own: Transform, pose: Similarity, zoom: number, frameW: number, frameH: number, fit: Fit, srcW: number, srcH: number): { x: number; y: number; scale: number; rotation: number } {
  void own; void pose; void zoom; void frameW; void frameH; void fit; void srcW; void srcH; return notBuilt('contentTransform');
}
/** Counts per state and the runs to review (weak, unknown, start inside a stretch), at most 200; as tracking.ts trackSummary. */
export function cameraMotionSummary(motion: CameraMotion): { samples: number; counts: Record<'unknown' | 'ok' | 'weak' | 'start', number>; review: { from: number; to: number; state: 'weak' | 'unknown' | 'start' }[] } {
  void motion; return notBuilt('cameraMotionSummary');
}
