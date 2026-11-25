/**
 * Keeps the Hebrew wording of the musicfit refusals (packages/i18n/src/musicFit.ts HE_MUSICFIT) in step with the fixed English of core
 * musicFitContract.ts MUSICFIT_REFUSALS and of the routes (apps/server/src/musicfit/routes.ts MUSICFIT_SERVER_REFUSALS): every sentence
 * is worded in Hebrew, says what to do next, and every pattern is used. notBuilt is provoked for real; the rest come from the table
 * until builder A's bodies exist — A then provokes each through its operation (it.todo below). Also: the strings exist in both
 * languages and never praise a join or an ending. Builder A owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, MUSICFIT_COMPOSED_AGAIN, MUSICFIT_FORBIDDEN_WORDS, MUSICFIT_FORBIDDEN_WORDS_HE, MUSICFIT_INTERNAL_OPS, MUSICFIT_OPS_BUILT, MUSICFIT_PUBLIC_OPS, MUSICFIT_REFUSALS, MUSICFIT_UNHEARD_LABEL, MusicFitNotBuilt, OpError, joinMeasuredSentence, type MusicFitRefusalKey } from '@pulseframe/core';
import { MUSICFIT_SERVER_REFUSALS } from '../../../apps/server/src/musicfit/routes.ts';
import { dictionaries, MUSICFIT_EN, MUSICFIT_HE, MUSICFIT_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

const caught = (fn: () => unknown): string => { try { fn(); } catch (e) { if (e instanceof OpError) return e.message; throw e; } throw new Error('not refused'); };

function opSentences(): Record<MusicFitRefusalKey, string[]> {
  const S = MUSICFIT_REFUSALS;
  const doc = createProject({ id: 'prj_mw', name: 'MW' });
  const opts = (n: number) => ({ idSeed: `mw${n}_`, actor: 'test', allowInternal: true });
  const notBuilt = MUSICFIT_OPS_BUILT
    ? [...MUSICFIT_PUBLIC_OPS, ...MUSICFIT_INTERNAL_OPS].map((op) => S.notBuilt.message(op))
    : [caught(() => applyTransaction(doc, [{ op: 'set_clip_impact', args: { clipId: 'clp_x', moment: null } }], opts(1))),
      caught(() => applyTransaction(doc, [{ op: 'sync_impact', args: { clipId: 'clp_x', to: 'beat' } }], opts(2))),
      caught(() => applyTransaction(doc, [{ op: 'mark_join_heard', args: { assetId: 'ast_x', heard: true, at: '2026-11-25T00:00:00Z' } }], opts(3)))];
  return {
    notBuilt: [...notBuilt, new MusicFitNotBuilt('musicAt').message],
    impactNoMoment: [S.impactNoMoment.message()], impactOutsideFile: [S.impactOutsideFile.message()], noImpact: [S.noImpact.message()],
    impactOutside: [S.impactOutside.message()], noMusic: [S.noMusic.message()], noRoom: [S.noRoom.message()], alreadyOnBeat: [S.alreadyOnBeat.message()],
    notFollowable: [S.notFollowable.message()], fittedNotSound: [S.fittedNotSound.message()], fittedSourceMissing: [S.fittedSourceMissing.message('ast_x')],
    licenceNoDerivatives: [S.licenceNoDerivatives.message('CC-BY-ND-4.0')], licenceShareAlike: [S.licenceShareAlike.message('CC-BY-SA-4.0')],
    licenceUnknown: [S.licenceUnknown.message('custom:x'), S.licenceUnknown.message('')], licenceManyOrigins: [S.licenceManyOrigins.message()], alreadyFitted: [S.alreadyFitted.message()],
    fittedGrid: [S.fittedGrid.message()], removalNotBars: [S.removalNotBars.message()], joinNotFitted: [S.joinNotFitted.message('ast_x')],
  };
}
const serverSentences = (): string[] => Object.values(MUSICFIT_SERVER_REFUSALS).map((r) => (r.message as (s: string) => string)('12.5'));

describe('musicfit refusals in Hebrew', () => {
  const ops = opSentences();
  const all = [...Object.values(ops).flat(), ...serverSentences()];
  it('notBuilt is provoked for real until the bodies are built', () => {
    if (!MUSICFIT_OPS_BUILT) expect(ops.notBuilt.slice(0, 3)).toEqual(['set_clip_impact', 'sync_impact', 'mark_join_heard'].map((op) => MUSICFIT_REFUSALS.notBuilt.message(op)));
  });
  it('every sentence is worded, in Hebrew, with a next step, and no reason falls back to the generic words', () => {
    for (const en of all) {
      const he = translateRefusal('he', en);
      expect({ en, worded: !!he }).toEqual({ en, worded: true });
      expect({ en, hebrew: /[֐-׿]/.test(he!) }).toEqual({ en, hebrew: true });
      expect({ en, fallback: /לא עבר בדיקה/.test(he!) }).toEqual({ en, fallback: false });
      expect({ en, nextStep: /[.:;—]/.test(he!) }).toEqual({ en, nextStep: true });
    }
  });
  it('every pattern of the table is used by some sentence', () => {
    expect(MUSICFIT_REFUSAL_PATTERNS.filter((re) => !all.some((en) => re.test(en))).map(String)).toEqual([]);
  });
  it.todo('A: each refusal of set_clip_impact, sync_impact, add_fitted_music and mark_join_heard is provoked for real through its operation, in the order of MUSICFIT_REFUSALS, and equals the table');
  it.todo('B: each server refusal (needs_bars, no_join, too_short, too_long, not_from_start, fit_stale, fit_unstable, flash_gap) is provoked for real through the plan or apply route');
});

describe('musicfit strings', () => {
  it('the shared strings exist in both languages, Hebrew in Hebrew', () => {
    for (const lang of ['he', 'en'] as const) {
      const d = dictionaries[lang] as Record<string, string>;
      const missing = [...[...MUSICFIT_PUBLIC_OPS, ...MUSICFIT_INTERNAL_OPS].map((op) => `op.${op}`), ...Object.keys(MUSICFIT_HE)].filter((k) => !d[k]);
      expect({ lang, missing }).toEqual({ lang, missing: [] });
    }
    for (const [k, v] of Object.entries(MUSICFIT_HE)) expect({ k, hebrew: /[א-ת]/.test(v) }).toEqual({ k, hebrew: true });
  });
  it('nothing praises a join or an ending, and «מסונכרן» is never said', () => {
    const texts = [...Object.values(MUSICFIT_HE), ...Object.values(MUSICFIT_EN), ...Object.values(MUSICFIT_UNHEARD_LABEL), ...Object.values(MUSICFIT_COMPOSED_AGAIN),
      ...Object.values(joinMeasuredSentence({ similarity: 0.912, levelStepDb: -0.4, phraseBars: 4, tempoSpreadMs: 3, beatConfidence: 0.8 }))];
    for (const s of texts) { expect({ s, en: MUSICFIT_FORBIDDEN_WORDS.test(s) }).toEqual({ s, en: false }); expect({ s, he: MUSICFIT_FORBIDDEN_WORDS_HE.test(s) }).toEqual({ s, he: false }); }
    expect(MUSICFIT_HE['musicfit.unheard']).toBe(MUSICFIT_UNHEARD_LABEL.he);
    expect(MUSICFIT_EN['musicfit.unheard']).toBe(MUSICFIT_UNHEARD_LABEL.en);
    expect(MUSICFIT_HE['musicfit.composedAgain']).toBe(MUSICFIT_COMPOSED_AGAIN.he);
  });
  it('the measured sentence says "measured, not heard" with its numbers', () => {
    const s = joinMeasuredSentence({ similarity: 0.912, levelStepDb: -0.4, phraseBars: 4, tempoSpreadMs: 3, beatConfidence: null });
    expect(s.he).toBe('נמדד, לא נשמע: דמיון 0.912 בין התיבות שמשני צידי החיבור; הפרש עוצמה 0.4 dB; על גבול של 4 תיבות');
    expect(s.en).toMatch(/^Measured, not heard: similarity 0\.912/);
  });
});
