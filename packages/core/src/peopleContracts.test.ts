/**
 * The shared contracts of the people of a project (ADR-0021, people section) that the lead pre-pass owns: the optional
 * schema field and the person entity with exact undo, the structure checks, the operation registry rows with their argument
 * schemas and refusal table, set_text_fields with people fields, the summary (names only), the wording table of ages for
 * the owner's review, and holdsAgeFields (what the server asks before it hands a film to a credential without birth dates).
 * Nothing here pins a placeholder body: the three operation bodies, documentPeople, fieldUsersOfPerson and the age wording
 * functions are W1's, listed as todo and tested in their own files once built.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  AGE_FORMS, AGE_PARTS_EDGES, fieldsFromDisplay, freezeOps, isUnknownAgeFormat, MISSING_REASONS, resolveFields, AGE_YEAR_WORDS_HE, AddPersonArgs, applyTransaction, createProject, diffEntities, findClip, entityMap, getOp, holdsAgeFields, isRealWallDate, listOps, MAX_PEOPLE,
  MAX_PERSON_NAME, OpError, parseFields, PEOPLE_REFUSALS, peopleOf, peopleRefusal, PERSON_OPS, PERSON_PRIVATE_ARGS, PERSON_SUMMARIES, personNameKey, personOf, PersonSchema, ProjectSchema,
  RemovePersonArgs, restoreEntities, SCHEMA_VERSION, storedPersonName, summarize, timeline, UpdatePersonArgs, validateProject,
  type OpCall, type Person, type ProjectDocument, type TextClip,
} from './index.ts';

const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pp${n++}_`, actor: 'test', allowInternal });
const NOA: Person = { id: 'per_noa', name: 'נועה', birthDate: '2016-11-04', form: 'f' };
const ITAI: Person = { id: 'per_itai', name: 'איתי', birthDate: null };
/** A document that already holds people, as an archive (or a later build) would: the operations that make them are W1's. */
const withPeople = (doc: ProjectDocument, people: Person[]): ProjectDocument => ({ ...structuredClone(doc), people: Object.fromEntries(people.map((p) => [p.id, p])) });
/** A project with one title; its id. */
function titled() {
  const r = tx(createProject({ id: 'prj_people', name: 'People' }), [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }]);
  return { doc: r.doc, titleId: r.results[0]!.output!.clipId as string };
}
const text = (clipId: string, t: string): OpCall => ({ op: 'update_text', args: { clipId, text: t } });
const on = (clipId: string): OpCall => ({ op: 'set_text_fields', args: { clipId, enabled: true } });
const refusedWith = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };

describe('people: schema (optional field, no version bump)', () => {
  it('the schema version is unchanged; a new project and a document from before this build have no people key and stay valid', () => {
    expect(SCHEMA_VERSION).toBe(2);
    const doc = createProject({ id: 'p', name: 'P' });
    expect('people' in doc).toBe(false);
    expect('people' in ProjectSchema.parse(doc)).toBe(false); // no default: a project without people is stored as before
    expect(validateProject(doc)).toEqual([]);
    expect(peopleOf(doc)).toEqual({});
    expect(personOf(doc, 'per_noa')).toBeNull();
  });
  it('a person is an id, a name, a birth date or null, and an optional word choice; nothing else can ride along', () => {
    const ok = (p: unknown) => expect(PersonSchema.safeParse(p).success, JSON.stringify(p)).toBe(true);
    const no = (p: unknown) => expect(PersonSchema.safeParse(p).success, JSON.stringify(p)).toBe(false);
    ok(NOA); ok(ITAI); ok({ id: 'x-1_Y', name: 'Noa B.', birthDate: '2020-02-29', form: 'm' });
    no({ ...NOA, photo: 'face.jpg' }); no({ ...NOA, gps: { lat: 32, lon: 34 } }); no({ ...NOA, relation: 'daughter' }); no({ ...NOA, gender: 'f' });
    no({ ...NOA, id: 'per:1' }); no({ ...NOA, id: 'per}1' }); no({ ...NOA, id: '' }); no({ ...NOA, id: 'x'.repeat(65) });
    for (const name of ['', 'a{b', 'a}b', 'a:b', 'a|b', 'a\nb', ' נועה', 'נועה ', 'x'.repeat(MAX_PERSON_NAME + 1), 'José']) no({ ...NOA, name });
    for (const birthDate of ['2021-02-30', '2023-02-29', '1899-12-31', '2101-01-01', '2016-11-04T10:00:00', '04.11.2016']) no({ ...NOA, birthDate });
    no({ ...NOA, form: 'x' }); no({ ...NOA, form: null }); no({ id: 'p', name: 'n' });
    expect(isRealWallDate('2020-02-29')).toBe(true);
  });
  it('people of a document are read through own properties: an id that names an Object.prototype member is nobody', () => {
    const doc = withPeople(createProject({ id: 'p', name: 'P' }), [NOA]);
    expect(personOf(doc, 'per_noa')).toEqual(NOA);
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) expect(personOf(doc, id), id).toBeNull();
    expect(Object.getPrototypeOf(peopleOf(doc))).toBe(Object.prototype);
  });
  it('names compare in NFC, trimmed, with single spaces and in lower case; they are stored in NFC and trimmed', () => {
    expect(personNameKey('  Noa   Ben ')).toBe(personNameKey('noa ben'));
    expect(personNameKey('José')).toBe(personNameKey('José'));
    expect(personNameKey('סבתא  רבקה')).toBe(personNameKey('סבתא רבקה'));
    expect(personNameKey('נועה')).not.toBe(personNameKey('נוע'));
    expect(storedPersonName('  José ')).toBe('José');
  });
});

describe('people: the person entity, exact undo', () => {
  it('each person is an entity of its own; restoring the state before the first person gives back a document without the key', () => {
    const before = createProject({ id: 'p', name: 'P' });
    const after = withPeople(before, [NOA, ITAI]);
    expect(entityMap(after).get('per_noa')).toEqual({ kind: 'person', person: NOA });
    const changes = diffEntities(before, after);
    expect(changes.map((c) => c.id).sort()).toEqual(['per_itai', 'per_noa']);
    const undone = structuredClone(after);
    restoreEntities(undone, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(undone).toEqual(before);
    expect('people' in undone).toBe(false);
    const redone = structuredClone(undone);
    restoreEntities(redone, changes.map((c) => ({ id: c.id, state: c.after })));
    expect(redone).toEqual(after);
  });
  it('a change of a birth date or a word choice is a change of the entity, and undo restores it exactly', () => {
    const a = withPeople(createProject({ id: 'p', name: 'P' }), [NOA]);
    const b = withPeople(a, [{ ...NOA, birthDate: '2016-11-05', form: undefined } as unknown as Person].map(({ form: _f, ...p }) => p as Person));
    const changes = diffEntities(a, b);
    expect(changes.map((c) => c.id)).toEqual(['per_noa']);
    const undone = structuredClone(b);
    restoreEntities(undone, changes.map((c) => ({ id: c.id, state: c.before })));
    expect(undone).toEqual(a);
  });
});

describe('people: validation', () => {
  const base = createProject({ id: 'p', name: 'P' });
  it('a valid list of people is no issue, and a people field naming nobody is not an issue either (it has no words; preflight says so)', () => {
    expect(validateProject(withPeople(base, [NOA, ITAI]))).toEqual([]);
    const { doc, titleId } = titled();
    // stored as a later build or an archive would store it: live fields on, a person who is not there
    const d = structuredClone(doc);
    const t = findClip(d, titleId)!.clip as { text: string; fields?: true };
    t.text = '{name:per_gone} {age:per_gone:words}'; t.fields = true;
    expect(validateProject(d)).toEqual([]);
  });
  it('a key that is not the id, two people with one name, a person the stored format cannot hold and too many people are issues; no message holds a birth date', () => {
    const issues = [
      ...validateProject({ ...base, people: { per_x: NOA } }),
      ...validateProject(withPeople(base, [NOA, { id: 'per_2', name: ' נועה'.trim(), birthDate: '2018-01-02' }])),
      ...validateProject(withPeople(base, [{ ...NOA, birthDate: '2021-02-30' }])),
      ...validateProject(withPeople(base, Array.from({ length: MAX_PEOPLE + 1 }, (_, i) => ({ id: `per_${i}`, name: `p${i}`, birthDate: '2016-11-04' })))),
    ];
    expect(issues.map((i) => i.code).sort()).toEqual(['key_mismatch', 'life_person_limit', 'life_person_name', 'life_person_shape']);
    for (const i of issues) expect(i.message, i.code).not.toMatch(/2016|2018|2021|11-04|02-30|01-02/);
  });
});

describe('people: operation registry rows', () => {
  it('add_person, update_person and remove_person are registered, public, at version 1, with descriptions that state the privacy rule', () => {
    expect([...PERSON_OPS]).toEqual(['add_person', 'update_person', 'remove_person']);
    for (const name of PERSON_OPS) {
      const def = getOp(name)!;
      expect(def, name).toBeDefined();
      expect(def.version, name).toBe(1);
      expect(def.internal, name).toBeFalsy();
      expect(def.description.length, name).toBeGreaterThan(60);
    }
    expect(getOp('add_person')!.description).toMatch(/names only unless the owner granted/);
    expect([...PERSON_PRIVATE_ARGS]).toEqual(['birthDate', 'form']);
    expect(listOps().filter((o) => o.name.endsWith('_person')).map((o) => o.name).sort()).toEqual(['add_person', 'remove_person', 'update_person']);
  });
  it('the argument schemas accept what the contract allows and refuse the rest before any body runs', () => {
    const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => expect(s.safeParse(v).success, JSON.stringify(v)).toBe(true);
    const no = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) => expect(s.safeParse(v).success, JSON.stringify(v)).toBe(false);
    ok(AddPersonArgs, { name: 'נועה' }); ok(AddPersonArgs, { name: 'נועה', birthDate: '2016-11-04', form: 'f' }); ok(AddPersonArgs, { name: 'a{b' }); // refused by name in the body
    ok(AddPersonArgs, { name: 'x', birthDate: null, form: null });
    no(AddPersonArgs, { name: '' }); no(AddPersonArgs, { name: 'x'.repeat(MAX_PERSON_NAME + 1) }); no(AddPersonArgs, { name: 'x', birthDate: '4.11.2016' }); no(AddPersonArgs, { name: 'x', form: 'x' });
    no(AddPersonArgs, { name: 'x', photo: 'a.jpg' }); no(AddPersonArgs, { name: 'x', personId: 'per_1' });
    ok(UpdatePersonArgs, { personId: 'per_1' }); ok(UpdatePersonArgs, { personId: 'per_1', birthDate: null }); ok(UpdatePersonArgs, { personId: 'per_1', name: 'n', form: 'm' });
    no(UpdatePersonArgs, { name: 'n' }); no(UpdatePersonArgs, { personId: 'per_1', gps: 1 });
    ok(RemovePersonArgs, { personId: 'per_1' }); no(RemovePersonArgs, {}); no(RemovePersonArgs, { personId: 'per_1', force: true });
  });
  it('every refusal has a fixed code and wording that never takes a birth date; summaries name the person only', () => {
    const codes = Object.fromEntries(Object.entries(PEOPLE_REFUSALS).map(([k, r]) => [k, r.code]));
    expect(codes).toEqual({
      personNotFound: 'not_found', personNameCharacters: 'invalid_args', personNameEmpty: 'invalid_args', noSuchBirthDay: 'invalid_args', birthDateOutOfRange: 'out_of_bounds',
      personNameTaken: 'incompatible', tooManyPeople: 'out_of_bounds', personNothingToChange: 'invalid_args', personUnchanged: 'invalid_args', personInUse: 'incompatible', unknownPerson: 'invalid_args',
    });
    // the parameters a message takes: an id, a name, a count or brace groups; never a date
    expect(PEOPLE_REFUSALS.noSuchBirthDay.message.length).toBe(0);
    expect(PEOPLE_REFUSALS.birthDateOutOfRange.message.length).toBe(0);
    expect(PEOPLE_REFUSALS.personUnchanged.message.length).toBe(0);
    const e = peopleRefusal('personInUse', { personId: 'per_noa', clipIds: ['clp_1', 'clp_2'] }, 2);
    expect([e.code, e.message, e.details]).toEqual(['incompatible', '2 title(s) hold a field for this person', { personId: 'per_noa', clipIds: ['clp_1', 'clp_2'] }]);
    expect(e.hint).toMatch(/plain text/);
    expect(PERSON_SUMMARIES.added('נועה')).toBe('Added "נועה" to the people of the project');
    expect(PERSON_SUMMARIES.changed('נועה')).not.toMatch(/\d/);
  });
});

describe('people: set_text_fields with people fields', () => {
  it('turning live fields on is refused, listing the groups, when a people field names a person who is not in the project', () => {
    const { doc, titleId } = titled();
    const e = refusedWith(() => tx(withPeople(doc, [NOA]), [text(titleId, '{name:per_noa} {age:per_gone} {age:constructor:words} {date} {age:per_gone}'), on(titleId)]));
    expect([e.code, e.message]).toEqual(['invalid_args', 'these fields name a person who is not in this project: {age:per_gone}, {age:constructor:words}']);
    expect(e.details).toMatchObject({ clipId: titleId, groups: ['{age:per_gone}', '{age:constructor:words}'] });
    expect(e.message).toBe(PEOPLE_REFUSALS.unknownPerson.message('{age:per_gone}, {age:constructor:words}'));
    // a project without people refuses every people field the same way
    expect(refusedWith(() => tx(doc, [text(titleId, '{name:per_noa}'), on(titleId)])).message).toBe('these fields name a person who is not in this project: {name:per_noa}');
  });
  it('a format\'s own wording is checked too', () => {
    const { doc, titleId } = titled();
    const v = tx(withPeople(doc, [NOA]), [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    const variantId = v.results[0]!.output!.variantId as string;
    const worded = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: '{age:per_other}' } }]).doc;
    expect(refusedWith(() => tx(worded, [text(titleId, '{name:per_noa}'), on(titleId)])).message).toBe('these fields name a person who is not in this project: {age:per_other}');
  });
  it('turning live fields on is accepted when every people field names a person of the project; undo gives the title back', () => {
    const { doc, titleId } = titled();
    const d = withPeople(doc, [NOA, ITAI]);
    const r = tx(d, [text(titleId, '{name:per_noa} {age:per_noa} · {name:per_itai} {age:per_itai:en} {{x}}'), on(titleId)]);
    const clip = findClip(r.doc, titleId)!.clip;
    expect(clip).toMatchObject({ fields: true, text: '{name:per_noa} {age:per_noa} · {name:per_itai} {age:per_itai:en} {{x}}' });
    expect(timeline(r.doc)!.tracks.flatMap((t) => t.clips).find((c) => c.id === titleId)).toMatchObject({ fields: true });
    const undone = structuredClone(r.doc);
    restoreEntities(undone, diffEntities(d, r.doc).map((c) => ({ id: c.id, state: c.before })));
    expect(undone).toEqual(d);
  });
  it('people fields parse with their formats; the default age format is not written; an age format outside AGE_FORMATS is kept as stored but is no known format', () => {
    const parts = parseFields('{age:per_noa:digits}{age:per_noa:words}{age:per_noa:en}{name:per_noa}{age:per_noa:fancy}{name:per_noa:x}{age:per_noa:Words}');
    expect(parts.slice(0, 5).map((p) => ('token' in p ? p.token : p))).toEqual([
      { name: 'age', personId: 'per_noa', format: null }, { name: 'age', personId: 'per_noa', format: 'words' }, { name: 'age', personId: 'per_noa', format: 'en' }, { name: 'name', personId: 'per_noa' },
      { name: 'age', personId: 'per_noa', format: 'fancy' },
    ].map((t) => expect.objectContaining(t)));
    expect(parts.slice(0, 5).map((p) => 'token' in p && isUnknownAgeFormat(p.token))).toEqual([false, false, false, false, true]);
    // what the grammar of 159a301 already refused stays refused
    expect(parts.slice(5).every((p) => 'bad' in p)).toBe(true);
  });
  it('turning live fields on is refused, listing the groups, when an age field has a format outside AGE_FORMATS, even for a person of the project', () => {
    const { doc, titleId } = titled();
    const e = refusedWith(() => tx(withPeople(doc, [NOA]), [text(titleId, '{age:per_noa} {age:per_noa:years} {weather}'), on(titleId)]));
    expect([e.code, e.message]).toEqual(['invalid_args', 'these brace groups are not fields: {age:per_noa:years}, {weather}']); // in the order of the text
    expect(e.details).toMatchObject({ clipId: titleId, groups: ['{age:per_noa:years}', '{weather}'] });
  });
  it('the editor form refuses an age format outside AGE_FORMATS', () => {
    expect(fieldsFromDisplay('he', '{age:per_noa:years}')).toEqual({ ok: false, problems: [{ token: '{age:per_noa:years}', reason: 'unknown_format' }] });
    expect(fieldsFromDisplay('he', '{age:per_noa:words}')).toEqual({ ok: true, text: '{age:per_noa:words}' });
  });
});

describe('people: documents and op logs from before AGE_FORMATS (159a301) still validate and replay', () => {
  // At 159a301 any {age:<id>:<format>} with format [a-z-]{1,16} was a field, set_text_fields refused every people field when
  // turning fields on, and update_text has no field check: a title that already had live fields could take one.
  const history = (): { initial: ProjectDocument; log: { ops: OpCall[]; idSeed: string }[] } => {
    const initial = createProject({ id: 'prj_old', name: 'Old' });
    const log: { ops: OpCall[]; idSeed: string }[] = [
      { ops: [{ op: 'add_text', args: { text: '{date}', start: f(0), duration: f(30) } }], idSeed: 'old0_' },
    ];
    const titleId = applyTransaction(initial, log[0]!.ops, { idSeed: 'old0_', actor: 'test' }).results[0]!.output!.clipId as string;
    log.push({ ops: [on(titleId)], idSeed: 'old1_' }, { ops: [text(titleId, '{date} {age:per_x:years}')], idSeed: 'old2_' });
    return { initial, log };
  };
  const replay = (initial: ProjectDocument, log: { ops: OpCall[]; idSeed: string }[]) => log.reduce((d, t) => applyTransaction(d, t.ops, { idSeed: t.idSeed, actor: 'test' }).doc, initial);
  it('the op log replays, the stored document validates, and it takes an unrelated edit', () => {
    const { initial, log } = history();
    const doc = replay(initial, log);
    expect(validateProject(doc)).toEqual([]);
    const later = tx(doc, [{ op: 'add_text', args: { text: 'another title', start: f(30), duration: f(30) } }]);
    expect(validateProject(later.doc)).toEqual([]);
    expect(ProjectSchema.parse(doc)).toEqual(doc);
  });
  it('the age field with that format draws no words and says why (field_no_data in the preflight), without asking the people source', () => {
    const { initial, log } = history();
    const doc = withPeople(replay(initial, log), [{ id: 'per_x', name: 'X', birthDate: '2016-11-04' }]);
    const clip = timeline(doc)!.tracks.flatMap((t) => t.clips).find((c) => c.type === 'text') as TextClip;
    const asked: string[] = [];
    const r = resolveFields(doc, doc.mainSequenceId, clip, f(0), { people: { resolve: (t) => { asked.push(t.personId); return 'words'; } } });
    expect(r.missing).toEqual(expect.arrayContaining([{ token: '{age:per_x:years}', reason: 'unknown_age_format' }]));
    expect(asked).toEqual([]);
    expect(MISSING_REASONS).toContain('unknown_age_format');
    // it is still a field: turning fields off is refused as at 159a301, and freezeOps reports it instead of writing it out
    expect(refusedWith(() => tx(doc, [{ op: 'set_text_fields', args: { clipId: clip.id, enabled: false } }])).code).toBe('incompatible');
    expect(freezeOps(doc, doc.mainSequenceId, clip.id).missing).toEqual(expect.arrayContaining([{ variantId: null, token: '{age:per_x:years}', reason: 'unknown_age_format' }]));
  });
});

describe('people: what every reader sees in a summary, and holdsAgeFields', () => {
  it('get_summary lists people by id and name, never a birth date or the word choice', () => {
    const s = summarize(withPeople(createProject({ id: 'p', name: 'P' }), [NOA, ITAI]));
    expect(s.people).toEqual([{ id: 'per_noa', name: 'נועה' }, { id: 'per_itai', name: 'איתי' }]);
    expect(JSON.stringify(s)).not.toMatch(/2016|birthDate|"form"/);
    expect(summarize(createProject({ id: 'p', name: 'P' })).people).toEqual([]);
  });
  it('holdsAgeFields: true for an {age:…} field in a title with live fields or in a format\'s wording of one; a name field, plain text and a title without live fields do not count', () => {
    const { doc, titleId } = titled();
    const d = withPeople(doc, [NOA]);
    expect(holdsAgeFields(d)).toBe(false);
    expect(holdsAgeFields(tx(d, [text(titleId, '{age:per_noa}')]).doc)).toBe(false); // live fields off: drawn as typed
    expect(holdsAgeFields(tx(d, [text(titleId, '{name:per_noa} {date}'), on(titleId)]).doc)).toBe(false);
    expect(holdsAgeFields(tx(d, [text(titleId, '{{age:per_noa}}'), on(titleId)]).doc)).toBe(false); // literal braces
    expect(holdsAgeFields(tx(d, [text(titleId, 'בת {age:per_noa:words}'), on(titleId)]).doc)).toBe(true);
    expect(holdsAgeFields(tx(d, [text(titleId, '{age:per_gone}')]).doc)).toBe(false);
    // the format's own wording, on a title with live fields
    const v = tx(d, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }, text(titleId, '{name:per_noa}'), on(titleId)]);
    const variantId = v.results[0]!.output!.variantId as string;
    expect(holdsAgeFields(v.doc)).toBe(false);
    expect(holdsAgeFields(tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: '{age:per_noa:en}' } }]).doc)).toBe(true);
  });
});

describe('people: the wording of ages, for the owner\'s review', () => {
  const days = (a: string, b: string) => { const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))); return (d(b) - d(a)) / 86400000; };
  it('every row is a real pair of days whose day count is right; every form starts with its word; English has its own form', () => {
    expect(AGE_FORMS.length).toBeGreaterThanOrEqual(25);
    for (const row of AGE_FORMS) {
      const k = `${row.rule} ${row.birth}→${row.at}`;
      expect(isRealWallDate(row.birth) && isRealWallDate(row.at), k).toBe(true);
      expect(row.parts.totalDays, k).toBe(days(row.birth, row.at));
      expect(row.he.m.startsWith('בן '), k).toBe(true);
      expect(row.he.f.startsWith('בת '), k).toBe(true);
      expect(row.he.none.startsWith('גיל ') || row.he.none === 'יום הלידה', k).toBe(true);
      // «בן» and «בת» differ in that word only (and in «יומו/יומה» on the day of birth)
      if (row.parts.totalDays > 0) expect(row.he.f.slice(3), k).toBe(row.he.m.slice(3));
      expect(row.en.trim().length, k).toBeGreaterThan(0);
      if (row.heWords) {
        expect(row.parts.years >= 3 && row.parts.years <= 10, k).toBe(true);
        expect(row.heWords.f, k).toContain(AGE_YEAR_WORDS_HE[row.parts.years]!);
      }
    }
    for (const e of AGE_PARTS_EDGES) if (e.parts) expect(e.parts.totalDays, `${e.birth}→${e.at}`).toBe(days(e.birth, e.at));
  });
  it('the rules the owner is asked about are each shown: day, days, weeks, months, a year, two years, «וחצי» until six, digits and words', () => {
    const he = AGE_FORMS.map((r) => r.he.f);
    for (const form of ['בת יומה', 'בת יום', 'בת יומיים', 'בת 3 ימים', 'בת שבוע', 'בת שבועיים', 'בת 3 שבועות', 'בת חודש', 'בת חודשיים', 'בת 3 חודשים', 'בת שנה', 'בת שנה וחצי', 'בת שנתיים', 'בת שנתיים וחצי', 'בת 3', 'בת 3 וחצי', 'בת 5 וחצי', 'בת 6', 'בת 11'])
      expect(he, form).toContain(form);
    expect(AGE_FORMS.find((r) => r.parts.years === 6 && r.parts.months === 6)!.he.f).toBe('בת 6'); // no «וחצי» from six
    expect(AGE_FORMS.find((r) => r.parts.years === 3 && r.parts.months === 0)!.heWords!.m).toBe('בן שלוש'); // years are counted in the feminine
  });
  // W1's parts, built (in depth: ageWords.test.ts and peopleOps.test.ts); imported here inside the tests
  it('W1: ageParts(birth, at) gives `parts` for every AGE_FORMS row and every AGE_PARTS_EDGES row (29 February counts on 1 March in common years)', async () => {
    const { ageParts } = await import('./index.ts');
    for (const row of AGE_FORMS) expect(ageParts(row.birth, row.at), `${row.birth}→${row.at}`).toEqual(row.parts);
    for (const e of AGE_PARTS_EDGES) expect(ageParts(e.birth, e.at), `${e.birth}→${e.at}`).toEqual(e.parts);
  });
  it('W1: ageHe(parts, form, style) and ageEn(parts) give the strings of every AGE_FORMS row', async () => {
    const { ageEn, ageHe } = await import('./index.ts');
    for (const row of AGE_FORMS) {
      for (const [form, key] of [['m', 'm'], ['f', 'f'], [undefined, 'none']] as const) {
        expect(ageHe(row.parts, form, 'digits'), `${row.rule} ${key}`).toBe(row.he[key]);
        expect(ageHe(row.parts, form, 'words'), `${row.rule} ${key} words`).toBe((row.heWords ?? row.he)[key]);
      }
      expect(ageEn(row.parts), row.rule).toBe(row.en);
    }
  });
  it('W1: documentPeople resolves {name}, {age}, {age:words}, {age:en} and reports unknown_person, no_birth_date, no_date and before_birth; PEOPLE_FIELDS_BUILT is set', async () => {
    const { documentPeople, PEOPLE_FIELDS_BUILT } = await import('./index.ts');
    expect(PEOPLE_FIELDS_BUILT).toBe(true);
    const s = documentPeople(withPeople(createProject({ id: 'p', name: 'P' }), [NOA, ITAI]));
    expect(s.resolve({ name: 'name', personId: 'per_noa', format: null }, null)).toBe('נועה');
    expect(s.resolve({ name: 'age', personId: 'per_noa', format: null }, '2019-11-04')).toBe('בת 3');
    expect(s.resolve({ name: 'age', personId: 'per_noa', format: 'words' }, '2019-11-04')).toBe('בת שלוש');
    expect(s.resolve({ name: 'age', personId: 'per_noa', format: 'en' }, '2019-11-04')).toBe('3 years old');
    expect(s.resolve({ name: 'age', personId: 'per_gone', format: null }, '2019-11-04')).toBeNull();
    expect(s.resolve({ name: 'age', personId: 'per_itai', format: null }, '2019-11-04')).toEqual({ missing: 'no_birth_date' });
    expect(s.resolve({ name: 'age', personId: 'per_noa', format: null }, null)).toEqual({ missing: 'no_date' });
    expect(s.resolve({ name: 'age', personId: 'per_noa', format: null }, '2016-11-03')).toEqual({ missing: 'before_birth' });
  });
  it('W1: fieldUsersOfPerson lists the titles (and format wordings) that name a person, live fields on or off', async () => {
    const { fieldUsersOfPerson } = await import('./index.ts');
    const { doc, titleId } = titled();
    const d = withPeople(doc, [NOA, ITAI]);
    expect(fieldUsersOfPerson(d, 'per_noa')).toEqual([]);
    expect(fieldUsersOfPerson(tx(d, [text(titleId, '{age:per_noa}')]).doc, 'per_noa')).toEqual([titleId]); // live fields off
    const v = tx(d, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }, text(titleId, '{name:per_noa}'), on(titleId)]);
    const variantId = v.results[0]!.output!.variantId as string;
    const worded = tx(v.doc, [{ op: 'set_variant_override', args: { variantId, clipId: titleId, text: '{age:per_itai:en}' } }]).doc;
    expect([fieldUsersOfPerson(worded, 'per_noa'), fieldUsersOfPerson(worded, 'per_itai')]).toEqual([[titleId], [titleId]]);
  });
  it('W1: add_person / update_person / remove_person: refusals provoked and undo then redo byte-equal (every refusal: peopleOps.test.ts); PEOPLE_OPS_BUILT is set', async () => {
    const { PEOPLE_OPS_BUILT } = await import('./index.ts');
    expect(PEOPLE_OPS_BUILT).toBe(true);
    const { doc } = titled();
    const r = tx(doc, [{ op: 'add_person', args: { name: 'נועה', birthDate: '2016-11-04', form: 'f' } }]);
    const id = r.results[0]!.output!.personId as string;
    const u = tx(r.doc, [{ op: 'update_person', args: { personId: id, birthDate: null, form: null } }]);
    const x = tx(u.doc, [{ op: 'remove_person', args: { personId: id } }]);
    for (const [before, after] of [[doc, r.doc], [r.doc, u.doc], [u.doc, x.doc]] as const) {
      const changes = diffEntities(before, after);
      const back = structuredClone(after);
      restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
      expect(JSON.stringify(back)).toBe(JSON.stringify(before));
      restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.after })));
      expect(JSON.stringify(back)).toBe(JSON.stringify(after));
    }
    expect(refusedWith(() => tx(r.doc, [{ op: 'add_person', args: { name: 'נועה ' } }])).code).toBe('incompatible');
    expect(JSON.stringify([r.results, u.results, x.results])).not.toMatch(/2016|11-04/);
  });
});
