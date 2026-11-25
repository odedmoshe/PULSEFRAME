/**
 * «חיפוש בצילומים» — find it in your footage (wave 7 search track; .artifacts/wave7/search-decisions.md). The lead's contract: limits,
 * wire shapes of the search and index routes, the moment sources, the picture states, the refusals (fixed English; Hebrew in
 * packages/i18n/src/footageSearch.ts HE_FOOTAGE, kept in step by packages/evals/src/footage-wording.test.ts), and the privacy filter
 * of an agent's answer (complete here, fail-closed). Builders change none of it without the lead.
 *
 * Version 1 (decisions §1): the no-model search of names, capture dates, events, transcript words and — for the owner's own session
 * only — pearl names and the people tagged on pearls; and, behind an honest setup state, picture search for the owner only: whole
 * frames of videos, one per second, embedded by a local model, queried by TEXT only. Cut: auto-scan, the backup opt-in, «עוד כמו זה»
 * (and every query by example), stills in the picture index, the translated query.
 *
 * HARD LINES (decisions §2): no face, person or region is ever embedded, detected or grouped; no route takes an image, a frame or an
 * asset as a query; vectors never leave <dataDir>/search/; no score is ever shown or sent; the query is never echoed in an answer, a
 * refusal, a log line or a job. A score is a ranking aid only; "nothing found" is an honest answer.
 */
import { z } from 'zod';
import { RationalTimeSchema } from './schema.ts';

export const FOOTAGE_LIMITS = {
  /** characters of a query (after trim) */
  queryChars: 200,
  /** tokens of the picture model's text side (SigLIP 2: max_length 64, padding max_length); a longer query is refused, never cut */
  queryTokens: 64,
  /** moments per section, at most and by default */
  maxResults: 50, defaultResults: 30,
  /** dimension of a picture vector */
  embedDim: 768,
  /** one sample per this many seconds of source time (k_s = ceil(s·rate) while k_s < frameCount) */
  sampleEverySeconds: 1,
  /** picture hits: the best frames read, frames of one file merged when closer than mergeGap, padded by pad on each side (seconds) */
  topFrames: 200, mergeGapSeconds: 3, padSeconds: 1,
  /** frames embedded per batch; the scan stops (cancel) and yields (an export) only between batches */
  batchFrames: 32,
  /** frame indices per ffmpeg select (derive.ts precedent) */
  selectChunk: 200,
  /** a stored sample: 768 int8 + a float32 scale, plus row overhead, for the storage estimate (bytes) */
  bytesPerSample: 800,
  /** |‖v‖ − 1| allowed for a vector the worker returns */
  unitTolerance: 1e-3,
  /** asset ids in one scan request */
  maxScanAssets: 2000,
} as const;

/** Where a moment was found. `pearl` (a pearl's name) and `person` (a person tagged on a pearl) are read for the owner's own session only. */
export const MOMENT_SOURCES = ['name', 'date', 'event', 'transcript', 'pearl', 'person', 'picture'] as const;
export type MomentSource = (typeof MOMENT_SOURCES)[number];
/** The only sources an agent's answer may name (agentAnswerOf drops a moment found by nothing else). */
export const AGENT_SOURCES: readonly MomentSource[] = ['name', 'date', 'event', 'transcript'];

/**
 * The state of the picture section. not_installed: the setup state says why (setup.code); not_scanned / partly_scanned / stale: the
 * project's videos are not (all) in the index for this model; busy: a scan of this project is running (the answer still searches what
 * is complete); owner_only: this credential is not the owner's own session; not_built: this build has no picture search yet.
 */
export const PICTURE_STATES = ['ready', 'not_installed', 'not_scanned', 'partly_scanned', 'stale', 'busy', 'owner_only', 'not_built'] as const;
export type PictureState = (typeof PICTURE_STATES)[number];

/** The embedder ids a stored row may carry. Changing model, preprocessing or sampler makes earlier rows stale («צריך לסרוק שוב»). */
export const FOOTAGE_EMBEDDERS = {
  /** SigLIP 2 base patch16 256 at revision 3f9f96cb; fp16 on CUDA, fp32 on the CPU; pre1 = ffmpeg bilinear 256×256, (x/255−0.5)/0.5 (an approximation of the publisher's antialiased resize) */
  siglipGpu: 'siglip2-b16-256@3f9f96cb/fp16/pre1',
  siglipCpu: 'siglip2-b16-256@3f9f96cb/fp32/pre1',
  /** the labelled test double of unit tests and proof:search: hue × lightness bins and a 16-word colour table. It proves plumbing, never quality. */
  testDouble: 'TEST-DOUBLE-embedder/1',
} as const;
/**
 * Provisional floor of the model's own relevance (sigmoid(logit_scale · cos + logit_bias) with the checkpoint's published scale and bias):
 * a frame below it is never shown. UNMEASURED: set at laptop step L5; until then a picture section may say «לא נמצא דבר» too often or too rarely.
 */
export const PICTURE_MIN_RELEVANCE = 0.001;

const Id = z.string().min(1).max(64);

export const FootageQuerySchema = z.object({
  query: z.string().trim().min(1).max(FOOTAGE_LIMITS.queryChars),
  /** false = the no-model part only (the editor asks for pictures on Enter). Default true; ignored for every credential but the owner's own session. */
  picture: z.boolean().optional(),
  limit: z.number().int().min(1).max(FOOTAGE_LIMITS.maxResults).optional(),
}).strict();
export type FootageQuery = z.infer<typeof FootageQuerySchema>;

/** A moment in a file's own time. start/end null = the whole file. */
export const MomentSchema = z.object({
  assetId: Id,
  start: RationalTimeSchema.nullable(),
  end: RationalTimeSchema.nullable(),
  sources: z.array(z.enum(MOMENT_SOURCES)).min(1),
  /** OWNER ONLY: the source frame whose sprite tile shows the moment (picture rows: the best frame) */
  frame: z.number().int().nonnegative().optional(),
  /** OWNER ONLY: the transcript words of a transcript hit (≤ 200 characters), or the pearl's name of a pearl hit */
  snippet: z.string().max(200).optional(),
}).strict();
export type Moment = z.infer<typeof MomentSchema>;
/** What an agent receives of a moment: nothing else, ever. */
export const AgentMomentSchema = z.object({
  assetId: Id, start: RationalTimeSchema.nullable(), end: RationalTimeSchema.nullable(),
  sources: z.array(z.enum(['name', 'date', 'event', 'transcript'])).min(1),
}).strict();
export type AgentMoment = z.infer<typeof AgentMomentSchema>;

export const SearchSetupSchema = z.object({
  code: z.enum(['ready', 'engine_not_configured', 'engine_not_working', 'engine_unverified', 'model_missing', 'licence_blocked', 'disk_insufficient', 'not_built']),
  detail: z.string(),
  missingBytes: z.number().int().nonnegative().optional(),
  device: z.enum(['cuda', 'cpu']).nullable().optional(),
  versions: z.record(z.string(), z.string()).optional(),
}).strict();
export type SearchSetup = z.infer<typeof SearchSetupSchema>;

export const FootageAnswerSchema = z.object({
  /** found by name, date, event, transcript (and for the owner pearl names and tags), without any model */
  exact: z.array(MomentSchema),
  /** found by the picture model (owner only); empty in every other state */
  picture: z.array(MomentSchema),
  pictureState: z.enum(PICTURE_STATES),
  /** owner only, absent for agents: why picture search is not ready */
  setup: SearchSetupSchema.optional(),
  /** owner only: videos of the project in the index for the current model, of all its videos */
  scanned: z.object({ files: z.number().int().nonnegative(), of: z.number().int().nonnegative() }).optional(),
  /** owner only: the embedder of the picture rows (the test double names itself) */
  embedder: z.string().optional(),
  heuristic: z.literal(true),
  note: z.string(),
}).strict();
export type FootageAnswer = z.infer<typeof FootageAnswerSchema>;
export const AgentFootageAnswerSchema = z.object({
  exact: z.array(AgentMomentSchema), picture: z.array(AgentMomentSchema).max(0),
  pictureState: z.literal('owner_only'), heuristic: z.literal(true), note: z.string(),
}).strict();
export type AgentFootageAnswer = z.infer<typeof AgentFootageAnswerSchema>;

export const FootageIndexStatusSchema = z.object({
  setup: SearchSetupSchema,
  embedder: z.string().nullable(),
  /** videos of this project: in the index for the current embedder, in it for an older one (stale), all */
  files: z.object({ scanned: z.number().int().nonnegative(), stale: z.number().int().nonnegative(), of: z.number().int().nonnegative() }),
  /** bytes of this project's rows (a file shared with another project counts in both) */
  bytes: z.number().int().nonnegative(),
  job: z.object({ jobId: z.string(), status: z.string() }).nullable(),
}).strict();
export type FootageIndexStatus = z.infer<typeof FootageIndexStatusSchema>;

export const StartScanBodySchema = z.object({
  /** default: every video of the project not yet in the index for the current embedder */
  assetIds: z.array(Id).min(1).max(FOOTAGE_LIMITS.maxScanAssets).optional(),
}).strict();
export type StartScanBody = z.infer<typeof StartScanBodySchema>;

/** The sentence every answer carries: what a result is and is not. */
export const FOOTAGE_NOTE = {
  he: 'חיפוש לפי שם, תאריך, אירוע ומה שנאמר הוא התאמת מילים מדויקת. חיפוש לפי מה שרואים בתמונה הוא התאמה לפי מודל — לא נבדק בעברית, הסדר הוא עזר בלבד, והמודל יכול לפספס. «לא נמצא דבר» לא אומר שאין.',
  en: 'Search by name, date, event and what was said is an exact word match. Search by what is in the picture is a model\'s match — not tested in Hebrew; the order is only an aid, and the model can miss things. "Nothing found" does not mean there is nothing.',
} as const;

/**
 * No string of this track may offer a query by example or claim to know who someone is (packages/evals/src/footage-wording.test.ts).
 * Saying what it does NOT do («בלי זיהוי פנים», "no face recognition") is allowed and wanted.
 */
export const FOOTAGE_FORBIDDEN_WORDS = ['similar', 'more like this', 'same person', 'who is this', 'find this person', 'דומה', 'דומים', 'עוד כמו זה', 'אותו אדם', 'מי זה'] as const;

interface FootageRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): FootageRefusal<A> => ({ status, code, message, hint });
/** Every refusal of the search routes and tool. The messages are fixed (HE_FOOTAGE recognises them by shape) and never hold the query. */
export const FOOTAGE_REFUSALS = {
  notBuilt: r(501, 'footage_search_not_built', () => 'footage search is not built in this build yet', 'Update the editor; until then filter the media drawer by name.'),
  ownerOnly: r(403, 'owner_required', () => 'only the owner can scan footage, see the picture index or delete it, from their own session', 'The owner does it in the media drawer of the editor.'),
  restricted: r(403, 'out_of_scope', () => 'footage search needs a grant without a track or time restriction', 'Ask the owner for a grant without track or range limits.'),
  scanRunning: r(409, 'search_scan_in_progress', () => 'a scan of this project\'s footage is already running', 'Wait for it to finish, or stop it, then start again.'),
  notReady: r(409, 'picture_search_not_ready', (code: string) => `picture search is not set up on this computer: ${code}`, 'Follow the setup steps in the media drawer; the search by name, date and words works meanwhile.'),
  nothingToScan: r(409, 'nothing_to_scan', () => 'there is no video in this project to scan', 'Import a video first.'),
  queryTooLong: r(400, 'query_too_long', () => 'a picture search is at most 64 words and signs', 'Shorten the search to a few words.'),
  engineFailed: r(502, 'search_engine_failed', () => 'the picture search model gave an answer that failed its checks; nothing is shown', 'Try again; if it repeats, check the setup in the media drawer.'),
} as const;
export type FootageRefusalKey = keyof typeof FOOTAGE_REFUSALS;

/** Thrown by a function of footageSearch.ts that this build does not have yet: never a made-up value. */
export class FootageSearchNotBuilt extends Error {
  constructor(what: string) { super(`${what}: footage search is not built in this build yet`); this.name = 'FootageSearchNotBuilt'; }
}

/**
 * THE PRIVACY FILTER of every answer that leaves for a credential other than the owner's own session (decisions §2). Complete here:
 * each moment is rebuilt from four keys (never spread), its sources are cut to AGENT_SOURCES, a moment found by nothing else is
 * dropped, the picture section is empty and its state is owner_only, and nothing about the setup, the scan or the model is kept.
 * It is a net, not the only guard: the exact section for such a credential is computed on the reader document with
 * searchFootage(…, { reader: 'agent' }), which never reads a pearl's name or a tag.
 */
export function agentAnswerOf(answer: Pick<FootageAnswer, 'exact'> & Partial<FootageAnswer>): AgentFootageAnswer {
  const allowed = new Set<string>(AGENT_SOURCES);
  const exact: AgentMoment[] = [];
  for (const m of answer.exact) {
    const sources = [...new Set(m.sources.filter((s) => allowed.has(s)))] as AgentMoment['sources'];
    if (!sources.length) continue;
    exact.push({ assetId: m.assetId, start: m.start ? { value: m.start.value, timescale: m.start.timescale } : null, end: m.end ? { value: m.end.value, timescale: m.end.timescale } : null, sources });
  }
  return { exact, picture: [], pictureState: 'owner_only', heuristic: true, note: FOOTAGE_NOTE.en };
}
