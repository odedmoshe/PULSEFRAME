/**
 * The built-in templates (ADR-0016): versioned code data, compiled to public ops by templatePlan.ts. CPU looks only, Hebrew and
 * English names and texts, catalogue ids that exist in this build.
 * STUB (lead contracts commit): the templates track (W1) fills TEMPLATES with the six built-ins, version 1 each:
 * tpl.travel-montage, tpl.photo-dump, tpl.birthday, tpl.quote-card, tpl.countdown-list, tpl.home-video.
 * Templates that need a model are not here: they are MODEL_GATED_TEMPLATES (templateContract.ts), listed as unavailable.
 */
import type { TemplateDef } from './templateContract.ts';

export const TEMPLATES: readonly TemplateDef[] = [];
export const findTemplate = (id: string): TemplateDef | undefined => TEMPLATES.find((t) => t.id === id);
