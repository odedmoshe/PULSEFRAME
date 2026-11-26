/**
 * The in-editor agent's run and step rows (wave 8 autonomy Part 2; tables in contract.ts). W1. These tables are the server's own
 * bookkeeping, not project state: no project edit is written here (edits go through MCP → Governance.commitAs → Store.commit).
 * A step's `model`, `tool` and `note` columns hold the JSON of AgentStep's fields of the same name; a step row is INSERTED with
 * status running and its started_at BEFORE its call is made (resume rule 1, C8.2).
 */
import { randomBytes } from 'node:crypto';
import type Database from 'better-sqlite3';
import { AGENT_JOB_TYPE, agentJobStage, AGENT_REFUSAL_CODES, AGENT_RUN_FINAL, type AgentPlan, type AgentRun, type AgentRunStatus, type AgentStep, type AgentStepStatus, type AgentStopReason, type AgentToolCallRecord } from '@pulseframe/core';
import { ApiError, type Store } from '../store.ts';
import { ensureAgentTables } from './contract.ts';

const now = () => new Date().toISOString();
export const newRunId = (): string => `run_${randomBytes(12).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 16)}`;
export type ModelRecord = NonNullable<AgentStep['model']>;
export type NoteRecord = NonNullable<AgentStep['note']>;

export class RunRepo {
  readonly db: Database.Database;
  constructor(readonly store: Store) { this.db = store.db; ensureAgentTables(this.db); }

  private toRun = (r: any): AgentRun => ({
    id: r.id, projectId: r.project_id, actor: r.actor, startedBy: r.started_by, goal: r.goal, providerId: r.provider_id, model: r.model,
    status: r.status, stopReason: r.stop_reason ?? null, stepsUsed: r.steps_used, stepLimit: r.step_limit ?? null, spendLimitCents: r.spend_limit_cents ?? null,
    spentCents: Math.round(r.spent_cents * 10000) / 10000, unknownCostCalls: r.unknown_cost_calls, tokens: { input: r.tokens_in, output: r.tokens_out }, plan: JSON.parse(r.plan),
    startRevision: r.start_revision, jobId: r.job_id, summary: r.summary ?? null, createdAt: r.created_at, endedAt: r.ended_at ?? null, undoneBy: r.undone_by ?? null,
  });
  private toStep = (r: any): AgentStep => ({
    runId: r.run_id, n: r.n, kind: r.kind, status: r.status, model: r.model ? JSON.parse(r.model) : null, tool: r.tool ? JSON.parse(r.tool) : null,
    note: r.note ? JSON.parse(r.note) : null, startedAt: r.started_at, endedAt: r.ended_at ?? null, revisionAfter: r.revision_after ?? null,
  });

  create(row: { id: string; projectId: string; startedBy: string; actor: string; goal: string; providerId: string; model: string; stepLimit: number | null; spendLimitCents: number | null; startRevision: number }): AgentRun {
    return this.db.transaction(() => {
      const job = this.store.createJob(row.projectId, AGENT_JOB_TYPE, row.actor, { runId: row.id });
      this.db.prepare('INSERT INTO agent_runs (id, project_id, actor, started_by, goal, provider_id, model, status, step_limit, spend_limit_cents, start_revision, job_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(row.id, row.projectId, row.actor, row.startedBy, row.goal, row.providerId, row.model, 'queued', row.stepLimit, row.spendLimitCents, row.startRevision, job.id, now());
      return this.get(row.id);
    })();
  }
  find(runId: string): AgentRun | null { const r = this.db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId); return r ? this.toRun(r) : null; }
  get(runId: string, projectId?: string): AgentRun {
    const r = this.find(runId);
    if (!r || (projectId !== undefined && r.projectId !== projectId)) throw new ApiError(AGENT_REFUSAL_CODES.runNotFound.status, AGENT_REFUSAL_CODES.runNotFound.code, `no agent run ${runId} on this project`, { runId }, 'GET /api/v1/projects/{id}/agent/runs lists them.');
    return r;
  }
  byActor(actor: string): AgentRun | null { const r = this.db.prepare('SELECT * FROM agent_runs WHERE actor = ?').get(actor); return r ? this.toRun(r) : null; }
  list(projectId: string): AgentRun[] { return (this.db.prepare('SELECT * FROM agent_runs WHERE project_id = ? ORDER BY created_at DESC, rowid DESC').all(projectId) as any[]).map(this.toRun); }
  active(): AgentRun[] { return (this.db.prepare("SELECT * FROM agent_runs WHERE status IN ('queued','running','waiting') ORDER BY created_at").all() as any[]).map(this.toRun); }
  steps(runId: string): AgentStep[] { return (this.db.prepare('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY n').all(runId) as any[]).map(this.toStep); }
  step(runId: string, n: number): AgentStep { return this.toStep(this.db.prepare('SELECT * FROM agent_steps WHERE run_id = ? AND n = ?').get(runId, n)); }

  /** Sets the run's status and the job's (stage `step:<n>:<status>`, so the existing SSE job event carries it). */
  setStatus(run: AgentRun, status: AgentRunStatus, opts: { stopReason?: AgentStopReason | null; summary?: string | null; stage?: string } = {}): AgentRun {
    const final = AGENT_RUN_FINAL.includes(status);
    this.db.prepare('UPDATE agent_runs SET status = ?, stop_reason = ?, summary = COALESCE(?, summary), ended_at = ? WHERE id = ?')
      .run(status, opts.stopReason === undefined ? (final ? run.stopReason : null) : opts.stopReason, opts.summary ?? null, final ? now() : null, run.id);
    const jobStatus = status === 'succeeded' ? 'succeeded' : status === 'canceled' ? 'canceled' : final ? 'failed' : status === 'queued' ? 'queued' : 'running';
    const last = this.lastN(run.id);
    this.store.updateJob(run.jobId, { status: jobStatus, stage: opts.stage ?? (final ? `${status}${opts.stopReason ? `:${opts.stopReason}` : ''}` : agentJobStage(last, status === 'waiting' ? 'waiting' : 'running')), ...(final && status !== 'succeeded' ? { error: { code: opts.stopReason ?? status, runStatus: status } } : {}), ...(status === 'succeeded' ? { output: { runId: run.id } } : {}) });
    return this.get(run.id);
  }
  lastN(runId: string): number { return (this.db.prepare('SELECT COALESCE(MAX(n), 0) AS n FROM agent_steps WHERE run_id = ?').get(runId) as { n: number }).n; }

  /** Rule 1: the row (status running, started_at) is committed before the call is made. */
  insertStep(run: AgentRun, kind: AgentStep['kind'], fields: { model?: ModelRecord; tool?: AgentToolCallRecord; note?: NoteRecord; status?: AgentStepStatus }): AgentStep {
    const n = this.lastN(run.id) + 1;
    const status = fields.status ?? (kind === 'note' ? 'done' : 'running');
    const at = now();
    this.db.prepare('INSERT INTO agent_steps (run_id, n, kind, status, model, tool, note, started_at, ended_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(run.id, n, kind, status, fields.model ? JSON.stringify(fields.model) : null, fields.tool ? JSON.stringify(fields.tool) : null, fields.note ? JSON.stringify(fields.note) : null, at, status === 'running' ? null : at);
    this.store.updateJob(run.jobId, { stage: agentJobStage(n, status) });
    return this.step(run.id, n);
  }
  finishStep(run: AgentRun, n: number, status: AgentStepStatus, fields: { model?: ModelRecord; tool?: AgentToolCallRecord; revisionAfter?: number | null }): AgentStep {
    this.db.prepare('UPDATE agent_steps SET status = ?, model = COALESCE(?, model), tool = COALESCE(?, tool), ended_at = ?, revision_after = ? WHERE run_id = ? AND n = ?')
      .run(status, fields.model ? JSON.stringify(fields.model) : null, fields.tool ? JSON.stringify(fields.tool) : null, now(), fields.revisionAfter ?? null, run.id, n);
    this.store.updateJob(run.jobId, { stage: agentJobStage(n, status) });
    return this.step(run.id, n);
  }
  /** Restart: a step resent keeps its row; its started_at moves to the resend. */
  restartStep(run: AgentRun, n: number): void { this.db.prepare("UPDATE agent_steps SET status = 'running', started_at = ?, ended_at = NULL WHERE run_id = ? AND n = ?").run(now(), run.id, n); }

  addUsage(runId: string, u: { counted: boolean; inputTokens: number; outputTokens: number; cents: number | null; unknown: boolean }): void {
    this.db.prepare('UPDATE agent_runs SET steps_used = steps_used + ?, tokens_in = tokens_in + ?, tokens_out = tokens_out + ?, spent_cents = spent_cents + ?, unknown_cost_calls = unknown_cost_calls + ? WHERE id = ?')
      .run(u.counted ? 1 : 0, u.inputTokens, u.outputTokens, u.cents ?? 0, u.unknown ? 1 : 0, runId);
  }
  setPlan(runId: string, plan: AgentPlan): void { this.db.prepare('UPDATE agent_runs SET plan = ? WHERE id = ?').run(JSON.stringify(plan), runId); }
  setLimits(runId: string, stepLimit: number | null, spendLimitCents: number | null): void { this.db.prepare('UPDATE agent_runs SET step_limit = ?, spend_limit_cents = ? WHERE id = ?').run(stepLimit, spendLimitCents, runId); }
  setUndoneBy(runId: string, txId: string): void { this.db.prepare('UPDATE agent_runs SET undone_by = ? WHERE id = ?').run(txId, runId); }
}
