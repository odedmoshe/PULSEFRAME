/**
 * Local speech recognition (SPEC §16; blocker B-7). Optional: without the engine or the model the editor works as before and
 * this reports an honest setup state.
 *
 * - The engine is a Python worker (apps/server/speech/pf_speech.py, faster-whisper) started per job with `python -I`.
 *   `PF_SPEECH_PYTHON` names the interpreter of an environment that has the engine installed.
 * - Model files are pinned by revision, byte size and SHA-256 and handled by the same verified store as provider models
 *   (models.ts): a download is an explicit owner action for the exact missing bytes; the worker itself never downloads.
 * - Recognition is a durable job. Its result is checked (times inside the media, ascending, no empty words) and attached with
 *   the internal `attach_transcript` operation, so it is an ordinary undoable transaction. Nothing is attached when no speech
 *   was recognised, and nothing is ever invented here: text, times and confidence are the recogniser's.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { timeOriginSeconds } from '@pulseframe/core';
import type { CapabilityDescriptor } from '@pulseframe/providers';
import * as T from '@pulseframe/time';
import type { Principal } from './auth.ts';
import type { Config } from './config.ts';
import type { Governance } from './governance.ts';
import { ModelStore, type ModelStatus } from './models.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

type ModelFile = CapabilityDescriptor['models'][number];
export interface SpeechModel { id: string; kind: 'asr'; title: { he: string; en: string }; languages: string[]; note: string; engineModel: string; dir: string; files: ModelFile[] }

const IVRIT_REV = '72ad623a37947395efcc3933132353790e5a12f5';
const ivrit = (name: string, bytes: number, sha256: string): ModelFile => ({
  role: 'asr', path: `asr/ivrit-ai-whisper-large-v3-turbo-ct2/${name}`, publisher: 'ivrit-ai', revision: IVRIT_REV, sha256, bytes,
  license: 'Apache-2.0', licenseEvidence: `model card of ivrit-ai/whisper-large-v3-turbo-ct2@${IVRIT_REV.slice(0, 8)} is tagged license:apache-2.0 (metadata-level check; training-data terms not reviewed)`,
  commercialUse: 'allowed', gated: false, source: `https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2/resolve/${IVRIT_REV}/${name}`,
});
/** Reviewed, pinned models. Adding one means reviewing its licence and recording size and digest of every file here. */
export const SPEECH_MODELS: SpeechModel[] = [{
  id: 'asr.ivrit-turbo', kind: 'asr',
  title: { he: 'זיהוי דיבור בעברית (ivrit.ai, Whisper large-v3-turbo)', en: 'Hebrew speech recognition (ivrit.ai, Whisper large-v3-turbo)' },
  languages: ['he'], note: 'Fine-tuned for Hebrew. Other languages are not what it was tuned for and were not checked.',
  engineModel: `ivrit-ai/whisper-large-v3-turbo-ct2@${IVRIT_REV.slice(0, 8)}`, dir: 'asr/ivrit-ai-whisper-large-v3-turbo-ct2',
  files: [
    ivrit('model.bin', 1617884968, 'db2a2265aa012c16c7db9edda3d699c99f984efdd3f2e22a72a8ce7e9720f3a2'),
    ivrit('config.json', 1405, 'c805eff43fc2a1d00d5cfa315e4b2230895f34994257c185959808a116e7c4f0'),
    ivrit('preprocessor_config.json', 357, '654cf18d3e163b948ceaf9766da56ce0b52de265d58673cf61c9376f126bd499'),
    ivrit('tokenizer.json', 2710337, '297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd'),
    ivrit('vocabulary.json', 1068114, 'c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1'),
  ],
}];

export const TranscribeBody = z.object({
  language: z.string().regex(/^[a-z]{2,3}$|^auto$/).optional().describe('Spoken language as a two-letter code (default he), or auto to let the recogniser decide from the first 30 seconds'),
  overwrite: z.boolean().optional().describe('Required when the asset already has a transcript: recognising again replaces it, including corrections made by hand'),
}).strict();

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../speech/pf_speech.py');
const DOWNLOAD = 'speech-model-download', TRANSCRIBE = 'transcribe';
/** No single recognition may run longer than this. */
const MAX_RUN_MS = 12 * 3600_000;

interface WorkerWord { start: number; end: number; text: string; probability: number }
interface WorkerSegment { start: number; end: number; text: string; words: WorkerWord[]; compressionRatio?: number }
/** A phrase is degenerate when the recogniser fell into repetition: its text compresses far better than language does, or a word is one character repeated many times. Such phrases are dropped and counted, never shown as speech. */
const degenerate = (s: WorkerSegment) => (s.compressionRatio ?? 0) > 2.4 || /(.)\1{9,}/u.test(s.text) || /(\S{2,12})(?:\s*\1){7,}/u.test(s.text);
const WorkerResult = z.object({
  device: z.string(), computeType: z.string(), language: z.string().min(2).max(35), languageProbability: z.number(), duration: z.number(), speechDuration: z.number(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string(), compressionRatio: z.number().optional(), words: z.array(z.object({ start: z.number(), end: z.number(), text: z.string(), probability: z.number() })) })),
});

/**
 * Turn the recogniser's seconds into exact millisecond rationals that satisfy the transcript rules (phrases in order without
 * overlap, words in order inside their phrase, everything inside the media). Times are only ever moved onto a neighbour's
 * boundary or the end of the media; `adjusted` counts how many were. Words without text and phrases without any length are dropped.
 */
export function sanitizeRecognition(segments: WorkerSegment[], mediaSeconds: number) {
  const limit = Math.max(0, Math.round(mediaSeconds * 1000));
  const ms = (x: number) => Math.min(limit, Math.max(0, Math.round(x * 1000)));
  const rt = (v: number) => T.rt(v, 1000);
  const out: { start: T.RationalTime; duration: T.RationalTime; text: string; words: { text: string; start: T.RationalTime; duration: T.RationalTime; confidence: number }[] }[] = [];
  let prevEnd = 0, adjusted = 0, dropped = 0, words = 0, low = 0, garbled = 0;
  for (const s of [...segments].sort((a, b) => a.start - b.start)) {
    if (degenerate(s)) { garbled++; continue; }
    const ws = s.words.map((w) => ({ text: w.text.trim().slice(0, 200), s: ms(w.start), e: ms(w.end), p: Math.min(1, Math.max(0, w.probability)) })).filter((w) => w.text);
    let start = Math.min(ms(s.start), ws[0]?.s ?? Infinity), end = Math.max(ms(s.end), ws.at(-1)?.e ?? 0);
    if (start < prevEnd) { start = prevEnd; adjusted++; }
    if (end <= start) { dropped++; continue; }
    let cursor = start;
    const list = ws.slice(0, 2000).map((w) => {
      let a = w.s, b = w.e;
      if (a < cursor) { a = cursor; adjusted++; }
      if (a > end) { a = end; adjusted++; }
      if (b < a) { b = a; adjusted++; }
      if (b > end) { b = end; adjusted++; }
      cursor = b;
      if (w.p < 0.5) low++;
      return { text: w.text, start: rt(a), duration: rt(b - a), confidence: Number(w.p.toFixed(3)) };
    });
    const text = s.text.trim().slice(0, 4000);
    if (!text && !list.length) { dropped++; continue; }
    words += list.length;
    out.push({ start: rt(start), duration: rt(end - start), text: text || list.map((w) => w.text).join(' '), words: list });
    prevEnd = end;
  }
  return { segments: out, stats: { phrases: out.length, words, lowConfidenceWords: low, adjustedTimes: adjusted, droppedPhrases: dropped, degeneratePhrases: garbled } };
}

export class Speech {
  readonly models: ModelStore;
  private readonly dir: string;
  private probed: { at: number; value: Awaited<ReturnType<Speech['probe']>> } | null = null;
  private running = new Map<string, ChildProcess>();
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private store: Store, private cfg: Config) {
    this.dir = cfg.speechModelsDir;
    this.models = new ModelStore(this.dir, cfg.modelHosts);
  }

  private worker(args: string[], onLine: (o: any) => void, jobId?: string): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      // -I: the interpreter ignores the environment and the current directory when importing, so only the worker and its installed packages run.
      const p = spawn(this.cfg.speechPython!, ['-I', WORKER, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: MAX_RUN_MS, killSignal: 'SIGKILL' });
      if (jobId) this.running.set(jobId, p);
      let buf = '', err = '';
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', (d: string) => {
        buf += d;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          try { onLine(JSON.parse(line)); } catch { /* not a protocol line */ }
        }
      });
      p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
      p.on('error', (e) => { if (jobId) this.running.delete(jobId); reject(new ApiError(503, 'speech_engine_unavailable', `the speech worker could not be started: ${e.message}`)); });
      p.on('close', (code) => { if (jobId) this.running.delete(jobId); resolve({ code, stderr: err }); });
    });
  }
  private async probe(): Promise<{ configured: boolean; ok: boolean; detail: string; engine?: string; version?: string; python?: string; cudaDevices?: number }> {
    if (!this.cfg.speechPython) return { configured: false, ok: false, detail: 'PF_SPEECH_PYTHON is not set: no speech engine is configured' };
    let result: any = null;
    try {
      const r = await this.worker(['probe'], (o) => { if (o.event === 'result') result = o; });
      if (!result) return { configured: true, ok: false, detail: `the speech worker did not answer (exit ${r.code})` };
    } catch (e: any) { return { configured: true, ok: false, detail: e.message }; }
    if (!result.asr) return { configured: true, ok: false, python: result.python, detail: `the recognition engine is not installed in that Python environment (${result.asrError ?? 'import failed'})` };
    return { configured: true, ok: true, detail: 'engine answers', engine: result.asr.engine, version: result.asr.version, python: result.python, cudaDevices: result.cudaDevices };
  }
  private async engine() {
    if (!this.probed || Date.now() - this.probed.at > 60_000 || !this.probed.value.ok) this.probed = { at: Date.now(), value: await this.probe() };
    return this.probed.value;
  }
  private async modelStatus(m: SpeechModel) {
    const files: ModelStatus[] = [];
    for (const f of m.files) files.push(await this.models.status(f));
    const missingBytes = files.reduce((n, f) => n + (f.state === 'ready' ? 0 : f.missingBytes), 0);
    return { id: m.id, kind: m.kind, title: m.title, languages: m.languages, note: m.note, engineModel: m.engineModel, license: m.files[0]!.license, licenseEvidence: m.files[0]!.licenseEvidence, totalBytes: m.files.reduce((n, f) => n + f.bytes!, 0), missingDownloadBytes: missingBytes, ready: missingBytes === 0, files };
  }
  /** Honest setup state: what is installed, what is missing, and what that means. Read-only. */
  async status() {
    const engine = await this.engine();
    const models = [];
    for (const m of SPEECH_MODELS) models.push(await this.modelStatus(m));
    const asr = models.find((m) => m.kind === 'asr' && m.ready);
    const device = this.cfg.speechDevice === 'auto' ? (engine.cudaDevices ? 'cuda' : 'cpu') : this.cfg.speechDevice;
    return {
      transcription: {
        ready: engine.ok && !!asr,
        reason: !engine.configured ? 'engine_not_configured' : !engine.ok ? 'engine_not_working' : !asr ? 'model_missing' : null,
        detail: !engine.ok ? engine.detail : !asr ? 'the recognition model has not been downloaded' : `ready on ${device}`,
        device: engine.ok ? device : null,
        qualification: 'functional only: accuracy, Hebrew word timing and speed have not been qualified',
      },
      engine, models, modelsDir: this.dir,
    };
  }

  /** Explicit, human-authorised download of one pinned model, bound to the exact missing byte count that was shown. */
  async startDownload(projectId: string, modelId: string, confirmBytes: number, actor: string): Promise<JobRow> {
    const m = SPEECH_MODELS.find((x) => x.id === modelId);
    if (!m) throw new ApiError(404, 'not_found', `speech model ${modelId} is not in the reviewed list`, { known: SPEECH_MODELS.map((x) => x.id) });
    this.store.getProject(projectId);
    const st = await this.modelStatus(m);
    if (st.ready) throw new ApiError(409, 'models_already_ready', 'every file of this model is present and verified');
    if (confirmBytes !== st.missingDownloadBytes) throw new ApiError(409, 'download_size_mismatch', `this download is ${st.missingDownloadBytes} bytes; confirmBytes was ${confirmBytes}`, { missingDownloadBytes: st.missingDownloadBytes }, 'Read the speech status again and confirm the exact size shown.');
    const job = this.store.createJob(projectId, DOWNLOAD, actor, { modelId, approvedBytes: st.missingDownloadBytes });
    void this.driveDownload(job.id);
    return job;
  }
  private async driveDownload(jobId: string) {
    const started = Date.now();
    const ctl = new AbortController();
    this.aborts.set(jobId, ctl);
    try {
      const m = SPEECH_MODELS.find((x) => x.id === this.store.getJob(jobId).input.modelId);
      if (!m) throw new ApiError(409, 'not_found', 'this model is no longer in the reviewed list');
      this.store.updateJob(jobId, { status: 'running', stage: 'preparing', attempt: 1 });
      const done: ModelStatus[] = [];
      for (const f of m.files) {
        let last = 0;
        done.push(await this.models.download(f, (got, total) => {
          if (got - last < 8 << 20 && got !== total) return;
          last = got;
          this.store.updateJob(jobId, { stage: `downloading ${path.basename(f.path)}: ${got}/${total} bytes (measured)` });
        }, ctl.signal));
      }
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { modelId: m.id, files: done, wallSeconds: (Date.now() - started) / 1000 } });
    } catch (e: any) {
      if (this.stopped) return; // shutting down: the row stays as it is and the download resumes on the next start
      if (ctl.signal.aborted) this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'the download was canceled; the part already fetched is kept and a new download resumes from it' } });
      else this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'model_download_failed', message: String(e?.message ?? e), retryable: true } });
    } finally { this.aborts.delete(jobId); }
  }
  private aborts = new Map<string, AbortController>();

  private assertTranscribable(projectId: string, a: z.infer<typeof TranscribeBody> & { assetId: string }) {
    const p = this.store.getProject(projectId);
    const asset = p.doc.assets[a.assetId];
    if (!asset) throw new ApiError(404, 'not_found', `asset ${a.assetId} not found`, { assetId: a.assetId });
    if (!asset.audio) throw new ApiError(422, 'no_audio', 'this asset has no audio to transcribe');
    if (p.doc.transcripts?.[a.assetId] && !a.overwrite) throw new ApiError(409, 'would_replace_transcript', 'this asset already has a transcript; recognising again would replace it, including corrections made by hand', { assetId: a.assetId }, 'Pass overwrite=true to replace it.');
    return { asset, revision: p.revision };
  }
  /** Start recognition as a durable job. Refused, with the reason, when the engine or the model is not ready. */
  async startTranscription(gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof TranscribeBody> & { assetId: string }): Promise<JobRow> {
    gov.assertMayAct(principal, projectId, 'edit');
    gov.assertUnrestricted(principal, 'attach a transcript');
    const { revision } = this.assertTranscribable(projectId, a);
    const st = await this.status();
    if (!st.transcription.ready) throw new ApiError(409, 'speech_not_ready', `automatic transcription is not set up: ${st.transcription.detail}`, { reason: st.transcription.reason }, 'A typed or imported (SRT/VTT) transcript works without it.');
    const model = st.models.find((m) => m.kind === 'asr' && m.ready)!;
    const job = this.store.createJob(projectId, TRANSCRIBE, principal.actor, { assetId: a.assetId, language: a.language ?? 'he', ...(a.overwrite ? { overwrite: true } : {}), modelId: model.id, projectRevision: revision });
    this.enqueue(job.id);
    return this.store.getJob(job.id);
  }
  /** One recognition at a time: each uses every core (or the whole GPU). */
  private enqueue(jobId: string) {
    this.chain = this.chain.then(() => this.run(jobId)).catch((e) => console.error(e));
  }
  private canceled(jobId: string) { return ['cancel-requested', 'canceled'].includes(this.store.getJob(jobId).status); }
  private async run(jobId: string) {
    if (this.stopped || this.store.getJob(jobId).status !== 'queued') return;
    const j = this.store.getJob(jobId);
    const started = Date.now();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-asr-'));
    try {
      this.store.updateJob(jobId, { status: 'running', stage: 'reading the audio', attempt: j.attempt + 1 });
      const { asset } = this.assertTranscribable(j.projectId, j.input);
      const model = SPEECH_MODELS.find((m) => m.id === j.input.modelId);
      if (!model || !(await this.modelStatus(model)).ready) throw new ApiError(409, 'speech_not_ready', 'the recognition model is no longer present and verified');
      const seconds = T.toSeconds(asset.duration);
      const wav = path.join(tmp, 'audio.wav');
      await this.extract(this.store.blobPath(asset.contentHash), timeOriginSeconds(asset), wav, jobId);
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      let result: unknown = null, failure: { code: string; message: string } | null = null, lastStage = 0;
      this.store.updateJob(jobId, { stage: `recognising speech: 0 of ${Math.round(seconds)} s` });
      const r = await this.worker(['transcribe', '--model', path.join(this.dir, model.dir), '--audio', wav, '--language', j.input.language, '--device', this.cfg.speechDevice], (o) => {
        if (o.event === 'result') result = o;
        else if (o.event === 'error') failure = { code: String(o.code), message: String(o.message).slice(0, 500) };
        else if (o.event === 'progress' && Date.now() - lastStage > 1000) { lastStage = Date.now(); this.store.updateJob(jobId, { stage: `recognising speech: ${Math.round(o.seconds)} of ${Math.round(seconds)} s` }); }
      }, jobId);
      if (this.stopped) return; // leave the row 'running': it is recognised again after the restart
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (failure) throw new ApiError(502, 'transcription_failed', `the recogniser reported: ${(failure as { message: string }).message}`, { engineCode: (failure as { code: string }).code });
      const parsed = WorkerResult.safeParse(result);
      if (!parsed.success) throw new ApiError(502, 'transcription_failed', `the recogniser ended without a usable result (exit ${r.code})`, { tail: r.stderr.slice(-400) });
      const { segments, stats } = sanitizeRecognition(parsed.data.segments, seconds);
      const run = { engine: `${this.probed?.value.engine ?? 'faster-whisper'} ${this.probed?.value.version ?? ''}`.trim(), model: model.engineModel, device: parsed.data.device, computeType: parsed.data.computeType, audioSeconds: Number(seconds.toFixed(3)), speechSeconds: Number(parsed.data.speechDuration.toFixed(3)), wallSeconds: (Date.now() - started) / 1000, language: parsed.data.language, languageProbability: Number(parsed.data.languageProbability.toFixed(3)) };
      if (!segments.length) { this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { assetId: asset.id, attached: false, note: stats.degeneratePhrases ? 'the recogniser produced only repetition, not words; nothing was attached' : 'no speech was recognised; nothing was attached', ...stats, run } }); return; }
      // Recognition takes a while: the asset may be gone, or a transcript typed, since it started.
      this.assertTranscribable(j.projectId, j.input);
      const c = this.store.commit({ projectId: j.projectId, actor: j.actor, label: 'Recognise speech', allowInternal: true, ops: [{ op: 'attach_transcript', args: { assetId: asset.id, language: parsed.data.language, provider: 'local:faster-whisper', model: model.engineModel, createdAt: new Date().toISOString(), segments } }] });
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { assetId: asset.id, attached: true, revision: c.revision, ...stats, run, note: `Machine recognition: check the text before publishing. Word times are the recogniser's estimates.${stats.degeneratePhrases ? ` ${stats.degeneratePhrases} phrase(s) were left out because the recogniser produced repetition instead of words there.` : ''}` } });
    } catch (e: any) {
      if (this.stopped) return;
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (!(e instanceof ApiError)) console.error(e);
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'transcription failed unexpectedly' } });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  private finishCanceled(jobId: string) {
    this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing was attached' } });
  }
  /** 16 kHz mono on the asset's own clock: second 0 of the file is second 0 of the asset (see analysis.ts on `origin`). */
  private extract(file: string, origin: number, wav: string, jobId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=16000:first_pts=${Math.round(origin * 16000)},asetpts=PTS-STARTPTS`, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', wav], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30 * 60_000, killSignal: 'SIGKILL' });
      this.running.set(jobId, p);
      let err = '';
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', (e) => { this.running.delete(jobId); reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)); });
      p.on('close', (code) => { this.running.delete(jobId); code === 0 ? resolve() : reject(new ApiError(422, 'analysis_failed', 'the audio of this file could not be read', { tail: err.slice(-400) })); });
    });
  }

  handles(job: JobRow) { return job.type === DOWNLOAD || job.type === TRANSCRIBE; }
  cancel(jobId: string, actor: string) {
    const j = this.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    if (j.type === DOWNLOAD) { this.aborts.get(jobId)?.abort(); if (!this.aborts.has(jobId)) this.finishCanceled(jobId); return { jobId, status: 'canceled', outcome: 'download-stopped' }; }
    if (j.status === 'queued') { this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started` } }); return { jobId, status: 'canceled', outcome: 'removed-from-queue' }; }
    this.store.updateJob(jobId, { status: 'cancel-requested' });
    this.running.get(jobId)?.kill('SIGKILL');
    return { jobId, status: 'cancel-requested', outcome: 'stopping', note: 'the recogniser is being stopped; nothing will be attached' };
  }
  /** Jobs interrupted by a restart: downloads resume from the part on disk, recognitions start again. */
  recover(): number {
    const downloads = this.store.recoverJobs(DOWNLOAD), jobs = this.store.recoverJobs(TRANSCRIBE);
    for (const j of downloads) void this.driveDownload(j.id);
    for (const j of jobs) this.enqueue(j.id);
    return downloads.length + jobs.length;
  }
  async stop() {
    this.stopped = true;
    for (const c of this.aborts.values()) c.abort();
    for (const p of this.running.values()) p.kill('SIGKILL');
    await this.chain.catch(() => {});
  }
}
