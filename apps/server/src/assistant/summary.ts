/**
 * The allowlisted project summary a model receives (ADR-0027, plan §7.3; core AssistantSummary). W2 builds it field by field
 * (never a spread document object), with asset aliases A1… by first use, {field} tokens written as {שדה}, people only with
 * toggles.peopleNames and then {id, name} only, and the 32 KB fold.
 * PLACEHOLDER of the lead's pre-pass: it refuses (nothing is summarised, so nothing can be sent).
 */
import { ASSISTANT_SUMMARY_FIELDS, type AssistantSummary, type AssistantToggles, type ProjectDocument } from '@pulseframe/core';
import type { AssistantSummaryContext } from './contract.ts';

/** The descriptor's dataSent and the «מה נשלח?» list: the summary's own fields (core). */
export const SUMMARY_FIELDS = ASSISTANT_SUMMARY_FIELDS;
export function assistantSummary(_doc: ProjectDocument, _ctx: AssistantSummaryContext, _toggles: AssistantToggles): AssistantSummary {
  throw new Error('assistantSummary: not built yet (ADR-0027 W2); nothing is sent');
}
