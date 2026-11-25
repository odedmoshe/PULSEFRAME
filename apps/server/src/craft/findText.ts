/**
 * find_text on the server (wave 7 craft): core findText over the document as this credential may read it (Store.getProject),
 * at most CRAFT_LIMITS.findMatches listed with the total. W2 BUILDS THIS (REST POST …/text/find and MCP find_text share it);
 * until then it answers 501 craft_not_built.
 */
import type { FindQuery, FindResult } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Store } from '../store.ts';
import { craftError } from './contract.ts';

export function findTextFor(store: Store, p: Principal, projectId: string, query: FindQuery): FindResult {
  void p; void query;
  store.getProject(projectId); // 404 for an unknown project before anything else
  throw craftError('notBuilt');
}
