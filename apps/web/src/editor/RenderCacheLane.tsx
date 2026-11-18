/**
 * The render-cache lane (ADR-0024, plan §8): 4 px under the flash lane (token --pf-lane-cache), left to right like all time chrome;
 * cached = solid, to render = dashed amber, uncacheable = dotted, with tooltips (never colour alone); ONE focusable summary
 * (RENDER_CACHE_TESTIDS.summary) whose popover lists up to 8 stale stretches with «קפיצה» (onSeek). aria-busy while updating;
 * nothing at all when status is 'off'. Offers «רענון» (onRefresh) when autoRefresh(keyingMs) is false.
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn. The lead
 * mounts it in Timeline.tsx.
 */
import type { ReactElement } from 'react';
import type { SegmentPlanState } from './store.ts';
export function RenderCacheLane(_props: { plan: SegmentPlanState; pxPerSecond: number; frameRate: { num: number; den: number }; lang: 'he' | 'en'; onSeek: (frame: number) => void; onRefresh: () => void }): ReactElement | null {
  return null;
}
