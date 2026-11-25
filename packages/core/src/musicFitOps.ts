/**
 * The two internal operations of a shortened song (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md). Registered on import
 * (index.ts). The lead fixes names, versions, descriptions and argument schemas (musicFitContract.ts); BUILDER A writes the bodies.
 * Until then each REFUSES with notBuilt and changes nothing.
 *
 * RULES OF A's BODIES:
 * - add_fitted_music (the server only, after it made and verified the bytes; precedent packOps.ts add_builtin_music): refuse in this
 *   order: fittedNotSound (kind audio with sound, no picture, provenance.origin 'derived' with provenance.fitted); fittedSourceMissing
 *   (fitted.sourceAssetId in the library NOW); the licence rule fitLicenceProblem(doc, sourceAssetId) → fitLicenceRefusal (fail-closed:
 *   checked again here, whatever the server checked); the made asset's provenance.library must EQUAL fittedLibraryRecord(doc, source)
 *   (or both absent) — else licenceUnknown; fittedGrid (beats and downbeats strictly ascending, every downbeat a beat, all in
 *   [0, duration)); removalNotBars (removed.from and removed.to are downbeats of the source's beatsFor analysis, on its clock).
 *   Into the library deduplicated by content; the grid written as analyses[id].beats with origin.method FIT_GRID_METHOD, edited false,
 *   never over a hand-corrected grid; place through add_clip's own body as add_builtin_music does.
 * - mark_join_heard: joinNotFitted unless the asset has provenance.fitted; heard true sets {by: ctx.actor, at}, false deletes it.
 *   The route is owner-session only (apps/server/src/musicfit/routes.ts); the op itself trusts its caller (internal).
 */
import { defineOp } from './ops.ts';
import { AddFittedMusicArgsSchema, MarkJoinHeardArgsSchema, musicFitRefusal } from './musicFitContract.ts';

/** True once builder A has built the four bodies (impactOps.ts and this file); turns their fuzz rows on. */
export const MUSICFIT_OPS_BUILT = false;

const notBuilt = (op: string) => () => { throw musicFitRefusal('notBuilt', { op }, op); };
defineOp({
  name: 'add_fitted_music',
  version: 1,
  internal: true,
  description: 'Add a song the server shortened by removing whole bars from its middle (one join, measured and not heard) to the library with its beats, derived exactly from the source song\'s measured beats, and optionally place it, as one step. A file made from a library song carries that song\'s licence record (credit, non-commercial mark, archive rule); a licence that forbids changes is refused.',
  args: AddFittedMusicArgsSchema,
  apply: notBuilt('add_fitted_music'),
});
defineOp({
  name: 'mark_join_heard',
  version: 1,
  internal: true,
  description: 'Mark the join of a shortened song as heard by the project owner, or clear the mark. Only the owner\'s own session reaches it.',
  args: MarkJoinHeardArgsSchema,
  apply: notBuilt('mark_join_heard'),
});
