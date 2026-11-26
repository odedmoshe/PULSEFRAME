/**
 * Dragging the playhead (wave 8D P5 a): pure parts. Where a pointer x lands in frames, the edit points it snaps to, and the
 * per-animation-frame gate that turns a stream of pointer moves into at most one seek per painted frame (the last position wins).
 * The playhead is view state: nothing here commits.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { clipEnd } from '@pulseframe/core';

/** How close (CSS px) the pointer must come to an edit point for the playhead to stick to it (Alt held: never). */
export const SNAP_PX = 6;
/** The width of the press area around the playhead's line and cap (CSS px). */
export const GRAB_PX = 24;

/** The frame under x px from the time origin at `pps` px a second, clamped to [0, last]. Never a float time: a whole frame index. */
export function frameAtX(x: number, pps: number, rate: T.Rate, last: number): number {
  if (!(pps > 0) || !Number.isFinite(x)) return 0;
  const f = Math.round(((x / pps) * rate.num) / rate.den);
  return Math.max(0, Math.min(Math.max(0, last), f));
}
/** The x of a frame at `pps` px a second (pixels are the only floats). */
export const xOfFrame = (frame: number, pps: number, rate: T.Rate) => ((frame * rate.den) / rate.num) * pps;

/** The edit points the playhead snaps to: 0 and every clip's start and end on the main sequence (each frame once, ascending). */
export function cutFrames(doc: ProjectDocument | null, rate: T.Rate): number[] {
  if (!doc) return [];
  const out = new Set<number>([0]);
  for (const tr of doc.sequences[doc.mainSequenceId]?.tracks ?? []) for (const c of tr.clips) { out.add(T.frameIndexAt(c.start, rate)); out.add(T.frameIndexAt(clipEnd(c), rate)); }
  return [...out].sort((a, b) => a - b);
}

/**
 * The frame the playhead goes to for a pointer at `x`: the nearest edit point within SNAP_PX of the pointer when snapping is on
 * (the nearest one wins; a tie goes to the earlier), else the frame under the pointer.
 */
export function snapFrame(x: number, pps: number, rate: T.Rate, last: number, cuts: readonly number[], snap: boolean, px = SNAP_PX): { frame: number; snapped: boolean } {
  const free = frameAtX(x, pps, rate, last);
  if (!snap || !cuts.length) return { frame: free, snapped: false };
  let best = -1, bestD = Infinity;
  for (const c of cuts) {
    if (c > last) continue;
    const d = Math.abs(xOfFrame(c, pps, rate) - x);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best >= 0 && bestD <= px ? { frame: best, snapped: true } : { frame: free, snapped: false };
}

/**
 * One seek per animation frame at most: `want(frame)` records the latest wish; the scheduled callback hands only the newest one
 * to `seek`, and only when it differs from the last one handed over. Nothing is queued: a wish overwritten before its animation
 * frame is never sought. `flush()` hands the pending wish over at once (the release of the pointer); `cancel()` drops it.
 */
export class FrameGate {
  private pending: number | null = null;
  private handle: unknown = null;
  private last: number | null = null;
  seeks = 0;
  constructor(private seek: (frame: number) => void, private raf: (cb: () => void) => unknown, private caf: (h: unknown) => void) {}
  want(frame: number): void {
    this.pending = frame;
    if (this.handle === null) this.handle = this.raf(() => { this.handle = null; this.run(); });
  }
  private run(): void {
    const f = this.pending;
    this.pending = null;
    if (f === null || f === this.last) return;
    this.last = f;
    this.seeks++;
    this.seek(f);
  }
  flush(): void { if (this.handle !== null) { this.caf(this.handle); this.handle = null; } this.run(); }
  cancel(): void { if (this.handle !== null) { this.caf(this.handle); this.handle = null; } this.pending = null; }
  /** The frame the gate last handed to seek (so a press that starts on the current frame seeks nothing). */
  start(current: number): void { this.last = current; this.seeks = 0; }
}

/** A press on the grab area that moved less than this (CSS px) has not started a drag yet (the playhead stays where it is). */
export const CLICK_SLOP_PX = 3;
