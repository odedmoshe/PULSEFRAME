/**
 * Autonomy first, open by default (owner decision, docs/BLOCKERS.md "Owner decisions recorded on 2026-11-26"; ADR draft
 * `.artifacts/wave8/autonomy-adr-draft.md`). ONE server mode:
 *  - `open` (the default): an agent credential that may edit (the built-in agent token, a grant in mode edit/autopilot) is
 *    stamped `open: true` where credentials are resolved (Auth.authenticate), and every POLICY gate lets it do what the owner's
 *    own window may do. Read-only credentials (the observer token, observe/propose grants) stay what the owner made them.
 *  - `guarded`: today's behaviour, byte for byte (no principal is stamped, so every gate reads what it read before).
 *
 * Two predicates, never mixed (verifier C1):
 *  - `actsAsOwner(p)`  — the POLICY predicate. Every policy site reads it (or `actsAsOwnerFor`), nothing else.
 *  - `isOwnerFloor(p)` — the FLOOR predicate. It never reads `open`. Only the sites in FLOOR_SITES read it: grant creation and
 *    revocation, the mode switch itself, the language assistant's key and endpoint, the phone codes. Host/Origin/SameSite, the
 *    render worker's token and "asset ids only, never a path" are floors that read no owner predicate at all (auth.ts,
 *    browser-export.ts, capabilities.ts) and stay as they are in both modes.
 * Owner switches that stay the owner's in both modes by decision (pause, proposal and approval decisions) read `ownerKeeps`.
 * autonomy.test.ts walks the source: a floor site reading the policy predicate, or a policy site still reading a raw owner
 * check, fails it.
 */
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { ASSISTANT_ACTOR } from '@pulseframe/core';
import { writePrivateFile } from './assistant/credential.ts';
import type { Principal } from './governance.ts';
import { ApiError } from './store.ts';
import { AUTONOMY_EN, AUTONOMY_HE } from '../../../packages/i18n/src/autonomy.ts';

import { parseMode, type ServerMode } from './autonomy-mode.ts';
export { DEFAULT_SERVER_MODE, parseMode, SERVER_MODES, type ServerMode } from './autonomy-mode.ts';

/** THE policy predicate: the owner's own session, or an agent the open server stamped. Never used at a floor site. */
/** The owner's own browser session is the one user principal auth.ts issues (`user:local`); a phone's import principal or a
 *  hand-made `user:*` principal is not it (the stricter of the two checks the sites read before, so guarded refuses no less). */
export const actsAsOwner = (p: Pick<Principal, 'kind' | 'actor'> & { open?: true }): boolean => p.open === true || (p.kind === 'user' && p.actor === 'user:local');
/** The FLOOR predicate: the owner's own session only, in both modes. It never reads `open`; only FLOOR_SITES call it. */
export const isOwnerFloor = (p: Pick<Principal, 'kind'>): boolean => p.kind === 'user';
/** Owner switches kept in both modes by decision (A6 pause, B2 proposal decide, B3 approval decide): the owner's brake. */
export const ownerKeeps = (p: Pick<Principal, 'kind'>): boolean => p.kind === 'user';

/**
 * The stamp (verifier: one stamp where credentials are resolved). Only an agent credential that may already edit is stamped;
 * the in-memory command-bar assistant (propose-only, ADR-0027) and every read-only credential are left as they are.
 * The built-in agent token has no mode of its own: in open mode it acts in autopilot (C13), so paid work reserves.
 */
export function stampOpen(p: Principal, mode: ServerMode): Principal {
  if (mode !== 'open' || p.kind !== 'agent' || p.open || !p.scopes.includes('edit') || p.actor === ASSISTANT_ACTOR) return p;
  if (p.mode === 'observe' || p.mode === 'propose') return p;
  return { ...p, open: true, mode: p.mode ?? 'autopilot' };
}

/** The ledger row group open agents spend from when they have no budget of their own (C13). */
export const OPEN_AGENTS_LEDGER = 'open-agents';

export const AUTONOMY_FILE = 'autonomy.json';
export interface AutonomyStored { mode: ServerMode; agentBudgetCents: number | null; changedAt: string; changedBy: string }
export type ModeSource = 'env' | 'stored' | 'default';

/**
 * The server's mode, readable on every request (Auth reads `mode` per authentication, so a switch reaches the very next REST
 * or MCP call). Start-up: PF_MODE when set (config.ts `mode` with `modeFromEnv`), else what the owner stored, else `open`.
 * A switch is stored (0600, backed up with the data directory) and emitted as 'mode' once, so open event streams close (C4).
 */
export class AutonomySettings extends EventEmitter {
  private current: AutonomyStored;
  private source: ModeSource;
  constructor(private dataDir: string, cfg: { mode: ServerMode; modeFromEnv?: boolean }) {
    super();
    const stored = this.read();
    if (cfg.modeFromEnv) { this.current = { mode: cfg.mode, agentBudgetCents: stored?.agentBudgetCents ?? null, changedAt: stored?.changedAt ?? '', changedBy: stored?.changedBy ?? '' }; this.source = 'env'; }
    else if (stored) { this.current = stored; this.source = 'stored'; }
    else { this.current = { mode: cfg.mode, agentBudgetCents: null, changedAt: '', changedBy: '' }; this.source = 'default'; }
  }
  private get file() { return path.join(this.dataDir, AUTONOMY_FILE); }
  private read(): AutonomyStored | null {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AutonomyStored>;
      const mode = parseMode(raw.mode);
      if (!mode) return null;
      return { mode, agentBudgetCents: Number.isInteger(raw.agentBudgetCents) && (raw.agentBudgetCents as number) >= 0 ? raw.agentBudgetCents as number : null, changedAt: String(raw.changedAt ?? ''), changedBy: String(raw.changedBy ?? '') };
    } catch { return null; }
  }
  get mode(): ServerMode { return this.current.mode; }
  get agentBudgetCents(): number | null { return this.current.agentBudgetCents; }
  state() { return { mode: this.current.mode, source: this.source, agentBudgetCents: this.current.agentBudgetCents, changedAt: this.current.changedAt || null, changedBy: this.current.changedBy || null }; }
  /** The owner's switch (FLOOR: `PUT /api/v1/autonomy`). */
  set(by: Principal, body: unknown) {
    if (!isOwnerFloor(by)) throw new ApiError(403, 'owner_required', 'only the owner switches between open and guarded mode, from their own editor window', {}, 'The owner switches it in Settings › Access.');
    const b = (body ?? {}) as { mode?: unknown; agentBudgetCents?: unknown };
    const mode = b.mode === undefined ? this.current.mode : parseMode(b.mode);
    if (!mode) throw new ApiError(400, 'invalid_request', 'mode is "open" or "guarded"', { mode: b.mode }, 'Send {"mode":"open"} or {"mode":"guarded"}.');
    let budget = this.current.agentBudgetCents;
    if (b.agentBudgetCents !== undefined) {
      if (b.agentBudgetCents !== null && !(Number.isInteger(b.agentBudgetCents) && (b.agentBudgetCents as number) >= 0)) throw new ApiError(400, 'invalid_request', 'agentBudgetCents is a whole number of cents, or null for no limit', { agentBudgetCents: b.agentBudgetCents }, 'Send a whole number of cents, or null.');
      budget = b.agentBudgetCents as number | null;
    }
    const before = this.current.mode;
    this.current = { mode, agentBudgetCents: budget, changedAt: new Date().toISOString(), changedBy: by.actor };
    this.source = 'stored';
    fs.mkdirSync(this.dataDir, { recursive: true });
    writePrivateFile(this.file, `${JSON.stringify(this.current, null, 2)}\n`);
    if (before !== mode) this.emit('mode', { mode, before });
    return this.state();
  }
}

/**
 * The exact floor list (C1). `file` relative to apps/server/src; `needle` is a fragment of the guarded line. The source test
 * checks each needle reads `isOwnerFloor` and that `isOwnerFloor(` appears nowhere else.
 */
export const FLOOR_SITES: readonly { id: string; file: string; needle: string; why: string }[] = [
  { id: 'A5', file: 'governance.ts', needle: "only the project owner can create agent grants", why: 'an agent minting itself a credential' },
  { id: 'A5', file: 'governance.ts', needle: "only the project owner can revoke grants", why: 'an agent revoking the owner\'s credentials' },
  { id: 'A5', file: 'http.ts', needle: "const floorOwner = ", why: 'POST /grants and /grants/:id/revoke (the REST door of A5)' },
  { id: 'mode', file: 'autonomy.ts', needle: "only the owner switches between open and guarded mode", why: 'an agent switching the mode it is judged by' },
  { id: 'C9', file: 'assistant/routes.ts', needle: "if (!isOwnerFloor(p)) throw new ApiError(403, 'owner_required', 'the language assistant", why: 'the provider key and base URL (a readable key spends the owner\'s money elsewhere)' },
  { id: 'A23', file: 'drop.ts', needle: "only the owner can open uploading from a phone", why: 'a door for another device on the home network' },
  { id: 'A23', file: 'importRoutes.ts', needle: "only the owner can issue, see or close a code for a phone", why: 'a door for another device on the home network' },
];

/** One row per POLICY gate site that now reads `actsAsOwner` (O = opens, W = warns and continues). The proof and tests walk it. */
export interface OpenGate { id: string; file: string; needle: string; decision: 'O' | 'W' }

/** What each mode means, in words (he/en from packages/i18n/src/autonomy.ts): the Settings › Access line and what agents read. */
export function autonomyAnswer(a: AutonomySettings) {
  const st = a.state();
  const words = (d: Record<string, string>) => ({ name: d[`autonomy.mode.${st.mode}`], line: d[`autonomy.${st.mode}.line`], means: d[`autonomy.${st.mode}.means`], keeps: d['autonomy.keeps'], source: d[`autonomy.source.${st.source}`] });
  return { ...st, floor: FLOOR_SITES.map((f) => f.id).filter((id, i, all) => all.indexOf(id) === i), words: { he: words(AUTONOMY_HE), en: words(AUTONOMY_EN) } };
}

type RouteApp = { get(path: string, h: (c: any) => any): unknown; put(path: string, h: (c: any) => any): unknown };
/** GET (any credential: an agent needs to know what it may do) and PUT (FLOOR: the owner's own session) /api/v1/autonomy. */
export function registerAutonomyRoutes(app: RouteApp, deps: { autonomy: AutonomySettings; need: (c: any, scope: 'observe' | 'edit') => Principal }) {
  app.get('/api/v1/autonomy', (c) => { deps.need(c, 'observe'); return c.json(autonomyAnswer(deps.autonomy)); });
  app.put('/api/v1/autonomy', async (c) => { const p = deps.need(c, 'observe'); const body = await c.req.json().catch(() => undefined); deps.autonomy.set(p, body); return c.json(autonomyAnswer(deps.autonomy)); });
}
export const OPEN_GATES: readonly OpenGate[] = [
  { id: 'A9', file: 'governance.ts', needle: 'transactionId, ownerKeeps(p) ? undefined : this.scopeGuard(p), actsAsOwner(p));', decision: 'O' },
  { id: 'A10', file: 'http.ts', needle: 'if (actsAsOwner(p)) return; // A10/A22', decision: 'O' },
  { id: 'A11', file: 'http.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'human_approval_required\', \'only the project owner can mark a translation reviewed or not, from their own session\', { variantId },', decision: 'O' },
  { id: 'A11', file: 'http.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'human_approval_required\', \'only the project owner can mark a translation reviewed or not, from their own session\', { variantId: c.req', decision: 'O' },
  { id: 'A12', file: 'export.ts', needle: 'if (!still || actsAsOwner(p)) return;', decision: 'O' },
  { id: 'A13', file: 'lessons/guard.ts', needle: 'if (actsAsOwner(p)) return;', decision: 'O' },
  { id: 'A13', file: 'lessons/routes.ts', needle: 'if (!actsAsOwner(principal)) throw lessonApiError(\'ownerRequired\');', decision: 'O' },
  { id: 'A14', file: 'craft/versions.ts', needle: 'if (!actsAsOwner(p)) throw craftError(\'ownerOnly\');', decision: 'O' },
  { id: 'A14', file: 'craft/routes.ts', needle: 'if (!actsAsOwner(p)) throw craftError(\'ownerOnly\'); return p;', decision: 'O' },
  { id: 'A14', file: 'craft/versions.ts', needle: '    if (!actsAsOwner(p)) {', decision: 'O' },
  { id: 'A15', file: 'craft/versions.ts', needle: 'return actsAsOwner(p) || versionDigest === currentDigest;', decision: 'O' },
  { id: 'A16', file: 'booth/contract.ts', needle: 'if (!actsAsOwner(p)) throw boothError(\'ownerOnly\');', decision: 'O' },
  { id: 'A17', file: 'ownTemplates.ts', needle: 'if (!actsAsOwner(p)) throw ownTemplateApiError(', decision: 'O' },
  { id: 'A17', file: 'search/routes.ts', needle: 'if (!actsAsOwner(p)) throw searchError(\'ownerOnly\');', decision: 'O' },
  { id: 'A17', file: 'search/runtime.ts', needle: 'if (!actsAsOwner(p)) throw searchError(\'ownerOnly\');', decision: 'O' },
  { id: 'A17', file: 'picmodels/routes.ts', needle: 'pictureModelsFor(actsAsOwner(p), rows)', decision: 'O' },
  { id: 'A17', file: 'picmodels/routes.ts', needle: 'if (!actsAsOwner(p)) throw picmodelsError(\'ownerOnly\');', decision: 'O' },
  { id: 'A17', file: 'instruments/heard.ts', needle: 'if (!actsAsOwner(principal)) throw instrumentsError(\'ownerOnly\', {});', decision: 'O' },
  { id: 'A17', file: 'http.ts', needle: 'if (!actsAsOwner(p)) throw instrumentsError(\'ownerOnly\', {});', decision: 'O' },
  { id: 'A17', file: 'musicfit/routes.ts', needle: 'if (!actsAsOwner(principal)) throw musicFitApiError(\'notOwner\'', decision: 'O' },
  { id: 'A18', file: 'library/contract.ts', needle: 'if (!actsAsOwner(p)) throw libraryError(\'ownerOnly\');', decision: 'O' },
  { id: 'A18', file: 'library/routes.ts', needle: 'lib.status(actsAsOwner(p))', decision: 'O' },
  { id: 'A19', file: 'http.ts', needle: 'if (!actsAsOwner(need(c, \'observe\'))) throw new ApiError(403, \'owner_required\'', decision: 'O' },
  { id: 'A19', file: 'http.ts', needle: 'app.get(\'/api/v1/grants\', (c) => { const p = c.var.principal; if (!actsAsOwner(p))', decision: 'O' },
  { id: 'A19', file: 'http.ts', needle: '    if (!actsAsOwner(p)) throw new ApiError(403, \'owner_required\', \'this action needs the project owner\\\'s own session\');', decision: 'O' },
  { id: 'A19', file: 'lifeline.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'owner_required\'', decision: 'O' },
  { id: 'A20', file: 'storage.ts', needle: 'const ownerOnly = (p: Principal, what: string) => { if (!actsAsOwner(p))', decision: 'O' },
  { id: 'A20', file: 'renderCacheRoutes.ts', needle: 'if (!actsAsOwner(by)) throw new ApiError(403, \'owner_required\', \'only the owner can clear the render cache\');', decision: 'O' },
  { id: 'A21', file: 'speechEngine.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'owner_required\', \'the speech engine is installed only', decision: 'O' },
  { id: 'A21', file: 'http.ts', needle: 'if (job.type === SPEECH_ENGINE_JOB_TYPE && !actsAsOwner(p))', decision: 'O' },
  { id: 'A22', file: 'assistant/routes.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'owner_required\', \'the language assistant is set up and used', decision: 'O' },
  { id: 'A22', file: 'assistant/routes.ts', needle: 'cancel: (p, jobId) => { if (!actsAsOwner(p)) throw assistantCancelRefusal(jobId);', decision: 'O' },
  { id: 'A22', file: 'http.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'owner_required\', \'the language assistant is set up and used', decision: 'O' },
  { id: 'A22', file: 'http.ts', needle: '&& actsAsOwner(c.var.principal) && gov.ledgerFor(jobId) !== null;', decision: 'O' },
  { id: 'A22', file: 'assistant/visibility.ts', needle: 'if (!actsAsOwner(p)) throw budgetReleaseRefusal(jobId);', decision: 'O' },
  { id: 'A24', file: 'importContracts.ts', needle: 'if (actsAsOwner(p)) return; // A24', decision: 'O' },
  { id: 'A17', file: 'growing.ts', needle: 'if (!actsAsOwner(principal)) throw GROWING_API_ERRORS.ownerRequired();', decision: 'O' },
  { id: 'C1', file: 'peoplePrivacy.ts', needle: "if (actsAsOwner(p)) return 'full';", decision: 'O' },
  { id: 'C6', file: 'peoplePrivacy.ts', needle: "if (actsAsOwner(p)) return; // C6", decision: 'O' },
  { id: 'C1', file: 'search/answer.ts', needle: "if (!actsAsOwner(p)) {", decision: 'O' },
  { id: 'C7', file: 'assistant/visibility.ts', needle: "if (j.type !== ASSISTANT_JOB_TYPE || actsAsOwner(p)) return null;", decision: 'O' },
  { id: 'C7', file: 'assistant/visibility.ts', needle: "proposal.actor !== ASSISTANT_ACTOR || actsAsOwner(p);", decision: 'O' },
  { id: 'C7', file: 'assistant/visibility.ts', needle: "if (actsAsOwner(p)) return whole;", decision: 'O' },
  { id: 'C2', file: 'mcp.ts', needle: "...(principal.open && actsAsOwner(principal) ? { serverMode: 'open'", decision: 'O' },
  { id: 'D10', file: 'speech.ts', needle: 'if (!actsAsOwner(principal)) throw new ApiError(403, \'human_approval_required\', \'speaking in a recorded person', decision: 'O' },
  { id: 'B4', file: 'capabilities.ts', needle: "if (!actor.startsWith('user:') && !(typeof by !== 'string' && actsAsOwner(by))) throw", decision: 'O' },
  { id: 'I5', file: 'capabilities.ts', needle: "const actsOpen = (req: { open?: boolean; principal?: Principal }) => req.open === true || (!!req.principal && actsAsOwner(req.principal));", decision: 'W' },
  { id: 'B5', file: 'governance.ts', needle: "if (actsAsOwner(p) && !(p.grant && p.grant.budgetCents > 0)) return this.reserveOpen(jobId, cents);", decision: 'O' },
  { id: 'B4', file: 'http.ts', needle: 'if (!actsAsOwner(p)) throw new ApiError(403, \'human_approval_required\', \'model downloads must be started', decision: 'O' },
];
