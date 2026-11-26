/**
 * What a source record's licence asks of a video (wave 8 `sources`; verify C14/C15). NOT a second licence table: everything reads
 * libraryDuties.ts licenceFacts (SPDX_LICENCES + refusedSpdx).
 *
 * - sourceRecordProblems (LEAD, complete): the DATA FACTS validate.ts source_provenance and use_source_item refuse — a record weaker
 *   than its own licence id, a credit its licence names but the record lacks. Nothing about whether a licence is acceptable.
 * - sourceDuties (W1): the WARNINGS of a record (licence_no_derivatives / licence_share_alike quoting SOURCE_TERMS cc.nd / cc.sa,
 *   licence_unknown, licence_unconfirmed, source_terms with the record's term rows, non_commercial_content), in that order. Never a
 *   refusal. The same answer the library will give once ADR-0036 turns its refusals into warnings (one line there).
 */
import { licenceFacts } from './libraryDuties.ts';
import { SourcesNotBuiltError, type SourceRecord, type SourceWarning } from './sourcesContract.ts';

export type SourceRecordProblem = { key: 'creditMissing' } | { key: 'recordWeaker'; what: 'non-commercial' | 'not-shareable' | 'share-alike' | 'no-derivatives' | 'licence-unconfirmed' | 'credit-due' };
/** Data facts, first problem first (the order use_source_item refuses in). Pure. */
export function sourceRecordProblems(r: SourceRecord): SourceRecordProblem[] {
  const f = licenceFacts(r.licence.id);
  const out: SourceRecordProblem[] = [];
  if (f.credit && !r.credit?.text.trim()) out.push({ key: 'creditMissing' });
  if (f.credit && r.credit && !r.credit.due) out.push({ key: 'recordWeaker', what: 'credit-due' });
  if (f.nonCommercial && r.flags.nonCommercial !== true) out.push({ key: 'recordWeaker', what: 'non-commercial' });
  if (f.shareAlike && r.flags.shareAlike !== true) out.push({ key: 'recordWeaker', what: 'share-alike' });
  if (f.noDerivatives && r.flags.noDerivatives !== true) out.push({ key: 'recordWeaker', what: 'no-derivatives' });
  if (!f.known && r.flags.licenceUnconfirmed !== true) out.push({ key: 'recordWeaker', what: 'licence-unconfirmed' });
  if (!f.shareable && r.flags.notShareable !== true) out.push({ key: 'recordWeaker', what: 'not-shareable' });
  return out;
}
/** English sentences of sourceRecordProblems without the "asset <id>: " prefix (validate.ts source_provenance). */
export function sourceRecordIssues(r: SourceRecord): string[] {
  return sourceRecordProblems(r).map((p) => (p.key === 'creditMissing' ? `its licence "${r.licence.id}" names a credit, and the source record has none` : `the source record is weaker than its licence "${r.licence.id}": it must be marked ${p.what}`));
}
/** W1: the warnings of one record (see the header). `title` names the file in the message. */
export function sourceDuties(r: SourceRecord, title: string): SourceWarning[] {
  void r; void title;
  throw new SourcesNotBuiltError('sourceDuties');
}
