/**
 * Capture-date arithmetic (life line, ADR-0021): exact integer arithmetic on wall-clock strings, the date a file takes from
 * the file it was made from, and which Hebrew day a clock time belongs to (the sunset windows). No Intl, no Date.
 *
 * CONTRACT FILE (lead pre-pass). The signatures are fixed; the bodies are W1's. Until then the pure helpers throw
 * "not built"; handDownCapture, which remove_asset already calls, answers only where the answer is "nothing to do" and
 * refuses otherwise, so no date is ever dropped silently.
 *
 * Notes for the bodies (plan §4.1, §4.3, with the verifier's corrections, which win):
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
import { OpError } from './ops.ts';
import type { Capture, ProjectDocument } from './schema.ts';
import type { DayPart, GDate } from './hebrewCalendar.ts';

const notBuilt = (what: string): never => { throw new Error(`life line: ${what} is not built yet (capture.ts, W1)`); };

/** A WALL_DATE or WALL_DATE_TIME string in parts; `seconds` since midnight, null = only the day is known. Throws RangeError for any other string. */
export function parseWall(_at: string): { date: GDate; seconds: number | null } { return notBuilt('parseWall'); }
/**
 * `at` moved by `seconds` (either sign), exact. A day-and-time value keeps its form; a day-only value moves only by whole
 * days (the seconds are floored to days, so less than a day leaves it unchanged).
 */
export function addWallSeconds(_at: string, _seconds: number): string { return notBuilt('addWallSeconds'); }
/**
 * The capture a file shows: its own, or that of the nearest file it was made from that has one (time-preserving derivatives
 * only), with `offsetSeconds` = where this file's time zero lies after that capture, in whole seconds. null = no date.
 */
export function captureOf(_doc: ProjectDocument, _assetId: string): { capture: Capture; offsetSeconds: number; inherited: boolean } | null { return notBuilt('captureOf'); }
/** One reading of which Hebrew day a moment belongs to: the Gregorian day whose daytime is that Hebrew day, and the part. */
export interface HebrewDayReading { rd: number; part: DayPart }
/**
 * The Hebrew day(s) the wall-clock moment `wall` of a file with this capture may belong to: one reading when certain, two
 * when the clock falls in the sunset window or only the day is known. `afterSunset` is the switch of the file's event (null
 * = not decided, or the file is in no event).
 */
export function hebrewDayReadings(_capture: Capture, _wall: string, _afterSunset: boolean | null): HebrewDayReading[] { return notBuilt('hebrewDayReadings'); }

/**
 * Called by remove_asset before a file leaves the library (mutates the draft): every time-preserving copy that takes its
 * capture date from this file, and has none of its own, gets that date written onto it (`at` moved by its offset, the other
 * fields kept), so removing the original does not empty the fields of its copies. Returns the ids of the assets it changed;
 * undo restores them through their asset entities.
 */
export function handDownCapture(draft: ProjectDocument, assetId: string): string[] {
  // CONTRACT STUB: true where there is nothing to hand down; otherwise refused rather than dropping the copies' date.
  const heirs = Object.values(draft.assets).some((a) => !a.capture && !!a.provenance.derived?.sourceRangeStart && a.provenance.derived.sourceAssetIds[0] === assetId);
  if (!heirs) return [];
  const inherits = (id: string, seen = new Set<string>()): boolean => {
    const a = Object.hasOwn(draft.assets, id) ? draft.assets[id]! : undefined;
    if (!a || seen.has(id)) return false;
    if (a.capture) return true;
    seen.add(id);
    const parent = a.provenance.derived?.sourceRangeStart ? a.provenance.derived.sourceAssetIds[0] : undefined;
    return parent !== undefined && inherits(parent, seen);
  };
  if (!inherits(assetId)) return [];
  throw new OpError('incompatible', 'life line: handing a capture date down to the copies of a removed file is not built yet', { assetId });
}
