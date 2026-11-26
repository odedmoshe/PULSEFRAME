/**
 * Keeps the Hebrew wording of «קליפ מקוד» (packages/i18n/src/made.ts) in step with the fixed English of core madeContract.ts: every
 * refusal of apply_made_clip and of the made routes is worded in Hebrew by its own pattern with a next step (a plural imperative),
 * every pattern is used, every job failure and warning has a he/en string, no string calls a clip safe or checked by eye, and the
 * not-built refusal is provoked through the real op. W2 owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MADE_API, MADE_JOB_FAILURES, MADE_OP_REFUSALS, MADE_WARNINGS, OpError } from '@pulseframe/core';
import { HE_MADE, MADE_EN, MADE_HE, MADE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const SAMPLES: Record<string, string> = {
  notBuilt: MADE_OP_REFUSALS.notBuilt.message(), noRecord: MADE_OP_REFUSALS.noRecord.message(), notVideo: MADE_OP_REFUSALS.notVideo.message(),
  placeAndReplace: MADE_OP_REFUSALS.placeAndReplace.message(), replaceUnused: MADE_OP_REFUSALS.replaceUnused.message('ast_x1'),
  tooShort: MADE_OP_REFUSALS.tooShort.message('clp_x1', 120),
  ...Object.fromEntries(Object.entries(MADE_API).map(([k, v]) => [`api.${k}`, v.message])),
};
const IMPERATIVE = /(צרו|הוסיפו|בחרו|חכו|חדשו|תקנו|השתמשו|עדכנו|נסו|קצרו|לחצו|ציירו|בדקו|הסירו|חפשו|האטו|השאירו|דווחו)/;

describe('made-clip wording', () => {
  it('every refusal is worded in Hebrew with a next step by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', msg);
      expect(he && /[א-ת]/.test(he), k).toBe(true);
      expect(IMPERATIVE.test(he!), `${k}: says what to do next`).toBe(true);
      const own = HE_MADE.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const r of Object.values(MADE_OP_REFUSALS)) expect(r.hint.length).toBeGreaterThan(10);
    expect(translateRefusal('he', SAMPLES.tooShort!)).toContain('120');
    expect(MADE_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('every job failure and warning has its he and en string; Hebrew failures say what to do next; the same keys in both languages', () => {
    expect(Object.keys(MADE_EN).sort()).toEqual(Object.keys(MADE_HE).sort());
    for (const r of Object.values(MADE_JOB_FAILURES)) {
      const k = `made.fail.${r.why}` as keyof typeof MADE_HE;
      expect(MADE_HE[k], k).toBeTruthy();
      expect(IMPERATIVE.test(MADE_HE[k]), `${k}: next step`).toBe(true);
      expect(r.hint.length).toBeGreaterThan(10);
    }
    for (const r of Object.values(MADE_WARNINGS)) expect(MADE_HE[`made.warn.${r.why}` as keyof typeof MADE_HE], r.why).toBeTruthy();
  });
  it('nothing is called safe, verified or seen: flashing is a measurement, and the result says nobody watched it', () => {
    const all = [...Object.values(MADE_HE), ...Object.values(MADE_EN)].join('\n');
    expect(all).not.toMatch(/בטוח|מאומת|\bsafe\b|\bverified\b/i);
    expect(MADE_HE['made.unseen']).toContain('אף אחד עוד לא צפה בו');
    expect(MADE_HE['made.check.flash']).toContain('נמדד');
  });
  it('provoked for real: apply_made_clip refuses with the not-built row until W2 builds it', () => {
    const doc = createProject({ id: 'p', name: 'p', frameRate: { num: 30, den: 1 } });
    let err: unknown;
    try { applyTransaction(doc, [{ op: 'apply_made_clip', args: { asset: {}, place: { start: T.frameTime(0, { num: 30, den: 1 }) } } }], { idSeed: 'm_', actor: 'test', allowInternal: true }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OpError);
    expect((err as OpError).details.why).toBe('made_not_built');
    expect(translateRefusal('he', (err as OpError).message)).toContain('עדכנו');
  });
});
