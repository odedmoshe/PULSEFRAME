/**
 * Deterministic audio analysis that needs no model (SPEC §16 cleanup candidates).
 * Silence is measured by ffmpeg's `silencedetect` on the original source file. Results are candidates, never edits.
 */
import { spawn } from 'node:child_process';
import * as T from '@pulseframe/time';
import { ApiError } from './store.ts';

export interface SilenceOptions { thresholdDb: number; minSeconds: number }

export function detectSilences(file: string, opts: SilenceOptions): Promise<{ start: T.RationalTime; end: T.RationalTime }[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'info', '-i', file, '-map', '0:a:0', '-af', `silencedetect=noise=${opts.thresholdDb}dB:d=${opts.minSeconds}`, '-f', 'null', '-'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
