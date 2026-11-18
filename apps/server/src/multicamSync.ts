/**
 * Multicam on the server (ADR-0020): sync by sound, the group view and the level envelope. LEAD: these signatures and the
 * routes that call them (http.ts); W2: the bodies (plan §4, the W2 brief). Until then each answers 501 not_built and touches
 * nothing; the routes have already checked the credential's scope, the body and that the project, group or file exists.
 *
 * RULES OF THE BODIES the lead adds to the brief:
 * - Commit pattern: gov.assertMayAct(edit), assertUnrestricted, measure, re-check the group (revision and the pieces' assets),
 *   then store.commit with allowInternal and ONE attach_multicam_sync (http.ts attach_analysis precedent). dryRun commits
 *   nothing and needs only 'observe'. A hand-synced file measured again without overwrite answers 409 would_discard_edits
 *   (the op refuses with details.why 'would_discard_edits').
 * - Capture-time priors (core multicamPrior.ts capturePriors) when body.useCapturePriors !== false: report them per piece,
 *   order near-equal candidates by distance from them, widen maxOffset to cover them; never attach them.
 * - Envelopes: derive.ts DerivativeKind 'envelope', NOT in the ingest KINDS; built on demand under heavy() with
 *   ANALYSIS_TIMEOUT_MS, stored through a public Derivatives.put(hash, kind, bytes, mime, meta) and announced over SSE.
 * - Background runs: a durable 'analysis' job with input.kind MULTICAM_SYNC_KIND (runAnalysisJob family), stage text from
 *   multicamSyncStage, cancel checked between pieces, recovered by recoverAnalysisJobs.
 */
import type { MulticamSyncReport, MulticamSyncRequest, MulticamView } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Governance } from './governance.ts';
import { ApiError, type Store } from './store.ts';

const notBuilt = (what: string) => new ApiError(501, 'not_built', `${what} is not built yet`, {}, 'This build has the contract of multicam but not this part.');
/** POST /projects/:id/multicam/:groupId/sync: the report (in-request) or { jobId, status } (background). */
export async function syncMulticam(store: Store, gov: Governance, principal: Principal, projectId: string, groupId: string, body: MulticamSyncRequest): Promise<MulticamSyncReport | { jobId: string; status: string }> {
  void store; void gov; void principal; void projectId; void groupId; void body;
  throw notBuilt('syncing a multicam group by sound');
}
/** GET /projects/:id/multicam/:groupId. */
export function multicamView(store: Store, projectId: string, groupId: string): MulticamView {
  void store; void projectId; void groupId;
  throw notBuilt('the multicam group view');
}
/** POST /projects/:id/assets/:assetId/derivatives/envelope: the derivative row, built on demand. */
export async function envelopeDerivative(store: Store, projectId: string, assetId: string): Promise<Record<string, unknown>> {
  void store; void projectId; void assetId;
  throw notBuilt('the level envelope of a file');
}
