/**
 * The server side of the content library (wave 7 library track; .artifacts/wave7/library-decisions.md §4). LEAD-OWNED: file names,
 * the route table, every refusal with its status, code, fixed English sentence and hint (the Hebrew is packages/i18n/src/library.ts
 * HE_LIBRARY, kept in step by packages/evals/src/library-wording.test.ts), and the dependencies routes.ts gets. Worker A builds
 * routes.ts (the catalogue, index, audition, thumbnails, use), worker B credits.ts and the archive option (archive.ts).
 *
 * RULES THE BUILDERS KEEP
 * - The root is the owner's: only the owner's own session (principal.kind 'user') sets it, reindexes, cancels, or reads `root`
 *   in the status. Every other credential reads states and counts (403 owner_required otherwise).
 * - The root is absolute, exists, holds _manifests/ledger.json, and lies outside the data directory and the repository
 *   (library_root_invalid with one of ROOT_REASONS). PF_LIBRARY_DIR (cfg.libraryDir) wins over library.json.
 * - No path is read without `realpath` proving it lies inside its ledger entry's folder (library_path_escape, nothing read);
 *   links are not followed out of it. A file item must equal its ledger sha256 when copied (library_hash_mismatch); a file in a
 *   tree must equal its indexed size and mtime (library_changed_since_index). Nothing is stored on any of these.
 * - Use in project = dry-run use_library_item + add_clip on a copy BEFORE receive, again before the placement commit (as http.ts
 *   attachGenerated); propose-mode credentials are refused as built-in music is (music.ts). The copy goes through the import queue
 *   (ReceiveRequest.library), whose commit is use_library_item.
 * - The index is not a job row (jobs need a project): an in-process, cancellable build into LIBRARY_INDEX_FILE + '.tmp', swapped in
 *   whole; the previous index answers meanwhile; a restart mid-build rebuilds at start-up.
 * - Search words are never logged or stored. Third-party SVG never reaches the browser (thumbnails are PNG under DATA_CSP).
 */
import type { Context, Hono } from 'hono';
import type { Principal, Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Governance } from '../governance.ts';
import type { ImportQueue } from '../importContracts.ts';
import { ApiError, type Store } from '../store.ts';

/** In the data directory, outside every project, archive and backup (backup.ts NEVER_BACKED_UP). */
export const LIBRARY_CONFIG_FILE = 'library.json';
export const LIBRARY_INDEX_FILE = 'library-index.sqlite';
/** Thumbnail cache (PNG, least recently used, at most LIBRARY_THUMBS_MAX_BYTES), under the data directory's cache. */
export const LIBRARY_THUMBS_DIR = 'library-thumbs';
export const LIBRARY_THUMBS_MAX_BYTES = 256 * 1024 * 1024;
/** The largest file a reader opens, except the known metadata files (MAX_METADATA_BYTES). */
export const MAX_READ_BYTES = 4 * 1024 * 1024;
/** Iconify set files (`json/<prefix>.json`) and pieces.json: parsed one at a time. */
export const MAX_METADATA_BYTES = 64 * 1024 * 1024;
/** Containers the audition route streams; any other answers 415 library_audio_unsupported (m4a among them: ALAC is not reliably playable in Chromium). */
export const AUDITION_TYPES: Readonly<Record<string, string>> = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', ogg: 'audio/ogg' };

/** Why a root is refused (the Hebrew table words each). */
export const ROOT_REASONS = ['it is not an absolute path', 'it does not exist', 'it holds no _manifests/ledger.json', 'it lies inside the data directory', 'it lies inside the repository'] as const;
export type RootReason = (typeof ROOT_REASONS)[number];

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint?: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint?: string): ServerRefusal<A> => ({ status, code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the library routes. The messages are fixed: HE_LIBRARY recognises them by their shape. */
export const LIBRARY_SERVER_REFUSALS = {
  notBuilt: r(501, 'library_not_built', () => 'the content library is not built in this build yet', 'Update the editor; until then use the import button.'),
  notConfigured: r(409, 'library_not_configured', () => 'no library folder is set; the owner sets it in Settings', 'Settings → Library folder (the owner\'s own session), or PF_LIBRARY_DIR.'),
  rootInvalid: r(400, 'library_root_invalid', (why: RootReason) => `the library folder cannot be used: ${why}`, 'Choose the folder the download tool filled (the one that holds _manifests).'),
  itemMissing: r(404, 'library_item_missing', () => 'this library item is not in the index', 'Search again, or reindex the library.'),
  itemUnusable: r(409, 'library_item_unusable', (reason: string) => `this library item cannot be used: ${reason}`, 'Choose another item.'),
  hashMismatch: r(409, 'library_hash_mismatch', () => 'the file in the library changed since it was downloaded; nothing was copied', 'Fetch it again with the download tool.'),
  changedSinceIndex: r(409, 'library_changed_since_index', () => 'the file changed since the library was indexed; nothing was copied', 'Reindex the library, or verify it with the download tool (--verify).'),
  pathEscape: r(409, 'library_path_escape', () => 'this library item points outside its own folder; nothing was read', 'Check the library folder with the download tool.'),
  audioUnsupported: r(415, 'library_audio_unsupported', () => 'there is no preview for this kind of file', 'Add it to the project and listen there.'),
  svgUnsafe: r(422, 'svg_unsafe', (why: string) => `this SVG cannot be used safely: ${why}`, 'Choose another item.'),
  archiveNeedsChoice: r(409, 'archive_needs_library_choice', (n: number) => `this project holds ${n} library files that may not be passed on; choose library=strip (to share) or library=keep (for yourself)`, 'library=keep is for the owner\'s own computers only.'),
  ownerOnly: r(403, 'owner_required', () => 'the library folder is set from the owner\'s own session', 'The owner sets it in Settings.'),
} as const;
export type LibraryServerRefusalKey = keyof typeof LIBRARY_SERVER_REFUSALS;
export function libraryError<K extends LibraryServerRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof LIBRARY_SERVER_REFUSALS)[K]['message']>): ApiError {
  const x = LIBRARY_SERVER_REFUSALS[key] as ServerRefusal<unknown[]>;
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}

/** Every library route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const LIBRARY_ROUTES = [
  'GET /api/v1/library/status',
  'PUT /api/v1/library/root',
  'POST /api/v1/library/reindex',
  'DELETE /api/v1/library/reindex',
  'GET /api/v1/library/items',
  'GET /api/v1/library/items/:key',
  'GET /api/v1/library/items/:key/licence',
  'GET /api/v1/library/items/:key/audio',
  'GET /api/v1/library/items/:key/thumb',
  'POST /api/v1/projects/:id/library/use',
  'GET /api/v1/projects/:id/credits',
  'GET /api/v1/library/facets',
  'GET /api/v1/jobs/:jobId/credits',
] as const;

export type LibraryEnv = { Variables: { principal: Principal } };
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface LibraryRouteDeps {
  cfg: Config; store: Store; gov: Governance;
  /** The import queue, when the server runs one (tests may leave it out: use then answers 501 library_not_built). */
  imports: ImportQueue | null;
  need: (c: Context<LibraryEnv>, scope: Scope) => Principal;
}
export type LibraryApp = Hono<LibraryEnv>;
/** The owner's own session, or 403 owner_required. */
export function libraryOwner(p: Principal): Principal {
  if (p.kind !== 'user') throw libraryError('ownerOnly');
  return p;
}
