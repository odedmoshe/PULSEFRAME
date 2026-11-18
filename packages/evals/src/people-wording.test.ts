/**
 * Keeps the Hebrew wording of the refusals of the people operations (packages/i18n/src/people.ts HE_PEOPLE) in step with the
 * fixed English sentences (packages/core/src/peopleOps.ts PEOPLE_REFUSALS), and the shared strings of the people step
 * complete (ADR-0021, people section). Every refusal is provoked through its operation in refusal-wording.test.ts (the
 * people case) and in packages/core/src/peopleOps.test.ts; set_text_fields → unknownPerson is provoked here too.
 * Also the server's people refusals (apps/server/src/peoplePrivacy.ts: the people scope, the archive «בלי פרטי משפחה»;
 * i18n people.ts HE_PEOPLE_SERVER), each provoked through the server's own functions.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, PEOPLE_REFUSALS, PERSON_OPS, type OpCall, type PeopleRefusalKey, type ProjectDocument, type TextClip } from '@pulseframe/core';
import { dictionaries, LIFE_REFUSAL_PATTERNS, PEOPLE_REFUSAL_PATTERNS, PEOPLE_SERVER_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { assertMayTakeRendered, assertMayWritePeople, withoutFamily } from '../../../apps/server/src/peoplePrivacy.ts';
import type { Principal } from '../../../apps/server/src/governance.ts';
import { ApiError } from '../../../apps/server/src/store.ts';

const SAMPLES: Record<PeopleRefusalKey, string> = {
  personNotFound: PEOPLE_REFUSALS.personNotFound.message('per_w1'),
  personNameCharacters: PEOPLE_REFUSALS.personNameCharacters.message(),
  personNameEmpty: PEOPLE_REFUSALS.personNameEmpty.message(),
  noSuchBirthDay: PEOPLE_REFUSALS.noSuchBirthDay.message(),
  birthDateOutOfRange: PEOPLE_REFUSALS.birthDateOutOfRange.message(),
  personNameTaken: PEOPLE_REFUSALS.personNameTaken.message('סבתא רבקה'),
  tooManyPeople: PEOPLE_REFUSALS.tooManyPeople.message(),
  personNothingToChange: PEOPLE_REFUSALS.personNothingToChange.message(),
  personUnchanged: PEOPLE_REFUSALS.personUnchanged.message(),
  personInUse: PEOPLE_REFUSALS.personInUse.message(3),
  unknownPerson: PEOPLE_REFUSALS.unknownPerson.message('{age:per_1}, {name:per_1}'),
};

describe('Hebrew wording of the refusals of the people operations (ADR-0021, people section)', () => {
  it('every refusal is recognised by exactly one pattern of all the tables and worded in Hebrew, with its numbers, name and brace groups kept; no pattern is left without a refusal', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(PEOPLE_REFUSALS).sort());
    const matched = new Set<number>();
    for (const [key, message] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', message);
      expect(he, `${key}: ${message}`).toMatch(/[֐-׿]/);
      const hits = PEOPLE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${key} is recognised by exactly one people pattern`).toBe(1);
      expect(LIFE_REFUSAL_PATTERNS.some((re) => re.test(message)), `${key} is not taken by a life-line pattern`).toBe(false);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message), key).toBeUndefined();
    }
    expect(PEOPLE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', SAMPLES.birthDateOutOfRange)).toMatch(/1900.*2100/);
    expect(translateRefusal('he', SAMPLES.tooManyPeople)).toContain('200');
    expect(translateRefusal('he', SAMPLES.personInUse)).toContain('3');
    expect(translateRefusal('he', SAMPLES.personNameTaken)).toContain('סבתא רבקה');
    expect(translateRefusal('he', SAMPLES.unknownPerson)).toContain('{age:per_1}, {name:per_1}');
  });
  it('the one refusal of a built operation is provoked through it and worded in Hebrew: set_text_fields over a person who is not in the project', () => {
    const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
    const r = applyTransaction(createProject({ id: 'p', name: 'P' }), [{ op: 'add_text', args: { text: 'T', start: f(0), duration: f(30) } }], { idSeed: 'w_', actor: 'test' });
    const clipId = r.results[0]!.output!.clipId as string;
    let thrown: unknown;
    try { applyTransaction(r.doc, [{ op: 'update_text', args: { clipId, text: '{name:per_x} בת {age:per_x:words}' } }, { op: 'set_text_fields', args: { clipId, enabled: true } }], { idSeed: 'w2_', actor: 'test' }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(OpError);
    expect((thrown as OpError).message).toBe(PEOPLE_REFUSALS.unknownPerson.message('{name:per_x}, {age:per_x:words}'));
    expect(translateRefusal('he', (thrown as OpError).message)).toContain('{name:per_x}, {age:per_x:words}');
  });
  it('the shared strings of the step exist in both languages and differ: the three operation names, the three new reasons an age has no words, the palette command', () => {
    const keys = [...PERSON_OPS.map((op) => `op.${op}`), 'life.missing.no_birth_date', 'life.missing.before_birth', 'life.missing.unknown_age_format', 'life.missing.unknown_person', 'cmd.people'];
    for (const k of keys) {
      const he = (dictionaries.he as Record<string, string>)[k], en = (dictionaries.en as Record<string, string>)[k];
      expect(he?.trim(), `he ${k}`).toBeTruthy();
      expect(en?.trim(), `en ${k}`).toBeTruthy();
      expect(he, k).toMatch(/[֐-׿]/);
      expect(he, k).not.toBe(en);
    }
  });
  it('no shared string and no Hebrew refusal holds a date', () => {
    const all = [...Object.values(SAMPLES).map((m) => translateRefusal('he', m)!), ...Object.entries(dictionaries.he).filter(([k]) => /^(op\.\w+_person|life\.missing\.|cmd\.people)/.test(k)).map(([, v]) => v)];
    for (const s of all) expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}[./]\d{1,2}[./]\d{2,4}/);
  });
});

/** A film of one dated picture with a title that shows Noa's name and age, planted as an archive holds it. */
function familyFilm(): { doc: ProjectDocument; titleId: string } {
  const R = { num: 30, den: 1 };
  const f = (n: number) => T.frameTime(n, R);
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
  const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(4, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 120 }, provenance: prov, capture: { at: '2021-06-01T10:00:00', utcOffsetMinutes: null, source: 'manual' as const } };
  const tx = (doc: ProjectDocument, ops: OpCall[], seed: string, allowInternal = false) => applyTransaction(doc, ops, { idSeed: seed, actor: 'test', allowInternal });
  const lib = tx(createProject({ id: 'prj_ff', name: 'F', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }], 'ff1_', true);
  const assetId = lib.results[0]!.output!.assetId as string;
  const t = tx({ ...lib.doc, people: { per_noa: { id: 'per_noa', name: 'נועה', birthDate: '2020-03-10', form: 'f' } } }, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'x', start: f(0), duration: f(60) } }], 'ff2_');
  const titleId = t.results[1]!.output!.clipId as string;
  return { doc: tx(t.doc, [{ op: 'update_text', args: { clipId: titleId, text: '{name:per_noa} ({age:per_noa})' } }, { op: 'set_text_fields', args: { clipId: titleId, enabled: true } }], 'ff3_').doc, titleId };
}
/** A title with live fields that holds a brace group that is no field: a stored document of another build may hold one. */
const withBadTitle = (doc: ProjectDocument): ProjectDocument => {
  const out = structuredClone(doc);
  const track = out.sequences[out.mainSequenceId]!.tracks.find((tr) => tr.kind === 'text')!;
  const bad = structuredClone(track.clips.find((c) => c.type === 'text')!) as TextClip;
  track.clips.push({ ...bad, id: 'clp_bad', start: T.frameTime(90, { num: 30, den: 1 }), duration: T.frameTime(10, { num: 30, den: 1 }), text: 'שלום {dat}' });
  return out;
};

describe('Hebrew wording of the server\'s people refusals (apps/server/src/peoplePrivacy.ts)', () => {
  it('each is provoked through the server\'s own functions and worded in Hebrew; every pattern is used; a refusal quoted inside one is worded too', () => {
    const NAMES: Principal = { actor: 'agent:x', kind: 'agent', scopes: ['observe', 'edit'] };
    const refused = (fn: () => unknown): ApiError => { try { fn(); } catch (e) { if (e instanceof ApiError) return e; throw e; } throw new Error('not refused'); };
    const { doc, titleId } = familyFilm();
    const tooLong = applyTransaction(doc, [{ op: 'update_text', args: { clipId: titleId, text: `{name:per_noa}${' {date}'.repeat(280)}` } }], { idSeed: 'long_', actor: 'test' }).doc;
    const errors = [
      refused(() => assertMayWritePeople(NAMES, [{ op: 'add_person', args: { name: 'נועה', birthDate: '2020-03-10', form: 'f' } }])),
      refused(() => assertMayWritePeople(NAMES, [{ op: 'update_person', args: { personId: 'per_noa', form: 'm' } }])),
      ...['export this project', 'retry this export', 'download this export'].map((what) => refused(() => assertMayTakeRendered(NAMES, doc, what))),
      refused(() => withoutFamily(tooLong)),
      // the title is made plain text in a transaction that the stored document's other, faulty title makes invalid
      refused(() => withoutFamily(withBadTitle(doc))),
      // no people title to freeze, so the self-check meets the faulty title
      refused(() => withoutFamily(withBadTitle({ ...doc, sequences: Object.fromEntries(Object.entries(doc.sequences).map(([k, q]) => [k, { ...q, tracks: q.tracks.map((tr) => ({ ...tr, clips: tr.clips.filter((c) => c.id !== titleId) })) }])) }))),
    ];
    expect(errors.map((e) => `${e.status} ${e.code}`)).toEqual(['403 people_scope_required', '403 people_scope_required', '403 people_scope_required', '403 people_scope_required', '403 people_scope_required', '409 title_too_long', '409 family_free_refused', '500 family_free_incomplete']);
    const used = new Set<number>();
    for (const e of errors) {
      const he = translateRefusal('he', e.message);
      expect(he, e.message).toMatch(/[֐-׿]/);
      expect(translateRefusal('en', e.message)).toBeUndefined();
      PEOPLE_SERVER_REFUSAL_PATTERNS.forEach((re, i) => { if (re.test(e.message)) used.add(i); });
      expect(he, e.message).not.toMatch(/2020|03-10/);
      expect((dictionaries.he as Record<string, string>)[`error.code.${e.code}`], e.code).toMatch(/[֐-׿]/);
      expect((dictionaries.en as Record<string, string>)[`error.code.${e.code}`], e.code).toBeTruthy();
    }
    expect(PEOPLE_SERVER_REFUSAL_PATTERNS.filter((_, i) => !used.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', errors[0]!.message)).toMatch(/תאריך לידה ולא המילה/);
    expect(translateRefusal('he', errors[1]!.message)).not.toMatch(/תאריך לידה/);
    expect(translateRefusal('he', errors[3]!.message)).toContain('להפעיל שוב את הייצוא');
    // the operation's refusal inside it is worded by the common table, its brace group kept
    expect(translateRefusal('he', errors[6]!.message)).toMatch(/^לא היה אפשר לקבוע את הכותרות כטקסט רגיל לארכיון בלי פרטי משפחה: בכותרת עם שדות חיים יש סוגריים מסולסלים שאינם שדה: \{dat\}/);
  });
});
