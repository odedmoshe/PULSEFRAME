/**
 * What a story regeneration starts from (W1; .artifacts/wave7/story-decisions.md §2, C1 and C2; film precedent familyFilm.ts
 * filmRegeneration). Pure; exported for its unit test and for story.ts (W2).
 * - runHandEdits(doc, run, live, undefined, 'any-move') (templates.ts): a picture whose only change is its place in time is NOT
 *   kept — it goes back to its recorded cut (movedKeys, warning moved_back); any other change keeps it exactly, with its link partners.
 * - The narration clip is never replaced: always in keepIds, passed as ctx.narrationClipId and read as it lies; when it was deleted by
 *   hand the plan blocks (narration_removed); reversed or at another speed it blocks (kept_narration_not_followable).
 * - Slots deleted by hand travel on (removedKeys, removedPicks with their cuts) unless options.restoreRemoved.
 * - The run's tracks by role (pictures, own sound, music, voice) are reused; the previous mix is passed so a level set by hand survives.
 * LEAD PRE-PASS: final signature only; throws StoryNotBuilt until W1 builds it.
 */
import { StoryNotBuilt, type ProjectDocument, type RecipeRun, type RegenerateOptions, type SlotRecord, type StoryPicked, type StoryPlanContext } from '@pulseframe/core';

/** True once storyRegeneration is built (W1 flips it). */
export const STORY_REGEN_BUILT: boolean = false;

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
export function storyRegeneration(_doc: ProjectDocument, _run: RecipeRun, _params: Record<string, unknown>, _options: RegenerateOptions = {}): StoryRegeneration {
  throw new StoryNotBuilt('storyRegeneration');
}
