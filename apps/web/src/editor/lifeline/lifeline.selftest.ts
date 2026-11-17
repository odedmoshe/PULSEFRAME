/**
 * Page hook of the life line for the proofs (ADR-0021): window.__pfLife exposes the calendar of packages/core as it runs in
 * THIS browser, so `pnpm proof:lifeline` can compare it, inside headless Chromium, with the page's own Intl
 * ('en-u-ca-hebrew' for year, month and day; 'he-u-ca-hebrew' for the Hebrew-letter numerals) over a range of days.
 * Imported by the self-test page only (apps/web/src/selftest.ts); the editor never loads it.
 */
import { formatHebrewDate, gregorianFromRd, hanukkahDay, hebrewFromRd, hebrewNumeral, holidaysOn, rdFromGregorian, rdFromHebrew, weekdayOf } from '@pulseframe/core';

const life = { rdFromGregorian, gregorianFromRd, weekdayOf, hebrewFromRd, rdFromHebrew, hebrewNumeral, formatHebrewDate, holidaysOn, hanukkahDay };
export type PfLife = typeof life;
(window as unknown as { __pfLife: PfLife }).__pfLife = life;
