/**
 * Decoding the sampled frames of a video for the picture index (wave 7 search track; decisions §3 item 10–11, G).
 * - The frame index is the decode index n (the project's convention). The targets come from core sampleFrameTargets.
 * - One ffmpeg per chunk of at most FOOTAGE_LIMITS.selectChunk targets: `select='eq(n,k0)+eq(n,k1)+…'`, `-fps_mode passthrough`,
 *   `scale=256:256:flags=bilinear`, rgb24 raw frames on stdout (never written to disk), `-protocol_whitelist file` (no network).
 *   Each chunk decodes from the start of the file up to its last target (unmeasured cost; a keyframe path is a later, measured change).
 * - Delivered ≠ asked → 422 decode_failed (no pts arithmetic, nothing guessed). Frames are handed out in batches of at most
 *   FOOTAGE_LIMITS.batchFrames, with the frame indices they are; the consumer stopping (cancel) kills ffmpeg.
 */
import { spawn } from 'node:child_process';
import { FOOTAGE_LIMITS } from '@pulseframe/core';
import { ApiError } from '../store.ts';
import type { FrameSource } from '../vision/types.ts';

export const SIDE = 256;
export const FRAME_BYTES = SIDE * SIDE * 3;
export interface FrameBatch { frames: number[]; rgb: Uint8Array }

/** The ffmpeg arguments of one chunk (exported for the test of the decided command line). */
export function chunkArgs(file: string, targets: readonly number[]): string[] {
  const select = targets.map((k) => `eq(n,${k})`).join('+');
  return ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file', '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `select='${select}',scale=${SIDE}:${SIDE}:flags=bilinear`, '-fps_mode', 'passthrough', '-frames:v', String(targets.length),
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1'];
}

/** The frames `targets` (ascending decode indices) of `src`, in batches. Throws decode_failed when ffmpeg delivers another count. */
export async function* sampledFrames(src: Pick<FrameSource, 'file' | 'kind'>, targets: readonly number[], signal: AbortSignal, batch: number = FOOTAGE_LIMITS.batchFrames): AsyncGenerator<FrameBatch> {
  let pending: number[] = [];
  let buf: Buffer = Buffer.alloc(0);
  const take = (n: number): FrameBatch => {
    const frames = pending.slice(0, n);
    pending = pending.slice(n);
    const rgb = new Uint8Array(buf.subarray(0, n * FRAME_BYTES));
    buf = buf.subarray(n * FRAME_BYTES);
    return { frames, rgb: rgb.slice() };
  };
  for (let c = 0; c < targets.length; c += FOOTAGE_LIMITS.selectChunk) {
    const chunk = targets.slice(c, c + FOOTAGE_LIMITS.selectChunk);
    if (signal.aborted) throw signal.reason ?? new Error('aborted');
    const p = spawn('ffmpeg', chunkArgs(src.file, chunk), { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '', spawnError: Error | null = null;
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { spawnError = e; });
    const closed = new Promise<number | null>((res) => p.on('close', (code) => res(code)));
    const kill = () => { try { p.kill('SIGKILL'); } catch { /* gone */ } };
    signal.addEventListener('abort', kill, { once: true });
    let delivered = 0;
    try {
      for await (const d of p.stdout as AsyncIterable<Buffer>) {
        buf = buf.length ? Buffer.concat([buf, d]) : d;
        const whole = Math.floor(buf.length / FRAME_BYTES) - pending.length;
        if (whole > 0) {
          if (delivered + whole > chunk.length) { kill(); throw new ApiError(422, 'decode_failed', `ffmpeg delivered more frames than the ${chunk.length} asked of the ${src.kind}`, { asked: chunk.length }); }
          pending.push(...chunk.slice(delivered, delivered + whole));
          delivered += whole;
        }
        while (pending.length >= batch) yield take(batch);
      }
      const code = await closed;
      if (signal.aborted) throw signal.reason ?? new Error('aborted');
      if (spawnError) throw new ApiError(503, 'engine_not_working', `ffmpeg could not be started: ${(spawnError as Error).message}`);
      if (code !== 0) throw new ApiError(422, 'decode_failed', `ffmpeg could not decode the ${src.kind}`, { exit: code, tail: err.trim().slice(-300) });
      if (delivered !== chunk.length || buf.length !== pending.length * FRAME_BYTES) throw new ApiError(422, 'decode_failed', `ffmpeg delivered ${delivered} of the ${chunk.length} frames asked of the ${src.kind}`, { asked: chunk.length, delivered });
    } finally {
      signal.removeEventListener('abort', kill);
      kill();
      await Promise.race([closed, new Promise((r) => setTimeout(r, 5000))]);
    }
  }
  while (pending.length) yield take(Math.min(batch, pending.length));
}
