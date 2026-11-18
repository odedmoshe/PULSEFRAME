/**
 * The handlers of the assistant's routes (ADR-0027; contract.ts ASSISTANT_ROUTES). W2 builds them (status from the config,
 * the key file and the ledger; the owner-only checks; 409 assistant_not_connected with no job row when not ready).
 * PLACEHOLDER of the lead's pre-pass: every handler refuses with 501 not_built, so nothing is read, stored or sent and no job
 * is created; the editor shows «עוזר השפה לא מחובר».
 */
import { ApiError, type Store } from '../store.ts';
import type { Config } from '../config.ts';
import type { Governance } from '../governance.ts';
import type { AssistantDeps, AssistantHandlers } from './contract.ts';

export interface AssistantRouteContext { cfg: Config; store: Store; gov: Governance; deps: AssistantDeps }
const notBuilt = (): never => { throw new ApiError(501, 'not_built', 'the language assistant is not built in this version; nothing was sent', undefined, 'The command bar works without it.'); };
export function createAssistantHandlers(_ctx: AssistantRouteContext): AssistantHandlers {
  return { status: notBuilt, summary: notBuilt, putConfig: notBuilt, putKey: notBuilt, deleteKey: notBuilt, request: notBuilt };
}
