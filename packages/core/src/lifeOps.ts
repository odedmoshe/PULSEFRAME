/**
 * Operations of the life line (ADR-0021): capture dates of library files, events, and live fields of titles. Registered on
 * import of this module (packages/core/src/index.ts exports it); every one runs only through applyTransaction.
 *
 * The lead's contract fixes the operation names, versions, descriptions and argument schemas, the outputs (the *Output
 * types), and every refusal with its code, English wording and hint (LIFE_REFUSALS; the Hebrew wording is in
 * packages/i18n/src/lifeline.ts and packages/evals/src/lifeline-wording.test.ts keeps the two in step). The apply bodies
 * are W1's (wave 5).
 *
 * Rules of the bodies (plan §3, with the verifier's corrections, which win):
 * - Undo is the generic one: the store restores the before-states of the changed entities (asset, lifeEvent, clip, variant).
 *   No operation here needs an inverse, and none stores anything derived from a table (holiday names, resolved words), so an
 *   old operation log replays the same after the tables are corrected.
 * - Refuse only with lifeRefusal(...) (or the shared mustClip refusals for a missing clip or a locked track). Look ids up
 *   with Object.hasOwn (`eventId` and `assetId(s)` naming Object.prototype members are refused before apply by
 *   refuseInheritedIds). Read `d.events ?? {}`; write `(d.events ??= {})`.
 * - Ids: ctx.newId('evt'). createdBy: ctx.actor.
 * - What an argument schema lets through and the stored format cannot hold is refused by name, never committed (the store
 *   writes the document as it is, and a project the schema refuses does not open again; validateProject is only the net):
 *   · shift_asset_captures adds `minutes` to the file's stored total (capture.shiftedMinutes ?? 0). One step is at most
 *     MAX_SHIFT_STEP_MINUTES; the total may reach MAX_CAPTURE_SHIFT_MINUTES (schema.ts), which shifts that keep the date
 *     inside the years cannot pass. Refuse shiftTooFar when a total would pass it all the same (a document whose total does
 *     not match its date), after dateOutOfRange. set_asset_capture starts the total again: its result has no shiftedMinutes.
 *   · update_event refuses eventTooManyFiles when the event would END with more than MAX_EVENT_FILES files (counted after
 *     the call's own removals; a file it already holds is not counted twice). add_event cannot pass it: its list is capped.
 *     cluster_events never refuses for size: clusterCaptures (events.ts) cuts a longer run into consecutive clusters of
 *     at most MAX_EVENT_FILES.
 * - "Make it plain text" is NOT an operation: fields.ts freezeOps returns literal operations to commit.
 * - People (ADR-0021, people section, approved by the owner): their operations are in peopleOps.ts. set_text_fields turns
 *   live fields on for a title whose people fields name people of the project, and refuses (peopleOps.ts
 *   PEOPLE_REFUSALS.unknownPerson) when one names a person who is not there.
 */
import { z } from 'zod';
import { defineOp, mustClip, OpError, type OpErrorCode } from './ops.ts';
import { CAPTURE_MAX_YEAR, CAPTURE_MIN_YEAR, CaptureSchema, isRealWallDate, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS, WALL_DATE_TIME, type Asset, type Capture, type LifeEvent, type ProjectDocument } from './schema.ts';
import { addWallSeconds, captureOf, parseWall, shownCapture } from './capture.ts';
import { clusterCaptures, type DatedAsset } from './events.ts';
import { isPersonToken, parseFields } from './fields.ts';
import { personOf } from './people.ts';
import { peopleRefusal } from './peopleOps.ts';
import { isValidGregorian } from './hebrewCalendar.ts';

/**
 * True: the apply bodies below are built, so the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) draws the life-line
 * rows and gives its files capture dates. (It was false while the bodies were the lead's placeholders.)
 */
export const LIFE_OPS_BUILT = true;

// ---------- argument schemas ----------
const WallIn = z.string().regex(WALL_DATE_TIME).describe('YYYY-MM-DD (only the day is known) or YYYY-MM-DDTHH:MM:SS, on the wall clock of the place it was filmed; never a UTC instant');
const EventName = z.string().max(120).regex(/^[^\n\r]*$/).describe("one line; '' = no typed name (the event is shown by a derived holiday name, or by its date)");
export const SetAssetCaptureArgs = z.object({
  assetId: z.string(),
  capture: z.object({ at: WallIn, utcOffsetMinutes: z.number().int().min(-840).max(840).nullable().optional().describe('minutes east of UTC, when known; default null'), circa: z.boolean().optional().describe('true = an estimate') }).strict().nullable().describe('null removes the date'),
}).strict();
/** The most one shift_asset_captures call moves a clock by (ten years of 365 days). A file may be shifted again: its total is bounded by MAX_CAPTURE_SHIFT_MINUTES. */
export const MAX_SHIFT_STEP_MINUTES = 5256000;
export const ShiftAssetCapturesArgs = z.object({ assetIds: z.array(z.string()).min(1).max(500), minutes: z.number().int().min(-MAX_SHIFT_STEP_MINUTES).max(MAX_SHIFT_STEP_MINUTES).refine((m) => m !== 0, { message: 'minutes must not be 0' }).describe('how far to move the clock of these files; negative = earlier') }).strict();
export const AttachAssetCaptureArgs = z.object({ assetId: z.string(), capture: CaptureSchema, overwrite: z.boolean().optional() }).strict();
export const SetTextFieldsArgs = z.object({ clipId: z.string(), enabled: z.boolean() }).strict();
export const DEFAULT_EVENT_GAP_MINUTES = 240;
export const ClusterEventsArgs = z.object({ gapMinutes: z.number().int().min(30).max(1440).optional().describe(`a pause longer than this starts a new event; default ${DEFAULT_EVENT_GAP_MINUTES}`) }).strict();
export const AddEventArgs = z.object({ assetIds: z.array(z.string()).min(1).max(MAX_EVENT_FILES), name: EventName.optional() }).strict();
export const UpdateEventArgs = z.object({
  eventId: z.string(), name: EventName.optional(),
  afterSunset: z.boolean().nullable().optional().describe('true = filmed after sunset (the Hebrew date of the next day), false = before it, null = not decided'),
  addAssetIds: z.array(z.string()).max(MAX_EVENT_FILES).optional(), removeAssetIds: z.array(z.string()).max(MAX_EVENT_FILES).optional(),
}).strict();
export const RemoveEventArgs = z.object({ eventId: z.string() }).strict();

// ---------- outputs (OpResult.output) ----------
export interface SetAssetCaptureOutput { /** The date the file now has (source 'manual'), or null when it was removed. */ capture: Capture | null }
export interface ShiftAssetCapturesOutput { shifted: number }
export interface AttachAssetCaptureOutput { /** false = the file keeps the date it had (set or moved by hand, or read before and `overwrite` not given). */ attached: boolean }
export interface SetTextFieldsOutput { fields: boolean; /** The title's stored master text after the change. */ text: string }
export interface ClusterEventsOutput { /** Ids of new events. */ created: string[]; /** Ids of unedited events whose files did not change (they keep their id). */ kept: string[]; /** Ids of unedited events that were rebuilt away. */ removed: string[]; /** Pictures and videos without a date, left out. */ undated: number }
export interface AddEventOutput { eventId: string; /** Events emptied by moving their files here, and so removed. */ removedEventIds: string[] }
export interface UpdateEventOutput { /** Events emptied by moving their files here, and so removed. */ removedEventIds: string[] }

// ---------- refusals: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
const FIELD_LIST = '{date} {date:numeric} {date:monthYear} {date:long-en} {date:monthYear-en} {hebrewDate} {hebrewDate:noYear} {year} {hebrewYear} {event}; people of the project (add_person): {name:<personId>} {age:<personId>} {age:<personId>:words} {age:<personId>:en}';
/**
 * Every refusal of the life-line operations. The messages are fixed: the Hebrew table recognises them by their shape
 * (packages/i18n/src/lifeline.ts HE_LIFE), so a change here is a change there. Lists inside a message are joined with ", ".
 */
export const LIFE_REFUSALS = {
  assetNotFound: refusal('not_found', (assetId: string) => `asset ${assetId} not found`, 'get_summary lists the library files.'),
  eventNotFound: refusal('not_found', (eventId: string) => `event ${eventId} not found`, 'get_summary lists the events.'),
  // set_asset_capture, shift_asset_captures, attach_asset_capture
  lutHasNoDate: refusal('incompatible', () => 'a colour table (LUT) has no capture date'),
  noSuchDay: refusal('invalid_args', () => 'that day does not exist in the calendar', 'Give a real date, for example 2024-02-29.'),
  dateOutOfRange: refusal('out_of_bounds', () => `a capture date lies between ${CAPTURE_MIN_YEAR} and ${CAPTURE_MAX_YEAR}`),
  captureUnchanged: refusal('invalid_args', () => 'the file already has this capture date'),
  noCaptureToRemove: refusal('invalid_args', () => 'the file has no capture date of its own to remove'),
  listedTwice: refusal('invalid_args', () => 'a file is listed more than once'),
  shiftNoDate: refusal('incompatible', (files: number) => `${files} of the listed file(s) have no capture date`, 'Set their date first (set_asset_capture), or leave them out.'),
  shiftDayOnly: refusal('incompatible', (files: number) => `${files} of the listed file(s) have a date without a time, which moves by whole days only`, 'Shift by a multiple of 1440 minutes, or give those files a time first (set_asset_capture).'),
  shiftInherited: refusal('incompatible', (files: number) => `${files} of the listed file(s) take their date from the file they were made from`, 'Shift the source file instead.'),
  shiftTooFar: refusal('out_of_bounds', (files: number) => `${files} of the listed file(s) would have their clock moved by more than ${MAX_CAPTURE_SHIFT_MINUTES} minutes in all`, 'Set their date by hand instead (set_asset_capture).'),
  // set_text_fields
  notATitle: refusal('incompatible', () => 'only a title can hold live fields'),
  fieldsAlready: refusal('invalid_args', (on: boolean) => `live fields are already ${on ? 'on' : 'off'} for this title`),
  notFields: refusal('invalid_args', (groups: string) => `these brace groups are not fields: ${groups}`, `The fields are ${FIELD_LIST}. Write {{ and }} for braces that should be shown as they are.`),
  fieldsStillThere: refusal('incompatible', () => 'this title still holds fields, so turning live fields off would show their names instead of their values', 'Make it plain text first (commit the operations freezeOps returns; in the editor: "Make it plain text"), or delete the fields from the text.'),
  // events
  noDatedFiles: refusal('incompatible', () => 'no picture or video in the library has a capture date', 'Set capture dates first (set_asset_capture), or read them from the files (POST /api/v1/projects/{id}/captures/read).'),
  tooManyEvents: refusal('out_of_bounds', () => `a project holds at most ${MAX_LIFE_EVENTS} events`),
  eventFileKind: refusal('incompatible', () => 'an event holds pictures and videos only'),
  eventLastFile: refusal('incompatible', () => 'an event keeps at least one file', 'Remove the event instead (remove_event); its files stay in the library.'),
  eventTooManyFiles: refusal('out_of_bounds', () => `an event holds at most ${MAX_EVENT_FILES} files`, 'Put the rest in another event (add_event).'),
  eventNothingToChange: refusal('invalid_args', () => 'nothing to change: give name, afterSunset, addAssetIds or removeAssetIds'),
  eventFileNotIn: refusal('invalid_args', () => 'a file to remove is not in this event'),
  eventAddAndRemove: refusal('invalid_args', () => 'a file is listed both to add and to remove'),
} as const;
export type LifeRefusalKey = keyof typeof LIFE_REFUSALS;
/** The typed refusal of a life-line operation: `throw lifeRefusal('eventLastFile', { eventId })`; a message with a value takes it after the details. */
export function lifeRefusal<K extends LifeRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof LIFE_REFUSALS)[K]['message']>): OpError {
  const r = LIFE_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}

// ---------- helpers of the bodies ----------
/** The library file, by an own-property lookup. */
function mustAsset(d: ProjectDocument, assetId: string): Asset {
  if (!Object.hasOwn(d.assets, assetId)) throw lifeRefusal('assetNotFound', { assetId }, assetId);
  return d.assets[assetId]!;
}
function mustEvent(d: ProjectDocument, eventId: string): LifeEvent {
  const events = d.events ?? {};
  if (!Object.hasOwn(events, eventId)) throw lifeRefusal('eventNotFound', { eventId }, eventId);
  return events[eventId]!;
}
const isPicture = (a: Asset): boolean => a.kind === 'video' || a.kind === 'image';
const repeated = (ids: readonly string[]): string[] => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
const sameCapture = (a: Capture, b: Capture): boolean => a.at === b.at && a.utcOffsetMinutes === b.utcOffsetMinutes && a.source === b.source && a.circa === b.circa && a.assumedZone === b.assumedZone && a.shiftedMinutes === b.shiftedMinutes;
/** At most this many ids in the details of a refusal. */
const SOME = 50;
const shown = (name: string): string => name.slice(0, 60);
/** A wall-clock string as a sentence shows it: the day, and the time when there is one. */
const readable = (at: string): string => at.replace('T', ' ');
/**
 * Takes files out of the events they are in, except event `keep` (mutates the draft). An event left without files is
 * deleted; one that keeps files counts as edited by hand. Returns the ids of the changed and of the deleted events.
 */
function moveOut(d: ProjectDocument, assetIds: ReadonlySet<string>, keep: string | null): { changed: string[]; removed: string[] } {
  const changed: string[] = [], removed: string[] = [];
  for (const [key, e] of Object.entries(d.events ?? {})) {
    if (e.id === keep || !e.assetIds.some((id) => assetIds.has(id))) continue;
    e.assetIds = e.assetIds.filter((id) => !assetIds.has(id));
    if (e.assetIds.length === 0) { delete d.events[key]; removed.push(e.id); } else { e.origin.edited = true; changed.push(e.id); }
  }
  return { changed, removed };
}
/** The pictures and videos named for an event: each exists and is a picture or a video, none twice. */
function eventFiles(d: ProjectDocument, assetIds: readonly string[], details: Record<string, unknown>): void {
  const twice = repeated(assetIds);
  if (twice.length) throw lifeRefusal('listedTwice', { ...details, assetIds: twice.slice(0, SOME) });
  for (const id of assetIds) if (!isPicture(mustAsset(d, id))) throw lifeRefusal('eventFileKind', { ...details, assetId: id });
}

// ---------- capture dates ----------
defineOp({
  name: 'set_asset_capture',
  version: 1,
  description: 'Set, correct or remove the capture date of a library file by hand: the day, or the day and the time, on the wall clock of the place it was filmed. The result is marked as set by hand (source manual) and is never replaced by a later reading of the file. capture=null removes the date the file itself carries. Titles with fields and capture-sourced date stamps over clips of this file follow at once. A colour table (LUT) has no date.',
  args: SetAssetCaptureArgs,
  apply(d, a) {
    const asset = mustAsset(d, a.assetId);
    if (asset.kind === 'lut') throw lifeRefusal('lutHasNoDate', { assetId: asset.id });
    if (a.capture === null) {
      if (!asset.capture) throw lifeRefusal('noCaptureToRemove', { assetId: asset.id });
      delete asset.capture;
      return { affectedIds: [asset.id], summary: `Removed the capture date of "${shown(asset.name)}"`, output: { capture: null } satisfies SetAssetCaptureOutput };
    }
    if (!isValidGregorian(parseWall(a.capture.at).date)) throw lifeRefusal('noSuchDay', { assetId: asset.id, at: a.capture.at });
    if (!isRealWallDate(a.capture.at)) throw lifeRefusal('dateOutOfRange', { assetId: asset.id, at: a.capture.at });
    // set by hand: no assumed zone, and the total the clock was moved by starts again
    const capture: Capture = { at: a.capture.at, utcOffsetMinutes: a.capture.utcOffsetMinutes ?? null, source: 'manual', ...(a.capture.circa ? { circa: true as const } : {}) };
    if (asset.capture && sameCapture(asset.capture, capture)) throw lifeRefusal('captureUnchanged', { assetId: asset.id });
    asset.capture = capture;
    return { affectedIds: [asset.id], summary: `Capture date of "${shown(asset.name)}" set to ${readable(capture.at)}${capture.circa ? ' (an estimate)' : ''}`, output: { capture } satisfies SetAssetCaptureOutput };
  },
});
defineOp({
  name: 'shift_asset_captures',
  version: 1,
  description: 'Move the clock of several library files by the same number of minutes (a camera whose clock was wrong, or a trip to another time zone). All or nothing. Each file keeps where its date came from and remembers the total it was moved by, so a clock that is further out than one call reaches can be moved again. Refused when a listed file has no date of its own (or only takes one from the file it was made from), when a file with a day-only date is moved by anything but whole days (multiples of 1440), when a date would leave 1900–2100, and when a file\'s total would pass the length of those years.',
  args: ShiftAssetCapturesArgs,
  apply(d, a) {
    const twice = repeated(a.assetIds);
    if (twice.length) throw lifeRefusal('listedTwice', { assetIds: twice.slice(0, SOME) });
    const assets = a.assetIds.map((id) => mustAsset(d, id));
    const lut = assets.find((x) => x.kind === 'lut');
    if (lut) throw lifeRefusal('lutHasNoDate', { assetId: lut.id });
    const ids = (list: Asset[]) => ({ assetIds: list.map((x) => x.id).slice(0, SOME) });
    // a file without a date of its own: one that takes its date from its source is told so, the rest have none
    const inherited = assets.filter((x) => !x.capture && captureOf(d, x.id));
    const undated = assets.filter((x) => !x.capture && !inherited.includes(x));
    if (undated.length) throw lifeRefusal('shiftNoDate', ids(undated), undated.length);
    if (inherited.length) throw lifeRefusal('shiftInherited', ids(inherited), inherited.length);
    const dayOnly = a.minutes % 1440 === 0 ? [] : assets.filter((x) => parseWall(x.capture!.at).seconds === null);
    if (dayOnly.length) throw lifeRefusal('shiftDayOnly', ids(dayOnly), dayOnly.length);
    const moved = assets.map((x) => ({ asset: x, at: addWallSeconds(x.capture!.at, a.minutes * 60), total: (x.capture!.shiftedMinutes ?? 0) + a.minutes }));
    const out = moved.filter((m) => !isRealWallDate(m.at));
    if (out.length) throw lifeRefusal('dateOutOfRange', ids(out.map((m) => m.asset)));
    const far = moved.filter((m) => Math.abs(m.total) > MAX_CAPTURE_SHIFT_MINUTES);
    if (far.length) throw lifeRefusal('shiftTooFar', ids(far.map((m) => m.asset)), far.length);
    for (const m of moved) {
      const { shiftedMinutes: _before, ...rest } = m.asset.capture!;
      // a clock moved back to where it was is a clock that was not moved
      m.asset.capture = { ...rest, at: m.at, ...(m.total !== 0 ? { shiftedMinutes: m.total } : {}) };
    }
    return { affectedIds: assets.map((x) => x.id), summary: `Moved the clock of ${assets.length} file(s) by ${a.minutes} minutes`, output: { shifted: assets.length } satisfies ShiftAssetCapturesOutput };
  },
});
defineOp({
  name: 'attach_asset_capture',
  version: 1,
  internal: true,
  description: 'Attach a capture date the server read from a file\'s original bytes (the re-read route). Never replaces a date set or moved by hand; replaces a date read earlier only with overwrite. A file that keeps its date is not an error: the output says attached=false.',
  args: AttachAssetCaptureArgs,
  apply(d, a) {
    const asset = mustAsset(d, a.assetId);
    if (asset.kind === 'lut') throw lifeRefusal('lutHasNoDate', { assetId: asset.id });
    const cur = asset.capture;
    // a date a person set or moved is never replaced; one read earlier only when asked to; the same date again changes nothing
    const kept = !!cur && (cur.source === 'manual' || cur.shiftedMinutes !== undefined || !a.overwrite || sameCapture(cur, a.capture));
    if (kept) return { affectedIds: [], summary: `"${shown(asset.name)}" keeps its capture date`, output: { attached: false } satisfies AttachAssetCaptureOutput };
    asset.capture = a.capture;
    return { affectedIds: [asset.id], summary: `Capture date of "${shown(asset.name)}" read from the file: ${readable(a.capture.at)}`, output: { attached: true } satisfies AttachAssetCaptureOutput };
  },
});

// ---------- live fields of titles ----------
defineOp({
  name: 'set_text_fields',
  version: 1,
  description: `Turn live fields on or off for a title. On: brace groups in its text (and in each format's own wording) become fields that show the capture date of the picture under the title: ${FIELD_LIST}; {{ and }} are braces. Refused when a brace group is not a field or a brace has no pair, or when a people field names a person who is not in the project (the groups are listed), so double the braces of ordinary text first (update_text) in the same transaction. Off: refused while the text still holds a field (make it plain text with the operations freezeOps returns); otherwise {{ and }} are written back as single braces, so the picture does not change.`,
  args: SetTextFieldsArgs,
  apply(d, a) {
    const { clip } = mustClip(d, a.clipId);
    if (clip.type !== 'text') throw lifeRefusal('notATitle', { clipId: a.clipId });
    if (!!clip.fields === a.enabled) throw lifeRefusal('fieldsAlready', { clipId: clip.id }, a.enabled);
    // the title's own text and each format's own wording of it
    const wordings = Object.values(d.variants ?? {}).flatMap((v) => (Object.hasOwn(v.overrides, clip.id) && v.overrides[clip.id]!.text !== undefined ? [{ variant: v, parts: parseFields(v.overrides[clip.id]!.text!) }] : []));
    const master = parseFields(clip.text), all = [master, ...wordings.map((w) => w.parts)].flat();
    if (a.enabled) {
      const notFields = [...new Set(all.flatMap((p) => ('bad' in p ? [p.bad] : [])))];
      if (notFields.length) throw lifeRefusal('notFields', { clipId: clip.id, groups: notFields.slice(0, SOME) }, notFields.join(', '));
      // people fields (ADR-0021, people section): each must name a person of the project (an own-property lookup)
      const strangers = [...new Set(all.flatMap((p) => ('token' in p && isPersonToken(p.token) && !personOf(d, p.token.personId) ? [p.raw] : [])))];
      if (strangers.length) throw peopleRefusal('unknownPerson', { clipId: clip.id, groups: strangers.slice(0, SOME) }, strangers.join(', '));
      clip.fields = true;
      return { affectedIds: [clip.id], summary: `Live fields on for "${clip.text.slice(0, 40)}"`, output: { fields: true, text: clip.text } satisfies SetTextFieldsOutput };
    }
    if (all.some((p) => 'token' in p)) throw lifeRefusal('fieldsStillThere', { clipId: clip.id });
    // {{ and }} go back to single braces, so what is drawn does not change
    const plain = (parts: ReturnType<typeof parseFields>): string => parts.map((p) => ('literal' in p ? p.literal : 'bad' in p ? p.bad : p.raw)).join('');
    const affected = [clip.id];
    clip.text = plain(master);
    delete clip.fields;
    for (const w of wordings) {
      const text = plain(w.parts);
      if (text === w.variant.overrides[clip.id]!.text) continue;
      w.variant.overrides[clip.id]!.text = text;
      affected.push(w.variant.id);
    }
    return { affectedIds: affected, summary: `Live fields off for "${clip.text.slice(0, 40)}"`, output: { fields: false, text: clip.text } satisfies SetTextFieldsOutput };
  },
});

// ---------- events ----------
defineOp({
  name: 'cluster_events',
  version: 1,
  description: `Arrange the library's dated pictures and videos into events by time: a pause longer than gapMinutes (30–1440, default ${DEFAULT_EVENT_GAP_MINUTES}) starts a new event; files with only a day join that day's event. Events a person edited (renamed, files moved, the sunset question answered) are left exactly as they are, and their files are left out of the rebuilt ones; an untouched event whose files did not change keeps its id. An event holds at most ${MAX_EVENT_FILES} files, so a longer run without such a pause is cut into consecutive events. No name is stored: an event is shown by a holiday name derived from its dates, or by its date. Files without a date are left out and counted.`,
  args: ClusterEventsArgs,
  apply(d, a, ctx) {
    const gapMinutes = a.gapMinutes ?? DEFAULT_EVENT_GAP_MINUTES;
    const dated: DatedAsset[] = [];
    let undated = 0;
    for (const asset of Object.values(d.assets)) {
      if (!isPicture(asset)) continue;
      const wall = shownCapture(d, asset.id)?.wall;
      if (wall === undefined) undated++; else dated.push({ assetId: asset.id, wall });
    }
    if (dated.length === 0) throw lifeRefusal('noDatedFiles', {});
    const events = (d.events ??= {});
    // events a person edited stay exactly as they are, and their files are not regrouped
    const edited = Object.values(events).filter((e) => e.origin.edited), untouched = Object.values(events).filter((e) => !e.origin.edited);
    const taken = new Set(edited.flatMap((e) => e.assetIds));
    const regrouped = dated.filter((x) => !taken.has(x.assetId));
    const clusters = clusterCaptures(regrouped, gapMinutes);
    // an untouched event with the same files keeps its id
    const setKey = (ids: readonly string[]): string => [...ids].sort().join('\n');
    const before = new Map(untouched.map((e) => [setKey(e.assetIds), e]));
    const kept: string[] = [], created: string[] = [], changed: string[] = [];
    const fresh = clusters.filter((ids) => !before.has(setKey(ids)));
    if (edited.length + clusters.length > MAX_LIFE_EVENTS) throw lifeRefusal('tooManyEvents', { events: edited.length + clusters.length });
    const keptIds = new Set<string>();
    for (const ids of clusters) {
      const same = before.get(setKey(ids));
      if (!same) continue;
      kept.push(same.id);
      keptIds.add(same.id);
      // the same files, as this arrangement has them: in capture order, made by this gap
      if (same.assetIds.join('\n') !== ids.join('\n') || same.origin.method !== 'gap' || same.origin.gapMinutes !== gapMinutes) {
        same.assetIds = ids;
        same.origin = { ...same.origin, method: 'gap', gapMinutes };
        changed.push(same.id);
      }
    }
    const removed = untouched.filter((e) => !keptIds.has(e.id)).map((e) => e.id);
    for (const id of removed) delete events[id];
    for (const ids of fresh) {
      const id = ctx.newId('evt');
      events[id] = { id, name: '', afterSunset: null, assetIds: ids, origin: { method: 'gap', gapMinutes, createdBy: ctx.actor, edited: false } };
      created.push(id);
    }
    return {
      affectedIds: [...created, ...removed, ...changed],
      summary: `Arranged ${regrouped.length} dated file(s) into ${clusters.length} event(s) (${created.length} new, ${kept.length} kept, ${removed.length} removed); ${edited.length} edited event(s) left as they are`,
      output: { created, kept, removed, undated } satisfies ClusterEventsOutput,
    };
  },
});
defineOp({
  name: 'add_event',
  version: 1,
  description: `Group library pictures and videos (at most ${MAX_EVENT_FILES}) into a new event by hand, optionally with a name. A file that was in another event moves here (an event left without files is removed and listed in the output).`,
  args: AddEventArgs,
  apply(d, a, ctx) {
    eventFiles(d, a.assetIds, {});
    const { changed, removed } = moveOut(d, new Set(a.assetIds), null);
    const events = (d.events ??= {});
    if (Object.keys(events).length >= MAX_LIFE_EVENTS) throw lifeRefusal('tooManyEvents', {});
    const id = ctx.newId('evt');
    events[id] = { id, name: a.name ?? '', afterSunset: null, assetIds: [...a.assetIds], origin: { method: 'manual', gapMinutes: null, createdBy: ctx.actor, edited: true } };
    return { affectedIds: [id, ...changed, ...removed], summary: `New event${a.name ? ` "${shown(a.name)}"` : ''} with ${a.assetIds.length} file(s)`, output: { eventId: id, removedEventIds: removed } satisfies AddEventOutput };
  },
});
defineOp({
  name: 'update_event',
  version: 1,
  description: `Change an event: its name ('' = back to the derived name or the date), whether it was filmed after sunset (true = the Hebrew date of the next day; never guessed, null = not decided), and its files (added files leave the event they were in; an event left without files is removed and listed in the output; refused when the event would end with more than ${MAX_EVENT_FILES} files). The event then counts as edited by hand, so cluster_events leaves it alone.`,
  args: UpdateEventArgs,
  apply(d, a) {
    const event = mustEvent(d, a.eventId);
    const add = a.addAssetIds ?? [], remove = a.removeAssetIds ?? [];
    if (a.name === undefined && a.afterSunset === undefined && add.length === 0 && remove.length === 0) throw lifeRefusal('eventNothingToChange', { eventId: event.id });
    const twice = [...repeated(add), ...repeated(remove)];
    if (twice.length) throw lifeRefusal('listedTwice', { eventId: event.id, assetIds: twice.slice(0, SOME) });
    const both = add.filter((id) => remove.includes(id));
    if (both.length) throw lifeRefusal('eventAddAndRemove', { eventId: event.id, assetIds: both.slice(0, SOME) });
    const notIn = remove.filter((id) => !event.assetIds.includes(id));
    if (notIn.length) throw lifeRefusal('eventFileNotIn', { eventId: event.id, assetIds: notIn.slice(0, SOME) });
    eventFiles(d, add, { eventId: event.id });
    // the files the event ends with: its own without the removed ones, then the added ones it does not hold yet
    const stay = event.assetIds.filter((id) => !remove.includes(id));
    const files = [...stay, ...add.filter((id) => !stay.includes(id))];
    if (files.length === 0) throw lifeRefusal('eventLastFile', { eventId: event.id });
    if (files.length > MAX_EVENT_FILES) throw lifeRefusal('eventTooManyFiles', { eventId: event.id, files: files.length });
    const name = a.name ?? event.name, afterSunset = a.afterSunset === undefined ? event.afterSunset : a.afterSunset;
    if (name === event.name && afterSunset === event.afterSunset && files.join('\n') === event.assetIds.join('\n')) throw lifeRefusal('eventNothingToChange', { eventId: event.id });
    const { changed, removed } = moveOut(d, new Set(add), event.id);
    event.name = name;
    event.afterSunset = afterSunset;
    event.assetIds = files;
    event.origin.edited = true;
    return { affectedIds: [event.id, ...changed, ...removed], summary: `Changed event${event.name ? ` "${shown(event.name)}"` : ''}: ${files.length} file(s)`, output: { removedEventIds: removed } satisfies UpdateEventOutput };
  },
});
defineOp({
  name: 'remove_event',
  version: 1,
  description: 'Remove an event: the grouping only. Its files stay in the library with their dates.',
  args: RemoveEventArgs,
  apply(d, a) {
    const event = mustEvent(d, a.eventId);
    delete d.events[event.id];
    return { affectedIds: [event.id], summary: `Removed the event${event.name ? ` "${shown(event.name)}"` : ''}; its ${event.assetIds.length} file(s) stay in the library` };
  },
});
