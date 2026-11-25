/**
 * The picture search runtime (wave 7 search track; search/contract.ts SearchRuntime). BUILDER B owns this file and builds the real
 * runtime here (setup state, the two pf_search.py workers, the index, the scan job, the query, the deletion listener and purge hooks).
 * Until then createSearchRuntime answers the honest "not built" runtime: setup not_built, every action 501, no worker, no file.
 */
import { notBuiltRuntime, type SearchRuntime, type SearchRuntimeDeps } from './contract.ts';

export function createSearchRuntime(deps: SearchRuntimeDeps): SearchRuntime {
  void deps;
  return notBuiltRuntime();
}
