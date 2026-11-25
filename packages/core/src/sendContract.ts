/**
 * «שליחה ושמירה» — send and keep (wave 7, track send): the shared contract of size-fit export, export checks and loudness.
 * Lead pre-pass. Decisions: .artifacts/wave7/send-decisions.md (plan send-plan.md, corrected by send-verify.md C1–C18).
 *
 * - Size-fit (builder B): an MP4 export at or under `sizeFit.targetBytes`. 1 «מ״ב» = 1,000,000 bytes. The plan is integer
 *   arithmetic only (sizeFit.ts planSizeFit); the result is measured (bytes on disk), retried once, never claimed.
 * - Export checks (builder B picture, builder A sound): report only (no 'stop' in v1). Picture findings are a HEURISTIC on the
 *   24 × 24 flash cells; sound findings are read from the written 16-bit WAV, before AAC.
 * - Loudness (builder A): per-clip measurement, the op match_clip_loudness (sendOps.ts, complete) and the master limiter
 *   (settings.limiter, op set_master_limiter, complete).
 * No ops.ts import at run time (ops.ts must not depend on this file); sendOps.ts imports both.
 */
import type * as T from '@pulseframe/time';
import type { OpErrorCode } from './ops.ts';

// ---------- size-fit ----------
/** Fixed numbers of the fit plan (send-decisions §2.1). Ratios are integers over 100 so the plan has no float rounding. */
export const SEND_FIT = {
  minTargetBytes: 1_000_000,
  maxTargetBytes: 4_000_000_000,
  /** bytes per «מ״ב» shown to the owner */
  megabyte: 1_000_000,
  /** scales tried, largest first (never above the caller's scale) */
  scales: [1, 0.5, 0.25] as const,
  /** audio rates tried inside each scale, in bits per second */
  audioBps: [96_000, 64_000, 48_000] as const,
  /** share of (target − container allowance) given to the streams: 97/100 */
  streamShare: { num: 97, den: 100 },
  /** HEURISTIC floor of video bits per pixel per frame: 3/100 (the "draft" figure of the size estimate, export.ts BPP.draft) */
  floorBitsPerPixelFrame: { num: 3, den: 100 },
  /** container allowance O = base + perVideoFrame·frames + perAudioFrame·⌈samples/1024⌉ bytes (an upper estimate) */
  overhead: { base: 4096, perVideoFrame: 20, perAudioFrame: 12, audioFrameSamples: 1024 },
  /** the one retry aims at v·(target/bytes)·97/100 */
  retryShare: { num: 97, den: 100 },
} as const;
export type SizeFitScale = (typeof SEND_FIT.scales)[number];
export interface SizeFitInput {
  targetBytes: number;
  /** exported frames and their exact rate */
  frames: number; rate: T.Rate;
  /** output size at scale 1 (even dimensions, as the export rounds them) */
  width: number; height: number;
  sampleRate: number;
  /** the caller's scale: the largest scale the fit may use */
  maxScale: SizeFitScale;
}
export interface SizeFitPlan {
  ok: true; scale: SizeFitScale; width: number; height: number;
  videoBitrate: number; audioBitrate: number; overheadBytes: number;
  /** the heuristic figure, shown as a number: video bits per pixel per frame at the chosen scale (rounded to 1e-4 for display) */
  bitsPerPixelFrame: number;
  basis: string;
}
export interface SizeFitRefusal { ok: false; code: 'size_fit_too_small'; minBytes: number }
/** The fit as written into the export manifest (Manifest.fit). */
export interface SizeFitManifest { targetBytes: number; scale: SizeFitScale; width: number; height: number; videoBitrate: number; audioBitrate: number; overheadBytes: number; bitsPerPixelFrame: number; basis: string }
/** The fit as reported on the finished job (output.fit). */
export interface SizeFitOutput {
  targetBytes: number; bytes: number; result: 'fitted' | 'already_fits';
  attempts: { videoBitrate: number; bytes: number }[];
  scale: SizeFitScale; width: number; height: number; audioBitrate: number;
  /** what was done, in words: the compositor's frames are encoded once at full quality, then re-encoded to the target */
  method: string;
  /** present only when a labelled test fault was injected (startServer deps.fitFault) */
  test?: string;
}
/** Test seam only (startServer's second argument): forces the first or every attempt over the target. Nothing reads the environment. */
export type SizeFitFault = 'overshoot-once' | 'overshoot-always';
/** Container and stream tags an MP4 output may carry (send-decisions C8); anything else fails the metadata check. */
export const ALLOWED_OUTPUT_TAGS = ['major_brand', 'minor_version', 'compatible_brands', 'encoder', 'language', 'handler_name', 'vendor_id'] as const;

// ---------- export checks (report only) ----------
export const CHECK_LIMITS = {
  /** black: every cell's linear R, G and B at or under the linear value of 8-bit level 4, for at least 0.5 s */
  blackLevel8: 4, blackSeconds: { num: 1, den: 2 },
  /** frozen: every cell equal to the previous frame's for at least 2 s while a video plays (HEURISTIC; see pictureExpectation) */
  frozenSeconds: { num: 2, den: 1 },
  /** sound blocks of 0.1 s */
  blockSeconds: { num: 1, den: 10 },
  /** clipped: a block with at least 3 samples at −32768 or 32767 */
  clippedSamplesPerBlock: 3,
  /** silence: blocks whose RMS is under −60 dBFS for at least 2 s */
  silenceDbfs: -60, silenceSeconds: { num: 2, den: 1 },
} as const;
export const FINDING_KINDS = ['black', 'frozen', 'silence', 'clipped'] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
/** One finding, in timeline time (exact rationals; sound findings in samples of the project rate, picture findings in frames). */
export interface ExportFinding {
  kind: FindingKind;
  from: T.RationalTime; to: T.RationalTime;
  /** black only: 'gap' = nothing is drawn there (the fact preflight warns about); 'picture' = something is drawn and it is black */
  context?: 'gap' | 'picture';
  /** silence only: whether a sound clip plays there */
  soundPlays?: boolean;
  /** the measurement behind the finding, shown with it (frames, cells, samples, peak …) */
  measured: Record<string, number>;
}
export interface PictureChecks { method: string; status: 'measured' | 'not_measured'; findings: ExportFinding[] }
export interface SoundChecks { method: string; status: 'measured' | 'not_measured'; findings: ExportFinding[] }
export interface ExportChecks { picture: PictureChecks; sound: SoundChecks; /** the kinds looked for (the quiet state lists them; it never says the file is fine) */ lookedFor: readonly FindingKind[] }
/** Frame intervals [from, to) of the exported range, in exported frames, from the document (exportChecks.ts pictureExpectation). */
export interface PictureExpectation { drawn: [number, number][]; moving: [number, number][] }

// ---------- loudness ----------
export const LOUDNESS_MATCH = {
  /** headroom over the ceiling a clip may use when a master limiter is on (dB); 0 without one */
  limiterHeadroomDb: 6,
  /** a clip under this is not matched (too_short); under shortSeconds it is matched and marked less reliable */
  tooShortSeconds: { num: 2, den: 5 }, shortSeconds: { num: 3, den: 1 },
  /** default target for a single clip (LUFS) */
  singleClipTarget: -18,
  maxClips: 500, maxGain: 8,
} as const;
/** POST …/analysis/clip-loudness and MCP measure_clip_loudness: which clips (default: the selection the caller names; required in v1). */
export interface ClipLoudnessRequest { clipIds: string[]; sequenceId?: string; background?: boolean }
export interface ClipLoudnessRow {
  clipId: string;
  status: 'measured' | 'short' | 'too_short' | 'silent';
  measuredLufs: number | null; peakDbfs: number | null;
  /** the clip's gain the measurement was made at (the op's stale guard) */
  gain: number;
  seconds: number;
}
export interface ClipLoudnessResult {
  /** commit the match with expectedRevision = revision (send-decisions C15) */
  revision: number;
  clips: ClipLoudnessRow[];
  /** median of the measured clips (the default target), null when none was measured */
  medianLufs: number | null;
  method: string;
}
/** One clip of match_clip_loudness (the numbers come from the measurement). */
export interface MatchClipInput { clipId: string; measuredLufs: number; peakDbfs: number; gain: number }
export interface MatchClipOutput { clipId: string; from: number; to: number; changeDb: number; limitedBy: null | 'peak' | 'range' }

// ---------- refusals ----------
/** Every row has a hint (the way forward); send-wording.test.ts checks it and the Hebrew sentence (i18n send.ts HE_SEND) carries it. */
export interface SendRefusalRow<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint: string; reason?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint: string, reason?: string): SendRefusalRow<A> => ({ code, message, hint, ...(reason ? { reason } : {}) });
/** The op refusals of match_clip_loudness (set_master_limiter refuses only by its argument schema). */
export const SEND_REFUSALS = {
  duplicate: refusal('invalid_args', (clipId: string) => `clip ${clipId} is listed twice`, 'List every clip once; each clip is measured and matched once.'),
  notSound: refusal('incompatible', (clipId: string) => `clip ${clipId} is not a sound clip on a sound track`, 'Choose the sound clips (on sound tracks) and measure them again.'),
  stale: refusal('incompatible', (clipId: string) => `the level of clip ${clipId} changed since it was measured`, 'Measure the clips again, then match.', 'stale_measurement'),
} as const;
export type SendRefusalKey = keyof typeof SEND_REFUSALS;
/** Route, blocker and job-error refusals (raised by the server as ApiError, blockers or job errors). */
export const SEND_API_REFUSALS = {
  clipLoudnessNotBuilt: { status: 501, code: 'not_built', message: () => 'measuring the loudness of single clips is not built in this version yet', hint: 'Nothing was changed. The loudness of the whole film can still be measured.' },
  sizeFitNotBuilt: { status: 422, code: 'size_fit_not_built', message: () => 'sending at a target size is not built in this version yet', hint: 'Export without a target size for now.' },
  sizeFitFormat: { status: 422, code: 'size_fit_format', message: (format: string) => `a target size works for MP4 files only, not ${format}`, hint: 'Choose MP4, or export without a target size.' },
  sizeFitTooSmall: { status: 422, code: 'size_fit_too_small', message: (target: number, min: number) => `a target of ${target} bytes is too small for this film; the smallest that works is ${min} bytes`, hint: 'Choose a larger target, or export a shorter part of the film.' },
  sizeFitMissed: { status: 0, code: 'size_fit_missed', message: (bytes: number, target: number) => `the file came out at ${bytes} bytes, over the target of ${target} bytes, on both attempts`, hint: 'No file was saved. Try a slightly larger target or a shorter film.' },
  browserRoute: { status: 409, code: 'unsupported_in_browser_export', message: () => 'the browser export route cannot fit a target size or run the master limiter', hint: 'Use the server export, or export without a target size and with the master limiter off.' },
} as const;
export type SendApiRefusalKey = keyof typeof SEND_API_REFUSALS;
/** Job stage words of the fit pass (their words: i18n effectParams.ts STAGE_WORDS). 'fitting size 1/2' keeps its count. */
export const SEND_STAGES = ['fitting size', 'checking size', 'checking the export'] as const;
