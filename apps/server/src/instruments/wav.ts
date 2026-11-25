/**
 * WAV reader of recorded instruments (wave 7 instruments track). Pure over bytes; throws only InstrumentError (fuzz check I19).
 * BUILDER W2. The bytes are UNTRUSTED (a file of the owner's library folder): every size, offset and count is checked against the
 * bytes actually held and against the file's size before it is used; nothing is allocated from a number read in the file except
 * after that check and under INSTRUMENTS_LIMITS.
 * Accepts RIFF/WAVE with fmt PCM 16/24/32-bit integer, IEEE float 32, or WAVE_FORMAT_EXTENSIBLE of those; 1 or 2 channels; a `smpl`
 * chunk's first loop. Decodes to Int32Array at a 24-bit scale (16-bit · 256; 24-bit as is; 32-bit integer >> 8; float:
 * Math.round(f · 2^23), clamped). Anything else (FLAC, Ogg, AIFF, RF64, 8-bit, more channels, a truncated chunk) is
 * InstrumentError('format' | 'unreadable').
 */
import { INSTRUMENTS_LIMITS } from '@pulseframe/core';
import { InstrumentError } from './contract.ts';

/**
 * `loop`: the first loop of a `smpl` chunk, `start` and `end` as frame indexes with `end` the LAST frame of the loop (inclusive, as
 * the smpl chunk and SFZ loop_end write it); null when there is none or it does not lie inside the data.
 */
export interface WavInfo { rate: number; channels: 1 | 2; bits: 16 | 24 | 32; float: boolean; dataOffset: number; frames: number; loop: { start: number; end: number } | null }
/** Where the data chunk ends in the file (the caller reads a `smpl` chunk after it with readWavLoop). */
export const wavDataEnd = (info: WavInfo): number => info.dataOffset + info.frames * info.channels * (info.bits / 8);

/** How many bytes of a file's start readWavInfo needs at most to find fmt and the data chunk's header of an ordinary file. */
export const WAV_HEAD_BYTES = 64 * 1024;
/** Chunks walked at most (a file of thousands of empty chunks is refused, never walked for ever). */
const MAX_CHUNKS = 512;
const RATE_MIN = 8000, RATE_MAX = 192_000;
/** The KSDATAFORMAT_SUBTYPE GUID tail shared by PCM (1) and IEEE float (3). */
const GUID_TAIL = [0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];

const fourcc = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const u16 = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + b[o + 3]! * 0x1000000;

/** Names a container that is not WAV by its first bytes (for the refusal's words). */
function otherFormat(b: Uint8Array): string | null {
  if (b.length < 4) return null;
  const m = fourcc(b, 0);
  if (m === 'fLaC') return 'FLAC';
  if (m === 'OggS') return 'Ogg';
  if (m === 'FORM') return 'AIFF';
  if (m === 'RF64' || m === 'BW64') return 'RF64';
  if (m === 'RIFX') return 'big-endian RIFF';
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'MP3';
  return null;
}

/**
 * The format, the data chunk's place and the loop, from the first bytes of the file. `fileSize` is the file's size on disk (default:
 * the bytes given, i.e. the whole file); a chunk is never trusted to be longer than the file. A `smpl` chunk after the data chunk is
 * found only when `head` holds it (otherwise read it with readWavLoop from wavDataEnd).
 */
export function readWavInfo(head: Uint8Array, fileSize: number = head.length): WavInfo {
  if (!(head instanceof Uint8Array)) throw new InstrumentError('unreadable', 'no bytes');
  if (!Number.isSafeInteger(fileSize) || fileSize < head.length) throw new InstrumentError('unreadable', 'the file size is not consistent with the bytes read');
  const other = otherFormat(head);
  if (other) throw new InstrumentError('format', other);
  if (head.length < 12) throw new InstrumentError('unreadable', 'the file is shorter than a WAV header');
  if (fourcc(head, 0) !== 'RIFF' || fourcc(head, 8) !== 'WAVE') throw new InstrumentError('format', 'not a RIFF/WAVE file');
  const riffEnd = u32(head, 4) + 8;
  if (riffEnd < 12) throw new InstrumentError('unreadable', 'the RIFF size is too small');
  if (riffEnd > fileSize) throw new InstrumentError('unreadable', 'the RIFF size says the file is longer than it is (truncated)');
  const limit = riffEnd; // nothing after the RIFF chunk is read
  let fmt: { tag: number; channels: number; rate: number; bits: number; align: number; float: boolean } | null = null;
  let data: { offset: number; size: number } | null = null;
  let loop: { start: number; end: number } | null = null;
  let off = 12, chunks = 0;
  while (off + 8 <= limit && off + 8 <= head.length) {
    if (++chunks > MAX_CHUNKS) throw new InstrumentError('unreadable', `more than ${MAX_CHUNKS} chunks`);
    const id = fourcc(head, off), size = u32(head, off + 4), body = off + 8;
    if (size > limit - body) throw new InstrumentError('unreadable', `the ${JSON.stringify(id).slice(1, -1).replace(/[^\x20-\x7e]/g, '?')} chunk is longer than the file`);
    const inHead = body + size <= head.length;
    if (id === 'fmt ') {
      if (fmt) throw new InstrumentError('unreadable', 'two fmt chunks');
      if (!inHead) throw new InstrumentError('unreadable', 'the fmt chunk is not in the bytes read');
      fmt = readFmt(head, body, size);
    } else if (id === 'data') {
      if (data) throw new InstrumentError('unreadable', 'two data chunks');
      data = { offset: body, size };
    } else if (id === 'smpl' && inHead && !loop) {
      loop = readSmpl(head, body, size);
    }
    off = body + size + (size & 1);
  }
  if (!fmt) throw new InstrumentError('unreadable', 'no fmt chunk before the end of the bytes read');
  if (!data) throw new InstrumentError('unreadable', 'no data chunk before the end of the bytes read');
  if (data.size % fmt.align !== 0) throw new InstrumentError('unreadable', 'the data chunk does not hold whole frames');
  const frames = data.size / fmt.align;
  if (frames < 1) throw new InstrumentError('unreadable', 'the data chunk is empty');
  if (loop && !(loop.start <= loop.end && loop.end < frames)) loop = null;
  return { rate: fmt.rate, channels: fmt.channels as 1 | 2, bits: fmt.bits as 16 | 24 | 32, float: fmt.float, dataOffset: data.offset, frames, loop };
}

function readFmt(b: Uint8Array, o: number, size: number) {
  if (size < 16) throw new InstrumentError('unreadable', 'the fmt chunk is too short');
  let tag = u16(b, o);
  const channels = u16(b, o + 2), rate = u32(b, o + 4), byteRate = u32(b, o + 8), align = u16(b, o + 12), bits = u16(b, o + 14);
  if (tag === 0xfffe) {
    if (size < 40) throw new InstrumentError('unreadable', 'the extensible fmt chunk is too short');
    const valid = u16(b, o + 18);
    tag = u16(b, o + 24);
    for (let i = 0; i < GUID_TAIL.length; i++) if (b[o + 26 + i] !== GUID_TAIL[i]) throw new InstrumentError('format', 'an extensible sub-format that is not PCM or float');
    if (valid !== 0 && valid !== bits) throw new InstrumentError('format', `${valid} valid bits in ${bits}-bit samples`);
  }
  if (tag !== 1 && tag !== 3) throw new InstrumentError('format', `WAV format tag ${tag} (compressed)`);
  if (channels !== 1 && channels !== 2) throw new InstrumentError('format', `${channels} channels`);
  if (rate < RATE_MIN || rate > RATE_MAX) throw new InstrumentError('format', `sample rate ${rate} Hz`);
  const float = tag === 3;
  if (float ? bits !== 32 : bits !== 16 && bits !== 24 && bits !== 32) throw new InstrumentError('format', `${bits}-bit ${float ? 'float' : 'integer'} samples`);
  if (align !== channels * (bits / 8)) throw new InstrumentError('unreadable', 'the block size does not match the channels and bits');
  if (byteRate !== rate * align) throw new InstrumentError('unreadable', 'the byte rate does not match the sample rate and block size');
  return { tag, channels, rate, bits, align, float };
}

function readSmpl(b: Uint8Array, o: number, size: number): { start: number; end: number } | null {
  if (size < 36) return null;
  const loops = u32(b, o + 28);
  if (loops < 1 || size < 36 + 24) return null;
  const start = u32(b, o + 36 + 8), end = u32(b, o + 36 + 12);
  return start <= end ? { start, end } : null;
}

/**
 * A `smpl` chunk's first loop from bytes that start at a chunk boundary after the data chunk (`tail` = the file from wavDataEnd,
 * after its pad byte; at most a few kilobytes are needed). Checked against `info.frames`; null when there is none.
 */
export function readWavLoop(tail: Uint8Array, info: Pick<WavInfo, 'frames'>): { start: number; end: number } | null {
  let off = 0, chunks = 0;
  while (off + 8 <= tail.length) {
    if (++chunks > MAX_CHUNKS) throw new InstrumentError('unreadable', `more than ${MAX_CHUNKS} chunks`);
    const id = fourcc(tail, off), size = u32(tail, off + 4), body = off + 8;
    if (size > tail.length - body) return null; // not in the bytes held: no loop is read from it
    if (id === 'smpl') { const l = readSmpl(tail, body, size); return l && l.end < info.frames ? l : null; }
    off = body + size + (size & 1);
  }
  return null;
}

/** `frames` frames from `fromFrame` of the data chunk (bytes = exactly those frames), interleaved, at a 24-bit integer scale. */
export function decodePcm(bytes: Uint8Array, info: WavInfo, fromFrame: number, frames: number): Int32Array {
  if (!(bytes instanceof Uint8Array)) throw new InstrumentError('unreadable', 'no bytes');
  const ch = info.channels, bps = info.bits / 8, align = ch * bps;
  if (!Number.isSafeInteger(fromFrame) || !Number.isSafeInteger(frames) || fromFrame < 0 || frames < 0 || fromFrame + frames > info.frames) throw new InstrumentError('unreadable', 'frames outside the data chunk');
  if (frames * ch * 4 > INSTRUMENTS_LIMITS.maxDecodedBytes) throw new InstrumentError('too_large', `more than ${INSTRUMENTS_LIMITS.maxDecodedBytes} bytes of decoded samples`);
  if (bytes.length !== frames * align) throw new InstrumentError('unreadable', 'the bytes do not hold exactly the frames asked for (truncated)');
  const n = frames * ch, out = new Int32Array(n);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (info.float) {
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const f = dv.getFloat32(o, true);
      if (f !== f) throw new InstrumentError('unreadable', 'a float sample is not a number');
      const v = Math.round(f * 8388608);
      out[i] = v > 8388607 ? 8388607 : v < -8388608 ? -8388608 : v;
    }
  } else if (info.bits === 16) {
    for (let i = 0, o = 0; i < n; i++, o += 2) out[i] = dv.getInt16(o, true) * 256;
  } else if (info.bits === 24) {
    for (let i = 0, o = 0; i < n; i++, o += 3) out[i] = ((bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16)) << 8) >> 8;
  } else {
    for (let i = 0, o = 0; i < n; i++, o += 4) out[i] = dv.getInt32(o, true) >> 8;
  }
  return out;
}
