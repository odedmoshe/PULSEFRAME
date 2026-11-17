/**
 * The template planner (ADR-0016): pure, (document, template, input) -> TemplatePlan of public ops with bindings.
 * STUB (lead contracts commit): the templates track (W3) implements planTemplate, summarizeTemplate and mirrorForReading as
 * the contract comments in templateContract.ts say. Until then planning refuses and nothing is planned.
 */
import type { ProjectDocument } from './schema.ts';
import { TemplateError, type TemplateDef, type TemplatePlan, type TemplatePlanContext, type TemplateSummary } from './templateContract.ts';

export function planTemplate(doc: ProjectDocument, def: TemplateDef, input: unknown, ctx: TemplatePlanContext = {}): TemplatePlan {
  void doc; void input; void ctx;
  throw new TemplateError('not_found', `template planner not built yet (${def.id})`);
}
export function summarizeTemplate(def: TemplateDef, env: { elementsAvailable: boolean }): TemplateSummary {
  void def; void env;
  throw new TemplateError('not_found', 'not built yet');
}
/** The transition or motion id that reads the same way in `lang` (left and right swapped for Hebrew). Placeholder: no mirroring yet. */
export function mirrorForReading(id: string, lang: 'he' | 'en'): string {
  void lang;
  return id;
}
