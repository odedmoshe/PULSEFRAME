/**
 * «ספרו מה היה» on the server (wave 7 story track; .artifacts/wave7/story-decisions.md; W2 builds the bodies), mirroring
 * familyFilm.ts: plan (read-only), apply (ONE internal apply_template committed through governance against the revision the plan
 * was built from), regenerate (storyRegeneration.ts, W1: hand edits kept, 'any-move', the narration always kept). Reached through
 * the recipe routes and MCP recipe tools (recipes.ts dispatches recipe 'story' and runs 'template:tpl.story' here; templates.ts
 * sends a story run's regeneration here too). No new route, no new tool.
 *
 * - The context (core StoryPlanContext) is built here: the narration's voice measure from its waveform peaks (level 0, origin as
 *   derive.ts decodes it; wait at most STORY.waitWaveformMs for the row, then voiceState 'pending'), capture times and the title
 *   (familyFilm.ts filmContext with no closing card). The measure is never stored (no schema field). The plan view carries this
 *   context, not ops, so the browser plans its ghost with the same inputs (C3).
 * - Permissions: the film's. Plan observe; apply and regenerate need edit, propose mode is refused (403 insufficient_scope), a grant
 *   limited to tracks or a time range is refused (403 out_of_scope), a credential without the people scope is refused a title with
 *   an {age:…} field (403 people_scope_required), on the request and on the plan's own title steps.
 * - A regeneration with other taps is refused (409 story_retap_not_built): tapping again on an applied story is not in version 1.
 * - CHILDREN'S DATA: the narration is the family's voice: it is read here from the local store only and never leaves the machine.
 * - While STORY_SERVER_BUILT is false every call answers 501 story_not_built AFTER the permission checks; nothing is planned or changed.
 * Every refusal's English sentence is fixed here (STORY_API_ERRORS); the Hebrew wording is packages/i18n/src/story.ts HE_STORY.
 */
import type { RegenerateOptions, StoryApplyResult, StoryPlanView, StoryRegenerateResult } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { holdsAgeField } from './familyFilm.ts';
import { peopleAccess, PEOPLE_SCOPE_REQUIRED } from './peoplePrivacy.ts';
import { ApiError, type Store } from './store.ts';

/** True once the bodies below are built (W2 flips it). */
export const STORY_SERVER_BUILT: boolean = false;

/** The fixed refusals of the story (Hebrew: i18n story.ts HE_STORY; story-wording.test.ts provokes each). */
export const STORY_API_ERRORS = {
  notBuilt: () => new ApiError(501, 'story_not_built', 'telling a story is not built in this version yet', {}, 'Nothing was changed. The family film, recipes and templates still work.'),
  propose: () => new ApiError(403, 'insufficient_scope', 'this credential may only propose edits, and a story cannot be proposed: it is applied through an internal step that a proposal does not carry', { mode: 'propose' }, 'Ask the project owner to make the story, or for a grant in edit mode. The plan still shows what it would do.'),
  ages: () => new ApiError(403, PEOPLE_SCOPE_REQUIRED, 'this credential may not make a story whose title shows an age: an age is computed from a birth date', {}, 'Leave the age field out of the title text ({name:…} is allowed), or ask the owner to make the story.'),
  blocked: (first: string, blocking: unknown) => new ApiError(409, 'story_blocked', `the story cannot be made like this: ${first}`, { blocking }, 'See the plan: restore the narration, or choose other pictures.'),
  runNotFound: (runId: string) => new ApiError(404, 'not_found', `story run ${runId} not found`, { runId }, 'A story run id is returned by apply (runId).'),
  badParams: () => new ApiError(400, 'invalid_request', 'params must be an object of story parameters to change'),
  keyClash: (key: string) => new ApiError(500, 'invalid_result', `the story plan gave a new slot the key ${key}, which a clip kept by hand holds`, { key }, 'This is a fault in this build; nothing was changed.'),
  retap: () => new ApiError(409, 'story_retap_not_built', 'tapping again on a story that was already made is not in this version', {}, 'Undo the story and tap again, or rebuild it with the same taps.'),
} as const;
export type StoryApiErrorKey = keyof typeof STORY_API_ERRORS;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function refuseAges(principal: Principal, params: unknown) {
  if (peopleAccess(principal) === 'full' || !isObject(params)) return;
  if (holdsAgeField(params.openingText)) throw STORY_API_ERRORS.ages();
}
/** Checks before a story may change a project: the grant covers the project, edit rights (propose refused), no track/range limit. */
function mayApply(gov: Governance, principal: Principal, projectId: string) {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind === 'agent' && principal.mode === 'propose') throw STORY_API_ERRORS.propose();
  gov.assertMayAct(principal, projectId, 'edit');
  gov.assertUnrestricted(principal, 'make a story (it adds tracks, clips and a run record)');
}
const refuseNotBuilt = () => { if (!STORY_SERVER_BUILT) throw STORY_API_ERRORS.notBuilt(); };

/** Read-only: what the story would be in this project now, at which revision, and the context it was planned with. */
export async function planStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown): Promise<StoryPlanView> {
  gov.assertMayAct(principal, projectId, 'observe');
  refuseAges(principal, params);
  refuseNotBuilt();
  store.getProject(projectId);
  throw STORY_API_ERRORS.notBuilt();
}

/** Apply: plan against the current revision and commit ONE apply_template against exactly that revision (or `expectedRevision`). */
export async function applyStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown, _expectedRevision?: number): Promise<StoryApplyResult> {
  mayApply(gov, principal, projectId);
  refuseAges(principal, params);
  refuseNotBuilt();
  store.getProject(projectId);
  throw STORY_API_ERRORS.notBuilt();
}

/**
 * Regenerate a story run with changed options (music, own sound, title, pictures left out): what nobody changed is replaced, hand
 * edits are kept (storyRegeneration.ts), every surviving picture keeps its recorded cut. Other `cutsMs` → 409 story_retap_not_built.
 */
export async function regenerateStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, _expectedRevision?: number, _options: RegenerateOptions = {}): Promise<StoryRegenerateResult> {
  mayApply(gov, principal, projectId);
  if (newParams !== undefined && !isObject(newParams)) throw STORY_API_ERRORS.badParams();
  refuseAges(principal, newParams);
  refuseNotBuilt();
  store.getProject(projectId);
  throw STORY_API_ERRORS.runNotFound(runId);
}
