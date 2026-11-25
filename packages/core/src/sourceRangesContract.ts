/**
 * Marked source ranges — «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md, binding over pearls-plan.md). LEAD
 * CONTRACT: names, limits, argument schemas, outputs, every refusal with its code, fixed English and hint, the summaries, and the
 * shapes of usage, screen time and the read view. The Hebrew of every refusal is packages/i18n/src/pearls.ts HE_PEARLS, kept in step
 * by packages/evals/src/pearls-wording.test.ts. Builders import this file; they do not edit it.
 *
 * WHAT A RANGE IS: a stretch of SOURCE time [start, end) of one library file (span null = the whole file), schema.ts
 * SourceRangeSchema. Kind `pearl`: a moment the owner keeps, with a name. Kind `presence`: «מי בקליפ?», who is in the file, no name.
 * Times are exact rationals of any alignment; nothing is rounded when stored. Nothing derived is stored.
 *
 * WHO MAY DO WHAT (apps/server/src/peoplePrivacy.ts, landed with this contract):
 *  - only the owner's own session tags people (any `people` argument, kind presence, a change to a range that holds people, and
 *    remove_person of a tagged person are refused 403 human_tag_required for every other credential, people 'full' grants included);
 *  - a label can hold a child's words, so it is read like a birth date: a credential without the people scope reads '' and may not
 *    give a label (403 people_scope_required); summaries never hold a label (they name the file).
 *  - the language assistant neither reads nor proposes ranges (assistantContract.ts ASSISTANT_EXCLUDED_OPS).
 */
import { z } from 'zod';
import type * as T from '@pulseframe/time';
import { OpError, type OpErrorCode } from './ops.ts';
import { RationalTimeSchema } from './keyframe.ts';
import type { SourceSpan } from './schema.ts';

export const RANGE_KINDS = ['pearl', 'presence'] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];
/** A project holds at most this many marked ranges (about 250 bytes each: the document stays under 0.5 MB of them). */
export const MAX_SOURCE_RANGES = 2000;
export const MAX_RANGE_PEOPLE = 12;
export const MAX_RANGE_LABEL = 200;
/** ctx.newId prefix of a range id. */
export const RANGE_ID_PREFIX = 'rng';
/** Entity code of validateProject issues about ranges (sourceRanges.ts validateSourceRanges). */
export const SOURCE_RANGE_ISSUE = 'source_range';
/** The three public operations. Excluded from the language assistant (assistantContract.ts). */
export const SOURCE_RANGE_OPS = ['add_source_range', 'update_source_range', 'remove_source_range'] as const;

// ---------- arguments ----------
export const AddSourceRangeArgsSchema = z.object({
  assetId: z.string().describe('A video, sound or picture file of the library'),
  kind: z.enum(RANGE_KINDS).optional().describe('pearl (default): a moment worth keeping, with a name; presence: who is in the whole file, people only, no name'),
  start: RationalTimeSchema.optional().describe('SOURCE time where the range starts; give start and end together, or neither for the whole file (a photo is always whole)'),
  end: RationalTimeSchema.optional().describe('SOURCE time where the range ends (exclusive)'),
  label: z.string().max(MAX_RANGE_LABEL).optional().describe('The name, one line; empty = not named yet. Only credentials with the people scope may give one'),
  people: z.array(z.string()).max(MAX_RANGE_PEOPLE).optional().describe('Person ids tagged on the range. Only the project owner\'s own session may tag people'),
}).strict();
export type AddSourceRangeArgs = z.infer<typeof AddSourceRangeArgsSchema>;
export const UpdateSourceRangeArgsSchema = z.object({
  rangeId: z.string(),
  start: RationalTimeSchema.optional(), end: RationalTimeSchema.optional(),
  whole: z.literal(true).optional().describe('Mark the whole file instead of a stretch'),
  label: z.string().max(MAX_RANGE_LABEL).optional(),
  people: z.array(z.string()).max(MAX_RANGE_PEOPLE).optional().describe('The full new list; [] clears it (owner only)'),
}).strict();
export type UpdateSourceRangeArgs = z.infer<typeof UpdateSourceRangeArgsSchema>;
export const RemoveSourceRangeArgsSchema = z.object({ rangeId: z.string() }).strict();
export type RemoveSourceRangeArgs = z.infer<typeof RemoveSourceRangeArgsSchema>;
export interface AddSourceRangeOutput { rangeId: string }

// ---------- refusals: code, English wording (fixed) and hint ----------
interface Refusal<A extends unknown[]> { code: OpErrorCode; message: (...a: A) => string; hint?: string }
const refusal = <A extends unknown[]>(code: OpErrorCode, message: (...a: A) => string, hint?: string): Refusal<A> => ({ code, message, ...(hint ? { hint } : {}) });
/**
 * Every refusal of the three operations, IN THE ORDER the bodies check them (add: assetNotFound, rangeNoTime, rangeHalfSpan,
 * rangeStillSpan, rangeBounds, rangeLabelLine, presenceNeedsPeople, rangePersonNotFound, rangeDuplicate, tooManyRanges; update:
 * rangeNotFound, rangeNothingToChange, rangeWholeAndSpan, rangeHalfSpan, then as add for what is given, then rangeUnchanged; remove:
 * rangeNotFound). Messages are fixed: the Hebrew table recognises them by their shape. No message holds a label or a person's details.
 */
export const SOURCE_RANGE_REFUSALS = {
  notBuilt: refusal('unknown_op', (op: string) => `${op}: marked ranges are not built in this build yet`, 'Update the editor and try again.'),
  assetNotFound: refusal('not_found', (assetId: string) => `there is no file ${assetId} to mark in the library of this project`, 'get_summary lists the files of the project.'),
  rangeNoTime: refusal('incompatible', () => 'a colour table has no time to mark', 'Mark a video, a sound or a photo.'),
  rangeHalfSpan: refusal('invalid_args', () => 'give both start and end, or neither for the whole file'),
  rangeWholeAndSpan: refusal('invalid_args', () => 'give either whole or start and end, not both'),
  rangeStillSpan: refusal('invalid_args', () => 'a photo is marked whole; give no start and end'),
  rangeBounds: refusal('out_of_bounds', (seconds: string) => `a range starts at 0 or later, ends after it starts and ends inside the file (${seconds} s)`),
  rangeLabelLine: refusal('invalid_args', () => 'the name of a marked range is one line'),
  presenceNeedsPeople: refusal('invalid_args', () => 'a "who is in it" tag needs at least one person and has no name'),
  rangePersonNotFound: refusal('not_found', (personId: string) => `person ${personId} is not in this project`, 'get_summary lists the people of the project.'),
  rangeDuplicate: refusal('incompatible', () => 'this file already has the same stretch marked', 'Change the marked range that is there (update_source_range).'),
  tooManyRanges: refusal('out_of_bounds', () => `a project holds at most ${MAX_SOURCE_RANGES} marked ranges`, 'Remove marked ranges that are no longer needed.'),
  rangeNotFound: refusal('not_found', (rangeId: string) => `marked range ${rangeId} not found`, 'GET …/pearls (MCP get_pearls) lists the marked ranges.'),
  rangeNothingToChange: refusal('invalid_args', () => 'nothing to change: give start and end, whole, label or people'),
  rangeUnchanged: refusal('invalid_args', () => 'the marked range already has these details'),
} as const;
export type SourceRangeRefusalKey = keyof typeof SOURCE_RANGE_REFUSALS;
/** The typed refusal: `throw rangeRefusal('rangeBounds', { rangeId }, '12.4')`. Details hold ids only, never a label. */
export function rangeRefusal<K extends SourceRangeRefusalKey>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof SOURCE_RANGE_REFUSALS)[K]['message']>): OpError {
  const r = SOURCE_RANGE_REFUSALS[key] as Refusal<unknown[]>;
  return new OpError(r.code, r.message(...values), details, r.hint);
}
/**
 * The summaries (history and events are readable by every credential): the FILE's name, cut to 60 characters, never the label and
 * never a person. remove_person appends `untagged(n)` to its own summary only when n > 0.
 */
export const SOURCE_RANGE_SUMMARIES = {
  pearl: (file: string) => `Marked a pearl in "${file.slice(0, 60)}"`,
  presence: (file: string) => `Tagged who is in "${file.slice(0, 60)}"`,
  changed: (file: string) => `Changed a marked range in "${file.slice(0, 60)}"`,
  removed: (file: string) => `Removed a marked range from "${file.slice(0, 60)}"`,
  untagged: (n: number) => `; untagged from ${n} marked range(s)`,
} as const;

// ---------- usage (sourceRanges.ts rangeUsage; decisions §2.5 = verifier C6) ----------
/**
 * One clip that shows (picture) or plays (sound) part of a range. Frames are project frames of the clip's sequence, [fromFrame,
 * toFrame). A picture frame counts when the SOURCE FRAME it shows (speed.ts sourceFrameIndexAt, the evaluator's rule) lies in
 * [kLo, kHi) of the span; a sound frame when its instant (pictureSourceAt) lies in the span; a still or a whole range: every frame.
 * `source` is the source-frame times of the first and last counted frame, cut to the span. `hidden`: the clip's track is hidden.
 */
export interface RangeUse { sequenceId: string; trackId: string; clipId: string; medium: 'picture' | 'sound'; hidden: boolean; fromFrame: number; toFrame: number; source: SourceSpan }
/** Per range: its uses, the merged stretches of source used (in the range's own asset time), and untimed copies on the timeline (not counted). */
export interface RangeUsage { rangeId: string; uses: RangeUse[]; usedSource: SourceSpan[]; untimedCopies: string[] }
/** What usage does not count, returned with it by the route and tool. */
export const USAGE_LIMITS = ['transition_handles', 'time_effect_taps'] as const;
export interface UsageResult { ranges: Record<string, RangeUsage>; /** ids of ranges with no use, in list order */ unused: string[]; limits: readonly (typeof USAGE_LIMITS)[number][] }

// ---------- screen time by tag (sourceRanges.ts screenTime) ----------
/**
 * One sequence. picture = union of the frames of media clips on visible video tracks; per person the union of the picture uses of
 * every range (either kind) tagged with them; untagged = picture minus the union over people. `people` sorted by people.ts
 * personNameKey compared with `<`, then id (no localeCompare: Node and Chromium must agree). Seconds = frames × rate.den / rate.num.
 */
export interface ScreenTime {
  sequenceId: string; rate: { num: number; den: number };
  pictureFrames: number; untaggedFrames: number;
  people: { personId: string; frames: number; clips: string[] }[];
}
/** The measurement's name and its label: it travels with the numbers in the route, the tool and the table. Never a verdict. */
export const SCREEN_TIME_TITLE = { he: 'מי כמה בסרט', en: 'Who is on screen, and how long' } as const;
export const SCREEN_TIME_LABEL = {
  he: 'לפי תיוג ידני בלבד, בלי זיהוי פנים. נספר כל קליפ מתויג שמוצג, גם כשתמונה אחרת מכסה אותו',
  en: 'From manual tags only, no face recognition. Every tagged clip that is shown counts, also when another picture covers it',
} as const;
/** Words no pearls string uses (the measurement never judges a cut): packages/evals/src/pearls-wording.test.ts. */
export const PEARL_FORBIDDEN_WORDS = /\b(fair|unfair|balanced|should)\b/i;
export const PEARL_FORBIDDEN_WORDS_HE = /הוגן|מאוזן|צריך/;

// ---------- search and placement ----------
export interface RangeFilter { kind?: RangeKind; unused?: boolean; personId?: string; assetId?: string }
/** placeRangeArgs: the add_clip arguments of a range snapped OUTWARD to project frames and clamped to the file; a whole file: assetId only. */
export type PlaceRangeArgs = { assetId: string; sourceIn: T.RationalTime; duration: T.RationalTime } | { assetId: string };
/** «שורט מהפנינה» (decisions §2.11): offered for a pearl with a span of 3–180 s on a file with video; the short's name is the label cut to 128. */
export const PEARL_SHORT_LIMITS = { minSeconds: 3, maxSeconds: 180, nameChars: 128 } as const;
export const PEARL_SHORT_BLOCKS = ['too_short', 'too_long', 'no_picture', 'whole_file'] as const;

// ---------- the read view (GET /api/v1/projects/:id/pearls, MCP get_pearls; apps/server/src/pearls.ts, B) ----------
export interface PearlRow {
  id: string; assetId: string; assetName: string; kind: RangeKind;
  span: SourceSpan | null; startSeconds: number | null; endSeconds: number | null;
  /** '' for a credential without the people scope (labelsHidden). */
  label: string;
  /** The label is a contiguous run of the transcript words inside the span (quotes.ts isVerbatim); false when hidden. */
  verbatim: boolean;
  people: { id: string; name: string }[];
  createdBy: string; byAgent: boolean;
  usage: RangeUsage;
}
export interface PearlsView {
  revision: number; sequenceId: string;
  ranges: PearlRow[]; unused: string[];
  screenTime: ScreenTime; screenTimeTitle: typeof SCREEN_TIME_TITLE; screenTimeLabel: typeof SCREEN_TIME_LABEL;
  limits: UsageResult['limits'];
  /** true when this credential reads labels as '' (they are family notes; peoplePrivacy.ts). */
  labelsHidden: boolean;
  note: string;
}
export const PEARLS_VIEW_NOTE = 'Marked by hand. Usage is exact to the frame for the picture each clip shows; screen time counts manual tags only, never faces.' as const;
