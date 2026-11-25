/**
 * Versions: what restore composes and what «מה השתנה» says (wave 7 craft; craft-plan.md §4.4 and "Corrected" C6;
 * craft-decisions.md §2.6). W2 BUILDS THIS. Pure.
 * - privacyDigest: a canonical hash of every clip's `redact` list (by clip id) and the samples of every motion track a region
 *   follows — the facts apps/server/src/privacyPurge.ts privacyChanged reads. A version whose digest differs from the current
 *   document's was saved before a privacy change: its still and diff are the owner's only.
 * - composeRestore: EDIT entities from the version (project settings without the name, sequences, track order, tracks, clips,
 *   markers, formats, recipe runs); LIBRARY entities as they are now (files, transcripts, analyses, motion tracks, multicam
 *   groups, events, people), adding from the version only those missing now that a restored clip or track refers to.
 * - describeDiff: counts and names over diffEntities(a, b) (entities.ts), rows marked `restores`; files, transcripts, events and
 *   people that differ are rows with restores=false («לא ישוחזר — נשאר כמו עכשיו»); at most 500 rows, then `more`; privacy counts.
 */
import type { ProjectDocument } from './schema.ts';
import { CraftNotBuilt, type DiffSummary } from './craftContract.ts';

export function privacyDigest(doc: ProjectDocument): string {
  void doc;
  throw new CraftNotBuilt('privacyDigest');
}
/** The document restore commits (through diffEntities + restore_entities), from the current one and the version's copy. */
export function composeRestore(current: ProjectDocument, version: ProjectDocument): ProjectDocument {
  void current; void version;
  throw new CraftNotBuilt('composeRestore');
}
/** `from` → `to`: what changed; `restores` marks the rows composeRestore(to=current, from=version) would apply. */
export function describeDiff(from: ProjectDocument, to: ProjectDocument): DiffSummary {
  void from; void to;
  throw new CraftNotBuilt('describeDiff');
}
