/**
 * Operations of the life line (ADR-0021): capture dates of library files, events, and live fields of titles. Registered on
 * import of this module (packages/core/src/index.ts exports it); every one runs only through applyTransaction.
 *
 * CONTRACT FILE (lead pre-pass). Fixed here: the operation names, versions, descriptions and argument schemas, the outputs
 * (the *Output types), and every refusal with its code, English wording and hint (LIFE_REFUSALS; the Hebrew wording is in
 * packages/i18n/src/lifeline.ts and packages/evals/src/lifeline-wording.test.ts keeps the two in step). The apply bodies are
 * W1's: until they land every operation here refuses with "not built yet" and changes nothing.
 *
 * Rules for the bodies (plan §3, with the verifier's corrections, which win):
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
 * - People (add_person, update_person, remove_person, {age}, {name}) are NOT part of this build: they wait for the owner.
 */
import { z } from 'zod';
import { defineOp, OpError, type OpErrorCode, type OpResult } from './ops.ts';
import { CAPTURE_MAX_YEAR, CAPTURE_MIN_YEAR, CaptureSchema, MAX_CAPTURE_SHIFT_MINUTES, MAX_EVENT_FILES, MAX_LIFE_EVENTS, WALL_DATE_TIME, type Capture } from './schema.ts';

/**
 * False while the apply bodies below are the lead's placeholders. W1 sets it to true in the commit that lands the bodies;
 * the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the life-line rows and gives its files capture dates.
 */
export const LIFE_OPS_BUILT = false;

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
const FIELD_LIST = '{date} {date:numeric} {date:monthYear} {date:long-en} {date:monthYear-en} {hebrewDate} {hebrewDate:noYear} {year} {hebrewYear} {event}';
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
  personFields: refusal('invalid_args', (groups: string) => `these fields name a person, and this project holds no people: ${groups}`, 'People are not part of this build. Remove those fields from the text.'),
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

/** The lead's placeholder body: an honest refusal that changes nothing. W1 replaces every use and deletes this. */
const notBuilt = (op: string): OpResult => { throw new OpError('incompatible', `life line: ${op} is not built yet`, { op }); };

// ---------- capture dates ----------
defineOp({
  name: 'set_asset_capture',
  version: 1,
  description: 'Set, correct or remove the capture date of a library file by hand: the day, or the day and the time, on the wall clock of the place it was filmed. The result is marked as set by hand (source manual) and is never replaced by a later reading of the file. capture=null removes the date the file itself carries. Titles with fields and capture-sourced date stamps over clips of this file follow at once. A colour table (LUT) has no date.',
  args: SetAssetCaptureArgs,
  apply: () => notBuilt('set_asset_capture'),
});
defineOp({
  name: 'shift_asset_captures',
  version: 1,
  description: 'Move the clock of several library files by the same number of minutes (a camera whose clock was wrong, or a trip to another time zone). All or nothing. Each file keeps where its date came from and remembers the total it was moved by, so a clock that is further out than one call reaches can be moved again. Refused when a listed file has no date of its own (or only takes one from the file it was made from), when a file with a day-only date is moved by anything but whole days (multiples of 1440), when a date would leave 1900–2100, and when a file\'s total would pass the length of those years.',
  args: ShiftAssetCapturesArgs,
  apply: () => notBuilt('shift_asset_captures'),
});
defineOp({
  name: 'attach_asset_capture',
  version: 1,
  internal: true,
  description: 'Attach a capture date the server read from a file\'s original bytes (the re-read route). Never replaces a date set or moved by hand; replaces a date read earlier only with overwrite. A file that keeps its date is not an error: the output says attached=false.',
  args: AttachAssetCaptureArgs,
  apply: () => notBuilt('attach_asset_capture'),
});

// ---------- live fields of titles ----------
defineOp({
  name: 'set_text_fields',
  version: 1,
  description: `Turn live fields on or off for a title. On: brace groups in its text (and in each format's own wording) become fields that show the capture date of the picture under the title: ${FIELD_LIST}; {{ and }} are braces. Refused when a brace group is not a field or a brace has no pair (the groups are listed), so double the braces of ordinary text first (update_text) in the same transaction. Off: refused while the text still holds a field (make it plain text with the operations freezeOps returns); otherwise {{ and }} are written back as single braces, so the picture does not change.`,
  args: SetTextFieldsArgs,
  apply: () => notBuilt('set_text_fields'),
});

// ---------- events ----------
defineOp({
  name: 'cluster_events',
  version: 1,
  description: `Arrange the library's dated pictures and videos into events by time: a pause longer than gapMinutes (30–1440, default ${DEFAULT_EVENT_GAP_MINUTES}) starts a new event; files with only a day join that day's event. Events a person edited (renamed, files moved, the sunset question answered) are left exactly as they are, and their files are left out of the rebuilt ones; an untouched event whose files did not change keeps its id. An event holds at most ${MAX_EVENT_FILES} files, so a longer run without such a pause is cut into consecutive events. No name is stored: an event is shown by a holiday name derived from its dates, or by its date. Files without a date are left out and counted.`,
  args: ClusterEventsArgs,
  apply: () => notBuilt('cluster_events'),
});
defineOp({
  name: 'add_event',
  version: 1,
  description: `Group library pictures and videos (at most ${MAX_EVENT_FILES}) into a new event by hand, optionally with a name. A file that was in another event moves here (an event left without files is removed and listed in the output).`,
  args: AddEventArgs,
  apply: () => notBuilt('add_event'),
});
defineOp({
  name: 'update_event',
  version: 1,
  description: `Change an event: its name ('' = back to the derived name or the date), whether it was filmed after sunset (true = the Hebrew date of the next day; never guessed, null = not decided), and its files (added files leave the event they were in; an event left without files is removed and listed in the output; refused when the event would end with more than ${MAX_EVENT_FILES} files). The event then counts as edited by hand, so cluster_events leaves it alone.`,
  args: UpdateEventArgs,
  apply: () => notBuilt('update_event'),
});
defineOp({
  name: 'remove_event',
  version: 1,
  description: 'Remove an event: the grouping only. Its files stay in the library with their dates.',
  args: RemoveEventArgs,
  apply: () => notBuilt('remove_event'),
});
