/**
 * «שמירת התמונה» (wave 8 cover W2; verify C5, C7, C10): the file of a saved picture, made from the lossless PNG that the render page
 * drew 1:1 from the still's one-clip document (core stillDocument, through the same evaluate + compositor as preview and export).
 * The source file is never decoded here: ffmpeg reads only that rendered PNG.
 *
 *   crop    `crop=w:h:x:y:exact=1,setsar=1` on the RGB picture: a copy of whole pixels, never a resample.
 *   PNG     `-c:v png -map_metadata -1`.
 *   JPEG    `-vf …,format=yuvj444p -c:v mjpeg -q:v 2 -flags +bitexact -map_metadata -1 -frames:v 1` (4:4:4, JFIF full range;
 *           +bitexact stops the "Lavc…" comment).
 *
 * The written file is checked before the export may succeed: ffprobe codec and exact size (= the crop), no format or stream tags,
 * and the file's own chunks (PNG) or segments (JPEG) read byte by byte against an allow-list: nothing that can hold a date, a
 * place, a camera, a comment or text (no tEXt / zTXt / iTXt / tIME / eXIf / iCCP, no APP1–APP15 / COM). A file that fails is
 * still_tags (or export_failed validation) and nothing is published.
 */
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import { promisify } from 'node:util';
import { STILLS_REFUSALS, type StillCrop } from '@pulseframe/core';
import { ApiError } from './store.ts';

const exec = promisify(execFile);
export type StillFormat = 'png' | 'jpeg';

/** The ffmpeg arguments that turn the rendered PNG into the saved picture (exported for the tests and the proof). */
export function stillFileArgs(o: { input: string; crop: StillCrop; format: StillFormat; outFile: string }): string[] {
  const { x, y, w, h } = o.crop;
  for (const n of [x, y, w, h]) if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`stillFileArgs: the crop must be whole pixels, not ${JSON.stringify(o.crop)}`);
  // setsar=1: square pixels stated, so the PNG says so (pHYs) whatever the rendered PNG carried, and mjpeg writes its JFIF APP0 (full-range
  // YCbCr); without a stated aspect ffmpeg 6.1 writes no APP0 at all (measured: a Chromium-like PNG without pHYs gave SOI, DQT, …).
  const crop = `crop=${w}:${h}:${x}:${y}:exact=1,setsar=1`;
  return [
    '-hide_banner', '-v', 'error', '-y', '-i', o.input, '-map', '0:v:0',
    ...(o.format === 'png'
      ? ['-vf', crop, '-c:v', 'png', '-map_metadata', '-1', '-frames:v', '1', '-f', 'image2', '-update', '1']
      : ['-vf', `${crop},format=yuvj444p`, '-c:v', 'mjpeg', '-q:v', '2', '-flags', '+bitexact', '-map_metadata', '-1', '-frames:v', '1', '-f', 'image2', '-update', '1']),
    o.outFile,
  ];
}

/** Runs ffmpeg once; `onProcess` lets the export stop it on cancel. */
export function runStillFfmpeg(args: string[], onProcess: (p: { kill(signal?: NodeJS.Signals): boolean } | null) => void = () => {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });
    onProcess(p);
    p.on('error', (e) => { onProcess(null); reject(e); });
    p.on('close', (code, signal) => { onProcess(null); code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code ?? signal}: ${stderr.slice(-800)}`)); });
  });
}

/** PNG chunks a saved picture may carry: the picture itself, its pixel aspect and colour description (no text, no time, no profile). */
export const STILL_PNG_CHUNKS = ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'pHYs', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'sBIT'] as const;
/** JPEG markers a saved picture may carry: SOI, APP0 (JFIF only), DQT, SOF0–SOF2, DHT, DRI, SOS, RST0–7, EOI. */
const JPEG_ALLOWED = new Set([0xd8, 0xe0, 0xdb, 0xc0, 0xc1, 0xc2, 0xc4, 0xdd, 0xda, 0xd9, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The chunk types of a PNG in file order (throws on a file that is not a whole PNG). */
export function pngChunks(b: Buffer): string[] {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG file');
  const out: string[] = [];
  let i = 8;
  while (i < b.length) {
    if (i + 12 > b.length) throw new Error(`PNG cut off at byte ${i}`);
    const n = b.readUInt32BE(i), type = b.toString('latin1', i + 4, i + 8);
    out.push(type);
    i += 12 + n;
    if (type === 'IEND') { if (i !== b.length) out.push(`(${b.length - i} bytes after IEND)`); break; }
  }
  return out;
}
/** The markers of a JPEG up to its scan and after it (hex names, e.g. "ffe0"), with APP0's identifier; throws on a file that is not a JPEG. */
export function jpegSegments(b: Buffer): { marker: number; id?: string }[] {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw new Error('not a JPEG file');
  const out: { marker: number; id?: string }[] = [{ marker: 0xd8 }];
  let i = 2;
  while (i + 2 <= b.length) {
    if (b[i] !== 0xff) throw new Error(`JPEG: no marker at byte ${i}`);
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd9) { out.push({ marker: m }); if (i + 2 !== b.length) out.push({ marker: -1, id: `${b.length - i - 2} bytes after EOI` }); break; }
    if (i + 4 > b.length) throw new Error(`JPEG cut off at byte ${i}`);
    const n = b.readUInt16BE(i + 2);
    out.push({ marker: m, ...(m >= 0xe0 && m <= 0xef ? { id: b.toString('latin1', i + 4, Math.min(i + 2 + n, i + 9)).replace(/\0.*$/s, '') } : {}) });
    i += 2 + n;
    if (m === 0xda) {
      // entropy-coded data: skip to the next marker that is not a stuffed byte or a restart
      while (i + 1 < b.length && !(b[i] === 0xff && b[i + 1] !== 0x00 && !(b[i + 1]! >= 0xd0 && b[i + 1]! <= 0xd7))) i++;
    }
  }
  return out;
}
/** What a saved picture carries beyond the allow-list, as readable names; empty = the file passes. */
export function stillChunkProblems(b: Buffer, format: StillFormat): string[] {
  if (format === 'png') return pngChunks(b).filter((t) => !(STILL_PNG_CHUNKS as readonly string[]).includes(t)).map((t) => `png:${t}`);
  return jpegSegments(b).filter((s) => !JPEG_ALLOWED.has(s.marker) || (s.marker === 0xe0 && s.id !== 'JFIF')).map((s) => `jpeg:ff${s.marker.toString(16)}${s.id ? `(${s.id})` : ''}`);
}

export interface StillValidation { codec: string | undefined; width: number | undefined; height: number | undefined; pixFmt: string | undefined; tags: string[]; chunks: string[] }
/**
 * The check of a written picture before success: codec png / mjpeg, width × height = the crop, no format or stream tags (ffprobe)
 * and no chunk or segment outside the allow-list (read from the bytes). Tags or chunks: still_tags, nothing saved. A wrong codec or
 * size: the export's ordinary validation failure.
 */
export async function checkStillFile(file: string, format: StillFormat, crop: Pick<StillCrop, 'w' | 'h'>): Promise<StillValidation> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,pix_fmt:format_tags:stream_tags', '-of', 'json', file], { timeout: 60_000, maxBuffer: 8 << 20 });
  const j = JSON.parse(stdout) as { format?: { tags?: Record<string, string> }; streams?: { codec_name?: string; width?: number; height?: number; pix_fmt?: string; tags?: Record<string, string> }[] };
  const s = j.streams?.[0];
  const tags = [...Object.keys(j.format?.tags ?? {}).map((k) => `format:${k}`), ...(j.streams ?? []).flatMap((x, i) => Object.keys(x.tags ?? {}).map((k) => `stream${i}:${k}`))];
  const chunks = stillChunkProblems(fs.readFileSync(file), format);
  const v: StillValidation = { codec: s?.codec_name, width: s?.width, height: s?.height, pixFmt: s?.pix_fmt, tags, chunks };
  if (tags.length || chunks.length) {
    const r = STILLS_REFUSALS.stillTags;
    throw new ApiError(500, r.code, r.message([...tags, ...chunks].slice(0, 8).join(', ')), { tags, chunks, retryable: false }, r.hint);
  }
  if (v.codec !== (format === 'png' ? 'png' : 'mjpeg') || v.width !== crop.w || v.height !== crop.h || (format === 'jpeg' && v.pixFmt !== 'yuvj444p'))
    throw new Error(`export failed validation: ${JSON.stringify({ ...v, expected: { codec: format === 'png' ? 'png' : 'mjpeg', width: crop.w, height: crop.h } })}`);
  return v;
}

/**
 * Writes the saved picture: the crop of `renderedPng` (the render page's lossless PNG at the file's own size) as PNG or JPEG at
 * `outFile`, then checks it. The caller owns the work directory (deleted on every path by the export's `finally`).
 */
export async function writeStillFile(o: { renderedPng: string; crop: StillCrop; format: StillFormat; outFile: string; onProcess?: (p: { kill(signal?: NodeJS.Signals): boolean } | null) => void }): Promise<StillValidation> {
  await runStillFfmpeg(stillFileArgs({ input: o.renderedPng, crop: o.crop, format: o.format, outFile: o.outFile }), o.onProcess);
  return checkStillFile(o.outFile, o.format, o.crop);
}
