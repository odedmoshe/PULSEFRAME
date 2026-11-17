/**
 * apply_template (internal, v1; ADR-0016): applies a template plan (public ops with bindings) as ONE step and records the run
 * with its slots. Issued only by the server from a plan it built (apps/server/src/templates.ts), like apply_recipe.
 * Registered on import of this module (packages/core/src/index.ts exports it).
 * STUB (lead contracts commit): the templates track (W1) implements resolveBindings and the op body as the contract comments in
 * templateContract.ts say. Until then the op refuses every call and changes nothing.
 */
import { defineOp, OpError } from './ops.ts';
import { ApplyTemplateArgsSchema } from './templateContract.ts';

/**
 * Replace the bindings ({$ref}, {$asset}; templateContract.ts RefSchema / AssetRefSchema) inside one step's args, BEFORE the
 * step's own zod parse. `bound` holds the outputs of earlier steps by bind name, `assets` the asset ids by asset key; `where`
 * names the step in refusals.
 */
export function resolveBindings(args: unknown, bound: ReadonlyMap<string, Readonly<Record<string, unknown>>>, assets: ReadonlyMap<string, string>, where: string): unknown {
  void args; void bound; void assets; void where;
  throw new Error('not built yet');
}

defineOp({
  name: 'apply_template',
  version: 1,
  internal: true,
  description: 'Apply a template plan (ordinary public ops with bindings to earlier steps and to the procedural media it carries) as one step, and record the run with its slots. Issued by the server from a plan it built; on regeneration it first removes the previous run\'s untouched clips. Rule-based; no model.',
  args: ApplyTemplateArgsSchema,
  apply(_d, a) {
    throw new OpError('unknown_op', `apply_template is not built yet in this build (template ${a.templateId} was not applied)`, { templateId: a.templateId });
  },
});
