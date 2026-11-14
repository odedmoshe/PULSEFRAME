/**
 * Authoritative project store (SPEC §6): transactional SQLite, append-only op log,
 * materialized document and a transactional outbox, all written in ONE database transaction.
 * better-sqlite3 is synchronous, so commits for a project are naturally serialized in this process.
 */
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { applyTransaction, createProject, migrateProject, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}, public hint?: string) {
    super(message);
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details, hint: this.hint } };
  }
}

export interface CommitRequest {
  projectId: string;
  ops: OpCall[];
  actor: string;
  label?: string;
  expectedRevision?: number;
  idempotencyKey?: string;
  requestId?: string;
  allowInternal?: boolean;
  dryRun?: boolean;
}
export interface CommitResult {
  transactionId: string | null;
  revision: number;
  committed: boolean;
  replayed: boolean;
  affectedIds: string[];
  summary: string;
  results: { op: string; summary: string; affectedIds: string[]; output?: Record<string, unknown> }[];
  warnings: string[];
}
export interface RevisionEvent { seq: number; projectId: string; revision: number; transactionId: string; actor: string; label: string | null; summary: string; affectedIds: string[]; at: string }
export interface JobRow { id: string; projectId: string; type: string; actor: string; status: string; stage: string | null; attempt: number; input: any; output: any; error: any; createdAt: string; updatedAt: string }

const id = (prefix: string, bytes = 8) => `${prefix}_${randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x')}`;
const now = () => new Date().toISOString();

export class Store {
  readonly db: Database.Database;
  readonly events = new EventEmitter();
  readonly blobDir: string;
  readonly outDir: string;
  readonly tmpDir: string;

  constructor(public dataDir: string) {
    for (const d of ['', 'blobs', 'out', 'tmp']) fs.mkdirSync(path.join(dataDir, d), { recursive: true, mode: 0o700 });
    this.blobDir = path.join(dataDir, 'blobs');
    this.outDir = path.join(dataDir, 'out');
    this.tmpDir = path.join(dataDir, 'tmp');
    this.db = new Database(path.join(dataDir, 'pulseframe.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, doc TEXT NOT NULL, initial_doc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS transactions (
        project_id TEXT NOT NULL REFERENCES projects(id), revision INTEGER NOT NULL, id TEXT NOT NULL, actor TEXT NOT NULL, label TEXT,
        idempotency_key TEXT, request_id TEXT, id_seed TEXT NOT NULL, allow_internal INTEGER NOT NULL, ops TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, revision));
      CREATE UNIQUE INDEX IF NOT EXISTS tx_idem ON transactions(project_id, actor, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, published_at TEXT);
      CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, mime TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL, actor TEXT NOT NULL, status TEXT NOT NULL, stage TEXT, attempt INTEGER NOT NULL DEFAULT 0,
        input TEXT NOT NULL, output TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
  }

  // ---------- projects ----------
  createProject(opts: { name: string; width?: number; height?: number; frameRate?: { num: number; den: number } }): { doc: ProjectDocument; revision: number } {
    const doc = createProject({ id: id('prj'), ...opts });
    const json = JSON.stringify(doc);
    this.db.prepare('INSERT INTO projects (id, revision, doc, initial_doc, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?)').run(doc.id, json, json, now(), now());
    return { doc, revision: 0 };
  }
  listProjects() {
    return (this.db.prepare('SELECT id, revision, doc, updated_at FROM projects ORDER BY updated_at DESC').all() as any[]).map((r) => ({ id: r.id, name: JSON.parse(r.doc).name as string, revision: r.revision as number, updatedAt: r.updated_at as string }));
  }
  getProject(projectId: string): { doc: ProjectDocument; revision: number } {
    const row = this.db.prepare('SELECT doc, revision FROM projects WHERE id = ?').get(projectId) as any;
    if (!row) throw new ApiError(404, 'project_not_found', `project ${projectId} not found`, { projectId }, 'Call list_projects.');
    return { doc: migrateProject(JSON.parse(row.doc)), revision: row.revision };
  }
  /** Rebuild any revision purely from the initial document and the op log (also the crash/replay check). */
  replay(projectId: string, revision?: number): { doc: ProjectDocument; revision: number } {
    const row = this.db.prepare('SELECT initial_doc, revision FROM projects WHERE id = ?').get(projectId) as any;
    if (!row) throw new ApiError(404, 'project_not_found', `project ${projectId} not found`, { projectId });
    const target = revision ?? row.revision;
    if (!Number.isInteger(target) || target < 0 || target > row.revision) throw new ApiError(404, 'revision_not_found', `revision ${revision} does not exist (latest ${row.revision})`, { latest: row.revision });
    let doc = migrateProject(JSON.parse(row.initial_doc));
    const txs = this.db.prepare('SELECT ops, id_seed, actor, allow_internal FROM transactions WHERE project_id = ? AND revision <= ? ORDER BY revision').all(projectId, target) as any[];
    for (const t of txs) doc = applyTransaction(doc, JSON.parse(t.ops), { idSeed: t.id_seed, actor: t.actor, allowInternal: !!t.allow_internal }).doc;
    // Re-parse so key order is canonical (same normalisation as getProject) and the result is schema-checked.
    return { doc: migrateProject(doc), revision: target };
  }

  // ---------- commits ----------
  commit(req: CommitRequest): CommitResult {
    const run = this.db.transaction((): CommitResult => {
      const { doc, revision } = this.getProject(req.projectId);
      if (req.idempotencyKey && !req.dryRun) {
        const prior = this.db.prepare('SELECT id, revision, ops, result FROM transactions WHERE project_id = ? AND actor = ? AND idempotency_key = ?').get(req.projectId, req.actor, req.idempotencyKey) as any;
        if (prior) {
          if (prior.ops !== JSON.stringify(req.ops)) throw new ApiError(409, 'idempotency_key_reused', 'idempotencyKey was already used with different operations', { transactionId: prior.id });
          return { ...JSON.parse(prior.result), transactionId: prior.id, revision: prior.revision, committed: true, replayed: true };
        }
      }
      // Phase 0 concurrency rule: a stated expectedRevision must be current. Semantic rebasing is Phase 1.
      if (req.expectedRevision !== undefined && req.expectedRevision !== revision)
        throw new ApiError(409, 'stale_revision', `expectedRevision ${req.expectedRevision} is not the current revision ${revision}`, { expectedRevision: req.expectedRevision, currentRevision: revision }, 'Re-read the timeline at the current revision and resubmit.');
      const idSeed = randomBytes(5).toString('hex');
      let applied;
      try {
        applied = applyTransaction(doc, req.ops, { idSeed, actor: req.actor, allowInternal: req.allowInternal });
      } catch (e) {
        if (e instanceof OpError) throw new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
        throw e;
      }
      const base = { affectedIds: applied.affectedIds, summary: applied.summary, results: applied.results, warnings: [] as string[] };
      if (req.dryRun) return { ...base, transactionId: null, revision, committed: false, replayed: false };
      if (applied.affectedIds.length === 0 && JSON.stringify(applied.doc) === JSON.stringify(doc))
        return { ...base, transactionId: null, revision, committed: false, replayed: false, warnings: ['no_change'] };
      const txId = id('tx');
      const next = revision + 1;
      const at = now();
      this.db.prepare('UPDATE projects SET doc = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(applied.doc), next, at, req.projectId, revision);
      this.db
        .prepare('INSERT INTO transactions (project_id, revision, id, actor, label, idempotency_key, request_id, id_seed, allow_internal, ops, result, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(req.projectId, next, txId, req.actor, req.label ?? null, req.idempotencyKey ?? null, req.requestId ?? null, idSeed, req.allowInternal ? 1 : 0, JSON.stringify(req.ops), JSON.stringify(base), at);
      const event: Omit<RevisionEvent, 'seq'> = { projectId: req.projectId, revision: next, transactionId: txId, actor: req.actor, label: req.label ?? null, summary: applied.summary, affectedIds: applied.affectedIds, at };
      this.db.prepare('INSERT INTO outbox (project_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(req.projectId, 'revision', JSON.stringify(event), at);
      return { ...base, transactionId: txId, revision: next, committed: true, replayed: false };
    });
    const result = run.immediate();
    if (result.committed && !result.replayed) this.drainOutbox();
    return result;
  }

  /** Publish committed-but-unpublished outbox rows in order. Safe to call any time, including after a crash. */
  drainOutbox(): number {
    const rows = this.db.prepare('SELECT seq, kind, payload FROM outbox WHERE published_at IS NULL ORDER BY seq').all() as any[];
    for (const r of rows) {
      this.events.emit(r.kind, { seq: r.seq, ...JSON.parse(r.payload) });
      this.db.prepare('UPDATE outbox SET published_at = ? WHERE seq = ?').run(now(), r.seq);
    }
    return rows.length;
  }
  /** Committed revision events after `sinceRevision`, for reconnect/resync. */
  eventsSince(projectId: string, sinceRevision: number): RevisionEvent[] {
    return (this.db.prepare('SELECT revision, id, actor, label, result, created_at FROM transactions WHERE project_id = ? AND revision > ? ORDER BY revision').all(projectId, sinceRevision) as any[]).map((t) => {
      const r = JSON.parse(t.result);
      return { seq: 0, projectId, revision: t.revision, transactionId: t.id, actor: t.actor, label: t.label, summary: r.summary, affectedIds: r.affectedIds, at: t.created_at };
    });
  }

  // ---------- blobs ----------
  blobPath(hash: string) {
    const hex = hash.replace(/^sha256:/, '');
    if (!/^[0-9a-f]{64}$/.test(hex)) throw new ApiError(400, 'bad_hash', 'malformed content hash');
    return path.join(this.blobDir, hex);
  }
  putBlob(hash: string, tmpFile: string, size: number, mime: string) {
    const dest = this.blobPath(hash);
    if (fs.existsSync(dest)) fs.rmSync(tmpFile);
    else fs.renameSync(tmpFile, dest);
    this.db.prepare('INSERT OR IGNORE INTO blobs (hash, size, mime, created_at) VALUES (?,?,?,?)').run(hash, size, mime, now());
  }

  // ---------- jobs ----------
  private jobRow = (r: any): JobRow => ({ id: r.id, projectId: r.project_id, type: r.type, actor: r.actor, status: r.status, stage: r.stage, attempt: r.attempt, input: JSON.parse(r.input), output: r.output && JSON.parse(r.output), error: r.error && JSON.parse(r.error), createdAt: r.created_at, updatedAt: r.updated_at });
  createJob(projectId: string, type: string, actor: string, input: unknown): JobRow {
    const jobId = id('job');
    this.db.prepare('INSERT INTO jobs (id, project_id, type, actor, status, input, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)').run(jobId, projectId, type, actor, 'queued', JSON.stringify(input), now(), now());
    return this.getJob(jobId);
  }
  getJob(jobId: string): JobRow {
    const r = this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
    if (!r) throw new ApiError(404, 'job_not_found', `job ${jobId} not found`, { jobId });
    return this.jobRow(r);
  }
  updateJob(jobId: string, patch: { status?: string; stage?: string | null; output?: unknown; error?: unknown; attempt?: number }) {
    const j = this.getJob(jobId);
    this.db.prepare('UPDATE jobs SET status = ?, stage = ?, output = ?, error = ?, attempt = ?, updated_at = ? WHERE id = ?').run(
      patch.status ?? j.status, patch.stage === undefined ? j.stage : patch.stage, JSON.stringify(patch.output ?? j.output ?? null), JSON.stringify(patch.error ?? j.error ?? null), patch.attempt ?? j.attempt, now(), jobId);
    this.events.emit('job', this.getJob(jobId));
  }
  /** Jobs that were running when the process died restart from their immutable input. */
  recoverJobs(type = 'export'): JobRow[] {
    this.db.prepare("UPDATE jobs SET status = 'queued', stage = 'recovered-after-restart', updated_at = ? WHERE status = 'running' AND type = ?").run(now(), type);
    return (this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' AND type = ? ORDER BY created_at").all(type) as any[]).map(this.jobRow);
  }
  /** Unfinished jobs of a type, untouched (the owner decides how to reconcile them). */
  openJobs(type: string): JobRow[] {
    return (this.db.prepare("SELECT * FROM jobs WHERE type = ? AND status IN ('queued','running','cancel-requested') ORDER BY created_at").all(type) as any[]).map(this.jobRow);
  }
  findJobByKey(type: string, actor: string, key: string): JobRow | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE type = ? AND actor = ? AND json_extract(input, '$.idempotencyKey') = ?").get(type, actor, key);
    return r ? this.jobRow(r) : null;
  }
  lastSucceeded(type: string, capabilityId: string, graphDigest: string): JobRow | null {
    const r = this.db.prepare("SELECT * FROM jobs WHERE type = ? AND status = 'succeeded' AND json_extract(input, '$.capabilityId') = ? AND json_extract(input, '$.graphDigest') = ? ORDER BY updated_at DESC LIMIT 1").get(type, capabilityId, graphDigest);
    return r ? this.jobRow(r) : null;
  }
  close() {
    this.db.close();
  }
}
