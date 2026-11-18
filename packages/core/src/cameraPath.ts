/**
 * Perform mode's virtual camera («צלם»; ADR-0025, W2): the spring, the clamp inside the picture, simplification to keys and the
 * camera plan (three replace_clip_keyframes calls with the take's clip-local range: a partial retake, keys outside the range
 * stay). Typed by performContract.ts (lead). Pure arithmetic; no engine import, no clock, no randomness but the seeded sway.
 *
 * Geometry (stage-plan.md §4.4). The picture is fitted to the frame (geometry.ts fitScale) to w×h frame px. The fill scale
 * S_fill = max(W/w, H/h) is the smallest clip scale that covers the frame; the camera's zoom Z ≥ 1 gives the clip scale
 * S = S_fill·Z. The visible window in source units is ωu = W/(w·S), ωv = H/(h·S), and the window's centre (cu, cv) stays in
 * [ω/2, 1 − ω/2] on each axis. Transform: x = −(cu − ½)·w·S/W, y = −(cv − ½)·h·S/H, scale = S (geometry.ts placed: the picture
 * centre sits at W/2 + x·W). The zoom ceiling is min(CAMERA_MAX_ZOOM, 9·W/(w·S_fill), 9·H/(h·S_fill), 20/S_fill): the schema's
 * |x|, |y| ≤ 4 needs (w·S/W − 1)/2 ≤ 4, and its scale ≤ 20.
 *
 * Spring (per channel cu, cv, ln Z; one step per timeline frame, h = 1/fps). Exact critically damped step for a target g held
 * over the step, with d = p − g and e = exp(−ωh): p′ = g + (d + (v + ωd)·h)·e, v′ = (v − (v + ωd)·ω·h)·e; ω = 5.83 / settleSeconds
 * (the 2 % settling time). The step into frame f moves toward the target OF frame f. Targets are the samples filled by linear
 * interpolation between sample frames (held before the first and after the last) and read round((2/ω + lead)·fps) frames
 * EARLIER than the pose they drive: 2/ω is the spring's steady lag on a ramp, `lead` the operator's reaction (the take is
 * processed after it is recorded). The first pose is the first target at rest. After each step the zoom, then the centre, is
 * clamped; a clamped channel's velocity is set to 0.
 *
 * Handheld sway: seeded value noise (a mulberry32 lattice, smoothstep between lattice points; 0.9 Hz plus 0.35 × 2.3 Hz,
 * normalised to ±1) on the centre, at most `sway` × 2 % of the visible window, read at the TIMELINE time (so a retake of the same
 * frames sways the same), then clamped again. It is added to the output, not to the spring state. No rotation in wave 1.
 *
 * Simplify: time-parameterised Douglas–Peucker, the largest error first. The error at a frame is max(|Δx|, |Δy|, |ΔS/S|/2)
 * against linear interpolation of the kept keys; split until every frame is within the tolerance or `maxKeys` keys are kept;
 * ties go to the earliest frame. The three properties share key times, and the covering set {|x| ≤ (w·S/W − 1)/2} is linear in
 * (x, S) (same for y), so frames interpolated linearly between covering keys cover the frame too.
 *
 * Rounding (verifier): scale UP to 1e-4 and x, y TOWARD ZERO to 1e-5, which can only widen the cover; then the cover is
 * re-checked (the scale cap of 20 is the one case that rounds down) and x, y are pulled in when needed. The simplifier works to
 * CAMERA_TOLERANCE less ROUND_MARGIN, so the rounded keys stay within CAMERA_TOLERANCE of the dense path; the reported residual
 * is measured on the ROUNDED keys.
 *
 * planCamera units: a sample's `frame` is a TIMELINE frame of the clip's sequence (performContract.ts CameraSample); `from` and
 * `to` are CLIP-LOCAL frames (both included) and are clamped to the clip's frames. Samples outside the range are ignored.
 * Geometry is the frame of the clip's sequence (sequences.ts frameOf: the master's doc.settings for the main sequence) and the
 * picture's own size, as compositor2d.ts placedSize. Refusals CAMERA_REFUSALS; warning 'linked_formats' when a linked format
 * does not override this clip's x, y and scale (the master's keys frame it differently there). Privacy regions are untouched:
 * they are drawn in the clip's own picture coordinates and follow the source.
 */
import * as T from '@pulseframe/time';
import { CAMERA_MAX_ZOOM, CAMERA_TOLERANCE, MAX_CAMERA_KEYS, type CameraGeometry, type CameraKey, type CameraLimits, type CameraPose, type CameraRefusal, type CameraSample, type CameraSettings, type ClipPose, type PlanCamera, type PoseToClip, type SimplifyPath, type SpringPath } from './performContract.ts';
import { fitScale } from './geometry.ts';
import { findClip, type OpCall } from './ops.ts';
import { sampleKeyframes, TRANSFORM_RANGE } from './animation.ts';
import { MAX_TRANSFORM_KEYS } from './keyframe.ts';
import { frameOf } from './sequences.ts';
import type { Keyframe, MediaClip, ProjectDocument } from './schema.ts';

/** ω = SETTLE_K / settleSeconds: a critically damped spring is within 2 % of a step after this many 1/ω. */
export const CAMERA_SETTLE_K = 5.83;
/** Largest handheld sway: this fraction of the visible window (at sway = 1). */
export const CAMERA_SWAY_MAX = 0.02;
/** What rounding the keys can add to the simplifier's error (x, y 1e-5; scale 1e-4 relative to S ≥ 1, halved), with room. */
const ROUND_MARGIN = 5e-5;
/** The transform schema's largest scale and |x|, |y| (schema.ts TransformSchema). */
const SCALE_MAX = TRANSFORM_RANGE.scale.max, OFFSET_MAX = TRANSFORM_RANGE.x.max;

/** The fitted picture size (frame px) and the fill scale. Fill is computed from integer products so cover gives exactly 1. */
function fitted(g: CameraGeometry): { w: number; h: number; fill: number } {
  const k = fitScale(g.frameW, g.frameH, g.srcW, g.srcH, g.fit);
  const p = g.frameW * g.srcH, q = g.frameH * g.srcW;
  return { w: g.srcW * k, h: g.srcH * k, fill: g.fit === 'cover' ? 1 : Math.max(p, q) / Math.min(p, q) };
}

export const cameraLimits: CameraLimits = (g) => {
  const { w, h, fill } = fitted(g);
  return { fill, maxZoom: Math.min(CAMERA_MAX_ZOOM, (2 * OFFSET_MAX + 1) * g.frameW / (w * fill), (2 * OFFSET_MAX + 1) * g.frameH / (h * fill), SCALE_MAX / fill) };
};

export const poseToClip: PoseToClip = (g, p) => {
  const { w, h, fill } = fitted(g);
  const s = fill * p.zoom;
  return { x: -(p.u - 0.5) * w * s / g.frameW, y: -(p.v - 0.5) * h * s / g.frameH, scale: s };
};

// ---------- the seeded sway ----------
/** mulberry32's first output for a 32-bit state, in [0, 1). */
function mulberry32(a: number): number {
  a = (a + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** The lattice value at integer i of one noise channel, in [−1, 1). */
const lattice = (seed: number, channel: number, i: number): number => 2 * mulberry32((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(channel + 1, 0x85ebca77) ^ Math.imul(i | 0, 0xc2b2ae3d)) >>> 0) - 1;
function valueNoise(seed: number, channel: number, t: number): number {
  const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f);
  const a = lattice(seed, channel, i), b = lattice(seed, channel, i + 1);
  return a + (b - a) * s;
}
/** The sway of one axis (0 = u, 1 = v) at timeline seconds t, in [−1, 1]. */
const swayAt = (seed: number, axis: number, t: number): number => (valueNoise(seed, axis * 2, 0.9 * t) + 0.35 * valueNoise(seed, axis * 2 + 1, 2.3 * t)) / 1.35;

// ---------- the spring ----------
interface Target { u: number; v: number; lz: number }
/** Per-frame targets from sorted, de-duplicated samples: linear between sample frames, held outside them. */
function targetAt(samples: readonly { frame: number; u: number; v: number; lz: number }[], q: number): Target {
  const first = samples[0]!, last = samples[samples.length - 1]!;
  if (q <= first.frame) return first;
  if (q >= last.frame) return last;
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (samples[mid]!.frame <= q) lo = mid; else hi = mid; }
  const a = samples[lo]!, b = samples[hi]!;
  const t = (q - a.frame) / (b.frame - a.frame);
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t, lz: a.lz + (b.lz - a.lz) * t };
}

/**
 * The dense camera path, one pose per frame of [fromFrame, toFrame] (both included; frames in the samples' own unit, timeline
 * frames in planCamera). Samples with a non-finite field are skipped; a later sample of the same (rounded) frame wins. Throws
 * RangeError for no usable sample, a reversed range, a non-integer range, a settle time that is not positive or a non-positive fps.
 */
export const springPath: SpringPath = (samples, fromFrame, toFrame, g, s, fps) => {
  if (!Number.isInteger(fromFrame) || !Number.isInteger(toFrame) || toFrame < fromFrame) throw new RangeError(`springPath: bad range ${fromFrame}..${toFrame}`);
  if (!(s.settleSeconds > 0) || !Number.isFinite(s.settleSeconds)) throw new RangeError(`springPath: settleSeconds must be positive (${s.settleSeconds})`);
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError(`springPath: fps must be positive (${fps})`);
  const { w, h } = fitted(g);
  const { fill, maxZoom } = cameraLimits(g);
  const lzMax = Math.log(Math.max(1, maxZoom));
  const byFrame = new Map<number, { frame: number; u: number; v: number; lz: number }>();
  for (const x of samples) {
    if (![x.frame, x.u, x.v, x.zoom].every(Number.isFinite)) continue;
    const frame = Math.round(x.frame);
    byFrame.set(frame, { frame, u: x.u, v: x.v, lz: Math.log(Math.min(Math.max(x.zoom, 1), Math.max(1, maxZoom))) });
  }
  const sorted = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  if (!sorted.length) throw new RangeError('springPath: no usable sample');
  const omega = CAMERA_SETTLE_K / s.settleSeconds, dt = 1 / fps, e = Math.exp(-omega * dt);
  const shift = Math.round((2 / omega + s.leadSeconds) * fps);
  const sway = Math.min(1, Math.max(0, Number.isFinite(s.sway) ? s.sway : 0)) * CAMERA_SWAY_MAX;
  const seed = Number.isFinite(s.seed) ? Math.trunc(s.seed) : 0;
  const half = (lz: number) => ({ hu: g.frameW / (w * fill * Math.exp(lz)) / 2, hv: g.frameH / (h * fill * Math.exp(lz)) / 2 });
  const clampIn = (x: number, lo: number, hi: number) => (lo > hi ? 0.5 : x < lo ? lo : x > hi ? hi : x);
  // state per channel: position and velocity
  const t0 = targetAt(sorted, fromFrame + shift);
  let lz = Math.min(Math.max(t0.lz, 0), lzMax), vz = 0;
  let { hu, hv } = half(lz);
  let pu = clampIn(t0.u, hu, 1 - hu), vu = 0;
  let pv = clampIn(t0.v, hv, 1 - hv), vv = 0;
  const step = (p: number, v: number, goal: number): [number, number] => {
    const d = p - goal, c = v + omega * d;
    return [goal + (d + c * dt) * e, (v - c * omega * dt) * e];
  };
  const out: CameraPose[] = [];
  for (let f = fromFrame; f <= toFrame; f++) {
    if (f > fromFrame) {
      const goal = targetAt(sorted, f + shift);
      [lz, vz] = step(lz, vz, goal.lz);
      if (lz < 0) { lz = 0; vz = 0; } else if (lz > lzMax) { lz = lzMax; vz = 0; }
      ({ hu, hv } = half(lz));
      [pu, vu] = step(pu, vu, goal.u);
      if (pu < hu || pu > 1 - hu) { pu = clampIn(pu, hu, 1 - hu); vu = 0; }
      [pv, vv] = step(pv, vv, goal.v);
      if (pv < hv || pv > 1 - hv) { pv = clampIn(pv, hv, 1 - hv); vv = 0; }
    }
    let u = pu, v = pv;
    if (sway > 0) {
      const ts = f / fps;
      u = clampIn(u + sway * 2 * hu * swayAt(seed, 0, ts), hu, 1 - hu);
      v = clampIn(v + sway * 2 * hv * swayAt(seed, 1, ts), hv, 1 - hv);
    }
    out.push({ u, v, zoom: Math.exp(lz) });
  }
  return out;
};

// ---------- simplification ----------
/** The error of frame j against the straight line between kept frames a and b. */
function segmentError(dense: readonly ClipPose[], a: number, b: number, j: number): number {
  const A = dense[a]!, B = dense[b]!, P = dense[j]!;
  const t = (j - a) / (b - a);
  const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, s = A.scale + (B.scale - A.scale) * t;
  return Math.max(Math.abs(x - P.x), Math.abs(y - P.y), Math.abs(s - P.scale) / P.scale / 2);
}
interface Segment { a: number; b: number; worst: number; at: number }
function measure(dense: readonly ClipPose[], a: number, b: number): Segment {
  let worst = 0, at = -1;
  for (let j = a + 1; j < b; j++) { const err = segmentError(dense, a, b, j); if (err > worst) { worst = err; at = j; } }
  return { a, b, worst, at };
}

export const simplifyPath: SimplifyPath = (dense, tolerance, maxKeys) => {
  const n = dense.length;
  if (n === 0) return { keep: [], residual: 0 };
  if (n === 1) return { keep: [0], residual: 0 };
  const cap = Math.max(2, Math.floor(maxKeys));
  const segs: Segment[] = [measure(dense, 0, n - 1)]; // in time order
  let kept = 2;
  for (;;) {
    let pick = -1;
    for (let i = 0; i < segs.length; i++) if (segs[i]!.at >= 0 && (pick < 0 || segs[i]!.worst > segs[pick]!.worst)) pick = i; // strict >: ties to the earliest
    if (pick < 0 || segs[pick]!.worst <= tolerance || kept >= cap) break;
    const s = segs[pick]!;
    segs.splice(pick, 1, measure(dense, s.a, s.at), measure(dense, s.at, s.b));
    kept++;
  }
  const keep = [segs[0]!.a, ...segs.map((s) => s.b)];
  return { keep, residual: segs.reduce((m, s) => Math.max(m, s.worst), 0) };
};

// ---------- rounding and the plan ----------
const noNegZero = (x: number) => (x === 0 ? 0 : x);
/** Scale up to 1e-4 (at most 20), x and y toward zero to 1e-5, then the cover re-checked and x, y pulled in where needed. */
function roundPose(g: CameraGeometry, p: ClipPose): ClipPose {
  const { w, h } = fitted(g);
  const scale = Math.min(SCALE_MAX, Math.ceil(p.scale * 1e4 - 1e-7) / 1e4);
  const limit = (size: number, frame: number) => { const m = (size * scale / frame - 1) / 2; return m > 0 ? Math.floor(m * 1e5) / 1e5 : 0; };
  const pull = (v: number, m: number) => { const r = Math.trunc(v * 1e5) / 1e5; return noNegZero(Math.abs(r) > m ? Math.sign(r) * m : r); };
  return { x: pull(p.x, Math.min(OFFSET_MAX, limit(w, g.frameW))), y: pull(p.y, Math.min(OFFSET_MAX, limit(h, g.frameH))), scale };
}
/** The largest error of the rounded keys (linear between them) against the dense path. */
function keyResidual(dense: readonly ClipPose[], keep: readonly number[], keys: readonly ClipPose[]): number {
  let worst = 0;
  for (let k = 0; k < keep.length; k++) {
    const a = keep[k]!, A = keys[k]!;
    const b = k + 1 < keep.length ? keep[k + 1]! : a, B = k + 1 < keys.length ? keys[k + 1]! : A;
    for (let j = a; j < (b > a ? b : a + 1); j++) {
      const t = b > a ? (j - a) / (b - a) : 0, P = dense[j]!;
      const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t, s = A.scale + (B.scale - A.scale) * t;
      worst = Math.max(worst, Math.abs(x - P.x), Math.abs(y - P.y), Math.abs(s - P.scale) / P.scale / 2);
    }
  }
  return worst;
}

const refused = (r: CameraRefusal) => ({ refused: r });
const CAMERA_PROPS = ['x', 'y', 'scale'] as const;

export const planCamera: PlanCamera = (doc, input) => {
  const found = findClip(doc, input.clipId);
  if (!found) return refused('not_picture');
  const { seq, track, clip } = found;
  if (clip.type === 'adjustment') return refused('adjustment');
  if (clip.type !== 'media' || track.kind !== 'video') return refused('not_picture');
  const media = clip as MediaClip;
  const asset = Object.hasOwn(doc.assets, media.assetId) ? doc.assets[media.assetId] : undefined;
  const size = asset?.video ?? asset?.image;
  if (!size) return refused('not_picture');
  if (track.locked) return refused('locked');
  if (media.transform.rotation !== 0 || media.keyframes?.rotation?.length) return refused('rotated');
  if (media.follow) return refused('follows_track');
  const frame = frameOf(doc, seq.id);
  const g: CameraGeometry = { frameW: frame.width, frameH: frame.height, srcW: size.width, srcH: size.height, fit: frame.fit };
  if (cameraLimits(g).maxZoom < 1) return refused('no_room');
  if (!Number.isInteger(input.from) || !Number.isInteger(input.to)) throw new RangeError(`planCamera: from and to must be whole clip-local frames (${input.from}, ${input.to})`);
  const rate = doc.settings.frameRate, fps = rate.num / rate.den;
  const frames = T.frameIndexAt(media.duration, rate);
  const from = Math.max(0, input.from), to = Math.min(frames - 1, input.to);
  if (from > to) return refused('no_samples');
  // picture in picture: the clip is smaller than its own fit somewhere in the range
  const scaleKeys = media.keyframes?.scale;
  for (let j = from; j <= to; j++) {
    const s = scaleKeys?.length ? sampleKeyframes(scaleKeys, T.frameTime(j, rate), TRANSFORM_RANGE.scale) : media.transform.scale;
    if (s < 1) return refused('not_full_frame');
    if (!scaleKeys?.length) break;
  }
  const start = T.frameIndexAt(media.start, rate);
  const inRange = input.samples.filter((x) => [x.frame, x.u, x.v, x.zoom].every(Number.isFinite) && Math.round(x.frame) >= start + from && Math.round(x.frame) <= start + to);
  if (!inRange.length) return refused('no_samples');
  const dense = springPath(inRange, start + from, start + to, g, input.settings, fps).map((p) => poseToClip(g, p));
  const { keep } = simplifyPath(dense, CAMERA_TOLERANCE - ROUND_MARGIN, MAX_CAMERA_KEYS);
  const rounded = keep.map((j) => roundPose(g, dense[j]!));
  const fromT = T.frameTime(from, rate), toT = T.frameTime(to, rate);
  const inside = (k: Keyframe) => T.lte(fromT, k.time) && T.lte(k.time, toT);
  let replacedKeys = 0;
  for (const p of CAMERA_PROPS) {
    const old = media.keyframes?.[p] ?? [];
    const inCount = old.filter(inside).length;
    replacedKeys += inCount;
    if (old.length - inCount + rounded.length > MAX_TRANSFORM_KEYS) return refused('too_many_keys');
  }
  const keys: CameraKey[] = keep.map((j, i) => ({ frame: from + j, ...rounded[i]! }));
  const ops: OpCall[] = CAMERA_PROPS.map((p) => ({
    op: 'replace_clip_keyframes',
    args: { clipId: media.id, property: p, from: fromT, to: toT, keys: keys.map((k) => ({ time: T.frameTime(k.frame, rate), value: k[p], easing: 'linear' })) },
  }));
  const residual = keyResidual(dense, keep, rounded);
  const warnings: string[] = [];
  for (const v of Object.values(doc.variants ?? {})) {
    const ov = Object.hasOwn(v.overrides, media.id) ? v.overrides[media.id] : undefined;
    if (ov?.hidden) continue;
    const t = ov?.transform;
    if (!t || t.x === undefined || t.y === undefined || t.scale === undefined) { warnings.push('linked_formats'); break; }
  }
  return { ops, keys, range: { from: fromT, to: toT }, residual, overTolerance: residual > CAMERA_TOLERANCE, replacedKeys, warnings };
};
