/**
 * The preview's words (ADR-0027; plan §4.5, §6): a plan step as dictionaries[lang]['op.' + op] plus a sentence for its
 * StepDetail, a note in words, and describeCall for any public op (the assistant's proposals), falling back to the op words.
 * W3 builds it. PLACEHOLDER of the lead's pre-pass: refuses (nothing calls it yet).
 */
import type { Lang } from '@pulseframe/i18n';
import type { BarNote, OpCall, PlanStep, ProjectDocument } from '@pulseframe/core';

export interface StepWords { op: string; detail: string }
export function describeStep(_step: PlanStep, _lang: Lang): StepWords {
  throw new Error('describeStep: not built yet (ADR-0027 W3)');
}
export function describeNote(_note: BarNote, _lang: Lang): string {
  throw new Error('describeNote: not built yet (ADR-0027 W3)');
}
export function describeCall(_doc: ProjectDocument, _call: OpCall, _lang: Lang): StepWords {
  throw new Error('describeCall: not built yet (ADR-0027 W3)');
}
