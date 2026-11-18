/**
 * The multicam operations (ADR-0020): create_multicam, set_multicam_sync, update_multicam, set_angle_look, place_multicam,
 * switch_angles, detach_from_multicam, remove_multicam (public) and attach_multicam_sync (internal). Registered on import of
 * this module (packages/core/src/index.ts exports it); every one runs only through applyTransaction.
 *
 * The lead's contract fixes the names, versions, descriptions and argument schemas (multicamContract.ts MulticamOpArgs), the
 * outputs, and every refusal with its code, English wording and hint (multicamRefusals.ts MULTICAM_REFUSALS; the Hebrew wording
 * is packages/i18n/src/multicam.ts HE_MULTICAM). The apply bodies (multicam W1) follow plan §3 and the W1 brief; until then each
 * refuses with MULTICAM_REFUSALS.notBuilt and changes nothing. MULTICAM_OPS_BUILT turns the fuzz rows on (ops-fuzz.gen.ts).
 *
 * RULES OF THE BODIES the lead adds to the brief (they settle findings against the moved tree):
 * - A program may sit on any sequence (shorts made sequences ordinary): look sequences up with sequences.ts sequenceOf.
 *   place_multicam with newSequence composes getOp('add_sequence').apply(d, {name, tracks: 'none'}, ctx) and writes
 *   origin {kind: 'multicam', groupId} on that sequence (the only writer of that member).
 * - The `multicam` map is absent until the first group: write (d.multicam ??= {}); remove_multicam deletes the emptied map.
 * - create_multicam takes each angle's kind from its first file when not given; a sound angle needs files with sound, a
 *   picture angle video files (angleKind); a file is named at most once (assetTwice). sampleRate = settings.sampleRate.
 * - set_angle_look with fromClipId: the clip's piece receives its redact and follow (privacy regions follow each angle's OWN
 *   file); clear: removes the look and every piece's redact and follow.
 * - Every op refuses when its changed entities exceed MAX_TOUCHED_ENTITIES (tooManyChanges).
 * - Ids from ctx.newId: 'mcg' (group), 'ang' (angle), 'spk' (speaker), 'clp' / 'trk' through the composed ops, 'fx' (effects).
 */
import { defineOp } from './ops.ts';
import { MulticamOpArgs, multicamRefusal } from './multicamContract.ts';

/** True once W1 has built the bodies: the operations fuzz (packages/evals/src/ops-fuzz.gen.ts) then draws the multicam rows. */
export const MULTICAM_OPS_BUILT = false;

const DESCRIPTIONS: Record<keyof typeof MulticamOpArgs, string> = {
  create_multicam: 'Group 2–9 angles (cameras or sound recorders, each one or more files) into a multicam group. Group time follows the reference angle\'s first file (by default the first sound recorder); every other file starts unsynced until it is synced by sound (the multicam sync route, sync_multicam) or by hand (set_multicam_sync).',
  attach_multicam_sync: 'Store measured sync maps from the server\'s sync job. Internal. A file synced by hand is kept unless overwrite is true. Program segments showing a changed file keep their group time.',
  set_multicam_sync: 'Correct one file\'s sync by hand: nudge it, set its offset, give its anchors, or clear it. The file then counts as synced by hand. Program segments showing it keep their group time, so the edit follows the correction. Refused on the reference angle\'s first file, which sets group time.',
  update_multicam: 'Rename a multicam group or its angles, set the wide angle, or set who speaks on which mic and which angle frames them.',
  set_angle_look: 'Make a segment\'s look (framing, grade, effects, mask, per-format framing) the look of its angle, and its privacy regions and follow those of its file; apply them to that angle\'s segments (by default only those still showing the old look). clear removes them.',
  place_multicam: 'Lay a multicam program: picture segments of one angle on a video track and continuous sound of the chosen sources, all in sync, with clock drift corrected by invisible cuts (picture) and short consecutive sound parts (a second recorder that drifts). On new tracks, a given empty track, or a new sequence.',
  switch_angles: 'Cut a multicam program to other angles: one cut, a range or a whole list of cuts (at a timeline frame or a group time). Each segment is re-mapped in group time, so sync is kept after any edit; the segment takes the new angle\'s look. One undoable step.',
  detach_from_multicam: 'Turn multicam segments into ordinary clips (they keep their file, timing and look).',
  remove_multicam: 'Delete a multicam group. Refused while segments use it unless detach=true, which turns them into ordinary clips in the same step.',
};
for (const [name, args] of Object.entries(MulticamOpArgs) as [keyof typeof MulticamOpArgs, (typeof MulticamOpArgs)[keyof typeof MulticamOpArgs]][]) {
  defineOp({
    name, version: 1, internal: name === 'attach_multicam_sync', description: DESCRIPTIONS[name], args,
    apply() { throw multicamRefusal('notBuilt', { op: name }, name); },
  });
}
