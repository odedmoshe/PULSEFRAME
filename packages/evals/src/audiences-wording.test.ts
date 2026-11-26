/**
 * Keeps the Hebrew wording of the audiences refusals (packages/i18n/src/audiences.ts HE_AUDIENCES) in step with the fixed English of
 * core audienceContract.ts AUDIENCE_REFUSALS and AUDIENCE_API_REFUSALS: every sentence is worded in Hebrew, says what to do next, and
 * every pattern is used. Also: the strings exist in both languages with the same keys, the calm version's honest sentences are there,
 * and no string calls a version safe or checked. W1 owns this file after the pre-pass (provoke every refusal through its op once built).
 */
import { describe, expect, it } from 'vitest';
import { AUDIENCE_API_REFUSALS, AUDIENCE_NOT_HANDLED, AUDIENCE_REFUSALS, SOUND_ROLE_ORDER } from '@pulseframe/core';
import { AUDIENCES_EN, AUDIENCES_HE, AUDIENCES_REFUSAL_PATTERNS, dictionaries, HE_AUDIENCES, translateRefusal } from '../../i18n/src/index.ts';

/** Every refusal sentence with sample values (the ops provoke them for real once AUDIENCE_PROJECTION_BUILT; see audienceContracts.test.ts). */
const SAMPLES: Record<keyof typeof AUDIENCE_REFUSALS, string> = {
  notBuilt: AUDIENCE_REFUSALS.notBuilt.message('add_audience_version'),
  notFound: AUDIENCE_REFUSALS.notFound.message('var_x'),
  notAudience: AUDIENCE_REFUSALS.notAudience.message('var_x'),
  trackNotFound: AUDIENCE_REFUSALS.trackNotFound.message('trk_x'),
  trackNotSound: AUDIENCE_REFUSALS.trackNotSound.message('trk_x'),
  clipNotFound: AUDIENCE_REFUSALS.clipNotFound.message('clp_x'),
  clipIsSound: AUDIENCE_REFUSALS.clipIsSound.message('clp_x'),
  notKeepable: AUDIENCE_REFUSALS.notKeepable.message('title_size', 'calm'),
  ruleNotForClip: AUDIENCE_REFUSALS.ruleNotForClip.message('transition', 'clp_x'),
};
const FORBIDDEN_EN = [/\bsafe\b/i, /\bverified\b/i, /\bapproved\b/i, /\bsuitable for\b/i];
const FORBIDDEN_HE = ['בטוח', 'מאומת', 'אומת'];

describe('audiences wording', () => {
  it('every refusal and the route\'s not-built sentence is worded in Hebrew with a next step, and every pattern is used', () => {
    const used = new Set<RegExp>();
    for (const [k, msg] of [...Object.entries(SAMPLES), ['api.notBuilt', AUDIENCE_API_REFUSALS.notBuilt.message()]] as [string, string][]) {
      const he = translateRefusal('he', msg);
      expect(he, k).toBeTruthy();
      expect(/[א-ת]/.test(he!), k).toBe(true);
      expect(he!.includes('. ') || he!.includes('; '), `${k}: says what to do next`).toBe(true);
      const own = HE_AUDIENCES.find(([re]) => re.test(msg));
      expect(own, `${k}: has its own pattern`).toBeTruthy();
      used.add(own![0]);
      expect(he, `${k}: no earlier pattern answers it`).toBe(own![1](own![0].exec(msg)!));
    }
    for (const k of Object.keys(AUDIENCE_REFUSALS) as (keyof typeof AUDIENCE_REFUSALS)[]) expect(AUDIENCE_REFUSALS[k].hint.length, k).toBeGreaterThan(10);
    expect(AUDIENCES_REFUSAL_PATTERNS.filter((re) => !used.has(re)).map(String)).toEqual([]);
  });
  it('the strings exist in both languages, including every honest sentence and every sound-role reason', () => {
    expect(Object.keys(AUDIENCES_EN).sort()).toEqual(Object.keys(AUDIENCES_HE).sort());
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      for (const k of AUDIENCE_NOT_HANDLED) expect(d[`audience.notHandled.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of SOUND_ROLE_ORDER) expect(d[`audience.why.${k}`], `${lang} ${k}`).toBeTruthy();
      for (const k of ['music_level', 'ducking']) expect(d[`audience.rule.${k}`], `${lang} ${k}`).toMatch(/dB/);
    }
    expect(AUDIENCES_HE['audience.rule.music_level']).toContain('ביחס לשאר הקול');
    expect(AUDIENCES_HE['audience.notHandled.pace']).toContain('לא משנה את קצב החיתוכים');
    expect(AUDIENCES_HE['audience.notHandled.not_medical']).toContain('לא הבטחה רפואית');
  });
  it('no string calls a version safe, suitable or checked', () => {
    for (const v of Object.values(AUDIENCES_EN)) for (const re of FORBIDDEN_EN) expect(re.test(v), v).toBe(false);
    for (const v of Object.values(AUDIENCES_HE)) for (const w of FORBIDDEN_HE) expect(v.includes(w), v).toBe(false);
  });
});
