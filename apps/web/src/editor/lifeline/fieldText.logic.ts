/**
 * What the field menu and the readable text box of a title decide (ADR-0021; plan §7), kept apart from the components so it
 * can be tested without a browser: the menu's items and the value each shows at the playhead, insertion at the caret (existing
 * braces doubled, the token added, live fields switched on: one transaction), the readable form of the text box (core
 * fieldsToDisplay / fieldsFromDisplay) with the reason a typed group is refused, the live line and the fix for each missing
 * reason, and "make it plain text" (core freezeOps, committed only when nothing is missing and nothing is too long).
 */
import * as T from '@pulseframe/time';
import {
  AGE_FORMATS, DATE_FORMATS, HEBREW_DATE_FORMATS, escapeFieldText, fieldsFromDisplay, fieldsToDisplay, freezeOps, isPersonToken, makeFieldIndex, parseFields, peopleOf, resolveFields,
  type FieldIndex, type MissingReason, type OpCall, type Person, type ProjectDocument, type TextClip,
} from '@pulseframe/core';

type Lang = 'he' | 'en';

// ---------------------------------------------------------------- the menu
export type FieldGroupId = 'date' | 'hebrewDate' | 'year' | 'event' | 'age' | 'name';
export interface FieldItem { /** the stored token, e.g. `{date:numeric}` */ token: string; group: FieldGroupId; /** key of the wording, see fieldItemWords */ words: { base: string; format: string | null } }
/** The date formats in the order the menu offers them (core's own list; the first is the default and is written without a suffix). */
const DATE_TOKENS = DATE_FORMATS.map((f) => (f === 'long' ? '{date}' : `{date:${f}}`));
const HEBREW_TOKENS = HEBREW_DATE_FORMATS.map((f) => (f === 'full' ? '{hebrewDate}' : `{hebrewDate:${f}}`));
export const FIXED_FIELD_TOKENS: readonly string[] = [...DATE_TOKENS, ...HEBREW_TOKENS, '{year}', '{hebrewYear}', '{event}'];
const FORMAT_OF: Record<string, string> = { '{date}': 'long', '{date:numeric}': 'numeric', '{date:monthYear}': 'monthYear', '{date:long-en}': 'english', '{date:monthYear-en}': 'monthYearEnglish', '{hebrewDate}': 'long', '{hebrewDate:noYear}': 'noYear' };
const BASE_OF = (token: string): string => (token.startsWith('{date') ? 'fieldDate' : token.startsWith('{hebrewDate') ? 'fieldHebrewDate' : token === '{year}' ? 'fieldYear' : token === '{hebrewYear}' ? 'fieldHebrewYear' : 'fieldEvent');
/** The fixed items of the menu (people are added from the project's own people). */
export function fixedItems(): FieldItem[] {
  return FIXED_FIELD_TOKENS.map((token) => ({ token, group: token.startsWith('{date') ? 'date' : token.startsWith('{hebrewDate') ? 'hebrewDate' : token === '{year}' ? 'year' : token === '{hebrewYear}' ? 'year' : 'event', words: { base: BASE_OF(token), format: token === '{date}' || token === '{hebrewDate}' ? null : FORMAT_OF[token] ?? null } }));
}
export interface PersonItem { token: string; kind: 'age' | 'ageWords' | 'name'; person: Person }
/** One item per person and kind: the age in digits, the age in words, the name. */
export function personItems(doc: ProjectDocument): PersonItem[] {
  return Object.values(peopleOf(doc)).flatMap((p): PersonItem[] => [
    { token: `{age:${p.id}}`, kind: 'age', person: p }, { token: `{age:${p.id}:${AGE_FORMATS[1]}}`, kind: 'ageWords', person: p }, { token: `{name:${p.id}}`, kind: 'name', person: p },
  ]);
}

// ---------------------------------------------------------------- values at the playhead
/** One index per committed document: the resolver then answers the menu's many items from memory. */
const indexes = new WeakMap<ProjectDocument, FieldIndex>();
const indexOf = (doc: ProjectDocument): FieldIndex => { let ix = indexes.get(doc); if (!ix) { ix = makeFieldIndex(doc); indexes.set(doc, ix); } return ix; };
export type FieldValue = { words: string } | { missing: MissingReason };
/**
 * What `token` would show in the title `clip` at `time`: the words, or why there are none (a field has no data). The title
 * itself is not changed: the token is resolved on a copy that has the same place on the timeline.
 */
export function valueAt(doc: ProjectDocument, sequenceId: string, clip: TextClip, time: T.RationalTime, token: string): FieldValue {
  try {
    const r = resolveFields(doc, sequenceId, { ...clip, text: token, fields: true }, time, { index: indexOf(doc) });
    return r.missing[0] ? { missing: r.missing[0].reason } : { words: r.text };
  } catch { return { missing: 'no_date' }; }
}
/** The playhead clamped into the title's own span (the live line and the menu answer for the title where it is shown). */
export function timeInTitle(clip: Pick<TextClip, 'start' | 'duration'>, playhead: T.RationalTime): T.RationalTime {
  if (T.lt(playhead, clip.start)) return clip.start;
  const end = T.add(clip.start, clip.duration);
  return T.lt(playhead, end) ? playhead : clip.start;
}

// ---------------------------------------------------------------- insertion at the caret
export interface Inserted { text: string; /** where the caret goes: just after the new field, in the text as the box shows it */ caret: number; enable: boolean }
export type InsertResult = { ok: true; value: Inserted } | { ok: false; problems: { token: string; reason: string }[] };
const clamp = (caret: number | null, len: number): number => (caret === null || !Number.isFinite(caret) ? len : Math.max(0, Math.min(len, Math.floor(caret))));
/**
 * Insert the stored `token` into the text of a title at `caret` (null = the end). `shown` is the text as the box shows it: for
 * a title without live fields the text itself, for one with fields its readable form. The answer is the STORED text:
 * - without fields, every existing brace is doubled (so the words stay exactly what they were) and the token is added; live
 *   fields are then switched on (`enable`), in the same transaction;
 * - with fields, the readable form gets the readable token and the whole is read back (core fieldsFromDisplay), so what was
 *   typed is checked on the way.
 */
export function insertField(o: { lang: Lang; doc: ProjectDocument; shown: string; caret: number | null; fieldsOn: boolean; token: string }): InsertResult {
  const at = clamp(o.caret, o.shown.length);
  if (!o.fieldsOn) {
    const head = escapeFieldText(o.shown.slice(0, at)), tail = escapeFieldText(o.shown.slice(at));
    return { ok: true, value: { text: head + o.token + tail, caret: head.length + o.token.length, enable: true } };
  }
  const readable = fieldsToDisplay(o.lang, o.token, o.doc);
  const next = o.shown.slice(0, at) + readable + o.shown.slice(at);
  const back = fieldsFromDisplay(o.lang, next, o.doc);
  return back.ok ? { ok: true, value: { text: back.text, caret: at + readable.length, enable: false } } : { ok: false, problems: back.problems };
}
/** The operations of an insertion: one update_text, and set_text_fields enabled:true when the title had no fields yet. */
export function insertOps(clipId: string, v: Inserted): OpCall[] {
  return [{ op: 'update_text', args: { clipId, text: v.text } }, ...(v.enable ? [{ op: 'set_text_fields', args: { clipId, enabled: true } }] : [])];
}

// ---------------------------------------------------------------- the readable text box
/** What the text box shows: the readable form for a title with fields, the text itself otherwise. */
export const boxText = (lang: Lang, doc: ProjectDocument, clip: Pick<TextClip, 'text' | 'fields'>): string => (clip.fields ? fieldsToDisplay(lang, clip.text, doc) : clip.text);
export type BoxCommit = { kind: 'none' } | { kind: 'ops'; ops: OpCall[] } | { kind: 'error'; problems: { token: string; reason: string }[] };
/** The edit a typed box makes: nothing when the stored text is unchanged, the update_text, or the groups that are not fields. An empty text is left as it was. */
export function commitBox(lang: Lang, doc: ProjectDocument, clip: Pick<TextClip, 'id' | 'text' | 'fields'>, typed: string): BoxCommit {
  if (!typed) return { kind: 'none' };
  if (!clip.fields) return typed === clip.text ? { kind: 'none' } : { kind: 'ops', ops: [{ op: 'update_text', args: { clipId: clip.id, text: typed } }] };
  const back = fieldsFromDisplay(lang, typed, doc);
  if (!back.ok) return { kind: 'error', problems: back.problems };
  return back.text === clip.text ? { kind: 'none' } : { kind: 'ops', ops: [{ op: 'update_text', args: { clipId: clip.id, text: back.text } }] };
}
/** Does the stored text hold at least one field token? (A title with live fields on and none left is still on; that is allowed.) */
export const holdsFields = (text: string): boolean => parseFields(text).some((p) => 'token' in p);
export const holdsPeopleFields = (text: string): boolean => parseFields(text).some((p) => 'token' in p && isPersonToken(p.token));

// ---------------------------------------------------------------- the live line and its fix
export type FixKind = 'set_date' | 'choose_event' | 'people' | 'rewrite';
/** What to offer for a field without data: the button's kind, by reason. */
export const fixFor = (reason: MissingReason): FixKind => (reason === 'no_date' ? 'set_date' : reason === 'sunset_undecided' || reason === 'no_event_name' ? 'choose_event' : reason === 'unknown_age_format' ? 'rewrite' : 'people');
export interface LiveModel { text: string; problems: { token: string; reason: MissingReason; fix: FixKind }[]; anchorAssetId: string | null; eventId: string | null }
/** The words the title shows at `time`, and for each field without data its reason and fix. For a title without fields: its text, no problems. */
export function liveModel(doc: ProjectDocument, sequenceId: string, clip: TextClip, time: T.RationalTime): LiveModel {
  try {
    const r = resolveFields(doc, sequenceId, clip, time, { index: indexOf(doc) });
    return { text: r.text, problems: r.missing.map((m) => ({ token: m.token, reason: m.reason, fix: fixFor(m.reason) })), anchorAssetId: r.anchor?.assetId ?? null, eventId: r.eventId };
  } catch { return { text: clip.text, problems: [{ token: '', reason: 'no_date', fix: 'set_date' }], anchorAssetId: null, eventId: null }; }
}
/** The picture clips under a title at `time` in the main sequence, topmost first: the file a «קביעת תאריך» fix is about when the resolver found no dated one. */
export function pictureUnder(doc: ProjectDocument, sequenceId: string, time: T.RationalTime): string | null {
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  if (!seq) return null;
  for (const track of [...seq.tracks].reverse()) {
    if (track.kind !== 'video') continue;
    for (const c of track.clips) if (c.type === 'media' && T.lte(c.start, time) && T.lt(time, T.add(c.start, c.duration)) && Object.hasOwn(doc.assets, c.assetId)) return c.assetId;
  }
  return null;
}

// ---------------------------------------------------------------- "make it plain text"
export interface FreezeModel { ops: OpCall[]; varies: boolean; missing: { variantId: string | null; token: string; reason: MissingReason }[]; tooLong: (string | null)[]; /** commit `ops`: nothing is missing and nothing is too long */ ready: boolean }
/** The operations core freezeOps returns, and whether they may be committed (only when no field lacks data and nothing passes 2000 characters). */
export function freezeModel(doc: ProjectDocument, sequenceId: string, clip: TextClip, at: T.RationalTime): FreezeModel | null {
  try {
    const f = freezeOps(doc, sequenceId, clip.id, at, { index: indexOf(doc) });
    return { ...f, ready: f.missing.length === 0 && f.tooLong.length === 0 };
  } catch { return null; }
}
