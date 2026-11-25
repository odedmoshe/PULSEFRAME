/**
 * Recipes on the server (SPEC §23): plan (read-only), apply (one transaction through governance), regenerate
 * (replace what the last run created and nobody touched; keep what was edited by hand).
 */
import * as T from '@pulseframe/time';
import { FAMILY_FILM_RECIPE_ID, FAMILY_FILM_RUN_RECIPE_ID, timeOriginSeconds, closedGapOnly, findClip, fingerprint, isInPlaceRecipe, onOtherTrack, MULTICAM_AUTO_RECIPE_ID, multicamGroupOf, planRecipe, RecipeError, recordsRanges, type LevelEnvelope, type PlanContext, type RecipePlan, type RegenerateOptions, type TimeRange } from '@pulseframe/core';
import { envelopeOf } from './envelope.ts';
import { multicamDerivatives } from './multicamSync.ts';
import { applyFamilyFilmFor, planFamilyFilmFor, regenerateFamilyFilmFor } from './familyFilm.ts';
import { own } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { detectSilences, heavy } from './analysis.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

const STATUS: Record<RecipeError['code'], number> = { not_found: 404, needs_analysis: 409, invalid_args: 400, nothing_to_do: 409, not_built: 501, untimed_copy: 422 };
const wrap = <R>(fn: () => R): R => {
  try { return fn(); } catch (e) {
    if (e instanceof RecipeError) throw new ApiError(STATUS[e.code], e.code === 'nothing_to_do' ? 'nothing_to_do' : e.code === 'needs_analysis' ? 'needs_analysis' : e.code === 'not_found' ? 'not_found' : e.code === 'not_built' ? 'not_built' : e.code === 'untimed_copy' ? 'untimed_copy' : 'invalid_request', e.message, {}, e.hint);
    throw e;
  }
};

async function context(store: Store, projectId: string, recipeId: string, params: any, protectedRanges?: TimeRange[]): Promise<PlanContext> {
  const ctx: PlanContext = { protectedRanges };
  if (recipeId === 'tidy-speech' && typeof params?.assetId === 'string') {
    const asset = own(store.getProject(projectId).doc.assets, params.assetId);
    if (asset?.audio) ctx.silences = { [params.assetId]: await heavy(() => detectSilences(store.blobPath(asset.contentHash), { thresholdDb: -35, minSeconds: 0.5 }, timeOriginSeconds(asset))) };
  }
  // multicam auto-switch (ADR-0020): the level envelopes of the speakers' mic files, built under heavy() where missing
  if (recipeId === MULTICAM_AUTO_RECIPE_ID && typeof params?.groupId === 'string') {
    const doc = store.getProject(projectId).doc;
    const group = multicamGroupOf(doc, params.groupId);
    const levels: Record<string, LevelEnvelope> = {};
    for (const s of group?.speakers ?? []) for (const piece of group!.angles.find((a) => a.id === s.micAngleId)?.pieces ?? []) {
      const asset = Object.hasOwn(doc.assets, piece.assetId) ? doc.assets[piece.assetId] : undefined;
      if (!piece.anchors.length || !asset?.audio || levels[piece.assetId]) continue;
      levels[piece.assetId] = await envelopeOf(store, multicamDerivatives(), asset);
    }
    ctx.multicamLevels = levels;
  }
  return ctx;
}
const view = (revision: number, plan: RecipePlan) => ({ revision, recipeId: plan.recipeId, params: plan.params, steps: plan.steps, basis: plan.basis, operations: plan.ops.length, alternatives: plan.alternatives, ...(plan.skippedClips ? { skippedClips: plan.skippedClips } : {}), method: 'rule-based plan from project data; no language model', note: 'Nothing was changed. Apply it to make these edits as one undoable step.' });

/**
 * The family film (ADR-0026) is listed as recipe 'family-film' but planned by its own planner and applied through apply_template
 * (familyFilm.ts); its runs are 'template:tpl.family-film'. The recipe routes and tools send it there. Planning it needs the
 * caller's governance and credential (people rule, ADR-0021), which the routes and tools pass.
 */
const needsCaller = (gov?: Governance, principal?: Principal): { gov: Governance; principal: Principal } => {
  if (!gov || !principal) throw new ApiError(500, 'internal_error', 'the family film needs the caller\'s credential to be planned');
  return { gov, principal };
};
export async function planRecipeFor(store: Store, projectId: string, recipeId: string, params: unknown, gov?: Governance, principal?: Principal) {
  if (recipeId === FAMILY_FILM_RECIPE_ID) { const c = needsCaller(gov, principal); return planFamilyFilmFor(store, c.gov, c.principal, projectId, params); }
  const p = store.getProject(projectId);
  const ctx = await context(store, projectId, recipeId, params);
  return view(p.revision, wrap(() => planRecipe(p.doc, recipeId, params, ctx)));
}

export async function applyRecipe(store: Store, gov: Governance, principal: Principal, projectId: string, recipeId: string, params: unknown, expectedRevision?: number) {
  if (recipeId === FAMILY_FILM_RECIPE_ID) return applyFamilyFilmFor(store, gov, principal, projectId, params, expectedRevision);
  const p = store.getProject(projectId);
  const ctx = await context(store, projectId, recipeId, params);
  const plan = wrap(() => planRecipe(p.doc, recipeId, params, ctx));
  // The plan was built from revision p.revision; committing against exactly that revision means a concurrent edit cannot be silently built upon.
  const r = gov.commitAs(principal, { projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Recipe: ${plan.steps[0] ?? recipeId}`.slice(0, 120), ops: [{ op: 'apply_recipe', args: { recipeId, params: plan.params, steps: plan.steps, ops: plan.ops, ...(recordsRanges(recipeId) ? { recordRanges: true, recordTracks: true } : {}) } }] }) as any;
  return { revision: r.revision, runId: r.results?.[0]?.output?.runId ?? null, createdIds: r.results?.[0]?.output?.createdIds ?? [], steps: plan.steps, basis: plan.basis, alternatives: plan.alternatives, ...(plan.skippedClips ? { skippedClips: plan.skippedClips } : {}), ...(r.proposal ? { proposal: r.proposal } : {}) };
}

export async function regenerateRecipe(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown, options: RegenerateOptions = {}) {
  const p = store.getProject(projectId);
  const run = own(p.doc.recipeRuns, runId);
  if (!run) throw new ApiError(404, 'not_found', `recipe run ${runId} not found`, { runId });
  if (run.recipeId === FAMILY_FILM_RUN_RECIPE_ID) return regenerateFamilyFilmFor(store, gov, principal, projectId, runId, newParams, undefined, options);
  // "Protected" = a clip the run created whose content no longer matches what the run left (compared by content fingerprint,
  // so the answer does not depend on history: an undo that restores a hand edit restores its protection too).
  // A run that records where its clips were, with their tracks (beat-montage from the amendment of 2026-11-24 on): a clip that
  // moved earlier ONLY because a delete before it closed the gap is not edited by hand (core closedGapOnly: moved by exactly the
  // length of the run's clips deleted before it on its track that closed their gaps, nothing else changed). Those are placed again on the beat like
  // untouched ones instead of being kept one segment early for good. A clip moved in any other way was dragged by hand and is
  // kept, as before; so is one taken to another track than recorded (onOtherTrack). A run that recorded no tracks (older) names
  // neither and behaves as before: its moved clips are kept.
  const live = run.createdIds.filter((id) => !!findClip(p.doc, id));
  const ranged = recordsRanges(run.recipeId);
  const moved = ranged ? closedGapOnly(p.doc, run, live) : [], elsewhere = ranged ? onOtherTrack(p.doc, run, live) : [];
  const protectedIds = live.filter((id) => elsewhere.includes(id) || (fingerprint(findClip(p.doc, id)!.clip) !== run.fingerprints?.[id] && !moved.includes(id)));
  // A recipe regenerated IN PLACE (multicam auto-switch, ADR-0020) re-cuts the segments where they are: nothing is removed,
  // it plans on the current document around the protected ranges, and the hand-edited segments are kept (keepIds).
  const inPlace = isInPlaceRecipe(run.recipeId);
  const removable = inPlace ? [] : live.filter((id) => !protectedIds.includes(id));
  const protectedRanges = protectedIds.map((id) => { const c = findClip(p.doc, id)!.clip; return { start: c.start, end: T.add(c.start, c.duration) }; });
  // clips deleted by hand (ADR-0016 decision 6): a run that records where its clips were (run.ranges; beat-montage) names them by
  // their ids missing from the document; their ranges are left empty and carried on, unless restoreRemoved. Older runs record none.
  const ranges = recordsRanges(run.recipeId) ? run.ranges ?? {} : {};
  const removedRanges = options.restoreRemoved ? {} : Object.fromEntries(Object.entries(ranges).filter(([id]) => !findClip(p.doc, id)));
  // Plan against the document as it will be once the untouched clips are gone.
  const without = structuredClone(p.doc);
  for (const id of removable) { const f = findClip(without, id); if (f) f.track.clips.splice(f.index, 1); }
  const params = newParams ?? run.params;
  const ctx = { ...await context(store, projectId, run.recipeId, params, protectedRanges), removedRanges: Object.values(removedRanges) };
  const plan = wrap(() => planRecipe(without, run.recipeId, params, ctx));
  // what the answer names as removed: the deleted clips whose place is in fact left empty. One whose whole range a kept clip now
  // lies on (an older run's clips, moved there by the delete that closed the gap) is carried on in the record but not named.
  const fi = (t: T.RationalTime) => T.nearestFrameIndex(t, p.doc.settings.frameRate);
  const keptFrames = protectedRanges.map((r) => [fi(r.start), fi(r.end)] as const).sort((a, b) => a[0] - b[0]);
  const filled = (r: TimeRange) => { let reach = fi(r.start); for (const [s, e] of keptFrames) { if (s > reach) break; reach = Math.max(reach, e); } return reach >= fi(r.end); };
  const removed = Object.keys(removedRanges).filter((id) => !filled(removedRanges[id]!));
  const movedBack = moved.filter((id) => !protectedIds.includes(id));
  const steps = [...plan.steps, ...(movedBack.length ? [`Place ${movedBack.length} clip(s) again that had moved earlier only because a delete before them closed the gap`] : [])].slice(0, 50);
  const r = gov.commitAs(principal, { projectId, expectedRevision: p.revision, allowInternal: true, label: `Regenerate recipe: ${plan.steps[0] ?? run.recipeId}`.slice(0, 120), ops: [{ op: 'apply_recipe', args: { runId, recipeId: run.recipeId, params: plan.params, steps, removeClipIds: removable, keepIds: protectedIds, ops: plan.ops, ...(recordsRanges(run.recipeId) ? { recordRanges: true, recordTracks: true, ...(Object.keys(removedRanges).length ? { keepRanges: removedRanges } : {}) } : {}) } }] }) as any;
  return { revision: r.revision, runId, replaced: removable.length, protected: protectedIds, removed, movedBack, createdIds: r.results?.[0]?.output?.createdIds ?? [], steps, basis: plan.basis, alternatives: plan.alternatives };
}
