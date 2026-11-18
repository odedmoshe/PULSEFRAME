/**
 * Level envelope of a file's sound (multicam, ADR-0020 plan §4; type and byte format in core multicamEnvelope.ts). No model.
 *
 * - ONE streaming ffmpeg pass: -copyts, -map 0:a:0, aresample=16000:first_pts=round(timeOrigin·streamRate) (the mixer
 *   convention, audiomix.ts; first_pts counts INPUT samples), native channels, f32le. Sample k is at SOURCE time k/16000, also when the sound starts after the picture.
 * - Frame n ↔ source time rt(n, 100) exactly (sample 160n):
 *   - RMS of a 20 ms (320-sample) Hann window centred on sample 160n, in centi-dBFS clamped to [-12000, 0], per native
 *     channel (≤ 8) and for the mixdown (the mean of all channels, so equal channels keep their level);
 *   - spectral flux of the mixdown: a 512-point Hann FFT centred on sample 160n (hop 160), the half-wave-rectified rise of
 *     log1p(1000·|X|) over bins 1..255 against the previous frame (frame 0 is 0), the beats.ts measure.
 *   Samples outside the decoded sound are zeros. Frames: ceil(decoded samples / 160).
 * - Memory stays bounded: only the last 512 + one chunk of samples are held; the output is 10 bytes per channel and frame.
 * - Deterministic: the same file decodes to the same samples, so two builds give byte-identical encodings.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { decodeEnvelope, encodeEnvelope, ENVELOPE_DECODE_RATE, ENVELOPE_FLOOR_CDB, ENVELOPE_MAX_CHANNELS, ENVELOPE_RATE, timeOriginSeconds, type Asset, type LevelEnvelope } from '@pulseframe/core';
import { heavy } from './analysis.ts';
import type { DerivativeRow, Derivatives } from './derive.ts';
import { ANALYSIS_TIMEOUT_MS, fftMag } from './dsp.ts';
import { ApiError, type Store } from './store.ts';

export const ENVELOPE_HOP = ENVELOPE_DECODE_RATE / ENVELOPE_RATE; // 160
const RMS_N = 2 * ENVELOPE_HOP; // 320 (20 ms)
const FFT_N = 512;
const HALF = FFT_N / 2;
/** Version of the measure; part of the derivative's meta, so a changed measure is rebuilt rather than read. */
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_METHOD = '20 ms Hann RMS per channel and mix every 10 ms; log-spectral flux of the mix (512-point FFT, hop 160) at 16 kHz';
const HANN_RMS = Float64Array.from({ length: RMS_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / RMS_N));
const HANN_RMS_SUM = HANN_RMS.reduce((a, b) => a + b, 0);
const HANN_FFT = Float64Array.from({ length: FFT_N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / FFT_N));

/** Thrown when `abandoned()` turned true while decoding: nothing is stored. */
export class EnvelopeAbandoned extends Error { constructor() { super('building the level envelope was canceled'); } }

const cdb = (meanSquare: number): number => {
  if (!(meanSquare > 0)) return ENVELOPE_FLOOR_CDB;
  const v = Math.round(1000 * Math.log10(meanSquare)); // 100 · 10·log10(ms) = centi-dB of the RMS
  return v < ENVELOPE_FLOOR_CDB ? ENVELOPE_FLOOR_CDB : v > 0 ? 0 : v;
};

/**
 * The frame measurer over a stream of interleaved samples (C channels). Exported so the unit test can feed it synthetic sound
 * without ffmpeg; buildEnvelope feeds it ffmpeg's output.
 */
export function envelopeMeasurer(assetId: string, C: number) {
  if (!Number.isInteger(C) || C < 1) throw new Error('an envelope needs at least one channel');
  const keep = Math.min(C, ENVELOPE_MAX_CHANNELS);
  // sliding buffers: global sample index of buf[0] is `base`; begins with HALF zeros (samples before the file's start)
  let cap = 1 << 16;
  let bufs = Array.from({ length: keep + 1 }, () => new Float32Array(cap)); // channels..., mix
  let base = -HALF, len = HALF, next = 0; // next = frame to measure
  const levels: number[][] = Array.from({ length: keep + 1 }, () => []);
  const flux: number[] = [];
  let prev = new Float64Array(HALF), first = true;
  const re = new Float64Array(FFT_N), im = new Float64Array(FFT_N);
  let decoded = 0, carry: Buffer | null = null;
  const grow = (need: number) => {
    if (len + need <= cap) return;
    // drop what no frame still needs (everything before 160·next − HALF)
    const drop = Math.max(0, Math.min(len, ENVELOPE_HOP * next - HALF - base));
    if (drop > 0) { for (const b of bufs) b.copyWithin(0, drop, len); base += drop; len -= drop; }
    if (len + need > cap) {
      while (len + need > cap) cap *= 2;
      bufs = bufs.map((b) => { const n = new Float32Array(cap); n.set(b.subarray(0, len)); return n; });
    }
  };
  const measure = (n: number) => {
    const c = ENVELOPE_HOP * n;
    for (let k = 0; k <= keep; k++) {
      const b = bufs[k]!;
      let s = 0;
      for (let i = 0, j = c - ENVELOPE_HOP - base; i < RMS_N; i++, j++) { const x = b[j]!; s += HANN_RMS[i]! * x * x; }
      levels[k]!.push(cdb(s / HANN_RMS_SUM));
    }
    const m = bufs[keep]!;
    for (let i = 0, j = c - HALF - base; i < FFT_N; i++, j++) { re[i] = m[j]! * HANN_FFT[i]!; im[i] = 0; }
    fftMag(re, im);
    const cur = new Float64Array(HALF);
    let f = 0;
    for (let k = 1; k < HALF; k++) { cur[k] = Math.log1p(1000 * Math.hypot(re[k]!, im[k]!)); const d = cur[k]! - prev[k]!; if (d > 0) f += d; }
    flux.push(first ? 0 : f);
    first = false;
    prev = cur;
  };
  const drain = () => { while (ENVELOPE_HOP * next + HALF <= base + len) measure(next++); };
  const samples = (x: Float32Array) => {
    const frames = Math.floor(x.length / C);
    grow(frames);
    for (let t = 0; t < frames; t++) {
      let sum = 0;
      for (let ch = 0; ch < C; ch++) { const v = x[t * C + ch]!; sum += v; if (ch < keep) bufs[ch]![len] = v; }
      bufs[keep]![len] = sum / C;
      len++;
    }
    decoded += frames;
    drain();
  };
  return {
    /** Interleaved f32 samples (any chunking). */
    samples,
    /** Raw f32le bytes as ffmpeg writes them (any chunking). */
    bytes(chunk: Buffer) {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % (4 * C));
      carry = whole < buf.length ? Buffer.from(buf.subarray(whole)) : null;
      if (!whole) return;
      const al = Buffer.from(buf.subarray(0, whole)); // aligned copy for the typed view
      samples(new Float32Array(al.buffer, al.byteOffset, whole / 4));
    },
    finish(): LevelEnvelope {
      const F = Math.ceil(decoded / ENVELOPE_HOP);
      const tail = Math.max(0, ENVELOPE_HOP * (F - 1) + HALF - (base + len));
      grow(tail);
      for (const b of bufs) b.fill(0, len, len + tail);
      len += tail;
      while (next < F) measure(next++);
      const toI16 = (a: number[]) => Int16Array.from(a.slice(0, F));
      return { assetId, rate: 100, frames: F, channels: levels.slice(0, keep).map(toI16), mix: toI16(levels[keep]!), flux: Float32Array.from(flux.slice(0, F)) };
    },
  };
}

/** Decode `file` once and measure its envelope (see the file header). `channels` is the stream's channel count (asset.audio.channels). */
export function buildEnvelope(file: string, asset: Pick<Asset, 'id' | 'timeOrigin' | 'audio'>, abandoned: () => boolean = () => false): Promise<LevelEnvelope> {
  const C = asset.audio?.channels ?? 0;
  if (!asset.audio || C < 1) return Promise.reject(new ApiError(422, 'no_audio', `file ${asset.id} has no sound to measure`, { assetId: asset.id }));
  const m = envelopeMeasurer(asset.id, C);
  // aresample's first_pts counts samples of its INPUT rate (measured with ffmpeg 6.1: first_pts=round(origin·16000) on a 48 kHz
  // stream padded only from origin/3), so it is given at the stream's own rate.
  const first = Math.round(timeOriginSeconds(asset) * (asset.audio.sampleRate || ENVELOPE_DECODE_RATE));
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=${ENVELOPE_DECODE_RATE}:first_pts=${first}`, '-ac', String(C), '-ar', String(ENVELOPE_DECODE_RATE), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let err = '', gaveUp = false;
    p.stderr.on('data', (d) => { err = (err + d).slice(-800); });
    p.stdout.on('data', (d: Buffer) => {
      if (gaveUp) return;
      if (abandoned()) { gaveUp = true; p.kill('SIGKILL'); return; }
      m.bytes(d);
    });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (gaveUp) return reject(new EnvelopeAbandoned());
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the sound of this file could not be measured', { assetId: asset.id, tail: err.slice(-400) }));
      resolve(m.finish());
    });
  });
}

/** A caller waiting on a shared build; `abandoned` is its own cancel test (none: it never cancels). */
interface Waiter { abandoned?: () => boolean; resolve: (e: LevelEnvelope) => void; reject: (e: unknown) => void }
/** One build per content hash, shared by every caller of that file while it runs. */
interface Build { waiters: Set<Waiter> }
const inflight = new Map<string, Build>();
const metaOf = (e: LevelEnvelope) => ({ version: ENVELOPE_VERSION, rate: ENVELOPE_RATE, decodeRate: ENVELOPE_DECODE_RATE, frames: e.frames, channels: e.channels.length, method: ENVELOPE_METHOD });
const usable = (row: DerivativeRow | null): row is DerivativeRow & { blobHash: string } => !!row && row.status === 'ready' && !!row.blobHash && (row.meta as { version?: number } | null)?.version === ENVELOPE_VERSION;

/** The stored envelope of a file, or null when it was never built (never spawns ffmpeg). */
export function storedEnvelope(store: Store, derivatives: Derivatives | null, asset: Asset): LevelEnvelope | null {
  const row = derivatives?.get(asset.contentHash, 'envelope') ?? null;
  if (!usable(row)) return null;
  try { return decodeEnvelope(asset.id, new Uint8Array(fs.readFileSync(store.blobPath(row.blobHash)))); } catch { return null; }
}
/** 'ready' | 'building' | 'missing' | 'failed', for the group view. */
export function envelopeStatus(derivatives: Derivatives | null, asset: Asset): 'ready' | 'building' | 'missing' | 'failed' {
  if (inflight.has(asset.contentHash)) return 'building';
  const row = derivatives?.get(asset.contentHash, 'envelope') ?? null;
  if (usable(row)) return 'ready';
  return row?.status === 'failed' ? 'failed' : row?.status === 'running' ? 'building' : 'missing';
}

/**
 * The envelope of `asset`: read from the derivative store, or built under heavy() and stored there (announced over SSE).
 * Concurrent requests for one file share one build. A caller that abandons (its `abandoned()` turned true) is rejected with
 * EnvelopeAbandoned on its own; the build itself stops only when every caller waiting on it has abandoned, so a canceled job
 * never takes the envelope away from an in-request sync, a recipe or the envelope route. Without a derivative store (a process
 * with no Derivatives) it is built and not kept.
 */
export function envelopeOf(store: Store, derivatives: Derivatives | null, asset: Asset, abandoned?: () => boolean): Promise<LevelEnvelope> {
  const have = storedEnvelope(store, derivatives, asset);
  if (have) return Promise.resolve(have);
  const key = asset.contentHash;
  return new Promise<LevelEnvelope>((resolve, reject) => {
    const waiter: Waiter = { abandoned, resolve: (e) => resolve({ ...e, assetId: asset.id }), reject };
    const running = inflight.get(key);
    if (running) { running.waiters.add(waiter); return; }
    const build: Build = { waiters: new Set([waiter]) };
    inflight.set(key, build);
    const done = () => { if (inflight.get(key) === build) inflight.delete(key); };
    /**
     * Drops (and rejects) every waiter that abandoned while another still waits, and is true once every waiter abandoned, which
     * stops the build; those last waiters are rejected after the build has cleaned up (below).
     */
    const nobodyWaits = (): boolean => {
      const gone = [...build.waiters].filter((w) => w.abandoned?.());
      if (gone.length === build.waiters.size) { done(); return true; } // a caller arriving from now on starts its own build
      for (const w of gone) { build.waiters.delete(w); w.reject(new EnvelopeAbandoned()); }
      return false;
    };
    void (async () => {
      derivatives?.markOutside(key, 'envelope', 'running');
      try {
        const e = await heavy(() => (nobodyWaits() ? Promise.reject(new EnvelopeAbandoned()) : buildEnvelope(store.blobPath(key), asset, nobodyWaits)));
        if (derivatives) await derivatives.putBytes(key, 'envelope', encodeEnvelope(e), 'application/octet-stream', metaOf(e));
        done();
        for (const w of build.waiters) w.resolve(e);
      } catch (err) {
        done();
        if (err instanceof EnvelopeAbandoned) { if (!inflight.has(key) && derivatives?.get(key, 'envelope')?.status === 'running') derivatives.markOutside(key, 'envelope', 'failed', 'canceled'); }
        else derivatives?.markOutside(key, 'envelope', 'failed', err instanceof Error ? err.message : String(err));
        for (const w of build.waiters) w.reject(err);
      }
    })();
  });
}
