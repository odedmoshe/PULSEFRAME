/**
 * Server export route (SPEC §9), software profile:
 *   immutable snapshot -> headless Chromium runs the shared evaluator + Canvas2D compositor
 *   -> raw RGBA frames (their own stream) -> ffmpeg libx264
 *   audio is rendered separately by ffmpeg to a sample-exact WAV, then muxed as a second input.
 * Jobs are durable rows; a job interrupted by a restart re-runs from its immutable snapshot and
 * publishes its output with an atomic rename, so a retry never yields a duplicate or partial file.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { collectCredits, creditDue, creditsView, type CreditsView } from '@pulseframe/core';
import { AUTO_SELF_CHECK_CLEAN_EXPORTS, EXPORT_MODES, INCREMENTAL_NOT_BUILT_REASON, RENDER_CACHE_BLOCKERS, SEGMENTED_ROUTE, SELF_CHECK_MODES, type RenderCacheStatus, type SegmentedExportReport } from '@pulseframe/core';
import { assembleChecks, flagsOf, pictureExpectation, planSizeFit, SEND_API_REFUSALS, SEND_FIT, SIZE_FIT_BUILT, type ExportFinding, type PictureChecks, type SizeFitFault, type SizeFitManifest, type SizeFitOutput, type SoundChecks } from '@pulseframe/core';
import { cropFitsPaper, printFit, STILL_EXCLUSIVE_OPTIONS, STILL_EXPORT_BUILT, STILL_TRIED_MAX_PIXELS, stillDocument, STILLS_REFUSALS, StillExportSchema, StillsRefusal, sourceTimeOfFrame, type Asset, type StillCrop, type StillOutput } from '@pulseframe/core';
import { GPU_EFFECT_IDS, GPU_TRANSITION_IDS, timeOriginSeconds, findEffect, lutRef, findFont, FONT_CATALOG, OutputTargetError, OUTPUT_WARNINGS, outputWarnings, projectOutput, sequenceDuration, serializeSrt, serializeVtt, type OutputTarget, type ProjectDocument } from '@pulseframe/core';
import type { RenderHost } from '@pulseframe/renderer';
import { AUDIO_FX_ENGINE, audioPlan, captionCues, PictureCheck, soundEnd, type AudioPlan, type FlashCells, type PlannedAudioClip } from '@pulseframe/engine';
import { mixRoomBytes, renderMix, type MixResult } from './audiomix.ts';
import { limiter } from './analysis.ts';

const stillLimit = limiter(2, 32);
import { ffprobe } from './ingest.ts';
import { assertStorageRoom } from './storage.ts';
import { FrameFlashCheck, type PhotosensitivityReport } from './flashCheck.ts';
import { assertOutputTags, runSizeFit } from './sizeFit.ts';
import { writeStillFile } from './stillFile.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { blobPresent, MISSING_MEDIA_HINT } from './mediaPresence.ts';
import type { ComputeLane } from './aiContracts.ts';
import { fieldIssues } from './preflight.fields.ts';
import type { FrameKeyFn, runSegmentedExport, SegmentEnv } from './exportSegments.ts';
import type { SegmentStore } from './segmentStore.ts';
import { RENDER_CACHE_PURGED } from './segmentStore.ts';

const exec = promisify(execFile);

export const ExportOptionsSchema = z
  .object({
    format: z.enum(['mp4-h264-aac', 'webm-vp9-opus', 'gif', 'wav', 'png', 'jpeg']).default('mp4-h264-aac').describe('Container/codecs. gif = animated picture without sound; wav = audio only; png = one still frame; jpeg = only with `still`'),
    captions: z.enum(['burned', 'sidecar-srt', 'sidecar-vtt', 'none']).default('burned').describe('burned = captions drawn into the picture (as previewed); sidecar-* = clean picture plus a subtitle file timed to this export; none = clean picture, no file'),
    quality: z.enum(['draft', 'standard', 'high']).default('high'),
    scale: z.union([z.literal(1), z.literal(0.5), z.literal(0.25)]).default(1).describe('Output size relative to the project size (rounded to even dimensions)'),
    range: z.object({ startFrame: z.number().int().nonnegative(), endFrame: z.number().int().positive() }).strict().optional().describe('Half-open frame range [startFrame, endFrame); default is the whole sequence'),
    frame: z.number().int().nonnegative().optional().describe('Frame index for format=png'),
    variantId: z.string().optional().describe('Export this linked format instead of the master frame size'),
    // shorts (ADR-0018): optional without a default, so the options of every job made before stay as they were
    sequenceId: z.string().optional().describe('Export this sequence of the project (for example a short) instead of the main edit; with variantId, the linked format is applied over it'),
    // segmented export and render cache (ADR-0024). Optional without a default, so the options of every job made before stay as they were.
    mode: z.enum(EXPORT_MODES).optional().describe('single-pass (the default) = one encoder run over every frame; incremental = the fast export: only the segments (2 seconds each, never under 3 frames) whose picture changed since they were stored are rendered, and the segments are joined by stream copy (MP4 only)'),
    selfCheck: z.enum(SELF_CHECK_MODES).optional().describe('incremental only: before rendering, frames of reused segments are rendered again and compared with what was stored; auto (the default) = 3 frames of every reused segment until 20 clean fast exports with this build, then one frame of a sample of them. It proves the frames it checks, nothing more'),
    // send and keep (wave 7, track send). Optional without a default, so the options of every job made before stay as they were.
    sizeFit: z.object({ targetBytes: z.number().int().min(SEND_FIT.minTargetBytes).max(SEND_FIT.maxTargetBytes) }).strict().optional().describe('MP4 only: make the file at or under targetBytes (1 MB = 1,000,000 bytes). The server picks the picture size and bit rates (a labelled heuristic, stated in the plan), encodes the full-quality film once and then to the target in two passes, checks the bytes, retries once, and otherwise fails with size_fit_missed and saves nothing. It promises bytes only, not how any app treats the file'),
    // «שמירת התמונה» (wave 8 cover). Optional without a default, so the options of every job made before stay as they were.
    still: StillExportSchema.optional().describe('Save one source frame of one file as a picture (format png or jpeg) at the stored file\'s own pixels: the whole frame or a crop in source pixels, optionally shaped for a paper. Rendered by the same compositor as the editor (the browser\'s reading of the stored file), cropped afterwards, written without any tags. The owner\'s own session only (403 owner_required for every other credential). Cannot be combined with frame, range, sequenceId, variantId, sizeFit, mode or selfCheck'),
  })
  .strict();
export type ExportOptions = z.infer<typeof ExportOptionsSchema>;
const hideCaptions = (doc: ProjectDocument): ProjectDocument => ({ ...doc, sequences: Object.fromEntries(Object.entries(doc.sequences).map(([id, s]) => [id, { ...s, tracks: s.tracks.map((t) => (t.kind === 'caption' ? { ...t, hidden: true } : t)) }])) });
/** Subtitle file for an export: the first caption track as it plays, shifted and clipped to the exported range. */
function captionSidecar(doc: ProjectDocument, manifest: Manifest): { format: 'srt' | 'vtt'; text: string; cues: number } | null {
  const want = manifest.options.captions;
  if (want !== 'sidecar-srt' && want !== 'sidecar-vtt') return null;
  const seq = doc.sequences[doc.mainSequenceId]!;
  const track = seq.tracks.find((t) => t.kind === 'caption');
  if (!track) return null;
  const rate = manifest.output.frameRate;
  const from = T.frameTime(manifest.output.firstFrame, rate), to = T.frameTime(manifest.output.firstFrame + manifest.output.frames, rate);
  const cues = captionCues(doc, seq, track)
    .map((c) => ({ start: T.max(c.start, from), end: T.min(c.end, to), text: c.text }))
    .filter((c) => T.lt(c.start, c.end))
    .map((c) => ({ start: T.sub(c.start, from), end: T.sub(c.end, from), text: c.text }));
  const format = want === 'sidecar-srt' ? 'srt' : 'vtt';
  return { format, text: format === 'srt' ? serializeSrt(cues) : serializeVtt(cues), cues: cues.length };
}
/**
 * The document a job renders and a segment plan keys (ADR-0024, verifier: the plan route and the export must key the same document):
 * the master or its projected linked format, with caption tracks hidden for a clean picture (sidecar or none).
 */
export function renderDocFor(doc: ProjectDocument, options: Pick<ExportOptions, 'variantId' | 'sequenceId' | 'captions'>): ProjectDocument {
  const resolved = outputDoc(doc, { sequenceId: options.sequenceId, variantId: options.variantId });
  return options.captions === 'burned' ? resolved : hideCaptions(resolved);
}
/**
 * The document an output renders (ADR-0018, ADR-0005): core projectOutput — the sequence alone (default the main one), then its
 * linked format. The ONLY way a route reaches a non-main sequence. An unknown sequence or variant is 404 not_found. The same
 * object for a single-sequence project without a variant.
 */
export function outputDoc(doc: ProjectDocument, t: OutputTarget): ProjectDocument {
  try {
    return projectOutput(doc, { ...(t.sequenceId !== undefined ? { sequenceId: t.sequenceId } : {}), ...(t.variantId ? { variantId: t.variantId } : {}) });
  } catch (e) {
    if (e instanceof OutputTargetError) throw new ApiError(404, 'not_found', e.message, e.details, e.code === 'sequence_not_found' ? 'list_sequences lists the sequences of the project.' : 'get_summary lists the variants.');
    throw e;
  }
}
/** The document to render: the main edit, or the main edit projected into one of its linked formats (outputDoc without a sequence). */
export function variantDoc(doc: ProjectDocument, variantId?: string): ProjectDocument {
  return outputDoc(doc, { variantId });
}
/**
 * How the rendered RGBA frames become the picture a video codec encodes: BT.709, limited range, 4:2:0 (two chroma samples
 * per 2×2 pixels). Exported so a proof can put a still through the same conversion without a codec's loss.
 */
export const EXPORT_PIXEL_FILTER = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p';
/** The colour tags written with it. */
export const EXPORT_COLOR_TAGS = ['-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'] as const;
const CRF = { 'mp4-h264-aac': { draft: 28, standard: 21, high: 16 }, 'webm-vp9-opus': { draft: 40, standard: 32, high: 24 } } as const;
/** Rough bits per pixel per frame, used ONLY for the labelled size estimate. */
const BPP = { draft: 0.03, standard: 0.07, high: 0.14 } as const;
/** `audio`: the audio plan version and the sound-effect runtime (ADR-0010) every route mixes with. */
export const ENGINE = { compositor: 'canvas2d/1', evaluator: 'evaluate/1', audio: `plan/2 ${AUDIO_FX_ENGINE}`, fontFamilies: FONT_CATALOG.map((f) => f.family) } as const;

/** The single-pass encoder of MP4 and WebM: RGBA frames on stdin + the WAV → the file (exported for the metadata test, exportMetadata.test.ts). */
export function singlePassArgs(options: { format: 'mp4-h264-aac' | 'webm-vp9-opus'; quality: 'draft' | 'standard' | 'high'; width: number; height: number; frameRate: { num: number; den: number }; wav: string; outFile: string }): string[] {
  const mp4 = options.format === 'mp4-h264-aac', crf = String(CRF[options.format][options.quality]);
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${options.width}x${options.height}`, '-framerate', `${options.frameRate.num}/${options.frameRate.den}`, '-i', 'pipe:0',
    '-i', options.wav, '-map', '0:v:0', '-map', '1:a:0',
    '-vf', EXPORT_PIXEL_FILTER,
    ...(mp4 ? ['-c:v', 'libx264', '-preset', options.quality === 'draft' ? 'veryfast' : 'medium', '-crf', crf, '-profile:v', 'high'] : ['-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', options.quality === 'high' ? '2' : '4']),
    ...EXPORT_COLOR_TAGS,
    ...(mp4 ? ['-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4'] : ['-c:a', 'libopus', '-b:a', '160k', '-f', 'webm']), options.outFile,
  ];
}
/** Frames of the exported range (relative to it), in the order the render page draws them: [first, first + count). */
export interface FrameRun { first: number; count: number }
/**
 * Receives a segmented session's ordered frame stream (ADR-0024): first the self-check frames, then the frames of the segments
 * to render, as the runs list them. `streamFirst` is the position in that stream, not a frame of the range. The sink owns the
 * encoders, the per-frame hashes and flash cells and the job's stage text; a typed failure it raised is kept in `failure()` so
 * the export reports it (render_cache_self_check_failed), not the page's plain upload error.
 */
export interface SegmentSink {
  accept(streamFirst: number, data: Uint8Array): Promise<void>;
  kill(): void;
  failure(): ApiError | null;
}
export interface RenderSession {
  doc: ProjectDocument;
  revision: number;
  jobId: string | null;
  firstFrame: number;
  outWidth: number;
  outHeight: number;
  frameBytes: number;
  totalFrames: number;
  nextFrame: number;
  sink: ChildProcessWithoutNullStreams | null;
  /** Photosensitivity check of the frames as they are encoded (ADR-0009 decision 4); absent for a still and for a segmented session (its sink keeps the cells of every frame). */
  flash?: FrameFlashCheck;
  /** A segmented session draws only these runs, in this order; `totalFrames` is the sum of their counts. Absent: every frame in order. */
  runs?: FrameRun[];
  /** The segmented export's sink (ADR-0024); a session has either `sink` or `segments`. */
  segments?: SegmentSink | null;
}
/**
 * What the plan needs to know about the incremental route on this machine, synchronously (ADR-0024). Set on the Exporter by the
 * server once the render cache exists; null until then (the fast export is then refused as not available, honestly).
 */
export interface IncrementalRoute {
  status(): RenderCacheStatus;
  /** The last result of the one-time join self-test (exportSegments.incrementalAvailable); null while it has not finished. */
  join(): { ok: true } | { ok: false; reason: string } | null;
}
/**
 * What Exporter.run needs to take the segmented route (ADR-0024), set by the server with the render cache (index.ts). Injected,
 * not imported, so export.ts and exportSegments.ts (which reads export.ts's encoder constants) do not import each other.
 */
export interface SegmentedRoute {
  store: SegmentStore;
  /** The machine, build and encoder part of the keys of this job (renderCacheEnv.ts segmentEnvFor). */
  env(doc: ProjectDocument, manifest: Manifest): Promise<SegmentEnv>;
  /** The engine frame key of one programme frame of `doc` with this env. */
  keyOf(doc: ProjectDocument, manifest: Manifest, env: SegmentEnv): FrameKeyFn;
  run: typeof runSegmentedExport;
}
/** 'auto' resolved (ADR-0024): three frames of every reused segment until the build has made enough clean fast exports, then a sample. */
export const resolveSelfCheck = (mode: ExportOptions['selfCheck'], cleanExports: number): 'sample' | 'every-segment' =>
  mode === 'sample' || mode === 'every-segment' ? mode : cleanExports < AUTO_SELF_CHECK_CLEAN_EXPORTS ? 'every-segment' : 'sample';
const unavailableBlocker = (reason: string): Blocker => ({ code: RENDER_CACHE_BLOCKERS.unavailable.code, message: RENDER_CACHE_BLOCKERS.unavailable.message(reason), ids: [], hint: RENDER_CACHE_BLOCKERS.unavailable.hint });
/** Blockers of a fast export (ADR-0024 plan §1), in the order they are checked, each with its own hint. Empty for a single-pass export. */
export function incrementalBlockers(options: Pick<ExportOptions, 'mode' | 'format'>, route: IncrementalRoute | null): Blocker[] {
  if (options.mode !== 'incremental') return [];
  const B = RENDER_CACHE_BLOCKERS;
  if (options.format !== 'mp4-h264-aac') return [{ code: B.formatUnsupported.code, message: B.formatUnsupported.message(options.format), ids: [], hint: B.formatUnsupported.hint }];
  if (!route) return [unavailableBlocker(INCREMENTAL_NOT_BUILT_REASON)];
  if (route.status().capBytes <= 0) return [{ code: B.cacheDisabled.code, message: B.cacheDisabled.message(), ids: [], hint: B.cacheDisabled.hint }];
  const join = route.join();
  if (!join) return [unavailableBlocker('the check of the segment join has not finished yet; try again in a moment')];
  if (!join.ok) return [unavailableBlocker(join.reason)];
  return [];
}
export interface Manifest {
  revision: number;
  engine: typeof ENGINE & { schemaVersion: number };
  options: ExportOptions;
  output: { width: number; height: number; firstFrame: number; frames: number; frameRate: { num: number; den: number }; sampleRate: number };
  assets: { id: string; contentHash: string; byteSize: number; kind: string; clips: number }[];
  fonts: { family: string; files: { name: string; sha256: string }[] }[];
  /** Effect and transition implementations the render depends on, with their versions. */
  effects: { type: string; version: number; clips: number }[];
  transitions: { type: string; clips: number }[];
  /** Sound effects (ADR-0010) of the clips heard in the exported range (a clip is heard from its start until the end of its tail), with their versions. Empty for formats without sound. */
  audioEffects: { type: string; version: number; clips: number }[];
  /** Labelled estimate, never a promise. */
  estimate: { bytes: number | null; basis: string };
  /** Size-fit (wave 7 send): the planned fit when options.sizeFit is set; the estimate stays the full-quality intermediate's. */
  fit?: SizeFitManifest;
  /** «שמירת התמונה» (wave 8 cover): the picture the still's document draws 1:1 (the stored file's own pixels) and the crop cut from it afterwards (= output size). */
  still?: { source: { width: number; height: number }; crop: StillCrop };
}
/** `hint`: the fix for this blocker when it has one of its own; the refusal then offers it instead of the generic advice. */
export interface Blocker { code: string; message: string; ids: string[]; hint?: string; /** size_fit_too_small only: the smallest target that works for this film (bytes) */ minBytes?: number }

/** The export warnings of library content (wave 7 library track); preflight shows credits_for_description and stock_people as notes. */
export const LIBRARY_EXPORT_CODES = ['non_commercial_content', 'credits_for_description', 'credit_not_on_screen', 'stock_people'] as const;
export const LIBRARY_EXPORT_NOTES: ReadonlySet<string> = new Set(['credits_for_description', 'stock_people']);
const list = (xs: readonly { title: string }[]) => xs.slice(0, 8).map((x) => `"${x.title.slice(0, 60)}"`).join(', ') + (xs.length > 8 ? ` and ${xs.length - 8} more` : '');
/**
 * What the library files of the exported sequence ask of this video (core collectCredits over the document that renders). Nothing
 * here blocks an export: the owner decides; the editor shows the credit lines to paste and the non-commercial warning
 * («לשימוש לא מסחרי בלבד»), and preflight offers add_credits_card for a credit that must appear on screen.
 */
export function libraryExportWarnings(doc: ProjectDocument): Blocker[] {
  const r = collectCredits(doc);
  const out: Blocker[] = [];
  if (r.nonCommercial.length) out.push({ code: 'non_commercial_content', message: `this video holds library material for non-commercial use only (${list(r.nonCommercial)}); it may not be used commercially, and those files are never passed on in a shared archive`, ids: r.nonCommercial.map((n) => n.assetId), hint: 'Keep the video for non-commercial use, or replace those files.' });
  // credits due (never a courtesy line of a licence that needs none) whose place is the description: a reminder with the text to
  // paste, and the credits card offered (never a required fix: the owner decided the card is offered, not added by itself)
  const described = r.lines.filter((l) => l.placement !== 'on_screen' && creditDue(doc, l));
  if (described.length) out.push({ code: 'credits_for_description', message: `${described.length} credit line(s) of library files must go in the video's description: copy them from the credits (GET /api/v1/projects/{id}/credits) when you publish. A credits card at the end can also be added (add_credits_card); it is optional`, ids: described.map((l) => l.assetId) });
  if (r.onScreenMissing.length) out.push({ code: 'credit_not_on_screen', message: `${r.onScreenMissing.length} credit(s) that the licence wants in the video itself appear in no visible title (${list(r.onScreenMissing)})`, ids: r.onScreenMissing.map((l) => l.assetId), hint: 'Add a credits card (add_credits_card), or a title of your own with the credit.' });
  if (r.people.length) out.push({ code: 'stock_people', message: `the video holds stock footage that shows people (${list(r.people)})`, ids: r.people.map((p) => p.assetId) });
  return out;
}
/** The export job's output.licence: the credits of the rendered snapshot, the text written as the <jobId>.credits.txt sidecar. Null when the video holds no library duty. */
export function exportLicence(snapshot: ProjectDocument): (Omit<CreditsView, 'descriptionText'> & { credits: { descriptionText: string; file: string | null } }) | null {
  const view = creditsView(collectCredits(snapshot), 'he');
  if (!view.lines.length && !view.nonCommercial.length && !view.people.length) return null;
  const { descriptionText, ...rest } = view;
  return { ...rest, credits: { descriptionText, file: null } };
}
/** The refusal's hint when no blocker brings its own. */
export const GENERIC_BLOCKER_HINT = 'Fix the listed blockers (relink media, change the font or the range) and try again.';

/** True when any clip of the project carries an effect that runs as a WebGPU pass: such a render needs a worker browser with a graphics adapter (ADR-0008). */
export const usesGpuEffects = (doc: ProjectDocument) => Object.values(doc.sequences).some((q) => q.tracks.some((t) => t.clips.some((c) => ('effects' in c && c.effects?.some((e) => GPU_EFFECT_IDS.includes(e.type))) || ('transition' in c && !!c.transition && GPU_TRANSITION_IDS.includes(c.transition.type)))));

/** The audio plan of the document at the project rate (the server mix's plan) and the exported frames as its samples [a, b). */
interface SoundRange { plan: AudioPlan; a: number; b: number }
const soundRange = (doc: ProjectDocument, firstFrame: number, frames: number): SoundRange => {
  const { frameRate, sampleRate } = doc.settings;
  return { plan: audioPlan(doc), a: T.nearestSampleIndex(T.frameTime(firstFrame, frameRate), sampleRate), b: T.nearestSampleIndex(T.frameTime(firstFrame + frames, frameRate), sampleRate) };
};
/** The clip is heard in samples [a, b): from its start to the end of its tail (soundEnd), as the mix keeps it. */
const sounds = (c: PlannedAudioClip, a: number, b: number) => c.at < b && soundEnd(c) > a;

/**
 * The option rules of a saved picture (wave 8 cover, lead pre-pass, complete): `still` needs format png or jpeg, jpeg needs `still`,
 * a still cannot be combined with STILL_EXCLUSIVE_OPTIONS or a scale other than 1. Until W2 builds the still branch every `still`
 * is also an honest still_not_built blocker. The asset checks (file, picture, frame, size, crop, paper shape) are W2's.
 */
export function stillOptionBlockers(options: Partial<ExportOptions>): Blocker[] {
  const R = STILLS_REFUSALS, out: Blocker[] = [];
  const b = (r: { code: string; hint: string }, message: string) => out.push({ code: r.code, message, ids: [], hint: r.hint });
  if (!options.still) {
    if (options.format === 'jpeg') b(R.jpegNeedsStill, R.jpegNeedsStill.message());
    return out;
  }
  if (options.format !== 'png' && options.format !== 'jpeg') b(R.stillFormat, R.stillFormat.message(String(options.format)));
  for (const k of STILL_EXCLUSIVE_OPTIONS) if (options[k] !== undefined) b(R.stillOptions, R.stillOptions.message(k));
  if (options.scale !== undefined && options.scale !== 1) b(R.stillScale, R.stillScale.message());
  if (!STILL_EXPORT_BUILT) b(R.stillNotBuilt, R.stillNotBuilt.message());
  return out;
}
/**
 * A full-size picture is the owner's own (verify C11; decisions "cover"): every other credential asking for `still` is refused 403
 * owner_required before anything is planned. Called by every route that starts or retries an export: POST …/exports,
 * …/exports/batch (startExportBatch), …/exports/browser, POST /jobs/:id/retry and the MCP tools export_project, export_batch and
 * retry_job. `options` = the raw request options (or the retried job's). The owner's own session = assistant/contract.ts isOwnerSession.
 */
export function assertMayExportStill(p: { kind: 'user' | 'agent'; actor: string }, options: unknown): void {
  const still = !!options && typeof options === 'object' && (options as Record<string, unknown>).still !== undefined;
  if (!still || (p.kind === 'user' && p.actor === 'user:local')) return;
  const r = STILLS_REFUSALS.ownerRequired;
  throw new ApiError(r.status, r.code, r.message(), {}, r.hint);
}

export class Exporter {
  readonly sessions = new Map<string, RenderSession>();
  private queue: Promise<void> = Promise.resolve();
  private cancelRequested = new Set<string>();
  private running: { jobId: string; ff?: { kill(signal?: NodeJS.Signals): boolean }; abort?: () => void } | null = null;
  /** The compute lane (ADR-0017), set by the server: while a server export runs, frame jobs dispatch no new chunk. */
  lane: Pick<ComputeLane, 'setExportActive'> | null = null;
  /** The incremental route (ADR-0024), set by the server when the render cache is wired; null = the fast export is refused as not available. */
  incremental: IncrementalRoute | null = null;
  /** The segmented route itself (ADR-0024), set with `incremental`; null = a fast export job fails honestly as not available. */
  segmented: SegmentedRoute | null = null;
  /**
   * The browser route (browser-export.ts), set when its routes are registered. Every cancel of an export comes here (REST,
   * MCP, editor), and a job a tab renders is handed to the route that holds its lease: the tab learns it from its next
   * heartbeat, stops, discards its partial output and releases the lease.
   */
  browserRoute: { requestCancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string; note?: string } } | null = null;
  /**
   * TEST seam only (wave 7 send, send-decisions C7): set by startServer's second argument (deps.fitFault), never from the
   * environment or a request. Forces the first or every size-fit attempt over the target; the job output labels it TEST.
   */
  fitFault: SizeFitFault | null = null;
  constructor(private store: Store, private host: RenderHost, private renderPageUrl: () => string, private webDist: string) {}

  /**
   * Everything a render depends on, fixed at the moment the job is created (SPEC §9): the document snapshot,
   * the exact asset and font bytes, engine versions and options. Returns blockers instead of starting a render that cannot be faithful.
   * `resolved`: `doc` is ALREADY the document to render (a job's snapshot: a retry, or a job without a manifest), so the sequence and
   * the linked format named in the options are not projected again (wave 8 audiences, verifier C1: a version's rules, such as a size
   * ×4/3, must apply exactly once; no marker in the data says so). The options still describe the output (range, format, scale).
   */
  plan(doc: ProjectDocument, revision: number, raw: unknown, opts: { resolved?: boolean } = {}): { manifest: Manifest; blockers: Blocker[]; warnings: Blocker[] } {
    const parsed = ExportOptionsSchema.safeParse(raw ?? {});
    if (!parsed.success) throw new ApiError(400, 'invalid_request', z.prettifyError(parsed.error), { issues: parsed.error.issues });
    let options = parsed.data;
    // «שמירת התמונה» (wave 8 cover): a still has its own plan (planStill); its option checks stay the lead's (stillOptionBlockers)
    if (options.still) return this.planStill(doc, revision, options);
    const target = { sequenceId: options.sequenceId, variantId: options.variantId };
    const targetWarnings = opts.resolved ? [] : outputWarnings(doc, target);
    if (!opts.resolved) doc = outputDoc(doc, target);
    const { width, height, frameRate, sampleRate } = doc.settings;
    const total = T.frameCount(sequenceDuration(doc), frameRate);
    const blockers: Blocker[] = [];
    const warnings: Blocker[] = [];
    if (targetWarnings.includes('variant_over_sequence_format')) warnings.push({ code: 'variant_over_sequence_format', message: `format variant ${options.variantId} replaces the own frame of sequence ${options.sequenceId}`, ids: [options.sequenceId!, options.variantId!] });
    const even = (n: number) => Math.max(2, Math.round((n * options.scale) / 2) * 2);
    let outWidth = even(width);
    let outHeight = even(height);
    let first = 0;
    let frames = total;
    if (options.format === 'png') {
      first = options.frame ?? 0;
      frames = 1;
      if (first >= Math.max(1, total)) blockers.push({ code: 'out_of_bounds', message: `frame ${first} is outside 0..${total - 1}`, ids: [] });
    } else if (options.range) {
      first = options.range.startFrame;
      frames = Math.min(options.range.endFrame, total) - first;
      if (frames <= 0) blockers.push({ code: 'empty_range', message: `range [${options.range.startFrame}, ${options.range.endFrame}) contains no frames (sequence has ${total})`, ids: [] });
    }
    if (total === 0) blockers.push({ code: 'empty_sequence', message: 'the sequence has no clips to export', ids: [] });
    // «שמירת התמונה» (wave 8 cover): without `still` only "jpeg needs a still" can come from here; a still is planned by planStill
    blockers.push(...stillOptionBlockers(options));
    // size-fit (wave 7 send, C4–C6): the plan picks the picture size (never above the asked scale) and the rates; the job then
    // renders the full-quality intermediate at that size (quality high) and fits it. Segment keys see only quality, size and frames,
    // so a fit export keys exactly as a plain high-quality export at the fitted scale (sizeFit.test.ts).
    let fit: SizeFitManifest | undefined;
    if (options.sizeFit && SIZE_FIT_BUILT) {
      const F = SEND_API_REFUSALS;
      if (options.format !== 'mp4-h264-aac') blockers.push({ code: F.sizeFitFormat.code, message: F.sizeFitFormat.message(options.format), ids: [], hint: F.sizeFitFormat.hint });
      else if (frames > 0) {
        const p = planSizeFit({ targetBytes: options.sizeFit.targetBytes, frames, rate: frameRate, width, height, sampleRate, maxScale: options.scale });
        if (!p.ok) blockers.push({ code: F.sizeFitTooSmall.code, message: F.sizeFitTooSmall.message(options.sizeFit.targetBytes, p.minBytes), ids: [], hint: F.sizeFitTooSmall.hint, minBytes: p.minBytes });
        else {
          options = { ...options, scale: p.scale, quality: 'high' };
          outWidth = p.width; outHeight = p.height;
          fit = { targetBytes: options.sizeFit!.targetBytes, scale: p.scale, width: p.width, height: p.height, videoBitrate: p.videoBitrate, audioBitrate: p.audioBitrate, overheadBytes: p.overheadBytes, bitsPerPixelFrame: p.bitsPerPixelFrame, basis: p.basis };
        }
      }
    }
    // life line (ADR-0021): a title field without data would silently leave out words the author placed, so it stops an export of
    // moving picture, like a missing font. A still is never stopped (the editor's own frames must draw, with the field empty),
    // and sound alone has no titles. The preflight report lists the same issues with their frame ranges (preflight.ts).
    if (options.format !== 'png' && options.format !== 'wav')
      for (const i of fieldIssues(doc, { startFrame: first, endFrame: first + Math.max(0, frames) })) {
        if (i.severity === 'blocker') blockers.push({ code: i.code, message: i.message, ids: i.ids });
        else if (i.severity === 'warning') warnings.push({ code: i.code, message: i.message, ids: i.ids });
      }
    const seq = doc.sequences[doc.mainSequenceId]!;
    const used = new Map<string, number>();
    const families = new Set<string>();
    const from = T.frameTime(first, frameRate);
    const to = T.frameTime(first + Math.max(0, frames), frameRate);
    const fxUsed = new Map<string, number>(), trUsed = new Map<string, number>();
    // The sound of the range (none in a GIF or a still): the audio plan every mix follows, and the range in its samples.
    const sound = options.format === 'gif' || options.format === 'png' ? null : soundRange(doc, first, Math.max(0, frames));
    const drawn = new Set<string>(); // media clips counted below
    for (const tr of seq.tracks)
      for (const c of tr.clips) {
        // A clip is drawn until its end, and beyond it while the clip that follows on its track comes in over it with a transition:
        // `evaluate` draws it as the outgoing picture of those frames, with its own effects (and their colour tables).
        let end = T.add(c.start, c.duration);
        const next = c.type === 'media' ? tr.clips.find((n) => n.type === 'media' && n.id !== c.id && !!n.transition && T.eq(n.start, end)) : undefined;
        if (next?.type === 'media' && next.transition) end = T.add(end, T.frameTime(next.transition.frames, frameRate));
        if (!T.lt(c.start, to) || !T.lt(from, end)) continue; // outside the exported range
        if (c.type === 'media') { used.set(c.assetId, (used.get(c.assetId) ?? 0) + 1); drawn.add(c.id); }
        for (const fx of c.effects ?? []) if (fx.enabled) {
          fxUsed.set(fx.type, (fxUsed.get(fx.type) ?? 0) + 1);
          // A colour table named by a colour-table effect is source material of the render like any clip's file.
          const table = lutRef(fx);
          if (table) used.set(table, (used.get(table) ?? 0) + 1);
        }
        if (c.type === 'media' && c.transition) trUsed.set(c.transition.type, (trUsed.get(c.transition.type) ?? 0) + 1);
        else if (c.type === 'text') families.add(c.style.fontFamily);
        if (tr.caption) families.add(tr.caption.style.fontFamily);
      }
    // A clip with sound effects sounds until the end of its tail (ADR-0010), and in a range that starts in its echo the mix still
    // runs its voice, which reads the clip's source from before the range. That source is pinned and checked like any clip's file.
    if (sound) for (const c of sound.plan.clips) if (c.voice && !drawn.has(c.clipId) && sounds(c, sound.a, sound.b)) used.set(c.assetId, (used.get(c.assetId) ?? 0) + 1);
    const assets = [...used].flatMap(([id, clips]) => {
      const a = Object.hasOwn(doc.assets, id) ? doc.assets[id] : undefined;
      if (!a) { blockers.push({ code: 'missing_media', message: `colour table ${id} named by an effect is not in the project library`, ids: [id] }); return []; }
      if (!blobPresent(this.store, a)) blockers.push({ code: 'missing_media', message: `source media for "${a.name}" is not available to the render worker`, ids: [id], hint: MISSING_MEDIA_HINT });
      return [{ id, contentHash: a.contentHash, byteSize: a.byteSize, kind: a.kind, clips }];
    });
    for (const fam of families) if (!ENGINE.fontFamilies.includes(fam)) blockers.push({ code: 'missing_font', message: `font "${fam}" is not bundled with the renderer; text would silently fall back`, ids: [] });
    const fonts = [...families].filter((f) => ENGINE.fontFamilies.includes(f)).map((family) => ({ family, files: this.fontFiles(family) }));
    if (fonts.some((f) => f.files.length === 0)) blockers.push({ code: 'renderer_unavailable', message: 'the web bundle with the render page and fonts has not been built (run `pnpm build`)', ids: [] });
    if (options.format === 'gif') {
      const seq0 = doc.sequences[doc.mainSequenceId]!;
      if (seq0.tracks.some((t) => t.kind === 'audio' && !t.muted && t.clips.length > 0)) warnings.push({ code: 'gif_has_no_sound', message: 'GIF cannot carry sound; the export will be silent', ids: [] });
      if (outWidth * outHeight * Math.max(0, frames) > 640 * 360 * 600) warnings.push({ code: 'gif_large', message: 'this GIF will be large and limited to 256 colours per frame; consider a shorter range or scale 0.5', ids: [] });
    }
    blockers.push(...incrementalBlockers(options, this.incremental));
    // size-fit (wave 7 send): an honest blocker while the fit plan is not built (SIZE_FIT_BUILT false)
    if (options.sizeFit && !SIZE_FIT_BUILT) blockers.push({ code: SEND_API_REFUSALS.sizeFitNotBuilt.code, message: SEND_API_REFUSALS.sizeFitNotBuilt.message(), ids: [], hint: SEND_API_REFUSALS.sizeFitNotBuilt.hint });
    if (options.captions.startsWith('sidecar') && !doc.sequences[doc.mainSequenceId]!.tracks.some((t) => t.kind === 'caption')) warnings.push({ code: 'no_captions', message: 'a caption file was requested but the project has no caption track; none will be written', ids: [] });
    if (options.format === 'webm-vp9-opus' && doc.settings.sampleRate !== 48000) warnings.push({ code: 'resampled_audio', message: 'Opus is encoded at 48 kHz; audio will be resampled', ids: [] });
    warnings.push(...libraryExportWarnings(doc));
    const effects = [...fxUsed].map(([type, clips]) => ({ type, version: findEffect(type)?.version ?? 0, clips }));
    for (const fx of effects) if (fx.version === 0) blockers.push({ code: 'unknown_effect', message: `effect "${fx.type}" is not available in this renderer; exporting would silently drop it`, ids: [] });
    const transitions = [...trUsed].map(([type, clips]) => ({ type, clips }));
    const audioEffects = sound ? this.planSound(sound, first + Math.max(0, frames) >= total, blockers, warnings) : [];
    const seconds = (frames * frameRate.den) / frameRate.num;
    const video = options.format === 'mp4-h264-aac' || options.format === 'webm-vp9-opus';
    const estimate = video
      ? { bytes: Math.round((outWidth * outHeight * frames * BPP[options.quality]) / 8 + seconds * 24_000), basis: 'heuristic bits-per-pixel for the chosen quality; real size depends on content' }
      : options.format === 'wav' ? { bytes: Math.round(seconds * sampleRate * 4 + 44), basis: 'exact for 16-bit stereo PCM' } : { bytes: null, basis: 'not estimated for stills' };
    return {
      manifest: { revision, engine: { ...ENGINE, schemaVersion: doc.schemaVersion }, options, output: { width: outWidth, height: outHeight, firstFrame: first, frames: Math.max(0, frames), frameRate, sampleRate }, assets, fonts, effects, transitions, audioEffects, estimate, ...(fit ? { fit } : {}) },
      blockers, warnings,
    };
  }
  /**
   * The plan of a saved picture (wave 8 cover, verify C5/C7/C8): the asset must be in the document (404 not_found otherwise, as
   * other routes); core stillDocument's refusals (no picture, frame outside the file, a side over 8192) and the crop rules
   * (inside the picture; the paper's shape within one pixel when a paper is given) are blockers with their hints. The output is
   * the crop's own size (no even rounding); the render draws the still's document at the file's own size and the crop is cut
   * afterwards. A job snapshots stillDocument(asset, frame) (start), never the project: the same asset and frame always give the
   * same document, and a retry renders its snapshot again. Nothing here reads the source's pixels.
   */
  private planStill(doc: ProjectDocument, revision: number, options: ExportOptions): { manifest: Manifest; blockers: Blocker[]; warnings: Blocker[] } {
    const s = options.still!;
    const R = STILLS_REFUSALS;
    const blockers: Blocker[] = [...stillOptionBlockers(options)];
    const asset: Asset | undefined = Object.hasOwn(doc.assets, s.assetId) ? doc.assets[s.assetId] : undefined;
    if (!asset) throw new ApiError(404, 'not_found', `asset ${s.assetId} not found`, { assetId: s.assetId });
    let stillDoc: ProjectDocument | undefined;
    try { stillDoc = stillDocument(asset, s.sourceFrame); } catch (e) {
      if (!(e instanceof StillsRefusal)) throw e;
      blockers.push({ code: e.code, message: e.message, ids: [asset.id], hint: e.hint });
    }
    const width = stillDoc?.settings.width ?? 0, height = stillDoc?.settings.height ?? 0;
    const crop: StillCrop = s.crop ?? { x: 0, y: 0, w: width, h: height };
    if (stillDoc) {
      if (s.crop && (s.crop.x + s.crop.w > width || s.crop.y + s.crop.h > height)) blockers.push({ code: R.stillCrop.code, message: R.stillCrop.message(width, height), ids: [asset.id], hint: R.stillCrop.hint });
      else if (s.paper && s.orientation && !cropFitsPaper(crop, s.paper, s.orientation)) blockers.push({ code: R.stillPaperShape.code, message: R.stillPaperShape.message(s.paper, s.orientation), ids: [asset.id], hint: R.stillPaperShape.hint });
    }
    if (!blobPresent(this.store, asset)) blockers.push({ code: 'missing_media', message: `source media for "${asset.name}" is not available to the render worker`, ids: [asset.id], hint: MISSING_MEDIA_HINT });
    if (!fs.existsSync(path.join(this.webDist, 'render.html'))) blockers.push({ code: 'renderer_unavailable', message: 'the web bundle with the render page has not been built (run `pnpm build`)', ids: [] });
    const frameRate = stillDoc?.settings.frameRate ?? doc.settings.frameRate;
    return {
      manifest: {
        revision, engine: { ...ENGINE, schemaVersion: doc.schemaVersion }, options,
        output: { width: crop.w, height: crop.h, firstFrame: 0, frames: 1, frameRate, sampleRate: doc.settings.sampleRate },
        assets: [{ id: asset.id, contentHash: asset.contentHash, byteSize: asset.byteSize, kind: asset.kind, clips: 1 }],
        fonts: [], effects: [], transitions: [], audioEffects: [], estimate: { bytes: null, basis: 'not estimated for stills' },
        still: { source: { width, height }, crop },
      },
      blockers, warnings: [],
    };
  }
  /**
   * Sound effects of the exported range (ADR-0010): which effect implementations the mix depends on, a blocker for any effect this
   * build cannot run (it would otherwise be dropped silently) and a warning for each echo or reverb cut at the end of the video.
   */
  private planSound({ plan: ap, a, b }: SoundRange, reachesEnd: boolean, blockers: Blocker[], warnings: Blocker[]): Manifest['audioEffects'] {
    const used = new Map<string, { type: string; version: number; clips: number }>();
    for (const c of ap.clips) {
      if (!c.voice || !sounds(c, a, b)) continue;
      for (const fx of c.voice.chain) {
        const key = `${fx.type}@${fx.version}`;
        const u = used.get(key) ?? { type: fx.type, version: fx.version, clips: 0 };
        u.clips++;
        used.set(key, u);
      }
    }
    // An effect that cannot run may have any tail, so it blocks whenever its clip starts before the end of the range.
    const at = new Map(ap.clips.map((c) => [c.clipId, c.at]));
    for (const m of ap.missingFx) {
      const start = at.get(m.clipId);
      if (start !== undefined && start >= b) continue;
      blockers.push({ code: 'unknown_audio_effect', message: `sound effect "${m.type}"${m.version ? ` (version ${m.version})` : ''} on clip ${m.clipId} is not available in this build${m.version ? ' for this clip' : ''}; exporting would silently drop it`, ids: [m.clipId] });
    }
    if (reachesEnd) for (const t of ap.cutTails) warnings.push({ code: 'audio_tail_cut', message: `the echo or reverb of clip ${t.clipId} would ring on ${t.seconds} s past the end of the video; it is cut there with a short fade (the video is not made longer)`, ids: [t.clipId] });
    return [...used.values()].sort((x, y) => (x.type < y.type ? -1 : x.type > y.type ? 1 : x.version - y.version));
  }
  /** The hash of a bundled family's font files for the frame key (ADR-0024); null when the family is not bundled or the bundle is not built. */
  fontHash(family: string): string | null {
    if (!ENGINE.fontFamilies.includes(family)) return null;
    const files = this.fontFiles(family);
    return files.length ? createHash('sha256').update(JSON.stringify(files)).digest('hex') : null;
  }
  private fontCache = new Map<string, { name: string; sha256: string }[]>();
  private fontFiles(family: string) {
    let f = this.fontCache.get(family);
    if (!f || f.length === 0) {
      const dir = path.join(this.webDist, 'assets');
      const prefix = `${findFont(family)?.slug ?? family.toLowerCase()}-`;
      f = !fs.existsSync(dir) ? [] : fs.readdirSync(dir).filter((n) => n.startsWith(prefix) && n.endsWith('.woff2')).sort().map((name) => ({ name, sha256: createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex') }));
      this.fontCache.set(family, f);
    }
    return f;
  }
  /**
   * Create the durable job (or refuse with the blockers). The single entry point for UI, REST and MCP.
   * `roomChecked`: the caller has just made the storage check below for a whole group of jobs (the batch route); repeating it per
   * job could refuse a later job of the group after the first was created, when the ceiling is within a few kilobytes.
   */
  start(projectId: string, actor: string, rawOptions: unknown, retryOf?: JobRow, opts: { roomChecked?: boolean } = {}): JobRow {
    // The output size is not known in advance, so an export (or a retry, which writes a new file) is refused once the storage
    // ceiling is reached. Checked here rather than in the route: the REST route, the batch route, retries and the MCP tool all
    // start exports through this function (the MCP tool used to skip the check that only the REST route made).
    if (!opts.roomChecked) assertStorageRoom(this.store, 1, retryOf ? 'retry this export' : 'start an export');
    const p = retryOf ? { doc: retryOf.input.snapshot as ProjectDocument, revision: retryOf.input.revision as number } : this.store.getProject(projectId);
    // a retry plans its snapshot as it is (resolved): the snapshot is already the projected document (C1); the target warning the
    // first plan gave (variant_over_sequence_format) is carried over, since the snapshot no longer shows the sequence's own frame
    const { manifest, blockers, warnings } = this.plan(p.doc, p.revision, retryOf ? retryOf.input.manifest.options : rawOptions, { resolved: !!retryOf });
    if (retryOf) for (const w of (retryOf.input.warnings ?? []) as Blocker[]) if ((OUTPUT_WARNINGS as readonly string[]).includes(w.code) && !warnings.some((x) => x.code === w.code)) warnings.unshift(w);
    if (blockers.length) throw new ApiError(422, 'render_blocked', `export cannot start: ${blockers[0]!.message}`, { blockers, warnings }, blockers[0]!.hint ?? GENERIC_BLOCKER_HINT);
    // size-fit (C6): the full-quality intermediate and the fitted file live side by side until the publish; ask room for both now
    if (manifest.fit) assertStorageRoom(this.store, (manifest.estimate.bytes ?? 0) + manifest.fit.targetBytes, retryOf ? 'retry this export' : 'start an export at a target size');
    // A variant export snapshots the PROJECTED document, so the job renders exactly what was planned even if the variant changes later.
    // Snapshot what will be rendered. For a clean picture, caption tracks are hidden in the snapshot; a requested subtitle file
    // is fixed now from the same document, so later edits cannot change it.
    // A saved picture (wave 8 cover) snapshots its one-clip document (core stillDocument), never the project, and has no subtitle file.
    const still = manifest.options.still;
    const stillDoc = !retryOf && still ? stillDocument(p.doc.assets[still.assetId]!, still.sourceFrame) : undefined;
    const resolved = retryOf || stillDoc ? p.doc : outputDoc(p.doc, { sequenceId: manifest.options.sequenceId, variantId: manifest.options.variantId });
    const snapshot = retryOf ? p.doc : stillDoc ?? renderDocFor(p.doc, manifest.options);
    const sidecar = retryOf ? retryOf.input.sidecar ?? null : stillDoc ? null : captionSidecar(resolved, manifest);
    const job = this.store.createJob(projectId, 'export', actor, { revision: p.revision, snapshot, sidecar, manifest, warnings, retryOf: retryOf?.id ?? null });
    this.enqueue(job);
    return job;
  }
  retry(jobId: string, actor: string): JobRow {
    const j = this.store.getJob(jobId);
    if (j.type !== 'export') throw new ApiError(409, 'retry_not_supported', `retrying ${j.type} jobs is not supported`);
    if (!['failed', 'canceled'].includes(j.status)) throw new ApiError(409, 'job_not_retryable', `job is ${j.status}`, { status: j.status });
    // The project's render cache was purged for privacy while this export ran: its snapshot shows what the owner has since hidden,
    // so no route may render it again (ADR-0024). A new export renders the project with its current privacy regions.
    if (j.error?.code === RENDER_CACHE_PURGED.code) throw new ApiError(409, RENDER_CACHE_PURGED.code, 'this export was stopped because the project\'s privacy regions changed while it ran; retrying it would render the old picture again', { jobId, projectId: j.projectId, retryable: false }, RENDER_CACHE_PURGED.hint);
    return this.start(j.projectId, actor, undefined, j); // same immutable snapshot and options, new job id
  }
  /** Queued: removed. Running: encoder and render page are stopped and partial output deleted. A browser-route job: its tab is told to stop. */
  cancel(jobId: string, actor: string) {
    const j = this.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    if (j.input?.route === 'browser') {
      if (this.browserRoute) return this.browserRoute.requestCancel(jobId, actor);
      // no browser route in this process, so no tab can hold a lease here: nothing to wait for
      this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor}; no tab held the lease`, retryable: true } });
      return { jobId, status: 'canceled', outcome: 'no-live-lease' };
    }
    this.cancelRequested.add(jobId);
    if (j.status === 'queued') { this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started` } }); return { jobId, status: 'canceled', outcome: 'removed-from-queue' }; }
    this.store.updateJob(jobId, { status: 'cancel-requested' });
    if (this.running?.jobId === jobId) { this.running.ff?.kill('SIGKILL'); this.running.abort?.(); }
    return { jobId, status: 'cancel-requested', outcome: 'stopping' };
  }

  /**
   * A render session. `runs` (segmented export, ADR-0024): the page draws only those frames of the range, in that order, and the
   * session counts the sum of their counts; each run must lie inside the range.
   */
  open(doc: ProjectDocument, revision: number, jobId: string | null, out: { width: number; height: number; firstFrame: number; frames: number }, runs?: readonly FrameRun[]): { token: string; session: RenderSession; url: string } {
    if (!fs.existsSync(path.join(this.webDist, 'render.html')))
      throw new ApiError(503, 'renderer_unavailable', 'the web bundle containing the render page has not been built', {}, 'Run `pnpm build` and retry.');
    if (runs) for (const r of runs) if (!Number.isInteger(r.first) || !Number.isInteger(r.count) || r.first < 0 || r.count < 1 || r.first + r.count > out.frames) throw new Error(`render run [${r.first}, ${r.first + r.count}) is outside the range of ${out.frames} frames`);
    const token = randomBytes(24).toString('base64url');
    const totalFrames = runs ? runs.reduce((n, r) => n + r.count, 0) : out.frames;
    const session: RenderSession = { doc, revision, jobId, firstFrame: out.firstFrame, outWidth: out.width, outHeight: out.height, frameBytes: out.width * out.height * 4, totalFrames, nextFrame: 0, sink: null, ...(runs ? { runs: runs.map((r) => ({ first: r.first, count: r.count })), segments: null } : {}) };
    this.sessions.set(token, session);
    return { token, session, url: `${this.renderPageUrl()}#token=${token}` };
  }

  /** Agent sense / parity reference: one frame through the same compositor as export, as PNG. */
  async renderStill(doc: ProjectDocument, revision: number, frameIndex: number, scale: 1 | 0.5 | 0.25 = 1): Promise<Buffer> {
    const { manifest, blockers } = this.plan(doc, revision, { format: 'png', frame: frameIndex, scale });
    const hard = blockers.filter((b) => b.code !== 'empty_sequence');
    if (hard.length) throw new ApiError(422, hard[0]!.code === 'out_of_bounds' ? 'out_of_bounds' : 'render_blocked', hard[0]!.message, { blockers: hard }, hard[0]!.hint);
    return this.pageStill(doc, revision, null, { width: manifest.output.width, height: manifest.output.height, firstFrame: frameIndex });
  }
  /**
   * One frame of `doc` drawn by the render page (the shared evaluate + compositor) as PNG at exactly width × height: renderStill
   * (agents' render_frame, the PNG export) and the saved picture (wave 8 cover: its document at the file's own, possibly odd, size).
   */
  private async pageStill(doc: ProjectDocument, revision: number, jobId: string | null, out: { width: number; height: number; firstFrame: number }): Promise<Buffer> {
    const { token, url } = this.open(doc, revision, jobId, { ...out, frames: 1 });
    try {
      // Stills are reachable with a read-only credential and each opens a browser page: run at most two at a time.
      return await stillLimit(() => this.host.renderStill(url, 0, { gpu: usesGpuEffects(doc) }));
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      // A renderer that went away (shutdown, crashed page) is an unavailable dependency, not an unexplained server error.
      throw new ApiError(503, 'renderer_unavailable', `the render worker could not produce the frame: ${String(e?.message ?? e).slice(0, 200)}`);
    } finally {
      this.sessions.delete(token);
    }
  }

  enqueue(job: JobRow) {
    // One export at a time in the local profile (bounded CPU/memory); order preserved.
    this.queue = this.queue.then(() => this.run(job.id)).catch(() => {});
  }

  /** Frames posted by the render page. Enforces order, size and backpressure into the encoder. */
  async acceptFrames(token: string, first: number, data: Uint8Array): Promise<void> {
    const s = this.sessions.get(token);
    // A segmented session has no encoder of its own: its sink takes the frames (ADR-0024).
    if (!s || (!s.sink && !s.segments)) throw new ApiError(404, 'render_session_not_found', 'unknown render session');
    if (first !== s.nextFrame) throw new ApiError(409, 'frame_out_of_order', `expected frame ${s.nextFrame}, got ${first}`);
    if (data.length === 0 || data.length % s.frameBytes !== 0) throw new ApiError(400, 'bad_frame_size', 'payload is not a whole number of RGBA frames');
    const count = data.length / s.frameBytes;
    if (s.nextFrame + count > s.totalFrames) throw new ApiError(400, 'too_many_frames', 'more frames than the snapshot contains');
    s.nextFrame += count;
    if (s.segments) { await s.segments.accept(first, data); return; } // the sink checks, encodes, hashes and words the stage
    s.flash?.feed(data); // the frames the file will hold, checked for flashing as they pass (never changes or blocks the export)
    const sink = s.sink!;
    // The encoder going away means the job was canceled or failed: a typed conflict, not a server error. It may already be
    // gone when the frames arrive (a write to a closed pipe reports nothing further), so that is checked first, and the
    // encoder exiting while a write waits for room ends the wait.
    const closed = () => new ApiError(409, 'render_session_closed', 'the encoder for this render session has stopped');
    if (sink.exitCode !== null || sink.signalCode !== null || sink.killed || sink.stdin.destroyed || !sink.stdin.writable) throw closed();
    await new Promise<void>((resolve, reject) => {
      const off = () => { sink.stdin.off('error', onErr); sink.off('close', onErr); sink.stdin.off('drain', done); };
      const onErr = () => { off(); reject(closed()); };
      const done = () => { off(); resolve(); };
      sink.stdin.once('error', onErr);
      sink.once('close', onErr);
      if (sink.stdin.write(data)) done();
      else sink.stdin.once('drain', done);
    });
    if (s.jobId) this.store.updateJob(s.jobId, { stage: `rendering ${s.nextFrame}/${s.totalFrames}` });
  }

  /**
   * Sample-exact audio mix of the snapshot as a WAV file (separate stream from video), following the shared audio plan.
   * The mix writes a 32-bit float stereo file and then the 16-bit WAV, both in the data directory, before the float one is
   * removed: under a storage ceiling that room is asked for first, so an export stops with a typed 507 and publishes nothing
   * instead of passing the ceiling (lead run 2026-11-18, proof:incremental I11d: 31 MB over the start for a 60 s mix).
   */
  private renderAudio(doc: ProjectDocument, firstSample: number, totalSamples: number, outFile: string, isCanceled: () => boolean) {
    const plan = audioPlan(doc);
    assertStorageRoom(this.store, mixRoomBytes(plan, totalSamples), 'mix the sound of this export');
    return renderMix(plan, (assetId) => this.store.blobPath(doc.assets[assetId]!.contentHash), firstSample, totalSamples, outFile, isCanceled, (assetId) => timeOriginSeconds(doc.assets[assetId]), (assetId) => doc.assets[assetId]?.audio?.channels === 1);
  }

  private async run(jobId: string) {
    const job = this.store.getJob(jobId);
    if (job.status !== 'queued') return;
    const attempt = job.attempt + 1;
    this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt });
    const work = path.join(this.store.tmpDir, `${jobId}_${attempt}`);
    fs.mkdirSync(work, { recursive: true });
    const doc: ProjectDocument = job.input.snapshot;
    // Jobs created before manifests existed (or recovered ones) get a default plan from their own snapshot.
    const manifest: Manifest = job.input.manifest ?? this.plan(doc, job.input.revision, {}, { resolved: true }).manifest;
    const { options, output } = manifest;
    let token: string | undefined;
    let flashReport: PhotosensitivityReport | null = null;
    const started = Date.now();
    const canceled = () => this.cancelRequested.has(jobId);
    this.running = { jobId };
    this.lane?.setExportActive(true);
    try {
      // The manifest is re-verified at run time: bytes must still be the ones the job was planned against.
      for (const a of manifest.assets) {
        if (!blobPresent(this.store, a)) throw new ApiError(422, 'render_blocked', `source media ${a.id} is no longer available`, { blockers: [{ code: 'missing_media', ids: [a.id] }] }, MISSING_MEDIA_HINT);
      }
      const { frameRate, sampleRate } = output;
      const ext = { 'mp4-h264-aac': 'mp4', 'webm-vp9-opus': 'webm', gif: 'gif', wav: 'wav', png: 'png', jpeg: 'jpg' }[options.format];
      const partial = path.join(work, `out.${ext}`);
      const final = path.join(this.store.outDir, `${jobId}.${ext}`);
      const firstSample = T.nearestSampleIndex(T.frameTime(output.firstFrame, frameRate), sampleRate);
      const totalSamples = T.nearestSampleIndex(T.frameTime(output.firstFrame + output.frames, frameRate), sampleRate) - firstSample;
      let audioClips = 0;
      let audioMix: MixResult | null = null;
      let renderStageMs: unknown = null;
      let validation: Record<string, unknown>;
      let segmentsReport: SegmentedExportReport | null = null;
      let stillOut: StillOutput | null = null;
      // Picture checks (wave 7 send, C10): fed with the flash check's own cells on both routes; report only, never blocks.
      const picture = pictureCheckFor(doc, options.format, output);

      // The fast export runs only through the segmented route (ADR-0024), which is wired after its workers; until then a job asking
      // for it (planning refuses it, so only a hand-made job could) fails honestly instead of being exported another way.
      if (options.still) {
        // «שמירת התמונה» (wave 8 cover, C5/C7/C10): the still's document drawn 1:1 by the render page (never an ffmpeg decode of the
        // source), the lossless PNG cropped by ffmpeg and encoded without metadata, then checked (codec, size, tags, chunks).
        const st = manifest.still!, asset = doc.assets[options.still.assetId]!;
        this.store.updateJob(jobId, { stage: 'rendering still' });
        const rendered = path.join(work, 'rendered.png');
        fs.writeFileSync(rendered, await this.pageStill(doc, job.input.revision, jobId, { width: st.source.width, height: st.source.height, firstFrame: 0 }));
        if (canceled()) throw new Error('canceled');
        this.store.updateJob(jobId, { stage: 'checking the export' });
        const format = options.format === 'jpeg' ? 'jpeg' : 'png';
        validation = { ...(await writeStillFile({ renderedPng: rendered, crop: st.crop, format, outFile: partial, onProcess: (p) => { if (this.running) this.running.ff = p ?? undefined; } })), source: st.source };
        stillOut = stillOutputOf(asset, options.still, st, format);
      } else if (options.mode === 'incremental') {
        // The segmented route (ADR-0024): the same snapshot, the same render page and compositor, only the changed segments rendered.
        const seg = this.segmented;
        const b = !seg ? unavailableBlocker(INCREMENTAL_NOT_BUILT_REASON) : incrementalBlockers(options, this.incremental)[0];
        if (b) throw new ApiError(422, 'render_blocked', b.message, { blockers: [b] }, b.hint ?? GENERIC_BLOCKER_HINT);
        const env = await seg!.env(doc, manifest);
        if (canceled()) throw new Error('canceled');
        const result = await seg!.run({
          doc, manifest, projectId: job.projectId, jobId, attempt, env, store: seg!.store, keyOf: seg!.keyOf(doc, manifest, env),
          selfCheck: resolveSelfCheck(options.selfCheck, seg!.store.cleanSelfChecks(env.engine)), workDir: work, outFile: partial,
          render: async (runs, sink, onAbort) => {
            const opened = this.open(doc, job.input.revision, jobId, { width: output.width, height: output.height, firstFrame: output.firstFrame, frames: output.frames }, runs);
            token = opened.token;
            opened.session.segments = sink;
            try {
              const stats = await this.host.renderAll(opened.url, (abort) => { if (this.running) this.running.abort = abort; onAbort(abort); }, { gpu: usesGpuEffects(doc) });
              return { stageMs: stats.stageMs };
            } finally { this.sessions.delete(opened.token); token = undefined; }
          },
          mixAudio: (wavFile) => this.renderAudio(doc, firstSample, totalSamples, wavFile, canceled),
          ...(picture ? { onCells: (c: FlashCells) => picture.feed(c) } : {}),
          canceled,
          stage: (text) => this.store.updateJob(jobId, { stage: text }),
          onProcess: (p) => { if (this.running) this.running.ff = p ?? undefined; },
        });
        audioMix = result.audio;
        audioClips = result.audio.clips;
        flashReport = result.photosensitivity;
        renderStageMs = result.renderStageMs;
        validation = result.validation;
        segmentsReport = result.report;
      } else if (options.format === 'png') {
        this.store.updateJob(jobId, { stage: 'rendering still' });
        fs.writeFileSync(partial, await this.renderStill(doc, job.input.revision, output.firstFrame, options.scale));
        const p = await ffprobe(partial);
        validation = { codec: p.streams[0]?.codec_name, width: p.streams[0]?.width, height: p.streams[0]?.height, frame: output.firstFrame };
        if (validation.codec !== 'png' || validation.width !== output.width || validation.height !== output.height) throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
      } else {
        const wav = options.format === 'wav' ? partial : path.join(work, 'mix.wav');
        const gif = options.format === 'gif';
        if (!gif) {
          this.store.updateJob(jobId, { stage: 'rendering audio' });
          audioMix = await this.renderAudio(doc, firstSample, totalSamples, wav, canceled);
          audioClips = audioMix.clips;
          if (canceled()) throw new Error('canceled');
        }
        if (options.format === 'wav') {
          const p = await ffprobe(partial);
          const a = p.streams.find((x: any) => x.codec_type === 'audio');
          validation = { audioCodec: a?.codec_name, audioSampleRate: Number(a?.sample_rate), channels: a?.channels, samples: Number(a?.duration_ts), expectedSamples: totalSamples };
          if (validation.samples !== totalSamples) throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
        } else {
          const opened = this.open(doc, job.input.revision, jobId, { width: output.width, height: output.height, firstFrame: output.firstFrame, frames: output.frames });
          token = opened.token;
          const s = opened.session;
          if (output.frames > 1) s.flash = new FrameFlashCheck(output.width, output.height, frameRate, picture ? (c) => picture.feed(c) : undefined);
          const mp4 = options.format === 'mp4-h264-aac';
          const ff = spawn('ffmpeg', gif ? [
            '-hide_banner', '-v', 'error', '-y',
            '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${output.width}x${output.height}`, '-framerate', `${frameRate.num}/${frameRate.den}`, '-i', 'pipe:0',
            // One palette for the whole clip, then ordered dithering: stable colours from frame to frame.
            '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4', '-loop', '0', '-f', 'gif', partial,
          ] : singlePassArgs({ format: options.format as 'mp4-h264-aac' | 'webm-vp9-opus', quality: options.quality, width: output.width, height: output.height, frameRate, wav, outFile: partial }));
          this.running.ff = ff;
          let stderr = '';
          ff.stderr.on('data', (d) => (stderr += d));
          ff.stdin.on('error', () => {});
          const exited = new Promise<number>((res) => ff.on('close', (code) => res(code ?? -1)));
          s.sink = ff;
          this.store.updateJob(jobId, { stage: `rendering 0/${s.totalFrames}` });
          // A cancel that arrived while the render page was still being opened found nothing to abort: stop the page as soon as it can be stopped.
          const render = this.host.renderAll(opened.url, (abort) => { if (this.running) this.running.abort = abort; if (canceled()) abort(); }, { gpu: usesGpuEffects(doc) });
          const stats = await render;
          if (canceled()) throw new Error('canceled');
          if (s.nextFrame !== s.totalFrames) throw new Error(`renderer delivered ${s.nextFrame} of ${s.totalFrames} frames`);
          flashReport = s.flash?.report(output.firstFrame) ?? null;
          renderStageMs = stats.stageMs;
          ff.stdin.end();
          this.store.updateJob(jobId, { stage: 'encoding' });
          const code = await exited;
          if (canceled()) throw new Error('canceled');
          if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`);
          this.store.updateJob(jobId, { stage: 'validating' });
          const probe = await ffprobe(partial);
          const v = probe.streams.find((x: any) => x.codec_type === 'video');
          const a = probe.streams.find((x: any) => x.codec_type === 'audio');
          // WebM does not store a frame count; count packets for it.
          const frames = v?.nb_frames ? Number(v.nb_frames) : Number((await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', partial], { timeout: 120_000 })).stdout.trim());
          validation = { videoCodec: v?.codec_name, audioCodec: a?.codec_name, frames, expectedFrames: s.totalFrames, width: v?.width, height: v?.height, frameRate: v?.r_frame_rate, pixFmt: v?.pix_fmt, colorSpace: v?.color_space, audioSampleRate: Number(a?.sample_rate), durationSeconds: Number(probe.format.duration) };
          if (validation.videoCodec !== (gif ? 'gif' : mp4 ? 'h264' : 'vp9') || (!gif && validation.audioCodec !== (mp4 ? 'aac' : 'opus')) || frames !== s.totalFrames || v.width !== output.width || v.height !== output.height)
            throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
        }
      }
      if (canceled()) throw new Error('canceled');
      // No metadata beyond the allow-list on any MP4 output (C8): single pass, segmented join and fitted file alike.
      if (options.format === 'mp4-h264-aac') { this.store.updateJob(jobId, { stage: 'checking the export' }); await assertOutputTags(partial); }
      // Size-fit (C4–C7): after the route's own validation, before the publish; on failure nothing is published.
      let publish = partial;
      let fitOut: SizeFitOutput | null = null;
      if (manifest.fit && options.sizeFit) {
        const r = await runSizeFit({
          intermediate: partial, wav: path.join(work, 'mix.wav'), workDir: work, output, fit: manifest.fit, fault: this.fitFault, canceled,
          stage: (text) => this.store.updateJob(jobId, { stage: text }),
          onProcess: (p) => { if (this.running) this.running.ff = p ?? undefined; },
        });
        publish = r.file;
        fitOut = r.fit;
        if (r.validation) validation = { ...r.validation, intermediate: validation };
      }
      const checks = picture ? assembleChecks(picture.result(output.firstFrame), soundChecksOf(audioMix)) : null;
      if (canceled()) throw new Error('canceled');
      fs.renameSync(publish, final);
      let captionsOut: { file: string; format: string; cues: number } | null = null;
      if (job.input.sidecar) {
        const file = `${jobId}.captions.${job.input.sidecar.format}`;
        fs.writeFileSync(path.join(this.store.outDir, file), job.input.sidecar.text);
        captionsOut = { file, format: job.input.sidecar.format, cues: job.input.sidecar.cues };
      }
      // the credits of library files (wave 7 library track), from the immutable snapshot: the text the owner pastes into the description
      const licence = exportLicence(doc);
      if (licence?.lines.length) {
        const file = `${jobId}.credits.txt`;
        fs.writeFileSync(path.join(this.store.outDir, file), licence.credits.descriptionText);
        licence.credits.file = file;
      }
      const wall = (Date.now() - started) / 1000;
      const bytes = fs.statSync(final).size;
      this.store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: {
          file: path.basename(final), mimeType: { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif', wav: 'audio/wav', png: 'image/png', jpg: 'image/jpeg' }[ext], captions: captionsOut, ...(licence ? { licence } : {}), bytes, revision: job.input.revision, route: segmentsReport ? SEGMENTED_ROUTE : 'server-software-canvas2d', ...(segmentsReport ? { segments: segmentsReport } : {}), options, manifest: { engine: manifest.engine, assets: manifest.assets, fonts: manifest.fonts, audioEffects: manifest.audioEffects ?? [], output },
          estimate: { ...manifest.estimate, actualBytes: bytes }, ...(flashReport ? { photosensitivity: flashReport } : {}), ...(fitOut ? { fit: fitOut } : {}), ...(stillOut ? { still: stillOut } : {}), ...(checks ? { checks } : {}), audioClipsMixed: audioClips, audio: audioMix && { mixPeakDbfs: audioMix.mixPeakDbfs, clipped: audioMix.clipped, loudness: audioMix.loudness, ...(audioMix.limiter ? { limiter: audioMix.limiter } : {}) }, validation, renderStageMs, wallSeconds: wall, realtimeFactor: output.frames > 1 ? (output.frames * frameRate.den) / frameRate.num / wall : null,
        },
      });
    } catch (e: any) {
      if (canceled()) this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'export was canceled; partial output was discarded', retryable: true } });
      // A typed failure says itself whether a retry can help (the fast export's job errors carry details.retryable, ADR-0024).
      else this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? { ...e.toJSON().error, ...(typeof e.details?.retryable === 'boolean' ? { retryable: e.details.retryable } : {}) } : { code: 'export_failed', message: String(e?.message ?? e), retryable: true } });
    } finally {
      this.lane?.setExportActive(false);
      this.running = null;
      this.cancelRequested.delete(jobId);
      if (token) {
        this.sessions.get(token)?.sink?.kill('SIGKILL');
        this.sessions.delete(token);
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}

/** Picture checks of one export (wave 7 send, C10): the document's expectation, a PictureCheck fed with the flash cells, and its findings. */
export const PICTURE_CHECK_METHOD = 'HEURISTIC on the 24 × 24 cells of the flash check (block means of a sample, so a small detail can be missed): black = every cell at or under 8-bit level 4 for at least 0.5 s; frozen = every cell unchanged for at least 2 s while the document says a video plays (a video clip that is not a freeze frame, inside its source, on a visible track, not covered by an opaque full-frame clip; opacity keys and effects are not modelled). Report only.';
export interface PictureFeed { feed(cells: FlashCells): void; result(firstFrame: number): PictureChecks }
export function pictureCheckFor(doc: ProjectDocument, format: ExportOptions['format'], output: Manifest['output']): PictureFeed | null {
  if (!(format === 'mp4-h264-aac' || format === 'webm-vp9-opus' || format === 'gif') || output.frames <= 1) return null;
  const expect = pictureExpectation(doc, doc.mainSequenceId, output.firstFrame, output.frames);
  const moving = flagsOf(expect.moving, output.frames), drawn = flagsOf(expect.drawn, output.frames);
  const check = new PictureCheck(output.frameRate);
  let k = 0;
  return {
    feed(cells) { check.push(cells, moving[k++] === 1); },
    result(firstFrame) {
      const at = (f: number) => T.frameTime(firstFrame + f, output.frameRate);
      const findings: ExportFinding[] = check.runs().map((r) => {
        let drawnFrames = 0;
        for (let f = r.fromFrame; f < r.toFrame; f++) drawnFrames += drawn[f]!;
        return { kind: r.kind, from: at(r.fromFrame), to: at(r.toFrame), ...(r.kind === 'black' ? { context: drawnFrames ? 'picture' as const : 'gap' as const } : {}), measured: { ...r.measured, drawnFrames } };
      });
      // every frame must have been fed, or the report would describe part of the film as the whole
      return k === output.frames ? { method: PICTURE_CHECK_METHOD, status: 'measured', findings } : { method: `${PICTURE_CHECK_METHOD} Not measured: ${k} of ${output.frames} frames were checked.`, status: 'not_measured', findings: [] };
    },
  };
}
/** The sound half of the report: what the mix measured on its written 16-bit WAV (worker A), or an honest not-measured state. */
export function soundChecksOf(mix: MixResult | null): SoundChecks {
  if (mix?.checks) return mix.checks;
  return { method: mix ? 'Not measured in this build: the sound checks of the written 16-bit WAV are not built yet.' : 'Not measured: this export has no sound.', status: 'not_measured', findings: [] };
}

/** The file name a saved picture is offered under: `{asset name} · {frame time}` (no date, decisions "cover" 3); a picture file has no frame time. */
export function stillFileName(asset: Pick<Asset, 'name' | 'kind' | 'video' | 'image'>, sourceFrame: number, format: 'png' | 'jpeg'): string {
  const base = (asset.name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'picture').slice(0, 120);
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  if (asset.kind === 'image' || !asset.video) return `${base}.${ext}`;
  const t = sourceTimeOfFrame(asset, sourceFrame);
  const ms = (BigInt(t.value) * 1000n) / BigInt(t.timescale); // exact, floored: never through float seconds
  const h = ms / 3_600_000n, m = (ms / 60_000n) % 60n, sec = (ms / 1000n) % 60n, milli = ms % 1000n;
  const pad = (v: bigint, n: number) => v.toString().padStart(n, '0');
  return `${base} · ${h > 0n ? `${h}h${pad(m, 2)}m` : `${m}m`}${pad(sec, 2)}.${pad(milli, 3)}s.${ext}`;
}
/** output.still of a finished saved picture (StillOutput). */
export function stillOutputOf(asset: Asset, s: NonNullable<ExportOptions['still']>, st: NonNullable<Manifest['still']>, format: 'png' | 'jpeg'): StillOutput {
  return {
    format, width: st.crop.w, height: st.crop.h, crop: st.crop,
    source: { width: st.source.width, height: st.source.height, rate: asset.kind === 'image' || !asset.video ? null : asset.video.frameRate, conformed: asset.conform?.reasons ?? null },
    print: s.paper && s.orientation ? { paper: s.paper, orientation: s.orientation, ...printFit(st.crop, s.paper, s.orientation) } : null,
    untriedSize: st.source.width * st.source.height > STILL_TRIED_MAX_PIXELS,
    fileName: stillFileName(asset, s.sourceFrame, format),
  };
}
