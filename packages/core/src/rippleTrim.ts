/**
 * Which clip Q and W act on, and the ops of «משך הקליפ» (wave 7 craft; craft-plan.md §3.6, §4.2, "Corrected" C1). Pure, on the
 * document the editor holds.
 * - rippleTrimTarget: the one selected clip when the playhead is strictly inside it; else, ONLY while the main sequence is the
 *   open one, the clip under the playhead on the main track (editHelpers.ts mainTrackId); else null (the command is disabled).
 *   "Strictly inside" in frames: start < playhead < end, so Q and W always change something.
 * - rippleTrimCall: the ripple_trim call for that clip and edge at the playhead (the playhead frame as an exact frame time).
 * - durationOps: a clip on the main track of a project with ripple delete on (editHelpers.ts rippleDeleteOn) gets ripple_trim at
 *   its end, any other clip trim_clip; several clips are one transaction built from the LAST clip to the first, so no clip's
 *   target time is moved by an earlier step. A clip already that long gets no op. More than CRAFT_LIMITS.durationClips, or
 *   fewer than one frame → null (the command is disabled). Unknown ids are left out.
 */
import * as T from '@pulseframe/time';
import { findClip, type OpCall } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import { CRAFT_LIMITS } from './craftContract.ts';
import { mainTrackId, rippleDeleteOn } from './editHelpers.ts';
import { clipEnd } from './validate.ts';

export interface RippleSelection { clipIds: readonly string[]; sequenceId: string }

/** start < playhead < end, in whole frames (the clip's own edges are on the grid). */
function strictlyInside(start: T.RationalTime, end: T.RationalTime, frame: number, rate: T.Rate): boolean {
  const at = T.frameTime(frame, rate);
  return T.lt(start, at) && T.lt(at, end);
}

export function rippleTrimTarget(doc: ProjectDocument, sel: RippleSelection, playheadFrame: number): { clipId: string } | null {
  const rate = doc.settings.frameRate;
  if (sel.clipIds.length === 1) {
    const f = findClip(doc, sel.clipIds[0]!);
    if (f && f.seq.id === sel.sequenceId && strictlyInside(f.clip.start, clipEnd(f.clip), playheadFrame, rate)) return { clipId: f.clip.id };
  }
  if (sel.sequenceId !== doc.mainSequenceId) return null;
  const main = mainTrackId(doc);
  const track = main ? doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === main) : undefined;
  const under = track?.clips.find((c) => strictlyInside(c.start, clipEnd(c), playheadFrame, rate));
  return under ? { clipId: under.id } : null;
}

export function rippleTrimCall(doc: ProjectDocument, clipId: string, edge: 'start' | 'end', playheadFrame: number): OpCall {
  return { op: 'ripple_trim', args: { clipId, edge, to: T.frameTime(playheadFrame, doc.settings.frameRate) } };
}

export function durationOps(doc: ProjectDocument, clipIds: readonly string[], frames: number): OpCall[] | null {
  if (!Number.isInteger(frames) || frames < 1 || clipIds.length > CRAFT_LIMITS.durationClips) return null;
  const rate = doc.settings.frameRate;
  const length = T.frameTime(frames, rate);
  const main = mainTrackId(doc);
  const ripple = rippleDeleteOn(doc);
  const found = [...new Set(clipIds)].map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f);
  // the last clip first: lengthening or shortening it moves only what lies after it, never a clip still to be set
  found.sort((a, b) => T.cmp(b.clip.start, a.clip.start) || (a.clip.id < b.clip.id ? 1 : -1));
  const ops: OpCall[] = [];
  for (const { clip, track, seq } of found) {
    if (T.eq(clip.duration, length)) continue;
    const to = T.add(clip.start, length);
    const onMain = ripple && seq.id === doc.mainSequenceId && track.id === main;
    ops.push({ op: onMain ? 'ripple_trim' : 'trim_clip', args: { clipId: clip.id, edge: 'end', to } });
  }
  return ops;
}
