/**
 * Pure timeline evaluator (SPEC §8): ProjectDocument + exact time -> RenderGraph.
 * No I/O, no DOM. Preview, agent frames and export all call this same function.
 *
 * Layer order: tracks bottom-to-top in sequence order; within the graph, later layers draw over earlier ones.
 * Source-frame selection rule (schema v1, speed 1, CFR sources whose first PTS is 0):
 *   sourceTime = clip.sourceIn + (t - clip.start);  sourceFrame = floor(sourceTime * assetFrameRate)
 */
import * as T from '@pulseframe/time';
import { captionAt, type CaptionLayer } from './captions.ts';
import { effectParamsAt, transformAt, type BlendMode, type Clip, type Mask, type ProjectDocument, type TextStyle, type Track, type TransitionType, type Transform } from '@pulseframe/core';

/** Look applied by the compositor after the layer is placed: effects in order, then mask, then blend/opacity. */
export interface LayerLook {
  effects?: { type: string; params: Record<string, number | string | boolean> }[];
  blend?: BlendMode;
  mask?: Mask;
  /** Present during a transition. `in` = the clip carrying the transition; `out` = the previous clip playing on from its handle. progress is 0..1, already eased. */
  transition?: { type: TransitionType; progress: number; role: 'in' | 'out' };
}
export interface VideoLayer extends LayerLook {
  kind: 'video';
  clipId: string;
  trackId: string;
  assetId: string;
  sourceTime: T.RationalTime;
  sourceFrameIndex: number;
  /** Mid-frame timestamp in seconds: safe to hand to float-second decoder APIs without boundary ambiguity. */
  sourceSeekSeconds: number;
  sourceWidth: number;
  sourceHeight: number;
  transform: Transform;
}
/** A still picture. Same placement rules as video; one decoded image for the whole clip. */
export interface ImageLayer extends LayerLook { kind: 'image'; clipId: string; trackId: string; assetId: string; sourceWidth: number; sourceHeight: number; transform: Transform }
export interface TextLayer extends LayerLook { kind: 'text'; clipId: string; trackId: string; text: string; style: TextStyle; transform: Transform }
export type Layer = VideoLayer | ImageLayer | TextLayer | CaptionLayer;
export type PictureLayer = VideoLayer | ImageLayer;
export interface ActiveAudio { clipId: string; trackId: string; assetId: string; sourceTime: T.RationalTime; gain: number }
export interface RenderGraph {
  time: T.RationalTime;
  frameIndex: number;
  width: number;
  height: number;
  background: string;
  /** How pictures are placed before their own transform. */
  fit: 'contain' | 'cover';
  layers: Layer[];
  audio: ActiveAudio[];
}

const look = (clip: Clip, time: T.RationalTime): LayerLook => {
  const local = T.sub(time, clip.start);
  const fx = clip.effects?.filter((e) => e.enabled).map((e) => ({ type: e.type, params: effectParamsAt(e, local) }));
  return { ...(fx?.length ? { effects: fx } : {}), ...(clip.blend ? { blend: clip.blend } : {}), ...(clip.type === 'media' && clip.mask ? { mask: clip.mask } : {}) };
};
const smooth = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Picture layer of a media clip at `time`. The source position is clamped to the last frame, so a clip asked to play past its source (a transition handle that no longer exists) freezes instead of failing. */
function pictureLayer(doc: ProjectDocument, track: Track, clip: Extract<Clip, { type: 'media' }>, time: T.RationalTime): VideoLayer | ImageLayer | null {
  const asset = doc.assets[clip.assetId];
  if (!asset) return null;
  const sourceTime = T.add(clip.sourceIn, T.sub(time, clip.start));
  if (asset.kind === 'image' && asset.image)
    return { kind: 'image', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceWidth: asset.image.width, sourceHeight: asset.image.height, transform: transformAt(clip, time), ...look(clip, time) };
  if (!asset.video) return null;
  const rate = asset.video.frameRate;
  let idx = Math.max(0, T.frameIndexAt(sourceTime, rate));
  const lastFrame = asset.video.frameCount !== null ? asset.video.frameCount - 1 : Math.max(0, T.frameIndexAt(asset.duration, rate) - 1);
  idx = Math.min(idx, lastFrame);
  return {
    kind: 'video', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime, sourceFrameIndex: idx,
    sourceSeekSeconds: ((idx + 0.5) * rate.den) / rate.num,
    sourceWidth: asset.video.width, sourceHeight: asset.video.height, transform: transformAt(clip, time), ...look(clip, time),
  };
}

export function evaluate(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): RenderGraph {
  const seq = doc.sequences[sequenceId];
  if (!seq) throw new Error(`sequence ${sequenceId} not found`);
  const { width, height, frameRate, background } = doc.settings;
  const graph: RenderGraph = { time, frameIndex: T.frameIndexAt(time, frameRate), width, height, background, fit: doc.settings.fit ?? 'contain', layers: [], audio: [] };
  const captions: CaptionLayer[] = [];
  for (const track of seq.tracks) {
    if (track.kind === 'caption') { const c = captionAt(doc, seq, track, time); if (c) captions.push(c); continue; }
    for (const clip of track.clips) {
      // half-open [start, start+duration)
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      if (clip.type === 'text') {
        if (!track.hidden) graph.layers.push({ kind: 'text', clipId: clip.id, trackId: track.id, text: clip.text, style: clip.style, transform: transformAt(clip, time), ...look(clip, time) });
        continue;
      }
      if (clip.type !== 'media') continue;
      const asset = doc.assets[clip.assetId];
      if (!asset) continue;
      if (track.kind === 'audio') {
        if (!track.muted && asset.audio) graph.audio.push({ clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime: T.add(clip.sourceIn, T.sub(time, clip.start)), gain: clip.gain });
        continue;
      }
      if (track.kind !== 'video' || track.hidden) continue;
      const layer = pictureLayer(doc, track, clip, time);
      if (!layer) continue;
      const local = T.frameIndexAt(T.sub(time, clip.start), frameRate);
      if (clip.transition && local < clip.transition.frames) {
        // Neither end shows a pure side: frame 0 is already slightly in, the last transition frame is not yet complete.
        const progress = smooth((local + 1) / (clip.transition.frames + 1));
        const prev = track.clips.find((c) => c.type === 'media' && c.id !== clip.id && T.eq(T.add(c.start, c.duration), clip.start));
        const out = prev && prev.type === 'media' ? pictureLayer(doc, track, prev, time) : null;
        if (out) graph.layers.push({ ...out, transition: { type: clip.transition.type, progress, role: 'out' } });
        layer.transition = { type: clip.transition.type, progress, role: 'in' };
      }
      graph.layers.push(layer);
    }
  }
  graph.layers.push(...captions); // captions always draw above picture and titles
  return graph;
}

/** Everything active at a time, in readable form (agent sense `describe_moment`). */
export function describeMoment(doc: ProjectDocument, time: T.RationalTime) {
  const g = evaluate(doc, time);
  return {
    time: g.time,
    seconds: T.toSeconds(g.time),
    frameIndex: g.frameIndex,
    layers: g.layers.map((l) => (l.kind === 'video' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, sourceFrameIndex: l.sourceFrameIndex, sourceTime: l.sourceTime, ...lookOf(l) } : l.kind === 'image' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, ...lookOf(l) } : l.kind === 'caption' ? { kind: l.kind, trackId: l.trackId, sourceId: l.sourceId, text: l.words.map((w) => w.text).join(' '), currentWord: l.words.find((w) => w.state === 'current')?.text ?? null } : { kind: l.kind, clipId: l.clipId, text: l.text, ...lookOf(l) })),
    audio: g.audio,
  };
}

const lookOf = (l: LayerLook) => ({
  ...(l.effects ? { effects: l.effects.map((e) => e.type) } : {}), ...(l.blend ? { blend: l.blend } : {}), ...(l.mask ? { mask: l.mask.shape } : {}),
  ...(l.transition ? { transition: { type: l.transition.type, role: l.transition.role, progress: Number(l.transition.progress.toFixed(4)) } } : {}),
});
