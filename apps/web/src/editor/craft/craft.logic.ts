/**
 * What the craft surfaces decide (wave 7 craft), kept apart from the components so it can be tested without a browser: the toast
 * of a ripple trim and of a typed duration, the live line of the time field, the paste dialog's rows, the find panel's rows,
 * groups, notes and plan, the versions dialog's sentences, the default name of a version, and how a refusal is worded. Nothing here
 * keeps project state. The last section is the small IO the surfaces share (a still of a version, read with its refusal).
 */
import * as T from '@pulseframe/time';
import {
  ATTRIBUTE_GROUPS, CRAFT_LIMITS, clipEnd, findClip, parseTimeEntry, planPasteAttributes, planReplace, replaceRanges,
  type AttributeGroup, type DiffEntityKind, type DiffRow, type DiffSummary, type FindQuery, type OpCall, type PastePlan, type ProjectDocument, type ReplacePlan, type TextMatch, type VersionInfo,
} from '@pulseframe/core';
import { dictionaries, translateRefusal } from '@pulseframe/i18n';
import { api, ApiFailure } from '../../api.ts';
import { CRAFT_STRINGS, type CraftStringKey } from './craft.strings.ts';

export type Lang = 'he' | 'en';
const S = (lang: Lang) => CRAFT_STRINGS[lang];
/** The first Latin or other run kept left to right inside a Hebrew sentence. */
export const ltr = (s: string) => `⁦${s}⁩`;

// ---------------------------------------------------------------- words
/** A string with {name} places filled. */
export const say = (lang: Lang, key: CraftStringKey, values: Record<string, string | number> = {}): string =>
  S(lang)[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(values[k] ?? `{${k}}`));
/** `xOne` for one, `xMany` (with {n}) for any other count. */
export const counted = (lang: Lang, base: string, n: number): string => say(lang, (n === 1 ? `${base}One` : `${base}Many`) as CraftStringKey, { n });

/** A refusal worded for a person: the code's headline, then the detail in the interface language where it is known. */
export interface Failure { code: string | null; message: string; hint?: string }
export function craftFailure(lang: Lang, e: unknown): Failure {
  if (!(e instanceof ApiFailure)) return { code: null, message: e instanceof Error ? e.message : String(e) };
  const headline = (dictionaries[lang] as Record<string, string>)[`error.code.${e.code}`];
  const detail = translateRefusal(lang, e.message) ?? e.message;
  const message = headline && !detail.startsWith(headline) ? `${headline}: ${detail}` : detail;
  // the Hebrew sentences already carry the next step; the English hint is the server's own
  return { code: e.code, message, ...(e.hint && lang === 'en' ? { hint: e.hint } : {}) };
}
/** Why a paste row was left out, in words: the craft.skip.* sentence, else the underlying op's own refusal. */
export function skipReason(lang: Lang, code: string, message: string): string {
  const own = (dictionaries[lang] as Record<string, string>)[`craft.skip.${code}`];
  return own ?? translateRefusal(lang, message) ?? message;
}
export const groupName = (lang: Lang, g: AttributeGroup): string => (dictionaries[lang] as Record<string, string>)[`craft.group.${g}`] ?? g;

// ---------------------------------------------------------------- ripple trim and duration
/** Frames of a (non-negative) time, whole. */
const framesOf = (t: T.RationalTime, rate: T.Rate) => T.frameIndexAt(T.isNegative(t) ? T.sub(T.ZERO, t) : t, rate);
/**
 * Clips (on any track) and markers that start at or after `from`, are not in `moved`, and so stayed where they were: what the
 * toast says did not move (Q, W and typed durations keep Delete's rule: only the closing track and linked clips shift).
 */
export function laterThatStayed(doc: ProjectDocument, from: T.RationalTime, moved: readonly string[], sequenceId?: string): number {
  const gone = new Set(moved);
  let n = 0;
  for (const seq of Object.values(doc.sequences)) {
    if (sequenceId && seq.id !== sequenceId) continue;
    for (const tr of seq.tracks) for (const c of tr.clips) if (!gone.has(c.id) && !T.lt(c.start, from)) n++;
  }
  for (const m of Object.values(doc.markers)) if ((!sequenceId || m.sequenceId === sequenceId) && !T.lt(m.time, from)) n++;
  return n;
}
export interface RippleSaid { frames: number; moved: number; stayed: number }
/** The toast of Q and W: «נחתכו 31 פריימים · 6 קליפים זזו» and, when something later stayed, a body line. */
export function rippleNotice(lang: Lang, said: RippleSaid, transactionId: string | null): { kind: 'undo' | 'info'; title: string; body?: string; undoes?: string } {
  const title = [counted(lang, 'trimmed', said.frames), ...(said.moved ? [counted(lang, 'moved', said.moved)] : [])].join(' · ');
  return { kind: transactionId ? 'undo' : 'info', title, ...(said.stayed ? { body: say(lang, 'laterStay') } : {}), ...(transactionId ? { undoes: transactionId } : {}) };
}
/** The toast of a typed duration. */
export function durationNotice(lang: Lang, said: { clips: number; frames: number; stayed: number }, transactionId: string | null): { kind: 'undo' | 'info'; title: string; body?: string; undoes?: string } {
  const title = said.clips === 1 ? say(lang, 'durationSet', { n: said.frames }) : say(lang, 'durationSetMany', { c: said.clips, n: said.frames });
  return { kind: transactionId ? 'undo' : 'info', title, ...(said.stayed ? { body: say(lang, 'laterStayLength') } : {}), ...(transactionId ? { undoes: transactionId } : {}) };
}
/** The new length of the named clip in frames from a ripple_trim output (`by` = new − old length). */
export const trimmedFrames = (by: unknown, rate: T.Rate): number => {
  const t = by as T.RationalTime | undefined;
  return t && typeof t.value === 'string' ? framesOf(t, rate) : 0;
};

// ---------------------------------------------------------------- the time field
export type TimeMode = 'goto' | 'duration';
export interface TimeLine { kind: 'empty' | 'ok' | 'refused'; text: string; frame?: number; rounded?: boolean }
/**
 * What Enter will do for the text typed in the field, worded: «← 00:00:05:00 · פריים 150», the rounding note, or the refusal.
 * `base` is where a relative entry counts from (the playhead, or the clip's duration); `several`: more than one clip takes the
 * duration, so only a full value is meaningful; `last`: the last frame of the film (goto only).
 */
export function timeLine(lang: Lang, text: string, rate: T.Rate, mode: TimeMode, opts: { base: number; several?: boolean; last?: number }): TimeLine {
  if (!text.trim()) return { kind: 'empty', text: say(lang, 'lineEmpty') };
  const r = parseTimeEntry(text, rate, opts.base);
  if (!r.ok) return { kind: 'refused', text: (dictionaries[lang] as Record<string, string>)[`craft.time.${r.reason}`] ?? r.reason };
  if (mode === 'duration') {
    if (r.relative && opts.several) return { kind: 'refused', text: say(lang, 'lineRelativeMany') };
    if (r.frame < 1) return { kind: 'refused', text: say(lang, 'lineTooShort') };
  }
  const tc = T.toTimecode(T.frameTime(r.frame, rate), rate);
  let line = mode === 'goto' ? say(lang, 'lineGoto', { tc: ltr(tc), n: r.frame }) : say(lang, 'lineDuration', { tc: ltr(tc), n: r.frame });
  if (mode === 'goto' && opts.last !== undefined && r.frame > opts.last) line = say(lang, 'lineBeyondEnd', { n: opts.last });
  if (r.rounded) line += ` · ${say(lang, 'rounded')}`;
  return { kind: 'ok', text: line, frame: r.frame, rounded: r.rounded };
}

// ---------------------------------------------------------------- paste attributes
export interface PasteGroupRow {
  group: AttributeGroup; name: string; ok: number; skipped: number;
  /** The source has nothing in this group for any target: the box is disabled with `why`. */
  disabled: boolean; why: string | null; line: string;
}
export interface PasteView { rows: PasteGroupRow[]; plan: PastePlan | null; applied: number; skipped: number }
/** The groups with what each would do on the targets, from planPasteAttributes run per group (the commit's own routine on a copy). */
export function pasteGroupRows(doc: ProjectDocument, fromClipId: string, targets: readonly string[], lang: Lang): PasteGroupRow[] {
  return ATTRIBUTE_GROUPS.map((group) => {
    const plan = planPasteAttributes(doc, { fromClipId, toClipIds: [...targets], groups: [group] });
    const ok = plan.applied.length, skipped = plan.skipped.length;
    const why = plan.skipped.length ? skipReason(lang, plan.skipped[0]!.code, plan.skipped[0]!.message) : null;
    const disabled = ok === 0 && plan.skipped.length > 0 && plan.skipped.every((s) => s.code === 'source_empty');
    const line = ok === 0 ? say(lang, 'pasteGroupNone', { why: why ?? '' }) : skipped ? say(lang, 'pasteGroupLineSkip', { ok, skip: skipped, why: why ?? '' }) : say(lang, 'pasteGroupLine', { ok });
    return { group, name: groupName(lang, group), ok, skipped, disabled, why: disabled ? why : null, line };
  });
}
/** The plan of the ticked groups: what the dialog lists is exactly what the commit will apply and skip. */
export function pastePlanOf(doc: ProjectDocument, fromClipId: string, targets: readonly string[], ticked: readonly AttributeGroup[]): PastePlan | null {
  if (!ticked.length || !targets.length || targets.length > CRAFT_LIMITS.pasteTargets) return null;
  return planPasteAttributes(doc, { fromClipId, toClipIds: [...targets], groups: ATTRIBUTE_GROUPS.filter((g) => ticked.includes(g)) });
}
/** The targets: the selection without the source, at most 200; `leftOut` says the source was selected too. */
export function pasteTargets(selection: readonly string[], sourceId: string): { targets: string[]; leftOut: boolean } {
  const targets = selection.filter((id) => id !== sourceId);
  return { targets, leftOut: targets.length !== selection.length };
}
export const pasteOps = (fromClipId: string, targets: readonly string[], ticked: readonly AttributeGroup[]): OpCall[] =>
  [{ op: 'paste_attributes', args: { fromClipId, toClipIds: [...targets], groups: ATTRIBUTE_GROUPS.filter((g) => ticked.includes(g)) } }];
const TICKS_KEY = 'pf.craft.paste.v1';
/** Ticks remembered per browser; unavailable storage means the default (every group). */
export function readTicks(): AttributeGroup[] {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKS_KEY) ?? 'null') as unknown;
    if (Array.isArray(raw)) return ATTRIBUTE_GROUPS.filter((g) => raw.includes(g));
  } catch { /* storage unavailable or corrupt */ }
  return [...ATTRIBUTE_GROUPS];
}
export function writeTicks(t: readonly AttributeGroup[]): void { try { localStorage.setItem(TICKS_KEY, JSON.stringify(t)); } catch { /* storage unavailable */ } }

// ---------------------------------------------------------------- find and replace
export interface FindOptions { wholeWord: boolean; ignoreMarks: boolean; finalsEqual: boolean; ignoreCase: boolean; scope: 'project' | 'clips'; formats: 'all' | 'master' | 'viewed' }
/** Marks and final letters default to the owner's reading («התעלמות מניקוד» and «אותיות סופיות כרגילות» on, C4). */
export const DEFAULT_FIND: FindOptions = { wholeWord: false, ignoreMarks: true, finalsEqual: true, ignoreCase: false, scope: 'project', formats: 'all' };
export function findQueryOf(text: string, o: FindOptions, selection: readonly string[], viewVariantId: string | null): FindQuery | null {
  if (!text || text.length > CRAFT_LIMITS.findChars) return null;
  const clips = o.scope === 'clips' ? selection.slice(0, CRAFT_LIMITS.pasteTargets) : undefined;
  if (o.scope === 'clips' && !clips?.length) return null;
  if (o.formats === 'viewed' && !viewVariantId) return null;
  return { text, wholeWord: o.wholeWord, ignoreMarks: o.ignoreMarks, finalsEqual: o.finalsEqual, ignoreCase: o.ignoreCase, scope: o.scope, ...(clips ? { clipIds: [...clips] } : {}), formats: o.formats, ...(o.formats === 'viewed' && viewVariantId ? { variantId: viewVariantId } : {}) };
}
/** A row's text split into the parts before, inside and after each match, trimmed to a window around the first. */
export interface Snippet { parts: { text: string; match: boolean }[]; cutBefore: boolean; cutAfter: boolean }
export function snippetOf(text: string, ranges: readonly [number, number][], width = 48): Snippet {
  const first = ranges[0]?.[0] ?? 0;
  const from = Math.max(0, first - width), to = Math.min(text.length, (ranges[ranges.length - 1]?.[1] ?? 0) + width);
  const parts: Snippet['parts'] = [];
  let at = from;
  for (const [s, e] of ranges) {
    if (e <= from || s >= to) continue;
    if (s > at) parts.push({ text: text.slice(at, s), match: false });
    parts.push({ text: text.slice(Math.max(s, at), Math.min(e, to)), match: true });
    at = Math.min(e, to);
  }
  if (at < to) parts.push({ text: text.slice(at, to), match: false });
  return { parts, cutBefore: from > 0, cutAfter: to < text.length };
}
/** What one match becomes, for the line «after»; null when the replacement would leave the text empty. */
export function afterOf(m: TextMatch, replacement: string): { text: string; spans: [number, number][] } | null {
  const r = replaceRanges(m.text, m.ranges, replacement);
  return r.text.length ? r : null;
}
/** Whether a match touches a `{…}` live field: the matcher masks them, so it never does; kept as the row's honest flag. */
export const touchesField = (_m: TextMatch): boolean => false;
export interface FindGroup { key: string; label: string; items: number[] }
/** The result list grouped by sequence, kind and format (the order the core lists them in). */
export function groupMatches(doc: ProjectDocument, matches: readonly TextMatch[], lang: Lang): FindGroup[] {
  const out: FindGroup[] = [];
  matches.forEach((m, i) => {
    const seq = m.sequenceId ? doc.sequences[m.sequenceId]?.name ?? m.sequenceId : say(lang, 'findGroupOutside');
    const fmt = m.variantId ? doc.variants[m.variantId]?.name ?? m.variantId : null;
    const kind = say(lang, `findKind_${m.kind}` as CraftStringKey);
    const key = `${m.sequenceId ?? ''}|${m.kind}|${m.variantId ?? ''}`;
    const label = [seq, kind, ...(fmt ? [fmt] : [])].join(' · ');
    const last = out[out.length - 1];
    if (last && last.key === key) last.items.push(i); else out.push({ key, label, items: [i] });
  });
  return out;
}
export interface ReplaceNotes { lostTiming: number; approximated: number; review: number; finalMid: number }
/** Counts of the notes above «החלפת הכול» (only the true ones are shown). */
export function replaceNotes(plan: ReplacePlan): ReplaceNotes {
  const review = new Set(plan.reviewAgain);
  return {
    lostTiming: plan.lostWordTiming.length, approximated: plan.approximated.length, finalMid: plan.finalMidWord,
    review: plan.edits.filter((e) => (e.at.kind === 'override' || e.at.kind === 'variantPhrase') && review.has(e.at.variantId)).length,
  };
}
export function noteLines(lang: Lang, n: ReplaceNotes): string[] {
  return [
    ...(n.lostTiming ? [say(lang, 'noteLostTiming', { n: n.lostTiming })] : []), ...(n.approximated ? [say(lang, 'noteApproximated', { n: n.approximated })] : []),
    ...(n.review ? [say(lang, 'noteReview', { n: n.review })] : []), ...(n.finalMid ? [say(lang, 'noteFinalMid', { n: n.finalMid })] : []),
  ];
}
/** The picked indices that can be replaced: a match whose replacement would empty the text cannot. */
export function replaceablePicks(matches: readonly TextMatch[], replacement: string, picked: ReadonlySet<number>): number[] {
  return [...picked].filter((i) => i >= 0 && i < matches.length && afterOf(matches[i]!, replacement) !== null).sort((a, b) => a - b);
}
/** The plan and the ops of a replacement of the picked rows, on the document the search ran on. */
export function replacePlanOf(doc: ProjectDocument, query: FindQuery, replacement: string, picks: readonly number[]): { plan: ReplacePlan; ops: OpCall[] } | null {
  if (!picks.length) return null;
  const plan = planReplace(doc, query, replacement, picks);
  return plan.edits.length ? { plan, ops: [{ op: 'replace_text', args: { edits: plan.edits } }] } : null;
}
/** The clip a row names, for Enter's «select»: titles, captions and format wording have one; phrases do not. */
export const clipOfMatch = (m: TextMatch): string | null => (m.at.kind === 'title' || m.at.kind === 'cue' || m.at.kind === 'override' ? m.at.clipId : null);
/** Roving focus in the list: the next index for a key, or null when the key is not a list key. */
export function listKey(key: string, at: number, count: number): number | null {
  if (!count) return null;
  if (key === 'ArrowDown') return Math.min(count - 1, at + 1);
  if (key === 'ArrowUp') return Math.max(0, at - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'PageDown') return Math.min(count - 1, at + 10);
  if (key === 'PageUp') return Math.max(0, at - 10);
  return null;
}

// ---------------------------------------------------------------- versions
const NOUN: Record<DiffEntityKind, [CraftStringKey, CraftStringKey]> = {
  project: ['nounProject', 'nounProjectMany'], sequence: ['nounSequence', 'nounSequences'], track: ['nounTrack', 'nounTracks'], clip: ['nounClip', 'nounClips'], marker: ['nounMarker', 'nounMarkers'],
  variant: ['nounVariant', 'nounVariants'], recipeRun: ['nounRecipeRun', 'nounRecipeRuns'], asset: ['nounAsset', 'nounAssets'], transcript: ['nounTranscript', 'nounTranscripts'], analysis: ['nounAnalysis', 'nounAnalyses'],
  motionTrack: ['nounMotionTrack', 'nounMotionTracks'], multicam: ['nounMulticam', 'nounMulticams'], event: ['nounEvent', 'nounEvents'], person: ['nounPerson', 'nounPeople'], other: ['nounOther', 'nounOthers'],
};
const noun = (lang: Lang, kind: DiffEntityKind, n: number) => say(lang, NOUN[kind][n === 1 ? 0 : 1]);
const VERB: Record<DiffRow['change'], CraftStringKey> = { added: 'diffAdded', removed: 'diffRemoved', changed: 'diffChanged' };
/** The verb in the right gender is avoided by the neutral forms in the strings: «נוסף / נמחק / שונה» read after a noun. */
const verb = (lang: Lang, change: DiffRow['change'], plural: boolean): string => {
  if (lang === 'en') return say(lang, VERB[change]);
  return ({ added: plural ? 'נוספו' : 'נוסף', removed: plural ? 'נמחקו' : 'נמחק', changed: plural ? 'שונו' : 'שונה' } as const)[change];
};
/** «3 קליפים נוספו · 2 נמחקו · 5 שונו»: counts first, by kind where the rows are complete, else the totals. */
export function diffSentence(lang: Lang, diff: DiffSummary): string {
  const parts: string[] = [];
  for (const change of ['added', 'removed', 'changed'] as const) {
    const total = diff.counts[change];
    if (!total) continue;
    const rows = diff.rows.filter((r) => r.change === change);
    if (diff.more === 0 && rows.length === total) {
      const kinds = new Map<DiffEntityKind, number>();
      for (const r of rows) kinds.set(r.entity, (kinds.get(r.entity) ?? 0) + 1);
      const said = [...kinds].map(([k, n]) => `${n === 1 ? '' : `${n} `}${noun(lang, k, n)}`.trim());
      parts.push(`${said.join(lang === 'he' ? ', ' : ', ')} ${verb(lang, change, total > 1 || kinds.size > 1)}`);
    } else parts.push(`${total} ${verb(lang, change, total > 1)}`);
  }
  return parts.join(' · ');
}
/** One row of «מה השתנה»: the kind and the name, then what happened to it. */
export function diffRowSentence(lang: Lang, r: DiffRow): string {
  const name = r.name ? `«${r.name}»` : '';
  return `${noun(lang, r.entity, 1)} ${name} ${verb(lang, r.change, false)}`.replace(/\s+/g, ' ').trim();
}
export const restoresRows = (d: DiffSummary): { restored: DiffRow[]; kept: DiffRow[] } => ({ restored: d.rows.filter((r) => r.restores), kept: d.rows.filter((r) => !r.restores) });
/** Regions the restore removes or changes: above 0 the second confirmation is needed. */
export const privacyAtStake = (d: DiffSummary): number => d.privacy.removed + d.privacy.changed;
/** «גרסה 4 · 25.11 14:32»: the next number after the largest «גרסה N» already used (else the count + 1), and the time. */
export function defaultVersionName(lang: Lang, existing: readonly string[], now: Date): string {
  let max = 0;
  for (const n of existing) { const m = /^(?:גרסה|Version) (\d+)/.exec(n); if (m) max = Math.max(max, Number(m[1])); }
  const n = Math.max(max, existing.length) + 1;
  const p = (x: number) => String(x).padStart(2, '0');
  return `${say(lang, 'saveDefault', { n })} · ${p(now.getDate())}.${p(now.getMonth() + 1)} ${p(now.getHours())}:${p(now.getMinutes())}`;
}
/** Whether a name can be saved (the server trims; 1–80 characters). */
export function nameProblem(lang: Lang, name: string): string | null {
  const t = name.trim();
  if (!t) return say(lang, 'saveEmpty');
  if (t.length > CRAFT_LIMITS.versionName) return say(lang, 'saveTooLong');
  return null;
}
export const sizeText = (bytes: number): string => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
export function versionMeta(lang: Lang, v: VersionInfo): string {
  const when = new Date(v.createdAt).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
  const who = v.actor === 'user:local' ? (lang === 'he' ? 'אני' : 'me') : v.actor;
  return say(lang, 'versionMeta', { when, who, frames: v.frames, size: sizeText(v.bytes) });
}
/** The frame a comparison shows, kept inside what both sides hold: a side without that frame is named, never drawn blank. */
export function frameState(index: number, aFrames: number, bFrames: number): 'ok' | 'a' | 'b' | 'both' {
  const a = index >= aFrames, b = index >= bFrames;
  return a && b ? 'both' : a ? 'a' : b ? 'b' : 'ok';
}
export const stepFrame = (index: number, by: number, last: number): number => Math.max(0, Math.min(last, index + by));
/** The still of the project as it is now (for «המצב הנוכחי»). */
export const currentFrameUrl = (projectId: string, index: number, revision: number): string => `/api/v1/projects/${encodeURIComponent(projectId)}/frame?index=${index}&rev=${revision}`;

// ---------------------------------------------------------------- IO shared by the surfaces
/** A picture read with its refusal: an object URL, or the refusal in words (a 403 privacy answer, a frame past the end). */
export async function loadStill(url: string, lang: Lang, signal?: AbortSignal): Promise<{ ok: true; url: string } | { ok: false; code: string | null; message: string }> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', ...(signal ? { signal } : {}) });
    if (r.ok) return { ok: true, url: URL.createObjectURL(await r.blob()) };
    const data = r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => undefined) as { error?: { code?: string; message?: string; hint?: string } } | undefined : undefined;
    const f = craftFailure(lang, new ApiFailure(r.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `HTTP ${r.status}`, undefined, data?.error?.hint));
    return { ok: false, code: f.code, message: f.message };
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') throw e;
    return { ok: false, code: null, message: say(lang, 'stillFailed') };
  }
}
/** The clip's start frame, for the rows of the clip's time block. */
export const clipStartFrame = (doc: ProjectDocument, clipId: string): number | null => { const f = findClip(doc, clipId); return f ? T.frameIndexAt(f.clip.start, doc.settings.frameRate) : null; };
export const clipEndTime = (doc: ProjectDocument, clipId: string): T.RationalTime | null => { const f = findClip(doc, clipId); return f ? clipEnd(f.clip) : null; };

/**
 * The two answers the shared api client (api.ts) types as the thing itself while the server wraps it: POST …/versions answers
 * `{version}` and GET …/diff answers `{diff}` (craft-w2-report.md). Unwrapped here, in either shape, until the client's types say so.
 */
export const craftApi = {
  async saveVersion(projectId: string, name: string): Promise<VersionInfo> { const r = (await api.saveVersion(projectId, name)) as unknown as { version?: VersionInfo } & VersionInfo; return r.version ?? r; },
  async versionDiff(projectId: string, versionId: string, against: string): Promise<DiffSummary> { const r = (await api.versionDiff(projectId, versionId, against)) as unknown as { diff?: DiffSummary } & DiffSummary; return r.diff ?? r; },
};
