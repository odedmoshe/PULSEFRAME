/** Trusted ingest: stream to disk while hashing, probe the real container/codecs with ffprobe, store content-addressed. */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import * as T from '@pulseframe/time';
import { LUT_MAX_TEXT_LENGTH, LutError, parseCube, startOffsetFrames, type Asset } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';

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

export async function ingestUpload(store: Store, body: ReadableStream<Uint8Array>, name: string, actor: string, maxBytes: number): Promise<Omit<Asset, 'id'>> {
  const tmp = path.join(store.tmpDir, `up_${randomBytes(8).toString('hex')}`);
  const hash = createHash('sha256');
  let size = 0;
  const assetName = path.basename(name).slice(0, 256) || 'untitled';
  // A file named .cube is a colour table (3D LUT): text, read whole and parsed strictly, so it gets the parser's own size limit
  // while streaming. The name only chooses the reader; acceptance comes from the content.
  const isCube = /\.cube$/i.test(assetName);
  const meter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      if (isCube && size > LUT_MAX_TEXT_LENGTH) return cb(new ApiError(413, 'upload_too_large', `a colour table (.cube) file can be at most ${LUT_MAX_TEXT_LENGTH} bytes`, { maxBytes: LUT_MAX_TEXT_LENGTH }));
      if (size > maxBytes) return cb(new ApiError(413, 'upload_too_large', `upload exceeds ${maxBytes} bytes`));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as any), meter, fs.createWriteStream(tmp, { mode: 0o600 }));
    if (size === 0) throw new ApiError(400, 'empty_upload', 'upload body is empty');
    const originalHash = `sha256:${hash.digest('hex')}`;
    const provenance = { origin: 'upload' as const, importedAt: new Date().toISOString(), importedBy: actor };
    if (isCube) {
      // Never handed to ffprobe: a .cube that does not parse is refused here, and the blob is stored only after it parsed.
      let table;
      try {
        table = parseCube(fs.readFileSync(tmp, 'utf8'));
      } catch (e) {
        if (!(e instanceof LutError)) throw e;
        throw new ApiError(415, 'unsupported_media', `this .cube file could not be read as a 3D colour table${e.line ? ` (line ${e.line})` : ''}: ${e.message}`, { lut: { code: e.code, line: e.line } }, e.code === 'unsupported' ? 'Only 3D tables (LUT_3D_SIZE) are supported; export the look as a 3D .cube.' : e.code === 'too_large' ? 'Tables up to 65 entries per axis are supported.' : 'Export the table again as an Adobe/Resolve .cube file.');
      }
      store.putBlob(originalHash, tmp, size, 'text/plain');
      return { kind: 'lut', container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: table.size, title: table.title === null ? null : table.title.slice(0, 256) }, name: assetName, contentHash: originalHash, byteSize: size, provenance };
    }
    let meta: MediaMeta;
    try {
      meta = await describeMedia(tmp);
    } catch (e) {
      if (!(e instanceof NeedsConform)) throw e;
      if (e.reasons.includes('still-format')) {
        // Still picture in a format the editor does not draw directly: keep the original bytes, edit a lossless PNG copy.
        const png = `${tmp}.still.png`;
        try {
          await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', tmp, '-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', png], { timeout: 5 * 60_000, maxBuffer: 8 << 20 });
          const converted = await describeMedia(png);
          const cHash = createHash('sha256');
          await pipeline(fs.createReadStream(png), cHash);
          const contentHash = `sha256:${cHash.digest('hex')}`;
          const cSize = fs.statSync(png).size;
          store.putBlob(originalHash, tmp, size, 'application/octet-stream');
          store.putBlob(contentHash, png, cSize, converted.mimeType);
          return { ...converted, name: assetName, contentHash, byteSize: cSize, provenance, conform: { originalContentHash: originalHash, originalByteSize: size, reasons: e.reasons, original: e.original, frameMapping: 'identity', method: 'ffmpeg, first picture to PNG (lossless)' } };
        } catch (err) {
          fs.rmSync(png, { force: true });
          if (err instanceof ApiError) throw err;
          throw new ApiError(415, 'unsupported_media', `this ${e.original.codec} picture could not be converted for editing`, {}, 'Convert it to PNG or JPEG and import that.');
        }
      }
      // Conform route: keep the original bytes untouched, edit a constant-rate, upright H.264 copy, record the mapping.
      const out = `${tmp}.conform.mp4`;
      try {
        await exec('ffmpeg', ['-hide_banner', '-v', 'error', '-nostdin', '-y', '-protocol_whitelist', 'file', '-i', tmp,
          '-map', '0:v:0', '-map', '0:a:0?',
          // out_color_matrix converts the pixel data to BT.709 (the source's own matrix, or BT.601 when it states none, is the input);
          // without it the copy would merely be labelled BT.709 and untagged / standard-definition sources would shift in colour.
          // Constant rate by the fps filter: each source frame goes to the nearest slot and a gap is filled by HOLDING THE PREVIOUS frame,
          // as players do. (The encoder-side `-fps_mode cfr -r` filled a gap with the frame that follows it, which showed a picture one frame early.)
          // High dynamic range first: to linear light with HDR reference white (203 nits, BT.2408) as standard-range white, into BT.709 primaries,
          // highlights above that rolled off (mobius), then the BT.709 transfer. Everything at or below reference white keeps its level.
          '-vf', `${e.reasons.includes('hdr') ? HDR_TO_SDR + ',' : ''}fps=${e.targetRate.num}/${e.targetRate.den},scale=trunc(iw*sar/2)*2:trunc(ih/2)*2:out_color_matrix=bt709:out_range=tv,setsar=1,format=yuv420p`, '-c:v', 'libx264', '-preset', 'medium', '-crf', '15', '-bf', '2',
          '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { timeout: 30 * 60_000, maxBuffer: 8 << 20 });
        const conformed = await describeMedia(out);
        const cHash = createHash('sha256');
        await pipeline(fs.createReadStream(out), cHash);
        const contentHash = `sha256:${cHash.digest('hex')}`;
        const cSize = fs.statSync(out).size;
        store.putBlob(originalHash, tmp, size, 'application/octet-stream');
        store.putBlob(contentHash, out, cSize, conformed.mimeType);
        return {
          ...conformed, name: assetName, contentHash, byteSize: cSize, provenance,
          conform: { originalContentHash: originalHash, originalByteSize: size, reasons: e.reasons, original: e.original, frameMapping: e.reasons.includes('variable-frame-rate') ? 'cfr-nearest-timestamp' : 'identity', method: `ffmpeg libx264 crf 15, constant rate ${e.targetRate.num}/${e.targetRate.den} (fps filter), display rotation applied${e.reasons.includes('hdr') ? '; high dynamic range tone-mapped to standard range (reference white 203 nits, mobius roll-off of highlights, BT.709)' : ''}` },
        };
      } catch (err) {
        if (err instanceof ApiError || err instanceof NeedsConform) throw new ApiError(415, 'unsupported_media', 'the file needed conforming and the conformed result is still not editable', { reasons: e.reasons });
        throw new ApiError(415, 'unsupported_media', `the file needs conforming (${e.reasons.join(', ')}) and ffmpeg could not convert it`, { reasons: e.reasons });
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
    store.putBlob(originalHash, tmp, size, meta.mimeType);
    return { ...meta, name: assetName, contentHash: originalHash, byteSize: size, provenance };
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
