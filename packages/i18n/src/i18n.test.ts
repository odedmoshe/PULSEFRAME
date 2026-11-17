import { expect, it } from 'vitest';
import { en, he } from './index.ts';
import { SETUP_CODES } from '../../../apps/server/src/aiContracts.ts';
it('Hebrew and English dictionaries cover the same keys with non-empty strings', () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(he).sort());
  for (const d of [he, en]) for (const v of Object.values(d)) expect(v.trim().length).toBeGreaterThan(0);
});
it('Hebrew strings contain Hebrew script (except the language toggle)', () => {
  for (const [k, v] of Object.entries(he)) if (k !== 'lang.toggle') expect(/[֐-׿]/.test(v), k).toBe(true);
});
it('AI-model wave (ADR-0017): every setup state and every new error code has a Hebrew and an English headline', () => {
  const dicts = { he: he as Record<string, string>, en: en as Record<string, string> };
  const missing: string[] = [];
  for (const [lang, d] of Object.entries(dicts)) {
    for (const code of SETUP_CODES) if (!d[`ai.setup.${code}`]?.trim()) missing.push(`${lang} ai.setup.${code}`);
    for (const code of ['output_not_editable', 'not_time_preserving', 'range_not_covered', 'engine_unverified', 'host_not_allowed', 'disk_insufficient', 'engine_not_configured', 'engine_not_working', 'output_invalid'])
      if (!d[`error.code.${code}`]?.trim()) missing.push(`${lang} error.code.${code}`);
  }
  expect(missing).toEqual([]);
  expect(SETUP_CODES.length).toBe(10);
  // the two languages say different things (an untranslated copy would pass the key check)
  for (const code of SETUP_CODES) expect(dicts.he[`ai.setup.${code}`]).not.toBe(dicts.en[`ai.setup.${code}`]);
});
