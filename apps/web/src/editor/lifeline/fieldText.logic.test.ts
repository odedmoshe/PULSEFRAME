/** Caret insertion, the readable text box and its round trip, the live line and "make it plain text" (fieldText.logic.ts), against the real operations. */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, resolveFields, validateProject, type OpCall, type ProjectDocument, type TextClip } from '@pulseframe/core';
import { boxText, commitBox, fixFor, fixedItems, freezeModel, insertField, insertOps, liveModel, personItems, pictureUnder, timeInTitle, valueAt } from './fieldText.logic.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `f${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-15T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance };

/** A dated 20 s video under a 4 s title that holds `text` (fields off), and a person born on 2021-06-01. */
function project(text: string, opts: { dated?: boolean; person?: boolean } = {}) {
  let r = tx(createProject({ id: 'prj_f', name: 'F', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.ZERO } }, { op: 'add_text', args: { text, start: T.ZERO, duration: T.rt(4, 1) } }]);
  if (opts.dated !== false) r = tx(r.doc, [{ op: 'set_asset_capture', args: { assetId, capture: { at: '2024-12-25T10:00:00' } } }]);
  let personId: string | null = null;
  if (opts.person) { r = tx(r.doc, [{ op: 'add_person', args: { name: 'נועה', birthDate: '2021-06-01', form: 'f' } }]); personId = Object.keys(r.doc.people!)[0]!; }
  const seq = r.doc.mainSequenceId;
  const title = r.doc.sequences[seq]!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text') as TextClip;
  expect(validateProject(r.doc)).toEqual([]);
  return { doc: r.doc, seq, title, assetId, personId };
}
const title = (doc: ProjectDocument, id: string) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === id) as TextClip;

describe('insertion at the caret', () => {
  it('without fields: braces already in the text are doubled, the token goes at the caret, fields are switched on', () => {
    const { doc } = project('x');
    const r = insertField({ lang: 'he', doc, shown: 'שלום {עולם} יפה', caret: 5, fieldsOn: false, token: '{date:numeric}' });
    expect(r.ok && r.value).toEqual({ text: 'שלום {date:numeric}{{עולם}} יפה', caret: 5 + '{date:numeric}'.length, enable: true });
  });
  it('the caret is clamped, and null means the end', () => {
    const { doc } = project('x');
    const at = (caret: number | null) => { const r = insertField({ lang: 'en', doc, shown: 'ab', caret, fieldsOn: false, token: '{year}' }); return r.ok ? r.value.text : null; };
    expect(at(null)).toBe('ab{year}'); expect(at(0)).toBe('{year}ab'); expect(at(1)).toBe('a{year}b'); expect(at(99)).toBe('ab{year}'); expect(at(-3)).toBe('{year}ab');
  });
  it('with fields on: the readable form gets the readable token and is read back to the stored form', () => {
    const { doc } = project('x');
    const r = insertField({ lang: 'he', doc, shown: 'ב־{תאריך} ', caret: 'ב־{תאריך} '.length, fieldsOn: true, token: '{year}' });
    expect(r.ok && r.value.text).toBe('ב־{date} {year}');
    expect(r.ok && r.value.enable).toBe(false);
  });
  it('the whole insertion is one transaction that leaves the stored text equal to the literal title plus the field', () => {
    const { doc, title: t, seq } = project('{braces} stay');
    const ins = insertField({ lang: 'he', doc, shown: t.text, caret: t.text.length, fieldsOn: !!t.fields, token: '{date:numeric}' });
    if (!ins.ok) throw new Error('refused');
    const after = tx(doc, insertOps(t.id, ins.value)).doc;
    expect(title(after, t.id).text).toBe('{{braces}} stay{date:numeric}');
    expect(title(after, t.id).fields).toBe(true);
    // the words shown: the literal title, braces as typed, then the capture date
    expect(resolveFields(after, seq, title(after, t.id), T.ZERO).text).toBe('{braces} stay25.12.2024');
    expect(liveModel(after, seq, title(after, t.id), T.ZERO).text).toBe('{braces} stay25.12.2024');
  });
  it('a person field is inserted by name in the readable form and stored by id', () => {
    const { doc, personId } = project('x', { person: true });
    const first = insertField({ lang: 'he', doc, shown: 'x', caret: 1, fieldsOn: false, token: `{age:${personId}}` });
    if (!first.ok) throw new Error('refused');
    expect(first.value.text).toBe(`x{age:${personId}}`);
  });
});

describe('the readable text box', () => {
  it('shows the readable form of a title with fields and the text itself otherwise', () => {
    const { doc } = project('x');
    expect(boxText('he', doc, { text: 'ב־{date:numeric} {event}', fields: true })).toBe('ב־{תאריך: מספרי} {אירוע}');
    expect(boxText('en', doc, { text: '{date:numeric}', fields: true })).toBe('{date: numeric}');
    expect(boxText('he', doc, { text: '{date}', fields: undefined })).toBe('{date}');
  });
  it('round trip: readable -> stored -> readable is the identity for every item of the menu, in both languages', () => {
    const { doc } = project('x', { person: true });
    const tokens = [...fixedItems().map((i) => i.token), ...personItems(doc).map((i) => i.token)];
    expect(tokens.length).toBeGreaterThan(10);
    for (const lang of ['he', 'en'] as const) for (const token of tokens) {
      const shown = boxText(lang, doc, { text: `a ${token} {{b}}`, fields: true });
      const back = commitBox(lang, doc, { id: 'c', text: 'zzz', fields: true }, shown);
      expect(back.kind, `${lang} ${token}`).toBe('ops');
      if (back.kind === 'ops') expect(back.ops[0]!.args).toEqual({ clipId: 'c', text: `a ${token} {{b}}` });
    }
  });
  it('a group that is not a field, and a person who is not in the project, are refused by name; unchanged or empty text commits nothing', () => {
    const { doc } = project('x', { person: true });
    const bad = commitBox('he', doc, { id: 'c', text: 'x', fields: true }, 'שלום {משהו}');
    expect(bad).toEqual({ kind: 'error', problems: [{ token: '{משהו}', reason: 'unknown_field' }] });
    const stranger = commitBox('he', doc, { id: 'c', text: 'x', fields: true }, '{גיל: דנה}');
    expect(stranger.kind === 'error' && stranger.problems[0]).toEqual({ token: '{גיל: דנה}', reason: 'unknown_person' });
    expect(commitBox('he', doc, { id: 'c', text: 'x', fields: true }, 'x')).toEqual({ kind: 'none' });
    expect(commitBox('he', doc, { id: 'c', text: 'x', fields: undefined }, '')).toEqual({ kind: 'none' });
    expect(commitBox('he', doc, { id: 'c', text: 'x', fields: undefined }, 'y').kind).toBe('ops');
  });
});

describe('values at the playhead and the live line', () => {
  it('every item shows its words, or says there is no data', () => {
    const { doc, title: t, seq } = project('x');
    expect(valueAt(doc, seq, t, T.ZERO, '{date}')).toEqual({ words: '25 בדצמבר 2024' });
    expect(valueAt(doc, seq, t, T.ZERO, '{date:numeric}')).toEqual({ words: '25.12.2024' });
    expect(valueAt(doc, seq, t, T.ZERO, '{hebrewDate}')).toEqual({ words: 'כ״ד בכסלו תשפ״ה' });
    expect(valueAt(doc, seq, t, T.ZERO, '{year}')).toEqual({ words: '2024' });
    expect(valueAt(doc, seq, t, T.ZERO, '{event}')).toEqual({ missing: 'no_event_name' });
    const undated = project('x', { dated: false });
    expect(valueAt(undated.doc, undated.seq, undated.title, T.ZERO, '{date}')).toEqual({ missing: 'no_date' });
  });
  it('the age field reads the person at the picture date', () => {
    const { doc, title: t, seq, personId } = project('x', { person: true });
    expect(valueAt(doc, seq, t, T.ZERO, `{age:${personId}}`)).toEqual({ words: expect.stringContaining('3') });
    expect(valueAt(doc, seq, t, T.ZERO, `{name:${personId}}`)).toEqual({ words: 'נועה' });
  });
  it('a missing field has a reason and the fix that belongs to it', () => {
    const { doc, seq, title: t } = project('{date}', { dated: false });
    const on = tx(doc, [{ op: 'set_text_fields', args: { clipId: t.id, enabled: true } }]).doc;
    const m = liveModel(on, seq, title(on, t.id), T.ZERO);
    expect(m.problems).toEqual([{ token: '{date}', reason: 'no_date', fix: 'set_date' }]);
    expect(fixFor('sunset_undecided')).toBe('choose_event'); expect(fixFor('no_event_name')).toBe('choose_event'); expect(fixFor('unknown_person')).toBe('people');
    expect(fixFor('before_birth')).toBe('people'); expect(fixFor('unknown_age_format')).toBe('rewrite');
  });
  it('the picture under a title is found for the date fix', () => {
    const { doc, seq, assetId } = project('x', { dated: false });
    expect(pictureUnder(doc, seq, T.ZERO)).toBe(assetId);
    expect(pictureUnder(doc, seq, T.rt(99, 1))).toBeNull();
  });
  it('the playhead is read inside the title only', () => {
    const t = { start: T.rt(2, 1), duration: T.rt(3, 1) };
    expect(timeInTitle(t, T.rt(3, 1))).toEqual(T.rt(3, 1));
    expect(T.eq(timeInTitle(t, T.rt(0, 1)), T.rt(2, 1))).toBe(true);
    expect(T.eq(timeInTitle(t, T.rt(9, 1)), T.rt(2, 1))).toBe(true);
  });
});

describe('make it plain text', () => {
  it('commits the literal words and leaves what is shown exactly as it was', () => {
    const { doc, title: t, seq } = project('{date:numeric} · {{braces}}');
    const on = tx(doc, [{ op: 'set_text_fields', args: { clipId: t.id, enabled: true } }]).doc;
    const before = resolveFields(on, seq, title(on, t.id), T.ZERO).text;
    const f = freezeModel(on, seq, title(on, t.id), T.ZERO)!;
    expect(f.ready).toBe(true);
    const off = tx(on, f.ops).doc;
    expect(title(off, t.id).fields).toBeUndefined();
    expect(title(off, t.id).text).toBe(before);
  });
  it('is not ready while a field has no data', () => {
    const { doc, title: t, seq } = project('{date}', { dated: false });
    const on = tx(doc, [{ op: 'set_text_fields', args: { clipId: t.id, enabled: true } }]).doc;
    const f = freezeModel(on, seq, title(on, t.id), T.ZERO)!;
    expect(f.ready).toBe(false);
    expect(f.missing[0]).toMatchObject({ token: '{date}', reason: 'no_date' });
  });
  it('a title that is not live has nothing to freeze', () => {
    const { doc, title: t, seq } = project('plain');
    expect(freezeModel(doc, seq, t, T.ZERO)).toBeNull();
  });
});
