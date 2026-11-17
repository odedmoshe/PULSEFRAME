/**
 * The strings and data-testids of the people UI (ADR-0021, people section): both languages cover the same keys with the
 * same marks, Hebrew is Hebrew, the test ids are unique and fixed, and the privacy line says what the server does.
 */
import { describe, expect, it } from 'vitest';
import { fill, PEOPLE_STRINGS, peopleT } from './people.strings.ts';
import { PEOPLE_TESTIDS } from './people.testids.ts';
import { LIFE_TESTIDS } from './lifeline.testids.ts';
import { peopleApi } from './people.api.ts';

describe('people strings and test ids', () => {
  it('Hebrew and English have the same keys, non-empty; Hebrew is Hebrew; placeholders agree', () => {
    const he = PEOPLE_STRINGS.he as Record<string, string>, en = PEOPLE_STRINGS.en as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const [k, v] of Object.entries(he)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(/[֐-׿]/.test(v), k).toBe(true);
      expect(en[k]!.trim().length, k).toBeGreaterThan(0);
      expect((en[k]!.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((v.match(/\{\w+\}/g) ?? []).sort());
    }
    expect(fill(peopleT('he')('removeInUse'), { n: 2 })).toContain('2 כותרות');
  });
  it('the privacy line says what the server does: names only, no birth dates, no ages worked out from them, exports with ages refused, unless granted; plain text is text', () => {
    // NOT the plan's first wording («סוכנים מחוברים רואים שמות בלבד»), which the verifier found untrue
    for (const lang of ['he', 'en'] as const) expect(PEOPLE_STRINGS[lang].privacy).not.toMatch(/^.{0,80}(רואים שמות בלבד|see names only)/);
    expect(PEOPLE_STRINGS.he.privacy).toContain('השמות בלבד');
    expect(PEOPLE_STRINGS.he.privacy).toContain('לא את תאריכי הלידה ולא את הגילים שמחושבים מהם');
    expect(PEOPLE_STRINGS.he.privacy).toContain('ייצוא שמציג גיל נחסם');
    expect(PEOPLE_STRINGS.he.privacy).toContain('אלא אם נתת לו הרשאה לתאריכי לידה');
    expect(PEOPLE_STRINGS.he.privacy).toContain('גיל שנקבע כטקסט רגיל');
    expect(PEOPLE_STRINGS.en.privacy).toMatch(/names only: not the birth dates and not the ages worked out from them/);
    expect(PEOPLE_STRINGS.he.archiveFamilyNote).toContain('קובצי המדיה עצמם לא משתנים');
  });
  it('data-testids are unique, fixed, and do not collide with the life-line ids', () => {
    const fixed = (Object.values(PEOPLE_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string');
    const life = (Object.values(LIFE_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string');
    expect(new Set(fixed).size).toBe(fixed.length);
    for (const id of fixed) { expect(/^(life-people|life-person|archive-family)[a-z-]*$/.test(id), id).toBe(true); expect(life, id).not.toContain(id); }
    expect(PEOPLE_TESTIDS.personRow('per_1')).toBe('life-person-per_1');
    expect(PEOPLE_TESTIDS.personForm('per_1')).toBe('life-person-form-per_1');
    expect(PEOPLE_TESTIDS.personRemove('per_1')).toBe('life-person-remove-per_1');
    expect(peopleApi.archiveUrl('prj_1', 'omit')).toBe('/api/v1/projects/prj_1/archive?family=omit');
    expect(peopleApi.archiveUrl('prj_1', 'keep')).toBe('/api/v1/projects/prj_1/archive');
  });
});
