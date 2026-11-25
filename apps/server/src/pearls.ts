/**
 * The read view of marked source ranges — «פנינים» (wave 7 pearls track; .artifacts/wave7/pearls-decisions.md). GET
 * /api/v1/projects/:id/pearls?sequenceId= and MCP get_pearls, both scope observe. BUILDER B owns this file; the shape is core
 * sourceRangesContract.ts PearlsView. Until PEARLS_SERVER_BUILT the view answers 501 pearls_not_built after the scope check and the
 * project read (never a made-up list).
 *
 * RULES OF B's BODY:
 * - Read the document the credential may read (store.getProject inside the request: the reader document). For a 'names' credential
 *   labels are '' there already (peoplePrivacy.ts rule 5); say so with labelsHidden: peopleAccess(p) !== 'full'. `verbatim` is
 *   computed from that document (false when hidden). People as { id, name } only.
 * - sequenceId absent = the main sequence; an unknown one is 404 not_found. Usage and screen time come from core rangeUsage /
 *   screenTime (builder A), with USAGE_LIMITS and SCREEN_TIME_LABEL travelling with the numbers. Rows in core list order.
 * - byAgent = createdBy starts with 'agent:'. No label ever goes into a log line, an event or an error.
 */
import type { PearlsView, ProjectDocument } from '@pulseframe/core';
import type { Principal } from './governance.ts';
import { ApiError } from './store.ts';

/** True once builder B has built the view. */
export const PEARLS_SERVER_BUILT = false;
export const PEARLS_SERVER_REFUSALS = {
  notBuilt: { status: 501, code: 'pearls_not_built', message: 'pearls are not built in this build yet', hint: 'Update the editor and try again.' },
} as const;

/** GET …/pearls and MCP get_pearls: the ranges with usage and screen time, as this credential may read them. */
export function pearlsView(doc: ProjectDocument, revision: number, principal: Principal, sequenceId?: string): PearlsView {
  if (sequenceId !== undefined && !Object.hasOwn(doc.sequences, sequenceId)) throw new ApiError(404, 'not_found', `sequence ${sequenceId} not found`, { sequenceId });
  void revision; void principal;
  const r = PEARLS_SERVER_REFUSALS.notBuilt;
  throw new ApiError(r.status, r.code, r.message, {}, r.hint);
}
