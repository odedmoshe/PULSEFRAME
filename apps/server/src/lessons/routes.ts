/**
 * «למדו אותי פעם אחת» on the server (wave 8 teach). BUILDER W2 (opus) owns this file after the pre-pass.
 * GET /api/v1/projects/:id/clips/:clipId/lesson — the lesson of one clip from the owner's own recent edits (core deriveLesson).
 * OWNER'S OWN SESSION ONLY: every other credential gets 403 owner_required before the clip is looked at (the rows read are the
 * owner's history; an agent never records a lesson). There is NO MCP tool (cut from version 1) and no save route.
 * Checks in order (landed complete by the lead): the project may be read (gov.assertMayAct observe), the caller is the owner's
 * session, the clip exists (404 not_found, own property through findClip), then 501 teach_not_built until W2 builds the body.
 *
 * THE SCAN (teach-verify C3, "C-cost"), for W2:
 *  1. ids = the clip and its linked partners in the CURRENT document (core partnersOf).
 *  2. SELECT id, revision, actor, kind, label, request_id, undoes, undone_by, ops, result FROM transactions WHERE project_id = ?
 *     AND revision > (current − LESSON_LIMITS.scanRows) AND (instr(ops, '"<id1>"') > 0 OR …) ORDER BY revision DESC — the small ops
 *     column only; never json_each over `changes` (which holds whole entity states).
 *  3. Read `changes` only for the rows that passed, for the before states and the creation stop (SELECT changes … WHERE id IN …).
 *  4. deriveLesson(doc, rows, clipId, 'user:local') — the window (stops, undone rows, caps) is core's; the route adds projectId.
 *  The answer holds no words of the clip (proof check 2 plants a word and searches the whole answer) and is never cached across
 *  revisions; the chip refetches after a revision event that names the clip, debounced (W3).
 */
import { findClip, LESSON_API_REFUSALS, LESSON_OPS_BUILT, type DerivedLessonView, type LessonTxRow } from '@pulseframe/core';
import type { Governance, Principal } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';

/** True once W2 has built the body below. */
export const LESSON_SERVER_BUILT: boolean = false;

const A = LESSON_API_REFUSALS;
export const lessonApiError = (key: 'notBuilt' | 'ownerRequired') => new ApiError(A[key].status, A[key].code, A[key].message(), {}, A[key].hint);

/** The first checks of the derive route (complete). Throws ApiError 403 / 404 (and the project's own 403 / 404). */
export function assertLessonCaller(store: Store, gov: Governance, principal: Principal, projectId: string, clipId: string): void {
  gov.assertMayAct(principal, projectId, 'observe');
  if (principal.kind !== 'user') throw lessonApiError('ownerRequired'); // the owner's browser session (http.ts owner(); auth.ts makes no other user session)
  if (!findClip(store.getProject(projectId).doc, clipId)) throw new ApiError(A.clipNotFound.status, A.clipNotFound.code, A.clipNotFound.message(clipId), { clipId }, A.clipNotFound.hint);
}

/**
 * The rows the deriver reads (THE SCAN above, steps 1–3): newest first, at most LESSON_LIMITS.scanRows read, pre-filtered on ops.
 * W2 builds it; `scanned` is how many rows the SELECT of step 2 covered (the window reports it).
 */
export function readLessonRows(_store: Store, _projectId: string, _ids: readonly string[], _revision: number): { rows: LessonTxRow[]; scanned: number } {
  throw lessonApiError('notBuilt');
}

/** GET …/clips/:clipId/lesson. */
export function deriveLessonFor(store: Store, gov: Governance, principal: Principal, projectId: string, clipId: string): DerivedLessonView {
  assertLessonCaller(store, gov, principal, projectId, clipId);
  if (!LESSON_OPS_BUILT || !LESSON_SERVER_BUILT) throw lessonApiError('notBuilt');
  // W2: const p = store.getProject(projectId); const { rows } = readLessonRows(store, projectId, ids, p.revision);
  //     return { projectId, ...deriveLesson(p.doc, rows, clipId) };
  throw lessonApiError('notBuilt');
}
