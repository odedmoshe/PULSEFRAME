/**
 * Operation registry (SPEC §6). Every persistent edit is a named, schema-validated,
 * pure state transition. UI, REST and MCP all go through `applyTransaction`.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import {
  AssetSchema, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, RationalTimeSchema as RT, TextStyleSchema, TransformSchema,
  type Clip, type MediaClip, type ProjectDocument, type Sequence, type Track,
} from './schema.ts';
import { clipEnd, forbidsOverlap, validateProject } from './validate.ts';
import { restoreEntities, type EntityState } from './entities.ts';

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
  const track: Track = { id: ctx.newId('trk'), kind, name: name ?? `${kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T'}${count}`, locked: false, muted: false, hidden: false, clips: [] };
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
