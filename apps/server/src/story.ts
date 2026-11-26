/**
 * «ספרו מה היה» on the server (wave 7 story track; .artifacts/wave7/story-decisions.md), mirroring familyFilm.ts: plan (read-only),
 * apply (ONE internal apply_template committed through governance against the revision the plan was built from), regenerate
 * (storyRegeneration.ts, W1: hand edits kept, 'any-move', the narration always kept). Reached through the recipe routes and MCP
 * recipe tools (recipes.ts dispatches recipe 'story' and runs 'template:tpl.story' here; templates.ts sends a story run's
 * regeneration here too). No new route, no new tool.
 *
 * - The context (core StoryPlanContext) is built here on every call: the narration's voice measure from its waveform peaks, capture
 *   times and the title (familyFilm.ts filmContext with no closing card). The plan view carries this context, not ops, so the
 *   browser plans its ghost with the same inputs (C3).
 * - THE PEAKS: level 0 (min,max per 256 samples) of the waveform derivative, a mono 48 kHz decode made at import (derive.ts). That
 *   decode is run with aresample first_pts = the file's own start (derive.ts waveform: "drawn from the file's own start, also when
 *   its sound starts late"), so sample 0 of the peaks IS the editor's time zero of the file (Asset.timeOrigin is zero there; a late
 *   sound start is padded with silence). Peaks index k therefore covers source samples [256k, 256k+256) at VOICE_RATE with no shift,
 *   which is the coordinate of VoiceMeasure.ranges and clip.sourceIn. A row of another rate or bucket size is not read (pending).
 * - THE WAIT: a waveform row that is queued or running is waited for at most STORY.waitWaveformMs (polling; the moments.ts
 *   waitForRow precedent), then the plan goes ahead with voiceState 'pending' (the planner warns voice_pending, cuts are even).
 *   A file without sound (no audio stream, row not-applicable) is 'no_sound'. A missing or failed row is 'pending' at once: waiting
 *   cannot make it.
 * - NOTHING ABOUT THE VOICE IS STORED: the measure is computed from the peaks per call and only passed to the planner and returned in
 *   the plan view's context (cut 4: no schema field, no derivative, no cache).
 * - Permissions: the film's. Plan observe; apply and regenerate need edit, propose mode is refused (403 insufficient_scope), a grant
 *   limited to tracks or a time range is refused (403 out_of_scope), a credential without the people scope is refused a title with
 *   an {age:…} field (403 people_scope_required), on the request and on the plan's own title steps.
 * - A regeneration with other taps is refused (409 story_retap_not_built): tapping again on an applied story is not in version 1.
 * - A plan with blocking lines (narration_removed, kept_narration_not_followable) is refused at apply and regenerate (409 story_blocked).
 * - CHILDREN'S DATA: the narration is the family's voice: it is read here from the local store only and never leaves the machine.
 * - A core part that is not built yet (StoryNotBuilt from planStory, voiceActivity or storyRegeneration) answers 501
 *   story_not_built: nothing is planned or changed, nothing is made up.
 * Every refusal's English sentence is fixed here (STORY_API_ERRORS); the Hebrew wording is packages/i18n/src/story.ts HE_STORY.
 */
import fs from 'node:fs';
import {
  planStory, sameCuts, STORY, STORY_DRAFT_LABEL, STORY_RUN_RECIPE_ID, STORY_TEMPLATE_ID, STORY_VERSION, StoryError, storyRunParams, storyRunRecordParams,
  VOICE_RATE, VOICE_RULES, voiceActivity,
  type Asset, type ProjectDocument, type RegenerateOptions, type SlotRecord, type StoryApplyResult, type StoryPlan, type StoryPlanContext, type StoryPlanView, type StoryRegenerateResult, type VoiceMeasure,
} from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { Derivatives } from './derive.ts';
import type { Governance } from './governance.ts';
import { filmContext, holdsAgeField, refuseAgesInPlan } from './familyFilm.ts';
import { peopleAccess, PEOPLE_SCOPE_REQUIRED } from './peoplePrivacy.ts';
import { ApiError, type Store } from './store.ts';
import { storyRegeneration, storyRegenRecordParams } from './storyRegeneration.ts';

/** True once the bodies below are built (W2 flips it). */
export const STORY_SERVER_BUILT: boolean = true;

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
const own = <V>(rec: Readonly<Record<string, V>> | undefined, key: string): V | undefined => (rec && Object.hasOwn(rec, key) ? rec[key] : undefined);
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

/** The planner's refusals as API errors (StoryNotBuilt, from a core part not built yet, is 501 story_not_built). */
const STATUS: Record<StoryError['code'], number> = { not_found: 404, incompatible: 422, out_of_bounds: 422, nothing_to_do: 409, invalid_args: 400, not_built: 501 };
const CODE: Record<StoryError['code'], string> = { not_found: 'not_found', incompatible: 'incompatible', out_of_bounds: 'out_of_bounds', nothing_to_do: 'nothing_to_do', invalid_args: 'invalid_request', not_built: 'story_not_built' };
const wrap = <R>(fn: () => R): R => {
  try { return fn(); } catch (e) {
    if (e instanceof StoryError) {
      if (e.code === 'not_built') { const nb = STORY_API_ERRORS.notBuilt(); nb.details = { part: e.hint ?? null }; throw nb; }
      throw new ApiError(STATUS[e.code], CODE[e.code], e.message, {}, e.hint);
    }
    throw e;
  }
};

// ---------- the voice: waveform peaks → VoiceMeasure (computed per call, never stored) ----------
const POLL_MS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A reader of the derivative rows of a store (the canonical row reader of derive.ts; reading never queues anything). */
const readers = new WeakMap<Store, Derivatives>();
const rowsOf = (store: Store): Derivatives => { let d = readers.get(store); if (!d) { d = new Derivatives(store); readers.set(store, d); } return d; };

/** What the waveform gives for a file: its level-0 peaks (interleaved min,max per 256 samples from the file's time zero), or why not. */
export type VoicePeaks = { state: 'ready'; peaks: Int16Array; totalSamples: number } | { state: 'pending' | 'no_sound'; why: string };
/**
 * The level-0 peaks of an asset's waveform, waiting at most `waitMs` while its row is queued or running. Never decodes anything.
 * Exported for its unit test.
 */
export async function readVoicePeaks(store: Store, asset: Pick<Asset, 'contentHash' | 'audio'> | undefined, waitMs: number = STORY.waitWaveformMs): Promise<VoicePeaks> {
  if (!asset) return { state: 'no_sound', why: 'not in the project' };
  if (!asset.audio) return { state: 'no_sound', why: 'the file has no sound track' };
  const d = rowsOf(store), t0 = Date.now();
  let row = d.get(asset.contentHash, 'waveform');
  while (row && (row.status === 'queued' || row.status === 'running') && Date.now() - t0 < waitMs) {
    await sleep(Math.min(POLL_MS, Math.max(1, waitMs - (Date.now() - t0))));
    row = d.get(asset.contentHash, 'waveform');
  }
  if (!row) return { state: 'pending', why: 'the waveform was never queued' };
  if (row.status === 'not-applicable') return { state: 'no_sound', why: 'the file has no sound track' };
  if (row.status === 'failed') return { state: 'pending', why: 'the waveform could not be made' };
  if (row.status !== 'ready' || !row.blobHash) return { state: 'pending', why: `the waveform was not ready within ${waitMs} ms` };
  const meta = row.meta as { sampleRate?: number; totalSamples?: number; levels?: { samplesPerBucket: number; buckets: number; byteOffset: number }[] } | null;
  const l0 = meta?.levels?.[0];
  if (meta?.sampleRate !== VOICE_RATE || !l0 || l0.samplesPerBucket !== VOICE_RULES.samplesPerBucket || !Number.isInteger(meta.totalSamples) || meta.totalSamples! <= 0) return { state: 'pending', why: 'the waveform is not in the form the measurement reads' };
  const file = store.blobPath(row.blobHash);
  if (!fs.existsSync(file)) return { state: 'pending', why: 'the waveform file is missing' };
  const bytes = fs.readFileSync(file);
  if (l0.byteOffset + l0.buckets * 4 > bytes.length) return { state: 'pending', why: 'the waveform file is shorter than its record' };
  const peaks = new Int16Array(l0.buckets * 2);
  for (let i = 0; i < peaks.length; i++) peaks[i] = bytes.readInt16LE(l0.byteOffset + 2 * i);
  return { state: 'ready', peaks, totalSamples: meta.totalSamples! };
}

/** The voice part of the context: the narration's measure, or null with the state saying why. Throws StoryNotBuilt before W1. */
async function voiceOf(store: Store, asset: Asset | undefined): Promise<Pick<StoryPlanContext, 'voice' | 'voiceState'>> {
  const r = await readVoicePeaks(store, asset);
  if (r.state !== 'ready') return { voice: null, voiceState: r.state };
  const voice: VoiceMeasure = voiceActivity(r.peaks, r.totalSamples);
  return { voice, voiceState: 'measured' };
}

/** The voice of the narration that `params` names in `doc` (the file as it is now: the measure follows the file, not its clip). */
async function narrationVoice(store: Store, doc: ProjectDocument, params: unknown): Promise<Pick<StoryPlanContext, 'voice' | 'voiceState'>> {
  const p = isObject(params) ? params : {};
  const narration = typeof p.narrationAssetId === 'string' ? own(doc.assets, p.narrationAssetId) : undefined;
  try { return await voiceOf(store, narration); } catch (e) { return wrap(() => { throw e; }); }
}
/** The capture times and the opening title of the story, from filmContext (the film's rules; a story has no closing card). */
function titleOf(doc: ProjectDocument, params: unknown): Pick<StoryPlanContext, 'capture' | 'title'> {
  const film = filmContext(doc, { ...(isObject(params) ? params : {}), closingCard: false });
  return { capture: film.capture, title: film.title };
}
/**
 * The planner's context (core StoryPlanContext) for `params`: the voice of the narration (waiting for its waveform first), then the
 * capture times and title from the document as it is AFTER the wait, which is also the document returned (the plan is made on it).
 * Exported for its unit test.
 */
export async function storyContext(store: Store, projectId: string, params: unknown): Promise<{ p: ReturnType<Store['getProject']>; context: StoryPlanContext }> {
  const voice = await narrationVoice(store, store.getProject(projectId).doc, params);
  const p = store.getProject(projectId);
  return { p, context: { ...voice, ...titleOf(p.doc, params) } };
}

const NOTE = 'Nothing was changed. Apply it to make the story as one undoable step; everything it makes stays an ordinary editable clip.';
const view = (revision: number, plan: StoryPlan, context: StoryPlanContext): StoryPlanView => {
  const { ops: _o, slots: _s, ...rest } = plan;
  return { ...rest, revision, operations: plan.ops.length, label: STORY_DRAFT_LABEL, note: plan.blocking.length ? 'Nothing was changed. This plan cannot be applied as it is: see blocking.' : NOTE, context };
};
const refuseBlocked = (plan: StoryPlan) => { if (plan.blocking.length) throw STORY_API_ERRORS.blocked(plan.blocking[0]!.message, plan.blocking); };
type CommitOut = { revision: number; results?: { output?: { runId?: string; createdIds?: string[]; slots?: SlotRecord[] } }[] };
async function planned(store: Store, projectId: string, params: unknown) {
  const { p, context } = await storyContext(store, projectId, params);
  return { p, context, plan: wrap(() => planStory(p.doc, params, context)) };
}

/** Read-only: what the story would be in this project now, at which revision, and the context it was planned with. */
export async function planStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown): Promise<StoryPlanView> {
  gov.assertMayAct(principal, projectId, 'observe');
  refuseAges(principal, params);
  refuseNotBuilt();
  const { p, context, plan } = await planned(store, projectId, params);
  return view(p.revision, plan, context);
}

/** Apply: plan against the current revision and commit ONE apply_template against exactly that revision (or `expectedRevision`). */
export async function applyStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, params: unknown, expectedRevision?: number): Promise<StoryApplyResult> {
  mayApply(gov, principal, projectId);
  refuseAges(principal, params);
  refuseNotBuilt();
  const { p, plan } = await planned(store, projectId, params);
  refuseAgesInPlan(principal, plan.ops);
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Story: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRunRecordParams(plan, []), steps: plan.steps, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return { revision: r.revision, runId: out.runId ?? '', createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded, chips: plan.chips, predicted: plan.predicted };
}

/** The taps of a request when it names them as a list of whole numbers; undefined when absent (a malformed value is the planner's to refuse). */
const tapsOf = (params: Record<string, unknown> | undefined): number[] | undefined => {
  if (!params || !Object.hasOwn(params, 'cutsMs')) return undefined;
  const v = params.cutsMs;
  return Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? v as number[] : undefined;
};

/**
 * Regenerate a story run with changed options (music, own sound, title, pictures left out): what nobody changed is replaced, hand
 * edits are kept (storyRegeneration.ts), every surviving picture keeps its recorded cut. Other `cutsMs` → 409 story_retap_not_built.
 */
export async function regenerateStoryFor(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, expectedRevision?: number, options: RegenerateOptions = {}): Promise<StoryRegenerateResult> {
  mayApply(gov, principal, projectId);
  if (newParams !== undefined && !isObject(newParams)) throw STORY_API_ERRORS.badParams();
  refuseAges(principal, newParams);
  refuseNotBuilt();
  const first = store.getProject(projectId);
  const run0 = own(first.doc.recipeRuns, runId);
  if (!run0 || run0.recipeId !== STORY_RUN_RECIPE_ID) throw STORY_API_ERRORS.runNotFound(runId);
  const previous = storyRunParams(run0.params);
  // tapping again on an applied story is not in version 1: other taps are refused before anything is planned
  const taps = tapsOf(newParams as Record<string, unknown> | undefined);
  if (taps && !sameCuts(taps, tapsOf(previous) ?? [])) throw STORY_API_ERRORS.retap();
  const params: Record<string, unknown> = { ...previous, ...(newParams as Record<string, unknown> | undefined) };
  refuseAges(principal, params);
  // the voice first (it may wait for the waveform), then the document the regeneration is made on
  const voice = await narrationVoice(store, first.doc, params);
  const p = store.getProject(projectId);
  const run = own(p.doc.recipeRuns, runId);
  if (!run || run.recipeId !== STORY_RUN_RECIPE_ID) throw STORY_API_ERRORS.runNotFound(runId);
  const regen = wrap(() => storyRegeneration(p.doc, run, params, options));
  const { removable, protectedIds, keepSlots, removedSlots, keepIds, without, ctx: regenCtx, movedKeys } = regen;
  const context: StoryPlanContext = { ...voice, ...titleOf(without, params), ...regenCtx };
  const plan = wrap(() => planStory(without, params, context));
  refuseAgesInPlan(principal, plan.ops);
  // a new slot never takes a key a kept slot holds (apply_template drops a slot only when key AND clip match): a planner fault
  const clash = plan.slots.find((s) => keepSlots.some((k) => k.key === s.key));
  if (clash) throw STORY_API_ERRORS.keyClash(clash.key);
  refuseBlocked(plan);
  const r = gov.commitAs(principal, {
    projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Rebuild story: ${plan.steps[0] ?? ''}`.slice(0, 120),
    ops: [{ op: 'apply_template', args: { runId, templateId: STORY_TEMPLATE_ID, templateVersion: STORY_VERSION, params: storyRegenRecordParams(plan, regen), steps: plan.steps, removeClipIds: removable, keepIds, keepSlots, ops: plan.ops, slots: plan.slots, recordRanges: true } }],
  }) as CommitOut;
  const out = r.results?.[0]?.output ?? {};
  return {
    revision: r.revision, runId, createdIds: out.createdIds ?? [], slots: out.slots ?? [], steps: plan.steps, warnings: plan.warnings, picks: plan.picks, excluded: plan.excluded, chips: plan.chips, predicted: plan.predicted,
    replaced: removable.length, protected: protectedIds, removed: removedSlots.map((s) => s.key), movedBack: movedKeys, alternatives: plan.alternatives,
  };
}
