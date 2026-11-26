/**
 * The file card's folded group «יש לזה הסבר בעריכה (n)» (wave 8 qc; B2 builds it): the after-export findings that carry
 * `explained` (core qcContract.ts EXPLAINED_REASONS), each with its reason in words (i18n qc.explained.*), its time and «מעבר לקטע».
 * Mounted by send/ChecksResult.tsx. Until B2 builds it: renders nothing (and nothing is explained until B1 builds explainFindings).
 * B2: QC_TESTIDS.explained on a native <details>, rows QC_TESTIDS.explainedItem with data-why; ChecksResult, the ruler and the status
 * bar count only findings without `explained` (C8).
 */
import type { ExportChecks } from '@pulseframe/core';
import type { RationalTime } from '@pulseframe/time';

export interface ExplainedFindingsProps { lang: 'he' | 'en'; checks: ExportChecks; rate: { num: number; den: number }; onJump(at: RationalTime): void }
export function ExplainedFindings(props: ExplainedFindingsProps) {
  void props;
  return null;
}
