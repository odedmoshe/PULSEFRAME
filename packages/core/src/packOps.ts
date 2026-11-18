/**
 * Built-in music in the project document (ADR-0022): the internal operation add_builtin_music and the helper that attaches a
 * known beat grid, which apply_template uses too (templateOps.ts). Registered on import of this module (index.ts exports it).
 *
 * - add_builtin_music is issued only by the server (apps/server/src/music.ts addMusic), like import_asset: it carries the
 *   asset record of a track the server synthesised and stored, and the track's grid (musicStyles.ts knownGridOf). In ONE step
 *   it adds the file to the library (deduplicated by content), writes the grid as the file's beat analysis, and, with `place`,
 *   puts one sound clip on the timeline through add_clip's own body. Undo is the generic one: the store restores the entities
 *   that changed (asset, analysis, clip, and a track the placement made).
 * - A beat analysis of built-in music is KNOWN, not measured: method MUSIC_METHOD, confidence null. It is never written over
 *   a grid a person corrected by hand (origin.edited), and not written again when the same grid is already there.
 * - Every refusal has a fixed English sentence in PACK_REFUSALS; the Hebrew wording is in packages/i18n/src/packs.ts and
 *   packages/evals/src/packs-wording.test.ts keeps the two in step.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, getOp, OpError, type OpErrorCode } from './ops.ts';
import { AssetSchema, RationalTimeSchema as RT, type ProjectDocument } from './schema.ts';
import { analysisEntityId } from './entities.ts';
import { isKnownGrid, KnownGridSchema, MUSIC_STYLE_ID, type KnownGrid } from './musicStyles.ts';

// ---------- refusals: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * Every refusal of add_builtin_music and of attaching a known grid. The messages are fixed: the Hebrew table recognises them
 * by their shape (packages/i18n/src/packs.ts HE_PACKS), so a change here is a change there.
 */
export const PACK_REFUSALS = {
  notBuiltinMusic: refusal('invalid_args', () => 'this file is not built-in music: it must be a sound-only file made by a music formula of this build', 'Built-in music is added through POST /api/v1/projects/{id}/music (or the tool add_builtin_music), which makes the track.'),
  gridAssetMissing: refusal('not_found', (assetId: string) => `asset ${assetId} not found`, 'get_summary lists the library files.'),
  gridBeatsOrder: refusal('invalid_args', () => 'the beats of a known grid must be strictly ascending'),
  gridBarNotBeat: refusal('invalid_args', () => 'every bar start of a known grid must be one of its beats'),
  gridOutsideFile: refusal('invalid_args', () => 'every time of a known grid must lie inside the track, from 0 and before its end'),
  gridSections: refusal('invalid_args', () => 'the sections of a known grid must start at 0 and be strictly ascending'),
} as const;
export type PackRefusalKey = keyof typeof PACK_REFUSALS;
/** The refusal `key` as the error an operation throws. */
export function packRefusal<K extends PackRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof PACK_REFUSALS)[K]['message']>): OpError {
  const r = PACK_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}

const sameTimes = (a: readonly T.RationalTime[], b: readonly T.RationalTime[]) => a.length === b.length && a.every((t, i) => T.eq(t, b[i]!));
/**
 * Write the known grid of a built-in music track as the beat analysis of `assetId`:
 *   d.analyses[assetId].beats = { origin: { method, params, createdAt, createdBy: actor, edited: false }, bpm, confidence: null, beats, downbeats, meter, sections }
 * (a scene analysis of the file is kept). Returns true when it was written, false when nothing changed: a beat analysis
 * that a person corrected by hand (origin.edited) is kept as it is, and so is the same known grid when it is already there.
 * Throws (PACK_REFUSALS): the asset is not in the library; beats not strictly ascending; a bar start that is not a beat; any
 * time negative or not before the end of the file; sections that do not start at 0 or are not strictly ascending.
 */
export function attachKnownGrid(d: ProjectDocument, assetId: string, grid: KnownGrid, actor: string): boolean {
  const asset = Object.hasOwn(d.assets, assetId) ? d.assets[assetId] : undefined;
  if (!asset) throw packRefusal('gridAssetMissing', { assetId }, assetId);
  const ascending = (list: readonly T.RationalTime[]) => list.every((t, i) => i === 0 || T.lt(list[i - 1]!, t));
  if (!ascending(grid.beats)) throw packRefusal('gridBeatsOrder', { assetId });
  if (!ascending(grid.downbeats) || !grid.downbeats.every((b) => grid.beats.some((x) => T.eq(x, b)))) throw packRefusal('gridBarNotBeat', { assetId });
  const starts = grid.sections.map((s) => s.start);
  if (!T.isZero(starts[0]!) || !ascending(starts)) throw packRefusal('gridSections', { assetId });
  if ([...grid.beats, ...starts].some((t) => T.isNegative(t) || !T.lt(t, asset.duration))) throw packRefusal('gridOutsideFile', { assetId, assetDuration: asset.duration });
  const cur = Object.hasOwn(d.analyses, assetId) ? d.analyses[assetId]! : { assetId };
  const had = cur.beats;
  if (had?.origin.edited) return false; // hand-corrected data is never replaced
  const sections = grid.sections.map((s) => ({ start: s.start, kind: s.kind, level: s.level }));
  if (had && isKnownGrid(had) && had.bpm === grid.bpm && had.meter === grid.meter && sameTimes(had.beats, grid.beats) && sameTimes(had.downbeats ?? [], grid.downbeats)
    && (had.sections ?? []).length === sections.length && (had.sections ?? []).every((s, i) => T.eq(s.start, sections[i]!.start) && s.kind === sections[i]!.kind && s.level === sections[i]!.level)) return false;
  d.analyses[assetId] = { ...cur, beats: { origin: { method: grid.method, params: grid.params, createdAt: grid.createdAt, createdBy: actor, edited: false }, bpm: grid.bpm, confidence: null, beats: [...grid.beats], downbeats: [...grid.downbeats], meter: grid.meter, sections } };
  return true;
}

export const AddBuiltinMusicArgsSchema = z.object({
  asset: AssetSchema.omit({ id: true }),
  grid: KnownGridSchema,
  /** Put one sound clip of the track on the timeline: `start` is frame-aligned; without trackId the first free sound track (or a new one). */
  place: z.object({ start: RT, trackId: z.string().optional(), sequenceId: z.string().optional() }).strict().optional(),
}).strict();
export type AddBuiltinMusicArgs = z.infer<typeof AddBuiltinMusicArgsSchema>;
/** add_builtin_music OpResult.output. analysisAttached false = the file keeps the beat analysis it had (corrected by hand, or the same grid). */
export interface AddBuiltinMusicOutput { assetId: string; deduplicated: boolean; analysisAttached: boolean; clipId?: string; trackId?: string }

defineOp({
  name: 'add_builtin_music',
  version: 1,
  internal: true,
  description: 'Add a built-in music track the server synthesised (original, made by this build\'s own formula; no recordings) to the library with its beats, bars and sections, which are known from the recipe and not measured, and optionally place it on the timeline, as one step.',
  args: AddBuiltinMusicArgsSchema,
  apply(d, a, ctx) {
    const made = a.asset;
    if (made.kind !== 'audio' || !made.audio || made.video || made.image || !MUSIC_STYLE_ID.test(made.provenance.procedural?.id ?? '')) throw packRefusal('notBuiltinMusic', { kind: made.kind, procedural: made.provenance.procedural?.id ?? null });
    const affected: string[] = [];
    // into the library, deduplicated by content like import_asset
    const existing = Object.values(d.assets).find((x) => x.contentHash === made.contentHash);
    const assetId = existing?.id ?? ctx.newId('ast');
    if (!existing) { d.assets[assetId] = { id: assetId, ...made }; affected.push(assetId); }
    const analysisAttached = attachKnownGrid(d, assetId, a.grid, ctx.actor);
    if (analysisAttached) affected.push(analysisEntityId(assetId));
    const output: AddBuiltinMusicOutput = { assetId, deduplicated: !!existing, analysisAttached };
    if (a.place) {
      // through add_clip's own schema and body, so it places and refuses exactly as add_clip does (locked track, a start off the frame grid)
      const addClip = getOp('add_clip')!;
      const parsed = addClip.args.safeParse({ assetId, start: a.place.start, withLinkedAudio: false, ...(a.place.trackId !== undefined ? { trackId: a.place.trackId } : {}), ...(a.place.sequenceId !== undefined ? { sequenceId: a.place.sequenceId } : {}) });
      if (!parsed.success) throw new OpError('invalid_args', z.prettifyError(parsed.error), { place: a.place });
      const placed = addClip.apply(d, parsed.data, ctx);
      affected.push(...placed.affectedIds);
      const out = placed.output ?? {};
      if (typeof out.clipId === 'string') output.clipId = out.clipId;
      if (typeof out.trackId === 'string') output.trackId = out.trackId;
    }
    const style = made.provenance.procedural!.id;
    return { affectedIds: affected, summary: `${existing ? 'Built-in music already in the library' : 'Added built-in music'} (${style}, ${a.grid.beats.length} beats known from the recipe)${output.clipId ? ', placed on the timeline' : ''}`.slice(0, 200), output: output as unknown as Record<string, unknown> };
  },
});
