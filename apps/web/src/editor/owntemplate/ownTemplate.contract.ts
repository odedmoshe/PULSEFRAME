/**
 * The props between the owntemplate interface pieces (wave 8 pre-pass; BUILDER W3 builds the bodies against these and the core wire
 * types, core ownTemplateContract.ts). OWN_TEMPLATE_UI_BUILT stays false until W3 lands: nothing is drawn, so no dead button shows.
 */
import type { OwnSchematic, OwnTemplatePreviewAnswer, OwnTemplateSaveAnswer, OwnTemplateSummary } from '@pulseframe/core';

export const OWN_TEMPLATE_UI_BUILT: boolean = false;
/** The section «התבניות שלכם» in the Templates drawer: the own summaries of the gallery, before the built-in cards. */
export interface OwnTemplateSectionProps { lang: 'he' | 'en'; templates: readonly OwnTemplateSummary[]; onOpen: (s: OwnTemplateSummary) => void; onDeleted: (templateId: string) => void }
/** The save dialog (ds Dialog: focus trap, Escape, the focus back to the opening button first — the deferred-focus rule). */
export interface OwnTemplateDialogProps { lang: 'he' | 'en'; projectId: string; revision: number; onClose: () => void; onSaved: (a: OwnTemplateSaveAnswer) => void }
/** The drawn strip: inline SVG, dir="ltr", blocks ∝ slot length, beat and bar ticks, video / picture told by pattern and label (never colour alone). */
export interface OwnTemplateSchematicProps { lang: 'he' | 'en'; schematic: OwnSchematic; compact?: boolean }
export type { OwnTemplatePreviewAnswer };
