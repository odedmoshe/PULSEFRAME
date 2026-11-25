/**
 * Operation registry (SPEC §6). Every persistent edit is a named, schema-validated,
 * pure state transition. UI, REST and MCP all go through `applyTransaction`.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import {
  ANIMATABLE, AssetSchema, EASINGS, DEFAULT_TEXT_ANIMATION, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, TextAnimationSchema, RationalTimeSchema as RT, TextStyleSchema, TransformSchema,
  normaliseTextStyle, TEXT_LOOK_FIELDS, timelineBehaviour,
  CaptionStyleSchema, DEFAULT_CAPTION_STYLE, RunRangeSchema, SafeAreaSchema, MARKER_COLORS, VariantTranslationSchema,
  type AdjustmentClip, type Asset, type CaptionStyle, type Clip, type MediaClip, type ProjectDocument, type Marker, type Sequence, type Track, type Transcript, type Variant,
} from './schema.ts';
import { findProfile, FORMAT_PROFILES } from './variants.ts';
import { parseSubtitles, snapCuesToFrames } from './subtitles.ts';
import { handleAfterEnd, handleBeforeStart, isFreeze, isRamped, isReverse, pictureSourceAt, rampWindowOf, rampWindowOfPart, sourceEnd, sourceInOfPart, speedFromNumber, speedValue, timelineAt, toSourceSpan, toTimelineSpan, type Speed } from './speed.ts';
import { AUDIO_EFFECTS, AUDIO_PRESETS, findAudioEffect, MAX_AUDIO_FX, sortAudioFx, type AudioFxInstance, type AudioFxParams } from './audioEffects.ts';
import { soundTails } from './queries.ts';
import { cleanVoiceEffects, isCleanupType, NOISE_PROFILE_PATTERN } from './voiceClean.ts';
import { findSpeedCurve, segmentsFromPoints, SPEED_CURVE_IDS } from './speedCurves.ts';
import { ANIMATE_CLIP_MOTIONS, animateClipKeys, defaultMotionFrames, MOTION_PRESETS, motionKeys, previousMotion, shortestSafeLoopFrames } from './motionPresets.ts';
import { findLayout, layoutPlacements, LAYOUT_IDS, LAYOUTS } from './layouts.ts';
const MOTION_PRESET_IDS = MOTION_PRESETS.map((m) => m.id) as [string, ...string[]];
import { lookParams } from './looks.ts';
import { findTextPreset } from './textPresets.ts';
import { CAPTION_LOOK_IDS, findCaptionLook } from './captionPresets.ts';
import { animatableParams, BLEND_MODES, DEFAULT_MASK, EFFECTS, effectParams, findEffect, isTimeEffect, MaskSchema, modulatableParams, ModulatorSchema, paramRange, TRANSITION_IDS, TransitionColor, transitionDef, type EffectInstance, type Modulator, type Transition } from './effects.ts';
import { velocityNeeds } from './transitionTiming.ts';
import { adjustmentRefusal, clipEnd, forbidsOverlap, lutAssets, lutUsers, sequenceDuration, validateProject } from './validate.ts';
import { frameOf } from './sequences.ts';
import { cloneDocument } from './clone.ts';
import { analysisEntityId, fingerprint, restoreEntities, trackOrderEntityId, transcriptEntityId, type EntityState } from './entities.ts';
import { effectParamRange, effectParamsAt, sampleKeyframes, shiftKeyframes, transformAt, TRANSFORM_RANGE } from './animation.ts';
import { channelWords, CurveHandlesSchema, isV1Easing, KEYFRAME_REFUSALS, MAX_EFFECT_KEYS, MAX_TRANSFORM_KEYS, type CurveHandles, type Easing, type InsertSplit, type Keyframe, type KeyframeRefusalKey, type ValueRange } from './keyframe.ts';
import { splitSegment, turnsBack } from './curves.ts';
import { isLightChannel } from './keyframeChannels.ts';
import { detachAssetFromEvents } from './events.ts';
import { handDownCapture } from './capture.ts';
import { ownBeats, sceneCutsFor, timingRelations, transcriptFor } from './lineage.ts';
import { skippedClips, timingCoverage, untimedCopyRefusal } from './cleanup.ts';
import { MULTICAM_REFUSALS, type MulticamRefusalKey, type MulticamRefusalRow } from './multicamRefusals.ts';
import { projectCameraSamples, STEADY_REFUSALS } from './steadyContract.ts';
import { detachRangesOfAsset } from './sourceRanges.ts';
import { DEFAULT_REDACT_REGION, isUsable, MAX_MOTION_TRACKS, MAX_PROJECT_TRACK_SAMPLES, MAX_REDACT_REGIONS, MAX_TRACK_SAMPLES, roundHalfUp, SIZE_UNIT, ST, TrackOpArgs, trackSampleAt, type MotionTrack, type RedactRegion } from './tracking.ts';

export type OpErrorCode =
  | 'unknown_op' | 'invalid_args' | 'not_found' | 'track_locked' | 'overlap' | 'out_of_bounds'
  | 'incompatible' | 'forbidden_op' | 'invalid_result'
  // replace_clip_asset (ADR-0017): the new file does not keep the original's timing / does not cover what the clip shows
  | 'not_time_preserving' | 'range_not_covered'
  // edits by a recording's times (delete_transcript_range; tidy-speech and the filler/silence routes use the same code): nothing on the
  // timeline plays the recording on a known clock, and a clip shows a copy of it that records no time mapping
  | 'untimed_copy';
export class OpError extends Error {
  constructor(public code: OpErrorCode, message: string, public details: Record<string, unknown> = {}, public hint?: string) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

/** A multicam refusal (ADR-0020, multicamRefusals.ts) raised by an op of this file; multicamContract.ts multicamRefusal is the same for multicamOps.ts. */
function mcRefusal<K extends MulticamRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MULTICAM_REFUSALS)[K]['message']>): OpError {
  const r = MULTICAM_REFUSALS[key] as MulticamRefusalRow<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** Multicam groups (ADR-0020) whose files include the asset. */
const groupsUsingAsset = (d: ProjectDocument, assetId: string): string[] =>
  Object.values(d.multicam ?? {}).filter((g) => g.angles.some((an) => an.pieces.some((p) => p.assetId === assetId))).map((g) => g.id);
/** A clip tagged as a multicam segment cannot be given another file: its file is set by its group (ADR-0020; wave 1 refuses AI-derived copies on it). */
const refuseTagged = (c: Clip) => { if (c.type === 'media' && c.multicam) throw mcRefusal('taggedClip', { clipId: c.id, groupId: c.multicam.groupId, angleId: c.multicam.angleId }); };

export interface OpContext {
  /** Deterministic id source: ids are a pure function of the logged transaction seed. */
  newId(prefix: string): string;
  /** Actor derived from authentication by the caller, never from op args. */
  actor: string;
}
export interface OpResult { affectedIds: string[]; summary: string; output?: Record<string, unknown> }
export interface OpDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  version: number;
  description: string;
  args: S;
  /** Internal ops attach results of trusted server jobs (e.g. ingest) and are not callable by API clients. */
  internal?: boolean;
  /**
   * Argument keys whose ids this op looks up itself with an own-property test (Object.hasOwn) and refuses with a more
   * helpful error than the generic guard would (refuseInheritedIds). The guard leaves only these keys to the op.
   */
  checksOwnIds?: readonly string[];
  /** Mutates the draft (a private deep copy). Throw OpError to reject the whole transaction. */
  apply(draft: ProjectDocument, args: z.infer<S>, ctx: OpContext): OpResult;
}

const registry = new Map<string, OpDefinition>();
/**
 * Register an operation (once, at module load). Used by this file and by modules that keep an op family in a file of its own
 * (templateOps.ts); every registered op still runs only through applyTransaction.
 */
export function defineOp<S extends z.ZodType>(def: OpDefinition<S>) {
  if (registry.has(def.name)) throw new Error(`duplicate op ${def.name}`);
  registry.set(def.name, def as unknown as OpDefinition);
}
export const listOps = () => [...registry.values()];

/**
 * Names that every plain object answers to through its prototype (`__proto__`, `constructor`, `toString`, …). Library
 * files, sequences, analyses and variants are kept in plain objects keyed by id, so an id equal to one of these names
 * would find something that is not an entry (`d.assets.__proto__` is Object.prototype), and writing to it would change
 * every object in the process. No id this product makes can be such a name (ids are `prefix_…`), so an argument that
 * names one is refused before any op sees it.
 */
const INHERITED_NAMES: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));
const isIdKey = (key: string) => key === 'id' || key === 'lut' || /Ids?$/.test(key);
/** Throws `not_found` when an id-like argument (a key named `id`, `…Id` or `…Ids`, at any depth) is one of those names. */
export function refuseInheritedIds(args: unknown, where: string, key = '', leave: readonly string[] = []): void {
  if (typeof args === 'string') { if (isIdKey(key) && !leave.includes(key) && INHERITED_NAMES.has(args)) throw new OpError('not_found', `${where}: no ${key} "${args}"`, { [key]: args }); return; }
  if (Array.isArray(args)) { for (const v of args) refuseInheritedIds(v, where, key, leave); return; }
  if (args && typeof args === 'object') for (const [k, v] of Object.entries(args)) refuseInheritedIds(v, where, isIdKey(k) ? k : k === 'params' || k === 'args' ? '' : isIdKey(key) ? key : k, leave);
}
export const getOp = (name: string) => registry.get(name);
export function describeOps(opts: { includeInternal?: boolean } = {}) {
  return listOps()
    .filter((o) => opts.includeInternal || !o.internal)
    .map((o) => ({ name: o.name, version: o.version, description: o.description, argsSchema: z.toJSONSchema(o.args) }));
}

// ---------- helpers ----------
const seqOf = (d: ProjectDocument, id?: string): Sequence => {
  const s = d.sequences[id ?? d.mainSequenceId];
  if (!s) throw new OpError('not_found', `sequence ${id} not found`, { sequenceId: id });
  return s;
};
export function findClip(d: ProjectDocument, clipId: string): { seq: Sequence; track: Track; clip: Clip; index: number } | undefined {
  for (const seq of Object.values(d.sequences))
    for (const track of seq.tracks) {
      const index = track.clips.findIndex((c) => c.id === clipId);
      if (index >= 0) return { seq, track, clip: track.clips[index]!, index };
    }
  return undefined;
}
/** The clip, refused when it does not exist or its track is locked. Exported for op families kept in their own file (lifeOps.ts). */
export const mustClip = (d: ProjectDocument, clipId: string) => {
  const f = findClip(d, clipId);
  if (!f) throw new OpError('not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list current clip ids.');
  if (f.track.locked) throw new OpError('track_locked', `track ${f.track.id} is locked`, { trackId: f.track.id, clipId });
  return f;
};
const mustTrack = (seq: Sequence, trackId: string) => {
  const t = seq.tracks.find((x) => x.id === trackId);
  if (!t) throw new OpError('not_found', `track ${trackId} not found`, { trackId });
  if (t.locked) throw new OpError('track_locked', `track ${trackId} is locked`, { trackId });
  return t;
};
export const sortClips = (t: Track) => t.clips.sort((a, b) => T.cmp(a.start, b.start) || (a.id < b.id ? -1 : 1));
const overlaps = (t: Track, start: T.RationalTime, end: T.RationalTime, ignore: Set<string>) =>
  t.clips.find((c) => !ignore.has(c.id) && T.lt(c.start, end) && T.lt(start, clipEnd(c)));
function assertFree(t: Track, start: T.RationalTime, end: T.RationalTime, ignore = new Set<string>()) {
  if (!forbidsOverlap(t)) return;
  const hit = overlaps(t, start, end, ignore);
  if (hit) throw new OpError('overlap', `range overlaps clip ${hit.id} on track ${t.id}`, { trackId: t.id, clipId: hit.id, clipStart: hit.start, clipEnd: clipEnd(hit) }, 'Choose a free range, another track, or omit trackId to auto-place.');
}
/** Refuse a time off the project's frame grid, with the nearest frame. Exported for op families kept in their own file (sequenceOps.ts). */
export function assertAligned(d: ProjectDocument, t: T.RationalTime, what: string) {
  if (!T.isFrameAligned(t, d.settings.frameRate))
    throw new OpError('invalid_args', `${what} must fall on a ${d.settings.frameRate.num}/${d.settings.frameRate.den} fps frame boundary`, { value: t, nearest: T.snapToFrame(t, d.settings.frameRate) }, 'Use the returned nearest value.');
}
/**
 * The typed refusal of the keyframe curve rules and operations (ADR-0019, keyframe.ts KEYFRAME_REFUSALS):
 * `throw keyframeRefusal('curveFlash', { clipId, channel }, 'overshoot', 'opacity')`. Exported for keyframeOps.ts.
 */
export function keyframeRefusal<K extends KeyframeRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof KEYFRAME_REFUSALS)[K]['message']>): OpError {
  const r = KEYFRAME_REFUSALS[key] as { code: OpErrorCode; message: (...v: unknown[]) => string; hint?: string };
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/**
 * The curve rules of one key (ADR-0019, keyframe.ts FIXED RULES): `bezier` exactly when easing is 'bezier', and no curve that
 * turns back on a light channel (keyframeChannels.ts isLightChannel). `channel` names the channel in the refusal
 * (keyframe.ts channelWords). Exported for sequenceOps.ts and keyframeOps.ts.
 */
export function assertKeyCurve(k: { easing: Easing; bezier?: CurveHandles | undefined }, light: boolean, channel: string, details: Record<string, unknown>): void {
  if (k.easing === 'bezier' && k.bezier === undefined) throw keyframeRefusal('bezierNeedsHandles', details);
  if (k.easing !== 'bezier' && k.bezier !== undefined) throw keyframeRefusal('handlesNeedBezier', details, k.easing);
  if (light && turnsBack(k.easing, k.bezier)) throw keyframeRefusal('curveFlash', details, k.easing, channel);
}
/** A key as stored: `bezier` only with easing 'bezier' (no undefined field, so a v1 key is exactly {time, value, easing}). */
export const storedKey = (time: T.RationalTime, value: number, easing: Easing, bezier?: CurveHandles): Keyframe =>
  easing === 'bezier' && bezier ? { time, value, easing, bezier: [...bezier] as CurveHandles } : { time, value, easing };
/**
 * set_keyframe / set_effect_keyframe (ADR-0019 §3a): write the key at `time` into a channel's keys.
 * - Easing left out: an existing key keeps its easing AND its handles; handles alone are accepted only on a key that already
 *   has a custom curve. 'bezier' without handles keeps the key's own handles, if it has them. A named easing drops handles.
 * - A NEW key strictly inside a segment whose start key has a new curve is placed by curves.ts splitSegment, so the curve keeps
 *   its shape (the new key then takes the given value); `split` says whether that was exact. Every other new key keeps
 *   today's rule ('linear' unless given, the earlier key unchanged), so old op logs replay byte-identically.
 */
function writeKey(keys: readonly Keyframe[], time: T.RationalTime, value: number, easing: Easing | undefined, bezier: CurveHandles | undefined,
  o: { rate: T.Rate; range: ValueRange; light: boolean; channel: string; max: number; details: Record<string, unknown> }): { keys: Keyframe[]; split: InsertSplit } {
  const i = keys.findIndex((k) => T.eq(k.time, time));
  const old = i >= 0 ? keys[i] : undefined;
  let curve: { easing: Easing; bezier?: CurveHandles } | undefined;
  if (easing === undefined) {
    if (bezier !== undefined) curve = { easing: old?.easing === 'bezier' ? 'bezier' : old?.easing ?? 'linear', bezier };
  } else curve = { easing, ...(easing === 'bezier' ? { bezier: bezier ?? old?.bezier } : bezier !== undefined ? { bezier } : {}) };
  if (curve) assertKeyCurve(curve, o.light, o.channel, o.details);
  if (old) {
    const next = [...keys];
    next[i] = curve ? storedKey(time, value, curve.easing, curve.bezier) : storedKey(time, value, old.easing, old.bezier);
    return { keys: next, split: 'none' };
  }
  if (keys.length + 1 > o.max) throw keyframeRefusal('tooManyKeys', o.details, o.max);
  let lo = -1;
  for (let j = 0; j + 1 < keys.length; j++) if (T.lt(keys[j]!.time, time) && T.lt(time, keys[j + 1]!.time)) { lo = j; break; }
  if (lo >= 0 && !isV1Easing(keys[lo]!.easing)) {
    const r = splitSegment(keys, time, o.rate, o.range);
    const placed = r.keys[lo + 1]!;
    r.keys[lo + 1] = curve ? storedKey(time, value, curve.easing, curve.bezier) : storedKey(time, value, placed.easing, placed.bezier);
    return { keys: r.keys, split: r.exact ? 'exact' : 'approximate' };
  }
  const next = [...keys, curve ? storedKey(time, value, curve.easing, curve.bezier) : { time, value, easing: 'linear' as const }];
  next.sort((x, y) => T.cmp(x.time, y.time));
  return { keys: next, split: 'none' };
}
/**
 * placeMotion's keys (ADR-0019 §3b): `withCurve(k, from)` is k with the curve of `from` (its easing and, for a custom curve, its
 * handles); `withCurve(k, 'linear')` resets it. A key whose curve is not one a motion writes is not recognised by
 * motionPresets.ts previousMotion, so a later preset treats it as hand-made and leaves it.
 */
const withCurve = (k: Keyframe, from: Keyframe | 'linear'): Keyframe => (from === 'linear' ? storedKey(k.time, k.value, 'linear') : storedKey(k.time, k.value, from.easing, from.bezier));
/** A new empty track of `kind` in its stacking slot (default name V1, A1, T1, C1, FX1 …). Exported for add_sequence (sequenceOps.ts). */
export function newTrack(seq: Sequence, kind: Track['kind'], ctx: OpContext, name?: string): Track {
  const count = seq.tracks.filter((t) => t.kind === kind).length + 1;
  const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'caption' ? 'C' : kind === 'adjustment' ? 'FX' : 'T';
  const track: Track = { id: ctx.newId('trk'), kind, name: name ?? `${prefix}${count}`, locked: false, muted: false, hidden: false, clips: [] };
  // Bottom-most first: picture tracks, adjustment tracks (a look covers every picture, also ones added later; ADR-0016), titles, audio.
  const at = kind === 'audio' ? -1
    : kind === 'video' ? seq.tracks.findIndex((t) => t.kind !== 'video')
    : kind === 'adjustment' ? seq.tracks.findIndex((t) => t.kind === 'text' || t.kind === 'caption' || t.kind === 'audio')
    : seq.tracks.findIndex((t) => t.kind === 'audio');
  seq.tracks.splice(at < 0 ? seq.tracks.length : at, 0, track);
  return track;
}
/**
 * First unlocked track of `kind` where [start,end) is free; otherwise a new track. Sound may overlap sound on one track
 * when a track is named (that is how crossfades are made), but a clip placed automatically never lands on top of another:
 * two sounds stacked on one track hide each other on the timeline.
 */
function placeTrack(seq: Sequence, kind: Track['kind'], start: T.RationalTime, end: T.RationalTime, ctx: OpContext): Track {
  for (const t of seq.tracks) if (t.kind === kind && !t.locked && !overlaps(t, start, end, new Set())) return t;
  return newTrack(seq, kind, ctx);
}
/** The other clips of a clip's link group, wherever they are (none for a clip that is not linked, or whose link id no other clip carries). */
export const partnersOf = (d: ProjectDocument, clip: Clip) => {
  const out: { track: Track; clip: MediaClip }[] = [];
  if (clip.type !== 'media' || !clip.linkGroupId) return out;
  for (const seq of Object.values(d.sequences))
    for (const track of seq.tracks)
      for (const c of track.clips) if (c.type === 'media' && c.id !== clip.id && c.linkGroupId === clip.linkGroupId) out.push({ track, clip: c });
  return out;
};
/** The other clips of a clip's link group, which an edit of the clip changes too: refused while one of them is on a locked track. */
export const linked = (d: ProjectDocument, clip: Clip) => {
  const out = partnersOf(d, clip);
  for (const l of out) if (l.track.locked) throw new OpError('track_locked', `linked clip ${l.clip.id} is on locked track ${l.track.id}`, { trackId: l.track.id, clipId: l.clip.id }, 'Unlock the track or pass includeLinked=false.');
  return out;
};
/** The link ids the given clips carry. */
export const linkIdsOf = (clips: Iterable<Clip>) => {
  const out = new Set<string>();
  for (const c of clips) if (c.type === 'media' && c.linkGroupId) out.add(c.linkGroupId);
  return out;
};
/**
 * A link group of one clip is not a link. After an edit has removed, divided or detached clips of the given link groups,
 * a clip left as the only member of one of them loses its link id in the same edit, so that no clip carries a link id
 * that no other clip has (undo brings the link back with the rest of the edit). Clearing it changes that clip, so like
 * unlink_clip it is refused while the clip is on a locked track. Groups that keep two or more members are left as they
 * are. Returns the ids of the clips that were unlinked, in document order.
 */
export function dissolveLoneLinks(d: ProjectDocument, groups: Iterable<string>): string[] {
  const want = new Set(groups);
  if (!want.size) return [];
  const members = new Map<string, { track: Track; clip: MediaClip }[]>();
  for (const seq of Object.values(d.sequences))
    for (const track of seq.tracks)
      for (const clip of track.clips) {
        if (clip.type !== 'media' || !clip.linkGroupId || !want.has(clip.linkGroupId)) continue;
        const list = members.get(clip.linkGroupId);
        if (list) list.push({ track, clip }); else members.set(clip.linkGroupId, [{ track, clip }]);
      }
  const alone = [...members.values()].filter((list) => list.length === 1).map((list) => list[0]!);
  const locked = alone.find((m) => m.track.locked);
  if (locked) throw new OpError('track_locked', `clip ${locked.clip.id} on locked track ${locked.track.id} is linked to a clip this edit removes or divides, and would be left linked to nothing`, { trackId: locked.track.id, clipId: locked.clip.id }, 'Unlock that track first, so its clip can be unlinked.');
  for (const m of alone) m.clip.linkGroupId = null;
  return alone.map((m) => m.clip.id);
}
/** After a clip gets shorter, keep its audio fades inside it (fade-in first, then whatever room is left for the fade-out). */
function clampFades(clip: Clip) {
  if (clip.type !== 'media' || (!clip.fadeIn && !clip.fadeOut)) return;
  const fin = T.min(clip.fadeIn ?? T.ZERO, clip.duration);
  const fout = T.min(clip.fadeOut ?? T.ZERO, T.sub(clip.duration, fin));
  if (T.isZero(fin)) delete clip.fadeIn; else clip.fadeIn = fin;
  if (T.isZero(fout)) delete clip.fadeOut; else clip.fadeOut = fout;
}
/**
 * After a title is divided or cut shorter, keep its text animation on the outer edges, like the fades of a sound: the entrance
 * belongs to the first part and the exit to the last (`keep` says which of the two this part still owns); a loop plays on in
 * every part. What is kept must fit the part, as set_text_animation requires: the entrance first, then whatever room is left
 * for the exit. A part with nothing left animating loses the field.
 */
function fitTextAnimation(clip: Clip, rate: T.Rate, keep: { in: boolean; out: boolean }) {
  if (clip.type !== 'text' || !clip.animation) return;
  const total = T.frameIndexAt(clip.duration, rate);
  const next = { ...clip.animation };
  if (!keep.in) next.in = null;
  if (!keep.out) next.out = null;
  if (next.in) { if (total < 1) next.in = null; else next.inFrames = Math.min(next.inFrames, total); }
  const room = total - (next.in ? next.inFrames : 0);
  if (next.out) { if (room < 1) next.out = null; else next.outFrames = Math.min(next.outFrames, room); }
  if (!next.in && !next.out && !next.loop) delete clip.animation; else clip.animation = next;
}
const fmt = (t: T.RationalTime) => `${T.toSeconds(t).toFixed(3)}s`;

// ---------- operations ----------
/**
 * Wave-1 limit of the sound effects (ADR-0010 D7): a sound that keeps its pitch at a speed other than 1, or that changes speed
 * gradually, cannot carry enabled sound effects yet (validation code audio_fx_time_map is the backstop). Checked on the clip
 * as the edit leaves it, so every operation that could reach that state says why, with a way out, instead of the generic
 * invalid_result. `editing` says which side of the edit is new: the effects, or the speed and pitch of a sound that has them.
 */
function refuseFxTimeMap(clip: MediaClip, editing: 'effects' | 'speed') {
  if (!clip.audioFx?.some((f) => f.enabled) || !(clip.speedEnd || (clip.keepPitch && speedValue(clip) !== 1))) return;
  if (editing === 'effects') throw new OpError('incompatible', 'this sound keeps its pitch at another speed or changes speed gradually, so it cannot carry sound effects yet', { clipId: clip.id }, 'Give it one speed and let its pitch follow the speed (set_clip_speed, set_clip_pitch keepPitch=false), then add the sound effect.');
  throw new OpError('incompatible', 'this sound has sound effects, which cannot follow a gradual change of speed or a stretch that keeps the pitch yet', { clipId: clip.id }, 'Remove its sound effects first (apply_audio_preset with presetId null) or turn them off (update_audio_effect enabled=false), make the change, then add them again.');
}
/** Refuse an edit that a clip with a continuous speed ramp cannot take (see speed.ts isRamped). */
const refuseRamped = (clip: Clip, action: string) => {
  if (isRamped(clip)) throw new OpError('incompatible', `this clip changes speed gradually over its length, so it cannot be ${action}`, { clipId: clip.id }, 'Give it one speed first (set_clip_speed), make the edit, then apply the gradual change again.');
};
// ---------- adjustment clips (ADR-0016): what they cannot take, said plainly ----------
const ADJUSTMENT_HINT = 'Make this edit on the clips below the adjustment. An adjustment takes effects, a mask, a blend mode and opacity.';
/**
 * An adjustment clip has no source and no picture of its own: it acts on what is drawn below it. Edits that need a source
 * or a picture of the clip's own (speed, reverse, slip, freeze, link, scenes, transitions, layouts) refuse it in these words
 * instead of a generic refusal.
 */
function refuseAdjustment(clip: Clip, action: string, hint = ADJUSTMENT_HINT) {
  if (clip.type === 'adjustment') throw new OpError('incompatible', `an adjustment clip has no source or picture of its own, so it cannot be ${action}`, { clipId: clip.id }, hint);
}
/** The effect types an adjustment clip refuses (validate.ts adjustmentRefusal), in the words add_adjustment uses. */
function refuseAdjustmentEffect(clip: Clip, type: string) {
  if (clip.type !== 'adjustment') return;
  const why = adjustmentRefusal(type);
  if (why) throw new OpError('incompatible', `${type} cannot go on an adjustment: ${why}`, { clipId: clip.id, type }, 'Put it on the clip itself.');
}
const ADJUSTMENT_FIXED = ['x', 'y', 'scale', 'rotation'] as const;
/**
 * An adjustment clip's transform is the identity apart from its opacity (its box is the whole frame). A position, size or
 * turn other than the identity is refused here, with a way to limit the look to part of the frame.
 */
export function refuseAdjustmentTransform(clip: Clip, transform: Partial<Record<(typeof ADJUSTMENT_FIXED)[number], number>> | null | undefined, verb: 'set' | 'animated') {
  if (clip.type !== 'adjustment' || !transform) return;
  const moved = ADJUSTMENT_FIXED.filter((p) => transform[p] !== undefined && transform[p] !== DEFAULT_TRANSFORM[p]);
  if (moved.length) throw new OpError('incompatible', `only the opacity of an adjustment clip can be ${verb}: it has no picture of its own to move, scale or turn`, { clipId: clip.id, properties: moved }, 'Set opacity only. To limit the look to part of the frame, give the adjustment a mask (set_clip_mask).');
}
/** A motion on an adjustment clip may change its opacity and nothing else. */
function refuseAdjustmentMotion(clip: Clip, name: string, properties: readonly string[]) {
  if (clip.type !== 'adjustment') return;
  const others = properties.filter((p) => p !== 'opacity');
  if (others.length) throw new OpError('incompatible', `an adjustment clip can only change its opacity; ${name} also changes ${others.join(', ')}`, { clipId: clip.id, properties: others }, 'Use a fade (motion.in.fade, motion.out.fade, animate_clip fade) or an opacity loop (motion.loop.fade-pulse).');
}
/**
 * Make `part` the piece of `whole` that starts `fromOffset` into it and is `length` long: its source start and, for a
 * ramped clip, its place in the ramp (so the piece shows exactly what the whole showed there). `part` may be `whole`
 * itself or a copy of it. Call before changing the length of `whole`.
 */
const setPart = (part: MediaClip, whole: MediaClip, fromOffset: T.RationalTime, length: T.RationalTime) => {
  const sourceIn = sourceInOfPart(whole, fromOffset, length), window = rampWindowOfPart(whole, fromOffset);
  part.sourceIn = sourceIn;
  if (window) part.rampWindow = window;
};
defineOp({
  name: 'rename_project',
  version: 1,
  description: 'Rename the project.',
  args: z.object({ name: z.string().min(1).max(200) }).strict(),
  apply(d, a) {
    d.name = a.name;
    return { affectedIds: [d.id], summary: `Renamed project to "${a.name}"` };
  },
});

defineOp({
  name: 'import_asset',
  version: 1,
  internal: true,
  description: 'Attach a probed, content-addressed source asset produced by the trusted ingest job.',
  args: z.object({ asset: AssetSchema.omit({ id: true }) }).strict(),
  apply(d, a, ctx) {
    const existing = Object.values(d.assets).find((x) => x.contentHash === a.asset.contentHash);
    if (existing) return { affectedIds: [], summary: `Asset already present as ${existing.id}`, output: { assetId: existing.id, deduplicated: true } };
    const id = ctx.newId('ast');
    d.assets[id] = { id, ...a.asset };
    return { affectedIds: [id], summary: `Imported ${a.asset.kind} "${a.asset.name}"`, output: { assetId: id, deduplicated: false } };
  },
});

defineOp({
  name: 'set_project_format',
  version: 1,
  description: 'Change the master frame of the project: its size (even numbers; clips keep their relative position and scale, so the layout follows), the background colour, and whether pictures fill the frame (cover) or fit inside it (contain). Linked formats keep their own size. The frame rate cannot be changed after material is on the timeline.',
  args: z.object({ width: z.number().int().min(16).max(8192).optional(), height: z.number().int().min(16).max(8192).optional(), background: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), fit: z.enum(['contain', 'cover']).optional() }).strict(),
  apply(d, a) {
    if (a.width === undefined && a.height === undefined && a.background === undefined && a.fit === undefined) throw new OpError('invalid_args', 'nothing to change: give width, height, background or fit');
    const width = a.width ?? d.settings.width, height = a.height ?? d.settings.height;
    if (width % 2 || height % 2) throw new OpError('invalid_args', 'width and height must be even (video encoders require it)', { width, height });
    d.settings.width = width; d.settings.height = height;
    if (a.background !== undefined) d.settings.background = a.background;
    if (a.fit !== undefined) { if (a.fit === 'contain') delete d.settings.fit; else d.settings.fit = a.fit; }
    return { affectedIds: [d.id], summary: `Project frame ${width}×${height}, background ${d.settings.background}, ${d.settings.fit ?? 'contain'}` };
  },
});
defineOp({
  name: 'rename_asset',
  version: 1,
  description: 'Change the name a library file is shown by. The stored file is not touched.',
  args: z.object({ assetId: z.string(), name: z.string().min(1).max(255) }).strict(),
  apply(d, a) {
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    asset.name = a.name;
    return { affectedIds: [asset.id], summary: `Renamed library file to "${a.name.slice(0, 60)}"` };
  },
});
defineOp({
  name: 'set_asset_colour',
  version: 1,
  description: 'For a video file that does not say how its colours are encoded (the library shows a note): choose how to read them. bt601 = standard-definition material (the reading most other players use for it); auto = as the browser reads it (BT.709). The choice applies to every clip of the file, in preview, stills and export.',
  args: z.object({ assetId: z.string(), readAs: z.enum(['auto', 'bt601']) }).strict(),
  apply(d, a) {
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    if (!asset.video?.untaggedColour || asset.conform) throw new OpError('incompatible', 'this file states how its colours are encoded (or was converted at import), so there is nothing to choose', { assetId: asset.id });
    if (a.readAs === 'bt601') asset.video.readColourAs = 'bt601'; else delete asset.video.readColourAs;
    return { affectedIds: [asset.id], summary: `Colours of "${asset.name.slice(0, 40)}" read as ${a.readAs === 'bt601' ? 'BT.601' : 'the browser reads them (BT.709)'}` };
  },
});
defineOp({
  name: 'remove_asset',
  version: 1,
  description: 'Remove a file from the project library, together with its transcript, analysis results, motion tracks and marked ranges (pearls); it also leaves the event it was in (an event left without files is removed), and a copy made from it that took its capture date from it keeps that date. Refused while any clip uses it, while a colour table (LUT) effect on any clip refers to it, or while a clip follows one of its motion tracks (or hides a region with one), or while a multicam group has it as a file of an angle. The stored media file itself stays on disk until the owner cleans up storage, so undo brings the library entry back.',
  args: z.object({ assetId: z.string() }).strict(),
  apply(d, a) {
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    const users = Object.values(d.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'media' && c.assetId === asset.id).map((c) => c.id);
    if (users.length) throw new OpError('incompatible', `${users.length} clip(s) on the timeline still use this file`, { assetId: asset.id, clipIds: users.slice(0, 50) }, 'Delete those clips first.');
    const graded = lutUsers(d, asset.id);
    if (graded.length) throw new OpError('incompatible', `${graded.length} clip(s) still use this colour table in a colour table (LUT) effect`, { assetId: asset.id, clipIds: graded.slice(0, 50) }, 'Remove that effect from those clips, or choose another table for it, first.');
    // multicam (ADR-0020): a file of a group's angle stays while the group names it
    const groups = groupsUsingAsset(d, asset.id);
    if (groups.length) throw mcRefusal('assetInGroup', { assetId: asset.id, groupIds: groups }, groups.length);
    // motion tracks of the file (ADR-0015) go with it, unless a clip still follows one or hides a region with one
    const tracks = Object.values(d.motionTracks ?? {}).filter((t) => t.assetId === asset.id).map((t) => t.id);
    const bound = motionTrackUsers(d, new Set(tracks));
    const boundIds = [...new Set([...bound.follow, ...bound.redact])];
    if (boundIds.length) throw new OpError('incompatible', `${boundIds.length} clip(s) still follow a motion track of this file or hide a region with one`, { assetId: asset.id, clipIds: boundIds.slice(0, 50), motionTrackIds: tracks.slice(0, 64) }, 'Detach those clips first (set_clip_follow follow=null, set_redact_region region=null), or delete the motion track with remove_motion_track unbind=true.');
    const affected = [asset.id];
    for (const id of tracks) { delete d.motionTracks[id]; affected.push(id); }
    if (d.transcripts?.[asset.id]) { delete d.transcripts[asset.id]; affected.push(transcriptEntityId(asset.id)); }
    if (d.analyses?.[asset.id]) { delete d.analyses[asset.id]; affected.push(analysisEntityId(asset.id)); }
    // life line (ADR-0021): a copy that took its capture date from this file keeps it, and the file leaves its event
    affected.push(...handDownCapture(d, asset.id), ...detachAssetFromEvents(d, asset.id));
    // marked ranges (wave 7 pearls) of the file go with it, for every credential; undo brings them back (entity 'sourceRange')
    affected.push(...detachRangesOfAsset(d, asset.id));
    delete d.assets[asset.id];
    return { affectedIds: [...new Set(affected)], summary: `Removed "${asset.name.slice(0, 60)}" from the library` };
  },
});

defineOp({
  name: 'add_track',
  version: 1,
  description: 'Add an empty track. Picture tracks stack bottom-to-top in list order; audio tracks mix. An adjustment track (default names FX1, FX2…) holds adjustment clips (add_adjustment); a new one goes above the picture tracks and below the title tracks.',
  args: z.object({ sequenceId: z.string().optional(), kind: z.enum(['video', 'audio', 'text', 'adjustment']), name: z.string().max(128).optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    const t = newTrack(seq, a.kind, ctx, a.name);
    return { affectedIds: [t.id], summary: `Added ${a.kind} track ${t.name}`, output: { trackId: t.id } };
  },
});

defineOp({
  name: 'update_track',
  version: 1,
  description: 'Change a track: rename it, lock it (its clips cannot be changed, and edits that would move time on every track are refused until it is unlocked), hide it (picture, title and caption tracks: not drawn in preview, stills or export), or mute it (sound tracks: not heard). Works on a locked track, so it can be unlocked.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), name: z.string().min(1).max(128).optional(), locked: z.boolean().optional(), hidden: z.boolean().optional(), muted: z.boolean().optional() }).strict(),
  apply(d, a) {
    const seq = seqOf(d, a.sequenceId);
    const t = seq.tracks.find((x) => x.id === a.trackId);
    if (!t) throw new OpError('not_found', `track ${a.trackId} not found`, { trackId: a.trackId });
    if (a.name === undefined && a.locked === undefined && a.hidden === undefined && a.muted === undefined) throw new OpError('invalid_args', 'nothing to change: give name, locked, hidden or muted');
    if (a.hidden !== undefined && t.kind === 'audio') throw new OpError('incompatible', 'a sound track is muted, not hidden', { trackId: t.id }, 'Use muted.');
    if (a.muted !== undefined && t.kind !== 'audio') throw new OpError('incompatible', 'only sound tracks can be muted; hide a picture, title or caption track instead', { trackId: t.id }, 'Use hidden.');
    if (a.name !== undefined) t.name = a.name;
    if (a.locked !== undefined) t.locked = a.locked;
    if (a.hidden !== undefined) t.hidden = a.hidden;
    if (a.muted !== undefined) t.muted = a.muted;
    const flags = [t.locked ? 'locked' : null, t.hidden ? 'hidden' : null, t.muted ? 'muted' : null].filter(Boolean).join(', ');
    return { affectedIds: [t.id], summary: `Track ${t.name}${flags ? `: ${flags}` : ': unlocked, shown'}` };
  },
});
defineOp({
  name: 'move_track',
  version: 1,
  description: 'Change where a track sits in the list. Picture and title tracks are drawn in list order, later ones on top, so this changes what covers what; for sound tracks it only changes the order shown. toIndex counts from 0 in the current list (see get_timeline).',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), toIndex: z.number().int().min(0).max(999) }).strict(),
  apply(d, a) {
    const seq = seqOf(d, a.sequenceId);
    const from = seq.tracks.findIndex((x) => x.id === a.trackId);
    if (from < 0) throw new OpError('not_found', `track ${a.trackId} not found`, { trackId: a.trackId });
    const to = Math.min(a.toIndex, seq.tracks.length - 1);
    if (to === from) throw new OpError('invalid_args', 'the track is already there', { trackId: a.trackId, index: from });
    const [t] = seq.tracks.splice(from, 1);
    seq.tracks.splice(to, 0, t!);
    return { affectedIds: [trackOrderEntityId(seq.id)], summary: `Moved track ${t!.name} to position ${to + 1}`, output: { index: to } };
  },
});
defineOp({
  name: 'remove_track',
  version: 1,
  description: 'Remove an empty, unlocked track that nothing else refers to (not the speech source of a ducking setting, not the track a caption track follows). Delete or move its clips first.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string() }).strict(),
  apply(d, a) {
    const seq = seqOf(d, a.sequenceId);
    const t = mustTrack(seq, a.trackId);
    if (t.clips.length) throw new OpError('incompatible', `track ${t.name} still has ${t.clips.length} clip(s)`, { trackId: t.id, clips: t.clips.length }, 'Delete or move its clips first.');
    const user = seq.tracks.find((x) => x.id !== t.id && (x.audio?.duck?.sourceTrackIds.includes(t.id) || x.caption?.linkedTrackId === t.id));
    if (user) throw new OpError('incompatible', `track ${user.name} refers to this track`, { trackId: t.id, usedBy: user.id }, 'Change that setting first.');
    seq.tracks.splice(seq.tracks.indexOf(t), 1);
    return { affectedIds: [t.id], summary: `Removed track ${t.name}` };
  },
});

defineOp({
  name: 'add_clip',
  version: 1,
  description:
    'Place a source asset on the timeline. A video asset with sound also gets a linked audio clip. Omit trackId to auto-place on the first free compatible track. audioTrackId chooses the sound track of that linked clip. start and duration must be frame-aligned; duration defaults to the rest of the source.',
  args: z
    .object({
      sequenceId: z.string().optional(),
      assetId: z.string(),
      trackId: z.string().optional(),
      start: RT,
      sourceIn: RT.optional(),
      duration: RT.optional(),
      withLinkedAudio: z.boolean().optional().describe('Default true'),
      audioTrackId: z.string().optional().describe('Sound track for the linked sound of a picture asset (default: the first free one). For a sound-only asset use trackId.'),
    })
    .strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId }, 'Call get_summary to list assets.');
    if (asset.kind === 'lut') throw new OpError('incompatible', 'a colour table (LUT) is not placed on the timeline; it is applied to a clip as an effect', { assetId: asset.id }, 'Use apply_lut with a clipId, or add the effect color.lut with this id as its lut parameter.');
    const rate = d.settings.frameRate;
    const sourceIn = a.sourceIn ?? T.ZERO;
    if (asset.kind !== 'image' && (T.isNegative(sourceIn) || !T.lt(sourceIn, asset.duration))) throw new OpError('out_of_bounds', 'sourceIn is outside the asset', { sourceIn, assetDuration: asset.duration });
    const available = T.sub(asset.duration, sourceIn);
    // Default: the longest frame-aligned duration that stays inside the source.
    const duration = a.duration ?? (asset.kind === 'image' ? T.rt(5, 1) : T.frameTime(T.frameCount(available, rate), rate));
    assertAligned(d, a.start, 'start');
    assertAligned(d, duration, 'duration');
    if (!T.lt(T.ZERO, duration)) throw new OpError('invalid_args', 'duration must be positive', { duration });
    if (asset.kind !== 'image' && T.lt(available, duration)) throw new OpError('out_of_bounds', 'clip would read past the end of the source', { available, requested: duration }, 'Shorten duration or lower sourceIn.');
    if (T.isNegative(a.start)) throw new OpError('out_of_bounds', 'start must be >= 0', { start: a.start });
    const end = T.add(a.start, duration);
    const hasPicture = !!asset.video || (asset.kind === 'image' && !!asset.image);
    const wantAudio = !!asset.audio && (a.withLinkedAudio ?? true);
    const ids: string[] = [];
    const linkGroupId = hasPicture && wantAudio ? ctx.newId('lnk') : null;
    const make = (): MediaClip => ({ id: ctx.newId('clp'), type: 'media', assetId: asset.id, start: a.start, duration, sourceIn, gain: 1, linkGroupId, transform: { ...DEFAULT_TRANSFORM } });
    const out: Record<string, unknown> = {};
    const explicit = a.trackId ? mustTrack(seq, a.trackId) : undefined;
    if (hasPicture) {
      const track = explicit && explicit.kind === 'video' ? explicit : placeTrack(seq, 'video', a.start, end, ctx);
      if (explicit && explicit.kind !== 'video') throw new OpError('incompatible', `asset with picture cannot go on ${explicit.kind} track`, { trackId: explicit.id });
      assertFree(track, a.start, end);
      const c = make();
      track.clips.push(c);
      sortClips(track);
      ids.push(c.id);
      out.clipId = c.id;
      out.trackId = track.id;
    }
    if (wantAudio || !hasPicture) {
      if (!asset.audio) throw new OpError('incompatible', 'asset has neither picture nor audio', { assetId: asset.id });
      const explicitAudio = a.audioTrackId ? mustTrack(seq, a.audioTrackId) : undefined;
      const track = !hasPicture && explicit ? explicit : explicitAudio ?? placeTrack(seq, 'audio', a.start, end, ctx);
      if (track.kind !== 'audio') throw new OpError('incompatible', `audio asset cannot go on ${track.kind} track`, { trackId: track.id });
      const c = make();
      track.clips.push(c);
      sortClips(track);
      ids.push(c.id);
      if (hasPicture) out.audioClipId = c.id;
      else { out.clipId = c.id; out.trackId = track.id; }
    }
    return { affectedIds: ids, summary: `Added "${asset.name}" at ${fmt(a.start)} for ${fmt(duration)}`, output: out };
  },
});

defineOp({
  name: 'add_text',
  version: 1,
  description: 'Add a text layer. Text is shaped with bidi support; Hebrew defaults to right-to-left. Position is the layer centre relative to frame centre (x,y fractions). A finished title in one step: presetId gives it a named text style exactly as apply_text_preset does (the explicit style is then set on top of it, as update_text would), animation animates it exactly as set_text_animation does, and fields: true turns its live fields on exactly as set_text_fields does (the text then holds fields such as {hebrewDate}, and plain braces are written doubled). Each of the three refuses as its own operation does, and then nothing is added.',
  args: z
    .object({
      sequenceId: z.string().optional(), trackId: z.string().optional(), text: z.string().min(1).max(2000), start: RT, duration: RT, style: TextStyleSchema.partial().optional(), transform: TransformSchema.partial().optional(),
      // ADR-0022: optional on a v1 operation, so logs written before it replay unchanged
      presetId: z.string().optional().describe('A text style of list_catalog → textPresets, applied before `style`'),
      animation: TextAnimationSchema.partial().optional().describe('As set_text_animation'),
      fields: z.literal(true).optional().describe('Live fields on, as set_text_fields enabled: true'),
    })
    .strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.start, 'start');
    assertAligned(d, a.duration, 'duration');
    if (!T.lt(T.ZERO, a.duration) || T.isNegative(a.start)) throw new OpError('invalid_args', 'start must be >= 0 and duration > 0');
    const end = T.add(a.start, a.duration);
    const track = a.trackId ? mustTrack(seq, a.trackId) : placeTrack(seq, 'text', a.start, end, ctx);
    if (track.kind !== 'text') throw new OpError('incompatible', `text cannot go on ${track.kind} track`, { trackId: track.id });
    assertFree(track, a.start, end);
    const clip: Extract<Clip, { type: 'text' }> = { id: ctx.newId('clp'), type: 'text', text: a.text, start: a.start, duration: a.duration, style: normaliseTextStyle({ ...DEFAULT_TEXT_STYLE, ...a.style }), transform: { ...DEFAULT_TRANSFORM, ...a.transform } };
    track.clips.push(clip);
    sortClips(track);
    // A finished title in one step (ADR-0022). Each part runs the body of the operation it stands for, so the result is what
    // add_text, apply_text_preset, update_text (style), set_text_animation and set_text_fields would leave, and a refusal of
    // any of them refuses the whole add.
    if (a.presetId !== undefined) {
      applyTextPreset(clip, a.presetId, ctx);
      if (a.style) clip.style = normaliseTextStyle({ ...clip.style, ...a.style });
    }
    if (a.animation !== undefined) sameOp('set_text_animation').apply(d, { clipId: clip.id, animation: a.animation }, ctx);
    if (a.fields) sameOp('set_text_fields').apply(d, { clipId: clip.id, enabled: true }, ctx);
    return { affectedIds: [clip.id], summary: `Added text "${a.text.slice(0, 40)}" at ${fmt(a.start)}`, output: { clipId: clip.id, trackId: track.id } };
  },
});

/** The registered operation `name`, for an operation that includes another's body (looked up when it runs, so the order of the files does not matter). */
function sameOp(name: string): OpDefinition {
  const def = registry.get(name);
  if (!def) throw new OpError('unknown_op', `operation ${name} is not registered in this build`, { op: name });
  return def;
}
/** apply_text_preset's body (also the presetId of add_text). */
function applyTextPreset(clip: Extract<Clip, { type: 'text' }>, presetId: string, ctx: OpContext): void {
  const preset = findTextPreset(presetId);
  if (!preset) throw new OpError('not_found', `text style "${presetId}" does not exist`, { presetId }, 'Call list_catalog for the text styles.');
  // The preset owns the look fields (ADR-0012): a look from an earlier preset or edit is cleared, then the preset's own are set.
  const base: Record<string, unknown> = { ...clip.style };
  for (const k of TEXT_LOOK_FIELDS) delete base[k];
  clip.style = normaliseTextStyle({ ...(base as typeof clip.style), ...preset.style });
  // The preset owns the clip's drop shadow: replaced, added or removed. Other effects are left alone.
  const others = (clip.effects ?? []).filter((e) => e.type !== 'stylize.shadow');
  const list = preset.shadow ? [...others, { id: ctx.newId('fx'), type: 'stylize.shadow', enabled: true, params: parseEffect('stylize.shadow', preset.shadow) }] : others;
  if (list.length) clip.effects = list; else delete clip.effects;
}
defineOp({
  name: 'apply_text_preset',
  version: 1,
  description: 'Give a text clip one of the named text styles (see list_catalog → textPresets): font, weight, size, colours, box, outline, an optional shadow or glow, and the look fields it lists (gradient, tracking, second outline, glow, extrude, long shadow; the ones it does not list are cleared). The text itself, its position, alignment and direction are kept, and every value stays editable (update_text, update_effect).',
  args: z.object({ clipId: z.string(), presetId: z.string() }).strict(),
  apply(d, a, ctx) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'text') throw new OpError('incompatible', `clip ${a.clipId} is not a text clip`, { clipId: a.clipId });
    applyTextPreset(clip, a.presetId, ctx);
    return { affectedIds: [clip.id], summary: `Applied text style ${a.presetId}`, output: { style: clip.style } };
  },
});

defineOp({
  name: 'update_text',
  version: 1,
  description: 'Change the content and/or style of a text clip. Unspecified fields are kept. A look field (gradient, tracking, stroke2, glow, extrude, longShadow) set to null is removed.',
  args: z.object({ clipId: z.string(), text: z.string().min(1).max(2000).optional(), style: TextStyleSchema.partial().optional() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'text') throw new OpError('incompatible', `clip ${a.clipId} is not a text clip`, { clipId: a.clipId });
    if (a.text !== undefined) clip.text = a.text;
    if (a.style) clip.style = normaliseTextStyle({ ...clip.style, ...a.style });
    return { affectedIds: [clip.id], summary: `Updated text "${clip.text.slice(0, 40)}"` };
  },
});

defineOp({
  name: 'set_text_animation',
  version: 1,
  description: 'Animate the letters, words or lines of a title one after another: an entrance (fade, typewriter, rise, drop, pop, slide, zoom), an exit (fade, sink, lift, shrink, slide) and/or a movement that repeats while it is shown (wave, bounce, pulse, jitter). Unspecified fields keep their value; animation=null removes it. Units follow reading order, so Hebrew starts from the right. This is separate from keyframes and motions, which move the whole title. When nothing is animating (after the entrance, before the exit, no loop) the title is drawn exactly as a title without animation.',
  args: z.object({ clipId: z.string(), animation: TextAnimationSchema.partial().nullable() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'text') throw new OpError('incompatible', `clip ${a.clipId} is not a text clip`, { clipId: a.clipId }, 'Captions animate through their caption style; picture clips through motions.');
    if (a.animation === null) { delete clip.animation; return { affectedIds: [clip.id], summary: 'Removed text animation' }; }
    const next = { ...(clip.animation ?? DEFAULT_TEXT_ANIMATION), ...a.animation };
    if (!next.in && !next.out && !next.loop) { delete clip.animation; return { affectedIds: [clip.id], summary: 'Removed text animation' }; }
    const total = T.frameIndexAt(clip.duration, d.settings.frameRate);
    if ((next.in ? next.inFrames : 0) + (next.out ? next.outFrames : 0) > total) throw new OpError('out_of_bounds', `entrance (${next.in ? next.inFrames : 0}) plus exit (${next.out ? next.outFrames : 0}) frames exceed the clip length (${total} frames)`, { clipFrames: total }, 'Use fewer frames or a longer title.');
    clip.animation = next;
    return { affectedIds: [clip.id], summary: `Text animation by ${next.by}${next.in ? `, in: ${next.in}` : ''}${next.out ? `, out: ${next.out}` : ''}${next.loop ? `, loop: ${next.loop}` : ''}`, output: { animation: next } };
  },
});

defineOp({
  name: 'set_clip_transform',
  version: 1,
  description: 'Set position/scale/rotation/opacity of a picture or text clip. Unspecified fields are kept. An adjustment clip has only its opacity (position, size and rotation stay at the identity).',
  args: z.object({ clipId: z.string(), transform: TransformSchema.partial() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    refuseAdjustmentTransform(clip, a.transform, 'set');
    clip.transform = { ...clip.transform, ...a.transform };
    return { affectedIds: [clip.id], summary: `Transformed clip ${clip.id}` };
  },
});

const KfTarget = { clipId: z.string(), property: z.enum(ANIMATABLE), time: RT.describe('Offset from the clip start (frame-aligned). Use the playhead minus the clip start.') };
defineOp({
  name: 'set_keyframe',
  version: 1,
  description: 'Add or replace a keyframe for x, y, scale, rotation or opacity at a clip-local time. The first keyframe on a property starts animating it; between keys the value is interpolated with the easing (curve) of the earlier key: one of list_catalog → curves, or \'bezier\' with four handles. Left out, an existing key keeps its curve. A new key inside a segment with a curve other than linear, hold, ease-in, ease-out or ease-in-out is placed so that the curve keeps its shape (output.split: exact or approximate). Curves that turn back (overshoot, anticipate, bounce, spring, a custom curve with y outside 0..1) are refused on opacity. An adjustment clip animates its opacity only.',
  args: z.object({ ...KfTarget, value: z.number(), easing: z.enum(EASINGS).optional().describe('Default linear; left out, an existing key keeps its curve'), bezier: CurveHandlesSchema.optional().describe("The four handles [x1, y1, x2, y2] of a custom curve, only with easing 'bezier' (list_catalog → curves)") }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (a.property !== 'opacity') refuseAdjustmentTransform(clip, { [a.property]: NaN }, 'animated'); // any key on these properties, whatever its value
    assertAligned(d, a.time, 'time');
    if (!TransformSchema.shape[a.property].safeParse(a.value).success) throw new OpError('invalid_args', `value ${a.value} is out of range for ${a.property}`, { property: a.property });
    const ch = { property: a.property };
    const { keys, split } = writeKey(clip.keyframes?.[a.property] ?? [], a.time, a.value, a.easing, a.bezier, { rate: d.settings.frameRate, range: TRANSFORM_RANGE[a.property], light: isLightChannel(clip, ch), channel: channelWords(ch), max: MAX_TRANSFORM_KEYS, details: { clipId: clip.id, property: a.property } });
    clip.keyframes = { ...clip.keyframes, [a.property]: keys };
    return { affectedIds: [clip.id], summary: `Keyframe ${a.property}=${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length, split } };
  },
});
defineOp({
  name: 'delete_keyframe',
  version: 1,
  description: 'Remove the keyframe at exactly this clip-local time. Removing the last key of a property freezes the property at the value it had there.',
  args: z.object(KfTarget).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    const keys = clip.keyframes?.[a.property] ?? [];
    const i = keys.findIndex((k) => T.eq(k.time, a.time));
    if (i < 0) throw new OpError('not_found', `no ${a.property} keyframe at that time`, { clipId: clip.id, times: keys.map((k) => k.time) }, 'Use one of the listed times.');
    const rest = keys.filter((_, j) => j !== i);
    const kf = { ...clip.keyframes };
    if (rest.length) kf[a.property] = rest;
    else { delete kf[a.property]; clip.transform = { ...clip.transform, [a.property]: keys[i]!.value }; }
    clip.keyframes = Object.keys(kf).length ? kf : undefined;
    if (!clip.keyframes) delete clip.keyframes;
    return { affectedIds: [clip.id], summary: `Removed ${a.property} keyframe at +${fmt(a.time)}`, output: { keyframeCount: rest.length } };
  },
});
defineOp({
  name: 'clear_keyframes',
  version: 1,
  description: 'Remove all keyframes of one property (or of every property) from a clip. Each cleared property keeps the value it has at `at` (clip-local, default the clip start).',
  args: z.object({ clipId: z.string(), property: z.enum(ANIMATABLE).optional(), at: RT.optional() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (!clip.keyframes) return { affectedIds: [], summary: 'No keyframes to clear' };
    const kf = { ...clip.keyframes };
    for (const p of a.property ? [a.property] : ANIMATABLE) {
      const keys = kf[p];
      if (!keys?.length) continue;
      clip.transform = { ...clip.transform, [p]: sampleKeyframes(keys, a.at ?? T.ZERO, TRANSFORM_RANGE[p]) };
      delete kf[p];
    }
    if (Object.keys(kf).length) clip.keyframes = kf;
    else delete clip.keyframes;
    return { affectedIds: [clip.id], summary: `Cleared ${a.property ?? 'all'} keyframes` };
  },
});

defineOp({
  name: 'set_clip_speed',
  version: 1,
  description: 'Play a clip faster or slower (0.1–8; 0.5 = half speed / slow motion, 2 = double speed). The clip keeps showing the same stretch of source, so its length on the timeline changes (rounded down to a whole frame); nothing else moves. Linked picture and sound change together. A clip that changed speed gradually (set_clip_speed_ramp) gets this one speed instead. Sound is resampled with the picture, so its pitch rises and falls with the speed.',
  args: z.object({ clipId: z.string(), speed: z.number().min(0.1).max(8), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given a speed');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only media clips have a speed', { clipId: a.clipId });
    if (f.clip.freeze) throw new OpError('incompatible', 'a freeze frame has no speed', { clipId: a.clipId }, 'Trim it to change how long the picture is held.');
    const rate = d.settings.frameRate;
    const speed = speedFromNumber(a.speed);
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      const span = toSourceSpan(clip, clip.duration); // source shown now; stays the same
      delete clip.speedEnd; delete clip.rampWindow; delete clip.speedCurve; // one speed from here on: a gradual change, if there was one, ends
      if (speed.num === speed.den) delete clip.speed; else clip.speed = speed;
      refuseFxTimeMap(clip, 'speed'); // a sound that keeps its pitch and carries sound effects stays at speed 1 (wave 1)
      const frames = Math.max(1, T.frameIndexAt(toTimelineSpan(clip, span), rate));
      const duration = T.frameTime(frames, rate);
      assertFree(track, clip.start, T.add(clip.start, duration), new Set([clip.id]));
      clip.duration = duration;
      clampFades(clip);
      if (clip.transition && clip.transition.frames > frames) clip.transition = { ...clip.transition, frames };
    }
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Speed ${a.speed}×`, output: { speed, durationFrames: T.frameIndexAt((targets[0]!.clip).duration, rate) } };
  },
});

defineOp({
  name: 'set_clip_speed_ramp',
  version: 1,
  description: 'Change a clip\'s speed gradually and continuously over its length, from `from` at its start to `to` at its end (each 0.1–8), for example 1 → 0.25 to ease into slow motion. The clip stays one clip and keeps showing the same stretch of source (its new length is that stretch divided by the average of the two speeds, rounded down to a whole frame; nothing else moves). Linked picture and sound change together; the sound\'s pitch glides with the speed. A ramped clip can be trimmed and cut like any other (each part keeps its place in the ramp and shows what the whole clip showed there). It cannot be slipped, reversed, frozen, given a transition or crossfade, set to keep its pitch, or carry sound effects: give it one speed first (set_clip_speed). `speed_ramp` is the older stepped variant, which divides the clip into steps of constant speed.',
  args: z.object({ clipId: z.string(), from: z.number().min(0.1).max(8), to: z.number().min(0.1).max(8), curve: z.enum(['even', 'smooth']).optional().describe('even (default) = the speed changes at a steady pace; smooth = it eases out of the first speed and into the last'), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given a speed');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file have a speed', { clipId: a.clipId });
    const rate = d.settings.frameRate;
    const v0 = speedFromNumber(a.from), v1 = speedFromNumber(a.to);
    if (v0.num * v1.den === v1.num * v0.den) throw new OpError('invalid_args', 'from and to are the same speed', {}, 'Use set_clip_speed for one speed.');
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      if (clip.freeze || clip.reverse) throw new OpError('incompatible', 'a freeze frame or a clip that plays backwards cannot change speed gradually', { clipId: clip.id });
      if (clip.keepPitch) throw new OpError('incompatible', 'this sound is set to keep its pitch, which works at one speed only', { clipId: clip.id }, 'Turn that off first (set_clip_pitch keepPitch=false).');
      refuseFxTimeMap({ ...clip, speedEnd: v1 }, 'speed');
      const i = track.clips.indexOf(clip), next = track.clips[i + 1];
      if (clip.transition || (next && next.type === 'media' && next.transition && T.eq(next.start, clipEnd(clip)))) throw new OpError('incompatible', 'remove the transition at this clip first', { clipId: clip.id });
      const span = toSourceSpan(clip, clip.duration); // source shown now (whatever its speed was); the ramp shows at most this
      // length = span ÷ average speed, down to a whole frame: (v0 + v1)/2 = (n0·d1 + n1·d0)/(2·d0·d1)
      const length = T.normalize({ value: (BigInt(span.value) * BigInt(2 * v0.den * v1.den)).toString(), timescale: span.timescale * (v0.num * v1.den + v1.num * v0.den) });
      const frames = Math.max(1, T.frameIndexAt(length, rate));
      const duration = T.frameTime(frames, rate);
      assertFree(track, clip.start, T.add(clip.start, duration), new Set([clip.id]));
      if (v0.num === v0.den) delete clip.speed; else clip.speed = v0;
      clip.speedEnd = v1;
      delete clip.rampWindow; // a new ramp over the whole clip
      if (a.curve === 'smooth') clip.speedCurve = 'smooth'; else delete clip.speedCurve;
      clip.duration = duration;
      // The length is at least one frame; for a stretch shorter than that frame needs, the ramp would read past the end of the file.
      if (T.lt(d.assets[clip.assetId]!.duration, sourceEnd(clip))) throw new OpError('out_of_bounds', 'the clip is too short for this change of speed at the end of its source', { clipId: clip.id });
      clampFades(clip);
    }
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Speed ${a.from}× → ${a.to}×, gradually`, output: { from: v0, to: v1, durationFrames: T.frameIndexAt(targets[0]!.clip.duration, rate) } };
  },
});

const volumeTarget = (d: ProjectDocument, clipId: string) => {
  const f = mustClip(d, clipId);
  if (f.clip.type !== 'media' || f.track.kind !== 'audio') throw new OpError('incompatible', 'volume automation applies to clips on audio tracks', { clipId }, 'For a video clip, use its linked sound clip.');
  return f.clip;
};
defineOp({
  name: 'speed_ramp',
  version: 1,
  description: 'Change a clip\'s speed gradually from one value to another over its length. The clip is replaced by `steps` consecutive clips (and the same for its linked sound), each at a constant speed between `from` and `to`, playing the source on without gaps or repeats; a stepped ramp keeps every time exact. The ramp plays the same stretch of source as before (to within the rounding of each step to whole frames), so its length on the timeline changes; nothing else moves, and it is refused if the new length would run into the next clip. Not for clips with keyframes, volume keys or a transition, freeze frames, reversed clips or stills. With includeLinked=false the steps are linked to nothing, and a clip left alone in the link is unlinked too (refused while it is on a locked track). One undo restores the single clip. Sound effects are copied to each part; an echo or reverb rings on past each cut.',
  args: z.object({ clipId: z.string(), from: z.number().min(0.1).max(8), to: z.number().min(0.1).max(8), steps: z.number().int().min(2).max(24).optional().describe('Default 8'), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given a speed');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file have a speed', { clipId: a.clipId });
    const rate = d.settings.frameRate;
    const steps = a.steps ?? 8;
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      if (clip.freeze || clip.reverse) throw new OpError('incompatible', 'a freeze frame or a reversed clip cannot be ramped', { clipId: clip.id });
      refuseRamped(clip, 'divided into steps');
      if (clip.keyframes || clip.volume || clip.transition || clip.effects?.some((e) => e.keyframes)) throw new OpError('incompatible', 'remove keyframes, volume keys and the transition first: they would not survive the division into steps', { clipId: clip.id });
    }
    // One plan for all targets (they share place and length): the timeline length of each step in whole frames.
    const lead = targets[0]!.clip;
    const span = toSourceSpan(lead, lead.duration); // source shown now
    const speeds = Array.from({ length: steps }, (_, k) => speedFromNumber(Number((a.from + ((a.to - a.from) * k) / (steps - 1)).toFixed(3))));
    const part = T.normalize({ value: span.value, timescale: span.timescale * steps }); // an equal share of the source for each step
    const frames = speeds.map((sp) => Math.max(1, T.frameIndexAt(T.normalize({ value: (BigInt(part.value) * BigInt(sp.den)).toString(), timescale: part.timescale * sp.num }), rate)));
    const total = frames.reduce((n, x) => n + x, 0);
    const newEnd = T.add(lead.start, T.frameTime(total, rate));
    const created: string[] = [];
    const links = targets.length > 1 ? speeds.map(() => ctx.newId('lnk')) : null;
    const oldLinks = linkIdsOf(targets.map((t) => t.clip)); // ramped alone (includeLinked=false), the clip leaves its link group
    for (const { track, clip } of targets) {
      assertFree(track, clip.start, newEnd, new Set([clip.id]));
      const asset = d.assets[clip.assetId]!;
      let start = clip.start, sourceIn = clip.sourceIn;
      const parts: MediaClip[] = [];
      for (let k = 0; k < steps; k++) {
        const sp = speeds[k]!;
        const duration = T.frameTime(frames[k]!, rate);
        const p: MediaClip = structuredClone(clip);
        p.id = k === 0 ? clip.id : ctx.newId('clp'); // the first step keeps the clip's id, so references to it stay valid
        p.start = start; p.duration = duration; p.sourceIn = sourceIn;
        if (sp.num === sp.den) delete p.speed; else p.speed = sp;
        p.linkGroupId = links ? links[k]! : null;
        if (k > 0) delete p.fadeIn;
        if (k < steps - 1) delete p.fadeOut;
        clampFades(p);
        refuseFxTimeMap(p, 'speed'); // each step keeps the sound effects; a step that keeps its pitch at another speed cannot carry them yet
        const used = toSourceSpan(p, duration);
        if (T.lt(asset.duration, T.add(sourceIn, used))) throw new OpError('out_of_bounds', 'the ramp would read past the end of the source', { clipId: clip.id });
        if (k > 0) { copyOverrides(d, clip.id, p.id); created.push(p.id); }
        parts.push(p);
        start = T.add(start, duration); sourceIn = T.add(sourceIn, used);
      }
      track.clips.splice(track.clips.indexOf(clip), 1, ...parts);
      sortClips(track);
    }
    const unlinked = dissolveLoneLinks(d, oldLinks);
    return { affectedIds: [...targets.map((t) => t.clip.id), ...created, ...unlinked], summary: `Speed ramp ${a.from}× → ${a.to}× in ${steps} steps`, output: { createdClipIds: created, steps, durationFrames: total, speeds: speeds.map((sp) => Number((sp.num / sp.den).toFixed(3))), unlinkedClipIds: unlinked } };
  },
});

defineOp({
  name: 'apply_speed_curve',
  version: 1,
  description: 'Give a clip a speed curve: a named shape such as hero (fast, a deep slow-down in the middle, fast again), bullet, montage, jump-cut, flash-in, flash-out, smooth-ramp, stutter, slow-down, build-up, wave, emphasis, surge or fast-forward, or a hand-made one from `points` (position in the clip 0–1 and the speed there; between two points the speed changes gradually). The clip is replaced by one clip per segment of the curve (and the same for its linked sound), each playing the source on without gaps or repeats at one speed or with a gradual change, so every time stays exact and each part can still be edited. The curve shows the same stretch of source as before, to within the rounding of each part to whole frames. The total length changes: by default the clips after it on the same tracks (and what is linked to them) move by the difference, and other tracks such as music stay where they are; with ripple=false nothing else moves and the new length must fit. Markers and hand-timed captions do not move. Sound is resampled with the picture, so its pitch follows the speed. A sound that plays on over the start of the next clip on its track, or whose start the previous clip plays over, is refused: remove the crossfade first (set_audio_crossfade with duration 0), or trim the earlier clip back if the overlap is not a crossfade. A sound layered wholly inside a longer one is not in the way. With includeLinked=false the clip is curved alone and is no longer linked to its other half (refused while that other half is on a locked track, since its link would have to be cleared). Sound effects are copied to each part; an echo or reverb rings on past each cut. A curve with gradual changes is refused for a sound that carries sound effects (they cannot follow a gradual change of speed yet).',
  args: z.object({
    clipId: z.string(),
    preset: z.enum(SPEED_CURVE_IDS).optional(),
    points: z.array(z.object({ at: z.number().min(0).max(1), speed: z.number().min(0.1).max(8) }).strict()).min(2).max(16).optional().describe('A hand-made curve instead of a preset: first point at 0, last at 1, in increasing order'),
    smooth: z.boolean().optional().describe('For `points`: gradual changes ease out of the first speed and into the last (default true)'),
    ripple: z.boolean().optional().describe('Default true'),
    includeLinked: z.boolean().optional(),
  }).strict(),
  apply(d, a, ctx) {
    if (!a.preset === !a.points) throw new OpError('invalid_args', 'give either preset or points', {}, 'Use one of them.');
    const preset = a.preset ? findSpeedCurve(a.preset)! : null;
    const segments = preset ? preset.segments : segmentsFromPoints(a.points!);
    if (!segments) throw new OpError('invalid_args', 'points must start at 0, end at 1 and be in increasing order (positions are taken to a thousandth)', { points: a.points });
    const smooth = preset ? preset.smooth : a.smooth !== false;
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given a speed');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file have a speed', { clipId: a.clipId });
    const rate = d.settings.frameRate;
    const lead = f.clip as MediaClip;
    // The other clips of its link group. A locked one stops the curve either way; the hint names includeLinked=false only where
    // that is a way out (three or more in the group: the others stay linked to each other and nothing on the locked track changes).
    const group: { track: Track; clip: MediaClip }[] = [];
    if (lead.linkGroupId) for (const seq of Object.values(d.sequences)) for (const track of seq.tracks) for (const c of track.clips) if (c.type === 'media' && c.id !== lead.id && c.linkGroupId === lead.linkGroupId) group.push({ track, clip: c });
    const lockedOne = group.find((g) => g.track.locked);
    if (lockedOne && a.includeLinked !== false) throw new OpError('track_locked', `linked clip ${lockedOne.clip.id} is on locked track ${lockedOne.track.id}`, { trackId: lockedOne.track.id, clipId: lockedOne.clip.id }, group.length > 1 ? 'Unlock the track or pass includeLinked=false.' : 'Unlock the track first.');
    const targets = [{ track: f.track, clip: lead }, ...(a.includeLinked === false ? [] : group)];
    // Curved on its own, the clip leaves its link group (its parts are linked to nothing). A partner that would be left alone
    // in that group is unlinked too, as unlink_clip does, so no clip keeps a link id that points at nothing; like unlink_clip,
    // that is refused while the partner's track is locked.
    let leftAlone: MediaClip | null = null;
    if (a.includeLinked === false && group.length === 1) {
      if (lockedOne) throw new OpError('track_locked', `linked clip ${lockedOne.clip.id} is on locked track ${lockedOne.track.id}, so it cannot be detached from this clip`, { trackId: lockedOne.track.id, clipId: lockedOne.clip.id }, 'Unlock the track first.');
      leftAlone = group[0]!.clip;
    }
    const span = toSourceSpan(lead, lead.duration); // source shown now; the curve shows this stretch
    const gradual = segments.some((sg) => sg.from !== sg.to);
    for (const { track, clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      if (clip.freeze || clip.reverse) throw new OpError('incompatible', 'a freeze frame or a clip that plays backwards cannot take a speed curve', { clipId: clip.id });
      if (gradual && clip.keepPitch) throw new OpError('incompatible', 'this sound is set to keep its pitch, which works at one speed only', { clipId: clip.id }, 'Turn that off first (set_clip_pitch keepPitch=false).');
      if (clip.keyframes || clip.volume || clip.effects?.some((e) => e.keyframes)) throw new OpError('incompatible', 'remove keyframes and volume keys first: they would not survive the division into parts', { clipId: clip.id });
      const i = track.clips.indexOf(clip), next = track.clips[i + 1];
      if (clip.transition || (next && next.type === 'media' && next.transition && T.eq(next.start, clipEnd(clip)))) throw new OpError('incompatible', 'remove the transition at this clip first', { clipId: clip.id });
      // Sound may overlap sound on one track. Where one clip plays on over the start of the next (a crossfade made by
      // set_audio_crossfade, what is left of one after a fade was cleared, or an overlap made by hand), dividing either of them or
      // moving what follows the curve would leave that overlap in the wrong place: the later clip starts before the old end, so
      // it would stay behind while the clips after it move. It is refused, as set_clip_reverse refuses a crossfade. A clip that
      // lies wholly inside another (a sound layered over music) is not such an overlap and stays where it is.
      const end = clipEnd(clip);
      const isCrossfade = (earlier: MediaClip, later: Clip) => !!earlier.fadeOut && T.eq(T.sub(clipEnd(earlier), earlier.fadeOut), later.start); // what set_audio_crossfade can remove
      const into = track.clips.find((o) => o.id !== clip.id && o.type === 'media' && T.lt(clip.start, o.start) && T.lt(o.start, end) && T.lt(end, clipEnd(o)));
      if (into) {
        if (isCrossfade(clip, into)) throw new OpError('incompatible', 'remove the crossfade into the next clip first', { clipId: clip.id, nextClipId: into.id }, 'Use set_audio_crossfade on the next clip with duration 0.');
        throw new OpError('incompatible', 'this clip plays on over the start of the next clip on its track; end the overlap first', { clipId: clip.id, nextClipId: into.id, overlapStart: into.start }, 'Trim the end of this clip back to overlapStart (trim_clip edge=end), or move one of the two clips to another track.');
      }
      const from = track.clips.find((o): o is MediaClip => o.id !== clip.id && o.type === 'media' && T.lt(o.start, clip.start) && T.lt(clip.start, clipEnd(o)) && T.lt(clipEnd(o), end));
      if (from) {
        if (isCrossfade(from, clip)) throw new OpError('incompatible', 'remove the crossfade from the previous clip into this one first', { clipId: clip.id, previousClipId: from.id }, 'Use set_audio_crossfade on this clip with duration 0.');
        throw new OpError('incompatible', 'the previous clip on this track plays on over the start of this one; end the overlap first', { clipId: clip.id, previousClipId: from.id, overlapStart: clip.start }, 'Trim the end of the previous clip back to overlapStart (trim_clip edge=end), or move one of the two clips to another track.');
      }
      if (!T.eq(clip.start, lead.start) || !T.eq(clip.duration, lead.duration) || !T.eq(toSourceSpan(clip, clip.duration), span))
        throw new OpError('incompatible', 'the linked clips differ in place, length or speed, so one curve cannot fit them all', { clipId: clip.id }, 'Pass includeLinked=false, or unlink them first.');
    }
    // One plan for all targets: each segment ends at an exact share of the source; a part's length is what it takes to play
    // from where the previous part actually stopped up to that point, rounded down to a whole frame (so rounding never adds up).
    const sum = segments.reduce((n, sg) => n + sg.weight, 0);
    const tooShort = () => new OpError('out_of_bounds', 'the clip is too short for this curve: one of its parts would be shorter than a frame', { clipId: lead.id, segments: segments.length }, 'Use a longer clip, a curve with fewer parts, or lower speeds.');
    const plan: { frames: number; speed: Speed; speedEnd: Speed | null }[] = [];
    const proto: MediaClip = structuredClone(lead);
    delete proto.rampWindow;
    let consumed = T.ZERO, cum = 0;
    for (const sg of segments) {
      cum += sg.weight;
      const boundary = T.normalize({ value: (BigInt(span.value) * BigInt(cum)).toString(), timescale: span.timescale * sum });
      const share = T.sub(boundary, consumed);
      if (!T.lt(T.ZERO, share)) throw tooShort();
      const v0 = speedFromNumber(sg.from), v1 = speedFromNumber(sg.to);
      const ramp = v0.num * v1.den !== v1.num * v0.den;
      // one speed: share ÷ v0; gradual: share ÷ the average of the two speeds
      const length = ramp
        ? T.normalize({ value: (BigInt(share.value) * BigInt(2 * v0.den * v1.den)).toString(), timescale: share.timescale * (v0.num * v1.den + v1.num * v0.den) })
        : T.normalize({ value: (BigInt(share.value) * BigInt(v0.den)).toString(), timescale: share.timescale * v0.num });
      const frames = T.frameIndexAt(length, rate);
      if (frames < 1) throw tooShort();
      if (v0.num === v0.den) delete proto.speed; else proto.speed = v0;
      if (ramp) { proto.speedEnd = v1; if (smooth) proto.speedCurve = 'smooth'; else delete proto.speedCurve; } else { delete proto.speedEnd; delete proto.speedCurve; }
      proto.duration = T.frameTime(frames, rate);
      consumed = T.add(consumed, toSourceSpan(proto, proto.duration));
      plan.push({ frames, speed: v0, speedEnd: ramp ? v1 : null });
    }
    const total = plan.reduce((n, p) => n + p.frames, 0);
    const oldEnd = clipEnd(lead), newEnd = T.add(lead.start, T.frameTime(total, rate));
    const created: string[] = [], partIds = new Set<string>();
    const links = targets.length > 1 ? plan.map(() => ctx.newId('lnk')) : null;
    for (const { track, clip } of targets) {
      const asset = d.assets[clip.assetId]!;
      let start = clip.start, sourceIn = clip.sourceIn;
      const parts: MediaClip[] = [];
      plan.forEach((pl, k) => {
        const p: MediaClip = structuredClone(clip);
        p.id = k === 0 ? clip.id : ctx.newId('clp'); // the first part keeps the clip's id, so references to it stay valid
        p.start = start; p.duration = T.frameTime(pl.frames, rate); p.sourceIn = sourceIn;
        delete p.rampWindow;
        if (pl.speed.num === pl.speed.den) delete p.speed; else p.speed = pl.speed;
        if (pl.speedEnd) { p.speedEnd = pl.speedEnd; if (smooth) p.speedCurve = 'smooth'; else delete p.speedCurve; } else { delete p.speedEnd; delete p.speedCurve; }
        p.linkGroupId = links ? links[k]! : null;
        if (k > 0) delete p.fadeIn;
        if (k < plan.length - 1) delete p.fadeOut;
        clampFades(p);
        refuseFxTimeMap(p, 'speed'); // the parts keep the sound effects, which cannot follow a gradual part (or one that keeps its pitch) yet
        const used = toSourceSpan(p, p.duration);
        if (T.lt(asset.duration, T.add(sourceIn, used))) throw new OpError('out_of_bounds', 'the curve would read past the end of the source', { clipId: clip.id });
        if (k > 0) { copyOverrides(d, clip.id, p.id); created.push(p.id); }
        partIds.add(p.id);
        parts.push(p);
        start = T.add(start, p.duration); sourceIn = T.add(sourceIn, used);
      });
      track.clips.splice(track.clips.indexOf(clip), 1, ...parts);
    }
    if (leftAlone) leftAlone.linkGroupId = null;
    // What comes after: by default it follows the new end on the tracks of the curve (with whatever is linked to it).
    const moved: string[] = [];
    const delta = T.sub(newEnd, oldEnd);
    if (a.ripple !== false && !T.isZero(delta)) {
      const moving = new Map<string, { track: Track; clip: Clip }>();
      for (const { track } of targets) for (const c of track.clips) if (!partIds.has(c.id) && !T.lt(c.start, oldEnd)) moving.set(c.id, { track, clip: c });
      for (const m of [...moving.values()]) for (const l of linked(d, m.clip)) if (!partIds.has(l.clip.id)) moving.set(l.clip.id, l);
      for (const m of moving.values()) { m.clip.start = T.add(m.clip.start, delta); moved.push(m.clip.id); }
      for (const track of new Set([...targets.map((t) => t.track), ...[...moving.values()].map((m) => m.track)])) {
        sortClips(track);
        if (!forbidsOverlap(track)) continue;
        for (let i = 1; i < track.clips.length; i++) {
          const prev = track.clips[i - 1]!, cur = track.clips[i]!;
          if (T.lt(cur.start, clipEnd(prev))) throw new OpError('overlap', `moving what follows the clip would make clip ${cur.id} overlap clip ${prev.id} on track ${track.id}`, { trackId: track.id, clipId: cur.id }, 'Pass ripple=false and make room by hand, or unlink the clip that is in the way.');
        }
      }
    } else {
      for (const { track } of targets) { assertFree(track, lead.start, newEnd, partIds); sortClips(track); }
    }
    const oldFrames = T.frameIndexAt(T.sub(oldEnd, lead.start), rate);
    return {
      affectedIds: [...new Set([...targets.map((t) => t.clip.id), ...created, ...moved, ...(leftAlone ? [leftAlone.id] : [])])],
      summary: `Speed curve ${preset ? preset.id : `(${segments.length} parts)`}: ${plan.length} parts, ${fmt(T.frameTime(oldFrames, rate))} → ${fmt(T.frameTime(total, rate))}`,
      output: { partClipIds: [lead.id, ...created.slice(0, plan.length - 1)], createdClipIds: created, durationFrames: total, deltaFrames: total - oldFrames, movedClipIds: moved, unlinkedClipIds: leftAlone ? [leftAlone.id] : [], parts: plan.map((p) => ({ frames: p.frames, from: p.speed.num / p.speed.den, to: p.speedEnd ? p.speedEnd.num / p.speedEnd.den : p.speed.num / p.speed.den })) },
    };
  },
});

defineOp({
  name: 'set_volume_keyframe',
  version: 1,
  description: 'Volume automation: set the level of a sound clip at a clip-local, frame-aligned time (0 = silent, 1 = unchanged, up to 4). The level moves in a straight line between keys (or eases, for a key with curve=smooth) and holds before the first and after the last. It multiplies the clip gain, fades and ducking.',
  args: z.object({ clipId: z.string(), time: RT.describe('Offset from the clip start (frame-aligned)'), value: z.number().min(0).max(4), curve: z.enum(['linear', 'smooth']).optional().describe('How the level moves from this key to the next: linear = straight line (default for a new key), smooth = eases out and in. Left out on an existing key, its shape is kept.') }).strict(),
  apply(d, a) {
    const clip = volumeTarget(d, a.clipId);
    assertAligned(d, a.time, 'time');
    if (T.isNegative(a.time) || T.lt(clip.duration, a.time)) throw new OpError('out_of_bounds', 'the key must lie inside the clip', { duration: clip.duration });
    const was = (clip.volume ?? []).find((k) => T.eq(k.time, a.time));
    const keys = (clip.volume ?? []).filter((k) => !T.eq(k.time, a.time));
    const smooth = a.curve ? a.curve === 'smooth' : was?.curve === 'smooth';
    keys.push({ time: a.time, value: a.value, ...(smooth ? { curve: 'smooth' as const } : {}) });
    keys.sort((x, y) => T.cmp(x.time, y.time));
    clip.volume = keys;
    return { affectedIds: [clip.id], summary: `Volume ${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length } };
  },
});
defineOp({
  name: 'draw_volume',
  version: 1,
  description: 'Replace the volume keys of a sound clip between two clip-local times by a new run of keys, as one edit (a level curve drawn by hand, or computed). Keys outside [from, to] are kept. Every new key must lie inside that range and inside the clip, on a whole frame; at most 400.',
  args: z.object({ clipId: z.string(), from: RT, to: RT, keys: z.array(z.object({ time: RT, value: z.number().min(0).max(4), curve: z.literal('smooth').optional() }).strict()).max(400) }).strict(),
  apply(d, a) {
    const clip = volumeTarget(d, a.clipId);
    assertAligned(d, a.from, 'from');
    assertAligned(d, a.to, 'to');
    if (T.isNegative(a.from) || T.lt(a.to, a.from) || T.lt(clip.duration, a.to)) throw new OpError('out_of_bounds', 'the range must lie inside the clip', { duration: clip.duration });
    for (const k of a.keys) { assertAligned(d, k.time, 'key time'); if (T.lt(k.time, a.from) || T.lt(a.to, k.time)) throw new OpError('out_of_bounds', 'every key must lie inside the range', { time: k.time }); }
    const fresh = a.keys.slice().sort((x, y) => T.cmp(x.time, y.time));
    if (fresh.some((k, i) => i > 0 && T.eq(fresh[i - 1]!.time, k.time))) throw new OpError('invalid_args', 'two keys at the same time');
    const keys = [...(clip.volume ?? []).filter((k) => T.lt(k.time, a.from) || T.lt(a.to, k.time)), ...fresh].sort((x, y) => T.cmp(x.time, y.time));
    if (keys.length > 2000) throw new OpError('invalid_args', 'too many volume keys on this clip (2000 at most)');
    if (keys.length) clip.volume = keys; else delete clip.volume;
    return { affectedIds: [clip.id], summary: `Volume drawn: ${fresh.length} key(s) from +${fmt(a.from)} to +${fmt(a.to)}`, output: { keyframeCount: keys.length } };
  },
});
defineOp({
  name: 'delete_volume_keyframe',
  version: 1,
  description: 'Remove the volume key at exactly this clip-local time, or every volume key of the clip when no time is given.',
  args: z.object({ clipId: z.string(), time: RT.optional() }).strict(),
  apply(d, a) {
    const clip = volumeTarget(d, a.clipId);
    const before = clip.volume?.length ?? 0;
    const keys = a.time ? (clip.volume ?? []).filter((k) => !T.eq(k.time, a.time!)) : [];
    if (a.time && keys.length === before) throw new OpError('not_found', 'there is no volume key at this time', { clipId: clip.id, time: a.time });
    if (keys.length) clip.volume = keys; else delete clip.volume;
    return { affectedIds: [clip.id], summary: `Removed ${before - keys.length} volume key(s)`, output: { keyframeCount: keys.length } };
  },
});

defineOp({
  name: 'set_clip_gain',
  version: 1,
  description: 'Set the linear audio gain of a media clip (1 = unity, 0 = silent).',
  args: z.object({ clipId: z.string(), gain: z.number().min(0).max(8) }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    refuseAdjustment(clip, 'given a sound level');
    if (clip.type !== 'media') throw new OpError('incompatible', 'gain applies to media clips', { clipId: a.clipId });
    clip.gain = a.gain;
    return { affectedIds: [clip.id], summary: `Set gain of ${clip.id} to ${a.gain}` };
  },
});

defineOp({
  name: 'move_clip',
  version: 1,
  description: 'Move a clip to a new frame-aligned start (and optionally another compatible track). Linked audio/video moves by the same amount.',
  args: z.object({ clipId: z.string(), start: RT, trackId: z.string().optional(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    assertAligned(d, a.start, 'start');
    const delta = T.sub(a.start, f.clip.start);
    const others = a.includeLinked === false ? [] : linked(d, f.clip);
    const moving = new Set([f.clip.id, ...others.map((o) => o.clip.id)]);
    let target = f.track;
    if (a.trackId && a.trackId !== f.track.id) {
      target = mustTrack(f.seq, a.trackId);
      // Adjustment clips live only on adjustment tracks, and those hold nothing else (ADR-0016): said here rather than by validation afterwards.
      if (f.clip.type === 'adjustment' && target.kind !== 'adjustment') throw new OpError('incompatible', `an adjustment goes on an adjustment track, not on ${target.kind} track ${target.id}`, { trackId: target.id }, 'Choose another adjustment track, or leave trackId out.');
      if (f.clip.type !== 'adjustment' && target.kind === 'adjustment') throw new OpError('incompatible', `only adjustment clips go on adjustment track ${target.id}`, { trackId: target.id }, `Choose a ${f.track.kind} track.`);
      if (target.kind !== f.track.kind) throw new OpError('incompatible', `cannot move a ${f.track.kind} clip to a ${target.kind} track`, { trackId: target.id });
    }
    for (const m of [{ track: target, clip: f.clip }, ...others]) {
      const start = T.add(m.clip.start, delta);
      if (T.isNegative(start)) throw new OpError('out_of_bounds', 'move would place a clip before 0', { clipId: m.clip.id });
      assertFree(m.track, start, T.add(start, m.clip.duration), moving);
    }
    if (target !== f.track) { f.track.clips.splice(f.index, 1); target.clips.push(f.clip); }
    f.clip.start = a.start;
    for (const o of others) { o.clip.start = T.add(o.clip.start, delta); sortClips(o.track); }
    sortClips(target);
    return { affectedIds: [...moving], summary: `Moved clip to ${fmt(a.start)}` };
  },
});

defineOp({
  name: 'trim_clip',
  version: 1,
  description: 'Trim one edge of a clip to a frame-aligned timeline time. Trimming the start keeps the remaining picture in place (source in-point advances). Linked clips trim together.',
  args: z.object({ clipId: z.string(), edge: z.enum(['start', 'end']), to: RT, includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    assertAligned(d, a.to, 'to');
    const targets = [{ track: f.track, clip: f.clip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) {
      // A ramped clip keeps its ramp when trimmed: it becomes a window of it (a longer window plays on at the first or last speed).
      const ramp = clip.type === 'media' && isRamped(clip) ? rampWindowOf(clip) : null;
      const end = clipEnd(clip);
      if (a.edge === 'end') {
        if (!T.lt(clip.start, a.to)) throw new OpError('out_of_bounds', 'trim would leave an empty clip', { clipId: clip.id });
        const duration = T.sub(a.to, clip.start);
        if (clip.type === 'media' && clip.reverse) {
          // a reversed clip shows the earliest material at its end: a longer clip reaches further back into the source
          const sourceIn = sourceInOfPart(clip, T.ZERO, duration);
          if (T.isNegative(sourceIn)) throw new OpError('out_of_bounds', 'not enough source material before the stretch this reversed clip shows', { clipId: clip.id, maxEnd: T.add(clipEnd(clip), toTimelineSpan(clip, clip.sourceIn)) }, 'Extend no further than maxEnd.');
          clip.sourceIn = sourceIn;
        } else if (clip.type === 'media') {
          const asset = d.assets[clip.assetId]!;
          if (asset.kind !== 'image' && T.lt(asset.duration, T.add(clip.sourceIn, toSourceSpan(clip, duration))))
            throw new OpError('out_of_bounds', 'not enough source material after the clip end', { clipId: clip.id, maxEnd: T.add(clip.start, toTimelineSpan(clip, T.sub(asset.duration, clip.sourceIn))) }, 'Extend no further than maxEnd.');
        }
        assertFree(track, clip.start, a.to, new Set([clip.id]));
        if (ramp && clip.type === 'media') clip.rampWindow = ramp;
        clip.duration = duration;
        clampFades(clip);
        fitTextAnimation(clip, d.settings.frameRate, { in: true, out: true }); // a title cut shorter than its text animation keeps what fits
      } else {
        if (!T.lt(a.to, end) || T.isNegative(a.to)) throw new OpError('out_of_bounds', 'trim would leave an empty clip or start before 0', { clipId: clip.id });
        const delta = T.sub(a.to, clip.start);
        if (clip.type === 'media' && clip.reverse) {
          // a reversed clip shows the latest material at its start: an earlier start reaches further on into the source; sourceIn stays
          const asset = d.assets[clip.assetId]!;
          if (T.lt(asset.duration, T.add(clip.sourceIn, toSourceSpan(clip, T.sub(end, a.to)))))
            throw new OpError('out_of_bounds', 'not enough source material after the stretch this reversed clip shows', { clipId: clip.id, minStart: T.sub(clip.start, toTimelineSpan(clip, T.sub(asset.duration, sourceEnd(clip)))) }, 'Extend no earlier than minStart.');
        } else if (clip.type === 'media') {
          const sourceIn = T.add(clip.sourceIn, toSourceSpan(clip, delta));
          if (T.isNegative(sourceIn)) throw new OpError('out_of_bounds', 'not enough source material before the clip start', { clipId: clip.id, minStart: T.sub(clip.start, toTimelineSpan(clip, clip.sourceIn)) }, 'Extend no earlier than minStart.');
          clip.sourceIn = sourceIn;
          if (ramp) clip.rampWindow = { offset: T.add(ramp.offset, delta), total: ramp.total };
        }
        assertFree(track, a.to, end, new Set([clip.id]));
        shiftKeyframes(clip, delta); // the animation stays attached to the content, not to the moved edge
        clip.start = a.to;
        clip.duration = T.sub(end, a.to);
        clampFades(clip);
        fitTextAnimation(clip, d.settings.frameRate, { in: true, out: true });
        sortClips(track);
      }
    }
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Trimmed ${a.edge} of clip to ${fmt(a.to)}` };
  },
});

defineOp({
  name: 'slip_clip',
  version: 1,
  description: 'Slip a clip: keep its place and length on the timeline but show a different stretch of its source. `by` is a frame-aligned timeline amount; positive shows later source, negative earlier. Linked picture and sound slip together. Fails if the source has no material that far.',
  args: z.object({ clipId: z.string(), by: RT, includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    assertAligned(d, a.by, 'by');
    if (T.eq(a.by, T.ZERO)) throw new OpError('invalid_args', 'by must not be zero');
    const targets = [{ track: f.track, clip: f.clip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { clip } of targets) {
      refuseAdjustment(clip, 'slipped');
      if (clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can be slipped', { clipId: clip.id });
      refuseRamped(clip, 'slipped');
      const asset = d.assets[clip.assetId]!;
      if (asset.kind === 'image') throw new OpError('incompatible', 'a still picture has no other part to show', { clipId: clip.id });
      const sourceIn = T.add(clip.sourceIn, toSourceSpan(clip, a.by));
      const used = clip.freeze ? T.ZERO : toSourceSpan(clip, clip.duration);
      const room = { earlier: toTimelineSpan(clip, clip.sourceIn), later: toTimelineSpan(clip, T.sub(T.sub(asset.duration, clip.sourceIn), used)) };
      if (T.isNegative(sourceIn) || T.lt(asset.duration, T.add(sourceIn, used)) || (clip.freeze && !T.lt(sourceIn, asset.duration)))
        throw new OpError('out_of_bounds', 'the source has no material that far', { clipId: clip.id, maxEarlier: room.earlier, maxLater: room.later }, 'Slip by at most maxEarlier backwards or maxLater forwards.');
      clip.sourceIn = sourceIn;
    }
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Slipped clip by ${fmt(a.by)}`, output: { sourceIn: (f.clip as Extract<Clip, { type: 'media' }>).sourceIn } };
  },
});

defineOp({
  name: 'unlink_clip',
  version: 1,
  description: 'Detach a clip from the clips it is linked to (a picture from its sound, or the other way round), so each can be moved, trimmed, split or deleted on its own. Nothing moves and nothing else changes. If only one clip would remain in the link group, it is unlinked too.',
  args: z.object({ clipId: z.string() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'media' || !clip.linkGroupId) throw new OpError('invalid_args', 'this clip is not linked to another clip', { clipId: a.clipId });
    const others = linked(d, clip);
    clip.linkGroupId = null;
    if (others.length === 1) others[0]!.clip.linkGroupId = null;
    return { affectedIds: [clip.id, ...others.map((o) => o.clip.id)], summary: 'Detached clip from its linked clips', output: { wasLinkedTo: others.map((o) => o.clip.id) } };
  },
});

defineOp({
  name: 'link_clips',
  version: 1,
  description: 'Link clips so they move, trim, split and delete together (a picture with its sound). They must cover exactly the same stretch of the timeline, be on different tracks, play in the same direction and speed, and none may be linked already (use unlink_clip first).',
  args: z.object({ clipIds: z.array(z.string()).min(2).max(8) }).strict(),
  apply(d, a, ctx) {
    if (new Set(a.clipIds).size !== a.clipIds.length) throw new OpError('invalid_args', 'the same clip is listed twice');
    const found = a.clipIds.map((id) => mustClip(d, id));
    const first = found[0]!.clip;
    for (const f of found) {
      refuseAdjustment(f.clip, 'linked');
      if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can be linked', { clipId: f.clip.id });
      // a link id that no other clip carries (left in a project saved before edits cleared such ids) links to nothing
      if (partnersOf(d, f.clip).length) throw new OpError('incompatible', 'this clip is already linked', { clipId: f.clip.id }, 'Use unlink_clip first.');
      if (f.clip.freeze) throw new OpError('incompatible', 'a freeze frame cannot be linked', { clipId: f.clip.id });
      if (!T.eq(f.clip.start, first.start) || !T.eq(f.clip.duration, first.duration)) throw new OpError('incompatible', 'linked clips must start and end together', { clipId: f.clip.id, start: f.clip.start, duration: f.clip.duration });
      const sp = (c: Clip) => (c.type === 'media' && c.speed ? c.speed.num / c.speed.den : 1);
      if (sp(f.clip) !== sp(first) || !!(f.clip as MediaClip).reverse !== !!(first as MediaClip).reverse) throw new OpError('incompatible', 'linked clips must play at the same speed and in the same direction', { clipId: f.clip.id });
    }
    if (new Set(found.map((f) => f.track.id)).size !== found.length) throw new OpError('incompatible', 'linked clips must be on different tracks');
    const link = ctx.newId('lnk');
    for (const f of found) (f.clip as MediaClip).linkGroupId = link;
    return { affectedIds: found.map((f) => f.clip.id), summary: `Linked ${found.length} clips`, output: { linkGroupId: link } };
  },
});

defineOp({
  name: 'set_clip_pitch',
  version: 1,
  description: 'Choose what a speed change does to the pitch of a clip\'s sound: keepPitch=true keeps the pitch (the sound is stretched or tightened instead), false lets the pitch rise and fall with the speed (the default). Give a sound clip, or a picture clip to set its linked sound. It has an audible effect only while the clip\'s speed is not 1. Keeping the pitch is meant for speech and music between about half and double speed. A sound that carries sound effects cannot keep its pitch at a speed other than 1 yet.',
  args: z.object({ clipId: z.string(), keepPitch: z.boolean() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given a pitch setting');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file have sound to stretch', { clipId: a.clipId });
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...linked(d, f.clip)].filter((t) => t.track.kind === 'audio' && !!d.assets[t.clip.assetId]?.audio);
    if (!targets.length) throw new OpError('incompatible', 'this clip has no sound clip', { clipId: a.clipId }, 'Give the sound clip, or a picture clip that is linked to one.');
    if (targets.every((t) => !!t.clip.keepPitch === a.keepPitch)) throw new OpError('invalid_args', `the sound already ${a.keepPitch ? 'keeps its pitch' : 'follows the speed'}`, { clipId: a.clipId });
    if (a.keepPitch) for (const { clip } of targets) refuseRamped(clip, 'stretched at one speed to keep its pitch');
    for (const { clip } of targets) { if (a.keepPitch) clip.keepPitch = true; else delete clip.keepPitch; refuseFxTimeMap(clip, 'speed'); }
    return { affectedIds: targets.map((t) => t.clip.id), summary: a.keepPitch ? 'Sound keeps its pitch at other speeds' : 'Sound pitch follows the speed', output: { clipIds: targets.map((t) => t.clip.id) } };
  },
});
defineOp({
  name: 'set_clip_reverse',
  version: 1,
  description: 'Play a clip backwards (reverse=true) or forwards again (false): a video clip on a video track, a sound clip on a sound track, or both when they are linked (they reverse together unless includeLinked=false, which also unlinks them). The clip keeps its place, length and the stretch of source it uses; only the order changes. Not for freeze frames or stills. A transition or crossfade into the next clip must still have enough spare source in the new direction.',
  args: z.object({ clipId: z.string(), reverse: z.boolean(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'played backwards');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can play backwards', { clipId: a.clipId });
    const others = linked(d, f.clip);
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : others)];
    if (targets.every((t) => !!t.clip.reverse === a.reverse)) throw new OpError('invalid_args', `the clip already plays ${a.reverse ? 'backwards' : 'forwards'}`, { clipId: a.clipId });
    const affected: string[] = [];
    for (const { track, clip } of targets) {
      const asset = d.assets[clip.assetId];
      if (!asset || asset.kind === 'image' || (track.kind === 'video' ? !asset.video : track.kind === 'audio' ? !asset.audio : true)) throw new OpError('incompatible', 'only a video clip on a video track or a sound clip on a sound track can play backwards', { clipId: clip.id });
      if (clip.freeze) throw new OpError('incompatible', 'a freeze frame has no direction', { clipId: clip.id });
      refuseRamped(clip, 'played backwards');
      if (!!clip.reverse === a.reverse) continue;
      // What plays on past this clip's end (a picture transition, or the tail of a sound crossfade) lies on the other side of the stretch after a change of direction.
      const i = track.clips.indexOf(clip);
      const next = track.clips[i + 1];
      const flipped = { ...clip, ...(a.reverse ? { reverse: true as const } : { reverse: undefined }) };
      if (track.kind === 'video' && next && next.type === 'media' && next.transition && T.eq(next.start, clipEnd(clip))) {
        const after = T.frameIndexAt(handleAfterEnd(flipped, asset.duration), d.settings.frameRate);
        if (after < next.transition.frames) throw new OpError('out_of_bounds', `the transition into the next clip needs ${next.transition.frames} spare source frames in the new direction but only ${after} exist`, { clipId: clip.id, nextClipId: next.id, maxFrames: after }, 'Shorten or remove that transition first, or slip this clip.');
      }
      if (track.kind === 'audio' && clip.fadeOut && next && next.type === 'media' && next.fadeIn && T.lt(next.start, clipEnd(clip)))
        throw new OpError('incompatible', 'remove the crossfade into the next clip first', { clipId: clip.id, nextClipId: next.id }, 'Use set_audio_crossfade with duration 0.');
      if (a.reverse) clip.reverse = true; else delete clip.reverse;
      affected.push(clip.id);
    }
    // Reversing one side only leaves picture and sound running in opposite directions: they are no longer one linked thing.
    const unlinked: string[] = [];
    if (a.includeLinked === false && f.clip.linkGroupId) {
      (f.clip as MediaClip).linkGroupId = null;
      if (others.length === 1) { others[0]!.clip.linkGroupId = null; unlinked.push(others[0]!.clip.id); }
      for (const o of others) if (!affected.includes(o.clip.id)) affected.push(o.clip.id);
    }
    return { affectedIds: affected, summary: `Clip plays ${a.reverse ? 'backwards' : 'forwards'}${targets.length > 1 ? ' (picture and sound)' : ''}${unlinked.length ? '; unlinked from its other half' : ''}`, output: { reversedClipIds: targets.map((t) => t.clip.id), unlinkedClipIds: unlinked } };
  },
});

defineOp({
  name: 'split_clip',
  version: 1,
  description: 'Split a clip at a frame-aligned timeline time strictly inside it. Linked clips are split too and the right-hand halves stay linked to each other. Sound effects are copied to each part; an echo or reverb rings on past each cut.',
  args: z.object({ clipId: z.string(), at: RT, includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    assertAligned(d, a.at, 'at');
    const targets = [{ track: f.track, clip: f.clip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    const newLink = targets.length > 1 ? ctx.newId('lnk') : null;
    const created: string[] = [];
    for (const { track, clip } of targets) {
      if (!T.lt(clip.start, a.at) || !T.lt(a.at, clipEnd(clip))) throw new OpError('out_of_bounds', 'split point must be strictly inside the clip', { clipId: clip.id, start: clip.start, end: clipEnd(clip) });
      const left = T.sub(a.at, clip.start);
      const right: Clip = structuredClone(clip);
      right.id = ctx.newId('clp');
      copyOverrides(d, clip.id, right.id);
      right.start = a.at;
      right.duration = T.sub(clip.duration, left);
      shiftKeyframes(right, left);
      if (clip.type === 'caption') { delete clip.words; delete (right as typeof clip).words; }
      if (right.type === 'media') delete right.transition; // the transition belongs to the original cut point
      if (right.type === 'media' && clip.type === 'media') { delete right.fadeIn; delete clip.fadeOut; } // fades stay on the outer edges
      if (right.type === 'media' && clip.type === 'media') { setPart(right, clip, left, right.duration); setPart(clip, clip, T.ZERO, left); if (right.linkGroupId) right.linkGroupId = newLink; }
      clip.duration = left;
      clampFades(clip);
      clampFades(right);
      fitTextAnimation(clip, d.settings.frameRate, { in: true, out: false }); // a title's entrance and exit stay on the outer edges too
      fitTextAnimation(right, d.settings.frameRate, { in: false, out: true });
      track.clips.push(right);
      sortClips(track);
      created.push(right.id);
    }
    // the left halves keep the link they had; one that was the only clip with its link id (an older project) loses it
    const unlinked = dissolveLoneLinks(d, linkIdsOf(targets.map((t) => t.clip)));
    return { affectedIds: [...new Set([...targets.map((t) => t.clip.id), ...created, ...unlinked])], summary: `Split clip at ${fmt(a.at)}`, output: { rightClipId: created[0], createdClipIds: created } };
  },
});

defineOp({
  name: 'freeze_frame',
  version: 1,
  description: 'Hold the picture a video clip shows at a frame-aligned timeline time for a given duration. Time is inserted there across the whole sequence: everything from that point on moves later by the duration (clips that cross the point are split, their sound is silent during the hold; titles and captions that cross it stay on screen through it). The held picture is a new clip that can be trimmed like any other.',
  args: z.object({ clipId: z.string(), at: RT, duration: RT }).strict(),
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    const src = f.clip;
    refuseAdjustment(src, 'held on a freeze frame');
    const asset = src.type === 'media' ? d.assets[src.assetId] : undefined;
    if (src.type !== 'media' || f.track.kind !== 'video' || !asset?.video) throw new OpError('incompatible', 'a freeze frame needs a video clip on a video track', { clipId: a.clipId });
    if (src.freeze) throw new OpError('incompatible', 'this clip is already a freeze frame', { clipId: a.clipId }, 'Trim it to make the hold longer or shorter.');
    refuseRamped(src, 'held on a freeze frame');
    assertAligned(d, a.at, 'at');
    assertAligned(d, a.duration, 'duration');
    if (!T.lt(T.ZERO, a.duration)) throw new OpError('invalid_args', 'duration must be positive');
    if (T.lt(a.at, src.start) || !T.lt(a.at, clipEnd(src))) throw new OpError('out_of_bounds', 'the frame to hold must lie inside the clip', { clipId: src.id, start: src.start, end: clipEnd(src) });
    for (const t of f.seq.tracks) if (t.locked) throw new OpError('track_locked', `track ${t.id} is locked, so time cannot be inserted without tracks going out of sync`, { trackId: t.id }, 'Unlock the track first.');
    // what the hold shows, captured before anything moves
    const local = T.sub(a.at, src.start);
    const held: MediaClip = {
      id: ctx.newId('clp'), type: 'media', assetId: src.assetId, start: a.at, duration: a.duration, sourceIn: pictureSourceAt(src, a.at, T.frameTime(1, d.settings.frameRate)), gain: 1, linkGroupId: null, freeze: true,
      transform: { ...transformAt(src, a.at) },
      ...(src.effects ? { effects: src.effects.map((fx) => { const { keyframes: _k, ...rest } = fx; return { ...structuredClone(rest), id: ctx.newId('fx'), params: { ...effectParamsAt(fx, local) } }; }) } : {}),
      ...(src.blend ? { blend: src.blend } : {}), ...(src.mask ? { mask: structuredClone(src.mask) } : {}),
      // privacy regions (ADR-0015) stay on the held picture, resolved at its own source frame; a follow goes on too
      ...(src.redact ? { redact: structuredClone(src.redact) } : {}), ...(src.follow ? { follow: { ...src.follow } } : {}),
      // stabilisation (wave 7) stays on the held picture: its correction is that of its own source frame, so the hold does not jump
      ...(src.stabilise ? { stabilise: { ...src.stabilise } } : {}),
    };
    const affected = new Set<string>([held.id]);
    const created: string[] = [held.id];
    const relink = new Map<string, string>();
    for (const track of f.seq.tracks) {
      for (const clip of [...track.clips]) {
        const end = clipEnd(clip);
        if (!T.lt(a.at, end)) continue; // entirely before the point
        affected.add(clip.id);
        if (!T.lt(clip.start, a.at)) { clip.start = T.add(clip.start, a.duration); continue; } // at or after: moves later
        if (clip.type !== 'media') { clip.duration = T.add(clip.duration, a.duration); continue; } // titles and captions stay up through the hold
        // a media clip crossing the point: split, right half moves later
        const left = T.sub(a.at, clip.start);
        const right: MediaClip = structuredClone(clip);
        right.id = ctx.newId('clp');
        copyOverrides(d, clip.id, right.id);
        right.start = T.add(a.at, a.duration);
        right.duration = T.sub(clip.duration, left);
        shiftKeyframes(right, left);
        delete right.transition;
        delete right.fadeIn;
        delete clip.fadeOut;
        setPart(right, clip, left, right.duration);
        setPart(clip, clip, T.ZERO, left);
        if (right.linkGroupId) { if (!relink.has(right.linkGroupId)) relink.set(right.linkGroupId, ctx.newId('lnk')); right.linkGroupId = relink.get(right.linkGroupId)!; }
        clip.duration = left;
        clampFades(clip);
        clampFades(right);
        track.clips.push(right);
        created.push(right.id);
        affected.add(right.id);
      }
    }
    copyOverrides(d, src.id, held.id);
    f.track.clips.push(held);
    for (const track of f.seq.tracks) sortClips(track);
    // Linked clips that do not both cross the point (one was trimmed on its own): the later part of the one that does is linked to nothing.
    const unlinked = dissolveLoneLinks(d, [...relink.keys(), ...relink.values()]);
    for (const id of unlinked) affected.add(id);
    return { affectedIds: [...affected], summary: `Freeze frame at ${fmt(a.at)} for ${fmt(a.duration)}`, output: { freezeClipId: held.id, createdClipIds: created, unlinkedClipIds: unlinked } };
  },
});
defineOp({
  name: 'move_clips',
  version: 1,
  description: 'Move several clips by the same frame-aligned amount (negative = earlier), keeping their positions relative to each other. Linked picture/sound moves along. All or nothing: refused if any clip would start before 0 or land on a clip that is not moving.',
  args: z.object({ clipIds: z.array(z.string()).min(1).max(500), delta: RT, includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    assertAligned(d, a.delta, 'delta');
    const items = new Map<string, { track: Track; clip: Clip }>();
    for (const id of a.clipIds) {
      const f = mustClip(d, id);
      items.set(f.clip.id, { track: f.track, clip: f.clip });
      if (a.includeLinked !== false) for (const l of linked(d, f.clip)) items.set(l.clip.id, l);
    }
    const moving = new Set(items.keys());
    for (const { track, clip } of items.values()) {
      const start = T.add(clip.start, a.delta);
      if (T.isNegative(start)) throw new OpError('out_of_bounds', 'move would place a clip before 0', { clipId: clip.id });
      assertFree(track, start, T.add(start, clip.duration), moving);
    }
    for (const { clip } of items.values()) clip.start = T.add(clip.start, a.delta);
    for (const track of new Set([...items.values()].map((i) => i.track))) sortClips(track);
    return { affectedIds: [...moving], summary: `Moved ${moving.size} clip(s) by ${fmt(a.delta)}` };
  },
});
defineOp({
  name: 'delete_clip',
  version: 1,
  description: 'Remove a clip (and its linked clips unless includeLinked=false). Leaves a gap; the source asset is kept. With includeLinked=false the clip it was linked to is unlinked, since a link needs two clips (refused while that clip is on a locked track); of three or more linked clips, the others stay linked to each other.',
  args: z.object({ clipId: z.string(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    const targets = [{ track: f.track, clip: f.clip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) track.clips.splice(track.clips.indexOf(clip), 1);
    const unlinked = dissolveLoneLinks(d, linkIdsOf(targets.map((t) => t.clip)));
    return { affectedIds: [...targets.map((t) => t.clip.id), ...unlinked], summary: `Deleted ${targets.length} clip(s)${unlinked.length ? '; the clip it was linked to is no longer linked' : ''}`, output: { deletedClipIds: targets.map((t) => t.clip.id), unlinkedClipIds: unlinked } };
  },
});

/** The length of time the spans cover before `at`, counting time that two spans share once (spans may overlap on a sound track). */
function coveredBefore(spans: readonly { s: T.RationalTime; e: T.RationalTime }[], at: T.RationalTime): T.RationalTime {
  let total = T.ZERO, reach: T.RationalTime | null = null;
  for (const sp of spans) { // sorted by start
    if (!T.lt(sp.s, at)) break;
    const s = reach && T.lt(sp.s, reach) ? reach : sp.s, e = T.min(sp.e, at);
    if (T.lt(s, e)) total = T.add(total, T.sub(e, s));
    if (!reach || T.lt(reach, sp.e)) reach = sp.e;
  }
  return total;
}
/**
 * The words of the refusals shiftClips raises; each op that closes a gap passes its own, so the advice fits the edit (wave 7
 * craft: ripple_trim says "trim without closing the gap", ripple_delete_clips "delete and keep the gap").
 */
export interface ShiftWords {
  differentAmounts: (clipId: string, otherClipId: string) => string; differentAmountsHint: string;
  lockedPartnerHint: string;
  beforeZero: (clipId: string) => string; beforeZeroHint: string;
  over: (clipId: string, otherClipId: string, trackId: string) => string; overHint: string;
}
/** ripple_delete_clips' words, unchanged since before the extraction (packages/evals/src/ripple-delete.golden.json pins them). */
export const RIPPLE_DELETE_WORDS: ShiftWords = {
  differentAmounts: (a, b) => `linked clips ${a} and ${b} would move by different amounts`, differentAmountsHint: 'Delete the clips of one track at a time, or unlink those two clips first.',
  lockedPartnerHint: 'Unlock the track, or delete with delete_clip to keep the gap.',
  beforeZero: (a) => `closing the gap would place clip ${a} before 0`, beforeZeroHint: 'Delete with delete_clip to keep the gap, or trim the start of that clip (it starts before the clip it is linked to) first.',
  over: (a, b, t) => `closing the gap would put clip ${a} over clip ${b} on track ${t}`, overHint: 'Delete with delete_clip to keep the gap, or move the clip that is in the way first.',
};
/** One clip that a gap-closing edit moves: `by` is how much EARLIER it goes (negative: later), frame-aligned, never rounded. */
export interface ShiftEntry { track: Track; clip: Clip; by: T.RationalTime }
/**
 * The shared shift of ripple_delete_clips and ripple_trim (extracted from ripple_delete_clips, wave 7 craft pre-pass; the golden
 * ripple-delete.golden.json, recorded before, replays identically). `shift` holds every clip of the closing tracks with its `by`;
 * this adds the linked partners of each clip that moves (same amount; refused when two linked clips would move by different
 * amounts, or a partner is on a locked track), refuses a clip that would go before 0, applies the moves, and refuses a moved clip
 * landing on a clip that did not move with it, on the closing tracks and the tracks of the moved clips. Mutates `shift` and the
 * draft; returns the clips that moved (by ≠ 0). All or nothing only through the transaction (the caller throws on the draft).
 */
export function shiftClips(d: ProjectDocument, shift: Map<string, ShiftEntry>, closing: ReadonlySet<Track>, w: ShiftWords): ShiftEntry[] {
  for (const m of [...shift.values()]) {
    if (T.isZero(m.by)) continue;
    for (const p of partnersOf(d, m.clip)) {
      const had = shift.get(p.clip.id);
      if (had) {
        if (!T.eq(had.by, m.by)) throw new OpError('incompatible', w.differentAmounts(m.clip.id, p.clip.id), { clipId: m.clip.id, otherClipId: p.clip.id, by: m.by, otherBy: had.by }, w.differentAmountsHint);
        continue;
      }
      if (p.track.locked) throw new OpError('track_locked', `linked clip ${p.clip.id} is on locked track ${p.track.id}`, { trackId: p.track.id, clipId: p.clip.id }, w.lockedPartnerHint);
      shift.set(p.clip.id, { ...p, by: m.by });
    }
  }
  const moved = [...shift.values()].filter((m) => !T.isZero(m.by));
  // A clip on a closing track never goes before 0 (it moves by at most the time before it), but a linked clip that starts
  // earlier than its partner does (a sound that starts before its picture: a J-cut) can; it keeps its offset, so refuse.
  for (const m of moved) if (T.lt(m.clip.start, m.by)) throw new OpError('out_of_bounds', w.beforeZero(m.clip.id), { clipId: m.clip.id, trackId: m.track.id, start: m.clip.start, by: m.by }, w.beforeZeroHint);
  for (const m of moved) m.clip.start = T.sub(m.clip.start, m.by);
  // A clip that moved may not land on one that did not move with it, on any track: sounds that already overlapped
  // (a crossfade) and moved together keep their overlap, but a sound is never slid over another one that stays.
  const by = (c: Clip) => shift.get(c.id)?.by ?? T.ZERO;
  for (const track of new Set([...closing, ...moved.map((m) => m.track)])) {
    sortClips(track);
    for (let i = 0; i < track.clips.length; i++) {
      const cur = track.clips[i]!;
      for (let k = i + 1; k < track.clips.length && T.lt(track.clips[k]!.start, clipEnd(cur)); k++) {
        const other = track.clips[k]!;
        if (T.eq(by(cur), by(other))) continue;
        const [mover, still] = T.lt(by(other), by(cur)) ? [cur, other] : [other, cur];
        throw new OpError('overlap', w.over(mover.id, still.id, track.id), { trackId: track.id, clipId: mover.id, otherClipId: still.id }, w.overHint);
      }
    }
  }
  return moved;
}
defineOp({
  name: 'ripple_delete_clips',
  version: 1,
  description: 'Delete clips and close the gap they leave, in one step (ripple delete; the editor sends it for Delete on the main track when the project has rippleDelete on, see set_timeline_behaviour). The clips go, with their linked clips unless includeLinked=false. On each track one of the named clips was on, every later clip moves earlier by the length deleted before it on that track, so nothing is left where they were. A clip linked to a clip that moves moves with it by the same amount (a picture\'s sound follows its picture, wherever it is). Everything else stays where it is: other tracks such as music, titles, captions and overlays, gaps that were already there (close_gaps removes empty time on every track) and markers. All or nothing: refused when a clip that would move is on a locked track, when two linked clips would have to move by different amounts, when a clip that moves would land on a clip that does not move with it (also on a sound track: a sound is never slid over another), or when a linked clip that starts before its partner (a sound that starts before its picture, a J-cut) would move before 0. delete_clip deletes and keeps the gap.',
  args: z.object({ clipIds: z.array(z.string()).min(1).max(500), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    // what goes: the named clips, and their linked clips unless includeLinked=false; the tracks of the named clips close up
    const gone = new Map<string, { track: Track; clip: Clip }>();
    const closing = new Set<Track>();
    for (const id of a.clipIds) { const f = mustClip(d, id); gone.set(f.clip.id, { track: f.track, clip: f.clip }); closing.add(f.track); }
    if (a.includeLinked !== false) for (const g of [...gone.values()]) for (const l of linked(d, g.clip)) gone.set(l.clip.id, l);
    const spans = new Map<Track, { s: T.RationalTime; e: T.RationalTime }[]>();
    for (const t of closing) spans.set(t, [...gone.values()].filter((g) => g.track === t).map((g) => ({ s: g.clip.start, e: clipEnd(g.clip) })).sort((x, y) => T.cmp(x.s, y.s)));
    for (const { track, clip } of gone.values()) track.clips.splice(track.clips.indexOf(clip), 1);
    const unlinked = dissolveLoneLinks(d, linkIdsOf([...gone.values()].map((g) => g.clip)));
    // how far each clip moves: on a closing track, the deleted time before it; a linked clip moves with its partner
    const shift = new Map<string, { track: Track; clip: Clip; by: T.RationalTime }>();
    for (const t of closing) for (const c of t.clips) shift.set(c.id, { track: t, clip: c, by: coveredBefore(spans.get(t)!, c.start) });
    const moved = shiftClips(d, shift, closing, RIPPLE_DELETE_WORDS);
    // per closing track, the time taken out of it (all of its deleted time)
    const closed = [...closing].map((t) => { const sp = spans.get(t)!; return { trackId: t.id, removed: coveredBefore(sp, sp.reduce((e, x) => T.max(e, x.e), T.ZERO)) }; });
    const deletedClipIds = [...gone.keys()], movedClipIds = moved.map((m) => m.clip.id);
    return {
      affectedIds: [...new Set([...deletedClipIds, ...movedClipIds, ...unlinked])],
      summary: `Deleted ${deletedClipIds.length} clip(s) and closed the gap${movedClipIds.length ? `; ${movedClipIds.length} clip(s) moved earlier` : ''}${unlinked.length ? `; ${unlinked.length} clip(s) no longer linked` : ''}`,
      output: { deletedClipIds, movedClipIds, unlinkedClipIds: unlinked, closed },
    };
  },
});

defineOp({
  name: 'restore_entities',
  version: 1,
  internal: true,
  description: 'Set entities to recorded states. Issued only by the server for undo/redo and reviewed attachments, so history stays replayable.',
  args: z.object({ targets: z.array(z.object({ id: z.string(), state: z.unknown().nullable() }).strict()).min(1).max(5000) }).strict(),
  apply(d, a) {
    try {
      restoreEntities(d, a.targets as { id: string; state: EntityState | null }[]);
    } catch (e: any) {
      throw new OpError('invalid_result', `cannot restore: ${e.message}`);
    }
    return { affectedIds: a.targets.map((t) => t.id), summary: `Restored ${a.targets.length} item(s)` };
  },
});

// ---------- transactions ----------

const MOTION = ['none', ...ANIMATE_CLIP_MOTIONS] as const;
export const CLIP_MOTIONS = MOTION;
type MotionKeyList = { frame: number; value: number; easing: (typeof EASINGS)[number] }[];
/**
 * Write one motion's keys (motionKeys / animateClipKeys, in whole clip-local frames) on a clip: the single way entrances,
 * exits, loops and moves are placed, by apply_motion_preset and animate_clip alike, so whichever of the two runs last owns
 * the part of the clip it writes and replaces what either of them wrote there.
 *  - An entrance ('in') replaces the entrance the clip already has, and an exit ('out') its exit, as a whole: on every
 *    property the earlier one used, not only on those of the new one (previousMotion says how it is recognised and how
 *    many keys go: the key that later animation on a property starts from, or that the motion shares with the one at the
 *    other end, stays). On its own properties it then replaces the keys in its own frames and keeps those after an
 *    entrance or before an exit.
 *  - A loop or a move replaces all keys of its properties.
 */
function placeMotion(clip: Clip, rate: T.Rate, kind: 'in' | 'out' | 'loop' | 'move', made: Partial<Record<(typeof ANIMATABLE)[number], MotionKeyList>>) {
  const total = T.frameIndexAt(clip.duration, rate);
  const keyframes = { ...clip.keyframes };
  const frameOf = (t: T.RationalTime) => T.toSeconds(t) * (rate.num / rate.den);
  if (kind === 'in' || kind === 'out') {
    const now: Parameters<typeof previousMotion>[1] = {};
    for (const p of ANIMATABLE) if (keyframes[p]?.length) now[p] = keyframes[p]!.map((k) => ({ frame: frameOf(k.time), value: k.value, easing: k.easing }));
    for (const [p, count] of Object.entries(previousMotion(kind, now, total, clip.transform)) as [(typeof ANIMATABLE)[number], number][]) {
      const rest = kind === 'in' ? keyframes[p]!.slice(count) : keyframes[p]!.slice(0, keyframes[p]!.length - count);
      // the easing on the key an exit started from shaped the exit; with the exit gone that key is the last one and shapes nothing
      if (kind === 'out' && rest.length) rest[rest.length - 1] = withCurve(rest[rest.length - 1]!, 'linear');
      if (rest.length) keyframes[p] = rest; else delete keyframes[p];
    }
  }
  for (const [p, keys] of Object.entries(made) as [(typeof ANIMATABLE)[number], MotionKeyList][]) {
    const lo = keys[0]!.frame, hi = keys[keys.length - 1]!.frame;
    // keys the motion does not cover stay: after an entrance, before an exit; a loop or a move covers the whole clip
    const kept = kind === 'in' ? (keyframes[p] ?? []).filter((k) => frameOf(k.time) > hi + 1e-9)
      : kind === 'out' ? (keyframes[p] ?? []).filter((k) => frameOf(k.time) < lo - 1e-9) : [];
    const fresh: Keyframe[] = keys.map((k) => ({ time: T.frameTime(k.frame, rate), value: k.value, easing: k.easing }));
    // The key an entrance ends on is also the key that what follows starts from (an exit that begins right there, a slow zoom):
    // where one was there already, it keeps its easing, so the entrance does not change the shape of what comes after it.
    const meets = kind === 'in' && kept.length ? (keyframes[p] ?? []).find((k) => Math.abs(frameOf(k.time) - hi) <= 1e-9) : undefined;
    if (meets) fresh[fresh.length - 1] = withCurve(fresh[fresh.length - 1]!, meets);
    const next = [...kept, ...fresh].sort((x, y) => T.cmp(x.time, y.time));
    if (next.length > 2000) throw new OpError('out_of_bounds', 'this motion would need more keyframes than a property can hold on a clip this long', { keyframes: next.length }, 'Use a longer period (frames), or a shorter clip.');
    keyframes[p] = next;
  }
  clip.keyframes = keyframes;
}
defineOp({
  name: 'animate_clip',
  version: 1,
  description: 'Give a text or picture clip an entrance and/or exit (fade, pop, slide), written as ordinary keyframes on opacity, scale, x or y, so the result stays editable with set_keyframe. Each is placed exactly as an entrance or exit from the motion library is (apply_motion_preset): it replaces the entrance (or exit) the clip already has, whether that came from this operation or from the library, on every property it used, and keeps the other end, a slow move and keys made by hand further in. A side that is left out (or none) stays as it is. Entrance plus exit may not be longer than the clip. The exit is placed against the current clip end; run again after changing the duration. A key with a curve the motion library does not write (smooth, gentle, sharp, overshoot, anticipate, bounce, spring or a custom bezier, list_catalog → curves) counts as made by hand: an earlier entrance or exit is not recognised through it.',
  args: z.object({ clipId: z.string(), in: z.enum(MOTION).optional(), out: z.enum(MOTION).optional(), inFrames: z.number().int().min(1).max(600).optional(), outFrames: z.number().int().min(1).max(600).optional() }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type === 'caption' || track.kind === 'audio') throw new OpError('incompatible', 'only text and picture clips can be animated', { clipId: clip.id });
    const rate = d.settings.frameRate;
    const total = T.frameIndexAt(clip.duration, rate);
    const enter = a.in ?? 'none', exit = a.out ?? 'none';
    if (enter === 'none' && exit === 'none') throw new OpError('invalid_args', 'choose an entrance and/or an exit');
    const nIn = enter === 'none' ? 0 : a.inFrames ?? 12, nOut = exit === 'none' ? 0 : a.outFrames ?? 12;
    if (total < 2) throw new OpError('out_of_bounds', 'the clip is too short to animate', { clipFrames: total });
    if (nIn + nOut > total) throw new OpError('out_of_bounds', `entrance (${nIn}) plus exit (${nOut}) frames exceed the clip length (${total} frames)`, { clipFrames: total }, 'Use fewer frames.');
    const props = new Set<string>();
    // the entrance first, then the exit: where the two meet, the exit's first key is the one that stays, as with two library motions
    for (const [kind, name, frames] of [['in', enter, nIn], ['out', exit, nOut]] as const) {
      if (name === 'none') continue;
      const made = animateClipKeys(kind, name, { totalFrames: total, rest: clip.transform, frames });
      refuseAdjustmentMotion(clip, name, Object.keys(made));
      placeMotion(clip, rate, kind, made);
      for (const p of Object.keys(made)) props.add(p);
    }
    return { affectedIds: [clip.id], summary: `Animated clip (${enter === 'none' ? '' : `in: ${enter}`}${enter !== 'none' && exit !== 'none' ? ', ' : ''}${exit === 'none' ? '' : `out: ${exit}`})`, output: { properties: [...props] } };
  },
});

defineOp({
  name: 'apply_motion_preset',
  version: 1,
  description: 'Give a text or picture clip one motion from the motion library (see list_catalog → motionPresets): an entrance (motion.in.*), an exit (motion.out.*), a loop that repeats over the whole clip (motion.loop.*) or one move across the whole clip such as a slow zoom or pan (motion.move.*). It writes ordinary keyframes on the properties the motion uses (x, y, scale, rotation, opacity), measured from the values the clip has now, so the result stays editable with set_keyframe. An entrance replaces the entrance the clip already has at its start (one from this library or from animate_clip), on every property that one used, and otherwise the keys of its own properties in its first frames; an exit does the same with an earlier exit and its last frames, so an entrance and an exit can be combined and each can be changed for another. Animation that goes on after the entrance or before the exit (a slow zoom, keys made by hand) is kept. A loop or a move replaces all keys of its properties. `frames` is the length of an entrance or exit, or the period of a loop. The exit is placed against the current clip end; run again after changing the length. A key with a curve the motion library does not write (smooth, gentle, sharp, overshoot, anticipate, bounce, spring or a custom bezier, list_catalog → curves) counts as made by hand: an earlier entrance or exit is not recognised through it.',
  args: z.object({ clipId: z.string(), presetId: z.enum(MOTION_PRESET_IDS), frames: z.number().int().min(1).max(600).optional(), amount: z.number().min(0).max(2).optional().describe('Strength, default 1') }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type === 'caption' || track.kind === 'audio') throw new OpError('incompatible', 'only text and picture clips can be animated', { clipId: clip.id });
    const preset = MOTION_PRESETS.find((m) => m.id === a.presetId)!;
    refuseAdjustmentMotion(clip, preset.id, preset.properties);
    const rate = d.settings.frameRate;
    const total = T.frameIndexAt(clip.duration, rate);
    if (total < 2) throw new OpError('out_of_bounds', 'the clip is too short to animate', { clipFrames: total });
    const fps = rate.num / rate.den;
    // Default lengths keep their duration in seconds at any frame rate (they were designed at 30 frames a second).
    const frames = a.frames ?? (preset.kind === 'move' ? undefined : defaultMotionFrames(preset.id, fps));
    const safe = shortestSafeLoopFrames(preset.id, fps);
    if (safe !== null && frames !== undefined && frames < safe)
      throw new OpError('invalid_args', `${preset.name.en} with a period of ${frames} frames would dim and return more than three times a second, a seizure risk for some viewers; at ${Number(fps.toFixed(3))} frames a second the shortest period offered is ${safe} frames`, { frames, shortest: safe }, `Use frames >= ${safe}.`);
    const made = motionKeys(preset.id, { totalFrames: total, rest: clip.transform, ...(frames !== undefined ? { frames } : {}), ...(a.amount !== undefined ? { amount: a.amount } : {}) });
    placeMotion(clip, rate, preset.kind, made);
    return { affectedIds: [clip.id], summary: `Motion ${preset.id}`, output: { properties: Object.keys(made), kind: preset.kind } };
  },
});

defineOp({
  name: 'duplicate_clips',
  version: 1,
  description: 'Copy clips with everything on them (trim, transform, keyframes, effects, mask, fades, per-format overrides) to a new time. Give `at` (timeline time where the earliest copied clip should start) or `offset` (shift from the originals). Copies go on a preferred track of their kind when one is given and free, else on the same tracks when free, otherwise on another compatible track. Linked picture+sound pairs stay linked to each other, not to the originals.',
  args: z.object({ clipIds: z.array(z.string()).min(1).max(200), at: RT.optional(), offset: RT.optional(), preferTrackIds: z.array(z.string()).max(8).optional().describe('Tracks to try first for the copies of their kind (a picture track for picture copies, a sound track for sound copies), before the tracks the originals are on') }).strict(),
  apply(d, a, ctx) {
    if ((a.at === undefined) === (a.offset === undefined)) throw new OpError('invalid_args', 'give exactly one of `at` or `offset`');
    const found = [...new Set(a.clipIds)].map((id) => { const f = findClip(d, id); if (!f) throw new OpError('not_found', `clip ${id} not found`, { clipId: id }); return f; });
    const earliest = found.reduce((m, f) => T.min(m, f.clip.start), found[0]!.clip.start);
    const shift = a.offset ?? T.sub(a.at!, earliest);
    assertAligned(d, shift, a.offset ? 'offset' : 'at');
    const relink = new Map<string, string>();
    const created: string[] = [];
    for (const f of found.sort((x, y) => T.cmp(x.clip.start, y.clip.start))) {
      const copy: Clip = structuredClone(f.clip);
      copy.id = ctx.newId(copy.type === 'caption' ? 'cue' : 'clp');
      copy.start = T.add(f.clip.start, shift);
      if (T.isNegative(copy.start)) throw new OpError('out_of_bounds', 'a copy would start before 0', { clipId: f.clip.id });
      if (copy.type === 'media') {
        delete copy.transition; // a transition belongs to the cut it was made for
        if (copy.linkGroupId) { if (!relink.has(copy.linkGroupId)) relink.set(copy.linkGroupId, ctx.newId('lnk')); copy.linkGroupId = relink.get(copy.linkGroupId)!; }
      }
      const end = clipEnd(copy);
      const free = (t: Track) => !t.locked && !(forbidsOverlap(t) && overlaps(t, copy.start, end, new Set()));
      const preferred = (a.preferTrackIds ?? []).map((id) => mustTrack(f.seq, id)).find((t) => t.kind === f.track.kind && (t.kind !== 'caption' || t.caption?.mode === 'manual') && free(t));
      let track: Track | undefined = preferred ?? (free(f.track) ? f.track : f.seq.tracks.find((t) => t.kind === f.track.kind && t.id !== f.track.id && (t.kind !== 'caption' || t.caption?.mode === 'manual') && free(t)));
      if (!track) {
        if (f.track.kind === 'caption') throw new OpError('overlap', 'no free place for the copied caption', { clipId: f.clip.id });
        track = newTrack(f.seq, f.track.kind, ctx);
      }
      track.clips.push(copy);
      sortClips(track);
      copyOverrides(d, f.clip.id, copy.id);
      created.push(copy.id);
    }
    // a link group with a single member is not a link
    for (const id of created) { const c = findClip(d, id)!.clip; if (c.type === 'media' && c.linkGroupId && !created.some((o) => o !== id && (findClip(d, o)!.clip as MediaClip).linkGroupId === c.linkGroupId)) c.linkGroupId = null; }
    return { affectedIds: created, summary: `Duplicated ${created.length} clip(s)`, output: { createdClipIds: created } };
  },
});

// ---------- recipes (SPEC §23): a planned list of ordinary ops applied and recorded as one step ----------
// The run machinery below is shared by apply_recipe and apply_template (templateOps.ts, ADR-0016).
/**
 * Regeneration of a run: remove the previous run's untouched clips (ids that no longer exist are skipped; a clip on a locked
 * track stops the edit). A clip of that run that was edited by hand stays; if what it was linked to goes, it is no longer
 * linked. Returns the ids this changed.
 */
export function removeRunClips(d: ProjectDocument, clipIds: readonly string[]): string[] {
  const affected: string[] = [];
  const left = new Set<string>(); // link groups that lose a clip here
  for (const id of clipIds) {
    const f = findClip(d, id);
    if (!f) continue;
    if (f.track.locked) throw new OpError('track_locked', `track ${f.track.id} is locked`, { trackId: f.track.id, clipId: id });
    f.track.clips.splice(f.index, 1);
    for (const g of linkIdsOf([f.clip])) left.add(g);
    affected.push(id);
  }
  // the previous run's clip that was edited by hand stays; if what it was linked to goes, it is no longer linked
  affected.push(...dissolveLoneLinks(d, left));
  return affected;
}
/** The ids an operation's output names as made by it: clipId, audioClipId, trackId, variantId and createdClipIds. */
export function createdIdsOf(out: Readonly<Record<string, unknown>>): string[] {
  const ids: string[] = [];
  for (const key of ['clipId', 'audioClipId', 'trackId', 'variantId'] as const) if (typeof out[key] === 'string') ids.push(out[key] as string);
  if (Array.isArray(out.createdClipIds)) ids.push(...(out.createdClipIds as string[]));
  return ids;
}
/**
 * The output keys that name an id a step made (ADR-0018): createdIdsOf's keys plus the sequence lifecycle's (add_sequence
 * returns AddSequenceOutput). W1 switches apply_recipe to collectCreated / isLiveCreated (its behaviour unchanged: no recipe
 * step makes a sequence); apply_sequence_plan uses them from the start.
 */
export const CREATED_OUTPUT_KEYS = ['clipId', 'audioClipId', 'trackId', 'variantId', 'sequenceId', 'videoTrackId', 'textTrackId', 'audioTrackId'] as const;
/** Push the ids an operation's output names as made by it (CREATED_OUTPUT_KEYS and createdClipIds) onto `into`. */
export function collectCreated(output: Readonly<Record<string, unknown>> | undefined, into: string[]): void {
  const out = output ?? {};
  for (const k of CREATED_OUTPUT_KEYS) if (Object.hasOwn(out, k) && typeof out[k] === 'string') into.push(out[k] as string);
  if (Object.hasOwn(out, 'createdClipIds') && Array.isArray(out.createdClipIds)) into.push(...(out.createdClipIds as unknown[]).filter((x): x is string => typeof x === 'string'));
}
/** True while a created id still names something: a clip, a variant, a sequence or a track of any sequence (own properties only). */
export const isLiveCreated = (d: ProjectDocument, id: string): boolean =>
  !!findClip(d, id) || Object.hasOwn(d.variants ?? {}, id) || Object.hasOwn(d.sequences, id) || Object.values(d.sequences).some((s) => s.tracks.some((t) => t.id === id));
/**
 * What a run record keeps of the ids a run made: those that still exist (clips, variants, tracks), and the content
 * fingerprint of each clip among them. Clips kept from an earlier run keep their ORIGINAL fingerprint (`previous`), so they
 * stay recognisable as hand-edited next time too.
 */
export function runFingerprints(d: ProjectDocument, created: readonly string[], keepIds: readonly string[], previous: Readonly<Record<string, string>>): { createdIds: string[]; fingerprints: Record<string, string> } {
  const createdIds = [...new Set(created)].filter((x) => isLiveCreated(d, x));
  const fingerprints: Record<string, string> = {};
  for (const cid of createdIds) {
    const f = findClip(d, cid);
    if (!f) continue;
    fingerprints[cid] = keepIds.includes(cid) && previous[cid] ? previous[cid]! : fingerprint(f.clip);
  }
  return { createdIds, fingerprints };
}
defineOp({
  name: 'apply_recipe',
  version: 1,
  internal: true,
  description: 'Apply a recipe plan (ordinary public ops) as one step and record which objects it created. Issued by the server from a plan it built; on regeneration it first removes the previous run\'s untouched clips.',
  args: z.object({ runId: z.string().optional(), recipeId: z.string().max(64), params: z.record(z.string(), z.unknown()), steps: z.array(z.string().max(400)).max(50), removeClipIds: z.array(z.string()).max(5000).optional(), keepIds: z.array(z.string()).max(5000).optional(), ops: z.array(z.object({ op: z.string(), args: z.unknown() }).strict()).min(1).max(2000),
    // optional and additive (ADR-0016 decision 6): record each clip's range in the run, and carry on the ranges of clips deleted by hand
    recordRanges: z.literal(true).optional(), keepRanges: z.record(z.string(), RunRangeSchema).optional(),
    // optional and additive (amendment of 2026-11-24): with recordRanges, record each clip's track too, so a clip that was only moved in
    // time on its own track is told from one taken to another track (templateOps.ts movedOnly). Absent in every older log.
    recordTracks: z.literal(true).optional() }).strict(),
  apply(d, a, ctx) {
    const affected = new Set<string>(removeRunClips(d, a.removeClipIds ?? []));
    const created: string[] = [...(a.keepIds ?? [])];
    for (const [i, call] of a.ops.entries()) {
      const def = getOp(call.op);
      if (!def || def.internal) throw new OpError('forbidden_op', `recipe step ${i} uses "${call.op}", which is not a public operation`, { index: i });
      const parsed = def.args.safeParse(call.args);
      if (!parsed.success) throw new OpError('invalid_args', `recipe step ${i} (${call.op}): ${z.prettifyError(parsed.error)}`, { index: i });
      refuseInheritedIds(parsed.data, `recipe step ${i} (${call.op})`, '', def.checksOwnIds);
      const r = def.apply(d, parsed.data, ctx);
      for (const id of r.affectedIds) affected.add(id);
      collectCreated(r.output, created);
    }
    const id = a.runId ?? ctx.newId('run');
    const previous = a.runId ? d.recipeRuns[a.runId]?.fingerprints ?? {} : {};
    const { createdIds, fingerprints } = runFingerprints(d, created, a.keepIds ?? [], previous);
    // ranges (beat montage): the clips deleted by hand carried on as given, then every clip of the run where it lies now
    const ranges: Record<string, z.infer<typeof RunRangeSchema>> = {};
    if (a.recordRanges) {
      for (const [cid, r] of Object.entries(a.keepRanges ?? {})) if (!findClip(d, cid)) ranges[cid] = { start: { ...r.start }, end: { ...r.end } };
      // recordTracks: the track too; a clip kept from the earlier run keeps the track that run recorded for it, so one taken to
      // another track by hand stays recognisable next time (its range is where it lies now, as before)
      const earlier = a.runId ? d.recipeRuns[a.runId]?.ranges ?? {} : {};
      const trackOf = (cid: string, now: string) => ((a.keepIds ?? []).includes(cid) && Object.hasOwn(earlier, cid) && earlier[cid]!.trackId !== undefined ? earlier[cid]!.trackId! : now);
      for (const cid of createdIds) { const f = findClip(d, cid); if (f) ranges[cid] = { start: { ...f.clip.start }, end: { ...clipEnd(f.clip) }, ...(a.recordTracks ? { trackId: trackOf(cid, f.track.id) } : {}) }; }
    }
    d.recipeRuns[id] = { id, recipeId: a.recipeId, params: a.params, createdIds, fingerprints, steps: a.steps, ...(a.recordRanges ? { ranges } : {}) };
    affected.add(id);
    return { affectedIds: [...affected], summary: `${a.runId ? 'Regenerated' : 'Applied'} recipe ${a.recipeId}: ${a.steps[0] ?? ''}`.slice(0, 200), output: { runId: id, createdIds: d.recipeRuns[id]!.createdIds } };
  },
});

// ---------- linked format variants (SPEC §19.8) ----------
const mustVariant = (d: ProjectDocument, id: string) => {
  const v = d.variants[id];
  if (!v) throw new OpError('not_found', `variant ${id} not found`, { variantId: id }, 'get_summary lists the variants.');
  return v;
};
/** When a clip is duplicated by a split or cut, its per-variant overrides apply to the new piece too. */
function copyOverrides(d: ProjectDocument, fromClipId: string, toClipId: string) {
  for (const v of Object.values(d.variants)) if (v.overrides[fromClipId]) v.overrides[toClipId] = structuredClone(v.overrides[fromClipId]!);
}
defineOp({
  name: 'add_variant',
  version: 1,
  description: 'Add a linked output format of this edit (e.g. 9:16, 1:1, 4:5, 16:9). Give a profileId from list_catalog → formatProfiles, or width and height. The variant always shows the current master edit; per-clip overrides adjust framing for this shape only.',
  args: z.object({ profileId: z.string().optional(), name: z.string().min(1).max(80).optional(), width: z.number().int().min(16).max(8192).optional(), height: z.number().int().min(16).max(8192).optional(), fit: z.enum(['contain', 'cover']).optional(), safeArea: SafeAreaSchema.nullable().optional() }).strict(),
  apply(d, a, ctx) {
    const p = a.profileId ? findProfile(a.profileId) : undefined;
    if (a.profileId && !p) throw new OpError('not_found', `format profile "${a.profileId}" does not exist`, { available: FORMAT_PROFILES.map((x) => x.id) });
    const width = a.width ?? p?.width, height = a.height ?? p?.height;
    if (!width || !height) throw new OpError('invalid_args', 'give a profileId, or both width and height');
    if (width % 2 || height % 2) throw new OpError('invalid_args', 'width and height must be even (video encoders require it)', { width, height });
    const v: Variant = { id: ctx.newId('var'), name: a.name ?? p?.name.en ?? `${width}×${height}`, width, height, fit: a.fit ?? p?.fit ?? 'cover', profileId: p?.id ?? null, safeArea: a.safeArea !== undefined ? a.safeArea : p?.safeArea ?? null, overrides: {} };
    d.variants[v.id] = v;
    return { affectedIds: [v.id], summary: `Added format ${v.name} (${width}×${height})`, output: { variantId: v.id } };
  },
});
defineOp({
  name: 'update_variant',
  version: 1,
  description: 'Rename a format variant or change its size, fill mode (contain/cover), safe-area guides, or the caption style for this format only (e.g. larger or higher captions in the vertical version). Clip overrides are kept.',
  args: z.object({ variantId: z.string(), name: z.string().min(1).max(80).optional(), width: z.number().int().min(16).max(8192).optional(), height: z.number().int().min(16).max(8192).optional(), fit: z.enum(['contain', 'cover']).optional(), safeArea: SafeAreaSchema.nullable().optional(), captionStyle: CaptionStyleSchema.partial().nullable().optional().describe('Caption style fields for this format only, merged into what is already set; null clears them so the format follows the master again') }).strict(),
  apply(d, a) {
    const v = mustVariant(d, a.variantId);
    if (a.captionStyle === null) delete v.captionStyle;
    else if (a.captionStyle) v.captionStyle = { ...v.captionStyle, ...a.captionStyle };
    if ((a.width ?? v.width) % 2 || (a.height ?? v.height) % 2) throw new OpError('invalid_args', 'width and height must be even');
    Object.assign(v, { ...(a.name !== undefined ? { name: a.name } : {}), ...(a.width !== undefined ? { width: a.width } : {}), ...(a.height !== undefined ? { height: a.height } : {}), ...(a.fit !== undefined ? { fit: a.fit } : {}), ...(a.safeArea !== undefined ? { safeArea: a.safeArea } : {}) });
    return { affectedIds: [v.id], summary: `Updated format ${v.name}` };
  },
});
defineOp({
  name: 'remove_variant',
  version: 1,
  description: 'Remove a format variant and its overrides. The master edit is not affected.',
  args: z.object({ variantId: z.string() }).strict(),
  apply(d, a) {
    const v = mustVariant(d, a.variantId);
    delete d.variants[v.id];
    return { affectedIds: [v.id], summary: `Removed format ${v.name}` };
  },
});
const mustMarker = (d: ProjectDocument, id: string) => {
  const m = d.markers?.[id];
  if (!m) throw new OpError('not_found', `marker ${id} does not exist`, { markerId: id });
  return m;
};
const markerAt = (d: ProjectDocument, sequenceId: string, time: T.RationalTime, except?: string) => Object.values(d.markers ?? {}).find((m) => m.id !== except && m.sequenceId === sequenceId && T.eq(m.time, time));
defineOp({
  name: 'add_marker',
  version: 1,
  description: 'Put a named marker on the timeline at a frame-aligned time: a note, a to-do or a sync point for people and agents. Markers stay at their time when clips are moved; they do move when time itself is inserted or removed on every track (insert_gap, cut_range with ripple). One marker per frame.',
  args: z.object({ sequenceId: z.string().optional().describe('The sequence to mark (a short, say); default the main sequence'), time: RT, label: z.string().max(200).optional(), color: z.enum(MARKER_COLORS).optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.time, 'time');
    if (T.isNegative(a.time)) throw new OpError('out_of_bounds', 'a marker cannot sit before the start', { time: a.time });
    const taken = markerAt(d, seq.id, a.time);
    if (taken) throw new OpError('overlap', 'there is already a marker on this frame', { markerId: taken.id }, 'Use update_marker to change it.');
    const m: Marker = { id: ctx.newId('mrk'), sequenceId: seq.id, time: a.time, label: a.label ?? '', color: a.color ?? 'blue' };
    (d.markers ??= {})[m.id] = m;
    return { affectedIds: [m.id], summary: `Added marker${m.label ? ` "${m.label}"` : ''}`, output: { markerId: m.id } };
  },
});
defineOp({
  name: 'update_marker',
  version: 1,
  description: 'Rename, recolour or move a marker.',
  args: z.object({ markerId: z.string(), time: RT.optional(), label: z.string().max(200).optional(), color: z.enum(MARKER_COLORS).optional() }).strict(),
  apply(d, a) {
    const m = mustMarker(d, a.markerId);
    if (a.time) {
      assertAligned(d, a.time, 'time');
      if (T.isNegative(a.time)) throw new OpError('out_of_bounds', 'a marker cannot sit before the start', { time: a.time });
      const taken = markerAt(d, m.sequenceId, a.time, m.id);
      if (taken) throw new OpError('overlap', 'there is already a marker on this frame', { markerId: taken.id });
      m.time = a.time;
    }
    if (a.label !== undefined) m.label = a.label;
    if (a.color) m.color = a.color;
    return { affectedIds: [m.id], summary: `Updated marker${m.label ? ` "${m.label}"` : ''}` };
  },
});
defineOp({
  name: 'remove_marker',
  version: 1,
  description: 'Remove a marker.',
  args: z.object({ markerId: z.string() }).strict(),
  apply(d, a) {
    const m = mustMarker(d, a.markerId);
    delete d.markers[m.id];
    return { affectedIds: [m.id], summary: `Removed marker${m.label ? ` "${m.label}"` : ''}` };
  },
});
/** A reviewed machine translation whose wording is edited is no longer what the owner reviewed (ADR-0017): it needs review again. */
function needsReviewAgain(v: Variant) {
  if (v.translation?.review !== 'reviewed') return;
  const { reviewedBy: _by, reviewedAt: _at, ...rest } = v.translation;
  v.translation = { ...rest, review: 'needed' };
}
defineOp({
  name: 'set_variant_override',
  version: 1,
  description: 'Adjust one clip for one format only: reposition/scale it (transform fields replace the master values and stop the master animation of those fields in this format) hide it, or give a title other wording or style fields, or a caption cue other wording (its per-word timing is then not used in that format). transform=null, hidden=false, text=null and textStyle=null clear those parts. The master and other formats are untouched.',
  args: z.object({ variantId: z.string(), clipId: z.string(), transform: TransformSchema.partial().nullable().optional(), hidden: z.boolean().optional(), text: z.string().min(1).max(2000).nullable().optional(), textStyle: TextStyleSchema.partial().nullable().optional() }).strict(),
  apply(d, a) {
    const v = mustVariant(d, a.variantId);
    const f = findClip(d, a.clipId);
    if (!f) throw new OpError('not_found', `clip ${a.clipId} not found`, { clipId: a.clipId });
    if (f.track.kind === 'audio') throw new OpError('incompatible', 'format overrides apply to picture, title and caption clips', { clipId: a.clipId });
    // a caption cue can be reworded or hidden per format; where and how captions are drawn is the caption style (update_variant.captionStyle)
    if (f.clip.type === 'caption' && (a.transform != null || a.textStyle != null)) throw new OpError('incompatible', 'a caption cue can only be reworded or hidden per format; position and style come from the caption style of the format', { clipId: a.clipId }, 'Use update_variant with captionStyle.');
    refuseAdjustmentTransform(f.clip, a.transform, 'set'); // per format too: an adjustment has only its opacity
    const cur = v.overrides[a.clipId] ?? {};
    const next = { ...cur };
    if (a.transform === null) delete next.transform; else if (a.transform) next.transform = { ...cur.transform, ...a.transform };
    if (a.hidden !== undefined) { if (a.hidden) next.hidden = true; else delete next.hidden; }
    if ((a.text != null && f.clip.type !== 'text' && f.clip.type !== 'caption') || (a.textStyle != null && f.clip.type !== 'text')) throw new OpError('incompatible', 'wording can be set per format on title and caption clips, text style on title clips', { clipId: a.clipId });
    if (a.text === null) delete next.text; else if (a.text !== undefined) next.text = a.text;
    if (next.text !== cur.text) needsReviewAgain(v); // a reworded cue of a reviewed translation is no longer what was reviewed
    if (a.textStyle === null) delete next.textStyle; else if (a.textStyle) next.textStyle = { ...cur.textStyle, ...a.textStyle };
    if (next.textStyle && Object.keys(next.textStyle).length === 0) delete next.textStyle;
    if (next.transform && Object.keys(next.transform).length === 0) delete next.transform;
    if (Object.keys(next).length === 0) delete v.overrides[a.clipId]; else v.overrides[a.clipId] = next;
    return { affectedIds: [v.id], summary: `Format ${v.name}: ${v.overrides[a.clipId] ? 'override set on' : 'override cleared from'} clip`, output: { override: v.overrides[a.clipId] ?? null } };
  },
});

defineOp({
  name: 'set_variant_phrase_text',
  version: 1,
  description: 'Word one transcript phrase differently in one format (for example a shorter line for a narrow frame). The master transcript and the other formats keep their wording. In that format the phrase is shown as phrase-timed text: word highlighting and the hiding of cut-out words do not apply to it. text: null returns the phrase to the master wording.',
  args: z.object({ variantId: z.string(), assetId: z.string(), segmentId: z.string(), text: z.string().min(1).max(4000).nullable() }).strict(),
  apply(d, a) {
    const v = mustVariant(d, a.variantId);
    const seg = d.transcripts[a.assetId]?.segments.find((s) => s.id === a.segmentId);
    if (!seg) throw new OpError('not_found', `phrase ${a.segmentId} not found in the transcript of ${a.assetId}`, { segmentId: a.segmentId });
    const next = { ...(v.phraseText ?? {}) };
    const before = next[a.segmentId];
    if (a.text === null || a.text === seg.text) delete next[a.segmentId]; else next[a.segmentId] = a.text;
    if (Object.keys(next).length) v.phraseText = next; else delete v.phraseText;
    if (before !== next[a.segmentId]) needsReviewAgain(v);
    return { affectedIds: [v.id], summary: `Format ${v.name}: phrase ${next[a.segmentId] !== undefined ? 'reworded' : 'back to the master wording'}`, output: { text: next[a.segmentId] ?? null } };
  },
});

// ---------- AI-model wave (ADR-0017): derived copies in place of a clip's file, machine-translated language variants ----------
/** The clip that starts exactly where `clip` ends on the same track, if any. */
const nextAdjacent = (track: Track, clip: Clip): Clip | undefined => track.clips.find((c) => c.id !== clip.id && T.eq(c.start, clipEnd(clip)));
defineOp({
  name: 'replace_clip_asset',
  version: 1,
  description: 'Show a derived copy of a clip\'s file in the clip, for example an enhanced picture or a cleaned-up voice a tool made from it. The clip keeps its place, length, speed, effects and everything else; linked clips keep their own file. The new file must have been made from the file the clip shows now and keep its timing, and it must cover the whole stretch of source the clip uses (plus the frames a transition into the next clip needs), so the clip shows exactly the same moments. A still picture may take a still made from it. Refused for freeze frames, reversed clips, clips that change speed gradually, and multicam segments (their file is set by the group; detach them first).',
  args: z.object({ clipId: z.string(), assetId: z.string() }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type !== 'media') throw new OpError('incompatible', 'only a picture or sound clip shows a file', { clipId: a.clipId });
    refuseTagged(clip);
    if (clip.freeze) throw new OpError('incompatible', 'a freeze frame cannot be given another file', { clipId: clip.id }, 'Give the clip the new file first, then make the freeze frame.');
    refuseRamped(clip, 'given another file');
    if (clip.reverse) throw new OpError('incompatible', 'a clip that plays backwards cannot be given another file', { clipId: clip.id }, 'Play it forwards (set_clip_reverse), give it the new file, then reverse it again.');
    if (!Object.hasOwn(d.assets, a.assetId)) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    const next = d.assets[a.assetId]!, cur = d.assets[clip.assetId];
    if (next.id === clip.assetId) throw new OpError('incompatible', 'the clip already shows this file', { clipId: clip.id, assetId: next.id });
    // stabilisation (wave 7) uses the camera motion measured on the current file; dropping it silently would change the picture
    if (clip.stabilise) throw new OpError(STEADY_REFUSALS.otherFile.code, STEADY_REFUSALS.otherFile.message(), { clipId: clip.id }, STEADY_REFUSALS.otherFile.hint);
    const der = next.provenance.derived;
    if (!der?.sourceAssetIds.includes(clip.assetId)) throw new OpError('incompatible', 'the new file was not made from the file this clip shows', { clipId: clip.id, assetId: next.id, sourceAssetIds: der?.sourceAssetIds ?? [] }, 'Run the tool on this clip, or pick the file it made from this clip\'s file.');
    if (track.kind === 'video' && !next.video && !(next.kind === 'image' && next.image)) throw new OpError('incompatible', 'the new file has no picture', { clipId: clip.id, assetId: next.id });
    if (track.kind === 'audio' && !next.audio) throw new OpError('incompatible', 'the new file has no sound', { clipId: clip.id, assetId: next.id });
    const previousAssetId = clip.assetId;
    if (cur?.kind === 'image' || next.kind === 'image') {
      // a still has no timing to keep; a still and a moving picture cannot stand in for each other
      if (cur?.kind !== 'image' || next.kind !== 'image') throw new OpError('not_time_preserving', 'a still picture and a moving picture cannot stand in for each other', { clipId: clip.id, assetId: next.id });
      clip.assetId = next.id;
      return { affectedIds: [clip.id], summary: `Clip now shows "${next.name.slice(0, 60)}"`, output: { previousAssetId, sourceIn: clip.sourceIn } };
    }
    if (!der.sourceRangeStart || der.sourceAssetIds[0] !== clip.assetId || (der.frames && der.frames.mapping !== 'identity' && der.frames.mapping !== 'interpolated'))
      throw new OpError('not_time_preserving', 'the new file does not keep the timing of the file this clip shows', { clipId: clip.id, assetId: next.id }, 'Place it on a track of its own instead (add_clip).');
    let needEnd = sourceEnd(clip);
    const after = track.kind === 'video' ? nextAdjacent(track, clip) : undefined;
    if (after?.type === 'media' && after.transition) needEnd = T.add(needEnd, toSourceSpan(clip, T.frameTime(after.transition.frames, d.settings.frameRate)));
    const from = der.sourceRangeStart, to = T.add(from, next.duration);
    if (T.lt(clip.sourceIn, from) || T.lt(to, needEnd))
      throw new OpError('range_not_covered', `the new file covers ${fmt(from)}–${fmt(to)} of the original; the clip needs ${fmt(clip.sourceIn)}–${fmt(needEnd)}`, { clipId: clip.id, assetId: next.id, covers: { start: from, end: to }, needs: { start: clip.sourceIn, end: needEnd } }, 'Run the tool on the whole stretch the clip uses, including the frames a transition after it plays.');
    clip.assetId = next.id;
    clip.sourceIn = T.sub(clip.sourceIn, from);
    return { affectedIds: [clip.id], summary: `Clip now shows "${next.name.slice(0, 60)}"`, output: { previousAssetId, sourceIn: clip.sourceIn } };
  },
});
const segmentExists = (d: ProjectDocument, id: string) => Object.values(d.transcripts ?? {}).some((t) => t.segments.some((s) => s.id === id));
defineOp({
  name: 'attach_translation',
  version: 1,
  internal: true,
  description: 'Store a machine translation of the captions, produced by the trusted translation job, as a language variant: transcript phrases keep their master timing and get the translated wording (phrase-timed, never mapped word by word), manual cues get the translated text. With variantId an existing translation variant is updated (its frame settings are kept); otherwise a new variant takes the frame, fill, safe area and caption style of baseVariantId, or the master settings when it is null. The translation always needs review afterwards.',
  args: z.object({
    variantId: z.string().min(1).max(64).optional(),
    baseVariantId: z.string().min(1).max(64).nullable(),
    name: z.string().min(1).max(80),
    language: z.string().min(2).max(35),
    translation: VariantTranslationSchema.omit({ review: true, reviewedBy: true, reviewedAt: true }),
    phraseText: z.record(z.string(), z.string().min(1).max(4000)),
    cueText: z.record(z.string(), z.string().min(1).max(2000)),
  }).strict(),
  apply(d, a, ctx) {
    const ids = [...Object.keys(a.phraseText), ...Object.keys(a.cueText)];
    if (ids.length === 0) throw new OpError('invalid_args', 'a translation needs at least one phrase or cue');
    if (a.language !== a.translation.to) throw new OpError('invalid_args', 'the language of the format must be the language translated to', { language: a.language, to: a.translation.to });
    const recorded = Object.keys(a.translation.sources).sort(), translated = [...ids].sort();
    if (recorded.length !== translated.length || recorded.some((k, i) => k !== translated[i])) throw new OpError('invalid_args', 'the translation must record the master text of every translated phrase and cue, and of nothing else', { translated, recorded });
    for (const id of Object.keys(a.phraseText)) if (!segmentExists(d, id)) throw new OpError('not_found', `phrase ${id} not found in any transcript`, { segmentId: id });
    for (const id of Object.keys(a.cueText)) {
      const f = findClip(d, id);
      if (!f || f.clip.type !== 'caption') throw new OpError('not_found', `caption cue ${id} not found`, { clipId: id });
      if (f.track.caption?.mode !== 'manual') throw new OpError('incompatible', 'only cues of a manual caption track are translated as cues', { clipId: id });
    }
    let v: Variant;
    if (a.variantId) {
      v = mustVariant(d, a.variantId);
      if (!v.translation) throw new OpError('incompatible', 'this format is not a translation', { variantId: v.id }, 'Omit variantId to make a new language format.');
      v.name = a.name;
    } else {
      const base = a.baseVariantId === null ? null : mustVariant(d, a.baseVariantId);
      v = {
        id: ctx.newId('var'), name: a.name, width: base?.width ?? d.settings.width, height: base?.height ?? d.settings.height, fit: base?.fit ?? d.settings.fit ?? 'contain',
        profileId: base?.profileId ?? null, safeArea: base?.safeArea ? { ...base.safeArea } : null, ...(base?.captionStyle ? { captionStyle: structuredClone(base.captionStyle) } : {}), overrides: {},
      };
      d.variants[v.id] = v;
    }
    v.language = a.language;
    v.translation = { ...a.translation, sources: { ...a.translation.sources }, review: 'needed' };
    if (Object.keys(a.phraseText).length) v.phraseText = { ...a.phraseText }; else delete v.phraseText;
    // cue wording: exactly the translated cues carry a text override (other override fields stay)
    for (const [id, ov] of Object.entries(v.overrides)) {
      if (ov.text === undefined || Object.hasOwn(a.cueText, id)) continue;
      const { text: _t, ...rest } = ov;
      if (Object.keys(rest).length) v.overrides[id] = rest; else delete v.overrides[id];
    }
    for (const [id, text] of Object.entries(a.cueText)) v.overrides[id] = { ...v.overrides[id], text };
    return { affectedIds: [v.id], summary: `Translation ${a.translation.from}→${a.translation.to}: ${Object.keys(a.phraseText).length} phrases, ${Object.keys(a.cueText).length} cues (needs review)`, output: { variantId: v.id } };
  },
});
defineOp({
  name: 'review_translation',
  version: 1,
  internal: true,
  description: 'Mark a machine translation as reviewed by the person whose session made the request (the owner), or as needing review again. Reachable only through the owner\'s session; `at` is the time of the review as the server read it.',
  args: z.object({ variantId: z.string(), review: z.enum(['needed', 'reviewed']), at: z.string().max(40).optional() }).strict(),
  apply(d, a, ctx) {
    const v = mustVariant(d, a.variantId);
    if (!v.translation) throw new OpError('incompatible', 'this format is not a translation', { variantId: v.id });
    if (v.translation.review === a.review) throw new OpError('incompatible', a.review === 'reviewed' ? 'the translation is already marked as reviewed' : 'the translation is already marked as needing review', { variantId: v.id });
    const { reviewedBy: _by, reviewedAt: _at, ...rest } = v.translation;
    v.translation = { ...rest, review: a.review, ...(a.review === 'reviewed' ? { reviewedBy: ctx.actor, ...(a.at ? { reviewedAt: a.at } : {}) } : {}) };
    return { affectedIds: [v.id], summary: `Format ${v.name}: translation ${a.review === 'reviewed' ? 'marked as reviewed' : 'needs review again'}` };
  },
});

// ---------- analysis results and edits that use them (SPEC §19) ----------
const TimeList = z.array(RT).max(50000);
const sortedUnique = (list: T.RationalTime[]) => list.slice().sort(T.cmp).filter((t, i, a) => i === 0 || !T.eq(a[i - 1]!, t));
const mustAsset = (d: ProjectDocument, assetId: string) => {
  const a = d.assets[assetId];
  if (!a) throw new OpError('not_found', `asset ${assetId} not found`, { assetId });
  return a;
};
// attach_analysis and edit_analysis WRITE the record of the file they name and do not follow lineage (lineage.ts): a record is
// what was measured on, or entered for, that one file, on its own clock. A copy that is measured or corrected itself gets its own
// record, which then wins over its source's for every reader (the nearest record of the chain; pinned in beatLineage.test.ts).
// The editor's analysis panel addresses a correction made on a time-preserving copy to the measured file (analysis.logic.ts).
defineOp({
  name: 'attach_analysis',
  version: 1,
  internal: true,
  description: 'Attach a measured analysis result (scene cuts or beat grid) produced by the server from the source file.',
  args: z.object({ assetId: z.string(), kind: z.enum(['scenes', 'beats']), method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), times: TimeList, bpm: z.number().nullable().optional(), confidence: z.number().min(0).max(1).nullable().optional(), downbeats: TimeList.optional(), meter: z.number().int().min(2).max(12).nullable().optional() }).strict(),
  apply(d, a, ctx) {
    mustAsset(d, a.assetId);
    const origin = { method: a.method, params: a.params, createdAt: a.createdAt, createdBy: ctx.actor, edited: false };
    const cur = d.analyses[a.assetId] ?? { assetId: a.assetId };
    const times = sortedUnique(a.times);
    // bar starts are beats: anything else in the list (rounding at the edges of the file) is dropped
    const bars = a.kind === 'beats' && a.downbeats ? sortedUnique(a.downbeats).filter((t) => times.some((b) => T.eq(b, t))) : [];
    d.analyses[a.assetId] = a.kind === 'scenes' ? { ...cur, scenes: { origin, cuts: times } } : { ...cur, beats: { origin, bpm: a.bpm ?? null, confidence: a.confidence ?? null, beats: times, ...(bars.length ? { downbeats: bars, meter: a.meter ?? null } : {}) } };
    return { affectedIds: [analysisEntityId(a.assetId)], summary: a.kind === 'scenes' ? `Found ${times.length} scene cuts` : `Found ${times.length} beats${a.bpm ? ` (${a.bpm.toFixed(1)} BPM)` : ''}${bars.length ? `, ${bars.length} bars` : ''}` };
  },
});
defineOp({
  name: 'edit_analysis',
  version: 1,
  description: 'Correct an analysis result by hand: add and/or remove scene cuts or beats (source times of the asset), or replace the whole list. Works without a prior automatic analysis, so the data can also be entered manually. Marks the result as edited.',
  args: z.object({ assetId: z.string(), kind: z.enum(['scenes', 'beats']), add: TimeList.optional(), remove: TimeList.optional(), replace: TimeList.optional(), bpm: z.number().min(20).max(400).nullable().optional(), downbeats: TimeList.nullable().optional().describe('kind=beats: the beats that start a bar (each must be one of the beats after this edit); null clears them. Left out, the stored bar starts that are still beats are kept.'), meter: z.number().int().min(2).max(12).nullable().optional() }).strict(),
  apply(d, a, ctx) {
    const asset = mustAsset(d, a.assetId);
    const cur = d.analyses[a.assetId] ?? { assetId: a.assetId };
    const existing = a.kind === 'scenes' ? cur.scenes?.cuts : cur.beats?.beats;
    let list = a.replace ?? existing ?? [];
    if (a.remove) list = list.filter((t) => !a.remove!.some((r) => T.eq(r, t)));
    if (a.add) list = [...list, ...a.add];
    list = sortedUnique(list);
    if (list.some((t) => T.isNegative(t) || T.lt(asset.duration, t))) throw new OpError('out_of_bounds', 'times must lie inside the media', { assetDuration: asset.duration });
    const prevOrigin = a.kind === 'scenes' ? cur.scenes?.origin : cur.beats?.origin;
    const origin = { ...(prevOrigin ?? { method: 'manual', params: {}, createdAt: 'op', createdBy: ctx.actor }), edited: true };
    if (a.kind === 'scenes' && (a.downbeats !== undefined || a.meter !== undefined)) throw new OpError('invalid_args', 'bar starts and meter belong to beats', { kind: a.kind });
    const isBeat = (t: T.RationalTime) => list.some((b) => T.eq(b, t));
    if (a.downbeats && !a.downbeats.every(isBeat)) throw new OpError('invalid_args', 'every bar start must be one of the beats', {}, 'Add the beat first, or pass it in the same edit.');
    const bars = a.downbeats === null ? [] : a.downbeats ? sortedUnique(a.downbeats) : (cur.beats?.downbeats ?? []).filter(isBeat);
    const meter = a.meter !== undefined ? a.meter : cur.beats?.meter ?? null;
    d.analyses[a.assetId] = a.kind === 'scenes' ? { ...cur, scenes: { origin, cuts: list } } : { ...cur, beats: { origin, bpm: a.bpm !== undefined ? a.bpm : cur.beats?.bpm ?? null, confidence: cur.beats?.confidence ?? null, beats: list, ...(bars.length ? { downbeats: bars, meter } : {}),
      // the sections of built-in music (ADR-0022) are not beats: a correction of the beats leaves them exactly as they are
      ...(cur.beats?.sections ? { sections: cur.beats.sections } : {}) } };
    return { affectedIds: [analysisEntityId(a.assetId)], summary: `Edited ${a.kind === 'scenes' ? 'scene cuts' : 'beats'} (${list.length})` };
  },
});
defineOp({
  name: 'split_at_scenes',
  version: 1,
  description: 'Split a clip (and its linked sound) at every detected scene cut of its source that falls inside the clip, so each shot becomes its own clip. Needs scene analysis of the asset (analyze, or edit_analysis). Cuts are snapped to the nearest timeline frame.',
  args: z.object({ clipId: z.string(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'split at scene cuts');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only media clips have scenes', { clipId: a.clipId });
    // the clip's own file, else the nearest time-preserving source it was made from (an enhanced copy keeps its source's shots)
    const found = sceneCutsFor(d, f.clip.assetId);
    if (!found) throw new OpError('not_found', 'this asset has no scene analysis yet', { assetId: f.clip.assetId }, 'Run the scene analysis first (analyze_asset kind=scenes).');
    const cuts = T.isZero(found.offset) ? found.cuts : found.cuts.map((t) => T.sub(t, found.offset));
    if (f.clip.reverse) throw new OpError('incompatible', 'scene cuts cannot be applied to a clip that plays backwards', { clipId: a.clipId }, 'Split it before reversing, or split by hand.');
    const rate = d.settings.frameRate;
    const clip = f.clip;
    const points = sortedUnique(cuts.filter((t) => T.lt(clip.sourceIn, t) && T.lt(t, sourceEnd(clip))).map((t) => T.snapToFrame(timelineAt(clip, t), rate))).filter((t) => T.lt(clip.start, t) && T.lt(t, clipEnd(clip)));
    const split = getOp('split_clip')!;
    const created: string[] = [];
    let current = clip.id;
    for (const at of points) {
      const r = split.apply(d, { clipId: current, at, includeLinked: a.includeLinked }, ctx);
      created.push(...(r.output!.createdClipIds as string[]));
      current = r.output!.rightClipId as string;
    }
    return { affectedIds: [clip.id, ...created], summary: `Split into ${points.length + 1} shots`, output: { cuts: points, createdClipIds: created, ...(found.assetId !== clip.assetId ? { analysedAssetId: found.assetId } : {}) } };
  },
});

// ---------- sound (SPEC §10) ----------
const audioTrack = (seq: Sequence, trackId: string) => {
  const t = mustTrack(seq, trackId);
  if (t.kind !== 'audio') throw new OpError('incompatible', `track ${trackId} is not an audio track`, { trackId });
  return t;
};
const DEFAULT_TRACK_AUDIO = { gain: 1, pan: 0, duck: null } as const;
defineOp({
  name: 'set_clip_fades',
  version: 1,
  description: 'Set linear fade-in and/or fade-out lengths on an audio clip (0 removes a fade). Together they cannot exceed the clip length. Linked picture is not affected.',
  args: z.object({ clipId: z.string(), fadeIn: RT.optional(), fadeOut: RT.optional() }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'audio') throw new OpError('incompatible', 'fades apply to clips on audio tracks', { clipId: a.clipId }, 'Use the audioClipId returned by add_clip, or get_timeline.');
    const fin = a.fadeIn ?? clip.fadeIn ?? T.ZERO, fout = a.fadeOut ?? clip.fadeOut ?? T.ZERO;
    if (T.isNegative(fin) || T.isNegative(fout) || T.lt(clip.duration, T.add(fin, fout))) throw new OpError('out_of_bounds', 'fades must be non-negative and fit inside the clip', { clipDuration: clip.duration });
    if (T.isZero(fin)) delete clip.fadeIn; else clip.fadeIn = fin;
    if (T.isZero(fout)) delete clip.fadeOut; else clip.fadeOut = fout;
    return { affectedIds: [clip.id], summary: `Fades: in ${fmt(fin)}, out ${fmt(fout)}` };
  },
});
defineOp({
  name: 'set_audio_crossfade',
  version: 1,
  description: 'Crossfade into an audio clip from the clip that ends where it starts on the same track: the earlier clip is extended by the crossfade length (it needs that much unused source after its end) and fades out while this clip fades in. Linear, equal-gain. duration=0 removes it (the earlier clip is shortened back and both fades are cleared).',
  args: z.object({ clipId: z.string(), duration: RT.describe('Crossfade length, frame-aligned') }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'audio') throw new OpError('incompatible', 'crossfades apply to clips on audio tracks', { clipId: a.clipId });
    assertAligned(d, a.duration, 'duration');
    if (T.isNegative(a.duration)) throw new OpError('invalid_args', 'duration must be >= 0');
    // The earlier clip either ends exactly at this clip's start, or already overlaps it by an existing crossfade.
    const prev = track.clips.find((c) => c.type === 'media' && c.id !== clip.id && T.eq(T.sub(clipEnd(c), c.fadeOut ?? T.ZERO), clip.start) && T.lte(c.start, clip.start)) as MediaClip | undefined;
    if (prev?.reverse && !T.isZero(a.duration)) throw new OpError('incompatible', 'a crossfade out of a clip that plays backwards is not supported yet', { clipId: clip.id, previousClipId: prev.id });
    if (!prev) throw new OpError('not_found', 'no audio clip ends where this one starts on the same track', { clipId: clip.id }, 'Move the clips so they touch, then crossfade.');
    if (!T.isZero(a.duration)) { refuseRamped(clip, 'crossfaded'); refuseRamped(prev, 'crossfaded'); }
    const base = T.sub(prev.duration, prev.fadeOut ?? T.ZERO); // length without any existing crossfade tail
    const asset = d.assets[prev.assetId]!;
    const handle = toTimelineSpan(prev, T.sub(asset.duration, T.add(prev.sourceIn, toSourceSpan(prev, base)))); // unused source after the clip, in timeline time at its speed
    if (T.lt(handle, a.duration)) throw new OpError('out_of_bounds', 'the earlier clip does not have enough unused source after its end for this crossfade', { maxDuration: T.frameTime(T.frameIndexAt(handle, d.settings.frameRate), d.settings.frameRate), previousClipId: prev.id }, 'Use at most maxDuration, or trim the end of the earlier clip first.');
    if (T.lt(clip.duration, T.add(a.duration, clip.fadeOut ?? T.ZERO)) || T.lt(base, T.add(prev.fadeIn ?? T.ZERO, T.ZERO))) throw new OpError('out_of_bounds', 'the crossfade is longer than the clip it fades into', { clipDuration: clip.duration });
    prev.duration = T.add(base, a.duration);
    if (T.isZero(a.duration)) { delete prev.fadeOut; delete clip.fadeIn; } else { prev.fadeOut = a.duration; clip.fadeIn = a.duration; }
    sortClips(track);
    return { affectedIds: [prev.id, clip.id], summary: T.isZero(a.duration) ? 'Removed crossfade' : `Crossfade ${fmt(a.duration)}`, output: { previousClipId: prev.id } };
  },
});
defineOp({
  name: 'fit_music',
  version: 1,
  description: 'Make a music clip end with the picture: its end is set to the last beat at or before the end of the picture and titles (or before `to`) — the last bar start when the beat analysis has bar starts — or exactly there when the file has no beat analysis, and it fades out. If the music is shorter than the picture it ends on its own last usable beat and the output says by how much it falls short. The clip must not be linked to a picture.',
  args: z.object({ clipId: z.string(), to: RT.optional().describe('Timeline time to end at; default: the end of the last picture, title or caption clip'), fadeOut: RT.optional().describe('Fade-out length; default one second (at most half the clip)') }).strict(),
  apply(d, a) {
    const { clip, track, seq } = mustClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'audio') throw new OpError('incompatible', 'fit_music applies to a sound clip on a sound track', { clipId: a.clipId });
    if (partnersOf(d, clip).length) throw new OpError('incompatible', 'this sound is linked to a picture; detach it first if it should be fitted on its own', { clipId: clip.id }, 'Use unlink_clip.');
    if (clip.reverse) throw new OpError('incompatible', 'a clip that plays backwards cannot be fitted to beats', { clipId: clip.id });
    refuseRamped(clip, 'fitted to the picture');
    const rate = d.settings.frameRate;
    if (a.to) assertAligned(d, a.to, 'to');
    if (a.fadeOut) assertAligned(d, a.fadeOut, 'fadeOut');
    const pictureEnd = seq.tracks.filter((t) => t.kind !== 'audio').flatMap((t) => t.clips).reduce((m, c) => T.max(m, clipEnd(c)), T.ZERO);
    const target = a.to ?? pictureEnd;
    if (!T.lt(clip.start, target)) throw new OpError('out_of_bounds', a.to ? 'the end must lie after the start of the music' : 'there is no picture, title or caption after the start of this music to fit it to', { clipStart: clip.start, target });
    const asset = d.assets[clip.assetId]!;
    const frame = (t: T.RationalTime) => T.frameTime(T.frameIndexAt(t, rate), rate); // down to a whole frame
    const maxEnd = frame(T.add(clip.start, toTimelineSpan(clip, T.sub(asset.duration, clip.sourceIn))));
    const limit = T.min(target, maxEnd);
    // beats of the source at or after the clip's in-point, as timeline times of this clip (also past its current end): the file's
    // own, or those of the nearest time-preserving source it is a copy of, on the file's own clock (lineage.ts ownBeats). A copy
    // made without a recorded time mapping has none, and is fitted like any file without a beat analysis: exactly to the picture.
    const own = ownBeats(d, clip.assetId);
    const beats = (own?.beats ?? []).filter((b) => T.lt(clip.sourceIn, b)).map((b) => frame(timelineAt(clip, b))).filter((t) => T.lt(clip.start, t) && T.lte(t, limit));
    const lastBeat = beats.length ? beats.reduce((m, t) => T.max(m, t)) : null;
    // With bar starts in the analysis the music ends on the last bar start, which sounds finished where an arbitrary beat does not —
    // unless that bar start lies more than one bar before the last usable beat (bars known for an earlier part of the file only).
    const an = own?.analysis;
    const bars = (own?.downbeats ?? []).filter((b) => T.lt(clip.sourceIn, b)).map((b) => frame(timelineAt(clip, b))).filter((t) => T.lt(clip.start, t) && T.lte(t, limit));
    const lastBar = bars.length ? bars.reduce((m, t) => T.max(m, t)) : null;
    const onBar = !!lastBar && !!lastBeat && beats.filter((t) => T.lt(lastBar, t)).length < (an?.meter ?? 4);
    const end = onBar ? lastBar! : lastBeat ?? limit;
    if (!T.lt(clip.start, end)) throw new OpError('out_of_bounds', 'nothing of the music would remain', { clipId: clip.id });
    assertFree(track, clip.start, end, new Set([clip.id]));
    clip.duration = T.sub(end, clip.start);
    const half = frame(T.rt(BigInt(clip.duration.value), clip.duration.timescale * 2));
    const fade = T.min(a.fadeOut ?? T.frameTime(Math.round(rate.num / rate.den), rate), half);
    if (T.isZero(fade)) delete clip.fadeOut; else clip.fadeOut = fade;
    clampFades(clip);
    const shortBy = T.lt(maxEnd, target) ? T.sub(target, end) : T.ZERO;
    return { affectedIds: [clip.id], summary: `Music ends at ${fmt(end)}${onBar ? ' (on the first beat of a bar)' : beats.length ? ' (on a beat)' : ''}${T.isZero(shortBy) ? '' : `; ${fmt(shortBy)} short of the picture`}`, output: { end, onBeat: beats.length > 0, onBar, fadeOut: clip.fadeOut ?? T.ZERO, shortBy } };
  },
});
defineOp({
  name: 'set_track_audio',
  version: 1,
  description: 'Set an audio track\'s volume (linear gain, 1 = unchanged), pan (-1 left … 1 right) and/or mute.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), gain: z.number().min(0).max(4).optional(), pan: z.number().min(-1).max(1).optional(), muted: z.boolean().optional() }).strict(),
  apply(d, a) {
    const t = audioTrack(seqOf(d, a.sequenceId), a.trackId);
    if (a.gain !== undefined || a.pan !== undefined) t.audio = { ...(t.audio ?? DEFAULT_TRACK_AUDIO), ...(a.gain !== undefined ? { gain: a.gain } : {}), ...(a.pan !== undefined ? { pan: a.pan } : {}) };
    if (a.muted !== undefined) t.muted = a.muted;
    return { affectedIds: [t.id], summary: `Track ${t.name}: gain ${(t.audio?.gain ?? 1).toFixed(2)}, pan ${(t.audio?.pan ?? 0).toFixed(2)}${t.muted ? ', muted' : ''}` };
  },
});
defineOp({
  name: 'set_ducking',
  version: 1,
  description: 'Automatically lower an audio track (e.g. music) while other tracks carry speech. Speech = the transcript phrases of the clips on the source tracks; a clip without a transcript counts as speech for its whole length. sourceTrackIds=null turns ducking off.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), sourceTrackIds: z.array(z.string()).min(1).max(8).nullable(), reductionDb: z.number().min(1).max(40).optional(), attackMs: z.number().int().min(0).max(2000).optional(), releaseMs: z.number().int().min(0).max(5000).optional() }).strict(),
  apply(d, a) {
    const seq = seqOf(d, a.sequenceId);
    const t = audioTrack(seq, a.trackId);
    if (a.sourceTrackIds === null) {
      if (t.audio) t.audio = { ...t.audio, duck: null };
      return { affectedIds: [t.id], summary: `Ducking off on ${t.name}` };
    }
    for (const id of a.sourceTrackIds) {
      const st = seq.tracks.find((x) => x.id === id);
      if (!st || st.kind !== 'audio' || st.id === t.id) throw new OpError('invalid_args', `source track ${id} must be another audio track`, { sourceTrackId: id });
    }
    const prev = t.audio?.duck;
    t.audio = { ...(t.audio ?? DEFAULT_TRACK_AUDIO), duck: { sourceTrackIds: a.sourceTrackIds, reductionDb: a.reductionDb ?? prev?.reductionDb ?? 12, attackMs: a.attackMs ?? prev?.attackMs ?? 150, releaseMs: a.releaseMs ?? prev?.releaseMs ?? 400 } };
    return { affectedIds: [t.id], summary: `Ducking ${t.name} by ${t.audio.duck!.reductionDb} dB under speech` };
  },
});
defineOp({
  name: 'set_loudness_target',
  version: 1,
  description: 'Set (or clear with target=null) the export loudness target in LUFS, e.g. -14 for social platforms, -16 for podcasts, -23 for EBU broadcast. Export then applies ONE static gain to the whole mix and keeps true peak under the ceiling; it does not compress dynamics.',
  args: z.object({ target: z.number().min(-40).max(-5).nullable(), truePeak: z.number().min(-9).max(0).optional() }).strict(),
  apply(d, a) {
    if (a.target === null) delete d.settings.loudness; else d.settings.loudness = { target: a.target, truePeak: a.truePeak ?? d.settings.loudness?.truePeak ?? -1 };
    return { affectedIds: [d.id], summary: a.target === null ? 'Loudness normalisation off' : `Loudness target ${a.target} LUFS` };
  },
});

defineOp({
  name: 'set_timeline_behaviour',
  version: 1,
  description: 'Turn the main-track magnet and ripple delete on or off for this project (settings.timeline); a value left out keeps its setting. They choose what the editor does, not what operations do: with rippleDelete, Delete on the main track (the bottom-most picture track) sends ripple_delete_clips and Shift+Delete keeps the gap (delete_clip); with mainMagnet, clips dragged on the main track stay together. A project that never set them has both off; new projects start with both on. Agents choose ripple_delete_clips or delete_clip themselves either way.',
  args: z.object({ mainMagnet: z.boolean().optional(), rippleDelete: z.boolean().optional() }).strict(),
  apply(d, a) {
    if (a.mainMagnet === undefined && a.rippleDelete === undefined) throw new OpError('invalid_args', 'nothing to change: give mainMagnet or rippleDelete');
    const now = timelineBehaviour(d);
    const next = { mainMagnet: a.mainMagnet ?? now.mainMagnet, rippleDelete: a.rippleDelete ?? now.rippleDelete };
    d.settings.timeline = next;
    const word = (on: boolean) => (on ? 'on' : 'off');
    return { affectedIds: [d.id], summary: `Timeline: main-track magnet ${word(next.mainMagnet)}, ripple delete ${word(next.rippleDelete)}`, output: { timeline: next } };
  },
});

// ---------- sound effects (ADR-0010, SPEC §10) ----------
// Per-clip DSP effects of sound clips (voices, 8-bit, echo, reverb, bass boost, stereo width). The one implementation of every
// effect is packages/engine/src/audiofx, heard the same in preview, browser export and server export; these operations only
// keep the list. Lists are kept in the fixed processing order (sortAudioFx): users choose effects, never their order. Undo is the
// generic restore of the clips' before-states (restore_entities). Not voice conversion: that is a separate, labelled provider job.
const FX_CATALOG_HINT = 'Call list_catalog for the sound effects (audioEffects), their parameters and the ready-made presets (audioPresets).';
type SoundTarget = { track: Track; clip: MediaClip };
const isVoice = (f: { type: string }) => findAudioEffect(f.type)?.exclusive === 'voice';
/**
 * The sound clips an edit of sound effects applies to. A sound clip (a media clip on a sound track whose file has sound) is its
 * own target, and the other sound clips linked to it come along unless includeLinked=false. A picture clip has no sound of its
 * own: it resolves to the sound clips linked to it. Only these targets change, so only their tracks need to be unlocked
 * (unlockedTargets); a picture on a locked track does not stop an edit of its sound.
 */
function soundTargets(d: ProjectDocument, clipId: string, includeLinked?: boolean): SoundTarget[] {
  const f = findClip(d, clipId);
  if (!f) throw new OpError('not_found', `clip ${clipId} not found`, { clipId }, 'Call get_timeline to list current clip ids.');
  const sounding = (t: Track, c: Clip): c is MediaClip => c.type === 'media' && t.kind === 'audio' && !!d.assets[c.assetId]?.audio;
  const out: SoundTarget[] = sounding(f.track, f.clip) ? [{ track: f.track, clip: f.clip }] : [];
  if (includeLinked !== false) for (const p of partnersOf(d, f.clip)) if (sounding(p.track, p.clip)) out.push(p);
  if (!out.length) throw new OpError('incompatible', 'this clip has no sound clip', { clipId },
    includeLinked === false && f.track.kind !== 'audio' ? 'A picture clip has no sound of its own: leave includeLinked on to reach its linked sound, or give the sound clip.' : 'Give the sound clip, or a picture clip that is linked to one (get_timeline lists the clips of the sound tracks).');
  return out;
}
const unlockedTargets = <X extends SoundTarget>(targets: X[]): X[] => {
  for (const t of targets) if (t.track.locked) throw new OpError('track_locked', `track ${t.track.id} is locked`, { trackId: t.track.id, clipId: t.clip.id });
  return targets;
};
/** A sound effect on one of the clip's sound targets (a picture clip finds the effect on its linked sound). */
function soundEffect(d: ProjectDocument, clipId: string, effectId: string): SoundTarget & { index: number } {
  for (const t of soundTargets(d, clipId)) {
    const index = (t.clip.audioFx ?? []).findIndex((x) => x.id === effectId);
    if (index >= 0) return { ...t, index };
  }
  throw new OpError('not_found', `sound effect ${effectId} not found on clip ${clipId}`, { effectId, clipId }, 'get_timeline lists the sound effects of each sound clip (audioFx) with their ids.');
}
/** Parameters of a sound effect, completed with its defaults and checked against its schema. */
function parseAudioFx(type: string, params: unknown): AudioFxParams {
  const def = findAudioEffect(type);
  if (!def) throw new OpError('not_found', `sound effect "${type}" does not exist`, { type, available: AUDIO_EFFECTS.map((e) => e.id) }, FX_CATALOG_HINT);
  const r = def.params.safeParse(params ?? {});
  if (!r.success) throw new OpError('invalid_args', `invalid parameters for sound effect ${type}`, { issues: r.error.issues.slice(0, 8) }, 'Call list_catalog for the parameter schema of each sound effect (audioEffects).');
  return r.data as AudioFxParams;
}
/** Store a clip's list in the processing order; an empty list drops the field. */
function setAudioFx(clip: MediaClip, list: AudioFxInstance[]) {
  if (list.length) clip.audioFx = sortAudioFx(list); else delete clip.audioFx;
}
/**
 * The longest ring-out after the end of these clips (seconds, three decimals), as the engine plans it: an echo or a reverb plays on
 * past the clip end, cut at the end of the video. Null only where no engine is loaded (core on its own; see queries.ts soundTails).
 */
function tailSecondsOf(d: ProjectDocument, clipIds: string[]): number | null {
  const tails = soundTails(d);
  if (!tails) return null;
  return Number(Math.max(0, ...clipIds.map((id) => tails.get(id)?.seconds ?? 0)).toFixed(3));
}
const fxOut = (clip: MediaClip) => (clip.audioFx ?? []).map((x) => ({ clipId: clip.id, effectId: x.id, params: x.params }));

defineOp({
  name: 'add_audio_effect',
  version: 1,
  description: 'Add a sound effect to a sound clip: a voice cleanup effect (cleanup.dehum, cleanup.denoise, cleanup.speech; usually set all at once from a measurement with clean_voice), a character voice (voice.telephone, voice.megaphone, voice.radio, voice.robot), texture.8bit, space.echo, space.reverb (room, hall, cave, bathroom), tone.bassboost or utility.width. Give the sound clip, or a picture clip to put it on the sound linked to it (includeLinked=false keeps a sound clip\'s linked sound clips out). Unspecified parameters take the effect\'s defaults; amount 0 is the dry sound. Effects always run in a fixed order whatever order they were added in; a clip has each effect at most once and one character voice. An echo or reverb rings on past the end of the clip and is cut at the end of the video (the video is never lengthened). These are DSP effects, not voice conversion. Not yet for a sound that keeps its pitch at another speed or changes speed gradually. Discover effects and presets with list_catalog (audioEffects, audioPresets).',
  args: z.object({ clipId: z.string(), type: z.string().min(1).max(48), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const params = parseAudioFx(a.type, a.params);
    const def = findAudioEffect(a.type)!;
    const targets = unlockedTargets(soundTargets(d, a.clipId, a.includeLinked));
    const effects: { clipId: string; effectId: string; params: AudioFxParams }[] = [];
    for (const { clip } of targets) {
      const list = clip.audioFx ?? [];
      const same = list.find((x) => x.type === a.type);
      if (same) throw new OpError('invalid_args', `this clip already has the sound effect ${a.type}`, { clipId: clip.id, effectId: same.id }, 'Change it with update_audio_effect (effectId given), or remove it first.');
      const voice = def.exclusive === 'voice' ? list.find(isVoice) : undefined;
      if (voice) throw new OpError('invalid_args', `this clip already has a character voice (${voice.type})`, { clipId: clip.id, effectId: voice.id }, 'A clip has one character voice: remove the other one first (remove_audio_effect), or replace the whole list in one step with apply_audio_preset.');
      if (list.length >= MAX_AUDIO_FX) throw new OpError('out_of_bounds', `a clip can carry at most ${MAX_AUDIO_FX} sound effects`, { clipId: clip.id });
      const fx: AudioFxInstance = { id: ctx.newId('afx'), type: a.type, enabled: a.enabled ?? true, params: { ...params } };
      setAudioFx(clip, [...list, fx]);
      refuseFxTimeMap(clip, 'effects');
      effects.push({ clipId: clip.id, effectId: fx.id, params: fx.params });
    }
    const ids = targets.map((t) => t.clip.id);
    return { affectedIds: ids, summary: `Added sound effect ${a.type}`, output: { effects, tailSeconds: tailSecondsOf(d, ids) } };
  },
});
defineOp({
  name: 'update_audio_effect',
  version: 1,
  description: 'Change parameters of a sound effect (unspecified ones are kept), or turn it off and on again (enabled). Give the sound clip, or a picture clip whose linked sound carries the effect; get_timeline lists each sound clip\'s effects (audioFx) with their ids. The order of effects is fixed and cannot be changed.',
  args: z.object({ clipId: z.string(), effectId: z.string(), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional() }).strict(),
  apply(d, a) {
    if (a.params === undefined && a.enabled === undefined) throw new OpError('invalid_args', 'give params and/or enabled', { effectId: a.effectId });
    const t = unlockedTargets([soundEffect(d, a.clipId, a.effectId)])[0]!;
    const list = [...t.clip.audioFx!];
    const fx = { ...list[t.index]! };
    if (a.params) fx.params = parseAudioFx(fx.type, { ...fx.params, ...a.params });
    if (a.enabled !== undefined) fx.enabled = a.enabled;
    list[t.index] = fx;
    setAudioFx(t.clip, list);
    refuseFxTimeMap(t.clip, 'effects');
    return { affectedIds: [t.clip.id], summary: `Updated sound effect ${fx.type}${fx.enabled ? '' : ' (off)'}`, output: { effects: [{ clipId: t.clip.id, effectId: fx.id, params: fx.params }], enabled: fx.enabled, tailSeconds: tailSecondsOf(d, [t.clip.id]) } };
  },
});
defineOp({
  name: 'remove_audio_effect',
  version: 1,
  description: 'Remove a sound effect from a sound clip (or from the sound linked to a picture clip).',
  args: z.object({ clipId: z.string(), effectId: z.string() }).strict(),
  apply(d, a) {
    const t = unlockedTargets([soundEffect(d, a.clipId, a.effectId)])[0]!;
    const type = t.clip.audioFx![t.index]!.type;
    setAudioFx(t.clip, t.clip.audioFx!.filter((_, k) => k !== t.index));
    return { affectedIds: [t.clip.id], summary: `Removed sound effect ${type}`, output: { clipId: t.clip.id, effects: fxOut(t.clip), tailSeconds: tailSecondsOf(d, [t.clip.id]) } };
  },
});
defineOp({
  name: 'apply_audio_preset',
  version: 1,
  description: 'Give a sound clip one of the ready-made sound presets (list_catalog → audioPresets: telephone, megaphone, radio, robot, 8bit, room, hall, cave, bathroom, stadium, thoughts): its whole list of sound effects is replaced in one step (one undo restores the old list). presetId=null removes every sound effect. Give the sound clip, or a picture clip to set the sound linked to it.',
  args: z.object({ clipId: z.string(), presetId: z.string().min(1).max(48).nullable(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const preset = a.presetId === null ? null : AUDIO_PRESETS.find((p) => p.id === a.presetId);
    if (a.presetId !== null && !preset) throw new OpError('not_found', `sound preset "${a.presetId}" does not exist`, { presetId: a.presetId, available: AUDIO_PRESETS.map((p) => p.id) }, FX_CATALOG_HINT);
    const targets = unlockedTargets(soundTargets(d, a.clipId, a.includeLinked));
    if (!preset && targets.every((t) => !t.clip.audioFx?.length)) throw new OpError('invalid_args', 'this clip has no sound effects to remove', { clipId: a.clipId });
    const effects: { clipId: string; effectId: string; params: AudioFxParams }[] = [];
    for (const { clip } of targets) {
      setAudioFx(clip, (preset?.effects ?? []).map((e) => ({ id: ctx.newId('afx'), type: e.type, enabled: true, params: parseAudioFx(e.type, e.params) })));
      refuseFxTimeMap(clip, 'effects');
      effects.push(...fxOut(clip));
    }
    const ids = targets.map((t) => t.clip.id);
    return { affectedIds: ids, summary: preset ? `Sound preset ${preset.id}` : 'Removed all sound effects', output: { presetId: preset?.id ?? null, effects, tailSeconds: tailSecondsOf(d, ids) } };
  },
});
defineOp({
  name: 'copy_audio_effects',
  version: 1,
  description: 'Copy the sound effects of one sound clip to other sound clips (picture clips stand for the sound linked to them), as new instances with their own ids, so noise in effects such as telephone hiss or radio static differs per clip. replace=true replaces each target\'s list; otherwise the copies join it, and an effect of a type the target already has, and its character voice when a voice is copied, are replaced by the copy. At most 200 targets.',
  args: z.object({ fromClipId: z.string(), toClipIds: z.array(z.string()).min(1).max(200), replace: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const sources = soundTargets(d, a.fromClipId);
    const src = sources[0]!.clip;
    if (src.id !== a.fromClipId && sources.length > 1) throw new OpError('incompatible', 'this picture clip is linked to more than one sound clip', { clipId: a.fromClipId, soundClipIds: sources.map((s) => s.clip.id) }, 'Give the sound clip to copy from.');
    if (!src.audioFx?.length) throw new OpError('invalid_args', 'the clip to copy from has no sound effects', { clipId: src.id }, 'Add sound effects to it first (add_audio_effect or apply_audio_preset).');
    const targets = new Map<string, SoundTarget>();
    const own = (clipId: string) => new OpError('invalid_args', 'a clip cannot take its own sound effects', { clipId }, 'Leave the clip to copy from out of toClipIds.');
    for (const id of a.toClipIds) {
      const found = soundTargets(d, id);
      const direct = found[0]!.clip.id === id; // a sound clip stands for itself; a picture clip for the sounds linked to it
      if (direct && id === src.id) throw own(id);
      for (const t of direct ? [found[0]!] : found) if (t.clip.id !== src.id) targets.set(t.clip.id, t); // the source, reached through a picture, is left out
    }
    if (!targets.size) throw own(a.toClipIds[0]!); // only the source's own picture was given
    const voiceCopied = src.audioFx.some(isVoice);
    const effects: { clipId: string; effectId: string; params: AudioFxParams }[] = [];
    for (const { clip } of unlockedTargets([...targets.values()])) {
      const copies = src.audioFx.map((x) => ({ ...structuredClone(x), id: ctx.newId('afx') }));
      const kept = a.replace ? [] : (clip.audioFx ?? []).filter((x) => !copies.some((c) => c.type === x.type) && !(voiceCopied && isVoice(x)));
      if (kept.length + copies.length > MAX_AUDIO_FX) throw new OpError('out_of_bounds', `a clip can carry at most ${MAX_AUDIO_FX} sound effects`, { clipId: clip.id }, 'Pass replace=true to replace its list.');
      setAudioFx(clip, [...kept, ...copies]);
      refuseFxTimeMap(clip, 'effects');
      effects.push(...fxOut(clip).filter((e) => copies.some((c) => c.id === e.effectId)));
    }
    const ids = [...targets.keys()];
    return { affectedIds: ids, summary: `Copied ${src.audioFx.length} sound effect(s) to ${ids.length} clip(s)`, output: { clipIds: ids, effects, tailSeconds: tailSecondsOf(d, ids) } };
  },
});

defineOp({
  name: 'clean_voice',
  version: 1,
  description: 'Voice cleanup «ניקוי קול» in one step (ADR-0013): hum removal (cleanup.dehum) when mainsHz is given, noise reduction (cleanup.denoise) with the measured noise profile, and the speech enhancer (cleanup.speech: low cut, presence, phrase leveller, peak ceiling), all set from one strength 0..1. Get profile, source and mainsHz from measure_voice, which returns this op ready to send; without a profile a generic quiet floor is used. strength 0 removes the cleanup. Other sound effects are kept; existing cleanup effects are replaced in place with the same ids; fine-tune afterwards with update_audio_effect. Give the sound clip, or a picture clip to clean the sound linked to it. Steady noise only (hiss, fan, room tone), not other voices or music; no AI model; measured, not yet listened to. Not yet for a sound that keeps its pitch at another speed or changes speed gradually.',
  args: z.object({
    clipId: z.string(), includeLinked: z.boolean().optional(),
    strength: z.number().min(0).max(1).default(0.6).describe('0 removes the cleanup, 1 is the strongest; measure_voice recommends one'),
    profile: z.string().regex(NOISE_PROFILE_PATTERN).optional().describe('noise profile from measure_voice (48 characters); omitted = a generic quiet floor'),
    source: z.string().max(64).optional().describe('asset id the profile was measured on'),
    mainsHz: z.enum(['50', '60']).nullable().optional().describe('mains hum found by measure_voice; null or omitted = no hum removal'),
    denoise: z.boolean().optional().describe('false leaves noise reduction out'),
    speech: z.boolean().optional().describe('false leaves the speech enhancer out'),
  }).strict(),
  apply(d, a, ctx) {
    const wanted = cleanVoiceEffects({ strength: a.strength, profile: a.profile, source: a.source, mainsHz: a.mainsHz, denoise: a.denoise, speech: a.speech });
    const targets = unlockedTargets(soundTargets(d, a.clipId, a.includeLinked));
    const effects: { clipId: string; effectId: string; type: string; params: AudioFxParams }[] = [];
    const removed: { clipId: string; effectId: string; type: string }[] = [];
    for (const { clip } of targets) {
      const list = clip.audioFx ?? [];
      const kept = list.filter((x) => !isCleanupType(x.type)), old = list.filter((x) => isCleanupType(x.type));
      const next: AudioFxInstance[] = wanted.map((w) => ({ id: old.find((x) => x.type === w.type)?.id ?? ctx.newId('afx'), type: w.type, enabled: true, params: parseAudioFx(w.type, w.params) }));
      if (kept.length + next.length > MAX_AUDIO_FX) throw new OpError('out_of_bounds', `a clip can carry at most ${MAX_AUDIO_FX} sound effects`, { clipId: clip.id });
      for (const x of old) if (!next.some((y) => y.id === x.id)) removed.push({ clipId: clip.id, effectId: x.id, type: x.type });
      setAudioFx(clip, [...kept, ...next]);
      refuseFxTimeMap(clip, 'effects');
      for (const y of next) effects.push({ clipId: clip.id, effectId: y.id, type: y.type, params: y.params });
    }
    const ids = targets.map((t) => t.clip.id);
    return { affectedIds: ids, summary: wanted.length ? `Voice cleanup at strength ${a.strength}` : 'Removed the voice cleanup', output: { effects, removed, tailSeconds: tailSecondsOf(d, ids) } };
  },
});

// ---------- effects, blend, mask, transitions (SPEC §8, §13) ----------
/** A picture, title or adjustment clip (the effect operations' rule). Exported for keyframeOps.ts. */
export const pictureClip = (d: ProjectDocument, clipId: string) => {
  const f = mustClip(d, clipId);
  if (f.clip.type === 'caption' || f.track.kind === 'audio') throw new OpError('incompatible', 'effects, blends, masks and transitions apply to picture, title and adjustment clips', { clipId });
  return f;
};
/**
 * The parameters a failed effect parse names, so that the refusal says which one is wrong (the editor words it per parameter,
 * packages/i18n/src/refusals.ts): the top-level name of each issue and the names the schema does not know; at most 8, each cut to 48 characters.
 */
const badParamNames = (issues: readonly { code?: string; path?: readonly PropertyKey[]; keys?: readonly string[] }[] | undefined): string[] =>
  [...new Set((issues ?? []).flatMap((i) => (i.code === 'unrecognized_keys' ? (i.keys ?? []) : i.path?.length ? [String(i.path[0])] : [])))].slice(0, 8).map((k) => k.slice(0, 48));
/** An effect's parameters through its schema, refused per parameter in the words of add_effect. Exported for keyframeOps.ts. */
export const parseEffect = (type: string, params: unknown) => {
  if (!findEffect(type)) throw new OpError('not_found', `effect "${type}" does not exist`, { type, available: EFFECTS.map((e) => e.id) }, 'Call list_catalog for the available effects and their parameters.');
  try { return effectParams(type, params); } catch (e: any) {
    const names = badParamNames(e.issues);
    throw new OpError('invalid_args', `invalid parameters for ${type}${names.length ? `: ${names.join(', ')}` : ''}`, { issues: e.issues?.slice(0, 8) }, 'Call list_catalog for the parameter schema.');
  }
};
/** A color.lut effect that names a table must name a colour table (asset of kind 'lut') of this project. */
const assertLutRef = (d: ProjectDocument, type: string, params: Record<string, unknown>) => {
  if (type !== 'color.lut' || typeof params.lut !== 'string' || params.lut === '') return;
  // An own entry of the library only: an id such as "__proto__" or "constructor" names nothing, it must not find Object's own members.
  const known = Object.hasOwn(d.assets, params.lut) ? d.assets[params.lut] : undefined;
  if (known?.kind === 'lut') return;
  throw new OpError('not_found', known ? `"${known.name.slice(0, 60)}" is a ${known.kind} file, not a colour table (LUT)` : `colour table ${params.lut} is not in this project's library`, { lut: params.lut, available: lutAssets(d).slice(0, 100).map((x) => ({ id: x.id, name: x.name })) }, 'Upload a .cube file to the project library first; get_summary lists the colour tables (assets of kind lut) with their ids.');
};
/**
 * Where an effect of `type` goes in `list` (which must not contain the effect being moved): a time effect only first and only
 * one per clip; every other effect never before it.
 */
export function effectSlot(list: readonly EffectInstance[], type: string, requested: number | undefined): number {
  const timeFirst = list.length > 0 && isTimeEffect(list[0]!.type) ? 1 : 0;
  if (isTimeEffect(type)) {
    if (list.some((e) => isTimeEffect(e.type))) throw new OpError('incompatible', 'a clip can carry one time effect (echo, time split, shutter or stutter)', { effects: list.filter((e) => isTimeEffect(e.type)).map((e) => e.type) }, 'Remove the time effect the clip has, or put this one on another clip.');
    return 0;
  }
  return Math.max(timeFirst, Math.min(requested ?? list.length, list.length));
}
defineOp({
  name: 'apply_look',
  version: 1,
  description: 'Give a picture or title clip one of the named colour looks (see list_catalog → looks). A look is a setting of the color.grade effect: the clip\'s existing colour grade is replaced, or one is added first in its effect list (after a time effect, which always stays first); every value stays editable with update_effect. Needs a graphics adapter (WebGPU) to be shown and exported.',
  args: z.object({ clipId: z.string(), lookId: z.string() }).strict(),
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    refuseAdjustmentEffect(clip, 'color.grade');
    const params = lookParams(a.lookId);
    if (!params) throw new OpError('not_found', `colour look "${a.lookId}" does not exist`, { lookId: a.lookId }, 'Call list_catalog for the looks.');
    const list = [...(clip.effects ?? [])];
    const at = list.findIndex((e) => e.type === 'color.grade');
    let effectId: string;
    if (at >= 0) { list[at] = { ...list[at]!, enabled: true, params }; effectId = list[at]!.id; }
    else {
      if (list.length >= 16) throw new OpError('out_of_bounds', 'a clip can carry at most 16 effects', { clipId: clip.id });
      effectId = ctx.newId('fx');
      list.splice(effectSlot(list, 'color.grade', 0), 0, { id: effectId, type: 'color.grade', enabled: true, params });
    }
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Applied colour look ${a.lookId}`, output: { effectId, params } };
  },
});
const GRADE_KEYS = ['exposure', 'temperature', 'tint', 'contrast', 'saturation', 'shadows', 'highlights', 'fade'] as const;
defineOp({
  name: 'set_colour_grade',
  version: 1,
  description: 'Set the values of a picture or title clip\'s colour grade (color.grade) directly, where apply_look would put it: the clip\'s first colour grade is replaced in place (same id, turned on), or one is added first in its effect list (after a time effect). mode replace (default): values not given return to their defaults; merge: they are kept. Values out of range are refused. Used by colour match and auto balance (match_colour returns this op); every value stays editable with update_effect. A value animated with keyframes would ignore a fixed setting, so it is refused unless dropKeyframes=true, which removes those keyframes. Needs a graphics adapter (WebGPU) to be shown and exported.',
  args: z.object({
    clipId: z.string(),
    params: z.object({ exposure: z.number(), temperature: z.number(), tint: z.number(), contrast: z.number(), saturation: z.number(), shadows: z.number(), highlights: z.number(), fade: z.number() }).partial().strict(),
    mode: z.enum(['replace', 'merge']).default('replace').describe('replace: values not given return to their defaults; merge: they are kept'),
    dropKeyframes: z.boolean().optional(),
  }).strict(),
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    const list = [...(clip.effects ?? [])];
    const at = list.findIndex((e) => e.type === 'color.grade');
    const old = at >= 0 ? list[at]! : undefined;
    const params = parseEffect('color.grade', { ...(a.mode === 'merge' && old ? old.params : {}), ...a.params });
    const keyed = Object.keys(old?.keyframes ?? {}).filter((k) => (GRADE_KEYS as readonly string[]).includes(k));
    const clash = a.mode === 'merge' ? keyed.filter((k) => k in a.params) : keyed;
    if (clash.length && !a.dropKeyframes) throw new OpError('incompatible', 'these colour values are animated with keyframes, so a fixed setting would be ignored', { clipId: clip.id, params: clash }, 'Pass dropKeyframes=true to replace the animation with this setting, or change the keyframes with set_effect_keyframe.');
    let effectId: string;
    if (old) {
      const { keyframes, ...rest } = old;
      const kept = Object.entries(keyframes ?? {}).filter(([k]) => !clash.includes(k));
      list[at] = { ...rest, enabled: true, params, ...(kept.length ? { keyframes: Object.fromEntries(kept) } : {}) };
      effectId = old.id;
    } else {
      if (list.length >= 16) throw new OpError('out_of_bounds', 'a clip can carry at most 16 effects', { clipId: clip.id });
      effectId = ctx.newId('fx');
      list.splice(effectSlot(list, 'color.grade', 0), 0, { id: effectId, type: 'color.grade', enabled: true, params });
    }
    clip.effects = list;
    return { affectedIds: [clip.id], summary: 'Set colour grade', output: { effectId, params, droppedKeyframes: clash } };
  },
});

defineOp({
  name: 'apply_lut',
  version: 1,
  checksOwnIds: ['assetId'], // assertLutRef: Object.hasOwn, and the error lists the tables there are
  description: 'Give a picture or title clip a colour table (a 3D LUT imported from a .cube file into the project library; get_summary lists them as assets of kind lut). Sets the clip\'s single color.lut effect: an existing one is replaced (and re-enabled), otherwise one is added at the end of its effect list. intensity 0..1 mixes the table with the original picture (default 1; when replacing, the current value is kept unless given). Needs a graphics adapter (WebGPU) to be shown and exported.',
  args: z.object({ clipId: z.string(), assetId: z.string().min(1).max(64), intensity: z.number().min(0).max(1).optional() }).strict(),
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    refuseAdjustmentEffect(clip, 'color.lut');
    const list = [...(clip.effects ?? [])];
    const at = list.findIndex((e) => e.type === 'color.lut');
    const params = parseEffect('color.lut', { lut: a.assetId, intensity: a.intensity ?? (at >= 0 ? list[at]!.params.intensity : undefined) });
    assertLutRef(d, 'color.lut', params);
    let effectId: string;
    if (at >= 0) {
      const { keyframes, ...rest } = list[at]!;
      // An explicit intensity replaces an animated one; otherwise the animation is kept.
      list[at] = { ...rest, enabled: true, params, ...(keyframes && a.intensity === undefined ? { keyframes } : {}) };
      effectId = list[at]!.id;
    } else {
      if (list.length >= 16) throw new OpError('out_of_bounds', 'a clip can carry at most 16 effects', { clipId: clip.id });
      effectId = ctx.newId('fx');
      list.splice(effectSlot(list, 'color.lut', list.length), 0, { id: effectId, type: 'color.lut', enabled: true, params });
    }
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Applied colour table "${d.assets[a.assetId]!.name.slice(0, 60)}"`, output: { effectId, params } };
  },
});

defineOp({
  name: 'add_effect',
  version: 1,
  checksOwnIds: ['lut'], // assertLutRef: Object.hasOwn, and the error lists the tables there are
  description: 'Add an effect to a picture or title clip. Effects run in list order on the clip after it is placed (with its transform and opacity), before its mask, transition and blend mode. A time effect (time.*) is always first, and a clip carries at most one. Unspecified parameters take the effect\'s defaults. Discover effects with list_catalog.',
  args: z.object({ clipId: z.string(), type: z.string(), params: z.record(z.string(), z.unknown()).optional(), index: z.number().int().min(0).optional() }).strict(),
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    refuseAdjustmentEffect(clip, a.type);
    const list = [...(clip.effects ?? [])];
    if (list.length >= 16) throw new OpError('out_of_bounds', 'a clip can carry at most 16 effects', { clipId: clip.id });
    const fx = { id: ctx.newId('fx'), type: a.type, enabled: true, params: parseEffect(a.type, a.params) };
    assertLutRef(d, fx.type, fx.params);
    list.splice(effectSlot(list, a.type, a.index), 0, fx);
    refuseFollowTimeEffect(clip, list);
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Added effect ${a.type}`, output: { effectId: fx.id, params: fx.params } };
  },
});
/** A clip that follows a motion track (ADR-0015) cannot have a time effect as its first enabled effect (wave 1: the follow is resolved per frame, not per earlier picture). */
const refuseFollowTimeEffect = (clip: Clip, list: readonly EffectInstance[]) => {
  const first = list.find((e) => e.enabled);
  if (clip.follow && first && isTimeEffect(first.type)) throw new OpError('incompatible', FOLLOW_TIME_EFFECT, { clipId: clip.id, effect: first.type }, 'Detach the clip from its motion track first (set_clip_follow follow=null), or put the time effect on another clip.');
};
/** The index of an effect on a clip, refused when it is not there. Exported for keyframeOps.ts. */
export const mustEffect = (clip: Clip, effectId: string) => {
  const i = (clip.effects ?? []).findIndex((e) => e.id === effectId);
  if (i < 0) throw new OpError('not_found', `effect ${effectId} not found on clip ${clip.id}`, { effectId, clipId: clip.id });
  return i;
};
defineOp({
  name: 'update_effect',
  version: 1,
  checksOwnIds: ['lut'], // assertLutRef: Object.hasOwn, and the error lists the tables there are
  description: 'Change parameters of an effect on a clip (unspecified ones are kept), bypass or re-enable it, or move it to another position in the clip\'s effect order. A time effect (time.*) stays first; no other effect can move before it.',
  args: z.object({ clipId: z.string(), effectId: z.string(), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), index: z.number().int().min(0).optional() }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const list = [...clip.effects!];
    const fx = { ...list[i]! };
    refuseAdjustmentEffect(clip, fx.type); // changed or moved, it is still an effect the adjustment may carry
    if (a.params) { fx.params = parseEffect(fx.type, { ...fx.params, ...a.params }); assertLutRef(d, fx.type, fx.params); }
    if (a.enabled !== undefined) fx.enabled = a.enabled;
    list.splice(i, 1);
    list.splice(effectSlot(list, fx.type, a.index ?? i), 0, fx);
    refuseFollowTimeEffect(clip, list);
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Updated effect ${fx.type}${a.enabled === false ? ' (bypassed)' : ''}`, output: { params: fx.params } };
  },
});
const FxKeyTarget = { clipId: z.string(), effectId: z.string(), param: z.string().max(48), time: RT.describe('Offset from the clip start (frame-aligned)') };
defineOp({
  name: 'set_effect_keyframe',
  version: 1,
  description: 'Animate a numeric effect parameter: add or replace a keyframe at a clip-local time. The first key on a parameter starts animating it; between keys the value is interpolated with the easing (curve) of the earlier key, one of list_catalog → curves or \'bezier\' with four handles; left out, an existing key keeps its curve, and a new key inside a segment with a newer curve keeps that curve\'s shape (output.split). Curves that turn back are refused on parameters that cannot follow the beat (brightness and colour). list_catalog shows each effect\'s parameters and ranges.',
  args: z.object({ ...FxKeyTarget, value: z.number(), easing: z.enum(EASINGS).optional().describe('Default linear; left out, an existing key keeps its curve'), bezier: CurveHandlesSchema.optional().describe("The four handles [x1, y1, x2, y2] of a custom curve, only with easing 'bezier' (list_catalog → curves)") }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const fx = { ...clip.effects![i]! };
    if (!animatableParams(fx.type).includes(a.param)) throw new OpError('invalid_args', `"${a.param}" is not a numeric parameter of ${fx.type}`, { animatable: animatableParams(fx.type) });
    assertAligned(d, a.time, 'time');
    parseEffect(fx.type, { ...fx.params, [a.param]: a.value }); // range check
    const ch = { effectId: fx.id, param: a.param };
    const { keys, split } = writeKey(fx.keyframes?.[a.param] ?? [], a.time, a.value, a.easing, a.bezier, { rate: d.settings.frameRate, range: effectParamRange(fx.type, a.param), light: isLightChannel(clip, ch), channel: channelWords(ch, fx.type), max: MAX_EFFECT_KEYS, details: { clipId: clip.id, effectId: fx.id, param: a.param } });
    fx.keyframes = { ...fx.keyframes, [a.param]: keys };
    clip.effects = clip.effects!.map((e, n) => (n === i ? fx : e));
    return { affectedIds: [clip.id], summary: `Keyframe ${fx.type}.${a.param}=${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length, split } };
  },
});
defineOp({
  name: 'delete_effect_keyframe',
  version: 1,
  description: 'Remove the keyframe of an effect parameter at exactly this clip-local time. Removing the last key leaves the parameter at the value it had there.',
  args: z.object(FxKeyTarget).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const fx = { ...clip.effects![i]! };
    const keys = fx.keyframes?.[a.param] ?? [];
    const k = keys.findIndex((x) => T.eq(x.time, a.time));
    if (k < 0) throw new OpError('not_found', 'no keyframe at that time', { param: a.param, time: a.time });
    const rest = keys.filter((_, n) => n !== k);
    const kf = { ...fx.keyframes };
    if (rest.length) kf[a.param] = rest; else { delete kf[a.param]; fx.params = { ...fx.params, [a.param]: keys[k]!.value }; }
    if (Object.keys(kf).length) fx.keyframes = kf; else delete fx.keyframes;
    clip.effects = clip.effects!.map((e, n) => (n === i ? fx : e));
    return { affectedIds: [clip.id], summary: `Removed keyframe ${fx.type}.${a.param}`, output: { keyframeCount: rest.length } };
  },
});
defineOp({
  name: 'set_effect_modulator',
  version: 1,
  description: "Make a numeric effect parameter kick on the beats of the music under the clip and settle back: value = base + depth·e^(−decay·seconds since the beat), kept inside the parameter's range. `every` counts beats from the first bar start of the music, as the strobe's `every` does (default 2). modulator=null removes it. Only geometry and texture parameters can follow the beat (list_catalog → effects[].modulatable); brightness and colour cannot, because a beat-driven change of brightness is a flash. Without analysed music the parameter keeps its base value.",
  args: z.object({ clipId: z.string(), effectId: z.string(), param: z.string().max(48), modulator: z.object({ every: z.number().int().min(1).max(16).optional(), depth: z.number(), decay: z.number().min(1).max(30).optional() }).strict().nullable() }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const fx = { ...clip.effects![i]! };
    const allowed = modulatableParams(fx.type);
    // the allowlist is checked first: a name such as "__proto__" never reaches the record below
    if (!allowed.includes(a.param)) throw new OpError('invalid_args', `"${a.param}" of ${fx.type} cannot follow the beat`, { modulatable: allowed }, 'Brightness and colour parameters cannot follow the beat. list_catalog shows each effect\'s modulatable parameters.');
    const mod: Record<string, Modulator> = { ...fx.modulate };
    if (a.modulator === null) delete mod[a.param];
    else {
      const r = paramRange(fx.type, a.param)!;
      if (Math.abs(a.modulator.depth) > r.max - r.min) throw new OpError('out_of_bounds', `depth ${a.modulator.depth} is larger than the range of ${a.param} (${r.min}…${r.max})`, { min: r.min, max: r.max });
      if (!(a.param in mod) && Object.keys(mod).length >= 4) throw new OpError('out_of_bounds', 'an effect can have at most 4 parameters that follow the beat', { modulated: Object.keys(mod) });
      mod[a.param] = ModulatorSchema.parse({ by: 'beat', ...a.modulator });
    }
    if (Object.keys(mod).length) fx.modulate = mod; else delete fx.modulate;
    clip.effects = clip.effects!.map((e, n) => (n === i ? fx : e));
    return { affectedIds: [clip.id], summary: a.modulator ? `${fx.type}.${a.param} follows the beat` : `${fx.type}.${a.param} no longer follows the beat`, output: { modulated: Object.keys(mod) } };
  },
});
defineOp({
  name: 'remove_effect',
  version: 1,
  description: 'Remove an effect from a clip.',
  args: z.object({ clipId: z.string(), effectId: z.string() }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const type = clip.effects![i]!.type;
    const list = clip.effects!.filter((_, k) => k !== i);
    if (list.length) clip.effects = list; else delete clip.effects;
    return { affectedIds: [clip.id], summary: `Removed effect ${type}` };
  },
});
defineOp({
  name: 'set_clip_blend',
  version: 1,
  description: 'Set how a picture or title clip blends with what is below it (normal, multiply, screen, overlay, add, ...).',
  args: z.object({ clipId: z.string(), mode: z.enum(BLEND_MODES) }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    if (a.mode === 'normal') delete clip.blend; else clip.blend = a.mode;
    return { affectedIds: [clip.id], summary: `Blend mode ${a.mode}` };
  },
});
defineOp({
  name: 'set_clip_mask',
  version: 1,
  description: 'Set, change or clear (mask=null) a rectangle/ellipse mask on a picture clip or an adjustment clip. On a picture, position and size are fractions of the clip\'s own picture, so the mask moves and scales with it; on an adjustment they are fractions of the frame, and the look applies inside the mask only (outside it when inverted). Unspecified fields keep their current value (or the default for a new mask).',
  args: z.object({ clipId: z.string(), mask: MaskSchema.partial().nullable() }).strict(),
  apply(d, a) {
    const { clip, track } = pictureClip(d, a.clipId);
    if (!(clip.type === 'media' && track.kind === 'video') && !(clip.type === 'adjustment' && track.kind === 'adjustment')) throw new OpError('incompatible', 'masks apply to picture clips on video tracks and to adjustment clips', { clipId: clip.id });
    if (a.mask === null) { delete clip.mask; return { affectedIds: [clip.id], summary: 'Removed mask' }; }
    clip.mask = { ...(clip.mask ?? DEFAULT_MASK), ...a.mask };
    return { affectedIds: [clip.id], summary: `Mask ${clip.mask.shape}${clip.mask.invert ? ' (inverted)' : ''}`, output: { mask: clip.mask } };
  },
});
defineOp({
  name: 'apply_layout',
  version: 1,
  description: 'Arrange several picture clips in one of the ready-made layouts (see list_catalog → layouts): side by side, top and bottom, grids, a main picture with smaller ones, picture-in-picture in a corner. Give exactly as many clips as the layout has cells. Cells are filled from the bottom track up (clips on one track in time order), so for picture-in-picture the small window must be on a track above the background. Each clip gets a position and size and, where a picture is cropped to its cell, a rectangle mask; rotation is set to 0 and opacity is kept. The clips are not moved in time or between tracks: for a split screen they must already play at the same time on different tracks.',
  args: z.object({ layoutId: z.enum(LAYOUT_IDS), clipIds: z.array(z.string()).min(2).max(9) }).strict(),
  apply(d, a) {
    const layout = findLayout(a.layoutId)!;
    if (new Set(a.clipIds).size !== a.clipIds.length) throw new OpError('invalid_args', 'the same clip is listed twice', { clipIds: a.clipIds });
    if (a.clipIds.length !== layout.count) throw new OpError('invalid_args', `this layout takes ${layout.count} pictures, ${a.clipIds.length} were given`, { layoutId: layout.id, count: layout.count, available: LAYOUTS.filter((l) => l.count === a.clipIds.length).map((l) => l.id) }, 'Choose one of the listed layouts for this many pictures.');
    const found = a.clipIds.map((id) => pictureClip(d, id));
    const order = new Map<Track, number>();
    for (const seq of Object.values(d.sequences)) seq.tracks.forEach((t, i) => order.set(t, i));
    const sorted = found.map((f) => {
      refuseAdjustment(f.clip, 'arranged in a layout', 'A layout arranges picture clips. To limit a look to part of the frame, give the adjustment a mask (set_clip_mask).');
      if (f.clip.type !== 'media' || f.track.kind !== 'video') throw new OpError('incompatible', 'a layout arranges picture clips on video tracks', { clipId: f.clip.id });
      const asset = d.assets[f.clip.assetId]!;
      const size = asset.video ?? asset.image;
      if (!size) throw new OpError('incompatible', 'this clip has no picture', { clipId: f.clip.id });
      if (f.clip.keyframes && (['x', 'y', 'scale', 'rotation'] as const).some((p) => f.clip.keyframes?.[p]?.length)) throw new OpError('incompatible', 'this clip has position, size or rotation keyframes; a layout sets fixed values', { clipId: f.clip.id }, 'Clear those keyframes first (clear_keyframes).');
      return { clip: f.clip as MediaClip, track: f.track, size: { width: size.width, height: size.height } };
    }).sort((x, y) => order.get(x.track)! - order.get(y.track)! || T.cmp(x.clip.start, y.clip.start) || (x.clip.id < y.clip.id ? -1 : 1));
    let placements;
    // the frame of the sequence the clips are in (ADR-0018: a short has its own), not the project settings
    const frame = frameOf(d, found[0]!.seq.id);
    try { placements = layoutPlacements(layout.id, { frame: { width: frame.width, height: frame.height }, fit: frame.fit, pictures: sorted.map((x) => x.size) }); }
    catch (e) { throw new OpError('out_of_bounds', `this layout cannot be computed for these pictures: ${e instanceof Error ? e.message : String(e)}`, { layoutId: layout.id }); }
    sorted.forEach(({ clip }, i) => {
      const p = placements[i]!;
      clip.transform = { ...clip.transform, x: p.transform.x, y: p.transform.y, scale: p.transform.scale, rotation: 0 };
      if (p.mask) clip.mask = p.mask; else delete clip.mask;
    });
    return { affectedIds: sorted.map((x) => x.clip.id), summary: `Layout ${layout.id}`, output: { cells: sorted.map((x, i) => ({ clipId: x.clip.id, cell: i + 1 })) } };
  },
});
/** The clip that ends exactly where `clip` starts on the same track, if any. */
export function previousAdjacent(track: Track, clip: Clip): MediaClip | null {
  for (const c of track.clips) if (c.type === 'media' && c.id !== clip.id && T.eq(clipEnd(c), clip.start)) return c;
  return null;
}
type Velocity = NonNullable<Transition['velocity']>;
const VELOCITIES: readonly Velocity[] = [2, 3, 4];
/**
 * Source a transition at the start of `clip` has to play with (ADR-0012), in whole frames: after the previous clip's end
 * (null when there is no previous picture clip, or it is a still image, which never runs out) and before the clip's own
 * sourceIn (null when the clip is a still image).
 */
function transitionSource(d: ProjectDocument, track: Track, clip: MediaClip): { prev: MediaClip | null; haveOut: number | null; haveHead: number | null } {
  const rate = d.settings.frameRate;
  const prev = previousAdjacent(track, clip);
  const prevAsset = prev ? d.assets[prev.assetId] : undefined;
  const ownAsset = d.assets[clip.assetId];
  const haveOut = prev && prevAsset && prevAsset.kind !== 'image' ? T.frameIndexAt(handleAfterEnd(prev, prevAsset.duration), rate) : null;
  const haveHead = ownAsset && ownAsset.kind !== 'image' ? T.frameIndexAt(handleBeforeStart(clip), rate) : null;
  return { prev, haveOut, haveHead };
}
/** The largest velocity the handles allow for a transition of n frames (1 = none): the velocityNeeds arithmetic, nothing else. */
const maxVelocityFor = (n: number, haveOut: number | null, haveHead: number | null): 1 | Velocity => {
  let best: 1 | Velocity = 1;
  for (const v of VELOCITIES) { const need = velocityNeeds(n, v); if ((haveOut === null || need.outFrames <= haveOut) && (haveHead === null || need.headFrames <= haveHead)) best = v; }
  return best;
};
/** True when the clip's first enabled effect is a time effect (its picture is already remapped in time). */
const startsWithTimeEffect = (c: MediaClip) => { const first = c.effects?.find((e) => e.enabled); return !!first && isTimeEffect(first.type); };
/**
 * The one check of a transition at the start of a picture clip, shared by set_transition and set_transition_options
 * (ADR-0012). Without options its codes and messages are exactly those set_transition always had.
 */
/** Re-check the transition AT THE START of `clip` (if any) against its current handles, with set_transition's codes and words. Exported for switch_angles (ADR-0020), which re-checks every touched clip and the clip after it. */
export function checkTransitionAt(d: ProjectDocument, track: Track, clip: MediaClip): void { if (clip.transition) checkTransition(d, track, clip, clip.transition); }
function checkTransition(d: ProjectDocument, track: Track, clip: MediaClip, tr: Transition): void {
  const rate = d.settings.frameRate;
  const n = tr.frames, v = tr.velocity;
  const own = T.frameIndexAt(clip.duration, rate);
  if (n > own) throw new OpError('out_of_bounds', `the transition (${n} frames) is longer than the clip (${own} frames)`, { maxFrames: own }, 'Use at most maxFrames.');
  const { prev, haveOut, haveHead } = transitionSource(d, track, clip);
  refuseRamped(clip, 'given a transition');
  if (prev) refuseRamped(prev, 'followed by a transition');
  if (v) {
    // A velocity ramp remaps forward pictures only: the sides that are video, not reversed, not held, not already remapped in time.
    for (const side of prev ? [prev, clip] : [clip]) {
      if (isReverse(side) || isFreeze(side)) throw new OpError('incompatible', 'a velocity ramp cannot remap a clip that plays backwards or is a freeze frame', { clipId: side.id }, 'Remove the velocity (set_transition_options velocity=null), or make the clip play forwards first.');
      if (startsWithTimeEffect(side)) throw new OpError('incompatible', 'a velocity ramp cannot remap a clip whose first effect is a time effect', { clipId: side.id }, 'Remove the velocity (set_transition_options velocity=null), or remove or turn off the time effect first.');
    }
    const video = (c: MediaClip) => d.assets[c.assetId]?.kind === 'video';
    if (!video(clip) && !(prev && video(prev))) throw new OpError('incompatible', 'a velocity ramp needs a video on at least one side of the transition', { clipId: clip.id }, 'Still pictures have no motion to speed up.');
  }
  const maxVelocity = maxVelocityFor(n, haveOut, haveHead);
  if (prev && haveOut !== null) {
    const need = v ? velocityNeeds(n, v).outFrames : n;
    if (haveOut < need) {
      if (!v) throw new OpError('out_of_bounds', `the previous clip has only ${haveOut} unused source frames after its end; the transition needs ${n}`, { maxFrames: haveOut, previousClipId: prev.id, maxVelocity }, haveOut > 0 ? 'Use at most maxFrames, or trim the end of the previous clip to free more source.' : 'Trim the end of the previous clip to free source frames for the transition.');
      let maxFrames = 0;
      for (let m = 1; m <= Math.min(own, 150); m++) if (velocityNeeds(m, v).outFrames <= haveOut && (haveHead === null || velocityNeeds(m, v).headFrames <= haveHead)) maxFrames = m;
      throw new OpError('out_of_bounds', `the previous clip has only ${haveOut} unused source frames after its end; the transition at velocity ×${v} needs ${need}`, { maxFrames, previousClipId: prev.id, maxVelocity, needOutFrames: need, haveOutFrames: haveOut }, maxVelocity > 1 ? 'Use at most maxVelocity, a shorter transition (maxFrames), or trim the end of the previous clip to free more source.' : 'Remove the velocity, or trim the end of the previous clip to free more source.');
    }
  }
  if (v && haveHead !== null) {
    const need = velocityNeeds(n, v);
    if (haveHead < need.headFrames) throw new OpError('out_of_bounds', `the clip has only ${haveHead} source frames before its start; the transition at velocity ×${v} needs ${need.headFrames}`, { maxVelocity, needOutFrames: need.outFrames, needHeadFrames: need.headFrames, haveOutFrames: haveOut, haveHeadFrames: haveHead }, maxVelocity > 1 ? 'Use at most maxVelocity, or trim the start of the clip to free source before it.' : 'Remove the velocity, or trim the start of the clip to free source before it.');
  }
  if (tr.sync && n < 3) throw new OpError('out_of_bounds', `a transition locked to the beat needs at least 3 frames; this one has ${n}`, { minFrames: 3 }, 'Use 3 frames or more, or turn the beat lock off.');
  const options = transitionDef(tr.type)?.options ?? [];
  for (const option of ['color', 'seed'] as const) if (tr[option] !== undefined && !options.includes(option)) throw new OpError('incompatible', `the ${tr.type} transition has no ${option} option`, { option, type: tr.type, options: [...options] }, 'list_catalog → transitions[].options lists the options of each type.');
}
const transitionTarget = (d: ProjectDocument, clipId: string): { clip: MediaClip; track: Track } => {
  const { clip, track } = pictureClip(d, clipId);
  refuseAdjustment(clip, 'given a transition', 'Fade the adjustment in or out with its opacity instead (apply_motion_preset motion.in.fade or motion.out.fade).');
  if (clip.type !== 'media' || track.kind !== 'video') throw new OpError('incompatible', 'transitions apply to picture clips on video tracks', { clipId: clip.id });
  return { clip, track };
};
defineOp({
  name: 'set_transition',
  version: 1,
  description: 'Put a transition at the START of a picture clip (type=null removes it). It plays over the clip\'s first frames while the previous clip on the same track keeps playing underneath, which needs that many unused source frames after the previous clip\'s out point. With no previous clip the transition reveals the clip over the layers below. Sound is not crossfaded. Changing the type keeps the beat lock and the velocity (set_transition_options), and keeps the colour and seed only where the new type has them.',
  args: z.object({ clipId: z.string(), type: z.enum(TRANSITION_IDS).nullable(), frames: z.number().int().min(1).max(150).optional() }).strict(),
  apply(d, a) {
    const { clip, track } = transitionTarget(d, a.clipId);
    if (a.type === null) { delete clip.transition; return { affectedIds: [clip.id], summary: 'Removed transition' }; }
    const frames = a.frames ?? 15;
    const old = clip.transition, options = transitionDef(a.type)?.options ?? [];
    const next: Transition = { type: a.type, frames };
    if (old?.sync) next.sync = old.sync;
    if (old?.velocity) next.velocity = old.velocity;
    if (old?.color !== undefined && options.includes('color')) next.color = old.color;
    if (old?.seed !== undefined && options.includes('seed')) next.seed = old.seed;
    checkTransition(d, track, clip, next);
    clip.transition = next;
    return { affectedIds: [clip.id], summary: `Transition ${a.type} (${frames} frames)`, output: { previousClipId: previousAdjacent(track, clip)?.id ?? null } };
  },
});
defineOp({
  name: 'set_transition_options',
  version: 1,
  description: 'Options of the transition at the start of a picture clip (null removes one). sync=beat: its decisive moment lands on the analysed beat nearest the middle of its window; with no beat there it plays as usual. velocity 2|3|4: the outgoing shot speeds up to about that many times into the cut and the incoming one slows back to normal; only the picture is remapped, sound stays a hard cut, and both sides need more source. color, seed: only for types that list them (list_catalog → transitions[].options).',
  args: z.object({
    clipId: z.string(),
    sync: z.literal('beat').nullable().optional(),
    velocity: z.union([z.literal(2), z.literal(3), z.literal(4)]).nullable().optional(),
    color: TransitionColor.nullable().optional(),
    seed: z.number().int().min(0).max(9999).nullable().optional(),
  }).strict(),
  apply(d, a) {
    const { clip, track } = transitionTarget(d, a.clipId);
    if (!clip.transition) throw new OpError('not_found', `clip ${clip.id} has no transition`, { clipId: clip.id }, 'Put one at the start of the clip first (set_transition).');
    const next: Record<string, unknown> = { ...clip.transition };
    for (const k of ['sync', 'velocity', 'color', 'seed'] as const) { const v = a[k]; if (v === null) delete next[k]; else if (v !== undefined) next[k] = v; }
    checkTransition(d, track, clip, next as Transition);
    clip.transition = next as Transition;
    const said = (['sync', 'velocity', 'color', 'seed'] as const).filter((k) => a[k] !== undefined).map((k) => `${k} ${a[k] === null ? 'off' : String(a[k])}`);
    return { affectedIds: [clip.id], summary: `Transition options: ${said.join(', ') || 'unchanged'}`, output: { transition: clip.transition } };
  },
});
/**
 * For the editor (ADR-0012): the largest velocity the transition at the start of `clipId` can take as it is now (1 = none),
 * the source frames there are after the previous clip and before the clip (null where a side has no limit: no previous
 * picture, or a still image), and why not even ×2 when that is the case. Pure; nothing is changed.
 */
export function velocityLimit(d: ProjectDocument, clipId: string): { maxVelocity: 1 | 2 | 3 | 4; haveOutFrames: number | null; haveHeadFrames: number | null; refusal: string | null } {
  const f = findClip(d, clipId);
  if (!f || f.clip.type !== 'media' || f.track.kind !== 'video') return { maxVelocity: 1, haveOutFrames: null, haveHeadFrames: null, refusal: `clip ${clipId} is not a picture clip on a video track` };
  const clip = f.clip, track = f.track;
  const { haveOut, haveHead } = transitionSource(d, track, clip);
  if (!clip.transition) return { maxVelocity: 1, haveOutFrames: haveOut, haveHeadFrames: haveHead, refusal: `clip ${clip.id} has no transition` };
  let maxVelocity: 1 | Velocity = 1, refusal: string | null = null;
  for (const v of VELOCITIES) {
    try { checkTransition(d, track, clip, { ...clip.transition, velocity: v }); maxVelocity = v; }
    catch (e) { if (!(e instanceof OpError)) throw e; if (v === 2) refusal = e.message; }
  }
  return { maxVelocity, haveOutFrames: haveOut, haveHeadFrames: haveHead, refusal: maxVelocity > 1 ? null : refusal };
}

// ---------- motion tracking (ADR-0015) ----------
/** Last source frame of a video asset, numbered as sourceFrameIndexAt (speed.ts) numbers the frames a clip shows. */
export const lastSourceFrame = (asset: Asset): number => {
  const v = asset.video;
  if (!v) return -1;
  return v.frameCount !== null ? v.frameCount - 1 : Math.max(0, T.frameIndexAt(asset.duration, v.frameRate) - 1);
};
const mustMotionTrack = (d: ProjectDocument, id: string): MotionTrack => {
  // an own entry only: refuseInheritedIds already refuses names such as "__proto__"; this keeps the lookup honest on its own too
  const t = Object.hasOwn(d.motionTracks ?? {}, id) ? d.motionTracks[id] : undefined;
  if (!t) throw new OpError('not_found', `motion track ${id} not found`, { motionTrackId: id }, 'get_motion_track describes a track; motion track ids start with mtk_.');
  return t;
};
/** The clips (in every sequence) that follow a motion track, or carry a privacy region that follows it. */
export function motionTrackUsers(d: ProjectDocument, motionTrackIds: ReadonlySet<string>): { follow: string[]; redact: string[] } {
  const follow: string[] = [], redact: string[] = [];
  for (const seq of Object.values(d.sequences))
    for (const t of seq.tracks)
      for (const c of t.clips) {
        if (c.follow && motionTrackIds.has(c.follow.motionTrackId)) follow.push(c.id);
        if (c.type === 'media' && c.redact?.some((r) => r.motionTrackId !== null && motionTrackIds.has(r.motionTrackId))) redact.push(c.id);
      }
  return { follow, redact };
}
/** Refuse a track of n samples, past the per-track cap. Edits that grow a track call it with the final span BEFORE growing the columns, so a far-away frame is refused without building millions of samples first. */
function assertTrackLength(motionTrackId: string, n: number) {
  if (n > MAX_TRACK_SAMPLES) throw new OpError('out_of_bounds', `a motion track can hold at most ${MAX_TRACK_SAMPLES} samples; this edit would make ${n}`, { motionTrackId, samples: n, max: MAX_TRACK_SAMPLES }, 'Track a shorter stretch of the video.');
}
/** Refuse a track that would hold too many samples, alone or with the project's other tracks (tracking.ts caps). */
function assertTrackCaps(d: ProjectDocument, t: MotionTrack) {
  const n = t.x.length;
  assertTrackLength(t.id, n);
  // the camera measurements of stabilisation (wave 7) share the project's budget with the motion tracks
  const total = Object.values(d.motionTracks ?? {}).reduce((sum, x) => sum + (x.id === t.id ? 0 : x.x.length), n) + projectCameraSamples(d);
  if (total > MAX_PROJECT_TRACK_SAMPLES) throw new OpError(STEADY_REFUSALS.budget.code, STEADY_REFUSALS.budget.message(total, MAX_PROJECT_TRACK_SAMPLES), { samples: total, max: MAX_PROJECT_TRACK_SAMPLES }, STEADY_REFUSALS.budget.hint);
}
/** The sample columns of a track being edited. `filled` marks samples made only to close a gap (unknown, placed later at the nearest known sample). */
interface Columns { from: number; x: number[]; y: number[]; s: number[] | null; q: number[]; st: number[]; filled: boolean[] }
const columnsOf = (t: MotionTrack): Columns => ({ from: t.from, x: [...t.x], y: [...t.y], s: t.s ? [...t.s] : null, q: [...t.q], st: [...t.st], filled: t.x.map(() => false) });
/** Grow the columns to cover [lo, hi) with gap samples (unknown, confidence 0). */
function extendColumns(c: Columns, lo: number, hi: number) {
  if (lo < c.from) {
    const k = c.from - lo;
    // concat, never unshift(...spread): a spread passes one argument per frame and overflows the call stack past ~125,000 frames
    const gap = <X,>(v: X): X[] => new Array<X>(k).fill(v);
    c.x = gap(0).concat(c.x); c.y = gap(0).concat(c.y); if (c.s) c.s = gap(SIZE_UNIT).concat(c.s); c.q = gap(0).concat(c.q); c.st = gap<number>(ST.unknown).concat(c.st); c.filled = gap(true).concat(c.filled);
    c.from = lo;
  }
  const end = c.from + c.x.length;
  if (hi > end) for (let f = end; f < hi; f++) { c.x.push(0); c.y.push(0); c.s?.push(SIZE_UNIT); c.q.push(0); c.st.push(ST.unknown); c.filled.push(true); }
}
/** Place every gap sample at the nearest sample that is not a gap sample (the earlier one on a tie). */
function settleGaps(c: Columns) {
  const n = c.x.length;
  const prev = new Array<number>(n).fill(-1), next = new Array<number>(n).fill(-1);
  for (let i = 0, p = -1; i < n; i++) { if (!c.filled[i]) p = i; prev[i] = p; }
  for (let i = n - 1, q = -1; i >= 0; i--) { if (!c.filled[i]) q = i; next[i] = q; }
  for (let i = 0; i < n; i++) {
    if (!c.filled[i]) continue;
    const a = prev[i]!, b = next[i]!;
    const j = a < 0 ? b : b < 0 ? a : i - a <= b - i ? a : b;
    if (j < 0) continue;
    c.x[i] = c.x[j]!; c.y[i] = c.y[j]!; if (c.s) c.s[i] = c.s[j]!;
  }
}
const writeColumns = (t: MotionTrack, c: Columns) => {
  t.from = c.from; t.x = c.x; t.y = c.y; t.q = c.q; t.st = c.st;
  if (c.s) t.s = c.s; else delete t.s;
};
/** The source stretch [from, to) of a track edit, which must lie inside the track. */
function spanIn(c: Columns, span: { from: number; to: number }, what: string): [number, number] {
  const end = c.from + c.x.length;
  if (!(span.from < span.to)) throw new OpError('invalid_args', `${what}: the stretch must end after it starts (to is one past its last frame)`, { from: span.from, to: span.to });
  if (span.from < c.from || span.to > end) throw new OpError('out_of_bounds', `${what}: the stretch must lie inside the track (source frames ${c.from} to ${end - 1})`, { from: span.from, to: span.to, trackFrom: c.from, trackTo: end }, 'Add samples with set first, or choose a stretch inside the track.');
  return [span.from - c.from, span.to - c.from];
}

defineOp({
  name: 'create_motion_track',
  version: 1,
  description: 'Start a motion track on a video file (ADR-0015): one hand-placed sample at a SOURCE frame of the file (frame 0 = its first picture; describe_moment gives the sourceFrameIndex a clip shows). x and y are the point (or the centre of the box) in 1/10000 of the picture\'s width and height; kind=region also takes the box size w, h in the same units. The tracking job (track_motion) then follows it through the video without any AI model. Output: motionTrackId.',
  args: TrackOpArgs.create_motion_track,
  apply(d, a, ctx) {
    const asset = mustAsset(d, a.assetId);
    if (!asset.video) throw new OpError('incompatible', 'a motion track follows something in a video; this file has no video', { assetId: asset.id, kind: asset.kind }, 'Choose a video file.');
    const last = lastSourceFrame(asset);
    if (a.frame > last) throw new OpError('out_of_bounds', `frame ${a.frame} is past the last frame of the video (${last})`, { frame: a.frame, lastFrame: last });
    if (a.kind === 'region' && (a.w === undefined || a.h === undefined)) throw new OpError('invalid_args', 'a region track needs the size of its box (w and h)', { kind: a.kind });
    if (a.kind === 'point' && (a.w !== undefined || a.h !== undefined)) throw new OpError('invalid_args', 'a point track has no box: w and h belong to region tracks', { kind: a.kind });
    const count = Object.keys(d.motionTracks ?? {}).length;
    if (count >= MAX_MOTION_TRACKS) throw new OpError('out_of_bounds', `a project can hold at most ${MAX_MOTION_TRACKS} motion tracks`, { max: MAX_MOTION_TRACKS }, 'Delete a motion track that is no longer needed (remove_motion_track).');
    const id = ctx.newId('mtk');
    const track: MotionTrack = {
      id, assetId: asset.id, name: a.name ?? `Track ${count + 1}`, kind: a.kind, from: a.frame,
      ...(a.kind === 'region' ? { box: { w: a.w!, h: a.h! } } : {}),
      x: [a.x], y: [a.y], ...(a.kind === 'region' ? { s: [SIZE_UNIT] } : {}), q: [100], st: [ST.manual],
      origin: { method: 'manual', params: {}, createdAt: 'op', createdBy: ctx.actor, edited: false },
    };
    assertTrackCaps(d, track);
    (d.motionTracks ??= {})[id] = track;
    return { affectedIds: [id], summary: `Started ${a.kind} motion track "${track.name.slice(0, 40)}" at source frame ${a.frame}`, output: { motionTrackId: id } };
  },
});
defineOp({
  name: 'attach_motion_track',
  version: 1,
  internal: true,
  description: 'Attach tracked samples measured by the server\'s tracking job (ADR-0015) for source frames [from, from+n). Hand-placed (manual) samples are kept; the track grows to cover the new stretch, and frames between the old and the new stretch become unknown.',
  args: TrackOpArgs.attach_motion_track,
  apply(d, a, ctx) {
    const t = mustMotionTrack(d, a.motionTrackId);
    const asset = mustAsset(d, t.assetId);
    const n = a.x.length;
    if (a.y.length !== n || a.q.length !== n || a.st.length !== n || (a.s && a.s.length !== n)) throw new OpError('invalid_args', 'x, y, s, q and st must have the same length', { x: n, y: a.y.length, s: a.s?.length ?? null, q: a.q.length, st: a.st.length });
    if (!!a.s !== (t.kind === 'region')) throw new OpError('invalid_args', t.kind === 'region' ? 'a region track needs sizes (s)' : 'a point track has no sizes (s)', { kind: t.kind });
    if (a.st.includes(ST.manual)) throw new OpError('invalid_args', 'measured samples cannot be marked manual', {});
    const last = lastSourceFrame(asset);
    if (a.from + n - 1 > last) throw new OpError('out_of_bounds', `the samples reach past the last frame of the video (${last})`, { from: a.from, samples: n, lastFrame: last });
    const oldEnd = t.from + t.x.length, newEnd = a.from + n;
    assertTrackLength(t.id, Math.max(oldEnd, newEnd) - Math.min(t.from, a.from)); // before the columns are built
    const c: Columns = { from: Math.min(t.from, a.from), x: [], y: [], s: t.s ? [] : null, q: [], st: [], filled: [] };
    for (let f = c.from, hi = Math.max(oldEnd, newEnd); f < hi; f++) {
      const o = f >= t.from && f < oldEnd ? f - t.from : -1, k = f >= a.from && f < newEnd ? f - a.from : -1;
      if (k >= 0 && !(o >= 0 && t.st[o] === ST.manual)) { c.x.push(a.x[k]!); c.y.push(a.y[k]!); c.s?.push(a.s![k]!); c.q.push(a.q[k]!); c.st.push(a.st[k]!); c.filled.push(false); }
      else if (o >= 0) { c.x.push(t.x[o]!); c.y.push(t.y[o]!); c.s?.push(t.s![o]!); c.q.push(t.q[o]!); c.st.push(t.st[o]!); c.filled.push(false); }
      else { c.x.push(0); c.y.push(0); c.s?.push(SIZE_UNIT); c.q.push(0); c.st.push(ST.unknown); c.filled.push(true); }
    }
    settleGaps(c);
    // hand edits survive only outside the stretch measured now (manual samples are kept everywhere: they are anchors, not edits)
    const edited = t.origin.edited && (t.from < a.from || oldEnd > newEnd);
    const next: MotionTrack = { ...t, origin: { method: a.method, params: a.params, createdAt: a.createdAt, createdBy: ctx.actor, edited } };
    writeColumns(next, c);
    assertTrackCaps(d, next);
    d.motionTracks[t.id] = next;
    return { affectedIds: [t.id], summary: `Attached ${n} tracked samples to "${t.name.slice(0, 40)}"` };
  },
});
defineOp({
  name: 'edit_motion_track',
  version: 1,
  description: 'Correct a motion track by hand (ADR-0015), in this order: rename it; `set` places samples at SOURCE frames (state manual, kept by later tracking runs; a frame outside the track extends it, and the frames between become unknown); `markLost` marks the stretch [from, to) lost, holding the last usable position before it; `interpolate` fills [from, to) on a straight line between the usable samples on either side (hand-placed samples inside are kept). Frames are source frames; `to` is one past the last frame. Any change of samples marks the track as edited.',
  args: TrackOpArgs.edit_motion_track,
  apply(d, a) {
    const t = mustMotionTrack(d, a.motionTrackId);
    if (a.name === undefined && !a.set && !a.markLost && !a.interpolate) throw new OpError('invalid_args', 'nothing to change: give name, set, markLost or interpolate');
    const next: MotionTrack = { ...t };
    if (a.name !== undefined) next.name = a.name;
    const changesSamples = !!(a.set || a.markLost || a.interpolate);
    if (changesSamples) {
      const c = columnsOf(t);
      if (a.set) {
        const asset = mustAsset(d, t.assetId), last = lastSourceFrame(asset);
        const frames = new Set<number>();
        for (const p of a.set) {
          if (frames.has(p.frame)) throw new OpError('invalid_args', `frame ${p.frame} is set twice`, { frame: p.frame });
          frames.add(p.frame);
          if (p.frame > last) throw new OpError('out_of_bounds', `frame ${p.frame} is past the last frame of the video (${last})`, { frame: p.frame, lastFrame: last });
          if (p.s !== undefined && t.kind !== 'region') throw new OpError('invalid_args', 'a point track has no sizes (s)', { kind: t.kind });
        }
        // the span the track would cover, checked before any column grows
        let lo = c.from, hi = c.from + c.x.length;
        for (const p of a.set) { lo = Math.min(lo, p.frame); hi = Math.max(hi, p.frame + 1); }
        assertTrackLength(t.id, hi - lo);
        for (const p of [...a.set].sort((x, y) => x.frame - y.frame)) {
          const s = p.s ?? trackSampleAt(t, p.frame).s; // a region sample without a size keeps the size the track has there (or at its nearest end)
          extendColumns(c, Math.min(c.from, p.frame), Math.max(c.from + c.x.length, p.frame + 1));
          const i = p.frame - c.from;
          c.x[i] = p.x; c.y[i] = p.y; if (c.s) c.s[i] = s; c.q[i] = 100; c.st[i] = ST.manual; c.filled[i] = false;
        }
        settleGaps(c);
      }
      if (a.markLost) {
        const [i0, i1] = spanIn(c, a.markLost, 'markLost');
        let h = -1;
        for (let i = i0 - 1; i >= 0 && h < 0; i--) if (isUsable(c.st[i]!)) h = i;
        for (let i = i1; i < c.x.length && h < 0; i++) if (isUsable(c.st[i]!)) h = i;
        for (let i = i0; i < i1; i++) {
          if (h >= 0) { c.x[i] = c.x[h]!; c.y[i] = c.y[h]!; if (c.s) c.s[i] = c.s[h]!; }
          c.q[i] = 0; c.st[i] = ST.lost;
        }
      }
      if (a.interpolate) {
        const [i0, i1] = spanIn(c, a.interpolate, 'interpolate');
        let left = -1, right = -1;
        for (let i = i0 - 1; i >= 0 && left < 0; i--) if (isUsable(c.st[i]!)) left = i;
        for (let i = i1; i < c.x.length && right < 0; i++) if (isUsable(c.st[i]!)) right = i;
        if (left < 0 || right < 0) throw new OpError('incompatible', 'filling in needs a usable sample before the stretch and another after it', { from: a.interpolate.from, to: a.interpolate.to }, 'Place a sample by hand on each side first (set), or track the video around the stretch.');
        // hand-placed samples inside the stretch stay; the line runs from one kept sample to the next
        const anchors = [left];
        for (let i = i0; i < i1; i++) if (c.st[i] === ST.manual) anchors.push(i);
        anchors.push(right);
        for (let k = 0; k + 1 < anchors.length; k++) {
          const p = anchors[k]!, q = anchors[k + 1]!, len = q - p, conf = Math.min(c.q[p]!, c.q[q]!);
          for (let i = Math.max(p + 1, i0); i < Math.min(q, i1); i++) {
            c.x[i] = c.x[p]! + roundHalfUp((c.x[q]! - c.x[p]!) * (i - p), len);
            c.y[i] = c.y[p]! + roundHalfUp((c.y[q]! - c.y[p]!) * (i - p), len);
            if (c.s) c.s[i] = c.s[p]! + roundHalfUp((c.s[q]! - c.s[p]!) * (i - p), len);
            c.q[i] = conf; c.st[i] = ST.interpolated;
          }
        }
      }
      writeColumns(next, c);
      next.origin = { ...t.origin, edited: true };
      assertTrackCaps(d, next);
    }
    d.motionTracks[t.id] = next;
    const parts = [a.name !== undefined ? 'renamed' : null, a.set ? `${a.set.length} sample(s) placed` : null, a.markLost ? `frames ${a.markLost.from}–${a.markLost.to - 1} marked lost` : null, a.interpolate ? `frames ${a.interpolate.from}–${a.interpolate.to - 1} filled in` : null].filter(Boolean);
    return { affectedIds: [t.id], summary: `Motion track "${next.name.slice(0, 40)}": ${parts.join(', ')}` };
  },
});
defineOp({
  name: 'remove_motion_track',
  version: 1,
  description: 'Delete a motion track (ADR-0015). Refused while a clip follows it or a privacy region on a clip follows it, unless unbind=true: then those clips stop following it and those regions are removed, in the same step (a clip that follows keeps its own position, which was an offset from the tracked point). Refused, unbind or not, while a file of a multicam group hides a region with it or follows it (clear that angle\'s look first).',
  args: TrackOpArgs.remove_motion_track,
  apply(d, a) {
    const t = mustMotionTrack(d, a.motionTrackId);
    // multicam (ADR-0020): a group's file that hides a region with this track or follows it keeps it, unbind or not (the
    // group is not changed behind its owner's back)
    const pieces = Object.values(d.multicam ?? {}).flatMap((g) => g.angles.flatMap((an) => an.pieces.filter((p) => p.follow?.motionTrackId === t.id || p.redact?.some((r) => r.motionTrackId === t.id)).map((p) => ({ groupId: g.id, angleId: an.id, assetId: p.assetId }))));
    if (pieces.length) throw mcRefusal('motionTrackInGroup', { motionTrackId: t.id, pieces: pieces.slice(0, 50) }, pieces.length);
    const users = motionTrackUsers(d, new Set([t.id]));
    const ids = [...new Set([...users.follow, ...users.redact])];
    if (ids.length && !a.unbind) throw new OpError('incompatible', `${ids.length} clip(s) follow this motion track or hide a region with it`, { motionTrackId: t.id, follow: users.follow.slice(0, 50), redact: users.redact.slice(0, 50) }, 'Pass unbind=true to detach them in the same step, or detach them first (set_clip_follow follow=null, set_redact_region region=null).');
    for (const id of ids) {
      const { clip } = mustClip(d, id); // a clip on a locked track cannot be changed
      if (clip.follow?.motionTrackId === t.id) delete clip.follow;
      if (clip.type === 'media' && clip.redact) {
        const keep = clip.redact.filter((r) => r.motionTrackId !== t.id);
        if (keep.length) clip.redact = keep; else delete clip.redact;
      }
    }
    delete d.motionTracks[t.id];
    return { affectedIds: [t.id, ...ids], summary: `Deleted motion track "${t.name.slice(0, 40)}"${ids.length ? ` and detached ${ids.length} clip(s)` : ''}`, output: { detachedClipIds: ids } };
  },
});
/** Why a clip cannot follow a motion track, or carry a time effect while it follows one: the follow is resolved per frame, not per earlier picture. */
const FOLLOW_TIME_EFFECT = 'a clip with a time effect (echo, time split, shutter or stutter) cannot follow a motion track yet';
defineOp({
  name: 'set_clip_follow',
  version: 1,
  description: 'Make a title, or a picture on a video track, follow a motion track (ADR-0015): the clip moves with the tracked point as the picture of the track\'s video file on timeline track targetTrackId shows it (through every cut, speed change, reverse, freeze and format). The clip\'s own position becomes an offset from the tracked point (offset, when given, sets it in the same step: compute it from describe_moment so nothing jumps). scale=true also scales the clip with the tracked size and with the target clip\'s scale; smooth averages the usable samples within ±smooth source frames. follow=null detaches it. Refused for a clip whose first effect is a time effect, and for chains (a clip cannot follow a picture that itself follows, or be followed while it follows).',
  args: TrackOpArgs.set_clip_follow,
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    const { clip, track } = f;
    if (!(clip.type === 'text' || (clip.type === 'media' && track.kind === 'video')))
      throw new OpError('incompatible', 'only a title, or a picture on a video track, can follow a motion track', { clipId: clip.id, type: clip.type, trackKind: track.kind });
    const offset = () => { if (a.offset) clip.transform = { ...clip.transform, x: a.offset.x, y: a.offset.y }; };
    if (a.follow === null) {
      const had = !!clip.follow;
      delete clip.follow;
      offset();
      return { affectedIds: [clip.id], summary: had ? 'Clip no longer follows a motion track' : 'Clip did not follow a motion track' };
    }
    const mt = mustMotionTrack(d, a.follow.motionTrackId);
    const target = f.seq.tracks.find((t) => t.id === a.follow!.targetTrackId);
    if (!target) throw new OpError('not_found', `track ${a.follow.targetTrackId} not found`, { trackId: a.follow.targetTrackId }, 'Name the video track whose clip shows the tracked file (get_timeline lists the tracks).');
    if (target.kind !== 'video') throw new OpError('incompatible', `a clip follows a picture on a video track; track ${target.id} is a ${target.kind} track`, { trackId: target.id, kind: target.kind });
    if (target.id === track.id) throw new OpError('incompatible', 'a clip cannot follow the picture on its own track', { trackId: target.id }, 'Put the clip on a track above the picture it follows.');
    const first = clip.effects?.find((e) => e.enabled);
    if (first && isTimeEffect(first.type)) throw new OpError('incompatible', FOLLOW_TIME_EFFECT, { clipId: clip.id, effect: first.type }, 'Remove or turn off the time effect first.');
    const leader = target.clips.find((c) => c.follow);
    if (leader) throw new OpError('incompatible', `clip ${leader.id} on that track follows a motion track itself; follows cannot be chained`, { clipId: leader.id, trackId: target.id }, 'Follow the same motion track directly instead.');
    const follower = f.seq.tracks.flatMap((t) => t.clips).find((c) => c.id !== clip.id && c.follow?.targetTrackId === track.id);
    if (follower) throw new OpError('incompatible', `clip ${follower.id} follows the picture on this clip's track; follows cannot be chained`, { clipId: follower.id, trackId: track.id }, 'Detach that clip first, or let both follow the motion track directly.');
    clip.follow = { motionTrackId: mt.id, targetTrackId: target.id, scale: a.follow.scale, smooth: a.follow.smooth };
    offset();
    return { affectedIds: [clip.id], summary: `Clip follows motion track "${mt.name.slice(0, 40)}"`, output: { follow: clip.follow, transform: clip.transform } };
  },
});
defineOp({
  name: 'set_redact_region',
  version: 1,
  description: 'Add, change or delete (region=null) a privacy region on a video clip (ADR-0015): a blurred, pixelated or fully covered part of the picture, fixed or following a motion track of the clip\'s own video file. Position and size are fractions of the clip\'s own picture (as for masks); for a track they are an offset from the tracked point, and a region track also gives the size. The region is drawn on every picture the clip shows, before its effects, also on each earlier picture an echo shows. onLoss=frame blurs the whole picture while the track is lost (and while it is weak, when weakIsLost); hold keeps the region where it was last seen. Automatic tracking is not guaranteed redaction: check the lost and weak frames before publishing. Omit regionId to add one (output: regionId). A still image is refused.',
  args: TrackOpArgs.set_redact_region,
  apply(d, a, ctx) {
    const { clip, track } = pictureClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'video') throw new OpError('incompatible', 'privacy regions apply to video clips on video tracks', { clipId: clip.id });
    const asset = mustAsset(d, clip.assetId);
    if (!asset.video) throw new OpError('incompatible', 'privacy regions are drawn on video pictures only; this clip shows a still image', { clipId: clip.id, assetId: asset.id }, 'For a still, put a copy of the clip on the track above with a blur effect (blur.gaussian) and a mask over the area, or edit the image before importing it.');
    const list = [...(clip.redact ?? [])];
    if (a.region === null) {
      if (a.regionId === undefined) throw new OpError('invalid_args', 'name the region to delete (regionId)');
      const at = list.findIndex((r) => r.id === a.regionId);
      if (at < 0) throw new OpError('not_found', `region ${a.regionId} not found on clip ${clip.id}`, { regionId: a.regionId, clipId: clip.id });
      list.splice(at, 1);
      if (list.length) clip.redact = list; else delete clip.redact; // never an empty list
      return { affectedIds: [clip.id], summary: 'Removed privacy region', output: { regionId: a.regionId } };
    }
    let region: RedactRegion;
    if (a.regionId !== undefined) {
      const at = list.findIndex((r) => r.id === a.regionId);
      if (at < 0) throw new OpError('not_found', `region ${a.regionId} not found on clip ${clip.id}`, { regionId: a.regionId, clipId: clip.id });
      region = { ...list[at]!, ...a.region };
      list[at] = region;
    } else {
      if (list.length >= MAX_REDACT_REGIONS) throw new OpError('out_of_bounds', `a clip can carry at most ${MAX_REDACT_REGIONS} privacy regions`, { clipId: clip.id, max: MAX_REDACT_REGIONS });
      region = { id: ctx.newId('rgn'), motionTrackId: null, ...DEFAULT_REDACT_REGION, ...a.region };
      list.push(region);
    }
    if (region.motionTrackId !== null) {
      const mt = mustMotionTrack(d, region.motionTrackId);
      if (mt.assetId !== clip.assetId) throw new OpError('incompatible', 'a privacy region follows a motion track of the clip\'s own video file', { motionTrackId: mt.id, trackAssetId: mt.assetId, clipAssetId: clip.assetId }, 'Track the person or object in this clip\'s file (create_motion_track with its assetId).');
    }
    clip.redact = list;
    return { affectedIds: [clip.id], summary: `Privacy region ${region.style}${region.motionTrackId ? ' following a motion track' : ''}`, output: { regionId: region.id, region } };
  },
});

// ---------- adjustment clips (ADR-0016) ----------
export const AddAdjustmentArgsSchema = z.object({
  sequenceId: z.string().optional(),
  span: z.union([z.literal('edit'), z.object({ start: RT, duration: RT }).strict()]).describe('"edit" = from 0 to the end of the last picture or title clip'),
  trackId: z.string().optional(),
  effects: z.array(z.object({ type: z.string(), params: z.record(z.string(), z.unknown()).optional() }).strict()).max(16).optional(),
  opacity: z.number().min(0).max(1).optional(),
  label: z.string().max(80).optional(),
}).strict();
defineOp({
  name: 'add_adjustment',
  version: 1,
  checksOwnIds: ['lut'], // assertLutRef: Object.hasOwn, and the error lists the tables there are
  description: 'Add an adjustment clip: it has no picture of its own; its effects, mask, opacity and blend apply to everything drawn below it (pictures and titles on lower tracks) for its time span. span "edit" covers 0 to the end of the last picture or title clip. It goes on an adjustment track (a new one above the picture tracks and below the title tracks when none is free). Time effects, chroma key and drop shadow are refused on adjustments. Captions are never affected.',
  args: AddAdjustmentArgsSchema,
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    let start: T.RationalTime = T.ZERO, duration: T.RationalTime;
    if (a.span === 'edit') {
      let end = T.ZERO;
      for (const t of seq.tracks) if (t.kind === 'video' || t.kind === 'text') for (const c of t.clips) end = T.max(end, clipEnd(c));
      if (!T.lt(T.ZERO, end)) throw new OpError('invalid_args', 'the edit has no picture or title to cover yet', {}, 'Add clips first, or give span {start, duration}.');
      duration = end;
    } else { start = a.span.start; duration = a.span.duration; }
    assertAligned(d, start, 'start');
    assertAligned(d, duration, 'duration');
    if (T.isNegative(start) || !T.lt(T.ZERO, duration)) throw new OpError('invalid_args', 'start must be >= 0 and duration > 0', { start, duration });
    const effects: EffectInstance[] = (a.effects ?? []).map((e) => {
      const why = adjustmentRefusal(e.type);
      if (why) throw new OpError('incompatible', `${e.type} cannot go on an adjustment: ${why}`, { type: e.type }, 'Put it on the clip itself.');
      const fx = { id: ctx.newId('fx'), type: e.type, enabled: true, params: parseEffect(e.type, e.params) };
      assertLutRef(d, fx.type, fx.params);
      return fx;
    });
    const end = T.add(start, duration);
    const explicit = a.trackId ? mustTrack(seq, a.trackId) : undefined;
    if (explicit && explicit.kind !== 'adjustment') throw new OpError('incompatible', `an adjustment goes on an adjustment track, not on ${explicit.kind} track ${explicit.id}`, { trackId: explicit.id }, 'Omit trackId to use a free adjustment track (one is added when none is free).');
    const track = explicit ?? placeTrack(seq, 'adjustment', start, end, ctx);
    assertFree(track, start, end);
    const clip: AdjustmentClip = { id: ctx.newId('clp'), type: 'adjustment', start, duration, transform: { ...DEFAULT_TRANSFORM, opacity: a.opacity ?? 1 }, ...(effects.length ? { effects } : {}), ...(a.label ? { label: a.label } : {}) };
    track.clips.push(clip);
    sortClips(track);
    return { affectedIds: [clip.id], summary: `Added adjustment at ${fmt(start)} for ${fmt(duration)}`, output: { clipId: clip.id, trackId: track.id, effectIds: effects.map((e) => e.id) } };
  },
});

// ---------- replace media (ADR-0016) ----------
/**
 * Arguments of the public op replace_clip_media (v1). It keeps the clip id and everything on the clip; it changes assetId and
 * sourceIn.
 */
export const ReplaceClipMediaArgsSchema = z.object({
  clipId: z.string(),
  assetId: z.string(),
  sourceIn: RT.optional(),
  linked: z.enum(['follow', 'detach']).optional().describe('default follow: a linked sound partner takes the new asset too (refused if it has no sound); detach: unlink it and leave it'),
}).strict();
defineOp({
  name: 'replace_clip_media',
  version: 1,
  description: 'Give a clip another file from the library and keep everything else about it: its id (so per-format overrides and template slots stay), place and length on the timeline, transform and keyframes, effects, blend mode, mask, transition, speed and direction, fades and volume. Only the file and the point of it the clip starts from (sourceIn) change. sourceIn defaults to the current one when the new file is long enough from there, else 0 (always 0 for a still picture). A picture clip needs a file with a picture, a sound clip one with sound, and the file must be long enough for the clip from sourceIn; a transition into the next clip needs that many spare frames after it. A still picture cannot replace a clip that plays at another speed, backwards, as a freeze frame or with a gradual change of speed. linked=follow (default): the clips linked to this one take the same file and sourceIn (refused when the file lacks what one of them plays); linked=detach: they are unlinked and left as they are. Refused for multicam segments (their file is set by the group; detach them first or switch angles).',
  args: ReplaceClipMediaArgsSchema,
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    refuseAdjustment(f.clip, 'given another file');
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a file can take another file', { clipId: a.clipId }, 'A title changes with update_text, a caption cue with update_cue.');
    const clip = f.clip;
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId }, 'Call get_summary to list assets.');
    if (asset.kind === 'lut') throw new OpError('incompatible', 'a colour table (LUT) is not placed on the timeline; it is applied to a clip as an effect', { assetId: asset.id }, 'Use apply_lut with a clipId, or add the effect color.lut with this id as its lut parameter.');
    const isStill = asset.kind === 'image';
    const hasPicture = !!asset.video || (isStill && !!asset.image);
    const group = clip.linkGroupId;
    const partners = partnersOf(d, clip);
    const follow = a.linked !== 'detach';
    if (follow) for (const p of partners) if (p.track.locked) throw new OpError('track_locked', `linked clip ${p.clip.id} is on locked track ${p.track.id}`, { trackId: p.track.id, clipId: p.clip.id }, 'Unlock the track, or pass linked:detach to leave that clip as it is.');
    const targets = [{ track: f.track, clip }, ...(follow ? partners : [])];
    for (const t of targets) refuseTagged(t.clip); // multicam segments (ADR-0020): the group sets their file
    // What each clip plays on its track: a picture on a video track, sound on a sound track.
    const plays = (t: Track) => (t.kind === 'video' ? 'shows a picture' : 'plays sound');
    for (const [i, { track, clip: c }] of targets.entries()) {
      const ok = track.kind === 'video' ? hasPicture : track.kind === 'audio' ? !!asset.audio : false;
      if (ok) continue;
      const lacks = track.kind === 'video' ? 'picture' : 'sound';
      if (i === 0) throw new OpError('incompatible', `this clip ${plays(track)}, and the file has no ${lacks}`, { clipId: c.id, assetId: asset.id }, `Choose a file with ${lacks === 'picture' ? 'a picture' : 'sound'}.`);
      throw new OpError('incompatible', `the clip linked to this one (${c.id}) ${plays(track)}, and the file has no ${lacks}`, { clipId: c.id, assetId: asset.id }, 'Pass linked:detach to unlink that clip and leave it as it is.');
    }
    if (isStill) for (const { clip: c } of targets)
      if (c.reverse || c.freeze || c.speedEnd || speedValue(c) !== 1) throw new OpError('incompatible', 'a still picture cannot replace a clip that plays at another speed, backwards, as a freeze frame or with a gradual change of speed', { clipId: c.id }, 'Choose a video, or give the clip speed 1, forwards, first (set_clip_speed, set_clip_reverse).');
    // Privacy regions (ADR-0015) are drawn on video pictures, and a region that follows a motion track follows one of this clip's file.
    for (const { clip: c } of targets) {
      if (!c.redact) continue;
      if (!asset.video) throw new OpError('incompatible', 'this clip has privacy regions, which are drawn on video pictures only', { clipId: c.id }, 'Remove its privacy regions first (set_redact_region), or choose a video.');
      if (c.redact.some((r) => r.motionTrackId && d.motionTracks?.[r.motionTrackId]?.assetId !== asset.id)) throw new OpError('incompatible', 'a privacy region of this clip follows a motion track of its current file', { clipId: c.id }, 'Make that region fixed or remove it first (set_redact_region).');
    }
    // Stabilisation (wave 7) uses the camera motion measured on the current file: switch it off first rather than drop it silently.
    for (const { clip: c } of targets)
      if (c.stabilise && c.assetId !== asset.id) throw new OpError(STEADY_REFUSALS.otherFile.code, STEADY_REFUSALS.otherFile.message(), { clipId: c.id }, STEADY_REFUSALS.otherFile.hint);
    // The source a clip needs from sourceIn: its stretch of source (a freeze frame needs one picture inside the file).
    const needed = (c: MediaClip) => toSourceSpan(c, c.duration);
    const fits = (c: MediaClip, sourceIn: T.RationalTime) => isStill || (!T.isNegative(sourceIn) && (c.freeze ? T.lt(sourceIn, asset.duration) : T.lte(T.add(sourceIn, needed(c)), asset.duration)));
    const sourceIn = a.sourceIn ?? (isStill ? T.ZERO : targets.every((t) => fits(t.clip, clip.sourceIn)) ? clip.sourceIn : T.ZERO);
    if (T.isNegative(sourceIn)) throw new OpError('out_of_bounds', 'sourceIn is outside the asset', { sourceIn, assetDuration: asset.duration });
    for (const { clip: c } of targets)
      if (!fits(c, sourceIn)) throw new OpError('out_of_bounds', 'the file is too short for this clip from that point', { clipId: c.id, sourceIn, available: T.max(T.ZERO, T.sub(asset.duration, sourceIn)), needed: needed(c) }, 'Choose an earlier sourceIn or a longer file, or shorten the clip first (trim_clip).');
    // A transition into the next picture plays on over spare source after this clip's end (as set_transition checks it).
    const rate = d.settings.frameRate;
    if (!isStill) for (const { track, clip: c } of targets) {
      if (track.kind !== 'video') continue;
      const next = track.clips.find((o) => o.type === 'media' && o.id !== c.id && o.transition && T.eq(o.start, clipEnd(c)));
      if (!next || next.type !== 'media' || !next.transition) continue;
      const after = T.frameIndexAt(handleAfterEnd({ ...c, sourceIn }, asset.duration), rate);
      if (after < next.transition.frames) throw new OpError('out_of_bounds', `the transition into the next clip needs ${next.transition.frames} spare source frames after this clip, and the file has only ${after}`, { clipId: c.id, nextClipId: next.id, maxFrames: Math.max(0, after) }, 'Choose an earlier sourceIn or a longer file, or shorten that transition first (set_transition).');
    }
    const unchanged = targets.every((t) => t.clip.assetId === asset.id && T.eq(t.clip.sourceIn, sourceIn)) && (follow || !partners.length);
    if (unchanged) throw new OpError('invalid_args', 'the clip already plays this file from this point', { clipId: clip.id, assetId: asset.id, sourceIn });
    for (const { clip: c } of targets) { c.assetId = asset.id; c.sourceIn = sourceIn; }
    // detach: this clip leaves its link group; a partner left alone in it is unlinked too (refused while it is on a locked track)
    let unlinked: string[] = [];
    if (!follow && group && partners.length) { clip.linkGroupId = null; unlinked = [clip.id, ...dissolveLoneLinks(d, [group])]; }
    const ids = targets.map((t) => t.clip.id);
    return { affectedIds: [...new Set([...ids, ...unlinked])], summary: `Clip now plays "${asset.name.slice(0, 60)}"${targets.length > 1 ? ` (with ${targets.length - 1} linked clip(s))` : ''}`, output: { clipIds: ids, assetId: asset.id, sourceIn, unlinkedClipIds: unlinked } };
  },
});

// ---------- captions, transcripts and range cuts (SPEC §16) ----------
function newCaptionTrack(seq: Sequence, ctx: OpContext, mode: 'manual' | 'transcript', linkedTrackId: string | null, style?: Partial<CaptionStyle>, name?: string): Track {
  if (linkedTrackId) {
    const l = seq.tracks.find((t) => t.id === linkedTrackId);
    if (!l || (l.kind !== 'audio' && l.kind !== 'video')) throw new OpError('not_found', `linked track ${linkedTrackId} must be an existing audio or video track`, { linkedTrackId });
  }
  const t = newTrack(seq, 'caption', ctx, name);
  t.caption = { mode, linkedTrackId, style: { ...DEFAULT_CAPTION_STYLE, ...style } };
  return t;
}
const mustCaptionTrack = (seq: Sequence, trackId: string) => {
  const t = mustTrack(seq, trackId);
  if (t.kind !== 'caption' || !t.caption) throw new OpError('incompatible', `track ${trackId} is not a caption track`, { trackId });
  return t;
};
const manualCaptionTrack = (seq: Sequence, ctx: OpContext, trackId?: string) => {
  const t = trackId ? mustCaptionTrack(seq, trackId) : seq.tracks.find((x) => x.kind === 'caption' && x.caption?.mode === 'manual' && !x.locked) ?? newCaptionTrack(seq, ctx, 'manual', null);
  if (t.caption!.mode !== 'manual') throw new OpError('incompatible', `caption track ${t.id} shows a transcript; cues can only be added to a manual caption track`, { trackId: t.id }, 'Omit trackId to use or create a manual caption track.');
  return t;
};

defineOp({
  name: 'add_caption_track',
  version: 1,
  description: 'Add a caption track. mode=transcript shows the transcript of whatever plays on the linked audio/video track (captions follow every cut automatically); mode=manual holds its own timed cues.',
  args: z.object({ sequenceId: z.string().optional(), mode: z.enum(['manual', 'transcript']), linkedTrackId: z.string().optional().describe('transcript mode: track whose clips are captioned. Omit to caption the first playing clip that has a transcript.'), style: CaptionStyleSchema.partial().optional(), name: z.string().max(128).optional() }).strict(),
  apply(d, a, ctx) {
    const t = newCaptionTrack(seqOf(d, a.sequenceId), ctx, a.mode, a.mode === 'transcript' ? a.linkedTrackId ?? null : null, a.style, a.name);
    return { affectedIds: [t.id], summary: `Added ${a.mode} caption track ${t.name}`, output: { trackId: t.id } };
  },
});

defineOp({
  name: 'set_caption_style',
  version: 1,
  description: 'Change the look of a caption track (preset, font, size, colours, position, line limits). Unspecified fields are kept.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), style: CaptionStyleSchema.partial() }).strict(),
  apply(d, a) {
    const t = mustCaptionTrack(seqOf(d, a.sequenceId), a.trackId);
    t.caption!.style = { ...t.caption!.style, ...a.style };
    return { affectedIds: [t.id], summary: `Updated caption style (${t.caption!.style.preset})` };
  },
});

defineOp({
  name: 'apply_caption_look',
  version: 1,
  description: 'Give a caption track one of the ready-made caption looks (see list_catalog → captionLooks): behaviour, font, size, colours, background, outline and position in one step. Fields a look does not set (such as text direction and margin) keep their current value. A look whose behaviour follows the spoken word needs word timing to show it.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string(), lookId: z.enum(CAPTION_LOOK_IDS) }).strict(),
  apply(d, a) {
    const t = mustCaptionTrack(seqOf(d, a.sequenceId), a.trackId);
    const look = findCaptionLook(a.lookId)!;
    const next = { ...t.caption!.style, ...look.style };
    if (look.style.wordEntrance === undefined) delete next.wordEntrance; // a look that says nothing about word entrances has none
    t.caption!.style = next;
    return { affectedIds: [t.id], summary: `Caption look ${look.id}`, output: { needsWordTiming: look.needsWordTiming } };
  },
});

defineOp({
  name: 'add_cue',
  version: 1,
  description: 'Add one manually timed caption cue (frame-aligned start and duration). Creates a manual caption track when none exists.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string().optional(), start: RT, duration: RT, text: z.string().min(1).max(2000) }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.start, 'start');
    assertAligned(d, a.duration, 'duration');
    if (!T.lt(T.ZERO, a.duration) || T.isNegative(a.start)) throw new OpError('invalid_args', 'start must be >= 0 and duration > 0');
    const track = manualCaptionTrack(seq, ctx, a.trackId);
    assertFree(track, a.start, T.add(a.start, a.duration));
    const clip: Clip = { id: ctx.newId('cue'), type: 'caption', text: a.text, start: a.start, duration: a.duration, transform: { ...DEFAULT_TRANSFORM } };
    track.clips.push(clip);
    sortClips(track);
    return { affectedIds: [clip.id, track.id], summary: `Added caption "${a.text.slice(0, 40)}" at ${fmt(a.start)}`, output: { clipId: clip.id, trackId: track.id } };
  },
});

defineOp({
  name: 'update_cue',
  version: 1,
  description: 'Change the text of a caption cue. Timing is changed with move_clip / trim_clip / split_clip.',
  args: z.object({ clipId: z.string(), text: z.string().min(1).max(2000) }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'caption') throw new OpError('incompatible', `clip ${a.clipId} is not a caption cue`, { clipId: a.clipId });
    clip.text = a.text;
    delete clip.words; // per-word timing described the old text
    return { affectedIds: [clip.id], summary: `Updated caption "${a.text.slice(0, 40)}"` };
  },
});

defineOp({
  name: 'merge_cues',
  version: 1,
  description: 'Merge a caption cue with the next cue on its track into one cue covering both.',
  args: z.object({ clipId: z.string(), separator: z.string().max(4).optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    const next = f.track.clips[f.index + 1];
    if (f.clip.type !== 'caption' || !next || next.type !== 'caption') throw new OpError('incompatible', 'merge_cues needs a caption cue that has a following cue', { clipId: a.clipId });
    f.clip.text = `${f.clip.text}${a.separator ?? ' '}${next.text}`;
    f.clip.duration = T.sub(clipEnd(next), f.clip.start);
    delete f.clip.words;
    f.track.clips.splice(f.index + 1, 1);
    return { affectedIds: [f.clip.id, next.id], summary: 'Merged two captions' };
  },
});

defineOp({
  name: 'import_captions',
  version: 1,
  description: 'Import an SRT or WebVTT file as manual caption cues in TIMELINE time. Cue times are snapped to the nearest frame; the largest shift is reported. Overlapping cues are rejected, not silently dropped.',
  args: z.object({ sequenceId: z.string().optional(), trackId: z.string().optional(), content: z.string().min(1).max(2_000_000), format: z.enum(['srt', 'vtt']).optional(), offset: RT.optional().describe('Added to every cue time (frame-aligned)'), replace: z.boolean().optional().describe('Remove the track\'s existing cues first') }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    let parsed;
    try { parsed = parseSubtitles(a.content, a.format); } catch (e: any) { throw new OpError('invalid_args', `cannot read subtitles: ${e.message}`, { line: e.line, code: e.code }); }
    if (parsed.cues.length === 0) throw new OpError('invalid_args', 'the file contains no usable cues', { warnings: parsed.warnings.slice(0, 20) });
    const offset = a.offset ?? T.ZERO;
    assertAligned(d, offset, 'offset');
    const snapped = snapCuesToFrames(parsed.cues.map((c) => ({ ...c, start: T.add(c.start, offset), end: T.add(c.end, offset) })), d.settings.frameRate);
    const track = manualCaptionTrack(seq, ctx, a.trackId);
    const removed = a.replace ? track.clips.map((c) => c.id) : [];
    if (a.replace) track.clips = [];
    const ids: string[] = [];
    for (const c of snapped.cues) {
      if (T.isNegative(c.start)) throw new OpError('out_of_bounds', 'a cue starts before 0 after applying the offset', { text: c.text.slice(0, 40) });
      assertFree(track, c.start, c.end);
      const clip: Clip = { id: ctx.newId('cue'), type: 'caption', text: c.text, start: c.start, duration: T.sub(c.end, c.start), transform: { ...DEFAULT_TRANSFORM } };
      track.clips.push(clip);
      ids.push(clip.id);
    }
    sortClips(track);
    return { affectedIds: [track.id, ...ids, ...removed], summary: `Imported ${ids.length} captions (${parsed.format.toUpperCase()})`, output: { trackId: track.id, cueIds: ids, format: parsed.format, maxShiftSeconds: snapped.maxShiftSeconds, warnings: parsed.warnings.slice(0, 50) } };
  },
});

const WordIn = z.object({ text: z.string().min(1).max(200), start: RT, duration: RT, confidence: z.number().min(0).max(1).optional() }).strict();
const SegmentIn = z.object({ start: RT, duration: RT, text: z.string().max(4000), speaker: z.string().max(80).optional(), words: z.array(WordIn).max(2000).optional(), approximate: z.boolean().optional().describe('true when word times are estimates') }).strict();
function buildTranscript(d: ProjectDocument, ctx: OpContext, assetId: string, language: string, kind: 'import' | 'manual' | 'asr', segments: z.infer<typeof SegmentIn>[], asr?: { provider: string; model: string; createdAt: string }): Transcript {
  const asset = d.assets[assetId];
  if (!asset) throw new OpError('not_found', `asset ${assetId} not found`, { assetId });
  if (!asset.audio) throw new OpError('incompatible', `asset ${assetId} has no audio to transcribe`, { assetId });
  const out: Transcript = { assetId, language, origin: { kind, provider: asr?.provider ?? null, model: asr?.model ?? null, createdAt: asr?.createdAt ?? 'op', createdBy: ctx.actor }, segments: [] };
  let prevEnd = T.ZERO;
  for (const s of [...segments].sort((x, y) => T.cmp(x.start, y.start))) {
    const end = T.add(s.start, s.duration);
    if (T.lt(s.start, prevEnd) || !T.lt(T.ZERO, s.duration)) throw new OpError('invalid_args', 'segments must not overlap and must have a duration', { start: s.start, text: s.text.slice(0, 40) });
    if (T.lt(asset.duration, s.start)) throw new OpError('out_of_bounds', 'a segment starts after the end of the media', { start: s.start, assetDuration: asset.duration });
    prevEnd = end;
    out.segments.push({
      id: ctx.newId('seg'), start: s.start, duration: s.duration, text: s.text, original: null, speaker: s.speaker ?? null,
      timing: s.words?.length ? (s.approximate ? 'approximate' : 'word') : 'segment',
      words: (s.words ?? []).map((w) => ({ id: ctx.newId('wrd'), text: w.text, start: w.start, duration: w.duration, confidence: w.confidence ?? null })),
    });
  }
  return out;
}

defineOp({
  name: 'set_transcript',
  version: 1,
  description: 'Set the transcript of a media asset from typed or imported text, timed in the SOURCE media\'s own time. This records human/imported text only; speech-recognition results arrive through provider jobs, never through this operation.',
  args: z.object({ assetId: z.string(), language: z.string().min(2).max(35), origin: z.enum(['import', 'manual']).optional(), segments: z.array(SegmentIn).min(1).max(20000) }).strict(),
  apply(d, a, ctx) {
    d.transcripts[a.assetId] = buildTranscript(d, ctx, a.assetId, a.language, a.origin ?? 'manual', a.segments);
    const t = d.transcripts[a.assetId]!;
    return { affectedIds: [transcriptEntityId(a.assetId)], summary: `Set transcript (${t.segments.length} phrases, ${a.language})`, output: { segmentIds: t.segments.map((s) => s.id), wordIds: t.segments.map((s) => s.words.map((w) => w.id)) } };
  },
});

defineOp({
  name: 'attach_transcript',
  version: 1,
  internal: true,
  description: 'Attach a speech-recognition result produced by a local speech job from the source file. Words carry the times and confidence the recogniser reported.',
  args: z.object({ assetId: z.string(), language: z.string().min(2).max(35), provider: z.string().min(1).max(80), model: z.string().min(1).max(200), createdAt: z.string(), segments: z.array(SegmentIn).min(1).max(20000) }).strict(),
  apply(d, a, ctx) {
    d.transcripts[a.assetId] = buildTranscript(d, ctx, a.assetId, a.language, 'asr', a.segments, { provider: a.provider, model: a.model, createdAt: a.createdAt });
    const t = d.transcripts[a.assetId]!;
    return { affectedIds: [transcriptEntityId(a.assetId)], summary: `Recognised speech (${t.segments.length} phrases, ${t.segments.reduce((n, s) => n + s.words.length, 0)} words, ${a.language})`, output: { segmentIds: t.segments.map((s) => s.id) } };
  },
});

defineOp({
  name: 'attach_word_timing',
  version: 1,
  internal: true,
  description: 'Give the words of existing transcript phrases the times a local recognition job heard (alignment). The phrases, their text and their ids are kept; only word times change.',
  args: z.object({ assetId: z.string(), segments: z.array(z.object({ segmentId: z.string(), approximate: z.boolean(), words: z.array(WordIn).min(1).max(2000) }).strict()).min(1).max(20000) }).strict(),
  apply(d, a, ctx) {
    const tr = d.transcripts[a.assetId];
    if (!tr) throw new OpError('not_found', `asset ${a.assetId} has no transcript`, { assetId: a.assetId });
    let words = 0;
    for (const s of a.segments) {
      const seg = tr.segments.find((x) => x.id === s.segmentId);
      if (!seg) throw new OpError('not_found', `phrase ${s.segmentId} not found in the transcript of ${a.assetId}`, { segmentId: s.segmentId });
      const end = T.add(seg.start, seg.duration);
      let at = seg.start;
      for (const w of s.words) {
        if (T.lt(w.start, at) || T.isNegative(w.duration) || T.lt(end, T.add(w.start, w.duration))) throw new OpError('invalid_args', 'word times must be in order and inside their phrase', { segmentId: seg.id, word: w.text.slice(0, 40) });
        at = T.add(w.start, w.duration);
      }
      seg.words = s.words.map((w) => ({ id: ctx.newId('wrd'), text: w.text, start: w.start, duration: w.duration, confidence: w.confidence ?? null }));
      seg.timing = s.approximate ? 'approximate' : 'word';
      words += seg.words.length;
    }
    return { affectedIds: [transcriptEntityId(a.assetId)], summary: `Timed ${words} words in ${a.segments.length} phrases from the sound`, output: { phrases: a.segments.length, words } };
  },
});

defineOp({
  name: 'import_transcript',
  version: 1,
  description: 'Use an SRT or WebVTT file, timed against the SOURCE media, as that asset\'s transcript. Phrases are timed; words are not (no karaoke or word-precise cuts until word timing exists).',
  args: z.object({ assetId: z.string(), language: z.string().min(2).max(35), content: z.string().min(1).max(2_000_000), format: z.enum(['srt', 'vtt']).optional() }).strict(),
  apply(d, a, ctx) {
    let parsed;
    try { parsed = parseSubtitles(a.content, a.format); } catch (e: any) { throw new OpError('invalid_args', `cannot read subtitles: ${e.message}`, { line: e.line, code: e.code }); }
    if (parsed.cues.length === 0) throw new OpError('invalid_args', 'the file contains no usable cues', { warnings: parsed.warnings.slice(0, 20) });
    d.transcripts[a.assetId] = buildTranscript(d, ctx, a.assetId, a.language, 'import', parsed.cues.map((c) => ({ start: c.start, duration: T.sub(c.end, c.start), text: c.text })));
    return { affectedIds: [transcriptEntityId(a.assetId)], summary: `Imported transcript (${parsed.cues.length} phrases, ${parsed.format.toUpperCase()})`, output: { segmentIds: d.transcripts[a.assetId]!.segments.map((s) => s.id), warnings: parsed.warnings.slice(0, 50) } };
  },
});

defineOp({
  name: 'correct_transcript',
  version: 1,
  description: 'Correct the text of one transcript phrase. The audio is not changed and the recognised original is kept. If the number of words changes, word times become estimates (marked approximate).',
  args: z.object({ assetId: z.string(), segmentId: z.string(), text: z.string().min(1).max(4000) }).strict(),
  apply(d, a, ctx) {
    const seg = d.transcripts[a.assetId]?.segments.find((s) => s.id === a.segmentId);
    if (!seg) throw new OpError('not_found', `phrase ${a.segmentId} not found in the transcript of ${a.assetId}`, { segmentId: a.segmentId });
    if (seg.original === null) seg.original = seg.text;
    seg.text = a.text;
    const tokens = a.text.split(/\s+/).filter(Boolean);
    if (seg.words.length > 0) {
      if (tokens.length === seg.words.length) seg.words.forEach((w, i) => { w.text = tokens[i]!; });
      else {
        // Spread the new words over the phrase in proportion to their length, on a microsecond grid.
        const total = tokens.reduce((n, t) => n + t.length, 0) || 1;
        const startUs = T.toMicros(seg.start), durUs = T.toMicros(seg.duration);
        let acc = 0;
        seg.words = tokens.map((t) => {
          const from = startUs + (durUs * BigInt(acc)) / BigInt(total);
          acc += t.length;
          const to = startUs + (durUs * BigInt(acc)) / BigInt(total);
          return { id: ctx.newId('wrd'), text: t, start: T.fromMicros(from), duration: T.fromMicros(to - from), confidence: null };
        });
        seg.timing = 'approximate';
      }
    }
    return { affectedIds: [transcriptEntityId(a.assetId)], summary: `Corrected transcript: "${a.text.slice(0, 40)}"`, output: { timing: seg.timing } };
  },
});

/** Remove [start,end) from the given tracks; with ripple, everything later moves earlier by the removed length. */
function cutRange(d: ProjectDocument, seq: Sequence, start: T.RationalTime, end: T.RationalTime, tracks: Track[], ripple: boolean, ctx: OpContext) {
  const len = T.sub(end, start);
  const removed: string[] = [], changed: string[] = [], created: string[] = [];
  const relink = new Map<string, string>();
  const touched = new Set<string>(); // link groups that lose a clip here, or that a divided clip leaves
  for (const track of tracks) {
    if (track.locked) throw new OpError('track_locked', `track ${track.id} is locked, so the cut cannot keep tracks in sync`, { trackId: track.id }, 'Unlock the track, or pass trackIds without it (other tracks will then shift relative to it).');
    const next: Clip[] = [];
    for (const clip of track.clips) {
      const cEnd = clipEnd(clip);
      if (!T.lt(start, cEnd)) { next.push(clip); continue; }
      if (!T.lt(clip.start, end)) {
        if (ripple) { clip.start = T.sub(clip.start, len); changed.push(clip.id); }
        next.push(clip);
        continue;
      }
      const hasLeft = T.lt(clip.start, start), hasRight = T.lt(end, cEnd);
      if (clip.type === 'media' && clip.linkGroupId) touched.add(clip.linkGroupId);
      if (!hasLeft && !hasRight) { removed.push(clip.id); continue; }
      let right: Clip | null = null;
      if (hasRight) {
        right = hasLeft ? structuredClone(clip) : clip;
        const delta = T.sub(end, clip.start);
        if (hasLeft) {
          right.id = ctx.newId('clp');
          copyOverrides(d, clip.id, right.id);
          created.push(right.id);
          if (right.type === 'media' && right.linkGroupId) {
            if (!relink.has(right.linkGroupId)) relink.set(right.linkGroupId, ctx.newId('lnk'));
            right.linkGroupId = relink.get(right.linkGroupId)!;
            touched.add(right.linkGroupId);
          }
        }
        if (right.type === 'media' && hasLeft) delete right.transition;
        if (right.type === 'media') delete right.fadeIn;
        if (right.type === 'media' && clip.type === 'media') setPart(right, clip, delta, T.sub(cEnd, end));
        if (right.type === 'caption') delete right.words;
        shiftKeyframes(right, delta);
        right.start = ripple ? start : end;
        right.duration = T.sub(cEnd, end);
        clampFades(right);
        fitTextAnimation(right, d.settings.frameRate, { in: !hasLeft, out: true }); // a title cut in two: the entrance stays with the first part; with only its head cut off it keeps both
      }
      if (hasLeft) {
        if (clip.type === 'media') delete clip.fadeOut;
        if (clip.type === 'media') setPart(clip, clip, T.ZERO, T.sub(start, clip.start));
        clip.duration = T.sub(start, clip.start);
        clampFades(clip);
        fitTextAnimation(clip, d.settings.frameRate, { in: true, out: !hasRight }); // and the exit with the last part
        if (clip.type === 'caption') delete clip.words;
        next.push(clip);
      }
      changed.push(clip.id);
      if (right) next.push(right);
    }
    track.clips = next;
    sortClips(track);
  }
  // Markers follow the timeline when time itself is removed from every track: later ones move earlier; those whose frame
  // no longer exists (inside the range, or at its end) collapse onto the cut point, where only one marker can sit: an existing
  // marker there stays, otherwise the earliest of them; the rest are removed (one undo brings them back).
  const markersMoved: string[] = [], markersRemoved: string[] = [];
  if (ripple && tracks.length === seq.tracks.length) {
    let atCut = markerAt(d, seq.id, start);
    const later = Object.values(d.markers ?? {}).filter((m) => m.sequenceId === seq.id && T.lt(start, m.time)).sort((a, b) => T.cmp(a.time, b.time));
    for (const m of later) {
      if (T.lt(end, m.time)) { m.time = T.sub(m.time, len); markersMoved.push(m.id); continue; }
      if (atCut) { delete d.markers![m.id]; markersRemoved.push(m.id); continue; }
      m.time = start; atCut = m; markersMoved.push(m.id);
    }
  }
  // A clip whose linked clip was removed or divided while it was not (it lies on a track that was not cut, or reaches less
  // far): a link group of one is not a link.
  const unlinked = dissolveLoneLinks(d, touched);
  return { removed, changed, created, markersMoved, markersRemoved, unlinked };
}

defineOp({
  name: 'cut_range',
  version: 1,
  description: 'Remove a frame-aligned time range from the timeline. By default every track is cut and later material moves earlier (ripple) so picture, sound and captions stay in sync; markers after the range move with it, and markers on removed frames collapse onto the cut point (one marker per frame: extra ones are dropped and listed in the output). A locked track makes the cut fail rather than drift. A clip whose linked clip is removed or divided while it is not (on a track left out of trackIds, say) is unlinked, as a link needs two clips; that is refused while it is on a locked track.',
  args: z.object({ sequenceId: z.string().optional(), start: RT, end: RT, trackIds: z.array(z.string()).min(1).optional(), ripple: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.start, 'start');
    assertAligned(d, a.end, 'end');
    if (T.isNegative(a.start) || !T.lt(a.start, a.end)) throw new OpError('invalid_args', 'need 0 <= start < end');
    const tracks = a.trackIds ? a.trackIds.map((id) => mustTrack(seq, id)) : seq.tracks;
    const r = cutRange(d, seq, a.start, a.end, tracks, a.ripple !== false, ctx);
    return { affectedIds: [...new Set([...r.removed, ...r.changed, ...r.created, ...r.markersMoved, ...r.markersRemoved, ...r.unlinked])], summary: `Cut ${fmt(T.sub(a.end, a.start))} at ${fmt(a.start)}${a.ripple === false ? ' (gap left)' : ''}${r.markersRemoved.length ? `; ${r.markersRemoved.length} marker(s) on removed frames dropped` : ''}${r.unlinked.length ? `; ${r.unlinked.length} clip(s) no longer linked` : ''}`, output: { removedClipIds: r.removed, createdClipIds: r.created, movedMarkerIds: r.markersMoved, removedMarkerIds: r.markersRemoved, unlinkedClipIds: r.unlinked } };
  },
});

/** Open a gap of `len` at `at` on the given tracks: clips that start at or after `at` move later; a clip lying across `at` is split there and its later part moves. */
function openGap(d: ProjectDocument, at: T.RationalTime, len: T.RationalTime, tracks: Track[], ctx: OpContext) {
  const changed: string[] = [], created: string[] = [];
  const relink = new Map<string, string>();
  for (const track of tracks) {
    if (track.locked) throw new OpError('track_locked', `track ${track.id} is locked, so the insert cannot keep tracks in sync`, { trackId: track.id }, 'Unlock the track, or pass trackIds without it (other tracks will then shift relative to it).');
    const next: Clip[] = [];
    for (const clip of track.clips) {
      const cEnd = clipEnd(clip);
      if (!T.lt(at, cEnd)) { next.push(clip); continue; }
      if (!T.lt(clip.start, at)) { clip.start = T.add(clip.start, len); changed.push(clip.id); next.push(clip); continue; }
      // the clip lies across the insert point: same rules as a cut that removes nothing
      const right = structuredClone(clip);
      const delta = T.sub(at, clip.start);
      right.id = ctx.newId('clp');
      copyOverrides(d, clip.id, right.id);
      created.push(right.id);
      if (right.type === 'media' && right.linkGroupId) {
        if (!relink.has(right.linkGroupId)) relink.set(right.linkGroupId, ctx.newId('lnk'));
        right.linkGroupId = relink.get(right.linkGroupId)!;
      }
      if (right.type === 'media' && clip.type === 'media') { delete right.transition; delete right.fadeIn; setPart(right, clip, delta, T.sub(cEnd, at)); }
      if (right.type === 'caption') delete right.words;
      shiftKeyframes(right, delta);
      right.start = T.add(at, len);
      right.duration = T.sub(cEnd, at);
      clampFades(right);
      fitTextAnimation(right, d.settings.frameRate, { in: false, out: true }); // a title's entrance stays with the first part, its exit with the last
      if (clip.type === 'media') { delete clip.fadeOut; setPart(clip, clip, T.ZERO, delta); }
      clip.duration = delta;
      clampFades(clip);
      fitTextAnimation(clip, d.settings.frameRate, { in: true, out: false });
      if (clip.type === 'caption') delete clip.words;
      changed.push(clip.id);
      next.push(clip, right);
    }
    track.clips = next;
    sortClips(track);
  }
  // A clip divided here whose linked clip was not (on a track left out of trackIds): the later part is linked to nothing.
  const unlinked = dissolveLoneLinks(d, [...relink.keys(), ...relink.values()]);
  return { changed, created, unlinked };
}

defineOp({
  name: 'insert_gap',
  version: 1,
  description: 'Open an empty, frame-aligned stretch of time at a point on the timeline (ripple insert): everything at or after it moves later on every track, a clip lying across the point is split there, and markers at or after the point move too, so picture, sound and captions stay in sync. Follow it with add_clip at the same point, in the same transaction, to insert material. A locked track makes it fail rather than drift.',
  args: z.object({ sequenceId: z.string().optional(), at: RT, duration: RT, trackIds: z.array(z.string()).min(1).optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.at, 'at');
    assertAligned(d, a.duration, 'duration');
    if (T.isNegative(a.at) || !T.lt(T.ZERO, a.duration)) throw new OpError('invalid_args', 'need at >= 0 and duration > 0');
    const tracks = a.trackIds ? a.trackIds.map((id) => mustTrack(seq, id)) : seq.tracks;
    const r = openGap(d, a.at, a.duration, tracks, ctx);
    const moved: string[] = [];
    if (!a.trackIds) for (const m of Object.values(d.markers ?? {})) if (m.sequenceId === seq.id && !T.lt(m.time, a.at)) { m.time = T.add(m.time, a.duration); moved.push(m.id); }
    return { affectedIds: [...new Set([...r.changed, ...r.created, ...moved, ...r.unlinked])], summary: `Opened ${fmt(a.duration)} at ${fmt(a.at)}`, output: { createdClipIds: r.created, movedMarkerIds: moved, unlinkedClipIds: r.unlinked } };
  },
});

defineOp({
  name: 'close_gaps',
  version: 1,
  description: 'Remove every stretch of time in which no track has a clip (empty time on all tracks at once), moving later material earlier so nothing else changes. Optionally only inside [from, to). A gap that exists on some tracks while another track has a clip there is not empty time and stays. Markers move as with cut_range.',
  args: z.object({ sequenceId: z.string().optional(), from: RT.optional(), to: RT.optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    if (a.from) assertAligned(d, a.from, 'from');
    if (a.to) assertAligned(d, a.to, 'to');
    const lo = a.from ?? T.ZERO, hi = a.to ?? sequenceDuration(d, seq.id);
    if (T.isNegative(lo) || !T.lt(lo, hi)) throw new OpError('invalid_args', 'need 0 <= from < to (to defaults to the end of the timeline)');
    // occupied intervals over all tracks, merged
    const spans = seq.tracks.flatMap((t) => t.clips.map((c) => ({ s: c.start, e: clipEnd(c) }))).sort((x, y) => T.cmp(x.s, y.s));
    const gaps: { start: T.RationalTime; end: T.RationalTime }[] = [];
    let cursor = lo;
    for (const sp of spans) {
      if (!T.lt(sp.s, hi)) break;
      if (T.lt(cursor, sp.s)) gaps.push({ start: cursor, end: sp.s });
      cursor = T.max(cursor, sp.e);
    }
    if (a.to && T.lt(cursor, hi) && spans.some((sp) => !T.lt(sp.s, hi))) gaps.push({ start: cursor, end: hi }); // empty time up to `to` only counts if something comes after it
    if (gaps.length === 0) throw new OpError('not_found', 'there is no empty time to close', {}, 'A gap on one track under a clip on another track is not empty time; use move_clip for that.');
    const affected = new Set<string>();
    for (const g of gaps.reverse()) { const c = cutRange(d, seq, g.start, g.end, seq.tracks, true, ctx); for (const id of [...c.changed, ...c.markersMoved, ...c.markersRemoved, ...c.unlinked]) affected.add(id); }
    const total = gaps.reduce((n, g) => T.add(n, T.sub(g.end, g.start)), T.ZERO);
    return { affectedIds: [...affected], summary: `Closed ${gaps.length} gap(s), ${fmt(total)} in all`, output: { gaps: gaps.reverse(), removed: total } };
  },
});

defineOp({
  name: 'delete_transcript_range',
  version: 1,
  description: 'Text-based editing: remove the given spoken words (first to last, inclusive) from the timeline wherever that media is used, also where a clip shows a copy that keeps its timing (an enhanced picture, a cleaned-up voice, a smoother slow motion; mapped exactly onto the copy\'s own clock). Picture, sound and captions are cut together and later material closes the gap. Needs word-level timing; cut points snap to the nearest frame. assetId may also be such a copy: the transcript of the recording it was made from is used. A clip that shows a copy made without a recorded time mapping (reversed, stretched or generated) is skipped, as a clip that plays backwards is, and named in the output (skippedClips), since where the words are in it is unknown; refused when the words are on no other clip.',
  args: z.object({ sequenceId: z.string().optional(), assetId: z.string(), fromWordId: z.string(), toWordId: z.string(), allowApproximate: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    // the asset's own transcript, else that of the recording a time-preserving copy was made from (lineage.ts)
    const tr = transcriptFor(d, a.assetId)?.transcript;
    if (!tr) throw new OpError('not_found', `asset ${a.assetId} has no transcript`, { assetId: a.assetId });
    const anchor = tr.assetId;
    const flat = tr.segments.flatMap((s) => s.words.map((w) => ({ w, s })));
    const i = flat.findIndex((x) => x.w.id === a.fromWordId), j = flat.findIndex((x) => x.w.id === a.toWordId);
    if (i < 0 || j < i) throw new OpError('not_found', 'fromWordId/toWordId must be words of this transcript, in order', { fromWordId: a.fromWordId, toWordId: a.toWordId });
    const picked = flat.slice(i, j + 1);
    if (!a.allowApproximate && picked.some((x) => x.s.timing !== 'word'))
      throw new OpError('incompatible', 'these words only have estimated times, so a word-precise cut would be a guess', { timing: 'approximate' }, 'Use cut_range with explicit times, or pass allowApproximate=true to accept an estimated cut.');
    const srcStart = picked[0]!.w.start, last = picked.at(-1)!.w, srcEnd = T.add(last.start, last.duration);
    // clips of copies without a recorded time mapping are skipped and named; an edit that finds the words nowhere else is refused
    const untimed = timingCoverage(d, anchor, seq.id).untimed;
    const refuseUntimed = () => { const r = untimedCopyRefusal(untimed); return new OpError(r.code, r.message, r.details, r.hint); };
    const rate = d.settings.frameRate;
    const rel = timingRelations(d, anchor);
    const ranges: { start: T.RationalTime; end: T.RationalTime }[] = [];
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'media' || c.reverse) continue; // a reversed clip does not play the words
        const k = rel(c.assetId);
        if (k?.kind !== 'same') continue; // the recording itself, or a time-preserving copy: the words on that file's own clock
        const from = T.max(c.sourceIn, T.add(srcStart, k.delta)), to = T.min(sourceEnd(c), T.add(srcEnd, k.delta));
        if (!T.lt(from, to)) continue;
        const start = T.snapToFrame(timelineAt(c, from), rate), end = T.snapToFrame(timelineAt(c, to), rate);
        if (T.lt(start, end) && !ranges.some((r) => T.eq(r.start, start) && T.eq(r.end, end))) ranges.push({ start, end });
      }
    if (ranges.length === 0) { if (untimed.length) throw refuseUntimed(); throw new OpError('not_found', 'those words are not on the timeline (already cut, or shorter than one frame)', { assetId: a.assetId }); }
    ranges.sort((x, y) => T.cmp(y.start, x.start)); // latest first, so earlier ranges keep their times
    const affected = new Set<string>();
    for (const r of ranges) { const c = cutRange(d, seq, r.start, r.end, seq.tracks, true, ctx); for (const id of [...c.removed, ...c.changed, ...c.created, ...c.markersMoved, ...c.markersRemoved, ...c.unlinked]) affected.add(id); }
    const text = picked.map((x) => x.w.text).join(' ');
    const skipped = skippedClips(untimed);
    return { affectedIds: [...affected], summary: `Removed "${text.slice(0, 40)}" from the timeline${skipped.length ? `; ${skipped.length} clip(s) showing a copy that does not keep the recording's timing not searched` : ''}`, output: { ranges: ranges.reverse(), words: picked.length, ...(skipped.length ? { skippedClips: skipped } : {}) } };
  },
});

export interface OpCall { op: string; args: unknown }
export interface TransactionResult { doc: ProjectDocument; results: (OpResult & { op: string })[]; affectedIds: string[]; summary: string }

export function makeIdSource(seed: string): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_${seed}${(n++).toString(36)}`;
}

/**
 * Test hook (commit-equivalence.test.ts): true makes applyTransaction copy the document with structuredClone, as it did before
 * cloneDocument (clone.ts), so the tests can run the reference path beside the fast one. Never set outside tests.
 */
export const REFERENCE_PATH = { on: false };

/**
 * Apply ops all-or-nothing to a private copy. Never mutates `doc`. Throws OpError.
 * `allowInternal` is set only by trusted server code paths, never from request data.
 */
export function applyTransaction(doc: ProjectDocument, ops: OpCall[], opts: { idSeed: string; actor: string; allowInternal?: boolean }): TransactionResult {
  const draft = REFERENCE_PATH.on ? structuredClone(doc) : cloneDocument(doc);
  const ctx: OpContext = { newId: makeIdSource(opts.idSeed), actor: opts.actor };
  const results: TransactionResult['results'] = [];
  ops.forEach((call, index) => {
    const def = registry.get(call.op);
    if (!def) throw new OpError('unknown_op', `unknown operation "${call.op}"`, { index }, 'Call describe_ops for the available operations.');
    if (def.internal && !opts.allowInternal) throw new OpError('forbidden_op', `operation "${call.op}" is internal`, { index });
    const parsed = def.args.safeParse(call.args);
    if (!parsed.success) throw new OpError('invalid_args', `invalid arguments for ${call.op}: ${z.prettifyError(parsed.error)}`, { index, issues: parsed.error.issues });
    try {
      refuseInheritedIds(parsed.data, call.op, '', def.checksOwnIds);
      results.push({ op: call.op, ...def.apply(draft, parsed.data, ctx) });
    } catch (e) {
      if (e instanceof OpError) e.details = { index, op: call.op, ...e.details };
      throw e;
    }
  });
  const issues = validateProject(draft);
  if (issues.length) throw new OpError('invalid_result', `transaction would produce an invalid project: ${issues[0]!.message}`, { issues });
  return { doc: draft, results, affectedIds: [...new Set(results.flatMap((r) => r.affectedIds))], summary: results.map((r) => r.summary).join('; ') };
}
