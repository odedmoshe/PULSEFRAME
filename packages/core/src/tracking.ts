/**
 * Model-free motion tracks (ADR-0015). A track belongs to one video asset and holds one sample per SOURCE frame index,
 * numbered exactly as evaluate.ts barePicture numbers frames: 0 = the first picture of the stream (see sourceFrameIndexAt).
 * Positions are integers in 1/TRACK_UNIT of the source picture's width (x) and height (y), so one track serves the proxy, the
 * original, every project size and every format. Machine samples enter only through the internal op attach_motion_track.
 * This file must not import ./schema.ts at runtime (schema.ts imports it), like effects.ts.
 *
 * Contract file of the tracking wave: the types, constants and schemas are shared by the core, engine, server and editor
 * work. The sample functions below are pure and use only integer arithmetic on the stored samples (or plain float maths on
 * render quantities), so a frame drawn on its own equals the same frame drawn in sequence (SPEC §8).
 */
import { z } from 'zod';

export const TRACK_UNIT = 10_000;
export const SIZE_UNIT = 1_000;
export const MAX_TRACK_SAMPLES = 10_800;
export const MAX_PROJECT_TRACK_SAMPLES = 43_200;
export const MAX_MOTION_TRACKS = 64;
export const MAX_REDACT_REGIONS = 8;
export const MAX_SET_SAMPLES = 500;

export const TRACK_STATES = ['unknown', 'tracked', 'weak', 'lost', 'manual', 'interpolated', 'reacquired'] as const;
export type TrackStateName = (typeof TRACK_STATES)[number];
/** Stored code = index in TRACK_STATES. lost: x/y/s hold the last usable value (never extrapolated). reacquired: first frame after a unique, 3-frame-confirmed re-detection; listed for review. */
export const ST = { unknown: 0, tracked: 1, weak: 2, lost: 3, manual: 4, interpolated: 5, reacquired: 6 } as const satisfies Record<TrackStateName, number>;
/** A position a follower uses without a loss state. weak is not usable for privacy by default (RedactRegion.weakIsLost). */
export const isUsable = (st: number): boolean => st === ST.tracked || st === ST.manual || st === ST.interpolated || st === ST.reacquired;

const Id = z.string().min(1).max(64);
const Int = z.number().int();
const Pos = Int.min(-5_000).max(15_000);
const Size = Int.min(100).max(10_000);

export const MotionTrackOriginSchema = z.object({ method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), createdBy: z.string(), edited: z.boolean() }).strict();
export const MotionTrackSchema = z.object({
  id: Id,
  assetId: Id,
  name: z.string().min(1).max(80),
  kind: z.enum(['point', 'region']),
  /** Source frame index of sample 0. */
  from: Int.min(0),
  /** region only: the box at s = SIZE_UNIT, in TRACK_UNIT of source width / height. */
  box: z.object({ w: Int.min(10).max(20_000), h: Int.min(10).max(20_000) }).strict().optional(),
  x: z.array(Pos).min(1).max(MAX_TRACK_SAMPLES),
  y: z.array(Pos).min(1).max(MAX_TRACK_SAMPLES),
  /** region only: size relative to box, per mille. */
  s: z.array(Size).min(1).max(MAX_TRACK_SAMPLES).optional(),
  /** confidence 0..100 */
  q: z.array(Int.min(0).max(100)).min(1).max(MAX_TRACK_SAMPLES),
  st: z.array(Int.min(0).max(6)).min(1).max(MAX_TRACK_SAMPLES),
  origin: MotionTrackOriginSchema,
}).strict();
export type MotionTrack = z.infer<typeof MotionTrackSchema>;

/** A text clip, or a media clip on a video track, follows the picture of the track's asset on timeline track targetTrackId. Its own transform becomes an offset from the tracked point. */
export const FollowSchema = z.object({
  motionTrackId: Id,
  targetTrackId: Id,
  /** Also scale with the tracked size (region tracks) and with the target clip's scale. */
  scale: z.boolean(),
  /** Mean of usable samples within ±smooth SOURCE frames (0 = raw). */
  smooth: Int.min(0).max(15),
}).strict();
export type Follow = z.infer<typeof FollowSchema>;

/**
 * A privacy region on a media clip, in MaskSchema layer units (effects.ts MaskSchema; look.ts applyMask). Ids are unique within the clip only.
 * fixed (motionTrackId null): centre (x, y), size (width, height)·(1+pad).
 * tracked region track: centre (u−½+x, v−½+y), size (box.w/TRACK_UNIT·s/SIZE_UNIT·(1+pad), box.h/TRACK_UNIT·s/SIZE_UNIT·(1+pad)).
 * tracked point track: centre (u−½+x, v−½+y), size (width, height)·(1+pad). Here u = x/TRACK_UNIT, v = y/TRACK_UNIT of the sample.
 */
export const RedactRegionSchema = z.object({
  id: Id,
  motionTrackId: Id.nullable(),
  shape: z.enum(['rect', 'ellipse']),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  width: z.number().min(0.01).max(2),
  height: z.number().min(0.01).max(2),
  pad: z.number().min(0).max(1),
  feather: z.number().min(0).max(0.2),
  style: z.enum(['blur', 'pixelate', 'fill']),
  strength: z.number().min(0).max(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  /** frame = while the sample is lost/unknown/outside (and weak when weakIsLost), blur the whole picture of the layer; hold = keep the held region. */
  onLoss: z.enum(['frame', 'hold']),
  weakIsLost: z.boolean(),
}).strict();
export type RedactRegion = z.infer<typeof RedactRegionSchema>;
export const DEFAULT_REDACT_REGION = { shape: 'ellipse', x: 0, y: 0, width: 0.2, height: 0.2, pad: 0.15, feather: 0.01, style: 'blur', strength: 0.8, color: '#000000', onLoss: 'frame', weakIsLost: true } as const satisfies Omit<RedactRegion, 'id' | 'motionTrackId'>;

/** Render quantities (never stored). */
export interface ResolvedRegion {
  id: string; shape: 'rect' | 'ellipse';
  /** Layer space, MaskSchema units; ignored when whole. */
  x: number; y: number; width: number; height: number;
  feather: number; style: 'blur' | 'pixelate' | 'fill'; strength: number; color: string;
  /** Loss fallback: the whole layer, always style 'blur' with strength ≥ 0.6. */
  whole: boolean;
  state: TrackStateName | 'fixed' | 'outside';
  sourceFrame: number;
}
export type FollowStateName = TrackStateName | 'outside' | 'target-absent' | 'target-missing';
export interface FollowInfo { motionTrackId: string; state: FollowStateName; sourceFrame: number | null; confidence: number; targetClipId: string | null }
export interface TrackSample { x: number; y: number; s: number; q: number; st: number; outside: boolean }
export interface TrackProblem { from: number; to: number; state: 'unknown' | 'weak' | 'lost' | 'reacquired' }

/** Samples of a track (all arrays have this length; validate.ts holds them equal). */
export const trackLength = (t: MotionTrack): number => t.x.length;
/** One past the last source frame the track holds a sample for: samples cover [from, trackEnd). */
export const trackEnd = (t: MotionTrack): number => t.from + t.x.length;
/** Round half up of num/den for integers, den > 0 (exact: the operands are small integers). */
export const roundHalfUp = (num: number, den: number): number => Math.floor((2 * num + den) / (2 * den));

/**
 * Sample at source frame `frame` (ADR-0015).
 * - Outside [from, from+n): the nearest end sample, raw, with outside=true (nothing is extrapolated).
 * - smooth > 0: x, y and s are the integer mean (round half up) of the USABLE samples (isUsable) in
 *   [frame−smooth, frame+smooth] that lie inside the track; a manual sample is returned exactly; when no sample in the window is
 *   usable, the raw one. q and st are always the sample's own.
 * - s = SIZE_UNIT for point tracks.
 */
export function trackSampleAt(t: MotionTrack, frame: number, smooth = 0): TrackSample {
  const n = trackLength(t);
  const raw = frame - t.from;
  const outside = raw < 0 || raw >= n;
  const i = Math.min(n - 1, Math.max(0, raw));
  const st = t.st[i]!, q = t.q[i]!;
  const own: TrackSample = { x: t.x[i]!, y: t.y[i]!, s: t.s ? t.s[i]! : SIZE_UNIT, q, st, outside };
  if (outside || smooth <= 0 || st === ST.manual) return own;
  let sx = 0, sy = 0, ss = 0, count = 0;
  for (let k = Math.max(0, i - smooth), last = Math.min(n - 1, i + smooth); k <= last; k++) {
    if (!isUsable(t.st[k]!)) continue;
    sx += t.x[k]!; sy += t.y[k]!; ss += t.s ? t.s[k]! : SIZE_UNIT; count++;
  }
  if (count === 0) return own;
  return { x: roundHalfUp(sx, count), y: roundHalfUp(sy, count), s: roundHalfUp(ss, count), q, st, outside };
}

/** Half-width of the loss filter in SOURCE frames of the asset (fps = the asset's frame rate): ceil(fps/3), at least 1. */
export const lossHalfWidth = (fps: number): number => Math.max(1, Math.ceil(fps / 3 - 1e-9));
const lossCache = new WeakMap<MotionTrack, Map<string, Uint8Array>>();
/**
 * Which samples a privacy region treats as lost (1) or usable (0): a closing filter, so the loss fallback never blinks
 * (ADR-0015; ADR-0009 photosensitivity). Index i is source frame from+i. All lengths are in SOURCE frames of the asset,
 * H = ceil(fps/3) with fps the asset's frame rate (10 at 30 fps):
 *  1. bad = unknown or lost (and weak when weakIsLost);
 *  2. every bad sample is widened by H samples on each side (dilation);
 *  3. every run of good samples shorter than H+1 is made bad. The frames before and after the track count as bad here (a
 *     clip that shows them treats them as lost), so a short good run at either end of the track is cleared too.
 * Result: every bad sample is flagged, every bad run between good runs is at least 2H+1 samples, and every good run is at
 * least H+1 samples. On the timeline these are source frames: a clip at speed v shows them about v times faster, so at
 * speed 4 and 30 fps the shortest good or bad stretch lasts about 2.5 to 2.75 timeline frames (the whole-picture fallback is
 * always a blur, never a fill). Cached per track object: documents are not changed after commit; edits make new ones.
 */
export function lossFlags(t: MotionTrack, fps: number, weakIsLost: boolean): Uint8Array {
  const key = `${fps}|${weakIsLost ? 1 : 0}`;
  let byKey = lossCache.get(t);
  const hit = byKey?.get(key);
  if (hit) return hit;
  const n = trackLength(t), H = lossHalfWidth(fps);
  const out = new Uint8Array(n);
  // 1-2: dilate. Walk once, remembering the last bad index; then once backwards for the other side.
  let lastBad = -Infinity;
  for (let i = 0; i < n; i++) {
    const st = t.st[i]!;
    if (st === ST.unknown || st === ST.lost || (weakIsLost && st === ST.weak)) lastBad = i;
    if (i - lastBad <= H) out[i] = 1;
  }
  let nextBad = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    const st = t.st[i]!;
    if (st === ST.unknown || st === ST.lost || (weakIsLost && st === ST.weak)) nextBad = i;
    if (nextBad - i <= H) out[i] = 1;
  }
  // 3: clear short good runs (the ends of the track count as bad)
  for (let i = 0; i < n; ) {
    if (out[i]) { i++; continue; }
    let j = i;
    while (j < n && !out[j]) j++;
    if (j - i < H + 1) out.fill(1, i, j);
    i = j;
  }
  if (!byKey) { byKey = new Map(); lossCache.set(t, byKey); }
  byKey.set(key, out);
  return out;
}

/**
 * Region geometry in layer units (MaskSchema units: a fraction of the placed picture's width and height, centred on it).
 * sample null (or a fixed region) = the region's own centre and size. See RedactRegionSchema for the three cases.
 */
export function regionGeometry(r: RedactRegion, t: MotionTrack | null, sample: TrackSample | null): { x: number; y: number; width: number; height: number } {
  const k = 1 + r.pad;
  if (!t || !sample || r.motionTrackId === null) return { x: r.x, y: r.y, width: r.width * k, height: r.height * k };
  const x = sample.x / TRACK_UNIT - 0.5 + r.x, y = sample.y / TRACK_UNIT - 0.5 + r.y;
  if (t.kind === 'region' && t.box) {
    const s = sample.s / SIZE_UNIT;
    return { x, y, width: (t.box.w / TRACK_UNIT) * s * k, height: (t.box.h / TRACK_UNIT) * s * k };
  }
  return { x, y, width: r.width * k, height: r.height * k };
}

/**
 * Counts of samples per state, and the stretches to review: maximal runs of unknown, of weak and of lost samples, and each
 * reacquired sample on its own, in source frames, ascending. A problem covers [from, to): `to` is one past its last frame.
 */
export function trackSummary(t: MotionTrack): { samples: number; counts: Record<TrackStateName, number>; problems: TrackProblem[] } {
  const counts = Object.fromEntries(TRACK_STATES.map((s) => [s, 0])) as Record<TrackStateName, number>;
  const problems: TrackProblem[] = [];
  const n = trackLength(t);
  for (let i = 0; i < n; ) {
    const st = t.st[i]!;
    const name = TRACK_STATES[st] ?? 'unknown';
    if (name === 'reacquired') { counts.reacquired++; problems.push({ from: t.from + i, to: t.from + i + 1, state: 'reacquired' }); i++; continue; }
    let j = i;
    while (j < n && t.st[j] === st) j++;
    counts[name] += j - i;
    if (name === 'unknown' || name === 'weak' || name === 'lost') problems.push({ from: t.from + i, to: t.from + j, state: name });
    i = j;
  }
  return { samples: n, counts, problems };
}

const SetSample = z.object({ frame: Int.min(0), x: Pos, y: Pos, s: Size.optional() }).strict();
const Span = z.object({ from: Int.min(0), to: Int.min(0) }).strict();
/** Argument schemas of the new ops (W1 registers them with defineOp in ops.ts under these names; outputs noted). */
export const TrackOpArgs = {
  /** public; output { motionTrackId }. One manual sample (q=100) at `frame`; region needs w,h (becomes box, s=[1000]). */
  create_motion_track: z.object({ assetId: Id, name: z.string().min(1).max(80).optional(), kind: z.enum(['point', 'region']), frame: Int.min(0), x: Int.min(0).max(TRACK_UNIT), y: Int.min(0).max(TRACK_UNIT), w: Int.min(10).max(TRACK_UNIT).optional(), h: Int.min(10).max(TRACK_UNIT).optional() }).strict(),
  /** INTERNAL (jobs only). Replaces samples [from, from+n) except st=manual; extends the range, filling gaps with st=unknown at the nearest known position. */
  attach_motion_track: z.object({ motionTrackId: Id, from: Int.min(0), x: z.array(Pos).min(1).max(MAX_TRACK_SAMPLES), y: z.array(Pos).min(1).max(MAX_TRACK_SAMPLES), s: z.array(Size).min(1).max(MAX_TRACK_SAMPLES).optional(), q: z.array(Int.min(0).max(100)).min(1).max(MAX_TRACK_SAMPLES), st: z.array(Int.min(0).max(6)).min(1).max(MAX_TRACK_SAMPLES), method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string() }).strict(),
  /** public; applied in order set → markLost → interpolate; sets origin.edited. set: st=manual, q=100 (outside the range: extends it with unknown). markLost: st=lost holding the last usable value before `from` (else the first after). interpolate: integer linear between the usable samples bounding the span, st=interpolated, q=min of ends. */
  edit_motion_track: z.object({ motionTrackId: Id, name: z.string().min(1).max(80).optional(), set: z.array(SetSample).min(1).max(MAX_SET_SAMPLES).optional(), markLost: Span.optional(), interpolate: Span.optional() }).strict(),
  /** public; refused while any follow/redact names it unless unbind=true (then those bindings are removed in the same op). */
  remove_motion_track: z.object({ motionTrackId: Id, unbind: z.boolean().optional() }).strict(),
  /** public; offset (when given) is written to the clip's static transform x/y in the same op (keys untouched). */
  set_clip_follow: z.object({ clipId: Id, follow: FollowSchema.nullable(), offset: z.object({ x: z.number().min(-4).max(4), y: z.number().min(-4).max(4) }).strict().optional() }).strict(),
  /** public; output { regionId }. Absent regionId = new region (defaults DEFAULT_REDACT_REGION); region null = delete. */
  set_redact_region: z.object({ clipId: Id, regionId: Id.optional(), region: RedactRegionSchema.omit({ id: true }).partial().nullable() }).strict(),
} as const;
