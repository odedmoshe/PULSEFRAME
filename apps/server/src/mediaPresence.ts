/**
 * Whether the stored file of an asset is there, and the honest answer when it is not (missing_media).
 *
 * One check for every reader of an asset's bytes: the editor's content route, the render worker's route, the export plan and
 * its run-time re-check (export.ts), and the list the editor marks missing files from. A file that is gone, or that is no longer
 * the size it was imported with, is missing: the preview, a still and an export all say `missing_media` for it, and none of them
 * crashes or draws something else in its place (ADR-0005: one path for preview, still and export).
 */
import fs from 'node:fs';
import type { ProjectDocument } from '@pulseframe/core';
import { ApiError, type Store } from './store.ts';

/** The asset's stored file exists and has the size the asset was imported with. */
export function blobPresent(store: Store, a: { contentHash: string; byteSize: number }): boolean {
  try { return fs.statSync(store.blobPath(a.contentHash)).size === a.byteSize; } catch { return false; }
}

export const MISSING_MEDIA_HINT = 'Restore the data directory from a backup, or import the file again and put it in place of this one on the clips that use it (Replace media in the inspector).';

/** 404 missing_media for one asset. The message names the asset id only, never a path on this computer. */
export function missingMediaError(assetId: string): ApiError {
  return new ApiError(404, 'missing_media', `the stored file of asset ${assetId} is missing`, { assetId }, MISSING_MEDIA_HINT);
}

/** Ids of the project's assets whose stored file is missing, in library order. */
export function missingAssets(store: Store, doc: ProjectDocument): string[] {
  return Object.values(doc.assets).filter((a) => !blobPresent(store, a)).map((a) => a.id);
}

/**
 * One log line for an expected state, not a stack: which asset, and which route answered. A media element asks again and again
 * (range requests, retries), so the same asset is logged at most once a minute.
 */
const told = new Map<string, number>();
export function logMissingMedia(assetId: string, where: string, now = Date.now()): boolean {
  if ((told.get(assetId) ?? -Infinity) > now - 60_000) return false;
  told.set(assetId, now);
  if (told.size > 1000) for (const [k, at] of told) if (at <= now - 60_000) told.delete(k);
  console.warn(`[media] ${where}: the stored file of asset ${assetId} is missing; answered 404 missing_media`);
  return true;
}
