/**
 * The server side of «חיפוש בצילומים» (wave 7 search track; .artifacts/wave7/search-decisions.md §4). LEAD-OWNED: the route table, the
 * readiness record of the picture model (pins), the job type and lane label, the Embedder and SearchRuntime interfaces, the refusal
 * factory and the "not built" runtime. BUILDER B builds runtime.ts, routes.ts, answer.ts, indexDb.ts, indexJob.ts, workers.ts,
 * frames.ts and testEmbedder.ts against these.
 *
 * RULES THE BUILDER KEEPS (decisions §2–§4)
 * - Every route checks its scope, then the owner rule (isOwnerSession; 403 owner_required BEFORE anything is read), then the project,
 *   then a grant's track/time restriction (403 out_of_scope). An agent reaches only POST …/search and MCP find_in_footage.
 * - The exact section is core searchFootage on the reader document (Store.getProject inside readingAs) with reader 'agent' for every
 *   credential but the owner's own session; the answer to such a credential is agentAnswerOf(…) — no snippet, frame, score, setup.
 * - The query is never logged, stored, written to a file, put in a job, an event or an error. The picture section is the owner's only.
 * - Vectors live in <dataDir>/SEARCH_INDEX_DIR/index.sqlite only (dir 0700, file 0600, WAL, secure_delete=ON), keyed by
 *   (content hash, embedder, frame); never in pulseframe.sqlite, a backup, an archive, an answer. replaceFile checks stillWanted(hash)
 *   synchronously inside the same transaction as the write. Rows go when no current project holds the hash (Store.addAssetsGoneListener),
 *   with the project and by storage clean-up (setSearchIndexHooks), and by the owner's forget routes.
 * - The scan is a durable job of type SEARCH_INDEX_JOB_TYPE: validated before success (dim, finite, unit norm, delivered = asked),
 *   cancellable at batch boundaries, resumed after a restart at the first file without a complete row, waiting while an export runs,
 *   holding the compute lane per batch under searchLaneLabel(projectId). One open scan per project (409).
 * - Two worker processes of apps/server/tools/pf_search.py (`python -I`, HF_HUB_OFFLINE/TRANSFORMERS_OFFLINE, cwd the store's tmp dir):
 *   the scan worker (vision tower; CUDA fp16 when torch sees a device, else CPU fp32) and the query worker (text tower, CPU fp32, one
 *   request at a time, texts inline in the JSON line, answer on stdout). Neither uses LocalTools or pf_tools.py.
 */
import type { Context, Hono } from 'hono';
import { FOOTAGE_REFUSALS, type AgentFootageAnswer, type FootageAnswer, type FootageIndexStatus, type FootageRefusalKey, type ProjectDocument, type SearchSetup, type StartScanBody } from '@pulseframe/core';
import type { Principal, Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Governance } from '../governance.ts';
import type { FifoComputeLane } from '../lane.ts';
import { ApiError, type Store } from '../store.ts';

/** True once builder B has built the runtime, the routes and the tool (set at integration, wave 7). */
export const SEARCH_SERVER_BUILT = true;
/** The durable job of a scan. */
export const SEARCH_INDEX_JOB_TYPE = 'search-index';
/** The folder under the data directory that holds index.sqlite (never in a backup: backup.ts copies named files and folders only). */
export const SEARCH_INDEX_DIR = 'search';
/** The compute-lane label of a scan batch. index.ts releases the search workers before any heavy holder whose label does not start with `local.search.picture `. */
export const searchLaneLabel = (projectId: string) => `local.search.picture scan ${projectId}`;
export const SEARCH_LANE_PREFIX = 'local.search.picture ';

/**
 * The readiness record of the picture model (NOT a capability: not in LOCAL_TOOLS, not startable through Capabilities). The pins are
 * the seven files of tools/library/manifests/models-01.json source `siglip2-base-patch16-256` at revision 3f9f96cb (README.md is
 * documentation, not pinned). Ready = every pin present at exact bytes and SHA-256 under the model folder; the ledger's flags can only
 * make it stricter. 1,539,637,736 bytes in all.
 */
export const SEARCH_PICTURE = {
  id: 'local.search.picture',
  model: 'google/siglip2-base-patch16-256',
  revision: '3f9f96cb90da5dbc758b01813f2f6f1aee24c1ab',
  licence: { spdx: 'Apache-2.0', evidence: 'Model card front matter "license: apache-2.0" (https://huggingface.co/google/siglip2-base-patch16-256/blob/3f9f96cb90da5dbc758b01813f2f6f1aee24c1ab/README.md, read 2026-11-25). Training data WebLI (accepted-risk class, docs/research/2026-11-25-library-models.md §13 q5). The bundled Gemma tokenizer.model: covered by the card, residual question put to the owner.' },
  /** the folder of the files under the owner's library root (manifest dest) */
  libraryPath: 'models/search/siglip2-base-patch16-256',
  pins: [
    { path: 'model.safetensors', bytes: 1500985224, sha256: '6125cacc01fa93bdc98a0c5101cefcd69b2ed1f8ab4f38d86f4ad5984f5dc863' },
    { path: 'config.json', bytes: 276, sha256: '7b5aedcb8893e31376e129c1ffd7a5392f1a806dbc793ce53eda220c2ec59edf' },
    { path: 'preprocessor_config.json', bytes: 394, sha256: 'd14ba2ee3fd816f3de8abaddc31953565128eaf37c73ad4bed32101a98465aff' },
    { path: 'special_tokens_map.json', bytes: 636, sha256: 'baec30ea10906f16adb8c18af7a34023002c1746542612b8b41c9f09e1351351' },
    { path: 'tokenizer.json', bytes: 34363039, sha256: 'cb9140fae3ac5122c972d37adf83e1248471a38147ad76f8215c8872c6fd8322' },
    { path: 'tokenizer.model', bytes: 4241003, sha256: '61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2' },
    { path: 'tokenizer_config.json', bytes: 47164, sha256: '14afe629fe4959b9e0d51e1852b8d9f7ad074f90a1a7125a4fcdd17f06e78fc8' },
  ],
  totalBytes: 1539637736,
  worker: 'apps/server/tools/pf_search.py',
} as const;
/**
 * SHA-256 of the reviewed pf_search.py (a different file is engine_unverified). The lead read all of the script on 2026-11-25 and
 * approved exactly this content; changing one byte of the script needs a new review before this value changes.
 */
export const SEARCH_WORKER_SHA256: string | null = '3b7d40990385b166b5f42b0a99eab60a717e4741e569c6f4762cf15b3e5141c1';

/** One model behind picture search. The production one speaks to pf_search.py (workers.ts); the TEST double is testEmbedder.ts. */
export interface Embedder {
  /** an id of FOOTAGE_EMBEDDERS (the test double names itself as one) */
  readonly id: string;
  readonly dim: number;
  /** the model's own relevance of a cosine (sigmoid(scale · cos + bias)), compared with core PICTURE_MIN_RELEVANCE */
  relevance(cos: number): number;
  /** `count` RGB24 frames of 256×256, concatenated; returns count × dim unit vectors (validated by the caller) */
  embedImages(rgb: Uint8Array, count: number, signal: AbortSignal): Promise<Float32Array>;
  /** texts sent inline, never written anywhere; returns texts.length × dim unit vectors (validated by the caller) */
  embedText(texts: readonly string[], signal: AbortSignal): Promise<Float32Array>;
  /** let a kept worker go (lane hook, idle timeout, shutdown) */
  release(): Promise<void>;
}

/** Everything the routes, the tool, http.ts and index.ts need of picture search. Builder B's runtime.ts makes the real one. */
export interface SearchRuntime {
  /** the honest setup state, in the order a person fixes things (decisions §3 item 5) */
  setup(): Promise<SearchSetup>;
  /** POST …/search: the whole answer for this credential (the owner's FootageAnswer, or agentAnswerOf for anyone else) */
  answer(p: Principal, projectId: string, doc: ProjectDocument, query: { query: string; picture?: boolean; limit?: number }, signal: AbortSignal): Promise<FootageAnswer | AgentFootageAnswer>;
  /** GET …/search/index (owner only) */
  status(projectId: string, doc: ProjectDocument): Promise<FootageIndexStatus>;
  /** POST …/search/index (owner only): the durable job */
  startScan(p: Principal, projectId: string, body: StartScanBody): Promise<{ jobId: string; status: string }>;
  /** POST /jobs/:jobId/cancel and MCP cancel_job for a SEARCH_INDEX_JOB_TYPE job (assertMayCancel has already run) */
  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string };
  /** DELETE …/search/index (projectId) and DELETE /api/v1/search/index (null): owner only */
  forget(projectId: string | null): Promise<{ forgotten: { files: number; bytes: number } }>;
  /** index.ts: before a heavy holder whose label is not this track's */
  releaseKept(): Promise<void>;
  /** index.ts: after start, resume interrupted scans */
  recover(): number;
  /** index.ts: at shutdown */
  stop(): Promise<void>;
}

export type SearchEnv = { Variables: { principal: Principal } };
export type SearchApp = Hono<SearchEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface SearchRouteDeps {
  cfg: Config; store: Store; gov: Governance; runtime: SearchRuntime;
  need: (c: Context<SearchEnv>, scope: Scope) => Principal;
}
/** What createSearchRuntime (runtime.ts) gets from index.ts. `embedder` is injected by tests and the proof only (the labelled test double). */
export interface SearchRuntimeDeps {
  cfg: Config; store: Store; lane: FifoComputeLane;
  /** TEST only: the labelled test double (testEmbedder.ts); never chosen from the environment */
  embedder?: Embedder;
}

const P = '/api/v1/projects/:id';
/** Every search route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const SEARCH_ROUTES = [
  `POST ${P}/search`,
  `GET ${P}/search/index`,
  `POST ${P}/search/index`,
  `DELETE ${P}/search/index`,
  'DELETE /api/v1/search/index',
] as const;
/** The routes only the owner's own session reaches (403 owner_required for every other credential, before anything is read). */
export const SEARCH_OWNER_ROUTES: readonly string[] = SEARCH_ROUTES.filter((r) => r !== `POST ${P}/search`);
/** The MCP tools of the track: one, read-only. No tool starts, cancels or deletes a scan, or takes anything but text. */
export const SEARCH_MCP_TOOLS = ['find_in_footage'] as const;

/** A core FOOTAGE_REFUSALS entry as an ApiError (fixed English; HE_FOOTAGE words it). Details never hold the query. */
export function searchError<K extends FootageRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof FOOTAGE_REFUSALS)[K]['message']>): ApiError {
  const x = FOOTAGE_REFUSALS[key] as { status: number; code: string; message: (...a: unknown[]) => string; hint: string };
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}

/** The runtime of a build without picture search: setup not_built, every action refuses notBuilt (never a made-up result). */
export function notBuiltRuntime(): SearchRuntime {
  const refuse = (): never => { throw searchError('notBuilt'); };
  return {
    setup: async () => ({ code: 'not_built', detail: 'picture search is not built in this build yet' }),
    answer: async () => refuse(), status: async () => refuse(), startScan: async () => refuse(), cancel: () => refuse(), forget: async () => refuse(),
    releaseKept: async () => {}, recover: () => 0, stop: async () => {},
  };
}
