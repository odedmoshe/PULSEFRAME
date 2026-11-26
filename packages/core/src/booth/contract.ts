/**
 * «תא הבדיקה» — the owner's review booth — and «בדיקת המחשב» — the laptop self-check (wave 8 booth track;
 * .artifacts/wave8/booth-plan.md as corrected by booth-verify.md and decisions.md "booth"). LEAD PRE-PASS: this file is the contract
 * the three builders share and do not edit (a builder who needs a change reports it).
 *
 * WHAT THE BOOTH IS
 * - Machine state of the owner, not project state: the answers live in <dataDir>/owner-review.json (server booth/contract.ts
 *   OWNER_REVIEW_FILE, 0600, atomic, never in a project, archive or backup), so the "every persistent edit is an op" rule does not
 *   apply to them. Project-content marks (music-fit joins, translation reviews) stay ops.
 * - Every booth route, GET included, answers the owner's own session only (403 owner_required first, before the item id or the body
 *   is read). No MCP tool; no agent ever reads an answer, a note or the report (decisions L5).
 * - The booth never changes a product label (verify C1). The lead reads the report and flips `review` in code (core musicStyles.ts:
 *   'heard' or 'approved', decisions L3/L4). Nothing here is called good, right, sharp, safe or verified; nobody here has seen or heard
 *   anything.
 *
 * VERSION 1 = THE FIRST SITTING (14 cards; the first screen says «חלק ראשון: 0 מתוך 14», never a larger total)
 *   7 GPU transitions new in wave 6 (one card each, drawn by this browser, plus ONE export strip of 7 stills through the export's own
 *   worker), 6 built-in music styles at 8 bars seed 1, the microphone. The self-check (13 rows) comes before the cards and is not a card.
 *   Behind «עוד», only because they reuse the audio and picture cards: the 11 SFX packs and templates place automatically, the other
 *   69 SFX, the other 39 GPU transitions, the GPU effects that show something on a still test picture. Cut (verify "Cut first"):
 *   machine-local labels, the kit card and verdict 'heard', phrase/age cards, the phone-drop card, per-card export stills and the
 *   difference number, the music-bytes row, moving the gallery scene into core, content-dependent GPU effects.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------------------------------------------- the first sitting
/** The cards of the first sitting (7 transitions + 6 music styles + the microphone). The first screen shows «חלק ראשון: 0 מתוך 14». */
export const BOOTH_FIRST_SITTING_CARDS = 14;
/** QUICKSTART §10 step 9: the GPU transitions wave 6 added; «זה מה שפותח את עבודת כרטיס המסך» (QUICKSTART §5). */
export const BOOTH_FIRST_TRANSITIONS = ['film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right'] as const;
/** The six built-in styles (MUSIC_STYLES), each played at exactly 8 bars, seed 1, synth 1: the bytes music.golden.json pins. */
export const BOOTH_FIRST_MUSIC = ['music.festive', 'music.birthday', 'music.calm', 'music.pop', 'music.lofi', 'music.cinematic'] as const;
export const BOOTH_MUSIC_BARS = 8;
export const BOOTH_MUSIC_SEED = 1;

/** The steps of the first sitting, in the two orders of decisions L1 (a constant, not a score). */
export type BoothFirstStep = 'transitions' | 'music' | 'mic' | 'windows-gpu-setting';
export const BOOTH_FIRST_ORDER: Readonly<Record<'discrete' | 'other', readonly BoothFirstStep[]>> = {
  /** The editor tab draws on the discrete card (row browser-gpu, data.discrete true): the transitions first. */
  discrete: ['transitions', 'music', 'mic'],
  /** Intel integrated, software or unknown: music and mic first, then the Windows graphics step (QUICKSTART §5, «לא נוסה»), then the
   * transitions. Closing every Chrome window closes the booth: answers survive on the server, browser rows in localStorage (W3). */
  other: ['music', 'mic', 'windows-gpu-setting', 'transitions'],
};
/** L1: transitions first only when row 1 answered ok on a discrete adapter. Pure; complete in the pre-pass. */
export function boothFirstOrder(browserGpu: Pick<BoothCheckRow, 'state' | 'data'> | null | undefined): readonly BoothFirstStep[] {
  return browserGpu && browserGpu.state === 'ok' && browserGpu.data.discrete === true ? BOOTH_FIRST_ORDER.discrete : BOOTH_FIRST_ORDER.other;
}

// ------------------------------------------------------------------------------------------------------------------- the registry
/** Card groups, in queue order. `first.*` are the first sitting; `more.*` open only behind «עוד». */
export const BOOTH_GROUPS = ['first.gpu-new', 'first.music', 'first.mic', 'more.auto-sounds', 'more.gpu-transitions', 'more.gpu-effects', 'more.sounds'] as const;
export type BoothGroup = (typeof BOOTH_GROUPS)[number];
export const BOOTH_FIRST_GROUPS: readonly BoothGroup[] = ['first.gpu-new', 'first.music', 'first.mic'];
/** Where an item comes from. The server's registry (apps/server/src/booth/registry.ts, W1) has exactly one source per value. */
export const BOOTH_SOURCES = ['music', 'sfx', 'gpu-transition', 'gpu-effect', 'task'] as const;
export type BoothSource = (typeof BOOTH_SOURCES)[number];
export const BOOTH_KINDS = ['audio', 'picture', 'task'] as const;
export type BoothKind = (typeof BOOTH_KINDS)[number];

/**
 * What the owner may say is wrong (verify C8: nouns, so no adjective has to agree with a noun; no «לא טבעי» — it holds «טבעי» from
 * INSTRUMENTS_FORBIDDEN_WORDS_HE). The words are packages/i18n/src/booth.ts `booth.problem.<id>`.
 */
export const BOOTH_PROBLEMS = {
  audio: ['too-loud', 'too-quiet', 'harsh', 'clicks', 'not-for-family', 'name'],
  picture: ['broken', 'flicker', 'wrong-direction', 'slow', 'export-differs'],
  task: ['did-not-work', 'unclear'],
  all: ['other'],
} as const;
export const BOOTH_PROBLEM_IDS = [...BOOTH_PROBLEMS.audio, ...BOOTH_PROBLEMS.picture, ...BOOTH_PROBLEMS.task, ...BOOTH_PROBLEMS.all] as const;
export type BoothProblem = (typeof BOOTH_PROBLEM_IDS)[number];
export const BoothProblemSchema = z.enum(BOOTH_PROBLEM_IDS);

export const BOOTH_LIMITS = {
  /** Rows of owner-review.json (one per item id, the latest answer). */
  rows: 2000,
  /** A note, after the server's scrub. */
  noteChars: 280,
  problems: 6,
  /** An adapter string `${vendor}|${architecture}|${device}|${description}` (printable ASCII). */
  adapterChars: 200,
  /** Keys of one self-check row's data. */
  checkDataKeys: 20,
  /** Lines of the machine block are at most this long (the checksum covers the lines joined without line breaks). */
  blockLineChars: 64,
} as const;

const Sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const BOOTH_ITEM_ID = /^[a-z][a-z0-9-]*:[a-z0-9.@-]{1,80}$/;
export const BoothItemIdSchema = z.string().regex(BOOTH_ITEM_ID);
/** Printable ASCII only (no bidi marks, no Hebrew): adapters, versions, codes. */
export const BOOTH_ASCII = /^[\x20-\x7e]*$/;
const Ascii = (max: number) => z.string().max(max).regex(BOOTH_ASCII);
const WordsSchema = z.object({ he: z.string().min(1).max(300), en: z.string().min(1).max(300) }).strict();

export const BoothMakeSchema = z.discriminatedUnion('route', [
  /** GET …/audio through the product's own musicPreviewAnswer(styleId, 8, 1): the bytes music.golden.json pins (x-pf-expected-match). */
  z.object({ route: z.literal('music'), styleId: z.string().regex(/^music\.[a-z0-9-]{1,24}$/), bars: z.literal(BOOTH_MUSIC_BARS), seed: z.literal(BOOTH_MUSIC_SEED) }).strict(),
  /** GET …/audio through sfxPreview: the bytes GET /api/v1/sfx/:id/audio gives. */
  z.object({ route: z.literal('sfx'), sfxId: z.string().regex(/^sfx\.[a-z0-9-]{1,40}$/) }).strict(),
  /** The booth's own scene builder (W1/W2; NOT the gallery's makeScene) on the two built-in test pictures. */
  z.object({ route: z.literal('scene'), scene: z.enum(['transition', 'effect']), id: z.string().min(1).max(80) }).strict(),
  z.object({ route: z.literal('task'), task: z.literal('mic') }).strict(),
]);
export type BoothMake = z.infer<typeof BoothMakeSchema>;

export const BoothItemSchema = z.object({
  /** `${source}:${catalogueId}`; NO version in it: the item survives versions, the recipe says when it changed. */
  id: BoothItemIdSchema,
  source: z.enum(BOOTH_SOURCES), group: z.enum(BOOTH_GROUPS), kind: z.enum(BOOTH_KINDS),
  title: WordsSchema,
  /** «מה שומעים / מה רואים», e.g. «מה שומעים: 8 תיבות של הסגנון, כמו בדפדפן המוזיקה». */
  what: WordsSchema,
  /** sha256 of the canonical definition that makes the item (W1, verify C7); a changed recipe asks again. */
  recipe: Sha,
  /** The pinned bytes when the build has them (music: music.golden.json at 8 bars seed 1). */
  expected: Sha.optional(),
  make: BoothMakeSchema,
  /** Core effectChangesLight or a `light: true` transition: the card starts as a still and plays under FlashGuard. */
  changesLight: z.boolean(),
  /** One of the 7 first-sitting transitions: part of the export strip «כך זה ייצא». */
  exportStrip: z.boolean(),
  usedBy: z.array(z.enum(['perform', 'pack', 'template'])).max(3),
  /** An estimate, labelled as one. */
  minutes: z.number().positive().max(10),
  problems: z.array(BoothProblemSchema).min(1).max(BOOTH_PROBLEM_IDS.length),
}).strict();
export type BoothItem = z.infer<typeof BoothItemSchema>;

// ---------------------------------------------------------------------------------------------------------------------- the answers
/** C2: no 'heard' verdict (the kit keeps music-kits-heard.json and its own route). */
export const BOOTH_VERDICTS = ['ok', 'bad', 'skip'] as const;
export type BoothVerdict = (typeof BOOTH_VERDICTS)[number];

/** PUT /api/v1/booth/answers/:id. The note is scrubbed on the SERVER before it is stored (scrub.ts, verify C4b). */
export const BoothAnswerBodySchema = z.object({
  verdict: z.enum(BOOTH_VERDICTS),
  problems: z.array(BoothProblemSchema).max(BOOTH_LIMITS.problems).optional(),
  note: z.string().max(BOOTH_LIMITS.noteChars).optional(),
  /** The recipe the card was opened with: another one → 409 booth_stale_recipe. */
  recipe: Sha,
  /** Audio: sha256 of the bytes this machine served (x-pf-content-sha256). */
  played: Sha.optional(),
  /** Picture: the editor tab's adapter (row browser-gpu) and the export worker's (row export-gpu), both recorded (verify C5). */
  browserAdapter: Ascii(BOOTH_LIMITS.adapterChars).optional(),
  browserSoftware: z.boolean().optional(),
  exportAdapter: Ascii(BOOTH_LIMITS.adapterChars).optional(),
  exportSoftware: z.boolean().optional(),
}).strict();
export type BoothAnswerBody = z.infer<typeof BoothAnswerBodySchema>;

/** One stored row: the body plus the server's own clock and build. */
export const BoothAnswerSchema = BoothAnswerBodySchema.extend({
  id: BoothItemIdSchema,
  /** Server clock, ISO; the report carries the date only. */
  at: z.string().max(40),
  /** BoothBuild.commit at the time of the answer. */
  build: Ascii(40),
}).strict();
export type BoothAnswer = z.infer<typeof BoothAnswerSchema>;
export const OwnerReviewFileSchema = z.object({ version: z.literal(1), answers: z.array(BoothAnswerSchema).max(BOOTH_LIMITS.rows) }).strict();
export type OwnerReviewFile = z.infer<typeof OwnerReviewFileSchema>;

/**
 * State of an item on this machine. 'changed': the stored row's recipe differs (every kind), its `played` differs (audio), or — for
 * a picture only — its adapter differs («נבדק על כרטיס מסך אחר — בדקו כאן», never «השתנה מאז» for an adapter change). Changed counts
 * as unanswered. An answer drawn on a software adapter is shown and reported as such, and is not a check of the graphics card.
 */
export type BoothItemState = 'unanswered' | 'answered' | 'changed';
export type BoothChangedWhy = 'recipe' | 'played' | 'adapter';
export interface BoothItemView { item: BoothItem; answer: BoothAnswer | null; state: BoothItemState; changedWhy?: BoothChangedWhy }

// ------------------------------------------------------------------------------------------------------------- build and machine
/** Which build runs: `.git/HEAD` and its ref file read without exec (else 'unknown'), plus bundleDigest(webDist) (verify C4). */
export interface BoothBuild { commit: string; bundle: string }
export const BoothBuildSchema = z.object({ commit: z.string().regex(/^(?:[0-9a-f]{7,40}|unknown)$/), bundle: z.string().regex(/^(?:sha256:[0-9a-f]{64}|[0-9a-f]{16,64}|unknown)$/) }).strict();
/** Allow-listed machine facts only: os type/release/arch, cpu count, memory in whole GiB. Never a user, host or folder name. */
export const BoothMachineSchema = z.object({ os: Ascii(80), cpus: z.number().int().min(0).max(1024), memGiB: z.number().int().min(0).max(4096) }).strict();
export type BoothMachine = z.infer<typeof BoothMachineSchema>;

/** GET /api/v1/booth (owner's own session only). */
export interface BoothView {
  build: BoothBuild;
  machine: BoothMachine;
  firstSitting: { cards: typeof BOOTH_FIRST_SITTING_CARDS; groups: readonly BoothGroup[] };
  groups: readonly BoothGroup[];
  items: BoothItemView[];
}
/** PUT /api/v1/booth/answers/:id answers the stored row and, when the note holds a name from a people sheet (L2: warn, never
 * replace, nothing stored about the match), how many such names it holds. */
export interface BoothAnswerResult { answer: BoothAnswer; namesInNote: number }

// ------------------------------------------------------------------------------------------------------------------ the self-check
export const BOOTH_CHECK_STATES = ['ok', 'setup', 'off', 'fail', 'unknown', 'skipped'] as const;
/** ok «זמין» · setup «דרושה הגדרה» · off «לא זמין» · fail «כשל» · unknown «אין תשובה בזמן» · skipped (a heavy row while other work runs). */
export type BoothCheckState = (typeof BOOTH_CHECK_STATES)[number];
export interface BoothCheckDef {
  id: string; side: 'browser' | 'server';
  /** Heavy (verify C3): runs only from its own visible button with «עשוי לקחת עד שתי דקות; ייתכן שחלון יופיע לרגע», and is
   * 'skipped' while any export, still, transcription, narration, scan or music-fit job is queued or running. */
  heavy: boolean;
  timeoutMs: number;
}
/** The 13 rows, in run order (verify C3; the music-bytes row is dropped: the music cards carry the same evidence). */
export const BOOTH_CHECKS = [
  { id: 'browser-gpu', side: 'browser', heavy: false, timeoutMs: 10_000 },
  { id: 'browser-codecs', side: 'browser', heavy: false, timeoutMs: 10_000 },
  { id: 'export-gpu', side: 'server', heavy: true, timeoutMs: 160_000 },
  { id: 'ffmpeg', side: 'server', heavy: false, timeoutMs: 15_000 },
  { id: 'svg', side: 'server', heavy: false, timeoutMs: 15_000 },
  { id: 'mic', side: 'browser', heavy: false, timeoutMs: 5_000 },
  { id: 'library', side: 'server', heavy: false, timeoutMs: 15_000 },
  { id: 'kit', side: 'server', heavy: false, timeoutMs: 15_000 },
  { id: 'speech', side: 'server', heavy: true, timeoutMs: 150_000 },
  { id: 'assistant', side: 'server', heavy: false, timeoutMs: 5_000 },
  { id: 'search', side: 'server', heavy: true, timeoutMs: 150_000 },
  { id: 'disk', side: 'server', heavy: false, timeoutMs: 5_000 },
  { id: 'drop', side: 'server', heavy: false, timeoutMs: 5_000 },
] as const satisfies readonly BoothCheckDef[];
export type BoothCheckId = (typeof BOOTH_CHECKS)[number]['id'];
export type BoothServerCheckId = Extract<(typeof BOOTH_CHECKS)[number], { side: 'server' }>['id'];
export type BoothBrowserCheckId = Extract<(typeof BOOTH_CHECKS)[number], { side: 'browser' }>['id'];
export const BOOTH_CHECK_IDS = BOOTH_CHECKS.map((c) => c.id) as [BoothCheckId, ...BoothCheckId[]];
/** The export strip (7 stills through Exporter.renderStill) is heavy too: same warning, same skip. */
export const BOOTH_EXPORT_STRIP_TIMEOUT_MS = 60_000;

/**
 * A row's data: allow-listed scalars only (verify C3). Text is ASCII without '/', '\\', '@', '~' or ':' runs that could carry a path,
 * an e-mail or an address — a version line, an enum word, an adapter vendor. No `detail`, `message` or path from the server ever
 * reaches a row; the words a row shows come from packages/i18n/src/booth.ts by (id, state, code).
 */
export const BOOTH_CHECK_TEXT = /^[A-Za-z0-9 ._+|()=,-]{0,120}$/;
export const BoothCheckDataSchema = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/), z.union([z.boolean(), z.number().int(), z.string().regex(BOOTH_CHECK_TEXT)]))
  .refine((d) => Object.keys(d).length <= BOOTH_LIMITS.checkDataKeys, { message: `at most ${BOOTH_LIMITS.checkDataKeys} keys` });
export const BoothCheckRowSchema = z.object({
  id: z.enum(BOOTH_CHECK_IDS),
  state: z.enum(BOOTH_CHECK_STATES),
  /** A reason code (snake_case ASCII) that selects the words and the next step, e.g. 'software_adapter', 'not_installed', 'busy'. */
  code: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/).nullable(),
  data: BoothCheckDataSchema,
}).strict();
export type BoothCheckRow = z.infer<typeof BoothCheckRowSchema>;

// ----------------------------------------------------------------------------------------------------------------------- the report
/** The machine block's frame. Between them: the JSON in lines of at most BOOTH_LIMITS.blockLineChars, then one `sha256:<hex>` line
 * over those lines joined without line breaks. Anything outside printable ASCII inside the frame (a chat app's bidi marks) or a
 * checksum mismatch is refused by parseBoothBlock; a pure re-wrap of the lines is not a change. */
export const BOOTH_BLOCK_BEGIN = '-----BEGIN PF-BOOTH 1-----';
export const BOOTH_BLOCK_END = '-----END PF-BOOTH 1-----';
/** What replaces a scrubbed part of a note (notes never enter the machine block). */
export const BOOTH_SCRUB_MARK = '[הוסר]';

/** The machine block: ids, codes, hashes, versions, adapters; dates not times; no Hebrew, no notes, no names (verify C4d). */
export const BoothBlockSchema = z.object({
  v: z.literal(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  build: BoothBuildSchema,
  machine: BoothMachineSchema,
  answers: z.array(z.object({
    id: BoothItemIdSchema, recipe: Sha, played: Sha.optional(), verdict: z.enum(BOOTH_VERDICTS), problems: z.array(BoothProblemSchema).max(BOOTH_LIMITS.problems).optional(),
    browserAdapter: Ascii(BOOTH_LIMITS.adapterChars).optional(), browserSoftware: z.boolean().optional(), exportAdapter: Ascii(BOOTH_LIMITS.adapterChars).optional(), exportSoftware: z.boolean().optional(),
    /** Answered on this date (YYYY-MM-DD). */ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    /** The item's state when the report was made. */ state: z.enum(['answered', 'changed']),
  }).strict()).max(BOOTH_LIMITS.rows),
  checks: z.array(BoothCheckRowSchema).max(BOOTH_CHECKS.length),
}).strict();
export type BoothBlock = z.infer<typeof BoothBlockSchema>;
export type BoothBlockParse = { ok: true; block: BoothBlock } | { ok: false; code: 'no_block' | 'not_ascii' | 'checksum' | 'invalid' };

/** Everything the report is made from (the web holds the browser rows, the server the rest; the proof builds the same input). */
export interface BoothReportInput { view: BoothView; checks: readonly BoothCheckRow[]; /** YYYY-MM-DD, the day the report is made */ date: string }
/** The human part's words, in one language (from packages/i18n/src/booth.ts `booth.report.*`, `booth.check.*`, `booth.problem.*`). */
export type BoothSay = (key: string, vars?: Record<string, string | number>) => string;
/** What scrubNote replaces literally (case-insensitive) before its patterns: os.userInfo().username, os.homedir(), os.hostname(). */
export interface BoothScrubContext { literals: readonly string[] }

// ----------------------------------------------------------------------------------------------------------- not built (pre-pass)
/** Thrown by every booth function whose body is a builder's: a typed "not built" that no caller mistakes for a result. */
export class BoothNotBuiltError extends Error {
  readonly code = 'booth_not_built' as const;
  constructor(what: string) { super(`the review booth is not built in this build yet (${what})`); this.name = 'BoothNotBuiltError'; }
}
