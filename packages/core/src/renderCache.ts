/**
 * Segmented export and render cache (ADR-0024): the wire types shared by the server, the MCP tools and the editor, and the
 * fixed wording of the export blockers and job failures of the incremental route. No logic and no project state: the cache is
 * derived data keyed by content (plan §1), so there are no schema fields and no operations, and `Store.commit` stays the only
 * authority. Undo is untouched; undoing an edit simply finds the old segments again if they are still stored.
 *
 * Lead contracts, frozen for the workers (engine frameKey.ts / segmentGrid.ts, server segmentStore.ts / exportSegments.ts /
 * cellsCodec.ts, web renderCache.*). Settled here from the plan verifier (.artifacts/segment-cache-plan.md, "Verifier"):
 * - `gpu_not_reproducible` is an uncacheable reason: in wave 1 a frame with a GPU pass is cacheable only on a software adapter.
 * - a segment that could not be stored (no room within the cap, the ceiling and the minimum-free rule) is joined from the job's
 *   work directory and counted in `notStored`; that is never a failure.
 * - the self-check proves the sampled frames only: `framesChecked` is what the done line may claim, never "the cache was verified".
 * - the engine fingerprint's `browser` is `${version}|launch=${mode}` of the browser that renders THIS job.
 */

/** Seconds of one grid cell (plan §3): segFrames = max(1, round(SEGMENT_SECONDS · num / den)). */
export const SEGMENT_SECONDS = 2;
/**
 * No segment is shorter than this unless it is the only one: a 1- or 2-frame head or tail part joins its neighbour (so a segment
 * may hold up to segFrames + 2 frames). Measured by the verifier on ffmpeg 6.1.1: libx264 writes a 1–2 frame segment with
 * PTS = DTS while longer ones start two frames earlier in DTS, and the stream-copy join then loses a frame.
 */
export const MIN_SEGMENT_FRAMES = 3;
/** Clean incremental exports (per engine fingerprint) before `selfCheck: 'auto'` moves from every segment to a sample. Reset to 0 by any self-check failure. */
export const AUTO_SELF_CHECK_CLEAN_EXPORTS = 20;
/** Frames checked per reused segment in `every-segment` mode: the first, the last and one seeded frame. */
export const EVERY_SEGMENT_FRAMES = 3;
/** The lane refreshes by itself only when the last plan's keying took less than this; otherwise it offers «רענון». */
export const LANE_AUTO_REFRESH_MAX_KEYING_MS = 2000;
/** The lane re-plans this long after the last revision change (the stale request is aborted). */
export const LANE_REFRESH_DEBOUNCE_MS = 1500;

export const EXPORT_MODES = ['single-pass', 'incremental'] as const;
export type ExportMode = (typeof EXPORT_MODES)[number];
export const SELF_CHECK_MODES = ['auto', 'sample', 'every-segment'] as const;
export type SelfCheckMode = (typeof SELF_CHECK_MODES)[number];

export type SegmentState = 'cached' | 'render' | 'uncacheable';
/**
 * Why a segment cannot be cached: it is then rendered every time, never stored, and shown as such (dotted in the lane).
 * - unkeyable_value: the frame holds a value with no stable encoding (function, symbol, bigint, Map, Set, typed array, class instance).
 *   NaN, ±Infinity and -0 are NOT unkeyable: canonicalJson encodes them as tagged tokens (strobe before its first flash, overlay speed limits).
 * - unknown_layer_kind: the key walk met a layer kind it does not know (exhaustive switch).
 * - gpu_not_reproducible: the frame has a GPU pass and the render worker's adapter is unknown or not a software adapter; not cacheable
 *   in wave 1 until a twice-rendered equality check on that machine is recorded (verifier B6).
 * - asset_unhashed: a file or font the frame reads has no content hash available.
 */
export const UNCACHEABLE_CODES = ['unkeyable_value', 'unknown_layer_kind', 'gpu_not_reproducible', 'asset_unhashed'] as const;
export type UncacheableCode = (typeof UNCACHEABLE_CODES)[number];

/** Run-length view of the segment plan; frames are relative to the exported range, segments count from the range's first segment. */
export interface SegmentRun { state: SegmentState; firstSegment: number; segments: number; firstFrame: number; frames: number }

/** What the store holds and may hold. Owner-visible (status-bar storage row, project manager → storage). */
export interface RenderCacheStatus {
  /** False when the cap is 0 (PF_RENDER_CACHE_BYTES=0) or the route is not available on this machine. */
  enabled: boolean;
  capBytes: number;
  usedBytes: number;
  segments: number;
  /** Highest `usedBytes` seen since the store was opened (proof I11 asserts on it, not on samples only). */
  highWaterBytes: number;
  autoClear: boolean;
  minFreeBytes: number;
}

/** `{ bundle, browser, schemaVersion }`, taken per job and per plan, never at server start. */
export interface EngineFingerprint {
  /** sha256 over (name, sha256) of render.html and every file under webDist/assets (cached by name, size and mtime). */
  bundle: string;
  /** `${version}|launch=${mode}` of the browser that renders this job (RenderHost.identity). */
  browser: string;
  schemaVersion: number;
}

export interface SegmentPlanView {
  revision: number;
  mode: 'incremental';
  segFrames: number;
  firstFrame: number;
  frames: number;
  segments: { total: number; cached: number; render: number; uncacheable: number };
  framesToRender: number;
  runs: SegmentRun[];
  uncacheable: { code: UncacheableCode; segments: number }[];
  /** seconds: only from measured history (>= 3 stored segments at this output size), else null. bytesToStore likewise. */
  estimate: { seconds: number | null; basis: string; bytesToStore: number | null };
  cache: RenderCacheStatus;
  keyingMs: number;
}

export interface SegmentedExportReport {
  segFrames: number;
  total: number;
  reused: number;
  rendered: number;
  uncacheable: number;
  /** Reused entries whose stored video failed the integrity check: dropped and rendered again. */
  corruptDropped: number;
  /** Rendered segments that could not be stored (no room): joined from the job's work directory. Not a failure. */
  notStored: number;
  /**
   * `mismatches` is always 0 in a report: a mismatch fails the job (render_cache_self_check_failed). `framesPerSegment` is
   * EVERY_SEGMENT_FRAMES in every-segment mode and 1 in sample mode. The check proves the sampled frames, nothing more.
   */
  selfCheck: { mode: 'sample' | 'every-segment'; seed: string; segmentsChecked: number; framesChecked: number; framesPerSegment: number; mismatches: 0 };
  encoderId: string;
  engine: EngineFingerprint;
  cacheBytesAfter: number;
  ms: { keying: number; selfCheck: number; render: number; join: number };
}

/** The export output's `route` for a segmented export (the single-pass route stays 'server-software-canvas2d'). */
export const SEGMENTED_ROUTE = 'server-segmented-canvas2d';

/** Job stages of the incremental route, in order (the UI words them from i18n `cache.stage.*`). */
export const SEGMENTED_STAGES = ['preparing', 'rendering audio', 'keying', 'self-check', 'rendering', 'joining', 'validating'] as const;
export type SegmentedStage = (typeof SEGMENTED_STAGES)[number];

/**
 * Export blockers of the incremental route (plan §1, 422 render_blocked with `{ code, message, ids }` like every blocker).
 * The English sentence is fixed here; packages/i18n renderCache.ts words each in Hebrew and
 * packages/evals/src/render-cache-wording.test.ts keeps the two in step. `hint` is the fix offered.
 * There is deliberately no "cache full" blocker (verifier B2/D): a segment that finds no room is joined from the job's work
 * directory and counted in `notStored`; only the joined file itself can meet 507 storage_quota_exceeded.
 */
export const RENDER_CACHE_BLOCKERS = {
  formatUnsupported: { code: 'incremental_format_unsupported', message: (format: string) => `the fast export renders only MP4 for now; ${format} is exported in one pass`, hint: 'Choose MP4, or turn the fast export off.' },
  cacheDisabled: { code: 'render_cache_disabled', message: () => 'the render cache is turned off on this machine (its size limit is 0)', hint: 'Set PF_RENDER_CACHE_BYTES, or turn the fast export off.' },
  unavailable: { code: 'incremental_unavailable', message: (reason: string) => `the fast export is not available on this machine: ${reason}`, hint: 'Turn the fast export off; the ordinary export is unchanged.' },
} as const;
export type RenderCacheBlockerKey = keyof typeof RENDER_CACHE_BLOCKERS;
export const RENDER_CACHE_BLOCKER_CODES = Object.values(RENDER_CACHE_BLOCKERS).map((b) => b.code);
/** The reason `incremental_unavailable` gives until the segmented route is wired into Exporter.run (lead wiring after W2). */
export const INCREMENTAL_NOT_BUILT_REASON = 'the segmented export route is not built yet';

/** Failure of a running incremental export: the job's error code, its fixed sentence and that it may be retried. */
export const RENDER_CACHE_JOB_ERRORS = {
  selfCheckFailed: {
    code: 'render_cache_self_check_failed',
    message: (first: number, frames: number, frame: number, purged: number) => `the self-check found a stored segment (frames ${first}–${first + frames - 1}) that does not match the current render at frame ${frame}; the ${purged} stored segments this export reused were removed and nothing was published`,
    retryable: true,
  },
  joinMismatch: {
    code: 'segment_join_mismatch',
    message: (first: number) => `the segment starting at frame ${first} was encoded with a different packet timing from the others, so it cannot be joined exactly`,
    retryable: true,
  },
} as const;
