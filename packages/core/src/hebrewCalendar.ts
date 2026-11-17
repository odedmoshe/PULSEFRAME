/**
 * The Hebrew calendar in our own integer arithmetic (life line, ADR-0021): day numbers, both conversions, Hebrew-letter
 * numerals and the holiday table on the ISRAELI schedule, with separate names for the day and for the evening that begins it.
 * No dependency (@hebcal/core is GPL-2.0 and is not used) and no Intl or Date at run time: Intl is a test oracle only.
 *
 * CONTRACT FILE (lead pre-pass). The signatures, types and month-name tables below are fixed; the bodies are W1's.
 * Until then every function throws "not built" — none of them returns a made-up date.
 *
 * Notes for the bodies (plan §4.2, with the verifier's corrections, which win):
 * - Day number R.D.: 1 = 0001-01-01 (proleptic Gregorian).
 * - Hebrew year start: hebrewNewYearRd(y) = −1373427 + elapsed(y) + delay(y) (the Dershowitz–Reingold epoch; the plan's
 *   −1373428 is one day off everywhere). Anchor: hebrewNewYearRd(5785) = rdFromGregorian({ y: 2024, m: 10, d: 3 }).
 * - Yom HaZikaron / Yom HaAtzmaut: 5 Iyar on a Monday moves to Tuesday only from the Hebrew year 5764 (5 Iyar 5757 was
 *   Monday 12 May 1997 and was kept).
 * - The holiday names and the schedule are reviewed by the owner before the calendar is called right (wave-5 decisions).
 * - Test oracles (tests only, never at run time): Intl 'en-u-ca-hebrew' parts for year, month and day over every day of
 *   1900–2100 (ICU's month names: Tishri, Heshvan, Kislev, Tevet, Shevat, Adar, Adar I, Adar II, Nisan, Iyar, Sivan, Tamuz,
 *   Av, Elul); Intl 'he-u-ca-hebrew' with dateStyle 'long' and formatToParts gives the Hebrew-letter day and year (U+05F3 /
 *   U+05F4) to compare hebrewNumeral with, beside a hand table (ICU versions differ). Month names stay our own table.
 * - The published dates (hebrewCalendar.published.ts): when no published calendar can be reached from the build machine, its
 *   header says "not confirmed against a published source; arithmetic and ICU only". Never an invented URL.
 * - A test greps this file (and capture.ts, events.ts, fields.ts, lifeOps.ts) for `new Date`, `Date.now|UTC|parse` and
 *   `Intl.`: none may appear (words such as hebrewDate are not matches).
 */
const notBuilt = (what: string): never => { throw new Error(`life line: ${what} is not built yet (hebrewCalendar.ts, W1)`); };

/** A Gregorian day; m is 1..12. */
export interface GDate { y: number; m: number; d: number }
export type HebrewMonth = 'tishrei' | 'cheshvan' | 'kislev' | 'tevet' | 'shevat' | 'adar' | 'adar1' | 'adar2' | 'nisan' | 'iyar' | 'sivan' | 'tammuz' | 'av' | 'elul';
/** A Hebrew day. `adar` exists in common years only; `adar1` and `adar2` in leap years only. */
export interface HDate { y: number; m: HebrewMonth; d: number }
/** The part of a Hebrew day: its daytime, or the evening and night that begin it. */
export type DayPart = 'day' | 'night';
/** One row of the holiday table. `family` groups the days of one holiday (all eight days of Hanukkah share it). */
export interface Holiday { id: string; family: string; he: string; en: string }

/** Month names as this product writes them (our own table: ICU's spellings differ between versions). To be reviewed by the owner with the holiday names. */
export const HEBREW_MONTH_NAMES: Readonly<Record<HebrewMonth, { he: string; en: string }>> = {
  tishrei: { he: 'תשרי', en: 'Tishrei' }, cheshvan: { he: 'חשוון', en: 'Cheshvan' }, kislev: { he: 'כסלו', en: 'Kislev' }, tevet: { he: 'טבת', en: 'Tevet' },
  shevat: { he: 'שבט', en: 'Shevat' }, adar: { he: 'אדר', en: 'Adar' }, adar1: { he: 'אדר א׳', en: 'Adar I' }, adar2: { he: 'אדר ב׳', en: 'Adar II' },
  nisan: { he: 'ניסן', en: 'Nisan' }, iyar: { he: 'אייר', en: 'Iyar' }, sivan: { he: 'סיוון', en: 'Sivan' }, tammuz: { he: 'תמוז', en: 'Tammuz' }, av: { he: 'אב', en: 'Av' }, elul: { he: 'אלול', en: 'Elul' },
};
/** Index 0 = January. */
export const GREGORIAN_MONTH_NAMES: readonly { he: string; en: string }[] = [
  { he: 'ינואר', en: 'January' }, { he: 'פברואר', en: 'February' }, { he: 'מרץ', en: 'March' }, { he: 'אפריל', en: 'April' }, { he: 'מאי', en: 'May' }, { he: 'יוני', en: 'June' },
  { he: 'יולי', en: 'July' }, { he: 'אוגוסט', en: 'August' }, { he: 'ספטמבר', en: 'September' }, { he: 'אוקטובר', en: 'October' }, { he: 'נובמבר', en: 'November' }, { he: 'דצמבר', en: 'December' },
];

/** True when the day exists (no 30 February; any year). */
export function isValidGregorian(_g: GDate): boolean { return notBuilt('isValidGregorian'); }
/** Day number, 1 = 0001-01-01 (proleptic Gregorian). Integers only. */
export function rdFromGregorian(_g: GDate): number { return notBuilt('rdFromGregorian'); }
export function gregorianFromRd(_rd: number): GDate { return notBuilt('gregorianFromRd'); }
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(_rd: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 { return notBuilt('weekdayOf'); }
export function isHebrewLeapYear(_y: number): boolean { return notBuilt('isHebrewLeapYear'); }
/** Day number of 1 Tishrei of Hebrew year `y`. */
export function hebrewNewYearRd(_y: number): number { return notBuilt('hebrewNewYearRd'); }
export function daysInHebrewYear(_y: number): 353 | 354 | 355 | 383 | 384 | 385 { return notBuilt('daysInHebrewYear'); }
/** The Hebrew day whose DAYTIME falls on the Gregorian day `rd`. */
export function hebrewFromRd(_rd: number): HDate { return notBuilt('hebrewFromRd'); }
/** RangeError for a date that does not exist (30 Cheshvan in a short year, adar1 in a common year). */
export function rdFromHebrew(_h: HDate): number { return notBuilt('rdFromHebrew'); }
/** 1..9999 in Hebrew letters with geresh (U+05F3) after a single letter and gershayim (U+05F4) before the last; thousands dropped from 1000 up; 15 = ט״ו, 16 = ט״ז. */
export function hebrewNumeral(_n: number): string { return notBuilt('hebrewNumeral'); }
/** «כ״ה בכסלו תשפ״ה»; `year: false` → «כ״ה בכסלו». */
export function formatHebrewDate(_h: HDate, _opts?: { year?: boolean }): string { return notBuilt('formatHebrewDate'); }
/**
 * The holidays of a Hebrew day on the Israeli schedule, most specific first; [] on an ordinary day. `rd` is the Gregorian
 * day whose DAYTIME is the Hebrew day; part 'night' = the evening and night that begin it (15 Nisan night = «ליל הסדר»,
 * Hanukkah night n = «חנוכה — נר שלישי», Hanukkah day n = «חנוכה — היום השלישי»).
 */
export function holidaysOn(_rd: number, _part: DayPart): Holiday[] { return notBuilt('holidaysOn'); }
/** 1..8 on Hanukkah (by the daytime of `rd`), else null. */
export function hanukkahDay(_rd: number): number | null { return notBuilt('hanukkahDay'); }
/** Every row of the table for a Hebrew year, in date order (for the owner's review and the proof's evidence). */
export function holidayTable(_hebrewYear: number): { rd: number; part: DayPart | 'both'; holiday: Holiday }[] { return notBuilt('holidayTable'); }
