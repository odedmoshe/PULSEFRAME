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

/**
 * Every reader below takes `origin`: the file's own start time (Asset.timeOrigin, 0 for most files). ffmpeg is run with -copyts so
 * it reports the file's raw timestamps, and `origin` is subtracted here. Left to itself ffmpeg shifts timestamps by an amount that
 * depends on which streams are being decoded, which made picture and sound disagree for MPEG-TS files.
 */
export function detectSilences(file: string, opts: SilenceOptions, origin = 0): Promise<{ start: T.RationalTime; end: T.RationalTime }[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-protocol_whitelist', 'file', '-copyts', '-i', file, '-map', '0:a:0', '-af', `silencedetect=noise=${opts.thresholdDb}dB:d=${opts.minSeconds}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
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
          const rel = (x: string) => (origin ? (Number(x) - origin).toFixed(6) : x);
          const s = T.max(T.ZERO, T.fromSeconds(rel(start))), e = T.fromSeconds(rel(m[2]!));
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
export function detectScenes(file: string, threshold: number, rate: { num: number; den: number }, origin = 0): Promise<T.RationalTime[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-protocol_whitelist', 'file', '-copyts', '-i', file, '-map', '0:v:0', '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let err = '';
    p.stderr.on('data', (d) => { err += d; if (err.length > 16_000_000) p.kill(); });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the picture of this file could not be analysed', { tail: err.slice(-400) }));
      const frames = new Set<number>();
      // Decimal seconds become exact frame times at this boundary: the cut is the nearest source frame.
      for (const m of err.matchAll(/pts_time:(-?[\d.]+)/g)) frames.add(Math.round(((Number(m[1]) - origin) * rate.num) / rate.den));
      resolve([...frames].filter((f) => f > 0).sort((a, b) => a - b).map((f) => T.frameTime(f, rate)));
    });
  });
}

/** Longest stretch of audio the beat tracker reads at once (it holds the mono signal in memory): longer files are analysed window by window. */
export const BEAT_MAX_SECONDS = 1200;
/** Longest file the beat tracker analyses in all; beyond it only this much is analysed and the caller records that. */
export const BEAT_TOTAL_MAX_SECONDS = 4 * 3600;
function beatsOfWindow(file: string, origin: number, fromSeconds: number, windowSeconds: number): Promise<BeatResult> {
  return new Promise((resolve, reject) => {
    const from = Math.round(fromSeconds * BEAT_SR), to = from + Math.round(windowSeconds * BEAT_SR);
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', file, '-map', '0:a:0', '-af', `aresample=${BEAT_SR}:first_pts=${Math.round(origin * BEAT_SR)},atrim=start_sample=${from}:end_sample=${to},asetpts=PTS-STARTPTS` /* beat times on the file's own clock, also when its sound starts late */, '-ac', '1', '-ar', String(BEAT_SR), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
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
/**
 * Beat grid of a file's first audio stream (mono mix-down at 22.05 kHz, see beats.ts). A file longer than BEAT_MAX_SECONDS is
 * analysed in consecutive windows of that length, each with its own tempo estimate (a long recording seldom keeps one tempo);
 * `windows` says how many. The reported bpm is that of the most confident window, the confidence the lowest of all.
 * At most BEAT_TOTAL_MAX_SECONDS are analysed; the caller records when that cut the file short.
 */
export async function detectBeatsOfFile(file: string, origin = 0, durationSeconds = BEAT_MAX_SECONDS, windowSeconds = BEAT_MAX_SECONDS): Promise<BeatResult & { windows: number }> {
  const total = Math.min(durationSeconds, BEAT_TOTAL_MAX_SECONDS);
  const beats: number[] = [];
  let best: BeatResult | null = null, lowest = 1, windows = 0;
  for (let from = 0; from < total - 1e-6 || windows === 0; from += windowSeconds) {
    const r = await beatsOfWindow(file, origin, from, windowSeconds);
    windows++;
    for (const b of r.beats) if (!beats.length || from + b > beats[beats.length - 1]! + 0.05) beats.push(Number((from + b).toFixed(4)));
    if (r.bpm !== null && (!best || r.confidence > best.confidence)) best = r;
    if (r.beats.length) lowest = Math.min(lowest, r.confidence);
  }
  return { bpm: best?.bpm ?? null, confidence: beats.length ? lowest : 0, beats, windows };
}
