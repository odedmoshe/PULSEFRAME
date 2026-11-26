/**
 * Pure helpers of the pearls surfaces (wave 7 pearls track). Builder C owns this file. Rule C18: every surface reads
 * `state.rawDoc` (the whole document, never `state.doc`, which is the active sequence projected alone) and `state.activeSequenceId`,
 * through ONE memoised usage per document object, shared by the list, the strip and the table. Core rangeUsage / screenTime
 * (builder A) throw SourceRangesNotBuilt until built; callers show the not-built state then, never a made-up number.
 *
 * No DOM and no editor here, so everything below is tested against small local fixtures of the contract's shapes
 * (pearls.logic.test.ts). Times stay exact rationals; seconds appear only as display numbers.
 */
import * as T from '@pulseframe/time';
import {
  MAX_RANGE_LABEL, PEARL_SHORT_LIMITS, SourceRangesNotBuilt, bareWord, rangeUsage, screenTime,
  type OpCall, type PearlRow, type PearlsView, type ProjectDocument, type ScreenTime, type SourceRange, type SourceSpan, type UsageResult,
} from '@pulseframe/core';

// ---------- the memoised usage and screen time (C18) ----------
const memo = new WeakMap<ProjectDocument, UsageResult>();
/** Usage of the whole document, memoised per document object. Throws until core usage is built. */
export function usageOf(rawDoc: ProjectDocument): UsageResult {
  let u = memo.get(rawDoc);
  if (!u) { u = rangeUsage(rawDoc); memo.set(rawDoc, u); }
  return u;
}
const screenMemo = new WeakMap<ProjectDocument, Map<string, ScreenTime>>();
/** Screen time of one sequence of the whole document, memoised per document object and sequence. Throws until core screenTime is built. */
export function screenTimeOf(rawDoc: ProjectDocument, sequenceId: string): ScreenTime {
  let by = screenMemo.get(rawDoc);
  if (!by) { by = new Map(); screenMemo.set(rawDoc, by); }
  let s = by.get(sequenceId);
  if (!s) { s = screenTime(rawDoc, sequenceId); by.set(sequenceId, s); }
  return s;
}
/** True for what core throws before builder A's bodies are merged. */
export const isNotBuilt = (e: unknown): boolean => e instanceof SourceRangesNotBuilt;

// ---------- reading the document's ranges ----------
const NONE: Readonly<Record<string, SourceRange>> = Object.freeze({});
/** Own-property lookups only: a range or person id may be "constructor". */
export const rangeMap = (doc: Pick<ProjectDocument, 'sourceRanges'>): Readonly<Record<string, SourceRange>> => doc.sourceRanges ?? NONE;
export const rangeById = (doc: Pick<ProjectDocument, 'sourceRanges'>, id: string): SourceRange | null => (Object.hasOwn(rangeMap(doc), id) ? rangeMap(doc)[id]! : null);
export const rangesOfAsset = (doc: Pick<ProjectDocument, 'sourceRanges'>, assetId: string): SourceRange[] => Object.values(rangeMap(doc)).filter((r) => r.assetId === assetId);
/** The one «מי בקליפ?» range of a file (kind presence), if any. */
export const presenceOf = (doc: Pick<ProjectDocument, 'sourceRanges'>, assetId: string): SourceRange | null => rangesOfAsset(doc, assetId).find((r) => r.kind === 'presence') ?? null;
/** Saved pearls of a file that mark a stretch (span not null), in source order: the strip and the film's choice read these. */
export const spanPearlsOf = (doc: Pick<ProjectDocument, 'sourceRanges'>, assetId: string): SourceRange[] =>
  rangesOfAsset(doc, assetId).filter((r) => r.kind === 'pearl' && r.span !== null).sort((a, b) => T.cmp(a.span!.start, b.span!.start) || T.cmp(a.span!.end, b.span!.end) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
/** True when any of these files has a pearl the film can read (a pearl with a span). */
export const anyFilmPearl = (doc: Pick<ProjectDocument, 'sourceRanges'>, assetIds: readonly string[]): boolean => assetIds.some((id) => spanPearlsOf(doc, id).length > 0);

// ---------- the list: search, filters ----------
/** A query or label compared without vowel points, punctuation or case (core bareWord per token). */
export const queryTokens = (s: string): string[] => s.split(/\s+/).map(bareWord).filter(Boolean);
export type PearlFilter = 'all' | 'unused';
export interface PearlQuery { text: string; filter: PearlFilter; personId: string | null }
/** The rows the list shows: search over the label, the file name and the tagged names (every token must be found), the unused filter, one person. Order is the route's. */
export function visibleRows(rows: readonly PearlRow[], unused: readonly string[], q: PearlQuery): PearlRow[] {
  const toks = queryTokens(q.text), none = new Set(unused);
  return rows.filter((r) => {
    if (q.filter === 'unused' && !none.has(r.id)) return false;
    if (q.personId !== null && !r.people.some((p) => p.id === q.personId)) return false;
    if (!toks.length) return true;
    const hay = [r.label, r.assetName, ...r.people.map((p) => p.name)].map(bareWord).join(' ');
    return toks.every((tk) => hay.includes(tk));
  });
}
/** The people of the project that appear on some row, in the order of first appearance: the person chips of the filter. */
export function personChips(rows: readonly PearlRow[]): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const r of rows) for (const p of r.people) if (!seen.has(p.id)) seen.set(p.id, p.name);
  return [...seen].map(([id, name]) => ({ id, name }));
}

// ---------- numbers shown ----------
const r1 = (x: number): string => { const v = Math.round(x * 10) / 10; return String(Object.is(v, -0) ? 0 : v); };
/** Seconds with one decimal for display. */
export const secondsText = (x: number): string => r1(x);
const spanSeconds = (s: SourceSpan): number => T.toSeconds(T.sub(s.end, s.start));
/** Length of a row's stretch in seconds (display only); null for a whole-file pearl. */
export const rowSeconds = (r: Pick<PearlRow, 'span'>): number | null => (r.span ? spanSeconds(r.span) : null);
/** Seconds of the row's source that are used (merged stretches), display only. */
export const usedSeconds = (r: Pick<PearlRow, 'usage'>): number => r.usage.usedSource.reduce((a, s) => a + spanSeconds(s), 0);
/** «בשימוש: 4.0 מתוך 6.2 שניות» numbers; unused rows have none. */
export function usageNumbers(r: Pick<PearlRow, 'span' | 'usage'>, wholeSeconds?: number): { used: string; total: string } | null {
  const total = rowSeconds(r) ?? wholeSeconds ?? null;
  if (total === null || r.usage.usedSource.length === 0) return null;
  return { used: r1(Math.min(usedSeconds(r), total)), total: r1(total) };
}

// ---------- «שורט מהפנינה» (decisions C17) ----------
export type ShortBlock = 'too_short' | 'too_long' | 'no_picture' | 'whole_file';
/** Why the action is off for a pearl: a pearl needs a span of 3–180 s on a file with video. null = allowed. */
export function shortBlock(r: Pick<PearlRow, 'span' | 'kind'>, hasVideo: boolean): ShortBlock | null {
  if (!hasVideo) return 'no_picture';
  if (!r.span) return 'whole_file';
  const s = spanSeconds(r.span);
  return s < PEARL_SHORT_LIMITS.minSeconds ? 'too_short' : s > PEARL_SHORT_LIMITS.maxSeconds ? 'too_long' : null;
}
/** The short's name: the label cut to 128; none when the pearl has no name (the build then names it itself). */
export const shortName = (label: string): string | undefined => { const n = label.trim().slice(0, PEARL_SHORT_LIMITS.nameChars); return n ? n : undefined; };
/** The body of POST …/shorts for one pearl: one pick, the source stretch, words snapping by default (no title, no captions of its own). */
export function shortBody(r: Pick<PearlRow, 'assetId' | 'label' | 'span'>): { picks: { assetId: string; start: T.RationalTime; end: T.RationalTime; name?: string }[] } | null {
  if (!r.span) return null;
  const name = shortName(r.label);
  return { picks: [{ assetId: r.assetId, start: r.span.start, end: r.span.end, ...(name ? { name } : {}) }] };
}

// ---------- the viewer: marking ----------
/**
 * The stretch the form saves: whole frames of the project's rate from the in point to the (exclusive) out point, the end cut to the
 * file's duration so a last partial frame never makes the range refuse; null = the whole file (nothing marked, or a photo).
 */
export function spanOfMarks(p: { inFrame: number; outFrame: number | null; rate: T.Rate; duration: T.RationalTime; isImage: boolean }): SourceSpan | null {
  if (p.isImage || (p.inFrame === 0 && p.outFrame === null)) return null;
  const start = T.frameTime(p.inFrame, p.rate);
  const rawEnd = p.outFrame === null ? p.duration : T.frameTime(p.outFrame, p.rate);
  const end = T.min(rawEnd, p.duration);
  return T.lt(start, end) ? { start, end } : null;
}
/** One add_source_range for the marks. `people` only when chosen; `label` only when typed (trimmed, one line, cut to MAX_RANGE_LABEL). */
export function addPearlOp(assetId: string, span: SourceSpan | null, label: string, people: readonly string[]): OpCall {
  const name = oneLine(label);
  return { op: 'add_source_range', args: { assetId, kind: 'pearl', ...(span ? { start: span.start, end: span.end } : {}), ...(name ? { label: name } : {}), ...(people.length ? { people: [...people].sort() } : {}) } };
}
/** A typed name as one line: line breaks become spaces, ends trimmed, cut to the limit. */
export const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_RANGE_LABEL);

/** The pearl of transcript words: first word's start to last word's end, exactly; the label is the words joined by spaces. */
export function pearlOfWords(assetId: string, words: readonly { text: string; start: T.RationalTime; duration: T.RationalTime }[]): { span: SourceSpan; label: string } | null {
  if (!words.length) return null;
  const first = words[0]!, last = words[words.length - 1]!;
  return { span: { start: first.start, end: T.add(last.start, last.duration) }, label: oneLine(words.map((w) => w.text).join(' ')) };
}

// ---------- the viewer strip: saved pearls and used stretches ----------
export interface StripSegment { kind: 'pearl' | 'used'; fromPercent: number; widthPercent: number }
/** Position of exact spans on the file's length, for drawing only: percentages of the duration, a hairline never thinner than 0.5 %. */
export function stripSegments(duration: T.RationalTime, pearls: readonly SourceSpan[], used: readonly SourceSpan[]): StripSegment[] {
  const total = T.toSeconds(duration);
  if (!(total > 0)) return [];
  const seg = (kind: StripSegment['kind'], s: SourceSpan): StripSegment => {
    const a = Math.max(0, Math.min(100, (T.toSeconds(s.start) / total) * 100)), b = Math.max(a, Math.min(100, (T.toSeconds(s.end) / total) * 100));
    return { kind, fromPercent: a, widthPercent: Math.max(0.5, b - a) };
  };
  return [...used.map((s) => seg('used', s)), ...pearls.map((s) => seg('pearl', s))];
}

// ---------- «מי בקליפ?» ----------
/** The single operation that saves the people of a file's presence tag: add, update or remove; null when nothing changes. */
export function presenceOp(doc: Pick<ProjectDocument, 'sourceRanges'>, assetId: string, chosen: readonly string[]): OpCall | null {
  const have = presenceOf(doc, assetId);
  const want = [...new Set(chosen)].sort();
  if (!have) return want.length ? { op: 'add_source_range', args: { assetId, kind: 'presence', people: want } } : null;
  if (!want.length) return { op: 'remove_source_range', args: { rangeId: have.id } };
  const same = (have.people ?? []).length === want.length && (have.people ?? []).every((p, i) => p === want[i]);
  return same ? null : { op: 'update_source_range', args: { rangeId: have.id, people: want } };
}

// ---------- the view of the route ----------
export type ListState = 'empty' | 'list' | 'not-built' | 'refused';
/** What the list says for the route's answer: a 501 `pearls_not_built` is an honest setup state; any other refusal is shown in words. */
export function listState(view: PearlsView | null, failure: { status: number; code: string } | null): ListState {
  if (failure) return failure.code === 'pearls_not_built' || failure.status === 501 ? 'not-built' : 'refused';
  if (!view) return 'empty';
  return view.ranges.length === 0 ? 'empty' : 'list';
}

// ---------- screen time (the table) ----------
export interface ScreenRow { personId: string; name: string; frames: number; seconds: number; percent: number }
/** The table of «מי כמה בסרט»: one row per tagged person, then the untagged remainder. Percent of the picture time, whole numbers, never a verdict. */
export function screenRows(st: ScreenTime, nameOf: (personId: string) => string): { rows: ScreenRow[]; untagged: { frames: number; seconds: number; percent: number }; mostlyUntagged: boolean; pictureSeconds: number } {
  const secs = (f: number) => (f * st.rate.den) / st.rate.num;
  const pct = (f: number) => (st.pictureFrames > 0 ? Math.round((f / st.pictureFrames) * 100) : 0);
  return {
    rows: st.people.map((p) => ({ personId: p.personId, name: nameOf(p.personId), frames: p.frames, seconds: secs(p.frames), percent: pct(p.frames) })),
    untagged: { frames: st.untaggedFrames, seconds: secs(st.untaggedFrames), percent: pct(st.untaggedFrames) },
    mostlyUntagged: st.pictureFrames > 0 && st.untaggedFrames * 2 > st.pictureFrames,
    pictureSeconds: secs(st.pictureFrames),
  };
}

/** Ranges of kind pearl tagged with this person that have no use (usage.unused order): the count behind «פנינים שלא בשימוש של …». */
export function unusedPearlsOfPerson(doc: Pick<ProjectDocument, 'sourceRanges'>, unused: readonly string[], personId: string): string[] {
  return unused.filter((id) => { const r = rangeById(doc, id); return !!r && r.kind === 'pearl' && !!r.people?.includes(personId); });
}
