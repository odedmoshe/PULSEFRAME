/**
 * The people of a project, W1's half (ADR-0021, people section): the three operations with every refusal of PEOPLE_REFUSALS
 * provoked in the order of the rules, exact undo and redo through the entity diff; documentPeople (what {name:…} and {age:…}
 * show, and why not); fieldUsersOfPerson; the readable form of people fields in the editor (both languages, round trip); and
 * the privacy rule of core: no summary, refusal message or refusal detail holds a birth date or the word choice.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, creativeProjection, diffEntities, documentPeople, fieldsFromDisplay, fieldsToDisplay, fieldUsersOfPerson, findClip, freezeOps, makeFieldIndex, MAX_PEOPLE, NO_PEOPLE, OpError,
  PEOPLE_FIELDS_BUILT, PEOPLE_OPS_BUILT, PEOPLE_REFUSALS, PERSON_SUMMARIES, ProjectSchema, resolveFields, restoreEntities, validateProject,
  type Capture, type OpCall, type PeopleRefusalKey, type Person, type ProjectDocument, type TextClip,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (frame: number) => T.frameTime(frame, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pp${n++}_`, actor: 'tester', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = (hash: string, capture?: Capture) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov, ...(capture ? { capture } : {}) });
const refusal = (doc: ProjectDocument, ops: OpCall[]): OpError => { try { tx(doc, ops); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error(`not refused: ${JSON.stringify(ops).slice(0, 200)}`); };
/** Undo and redo of one accepted transaction through the entity diff, as the store does it: both exact, in the creative projection and byte for byte. */
function undoRedo(before: ProjectDocument, after: ProjectDocument, what: string) {
  const changes = diffEntities(before, after);
  const back = structuredClone(after);
  restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back), `${what}: undo`).toBe(creativeProjection(before));
  expect(back, `${what}: undo`).toEqual(before);
  expect(validateProject(back), `${what}: undo`).toEqual([]);
  const again = structuredClone(back);
  restoreEntities(again, changes.map((c) => ({ id: c.id, state: c.after })));
  expect(creativeProjection(again), `${what}: redo`).toBe(creativeProjection(after));
  expect(again, `${what}: redo`).toEqual(after);
}
/** Every birth date this file uses, in the spellings a leak could take. */
const DATES = /2016|2018|2020|11-04|4\.11|1900|2100-12/;

/** Two dated clips one after the other (2019-11-03 and 2019-11-04 at 10:00), a title over both, and nobody yet. */
function project() {
  let r = tx(createProject({ id: 'prj_people', name: 'People', width: 640, height: 360, frameRate: R }), [
    { op: 'import_asset', args: { asset: video('a', { at: '2019-11-03T10:00:00', utcOffsetMinutes: 120, source: 'container' }) } },
    { op: 'import_asset', args: { asset: video('b', { at: '2019-11-04T10:00:00', utcOffsetMinutes: 120, source: 'container' }) } },
    { op: 'import_asset', args: { asset: video('c') } },
  ], true);
  const [a, b, c] = r.results.map((x) => x.output!.assetId as string) as [string, string, string];
  r = tx(r.doc, [
    { op: 'add_clip', args: { assetId: a, start: f(0), duration: f(60) } },
    { op: 'add_clip', args: { assetId: b, start: f(60), duration: f(60) } },
    { op: 'add_clip', args: { assetId: c, start: f(120), duration: f(60) } },
    { op: 'add_text', args: { text: 'T', start: f(0), duration: f(180) } },
  ]);
  return { doc: r.doc, titleId: r.results[3]!.output!.clipId as string };
}
const add = (args: Record<string, unknown>): OpCall => ({ op: 'add_person', args });
/** A project with Noa (born 2016-11-04, «בת») and Itai (no birth date), added through the operation. */
function withNoa() {
  const p = project();
  const r = tx(p.doc, [add({ name: 'נועה', birthDate: '2016-11-04', form: 'f' }), add({ name: 'איתי' })]);
  return { ...p, doc: r.doc, noa: r.results[0]!.output!.personId as string, itai: r.results[1]!.output!.personId as string };
}

describe('people operations: built', () => {
  it('the flags are set', () => {
    expect(PEOPLE_OPS_BUILT).toBe(true);
    expect(PEOPLE_FIELDS_BUILT).toBe(true);
  });
});

describe('add_person', () => {
  it('adds a person with a deterministic id, the name stored trimmed in NFC, the birth date and the word choice; the summary names the person only', () => {
    const p = project();
    const r = tx(p.doc, [add({ name: '  José ', birthDate: '2016-11-04', form: 'm' }), add({ name: 'סבתא רבקה', birthDate: null, form: null }), add({ name: 'איתי' })]);
    const [a, b, c] = r.results.map((x) => x.output!.personId as string) as [string, string, string];
    for (const id of [a, b, c]) expect(id).toMatch(/^per_[A-Za-z0-9_-]+$/);
    expect(r.doc.people).toEqual({ [a]: { id: a, name: 'José', birthDate: '2016-11-04', form: 'm' }, [b]: { id: b, name: 'סבתא רבקה', birthDate: null }, [c]: { id: c, name: 'איתי', birthDate: null } });
    expect(r.results.map((x) => x.summary)).toEqual([PERSON_SUMMARIES.added('José'), PERSON_SUMMARIES.added('סבתא רבקה'), PERSON_SUMMARIES.added('איתי')]);
    expect(r.results[0]!.affectedIds).toEqual([a]);
    expect(JSON.stringify(r.results)).not.toMatch(DATES);
    expect(ProjectSchema.parse(r.doc)).toEqual(r.doc);
    // the same seed gives the same ids (replay)
    expect(applyTransaction(p.doc, [add({ name: 'x' })], { idSeed: 'same_', actor: 't' }).results[0]!.output).toEqual(applyTransaction(p.doc, [add({ name: 'x' })], { idSeed: 'same_', actor: 't' }).results[0]!.output);
    undoRedo(p.doc, r.doc, 'add_person');
    // the first person undone: no `people` key, the document as it was stored
    const undone = structuredClone(r.doc);
    restoreEntities(undone, diffEntities(p.doc, r.doc).map((x) => ({ id: x.id, state: x.before })));
    expect('people' in undone).toBe(false);
  });
  it('refuses in the order of the rules, each with its code, the fixed wording and no birth date anywhere', () => {
    const { doc } = withNoa();
    const cases: [PeopleRefusalKey, Record<string, unknown>][] = [
      ['personNameCharacters', { name: 'a{b', birthDate: '2021-02-30' }],
      ['personNameCharacters', { name: 'x:y' }], ['personNameCharacters', { name: 'p|q' }], ['personNameCharacters', { name: 'a\nb' }], ['personNameCharacters', { name: 'a}' }],
      ['personNameEmpty', { name: '   ', birthDate: '2021-02-30' }],
      ['noSuchBirthDay', { name: 'נועה', birthDate: '2021-02-30' }], ['noSuchBirthDay', { name: 'z', birthDate: '2101-02-29' }],
      ['birthDateOutOfRange', { name: 'נועה', birthDate: '1899-12-31' }], ['birthDateOutOfRange', { name: 'z', birthDate: '2101-01-01' }],
      ['personNameTaken', { name: '  נועה ', birthDate: '2018-01-01' }],
    ];
    for (const [key, args] of cases) {
      const e = refusal(doc, [add(args)]);
      expect([e.code, e.message], `${key} ${JSON.stringify(args)}`).toEqual([PEOPLE_REFUSALS[key].code, key === 'personNameTaken' ? PEOPLE_REFUSALS.personNameTaken.message('נועה') : (PEOPLE_REFUSALS[key].message as () => string)()]);
      expect(JSON.stringify(e.toJSON()), key).not.toMatch(/2016|2018|2021|1899|2101|11-04/);
    }
    // names compared by personNameKey: case and inner spaces
    const latin = tx(doc, [add({ name: 'Noa Ben' })]).doc;
    expect(refusal(latin, [add({ name: 'noa  ben' })]).message).toBe(PEOPLE_REFUSALS.personNameTaken.message('Noa Ben'));
    expect(refusal(latin, [add({ name: 'noa  ben' })]).details).toMatchObject({ otherPersonId: expect.stringMatching(/^per_/) });
  });
  it('refuses past MAX_PEOPLE', () => {
    const { doc } = project();
    const full = tx(doc, Array.from({ length: MAX_PEOPLE }, (_, i) => add({ name: `p${i}` }))).doc;
    expect(Object.keys(full.people!).length).toBe(MAX_PEOPLE);
    const e = refusal(full, [add({ name: 'one more' })]);
    expect([e.code, e.message]).toEqual(['out_of_bounds', PEOPLE_REFUSALS.tooManyPeople.message()]);
    // a taken name is told before the count
    expect(refusal(full, [add({ name: 'P0' })]).message).toBe(PEOPLE_REFUSALS.personNameTaken.message('p0'));
  });
});

describe('update_person', () => {
  it('renames, changes and removes the birth date and the word choice; undo and redo are exact; summaries hold the name only', () => {
    const { doc, noa, itai } = withNoa();
    const steps: [Record<string, unknown>, string][] = [
      [{ personId: noa, name: 'Noa' }, PERSON_SUMMARIES.renamed('נועה', 'Noa')],
      [{ personId: noa, birthDate: '2016-11-05' }, PERSON_SUMMARIES.changed('נועה')],
      [{ personId: noa, birthDate: null }, PERSON_SUMMARIES.changed('נועה')],
      [{ personId: noa, form: 'm' }, PERSON_SUMMARIES.changed('נועה')],
      [{ personId: noa, form: null }, PERSON_SUMMARIES.changed('נועה')],
      [{ personId: noa, name: 'Noa', form: null, birthDate: '2016-11-04' }, `${PERSON_SUMMARIES.renamed('נועה', 'Noa')}; ${PERSON_SUMMARIES.changed('Noa')}`],
      [{ personId: itai, birthDate: '2018-01-02', form: 'm' }, PERSON_SUMMARIES.changed('איתי')],
    ];
    for (const [args, summary] of steps) {
      const r = tx(doc, [{ op: 'update_person', args }]);
      expect(r.results[0]!.summary, JSON.stringify(args)).toBe(summary);
      expect(r.results[0]!.summary, JSON.stringify(args)).not.toMatch(DATES);
      expect(r.results[0]!.affectedIds).toEqual([args.personId]);
      const after = r.doc.people![args.personId as string]!;
      if ('name' in args) expect(after.name).toBe((args.name as string).trim());
      if ('birthDate' in args) expect(after.birthDate).toBe(args.birthDate);
      if ('form' in args) expect(after.form).toBe(args.form ?? undefined);
      if (args.form === null) expect('form' in after).toBe(false);
      expect(validateProject(r.doc)).toEqual([]);
      undoRedo(doc, r.doc, JSON.stringify(args));
    }
    // a person may take another spelling of their own name
    const dana = tx(doc, [add({ name: 'Dana' })]);
    const danaId = dana.results[0]!.output!.personId as string;
    expect(tx(dana.doc, [{ op: 'update_person', args: { personId: danaId, name: 'dana' } }]).doc.people![danaId]!.name).toBe('dana');
  });
  it('refuses in the order of the rules', () => {
    const { doc, noa, itai } = withNoa();
    const cases: [PeopleRefusalKey, Record<string, unknown>, string?][] = [
      ['personNotFound', { personId: 'per_gone', name: 'a{b' }, 'per_gone'],
      ['personNothingToChange', { personId: noa }],
      ['personNameCharacters', { personId: noa, name: 'a|b', birthDate: '2021-02-30' }],
      ['personNameEmpty', { personId: noa, name: ' ', birthDate: '2021-02-30' }],
      ['noSuchBirthDay', { personId: noa, name: 'איתי', birthDate: '2021-02-30' }],
      ['birthDateOutOfRange', { personId: noa, name: 'איתי', birthDate: '2101-01-01' }],
      ['personNameTaken', { personId: noa, name: 'איתי', birthDate: '2016-11-04' }, 'איתי'],
      ['personUnchanged', { personId: noa, name: ' נועה', birthDate: '2016-11-04', form: 'f' }],
      ['personUnchanged', { personId: itai, birthDate: null, form: null }],
    ];
    for (const [key, args, value] of cases) {
      const e = refusal(doc, [{ op: 'update_person', args }]);
      const message = (PEOPLE_REFUSALS[key].message as (v?: string) => string)(value);
      expect([e.code, e.message], `${key} ${JSON.stringify(args)}`).toEqual([PEOPLE_REFUSALS[key].code, message]);
      expect(JSON.stringify(e.toJSON()), key).not.toMatch(/2016|2021|2101|11-04|"f"/);
    }
    // an id that names an Object.prototype member is refused before the operation
    expect(refusal(doc, [{ op: 'update_person', args: { personId: 'constructor', name: 'x' } }]).code).toBe('not_found');
  });
});

describe('remove_person', () => {
  it('removes a person nobody names; the last one takes the `people` key with it; undo and redo are exact', () => {
    const { doc, noa, itai } = withNoa();
    const one = tx(doc, [{ op: 'remove_person', args: { personId: itai } }]);
    expect(Object.keys(one.doc.people!)).toEqual([noa]);
    expect(one.results[0]!.summary).toBe(PERSON_SUMMARIES.removed('איתי'));
    undoRedo(doc, one.doc, 'remove_person');
    const both = tx(one.doc, [{ op: 'remove_person', args: { personId: noa } }]);
    expect('people' in both.doc).toBe(false);
    expect(both.results[0]!.summary).not.toMatch(DATES);
    undoRedo(one.doc, both.doc, 'remove the last person');
  });
  it('is refused while a title names the person: its own text (fields on or off), a format\'s wording, an age format outside AGE_FORMATS; the titles are listed', () => {
    const { doc, noa, itai, titleId } = withNoa();
    const second = tx(doc, [{ op: 'add_text', args: { text: 'plain {name:' + noa + '}', start: f(0), duration: f(30) } }]);
    const plainId = second.results[0]!.output!.clipId as string;
    let d = tx(second.doc, [{ op: 'update_text', args: { clipId: titleId, text: `{name:${noa}} {age:${noa}:words}` } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }]).doc;
    const e = refusal(d, [{ op: 'remove_person', args: { personId: noa } }]);
    const users = fieldUsersOfPerson(d, noa);
    expect([...users].sort()).toEqual([titleId, plainId].sort());
    // document order: the order the clips are stored in
    const order = Object.values(d.sequences).flatMap((sq) => sq.tracks.flatMap((t) => t.clips.map((c) => c.id)));
    expect(users).toEqual([...users].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
    expect([e.code, e.message]).toEqual(['incompatible', PEOPLE_REFUSALS.personInUse.message(2)]);
    expect(e.details).toMatchObject({ personId: noa, clipIds: users });
    expect(e.hint).toBe(PEOPLE_REFUSALS.personInUse.hint);
    expect(fieldUsersOfPerson(d, itai)).toEqual([]);
    // a format's own wording
    const v = tx(d, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    d = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: plainId, text: `{age:${itai}:en}` } }]).doc;
    expect(fieldUsersOfPerson(d, itai)).toEqual([plainId]);
    expect(refusal(d, [{ op: 'remove_person', args: { personId: itai } }]).details).toMatchObject({ personId: itai, clipIds: [plainId] });
    // an age format stored before AGE_FORMATS (update_text checks no fields)
    const old = tx(doc, [{ op: 'update_text', args: { clipId: titleId, text: `{date}` } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }, { op: 'update_text', args: { clipId: titleId, text: `{date} {age:${itai}:years}` } }]).doc;
    expect(fieldUsersOfPerson(old, itai)).toEqual([titleId]);
    expect(refusal(old, [{ op: 'remove_person', args: { personId: itai } }]).code).toBe('incompatible');
    // literal braces and another person's id that merely contains this one do not count
    const literal = tx(doc, [{ op: 'update_text', args: { clipId: titleId, text: `{{name:${noa}}} {name:${noa}x}` } }]).doc;
    expect(fieldUsersOfPerson(literal, noa)).toEqual([]);
    // made plain text, the person can go
    const frozen = freezeOps(d, d.mainSequenceId, titleId, f(0));
    expect(frozen.missing).toEqual([]);
    const plain = tx(d, [...frozen.ops, { op: 'update_text', args: { clipId: plainId, text: 'plain' } }]);
    expect(fieldUsersOfPerson(plain.doc, noa)).toEqual([]);
    undoRedo(plain.doc, tx(plain.doc, [{ op: 'remove_person', args: { personId: noa } }]).doc, 'remove after freeze');
  });
  it('refuses a person who is not there, and an inherited id', () => {
    const { doc } = withNoa();
    expect([refusal(doc, [{ op: 'remove_person', args: { personId: 'per_gone' } }]).code, refusal(doc, [{ op: 'remove_person', args: { personId: 'per_gone' } }]).message]).toEqual(['not_found', PEOPLE_REFUSALS.personNotFound.message('per_gone')]);
    expect(refusal(doc, [{ op: 'remove_person', args: { personId: '__proto__' } }]).code).toBe('not_found');
    expect(refusal(project().doc, [{ op: 'remove_person', args: { personId: 'per_x' } }]).code).toBe('not_found');
  });
});

describe('documentPeople: what people fields show', () => {
  const on = (titleId: string, text: string): OpCall[] => [{ op: 'update_text', args: { clipId: titleId, text } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }];
  const title = (doc: ProjectDocument, titleId: string) => findClip(doc, titleId)!.clip as TextClip;
  it('resolves {name}, {age}, {age:words} and {age:en} from the capture day under the title, across a cut (the day before and the day of a birthday)', () => {
    const { doc, noa, titleId } = withNoa();
    const d = tx(doc, on(titleId, `{name:${noa}} {age:${noa}} · {age:${noa}:words} · {age:${noa}:en}`)).doc;
    const at = (frame: number) => resolveFields(d, d.mainSequenceId, title(d, titleId), f(frame));
    expect(at(10)).toMatchObject({ text: 'נועה בת שנתיים וחצי · בת שנתיים וחצי · 2½ years old', missing: [] });
    expect(at(70)).toMatchObject({ text: 'נועה בת 3 · בת שלוש · 3 years old', missing: [] });
    // the same through a kept index, asked twice, and through the document's own source given explicitly
    const ix = makeFieldIndex(d);
    expect(resolveFields(d, d.mainSequenceId, title(d, titleId), f(70), { index: ix }).text).toBe('נועה בת 3 · בת שלוש · 3 years old');
    expect(resolveFields(d, d.mainSequenceId, title(d, titleId), f(71), { index: ix }).text).toBe('נועה בת 3 · בת שלוש · 3 years old');
    expect(resolveFields(d, d.mainSequenceId, title(d, titleId), f(71), { index: ix, people: documentPeople(d) }).text).toBe('נועה בת 3 · בת שלוש · 3 years old');
    // NO_PEOPLE through the same index keeps its own answers
    expect(resolveFields(d, d.mainSequenceId, title(d, titleId), f(71), { index: ix, people: NO_PEOPLE }).missing.map((m) => m.reason)).toEqual(['unknown_person', 'unknown_person', 'unknown_person', 'unknown_person']);
    expect(resolveFields(d, d.mainSequenceId, title(d, titleId), f(71), { index: ix }).missing).toEqual([]);
  });
  it('reports unknown_person, no_birth_date, no_date and before_birth, and draws nothing for them', () => {
    const { doc, noa, itai, titleId } = withNoa();
    const d = tx(doc, on(titleId, `[{name:${itai}}|{age:${itai}}] [{age:${noa}}]`)).doc;
    const at = (x: ProjectDocument, frame: number) => resolveFields(x, x.mainSequenceId, title(x, titleId), f(frame));
    expect(at(d, 10)).toMatchObject({ text: '[איתי|] [בת שנתיים וחצי]', missing: [{ token: `{age:${itai}}`, reason: 'no_birth_date' }] });
    // over the undated clip: names still show, ages have no date
    expect(at(d, 130)).toMatchObject({ text: '[איתי|] []', missing: [{ token: `{age:${itai}}`, reason: 'no_birth_date' }, { token: `{age:${noa}}`, reason: 'no_date' }] });
    // born after the picture
    const later = tx(d, [{ op: 'update_person', args: { personId: noa, birthDate: '2019-11-04' } }]).doc;
    expect(at(later, 10).missing).toContainEqual({ token: `{age:${noa}}`, reason: 'before_birth' });
    expect(at(later, 70).text).toBe('[איתי|] [בת יומה]');
    // a person who is not there (undoing an add_person can leave that)
    const gone = structuredClone(d); delete gone.people![noa];
    expect(at(gone, 10)).toMatchObject({ text: '[איתי|] []', missing: [{ token: `{age:${itai}}`, reason: 'no_birth_date' }, { token: `{age:${noa}}`, reason: 'unknown_person' }] });
    // a document without birth dates (what a credential without the people scope is handed): no age at all
    const redacted = structuredClone(d); for (const p of Object.values(redacted.people!)) p.birthDate = null;
    expect(at(redacted, 70).text).toBe('[איתי|] []');
    expect(at(redacted, 70).missing.map((m) => m.reason)).toEqual(['no_birth_date', 'no_birth_date']);
  });
  it('the source answers by own property, and never for an unknown age format', () => {
    const { doc, noa } = withNoa();
    const s = documentPeople(doc);
    expect(s.resolve({ name: 'name', personId: 'constructor', format: null }, '2020-01-01')).toBeNull();
    expect(s.resolve({ name: 'age', personId: noa, format: 'years' }, '2020-01-01')).toBeNull();
    expect(s.resolve({ name: 'age', personId: noa, format: null }, 'not a day')).toEqual({ missing: 'no_date' });
    expect(s.resolve({ name: 'age', personId: noa, format: null }, '2020-01-01T08:00:00')).toBe('בת 3');
  });
  it('a transaction that adds a person and turns on a title naming them equals the same steps one by one (no cache on the draft)', () => {
    const { doc, titleId } = project();
    const first = applyTransaction(doc, [add({ name: 'נועה', birthDate: '2016-11-04', form: 'f' })], { idSeed: 'one_', actor: 't' });
    const id = first.results[0]!.output!.personId as string;
    const steps = on(titleId, `{name:${id}} {age:${id}}`);
    const together = applyTransaction(doc, [add({ name: 'נועה', birthDate: '2016-11-04', form: 'f' }), ...steps], { idSeed: 'one_', actor: 't' }).doc;
    const apart = tx(tx(first.doc, [steps[0]!]).doc, [steps[1]!]).doc;
    expect(creativeProjection(together)).toBe(creativeProjection(apart));
    expect(resolveFields(together, together.mainSequenceId, title(together, titleId), f(70)).text).toBe('נועה בת 3');
    // in one transaction: a title that names the person, then removing them is refused at once
    let thrown: unknown;
    try { applyTransaction(doc, [add({ name: 'נועה' }), ...on(titleId, `{name:${id}}`), { op: 'remove_person', args: { personId: id } }], { idSeed: 'one_', actor: 't' }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(OpError);
    expect([(thrown as OpError).code, (thrown as OpError).message]).toEqual(['incompatible', PEOPLE_REFUSALS.personInUse.message(1)]);
  });
});

describe('the readable form of people fields in the editor', () => {
  it('with the document: by name in both languages, formats by their words; a round trip gives the stored text back', () => {
    const { doc, noa, itai } = withNoa();
    const stored = `{name:${noa}} {age:${noa}} {age:${noa}:words} {age:${itai}:en} {date} {{x}} {age:per_gone} {age:${noa}:years}`;
    const he = fieldsToDisplay('he', stored, doc), en = fieldsToDisplay('en', stored, doc);
    expect(he).toBe(`{שם: נועה} {גיל: נועה} {גיל: נועה: במילים} {גיל: איתי: באנגלית} {תאריך} {{x}} {age:per_gone} {age:${noa}:years}`);
    expect(en).toBe(`{name: נועה} {age: נועה} {age: נועה: in words} {age: איתי: in English} {date} {{x}} {age:per_gone} {age:${noa}:years}`);
    // the age format outside AGE_FORMATS is shown as written, so reading it back makes the user write it again
    expect(fieldsFromDisplay('he', he, doc)).toEqual({ ok: false, problems: [{ token: `{age:${noa}:years}`, reason: 'unknown_format' }] });
    const clean = stored.replace(` {age:${noa}:years}`, '');
    for (const lang of ['he', 'en'] as const) expect(fieldsFromDisplay(lang, fieldsToDisplay(lang, clean, doc), doc), lang).toEqual({ ok: true, text: clean });
    // without the document: as written, and read back as written
    expect(fieldsToDisplay('he', clean)).toBe(`{name:${noa}} {age:${noa}} {age:${noa}:words} {age:${itai}:en} {תאריך} {{x}} {age:per_gone}`);
    expect(fieldsFromDisplay('he', fieldsToDisplay('he', clean), undefined)).toEqual({ ok: true, text: clean });
  });
  it('accepts what a person types: other spacing and case of the name, the stored format names, the other language; refuses a nobody and a bad format', () => {
    const { doc, noa } = withNoa();
    const latin = tx(doc, [add({ name: 'Noa Ben' })]);
    const ben = latin.results[0]!.output!.personId as string;
    const d = latin.doc;
    expect(fieldsFromDisplay('he', '{גיל:noa   ben} {age: NOA BEN : words} {שם:נועה} {name:Noa Ben} {age:  נועה :en} {גיל: נועה: בספרות}', d)).toEqual({ ok: true, text: `{age:${ben}} {age:${ben}:words} {name:${noa}} {name:${ben}} {age:${noa}:en} {age:${noa}}` });
    expect(fieldsFromDisplay('he', `{שם: ${noa}}`, d)).toEqual({ ok: true, text: `{name:${noa}}` }); // an id typed in the readable form
    expect(fieldsFromDisplay('he', '{גיל: דנה}', d)).toEqual({ ok: false, problems: [{ token: '{גיל: דנה}', reason: 'unknown_person' }] });
    expect(fieldsFromDisplay('he', '{גיל: נועה: בשנים}', d)).toEqual({ ok: false, problems: [{ token: '{גיל: נועה: בשנים}', reason: 'unknown_format' }] });
    expect(fieldsFromDisplay('he', '{שם: נועה: במילים}', d)).toEqual({ ok: false, problems: [{ token: '{שם: נועה: במילים}', reason: 'unknown_format' }] });
    expect(fieldsFromDisplay('he', '{גיל}', d)).toEqual({ ok: false, problems: [{ token: '{גיל}', reason: 'unknown_format' }] });
    // without the document the readable people form is no field
    expect(fieldsFromDisplay('he', '{גיל: נועה}')).toEqual({ ok: false, problems: [{ token: '{גיל: נועה}', reason: 'unknown_field' }] });
  });
});
