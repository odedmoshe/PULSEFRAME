/**
 * Live fields of titles and the capture-sourced date stamp (fields.ts, ADR-0021): the grammar, the readable form, the three
 * anchor rules, every reason a field has no words, values over a title's span, the stamp's text, "make it plain text" as
 * literal operations, and the validation of the grammar. Expected words are typed here, never taken from the code under test.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, escapeFieldText, fieldsFromDisplay, fieldSpans, fieldsToDisplay, findClip, freezeOps, lifeIssues, makeFieldIndex, NO_PEOPLE, OpError, parseFields, projectVariant,
  resolveFields, serialiseToken, stampText, validateProject,
  type Capture, type FieldToken, type LifeEvent, type OpCall, type PeopleSource, type ProjectDocument, type TextClip,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (frame: number) => T.frameTime(frame, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `f${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, ...(capture ? { capture } : {}) });
const picture = (hash: string, capture?: Capture) => ({ kind: 'image' as const, name: `${hash}.png`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 800, height: 600, codec: 'png', hasAlpha: false }, provenance: prov, ...(capture ? { capture } : {}) });
const copyOf = (hash: string, source: string, start: T.RationalTime) => ({ ...video(hash), provenance: { origin: 'derived' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test', derived: { jobId: 'job_t', capabilityId: 'test.fixture', capabilityVersion: '0.0.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [source], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, sourceRangeStart: start, audio: 'source-copied', frames: { sourceStartFrame: 150, sourceFrameCount: 1650, sourceRate: R, outputRate: R, mapping: 'identity', heldFrames: [] } } } });

/** 17:30 on 25 December 2024 on an Israeli winter clock: inside the sunset window (24 Kislev before sunset, 25 Kislev after). */
const EVENING: Capture = { at: '2024-12-25T17:30:00', utcOffsetMinutes: 120, source: 'container' };
const SUMMER: Capture = { at: '2021-06-01T10:00:00', utcOffsetMinutes: null, source: 'manual' };
const NEW_YEAR: Capture = { at: '2024-12-31T23:59:50', utcOffsetMinutes: null, source: 'exif' };
const PURIM_DAY: Capture = { at: '2024-03-24', utcOffsetMinutes: null, source: 'filename', circa: true };

/** A library: [0] the Hanukkah evening video, [1] a summer morning video, [2] a video without a date, [3] a video ten seconds before new year, [4] a picture with a day-only date, [5] a picture with a clock time. */
function library() {
  const r = tx(createProject({ id: 'prj_f', name: 'Fields', width: 640, height: 360, frameRate: R }), [video('a', EVENING), video('b', SUMMER), video('c'), video('d', NEW_YEAR), picture('e', PURIM_DAY), picture('f', { at: '2024-03-24T11:05:09', utcOffsetMinutes: null, source: 'exif' })].map((asset) => ({ op: 'import_asset', args: { asset } })), true);
  const [evening, summer, undated, newYear, still, timedStill] = r.results.map((x) => x.output!.assetId as string) as [string, string, string, string, string, string];
  return { doc: r.doc, evening, summer, undated, newYear, still, timedStill };
}
const place = (doc: ProjectDocument, assetId: string, start: number, duration: number, extra: Record<string, unknown> = {}) => { const r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(duration), ...extra } }]); return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string }; };
/** A title with fields: its braces are fields from the start (update_text is not needed: the text is given already in the stored grammar). */
const title = (doc: ProjectDocument, text: string, start: number, duration: number) => { const r = tx(doc, [{ op: 'add_text', args: { text, start: f(start), duration: f(duration) } }]); const id = r.results[0]!.output!.clipId as string; return { doc: tx(r.doc, [{ op: 'set_text_fields', args: { clipId: id, enabled: true } }]).doc, id }; };
const textClip = (doc: ProjectDocument, id: string) => findClip(doc, id)!.clip as TextClip;
const at = (doc: ProjectDocument, id: string, frame: number, opts?: Parameters<typeof resolveFields>[4]) => resolveFields(doc, doc.mainSequenceId, textClip(doc, id), f(frame), opts);
const words = (doc: ProjectDocument, id: string, frame: number) => at(doc, id, frame).text;
/** The files in a new event, optionally named and with the sunset question answered. */
function withEvent(doc: ProjectDocument, assetIds: string[], over: Partial<LifeEvent> = {}) {
  const r = tx(doc, [{ op: 'add_event', args: { assetIds, ...(over.name ? { name: over.name } : {}) } }]);
  const eventId = r.results[0]!.output!.eventId as string;
  return { doc: over.afterSunset === undefined ? r.doc : tx(r.doc, [{ op: 'update_event', args: { eventId, afterSunset: over.afterSunset } }]).doc, eventId };
}
const trackOf = (doc: ProjectDocument, kind: string) => doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === kind);

describe('the field grammar', () => {
  it('fields, their formats, doubled braces as braces, and groups that are not fields', () => {
    expect(parseFields('צולם ב־{date} · {hebrewDate:noYear}')).toEqual([
      { literal: 'צולם ב־' }, { token: { name: 'date', format: 'long' }, raw: '{date}' }, { literal: ' · ' }, { token: { name: 'hebrewDate', format: 'noYear' }, raw: '{hebrewDate:noYear}' },
    ]);
    expect(parseFields('{{כך}} {year}')).toEqual([{ literal: '{כך} ' }, { token: { name: 'year' }, raw: '{year}' }]);
    expect(parseFields('{date:long}')).toEqual([{ token: { name: 'date', format: 'long' }, raw: '{date:long}' }]); // the long form of the default is a field too, kept as written
    expect(parseFields('{hebrewYear}{event}').map((p) => ('token' in p ? p.token.name : '?'))).toEqual(['hebrewYear', 'event']);
    expect(parseFields('{{{date}}}')).toEqual([{ literal: '{' }, { token: { name: 'date', format: 'long' }, raw: '{date}' }, { literal: '}' }]);
    expect(parseFields('')).toEqual([]);
    expect(parseFields('שלום')).toEqual([{ literal: 'שלום' }]);
    const bad = (text: string) => parseFields(text).flatMap((p) => ('bad' in p ? [[p.bad, p.reason]] : []));
    expect(bad('{weather}')).toEqual([['{weather}', 'unknown_field']]);
    expect(bad('{date:fancy}')).toEqual([['{date:fancy}', 'unknown_format']]);
    expect(bad('{date:numeric:x}')).toEqual([['{date:numeric:x}', 'unknown_format']]);
    expect(bad('{year:numeric}')).toEqual([['{year:numeric}', 'unknown_format']]);
    expect(bad('{event:x}')).toEqual([['{event:x}', 'unknown_format']]);
    expect(bad('{}')).toEqual([['{}', 'unknown_field']]);
    expect(bad('{ date }')).toEqual([['{ date }', 'unknown_field']]); // the stored grammar is exact; the readable form is fieldsFromDisplay
    expect(bad('{Date}')).toEqual([['{Date}', 'unknown_field']]);
    expect(bad('a { b')).toEqual([['{', 'lone_brace']]);
    expect(bad('a } b')).toEqual([['}', 'lone_brace']]);
    expect(bad('{date')).toEqual([['{', 'lone_brace']]);
    expect(bad('{da\nte}')).toEqual([['{', 'lone_brace'], ['}', 'lone_brace']]); // a group does not run over a line break
    expect(bad('{a{date}')).toEqual([['{', 'lone_brace']]);
    expect(bad('{constructor}')).toEqual([['{constructor}', 'unknown_field']]);
  });
  it('fields that name a person are reserved grammar: they parse, with the shape of the id and the format checked', () => {
    expect(parseFields('{age:per_1a2b} {age:per_1a2b:words} {name:per_1a2b}').flatMap((p) => ('token' in p ? [p.token] : []))).toEqual([
      { name: 'age', personId: 'per_1a2b', format: null }, { name: 'age', personId: 'per_1a2b', format: 'words' }, { name: 'name', personId: 'per_1a2b', format: null },
    ]);
    for (const text of ['{age}', '{name}', '{age:}', '{age:a b}', '{age:per_1:Words}', '{age:per_1:words:x}', '{name:per_1:words}', `{age:${'x'.repeat(65)}}`]) expect(parseFields(text), text).toEqual([{ bad: text, reason: 'unknown_format' }]);
  });
  it('the parts give the text back, for any text; the canonical form of a field parses to itself', () => {
    let s = 7;
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
    const pieces = ['{', '}', '{{', '}}', '{date}', '{date:numeric}', '{hebrewDate:noYear}', '{event}', '{weather}', '{age:per_1}', ':', ' ', 'שלום', 'a', '\n', '{date:long}', '{year'];
    for (let i = 0; i < 2000; i++) {
      const text = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => pieces[Math.floor(rnd() * pieces.length)]!).join('');
      const back = parseFields(text).map((p) => ('literal' in p ? escapeFieldText(p.literal) : 'bad' in p ? p.bad : p.raw)).join('');
      expect(back, JSON.stringify(text)).toBe(text);
    }
    const tokens: FieldToken[] = [{ name: 'date', format: 'long' }, { name: 'date', format: 'numeric' }, { name: 'date', format: 'monthYear' }, { name: 'date', format: 'long-en' }, { name: 'date', format: 'monthYear-en' }, { name: 'hebrewDate', format: 'full' }, { name: 'hebrewDate', format: 'noYear' }, { name: 'year' }, { name: 'hebrewYear' }, { name: 'event' }, { name: 'age', personId: 'per_1', format: null }, { name: 'age', personId: 'per_1', format: 'words' }, { name: 'name', personId: 'per_1', format: null }];
    expect(tokens.map(serialiseToken)).toEqual(['{date}', '{date:numeric}', '{date:monthYear}', '{date:long-en}', '{date:monthYear-en}', '{hebrewDate}', '{hebrewDate:noYear}', '{year}', '{hebrewYear}', '{event}', '{age:per_1}', '{age:per_1:words}', '{name:per_1}']);
    for (const t of tokens) expect(parseFields(serialiseToken(t))).toEqual([{ token: t, raw: serialiseToken(t) }]);
    expect(escapeFieldText('a {b} }c{')).toBe('a {{b}} }}c{{');
    expect(parseFields(escapeFieldText('a {date} }c{'))).toEqual([{ literal: 'a {date} }c{' }]);
  });
  it('the form a person reads and types, in Hebrew and in English, and back', () => {
    const stored = 'צולם ב־{date} ({date:numeric}) · {hebrewDate} · {hebrewDate:noYear} · {year} · {hebrewYear} · {event} · {date:monthYear} · {date:long-en} · {date:monthYear-en} · {{סוגריים}}';
    const he = fieldsToDisplay('he', stored), en = fieldsToDisplay('en', stored);
    expect(he).toBe('צולם ב־{תאריך} ({תאריך: מספרי}) · {תאריך עברי} · {תאריך עברי: בלי שנה} · {שנה} · {שנה עברית} · {אירוע} · {תאריך: חודש ושנה} · {תאריך: באנגלית} · {תאריך: חודש ושנה באנגלית} · {{סוגריים}}');
    expect(en).toBe('צולם ב־{date} ({date: numeric}) · {Hebrew date} · {Hebrew date: no year} · {year} · {Hebrew year} · {event} · {date: month and year} · {date: in English} · {date: month and year in English} · {{סוגריים}}');
    // back from either language, whichever language the editor is in; the stored form is accepted too
    for (const lang of ['he', 'en'] as const) for (const shown of [he, en, stored]) expect(fieldsFromDisplay(lang, shown)).toEqual({ ok: true, text: stored });
    // typed loosely: spaces, capitals, the default format written out
    expect(fieldsFromDisplay('he', '{ תאריך }{תאריך:מספרי}{DATE : Numeric}{hebrew date:no  year}{תאריך: מלא}{תאריך עברי: מלא}{date:long}')).toEqual({ ok: true, text: '{date}{date:numeric}{date:numeric}{hebrewDate:noYear}{date}{hebrewDate}{date}' });
    // what cannot be a field is named, with the reason
    expect(fieldsFromDisplay('he', '{מזג אוויר} {תאריך: מפואר} a { b {שנה: מספרי} }')).toEqual({ ok: false, problems: [
      { token: '{מזג אוויר}', reason: 'unknown_field' }, { token: '{תאריך: מפואר}', reason: 'unknown_format' }, { token: '{', reason: 'lone_brace' }, { token: '{שנה: מספרי}', reason: 'unknown_format' }, { token: '}', reason: 'lone_brace' },
    ] });
    // people fields and groups that are not fields are shown as written
    expect(fieldsToDisplay('he', '{age:per_1:words} {weather} {')).toBe('{age:per_1:words} {weather} {');
    expect(fieldsFromDisplay('he', '{age:per_1:words}')).toEqual({ ok: true, text: '{age:per_1:words}' });
    // showing and reading back any valid text gives its canonical form, and showing that again changes nothing
    for (const text of ['{date:long} {hebrewDate:full}', 'a{{b}}c{event}', '{year}{year}']) for (const lang of ['he', 'en'] as const) {
      const round = fieldsFromDisplay(lang, fieldsToDisplay(lang, text));
      expect(round.ok && fieldsToDisplay(lang, round.text), text).toBe(fieldsToDisplay(lang, text));
    }
  });
});

describe('resolving the fields of a title', () => {
  it('a title without `fields` is its stored text, braces and all, whatever lies under it', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 300).doc;
    const r = tx(d, [{ op: 'add_text', args: { text: 'a {date} b {{c}} {weather} {', start: f(0), duration: f(300) } }]);
    d = r.doc;
    const id = r.results[0]!.output!.clipId as string;
    for (const frame of [0, 150, 299]) expect(at(d, id, frame)).toEqual({ text: 'a {date} b {{c}} {weather} {', anchor: null, eventId: null, missing: [] });
    expect(fieldSpans(d, d.mainSequenceId, textClip(d, id))).toEqual([{ startFrame: 0, endFrame: 300, resolved: { text: 'a {date} b {{c}} {weather} {', anchor: null, eventId: null, missing: [] } }]);
  });
  it('every date field from the capture date of the clip under the title', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 300).doc;
    const t = title(d, '{date}|{date:numeric}|{date:monthYear}|{date:long-en}|{date:monthYear-en}|{year}|{hebrewYear}|{{x}}', 0, 300);
    d = t.doc;
    const r = at(d, t.id, 0);
    expect(r.text).toBe('25 בדצמבר 2024|25.12.2024|דצמבר 2024|25 December 2024|December 2024|2024|תשפ״ה|{x}');
    expect(r.missing).toEqual([]);
    expect(r.anchor).toMatchObject({ assetId: lib.evening, wall: '2024-12-25T17:30:00', circa: false, how: 'under' });
    expect(r.eventId).toBeNull();
    // a single-digit day and month are written without a leading zero, as people write dates
    const s = place(lib.doc, lib.still, 0, 90);
    const p = title(s.doc, '{date:numeric} {date}', 0, 90);
    expect(words(p.doc, p.id, 10)).toBe('24.3.2024 24 במרץ 2024');
    expect(at(p.doc, p.id, 10).anchor!.circa).toBe(true);
  });
  it('the Hebrew date waits for the sunset answer; the Hebrew year, which both readings share, does not', () => {
    const lib = library();
    const base = place(lib.doc, lib.evening, 0, 300).doc;
    const t = title(base, '{hebrewDate} / {hebrewDate:noYear} / {hebrewYear} / {event}', 0, 300);
    const unsure = at(t.doc, t.id, 0);
    expect(unsure.text).toBe(' /  / תשפ״ה / ');
    expect(unsure.missing).toEqual([{ token: '{hebrewDate}', reason: 'sunset_undecided' }, { token: '{hebrewDate:noYear}', reason: 'sunset_undecided' }, { token: '{event}', reason: 'no_event_name' }]);
    // in an event, not yet answered: still unsure, and the event has no name to show
    const asked = withEvent(t.doc, [lib.evening]);
    expect(at(asked.doc, t.id, 0)).toMatchObject({ text: ' /  / תשפ״ה / ', eventId: asked.eventId });
    const after = withEvent(t.doc, [lib.evening], { afterSunset: true });
    expect(at(after.doc, t.id, 0)).toMatchObject({ text: 'כ״ה בכסלו תשפ״ה / כ״ה בכסלו / תשפ״ה / חנוכה — נר ראשון', missing: [], eventId: after.eventId });
    const before = withEvent(t.doc, [lib.evening], { afterSunset: false });
    expect(words(before.doc, t.id, 0)).toBe('כ״ד בכסלו תשפ״ה / כ״ד בכסלו / תשפ״ה / ערב חנוכה');
    const named = withEvent(t.doc, [lib.evening], { name: 'חנוכה אצל סבתא' });
    expect(at(named.doc, t.id, 0)).toMatchObject({ text: ' /  / תשפ״ה / חנוכה אצל סבתא', missing: [{ reason: 'sunset_undecided' }, { reason: 'sunset_undecided' }] });
    // a morning clip is certain without any answer
    const morning = title(place(lib.doc, lib.summer, 0, 300).doc, '{hebrewDate}', 0, 300);
    expect(at(morning.doc, morning.id, 0)).toMatchObject({ text: 'כ״א בסיוון תשפ״א', missing: [] });
    // the two readings of an evening that straddles a Hebrew new year do not share a year: 2 October 2024, 18:30
    const eve = tx(lib.doc, [{ op: 'set_asset_capture', args: { assetId: lib.undated, capture: { at: '2024-10-02T18:30:00' } } }]).doc;
    const ny = title(place(eve, lib.undated, 0, 300).doc, '{hebrewYear}', 0, 300);
    expect(at(ny.doc, ny.id, 0)).toMatchObject({ text: '', missing: [{ token: '{hebrewYear}', reason: 'sunset_undecided' }] });
  });
  it('a value is put in once and never read again as fields; a people field has no words while the project holds no people', () => {
    const lib = library();
    const base = place(lib.doc, lib.evening, 0, 300).doc;
    const t = title(base, '{event} {{date}}', 0, 300);
    const named = withEvent(t.doc, [lib.evening], { name: '{date} {{x}} }' });
    expect(words(named.doc, t.id, 0)).toBe('{date} {{x}} } {date}');
    // people: reserved grammar. The operation refuses to turn fields on for such a text, so this document is made by hand, as an archive could be
    const people = structuredClone(t.doc);
    (findClip(people, t.id)!.clip as TextClip).text = '{name:per_1} בת {age:per_1} · {date:numeric}';
    expect(validateProject(people)).toEqual([]);
    expect(at(people, t.id, 0)).toMatchObject({ text: ' בת  · 25.12.2024', missing: [{ token: '{name:per_1}', reason: 'unknown_person' }, { token: '{age:per_1}', reason: 'unknown_person' }] });
    expect(at(people, t.id, 0, { people: NO_PEOPLE }).text).toBe(' בת  · 25.12.2024');
    // the seam: a people source that knows someone is asked with the field and the capture day (labelled test double: no people are stored)
    const asked: [string, string | null][] = [];
    const source: PeopleSource = { resolve: (token, day) => { asked.push([serialiseToken(token), day]); return token.personId !== 'per_1' ? null : token.name === 'name' ? 'נועה' : '3'; } };
    expect(at(people, t.id, 0, { people: source })).toMatchObject({ text: 'נועה בת 3 · 25.12.2024', missing: [] });
    expect(asked).toEqual([['{name:per_1}', '2024-12-25'], ['{age:per_1}', '2024-12-25']]);
    // with no picture under the title a people source is still asked, without a day
    const alone = structuredClone(tx(lib.doc, [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }]).doc);
    const lone = Object.values(alone.sequences)[0]!.tracks.flatMap((tr) => tr.clips).find((c) => c.type === 'text') as TextClip;
    lone.text = '{name:per_1} {date}'; lone.fields = true;
    expect(resolveFields(alone, alone.mainSequenceId, lone, f(0), { people: source })).toMatchObject({ text: 'נועה ', anchor: null, missing: [{ token: '{date}', reason: 'no_date' }] });
  });
});

describe('the picture a title takes its date from', () => {
  it('rule 1: the topmost DATED picture under the title; an undated sticker over a dated video does not hide it; a hidden track is not there', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 300).doc;
    d = tx(d, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const [v1, v2] = trackOf(d, 'video').map((t) => t.id) as [string, string];
    const sticker = place(d, lib.undated, 0, 300, { trackId: v2 });
    const t = title(sticker.doc, '{date:numeric}', 0, 300);
    expect(at(t.doc, t.id, 100).anchor).toMatchObject({ assetId: lib.evening, how: 'under' });
    // a dated picture on top wins
    const top = place(d, lib.summer, 0, 300, { trackId: v2 });
    const t2 = title(top.doc, '{date:numeric}', 0, 300);
    expect(words(t2.doc, t2.id, 100)).toBe('1.6.2021');
    expect(at(t2.doc, t2.id, 100).anchor!.clipId).toBe(top.clipId);
    // hide the upper track: the lower picture is what the film shows, and what the title follows
    const hidden = tx(t2.doc, [{ op: 'update_track', args: { trackId: v2, hidden: true } }]).doc;
    expect(words(hidden, t2.id, 100)).toBe('25.12.2024');
    // hide both: nothing under the title, and no other clip to fall back on
    const none = tx(hidden, [{ op: 'update_track', args: { trackId: v1, hidden: true } }]).doc;
    expect(at(none, t2.id, 100)).toMatchObject({ text: '', anchor: null, missing: [{ token: '{date:numeric}', reason: 'no_date' }] });
  });
  it('an undated clip under the title leaves the field empty, even when dated clips lie before and after it', () => {
    const lib = library();
    let d = place(lib.doc, lib.summer, 0, 100).doc;
    d = place(d, lib.undated, 100, 100).doc;
    d = place(d, lib.evening, 200, 100).doc;
    const t = title(d, 'צולם ב־{date}', 100, 100);
    for (const frame of [100, 150, 199]) expect(at(t.doc, t.id, frame), String(frame)).toEqual({ text: 'צולם ב־', anchor: null, eventId: null, missing: [{ token: '{date}', reason: 'no_date' }] });
  });
  it('rule 2: a title card over black takes the next dated clip from the title\'s start on, at its first frame', () => {
    const lib = library();
    let d = place(lib.doc, lib.summer, 0, 60).doc; // before the title: not "next"
    d = place(d, lib.undated, 150, 30).doc; // undated: skipped
    d = place(d, lib.evening, 200, 300, { sourceIn: f(90) }).doc; // starts 3 s into its file
    const t = title(d, '{date:numeric}', 90, 50);
    const r = at(t.doc, t.id, 100);
    expect(r).toMatchObject({ text: '25.12.2024', anchor: { assetId: lib.evening, wall: '2024-12-25T17:30:03', how: 'next' } });
    expect(at(t.doc, t.id, 139).anchor!.wall).toBe('2024-12-25T17:30:03'); // the same over the whole card
    // two clips that start together on two tracks: the upper one
    let e = tx(lib.doc, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const [v1, v2] = trackOf(e, 'video').map((x) => x.id) as [string, string];
    e = place(e, lib.summer, 100, 60, { trackId: v1 }).doc;
    e = place(e, lib.evening, 100, 60, { trackId: v2 }).doc;
    const t2 = title(e, '{year}', 0, 50);
    expect(words(t2.doc, t2.id, 10)).toBe('2024');
  });
  it('rule 3: a closing card takes the dated clip that ended last, at its last frame; a title that outlasts its clip keeps that clip\'s date', () => {
    const lib = library();
    let d = place(lib.doc, lib.summer, 0, 100).doc;
    d = place(d, lib.evening, 100, 200).doc; // 0 s .. 6.67 s of its file
    const closing = title(d, '{date:numeric}', 330, 60);
    expect(at(closing.doc, closing.id, 350)).toMatchObject({ text: '25.12.2024', anchor: { assetId: lib.evening, wall: '2024-12-25T17:30:06', how: 'previous' } }); // its last frame is 6.63 s in
    // a title that begins over the clip and runs on over black
    const long = title(d, '{date:numeric}', 250, 100);
    expect(at(long.doc, long.id, 260).anchor).toMatchObject({ how: 'under', wall: '2024-12-25T17:30:05' });
    expect(at(long.doc, long.id, 320)).toMatchObject({ text: '25.12.2024', anchor: { assetId: lib.evening, wall: '2024-12-25T17:30:06', how: 'previous' } });
    // nothing dated anywhere below: no data
    const empty = title(place(lib.doc, lib.undated, 0, 60).doc, '{date}', 100, 30);
    expect(at(empty.doc, empty.id, 110)).toMatchObject({ text: '', anchor: null, missing: [{ reason: 'no_date' }] });
    // pictures above the title's track do not count: a title is named after what it lies over
    const below = structuredClone(long.doc);
    const tracks = below.sequences[below.mainSequenceId]!.tracks;
    tracks.unshift(...tracks.splice(tracks.findIndex((x) => x.kind === 'text'), 1));
    expect(validateProject(below)).toEqual([]);
    expect(at(below, long.id, 260)).toMatchObject({ text: '', anchor: null });
  });
  it('the clock follows the source: trims, speed, reverse and a freeze frame; a still picture and a day-only date do not tick', () => {
    const lib = library();
    const moment = (doc: ProjectDocument, id: string, frame: number) => at(doc, id, frame).anchor!.wall;
    // plain: three seconds in is three seconds later
    const plain = place(lib.doc, lib.evening, 0, 600);
    const t = title(plain.doc, '{date}', 0, 600);
    expect([0, 29, 30, 90, 599].map((frame) => moment(t.doc, t.id, frame))).toEqual(['2024-12-25T17:30:00', '2024-12-25T17:30:00', '2024-12-25T17:30:01', '2024-12-25T17:30:03', '2024-12-25T17:30:19']);
    // trimmed in by 30 s
    const trimmed = place(lib.doc, lib.evening, 0, 300, { sourceIn: f(900) });
    const tt = title(trimmed.doc, '{date}', 0, 300);
    expect(moment(tt.doc, tt.id, 0)).toBe('2024-12-25T17:30:30');
    // double speed: two source seconds per second
    const fast = tx(t.doc, [{ op: 'set_clip_speed', args: { clipId: plain.clipId, speed: 2 } }]).doc;
    expect([0, 60, 150].map((frame) => moment(fast, t.id, frame))).toEqual(['2024-12-25T17:30:00', '2024-12-25T17:30:04', '2024-12-25T17:30:10']);
    // backwards: the first frame shows the end of the stretch, the last frame its start
    const reversed = tx(t.doc, [{ op: 'set_clip_reverse', args: { clipId: plain.clipId, reverse: true } }]).doc;
    expect([0, 300, 599].map((frame) => moment(reversed, t.id, frame))).toEqual(['2024-12-25T17:30:19', '2024-12-25T17:30:09', '2024-12-25T17:30:00']);
    // a freeze frame at 2 s, held for 3 s: the clock stands still on it, then goes on
    const frozen = tx(t.doc, [{ op: 'freeze_frame', args: { clipId: plain.clipId, at: f(60), duration: f(90) } }]).doc;
    expect([59, 60, 100, 149, 150, 180].map((frame) => moment(frozen, t.id, frame))).toEqual(['2024-12-25T17:30:01', '2024-12-25T17:30:02', '2024-12-25T17:30:02', '2024-12-25T17:30:02', '2024-12-25T17:30:02', '2024-12-25T17:30:03']);
    // a still picture with a clock time, and a picture with only a day
    const still = title(place(lib.doc, lib.timedStill, 0, 300).doc, '{date}', 0, 300);
    expect([0, 299].map((frame) => moment(still.doc, still.id, frame))).toEqual(['2024-03-24T11:05:09', '2024-03-24T11:05:09']);
    const day = title(place(lib.doc, lib.still, 0, 300).doc, '{date}', 0, 300);
    expect([0, 299].map((frame) => moment(day.doc, day.id, frame))).toEqual(['2024-03-24', '2024-03-24']);
  });
  it('a transition: the title follows the clip whose span it is in; a copy of a file shows its source\'s date, moved by where it starts', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 150).doc;
    const second = place(d, lib.summer, 150, 150);
    d = tx(second.doc, [{ op: 'set_transition', args: { clipId: second.clipId, type: 'dissolve', frames: 20 } }]).doc;
    const t = title(d, '{date:numeric}', 0, 300);
    expect([149, 150, 160].map((frame) => words(t.doc, t.id, frame))).toEqual(['25.12.2024', '1.6.2021', '1.6.2021']);
    // an enhanced copy of the evening video that begins 5 s into it, shown instead of the original
    const copied = tx(lib.doc, [{ op: 'import_asset', args: { asset: copyOf('7', lib.evening, T.rt(5, 1)) } }], true);
    const copyId = copied.results[0]!.output!.assetId as string;
    const c = place(copied.doc, copyId, 0, 300);
    const tc = title(c.doc, '{date:numeric} {event}', 0, 300);
    expect(at(tc.doc, tc.id, 60).anchor).toMatchObject({ assetId: copyId, wall: '2024-12-25T17:30:07', how: 'under' });
    // the event of the original names it too
    const ev = withEvent(tc.doc, [lib.evening], { name: 'חנוכה' });
    expect(at(ev.doc, tc.id, 60)).toMatchObject({ text: '25.12.2024 חנוכה', eventId: ev.eventId });
  });
  it('a format\'s own wording and its hidden clips are resolved on that format\'s projection', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 300).doc;
    d = tx(d, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const top = place(d, lib.summer, 0, 300, { trackId: trackOf(d, 'video')[1]!.id });
    const t = title(top.doc, '{date}', 0, 300);
    const v = tx(t.doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const worded = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: t.id, text: '{date:numeric}' } }, { op: 'set_variant_override', args: { variantId, clipId: top.clipId, hidden: true } }]).doc;
    expect(words(worded, t.id, 0)).toBe('1 ביוני 2021'); // the master: the upper picture
    const projected = projectVariant(worded, variantId);
    expect(resolveFields(projected, projected.mainSequenceId, textClip(projected, t.id), f(0)).text).toBe('25.12.2024'); // the format: its wording, and the picture it shows
  });
  it('the same answers with a kept index, without one, and with an index of another document', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 150).doc;
    d = place(d, lib.newYear, 150, 600).doc;
    const t = title(d, '{date} {hebrewYear} {event}', 0, 750);
    const ev = withEvent(t.doc, [lib.evening], { afterSunset: true });
    const index = makeFieldIndex(ev.doc), other = makeFieldIndex(t.doc);
    for (const frame of [0, 100, 149, 150, 449, 450, 749]) {
      const plain = at(ev.doc, t.id, frame);
      expect(at(ev.doc, t.id, frame, { index }), String(frame)).toEqual(plain);
      expect(at(ev.doc, t.id, frame, { index }), String(frame)).toEqual(plain); // asked again: the kept work gives the same
      expect(at(ev.doc, t.id, frame, { index: other }), String(frame)).toEqual(plain); // an index of another document is not used
    }
    expect(index.doc).toBe(ev.doc);
  });
  it('never throws on a document the schema accepts: a clip of a missing file, a time no clock can count in, a title that is not in the sequence', () => {
    const lib = library();
    const c = place(lib.doc, lib.newYear, 0, 300);
    const made = title(c.doc, '{date} {hebrewDate} {event}', 0, 300);
    const t = { id: made.id, doc: tx(made.doc, [{ op: 'update_text', args: { clipId: made.id, text: '{date} {hebrewDate} {event} {age:per_1}' } }]).doc };
    const stampOn = (doc: ProjectDocument, clipId: string, frame: number) => stampText(doc, doc.mainSequenceId, findClip(doc, clipId)!.clip, f(frame), { clock: true });
    // the file is gone from the library (an archive made by hand)
    const gone = structuredClone(t.doc);
    delete gone.assets[lib.newYear];
    expect(at(gone, t.id, 10)).toMatchObject({ text: '   ', anchor: null });
    expect(stampOn(gone, c.clipId, 10)).toBe('');
    // a source position far beyond any clock
    const far = structuredClone(t.doc);
    (findClip(far, c.clipId)!.clip as { sourceIn: T.RationalTime }).sourceIn = T.rt('9'.repeat(40), 1);
    expect(at(far, t.id, 10).text).toMatch(/^[^{}]*$/);
    expect(stampOn(far, c.clipId, 10)).toMatch(/^[0-9 .:'\/-]{0,20}$/);
    // a date at the very end of the years, ticking past them: shown as the clock says
    const late = tx(t.doc, [{ op: 'set_asset_capture', args: { assetId: lib.newYear, capture: { at: '2100-12-31T23:59:55' } } }]).doc;
    expect(words(late, t.id, 299).startsWith('1 בינואר 2101')).toBe(true);
    // an unknown sequence, and a title of another document
    const clip = textClip(t.doc, t.id);
    expect(resolveFields(t.doc, 'seq_none', clip, f(0)).anchor).toBeNull();
    expect(resolveFields(t.doc, 'constructor', clip, f(0)).anchor).toBeNull();
    expect(resolveFields(lib.doc, lib.doc.mainSequenceId, clip, f(0))).toMatchObject({ anchor: null, missing: [{ reason: 'no_date' }, { reason: 'no_date' }, { reason: 'no_date' }, { reason: 'unknown_person' }] });
    expect(fieldSpans(t.doc, 'seq_none', clip).length).toBe(1);
    expect(stampText(t.doc, 'seq_none', clip, f(0), {})).toBe('');
    // times far outside the title, and before zero
    for (const time of [T.rt(-5, 1), T.rt(100000, 1), T.rt(1, 3)]) expect(() => resolveFields(t.doc, t.doc.mainSequenceId, clip, time)).not.toThrow();
  });
});

describe('the values of a title over its span', () => {
  it('one stretch per value and picture: a cut under the title, and a midnight found to the frame at any speed', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 150).doc;
    d = place(d, lib.summer, 150, 150).doc;
    const t = title(d, '{date:numeric}', 0, 300);
    const spans = fieldSpans(t.doc, t.doc.mainSequenceId, textClip(t.doc, t.id));
    expect(spans.map((s) => [s.startFrame, s.endFrame, s.resolved.text])).toEqual([[0, 150, '25.12.2024'], [150, 300, '1.6.2021']]);
    expect(spans[1]!.resolved.anchor!.wall).toBe('2021-06-01T10:00:00'); // the value at the stretch's first frame
    // midnight inside one clip: 23:59:50 at frame 0, so the new year begins at frame 300
    const ny = title(place(lib.doc, lib.newYear, 0, 900).doc, '{date:numeric} {year}', 0, 900);
    expect(fieldSpans(ny.doc, ny.doc.mainSequenceId, textClip(ny.doc, ny.id)).map((s) => [s.startFrame, s.endFrame, s.resolved.text])).toEqual([[0, 300, '31.12.2024 2024'], [300, 900, '1.1.2025 2025']]);
    // at half speed the same midnight is at frame 600; at a speed that is not a whole number it is still found to the frame
    const slow = place(lib.doc, lib.newYear, 0, 900);
    const half = title(tx(slow.doc, [{ op: 'set_clip_speed', args: { clipId: slow.clipId, speed: 0.5 } }]).doc, '{year}', 0, 900);
    expect(fieldSpans(half.doc, half.doc.mainSequenceId, textClip(half.doc, half.id)).map((s) => [s.startFrame, s.endFrame, s.resolved.text])).toEqual([[0, 600, '2024'], [600, 900, '2025']]);
    const odd = place(lib.doc, lib.newYear, 0, 900);
    const third = title(tx(odd.doc, [{ op: 'set_clip_speed', args: { clipId: odd.clipId, speed: 0.7 } }]).doc, '{year}', 0, 900);
    const thirdSpans = fieldSpans(third.doc, third.doc.mainSequenceId, textClip(third.doc, third.id));
    expect(thirdSpans.map((s) => s.resolved.text)).toEqual(['2024', '2025']);
    const change = thirdSpans[1]!.startFrame; // 10 source seconds at 0.7: timeline second 14.29 → frame 429
    expect(change).toBe(429);
    expect(words(third.doc, third.id, change - 1)).toBe('2024');
    expect(words(third.doc, third.id, change)).toBe('2025');
    // two clips of the same day: the words are the same, the picture they come from is not, so they are two stretches (an
    // export check names the clip); "make it plain text" does not call that a value that changes
    let same = place(lib.doc, lib.evening, 0, 100).doc;
    same = place(same, lib.evening, 100, 100, { sourceIn: f(600) }).doc;
    const st = title(same, '{date}', 0, 200);
    expect(fieldSpans(st.doc, st.doc.mainSequenceId, textClip(st.doc, st.id)).map((s) => [s.startFrame, s.endFrame, s.resolved.text])).toEqual([[0, 100, '25 בדצמבר 2024'], [100, 200, '25 בדצמבר 2024']]);
    expect(freezeOps(st.doc, st.doc.mainSequenceId, st.id).varies).toBe(false);
  });
  it('a stretch without data is a stretch of its own, with the reason; the stretches cover the title exactly', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 30, 60).doc;
    d = place(d, lib.undated, 90, 60).doc;
    const t = title(d, '{date:numeric}', 60, 120); // over the dated clip, then the undated one, then black
    const spans = fieldSpans(t.doc, t.doc.mainSequenceId, textClip(t.doc, t.id));
    expect(spans.map((s) => [s.startFrame, s.endFrame, s.resolved.text, s.resolved.missing.map((m) => m.reason).join(), s.resolved.anchor?.how ?? null])).toEqual([
      [60, 90, '25.12.2024', '', 'under'], [90, 150, '', 'no_date', null], [150, 180, '25.12.2024', '', 'previous'],
    ]);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startFrame).toBe(spans[i - 1]!.endFrame);
    // each frame of the title resolves to the value of its stretch
    for (const s of spans) for (const frame of [s.startFrame, s.endFrame - 1]) expect(words(t.doc, t.id, frame)).toBe(s.resolved.text);
  });
});

describe('the capture-sourced date stamp', () => {
  const stamp = (doc: ProjectDocument, clipId: string, frame: number, style: { clock?: boolean; dateOrder?: 'ymd' | 'dmy' } = {}) => stampText(doc, doc.mainSequenceId, findClip(doc, clipId)!.clip, f(frame), style);
  it('a picture clip shows the date of its own file, in the camcorder order or day first, with the clock when asked; the minute advances with the source', () => {
    const lib = library();
    const c = place(lib.doc, lib.newYear, 0, 900);
    expect(stamp(c.doc, c.clipId, 0)).toBe("'24 12 31");
    expect(stamp(c.doc, c.clipId, 0, { dateOrder: 'dmy' })).toBe('31.12.2024');
    expect(stamp(c.doc, c.clipId, 0, { dateOrder: 'ymd' })).toBe("'24 12 31");
    expect(stamp(c.doc, c.clipId, 0, { clock: true })).toBe("'24 12 31 23:59");
    expect(stamp(c.doc, c.clipId, 299, { clock: true })).toBe("'24 12 31 23:59");
    expect(stamp(c.doc, c.clipId, 300, { clock: true })).toBe("'25 1 1 00:00");
    expect(stamp(c.doc, c.clipId, 300, { clock: true, dateOrder: 'dmy' })).toBe('1.1.2025 00:00');
    const e = place(lib.doc, lib.evening, 0, 1800);
    expect(stamp(e.doc, e.clipId, 0, { clock: true })).toBe("'24 12 25 17:30");
    expect(stamp(e.doc, e.clipId, 1799, { clock: true })).toBe("'24 12 25 17:30");
    expect(stamp(tx(e.doc, [{ op: 'set_asset_capture', args: { assetId: lib.evening, capture: { at: '2005-07-04T09:05:30' } } }]).doc, e.clipId, 900, { clock: true })).toBe("'05 7 4 09:06");
    // no date: nothing; a date without a time: no clock
    const u = place(lib.doc, lib.undated, 0, 300);
    expect(stamp(u.doc, u.clipId, 0, { clock: true })).toBe('');
    const s = place(lib.doc, lib.still, 0, 300);
    expect(stamp(s.doc, s.clipId, 0, { clock: true })).toBe("'24 3 24");
  });
  it('on an adjustment clip or a title it shows the topmost dated picture under it, and nothing over black', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 150).doc;
    d = place(d, lib.undated, 150, 150).doc;
    const adj = tx(d, [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(400) }, effects: [{ type: 'stylize.date-stamp', params: { source: 'capture' } }] } }]);
    const adjId = adj.results[0]!.output!.clipId as string;
    expect(stamp(adj.doc, adjId, 60, { clock: true })).toBe("'24 12 25 17:30");
    expect(stamp(adj.doc, adjId, 200)).toBe(''); // an undated picture: rule 1 only, no reaching for another clip
    expect(stamp(adj.doc, adjId, 350)).toBe(''); // black
    const t = tx(adj.doc, [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(400) } }]);
    expect(stamp(t.doc, t.results[0]!.output!.clipId as string, 60)).toBe("'24 12 25");
    expect(stamp(t.doc, t.results[0]!.output!.clipId as string, 200)).toBe('');
  });
  it('always fits the stamp\'s own pattern, for any capture, time and style (property)', () => {
    const lib = library();
    const c = place(lib.doc, lib.evening, 0, 1800);
    let s = 99;
    const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const int = (k: number) => Math.floor(rnd() * k), two = (x: number) => String(x).padStart(2, '0');
    for (let i = 0; i < 400; i++) {
      const day = `${1900 + int(201)}-${two(1 + int(12))}-${two(1 + int(28))}`;
      const capture = rnd() < 0.3 ? null : { at: rnd() < 0.2 ? day : `${day}T${two(int(24))}:${two(int(60))}:${two(int(60))}`, utcOffsetMinutes: [null, 120, 180, -300][int(4)]! };
      const d = capture ? tx(c.doc, [{ op: 'set_asset_capture', args: { assetId: lib.evening, capture } }]).doc : tx(c.doc, [{ op: 'set_asset_capture', args: { assetId: lib.evening, capture: null } }]).doc;
      const style = { clock: rnd() < 0.5, dateOrder: (['ymd', 'dmy'] as const)[int(2)]! };
      const text = stampText(d, d.mainSequenceId, findClip(d, c.clipId)!.clip, f(int(1800)), style);
      expect(text, JSON.stringify([capture, style])).toMatch(/^[0-9 .:'\/-]{0,20}$/);
      expect(text === '', JSON.stringify(capture)).toBe(capture === null);
    }
  });
});

describe('"make it plain text" as literal operations', () => {
  it('writes what the title shows, in the master and in each format\'s own wording, and turns the fields off; the picture does not change', () => {
    const lib = library();
    const base = place(lib.doc, lib.evening, 0, 300).doc;
    const t = title(base, 'צולם ב־{date} · {{x}} · {event}', 0, 300);
    const named = withEvent(t.doc, [lib.evening], { name: 'נר ראשון {בבית}' });
    const v = tx(named.doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const d = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: t.id, text: '{date:numeric}' } }]).doc;
    const shown = words(d, t.id, 0);
    expect(shown).toBe('צולם ב־25 בדצמבר 2024 · {x} · נר ראשון {בבית}');
    const frozen = freezeOps(d, d.mainSequenceId, t.id);
    expect(frozen).toMatchObject({ varies: false, missing: [], tooLong: [] });
    expect(frozen.ops).toEqual([
      { op: 'update_text', args: { clipId: t.id, text: 'צולם ב־25 בדצמבר 2024 · {{x}} · נר ראשון {{בבית}}' } },
      { op: 'set_variant_override', args: { variantId, clipId: t.id, text: '25.12.2024' } },
      { op: 'set_text_fields', args: { clipId: t.id, enabled: false } },
    ]);
    const after = tx(d, frozen.ops).doc;
    const clip = textClip(after, t.id);
    expect(clip.fields).toBeUndefined();
    expect(clip.text).toBe(shown);
    expect(after.variants[variantId]!.overrides[t.id]!.text).toBe('25.12.2024');
    expect(words(after, t.id, 0)).toBe(shown); // a plain title now: drawn verbatim
    const projected = projectVariant(after, variantId);
    expect(textClip(projected, t.id).text).toBe('25.12.2024');
    // nothing derived is stored by an operation of its own: the log holds only literal texts, so it replays the same whatever the tables say later
    expect(frozen.ops.map((o) => o.op)).toEqual(['update_text', 'set_variant_override', 'set_text_fields']);
  });
  it('says what stands in the way: a field without data, a value that changes inside the title, a text that would be too long', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 150).doc;
    d = place(d, lib.summer, 150, 150).doc;
    const t = title(d, '{date:numeric} {hebrewDate}', 0, 300);
    const first = freezeOps(t.doc, t.doc.mainSequenceId, t.id);
    expect(first.varies).toBe(true);
    expect(first.missing).toEqual([{ variantId: null, token: '{hebrewDate}', reason: 'sunset_undecided' }]);
    // frozen at another moment of the title: the value there
    const later = freezeOps(t.doc, t.doc.mainSequenceId, t.id, f(200));
    expect(later.missing).toEqual([]);
    expect(later.ops[0]).toEqual({ op: 'update_text', args: { clipId: t.id, text: '1.6.2021 כ״א בסיוון תשפ״א' } });
    // outside the title, or not a title with fields: a RangeError, not a refusal (this is a helper, not an operation)
    expect(() => freezeOps(t.doc, t.doc.mainSequenceId, t.id, f(300))).toThrow(RangeError);
    expect(() => freezeOps(t.doc, t.doc.mainSequenceId, 'clp_none')).toThrow(RangeError);
    expect(() => freezeOps(t.doc, 'seq_none', t.id)).toThrow(RangeError);
    const plain = tx(lib.doc, [{ op: 'add_text', args: { text: '{date}', start: f(0), duration: f(30) } }]);
    expect(() => freezeOps(plain.doc, plain.doc.mainSequenceId, plain.results[0]!.output!.clipId as string)).toThrow(RangeError);
    // too long once the name is in
    const long = title(place(lib.doc, lib.evening, 0, 300).doc, `${'א'.repeat(1990)}{event}`, 0, 300);
    const named = withEvent(long.doc, [lib.evening], { name: 'ש'.repeat(120) });
    expect(freezeOps(named.doc, named.doc.mainSequenceId, long.id)).toMatchObject({ tooLong: [null], missing: [] });
  });
  it('a format that hides the picture the master takes its date from keeps its own words', () => {
    const lib = library();
    let d = place(lib.doc, lib.evening, 0, 300).doc;
    d = tx(d, [{ op: 'add_track', args: { kind: 'video' } }]).doc;
    const top = place(d, lib.summer, 0, 300, { trackId: trackOf(d, 'video')[1]!.id });
    const t = title(top.doc, '{date:numeric}', 0, 300);
    const v = tx(t.doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const hidden = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: top.clipId, hidden: true } }]).doc;
    const frozen = freezeOps(hidden, hidden.mainSequenceId, t.id);
    expect(frozen.ops).toEqual([
      { op: 'update_text', args: { clipId: t.id, text: '1.6.2021' } },
      { op: 'set_variant_override', args: { variantId, clipId: t.id, text: '25.12.2024' } },
      { op: 'set_text_fields', args: { clipId: t.id, enabled: false } },
    ]);
    const after = tx(hidden, frozen.ops).doc;
    expect(textClip(projectVariant(after, variantId), t.id).text).toBe('25.12.2024');
    expect(textClip(after, t.id).text).toBe('1.6.2021');
  });
});

describe('validation of the field grammar', () => {
  it('a title with fields cannot be left holding a brace group that is not a field, in its text or in a format\'s wording; a plain title can hold anything', () => {
    const lib = library();
    const t = title(place(lib.doc, lib.evening, 0, 300).doc, '{date}', 0, 300);
    expect(lifeIssues(t.doc)).toEqual([]);
    const refused = (ops: OpCall[]) => { try { tx(t.doc, ops); return null; } catch (e) { if (!(e instanceof OpError)) throw e; return e; } };
    const typo = refused([{ op: 'update_text', args: { clipId: t.id, text: '{date} {weather} {' } }])!;
    expect(typo.code).toBe('invalid_result');
    expect(typo.message).toBe(`transaction would produce an invalid project: title ${t.id} has live fields, and these brace groups in it are not fields: {weather}, {`);
    expect((typo.details.issues as { code: string; ids: string[] }[])[0]).toMatchObject({ code: 'life_unknown_field', ids: [t.id] });
    const v = tx(t.doc, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    let thrown: OpError | null = null;
    try { tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: t.id, text: 'a } b' } }]); } catch (e) { thrown = e as OpError; }
    expect(thrown!.code).toBe('invalid_result');
    expect((thrown!.details.issues as { code: string; ids: string[]; message: string }[])[0]).toMatchObject({ code: 'life_unknown_field', ids: [t.id, variantId], message: `title ${t.id} has live fields, and these brace groups in its wording for format ${variantId} are not fields: }` });
    // doubled braces and fields are fine; a people field is not an issue here (it has no words, and the export check says so)
    expect(tx(t.doc, [{ op: 'update_text', args: { clipId: t.id, text: '{{x}} {hebrewDate:noYear} {age:per_1}' } }]).doc).toBeDefined();
    // a plain title is not looked at
    const plain = tx(t.doc, [{ op: 'add_text', args: { text: '{weather} { }', start: f(0), duration: f(30) } }]).doc;
    expect(validateProject(plain)).toEqual([]);
    expect(lifeIssues(createProject({ id: 'p', name: 'P' }))).toEqual([]);
  });
  it('two operations in one transaction give the same document as two transactions: nothing is kept between the operations of a draft', () => {
    const lib = library();
    const base = place(lib.doc, lib.evening, 0, 300).doc;
    const r = tx(base, [{ op: 'add_text', args: { text: 'a { b', start: f(0), duration: f(300) } }]);
    const id = r.results[0]!.output!.clipId as string;
    const text = { op: 'update_text', args: { clipId: id, text: 'a {{ b {date}' } }, on = { op: 'set_text_fields', args: { clipId: id, enabled: true } };
    const together = applyTransaction(r.doc, [text, on], { idSeed: 'same_', actor: 'test' }).doc;
    const apart = applyTransaction(applyTransaction(r.doc, [text], { idSeed: 'same_', actor: 'test' }).doc, [on], { idSeed: 'same2_', actor: 'test' }).doc;
    expect(creativeProjection(together)).toBe(creativeProjection(apart));
    expect(words(together, id, 0)).toBe('a { b 25 בדצמבר 2024');
    // the other order is refused in one transaction as in two: the brace is not doubled yet when the fields are turned on
    expect(() => tx(r.doc, [on, text])).toThrow(/these brace groups are not fields: \{/);
    // an event changed and read in the same transaction: the second operation sees the first one's result
    const ev = tx(base, [{ op: 'add_event', args: { assetIds: [lib.evening] } }]);
    const eventId = ev.results[0]!.output!.eventId as string;
    const both = tx(ev.doc, [{ op: 'update_event', args: { eventId, addAssetIds: [lib.summer] } }, { op: 'update_event', args: { eventId, removeAssetIds: [lib.evening] } }]);
    expect(both.doc.events[eventId]!.assetIds).toEqual([lib.summer]);
    // and a file removed from the library in the same transaction as its event was made leaves no trace of itself there
    const made = tx(base, [{ op: 'add_event', args: { assetIds: [lib.summer, lib.undated] } }, { op: 'remove_asset', args: { assetId: lib.undated } }]);
    expect(Object.values(made.doc.events)[0]!.assetIds).toEqual([lib.summer]);
  });
});
