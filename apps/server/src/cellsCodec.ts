/**
 * Lossless storage of a segment's per-frame flash cells (ADR-0024 / ADR-0009): the photosensitivity check of a segmented export
 * must see every frame of the final film, so each stored segment carries the 24 × 24 cells of each of its frames, keyed with it.
 * Float32 little-endian, each frame's bits XOR the previous frame's, then node:zlib deflate. Raw is 6,912 bytes a frame.
 * LEAD STUBS, final signatures. W2 owns the bodies.
 */
import type { FlashCells } from '@pulseframe/engine';

/** Self-describing: cols, rows and the frame count are in the blob, so decode needs nothing else. */
export function encodeCells(cells: readonly FlashCells[]): Uint8Array {
  void cells;
  throw new Error('encodeCells: not built yet (segment cache W2)');
}
/** Exact inverse of encodeCells (every Float32 bit pattern back, NaN payloads and -0 included). Throws on a damaged blob. */
export function decodeCells(blob: Uint8Array): FlashCells[] {
  void blob;
  throw new Error('decodeCells: not built yet (segment cache W2)');
}
