/**
 * The operations of marked source ranges — «פנינים» (wave 7 pearls track). Registered on import of this module (index.ts exports
 * it). The lead's pre-pass fixes names, versions, descriptions, argument schemas and outputs (sourceRangesContract.ts); builder A
 * wrote the bodies.
 *
 * RULES OF THE BODIES (decisions §2, §4):
 * - Refuse only with rangeRefusal(...), in the order SOURCE_RANGE_REFUSALS lists. Undo is the generic one (entity 'sourceRange').
 * - add: id ctx.newId(RANGE_ID_PREFIX); kind default pearl; start and end both or neither; a still (kind image) is always whole; a lut
 *   is refused; label one line, '' when absent, always '' for presence; people stored sorted (code units) and unique, absent when
 *   empty; createdBy = ctx.actor; write `(d.sourceRanges ??= {})`. Duplicate = same asset, kind and equal span (T.eq; null = null).
 * - update: the full new people list ([] clears it: the key is deleted; a presence range may not be left with nobody).
 * - remove: deletes the range; the emptied map is deleted.
 * - Summaries: SOURCE_RANGE_SUMMARIES with the file's name; never the label, never a person.
 * - A "who is in it" tag (presence) covers the whole file: start and end given for one are refused as presenceIsWhole (the kind
 *   already says "whole"), at the place of the span checks.
 * The credential rules (who may tag, who may name) are the server's (apps/server/src/peoplePrivacy.ts), checked before these run.
 */
import * as T from '@pulseframe/time';
import { defineOp } from './ops.ts';
import type { Asset, ProjectDocument, SourceRange, SourceSpan } from './schema.ts';
import {
  AddSourceRangeArgsSchema, RemoveSourceRangeArgsSchema, UpdateSourceRangeArgsSchema, MAX_SOURCE_RANGES, MAX_RANGE_PEOPLE, RANGE_ID_PREFIX, rangeRefusal, SOURCE_RANGE_SUMMARIES,
} from './sourceRangesContract.ts';

/** True once builder A has built the three bodies. */
export const SOURCE_RANGE_OPS_BUILT = true;

const own = <V>(rec: Record<string, V> | undefined, id: string): V | undefined => (rec && Object.hasOwn(rec, id) ? rec[id] : undefined);
/** Seconds as a refusal says them: at most three decimals, never a fraction. */
const secondsOf = (t: T.RationalTime) => String(Math.round(T.toSeconds(t) * 1000) / 1000);
const sameSpan = (a: SourceSpan | null, b: SourceSpan | null) => (a === null || b === null ? a === b : T.eq(a.start, b.start) && T.eq(a.end, b.end));

function mustAsset(d: ProjectDocument, assetId: string): Asset {
  const asset = own(d.assets, assetId);
  if (!asset) throw rangeRefusal('assetNotFound', { assetId }, assetId);
  if (asset.kind === 'lut') throw rangeRefusal('rangeNoTime', { assetId });
  return asset;
}
function mustRange(d: ProjectDocument, rangeId: string): SourceRange {
  const r = own(d.sourceRanges, rangeId);
  if (!r) throw rangeRefusal('rangeNotFound', { rangeId }, rangeId);
  return r;
}
/** The span checks shared by add and update (after the half-span check): photo, presence, bounds. */
function checkSpan(asset: Asset, kind: SourceRange['kind'], span: SourceSpan | null, details: Record<string, unknown>): void {
  if (!span) return;
  if (asset.kind === 'image') throw rangeRefusal('rangeStillSpan', details);
  if (kind === 'presence') throw rangeRefusal('presenceIsWhole', details);
  if (T.isNegative(span.start) || !T.lt(span.start, span.end) || T.lt(asset.duration, span.end)) throw rangeRefusal('rangeBounds', details, secondsOf(asset.duration));
}
function checkLabel(label: string, details: Record<string, unknown>): void {
  if (/[\n\r]/.test(label)) throw rangeRefusal('rangeLabelLine', details);
}
/** Sorted (code units), unique; every id a person of the project (own property). */
function checkPeople(d: ProjectDocument, people: readonly string[], details: Record<string, unknown>): string[] {
  for (const p of people) if (!own(d.people, p)) throw rangeRefusal('rangePersonNotFound', { ...details, personId: p }, p);
  return [...new Set(people)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function checkDuplicate(d: ProjectDocument, r: Pick<SourceRange, 'assetId' | 'kind' | 'span'>, exceptId: string | null, details: Record<string, unknown>): void {
  for (const o of Object.values(d.sourceRanges ?? {}))
    if (o.id !== exceptId && o.assetId === r.assetId && o.kind === r.kind && sameSpan(o.span, r.span)) throw rangeRefusal('rangeDuplicate', { ...details, otherRangeId: o.id });
}
const fileName = (d: ProjectDocument, assetId: string) => own(d.assets, assetId)?.name ?? assetId;

defineOp({
  name: 'add_source_range',
  version: 1,
  description: `Mark a stretch of SOURCE time of a library file («פנינה», a pearl: a moment worth keeping, with a name), or the whole file (start and end left out; a photo is always whole), or tag who is in a whole file (kind presence: people only, no name). Exact times of any alignment are kept as given. Changes no picture: a mark is found, counted and used (insert it, plan a family film from it), never drawn. Only the project owner's own session may tag people; a credential without the people scope may not give a name. At most ${MAX_SOURCE_RANGES} per project, ${MAX_RANGE_PEOPLE} people per range.`,
  args: AddSourceRangeArgsSchema,
  checksOwnIds: ['assetId'],
  apply(d, a, ctx) {
    const details = { assetId: a.assetId };
    const asset = mustAsset(d, a.assetId);
    const kind = a.kind ?? 'pearl';
    if ((a.start === undefined) !== (a.end === undefined)) throw rangeRefusal('rangeHalfSpan', details);
    const span: SourceSpan | null = a.start !== undefined && a.end !== undefined ? { start: a.start, end: a.end } : null;
    checkSpan(asset, kind, span, details);
    const label = a.label ?? '';
    checkLabel(label, details);
    if (kind === 'presence' && (label !== '' || !a.people?.length)) throw rangeRefusal('presenceNeedsPeople', details);
    const people = checkPeople(d, a.people ?? [], details);
    checkDuplicate(d, { assetId: asset.id, kind, span }, null, details);
    if (Object.keys(d.sourceRanges ?? {}).length >= MAX_SOURCE_RANGES) throw rangeRefusal('tooManyRanges', details);
    const id = ctx.newId(RANGE_ID_PREFIX);
    const range: SourceRange = { id, assetId: asset.id, kind, span, label, ...(people.length ? { people } : {}), createdBy: ctx.actor.slice(0, 80) };
    (d.sourceRanges ??= {})[id] = range;
    return { affectedIds: [id], summary: SOURCE_RANGE_SUMMARIES[kind === 'presence' ? 'presence' : 'pearl'](asset.name), output: { rangeId: id } };
  },
});
defineOp({
  name: 'update_source_range',
  version: 1,
  description: 'Change a marked range: its stretch (start and end together, or whole: true), its name, or its people (the full new list; [] clears it). Only the project owner\'s own session may change the people, or change a range that has people tagged.',
  args: UpdateSourceRangeArgsSchema,
  checksOwnIds: ['rangeId'],
  apply(d, a) {
    const r = mustRange(d, a.rangeId);
    const details = { rangeId: r.id };
    const hasStart = a.start !== undefined, hasEnd = a.end !== undefined;
    if (!hasStart && !hasEnd && a.whole === undefined && a.label === undefined && a.people === undefined) throw rangeRefusal('rangeNothingToChange', details);
    if (a.whole && (hasStart || hasEnd)) throw rangeRefusal('rangeWholeAndSpan', details);
    if (hasStart !== hasEnd) throw rangeRefusal('rangeHalfSpan', details);
    const asset = mustAsset(d, r.assetId);
    const span: SourceSpan | null = hasStart ? { start: a.start!, end: a.end! } : a.whole ? null : r.span;
    if (hasStart) checkSpan(asset, r.kind, span, details);
    const label = a.label ?? r.label;
    if (a.label !== undefined) checkLabel(label, details);
    if (r.kind === 'presence' && (label !== '' || (a.people !== undefined && a.people.length === 0))) throw rangeRefusal('presenceNeedsPeople', details);
    const people = a.people !== undefined ? checkPeople(d, a.people, details) : r.people ?? [];
    checkDuplicate(d, { assetId: r.assetId, kind: r.kind, span }, r.id, details);
    const before = r.people ?? [];
    if (sameSpan(span, r.span) && label === r.label && people.length === before.length && people.every((p, i) => p === before[i])) throw rangeRefusal('rangeUnchanged', details);
    r.span = span;
    r.label = label;
    if (people.length) r.people = people; else delete r.people;
    return { affectedIds: [r.id], summary: SOURCE_RANGE_SUMMARIES.changed(fileName(d, r.assetId)) };
  },
});
defineOp({
  name: 'remove_source_range',
  version: 1,
  description: 'Remove a marked range. The file and every clip stay as they are. Only the project owner\'s own session may remove a range that has people tagged.',
  args: RemoveSourceRangeArgsSchema,
  checksOwnIds: ['rangeId'],
  apply(d, a) {
    const r = mustRange(d, a.rangeId);
    delete d.sourceRanges![r.id];
    if (Object.keys(d.sourceRanges!).length === 0) delete d.sourceRanges;
    return { affectedIds: [r.id], summary: SOURCE_RANGE_SUMMARIES.removed(fileName(d, r.assetId)) };
  },
});
