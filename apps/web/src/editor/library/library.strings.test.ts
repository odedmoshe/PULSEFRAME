/** The library panel strings: Hebrew and English have the same keys, no empty string, the same {placeholders}. */
import { describe, expect, it } from 'vitest';
import { LIBRARY_UI_EN, LIBRARY_UI_HE } from './library.strings.ts';
import { LIBRARY_TESTIDS } from './library.testids.ts';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
describe('library panel strings', () => {
  it('same keys, none empty, same placeholders', () => {
    expect(Object.keys(LIBRARY_UI_EN).sort()).toEqual(Object.keys(LIBRARY_UI_HE).sort());
    for (const [k, he] of Object.entries(LIBRARY_UI_HE)) {
      const en = LIBRARY_UI_EN[k as keyof typeof LIBRARY_UI_HE];
      expect({ k, he: he.length > 0, en: en.length > 0, holes: holes(he) }).toEqual({ k, he: true, en: true, holes: holes(en) });
    }
  });
  it('no fixed test id is used twice', () => {
    const ids = (Object.values(LIBRARY_TESTIDS) as unknown[]).filter((v): v is string => typeof v === 'string');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
