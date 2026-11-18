/**
 * The export sheet's fast-export block (ADR-0024, plan §8): the «ייצוא מהיר — מרנדר רק מה שהשתנה» switch with its hint and its
 * disabled reason (MP4 only, cache off, not available: from the plan's blocker codes), and a role=status aria-live=polite block
 * with the reuse line, what is rendered, the first-export and nothing-changed variants, the measured ETA (only when
 * estimate.seconds is not null) and the honest notes (ripple, music).
 *
 * CONTRACT FILE (lead pre-pass): the export and its props are fixed; W3 builds the body. Until then nothing is drawn. The lead
 * mounts it in ExportSheet.tsx / DeliverPanel.tsx.
 */
import type { ReactElement } from 'react';
import type { SegmentPlanState } from './store.ts';
export function ExportReuseLine(_props: { plan: SegmentPlanState; fastExport: boolean; onFastExport: (on: boolean) => void; format: string; blockerCodes: readonly string[]; lang: 'he' | 'en' }): ReactElement | null {
  return null;
}
