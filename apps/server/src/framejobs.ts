/**
 * Frame jobs (ADR-0017, route R2): a reviewed ComfyUI descriptor run over an exact range of video frames, chunk by chunk.
 *
 * Per chunk: ffmpeg extracts the chunk's frames by index into PNG-in-MKV (rgb24: ComfyUI's PyAV reader keeps the exact 8-bit path only
 * for rgb24 and a few other formats and converts the rest, FFV1's gbrp included, to 32-bit float, video_types.py:720-731), the packet
 * count is checked, the file is staged as pf_<job>_<k>.mkv and submitted with request id <base>:<k>, polled, and the PreviewImage
 * frames are collected (streamed and hashed by the adapter). The exact frame count and size are checked, a pairwise chunk's overlap
 * frame is dropped, and the chunk record {k, frames, sha256[], seconds, requestId} is written to the job row before the next chunk.
 * Each chunk takes the compute lane and gives it back; while a server export runs, no new chunk is dispatched.
 *
 * Assembly: image2 at the exact output rate → libx264 CRF 16 yuv420p, BT.709 tags; held frames (the m−1 trailing holds of a pairwise
 * result, pairs across a scene cut) repeat the previous frame; the source sound of exactly the same time range is re-muxed sample-exact.
 * Validation: counted packets, the exact r_frame_rate string, the size contract, sound present iff the source had sound, 4:2:0, and
 * describeMedia (a result that would need conforming is output_not_editable). Only then is the result imported (Capabilities.attach).
 *
 * Cancel stops at the chunk boundary; ComfyUI's global /interrupt is sent only while every running prompt carries one of the job's
 * request ids. Recovery re-verifies every recorded chunk's digests, reconciles the in-flight chunk by <base>:<k>, and resubmits it as
 * <base>:<k>:r2 (recorded) when the provider has no record of it: the provider is local and costs nothing per run.
 * Scratch (the job's work folder and, for a provider on this machine, the staged chunks) is deleted when the job ends.
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import * as T from '@pulseframe/time';
import { ProviderError, type ComfyDescriptor, type PixelSize, type ProviderAdapter, type Readiness } from '@pulseframe/providers';
import type { ChunkRecord, ComputeLane, FramePlan, JobEta, JobProgress } from './aiContracts.ts';
import { chunkKeptFrames, chunkProviderFrames, chunkSourceFrames, rateText, type FrameSource } from './framePlan.ts';
import { countVideoPackets, describeMedia, ffprobe, NeedsConform, type MediaMeta } from './ingest.ts';
import type { ModelStatus } from './models.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { assertStorageRoom } from './storage.ts';

const exec = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------------------------------------------------------------------
// ffmpeg steps (exported for the proofs, which check the PNG path bit-exactly against ComfyUI)
// ------------------------------------------------------------------------------------------------------------------------------
async function ff(args: string[], timeoutMs = 600_000): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); reject(e); });
    p.on('close', (code, signal) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg ${signal ? `killed (${signal})` : `exited ${code}`}: ${err.trim()}`)); });
  });
}
/**
 * Extract source frames by decoded index into a PNG-in-MKV file (rgb24, the exact path in ComfyUI's reader). `frames` is either a
 * contiguous range {first, count} or every `step`-th frame from `first`. YCbCr is read with the colour matrix the editor uses.
 * Returns the packet count of the result, which the caller compares with the frames it asked for.
 */
export async function extractChunk(src: string, out: string, frames: { first: number; count: number; step?: number }, colourMatrix: FrameSource['colourMatrix'] = 'auto', rate: { num: number; den: number } = { num: 30, den: 1 }): Promise<number | null> {
  const step = frames.step ?? 1;
  const last = frames.first + (frames.count - 1) * step;
  const pick = step === 1
    ? `trim=start_frame=${frames.first}:end_frame=${frames.first + frames.count},setpts=PTS-STARTPTS`
    : `select='between(n\\,${frames.first}\\,${last})*not(mod(n-${frames.first}\\,${step}))',setpts=N/(${rate.num}/${rate.den})/TB`;
  const matrix = colourMatrix === 'auto' ? '' : `in_color_matrix=${colourMatrix}:`;
  await ff(['-i', src, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `${pick},scale=${matrix}flags=accurate_rnd+full_chroma_int,format=rgb24`, '-fps_mode', 'passthrough', '-c:v', 'png', '-pix_fmt', 'rgb24', '-f', 'matroska', out]);
  return countVideoPackets(out);
}
/**
 * The source sound of asset time [start, start + duration), sample-exact: the decode is padded from the file's own time zero (so a
 * sound that starts late keeps its place), cut at exactly round(start·sr) and round((start + duration)·sr) on the absolute clock (never
 * accumulated), and padded with silence if the sound ends early. Written as 32-bit float WAV; returns the sample count.
 */
export async function extractAudio(src: string, out: string, a: { start: T.RationalTime; duration: T.RationalTime; sampleRate: number; timeOrigin: number }): Promise<{ samples: number; expected: number }> {
  const sr = a.sampleRate;
  const s0 = T.nearestSampleIndex(a.start, sr), s1 = T.nearestSampleIndex(T.add(a.start, a.duration), sr);
  await ff(['-copyts', '-i', src, '-vn', '-sn', '-dn', '-map', '0:a:0', '-af', `aresample=${sr}:first_pts=${Math.round(a.timeOrigin * sr)},apad=whole_len=${s1},atrim=start_sample=${s0}:end_sample=${s1},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_f32le', '-f', 'wav', out]);
  const st = (await ffprobe(out)).streams?.find((x: any) => x.codec_type === 'audio');
  return { samples: Number(st?.duration_ts ?? -1), expected: s1 - s0 };
}
/** Encode numbered PNG frames (000000.png …) at an exact rate, with optional sound, to MP4 H.264 CRF 16 yuv420p, BT.709 tags. */
export async function assembleFrames(seqDir: string, rate: { num: number; den: number }, wav: string | null, out: string): Promise<void> {
  const gop = String(Math.max(1, Math.ceil(rate.num / rate.den)));
  await ff([
    '-framerate', `${rate.num}/${rate.den}`, '-i', path.join(seqDir, '%06d.png'), ...(wav ? ['-i', wav] : []),
    '-map', '0:v:0', ...(wav ? ['-map', '1:a:0'] : []),
    '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p', '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-bf', '0', '-g', gop,
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    ...(wav ? ['-c:a', 'aac', '-b:a', '192k'] : []), '-movflags', '+faststart', '-f', 'mp4', out,
  ]);
}
/** Width and height from a PNG's IHDR (no decode); null when the file is not a PNG. */
export function pngSize(file: string): PixelSize | null {
  const b = Buffer.alloc(24);
  const fd = fs.openSync(file, 'r');
  try { if (fs.readSync(fd, b, 0, 24, 0) < 24) return null; } finally { fs.closeSync(fd); }
  if (b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}
export interface FrameOutputExpectation { frames: number; rate: { num: number; den: number }; width: number; height: number; audio: boolean; audioSeconds?: number }
/**
 * Validate an assembled frame-job result before success (ADR-0007, the proxy rule of derive.ts). output_not_editable: variable rate,
 * a chroma layout other than 4:2:0, or anything describeMedia would conform. output_invalid: frame count, the exact r_frame_rate
 * string, the size contract, sound present iff the source had sound (and as long as the picture, within two AAC frames).
 */
export async function validateFrameOutput(file: string, e: FrameOutputExpectation): Promise<{ meta: MediaMeta; probe: any; frames: number }> {
  let probe: any;
  try { probe = await ffprobe(file); } catch { throw new ApiError(502, 'output_invalid', 'the assembled result is not decodable media'); }
  const v = probe.streams?.find((x: any) => x.codec_type === 'video');
  const a = probe.streams?.find((x: any) => x.codec_type === 'audio');
  if (!v) throw new ApiError(502, 'output_invalid', 'the result has no picture');
  if (v.avg_frame_rate !== v.r_frame_rate) throw new ApiError(502, 'output_not_editable', `the result has a variable frame rate (${v.avg_frame_rate} on average, ${v.r_frame_rate} nominal)`, { reasons: ['variable-frame-rate'] });
  if (v.pix_fmt !== 'yuv420p') throw new ApiError(502, 'output_not_editable', `the result is ${v.pix_fmt}; the editor decodes 4:2:0 (yuv420p)`, { reasons: ['pixel-format'], pixFmt: v.pix_fmt });
  const frames = await countVideoPackets(file);
  if (frames !== e.frames) throw new ApiError(502, 'output_invalid', `the result has ${frames ?? 'an unknown number of'} frames, expected ${e.frames}`, { frames, expected: e.frames });
  const want = rateText(e.rate);
  if (v.r_frame_rate !== want) throw new ApiError(502, 'output_invalid', `the result plays at ${v.r_frame_rate} frames per second, expected exactly ${want}`, { rate: v.r_frame_rate, expected: want });
  if (v.width !== e.width || v.height !== e.height) throw new ApiError(502, 'output_invalid', `the result is ${v.width}x${v.height}, expected ${e.width}x${e.height}`);
  if (!!a !== e.audio) throw new ApiError(502, 'output_invalid', e.audio ? 'the source has sound but the result has none' : 'the result has sound the source does not have');
  if (a && e.audioSeconds !== undefined) {
    const got = Number(a.duration), tol = (2 * 1024) / Number(a.sample_rate || 48000);
    if (!(Math.abs(got - e.audioSeconds) <= tol)) throw new ApiError(502, 'output_invalid', `the result's sound lasts ${got} s, expected ${e.audioSeconds} s`, { audioSeconds: got, expected: e.audioSeconds });
  }
  let meta: MediaMeta;
  try { meta = await describeMedia(file); } catch (x) {
    if (x instanceof NeedsConform) throw new ApiError(502, 'output_not_editable', `the result would need conforming before it can be edited (${x.reasons.join(', ')})`, { reasons: x.reasons });
    throw new ApiError(502, 'output_invalid', `the result cannot be described as editable media: ${(x as Error).message}`);
  }
  if (meta.video?.frameCount !== e.frames) throw new ApiError(502, 'output_invalid', `the result's frame count reads ${meta.video?.frameCount}, expected ${e.frames}`);
  return { meta, probe, frames };
}
/** ComfyUI's /interrupt is global: send it only while every running prompt is one of this job's chunks (request id <base>:<k>…). */
export const mayInterrupt = (running: { clientRequestId: string | null }[], base: string): boolean => running.length > 0 && running.every((r) => typeof r.clientRequestId === 'string' && r.clientRequestId.startsWith(`${base}:`));
const fileSha256 = async (file: string) => { const h = createHash('sha256'); await pipeline(fs.createReadStream(file), h); return h.digest('hex'); };

// ------------------------------------------------------------------------------------------------------------------------------
// The driver
// ------------------------------------------------------------------------------------------------------------------------------
/** Durable per-job state in job.output.frames. */
export interface FrameJobState {
  chunks: ChunkRecord[];
  /** The chunk dispatched and not yet recorded: its request id, and the provider's id once known (written before and after submit). */
  current: { k: number; requestId: string; providerJobId: string | null } | null;
  /** Chunks resubmitted after a restart because the provider had no record of them (local, cost 0). */
  resubmitted: { k: number; from: string; requestId: string; at: string }[];
  /** The last re-verification of recorded chunks (after a restart). */
  reverified: { checked: number; kept: number; at: string } | null;
}
export interface FrameJobDeps {
  store: Store;
  adapter: () => ProviderAdapter | null;
  lane: () => (ComputeLane & { waitForExportIdle?(signal?: AbortSignal): Promise<void> }) | null;
  descriptor(id: string): ComfyDescriptor;
  modelStatus(d: ComfyDescriptor): Promise<ModelStatus[]>;
  /** The provider's input folder when ComfyUI runs on this machine (staged chunks are deleted there); null otherwise. */
  providerInputDir: () => string | null;
  /** Import the validated result and apply the requested placement (Capabilities.attach). */
  attach(job: JobRow, bundle: any[], recipe: any, extra: { meta: MediaMeta; derived: Record<string, unknown> }): Promise<unknown>;
  /** Run-earned reviews still open (recipe.experimental). */
  openReviews(d: ComfyDescriptor): string[];
  stopped(): boolean;
  /** Poll interval for the provider (ms). */
  pollMs?: number;
}
const TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

export class FrameJobDriver {
  private aborts = new Map<string, AbortController>();
  constructor(private deps: FrameJobDeps) {}
  /** The job's work folder: it survives a restart (the recorded chunks live there) and is deleted when the job ends. */
  workDir(jobId: string) { return path.join(this.deps.store.tmpDir, `frames_${jobId}`); }
  stagedName(jobId: string, k: number, attempt = 1) { return `pf_${jobId}_${k}${attempt > 1 ? `_r${attempt}` : ''}.mkv`; }

  /** Stop waiting for the lane or an export (cancel, shutdown). */
  abort(jobId: string) { this.aborts.get(jobId)?.abort(new Error('canceled')); }
  abortAll() { for (const a of this.aborts.values()) a.abort(new Error('stopping')); }

  /**
   * Cancel at the chunk boundary. A chunk still queued at the provider is removed from its queue; a running one is interrupted only
   * when every running prompt is ours (mayInterrupt); otherwise it finishes and its frames are discarded. Nothing is attached.
   */
  async cancel(jobId: string, actor: string, driving: boolean): Promise<{ jobId: string; status: string; outcome: string }> {
    const store = this.deps.store;
    const job = store.getJob(jobId);
    if (TERMINAL.has(job.status)) return { jobId, status: job.status, outcome: 'already-finished' };
    store.updateJob(jobId, { status: 'cancel-requested', output: { ...job.output, cancel: { by: actor, outcome: 'requested' } } });
    this.abort(jobId);
    let outcome = 'stop-at-chunk-boundary';
    const cur = (job.output?.frames as FrameJobState | undefined)?.current;
    const adapter = this.deps.adapter();
    if (cur?.providerJobId && adapter) {
      const s = await adapter.status(cur.providerJobId).catch(() => ({ state: 'unknown' as const }));
      if (s.state === 'queued') outcome = await adapter.cancel(cur.providerJobId).catch(() => 'not-supported');
      else if (s.state === 'running') {
        const running = await adapter.running().catch(() => null);
        if (running && mayInterrupt(running, job.input.clientRequestId)) outcome = await adapter.cancel(cur.providerJobId).catch(() => 'not-supported');
        else outcome = 'running-chunk-not-interrupted (another prompt shares the provider); stopping at the chunk boundary';
      }
    }
    const j = store.getJob(jobId);
    if (j.status === 'cancel-requested') store.updateJob(jobId, { output: { ...j.output, cancel: { by: actor, outcome } } });
    if (!driving) await this.finishCancel(jobId); // nothing is driving it (e.g. never started after a restart): end it now
    return { jobId, status: store.getJob(jobId).status, outcome };
  }

  private save(jobId: string, patch: { status?: string; stage?: string | null; attempt?: number; frames?: FrameJobState; progress?: JobProgress; eta?: JobEta; extra?: Record<string, unknown> }) {
    const j = this.deps.store.getJob(jobId);
    const keepStatus = j.status === 'cancel-requested' && patch.status === 'running';
    this.deps.store.updateJob(jobId, {
      ...(patch.status && !keepStatus ? { status: patch.status } : {}),
      ...(patch.stage !== undefined && j.status !== 'cancel-requested' ? { stage: patch.stage } : {}),
      ...(patch.attempt !== undefined ? { attempt: patch.attempt } : {}),
      output: { ...j.output, ...(patch.frames ? { frames: patch.frames } : {}), ...(patch.progress ? { progress: patch.progress } : {}), ...(patch.eta ? { eta: patch.eta } : {}), ...patch.extra },
    });
  }
  private canceled(jobId: string) { return this.deps.store.getJob(jobId).status === 'cancel-requested'; }
  private cleanupStaged(jobId: string, plan: FramePlan) {
    const dir = this.deps.providerInputDir();
    if (!dir) return;
    for (const ch of plan.chunks) for (let a = 1; a <= 4; a++) fs.rmSync(path.join(dir, this.stagedName(jobId, ch.k, a)), { force: true });
  }
  private async finishCancel(jobId: string) {
    const job = this.deps.store.getJob(jobId);
    fs.rmSync(this.workDir(jobId), { recursive: true, force: true });
    if (job.input.frames) this.cleanupStaged(jobId, job.input.frames);
    this.deps.store.updateJob(jobId, { status: 'canceled', stage: null, output: { ...job.output, attachment: { status: 'not-attached', reason: 'canceled; nothing was imported or placed' }, scratch: 'deleted' } });
  }

  /** Re-check every recorded chunk against its frame files; keep the longest verified prefix and remove the rest. */
  private reverify(jobId: string, state: FrameJobState): FrameJobState {
    if (state.chunks.length === 0) return state;
    const kept: ChunkRecord[] = [];
    for (const rec of state.chunks) {
      const dir = path.join(this.workDir(jobId), 'frames', String(rec.k));
      const ok = rec.sha256.length === rec.frames && rec.sha256.every((h, i) => {
        const f = path.join(dir, `${String(i).padStart(6, '0')}.png`);
        try { return createHash('sha256').update(fs.readFileSync(f)).digest('hex') === h; } catch { return false; }
      });
      if (!ok || rec.k !== kept.length) break;
      kept.push(rec);
    }
    for (const rec of state.chunks.slice(kept.length)) fs.rmSync(path.join(this.workDir(jobId), 'frames', String(rec.k)), { recursive: true, force: true });
    const current = state.current && state.current.k === kept.length ? state.current : null;
    return { ...state, chunks: kept, current, reverified: { checked: state.chunks.length, kept: kept.length, at: new Date().toISOString() } };
  }

  /** Drive a persisted frame job to succeeded, failed or canceled. Resumable: it starts after the last verified chunk. Never throws. */
  async drive(jobId: string): Promise<void> {
    const { store } = this.deps;
    const ctl = new AbortController();
    this.aborts.set(jobId, ctl);
    const started = Date.now();
    let job = store.getJob(jobId);
    const plan: FramePlan = job.input.frames;
    const src: FrameSource = job.input.frameSource;
    const work = this.workDir(jobId);
    try {
      if (TERMINAL.has(job.status)) return;
      if (job.status === 'cancel-requested') { await this.finishCancel(jobId); return; }
      const adapter = this.deps.adapter();
      if (!adapter) throw new ApiError(503, 'provider_not_configured', 'the ComfyUI provider is not configured');
      const d = this.deps.descriptor(job.input.capabilityId);
      let state: FrameJobState = this.reverify(jobId, job.output?.frames ?? { chunks: [], current: null, resubmitted: [], reverified: null });
      const total = plan.frameCount;
      const doneFrames = (s: FrameJobState) => s.chunks.reduce((n, r) => n + plan.chunks[r.k]!.count - plan.chunks[r.k]!.overlapIn, 0);
      this.save(jobId, { status: 'running', stage: 'preparing', attempt: job.attempt + 1, frames: state, progress: { unit: 'frames', done: doneFrames(state), total, basis: 'measured' }, eta: { seconds: null, basis: 'none' } });
      // Readiness is re-checked here: the start only admitted the plan (no await), the estimate showed it.
      const readiness: Readiness = await adapter.probe(d);
      if (!readiness.reachable) throw new ApiError(503, 'provider_unreachable', `ComfyUI is not reachable: ${readiness.problems.join('; ')}`);
      if (readiness.missingNodeClasses.length) throw new ApiError(409, 'dependency_missing', readiness.problems.join('; '), { missingNodeClasses: readiness.missingNodeClasses });
      const bad = (await this.deps.modelStatus(d)).filter((m) => m.state !== 'ready');
      if (bad.length) throw new ApiError(409, 'model_not_ready', `model files are not ready: ${bad.map((m) => `${m.path} (${m.state})`).join(', ')}`, { models: bad }, 'Download and verify the models for this capability first.');
      fs.mkdirSync(path.join(work, 'frames'), { recursive: true, mode: 0o700 });
      const srcFile = store.blobPath(job.input.sources[0].contentHash);
      const out: PixelSize = job.input.outputSize;
      const runStart = Date.now();
      let framesThisRun = 0;
      for (let k = state.chunks.length; k < plan.chunks.length; k++) {
        if (this.deps.stopped()) return;
        if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
        const lane = this.deps.lane();
        let release: () => void = () => {};
        // While a server export runs no chunk is dispatched; an export that starts while this chunk waits for the lane is waited for too.
        for (;;) {
          if (lane?.exportActive()) {
            this.save(jobId, { stage: `queued (an export is running; chunk ${k + 1} of ${plan.chunks.length} waits for it)` });
            if (lane.waitForExportIdle) await lane.waitForExportIdle(ctl.signal).catch(() => {});
            else while (lane.exportActive() && !ctl.signal.aborted) await sleep(250);
          }
          if (this.deps.stopped()) return;
          if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
          if (!lane) break;
          if (lane.busy().holder !== null) this.save(jobId, { stage: `queued (waiting for compute: ${lane.busy().holder})` });
          try { release = await lane.acquire(`${d.id} chunk ${k + 1}/${plan.chunks.length} (${jobId})`, ctl.signal); } catch { release = () => {}; break; /* aborted: canceled or stopping */ }
          if (!lane.exportActive()) break;
          release(); // an export began meanwhile: give the lane back and wait for it
          release = () => {};
        }
        try {
          if (this.deps.stopped()) return;
          if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
          const t0 = Date.now();
          const rec = await this.runChunk(jobId, d, adapter, plan, src, srcFile, out, state, k);
          if (rec === 'stopped') return;
          if (rec === 'canceled') { await this.finishCancel(jobId); return; }
          state = { ...store.getJob(jobId).output.frames, chunks: [...state.chunks, rec], current: null };
          framesThisRun += plan.chunks[k]!.count - plan.chunks[k]!.overlapIn;
          const done = doneFrames(state);
          const perFrame = (Date.now() - runStart) / 1000 / framesThisRun;
          this.save(jobId, {
            frames: state, progress: { unit: 'frames', done, total, basis: 'measured' }, eta: { seconds: Math.round(perFrame * (total - done)), basis: 'this-run' },
            stage: `inference (frame ${done} of ${total}, measured; chunk ${k + 1} of ${plan.chunks.length} took ${((Date.now() - t0) / 1000).toFixed(1)} s)`,
          });
        } finally { release(); }
      }
      if (this.deps.stopped()) return;
      if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
      // ---- assembly ----
      this.save(jobId, { stage: 'assembling (encoding the frames and copying the sound back)' });
      const seq = path.join(work, 'seq');
      fs.rmSync(seq, { recursive: true, force: true });
      fs.mkdirSync(seq, { recursive: true });
      const produced: string[] = [];
      for (const r of state.chunks) for (let i = 0; i < r.frames; i++) produced.push(path.join(work, 'frames', String(r.k), `${String(i).padStart(6, '0')}.png`));
      const held = new Set(plan.heldFrames);
      for (let j = 0; j < plan.expectedOutputFrames; j++) {
        const dest = path.join(seq, `${String(j).padStart(6, '0')}.png`);
        const from = held.has(j) || j >= produced.length ? path.join(seq, `${String(j - 1).padStart(6, '0')}.png`) : produced[j]!;
        if (j === 0 && held.has(0)) throw new ApiError(500, 'capability_failed', 'the first output frame cannot be a held frame');
        try { fs.linkSync(from, dest); } catch { fs.copyFileSync(from, dest); }
      }
      const seconds = T.frameTime(plan.frameCount, plan.rate);
      let wav: string | null = null;
      if (src.audio) {
        wav = path.join(work, 'sound.wav');
        const a = await extractAudio(srcFile, wav, { start: T.normalize(src.sourceRangeStart), duration: seconds, sampleRate: src.audio.sampleRate, timeOrigin: src.timeOrigin });
        if (a.samples !== a.expected) throw new ApiError(502, 'output_invalid', `the copied sound has ${a.samples} samples, expected ${a.expected}`);
      }
      const result = path.join(work, 'result.mp4');
      await assembleFrames(seq, plan.outputRate, wav, result);
      this.save(jobId, { stage: 'validating' });
      const v = await validateFrameOutput(result, { frames: plan.expectedOutputFrames, rate: plan.outputRate, width: out.width, height: out.height, audio: !!src.audio, audioSeconds: src.audio ? T.toSeconds(seconds) : undefined });
      if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
      const size = fs.statSync(result).size;
      const contentHash = `sha256:${await fileSha256(result)}`;
      if (!fs.existsSync(store.blobPath(contentHash))) assertStorageRoom(store, size, 'store this result');
      store.putBlob(contentHash, result, size, 'video/mp4');
      const vs = v.probe.streams.find((x: any) => x.codec_type === 'video');
      const output = d.outputs.find((o) => o.mediaType === 'video')!;
      const bundle = [{ name: output.name, role: output.role, mediaType: 'video', encoding: output.encoding, contentHash, bytes: size, mimeType: 'video/mp4', codec: vs.codec_name, width: vs.width, height: vs.height, pixFmt: vs.pix_fmt, hasAlpha: false, durationSeconds: Number(v.probe.format?.duration ?? 0), frames: v.frames, rFrameRate: vs.r_frame_rate }];
      job = store.getJob(jobId);
      const measuredSeconds = job.output.frames.chunks.reduce((s: number, r: ChunkRecord) => s + r.seconds, 0);
      const derivedFrames = {
        sourceStartFrame: plan.firstFrame, sourceFrameCount: plan.frameCount, sourceRate: plan.rate, outputRate: plan.outputRate,
        mapping: plan.mode === 'pairwise' ? 'interpolated' : 'identity', ...(plan.multiplier ? { multiplier: plan.multiplier } : {}), heldFrames: plan.heldFrames,
      };
      const recipe = {
        experimental: this.deps.openReviews(d).length > 0, openReviews: this.deps.openReviews(d), capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.graphDigest, logicDigest: d.graphDigest,
        params: job.input.params, sources: job.input.sources, provider: { id: adapter.id, runtimeVersion: readiness.runtimeVersion, device: readiness.device },
        frames: { ...derivedFrames, chunks: plan.chunks.length, expectedOutputFrames: plan.expectedOutputFrames },
      };
      const derived = {
        frames: derivedFrames, audio: src.audio ? 'source-copied' : 'none', sourceRangeStart: T.normalize(src.sourceRangeStart),
        models: d.models.filter((m) => m.sha256).map((m) => ({ path: m.path, sha256: m.sha256! })), logicDigest: d.graphDigest,
      };
      if (this.canceled(jobId)) { await this.finishCancel(jobId); return; }
      this.save(jobId, { stage: 'attaching' });
      const attachment = await this.deps.attach(job, bundle, recipe, { meta: v.meta, derived });
      const final = store.getJob(jobId);
      fs.rmSync(work, { recursive: true, force: true });
      this.cleanupStaged(jobId, plan);
      store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: {
          ...final.output, bundle, recipe, attachment, scratch: 'deleted',
          progress: { unit: 'frames', done: total, total, basis: 'measured' }, eta: { seconds: 0, basis: 'this-run' },
          // what this machine measured, for later estimates (seconds of provider work per output frame at this source size)
          measurement: { device: readiness.device?.name ?? null, deviceType: readiness.device?.type ?? null, sourceFrames: plan.frameCount, outputFrames: plan.expectedOutputFrames, pixels: plan.width * plan.height, chunkSeconds: measuredSeconds, basis: 'measured (sum of chunk wall seconds)' },
          wallSeconds: (Date.now() - started) / 1000,
          ...(final.status === 'cancel-requested' ? { cancel: { ...final.output?.cancel, outcome: 'completed-before-cancel-took-effect' } } : {}),
        },
      });
    } catch (e: any) {
      if (this.deps.stopped()) return; // shutting down: the durable chunk records stay for recover()
      const cur = store.getJob(jobId);
      if (cur.status === 'cancel-requested') { await this.finishCancel(jobId); return; }
      fs.rmSync(work, { recursive: true, force: true });
      if (job.input.frames) this.cleanupStaged(jobId, plan);
      const error = e instanceof ApiError ? e.toJSON().error : { code: e instanceof ProviderError ? e.code : 'capability_failed', message: String(e?.message ?? e), retryable: true };
      store.updateJob(jobId, { status: 'failed', stage: null, error, output: { ...cur.output, scratch: 'deleted' } });
    } finally {
      this.aborts.delete(jobId);
    }
  }

  /** One chunk: extract, stage, submit (or reconcile the in-flight one), poll, collect, check, record. */
  private async runChunk(jobId: string, d: ComfyDescriptor, adapter: ProviderAdapter, plan: FramePlan, src: FrameSource, srcFile: string, out: PixelSize, state: FrameJobState, k: number): Promise<ChunkRecord | 'stopped' | 'canceled'> {
    const { store } = this.deps;
    const job = store.getJob(jobId);
    const base: string = job.input.clientRequestId;
    const ch = plan.chunks[k]!;
    const work = this.workDir(jobId);
    const t0 = Date.now();
    let requestId = `${base}:${k}`;
    let providerJobId: string | null = null;
    let attempt = 1;
    const persistCurrent = (cur: FrameJobState['current'], extra: Partial<FrameJobState> = {}) => {
      const s = { ...store.getJob(jobId).output.frames, ...extra, current: cur };
      this.save(jobId, { frames: s });
    };
    // A chunk that was in flight when the server stopped: find it at the provider by its request id before doing anything else.
    if (state.current && state.current.k === k) {
      requestId = state.current.requestId;
      attempt = Number(/:r(\d+)$/.exec(requestId)?.[1] ?? 1);
      providerJobId = state.current.providerJobId ?? (await adapter.findByClientRequestId(requestId).catch(() => null));
      if (providerJobId) {
        const s = await adapter.status(providerJobId).catch(() => ({ state: 'unknown' as const }));
        if (s.state === 'unknown') providerJobId = await adapter.findByClientRequestId(requestId).catch(() => null);
      }
      if (!providerJobId) {
        // The provider has no record of it: resubmit under a new, recorded request id (a local provider costs nothing per run).
        const from = requestId;
        attempt += 1;
        requestId = `${base}:${k}:r${attempt}`;
        const s = store.getJob(jobId).output.frames as FrameJobState;
        persistCurrent(null, { resubmitted: [...(s.resubmitted ?? []), { k, from, requestId, at: new Date().toISOString() }] });
      } else persistCurrent({ k, requestId, providerJobId });
    }
    if (!providerJobId) {
      this.save(jobId, { stage: `preparing chunk ${k + 1} of ${plan.chunks.length} (extracting frames ${ch.first}–${chunkSourceFrames(plan, k).at(-1)})` });
      const chunkFile = path.join(work, `in_${k}.mkv`);
      const packets = await extractChunk(srcFile, chunkFile, { first: ch.first, count: ch.count, step: plan.mode === 'sampled' ? plan.sampleEvery! : 1 }, src.colourMatrix, plan.rate);
      if (packets !== ch.count) throw new ApiError(502, 'capability_failed', `chunk ${k + 1} has ${packets ?? 'an unknown number of'} frames after extraction, expected ${ch.count}`, { chunk: k, packets, expected: ch.count });
      const staged = this.stagedName(jobId, k, attempt);
      this.save(jobId, { stage: `transfer (staging chunk ${k + 1} of ${plan.chunks.length}, ${fs.statSync(chunkFile).size} bytes)` });
      const ref = await adapter.stage(chunkFile, staged, 'video/x-matroska');
      if (ref !== staged) throw new ApiError(502, 'stage_failed', `provider stored the chunk as "${ref}", expected "${staged}"`);
      fs.rmSync(chunkFile, { force: true });
      const graph = structuredClone(job.input.graph);
      const bind = job.input.frameBinding as { nodeId: string; input: string };
      graph[bind.nodeId].inputs[bind.input] = staged;
      persistCurrent({ k, requestId, providerJobId: null }); // durable intent before dispatch (FF-08)
      try {
        providerJobId = (await adapter.submit(graph, requestId)).providerJobId;
      } catch (e) {
        if (!(e instanceof ProviderError) || !e.ambiguous) throw e;
        providerJobId = await adapter.findByClientRequestId(requestId).catch(() => null);
        if (!providerJobId) throw new ApiError(502, 'submission_unknown', `chunk ${k + 1}: ${e.message}`, { chunk: k, requestId });
      }
      persistCurrent({ k, requestId, providerJobId });
    }
    // ---- poll ----
    let lost = 0;
    let shown = '';
    for (;;) {
      if (this.deps.stopped()) return 'stopped';
      const s = await adapter.status(providerJobId);
      if (s.state === 'succeeded') break;
      if (s.state === 'failed') {
        if (this.canceled(jobId)) return 'canceled';
        throw new ApiError(502, 'provider_execution_failed', `chunk ${k + 1}: ${s.message}`, { chunk: k });
      }
      if (this.canceled(jobId) && s.state === 'unknown') return 'canceled';
      if (s.state === 'unknown') { if (++lost * (this.deps.pollMs ?? 200) > 30_000) throw new ApiError(502, 'provider_lost_job', `chunk ${k + 1}: the provider no longer lists this prompt`, { chunk: k, requestId }); }
      else lost = 0;
      const stage = s.state === 'queued' ? `queued at the provider (chunk ${k + 1} of ${plan.chunks.length}, position ${s.position ?? '?'})` : `inference (chunk ${k + 1} of ${plan.chunks.length}; progress inside a chunk is not reported)`;
      if (stage !== shown && !this.canceled(jobId)) { this.save(jobId, { stage }); shown = stage; }
      await sleep(this.deps.pollMs ?? 200);
    }
    if (this.canceled(jobId)) return 'canceled'; // finished anyway: its frames are discarded
    // ---- collect and check ----
    this.save(jobId, { stage: `transfer (collecting chunk ${k + 1} of ${plan.chunks.length})` });
    const dest = path.join(work, `collect_${k}`);
    fs.rmSync(dest, { recursive: true, force: true });
    let files;
    try { files = await adapter.collect(d, providerJobId, dest); } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e; }
    try {
      const expected = chunkProviderFrames(plan, k);
      if (files.length !== expected) throw new ApiError(502, 'output_invalid', `chunk ${k + 1} returned ${files.length} frames, expected exactly ${expected}`, { chunk: k, frames: files.length, expected });
      for (const f of files) {
        const sz = pngSize(f.path);
        if (!sz) throw new ApiError(502, 'output_invalid', `chunk ${k + 1}: "${f.fileName}" is not a PNG frame`, { chunk: k });
        if (sz.width !== out.width || sz.height !== out.height) throw new ApiError(502, 'output_invalid', `chunk ${k + 1}: frame "${f.fileName}" is ${sz.width}x${sz.height}, expected ${out.width}x${out.height}`, { chunk: k });
      }
      const keep = files.slice(ch.overlapIn); // a pairwise chunk's first frame repeats the previous chunk's last frame
      if (keep.length !== chunkKeptFrames(plan, k)) throw new ApiError(500, 'capability_failed', 'chunk bookkeeping mismatch');
      const dir = path.join(work, 'frames', String(k));
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      keep.forEach((f, i) => fs.renameSync(f.path, path.join(dir, `${String(i).padStart(6, '0')}.png`)));
      const inputDir = this.deps.providerInputDir();
      if (inputDir) fs.rmSync(path.join(inputDir, this.stagedName(jobId, k, attempt)), { force: true });
      return { k, firstFrame: ch.first, frames: keep.length, sha256: keep.map((f) => f.sha256), seconds: (Date.now() - t0) / 1000, requestId };
    } finally { fs.rmSync(dest, { recursive: true, force: true }); }
  }
}
