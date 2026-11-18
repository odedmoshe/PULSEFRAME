/**
 * Phone drop and the import queue (ADR-0023, amends ADR-0002): the shapes every side of an import shares. The server's import
 * queue writes job rows (apps/server/src/importContracts.ts); the editor shows them as cards; the drop door reports a drop code
 * to the owner's dialog. Pure data and one pure mapping (importCardState); no I/O.
 *
 * Lead contract (wave 5). The rules the plan's verifier corrected, which win over the plan:
 * - Only disk_full, canceled and internal_error are retryable (IMPORT_RETRYABLE): a file that could not be read or converted
 *   fails the same way again, and its stored original is removed at once when nothing else mentions it.
 * - A background import (kind 'background') stays off the default Ctrl+Z target only for the SAME actor; a phone import is
 *   another actor's transaction anyway. It is reversed with the library's remove button or by transaction id over REST/MCP.
 * - Nothing here is a secret: a drop code's token, PIN and session never appear in any of these shapes except DropCodeView's
 *   url and pin, which go to the owner's own session only, and only while the code waits for a phone.
 */
import { IMPORT_VIA, type Asset } from './schema.ts';

export type ImportVia = (typeof IMPORT_VIA)[number];
/** The card of one file: the four states of the brief (waiting, converting, ready, failed) and canceled. */
export type ImportCardState = 'waiting' | 'converting' | 'ready' | 'failed' | 'canceled';
/** Why a waiting card waits: being checked, behind other files, behind another heavy job, or behind a running export. */
export type ImportWaitingFor = 'check' | 'turn' | 'compute' | 'export';
/** Every way an import job can fail after its bytes were stored. (Refusals before that are HTTP answers, never job rows.) */
export const IMPORT_ERROR_CODES = ['unsupported_media', 'conform_failed', 'disk_full', 'storage_quota_exceeded', 'original_gone', 'project_gone', 'canceled', 'internal_error'] as const;
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];
/** The only failures a retry can cure (verifier correction): out of disk space, stopped by a person, or a fault of the server. */
export const IMPORT_RETRYABLE: readonly ImportErrorCode[] = ['disk_full', 'canceled', 'internal_error'];
export const importErrorRetryable = (code: ImportErrorCode): boolean => IMPORT_RETRYABLE.includes(code);
/** The conform reasons (Asset.conform.reasons), the words of notice.reason.* in the dictionaries. */
export type ConformReason = NonNullable<Asset['conform']>['reasons'][number];

/**
 * Error codes the import and drop routes of the main server answer with that are new in this track (HTTP refusals, not job
 * failures). Each has an `error.code.<code>` headline in Hebrew and English (packages/i18n/src/phoneDrop.ts; i18n.test.ts).
 */
export const IMPORT_API_ERROR_CODES = ['upload_incomplete', 'invalid_filename', 'disk_full', 'original_gone', 'conform_failed', 'project_gone', 'unsupported_media', 'not_your_job', 'not_an_import', 'import_not_finished', 'no_private_network', 'invalid_address', 'drop_listen_failed', 'drop_not_found'] as const;
export type ImportApiErrorCode = (typeof IMPORT_API_ERROR_CODES)[number];

/** A failed import job's `error` column. `status` is what the synchronous POST …/assets route answers with (415, 507, 404 …). */
export interface ImportJobError { code: ImportErrorCode; message: string; status: number; retryable: boolean; details?: Record<string, unknown>; hint?: string; dismissed?: true }
/** A succeeded import job's `output` column. */
export interface ImportJobOutput { assetId: string; revision: number; deduplicated: boolean; converted: boolean; reusedConform: boolean; reasons: ConformReason[]; contentHash: string; conformSeconds: number | null; dismissed?: true }
/** A running import job's `output` once the probe decided to convert (verifier correction: the card shows why while it waits). */
export interface ImportJobProgressOutput { reasons: ConformReason[] }

export interface ImportJobView {
  jobId: string; projectId: string; name: string; byteSize: number; via: ImportVia;
  state: ImportCardState; waitingFor: ImportWaitingFor | null; percent: number | null;
  /** Conversions ahead of this one (null when it is not waiting for its turn). The editor may also count it from list order. */
  queuePosition: number | null;
  /** Why it is being converted, once known (the values of Asset.conform.reasons). */
  reasons: ConformReason[];
  assetId: string | null; deduplicated: boolean;
  error: { code: ImportErrorCode; message: string; retryable: boolean } | null;
  batchId: string | null; dropId: string | null; retryOf: string | null; attempt: number;
  createdAt: string; updatedAt: string;
}
/** Room for the next file. null = no ceiling configured / free space not measurable on this machine. */
export interface ImportRoom { ceilingRoomBytes: number | null; freeDiskBytes: number | null; reserveBytes: number; maxFileBytes: number }

/** Job stages the import queue writes (status 'running' unless said otherwise). */
export const IMPORT_STAGE = { recovered: 'recovered-after-restart', probing: 'probing', waitingExport: 'waiting-export', waitingCompute: 'waiting-compute' } as const;
/** The stage of a running conversion at `percent` (an integer 0–99; 100 is never written: the stage stays 99 through the commit). */
export const convertingStage = (percent: number): string => `converting:${Math.min(99, Math.max(0, Math.floor(Number.isFinite(percent) ? percent : 0)))}`;
const CONVERTING = /^converting:(\d{1,2})$/;

/**
 * The one mapping from a job row to a card state, used by the server's views and the editor alike.
 *   succeeded → ready · failed → failed · canceled | cancel-requested → canceled
 *   running + converting:N → converting (percent N) · running + waiting-compute → waiting/compute · running + waiting-export → waiting/export
 *   running + anything else (probing, no stage yet) → waiting/check · queued (any stage, recovered-after-restart included) → waiting/turn
 * A status this build does not know reads as waiting/check: never as ready, never as a failure without a reason.
 */
export function importCardState(job: { status: string; stage: string | null }): { state: ImportCardState; waitingFor: ImportWaitingFor | null; percent: number | null } {
  switch (job.status) {
    case 'succeeded': return { state: 'ready', waitingFor: null, percent: null };
    case 'failed': return { state: 'failed', waitingFor: null, percent: null };
    case 'canceled': case 'cancel-requested': return { state: 'canceled', waitingFor: null, percent: null };
    case 'queued': return { state: 'waiting', waitingFor: 'turn', percent: null };
    case 'running': {
      const m = CONVERTING.exec(job.stage ?? '');
      if (m) return { state: 'converting', waitingFor: null, percent: Math.min(99, Number(m[1])) };
      if (job.stage === IMPORT_STAGE.waitingCompute) return { state: 'waiting', waitingFor: 'compute', percent: null };
      if (job.stage === IMPORT_STAGE.waitingExport) return { state: 'waiting', waitingFor: 'export', percent: null };
      return { state: 'waiting', waitingFor: 'check', percent: null };
    }
    default: return { state: 'waiting', waitingFor: 'check', percent: null };
  }
}

// ---------- the phone drop code ----------
/** The actor of a phone upload: the code is the credential (ADR-0023). The activity list names it «העלאה מהטלפון» (actor.phone). */
export const PHONE_ACTOR_PREFIX = 'phone:';
export const phoneActor = (dropId: string): string => `${PHONE_ACTOR_PREFIX}${dropId}`;
export const isPhoneActor = (actor: string): boolean => typeof actor === 'string' && actor.startsWith(PHONE_ACTOR_PREFIX);
/** Who an actor string names, for the activity list: the owner, an agent, a phone drop code, or something else (shown as written). */
export function actorKind(actor: string): 'user' | 'agent' | 'phone' | 'other' {
  if (typeof actor !== 'string') return 'other';
  if (actor.startsWith('user:')) return 'user';
  if (actor.startsWith('agent')) return 'agent';
  if (isPhoneActor(actor)) return 'phone';
  return 'other';
}

/** What every observer of the project may see about a drop code (SSE event `drop`). Never a secret. */
export type DropState = 'waiting' | 'connected' | 'closed';
export const DROP_CLOSE_REASONS = ['expired', 'idle', 'max-life', 'owner', 'phone', 'replaced', 'locked', 'shutdown'] as const;
export type DropCloseReason = (typeof DROP_CLOSE_REASONS)[number];
export interface DropPublicView { dropId: string; projectId: string; state: DropState; closeReason: DropCloseReason | null; issuedAt: string; expiresAt: string; files: number; bytes: number; inFlight: number; remainingBytes: number; filesLeft: number }
/**
 * Owner only (POST/GET …/drop). `url` (`http://<address>:<port>/#<token>`) and `pin` (6 digits) are present only while the state
 * is 'waiting'; once a phone claimed the code they are null, and they are never logged.
 */
export interface DropCodeView extends DropPublicView { address: string; port: number; url: string | null; pin: string | null }
/** An address the door may listen on: a private IPv4 address of this machine. `preferred` = the default route's (UDP probe). */
export interface DropAddress { address: string; netmask: string; interfaceName: string; preferred: boolean }
