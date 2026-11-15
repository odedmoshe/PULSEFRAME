/**
 * Recipes on the server (SPEC §23): plan (read-only), apply (one transaction through governance), regenerate
 * (replace what the last run created and nobody touched; keep what was edited by hand).
 */
import * as T from '@pulseframe/time';
import { findClip, fingerprint, planRecipe, RecipeError, type PlanContext, type RecipePlan, type TimeRange } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { detectSilences, heavy } from './analysis.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

const STATUS: Record<RecipeError['code'], number> = { not_found: 404, needs_analysis: 409, invalid_args: 400, nothing_to_do: 409 };
const wrap = <R>(fn: () => R): R => {
  try { return fn(); } catch (e) {
    if (e instanceof RecipeError) throw new ApiError(STATUS[e.code], e.code === 'nothing_to_do' ? 'nothing_to_do' : e.code === 'needs_analysis' ? 'needs_analysis' : e.code === 'not_found' ? 'not_found' : 'invalid_request', e.message, {}, e.hint);
    throw e;
  }
};

async function context(store: Store, projectId: string, recipeId: string, params: any, protectedRanges?: TimeRange[]): Promise<PlanContext> {
  const ctx: PlanContext = { protectedRanges };
  if (recipeId === 'tidy-speech' && typeof params?.assetId === 'string') {
    const asset = store.getProject(projectId).doc.assets[params.assetId];
    if (asset?.audio) ctx.silences = { [params.assetId]: await heavy(() => detectSilences(store.blobPath(asset.contentHash), { thresholdDb: -35, minSeconds: 0.5 })) };
  }
  return ctx;
}
const view = (revision: number, plan: RecipePlan) => ({ revision, recipeId: plan.recipeId, params: plan.params, steps: plan.steps, basis: plan.basis, operations: plan.ops.length, alternatives: plan.alternatives, method: 'rule-based plan from project data; no language model', note: 'Nothing was changed. Apply it to make these edits as one undoable step.' });

export async function planRecipeFor(store: Store, projectId: string, recipeId: string, params: unknown) {
  const p = store.getProject(projectId);
  const ctx = await context(store, projectId, recipeId, params);
  return view(p.revision, wrap(() => planRecipe(p.doc, recipeId, params, ctx)));
}

export async function applyRecipe(store: Store, gov: Governance, principal: Principal, projectId: string, recipeId: string, params: unknown, expectedRevision?: number) {
  const p = store.getProject(projectId);
  const ctx = await context(store, projectId, recipeId, params);
  const plan = wrap(() => planRecipe(p.doc, recipeId, params, ctx));
  // The plan was built from revision p.revision; committing against exactly that revision means a concurrent edit cannot be silently built upon.
  const r = gov.commitAs(principal, { projectId, expectedRevision: expectedRevision ?? p.revision, allowInternal: true, label: `Recipe: ${plan.steps[0] ?? recipeId}`.slice(0, 120), ops: [{ op: 'apply_recipe', args: { recipeId, params: plan.params, steps: plan.steps, ops: plan.ops } }] }) as any;
  return { revision: r.revision, runId: r.results?.[0]?.output?.runId ?? null, createdIds: r.results?.[0]?.output?.createdIds ?? [], steps: plan.steps, basis: plan.basis, alternatives: plan.alternatives, ...(r.proposal ? { proposal: r.proposal } : {}) };
}

export async function regenerateRecipe(store: Store, gov: Governance, principal: Principal, projectId: string, runId: string, newParams?: unknown) {
  const p = store.getProject(projectId);
  const run = p.doc.recipeRuns?.[runId];
  if (!run) throw new ApiError(404, 'not_found', `recipe run ${runId} not found`, { runId });
  // "Protected" = a clip the run created whose content no longer matches what the run left (compared by content fingerprint,
  // so the answer does not depend on history: an undo that restores a hand edit restores its protection too).
  const live = run.createdIds.filter((id) => !!findClip(p.doc, id));
  const protectedIds = live.filter((id) => fingerprint(findClip(p.doc, id)!.clip) !== run.fingerprints?.[id]);
  const removable = live.filter((id) => !protectedIds.includes(id));
  const protectedRanges = protectedIds.map((id) => { const c = findClip(p.doc, id)!.clip; return { start: c.start, end: T.add(c.start, c.duration) }; });
  // Plan against the document as it will be once the untouched clips are gone.
  const without = structuredClone(p.doc);
  for (const id of removable) { const f = findClip(without, id); if (f) f.track.clips.splice(f.index, 1); }
  const params = newParams ?? run.params;
  const ctx = await context(store, projectId, run.recipeId, params, protectedRanges);
  const plan = wrap(() => planRecipe(without, run.recipeId, params, ctx));
  const r = gov.commitAs(principal, { projectId, expectedRevision: p.revision, allowInternal: true, label: `Regenerate recipe: ${plan.steps[0] ?? run.recipeId}`.slice(0, 120), ops: [{ op: 'apply_recipe', args: { runId, recipeId: run.recipeId, params: plan.params, steps: plan.steps, removeClipIds: removable, keepIds: protectedIds, ops: plan.ops } }] }) as any;
  return { revision: r.revision, runId, replaced: removable.length, protected: protectedIds, createdIds: r.results?.[0]?.output?.createdIds ?? [], steps: plan.steps, basis: plan.basis, alternatives: plan.alternatives };
}
