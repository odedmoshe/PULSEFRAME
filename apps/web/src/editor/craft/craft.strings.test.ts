import { describe, expect, it } from 'vitest';
import { CRAFT_STRINGS } from './craft.strings.ts';

const places = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join();
describe('craft strings', () => {
  it('Hebrew and English cover the same keys, none empty; the Hebrew is Hebrew', () => {
    expect(Object.keys(CRAFT_STRINGS.en).sort()).toEqual(Object.keys(CRAFT_STRINGS.he).sort());
    for (const [k, v] of Object.entries(CRAFT_STRINGS.he)) { expect(v, k).not.toBe(''); expect(/[֐-׿]/.test(v), k).toBe(true); }
    for (const [k, v] of Object.entries(CRAFT_STRINGS.en)) expect(v, k).not.toBe('');
  });
  it('both languages fill the same {places}', () => {
    for (const k of Object.keys(CRAFT_STRINGS.he) as (keyof typeof CRAFT_STRINGS.he)[]) expect(places(CRAFT_STRINGS.en[k]), k).toBe(places(CRAFT_STRINGS.he[k]));
  });
  it('the wording the owner reads says the rules as rules, in words', () => {
    expect(CRAFT_STRINGS.he.ruleWholeWord).toContain('ילדים');
    expect(CRAFT_STRINGS.he.projectChanged).toBe('הפרויקט השתנה — בדקו שוב');
    // the counts say how NOW differs from the version; restore does the opposite, so both sentences say which way they read
    expect(CRAFT_STRINGS.he.diffSince).toBe('מאז הגרסה הזאת:');
    expect(CRAFT_STRINGS.en.diffSince).toBe('Since this version:');
    expect(CRAFT_STRINGS.he.restoreUndoesChanges).toContain('יבוטלו');
    expect(CRAFT_STRINGS.en.restoreUndoesChanges).toContain('undone');
    expect(CRAFT_STRINGS.he.restoreKeeps).toBe('הספרייה, התמלולים והאנשים נשארים כפי שהם');
  });
});
