/**
 * «מוזיקה שמתאימה לסרט» — music that ends with the film (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md). The lead's
 * contract: limits, methods, wire shapes of the plan and apply routes, the refusals of the four operations (fixed English; Hebrew in
 * packages/i18n/src/musicFit.ts HE_MUSICFIT), the warning codes, and the licence rule of a shortened library song (complete here,
 * fail-closed). Builders change none of it without the lead.
 *
 * Version 1 (decisions §1): exact built-in endings (free clip, film, template); ONE removal of whole bars from a song, as a made file
 * whose join is labelled «עוד לא הושמע» until the owner marks it; swapping the music of a free clip, a film or a template with a
 * re-cut; impact sync. Cut: the montage swap, re-timing hand-edited template slots, the closing-card chord rule, the fine-alignment
 * lag, the preflight issue.
 *
 * Nothing here judges how anything sounds: a similarity is a heuristic's number, and no string praises a join or an ending before
 * the owner has heard it (MUSICFIT_FORBIDDEN_WORDS, checked by packages/evals/src/musicfit-wording.test.ts).
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { AssetSchema, RationalTimeSchema, type LibraryRecord, type ProjectDocument } from './schema.ts';
import type { OpErrorCode } from './ops.ts';
import { OpError } from './ops.ts';
import { libraryOrigins, licensedOrigins } from './libraryCredits.ts';
import type { SourceRecord, SourceWarningCode } from './sourcesContract.ts';
import { libraryRecordProblems } from './libraryDuties.ts';

export const MUSICFIT = {
  /** The longest song the join search reads (seconds). */
  maxSeconds: 600,
  /** Below this similarity the plan warns join_weak. A GUESS until the owner has heard joins above and below it. */
  joinWarnSimilarity: 0.6,
  /** The crossfade that ENDS on the join: min(a quarter beat, max), at least min (ms). */
  crossfadeMinMs: 20, crossfadeMaxMs: 60,
  /** Join candidates a plan offers at most. */
  maxCandidates: 3,
  /** Spread of the measured beat intervals above which the plan warns tempo_unsteady (ms). */
  tempoSpreadWarnMs: 15,
  /** Proof gates of an exact built-in ending (decisions §4 B3): trailing digital silence at most, RMS before the fade at least. */
  trailSilenceMaxMs: 150, fadeRmsMinDbfs: -45,
  /** The level under which the end of a song is silence (dBFS). */
  silenceDbfs: -60,
} as const;
/** Names the join heuristic and its version (provenance.fitted.method). */
export const FIT_METHOD = 'pulseframe musicfit 1: one removal of whole bars; bar features (8 slices, pitch classes from 130 Hz, band levels); linear equal-gain crossfade ending on the join; a heuristic, not heard' as const;
/** The origin method of a shortened song's beat analysis: derived exactly from the source's measured beats. */
export const FIT_GRID_METHOD = 'derived exactly from the measured beats of the source song by removing whole bars (musicfit 1); nothing was measured again' as const;
/** Shown on every shortened song until provenance.fitted.heard is set. */
export const MUSICFIT_UNHEARD_LABEL = { he: 'חיבור אוטומטי — עוד לא הושמע', en: 'Automatic join — not heard yet' } as const;
/** Said with every exact built-in ending: it is composed again, not the same notes. */
export const MUSICFIT_COMPOSED_AGAIN = { he: 'המוזיקה נבנית מחדש באותו סגנון לאורך הזה; אלה לא אותם צלילים', en: 'The music is composed again in the same style for this length; these are not the same notes' } as const;
/** No string of this track praises a join or an ending (en and he). */
export const MUSICFIT_FORBIDDEN_WORDS = /\b(smooth|smoothly|seamless|seamlessly|perfect|perfectly|synced|in sync|inaudible|flawless)\b/i;
export const MUSICFIT_FORBIDDEN_WORDS_HE = /חלק לגמרי|בלי תפר|מושלם|מסונכרן|לא נשמע בכלל|ללא רבב/;

// ---------- wire shapes (POST …/music-fit/plan and …/apply; MCP plan_music_fit, apply_music_fit) ----------
/** A removal names its two bar starts of the source's CURRENT analysis (never an index into a list). Source times. */
export const JoinRemovalSchema = z.object({ from: RationalTimeSchema, to: RationalTimeSchema }).strict();
export type JoinRemoval = z.infer<typeof JoinRemovalSchema>;
export const MusicFitTargetSchema = z.union([
  z.object({ clipId: z.string().min(1).max(64) }).strict(),
  z.object({ runId: z.string().min(1).max(64) }).strict().describe('A family film or template run (recipe run id)'),
]);
export const MusicFitChoiceSchema = z.union([
  z.object({ keep: z.literal(true) }).strict().describe('The music already there'),
  z.object({ assetId: z.string().min(1).max(64) }).strict().describe('A sound file of the library'),
  z.object({ builtin: z.object({ styleId: z.string().regex(/^music\.[a-z0-9-]{1,24}$/), seed: z.number().int().min(0).max(1_000_000).optional() }).strict() }).strict(),
]);
export const MusicFitPlanRequestSchema = z.object({
  target: MusicFitTargetSchema,
  music: MusicFitChoiceSchema,
  /** Make the music end with the film (exact built-in ending, or one removal of whole bars from a song). */
  tailor: z.boolean(),
  /** A song: the removal to plan with (from a candidate of an earlier plan); default: the first candidate. */
  removal: JoinRemovalSchema.optional(),
  /** A film or template: cut again on the new music's beats (default true when the music changes). */
  recut: z.boolean().optional(),
}).strict();
export type MusicFitPlanRequest = z.infer<typeof MusicFitPlanRequestSchema>;
export const MusicFitApplyRequestSchema = MusicFitPlanRequestSchema.extend({ expectedRevision: z.number().int().min(0) }).strict();
export type MusicFitApplyRequest = z.infer<typeof MusicFitApplyRequestSchema>;

export const MUSICFIT_WARNING_CODES = ['join_weak', 'tempo_unsteady', 'music_keys_dropped', 'cuts_faster', 'kept_cuts_close', 'music_short', 'impacts_off_beat', 'composed_again'] as const;
export const MUSICFIT_BLOCKING_CODES = ['flash_gap', 'template_blocked'] as const;
export interface MusicFitNote { code: (typeof MUSICFIT_WARNING_CODES)[number] | (typeof MUSICFIT_BLOCKING_CODES)[number] | FitSourceNoteCode; message: string; details: Record<string, unknown> }
export interface JoinCandidate {
  removal: JoinRemoval;
  /** Seconds of the made file and how far it lies from the wanted length (negative = shorter). */
  madeSeconds: number; offBySeconds: number;
  measured: { similarity: number; levelStepDb: number; phraseBars: 1 | 2 | 4; tempoSpreadMs: number; beatConfidence: number | null };
}
export interface CutStats { cuts: number; minGapFrames: number | null; maxInOneSecond: number }
export interface MusicFitPlan {
  revision: number;
  target: { kind: 'clip' | 'film' | 'template'; clipId: string | null; runId: string | null };
  /** What will be made, if anything: an exact built-in track, a shortened song, or nothing (the file is used as it is). */
  make: { kind: 'builtin'; styleId: string; seed: number; bars: number; endFrames: number } | { kind: 'fitted'; sourceAssetId: string; candidates: JoinCandidate[]; chosen: number } | { kind: 'none' };
  wantedSeconds: number;
  /** How the music ends, in words for the dialog: with the film; early with its own ending; cut and faded at the film's end. */
  ending: { kind: 'exact' | 'early' | 'cut'; seconds: number };
  recut: { before: CutStats; after: CutStats; thinned: number; kept: string[]; movedBack: string[]; offGrid: string[]; blocked: string[] } | null;
  impacts: { clipId: string; framesFromBeatBefore: number | null; framesFromBeatAfter: number | null }[];
  warnings: MusicFitNote[]; blocking: MusicFitNote[];
  /** What the plan rests on (the measurements, the grid), and the sentence that a join is a heuristic when it is one. */
  basis: string[];
}
export interface MusicFitApplyResult {
  revision: number;
  /** The file made in the first commit (absent when nothing was made or the same bytes were there). */
  madeAssetId: string | null; madeRevision: number | null;
  /** The second commit: one transaction, one undo. */
  transactionId: string; plan: MusicFitPlan;
}

// ---------- the four operations' arguments (registered in impactOps.ts and musicFitOps.ts) ----------
/** Public. Writes the marked moment (file clock) of a video or sound clip, or clears it with null. */
export const SetClipImpactArgsSchema = z.object({
  clipId: z.string(),
  moment: RationalTimeSchema.nullable().describe('Source time of the clip\'s FILE (its own clock), or null to clear the mark'),
}).strict();
export type SetClipImpactArgs = z.infer<typeof SetClipImpactArgsSchema>;
/** Public. Slips the clip's source (place and length never change) so its marked moment shows on the frame of a beat or bar start. */
export const SyncImpactArgsSchema = z.object({
  clipId: z.string(),
  moment: RationalTimeSchema.optional().describe('Mark this moment first (file clock); default: the clip\'s mark'),
  to: z.enum(['beat', 'bar']),
  pick: z.enum(['nearest', 'earlier', 'later']).optional().describe('Default nearest; a tie goes to the earlier'),
}).strict();
export type SyncImpactArgs = z.infer<typeof SyncImpactArgsSchema>;
/** sync_impact output: the slip, the offset before (frames, ms), the signed residual after (ms, at most half a frame), whose beats. */
export interface SyncImpactOutput { by: T.RationalTime; target: T.RationalTime; offsetBefore: { frames: number; ms: number }; residualMs: number; musicClipId: string; viaAssetId: string; wanted: T.RationalTime; used: T.RationalTime }
/** The beat data of a shortened song (add_fitted_music.grid): exactly what the op writes as its beat analysis. Source times of the made file. */
export const FittedGridSchema = z.object({
  method: z.literal(FIT_GRID_METHOD),
  bpm: z.number().min(20).max(400).nullable(), meter: z.number().int().min(2).max(12).nullable(), confidence: z.number().min(0).max(1).nullable(),
  beats: z.array(RationalTimeSchema).min(2).max(50000), downbeats: z.array(RationalTimeSchema).max(50000),
}).strict();
export type FittedGrid = z.infer<typeof FittedGridSchema>;
/** Internal (the server only, after it made and verified the bytes). Into the library, deduplicated by content, with its grid. */
export const AddFittedMusicArgsSchema = z.object({
  asset: AssetSchema.omit({ id: true }),
  grid: FittedGridSchema,
  place: z.object({ start: RationalTimeSchema, trackId: z.string().optional(), sequenceId: z.string().optional() }).strict().optional(),
}).strict();
export type AddFittedMusicArgs = z.infer<typeof AddFittedMusicArgsSchema>;
export interface AddFittedMusicOutput { assetId: string; deduplicated: boolean; analysisAttached: boolean; clipId?: string; trackId?: string }
/** Internal (owner-only route). Sets or clears provenance.fitted.heard. */
export const MarkJoinHeardArgsSchema = z.object({ assetId: z.string(), heard: z.boolean(), at: z.string().min(1).max(40) }).strict();
export type MarkJoinHeardArgs = z.infer<typeof MarkJoinHeardArgsSchema>;
/** The public operations of this track (both excluded from the language assistant: assistantContract.ts). */
export const MUSICFIT_PUBLIC_OPS = ['set_clip_impact', 'sync_impact'] as const;
export const MUSICFIT_INTERNAL_OPS = ['add_fitted_music', 'mark_join_heard'] as const;

// ---------- the refusals of the four operations (decisions §4): code, fixed English, hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * set_clip_impact checks: clip (generic not_found), impactNoMoment, impactOutsideFile. sync_impact: clip, impactNoMoment, noImpact,
 * impactOutsideFile, impactOutside, noMusic, noRoom, alreadyOnBeat, then every refusal of slip_clip. add_fitted_music: fittedNotSound,
 * fittedSourceMissing, the licence keys (fitLicenceProblem, in its order), fittedGrid, removalNotBars. mark_join_heard: joinNotFitted.
 * The music-fit planner refuses notFollowable and the licence keys before anything is made.
 */
export const MUSICFIT_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op}: music that fits the film is not built in this build yet`, 'Update the editor and try again.'),
  impactNoMoment: refusal('incompatible', () => 'a still, a freeze frame or a title has no moment to mark', 'Choose a video or sound clip.'),
  impactOutsideFile: refusal('out_of_bounds', () => 'the moment is outside the file'),
  noImpact: refusal('invalid_args', () => 'mark the moment first', 'set_clip_impact, or pass moment.'),
  impactOutside: refusal('out_of_bounds', () => 'the marked moment is not in the part this clip shows', 'Mark the moment again inside the clip.'),
  noMusic: refusal('incompatible', () => 'no music with measured beats plays under this moment', 'Add music, or measure its beats.'),
  noRoom: refusal('out_of_bounds', () => 'the file has no material to bring the moment to that beat', 'Try the earlier or the later beat (pick).'),
  alreadyOnBeat: refusal('invalid_args', () => 'the moment is already on that beat\'s frame'),
  notFollowable: refusal('incompatible', () => 'music that plays backwards or at another speed cannot be fitted or swapped', 'Give it speed 1, forwards, first (set_clip_speed, set_clip_reverse).'),
  fittedNotSound: refusal('invalid_args', () => 'a fitted track is a sound file shortened from a file of this library'),
  fittedSourceMissing: refusal('not_found', (assetId: string) => `the song ${assetId} it was shortened from is not in this project`),
  licenceNoDerivatives: refusal('incompatible', (licenceId: string) => `the licence of this music (${licenceId}) forbids changing it, so it cannot be shortened`, 'Choose other music.'),
  licenceShareAlike: refusal('incompatible', (licenceId: string) => `the licence of this music (${licenceId}) would put the whole video under the same licence, so it is not shortened`, 'Choose other music.'),
  licenceUnknown: refusal('incompatible', (licenceId: string) => `the licence of this music (${licenceId}) is not one the editor knows, so it is not shortened`, 'Choose other music.'),
  licenceManyOrigins: refusal('incompatible', () => 'this music was made from more than one library file, so shortening it is not offered', 'Shorten the original file instead.'),
  alreadyFitted: refusal('incompatible', () => 'this music is already a shortened copy', 'Shorten the original song instead.'),
  fittedGrid: refusal('invalid_args', () => 'the beats of the shortened track are not ascending or lie outside the file', 'Plan the fit again.'),
  removalNotBars: refusal('invalid_args', () => 'the removed stretch must start and end on bar starts of the song\'s measured beats', 'Plan the fit again.'),
  joinNotFitted: refusal('not_found', (assetId: string) => `file ${assetId} is not a shortened song`),
} as const;
export type MusicFitRefusalKey = keyof typeof MUSICFIT_REFUSALS;
export function musicFitRefusal<K extends MusicFitRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MUSICFIT_REFUSALS)[K]['message']>): OpError {
  const r = MUSICFIT_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}

// ---------- the licence rule of a shortened song (decisions §1; complete, fail-closed) ----------
export type FitLicenceKey = 'alreadyFitted' | 'licenceManyOrigins' | 'licenceNoDerivatives' | 'licenceShareAlike' | 'licenceUnknown';
/**
 * Why this file may not be shortened, or null when it may. In this order: a file that is itself a shortened song; a file made from
 * more than one library file; the one library record it stems from failing the core licence table (no-derivatives, share-alike, or
 * anything else: unknown). A file with no library origin (built-in music, the owner's own import) passes. Pure.
 */
export function fitLicenceProblem(doc: ProjectDocument, assetId: string): { key: FitLicenceKey; licenceId: string | null } | null {
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId] : undefined;
  if (!asset) return null;
  if (asset.provenance.fitted) return { key: 'alreadyFitted', licenceId: null };
  // library AND source records (wave 8 sources, C4): one copy carries one record, so more than one origin stays refused (a fact)
  const all = licensedOrigins(doc, assetId);
  if (all.length > 1) return { key: 'licenceManyOrigins', licenceId: null };
  // a song from a stock source or a link: its licence findings are WARNINGS (fitSourceNotes), never a refusal (C14)
  const origins = libraryOrigins(doc, assetId);
  if (origins.length === 0) return null;
  const record = origins[0]!.record;
  const first = libraryRecordProblems(record)[0];
  if (!first) return null;
  const key: FitLicenceKey = first.key === 'licenceNoDerivatives' ? 'licenceNoDerivatives' : first.key === 'licenceShareAlike' ? 'licenceShareAlike' : 'licenceUnknown';
  return { key, licenceId: record.licence.id };
}
/** The library record a shortened copy of this file carries (provenance.library of the made file), or null. Only after fitLicenceProblem passed. */
export function fittedLibraryRecord(doc: ProjectDocument, assetId: string): LibraryRecord | null {
  const origins = libraryOrigins(doc, assetId);
  return origins.length === 1 ? structuredClone(origins[0]!.record) : null;
}
/**
 * The source record a shortened copy of this file carries (provenance.source of the made file, C4a), or null: the record of its ONE
 * licensed origin when that origin is a fetched file. Only after fitLicenceProblem passed. The copy is origin 'derived' with fitted,
 * which validation allows; its sha256 stays the fetched original's (compared only for origin 'upload').
 */
export function fittedSourceRecord(doc: ProjectDocument, assetId: string): SourceRecord | null {
  const origins = licensedOrigins(doc, assetId);
  return origins.length === 1 && origins[0]!.source ? structuredClone(origins[0]!.source) : null;
}
/** The licence findings a plan of a shortened source song shows (sourceDuties of its one source record), as music-fit notes. */
export const FIT_SOURCE_NOTE_CODES = ['licence_no_derivatives', 'licence_share_alike', 'licence_unknown', 'licence_unconfirmed', 'source_terms', 'non_commercial_content'] as const satisfies readonly (SourceWarningCode | 'non_commercial_content')[];
export type FitSourceNoteCode = (typeof FIT_SOURCE_NOTE_CODES)[number];
/**
 * Warnings (never refusals, C14) of shortening a song fetched from a stock source or a link: the licence and term findings of its one
 * source record, each quoting the licence's own words (sourceDuties). Empty for a library song, built-in music or the owner's file.
 */
export function fitSourceNotes(doc: ProjectDocument, assetId: string): MusicFitNote[] {
  const origins = licensedOrigins(doc, assetId);
  if (origins.length !== 1 || origins[0]!.origin !== 'source') return [];
  return origins[0]!.licenceNotes.filter((n): n is typeof n & { code: FitSourceNoteCode } => (FIT_SOURCE_NOTE_CODES as readonly string[]).includes(n.code))
    .map((n) => ({ code: n.code, message: n.message, details: { assetId: n.assetId ?? assetId, licenceId: n.licenceId ?? null, licenceName: n.licenceName ?? null, termIds: n.termIds } }));
}
/** The licence refusal of fitLicenceProblem as an OpError (add_fitted_music, and the planner's own check). */
export function fitLicenceRefusal(p: { key: FitLicenceKey; licenceId: string | null }, assetId: string): OpError {
  const details = { assetId, licenceId: p.licenceId };
  switch (p.key) {
    case 'alreadyFitted': return musicFitRefusal('alreadyFitted', details);
    case 'licenceManyOrigins': return musicFitRefusal('licenceManyOrigins', details);
    case 'licenceNoDerivatives': return musicFitRefusal('licenceNoDerivatives', details, p.licenceId ?? '');
    case 'licenceShareAlike': return musicFitRefusal('licenceShareAlike', details, p.licenceId ?? '');
    case 'licenceUnknown': return musicFitRefusal('licenceUnknown', details, p.licenceId ?? '');
  }
}

/** The sentence a plan says about a join, with its numbers (Hebrew first; never praise). */
export function joinMeasuredSentence(m: JoinCandidate['measured']): { he: string; en: string } {
  const sim = m.similarity.toFixed(3), lvl = Math.abs(m.levelStepDb).toFixed(1);
  return {
    he: `נמדד, לא נשמע: דמיון ${sim} בין התיבות שמשני צידי החיבור; הפרש עוצמה ${lvl} dB; על גבול של ${m.phraseBars} תיבות`,
    en: `Measured, not heard: similarity ${sim} between the bars on both sides of the join; level step ${lvl} dB; on a ${m.phraseBars}-bar boundary`,
  };
}
/** Seconds of a rational time for the wording (never stored). */
export const fitSeconds = (t: T.RationalTime): number => Math.round(T.toSeconds(t) * 1000) / 1000;

/** Thrown by a pure function of this track that its builder has not written yet (never a made-up value). */
export class MusicFitNotBuilt extends Error {
  constructor(public fn: string) { super(`${fn}: music that fits the film is not built in this build yet`); }
}
