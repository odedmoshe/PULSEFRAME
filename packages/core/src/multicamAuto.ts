/**
 * Auto-switch (ADR-0020 plan §5, recipe 'multicam-auto'): a labelled heuristic — "the clearly loudest mic, not who is
 * speaking". LEAD: the parameters, the decision type and the planner's signature; W2: the planner (pure, deterministic;
 * switch_angles ops of ≤ MAX_CUTS cuts with coverage 'clip', applied as ONE apply_recipe; plan.steps[0] carries
 * MULTICAM_AUTO_LABEL; plan.basis lists the screen time per angle, the cut count, the mean shot and the unsure decisions).
 * Thresholds are tuned on synthetic speech only (wave4-decisions.md). The parameters live in multicamApi.ts (recipes.ts reads
 * them at load time, and this file imports recipes.ts).
 */
import type { ProjectDocument } from './schema.ts';
import { RecipeError, type PlanContext, type RecipePlan } from './recipes.ts';
import { MULTICAM_AUTO_RECIPE_ID } from './multicamApi.ts';

export function planMulticamAuto(doc: ProjectDocument, raw: unknown, ctx: PlanContext): RecipePlan {
  void doc; void raw; void ctx;
  throw new RecipeError('not_built', `${MULTICAM_AUTO_RECIPE_ID} is not built yet`, 'This build has the contract of the auto-switch recipe but not its planner.');
}
