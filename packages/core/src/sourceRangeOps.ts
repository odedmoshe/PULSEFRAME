/**
 * The operations of marked source ranges — «פנינים» (wave 7 pearls track). Registered on import of this module (index.ts exports
 * it). The lead's pre-pass fixes names, versions, descriptions, argument schemas and outputs (sourceRangesContract.ts); BUILDER A
 * writes the bodies. Until then each REFUSES with notBuilt and changes nothing; SOURCE_RANGE_OPS_BUILT turns their fuzz rows on
 * (packages/evals/src/ops-fuzz.gen.ts).
 *
 * RULES OF A's BODIES (decisions §2, §4):
 * - Refuse only with rangeRefusal(...), in the order SOURCE_RANGE_REFUSALS lists. Undo is the generic one (entity 'sourceRange').
 * - add: id ctx.newId(RANGE_ID_PREFIX); kind default pearl; start and end both or neither; a still (kind image) is always whole; a lut
 *   is refused; label one line, '' when absent, always '' for presence; people stored sorted (code units) and unique, absent when
 *   empty; createdBy = ctx.actor; write `(d.sourceRanges ??= {})`. Duplicate = same asset, kind and equal span (T.eq; null = null).
 * - update: the full new people list ([] clears it: the key is deleted; a presence range may not be left with nobody).
 * - remove: deletes the range; the emptied map is deleted.
 * - Summaries: SOURCE_RANGE_SUMMARIES with the file's name; never the label, never a person.
 * The credential rules (who may tag, who may name) are the server's (apps/server/src/peoplePrivacy.ts), checked before these run.
 */
import { defineOp } from './ops.ts';
import { AddSourceRangeArgsSchema, RemoveSourceRangeArgsSchema, UpdateSourceRangeArgsSchema, MAX_SOURCE_RANGES, MAX_RANGE_PEOPLE, rangeRefusal } from './sourceRangesContract.ts';

/** True once builder A has built the three bodies. */
export const SOURCE_RANGE_OPS_BUILT = false;

const notBuilt = (op: string) => () => { throw rangeRefusal('notBuilt', { op }, op); };
defineOp({
  name: 'add_source_range',
  version: 1,
  description: `Mark a stretch of SOURCE time of a library file («פנינה», a pearl: a moment worth keeping, with a name), or the whole file (start and end left out; a photo is always whole), or tag who is in a whole file (kind presence: people only, no name). Exact times of any alignment are kept as given. Changes no picture: a mark is found, counted and used (insert it, plan a family film from it), never drawn. Only the project owner's own session may tag people; a credential without the people scope may not give a name. At most ${MAX_SOURCE_RANGES} per project, ${MAX_RANGE_PEOPLE} people per range.`,
  args: AddSourceRangeArgsSchema,
  apply: notBuilt('add_source_range'),
});
defineOp({
  name: 'update_source_range',
  version: 1,
  description: 'Change a marked range: its stretch (start and end together, or whole: true), its name, or its people (the full new list; [] clears it). Only the project owner\'s own session may change the people, or change a range that has people tagged.',
  args: UpdateSourceRangeArgsSchema,
  apply: notBuilt('update_source_range'),
});
defineOp({
  name: 'remove_source_range',
  version: 1,
  description: 'Remove a marked range. The file and every clip stay as they are. Only the project owner\'s own session may remove a range that has people tagged.',
  args: RemoveSourceRangeArgsSchema,
  apply: notBuilt('remove_source_range'),
});
