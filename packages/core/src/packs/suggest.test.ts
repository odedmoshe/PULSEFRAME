/**
 * When the two packs are suggested (ADR-0022): the Hanukkah window of the life line's holiday table on the Israeli schedule
 * (21 days before the first day until 10 days after the last), and the birthday window of 14 days either side of a birthday
 * the caller knows of. Dates: 25 Kislev 5787 is Saturday 5 December 2026, so Hanukkah begins on the evening of Friday
 * 4 December 2026 and lasts until the evening of 12 December (2 Tevet).
 */
import { describe, expect, it } from 'vitest';
import { PACKS } from './index.ts';
import { candleNight, suggestPacks } from './suggest.ts';

const day = (y: number, m: number, d: number) => ({ y, m, d });
const ids = (y: number, m: number, d: number, hints: Parameters<typeof suggestPacks>[2] = []) => suggestPacks(PACKS, day(y, m, d), hints).map((s) => s.packId);

describe('the Hanukkah window', () => {
  it('2026-11-17 suggests Hanukkah, 17 days to the evening of 4 December, whose first day is 5 December', () => {
    const [s] = suggestPacks(PACKS, day(2026, 11, 17));
    expect(s).toMatchObject({ packId: 'pack.hanukkah', daysAway: 17, firstDay: day(2026, 12, 5), eveningBefore: true });
    expect(s!.reason.he).toBe('חנוכה מתחיל בערב 4 בדצמבר · בעוד 17 ימים');
    expect(suggestPacks(PACKS, day(2026, 11, 17))).toHaveLength(1);
  });
  it('is suggested from 21 days before the first day, and not the day before that', () => {
    expect(ids(2026, 11, 14)).toEqual(['pack.hanukkah']);
    expect(ids(2026, 11, 13)).toEqual([]);
  });
  it('is suggested through the eight days and ten days after, then not', () => {
    expect(suggestPacks(PACKS, day(2026, 12, 4))[0]).toMatchObject({ daysAway: 0, reason: { he: 'חנוכה מתחיל הערב' } });
    expect(suggestPacks(PACKS, day(2026, 12, 8))[0]!.daysAway).toBe(0);
    expect(ids(2026, 12, 22)).toEqual(['pack.hanukkah']);
    expect(ids(2026, 12, 23)).toEqual([]);
  });
  it('2027-01-05 suggests nothing', () => {
    expect(ids(2027, 1, 5)).toEqual([]);
  });
  it('a day that does not exist suggests nothing', () => {
    expect(ids(2026, 2, 30)).toEqual([]);
  });
  it('the candle of each night: the lighting of 4 December is candle 1, and the daytime of 5 December is still the first day', () => {
    expect(candleNight(day(2026, 12, 4), true)).toBe(1);
    expect(candleNight(day(2026, 12, 4), false)).toBeNull();
    expect(candleNight(day(2026, 12, 11), true)).toBe(8);
    expect(candleNight(day(2026, 12, 12), true)).toBeNull();
  });
});

describe('the birthday window', () => {
  const hint = (y: number, m: number, d: number) => [{ kind: 'birthday' as const, on: day(y, m, d), name: 'נועה' }];
  it('needs a birthday the caller knows of: with none the pack is only listed', () => {
    expect(ids(2026, 3, 1)).toEqual([]);
  });
  it('is suggested 14 days before, on the day and 14 days after, not beyond', () => {
    expect(ids(2026, 3, 1, hint(2026, 3, 15))).toEqual(['pack.birthday']);
    expect(ids(2026, 2, 28, hint(2026, 3, 15))).toEqual([]);
    expect(ids(2026, 3, 15, hint(2026, 3, 15))).toEqual(['pack.birthday']);
    expect(ids(2026, 3, 29, hint(2026, 3, 15))).toEqual(['pack.birthday']);
    expect(ids(2026, 3, 30, hint(2026, 3, 15))).toEqual([]);
  });
  it('says whose birthday it is and how far', () => {
    const [s] = suggestPacks(PACKS, day(2026, 3, 12), hint(2026, 3, 15));
    expect(s).toMatchObject({ packId: 'pack.birthday', daysAway: 3, eveningBefore: false });
    expect(s!.reason.en).toContain("נועה's birthday in 3 days");
  });
  it('a birthday in Hanukkah week suggests both, the nearer first', () => {
    const both = suggestPacks(PACKS, day(2026, 12, 6), hint(2026, 12, 10));
    expect(both.map((s) => s.packId)).toEqual(['pack.hanukkah', 'pack.birthday']);
  });
});
