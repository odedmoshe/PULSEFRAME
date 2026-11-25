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
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { AssetSchema } from './schema.ts';

/** True once worker B has built the bodies. */
export const LIBRARY_OPS_BUILT = false;
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

const notBuilt = (op: string) => () => { throw libraryRefusal('notBuilt', { op }, op); };

defineOp({
  name: 'use_library_item',
  version: 1,
  internal: true,
  description: 'Add a file copied from the owner\'s library folder to the project library with its licence record (provenance.library), deduplicated by content; an existing copy gets the record. Issued only by the server after it copied and verified the bytes.',
  args: UseLibraryItemArgsSchema,
  apply: notBuilt('use_library_item'),
});
defineOp({
  name: 'add_credits_card',
  version: 1,
  description: 'Put a credits card at the end of the sequence: a heading and the credit lines every library file in the sequence needs, verbatim, as two ordinary titles marked as the credits. Running it again replaces the card it made (hand edits to the card are replaced too). Refused when nothing needs a credit.',
  args: AddCreditsCardArgsSchema,
  apply: notBuilt('add_credits_card'),
});
