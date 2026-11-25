/**
 * Library thumbnails (wave 7 library track, worker A): always a PNG made on this server, never the item's own bytes, so
 * third-party SVG never reaches the browser. SVG rows go through raster.ts (sanitised first); pictures are copied out of the
 * library through paths.ts checks into a private temp file and scaled by ffmpeg; video gives its first frame (files up to
 * THUMB_VIDEO_MAX_BYTES); sound has no picture (404). Cached under <dataDir>/library-thumbs, at most LIBRARY_THUMBS_MAX_BYTES,
 * least recently used first out. One ffmpeg at a time for pictures and video.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { LIBRARY_READERS_VERSION } from '@pulseframe/core';
import { ApiError } from '../store.ts';
import { LIBRARY_THUMBS_DIR, LIBRARY_THUMBS_MAX_BYTES, MAX_READ_BYTES } from './contract.ts';
import type { IndexedRow } from './index.ts';
import { checkedDigest, copyChecked, openChecked } from './paths.ts';
import { rasteriseRow } from './raster.ts';

const exec = promisify(execFile);
export const THUMB_SIZES = [128, 256] as const;
export const THUMB_VIDEO_MAX_BYTES = 256 * 1024 * 1024;
const PICTURE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const VIDEO = new Set(['mp4', 'mov', 'webm', 'mkv']);

let chain: Promise<unknown> = Promise.resolve();
const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => { const p = chain.then(fn, fn); chain = p.catch(() => undefined); return p; };

const noPicture = () => new ApiError(404, 'not_found', 'this library item has no picture', {}, 'Listen to it with …/audio instead.');

export async function libraryThumb(dataDir: string, tmpDir: string, rootReal: string, ix: IndexedRow, size: 128 | 256): Promise<Buffer> {
  const isSvg = ix.format === 'svg';
  if (!isSvg && !PICTURE.has(ix.format) && !VIDEO.has(ix.format)) throw noPicture();
  const dir = path.join(dataDir, LIBRARY_THUMBS_DIR);
  const name = createHash('sha256').update(JSON.stringify([ix.row.key, size, ix.bytes, ix.mtimeMs, ix.entry.sha256 ?? null, LIBRARY_READERS_VERSION])).digest('hex') + '.png';
  const cached = path.join(dir, name);
  // a cached thumbnail does not skip the checks: the file must still be the one indexed (and inside its folder)
  await assertStillIndexed(rootReal, ix);
  try {
    const b = fs.readFileSync(cached);
    const now = new Date();
    try { fs.utimesSync(cached, now, now); } catch { /* best effort */ }
    return b;
  } catch { /* not cached yet */ }
  let png: Buffer;
  if (isSvg) png = (await rasteriseRow(tmpDir, rootReal, ix, size, undefined, 'preview')).png;
  else png = await oneAtATime(() => ffmpegThumb(tmpDir, rootReal, ix, size, VIDEO.has(ix.format)));
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new ApiError(500, 'thumbnail_failed', 'the thumbnail could not be made');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, png, { mode: 0o600 });
  fs.renameSync(tmp, cached);
  prune(dir);
  return png;
}

/** The cheap part of the use checks (containment, size and mtime, or a file item's size) without copying anything. */
async function assertStillIndexed(rootReal: string, ix: IndexedRow): Promise<void> {
  const f = await openChecked(rootReal, ix);
  try { await checkedDigest(f, ix); } finally { await f.fd.close(); }
}

async function ffmpegThumb(tmpDir: string, rootReal: string, ix: IndexedRow, size: number, video: boolean): Promise<Buffer> {
  fs.mkdirSync(tmpDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(tmpDir, 'libthumb_'));
  try {
    const src = path.join(work, `in.${ix.format}`), out = path.join(work, 'out.png');
    await copyChecked(rootReal, ix, src, video ? THUMB_VIDEO_MAX_BYTES : 8 * MAX_READ_BYTES);
    const scale = `scale='if(gte(iw,ih),${size},-2)':'if(gte(iw,ih),-2,${size})':flags=area,format=rgba`;
    try {
      await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', src, '-frames:v', '1', '-vf', scale, '-c:v', 'png', '-pix_fmt', 'rgba', out], { timeout: 30_000, maxBuffer: 1 << 20 });
    } catch {
      throw new ApiError(500, 'thumbnail_failed', 'the thumbnail could not be made from this file', {}, 'The file may be damaged; check it with the download tool (--verify).');
    }
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function prune(dir: string) {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => { const p = path.join(dir, f); const s = fs.statSync(p); return { p, size: s.size, t: s.mtimeMs }; });
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= LIBRARY_THUMBS_MAX_BYTES) return;
    files.sort((a, b) => a.t - b.t);
    for (const f of files) { if (total <= LIBRARY_THUMBS_MAX_BYTES * 0.9) break; fs.rmSync(f.p, { force: true }); total -= f.size; }
  } catch { /* the cache is best effort */ }
}
