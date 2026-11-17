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
import { OVERLAY_TYPES, heldOverlayParams } from './overlays.ts';
import { pieceAt, runStart, stutterFrame, tapOffsets, tapWeights } from './taps.ts';
import { beatPositionAt, isTimeEffect, temporalOf, type BeatPosition, type TextAnimation, effectParamsAt, pictureSourceAt, provideSoundTails, sourceAt, sourceFrameIndexAt, transformAt, type BlendMode, type Clip, type FollowInfo, type Mask, type ProjectDocument, type ResolvedRegion, type SoundTail, type TextStyle, type Track, type TransitionType, type Transform } from '@pulseframe/core';
import { audioPlan, soundEnd, type AudioPlan } from './audio.ts';

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
  /** Present when the clip follows a motion track (ADR-0015); `transform` is then already the resolved one (post-pass). */
  follow?: FollowInfo;
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
  /** Privacy regions (ADR-0015) resolved at THIS picture's sourceFrameIndex (taps and the stutter picture carry their own); drawn right after placement, before effects. */
  regions?: ResolvedRegion[];
}
/** A still picture. Same placement rules as video; one decoded image for the whole clip. */
export interface ImageLayer extends LayerLook { kind: 'image'; clipId: string; trackId: string; assetId: string; sourceWidth: number; sourceHeight: number; transform: Transform }
export interface TextLayer extends LayerLook { kind: 'text'; clipId: string; trackId: string; text: string; style: TextStyle; transform: Transform; /** Letter/word/line animation with where this frame is in the clip (seconds from its start, and the clip's length). */ animation?: TextAnimation & { local: number; total: number; fps: number } }
/**
 * Adjustment clip active at this time (ADR-0016). It never asks the FrameProvider for a picture: drawGraph copies the frame
 * so far into scratch slot ADJUST_PASS_SLOT, runs `effects` with a whole-frame box, applies `mask` (frame space) and
 * composites back with `opacity` and `blend`. Not yet a member of `Layer`: the templates track (W2) adds it there together
 * with the evaluator branch and the drawGraph pass.
 */
export interface AdjustLayer extends Pick<LayerLook, 'effects' | 'blend' | 'mask' | 'local'> { kind: 'adjust'; clipId: string; trackId: string; opacity: number }
/** Scratch canvas slot (look.ts `scratch`) reserved for the adjustment pass (wave-3 allocation: 14 = templates track). */
export const ADJUST_PASS_SLOT = 14;
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

/**
 * The picture of a media clip at `time` without any look: what a time tap reads (ADR-0011) and what a layer is placed from.
 * The source position is clamped to the last frame, so a clip asked to play past its source (a transition handle that no
 * longer exists) freezes instead of failing.
 */
function barePicture(doc: ProjectDocument, track: Track, clip: Extract<Clip, { type: 'media' }>, time: T.RationalTime): VideoLayer | ImageLayer | null {
  const asset = doc.assets[clip.assetId];
  if (!asset) return null;
  const sourceTime = pictureSourceAt(clip, time, T.frameTime(1, doc.settings.frameRate)); // a reversed clip mirrors the frame order here, for preview, stills and export alike
  if (asset.kind === 'image' && asset.image)
    return { kind: 'image', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceWidth: asset.image.width, sourceHeight: asset.image.height, transform: transformAt(clip, time) };
  if (!asset.video) return null;
  const rate = asset.video.frameRate;
  // Frames are counted from the first picture in the file. When that picture does not sit at time 0, it is shown that many
  // frames later (and held until then), which keeps it in step with the sound. The rule lives in core (speed.ts), where motion
  // tracks and the editor number frames by it too.
  const idx = sourceFrameIndexAt({ ...asset, video: asset.video }, clip, time, doc.settings.frameRate);
  return {
    kind: 'video', clipId: clip.id, trackId: track.id, assetId: asset.id, sourceTime, sourceFrameIndex: idx,
    sourceSeekSeconds: ((idx + 0.5) * rate.den) / rate.num,
    ...(asset.video.untaggedColour && asset.video.readColourAs === 'bt601' && !asset.conform ? { colourFix: 'bt709-as-bt601' as const } : {}),
    sourceWidth: asset.video.width, sourceHeight: asset.video.height, transform: transformAt(clip, time),
  };
}
/** A title at `time` without any look; its letter animation is placed at `time` too. */
const textAnimationAt = (clip: Extract<Clip, { type: 'text' }>, time: T.RationalTime, rate: T.Rate): Pick<TextLayer, 'animation'> =>
  clip.animation ? { animation: { ...clip.animation, local: T.toSeconds(T.sub(time, clip.start)), total: T.toSeconds(clip.duration), fps: rate.num / rate.den } } : {};
const bareText = (doc: ProjectDocument, track: Track, clip: Extract<Clip, { type: 'text' }>, time: T.RationalTime): TextLayer =>
  ({ kind: 'text', clipId: clip.id, trackId: track.id, text: clip.text, style: clip.style, transform: transformAt(clip, time), ...textAnimationAt(clip, time, doc.settings.frameRate) });
type Bare = VideoLayer | ImageLayer | TextLayer;
const bareLayer = (doc: ProjectDocument, track: Track, clip: Clip, time: T.RationalTime): Bare | null =>
  clip.type === 'media' ? barePicture(doc, track, clip, time) : clip.type === 'text' ? bareText(doc, track, clip, time) : null;

/** What one evaluation shares between its layers. */
interface Ctx { doc: ProjectDocument; sequenceId: string; flash: (clipId: string, effectId: string) => number; beat: BeatPosition | undefined }

/**
 * A clip's layer at `time` with its look, and with its time effect applied (ADR-0011): when the clip's first enabled effect
 * is a time effect it is taken out of `effects`; a 'taps' effect (echo, split, shutter) lists the pictures to merge in
 * `time`, a remap (stutter) changes the picture shown and is reported in `remap`.
 */
function clipLayer(cx: Ctx, track: Track, clip: Clip, time: T.RationalTime): VideoLayer | ImageLayer | TextLayer | null {
  if (clip.type === 'caption') return null;
  const bare = bareLayer(cx.doc, track, clip, time);
  if (!bare) return null;
  const lk = look(clip, time, cx.flash, cx.beat);
  const first = clip.effects?.find((e) => e.enabled);
  const temporal = first && isTimeEffect(first.type) ? temporalOf(first.type) : false;
  if (!first || !temporal) {
    if (bare.kind !== 'text') return { ...bare, ...lk };
    const { animation, ...text } = bare; // a title's animation stays after its look, as before
    return { ...text, ...lk, ...(animation ? { animation } : {}) };
  }
  // the time effect is the first of the look's effects (look keeps the enabled effects in order); the rest apply to its result
  const [own, ...rest] = lk.effects!;
  const { effects: _all, ...lookRest } = lk;
  const after = { ...(rest.length ? { effects: rest } : {}), ...lookRest };
  const rate = cx.doc.settings.frameRate;
  if (temporal.kind === 'remap') {
    const frame = T.frameIndexAt(time, rate);
    const shownFrame = stutterFrame(cx.doc, cx.sequenceId, track, clip, first.id, own!.params, frame);
    const shownAt = shownFrame === frame ? time : T.sub(time, T.frameTime(frame - shownFrame, rate)); // whole frames earlier, at the same place inside the frame
    const piece = pieceAt(track, clip, first.id, shownAt) ?? clip;
    const pic = bareLayer(cx.doc, track, piece, shownAt) ?? bare;
    // motion=live: keyframed movement (and a title's letter animation) goes on at the frame's own time; only the picture is held
    const live = own!.params.motion === 'live';
    const moved = live ? { ...pic, transform: bare.transform, ...(pic.kind === 'text' ? { animation: bare.kind === 'text' ? bare.animation : undefined } : {}) } : pic;
    if (moved.kind === 'text' && !moved.animation) delete moved.animation;
    return { ...moved, clipId: clip.id, trackId: track.id, ...after, remap: { type: own!.type, shownFrame } } as VideoLayer | ImageLayer | TextLayer;
  }
  const params = own!.params;
  const offsets = tapOffsets(own!.type, params, rate);
  const weights = tapWeights(own!.type, params, offsets.length);
  const from = runStart(track, clip, first.id);
  const shutter = own!.type === 'time.shutter';
  const taps: TimeTap[] = offsets.map((offset, k) => {
    const at = T.max(from, T.add(time, offset)); // never before the run of cut pieces
    const piece = pieceAt(track, clip, first.id, at) ?? clip;
    let layer: Bare;
    if (shutter && bare.kind !== 'text') {
      // the source frame of the frame time, moved as the clip moves at the sub-frame time: no extra decode
      layer = { ...bare, transform: transformAt(piece, at) };
    } else layer = bareLayer(cx.doc, track, piece, at) ?? bareLayer(cx.doc, track, clip, T.max(at, clip.start)) ?? bare;
    const lane = shutter ? 0 : k;
    // a tap is drawn for the carrier: its decoder is the carrier's own, lane k (a cut does not change the decoder of a lane)
    layer = layer.kind === 'video' ? { ...layer, clipId: clip.id, trackId: track.id, ...(lane ? { lane } : {}) } : { ...layer, clipId: clip.id, trackId: track.id };
    return { layer, time: at, lane, weight: weights[k] ?? 0 };
  });
  return { ...bare, ...after, time: { type: own!.type, params, taps } } as VideoLayer | ImageLayer | TextLayer;
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
  const cx: Ctx = { doc, sequenceId, flash, beat: graph.beat };
  const captions: CaptionLayer[] = [];
  for (const track of seq.tracks) {
    if (track.kind === 'caption') { const c = captionAt(doc, seq, track, time); if (c) captions.push(c); continue; }
    for (const clip of track.clips) {
      // half-open [start, start+duration)
      if (T.lt(time, clip.start) || !T.lt(time, T.add(clip.start, clip.duration))) continue;
      if (clip.type === 'text') {
        if (!track.hidden) { const l = clipLayer(cx, track, clip, time); if (l) graph.layers.push(l); }
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
      const layer = clipLayer(cx, track, clip, time);
      if (!layer) continue;
      const local = T.frameIndexAt(T.sub(time, clip.start), frameRate);
      if (clip.transition && local < clip.transition.frames) {
        // Neither end shows a pure side: frame 0 is already slightly in, the last transition frame is not yet complete.
        const progress = smooth((local + 1) / (clip.transition.frames + 1));
        const prev = track.clips.find((c) => c.type === 'media' && c.id !== clip.id && T.eq(T.add(c.start, c.duration), clip.start));
        // the outgoing side plays on from its handle with its own look, time effect included
        const out = prev && prev.type === 'media' ? clipLayer(cx, track, prev, time) : null;
        if (out) graph.layers.push({ ...out, transition: { type: clip.transition.type, progress, role: 'out' } });
        layer.transition = { type: clip.transition.type, progress, role: 'in' };
      }
      graph.layers.push(layer);
    }
  }
  graph.layers.push(...captions); // captions always draw above picture and titles
  holdOverlays(doc, seq.tracks, graph);
  return graph;
}

const LATTICE: readonly string[] = OVERLAY_TYPES;
/**
 * Lattice overlays (snow, confetti, hearts, bokeh) get the render parameters that hold their motion for the whole clip
 * (overlays.ts heldOverlayParams): worked out from the instance with all its keys and the project's frame shape, so a
 * keyframed density, opacity or size never moves the particles, and preview, stills and exports of any size agree.
 * A layer's effects are its clip's enabled effects in order (a time effect taken out at the front), so the n-th overlay
 * of the layer is the n-th enabled overlay of the clip.
 */
function holdOverlays(doc: ProjectDocument, tracks: readonly Track[], graph: RenderGraph): void {
  const aspect = doc.settings.width / doc.settings.height;
  for (const layer of graph.layers) {
    if (layer.kind === 'caption' || !layer.effects?.some((e) => LATTICE.includes(e.type))) continue;
    const clip = tracks.find((t) => t.id === layer.trackId)?.clips.find((c) => c.id === layer.clipId);
    const own = (clip && clip.type !== 'caption' ? clip.effects ?? [] : []).filter((e) => e.enabled && LATTICE.includes(e.type));
    let n = 0;
    layer.effects = layer.effects.map((e) => {
      if (!LATTICE.includes(e.type)) return e;
      const fx = own[n++];
      return fx?.type === e.type ? { ...e, params: { ...e.params, ...heldOverlayParams(fx, aspect) } } : e;
    });
  }
}


/**
 * Planned ring-out of every sound clip that has sound effects (ADR-0010), by clip id: the voice's tail (already cut at the end of
 * the video) in seconds, and whether that cut happened. From the audio plan, so it is what every route plays and exports.
 */
export function soundTailsOf(doc: ProjectDocument, sequenceId = doc.mainSequenceId): Map<string, SoundTail> {
  const plan = audioPlan(doc, sequenceId);
  const out = new Map<string, SoundTail>();
  for (const c of plan.clips) if (c.voice) out.set(c.clipId, { seconds: c.voice.tail / plan.sampleRate, cut: c.voice.cutFrom !== undefined });
  return out;
}
// Core's timeline() and the sound-effect operations report tails through this (core has no kernels; see core queries.ts soundTails).
provideSoundTails(soundTailsOf);

/** A sound heard at a moment only through its tail: the clip has ended, its echo or reverb has not. */
export interface TailAudio { clipId: string; trackId: string; assetId: string; tail: true; secondsAfterEnd: number; fx: string[] }
/**
 * What the audio plan says about the sound at timeline sample `sample` (ADR-0010 D9): the effects each planned clip runs through
 * (the enabled, audible ones, in processing order), and the clips heard only through their tail there. `sounding` are the clips
 * whose body covers the moment (the evaluator's audio entries); they are not listed again as tails.
 */
export function soundAt(plan: AudioPlan, sample: number, sounding: ReadonlySet<string>): { fx: Map<string, string[]>; tails: TailAudio[] } {
  const fx = new Map<string, string[]>(), tails: TailAudio[] = [];
  for (const c of plan.clips) {
    if (!c.voice) continue;
    const types = c.voice.chain.map((x) => x.type);
    fx.set(c.clipId, types);
    const end = c.at + c.length;
    if (!sounding.has(c.clipId) && sample >= end && sample < soundEnd(c)) tails.push({ clipId: c.clipId, trackId: c.trackId, assetId: c.assetId, tail: true, secondsAfterEnd: Number(((sample - end) / plan.sampleRate).toFixed(4)), fx: types });
  }
  return { fx, tails };
}
/** The audio plan of a committed document, worked out once (documents are not changed after commit; edits make new ones). */
const plans = new WeakMap<ProjectDocument, AudioPlan>();
const planOf = (doc: ProjectDocument) => { let p = plans.get(doc); if (!p) { p = audioPlan(doc); plans.set(doc, p); } return p; };

/**
 * Everything active at a time, in readable form (agent sense `describe_moment`). Sound entries say which sound effects they run
 * through (`fx`), and a clip whose echo or reverb is still ringing after its end is listed with `tail: true`.
 */
export function describeMoment(doc: ProjectDocument, time: T.RationalTime) {
  const g = evaluate(doc, time);
  const plan = planOf(doc);
  const sound = soundAt(plan, T.nearestSampleIndex(time, plan.sampleRate), new Set(g.audio.map((a) => a.clipId)));
  const seq = doc.sequences[doc.mainSequenceId];
  const clipOf = (l: { clipId: string; trackId: string }) => seq?.tracks.find((t) => t.id === l.trackId)?.clips.find((c) => c.id === l.clipId);
  const lookOf = (l: Exclude<Layer, CaptionLayer>) => {
    // the effect instances behind the layer's effects: the clip's enabled effects, without the time effect the evaluator took out
    const clip = clipOf(l);
    const instances = (clip && clip.type !== 'caption' ? clip.effects ?? [] : []).filter((e) => e.enabled).slice(l.time || l.remap ? 1 : 0);
    const modulated = (l.effects ?? []).flatMap((e, i) => {
      const names = Object.keys(instances[i]?.type === e.type ? instances[i]!.modulate ?? {} : {});
      return names.length ? [{ effect: e.type, index: i, params: Object.fromEntries(names.map((n) => [n, e.params[n]])) }] : [];
    });
    return {
      ...(l.time ? { time: { type: l.time.type, taps: l.time.taps.map((t) => ({ lane: t.lane, ...(t.layer.kind === 'video' ? { sourceFrameIndex: t.layer.sourceFrameIndex } : {}), weight: t.weight })) } } : {}),
      ...(l.remap ? { remap: { type: l.remap.type, shownFrame: l.remap.shownFrame } } : {}),
      ...(l.effects ? { effects: l.effects.map((e) => e.type) } : {}), ...(modulated.length ? { modulated } : {}), ...(l.blend ? { blend: l.blend } : {}), ...(l.mask ? { mask: l.mask.shape } : {}),
      ...(l.transition ? { transition: { type: l.transition.type, role: l.transition.role, progress: Number(l.transition.progress.toFixed(4)) } } : {}),
    };
  };
  return {
    time: g.time,
    seconds: T.toSeconds(g.time),
    frameIndex: g.frameIndex,
    layers: g.layers.map((l) => (l.kind === 'video' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, sourceFrameIndex: l.sourceFrameIndex, sourceTime: l.sourceTime, ...(l.colourFix ? { colourFix: l.colourFix } : {}), ...lookOf(l) } : l.kind === 'image' ? { kind: l.kind, clipId: l.clipId, assetId: l.assetId, ...lookOf(l) } : l.kind === 'caption' ? { kind: l.kind, trackId: l.trackId, sourceId: l.sourceId, text: l.words.map((w) => w.text).join(' '), currentWord: l.words.find((w) => w.state === 'current')?.text ?? null } : { kind: l.kind, clipId: l.clipId, text: l.text, ...lookOf(l) })),
    audio: [...g.audio.map((a) => ({ ...a, fx: sound.fx.get(a.clipId) ?? [] })), ...sound.tails],
  };
}
