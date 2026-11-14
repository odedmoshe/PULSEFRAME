/** Trusted ingest: stream to disk while hashing, probe the real container/codecs with ffprobe, store content-addressed. */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import * as T from '@pulseframe/time';
import type { Asset } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';

const exec = promisify(execFile);

export async function ffprobe(file: string): Promise<any> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000, maxBuffer: 8 << 20 });
  return JSON.parse(stdout);
}
const parseRate = (s: string | undefined) => {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? '');
  return m && +m[1]! > 0 && +m[2]! > 0 ? { num: +m[1]!, den: +m[2]! } : null;
};
const MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' };

export async function ingestUpload(store: Store, body: ReadableStream<Uint8Array>, name: string, actor: string, maxBytes: number): Promise<Omit<Asset, 'id'>> {
  const tmp = path.join(store.tmpDir, `up_${randomBytes(8).toString('hex')}`);
  const hash = createHash('sha256');
  let size = 0;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) return cb(new ApiError(413, 'upload_too_large', `upload exceeds ${maxBytes} bytes`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as any), meter, fs.createWriteStream(tmp, { mode: 0o600 }));
    if (size === 0) throw new ApiError(400, 'empty_upload', 'upload body is empty');
    let probe;
    try {
      probe = await ffprobe(tmp);
    } catch {
      throw new ApiError(415, 'unsupported_media', 'file is not a media container ffprobe can read', {}, 'Phase 0 accepts MP4/WebM video and common audio files.');
    }
    const streams: any[] = probe.streams ?? [];
    const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    const a = streams.find((s) => s.codec_type === 'audio');
    const formats: string[] = String(probe.format?.format_name ?? '').split(',');
    if (v && (formats.some((f) => /image2|_pipe$/.test(f)) || v.codec_name === 'mjpeg' && !v.nb_frames))
      throw new ApiError(415, 'unsupported_media', 'still images are not supported yet (planned for Phase 2)');
    if (!v && !a) throw new ApiError(415, 'unsupported_media', 'no audio or video stream found');
    const container = formats.includes('mp4') ? 'mp4' : formats.includes('webm') ? 'webm' : (formats[0] ?? 'unknown');
    let duration = T.fromSeconds(String(Number(probe.format?.duration ?? (v ?? a).duration ?? 0).toFixed(6)));
    let video: Asset['video'];
    if (v) {
      const rate = parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate);
      if (!rate) throw new ApiError(415, 'unsupported_media', 'video stream has no usable frame rate');
      if (v.avg_frame_rate !== v.r_frame_rate) throw new ApiError(415, 'unsupported_media', 'variable-frame-rate sources are not supported yet (planned conform route, Phase 2)', { avg: v.avg_frame_rate, r: v.r_frame_rate });
      const frameCount = v.nb_frames ? Number(v.nb_frames) : null;
      const rotation = Number(v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0);
      if (rotation % 360 !== 0) throw new ApiError(415, 'unsupported_media', 'rotated sources are not supported yet (Phase 2)', { rotation });
      // Exact duration from frame count when the container states it; otherwise the decimal container duration.
      if (frameCount) duration = T.frameTime(frameCount, rate);
      video = { width: v.width, height: v.height, frameRate: rate, codec: v.codec_name, rotation, frameCount };
    }
    const audio = a ? { sampleRate: Number(a.sample_rate), channels: Number(a.channels), codec: String(a.codec_name) } : undefined;
    if (!T.lt(T.ZERO, duration)) throw new ApiError(415, 'unsupported_media', 'media has zero duration');
    const contentHash = `sha256:${hash.digest('hex')}`;
    const mimeType = (v ? MIME[container] : MIME[container === 'mp4' ? 'm4a' : container]) ?? 'application/octet-stream';
    store.putBlob(contentHash, tmp, size, mimeType);
    return { kind: v ? 'video' : 'audio', name: path.basename(name).slice(0, 256) || 'untitled', contentHash, byteSize: size, container, mimeType, duration, video, audio, provenance: { origin: 'upload', importedAt: new Date().toISOString(), importedBy: actor } };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
