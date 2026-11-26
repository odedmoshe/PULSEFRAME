/**
 * Editing craft (wave 7 craft track; .artifacts/wave7/craft-decisions.md, craft-plan.md "Corrected" C1–C7). LEAD-OWNED and frozen
 * for the builders: names, argument schemas, outputs, limits, every refusal with its code, English sentence and hint (the Hebrew is
 * packages/i18n/src/craft.ts HE_CRAFT, kept in step by packages/evals/src/craft-wording.test.ts), the wire types of find, paste,
 * typed time and versions. No document field and no schema version bump: three public ops (craftOps.ts), one server table.
 *
 * WHO BUILDS WHAT: craftOps.ts, timeEntry.ts, rippleTrim.ts, pasteAttributes.ts, findReplace.ts — W1. versionDiff.ts — W2.
 * Until then every function refuses with CraftNotBuilt and every op with CRAFT_REFUSALS.notBuilt: nothing is made up.
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { RationalTimeSchema } from './keyframe.ts';
import { OpError, type OpErrorCode, type ShiftWords } from './ops.ts';

/** True once W1 has built the op bodies (turns the fuzz rows on: packages/evals/src/ops-fuzz.gen.ts genCraft). */
export const CRAFT_OPS_BUILT = true;

export const CRAFT_LIMITS = {
  /** paste_attributes targets in one op (one request carries at most 200 ops, http.ts TxBody). */
  pasteTargets: 200,
  /** replace_text edits in one op. */
  replaceEdits: 2000,
  /** Title text, cue text and a format's wording (TextClipSchema, CueClip, VariantOverrideSchema hold 2000). */
  wordingChars: 2000,
  /** A transcript phrase and a format's phrase wording (correct_transcript, set_variant_phrase_text hold 4000). */
  phraseChars: 4000,
  /** The search text. */
  findChars: 200,
  /** Matches one find answer lists (the count says how many there are in all). */
  findMatches: 5000,
  /** Clips «משך הקליפ» (D) sets in one go. */
  durationClips: 200,
  /** Saved versions per project, and of those at most this many saved by agent credentials. */
  versions: 50,
  agentVersions: 10,
  versionName: 80,
  /** restore_entities takes at most this many entity states (ops.ts restore_entities). */
  restoreEntities: 5000,
} as const;

// ---------------------------------------------------------------- refusals
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the craft ops. The messages are fixed: HE_CRAFT recognises them by their shape. */
export const CRAFT_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op} is not built in this build yet`, 'Update the editor and try again.'),
  rippleStartLonger: refusal('invalid_args', () => 'a ripple trim can only shorten the start of a clip', 'To lengthen the start, use trim_clip (the gap before it is not closed).'),
  rippleNoChange: refusal('invalid_args', () => 'the clip already starts or ends there; nothing to trim', 'Move the playhead or type another time.'),
  rippleDifferentAmounts: refusal('incompatible', (a: string, b: string) => `ripple trim would move linked clips ${a} and ${b} by different amounts`, 'Unlink those two clips, or trim with trim_clip, which does not close the gap.'),
  rippleBeforeZero: refusal('out_of_bounds', (a: string) => `ripple trim would place clip ${a} before 0`, 'Trim with trim_clip, which does not close the gap, or trim the start of that clip (it starts before the clip it is linked to) first.'),
  rippleOver: refusal('overlap', (a: string, b: string, t: string) => `ripple trim would put clip ${a} over clip ${b} on track ${t}`, 'Move the clip that is in the way first, or trim with trim_clip, which does not close the gap.'),
  pasteSourceIsTarget: refusal('invalid_args', () => 'the clip to copy from cannot also be a clip to paste onto', 'Leave the source out of toClipIds.'),
  pasteNothing: refusal('invalid_args', () => 'nothing here can be pasted onto the chosen clips', 'Choose other groups or other clips; output.skipped of a dry run says why each was left out.'),
  replaceChanged: refusal('incompatible', () => 'the text changed since the search; search again', 'Run find_text again and send the edits it gives.'),
  replaceEmpty: refusal('invalid_args', () => 'the replacement would leave a text empty', 'Leave that place out of the edits.'),
  replaceFields: refusal('invalid_args', () => 'the replacement would change the live fields of a title; leave the {…} fields as they are', 'Replace only the words outside the fields.'),
  replaceTooLong: refusal('invalid_args', (n: number, max: number) => `the text would be ${n} characters long; this place holds at most ${max}`, 'Shorten the replacement.'),
  replaceMissing: refusal('not_found', (where: string) => `there is no longer a text at this place: ${where}`, 'Run find_text again.'),
  replaceTwice: refusal('invalid_args', () => 'the same text is named twice in one replacement', 'Name each place once.'),
} as const;
export type CraftRefusalKey = keyof typeof CRAFT_REFUSALS;
export function craftRefusal<K extends CraftRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof CRAFT_REFUSALS)[K]['message']>): OpError {
  const r = CRAFT_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...args), details, r.hint);
}
/** The words ripple_trim passes to ops.ts shiftClips (a linked partner on a locked track keeps the shared sentence). */
export const RIPPLE_TRIM_WORDS: ShiftWords = {
  differentAmounts: (a, b) => CRAFT_REFUSALS.rippleDifferentAmounts.message(a, b), differentAmountsHint: CRAFT_REFUSALS.rippleDifferentAmounts.hint ?? '',
  lockedPartnerHint: 'Unlock the track, or trim with trim_clip, which does not close the gap.',
  beforeZero: (a) => CRAFT_REFUSALS.rippleBeforeZero.message(a), beforeZeroHint: CRAFT_REFUSALS.rippleBeforeZero.hint ?? '',
  over: (a, b, t) => CRAFT_REFUSALS.rippleOver.message(a, b, t), overHint: CRAFT_REFUSALS.rippleOver.hint ?? '',
};

/** Thrown by a craft function that W1/W2 have not built yet (never a made-up result). */
export class CraftNotBuilt extends Error {
  constructor(what: string) { super(`${what} is not built in this build yet`); this.name = 'CraftNotBuilt'; }
}

// ---------------------------------------------------------------- ripple_trim
export const RippleTrimArgsSchema = z.object({
  clipId: z.string(),
  edge: z.enum(['start', 'end']),
  to: RationalTimeSchema.describe('Frame-aligned timeline time of the new edge; the start edge may only move later'),
  includeLinked: z.boolean().optional(),
}).strict();
export type RippleTrimArgs = z.infer<typeof RippleTrimArgsSchema>;
/** by: new length − old length of the named clip (negative when shortened). */
export interface RippleTrimOutput { trimmedClipIds: string[]; movedClipIds: string[]; by: T.RationalTime }

// ---------------------------------------------------------------- paste_attributes
/** «צבע», «אפקטים», «מיקום וגודל», «אנימציה», «קול», «עיצוב כותרת». «מהירות» is cut from version 1. */
export const ATTRIBUTE_GROUPS = ['colour', 'effects', 'transform', 'animation', 'sound', 'titleStyle'] as const;
export type AttributeGroup = (typeof ATTRIBUTE_GROUPS)[number];
export const PasteAttributesArgsSchema = z.object({
  fromClipId: z.string(),
  toClipIds: z.array(z.string()).min(1).max(CRAFT_LIMITS.pasteTargets),
  groups: z.array(z.enum(ATTRIBUTE_GROUPS)).min(1).max(ATTRIBUTE_GROUPS.length).refine((g) => new Set(g).size === g.length, 'each group once'),
}).strict();
export type PasteAttributesArgs = z.infer<typeof PasteAttributesArgsSchema>;
/** Why a (target, group) was left out, besides the underlying op's own OpErrorCode. */
export const PASTE_SKIP_CODES = ['source_empty', 'target_animated'] as const;
export type PasteSkipCode = (typeof PASTE_SKIP_CODES)[number] | OpErrorCode;
export interface PasteSkip { clipId: string; group: AttributeGroup; code: PasteSkipCode; message: string }
export interface PasteAttributesOutput {
  applied: { clipId: string; group: AttributeGroup }[]; skipped: PasteSkip[]; keysLeftOut: number;
  /** Effects of the source that only their own op adds (a living picture, livingContract.ts opOnlyEffect), not pasted; absent when none. */
  opOnlyLeftOut?: number;
}
/** planPasteAttributes: the op run on a copy; the dialog's rows equal the commit's applied + skipped. */
export interface PastePlan extends PasteAttributesOutput { revision?: number }

// ---------------------------------------------------------------- replace_text and find
const Id = z.string().min(1).max(128);
/** Where a text lives: exactly what projectVariant substitutes (variants.ts) plus the master title, cue and phrase. */
export const TextCarrierSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), clipId: Id }).strict(),
  z.object({ kind: z.literal('cue'), clipId: Id }).strict(),
  z.object({ kind: z.literal('phrase'), assetId: Id, segmentId: Id }).strict(),
  z.object({ kind: z.literal('override'), variantId: Id, clipId: Id }).strict(),
  z.object({ kind: z.literal('variantPhrase'), variantId: Id, assetId: Id, segmentId: Id }).strict(),
]);
export type TextCarrier = z.infer<typeof TextCarrierSchema>;
/** The most characters a carrier holds: phrases 4000, everything else 2000 (refused with replaceTooLong above it). */
export const carrierLimit = (at: TextCarrier): number => (at.kind === 'phrase' || at.kind === 'variantPhrase' ? CRAFT_LIMITS.phraseChars : CRAFT_LIMITS.wordingChars);
export const ReplaceTextArgsSchema = z.object({
  edits: z.array(z.object({
    at: TextCarrierSchema,
    was: z.string().max(CRAFT_LIMITS.phraseChars).describe('The whole text of the place as the search saw it; refused when it changed since'),
    text: z.string().min(1).max(CRAFT_LIMITS.phraseChars).describe('The whole new text of the place'),
  }).strict()).min(1).max(CRAFT_LIMITS.replaceEdits),
}).strict();
export type ReplaceTextArgs = z.infer<typeof ReplaceTextArgsSchema>;
export interface ReplaceTextOutput { changed: number; lostWordTiming: string[]; approximated: string[]; reviewAgain: string[] }

/** Find options; every flag explicit (C4). */
export const FindQuerySchema = z.object({
  text: z.string().min(1).max(CRAFT_LIMITS.findChars),
  wholeWord: z.boolean(),
  ignoreMarks: z.boolean().describe('«התעלמות מניקוד»: points and cantillation ignored'),
  finalsEqual: z.boolean().describe('«אותיות סופיות כרגילות»: ך ם ן ף ץ equal כ מ נ פ צ'),
  ignoreCase: z.boolean().describe('Latin A–Z only'),
  scope: z.enum(['project', 'clips']).default('project'),
  clipIds: z.array(Id).max(CRAFT_LIMITS.pasteTargets).optional(),
  formats: z.enum(['all', 'master', 'viewed']).default('all'),
  variantId: Id.optional().describe('The viewed format when formats=viewed'),
}).strict();
export type FindQuery = z.infer<typeof FindQuerySchema>;
export type MatchNote = 'final_mid_word';
export interface TextMatch {
  at: TextCarrier;
  sequenceId: string | null;
  kind: TextCarrier['kind'];
  variantId: string | null;
  /** The whole text of the place, and the [start, end) code-unit ranges matched in it. */
  text: string;
  ranges: [number, number][];
  /** Where Enter seeks to (timeline frame of the clip or the phrase), null when it is not on any timeline. */
  frame: number | null;
  notes: MatchNote[];
}
export interface FindResult { revision: number; matches: TextMatch[]; total: number; truncated: boolean }
export interface ReplacePlan {
  edits: ReplaceTextArgs['edits'];
  /** Said above «החלפת הכול» before anything is written. */
  lostWordTiming: string[]; approximated: string[]; reviewAgain: string[]; finalMidWord: number;
}

// ---------------------------------------------------------------- typed time (C5)
export const TIME_ENTRY_REFUSALS = ['unreadable', 'negative', 'not_whole_frames', 'too_large'] as const;
export type TimeEntryRefusal = (typeof TIME_ENTRY_REFUSALS)[number];
export type TimeEntryResult =
  | { ok: true; frame: number; relative: boolean; rounded: boolean }
  | { ok: false; reason: TimeEntryRefusal };

// ---------------------------------------------------------------- versions (server table; restore is restore_entities)
export const SaveVersionBodySchema = z.object({ name: z.string().trim().min(1).max(CRAFT_LIMITS.versionName) }).strict();
export const RenameVersionBodySchema = SaveVersionBodySchema;
export const RestoreVersionBodySchema = z.object({
  expectRevision: z.number().int().nonnegative().optional().describe('Refused 409 revision_conflict when the project moved since the dialog read it'),
  confirmPrivacy: z.boolean().optional().describe('Required (true) when the restore removes or changes a privacy region'),
}).strict();
/** One saved version on the wire: never the document. */
export interface VersionInfo {
  id: string; name: string; revision: number; createdAt: string; actor: string; bytes: number; frames: number;
  /** The current document equals the copy (canonical form). */
  sameAsCurrent: boolean;
  /** Saved before a privacy region changed (its privacy digest differs from the current one): stills and diff for the owner only. */
  privacyChanged: boolean;
}
export type DiffEntityKind = 'project' | 'sequence' | 'track' | 'clip' | 'marker' | 'variant' | 'recipeRun' | 'asset' | 'transcript' | 'analysis' | 'motionTrack' | 'multicam' | 'event' | 'person' | 'other';
/** One row of «מה השתנה» (counts and names; field-level rows are cut from version 1). */
export interface DiffRow { entity: DiffEntityKind; id: string; change: 'added' | 'removed' | 'changed'; name: string; restores: boolean }
export interface DiffSummary {
  counts: { added: number; removed: number; changed: number };
  /** At most 500 rows, then `more` counts the rest. */
  rows: DiffRow[]; more: number;
  /** Privacy regions restore would add, remove or change (the dialog asks twice when removed + changed > 0). */
  privacy: { added: number; removed: number; changed: number };
}
