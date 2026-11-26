/**
 * Keeps the Hebrew wording of the trip map's refusals (packages/i18n/src/tripMap.ts HE_TRIPMAP) in step with the fixed English of core
 * mapContract.ts MAP_REFUSALS: every sentence is worded in Hebrew, says what to do next, and every pattern is used. Also: the strings
 * exist in both languages with the same keys, the honest sentences are there, the timing line is not masculine (C11), and no string
 * calls a map checked, right or safe. W1 owns this file after the pre-pass (provoke every refusal through its op once built).
 */
import { describe, expect, it } from 'vitest';
import { MAP_LOOKS, MAP_MODES, MAP_PUBLIC_OPS, MAP_REFUSALS } from '@pulseframe/core';
import { dictionaries, HE_TRIPMAP, translateRefusal, TRIPMAP_EN, TRIPMAP_HE, TRIPMAP_REFUSAL_PATTERNS } from '../../i18n/src/index.ts';

/** Every refusal sentence with sample values (the ops provoke them for real once MAP_OPS_BUILT). */
const SAMPLES: Record<keyof typeof MAP_REFUSALS, string> = {
  notBuilt: MAP_REFUSALS.notBuilt.message('add_trip_map'),
  stopCount: MAP_REFUSALS.stopCount.message(13),
  stopName: MAP_REFUSALS.stopName.message(2),
  noLabel: MAP_REFUSALS.noLabel.message(),
  stopPlace: MAP_REFUSALS.stopPlace.message(0),
  samePlace: MAP_REFUSALS.samePlace.message(1),
  stopIds: MAP_REFUSALS.stopIds.message(),
  times: MAP_REFUSALS.times.message(),
  firstVia: MAP_REFUSALS.firstVia.message(),
  tooShort: MAP_REFUSALS.tooShort.message(3, 30),
  noMusic: MAP_REFUSALS.noMusic.message(),
  noBars: MAP_REFUSALS.noBars.message(),
  unitsShort: MAP_REFUSALS.unitsShort.message(5, 3),
  notMap: MAP_REFUSALS.notMap.message('clp_x'),
};
const FORBIDDEN_EN = [/\bsafe\b/i, /\bverified\b/i, /\bchecked\b/i, /\bcorrect\b/i, /\baccurate\b/i];
const FORBIDDEN_HE = ['בטוח', 'מאומת', 'אומת', 'מדויק', 'נכון'];

describe('trip map wording', () => {
  it('every refusal is worded in Hebrew with a next step, by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${k}: says what to do next`).toBe(true);
      const own = HE_TRIPMAP.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    expect(TRIPMAP_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages with the same keys, with every op, mode and look, and the honest sentences', () => {
    expect(Object.keys(TRIPMAP_EN).sort()).toEqual(Object.keys(TRIPMAP_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const op of MAP_PUBLIC_OPS) expect(d[`op.${op}`], `${lang} ${op}`).toBeTruthy();
      for (const m of MAP_MODES) expect(d[`tripMap.mode.${m}`], `${lang} ${m}`).toBeTruthy();
      for (const l of MAP_LOOKS) expect(d[`tripMap.look.${l}`], `${lang} ${l}`).toBeTruthy();
    }
    expect(TRIPMAP_HE['tripMap.new']).toBe('מפת טיול חדשה');
    expect(TRIPMAP_HE['tripMap.unseen']).toContain('לא נבדק בעין');
    expect(TRIPMAP_HE['tripMap.coastsOnly']).toContain('בלי גבולות');
    expect(TRIPMAP_HE['tripMap.agents']).toContain('גלויים לסוכנים');
    expect(TRIPMAP_HE['tripMap.timedTo']).toBe('התזמון לפי התיבות של: {name}'); // C11: not «מתוזמן»
    expect(Object.values(TRIPMAP_HE).some((v) => v.includes('מתוזמן'))).toBe(false);
  });
  it('no string calls a map checked, accurate or safe', () => {
    for (const v of Object.values(TRIPMAP_EN)) for (const re of FORBIDDEN_EN) expect(re.test(v), v).toBe(false);
    for (const v of Object.values(TRIPMAP_HE)) for (const w of FORBIDDEN_HE) expect(v.includes(w), v).toBe(false);
  });
});
