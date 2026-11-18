/**
 * The segment grid of a segmented export (ADR-0024, plan §3 with the verifier's merge rule) and the segment key.
 * LEAD STUBS, final signatures. W1 (engine) owns the bodies.
 */
import type * as T from '@pulseframe/time';
import type { EngineFingerprint } from '@pulseframe/core';
import type { Digest } from './frameKey.ts';

/** Prefix of the hashed text of a segment key. */
export const SEGMENT_KEY_PREFIX = 'pf-seg/1\n';

/**
 * `index` = grid cell number counted from programme frame 0 (for a merged segment: the cell holding its first frame);
 * `first` = first frame relative to the exported range; `frames` = its length (3 … segFrames + 2, unless it is the only segment).
 */
export interface Segment { index: number; first: number; frames: number }

/** max(1, round(seconds * num / den)); `seconds` defaults to core SEGMENT_SECONDS (60 at 30000/1001, 48 at 24000/1001, 50 at 25). */
export function segmentFrames(rate: T.Rate, seconds?: number): number {
  void rate; void seconds;
  throw new Error('segmentFrames: not built yet (segment cache W1)');
}

/**
 * The intersections of [firstFrame, firstFrame + frames) with grid cells of `segFrames` anchored at programme frame 0, in order,
 * then any head or tail part shorter than core MIN_SEGMENT_FRAMES merged into its neighbour. A range of 1 or 2 frames in all is
 * one segment. Interior cells of a range equal the full grid's cells, so range exports share whole cells with full exports.
 */
export function segmentGrid(firstFrame: number, frames: number, segFrames: number): Segment[] {
  void firstFrame; void frames; void segFrames;
  throw new Error('segmentGrid: not built yet (segment cache W1)');
}

export interface SegmentKeyParams {
  engine: EngineFingerprint;
  /** sha256(`ffmpeg -version` stdout + JSON of the segment encode arguments, thread count included). */
  encoder: string;
  output: { width: number; height: number; frameRate: { num: number; den: number } };
}
/** digest(SEGMENT_KEY_PREFIX + canonicalJson({ ...params, frames: frameKeys })). */
export function segmentKey(frameKeys: readonly string[], params: SegmentKeyParams, digest: Digest): string {
  void frameKeys; void params; void digest;
  throw new Error('segmentKey: not built yet (segment cache W1)');
}
