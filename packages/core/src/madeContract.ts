/**
 * «קליפ מקוד» — a clip made by a page of code, drawn once offline into a transparent video asset (wave 8 `motioncode`).
 * Pre-pass contract (lead): limits, the record kept on the asset (`provenance.made`), the op's arguments, the wire types of the
 * routes, the refusal and warning table (English here, Hebrew in packages/i18n/src/made.ts HE_MADE), and pure-function signatures
 * whose bodies the builders write. Imports only zod (like the other contracts).
 *
 * Order of authority (.artifacts/wave8/decisions.md "motioncode"): the owner's decisions of 2026-11-26 (a general-purpose editor;
 * autonomy first, open by default) > motioncode-verify.md's last section > its C1–C11 > motioncode-plan.md. So:
 * - any credential that may edit starts a render and places the result itself, in ONE undoable transaction (apply_made_clip,
 *   committed as that credential); no propose step, no owner-only route, no hourly cap; a concurrency limit stays (capacity);
 * - the page static check WARNS (with offsets) and never refuses by policy (verify C4 as amended);
 * - flashing is a WARNING with its numbers (measured over black and over white), never a refusal; facts still fail the job
 *   (empty clip, a file that does not decode back, a wrong frame count, a page that never finishes a frame);
 * - pages may use pinned libraries (GSAP bundled), catalogue fonts, the owner's media read-only (asset ids recorded) and internet
 *   files fetched ONCE before drawing (url + sha256 recorded); the editor's own port stays unreachable from the page.
 */
import { z } from 'zod';

/** Version of the seek contract a page is drawn under (`window.PF.v`). */
export const MADE_V = 1 as const;
/** The durable job type of a render. */
export const MADE_JOB_TYPE = 'made.render' as const;
/** The internal op that brings a rendered file into the document. */
export const MADE_OP = 'apply_made_clip' as const;

/**
 * Limits (plan §3.1). activePerCredential / activeTotal keep the machine responsive (capacity, not permission); agent jobs yield the
 * compute lane to the owner's own jobs (verify C7 as amended).
 */
export const MADE_LIMITS = {
  pageBytes: 262_144, fields: 12, valueChars: 200, maxSeconds: 20, maxFrames: 1200, longSide: 1920, minSide: 16,
  frameMs: 2_000, jobMs: 900_000, heapMb: 256, activePerCredential: 1, activeTotal: 3,
  /** internet files a page names, fetched once before drawing */ fetchFiles: 16, fetchBytes: 50_000_000,
  /** the owner's media a page reads */ assets: 16,
  /** frames compared for determinism: three fixed (0, n/2, n−1) plus three from a per-job seed (verify C6) */ determinismFrames: 6,
  /** a page with more running animations than this is refused at the first frame (a fact about the page, not policy) */ animations: 200,
  /** flash rate above which the report warns (per second, ADR-0009's general limit) */ flashPerSecond: 3,
} as const;

const Key = z.string().regex(/^[a-z][a-zA-Z0-9]{0,23}$/);

/**
 * Libraries a page may load, served locally at https://made.invalid/lib/<name>@<version>/<file> from the pinned package (decision 4;
 * the owner's three.js addition of 2026-11-26). `licenceRead` says what was read at the source, by whom, when; a row whose licence was
 * not read stays a todo for W1 and is not served. Add-ons (three.js loaders, fonts for 3D text, GSAP plugins) are separate files that
 * must also be pinned and served locally; nothing is fetched while drawing.
 */
export interface MadeLibrary { name: string; version: string; licence: string; licenceRead: string | null; files: readonly string[]; unpackedBytes: number | null; installed: boolean; note: string }
export const MADE_LIBRARIES: readonly MadeLibrary[] = [
  { name: 'gsap', version: '3.15.1', licence: "Standard 'no charge' license: https://gsap.com/standard-license (package.json license field, read on npm 2026-11-26)", licenceRead: 'package.json license field via npm view (pre-pass, 2026-11-26); the licence page itself is research §6',
    files: ['dist/gsap.min.js'], unpackedBytes: 6_274_260, installed: false, note: 'Not open source; keep its notices; NOTICE row quoting the prohibited-use sentence (tools that build visual animations without code competing with Webflow). Bundled by decision 4; not installed by the pre-pass (house rule: install nothing; the lead adds the pin).' },
  { name: 'three', version: '0.187.0', licence: 'MIT ("The MIT License — Copyright © 2010-2026 three.js authors", package/LICENSE; package.json "license": "MIT")', licenceRead: 'LICENSE and package.json of three-0.187.0.tgz from registry.npmjs.org, read in the pre-pass 2026-11-26 (published 2026-10-30)',
    files: ['build/three.module.js', 'build/three.core.js'], unpackedBytes: 21_030_536, installed: false, note: 'WebGL build: three.module.js 658,900 B + three.core.js 1,474,799 B (unminified, the package ships no .min). Add-ons (examples/jsm loaders, FontLoader + typeface JSON for 3D text) are separate files, each pinned and served locally. Not installed by the pre-pass.' },
  { name: 'hyperframes-runtime', version: '0.0.0', licence: 'Apache-2.0 (research §2; package name and file to be read on npm)', licenceRead: null,
    files: [], unpackedBytes: null, installed: false, note: 'TODO W1: read the npm package (name, exact version, LICENSE, NOTICE) and check it makes no network or telemetry call at render; accepted through a seek adapter only then (decision 4).' },
];
export const MADE_FIELD_KINDS = ['text', 'colour', 'number'] as const;
export type MadeFieldKind = (typeof MADE_FIELD_KINDS)[number];
/** A field of a page: what the dialog shows and what `PF.fields` carries (typed values only, never markup). */
export const MadeFieldSchema = z.object({
  key: Key,
  kind: z.enum(MADE_FIELD_KINDS),
  label: z.object({ he: z.string().min(1).max(40), en: z.string().min(1).max(40) }).strict(),
  default: z.string().max(MADE_LIMITS.valueChars),
  min: z.number().optional(),
  max: z.number().optional(),
  maxLength: z.number().int().min(1).max(MADE_LIMITS.valueChars).optional(),
}).strict();
export type MadeField = z.infer<typeof MadeFieldSchema>;

const Sha = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/** One measured flash rate (FrameFlashCheck over the 480-wide analysis stream), per second. */
const FlashRate = z.object({ general: z.number().nonnegative(), red: z.number().nonnegative() }).strict();
/** How the browser that drew it was protected (madeLaunch.ts MadeSandbox); 'none' carries a warning in the report. */
export const MADE_SANDBOX = ['chromium', 'chromium-dropped-uid', 'none'] as const;

/**
 * The record a made clip keeps on its asset (`Asset.provenance.made`; origin 'generated', kind 'video'). The page text itself is a
 * content-addressed blob named by `pageSha256` (never in the document): the storage collector keeps any 64-hex string the
 * document names, the archive adds it (archiveBlobs), backup copies blobs/.
 */
export const MadeRecordSchema = z.object({
  v: z.literal(1),
  pageSha256: Sha,
  pageBytes: z.number().int().min(1).max(MADE_LIMITS.pageBytes),
  /** a built-in page (catalogue id and version) */
  templateId: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
  templateVersion: z.number().int().min(1).optional(),
  fields: z.array(MadeFieldSchema).max(MADE_LIMITS.fields),
  values: z.record(Key, z.string().max(MADE_LIMITS.valueChars)),
  frames: z.number().int().min(1).max(MADE_LIMITS.maxFrames),
  width: z.number().int().min(MADE_LIMITS.minSide).max(MADE_LIMITS.longSide),
  height: z.number().int().min(MADE_LIMITS.minSide).max(MADE_LIMITS.longSide),
  /** Chromium version that drew it */
  browser: z.string().max(80),
  sandbox: z.enum(MADE_SANDBOX),
  /** the page drew with WebGL (three.js or its own); headless Chromium without a graphics card uses the software renderer */
  webgl: z.literal(true).optional(),
  /** pinned libraries the page loaded from https://made.invalid/lib/ (`name@exact`) */
  libraries: z.array(z.string().regex(/^[@a-z0-9./-]{1,80}@\d+\.\d+\.\d+$/)).max(8).optional(),
  /** the owner's media the page read (served read-only at https://made.invalid/assets/<id>); kept so re-render and archive keep them */
  assetIds: z.array(z.string().max(64)).max(MADE_LIMITS.assets).optional(),
  /** internet files fetched once before drawing: what was asked for and what was served */
  fetched: z.array(z.object({ url: z.string().max(2048), sha256: Sha, bytes: z.number().int().nonnegative() }).strict()).max(MADE_LIMITS.fetchFiles).optional(),
  checks: z.object({
    /** frames compared between two passes (fixed and seeded) */
    determinism: z.object({ frames: z.array(z.number().int().nonnegative()).min(1).max(MADE_LIMITS.determinismFrames),
      /** WebGL pages only: pixels that differed between the two passes on THIS machine (0 = none); a difference is a warning (webglDiffers) */
      differingPixels: z.number().int().nonnegative().optional() }).strict(),
    /** measured rates; above MADE_LIMITS.flashPerSecond the report and the Inspector warn (never a refusal) */
    flash: z.object({ black: FlashRate, white: FlashRate }).strict(),
    /** false = every captured pixel opaque (a full-frame plate) */
    alpha: z.boolean(),
  }).strict(),
}).strict();
export type MadeRecord = z.infer<typeof MadeRecordSchema>;

// ---------------------------------------------------------------- the op (internal; madeOps.ts)
const RT = z.object({ value: z.string(), timescale: z.number().int().positive() }).strict();
/**
 * apply_made_clip: import the rendered file and either place it, replace it everywhere, or stop at the library; ONE transaction.
 * Issued by the server's apply route from a finished job (never from caller-supplied pixels): `asset` is built by the server
 * from the job output. Exactly one of place / replaceAssetId, or neither (= library only).
 */
export const ApplyMadeClipArgsSchema = z.object({
  asset: z.record(z.string(), z.unknown()).describe('the asset as the server built it from the finished job (AssetSchema without id; carries provenance.made)'),
  sequenceId: z.string().optional(),
  place: z.object({ start: RT, trackId: z.string().optional() }).strict().optional(),
  replaceAssetId: z.string().optional(),
}).strict();
export type ApplyMadeClipArgs = z.infer<typeof ApplyMadeClipArgsSchema>;
export interface ApplyMadeClipOutput { assetId: string; deduplicated: boolean; trackId?: string; clipId?: string; replacedClipIds?: string[] }

// ---------------------------------------------------------------- refusals, job failures and warnings
export type MadeOpCode = 'not_found' | 'incompatible' | 'out_of_bounds' | 'invalid_args' | 'unknown_op';
export interface MadeRow<A extends unknown[]> { code: string; why: string; message: (...a: A) => string; hint: string }
const row = <A extends unknown[]>(code: string, why: string, message: (...a: A) => string, hint: string): MadeRow<A> => ({ code, why, message, hint });
/**
 * Refusals of the op (OpError codes; `why` goes into details.why). Hebrew: HE_MADE (packages/i18n/src/made.ts), checked by
 * packages/evals/src/made-wording.test.ts.
 */
export const MADE_OP_REFUSALS = {
  notBuilt: row('unknown_op', 'made_not_built', () => 'apply_made_clip: clips made by a page are not built in this build yet', 'Nothing was changed. Update the editor and try again.'),
  noRecord: row('incompatible', 'made_no_record', () => 'this file was not made from a page (it has no made record)', 'Render the page first (POST …/made/render), then apply that job.'),
  notVideo: row('incompatible', 'made_not_video', () => 'a clip made by a page is a video file', 'Apply the file the render job produced.'),
  placeAndReplace: row('invalid_args', 'made_place_and_replace', () => 'place or replace, not both', 'Send either place or replaceAssetId, or neither to keep it in the library only.'),
  replaceUnused: row('not_found', 'made_replace_unused', (assetId: string) => `no clip shows the file ${assetId}`, 'Choose a file that is on the timeline, or place the new clip instead.'),
  tooShort: row('out_of_bounds', 'made_too_short', (clipId: string, frames: number) => `the new file is shorter than clip ${clipId} that uses the old one (it needs ${frames} frames)`, 'Render it again at the same length, or shorten that clip first.'),
} as const;
/**
 * Why a render job fails: FACTS about the page or the file only (verify C10 as amended: flashing is a warning, below). Each carries
 * the reason and the next step. The route answers its own codes (MADE_API).
 */
export const MADE_JOB_FAILURES = {
  frameTimeout: row('made_frame_timeout', 'made_frame_timeout', (frame: number, ms: number) => `the page did not finish drawing frame ${frame} within ${ms / 1000} seconds`, 'Look for a loop that never ends in render(); each frame must finish on its own.'),
  crashed: row('made_crashed', 'made_crashed', () => 'the page crashed while drawing (probably memory)', 'Draw with less memory: smaller pictures, fewer objects kept between frames.'),
  jobTimeout: row('made_job_timeout', 'made_job_timeout', (minutes: number) => `drawing took longer than ${minutes} minutes and was stopped`, 'Make the clip shorter or simpler, then render again.'),
  empty: row('made_empty', 'made_empty', () => 'the clip is empty: nothing was drawn', 'Check that render() draws into the page and that the colours are not fully transparent.'),
  decodeBack: row('made_decode_back', 'made_decode_back', (frame: number) => `the file does not keep what was drawn (frame ${frame} differs after encoding)`, 'Render again; if it repeats, report the page.'),
  frameCount: row('made_frame_count', 'made_frame_count', (got: number, want: number) => `the file has ${got} frames instead of ${want}`, 'Render again; if it repeats, report the page.'),
  notDeterministic: row('made_not_deterministic', 'made_not_deterministic', (frame: number) => `the page draws frame ${frame} differently the second time (it probably keeps something between frames)`, 'Make each frame depend only on its number: no counters, clocks or random numbers kept between calls.'),
  navigated: row('made_navigated', 'made_navigated', () => 'the page navigated away while drawing', 'Remove navigation (location, links, forms) from the page.'),
  fetchFailed: row('made_fetch_failed', 'made_fetch_failed', (url: string) => `the internet file ${url} could not be fetched before drawing`, 'Check the address, or put the picture in the project and use it from there.'),
  restarted: row('made_restarted', 'made_restarted', () => 'stopped by a restart of the editor', 'Press «יצירה» (Render) again.'),
  canceled: row('made_canceled', 'made_canceled', () => 'drawing was stopped', 'Render again when you want the clip.'),
} as const;
/** Warnings: the job succeeds and the report, the Inspector and the export flash report carry these with their numbers. */
export const MADE_WARNINGS = {
  flash: row('made_flash', 'made_flash', (rate: string, on: 'black' | 'white') => `the clip flashes ${rate} times a second (measured on ${on}), above 3`, 'Slow the changes of light, or keep it if you meant it; the export flash report will list it too.'),
  noSandbox: row('made_no_sandbox', 'made_no_sandbox', () => 'the browser ran without Chromium\'s sandbox', 'Nothing to do for this clip; on Linux, run the editor as a normal user or install setpriv.'),
  clock: row('made_clock', 'made_clock', (api: string, frame: number) => `the page read the clock or a random number (${api}) at frame ${frame}`, 'Draw from the frame number only (PF.render(frame, t)); a clock makes frames differ between renders.'),
  staticHit: row('made_static', 'made_static', (what: string, at: number) => `the page uses ${what} (at character ${at})`, 'It may still work; if the clip comes out wrong, this is the first place to look.'),
  webglDiffers: row('made_webgl_differs', 'made_webgl_differs', (pixels: number, frame: number) => `the WebGL page drew ${pixels} pixels differently the second time (frame ${frame})`, 'It was kept. WebGL is drawn by this machine\'s renderer: another computer or graphics card may draw it slightly differently.'),
  fontMissing: row('made_font_missing', 'made_font_missing', (family: string) => `the font ${family} is not in the catalogue, so a fallback face was used`, 'Use a font from the catalogue (GET /api/v1/made/templates lists them).'),
} as const;
export type MadeJobFailure = keyof typeof MADE_JOB_FAILURES;
export type MadeWarning = keyof typeof MADE_WARNINGS;

/** REST error codes of the made routes (route stubs answer 501 madeNotBuilt until W2 builds them). */
export const MADE_API = {
  notBuilt: { status: 501, code: 'made_not_built', message: 'clips made by a page are not built in this version yet', hint: 'Nothing was changed. Update the editor and try again.' },
  busy: { status: 429, code: 'made_busy', message: 'the machine is already drawing as many clips as it can', hint: 'Wait for a render to finish (GET …/made/jobs/:jobId), then try again.' },
  agentsPaused: { status: 403, code: 'made_agents_paused', message: 'agents are paused in this project', hint: 'Ask the owner to resume agents, then try again.' },
  jobNotFound: { status: 404, code: 'made_job_not_found', message: 'no such render job in this project', hint: 'List jobs with GET /api/v1/projects/:id/jobs.' },
  jobNotDone: { status: 409, code: 'made_job_not_done', message: 'the render job has not finished successfully', hint: 'Wait until it has succeeded (GET …/made/jobs/:jobId).' },
  alreadyApplied: { status: 409, code: 'made_already_applied', message: 'this render was already brought into the project', hint: 'Use the asset it made (the job report names it).' },
  badPage: { status: 422, code: 'made_bad_page', message: 'the page cannot be drawn as sent', hint: 'Fix what details.problems lists (size, encoding) and send it again.' },
  noPage: { status: 404, code: 'made_no_page', message: 'this file was not made from a page', hint: 'Only clips made by a page can be edited and drawn again.' },
} as const;

// ---------------------------------------------------------------- wire types of the routes (W2 builds; stubs answer 501)
/**
 * POST /api/v1/projects/:id/made/render → 202 { jobId }. Width, height and rate come from the active sequence, scaled so the long
 * side is at most MADE_LIMITS.longSide; `seconds` becomes whole frames (madeFramesFor). `place` / `replaceAssetId` / `library`
 * name what the job does when it succeeds (open semantics: the same credential's job applies itself in one transaction, decision 2);
 * leave all out to apply later with POST …/apply.
 */
export const MadeRenderRequestSchema = z.object({
  page: z.union([z.string().min(1).max(MADE_LIMITS.pageBytes), z.object({ templateId: z.string().regex(/^[a-z0-9-]{1,40}$/) }).strict()]),
  fields: z.array(MadeFieldSchema).max(MADE_LIMITS.fields).optional(),
  values: z.record(Key, z.string().max(MADE_LIMITS.valueChars)).optional(),
  seconds: z.number().positive().max(MADE_LIMITS.maxSeconds),
  name: z.string().min(1).max(80),
  assetIds: z.array(z.string().max(64)).max(MADE_LIMITS.assets).optional(),
  /**
   * The page's manifest of capabilities. webgl: the page draws with WebGL (allowed; the plan had cut it). The determinism check of a
   * WebGL page compares two passes on the SAME machine; a difference is a WARNING with the count of differing pixels (webglDiffers),
   * never a refusal, and a clip rendered on another machine or adapter may differ. Pages without the flag that differ still fail
   * (notDeterministic: a fact about a page that keeps state between frames).
   */
  capabilities: z.object({ webgl: z.boolean().optional(), libraries: z.array(z.string().regex(/^[@a-z0-9./-]{1,80}@\d+\.\d+\.\d+$/)).max(8).optional() }).strict().optional(),
  then: z.union([
    z.object({ place: z.object({ start: RT, trackId: z.string().optional() }).strict(), sequenceId: z.string().optional() }).strict(),
    z.object({ replaceAssetId: z.string() }).strict(),
    z.object({ library: z.literal(true) }).strict(),
  ]).optional(),
}).strict();
export type MadeRenderRequest = z.infer<typeof MadeRenderRequestSchema>;
export const MadeApplyRequestSchema = z.object({
  place: z.object({ start: RT, trackId: z.string().optional() }).strict().optional(),
  sequenceId: z.string().optional(),
  replaceAssetId: z.string().optional(),
  library: z.literal(true).optional(),
  expectedRevision: z.number().int().nonnegative().optional(),
}).strict();
export type MadeApplyRequest = z.infer<typeof MadeApplyRequestSchema>;
export type MadeStage = 'queued' | 'checking-page' | 'fetching' | 'drawing' | 'encoding' | 'checking-file' | 'done';
/** GET …/made/jobs/:jobId */
export interface MadeJobReport {
  jobId: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'; stage: MadeStage;
  progress: { frame: number; frames: number } | null;
  submittedBy: string;
  /** when succeeded */ fileSha256?: string; record?: MadeRecord; stills?: [string, string, string];
  /** set once applied */ appliedAssetId?: string;
  warnings: { why: MadeWarning; message: string; at?: number }[];
  failure?: { why: MadeJobFailure; message: string; hint: string };
  /** one sample of the wall time on this machine */ seconds?: number;
}
/** GET /api/v1/made/templates */
export interface MadeTemplateInfo { id: string; version: number; name: { he: string; en: string }; fields: MadeField[]; seconds: number; pageSha256: string; page: string;
  /** sample values in each language (the defaults are the Hebrew ones) */ samples: { he: Record<string, string>; en: Record<string, string> } }
/**
 * What a page sees (installed by the harness before the page's own script; frozen). `fields` holds typed values only: text as a
 * string, a colour as '#rrggbb', a number as a number. The page may define `render`; the harness calls it for each frame, then
 * pauses every document animation and seeks it to frame·den/num seconds (CSS @keyframes and Web Animations), then awaits fonts.
 */
export interface MadePageGlobals {
  v: typeof MADE_V; width: number; height: number; fps: { num: number; den: number }; frames: number;
  fields: Readonly<Record<string, string | number>>;
  render?: (frame: number, t: number) => void | Promise<void>;
}
/** GET …/made/assets/:assetId/page */
export interface MadeAssetPage { assetId: string; page: string; record: MadeRecord }

// ---------------------------------------------------------------- pure functions (signatures; bodies by the builders)
export class MadeNotBuiltError extends Error {
  readonly code = 'made_not_built' as const;
  constructor(readonly fn: string) { super(`${fn}: clips made by a page are not built in this build yet`); }
}
/** Whether each part is built (flipped by the builders and the integrator). */
export const MADE_BUILT = { op: true, check: true, harness: true, routes: true, ui: true } as const;

/** checkMadePage and madeFieldsCheck: madeCheck.ts (W2). */
/** Whole frames for `seconds` at `rate`: round(seconds × num / den), at least 1, at most MADE_LIMITS.maxFrames. The duration is T.frameTime(frames, rate). */
export function madeFramesFor(seconds: number, rate: { num: number; den: number }): number {
  return Math.max(1, Math.min(MADE_LIMITS.maxFrames, Math.round((seconds * rate.num) / rate.den)));
}
/** The render size for a sequence: the sequence's own size scaled so the long side is at most MADE_LIMITS.longSide, even numbers. */
export function madeSizeFor(width: number, height: number): { width: number; height: number } {
  const k = Math.min(1, MADE_LIMITS.longSide / Math.max(width, height));
  const even = (x: number) => Math.max(MADE_LIMITS.minSide, 2 * Math.round((x * k) / 2));
  return { width: even(width), height: even(height) };
}
