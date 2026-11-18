/**
 * Reframing a wide picture into a narrow frame (ADR-0018, plan §4.5): a camera path over the subject's centre, kept inside
 * the cover clamp, written as LINEAR x keys (Ramer–Douglas–Peucker with ε, doubled until at most REFRAME_DEFAULTS.maxKeys).
 * Reframe motion has exactly one owner: these x keys on clips inside the short's own sequence (wave4-decisions.md); tracking's
 * camera follow and ADR-0017 1b faces feed planReframe as ReframeSample sources.
 *
 * Formulas (plan §4.5): with k = Ws·f·s/Wo (the scaled source width in frame widths; f the cover fitScale, geometry.ts; s the
 * framing), target x = −(u−½)·k and the clamp |x| ≤ coverLimit = max(0, (k − 1)/2) (transform x is a fraction of the frame
 * width, schema.ts). backdropScale = contain factor / cover factor (1080×1920 from 1920×1080 = 0.31640625).
 *
 * The camera path, one value per clip-local frame:
 *  1. targets: −(u−½)·k of each usable sample, then a moving average over ±smoothSeconds of the usable ones, clamped;
 *  2. the start value is the median target of the first settleSeconds (the first usable target if none lies there; the
 *     centre without any);
 *  3. each later frame holds while the target lies inside the dead zone, otherwise steps toward it by at most maxSpeed/fps;
 *     a frame with no usable target in its window holds the last value and counts as held.
 * Keys: RDP over whole frames (vertical deviation ≤ ε), LINEAR. Because the clamp interval is convex and the path obeys the
 * speed limit frame to frame, straight lines between path points keep coverage, the speed limit and the ε bound.
 */
import * as T from '@pulseframe/time';
import { BACKDROP_MIN_BLUR, MAX_REFRAME_OPS, REFRAME_DEFAULTS, shortsRefusal, type PlanWarning, type ReframeInput, type ReframePlanBody, type ReframeResult, type ReframeSample, type ReframeShot } from './shortsContract.ts';
import type { OpCall } from './ops.ts';
import type { Keyframe, MediaClip, ProjectDocument } from './schema.ts';
import { fitScale } from './geometry.ts';
import { frameOf, sequenceOf } from './sequences.ts';
import { sourceFrameIndexAt } from './speed.ts';
import { isUsable, lossFlags, TRACK_UNIT, trackSampleAt, type MotionTrack } from './tracking.ts';

/** The coverage clamp: the largest |x| that keeps the frame covered by a cover-fitted source at `framing`. */
export const coverLimit = (frameW: number, srcW: number, fitScaleValue: number, framing: number): number => Math.max(0, ((srcW * fitScaleValue * framing) / frameW - 1) / 2);

/** The foreground scale of the blurred-backdrop layout: contain factor / cover factor. */
export function backdropScale(frame: { width: number; height: number }, src: { width: number; height: number }): number {
  // contain/cover = min(Wo/Ws, Ho/Hs) / max(Wo/Ws, Ho/Hs) = min(p, q) / max(p, q) with integer products: one rounding only
  const p = frame.width * src.height, q = frame.height * src.width;
  return Math.min(p, q) / Math.max(p, q);
}

const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const clamp = (v: number, lim: number) => Math.max(-lim, Math.min(lim, v));

/** The per-frame camera path and how many frames held for want of a usable sample (exported for the tests). */
export function cameraPath(i: ReframeInput): { path: Float64Array; heldFrames: number; limit: number } {
  const fps = i.rate.num / i.rate.den;
  const f = fitScale(i.frame.width, i.frame.height, i.source.width, i.source.height, 'cover');
  const k = (i.source.width * f * i.framing) / i.frame.width;
  const limit = coverLimit(i.frame.width, i.source.width, f, i.framing);
  const n = i.samples.length;
  const deadZone = i.deadZone ?? REFRAME_DEFAULTS.deadZone, maxStep = (i.maxSpeed ?? REFRAME_DEFAULTS.maxSpeed) / fps;
  const r = Math.max(0, Math.round((i.smoothSeconds ?? REFRAME_DEFAULTS.smoothSeconds) * fps));
  const raw = i.samples.map((s: ReframeSample) => (s.u === null || !Number.isFinite(s.u) ? null : -(s.u - 0.5) * k));
  // 1. moving average of the usable targets over ±r frames (prefix sums), clamped to the coverage interval
  const sum = new Float64Array(n + 1), cnt = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) { sum[j + 1] = sum[j]! + (raw[j] ?? 0); cnt[j + 1] = cnt[j]! + (raw[j] === null ? 0 : 1); }
  const target = (j: number): number | null => {
    const lo = Math.max(0, j - r), hi = Math.min(n, j + r + 1), c = cnt[hi]! - cnt[lo]!;
    return c ? clamp((sum[hi]! - sum[lo]!) / c, limit) : null;
  };
  const path = new Float64Array(n);
  if (!n) return { path, heldFrames: 0, limit };
  // 2. the start value
  const settle = Math.max(1, Math.round(REFRAME_DEFAULTS.settleSeconds * fps));
  const first: number[] = [];
  for (let j = 0; j < Math.min(n, settle); j++) { const t = target(j); if (t !== null) first.push(t); }
  let start = first.length ? median(first) : 0;
  if (!first.length) for (let j = 0; j < n; j++) { const t = target(j); if (t !== null) { start = t; break; } }
  let cam = clamp(start, limit), held = 0;
  path[0] = cam;
  if (target(0) === null) held++;
  // 3. hold in the dead zone, otherwise step toward the target at the speed limit
  for (let j = 1; j < n; j++) {
    const t = target(j);
    if (t === null) held++;
    else {
      const d = t - cam;
      if (Math.abs(d) > deadZone) cam = clamp(cam + Math.sign(d) * Math.min(Math.abs(d), maxStep), limit);
    }
    path[j] = cam;
  }
  return { path, heldFrames: held, limit };
}

/** Ramer–Douglas–Peucker over whole frames with vertical deviation; returns the kept frame indices (always the first and last). */
export function simplify(path: ArrayLike<number>, epsilon: number): number[] {
  const n = path.length;
  if (n <= 2) return Array.from({ length: n }, (_, j) => j);
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const va = path[a]!, vb = path[b]!;
    let worst = -1, at = -1;
    for (let j = a + 1; j < b; j++) {
      const dev = Math.abs(path[j]! - (va + ((vb - va) * (j - a)) / (b - a)));
      if (dev > worst) { worst = dev; at = j; }
    }
    if (worst > epsilon) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  const out: number[] = [];
  for (let j = 0; j < n; j++) if (keep[j]) out.push(j);
  return out;
}

export function planReframe(i: ReframeInput): ReframeResult {
  const { path, heldFrames, limit } = cameraPath(i);
  let epsilon = i.epsilon ?? REFRAME_DEFAULTS.epsilon;
  const n = path.length;
  if (!n) return { x: 0, keys: null, limit, epsilon, heldFrames };
  let moving = false;
  for (let j = 1; j < n; j++) if (path[j] !== path[0]) { moving = true; break; }
  if (!moving) return { x: path[0]!, keys: null, limit, epsilon, heldFrames };
  let frames = simplify(path, epsilon);
  while (frames.length > REFRAME_DEFAULTS.maxKeys) { epsilon *= 2; frames = simplify(path, epsilon); }
  const keys: Keyframe[] = frames.map((j) => ({ time: T.frameTime(j, i.rate), value: path[j]!, easing: 'linear' }));
  return { x: keys[0]!.value, keys, limit, epsilon, heldFrames };
}

/**
 * The subject's centre for each clip-local frame of `clip` (one per frame of its duration): the motion track's sample at the
 * source frame the clip shows there (speed.ts sourceFrameIndexAt), smoothed over ±2 source frames (trackSampleAt), and
 * unusable (u null) outside the track, where isUsable says so, or where lossFlags (weak counted as lost) flags it.
 */
export function trackSamples(asset: { duration: T.RationalTime; video: NonNullable<ProjectDocument['assets'][string]['video']> }, clip: MediaClip, mt: MotionTrack, rate: { num: number; den: number }): ReframeSample[] {
  const flags = lossFlags(mt, asset.video.frameRate.num / asset.video.frameRate.den, true);
  return Array.from({ length: T.frameIndexAt(clip.duration, rate) }, (_, j) => {
    const idx = sourceFrameIndexAt(asset, clip, T.add(clip.start, T.frameTime(j, rate)), rate);
    const s = trackSampleAt(mt, idx, 2);
    const usable = !s.outside && isUsable(s.st) && !flags[idx - mt.from];
    return { u: usable ? s.x / TRACK_UNIT : null, conf: s.q / 100 };
  });
}

/**
 * The reframe of a sequence's own media clips (POST /sequences/:id/reframe-plan, plan_reframe): per picture clip on a video
 * track, the samples of the motion track (trackSampleAt smoothed over ±2 source frames, unusable where lossFlags or
 * isUsable say so) or the centre, turned into replace_clip_keyframes x keys (or a static x through set_clip_transform),
 * with the clip's scale set to the framing. A clip carrying a blurred backdrop (blur.gaussian ≥ BACKDROP_MIN_BLUR) is left
 * as it is. Refusals: an unknown sequence or motion track, a track of another file, a turned clip for the track source
 * (ShortsError). At most MAX_REFRAME_OPS operations (plan_too_large otherwise).
 */
export function reframeOps(doc: ProjectDocument, sequenceId: string, body: ReframePlanBody): { ops: OpCall[]; shots: ReframeShot[]; warnings: PlanWarning[] } {
  const seq = sequenceOf(doc, sequenceId);
  if (!seq) throw shortsRefusal('sequenceNotFound', { sequenceId }, sequenceId);
  const source: 'track' | 'centre' = body.source === 'track' || (body.source === 'auto' && body.motionTrackId !== undefined) ? 'track' : 'centre';
  const mt = source === 'track' ? (body.motionTrackId !== undefined && Object.hasOwn(doc.motionTracks ?? {}, body.motionTrackId) ? doc.motionTracks[body.motionTrackId]! : undefined) : undefined;
  if (source === 'track' && !mt) throw shortsRefusal('motionTrackNotFound', { motionTrackId: body.motionTrackId ?? null }, body.motionTrackId ?? '(none)');
  const frame = frameOf(doc, sequenceId);
  const rate = doc.settings.frameRate;
  const ops: OpCall[] = [], shots: ReframeShot[] = [], warnings: PlanWarning[] = [];
  for (const track of seq.tracks) {
    if (track.kind !== 'video') continue;
    for (const c of track.clips) {
      if (c.type !== 'media') continue;
      const clip = c as MediaClip;
      const asset = Object.hasOwn(doc.assets, clip.assetId) ? doc.assets[clip.assetId] : undefined;
      const size = asset?.video ?? asset?.image;
      if (!asset || !size) continue;
      if ((clip.effects ?? []).some((e) => e.enabled && e.type === 'blur.gaussian' && typeof e.params.radius === 'number' && e.params.radius >= BACKDROP_MIN_BLUR)) continue;
      const n = T.frameIndexAt(clip.duration, rate);
      let samples: ReframeSample[];
      if (mt) {
        if (mt.assetId !== clip.assetId) throw shortsRefusal('motionTrackOtherFile', { motionTrackId: mt.id, clipId: clip.id }, mt.id);
        if (clip.transform.rotation !== 0 || clip.keyframes?.rotation?.length) throw shortsRefusal('rotatedClip', { clipId: clip.id });
        const video = asset.video;
        if (!video) throw shortsRefusal('motionTrackOtherFile', { motionTrackId: mt.id, clipId: clip.id }, mt.id);
        samples = trackSamples({ duration: asset.duration, video }, clip, mt, rate);
      } else samples = Array.from({ length: n }, () => ({ u: 0.5, conf: 1 }));
      // the formula assumes a cover fit; a contain frame is the same picture at a smaller effective framing
      const fitRatio = frame.fit === 'cover' ? 1 : fitScale(frame.width, frame.height, size.width, size.height, 'contain') / fitScale(frame.width, frame.height, size.width, size.height, 'cover');
      const r = planReframe({ frame, source: { width: size.width, height: size.height }, framing: body.framing * fitRatio, rate, samples });
      if (r.keys) ops.push({ op: 'replace_clip_keyframes', args: { clipId: clip.id, property: 'x', keys: r.keys } });
      else {
        if (clip.keyframes?.x?.length) ops.push({ op: 'replace_clip_keyframes', args: { clipId: clip.id, property: 'x', keys: null } });
      }
      const transform: Record<string, number> = {};
      if (!r.keys) transform.x = r.x;
      if (clip.transform.scale !== body.framing) transform.scale = body.framing;
      if (Object.keys(transform).length) ops.push({ op: 'set_clip_transform', args: { clipId: clip.id, transform } });
      shots.push({ clipId: clip.id, source, keys: r.keys?.length ?? 0, heldFrames: r.heldFrames });
      if (mt && n > 0 && r.heldFrames * 2 > n) warnings.push({ code: 'track_mostly_lost', message: `the subject is lost in ${r.heldFrames} of ${n} frames of clip ${clip.id}; the camera holds there`, short: null, details: { clipId: clip.id, heldFrames: r.heldFrames, frames: n } });
    }
  }
  if (ops.length > MAX_REFRAME_OPS) throw shortsRefusal('planTooLarge', { operations: ops.length, max: MAX_REFRAME_OPS }, ops.length);
  return { ops, shots, warnings };
}
