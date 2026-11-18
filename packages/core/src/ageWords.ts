/**
 * The wording of an age (ADR-0021, people section): what `{age:<id>}` shows, from a birth date and the capture day of the
 * picture under the title. Pure, integers only: no Intl, no Date.
 *
 * The lead's contract fixes the signatures and the WORDING TABLE below (AGE_FORMS), which is data for the owner's review:
 * every Hebrew form, for «בן», «בת» and no word choice, in digits and in words, with the English form. The three functions
 * are W1's (built: fields.ts documentPeople calls them when a frame is evaluated).
 *
 * RULES
 * - The age is the calendar difference of two wall days (schema.ts WALL_DATE). The n-th month of a life is full on the day
 *   of the month the person was born on; when that month has no such day (the 31st, or 29 February in a common year) it is
 *   full on the 1st of the following month. So a person born on 29 February has a birthday on 1 March in common years.
 *   `days` counts from the last full month; `totalDays` is the whole difference in days. Before the birth date: null.
 * - Hebrew, first row that fits:
 *     0 days                         «בן יומו» · «בת יומה» · «יום הלידה»
 *     1 day, 2 days                  «בן יום», «בן יומיים»
 *     3–6 days                       «בן N ימים»
 *     from 7 days, first month not full   whole weeks: «בן שבוע», «בן שבועיים», «בן 3 שבועות», «בן 4 שבועות»
 *     1–11 months                    «בן חודש», «בן חודשיים», «בן N חודשים»
 *     1 year, 2 years                «בן שנה», «בן שנתיים»
 *     3 years and more               «בן N»; style 'words' writes 3–10 as a word («בן שלוש» … «בן עשר»), above ten digits
 *     «וחצי» is added from six full months, from the first birthday until the sixth («בן שנה וחצי», «בן 3 וחצי»).
 *   The word before the age is «בן» for form 'm', «בת» for 'f', «גיל» when no form is set. The years are counted in the
 *   feminine («שלוש», not «שלושה») for all three, because they count «שנים». Style 'words' changes years only: days, weeks
 *   and months keep their digits.
 * - English: "born today", "1 day old", "N days old", "1 week old", "N weeks old", "1 month old", "N months old",
 *   "1 year old", "N years old", and "N½ years old" where Hebrew says «וחצי».
 */
import { isValidGregorian, rdFromGregorian, type GDate } from './hebrewCalendar.ts';

export interface AgeParts { years: number; months: number; days: number; totalDays: number }
export type AgeForm = 'm' | 'f' | undefined;
export type AgeStyle = 'digits' | 'words';

/** A wall day (YYYY-MM-DD, the first ten characters of a WALL_DATE or WALL_DATE_TIME) as a Gregorian day that exists; RangeError otherwise. */
function wallDay(s: string): GDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const g: GDate | null = m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  if (!g || !isValidGregorian(g)) throw new RangeError(`not a calendar day: ${JSON.stringify(s.slice(0, 32))}`);
  return g;
}
/** The day the n-th month of a life born on `b` is full: the same day of the month, or the 1st of the next month when that month has no such day. */
function monthFull(b: GDate, n: number): number {
  const index = b.m - 1 + n, y = b.y + Math.floor(index / 12), m = (index % 12) + 1;
  return isValidGregorian({ y, m, d: b.d }) ? rdFromGregorian({ y, m, d: b.d }) : rdFromGregorian({ y: m === 12 ? y + 1 : y, m: m === 12 ? 1 : m + 1, d: 1 });
}
/**
 * The age on wall day `at` of someone born on wall day `birth` (both YYYY-MM-DD, real days; a time after the day is ignored);
 * null when `at` is before `birth`. RangeError when either is not a calendar day. W1.
 */
export function ageParts(birth: string, at: string): AgeParts | null {
  const b = wallDay(birth), a = wallDay(at);
  const from = rdFromGregorian(b), to = rdFromGregorian(a);
  if (to < from) return null;
  // the months that are full on `at`: at most the months between the two dates, one fewer when the last of them is not full yet
  let n = (a.y - b.y) * 12 + (a.m - b.m);
  while (n > 0 && monthFull(b, n) > to) n--;
  return { years: Math.floor(n / 12), months: n % 12, days: to - monthFull(b, n), totalDays: to - from };
}
const HE_WORD: Readonly<Record<'m' | 'f' | 'none', string>> = { m: 'בן', f: 'בת', none: 'גיל' };
const HE_BIRTH_DAY: Readonly<Record<'m' | 'f' | 'none', string>> = { m: 'בן יומו', f: 'בת יומה', none: 'יום הלידה' };
/** «וחצי»: from six full months, from the first birthday until the sixth. */
const half = (p: AgeParts): boolean => p.years >= 1 && p.years < 6 && p.months >= 6;
/** The Hebrew wording of an age (AGE_FORMS `he`, or `heWords` for style 'words' where a row has it). W1. */
export function ageHe(p: AgeParts, form: AgeForm, style: AgeStyle): string {
  const who = form === 'm' || form === 'f' ? form : 'none';
  if (p.totalDays === 0) return HE_BIRTH_DAY[who];
  let age: string;
  if (p.years === 0 && p.months === 0) {
    const d = p.days, w = Math.floor(d / 7);
    age = d === 1 ? 'יום' : d === 2 ? 'יומיים' : d < 7 ? `${d} ימים` : w === 1 ? 'שבוע' : w === 2 ? 'שבועיים' : `${w} שבועות`;
  } else if (p.years === 0) age = p.months === 1 ? 'חודש' : p.months === 2 ? 'חודשיים' : `${p.months} חודשים`;
  else {
    age = p.years === 1 ? 'שנה' : p.years === 2 ? 'שנתיים' : style === 'words' && Object.hasOwn(AGE_YEAR_WORDS_HE, p.years) ? AGE_YEAR_WORDS_HE[p.years]! : String(p.years);
    if (half(p)) age += ' וחצי';
  }
  return `${HE_WORD[who]} ${age}`;
}
/** The English wording of an age (AGE_FORMS `en`). W1. */
export function ageEn(p: AgeParts): string {
  if (p.totalDays === 0) return 'born today';
  if (p.years === 0 && p.months === 0) {
    const d = p.days, w = Math.floor(d / 7);
    return d < 7 ? (d === 1 ? '1 day old' : `${d} days old`) : w === 1 ? '1 week old' : `${w} weeks old`;
  }
  if (p.years === 0) return p.months === 1 ? '1 month old' : `${p.months} months old`;
  if (half(p)) return `${p.years}½ years old`;
  return p.years === 1 ? '1 year old' : `${p.years} years old`;
}

/** The years that style 'words' writes as a word. */
export const AGE_YEAR_WORDS_HE: Readonly<Record<number, string>> = { 3: 'שלוש', 4: 'ארבע', 5: 'חמש', 6: 'שש', 7: 'שבע', 8: 'שמונה', 9: 'תשע', 10: 'עשר' };
export interface AgeFormRow {
  /** Which rule the row shows. */
  rule: string;
  birth: string; at: string; parts: AgeParts;
  /** Style 'digits', for form 'm', 'f' and none. */
  he: { m: string; f: string; none: string };
  /** Style 'words', where it differs from `he`. */
  heWords?: { m: string; f: string; none: string };
  en: string;
}
/**
 * Every form of the wording, one or two samples per rule, for the owner's review and for W1's test (ageParts(birth, at) is
 * `parts`; ageHe and ageEn of `parts` are the strings). A change of wording is a change of this table first.
 */
export const AGE_FORMS: readonly AgeFormRow[] = [
  { rule: 'the day of birth', birth: '2020-03-10', at: '2020-03-10', parts: { years: 0, months: 0, days: 0, totalDays: 0 }, he: { m: 'בן יומו', f: 'בת יומה', none: 'יום הלידה' }, en: 'born today' },
  { rule: 'one day', birth: '2020-03-10', at: '2020-03-11', parts: { years: 0, months: 0, days: 1, totalDays: 1 }, he: { m: 'בן יום', f: 'בת יום', none: 'גיל יום' }, en: '1 day old' },
  { rule: 'two days', birth: '2020-03-10', at: '2020-03-12', parts: { years: 0, months: 0, days: 2, totalDays: 2 }, he: { m: 'בן יומיים', f: 'בת יומיים', none: 'גיל יומיים' }, en: '2 days old' },
  { rule: '3 to 6 days', birth: '2020-03-10', at: '2020-03-13', parts: { years: 0, months: 0, days: 3, totalDays: 3 }, he: { m: 'בן 3 ימים', f: 'בת 3 ימים', none: 'גיל 3 ימים' }, en: '3 days old' },
  { rule: '3 to 6 days', birth: '2020-03-10', at: '2020-03-16', parts: { years: 0, months: 0, days: 6, totalDays: 6 }, he: { m: 'בן 6 ימים', f: 'בת 6 ימים', none: 'גיל 6 ימים' }, en: '6 days old' },
  { rule: 'one week (7 to 13 days)', birth: '2020-03-10', at: '2020-03-17', parts: { years: 0, months: 0, days: 7, totalDays: 7 }, he: { m: 'בן שבוע', f: 'בת שבוע', none: 'גיל שבוע' }, en: '1 week old' },
  { rule: 'one week (7 to 13 days)', birth: '2020-03-10', at: '2020-03-23', parts: { years: 0, months: 0, days: 13, totalDays: 13 }, he: { m: 'בן שבוע', f: 'בת שבוע', none: 'גיל שבוע' }, en: '1 week old' },
  { rule: 'two weeks (14 to 20 days)', birth: '2020-03-10', at: '2020-03-24', parts: { years: 0, months: 0, days: 14, totalDays: 14 }, he: { m: 'בן שבועיים', f: 'בת שבועיים', none: 'גיל שבועיים' }, en: '2 weeks old' },
  { rule: 'three weeks and more, until the first month is full', birth: '2020-03-10', at: '2020-03-31', parts: { years: 0, months: 0, days: 21, totalDays: 21 }, he: { m: 'בן 3 שבועות', f: 'בת 3 שבועות', none: 'גיל 3 שבועות' }, en: '3 weeks old' },
  { rule: 'three weeks and more, until the first month is full', birth: '2020-03-10', at: '2020-04-09', parts: { years: 0, months: 0, days: 30, totalDays: 30 }, he: { m: 'בן 4 שבועות', f: 'בת 4 שבועות', none: 'גיל 4 שבועות' }, en: '4 weeks old' },
  { rule: 'one month', birth: '2020-03-10', at: '2020-04-10', parts: { years: 0, months: 1, days: 0, totalDays: 31 }, he: { m: 'בן חודש', f: 'בת חודש', none: 'גיל חודש' }, en: '1 month old' },
  { rule: 'two months', birth: '2020-03-10', at: '2020-05-10', parts: { years: 0, months: 2, days: 0, totalDays: 61 }, he: { m: 'בן חודשיים', f: 'בת חודשיים', none: 'גיל חודשיים' }, en: '2 months old' },
  { rule: '3 to 11 months', birth: '2020-03-10', at: '2020-06-10', parts: { years: 0, months: 3, days: 0, totalDays: 92 }, he: { m: 'בן 3 חודשים', f: 'בת 3 חודשים', none: 'גיל 3 חודשים' }, en: '3 months old' },
  { rule: '3 to 11 months', birth: '2020-03-10', at: '2020-09-09', parts: { years: 0, months: 5, days: 30, totalDays: 183 }, he: { m: 'בן 5 חודשים', f: 'בת 5 חודשים', none: 'גיל 5 חודשים' }, en: '5 months old' },
  { rule: '3 to 11 months', birth: '2020-03-10', at: '2021-02-10', parts: { years: 0, months: 11, days: 0, totalDays: 337 }, he: { m: 'בן 11 חודשים', f: 'בת 11 חודשים', none: 'גיל 11 חודשים' }, en: '11 months old' },
  { rule: '3 to 11 months', birth: '2020-03-10', at: '2021-03-09', parts: { years: 0, months: 11, days: 27, totalDays: 364 }, he: { m: 'בן 11 חודשים', f: 'בת 11 חודשים', none: 'גיל 11 חודשים' }, en: '11 months old' },
  { rule: 'one year', birth: '2020-03-10', at: '2021-03-10', parts: { years: 1, months: 0, days: 0, totalDays: 365 }, he: { m: 'בן שנה', f: 'בת שנה', none: 'גיל שנה' }, en: '1 year old' },
  { rule: 'one year', birth: '2020-03-10', at: '2021-09-09', parts: { years: 1, months: 5, days: 30, totalDays: 548 }, he: { m: 'בן שנה', f: 'בת שנה', none: 'גיל שנה' }, en: '1 year old' },
  { rule: 'one year and a half (from 6 months)', birth: '2020-03-10', at: '2021-09-10', parts: { years: 1, months: 6, days: 0, totalDays: 549 }, he: { m: 'בן שנה וחצי', f: 'בת שנה וחצי', none: 'גיל שנה וחצי' }, en: '1½ years old' },
  { rule: 'two years', birth: '2020-03-10', at: '2022-03-10', parts: { years: 2, months: 0, days: 0, totalDays: 730 }, he: { m: 'בן שנתיים', f: 'בת שנתיים', none: 'גיל שנתיים' }, en: '2 years old' },
  { rule: 'two years and a half', birth: '2020-03-10', at: '2022-09-10', parts: { years: 2, months: 6, days: 0, totalDays: 914 }, he: { m: 'בן שנתיים וחצי', f: 'בת שנתיים וחצי', none: 'גיל שנתיים וחצי' }, en: '2½ years old' },
  { rule: '3 to 5 years', birth: '2020-03-10', at: '2023-03-10', parts: { years: 3, months: 0, days: 0, totalDays: 1095 }, he: { m: 'בן 3', f: 'בת 3', none: 'גיל 3' }, heWords: { m: 'בן שלוש', f: 'בת שלוש', none: 'גיל שלוש' }, en: '3 years old' },
  { rule: '3 to 5 years and a half', birth: '2020-03-10', at: '2023-09-10', parts: { years: 3, months: 6, days: 0, totalDays: 1279 }, he: { m: 'בן 3 וחצי', f: 'בת 3 וחצי', none: 'גיל 3 וחצי' }, heWords: { m: 'בן שלוש וחצי', f: 'בת שלוש וחצי', none: 'גיל שלוש וחצי' }, en: '3½ years old' },
  { rule: '3 to 5 years', birth: '2020-03-10', at: '2025-03-10', parts: { years: 5, months: 0, days: 0, totalDays: 1826 }, he: { m: 'בן 5', f: 'בת 5', none: 'גיל 5' }, heWords: { m: 'בן חמש', f: 'בת חמש', none: 'גיל חמש' }, en: '5 years old' },
  { rule: '3 to 5 years and a half', birth: '2020-03-10', at: '2025-09-10', parts: { years: 5, months: 6, days: 0, totalDays: 2010 }, he: { m: 'בן 5 וחצי', f: 'בת 5 וחצי', none: 'גיל 5 וחצי' }, heWords: { m: 'בן חמש וחצי', f: 'בת חמש וחצי', none: 'גיל חמש וחצי' }, en: '5½ years old' },
  { rule: '6 to 10 years (no half from six)', birth: '2020-03-10', at: '2026-03-10', parts: { years: 6, months: 0, days: 0, totalDays: 2191 }, he: { m: 'בן 6', f: 'בת 6', none: 'גיל 6' }, heWords: { m: 'בן שש', f: 'בת שש', none: 'גיל שש' }, en: '6 years old' },
  { rule: '6 to 10 years (no half from six)', birth: '2020-03-10', at: '2026-09-10', parts: { years: 6, months: 6, days: 0, totalDays: 2375 }, he: { m: 'בן 6', f: 'בת 6', none: 'גיל 6' }, heWords: { m: 'בן שש', f: 'בת שש', none: 'גיל שש' }, en: '6 years old' },
  { rule: '6 to 10 years (no half from six)', birth: '2020-03-10', at: '2030-03-10', parts: { years: 10, months: 0, days: 0, totalDays: 3652 }, he: { m: 'בן 10', f: 'בת 10', none: 'גיל 10' }, heWords: { m: 'בן עשר', f: 'בת עשר', none: 'גיל עשר' }, en: '10 years old' },
  { rule: '11 years and more', birth: '2020-03-10', at: '2031-03-10', parts: { years: 11, months: 0, days: 0, totalDays: 4017 }, he: { m: 'בן 11', f: 'בת 11', none: 'גיל 11' }, en: '11 years old' },
  { rule: '11 years and more', birth: '2020-03-10', at: '2060-03-10', parts: { years: 40, months: 0, days: 0, totalDays: 14610 }, he: { m: 'בן 40', f: 'בת 40', none: 'גיל 40' }, en: '40 years old' },
];
/** Days of the month that some months do not have: when each month of a life is full (see RULES). For W1's test of ageParts. */
export const AGE_PARTS_EDGES: readonly { birth: string; at: string; parts: AgeParts | null }[] = [
  { birth: '2020-02-29', at: '2021-02-28', parts: { years: 0, months: 11, days: 30, totalDays: 365 } },
  { birth: '2020-02-29', at: '2021-03-01', parts: { years: 1, months: 0, days: 0, totalDays: 366 } },
  { birth: '2020-02-29', at: '2024-02-28', parts: { years: 3, months: 11, days: 30, totalDays: 1460 } },
  { birth: '2020-02-29', at: '2024-02-29', parts: { years: 4, months: 0, days: 0, totalDays: 1461 } },
  { birth: '2020-01-31', at: '2020-02-29', parts: { years: 0, months: 0, days: 29, totalDays: 29 } },
  { birth: '2020-01-31', at: '2020-03-01', parts: { years: 0, months: 1, days: 0, totalDays: 30 } },
  { birth: '2020-01-31', at: '2020-03-31', parts: { years: 0, months: 2, days: 0, totalDays: 60 } },
  { birth: '2021-01-31', at: '2021-02-28', parts: { years: 0, months: 0, days: 28, totalDays: 28 } },
  { birth: '2021-01-31', at: '2021-03-01', parts: { years: 0, months: 1, days: 0, totalDays: 29 } },
  { birth: '2020-03-10', at: '2020-03-09', parts: null },
];
