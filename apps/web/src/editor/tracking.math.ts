/**
 * Pure arithmetic of the motion tracking UI (ADR-0015): picking a point or a box on the program monitor, the follow offset
 * that attaches a clip without a jump, the job's progress, and finding a source frame on the timeline. No DOM, no editor state.
 *
 * Coordinates:
 *  - screen px: the displayed canvas (CanvasHandles' overlay root), 0,0 at its top-left corner;
 *  - frame px: the project (or viewed format) frame; k = displayed width / frame width (interactions.math.ts boxToScreen);
 *  - source u, v: 0..1 of the target picture's width and height, continuous (pixel i spans [i, i+1) of the source), placed as
 *    the compositor places it (core geometry.ts: fit, then the layer's transform);
 *  - track units: integers in 1/TRACK_UNIT of the source width (x) and height (y), as stored in a motion track.
 */
import * as T from '@pulseframe/time';
import { findClip, frameToSource, placed, sourceFrameIndexAt, sourceToFrame, TRACK_UNIT, transformAt, type Fit, type Follow, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import { evaluate, type ImageLayer, type RenderGraph, type TextLayer, type VideoLayer } from '@pulseframe/engine';

export interface FrameBox { W: number; H: number; fit: Fit }
export interface LayerPlacement { srcW: number; srcH: number; transform: { x: number; y: number; scale: number; rotation: number } }

/** Displayed canvas px → frame px (k = rectW / frameW). */
export const screenToFrame = (sx: number, sy: number, rectW: number, frameW: number) => { const k = rectW / frameW; return { px: sx / k, py: sy / k }; };
/** Frame px → displayed canvas px. */
export const frameToScreen = (px: number, py: number, rectW: number, frameW: number) => { const k = rectW / frameW; return { sx: px * k, sy: py * k }; };

const placementOf = (f: FrameBox, l: LayerPlacement) => placed(f.W, f.H, f.fit, l.srcW, l.srcH, l.transform);
/** A frame point → the target picture's normalised source point (any value; outside 0..1 is off the picture). */
export const frameToLayerSource = (f: FrameBox, l: LayerPlacement, px: number, py: number) => frameToSource(placementOf(f, l), px, py);
/** The target picture's normalised source point → frame px. */
export const layerSourceToFrame = (f: FrameBox, l: LayerPlacement, u: number, v: number) => sourceToFrame(placementOf(f, l), u, v);
/** A pick on the displayed canvas → source u, v of the target picture; null when it falls outside the picture (refused). */
export function pickToSource(a: { sx: number; sy: number; rectW: number; frame: FrameBox; layer: LayerPlacement }): { u: number; v: number } | null {
  const { px, py } = screenToFrame(a.sx, a.sy, a.rectW, a.frame.W);
  const s = frameToLayerSource(a.frame, a.layer, px, py);
  return Number.isFinite(s.u) && Number.isFinite(s.v) && s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1 ? s : null;
}
/** Source u, v of the target picture → displayed canvas px (inverse of pickToSource). */
export function sourceToScreen(a: { u: number; v: number; rectW: number; frame: FrameBox; layer: LayerPlacement }): { sx: number; sy: number } {
  const p = layerSourceToFrame(a.frame, a.layer, a.u, a.v);
  return frameToScreen(p.px, p.py, a.rectW, a.frame.W);
}

/** Source u, v → stored track units (rounded integers, clamped to the picture). */
export const toTrackUnits = (u: number, v: number) => ({ x: Math.min(TRACK_UNIT, Math.max(0, Math.round(u * TRACK_UNIT))), y: Math.min(TRACK_UNIT, Math.max(0, Math.round(v * TRACK_UNIT))) });
/** The least box side create_motion_track accepts, in track units (TrackOpArgs: w, h ≥ 10). */
export const MIN_BOX_UNITS = 10;

/**
 * A box drawn in frame px (centre and size along the frame axes) → the region seed in track units: its centre, and its size
 * along the picture's own axes. Each side is measured through the picture's placement (scale and fit; a turned picture is
 * measured along its turned axes, so a box drawn on a turned picture is the box in the picture's own frame of reference).
 * null when the centre is off the picture.
 */
export function boxToTrackUnits(f: FrameBox, l: LayerPlacement, box: { px: number; py: number; w: number; h: number }): { x: number; y: number; w: number; h: number } | null {
  const c = frameToLayerSource(f, l, box.px, box.py);
  if (!(c.u >= 0 && c.u <= 1 && c.v >= 0 && c.v <= 1)) return null;
  const p = placementOf(f, l);
  const side = (n: number, full: number) => Math.min(TRACK_UNIT, Math.max(MIN_BOX_UNITS, Math.round((Math.abs(n) / (full * p.scale)) * TRACK_UNIT)));
  return { ...toTrackUnits(c.u, c.v), w: side(box.w, p.w), h: side(box.h, p.h) };
}

/** Stored track units → frame px of the target picture as placed now. */
export const trackUnitsToFrame = (f: FrameBox, l: LayerPlacement, x: number, y: number) => layerSourceToFrame(f, l, x / TRACK_UNIT, y / TRACK_UNIT);

// ---- follow (ADR-0015, the resolver of engine follow.ts) ----
// The follower's own transform x, y is an offset from the tracked point P (frame px), scaled by m (1, or the tracked size times
// the target's scale when follow.scale is on):  resolved.x = (P.px + own.x·W·m − W/2) / W,  resolved.y likewise with H.

/** The resolved centre (transform units: fractions of the frame from its centre) of a follower with offset `own`. */
export function followCentre(a: { P: { px: number; py: number }; own: { x: number; y: number }; m: number; W: number; H: number }): { x: number; y: number } {
  return { x: (a.P.px + a.own.x * a.W * a.m - a.W / 2) / a.W, y: (a.P.py + a.own.y * a.H * a.m - a.H / 2) / a.H };
}
/** The offset that leaves a follower exactly where it is now (`cur`, transform units): the inverse of followCentre. */
export function keepOffset(a: { cur: { x: number; y: number }; P: { px: number; py: number }; m: number; W: number; H: number }): { x: number; y: number } {
  const m = a.m > 0 ? a.m : 1;
  return { x: (a.cur.x * a.W + a.W / 2 - a.P.px) / (a.W * m), y: (a.cur.y * a.H + a.H / 2 - a.P.py) / (a.H * m) };
}
/** P read back from a follower resolved with offset zero (its resolved x, y are then P measured from the frame centre). */
export const followPointFromZero = (zero: { x: number; y: number }, W: number, H: number) => ({ px: zero.x * W + W / 2, py: zero.y * H + H / 2 });
/** The scale factor m of a resolved follower (resolved.scale = own.scale · m). */
export const followFactor = (resolvedScale: number, ownScale: number) => (ownScale > 0 && Number.isFinite(resolvedScale / ownScale) ? resolvedScale / ownScale : 1);
/**
 * A move or scale of a follower made on the monitor (in resolved values) → its new own values: a move of Δ on screen is a
 * move of Δ/m of the offset; a resolved scale s is an own scale of s/m. Rotation and opacity are the follower's own.
 */
export function ownFromResolved(own: { x: number; y: number; scale: number }, before: { x: number; y: number; scale: number }, after: Partial<{ x: number; y: number; scale: number }>, m: number): Partial<{ x: number; y: number; scale: number }> {
  const k = m > 0 ? m : 1;
  const out: Partial<{ x: number; y: number; scale: number }> = {};
  if (after.x !== undefined) out.x = own.x + (after.x - before.x) / k;
  if (after.y !== undefined) out.y = own.y + (after.y - before.y) / k;
  if (after.scale !== undefined) out.scale = after.scale / k;
  return out;
}

/**
 * A clip's layer as the one evaluator draws it at `time` (preview, stills and export alike), and the frame it belongs to; null
 * when the clip is not drawn then. During a transition the incoming side is the clip's own picture.
 */
export function layerOf(doc: ProjectDocument, clipId: string, time: T.RationalTime): { layer: VideoLayer | ImageLayer | TextLayer; graph: RenderGraph } | null {
  let graph: RenderGraph;
  try { graph = evaluate(doc, time); } catch { return null; }
  const ls = graph.layers.filter((l): l is VideoLayer | ImageLayer | TextLayer => l.kind !== 'caption' && l.clipId === clipId);
  const layer = ls.find((l) => l.transition?.role !== 'out') ?? ls[0];
  return layer ? { layer, graph } : null;
}
/**
 * The offset (transform x, y) that attaches `clipId` to `follow` without moving it at `time` (keepOffset over the evaluator's
 * own follow resolver): the clip is evaluated as it is, and once more following with offset zero, which gives the tracked
 * point P and the scale factor m. With no target there ('target-missing') P is the frame centre and m is 1, so the offset is
 * where the clip is. Null when the clip is not drawn at that time. Clamped to the op's range (±4).
 */
export function followOffsetAt(doc: ProjectDocument, clipId: string, follow: Follow, time: T.RationalTime): { x: number; y: number } | null {
  const found = findClip(doc, clipId);
  if (!found || found.clip.type === 'caption') return null;
  const now = layerOf(doc, clipId, time);
  if (!now) return null;
  const trial = structuredClone(doc);
  const tc = findClip(trial, clipId)!.clip;
  if (tc.type === 'caption') return null;
  tc.follow = follow;
  tc.transform = { ...tc.transform, x: 0, y: 0 };
  const zero = layerOf(trial, clipId, time);
  if (!zero) return null;
  const { width: W, height: H } = now.graph;
  const m = followFactor(zero.layer.transform.scale, transformAt(tc, time).scale);
  const off = keepOffset({ cur: now.layer.transform, P: followPointFromZero(zero.layer.transform, W, H), m, W, H });
  return { x: Math.max(-4, Math.min(4, off.x)), y: Math.max(-4, Math.min(4, off.y)) };
}

// ---- tracking job progress (core trackingStage) ----
export interface TrackingProgress { phase: 'reading' | 'forward' | 'backward' | 'saving' | null; done: number; total: number; percent: number | null }
/**
 * Progress of a tracking job read from its stage text ('reading frames', 'tracking forward 12/240', 'tracking backward 3/90',
 * 'saving track'). The forward pass counts as the first half and the backward one as the second when both run; percent is
 * null while nothing is counted yet (an indeterminate progress bar).
 */
export function trackingProgress(stage: string | null | undefined, direction: 'both' | 'forward' | 'backward' = 'both'): TrackingProgress {
  if (!stage) return { phase: null, done: 0, total: 0, percent: null };
  if (stage === 'reading frames') return { phase: 'reading', done: 0, total: 0, percent: null };
  if (stage === 'saving track') return { phase: 'saving', done: 0, total: 0, percent: 100 };
  const m = /^tracking (forward|backward) (\d+)\/(\d+)$/.exec(stage);
  if (!m) return { phase: null, done: 0, total: 0, percent: null };
  const phase = m[1] as 'forward' | 'backward', done = Number(m[2]), total = Number(m[3]);
  const part = total > 0 ? Math.min(1, done / total) : 0;
  const share = direction === 'both' ? (phase === 'forward' ? part / 2 : 0.5 + part / 2) : part;
  return { phase, done, total, percent: Math.round(share * 100) };
}

// ---- source frames on the timeline ----
/**
 * The first timeline frame (main sequence, project rate) that shows source frame `from`..`to` (inclusive) of `assetId` on a video
 * track, found by scanning each clip of that file frame by frame with core sourceFrameIndexAt (the evaluator's rule, so speed,
 * ramps, reverse, freeze and slips are all accounted for). The scan stops at `limit` frames per clip. null when no clip shows it.
 */
export function timelineFrameOfSource(doc: ProjectDocument, assetId: string, from: number, to = from, limit = 200_000): { frame: number; clipId: string } | null {
  const asset = doc.assets[assetId];
  const seq = doc.sequences[doc.mainSequenceId];
  if (!asset?.video || !seq) return null;
  const rate = doc.settings.frameRate;
  const a = { ...asset, video: asset.video };
  let best: { frame: number; clipId: string } | null = null;
  for (const track of seq.tracks) {
    if (track.kind !== 'video') continue;
    for (const clip of track.clips) {
      if (clip.type !== 'media' || clip.assetId !== assetId) continue;
      const first = T.frameIndexAt(clip.start, rate);
      const n = Math.min(limit, Math.max(0, T.frameIndexAt(T.add(clip.start, clip.duration), rate) - first));
      for (let i = 0; i < n; i++) {
        if (best && first + i >= best.frame) break;
        const idx = sourceFrameIndexAt(a, clip as MediaClip, T.frameTime(first + i, rate), rate);
        if (idx >= from && idx <= to) { best = { frame: first + i, clipId: clip.id }; break; }
      }
    }
  }
  return best;
}

// ---- what the panels list ----
/** A motion track a clip can follow: the track, and the timeline track its file's picture is on (follow.targetTrackId). */
export interface FollowCandidate { motionTrackId: string; name: string; kind: 'point' | 'region'; assetId: string; targetTrackId: string; targetTrackIndex: number }
/**
 * The tracks a clip can follow (ADR-0015): those of the files on OTHER video tracks whose clips overlap the clip in time,
 * one entry per (motion track, timeline track), in timeline-track order and then by name. Follows cannot be chained, so a
 * track whose clips follow something themselves is skipped.
 */
export function followCandidates(doc: ProjectDocument, clipId: string): FollowCandidate[] {
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) return [];
  const own = seq.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  const clip = own?.clips.find((c) => c.id === clipId);
  if (!own || !clip) return [];
  const end = T.add(clip.start, clip.duration);
  const tracks = Object.values(doc.motionTracks ?? {});
  const out: FollowCandidate[] = [];
  seq.tracks.forEach((track, targetTrackIndex) => {
    if (track.id === own.id || track.kind !== 'video' || track.clips.some((c) => c.type !== 'caption' && !!c.follow)) return;
    const assets = new Set(track.clips.filter((c) => c.type === 'media' && T.lt(c.start, end) && T.lt(clip.start, T.add(c.start, c.duration))).map((c) => (c as MediaClip).assetId));
    for (const t of tracks.filter((m) => assets.has(m.assetId)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)))
      out.push({ motionTrackId: t.id, name: t.name, kind: t.kind, assetId: t.assetId, targetTrackId: track.id, targetTrackIndex });
  });
  return out;
}

/** Stored state codes that leave a privacy region without a trustworthy position: unknown, weak and lost (core ST 0, 2, 3). */
const UNSURE = new Set([0, 2, 3]);
/**
 * The timeline frames of a media clip on which one of its privacy regions that follow a track has no trustworthy position:
 * the frame's sample is unknown, weak or lost, the frame lies outside the track, or the track is gone. Read straight from the
 * stored states at each frame's source index (sourceFrameIndexAt), for the editor's warning; the render's own loss filter
 * (core lossFlags) widens these stretches a little and never narrows them.
 */
export function redactUnsureFrames(doc: ProjectDocument, clip: MediaClip): number {
  const asset = doc.assets[clip.assetId];
  const tracked = (clip.redact ?? []).filter((r) => r.motionTrackId !== null);
  if (!asset?.video || !tracked.length) return 0;
  const rate = doc.settings.frameRate;
  const a = { ...asset, video: asset.video };
  const first = T.frameIndexAt(clip.start, rate), n = Math.max(0, T.frameIndexAt(T.add(clip.start, clip.duration), rate) - first);
  let count = 0;
  for (let k = 0; k < n; k++) {
    const idx = sourceFrameIndexAt(a, clip, T.frameTime(first + k, rate), rate);
    const unsure = tracked.some((r) => {
      const t = Object.hasOwn(doc.motionTracks ?? {}, r.motionTrackId!) ? doc.motionTracks[r.motionTrackId!] : undefined;
      if (!t) return true;
      const i = idx - t.from;
      return i < 0 || i >= t.st.length || UNSURE.has(t.st[i]!);
    });
    if (unsure) count++;
  }
  return count;
}

/** Counts of each stored state code (index = core ST code) of a track. */
export const stateCounts = (st: readonly number[]): number[] => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const s of st) if (s >= 0 && s < 7) c[s]!++; return c; };
