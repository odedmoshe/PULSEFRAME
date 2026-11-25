/**
 * Pure helpers of the pearls surfaces (wave 7 pearls track). Builder C owns this file. Rule C18: every surface reads
 * `state.rawDoc` (the whole document, never `state.doc`, which is the active sequence projected alone) and `state.activeSequenceId`,
 * through ONE memoised usage per document object, shared by the list, the strip and the table. Core rangeUsage / screenTime
 * (builder A) throw SourceRangesNotBuilt until built; callers show the not-built state then, never a made-up number.
 */
import { rangeUsage, type ProjectDocument, type UsageResult } from '@pulseframe/core';

const memo = new WeakMap<ProjectDocument, UsageResult>();
/** Usage of the whole document, memoised per document object. Throws until core usage is built. */
export function usageOf(rawDoc: ProjectDocument): UsageResult {
  let u = memo.get(rawDoc);
  if (!u) { u = rangeUsage(rawDoc); memo.set(rawDoc, u); }
  return u;
}
