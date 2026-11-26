/**
 * The live picture of an UNCOMMITTED grade (wave 8 grade, grade-verify C3): the document the player draws while a curve point or a
 * grade slider moves — the same evaluate + compositor, nothing saved or sent (ADR-0025 decision 1's picture-only document, the
 * previewStabilise precedent, store.ts). editor.previewGrade(clipId, preview) calls this; previewGrade(clipId, null) shows the
 * document again. Used by the curve graph AND by the grade's sliders (GradeRow in InspectorObject.tsx), at most once per animation
 * frame, committing once on release/keyup, then previewGrade(id, null) AFTER the commit resolves (the stabilise order, so the picture
 * does not jump back).
 * W2 builds gradePreviewDoc; until then it throws and nothing calls previewGrade.
 */
import type { GradeCurves, ProjectDocument } from '@pulseframe/core';
import type { GradeParams } from '@pulseframe/engine';

export interface GradePreview {
  /** The curves to show: a value replaces the grade's curves, null shows the grade without curves; absent keeps the stored ones. */
  curves?: GradeCurves | null;
  /** Slider values to show over the stored ones (the others stay as stored). */
  params?: Partial<GradeParams>;
}
export class GradePreviewNotBuilt extends Error { constructor() { super('the live grade preview is not built in this build yet'); } }

/**
 * W2: a copy of `doc` in which only the path to `clipId` is copied (sequences → tracks → clips, as previewStabilise does; the
 * document can hold tens of thousands of camera samples) and the clip's FIRST color.grade instance is replaced by one with
 * `preview` applied — the instance set_grade_curves / set_colour_grade would write (same id). When the clip has no grade, a neutral
 * one is added in memory where effectSlot puts it (after a time effect). A clip that is not a picture, title or adjustment clip, or
 * not found, gives `doc` itself. Pure: `doc` is never changed.
 */
export function gradePreviewDoc(doc: ProjectDocument, clipId: string, preview: GradePreview): ProjectDocument {
  void doc; void clipId; void preview;
  throw new GradePreviewNotBuilt();
}
