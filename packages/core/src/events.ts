/**
 * Events of the life line (ADR-0021): library files grouped by when they were taken, the calendar view of the library and
 * "on this day". Pure functions of the document; no Intl, no Date.
 *
 * The signatures and types are the lead's contract; the bodies are W1's (wave 5).
 *
 * The rules (plan §4.4, with the verifier's corrections, which win):
 * - Only what a person typed is stored (LifeEvent.name). A holiday name is DERIVED here at read time, so correcting the
 *   holiday table never changes what an old operation log replays to. Never a derived name while the Hebrew day of any file
 *   of the event is unsure (capture.ts hebrewDayReadings gives two readings).
 * - clusterCaptures: timed files become minutes rd·1440 + ⌊seconds/60⌋, sorted by (minutes, id); a new cluster starts where
 *   the gap is strictly greater than gapMinutes. Day-only files join the cluster with the most timed files on that civil day
 *   (tie: the earliest), else form one cluster per day. Inside a cluster a day-only file sits at the midnight of its day;
 *   the clusters themselves are listed by when their timed files begin (a cluster of day-only files: by its day), so a
 *   day-only file that joined an evening does not pull that evening before the morning. Last, a cluster of more than
 *   MAX_EVENT_FILES members (schema.ts: what an event can hold) is cut, in member order, into consecutive clusters of
 *   MAX_EVENT_FILES and a remainder, so cluster_events never makes an event the project cannot store and never has to
 *   refuse for size.
 * - A derived name looks at the dated files of the event only: a file without a date says nothing about the day.
 * - No caches here: operations and validation call these on a draft that changes between the operations of one transaction.
 *   A cache belongs to the caller that only sees committed documents (fields.ts makeFieldIndex, kept by the engine).
 * - People (birthdays as event names, «יום הולדת 5 לנועה») are NOT part of this build: they wait for the owner's approval.
 */
import { MAX_EVENT_FILES, type Asset, type Capture, type LifeEvent, type ProjectDocument } from './schema.ts';
import { timeLineage } from './lineage.ts';
import { hebrewDayReadings, parseWall, shownCapture } from './capture.ts';
import { formatHebrewDate, HEBREW_MONTH_NAMES, hebrewFromRd, hebrewNumeral, HOLIDAY_FAMILIES, holidaysOn, rdFromGregorian, type HDate, type Holiday } from './hebrewCalendar.ts';

/** A file with its capture as it is shown: `wall` is a WALL_DATE or WALL_DATE_TIME string. */
export interface DatedAsset { assetId: string; wall: string }
/** Where a wall-clock moment sits on one line of minutes; a day-only date sits at its midnight. */
function minuteOf(wall: string): { rd: number; minutes: number; timed: boolean } {
  const w = parseWall(wall), rd = rdFromGregorian(w.date);
  return { rd, minutes: rd * 1440 + (w.seconds === null ? 0 : Math.floor(w.seconds / 60)), timed: w.seconds !== null };
}
/** Order of two wall-clock moments (a day-only date before the times of its day). */
export function compareWall(a: string, b: string): number {
  const x = parseWall(a), y = parseWall(b);
  return rdFromGregorian(x.date) - rdFromGregorian(y.date) || (x.seconds ?? -1) - (y.seconds ?? -1);
}
/** Pure gap clustering. Clusters in time order; members in (time, id) order. Every input file is in exactly one cluster, and no cluster holds more than MAX_EVENT_FILES. */
export function clusterCaptures(items: readonly DatedAsset[], gapMinutes: number): string[][] {
  interface Member { id: string; rd: number; minutes: number; timed: boolean }
  const seen = new Set<string>();
  const members: Member[] = [];
  for (const item of items) {
    if (seen.has(item.assetId)) continue; // a file listed twice is one file
    seen.add(item.assetId);
    members.push({ id: item.assetId, ...minuteOf(item.wall) });
  }
  const order = (a: Member, b: Member) => a.minutes - b.minutes || (a.timed === b.timed ? 0 : a.timed ? 1 : -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const timed = members.filter((m) => m.timed).sort(order);
  const clusters: Member[][] = [];
  for (const m of timed) {
    const cur = clusters[clusters.length - 1];
    if (cur && m.minutes - cur[cur.length - 1]!.minutes <= gapMinutes) cur.push(m); else clusters.push([m]);
  }
  // files of which only the day is known: the cluster with the most timed files on that civil day (the earliest of equals), else one cluster per day
  const onDay = new Map<number, Map<number, number>>(); // day → cluster index → timed files on that day
  clusters.forEach((c, i) => { for (const m of c) { const per = onDay.get(m.rd) ?? new Map<number, number>(); per.set(i, (per.get(i) ?? 0) + 1); onDay.set(m.rd, per); } });
  const ownDay = new Map<number, Member[]>();
  for (const m of members.filter((x) => !x.timed).sort(order)) {
    const per = onDay.get(m.rd);
    if (per) {
      let best = -1, most = 0;
      for (const [i, count] of per) if (count > most || (count === most && i < best)) { best = i; most = count; }
      clusters[best]!.push(m);
    } else {
      const day = ownDay.get(m.rd);
      if (day) day.push(m); else { const made: Member[] = [m]; ownDay.set(m.rd, made); clusters.push(made); }
    }
  }
  for (const c of clusters) c.sort(order);
  // clusters by when their timed files begin (a cluster of day-only files: by its day), so a day-only file that joined an
  // evening does not pull that evening before the morning
  const begins = (c: Member[]): Member => c.find((m) => m.timed) ?? c[0]!;
  clusters.sort((a, b) => order(begins(a), begins(b)));
  // an event holds at most MAX_EVENT_FILES: a longer run is cut, in member order, into consecutive clusters
  const out: string[][] = [];
  for (const c of clusters) for (let i = 0; i < c.length; i += MAX_EVENT_FILES) out.push(c.slice(i, i + MAX_EVENT_FILES).map((m) => m.id));
  return out;
}
/** The event a file is in, or null. Reads `doc.events ?? {}`. */
export function eventOfAsset(doc: ProjectDocument, assetId: string): LifeEvent | null {
  for (const e of Object.values(doc.events ?? {})) if (e.assetIds.includes(assetId)) return e;
  return null;
}
/**
 * The event a file's date belongs to: its own event, else that of the nearest file it was made from (so a clip given an
 * enhanced copy of its file keeps its event's name and sunset answer). `lookup` answers for one file (default: eventOfAsset).
 */
export function eventForCapture(doc: ProjectDocument, assetId: string, lookup: (id: string) => LifeEvent | null = (id) => eventOfAsset(doc, id)): LifeEvent | null {
  const own = lookup(assetId);
  if (own || !Object.hasOwn(doc.assets, assetId) || doc.assets[assetId]!.capture) return own;
  for (const id of timeLineage(doc, assetId).chain.slice(1)) { const e = lookup(id); if (e) return e; if (doc.assets[id]!.capture) break; }
  return null;
}
/** The earliest and latest capture among the event's files (wall strings), or null when none of them has a date. */
export function eventSpan(doc: ProjectDocument, event: LifeEvent): { first: string; last: string } | null {
  let first: string | null = null, last: string | null = null;
  for (const id of event.assetIds) {
    const wall = shownCapture(doc, id)?.wall;
    if (wall === undefined) continue;
    if (first === null || compareWall(wall, first) < 0) first = wall;
    if (last === null || compareWall(wall, last) > 0) last = wall;
  }
  return first !== null && last !== null ? { first, last } : null;
}
/**
 * The holiday all the dated files of an event fall on under one sunset answer, or null: when a file's Hebrew day is unsure,
 * when a file falls on no holiday, or when the files fall on different holidays. Files without a date say nothing.
 */
function holidayOfEvent(doc: ProjectDocument, event: LifeEvent, afterSunset: boolean | null): { holiday: Holiday; whole: boolean } | null {
  let found: Holiday | null = null, whole = false;
  for (const id of event.assetIds) {
    const shown = shownCapture(doc, id);
    if (!shown) continue;
    const readings = hebrewDayReadings(shown.capture, shown.wall, afterSunset);
    if (readings.length !== 1) return null;
    const holiday = holidaysOn(readings[0]!.rd, readings[0]!.part)[0];
    if (!holiday) return null;
    if (found === null) found = holiday;
    else if (found.family !== holiday.family) return null;
    else if (found.id !== holiday.id) whole = true;
  }
  return found ? { holiday: found, whole } : null;
}
const holidayName = (h: { holiday: Holiday; whole: boolean }, lang: 'he' | 'en'): string => (h.whole ? HOLIDAY_FAMILIES[h.holiday.family]?.[lang] ?? h.holiday[lang] : h.holiday[lang]);
/** True when the Hebrew day of at least one dated file of the event depends on the sunset question while it is not answered. */
export function eventNeedsSunsetAnswer(doc: ProjectDocument, event: LifeEvent): boolean {
  return event.assetIds.some((id) => { const shown = shownCapture(doc, id); return !!shown && hebrewDayReadings(shown.capture, shown.wall, null).length > 1; });
}
/**
 * A name the event could take, for the editor to offer and never stored unasked: one per sunset reading that gives a
 * holiday. `afterSunset` is the answer that leads to this name (null = the name holds either way).
 */
export interface EventCandidate { afterSunset: boolean | null; name: string; holidayId: string; kind: 'holiday' }
export function eventCandidates(doc: ProjectDocument, event: LifeEvent, lang: 'he' | 'en' = 'he'): EventCandidate[] {
  const candidate = (afterSunset: boolean | null, h: { holiday: Holiday; whole: boolean }): EventCandidate => ({ afterSunset, name: holidayName(h, lang), holidayId: h.whole ? h.holiday.family : h.holiday.id, kind: 'holiday' });
  if (!eventNeedsSunsetAnswer(doc, event)) { const h = holidayOfEvent(doc, event, null); return h ? [candidate(null, h)] : []; }
  const before = holidayOfEvent(doc, event, false), after = holidayOfEvent(doc, event, true);
  if (before && after && before.whole === after.whole && (before.whole ? before.holiday.family === after.holiday.family : before.holiday.id === after.holiday.id)) return [candidate(null, before)];
  return [...(before ? [candidate(false, before)] : []), ...(after ? [candidate(true, after)] : [])];
}
/**
 * The name an event is shown by: what a person typed ('manual'); else the holiday all its files fall on, when no file's
 * Hebrew day is unsure ('holiday'; the same holiday on different days gives the holiday alone); else none (''), and the
 * event is shown by its date. Derived at every read. `lang` chooses the wording of a derived name (default Hebrew).
 */
export function eventDisplayName(doc: ProjectDocument, event: LifeEvent, lang: 'he' | 'en' = 'he'): { name: string; kind: 'manual' | 'holiday' | 'none' } {
  if (event.name) return { name: event.name, kind: 'manual' };
  const h = holidayOfEvent(doc, event, event.afterSunset);
  return h ? { name: holidayName(h, lang), kind: 'holiday' } : { name: '', kind: 'none' };
}
/**
 * Called by remove_asset (mutates the draft): takes the file out of the event it is in; an event left without files is
 * deleted; the event counts as edited by hand. Returns the ids of the events it changed or deleted.
 */
export function detachAssetFromEvents(draft: ProjectDocument, assetId: string): string[] {
  const changed: string[] = [];
  for (const [key, e] of Object.entries(draft.events ?? {})) {
    if (!e.assetIds.includes(assetId)) continue;
    e.assetIds = e.assetIds.filter((id) => id !== assetId);
    if (e.assetIds.length === 0) delete draft.events[key]; else e.origin.edited = true;
    changed.push(e.id);
  }
  return changed;
}
const isPicture = (a: Asset): boolean => a.kind === 'video' || a.kind === 'image';
/**
 * The library by capture date, newest year first: years, their months (1..12, newest first) with the Hebrew month and year
 * beside them («אדר ב׳ תשפ״ד», the Hebrew month of the 15th of that civil month), the files of each month in capture order,
 * and the files without a date. Pictures and videos only.
 */
export function calendarGroups(doc: ProjectDocument): { years: { year: number; months: { month: number; hebrew: string; assetIds: string[] }[] }[]; undated: string[] } {
  const undated: string[] = [];
  const byMonth = new Map<number, { id: string; wall: string }[]>(); // year·12 + month − 1
  for (const a of Object.values(doc.assets)) {
    if (!isPicture(a)) continue;
    const wall = shownCapture(doc, a.id)?.wall;
    if (wall === undefined) { undated.push(a.id); continue; }
    const { date } = parseWall(wall), key = date.y * 12 + date.m - 1;
    const list = byMonth.get(key);
    if (list) list.push({ id: a.id, wall }); else byMonth.set(key, [{ id: a.id, wall }]);
  }
  const years: { year: number; months: { month: number; hebrew: string; assetIds: string[] }[] }[] = [];
  for (const key of [...byMonth.keys()].sort((a, b) => b - a)) {
    const year = Math.floor(key / 12), month = (key % 12) + 1;
    const h = hebrewFromRd(rdFromGregorian({ y: year, m: month, d: 15 }));
    const files = byMonth.get(key)!.sort((a, b) => compareWall(a.wall, b.wall) || (a.id < b.id ? -1 : 1));
    let group = years[years.length - 1];
    if (!group || group.year !== year) { group = { year, months: [] }; years.push(group); }
    group.months.push({ month, hebrew: `${HEBREW_MONTH_NAMES[h.m].he} ${hebrewNumeral(h.y)}`, assetIds: files.map((f) => f.id) });
  }
  return { years, undated };
}
/** One file taken on this day of an earlier year. `match` says by which calendar; `hebrewDate` is filled for a Hebrew match. */
export interface OnThisDayItem { projectId: string; projectName: string; assetId: string; assetName: string; wall: string; circa: boolean; yearsAgo: number; match: 'gregorian' | 'hebrew'; hebrewDate: string | null; eventName: string | null }
/** Adar of a common year and Adar II of a leap year are the same month for an anniversary; Adar I is its own. */
const anniversaryMonth = (h: HDate): string => (h.m === 'adar2' ? 'adar' : h.m);
/** The one Hebrew day a file's own capture certainly belongs to, or null while it depends on the sunset question. */
function certainHebrewDay(capture: Capture, afterSunset: boolean | null): HDate | null {
  const readings = hebrewDayReadings(capture, capture.at, afterSunset);
  return readings.length === 1 ? hebrewFromRd(readings[0]!.rd) : null;
}
/**
 * Files taken on `today`'s day and month in earlier years (Gregorian), and on today's Hebrew day and month where that is
 * certain (Adar of a common year matches Adar II). `today` is a WALL_DATE. Newest first; at most `limit` (default 12).
 * A file is listed once (a match by both calendars is listed as Gregorian); only a file's own date counts, so a copy made
 * from a file is not listed beside it.
 */
export function onThisDay(projects: readonly { projectId: string; projectName: string; doc: ProjectDocument }[], today: string, limit = 12): OnThisDayItem[] {
  const now = parseWall(today).date, hebrewNow = hebrewFromRd(rdFromGregorian(now));
  const items: OnThisDayItem[] = [];
  for (const p of projects) {
    // file → event of this document, worked out once for this call (not kept)
    const eventOf = new Map<string, LifeEvent>();
    for (const e of Object.values(p.doc.events ?? {})) for (const id of e.assetIds) if (!eventOf.has(id)) eventOf.set(id, e);
    for (const a of Object.values(p.doc.assets)) {
      if (!isPicture(a) || !a.capture) continue;
      const date = parseWall(a.capture.at).date, event = eventOf.get(a.id) ?? null;
      let match: 'gregorian' | 'hebrew' | null = null, yearsAgo = 0, hebrewDate: string | null = null;
      if (date.m === now.m && date.d === now.d && date.y < now.y) { match = 'gregorian'; yearsAgo = now.y - date.y; }
      else {
        const h = certainHebrewDay(a.capture, event?.afterSunset ?? null);
        if (h && h.d === hebrewNow.d && anniversaryMonth(h) === anniversaryMonth(hebrewNow) && h.y < hebrewNow.y) { match = 'hebrew'; yearsAgo = hebrewNow.y - h.y; hebrewDate = formatHebrewDate(h); }
      }
      if (!match) continue;
      items.push({ projectId: p.projectId, projectName: p.projectName, assetId: a.id, assetName: a.name, wall: a.capture.at, circa: a.capture.circa === true, yearsAgo, match, hebrewDate, eventName: (event && eventDisplayName(p.doc, event).name) || null });
    }
  }
  items.sort((a, b) => compareWall(b.wall, a.wall) || (a.projectId < b.projectId ? -1 : a.projectId > b.projectId ? 1 : 0) || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  return items.slice(0, Math.max(0, limit));
}
