/**
 * Motion tracking in the evaluator (ADR-0015): privacy regions resolved on each picture, and the follow post-pass.
 *
 * Tracks are stored per SOURCE frame of their asset (core tracking.ts), so every consumer reads the source frame the
 * evaluated picture really shows (VideoLayer.sourceFrameIndex): trims, cuts, slips, speed and ramps, reverse, freeze frames,
 * stutter, transition handles and every format follow from the one evaluator, for preview, stills and export alike
 * (ADR-0005). Everything here is a pure function of the document and the time; the loss filter is cached per track object.
 */
import * as T from '@pulseframe/time';
import {
  lossFlags, placed, regionGeometry, sourceToFrame, SIZE_UNIT, TRACK_STATES, TRACK_UNIT, trackSampleAt,
  type Asset, type Clip, type Follow, type FollowInfo, type MediaClip, type MotionTrack, type ProjectDocument, type ResolvedRegion, type Sequence, type Track, type Transform,
} from '@pulseframe/core';
import type { ImageLayer, RenderGraph, TextLayer, VideoLayer } from './evaluate.ts';

/** The loss fallback blurs the whole layer at least this strongly, whatever the region's own strength (ADR-0015). */
export const WHOLE_BLUR_MIN_STRENGTH = 0.6;

const motionTrackOf = (doc: ProjectDocument, id: string): MotionTrack | undefined => (Object.hasOwn(doc.motionTracks ?? {}, id) ? doc.motionTracks[id] : undefined);

/**
 * The privacy regions of a media clip on the picture of source frame `idx` (the picture's own index: every time tap and the
 * stutter picture resolve their own). A fixed region is as stored. A tracked one takes the sample at `idx`; when that frame
 * is outside the track or flagged by the loss filter (core lossFlags, in source frames of the asset), onLoss 'frame' blurs the
 * whole layer (style blur, strength at least WHOLE_BLUR_MIN_STRENGTH) and 'hold' keeps the region at the stored position (a
 * lost sample holds the last usable one). A region whose track no longer exists blurs the whole layer.
 */
export function resolveRegions(doc: ProjectDocument, clip: MediaClip, asset: Pick<Asset, 'video'> & { video: NonNullable<Asset['video']> }, idx: number): ResolvedRegion[] {
  const fps = asset.video.frameRate.num / asset.video.frameRate.den;
  return (clip.redact ?? []).map((r): ResolvedRegion => {
    const base = { id: r.id, shape: r.shape, feather: r.feather, style: r.style, strength: r.strength, color: r.color, sourceFrame: idx };
    const whole = (state: ResolvedRegion['state']): ResolvedRegion => ({ ...base, x: 0, y: 0, width: 1, height: 1, style: 'blur', strength: Math.max(r.strength, WHOLE_BLUR_MIN_STRENGTH), whole: true, state });
    if (r.motionTrackId === null) return { ...base, ...regionGeometry(r, null, null), whole: false, state: 'fixed' };
    const t = motionTrackOf(doc, r.motionTrackId);
    if (!t) return whole('unknown');
    const sample = trackSampleAt(t, idx);
    const state: ResolvedRegion['state'] = sample.outside ? 'outside' : TRACK_STATES[sample.st] ?? 'unknown';
    const lost = sample.outside || lossFlags(t, fps, r.weakIsLost)[idx - t.from] === 1;
    if (lost && r.onLoss === 'frame') return whole(state);
    return { ...base, ...regionGeometry(r, t, sample), whole: false, state };
  });
}

/** A layer whose clip follows a motion track, found by the evaluator's layer loop. */
export interface Follower { layer: VideoLayer | ImageLayer | TextLayer; clip: Clip & { follow: Follow } }
/** The evaluator's own layer of a clip at a time (evaluate.ts clipLayer), for a target that is not drawn in this frame. */
export type LayerAt = (track: Track, clip: Clip, time: T.RationalTime) => VideoLayer | ImageLayer | TextLayer | null;

const clipEnd = (c: Clip) => T.add(c.start, c.duration);
/**
 * The picture a follow reads, in this order (ADR-0015):
 *  1. a picture of the track's file drawn on the target track in this frame (the incoming side of a transition before the
 *     outgoing one, which plays on from its handle);
 *  2. otherwise (a hidden track) the clip of that file on the target track that covers the time, as the evaluator would draw it;
 *  3. otherwise the nearest clip of that file on the target track, held at its first or last frame ('target-absent'; the
 *     earlier one on a tie);
 *  4. otherwise none ('target-missing').
 */
function followTarget(doc: ProjectDocument, seq: Sequence, graph: RenderGraph, follow: Follow, mt: MotionTrack, layerAt: LayerAt): { layer: VideoLayer; absent: boolean } | null {
  let outgoing: VideoLayer | null = null;
  for (const l of graph.layers) {
    if (l.kind !== 'video' || l.trackId !== follow.targetTrackId || l.assetId !== mt.assetId) continue;
    if (l.transition?.role !== 'out') return { layer: l, absent: false };
    outgoing ??= l;
  }
  if (outgoing) return { layer: outgoing, absent: false };
  const track = seq.tracks.find((t) => t.id === follow.targetTrackId);
  if (!track || track.kind !== 'video') return null;
  const time = graph.time;
  const ofFile = track.clips.filter((c) => c.type === 'media' && c.assetId === mt.assetId);
  const covering = ofFile.find((c) => !T.lt(time, c.start) && T.lt(time, clipEnd(c)));
  if (covering) {
    const l = layerAt(track, covering, time);
    if (l?.kind === 'video') return { layer: l, absent: false };
  }
  const frame = T.frameTime(1, doc.settings.frameRate);
  let best: { clip: Clip; at: T.RationalTime; dist: T.RationalTime } | null = null;
  for (const c of ofFile) {
    if (c === covering) continue;
    const at = T.lt(time, c.start) ? c.start : T.max(c.start, T.sub(clipEnd(c), frame));
    const dist = T.lt(time, at) ? T.sub(at, time) : T.sub(time, at);
    if (!best || T.lt(dist, best.dist) || (T.eq(dist, best.dist) && T.lt(at, best.at))) best = { clip: c, at, dist };
  }
  if (best) {
    const l = layerAt(track, best.clip, best.at);
    if (l?.kind === 'video') return { layer: l, absent: true };
  }
  return null;
}

/**
 * The follow post-pass (ADR-0015), run by evaluate after its layer loop and before captions are added. Each follower's
 * transform becomes the resolved one; its own transform is an offset from the tracked point:
 *   P = sourceToFrame(placed(W, H, fit, target source size, target transform), x/TRACK_UNIT, y/TRACK_UNIT) of the sample at the
 *       target picture's sourceFrameIndex (smoothed over ±follow.smooth source frames),
 *   m = follow.scale ? s/SIZE_UNIT · target scale : 1,
 *   x = (P.x + own.x·W·m − W/2)/W, y = (P.y + own.y·H·m − H/2)/H, scale = own.scale·m; rotation and opacity stay its own.
 * All targets are read before any follower is changed, so the result never depends on layer order (a chain, which the
 * operations refuse, would read its leader's own transform). With no target the own transform is kept ('target-missing').
 */
export function resolveFollows(doc: ProjectDocument, seq: Sequence, graph: RenderGraph, followers: readonly Follower[], layerAt: LayerAt): void {
  if (!followers.length) return;
  const { width: W, height: H } = graph;
  const resolved = followers.map(({ layer, clip }): [Follower['layer'], Transform, FollowInfo] => {
    const f = clip.follow;
    const own = layer.transform;
    const mt = motionTrackOf(doc, f.motionTrackId);
    const target = mt ? followTarget(doc, seq, graph, f, mt, layerAt) : null;
    if (!mt || !target) return [layer, own, { motionTrackId: f.motionTrackId, state: 'target-missing', sourceFrame: null, confidence: 0, targetClipId: null }];
    const t = target.layer;
    const sample = trackSampleAt(mt, t.sourceFrameIndex, f.smooth);
    const P = sourceToFrame(placed(W, H, graph.fit, t.sourceWidth, t.sourceHeight, t.transform), sample.x / TRACK_UNIT, sample.y / TRACK_UNIT);
    const m = f.scale ? (sample.s / SIZE_UNIT) * t.transform.scale : 1;
    const transform: Transform = { ...own, x: (P.px + own.x * W * m - W / 2) / W, y: (P.py + own.y * H * m - H / 2) / H, scale: own.scale * m };
    const state = target.absent ? 'target-absent' : sample.outside ? 'outside' : TRACK_STATES[sample.st] ?? 'unknown';
    return [layer, transform, { motionTrackId: mt.id, state, sourceFrame: t.sourceFrameIndex, confidence: sample.outside ? 0 : sample.q, targetClipId: t.clipId }];
  });
  for (const [layer, transform, info] of resolved) { layer.transform = transform; layer.follow = info; }
}
