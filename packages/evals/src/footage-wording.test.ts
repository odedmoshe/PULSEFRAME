/**
 * Keeps the Hebrew wording of the footage search refusals (packages/i18n/src/footageSearch.ts HE_FOOTAGE) in step with the fixed English
 * of core footageSearchContract.ts FOOTAGE_REFUSALS: every sentence is worded in Hebrew, says what to do next, and every pattern is used.
 * Also: the strings exist in both languages, none offers a query by example or claims to know who someone is (FOOTAGE_FORBIDDEN_WORDS),
 * and every model row carries the model label. Lead-owned (search pre-pass).
 */
import { describe, expect, it } from 'vitest';
import { FOOTAGE_FORBIDDEN_WORDS, FOOTAGE_NOTE, FOOTAGE_REFUSALS } from '@pulseframe/core';
import { dictionaries, HE_FOOTAGE, FOOTAGE_EN, FOOTAGE_HE, FOOTAGE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const sample = (k: keyof typeof FOOTAGE_REFUSALS): string => (FOOTAGE_REFUSALS[k].message as (...a: string[]) => string)('model_missing');

describe('footage search wording', () => {
  it('every refusal is worded in Hebrew with a next step, by exactly one pattern of HE_FOOTAGE, and every pattern is used', () => {
    const used = new Set<number>();
    for (const k of Object.keys(FOOTAGE_REFUSALS) as (keyof typeof FOOTAGE_REFUSALS)[]) {
      const msg = sample(k);
      const hits = FOOTAGE_REFUSAL_PATTERNS.map((re, i) => (re.test(msg) ? i : -1)).filter((i) => i >= 0);
      expect(hits, k).toHaveLength(1);
      used.add(hits[0]!);
      const he = translateRefusal('he', msg) ?? '';
      expect(he, k).toMatch(/[א-ת]/);
      expect(he, `${k} is worded by HE_FOOTAGE, not shadowed by an earlier pattern`).toBe(HE_FOOTAGE[hits[0]!]![1](HE_FOOTAGE[hits[0]!]![0].exec(msg)!));
      expect(he.split('. ').length, `${k} names a next step`).toBeGreaterThan(1);
      expect(FOOTAGE_REFUSALS[k].hint, k).toMatch(/\w/);
    }
    expect(used.size).toBe(FOOTAGE_REFUSAL_PATTERNS.length);
  });
  it('the strings exist in both dictionaries and the English covers the same keys', () => {
    expect(Object.keys(FOOTAGE_EN).sort()).toEqual(Object.keys(FOOTAGE_HE).sort());
    for (const k of Object.keys(FOOTAGE_HE) as (keyof typeof FOOTAGE_HE)[]) { expect(dictionaries.he[k], k).toBe(FOOTAGE_HE[k]); expect(dictionaries.en[k], k).toBe(FOOTAGE_EN[k]); }
  });
  it('no string offers a query by example or claims to know who someone is', () => {
    const all = [...Object.values(FOOTAGE_HE), ...Object.values(FOOTAGE_EN), FOOTAGE_NOTE.he, FOOTAGE_NOTE.en, ...Object.keys(FOOTAGE_REFUSALS).map((k) => sample(k as keyof typeof FOOTAGE_REFUSALS)),
      ...Object.keys(FOOTAGE_REFUSALS).map((k) => translateRefusal('he', sample(k as keyof typeof FOOTAGE_REFUSALS)) ?? '')];
    for (const s of all) for (const w of FOOTAGE_FORBIDDEN_WORDS) expect(s.toLowerCase(), s).not.toContain(w);
  });
  it('the model label says it is a model and was not tested in Hebrew', () => {
    expect(FOOTAGE_HE['footage.modelLabel']).toContain('מודל');
    expect(FOOTAGE_HE['footage.modelLabel']).toContain('לא נבדק בעברית');
    expect(FOOTAGE_EN['footage.modelLabel']).toMatch(/model.*not tested in Hebrew/);
  });
});
