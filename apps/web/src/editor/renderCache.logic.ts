/**
 * Pure logic of the render-cache lane and the export sheet line (ADR-0024). Frames in a plan's runs are relative to the exported
 * range; the view's `firstFrame` is the programme frame the range starts at. Time chrome stays left to right in both languages,
 * so `x` grows with time. Times are exact: a frame's x is `frame * den * pxPerSecond / num`, one division of integers, never an
 * accumulated rounded duration (ADR-0003).
 */
import { LANE_AUTO_REFRESH_MAX_KEYING_MS, LANE_REFRESH_DEBOUNCE_MS, type SegmentPlanView, type SegmentState } from '@pulseframe/core';

/** One drawn stretch of the lane: a run of the plan in pixels (x from the timeline's time 0). */
export interface LaneStretch { state: SegmentState; x: number; width: number; firstFrame: number; frames: number; segments: number }
/** A stretch the next export renders, for the popover (at most `max`, in programme order). `firstFrame` is a programme frame. */
export interface StaleStretch { firstFrame: number; frames: number; segments: number }
export interface PlanSummary { total: number; cached: number; render: number; uncacheable: number; framesToRender: number; first: boolean; nothingChanged: boolean }

/** The popover lists at most this many stale stretches (plan §8). */
export const STALE_POPOVER_MAX = 8;

const px = (frames: number, rate: { num: number; den: number }, pxPerSecond: number) => (frames * rate.den * pxPerSecond) / rate.num;

/** The plan's runs as pixel stretches at `pxPerSecond` for the project rate (exact frame times, then pixels), in programme order. */
export function laneStretches(view: SegmentPlanView, pxPerSecond: number, rate: { num: number; den: number }): LaneStretch[] {
  if (!(pxPerSecond > 0) || !(rate.num > 0) || !(rate.den > 0)) return [];
  return view.runs
    .filter((r) => r.frames > 0 && r.segments > 0)
    .map((r) => {
      const firstFrame = view.firstFrame + r.firstFrame;
      return { state: r.state, x: px(firstFrame, rate, pxPerSecond), width: px(r.frames, rate, pxPerSecond), firstFrame, frames: r.frames, segments: r.segments };
    })
    .sort((a, b) => a.firstFrame - b.firstFrame);
}

/** Stretches that the next export renders because they changed (state `render`), neighbours merged, programme frames, at most `max`. */
export function staleStretches(view: SegmentPlanView, max: number = STALE_POPOVER_MAX): StaleStretch[] {
  const out: StaleStretch[] = [];
  const runs = [...view.runs].filter((r) => r.state === 'render' && r.frames > 0).sort((a, b) => a.firstFrame - b.firstFrame);
  for (const r of runs) {
    const last = out[out.length - 1];
    const first = view.firstFrame + r.firstFrame;
    if (last && last.firstFrame + last.frames === first) { last.frames += r.frames; last.segments += r.segments; } else out.push({ firstFrame: first, frames: r.frames, segments: r.segments });
  }
  return out.slice(0, Math.max(0, max));
}
/** How many stale stretches there are in all (the popover says how many it does not list). */
export function staleStretchCount(view: SegmentPlanView): number { return staleStretches(view, Number.MAX_SAFE_INTEGER).length; }

/** first: nothing reused yet (every segment renders); nothingChanged: no segment renders (all reused). */
export function planSummary(view: SegmentPlanView): PlanSummary {
  const { total, cached, render, uncacheable } = view.segments;
  return {
    total, cached, render, uncacheable, framesToRender: view.framesToRender,
    first: total > 0 && cached === 0,
    nothingChanged: total > 0 && render === 0 && uncacheable === 0 && view.framesToRender === 0,
  };
}

/** The lane refreshes by itself only when the last plan's keying took less than core LANE_AUTO_REFRESH_MAX_KEYING_MS (null: no plan yet). */
export function autoRefresh(lastKeyingMs: number | null): boolean {
  return lastKeyingMs === null || lastKeyingMs < LANE_AUTO_REFRESH_MAX_KEYING_MS;
}

/** Seconds of video in `frames` at the project rate, for «N שניות של סרטון» (display only; rounded half up, at least 1 when any frame). */
export function videoSeconds(frames: number, rate: { num: number; den: number }): number {
  if (frames <= 0 || !(rate.num > 0)) return 0;
  return Math.max(1, Math.round((frames * rate.den) / rate.num));
}

/** Whether the lane and the sheet show anything: nothing while the cache is off or the plan was never asked for. */
export function laneVisible(status: 'off' | 'updating' | 'ready' | 'error', view: SegmentPlanView | null): boolean {
  if (status === 'off') return false;
  if (status === 'ready' || status === 'updating') return view !== null || status === 'updating';
  return false;
}

export interface RefreshTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const realTimers: RefreshTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

/**
 * The refresh policy of the lane (plan §8, corrected notes E): a plan is asked for LANE_REFRESH_DEBOUNCE_MS (1.5 s) after the
 * LAST revision change, and a request still in flight for an older revision is aborted when a newer change arrives or the
 * policy is disposed. When the last plan's keying was slow (`autoRefresh` false) nothing is scheduled by itself: only `now()`
 * (the «רענון» button) asks. `run` receives the AbortSignal to pass to the plan request and the revision it is planning for;
 * its result is ignored once superseded (the caller checks `signal.aborted`).
 */
export class RefreshPolicy {
  private timer: unknown = null;
  private ctl: AbortController | null = null;
  private lastKeyingMs: number | null = null;
  private disposed = false;
  constructor(private readonly run: (signal: AbortSignal, revision: number) => Promise<{ keyingMs: number } | void>, private readonly timers: RefreshTimers = realTimers, readonly debounceMs: number = LANE_REFRESH_DEBOUNCE_MS) {}
  /** A revision change was seen. Returns true when a refresh was scheduled. */
  changed(revision: number): boolean {
    if (this.disposed) return false;
    this.cancel();
    if (!autoRefresh(this.lastKeyingMs)) return false;
    this.timer = this.timers.set(() => { this.timer = null; void this.fire(revision); }, this.debounceMs);
    return true;
  }
  /** The «רענון» button, or the first plan: asks at once, aborting an older request. */
  now(revision: number): Promise<void> { if (this.disposed) return Promise.resolve(); this.cancel(); return this.fire(revision); }
  private async fire(revision: number): Promise<void> {
    const ctl = new AbortController();
    this.ctl = ctl;
    try {
      const r = await this.run(ctl.signal, revision);
      if (!ctl.signal.aborted && r && typeof r.keyingMs === 'number') this.lastKeyingMs = r.keyingMs;
    } finally { if (this.ctl === ctl) this.ctl = null; }
  }
  /** Drops a scheduled refresh and aborts a request in flight. */
  cancel(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (this.ctl) { this.ctl.abort(); this.ctl = null; }
  }
  /** True while a refresh is scheduled or in flight. */
  get pending(): boolean { return this.timer !== null || this.ctl !== null; }
  dispose(): void { this.disposed = true; this.cancel(); }
}

/** m:ss of a programme frame at the project rate (floor of the exact rational seconds; display only). */
export function clockOf(frame: number, rate: { num: number; den: number }): string {
  if (!(rate.num > 0) || frame < 0) return '0:00';
  const total = Math.floor((frame * rate.den) / rate.num);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
/** «פריימים 600–719»: the programme frames of a stretch, first to last. */
export function frameRangeOf(s: { firstFrame: number; frames: number }): string { return s.frames <= 1 ? `${s.firstFrame}` : `${s.firstFrame}–${s.firstFrame + s.frames - 1}`; }
