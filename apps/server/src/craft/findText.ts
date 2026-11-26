/**
 * find_text on the server (wave 7 craft): core findText over the document as this credential may read it, at most
 * CRAFT_LIMITS.findMatches matches listed, with the total of all matches and whether the list was cut. REST POST …/text/find and
 * MCP find_text share this function, so they cannot answer differently.
 */
import { CRAFT_LIMITS, findText, type FindQuery, type FindResult } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import { docForPrincipal } from '../peoplePrivacy.ts';
import type { Store } from '../store.ts';

export function findTextFor(store: Store, p: Principal, projectId: string, query: FindQuery, limit: number = CRAFT_LIMITS.findMatches): FindResult {
  const { doc, revision } = store.wholeProject(projectId); // 404 for an unknown project before anything else
  const all = findText(docForPrincipal(doc, p), query);
  return { revision, matches: all.slice(0, limit), total: all.length, truncated: all.length > limit };
}
