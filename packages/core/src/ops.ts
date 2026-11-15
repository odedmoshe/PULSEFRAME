/**
 * Operation registry (SPEC §6). Every persistent edit is a named, schema-validated,
 * pure state transition. UI, REST and MCP all go through `applyTransaction`.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import {
  ANIMATABLE, AssetSchema, EASINGS, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, RationalTimeSchema as RT, TextStyleSchema, TransformSchema,
  CaptionStyleSchema, DEFAULT_CAPTION_STYLE,
  type CaptionStyle, type Clip, type MediaClip, type ProjectDocument, type Sequence, type Track, type Transcript,
} from './schema.ts';
import { parseSubtitles, snapCuesToFrames } from './subtitles.ts';
import { BLEND_MODES, DEFAULT_MASK, EFFECTS, effectParams, findEffect, MaskSchema, TRANSITION_IDS } from './effects.ts';
import { clipEnd, forbidsOverlap, validateProject } from './validate.ts';
import { restoreEntities, transcriptEntityId, type EntityState } from './entities.ts';
import { sampleKeyframes, shiftKeyframes } from './animation.ts';

export type OpErrorCode =
  | 'unknown_op' | 'invalid_args' | 'not_found' | 'track_locked' | 'overlap' | 'out_of_bounds'
  | 'incompatible' | 'forbidden_op' | 'invalid_result';
export class OpError extends Error {
  constructor(public code: OpErrorCode, message: string, public details: Record<string, unknown> = {}, public hint?: string) {
    super(message);
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

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
  /** Mutates the draft (a private deep copy). Throw OpError to reject the whole transaction. */
  apply(draft: ProjectDocument, args: z.infer<S>, ctx: OpContext): OpResult;
}

const registry = new Map<string, OpDefinition>();
function defineOp<S extends z.ZodType>(def: OpDefinition<S>) {
  if (registry.has(def.name)) throw new Error(`duplicate op ${def.name}`);
  registry.set(def.name, def as unknown as OpDefinition);
}
export const listOps = () => [...registry.values()];
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
const mustClip = (d: ProjectDocument, clipId: string) => {
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
const sortClips = (t: Track) => t.clips.sort((a, b) => T.cmp(a.start, b.start) || (a.id < b.id ? -1 : 1));
const overlaps = (t: Track, start: T.RationalTime, end: T.RationalTime, ignore: Set<string>) =>
  t.clips.find((c) => !ignore.has(c.id) && T.lt(c.start, end) && T.lt(start, clipEnd(c)));
function assertFree(t: Track, start: T.RationalTime, end: T.RationalTime, ignore = new Set<string>()) {
  if (!forbidsOverlap(t)) return;
  const hit = overlaps(t, start, end, ignore);
  if (hit) throw new OpError('overlap', `range overlaps clip ${hit.id} on track ${t.id}`, { trackId: t.id, clipId: hit.id, clipStart: hit.start, clipEnd: clipEnd(hit) }, 'Choose a free range, another track, or omit trackId to auto-place.');
}
function assertAligned(d: ProjectDocument, t: T.RationalTime, what: string) {
  if (!T.isFrameAligned(t, d.settings.frameRate))
    throw new OpError('invalid_args', `${what} must fall on a ${d.settings.frameRate.num}/${d.settings.frameRate.den} fps frame boundary`, { value: t, nearest: T.snapToFrame(t, d.settings.frameRate) }, 'Use the returned nearest value.');
}
function newTrack(seq: Sequence, kind: Track['kind'], ctx: OpContext, name?: string): Track {
  const count = seq.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = { id: ctx.newId('trk'), kind, name: name ?? `${kind === 'video' ? 'V' : kind === 'audio' ? 'A' : kind === 'caption' ? 'C' : 'T'}${count}`, locked: false, muted: false, hidden: false, clips: [] };
  // Bottom-most first: picture tracks, then text tracks, then audio.
  const at = kind === 'audio' ? -1 : kind === 'video' ? seq.tracks.findIndex((t) => t.kind !== 'video') : seq.tracks.findIndex((t) => t.kind === 'audio');
  seq.tracks.splice(at < 0 ? seq.tracks.length : at, 0, track);
  return track;
}
/** First unlocked track of `kind` where [start,end) is free; otherwise a new track. */
function placeTrack(seq: Sequence, kind: Track['kind'], start: T.RationalTime, end: T.RationalTime, ctx: OpContext): Track {
  for (const t of seq.tracks) if (t.kind === kind && !t.locked && !(forbidsOverlap(t) && overlaps(t, start, end, new Set()))) return t;
  return newTrack(seq, kind, ctx);
}
const linked = (d: ProjectDocument, clip: Clip) => {
  if (clip.type !== 'media' || !clip.linkGroupId) return [];
  const out: { track: Track; clip: MediaClip }[] = [];
  for (const seq of Object.values(d.sequences))
    for (const track of seq.tracks)
      for (const c of track.clips) if (c.type === 'media' && c.id !== clip.id && c.linkGroupId === clip.linkGroupId) out.push({ track, clip: c });
  for (const l of out) if (l.track.locked) throw new OpError('track_locked', `linked clip ${l.clip.id} is on locked track ${l.track.id}`, { trackId: l.track.id, clipId: l.clip.id }, 'Unlock the track or pass includeLinked=false.');
  return out;
};
const fmt = (t: T.RationalTime) => `${T.toSeconds(t).toFixed(3)}s`;

// ---------- operations ----------
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
  name: 'add_track',
  version: 1,
  description: 'Add an empty track. Picture tracks stack bottom-to-top in list order; audio tracks mix.',
  args: z.object({ sequenceId: z.string().optional(), kind: z.enum(['video', 'audio', 'text']), name: z.string().max(128).optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    const t = newTrack(seq, a.kind, ctx, a.name);
    return { affectedIds: [t.id], summary: `Added ${a.kind} track ${t.name}`, output: { trackId: t.id } };
  },
});

defineOp({
  name: 'add_clip',
  version: 1,
  description:
    'Place a source asset on the timeline. A video asset with sound also gets a linked audio clip. Omit trackId to auto-place on the first free compatible track. start and duration must be frame-aligned; duration defaults to the rest of the source.',
  args: z
    .object({
      sequenceId: z.string().optional(),
      assetId: z.string(),
      trackId: z.string().optional(),
      start: RT,
      sourceIn: RT.optional(),
      duration: RT.optional(),
      withLinkedAudio: z.boolean().optional().describe('Default true'),
    })
    .strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId }, 'Call get_summary to list assets.');
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
      const track = !hasPicture && explicit ? explicit : placeTrack(seq, 'audio', a.start, end, ctx);
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
  description: 'Add a text layer. Text is shaped with bidi support; Hebrew defaults to right-to-left. Position is the layer centre relative to frame centre (x,y fractions).',
  args: z
    .object({ sequenceId: z.string().optional(), trackId: z.string().optional(), text: z.string().min(1).max(2000), start: RT, duration: RT, style: TextStyleSchema.partial().optional(), transform: TransformSchema.partial().optional() })
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
    const clip: Clip = { id: ctx.newId('clp'), type: 'text', text: a.text, start: a.start, duration: a.duration, style: { ...DEFAULT_TEXT_STYLE, ...a.style }, transform: { ...DEFAULT_TRANSFORM, ...a.transform } };
    track.clips.push(clip);
    sortClips(track);
    return { affectedIds: [clip.id], summary: `Added text "${a.text.slice(0, 40)}" at ${fmt(a.start)}`, output: { clipId: clip.id, trackId: track.id } };
  },
});

defineOp({
  name: 'update_text',
  version: 1,
  description: 'Change the content and/or style of a text clip. Unspecified fields are kept.',
  args: z.object({ clipId: z.string(), text: z.string().min(1).max(2000).optional(), style: TextStyleSchema.partial().optional() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'text') throw new OpError('incompatible', `clip ${a.clipId} is not a text clip`, { clipId: a.clipId });
    if (a.text !== undefined) clip.text = a.text;
    if (a.style) clip.style = { ...clip.style, ...a.style };
    return { affectedIds: [clip.id], summary: `Updated text "${clip.text.slice(0, 40)}"` };
  },
});

defineOp({
  name: 'set_clip_transform',
  version: 1,
  description: 'Set position/scale/rotation/opacity of a picture or text clip. Unspecified fields are kept.',
  args: z.object({ clipId: z.string(), transform: TransformSchema.partial() }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    clip.transform = { ...clip.transform, ...a.transform };
    return { affectedIds: [clip.id], summary: `Transformed clip ${clip.id}` };
  },
});

const KfTarget = { clipId: z.string(), property: z.enum(ANIMATABLE), time: RT.describe('Offset from the clip start (frame-aligned). Use the playhead minus the clip start.') };
defineOp({
  name: 'set_keyframe',
  version: 1,
  description: 'Add or replace a keyframe for x, y, scale, rotation or opacity at a clip-local time. The first keyframe on a property starts animating it; between keys the value is interpolated with the easing of the earlier key.',
  args: z.object({ ...KfTarget, value: z.number(), easing: z.enum(EASINGS).optional().describe('Default linear') }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    assertAligned(d, a.time, 'time');
    if (!TransformSchema.shape[a.property].safeParse(a.value).success) throw new OpError('invalid_args', `value ${a.value} is out of range for ${a.property}`, { property: a.property });
    const keys = [...(clip.keyframes?.[a.property] ?? [])];
    const i = keys.findIndex((k) => T.eq(k.time, a.time));
    const key = { time: a.time, value: a.value, easing: a.easing ?? (i >= 0 ? keys[i]!.easing : 'linear') };
    if (i >= 0) keys[i] = key;
    else keys.push(key);
    keys.sort((x, y) => T.cmp(x.time, y.time));
    clip.keyframes = { ...clip.keyframes, [a.property]: keys };
    return { affectedIds: [clip.id], summary: `Keyframe ${a.property}=${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length } };
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
      clip.transform = { ...clip.transform, [p]: sampleKeyframes(keys, a.at ?? T.ZERO) };
      delete kf[p];
    }
    if (Object.keys(kf).length) clip.keyframes = kf;
    else delete clip.keyframes;
    return { affectedIds: [clip.id], summary: `Cleared ${a.property ?? 'all'} keyframes` };
  },
});

defineOp({
  name: 'set_clip_gain',
  version: 1,
  description: 'Set the linear audio gain of a media clip (1 = unity, 0 = silent).',
  args: z.object({ clipId: z.string(), gain: z.number().min(0).max(8) }).strict(),
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
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
      const end = clipEnd(clip);
      if (a.edge === 'end') {
        if (!T.lt(clip.start, a.to)) throw new OpError('out_of_bounds', 'trim would leave an empty clip', { clipId: clip.id });
        const duration = T.sub(a.to, clip.start);
        if (clip.type === 'media') {
          const asset = d.assets[clip.assetId]!;
          if (asset.kind !== 'image' && T.lt(asset.duration, T.add(clip.sourceIn, duration)))
            throw new OpError('out_of_bounds', 'not enough source material after the clip end', { clipId: clip.id, maxEnd: T.add(clip.start, T.sub(asset.duration, clip.sourceIn)) }, 'Extend no further than maxEnd.');
        }
        assertFree(track, clip.start, a.to, new Set([clip.id]));
        clip.duration = duration;
      } else {
        if (!T.lt(a.to, end) || T.isNegative(a.to)) throw new OpError('out_of_bounds', 'trim would leave an empty clip or start before 0', { clipId: clip.id });
        const delta = T.sub(a.to, clip.start);
        if (clip.type === 'media') {
          const sourceIn = T.add(clip.sourceIn, delta);
          if (T.isNegative(sourceIn)) throw new OpError('out_of_bounds', 'not enough source material before the clip start', { clipId: clip.id, minStart: T.sub(clip.start, clip.sourceIn) }, 'Extend no earlier than minStart.');
          clip.sourceIn = sourceIn;
        }
        assertFree(track, a.to, end, new Set([clip.id]));
        shiftKeyframes(clip, delta); // the animation stays attached to the content, not to the moved edge
        clip.start = a.to;
        clip.duration = T.sub(end, a.to);
        sortClips(track);
      }
    }
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Trimmed ${a.edge} of clip to ${fmt(a.to)}` };
  },
});

defineOp({
  name: 'split_clip',
  version: 1,
  description: 'Split a clip at a frame-aligned timeline time strictly inside it. Linked clips are split too and the right-hand halves stay linked to each other.',
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
      right.start = a.at;
      right.duration = T.sub(clip.duration, left);
      shiftKeyframes(right, left);
      if (clip.type === 'caption') { delete clip.words; delete (right as typeof clip).words; }
      if (right.type === 'media') delete right.transition; // the transition belongs to the original cut point
      if (right.type === 'media') { right.sourceIn = T.add(right.sourceIn, left); if (right.linkGroupId) right.linkGroupId = newLink; }
      clip.duration = left;
      track.clips.push(right);
      sortClips(track);
      created.push(right.id);
    }
    return { affectedIds: [...targets.map((t) => t.clip.id), ...created], summary: `Split clip at ${fmt(a.at)}`, output: { rightClipId: created[0], createdClipIds: created } };
  },
});

defineOp({
  name: 'delete_clip',
  version: 1,
  description: 'Remove a clip (and its linked clips unless includeLinked=false). Leaves a gap; the source asset is kept.',
  args: z.object({ clipId: z.string(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    const targets = [{ track: f.track, clip: f.clip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) track.clips.splice(track.clips.indexOf(clip), 1);
    return { affectedIds: targets.map((t) => t.clip.id), summary: `Deleted ${targets.length} clip(s)` };
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

const MOTION = ['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'] as const;
export const CLIP_MOTIONS = MOTION;
/** Offset from the resting transform at the far end of an entrance/exit. */
const MOTION_FROM: Record<(typeof MOTION)[number], Partial<Record<'opacity' | 'scale' | 'x' | 'y', (rest: number) => number>>> = {
  none: {},
  fade: { opacity: () => 0 },
  pop: { opacity: () => 0, scale: (r) => Math.max(0.01, r * 0.6) },
  'slide-up': { opacity: () => 0, y: (r) => r + 0.08 },
  'slide-down': { opacity: () => 0, y: (r) => r - 0.08 },
  'slide-left': { opacity: () => 0, x: (r) => r + 0.1 },
  'slide-right': { opacity: () => 0, x: (r) => r - 0.1 },
};
defineOp({
  name: 'animate_clip',
  version: 1,
  description: 'Give a text or picture clip an entrance and/or exit (fade, pop, slide). Writes ordinary keyframes on opacity/scale/x/y, replacing existing keys on the properties it uses, so the result stays editable with set_keyframe. The exit is placed against the current clip end; run again after changing the duration.',
  args: z.object({ clipId: z.string(), in: z.enum(MOTION).optional(), out: z.enum(MOTION).optional(), inFrames: z.number().int().min(1).max(600).optional(), outFrames: z.number().int().min(1).max(600).optional() }).strict(),
  apply(d, a) {
    const { clip, track } = mustClip(d, a.clipId);
    if (clip.type === 'caption' || track.kind === 'audio') throw new OpError('incompatible', 'only text and picture clips can be animated', { clipId: clip.id });
    const rate = d.settings.frameRate;
    const total = T.frameIndexAt(clip.duration, rate);
    const enter = a.in ?? 'none', exit = a.out ?? 'none';
    const nIn = enter === 'none' ? 0 : a.inFrames ?? 12, nOut = exit === 'none' ? 0 : a.outFrames ?? 12;
    if (nIn + nOut > total) throw new OpError('out_of_bounds', `entrance (${nIn}) plus exit (${nOut}) frames exceed the clip length (${total} frames)`, { clipFrames: total }, 'Use fewer frames.');
    const props = new Set([...Object.keys(MOTION_FROM[enter]), ...Object.keys(MOTION_FROM[exit])]) as Set<'opacity' | 'scale' | 'x' | 'y'>;
    if (props.size === 0) throw new OpError('invalid_args', 'choose an entrance and/or an exit');
    const keyframes = { ...clip.keyframes };
    for (const p of props) {
      const rest = clip.transform[p];
      const keys: { time: T.RationalTime; value: number; easing: (typeof EASINGS)[number] }[] = [];
      const from = MOTION_FROM[enter][p], to = MOTION_FROM[exit][p];
      if (from) keys.push({ time: T.ZERO, value: from(rest), easing: 'ease-out' });
      keys.push({ time: T.frameTime(nIn, rate), value: rest, easing: 'linear' });
      if (to) {
        if (total - nOut > nIn) keys.push({ time: T.frameTime(total - nOut, rate), value: rest, easing: 'ease-in' });
        else keys[keys.length - 1]!.easing = 'ease-in';
        keys.push({ time: T.frameTime(total, rate), value: to(rest), easing: 'linear' });
      }
      keyframes[p] = keys;
    }
    clip.keyframes = keyframes;
    return { affectedIds: [clip.id], summary: `Animated clip (${enter === 'none' ? '' : `in: ${enter}`}${enter !== 'none' && exit !== 'none' ? ', ' : ''}${exit === 'none' ? '' : `out: ${exit}`})`, output: { properties: [...props] } };
  },
});


// ---------- effects, blend, mask, transitions (SPEC §8, §13) ----------
const pictureClip = (d: ProjectDocument, clipId: string) => {
  const f = mustClip(d, clipId);
  if (f.clip.type === 'caption' || f.track.kind === 'audio') throw new OpError('incompatible', 'effects, blends, masks and transitions apply to picture and title clips', { clipId });
  return f;
};
const parseEffect = (type: string, params: unknown) => {
  if (!findEffect(type)) throw new OpError('not_found', `effect "${type}" does not exist`, { type, available: EFFECTS.map((e) => e.id) }, 'Call list_catalog for the available effects and their parameters.');
  try { return effectParams(type, params); } catch (e: any) { throw new OpError('invalid_args', `invalid parameters for ${type}`, { issues: e.issues?.slice(0, 8) }, 'Call list_catalog for the parameter schema.'); }
};
defineOp({
  name: 'add_effect',
  version: 1,
  description: 'Add an effect to a picture or title clip. Effects run in list order on the clip, before its mask, blend mode and opacity. Unspecified parameters take the effect\'s defaults. Discover effects with list_catalog.',
  args: z.object({ clipId: z.string(), type: z.string(), params: z.record(z.string(), z.unknown()).optional(), index: z.number().int().min(0).optional() }).strict(),
  apply(d, a, ctx) {
    const { clip } = pictureClip(d, a.clipId);
    const list = [...(clip.effects ?? [])];
    if (list.length >= 16) throw new OpError('out_of_bounds', 'a clip can carry at most 16 effects', { clipId: clip.id });
    const fx = { id: ctx.newId('fx'), type: a.type, enabled: true, params: parseEffect(a.type, a.params) };
    list.splice(Math.min(a.index ?? list.length, list.length), 0, fx);
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Added effect ${a.type}`, output: { effectId: fx.id, params: fx.params } };
  },
});
const mustEffect = (clip: Clip, effectId: string) => {
  const i = (clip.effects ?? []).findIndex((e) => e.id === effectId);
  if (i < 0) throw new OpError('not_found', `effect ${effectId} not found on clip ${clip.id}`, { effectId, clipId: clip.id });
  return i;
};
defineOp({
  name: 'update_effect',
  version: 1,
  description: 'Change parameters of an effect on a clip (unspecified ones are kept), bypass or re-enable it, or move it to another position in the clip\'s effect order.',
  args: z.object({ clipId: z.string(), effectId: z.string(), params: z.record(z.string(), z.unknown()).optional(), enabled: z.boolean().optional(), index: z.number().int().min(0).optional() }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const list = [...clip.effects!];
    const fx = { ...list[i]! };
    if (a.params) fx.params = parseEffect(fx.type, { ...fx.params, ...a.params });
    if (a.enabled !== undefined) fx.enabled = a.enabled;
    list.splice(i, 1);
    list.splice(Math.min(a.index ?? i, list.length), 0, fx);
    clip.effects = list;
    return { affectedIds: [clip.id], summary: `Updated effect ${fx.type}${a.enabled === false ? ' (bypassed)' : ''}`, output: { params: fx.params } };
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
  description: 'Set, change or clear (mask=null) a rectangle/ellipse mask on a picture clip. Position and size are fractions of the clip\'s own picture, so the mask moves and scales with it. Unspecified fields keep their current value (or the default for a new mask).',
  args: z.object({ clipId: z.string(), mask: MaskSchema.partial().nullable() }).strict(),
  apply(d, a) {
    const { clip, track } = pictureClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'video') throw new OpError('incompatible', 'masks apply to picture clips on video tracks', { clipId: clip.id });
    if (a.mask === null) { delete clip.mask; return { affectedIds: [clip.id], summary: 'Removed mask' }; }
    clip.mask = { ...(clip.mask ?? DEFAULT_MASK), ...a.mask };
    return { affectedIds: [clip.id], summary: `Mask ${clip.mask.shape}${clip.mask.invert ? ' (inverted)' : ''}`, output: { mask: clip.mask } };
  },
});
/** The clip that ends exactly where `clip` starts on the same track, if any. */
export function previousAdjacent(track: Track, clip: Clip): MediaClip | null {
  for (const c of track.clips) if (c.type === 'media' && c.id !== clip.id && T.eq(clipEnd(c), clip.start)) return c;
  return null;
}
defineOp({
  name: 'set_transition',
  version: 1,
  description: 'Put a transition at the START of a picture clip (type=null removes it). It plays over the clip\'s first frames while the previous clip on the same track keeps playing underneath, which needs that many unused source frames after the previous clip\'s out point. With no previous clip the transition reveals the clip over the layers below. Sound is not crossfaded.',
  args: z.object({ clipId: z.string(), type: z.enum(TRANSITION_IDS).nullable(), frames: z.number().int().min(1).max(150).optional() }).strict(),
  apply(d, a) {
    const { clip, track } = pictureClip(d, a.clipId);
    if (clip.type !== 'media' || track.kind !== 'video') throw new OpError('incompatible', 'transitions apply to picture clips on video tracks', { clipId: clip.id });
    if (a.type === null) { delete clip.transition; return { affectedIds: [clip.id], summary: 'Removed transition' }; }
    const rate = d.settings.frameRate;
    const frames = a.frames ?? 15;
    const own = T.frameIndexAt(clip.duration, rate);
    if (frames > own) throw new OpError('out_of_bounds', `the transition (${frames} frames) is longer than the clip (${own} frames)`, { maxFrames: own }, 'Use at most maxFrames.');
    const prev = previousAdjacent(track, clip);
    if (prev) {
      const asset = d.assets[prev.assetId]!;
      if (asset.kind !== 'image') {
        const handle = T.frameIndexAt(T.sub(asset.duration, T.add(prev.sourceIn, prev.duration)), rate);
        if (handle < frames) throw new OpError('out_of_bounds', `the previous clip has only ${handle} unused source frames after its end; the transition needs ${frames}`, { maxFrames: handle, previousClipId: prev.id }, handle > 0 ? 'Use at most maxFrames, or trim the end of the previous clip to free more source.' : 'Trim the end of the previous clip to free source frames for the transition.');
      }
    }
    clip.transition = { type: a.type, frames };
    return { affectedIds: [clip.id], summary: `Transition ${a.type} (${frames} frames)`, output: { previousClipId: prev?.id ?? null } };
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
function buildTranscript(d: ProjectDocument, ctx: OpContext, assetId: string, language: string, kind: 'import' | 'manual', segments: z.infer<typeof SegmentIn>[]): Transcript {
  const asset = d.assets[assetId];
  if (!asset) throw new OpError('not_found', `asset ${assetId} not found`, { assetId });
  if (!asset.audio) throw new OpError('incompatible', `asset ${assetId} has no audio to transcribe`, { assetId });
  const out: Transcript = { assetId, language, origin: { kind, provider: null, model: null, createdAt: 'op', createdBy: ctx.actor }, segments: [] };
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
function cutRange(seq: Sequence, start: T.RationalTime, end: T.RationalTime, tracks: Track[], ripple: boolean, ctx: OpContext) {
  const len = T.sub(end, start);
  const removed: string[] = [], changed: string[] = [], created: string[] = [];
  const relink = new Map<string, string>();
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
      if (!hasLeft && !hasRight) { removed.push(clip.id); continue; }
      let right: Clip | null = null;
      if (hasRight) {
        right = hasLeft ? structuredClone(clip) : clip;
        const delta = T.sub(end, clip.start);
        if (hasLeft) {
          right.id = ctx.newId('clp');
          created.push(right.id);
          if (right.type === 'media' && right.linkGroupId) {
            if (!relink.has(right.linkGroupId)) relink.set(right.linkGroupId, ctx.newId('lnk'));
            right.linkGroupId = relink.get(right.linkGroupId)!;
          }
        }
        if (right.type === 'media' && hasLeft) delete right.transition;
        if (right.type === 'media') right.sourceIn = T.add(right.sourceIn, delta);
        if (right.type === 'caption') delete right.words;
        shiftKeyframes(right, delta);
        right.start = ripple ? start : end;
        right.duration = T.sub(cEnd, end);
      }
      if (hasLeft) {
        clip.duration = T.sub(start, clip.start);
        if (clip.type === 'caption') delete clip.words;
        next.push(clip);
      }
      changed.push(clip.id);
      if (right) next.push(right);
    }
    track.clips = next;
    sortClips(track);
  }
  return { removed, changed, created };
}

defineOp({
  name: 'cut_range',
  version: 1,
  description: 'Remove a frame-aligned time range from the timeline. By default every track is cut and later material moves earlier (ripple) so picture, sound and captions stay in sync. A locked track makes the cut fail rather than drift.',
  args: z.object({ sequenceId: z.string().optional(), start: RT, end: RT, trackIds: z.array(z.string()).min(1).optional(), ripple: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.start, 'start');
    assertAligned(d, a.end, 'end');
    if (T.isNegative(a.start) || !T.lt(a.start, a.end)) throw new OpError('invalid_args', 'need 0 <= start < end');
    const tracks = a.trackIds ? a.trackIds.map((id) => mustTrack(seq, id)) : seq.tracks;
    const r = cutRange(seq, a.start, a.end, tracks, a.ripple !== false, ctx);
    return { affectedIds: [...new Set([...r.removed, ...r.changed, ...r.created])], summary: `Cut ${fmt(T.sub(a.end, a.start))} at ${fmt(a.start)}${a.ripple === false ? ' (gap left)' : ''}`, output: { removedClipIds: r.removed, createdClipIds: r.created } };
  },
});

defineOp({
  name: 'delete_transcript_range',
  version: 1,
  description: 'Text-based editing: remove the given spoken words (first to last, inclusive) from the timeline wherever that media is used. Picture, sound and captions are cut together and later material closes the gap. Needs word-level timing; cut points snap to the nearest frame.',
  args: z.object({ sequenceId: z.string().optional(), assetId: z.string(), fromWordId: z.string(), toWordId: z.string(), allowApproximate: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    const tr = d.transcripts[a.assetId];
    if (!tr) throw new OpError('not_found', `asset ${a.assetId} has no transcript`, { assetId: a.assetId });
    const flat = tr.segments.flatMap((s) => s.words.map((w) => ({ w, s })));
    const i = flat.findIndex((x) => x.w.id === a.fromWordId), j = flat.findIndex((x) => x.w.id === a.toWordId);
    if (i < 0 || j < i) throw new OpError('not_found', 'fromWordId/toWordId must be words of this transcript, in order', { fromWordId: a.fromWordId, toWordId: a.toWordId });
    const picked = flat.slice(i, j + 1);
    if (!a.allowApproximate && picked.some((x) => x.s.timing !== 'word'))
      throw new OpError('incompatible', 'these words only have estimated times, so a word-precise cut would be a guess', { timing: 'approximate' }, 'Use cut_range with explicit times, or pass allowApproximate=true to accept an estimated cut.');
    const srcStart = picked[0]!.w.start, last = picked.at(-1)!.w, srcEnd = T.add(last.start, last.duration);
    const rate = d.settings.frameRate;
    const ranges: { start: T.RationalTime; end: T.RationalTime }[] = [];
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'media' || c.assetId !== a.assetId) continue;
        const from = T.max(c.sourceIn, srcStart), to = T.min(T.add(c.sourceIn, c.duration), srcEnd);
        if (!T.lt(from, to)) continue;
        const start = T.snapToFrame(T.add(c.start, T.sub(from, c.sourceIn)), rate), end = T.snapToFrame(T.add(c.start, T.sub(to, c.sourceIn)), rate);
        if (T.lt(start, end) && !ranges.some((r) => T.eq(r.start, start) && T.eq(r.end, end))) ranges.push({ start, end });
      }
    if (ranges.length === 0) throw new OpError('not_found', 'those words are not on the timeline (already cut, or shorter than one frame)', { assetId: a.assetId });
    ranges.sort((x, y) => T.cmp(y.start, x.start)); // latest first, so earlier ranges keep their times
    const affected = new Set<string>();
    for (const r of ranges) { const c = cutRange(seq, r.start, r.end, seq.tracks, true, ctx); for (const id of [...c.removed, ...c.changed, ...c.created]) affected.add(id); }
    const text = picked.map((x) => x.w.text).join(' ');
    return { affectedIds: [...affected], summary: `Removed "${text.slice(0, 40)}" from the timeline`, output: { ranges: ranges.reverse(), words: picked.length } };
  },
});

export interface OpCall { op: string; args: unknown }
export interface TransactionResult { doc: ProjectDocument; results: (OpResult & { op: string })[]; affectedIds: string[]; summary: string }

export function makeIdSource(seed: string): (prefix: string) => string {
  let n = 0;
  return (prefix) => `${prefix}_${seed}${(n++).toString(36)}`;
}

/**
 * Apply ops all-or-nothing to a private copy. Never mutates `doc`. Throws OpError.
 * `allowInternal` is set only by trusted server code paths, never from request data.
 */
export function applyTransaction(doc: ProjectDocument, ops: OpCall[], opts: { idSeed: string; actor: string; allowInternal?: boolean }): TransactionResult {
  const draft = structuredClone(doc);
  const ctx: OpContext = { newId: makeIdSource(opts.idSeed), actor: opts.actor };
  const results: TransactionResult['results'] = [];
  ops.forEach((call, index) => {
    const def = registry.get(call.op);
    if (!def) throw new OpError('unknown_op', `unknown operation "${call.op}"`, { index }, 'Call describe_ops for the available operations.');
    if (def.internal && !opts.allowInternal) throw new OpError('forbidden_op', `operation "${call.op}" is internal`, { index });
    const parsed = def.args.safeParse(call.args);
    if (!parsed.success) throw new OpError('invalid_args', `invalid arguments for ${call.op}: ${z.prettifyError(parsed.error)}`, { index, issues: parsed.error.issues });
    try {
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
