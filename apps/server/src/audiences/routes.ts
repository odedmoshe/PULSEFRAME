/**
 * The read route of «גרסה לכל קהל» (wave 8 audiences track): GET /api/v1/projects/:id/variants/:variantId/audience (observe) and MCP
 * get_audience_changes answer the same view. The lead landed the checks COMPLETE (the project, the version by own property, a format that
 * is not a version for an audience); BUILDER W2 replaces the 501 with core audienceChanges(doc, variantId, revision) once W1 has built
 * it (AUDIENCE_PROJECTION_BUILT). The view carries clip and track ids, registry ids, frames and dB, never a name or a family note, so
 * every reader with observe gets the same answer (peopleSurfaces.ts: reader-document).
 */
import { AUDIENCE_API_REFUSALS, AUDIENCE_PROJECTION_BUILT, type AudienceChanges } from '@pulseframe/core';
import { ApiError, type Store } from '../store.ts';

const A = AUDIENCE_API_REFUSALS;
export const audienceNotBuilt = () => new ApiError(A.notBuilt.status, A.notBuilt.code, A.notBuilt.message(), {}, A.notBuilt.hint);

/** The change list of one version for an audience (AudienceChanges). Throws ApiError 404 / 409 / 501. */
export function audienceChangesFor(store: Store, projectId: string, variantId: string): AudienceChanges {
  const p = store.getProject(projectId);
  const v = Object.hasOwn(p.doc.variants ?? {}, variantId) ? p.doc.variants[variantId]! : undefined;
  if (!v) throw new ApiError(404, 'not_found', `format variant ${variantId} not found`, { variantId }, 'get_summary lists the variants.');
  if (!v.audience) throw new ApiError(A.notAudience.status, A.notAudience.code, A.notAudience.message(variantId), { variantId }, A.notAudience.hint);
  if (!AUDIENCE_PROJECTION_BUILT) throw audienceNotBuilt();
  // W2: return audienceChanges(p.doc, variantId, p.revision);
  throw audienceNotBuilt();
}
