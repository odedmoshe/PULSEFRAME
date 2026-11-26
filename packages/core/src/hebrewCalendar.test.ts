/**
 * The Hebrew calendar (hebrewCalendar.ts, ADR-0021) against three things outside its own arithmetic: the Intl Hebrew calendar of
 * this machine (ICU) for every day of 1900–2100, the dates of hebrewCalendar.published.ts (its header says where each comes
 * from), and hand tables. Intl and Date are used HERE ONLY, as oracles: the code under test never calls them (the last test
 * reads the sources to make sure).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  daysInHebrewYear, formatHebrewDate, gregorianFromRd, GREGORIAN_MONTH_NAMES, hanukkahDay, HEBREW_MONTH_NAMES, hebrewFromRd, hebrewNewYearRd, hebrewNumeral, HOLIDAY_FAMILIES, holidaysOn, holidayTable,
  isHebrewLeapYear, isValidGregorian, rdFromGregorian, rdFromHebrew, weekdayOf, type HebrewMonth,
} from './hebrewCalendar.ts';
import { ALSO_PUBLISHED, PUBLISHED_FIRST_DAYS } from './hebrewCalendar.published.ts';

const rd = (iso: string) => rdFromGregorian({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
const iso = (n: number) => { const g = gregorianFromRd(n); return `${String(g.y).padStart(4, '0')}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`; };
const FIRST = rd('1900-01-01'), LAST = rd('2100-12-31');
/** ICU's English month names → ours. */
/** A numeral with a final letter written as the ordinary one. */
const plain = (s: string) => s.replace(/[ךםןףץ]/g, (c) => ({ 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' })[c]!);
const ICU_MONTH: Record<string, HebrewMonth> = { Tishri: 'tishrei', Heshvan: 'cheshvan', Kislev: 'kislev', Tevet: 'tevet', Shevat: 'shevat', Adar: 'adar', 'Adar I': 'adar1', 'Adar II': 'adar2', Nisan: 'nisan', Iyar: 'iyar', Sivan: 'sivan', Tamuz: 'tammuz', Av: 'av', Elul: 'elul' };

describe('Gregorian day numbers', () => {
  it('day 1 is Monday 0001-01-01; every day of 1900–2100 goes to a day number and back, in step with the machine\'s own calendar', () => {
    expect(rdFromGregorian({ y: 1, m: 1, d: 1 })).toBe(1);
    expect(weekdayOf(1)).toBe(1);
    expect(LAST - FIRST + 1).toBe(73414);
    let wrong = 0;
    const t0 = Date.UTC(1900, 0, 1);
    for (let n = FIRST; n <= LAST; n++) {
      const g = gregorianFromRd(n), o = new Date(t0 + (n - FIRST) * 86400000);
      if (g.y !== o.getUTCFullYear() || g.m !== o.getUTCMonth() + 1 || g.d !== o.getUTCDate() || weekdayOf(n) !== o.getUTCDay() || rdFromGregorian(g) !== n || !isValidGregorian(g)) wrong++;
    }
    expect(wrong).toBe(0);
  });
  it('knows which days exist, and counts across year 1 and far years', () => {
    expect(isValidGregorian({ y: 2024, m: 2, d: 29 })).toBe(true);
    for (const g of [{ y: 2023, m: 2, d: 29 }, { y: 1900, m: 2, d: 29 }, { y: 2024, m: 4, d: 31 }, { y: 2024, m: 13, d: 1 }, { y: 2024, m: 0, d: 1 }, { y: 2024, m: 1, d: 0 }, { y: 2024, m: 1, d: 1.5 }]) expect(isValidGregorian(g), JSON.stringify(g)).toBe(false);
    expect(isValidGregorian({ y: 2000, m: 2, d: 29 })).toBe(true);
    for (const n of [-400000, -1, 0, 1, 365, 366, 146097, 146098, 800000, 3000000]) expect(rdFromGregorian(gregorianFromRd(n)), String(n)).toBe(n);
    expect(gregorianFromRd(0)).toEqual({ y: 0, m: 12, d: 31 });
    expect(weekdayOf(rd('2024-12-25'))).toBe(3); // a Wednesday
    expect(weekdayOf(-1)).toBe(6);
  });
});

describe('Hebrew calendar against Intl (ICU), every day of 1900–2100', () => {
  it('year, month and day agree on all 73,414 days, and so do the Hebrew-letter day and year', () => {
    const en = new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' });
    const he = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'UTC', dateStyle: 'long' });
    const t0 = Date.UTC(1900, 0, 1);
    const mismatches: string[] = [], letterMismatches: string[] = [];
    let days = 0;
    for (let n = FIRST; n <= LAST; n++) {
      days++;
      const at = new Date(t0 + (n - FIRST) * 86400000);
      const parts = Object.fromEntries(en.formatToParts(at).map((p) => [p.type, p.value]));
      const h = hebrewFromRd(n);
      if (h.y !== Number(parts.year) || h.m !== ICU_MONTH[parts.month!] || h.d !== Number(parts.day)) { if (mismatches.length < 5) mismatches.push(`${iso(n)}: ours ${h.d} ${h.m} ${h.y}, ICU ${parts.day} ${parts.month} ${parts.year}`); else mismatches.push(''); }
      const letters = Object.fromEntries(he.formatToParts(at).map((p) => [p.type, p.value]));
      // ICU ends a year with a final letter only for ף (תש״ף); we do for all five (תש״ך, תש״ם, תש״ן, תר״ץ): compared apart from that, and the hand table holds the forms
      if (hebrewNumeral(h.d) !== letters.day || plain(hebrewNumeral(h.y)) !== plain(letters.year!) || (letters.year!.endsWith('ף') && !hebrewNumeral(h.y).endsWith('ף'))) { if (letterMismatches.length < 5) letterMismatches.push(`${iso(n)}: ours ${hebrewNumeral(h.d)} ${hebrewNumeral(h.y)}, ICU ${letters.day} ${letters.year}`); else letterMismatches.push(''); }
      if (rdFromHebrew(h) !== n) mismatches.push(`${iso(n)}: the Hebrew date does not come back to its day number`);
    }
    console.log(`Hebrew calendar against Intl (ICU ${process.versions.icu}): ${days} days, ${mismatches.length} date mismatches, ${letterMismatches.length} numeral mismatches`);
    expect(days).toBe(73414);
    expect(mismatches).toEqual([]);
    expect(letterMismatches).toEqual([]);
  }, 120_000);
});

describe('Hebrew years', () => {
  it('the anchor: 1 Tishrei 5785 is 3 October 2024', () => {
    expect(hebrewNewYearRd(5785)).toBe(rd('2024-10-03'));
    expect(hebrewFromRd(rd('2024-10-03'))).toEqual({ y: 5785, m: 'tishrei', d: 1 });
    expect(hebrewFromRd(rd('2024-10-02'))).toEqual({ y: 5784, m: 'elul', d: 29 });
    expect(hebrewFromRd(rd('2024-12-26'))).toEqual({ y: 5785, m: 'kislev', d: 25 });
    expect(hebrewFromRd(rd('2024-03-24'))).toEqual({ y: 5784, m: 'adar2', d: 14 });
    expect(hebrewFromRd(rd('2025-05-03'))).toEqual({ y: 5785, m: 'iyar', d: 5 });
  });
  it('all six year lengths occur, a new year never falls on Sunday, Wednesday or Friday, and leap years follow the 19-year cycle', () => {
    const seen = new Set<number>();
    for (let y = 5660; y <= 5861; y++) {
      const length = daysInHebrewYear(y);
      seen.add(length);
      expect([353, 354, 355, 383, 384, 385]).toContain(length);
      expect(length > 380, String(y)).toBe(isHebrewLeapYear(y));
      expect([0, 3, 5]).not.toContain(weekdayOf(hebrewNewYearRd(y)));
    }
    expect([...seen].sort()).toEqual([353, 354, 355, 383, 384, 385]);
    expect([5784, 5787, 5790, 5793, 5795, 5798, 5801].every(isHebrewLeapYear)).toBe(true); // years 3, 6, 8, 11, 14, 17, 19 of the cycle
    expect([5785, 5786, 5788, 5789].some(isHebrewLeapYear)).toBe(false);
  });
  it('a date that does not exist is a RangeError: 30 Cheshvan in a short year, Adar I in a common year, plain Adar in a leap year', () => {
    expect(daysInHebrewYear(5785)).toBe(355); // a full common year: 30 Cheshvan exists
    expect(rdFromHebrew({ y: 5785, m: 'cheshvan', d: 30 })).toBe(rdFromHebrew({ y: 5785, m: 'kislev', d: 1 }) - 1);
    expect(daysInHebrewYear(5786)).toBe(354);
    expect(() => rdFromHebrew({ y: 5786, m: 'cheshvan', d: 30 })).toThrow(RangeError);
    expect(daysInHebrewYear(5784)).toBe(383); // a short leap year: Kislev has 29 days
    expect(() => rdFromHebrew({ y: 5784, m: 'kislev', d: 30 })).toThrow(RangeError);
    expect(() => rdFromHebrew({ y: 5785, m: 'adar1', d: 1 })).toThrow(RangeError);
    expect(() => rdFromHebrew({ y: 5784, m: 'adar', d: 1 })).toThrow(RangeError);
    expect(() => rdFromHebrew({ y: 5785, m: 'tishrei', d: 0 })).toThrow(RangeError);
    expect(() => rdFromHebrew({ y: 5785, m: 'tishrei', d: 31 })).toThrow(RangeError);
    expect(rdFromHebrew({ y: 5784, m: 'adar1', d: 30 }) + 1).toBe(rdFromHebrew({ y: 5784, m: 'adar2', d: 1 }));
  });
});

describe('Hebrew-letter numerals and wording', () => {
  it('the hand table: 1–30, the two exceptions, hundreds, years with the thousands dropped', () => {
    const table: [number, string][] = [
      [1, 'א׳'], [2, 'ב׳'], [3, 'ג׳'], [4, 'ד׳'], [5, 'ה׳'], [6, 'ו׳'], [7, 'ז׳'], [8, 'ח׳'], [9, 'ט׳'], [10, 'י׳'],
      [11, 'י״א'], [12, 'י״ב'], [13, 'י״ג'], [14, 'י״ד'], [15, 'ט״ו'], [16, 'ט״ז'], [17, 'י״ז'], [18, 'י״ח'], [19, 'י״ט'], [20, 'כ׳'],
      [21, 'כ״א'], [22, 'כ״ב'], [23, 'כ״ג'], [24, 'כ״ד'], [25, 'כ״ה'], [26, 'כ״ו'], [27, 'כ״ז'], [28, 'כ״ח'], [29, 'כ״ט'], [30, 'ל׳'],
      [33, 'ל״ג'], [100, 'ק׳'], [115, 'קט״ו'], [116, 'קט״ז'], [400, 'ת׳'], [500, 'ת״ק'], [900, 'תת״ק'], [999, 'תתקצ״ט'],
      [5784, 'תשפ״ד'], [5785, 'תשפ״ה'], [5786, 'תשפ״ו'], [5800, 'ת״ת'], [5801, 'תת״א'], [5708, 'תש״ח'], [5700, 'ת״ש'], [5000, 'ה׳ אלפים'],
      // a year that ends in 20, 40, 50, 80 or 90 ends with the letter's final form, as it is printed; a single letter never does
      [5720, 'תש״ך'], [5740, 'תש״ם'], [5750, 'תש״ן'], [5780, 'תש״ף'], [5690, 'תר״ץ'], [5790, 'תש״ץ'], [5760, 'תש״ס'], [5770, 'תש״ע'], [40, 'מ׳'], [90, 'צ׳'],
      // letters that would spell an unlucky word change places, as in print: 5744 (1983–84) and 5698 (1937–38)
      [5744, 'תשד״מ'], [5698, 'תרח״צ'], [304, 'ד״ש'], [344, 'שד״מ'], [298, 'רח״צ'], [743, 'תשמ״ג'], [745, 'תשמ״ה'],
    ];
    for (const [n, want] of table) expect(hebrewNumeral(n), String(n)).toBe(want);
    // the marks are the Hebrew ones, not ASCII quotes
    expect(hebrewNumeral(1).charCodeAt(1)).toBe(0x05f3);
    expect(hebrewNumeral(11).charCodeAt(1)).toBe(0x05f4);
    for (const bad of [0, -1, 10000, 1.5, Number.NaN]) expect(() => hebrewNumeral(bad), String(bad)).toThrow(RangeError);
    for (let n = 1; n <= 9999; n++) expect(hebrewNumeral(n).length).toBeGreaterThan(1);
  });
  it('a date in words, with and without the year, and the month tables', () => {
    expect(formatHebrewDate({ y: 5785, m: 'kislev', d: 25 })).toBe('כ״ה בכסלו תשפ״ה');
    expect(formatHebrewDate({ y: 5785, m: 'kislev', d: 25 }, { year: false })).toBe('כ״ה בכסלו');
    expect(formatHebrewDate({ y: 5784, m: 'adar2', d: 14 })).toBe('י״ד באדר ב׳ תשפ״ד');
    expect(formatHebrewDate({ y: 5785, m: 'tishrei', d: 1 })).toBe('א׳ בתשרי תשפ״ה');
    expect(Object.keys(HEBREW_MONTH_NAMES)).toHaveLength(14);
    expect(GREGORIAN_MONTH_NAMES).toHaveLength(12);
    expect(GREGORIAN_MONTH_NAMES[2]).toEqual({ he: 'מרץ', en: 'March' });
  });
});

describe('holidays on the Israeli schedule', () => {
  const idsOn = (date: string, part: 'day' | 'night' = 'day') => holidaysOn(rd(date), part).map((h) => h.id);
  it('the 45 dates of the plan\'s table (see hebrewCalendar.published.ts for where they come from)', () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const row of PUBLISHED_FIRST_DAYS) for (const date of row.dates) { checked++; if (!idsOn(date).includes(row.id)) wrong.push(`${row.name} ${date}: ${idsOn(date).join(',') || 'nothing'}`); }
    console.log(`published holiday dates: ${checked - wrong.length}/${checked}`);
    expect(checked).toBe(45);
    expect(wrong).toEqual([]);
    // the day before the first daytime date is not that holiday's day (it is its eve, or nothing)
    for (const row of PUBLISHED_FIRST_DAYS) for (const date of row.dates) expect(holidaysOn(rd(date) - 1, 'day').map((h) => h.id), `${row.name} ${date}`).not.toContain(row.id);
  });
  it('the days that move with the weekday, the end of Hanukkah and the fixed days read from the same published lists', () => {
    const wrong: string[] = [];
    let checked = 0;
    for (const row of ALSO_PUBLISHED) for (const date of row.dates) { checked++; if (!idsOn(date).includes(row.id)) wrong.push(`${row.name} ${date}: ${idsOn(date).join(',') || 'nothing'}`); }
    expect(wrong).toEqual([]);
    expect(checked).toBeGreaterThan(60);
    // each of those holidays falls once in its Gregorian year: the published date is the only day of that year with the row
    for (const row of ALSO_PUBLISHED.filter((r) => /observed/.test(r.name))) for (const date of row.dates) {
      const year = date.slice(0, 4);
      const days: string[] = [];
      for (let n = rd(`${year}-01-01`); n <= rd(`${year}-12-31`); n++) if (holidaysOn(n, 'day').some((h) => h.id === row.id)) days.push(iso(n));
      expect(days, `${row.name} ${year}`).toEqual([date]);
    }
  });
  it('Yom HaAtzmaut and Yom HaZikaron for 5783–5787, and the Monday rule only from 5764', () => {
    const atzmaut = (y: number) => holidayTable(y).filter((r) => r.holiday.id === 'yom-haatzmaut').map((r) => iso(r.rd));
    const zikaron = (y: number) => holidayTable(y).filter((r) => r.holiday.id === 'yom-hazikaron').map((r) => iso(r.rd));
    expect([5783, 5784, 5785, 5786, 5787].map(atzmaut)).toEqual([['2023-04-26'], ['2024-05-14'], ['2025-05-01'], ['2026-04-22'], ['2027-05-12']]);
    expect([5783, 5784, 5785, 5786, 5787].map(zikaron)).toEqual([['2023-04-25'], ['2024-05-13'], ['2025-04-30'], ['2026-04-21'], ['2027-05-11']]);
    // 5 Iyar 5785 was Shabbat (3 May 2025): kept on Thursday 3 Iyar. 5 Iyar 5784 was a Monday: kept on Tuesday 6 Iyar.
    expect(weekdayOf(rdFromHebrew({ y: 5785, m: 'iyar', d: 5 }))).toBe(6);
    expect(hebrewFromRd(rd('2025-05-01'))).toEqual({ y: 5785, m: 'iyar', d: 3 });
    expect(hebrewFromRd(rd('2024-05-14'))).toEqual({ y: 5784, m: 'iyar', d: 6 });
    // 5 Iyar 5757 was Monday 12 May 1997, and was kept: the Monday rule begins with 5764
    expect(weekdayOf(rd('1997-05-12'))).toBe(1);
    expect(hebrewFromRd(rd('1997-05-12'))).toEqual({ y: 5757, m: 'iyar', d: 5 });
    expect(atzmaut(5757)).toEqual(['1997-05-12']);
    expect(zikaron(5757)).toEqual(['1997-05-11']);
    expect(atzmaut(5764)).toEqual(['2004-04-27']); // 5 Iyar 5764 was Monday 26 April 2004
    // every year from 5709 has exactly one of each, the memorial day the day before, never on Friday or Shabbat or (from 5764) with the memorial day on Sunday
    for (let y = 5711; y <= 5861; y++) {
      const a = holidayTable(y).filter((r) => r.holiday.id === 'yom-haatzmaut'), z = holidayTable(y).filter((r) => r.holiday.id === 'yom-hazikaron');
      expect(a.length, String(y)).toBe(1);
      expect(z.length, String(y)).toBe(1);
      expect(z[0]!.rd).toBe(a[0]!.rd - 1);
      expect([5, 6]).not.toContain(weekdayOf(a[0]!.rd));
      if (y >= 5764) expect(weekdayOf(z[0]!.rd), String(y)).not.toBe(0);
    }
    // before the state there is no such day: a picture from 1930 is not named after it
    expect(holidayTable(5690).some((r) => ['yom-haatzmaut', 'yom-hazikaron', 'yom-hashoah', 'jerusalem-day'].includes(r.holiday.id))).toBe(false);
    expect(holidayTable(5708).some((r) => r.holiday.id === 'yom-haatzmaut')).toBe(false); // 5 Iyar 5708 was the declaration itself
    expect(atzmaut(5709)).toEqual(['1949-05-04']);
  });
  it('Yom HaShoah moves off Friday and Sunday; Tisha B\'Av moves off Shabbat', () => {
    for (let y = 5711; y <= 5861; y++) {
      const s = holidayTable(y).filter((r) => r.holiday.id === 'yom-hashoah');
      expect(s.length, String(y)).toBe(1);
      expect([0, 5, 6]).not.toContain(weekdayOf(s[0]!.rd));
      const nisan27 = rdFromHebrew({ y, m: 'nisan', d: 27 });
      expect(Math.abs(s[0]!.rd - nisan27)).toBeLessThanOrEqual(1);
      const t = holidayTable(y).filter((r) => r.holiday.id === 'tisha-bav');
      expect(t.length, String(y)).toBe(1);
      expect(weekdayOf(t[0]!.rd)).not.toBe(6);
      const av9 = rdFromHebrew({ y, m: 'av', d: 9 });
      expect(t[0]!.rd).toBe(weekdayOf(av9) === 6 ? av9 + 1 : av9);
    }
    expect(hebrewFromRd(rd('2022-08-07'))).toEqual({ y: 5782, m: 'av', d: 10 }); // postponed
  });
  it('Hanukkah: eight days from 25 Kislev across a 29-day and a 30-day Kislev, with a candle for the evening and a day for the daytime', () => {
    expect(hanukkahDay(rd('2023-12-15'))).toBe(8);
    expect(hebrewFromRd(rd('2023-12-15'))).toEqual({ y: 5784, m: 'tevet', d: 3 }); // Kislev 5784 had 29 days
    expect(hanukkahDay(rd('2025-01-02'))).toBe(8);
    expect(hebrewFromRd(rd('2025-01-02'))).toEqual({ y: 5785, m: 'tevet', d: 2 }); // Kislev 5785 had 30 days
    expect(hanukkahDay(rd('2024-12-25'))).toBeNull();
    expect(hanukkahDay(rd('2025-01-03'))).toBeNull();
    expect(hanukkahDay(rd('2024-07-01'))).toBeNull();
    expect(Array.from({ length: 8 }, (_, i) => hanukkahDay(rd('2024-12-26') + i))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // the evening of 25 December 2024 begins 25 Kislev: first candle; its daytime is the first day
    expect(holidaysOn(rd('2024-12-26'), 'night')).toEqual([{ id: 'hanukkah-candle-1', family: 'hanukkah', he: 'חנוכה — נר ראשון', en: 'Hanukkah, candle 1' }]);
    expect(holidaysOn(rd('2024-12-26'), 'day')).toEqual([{ id: 'hanukkah-day-1', family: 'hanukkah', he: 'חנוכה — היום הראשון', en: 'Hanukkah, day 1' }]);
    expect(holidaysOn(rd('2024-12-28'), 'night')[0]!.he).toBe('חנוכה — נר שלישי');
    expect(holidaysOn(rd('2024-12-28'), 'day')[0]!.he).toBe('חנוכה — היום השלישי');
    // the daytime of 24 Kislev is the eve; the evening before it is an ordinary evening
    expect(idsOn('2024-12-25')).toEqual(['erev-hanukkah']);
    expect(idsOn('2024-12-25', 'night')).toEqual([]);
    expect(idsOn('2025-01-03', 'night')).toEqual([]); // after the eighth day
  });
  it('day and night names differ where they should: Seder night, the eves, and nothing on an ordinary day', () => {
    expect(holidaysOn(rd('2024-04-23'), 'night').map((h) => h.he)).toEqual(['ליל הסדר']);
    expect(holidaysOn(rd('2024-04-23'), 'day').map((h) => h.he)).toEqual(['פסח']);
    expect(holidaysOn(rd('2024-04-22'), 'day').map((h) => h.he)).toEqual(['ערב פסח']);
    expect(idsOn('2024-04-22', 'night')).toEqual([]);
    expect(idsOn('2024-04-24')).toEqual(['chol-hamoed-pesach']);
    expect(idsOn('2024-04-29')).toEqual(['pesach-7']);
    expect(idsOn('2024-04-30')).toEqual(['mimouna']);
    expect(idsOn('2024-10-02')).toEqual(['erev-rosh-hashana']);
    expect(idsOn('2024-10-03', 'night')).toEqual(['rosh-hashana']);
    expect(idsOn('2024-10-04')).toEqual(['rosh-hashana-2']);
    expect(idsOn('2024-10-11')).toEqual(['erev-yom-kippur']);
    expect(idsOn('2024-10-16')).toEqual(['erev-sukkot']);
    expect(idsOn('2024-10-18')).toEqual(['chol-hamoed-sukkot']);
    expect(idsOn('2024-10-23')).toEqual(['hoshana-rabba']);
    expect(idsOn('2024-10-24')).toEqual(['simchat-torah']);
    expect(idsOn('2024-06-11')).toEqual(['erev-shavuot']);
    expect(idsOn('2024-07-10')).toEqual([]);
    expect(idsOn('2024-07-10', 'night')).toEqual([]);
    // Purim is in Adar II of a leap year; 14 Adar I is an ordinary day here
    expect(idsOn(iso(rdFromHebrew({ y: 5784, m: 'adar1', d: 14 })))).toEqual([]);
    expect(idsOn('2024-03-25')).toEqual(['shushan-purim']);
  });
  it('the table of a year is in date order, every row belongs to a named family, and it agrees with holidaysOn', () => {
    for (const y of [5784, 5785, 5786, 5787]) {
      const table = holidayTable(y);
      expect(table.length).toBeGreaterThan(50);
      for (let i = 1; i < table.length; i++) expect(table[i]!.rd).toBeGreaterThanOrEqual(table[i - 1]!.rd);
      for (const row of table) {
        expect(HOLIDAY_FAMILIES[row.holiday.family], row.holiday.id).toBeDefined();
        expect(row.holiday.he).toMatch(/[֐-׿]/);
        expect(row.holiday.en).toMatch(/^[A-Za-z0-9 ,']+$/);
        expect(hebrewFromRd(row.rd).y).toBe(y);
        for (const part of ['day', 'night'] as const) expect(holidaysOn(row.rd, part).some((h) => h.id === row.holiday.id), `${row.holiday.id} ${part}`).toBe(row.part === 'both' || row.part === part);
      }
      expect(new Set(table.filter((r) => r.holiday.family === 'hanukkah').map((r) => r.holiday.id)).size).toBe(17); // the eve, eight candles, eight days
    }
  });
});

describe('the life-line sources never read the clock or the locale', () => {
  it('no Intl, no Date, and no new package in hebrewCalendar.ts, capture.ts, events.ts, fields.ts and lifeOps.ts', () => {
    for (const file of ['hebrewCalendar.ts', 'capture.ts', 'events.ts', 'fields.ts', 'lifeOps.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      // comments may name what is forbidden; the code may not use it
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
      expect(code, file).not.toMatch(/new Date\b/);
      expect(code, file).not.toMatch(/\bDate\.(now|UTC|parse)\b/);
      expect(code, file).not.toMatch(/\bIntl\./);
      expect(code, file).not.toMatch(/\bMath\.random\b/);
      const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
      for (const from of imports) expect(from.startsWith('./') || from === 'zod' || from === '@pulseframe/time', `${file} imports ${from}`).toBe(true);
    }
  });
});
