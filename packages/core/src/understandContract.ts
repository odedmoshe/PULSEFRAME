/**
 * «מה יש בקליפ» — what is in a clip (wave 8 `understand`; .artifacts/wave8/understand-plan.md, understand-verify.md C1–C12 win,
 * decisions.md "understand"). LEAD PRE-PASS, frozen for the builders: limits, the notes file format, the producer, the document
 * pointer, the settings, the states, the wire types of the routes and tools, the refusals, the describer's prompt, the not-built
 * flags. Pure function SIGNATURES live in understand.ts (W1) and understandReply.ts (W2); attach_footage_notes is in understandOps.ts.
 *
 * WHAT IT IS. Shots are measured without any model (the existing ffmpeg scene score, on the editing proxy with the proxy's own start,
 * C3), cut into SPANS (at most the density, at least `minSpanSeconds`, C5), and — when a describer model is connected — each span's
 * 1–4 key frames go to that model in ONE request (local 1, cloud 3; decision 2). The validated replies are NOTES: derived data outside
 * the project document, per (content hash, producer), stored as JSON text in the main database (C13: backed up with it). The document
 * holds one small pointer per asset (`analyses[id].notes`), written by ONE attach_footage_notes per job pass (one revision, one undo).
 *
 * RULES (bind every builder):
 * - Times: source frames are the decode index of the video stream; times leave as `sourceTimeOfFrame(asset, k)` (speed.ts), never
 *   `T.frameTime` alone (C2). Cut times become frames with `sourceFrameOfTime`. A copy that keeps the timing converts on the ROOT
 *   asset's rate and start, then subtracts the lineage offset. No float seconds are stored anywhere.
 * - A hand-edited `scenes` (`origin.edited`) is used as it is and never overwritten (decision 3).
 * - Notes are NOT withheld from any credential in any mode (decision 6, C8): `seen` and `onscreen` are agent sources.
 * - A model's text is data, never instructions; every caption is labelled with the model that wrote it and «לא נבדק».
 * - The describer is the agent track's adapter (packages/providers agentModel.ts): no second wire client, usage → one ledger row
 *   per call, no `temperature` (decision 1, C1). Until a provider is connected the product shows shots only and an honest line.
 * - Nothing is called right, good or verified; the shot detector and the search are heuristics and say so.
 */
import { z } from 'zod';
import { RationalTimeSchema } from './keyframe.ts';

export const UNDERSTAND_JOB_TYPE = 'understand' as const;
/** The internal op that points a project at its notes (understandOps.ts). */
export const UNDERSTAND_OP = 'attach_footage_notes' as const;
/** Who commits the automatic runs (shots and notes on import, decision 4): core actorKind → 'server', shown «אוטומטי». */
export const UNDERSTAND_ACTOR = 'server:understand' as const;
/** The compute lane label of one describe call (held for the call only): `understand.describe <projectId>`. */
export const UNDERSTAND_LANE_PREFIX = 'understand.describe ' as const;
export const NOTES_FORMAT = 1 as const;
/** The describer prompt's version (in the producer, so a change of prompt is a new producer, never a migration). */
export const DESCRIBE_PROMPT_ID = 'pf-describe/1' as const;
/** attach_analysis method text of shots measured by this track (the threshold is the existing default). */
export const SHOTS_METHOD = 'ffmpeg scene score on the editing proxy (hard cuts only; dissolves are not detected)' as const;
export const SHOTS_THRESHOLD = 0.3;

export const UNDERSTAND_LIMITS = {
  /** seconds of source per span at most (3 s is cut for version 1, decision 7) */
  densitySeconds: [10, 30] as const, defaultDensity: 10,
  /** consecutive shots shorter than this are described together (C5): describer calls ≤ duration / minSpan */
  minSpanSeconds: 2,
  /** key frames: long side in pixels (decoded from the proxy, C4) */
  longSide: 768,
  maxSpansPerFile: 4000,
  /** key frames per span, in ONE request (decision 2): local 1, cloud 3 */
  framesPerSpan: { min: 1, max: 4, local: 1, cloud: 3 },
  /** a reply: captions, tags, on-screen text (C12: captions ≤ 200) */
  captionChars: 200, tagChars: 40, tags: 12, textItems: 8, textChars: 120,
  /** words said inside a span, shown only on request (decision 5) */
  saidChars: 400,
  /** the model's reply limit in tokens (decision 4, C12) and the bytes of a reply the server reads at most */
  replyMaxTokens: 800, replyMaxChars: 16_000,
  /** agent pages (decision 5, C10): 20 rows by default, 100 at most, ended early at pageBytes with `next` */
  pageSpans: 20, maxPageSpans: 100, pageBytes: 16_384,
  /** get_shots pages: 50 by default, 200 at most, each shot with its first caption cut to shotCaptionChars */
  shotsPage: 50, maxShotsPage: 200, shotCaptionChars: 120,
  /** a search moment's snippet (the caption) */
  snippetChars: 200,
  /** frame indices per ffmpeg select when decoding key frames (search/frames.ts precedent) */
  keyframeChunk: 200,
  /** asset ids in one start request */
  maxStartAssets: 2000,
} as const;

const Hex16 = z.string().regex(/^[0-9a-f]{16}$/);
const Sha256Ref = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Id = z.string().min(1).max(64);
const Frame = z.number().int().min(0);

// ---------- the producer: who wrote a notes file ----------
/** The describer families: the agent adapters' two (C1) and the labelled test double (tests and proofs only, never configured). */
export const DESCRIBER_KINDS = ['anthropic-messages', 'openai-chat', 'TEST-DOUBLE-describer'] as const;
export type DescriberKind = (typeof DESCRIBER_KINDS)[number];
/** The test double's id and the label every caption it writes starts with (understandReply / the server double, W2). */
export const DESCRIBE_TEST_DOUBLE = { id: 'TEST-DOUBLE-describer/1', he: 'כפיל בדיקה', en: 'TEST DOUBLE' } as const;

export const NotesProducerBodySchema = z.object({
  describer: z.enum(DESCRIBER_KINDS),
  /** the agent provider preset id (anthropic, openai, xai, gemini, ollama, llamacpp) or 'test-double' */
  providerId: z.string().min(1).max(64),
  /** as the provider names it (the model table id or what the owner typed) */
  model: z.string().min(1).max(128),
  /** sha256 of the local weights when known through the library ledger, else null */
  modelFile: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  prompt: z.literal(DESCRIBE_PROMPT_ID),
  longSide: z.number().int().min(64).max(4096),
  density: z.number().int().min(1).max(600),
  framesPerSpan: z.number().int().min(UNDERSTAND_LIMITS.framesPerSpan.min).max(UNDERSTAND_LIMITS.framesPerSpan.max),
  minSpanSeconds: z.number().int().min(0).max(600),
}).strict();
export type NotesProducerBody = z.infer<typeof NotesProducerBodySchema>;
/** `id` = the first 16 hex of sha256(producerCanonical(body)); computed on the server only (C13), checked by the job before storing. */
export const NotesProducerSchema = NotesProducerBodySchema.extend({ id: Hex16 }).strict();
export type NotesProducer = z.infer<typeof NotesProducerSchema>;
/** The canonical text a producer id is the hash of: JSON with the keys sorted, no spaces. Complete (pure, no clock). */
export function producerCanonical(p: NotesProducerBody): string {
  const body = NotesProducerBodySchema.parse(p) as Record<string, unknown>;
  return JSON.stringify(Object.fromEntries(Object.keys(body).sort().map((k) => [k, body[k]])));
}

// ---------- the notes file (one per content hash and producer) ----------
export const SHOT_SIZES = ['wide', 'medium', 'close', 'detail'] as const;
/** Why a span was not described (stored, never filled in). */
export const NOTE_FAILURES = ['invalid_reply', 'reply_cut', 'engine_failed', 'decode_failed', 'refused'] as const;
export type NoteFailure = (typeof NOTE_FAILURES)[number];
const Tag = z.string().trim().min(1).max(UNDERSTAND_LIMITS.tagChars);
export const NoteSpanSchema = z.object({
  /** span index in the file */
  i: Frame,
  /** the first and last shot the span covers (several short shots are described together, C5) */
  shots: z.tuple([Frame, Frame]),
  /** source frames (decode index), half-open; a photo is [0,1) */
  start: Frame, end: z.number().int().min(1),
  /** the 1–4 frames that were described, ascending, each in [start, end) (decision 2) */
  keys: z.array(Frame).min(1).max(UNDERSTAND_LIMITS.framesPerSpan.max),
  state: z.enum(['described', 'failed']),
  why: z.enum(NOTE_FAILURES).optional(),
  caption: z.object({ he: z.string().min(1).max(UNDERSTAND_LIMITS.captionChars).optional(), en: z.string().min(1).max(UNDERSTAND_LIMITS.captionChars).optional() }).strict().optional(),
  tags: z.object({ he: z.array(Tag).max(UNDERSTAND_LIMITS.tags), en: z.array(Tag).max(UNDERSTAND_LIMITS.tags) }).strict().optional(),
  /** on-screen text as the model read it, in its own script */
  text: z.array(z.string().min(1).max(UNDERSTAND_LIMITS.textChars)).max(UNDERSTAND_LIMITS.textItems).optional(),
  size: z.enum(SHOT_SIZES).optional(),
}).strict();
export type NoteSpan = z.infer<typeof NoteSpanSchema>;
export const FootageNotesDataSchema = z.object({
  format: z.literal(NOTES_FORMAT),
  /** the asset's content hash ('sha256:…') */
  contentHash: Sha256Ref,
  producer: NotesProducerSchema,
  /** the picture's frame rate; null = a photo */
  rate: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }).strict().nullable(),
  frameCount: z.number().int().positive(),
  /** digest of the scene cuts the spans were made from (cutsDigest): when the cuts change the state is shots_changed */
  cuts: Sha256Ref,
  spans: z.array(NoteSpanSchema).max(UNDERSTAND_LIMITS.maxSpansPerFile),
  truncated: z.literal(true).optional(),
}).strict();
export type FootageNotesData = z.infer<typeof FootageNotesDataSchema>;

/** One span as the sampler plans it (understand.ts understandSpans, W1): before anything is described. */
export interface SpanPlan { i: number; shots: [number, number]; start: number; end: number; keys: number[] }

// ---------- the document pointer (schema.ts AnalysisSchema.notes; optional, no version bump) ----------
const AnalysisOriginLike = z.object({ method: z.string().max(200), params: z.record(z.string(), z.union([z.number(), z.string()])), createdAt: z.string(), createdBy: z.string(), edited: z.boolean() }).strict();
export const NotesPointerSchema = z.object({
  origin: AnalysisOriginLike,
  /** NotesProducer.id */
  producer: Hex16,
  /** the model label shown with every caption («תיאור של {model} · לא נבדק») */
  model: z.string().min(1).max(128),
  /** 'sha256:' + sha256 of the stored notes JSON (a digest; the text is in the footage_notes table) */
  data: Sha256Ref,
  spans: z.number().int().min(0).max(UNDERSTAND_LIMITS.maxSpansPerFile),
  described: z.number().int().min(0),
  failed: z.number().int().min(0),
  truncated: z.literal(true).optional(),
}).strict();
export type NotesPointer = z.infer<typeof NotesPointerSchema>;

export const AttachFootageNotesItemSchema = z.object({
  assetId: Id, producer: Hex16, model: z.string().min(1).max(128), data: Sha256Ref,
  spans: z.number().int().min(0).max(UNDERSTAND_LIMITS.maxSpansPerFile), described: z.number().int().min(0), failed: z.number().int().min(0),
  truncated: z.literal(true).optional(),
}).strict();
export const AttachFootageNotesArgsSchema = z.object({
  /** origin.method of every pointer: the describer and model in words (e.g. "openai-chat llamacpp qwen3-vl-2b, pf-describe/1") */
  method: z.string().min(1).max(200),
  createdAt: z.string().min(1).max(40),
  items: z.array(AttachFootageNotesItemSchema).min(1).max(UNDERSTAND_LIMITS.maxStartAssets),
}).strict();
export type AttachFootageNotesArgs = z.infer<typeof AttachFootageNotesArgsSchema>;

// ---------- states (computed, never stored) ----------
/**
 * Per asset: no_picture (sound only, a LUT) · shots_pending (no scene cuts yet) · shots_only (cuts, no describer or not described) ·
 * describing (a job holds it; n of m) · described · partly_failed (counts shown) · stale_model (the pointer's producer is not the
 * current one: old notes are still searched, labelled with their model; a button re-describes, never automatic in v1) ·
 * shots_changed (the cuts' digest differs from the notes' `cuts`).
 */
export const ASSET_UNDERSTAND_STATES = ['no_picture', 'shots_pending', 'shots_only', 'describing', 'described', 'partly_failed', 'stale_model', 'shots_changed'] as const;
export type AssetUnderstandState = (typeof ASSET_UNDERSTAND_STATES)[number];
/**
 * The describer: ready · none (the owner chose none) · not_connected (no agent provider is connected, or the chosen one lost its key or
 * model) · no_vision (the chosen model's table row says it takes no pictures, and the owner did not mark a local one as seeing) ·
 * not_built (this build has no describer job yet).
 */
export const DESCRIBER_STATES = ['ready', 'none', 'not_connected', 'no_vision', 'not_built'] as const;
export type DescriberState = (typeof DESCRIBER_STATES)[number];

// ---------- settings: <dataDir>/understand.json (backed up; no secret) ----------
export const UNDERSTAND_SETTINGS_FILE = 'understand.json' as const;
export const UnderstandDescriberChoiceSchema = z.object({
  /** an agent provider preset id (agent/keys.ts presetOf) */
  providerId: z.string().min(1).max(64),
  /** a model of that provider; for a cloud provider a model table row with vision: true */
  model: z.string().min(1).max(128),
  /** a local model the owner marks as taking pictures (the table has no rows for local servers) */
  seeing: z.literal(true).optional(),
  /** frames per span; absent = 1 for a local provider, 3 for a cloud one (decision 2) */
  framesPerSpan: z.number().int().min(UNDERSTAND_LIMITS.framesPerSpan.min).max(UNDERSTAND_LIMITS.framesPerSpan.max).optional(),
}).strict();
export type UnderstandDescriberChoice = z.infer<typeof UnderstandDescriberChoiceSchema>;
export const UnderstandSettingsSchema = z.object({
  version: z.literal(1),
  /** shots, and notes when a describer is ready, start by themselves on import (decision 4: ON by default) */
  auto: z.boolean(),
  density: z.union([z.literal(10), z.literal(30)]),
  /** null = no describer: shots only */
  describer: UnderstandDescriberChoiceSchema.nullable(),
}).strict();
export type UnderstandSettings = z.infer<typeof UnderstandSettingsSchema>;
export const DEFAULT_UNDERSTAND_SETTINGS: UnderstandSettings = Object.freeze({ version: 1, auto: true, density: 10, describer: null }) as UnderstandSettings;
/** PUT /api/v1/understand/settings: any field; describer null = none. */
export const UnderstandSettingsBodySchema = z.object({
  auto: z.boolean().optional(),
  density: z.union([z.literal(10), z.literal(30)]).optional(),
  describer: UnderstandDescriberChoiceSchema.nullable().optional(),
}).strict();
export type UnderstandSettingsBody = z.infer<typeof UnderstandSettingsBodySchema>;

// ---------- wire types ----------
export interface UnderstandDescriberView {
  state: DescriberState;
  providerId: string | null;
  model: string | null;
  /** a local server (agent preset `local`) */
  local: boolean | null;
  framesPerSpan: number;
  /** what a cloud describer receives, in words (he/en keys of packages/i18n understand.ts) — information, not an approval */
  sends: 'nothing' | 'frames';
  /** the next step in words when not ready (fixed English; the editor shows its own Hebrew by state) */
  detail: string | null;
}
export interface UnderstandAssetRow {
  assetId: string;
  state: AssetUnderstandState;
  /** number of shots (cuts + 1), null before measuring */
  shots: number | null;
  /** of the notes the pointer names (0 when none) */
  spans: number; described: number; failed: number;
  /** the model of the notes the pointer names */
  model: string | null;
  /** the transaction of the pointer's revision (C7: «ביטול התיאורים» undoes it by id) */
  transactionId: string | null;
}
/** GET /api/v1/projects/:id/understand (observe). */
export interface UnderstandStatusAnswer {
  describer: UnderstandDescriberView;
  settings: UnderstandSettings;
  assets: UnderstandAssetRow[];
  job: { jobId: string; status: string; done: number; total: number } | null;
  heuristic: true;
}
/** POST /api/v1/projects/:id/understand (edit): start or join the project's one open job. */
export const StartUnderstandBodySchema = z.object({
  /** default: every picture asset of the project without a complete row for the current producer (the work list is COMPUTED, C6) */
  assetIds: z.array(Id).min(1).max(UNDERSTAND_LIMITS.maxStartAssets).optional(),
  /** describe again with the current producer even where notes exist (the button «תארו שוב», decision 7) */
  redescribe: z.boolean().optional(),
  idempotencyKey: z.string().min(1).max(200).optional(),
}).strict();
export type StartUnderstandBody = z.infer<typeof StartUnderstandBodySchema>;
export interface StartUnderstandAnswer { jobId: string; joined: boolean; describer: DescriberState }

/** Query of GET …/assets/:assetId/notes and of describe_clip (strings in a URL; the route coerces). Source frames of the asset. */
const Bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
const IntQ = (min: number, max: number) => z.union([z.number(), z.string().regex(/^\d{1,9}$/).transform(Number)]).pipe(z.number().int().min(min).max(max));
export const NotesQuerySchema = z.object({
  from: IntQ(0, 1e9).optional(), to: IntQ(1, 1e9).optional(),
  cursor: z.string().min(1).max(64).optional(),
  limit: IntQ(1, UNDERSTAND_LIMITS.maxPageSpans).optional(),
  /** the caption language of every row (default: the UI's / he); `both: true` adds the other one */
  lang: z.enum(['he', 'en']).optional(),
  both: Bool.optional(),
  /** the words said inside each span (decision 5: only on request) */
  withSaid: Bool.optional(),
  /** rational start/end on every row as well as frames (C10) */
  rational: Bool.optional(),
}).strict();
export type NotesQuery = z.infer<typeof NotesQuerySchema>;
export interface NoteRow {
  i: number; shots: [number, number];
  startFrame: number; endFrame: number; keys: number[];
  /** with `rational`: sourceTimeOfFrame of start and end */
  start?: z.infer<typeof RationalTimeSchema>; end?: z.infer<typeof RationalTimeSchema>;
  state: 'described' | 'failed'; why?: NoteFailure;
  size?: (typeof SHOT_SIZES)[number];
  /** ONE language per row (decision 5); `captionLang` says which; the other only with `both` */
  caption?: string; captionLang?: 'he' | 'en'; captionOther?: string;
  tags?: string[]; text?: string[];
  /** with `withSaid`: the transcript words inside the span (≤ saidChars) */
  said?: string;
}
/** GET …/assets/:assetId/notes and describe_clip. Times are the asset's own (source); `rate` once per answer. */
export interface NotesPage {
  assetId: string;
  rate: { num: number; den: number } | null;
  state: AssetUnderstandState;
  /** the model and describer of these notes (null when none): every caption is that model's, «לא נבדק» */
  by: { model: string; describer: DescriberKind } | null;
  rows: NoteRow[];
  next: string | null;
  heuristic: true;
  note: string;
}
export const ShotsQuerySchema = z.object({ cursor: z.string().min(1).max(64).optional(), limit: IntQ(1, UNDERSTAND_LIMITS.maxShotsPage).optional(), lang: z.enum(['he', 'en']).optional() }).strict();
export type ShotsQuery = z.infer<typeof ShotsQuerySchema>;
export interface ShotRow { i: number; startFrame: number; endFrame: number; start: z.infer<typeof RationalTimeSchema>; end: z.infer<typeof RationalTimeSchema>; caption?: string }
/** get_shots: `measured: false` with hint understand_footage when none. Paged (C10). */
export interface ShotsPage {
  assetId: string; measured: boolean; method: string | null; edited: boolean;
  rate: { num: number; den: number } | null;
  total: number; shots: ShotRow[]; next: string | null; hint?: string;
}

// ---------- the describer's prompt (versioned by DESCRIBE_PROMPT_ID; complete) ----------
/** The fixed system text of pf-describe/1. The transcript is NOT sent (a model given the words describes what was said, not what is seen). */
export const DESCRIBE_SYSTEM = [
  'You describe still frames from a video or a photo, for search inside a video editor. Describe only what is visible in the frames.',
  'Reply with ONE JSON object and nothing else, with exactly these keys:',
  '{"captionHe": string, "captionEn": string, "tagsHe": string[], "tagsEn": string[], "onScreenText": string[], "shotSize": "wide"|"medium"|"close"|"detail"|null}',
  `captionHe: one sentence in Hebrew, at most ${UNDERSTAND_LIMITS.captionChars} characters; captionEn: the same in English. tagsHe / tagsEn: up to ${UNDERSTAND_LIMITS.tags} short keywords each (objects, places, actions, colours).`,
  `onScreenText: every piece of text that can be read in the frames, copied exactly as written, in its own script, at most ${UNDERSTAND_LIMITS.textItems} items; an empty array when there is none. Copy numbers exactly as shown; do not turn them into dates or years.`,
  'Do not guess who a person is, their name or their age: that cannot be seen. Do not describe what might be said or heard.',
  'When several frames are given they come from one stretch of the same video, in time order; describe the stretch as a whole and mention movement only when the frames show it.',
].join('\n');
/** The user text before the frames: «frame k of n, mm:ss.s» lines in order (decision 2: frames labelled by time). */
export function describeUserText(frames: readonly { label: string }[]): string {
  if (frames.length === 1) return `One frame: ${frames[0]!.label}. Reply with the JSON object only.`;
  return [`${frames.length} frames of one stretch, in time order:`, ...frames.map((f, k) => `Frame ${k + 1} of ${frames.length}: ${f.label}`), 'Reply with the JSON object only.'].join('\n');
}
/** What the model must reply (validated by understandReply.ts validateDescribeReply, W2; unknown keys refused, nothing repaired). */
export const DescribeReplySchema = z.object({
  captionHe: z.string().nullable().optional(),
  captionEn: z.string().nullable().optional(),
  tagsHe: z.array(z.string()).optional(),
  tagsEn: z.array(z.string()).optional(),
  onScreenText: z.array(z.string()).optional(),
  shotSize: z.enum(SHOT_SIZES).nullable().optional(),
}).strict();
export type DescribeReply = z.infer<typeof DescribeReplySchema>;

// ---------- refusals of the routes and tools (fixed English; Hebrew in packages/i18n/src/understand.ts HE_UNDERSTAND) ----------
export const UNDERSTAND_API = {
  notBuilt: { status: 501, code: 'understand_not_built', message: 'footage understanding is not built in this version yet', hint: 'Nothing was changed. Update the editor and try again.' },
  assetNotFound: { status: 404, code: 'asset_not_found', message: 'this file is not in the project', hint: 'get_summary lists the project\'s files.' },
  noPicture: { status: 409, code: 'no_picture', message: 'this file has no picture to describe', hint: 'Shots and notes are made for videos and photos.' },
  inProgress: { status: 409, code: 'understand_in_progress', message: 'a footage job of this project is running with other settings', hint: 'Wait for it to finish, or stop it, then start again.' },
  badCursor: { status: 400, code: 'invalid_cursor', message: 'the cursor does not belong to this answer', hint: 'Start again without a cursor.' },
  providerNotConnected: { status: 409, code: 'describer_not_connected', message: 'this model provider is not connected', hint: 'Connect it in the «סוכן» tab (address, model and, where it needs one, a key), then choose it as the describer.' },
  noVision: { status: 409, code: 'describer_no_vision', message: 'this model does not take pictures according to the model table', hint: 'Choose a model whose row says it takes pictures, or mark a local model as seeing.' },
} as const;
export type UnderstandApiKey = keyof typeof UNDERSTAND_API;

/** Thrown by a function of understand.ts / understandReply.ts this build does not have yet: never a made-up value. Routes answer 501. */
export class UnderstandNotBuilt extends Error {
  constructor(what: string) { super(`${what}: footage understanding is not built in this build yet`); this.name = 'UnderstandNotBuilt'; }
}
/** What is built (each builder flips its own flag; tests and the proof read them). */
export const UNDERSTAND_BUILT = { op: true, core: false, reply: false, search: false, job: false, routes: false, ui: false } as const;

/** The sentence every notes answer carries: what a description is and is not. */
export const NOTES_NOTE = {
  he: 'התיאורים נכתבו על ידי מודל ולא נבדקו. השוטים נמצאו בלי מודל, לפי שינוי חד בין פריימים (מעברים הדרגתיים לא מתגלים). «לא נמצא דבר» לא אומר שאין.',
  en: 'Descriptions were written by a model and were not checked. Shots were found without a model, by a sharp change between frames (gradual transitions are not detected). "Nothing found" does not mean there is nothing.',
} as const;
