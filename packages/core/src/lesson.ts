/**
 * «למדו אותי פעם אחת» — the bodies (wave 8 teach; lessonContract.ts is the contract). BUILDER W1 (opus) owns this file after the
 * pre-pass: deriveLesson (the window, C1, C2, C11, C14; the folds, C4, C9; the effect and font rules, C5–C7) and the apply routine
 * with its plan (bindings, the fixed part order through pairRun.ts inFixedOrder, the per-pair rollback through pairRun.ts
 * saveTarget / restoreTarget, the effect upsert of C9, rounding once per part, ADR-0003). Until W1 sets LESSON_OPS_BUILT the
 * functions throw LessonNotBuiltError and apply_lesson refuses notBuilt after its (complete) validation, so nothing is changed.
 */
import type { ProjectDocument } from './schema.ts';
import type { OpContext } from './ops.ts';
import { LessonNotBuiltError, type ApplyLessonArgs, type ApplyLessonOutput, type DerivedLesson, type LessonPlan, type LessonTxRow } from './lessonContract.ts';

/** True once W1 has built derive and apply (lessonOps.ts, the fuzz row and the web gate read it). */
export const LESSON_OPS_BUILT: boolean = false;

/**
 * The lesson of one clip from the owner's own rows (pure; Node only, the server reads the rows).
 * `rows`: newest first, at most LESSON_LIMITS.scanRows, already pre-filtered by the server on the ops column (C-cost); `owner` is the
 * owner's actor (rows of any other actor are never learned). The window, folds and reasons are lessonContract.ts's header.
 */
export function deriveLesson(_doc: ProjectDocument, _rows: readonly LessonTxRow[], _clipId: string, _owner = 'user:local'): DerivedLesson {
  throw new LessonNotBuiltError('deriveLesson');
}

/**
 * The routine shared by apply_lesson and its plan, on `draft` (changed in place): targets in timeline order, parts in
 * LESSON_PART_ORDER, every (target, part) applied whole or put back exactly and listed. `args` are validated (validateLessonArgs)
 * and every target exists. Throws only OpErrors of the whole op; never the `nothing` refusal (the op's caller decides).
 */
export function lessonRoutine(_draft: ProjectDocument, _args: ApplyLessonArgs, _ctx: OpContext): ApplyLessonOutput {
  throw new LessonNotBuiltError('lessonRoutine');
}

/** The same routine on a copy of `doc` (nothing of `doc` changes): the dialog's rows. Equal to the commit's output (proof check 4). */
export function planApplyLesson(_doc: ProjectDocument, _args: ApplyLessonArgs): LessonPlan {
  throw new LessonNotBuiltError('planApplyLesson');
}
