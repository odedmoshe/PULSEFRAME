/**
 * Pure timeline evaluator (SPEC §8): ProjectDocument + exact time -> RenderGraph.
 * No I/O, no DOM. Preview, agent frames and export all call this same function.
 *
 * Layer order: tracks bottom-to-top in sequence order; within the graph, later layers draw over earlier ones.
 * Source-frame selection rule (schema v1, CFR sources):
 *   sourceTime = clip.sourceIn + (t - clip.start) × speed;  sourceFrame = floor(sourceTime * assetFrameRate)
 *   minus the whole frames by which the file's first picture starts after time 0 (asset.video.startTime), never below 0.
 *   sourceSeekSeconds is measured from the FIRST FRAME of the stream (decoders add their own file's first timestamp).
 */
import * as T from '@pulseframe/time';
import { captionAt, type CaptionLayer } from './captions.ts';
import { FLASH_SINCE } from './gpu.ts';
import { flashSchedule, flashSince } from './strobeSchedule.ts';
import { applyModulators } from './modulate.ts';
import { beatPositionAt, type BeatPosition, type TextAnimation, effectParamsAt, pictureSourceAt, sourceAt, startOffsetFrames, transformAt, type BlendMode, type Clip, type Mask, type ProjectDocument, type TextStyle, type Track, type TransitionType, type Transform } from '@pulseframe/core';

/**
 * One picture a time effect of kind 'taps' merges (ADR-0011). Built by the same path as the clip's own layer, at `time`.
 */
export interface TimeTap {
  /** The carrier clip (or a cut piece before it) as shown at `time`, without any look: no effects, blend, mask, transition or time. Video taps keep the CARRIER's clipId and set `lane`. */
  layer: VideoLayer | ImageLayer | TextLayer;
  /** Exact timeline time of this picture, clamped into the run of cut pieces (ADR-0011). Shutter: the sub-frame time of the transform. */
  time: T.RationalTime;
  /** Decode lane: 0 = the clip's own picture; k = the k-th tap (its own decoder, moving forward on its own in sequential export). */
  lane: number;
  /** Integer weight; TAP_WEIGHT_TOTAL in all for blend, trail, lighten and shutter; 0 for split. */
  weight: number;
}
/** Look applied by the compositor after the layer is placed (with its transform and opacity): effects in order, then mask, then transition and blend. */
export interface LayerLook {
  effects?: { type: string; params: Record<string, number | string | boolean> }[];
  blend?: BlendMode;
  mask?: Mask;
  /** Present during a transition. `in` = the clip carrying the transition; `out` = the previous clip playing on from its handle. progress is 0..1, already eased. */
  transition?: { type: TransitionType; progress: number; role: 'in' | 'out' };
  /** Present when the clip's first enabled effect is a time effect of kind 'taps'; `effects` then holds only the effects after it. */
  time?: { type: string; params: Record<string, number | string | boolean>; taps: TimeTap[] };
  /** Present when the clip's first enabled effect is a remap (time.stutter); already applied to this layer's picture; for describeMoment. */
  remap?: { type: string; shownFrame: number };
  /** Clip-local seconds of this frame (render quantity, never stored). */
  local?: number;
}
export interface VideoLayer extends LayerLook {
  kind: 'video';
  clipId: string;
  trackId: string;
  assetId: string;
  sourceTime: T.RationalTime;
  sourceFrameIndex: number;
  /** Mid-frame time in seconds, measured from the first frame of the stream: safe to hand to float-second decoder APIs without boundary ambiguity. The decoder adds its own file's first timestamp. */
  sourceSeekSeconds: number;
  /** Colour correction for a source the decoder read with the wrong matrix: 'bt709-as-bt601' re-reads BT.709-decoded pixels as BT.601. */
  colourFix?: 'bt709-as-bt601';
  sourceWidth: number;
  sourceHeight: number;
  transform: Transform;
  /** Decode lane (TimeTap.lane); absent = 0. */
  lane?: number;
}
/** A still picture. Same placement rules as video; one decoded image for the whole clip. */
export interface ImageLayer extends LayerLook { kind: 'image'; clipId: string; trackId: string; assetId: string; sourceWidth: number; sourceHeight: number; transform: Transform }
export interface TextLayer extends LayerLook { kind: 'text'; clipId: string; trackId: string; text: string; style: TextStyle; transform: Transform; /** Letter/word/line animation with where this frame is in the clip (seconds from its start, and the clip's length). */ animation?: TextAnimation & { local: number; total: number; fps: number } }
export type Layer = VideoLayer | ImageLayer | TextLayer | CaptionLayer;
export type PictureLayer = VideoLayer | ImageLayer;
export interface ActiveAudio { clipId: string; trackId: string; assetId: string; sourceTime: T.RationalTime; gain: number }
export interface RenderGraph {
  /** Where this frame falls in the beats of the music playing there; absent when no analysed music plays. Read by effects set to follow the music. */
  beat?: BeatPosition;
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

/**
 * `flash` gives a strobe the seconds since its last flash start on this frame (strobeSchedule.ts); the strobe has no other clock.
 * `beat` drives the beat modulators of the clip's effects (modulate.ts); without it they keep their base values.
 */
const look = (clip: Clip, time: T.RationalTime, flash: (clipId: string, effectId: string) => number, beat: BeatPosition | undefined): LayerLook => {
  const local = T.sub(time, clip.start);
  const fx = clip.effects?.filter((e) => e.enabled).map((e) => {
    const base = effectParamsAt(e, local);
    const params = e.modulate ? applyModulators(e, base, beat) : base;
    return { type: e.type, params: e.type === 'light.strobe' ? { ...params, [FLASH_SINCE]: flash(clip.id, e.id) } : params };
  });
  return { ...(fx?.length ? { effects: fx } : {}), ...(clip.blend ? { blend: clip.blend } : {}), ...(clip.type === 'media' && clip.mask ? { mask: clip.mask } : {}), local: T.toSeconds(local) };
};
const smooth = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Picture layer of a media clip at `time`. The source position is clamped to the last frame, so a clip asked to play past its source (a transition handle that no longer exists) freezes instead of failing. */
function pictureLayer(doc: ProjectDocument, track: Track, clip: Extract<Clip, { type: 'media' }>, time: T.RationalTime, flash: (clipId: string, effectId: string) => number, beat: BeatPosition | undefined): VideoLayer | ImageLayer | null {
  const asset = doc.assets[clip.assetId];
  if (!asset) return null;
  const sourceTime = pictureSourceAt(clip, time, T.frameTime(1, doc.settings.frameRate)); // a reversed clip mirrors the frame order here, for preview, stills and export alike
  if (asset.kind === 'image' && asset.image)
    return { kind: 'image', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceWidth: asset.image.width, sourceHeight: asset.image.height, transform: transformAt(clip, time), ...look(clip, time, flash, beat) };
  if (!asset.video) return null;
  const rate = asset.video.frameRate;
  // Frames are counted from the first picture in the file. When that picture does not sit at time 0, it is shown that many
  // frames later (and held until then), which keeps it in step with the sound.
  let idx = Math.max(0, T.frameIndexAt(sourceTime, rate) - startOffsetFrames(asset.video));
  const lastFrame = asset.video.frameCount !== null ? asset.video.frameCount - 1 : Math.max(0, T.frameIndexAt(asset.duration, rate) - 1);
  idx = Math.min(idx, lastFrame);
  return {
    kind: 'video', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime, sourceFrameIndex: idx,
    sourceSeekSeconds: ((idx + 0.5) * rate.den) / rate.num,
    ...(asset.video.untaggedColour && asset.video.readColourAs === 'bt601' && !asset.conform ? { colourFix: 'bt709-as-bt601' as const } : {}),
    sourceWidth: asset.video.width, sourceHeight: asset.video.height, transform: transformAt(clip, time), ...look(clip, time, flash, beat),
  };
}

export function evaluate(doc: ProjectDocument, time: T.RationalTime, sequenceId = doc.mainSequenceId): RenderGraph {
  const seq = doc.sequences[sequenceId];
  if (!seq) throw new Error(`sequence ${sequenceId} not found`);
  const { width, height, frameRate, background } = doc.settings;
  const graph: RenderGraph = { time, frameIndex: T.frameIndexAt(time, frameRate), width, height, background, fit: doc.settings.fit ?? 'contain', layers: [], audio: [] };
  const beat = beatPositionAt(doc, time, sequenceId);
  if (beat) graph.beat = beat;
  // the flash schedule of the timeline is worked out the first time a strobe is met (once per document, then reused)
  const flash = (clipId: string, effectId: string) => flashSince(flashSchedule(doc, sequenceId), clipId, effectId, graph.frameIndex);
  const captions: CaptionLayer[] = [];
  for (const track of seq.tracks) {
    if (track.kind === 'caption') { const c = captionAt(doc, seq, track, time); if (c) captions.push(c); continue; }
    for (const clip of track.clips) {
      // half-open [start, start+duration)
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      if (clip.type === 'text') {
        if (!track.hidden) graph.layers.push({ kind: 'text', clipId: clip.id, trackId: track.id, text: clip.text, style: clip.style, transform: transformAt(clip, time), ...look(clip, time, flash, graph.beat),
          ...(clip.animation ? { animation: { ...clip.animation, local: T.toSeconds(T.sub(time, clip.start)), total: T.toSeconds(clip.duration), fps: frameRate.num / frameRate.den } } : {}) });
        continue;
      }
      if (clip.type !== 'media') continue;
      const asset = doc.assets[clip.assetId];
      if (!asset) continue;
      if (track.kind === 'audio') {
        if (!track.muted && asset.audio) graph.audio.push({ clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime: sourceAt(clip, time), gain: clip.gain });
        continue;
      }
      if (track.kind !== 'video' || track.hidden) continue;
      const layer = pictureLayer(doc, track, clip, time, flash, graph.beat);
      if (!layer) continue;
      const local = T.frameIndexAt(T.sub(time, clip.start), frameRate);
      if (clip.transition && local < clip.transition.frames) {
        // Neither end shows a pure side: frame 0 is already slightly in, the last transition frame is not yet complete.
        const progress = smooth((local + 1) / (clip.transition.frames + 1));
        const prev = track.clips.find((c) => c.type === 'media' && c.id !== clip.id && T.eq(T.add(c.start, c.duration), clip.start));
        const out = prev && prev.type === 'media' ? pictureLayer(doc, track, prev, time, flash, graph.beat) : null;
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
    layers: g.layers.map((l) => (l.kind === 'video' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, sourceFrameIndex: l.sourceFrameIndex, sourceTime: l.sourceTime, ...(l.colourFix ? { colourFix: l.colourFix } : {}), ...lookOf(l) } : l.kind === 'image' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, ...lookOf(l) } : l.kind === 'caption' ? { kind: l.kind, trackId: l.trackId, sourceId: l.sourceId, text: l.words.map((w) => w.text).join(' '), currentWord: l.words.find((w) => w.state === 'current')?.text ?? null } : { kind: l.kind, clipId: l.clipId, text: l.text, ...lookOf(l) })),
    audio: g.audio,
  };
}

const lookOf = (l: LayerLook) => ({
  ...(l.effects ? { effects: l.effects.map((e) => e.type) } : {}), ...(l.blend ? { blend: l.blend } : {}), ...(l.mask ? { mask: l.mask.shape } : {}),
  ...(l.transition ? { transition: { type: l.transition.type, role: l.transition.role, progress: Number(l.transition.progress.toFixed(4)) } } : {}),
});
