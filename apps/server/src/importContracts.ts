/**
 * Phone drop and the import queue (ADR-0023, amends ADR-0002): the server-side contract W1 (the drop door, drop.ts and
 * dropNet.ts) and W2 (the import queue, importQueue.ts, and the ingest phases in ingest.ts) implement, and the lead wires into
 * http.ts, mcp.ts and index.ts. The shapes every side shares are in packages/core/src/importView.ts.
 *
 * LEAD CONTRACT (wave 5). The owner's decisions (2026-11-17) and the plan verifier's corrections WIN over the plan text:
 *
 * The door (owner decisions)
 * - Plain HTTP inside the home network; no certificate. A second listener exists only while a code is live, bound to the ONE
 *   private IPv4 address the owner confirmed in the dialog (open() takes it; never 0.0.0.0, never chosen by the server alone).
 *   The main editor stays on loopback (config.ts). The door serves the upload page and the upload routes (DROP_ROUTES) and
 *   nothing else: no route table, cookie, token or Auth instance is shared with the main app.
 * - The code is a credential with ONE scope: upload into one named project's library. Only the owner's own session issues it
 *   (Principal.kind 'user'); no agent, no MCP tool, no REST route an agent token passes. ADR-0002's "no unauthenticated writes"
 *   holds: the code IS the authentication. One phone, many files: the first /hello claims it; it closes after 10 idle minutes
 *   (cfg.dropTtlMinutes), 10 minutes unclaimed, 60 minutes at most, on «סיימתי» (/bye), when the owner closes it, after
 *   DropLimits.maxBadHellos wrong claims, when a new code replaces it, and at shutdown. Closing revokes it at once.
 * - Secrets (token 16 random bytes base64url, PIN crypto.randomInt 6 digits, session 32 random bytes) are NEVER logged, never
 *   in an event, an error body, a job row or a document: shown only as the QR and the typed fallback in the owner's dialog
 *   (DropCodeView.url / .pin, while 'waiting'). Every comparison is timingSafeEqual over SHA-256 digests. Rate limits per peer.
 *
 * The queue (verifier corrections)
 * - Every op argument is a pure function of the job input and the stored blobs: provenance.importedAt = input.receivedAt,
 *   importedBy = job.actor, the capture date read by captureMeta.ts readCapture on the ORIGINAL blob with
 *   { homeZone: deps.homeZone, now: new Date(input.receivedAt) } (the life line's reader, ADR-0021; there is no second reader).
 * - Commit: store.commit({ actor: job.actor, allowInternal: true, kind: input.commitKind, idempotencyKey: importIdempotencyKey(job.id),
 *   label, ops: [import_asset] }), then derivatives.ensure. Recovery step 0, before any probe: look up the transaction with that
 *   key (store.db: project_id, actor, idempotency_key); when found, finish the job from it (deduplicated false, same assetId and
 *   revision) and spawn no ffmpeg.
 * - receive(): applies LUT_MAX_TEXT_LENGTH while streaming a `.cube` name, fsyncs the temp file, then putBlob and createJob in
 *   one synchronous step, then store.events.emit('job', row) (createJob emits nothing). The probe refuses with original_gone
 *   when the blob's size differs from input.byteSize. The duplicate and conform-reuse checks run again right before ffmpeg.
 * - On unsupported_media or conform_failed the stored original is deleted at once when no asset, proposal or other job mentions
 *   its hash; error.retryable follows importErrorRetryable (core). Jobs with commitKind 'edit' are dismissed when they fail
 *   (the synchronous route answered with the error already). Temp names are importTempName(...) (unique per attempt); recovery
 *   removes tmp/imp_* and tmp/up_* inside try/catch and never fails start-up on a busy file (Windows).
 * - The free-disk reserve refuses only as diskReserveRefuses says; unit tests always inject freeBytes.
 * - Kind 'background' keeps a finished import off the SAME actor's default Ctrl+Z (store.ts); a phone import is another actor's
 *   transaction anyway. There is no undo-by-transaction control in the activity list: a background import is reversed with the
 *   library's remove button, or by transaction id over REST/MCP. Ctrl+Z no longer removes a file the owner just imported.
 * - The synchronous POST …/assets keeps its 201 body: receive(commitKind 'edit') + wait; a `.cube` name keeps calling
 *   ingestUpload directly (store after validation, lut.test.ts). ingestUpload and every current export of ingest.ts keep their
 *   signatures (capabilities.ts, speech.ts, localtools.ts, elements.ts, sfx.ts and five test files import them).
 * - Retry, dismiss and cancel of an import job follow assertMayHandleImportJob. A retried job runs as the retrier's actor and
 *   keeps via, dropId and issuedBy in its input (the code may be closed by then; the retry is the retrier's act).
 * - Headers: x-filename and x-pf-relative-path are percent-encoded UTF-8, at most MAX_NAME_HEADER_BYTES each; decode them with
 *   decodeUploadHeader (400 invalid_filename). The page and the editor cut a long name before encoding with cutUploadName
 *   (core): x-filename to 256 characters, x-pf-relative-path to 512, and each to MAX_NAME_HEADER_BYTES encoded, extension kept.
 * - receive() never lets a name or path reach the commit longer than the schema allows (a REST client need not cut): after
 *   cleaning, it cuts the name to MAX_UPLOAD_NAME_CHARS (a `.cube` suffix kept) and relativePath to MAX_RELATIVE_PATH_CHARS
 *   characters (UTF-16 units, as the schema counts; no code point split; cutUploadName(value, max, Infinity)), drops a
 *   relativePath that is empty after cleaning, and keeps relativePath only when via is 'folder' (validate.ts import_provenance).
 *   Otherwise the import_asset commit would fail on UploadProvenanceSchema or AssetSchema with a code outside IMPORT_ERROR_CODES.
 */
import type { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import type { NetworkInterfaceInfo } from 'node:os';
import type { Readable } from 'node:stream';
import { isPhoneActor, MAX_NAME_HEADER_BYTES, type DropAddress, type DropCloseReason, type DropCodeView, type DropState, type ImportJobView, type ImportRoom, type ImportVia } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import type { Config } from './config.ts';
import type { Governance } from './governance.ts';
import { ApiError, type JobRow } from './store.ts';

export type { ImportJobError, ImportJobOutput, ImportJobProgressOutput } from '@pulseframe/core';

export const IMPORT_JOB_TYPE = 'import' as const;
/** Bump when the ffmpeg arguments of the conform recipe (ingest.ts) change: results made by another recipe are not reused. */
export const CONFORM_RECIPE = 'conform-1' as const;
/** The idempotency key of an import job's commit (crash between commit and job update: recovery finds this transaction). */
export const importIdempotencyKey = (jobId: string): string => `import:${jobId}`;
/** Name of an import job's working file in the data directory's tmp/ (unique per attempt, so a stray ffmpeg of an earlier attempt never shares it). */
export const importTempName = (jobId: string, attempt: number, rand: string): string => `imp_${jobId}_${attempt}_${rand}`;

export interface ImportJobInput {
  /** sha256:<hex> of the bytes exactly as received. The blob exists before the job row does. */
  originalHash: string;
  byteSize: number;
  /** Cleaned basename (both separators; no C0 controls, no bidi overrides U+202A–202E, U+2066–2069), at most 256 characters, a `.cube` suffix kept. */
  name: string;
  via: ImportVia;
  dropId?: string;
  /** The owner session that issued the drop code (phone uploads only). */
  issuedBy?: string;
  /** Cleaned like the name (no C0 controls, no bidi overrides), at most 512 characters (UTF-16 units), 'folder' only. */
  relativePath?: string;
  /**
   * ISO UTC from the uploader's File.lastModified. Declared by the client and recorded only: it is NOT a capture date (phone
   * pickers report the moment of picking; the life line's reader has no such rule), so it never reaches Asset.capture.
   */
  declaredLastModified?: string;
  /** When the bytes were stored (ISO UTC). provenance.importedAt and the capture reader's `now` come from it. */
  receivedAt: string;
  /** 'edit' = the synchronous POST …/assets route (today's behaviour); 'background' = everything else. */
  commitKind: 'edit' | 'background';
  batchId?: string;
  retryOf?: string | null;
}

export interface ReceiveRequest {
  projectId: string;
  /** From the credential: 'user:local', an agent actor, or 'phone:<dropId>'. Never from a request body. */
  actor: string;
  body: Readable;
  /** As sent (already percent-decoded with decodeUploadHeader); receive() cleans it and cuts it to MAX_UPLOAD_NAME_CHARS. */
  name: string;
  via: ImportVia;
  /** Content-Length, or null when the sender gave none (the main routes allow that; the door does not). */
  declaredBytes: number | null;
  /** Cap for this file, already the minimum of the caller's own limits. receive() additionally applies the ceiling and the disk reserve. */
  maxBytes: number;
  commitKind: 'edit' | 'background';
  dropId?: string; issuedBy?: string;
  /**
   * As sent (already percent-decoded). receive() cleans it like the name, cuts it to MAX_RELATIVE_PATH_CHARS characters
   * (UTF-16 units, no code point split) and keeps it only when via is 'folder'; ImportJobInput.relativePath is the result.
   */
  relativePath?: string;
  declaredLastModified?: string; batchId?: string;
  /** Aborting it stops the stream and deletes the partial file; nothing is enqueued. */
  signal?: AbortSignal;
}
export interface ImportQueue {
  /**
   * Streams, hashes and stores the original, creates the durable job and returns. Throws ApiError 413 upload_too_large,
   * 507 storage_quota_exceeded | disk_full, 400 empty_upload | upload_incomplete | invalid_filename, 404 project_not_found.
   */
  receive(req: ReceiveRequest): Promise<JobRow>;
  /** Resolves when the job reaches succeeded, failed or canceled. */
  wait(jobId: string): Promise<JobRow>;
  /** Open jobs and failed or canceled jobs not yet dismissed, oldest first. */
  list(projectId: string): ImportJobView[];
  view(job: JobRow): ImportJobView;
  room(): ImportRoom;
  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: 'removed-from-queue' | 'stopping' | 'already-finished' };
  /** Failed or canceled jobs only; refused with 409 original_gone when the stored original was cleaned up, 409 import_not_finished otherwise. */
  retry(jobId: string, actor: string): JobRow;
  /** Failed or canceled jobs only (409 import_not_finished otherwise). */
  dismiss(jobId: string, actor: string): void;
  /** recoverJobs('import'), cancel-requested rows finished as canceled, temp files removed; returns the number re-enqueued. */
  recover(): number;
  /** Aborts receives in flight (their temp files removed), kills the running ffmpeg, leaves rows running for recover(). */
  stop(): Promise<void>;
}
export interface ImportQueueDeps {
  store: import('./store.ts').Store;
  lane: import('./lane.ts').FifoComputeLane;
  derivatives: Pick<import('./derive.ts').Derivatives, 'ensure'>;
  maxUploadBytes: number;
  reserveBytes: number;
  /** cfg.homeZone: for the capture reader (files that give only a UTC instant). */
  homeZone: string;
  /** Free bytes on the data volume (default fs.statfsSync); tests inject values. null = not measurable here. */
  freeBytes?: (dir: string) => number | null;
  now?: () => number;
  /** Starts ffmpeg with these arguments (default child_process.spawn('ffmpeg', args)); tests count the calls. */
  spawnFfmpeg?: (args: string[]) => ChildProcess;
}

/**
 * Headers carrying a name are percent-encoded UTF-8 and at most this many bytes as sent (core). A 256-character Hebrew name is
 * about 1.5 kB, but a 256-character name of emoji or CJK, or a 512-character Hebrew path, is more: senders cut with
 * cutUploadName (core), which counts the encoded bytes as well as the characters.
 */
export { MAX_NAME_HEADER_BYTES };
/**
 * The value of an upload header that carries a name (x-filename, x-pf-relative-path): percent-decoded UTF-8, or null when the
 * header is absent or empty. Refuses with 400 invalid_filename a value longer than `maxBytes`, one with characters a header
 * should not carry unencoded (anything outside printable ASCII), one that does not decode, and one holding NUL.
 */
export function decodeUploadHeader(raw: string | null | undefined, what = 'file name', maxBytes = MAX_NAME_HEADER_BYTES): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const bad = (why: string) => new ApiError(400, 'invalid_filename', `the ${what} header ${why}`, { maxBytes }, `Send the name percent-encoded as UTF-8 (encodeURIComponent), cut to 256 characters and to ${maxBytes} bytes encoded.`);
  if (raw.length > maxBytes) throw bad(`is longer than ${maxBytes} bytes`);
  if (!/^[\x20-\x7e]*$/.test(raw)) throw bad('is not percent-encoded');
  let value: string;
  try { value = decodeURIComponent(raw); } catch { throw bad('is not valid percent-encoded UTF-8'); }
  if (value.includes('\0')) throw bad('holds a NUL character');
  return value;
}

/** A file of at most this size is never refused for the reserve while more than DISK_FLOOR_BYTES stay free after it. */
export const SMALL_FILE_BYTES = 64 * 1024 ** 2;
export const DISK_FLOOR_BYTES = 256 * 1024 ** 2;
/**
 * The free-disk reserve (verifier correction): refuse (507 disk_full) only when the declared size is known, free space is
 * measurable, and free − reserve < declared, except that a small file never is while more than DISK_FLOOR_BYTES stay free.
 * Without a declared size the reserve is not applied (the byte cap still is).
 */
export function diskReserveRefuses(freeBytes: number | null, reserveBytes: number, declaredBytes: number | null): boolean {
  if (declaredBytes === null || freeBytes === null || !Number.isFinite(freeBytes)) return false;
  if (freeBytes - reserveBytes >= declaredBytes) return false;
  return !(declaredBytes <= SMALL_FILE_BYTES && freeBytes - declaredBytes > DISK_FLOOR_BYTES);
}

/**
 * Who may cancel, retry or dismiss an import job (verifier correction: the cancel rule of http.ts assertMayCancel, also for
 * retry and dismiss). The owner may handle any import. An agent must be allowed to act on the project and may handle only jobs
 * it started; a phone's job is the owner's alone. 409 not_an_import for a job of another type.
 */
export function assertMayHandleImportJob(gov: Pick<Governance, 'assertMayAct'>, p: Principal, job: JobRow, what: 'cancel' | 'retry' | 'dismiss'): void {
  if (job.type !== IMPORT_JOB_TYPE) throw new ApiError(409, 'not_an_import', `job ${job.id} is not an import`, { jobId: job.id, type: job.type });
  if (p.kind === 'user') return;
  gov.assertMayAct(p, job.projectId, 'job');
  if (isPhoneActor(job.actor)) throw new ApiError(403, 'owner_required', `only the owner can ${what} a file sent from a phone`, { jobId: job.id });
  if (job.actor !== p.actor) throw new ApiError(403, 'not_your_job', `agents can only ${what} imports they started`, { jobId: job.id, startedBy: job.actor });
}

// ============================================================================
// The drop door (W1)
// ============================================================================
/**
 * Limits of one drop code. Burst = bucket capacity, perMinute = refill (verifier correction: the capacities are stated here,
 * they are not auth.ts's perMinute/6). A 429 never counts as a wrong hello and carries Retry-After = ceil((1 − tokens) / rate).
 */
export interface DropLimits {
  ttlMs: number; idleMs: number; maxLifeMs: number;
  maxFiles: number; maxCodeBytes: number; maxFileBytes: number;
  helloBurst: number; helloPerMinute: number; uploadBurst: number; uploadsPerMinute: number; otherBurst: number; otherPerMinute: number;
  maxBadHellos: number; maxConcurrentUploads: number;
  /** An upload with no body bytes for this long is aborted. */
  stallMs: number;
  /** An early refusal (411/413/507/410/401/429) is written with Connection: close, then the body is drained for at most drainMs or drainBytes before the socket is destroyed, so a phone browser reads the refusal instead of a reset. */
  drainMs: number; drainBytes: number;
  headersTimeoutMs: number; connectionsCheckingIntervalMs: number; keepAliveTimeoutMs: number; maxConnections: number; maxHeaderBytes: number;
  /**
   * Absolute lifetime of every connection from a peer that has not claimed the code (every peer before the claim, every other
   * device after it): destroyed this long after it was accepted, whatever it is doing. The phone's own connections lose the limit
   * at its claim.
   */
  unclaimedConnectionMs: number;
  /**
   * Response bytes a connection may leave unread (written by the door, not yet handed to the network) before another response
   * is refused by destroying the socket; one response larger than this on its own is allowed.
   */
  maxUnreadResponseBytes: number;
  /** x-filename as sent, percent-encoded (MAX_NAME_HEADER_BYTES). */
  maxFilenameHeaderBytes: number;
  /** POST /hello body. */
  maxHelloBytes: number;
}
export const DROP_DEFAULTS: DropLimits = {
  ttlMs: 600_000, idleMs: 600_000, maxLifeMs: 3_600_000,
  maxFiles: 200, maxCodeBytes: 16 * 1024 ** 3, maxFileBytes: 2 * 1024 ** 3,
  helloBurst: 6, helloPerMinute: 12, uploadBurst: 40, uploadsPerMinute: 600, otherBurst: 30, otherPerMinute: 60,
  maxBadHellos: 5, maxConcurrentUploads: 2,
  stallMs: 30_000, drainMs: 2_000, drainBytes: 8 * 1024 ** 2,
  headersTimeoutMs: 10_000, connectionsCheckingIntervalMs: 2_000, keepAliveTimeoutMs: 5_000, maxConnections: 16, maxHeaderBytes: 8 * 1024,
  unclaimedConnectionMs: 30_000, maxUnreadResponseBytes: 256 * 1024,
  maxFilenameHeaderBytes: MAX_NAME_HEADER_BYTES, maxHelloBytes: 512,
};
/** The limits of a code on this server: the defaults with the configured lifetime, code budget and per-file cap. */
export function dropLimitsFrom(cfg: Pick<Config, 'dropTtlMinutes' | 'dropCodeBytes' | 'maxUploadBytes'>): DropLimits {
  return { ...DROP_DEFAULTS, ttlMs: cfg.dropTtlMinutes * 60_000, idleMs: cfg.dropTtlMinutes * 60_000, maxCodeBytes: cfg.dropCodeBytes, maxFileBytes: cfg.maxUploadBytes };
}
/** The connect target of the unsent UDP probe that finds the default route's address (a documentation address: no packet is ever sent). */
export const ROUTE_PROBE_ADDRESS = '192.0.2.1';

/** The door's complete route table (exact method and path). Everything else: 404, empty body, Connection: close. */
export const DROP_ROUTES = ['GET /', 'POST /hello', 'POST /upload', 'POST /status', 'POST /bye'] as const;
/** Every `error.code` the door answers with. The phone page maps each to plain Hebrew and English (drop-page). */
export const DROP_WIRE_ERROR_CODES = ['invalid_request', 'code_invalid', 'code_already_used', 'code_expired', 'rate_limited', 'session_invalid', 'code_closed', 'length_required', 'upload_too_large', 'code_budget', 'storage_quota_exceeded', 'disk_full', 'upload_incomplete', 'empty_upload', 'invalid_filename', 'internal_error'] as const;
export type DropWireErrorCode = (typeof DROP_WIRE_ERROR_CODES)[number];
/** POST /hello → 200. */
export interface DropHelloResponse { session: string; expiresInSeconds: number; maxFileBytes: number; remainingBytes: number; filesLeft: number }
/** POST /upload → 201. */
export interface DropUploadResponse { accepted: true; bytes: number; remainingBytes: number; filesLeft: number }
/** POST /status → 200 (Bearer session, empty body): what the page checks before each file and after a network error. */
export interface DropStatusResponse { state: DropState; maxFileBytes: number; remainingBytes: number; filesLeft: number }
/** POST /bye → 200. */
export interface DropByeResponse { closed: true }
// Door wire protocol (exact; anything else is 404 with an empty body):
//   GET  /        → 200 text/html (DropPage.body) + DropPage.csp, nosniff, no-referrer, X-Frame-Options DENY, Cache-Control no-store;
//                   never Set-Cookie, never Access-Control-*
//   POST /hello   application/json ≤ maxHelloBytes  {"token": string} | {"pin": string}
//                 → 200 DropHelloResponse
//                 → 400 invalid_request · 401 code_invalid · 409 code_already_used · 410 code_expired · 429 rate_limited
//                 The ORIGINAL token from the SAME claiming IP while the code is live returns a new session and voids the old one
//                 (a phone browser that reloaded the page; still one device). Another IP: 409. The PIN stays single-use.
//                 A wrong token or PIN counts toward maxBadHellos (then the code closes with 'locked'); a 429 never counts.
//   POST /upload  authorization: Bearer <session>; content-length required; x-filename (percent-encoded UTF-8, ≤ 2048 B);
//                 x-pf-last-modified (ms since epoch, optional)
//                 → 201 DropUploadResponse
//                 → 401 session_invalid (also from an IP other than the claiming one) · 410 code_closed · 411 length_required
//                   · 413 upload_too_large | code_budget · 507 storage_quota_exceeded | disk_full
//                   · 400 upload_incomplete | empty_upload | invalid_filename · 429 rate_limited
//                 A declared length above the cap (min of maxFileBytes, ceiling room, free disk − reserve, code budget − accepted
//                 − in flight) is refused before a body byte is read, naming the first limit that failed; in-flight bytes are
//                 reserved at request start.
//   POST /status  authorization: Bearer <session> → 200 DropStatusResponse · 401 session_invalid
//   POST /bye     authorization: Bearer <session> → 200 DropByeResponse (closes the code, reason 'phone')
//   Error body: {"error": {"code": DropWireErrorCode}} and nothing else. No response carries a project id or name, an asset,
//   a job id or a hash.
//   QR URL: `http://${address}:${port}/#${token}`. Typed fallback: `${address}:${port}` plus the 6-digit pin.
//   Every request, in order: peer inside the bound subnet (else the socket is destroyed, nothing parsed); Host exactly
//   `<address>:<port>` (else 404); Origin, when present, exactly `http://<address>:<port>` and Sec-Fetch-Site not cross-site
//   (else 403); the token bucket of the route's class per peer IP; the exact route table.

export interface DropDoorDeps {
  /** Uploads go only through receive({ via: 'phone', actor: phoneActor(dropId), commitKind: 'background', issuedBy, dropId, signal }). */
  queue: Pick<ImportQueue, 'receive' | 'room'>;
  projectExists: (projectId: string) => boolean;
  page: () => import('./drop-page/index.ts').DropPage;
  /** cfg.dropPort (0 = any free port). */
  port: number;
  limits: DropLimits;
  /** cfg.dropAdmitAddresses: addresses outside the private ranges that may be used (proofs only; never from the environment). */
  admitAddresses: string[];
  /** Default os.networkInterfaces; tests inject a list. */
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  /** The default route's local address (default: an unsent UDP socket connected to ROUTE_PROBE_ADDRESS); tests inject it. */
  preferredAddress?: () => string | null;
  now?: () => number;
  /** Where the door's own log lines go (default console.log). A line never holds a token, PIN or session. */
  log?: (line: string) => void;
}
export interface DropDoor {
  /** Emits 'drop' with a DropPublicView on every state or count change. Never a secret. */
  readonly events: EventEmitter;
  /** The private IPv4 addresses of this machine the owner may choose from (plus admitAddresses), preferred first. */
  addresses(): DropAddress[];
  /**
   * Owner session only (403 owner_required). `address` is the one the owner confirmed: it must be one of addresses() or
   * admitAddresses, else 400 invalid_address (0.0.0.0, a public address). 404 project_not_found; 409 no_private_network when
   * this machine has no private address and nothing is admitted; 503 drop_listen_failed when the port cannot be opened.
   * Closes any earlier code ('replaced'), then creates the listener and issues the code.
   */
  open(by: Principal, projectId: string, address: string): Promise<DropCodeView>;
  /** The live code (of this project when given), or null. */
  current(projectId?: string): DropCodeView | null;
  /** Closes the code and its listener and aborts its uploads in flight. 404 drop_not_found when it is not the live code. */
  close(dropId: string, reason: DropCloseReason): DropCodeView;
  /** Closes any live code with 'shutdown'. */
  stop(): Promise<void>;
}
