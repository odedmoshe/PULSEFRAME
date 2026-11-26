import { describe, expect, it } from 'vitest';
import { SHORTS_STRINGS } from './shorts.strings.ts';

/** The panel never calls a moment "viral" and never predicts views (SPEC.md:624); the score is a relative heuristic. */
describe('shorts strings', () => {
  const FORBIDDEN = /viral|virality|ויראל|retention|predict|forecast|תחזית/i;
  const flat = (v: unknown): string[] => (typeof v === 'string' ? [v] : typeof v === 'function' ? [String((v as (...a: never[]) => unknown)(...([3, 'x', 10] as never[])))] : v && typeof v === 'object' ? Object.values(v).flatMap(flat) : []);
  it('no string uses a forbidden word, in either language', () => {
    for (const lang of ['he', 'en'] as const) for (const s of flat(SHORTS_STRINGS[lang])) expect(s, s).not.toMatch(FORBIDDEN);
  });
  it('both languages hold the same keys, Hebrew first', () => {
    expect(Object.keys(SHORTS_STRINGS)).toEqual(['he', 'en']);
    expect(Object.keys(SHORTS_STRINGS.en)).toEqual(Object.keys(SHORTS_STRINGS.he));
  });
});
