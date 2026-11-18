/**
 * Audio features of a source file for the shorts finder (ADR-0018, plan §4.3; contract core shortsContract.ts §3). No model.
 *
 * - ffmpeg decodes the first audio stream to mono 16 kHz (the channels averaged, so equal channels keep their level), with
 *   -copyts and aresample first_pts at the file's own time origin, so sample k is at SOURCE time k/16000 (as analysis.ts
 *   beatsOfWindow does). The file is read in 20-minute windows (analysis.ts BEAT_MAX_SECONDS), at most 4 h in all
 *   (BEAT_TOTAL_MAX_SECONDS; `partial` says when the file was longer); each window is one ffmpeg run under heavy() with the
 *   10-minute kill, and `abandoned()` is checked before each window (a canceled measurement stops there and caches nothing).
 * - Per hop i of 1600 samples (100 ms; SOURCE time [i/10, (i+1)/10)):
 *   - rmsDb: RMS level of the hop in dBFS (a full-scale sine is −3.01 dB; not LUFS), floor FEATURE_RMS_FLOOR_DB;
 *   - flatness: geometric over arithmetic mean of the magnitude spectrum from 100 Hz to 7.9 kHz, from a 2048-point Hann FFT
 *     centred on the hop (white noise ≈ 0.85, a pure tone ≈ 0; digital silence 0);
 *   - flux: mean positive rise of the log magnitudes over the same bins against the previous hop (0 for the first hop).
 *   Each window is decoded with 224 samples beyond each edge, so every FFT sees the same samples whichever window it falls
 *   in: the 1200 s seam has no gap, no duplicate and no different value.
 * - Cached under <store.dataDir>/features/<contentHash hex>.audio-v<version>.bin (+ .json), keyed by the content hash and
 *   AUDIO_FEATURES_VERSION; never in the document.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { AUDIO_FEATURES_METHOD, AUDIO_FEATURES_VERSION, FEATURE_HOP, FEATURE_RATE, FEATURE_RMS_FLOOR_DB, timeOriginSeconds, type Asset, type AudioFeatures } from '@pulseframe/core';
import { BEAT_MAX_SECONDS, BEAT_TOTAL_MAX_SECONDS, heavy } from './analysis.ts';
import { ApiError, type Store } from './store.ts';

/** Length of one decoding window (as the beat tracker's). */
export const FEATURE_WINDOW_SECONDS = BEAT_MAX_SECONDS;
/** No feature decode may run longer than this; it is killed and the measurement fails. */
const FEATURE_TIMEOUT_MS = 10 * 60_000;
const FFT_N = 2048;
const PAD = (FFT_N - FEATURE_HOP) / 2; // 224
const BIN_HZ = FEATURE_RATE / FFT_N;
const K0 = Math.ceil(100 / BIN_HZ), K1 = Math.floor(7900 / BIN_HZ);
const LOG_FLOOR = 1e-5;

/** Thrown when `abandoned()` turned true between windows: nothing was measured to the end, nothing is cached. */
export class FeaturesAbandoned extends Error { constructor() { super('the measurement of the sound was canceled'); } }

// ---------- the spectrum ----------
const HANN = Float64Array.from({ length: FFT_N }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / FFT_N));
const BITREV = (() => { const r = new Uint16Array(FFT_N), bits = Math.log2(FFT_N); for (let i = 0; i < FFT_N; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; })();
const COS = Float64Array.from({ length: FFT_N / 2 }, (_, k) => Math.cos((-2 * Math.PI * k) / FFT_N));
const SIN = Float64Array.from({ length: FFT_N / 2 }, (_, k) => Math.sin((-2 * Math.PI * k) / FFT_N));
/** In-place radix-2 FFT of (re, im), length FFT_N. */
function fft(re: Float64Array, im: Float64Array) {
  for (let i = 0; i < FFT_N; i++) { const j = BITREV[i]!; if (j > i) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; } }
  for (let size = 2; size <= FFT_N; size <<= 1) {
    const half = size >> 1, step = FFT_N / size;
    for (let s = 0; s < FFT_N; s += size)
      for (let k = 0; k < half; k++) {
        const c = COS[k * step]!, d = SIN[k * step]!, a = s + k, b = a + half;
        const tr = re[b]! * c - im[b]! * d, ti = re[b]! * d + im[b]! * c;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
      }
  }
}

/**
 * The per-hop measurer: feed it the samples of hop i's 2048-sample frame (hop start − 224 .. hop end + 224) in hop order.
 * Pure; exported for the tests.
 */
export function hopMeasurer() {
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  let prev: Float64Array | null = null;
  return (frame: (k: number) => number): { rmsDb: number; flatness: number; flux: number } => {
    let sq = 0;
    for (let k = PAD; k < PAD + FEATURE_HOP; k++) { const v = frame(k); sq += v * v; }
    const rms = Math.sqrt(sq / FEATURE_HOP);
    const rmsDb = rms > 0 ? Math.max(FEATURE_RMS_FLOOR_DB, 20 * Math.log10(rms)) : FEATURE_RMS_FLOOR_DB;
    for (let k = 0; k < FFT_N; k++) { re[k] = frame(k) * HANN[k]!; im[k] = 0; }
    fft(re, im);
    const logs = new Float64Array(K1 - K0 + 1);
    let sum = 0, logSum = 0;
    for (let k = K0; k <= K1; k++) {
      const mag = Math.hypot(re[k]!, im[k]!) / (FFT_N / 4); // a sine of amplitude A peaks near A
      sum += mag; logSum += Math.log(mag + 1e-12);
      logs[k - K0] = Math.log(mag + LOG_FLOOR);
    }
    const n = K1 - K0 + 1, mean = sum / n;
    const flatness = mean < 1e-9 ? 0 : Math.min(1, Math.exp(logSum / n) / mean);
    let flux = 0;
    if (prev) { for (let k = 0; k < n; k++) { const d = logs[k]! - prev[k]!; if (d > 0) flux += d; } flux /= n; }
    prev = logs;
    return { rmsDb, flatness, flux };
  };
}

// ---------- decoding ----------
/** Samples of the stream by absolute index, appended as they arrive; old ones dropped once no frame needs them. */
class Samples {
  private buf = new Float32Array(1 << 17);
  private len = 0;
  constructor(private start: number) {}
  get end() { return this.start + this.len; }
  push(x: Float32Array) {
    if (this.len + x.length > this.buf.length) { const b = new Float32Array(Math.max(this.buf.length * 2, this.len + x.length)); b.set(this.buf.subarray(0, this.len)); this.buf = b; }
    this.buf.set(x, this.len); this.len += x.length;
  }
  at(abs: number) { const k = abs - this.start; return k < 0 || k >= this.len ? 0 : this.buf[k]!; }
  drop(abs: number) { const k = Math.min(this.len, abs - this.start); if (k > 0) { this.buf.copyWithin(0, k, this.len); this.len -= k; this.start += k; } }
}

/** The mono mix of `channels` channels as a pan expression (an average, so equal channels keep their level). */
const monoMix = (channels: number) => (channels > 1 ? `pan=mono|c0=${Array.from({ length: channels }, (_, i) => `${(1 / channels).toPrecision(12)}*c${i}`).join('+')},` : '');

interface Out { rmsDb: Float32Array; flatness: Float32Array; flux: Float32Array }
/** Decode hops [h0, h1) (one window) and measure them in order with `measure`. */
function measureWindow(file: string, origin: number, channels: number, h0: number, h1: number, measure: ReturnType<typeof hopMeasurer>, out: Out): Promise<void> {
  return new Promise((resolve, reject) => {
    const s0 = h0 * FEATURE_HOP - PAD, s1 = h1 * FEATURE_HOP + PAD;
    const from = Math.max(0, s0);
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', file, '-map', '0:a:0',
      '-af', `${monoMix(channels)}aresample=${FEATURE_RATE}:first_pts=${Math.round(origin * FEATURE_RATE)},atrim=start_sample=${from}:end_sample=${s1},asetpts=PTS-STARTPTS`,
      '-ac', '1', '-ar', String(FEATURE_RATE), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: FEATURE_TIMEOUT_MS, killSignal: 'SIGKILL' });
    const samples = new Samples(from);
    let h = h0, rest: Buffer = Buffer.alloc(0), err = '';
    const ready = (upTo: number) => {
      // hop h needs samples up to (h+1)·HOP + PAD
      while (h < h1 && (h + 1) * FEATURE_HOP + PAD <= upTo) {
        const base = h * FEATURE_HOP - PAD;
        const m = measure((k) => samples.at(base + k));
        out.rmsDb[h] = m.rmsDb; out.flatness[h] = m.flatness; out.flux[h] = m.flux;
        h++;
        samples.drop(h * FEATURE_HOP - PAD);
      }
    };
    p.stdout.on('data', (d: Buffer) => {
      const b = rest.length ? Buffer.concat([rest, d]) : d;
      const n = b.length >> 2;
      const x = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + n * 4)); // f32le on a little-endian host
      rest = b.subarray(n * 4);
      samples.push(x);
      ready(samples.end);
    });
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code, signal) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', signal === 'SIGKILL' ? 'measuring the sound of this file took too long and was stopped' : 'the sound of this file could not be measured', { tail: err.slice(-400) }));
      ready(Number.POSITIVE_INFINITY); // past the end of the sound: silence
      resolve();
    });
  });
}

// ---------- the cache ----------
const hexOf = (contentHash: string) => contentHash.replace(/^sha256:/, '');
/** Where the features of `contentHash` at `version` are cached (exported for the tests). */
export function featuresCachePaths(store: Store, contentHash: string, version: number = AUDIO_FEATURES_VERSION) {
  const hex = hexOf(contentHash);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new ApiError(400, 'bad_hash', 'malformed content hash');
  const dir = path.join(store.dataDir, 'features');
  return { dir, bin: path.join(dir, `${hex}.audio-v${version}.bin`), json: path.join(dir, `${hex}.audio-v${version}.json`) };
}
interface CacheMeta { contentHash: string; version: number; hops: number; analysedSeconds: number; partial: boolean; method: string; rate: number; hop: number }

/** Read the cached features of `asset` at `version` (default the current one), or null. Never spawns ffmpeg. */
export function readCachedFeatures(store: Store, asset: Asset, version: number = AUDIO_FEATURES_VERSION): AudioFeatures | null {
  const p = featuresCachePaths(store, asset.contentHash, version);
  let meta: CacheMeta, bytes: Buffer;
  try { meta = JSON.parse(fs.readFileSync(p.json, 'utf8')) as CacheMeta; bytes = fs.readFileSync(p.bin); } catch { return null; }
  if (meta.version !== AUDIO_FEATURES_VERSION || meta.contentHash !== asset.contentHash || meta.method !== AUDIO_FEATURES_METHOD || meta.rate !== FEATURE_RATE || meta.hop !== FEATURE_HOP) return null;
  if (!Number.isInteger(meta.hops) || meta.hops < 0 || bytes.length !== meta.hops * 12) return null;
  const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  return {
    assetId: asset.id, contentHash: asset.contentHash, version: AUDIO_FEATURES_VERSION, hops: meta.hops, analysedSeconds: meta.analysedSeconds, partial: meta.partial,
    rmsDb: all.subarray(0, meta.hops), flatness: all.subarray(meta.hops, 2 * meta.hops), flux: all.subarray(2 * meta.hops), method: AUDIO_FEATURES_METHOD,
  };
}
function writeCache(store: Store, f: AudioFeatures) {
  const p = featuresCachePaths(store, f.contentHash);
  fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
  const all = new Float32Array(f.hops * 3);
  all.set(f.rmsDb.subarray(0, f.hops), 0); all.set(f.flatness.subarray(0, f.hops), f.hops); all.set(f.flux.subarray(0, f.hops), 2 * f.hops);
  const bytes = Buffer.from(all.buffer); // little-endian float32, as read back
  const meta: CacheMeta = { contentHash: f.contentHash, version: f.version, hops: f.hops, analysedSeconds: f.analysedSeconds, partial: f.partial, method: f.method, rate: FEATURE_RATE, hop: FEATURE_HOP };
  // the data first, the description last: a description is only ever found next to complete data
  const tmp = `${p.bin}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, bytes); fs.renameSync(tmp, p.bin);
  fs.writeFileSync(`${p.json}.${process.pid}.tmp`, JSON.stringify(meta)); fs.renameSync(`${p.json}.${process.pid}.tmp`, p.json);
}

/** The cached features of `asset` for this AUDIO_FEATURES_VERSION, or null when they were never measured. Never spawns ffmpeg. */
export function cachedAudioFeatures(store: Store, asset: Asset): AudioFeatures | null {
  return asset.audio ? readCachedFeatures(store, asset) : null;
}

/** How many hops cover `duration` (a partial last hop counts), and whether the 4 h cap cut it short. */
export function hopPlan(duration: T.RationalTime): { hops: number; analysedSeconds: number; partial: boolean } {
  const cap = T.rt(BEAT_TOTAL_MAX_SECONDS, 1), d = T.min(duration, cap);
  const rate = { num: FEATURE_RATE / FEATURE_HOP, den: 1 };
  const hops = T.frameIndexAt(d, rate) + (T.isFrameAligned(d, rate) ? 0 : 1);
  return { hops: Math.max(0, hops), analysedSeconds: T.toSeconds(d), partial: T.lt(cap, duration) };
}

/** Measure (or read from the cache) the audio features of `asset`; stops before the next window once `abandoned()` is true. */
export async function audioFeaturesOf(store: Store, asset: Asset, abandoned?: () => boolean): Promise<AudioFeatures> {
  if (!asset.audio) throw new ApiError(422, 'no_audio', `file ${asset.id} has no sound to measure`, { assetId: asset.id });
  const cached = readCachedFeatures(store, asset);
  if (cached) return cached;
  const plan = hopPlan(asset.duration);
  const out: Out = { rmsDb: new Float32Array(plan.hops).fill(FEATURE_RMS_FLOOR_DB), flatness: new Float32Array(plan.hops), flux: new Float32Array(plan.hops) };
  const measure = hopMeasurer();
  const file = store.blobPath(asset.contentHash), origin = timeOriginSeconds(asset), channels = asset.audio.channels;
  const perWindow = Math.round(FEATURE_WINDOW_SECONDS * (FEATURE_RATE / FEATURE_HOP));
  for (let h0 = 0; h0 < plan.hops; h0 += perWindow) {
    if (abandoned?.()) throw new FeaturesAbandoned();
    const h1 = Math.min(plan.hops, h0 + perWindow);
    await heavy(() => measureWindow(file, origin, channels, h0, h1, measure, out));
  }
  if (abandoned?.()) throw new FeaturesAbandoned();
  const f: AudioFeatures = { assetId: asset.id, contentHash: asset.contentHash, version: AUDIO_FEATURES_VERSION, hops: plan.hops, analysedSeconds: plan.analysedSeconds, partial: plan.partial, ...out, method: AUDIO_FEATURES_METHOD };
  writeCache(store, f);
  return f;
}
