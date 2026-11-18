/**
 * The segment grid of a segmented export (ADR-0024, plan §3 with the verifier's merge rule) and the segment key.
 * LEAD STUBS, final signatures. W1 (engine) owns the bodies.
 */
import type * as T from '@pulseframe/time';
import { MIN_SEGMENT_FRAMES, SEGMENT_SECONDS, type EngineFingerprint } from '@pulseframe/core';
import { canonicalJson, type Digest } from './frameKey.ts';

/** Prefix of the hashed text of a segment key. */
export const SEGMENT_KEY_PREFIX = 'pf-seg/1\n';

/**
 * `index` = grid cell number counted from programme frame 0 (for a merged segment: the cell holding its first frame);
 * `first` = first frame relative to the exported range; `frames` = its length: 3 … segFrames + 2, or segFrames + 4 when one whole
 * cell takes a short head and a short tail; only a lone segment (a range of 1 or 2 frames) may be shorter than 3.
 */
export interface Segment { index: number; first: number; frames: number }

/**
 * max(core MIN_SEGMENT_FRAMES, round(seconds * num / den)); `seconds` defaults to core SEGMENT_SECONDS (60 at 30000/1001, 48 at
 * 24000/1001, 50 at 25; 3 at 1/1 and 1/2, where 2 seconds is 2 or 1 frames). The floor keeps every interior cell joinable: the
 * merge rule below joins only head and tail parts, so a cell of 1–2 frames at a low rate would lose a frame at the join.
 */
export function segmentFrames(rate: T.Rate, seconds: number = SEGMENT_SECONDS): number {
  if (!(Number.isSafeInteger(rate.num) && rate.num > 0 && Number.isSafeInteger(rate.den) && rate.den > 0)) throw new RangeError(`segmentFrames: invalid rate ${rate.num}/${rate.den}`);
  if (!(Number.isFinite(seconds) && seconds > 0)) throw new RangeError(`segmentFrames: invalid length ${seconds} s`);
  return Math.max(MIN_SEGMENT_FRAMES, Math.round((seconds * rate.num) / rate.den));
}

/**
 * The intersections of [firstFrame, firstFrame + frames) with grid cells of `segFrames` anchored at programme frame 0, in order,
 * then any head or tail part shorter than core MIN_SEGMENT_FRAMES merged into its neighbour. A range of 1 or 2 frames in all is
 * one segment. Interior cells of a range equal the full grid's cells, so range exports share whole cells with full exports.
 */
export function segmentGrid(firstFrame: number, frames: number, segFrames: number): Segment[] {
  if (!Number.isSafeInteger(firstFrame) || firstFrame < 0) throw new RangeError(`segmentGrid: first frame ${firstFrame} is not a programme frame`);
  if (!Number.isSafeInteger(frames) || frames < 0) throw new RangeError(`segmentGrid: invalid frame count ${frames}`);
  // a cell shorter than MIN_SEGMENT_FRAMES could not be joined (only head and tail parts are merged), so it is refused, not drawn
  if (!Number.isSafeInteger(segFrames) || segFrames < MIN_SEGMENT_FRAMES) throw new RangeError(`segmentGrid: segFrames ${segFrames} is below ${MIN_SEGMENT_FRAMES}`);
  const end = firstFrame + frames;
  const out: Segment[] = [];
  for (let cell = Math.floor(firstFrame / segFrames); cell * segFrames < end; cell++) {
    const a = Math.max(firstFrame, cell * segFrames), b = Math.min(end, (cell + 1) * segFrames);
    out.push({ index: cell, first: a - firstFrame, frames: b - a });
  }
  // a 1-2 frame head joins the next part (keeping the index of the cell of its first frame), a 1-2 frame tail the one before
  if (out.length > 1 && out[0]!.frames < MIN_SEGMENT_FRAMES) { const head = out.shift()!; out[0] = { index: head.index, first: head.first, frames: head.frames + out[0]!.frames }; }
  if (out.length > 1 && out[out.length - 1]!.frames < MIN_SEGMENT_FRAMES) { const tail = out.pop()!; out[out.length - 1]!.frames += tail.frames; }
  return out;
}

export interface SegmentKeyParams {
  engine: EngineFingerprint;
  /** sha256(`ffmpeg -version` stdout + JSON of the segment encode arguments, thread count included). */
  encoder: string;
  output: { width: number; height: number; frameRate: { num: number; den: number } };
}
/** digest(SEGMENT_KEY_PREFIX + canonicalJson({ ...params, frames: frameKeys })). */
export function segmentKey(frameKeys: readonly string[], params: SegmentKeyParams, digest: Digest): string {
  if (!frameKeys.length) throw new RangeError('segmentKey: a segment has at least one frame');
  // the whole of params, as the contract says: an extra field a caller adds can only make the key more specific, never stale
  return digest(SEGMENT_KEY_PREFIX + canonicalJson({ ...params, frames: frameKeys }));
}
