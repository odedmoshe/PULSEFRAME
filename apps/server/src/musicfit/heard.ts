/**
 * The owner's «שמעתי — החיבור בסדר» (wave 7 musicfit; built by builder A). Called by routes.ts markJoinHeardFor AFTER the owner-only
 * check and the edit check (both landed complete by the lead). Commits the internal mark_join_heard {assetId, heard, at: now (ISO)}
 * as the owner, one undoable revision (precedent http.ts reviewTranslation), and answers the commit result. A file that is not a
 * shortened song is refused by the op (404 joinNotFitted, through the store's error mapping).
 */
import type { Principal } from '../auth.ts';
import type { Governance } from '../governance.ts';

export function commitJoinHeard(gov: Governance, principal: Principal, projectId: string, assetId: string, heard: boolean): unknown {
  return gov.commitAs(principal, {
    projectId, allowInternal: true, label: heard ? 'Join marked as heard' : 'Join heard mark cleared',
    ops: [{ op: 'mark_join_heard', args: { assetId, heard, at: new Date().toISOString() } }],
  });
}
