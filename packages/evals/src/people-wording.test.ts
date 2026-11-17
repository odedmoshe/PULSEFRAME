/**
 * Keeps the Hebrew wording of the refusals of the people operations (packages/i18n/src/people.ts HE_PEOPLE) in step with the
 * fixed English sentences (packages/core/src/peopleOps.ts PEOPLE_REFUSALS), and the shared strings of the people step
 * complete (ADR-0021, people section). Provoking each refusal through its operation is W1's test (the bodies are W1's); the
 * one refusal of an operation that is already built (set_text_fields → unknownPerson) is provoked here.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, PEOPLE_REFUSALS, PERSON_OPS, type PeopleRefusalKey } from '@pulseframe/core';
import { dictionaries, LIFE_REFUSAL_PATTERNS, PEOPLE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

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
  it('the shared strings of the step exist in both languages and differ: the three operation names, the two new reasons an age has no words, the palette command', () => {
    const keys = [...PERSON_OPS.map((op) => `op.${op}`), 'life.missing.no_birth_date', 'life.missing.before_birth', 'life.missing.unknown_person', 'cmd.people'];
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
