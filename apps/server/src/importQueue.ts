/**
 * The import queue (ADR-0023): every upload of a media file (the editor's picker, a dropped folder, a phone drop, the
 * synchronous POST …/assets) is received, hashed and stored, then probed, converted when it must be, and committed by a durable
 * job of type 'import' that survives a restart. One conversion at a time on the compute lane, yielding to exports; files that
 * need no conversion overtake. The contract, with the verifier's corrections, is importContracts.ts.
 *
 * LEAD STUB (wave 5 pre-pass): the signature is the contract; W2 writes the queue (and the ingest phases in ingest.ts). Until
 * then every call refuses and nothing is received, stored or committed. Not mounted by the lead until W2 is merged.
 */
import type { ImportQueue, ImportQueueDeps } from './importContracts.ts';
import { ApiError } from './store.ts';

export function createImportQueue(deps: ImportQueueDeps): ImportQueue {
  void deps;
  const refuse = (): never => { throw new ApiError(501, 'not_implemented', 'the import queue is not built yet (ADR-0023)'); };
  return {
    receive: async () => refuse(), wait: async () => refuse(), list: refuse, view: refuse, room: refuse,
    cancel: refuse, retry: refuse, dismiss: refuse, recover: refuse,
    async stop() { /* nothing was started */ },
  };
}
