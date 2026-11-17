/**
 * Server side of the life line (ADR-0021): "on this day" across the owner's projects, and reading capture dates again from the
 * stored originals of files that have none. The routes are registered in http.ts and documented in openapi.ts.
 *
 * CONTRACT FILE (lead pre-pass). The signatures are fixed; the bodies are W2's. Until then both refuse with 501
 * `not_implemented`: nothing is listed and nothing is committed.
 *
 * Rules for the bodies:
 * - onThisDayFor reads every project of the store (the caller is the owner's own session; the route refuses agents) and
 *   answers with core onThisDay, at most 12 items. `today` is the browser's local day; the server never uses its own clock for it.
 * - readMissingCaptures re-reads the ORIGINAL bytes of pictures, videos and sounds without a capture (the blob named by
 *   conform.originalContentHash when the file was conformed, else contentHash; at most 500 files per call), with the name the
 *   file has in the library, and commits ONE transaction of internal attach_asset_capture operations (allowInternal, actor =
 *   the caller, label naming the action). `read` = files looked at, `dated` = files that got a date, `revision` = the
 *   project's revision afterwards (unchanged when nothing was dated: no empty transaction).
 * - People suggestions («העתקה מפרויקט אחר») are not part of this build: people wait for the owner's approval.
 */
import type { OnThisDayItem } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { CaptureContext } from './captureMeta.ts';
import { ApiError, type Store } from './store.ts';

const notBuilt = (what: string): never => { throw new ApiError(501, 'not_implemented', `the life line is not built yet: ${what}`); };

/** At most this many files are re-read in one call of readMissingCaptures. */
export const MAX_CAPTURE_READS = 500;
/** At most this many items are answered by onThisDayFor. */
export const MAX_ON_THIS_DAY = 12;

/** Files of the owner's projects taken on `today`'s date in earlier years. `today` is a real WALL_DATE (the route checks it). */
export function onThisDayFor(_store: Store, _p: Principal, _today: string): OnThisDayItem[] { return notBuilt('on this day'); }
/** Reads capture dates from the stored originals of the project's files that have none, and attaches them in one transaction. */
export async function readMissingCaptures(_store: Store, _p: Principal, _projectId: string, _cx: CaptureContext): Promise<{ read: number; dated: number; revision: number }> { return notBuilt('reading capture dates from the stored files'); }
