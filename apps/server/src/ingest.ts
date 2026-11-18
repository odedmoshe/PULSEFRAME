/**
 * Trusted ingest: stream to disk while hashing, probe the real container/codecs with ffprobe, store content-addressed.
 * Since ADR-0023 in three reusable phases (receiveOriginal, prepareWithoutConform, conformVideo), composed by ingestUpload (the
 * synchronous path) and by the import queue (importQueue.ts). Every export that existed before keeps its signature.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import * as T from '@pulseframe/time';
import { cutUploadName, LUT_MAX_TEXT_LENGTH, LutError, MAX_RELATIVE_PATH_CHARS, MAX_UPLOAD_NAME_CHARS, parseCube, startOffsetFrames, type Asset, type Capture } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';
import { DEFAULT_HOME_ZONE } from './config.ts';
import { readCapture, type CaptureContext } from './captureMeta.ts';

const exec = promisify(execFile);

export async function ffprobe(file: string): Promise<any> {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30_000, maxBuffer: 8 << 20 });
  return JSON.parse(stdout);
}
/** EXIF orientation (1–8) of a JPEG, or 1 when it has none. Reads only the start of the file. */
export function jpegOrientation(file: string): number {
  let b: Buffer;
  try { const fd = fs.openSync(file, 'r'); b = Buffer.alloc(262144); const n = fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); b = b.subarray(0, n); } catch { return 1; }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let o = 2;
  while (o + 4 <= b.length && b[o] === 0xff) {
    const marker = b[o + 1]!, len = b.readUInt16BE(o + 2);
    if (marker === 0xda || len < 2) break; // start of scan: no more headers
    if (marker === 0xe1 && b.toString('latin1', o + 4, o + 10) === 'Exif\0\0') {
      const t = o + 10; // TIFF header
      if (t + 8 > b.length) return 1;
      const le = b.toString('latin1', t, t + 2) === 'II';
      const u16 = (p: number) => (le ? b.readUInt16LE(p) : b.readUInt16BE(p));
      const u32 = (p: number) => (le ? b.readUInt32LE(p) : b.readUInt32BE(p));
      const ifd = t + u32(t + 4);
      if (ifd + 2 > b.length) return 1;
      const count = u16(ifd);
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > b.length) return 1;
        if (u16(e) === 0x0112) { const val = u16(e + 8); return val >= 1 && val <= 8 ? val : 1; }
      }
      return 1;
    }
    o += 2 + len;
  }
  return 1;
}
/** Number of video packets in the first video stream, read without decoding (null when it cannot be determined). */
export async function countVideoPackets(file: string): Promise<number | null> {
  try {
    const { stdout } = await exec('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file', '-select_streams', 'v:0', '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file], { timeout: 120_000, maxBuffer: 1 << 20 });
    // MPEG-TS lists the stream once per programme as well, so the value can be printed more than once: take the first.
    const n = Number((stdout.trim().split(/\s+/)[0] ?? '').replace(/,/g, ''));
    return Number.isInteger(n) && n > 0 ? n : null;
  } catch { return null; }
}
const parseRate = (s: string | undefined) => {
  const m = /^(\d+)\/(\d+)$/.exec(s ?? '');
  return m && +m[1]! > 0 && +m[2]! > 0 ? { num: +m[1]!, den: +m[2]! } : null;
};
const MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4' };

const ALPHA_PIX = /^(rgba|bgra|argb|abgr|ya\d|yuva|gbrap|pal8|rgba64|ya16)/;
export type MediaMeta = Pick<Asset, 'kind' | 'container' | 'mimeType' | 'duration' | 'video' | 'audio' | 'image' | 'timeOrigin' | 'lut'>;
/** Video codecs the editor decodes directly (WebCodecs, measured in docs/CAPABILITIES.md). Anything else is conformed. */
const EDITABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
/** Transfer functions of high-dynamic-range video: PQ (HDR10, Dolby Vision base layers) and HLG. */
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67']);
const HDR_TO_SDR = 'zscale=t=linear:npl=203,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.6:desat=0,zscale=t=bt709:m=bt709:r=tv';
export class NeedsConform extends Error {
  constructor(public reasons: ('variable-frame-rate' | 'rotation' | 'codec' | 'pixel-aspect' | 'still-format' | 'hdr')[], public original: NonNullable<Asset['conform']>['original'], public targetRate: { num: number; den: number }) { super('needs conform'); }
}
const STANDARD_RATES = [[24000, 1001], [24, 1], [25, 1], [30000, 1001], [30, 1], [50, 1], [60000, 1001], [60, 1]] as const;
/** Probe a local file and describe it as asset metadata. Used for uploads and for provider outputs alike. */
export async function describeMedia(file: string): Promise<MediaMeta> {
  let probe;
  try {
    probe = await ffprobe(file);
  } catch {
    throw new ApiError(415, 'unsupported_media', 'the file could not be read as video, sound or a picture', {}, 'Supported: MP4/WebM video, common audio files, PNG/JPEG/WebP stills.');
  }
  const streams: any[] = probe.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === 'audio');
  const formats: string[] = String(probe.format?.format_name ?? '').split(',');
  if (!v && !a) throw new ApiError(415, 'unsupported_media', 'no audio or video stream found');
  // Only self-contained media files are accepted. Playlist and script-like formats (HLS, DASH, concat, SDP, ...) can point at
  // other files or URLs, which must never be followed on behalf of an uploader.
  if (!formats.some((f) => CONTAINERS.has(f) || /_pipe$/.test(f))) throw new ApiError(415, 'unsupported_media', `container format "${formats.join(',')}" is not accepted`, { accepted: [...CONTAINERS] });
  const stillCodec = ({ png: 'image/png', mjpeg: 'image/jpeg', webp: 'image/webp' } as Record<string, string>)[v?.codec_name];
  const isStillFile = formats.some((f) => /image2|_pipe$/.test(f));
  if (v && stillCodec && isStillFile && !a) {
    if (!(v.width > 0 && v.height > 0)) throw new ApiError(415, 'unsupported_media', v.codec_name === 'webp' ? 'this WebP could not be read as a single picture (animated WebP is not supported)' : 'the picture could not be read (no dimensions)');
    if (v.width * v.height > 64_000_000) throw new ApiError(415, 'unsupported_media', 'the picture is larger than 64 megapixels');
    // A JPEG may be stored sideways with a tag saying how to turn it (photos from phones). The browser turns it when drawing,
    // so the size recorded here must be the size as shown, or the picture would be fitted to the wrong shape.
    const turned = v.codec_name === 'mjpeg' && [5, 6, 7, 8].includes(jpegOrientation(file));
    return { kind: 'image', container: v.codec_name === 'mjpeg' ? 'jpeg' : v.codec_name, mimeType: stillCodec, duration: T.ZERO, image: { width: turned ? v.height : v.width, height: turned ? v.width : v.height, codec: v.codec_name, hasAlpha: ALPHA_PIX.test(String(v.pix_fmt ?? '')) } };
  }
  // Stills in formats the browser path does not draw directly are converted to PNG (lossless) at import:
  // BMP, TIFF, a GIF with a single frame, and AVIF / HEIF pictures (which ffprobe reports as one-frame "video").
  const brand = String(probe.format?.tags?.major_brand ?? '').trim().toLowerCase();
  const heifStill = ['avif', 'heic', 'heix', 'mif1'].includes(brand);
  const oneFrameGif = formats.includes('gif') && v && Number(v.nb_frames ?? 0) === 1;
  if (v && !a && ((isStillFile && ['bmp', 'tiff'].includes(v.codec_name)) || oneFrameGif || heifStill))
    throw new NeedsConform(['still-format'], { codec: String(v.codec_name), width: Number(v.width) || 0, height: Number(v.height) || 0, avgFrameRate: '0/0', rFrameRate: '0/0', rotation: 0, frameCount: 1, durationSeconds: 0 }, { num: 1, den: 1 });
  if (v && isStillFile) throw new ApiError(415, 'unsupported_media', `still image format ${v.codec_name} is not supported yet`);
  const container = formats.includes('mp4') ? 'mp4' : formats.includes('webm') ? 'webm' : (formats[0] ?? 'unknown');
  let duration = T.fromSeconds(String(Number(probe.format?.duration ?? (v ?? a).duration ?? 0).toFixed(6)));
  // The container's own start time. Players (and ffmpeg) treat it as time zero; MPEG-TS files typically start around 1.4 s.
  // Stream start times below are measured from it, so only the offsets BETWEEN picture and sound are kept.
  const originRaw = Number(probe.format?.start_time ?? 0);
  // Never below zero: material stamped before time 0 is not presented by players, so it is cut here too rather than shifting everything later.
  const origin = Number.isFinite(originRaw) ? Math.max(0, originRaw) : 0;
  let video: Asset['video'];
  if (v) {
    const rate = parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate);
    if (!rate) throw new ApiError(415, 'unsupported_media', 'video stream has no usable frame rate');
    // Matroska, WebM and MPEG-TS do not state the number of frames; count the packets (no decoding) so the length and the last frame are exact.
    const frameCount = v.nb_frames ? Number(v.nb_frames) : await countVideoPackets(file);
    const rotation = Number(v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0);
    const reasons: NeedsConform['reasons'] = [];
    if (v.avg_frame_rate !== v.r_frame_rate) reasons.push('variable-frame-rate');
    if (rotation % 360 !== 0) reasons.push('rotation');
    if (!EDITABLE_VIDEO.has(v.codec_name)) reasons.push('codec');
    // Non-square pixels (anamorphic DV/HDV/broadcast material): the stored width is not the shown width. The conformed copy has square pixels.
    const [sarN, sarD] = String(v.sample_aspect_ratio ?? '1:1').split(':').map(Number);
    if (sarN! > 0 && sarD! > 0 && Math.abs(sarN! / sarD! - 1) > 0.005) reasons.push('pixel-aspect');
    // High dynamic range (PQ or HLG): the editor works in standard range (BT.709, 8 bits), so the copy is tone-mapped. Read as it is, such a picture looks grey and washed out.
    if (HDR_TRANSFERS.has(String(v.color_transfer))) reasons.push('hdr');
    if (reasons.length) {
      // Constant target rate: the standard rate nearest the average rate (a documented choice, not a guess per frame).
      const avg = rate.num / rate.den;
      const [num, den] = [...STANDARD_RATES].sort((x, y) => Math.abs(x[0] / x[1] - avg) - Math.abs(y[0] / y[1] - avg))[0]!;
      throw new NeedsConform(reasons, { codec: v.codec_name, width: v.width, height: v.height, avgFrameRate: v.avg_frame_rate, rFrameRate: v.r_frame_rate, rotation, frameCount, durationSeconds: Number(probe.format?.duration ?? 0) }, reasons.includes('variable-frame-rate') ? { num, den } : rate);
    }
    // Where the picture starts in the file. Not 0 after many remuxes, in Matroska/TS, or with B-frames and no edit list.
    const start = Number(v.start_time ?? 0) - origin;
    const startTime = Number.isFinite(start) && Math.abs(start) > 1e-6 ? T.fromSeconds(start.toFixed(6)) : undefined;
    const startFrames = startTime ? startOffsetFrames({ frameRate: rate, startTime }) : 0;
    // Exact duration from frame count when the container states it (plus the frames the picture starts late); otherwise the decimal container duration.
    if (frameCount) duration = T.frameTime(frameCount + Math.max(0, startFrames), rate);
    // Sound that runs on after the last picture (by a whole frame or more) is part of the file: the asset is as long as its sound,
    // in whole frames, and the last picture is held under it (as players do). Without this the tail of the sound was silently dropped.
    if (frameCount && a) {
      const aLen = Number(a.duration);
      const soundEnd = Number.isFinite(aLen) && aLen > 0 ? Number(a.start_time ?? 0) - origin + aLen : Number(probe.format?.duration ?? 0);
      const soundFrames = Math.floor((soundEnd * rate.num) / rate.den + 1e-6);
      if (Number.isFinite(soundFrames) && soundFrames > frameCount + Math.max(0, startFrames)) duration = T.frameTime(soundFrames, rate);
    }
    // No statement of how colours are encoded (matrix). Decoders then guess, and they do not all guess alike.
    const untagged = !v.color_space || v.color_space === 'unknown';
    video = { width: v.width, height: v.height, frameRate: rate, codec: v.codec_name, rotation, frameCount, ...(startTime ? { startTime } : {}), ...(untagged ? { untaggedColour: true as const } : {}) };
  }
  const aStart = a ? Number(a.start_time ?? 0) - origin : 0;
  const audio = a ? { sampleRate: Number(a.sample_rate), channels: Number(a.channels), codec: String(a.codec_name), ...(Number.isFinite(aStart) && Math.abs(aStart) > 1e-6 ? { startTime: T.fromSeconds(aStart.toFixed(6)) } : {}) } : undefined;
  if (!T.lt(T.ZERO, duration)) throw new ApiError(415, 'unsupported_media', 'media has zero duration');
  const mimeType = (v ? MIME[container] : MIME[container === 'mp4' ? 'm4a' : container]) ?? 'application/octet-stream';
  return { kind: v ? 'video' : 'audio', container, mimeType, duration, video, audio, ...(Math.abs(origin) > 1e-6 ? { timeOrigin: T.fromSeconds(origin.toFixed(6)) } : {}) };
}

/** Self-contained containers ffprobe may report for an upload (names as ffmpeg prints them). */
const CONTAINERS = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2', 'matroska', 'webm', 'wav', 'mp3', 'ogg', 'flac', 'aac', 'avi', 'mpegts', 'image2', 'gif', 'aiff', 'w64', 'caf']);

// ---------------------------------------------------------------------------------------------------------------------------
// The phases of an import (ADR-0023). ingestUpload (the synchronous path: colour tables, provider results, tests) and the import
// queue (importQueue.ts) are both made of these, so a file gives the same asset whichever way it arrives: the same probe, the
// same lossless still copy, the same conform recipe (CONFORM_RECIPE in importContracts.ts names it).
// ---------------------------------------------------------------------------------------------------------------------------

/** C0 controls (and DEL) and the bidi override and isolate characters U+202A–202E, U+2066–2069: never part of a stored name. */
const NAME_JUNK = /[\u0000-\u001f\u007f‪-‮⁦-⁩]/g;
/**
 * The import queue's name rule (all its routes): the basename over both separators, without C0 controls and bidi overrides,
 * cut to MAX_UPLOAD_NAME_CHARS (UTF-16 units, no code point split, a `.cube` suffix kept), 'untitled' when nothing is left.
 * `isCube` is read from the cleaned name before the cut (the cut keeps the suffix, so it never changes the reader).
 */
export function cleanUploadName(name: string): { name: string; isCube: boolean } {
  const base = (String(name ?? '').split(/[\\/]/).pop() ?? '').replace(NAME_JUNK, '');
  return { name: cutUploadName(base, MAX_UPLOAD_NAME_CHARS, Infinity) || 'untitled', isCube: /\.cube$/i.test(base) };
}
/** A dropped folder's relative path: cleaned like a name (separators kept), cut to MAX_RELATIVE_PATH_CHARS; undefined when empty. */
export function cleanRelativePath(p: string | null | undefined): string | undefined {
  if (typeof p !== 'string') return undefined;
  const cut = cutUploadName(p.replace(NAME_JUNK, ''), MAX_RELATIVE_PATH_CHARS, Infinity);
  return cut.length ? cut : undefined;
}

export interface ReceivedOriginal { /** The temporary file (mode 0600) in store.tmpDir; the caller stores or removes it. */ tmp: string; /** sha256:<hex> of the bytes as received. */ hash: string; size: number }
/**
 * Phase 1: stream the body to a temporary file while counting and hashing it. Refuses (and removes the partial file):
 * 413 upload_too_large past `maxBytes` (a `.cube` name also past LUT_MAX_TEXT_LENGTH, the parser's own limit), 507
 * storage_quota_exceeded past `roomBytes` (the storage ceiling's room, when the caller gives it) or as soon as `reserve` refuses
 * the size received so far (a reservation that grows as the bytes arrive: storage.ts UploadLedger), 507 disk_full when the disk
 * fills, 400 upload_incomplete when `signal` aborts, 400 empty_upload for no bytes. `fsync` flushes the file before returning
 * (the queue answers the sender once this returns: a promise to another device).
 */
export async function receiveOriginal(store: Store, body: Readable, opts: { maxBytes: number; isCube: boolean; roomBytes?: number; reserve?: (sizeSoFar: number) => { ok: true } | { ok: false; roomBytes: number }; signal?: AbortSignal; fsync?: boolean; tmpName?: string }): Promise<ReceivedOriginal> {
  const tmp = path.join(store.tmpDir, opts.tmpName ?? `up_${randomBytes(8).toString('hex')}`);
  const hash = createHash('sha256');
  let size = 0;
  const room = opts.roomBytes ?? Infinity;
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (opts.isCube && size > LUT_MAX_TEXT_LENGTH) return cb(new ApiError(413, 'upload_too_large', `a colour table (.cube) file can be at most ${LUT_MAX_TEXT_LENGTH} bytes`, { maxBytes: LUT_MAX_TEXT_LENGTH }));
      if (size > opts.maxBytes) return cb(new ApiError(413, 'upload_too_large', `upload exceeds ${opts.maxBytes} bytes`));
      const r = size > room ? { ok: false as const, roomBytes: room } : opts.reserve ? opts.reserve(size) : null;
      if (r && !r.ok) return cb(new ApiError(507, 'storage_quota_exceeded', 'not enough room to store this upload: the storage ceiling would be passed', { roomBytes: r.roomBytes }, 'Delete projects you no longer need and run the storage clean-up (owner: project manager → storage), or raise PF_MAX_STORAGE_BYTES.'));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(body, meter, fs.createWriteStream(tmp, { mode: 0o600 }), ...(opts.signal ? [{ signal: opts.signal }] as const : []));
    if (size === 0) throw new ApiError(400, 'empty_upload', 'upload body is empty');
    if (opts.fsync) { const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    return { tmp, hash: `sha256:${hash.digest('hex')}`, size };
  } catch (e: any) {
    fs.rmSync(tmp, { force: true });
    if (e instanceof ApiError) throw e;
    if (e?.code === 'ENOSPC') throw diskFull();
    if (opts.signal?.aborted || e?.name === 'AbortError') throw new ApiError(400, 'upload_incomplete', 'the upload stopped before the whole file arrived; nothing was stored');
    throw e;
  }
}
const diskFull = () => new ApiError(507, 'disk_full', 'the disk is full: there is no room left for this file', {}, 'Free some disk space, then try again.');

/** A colour table's asset fields (the parser's verdict; nothing else reads a .cube). Refuses 415 unsupported_media. */
function lutMeta(file: string): MediaMeta {
  let table;
  try {
    table = parseCube(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (!(e instanceof LutError)) throw e;
    // The parser's messages quote at most a few characters of the file; the cut here keeps that true whatever it says.
    throw new ApiError(415, 'unsupported_media', `this .cube file could not be read as a 3D colour table${e.line ? ` (line ${e.line})` : ''}: ${e.message.slice(0, 200)}`, { lut: { code: e.code, line: e.line } }, e.code === 'unsupported' ? 'Only 3D tables (LUT_3D_SIZE) are supported; export the look as a 3D .cube.' : e.code === 'too_large' ? 'Tables up to 65 entries per axis are supported.' : 'Export the table again as an Adobe/Resolve .cube file.');
  }
  return { kind: 'lut', container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: table.size, title: table.title === null ? null : table.title.slice(0, 256) } };
}

/** What phase 2 found: a colour table, a file the editor uses as it is, a still with its lossless PNG copy made, or a video to conform. */
export type Prepared =
  | { route: 'lut'; meta: MediaMeta }
  | { route: 'as-is'; meta: MediaMeta }
  | { route: 'still'; meta: MediaMeta; /** The PNG copy (the caller stores or removes it). */ file: string; contentHash: string; byteSize: number; needs: NeedsConform }
  | { route: 'conform'; needs: NeedsConform };
/** The ffmpeg arguments of the lossless still copy (unchanged from the synchronous ingest). */
export const stillArgs = (src: string, png: string): string[] => ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', src, '-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', png];
/**
 * Phase 2: everything short of a video conversion. A `.cube` goes to the parser (never to ffprobe); anything else to
 * describeMedia; a still in a format the editor does not draw gets its lossless PNG copy at `${workBase}.still.png`. Throws the
 * ApiError of a file that cannot be read (415 unsupported_media). A still copy that failed for a fault of the machine (ConformError
 * machineFault: timeout, killed, no ffmpeg) is unsupported_media too, as the synchronous ingest always answered, unless
 * `machineFaults` is 'throw': then that ConformError is thrown (the import queue keeps the original and lets it be retried).
 * Stores nothing.
 */
export async function prepareWithoutConform(src: string, opts: { isCube: boolean; workBase: string; spawn?: SpawnFfmpeg; signal?: AbortSignal; machineFaults?: 'unsupported' | 'throw' }): Promise<Prepared> {
  if (opts.isCube) return { route: 'lut', meta: lutMeta(src) };
  try {
    return { route: 'as-is', meta: await describeMedia(src) };
  } catch (e) {
    if (!(e instanceof NeedsConform)) throw e;
    if (!e.reasons.includes('still-format')) return { route: 'conform', needs: e };
    // Still picture in a format the editor does not draw directly: keep the original bytes, edit a lossless PNG copy.
    const png = `${opts.workBase}.still.png`;
    try {
      await runFfmpeg(stillArgs(src, png), { spawn: opts.spawn, timeoutMs: 5 * 60_000, signal: opts.signal });
      const meta = await describeMedia(png);
      const cHash = createHash('sha256');
      await pipeline(fs.createReadStream(png), cHash);
      return { route: 'still', meta, file: png, contentHash: `sha256:${cHash.digest('hex')}`, byteSize: fs.statSync(png).size, needs: e };
    } catch (err) {
      fs.rmSync(png, { force: true });
      if (err instanceof ApiError) throw err;
      if (err instanceof ConformError && err.kind === 'canceled') throw err;
      if (err instanceof ConformError && err.kind === 'disk_full') throw diskFull();
      if (err instanceof ConformError && err.machineFault && opts.machineFaults === 'throw') throw err; // the queue keeps the original
      throw new ApiError(415, 'unsupported_media', `this ${e.original.codec} picture could not be converted for editing`, {}, 'Convert it to PNG or JPEG and import that.');
    }
  }
}

/** The conform record of an asset whose edited copy was made from the original (Asset.conform). */
export function conformRecord(needs: NeedsConform, originalHash: string, originalSize: number): NonNullable<Asset['conform']> {
  if (needs.reasons.includes('still-format')) return { originalContentHash: originalHash, originalByteSize: originalSize, reasons: needs.reasons, original: needs.original, frameMapping: 'identity', method: 'ffmpeg, first picture to PNG (lossless)' };
  return { originalContentHash: originalHash, originalByteSize: originalSize, reasons: needs.reasons, original: needs.original, frameMapping: needs.reasons.includes('variable-frame-rate') ? 'cfr-nearest-timestamp' : 'identity', method: `ffmpeg libx264 crf 15, constant rate ${needs.targetRate.num}/${needs.targetRate.den} (fps filter), display rotation applied${needs.reasons.includes('hdr') ? '; high dynamic range tone-mapped to standard range (reference white 203 nits, mobius roll-off of highlights, BT.709)' : ''}` };
}
/** The asset an import commits, in the field order of the synchronous ingest. */
export function buildImportedAsset(p: { meta: MediaMeta; name: string; contentHash: string; byteSize: number; provenance: Asset['provenance']; capture: Capture | null; conform?: Asset['conform'] }): Omit<Asset, 'id'> {
  return { ...p.meta, name: p.name, contentHash: p.contentHash, byteSize: p.byteSize, provenance: p.provenance, ...(p.capture ? { capture: p.capture } : {}), ...(p.conform ? { conform: p.conform } : {}) } as Omit<Asset, 'id'>;
}

/**
 * The conform recipe: the exact ffmpeg arguments (CONFORM_RECIPE 'conform-1'). Keep the original bytes untouched, edit a
 * constant-rate, upright H.264 copy. conformVideo adds only `-progress pipe:1 -nostats` (reporting, not output).
 */
export function conformArgs(src: string, out: string, needs: NeedsConform): string[] {
  return ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', src,
    '-map', '0:v:0', '-map', '0:a:0?',
    // out_color_matrix converts the pixel data to BT.709 (the source's own matrix, or BT.601 when it states none, is the input);
    // without it the copy would merely be labelled BT.709 and untagged / standard-definition sources would shift in colour.
    // Constant rate by the fps filter: each source frame goes to the nearest slot and a gap is filled by HOLDING THE PREVIOUS frame,
    // as players do. (The encoder-side `-fps_mode cfr -r` filled a gap with the frame that follows it, which showed a picture one frame early.)
    // High dynamic range first: to linear light with HDR reference white (203 nits, BT.2408) as standard-range white, into BT.709 primaries,
    // highlights above that rolled off (mobius), then the BT.709 transfer. Everything at or below reference white keeps its level.
    '-vf', `${needs.reasons.includes('hdr') ? HDR_TO_SDR + ',' : ''}fps=${needs.targetRate.num}/${needs.targetRate.den},scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-bf', '2',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out];
}
/** conformArgs with ffmpeg's machine-readable progress on stdout (inserted with the global options, before the input). */
export const conformArgsWithProgress = (src: string, out: string, needs: NeedsConform): string[] => {
  const a = conformArgs(src, out, needs);
  return [...a.slice(0, 5), '-progress', 'pipe:1', '-nostats', ...a.slice(5)];
};

/** Starts ffmpeg with these arguments. */
export type SpawnFfmpeg = (args: string[]) => ChildProcess;
const defaultSpawn: SpawnFfmpeg = (args) => spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
/**
 * Why an ffmpeg run did not give a usable result. 'failed' (ffmpeg ran and reported an error) and 'not_editable' are faults
 * of the file. 'timeout', 'killed' (ended by a signal, e.g. the out-of-memory killer, or out of memory) and 'no_ffmpeg' (not
 * installed) are faults of the machine or its setup: the same file may convert later (machineFault).
 */
export class ConformError extends Error {
  constructor(public kind: 'canceled' | 'timeout' | 'disk_full' | 'failed' | 'not_editable' | 'killed' | 'no_ffmpeg', message: string) { super(message); }
  get machineFault(): boolean { return this.kind === 'timeout' || this.kind === 'killed' || this.kind === 'no_ffmpeg'; }
}
/**
 * One ffmpeg run, spawned (killable) at lower priority. Kills it (SIGKILL) on `signal` or after `timeoutMs`. ENOSPC (the
 * process's own error or ffmpeg's "No space left on device") is ConformError 'disk_full'. `onLine` receives stdout lines.
 */
export async function runFfmpeg(args: string[], opts: { spawn?: SpawnFfmpeg; timeoutMs: number; signal?: AbortSignal; onLine?: (line: string) => void }): Promise<void> {
  if (opts.signal?.aborted) throw new ConformError('canceled', 'canceled before ffmpeg started');
  const child = (opts.spawn ?? defaultSpawn)(args);
  // Below the editor and the server's own work; os.setPriority works on Linux, macOS and Windows, and may be refused (then nothing changes).
  try { if (child.pid) os.setPriority(child.pid, 10); } catch { /* not allowed here: normal priority */ }
  let stderr = '';
  let timedOut = false, aborted = false;
  child.stderr?.on('data', (d: Buffer) => { if (stderr.length < 65536) stderr += d.toString(); });
  let rest = '';
  child.stdout?.on('data', (d: Buffer) => {
    rest += d.toString();
    const lines = rest.split('\n');
    rest = lines.pop() ?? '';
    if (opts.onLine) for (const l of lines) { try { opts.onLine(l.trim()); } catch { /* a progress reader never stops the run */ } }
  });
  const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
  const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs);
  const onAbort = () => { aborted = true; kill(); };
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, sig) => (code === 0 && !aborted && !timedOut ? resolve() : reject(Object.assign(new Error(sig ? `ffmpeg was ended by ${sig}` : `ffmpeg exited with ${code}`), { exitCode: code, exitSignal: sig }))));
    });
  } catch (e: any) {
    if (aborted) throw new ConformError('canceled', 'ffmpeg was stopped');
    if (timedOut) throw new ConformError('timeout', `ffmpeg did not finish within ${Math.round(opts.timeoutMs / 60_000)} minutes`);
    if (e?.code === 'ENOSPC' || /No space left on device|ENOSPC/i.test(stderr)) throw new ConformError('disk_full', 'the disk filled up while converting');
    if (e?.code === 'ENOENT') throw new ConformError('no_ffmpeg', 'ffmpeg is not installed on this machine');
    // Ended from outside (the out-of-memory killer sends SIGKILL) or out of memory: the machine's fault, not the file's.
    if (e?.exitSignal || ('exitCode' in (e ?? {}) && e.exitCode === null)) throw new ConformError('killed', `ffmpeg was stopped by the system (${e.exitSignal ?? 'no exit code'}), for example for lack of memory`);
    if (/Cannot allocate memory|ENOMEM|out of memory/i.test(stderr)) throw new ConformError('killed', 'ffmpeg ran out of memory');
    throw new ConformError('failed', stderr.trim().split('\n').pop()?.slice(0, 300) || String(e?.message ?? e));
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}
/** A conversion may take this long: 30 minutes, or 60 times the clip's own length when that is longer (a long 4K clip). */
export const conformTimeoutMs = (durationSeconds: number): number => Math.max(30 * 60_000, 60 * 1000 * (Number.isFinite(durationSeconds) ? durationSeconds : 0));
/**
 * Phase 3: the video conversion to `out`, spawned and killable, with progress as an integer percent 0–99 (never 100: the caller
 * finishes the job). Returns the conformed file's description and hash (the caller stores it). Throws ConformError:
 * 'not_editable' when the conformed result is still not editable, 'disk_full', 'timeout', 'canceled', 'failed'.
 */
export async function conformVideo(src: string, needs: NeedsConform, out: string, opts: { spawn?: SpawnFfmpeg; signal?: AbortSignal; onProgress?: (percent: number) => void } = {}): Promise<{ meta: MediaMeta; contentHash: string; byteSize: number }> {
  const seconds = needs.original.durationSeconds;
  await runFfmpeg(conformArgsWithProgress(src, out, needs), {
    spawn: opts.spawn, signal: opts.signal, timeoutMs: conformTimeoutMs(seconds),
    onLine: (line) => {
      const m = /^out_time_us=(\d+)$/.exec(line);
      if (m && opts.onProgress && seconds > 0) opts.onProgress(Math.min(99, Math.max(0, Math.floor((100 * Number(m[1])) / (seconds * 1e6)))));
    },
  });
  let meta: MediaMeta;
  try {
    meta = await describeMedia(out);
  } catch (err) {
    if (err instanceof ApiError || err instanceof NeedsConform) throw new ConformError('not_editable', 'the file needed conforming and the conformed result is still not editable');
    throw err;
  }
  const cHash = createHash('sha256');
  await pipeline(fs.createReadStream(out), cHash);
  return { meta, contentHash: `sha256:${cHash.digest('hex')}`, byteSize: fs.statSync(out).size };
}

/**
 * The synchronous ingest, made of the phases above: receive, prepare, conform, and only then store (the blobs are put after the
 * file was read successfully: lut.test.ts). Used for colour tables by the upload route, for provider results and in tests; the
 * upload route's media files go through the import queue (ADR-0023).
 * `captureContext` (life line, ADR-0021): the home zone and the time of this import, for reading the file's capture date; the
 * upload route passes the server's configured zone.
 */
export async function ingestUpload(store: Store, body: ReadableStream<Uint8Array>, name: string, actor: string, maxBytes: number, captureContext: CaptureContext = { homeZone: DEFAULT_HOME_ZONE, now: new Date() }): Promise<Omit<Asset, 'id'>> {
  // A file named .cube is a colour table (3D LUT): text, read whole and parsed strictly, so it gets the parser's own size limit
  // while streaming. The name only chooses the reader; acceptance comes from the content. The extension is read from the whole
  // name, before it is cut to what the document allows, and survives the cut: a long name must not send a table to the media reader.
  const baseName = path.basename(name);
  const isCube = /\.cube$/i.test(baseName);
  const assetName = (isCube && baseName.length > 256 ? baseName.slice(0, 251) + baseName.slice(-5) : baseName.slice(0, 256)) || 'untitled';
  const { tmp, hash: originalHash, size } = await receiveOriginal(store, Readable.fromWeb(body as any), { maxBytes, isCube });
  try {
    const provenance = { origin: 'upload' as const, importedAt: new Date().toISOString(), importedBy: actor };
    if (isCube) {
      // Never handed to ffprobe: a .cube that does not parse is refused here, and the blob is stored only after it parsed.
      const meta = lutMeta(tmp);
      store.putBlob(originalHash, tmp, size, 'text/plain');
      return buildImportedAsset({ meta, name: assetName, contentHash: originalHash, byteSize: size, provenance, capture: null });
    }
    // life line (ADR-0021): the capture date is read from the ORIGINAL bytes, before any conform (the conformed copy does not carry
    // it). Reading never fails an import: no date is simply no date.
    const capture = await readCapture(tmp, baseName, captureContext);
    const prepared = await prepareWithoutConform(tmp, { isCube, workBase: tmp });
    if (prepared.route === 'still') {
      store.putBlob(originalHash, tmp, size, 'application/octet-stream');
      store.putBlob(prepared.contentHash, prepared.file, prepared.byteSize, prepared.meta.mimeType);
      return buildImportedAsset({ meta: prepared.meta, name: assetName, contentHash: prepared.contentHash, byteSize: prepared.byteSize, provenance, capture, conform: conformRecord(prepared.needs, originalHash, size) });
    }
    if (prepared.route === 'conform') {
      const e = prepared.needs;
      const out = `${tmp}.conform.mp4`;
      try {
        const c = await conformVideo(tmp, e, out);
        store.putBlob(originalHash, tmp, size, 'application/octet-stream');
        store.putBlob(c.contentHash, out, c.byteSize, c.meta.mimeType);
        return buildImportedAsset({ meta: c.meta, name: assetName, contentHash: c.contentHash, byteSize: c.byteSize, provenance, capture, conform: conformRecord(e, originalHash, size) });
      } catch (err) {
        if (err instanceof ApiError || err instanceof NeedsConform || (err instanceof ConformError && err.kind === 'not_editable')) throw new ApiError(415, 'unsupported_media', 'the file needed conforming and the conformed result is still not editable', { reasons: e.reasons });
        throw new ApiError(415, 'unsupported_media', `the file needs conforming (${e.reasons.join(', ')}) and ffmpeg could not convert it`, { reasons: e.reasons });
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
    store.putBlob(originalHash, tmp, size, prepared.meta.mimeType);
    return buildImportedAsset({ meta: prepared.meta, name: assetName, contentHash: originalHash, byteSize: size, provenance, capture });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
