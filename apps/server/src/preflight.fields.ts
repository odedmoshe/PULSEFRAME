/**
 * Export checks of the life line (ADR-0021): titles with live fields and capture-sourced date stamps. Called by the exporter's
 * plan (export.ts: the blockers here really stop an export of moving picture; a still is never stopped, so the editor's own
 * frames always draw) and by the preflight report (preflight.ts: the same issues, with their frame ranges).
 *
 * The codes, severities, id order and signatures are the lead's contract.
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
 * Rules of this file:
 * - What is reported is what the evaluator will draw: the values come from core fieldSpans / stampText, the same functions
 *   the one evaluator calls (ADR-0005), never from a second reading of the rules.
 * - It never passes an output it cannot check: if a title's fields cannot be resolved at all (the resolver throws), the
 *   title is reported as field_no_data over its whole span.
 * - The cap never hides a blocker: blockers are listed first, and what the cap cuts is counted in one further issue per code.
 */
import * as T from '@pulseframe/time';
import { fieldSpans, makeFieldIndex, parseFields, stampText, type Clip, type FieldIndex, type MissingReason, type ProjectDocument, type ResolvedFields, type Sequence, type TextClip } from '@pulseframe/core';
import type { PreflightIssue } from './preflight.ts';

export const FIELD_ISSUE_CODES = ['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date'] as const;
export type FieldIssueCode = (typeof FIELD_ISSUE_CODES)[number];
export const isFieldIssueCode = (code: string): code is FieldIssueCode => (FIELD_ISSUE_CODES as readonly string[]).includes(code);
export const MAX_FIELD_ISSUES = 40;

type Frames = { startFrame: number; endFrame: number };
/** Why a field has no words, as the report says it. */
const WHY: Record<MissingReason, string> = {
  no_date: 'there is no capture date to take it from (the picture under the title has none, or no dated picture is on the timeline)',
  sunset_undecided: 'the Hebrew date depends on whether it was filmed before or after sunset, and that has not been answered',
  no_event_name: 'the picture under the title is in no event, or its event has no name',
  unknown_person: 'the project holds no such person',
};
const quote = (text: string) => `"${text.replace(/\s+/g, ' ').slice(0, 30)}"`;
const framesOf = (c: Clip, rate: T.Rate): Frames => ({ startFrame: T.frameIndexAt(c.start, rate), endFrame: T.frameIndexAt(T.add(c.start, c.duration), rate) });
const overlaps = (a: Frames, b: Frames | undefined) => !b || (a.endFrame > b.startFrame && a.startFrame < b.endFrame);
const SEVERITY_ORDER = { blocker: 0, warning: 1, note: 2 } as const;

/** One issue as it is found for one stretch of a title; equal `key`s on touching stretches are one issue. */
interface Found { key: string; issue: PreflightIssue & { range: Frames } }
/** Touching stretches with the same finding become one issue over all of them. */
function mergeRuns(found: Found[]): PreflightIssue[] {
  const open = new Map<string, PreflightIssue & { range: Frames }>();
  const out: PreflightIssue[] = [];
  for (const f of found) {
    const prev = open.get(f.key);
    if (prev && prev.range.endFrame === f.issue.range.startFrame) { prev.range.endFrame = f.issue.range.endFrame; continue; }
    const issue = { ...f.issue, range: { ...f.issue.range } };
    open.set(f.key, issue);
    out.push(issue);
  }
  return out;
}
/** The topmost picture clip on a visible video track below `trackIndex` that covers `frame`: the clip a title without a date is looking at. */
function pictureUnder(doc: ProjectDocument, seq: Sequence, trackIndex: number, frame: number, rate: T.Rate): string | undefined {
  for (let i = trackIndex - 1; i >= 0; i--) {
    const track = seq.tracks[i]!;
    if (track.kind !== 'video' || track.hidden) continue;
    for (const c of track.clips) {
      if (c.type !== 'media') continue;
      const asset = Object.hasOwn(doc.assets, c.assetId) ? doc.assets[c.assetId]! : undefined;
      const f = framesOf(c, rate);
      if (asset && (asset.kind === 'video' || asset.kind === 'image') && frame >= f.startFrame && frame < f.endFrame) return c.id;
    }
  }
  return undefined;
}
/** Does the title's text hold a field at all? (A title with fields switched on and only plain text depends on no date.) Unknown = yes. */
function holdsField(text: string): boolean {
  try { return parseFields(text).some((p) => 'token' in p); } catch { return true; }
}
/** The stretches of a title with fields, or null when they cannot be worked out. */
function spansOf(doc: ProjectDocument, sequenceId: string, clip: TextClip, index: FieldIndex): { startFrame: number; endFrame: number; resolved: ResolvedFields }[] | null {
  try { return fieldSpans(doc, sequenceId, clip, { index }); } catch { return null; }
}

function titleIssues(doc: ProjectDocument, seq: Sequence, trackIndex: number, clip: TextClip, rate: T.Rate, index: FieldIndex): PreflightIssue[] {
  const whole = framesOf(clip, rate);
  const spans = spansOf(doc, seq.id, clip, index);
  if (!spans) return [{ code: 'field_no_data', severity: 'blocker', message: `the fields of the title ${quote(clip.text)} could not be worked out, so nothing can be said about what it would show; the export is stopped rather than passed unchecked`, ids: [clip.id], range: whole }];
  const found: Found[] = [];
  const estimates = holdsField(clip.text);
  for (const s of spans) {
    const range = { startFrame: Math.max(whole.startFrame, s.startFrame), endFrame: Math.min(whole.endFrame, s.endFrame) };
    if (range.endFrame <= range.startFrame) continue;
    const { missing, anchor, eventId } = s.resolved;
    const sunset = missing.filter((m) => m.reason === 'sunset_undecided'), other = missing.filter((m) => m.reason !== 'sunset_undecided');
    if (other.length) {
      const under = anchor?.clipId ?? pictureUnder(doc, seq, trackIndex, range.startFrame, rate);
      const what = [...new Set(other.map((m) => `${m.token}: ${WHY[m.reason] ?? m.reason}`))].join('; ');
      found.push({ key: `no_data ${under ?? ''} ${what}`, issue: { code: 'field_no_data', severity: 'blocker', message: `the title ${quote(clip.text)} has a field without data, so those words would be missing from the film (${what})`, ids: [clip.id, ...(under ? [under] : [])], range } });
    }
    if (sunset.length) {
      const what = [...new Set(sunset.map((m) => m.token))].join(', ');
      found.push({ key: `sunset ${eventId ?? ''} ${what}`, issue: { code: 'field_sunset_undecided', severity: 'blocker', message: `the title ${quote(clip.text)} shows a Hebrew date (${what}) for a picture taken around sunset: ${WHY.sunset_undecided}. ${eventId ? 'Answer it for the event (update_event afterSunset)' : 'Put the file in an event and answer it there (add_event, then update_event afterSunset)'}; it is never guessed`, ids: [clip.id, ...(eventId ? [eventId] : [])], range } });
    }
    if (anchor?.circa && estimates)
      found.push({ key: `circa ${anchor.assetId}`, issue: { code: 'capture_estimated', severity: 'note', message: `the title ${quote(clip.text)} takes its date from an estimate (the file's name gives the day it was saved or sent, not necessarily the day it was filmed)`, ids: [clip.id, anchor.assetId], range } });
  }
  return mergeRuns(found);
}

/** The frames of `clip` in which its capture-sourced date stamp has no date, as maximal runs. */
function emptyStampRuns(doc: ProjectDocument, seq: Sequence, clip: Clip, rate: T.Rate, index: FieldIndex): Frames[] {
  const whole = framesOf(clip, rate);
  if (whole.endFrame <= whole.startFrame) return [];
  const empty = (frame: number) => { try { return stampText(doc, seq.id, clip, T.frameTime(frame, rate), {}, { index }) === ''; } catch { return true; } };
  // A picture reads its own file: one answer for the whole clip. An adjustment or a title reads the topmost dated picture
  // under it, which can only change where a clip starts or ends.
  if (clip.type === 'media') return empty(whole.startFrame) ? [whole] : [];
  const cuts = new Set<number>([whole.startFrame]);
  for (const t of seq.tracks) for (const c of t.clips) for (const f of Object.values(framesOf(c, rate))) if (f > whole.startFrame && f < whole.endFrame) cuts.add(f);
  const starts = [...cuts].sort((a, b) => a - b);
  const runs: Frames[] = [];
  starts.forEach((startFrame, i) => {
    if (!empty(startFrame)) return;
    const endFrame = starts[i + 1] ?? whole.endFrame, last = runs[runs.length - 1];
    if (last && last.endFrame === startFrame) last.endFrame = endFrame; else runs.push({ startFrame, endFrame });
  });
  return runs;
}

/**
 * The issues of the main sequence's titles with fields and capture-sourced stamps on visible tracks; with `range`, only those
 * that hold somewhere inside it (frames of the output, endFrame exclusive). Blockers first, then warnings, then notes, each
 * in timeline order.
 */
export function fieldIssues(doc: ProjectDocument, range?: { startFrame: number; endFrame: number }): PreflightIssue[] {
  const seq = doc.sequences[doc.mainSequenceId];
  if (!seq) return [];
  const rate = doc.settings.frameRate;
  let index: FieldIndex | undefined;
  const indexOf = () => (index ??= makeFieldIndex(doc)); // only a document that has something to check pays for it
  const issues: PreflightIssue[] = [];
  seq.tracks.forEach((track, trackIndex) => {
    if (track.hidden || track.kind === 'audio' || track.kind === 'caption') return; // nothing of these is drawn as a title or a stamp
    for (const c of track.clips) {
      if (c.type === 'caption' || !overlaps(framesOf(c, rate), range)) continue;
      if (c.type === 'text' && c.fields) issues.push(...titleIssues(doc, seq, trackIndex, c, rate, indexOf()));
      if (c.effects?.some((e) => e.enabled && e.type === 'stylize.date-stamp' && e.params.source === 'capture'))
        for (const run of emptyStampRuns(doc, seq, c, rate, indexOf()))
          issues.push({ code: 'stamp_no_date', severity: 'warning', message: c.type === 'media' ? 'a date stamp takes its date from the capture date of its picture, and that file has none, so the stamp draws nothing' : 'a date stamp takes its date from the capture date of the picture under it, and there is no dated picture there, so the stamp draws nothing', ids: [c.id], range: run });
    }
  });
  const inRange = issues.filter((i) => overlaps(i.range!, range));
  const sorted = inRange.map((issue, n) => ({ issue, n })).sort((x, y) => SEVERITY_ORDER[x.issue.severity] - SEVERITY_ORDER[y.issue.severity] || x.issue.range!.startFrame - y.issue.range!.startFrame || x.n - y.n).map((x) => x.issue);
  if (sorted.length <= MAX_FIELD_ISSUES) return sorted;
  // The cap: the first MAX_FIELD_ISSUES are listed (blockers first, so none is cut while a warning or note is listed), and what
  // is cut is counted in one further issue per code, with the code's own severity, so a count never looks milder than its issues.
  const kept = sorted.slice(0, MAX_FIELD_ISSUES);
  const more = new Map<string, { severity: PreflightIssue['severity']; count: number }>();
  for (const i of sorted.slice(MAX_FIELD_ISSUES)) { const m = more.get(i.code) ?? { severity: i.severity, count: 0 }; m.count++; more.set(i.code, m); }
  for (const [code, m] of more) kept.push({ code, severity: m.severity, message: `${m.count} more of the same kind are not listed here (${code})`, ids: [] });
  return kept;
}
/** The text to estimate a title's extent from (preflight's safe-area check): for a title with fields, the longest text it resolves to over its span. */
export function fieldTextExtent(doc: ProjectDocument, sequenceId: string, clip: TextClip): string {
  if (!clip.fields) return clip.text;
  const spans = spansOf(doc, sequenceId, clip, makeFieldIndex(doc));
  if (!spans?.length) return clip.text; // cannot be resolved: the stored text is the best estimate there is
  // "longest" as the extent estimate measures it: the widest line first, then the most lines
  const size = (text: string) => { const lines = text.split('\n'); return [Math.max(...lines.map((l) => l.length)), lines.length] as const; };
  let best = spans[0]!.resolved.text, bestSize = size(best);
  for (const s of spans) { const z = size(s.resolved.text); if (z[0] > bestSize[0] || (z[0] === bestSize[0] && z[1] > bestSize[1])) { best = s.resolved.text; bestSize = z; } }
  return best;
}
