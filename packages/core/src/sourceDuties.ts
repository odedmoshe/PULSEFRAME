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
import { LICENCE_WARNING_TERMS, SOURCE_TERMS, type SourceRecord, type SourceWarning } from './sourcesContract.ts';

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
/** `"<licence name>" (<id>)`: the provider's own words verbatim, then the exact id when it says something else. */
const licenceLabel = (r: SourceRecord) => {
  const name = r.licence.name.trim();
  return name && name !== r.licence.id ? `"${name}" (${r.licence.id})` : `"${r.licence.id}"`;
};
/** A term row quoted with its link (never paraphrased, C15). */
const quoted = (id: string) => { const t = Object.hasOwn(SOURCE_TERMS, id) ? SOURCE_TERMS[id]! : undefined; return t ? `"${t.quote}" (${t.url}, read ${t.readOn})` : ''; };
/**
 * W1: the warnings of one record (see the header), in the order licence_no_derivatives, licence_share_alike, licence_unknown,
 * licence_unconfirmed, source_terms, non_commercial_content. `title` names the file in the message. A licence finding names the
 * licence as the provider wrote it and quotes the licence's own deed row (SOURCE_TERMS cc.nd / cc.sa); nothing concludes what the
 * licence means for this video. licence_unconfirmed is said for an id outside the table only when no other licence finding already
 * names it (a no-derivatives or share-alike id quotes its deed instead; an unknown licence says so). Never a refusal. Pure.
 */
export function sourceDuties(r: SourceRecord, title: string): SourceWarning[] {
  const f = licenceFacts(r.licence.id);
  const t = `"${title}"`;
  const base = { title, licenceId: r.licence.id, licenceName: r.licence.name };
  const at = r.licence.url ? ` (${r.licence.url})` : '';
  const out: SourceWarning[] = [];
  const nd = f.noDerivatives || r.flags.noDerivatives === true, sa = f.shareAlike || r.flags.shareAlike === true;
  if (nd) out.push({ code: 'licence_no_derivatives', ...base, termIds: [LICENCE_WARNING_TERMS.licence_no_derivatives!], message: `${t}: the licence ${licenceLabel(r)}${at} says in its own words: ${quoted(LICENCE_WARNING_TERMS.licence_no_derivatives!)}` });
  if (sa) out.push({ code: 'licence_share_alike', ...base, termIds: [LICENCE_WARNING_TERMS.licence_share_alike!], message: `${t}: the licence ${licenceLabel(r)}${at} says in its own words: ${quoted(LICENCE_WARNING_TERMS.licence_share_alike!)}` });
  const unknown = r.licence.from === 'none' || r.licence.id === 'unknown';
  if (unknown) out.push({ code: 'licence_unknown', ...base, termIds: [], message: `${t}: licence unknown: the service or the link named no licence${r.pageUrl ? `; its page: ${r.pageUrl}` : ''}` });
  else if (!f.known && !nd && !sa) out.push({ code: 'licence_unconfirmed', ...base, termIds: [], message: `${t}: the licence ${licenceLabel(r)} was not read in full here; read it at ${r.licence.url ?? r.pageUrl ?? 'the service\'s page'} before publishing` });
  const terms = (r.terms ?? []).filter((id) => Object.hasOwn(SOURCE_TERMS, id));
  if (terms.length) {
    const providers = [...new Set(terms.map((id) => SOURCE_TERMS[id]!.provider))].join(', ');
    out.push({ code: 'source_terms', ...base, termIds: terms, message: `${t}: terms of ${providers}, quoted: ${terms.map(quoted).join('; ')}` });
  }
  if (f.nonCommercial || r.flags.nonCommercial === true) out.push({ code: 'non_commercial_content', ...base, termIds: [], message: `${t}: the licence ${licenceLabel(r)} is marked non-commercial: for non-commercial use only` });
  return out;
}
