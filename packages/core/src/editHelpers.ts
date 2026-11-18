/**
 * Pure edit helpers shared by the editor's commands and the Hebrew command bar (ADR-0027, lead contract (e)). They were
 * written in the web (apps/web/src/editor/commands.ts and inspector.model.ts) and moved here unchanged, so the Delete key and
 * «מחק את הקליפ» build the very same operations (one implementation). The web re-exports them under the same names.
 * Pure: no clock, no random source, no DOM.
 */
import * as T from '@pulseframe/time';
import { findClip, getOp, type OpCall } from './ops.ts';
import type { Clip, ProjectDocument } from './schema.ts';
import { clipEnd } from './validate.ts';

/** End of the edit as add_adjustment's span 'edit' measures it: the end of the last picture or title clip of the main sequence. */
export function editEnd(doc: ProjectDocument): T.RationalTime {
  let end = T.ZERO;
  for (const t of doc.sequences[doc.mainSequenceId]?.tracks ?? []) if (t.kind === 'video' || t.kind === 'text') for (const c of t.clips) end = T.max(end, clipEnd(c));
  return end;
}

/** How long a new title lasts when nobody says (the editor's «הוספת טקסט» and the command bar's add_title; lead decision 4). */
export const DEFAULT_TITLE_SECONDS = 2;
/** DEFAULT_TITLE_SECONDS as a whole number of frames at `rate` (rounded once, ties up), as a time. */
export const defaultTitleDuration = (rate: T.Rate): T.RationalTime => T.frameTime(T.nearestFrameIndex(T.rt(DEFAULT_TITLE_SECONDS, 1), rate), rate);

// ---------- delete, and ripple delete on the main track (UX_REDESIGN §4.7, §5) ----------
/** The op that stores the project's timeline behaviour (core integrator); ripple delete waits for it to be registered. */
export const BEHAVIOUR_OP = 'set_timeline_behaviour';
/** The main picture track V1: the first video track of the main sequence (the timeline draws it as the magnetic main lane). */
export const mainTrackId = (doc: ProjectDocument): string | null => doc.sequences[doc.mainSequenceId]?.tracks.find((t) => t.kind === 'video')?.id ?? null;
/** Delete closes the gap on V1: the project turned ripple delete on (absent means off), and this build knows the op that stores it. */
export const rippleDeleteOn = (doc: ProjectDocument): boolean => !!getOp(BEHAVIOUR_OP) && !!(doc.settings as { timeline?: { rippleDelete?: boolean } }).timeline?.rippleDelete;
export interface DeletePlan { ops: OpCall[]; /** V1 clips that move earlier */ moved: number; /** clips the delete names (a linked pair counts once) */ deleted: number; /** the first deleted clip, for the undo toast's name */ first: string }
/**
 * The ops of a delete of `ids`, in one transaction. A linked partner is removed by its clip's own delete, so it is not listed
 * twice. With `ripple`, the clips of V1 that come after a deleted V1 clip move earlier by the length deleted before them
 * (move_clips, their linked sound along with them), the earliest group first so each lands where the space is already free;
 * the other tracks keep their gaps. `moved` counts the V1 clips that move. Null when nothing is selected.
 */
export function deleteOps(doc: ProjectDocument, ids: readonly string[], ripple: boolean): DeletePlan | null {
  const seen = new Set<string>();
  const clips = ids.map((id) => findClip(doc, id)).filter((f): f is NonNullable<typeof f> => !!f)
    .filter(({ clip: c }) => { const g = c.type === 'media' ? c.linkGroupId : null; if (!g) return true; if (seen.has(g)) return false; seen.add(g); return true; });
  if (!clips.length) return null;
  const ops: OpCall[] = clips.map(({ clip }) => ({ op: 'delete_clip', args: { clipId: clip.id } }));
  const main = mainTrackId(doc);
  const track = main ? doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === main) : undefined;
  if (!ripple || !track || track.locked) return { ops, moved: 0, deleted: clips.length, first: clips[0]!.clip.id };
  // every clip that goes from V1: the selected ones, and the V1 partners of selected clips elsewhere (a delete takes the link along)
  const gone = new Set<string>();
  for (const { clip } of clips) {
    gone.add(clip.id);
    const g = clip.type === 'media' ? clip.linkGroupId : null;
    if (g) for (const c of track.clips) if (c.type === 'media' && c.linkGroupId === g) gone.add(c.id);
  }
  const removed = track.clips.filter((c) => gone.has(c.id));
  if (!removed.length) return { ops, moved: 0, deleted: clips.length, first: clips[0]!.clip.id };
  let moved = 0;
  for (const c of [...track.clips].sort((a, b) => T.cmp(a.start, b.start))) {
    if (gone.has(c.id)) continue;
    if (removed.some((r) => !T.lt(c.start, clipEnd(r)))) moved++;
  }
  // One core op closes the gap (ADR: ripple_delete_clips — exact undo, linked sound moves with its picture, a J-cut that would
  // land before 0 is refused with its own wording). It names the V1 clips; selected clips elsewhere keep their gap (delete_clip).
  const mainIds = removed.map((c) => c.id);
  const elsewhere = clips.filter(({ clip }) => !gone.has(clip.id) && !(clip.type === 'media' && clip.linkGroupId && removed.some((r) => r.type === 'media' && r.linkGroupId === clip.linkGroupId)));
  const rippled: OpCall[] = [...elsewhere.map(({ clip }) => ({ op: 'delete_clip', args: { clipId: clip.id } })), { op: 'ripple_delete_clips', args: { clipIds: mainIds } }];
  return { ops: rippled, moved, deleted: clips.length, first: clips[0]!.clip.id };
}

/**
 * Tracks of the main sequence that «הסרת רצועות ריקות» removes: no clips, not locked, not the speech source of a ducking
 * setting, not followed by a caption track. Each becomes one remove_track.
 */
export function emptyTrackIds(doc: ProjectDocument): string[] {
  const tracks = doc.sequences[doc.mainSequenceId]?.tracks ?? [];
  return tracks.filter((t) => t.clips.length === 0 && !t.locked && !tracks.some((x) => x.id !== t.id && (x.audio?.duck?.sourceTrackIds.includes(t.id) || x.caption?.linkedTrackId === t.id))).map((t) => t.id);
}

/** What an audio track carries, for the mixer strip's name and «המוזיקה»: music (its sound was analysed for beats), speech (it has a transcript), the sound of video clips (linked to them), or null (the strip shows its first file's name). */
export type TrackRole = 'music' | 'speech' | 'linked';
export function trackRole(doc: ProjectDocument, track: { clips: readonly Clip[] }): TrackRole | null {
  const media = track.clips.filter((c): c is Extract<Clip, { type: 'media' }> => c.type === 'media');
  if (!media.length) return null;
  if (media.some((c) => doc.analyses?.[c.assetId]?.beats)) return 'music';
  if (media.some((c) => doc.transcripts?.[c.assetId])) return 'speech';
  if (media.every((c) => !!c.linkGroupId)) return 'linked';
  return null;
}
