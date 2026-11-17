/**
 * Keeps the Hebrew wording of the life-line refusals (packages/i18n/src/lifeline.ts HE_LIFE) in step with the fixed English
 * sentences of the operations (packages/core/src/lifeOps.ts LIFE_REFUSALS), and the interface strings of the track complete.
 * The table is the contract both sides are written against; provoking each refusal through its operation is W1's test.
 */
import { describe, expect, it } from 'vitest';
import { LIFE_REFUSALS, MISSING_REASONS, CaptureSchema, type LifeRefusalKey } from '@pulseframe/core';
import { dictionaries, LIFE_REFUSAL_PATTERNS, translateRefusal } from '../../i18n/src/index.ts';

/** One real message of every refusal, built from the table itself with sample values. */
const SAMPLES: Record<LifeRefusalKey, string> = {
  assetNotFound: LIFE_REFUSALS.assetNotFound.message('ast_w1'), eventNotFound: LIFE_REFUSALS.eventNotFound.message('evt_w1'),
  lutHasNoDate: LIFE_REFUSALS.lutHasNoDate.message(), noSuchDay: LIFE_REFUSALS.noSuchDay.message(), dateOutOfRange: LIFE_REFUSALS.dateOutOfRange.message(),
  captureUnchanged: LIFE_REFUSALS.captureUnchanged.message(), noCaptureToRemove: LIFE_REFUSALS.noCaptureToRemove.message(), listedTwice: LIFE_REFUSALS.listedTwice.message(),
  shiftNoDate: LIFE_REFUSALS.shiftNoDate.message(3), shiftDayOnly: LIFE_REFUSALS.shiftDayOnly.message(41), shiftInherited: LIFE_REFUSALS.shiftInherited.message(7),
  notATitle: LIFE_REFUSALS.notATitle.message(), fieldsAlready: LIFE_REFUSALS.fieldsAlready.message(true),
  notFields: LIFE_REFUSALS.notFields.message('{weather}, {date:fancy}, {'), personFields: LIFE_REFUSALS.personFields.message('{age:per_1}, {name:per_1}'),
  fieldsStillThere: LIFE_REFUSALS.fieldsStillThere.message(),
  noDatedFiles: LIFE_REFUSALS.noDatedFiles.message(), tooManyEvents: LIFE_REFUSALS.tooManyEvents.message(), eventFileKind: LIFE_REFUSALS.eventFileKind.message(), eventLastFile: LIFE_REFUSALS.eventLastFile.message(),
  eventNothingToChange: LIFE_REFUSALS.eventNothingToChange.message(), eventFileNotIn: LIFE_REFUSALS.eventFileNotIn.message(), eventAddAndRemove: LIFE_REFUSALS.eventAddAndRemove.message(),
};

describe('Hebrew wording of the life-line refusals (ADR-0021)', () => {
  it('every refusal of the table is recognised and worded in Hebrew, with its numbers and brace groups kept; no pattern is left without a refusal', () => {
    const matched = new Set<number>();
    for (const [key, message] of Object.entries(SAMPLES)) {
      const he = translateRefusal('he', message);
      expect(he, `${key}: ${message}`).toBeDefined();
      expect(he, key).toMatch(/[֐-׿]/);
      const hits = LIFE_REFUSAL_PATTERNS.map((re, i) => (re.test(message) ? i : -1)).filter((i) => i >= 0);
      expect(hits.length, `${key} is recognised by exactly one life-line pattern`).toBe(1);
      matched.add(hits[0]!);
      expect(translateRefusal('en', message), key).toBeUndefined(); // English shows the server's own sentence
    }
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(LIFE_REFUSALS).sort());
    expect(LIFE_REFUSAL_PATTERNS.filter((_, i) => !matched.has(i)).map((re) => re.source)).toEqual([]);
    expect(translateRefusal('he', SAMPLES.shiftDayOnly)).toContain('41');
    expect(translateRefusal('he', SAMPLES.dateOutOfRange)).toMatch(/1900.*2100/);
    expect(translateRefusal('he', SAMPLES.tooManyEvents)).toContain('2000');
    expect(translateRefusal('he', SAMPLES.notFields)).toContain('{weather}, {date:fancy}, {');
    expect(translateRefusal('he', SAMPLES.personFields)).toContain('{age:per_1}, {name:per_1}');
    expect(translateRefusal('he', LIFE_REFUSALS.fieldsAlready.message(false))).not.toBe(translateRefusal('he', SAMPLES.fieldsAlready));
  });
  it('the shared strings of the track exist in both languages: a headline for each preflight code, a line for each reason a field has no words, a label for each capture source', () => {
    const missing: string[] = [];
    const keys = [
      ...['field_no_data', 'field_sunset_undecided', 'capture_estimated', 'stamp_no_date'].map((c) => `preflight.${c}`),
      ...MISSING_REASONS.map((r) => `life.missing.${r}`),
      ...CaptureSchema.shape.source.options.map((s) => `life.capture.source.${s}`),
    ];
    for (const lang of ['he', 'en'] as const) for (const k of keys) if (!(dictionaries[lang] as Record<string, string>)[k]?.trim()) missing.push(`${lang} ${k}`);
    expect(missing).toEqual([]);
    for (const k of keys) expect((dictionaries.he as Record<string, string>)[k], k).not.toBe((dictionaries.en as Record<string, string>)[k]);
  });
  // W1 (packages/evals/src/refusal-wording.test.ts gains a life-line case when the bodies land):
  it.todo('every life-line refusal is provoked for real through its operation and its message is recognised');
});
