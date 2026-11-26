/**
 * The server side of «מאגר» / «ייבוא מקישור» (wave 8 `sources`, part A; core sourcesContract.ts). LEAD-OWNED and frozen after the
 * pre-pass: the route table, the MCP tool names, what routes.ts gets from http.ts, the runtime interface W2 builds (and routes.ts
 * calls), the address policy seam of the safe downloader, and the not-built runtime.
 *
 * RULES (decisions «sources»; verify C1–C17 win over the plan):
 * - OPEN: any credential that may observe searches, lists and previews; any credential that may edit (governance 'job') imports
 *   and places; the job commits use_source_item and the placement (add_clip, dry-run first) AS THAT CREDENTIAL. No propose step.
 * - The only owner-only routes store or remove a service's credential (the owner types keys into the app; the key floor). The
 *   download limit is a setting any credential that may edit can change (no new owner-only limit, C17b in spirit).
 * - The server sends a service ONLY the caller's words and filters (and the owner's key or contact line where the service needs
 *   one); nothing about the owner or the project; queries are never logged or stored (memory cache only).
 * - Previews: a handle (16 random bytes, 30 minutes, in memory) maps to ONE URL a service's own answer produced; a URL from a
 *   client is never fetched for a preview (not an open proxy, C10). Nothing is written to disk.
 * - The safe downloader (W2 connectors/fetch.ts, C8): every looked-up address checked inside the lookup hook (all: true arrays:
 *   EVERY address), IPv4-mapped IPv6 normalised, loopback / unspecified / link-local (169.254.169.254) / multicast and the machine's
 *   own interface addresses (os.networkInterfaces: the editor's own doors, e.g. the phone drop on the LAN) refused; RFC 1918 and ULA
 *   allowed with the warning link_private_network; at most 5 redirects, each checked again; caps while streaming (a lying
 *   Content-Length cannot pass); Content-Type and magic bytes video/audio/image. Node's fetch is not used.
 * - The address policy is injected ONLY through SourcesDeps (tests and the proof, labelled), never from the environment or a route;
 *   one test shows the DEFAULT policy refuses 127.0.0.1 with no injection.
 */
import type { Context, Hono } from 'hono';
import { SOURCES_API, type SourceCredentialsBody, type SourceImportAnswer, type SourceImportBody, type SourceLinkBody, type SourcePage, type SourceSearchQuery, type SourceState, type SourcesApiKey, type SourcesSettings } from '@pulseframe/core';
import type { Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Governance, Principal } from '../governance.ts';
import type { ImportQueue } from '../importContracts.ts';
import { ApiError, type Store } from '../store.ts';

const P = '/api/v1/projects/:id';
/** Every sources route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const SOURCES_ROUTES = [
  'GET /api/v1/sources',
  'GET /api/v1/sources/:provider/search',
  'GET /api/v1/source-previews/:handle',
  'PUT /api/v1/sources/:provider/credentials',
  'DELETE /api/v1/sources/:provider/credentials',
  'GET /api/v1/sources/settings',
  'PUT /api/v1/sources/settings',
  `POST ${P}/sources/import`,
  `POST ${P}/sources/link`,
] as const;
/** The MCP tools of this track (registered in mcp.ts by the pre-pass; W2 builds their handlers; peopleSurfaces.ts classifies each). */
export const SOURCES_MCP_TOOLS = ['list_sources', 'search_sources', 'import_source', 'import_from_link'] as const;

/** The safe downloader's address decision (C8). Default: connectors/fetch.ts (W2). Injected for tests and the proof ONLY. */
export interface AddressPolicy {
  /** 'refuse' = link_address_refused; 'private' = allowed with link_private_network; 'public' = allowed. `address` is normalised. */
  classify(address: string, family: 4 | 6): 'refuse' | 'private' | 'public';
}
/** What W2's runtime is built from (index.ts, append only). */
export interface SourcesDeps {
  cfg: Config; store: Store; gov: Governance; imports: ImportQueue | null;
  /** TEST and PROOF only (labelled doubles on port 0): the address policy and the services' base URLs. Never from the environment. */
  test?: { addressPolicy?: AddressPolicy; baseUrls?: Partial<Record<'openverse' | 'pixabay' | 'wikimedia', string>> };
}

/** W2 builds the real runtime (sources/runtime.ts + connectors/fetch.ts + sources/{openverse,pixabay,wikimedia}.ts + the source_fetch job). */
export interface SourcesRuntime {
  list(p: Principal): { sources: SourceState[]; settings: SourcesSettings };
  search(p: Principal, provider: string, q: SourceSearchQuery): Promise<SourcePage>;
  /** streams the held URL through the safe downloader (Range passed on, capped at SOURCES_LIMITS.previewBytes) */
  preview(p: Principal, handle: string, range: string | null): Promise<Response>;
  /** the owner's own session only (routes.ts checks before calling) */
  setCredentials(p: Principal, provider: string, body: SourceCredentialsBody): SourceState;
  deleteCredentials(p: Principal, provider: string): SourceState;
  settings(p: Principal): SourcesSettings;
  setSettings(p: Principal, maxDownloadBytes: number | null): SourcesSettings;
  /** 202: starts a durable source_fetch job (idempotencyKey through store.findJobByKey) */
  importItem(p: Principal, projectId: string, body: SourceImportBody): Promise<SourceImportAnswer>;
  importLink(p: Principal, projectId: string, body: SourceLinkBody): Promise<SourceImportAnswer>;
  /** POST /jobs/:jobId/cancel and MCP cancel_job for type source_fetch (http.ts dispatch line) */
  cancel(p: Principal, jobId: string): { jobId: string; status: string; outcome: string };
  /** restart recovery (index.ts): running jobs continue from their .part with Range/If-Range; orphan src_* files removed */
  recover(): number;
}

export type SourcesEnv = { Variables: { principal: Principal } };
export type SourcesApp = Hono<SourcesEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface SourcesRouteDeps {
  store: Store; gov: Governance;
  need: (c: Context<SourcesEnv>, scope: Scope) => Principal;
  /** absent = the not-built runtime */
  runtime?: SourcesRuntime;
}

/** A sources route's error from the core SOURCES_API table. */
export function sourcesError(key: SourcesApiKey, details: Record<string, unknown> = {}): ApiError {
  const r = SOURCES_API[key];
  return new ApiError(r.status, r.code, r.message, details, r.hint);
}
/** The runtime until W2 lands: every call answers 501 sources_not_built (after the route's checks). */
export const notBuiltSourcesRuntime: SourcesRuntime = {
  list: () => { throw sourcesError('notBuilt'); },
  search: async () => { throw sourcesError('notBuilt'); },
  preview: async () => { throw sourcesError('notBuilt'); },
  setCredentials: () => { throw sourcesError('notBuilt'); },
  deleteCredentials: () => { throw sourcesError('notBuilt'); },
  settings: () => { throw sourcesError('notBuilt'); },
  setSettings: () => { throw sourcesError('notBuilt'); },
  importItem: async () => { throw sourcesError('notBuilt'); },
  importLink: async () => { throw sourcesError('notBuilt'); },
  cancel: () => { throw sourcesError('notBuilt'); },
  recover: () => 0,
};
