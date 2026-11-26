/**
 * The server side of the local picture-model runtime and `eyes` (wave 8 picmodels; core picmodelsContract.ts; picmodels-verify.md wins
 * over the plan; decisions.md "Batch C … picmodels"). LEAD-OWNED and frozen after the pre-pass: the route table, the worker's
 * reviewed digest, the runtime interface, the worker launcher's contract and the not-built runtime. W1 builds runtime.ts, models.ts,
 * frames.ts, eyes.ts and ../toolsWorker.ts against these, and owns routes.ts after the pre-pass (keeping the order of its checks).
 *
 * RULES W1 KEEPS
 * - GET /api/v1/picture-models (scope observe): a read-only state report built ONLY from the registry, the worker digest, the probe and
 *   the ledger + file checks; core pictureModelsFor decides what a credential sees: the owner's own session every row, anyone else codes
 *   and numbers and NEVER the yunet row. No path, no file name, no worker message reaches any answer.
 * - POST /api/v1/projects/:id/eyes/propose: scope observe → actsAsOwner (ADR-0036: the owner's own session, or in open mode an
 *   editing agent credential; autonomy.ts OPEN_GATES A17), else 403 owner_required BEFORE the body is read → the
 *   project → the body (core EyesProposeBodySchema, strict) → the asset and its frame (picmodels refusals) → yunet ready, else 409
 *   eyes_not_ready naming the code → decode AS SHOWN at long side EYES.inputLongSide (frames.ts) → ONE worker process
 *   (runEyesOnce below) → the worker line parsed with core EyesWorkerLineSchema (STRICT: an extra key is 502 eyes_engine_failed) →
 *   pixels → shown (u, v), every value finite and in 0..1, a face whose points are closer than GROWING.minEyeShownPx dropped, faces
 *   sorted by position → core EyesAnswerSchema.parse → `Cache-Control: no-store`. 429 eyes_busy while one runs.
 * - NOTHING IS STORED: no durable job type exists for eyes (there is deliberately no EYES job type constant), no job row, no event,
 *   no derivative, no file (pixels inline in the JSON line on stdin), no log line. The route never lets a raw ZodError, SyntaxError or
 *   worker message reach app.onError's console.error (http.ts): every failure is a picmodelsError with a code, details holding only
 *   codes and integers. Not in the lane (no label), no MCP tool, not in the assistant summary.
 * - ONE PROCESS PER REQUEST, killed (SIGKILL) on abort (the request's signal: the client went away or «עצרו»), on the timeout and
 *   after the answer; no kept worker, PF_TOOLS_KEEP_SECONDS does not apply (verify C10). Started as `python -I -X utf8 pf_picture.py serve
 *   --role eyes --model <verified path> --threads 2`, OFFLINE_ENV, cwd the store's tmp folder; stderr is kept to the last 2,000
 *   characters in memory for the owner's setup detail only and never logged.
 * - The generic launcher is a NEW file ../toolsWorker.ts used by picmodels only (C17): search/workers.ts stays exactly as it is.
 */
import type { Context, Hono } from 'hono';
import {
  PICMODELS_REFUSALS, PICTURE_MODELS, notBuiltPictureModelStatus,
  type EyesAnswer, type EyesProposeBody, type EyesWorkerLine, type EyesWorkerRequest, type PicmodelsRefusalKey, type PictureModelId, type PictureModelStatus,
} from '@pulseframe/core';
import type { Principal, Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';

/** True once W1's runtime and routes are built (set at integration). Until then the eyes route answers 501 eyes_not_built after the owner check. */
export const PICMODELS_SERVER_BUILT = true;
/** The reviewed worker script, relative to the repository root. */
export const PICTURE_WORKER = 'apps/server/tools/pf_picture.py';
/**
 * SHA-256 of the reviewed pf_picture.py (any other file is engine_unverified). NULL until the lead has read ALL of the script at
 * integration and approved exactly that content; a changed byte after that is a new review, never a silent re-pin.
 */
export const PICTURE_WORKER_SHA256: string | null = '4bb15a5053122a10b442d1770a93da23b44bfa97c4401e183565b094725d6e25'; // read line by line by the lead on 2026-11-26 (436 lines: stdin one line, stdout one line, the model file read-only, no subprocess, no file written)

const P = '/api/v1/projects/:id';
/** Every picmodels route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). No map route this wave. */
export const PICMODELS_ROUTES = ['GET /api/v1/picture-models', `POST ${P}/eyes/propose`] as const;
/** The routes only a credential acting as the owner reaches (actsAsOwner, ADR-0036; 403 owner_required otherwise, before anything is read). */
export const PICMODELS_OWNER_ROUTES: readonly string[] = [`POST ${P}/eyes/propose`];
/** No MCP tool of this track, ever in this wave (no eyes tool, no map tool). */
export const PICMODELS_MCP_TOOLS = [] as const;

/** Everything http.ts, routes.ts and index.ts need of the runtime. W1's runtime.ts makes the real one. */
export interface PictureModelsRuntime {
  /** the setup state of one model, in the order of core PICTURE_MODEL_SETUP_CODES (owner's wording in `detail`) */
  setup(id: PictureModelId): Promise<PictureModelStatus>;
  /** every model's row (the route filters it with core pictureModelsFor) */
  list(): Promise<PictureModelStatus[]>;
  /** POST …/eyes/propose after the owner and project checks: the whole validated answer; nothing is stored */
  proposeEyes(p: Principal, projectId: string, body: EyesProposeBody, signal: AbortSignal): Promise<EyesAnswer>;
  /** index.ts at shutdown: kill a running eyes process */
  stop(): Promise<void>;
}

export type PicmodelsEnv = { Variables: { principal: Principal } };
export type PicmodelsApp = Hono<PicmodelsEnv>;
export interface PicmodelsRouteDeps {
  cfg: Config; store: Store; gov: Governance; runtime: PictureModelsRuntime;
  need: (c: Context<PicmodelsEnv>, scope: Scope) => Principal;
}
/** What createPictureModelsRuntime gets from index.ts. */
export interface PictureModelsRuntimeDeps { cfg: Config; store: Store }
/**
 * TEST SEAMS ONLY (the proof and unit tests; never from configuration or the environment): the labelled fake worker
 * (picmodels/testdata/fake_pf_picture.py) and the digest that counts as reviewed for it, a synthetic registry whose pins name tiny
 * synthetic files, and a synthetic library root with its own _manifests/ledger.json.
 */
export interface PictureModelsTestSeams {
  worker?: string;
  workerSha256?: string | null;
  registry?: typeof PICTURE_MODELS;
  libraryRoot?: string;
}

/** A core PICMODELS_REFUSALS entry as an ApiError (fixed English; HE_PICMODELS words it). Details: codes and integers only. */
export function picmodelsError<K extends PicmodelsRefusalKey>(key: K, details: Record<string, string | number | boolean | null> = {}, ...args: Parameters<(typeof PICMODELS_REFUSALS)[K]['message']>): ApiError {
  const x = PICMODELS_REFUSALS[key] as { status: number; code: string; message: (...a: unknown[]) => string; hint: string };
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}

/** The runtime of a build without picture models: every row not_built, eyes refuse 501 (never a made-up answer). */
export function notBuiltPictureModels(registry: typeof PICTURE_MODELS = PICTURE_MODELS): PictureModelsRuntime {
  return {
    setup: async (id) => notBuiltPictureModelStatus(registry.find((m) => m.id === id) ?? PICTURE_MODELS.find((m) => m.id === id)!),
    list: async () => registry.map(notBuiltPictureModelStatus),
    proposeEyes: async () => { throw picmodelsError('notBuilt'); },
    stop: async () => {},
  };
}

// ---------- the worker launcher's contract (../toolsWorker.ts, W1) ----------
/** How the tools Python is started (always `python -I -X utf8 script …` = pythonArgs.ts PYTHON_WORKER_FLAGS, OFFLINE_ENV, cwd tmpDir). */
export interface ToolsProcessSpec { python: string; script: string; tmpDir: string }
/**
 * ONE process, ONE request, ONE answer line: spawn `python -I -X utf8 script ...args`, write `request` as one JSON line to stdin, take the
 * first stdout line that is JSON with this id (other lines are dropped), and resolve with it UNPARSED by any schema (the caller parses
 * it strictly). Kill with SIGKILL on `signal` abort (rejects with the signal's reason), on `timeoutMs` (rejects
 * picmodelsError('engineFailed', { reason: 'timeout' })) and as soon as the line arrived. An exit before the line rejects
 * engineFailed { reason: 'exited', exit }. Never writes a file, never logs, never puts stderr or a message into an error's message or
 * details (stderr is returned only through `onStderrTail` for the owner's setup detail).
 */
export type RunToolsOnce = (spec: ToolsProcessSpec, args: readonly string[], request: EyesWorkerRequest, signal: AbortSignal, timeoutMs: number, onStderrTail?: (tail: string) => void) => Promise<unknown>;
/** `pf_picture.py probe`: versions and the first module it cannot import (a package name), or a start failure. */
export interface PicturePythonProbe { ok: boolean; python: string | null; versions: Record<string, string>; missing: string | null; cudaDevices: number }
export type ProbePicturePython = (spec: ToolsProcessSpec, timeoutMs?: number) => Promise<PicturePythonProbe>;
/** Parse a worker line strictly (core EyesWorkerLineSchema) or throw picmodelsError('engineFailed', { reason: 'line' }) — never the ZodError. */
export type ParseEyesLine = (raw: unknown, id: number) => EyesWorkerLine;

/**
 * THE PROTOCOL of pf_picture.py (W2) and the labelled fake (W1), one JSON object per stdout line:
 *   probe                                  → {"event":"result","ok":bool,"python":"3.13.x","versions":{numpy,onnxruntime},"missing":null|"onnxruntime","cudaDevices":0}; exit 0 when ok else 1
 *   inspect --model yunet --file model=P   → laptop only (PM4): {"event":"result","inputs":[{name,shape}],"outputs":[{name,shape}]} (no torch inspect: cut)
 *   serve --role eyes --model P --threads 2
 *                                          → verifies P's size and SHA-256 against its own copy of the yunet pin, reads ONE request
 *                                            line {"id","cmd":"eyes","w","h","rgb":"<base64 rgb24>"} (exactly these keys), loads with
 *                                            providers=['CPUExecutionProvider'], intra_op_num_threads=2, log_severity_level=3, answers
 *                                            ONE line of core EyesWorkerLineSchema and exits. There is no `ready` line.
 *   errors: {"id","event":"error","code"} once the request's id is known, else {"event":"error","code"} (a model mismatch before
 *   the request: the server reads it as model_missing for the owner's setup line). Codes only: never a message or a traceback.
 * Nothing else is ever written to stdout. A test adapter that answers is labelled PICTURE_TEST_ADAPTER_LABEL in `method`.
 */
export const PICTURE_PROTOCOL_VERSION = 1;
/** The labelled fake's `method` (the runtime uses it whenever the test seam's worker is set; never shown as a model). */
export const PICTURE_TEST_ADAPTER_LABEL = 'TEST-ADAPTER-picture/1 (labelled stand-in: not a model; proves plumbing, never quality)';
