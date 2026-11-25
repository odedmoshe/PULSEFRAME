/**
 * Which clip Q and W act on, and the ops of «משך הקליפ» (wave 7 craft; craft-plan.md §3.6, §4.2, "Corrected" C1). W1 BUILDS THIS.
 * Pure, on the document the editor holds.
 * - rippleTrimTarget: the one selected clip when the playhead is strictly inside it; else, ONLY while the main sequence is the
 *   open one, the clip under the playhead on the main track (editHelpers.ts mainTrackId); else null (the command is disabled).
 * - rippleTrimCall: the ripple_trim call for that clip and edge at the playhead.
 * - durationOps: a clip on the main track of a project with ripple delete on (editHelpers.ts rippleDeleteOn) gets ripple_trim at
 *   its end, any other clip trim_clip; several clips are one transaction built from the LAST clip to the first, so no clip's
 *   target time is moved by an earlier step. More than CRAFT_LIMITS.durationClips → null (the command is disabled).
 */
import type { OpCall } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import { CraftNotBuilt } from './craftContract.ts';

export interface RippleSelection { clipIds: readonly string[]; sequenceId: string }
export function rippleTrimTarget(doc: ProjectDocument, sel: RippleSelection, playheadFrame: number): { clipId: string } | null {
  void doc; void sel; void playheadFrame;
  throw new CraftNotBuilt('rippleTrimTarget');
}
export function rippleTrimCall(doc: ProjectDocument, clipId: string, edge: 'start' | 'end', playheadFrame: number): OpCall {
  void doc; void clipId; void edge; void playheadFrame;
  throw new CraftNotBuilt('rippleTrimCall');
}
export function durationOps(doc: ProjectDocument, clipIds: readonly string[], frames: number): OpCall[] | null {
  void doc; void clipIds; void frames;
  throw new CraftNotBuilt('durationOps');
}
