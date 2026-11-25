/**
 * Operations of the content library (wave 7 library track; library-decisions.md §4). Registered on import of this module
 * (index.ts exports it). The lead's pre-pass fixes names, versions, argument schemas, outputs and every refusal with its code,
 * English wording and hint (LIBRARY_REFUSALS; the Hebrew is packages/i18n/src/library.ts HE_LIBRARY, kept in step by
 * packages/evals/src/library-wording.test.ts). The apply bodies are WORKER B's: until then each REFUSES with notBuilt and changes
 * nothing. LIBRARY_OPS_BUILT turns the fuzz rows on (packages/evals/src/ops-fuzz.gen.ts).
 *
 * RULES OF THE BODIES
 * - use_library_item (internal; issued only by the server after the bytes were copied and verified, as import_asset and
 *   add_builtin_music are): the asset must carry provenance.library (notLibraryAsset) and its record must pass libraryDuties.ts
 *   (licenceUnknown / licenceShareAlike / licenceNoDerivatives / creditMissing / recordWeaker). Then: an asset with the same
 *   contentHash → none: add it; one without a record: attach the record (import_asset would leave it without its licence); one
 *   with a different record: replace the record (the ledger is the authority; the summary says so). Output UseLibraryItemOutput.
 *   No placement here: the server places with add_clip as its own governed edit (attachGenerated's two steps, dry-run first).
 * - add_credits_card (public): removes the clips with role 'credits' of the sequence, then appends after the sequence's last clip
 *   end one heading clip («קרדיטים» / "Credits", direction auto) and one body clip (every line of collectCredits, verbatim,
 *   direction ltr, centred), both role 'credits', `seconds` long (default 4, frame-aligned with T.frameTime), on the first unlocked
 *   text track of the sequence or a new one (ops.ts newTrack). A locked target is refused as add_text refuses. noCredits when
 *   nothing needs a credit; creditsTooLong when the body would pass 2000 characters (TextClipSchema). Undo is the generic one.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, getOp, OpError, type OpContext, type OpErrorCode } from './ops.ts';
import { AssetSchema, type Asset, type LibraryRecord, type ProjectDocument } from './schema.ts';
import { libraryRecordProblems } from './libraryDuties.ts';
import { collectCredits, creditDue, CREDITS_HEADING } from './libraryCredits.ts';
import { sequenceDuration } from './validate.ts';

/** True once worker B has built the bodies. */
export const LIBRARY_OPS_BUILT = true;
/** The longest credits body one card holds (TextClipSchema text max). */
export const CREDITS_CARD_MAX_CHARS = 2000;

interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the library operations. The messages are fixed: HE_LIBRARY recognises them by their shape. */
export const LIBRARY_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op} is not built in this build yet`, 'Update the editor and try again.'),
  notLibraryAsset: refusal('invalid_args', () => 'this file has no library record', 'Library items are added with POST /api/v1/projects/{id}/library/use (MCP use_library_item).'),
  licenceUnknown: refusal('incompatible', () => 'the licence of this library item is not one the editor knows, so it cannot be used', 'Choose another item; the licence table in core names what is known.'),
  licenceNoDerivatives: refusal('incompatible', () => 'this licence forbids changing the work, and putting it in a video changes it', 'Choose another item.'),
  licenceShareAlike: refusal('incompatible', () => 'this licence would require sharing the whole video under the same licence', 'Choose another item.'),
  creditMissing: refusal('incompatible', () => 'the licence of this library item requires a credit, and the item has no credit text', 'Choose another item.'),
  recordWeaker: refusal('invalid_args', (what: string) => `the library record is weaker than its licence: it must be marked ${what}`, 'Add the item again from the library; the server writes the record.'),
  noCredits: refusal('invalid_args', () => 'nothing in this sequence needs a credit', 'Nothing to put on a credits card.'),
  creditsTooLong: refusal('invalid_args', (n: number) => `the credits are ${n} characters long; one card holds at most ${CREDITS_CARD_MAX_CHARS}`, 'Copy the credits to the video description instead (GET /api/v1/projects/{id}/credits).'),
} as const;
export type LibraryRefusalKey = keyof typeof LIBRARY_REFUSALS;
export function libraryRefusal<K extends LibraryRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof LIBRARY_REFUSALS)[K]['message']>): OpError {
  const r = LIBRARY_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}

export const UseLibraryItemArgsSchema = z.object({ asset: AssetSchema.omit({ id: true }) }).strict();
export type UseLibraryItemArgs = z.infer<typeof UseLibraryItemArgsSchema>;
/** use_library_item OpResult.output. recordAttached: the record was written onto an asset that already existed. */
export interface UseLibraryItemOutput { assetId: string; deduplicated: boolean; recordAttached: boolean }
export const AddCreditsCardArgsSchema = z.object({
  sequenceId: z.string().optional(),
  seconds: z.number().int().min(3).max(20).optional().describe('How long the card stays (whole seconds, default 4)'),
  lang: z.enum(['he', 'en']).optional().describe('Language of the heading (default he); the credit lines are never translated'),
}).strict();
export type AddCreditsCardArgs = z.infer<typeof AddCreditsCardArgsSchema>;
export interface AddCreditsCardOutput { clipIds: string[]; trackId: string; removed: number }

/** A value with its object keys in order, so two records compare equal exactly when they say the same. */
const canonical = (v: unknown): unknown => (Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v);
const sameRecord = (a: LibraryRecord, b: LibraryRecord) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
/** An operation's body by name (looked up when it runs, so the order of the modules does not matter). */
function opBody(name: string) {
  const def = getOp(name);
  if (!def) throw new OpError('unknown_op', `operation ${name} is not registered in this build`, { op: name });
  return def;
}

/** use_library_item: the record must pass the table first (libraryDuties.ts libraryRecordProblems, first problem refuses). */
function useLibraryItem(d: ProjectDocument, a: UseLibraryItemArgs, ctx: OpContext) {
  const record = a.asset.provenance.library;
  if (!record) throw libraryRefusal('notLibraryAsset', { name: a.asset.name.slice(0, 80) });
  const problem = libraryRecordProblems(record)[0];
  if (problem) {
    const details = { itemId: record.itemId, licenceId: record.licence.id };
    if (problem.key === 'recordWeaker') throw libraryRefusal('recordWeaker', { ...details, missing: problem.what }, problem.what);
    throw libraryRefusal(problem.key, details);
  }
  // the same bytes already in the project as a copied file: give it the record (an upload record gives way to it, since a file
  // from the library carries none, validate.ts library_provenance). Bytes that came from a formula or a provider stay as they are,
  // and the library copy is added beside them.
  const existing = Object.values(d.assets).find((x): x is Asset => x.contentHash === a.asset.contentHash && x.provenance.origin === 'upload');
  if (!existing) {
    const id = ctx.newId('ast');
    d.assets[id] = { id, ...a.asset };
    const output: UseLibraryItemOutput = { assetId: id, deduplicated: false, recordAttached: false };
    return { affectedIds: [id], summary: `Added "${record.title || a.asset.name}" from the library (${record.licence.id})`, output: { ...output } };
  }
  const before = existing.provenance.library;
  if (before && sameRecord(before, record)) {
    const output: UseLibraryItemOutput = { assetId: existing.id, deduplicated: true, recordAttached: false };
    return { affectedIds: [], summary: `"${existing.name}" is already in the project with this library record`, output: { ...output } };
  }
  const { upload, ...provenance } = existing.provenance;
  existing.provenance = { ...provenance, library: record };
  const output: UseLibraryItemOutput = { assetId: existing.id, deduplicated: true, recordAttached: true };
  const was = before ? 'its earlier library record was replaced (the library ledger is the authority)' : upload ? 'its upload record was replaced by the library record' : 'it now carries its library record';
  return { affectedIds: [existing.id], summary: `"${existing.name}" was already in the project; ${was} (${record.licence.id})`, output: { ...output } };
}

/** add_credits_card: the earlier card goes, then a heading and the credit lines after the last clip (two ordinary titles). */
function addCreditsCard(d: ProjectDocument, a: AddCreditsCardArgs, ctx: OpContext) {
  const seqId = a.sequenceId ?? d.mainSequenceId;
  const seq = Object.hasOwn(d.sequences, seqId) ? d.sequences[seqId] : undefined;
  if (!seq) throw new OpError('not_found', `sequence ${seqId} not found`, { sequenceId: seqId });
  const report = collectCredits(d, { sequenceId: seq.id });
  // a card is for credits that are due; courtesy lines (a licence that needs none) go on it too, but never make one
  if (!report.lines.some((l) => creditDue(d, l))) throw libraryRefusal('noCredits', { sequenceId: seq.id });
  const body = report.lines.map((l) => l.text).join('\n');
  if (body.length > CREDITS_CARD_MAX_CHARS) throw libraryRefusal('creditsTooLong', { sequenceId: seq.id, chars: body.length, max: CREDITS_CARD_MAX_CHARS }, body.length);
  // the card this operation made before (delete_clip's body: a card on a locked track is refused as any edit there)
  const old = seq.tracks.flatMap((t) => t.clips).filter((c) => c.type === 'text' && c.role === 'credits').map((c) => c.id);
  const del = opBody('delete_clip');
  for (const clipId of old) del.apply(d, { clipId }, ctx);
  const rate = d.settings.frameRate;
  const end = sequenceDuration(d, seq.id);
  const start = T.isFrameAligned(end, rate) ? end : T.frameTime(T.frameIndexAt(end, rate) + 1, rate);
  const seconds = a.seconds ?? 4;
  const duration = T.frameTime(Math.max(1, Math.round((seconds * rate.num) / rate.den)), rate);
  const add = opBody('add_text');
  const heading = add.apply(d, { sequenceId: seq.id, text: CREDITS_HEADING[a.lang ?? 'he'], start, duration, style: { sizeFrac: 0.08, direction: 'auto', align: 'center' }, transform: { y: -0.3 } }, ctx).output as { clipId: string; trackId: string };
  const lines = add.apply(d, { sequenceId: seq.id, text: body, start, duration, style: { sizeFrac: 0.04, direction: 'ltr', align: 'center', lineHeight: 1.3 }, transform: { y: 0.05 } }, ctx).output as { clipId: string; trackId: string };
  for (const id of [heading.clipId, lines.clipId]) {
    const clip = seq.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (clip?.type === 'text') clip.role = 'credits';
  }
  const output: AddCreditsCardOutput = { clipIds: [heading.clipId, lines.clipId], trackId: lines.trackId, removed: old.length };
  return { affectedIds: [...old, heading.clipId, lines.clipId], summary: `Credits card with ${report.lines.length} credit line(s) at the end of the sequence${old.length ? '; the earlier card was replaced' : ''}`, output: { ...output } };
}

defineOp({
  name: 'use_library_item',
  version: 1,
  internal: true,
  description: 'Add a file copied from the owner\'s library folder to the project library with its licence record (provenance.library), deduplicated by content; an existing copy gets the record. Issued only by the server after it copied and verified the bytes.',
  args: UseLibraryItemArgsSchema,
  apply: useLibraryItem,
});
defineOp({
  name: 'add_credits_card',
  version: 1,
  description: 'Put a credits card at the end of the sequence: a heading and the credit lines every library file in the sequence needs, verbatim, as two ordinary titles marked as the credits. Running it again replaces the card it made (hand edits to the card are replaced too). Refused when nothing needs a credit.',
  args: AddCreditsCardArgsSchema,
  apply: addCreditsCard,
});
