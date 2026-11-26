/**
 * Keeps the Hebrew wording of the «ציור חי» refusals (packages/i18n/src/ink.ts HE_INK) in step with the fixed English of core
 * inkContract.ts INK_REFUSALS: every sentence is worded in Hebrew, says what to do next, and every pattern is used; the strings
 * exist in both languages with the same keys; Hebrew uses the plural address; nothing calls a drawing good or checked.
 */
import { describe, expect, it } from 'vitest';
import { INK_REFUSALS, MAX_CLIP_POINTS, MAX_DOC_POINTS } from '@pulseframe/core';
import { HE_INK, INK_EN, INK_HE, INK_REFUSAL_PATTERNS, INK_UI_HE, translateRefusal } from '../../i18n/src/index.ts';

const SAMPLES: Record<keyof typeof INK_REFUSALS, string> = {
  lengths: INK_REFUSALS.lengths.message(2),
  time: INK_REFUSALS.time.message(0),
  gap: INK_REFUSALS.gap.message(1, 70_000),
  coord: INK_REFUSALS.coord.message(3, 40_000),
  span: INK_REFUSALS.span.message(40_000),
  long: INK_REFUSALS.long.message(4, 700_000),
  strokeTooLong: INK_REFUSALS.strokeTooLong.message(0, 2_001),
  tooManyStrokes: INK_REFUSALS.tooManyStrokes.message(201),
  tooLarge: INK_REFUSALS.tooLarge.message(MAX_CLIP_POINTS + 1),
  documentFull: INK_REFUSALS.documentFull.message(MAX_DOC_POINTS - 10, 50),
  notInk: INK_REFUSALS.notInk.message('clp_x'),
  nothing: INK_REFUSALS.nothing.message(),
};

describe('ink wording', () => {
  it('every refusal is worded in Hebrew with a next step, by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. '), `${k}: says what to do next`).toBe(true);
      const own = HE_INK.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const k of Object.keys(INK_REFUSALS) as (keyof typeof INK_REFUSALS)[]) expect(INK_REFUSALS[k].hint.length, k).toBeGreaterThan(10);
    expect(INK_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages with the same keys; Hebrew addresses the owner in the plural', () => {
    expect(Object.keys(INK_EN).sort()).toEqual(Object.keys(INK_HE).sort());
    for (const v of Object.values(INK_EN)) expect(v.length).toBeGreaterThan(0);
    expect(INK_UI_HE.modeHint).toContain('ציירו');
    expect(INK_UI_HE.afterDone).toContain('לחצו');
    // singular imperatives the plural address replaces
    for (const v of Object.values(INK_HE)) expect(/(^|\s)(צייר|ציירי|לחץ|לחצי|בחר|בחרי|מחק|מחקי)(\s|[.,]|$)/.test(v), v).toBe(false);
  });
  it('no string calls a drawing good, safe or checked', () => {
    for (const v of Object.values(INK_EN)) for (const re of [/\bsafe\b/i, /\bverified\b/i, /\bgood\b/i, /\bperfect\b/i]) expect(re.test(v), v).toBe(false);
    expect(INK_UI_HE.notLooked).toBe('לא נבדק בעין');
  });
});
