/**
 * The capture day of the family film fixtures (packages/fixtures/src/film.ts) and the Hebrew date the family film proof expects
 * for it (family-film-proof.ts HEBREW_DAY, HEBREW_DAY_BEFORE, CAPTURE_ORDER): Tuesday 16 December 2025 on Israel's wall clock is
 * 26 Kislev 5786, the second day of Hanukkah, by core's own calendar AND by the Intl Hebrew calendar (ICU), and the day is in
 * the past, so the upload's readers (container creation_time, the still's file name) date every file; they refuse a capture
 * more than 48 hours after the import, which is why the fixture's earlier day (6 December 2026) was not read on this machine.
 */
import { describe, expect, it } from 'vitest';
import { formatHebrewDate, hanukkahDay, hebrewDayReadings, hebrewFromRd, rdFromGregorian } from '@pulseframe/core';
import { FILM_FIXTURE, filmFixtureTruth } from '@pulseframe/fixtures/film.ts';
import { captureFromFileName, captureFromTags } from '../../../apps/server/src/captureMeta.ts';

/** Typed here, as in the proof (family-film-proof.ts). */
const DAY = '2025-12-16', HEBREW_DAY = 'כ״ו בכסלו תשפ״ו', HEBREW_DAY_BEFORE = 'כ״ה בכסלו תשפ״ו';
const STILL = 'IMG_20251216_102300.png';
const CAPTURE_ORDER = ['film-b.mp4', 'film-d.mp4', 'film-a.mp4', 'film-f.mp4', 'film-c.mp4', STILL, 'film-e.mp4'];
const ZONE = 'Asia/Jerusalem';
const wallIsrael = (utc: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
};
const icuHebrew = (instant: Date) => new Intl.DateTimeFormat('en-u-ca-hebrew', { timeZone: ZONE, day: 'numeric', month: 'long', year: 'numeric' }).format(instant);

describe('the film fixtures\' capture day', () => {
  const truth = filmFixtureTruth();
  it('every file is dated mid-morning of 16 December 2025 in Israel (UTC + 2 h), in the proof\'s capture order', () => {
    const walls = truth.clips.map((c) => wallIsrael(c.capture));
    expect(walls.every((w) => w.startsWith(`${DAY}T10:`))).toBe(true);
    for (const c of truth.clips) expect(Date.parse(wallIsrael(c.capture) + 'Z') - Date.parse(c.capture)).toBe(120 * 60_000);
    expect(truth.still).toEqual({ name: STILL, capture: `${DAY}T10:23:00` });
    const dated = [...truth.clips.map((c) => ({ name: c.name, at: wallIsrael(c.capture) })), { name: STILL, at: truth.still.capture }];
    expect(dated.sort((a, b) => a.at.localeCompare(b.at)).map((d) => d.name)).toEqual(CAPTURE_ORDER);
    expect(FILM_FIXTURE.still.name).toBe(STILL);
  });
  it('is 26 Kislev 5786, the second day of Hanukkah, by core\'s calendar and by the Intl Hebrew calendar; the day before is 25 Kislev', () => {
    const rd = rdFromGregorian({ y: 2025, m: 12, d: 16 });
    expect(hebrewFromRd(rd)).toEqual({ y: 5786, m: 'kislev', d: 26 });
    expect(formatHebrewDate(hebrewFromRd(rd))).toBe(HEBREW_DAY);
    expect(formatHebrewDate(hebrewFromRd(rd - 1))).toBe(HEBREW_DAY_BEFORE);
    expect(hanukkahDay(rd)).toBe(2);
    for (const c of truth.clips) expect(icuHebrew(new Date(c.capture))).toBe('26 Kislev 5786');
    expect(icuHebrew(new Date('2025-12-15T08:00:00Z'))).toBe('25 Kislev 5786');
    // a mid-morning Israeli clock reads one Hebrew day, whatever the sunset answer (no evening rule applies)
    for (const c of truth.clips) {
      const at = wallIsrael(c.capture);
      expect(hebrewDayReadings({ at, utcOffsetMinutes: null, source: 'container', assumedZone: ZONE }, at, null)).toEqual([{ rd, part: 'day' }]);
    }
  });
  it('lies in the past, so the upload reads every file\'s date: the container\'s creation time and the still\'s file name', () => {
    const cx = { homeZone: ZONE, now: new Date() };
    for (const c of truth.clips) {
      expect(Date.parse(c.capture)).toBeLessThan(cx.now.getTime());
      expect(captureFromTags({ creation_time: c.capture }, cx), c.name).toEqual({ at: wallIsrael(c.capture), utcOffsetMinutes: null, source: 'container', assumedZone: ZONE });
    }
    expect(captureFromFileName(STILL, cx)).toEqual({ at: `${DAY}T10:23:00`, utcOffsetMinutes: null, source: 'filename', circa: true });
  });
});
