/**
 * Lossless storage of a segment's per-frame flash cells (ADR-0024 / ADR-0009): the photosensitivity check of a segmented export
 * must see every frame of the final film, so each stored segment carries the 24 × 24 cells of each of its frames, keyed with it.
 * Float32 little-endian, each frame's bits XOR the previous frame's, then node:zlib deflate. Raw is 6,912 bytes a frame.
 *
 * Blob layout (self-describing): 'PFC1' · u32le frames · u32le cols · u32le rows · zlib deflate of frames × cols × rows × 3
 * u32le words, word i of frame f = bits(f, i) XOR bits(f − 1, i) (frame −1 is all zero bits). The zlib stream's Adler-32
 * makes a damaged blob throw on decode instead of yielding other numbers.
 */
import zlib from 'node:zlib';
import type { FlashCells } from '@pulseframe/engine';

const MAGIC = 'PFC1';
const HEADER = 16;

/** Self-describing: cols, rows and the frame count are in the blob, so decode needs nothing else. */
export function encodeCells(cells: readonly FlashCells[]): Uint8Array {
  const frames = cells.length;
  const cols = frames ? cells[0]!.cols : 0;
  const rows = frames ? cells[0]!.rows : 0;
  const words = cols * rows * 3;
  const body = Buffer.alloc(frames * words * 4);
  let prev = new Uint32Array(words);
  for (let f = 0; f < frames; f++) {
    const c = cells[f]!;
    if (c.cols !== cols || c.rows !== rows || c.rgb.length !== words) throw new Error(`encodeCells: frame ${f} has a ${c.cols}×${c.rows} grid of ${c.rgb.length} values, the first has ${cols}×${rows}`);
    // A byte copy (never through JS numbers, which may canonicalise NaN payloads), so the bits are read the same way whatever the
    // Float32Array's offset; Uint32Array over it is the host's order and the words are written little-endian explicitly.
    const bits = new Uint32Array(c.rgb.buffer.slice(c.rgb.byteOffset, c.rgb.byteOffset + c.rgb.byteLength) as ArrayBuffer);
    const o = f * words * 4;
    for (let i = 0; i < words; i++) body.writeUInt32LE((bits[i]! ^ prev[i]!) >>> 0, o + i * 4);
    prev = bits;
  }
  const head = Buffer.alloc(HEADER);
  head.write(MAGIC, 0, 'latin1');
  head.writeUInt32LE(frames, 4);
  head.writeUInt32LE(cols, 8);
  head.writeUInt32LE(rows, 12);
  return new Uint8Array(Buffer.concat([head, zlib.deflateSync(body, { level: 6 })]));
}

/** Exact inverse of encodeCells (every Float32 bit pattern back, NaN payloads and -0 included). Throws on a damaged blob. */
export function decodeCells(blob: Uint8Array): FlashCells[] {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  if (b.length < HEADER || b.toString('latin1', 0, 4) !== MAGIC) throw new Error('decodeCells: not a cells blob');
  const frames = b.readUInt32LE(4), cols = b.readUInt32LE(8), rows = b.readUInt32LE(12);
  const words = cols * rows * 3;
  let body: Buffer;
  try { body = zlib.inflateSync(b.subarray(HEADER)); } catch (e) { throw new Error(`decodeCells: damaged blob (${(e as Error).message})`); }
  if (body.length !== frames * words * 4) throw new Error(`decodeCells: damaged blob (${body.length} bytes for ${frames} frames of ${words} values)`);
  const out: FlashCells[] = [];
  let prev = new Uint32Array(words);
  for (let f = 0; f < frames; f++) {
    const bits = new Uint32Array(words);
    const o = f * words * 4;
    for (let i = 0; i < words; i++) bits[i] = (body.readUInt32LE(o + i * 4) ^ prev[i]!) >>> 0;
    out.push({ cols, rows, rgb: new Float32Array(bits.buffer) });
    prev = bits;
  }
  return out;
}
