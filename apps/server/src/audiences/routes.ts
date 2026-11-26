/**
 * The read route of «גרסה לכל קהל» (wave 8 audiences track): GET /api/v1/projects/:id/variants/:variantId/audience (observe) and MCP
 * get_audience_changes answer the same view. The lead landed the checks COMPLETE (the project, the version by own property, a format that
 * is not a version for an audience), in that order: 404, 409, then 501 while AUDIENCE_PROJECTION_BUILT is false; after them the answer is
 * core audienceChanges(doc, variantId, revision), the same code that projects the version (W2). The view carries clip and track ids, registry ids, frames and dB, never a name or a family note, so
 * every reader with observe gets the same answer (peopleSurfaces.ts: reader-document).
 */
import { AUDIENCE_API_REFUSALS, AUDIENCE_PROJECTION_BUILT, audienceChanges, type AudienceChanges } from '@pulseframe/core';
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
  return audienceView(audienceChanges(p.doc, variantId, p.revision));
}

/**
 * The answer as the wire carries it: exactly the fields of the contract (audienceContract.ts AudienceChanges), copied by name, so
 * nothing a later change of core adds to a row (a title's words, a file name) reaches a reader without a decision here. Every reader
 * with observe gets this same view: ids, frames, registry ids, sizes and dB.
 */
export function audienceView(c: AudienceChanges): AudienceChanges {
  const machine = (x: unknown): string | number | null => (typeof x === 'number' && Number.isFinite(x)) || (typeof x === 'string' && REGISTRY_VALUE.test(x)) ? x : null;
  return {
    projectId: c.projectId, variantId: c.variantId, revision: c.revision, profile: c.profile, rules: c.rules, musicDb: c.musicDb,
    changes: c.changes.map((x) => ({ key: x.key, rule: x.rule, clipId: x.clipId, trackId: x.trackId, sequenceId: x.sequenceId, startFrame: x.startFrame, endFrame: x.endFrame, before: machine(x.before), after: machine(x.after), keepable: x.keepable, kept: x.kept })),
    fastCuts: c.fastCuts.map((x) => ({ startFrame: x.startFrame, endFrame: x.endFrame, cuts: x.cuts, limit: x.limit, windowSeconds: x.windowSeconds })),
    soundRoles: c.soundRoles.map((x) => ({ trackId: x.trackId, role: x.role, why: x.why })),
    notHandled: [...c.notHandled], method: c.method,
  };
}
/** A before/after string the wire may carry: a registry id or a colour (`light.strobe`, `dip-white`, `jitter`, `classic`, `#000000B3`), never words. */
const REGISTRY_VALUE = /^(?:[a-z0-9]+(?:[.-][a-z0-9]+)*|#[0-9A-Fa-f]{6,8})$/;
