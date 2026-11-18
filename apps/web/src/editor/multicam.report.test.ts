import { describe, expect, it } from 'vitest';
import { reportOf, unchangedPlaces } from './multicamSession.ts';
import { MULTICAM_STRINGS } from './multicam.strings.ts';

const out = (cuts: number, skipped: { reason: string }[]) => ({ cuts: Array.from({ length: cuts }, () => ({ at: { value: '0', timescale: 1 }, angleId: 'a' })), switchedClipIds: [], createdClipIds: [], healedClipIds: [], skipped, dropped: [], warnings: [] }) as never;

describe('the live report of a recording (proof:multicam-ui U1 found "12 cuts saved. 5 cuts not saved" when all 12 had landed)', () => {
  it('a stretch already on the asked angle is not counted as unchanged; the other reasons are', () => {
    const rep = reportOf([out(12, [{ reason: 'already_on_angle' }, { reason: 'already_on_angle' }, { reason: 'already_on_angle' }, { reason: 'already_on_angle' }, { reason: 'not_covered' }])]);
    expect(rep.saved).toBe(12);
    expect(unchangedPlaces(rep)).toEqual([{ reason: 'not_covered', count: 1 }]);
  });
  it('nothing unchanged when every skip was already on the angle', () => {
    expect(unchangedPlaces(reportOf([out(3, [{ reason: 'already_on_angle' }])]))).toEqual([]);
  });
  it('the wording speaks of places in the program, not of lost cuts, in both languages', () => {
    for (const lang of ['he', 'en'] as const) {
      const S = MULTICAM_STRINGS[lang];
      expect(S.skippedSome(1, 'x')).not.toMatch(/cuts not saved|חתכים לא נשמרו/);
      expect(S.skippedSome(3, 'x')).toContain('3');
    }
  });
});
