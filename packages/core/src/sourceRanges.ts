/**
 * Marked source ranges — «פנינים» (wave 7 pearls track): the pure functions, the cascades and the validation. BUILDER A owns this
 * file (decisions §5); the contract is sourceRangesContract.ts. Until built, each function with a result THROWS SourceRangesNotBuilt
 * (never a made-up value); the cascades and the validation return nothing (no range can exist before the ops are built).
 *
 * MODULE RULE: ops.ts, peopleOps.ts and validate.ts import this file, so it must not use a value of ops.ts (or of the contract,
 * which imports ops.ts) while the module loads; inside functions it may. Keep the op registrations in sourceRangeOps.ts.
 *
 * RULES OF THE BODIES (decisions §2, verifier C6–C8):
 * - Own-property lookups only (Object.hasOwn); `people` ids may name Object.prototype members (PERSON_ID allows "constructor").
 * - No float seconds, no Date, no localeCompare and no Intl here: exact rationals (packages/time); people ordered by
 *   personNameKey with `<`, then id; lists by capture wall (events.ts compareWall), asset id, span start (T.cmp), range id.
 * - rangeUsage: group ranges by timeLineage root and call timingRelations once per root (memo per document object). With delta
 *   the copy's offset and s′ = s + delta, e′ = e + delta on the clip's asset: a clip on a video track whose file has video counts
 *   frame i when k(i) = sourceFrameIndexAt(asset, clip, clip.start + i/rate, rate) has kLo ≤ k < kHi, kLo = sourceFrameOfTime(asset,
 *   s′), kHi = the first k with sourceTimeOfFrame(asset, k) ≥ e′ (at least kLo + 1); k(i) is monotone, so two binary searches find
 *   the run (a freeze clip has one k); an audio-track clip or a file without video: s′ ≤ pictureSourceAt(...) < e′; a still or a
 *   whole range: every frame. No reject by [sourceIn, sourceEnd) (a freeze clip would be lost); reject by k of the first and last
 *   frame. Untimed copies are listed, never counted. Transition handles and time-effect taps are not counted (USAGE_LIMITS).
 * - screenTime: visible video tracks only; interval unions on sorted integer pairs.
 * - detachRangesOfAsset / untagPerson mutate the draft and return the entity ids they changed (the range ids), deleting the
 *   `sourceRanges` key when it empties; untagPerson removes a presence range left with nobody and drops an emptied `people`.
 */
import type * as T from '@pulseframe/time';
import type { Asset, ProjectDocument, SourceRange, SourceSpan } from './schema.ts';
import type { Issue } from './validate.ts';
import type { PlaceRangeArgs, RangeFilter, ScreenTime, UsageResult } from './sourceRangesContract.ts';

/** Thrown by every function below until builder A has built it. */
export class SourceRangesNotBuilt extends Error {
  constructor(what: string) { super(`${what}: marked ranges are not built in this build yet`); this.name = 'SourceRangesNotBuilt'; }
}
const notBuilt = (what: string): never => { throw new SourceRangesNotBuilt(what); };

/** Every range of the document by id ({} when none). */
export function rangesOf(doc: ProjectDocument): Readonly<Record<string, SourceRange>> { void doc; return notBuilt('rangesOf'); }
/** A range by id, own property only; null when absent. */
export function sourceRangeOf(doc: ProjectDocument, rangeId: string): SourceRange | null { void doc; void rangeId; return notBuilt('sourceRangeOf'); }
/** The span a range covers in its asset's time: its own, or [0, duration) for span null. */
export function rangeSpan(doc: ProjectDocument, range: SourceRange): SourceSpan { void doc; void range; return notBuilt('rangeSpan'); }
/** Usage of every range in every sequence (decisions §2.5). Memoised per document object. */
export function rangeUsage(doc: ProjectDocument): UsageResult { void doc; return notBuilt('rangeUsage'); }
/** The merged used stretches of one file's source (the viewer strip), in that file's time. */
export function assetUsage(doc: ProjectDocument, assetId: string): SourceSpan[] { void doc; void assetId; return notBuilt('assetUsage'); }
/** Screen time by manual tag in one sequence (default: the main one). */
export function screenTime(doc: ProjectDocument, sequenceId?: string): ScreenTime { void doc; void sequenceId; return notBuilt('screenTime'); }
/** Range ids matching a query (bareWord tokens over label and tagged names, vowel points and punctuation ignored) and a filter, in list order. */
export function searchRanges(doc: ProjectDocument, query: string, filter: RangeFilter = {}): string[] { void doc; void query; void filter; return notBuilt('searchRanges'); }
/** add_clip arguments for a range, snapped OUTWARD to project frames and clamped to the file (a spoken word is never cut short). */
export function placeRangeArgs(doc: ProjectDocument, range: SourceRange, rate: { num: number; den: number }): PlaceRangeArgs { void doc; void range; void rate; return notBuilt('placeRangeArgs'); }
/** The range in the file's own video frames (sourceFrameOfTime), [fromFrame, toFrame); null for a still, a sound file or a whole range. */
export function filmWindowOfRange(asset: Pick<Asset, 'kind' | 'video' | 'duration'>, range: SourceRange): { fromFrame: number; toFrame: number } | null { void asset; void range; return notBuilt('filmWindowOfRange'); }
/** queries.ts summarize: how many ranges, and how many have no use (null until usage is built). */
export function pearlsSummary(doc: ProjectDocument): { count: number; unused: number | null } {
  return { count: Object.keys(doc.sourceRanges ?? {}).length, unused: null };
}
/** True when `t` lies in [span.start, span.end). Exact. */
export type SpanTest = (t: T.RationalTime) => boolean;

// ---------- cascades and validation (called from ops.ts, peopleOps.ts and validate.ts; return nothing until built) ----------
/** remove_asset: the ranges of the file go with it. Returns the range ids removed (entity ids). */
export function detachRangesOfAsset(draft: ProjectDocument, assetId: string): string[] { void draft; void assetId; return []; }
/** remove_person (the owner's): the person leaves every range. Returns the range ids changed or removed. */
export function untagPerson(draft: ProjectDocument, personId: string): string[] { void draft; void personId; return []; }
/** validateProject's rules for ranges (code SOURCE_RANGE_ISSUE): asset exists and is not a colour table; span null for a still and
 * for presence; 0 ≤ start < end ≤ duration; presence has people and no label; people ids exist, sorted, unique; at most MAX_SOURCE_RANGES. */
export function validateSourceRanges(doc: ProjectDocument): Issue[] { void doc; return []; }
