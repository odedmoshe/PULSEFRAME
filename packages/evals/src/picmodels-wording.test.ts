/**
 * Keeps the Hebrew wording of the eyes refusals (packages/i18n/src/picmodels.ts HE_PICMODELS) in step with the fixed English of core
 * PICMODELS_REFUSALS: every sentence is worded in Hebrew by exactly one pattern (none shadowed by an earlier track's), says what to do
 * next, and every pattern is used. Every setup code has words with a next step in both languages; the shared strings are in both
 * dictionaries. Lead-owned (picmodels pre-pass).
 */
import { describe, expect, it } from 'vitest';
import { PICMODELS_REFUSALS, PICTURE_MODEL_SETUP_CODES } from '@pulseframe/core';
import { dictionaries, HE_PICMODELS, PICMODELS_EN, PICMODELS_HE, PICMODELS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const sample = (k: keyof typeof PICMODELS_REFUSALS): string => (PICMODELS_REFUSALS[k].message as (...a: string[]) => string)('model_missing');

describe('picmodels wording', () => {
  it('every refusal is worded in Hebrew with a next step by exactly one HE_PICMODELS pattern, and every pattern is used', () => {
    const used = new Set<number>();
    for (const k of Object.keys(PICMODELS_REFUSALS) as (keyof typeof PICMODELS_REFUSALS)[]) {
      const msg = sample(k);
      const hits = PICMODELS_REFUSAL_PATTERNS.map((re, i) => (re.test(msg) ? i : -1)).filter((i) => i >= 0);
      expect(hits, k).toHaveLength(1);
      used.add(hits[0]!);
      const he = translateRefusal('he', msg) ?? '';
      expect(he, `${k} is worded by HE_PICMODELS, not shadowed by an earlier pattern`).toBe(HE_PICMODELS[hits[0]!]![1](HE_PICMODELS[hits[0]!]![0].exec(msg)!));
      expect(he.split('. ').length, `${k} names a next step`).toBeGreaterThan(1);
    }
    expect(used.size).toBe(PICMODELS_REFUSAL_PATTERNS.length);
  });
  it('the strings exist in both dictionaries; every setup code is worded with a next step', () => {
    expect(Object.keys(PICMODELS_EN).sort()).toEqual(Object.keys(PICMODELS_HE).sort());
    for (const k of Object.keys(PICMODELS_HE) as (keyof typeof PICMODELS_HE)[]) { expect(dictionaries.he[k], k).toBe(PICMODELS_HE[k]); expect(dictionaries.en[k], k).toBe(PICMODELS_EN[k]); }
    for (const code of PICTURE_MODEL_SETUP_CODES) {
      const he = PICMODELS_HE[`picmodels.setup.${code}`], en = PICMODELS_EN[`picmodels.setup.${code}`];
      expect(he, code).toMatch(/[א-ת]/);
      if (code !== 'ready') { expect(he.split('. ').length + he.split('; ').length, code).toBeGreaterThan(2); expect(en.split('. ').length + en.split('; ').length, code).toBeGreaterThan(2); }
    }
  });
  it('nothing claims to know who is in a picture or calls a suggestion right', () => {
    for (const s of [...Object.values(PICMODELS_HE), ...Object.values(PICMODELS_EN), ...HE_PICMODELS.map(([re, say]) => say(re.exec(sample(Object.keys(PICMODELS_REFUSALS).find((k) => re.test(sample(k as never))) as never))!))])
      expect(/same person|who is this|recogni[sz]e|correct|accurate|אותו אדם|מי זה|מדויק/i.test(s), s).toBe(false);
  });
});
