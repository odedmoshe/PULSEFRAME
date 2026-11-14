import { expect, it } from 'vitest';
import { en, he } from './index.ts';
it('Hebrew and English dictionaries cover the same keys with non-empty strings', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
  for (const d of [he, en]) for (const v of Object.values(d)) expect(v.trim().length).toBeGreaterThan(0);
});
it('Hebrew strings contain Hebrew script (except the language toggle)', () => {
  for (const [k, v] of Object.entries(he)) if (k !== 'lang.toggle') expect(/[֐-׿]/.test(v), k).toBe(true);
});
