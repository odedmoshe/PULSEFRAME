/**
 * Contracts of the model-free tracker (ADR-0015): the pure kernel (pyramidal Lucas-Kanade median flow with a
 * forward-backward check and NCC verification) and the frame reader that feeds it. No AI model is involved.
 * The kernel works on grey work frames (TRACK_WORK_HEIGHT high at most); the job converts its positions to TRACK_UNIT.
 */
export interface GreyFrame { readonly width: number; readonly height: number; readonly data: Uint8Array }
/** Work-frame pixels; centre of the point or box. */
export interface TrackerSeed { kind: 'point' | 'region'; cx: number; cy: number; w?: number; h?: number }
/** s: size relative to the seed box (1 = seed). st: 1 tracked | 2 weak | 3 lost (cx/cy/s hold the last usable) | 6 reacquired. */
export interface TrackerStep { cx: number; cy: number; s: number; q: number; st: 1 | 2 | 3 | 6 }
export interface TrackerParams { levels: number; window: number; pointWindow: number; maxIter: number; epsilon: number; grid: number; trackedQ: number; weakQ: number; maxFb: number; minPoints: number; reacquireNcc: number; reacquireMargin: number; reacquireConfirm: number; maxTemplates: number; templateEvery: number }
export const DEFAULT_TRACKER_PARAMS: TrackerParams = { levels: 3, window: 15, pointWindow: 21, maxIter: 20, epsilon: 0.01, grid: 10, trackedQ: 70, weakQ: 55, maxFb: 6, minPoints: 6, reacquireNcc: 0.8, reacquireMargin: 0.1, reacquireConfirm: 3, maxTemplates: 8, templateEvery: 30 };
/** Deterministic: only + − × / Math.sqrt|floor|round|abs, fixed order, ties to the lowest (y, x); no randomness, clocks or threads. */
export interface Tracker {
  step(next: GreyFrame): TrackerStep;
  /** A manual sample at the current frame: re-seed points, add a template. */
  anchor(frame: GreyFrame, at: { cx: number; cy: number; s: number }): void;
}
export type CreateTracker = (first: GreyFrame, seed: TrackerSeed, params?: Partial<TrackerParams>) => Tracker;
export interface FrameSource { file: string; kind: 'proxy' | 'original'; blobHash: string; width: number; height: number; frameCount: number; rate: { num: number; den: number } }
/** Frames [from, to) at work size, ascending; output frame k is evaluator source index k (ffmpeg trim by the frame counter n, as derive.ts thumbnails picks frames by index). Throws on a count mismatch; SIGKILLs ffmpeg on abort. digest = SHA-256 of the grey bytes. */
export type ReadFrames = (src: FrameSource, from: number, to: number, workHeight: number, onFrame: (index: number, frame: GreyFrame) => void | Promise<void>, signal: AbortSignal) => Promise<{ frames: number; digest: string }>;
