/**
 * Shorts (ADR-0018): pick the best moments of a long recording and make vertical shorts with captions. The shared contract of
 * the sequence operations, the finder, the planner, the reframe, the server routes and the editor. Lead-owned; the bodies are
 * the workers' (W1 core make: sequenceOps.ts bodies, shortsPlan.ts, reframe.ts, quotes.ts; W2 find + server: statements.ts,
 * highlights.ts, apps/server/src/shortsFeatures.ts and shorts.ts; W3 the editor).
 *
 * FIXED RULES (wave4-decisions.md):
 * - Every short is its own sequence of the project (one sequence per short); the main edit is untouched. The output of a
 *   sequence is reached only through sequences.ts projectOutput (ADR-0005).
 * - Measured provenance (schema.ts SequenceOriginSchema) is written ONLY by the internal apply_sequence_plan, onto sequences
 *   created by that same op. No public op takes a score or a reason.
 * - The score is a 0–100 RELATIVE heuristic within one video, shown with its rank and the per-component explanation
 *   (measured values and verbatim quotes) and labelled «ציון יחסי בתוך הסרטון הזה (היוריסטיקה)». Never "viral", never a
 *   prediction of views or retention (SPEC.md:624). packages/evals/src/shorts-wording.test.ts forbids those words.
 * - Caps: SHORTS_CAPS (10 shorts per apply, 40 pieces per short, 2000 ops per apply) and schema.ts MAX_SEQUENCES (64).
 * - Platform presets: every field null and shown «לא אומת» until a dated source is fetched and recorded (wave 2).
 * - Reframe motion has exactly one owner: x keys on clips inside the short's own sequence, written through
 *   replace_clip_keyframes. Faces (ADR-0017 1b) and tracking's camera follow feed planReframe as ReframeSample sources.
 * - Times are exact rationals (ADR-0003); kept spans snap OUTWARD to whole frames (a spoken word is never cut short).
 */
import { z } from 'zod';
import type * as T from '@pulseframe/time';
import { ANIMATABLE, KeyframeSchema, LoudnessTargetSchema, RationalTimeSchema, SequenceFormatSchema, SequenceOriginSchema, CANDIDATE_ID, MAX_SEQUENCES, type Keyframe, type ShortOrigin, type ShortReason } from './schema.ts';
import { RefSchema, TemplateStepSchema, type TemplateStep } from './templateContract.ts';
import type { FillerCandidate } from './fillers.ts';
import { OpError, type OpCall, type OpErrorCode } from './ops.ts';

// =====================================================================================================================
// 1. The sequence operations (registered in sequenceOps.ts; bodies W1)
// =====================================================================================================================
/** The argument schemas of the four public sequence operations. */
export const SequenceOpArgs = {
  /** public. Output AddSequenceOutput (flat, so {$ref, out} can address each id). 'standard' (default) = V1, T1, A1 as createProject. Refused above MAX_SEQUENCES (tooManySequences). */
  add_sequence: z.object({
    name: z.string().min(1).max(128),
    format: SequenceFormatSchema.optional().describe('Its own output frame (for example 720×1280 for a vertical short); absent = the project frame'),
    tracks: z.enum(['standard', 'empty']).optional().describe("standard (default): a video, a text and an audio track, as a new project has; empty: no tracks"),
  }).strict(),
  /** public. A format on the main sequence is refused (mainSequenceFormat; hint set_project_format). format null removes it. */
  update_sequence: z.object({
    sequenceId: z.string(),
    name: z.string().min(1).max(128).optional(),
    format: SequenceFormatSchema.nullable().optional().describe('null removes the own frame (the sequence then renders at the project frame)'),
  }).strict(),
  /** public. Refuses mainSequence, track_locked, and sequenceNotEmpty unless withContents. Removes the sequence's markers. */
  remove_sequence: z.object({
    sequenceId: z.string(),
    withContents: z.boolean().optional().describe('true removes its tracks, clips and markers with it'),
  }).strict(),
  /**
   * public. Replaces one property's whole key list with set_keyframe's rules plus strictly increasing, frame-aligned,
   * non-negative times; keys null = clear and freeze at `at` (clip-local, default 0) like clear_keyframes. The bulk write path
   * of ADR-0018 (reframe), ADR-0019 (curves) and the tracking bake.
   */
  replace_clip_keyframes: z.object({
    clipId: z.string(),
    property: z.enum(ANIMATABLE),
    keys: z.array(KeyframeSchema).min(1).max(2000).nullable().describe('the whole new key list of this property, strictly increasing in time; null removes every key and keeps the value at `at`'),
    at: RationalTimeSchema.optional().describe('clip-local time whose value a cleared property keeps (keys null); default the clip start'),
  }).strict(),
} as const;
export type AddSequenceArgs = z.infer<typeof SequenceOpArgs.add_sequence>;
export type UpdateSequenceArgs = z.infer<typeof SequenceOpArgs.update_sequence>;
export type RemoveSequenceArgs = z.infer<typeof SequenceOpArgs.remove_sequence>;
export type ReplaceClipKeyframesArgs = z.infer<typeof SequenceOpArgs.replace_clip_keyframes>;
/** add_sequence's output. The track ids are null for tracks 'empty'. */
export interface AddSequenceOutput { sequenceId: string; videoTrackId: string | null; textTrackId: string | null; audioTrackId: string | null }
/** replace_clip_keyframes's output. */
export interface ReplaceClipKeyframesOutput { keyframeCount: number }
/** remove_sequence's output: what went with it. */
export interface RemoveSequenceOutput { removedTrackIds: string[]; removedClipIds: string[]; removedMarkerIds: string[] }

/** INTERNAL. Issued only by the server from a plan it built (apps/server/src/shorts.ts), like apply_recipe and apply_template. */
export const ApplySequencePlanArgsSchema = z.object({
  runId: z.string().optional(),
  planKind: z.enum(['shorts']),
  params: z.record(z.string(), z.unknown()),
  steps: z.array(z.string().max(400)).max(50),
  /** Plan-made sequences (origin.kind 'short') removed first with contents and markers (a rebuild, one undo step). */
  removeSequenceIds: z.array(z.string()).max(10).optional(),
  /** Public ops with bindings ({$ref} to an EARLIER step's output; templateOps.ts resolveBindings). */
  ops: z.array(TemplateStepSchema).min(1).max(2000),
  /** Written only onto sequences created by an add_sequence step of THIS op (else originNotCreated). */
  origins: z.array(z.object({ sequence: RefSchema, origin: SequenceOriginSchema }).strict()).max(10),
}).strict();
export type ApplySequencePlanArgs = z.infer<typeof ApplySequencePlanArgsSchema>;
export interface ApplySequencePlanOutput { runId: string; createdIds: string[]; sequenceIds: string[] }
/** RecipeRun.recipeId of a shorts plan run. */
export const SHORTS_RUN_ID = 'plan:shorts' as const;
/** The operations of the sequence lifecycle (public) and the plan op (internal). */
export const SEQUENCE_OPS = ['add_sequence', 'update_sequence', 'remove_sequence', 'replace_clip_keyframes'] as const;
export const SEQUENCE_PLAN_OP = 'apply_sequence_plan' as const;

// ---------- refusals of the sequence operations: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * Every refusal of the sequence operations. The messages are fixed: the Hebrew table recognises them by their shape
 * (packages/i18n/src/shorts.ts HE_SHORTS) and packages/evals/src/shorts-wording.test.ts keeps the two in step. Refusals the
 * bodies share with other edits keep those edits' words: a locked track (`track <id> is locked`, ops.ts mustTrack), a missing
 * clip, an out-of-range value (`value <v> is out of range for <p>`, as set_keyframe), an adjustment's keys (ops.ts
 * refuseAdjustmentTransform), a frame boundary (ops.ts assertAligned).
 */
export const SEQUENCE_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op} is not built yet`, 'This build has the contract of this operation but not its body.'),
  sequenceNotFound: refusal('not_found', (sequenceId: string) => `sequence ${sequenceId} not found`, 'list_sequences lists the sequences of the project.'),
  mainSequence: refusal('incompatible', () => 'the main sequence cannot be removed', 'Remove the clips you no longer want, or remove another sequence.'),
  mainSequenceFormat: refusal('incompatible', () => 'the main sequence takes its frame from the project settings', 'Use set_project_format to change the frame of the main edit, or add_variant for a linked format.'),
  tooManySequences: refusal('out_of_bounds', () => `a project holds at most ${MAX_SEQUENCES} sequences`, 'Remove a sequence you no longer need first.'),
  sequenceNotEmpty: refusal('incompatible', (clips: number) => `this sequence still has ${clips} clip(s)`, 'Pass withContents: true to remove it with its tracks, clips and markers.'),
  sequenceNothingToChange: refusal('invalid_args', () => 'nothing to change: give name or format'),
  sequenceFormatOdd: refusal('invalid_args', () => 'a sequence frame needs an even width and height (video encoders require it)'),
  keysNotIncreasing: refusal('invalid_args', () => 'keyframe times must be strictly increasing', 'Sort the keys by time and remove keys that share a time.'),
  keyBeforeStart: refusal('out_of_bounds', () => 'a keyframe cannot sit before the clip start'),
  captionKeys: refusal('incompatible', () => 'a caption cue has no keyframes', 'Move or style the caption track instead (set_caption_style).'),
  notPlanMade: refusal('incompatible', (sequenceId: string) => `sequence ${sequenceId} was not made by a shorts plan, so a rebuild cannot replace it`, 'Rebuild only shorts made by make_shorts; remove other sequences with remove_sequence.'),
  planStepForbidden: refusal('forbidden_op', (i: number, op: string) => `plan step ${i} uses "${op}", which is not a public operation`),
  planStepInvalid: refusal('invalid_args', (i: number, op: string, why: string) => `plan step ${i} (${op}): ${why}`),
  originNotCreated: refusal('invalid_args', (i: number) => `origin ${i} names a sequence this plan did not create`, 'An origin is written only onto a sequence made by an add_sequence step of the same plan.'),
} as const;
export type SequenceRefusalKey = keyof typeof SEQUENCE_REFUSALS;
/** The typed refusal of a sequence operation: `throw sequenceRefusal('sequenceNotEmpty', { sequenceId, clips }, clips)`. */
export function sequenceRefusal<K extends SequenceRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof SEQUENCE_REFUSALS)[K]['message']>): OpError {
  const r = SEQUENCE_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/** The summaries of the sequence operations (history and events), fixed like the refusals. */
export const SEQUENCE_SUMMARIES = {
  added: (name: string) => `Added sequence "${name}"`,
  updated: (name: string) => `Updated sequence "${name}"`,
  removed: (name: string) => `Removed sequence "${name}"`,
  keys: (property: string, count: number) => (count ? `Replaced the ${property} keyframes (${count})` : `Cleared the ${property} keyframes`),
  made: (count: number) => `Made ${count} short(s)`,
  rebuilt: (count: number) => `Rebuilt ${count} short(s)`,
} as const;

// =====================================================================================================================
// 2. Statements — packages/core/src/statements.ts (W2)
// =====================================================================================================================
export const STATEMENT_DEFAULTS = { pauseSeconds: 0.7, maxSeconds: 30, approximatePadSeconds: 0.25 } as const;
export interface StatementOptions { pauseSeconds?: number; maxSeconds?: number; approximatePadSeconds?: number }
export const STATEMENT_END_KINDS = ['period', 'question', 'exclaim', 'ellipsis', 'pause', 'phrase', 'split'] as const;
export interface Statement {
  /** 'st_' + fingerprint({segmentId, firstWordId | segment start}) (entities.ts fingerprint, 16 hex digits). */
  id: string;
  segmentId: string;
  wordIds: string[];
  /** SOURCE time; approximate phrases padded outward by approximatePadSeconds (clamped to the file). */
  start: T.RationalTime;
  end: T.RationalTime;
  /** Verbatim words joined by single spaces (the segment text for non-word timing). */
  text: string;
  endKind: (typeof STATEMENT_END_KINDS)[number];
  endsSentence: boolean;
  question: boolean;
  startsWithConnective: boolean;
  timing: 'word' | 'segment' | 'approximate';
  minConfidence: number | null;
  speaker: string | null;
}

// =====================================================================================================================
// 3. Audio features — apps/server/src/shortsFeatures.ts (W2); cached under the data dir, never in the document
// =====================================================================================================================
export const AUDIO_FEATURES_VERSION = 1 as const;
export const AUDIO_FEATURES_METHOD = 'audio-features 1: mono 16 kHz in 20-minute windows; per 100 ms hop: RMS level in dBFS (not LUFS), spectral flatness 100 Hz–7.9 kHz, positive log-spectral flux; no model' as const;
/** Hop i covers SOURCE time [i/10, (i+1)/10) s after the asset's time origin (speed.ts timeOriginSeconds). */
export const FEATURE_RATE = 16000;
export const FEATURE_HOP = 1600;
/** Floor of rmsDb (digital silence). */
export const FEATURE_RMS_FLOOR_DB = -100;
export interface AudioFeatures {
  assetId: string; contentHash: string; version: typeof AUDIO_FEATURES_VERSION;
  hops: number; analysedSeconds: number;
  /** Only the first 4 h are analysed (analysis.ts BEAT_TOTAL_MAX_SECONDS). */
  partial: boolean;
  /** length = hops; rmsDb floor FEATURE_RMS_FLOOR_DB. */
  rmsDb: Float32Array; flatness: Float32Array; flux: Float32Array;
  method: typeof AUDIO_FEATURES_METHOD;
}

// =====================================================================================================================
// 4. Candidates — packages/core/src/highlights.ts (W2)
// =====================================================================================================================
export const SHORTS_RANK_METHOD = 'shorts-rank 1: weighted percentiles of measured signals within this one video (statements, voice level, pace, fillers, pauses, shot changes); heuristic; not a prediction of views or retention' as const;
export const SCORE_COMPONENTS = ['complete', 'opening', 'voice', 'pace', 'moments', 'picture', 'clean'] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];
/** Sum 100. A missing input's weight is dropped and the rest rescaled to 100 (with a missing_input reason). */
export const SCORE_WEIGHTS: Readonly<Record<ScoreComponent, number>> = { complete: 25, opening: 20, voice: 15, pace: 10, moments: 10, picture: 5, clean: 15 };
/** Score penalties for timing that cannot drive word-precise cuts. */
export const SCORE_PENALTIES = { approximateTiming: 10, segmentTiming: 3 } as const;
export const CANDIDATE_WARNINGS = ['ends_mid_sentence', 'starts_with_reference', 'approximate_timing', 'segment_timing', 'no_transcript', 'no_scene_cuts', 'overlaps_existing_short', 'partial_analysis'] as const;
export type CandidateWarning = (typeof CANDIDATE_WARNINGS)[number];
/** Context the review plays around a candidate, each side (clamped to the file). */
export const REVIEW_CONTEXT_SECONDS = 10;
export const FindShortsBodySchema = z.object({
  assetId: z.string(),
  minSeconds: z.number().min(5).max(180).default(20),
  maxSeconds: z.number().min(5).max(180).default(60),
  count: z.number().int().min(1).max(40).default(10),
  contextSeconds: z.number().min(0).max(30).default(8),
  include: z.array(z.string().min(1).max(40)).max(20).default([]),
  exclude: z.array(z.string().min(1).max(40)).max(20).default([]),
  allowOverlap: z.boolean().default(false),
}).strict().refine((b) => b.minSeconds <= b.maxSeconds, { message: 'minSeconds must not exceed maxSeconds', path: ['minSeconds'] });
export type FindShortsBody = z.infer<typeof FindShortsBodySchema>;
export interface ShortCandidate {
  /** 'cand_' + fingerprint({assetId, start, end, method: SHORTS_RANK_METHOD}): 16 hex digits (schema.ts CANDIDATE_ID). */
  id: string;
  rank: number;
  assetId: string;
  start: T.RationalTime; end: T.RationalTime; seconds: number;
  statementIds: string[];
  /** All verbatim transcript words. */
  firstWords: string; text: string; contextBefore: string; contextAfter: string;
  /** ±REVIEW_CONTEXT_SECONDS around the window, clamped to the file: what the review plays. */
  context: { start: T.RationalTime; end: T.RationalTime };
  /** 0..100, relative within this one video; labelled heuristic. Never a prediction. */
  score: number;
  /** Percentile 0..100 per component; null = input missing. */
  components: Record<ScoreComponent, number | null>;
  /** The top 3 plus, the largest minus, then notes; at most 6. */
  reasons: ShortReason[];
  warnings: CandidateWarning[];
}
/** A window an exclude word removed, listed (never dropped silently). */
export interface ExcludedWindow { start: T.RationalTime; end: T.RationalTime; word: string; at: T.RationalTime }
export interface HighlightInputs {
  assetId: string; assetDuration: T.RationalTime;
  statements: Statement[] | null; fillers: FillerCandidate[] | null;
  features: AudioFeatures | null; sceneCuts: T.RationalTime[] | null;
  existingShorts: { start: T.RationalTime; end: T.RationalTime }[];
}
export interface ShortCandidatesResult { candidates: ShortCandidate[]; excluded: ExcludedWindow[]; basis: string[]; method: typeof SHORTS_RANK_METHOD; note: string }

// =====================================================================================================================
// 5. Make — packages/core/src/shortsPlan.ts (W1)
// =====================================================================================================================
/** Caps accepted by the lead (wave4-decisions.md). maxSequences is schema.ts MAX_SEQUENCES. */
export const SHORTS_CAPS = { maxShortsPerApply: 10, maxPiecesPerShort: 40, maxOps: 2000, minSeconds: 3, maxSeconds: 180, maxSequences: MAX_SEQUENCES } as const;
/** Audio fades at removal joins (and only there): exactly 1/100 s. */
export const JOIN_FADE = { value: '1', timescale: 100 } as const;
/** Kept around a removed pause, each side. */
export const PAUSE_KEEP_SECONDS = 0.12;
/** Shorts made from 1080p sources default to 1080×1920 with the honest 'upscaled' preflight warning (wave4-decisions.md). */
export const DEFAULT_SHORT_PROFILE = 'vertical-9x16' as const;
export const TITLE_ORIGINS = ['typed', 'quote', 'agent'] as const;
export const ShortPickSchema = z.object({
  candidateId: z.string().regex(CANDIDATE_ID).optional(),
  assetId: z.string(),
  start: RationalTimeSchema,
  end: RationalTimeSchema,
  name: z.string().min(1).max(128).optional(),
  /** typed: the user's words. quote: must be a verbatim run of the excerpt's words (else notVerbatim). agent: stored and flagged for review. */
  title: z.object({ text: z.string().min(1).max(200), origin: z.enum(TITLE_ORIGINS) }).strict().optional(),
}).strict();
export type ShortPick = z.infer<typeof ShortPickSchema>;
export const REFRAME_SOURCES = ['auto', 'track', 'centre', 'backdrop'] as const;
export const ReframeChoiceSchema = z.object({
  /** auto = track when motionTrackId is given, else centre. */
  source: z.enum(REFRAME_SOURCES).default('auto'),
  motionTrackId: z.string().optional(),
  framing: z.number().min(1).max(1.5).default(1),
}).strict();
export type ReframeChoice = z.infer<typeof ReframeChoiceSchema>;
export const ShortsLoudnessSchema = z.union([z.literal('project'), z.null(), LoudnessTargetSchema]);
export const BuildShortsBodySchema = z.object({
  picks: z.array(ShortPickSchema).min(1).max(SHORTS_CAPS.maxShortsPerApply),
  format: z.union([z.object({ profileId: z.string().max(64) }).strict(), SequenceFormatSchema]).default({ profileId: DEFAULT_SHORT_PROFILE }),
  snap: z.enum(['words', 'exact']).default('words'),
  tighten: z.object({ pauses: z.boolean().default(false), minPauseSeconds: z.number().min(0.3).max(5).default(0.7), fillers: z.boolean().default(false) }).strict().default({ pauses: false, minPauseSeconds: 0.7, fillers: false }),
  /** null = no caption track. lookId null = the default caption style. */
  captions: z.object({ lookId: z.string().max(64).nullable().default(null) }).strict().nullable().default({ lookId: null }),
  reframe: ReframeChoiceSchema.default({ source: 'auto', framing: 1 }),
  /** 'project' = follow settings.loudness; null = no normalisation; or a target (−14/−1 is only a labelled starting point, SPEC.md:368). */
  loudness: ShortsLoudnessSchema.default('project'),
  /** Rebuild: plan-made shorts replaced in the same undo step. */
  replaceSequenceIds: z.array(z.string()).max(10).optional(),
  expectedRevision: z.number().int().min(0).optional(),
}).strict();
export type BuildShortsBody = z.infer<typeof BuildShortsBodySchema>;
export const PLAN_WARNING_CODES = ['snapped_to_words', 'snapped_to_phrase', 'removal_skipped_flash_gap', 'removal_skipped_too_tight', 'no_scene_cuts', 'track_mostly_lost', 'upscaled', 'title_agent_text', 'look_needs_word_timing', 'no_audio', 'variant_over_sequence_format'] as const;
export type PlanWarningCode = (typeof PLAN_WARNING_CODES)[number];
export interface PlanWarning { code: PlanWarningCode; message: string; short: number | null; details: Record<string, unknown> }
export interface PlannedShort {
  name: string; assetId: string;
  excerpt: { start: T.RationalTime; end: T.RationalTime };
  kept: { start: T.RationalTime; end: T.RationalTime }[];
  pieces: number; frames: number; seconds: number; removedSeconds: number; cutsAdded: number;
  reframe: { source: 'track' | 'centre' | 'backdrop'; keys: number; shots: number; heldFrames: number; epsilon: number };
  operations: number;
}
export interface ShortsPlan {
  steps: string[]; basis: string[];
  ops: TemplateStep[];
  origins: { sequence: { $ref: string; out: 'sequenceId' }; origin: ShortOrigin }[];
  shorts: PlannedShort[]; warnings: PlanWarning[];
}
export interface ShortsPlanContext { createdAt: string; candidates: ReadonlyMap<string, ShortCandidate>; features: ReadonlyMap<string, AudioFeatures> }

/**
 * Codes of the shorts routes' refusals (ShortsError → ApiError status by SHORTS_STATUS). not_built: the stub of a worker's
 * body in this pre-pass (501), never a fabricated result.
 */
export const SHORTS_ERROR_CODES = ['not_found', 'invalid_args', 'needs_video', 'needs_measurement', 'not_verbatim', 'off_word_boundary', 'plan_too_large', 'tracking_not_available', 'not_built'] as const;
export type ShortsErrorCode = (typeof SHORTS_ERROR_CODES)[number];
export const SHORTS_STATUS: Readonly<Record<ShortsErrorCode, number>> = { not_found: 404, invalid_args: 400, needs_video: 422, needs_measurement: 409, not_verbatim: 422, off_word_boundary: 422, plan_too_large: 422, tracking_not_available: 409, not_built: 501 };
export class ShortsError extends Error {
  constructor(readonly code: ShortsErrorCode, message: string, readonly details: Record<string, unknown> = {}, readonly hint?: string) { super(message); }
}
interface ShortsRefusalRow<A extends unknown[]> { code: ShortsErrorCode; message: (...a: A) => string; hint?: string }
const shortsRow = <A extends unknown[]>(code: ShortsErrorCode, message: (...a: A) => string, hint?: string): ShortsRefusalRow<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * Every refusal of the finder, the planner and the routes, with fixed English wording (Hebrew: packages/i18n/src/shorts.ts
 * HE_SHORTS). Pick numbers (`i`) count from 1, as a person reads the list; details carry `pick` (0-based index) beside them.
 */
export const SHORTS_REFUSALS = {
  notBuilt: shortsRow('not_built', (what: string) => `${what} is not built yet`, 'This build has the contract of shorts but not this part.'),
  assetNotFound: shortsRow('not_found', (assetId: string) => `file ${assetId} is not in the library of this project`, 'get_summary lists the files.'),
  needsVideo: shortsRow('needs_video', () => 'shorts are made from a file with a picture', 'Pick a video file.'),
  pickTooShort: shortsRow('invalid_args', (i: number, min: number) => `pick ${i} is shorter than ${min} seconds`),
  pickTooLong: shortsRow('invalid_args', (i: number, max: number) => `pick ${i} is longer than ${max} seconds`),
  pickOutsideFile: shortsRow('invalid_args', (i: number) => `pick ${i} lies outside the file`),
  unknownProfile: shortsRow('not_found', (profileId: string) => `format profile "${profileId}" is not one of the format profiles`, 'list_catalog → formatProfiles lists them.'),
  unknownCaptionLook: shortsRow('not_found', (lookId: string) => `caption look "${lookId}" is not one of the caption looks`, 'list_catalog → captionLooks lists them.'),
  needsMeasurement: shortsRow('needs_measurement', () => 'tightening pauses without word timing needs the sound of this file measured first', 'Call find_short_candidates for this file (it measures the sound), then make the shorts again.'),
  notVerbatim: shortsRow('not_verbatim', (i: number) => `the quote title of pick ${i} is not a run of words spoken in its excerpt`, "Copy the words exactly as transcribed, or give the title origin 'typed'."),
  offWordBoundary: shortsRow('off_word_boundary', (i: number, edge: 'start' | 'end') => `the ${edge} of pick ${i} does not fall on a word edge`, "Use the nearest word edges given in the details, or snap 'words'."),
  planTooLarge: shortsRow('plan_too_large', (operations: number) => `the plan needs ${operations} operations; at most ${SHORTS_CAPS.maxOps} fit in one step`, 'Make fewer shorts at once, or turn tightening off.'),
  motionTrackNotFound: shortsRow('not_found', (motionTrackId: string) => `motion track ${motionTrackId} not found`, 'get_summary lists the motion tracks.'),
  motionTrackOtherFile: shortsRow('tracking_not_available', (motionTrackId: string) => `motion track ${motionTrackId} follows a subject in another file`, 'Track the subject in the file the short is made from, or use the centre or the blurred backdrop.'),
  rotatedClip: shortsRow('tracking_not_available', () => 'a turned picture (rotation) cannot follow a motion track in a short', 'Use the centre or the blurred backdrop for it.'),
  notPlanMade: shortsRow('invalid_args', (sequenceId: string) => `sequence ${sequenceId} was not made by a shorts plan, so a rebuild cannot replace it`, 'Rebuild only shorts made by make_shorts.'),
  sequenceNotFound: shortsRow('not_found', (sequenceId: string) => `sequence ${sequenceId} not found`, 'list_sequences lists the sequences of the project.'),
} as const;
export type ShortsRefusalKey = keyof typeof SHORTS_REFUSALS;
export function shortsRefusal<K extends ShortsRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof SHORTS_REFUSALS)[K]['message']>): ShortsError {
  const r = SHORTS_REFUSALS[key] as ShortsRefusalRow<unknown[]>;
  return new ShortsError(r.code, r.message(...values), details, r.hint);
}
/**
 * The browser export route writes no subtitle file (no sidecar), and its snapshot is the output's own document with the
 * caption tracks hidden unless captions are burned (server export.ts renderDocFor): a sidecar-* request there is refused
 * (422 unsupported_in_browser_export, details: captions, supported) rather than exported without its captions.
 */
export const BROWSER_EXPORT_SIDECAR_REFUSED = {
  message: 'the browser export route cannot write a subtitle file, so the captions would be lost',
  hint: 'Use the server export for a subtitle file, or choose captions burned (drawn into the picture) or none.',
  supported: ['burned', 'none'],
} as const;
/** A proposal (propose mode) cannot carry the internal plan op: the server answers 403 insufficient_scope with these words. */
export const SHORTS_PROPOSE_REFUSED = 'making shorts is committed by the server as one step, which a proposal cannot carry; ask the owner to make them, or switch this credential to edit mode' as const;

// =====================================================================================================================
// 6. Reframe — packages/core/src/reframe.ts (W1)
// =====================================================================================================================
/** deadZone and maxSpeed in frame widths (/s); epsilon in transform-x units (schema.ts TransformSchema.x). */
export const REFRAME_DEFAULTS = { deadZone: 0.08, maxSpeed: 0.6, smoothSeconds: 0.25, epsilon: 0.004, settleSeconds: 0.5, maxKeys: 2000 } as const;
/** The backdrop: a picture-only copy blurred by blur.gaussian at this radius and opacity under the contained foreground. */
export const BACKDROP = { blurRadius: 0.035, opacity: 0.55, effect: 'blur.gaussian' } as const;
/** A clip whose blur.gaussian radius is at least this is a backdrop: preflight's 'upscaled' check skips it. */
export const BACKDROP_MIN_BLUR = 0.01;
/** Subject centre as a fraction of the SOURCE width; null = unusable (lost / unknown / weak per lossFlags and isUsable). */
export interface ReframeSample { u: number | null; conf: number }
export interface ReframeInput {
  frame: { width: number; height: number };
  /** fit is always cover. */
  source: { width: number; height: number };
  framing: number;
  rate: { num: number; den: number };
  /** One per clip-local frame 0..n-1. */
  samples: readonly ReframeSample[];
  deadZone?: number; maxSpeed?: number; smoothSeconds?: number; epsilon?: number;
}
export interface ReframeResult {
  /** The static value, or the first key's value. */
  x: number;
  /** LINEAR easing only; times frameTime(k, rate), k whole, clip-local; null = a path with no movement. */
  keys: Keyframe[] | null;
  /** Coverage clamp |x| ≤ limit. */
  limit: number;
  /** Tolerance used (doubled until at most REFRAME_DEFAULTS.maxKeys keys). */
  epsilon: number;
  heldFrames: number;
}
export const ReframePlanBodySchema = z.object({ source: z.enum(['auto', 'track', 'centre']).default('auto'), motionTrackId: z.string().optional(), framing: z.number().min(1).max(1.5).default(1) }).strict();
export type ReframePlanBody = z.infer<typeof ReframePlanBodySchema>;
/** At most this many replace_clip_keyframes calls in one reframe plan: fits one client transaction (apps/server/src/http.ts). */
export const MAX_REFRAME_OPS = 200;
export interface ReframeShot { clipId: string; source: 'track' | 'centre'; keys: number; heldFrames: number }
export interface ReframePlanView { revision: number; sequenceId: string; operations: OpCall[]; shots: ReframeShot[]; warnings: PlanWarning[]; note: string }

// =====================================================================================================================
// 7. Views (server W2, editor W3)
// =====================================================================================================================
export const SHORTS_MEASUREMENT_KIND = 'shorts-candidates' as const;
export interface ShortCandidatesView extends ShortCandidatesResult { revision: number; assetId: string; features: { hops: number; partial: boolean } | null }
export interface ShortsPlanView { revision: number; steps: string[]; basis: string[]; shorts: PlannedShort[]; warnings: PlanWarning[]; operations: number; method: string; note: string }
export interface ShortsApplyResult { revision: number; runId: string; sequenceIds: string[]; createdIds: string[]; steps: string[]; warnings: PlanWarning[] }
/** Progress stages of the measuring job (STAGE_WORDS in packages/i18n/src/shorts.ts). */
export const SHORTS_STAGES = ['measuring audio features', 'ranking moments'] as const;
