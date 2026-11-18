/**
 * The wording of ages (ageWords.ts, ADR-0021 people section): ageParts, ageHe and ageEn reproduce the lead's table AGE_FORMS
 * and the month edges AGE_PARTS_EDGES exactly; a property test against a Date oracle (tests only; the source never uses Date
 * or Intl); the day before and the day of a birthday; 29 February.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AGE_FORMS, AGE_PARTS_EDGES, AGE_YEAR_WORDS_HE, ageEn, ageHe, ageParts, type AgeParts } from './index.ts';

/** Days between two wall days, by the test oracle (Date.UTC). */
const oracleDays = (a: string, b: string) => { const d = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))); return Math.round((d(b) - d(a)) / 86400000); };
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** A small seeded random source (mulberry32). */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

describe('ageParts', () => {
  it('gives `parts` for every AGE_FORMS row and every AGE_PARTS_EDGES row (29 February counts on 1 March in common years)', () => {
    for (const row of AGE_FORMS) expect(ageParts(row.birth, row.at), `${row.rule} ${row.birth}→${row.at}`).toEqual(row.parts);
    for (const e of AGE_PARTS_EDGES) expect(ageParts(e.birth, e.at), `${e.birth}→${e.at}`).toEqual(e.parts);
  });
  it('the day before a birthday and the day of it; before the birth there is no age', () => {
    expect(ageParts('2016-11-04', '2019-11-03')).toEqual({ years: 2, months: 11, days: 30, totalDays: oracleDays('2016-11-04', '2019-11-03') });
    expect(ageParts('2016-11-04', '2019-11-04')).toEqual({ years: 3, months: 0, days: 0, totalDays: oracleDays('2016-11-04', '2019-11-04') });
    expect(ageParts('2016-11-04', '2016-11-03')).toBeNull();
    expect(ageParts('2016-11-04', '2016-11-04')).toEqual({ years: 0, months: 0, days: 0, totalDays: 0 });
    // a time after the day is ignored
    expect(ageParts('2016-11-04', '2019-11-04T23:59:59')).toEqual(ageParts('2016-11-04', '2019-11-04'));
    // born on 29 February: the birthday is 1 March in common years and 29 February in leap years
    expect(ageParts('2016-02-29', '2017-02-28')!.years).toBe(0);
    expect(ageParts('2016-02-29', '2017-03-01')).toMatchObject({ years: 1, months: 0, days: 0 });
    expect(ageParts('2016-02-29', '2020-02-29')).toMatchObject({ years: 4, months: 0, days: 0 });
    expect(ageParts('2016-02-29', '2100-03-01')).toMatchObject({ years: 84, months: 0, days: 0 }); // 2100 is a common year
  });
  it('refuses what is not a calendar day', () => {
    for (const bad of ['2021-02-29', '2020-13-01', '20-01-01', '', 'x']) {
      expect(() => ageParts(bad, '2022-01-01'), bad).toThrow(RangeError);
      expect(() => ageParts('2020-01-01', bad), bad).toThrow(RangeError);
    }
  });
  it('property (2,000 seeded pairs over 1900–2100): totalDays is the day difference, the months are full ones, and one day more never makes a person younger', () => {
    const r = rng(20261117);
    const lo = Date.UTC(1900, 0, 1), hi = Date.UTC(2100, 11, 31);
    for (let i = 0; i < 2000; i++) {
      const b = iso(lo + Math.floor(r() * (hi - lo) / 86400000) * 86400000);
      const span = Math.floor(r() * (i % 3 === 0 ? 70 : i % 3 === 1 ? 800 : 40000));
      const atMs = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))) + span * 86400000;
      if (atMs > hi) continue;
      const a = iso(atMs), next = iso(atMs + 86400000);
      const p = ageParts(b, a)!, k = `${b}→${a}`;
      expect(p.totalDays, k).toBe(span);
      expect(p.months >= 0 && p.months < 12 && p.days >= 0 && p.days < 31, k).toBe(true);
      // the oracle's full months: the same day of the month in the month n after the birth, or the 1st after it when that day does not exist
      const n = p.years * 12 + p.months, by = Number(b.slice(0, 4)), bm = Number(b.slice(5, 7)) - 1, bd = Number(b.slice(8, 10));
      const full = (m: number) => { const y = by + Math.floor((bm + m) / 12), mm = (bm + m) % 12; const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate(); return bd <= last ? Date.UTC(y, mm, bd) : Date.UTC(y, mm + 1, 1); };
      expect(full(n) <= atMs && full(n + 1) > atMs, k).toBe(true);
      expect(p.days, k).toBe(Math.round((atMs - full(n)) / 86400000));
      if (Date.parse(next) <= hi) {
        const q = ageParts(b, next)!;
        expect(q.years * 12 + q.months >= n, k).toBe(true);
      }
    }
  });
});

describe('ageHe and ageEn', () => {
  it('give the strings of every AGE_FORMS row, for «בן», «בת» and no word choice, in digits and in words, and in English', () => {
    for (const row of AGE_FORMS) {
      const k = `${row.rule} ${row.birth}→${row.at}`;
      expect({ m: ageHe(row.parts, 'm', 'digits'), f: ageHe(row.parts, 'f', 'digits'), none: ageHe(row.parts, undefined, 'digits') }, k).toEqual(row.he);
      expect({ m: ageHe(row.parts, 'm', 'words'), f: ageHe(row.parts, 'f', 'words'), none: ageHe(row.parts, undefined, 'words') }, k).toEqual(row.heWords ?? row.he);
      expect(ageEn(row.parts), k).toBe(row.en);
    }
  });
  it('every year from 3 to 10 has its word; above ten digits; «וחצי» stops at six; days, weeks and months keep digits in words style', () => {
    const at = (years: number, months = 0): AgeParts => ({ years, months, days: 0, totalDays: years * 365 + months * 30 });
    for (let y = 3; y <= 10; y++) expect(ageHe(at(y), 'f', 'words')).toBe(`בת ${AGE_YEAR_WORDS_HE[y]}`);
    expect(ageHe(at(11), 'f', 'words')).toBe('בת 11');
    expect(ageHe(at(5, 11), 'm', 'words')).toBe('בן חמש וחצי');
    expect(ageHe(at(6, 11), 'm', 'words')).toBe('בן שש');
    expect(ageHe(at(1, 5), 'f', 'digits')).toBe('בת שנה');
    expect(ageEn(at(5, 6))).toBe('5½ years old');
    expect(ageEn(at(6, 6))).toBe('6 years old');
    expect(ageHe({ years: 0, months: 4, days: 3, totalDays: 125 }, 'f', 'words')).toBe('בת 4 חודשים');
    expect(ageHe({ years: 0, months: 0, days: 5, totalDays: 5 }, undefined, 'words')).toBe('גיל 5 ימים');
  });
  it('the day before and the day of a birthday, through ageParts', () => {
    expect(ageHe(ageParts('2016-11-04', '2019-11-03')!, 'f', 'digits')).toBe('בת שנתיים וחצי');
    expect(ageHe(ageParts('2016-11-04', '2019-11-04')!, 'f', 'digits')).toBe('בת 3');
    expect(ageHe(ageParts('2016-02-29', '2017-02-28')!, 'm', 'digits')).toBe('בן 11 חודשים');
    expect(ageHe(ageParts('2016-02-29', '2017-03-01')!, 'm', 'digits')).toBe('בן שנה');
    expect(ageEn(ageParts('2016-02-29', '2017-03-01')!)).toBe('1 year old');
  });
});

describe('the age wording and the people code use no clock and no locale', () => {
  it('ageWords.ts, fields.ts and peopleOps.ts never call Date or Intl', () => {
    for (const file of ['ageWords.ts', 'fields.ts', 'peopleOps.ts', 'people.ts']) {
      const src = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/new Date\b|\bDate\.(now|UTC|parse)\b|\bIntl\./);
    }
  });
});
