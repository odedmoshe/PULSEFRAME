/**
 * The body of paste_attributes and its preview (wave 7 craft; craft-plan.md §3.3 table and "Corrected" C3). W1 BUILDS THIS.
 * applyAttributes is the op's body (craftOps.ts calls it); planPasteAttributes runs the same routine on a copy, so the dialog's
 * rows equal the commit's applied + skipped (proof P2).
 */
import type { OpContext } from './ops.ts';
import type { ProjectDocument } from './schema.ts';
import { CraftNotBuilt, type PasteAttributesArgs, type PasteAttributesOutput, type PastePlan } from './craftContract.ts';

export function applyAttributes(draft: ProjectDocument, args: PasteAttributesArgs, ctx: OpContext): PasteAttributesOutput {
  void draft; void args; void ctx;
  throw new CraftNotBuilt('applyAttributes');
}
export function planPasteAttributes(doc: ProjectDocument, args: PasteAttributesArgs): PastePlan {
  void doc; void args;
  throw new CraftNotBuilt('planPasteAttributes');
}
