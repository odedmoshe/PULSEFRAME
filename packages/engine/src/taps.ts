/**
 * Time effects on the shared evaluator (ADR-0011): which earlier (or sub-frame) pictures a time effect reads, with which
 * integer weights, and their exact integer merge; the shown frame of time.stutter; planned beat steps.
 *
 * STUB (lead pre-pass): the signatures below are the contract; the bodies are placeholders until W1 builds them.
 * Nothing calls them yet.
 */
import * as T from '@pulseframe/time';
import type { Clip, ProjectDocument, Track } from '@pulseframe/core';

type Params = Record<string, number | string | boolean>;
/** Scratch slot (look.ts scratch) in which drawGraph places one tap at a time. Slots 0–7 are taken (look.ts, compositor2d.ts). */
export const TAP_PLACE_SLOT = 8;
/** Offsets from the frame time of the pictures a 'taps' time effect reads, newest first (shutter: sub-frame samples in time order). Exact rationals. */
export function tapOffsets(type: string, params: Params, rate: T.Rate): T.RationalTime[] { return [T.ZERO]; }
/** Integer weights for n pictures summing to TAP_WEIGHT_TOTAL (blend/trail/lighten/shutter) or all 0 (split). Largest remainder, ties to the lower index. */
export function tapWeights(type: string, params: Params, n: number): number[] { return Array(n).fill(0); }
/** The clip shown at `at` by the run of cut pieces that ends with `clip` on `track` (pieces end exactly where the next begins and carry an effect with id `effectId`); null when `at` is before the run. */
export function pieceAt(track: Track, clip: Clip, effectId: string, at: T.RationalTime): Clip | null { return null; }
/** Start of the run of cut pieces that ends with `clip`. */
export function runStart(track: Track, clip: Clip, effectId: string): T.RationalTime { return clip.start; }
export interface TapMerger { add(index: number, rgba: Uint8ClampedArray): void; finish(out: Uint8ClampedArray): void }
/** Exact integer merge of straight-alpha RGBA8 pictures, added one at a time (ADR-0011 formulas). */
export function tapMerger(type: string, params: Params, weights: readonly number[], pixels: number): TapMerger { throw new Error('taps: not built yet'); }
/** Timeline frame whose picture time.stutter shows on frame `frame` (steady steps, planned beat steps or freeze). */
export function stutterFrame(doc: ProjectDocument, sequenceId: string, track: Track, clip: Clip, effectId: string, params: Params, frame: number): number { return frame; }
/** Planned beat frames for effects that change the picture on beats: thinned like the strobe's and at least flashGapFrames apart. Cached per document and sequence. */
export function beatStepFrames(doc: ProjectDocument, sequenceId: string, every: number): Float64Array { return new Float64Array(0); }
/** Most video decoders any frame of the sequence needs (picture layers, transition outgoing sides, decoding taps), and where. */
export function maxDecodeLanes(doc: ProjectDocument, sequenceId?: string): { lanes: number; fromFrame: number; toFrame: number } { return { lanes: 0, fromFrame: 0, toFrame: 0 }; }
