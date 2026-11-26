/**
 * The server side of «תא הבדיקה» (wave 8 booth track; .artifacts/wave8/booth-plan.md as corrected by booth-verify.md).
 * LEAD-OWNED (pre-pass, frozen for the builders): the answers file's name and mode, the route table, every refusal with its status,
 * code, fixed English sentence and hint (the Hebrew is packages/i18n/src/booth.ts HE_BOOTH, kept in step by
 * packages/evals/src/booth-wording.test.ts), the owner guard every booth route calls first, and what routes.ts receives from http.ts.
 *
 * RULES THE BUILDERS KEEP
 * - Every booth route, GET included, is the owner's own session only: `boothOwner(need(c, 'observe'))` is the FIRST line of every
 *   handler, before the item id, a query or the body is read (agents, observer grants and propose grants learn nothing; the phone
 *   drop has its own listener and route table, drop.ts DROP_ROUTES, and no booth path in it).
 * - No answer, header or row holds free server text: no `detail`, `message`, `e.message`, path, user, host or address (verify C3/C4).
 *   Self-check rows carry core BoothCheckRowSchema data only and are parsed with it before they are sent.
 * - Heavy work (rows export-gpu, speech, search; the export strip) runs only on its own request and answers 409 booth_busy (or a
 *   'skipped' row) while any job of BOOTH_BUSY_JOB_TYPES is queued or running in the store's jobs table.
 * - The answers file is written like instruments/heard.ts: a temporary name with mode 0600, then rename; a missing or unreadable file
 *   is "no answers". It is in NEVER_BACKED_UP (backup.ts) and in no project, archive or derivative.
 */
import type { Context, Hono } from 'hono';
import type { MusicKit } from '@pulseframe/core';
import type { RenderHost } from '@pulseframe/renderer';
import type { Scope } from '../auth.ts';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Config } from '../config.ts';
import type { Exporter } from '../export.ts';
import type { Governance, Principal } from '../governance.ts';
import type { DropDoor } from '../importContracts.ts';
import type { SearchRuntime } from '../search/contract.ts';
import type { Speech } from '../speech.ts';
import { ApiError, type Store } from '../store.ts';

/** True once W1's routes answer (flipped at integration). While false every booth route answers 501 booth_not_built after the owner check. */
export const BOOTH_BUILT: boolean = false;
/** In the data directory (never in a project, archive or backup; backup.ts NEVER_BACKED_UP): the owner's answers, 0600, atomic. */
export const OWNER_REVIEW_FILE = 'owner-review.json';
export const OWNER_REVIEW_FILE_MODE = 0o600;
/**
 * Every route of this track, as Hono registers it (openapi.ts documents each with x-owner-session-only; peopleSurfaces.ts classifies
 * each 'owner-only'). No MCP tool.
 *   GET    /api/v1/booth                          BoothView (items, answers, states, build, machine)
 *   GET    /api/v1/booth/items/:id/audio          WAV of an audio item (music: musicPreviewAnswer(styleId, 8, 1); sfx: sfxPreview);
 *                                                 headers x-pf-content-sha256, x-pf-expected-match (music), all ASCII
 *   GET    /api/v1/booth/test-picture/:which      the built-in test picture a | b (PNG, cache-control private)
 *   GET    /api/v1/booth/items/:id/export-still   one mid-transition PNG through Exporter.renderStill (exportStrip items only; heavy);
 *                                                 headers x-pf-adapter (ASCII), x-pf-software 0|1
 *   PUT    /api/v1/booth/answers/:id              BoothAnswerBody → BoothAnswerResult (note scrubbed here, before storing)
 *   DELETE /api/v1/booth/answers/:id              clears the row → 204
 *   POST   /api/v1/booth/checks/:rowId            one server row of the self-check → BoothCheckRow (heavy rows: busy → 'skipped')
 */
export const BOOTH_ROUTES = [
  'GET /api/v1/booth',
  'GET /api/v1/booth/items/:id/audio',
  'GET /api/v1/booth/test-picture/:which',
  'GET /api/v1/booth/items/:id/export-still',
  'PUT /api/v1/booth/answers/:id',
  'DELETE /api/v1/booth/answers/:id',
  'POST /api/v1/booth/checks/:rowId',
] as const;
/** Job types that make heavy booth work wait (verify C3: export, still, transcription, narration, scan, music fit). W1 fills the exact
 * type strings from the store's jobs table and pins them in a test; the list is the builder's to complete, the rule is the lead's. */
export const BOOTH_BUSY_JOB_KINDS = ['export', 'still', 'transcription', 'narration', 'scan', 'music-fit'] as const;

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint: string): ServerRefusal<A> => ({ status, code, message, hint });
/** Every refusal of the booth routes. The messages are fixed: HE_BOOTH recognises them by their shape. */
export const BOOTH_SERVER_REFUSALS = {
  ownerOnly: r(403, 'owner_required', () => 'the review booth opens only in the owner\'s own editor window', 'Open the editor from the owner link (start-pulseframe.cmd prints it) and open the review booth there.'),
  notBuilt: r(501, 'booth_not_built', () => 'the review booth is not built in this build yet', 'Nothing to do now; it comes with a later build.'),
  unknownItem: r(404, 'booth_unknown_item', () => 'there is no such item in the review booth', 'Reload the review booth; the list comes from this build.'),
  staleRecipe: r(409, 'booth_stale_recipe', () => 'the item changed since it was opened', 'Reload the review booth and answer the item again.'),
  unknownCheck: r(404, 'booth_unknown_check', () => 'there is no such check in the computer check', 'Reload the review booth; the rows come from this build.'),
  busy: r(409, 'booth_busy', () => 'an export or other work is running now, so this check was skipped', 'Wait until the export or the other work finishes, then run this check again.'),
  invalidAnswer: r(400, 'booth_invalid_answer', () => 'the answer is not in the shape the review booth stores', 'Answer from the review booth\'s own buttons.'),
} as const;
export type BoothRefusalKey = keyof typeof BOOTH_SERVER_REFUSALS;
export function boothError<K extends BoothRefusalKey>(key: K, ...args: Parameters<(typeof BOOTH_SERVER_REFUSALS)[K]['message']>): ApiError {
  const x = BOOTH_SERVER_REFUSALS[key] as ServerRefusal<unknown[]>;
  return new ApiError(x.status, x.code, x.message(...args), {}, x.hint);
}
/** The first line of every booth handler: the owner's own session (assistant/contract.ts isOwnerSession), else 403 owner_required. */
export function boothOwner(p: Principal): Principal {
  if (!isOwnerSession(p)) throw boothError('ownerOnly');
  return p;
}

export type BoothEnv = { Variables: { principal: Principal } };
export type BoothApp = Hono<BoothEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface BoothRouteDeps {
  cfg: Config; store: Store; gov: Governance;
  need: (c: Context<BoothEnv>, scope: Scope) => Principal;
  /** renderStill for the export strip; its host is renderHost. */
  exporter: Exporter;
  /** RenderHost.identity(true) for row export-gpu (index.ts passes the server's host; a test app without one gets row state 'off'). */
  renderHost: RenderHost | null;
  /** speech.status() for row speech (heavy: starts Python, hashes model files). */
  speech: Speech;
  /** status(owner) for row assistant (in memory; the setup word only, never money fields). */
  assistant: { status: (p: Principal) => unknown };
  /** setup() for row search (heavy); no project is read. */
  search: SearchRuntime;
  /** the phone drop's door, for row drop (count of addresses only, never one); null when the server runs none. */
  door: DropDoor | null;
  /** the kit list the music routes use (a TEST passes a labelled synthetic one, never the environment). */
  musicKits?: readonly MusicKit[];
}
