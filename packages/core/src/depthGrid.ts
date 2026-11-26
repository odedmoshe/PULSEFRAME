/**
 * The integer depth rasteriser of «תמונה חיה» (wave 8 living; livingContract.ts). The body is W1's; the SIGNATURE is the contract.
 *
 * depthGrid(depth, shown) → the nearness grid at depthGridSize(shown), one byte per cell, row-major, 255 = near. Integer only, so Node
 * and Chromium give the same bytes (golden SHA-256 test in Node; the proof compares the page's digest with Node's):
 * 1. base: ramp → cell (x, y) at row centre yc = (2y + 1)·1000 / (2·height) (integer, rounded half up): 0 above the horizon h,
 *    round(255·(yc − h) / (1000 − h)) below (round half up); flat → 0 everywhere.
 * 2. strokes in order, each as a value + weight layer on the grid: a soft disc of radius size/1000 of the short side, swept along each
 *    segment (one point = a dab); weight DEPTH_WEIGHT_ONE inside half the radius, DEPTH_FALLOFF beyond it, the larger weight where
 *    discs of one stroke overlap; laid over the grid as out = (base·(256 − w) + v·w + 128) >> 8 with v = DEPTH_LAYER_VALUE[layer].
 * 3. NO widen-then-blur: that is reserved for model maps (DEPTH_MODEL_WIDEN_BLUR) and is not built in version 1.
 * Worst case about 24 M integer steps (64 strokes × 4096 points × the largest brush): the media pool caches by depthKey and never
 * runs it per frame (verifier C14 d).
 *
 * depthKey(depth): canonical JSON of the record plus DEPTH_RASTER_V1, prefixed `depth:` so a texture key can never collide with a
 * colour table's (C14 g). LEAD-BUILT (trivial).
 */
import { DEPTH_RASTER_V1, LivingNotBuiltError, type ClipDepth, type DepthGrid } from './livingContract.ts';

export function depthGrid(depth: ClipDepth, shown: { width: number; height: number }): DepthGrid {
  void depth; void shown;
  throw new LivingNotBuiltError('depthGrid');
}

const canonical = (v: unknown): string => Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : v && typeof v === 'object'
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}` : JSON.stringify(v);
/** The identity of a drawn depth's grid (the shown aspect is the asset's, covered by its content hash). */
export const depthKey = (depth: ClipDepth): string => `depth:r${DEPTH_RASTER_V1}:${canonical(depth)}`;
