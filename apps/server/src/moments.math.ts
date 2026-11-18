/**
 * The pure maths of the moments job (wave 5 family film, ADR-0026), exactly as stated in core momentsContract.ts: integer
 * results, a fixed evaluation order, ties to the lowest index, no I/O, no clock, no random source.
 *
 * LEAD STUB, final signatures. W2 owns the bodies and moments.math.test.ts. Until then each refuses; nothing is measured.
 */
import type { MomentsFile, MomentWindow, PictureSeries, SoundSeries } from '@pulseframe/core';
import type { GreyFrame } from './vision/types.ts';

export interface PictureSample { luma: number; sharp: number; inner: number; pan: number; change: number; /** the best shift lies on the border of the search (a whip pan the search cannot measure) */ border: boolean }
/** One picture sample against the previous one (null for the first: inner, pan and change are 0). */
export function pictureSample(prev: GreyFrame | null, cur: GreyFrame, samplesPerSecond: number): PictureSample {
  void prev; void cur; void samplesPerSecond;
  throw new Error('pictureSample: not built yet (family film W2)');
}
/** Level per hop of MOMENTS_HOP_MS from the waveform's level-0 min/max pairs (256 samples each at 48 kHz): dBFS x 10, floor -1000; bucket b belongs to hop hopOfBucket(b). */
export function soundLevels(peaks: Int16Array, totalSamples: number): number[] {
  void peaks; void totalSamples;
  throw new Error('soundLevels: not built yet (family film W2)');
}
/** Candidate moments from the series (gates, robust z centred on the 20th percentile, peaks, clean stretches) and the file-level values. */
export function findMoments(picture: PictureSeries | null, sound: SoundSeries | null, asset: { frames: number; rate: { num: number; den: number }; startOffsetFrames: number }): { flat: boolean; windows: MomentWindow[]; file: MomentsFile } {
  void picture; void sound; void asset;
  throw new Error('findMoments: not built yet (family film W2)');
}
