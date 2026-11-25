/**
 * The owner's «שמעתי — החיבור בסדר» (wave 7 musicfit; BUILDER A). Called by routes.ts markJoinHeardFor AFTER the owner-only check and
 * the edit check (both landed complete by the lead). Body rule: commit the internal mark_join_heard {assetId, heard, at: now (ISO)} as
 * the owner, one undoable revision (precedent http.ts reviewTranslation); answer the commit result. Until built: 501.
 */
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';
import { musicFitApiError } from './routes.ts';

export function commitJoinHeard(gov: Governance, principal: Principal, projectId: string, assetId: string, heard: boolean): unknown {
  void gov; void principal; void projectId; void heard;
  throw musicFitApiError('notBuilt', { assetId });
}
