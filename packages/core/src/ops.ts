/**
 * Operation registry (SPEC §6). Every persistent edit is a named, schema-validated,
 * pure state transition. UI, REST and MCP all go through `applyTransaction`.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import {
  ANIMATABLE, AssetSchema, EASINGS, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, RationalTimeSchema as RT, TextStyleSchema, TransformSchema,
  CaptionStyleSchema, DEFAULT_CAPTION_STYLE, SafeAreaSchema, MARKER_COLORS,
  type CaptionStyle, type Clip, type MediaClip, type ProjectDocument, type Marker, type Sequence, type Track, type Transcript, type Variant,
} from './schema.ts';
import { findProfile, FORMAT_PROFILES } from './variants.ts';
import { parseSubtitles, snapCuesToFrames } from './subtitles.ts';
import { handleAfterEnd, pictureSourceAt, sourceEnd, sourceInOfPart, speedFromNumber, timelineAt, toSourceSpan, toTimelineSpan } from './speed.ts';
import { animatableParams, BLEND_MODES, DEFAULT_MASK, EFFECTS, effectParams, findEffect, MaskSchema, TRANSITION_IDS } from './effects.ts';
import { clipEnd, forbidsOverlap, sequenceDuration, validateProject } from './validate.ts';
import { analysisEntityId, fingerprint, restoreEntities, trackOrderEntityId, transcriptEntityId, type EntityState } from './entities.ts';
import { effectParamsAt, sampleKeyframes, shiftKeyframes, transformAt } from './animation.ts';

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
/** After a clip gets shorter, keep its audio fades inside it (fade-in first, then whatever room is left for the fade-out). */
function clampFades(clip: Clip) {
  if (clip.type !== 'media' || (!clip.fadeIn && !clip.fadeOut)) return;
  const fin = T.min(clip.fadeIn ?? T.ZERO, clip.duration);
  const fout = T.min(clip.fadeOut ?? T.ZERO, T.sub(clip.duration, fin));
  if (T.isZero(fin)) delete clip.fadeIn; else clip.fadeIn = fin;
  if (T.isZero(fout)) delete clip.fadeOut; else clip.fadeOut = fout;
}
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
  description: 'Remove a file from the project library, together with its transcript and analysis results. Refused while any clip uses it. The stored media file itself stays on disk until the owner cleans up storage, so undo brings the library entry back.',
  args: z.object({ assetId: z.string() }).strict(),
  apply(d, a) {
    const asset = d.assets[a.assetId];
    if (!asset) throw new OpError('not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    const users = Object.values(d.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'media' && c.assetId === asset.id).map((c) => c.id);
    if (users.length) throw new OpError('incompatible', `${users.length} clip(s) on the timeline still use this file`, { assetId: asset.id, clipIds: users.slice(0, 50) }, 'Delete those clips first.');
    const affected = [asset.id];
    if (d.transcripts?.[asset.id]) { delete d.transcripts[asset.id]; affected.push(transcriptEntityId(asset.id)); }
    if (d.analyses?.[asset.id]) { delete d.analyses[asset.id]; affected.push(analysisEntityId(asset.id)); }
    delete d.assets[asset.id];
    return { affectedIds: affected, summary: `Removed "${asset.name.slice(0, 60)}" from the library` };
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
  name: 'set_clip_speed',
  version: 1,
  description: 'Play a clip faster or slower (0.1–8; 0.5 = half speed / slow motion, 2 = double speed). The clip keeps showing the same stretch of source, so its length on the timeline changes (rounded down to a whole frame); nothing else moves. Linked picture and sound change together. Sound is resampled with the picture, so its pitch rises and falls with the speed.',
  args: z.object({ clipId: z.string(), speed: z.number().min(0.1).max(8), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only media clips have a speed', { clipId: a.clipId });
    if (f.clip.freeze) throw new OpError('incompatible', 'a freeze frame has no speed', { clipId: a.clipId }, 'Trim it to change how long the picture is held.');
    const rate = d.settings.frameRate;
    const speed = speedFromNumber(a.speed);
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { track, clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      const span = toSourceSpan(clip, clip.duration); // source shown now; stays the same
      if (speed.num === speed.den) delete clip.speed; else clip.speed = speed;
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

const volumeTarget = (d: ProjectDocument, clipId: string) => {
  const f = mustClip(d, clipId);
  if (f.clip.type !== 'media' || f.track.kind !== 'audio') throw new OpError('incompatible', 'volume automation applies to clips on audio tracks', { clipId }, 'For a video clip, use its linked sound clip.');
  return f.clip;
};
defineOp({
  name: 'speed_ramp',
  version: 1,
  description: 'Change a clip\'s speed gradually from one value to another over its length. The clip is replaced by `steps` consecutive clips (and the same for its linked sound), each at a constant speed between `from` and `to`, playing the source on without gaps or repeats; a stepped ramp keeps every time exact. The ramp plays the same stretch of source as before (to within the rounding of each step to whole frames), so its length on the timeline changes; nothing else moves, and it is refused if the new length would run into the next clip. Not for clips with keyframes, volume keys or a transition, freeze frames, reversed clips or stills. One undo restores the single clip.',
  args: z.object({ clipId: z.string(), from: z.number().min(0.1).max(8), to: z.number().min(0.1).max(8), steps: z.number().int().min(2).max(24).optional().describe('Default 8'), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const f = mustClip(d, a.clipId);
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file have a speed', { clipId: a.clipId });
    const rate = d.settings.frameRate;
    const steps = a.steps ?? 8;
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : linked(d, f.clip))];
    for (const { clip } of targets) {
      if (d.assets[clip.assetId]?.kind === 'image') throw new OpError('incompatible', 'a still image has no speed', { clipId: clip.id });
      if (clip.freeze || clip.reverse) throw new OpError('incompatible', 'a freeze frame or a reversed clip cannot be ramped', { clipId: clip.id });
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
        const used = toSourceSpan(p, duration);
        if (T.lt(asset.duration, T.add(sourceIn, used))) throw new OpError('out_of_bounds', 'the ramp would read past the end of the source', { clipId: clip.id });
        if (k > 0) { copyOverrides(d, clip.id, p.id); created.push(p.id); }
        parts.push(p);
        start = T.add(start, duration); sourceIn = T.add(sourceIn, used);
      }
      track.clips.splice(track.clips.indexOf(clip), 1, ...parts);
      sortClips(track);
    }
    return { affectedIds: [...targets.map((t) => t.clip.id), ...created], summary: `Speed ramp ${a.from}× → ${a.to}× in ${steps} steps`, output: { createdClipIds: created, steps, durationFrames: total, speeds: speeds.map((sp) => Number((sp.num / sp.den).toFixed(3))) } };
  },
});

defineOp({
  name: 'set_volume_keyframe',
  version: 1,
  description: 'Volume automation: set the level of a sound clip at a clip-local, frame-aligned time (0 = silent, 1 = unchanged, up to 4). The level moves in a straight line between keys and holds before the first and after the last. It multiplies the clip gain, fades and ducking.',
  args: z.object({ clipId: z.string(), time: RT.describe('Offset from the clip start (frame-aligned)'), value: z.number().min(0).max(4) }).strict(),
  apply(d, a) {
    const clip = volumeTarget(d, a.clipId);
    assertAligned(d, a.time, 'time');
    if (T.isNegative(a.time) || T.lt(clip.duration, a.time)) throw new OpError('out_of_bounds', 'the key must lie inside the clip', { duration: clip.duration });
    const keys = (clip.volume ?? []).filter((k) => !T.eq(k.time, a.time));
    keys.push({ time: a.time, value: a.value });
    keys.sort((x, y) => T.cmp(x.time, y.time));
    clip.volume = keys;
    return { affectedIds: [clip.id], summary: `Volume ${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length } };
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
        clip.duration = duration;
        clampFades(clip);
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
        }
        assertFree(track, a.to, end, new Set([clip.id]));
        shiftKeyframes(clip, delta); // the animation stays attached to the content, not to the moved edge
        clip.start = a.to;
        clip.duration = T.sub(end, a.to);
        clampFades(clip);
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
      if (clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can be slipped', { clipId: clip.id });
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
      if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can be linked', { clipId: f.clip.id });
      if (f.clip.linkGroupId) throw new OpError('incompatible', 'this clip is already linked', { clipId: f.clip.id }, 'Use unlink_clip first.');
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
  name: 'set_clip_reverse',
  version: 1,
  description: 'Play a clip backwards (reverse=true) or forwards again (false): a video clip on a video track, a sound clip on a sound track, or both when they are linked (they reverse together unless includeLinked=false, which also unlinks them). The clip keeps its place, length and the stretch of source it uses; only the order changes. Not for freeze frames or stills. A transition or crossfade into the next clip must still have enough spare source in the new direction.',
  args: z.object({ clipId: z.string(), reverse: z.boolean(), includeLinked: z.boolean().optional() }).strict(),
  apply(d, a) {
    const f = mustClip(d, a.clipId);
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only clips that play a source file can play backwards', { clipId: a.clipId });
    const others = linked(d, f.clip);
    const targets = [{ track: f.track, clip: f.clip as MediaClip }, ...(a.includeLinked === false ? [] : others)];
    if (targets.every((t) => !!t.clip.reverse === a.reverse)) throw new OpError('invalid_args', `the clip already plays ${a.reverse ? 'backwards' : 'forwards'}`, { clipId: a.clipId });
    const affected: string[] = [];
    for (const { track, clip } of targets) {
      const asset = d.assets[clip.assetId];
      if (!asset || asset.kind === 'image' || (track.kind === 'video' ? !asset.video : track.kind === 'audio' ? !asset.audio : true)) throw new OpError('incompatible', 'only a video clip on a video track or a sound clip on a sound track can play backwards', { clipId: clip.id });
      if (clip.freeze) throw new OpError('incompatible', 'a freeze frame has no direction', { clipId: clip.id });
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
      copyOverrides(d, clip.id, right.id);
      right.start = a.at;
      right.duration = T.sub(clip.duration, left);
      shiftKeyframes(right, left);
      if (clip.type === 'caption') { delete clip.words; delete (right as typeof clip).words; }
      if (right.type === 'media') delete right.transition; // the transition belongs to the original cut point
      if (right.type === 'media' && clip.type === 'media') { delete right.fadeIn; delete clip.fadeOut; } // fades stay on the outer edges
      if (right.type === 'media' && clip.type === 'media') { right.sourceIn = sourceInOfPart(clip, left, right.duration); clip.sourceIn = sourceInOfPart(clip, T.ZERO, left); if (right.linkGroupId) right.linkGroupId = newLink; }
      clip.duration = left;
      clampFades(clip);
      clampFades(right);
      track.clips.push(right);
      sortClips(track);
      created.push(right.id);
    }
    return { affectedIds: [...targets.map((t) => t.clip.id), ...created], summary: `Split clip at ${fmt(a.at)}`, output: { rightClipId: created[0], createdClipIds: created } };
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
    const asset = src.type === 'media' ? d.assets[src.assetId] : undefined;
    if (src.type !== 'media' || f.track.kind !== 'video' || !asset?.video) throw new OpError('incompatible', 'a freeze frame needs a video clip on a video track', { clipId: a.clipId });
    if (src.freeze) throw new OpError('incompatible', 'this clip is already a freeze frame', { clipId: a.clipId }, 'Trim it to make the hold longer or shorter.');
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
        right.sourceIn = sourceInOfPart(clip, left, right.duration);
        clip.sourceIn = sourceInOfPart(clip, T.ZERO, left);
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
    return { affectedIds: [...affected], summary: `Freeze frame at ${fmt(a.at)} for ${fmt(a.duration)}`, output: { freezeClipId: held.id, createdClipIds: created } };
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







defineOp({
  name: 'duplicate_clips',
  version: 1,
  description: 'Copy clips with everything on them (trim, transform, keyframes, effects, mask, fades, per-format overrides) to a new time. Give `at` (timeline time where the earliest copied clip should start) or `offset` (shift from the originals). Copies go on the same tracks when free, otherwise on another compatible track. Linked picture+sound pairs stay linked to each other, not to the originals.',
  args: z.object({ clipIds: z.array(z.string()).min(1).max(200), at: RT.optional(), offset: RT.optional() }).strict(),
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
      let track: Track | undefined = free(f.track) ? f.track : f.seq.tracks.find((t) => t.kind === f.track.kind && t.id !== f.track.id && (t.kind !== 'caption' || t.caption?.mode === 'manual') && free(t));
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
defineOp({
  name: 'apply_recipe',
  version: 1,
  internal: true,
  description: 'Apply a recipe plan (ordinary public ops) as one step and record which objects it created. Issued by the server from a plan it built; on regeneration it first removes the previous run\'s untouched clips.',
  args: z.object({ runId: z.string().optional(), recipeId: z.string().max(64), params: z.record(z.string(), z.unknown()), steps: z.array(z.string().max(400)).max(50), removeClipIds: z.array(z.string()).max(5000).optional(), keepIds: z.array(z.string()).max(5000).optional(), ops: z.array(z.object({ op: z.string(), args: z.unknown() }).strict()).min(1).max(2000) }).strict(),
  apply(d, a, ctx) {
    const affected = new Set<string>();
    for (const id of a.removeClipIds ?? []) {
      const f = findClip(d, id);
      if (!f) continue;
      if (f.track.locked) throw new OpError('track_locked', `track ${f.track.id} is locked`, { trackId: f.track.id, clipId: id });
      f.track.clips.splice(f.index, 1);
      affected.add(id);
    }
    const created: string[] = [...(a.keepIds ?? [])];
    for (const [i, call] of a.ops.entries()) {
      const def = getOp(call.op);
      if (!def || def.internal) throw new OpError('forbidden_op', `recipe step ${i} uses "${call.op}", which is not a public operation`, { index: i });
      const parsed = def.args.safeParse(call.args);
      if (!parsed.success) throw new OpError('invalid_args', `recipe step ${i} (${call.op}): ${z.prettifyError(parsed.error)}`, { index: i });
      const r = def.apply(d, parsed.data, ctx);
      for (const id of r.affectedIds) affected.add(id);
      const out = r.output ?? {};
      for (const key of ['clipId', 'audioClipId', 'trackId', 'variantId'] as const) if (typeof out[key] === 'string') created.push(out[key] as string);
      if (Array.isArray(out.createdClipIds)) created.push(...(out.createdClipIds as string[]));
    }
    const id = a.runId ?? ctx.newId('run');
    const previous = a.runId ? d.recipeRuns[a.runId]?.fingerprints ?? {} : {};
    const createdIds = [...new Set(created)].filter((x) => !!findClip(d, x) || !!d.variants[x] || Object.values(d.sequences).some((s) => s.tracks.some((t) => t.id === x)));
    const fingerprints: Record<string, string> = {};
    for (const cid of createdIds) {
      const f = findClip(d, cid);
      if (!f) continue;
      // Clips kept from an earlier run keep their ORIGINAL fingerprint, so they stay recognisable as hand-edited next time too.
      fingerprints[cid] = (a.keepIds ?? []).includes(cid) && previous[cid] ? previous[cid]! : fingerprint(f.clip);
    }
    d.recipeRuns[id] = { id, recipeId: a.recipeId, params: a.params, createdIds, fingerprints, steps: a.steps };
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
  args: z.object({ time: RT, label: z.string().max(200).optional(), color: z.enum(MARKER_COLORS).optional() }).strict(),
  apply(d, a, ctx) {
    assertAligned(d, a.time, 'time');
    if (T.isNegative(a.time)) throw new OpError('out_of_bounds', 'a marker cannot sit before the start', { time: a.time });
    const taken = markerAt(d, d.mainSequenceId, a.time);
    if (taken) throw new OpError('overlap', 'there is already a marker on this frame', { markerId: taken.id }, 'Use update_marker to change it.');
    const m: Marker = { id: ctx.newId('mrk'), sequenceId: d.mainSequenceId, time: a.time, label: a.label ?? '', color: a.color ?? 'blue' };
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
    const cur = v.overrides[a.clipId] ?? {};
    const next = { ...cur };
    if (a.transform === null) delete next.transform; else if (a.transform) next.transform = { ...cur.transform, ...a.transform };
    if (a.hidden !== undefined) { if (a.hidden) next.hidden = true; else delete next.hidden; }
    if ((a.text != null && f.clip.type !== 'text' && f.clip.type !== 'caption') || (a.textStyle != null && f.clip.type !== 'text')) throw new OpError('incompatible', 'wording can be set per format on title and caption clips, text style on title clips', { clipId: a.clipId });
    if (a.text === null) delete next.text; else if (a.text !== undefined) next.text = a.text;
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
    if (a.text === null || a.text === seg.text) delete next[a.segmentId]; else next[a.segmentId] = a.text;
    if (Object.keys(next).length) v.phraseText = next; else delete v.phraseText;
    return { affectedIds: [v.id], summary: `Format ${v.name}: phrase ${next[a.segmentId] !== undefined ? 'reworded' : 'back to the master wording'}`, output: { text: next[a.segmentId] ?? null } };
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
    d.analyses[a.assetId] = a.kind === 'scenes' ? { ...cur, scenes: { origin, cuts: list } } : { ...cur, beats: { origin, bpm: a.bpm !== undefined ? a.bpm : cur.beats?.bpm ?? null, confidence: cur.beats?.confidence ?? null, beats: list, ...(bars.length ? { downbeats: bars, meter } : {}) } };
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
    if (f.clip.type !== 'media') throw new OpError('incompatible', 'only media clips have scenes', { clipId: a.clipId });
    const cuts = d.analyses[f.clip.assetId]?.scenes?.cuts;
    if (!cuts) throw new OpError('not_found', 'this asset has no scene analysis yet', { assetId: f.clip.assetId }, 'Run the scene analysis first (analyze_asset kind=scenes).');
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
    return { affectedIds: [clip.id, ...created], summary: `Split into ${points.length + 1} shots`, output: { cuts: points, createdClipIds: created } };
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
    if (clip.linkGroupId) throw new OpError('incompatible', 'this sound is linked to a picture; detach it first if it should be fitted on its own', { clipId: clip.id }, 'Use unlink_clip.');
    if (clip.reverse) throw new OpError('incompatible', 'a clip that plays backwards cannot be fitted to beats', { clipId: clip.id });
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
    // beats of the source at or after the clip's in-point, as timeline times of this clip (also past its current end)
    const beats = (d.analyses?.[clip.assetId]?.beats?.beats ?? []).filter((b) => T.lt(clip.sourceIn, b)).map((b) => frame(timelineAt(clip, b))).filter((t) => T.lt(clip.start, t) && T.lte(t, limit));
    const lastBeat = beats.length ? beats.reduce((m, t) => T.max(m, t)) : null;
    // With bar starts in the analysis the music ends on the last bar start, which sounds finished where an arbitrary beat does not —
    // unless that bar start lies more than one bar before the last usable beat (bars known for an earlier part of the file only).
    const an = d.analyses?.[clip.assetId]?.beats;
    const bars = (an?.downbeats ?? []).filter((b) => T.lt(clip.sourceIn, b)).map((b) => frame(timelineAt(clip, b))).filter((t) => T.lt(clip.start, t) && T.lte(t, limit));
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
const FxKeyTarget = { clipId: z.string(), effectId: z.string(), param: z.string().max(48), time: RT.describe('Offset from the clip start (frame-aligned)') };
defineOp({
  name: 'set_effect_keyframe',
  version: 1,
  description: 'Animate a numeric effect parameter: add or replace a keyframe at a clip-local time. The first key on a parameter starts animating it; between keys the value is interpolated with the easing of the earlier key. list_catalog shows each effect\'s parameters and ranges.',
  args: z.object({ ...FxKeyTarget, value: z.number(), easing: z.enum(EASINGS).optional() }).strict(),
  apply(d, a) {
    const { clip } = pictureClip(d, a.clipId);
    const i = mustEffect(clip, a.effectId);
    const fx = { ...clip.effects![i]! };
    if (!animatableParams(fx.type).includes(a.param)) throw new OpError('invalid_args', `"${a.param}" is not a numeric parameter of ${fx.type}`, { animatable: animatableParams(fx.type) });
    assertAligned(d, a.time, 'time');
    parseEffect(fx.type, { ...fx.params, [a.param]: a.value }); // range check
    const keys = [...(fx.keyframes?.[a.param] ?? [])];
    const k = keys.findIndex((x) => T.eq(x.time, a.time));
    const key = { time: a.time, value: a.value, easing: a.easing ?? (k >= 0 ? keys[k]!.easing : 'linear') };
    if (k >= 0) keys[k] = key; else keys.push(key);
    keys.sort((x, y) => T.cmp(x.time, y.time));
    fx.keyframes = { ...fx.keyframes, [a.param]: keys };
    clip.effects = clip.effects!.map((e, n) => (n === i ? fx : e));
    return { affectedIds: [clip.id], summary: `Keyframe ${fx.type}.${a.param}=${a.value} at +${fmt(a.time)}`, output: { keyframeCount: keys.length } };
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
        const handle = T.frameIndexAt(handleAfterEnd(prev, asset.duration), rate);
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
function cutRange(d: ProjectDocument, seq: Sequence, start: T.RationalTime, end: T.RationalTime, tracks: Track[], ripple: boolean, ctx: OpContext) {
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
          copyOverrides(d, clip.id, right.id);
          created.push(right.id);
          if (right.type === 'media' && right.linkGroupId) {
            if (!relink.has(right.linkGroupId)) relink.set(right.linkGroupId, ctx.newId('lnk'));
            right.linkGroupId = relink.get(right.linkGroupId)!;
          }
        }
        if (right.type === 'media' && hasLeft) delete right.transition;
        if (right.type === 'media') delete right.fadeIn;
        if (right.type === 'media' && clip.type === 'media') right.sourceIn = sourceInOfPart(clip, delta, T.sub(cEnd, end));
        if (right.type === 'caption') delete right.words;
        shiftKeyframes(right, delta);
        right.start = ripple ? start : end;
        right.duration = T.sub(cEnd, end);
        clampFades(right);
      }
      if (hasLeft) {
        if (clip.type === 'media') delete clip.fadeOut;
        if (clip.type === 'media') clip.sourceIn = sourceInOfPart(clip, T.ZERO, T.sub(start, clip.start));
        clip.duration = T.sub(start, clip.start);
        clampFades(clip);
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
  return { removed, changed, created, markersMoved, markersRemoved };
}

defineOp({
  name: 'cut_range',
  version: 1,
  description: 'Remove a frame-aligned time range from the timeline. By default every track is cut and later material moves earlier (ripple) so picture, sound and captions stay in sync; markers after the range move with it, and markers on removed frames collapse onto the cut point (one marker per frame: extra ones are dropped and listed in the output). A locked track makes the cut fail rather than drift.',
  args: z.object({ sequenceId: z.string().optional(), start: RT, end: RT, trackIds: z.array(z.string()).min(1).optional(), ripple: z.boolean().optional() }).strict(),
  apply(d, a, ctx) {
    const seq = seqOf(d, a.sequenceId);
    assertAligned(d, a.start, 'start');
    assertAligned(d, a.end, 'end');
    if (T.isNegative(a.start) || !T.lt(a.start, a.end)) throw new OpError('invalid_args', 'need 0 <= start < end');
    const tracks = a.trackIds ? a.trackIds.map((id) => mustTrack(seq, id)) : seq.tracks;
    const r = cutRange(d, seq, a.start, a.end, tracks, a.ripple !== false, ctx);
    return { affectedIds: [...new Set([...r.removed, ...r.changed, ...r.created, ...r.markersMoved, ...r.markersRemoved])], summary: `Cut ${fmt(T.sub(a.end, a.start))} at ${fmt(a.start)}${a.ripple === false ? ' (gap left)' : ''}${r.markersRemoved.length ? `; ${r.markersRemoved.length} marker(s) on removed frames dropped` : ''}`, output: { removedClipIds: r.removed, createdClipIds: r.created, movedMarkerIds: r.markersMoved, removedMarkerIds: r.markersRemoved } };
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
      if (right.type === 'media' && clip.type === 'media') { delete right.transition; delete right.fadeIn; right.sourceIn = sourceInOfPart(clip, delta, T.sub(cEnd, at)); }
      if (right.type === 'caption') delete right.words;
      shiftKeyframes(right, delta);
      right.start = T.add(at, len);
      right.duration = T.sub(cEnd, at);
      clampFades(right);
      if (clip.type === 'media') { delete clip.fadeOut; clip.sourceIn = sourceInOfPart(clip, T.ZERO, delta); }
      clip.duration = delta;
      clampFades(clip);
      if (clip.type === 'caption') delete clip.words;
      changed.push(clip.id);
      next.push(clip, right);
    }
    track.clips = next;
    sortClips(track);
  }
  return { changed, created };
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
    return { affectedIds: [...new Set([...r.changed, ...r.created, ...moved])], summary: `Opened ${fmt(a.duration)} at ${fmt(a.at)}`, output: { createdClipIds: r.created, movedMarkerIds: moved } };
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
    for (const g of gaps.reverse()) { const c = cutRange(d, seq, g.start, g.end, seq.tracks, true, ctx); for (const id of [...c.changed, ...c.markersMoved, ...c.markersRemoved]) affected.add(id); }
    const total = gaps.reduce((n, g) => T.add(n, T.sub(g.end, g.start)), T.ZERO);
    return { affectedIds: [...affected], summary: `Closed ${gaps.length} gap(s), ${fmt(total)} in all`, output: { gaps: gaps.reverse(), removed: total } };
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
        if (c.type !== 'media' || c.assetId !== a.assetId || c.reverse) continue; // a reversed clip does not play the words
        const from = T.max(c.sourceIn, srcStart), to = T.min(sourceEnd(c), srcEnd);
        if (!T.lt(from, to)) continue;
        const start = T.snapToFrame(timelineAt(c, from), rate), end = T.snapToFrame(timelineAt(c, to), rate);
        if (T.lt(start, end) && !ranges.some((r) => T.eq(r.start, start) && T.eq(r.end, end))) ranges.push({ start, end });
      }
    if (ranges.length === 0) throw new OpError('not_found', 'those words are not on the timeline (already cut, or shorter than one frame)', { assetId: a.assetId });
    ranges.sort((x, y) => T.cmp(y.start, x.start)); // latest first, so earlier ranges keep their times
    const affected = new Set<string>();
    for (const r of ranges) { const c = cutRange(d, seq, r.start, r.end, seq.tracks, true, ctx); for (const id of [...c.removed, ...c.changed, ...c.created, ...c.markersMoved, ...c.markersRemoved]) affected.add(id); }
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
