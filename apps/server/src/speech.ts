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
import { createHash, randomBytes } from 'node:crypto';
import { alignPhrase, RationalTimeSchema, splitSentences, timeOriginSeconds, type Asset } from '@pulseframe/core';
import type { CapabilityDescriptor } from '@pulseframe/providers';
import * as T from '@pulseframe/time';
import type { Principal } from './auth.ts';
import type { Config } from './config.ts';
import type { Governance } from './governance.ts';
import { describeMedia } from './ingest.ts';
import { ModelStore, type ModelStatus } from './models.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

type ModelFile = CapabilityDescriptor['models'][number];
export interface SpeechModel { id: string; kind: 'asr' | 'tts'; title: { he: string; en: string }; languages: string[]; note: string; engineModel: string; dir: string; files: ModelFile[] }

const IVRIT_REV = '72ad623a37947395efcc3933132353790e5a12f5';
const ivrit = (name: string, bytes: number, sha256: string): ModelFile => ({
  role: 'asr', path: `asr/ivrit-ai-whisper-large-v3-turbo-ct2/${name}`, publisher: 'ivrit-ai', revision: IVRIT_REV, sha256, bytes,
  license: 'Apache-2.0', licenseEvidence: `model card of ivrit-ai/whisper-large-v3-turbo-ct2@${IVRIT_REV.slice(0, 8)} is tagged license:apache-2.0 (metadata-level check; training-data terms not reviewed)`,
  commercialUse: 'allowed', gated: false, source: `https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ct2/resolve/${IVRIT_REV}/${name}`,
});
const NIKUD_REV = 'b806189fe1fc0085b1012b7560ffb5e8ecfd72a2', NIKUD_PATH = 'tts/phonikud/phonikud-1.0.int8.onnx';
const CHATTERBOX_REV = '5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18';
const chatterbox = (name: string, bytes: number, sha256: string): ModelFile => ({
  role: 'tts', path: `tts/chatterbox-multilingual/${name}`, publisher: 'ResembleAI', revision: CHATTERBOX_REV, sha256, bytes,
  license: 'MIT', licenseEvidence: `model card of ResembleAI/chatterbox@${CHATTERBOX_REV.slice(0, 8)} is tagged license:mit (metadata-level check; training-data terms not reviewed)`,
  commercialUse: 'allowed', gated: false, source: `https://huggingface.co/ResembleAI/chatterbox/resolve/${CHATTERBOX_REV}/${name}`,
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
}, {
  id: 'tts.chatterbox-multilingual', kind: 'tts',
  title: { he: 'קריינות מטקסט (Chatterbox רב־לשוני, Resemble AI)', en: 'Text to speech (Chatterbox Multilingual, Resemble AI)' },
  languages: ['he', 'en', 'ar', 'ru', 'fr', 'es', 'de'], note: 'Speaks 23 languages; only Hebrew was tried here. Can speak in the voice of a reference recording. Output carries the engine\'s inaudible watermark.',
  engineModel: `ResembleAI/chatterbox@${CHATTERBOX_REV.slice(0, 8)} (t3_mtl23ls_v2) + Phonikud/phonikud-onnx@${NIKUD_REV.slice(0, 8)} for Hebrew vowel points`, dir: 'tts/chatterbox-multilingual',
  files: [
    chatterbox('t3_mtl23ls_v2.safetensors', 2143989752, 'b1237586127ce98e7800a68e49938eb5092846862aabcb6e17b2fda7889a6c75'),
    chatterbox('s3gen.pt', 1057165844, '9b9ff07e60b20c136e2b1b3d7563a24604e8d2c4c267888d1ee929dd0151d2a3'),
    chatterbox('ve.pt', 5698626, '4b16d836bc598509860f6fa068165a8bb5e9ac84f05582dfcf278a5a372879f1'),
    chatterbox('conds.pt', 107374, '6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e'),
    chatterbox('grapheme_mtl_merged_expanded_v1.json', 69989, '69632f47220a788a52ce2661d096453c5655e9bf25289d89a8d832c46ee07dbf'),
    // Hebrew vowel pointing: without it this voice model garbles unpointed Hebrew (measured: see docs/evidence/voice-proof.json).
    { role: 'hebrew-pointing', path: NIKUD_PATH, publisher: 'Phonikud', revision: NIKUD_REV, sha256: '113afb58d3140502aa1e7691cdc6b240b56cf97e5852fc870e1a7fb5a400dd62', bytes: 307844158, license: 'MIT', licenseEvidence: `model card of Phonikud/phonikud-onnx@${NIKUD_REV.slice(0, 8)} is tagged license:mit (metadata-level check; training-data terms not reviewed)`, commercialUse: 'allowed', gated: false, source: `https://huggingface.co/Phonikud/phonikud-onnx/resolve/${NIKUD_REV}/phonikud-1.0.int8.onnx` },
  ],
}];

/** Languages the voice model accepts (its own list). */
export const NARRATION_LANGUAGES = ['ar', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ru', 'sv', 'sw', 'tr', 'zh'] as const;
export const NarrationBody = z.object({
  text: z.string().min(1).max(300).describe('What to say: one or two sentences (up to 300 characters). Longer narration is made sentence by sentence, so one sentence can be redone. Hebrew without vowel points is pointed automatically; text that already has points is spoken as written, which is how a wrong reading is corrected'),
  language: z.enum(NARRATION_LANGUAGES).optional().describe('Language of the text (default he)'),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional().describe('Same text, voice and seed give the same take on the same machine; another seed gives another take'),
  start: RationalTimeSchema.optional().describe('Place the result on the timeline at this frame-aligned time (omit to only add it to the media library)'),
  trackId: z.string().optional(),
  referenceAssetId: z.string().optional().describe('Speak in the voice heard in this project asset. Owner session only, and only with consent'),
  consent: z.object({ speaker: z.string().min(1).max(120).describe('Whose voice it is'), confirmed: z.literal(true).describe('The owner states that this person agreed to their voice being used this way') }).strict().optional(),
}).strict();
export const NarrationScriptBody = z.object({
  text: z.string().min(1).max(6000).describe('The whole script. It is split into sentences; each becomes its own narration clip, so one sentence can be redone later with generate_narration at the same place'),
  language: NarrationBody.shape.language,
  seed: NarrationBody.shape.seed.describe('Seed of the first sentence; each following sentence uses the next number'),
  start: RationalTimeSchema.describe('Where the first sentence goes on the timeline (frame-aligned); each following sentence starts where the previous one ends, plus the gap'),
  trackId: z.string().optional(),
  gapFrames: z.number().int().min(0).max(300).optional().describe('Silence between sentences, in frames (default 6)'),
  referenceAssetId: NarrationBody.shape.referenceAssetId,
  consent: NarrationBody.shape.consent,
}).strict();
const MAX_SCRIPT_SENTENCES = 60;
const CONSENT_STATEMENT = 'The project owner states that the person whose voice is in the reference recording agreed to it being used to generate this speech.';

export const TranscribeBody = z.object({
  language: z.string().regex(/^[a-z]{2,3}$|^auto$/).optional().describe('Spoken language as a two-letter code (default he), or auto to let the recogniser decide from the first 30 seconds'),
  overwrite: z.boolean().optional().describe('Required when the asset already has a transcript: recognising again replaces it, including corrections made by hand'),
  mode: z.enum(['recognise', 'align']).optional().describe('recognise (default) creates the transcript. align keeps an existing typed or imported transcript exactly as written and only gives its words the times heard in the sound; phrases that already have word times are left alone'),
}).strict();

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../speech/pf_speech.py');
const DOWNLOAD = 'speech-model-download', TRANSCRIBE = 'transcribe', NARRATE = 'narration';
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

interface EngineState { configured: boolean; ok: boolean; detail: string; engine?: string; version?: string; python?: string; cudaDevices?: number }

export class Speech {
  readonly models: ModelStore;
  private readonly dir: string;
  private running = new Map<string, ChildProcess>();
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(private store: Store, private cfg: Config) {
    this.dir = cfg.speechModelsDir;
    this.models = new ModelStore(this.dir, cfg.modelHosts);
  }

  private worker(python: string, args: string[], onLine: (o: any) => void, jobId?: string): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      // -I: the interpreter ignores the environment and the current directory when importing, so only the worker and its installed packages run.
      const p = spawn(python, ['-I', WORKER, ...args], { stdio: ['ignore', 'pipe', 'pipe'], timeout: MAX_RUN_MS, killSignal: 'SIGKILL' });
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
  /**
   * The same as `worker`, but through a process that stays alive between jobs so the model is loaded once
   * (`speechKeepSeconds`; 0 falls back to one process per job). One request at a time per interpreter: jobs already run in turn.
   * Killing the process (cancel, shutdown, idle timeout) only costs the next job a model load.
   */
  private kept = new Map<string, { p: ChildProcess; idle: NodeJS.Timeout | null; onLine: ((o: any) => void) | null; done: ((r: { code: number | null; stderr: string }) => void) | null; err: string }>();
  private request(python: string, args: string[], onLine: (o: any) => void, jobId: string): Promise<{ code: number | null; stderr: string }> {
    if (!this.cfg.speechKeepSeconds) return this.worker(python, args, onLine, jobId);
    const req: Record<string, string> = { cmd: args[0]! };
    for (let i = 1; i + 1 < args.length; i += 2) req[args[i]!.replace(/^--/, '').replaceAll('-', '_')] = args[i + 1]!;
    return new Promise((resolve, reject) => {
      let k = this.kept.get(python);
      if (!k) {
        const p = spawn(python, ['-I', WORKER, 'serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
        const entry = { p, idle: null as NodeJS.Timeout | null, onLine: null as ((o: any) => void) | null, done: null as ((r: { code: number | null; stderr: string }) => void) | null, err: '' };
        k = entry;
        this.kept.set(python, entry);
        let buf = '';
        p.stdout!.setEncoding('utf8');
        p.stdout!.on('data', (d: string) => {
          buf += d;
          for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            let o: any;
            try { o = JSON.parse(line); } catch { continue; }
            if (o.event === 'end') entry.done?.({ code: 0, stderr: entry.err });
            else if (o.event !== 'ready') entry.onLine?.(o);
          }
        });
        p.stderr!.on('data', (d) => { entry.err = (entry.err + d).slice(-4000); });
        p.stdin!.on('error', () => { /* the process went away; 'close' reports it */ });
        p.on('error', (e) => { if (this.kept.get(python) === entry) this.kept.delete(python); const d = entry.done; entry.done = null; if (d) reject(new ApiError(503, 'speech_engine_unavailable', `the speech worker could not be started: ${e.message}`)); });
        p.on('close', (code) => { if (this.kept.get(python) === entry) this.kept.delete(python); if (entry.idle) clearTimeout(entry.idle); entry.done?.({ code: code ?? 1, stderr: entry.err }); });
      }
      const entry = k;
      if (entry.idle) { clearTimeout(entry.idle); entry.idle = null; }
      entry.err = '';
      entry.onLine = onLine;
      entry.done = (r) => {
        entry.onLine = null; entry.done = null;
        this.running.delete(jobId);
        if (this.kept.get(python) === entry) { entry.idle = setTimeout(() => entry.p.kill('SIGKILL'), this.cfg.speechKeepSeconds * 1000); entry.idle.unref(); }
        resolve(r);
      };
      this.running.set(jobId, entry.p);
      entry.p.stdin!.write(`${JSON.stringify(req)}\n`);
    });
  }
  private async probeOne(python: string | null, what: 'asr' | 'tts'): Promise<EngineState> {
    const unset = what === 'asr' ? 'PF_SPEECH_PYTHON is not set: no speech engine is configured' : 'neither PF_VOICE_PYTHON nor PF_SPEECH_PYTHON is set: no voice engine is configured';
    if (!python) return { configured: false, ok: false, detail: unset };
    let result: any = null;
    try {
      const r = await this.worker(python, ['probe'], (o) => { if (o.event === 'result') result = o; });
      if (!result) return { configured: true, ok: false, detail: `the speech worker did not answer (exit ${r.code})` };
    } catch (e: any) { return { configured: true, ok: false, detail: e.message }; }
    const e = result[what];
    if (!e) return { configured: true, ok: false, python: result.python, detail: `the ${what === 'asr' ? 'recognition' : 'voice'} engine is not installed in that Python environment (${result[`${what}Error`] ?? 'import failed'})` };
    return { configured: true, ok: true, detail: 'engine answers', engine: e.engine, version: e.version, python: result.python, cudaDevices: what === 'asr' ? result.cudaDevices : result.torchCuda ? 1 : 0 };
  }
  private probes = new Map<string, { at: number; value: EngineState }>();
  private async engineOf(what: 'asr' | 'tts'): Promise<EngineState> {
    const cached = this.probes.get(what);
    if (cached && cached.value.ok && Date.now() - cached.at < 60_000) return cached.value;
    const value = await this.probeOne(what === 'asr' ? this.cfg.speechPython : this.cfg.voicePython ?? this.cfg.speechPython, what);
    this.probes.set(what, { at: Date.now(), value });
    return value;
  }
  private voicePython() { return (this.cfg.voicePython ?? this.cfg.speechPython)!; }
  private async modelStatus(m: SpeechModel) {
    const files: ModelStatus[] = [];
    for (const f of m.files) files.push(await this.models.status(f));
    const missingBytes = files.reduce((n, f) => n + (f.state === 'ready' ? 0 : f.missingBytes), 0);
    return { id: m.id, kind: m.kind, title: m.title, languages: m.languages, note: m.note, engineModel: m.engineModel, license: m.files[0]!.license, licenseEvidence: m.files[0]!.licenseEvidence, totalBytes: m.files.reduce((n, f) => n + f.bytes!, 0), missingDownloadBytes: missingBytes, ready: missingBytes === 0, files };
  }
  /** Honest setup state: what is installed, what is missing, and what that means. Read-only. */
  async status() {
    const engine = await this.engineOf('asr'), voiceEngine = await this.engineOf('tts');
    const models: Awaited<ReturnType<Speech['modelStatus']>>[] = [];
    for (const m of SPEECH_MODELS) models.push(await this.modelStatus(m));
    const part = (e: EngineState, kind: 'asr' | 'tts', missing: string, qualification: string) => {
      const m = models.find((x) => x.kind === kind && x.ready);
      const device = this.cfg.speechDevice === 'auto' ? (e.cudaDevices ? 'cuda' : 'cpu') : this.cfg.speechDevice;
      return { ready: e.ok && !!m, reason: !e.configured ? 'engine_not_configured' : !e.ok ? 'engine_not_working' : !m ? 'model_missing' : null, detail: !e.ok ? e.detail : !m ? missing : `ready on ${device}`, device: e.ok ? device : null, qualification };
    };
    return {
      transcription: part(engine, 'asr', 'the recognition model has not been downloaded', 'functional only: accuracy, Hebrew word timing and speed have not been qualified'),
      narration: { ...part(voiceEngine, 'tts', 'the voice model has not been downloaded', 'functional only: nobody has listened to the Hebrew output; pronunciation, naturalness and speed have not been qualified'), languages: NARRATION_LANGUAGES, maxCharacters: 300, voices: ['built-in', 'reference (owner session, with consent)'] },
      engine, voiceEngine, models, modelsDir: this.dir,
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
    const existing = p.doc.transcripts?.[a.assetId];
    if (a.mode === 'align') {
      if (!existing) throw new ApiError(404, 'no_transcript', 'this asset has no transcript to time', { assetId: a.assetId }, 'Import or type one first, or use mode=recognise.');
      if (!existing.segments.some((s) => s.timing !== 'word' && s.text.trim())) throw new ApiError(409, 'already_timed', 'every phrase of this transcript already has word times', { assetId: a.assetId });
    } else if (existing && !a.overwrite) throw new ApiError(409, 'would_replace_transcript', 'this asset already has a transcript; recognising again would replace it, including corrections made by hand', { assetId: a.assetId }, 'Pass overwrite=true to replace it.');
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
    const job = this.store.createJob(projectId, TRANSCRIBE, principal.actor, { assetId: a.assetId, language: a.language ?? 'he', ...(a.overwrite ? { overwrite: true } : {}), ...(a.mode === 'align' ? { mode: 'align' } : {}), modelId: model.id, projectRevision: revision });
    this.enqueue(job.id);
    return this.store.getJob(job.id);
  }
  /** One recognition at a time: each uses every core (or the whole GPU). */
  private enqueue(jobId: string) {
    this.chain = this.chain.then(() => (this.store.getJob(jobId).type === NARRATE ? this.narrate(jobId) : this.run(jobId))).catch((e) => console.error(e));
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
      const r = await this.request(this.cfg.speechPython!, ['transcribe', '--model', path.join(this.dir, model.dir), '--audio', wav, '--language', j.input.language, '--device', this.cfg.speechDevice], (o) => {
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
      const eng = this.probes.get('asr')?.value;
      const run = { engine: `${eng?.engine ?? 'faster-whisper'} ${eng?.version ?? ''}`.trim(), model: model.engineModel, device: parsed.data.device, computeType: parsed.data.computeType, audioSeconds: Number(seconds.toFixed(3)), speechSeconds: Number(parsed.data.speechDuration.toFixed(3)), wallSeconds: (Date.now() - started) / 1000, language: parsed.data.language, languageProbability: Number(parsed.data.languageProbability.toFixed(3)) };
      if (j.input.mode === 'align') {
        // The typed text stays; each phrase takes the times of the words heard inside it.
        const heard = segments.flatMap((sg) => sg.words.map((w) => ({ text: w.text, start: Math.round(T.toSeconds(w.start) * 1000), end: Math.round((T.toSeconds(w.start) + T.toSeconds(w.duration)) * 1000), confidence: w.confidence })));
        const tr = this.store.getProject(j.projectId).doc.transcripts[asset.id];
        if (!tr) throw new ApiError(409, 'no_transcript', 'the transcript was removed while the sound was being recognised');
        const rt = (v: number) => T.rt(v, 1000);
        const timed: { segmentId: string; approximate: boolean; words: { text: string; start: T.RationalTime; duration: T.RationalTime; confidence?: number }[] }[] = [];
        const tally = { same: 0, different: 0, estimated: 0, phrasesWord: 0, phrasesApproximate: 0, phrasesLeftAlone: 0 };
        for (const sg of tr.segments) {
          const typed = sg.text.split(/\s+/).filter(Boolean);
          if (sg.timing === 'word' || !typed.length) { tally.phrasesLeftAlone++; continue; }
          // phrase bounds rounded inward to the millisecond, so no word can fall outside the phrase
          const from = Math.ceil(T.toSeconds(sg.start) * 1000 - 1e-6), to = Math.floor((T.toSeconds(sg.start) + T.toSeconds(sg.duration)) * 1000 + 1e-6);
          if (to <= from) { tally.phrasesLeftAlone++; continue; }
          const al = alignPhrase(typed, heard.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to), from, to);
          tally.same += al.same; tally.different += al.different; tally.estimated += al.estimated;
          tally[al.timing === 'word' ? 'phrasesWord' : 'phrasesApproximate']++;
          timed.push({ segmentId: sg.id, approximate: al.timing !== 'word', words: al.words.map((w) => ({ text: w.text, start: rt(w.start), duration: rt(w.end - w.start), ...(w.confidence !== null ? { confidence: w.confidence } : {}) })) });
        }
        if (!timed.length) { this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { assetId: asset.id, attached: false, mode: 'align', note: 'no phrase needed timing; nothing was changed', ...tally, run } }); return; }
        const c = this.store.commit({ projectId: j.projectId, actor: j.actor, label: 'Time words from the sound', allowInternal: true, ops: [{ op: 'attach_word_timing', args: { assetId: asset.id, segments: timed } }] });
        this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { assetId: asset.id, attached: true, mode: 'align', revision: c.revision, ...tally, run, note: 'The text is unchanged. Words the recogniser did not hear have estimated times; their phrases are marked approximate and are not cut word by word unless that is allowed explicitly.' } });
        return;
      }
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

  /** The rules for speaking in a recorded voice, in one place: the owner's own session, a consent statement, a usable recording. */
  private referenceInput(principal: Principal, doc: { assets: Record<string, Asset> }, a: { referenceAssetId?: string; consent?: { speaker: string; confirmed: true } }) {
    if (!a.referenceAssetId) {
      if (a.consent) throw new ApiError(400, 'invalid_request', 'consent is only meaningful together with referenceAssetId');
      return {};
    }
    if (principal.kind !== 'user') throw new ApiError(403, 'human_approval_required', 'speaking in a recorded person\'s voice needs the owner\'s own consent statement; an agent credential cannot give it', {}, 'Use the built-in voice, or ask the owner to start this from the editor.');
    if (!a.consent) throw new ApiError(422, 'consent_required', 'a reference voice needs a consent statement: whose voice it is, and that they agreed', {}, 'Send consent: { speaker, confirmed: true }.');
    const ref = doc.assets[a.referenceAssetId];
    if (!ref) throw new ApiError(404, 'not_found', `asset ${a.referenceAssetId} not found`, { assetId: a.referenceAssetId });
    if (!ref.audio) throw new ApiError(422, 'no_audio', 'the reference asset has no sound');
    if (T.toSeconds(ref.duration) < 5) throw new ApiError(422, 'reference_too_short', 'the reference recording must be at least 5 seconds long', { seconds: Number(T.toSeconds(ref.duration).toFixed(2)) });
    return { referenceAssetId: a.referenceAssetId, consent: { speaker: a.consent.speaker, statement: CONSENT_STATEMENT, attestedBy: principal.actor, attestedAt: new Date().toISOString() } };
  }
  /**
   * Start a narration job: the text is spoken by the local voice model and the result becomes a normal audio asset with its
   * recipe in provenance. A reference voice is the owner's own decision with a consent statement; an agent cannot make one.
   */
  async startNarration(gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof NarrationBody>): Promise<JobRow> {
    gov.assertMayAct(principal, projectId, 'edit');
    gov.assertUnrestricted(principal, 'add media to the library');
    const p = this.store.getProject(projectId);
    const reference = this.referenceInput(principal, p.doc, a);
    if (!a.text.trim()) throw new ApiError(400, 'invalid_request', 'there is no text to speak');
    const st = await this.status();
    if (!st.narration.ready) throw new ApiError(409, 'voice_not_ready', `narration is not set up: ${st.narration.detail}`, { reason: st.narration.reason }, 'A recorded or imported voice file works without it.');
    const model = st.models.find((m) => m.kind === 'tts' && m.ready)!;
    const job = this.store.createJob(projectId, NARRATE, principal.actor, {
      text: a.text.trim(), language: a.language ?? 'he', seed: a.seed ?? randomBytes(4).readUInt32BE() >>> 1, modelId: model.id, projectRevision: p.revision,
      ...(a.start ? { start: a.start, ...(a.trackId ? { trackId: a.trackId } : {}) } : {}),
      ...reference,
    });
    this.enqueue(job.id);
    return this.store.getJob(job.id);
  }
  /**
   * Narrate a script: one job per sentence, run in order; each sentence is placed where the previous one ended.
   * A sentence that fails or is canceled leaves a hole of zero length: the next one takes its place.
   */
  async startNarrationScript(gov: Governance, principal: Principal, projectId: string, a: z.infer<typeof NarrationScriptBody>): Promise<{ jobs: JobRow[]; sentences: string[] }> {
    gov.assertMayAct(principal, projectId, 'edit');
    gov.assertUnrestricted(principal, 'add media to the library');
    const p = this.store.getProject(projectId);
    const reference = this.referenceInput(principal, p.doc, a);
    const sentences = splitSentences(a.text, 300);
    if (!sentences.length) throw new ApiError(400, 'invalid_request', 'there is no text to speak');
    if (sentences.length > MAX_SCRIPT_SENTENCES) throw new ApiError(422, 'script_too_long', `the script has ${sentences.length} sentences; at most ${MAX_SCRIPT_SENTENCES} are narrated in one request`, { sentences: sentences.length, max: MAX_SCRIPT_SENTENCES }, 'Send it in parts.');
    const st = await this.status();
    if (!st.narration.ready) throw new ApiError(409, 'voice_not_ready', `narration is not set up: ${st.narration.detail}`, { reason: st.narration.reason }, 'A recorded or imported voice file works without it.');
    const model = st.models.find((m) => m.kind === 'tts' && m.ready)!;
    const rate = p.doc.settings.frameRate;
    const gap = T.frameTime(a.gapFrames ?? 6, rate);
    const seed = a.seed ?? randomBytes(4).readUInt32BE() >>> 1;
    const script = randomBytes(6).toString('hex');
    const jobs: JobRow[] = [];
    for (const [i, text] of sentences.entries()) {
      const job = this.store.createJob(projectId, NARRATE, principal.actor, {
        text, language: a.language ?? 'he', seed: (seed + i) % 2 ** 31, modelId: model.id, projectRevision: p.revision,
        start: a.start, ...(a.trackId ? { trackId: a.trackId } : {}), script: { id: script, index: i, of: sentences.length, gap, ...(i ? { follows: jobs[i - 1]!.id } : {}) }, ...reference,
      });
      jobs.push(job);
    }
    for (const j of jobs) this.enqueue(j.id);
    return { jobs: jobs.map((j) => this.store.getJob(j.id)), sentences };
  }
  /** Where a sentence of a script goes: after the sentence before it (which may have failed, in which case its own place is taken). */
  private scriptPlace(j: JobRow): { start: unknown; trackId?: string } {
    const follows = j.input.script?.follows as string | undefined;
    if (!follows) return { start: j.input.start, ...(j.input.trackId ? { trackId: j.input.trackId } : {}) };
    const prev = this.store.getJob(follows);
    const next = prev.output?.script?.next ?? prev.error?.details?.script?.next;
    // a sentence that was canceled left no note of its place: it had the place of whatever came before it
    return next ?? this.scriptPlace(prev);
  }
  private ffmpeg(args: string[], jobId: string, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', ...args], { stdio: ['ignore', 'ignore', 'pipe'], timeout: 30 * 60_000, killSignal: 'SIGKILL' });
      this.running.set(jobId, p);
      let err = '';
      p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
      p.on('error', (e) => { this.running.delete(jobId); reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)); });
      p.on('close', (code) => { this.running.delete(jobId); code === 0 ? resolve() : reject(new ApiError(422, 'analysis_failed', what, { tail: err.slice(-400) })); });
    });
  }
  private async narrate(jobId: string) {
    if (this.stopped || this.store.getJob(jobId).status !== 'queued') return;
    const j = this.store.getJob(jobId);
    const started = Date.now();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tts-'));
    const place = this.scriptPlace(j);
    let next = place; // where the following sentence of a script goes if this one places nothing
    const scriptState = () => (j.input.script ? { script: { id: j.input.script.id, index: j.input.script.index, of: j.input.script.of, next } } : {});
    try {
      this.store.updateJob(jobId, { status: 'running', stage: 'loading the voice model', attempt: j.attempt + 1 });
      const model = SPEECH_MODELS.find((m) => m.id === j.input.modelId);
      if (!model || !(await this.modelStatus(model)).ready) throw new ApiError(409, 'voice_not_ready', 'the voice model is no longer present and verified');
      const textFile = path.join(tmp, 'text.txt'), raw = path.join(tmp, 'raw.wav'), out = path.join(tmp, 'narration.wav');
      fs.writeFileSync(textFile, j.input.text, 'utf8');
      const args = ['synthesize', '--model', path.join(this.dir, model.dir), '--text-file', textFile, '--out', raw, '--language', j.input.language, '--seed', String(j.input.seed), '--device', this.cfg.speechDevice, '--nikud', path.join(this.dir, NIKUD_PATH)];
      if (j.input.referenceAssetId) {
        const ref = this.store.getProject(j.projectId).doc.assets[j.input.referenceAssetId];
        if (!ref?.audio) throw new ApiError(409, 'not_found', 'the reference recording is no longer in the project');
        const refWav = path.join(tmp, 'reference.wav');
        // the first half minute is plenty for the voice encoder
        await this.ffmpeg(['-i', this.store.blobPath(ref.contentHash), '-map', '0:a:0', '-t', '30', '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', '-y', refWav], jobId, 'the reference recording could not be read');
        args.push('--reference', refWav);
      }
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      let result: any = null, failure: { code: string; message: string } | null = null;
      const r = await this.request(this.voicePython(), args, (o) => {
        if (o.event === 'result') result = o;
        else if (o.event === 'error') failure = { code: String(o.code), message: String(o.message).slice(0, 500) };
        else if (o.event === 'progress') this.store.updateJob(jobId, { stage: 'speaking the text' });
      }, jobId);
      if (this.stopped) return;
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (failure) throw new ApiError(502, 'narration_failed', `the voice engine reported: ${(failure as { message: string }).message}`, { engineCode: (failure as { code: string }).code });
      if (!result || !fs.existsSync(raw)) throw new ApiError(502, 'narration_failed', `the voice engine ended without a result (exit ${r.code})`, { tail: r.stderr.slice(-400) });
      // Checked before it may become an asset: it has a length and it is not silence.
      const pcm = fs.readFileSync(raw).subarray(44);
      const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      const seconds = samples.length / result.sampleRate;
      if (seconds < 0.2 || peak < 300) throw new ApiError(502, 'narration_failed', 'the voice engine produced no audible speech', { seconds: Number(seconds.toFixed(2)), peak });
      await this.ffmpeg(['-i', raw, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-bitexact', '-fflags', '+bitexact', '-y', out], jobId, 'the generated speech could not be converted');
      const bytes = fs.readFileSync(out);
      const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      const meta = await describeMedia(out);
      this.store.putBlob(contentHash, out, bytes.length, meta.mimeType);
      const eng = this.probes.get('tts')?.value;
      const name = `${j.input.text.replace(/\s+/g, ' ').slice(0, 40)}.wav`;
      const asset: Omit<Asset, 'id'> = { ...meta, name, contentHash, byteSize: bytes.length, provenance: { origin: 'generated', importedAt: new Date().toISOString(), importedBy: j.actor, voice: {
        jobId, engine: `${eng?.engine ?? 'chatterbox-tts'} ${eng?.version ?? ''}`.trim(), model: model.engineModel, language: j.input.language, text: j.input.text, ...(typeof result.spokenText === 'string' && result.spokenText !== j.input.text ? { spokenText: result.spokenText.slice(0, 4000) } : {}), seed: j.input.seed,
        voice: j.input.referenceAssetId ? 'reference' : 'built-in', ...(j.input.referenceAssetId ? { referenceAssetId: j.input.referenceAssetId, consent: j.input.consent } : {}), watermark: result.watermark ?? null,
      } } };
      const imp = this.store.commit({ projectId: j.projectId, actor: j.actor, label: 'Generate narration', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] });
      const assetId = imp.results[0]!.output!.assetId as string;
      let placed: any = null, revision = imp.revision, placeError: unknown;
      if (j.input.start) {
        try {
          const c = this.store.commit({ projectId: j.projectId, actor: j.actor, label: 'Place narration', ops: [{ op: 'add_clip', args: { assetId, start: place.start, ...(place.trackId ? { trackId: place.trackId } : {}) } }] });
          placed = c.results[0]!.output ?? null; revision = c.revision;
          if (j.input.script && placed?.clipId) {
            // the next sentence starts where this clip ends, plus the gap, on the same track
            const doc = this.store.getProject(j.projectId).doc;
            for (const seq of Object.values(doc.sequences)) for (const tr of seq.tracks) { const c2 = tr.clips.find((x) => x.id === placed.clipId); if (c2) next = { start: T.add(T.add(c2.start, c2.duration), j.input.script.gap), trackId: tr.id }; }
          }
        } catch (e: any) { placeError = e instanceof ApiError ? e.toJSON().error : { code: e?.code ?? 'place_failed', message: String(e?.message ?? e) }; }
      }
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: {
        assetId, revision, placed, ...(placeError ? { placeError, note: 'the narration is in the media library; it could not be placed at the requested time' } : {}),
        ...(j.input.script ? { script: { id: j.input.script.id, index: j.input.script.index, of: j.input.script.of, next } } : {}),
        seconds: Number(seconds.toFixed(3)), voice: j.input.referenceAssetId ? 'reference' : 'built-in',
        run: { engine: asset.provenance!.voice!.engine, model: model.engineModel, device: result.device, seed: j.input.seed, wallSeconds: (Date.now() - started) / 1000 },
        review: 'Machine speech: listen to it before publishing. Hebrew pronunciation has not been qualified.',
      } });
    } catch (e: any) {
      if (this.stopped) return;
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (!(e instanceof ApiError)) console.error(e);
      const err = e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'narration failed unexpectedly' };
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: { ...err, details: { ...(err as { details?: object }).details, ...scriptState() } } });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }

  handles(job: JobRow) { return job.type === DOWNLOAD || job.type === TRANSCRIBE || job.type === NARRATE; }
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
    const downloads = this.store.recoverJobs(DOWNLOAD), jobs = [...this.store.recoverJobs(TRANSCRIBE), ...this.store.recoverJobs(NARRATE)];
    for (const j of downloads) void this.driveDownload(j.id);
    for (const j of jobs) this.enqueue(j.id);
    return downloads.length + jobs.length;
  }
  async stop() {
    this.stopped = true;
    for (const c of this.aborts.values()) c.abort();
    for (const p of this.running.values()) p.kill('SIGKILL');
    for (const k of this.kept.values()) { if (k.idle) clearTimeout(k.idle); k.p.kill('SIGKILL'); }
    await this.chain.catch(() => {});
  }
}
