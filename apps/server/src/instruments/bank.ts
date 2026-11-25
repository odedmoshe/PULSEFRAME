/**
 * The kit checker and loader of recorded instruments (wave 7 instruments track; decisions §4.3). LEAD: signatures (final). BUILDER W2:
 * bodies. Reads the ledger only through LibraryService.ledgerEntries, files only through library/paths.ts openInside, licences only
 * through core licenceDuties and kitLibraryRecord. Memory: at most INSTRUMENTS_LIMITS.maxDecodedBytes of decoded samples per render;
 * nothing decoded is kept after the render (no cross-render cache in v1).
 */
import type { KitState, LibraryRecord, MusicKit, MusicKitStatus } from '@pulseframe/core';
import type { Config } from '../config.ts';
import type { ResolvedBank, SampledNote } from '../music/sampler.ts';
import type { ApiError } from '../store.ts';

/** The result of checking a kit against the library, outside the queue turn. `ready` carries what loading needs. */
export type KitCheck =
  | { state: Exclude<KitState, 'ready'>; error: ApiError; sources: MusicKitStatus['sources'] }
  | { state: 'ready'; bank: string; records: LibraryRecord[]; sources: MusicKitStatus['sources']; files: { instrument: string; path: string; real: string; bytes: number; mtimeMs: number }[] };
/** Check every file and source of `kit` (hash cache by absolute path + size + mtimeMs). Never throws for a library problem: the state says it. */
export async function checkKit(_cfg: Config, _kit: MusicKit, _signal?: AbortSignal): Promise<KitCheck> { throw new Error('the kit checker is not built in this build yet'); }
/**
 * Inside the queue turn: parse the instruments, plan the zones for `notes` (refuse instruments_range), re-stat every file (changed →
 * instruments_file_changed) and decode only the frames needed (over the limit → instruments_too_large).
 */
export async function loadBank(_check: Extract<KitCheck, { state: 'ready' }>, _kit: MusicKit, _notes: readonly SampledNote[], _signal?: AbortSignal): Promise<ResolvedBank> { throw new Error('the bank loader is not built in this build yet'); }
