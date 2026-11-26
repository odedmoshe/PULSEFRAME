/**
 * What the library views of the life line decide (ADR-0021; plan §7), kept apart from the components so it can be tested
 * without a browser: the view choice and its storage, the month headers, the date badge, the live echo of a typed date,
 * the rows of events with their names and sunset choices, the operations behind "add the event to the timeline" and the
 * clock shift. Pure functions of the document; no Date, no Intl (calendar arithmetic is core's own).
 */
import * as T from '@pulseframe/time';
import {
  CAPTURE_MAX_YEAR, CAPTURE_MIN_YEAR, MAX_SHIFT_STEP_MINUTES, calendarGroups, captureOf, eventCandidates, eventDisplayName, eventNeedsSunsetAnswer, eventSpan, formatHebrewDate, hebrewDayReadings, hebrewFromRd,
  isRealWallDate, parseWall, rdFromGregorian, shownCapture, weekdayOf, compareWall,
  type Capture, type LifeEvent, type OpCall, type ProjectDocument,
} from '@pulseframe/core';
import { addAssetArgs, addedClipDuration } from '../placement.ts';

type Lang = 'he' | 'en';

// ---------------------------------------------------------------- the view choice
/** 'pearls' (wave 7 pearls track): the «פנינים» view, offered only once its list is built (pearls/PearlsList.tsx PEARLS_UI_BUILT). */
export const LIFE_VIEWS = ['all', 'date', 'events', 'pearls'] as const;
export type LifeView = (typeof LIFE_VIEWS)[number];
/** Where the chosen view is remembered (browser storage; nothing else of the life line is kept there). */
export const LIFE_VIEW_STORAGE_KEY = 'pf.life.view';
export const parseLifeView = (raw: unknown): LifeView => ((LIFE_VIEWS as readonly unknown[]).includes(raw) ? (raw as LifeView) : 'all');
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }
const safeStorage = (): StorageLike | null => { try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; } };
export function readLifeView(store: StorageLike | null = safeStorage()): LifeView {
  try { return parseLifeView(store?.getItem(LIFE_VIEW_STORAGE_KEY)); } catch { return 'all'; }
}
/** Whether it could be kept (false: the view then lasts for this visit only). */
export function writeLifeView(view: LifeView, store: StorageLike | null = safeStorage()): boolean {
  try { if (!store) return false; store.setItem(LIFE_VIEW_STORAGE_KEY, view); return true; } catch { return false; }
}

// ---------------------------------------------------------------- words
const WEEKDAYS = {
  he: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'יום שבת'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
} as const;
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'] as const;
/** «מרץ 2024 · אדר ב׳ תשפ״ד» (the Hebrew month and year beside the civil month; both in either language). */
export const monthLabel = (lang: Lang, year: number, month: number, hebrew: string): { civil: string; hebrew: string } => ({ civil: `${(lang === 'he' ? MONTHS_HE : MONTHS_EN)[month - 1]} ${year}`, hebrew });
/** `15.3.24`: the badge of a media card (day, month, two-digit year; no zero padding on day and month). */
export function badgeText(wall: string): string {
  const { date } = parseWall(wall);
  return `${date.d}.${date.m}.${String(date.y % 100).padStart(2, '0')}`;
}
/** The day as a label: `15.3.2024`. */
export function dayText(wall: string): string { const { date } = parseWall(wall); return `${date.d}.${date.m}.${date.y}`; }
/** The time of a wall string as `18:15`, or null when only the day is known. */
export function timeText(wall: string): string | null {
  const { seconds } = parseWall(wall);
  return seconds === null ? null : `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- the date badge of a media card
export interface BadgeInfo { text: string; circa: boolean; inherited: boolean; source: Capture['source']; wall: string }
/** What a file's date badge shows, or null for a file without a date (nothing is drawn). Pictures and videos only. */
export function badgeOf(doc: ProjectDocument, assetId: string): BadgeInfo | null {
  const a = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
  if (!a || (a.kind !== 'video' && a.kind !== 'image')) return null;
  const shown = shownCapture(doc, assetId);
  if (!shown) return null;
  return { text: badgeText(shown.wall), circa: shown.capture.circa === true, inherited: shown.inherited, source: shown.capture.source, wall: shown.wall };
}

// ---------------------------------------------------------------- the capture date popover
/** The Hebrew date(s) of a wall moment, in words: one reading, or two joined with « או » while the sunset leaves it open. */
export function hebrewOfWall(wall: string, afterSunset: boolean | null = null, capture: Capture = { at: wall, utcOffsetMinutes: null, source: 'manual' }): string[] {
  return hebrewDayReadings(capture, wall, afterSunset).map((r) => formatHebrewDate(hebrewFromRd(r.rd)));
}
/** «יום רביעי · כ״ד בכסלו תשפ״ה» (or two Hebrew dates when the time falls in the sunset window), or null for no real day. */
export function captureEcho(lang: Lang, at: string): string | null {
  if (!isRealWallDate(at)) return null;
  const w = parseWall(at), rd = rdFromGregorian(w.date);
  const he = hebrewOfWall(at, null);
  const joiner = lang === 'he' ? ' או ' : ' or ';
  return `${WEEKDAYS[lang][weekdayOf(rd)]} · ${he.join(joiner)}`;
}
export type CaptureInput = { date: string; time: string; circa: boolean };
export type CaptureParsed = { ok: true; at: string; circa: boolean } | { ok: false; reason: 'empty' | 'bad_day' | 'bad_time' | 'out_of_range' };
/** The date and time of the popover's inputs as the stored wall string. A time needs a day; seconds are not asked for. */
export function parseCaptureInput(i: CaptureInput): CaptureParsed {
  const date = i.date.trim(), time = i.time.trim();
  if (!date) return { ok: false, reason: 'empty' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, reason: 'bad_day' };
  const y = Number(date.slice(0, 4));
  if (y < CAPTURE_MIN_YEAR || y > CAPTURE_MAX_YEAR) return { ok: false, reason: 'out_of_range' };
  if (time && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) return { ok: false, reason: 'bad_time' };
  const at = time ? `${date}T${time.length === 5 ? `${time}:00` : time}` : date;
  return isRealWallDate(at) ? { ok: true, at, circa: i.circa } : { ok: false, reason: 'bad_day' };
}
/** The inputs of the popover for a file: its own capture (a date inherited from the source file is shown but not editable here). */
export function captureInputOf(doc: ProjectDocument, assetId: string): { date: string; time: string; circa: boolean; inherited: boolean; hasOwn: boolean; source: Capture['source'] | null; assumedZone: string | null } {
  const own = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]!.capture : undefined;
  const shown = shownCapture(doc, assetId);
  const at = shown?.wall ?? '';
  return { date: at.slice(0, 10), time: at.length > 10 ? at.slice(11, 16) : '', circa: shown?.capture.circa === true, inherited: !!shown?.inherited, hasOwn: !!own, source: shown?.capture.source ?? null, assumedZone: shown?.capture.assumedZone ?? null };
}
/**
 * The operation of the popover's save: set_asset_capture with the typed day. When the typed day and minute are the file's own
 * capture (the person only ticked or cleared «משוער»), the file's seconds and stated UTC offset are kept; a changed day or time
 * has no stated offset (null). The op marks the result as set by hand either way.
 */
export const saveCaptureOp = (assetId: string, p: { at: string; circa: boolean }, own?: Pick<Capture, 'at' | 'utcOffsetMinutes'> | null): OpCall => {
  const same = !!own && (own.at.length > 10 ? own.at.slice(0, 16) : own.at) === (p.at.length > 10 ? p.at.slice(0, 16) : p.at);
  const at = same ? own!.at : p.at;
  return { op: 'set_asset_capture', args: { assetId, capture: { at, utcOffsetMinutes: same ? own!.utcOffsetMinutes : null, ...(p.circa ? { circa: true } : {}) } } };
};
export const removeCaptureOp = (assetId: string): OpCall => ({ op: 'set_asset_capture', args: { assetId, capture: null } });

// ---------------------------------------------------------------- the library by date
export interface MonthGroup { year: number; month: number; hebrew: string; assetIds: string[] }
export interface YearGroup { year: number; count: number; months: MonthGroup[] }
/** Years newest first, months newest first inside each (core calendarGroups), with counts; the files without a date apart. */
export function dateGroups(doc: ProjectDocument): { years: YearGroup[]; undated: string[]; dated: number } {
  const g = calendarGroups(doc);
  const years = g.years.map((y) => ({ year: y.year, count: y.months.reduce((n, m) => n + m.assetIds.length, 0), months: y.months.map((m) => ({ year: y.year, month: m.month, hebrew: m.hebrew, assetIds: m.assetIds })) }));
  return { years, undated: g.undated, dated: years.reduce((n, y) => n + y.count, 0) };
}

// ---------------------------------------------------------------- events
export interface EventModel {
  id: string; event: LifeEvent; name: string; nameKind: 'manual' | 'holiday' | 'none'; count: number; first: string | null; last: string | null;
  /** «15.3.24» or «15.3.24 – 17.3.24»; null when no file of the event has a date */
  dateLabel: string | null; hebrewLabel: string | null;
}
export function eventModel(doc: ProjectDocument, event: LifeEvent, lang: Lang): EventModel {
  const span = eventSpan(doc, event);
  const d = eventDisplayName(doc, event, lang);
  const dateLabel = span ? (span.first.slice(0, 10) === span.last.slice(0, 10) ? badgeText(span.first) : `${badgeText(span.first)} – ${badgeText(span.last)}`) : null;
  let hebrewLabel: string | null = null;
  if (span) {
    const shown = event.assetIds.map((id) => shownCapture(doc, id)).filter((s): s is NonNullable<typeof s> => !!s).sort((a, b) => compareWall(a.wall, b.wall))[0];
    const first = shown ? hebrewOfWall(shown.wall, event.afterSunset, shown.capture) : [];
    // two readings are not shown as a date: the radio group below asks first (never a guessed Hebrew date)
    hebrewLabel = first.length === 1 ? first[0]! : null;
  }
  return { id: event.id, event, name: d.name, nameKind: d.kind, count: event.assetIds.length, first: span?.first ?? null, last: span?.last ?? null, dateLabel, hebrewLabel };
}
/** Events newest first (by the last file), the ones without any date at the end; ties by id. */
export function eventModels(doc: ProjectDocument, lang: Lang): EventModel[] {
  return Object.values(doc.events ?? {}).map((e) => eventModel(doc, e, lang)).sort((a, b) => {
    if (a.last === null || b.last === null) return a.last === b.last ? (a.id < b.id ? -1 : 1) : a.last === null ? 1 : -1;
    return compareWall(b.last, a.last) || (a.id < b.id ? -1 : 1);
  });
}
/** The heading of an event row: its name, else its date (the Hebrew date follows beside it). */
export const eventHeading = (m: EventModel, untitled: string): string => m.name || m.dateLabel || untitled;
export interface SunsetChoice { value: boolean; label: string }
/**
 * The before / after sunset question of an event, or null when no file of it depends on the answer. Each radio says what the
 * answer would call the event when it leads to a holiday («לפני השקיעה — ערב חנוכה»). Never preselected: `selected` is the
 * stored answer, null until the person answers.
 */
export function sunsetChoices(doc: ProjectDocument, event: LifeEvent, lang: Lang, words: { before: string; after: string }): { selected: boolean | null; choices: [SunsetChoice, SunsetChoice] } | null {
  if (!eventNeedsSunsetAnswer(doc, event)) return null;
  const cand = eventCandidates(doc, event, lang);
  const of = (value: boolean): SunsetChoice => {
    const hit = cand.find((c) => c.afterSunset === value) ?? cand.find((c) => c.afterSunset === null);
    const base = value ? words.after : words.before;
    return { value, label: hit ? `${base} — ${hit.name}` : base };
  };
  return { selected: event.afterSunset, choices: [of(false), of(true)] };
}

/** How many pictures and videos with a date the library holds while no event exists: the card «נמצאו 42 קבצים עם תאריך» (0 = no card). */
export function clusterNudgeCount(doc: ProjectDocument): number {
  if (Object.keys(doc.events ?? {}).length > 0) return 0;
  return Object.values(doc.assets).filter((a) => (a.kind === 'video' || a.kind === 'image') && captureOf(doc, a.id) !== null).length;
}

// ---------------------------------------------------------------- add an event to the timeline (one transaction of add_clip)
/** The files of an event in capture order (undated ones last, by id), existing pictures and videos only. */
export function eventFilesInOrder(doc: ProjectDocument, event: LifeEvent): string[] {
  const key = (id: string) => shownCapture(doc, id)?.wall ?? null;
  return event.assetIds.filter((id) => Object.hasOwn(doc.assets, id) && (doc.assets[id]!.kind === 'video' || doc.assets[id]!.kind === 'image')).sort((a, b) => {
    const x = key(a), y = key(b);
    if (x === null || y === null) return x === y ? (a < b ? -1 : 1) : x === null ? 1 : -1;
    return compareWall(x, y) || (a < b ? -1 : 1);
  });
}
/**
 * The add_clip operations that place an event's files one after another from `appendPoint`, in capture order. One call to
 * Editor.commit makes one transaction, so one undo takes the whole event off again. Each picture starts where the previous
 * ended (placement.ts addedClipDuration is the length add_clip itself gives it); sound lands on a free sound track.
 */
export function addEventOps(doc: ProjectDocument, event: LifeEvent, p: { appendPoint: T.RationalTime; playhead: T.RationalTime; videoTarget: string | null }): OpCall[] {
  const rate = doc.settings.frameRate;
  let start = p.appendPoint;
  const ops: OpCall[] = [];
  for (const id of eventFilesInOrder(doc, event)) {
    ops.push({ op: 'add_clip', args: addAssetArgs(doc, id, { appendPoint: start, playhead: p.playhead, videoTarget: p.videoTarget, audioTarget: null }) });
    start = T.snapToFrame(T.add(start, addedClipDuration(doc.assets[id]!, rate)), rate);
  }
  return ops;
}

// ---------------------------------------------------------------- the event actions of the ⋯ menu
/** The event before this one in capture order (what «מיזוג עם הקודם» joins), or null for the first. */
export function previousEvent(doc: ProjectDocument, eventId: string, lang: Lang): LifeEvent | null {
  const chrono = eventModels(doc, lang).reverse();
  const i = chrono.findIndex((m) => m.id === eventId);
  return i > 0 ? chrono[i - 1]!.event : null;
}
/** Merge with the previous: the files of this event go to the previous one (update_event addAssetIds), which empties and removes this one. */
export function mergePreviousOps(doc: ProjectDocument, eventId: string, lang: Lang): OpCall[] | null {
  const prev = previousEvent(doc, eventId, lang);
  const ev = Object.hasOwn(doc.events ?? {}, eventId) ? doc.events[eventId]! : null;
  return prev && ev ? [{ op: 'update_event', args: { eventId: prev.id, addAssetIds: [...ev.assetIds] } }] : null;
}
/**
 * Split from a file on: the files taken at or after it become a new event (add_event moves them; the old event keeps the
 * earlier ones). null when the file is the first one of the event (nothing would stay behind).
 */
export function splitOps(doc: ProjectDocument, eventId: string, fromAssetId: string): OpCall[] | null {
  const ev = Object.hasOwn(doc.events ?? {}, eventId) ? doc.events[eventId]! : null;
  if (!ev) return null;
  const order = eventFilesInOrder(doc, ev);
  const at = order.indexOf(fromAssetId);
  if (at <= 0) return null;
  return [{ op: 'add_event', args: { assetIds: order.slice(at) } }];
}

// ---------------------------------------------------------------- the clock shift of several files
export type ShiftBlock = 'no_date' | 'inherited' | 'day_only';
/** Which of the files can be shifted (they have a date of their own with a time), and why the others cannot. */
export function shiftability(doc: ProjectDocument, assetIds: readonly string[]): { ok: string[]; blocked: Record<string, ShiftBlock> } {
  const ok: string[] = [], blocked: Record<string, ShiftBlock> = {};
  for (const id of assetIds) {
    const c = Object.hasOwn(doc.assets, id) ? captureOf(doc, id) : null;
    if (!c) blocked[id] = 'no_date';
    else if (c.inherited) blocked[id] = 'inherited';
    else if (!c.capture.at.includes('T')) blocked[id] = 'day_only';
    else ok.push(id);
  }
  return { ok, blocked };
}
/** The signed minutes of the shift form (days, hours, minutes; direction), or null when it is zero or too large for one step. */
export function shiftMinutes(i: { days: number; hours: number; minutes: number; later: boolean }): number | null {
  const parts = [i.days, i.hours, i.minutes];
  if (!parts.every((n) => Number.isInteger(n) && n >= 0)) return null;
  const total = i.days * 1440 + i.hours * 60 + i.minutes;
  if (total === 0 || total > MAX_SHIFT_STEP_MINUTES) return null;
  return i.later ? total : -total;
}
export const shiftOp = (assetIds: readonly string[], minutes: number): OpCall => ({ op: 'shift_asset_captures', args: { assetIds: [...assetIds], minutes } });
