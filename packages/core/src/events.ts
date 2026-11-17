/**
 * Events of the life line (ADR-0021): library files grouped by when they were taken, the calendar view of the library and
 * "on this day". Pure functions of the document; no Intl, no Date.
 *
 * CONTRACT FILE (lead pre-pass). The signatures and types are fixed; the bodies are W1's. Until then the pure helpers throw
 * "not built". Two functions are already on a live path and answer plainly instead:
 * - eventDisplayName (get_summary calls it) gives the name a person typed, or none. It derives nothing yet.
 * - detachAssetFromEvents (remove_asset calls it) answers only where the file is in no event and refuses otherwise.
 *
 * Notes for the bodies (plan §4.4, with the verifier's corrections, which win):
 * - Only what a person typed is stored (LifeEvent.name). A holiday name is DERIVED here at read time, so correcting the
 *   holiday table never changes what an old operation log replays to. Never a derived name while the Hebrew day of any file
 *   of the event is unsure (capture.ts hebrewDayReadings gives two readings).
 * - clusterCaptures: timed files become minutes rd·1440 + ⌊seconds/60⌋, sorted by (minutes, id); a new cluster starts where
 *   the gap is strictly greater than gapMinutes. Day-only files join the cluster with the most files on that civil day (tie:
 *   the earliest), else form one cluster per day.
 * - No caches here: operations and validation call these on a draft that changes between the operations of one transaction.
 *   A cache belongs to the caller that only sees committed documents (fields.ts makeFieldIndex, kept by the engine).
 * - People (birthdays as event names, «יום הולדת 5 לנועה») are NOT part of this build: they wait for the owner's approval.
 */
import { OpError } from './ops.ts';
import type { LifeEvent, ProjectDocument } from './schema.ts';

const notBuilt = (what: string): never => { throw new Error(`life line: ${what} is not built yet (events.ts, W1)`); };

/** A file with its capture as it is shown: `wall` is a WALL_DATE or WALL_DATE_TIME string. */
export interface DatedAsset { assetId: string; wall: string }
/** Pure gap clustering. Clusters in time order; members in (time, id) order. Every input file is in exactly one cluster. */
export function clusterCaptures(_items: readonly DatedAsset[], _gapMinutes: number): string[][] { return notBuilt('clusterCaptures'); }
/** The event a file is in, or null. Reads `doc.events ?? {}`. */
export function eventOfAsset(_doc: ProjectDocument, _assetId: string): LifeEvent | null { return notBuilt('eventOfAsset'); }
/** The earliest and latest capture among the event's files (wall strings), or null when none of them has a date. */
export function eventSpan(_doc: ProjectDocument, _event: LifeEvent): { first: string; last: string } | null { return notBuilt('eventSpan'); }
/**
 * A name the event could take, for the editor to offer and never stored unasked: one per sunset reading that gives a
 * holiday. `afterSunset` is the answer that leads to this name (null = the name holds either way).
 */
export interface EventCandidate { afterSunset: boolean | null; name: string; holidayId: string; kind: 'holiday' }
export function eventCandidates(_doc: ProjectDocument, _event: LifeEvent): EventCandidate[] { return notBuilt('eventCandidates'); }
/**
 * The name an event is shown by: what a person typed ('manual'); else the holiday all its files fall on, when no file's
 * Hebrew day is unsure ('holiday'; the same holiday on different days gives the holiday alone); else none (''), and the
 * event is shown by its date. Derived at every read. `lang` chooses the wording of a derived name (default Hebrew).
 */
export function eventDisplayName(_doc: ProjectDocument, event: LifeEvent, _lang: 'he' | 'en' = 'he'): { name: string; kind: 'manual' | 'holiday' | 'none' } {
  // CONTRACT STUB: the typed name only. The holiday derivation is W1's.
  return event.name ? { name: event.name, kind: 'manual' } : { name: '', kind: 'none' };
}
/**
 * Called by remove_asset (mutates the draft): takes the file out of the event it is in; an event left without files is
 * deleted; the event counts as edited by hand. Returns the ids of the events it changed or deleted.
 */
export function detachAssetFromEvents(draft: ProjectDocument, assetId: string): string[] {
  // CONTRACT STUB: true where the file is in no event; otherwise refused rather than leaving an event that names a missing file.
  if (!Object.values(draft.events ?? {}).some((e) => e.assetIds.includes(assetId))) return [];
  throw new OpError('incompatible', 'life line: taking a file out of its event is not built yet', { assetId });
}
/**
 * The library by capture date, newest year first: years, their months (1..12) with the Hebrew month and year beside them
 * («אדר ב׳ תשפ״ד», the Hebrew month of the 15th of that civil month), the files of each month in capture order, and the files
 * without a date. Pictures and videos only.
 */
export function calendarGroups(_doc: ProjectDocument): { years: { year: number; months: { month: number; hebrew: string; assetIds: string[] }[] }[]; undated: string[] } { return notBuilt('calendarGroups'); }
/** One file taken on this day of an earlier year. `match` says by which calendar; `hebrewDate` is filled for a Hebrew match. */
export interface OnThisDayItem { projectId: string; projectName: string; assetId: string; assetName: string; wall: string; circa: boolean; yearsAgo: number; match: 'gregorian' | 'hebrew'; hebrewDate: string | null; eventName: string | null }
/**
 * Files taken on `today`'s day and month in earlier years (Gregorian), and on today's Hebrew day and month where that is
 * certain (Adar of a common year matches Adar II). `today` is a WALL_DATE. Newest first; at most `limit` (default 12).
 */
export function onThisDay(_projects: readonly { projectId: string; projectName: string; doc: ProjectDocument }[], _today: string, _limit?: number): OnThisDayItem[] { return notBuilt('onThisDay'); }
