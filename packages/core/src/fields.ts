/**
 * Live fields of titles and the capture-sourced date stamp (life line, ADR-0021). A title with `fields: true` holds tokens
 * such as `{date}` or `{hebrewDate:noYear}` in its text; the evaluator replaces them with words taken from the capture date
 * of the picture under the title, so preview, stills and export agree by construction (ADR-0005). Pure functions of the
 * document and exact time: no Intl, no Date.
 *
 * CONTRACT FILE (lead pre-pass). The grammar, types and signatures are fixed; the bodies are W1's. Until then the pure
 * helpers throw "not built". Four functions are already on a live path and answer plainly instead:
 * - resolveFields gives the title's stored text, unresolved (the evaluator calls it for a title with `fields`);
 * - stampText gives '' (no date is known, so the stamp draws nothing);
 * - makeFieldIndex gives an index that holds only the document;
 * - lifeIssues gives no issues (the structure of events is checked in validate.ts itself).
 *
 * GRAMMAR (stored inside TextClip.text and a format's wording, only when `fields` is set):
 *   {date} = {date:long} «15 במרץ 2024» · {date:numeric} «15.3.2024» · {date:monthYear} «מרץ 2024» · {date:long-en} ·
 *   {date:monthYear-en} · {hebrewDate} = {hebrewDate:full} «כ״ה בכסלו תשפ״ה» · {hebrewDate:noYear} · {year} · {hebrewYear} ·
 *   {event}. `{{` and `}}` are literal braces. serialiseToken writes the short form for a default format.
 *   Reserved for people, who wait for the owner's approval: {age:<personId>}, {age:<personId>:<format>}, {name:<personId>}
 *   with personId = [A-Za-z0-9_-]{1,64} and format = [a-z-]{1,16}. They parse as tokens and resolve through a PeopleSource;
 *   the only source today is NO_PEOPLE, which knows nobody, so they resolve to no data (reason unknown_person).
 *
 * RULES for the bodies (plan §4.5, with the verifier's corrections, which win):
 * - Anchor of a title at time t (same sequence, picture clips on visible video tracks BELOW the title's track):
 *   1. among those that contain t, the topmost DATED one (an undated sticker over a dated video still works);
 *      if picture clips lie there and none is dated → no anchor, reason no_date;
 *   2. only when NO picture clip lies under the title at t (a title card over black): the dated clip with the earliest start
 *      at or after the title's start, read at its first frame; else
 *   3. the dated clip with the latest end before the title, read at its last frame; else no data.
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
import type * as T from '@pulseframe/time';
import type { OpCall } from './ops.ts';
import type { Clip, ProjectDocument, TextClip } from './schema.ts';

const notBuilt = (what: string): never => { throw new Error(`life line: ${what} is not built yet (fields.ts, W1)`); };

export const FIELD_NAMES = ['date', 'hebrewDate', 'year', 'hebrewYear', 'event'] as const;
export type FieldName = (typeof FIELD_NAMES)[number];
/** Reserved: fields that name a person. People are not part of this build (they wait for the owner's approval). */
export const PERSON_FIELD_NAMES = ['age', 'name'] as const;
export const DATE_FORMATS = ['long', 'numeric', 'monthYear', 'long-en', 'monthYear-en'] as const;
export const HEBREW_DATE_FORMATS = ['full', 'noYear'] as const;
/** The shape of a person id and of a people-field format inside a token. */
export const PERSON_ID_IN_FIELD = /^[A-Za-z0-9_-]{1,64}$/;
export const PERSON_FORMAT_IN_FIELD = /^[a-z-]{1,16}$/;
/** A field that names a person; `format` null = the default of that field. */
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
/** The text in parts, in order. Never throws; joining the literals, the tokens' `raw` and the bad groups gives the text back (with `{{`/`}}` for braces). */
export function parseFields(_text: string): FieldPart[] { return notBuilt('parseFields'); }
/** The canonical stored form of a token, e.g. `{date}`, `{date:numeric}`, `{hebrewDate:noYear}`, `{age:per_1a2b:words}`. */
export function serialiseToken(_t: FieldToken): string { return notBuilt('serialiseToken'); }
/** Plain text as it must be stored in a title with fields: every brace doubled. */
export function escapeFieldText(_text: string): string { return notBuilt('escapeFieldText'); }

/**
 * Where the words of people fields come from. PEOPLE WAIT FOR THE OWNER'S APPROVAL (wave-5 decisions): the document holds no
 * people, and the only source is NO_PEOPLE. The resolver takes its source as a parameter so that an approved people list can
 * be connected later without changing the resolver or any stored title.
 */
export interface PeopleSource {
  /** The words of a people field on the capture day `day` (a WALL_DATE; null = the anchor has no date), or null when this source does not know the person. */
  resolve(token: PersonFieldToken, day: string | null): string | null;
}
/** Knows nobody: every people field resolves to no data (reason unknown_person). */
export const NO_PEOPLE: PeopleSource = Object.freeze({ resolve: () => null });

/** Why a field has no words: the anchor has no capture date (or there is no anchor); the Hebrew day depends on an undecided sunset answer; the file is in no event or its event has no name; the people source does not know the person. */
export type MissingReason = 'no_date' | 'sunset_undecided' | 'no_event_name' | 'unknown_person';
export const MISSING_REASONS = ['no_date', 'sunset_undecided', 'no_event_name', 'unknown_person'] as const satisfies readonly MissingReason[];
/** The picture a title takes its date from: `wall` is the capture moment shown (day, or day and time), `how` the anchor rule that found it. */
export interface FieldAnchor { clipId: string; assetId: string; wall: string; circa: boolean; how: 'under' | 'next' | 'previous' }
/** `missing` lists each field without data as it is written in the text, with the reason; `eventId` is set when the anchor's file is in an event. */
export interface ResolvedFields { text: string; anchor: FieldAnchor | null; eventId: string | null; missing: { token: string; reason: MissingReason }[] }
/**
 * Work that a caller who only sees COMMITTED documents may keep per document (the engine keeps one in a WeakMap, as it does
 * for audio plans; the server's preflight may too). W1 adds what it needs (parsed titles, the clip index, file → event).
 */
export interface FieldIndex { readonly doc: ProjectDocument }
/** Pure: builds the index of a document. Never call it on a draft inside an operation. */
export function makeFieldIndex(doc: ProjectDocument): FieldIndex { return { doc }; }
export interface FieldOptions {
  /** Default NO_PEOPLE. */
  people?: PeopleSource;
  /** An index made from the SAME document object; without one the function works it out again. */
  index?: FieldIndex;
}
/**
 * The words a title shows at `time`. A field without data contributes the empty string and is listed in `missing`.
 * For a clip without `fields`: { text: clip.text, anchor: null, eventId: null, missing: [] }, the text untouched.
 */
export function resolveFields(_doc: ProjectDocument, _sequenceId: string, clip: TextClip, _time: T.RationalTime, _opts?: FieldOptions): ResolvedFields {
  // CONTRACT STUB: the stored text, unresolved (plain, never a made-up date). W1 replaces this body.
  return { text: clip.text, anchor: null, eventId: null, missing: [] };
}
/**
 * The values a title with fields takes over its own span, in whole frames of the sequence: consecutive, covering the title,
 * each stretch with one resolved value. Breakpoints are the title's start and every lower picture clip edge inside it, plus
 * one sample per timeline second inside each stretch; where two samples differ, the first frame of the new value is found by
 * bisection. `endFrame` is exclusive.
 */
export function fieldSpans(_doc: ProjectDocument, _sequenceId: string, _clip: TextClip, _opts?: FieldOptions): { startFrame: number; endFrame: number; resolved: ResolvedFields }[] { return notBuilt('fieldSpans'); }
/**
 * The text of a capture-sourced date stamp on `clip` at `time`: `'24 12 25` (dateOrder ymd, the default) or `25.12.2024`
 * (dmy), plus ` 18:15` with `clock` (a day-only date has no clock); the minute advances with the source. '' when there is no
 * date. Always matches /^[0-9 .:'\/-]{0,20}$/ (the stamp's own pattern). A media clip reads its own file; an adjustment or
 * title clip reads the topmost DATED picture under it at `time` (anchor rule 1 only), else ''.
 */
export function stampText(_doc: ProjectDocument, _sequenceId: string, _clip: Clip, _time: T.RationalTime, _style: { clock?: boolean; dateOrder?: 'ymd' | 'dmy' }, _opts?: Pick<FieldOptions, 'index'>): string {
  // CONTRACT STUB: no date is known, so nothing is drawn. W1 replaces this body.
  return '';
}
/** The text of a title with fields as the editor shows it: `{date}` ↔ `{תאריך}` / `{date}`, `{hebrewDate:noYear}` ↔ `{תאריך עברי: בלי שנה}`. Bad groups and people fields are shown as written. */
export function fieldsToDisplay(_lang: 'he' | 'en', _text: string): string { return notBuilt('fieldsToDisplay'); }
/** The stored text for what was typed in the editor form; accepts canonical tokens and the readable names of both languages. */
export function fieldsFromDisplay(_lang: 'he' | 'en', _text: string): { ok: true; text: string } | { ok: false; problems: { token: string; reason: BadFieldReason }[] } { return notBuilt('fieldsFromDisplay'); }

/**
 * «קבע כטקסט רגיל»: the operations that turn a title with fields into plain text showing what it shows at `at` (default: the
 * title's first frame). NOT an operation of its own: the result is literal update_text (the resolved master text) +
 * set_variant_override text (for each format that has its own wording, resolved on that format's projection) +
 * set_text_fields enabled:false, to be committed as one transaction, so replay never depends on the wording tables.
 * `varies` = the title shows more than one value over its span (it is frozen at the value at `at`). `missing` lists fields
 * without data at `at` (variantId null = the master); `tooLong` lists the outputs (null = the master) whose resolved text
 * passes 2000 characters. A caller commits `ops` only when `missing` and `tooLong` are empty.
 * Throws RangeError when the clip is not a title with fields or `at` is outside it.
 */
export function freezeOps(_doc: ProjectDocument, _sequenceId: string, _clipId: string, _at?: T.RationalTime, _opts?: FieldOptions): { ops: OpCall[]; varies: boolean; missing: { variantId: string | null; token: string; reason: MissingReason }[]; tooLong: (string | null)[] } { return notBuilt('freezeOps'); }

/**
 * Validation issues of live fields (validate.ts calls it at the end of validateProject): code life_unknown_field for a title
 * with `fields`, or a format's wording of one, that holds a brace group which is not a field (unknown name, unknown format,
 * a lone brace), with ids [clipId] or [clipId, variantId]. People fields are NOT an issue here: they resolve to no data
 * and the export preflight reports them (field_no_data).
 */
export function lifeIssues(_doc: ProjectDocument): { code: string; message: string; ids: string[] }[] {
  // CONTRACT STUB: no title can be given fields until set_text_fields is built. W1 replaces this body.
  return [];
}
