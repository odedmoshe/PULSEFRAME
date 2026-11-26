/**
 * «בדיקה לפני ייצוא» — the count line at the top of the sheet's section (wave 8 qc; B2 builds it, .artifacts/wave8/qc-b2.md).
 * Mounted by ExportSheet.tsx `Checks`. Until B2 builds it: renders nothing (no count is shown that was not counted).
 * B2: blockers · warnings · notes from `report` (issues without no_loudness_target, as the list), and the number of sound findings
 * from `sound` (i18n qc.summary.*), id QC_TESTIDS.summary; numbers in <bdi dir="ltr">. Never an all-clear.
 */
import type { SoundChecks } from '@pulseframe/core';
import type { PreflightReport } from '../../api.ts';

export interface PreflightSummaryProps { lang: 'he' | 'en'; report: PreflightReport | null; sound: SoundChecks | null | 'measuring' }
export function PreflightSummary(props: PreflightSummaryProps) {
  void props;
  return null;
}
