/**
 * Local tools (ADR-0017, route R3): reviewed PULSEFRAME-owned tools run on this machine by an operator-installed engine.
 *   - local.text.translate-he-en / -en-he: MarianMT (OPUS-MT) in a Python worker (apps/server/tools/pf_tools.py, PF_TOOLS_PYTHON),
 *     started with `python -I` from the data directory (outside any ComfyUI folder). It never downloads (HF_HUB_OFFLINE).
 *   - local.voice.clean («ניקוי קול בבינה מלאכותית»): the operator-installed deep-filter 0.5.6 binary (PF_DENOISE_BIN), verified by
 *     SHA-256 against the descriptor's verifiedBinaries; the product never installs or downloads an executable.
 *   - local.audio.vocals-classic («קלאסי, לא בינה מלאכותית»): an ffmpeg centre-channel cancel. No model.
 *
 * Same lifecycle as speech.ts: pinned model files in a verified ModelStore (PF_TOOLS_MODELS_DIR), an honest setup state, a durable
 * job (type 'capability', created by Capabilities.start after prepare()), the compute lane around the heavy part, a kept worker
 * (PF_TOOLS_KEEP_SECONDS), SIGKILL cancel, and recovery that never imports twice.
 * Every result is validated before it may enter the project, and it enters only through ops in Store.commit:
 *   - translation: exactly one non-empty text per phrase or cue sent, no other ids, then the internal attach_translation (a language
 *     variant with review 'needed' and the sha256 of each master text);
 *   - sound: exact sample count, cross-correlation lag ≤ 1 ms against the source (voice), finite samples, not silent; then
 *     import_asset with derived provenance (sourceRangeStart on the source's clock, audio 'processed', models, code digest) and, when
 *     asked and still valid, replace_clip_asset. Nothing is fabricated: a result that fails a check is discarded and the job fails.
 * Changing this file changes the code digest of every local tool (packages/providers/src/local-registry.ts).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { findClip, isRamped, masterTextOf, sha256Hex, sourceEnd, timeOriginSeconds, transcriptFor, type Asset } from '@pulseframe/core';
import { CapabilityError, LOCAL_TOOLS, publicationBlockers, resolveParams, type Blocker, type DistributionProfile, type LocalToolDescriptor } from '@pulseframe/providers';
import * as T from '@pulseframe/time';
import type { ComputeLane, LocalToolRunner, RunRequest, SetupState } from './aiContracts.ts';
import type { Config } from './config.ts';
import { describeMedia } from './ingest.ts';
import { ModelStore } from './models.ts';
import { assertStorageRoom } from './storage.ts';
import { openWarning, warnsOpen } from './autonomy-mode.ts';
import { openAdmission, splitBlockers } from './openBlockers.ts';
import { ApiError, type JobRow, type Store } from './store.ts';
import { PYTHON_WORKER_FLAGS } from './pythonArgs.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Repository root: codeFiles are repository-relative (the server runs from source, `tsx src/main.ts`). */
export const REPO_ROOT = path.resolve(HERE, '../../..');
const TOOLS_WORKER = path.resolve(HERE, '../tools/pf_tools.py');

/** Every sound tool works at the voice model's rate. */
export const SAMPLE_RATE = 48_000;
/** Silence appended before deep-filter: its output ends 1440 samples (30 ms) early (measured by the lead, 2026-11-17); trimmed back after. */
const PAD_SAMPLES = SAMPLE_RATE;
/** The result may lag or lead the source by at most 1 ms. */
export const MAX_LAG_SAMPLES = SAMPLE_RATE / 1000;
/** How far the lag is searched (100 ms each way); a larger shift is still a failure, found at the edge. */
const LAG_SEARCH = SAMPLE_RATE / 10;
/** Analysis window for the lag: the loudest 2^17 samples (2.7 s) of the source. */
const LAG_WINDOW = 1 << 17;
/** Below this normalised correlation the result is not a cleaned copy of the source at all. */
export const MIN_MATCH = 0.2;
/** Peak below −60 dBFS: silent. */
export const SILENT_PEAK = 1e-3;
/** Left and right more alike than this: effectively mono, nothing to cancel. */
export const MONO_CORRELATION = 0.98;
/** Longest source range one sound run takes. */
export const MAX_AUDIO_SECONDS = 30 * 60;
const MAX_TRANSLATE_ITEMS = 20_000;
/** Run-earned dimensions never stop a run (same rule as Capabilities); everything else does. */
const EARNED_BY_RUNNING = new Set(['not_executed', 'not_hardwareQualified', 'not_qualityReviewed', 'not_hebrewQualified']);
const NEEDS_REVIEW = new Set(['not_qualityReviewed', 'not_hebrewQualified']);
const PLATFORM = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
/** Failures that running the same request again would repeat (the result or the source itself is the problem). */
const FINAL_FAILURES = new Set(['output_invalid', 'output_not_editable', 'mono_like_source', 'source_silent', 'nothing_to_translate', 'code_digest_mismatch', 'licence_blocked', 'invalid_job_input']);
/** Free space kept beyond a download (same margin as the capability downloads). */
const DISK_MARGIN = 2 * 1024 ** 3;

// ---------------------------------------------------------------- code digest and blockers

const codeCache = new Map<string, { key: string; digest: string }>();
/** The bytes with every CRLF pair as LF (latin1 maps each byte to one code unit and back, so nothing else changes). */
const lfBytes = (b: Buffer) => (b.includes('\r\n') ? Buffer.from(b.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : b);
/**
 * sha256 over the descriptor's code files as installed, in listed order, with CRLF line endings read as LF (the descriptor's codeDigest
 * must equal it). A Windows checkout (Git for Windows defaults to core.autocrlf=true) writes the same code with CRLF; TypeScript and
 * Python read both the same way. Any other byte, a lone CR included, still changes the digest.
 */
export function installedCodeDigest(d: LocalToolDescriptor, root = REPO_ROOT): string {
  const files = d.codeFiles.map((f) => path.resolve(root, f));
  if (files.some((f) => !f.startsWith(root + path.sep))) return 'sha256:outside-repository';
  let key = '';
  try { key = files.map((f) => { const s = fs.statSync(f); return `${f}|${s.size}|${s.mtimeMs}`; }).join(';'); } catch { return 'sha256:missing-file'; }
  const hit = codeCache.get(d.id);
  if (hit?.key === key) return hit.digest;
  const h = createHash('sha256');
  for (const f of files) h.update(lfBytes(fs.readFileSync(f)));
  const digest = `sha256:${h.digest('hex')}`;
  codeCache.set(d.id, { key, digest });
  return digest;
}
/** What stops a run: every publication blocker except those a recorded run earns (same rule as Capabilities). */
export function runBlockers(d: LocalToolDescriptor, profile: DistributionProfile, codeDigest?: string): Blocker[] {
  return publicationBlockers(d, profile, codeDigest === undefined ? {} : { codeDigest }).filter((b) => !EARNED_BY_RUNNING.has(b.code));
}
/** What stops a download of the tool's models: the licence and model-record blockers (the rule Capabilities.startDownload applies). */
export function licenceBlockers(d: LocalToolDescriptor, profile: DistributionProfile): Blocker[] {
  return publicationBlockers(d, profile).filter((b) => /model|license|unresolved/i.test(b.code));
}

// ---------------------------------------------------------------- WAV reading and the checks on sound

export interface WavInfo { sampleRate: number; channels: number; bits: number; float: boolean; dataOffset: number; dataBytes: number; frames: number; blockAlign: number }
/** Header of a RIFF/WAVE file (PCM 16/24/32-bit integer or 32/64-bit float, plain or extensible). Throws ApiError output_invalid. */
export function readWavInfo(file: string): WavInfo {
  const bad = (why: string) => new ApiError(502, 'output_invalid', `${path.basename(file)} is not a usable WAV file: ${why}`);
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(12);
    if (fs.readSync(fd, head, 0, 12, 0) < 12 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') throw bad('no RIFF/WAVE header');
    let pos = 12, fmt: Buffer | null = null, data: { offset: number; bytes: number } | null = null;
    while (pos + 8 <= size) {
      const h = Buffer.alloc(8);
      fs.readSync(fd, h, 0, 8, pos);
      const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
      if (id === 'fmt ') { fmt = Buffer.alloc(Math.min(len, 64)); fs.readSync(fd, fmt, 0, fmt.length, pos + 8); }
      else if (id === 'data') { data = { offset: pos + 8, bytes: Math.min(len, size - pos - 8) }; break; }
      pos += 8 + len + (len & 1);
    }
    if (!fmt || fmt.length < 16 || !data) throw bad('no format or data chunk');
    let tag = fmt.readUInt16LE(0);
    if (tag === 0xfffe && fmt.length >= 26) tag = fmt.readUInt16LE(24);
    const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), blockAlign = fmt.readUInt16LE(12), bits = fmt.readUInt16LE(14);
    const float = tag === 3;
    if (!((tag === 1 && [16, 24, 32].includes(bits)) || (float && [32, 64].includes(bits)))) throw bad(`sample format ${tag}/${bits} bits is not read here`);
    if (!channels || blockAlign !== channels * (bits / 8)) throw bad('inconsistent block size');
    return { sampleRate, channels, bits, float, dataOffset: data.offset, dataBytes: data.bytes, frames: Math.floor(data.bytes / blockAlign), blockAlign };
  } finally { fs.closeSync(fd); }
}
/** `count` frames from `start` as one Float32Array per channel (full scale = 1). */
export function readWavFrames(file: string, info: WavInfo, start: number, count: number): Float32Array[] {
  const n = Math.max(0, Math.min(count, info.frames - start));
  const buf = Buffer.alloc(n * info.blockAlign);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, buf.length, info.dataOffset + start * info.blockAlign); } finally { fs.closeSync(fd); }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = Array.from({ length: info.channels }, () => new Float32Array(n));
  const w = info.bits / 8;
  for (let f = 0; f < n; f++) {
    for (let c = 0; c < info.channels; c++) {
      const o = f * info.blockAlign + c * w;
      out[c]![f] = info.float ? (w === 4 ? dv.getFloat32(o, true) : dv.getFloat64(o, true))
        : w === 2 ? dv.getInt16(o, true) / 32768 : w === 3 ? ((dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16)) / 8388608) : dv.getInt32(o, true) / 2147483648;
    }
  }
  return out;
}
const mono = (ch: Float32Array[]): Float32Array => {
  if (ch.length === 1) return ch[0]!;
  const out = new Float32Array(ch[0]!.length);
  for (const c of ch) for (let i = 0; i < out.length; i++) out[i]! += c[i]! / ch.length;
  return out;
};
export interface SoundStats { frames: number; /** Over every channel (a mono mix would hide a side-only signal). */ peak: number; rms: number; nonFinite: number; /** Samples at full scale (clipped). */ clipped: number; /** Energy per 0.1 s block of the mono mix, for choosing the lag window. */ blocks: Float64Array; /** Pearson correlation of the first two channels, or null. */ lrCorrelation: number | null }
/** One pass over the first `frames` frames, a second at a time (memory stays bounded for long sound). */
export function soundStats(file: string, info: WavInfo, frames: number): SoundStats {
  const BLOCK = SAMPLE_RATE / 10;
  const blocks = new Float64Array(Math.ceil(frames / BLOCK));
  let peak = 0, sumSq = 0, count = 0, nonFinite = 0, clipped = 0, sl = 0, sr = 0, sll = 0, srr = 0, slr = 0;
  for (let at = 0; at < frames; at += SAMPLE_RATE) {
    const ch = readWavFrames(file, info, at, Math.min(SAMPLE_RATE, frames - at));
    for (const c of ch) for (const v of c) {
      if (!Number.isFinite(v)) { nonFinite++; continue; }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= 32767 / 32768) clipped++;
      sumSq += v * v;
      count++;
    }
    const m = mono(ch);
    for (let i = 0; i < m.length; i++) { const v = m[i]!; if (Number.isFinite(v)) blocks[Math.floor((at + i) / BLOCK)]! += v * v; }
    if (ch.length >= 2) {
      const l = ch[0]!, r = ch[1]!;
      for (let i = 0; i < l.length; i++) { const a = l[i]!, b = r[i]!; if (!Number.isFinite(a) || !Number.isFinite(b)) continue; sl += a; sr += b; sll += a * a; srr += b * b; slr += a * b; }
    }
  }
  let lrCorrelation: number | null = null;
  if (info.channels >= 2 && frames > 0) {
    const vl = sll - (sl * sl) / frames, vr = srr - (sr * sr) / frames, cov = slr - (sl * sr) / frames;
    lrCorrelation = vl > 0 && vr > 0 ? cov / Math.sqrt(vl * vr) : vl === 0 && vr === 0 ? 1 : 0;
  }
  return { frames, peak, rms: count ? Math.sqrt(sumSq / count) : 0, nonFinite, clipped, blocks, lrCorrelation };
}
function fft(re: Float64Array, im: Float64Array, inverse: boolean) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len, half = len >> 1;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const p = i + k, q = p + half;
        const br = re[q]! * wr - im[q]! * wi, bi = re[q]! * wi + im[q]! * wr;
        re[q] = re[p]! - br; im[q] = im[p]! - bi; re[p] = re[p]! + br; im[p] = im[p]! + bi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
}
/**
 * Delay of `y` against `x` in samples (positive = y is later), searched within ±maxLag by FFT cross-correlation, and the normalised
 * correlation at that lag (1 = identical up to scale). Pure: tests call it directly.
 */
export function estimateLag(x: Float32Array, y: Float32Array, maxLag: number): { lag: number; match: number } {
  const n = Math.min(x.length, y.length);
  let size = 1;
  while (size < n + maxLag + 1) size <<= 1;
  const xr = new Float64Array(size), xi = new Float64Array(size), yr = new Float64Array(size), yi = new Float64Array(size);
  let ex = 0, ey = 0;
  for (let i = 0; i < n; i++) { xr[i] = x[i]!; yr[i] = y[i]!; ex += x[i]! * x[i]!; ey += y[i]! * y[i]!; }
  fft(xr, xi, false);
  fft(yr, yi, false);
  // conj(X)·Y: r[k] = Σ x[i]·y[i+k]
  for (let i = 0; i < size; i++) { const a = xr[i]!, b = -xi[i]!, c = yr[i]!, d = yi[i]!; xr[i] = a * c - b * d; xi[i] = a * d + b * c; }
  fft(xr, xi, true);
  let best = -Infinity, lag = 0;
  for (let k = -maxLag; k <= maxLag; k++) {
    const v = xr[k >= 0 ? k : size + k]!;
    if (v > best) { best = v; lag = k; }
  }
  const norm = Math.sqrt(ex * ey);
  return { lag, match: norm > 0 ? best / norm : 0 };
}
/** Start of the loudest `win`-sample stretch, from the per-0.1 s block energies. */
function loudestWindow(blocks: Float64Array, frames: number, win: number): number {
  const BLOCK = SAMPLE_RATE / 10, span = Math.max(1, Math.floor(win / BLOCK));
  if (frames <= win) return 0;
  let sum = 0, best = -1, at = 0;
  for (let i = 0; i < blocks.length; i++) {
    sum += blocks[i]!;
    if (i >= span) sum -= blocks[i - span]!;
    const start = (i - span + 1) * BLOCK;
    if (i >= span - 1 && start + win <= frames && sum > best) { best = sum; at = start; }
  }
  return at;
}
const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -Infinity);

// ---------------------------------------------------------------- the persisted job input

const ParamValue = z.union([z.number(), z.string(), z.boolean()]);
const LocalInput = z.object({
  v: z.literal(1),
  task: z.enum(['translate', 'voice-clean', 'vocals-classic']),
  capabilityId: z.string(), capabilityVersion: z.string(), codeDigest: z.string(),
  params: z.record(z.string(), ParamValue),
  apply: z.enum(['library', 'replace-clip']),
  projectRevision: z.number().int().nonnegative(),
  preconditions: z.array(z.object({ entityId: z.string(), version: z.number().int().nonnegative() }).strict()),
  translate: z.object({
    from: z.string(), to: z.string(),
    source: z.union([z.object({ kind: z.literal('transcript'), assetId: z.string() }).strict(), z.object({ kind: z.literal('cues'), trackId: z.string() }).strict()]),
    variantId: z.string().nullable(), baseVariantId: z.string().nullable(), name: z.string().min(1).max(80),
  }).strict().optional(),
  audio: z.object({
    assetId: z.string(), clipId: z.string().nullable(), startSample: z.number().int().nonnegative(), endSample: z.number().int().positive(),
    sampleRate: z.literal(SAMPLE_RATE), channels: z.union([z.literal(1), z.literal(2)]),
  }).strict().optional(),
}).strict();
export type LocalJobInput = z.infer<typeof LocalInput>;
const ProbeResult = z.object({ event: z.literal('result'), ok: z.boolean(), python: z.string(), versions: z.record(z.string(), z.string()), device: z.string().nullable(), cudaDevices: z.number(), missing: z.string().optional(), errors: z.record(z.string(), z.string()).optional() });
const TranslateResult = z.object({ event: z.literal('result'), device: z.string(), count: z.number().int(), loadSeconds: z.number(), translateSeconds: z.number(), versions: z.record(z.string(), z.string()) });
const TranslateFile = z.object({ translations: z.record(z.string(), z.string()) }).strict();

const languageOf = (tag: string) => { const p = tag.toLowerCase().split('-')[0]!; return p === 'iw' ? 'he' : p; };
/** he-en / en-he from the tool id (local.text.translate-<from>-<to>). */
const directionOf = (d: LocalToolDescriptor) => {
  const m = /translate-([a-z]{2,3})-([a-z]{2,3})$/.exec(d.id);
  if (!m) throw new ApiError(500, 'internal_error', `translation tool ${d.id} does not name its languages`);
  return { from: m[1]!, to: m[2]! };
};
const DEFAULT_NAME: Record<string, string> = { en: 'English (machine translation)', he: 'עברית (תרגום מכונה)' };
/**
 * The entry under an id in one of the document's plain objects keyed by id (assets, variants, transcripts). An id that names an
 * Object.prototype member (`constructor`, `__proto__`, `toString`, …) is not an entry, although a plain lookup finds something.
 */
const own = <V>(map: Record<string, V> | undefined, id: string): V | undefined => (map && Object.hasOwn(map, id) ? map[id] : undefined);
const INHERITED_NAMES: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));
/** The ids a stored job input names; prepare() never writes an inherited name, so a row with one was not prepared here. */
const namedIds = (inp: LocalJobInput) => [inp.translate?.variantId, inp.translate?.baseVariantId, inp.translate && ('assetId' in inp.translate.source ? inp.translate.source.assetId : inp.translate.source.trackId), inp.audio?.assetId, inp.audio?.clipId].filter((x): x is string => typeof x === 'string');

interface Kept { p: ChildProcess; idle: NodeJS.Timeout | null; onLine: ((o: any) => void) | null; done: ((r: { code: number | null; stderr: string }) => void) | null; err: string }
interface EngineState { state: SetupState; at: number }

export class LocalTools implements LocalToolRunner {
  private readonly store_: ModelStore;
  private readonly worker: string;
  private running = new Map<string, ChildProcess>();
  private laneWaits = new Map<string, AbortController>();
  private active = new Map<string, Promise<void>>();
  private kept = new Map<string, Kept>();
  private probes = new Map<string, EngineState>();
  private binDigests = new Map<string, { key: string; sha256: string; bytes: number }>();
  private ffmpegOk = false;
  private serial: Promise<unknown> = Promise.resolve();
  private stopped = false;
  /** Set by the server so results respect Pause Agent (as Capabilities does). */
  governance: { isPaused(projectId: string): boolean } | null = null;

  /**
   * @param lane the compute lane (lane.ts); null runs without one (heavy work then only queues behind this runner's own worker).
   * @param opts.worker TEST SEAM ONLY: a different worker script than apps/server/tools/pf_tools.py (localtools.test.ts passes a
   *   labelled fake). Never set from configuration.
   */
  constructor(private store: Store, private cfg: Config, private lane: ComputeLane | null = null, opts: { worker?: string } = {}) {
    this.store_ = new ModelStore(cfg.toolsModelsDir, cfg.modelHosts);
    this.worker = opts.worker ?? TOOLS_WORKER;
  }
  models(): ModelStore { return this.store_; }

  // ------------------------------------------------------------ setup state

  /** Honest setup state, in the order a person fixes things. Read-only; probes are cached for a minute once they succeed. */
  async setup(d: LocalToolDescriptor): Promise<SetupState> {
    const lic = this.split(d, licenceBlockers(d, this.cfg.distributionProfile));
    if (lic.blockers.length) return { code: 'licence_blocked', detail: `not allowed in the ${this.cfg.distributionProfile} profile: ${lic.blockers.map((b) => b.message).join('; ')}` };
    const s = await this.setupAfterLicence(d);
    return lic.warnings.length ? { ...s, warnings: [...lic.warnings, ...(s.warnings ?? [])] } : s; // H1, open mode: the licence told
  }
  /** D8/H1: in open mode the egress and licence blockers become warnings (openBlockers.ts); guarded = unchanged. One read of the mode. */
  private split<B extends Blocker>(d: LocalToolDescriptor, b: B[]) { return splitBlockers(d, this.cfg.distributionProfile, b, warnsOpen(this.cfg)); }
  private async setupAfterLicence(d: LocalToolDescriptor): Promise<SetupState> {
    if (installedCodeDigest(d) !== d.codeDigest) return { code: 'engine_not_working', detail: 'the installed tool code differs from the reviewed digest (code_digest_mismatch); reinstall this build' };
    const engine = await this.engineState(d);
    if (engine.code !== 'ready') return engine;
    const status = await Promise.all(d.models.map((m) => this.store_.status(m)));
    const missing = d.models.filter((_, i) => status[i]!.state !== 'ready');
    const missingBytes = status.reduce((n, s) => n + (s.state === 'ready' ? 0 : s.missingBytes), 0);
    if (missing.length) {
      const hosts = [...new Set(missing.map((m) => (m.source ? new URL(m.source).hostname : '(no source)')))].filter((h) => !this.cfg.modelHosts.some((a) => (a.startsWith('.') ? h.endsWith(a) : h === a)));
      // D1, open mode: a host outside the list is used and named in a warning; a model with no source at all stays refused (a fact)
      if (hosts.length && (!warnsOpen(this.cfg) || hosts.includes('(no source)'))) return { code: 'host_not_allowed', detail: `the model files come from ${hosts.join(', ')}, which PF_MODEL_HOSTS does not allow`, hosts, missingBytes };
      const told = hosts.length ? { warnings: hosts.map((host) => openWarning('host_not_listed', { host })) } : {};
      const free = freeBytes(this.cfg.toolsModelsDir);
      if (free !== null && free < missingBytes + DISK_MARGIN) return { code: 'disk_insufficient', detail: `the download needs ${missingBytes} bytes plus ${DISK_MARGIN} spare; ${free} are free`, missingBytes, freeBytes: free, ...told };
      return { code: 'model_missing', detail: `${missing.length} model file(s) are not present and verified: ${missingBytes} bytes to download (owner approval)`, missingBytes, ...told };
    }
    return { ...engine, missingBytes: 0 };
  }
  private async engineState(d: LocalToolDescriptor): Promise<SetupState> {
    const cached = this.probes.get(d.engine.kind);
    if (cached && cached.state.code === 'ready' && Date.now() - cached.at < 60_000 && d.engine.kind !== 'binary') return cached.state;
    const state = d.engine.kind === 'python-worker' ? await this.probePython() : d.engine.kind === 'binary' ? await this.probeBinary(d) : await this.probeFfmpeg();
    if (d.engine.kind !== 'binary') this.probes.set(d.engine.kind, { state, at: Date.now() });
    return state;
  }
  private async probeFfmpeg(): Promise<SetupState> {
    if (this.ffmpegOk) return { code: 'ready', detail: 'ffmpeg answers', device: 'cpu' };
    try {
      const r = await this.exec('ffmpeg', ['-hide_banner', '-version'], null, 'ffmpeg', 30_000);
      this.ffmpegOk = true;
      return { code: 'ready', detail: 'ffmpeg answers', device: 'cpu', versions: { ffmpeg: r.stdout.split('\n')[0]!.replace(/^ffmpeg version\s*/, '').split(' ')[0]! } };
    } catch (e: any) { return { code: 'engine_not_working', detail: `ffmpeg cannot be started: ${e.message}` }; }
  }
  private async probePython(): Promise<SetupState> {
    const python = this.cfg.toolsPython;
    if (!python) return { code: 'engine_not_configured', detail: 'PF_TOOLS_PYTHON is not set: no tools environment (torch, transformers, sentencepiece) is configured' };
    let result: unknown = null;
    let r: { code: number | null; stderr: string };
    try { r = await this.oneShot(python, ['probe'], (o) => { if (o.event === 'result') result = o; }, null, 180_000); }
    catch (e: any) { return { code: 'engine_not_working', detail: e.message }; }
    const p = ProbeResult.safeParse(result);
    if (r.code !== 0 || !p.success || !p.data.ok) {
      const missing = p.success ? p.data.missing : undefined;
      const why = missing ? `the tools environment cannot import ${missing}${p.success && p.data.errors?.[missing] ? ` (${p.data.errors[missing]})` : ''}` : `the tools worker did not answer (exit ${r.code})`;
      return { code: 'engine_not_working', detail: `${why}${r.stderr.trim() ? `; stderr: ${r.stderr.trim().slice(-400)}` : ''}` };
    }
    return { code: 'ready', detail: `tools environment answers (python ${p.data.python})`, device: p.data.device, versions: p.data.versions };
  }
  private async probeBinary(d: LocalToolDescriptor): Promise<SetupState> {
    const bin = d.engine.configVar === 'PF_DENOISE_BIN' ? this.cfg.denoiseBin : null;
    if (!bin) return { code: 'engine_not_configured', detail: `${d.engine.configVar ?? 'the engine setting'} is not set: no engine is installed for this tool (the operator installs it; the product never does)` };
    let st: fs.Stats;
    try { st = fs.statSync(bin); } catch { return { code: 'engine_not_working', detail: `${d.engine.configVar} names ${bin}, which does not exist` }; }
    if (!st.isFile()) return { code: 'engine_not_working', detail: `${d.engine.configVar} names ${bin}, which is not a file` };
    const key = `${st.size}|${st.mtimeMs}`;
    let dg = this.binDigests.get(bin);
    if (dg?.key !== key) {
      const h = createHash('sha256');
      await pipeline(fs.createReadStream(bin), h);
      dg = { key, sha256: h.digest('hex'), bytes: st.size };
      this.binDigests.set(bin, dg);
    }
    const listed = d.engine.verifiedBinaries.find((b) => b.platform === PLATFORM && b.sha256 === dg!.sha256 && b.bytes === dg!.bytes);
    if (!listed) return { code: 'engine_unverified', detail: `the installed engine (${dg.bytes} bytes, sha256 ${dg.sha256}) is not a reviewed build for ${PLATFORM}; reviewed: ${d.engine.verifiedBinaries.filter((b) => b.platform === PLATFORM).map((b) => `${b.version} sha256 ${b.sha256}`).join(', ') || 'none for this platform'}` };
    const ff = await this.probeFfmpeg();
    if (ff.code !== 'ready') return ff;
    try {
      const r = await this.exec(bin, ['--version'], null, 'the voice engine', 30_000);
      return { code: 'ready', detail: `deep-filter ${listed.version} verified by SHA-256`, device: 'cpu', versions: { engine: r.stdout.trim().slice(0, 80), ffmpeg: ff.versions?.ffmpeg ?? 'unknown' } };
    } catch (e: any) { return { code: 'engine_not_working', detail: `the verified engine does not start: ${e.message}` }; }
  }

  // ------------------------------------------------------------ prepare (synchronous: reads the document and the configuration)

  prepare(d: LocalToolDescriptor, req: RunRequest): Record<string, unknown> {
    if (d.state !== 'published') throw new ApiError(409, 'capability_is_draft', 'drafts cannot be executed');
    const split = this.split(d, runBlockers(d, this.cfg.distributionProfile, installedCodeDigest(d)));
    const blockers = split.blockers;
    if (blockers.length) throw new ApiError(409, 'capability_blocked', `capability ${d.id} is not eligible to run in the ${this.cfg.distributionProfile} profile`, { blockers });
    let params: Record<string, number | string | boolean>;
    try { params = resolveParams(d, req.params ?? {}).resolved; } catch (e) {
      if (e instanceof CapabilityError) throw new ApiError(422, e.code, e.message, e.details);
      throw e;
    }
    const notConfigured = (what: string, hint: string) => new ApiError(409, 'engine_not_configured', `${d.title.en} is not set up: ${what}`, { setup: { code: 'engine_not_configured', detail: what } }, hint);
    if (d.engine.kind === 'python-worker' && !this.cfg.toolsPython) throw notConfigured('PF_TOOLS_PYTHON is not set', 'Set PF_TOOLS_PYTHON to the Python of an environment with torch, transformers and sentencepiece (docs/INTEGRATIONS.md).');
    if (d.engine.kind === 'binary' && !this.cfg.denoiseBin) throw notConfigured('PF_DENOISE_BIN is not set', 'Install deep-filter 0.5.6 yourself and set PF_DENOISE_BIN to it; the product verifies it by SHA-256 and never installs it.');
    if (req.attach) throw new ApiError(422, 'attach_not_supported', `${d.title.en} does not take a timeline placement; say where the result goes with apply`, {}, d.task === 'translate' ? 'A translation becomes a language format.' : 'Use apply "replace-clip" with a clip source, or "library".');
    const apply = req.apply ?? 'library';
    if (apply === 'new-track') throw new ApiError(422, 'apply_not_supported', `${d.title.en} does not place its result on a new track`, { apply }, d.task === 'translate' ? 'A translation becomes a language format; use apply "library" (the default).' : 'Use "replace-clip" to hear it in the clip, or "library" to keep it in the media library.');
    const { doc, revision } = this.store.getProject(req.projectId);
    const base = { v: 1 as const, task: d.task, capabilityId: d.id, capabilityVersion: d.version, codeDigest: d.codeDigest, params, projectRevision: revision };
    if (d.task === 'translate') {
      if (apply !== 'library') throw new ApiError(422, 'apply_not_supported', 'a translation becomes a language format; it is not placed in a clip', { apply });
      const { from, to } = directionOf(d);
      const trackId = typeof params.captionTrackId === 'string' ? params.captionTrackId : null;
      if (trackId && req.source) throw new ApiError(422, 'ambiguous_source', 'give either a source (a clip or an asset with a transcript) or captionTrackId, not both');
      let source: NonNullable<LocalJobInput['translate']>['source'];
      if (trackId) {
        const track = Object.values(doc.sequences).flatMap((s) => s.tracks).find((t) => t.id === trackId);
        if (!track) throw new ApiError(404, 'not_found', `caption track ${trackId} not found`, { trackId });
        if (track.kind !== 'caption' || track.caption?.mode !== 'manual') throw new ApiError(422, 'incompatible', 'captionTrackId must name a manual caption track; transcript captions are translated from their transcript', { trackId }, 'Pass the clip or the asset whose transcript the captions show as source.');
        const cues = track.clips.filter((c) => c.type === 'caption' && c.text.trim());
        if (!cues.length) throw new ApiError(422, 'nothing_to_translate', 'this caption track has no cues with text', { trackId });
        if (cues.length > MAX_TRANSLATE_ITEMS) throw new ApiError(422, 'too_many_phrases', `at most ${MAX_TRANSLATE_ITEMS} cues are translated in one run`, { cues: cues.length });
        source = { kind: 'cues', trackId };
      } else if (req.source) {
        let assetId: string;
        if ('clipId' in req.source) {
          const f = findClip(doc, req.source.clipId);
          if (!f) throw new ApiError(404, 'not_found', `clip ${req.source.clipId} not found`, { clipId: req.source.clipId });
          if (f.clip.type !== 'media') throw new ApiError(422, 'incompatible', 'the source clip must show a media file with a transcript', { clipId: f.clip.id });
          assetId = f.clip.assetId;
        } else {
          if (req.source.range) throw new ApiError(422, 'range_not_supported', 'a translation covers the whole transcript; a frame range is not used', {});
          assetId = req.source.assetId;
        }
        if (!own(doc.assets, assetId)) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
        const tr = transcriptFor(doc, assetId);
        if (!tr) throw new ApiError(404, 'no_transcript', 'this source has no transcript to translate', { assetId }, 'Type, import or recognise a transcript first.');
        if (languageOf(tr.transcript.language) !== from) throw new ApiError(422, 'language_mismatch', `the transcript is in "${tr.transcript.language}"; this tool translates from "${from}"`, { language: tr.transcript.language, from }, 'Pick the tool for the transcript\'s language.');
        const phrases = tr.transcript.segments.filter((s) => s.text.trim());
        if (!phrases.length) throw new ApiError(422, 'nothing_to_translate', 'the transcript has no phrases with text', { assetId });
        if (phrases.length > MAX_TRANSLATE_ITEMS) throw new ApiError(422, 'too_many_phrases', `at most ${MAX_TRANSLATE_ITEMS} phrases are translated in one run`, { phrases: phrases.length });
        source = { kind: 'transcript', assetId: tr.transcript.assetId };
      } else throw new ApiError(422, 'source_required', 'say what to translate: a source clip or asset with a transcript, or captionTrackId of a manual caption track');
      const variantId = typeof params.variantId === 'string' ? params.variantId : null;
      const baseVariantId = typeof params.baseVariantId === 'string' ? params.baseVariantId : null;
      if (variantId) {
        const v = own(doc.variants, variantId);
        if (!v) throw new ApiError(404, 'not_found', `format ${variantId} not found`, { variantId });
        if (!v.translation || languageOf(v.translation.from) !== from || languageOf(v.translation.to) !== to) throw new ApiError(422, 'incompatible', `format ${variantId} is not a ${from}→${to} translation`, { variantId }, 'Omit variantId to make a new language format.');
      }
      if (baseVariantId && !own(doc.variants, baseVariantId)) throw new ApiError(404, 'not_found', `format ${baseVariantId} not found`, { baseVariantId });
      const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : variantId ? own(doc.variants, variantId)!.name : DEFAULT_NAME[to] ?? `${to} (machine translation)`;
      const input: LocalJobInput = { ...base, apply: 'library', preconditions: [], translate: { from, to, source, variantId, baseVariantId, name } };
      return { ...openAdmission(split), local: input };
    }
    // sound tools: an exact sample range on the source asset's own clock, rounded outward so the result covers the clip
    if (!req.source) throw new ApiError(422, 'source_required', 'say which sound to process: a clip, or a library asset with an optional frame range');
    let asset: Asset | undefined, clipId: string | null = null, t0: T.RationalTime, t1: T.RationalTime;
    if ('clipId' in req.source) {
      const f = findClip(doc, req.source.clipId);
      if (!f) throw new ApiError(404, 'not_found', `clip ${req.source.clipId} not found`, { clipId: req.source.clipId });
      const clip = f.clip;
      if (clip.type !== 'media') throw new ApiError(422, 'incompatible', 'the source clip must show a media file', { clipId: clip.id });
      if (clip.freeze || isRamped(clip) || clip.reverse) throw new ApiError(422, 'incompatible', 'this version reads clips that play forwards at one speed; freeze frames, reversed clips and gradual speed changes are refused', { clipId: clip.id }, 'Run it on the asset (source assetId) instead, or remove the speed change first.');
      if (apply === 'replace-clip' && f.track.kind !== 'audio') throw new ApiError(422, 'incompatible', 'replace-clip needs a clip on a sound track; the sound of a picture clip is its linked clip on a sound track', { clipId: clip.id }, 'Pick the linked sound clip.');
      asset = own(doc.assets, clip.assetId);
      clipId = clip.id;
      t0 = clip.sourceIn;
      t1 = sourceEnd(clip);
    } else {
      if (apply === 'replace-clip') throw new ApiError(422, 'apply_not_supported', 'replace-clip needs a clip as the source', { apply }, 'Pass source {clipId}.');
      asset = own(doc.assets, req.source.assetId);
      if (!asset) throw new ApiError(404, 'not_found', `asset ${req.source.assetId} not found`, { assetId: req.source.assetId });
      if (req.source.range) {
        const rate = asset.video?.frameRate ?? doc.settings.frameRate;
        t0 = T.frameTime(req.source.range.firstFrame, rate);
        t1 = T.frameTime(req.source.range.firstFrame + req.source.range.frameCount, rate);
        if (T.lt(asset.duration, t1)) throw new ApiError(422, 'range_outside_asset', 'the frame range runs past the end of the asset', { range: req.source.range });
      } else { t0 = T.ZERO; t1 = asset.duration; }
    }
    if (!asset) throw new ApiError(404, 'not_found', 'the source file is not in the project');
    if (!asset.audio) throw new ApiError(422, 'no_audio', 'the source has no sound', { assetId: asset.id });
    if (d.task === 'vocals-classic' && asset.audio.channels < 2) throw new ApiError(422, 'mono_source', 'the source sound is mono: there is no centre to cancel', { assetId: asset.id, channels: asset.audio.channels }, 'Classic vocal removal needs a stereo recording.');
    const startSample = T.sampleIndexAt(t0, SAMPLE_RATE);
    const e = T.sampleIndexAt(t1, SAMPLE_RATE);
    const endSample = T.eq(T.frameTime(e, { num: SAMPLE_RATE, den: 1 }), t1) ? e : e + 1;
    if (endSample <= startSample) throw new ApiError(422, 'empty_range', 'the source range is empty');
    if (endSample - startSample > MAX_AUDIO_SECONDS * SAMPLE_RATE) throw new ApiError(422, 'source_too_long', `at most ${MAX_AUDIO_SECONDS / 60} minutes of sound are processed in one run`, { seconds: Math.round((endSample - startSample) / SAMPLE_RATE) }, 'Run it on a shorter clip or range.');
    // Stale-result protection (SPEC §20): the clip and anything else the caller says the placement depends on.
    const preconditions = [...new Set([...(clipId ? [clipId] : []), ...(req.dependsOn ?? [])])].map((entityId) => ({ entityId, version: this.store.entityVersion(req.projectId, entityId)?.revision ?? 0 }));
    const input: LocalJobInput = { ...base, apply, preconditions, audio: { assetId: asset.id, clipId, startSample, endSample, sampleRate: SAMPLE_RATE, channels: d.task === 'voice-clean' ? 1 : 2 } };
    return { ...openAdmission(split), local: input };
  }

  // ------------------------------------------------------------ drive

  /** Drives an already-persisted job row to succeeded, failed or canceled. Never throws. */
  drive(jobId: string, d: LocalToolDescriptor): Promise<void> {
    const cur = this.active.get(jobId);
    if (cur) return cur;
    const p = this.run(jobId, d).catch((e) => console.error(e)).finally(() => this.active.delete(jobId));
    this.active.set(jobId, p);
    return p;
  }
  private canceled(jobId: string) { return ['cancel-requested', 'canceled'].includes(this.store.getJob(jobId).status); }
  private finishCanceled(jobId: string) {
    this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; nothing was imported or changed' } });
  }
  private async run(jobId: string, d: LocalToolDescriptor) {
    if (this.stopped || this.store.getJob(jobId).status !== 'queued') return;
    const parsed = LocalInput.safeParse(this.store.getJob(jobId).input?.local);
    if (!parsed.success || parsed.data.capabilityId !== d.id || namedIds(parsed.data).some((id) => INHERITED_NAMES.has(id))) {
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: { code: 'invalid_job_input', message: 'this job was not prepared for this local tool', retryable: false } });
      return;
    }
    const inp = parsed.data;
    let release: (() => void) | null = null;
    const tmp = fs.mkdtempSync(path.join(this.store.tmpDir, 'pf-tool-'));
    try {
      release = await this.acquireLane(jobId, `${d.id} (${jobId})`);
      if (!release || this.stopped) return;
      const started = Date.now(); // measured from when the compute was granted, not from the wait
      const j = this.store.getJob(jobId);
      if (j.status !== 'queued') return;
      this.store.updateJob(jobId, { status: 'running', stage: 'checking the engine', attempt: j.attempt + 1 });
      if (installedCodeDigest(d) !== d.codeDigest || inp.codeDigest !== d.codeDigest) throw new ApiError(409, 'code_digest_mismatch', 'the installed tool code differs from the reviewed digest; nothing was run');
      const setup = await this.setup(d);
      if (setup.code !== 'ready') throw new ApiError(409, setup.code, `${d.title.en} is not ready: ${setup.detail}`, { setup });
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (inp.task === 'translate') await this.runTranslate(jobId, d, inp, tmp, setup, started);
      else await this.runSound(jobId, d, inp, tmp, setup, started);
    } catch (e: any) {
      if (this.stopped) return; // shutting down: the row stays as it is; recover() reports it on the next start
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      if (!(e instanceof ApiError)) console.error(e);
      const err = e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'the tool failed unexpectedly' };
      this.store.updateJob(jobId, { status: 'failed', stage: null, error: { ...err, retryable: !FINAL_FAILURES.has(err.code) } });
    } finally {
      release?.();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  private async acquireLane(jobId: string, label: string): Promise<(() => void) | null> {
    if (!this.lane) return () => {};
    const ctl = new AbortController();
    this.laneWaits.set(jobId, ctl);
    const holder = this.lane.busy().holder;
    if (holder) this.store.updateJob(jobId, { stage: `queued (waiting for compute: ${holder})` });
    try {
      const release = await this.lane.acquire(label, ctl.signal);
      if (ctl.signal.aborted) { release(); return null; }
      return release;
    } catch (e) {
      if (ctl.signal.aborted) return null;
      throw e;
    } finally { this.laneWaits.delete(jobId); }
  }
  private recipe(d: LocalToolDescriptor, inp: LocalJobInput, setup: SetupState) {
    const openReviews = publicationBlockers(d, this.cfg.distributionProfile).filter((b) => NEEDS_REVIEW.has(b.code)).map((b) => b.code.slice(4));
    return {
      experimental: openReviews.length > 0, openReviews, capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.codeDigest, logicDigest: d.codeDigest, params: inp.params,
      sources: inp.audio ? [{ assetId: inp.audio.assetId, clipId: inp.audio.clipId, startSample: inp.audio.startSample, endSample: inp.audio.endSample, sampleRate: SAMPLE_RATE }] : [inp.translate!.source],
      provider: { id: 'local', runtimeVersion: setup.versions ? Object.entries(setup.versions).map(([k, v]) => `${k} ${v}`).join(', ') : null, device: { name: setup.device ?? 'cpu', type: setup.device ?? 'cpu' } },
    };
  }

  // ------------------------------------------------------------ translation

  private async runTranslate(jobId: string, d: LocalToolDescriptor, inp: LocalJobInput, tmp: string, setup: SetupState, started: number) {
    const t = inp.translate!;
    const job = this.store.getJob(jobId);
    const doc = this.store.getProject(job.projectId).doc;
    // What is translated is read now: the phrases and cues as they are when the run starts (their hashes are recorded).
    let items: { id: string; text: string; master: string; kind: 'phrase' | 'cue' }[];
    if (t.source.kind === 'transcript') {
      const tr = own(doc.transcripts, t.source.assetId);
      if (!tr) throw new ApiError(409, 'source_changed', 'the transcript was removed before the translation started');
      items = tr.segments.filter((s) => s.text.trim()).map((s) => ({ id: s.id, text: s.text.trim(), master: s.text, kind: 'phrase' as const }));
    } else {
      const trackId = t.source.trackId;
      const track = Object.values(doc.sequences).flatMap((s) => s.tracks).find((x) => x.id === trackId);
      if (!track || track.caption?.mode !== 'manual') throw new ApiError(409, 'source_changed', 'the caption track was removed or changed before the translation started');
      items = track.clips.flatMap((c) => (c.type === 'caption' && c.text.trim() ? [{ id: c.id, text: c.text.trim(), master: c.text, kind: 'cue' as const }] : []));
    }
    if (!items.length) throw new ApiError(422, 'nothing_to_translate', 'there is no text to translate');
    // The formats named are checked now too (they may have been removed while the job waited), not only after the compute is spent.
    if (t.variantId && !own(doc.variants, t.variantId)?.translation) throw new ApiError(409, 'source_changed', `format ${t.variantId} was removed before the translation started; nothing was run`);
    if (!t.variantId && t.baseVariantId && !own(doc.variants, t.baseVariantId)) throw new ApiError(409, 'source_changed', `base format ${t.baseVariantId} was removed before the translation started; nothing was run`);
    const inFile = path.join(tmp, 'items.json'), outFile = path.join(tmp, 'translations.json');
    fs.writeFileSync(inFile, JSON.stringify({ items: items.map(({ id, text }) => ({ id, text })) }), 'utf8');
    const weights = d.models.some((m) => m.path.endsWith('.safetensors')) ? 'safetensors' : 'pickle';
    const modelDir = path.join(this.cfg.toolsModelsDir, path.dirname(d.models[0]!.path));
    const progress = (done: number) => {
      const elapsed = (Date.now() - started) / 1000;
      return { progress: { unit: 'phrases', done, total: items.length, basis: 'measured' }, eta: done > 0 ? { seconds: Math.round((elapsed / done) * (items.length - done)), basis: 'this-run' } : { seconds: null, basis: 'none' } };
    };
    this.store.updateJob(jobId, { stage: `translating: 0 of ${items.length} phrases (measured)`, output: progress(0) });
    let result: unknown = null, failure: { code: string; message: string } | null = null, last = 0;
    const r = await this.inTurn(() => this.request(this.cfg.toolsPython!, ['translate', '--model', modelDir, '--weights', weights, '--direction', `${t.from}-${t.to}`, '--input', inFile, '--output', outFile, '--device', 'auto'], (o) => {
      if (o.event === 'result') result = o;
      else if (o.event === 'error') failure = { code: String(o.code).slice(0, 60), message: String(o.message).slice(0, 500) };
      else if (o.event === 'progress' && Number.isInteger(o.done) && (Date.now() - last > 500 || o.done === items.length) && !this.canceled(jobId)) {
        last = Date.now();
        this.store.updateJob(jobId, { stage: `translating: ${o.done} of ${items.length} phrases (measured)`, output: progress(Math.min(o.done, items.length)) });
      }
    }, jobId, () => this.canceled(jobId)));
    if (this.stopped) return;
    if (this.canceled(jobId)) return this.finishCanceled(jobId);
    if (failure) throw new ApiError(502, 'translation_failed', `the translation engine reported: ${(failure as { message: string }).message}`, { engineCode: (failure as { code: string }).code });
    const res = TranslateResult.safeParse(result);
    if (!res.success || !fs.existsSync(outFile)) throw new ApiError(502, 'translation_failed', `the translation engine ended without a usable result (exit ${r.code})`, { tail: r.stderr.slice(-400) });
    let file: z.infer<typeof TranslateFile>;
    try { file = TranslateFile.parse(JSON.parse(fs.readFileSync(outFile, 'utf8'))); } catch { throw new ApiError(502, 'output_invalid', 'the translation file is not the agreed shape'); }
    // Exactly one non-empty text per id sent, and nothing else.
    const sent = new Set(items.map((x) => x.id)), got = file.translations;
    const missing = items.filter((x) => !Object.hasOwn(got, x.id)).map((x) => x.id);
    const extra = Object.keys(got).filter((k) => !sent.has(k));
    const empty = items.filter((x) => Object.hasOwn(got, x.id) && !got[x.id]!.trim()).map((x) => x.id);
    const tooLong = items.filter((x) => Object.hasOwn(got, x.id) && got[x.id]!.trim().length > (x.kind === 'cue' ? 2000 : 4000)).map((x) => x.id);
    if (missing.length || extra.length || empty.length || tooLong.length)
      throw new ApiError(502, 'output_invalid', `the translation does not match what was sent: ${missing.length} missing, ${extra.length} not asked for, ${empty.length} empty, ${tooLong.length} too long; nothing was stored`, { missing: missing.slice(0, 20), extra: extra.slice(0, 20), empty: empty.slice(0, 20), tooLong: tooLong.slice(0, 20) });
    if (this.canceled(jobId)) return this.finishCanceled(jobId);
    // From here to the end nothing awaits: the commit and the job's final state happen in this tick.
    const now = this.store.getProject(job.projectId).doc;
    const present = items.filter((x) => masterTextOf(now, x.id) !== null);
    const leftOut = items.length - present.length;
    const changed = present.filter((x) => masterTextOf(now, x.id) !== x.master).length;
    if (!present.length) throw new ApiError(409, 'source_changed', 'every phrase that was translated was removed while the translation ran; nothing was stored');
    if (t.variantId && !own(now.variants, t.variantId)?.translation) throw new ApiError(409, 'source_changed', `format ${t.variantId} was removed while the translation ran; nothing was stored`);
    if (!t.variantId && t.baseVariantId && !own(now.variants, t.baseVariantId)) throw new ApiError(409, 'source_changed', `base format ${t.baseVariantId} was removed while the translation ran; nothing was stored`);
    const phraseText: Record<string, string> = {}, cueText: Record<string, string> = {}, sources: Record<string, string> = {};
    for (const x of present) { (x.kind === 'cue' ? cueText : phraseText)[x.id] = got[x.id]!.trim(); sources[x.id] = sha256Hex(x.master); }
    const v = res.data.versions;
    const m0 = d.models[0]!;
    const translation = { from: t.from, to: t.to, engine: `transformers ${v.transformers ?? '?'} MarianMT (torch ${v.torch ?? '?'})`.slice(0, 80), model: `${m0.publisher}@${(m0.revision ?? '').slice(0, 8)}`.slice(0, 200), createdAt: new Date().toISOString(), createdBy: job.actor, sources };
    const run = { engine: translation.engine, model: translation.model, device: res.data.device, phrases: present.length, loadSeconds: res.data.loadSeconds, translateSeconds: res.data.translateSeconds, secondsPerPhrase: Number((res.data.translateSeconds / Math.max(1, items.length)).toFixed(4)), wallSeconds: (Date.now() - started) / 1000 };
    const summary = { from: t.from, to: t.to, phrases: Object.keys(phraseText).length, cues: Object.keys(cueText).length, leftOut, changedWhileRunning: changed };
    const review = 'Machine translation: read it before publishing. It stays marked "needs review" until the owner marks it reviewed.';
    const args = { ...(t.variantId ? { variantId: t.variantId } : {}), baseVariantId: t.variantId ? null : t.baseVariantId, name: t.name, language: t.to, translation, phraseText, cueText };
    if (job.actor.startsWith('agent:') && this.governance?.isPaused(job.projectId)) {
      this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: { ...progress(items.length), recipe: this.recipe(d, inp, setup), attachment: { status: 'proposed', reason: 'agents are paused on this project; the translation was not stored', proposal: { op: 'attach_translation', args } }, translation: summary, run, review } });
      return;
    }
    this.store.updateJob(jobId, { stage: 'storing the translation' }); // recover() reads this if the server stops right here
    const c = this.store.commit({ projectId: job.projectId, actor: job.actor, label: `Machine translation ${t.from}→${t.to}`, allowInternal: true, ops: [{ op: 'attach_translation', args }] });
    const variantId = c.results[0]!.output!.variantId as string;
    this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: {
      ...progress(items.length), recipe: this.recipe(d, inp, setup),
      attachment: { status: 'attached', variantId, revision: c.revision, transactionId: c.transactionId },
      translation: summary, run, review,
      ...(leftOut || changed ? { note: `${leftOut ? `${leftOut} phrase(s) removed while it ran were left out. ` : ''}${changed ? `${changed} phrase(s) were edited while it ran; they are flagged as stale.` : ''}`.trim() } : {}),
    } });
  }

  // ------------------------------------------------------------ sound tools

  private async runSound(jobId: string, d: LocalToolDescriptor, inp: LocalJobInput, tmp: string, setup: SetupState, started: number) {
    const a = inp.audio!;
    const job = this.store.getJob(jobId);
    const src = own(this.store.getProject(job.projectId).doc.assets, a.assetId);
    if (!src?.audio) throw new ApiError(409, 'source_changed', 'the source file was removed before the tool started');
    const N = a.endSample - a.startSample;
    const voice = inp.task === 'voice-clean';
    const pad = voice ? PAD_SAMPLES : 0;
    const t: Record<string, number> = {};
    let mark = Date.now();
    const lap = (k: string) => { t[k] = (Date.now() - mark) / 1000; mark = Date.now(); };
    const progress = (done: number) => ({ progress: { unit: 'samples', done, total: N, basis: 'measured' }, eta: { seconds: null, basis: 'none' } });
    this.store.updateJob(jobId, { stage: 'reading the sound', output: progress(0) });
    const inWav = path.join(tmp, 'source.wav');
    await this.ffmpeg(['-copyts', '-i', this.store.blobPath(src.contentHash), '-map', '0:a:0',
      '-af', `aresample=${SAMPLE_RATE}:first_pts=${Math.round(timeOriginSeconds(src) * SAMPLE_RATE)},asetpts=PTS-STARTPTS,atrim=start_sample=${a.startSample}:end_sample=${a.endSample},asetpts=PTS-STARTPTS,apad=whole_len=${N + pad}`,
      '-ac', String(a.channels), '-ar', String(SAMPLE_RATE), '-c:a', voice ? 'pcm_s16le' : 'pcm_f32le', '-bitexact', '-fflags', '+bitexact', '-y', inWav], jobId, 'the source sound could not be read');
    if (this.canceled(jobId)) return this.finishCanceled(jobId);
    const info = readWavInfo(inWav);
    if (info.frames !== N + pad || info.sampleRate !== SAMPLE_RATE || info.channels !== a.channels) throw new ApiError(502, 'analysis_failed', `the source range was read as ${info.frames} samples at ${info.sampleRate} Hz × ${info.channels}; expected ${N + pad} at ${SAMPLE_RATE} Hz × ${a.channels}`);
    const srcStats = soundStats(inWav, info, N);
    if (srcStats.peak < SILENT_PEAK) throw new ApiError(422, 'source_silent', 'the source range is silent; there is nothing to process', { peakDb: db(srcStats.peak) });
    lap('reading');
    const final = path.join(tmp, 'result.wav');
    const validation: Record<string, unknown> = { samples: N, sampleRate: SAMPLE_RATE, sourcePeakDb: db(srcStats.peak), sourceRmsDb: db(srcStats.rms) };
    let engine = 'ffmpeg';
    if (voice) {
      this.store.updateJob(jobId, { stage: 'cleaning the voice (the engine reports no progress)' });
      const outDir = path.join(tmp, 'cleaned');
      fs.mkdirSync(outDir);
      const model = path.join(this.cfg.toolsModelsDir, d.models[0]!.path);
      // deep-filter 0.5.6 options (clap, read from the pinned build's help strings): -D = --compensate-delay, -m = --model (passed
      // explicitly: the help text still names DFN2), --atten-lim-db, --output-dir (the result keeps the input's file name there).
      await this.exec(this.cfg.denoiseBin!, ['-D', '-m', model, '--atten-lim-db', String(inp.params.attenLimitDb ?? 100), '--output-dir', outDir, inWav], jobId, 'the voice engine', Math.max(600_000, Math.ceil(((N + pad) / SAMPLE_RATE) * 4000) + 120_000));
      if (this.canceled(jobId)) return this.finishCanceled(jobId);
      lap('engine');
      this.store.updateJob(jobId, { stage: 'checking the result' });
      const dfOut = path.join(outDir, path.basename(inWav));
      if (!fs.existsSync(dfOut)) throw new ApiError(502, 'engine_failed', 'the voice engine finished without writing a result');
      const oi = readWavInfo(dfOut);
      if (oi.sampleRate !== SAMPLE_RATE || oi.channels !== 1) throw new ApiError(502, 'output_invalid', `the cleaned sound is ${oi.sampleRate} Hz × ${oi.channels}; expected ${SAMPLE_RATE} Hz mono`);
      // The engine's output ends early (it is padded for that); it must still hold every sample of the range.
      if (oi.frames < N) throw new ApiError(502, 'output_invalid', `the cleaned sound is too short: ${oi.frames} samples for a range of ${N}`, { engineSamples: oi.frames, samples: N });
      const out = soundStats(dfOut, oi, N);
      if (out.nonFinite) throw new ApiError(502, 'output_invalid', `the cleaned sound has ${out.nonFinite} samples that are not numbers`, { nonFinite: out.nonFinite });
      if (out.peak < SILENT_PEAK) throw new ApiError(502, 'output_invalid', 'the cleaned sound is silent', { peakDb: db(out.peak) });
      const win = Math.min(N, LAG_WINDOW), at = loudestWindow(srcStats.blocks, N, win);
      const { lag, match } = estimateLag(mono(readWavFrames(inWav, info, at, win)), mono(readWavFrames(dfOut, oi, at, win)), Math.min(LAG_SEARCH, Math.max(0, win - 1)));
      Object.assign(validation, { engineSamples: oi.frames, trimmedSamples: oi.frames - N, lagSamples: lag, lagMs: Number(((lag / SAMPLE_RATE) * 1000).toFixed(3)), match: Number(match.toFixed(4)), peakDb: db(out.peak), rmsDb: db(out.rms), finite: true });
      if (Math.abs(lag) > MAX_LAG_SAMPLES) throw new ApiError(502, 'output_invalid', `the cleaned sound is ${((lag / SAMPLE_RATE) * 1000).toFixed(1)} ms out of step with the source (at most 1 ms is accepted)`, { lagSamples: lag });
      if (match < MIN_MATCH) throw new ApiError(502, 'output_invalid', 'the cleaned sound does not follow the source', { match: Number(match.toFixed(4)) });
      await this.ffmpeg(['-i', dfOut, '-af', `atrim=end_sample=${N}`, '-ac', '1', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', '-bitexact', '-fflags', '+bitexact', '-y', final], jobId, 'the cleaned sound could not be stored');
      engine = setup.versions?.engine ?? 'deep-filter';
    } else {
      validation.lrCorrelation = srcStats.lrCorrelation === null ? null : Number(srcStats.lrCorrelation.toFixed(4));
      if (srcStats.lrCorrelation !== null && srcStats.lrCorrelation > MONO_CORRELATION) throw new ApiError(422, 'mono_like_source', `left and right are ${Math.round(srcStats.lrCorrelation * 1000) / 10}% alike: the recording is effectively mono and there is no centre to cancel`, { lrCorrelation: validation.lrCorrelation });
      this.store.updateJob(jobId, { stage: 'cancelling the centre of the stereo picture' });
      const side = 'pan=stereo|c0=c0-c1|c1=c1-c0';
      const graph = inp.params.keepBass === true
        ? ['-filter_complex', `[0:a]asplit=2[x][y];[x]${side}[s];[y]pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1,lowpass=f=150,lowpass=f=150[m];[s][m]amix=inputs=2:normalize=0[out]`, '-map', '[out]']
        : ['-af', side];
      await this.ffmpeg(['-i', inWav, ...graph, '-ac', '2', '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s16le', '-bitexact', '-fflags', '+bitexact', '-y', final], jobId, 'the vocals could not be removed');
      lap('engine');
      this.store.updateJob(jobId, { stage: 'checking the result' });
    }
    if (this.canceled(jobId)) return this.finishCanceled(jobId);
    const fi = readWavInfo(final);
    if (fi.frames !== N || fi.sampleRate !== SAMPLE_RATE || fi.channels !== a.channels) throw new ApiError(502, 'output_invalid', `the result is ${fi.frames} samples at ${fi.sampleRate} Hz × ${fi.channels}; expected exactly ${N} at ${SAMPLE_RATE} Hz × ${a.channels}`, { samples: fi.frames, expected: N });
    const resStats = soundStats(final, fi, N);
    if (resStats.peak < SILENT_PEAK) throw new ApiError(502, 'output_invalid', 'the result is silent', { peakDb: db(resStats.peak) });
    validation.resultPeakDb = db(resStats.peak);
    validation.resultRmsDb = db(resStats.rms);
    validation.resultClippedSamples = resStats.clipped; // reported, not refused: a centre cancel of anti-phase material can exceed full scale
    const h = createHash('sha256');
    await pipeline(fs.createReadStream(final), h);
    const contentHash = `sha256:${h.digest('hex')}`;
    const bytes = fs.statSync(final).size;
    let meta;
    try { meta = await describeMedia(final); } catch { throw new ApiError(502, 'output_not_editable', 'the result could not be described as an editable sound file'); }
    if (meta.kind !== 'audio' || !meta.audio || Math.abs(T.toSeconds(meta.duration) - N / SAMPLE_RATE) > 1e-5) throw new ApiError(502, 'output_invalid', 'the result does not describe itself as the expected sound', { kind: meta.kind, seconds: T.toSeconds(meta.duration) });
    lap('validation');
    if (this.canceled(jobId)) return this.finishCanceled(jobId);
    // From here to the end nothing awaits: storing, importing, placing and the job's final state happen in this tick.
    if (!fs.existsSync(this.store.blobPath(contentHash))) assertStorageRoom(this.store, bytes, 'store this result');
    this.store.putBlob(contentHash, final, bytes, meta.mimeType);
    const baseName = src.name.replace(/\.[^./\\]{1,8}$/, '').slice(0, 180);
    const asset: Omit<Asset, 'id'> = {
      ...meta,
      // exact: the result has exactly N samples at 48 kHz (checked above); the probe's decimal duration is only within a microsecond
      duration: T.normalize(T.rt(N, SAMPLE_RATE)),
      name: `${baseName} (${voice ? 'AI voice cleanup' : 'vocals removed, classic'}).wav`.slice(0, 256), contentHash, byteSize: bytes,
      provenance: { origin: 'derived', importedAt: new Date().toISOString(), importedBy: job.actor, derived: {
        jobId, capabilityId: d.id, capabilityVersion: d.version, graphDigest: d.codeDigest, logicDigest: d.codeDigest, params: inp.params,
        sourceAssetIds: [src.id], outputName: d.outputs[0]!.name, outputRole: d.outputs[0]!.role, encoding: d.outputs[0]!.encoding,
        provider: { id: 'local', engine, device: 'cpu' }, audio: 'processed', sourceRangeStart: T.normalize(T.rt(a.startSample, SAMPLE_RATE)),
        ...(d.models.length ? { models: d.models.map((m) => ({ path: m.path, sha256: m.sha256! })) } : {}),
        ...(job.input.openLicences ? { modelLicences: job.input.openLicences } : {}), // H1: a licence warning stood at admission
      } },
    };
    const imp = this.store.commit({ projectId: job.projectId, actor: job.actor, allowInternal: true, label: `Result of ${d.title.en}`, ops: [{ op: 'import_asset', args: { asset } }] });
    const assetId = imp.results[0]!.output!.assetId as string;
    const attachment = this.place(job, inp, assetId, !!imp.results[0]!.output!.deduplicated);
    this.store.updateJob(jobId, { status: 'succeeded', stage: null, output: {
      ...this.store.getJob(jobId).output, ...progress(N),
      bundle: [{ name: d.outputs[0]!.name, role: d.outputs[0]!.role, mediaType: 'audio', contentHash, bytes, mimeType: meta.mimeType, codec: meta.audio!.codec, sampleRate: SAMPLE_RATE, channels: a.channels, samples: N, durationSeconds: N / SAMPLE_RATE }],
      recipe: this.recipe(d, inp, setup), attachment, validation,
      run: { engine, device: 'cpu', audioSeconds: N / SAMPLE_RATE, wallSeconds: (Date.now() - started) / 1000, realTimeFactor: Number((((Date.now() - started) / 1000) / (N / SAMPLE_RATE)).toFixed(3)), stageSeconds: { ...t, basis: 'measured (wall clock)' } },
      review: voice ? 'Machine-processed sound: listen to it before publishing. Not quality-reviewed.' : 'Classic centre cancel, not AI: listen to it before publishing.',
    } });
  }
  /** replace-clip under the recorded preconditions; anything else stays in the library, with the reason. */
  private place(job: JobRow, inp: LocalJobInput, assetId: string, deduplicated: boolean) {
    const base = { assetId, deduplicated };
    const clipId = inp.audio?.clipId;
    if (inp.apply !== 'replace-clip' || !clipId) return { status: 'imported', ...base, reason: 'no placement requested; the result is in the media library' };
    const proposal = { op: 'replace_clip_asset', args: { clipId, assetId } };
    const conflicts = inp.preconditions.flatMap((p) => {
      const v = this.store.entityVersion(job.projectId, p.entityId);
      return (v?.revision ?? 0) !== p.version ? [{ entityId: p.entityId, expectedVersion: p.version, currentVersion: v?.revision ?? 0, deleted: v?.deleted ?? false, by: v?.actor ?? null }] : [];
    });
    if (conflicts.length) return { status: 'proposed', ...base, reason: 'the clip changed while the tool ran; it was not given the new file', conflicts, proposal };
    if (job.actor.startsWith('agent:') && this.governance?.isPaused(job.projectId)) return { status: 'proposed', ...base, reason: 'agents are paused on this project; the result is in the library and was not placed', proposal };
    try {
      const r = this.store.commit({ projectId: job.projectId, actor: job.actor, label: `Use the result of ${inp.capabilityId} in the clip`, ops: [proposal] });
      return { status: 'attached', ...base, clipId, revision: r.revision, transactionId: r.transactionId };
    } catch (e) {
      if (e instanceof ApiError) return { status: 'proposed', ...base, reason: `the clip could not take the new file: ${e.message}`, error: e.code, proposal };
      throw e;
    }
  }

  // ------------------------------------------------------------ cancel, recover, stop

  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
    const j = this.store.getJob(jobId);
    if (['succeeded', 'failed', 'canceled'].includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    if (j.status === 'queued') {
      this.laneWaits.get(jobId)?.abort();
      this.store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor} before it started; nothing was imported` } });
      return { jobId, status: 'canceled', outcome: 'removed-from-queue' };
    }
    this.store.updateJob(jobId, { status: 'cancel-requested' });
    this.running.get(jobId)?.kill('SIGKILL');
    return { jobId, status: 'cancel-requested', outcome: 'stopping' };
  }
  /**
   * After a restart. A job that never started is driven again. One that was running is closed: failed and retryable, never
   * re-imported. If its result had already been imported (the server stopped between the import and closing the job), it is closed
   * as succeeded with that asset and the reason it was not placed.
   */
  recover(jobs: JobRow[]): void {
    for (const j of jobs) {
      const local = LocalInput.safeParse(j.input?.local);
      if (!local.success) continue; // not a local-tool job
      const d = LOCAL_TOOLS.find((x) => x.id === local.data.capabilityId);
      const interrupted = j.status === 'running' || j.status === 'cancel-requested' || (j.status === 'queued' && (j.attempt > 0 || j.stage === 'recovered-after-restart'));
      if (!interrupted && j.status === 'queued') {
        if (d) void this.drive(j.id, d);
        else this.store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'capability_not_found', message: `${local.data.capabilityId} is no longer in the reviewed registry`, retryable: false } });
        continue;
      }
      if (!interrupted) continue;
      if (j.status === 'cancel-requested') { this.finishCanceled(j.id); continue; }
      let doc;
      try { doc = this.store.getProject(j.projectId).doc; } catch { this.store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'interrupted', message: 'the server stopped while this tool was running, and the project is gone', retryable: false } }); continue; }
      const imported = Object.values(doc.assets).find((x) => x.provenance.derived?.jobId === j.id);
      if (imported) {
        const placed = Object.values(doc.sequences).some((s) => s.tracks.some((t) => t.clips.some((c) => c.type === 'media' && c.assetId === imported.id)));
        this.store.updateJob(j.id, { status: 'succeeded', stage: null, output: { ...j.output, attachment: { status: placed ? 'attached' : 'imported', assetId: imported.id, reason: 'the server restarted after the result was imported; the job was closed on the next start' } } });
        continue;
      }
      const storing = j.stage === 'storing the translation';
      this.store.updateJob(j.id, { status: 'failed', stage: null, error: { code: 'interrupted', retryable: true, message: storing
        ? 'the server stopped while the translation was being stored; check the formats list before running it again'
        : 'the server stopped while this tool was running; nothing was imported. Run it again.' } });
    }
  }
  /** Stop idle kept workers (the lane calls this before heavy work so their memory is free). A worker serving a request is left alone. */
  async releaseKept(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const [key, k] of this.kept) {
      if (k.done) continue;
      if (k.idle) clearTimeout(k.idle);
      this.kept.delete(key);
      if (k.p.exitCode !== null || k.p.signalCode !== null) continue;
      waits.push(new Promise((r) => { k.p.once('close', r); setTimeout(r, 5000).unref(); k.p.kill('SIGKILL'); }));
    }
    await Promise.all(waits);
  }
  /** Shutdown: running rows stay as they are (recover() closes them on the next start). */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const c of this.laneWaits.values()) c.abort();
    for (const p of this.running.values()) p.kill('SIGKILL');
    for (const k of this.kept.values()) { if (k.idle) clearTimeout(k.idle); k.p.kill('SIGKILL'); }
    await Promise.allSettled([...this.active.values()]);
  }

  // ------------------------------------------------------------ processes

  /** One request at a time through the tools worker (the kept worker takes one request at a time). */
  private inTurn<R>(fn: () => Promise<R>): Promise<R> {
    const p = this.serial.then(fn, fn);
    this.serial = p.catch(() => {});
    return p;
  }
  private exec(cmd: string, args: string[], jobId: string | null, what: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs, killSignal: 'SIGKILL', cwd: this.store.tmpDir });
      if (jobId) this.running.set(jobId, p);
      let out = '', err = '';
      p.stdout.on('data', (b) => { if (out.length < 65536) out += b; });
      p.stderr.on('data', (b) => { err = (err + b).slice(-4000); });
      p.on('error', (e) => { if (jobId) this.running.delete(jobId); reject(new ApiError(503, 'engine_not_working', `${what} could not be started: ${e.message}`)); });
      p.on('close', (code, signal) => {
        if (jobId) this.running.delete(jobId);
        if (code === 0) resolve({ stdout: out, stderr: err });
        else reject(new ApiError(502, 'engine_failed', `${what} failed (${signal ? `stopped by ${signal}` : `exit ${code}`})`, { tail: err.slice(-400) }));
      });
    });
  }
  private ffmpeg(args: string[], jobId: string, what: string) {
    return this.exec('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', ...args], jobId, what, 30 * 60_000).catch((e) => {
      if (e instanceof ApiError && e.code === 'engine_failed') throw new ApiError(422, 'analysis_failed', what, e.details);
      throw e;
    });
  }
  private spawnWorker(python: string, args: string[], stdin: boolean): ChildProcess {
    // -I: the interpreter ignores PYTHON* variables, the user site and the script's directory, so only the worker and its installed
    // packages run. The working directory is the data directory's tmp, never a ComfyUI folder.
    return spawn(python, [...PYTHON_WORKER_FLAGS, this.worker, ...args], { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], cwd: this.store.tmpDir, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' } });
  }
  private oneShot(python: string, args: string[], onLine: (o: any) => void, jobId: string | null, timeoutMs = 12 * 3600_000): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      const p = this.spawnWorker(python, args, false);
      const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
      timer.unref();
      if (jobId) this.running.set(jobId, p);
      let buf = '', err = '';
      p.stdout!.setEncoding('utf8');
      p.stdout!.on('data', (d: string) => {
        buf += d;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { onLine(JSON.parse(line)); } catch { /* not a protocol line */ } }
      });
      p.stderr!.on('data', (d) => { err = (err + d).slice(-4000); });
      p.on('error', (e) => { clearTimeout(timer); if (jobId) this.running.delete(jobId); reject(new ApiError(503, 'engine_not_working', `the tools worker could not be started: ${e.message}`)); });
      p.on('close', (code) => { clearTimeout(timer); if (jobId) this.running.delete(jobId); resolve({ code, stderr: err }); });
    });
  }
  /**
   * A request through a worker that stays alive between jobs (PF_TOOLS_KEEP_SECONDS; 0 = one process per job), so the model is
   * loaded once. Killed when idle for that long, on cancel, on releaseKept() and at shutdown; that only costs the next job a load.
   */
  private request(python: string, args: string[], onLine: (o: any) => void, jobId: string, canceled: () => boolean): Promise<{ code: number | null; stderr: string }> {
    if (canceled()) return Promise.resolve({ code: null, stderr: 'canceled before it was sent' });
    if (!this.cfg.toolsKeepSeconds) return this.oneShot(python, args, onLine, jobId);
    const req: Record<string, string> = { cmd: args[0]! };
    for (let i = 1; i + 1 < args.length; i += 2) req[args[i]!.replace(/^--/, '').replaceAll('-', '_')] = args[i + 1]!;
    return new Promise((resolve, reject) => {
      let k = this.kept.get(python);
      if (!k) {
        const p = this.spawnWorker(python, ['serve'], true);
        const entry: Kept = { p, idle: null, onLine: null, done: null, err: '' };
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
        p.on('error', (e) => { if (this.kept.get(python) === entry) this.kept.delete(python); const done = entry.done; entry.done = null; if (done) reject(new ApiError(503, 'engine_not_working', `the tools worker could not be started: ${e.message}`)); });
        p.on('close', (code) => { if (this.kept.get(python) === entry) this.kept.delete(python); if (entry.idle) clearTimeout(entry.idle); entry.done?.({ code: code ?? 1, stderr: entry.err }); });
      }
      const entry = k;
      if (entry.idle) { clearTimeout(entry.idle); entry.idle = null; }
      entry.err = '';
      entry.onLine = onLine;
      entry.done = (r) => {
        entry.onLine = null; entry.done = null;
        this.running.delete(jobId);
        if (this.kept.get(python) === entry) { entry.idle = setTimeout(() => entry.p.kill('SIGKILL'), this.cfg.toolsKeepSeconds * 1000); entry.idle.unref(); }
        resolve(r);
      };
      this.running.set(jobId, entry.p);
      entry.p.stdin!.write(`${JSON.stringify(req)}\n`);
    });
  }
}

/** Free bytes on the file system that holds `dir` (its nearest existing ancestor), or null when it cannot be read. */
function freeBytes(dir: string): number | null {
  let d = path.resolve(dir);
  for (;;) {
    try { const s = fs.statfsSync(d); return Number(s.bavail) * Number(s.bsize); } catch { /* not there yet: try the parent */ }
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}
