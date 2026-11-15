/**
 * Human control over agents (SPEC §21, §26): grants with permission modes and scopes, Pause Agent,
 * proposals, single-use approvals and a budget ledger. Everything here is enforced server-side on the
 * authenticated principal; advertising fewer tools to a client is never treated as authorization.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as T from '@pulseframe/time';
import { applyTransaction, canonical, clipEnd, diffEntities, OpError, RationalTimeSchema, type EntityChange, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { z } from 'zod';
import { ApiError, type CommitRequest, type CommitResult, type Store } from './store.ts';

export type Mode = 'observe' | 'propose' | 'edit' | 'autopilot';
export const GrantInput = z
  .object({
    name: z.string().min(1).max(80),
    mode: z.enum(['observe', 'propose', 'edit', 'autopilot']),
    projectIds: z.array(z.string()).max(200).nullable().default(null).describe('null = every project'),
    trackIds: z.array(z.string()).max(200).nullable().default(null).describe('Only clips on these tracks may be changed'),
    range: z.object({ start: RationalTimeSchema, end: RationalTimeSchema }).strict().nullable().default(null).describe('Only clips lying fully inside this sequence time range may be changed'),
    budgetCents: z.number().int().nonnegative().default(0),
    requestsPerMinute: z.number().int().min(1).max(100000).nullable().default(null).describe('Request budget for this credential (REST and MCP together); null = the server-wide setting'),
    expiresInSeconds: z.number().int().positive().max(365 * 86400).optional(),
  })
  .strict();
export interface Grant { id: string; name: string; mode: Mode; projectIds: string[] | null; trackIds: string[] | null; range: { start: T.RationalTime; end: T.RationalTime } | null; budgetCents: number; requestsPerMinute: number | null; expiresAt: string | null; revokedAt: string | null; createdAt: string; createdBy: string }
export interface Principal { actor: string; kind: 'user' | 'agent'; scopes: ('observe' | 'edit')[]; mode?: Mode; grant?: Grant }

const now = () => new Date().toISOString();
const rid = (p: string) => `${p}_${randomBytes(8).toString('base64url').replace(/[-_]/g, 'x')}`;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const modeOf = (p: Principal): Mode => p.mode ?? (p.kind === 'user' ? 'autopilot' : p.scopes.includes('edit') ? 'edit' : 'observe');

export class Governance {
  constructor(private store: Store, private clock: () => number = Date.now) {
    // Money follows the job: whenever a job with a reservation reaches a final state, the ledger is settled here, in one place.
    store.events.on('job', (job: { id: string; status: string; attempt: number }) => this.settleFor(job));
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, constraints TEXT NOT NULL, budget_cents INTEGER NOT NULL, expires_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_controls (project_id TEXT PRIMARY KEY, agents_paused INTEGER NOT NULL, changed_at TEXT NOT NULL, changed_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS proposals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, actor TEXT NOT NULL, grant_id TEXT, base_revision INTEGER NOT NULL, label TEXT, ops TEXT NOT NULL, changes TEXT NOT NULL, summary TEXT NOT NULL,
        status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, result_revision INTEGER, conflicts TEXT);
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, action TEXT NOT NULL, action_hash TEXT NOT NULL, cost_cents INTEGER NOT NULL, requested_by TEXT NOT NULL,
        status TEXT NOT NULL, decided_by TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT);
      CREATE TABLE IF NOT EXISTS budget_ledger (job_id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, reserved_cents INTEGER NOT NULL, actual_cents INTEGER, state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
  }

  // ---------- grants ----------
  private grantRow = (r: any): Grant => ({ id: r.id, name: r.name, mode: r.mode, requestsPerMinute: null, ...JSON.parse(r.constraints), budgetCents: r.budget_cents, expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at, createdBy: r.created_by });
  /** The token is returned once and only its hash is stored. */
  createGrant(raw: unknown, by: Principal): { grant: Grant; token: string } {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the project owner can create agent grants');
    const p = GrantInput.safeParse(raw);
    if (!p.success) throw new ApiError(400, 'invalid_request', z.prettifyError(p.error), { issues: p.error.issues });
    const g = p.data;
    if (g.range && !T.lt(g.range.start, g.range.end)) throw new ApiError(400, 'invalid_request', 'range.start must be before range.end');
    const id = rid('grt');
    const token = `pfg_${randomBytes(24).toString('base64url')}`;
    const expiresAt = g.expiresInSeconds ? new Date(this.clock() + g.expiresInSeconds * 1000).toISOString() : null;
    this.store.db.prepare('INSERT INTO grants (id, name, token_hash, mode, constraints, budget_cents, expires_at, created_at, created_by) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, g.name, sha(token), g.mode, JSON.stringify({ projectIds: g.projectIds, trackIds: g.trackIds, range: g.range, requestsPerMinute: g.requestsPerMinute }), g.budgetCents, expiresAt, now(), by.actor);
    return { grant: this.getGrant(id), token };
  }
  getGrant(id: string): Grant {
    const r = this.store.db.prepare('SELECT * FROM grants WHERE id = ?').get(id);
    if (!r) throw new ApiError(404, 'grant_not_found', `grant ${id} not found`);
    return this.grantRow(r);
  }
  listGrants(): (Grant & { spentCents: number; reservedCents: number })[] {
    return (this.store.db.prepare('SELECT * FROM grants ORDER BY created_at').all() as any[]).map((r) => ({ ...this.grantRow(r), ...this.spend(r.id) }));
  }
  revokeGrant(id: string, by: Principal): Grant {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the project owner can revoke grants');
    this.getGrant(id);
    this.store.db.prepare('UPDATE grants SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(now(), id);
    return this.getGrant(id);
  }
  /** Resolve a bearer token to a principal, or null if it is not a grant token. Revoked/expired tokens are rejected, not ignored. */
  principalForToken(token: string): Principal | null {
    if (!token.startsWith('pfg_')) return null;
    const r = this.store.db.prepare('SELECT * FROM grants WHERE token_hash = ?').get(sha(token));
    if (!r) throw new ApiError(401, 'invalid_token', 'bearer token not recognised');
    const g = this.grantRow(r);
    if (g.revokedAt) throw new ApiError(401, 'grant_revoked', 'this agent grant was revoked');
    if (g.expiresAt && Date.parse(g.expiresAt) <= this.clock()) throw new ApiError(401, 'grant_expired', 'this agent grant has expired');
    return { actor: `agent:${g.name}`, kind: 'agent', scopes: g.mode === 'observe' || g.mode === 'propose' ? ['observe'] : ['observe', 'edit'], mode: g.mode, grant: g };
  }

  // ---------- pause / take over ----------
  isPaused(projectId: string): boolean {
    return !!(this.store.db.prepare('SELECT agents_paused FROM project_controls WHERE project_id = ?').get(projectId) as any)?.agents_paused;
  }
  /** Suspends every agent's ability to mutate this project. Running jobs are reported, not killed: their results become proposals. */
  setPaused(projectId: string, paused: boolean, by: Principal) {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the project owner can pause or resume agents');
    this.store.getProject(projectId);
    this.store.db.prepare('INSERT INTO project_controls (project_id, agents_paused, changed_at, changed_by) VALUES (?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET agents_paused = excluded.agents_paused, changed_at = excluded.changed_at, changed_by = excluded.changed_by').run(projectId, paused ? 1 : 0, now(), by.actor);
    const jobs = (this.store.db.prepare("SELECT id, type, actor, status FROM jobs WHERE project_id = ? AND actor LIKE 'agent:%' AND status IN ('queued','running','cancel-requested')").all(projectId) as any[]);
    this.store.events.emit('control', { projectId, agentsPaused: paused, by: by.actor });
    return { projectId, agentsPaused: paused, agentJobsStillRunning: jobs, note: paused ? 'New agent edits and jobs are refused. Jobs already running finish; their results are kept as proposals, not placed.' : 'Agents may act again within their grants.' };
  }

  // ---------- authorization ----------
  /** Checks that hold before looking at what an edit changes. */
  assertMayAct(p: Principal, projectId: string, need: 'observe' | 'propose' | 'edit' | 'job'): void {
    const g = p.grant;
    if (g?.projectIds && !g.projectIds.includes(projectId)) throw new ApiError(403, 'out_of_scope', 'this grant does not cover that project', { projectId, allowedProjects: g.projectIds });
    if (need === 'observe') return;
    const mode = modeOf(p);
    if (p.kind === 'agent' && this.isPaused(projectId)) throw new ApiError(423, 'agent_paused', 'the project owner has paused agents on this project', { projectId }, 'Wait until the owner resumes agents. Reading is still allowed.');
    if (mode === 'observe') throw new ApiError(403, 'insufficient_scope', 'this credential may only observe', { mode });
    if ((need === 'edit' || need === 'job') && mode === 'propose') throw new ApiError(403, 'insufficient_scope', 'this credential may only propose edits', { mode }, 'Submit the edit as a proposal.');
  }
  /** Track and time-range limits, checked against the exact entity diff of the edit. */
  /**
   * Some actions change things that are not clips (media library, analysis data) or place results where the caller chooses.
   * A grant limited to certain tracks or a time range cannot be checked against those, so it is refused rather than let through.
   */
  assertUnrestricted(p: Principal, what: string): void {
    const g = p.kind === 'agent' ? p.grant : undefined;
    if (g && (g.trackIds || g.range)) throw new ApiError(403, 'out_of_scope', `this grant is limited to certain tracks or a time range and cannot ${what}`, { grant: { trackIds: g.trackIds, range: g.range } }, 'Ask the owner for a grant without track or range limits, or to do this step.');
  }
  private scopeGuard(p: Principal): CommitRequest['guard'] {
    const g = p.grant;
    if (!g || (!g.trackIds && !g.range)) return undefined;
    return ({ changes }) => {
      const bad: { entityId: string; reason: string }[] = [];
      for (const c of changes)
        for (const s of [c.before, c.after]) {
          if (!s) continue;
          if (s.kind === 'clip') {
            if (g.trackIds && !g.trackIds.includes(s.trackId)) bad.push({ entityId: c.id, reason: `track ${s.trackId} is outside the grant` });
            if (g.range && (T.lt(s.clip.start, g.range.start) || T.lt(g.range.end, clipEnd(s.clip)))) bad.push({ entityId: c.id, reason: 'clip is outside the granted time range' });
          } else if (s.kind === 'track') { if (!g.trackIds?.includes(c.id)) bad.push({ entityId: c.id, reason: 'changing tracks is outside the grant' }); }
          else bad.push({ entityId: c.id, reason: `changing the ${s.kind} is outside a track/range-limited grant` });
        }
      if (bad.length) throw new ApiError(403, 'out_of_scope', `${bad.length} change(s) fall outside this grant`, { violations: bad.slice(0, 20), grant: { trackIds: g.trackIds, range: g.range } });
    };
  }
  /**
   * The one mutation entry point for REST and MCP. Users commit. Agents commit within their grant,
   * are refused when paused, and in Propose mode get a proposal instead of a commit.
   */
  commitAs(p: Principal, req: Omit<CommitRequest, 'actor' | 'guard'>): CommitResult | ReturnType<Governance['propose']> {
    if (p.kind === 'user') return this.store.commit({ ...req, actor: p.actor });
    if (modeOf(p) === 'propose' && !req.dryRun) return this.propose(p, req.projectId, req.ops, req.label);
    this.assertMayAct(p, req.projectId, req.dryRun ? 'propose' : 'edit');
    return this.store.commit({ ...req, actor: p.actor, guard: this.scopeGuard(p) });
  }
  undoAs(p: Principal, projectId: string, mode: 'undo' | 'redo', transactionId?: string): CommitResult {
    if (p.kind === 'agent') this.assertMayAct(p, projectId, 'edit');
    // Agents may only reverse their own transactions, also when naming one by id; the owner may reverse anyone's.
    return this.store.undo(projectId, p.actor, mode, transactionId, p.kind === 'agent' ? this.scopeGuard(p) : undefined, p.kind !== 'agent');
  }

  // ---------- proposals ----------
  private proposalRow = (r: any) => ({ id: r.id as string, projectId: r.project_id as string, actor: r.actor as string, baseRevision: r.base_revision as number, label: r.label as string | null, ops: JSON.parse(r.ops) as OpCall[], changes: JSON.parse(r.changes) as EntityChange[], summary: r.summary as string, status: r.status as 'open' | 'accepted' | 'rejected' | 'stale', createdAt: r.created_at as string, decidedAt: r.decided_at as string | null, decidedBy: r.decided_by as string | null, resultRevision: r.result_revision as number | null, conflicts: r.conflicts ? JSON.parse(r.conflicts) : null });
  /** Validate against the current document and store the exact diff for review. Nothing is committed. */
  propose(p: Principal, projectId: string, ops: OpCall[], label?: string) {
    this.assertMayAct(p, projectId, 'propose');
    const { doc, revision } = this.store.getProject(projectId);
    let after: ProjectDocument;
    let summary: string;
    try {
      const r = applyTransaction(doc, ops, { idSeed: randomBytes(5).toString('hex'), actor: p.actor });
      after = r.doc;
      summary = r.summary;
    } catch (e) {
      if (e instanceof OpError) throw new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
      throw e;
    }
    const changes = diffEntities(doc, after);
    this.scopeGuard(p)?.({ changes, before: doc, after });
    if (changes.length === 0) throw new ApiError(422, 'no_change', 'the proposed operations would not change anything');
    const id = rid('prp');
    this.store.db.prepare('INSERT INTO proposals (id, project_id, actor, grant_id, base_revision, label, ops, changes, summary, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, projectId, p.actor, p.grant?.id ?? null, revision, label ?? null, JSON.stringify(ops), JSON.stringify(changes), summary, 'open', now());
    this.store.events.emit('proposal', { projectId, id, status: 'open', actor: p.actor });
    return { proposed: true as const, committed: false as const, proposalId: id, baseRevision: revision, summary, changedIds: changes.map((c) => c.id), status: 'open' as const };
  }
  getProposal(id: string) {
    const r = this.store.db.prepare('SELECT * FROM proposals WHERE id = ?').get(id);
    if (!r) throw new ApiError(404, 'proposal_not_found', `proposal ${id} not found`);
    return this.proposalRow(r);
  }
  listProposals(projectId: string, status?: string) {
    return (this.store.db.prepare(`SELECT * FROM proposals WHERE project_id = ? ${status ? 'AND status = ?' : ''} ORDER BY created_at DESC`).all(...(status ? [projectId, status] : [projectId])) as any[]).map(this.proposalRow);
  }
  /** The document as it would be if the proposal were applied to the revision it was written against (for before/after previews). */
  proposalDocs(id: string): { before: ProjectDocument; after: ProjectDocument; baseRevision: number } {
    const pr = this.getProposal(id);
    const before = this.store.replay(pr.projectId, pr.baseRevision).doc;
    return { before, after: applyTransaction(before, pr.ops, { idSeed: 'preview', actor: pr.actor }).doc, baseRevision: pr.baseRevision };
  }
  /**
   * Accept = commit the proposed operations now, by the accepting user (so it sits on the user's undo stack),
   * rebased from the proposal's base revision. If anything it depends on changed meanwhile the proposal turns
   * stale with the conflict list and nothing is applied.
   */
  decide(id: string, decision: 'accept' | 'reject', by: Principal) {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the project owner can decide on proposals');
    const pr = this.getProposal(id);
    if (pr.status !== 'open') throw new ApiError(409, 'proposal_closed', `proposal is already ${pr.status}`, { status: pr.status });
    const set = (status: string, extra: { rev?: number; conflicts?: unknown } = {}) => {
      this.store.db.prepare('UPDATE proposals SET status = ?, decided_at = ?, decided_by = ?, result_revision = ?, conflicts = ? WHERE id = ?').run(status, now(), by.actor, extra.rev ?? null, extra.conflicts ? JSON.stringify(extra.conflicts) : null, id);
      this.store.events.emit('proposal', { projectId: pr.projectId, id, status, actor: pr.actor });
      return this.getProposal(id);
    };
    if (decision === 'reject') return { proposal: set('rejected'), commit: null };
    try {
      const commit = this.store.commit({ projectId: pr.projectId, actor: by.actor, ops: pr.ops, baseRevision: pr.baseRevision, requestId: id, label: `Accept proposal from ${pr.actor}${pr.label ? `: ${pr.label}` : ''}`.slice(0, 200) });
      return { proposal: set('accepted', { rev: commit.revision }), commit };
    } catch (e) {
      if (e instanceof ApiError && ['conflict', 'not_found', 'overlap', 'out_of_bounds', 'invalid_result', 'invalid_args'].includes(e.code)) {
        set('stale', { conflicts: e.details.conflicts ?? [{ code: e.code, message: e.message }] });
        throw new ApiError(409, 'proposal_stale', `the project changed since this proposal was written: ${e.message}`, { proposalId: id, cause: e.code, conflicts: e.details.conflicts ?? null }, 'Ask the agent to propose again against the current revision.');
      }
      throw e;
    }
  }

  // ---------- approvals: one decision, bound to one exact action ----------
  private approvalRow = (r: any) => ({ id: r.id as string, projectId: r.project_id as string, kind: r.kind as string, action: JSON.parse(r.action), actionHash: r.action_hash as string, costCents: r.cost_cents as number, requestedBy: r.requested_by as string, status: r.status as 'pending' | 'approved' | 'consumed' | 'rejected' | 'expired', decidedBy: r.decided_by as string | null, expiresAt: r.expires_at as string, createdAt: r.created_at as string });
  static actionHash = (kind: string, action: unknown) => sha(canonical({ kind, action }));
  requestApproval(input: { projectId: string; kind: string; action: unknown; costCents?: number; requestedBy: string; ttlSeconds?: number }) {
    const id = rid('apr');
    this.store.db.prepare('INSERT INTO approvals (id, project_id, kind, action, action_hash, cost_cents, requested_by, status, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, input.projectId, input.kind, JSON.stringify(input.action), Governance.actionHash(input.kind, input.action), input.costCents ?? 0, input.requestedBy, 'pending', new Date(this.clock() + (input.ttlSeconds ?? 900) * 1000).toISOString(), now());
    this.store.events.emit('approval', { projectId: input.projectId, id, status: 'pending' });
    return this.getApproval(id);
  }
  getApproval(id: string) {
    const r = this.store.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as any;
    if (!r) throw new ApiError(404, 'approval_not_found', `approval ${id} not found`);
    if (r.status === 'pending' && Date.parse(r.expires_at) <= this.clock()) { this.store.db.prepare("UPDATE approvals SET status = 'expired' WHERE id = ? AND status = 'pending'").run(id); r.status = 'expired'; }
    return this.approvalRow(r);
  }
  listApprovals(projectId: string) {
    return (this.store.db.prepare('SELECT id FROM approvals WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[]).map((r) => this.getApproval(r.id));
  }
  /** Only an authenticated human; an agent can never approve its own (or anyone's) request. */
  decideApproval(id: string, decision: 'approve' | 'reject', by: Principal) {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'approvals can only be given by the project owner');
    const a = this.getApproval(id);
    if (a.status !== 'pending') throw new ApiError(409, 'approval_closed', `approval is ${a.status}`, { status: a.status });
    this.store.db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(decision === 'approve' ? 'approved' : 'rejected', by.actor, now(), id);
    return this.getApproval(id);
  }
  /** Use an approval exactly once, and only for the exact action that was approved. */
  consumeApproval(id: string, kind: string, action: unknown) {
    const a = this.getApproval(id);
    if (a.actionHash !== Governance.actionHash(kind, action)) throw new ApiError(409, 'approval_mismatch', 'the action differs from the one that was approved; a new approval is needed', { approvedAction: a.action });
    if (Date.parse(a.expiresAt) <= this.clock()) throw new ApiError(409, 'approval_expired', 'the approval has expired');
    const r = this.store.db.prepare("UPDATE approvals SET status = 'consumed' WHERE id = ? AND status = 'approved'").run(id);
    if (r.changes !== 1) throw new ApiError(409, 'approval_not_usable', `approval is ${a.status}`, { status: a.status });
    return this.getApproval(id);
  }

  // ---------- budget ledger ----------
  spend(grantId: string) {
    const r = this.store.db.prepare("SELECT COALESCE(SUM(CASE WHEN state = 'settled' THEN actual_cents ELSE 0 END),0) AS spent, COALESCE(SUM(CASE WHEN state IN ('reserved','unknown') THEN reserved_cents ELSE 0 END),0) AS reserved FROM budget_ledger WHERE grant_id = ?").get(grantId) as any;
    return { spentCents: r.spent as number, reservedCents: r.reserved as number };
  }
  /** Atomic: concurrent jobs can never reserve more than the grant holds. */
  reserve(p: Principal, jobId: string, cents: number) {
    if (cents <= 0) return;
    if (p.kind === 'user') return; // the owner spends their own money; grants limit agents
    if (modeOf(p) !== 'autopilot' || !p.grant) throw new ApiError(403, 'insufficient_scope', 'paid work needs an Autopilot grant with a budget', { mode: modeOf(p) });
    const g = p.grant;
    this.store.db.transaction(() => {
      const { spentCents, reservedCents } = this.spend(g.id);
      if (spentCents + reservedCents + cents > g.budgetCents) throw new ApiError(402, 'budget_exceeded', `this would exceed the grant's budget`, { budgetCents: g.budgetCents, spentCents, reservedCents, requestedCents: cents }, 'Ask the owner for a larger budget or an approval.');
      this.store.db.prepare('INSERT INTO budget_ledger (job_id, grant_id, reserved_cents, state, created_at, updated_at) VALUES (?,?,?,?,?,?)').run(jobId, g.id, cents, 'reserved', now(), now());
    }).immediate();
  }
  /**
   * Ledger outcome for a finished job. succeeded -> settled at the reserved amount. Canceled before it ever started -> released.
   * Anything else (failed or canceled after starting, or submission unknown) -> unknown: the provider may have charged, so the
   * amount stays counted against the budget until the owner releases it. Never optimistic about money.
   */
  private settleFor(job: { id: string; status: string; attempt: number }) {
    const row = this.store.db.prepare("SELECT reserved_cents AS cents, state FROM budget_ledger WHERE job_id = ?").get(job.id) as { cents: number; state: string } | undefined;
    if (!row || row.state !== 'reserved') return;
    if (job.status === 'succeeded') this.resolve(job.id, 'settled', row.cents);
    else if (job.status === 'canceled' && job.attempt === 0) this.resolve(job.id, 'released');
    else if (['failed', 'canceled', 'submission-unknown'].includes(job.status)) this.resolve(job.id, 'unknown');
  }
  /** The owner confirms that an unresolved reservation was not charged (e.g. after checking the provider's billing). */
  releaseUnknown(by: Principal, jobId: string) {
    if (by.kind !== 'user') throw new ApiError(403, 'owner_required', 'only the owner can release a reservation');
    const r = this.store.db.prepare("UPDATE budget_ledger SET state = 'released', updated_at = ? WHERE job_id = ? AND state = 'unknown'").run(now(), jobId);
    if (r.changes !== 1) throw new ApiError(409, 'nothing_to_release', 'this job has no unresolved reservation');
  }
  ledgerFor(jobId: string) {
    return (this.store.db.prepare('SELECT reserved_cents AS reservedCents, actual_cents AS actualCents, state FROM budget_ledger WHERE job_id = ?').get(jobId) as { reservedCents: number; actualCents: number | null; state: string } | undefined) ?? null;
  }
  /** settled = actual cost known; released = nothing was charged; unknown = submission outcome unknown, stays counted until resolved. */
  resolve(jobId: string, state: 'settled' | 'released' | 'unknown', actualCents?: number) {
    this.store.db.prepare('UPDATE budget_ledger SET state = ?, actual_cents = ?, updated_at = ? WHERE job_id = ?').run(state, state === 'settled' ? (actualCents ?? 0) : null, now(), jobId);
  }
}
