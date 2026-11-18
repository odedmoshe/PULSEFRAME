/**
 * The phone drop door (ADR-0023, amends ADR-0002): a second, plain node:http listener that exists only while an owner-issued
 * code is live, bound to the one private address the owner confirmed, serving the upload page and the upload routes of the
 * wire protocol in importContracts.ts and nothing else. It hands every file to the import queue (queue.receive) and to nothing
 * else.
 *
 * LEAD STUB (wave 5 pre-pass): the signature is the contract; W1 writes the door. Until then no listener is ever created:
 * open() refuses, there is never a live code, and stop() has nothing to close. Not mounted by the lead until W1 is merged.
 */
import { EventEmitter } from 'node:events';
import type { DropDoor, DropDoorDeps } from './importContracts.ts';
import { ApiError } from './store.ts';

export function createDropDoor(deps: DropDoorDeps): DropDoor {
  void deps;
  return {
    events: new EventEmitter(),
    addresses() { throw new ApiError(501, 'not_implemented', 'uploading from a phone is not built yet (ADR-0023)'); },
    async open() { throw new ApiError(501, 'not_implemented', 'uploading from a phone is not built yet (ADR-0023)'); },
    current() { return null; },
    close(dropId) { throw new ApiError(404, 'drop_not_found', 'there is no live drop code', { dropId }); },
    async stop() { /* no listener was ever opened */ },
  };
}
