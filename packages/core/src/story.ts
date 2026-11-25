/**
 * «ספרו מה היה» — the story planner (W1; contract storyContract.ts, rules in its header and in .artifacts/wave7/story-decisions.md).
 * LEAD PRE-PASS: final signatures only. Every function throws StoryNotBuilt until W1 builds it (never a made-up value).
 */
import type { ProjectDocument } from './schema.ts';
import { StoryNotBuilt, type PlanStory, type StoryPlanContext } from './storyContract.ts';

/** True once the planner below is built (W1 flips it). */
export const STORY_PLANNER_BUILT: boolean = false;

/** Pure. Plans a story on `doc` (the document as it will be once the run's untouched clips are gone, on regeneration). Throws StoryError. */
export const planStory: PlanStory = (_doc, _params, _ctx) => { throw new StoryNotBuilt('planStory'); };

/**
 * The picture while tapping (C3, C8): planStory with the taps so far (`tapsMs`, narration source ms), own sound muted, applied in
 * memory as one apply_template with a fixed idSeed, so the narration and music clips keep their ids and the sound plan never changes
 * between calls. A tap the plan holds (too_close, …) changes nothing. Null when the plan refuses (the view shows the base ghost).
 */
export function storyLiveDocument(_base: ProjectDocument, _params: unknown, _ctx: StoryPlanContext, _tapsMs: readonly number[]): ProjectDocument | null {
  throw new StoryNotBuilt('storyLiveDocument');
}
