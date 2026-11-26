/**
 * Keeps the Hebrew wording of «למדו אותי פעם אחת» (packages/i18n/src/teach.ts HE_TEACH) in step with the fixed English of core
 * lessonContract.ts LESSON_REFUSALS and LESSON_API_REFUSALS: every sentence is worded in Hebrew with a next step, by its own
 * pattern, and every pattern is used. Also: both languages have the same keys, every part kind, not-learned reason and window
 * stop is worded, the Hebrew is plural, and nothing calls the result right or matched. W1 owns this file after the pre-pass
 * (provoke every refusal through the op once lesson.ts is built).
 */
import { describe, expect, it } from 'vitest';
import { DERIVE_LEFT_OUT, LESSON_API_REFUSALS, LESSON_LIMITS, LESSON_PART_ORDER, LESSON_REFUSALS, NOT_LEARNED_WHY, WINDOW_STOPS } from '@pulseframe/core';
import { dictionaries, HE_TEACH, TEACH_EN, TEACH_HE, TEACH_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const R = LESSON_REFUSALS;
const SAMPLES: Record<keyof typeof LESSON_REFUSALS, string> = {
  notBuilt: R.notBuilt.message(),
  tooBig: R.tooBig.message(2002),
  tooManySteps: R.tooManySteps.message(65),
  duplicatePart: R.duplicatePart.message('gain'),
  sourceIsTarget: R.sourceIsTarget.message('clp_a'),
  targetNotFound: R.targetNotFound.message('clp_x'),
  notStepOp: R.notStepOp.message('add_person'),
  wrongPart: R.wrongPart.message('set_clip_gain', 'look'),
  literalClip: R.literalClip.message('set_clip_gain'),
  unknownArg: R.unknownArg.message('set_clip_gain', 'extra'),
  neverCarried: R.neverCarried.message('update_text', 'text'),
  unknownBinding: R.unknownBinding.message('set_clip_gain', '$dur'),
  badBinding: R.badBinding.message('trim_clip', 'to', '{"$edge":"start"|"end","by":<time>}'),
  unboundRef: R.unboundRef.message('update_effect', 'fx9'),
  fontNotInCatalogue: R.fontNotInCatalogue.message('Noa Handwriting'),
  nothing: R.nothing.message(),
};
const API = { notBuilt: LESSON_API_REFUSALS.notBuilt.message(), ownerRequired: LESSON_API_REFUSALS.ownerRequired.message(), agentRefused: LESSON_API_REFUSALS.agentRefused.message() };

describe('teach wording', () => {
  it('every refusal is worded in Hebrew with a next step, by its own pattern, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of [...Object.entries(SAMPLES), ...Object.entries(API).map(([k, m]) => [`api.${k}`, m])] as [string, string][]) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${k}: says what to do next`).toBe(true);
      const own = HE_TEACH.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const k of Object.keys(R) as (keyof typeof R)[]) expect(R[k].hint.length, k).toBeGreaterThan(10);
    expect(TEACH_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
    expect(SAMPLES.tooBig).toContain(String(LESSON_LIMITS.opRuns));
  });
  it('both languages have the same keys; every part kind, reason, stop and error code is worded', () => {
    expect(Object.keys(TEACH_EN).sort()).toEqual(Object.keys(TEACH_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const k of LESSON_PART_ORDER) expect(d[`teach.part.${k}`], `${lang} part ${k}`).toBeTruthy();
      for (const k of [...NOT_LEARNED_WHY, ...DERIVE_LEFT_OUT]) expect(d[`teach.why.${k}`], `${lang} why ${k}`).toBeTruthy();
      for (const k of WINDOW_STOPS) expect(d[`teach.stop.${k}`], `${lang} stop ${k}`).toBeTruthy();
      for (const k of [LESSON_API_REFUSALS.notBuilt.code, LESSON_API_REFUSALS.agentRefused.code]) expect(d[`error.code.${k}`], `${lang} ${k}`).toBeTruthy();
      expect(d['op.apply_lesson'], lang).toBeTruthy();
      expect(d['cmd.teachApply'], lang).toBeTruthy();
    }
    expect(TEACH_HE['teach.chipMany']).toBe('למדתי {n} שלבים מהקליפ הזה · החילו גם על…');
    expect(TEACH_HE['teach.allOnTrack']).toBe('כל הקליפים במסלול');
  });
  it('plural Hebrew, no gendered imperative; nothing is called right, matched, verified or AI', () => {
    for (const v of Object.values(TEACH_HE)) {
      expect(/(^|\s)(בחר|בחרי|לחץ|לחצי|החל|החילי|פתח|פתחי|בטל|בטלי)(\s|$)/.test(v), v).toBe(false);
      expect(/מושלם|מדויק|בינה מלאכותית|מאומת/.test(v), v).toBe(false);
    }
    for (const v of Object.values(TEACH_EN)) expect(/\b(perfect|correct|verified|matched|AI)\b/i.test(v), v).toBe(false);
  });
});
