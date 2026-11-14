/**
 * Server export route (SPEC §9), software profile:
 *   immutable snapshot -> headless Chromium runs the shared evaluator + Canvas2D compositor
 *   -> raw RGBA frames (their own stream) -> ffmpeg libx264
 *   audio is rendered separately by ffmpeg to a sample-exact WAV, then muxed as a second input.
 * Jobs are durable rows; a job interrupted by a restart re-runs from its immutable snapshot and
 * publishes its output with an atomic rename, so a retry never yields a duplicate or partial file.
 */
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import * as T from '@pulseframe/time';
import { sequenceDuration, type ProjectDocument } from '@pulseframe/core';
import type { RenderHost } from '@pulseframe/renderer';
import { ffprobe } from './ingest.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

const exec = promisify(execFile);

export interface RenderSession {
  doc: ProjectDocument;
  revision: number;
  jobId: string | null;
  frameBytes: number;
  totalFrames: number;
  nextFrame: number;
  sink: ChildProcessWithoutNullStreams | null;
}

export class Exporter {
  readonly sessions = new Map<string, RenderSession>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private store: Store, private host: RenderHost, private renderPageUrl: () => string, private webDist: string) {}

  private open(doc: ProjectDocument, revision: number, jobId: string | null): { token: string; session: RenderSession; url: string } {
    if (!fs.existsSync(path.join(this.webDist, 'render.html')))
      throw new ApiError(503, 'renderer_unavailable', 'the web bundle containing the render page has not been built', {}, 'Run `pnpm build` and retry.');
    const token = randomBytes(24).toString('base64url');
    const { width, height, frameRate } = doc.settings;
    const session: RenderSession = { doc, revision, jobId, frameBytes: width * height * 4, totalFrames: T.frameCount(sequenceDuration(doc), frameRate), nextFrame: 0, sink: null };
    this.sessions.set(token, session);
    return { token, session, url: `${this.renderPageUrl()}#token=${token}` };
  }

  /** Agent sense / parity reference: one frame through the same compositor as export, as PNG. */
  async renderStill(doc: ProjectDocument, revision: number, frameIndex: number): Promise<Buffer> {
    const { token, session, url } = this.open(doc, revision, null);
    try {
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= Math.max(1, session.totalFrames))
        throw new ApiError(422, 'out_of_bounds', `frame ${frameIndex} is outside 0..${session.totalFrames - 1}`, { frameCount: session.totalFrames });
      return await this.host.renderStill(url, frameIndex);
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
    if (!s || !s.sink) throw new ApiError(404, 'render_session_not_found', 'unknown render session');
    if (first !== s.nextFrame) throw new ApiError(409, 'frame_out_of_order', `expected frame ${s.nextFrame}, got ${first}`);
    if (data.length === 0 || data.length % s.frameBytes !== 0) throw new ApiError(400, 'bad_frame_size', 'payload is not a whole number of RGBA frames');
    const count = data.length / s.frameBytes;
    if (s.nextFrame + count > s.totalFrames) throw new ApiError(400, 'too_many_frames', 'more frames than the snapshot contains');
    s.nextFrame += count;
    const sink = s.sink;
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      sink.stdin.once('error', onErr);
      const done = () => { sink.stdin.off('error', onErr); resolve(); };
      if (sink.stdin.write(data)) done();
      else sink.stdin.once('drain', done);
    });
    if (s.jobId) this.store.updateJob(s.jobId, { stage: `rendering ${s.nextFrame}/${s.totalFrames}` });
  }

  /** Sample-exact audio mix of the snapshot as a WAV file (separate stream from video). */
  private async renderAudio(doc: ProjectDocument, totalSamples: number, outFile: string) {
    const sr = doc.settings.sampleRate;
    const seq = doc.sequences[doc.mainSequenceId]!;
    const clips = seq.tracks.filter((t) => t.kind === 'audio' && !t.muted).flatMap((t) => t.clips).filter((c) => c.type === 'media' && c.gain > 0 && doc.assets[c.assetId]?.audio);
    const args = ['-hide_banner', '-v', 'error', '-y', '-protocol_whitelist', 'file,pipe'];
    const filters: string[] = [];
    clips.forEach((c, i) => {
      if (c.type !== 'media') return;
      args.push('-i', this.store.blobPath(doc.assets[c.assetId]!.contentHash));
      // Positions are rounded from absolute times, never accumulated (SPEC §5).
      const at = T.nearestSampleIndex(c.start, sr);
      const len = T.nearestSampleIndex(T.add(c.start, c.duration), sr) - at;
      const src = T.nearestSampleIndex(c.sourceIn, sr);
      filters.push(`[${i}:a:0]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=start_sample=${src}:end_sample=${src + len},asetpts=PTS-STARTPTS,volume=${c.gain.toFixed(6)},adelay=delays=${at}S:all=1[c${i}]`);
    });
    const tail = `apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples}[out]`;
    if (clips.length === 0) filters.push(`anullsrc=r=${sr}:cl=stereo,atrim=end_sample=${totalSamples}[out]`);
    else if (clips.length === 1) filters.push(`[c0]${tail}`);
    else filters.push(`${clips.map((_, i) => `[c${i}]`).join('')}amix=inputs=${clips.length}:normalize=0:dropout_transition=0,${tail}`);
    args.push('-filter_complex', filters.join(';'), '-map', '[out]', '-ar', String(sr), '-ac', '2', '-c:a', 'pcm_s16le', '-f', 'wav', outFile);
    await exec('ffmpeg', args, { timeout: 600_000, maxBuffer: 8 << 20 });
    return clips.length;
  }

  private async run(jobId: string) {
    const job = this.store.getJob(jobId);
    if (job.status !== 'queued') return;
    const attempt = job.attempt + 1;
    this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt });
    const work = path.join(this.store.tmpDir, `${jobId}_${attempt}`);
    fs.mkdirSync(work, { recursive: true });
    const doc: ProjectDocument = job.input.snapshot;
    let token: string | undefined;
    const started = Date.now();
    try {
      const { width, height, frameRate, sampleRate } = doc.settings;
      if (width % 2 || height % 2) throw new ApiError(422, 'unsupported_export', 'H.264 4:2:0 export needs even width and height', { width, height });
      const opened = this.open(doc, job.input.revision, jobId);
      token = opened.token;
      const s = opened.session;
      if (s.totalFrames === 0) throw new ApiError(422, 'empty_sequence', 'the sequence has no clips to export');
      const duration = T.frameTime(s.totalFrames, frameRate);
      const totalSamples = T.nearestSampleIndex(duration, sampleRate);
      const wav = path.join(work, 'mix.wav');
      this.store.updateJob(jobId, { stage: 'rendering audio' });
      const audioClips = await this.renderAudio(doc, totalSamples, wav);
      const partial = path.join(work, 'out.mp4');
      const ff = spawn('ffmpeg', [
        '-hide_banner', '-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${width}x${height}`, '-framerate', `${frameRate.num}/${frameRate.den}`, '-i', 'pipe:0',
        '-i', wav, '-map', '0:v:0', '-map', '1:a:0',
        '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-profile:v', 'high',
        '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-f', 'mp4', partial,
      ]);
      let stderr = '';
      ff.stderr.on('data', (d) => (stderr += d));
      ff.stdin.on('error', () => {});
      const exited = new Promise<number>((res) => ff.on('close', (code) => res(code ?? -1)));
      s.sink = ff;
      this.store.updateJob(jobId, { stage: `rendering 0/${s.totalFrames}` });
      const renderStats = await this.host.renderAll(opened.url);
      if (s.nextFrame !== s.totalFrames) throw new Error(`renderer delivered ${s.nextFrame} of ${s.totalFrames} frames`);
      ff.stdin.end();
      this.store.updateJob(jobId, { stage: 'encoding' });
      const code = await exited;
      if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`);
      this.store.updateJob(jobId, { stage: 'validating' });
      const probe = await ffprobe(partial);
      const v = probe.streams.find((x: any) => x.codec_type === 'video');
      const a = probe.streams.find((x: any) => x.codec_type === 'audio');
      const validation = { videoCodec: v?.codec_name, audioCodec: a?.codec_name, frames: Number(v?.nb_frames), expectedFrames: s.totalFrames, width: v?.width, height: v?.height, frameRate: v?.r_frame_rate, pixFmt: v?.pix_fmt, colorSpace: v?.color_space, audioSampleRate: Number(a?.sample_rate), durationSeconds: Number(probe.format.duration) };
      if (validation.videoCodec !== 'h264' || validation.audioCodec !== 'aac' || validation.frames !== s.totalFrames || v.width !== width || v.height !== height)
        throw new Error(`export failed validation: ${JSON.stringify(validation)}`);
      const final = path.join(this.store.outDir, `${jobId}.mp4`);
      fs.renameSync(partial, final);
      this.store.updateJob(jobId, {
        status: 'succeeded', stage: null,
        output: { file: `${jobId}.mp4`, bytes: fs.statSync(final).size, revision: job.input.revision, route: 'server-software-canvas2d', audioClipsMixed: audioClips, validation, renderStageMs: renderStats.stageMs, wallSeconds: (Date.now() - started) / 1000, realtimeFactor: T.toSeconds(duration) / ((Date.now() - started) / 1000) },
      });
    } catch (e: any) {
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'export_failed', message: String(e?.message ?? e), retryable: true } });
    } finally {
      if (token) {
        this.sessions.get(token)?.sink?.kill('SIGKILL');
        this.sessions.delete(token);
      }
      fs.rmSync(work, { recursive: true, force: true });
    }
  }
}
