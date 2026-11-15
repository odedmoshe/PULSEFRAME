/**
 * Deterministic audio analysis that needs no model (SPEC §16 cleanup candidates).
 * Silence is measured by ffmpeg's `silencedetect` on the original source file. Results are candidates, never edits.
 */
import { spawn } from 'node:child_process';
import * as T from '@pulseframe/time';
import { BEAT_SR, detectBeats, type BeatResult } from './beats.ts';
import { ApiError } from './store.ts';

/** No analysis process may run longer than this; it is killed and the request fails. */
const ANALYSIS_TIMEOUT_MS = 10 * 60_000;

/**
 * At most `max` heavy jobs (analysis passes, loudness mixes, still renders) run at once; the rest wait their turn and at most
 * `maxQueue` may wait. These are reachable with a read-only credential, so without a limit a caller could exhaust CPU, disk or
 * memory by issuing many in parallel.
 */
export function limiter(max: number, maxQueue: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async function run<R>(fn: () => Promise<R>): Promise<R> {
    if (running >= max) {
      if (waiting.length >= maxQueue) throw new ApiError(429, 'busy', 'too many analysis or render requests are already waiting; try again shortly');
      await new Promise<void>((r) => waiting.push(r));
    }
    running++;
    try { return await fn(); } finally { running--; waiting.shift()?.(); }
  };
}
/** Shared by every model-free analysis and loudness route. */
export const heavy = limiter(2, 16);

export interface SilenceOptions { thresholdDb: number; minSeconds: number }

export function detectSilences(file: string, opts: SilenceOptions): Promise<{ start: T.RationalTime; end: T.RationalTime }[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-protocol_whitelist', 'file', '-i', file, '-map', '0:a:0', '-af', `silencedetect=noise=${opts.thresholdDb}dB:d=${opts.minSeconds}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 8_000_000) p.kill(); });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the audio of this file could not be analysed', { tail: err.slice(-400) }));
      const out: { start: T.RationalTime; end: T.RationalTime }[] = [];
      let start: string | null = null;
      for (const m of err.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
        if (m[1] === 'start') start = m[2]!;
        else if (start !== null) {
          // ffmpeg prints decimal seconds; they become exact microsecond rationals at this boundary.
          const s = T.max(T.ZERO, T.fromSeconds(start)), e = T.fromSeconds(m[2]!);
          if (T.lt(s, e)) out.push({ start: s, end: e });
          start = null;
        }
      }
      resolve(out);
    });
  });
}


/**
 * Hard picture cuts, from ffmpeg's scene-change score (difference between consecutive frames).
 * Returns the source time of the first frame of each new shot. Dissolves and fades are gradual and are NOT found by this method.
 */
export function detectScenes(file: string, threshold: number, rate: { num: number; den: number }): Promise<T.RationalTime[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-protocol_whitelist', 'file', '-i', file, '-map', '0:v:0', '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 16_000_000) p.kill(); });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the picture of this file could not be analysed', { tail: err.slice(-400) }));
      const frames = new Set<number>();
      // Decimal seconds become exact frame times at this boundary: the cut is the nearest source frame.
      for (const m of err.matchAll(/pts_time:(-?[\d.]+)/g)) frames.add(Math.round((Number(m[1]) * rate.num) / rate.den));
      resolve([...frames].filter((f) => f > 0).sort((a, b) => a - b).map((f) => T.frameTime(f, rate)));
    });
  });
}

/** Longest stretch of audio the beat tracker reads (it holds the mono signal in memory). */
export const BEAT_MAX_SECONDS = 1200;
/** Beat grid of a file's first audio stream (mono mix-down at 22.05 kHz, see beats.ts). Limited to BEAT_MAX_SECONDS of audio; the caller records when that cut the file short. */
export function detectBeatsOfFile(file: string): Promise<BeatResult> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:a:0', '-t', String(BEAT_MAX_SECONDS), '-ac', '1', '-ar', String(BEAT_SR), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the audio of this file could not be analysed'));
      const buf = Buffer.concat(chunks);
      resolve(detectBeats(new Float32Array(buf.buffer, buf.byteOffset, buf.length >> 2)));
    });
  });
}
