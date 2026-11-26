/**
 * Decoding one picture AS SHOWN for the eyes worker (wave 8 picmodels; plan §3.5 "Decoding as shown", contract.ts RULES).
 * - A still: ffmpeg with autorotation off (`-noautorotate`) and an EXPLICIT orientation filter for the JPEG's EXIF orientation 1–8
 *   (ingest.ts jpegOrientation reads it; ingest swaps the recorded size for 5–8, the browser also applies the flips 2/3/4), so the
 *   decoded size equals `asset.image` and a point means the same place as a hand mark.
 * - A video frame n: `select=eq(n\,n)` (the decode index, the project's convention) on the stored original (tracking.ts frameSource
 *   'original'; videos are conformed at import, so their display rotation is already applied), ffmpeg's default autorotation.
 * - Scaled so the long side is EYES.inputLongSide (bilinear), rgb24 on stdout: never written to disk, `-protocol_whitelist file`.
 * - A failure is picmodelsError('engineFailed', { reason: 'decode', exit }) — codes and integers only, never ffmpeg's text.
 */
import { spawn } from 'node:child_process';
import { EYES } from '@pulseframe/core';
import { picmodelsError } from './contract.ts';

/** The ffmpeg filter that turns a stored JPEG of EXIF orientation `o` into the picture as shown ('' = none). */
export function orientationFilter(o: number): string {
  switch (o) {
    case 2: return 'hflip';
    case 3: return 'hflip,vflip';
    case 4: return 'vflip';
    case 5: return 'transpose=0'; // row 0 shown on the left, column 0 on top: the main-diagonal transpose
    case 6: return 'transpose=1'; // 90° clockwise
    case 7: return 'transpose=3'; // the anti-diagonal transpose
    case 8: return 'transpose=2'; // 90° counter-clockwise
    default: return '';
  }
}
/** The size a shown picture of `w × h` is decoded at: long side `longSide`, the other side rounded (at least 1). */
export function scaledSize(w: number, h: number, longSide: number = EYES.inputLongSide): { w: number; h: number } {
  if (w >= h) return { w: longSide, h: Math.max(1, Math.round((longSide * h) / w)) };
  return { w: Math.max(1, Math.round((longSide * w) / h)), h: longSide };
}

export type DecodeTarget =
  | { kind: 'still'; file: string; orientation: number; shown: { width: number; height: number } }
  | { kind: 'video'; file: string; frame: number; shown: { width: number; height: number } };

/** The decided ffmpeg command line (exported for its test). */
export function decodeArgs(t: DecodeTarget, out: { w: number; h: number }): string[] {
  const scale = `scale=${out.w}:${out.h}:flags=bilinear`;
  const head = ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file'];
  const tail = ['-frames:v', '1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'];
  if (t.kind === 'still') {
    const vf = [orientationFilter(t.orientation), scale].filter(Boolean).join(',');
    return [...head, '-noautorotate', '-i', t.file, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf, ...tail];
  }
  return [...head, '-i', t.file, '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', `select=eq(n\\,${t.frame}),${scale}`, '-fps_mode', 'passthrough', ...tail];
}

export interface DecodedPicture { w: number; h: number; rgb: Buffer }
/** One picture as shown at long side EYES.inputLongSide, rgb24. Killed on abort (rejects with the signal's reason). */
export function decodeShown(t: DecodeTarget, signal: AbortSignal, longSide: number = EYES.inputLongSide, timeoutMs = 60_000): Promise<DecodedPicture> {
  const out = scaledSize(t.shown.width, t.shown.height, longSide);
  const want = out.w * out.h * 3;
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new Error('aborted')); return; }
    const p = spawn('ffmpeg', decodeArgs(t, out), { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let have = 0, done = false;
    const kill = () => { try { p.kill('SIGKILL'); } catch { /* gone */ } };
    const end = (fn: () => void) => { if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', onAbort); kill(); fn(); };
    const onAbort = () => end(() => reject(signal.reason ?? new Error('aborted')));
    const timer = setTimeout(() => end(() => reject(picmodelsError('engineFailed', { reason: 'decode_timeout' }))), timeoutMs);
    timer.unref();
    signal.addEventListener('abort', onAbort, { once: true });
    p.stdout.on('data', (d: Buffer) => { have += d.length; if (have > want) { end(() => reject(picmodelsError('engineFailed', { reason: 'decode', exit: -1 }))); return; } chunks.push(d); });
    p.on('error', () => end(() => reject(picmodelsError('engineFailed', { reason: 'decode_spawn' }))));
    p.on('close', (code) => {
      if (code === 0 && have === want) end(() => resolve({ w: out.w, h: out.h, rgb: Buffer.concat(chunks, want) }));
      else end(() => reject(picmodelsError('engineFailed', { reason: 'decode', exit: typeof code === 'number' ? code : -1 })));
    });
  });
}
