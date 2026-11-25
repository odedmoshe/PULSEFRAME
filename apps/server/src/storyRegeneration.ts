/**
 * What a story regeneration starts from (W1; .artifacts/wave7/story-decisions.md §2, C1 and C2; film precedent familyFilm.ts
 * filmRegeneration). Pure; exported for its unit test and for story.ts (W2).
 * - runHandEdits(doc, run, live, undefined, 'any-move') (templates.ts): a picture whose only change is its place in time is NOT
 *   kept — it goes back to its recorded cut (movedKeys, warning moved_back); any other change keeps it exactly, with its link partners.
 *   The magnet and ripple of the owner's editor move every later picture after a trim or a Delete; with 'any-move' those pictures
 *   are not frozen where the edit left them (the film's 'closed-gap' would keep them all, verifier note 3).
 * - The narration clip is never replaced: it is left out of the clips that can be replaced, always among keepIds with its slot
 *   record in keepSlots, passed as ctx.narrationClipId and read as it lies by the planner; when it was deleted by hand the plan blocks
 *   (narration_removed); reversed or at another speed it blocks (kept_narration_not_followable).
 * - Slots deleted by hand travel on (removedKeys, removedPicks with their cuts) unless options.restoreRemoved; with it the records of
 *   the removed picks (params.removedPicks) are among ctx.picked, so each comes back at its own cut.
 * - The run's tracks by role (pictures, own sound, music: familyFilm.ts filmRunTracks; voice: the narration's track) are reused, and
 *   the previous mix is passed, so a level or ducking set by hand on a reused track survives a rebuild that does not change the mix.
 * Fill rule, recorded cuts and keys: the planner (core story.ts). Nothing is stored beyond the run record (storyRunRecordParams).
 */
import * as T from '@pulseframe/time';
import {
  clipEnd, findClip, removedByHand, STORY_BINDS, storyRunPicked, storyRunRemovedPicks,
  type FilmKeptClip, type ProjectDocument, type RecipeRun, type RegenerateOptions, type SlotRecord, type StoryPicked, type StoryPlanContext,
} from '@pulseframe/core';
import { filmRunTracks } from './familyFilm.ts';
import { runHandEdits, withoutClips } from './templates.ts';

/** True once storyRegeneration is built (W1 flips it). */
export const STORY_REGEN_BUILT: boolean = true;

export interface StoryRegeneration {
  /** The run's clips that are replaced (untouched, or only moved in time). */
  removable: string[];
  /** Clips kept by hand and their link partners (the narration clip always among keepIds, not necessarily here). */
  protectedIds: string[];
  keepSlots: SlotRecord[]; removedSlots: SlotRecord[]; removedPicks: StoryPicked[];
  /** Ids the new run record keeps: kept clips, the narration clip, and the run's tracks that still exist. */
  keepIds: string[];
  /** The document without the removable clips (what the plan is made against). */
  without: ProjectDocument;
  /** The regeneration part of the planner's context (picked, kept, keptKeys, removedKeys, removedPicks, movedKeys, narrationClipId, reuseTracks, previousOwnSound, previousMusic). */
  ctx: Omit<StoryPlanContext, 'voice' | 'voiceState' | 'capture' | 'title' | 'titleLookId'>;
  movedKeys: string[];
}

/** The kept clips of a run as the planner sees them (occupied intervals, their slot keys and kinds), in project frames. */
function keptClips(doc: ProjectDocument, protectedIds: readonly string[], slots: readonly SlotRecord[]): FilmKeptClip[] {
  const rate = doc.settings.frameRate;
  return protectedIds.flatMap((id) => {
    const f = findClip(doc, id);
    if (!f) return [];
    const slot = slots.find((s) => s.clipId === id);
    const kind: FilmKeptClip['kind'] = slot?.kind === 'text' ? 'text' : slot?.kind === 'music' ? 'music' : f.track.kind === 'audio' ? 'sound' : 'picture';
    return [{ key: slot?.key ?? null, clipId: id, assetId: f.clip.type === 'media' ? f.clip.assetId : null, kind, startFrame: T.nearestFrameIndex(f.clip.start, rate), endFrame: T.nearestFrameIndex(clipEnd(f.clip), rate) }];
  });
}

export function storyRegeneration(doc: ProjectDocument, run: RecipeRun, params: Record<string, unknown>, options: RegenerateOptions = {}): StoryRegeneration {
  const slots = run.slots ?? [];
  const narrationSlot = slots.find((s) => s.key === STORY_BINDS.narration);
  const narrationId = narrationSlot?.clipId;
  // the narration is never among the clips that can be replaced, whatever was done to it
  const live = run.createdIds.filter((id) => id !== narrationId && !!findClip(doc, id));
  const { protectedIds, movedBack } = runHandEdits(doc, run, live, undefined, 'any-move');
  const removable = live.filter((id) => !protectedIds.includes(id));
  const keptSlots = slots.filter((s) => protectedIds.includes(s.clipId));
  const movedKeys = [...new Set(slots.filter((s) => movedBack.includes(s.clipId)).map((s) => s.key))];
  const removedSlots = options.restoreRemoved ? [] : removedByHand(doc, slots).filter((s) => s.key !== STORY_BINDS.narration);
  // what each pick showed and where it was cut (C1): the run's picks, then the picks it carried on as deleted by hand
  const picked = storyRunPicked(run.params), carried = storyRunRemovedPicks(run.params);
  const known = new Map<string, StoryPicked>();
  for (const r of [...carried, ...picked]) known.set(r.key, r);
  const removedPicks = removedSlots.flatMap((s) => { const k = known.get(s.key); return s.kind === 'picture' && k ? [k] : []; });
  const narrationLives = !!narrationId && !!findClip(doc, narrationId);
  const keepSlots = [...keptSlots, ...removedSlots, ...(narrationSlot && narrationLives ? [narrationSlot] : [])];
  const without = withoutClips(doc, removable);
  const narrationTrack = narrationLives ? findClip(doc, narrationId!)!.track.id : undefined;
  // the run's tracks by role: the film's rule for pictures, own sound and music, with the voice track set aside; the voice track is the narration's
  const reuseTracks: NonNullable<StoryPlanContext['reuseTracks']> = { ...filmRunTracks(doc, { ...run, createdIds: run.createdIds.filter((id) => id !== narrationTrack) }) };
  for (const role of ['pictures', 'ownSound', 'musicTrack'] as const) if (reuseTracks[role] === narrationTrack) delete reuseTracks[role];
  if (narrationTrack) reuseTracks.voiceTrack = narrationTrack;
  const trackIds = new Set(Object.values(doc.sequences).flatMap((q) => q.tracks.map((t) => t.id)));
  const keepIds = [...new Set([
    ...protectedIds, ...(narrationLives ? [narrationId!] : []),
    ...run.createdIds.filter((id) => trackIds.has(id)), ...Object.values(reuseTracks).filter((id): id is string => typeof id === 'string'),
  ])];
  const ownSound = run.params.ownSound;
  const previousOwnSound = ownSound === 'under' || ownSound === 'mute' ? ownSound : undefined;
  const musicSlot = slots.find((s) => s.kind === 'music');
  const previousMusic = typeof run.params.musicAssetId === 'string' && (!musicSlot || run.createdIds.includes(musicSlot.clipId));
  void params;
  const ctx: StoryRegeneration['ctx'] = {
    // with restoreRemoved the removed picks' records come back with them, so each returns at its own cut
    picked: options.restoreRemoved ? [...picked, ...carried.filter((r) => !picked.some((p) => p.key === r.key))] : picked,
    kept: keptClips(doc, protectedIds, slots),
    keptKeys: keptSlots.map((s) => s.key),
    removedKeys: removedSlots.map((s) => s.key),
    removedPicks,
    ...(movedKeys.length ? { movedKeys } : {}),
    // the narration's slot is passed even when its clip is gone, so the planner blocks (narration_removed) instead of making it again
    ...(narrationId !== undefined ? { narrationClipId: narrationId } : {}),
    reuseTracks,
    ...(previousOwnSound ? { previousOwnSound } : {}),
    previousMusic,
  };
  return { removable, protectedIds, keepSlots, removedSlots, removedPicks, keepIds, without, ctx, movedKeys };
}
