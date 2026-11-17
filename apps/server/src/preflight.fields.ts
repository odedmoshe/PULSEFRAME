/**
 * Export checks of the life line (ADR-0021): titles with live fields and capture-sourced date stamps. Called by the exporter's
 * plan (export.ts: the blockers here really stop an export of moving picture; a still is never stopped, so the editor's own
 * frames always draw) and by the preflight report (preflight.ts: the same issues, with their frame ranges).
 *
 * CONTRACT FILE (lead pre-pass). The codes, severities, id order and signatures are fixed; the bodies are W2's.
 *
 *   field_no_data           blocker  ids [titleId, anchorClipId?]  a field of a title has no words in these frames (no date under the
 *                                                                   title, no event name, a person the project does not hold); the
 *                                                                   message names the field as written and the reason
 *   field_sunset_undecided  blocker  ids [titleId, eventId?]       a Hebrew field depends on whether it was filmed after sunset; the fix
 *                                                                   is the event's answer (update_event afterSunset), never a guess
 *   capture_estimated       note     ids [titleId, assetId]        a field takes its date from an estimate (a file-name date)
 *   stamp_no_date           warning  ids [clipId]                  a capture-sourced date stamp draws nothing in these frames
 *
 * `range` is the frames of the OUTPUT where the issue holds (endFrame exclusive), from core fieldSpans; one issue per title
 * and stretch, at most MAX_FIELD_ISSUES in all (any more are counted in one further issue of the same code).
 * `doc` is the document of the output being checked (the master, or a format's projection: export.ts variantDoc), so a
 * format's own wording and hidden clips are what is checked.
 *
 * Until W2's bodies land nothing can resolve a field (core resolveFields gives the stored text; stampText gives ''), and
 * that is exactly what this placeholder reports: every title with fields as field_no_data, every capture-sourced stamp as
 * stamp_no_date. It never passes an output it cannot check.
 */
import * as T from '@pulseframe/time';
import type { ProjectDocument, TextClip } from '@pulseframe/core';
import type { PreflightIssue } from './preflight.ts';

export const FIELD_ISSUE_CODES = ['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date'] as const;
export type FieldIssueCode = (typeof FIELD_ISSUE_CODES)[number];
export const isFieldIssueCode = (code: string): code is FieldIssueCode => (FIELD_ISSUE_CODES as readonly string[]).includes(code);
export const MAX_FIELD_ISSUES = 40;

/**
 * The issues of the main sequence's titles with fields and capture-sourced stamps on visible tracks; with `range`, only those
 * that hold somewhere inside it (frames of the output, endFrame exclusive).
 */
export function fieldIssues(doc: ProjectDocument, range?: { startFrame: number; endFrame: number }): PreflightIssue[] {
  // CONTRACT STUB (see the header): fields and capture-sourced stamps cannot be resolved in this build. W2 replaces this body.
  const rate = doc.settings.frameRate;
  const issues: PreflightIssue[] = [];
  for (const track of doc.sequences[doc.mainSequenceId]?.tracks ?? []) {
    if (track.hidden) continue;
    for (const c of track.clips) {
      const span = { startFrame: T.frameIndexAt(c.start, rate), endFrame: T.frameIndexAt(T.add(c.start, c.duration), rate) };
      if (range && (span.endFrame <= range.startFrame || span.startFrame >= range.endFrame)) continue;
      if (c.type === 'text' && c.fields) issues.push({ code: 'field_no_data', severity: 'blocker', message: `the title "${c.text.slice(0, 30)}" holds live fields, and this build cannot fill them yet (the life line is not built)`, ids: [c.id], range: span });
      if (c.type !== 'caption' && c.effects?.some((e) => e.enabled && e.type === 'stylize.date-stamp' && e.params.source === 'capture')) issues.push({ code: 'stamp_no_date', severity: 'warning', message: 'a date stamp takes its date from the capture date, and this build cannot read one yet (the life line is not built), so it draws nothing', ids: [c.id], range: span });
    }
  }
  return issues.slice(0, MAX_FIELD_ISSUES);
}
/** The text to estimate a title's extent from (preflight's safe-area check): for a title with fields, the longest text it resolves to over its span. */
export function fieldTextExtent(_doc: ProjectDocument, _sequenceId: string, clip: TextClip): string {
  // CONTRACT STUB: the stored text. W2 replaces this body (the longest resolved text of core fieldSpans).
  return clip.text;
}
