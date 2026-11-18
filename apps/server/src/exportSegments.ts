/**
 * Segmented export (ADR-0024, plan §3–§5 with the verifier's corrections): key every frame of the range, reuse the stored
 * segments whose key is unchanged (each integrity-checked on reuse), self-check frames of the reused ones BEFORE any render
 * time is spent, render only the missing segments through the unchanged render page and compositor (ADR-0005), encode each as
 * its own closed-GOP libx264 run, and join them by stream copy with exact timestamps (ADR-0003: TS = num·k, D = den·k, setts
 * overwrites DTS with N·D). Sound is mixed whole as today. The flash check runs over the cells of every programme frame in order
 * (flashCheck.ts reportFromCells), so a flash sequence across a join is seen whole (ADR-0009).
 *
 * LEAD STUBS, final signatures. W2 (server) owns the bodies. The lead wires runSegmentedExport into Exporter.run, the plan route
 * (renderCacheRoutes.ts) and the MCP tools after W2; it does not edit this file's shapes without telling W2.
 */
import type { EngineFingerprint, ProjectDocument, SegmentedExportReport, SegmentPlanView, SegmentState, UncacheableCode } from '@pulseframe/core';
import type { Digest, GpuAdapterIdentity, Segment } from '@pulseframe/engine';
import type { MixResult } from './audiomix.ts';
import type { FrameRun, Manifest, SegmentSink } from './export.ts';
import type { PhotosensitivityReport } from './flashCheck.ts';
import type { SegmentStore } from './segmentStore.ts';

export type { FrameRun, SegmentSink } from './export.ts';

/** What a segment key depends on besides the document: the machine, the build and the encoder. Taken per job (renderCacheEnv.ts). */
export interface SegmentEnv {
  digest: Digest;
  engine: EngineFingerprint;
  /** encoderIdOf(`ffmpeg -version` stdout, segmentEncodeArgs with fixed placeholders for size and output path). */
  encoderId: string;
  threads: number;
  /** The adapter a GPU pass runs on (RenderHost.identity(true)); null when unknown. */
  gpu: GpuAdapterIdentity | null;
  assetHash(assetId: string): string | null;
  fontHash(family: string): string | null;
  effectVersion(type: string): number;
}
/**
 * The key of one programme frame (engine frameKey with this env), or a throw of engine UnkeyableError. A parameter of the planner
 * so that it can be tested with a fake while W1's key is built separately.
 */
export type FrameKeyFn = (programmeFrame: number) => string;

export interface PlannedSegment extends Segment { key: string | null; state: SegmentState; uncacheable?: UncacheableCode }
export interface SegmentPlan { revision: number; segFrames: number; segments: PlannedSegment[]; keyingMs: number }

/**
 * Keys every frame of the manifest's range through `keyOf`, yielding to the event loop after each segment; a frame
 * that throws UnkeyableError makes its segment 'uncacheable' with that code; store.has(key) makes it 'cached', else 'render'.
 * The document is the job's render document (export.ts renderDocFor), never the raw project. Throws Error('canceled') on cancel.
 */
export function planSegments(doc: ProjectDocument, manifest: Manifest, env: SegmentEnv, store: SegmentStore, keyOf: FrameKeyFn, isCanceled?: () => boolean): Promise<SegmentPlan> {
  void doc; void manifest; void env; void store; void keyOf; void isCanceled;
  throw new Error('planSegments: not built yet (segment cache W2)');
}
/** Run-length view for the sheet, the lane and agents; estimate.seconds only from store.medianRenderMsPerFrame, else null. */
export function planView(plan: SegmentPlan, manifest: Manifest, store: SegmentStore): SegmentPlanView {
  void plan; void manifest; void store;
  throw new Error('planView: not built yet (segment cache W2)');
}
/** timescale = num · k, frameTicks = den · k, k = the smallest power of two with num · k >= 10000. */
export function trackTimescale(rate: { num: number; den: number }): { timescale: number; frameTicks: number } {
  void rate;
  throw new Error('trackTimescale: not built yet (segment cache W2)');
}
/**
 * rawvideo rgba on stdin -> one closed-GOP H.264 segment in MP4, no sound: today's EXPORT_PIXEL_FILTER, libx264 preset/CRF and
 * EXPORT_COLOR_TAGS of export.ts, plus -threads N -g S -keyint_min S -sc_threshold 0 -x264-params open-gop=0
 * -video_track_timescale TS -bitexact -an -f mp4. `segFrames` here is the segment's own length (the GOP covers it whole).
 */
export function segmentEncodeArgs(o: { width: number; height: number; frameRate: { num: number; den: number }; quality: 'draft' | 'standard' | 'high'; segFrames: number; threads: number; outFile: string }): string[] {
  void o;
  throw new Error('segmentEncodeArgs: not built yet (segment cache W2)');
}
/** ffconcat list (absolute paths) + WAV -> final MP4 by stream copy with -bsf:v setts=dts=STARTDTS+N*D:pts=STARTDTS+N*D+PTS-DTS:duration=D, -c:a aac -b:a 192k -movflags +faststart. */
export function joinArgs(o: { listFile: string; wav: string; outFile: string; frameRate: { num: number; den: number } }): string[] {
  void o;
  throw new Error('joinArgs: not built yet (segment cache W2)');
}
/** One-time check that this ffmpeg can do the exact join (a real two-segment encode and join of generated frames); cached for the process. */
export function incrementalAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
  throw new Error('incrementalAvailable: not built yet (segment cache W2)');
}
/**
 * Frames of reused segments to render again and compare, in programme order. every-segment: core EVERY_SEGMENT_FRAMES frames per
 * segment (first, last, one seeded). sample: n = R when R <= 8, else clamp(ceil(0.1 R), 8, 64) segments, least recently verified
 * first (store.verifyOrder), one frame each at first + u32(digest(seed|key)) mod frames. Reproducible from `seed`.
 */
export function selectSelfCheck(reused: readonly PlannedSegment[], store: SegmentStore, mode: 'sample' | 'every-segment', seed: string, digest: Digest): { segment: PlannedSegment; frame: number }[] {
  void reused; void store; void mode; void seed; void digest;
  throw new Error('selectSelfCheck: not built yet (segment cache W2)');
}

export interface SegmentedExportDeps {
  /** The job's snapshot (already the render document). */
  doc: ProjectDocument;
  manifest: Manifest;
  projectId: string;
  jobId: string;
  attempt: number;
  env: SegmentEnv;
  store: SegmentStore;
  keyOf: FrameKeyFn;
  /** Resolved by the caller: 'auto' is every-segment while store.cleanSelfChecks(env.engine) < AUTO_SELF_CHECK_CLEAN_EXPORTS. */
  selfCheck: 'sample' | 'every-segment';
  /** The job's work directory (segments that could not be stored stay here until the join). */
  workDir: string;
  /** The partial output file in workDir; the caller renames it into out/ after success. */
  outFile: string;
  /** Opens the render session with these runs (Exporter.open(..., runs)), attaches `sink`, drives the page, resolves with its stage timings. */
  render(runs: FrameRun[], sink: SegmentSink, onAbort: (abort: () => void) => void): Promise<{ stageMs: unknown }>;
  mixAudio(wavFile: string): Promise<MixResult>;
  canceled(): boolean;
  stage(text: string): void;
  onProcess(p: { kill(signal?: NodeJS.Signals): boolean } | null): void;
}
export interface SegmentedExportResult { report: SegmentedExportReport; photosensitivity: PhotosensitivityReport | null; audio: MixResult; validation: Record<string, unknown>; renderStageMs: unknown }
/**
 * Throws ApiError render_cache_self_check_failed (after dropping every key this export reused and resetting the clean counter),
 * segment_join_mismatch, or storage_quota_exceeded (only when the joined file cannot be written); throws Error('canceled') on
 * cancel (committed segments stay, so a retry resumes). A failure the sink raised is rethrown as its typed ApiError, not as the
 * page's upload error.
 */
export function runSegmentedExport(deps: SegmentedExportDeps): Promise<SegmentedExportResult> {
  void deps;
  throw new Error('runSegmentedExport: not built yet (segment cache W2)');
}
