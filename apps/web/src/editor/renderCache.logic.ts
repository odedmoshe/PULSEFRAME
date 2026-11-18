/**
 * Pure logic of the render-cache lane and the export sheet line (ADR-0024). LEAD STUBS, final signatures; W3 owns the bodies
 * and their tests (renderCache.logic.test.ts). Frames here are programme frames unless named relative; time chrome stays left
 * to right in both languages, so `x` grows with time.
 */
import type { SegmentPlanView, SegmentState } from '@pulseframe/core';

/** One drawn stretch of the lane: a run of the plan in pixels (x from the timeline's time 0). */
export interface LaneStretch { state: SegmentState; x: number; width: number; firstFrame: number; frames: number; segments: number }
/** A stretch the next export renders, for the popover (at most `max`, in programme order). */
export interface StaleStretch { firstFrame: number; frames: number; segments: number }
export interface PlanSummary { total: number; cached: number; render: number; uncacheable: number; framesToRender: number; first: boolean; nothingChanged: boolean }

/** The plan's runs as pixel stretches at `pxPerSecond` for the project rate (exact frame times, then pixels). */
export function laneStretches(view: SegmentPlanView, pxPerSecond: number, rate: { num: number; den: number }): LaneStretch[] {
  void view; void pxPerSecond; void rate;
  throw new Error('laneStretches: not built yet (segment cache W3)');
}
export function staleStretches(view: SegmentPlanView, max?: number): StaleStretch[] {
  void view; void max;
  throw new Error('staleStretches: not built yet (segment cache W3)');
}
/** first: nothing reused yet (every segment renders); nothingChanged: every segment reused. */
export function planSummary(view: SegmentPlanView): PlanSummary {
  void view;
  throw new Error('planSummary: not built yet (segment cache W3)');
}
/** The lane refreshes by itself only when the last plan's keying took less than core LANE_AUTO_REFRESH_MAX_KEYING_MS (null: no plan yet). */
export function autoRefresh(lastKeyingMs: number | null): boolean {
  void lastKeyingMs;
  throw new Error('autoRefresh: not built yet (segment cache W3)');
}
