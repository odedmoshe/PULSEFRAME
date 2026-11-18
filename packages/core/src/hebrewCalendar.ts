/**
 * The Hebrew calendar in our own integer arithmetic (life line, ADR-0021): day numbers, both conversions, Hebrew-letter
 * numerals and the holiday table on the ISRAELI schedule, with separate names for the day and for the evening that begins it.
 * No dependency (@hebcal/core is GPL-2.0 and is not used) and no Intl or Date at run time: Intl is a test oracle only.
 *
 * The signatures, types and month-name tables are the lead's contract; the bodies are W1's (wave 5). Everything here is
 * a pure function of its arguments in integers: no cache, no clock, no locale.
 *
 * How it works (plan §4.2, with the verifier's corrections, which win):
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

const floorDiv = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, b: number): number => ((a % b) + b) % b;
const isGregorianLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const GREGORIAN_MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
const daysInGregorianMonth = (y: number, m: number): number => (m === 2 && isGregorianLeap(y) ? 29 : GREGORIAN_MONTH_DAYS[m - 1]!);

/** True when the day exists (no 30 February; any year). */
export function isValidGregorian(g: GDate): boolean {
  return Number.isInteger(g.y) && Number.isInteger(g.m) && Number.isInteger(g.d) && g.m >= 1 && g.m <= 12 && g.d >= 1 && g.d <= daysInGregorianMonth(g.y, g.m);
}
/** Day number, 1 = 0001-01-01 (proleptic Gregorian). Integers only. */
export function rdFromGregorian(g: GDate): number {
  const y = g.y - 1;
  return 365 * y + floorDiv(y, 4) - floorDiv(y, 100) + floorDiv(y, 400) + floorDiv(367 * g.m - 362, 12) + (g.m <= 2 ? 0 : isGregorianLeap(g.y) ? -1 : -2) + g.d;
}
export function gregorianFromRd(rd: number): GDate {
  // the year: whole 400-, 100-, 4- and 1-year cycles before the day
  const d0 = rd - 1, n400 = floorDiv(d0, 146097), d1 = mod(d0, 146097), n100 = floorDiv(d1, 36524), d2 = mod(d1, 36524), n4 = floorDiv(d2, 1461), d3 = mod(d2, 1461), n1 = floorDiv(d3, 365);
  const y = 400 * n400 + 100 * n100 + 4 * n4 + n1 + (n100 === 4 || n1 === 4 ? 0 : 1);
  let rest = rd - rdFromGregorian({ y, m: 1, d: 1 }), m = 1;
  while (rest >= daysInGregorianMonth(y, m)) { rest -= daysInGregorianMonth(y, m); m++; }
  return { y, m, d: rest + 1 };
}
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(rd: number): 0 | 1 | 2 | 3 | 4 | 5 | 6 { return mod(rd, 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6; }

// ---------- the Hebrew year ----------
/** The day before 1 Tishrei of year 1 (the Dershowitz–Reingold epoch), as a day number. */
const HEBREW_EPOCH = -1373427;
export function isHebrewLeapYear(y: number): boolean { return mod(7 * y + 1, 19) < 7; }
/** Days from the epoch to the molad-based start of year `y`, before the two postponements that depend on the neighbouring years. */
function elapsedDays(y: number): number {
  const months = floorDiv(235 * y - 234, 19);
  const parts = 12084 + 13753 * months;
  const day = 29 * months + floorDiv(parts, 25920);
  return mod(3 * (day + 1), 7) < 3 ? day + 1 : day;
}
/** The postponement that keeps a year from having 356 or 382 days. */
function newYearDelay(y: number): number {
  const here = elapsedDays(y);
  if (elapsedDays(y + 1) - here === 356) return 2;
  return here - elapsedDays(y - 1) === 382 ? 1 : 0;
}
/** Day number of 1 Tishrei of Hebrew year `y`. */
export function hebrewNewYearRd(y: number): number { return HEBREW_EPOCH + elapsedDays(y) + newYearDelay(y); }
export function daysInHebrewYear(y: number): 353 | 354 | 355 | 383 | 384 | 385 { return (hebrewNewYearRd(y + 1) - hebrewNewYearRd(y)) as 353 | 354 | 355 | 383 | 384 | 385; }
/** The months of a year from Tishrei on, with their lengths. */
function monthsOfYear(y: number): { m: HebrewMonth; days: number }[] {
  const length = daysInHebrewYear(y);
  const adar: { m: HebrewMonth; days: number }[] = isHebrewLeapYear(y) ? [{ m: 'adar1', days: 30 }, { m: 'adar2', days: 29 }] : [{ m: 'adar', days: 29 }];
  return [
    { m: 'tishrei', days: 30 }, { m: 'cheshvan', days: length % 10 === 5 ? 30 : 29 }, { m: 'kislev', days: length % 10 === 3 ? 29 : 30 }, { m: 'tevet', days: 29 }, { m: 'shevat', days: 30 },
    ...adar, { m: 'nisan', days: 30 }, { m: 'iyar', days: 29 }, { m: 'sivan', days: 30 }, { m: 'tammuz', days: 29 }, { m: 'av', days: 30 }, { m: 'elul', days: 29 },
  ];
}
/** The Hebrew day whose DAYTIME falls on the Gregorian day `rd`. */
export function hebrewFromRd(rd: number): HDate {
  // a first guess from the mean year length, then stepped to the year that holds the day
  let y = floorDiv((rd - HEBREW_EPOCH) * 4, 1461) + 1;
  while (hebrewNewYearRd(y) > rd) y--;
  while (hebrewNewYearRd(y + 1) <= rd) y++;
  let rest = rd - hebrewNewYearRd(y);
  for (const month of monthsOfYear(y)) {
    if (rest < month.days) return { y, m: month.m, d: rest + 1 };
    rest -= month.days;
  }
  throw new RangeError(`no Hebrew date for day number ${rd}`); // cannot happen: the months of a year add up to its length
}
/** RangeError for a date that does not exist (30 Cheshvan in a short year, adar1 in a common year). */
export function rdFromHebrew(h: HDate): number {
  if (!Number.isInteger(h.y) || !Number.isInteger(h.d)) throw new RangeError('a Hebrew date has a whole year and day');
  let rd = hebrewNewYearRd(h.y);
  for (const month of monthsOfYear(h.y)) {
    if (month.m === h.m) {
      if (h.d < 1 || h.d > month.days) throw new RangeError(`${h.m} ${h.y} has ${month.days} days, so there is no day ${h.d}`);
      return rd + h.d - 1;
    }
    rd += month.days;
  }
  throw new RangeError(`the Hebrew year ${h.y} has no month ${h.m}`);
}

// ---------- numerals and wording ----------
const GERESH = '׳', GERSHAYIM = '״';
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'] as const;
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'] as const;
const UNITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'] as const;
/** The letters of 1..999, without punctuation. */
function letters(n: number): string {
  const tensAndUnits = n % 100;
  return HUNDREDS[floorDiv(n, 100)]! + (tensAndUnits === 15 ? 'טו' : tensAndUnits === 16 ? 'טז' : TENS[floorDiv(tensAndUnits, 10)]! + UNITS[tensAndUnits % 10]!);
}
/** The form a letter takes at the end of a word. */
const FINAL_FORM: Readonly<Record<string, string>> = { 'כ': 'ך', 'מ': 'ם', 'נ': 'ן', 'פ': 'ף', 'צ': 'ץ' };
/**
 * One letter takes a geresh; more take gershayim before the last, and a last letter that has a final form is written in it,
 * as years are in print (תש״ך, תש״ם, תש״ן, תש״ף, תר״ץ). A single letter never is (20 = כ׳), so no day of a month is affected.
 * (ICU writes only ף that way; the test compares with ICU apart from this, and holds these forms in its hand table.)
 */
const punctuated = (s: string): string => (s.length === 1 ? s + GERESH : s.slice(0, -1) + GERSHAYIM + (FINAL_FORM[s.slice(-1)] ?? s.slice(-1)));
/**
 * Numbers whose letters in order would spell an unlucky word are written in another order, as they are in print and as ICU
 * writes them: 298 and 698 (…רצח) as …רח״צ, 344 and 744 (…שמד) as …שד״מ, 304 (שד) as ד״ש. Such a numeral keeps its ordinary
 * last letter (תשד״מ, the year 1983–84).
 */
function reordered(s: string): string | null {
  if (s === 'שד') return 'דש';
  if (s.endsWith('רצח')) return `${s.slice(0, -3)}רחצ`;
  if (s.endsWith('שמד')) return `${s.slice(0, -3)}שדמ`;
  return null;
}
/** The letters of 1..999 with their marks. */
function numeral(n: number): string {
  const plain = letters(n), other = reordered(plain);
  return other ? other.slice(0, -1) + GERSHAYIM + other.slice(-1) : punctuated(plain);
}
/**
 * 1..9999 in Hebrew letters with geresh (U+05F3) after a single letter and gershayim (U+05F4) before the last; thousands dropped
 * from 1000 up; 15 = ט״ו, 16 = ט״ז. A whole number of thousands, which has no letters left once they are dropped, is written
 * as its thousands and the word אלפים (5000 = ה׳ אלפים). RangeError outside 1..9999.
 */
export function hebrewNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new RangeError(`no Hebrew numeral for ${n}`);
  const rest = n % 1000;
  if (rest === 0) return n === 1000 ? 'אלף' : n === 2000 ? 'אלפיים' : `${numeral(n / 1000)} אלפים`;
  return numeral(rest);
}
/** «כ״ה בכסלו תשפ״ה»; `year: false` → «כ״ה בכסלו». */
export function formatHebrewDate(h: HDate, opts?: { year?: boolean }): string {
  const day = `${hebrewNumeral(h.d)} ב${HEBREW_MONTH_NAMES[h.m].he}`;
  return opts?.year === false ? day : `${day} ${hebrewNumeral(h.y)}`;
}

// ---------- holidays (Israeli schedule) ----------
/**
 * The name of a holiday as a whole, by `Holiday.family`: what an event is called when its files fall on different days of
 * one holiday (events.ts eventDisplayName). To be reviewed by the owner with the rows below.
 */
export const HOLIDAY_FAMILIES: Readonly<Record<string, { he: string; en: string }>> = {
  'rosh-hashana': { he: 'ראש השנה', en: 'Rosh Hashana' }, 'yom-kippur': { he: 'יום כיפור', en: 'Yom Kippur' }, sukkot: { he: 'סוכות', en: 'Sukkot' },
  'simchat-torah': { he: 'שמחת תורה', en: 'Simchat Torah' }, hanukkah: { he: 'חנוכה', en: 'Hanukkah' }, 'tu-bishvat': { he: 'ט״ו בשבט', en: 'Tu BiShvat' },
  'family-day': { he: 'יום המשפחה', en: 'Family Day' }, purim: { he: 'פורים', en: 'Purim' }, pesach: { he: 'פסח', en: 'Pesach' }, mimouna: { he: 'מימונה', en: 'Mimouna' },
  'yom-hashoah': { he: 'יום השואה', en: 'Yom HaShoah' }, 'yom-hazikaron': { he: 'יום הזיכרון', en: 'Yom HaZikaron' }, 'yom-haatzmaut': { he: 'יום העצמאות', en: 'Yom HaAtzmaut' },
  'lag-baomer': { he: 'ל״ג בעומר', en: 'Lag BaOmer' }, 'jerusalem-day': { he: 'יום ירושלים', en: 'Jerusalem Day' }, shavuot: { he: 'שבועות', en: 'Shavuot' },
  'tisha-bav': { he: 'תשעה באב', en: "Tisha B'Av" }, 'tu-bav': { he: 'ט״ו באב', en: "Tu B'Av" },
};
/** Masculine ordinals 1..8 (נר ראשון, היום הראשון). */
const ORDINALS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שביעי', 'שמיני'] as const;
/** A row whose name is the family's own. */
const whole = (family: string): Holiday => ({ id: family, family, he: HOLIDAY_FAMILIES[family]!.he, en: HOLIDAY_FAMILIES[family]!.en });
const named = (id: string, family: string, he: string, en: string): Holiday => ({ id, family, he, en });
/**
 * The state's days are counted from the year they were first kept (5 Iyar 5708 itself, 14 May 1948, was the declaration, not a
 * holiday; 28 Iyar 5727 was the day itself): a picture from before them is not named after them.
 */
const FIRST_YEAR = { atzmaut: 5709, zikaron: 5711, shoah: 5711, jerusalem: 5728 } as const;
/** From this Hebrew year, 5 Iyar on a Monday moves Yom HaAtzmaut to Tuesday (so that Yom HaZikaron does not begin as Shabbat ends). */
const MONDAY_RULE_FROM = 5764;
/** The day Yom HaAtzmaut is kept, given the day number of 5 Iyar: Friday → Thursday, Saturday → Thursday, Monday → Tuesday (from 5764). */
function atzmautRd(fifthOfIyar: number, y: number): number {
  const w = weekdayOf(fifthOfIyar);
  return w === 5 ? fifthOfIyar - 1 : w === 6 ? fifthOfIyar - 2 : w === 1 && y >= MONDAY_RULE_FROM ? fifthOfIyar + 1 : fifthOfIyar;
}
/** The day Yom HaShoah is kept, given the day number of 27 Nisan: Friday → Thursday, Sunday → Monday. */
function shoahRd(nisan27: number): number { const w = weekdayOf(nisan27); return w === 5 ? nisan27 - 1 : w === 0 ? nisan27 + 1 : nisan27; }
/** 1..8 on Hanukkah (by the daytime of `rd`), else null. */
export function hanukkahDay(rd: number): number | null {
  const h = hebrewFromRd(rd);
  if (h.m !== 'kislev' && h.m !== 'tevet') return null;
  const n = rd - rdFromHebrew({ y: h.y, m: 'kislev', d: 25 }) + 1;
  return n >= 1 && n <= 8 ? n : null;
}
/** The rows of one Hebrew day, for both parts: `part` 'both' = the name holds for the evening that begins the day and for its daytime. */
function rowsOf(rd: number): { part: DayPart | 'both'; holiday: Holiday }[] {
  const h = hebrewFromRd(rd), { y, m, d } = h;
  const rows: { part: DayPart | 'both'; holiday: Holiday }[] = [];
  const both = (holiday: Holiday) => rows.push({ part: 'both', holiday });
  const day = (holiday: Holiday) => rows.push({ part: 'day', holiday });
  const night = (holiday: Holiday) => rows.push({ part: 'night', holiday });
  if (m === 'elul' && d === 29) day(named('erev-rosh-hashana', 'rosh-hashana', 'ערב ראש השנה', 'Erev Rosh Hashana'));
  else if (m === 'tishrei') {
    if (d === 1) both(whole('rosh-hashana'));
    else if (d === 2) both(named('rosh-hashana-2', 'rosh-hashana', 'ראש השנה — היום השני', 'Rosh Hashana, day 2'));
    else if (d === 9) day(named('erev-yom-kippur', 'yom-kippur', 'ערב יום כיפור', 'Erev Yom Kippur'));
    else if (d === 10) both(whole('yom-kippur'));
    else if (d === 14) day(named('erev-sukkot', 'sukkot', 'ערב סוכות', 'Erev Sukkot'));
    else if (d === 15) both(whole('sukkot'));
    else if (d >= 16 && d <= 20) both(named('chol-hamoed-sukkot', 'sukkot', 'חול המועד סוכות', 'Chol HaMoed Sukkot'));
    else if (d === 21) both(named('hoshana-rabba', 'sukkot', 'הושענא רבה', 'Hoshana Rabba'));
    else if (d === 22) both(whole('simchat-torah'));
  } else if (m === 'kislev' || m === 'tevet') {
    const n = hanukkahDay(rd);
    if (n !== null) {
      night(named(`hanukkah-candle-${n}`, 'hanukkah', `חנוכה — נר ${ORDINALS_HE[n - 1]}`, `Hanukkah, candle ${n}`));
      day(named(`hanukkah-day-${n}`, 'hanukkah', `חנוכה — היום ה${ORDINALS_HE[n - 1]}`, `Hanukkah, day ${n}`));
    } else if (m === 'kislev' && d === 24) day(named('erev-hanukkah', 'hanukkah', 'ערב חנוכה', 'Erev Hanukkah'));
  } else if (m === 'shevat') {
    if (d === 15) both(whole('tu-bishvat'));
    else if (d === 30) both(whole('family-day'));
  } else if (m === 'adar' || m === 'adar2') {
    if (d === 14) both(whole('purim'));
    else if (d === 15) both(named('shushan-purim', 'purim', 'שושן פורים', 'Shushan Purim'));
  } else if (m === 'nisan') {
    if (d === 14) day(named('erev-pesach', 'pesach', 'ערב פסח', 'Erev Pesach'));
    else if (d === 15) { night(named('seder', 'pesach', 'ליל הסדר', 'Seder night')); day(whole('pesach')); }
    else if (d >= 16 && d <= 20) both(named('chol-hamoed-pesach', 'pesach', 'חול המועד פסח', 'Chol HaMoed Pesach'));
    else if (d === 21) both(named('pesach-7', 'pesach', 'שביעי של פסח', 'Seventh day of Pesach'));
    else if (d === 22) both(whole('mimouna'));
    if (y >= FIRST_YEAR.shoah && d >= 26 && d <= 28 && rd === shoahRd(rd + 27 - d)) both(whole('yom-hashoah'));
  } else if (m === 'iyar') {
    if (d >= 2 && d <= 6) {
      const atzmaut = atzmautRd(rd + 5 - d, y);
      if (y >= FIRST_YEAR.atzmaut && rd === atzmaut) both(whole('yom-haatzmaut'));
      if (y >= FIRST_YEAR.zikaron && rd === atzmaut - 1) both(whole('yom-hazikaron'));
    }
    if (d === 18) both(whole('lag-baomer'));
    else if (d === 28 && y >= FIRST_YEAR.jerusalem) both(whole('jerusalem-day'));
  } else if (m === 'sivan') {
    if (d === 5) day(named('erev-shavuot', 'shavuot', 'ערב שבועות', 'Erev Shavuot'));
    else if (d === 6) both(whole('shavuot'));
  } else if (m === 'av') {
    // 9 Av on Shabbat is kept on Sunday, 10 Av
    if ((d === 9 && weekdayOf(rd) !== 6) || (d === 10 && weekdayOf(rd) === 0)) both(whole('tisha-bav'));
    else if (d === 15) both(whole('tu-bav'));
  }
  return rows;
}
/**
 * The holidays of a Hebrew day on the Israeli schedule, most specific first; [] on an ordinary day. `rd` is the Gregorian
 * day whose DAYTIME is the Hebrew day; part 'night' = the evening and night that begin it (15 Nisan night = «ליל הסדר»,
 * Hanukkah night n = «חנוכה — נר שלישי», Hanukkah day n = «חנוכה — היום השלישי»).
 */
export function holidaysOn(rd: number, part: DayPart): Holiday[] {
  return rowsOf(rd).filter((r) => r.part === part || r.part === 'both').map((r) => r.holiday);
}
/** Every row of the table for a Hebrew year, in date order (for the owner's review and the proof's evidence). */
export function holidayTable(hebrewYear: number): { rd: number; part: DayPart | 'both'; holiday: Holiday }[] {
  const out: { rd: number; part: DayPart | 'both'; holiday: Holiday }[] = [];
  const end = hebrewNewYearRd(hebrewYear + 1);
  for (let rd = hebrewNewYearRd(hebrewYear); rd < end; rd++) for (const row of rowsOf(rd)) out.push({ rd, part: row.part, holiday: row.holiday });
  return out;
}
