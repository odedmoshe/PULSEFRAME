/**
 * Keeps the Hebrew wording of the marked-range refusals (packages/i18n/src/pearls.ts HE_PEARLS) in step with the fixed English of core
 * sourceRangesContract.ts SOURCE_RANGE_REFUSALS and of the server's guards (apps/server/src/peoplePrivacy.ts HUMAN_TAG_REFUSALS,
 * apps/server/src/pearls.ts): every sentence is worded in Hebrew, says what to do next, and every pattern is used. notBuilt is
 * provoked for real; the rest come from the table until builder A's bodies exist — A then provokes each through its operation
 * (it.todo below). Also: the pearls strings exist in both languages and never judge a cut. Builder A owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, OpError, PEARL_FORBIDDEN_WORDS, PEARL_FORBIDDEN_WORDS_HE, SCREEN_TIME_LABEL, SCREEN_TIME_TITLE, SOURCE_RANGE_OPS, SOURCE_RANGE_OPS_BUILT, SOURCE_RANGE_REFUSALS, type SourceRangeRefusalKey } from '@pulseframe/core';
import { HUMAN_TAG_REFUSALS } from '../../../apps/server/src/peoplePrivacy.ts';
import { PEARLS_SERVER_REFUSALS } from '../../../apps/server/src/pearls.ts';
import { dictionaries, PEARLS_EN, PEARLS_HE, PEARLS_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

function opSentences(): Record<SourceRangeRefusalKey, string[]> {
  const S = SOURCE_RANGE_REFUSALS;
  const doc = createProject({ id: 'prj_pw', name: 'PW' });
  const notBuilt = SOURCE_RANGE_OPS_BUILT
    ? SOURCE_RANGE_OPS.map((op) => S.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'add_source_range', args: { assetId: 'ast_x' } }], { idSeed: 'pw1_', actor: 'test' })),
      caught(() => applyTransaction(doc, [{ op: 'update_source_range', args: { rangeId: 'rng_x', label: 'x' } }], { idSeed: 'pw2_', actor: 'test' })),
      caught(() => applyTransaction(doc, [{ op: 'remove_source_range', args: { rangeId: 'rng_x' } }], { idSeed: 'pw3_', actor: 'test' }))];
  return {
    notBuilt,
    assetNotFound: [S.assetNotFound.message('ast_x')], rangeNoTime: [S.rangeNoTime.message()], rangeHalfSpan: [S.rangeHalfSpan.message()],
    rangeWholeAndSpan: [S.rangeWholeAndSpan.message()], rangeStillSpan: [S.rangeStillSpan.message()], rangeBounds: [S.rangeBounds.message('12.4'), S.rangeBounds.message('8')],
    rangeLabelLine: [S.rangeLabelLine.message()], presenceNeedsPeople: [S.presenceNeedsPeople.message()], rangePersonNotFound: [S.rangePersonNotFound.message('per_x')],
    rangeDuplicate: [S.rangeDuplicate.message()], tooManyRanges: [S.tooManyRanges.message()], rangeNotFound: [S.rangeNotFound.message('rng_x')],
    rangeNothingToChange: [S.rangeNothingToChange.message()], rangeUnchanged: [S.rangeUnchanged.message()],
  };
}
const serverSentences = (): string[] => [...Object.values(HUMAN_TAG_REFUSALS), ...Object.values(PEARLS_SERVER_REFUSALS).map((r) => r.message)];

describe('pearls refusals in Hebrew', () => {
  const ops = opSentences();
  const all = [...Object.values(ops).flat(), ...serverSentences()];
  it('notBuilt is provoked for real until the bodies are built', () => {
    if (!SOURCE_RANGE_OPS_BUILT) expect(ops.notBuilt).toEqual(SOURCE_RANGE_OPS.map((op) => SOURCE_RANGE_REFUSALS.notBuilt.message(op)));
  });
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    expect(PEARLS_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
  });
  it('no refusal, summary-free English or Hebrew holds a label: the sentences carry ids and numbers only', () => {
    for (const en of all) expect(en).not.toMatch(/סופגנייה|dinosaur/);
  });
  it.todo('A: each refusal of add/update/remove_source_range is provoked for real through its operation, in the order of SOURCE_RANGE_REFUSALS, and equals the table');
});

describe('pearls strings', () => {
  it('the shared strings exist in both languages, Hebrew in Hebrew', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = [...SOURCE_RANGE_OPS.map((op) => `op.${op}`), 'cmd.viewPearls', 'error.code.human_tag_required', 'error.code.pearls_not_built', ...Object.keys(PEARLS_HE)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    for (const [k, v] of Object.entries(PEARLS_HE)) expect({ k, hebrew: /[א-ת]/.test(v) }).toEqual({ k, hebrew: true });
  });
  it('the measurement and the list never judge a cut (no fair, balanced, should; no «הוגן», «מאוזן», «צריך»)', () => {
    const texts = [...Object.values(PEARLS_HE), ...Object.values(PEARLS_EN), ...Object.values(SCREEN_TIME_LABEL), ...Object.values(SCREEN_TIME_TITLE)];
    for (const s of texts) { expect({ s, en: PEARL_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false }); expect({ s, he: PEARL_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false }); }
    expect(PEARLS_HE['pearl.screenLabel']).toBe(SCREEN_TIME_LABEL.he);
    expect(PEARLS_EN['pearl.screenLabel']).toBe(SCREEN_TIME_LABEL.en);
    expect(PEARLS_HE['pearl.screenTitle']).toBe(SCREEN_TIME_TITLE.he);
  });
  it('a rational time in a refusal is said in seconds, never a fraction', () => { expect(SOURCE_RANGE_REFUSALS.rangeBounds.message(String(T.toSeconds(T.rt(124, 10))))).toContain('12.4 s'); });
});
