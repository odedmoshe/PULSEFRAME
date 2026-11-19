/**
 * Capture-date arithmetic (life line, ADR-0021): exact integer arithmetic on wall-clock strings, the date a file takes from
 * the file it was made from, and which Hebrew day a clock time belongs to (the sunset windows). No Intl, no Date.
 *
 * The signatures are the lead's contract; the bodies are W1's (wave 5).
 *
 * The rules (plan §4.1, §4.3, with the verifier's corrections, which win):
 * - captureOf builds on timeLineage (lineage.ts: depth cap, own-property test, cycle guard): the nearest asset of the chain
 *   that has its own capture, with the offsets summed up to it, in whole seconds (T.frameIndexAt(offset, { num: 1, den: 1 })).
 * - Sunset windows. The Israeli windows (00:00–04:59 same day/night, 05:00–15:59 same day/day, 16:00–20:59 UNSURE,
 *   21:00–23:59 next day/night) apply only when the clock is provably Israel's: utcOffsetMinutes +120 with a date in
 *   November–February, +180 with a date in April–September, or null with assumedZone absent or 'Asia/Jerusalem'.
 *   Everything else (March, October, any other offset, a foreign home zone) is unsure from 14:00 to 23:59.
 *   A day-only date is unsure. The event's switch settles it: afterSunset true → next Hebrew day/night for times from
 *   noon on (a 01:00 clip of the same night is already on that day); false → same day/day.
 * - None of these may cache per document: operations and validation call them on a draft that changes between the
 *   operations of one transaction.
 */
import * as T from '@pulseframe/time';
import { timeLineage } from './lineage.ts';
import { isRealWallDate, WALL_DATE_TIME, type Capture, type ProjectDocument } from './schema.ts';
import { gregorianFromRd, rdFromGregorian, type DayPart, type GDate } from './hebrewCalendar.ts';

const SECONDS_PER_DAY = 86400;
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/** A WALL_DATE or WALL_DATE_TIME string in parts; `seconds` since midnight, null = only the day is known. Throws RangeError for any other string. */
export function parseWall(at: string): { date: GDate; seconds: number | null } {
  if (typeof at !== 'string' || !WALL_DATE_TIME.test(at)) throw new RangeError(`not a wall-clock date: ${String(at).slice(0, 40)}`);
  const date = { y: Number(at.slice(0, 4)), m: Number(at.slice(5, 7)), d: Number(at.slice(8, 10)) };
  return { date, seconds: at.length > 10 ? Number(at.slice(11, 13)) * 3600 + Number(at.slice(14, 16)) * 60 + Number(at.slice(17, 19)) : null };
}
/** The wall string of a day number and, when given, the seconds since its midnight. RangeError outside the years 0001–9999, which the form cannot write. */
export function formatWall(rd: number, seconds: number | null): string {
  const g = gregorianFromRd(rd);
  if (g.y < 1 || g.y > 9999) throw new RangeError(`the year ${g.y} cannot be written as a wall-clock date`);
  const day = `${pad(g.y, 4)}-${pad(g.m, 2)}-${pad(g.d, 2)}`;
  return seconds === null ? day : `${day}T${pad(Math.floor(seconds / 3600), 2)}:${pad(Math.floor(seconds / 60) % 60, 2)}:${pad(seconds % 60, 2)}`;
}
/**
 * `at` moved by `seconds` (either sign), exact. A day-and-time value keeps its form; a day-only value moves only by whole
 * days (the seconds are floored to days, so less than a day leaves it unchanged). RangeError when `seconds` is not a whole
 * number or the result leaves the years 0001–9999.
 */
export function addWallSeconds(at: string, seconds: number): string {
  if (!Number.isSafeInteger(seconds)) throw new RangeError('a wall-clock date moves by whole seconds');
  const w = parseWall(at), rd = rdFromGregorian(w.date);
  if (w.seconds === null) return formatWall(rd + Math.floor(seconds / SECONDS_PER_DAY), null);
  const total = w.seconds + seconds, days = Math.floor(total / SECONDS_PER_DAY);
  return formatWall(rd + days, total - days * SECONDS_PER_DAY);
}
/** Whole seconds of a rational time, rounded down; null when it is too large to count in. */
const wholeSeconds = (t: T.RationalTime): number | null => { const n = T.frameIndexAt(t, { num: 1, den: 1 }); return Number.isSafeInteger(n) ? n : null; };
/**
 * The capture a file shows: its own, or that of the nearest file it was made from that has one (time-preserving derivatives
 * only), with `offsetSeconds` = where this file's time zero lies after that capture, in whole seconds. null = no date.
 */
export function captureOf(doc: ProjectDocument, assetId: string): { capture: Capture; offsetSeconds: number; inherited: boolean } | null {
  if (!Object.hasOwn(doc.assets, assetId)) return null;
  const own = doc.assets[assetId]!.capture;
  if (own) return { capture: own, offsetSeconds: 0, inherited: false };
  // the lineage resolver has the depth cap, the own-property test and the cycle guard
  const chain = timeLineage(doc, assetId).chain;
  let offset: T.RationalTime = T.ZERO;
  for (let i = 1; i < chain.length; i++) {
    offset = T.add(offset, doc.assets[chain[i - 1]!]!.provenance.derived!.sourceRangeStart!);
    const capture = doc.assets[chain[i]!]!.capture;
    if (!capture) continue;
    const offsetSeconds = wholeSeconds(offset);
    return offsetSeconds === null ? null : { capture, offsetSeconds, inherited: true };
  }
  return null;
}
/** The moment a file's own time zero shows: its capture moved by the offset it inherits. null = no date (or one that cannot be written). */
export function shownCapture(doc: ProjectDocument, assetId: string): { capture: Capture; wall: string; inherited: boolean } | null {
  const c = captureOf(doc, assetId);
  if (!c) return null;
  if (c.offsetSeconds === 0) return { capture: c.capture, wall: c.capture.at, inherited: c.inherited };
  try { return { capture: c.capture, wall: addWallSeconds(c.capture.at, c.offsetSeconds), inherited: c.inherited }; } catch { return null; }
}

/** One reading of which Hebrew day a moment belongs to: the Gregorian day whose daytime is that Hebrew day, and the part. */
export interface HebrewDayReading { rd: number; part: DayPart }
const HOUR = 3600;
/** True when the clock is provably Israel's: the file states +02:00 in winter or +03:00 in summer, or states no offset and no other home zone was assumed. */
function isIsraeliClock(capture: Capture, month: number): boolean {
  if (capture.utcOffsetMinutes === 120) return month >= 11 || month <= 2;
  if (capture.utcOffsetMinutes === 180) return month >= 4 && month <= 9;
  return capture.utcOffsetMinutes === null && (capture.assumedZone === undefined || capture.assumedZone === 'Asia/Jerusalem');
}
/**
 * The Hebrew day(s) the wall-clock moment `wall` of a file with this capture may belong to: one reading when certain, two
 * when the clock falls in the sunset window or only the day is known. `afterSunset` is the switch of the file's event (null
 * = not decided, or the file is in no event).
 */
export function hebrewDayReadings(capture: Capture, wall: string, afterSunset: boolean | null): HebrewDayReading[] {
  const w = parseWall(wall), rd = rdFromGregorian(w.date), s = w.seconds;
  const sameNight: HebrewDayReading = { rd, part: 'night' }, sameDay: HebrewDayReading = { rd, part: 'day' }, nextNight: HebrewDayReading = { rd: rd + 1, part: 'night' };
  // before dawn the clock is already on the civil day whose daytime follows: that Hebrew day, whatever the answer
  if (s !== null && s < 5 * HOUR) return [sameNight];
  // the owner's answer for the event settles the rest: after sunset → the next Hebrew day from noon on; before → the same day
  if (afterSunset === true) return [s === null || s >= 12 * HOUR ? nextNight : sameDay];
  if (afterSunset === false) return [sameDay];
  if (s === null) return [sameDay, nextNight];
  if (isIsraeliClock(capture, w.date.m)) return s < 16 * HOUR ? [sameDay] : s < 21 * HOUR ? [sameDay, nextNight] : [nextNight];
  return s < 14 * HOUR ? [sameDay] : [sameDay, nextNight];
}

/**
 * Called by remove_asset before a file leaves the library (mutates the draft): every time-preserving copy that takes its
 * capture date from this file or through it, and has none of its own, gets that date written onto it (`at` moved by its
 * offset, the other fields kept), so removing the original does not empty the fields of its copies. Returns the ids of the
 * assets it changed; undo restores them through their asset entities.
 * A copy whose moved date would leave the years a capture can be stored in (a source dated at the very end of 2100) is left
 * without a date: that moment cannot be written down.
 */
export function handDownCapture(draft: ProjectDocument, assetId: string): string[] {
  if (!Object.hasOwn(draft.assets, assetId)) return [];
  // worked out for every heir BEFORE anything is written, so each keeps exactly the moment it showed (whole seconds are
  // rounded once, over its whole chain)
  const heirs: { id: string; capture: Capture }[] = [];
  for (const asset of Object.values(draft.assets)) {
    if (asset.id === assetId || asset.capture) continue;
    const chain = timeLineage(draft, asset.id).chain;
    const through = chain.indexOf(assetId);
    if (through < 1) continue;
    const owner = chain.findIndex((id, i) => i > 0 && !!draft.assets[id]!.capture);
    if (owner < through) continue; // no date in the chain, or it comes from a nearer file that stays
    const shown = shownCapture(draft, asset.id);
    if (!shown || !isRealWallDate(shown.wall)) continue;
    heirs.push({ id: asset.id, capture: { ...shown.capture, at: shown.wall } });
  }
  for (const h of heirs) draft.assets[h.id]!.capture = h.capture;
  return heirs.map((h) => h.id);
}
