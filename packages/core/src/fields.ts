/**
 * Live fields of titles and the capture-sourced date stamp (life line, ADR-0021). A title with `fields: true` holds tokens
 * such as `{date}` or `{hebrewDate:noYear}` in its text; the evaluator replaces them with words taken from the capture date
 * of the picture under the title, so preview, stills and export agree by construction (ADR-0005). Pure functions of the
 * document and exact time: no Intl, no Date.
 *
 * The grammar, types and signatures are the lead's contract; the bodies are W1's (wave 5).
 *
 * GRAMMAR (stored inside TextClip.text and a format's wording, only when `fields` is set):
 *   {date} = {date:long} «15 במרץ 2024» · {date:numeric} «15.3.2024» · {date:monthYear} «מרץ 2024» · {date:long-en} ·
 *   {date:monthYear-en} · {hebrewDate} = {hebrewDate:full} «כ״ה בכסלו תשפ״ה» · {hebrewDate:noYear} · {year} · {hebrewYear} ·
 *   {event}. `{{` and `}}` are literal braces. serialiseToken writes the short form for a default format.
 *   People (ADR-0021, people section; approved by the owner): {name:<personId>} · {age:<personId>} = {age:<personId>:digits}
 *   «בת 3» · {age:<personId>:words} «בת שלוש» · {age:<personId>:en} "3 years old", with personId = [A-Za-z0-9_-]{1,64}
 *   (AGE_FORMATS). They resolve through a PeopleSource: the caller's, or the document's own people (documentPeople). A
 *   person who is not in the document, or has no birth date, gives no words.
 *   Stored grammar vs. new edits: an {age:<id>:<format>} with any format [a-z-]{1,16} is a field, as it was before
 *   AGE_FORMATS existed (159a301), so documents and op logs written then still validate and replay. A format outside
 *   AGE_FORMATS (isUnknownAgeFormat) draws no words (reason unknown_age_format, which the export preflight reports as
 *   field_no_data) and is refused only where an edit brings it in as a new field: set_text_fields enabled:true (notFields)
 *   and the editor form (fieldsFromDisplay, unknown_format). update_text never checked fields and still does not.
 *
 * RULES (plan §4.5, with the verifier's corrections, which win):
 * - Anchor of a title at time t (same sequence, picture clips on visible video tracks BELOW the title's track):
 *   1. among those that contain t, the topmost DATED one (an undated sticker over a dated video still works);
 *      if picture clips lie there and none is dated → no anchor, reason no_date;
 *   2. only when NO picture clip lies under the title at t (a title card over black): the dated clip with the earliest start
 *      at or after the title's start, read at its first frame; else
 *   3. the dated clip with the latest end at or before t, read at its last frame; else no data. (The contract text said
 *      "before the title"; for a closing card that is the same clip. It differs only for a title that outlasts the clip
 *      under it: there the title keeps that clip's last date instead of jumping to an older clip's, or to nothing.)
 * - Capture moment = capture.at + inherited offset (capture.ts captureOf) + ⌊source seconds at t⌋ (speed.ts pictureSourceAt,
 *   so speed, reverse, freeze and trims are honoured; whole seconds by T.frameIndexAt(sourceTime, { num: 1, den: 1 })). A
 *   day-only date does not tick.
 * - A field without data resolves to the empty string and is listed in `missing`. Nothing is ever substituted. A Hebrew
 *   field resolves while the day is unsure only if both readings give the same string.
 * - Resolved values are inserted once and never parsed again (an event named "{date}" stays those characters).
 * - resolveFields and stampText never throw on a schema-valid document; ids are looked up with Object.hasOwn; every read of
 *   the events uses `doc.events ?? {}`.
 * - No per-document cache inside anything operations or validation call (the draft changes between the operations of one
 *   transaction). makeFieldIndex is the one place a caller that only sees committed documents may keep work.
 * - Format wordings: a format replaces the title's text before evaluation and hides clips per format (variants.ts), so a
 *   format is resolved on projectVariant(doc, variantId).
 */
import * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Capture, Clip, LifeEvent, MediaClip, ProjectDocument, TextClip } from './schema.ts';
import { projectVariant } from './variants.ts';
import { pictureSourceAt } from './speed.ts';
import { addWallSeconds, captureOf, hebrewDayReadings, parseWall } from './capture.ts';
import { eventDisplayName, eventForCapture } from './events.ts';
import { formatHebrewDate, GREGORIAN_MONTH_NAMES, hebrewFromRd, hebrewNumeral } from './hebrewCalendar.ts';

export const FIELD_NAMES = ['date', 'hebrewDate', 'year', 'hebrewYear', 'event'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];
/** Fields that name a person (ADR-0021, people section). */
export const PERSON_FIELD_NAMES = ['age', 'name'] as const;
/** The formats of {age:<id>:<format>}; the first is the default and is not written. {name:<id>} has none. */
export const AGE_FORMATS = ['digits', 'words', 'en'] as const;
export type AgeFormat = (typeof AGE_FORMATS)[number];
export const DATE_FORMATS = ['long', 'numeric', 'monthYear', 'long-en', 'monthYear-en'] as const;
export const HEBREW_DATE_FORMATS = ['full', 'noYear'] as const;
/** The shape of a person id and of a people-field format inside a token. */
export const PERSON_ID_IN_FIELD = /^[A-Za-z0-9_-]{1,64}$/;
export const PERSON_FORMAT_IN_FIELD = /^[a-z-]{1,16}$/;
/**
 * A field that names a person; `format` null = the default of that field. For {age:…} it is one of AGE_FORMATS, or, in a
 * document stored before AGE_FORMATS existed, another [a-z-]{1,16} word (isUnknownAgeFormat); {name:…} has none.
 */
export interface PersonFieldToken { name: (typeof PERSON_FIELD_NAMES)[number]; personId: string; format: string | null }
export type FieldToken =
  | { name: 'date'; format: (typeof DATE_FORMATS)[number] }
  | { name: 'hebrewDate'; format: (typeof HEBREW_DATE_FORMATS)[number] }
  | { name: 'year' } | { name: 'hebrewYear' } | { name: 'event' }
  | PersonFieldToken;
/** Why a brace group is not a field: a name that is none of the fields, a format that field does not have, or a brace without its pair. */
export type BadFieldReason = 'unknown_field' | 'unknown_format' | 'lone_brace';
/** One stretch of a title's text: plain characters (escapes already undone), a field, or a brace group that is not a field (`bad` is the group as written). */
export type FieldPart = { literal: string } | { token: FieldToken; raw: string } | { bad: string; reason: BadFieldReason };
/** A title's text cut at its braces: plain characters (escapes undone), a brace group as written with what is inside it, or a brace without its pair. */
type Scanned = { literal: string } | { group: string; content: string } | { lone: string };
function scanBraces(text: string): Scanned[] {
  const out: Scanned[] = [];
  let literal = '';
  const flush = () => { if (literal) { out.push({ literal }); literal = ''; } };
  for (let i = 0; i < text.length;) {
    const ch = text[i]!;
    if (ch !== '{' && ch !== '}') { literal += ch; i++; continue; }
    if (text[i + 1] === ch) { literal += ch; i += 2; continue; } // {{ and }} are the braces themselves
    if (ch === '{') {
      // a group runs to the next closing brace on the same line, with no other opening brace on the way
      let j = i + 1;
      while (j < text.length && text[j] !== '}' && text[j] !== '{' && text[j] !== '\n' && text[j] !== '\r') j++;
      if (text[j] === '}') { flush(); out.push({ group: text.slice(i, j + 1), content: text.slice(i + 1, j) }); i = j + 1; continue; }
    }
    flush(); out.push({ lone: ch }); i++;
  }
  flush();
  return out;
}
const isOneOf = <X extends string>(list: readonly X[], value: string | undefined): value is X => value !== undefined && (list as readonly string[]).includes(value);
/** What is inside a brace group, in the stored grammar: a field, or the reason it is none. */
function tokenOf(content: string): FieldToken | Exclude<BadFieldReason, 'lone_brace'> {
  const parts = content.split(':'), name = parts[0]!;
  if (name === 'date') return parts.length === 1 ? { name, format: 'long' } : parts.length === 2 && isOneOf(DATE_FORMATS, parts[1]) ? { name, format: parts[1] } : 'unknown_format';
  if (name === 'hebrewDate') return parts.length === 1 ? { name, format: 'full' } : parts.length === 2 && isOneOf(HEBREW_DATE_FORMATS, parts[1]) ? { name, format: parts[1] } : 'unknown_format';
  if (name === 'year' || name === 'hebrewYear' || name === 'event') return parts.length === 1 ? { name } : 'unknown_format';
  if (name === 'age' || name === 'name') {
    const personId = parts[1], format = parts[2];
    if (personId === undefined || !PERSON_ID_IN_FIELD.test(personId) || parts.length > (name === 'age' ? 3 : 2)) return 'unknown_format';
    // the stored grammar of 159a301: any [a-z-]{1,16} format is a field (isUnknownAgeFormat tells the ones outside AGE_FORMATS)
    if (format !== undefined && !PERSON_FORMAT_IN_FIELD.test(format)) return 'unknown_format';
    // the default format is not written, so `{age:x:digits}` and `{age:x}` are one token
    return { name, personId, format: format === undefined || format === AGE_FORMATS[0] ? null : format };
  }
  return 'unknown_field';
}
/** The text in parts, in order. Never throws; joining the literals, the tokens' `raw` and the bad groups gives the text back (with `{{`/`}}` for braces). */
export function parseFields(text: string): FieldPart[] {
  return scanBraces(text).map((p): FieldPart => {
    if ('literal' in p) return p;
    if ('lone' in p) return { bad: p.lone, reason: 'lone_brace' };
    const token = tokenOf(p.content);
    return typeof token === 'string' ? { bad: p.group, reason: token } : { token, raw: p.group };
  });
}
/** The canonical stored form of a token, e.g. `{date}`, `{date:numeric}`, `{hebrewDate:noYear}`, `{age:per_1a2b:words}`. */
export function serialiseToken(t: FieldToken): string {
  switch (t.name) {
    case 'date': return t.format === 'long' ? '{date}' : `{date:${t.format}}`;
    case 'hebrewDate': return t.format === 'full' ? '{hebrewDate}' : `{hebrewDate:${t.format}}`;
    case 'year': case 'hebrewYear': case 'event': return `{${t.name}}`;
    default: return t.format === null ? `{${t.name}:${t.personId}}` : `{${t.name}:${t.personId}:${t.format}}`;
  }
}
/** Plain text as it must be stored in a title with fields: every brace doubled. */
export function escapeFieldText(text: string): string { return text.replace(/[{}]/g, (b) => b + b); }
/** True for a field that names a person. */
export const isPersonToken = (t: FieldToken): t is PersonFieldToken => t.name === 'age' || t.name === 'name';
/**
 * True for an {age:…} field whose format is none of AGE_FORMATS (a document stored before they existed can hold one): it
 * draws no words (unknown_age_format), and set_text_fields enabled:true and the editor form refuse it as a new field.
 */
export const isUnknownAgeFormat = (t: FieldToken): boolean => t.name === 'age' && t.format !== null && !isOneOf(AGE_FORMATS, t.format);

/** Why a people field has no words: the source does not know the person; the person has no birth date; the picture has no date; the picture was taken before the person was born. */
export type PersonMissingReason = 'unknown_person' | 'no_birth_date' | 'no_date' | 'before_birth';
/**
 * Where the words of people fields come from. resolveFields takes its source as a parameter; without one it uses the
 * document's own people (documentPeople), so the evaluator draws what the document it was handed says. A credential that
 * may not read birth dates is handed a document without them (apps/server/src/peoplePrivacy.ts), and so gets no age.
 */
export interface PeopleSource {
  /**
   * The words of a people field on the capture day `day` (a WALL_DATE; null = the anchor has no date): the words, or why
   * there are none. `null` is short for { missing: 'unknown_person' }.
   */
  resolve(token: PersonFieldToken, day: string | null): string | null | { missing: PersonMissingReason };
}
/** Knows nobody: every people field resolves to no data (reason unknown_person). */
export const NO_PEOPLE: PeopleSource = Object.freeze({ resolve: () => null });
/**
 * True when documentPeople, fieldUsersOfPerson and ageWords.ts are built (W1). While false, documentPeople knows nobody, so
 * a people field has no words and the export preflight stops on it: nothing is drawn that is not the finished wording.
 */
export const PEOPLE_FIELDS_BUILT = false;
/**
 * The people source of a document: what resolveFields uses when the caller gives none.
 *
 * W1 fills this (pure, no Intl, no Date, never throws on a schema-valid document; people.ts personOf for the lookup):
 * - `{name:<id>}` → the person's name; a person who is not in the document → { missing: 'unknown_person' }.
 * - An {age:…} with a format outside AGE_FORMATS never reaches a source (valueOf answers unknown_age_format first).
 * - `{age:<id>}` / `{age:<id>:words}` / `{age:<id>:en}`: no such person → unknown_person; the person has no birth date →
 *   no_birth_date; `day` is null → no_date; `day` is before the birth date → before_birth; else
 *   ageHe(ageParts(birthDate, day)!, person.form, 'digits' | 'words') or ageEn(ageParts(birthDate, day)!) (ageWords.ts).
 * - It is a pure function of the document, so its answers may be kept in a FieldIndex of that document: resolveIn keeps
 *   answers only for NO_PEOPLE today, and W1 extends that to this source when it builds it.
 * Until then it is NO_PEOPLE.
 */
export function documentPeople(_doc: ProjectDocument): PeopleSource {
  return NO_PEOPLE;
}
/**
 * The titles that hold a field naming this person, in their own text or in a format's wording of them (whether or not live
 * fields are on for the title): clip ids, each once, in document order. remove_person refuses while this is not empty.
 * W1 fills it; until then it refuses to answer.
 */
export function fieldUsersOfPerson(_doc: ProjectDocument, _personId: string): string[] {
  throw new Error('people: fieldUsersOfPerson is not built yet');
}
/**
 * True when a title with live fields, or a format's wording of one, holds an {age:…} field: the document can draw words
 * computed from a birth date. The server asks this before it hands a rendered film to a credential that may not read birth
 * dates (apps/server/src/peoplePrivacy.ts). It does not look at the people: whether a birth date is recorded is not told.
 */
export function holdsAgeFields(doc: ProjectDocument): boolean {
  const age = (text: string): boolean => text.includes('{age:') && parseFields(text).some((p) => 'token' in p && p.token.name === 'age');
  const titles = new Set<string>();
  for (const seq of Object.values(doc.sequences))
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'text' || !c.fields) continue;
        if (age(c.text)) return true;
        titles.add(c.id);
      }
  if (titles.size === 0) return false;
  for (const v of Object.values(doc.variants ?? {}))
    for (const [clipId, ov] of Object.entries(v.overrides)) if (ov.text !== undefined && titles.has(clipId) && age(ov.text)) return true;
  return false;
}

/** Why a field has no words: the anchor has no capture date (or there is no anchor); the Hebrew day depends on an undecided sunset answer; the file is in no event or its event has no name; the people source does not know the person; the person has no birth date; the picture was taken before the person was born; an age field has a format that is none of AGE_FORMATS (isUnknownAgeFormat; the people source is not asked). */
export type MissingReason = 'no_date' | 'sunset_undecided' | 'no_event_name' | PersonMissingReason | 'unknown_age_format';
export const MISSING_REASONS = ['no_date', 'sunset_undecided', 'no_event_name', 'unknown_person', 'no_birth_date', 'before_birth', 'unknown_age_format'] as const satisfies readonly MissingReason[];
/** The picture a title takes its date from: `wall` is the capture moment shown (day, or day and time), `how` the anchor rule that found it. */
export interface FieldAnchor { clipId: string; assetId: string; wall: string; circa: boolean; how: 'under' | 'next' | 'previous' }
/** `missing` lists each field without data as it is written in the text, with the reason; `eventId` is set when the anchor's file is in an event. */
export interface ResolvedFields { text: string; anchor: FieldAnchor | null; eventId: string | null; missing: { token: string; reason: MissingReason }[] }
/** What an index keeps as it is asked: titles in parts, each file's capture, file → event (and the event a file's date belongs to), event names, and the picture tracks of each sequence. */
export interface FieldMemo {
  parsed: Map<string, FieldPart[]>;
  captures: Map<string, ReturnType<typeof captureOf>>;
  eventOf: Map<string, LifeEvent> | null;
  anchorEvents: Map<string, LifeEvent | null>;
  eventNames: Map<string, string>;
  layouts: Map<string, SequenceLayout | null>;
  /** The words of a title's text for one moment of one picture: by text, then by anchor clip, rule and wall-clock second. */
  resolved: Map<string, Map<string, ResolvedFields>>;
  /** One frame of the document as a time, and the whole seconds of each video file. */
  frame: T.RationalTime | null;
  videoSeconds: Map<string, number | null | undefined>;
}
/** A rational time with its two integers ready, so that comparing does not read them from their strings again. */
interface Q { n: bigint; d: bigint }
const q = (t: T.RationalTime): Q => ({ n: BigInt(t.value), d: BigInt(t.timescale) });
/** a ≤ b, a < b (exact). */
const lteQ = (a: Q, b: Q): boolean => a.n * b.d <= b.n * a.d;
const ltQ = (a: Q, b: Q): boolean => a.n * b.d < b.n * a.d;
/** The picture clips of one visible video track, in time order, with their starts and ends. */
interface PictureTrack { index: number; clips: MediaClip[]; ends: T.RationalTime[]; from: Q[]; to: Q[] }
/** A sequence as the anchor rules see it: the track each clip is on, and the visible video tracks from the bottom up. */
interface SequenceLayout { trackOf: Map<string, number>; pictures: PictureTrack[] }
/**
 * Work that a caller who only sees COMMITTED documents may keep per document (the engine keeps one in a WeakMap, as it does
 * for audio plans; the server's preflight may too). `memo` fills as questions are asked and belongs to this index alone.
 */
export interface FieldIndex { readonly doc: ProjectDocument; readonly memo: FieldMemo }
/** Pure: builds the (empty) index of a document. Never call it on a draft inside an operation. */
export function makeFieldIndex(doc: ProjectDocument): FieldIndex { return { doc, memo: { parsed: new Map(), captures: new Map(), eventOf: null, anchorEvents: new Map(), eventNames: new Map(), layouts: new Map(), resolved: new Map(), frame: null, videoSeconds: new Map() } }; }
export interface FieldOptions {
  /** Default: the document's own people (documentPeople). */
  people?: PeopleSource;
  /** An index made from the SAME document object; without one the function works it out again. */
  index?: FieldIndex;
}
/** The caller's index when it is of this very document; otherwise a fresh one that lives for this call only. */
const indexFor = (doc: ProjectDocument, opts?: Pick<FieldOptions, 'index'>): FieldIndex => (opts?.index && opts.index.doc === doc ? opts.index : makeFieldIndex(doc));
function partsOf(ix: FieldIndex, text: string): FieldPart[] {
  let parts = ix.memo.parsed.get(text);
  if (!parts) { parts = parseFields(text); ix.memo.parsed.set(text, parts); }
  return parts;
}
function captureIn(ix: FieldIndex, assetId: string): ReturnType<typeof captureOf> {
  let c = ix.memo.captures.get(assetId);
  if (c === undefined) { c = captureOf(ix.doc, assetId); ix.memo.captures.set(assetId, c); }
  return c;
}
function eventIn(ix: FieldIndex, assetId: string): LifeEvent | null {
  const known = ix.memo.anchorEvents.get(assetId);
  if (known !== undefined) return known;
  if (!ix.memo.eventOf) {
    const map = new Map<string, LifeEvent>();
    for (const e of Object.values(ix.doc.events ?? {})) for (const id of e.assetIds) if (!map.has(id)) map.set(id, e);
    ix.memo.eventOf = map;
  }
  const map = ix.memo.eventOf;
  const event = eventForCapture(ix.doc, assetId, (id) => map.get(id) ?? null);
  ix.memo.anchorEvents.set(assetId, event);
  return event;
}
function eventNameIn(ix: FieldIndex, event: LifeEvent): string {
  let name = ix.memo.eventNames.get(event.id);
  if (name === undefined) { name = eventDisplayName(ix.doc, event, 'he').name; ix.memo.eventNames.set(event.id, name); }
  return name;
}
function layoutIn(ix: FieldIndex, sequenceId: string): SequenceLayout | null {
  let layout = ix.memo.layouts.get(sequenceId);
  if (layout !== undefined) return layout;
  const seq = Object.hasOwn(ix.doc.sequences, sequenceId) ? ix.doc.sequences[sequenceId] : undefined;
  layout = null;
  if (seq) {
    layout = { trackOf: new Map(), pictures: [] };
    for (const [index, track] of seq.tracks.entries()) {
      for (const c of track.clips) if (!layout.trackOf.has(c.id)) layout.trackOf.set(c.id, index);
      if (track.kind !== 'video' || track.hidden) continue;
      const clips = track.clips.filter((c): c is MediaClip => c.type === 'media').sort((a, b) => T.cmp(a.start, b.start));
      const ends = clips.map((c) => T.add(c.start, c.duration));
      layout.pictures.push({ index, clips, ends, from: clips.map((c) => q(c.start)), to: ends.map(q) });
    }
  }
  ix.memo.layouts.set(sequenceId, layout);
  return layout;
}
/** How many of `times` (in rising order) are at or before `t`. */
function countUpTo(times: readonly Q[], t: Q): number {
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (lteQ(times[mid]!, t)) lo = mid + 1; else hi = mid; }
  return lo;
}
/** The clip of a track that contains `t`, or null. */
function clipAt(track: PictureTrack, t: Q): MediaClip | null {
  const k = countUpTo(track.from, t) - 1; // the last clip that starts at or before t
  return k >= 0 && ltQ(t, track.to[k]!) ? track.clips[k]! : null;
}
type Dated = NonNullable<ReturnType<typeof captureOf>>;
interface Found { clip: MediaClip; dated: Dated; how: FieldAnchor['how']; at: T.RationalTime }
/**
 * Anchor rule 1 on the picture tracks below track `below`: the topmost dated picture clip that contains `t`. `under` says
 * whether any picture clip lies there at all.
 */
function pictureUnder(ix: FieldIndex, layout: SequenceLayout, below: number, t: T.RationalTime): { found: Found | null; under: boolean } {
  let under = false;
  const at = q(t);
  for (let i = layout.pictures.length - 1; i >= 0; i--) {
    const track = layout.pictures[i]!;
    if (track.index >= below) continue;
    const clip = clipAt(track, at);
    if (!clip) continue;
    under = true;
    const dated = captureIn(ix, clip.assetId);
    if (dated) return { found: { clip, dated, how: 'under', at: t }, under };
  }
  return { found: null, under };
}
/** The three anchor rules for a title on track `below` that starts at `titleStart`, asked at `t`. */
function anchorClip(ix: FieldIndex, layout: SequenceLayout, below: number, titleStart: T.RationalTime, t: T.RationalTime, frame: T.RationalTime): Found | null {
  const first = pictureUnder(ix, layout, below, t);
  if (first.found || first.under) return first.found;
  const tracks = layout.pictures.filter((p) => p.index < below).reverse(); // topmost first, so the upper clip wins a tie
  // 2. a title card over black: the dated clip that starts first, at or after the title's start, at its first frame
  let next: Found | null = null;
  const from = q(titleStart), at = q(t);
  for (const track of tracks) {
    let k = 0, hi = track.clips.length; // the first clip that starts at or after the title's start
    while (k < hi) { const mid = (k + hi) >> 1; if (ltQ(track.from[mid]!, from)) k = mid + 1; else hi = mid; }
    for (; k < track.clips.length; k++) {
      const clip = track.clips[k]!;
      if (next && !T.lt(clip.start, next.clip.start)) break;
      const dated = captureIn(ix, clip.assetId);
      if (dated) { next = { clip, dated, how: 'next', at: clip.start }; break; }
    }
  }
  if (next) return next;
  // 3. a closing card: the dated clip that ended last, at or before t, at its last frame
  let previous: (Found & { end: T.RationalTime }) | null = null;
  for (const track of tracks) {
    for (let k = countUpTo(track.to, at) - 1; k >= 0; k--) {
      const clip = track.clips[k]!, end = track.ends[k]!;
      if (previous && !T.lt(previous.end, end)) break;
      const dated = captureIn(ix, clip.assetId);
      if (!dated) continue;
      const last = T.sub(end, frame);
      previous = { clip, dated, how: 'previous', at: T.lt(last, clip.start) ? clip.start : last, end };
      break;
    }
  }
  return previous;
}
/** The wall-clock moment a dated clip shows at `at`: its capture, the offset it inherits, and the whole source seconds played (a still picture and a day-only date do not tick). null when it cannot be written. */
function momentOf(ix: FieldIndex, found: Found): string | null {
  const length = videoSecondsIn(ix, found.clip.assetId);
  let seconds = 0;
  if (length !== undefined) {
    if (length === null) return null;
    const played = T.frameIndexAt(pictureSourceAt(found.clip, found.at, frameIn(ix)), { num: 1, den: 1 });
    if (!Number.isSafeInteger(played)) return null;
    seconds = Math.max(0, Math.min(played, length)); // a clip asked to play past its source holds its last picture (evaluate.ts)
  }
  try { return addWallSeconds(found.dated.capture.at, found.dated.offsetSeconds + seconds); } catch { return null; }
}
/** One frame of the document, as a time. */
function frameIn(ix: FieldIndex): T.RationalTime { return (ix.memo.frame ??= T.frameTime(1, ix.doc.settings.frameRate)); }
/** The whole seconds of a video file (null = too long to count in); undefined for a file that is not a video, whose picture has no clock. */
function videoSecondsIn(ix: FieldIndex, assetId: string): number | null | undefined {
  if (ix.memo.videoSeconds.has(assetId)) return ix.memo.videoSeconds.get(assetId);
  const asset = Object.hasOwn(ix.doc.assets, assetId) ? ix.doc.assets[assetId] : undefined;
  let length: number | null | undefined;
  if (asset?.kind === 'video') { const whole = T.frameIndexAt(asset.duration, { num: 1, den: 1 }); length = Number.isSafeInteger(whole) ? Math.max(0, whole) : null; }
  ix.memo.videoSeconds.set(assetId, length);
  return length;
}
/** What a field is resolved from: the anchor, the capture behind it, and the event of its file. */
interface Moment { anchor: FieldAnchor; capture: Capture; event: LifeEvent | null }
function momentAt(ix: FieldIndex, sequenceId: string, clip: Clip, time: T.RationalTime, rules: 'all' | 'under'): Moment | null {
  const layout = layoutIn(ix, sequenceId), below = layout?.trackOf.get(clip.id);
  if (!layout || below === undefined) return null;
  const found = rules === 'under' ? pictureUnder(ix, layout, below, time).found : anchorClip(ix, layout, below, clip.start, time, frameIn(ix));
  return found ? momentOfFound(ix, found) : null;
}
function momentOfFound(ix: FieldIndex, found: Found): Moment | null {
  const wall = momentOf(ix, found);
  if (wall === null) return null;
  return { anchor: { clipId: found.clip.id, assetId: found.clip.assetId, wall, circa: found.dated.capture.circa === true, how: found.how }, capture: found.dated.capture, event: eventIn(ix, found.clip.assetId) };
}
/** The words of one field, or why it has none. */
type FieldValue = { words: string } | { missing: MissingReason };
const words = (w: string): FieldValue => ({ words: w });
const none = (missing: MissingReason): FieldValue => ({ missing });
function valueOf(ix: FieldIndex, token: FieldToken, m: Moment | null, people: PeopleSource): FieldValue {
  if (isPersonToken(token)) {
    if (isUnknownAgeFormat(token)) return none('unknown_age_format');
    const answer = people.resolve(token, m ? m.anchor.wall.slice(0, 10) : null);
    return typeof answer === 'string' ? words(answer) : none(answer === null ? 'unknown_person' : answer.missing);
  }
  if (!m) return none('no_date');
  const { date } = parseWall(m.anchor.wall);
  switch (token.name) {
    case 'date': {
      const month = GREGORIAN_MONTH_NAMES[date.m - 1]!;
      switch (token.format) {
        case 'numeric': return words(`${date.d}.${date.m}.${date.y}`);
        case 'monthYear': return words(`${month.he} ${date.y}`);
        case 'long-en': return words(`${date.d} ${month.en} ${date.y}`);
        case 'monthYear-en': return words(`${month.en} ${date.y}`);
        default: return words(`${date.d} ב${month.he} ${date.y}`);
      }
    }
    case 'year': return words(String(date.y));
    case 'event': { const name = m.event ? eventNameIn(ix, m.event) : ''; return name ? words(name) : none('no_event_name'); }
    default: {
      // a Hebrew field has words while the day is unsure only if both readings give the same words
      const readings = hebrewDayReadings(m.capture, m.anchor.wall, m.event?.afterSunset ?? null).map((r) => { const h = hebrewFromRd(r.rd); return token.name === 'hebrewYear' ? hebrewNumeral(h.y) : formatHebrewDate(h, { year: token.format === 'full' }); });
      return readings.every((r) => r === readings[0]) ? words(readings[0]!) : none('sunset_undecided');
    }
  }
}
function resolveIn(ix: FieldIndex, clip: TextClip, m: Moment | null, people: PeopleSource): ResolvedFields {
  if (people !== NO_PEOPLE) return resolveNow(ix, clip, m, people); // another source may answer differently each time it is asked
  // the words change only when the picture or its wall-clock second does: a kept index answers the frames in between from memory
  let byMoment = ix.memo.resolved.get(clip.text);
  if (!byMoment) { byMoment = new Map(); ix.memo.resolved.set(clip.text, byMoment); }
  const key = m ? `${m.anchor.clipId}\n${m.anchor.how}\n${m.anchor.wall}` : '';
  let known = byMoment.get(key);
  if (!known) {
    known = resolveNow(ix, clip, m, people);
    // handed out more than once: nobody may change it
    Object.freeze(known.missing); for (const x of known.missing) Object.freeze(x); if (known.anchor) Object.freeze(known.anchor);
    byMoment.set(key, Object.freeze(known));
  }
  return known;
}
function resolveNow(ix: FieldIndex, clip: TextClip, m: Moment | null, people: PeopleSource): ResolvedFields {
  const missing: ResolvedFields['missing'] = [];
  let text = '';
  for (const part of partsOf(ix, clip.text)) {
    if ('literal' in part) text += part.literal;
    else if ('bad' in part) text += part.bad; // validation refuses these in a title with fields; a document that holds one shows it as written
    else {
      const value = valueOf(ix, part.token, m, people);
      // a resolved value is put in once and never read again as text with fields
      if ('words' in value) text += value.words; else missing.push({ token: part.raw, reason: value.missing });
    }
  }
  return { text, anchor: m?.anchor ?? null, eventId: m?.event?.id ?? null, missing };
}
/**
 * The words a title shows at `time`. A field without data contributes the empty string and is listed in `missing`.
 * For a clip without `fields`: { text: clip.text, anchor: null, eventId: null, missing: [] }, the text untouched.
 */
export function resolveFields(doc: ProjectDocument, sequenceId: string, clip: TextClip, time: T.RationalTime, opts?: FieldOptions): ResolvedFields {
  if (!clip.fields) return { text: clip.text, anchor: null, eventId: null, missing: [] };
  const ix = indexFor(doc, opts), people = opts?.people ?? documentPeople(doc);
  let m: Moment | null;
  try { m = momentAt(ix, sequenceId, clip, time, 'all'); } catch (e) { if (!(e instanceof RangeError)) throw e; m = null; } // a time no clock can count in: no date
  return resolveIn(ix, clip, m, people);
}
/** The first frame whose start is at or after `t`. */
function frameFrom(t: T.RationalTime, rate: T.Rate): number { const i = T.frameIndexAt(t, rate); return T.eq(T.frameTime(i, rate), t) ? i : i + 1; }
/** What makes two resolved values one stretch: the words, what is missing, and which picture they come from (not the clock, which ticks). */
const stretchKey = (r: ResolvedFields): string => JSON.stringify([r.text, r.missing, r.anchor?.clipId ?? null, r.anchor?.how ?? null, r.anchor?.circa ?? null, r.eventId]);
/** The most samples fieldSpans takes over one title; a longer title is sampled less often than once a second. */
const MAX_SPAN_SAMPLES = 100_000;
/**
 * The values a title with fields takes over its own span, in whole frames of the sequence: consecutive, covering the title,
 * each stretch with one resolved value. Breakpoints are the title's start and every lower picture clip edge inside it, plus
 * one sample per timeline second inside each stretch; where two samples differ, the first frame of the new value is found by
 * bisection. `endFrame` is exclusive.
 */
export function fieldSpans(doc: ProjectDocument, sequenceId: string, clip: TextClip, opts?: FieldOptions): { startFrame: number; endFrame: number; resolved: ResolvedFields }[] {
  const rate = doc.settings.frameRate, ix = indexFor(doc, opts), options: FieldOptions = { ...opts, index: ix };
  const start = frameFrom(clip.start, rate), end = frameFrom(T.add(clip.start, clip.duration), rate);
  if (!(end > start)) return [];
  const at = (frame: number) => resolveFields(doc, sequenceId, clip, T.frameTime(frame, rate), options);
  if (!clip.fields) return [{ startFrame: start, endFrame: end, resolved: at(start) }];
  const layout = layoutIn(ix, sequenceId), below = layout?.trackOf.get(clip.id);
  const edges = new Set<number>([start, end]);
  if (layout && below !== undefined)
    for (const track of layout.pictures) {
      if (track.index >= below) continue;
      track.clips.forEach((c, k) => { for (const f of [frameFrom(c.start, rate), frameFrom(track.ends[k]!, rate)]) if (f > start && f < end) edges.add(f); });
    }
  const step = Math.max(1, Math.round(rate.num / rate.den), Math.ceil((end - start) / MAX_SPAN_SAMPLES));
  const samples: number[] = [];
  const sorted = [...edges].sort((a, b) => a - b);
  for (let i = 0; i + 1 < sorted.length; i++) for (let f = sorted[i]!; f < sorted[i + 1]!; f += step) samples.push(f);
  const spans: { startFrame: number; endFrame: number; resolved: ResolvedFields }[] = [];
  let open = { startFrame: start, resolved: at(start) }, key = stretchKey(open.resolved), prev = start;
  for (const sample of samples.slice(1)) {
    let next = at(sample);
    // the value changed somewhere in (prev, sample]: find the first frame of each new value on the way
    while (stretchKey(next) !== key) {
      let lo = prev, hi = sample; // lo still has the old value, hi does not
      while (hi - lo > 1) { const mid = lo + Math.floor((hi - lo) / 2); if (stretchKey(at(mid)) === key) lo = mid; else hi = mid; }
      spans.push({ startFrame: open.startFrame, endFrame: hi, resolved: open.resolved });
      open = { startFrame: hi, resolved: at(hi) };
      key = stretchKey(open.resolved);
      prev = hi;
      if (hi === sample) { next = open.resolved; break; }
    }
    prev = sample;
  }
  spans.push({ startFrame: open.startFrame, endFrame: end, resolved: open.resolved });
  return spans;
}
/** The stamp's own pattern (effects.ts, the `text` parameter of stylize.date-stamp). */
const STAMP_PATTERN = /^[0-9 .:'\/-]{0,20}$/;
const two = (n: number): string => String(n).padStart(2, '0');
/**
 * The text of a capture-sourced date stamp on `clip` at `time`: `'24 12 25` (dateOrder ymd, the default) or `25.12.2024`
 * (dmy), plus ` 18:15` with `clock` (a day-only date has no clock); the minute advances with the source. '' when there is no
 * date. Always matches /^[0-9 .:'\/-]{0,20}$/ (the stamp's own pattern). A media clip reads its own file; an adjustment or
 * title clip reads the topmost DATED picture under it at `time` (anchor rule 1 only), else ''.
 */
export function stampText(doc: ProjectDocument, sequenceId: string, clip: Clip, time: T.RationalTime, style: { clock?: boolean; dateOrder?: 'ymd' | 'dmy' }, opts?: Pick<FieldOptions, 'index'>): string {
  const ix = indexFor(doc, opts);
  let wall: string | null = null;
  try {
    if (clip.type === 'media') { const dated = captureIn(ix, clip.assetId); wall = dated ? momentOf(ix, { clip, dated, how: 'under', at: time }) : null; }
    else if (clip.type === 'adjustment' || clip.type === 'text') wall = momentAt(ix, sequenceId, clip, time, 'under')?.anchor.wall ?? null;
  } catch (e) { if (!(e instanceof RangeError)) throw e; }
  if (wall === null) return '';
  const { date, seconds } = parseWall(wall);
  const day = style.dateOrder === 'dmy' ? `${date.d}.${date.m}.${date.y}` : `'${two(date.y % 100)} ${date.m} ${date.d}`;
  const text = style.clock && seconds !== null ? `${day} ${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}` : day;
  return STAMP_PATTERN.test(text) ? text : '';
}

// ---------- the form a person reads and types ----------
const FIELD_WORDS: Readonly<Record<FieldName, { he: string; en: string }>> = {
  date: { he: 'תאריך', en: 'date' }, hebrewDate: { he: 'תאריך עברי', en: 'Hebrew date' }, year: { he: 'שנה', en: 'year' }, hebrewYear: { he: 'שנה עברית', en: 'Hebrew year' }, event: { he: 'אירוע', en: 'event' },
};
/** The formats of the two fields that have them; the first of each list is the default and is not written. */
const FORMAT_WORDS: Readonly<Record<string, { he: string; en: string }>> = {
  long: { he: 'מלא', en: 'long' }, numeric: { he: 'מספרי', en: 'numeric' }, monthYear: { he: 'חודש ושנה', en: 'month and year' }, 'long-en': { he: 'באנגלית', en: 'in English' },
  'monthYear-en': { he: 'חודש ושנה באנגלית', en: 'month and year in English' }, full: { he: 'מלא', en: 'full' }, noYear: { he: 'בלי שנה', en: 'no year' },
};
/**
 * The readable words of the people fields and of the age formats (ADR-0021, people section), for the editor form:
 * `{age:per_1a2b}` ↔ `{גיל: נועה}` / `{age: Noa}`, `{age:per_1a2b:words}` ↔ `{גיל: נועה: במילים}`, `{name:per_1a2b}` ↔
 * `{שם: נועה}`. The person is written by name (a name holds no brace, colon or bar: schema.ts PERSON_NAME) and found again
 * by people.ts personNameKey. W1 uses these in fieldsToDisplay / fieldsFromDisplay when a document is given.
 */
export const PERSON_FIELD_WORDS: Readonly<Record<(typeof PERSON_FIELD_NAMES)[number], { he: string; en: string }>> = { age: { he: 'גיל', en: 'age' }, name: { he: 'שם', en: 'name' } };
export const AGE_FORMAT_WORDS: Readonly<Record<(typeof AGE_FORMATS)[number], { he: string; en: string }>> = { digits: { he: 'בספרות', en: 'digits' }, words: { he: 'במילים', en: 'in words' }, en: { he: 'באנגלית', en: 'in English' } };
/** Why what was typed in the editor form cannot be stored: as BadFieldReason, or a people field whose name is nobody in the project. */
export type DisplayProblemReason = BadFieldReason | 'unknown_person';
const formatsOf = (name: FieldName): readonly string[] => (name === 'date' ? DATE_FORMATS : name === 'hebrewDate' ? HEBREW_DATE_FORMATS : []);
/** One spelling for comparing what was typed: trimmed, single spaces, lower case. */
const typed = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase();
/** The readable words of both languages, and the stored names, to the stored names. */
function fromWords<X extends string>(names: readonly X[], words: Readonly<Record<string, { he: string; en: string }>>, word: string): X | undefined {
  const w = typed(word);
  return names.find((n) => typed(n) === w || typed(words[n]!.he) === w || typed(words[n]!.en) === w);
}
/**
 * The text of a title with fields as the editor shows it: `{date}` ↔ `{תאריך}` / `{date}`, `{hebrewDate:noYear}` ↔
 * `{תאריך עברי: בלי שנה}`. Bad groups are shown as written.
 * People fields: with `doc`, a field whose person is in the document is shown by name (`{גיל: נועה}`, PERSON_FIELD_WORDS,
 * AGE_FORMAT_WORDS); a field whose person is not there, and every people field when no `doc` is given, is shown as written.
 * (The people half is W1's; until it is built people fields are always shown as written, which fieldsFromDisplay reads back.)
 */
export function fieldsToDisplay(lang: 'he' | 'en', text: string, _doc?: ProjectDocument): string {
  return parseFields(text).map((p) => {
    if ('literal' in p) return escapeFieldText(p.literal);
    if ('bad' in p) return p.bad;
    if (isPersonToken(p.token)) return p.raw;
    const name = FIELD_WORDS[p.token.name][lang], format = 'format' in p.token && p.token.format !== formatsOf(p.token.name)[0] ? p.token.format : null;
    return format === null ? `{${name}}` : `{${name}: ${FORMAT_WORDS[format]![lang]}}`;
  }).join('');
}
/**
 * The stored text for what was typed in the editor form; accepts canonical tokens and the readable names of both languages.
 * People fields: with `doc`, `{גיל: נועה}` / `{age: Noa}` / `{שם: נועה}` (and an age format's word after a second colon)
 * become `{age:<id>}` / `{name:<id>}` for the person of that name (personNameKey); a name that is nobody in the document is
 * a problem with reason unknown_person. Without `doc` the readable people form is an unknown field, as today. (W1's half.)
 */
export function fieldsFromDisplay(_lang: 'he' | 'en', text: string, _doc?: ProjectDocument): { ok: true; text: string } | { ok: false; problems: { token: string; reason: DisplayProblemReason }[] } {
  const problems: { token: string; reason: DisplayProblemReason }[] = [];
  let out = '';
  for (const p of scanBraces(text)) {
    if ('literal' in p) { out += escapeFieldText(p.literal); continue; }
    if ('lone' in p) { problems.push({ token: p.lone, reason: 'lone_brace' }); continue; }
    const stored = tokenOf(p.content);
    if (typeof stored !== 'string') {
      // a new field: an age format outside AGE_FORMATS is only kept where it is already stored, never typed in
      if (isUnknownAgeFormat(stored)) problems.push({ token: p.group, reason: 'unknown_format' }); else out += serialiseToken(stored);
      continue;
    }
    // the readable form: a field's word, then optionally a colon and a format's word
    const colon = p.content.indexOf(':');
    const name = fromWords(FIELD_NAMES, FIELD_WORDS, colon < 0 ? p.content : p.content.slice(0, colon));
    if (!name) { problems.push({ token: p.group, reason: stored === 'unknown_format' ? 'unknown_format' : 'unknown_field' }); continue; }
    const format = colon < 0 ? formatsOf(name)[0] : fromWords(formatsOf(name), FORMAT_WORDS, p.content.slice(colon + 1));
    if (colon >= 0 && format === undefined) { problems.push({ token: p.group, reason: 'unknown_format' }); continue; }
    out += serialiseToken((format === undefined ? { name } : { name, format }) as FieldToken);
  }
  return problems.length ? { ok: false, problems } : { ok: true, text: out };
}

/** The title `clipId` of a sequence, when it is one with fields. */
function fieldsTitle(doc: ProjectDocument, sequenceId: string, clipId: string): TextClip | null {
  const seq = Object.hasOwn(doc.sequences, sequenceId) ? doc.sequences[sequenceId] : undefined;
  for (const track of seq?.tracks ?? []) for (const c of track.clips) if (c.id === clipId) return c.type === 'text' && c.fields ? c : null;
  return null;
}
/** The longest text a title or a format's wording may hold (update_text, set_variant_override). */
const MAX_TITLE_TEXT = 2000;
/**
 * «קבע כטקסט רגיל»: the operations that turn a title with fields into plain text showing what it shows at `at` (default: the
 * title's first frame). NOT an operation of its own: the result is literal update_text (the resolved master text) +
 * set_variant_override text (for each format that has its own wording, resolved on that format's projection) +
 * set_text_fields enabled:false, to be committed as one transaction, so replay never depends on the wording tables.
 * `varies` = the title shows more than one value over its span (it is frozen at the value at `at`). `missing` lists fields
 * without data at `at` (variantId null = the master); `tooLong` lists the outputs (null = the master) whose resolved text
 * passes 2000 characters. A caller commits `ops` only when `missing` and `tooLong` are empty.
 * Throws RangeError when the clip is not a title with fields or `at` is outside it.
 *
 * How the literal operations fit together: the resolved words are written with their braces doubled, as a title with fields
 * stores plain text, and set_text_fields enabled:false then writes them back as single braces, so a value that itself
 * holds braces (an event someone named "{date}") is never read as a field on the way. The 2000-character limit is counted
 * on that doubled form. A format without its own wording that shows other words than the master at `at` (it hides the
 * picture the master takes its date from) is given them as its own wording, so no format's picture changes.
 */
export function freezeOps(doc: ProjectDocument, sequenceId: string, clipId: string, at?: T.RationalTime, opts?: FieldOptions): { ops: OpCall[]; varies: boolean; missing: { variantId: string | null; token: string; reason: MissingReason }[]; tooLong: (string | null)[] } {
  const clip = fieldsTitle(doc, sequenceId, clipId);
  if (!clip) throw new RangeError(`clip ${clipId} is not a title with live fields in sequence ${sequenceId}`);
  const when = at ?? clip.start;
  if (T.lt(when, clip.start) || !T.lt(when, T.add(clip.start, clip.duration))) throw new RangeError('the moment to freeze at is outside the title');
  const ops: OpCall[] = [], missing: { variantId: string | null; token: string; reason: MissingReason }[] = [], tooLong: (string | null)[] = [];
  const people = opts?.people;
  const master = resolveFields(doc, sequenceId, clip, when, opts);
  /** More than one text over the title (two pictures that give the same words are one value). */
  const changes = (spans: { resolved: ResolvedFields }[]): boolean => new Set(spans.map((s) => s.resolved.text)).size > 1;
  let varies = changes(fieldSpans(doc, sequenceId, clip, opts));
  const note = (variantId: string | null, r: ResolvedFields): string => {
    for (const m of r.missing) missing.push({ variantId, ...m });
    const stored = escapeFieldText(r.text);
    if (stored.length > MAX_TITLE_TEXT) tooLong.push(variantId);
    return stored;
  };
  const masterText = note(null, master);
  if (masterText !== clip.text) ops.push({ op: 'update_text', args: { clipId, text: masterText } });
  for (const [variantId, v] of Object.entries(doc.variants ?? {})) {
    const ov = Object.hasOwn(v.overrides, clipId) ? v.overrides[clipId] : undefined;
    const ownWording = ov?.text !== undefined;
    if (ov?.hidden && !ownWording) continue; // not drawn in this format, and nothing of its own to make plain
    // the format's own projection (its wording, its hidden clips); a title hidden there is resolved as if it were shown
    let source = doc;
    if (ov?.hidden) { source = structuredClone(doc); delete source.variants[variantId]!.overrides[clipId]!.hidden; }
    const projected = projectVariant(source, variantId), shown = fieldsTitle(projected, sequenceId, clipId);
    if (!shown) continue;
    const r = resolveFields(projected, sequenceId, shown, when, people ? { people } : undefined);
    if (!ownWording && r.text === master.text && r.missing.length === 0) continue;
    varies = changes(fieldSpans(projected, sequenceId, shown, people ? { people } : undefined)) || varies;
    ops.push({ op: 'set_variant_override', args: { variantId, clipId, text: note(variantId, r) } });
  }
  ops.push({ op: 'set_text_fields', args: { clipId, enabled: false } });
  return { ops, varies, missing, tooLong };
}

/**
 * Validation issues of live fields (validate.ts calls it at the end of validateProject): code life_unknown_field for a title
 * with `fields`, or a format's wording of one, that holds a brace group which is not a field (unknown name, unknown format,
 * a lone brace), with ids [clipId] or [clipId, variantId]. A people field whose person is not in the document is NOT an
 * issue here: it resolves to no data and the export preflight reports it (field_no_data), so undoing an add_person never
 * leaves a document that cannot be stored. Nor is an age format outside AGE_FORMATS (isUnknownAgeFormat): such a document
 * was valid when it was stored (159a301), so it stays valid, replays, and reports field_no_data (unknown_age_format).
 */
export function lifeIssues(doc: ProjectDocument): { code: string; message: string; ids: string[] }[] {
  const issues: { code: string; message: string; ids: string[] }[] = [];
  const bad = (text: string): string => [...new Set(parseFields(text).flatMap((p) => ('bad' in p ? [p.bad] : [])))].join(', ');
  const titles = new Set<string>();
  for (const seq of Object.values(doc.sequences))
    for (const track of seq.tracks)
      for (const c of track.clips) {
        if (c.type !== 'text' || !c.fields) continue;
        titles.add(c.id);
        const groups = bad(c.text);
        if (groups) issues.push({ code: 'life_unknown_field', message: `title ${c.id} has live fields, and these brace groups in it are not fields: ${groups}`, ids: [c.id] });
      }
  if (titles.size === 0) return issues;
  for (const [variantId, v] of Object.entries(doc.variants ?? {}))
    for (const [clipId, ov] of Object.entries(v.overrides)) {
      if (ov.text === undefined || !titles.has(clipId)) continue;
      const groups = bad(ov.text);
      if (groups) issues.push({ code: 'life_unknown_field', message: `title ${clipId} has live fields, and these brace groups in its wording for format ${variantId} are not fields: ${groups}`, ids: [clipId, variantId] });
    }
  return issues;
}
