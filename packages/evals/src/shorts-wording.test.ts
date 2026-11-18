/**
 * Keeps the Hebrew wording of the refusals of shorts (packages/i18n/src/shorts.ts HE_SHORTS) in step with their fixed English
 * sentences (core shortsContract.ts SEQUENCE_REFUSALS, SHORTS_REFUSALS, SHORTS_PROPOSE_REFUSED, BROWSER_EXPORT_SIDECAR_REFUSED;
 * ADR-0018). The sentences are built from their tables (the bodies that raise them are the workers'); the one an existing operation already says today
 * (`sequence <id> not found`, ops.ts seqOf) is also provoked for real. Every pattern is used. Also: the shared strings exist in
 * both languages, every reason code, score component, warning and error code has a label, the stage words are worded, the
 * decided labels are exact, and no string anywhere in the track calls a moment viral or predicts views or retention.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  applyTransaction, BROWSER_EXPORT_SIDECAR_REFUSED, CANDIDATE_WARNINGS, createProject, OpError, PLAN_WARNING_CODES, SCORE_COMPONENTS, SEQUENCE_REFUSALS, SHORT_REASON_CODES, SHORTS_ERROR_CODES,
  SHORTS_PROPOSE_REFUSED, SHORTS_RANK_METHOD, SHORTS_REFUSALS, SHORTS_STAGES, type SequenceRefusalKey, type ShortsRefusalKey,
} from '@pulseframe/core';
import { dictionaries, jobStageLabel, SHORTS_REFUSAL_PATTERNS, TRACKING_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';
import { SHORTS_EN, SHORTS_HE } from '../../i18n/src/shorts.ts';

const SEQ: Record<SequenceRefusalKey, string> = {
  notBuilt: SEQUENCE_REFUSALS.notBuilt.message('add_sequence'),
  sequenceNotFound: SEQUENCE_REFUSALS.sequenceNotFound.message('seq_w1'),
  mainSequence: SEQUENCE_REFUSALS.mainSequence.message(),
  mainSequenceFormat: SEQUENCE_REFUSALS.mainSequenceFormat.message(),
  tooManySequences: SEQUENCE_REFUSALS.tooManySequences.message(),
  sequenceNotEmpty: SEQUENCE_REFUSALS.sequenceNotEmpty.message(3),
  sequenceNothingToChange: SEQUENCE_REFUSALS.sequenceNothingToChange.message(),
  sequenceFormatOdd: SEQUENCE_REFUSALS.sequenceFormatOdd.message(),
  keysNotIncreasing: SEQUENCE_REFUSALS.keysNotIncreasing.message(),
  keyBeforeStart: SEQUENCE_REFUSALS.keyBeforeStart.message(),
  captionKeys: SEQUENCE_REFUSALS.captionKeys.message(),
  notPlanMade: SEQUENCE_REFUSALS.notPlanMade.message('seq_main'),
  planStepForbidden: SEQUENCE_REFUSALS.planStepForbidden.message(4, 'restore_entities'),
  planStepInvalid: SEQUENCE_REFUSALS.planStepInvalid.message(2, 'add_clip', '✖ Invalid input\n  → at start'),
  originNotCreated: SEQUENCE_REFUSALS.originNotCreated.message(1),
};
const SHORTS: Record<ShortsRefusalKey, string> = {
  notBuilt: SHORTS_REFUSALS.notBuilt.message('finding moments'),
  assetNotFound: SHORTS_REFUSALS.assetNotFound.message('ast_x'),
  needsVideo: SHORTS_REFUSALS.needsVideo.message(),
  pickTooShort: SHORTS_REFUSALS.pickTooShort.message(2, 3),
  pickTooLong: SHORTS_REFUSALS.pickTooLong.message(1, 180),
  pickOutsideFile: SHORTS_REFUSALS.pickOutsideFile.message(3),
  unknownProfile: SHORTS_REFUSALS.unknownProfile.message('tall-9x21'),
  unknownCaptionLook: SHORTS_REFUSALS.unknownCaptionLook.message('caption.nope'),
  needsMeasurement: SHORTS_REFUSALS.needsMeasurement.message(),
  notVerbatim: SHORTS_REFUSALS.notVerbatim.message(1),
  offWordBoundary: SHORTS_REFUSALS.offWordBoundary.message(2, 'end'),
  planTooLarge: SHORTS_REFUSALS.planTooLarge.message(2412),
  motionTrackNotFound: SHORTS_REFUSALS.motionTrackNotFound.message('mtk_x'),
  motionTrackOtherFile: SHORTS_REFUSALS.motionTrackOtherFile.message('mtk_x'),
  rotatedClip: SHORTS_REFUSALS.rotatedClip.message(),
  notPlanMade: SHORTS_REFUSALS.notPlanMade.message('seq_main'),
  sequenceNotFound: SHORTS_REFUSALS.sequenceNotFound.message('seq_w2'),
};
/** Refusals worded by another track's table on purpose (the same words as there). */
const ELSEWHERE: Partial<Record<ShortsRefusalKey, readonly RegExp[]>> = { motionTrackNotFound: TRACKING_REFUSAL_PATTERNS };

describe('Hebrew wording of the refusals of shorts (ADR-0018)', () => {
  it('every refusal is worded in Hebrew, recognised by exactly one shorts pattern (or, on purpose, by another table), with its numbers kept; no pattern is left without a refusal', () => {
    expect(Object.keys(SEQ).sort()).toEqual(Object.keys(SEQUENCE_REFUSALS).sort());
    expect(Object.keys(SHORTS).sort()).toEqual(Object.keys(SHORTS_REFUSALS).sort());
    const matched = new Set<number>();
    const all: [string, string, readonly RegExp[] | undefined][] = [
      ...Object.entries(SEQ).map(([k, m]) => [`sequence.${k}`, m, undefined] as [string, string, undefined]),
      ...Object.entries(SHORTS).map(([k, m]) => [`shorts.${k}`, m, ELSEWHERE[k as ShortsRefusalKey]] as [string, string, readonly RegExp[] | undefined]),
      ['propose', SHORTS_PROPOSE_REFUSED, undefined],
      ['browserSidecar', BROWSER_EXPORT_SIDECAR_REFUSED.message, undefined],
    ];
    for (const [key, message, elsewhere] of all) {
      expect(translateRefusal('he', message), `${key}: ${message}`).toMatch(/[֐-׿]/);
      expect(translateRefusal('en', message), key).toBeUndefined();
      const hits = SHORTS_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      if (elsewhere) {
        expect(hits, `${key} is worded by its own table`).toEqual([]);
        expect(elsewhere.filter((re) => re.test(message)), key).toHaveLength(1);
        continue;
      }
      expect(hits.length, `${key} is recognised by exactly one shorts pattern`).toBe(1);
      matched.add(hits[0]!);
    }
    expect(SHORTS_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', SEQ.tooManySequences)).toContain('64');
    expect(translateRefusal('he', SEQ.sequenceNotEmpty)).toContain('3');
    expect(translateRefusal('he', SHORTS.planTooLarge)).toMatch(/2412.*2000/);
    expect(translateRefusal('he', SHORTS.pickTooShort)).toMatch(/2.*3/);
    expect(translateRefusal('he', SHORTS.unknownProfile)).toContain('tall-9x21');
  });
  it('the wording an operation already says today is the one the table recognises (a range operation naming a sequence that is not there)', () => {
    const doc = createProject({ id: 'prj_w', name: 'W' });
    try { applyTransaction(doc, [{ op: 'add_track', args: { sequenceId: 'seq_none', kind: 'video' } }], { idSeed: 'w_', actor: 'test' }); throw new Error('not refused'); } catch (e) {
      expect(e).toBeInstanceOf(OpError);
      expect((e as OpError).message).toBe(SEQUENCE_REFUSALS.sequenceNotFound.message('seq_none'));
      expect(translateRefusal('he', (e as OpError).message)).toMatch(/[֐-׿]/);
    }
  });
});

describe('shared strings of shorts', () => {
  it('both languages hold every key; the decided labels are exact', () => {
    expect(Object.keys(SHORTS_EN).sort()).toEqual(Object.keys(SHORTS_HE).sort());
    for (const lang of ['he', 'en'] as const) for (const k of Object.keys(SHORTS_HE)) expect((dictionaries[lang] as Record<string, string>)[k], `${lang} ${k}`).toBeTruthy();
    expect(SHORTS_HE['shorts.score.label']).toBe('ציון יחסי בתוך הסרטון הזה (היוריסטיקה)');
    expect(SHORTS_HE['shorts.platform.unverified']).toBe('לא אומת');
    expect(SHORTS_HE['shorts.noTranscript']).toBe('אין תמליל — הגבולות לפי הפסקות וסצנות');
    expect(SHORTS_HE['shorts.variantProjectWide']).toBe('פורמטים מקושרים חלים על כל הפרויקט');
  });
  it('every reason code, score component, warning and error code has a label in both languages', () => {
    const keys = [
      ...SHORT_REASON_CODES.map((c) => `shorts.reason.${c}`), ...SCORE_COMPONENTS.map((c) => `shorts.component.${c}`),
      ...CANDIDATE_WARNINGS.map((c) => `shorts.warn.${c}`), ...PLAN_WARNING_CODES.map((c) => `shorts.plan.${c}`),
      ...SHORTS_ERROR_CODES.map((c) => `error.code.${c}`), 'error.code.undo_conflict',
    ];
    for (const lang of ['he', 'en'] as const) expect(keys.filter((k) => !(dictionaries[lang] as Record<string, string>)[k]), lang).toEqual([]);
  });
  it('the measuring job\'s stages are worded, counts kept', () => {
    for (const s of SHORTS_STAGES) expect(jobStageLabel(`${s} 3/10`, 'he')).toMatch(/^[֐-׿].* 3\/10$/);
  });
  it('no string, method or refusal of the track calls a moment viral or predicts views or retention (SPEC.md:624)', () => {
    const forbidden = /viral|virality|ויראל|retention|predict/i;
    /** What a sentence says once its negations are taken out ("not a prediction of views", "never viral" may stand). */
    const affirmative = (s: string) => s.replace(/\b(not a|never|no)\b[^;.,]*/gi, '');
    const texts = [...Object.values(SHORTS_HE), ...Object.values(SHORTS_EN), SHORTS_RANK_METHOD, ...Object.values(SEQ), ...Object.values(SHORTS), SHORTS_PROPOSE_REFUSED, BROWSER_EXPORT_SIDECAR_REFUSED.message, BROWSER_EXPORT_SIDECAR_REFUSED.hint];
    expect(texts.filter((s) => forbidden.test(affirmative(s)))).toEqual([]);
    expect(SHORTS_RANK_METHOD).toMatch(/heuristic; not a prediction/);
    // the files of the track, whoever fills them later (the workers' bodies are checked again by their own strings tests)
    const files = ['../../core/src/shortsContract.ts', '../../core/src/sequenceOps.ts', '../../core/src/highlights.ts', '../../core/src/statements.ts', '../../../apps/server/src/shorts.ts', '../../../apps/server/src/shortsFeatures.ts', '../../i18n/src/shorts.ts'];
    for (const f of files) {
      const text = readFileSync(new URL(f, import.meta.url), 'utf8');
      // the contract may name the forbidden words only to forbid them
      const lines = text.split('\n').filter((l) => forbidden.test(affirmative(l)) && !/forbid/i.test(l));
      expect(lines, f).toEqual([]);
    }
  });
});
