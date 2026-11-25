/**
 * The server side of the craft track (wave 7; .artifacts/wave7/craft-decisions.md §4). LEAD-OWNED: the route table, every refusal
 * with its status, code, fixed English sentence and hint (the Hebrew is packages/i18n/src/craft.ts HE_CRAFT, kept in step by
 * packages/evals/src/craft-wording.test.ts), the table's name and the dependencies routes.ts gets. W2 builds routes.ts,
 * versions.ts and findText.ts. Until then every route checks its scope and the owner rule, then answers 501 craft_not_built.
 *
 * RULES THE BUILDER KEEPS
 * - A version is a row beside the history, never an op: saving changes nothing in the project. RESTORE is the edit: one
 *   restore_entities transaction through governance (Store.commit with allowInternal, the caller's guard, kind edit, label
 *   «שחזור גרסה: <name>»), undoable by the same actor.
 * - The copy is the document string the store wrote for that revision, copied in the same SQLite transaction as the row; the
 *   row stores privacyDigest(copy) (core versionDiff.ts). Saving checks the storage ceiling (assertStorageRoom with the copy's
 *   bytes) and the limits (CRAFT_LIMITS.versions, .agentVersions for rows whose actor is an agent).
 * - Privacy gate: when privacyDigest(version) ≠ privacyDigest(current), the version's still and diff answer 403
 *   version_privacy_changed to anything but the owner's own session (assistant/contract.ts isOwnerSession). The list labels it.
 * - Every document read goes through the store's reader (Store.getProject / docForReader for the copy): a credential without the
 *   people scope never receives a birth date, from the list, the diff or a still.
 * - Rename and delete: the owner's own session only. Delete erases the row from the file (Store.erasing). Deleting the project
 *   removes its rows (storage.ts lists the table). The version copies are inside every backup; an archive carries none.
 * - Restore with privacy regions removed or changed (DiffSummary.privacy) needs body.confirmPrivacy, else 409
 *   restore_needs_confirmation; body.expectRevision ≠ current → 409 stale_revision.
 */
import type { Context, Hono } from 'hono';
import type { Principal, Scope } from '../auth.ts';
import type { Config } from '../config.ts';
import type { Exporter } from '../export.ts';
import type { Governance } from '../governance.ts';
import { ApiError, type Store } from '../store.ts';

/** The table versions.ts creates (CREATE TABLE IF NOT EXISTS, as proposals and derivatives are). */
export const VERSIONS_TABLE = 'project_versions';
/** True once W2 has built routes.ts, versions.ts and findText.ts. */
export const CRAFT_SERVER_BUILT = false;

interface ServerRefusal<A extends unknown[]> { status: number; code: string; message: (...a: A) => string; hint?: string }
const r = <A extends unknown[]>(status: number, code: string, message: (...a: A) => string, hint?: string): ServerRefusal<A> => ({ status, code, message, ...(hint ? { hint } : {}) });
/** Every refusal of the craft routes. The messages are fixed: HE_CRAFT recognises them by their shape. */
export const CRAFT_SERVER_REFUSALS = {
  notBuilt: r(501, 'craft_not_built', () => 'saved versions and find are not built in this build yet', 'Update the editor; until then use undo and the history list.'),
  versionNotFound: r(404, 'version_not_found', () => 'this saved version does not exist; it may have been deleted', 'List the versions again.'),
  versionLimit: r(409, 'version_limit', (n: number) => `the project already holds ${n} saved versions; delete one to save a new one`, 'Delete an old version in the versions dialog.'),
  agentVersionLimit: r(409, 'version_limit_agents', (n: number) => `agents may keep at most ${n} saved versions in a project`, 'Ask the owner to delete one, or to save the version.'),
  privacyChanged: r(403, 'version_privacy_changed', () => 'this version was saved before the privacy regions changed; only the project owner can view it', 'The owner can open it in the versions dialog.'),
  nothingToRestore: r(409, 'nothing_to_restore', () => 'the project already equals this version; nothing to restore', 'Nothing needs to be done.'),
  restoreTooLarge: r(422, 'restore_too_large', (n: number, max: number) => `restoring this version would change ${n} items; one step changes at most ${max}`, 'Restore a newer version, or undo step by step.'),
  versionConflict: r(409, 'version_conflict', (issue: string) => `restoring this version would make the project invalid: ${issue}`, 'Nothing was changed. Restore another version.'),
  needsConfirmation: r(409, 'restore_needs_confirmation', (n: number) => `restoring this version removes or changes ${n} privacy regions; confirm to go on`, 'Send confirmPrivacy: true after the owner has read which regions.'),
  frameOutOfRange: r(404, 'version_frame_out_of_range', (n: number) => `this version has no frame ${n}; it is shorter`, 'Choose an earlier frame.'),
  staleRevision: r(409, 'stale_revision', (now: number) => `the project changed since this was read (it is now at revision ${now})`, 'Look at the versions again, then restore.'),
  ownerOnly: r(403, 'owner_required', () => 'saved versions are renamed and deleted from the owner\'s own session', 'The owner does it in the versions dialog.'),
  proposeOnly: r(403, 'insufficient_scope', () => 'this credential may only propose edits, and saving or restoring a version cannot be proposed', 'Ask the owner, or for a grant in edit mode.'),
} as const;
export type CraftServerRefusalKey = keyof typeof CRAFT_SERVER_REFUSALS;
export function craftError<K extends CraftServerRefusalKey>(key: K, details: Record<string, unknown> = {}, ...args: Parameters<(typeof CRAFT_SERVER_REFUSALS)[K]['message']>): ApiError {
  const x = CRAFT_SERVER_REFUSALS[key] as ServerRefusal<unknown[]>;
  return new ApiError(x.status, x.code, x.message(...args), details, x.hint);
}

const P = '/api/v1/projects/:id';
/** Every craft route, as Hono registers it (peopleSurfaces.ts classifies each; openapi.ts documents each). */
export const CRAFT_ROUTES = [
  `GET ${P}/versions`,
  `POST ${P}/versions`,
  `PUT ${P}/versions/:versionId`,
  `DELETE ${P}/versions/:versionId`,
  `GET ${P}/versions/:versionId/diff`,
  `GET ${P}/versions/:versionId/frame`,
  `POST ${P}/versions/:versionId/restore`,
  `POST ${P}/text/find`,
] as const;

export type CraftEnv = { Variables: { principal: Principal } };
export type CraftApp = Hono<CraftEnv>;
/** What routes.ts gets from http.ts (one-line delegation; no builder edits http.ts). */
export interface CraftRouteDeps {
  cfg: Config; store: Store; gov: Governance; exporter: Exporter;
  need: (c: Context<CraftEnv>, scope: Scope) => Principal;
}
/** Save and restore: a propose-mode credential is refused (a version cannot be proposed). */
/** The route asks need(c, 'observe') first, so a propose-mode credential hears this sentence rather than a missing scope (templates.ts mayApply). */
export function mayWriteVersions(gov: Governance, p: Principal, projectId: string): void {
  gov.assertMayAct(p, projectId, 'observe');
  if (p.kind === 'agent' && p.mode === 'propose') throw craftError('proposeOnly', { mode: 'propose' });
  gov.assertMayAct(p, projectId, 'edit');
}
