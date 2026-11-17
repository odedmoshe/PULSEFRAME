/**
 * The strings and data-testids of the life-line UI (ADR-0021): both languages cover the same keys with the same marks, Hebrew
 * is Hebrew, and the fixed test ids are unique and what the proofs expect.
 */
import { describe, expect, it } from 'vitest';
import { fill, LIFE_STRINGS, lifeT } from './lifeline.strings.ts';
import { fieldSlug, LIFE_TESTIDS } from './lifeline.testids.ts';

describe('life-line strings and test ids', () => {
  it('Hebrew and English have the same keys, non-empty; Hebrew is Hebrew; placeholders agree', () => {
    const he = LIFE_STRINGS.he as Record<string, string>, en = LIFE_STRINGS.en as Record<string, string>;
    expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
    for (const [k, v] of Object.entries(he)) {
      expect(v.trim().length, k).toBeGreaterThan(0);
      expect(/[֐-׿]/.test(v), k).toBe(true);
      expect(en[k]!.trim().length, k).toBeGreaterThan(0);
      expect((en[k]!.match(/\{\w+\}/g) ?? []).sort(), k).toEqual((v.match(/\{\w+\}/g) ?? []).sort());
    }
    expect(fill(lifeT('he')('undated'), { n: 7 })).toBe('בלי תאריך (7)');
    expect(fill(lifeT('en')('fieldLive'), { text: 'x', constructor: 1 })).toBe('Showing now: x');
  });
  it('no string speaks of people, ages or family details: they are not part of this build', () => {
    for (const lang of ['he', 'en'] as const) for (const [k, v] of Object.entries(LIFE_STRINGS[lang])) expect(/אנשים|(^|[^א-ת])גיל([^א-ת]|$)|יום הולדת|people|birthday|\bage\b/i.test(v), `${lang} ${k}`).toBe(false);
  });
  it('data-testids are unique, and the parametrised ones are stable', () => {
    const fixed = (Object.values(LIFE_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string');
    expect(new Set(fixed).size).toBe(fixed.length);
    for (const id of fixed) expect(/^(life|field|stamp)-[a-z-]+$/.test(id), id).toBe(true);
    expect(LIFE_TESTIDS.viewOption('date')).toBe('life-view-date');
    expect(LIFE_TESTIDS.year(2024)).toBe('life-year-2024');
    expect(LIFE_TESTIDS.month(2024, 3)).toBe('life-month-2024-3');
    expect(LIFE_TESTIDS.event('evt_1')).toBe('life-event-evt_1');
    expect(LIFE_TESTIDS.sunset('evt_1')).toBe('life-sunset-evt_1');
    expect(LIFE_TESTIDS.dateBadge('ast_1')).toBe('life-date-ast_1');
    expect(fieldSlug('{hebrewDate:noYear}')).toBe('hebrewDate-noYear');
    expect(LIFE_TESTIDS.fieldItem('{date}')).toBe('field-item-date');
    expect(LIFE_TESTIDS.fieldItem('{date:numeric}')).toBe('field-item-date-numeric');
  });
});
