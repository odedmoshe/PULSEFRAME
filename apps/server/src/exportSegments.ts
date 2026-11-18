/**
 * Segmented export (ADR-0024, plan §3–§5 with the verifier's corrections): key every frame of the range, reuse the stored
 * segments whose key is unchanged (each integrity-checked on reuse), self-check frames of the reused ones BEFORE any render
 * time is spent, render only the missing segments through the unchanged render page and compositor (ADR-0005), encode each as
 * its own closed-GOP libx264 run, and join them by stream copy with exact timestamps (ADR-0003: TS = num·k, D = den·k, setts
 * overwrites DTS with N·D). Sound is mixed whole as today. The flash check runs over the cells of every programme frame in order
 * (flashCheck.ts reportFromCells), so a flash sequence across a join is seen whole (ADR-0009).
 *
 * The lead wires runSegmentedExport into Exporter.run, the plan route (renderCacheRoutes.ts) and the MCP tools.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { EVERY_SEGMENT_FRAMES, RENDER_CACHE_JOB_ERRORS, type EngineFingerprint, type ProjectDocument, type SegmentedExportReport, type SegmentPlanView, type SegmentRun, type SegmentState, type UncacheableCode } from '@pulseframe/core';
import { flashCells, segmentFrames, segmentGrid, segmentKey, UnkeyableError, type Digest, type FlashCells, type GpuAdapterIdentity, type Segment } from '@pulseframe/engine';
import type { MixResult } from './audiomix.ts';
import { decodeCells, encodeCells } from './cellsCodec.ts';
import { EXPORT_COLOR_TAGS, EXPORT_PIXEL_FILTER, type FrameRun, type Manifest, type SegmentSink } from './export.ts';
import { reportFromCells, type PhotosensitivityReport } from './flashCheck.ts';
import type { SegmentHandle, SegmentPin, SegmentStore } from './segmentStore.ts';
import { ApiError } from './store.ts';

export type { FrameRun, SegmentSink } from './export.ts';

const exec = promisify(execFile);

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

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));
const canceledError = () => new Error('canceled');

/**
 * Keys every frame of the manifest's range through `keyOf`, yielding to the event loop after each segment; a frame
 * that throws UnkeyableError makes its segment 'uncacheable' with that code; store.has(key) makes it 'cached', else 'render'.
 * The document is the job's render document (export.ts renderDocFor), never the raw project. Throws Error('canceled') on cancel.
 */
export async function planSegments(doc: ProjectDocument, manifest: Manifest, env: SegmentEnv, store: SegmentStore, keyOf: FrameKeyFn, isCanceled?: () => boolean): Promise<SegmentPlan> {
  void doc; // keyOf closes over the same document; it is a parameter so the plan states which document it keys
  const started = performance.now();
  const { firstFrame, frames, width, height, frameRate } = manifest.output;
  const segFrames = segmentFrames(frameRate);
  const params = { engine: env.engine, encoder: env.encoderId, output: { width, height, frameRate: { num: frameRate.num, den: frameRate.den } } };
  const segments: PlannedSegment[] = [];
  for (const s of segmentGrid(firstFrame, frames, segFrames)) {
    if (isCanceled?.()) throw canceledError();
    const keys: string[] = [];
    let uncacheable: UncacheableCode | null = null;
    for (let k = 0; k < s.frames; k++) {
      try {
        keys.push(keyOf(firstFrame + s.first + k));
      } catch (e) {
        if (!(e instanceof UnkeyableError)) throw e;
        uncacheable = e.code;
        break;
      }
    }
    if (uncacheable) segments.push({ ...s, key: null, state: 'uncacheable', uncacheable });
    else {
      const key = segmentKey(keys, params, env.digest);
      segments.push({ ...s, key, state: store.has(key) ? 'cached' : 'render' });
    }
    await yieldToLoop();
  }
  if (isCanceled?.()) throw canceledError();
  return { revision: manifest.revision, segFrames, segments, keyingMs: Math.round(performance.now() - started) };
}

/** Run-length view for the sheet, the lane and agents; estimate.seconds only from store.medianRenderMsPerFrame, else null. */
export function planView(plan: SegmentPlan, manifest: Manifest, store: SegmentStore): SegmentPlanView {
  const runs: SegmentRun[] = [];
  const counts = { total: plan.segments.length, cached: 0, render: 0, uncacheable: 0 };
  const byCode = new Map<UncacheableCode, number>();
  let framesToRender = 0, framesToStore = 0;
  plan.segments.forEach((s, i) => {
    counts[s.state]++;
    if (s.state !== 'cached') framesToRender += s.frames;
    if (s.state === 'render') framesToStore += s.frames;
    if (s.state === 'uncacheable' && s.uncacheable) byCode.set(s.uncacheable, (byCode.get(s.uncacheable) ?? 0) + 1);
    const last = runs[runs.length - 1];
    if (last && last.state === s.state) { last.segments++; last.frames += s.frames; }
    else runs.push({ state: s.state, firstSegment: i, segments: 1, firstFrame: s.first, frames: s.frames });
  });
  const { width, height } = manifest.output;
  const msPerFrame = store.medianRenderMsPerFrame(width, height);
  const bytesPerFrame = store.medianBytesPerFrame(width, height);
  return {
    revision: plan.revision,
    mode: 'incremental',
    segFrames: plan.segFrames,
    firstFrame: manifest.output.firstFrame,
    frames: manifest.output.frames,
    segments: counts,
    framesToRender,
    runs,
    uncacheable: [...byCode].map(([code, segments]) => ({ code, segments })),
    estimate: {
      seconds: msPerFrame === null ? null : Math.round((msPerFrame * framesToRender) / 100) / 10,
      basis: msPerFrame === null
        ? `no estimate: fewer than 3 segments of ${width}×${height} have been rendered and measured on this machine`
        : `median render time per frame of the newest stored segments of ${width}×${height} rendered on this machine, times the frames to render (joining and sound not included)`,
      bytesToStore: bytesPerFrame === null ? null : Math.round(bytesPerFrame * framesToStore),
    },
    cache: store.status(),
    keyingMs: plan.keyingMs,
  };
}

/** timescale = num · k, frameTicks = den · k, k = the smallest power of two with num · k >= 10000. */
export function trackTimescale(rate: { num: number; den: number }): { timescale: number; frameTicks: number } {
  if (!Number.isInteger(rate.num) || !Number.isInteger(rate.den) || rate.num <= 0 || rate.den <= 0) throw new Error(`trackTimescale: bad rate ${rate.num}/${rate.den}`);
  let k = 1;
  while (rate.num * k < 10000) k *= 2;
  return { timescale: rate.num * k, frameTicks: rate.den * k };
}

/** libx264 constant-quality values of the single-pass MP4 export (export.ts CRF['mp4-h264-aac'], module-private there; a test keeps the two equal). */
export const SEGMENT_CRF = { draft: 28, standard: 21, high: 16 } as const;
/** The single-pass export's preset rule (export.ts: draft → veryfast, else medium). */
export const segmentPreset = (quality: 'draft' | 'standard' | 'high') => (quality === 'draft' ? 'veryfast' : 'medium');

/**
 * rawvideo rgba on stdin -> one closed-GOP H.264 segment in MP4, no sound: today's EXPORT_PIXEL_FILTER, libx264 preset/CRF and
 * EXPORT_COLOR_TAGS of export.ts, plus -threads N -g S -keyint_min S -sc_threshold 0 -x264-params open-gop=0
 * -video_track_timescale TS -bitexact -an -f mp4. `segFrames` here is the segment's own length (the GOP covers it whole).
 */
export function segmentEncodeArgs(o: { width: number; height: number; frameRate: { num: number; den: number }; quality: 'draft' | 'standard' | 'high'; segFrames: number; threads: number; outFile: string }): string[] {
  const { timescale } = trackTimescale(o.frameRate);
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${o.width}x${o.height}`, '-framerate', `${o.frameRate.num}/${o.frameRate.den}`, '-i', 'pipe:0',
    '-vf', EXPORT_PIXEL_FILTER,
    '-c:v', 'libx264', '-preset', segmentPreset(o.quality), '-crf', String(SEGMENT_CRF[o.quality]), '-profile:v', 'high',
    '-threads', String(o.threads), '-g', String(o.segFrames), '-keyint_min', String(o.segFrames), '-sc_threshold', '0', '-x264-params', 'open-gop=0',
    ...EXPORT_COLOR_TAGS,
    '-video_track_timescale', String(timescale), '-bitexact', '-an', '-f', 'mp4', o.outFile,
  ];
}

/** ffconcat list (absolute paths) + WAV -> final MP4 by stream copy with -bsf:v setts=dts=STARTDTS+N*D:pts=STARTDTS+N*D+PTS-DTS:duration=D, -c:a aac -b:a 192k -movflags +faststart. */
export function joinArgs(o: { listFile: string; wav: string; outFile: string; frameRate: { num: number; den: number } }): string[] {
  const { timescale, frameTicks: D } = trackTimescale(o.frameRate);
  return [
    '-hide_banner', '-v', 'error', '-y',
    '-f', 'concat', '-safe', '0', '-i', o.listFile,
    '-i', o.wav,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy', '-bsf:v', `setts=dts=STARTDTS+N*${D}:pts=STARTDTS+N*${D}+PTS-DTS:duration=${D}`, '-video_track_timescale', String(timescale),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', o.outFile,
  ];
}
/** The ffconcat list of the join: absolute paths, single quotes escaped as the concat demuxer reads them. */
export function concatList(files: readonly string[]): string {
  return `ffconcat version 1.0\n${files.map((f) => `file '${path.resolve(f).replace(/'/g, "'\\''")}'\n`).join('')}`;
}

// ---------- ffmpeg / ffprobe helpers ----------
/** Starts one segment encoder; stdin takes RGBA frames. */
function startEncoder(args: string[]) {
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] }) as unknown as ChildProcessWithoutNullStreams;
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
  proc.stdin.on('error', () => { /* reported by the exit code */ });
  const exited = new Promise<number>((res) => { proc.on('close', (code) => res(code ?? -1)); proc.on('error', () => res(-1)); });
  return { proc, exited, stderr: () => stderr };
}
function writeFrame(proc: ChildProcessWithoutNullStreams, data: Uint8Array): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null || proc.stdin.destroyed || !proc.stdin.writable) return Promise.reject(new Error('the segment encoder has stopped'));
  return new Promise((resolve, reject) => {
    const off = () => { proc.stdin.off('error', onErr); proc.off('close', onErr); proc.stdin.off('drain', done); };
    const onErr = () => { off(); reject(new Error('the segment encoder has stopped')); };
    const done = () => { off(); resolve(); };
    proc.stdin.once('error', onErr);
    proc.once('close', onErr);
    if (proc.stdin.write(data)) done();
    else proc.stdin.once('drain', done);
  });
}
/** First video packet's PTS − DTS, in the stream's ticks. */
export async function firstPacketOffset(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts,dts', '-read_intervals', '%+#1', '-of', 'csv=p=0', file], { timeout: 60_000 });
  const [pts, dts] = stdout.trim().split('\n')[0]!.split(',').map(Number);
  if (!Number.isFinite(pts) || !Number.isFinite(dts)) throw new Error(`ffprobe gave no first packet for ${path.basename(file)}: ${stdout.slice(0, 200)}`);
  return pts! - dts!;
}
/** Every video packet's PTS, in file order. */
export async function packetPts(file: string): Promise<number[]> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts', '-of', 'csv=p=0', file], { timeout: 300_000, maxBuffer: 64 << 20 });
  return stdout.split('\n').map((l) => l.trim().replace(/,$/, '')).filter(Boolean).map(Number);
}
/**
 * The exact constant-frame-rate check: the sorted packet PTS start at 0 and every delta equals frameTicks. Returns null when it
 * holds, else what was found.
 */
export function cfrProblem(pts: readonly number[], frameTicks: number): string | null {
  if (!pts.length) return 'no video packets';
  if (pts.some((p) => !Number.isInteger(p))) return 'a packet without an integer PTS';
  const s = [...pts].sort((a, b) => a - b);
  if (s[0] !== 0) return `first PTS ${s[0]}, not 0`;
  const bad: string[] = [];
  for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! !== frameTicks) bad.push(`${s[i - 1]}→${s[i]}`);
  return bad.length ? `${bad.length} PTS deltas differ from ${frameTicks} (${bad.slice(0, 5).join(', ')})` : null;
}
function runFfmpeg(args: string[], onProcess?: (p: { kill(signal?: NodeJS.Signals): boolean } | null) => void): Promise<void> {
  const { proc, exited, stderr } = startEncoder(args);
  proc.stdin.end();
  onProcess?.(proc);
  return exited.then((code) => {
    onProcess?.(null);
    if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr().slice(-800)}`);
  });
}
/** A 16-bit PCM WAV of silence (for the join self-test). */
export function silentWav(file: string, sampleRate: number, samples: number, channels = 2) {
  const data = samples * channels * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1'); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22); b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * channels * 2, 28); b.writeUInt16LE(channels * 2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36, 'latin1'); b.writeUInt32LE(data, 40);
  fs.writeFileSync(file, b);
}
/** Encodes these RGBA frames as one segment (the self-test and tests use it; the export streams through the sink instead). */
export async function encodeSegmentFile(frames: readonly Uint8Array[], o: Omit<Parameters<typeof segmentEncodeArgs>[0], 'segFrames'>): Promise<void> {
  const enc = startEncoder(segmentEncodeArgs({ ...o, segFrames: frames.length }));
  for (const f of frames) await writeFrame(enc.proc, f);
  enc.proc.stdin.end();
  const code = await enc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${enc.stderr().slice(-800)}`);
}

let joinCheck: Promise<{ ok: true } | { ok: false; reason: string }> | null = null;
/** One-time check that this ffmpeg can do the exact join (a real two-segment encode and join of generated frames); cached for the process. */
export function incrementalAvailable(): Promise<{ ok: true } | { ok: false; reason: string }> {
  joinCheck ??= (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-joincheck-'));
    try {
      const w = 64, h = 36, rate = { num: 30000, den: 1001 };
      const frame = (i: number) => { const px = new Uint8Array(w * h * 4); for (let p = 0; p < w * h; p++) { const x = p % w; px[p * 4] = (x * 4 + i * 23) & 255; px[p * 4 + 1] = ((p / w) * 7 + i * 5) & 255; px[p * 4 + 2] = (i * 40) & 255; px[p * 4 + 3] = 255; } return px; };
      const parts = [[0, 5], [5, 4]] as const;
      const files: string[] = [];
      for (const [first, n] of parts) {
        const out = path.join(dir, `s${first}.mp4`);
        await encodeSegmentFile(Array.from({ length: n }, (_, k) => frame(first + k)), { width: w, height: h, frameRate: rate, quality: 'draft', threads: 1, outFile: out });
        files.push(out);
      }
      const offsets = await Promise.all(files.map(firstPacketOffset));
      if (new Set(offsets).size !== 1) return { ok: false as const, reason: `the segment encoder wrote different packet timings (${offsets.join(', ')})` };
      const list = path.join(dir, 'list.ffconcat');
      fs.writeFileSync(list, concatList(files));
      const wav = path.join(dir, 'a.wav');
      silentWav(wav, 48000, Math.round((9 * 1001 * 48000) / 30000));
      const joined = path.join(dir, 'joined.mp4');
      await runFfmpeg(joinArgs({ listFile: list, wav, outFile: joined, frameRate: rate }));
      const pts = await packetPts(joined);
      const { frameTicks } = trackTimescale(rate);
      if (pts.length !== 9) return { ok: false as const, reason: `the join self-test gave ${pts.length} frames instead of 9` };
      const p = cfrProblem(pts, frameTicks);
      if (p) return { ok: false as const, reason: `the join self-test is not exact: ${p}` };
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: `this ffmpeg cannot join segments exactly (it needs libx264 and the setts filter with STARTDTS): ${String((e as Error)?.message ?? e).slice(0, 300)}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  })();
  return joinCheck;
}

const u32 = (hex: string) => parseInt(hex.slice(0, 8), 16) >>> 0;
/** n of a sample: every reused segment when R <= 8, else clamp(ceil(0.1 R), 8, 64). */
export const sampleSize = (R: number) => (R <= 8 ? R : Math.min(64, Math.max(8, Math.ceil(0.1 * R))));
/**
 * Frames of reused segments to render again and compare, in programme order. every-segment: core EVERY_SEGMENT_FRAMES frames per
 * segment (first, last, one seeded). sample: n = R when R <= 8, else clamp(ceil(0.1 R), 8, 64) segments, least recently verified
 * first (store.verifyOrder), one frame each at first + u32(digest(seed|key)) mod frames. Reproducible from `seed`.
 * Frames are relative to the exported range, like Segment.first.
 */
export function selectSelfCheck(reused: readonly PlannedSegment[], store: SegmentStore, mode: 'sample' | 'every-segment', seed: string, digest: Digest): { segment: PlannedSegment; frame: number }[] {
  const withKey = reused.filter((s): s is PlannedSegment & { key: string } => !!s.key);
  const seeded = (s: PlannedSegment & { key: string }) => u32(digest(`${seed}|${s.key}`));
  const out: { segment: PlannedSegment; frame: number }[] = [];
  if (mode === 'every-segment') {
    for (const s of withKey) {
      const last = s.first + s.frames - 1;
      // The seeded frame comes from the interior when there is one, so the three frames are distinct.
      const mid = s.frames > 2 ? s.first + 1 + (seeded(s) % (s.frames - 2)) : s.first + (seeded(s) % s.frames);
      for (const f of [...new Set([s.first, mid, last])].sort((a, b) => a - b)) out.push({ segment: s, frame: f });
    }
  } else {
    const n = sampleSize(withKey.length);
    const byKey = new Map<string, (PlannedSegment & { key: string })[]>();
    for (const s of withKey) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
    const chosen: (PlannedSegment & { key: string })[] = [];
    for (const k of store.verifyOrder([...byKey.keys()])) {
      if (chosen.length >= n) break;
      chosen.push(byKey.get(k)![0]!);
    }
    for (const s of chosen) out.push({ segment: s, frame: s.first + (seeded(s) % s.frames) });
  }
  return out.sort((a, b) => a.frame - b.frame);
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

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Where each programme segment's video and cells are, once known. */
interface SegmentOutcome { videoFile: string; storedKey: string | null; cellsFile: string | null }
interface Encoding {
  seg: PlannedSegment; index: number; outFile: string;
  enc: ReturnType<typeof startEncoder>;
  hashes: string[]; cells: FlashCells[]; startedMs: number; received: number;
}

/**
 * The sink of a segmented render session: checks the self-check frames against the stored RGBA hashes (first in the stream, so a
 * mismatch fails before any encoder starts), then encodes each segment to render with its own ffmpeg (at most two alive: one
 * flushing while the next takes frames), hashes every frame and keeps its flash cells, checks the packet timing and commits the
 * segment to the store (or keeps it in the work directory when the store has no room).
 */
class SegmentedSink implements SegmentSink {
  private next = 0;
  private typed: ApiError | null = null;
  private asyncError: Error | null = null;
  private current: Encoding | null = null;
  private flushing: Promise<void> | null = null;
  private readonly live = new Set<ChildProcessWithoutNullStreams>();
  private renderIdx = 0;
  private lastMark: number;
  private abortPage: (() => void) | null = null;
  readonly total: number;
  readonly frameBytes: number;
  selfCheckEndMs: number | null = null;
  notStored = 0;
  encodersStarted = 0;
  readonly outcomes = new Map<number, SegmentOutcome>();

  constructor(
    private readonly d: SegmentedExportDeps,
    private readonly checks: { segment: PlannedSegment; frame: number; expected: string }[],
    private readonly toRender: { seg: PlannedSegment; index: number }[],
    private readonly reusedKeys: readonly string[],
    private ptsOffset: number | null,
    private readonly pin: SegmentPin,
    private readonly startedMs: number,
  ) {
    this.total = checks.length + toRender.reduce((n, r) => n + r.seg.frames, 0);
    this.frameBytes = d.manifest.output.width * d.manifest.output.height * 4;
    this.lastMark = startedMs;
    if (!checks.length) this.selfCheckEndMs = startedMs;
  }
  setAbort(abort: () => void) { this.abortPage = abort; }
  failure(): ApiError | null { return this.typed; }
  received() { return this.next; }
  kill(): void {
    for (const p of this.live) p.kill('SIGKILL');
    this.live.clear();
  }
  private fail(e: ApiError): never {
    this.typed ??= e;
    this.kill();
    try { this.abortPage?.(); } catch { /* the page may already be gone */ }
    throw this.typed;
  }

  async accept(streamFirst: number, data: Uint8Array): Promise<void> {
    if (this.typed) throw this.typed;
    if (this.asyncError) throw this.asyncError;
    if (streamFirst !== this.next) throw new ApiError(409, 'frame_out_of_order', `expected frame ${this.next} of the segmented stream, got ${streamFirst}`);
    if (data.length === 0 || data.length % this.frameBytes !== 0) throw new ApiError(400, 'bad_frame_size', 'payload is not a whole number of RGBA frames');
    const count = data.length / this.frameBytes;
    if (this.next + count > this.total) throw new ApiError(400, 'too_many_frames', 'more frames than the segmented session asked for');
    for (let i = 0; i < count; i++) {
      const frame = data.subarray(i * this.frameBytes, (i + 1) * this.frameBytes);
      const pos = this.next++;
      if (pos < this.checks.length) this.checkFrame(pos, frame);
      else await this.renderFrame(frame);
    }
    const { checks } = this;
    if (this.next <= checks.length) this.d.stage(`self-check ${this.next}/${checks.length}`);
    else this.d.stage(`rendering ${this.next - checks.length}/${this.total - checks.length}`);
  }

  private checkFrame(pos: number, frame: Uint8Array) {
    const c = this.checks[pos]!;
    if (sha256(frame) !== c.expected) {
      const { store, env, manifest } = this.d;
      const purged = store.drop(this.reusedKeys).removed;
      store.resetCleanSelfChecks(env.engine);
      const E = RENDER_CACHE_JOB_ERRORS.selfCheckFailed;
      const first = manifest.output.firstFrame + c.segment.first;
      const at = manifest.output.firstFrame + c.frame;
      this.fail(new ApiError(409, E.code, E.message(first, c.segment.frames, at, purged), { segment: { first, frames: c.segment.frames }, frame: at, purged, retryable: E.retryable }, E.hint));
    }
    if (pos === this.checks.length - 1) { this.selfCheckEndMs = performance.now(); this.lastMark = this.selfCheckEndMs; }
  }

  private async renderFrame(frame: Uint8Array) {
    const r = this.toRender[this.renderIdx]!;
    if (!this.current) {
      // At most two encoders: the one flushing (if any) and this one.
      const { output, options } = this.d.manifest;
      const outFile = path.join(this.d.workDir, `seg-${String(r.index).padStart(6, '0')}.mp4`);
      const enc = startEncoder(segmentEncodeArgs({ width: output.width, height: output.height, frameRate: output.frameRate, quality: options.quality, segFrames: r.seg.frames, threads: this.d.env.threads, outFile }));
      this.encodersStarted++;
      this.live.add(enc.proc);
      this.d.onProcess(enc.proc);
      this.current = { seg: r.seg, index: r.index, outFile, enc, hashes: [], cells: [], startedMs: this.lastMark, received: 0 };
    }
    const cur = this.current;
    cur.hashes.push(sha256(frame));
    cur.cells.push(flashCells(frame, this.d.manifest.output.width, this.d.manifest.output.height));
    try { await writeFrame(cur.enc.proc, frame); } catch (e) {
      if (this.typed) throw this.typed;
      throw new Error(`segment encoder for frames ${r.seg.first}–${r.seg.first + r.seg.frames - 1} stopped: ${(e as Error).message} ${cur.enc.stderr().slice(-400)}`);
    }
    cur.received++;
    if (cur.received === r.seg.frames) {
      cur.enc.proc.stdin.end();
      const renderMs = performance.now() - cur.startedMs;
      this.lastMark = performance.now();
      this.current = null;
      this.renderIdx++;
      if (this.flushing) await this.flushing; // the previous segment must be done before this one may flush beside a new encoder
      if (this.typed) throw this.typed;
      if (this.asyncError) throw this.asyncError;
      this.flushing = this.finish(cur, renderMs).catch((e) => {
        if (e instanceof ApiError && this.typed === e) return;
        this.asyncError ??= e instanceof Error ? e : new Error(String(e));
        this.kill();
      });
    }
  }

  private async finish(cur: Encoding, renderMs: number) {
    const code = await cur.enc.exited;
    this.live.delete(cur.enc.proc);
    if (code !== 0) throw new Error(`ffmpeg exited ${code} for the segment at frame ${cur.seg.first}: ${cur.enc.stderr().slice(-800)}`);
    const offset = await firstPacketOffset(cur.outFile);
    if (this.ptsOffset === null) this.ptsOffset = offset;
    else if (offset !== this.ptsOffset) {
      const E = RENDER_CACHE_JOB_ERRORS.joinMismatch;
      const first = this.d.manifest.output.firstFrame + cur.seg.first;
      this.fail(new ApiError(500, E.code, E.message(first), { segment: { first, frames: cur.seg.frames }, ptsOffsetTicks: offset, expectedPtsOffsetTicks: this.ptsOffset, retryable: E.retryable }, E.hint));
    }
    const { output } = this.d.manifest;
    let handle: SegmentHandle | null = null;
    if (cur.seg.state !== 'uncacheable' && cur.seg.key) {
      handle = await this.d.store.put(cur.seg.key, { videoFile: cur.outFile, frames: cur.seg.frames, width: output.width, height: output.height, rgbaSha256: cur.hashes, ptsOffsetTicks: offset, cells: cur.cells, renderMs, projectId: this.d.projectId }, this.pin);
      if (!handle) this.notStored++;
    }
    if (handle) this.outcomes.set(cur.index, { videoFile: handle.videoPath, storedKey: handle.key, cellsFile: null });
    else {
      const cellsFile = cur.outFile.replace(/\.mp4$/, '.cells');
      fs.writeFileSync(cellsFile, encodeCells(cur.cells));
      this.outcomes.set(cur.index, { videoFile: cur.outFile, storedKey: null, cellsFile });
    }
  }

  /** After the page finished: every frame arrived and every encoder is done. */
  async settle() {
    if (this.flushing) await this.flushing;
    if (this.typed) throw this.typed;
    if (this.asyncError) throw this.asyncError;
    if (this.next !== this.total || this.current) throw new Error(`renderer delivered ${this.next} of ${this.total} frames`);
  }
}

/**
 * Throws ApiError render_cache_self_check_failed (after dropping every key this export reused and resetting the clean counter),
 * segment_join_mismatch, or storage_quota_exceeded (only when the joined file cannot be written); throws Error('canceled') on
 * cancel (committed segments stay, so a retry resumes). A failure the sink raised is rethrown as its typed ApiError, not as the
 * page's upload error.
 */
export async function runSegmentedExport(deps: SegmentedExportDeps): Promise<SegmentedExportResult> {
  const { manifest, store, env } = deps;
  const { output } = manifest;
  const rate = output.frameRate;
  const { frameTicks } = trackTimescale(rate);
  const checkCancel = () => { if (deps.canceled()) throw canceledError(); };

  // 1. Sound, mixed whole as today.
  deps.stage('rendering audio');
  const wav = path.join(deps.workDir, 'mix.wav');
  const audio = await deps.mixAudio(wav);
  checkCancel();

  // 2. Key every frame.
  deps.stage('keying');
  const plan = await planSegments(deps.doc, manifest, env, store, deps.keyOf, deps.canceled);
  const pin = store.pin(plan.segments.filter((s) => s.state === 'cached' && s.key).map((s) => s.key!));
  let sink: SegmentedSink | null = null;
  try {
    // 3. Integrity on every reuse: a damaged or vanished entry becomes a miss.
    const handles = new Map<number, SegmentHandle>();
    let corruptDropped = 0;
    for (let i = 0; i < plan.segments.length; i++) {
      const s = plan.segments[i]!;
      if (s.state !== 'cached' || !s.key) continue;
      checkCancel();
      const present = store.has(s.key);
      const h = present ? await store.open(s.key, { verify: true }) : null;
      if (h && h.meta.frames === s.frames) handles.set(i, h);
      else {
        if (h) store.drop([s.key]);
        if (present) corruptDropped++;
        s.state = 'render';
      }
    }
    // Every segment of one file must share the first packet's PTS − DTS; the stored ones are checked before any render time.
    let ptsOffset: number | null = null;
    for (const [i, h] of handles) {
      if (ptsOffset === null) ptsOffset = h.meta.ptsOffsetTicks;
      else if (h.meta.ptsOffsetTicks !== ptsOffset) {
        const E = RENDER_CACHE_JOB_ERRORS.joinMismatch;
        const first = output.firstFrame + plan.segments[i]!.first;
        throw new ApiError(500, E.code, E.message(first), { segment: { first, frames: plan.segments[i]!.frames }, ptsOffsetTicks: h.meta.ptsOffsetTicks, expectedPtsOffsetTicks: ptsOffset, retryable: E.retryable }, E.hint);
      }
    }
    // 4. Room for this export's work: the joined file is about the output's estimated size.
    store.trim(manifest.estimate.bytes ?? 0);

    // 5. Self-check selection.
    const seed = env.digest(`${deps.jobId}:${deps.attempt}`);
    const reused = [...handles.keys()].map((i) => plan.segments[i]!);
    const reusedKeys = reused.map((s) => s.key!);
    const handleOfKey = new Map([...handles.values()].map((h) => [h.key, h]));
    const picks = selectSelfCheck(reused, store, deps.selfCheck, seed, env.digest);
    const checks = picks.map((p) => ({ ...p, expected: handleOfKey.get(p.segment.key!)!.meta.rgbaSha256[p.frame - p.segment.first]! }));
    const toRender = plan.segments.map((seg, index) => ({ seg, index })).filter((x) => x.seg.state !== 'cached');

    // 6–7. One render session: the self-check frames, then the segments to render in programme order.
    const runs: FrameRun[] = [...checks.map((c) => ({ first: c.frame, count: 1 })), ...toRender.map((r) => ({ first: r.seg.first, count: r.seg.frames }))];
    const renderStarted = performance.now();
    sink = new SegmentedSink(deps, checks, toRender, reusedKeys, ptsOffset, pin, renderStarted);
    let renderStageMs: unknown = null;
    if (runs.length) {
      deps.stage(checks.length ? `self-check 0/${checks.length}` : `rendering 0/${sink.total}`);
      const s = sink;
      try {
        const r = await deps.render(runs, s, (abort) => { s.setAbort(abort); if (deps.canceled()) abort(); });
        renderStageMs = r.stageMs;
      } catch (e) {
        s.kill();
        if (s.failure()) throw s.failure();
        checkCancel();
        throw e;
      }
      if (s.failure()) throw s.failure();
      if (deps.canceled()) { s.kill(); throw canceledError(); }
      await s.settle();
      checkCancel();
    }
    const renderEnded = performance.now();
    const selfCheckMs = Math.round((sink.selfCheckEndMs ?? renderEnded) - renderStarted);

    // 8. Flash report over every programme frame, in order (stored cells for reused segments, fresh ones for rendered).
    const cellsOf = (i: number): FlashCells[] => {
      const h = handles.get(i);
      if (h) return store.readCellsSync(h.key);
      const o = sink!.outcomes.get(i)!;
      return o.storedKey ? store.readCellsSync(o.storedKey) : decodeCells(fs.readFileSync(o.cellsFile!));
    };
    const photosensitivity = output.frames > 1 ? reportFromCells((function* () { for (let i = 0; i < plan.segments.length; i++) yield* cellsOf(i); })(), rate, output.firstFrame) : null;

    // 9. Join by stream copy, then validate.
    checkCancel();
    deps.stage('joining');
    const joinStarted = performance.now();
    const files = plan.segments.map((_, i) => handles.get(i)?.videoPath ?? sink!.outcomes.get(i)!.videoFile);
    const segmentBytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
    const needed = segmentBytes + Math.ceil((fs.statSync(wav).size * 192) / 1536); // video copied as is; 192 kb/s AAC from 16-bit stereo PCM is about 1/8 of the WAV
    if (!store.roomFor(needed))
      throw new ApiError(507, 'storage_quota_exceeded', `not enough room to join the fast export: about ${needed} bytes are needed under the storage ceiling`, { neededBytes: needed }, 'Delete projects you no longer need and run the storage clean-up (owner: project manager → storage), clear the render cache, or raise PF_MAX_STORAGE_BYTES.');
    const listFile = path.join(deps.workDir, 'segments.ffconcat');
    fs.writeFileSync(listFile, concatList(files));
    await runFfmpeg(joinArgs({ listFile, wav, outFile: deps.outFile, frameRate: rate }), deps.onProcess);
    checkCancel();
    deps.stage('validating');
    const validation = await validateJoined(deps.outFile, output, frameTicks);
    const joinMs = Math.round(performance.now() - joinStarted);

    // 10. Book-keeping: every key the file was made from is used now; the checked ones are verified.
    const usedKeys = [...[...handles.values()].map((h) => h.key), ...[...sink.outcomes.values()].flatMap((o) => (o.storedKey ? [o.storedKey] : []))];
    store.touch(usedKeys, deps.projectId);
    const checkedKeys = [...new Set(checks.map((c) => c.segment.key!))];
    store.markVerified(checkedKeys);
    if (checks.length) store.noteCleanSelfCheck(env.engine);
    pin.release();
    store.trim(0);

    const report: SegmentedExportReport = {
      segFrames: plan.segFrames,
      total: plan.segments.length,
      reused: handles.size,
      rendered: toRender.length,
      uncacheable: plan.segments.filter((s) => s.state === 'uncacheable').length,
      corruptDropped,
      notStored: sink.notStored,
      selfCheck: { mode: deps.selfCheck, seed, segmentsChecked: checkedKeys.length, framesChecked: checks.length, framesPerSegment: deps.selfCheck === 'every-segment' ? EVERY_SEGMENT_FRAMES : 1, mismatches: 0 },
      encoderId: env.encoderId,
      engine: env.engine,
      cacheBytesAfter: store.status().usedBytes,
      ms: { keying: plan.keyingMs, selfCheck: selfCheckMs, render: Math.round(renderEnded - renderStarted - selfCheckMs), join: joinMs },
    };
    return { report, photosensitivity, audio, validation, renderStageMs };
  } catch (e) {
    sink?.kill();
    if (deps.canceled() && !(e instanceof ApiError && e === sink?.failure())) throw canceledError();
    throw e;
  } finally {
    pin.release();
  }
}

/** Codec, size, frame count and the exact constant-frame-rate check from the packets' PTS. Throws when any fails. */
async function validateJoined(file: string, output: Manifest['output'], frameTicks: number): Promise<Record<string, unknown>> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 60_000, maxBuffer: 8 << 20 });
  const probe = JSON.parse(stdout);
  const v = probe.streams.find((x: any) => x.codec_type === 'video');
  const a = probe.streams.find((x: any) => x.codec_type === 'audio');
  const pts = await packetPts(file);
  const cfr = cfrProblem(pts, frameTicks);
  const frames = Number(v?.nb_frames);
  const validation = { videoCodec: v?.codec_name, audioCodec: a?.codec_name, frames, expectedFrames: output.frames, packets: pts.length, width: v?.width, height: v?.height, frameRate: v?.r_frame_rate, pixFmt: v?.pix_fmt, colorSpace: v?.color_space, audioSampleRate: Number(a?.sample_rate), durationSeconds: Number(probe.format?.duration), constantFrameRate: cfr === null, frameTicks };
  if (validation.videoCodec !== 'h264' || validation.audioCodec !== 'aac' || frames !== output.frames || pts.length !== output.frames || v?.width !== output.width || v?.height !== output.height || cfr !== null)
    throw new Error(`export failed validation: ${JSON.stringify({ ...validation, cfr })}`);
  return validation;
}
