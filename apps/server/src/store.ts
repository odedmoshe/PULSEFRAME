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
import { applyTransaction, canonical, createProject, diffEntities, entityMap, migrateProject, OpError, referencedIds, sameEntity, type EntityChange, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { docForReader } from './peoplePrivacy.ts';
import { privacyChanged } from './privacyPurge.ts';

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
  /**
   * Revision the caller last saw. Unlike expectedRevision this allows the project to have moved on:
   * the edit is accepted if no entity it reads or changes was modified after baseRevision (semantic rebase).
   */
  baseRevision?: number;
  /** Extra entity ids the caller's intent depends on (beyond those named in op arguments). */
  dependsOn?: string[];
  /** Authorization hook: sees the exact entity diff before anything is written; throw ApiError to refuse. */
  guard?: (ctx: { changes: EntityChange[]; before: ProjectDocument; after: ProjectDocument }) => void;
  /**
   * 'undo' and 'redo' are set only by Store.undo/redo. 'background' (ADR-0023) is set only by the import queue: a file that
   * finished importing while its owner kept editing. Store.undo's default target skips it (kind IN ('edit','redo')) and it does
   * not abandon a redo (only a later 'edit' does), so Ctrl+Z still undoes the person's own last edit; it is reversed by
   * transaction id, or by removing the file from the library.
   */
  kind?: 'edit' | 'undo' | 'redo' | 'background';
  undoes?: string;
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
  kind?: 'edit' | 'undo' | 'redo' | 'background';
  undoes?: string;
  rebasedFrom?: number;
}
export interface RevisionEvent { seq: number; projectId: string; revision: number; transactionId: string; actor: string; label: string | null; summary: string; affectedIds: string[]; at: string; kind?: string; /** Operation names, so clients can describe the change in their own language. */ ops?: string[];
  /** The transaction this one reverses (an undo or redo), else null. */ undoes?: string | null;
  /** The undo or redo that reversed this transaction, else null (ADR-0027: the bar previews the exact undo target). A live event is always null: the reversal's own event names it in `undoes`. */ undoneBy?: string | null }
export interface JobRow { id: string; projectId: string; type: string; actor: string; status: string; stage: string | null; attempt: number; input: any; output: any; error: any; createdAt: string; updatedAt: string }

/** The data of a live revision event with its changes ({id, after} per entity), as the event stream sends it; serialised once per event for every listener. */
const withChangesJson = new WeakMap<object, string>();
export function revisionWithChanges(e: RevisionEvent, changes: readonly EntityChange[]): string {
  let json = withChangesJson.get(e);
  if (json === undefined) { json = JSON.stringify({ ...e, changes: changes.map((c) => ({ id: c.id, after: c.after })) }); withChangesJson.set(e, json); }
  return json;
}
const id = (prefix: string, bytes = 8) => `${prefix}_${randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x')}`;
const now = () => new Date().toISOString();

export class Store {
  readonly db: Database.Database;
  readonly events = new EventEmitter();
  /**
   * Called synchronously from the commit path, after a commit that adds, changes or removes a privacy region (privacyPurge.ts),
   * with the project's revision after it. The server sets it to the render cache's purge (ADR-0024): privacy over speed.
   */
  onPrivacyChange: ((projectId: string, revision: number) => void) | null = null;
  private assetsGoneListeners: ((projectId: string, contentHashes: string[]) => void)[] = [];
  /**
   * Picture search (wave 7 search track; search/contract.ts): called synchronously after every durable commit (an operation, an undo,
   * a redo, a template) in which an asset entity disappeared or changed its content hash, with the content hashes that left this
   * project's document. A listener decides itself whether another current project still holds a hash (the search index keeps a
   * file's rows only while some project does). A listener that throws is logged and never fails the commit. Returns the remover.
   */
  addAssetsGoneListener(fn: (projectId: string, contentHashes: string[]) => void): () => void {
    this.assetsGoneListeners.push(fn);
    return () => { this.assetsGoneListeners = this.assetsGoneListeners.filter((x) => x !== fn); };
  }
  readonly blobDir: string;
  readonly outDir: string;
  readonly tmpDir: string;

  /**
   * @param maxStorageBytes Ceiling for everything in the data directory, in bytes (config `maxStorageBytes`; 0 = none). It lives
   * here, with the directory it limits, so that every path that adds files (uploads, imports, exports, generated pictures, sounds
   * and speech) reads the same number: a REST route and its MCP tool call the same function and cannot disagree (storage.ts).
   */
  constructor(public dataDir: string, public maxStorageBytes = 0) {
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
      CREATE TABLE IF NOT EXISTS entity_versions (project_id TEXT NOT NULL, entity_id TEXT NOT NULL, revision INTEGER NOT NULL, deleted INTEGER NOT NULL, actor TEXT NOT NULL, PRIMARY KEY (project_id, entity_id));
    `);
    // Storage migrations (PRAGMA user_version). v1: undo metadata and per-transaction entity changes.
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version < 1) {
      const cols = new Set((this.db.prepare("SELECT name FROM pragma_table_info('transactions')").all() as any[]).map((c) => c.name));
      for (const [name, ddl] of [['kind', "TEXT NOT NULL DEFAULT 'edit'"], ['undoes', 'TEXT'], ['undone_by', 'TEXT'], ['changes', "TEXT NOT NULL DEFAULT '[]'"]] as const)
        if (!cols.has(name)) this.db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${ddl}`);
      this.db.pragma('user_version = 1');
    }
  }

  // ---------- projects ----------
  createProject(opts: { name: string; width?: number; height?: number; frameRate?: { num: number; den: number } }): { doc: ProjectDocument; revision: number } {
    const doc = createProject({ id: id('prj'), ...opts });
    const json = JSON.stringify(doc);
    this.db.prepare('INSERT INTO projects (id, revision, doc, initial_doc, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?)').run(doc.id, json, json, now(), now());
    this.events.emit('projects', { projectId: doc.id, change: 'created' }); // the set of projects changed (not part of any project's history)
    return { doc, revision: 0 };
  }
  /** Create a project from an existing document (archive import). It gets a new id and starts its own history at revision 0. */
  importProject(source: ProjectDocument): { doc: ProjectDocument; revision: number } {
    const doc = { ...source, id: id('prj') };
    const json = JSON.stringify(doc);
    this.db.prepare('INSERT INTO projects (id, revision, doc, initial_doc, created_at, updated_at) VALUES (?, 0, ?, ?, ?, ?)').run(doc.id, json, json, now(), now());
    this.events.emit('projects', { projectId: doc.id, change: 'created' }); // the set of projects changed (not part of any project's history)
    return { doc, revision: 0 };
  }
  listProjects() {
    return (this.db.prepare('SELECT id, revision, doc, updated_at FROM projects ORDER BY updated_at DESC').all() as any[]).map((r) => ({ id: r.id, name: JSON.parse(r.doc).name as string, revision: r.revision as number, updatedAt: r.updated_at as string }));
  }
  /**
   * The project as the credential of the current request may read it (ADR-0021, people section; peoplePrivacy.ts): for a
   * credential without the people scope the document comes without birth dates, so nothing computed from it for that
   * credential (a summary, a frame, a preflight report) can hold one. Outside a request, and for the owner, the whole
   * document. NEVER write back what this returns: writes read wholeProject.
   */
  getProject(projectId: string): { doc: ProjectDocument; revision: number } {
    const p = this.wholeProject(projectId);
    return { doc: docForReader(p.doc), revision: p.revision };
  }
  /**
   * The stored document, whoever asks. For the store's own writes (commit, undo) and for the few checks that must see what a
   * film would be rendered from (peoplePrivacy.ts assertMayTakeRendered). Its document is never put into an answer.
   */
  wholeProject(projectId: string): { doc: ProjectDocument; revision: number } {
    const row = this.db.prepare('SELECT doc, revision FROM projects WHERE id = ?').get(projectId) as any;
    if (!row) throw new ApiError(404, 'project_not_found', `project ${projectId} not found`, { projectId }, 'Call list_projects.');
    return { doc: migrateProject(JSON.parse(row.doc)), revision: row.revision };
  }
  /** Rebuild any revision purely from the initial document and the op log (also the crash/replay check). Answers as getProject does: what the current request's credential may read. */
  replay(projectId: string, revision?: number): { doc: ProjectDocument; revision: number } {
    const row = this.db.prepare('SELECT initial_doc, revision FROM projects WHERE id = ?').get(projectId) as any;
    if (!row) throw new ApiError(404, 'project_not_found', `project ${projectId} not found`, { projectId });
    const target = revision ?? row.revision;
    if (!Number.isInteger(target) || target < 0 || target > row.revision) throw new ApiError(404, 'revision_not_found', `revision ${revision} does not exist (latest ${row.revision})`, { latest: row.revision });
    let doc = migrateProject(JSON.parse(row.initial_doc));
    const txs = this.db.prepare('SELECT ops, id_seed, actor, allow_internal FROM transactions WHERE project_id = ? AND revision <= ? ORDER BY revision').all(projectId, target) as any[];
    for (const t of txs) doc = applyTransaction(doc, JSON.parse(t.ops), { idSeed: t.id_seed, actor: t.actor, allowInternal: !!t.allow_internal }).doc;
    // Re-parse so key order is canonical (same normalisation as getProject) and the result is schema-checked.
    return { doc: docForReader(migrateProject(doc)), revision: target };
  }

  // ---------- commits ----------
  commit(req: CommitRequest): CommitResult {
    let live: { seq: number; changes: EntityChange[] } | null = null;
    const run = this.db.transaction((): CommitResult & { privacyChanged?: true } => {
      const { doc, revision } = this.wholeProject(req.projectId); // a write: the whole document, whoever commits
      if (req.idempotencyKey && !req.dryRun) {
        const prior = this.db.prepare('SELECT id, revision, ops, result FROM transactions WHERE project_id = ? AND actor = ? AND idempotency_key = ?').get(req.projectId, req.actor, req.idempotencyKey) as any;
        if (prior) {
          if (canonical(JSON.parse(prior.ops)) !== canonical(req.ops)) throw new ApiError(409, 'idempotency_key_reused', 'idempotencyKey was already used with different operations', { transactionId: prior.id });
          return { ...JSON.parse(prior.result), transactionId: prior.id, revision: prior.revision, committed: true, replayed: true };
        }
      }
      // Strict mode: a stated expectedRevision must be current.
      if (req.expectedRevision !== undefined && req.expectedRevision !== revision)
        throw new ApiError(409, 'stale_revision', `expectedRevision ${req.expectedRevision} is not the current revision ${revision}`, { expectedRevision: req.expectedRevision, currentRevision: revision }, 'Re-read the timeline at the current revision and resubmit, or send baseRevision to allow a safe rebase.');
      // Rebase mode: accept a stale base only if nothing this edit reads or writes changed since the caller looked.
      const stale = req.baseRevision !== undefined && req.baseRevision < revision;
      if (req.baseRevision !== undefined && (req.baseRevision > revision || req.baseRevision < 0)) throw new ApiError(400, 'invalid_request', `baseRevision ${req.baseRevision} is ahead of the current revision ${revision}`);
      const newer = (ids: Iterable<string>) => {
        const out: { entityId: string; changedAtRevision: number; by: string; deleted: boolean }[] = [];
        for (const e of ids) {
          const v = this.entityVersion(req.projectId, e);
          if (v && v.revision > req.baseRevision!) out.push({ entityId: e, changedAtRevision: v.revision, by: v.actor, deleted: v.deleted });
        }
        return out;
      };
      const conflict = (c: ReturnType<typeof newer>) => new ApiError(409, 'conflict', `${c.length} item(s) this edit depends on changed after revision ${req.baseRevision}`, { baseRevision: req.baseRevision, currentRevision: revision, conflicts: c }, 'Re-read those items, decide again, and resubmit with the new baseRevision.');
      if (stale) {
        const live = entityMap(doc);
        const refs = referencedIds(req.ops.map((o) => o.args), (s) => live.has(s) || !!this.entityVersion(req.projectId, s));
        for (const d of req.dependsOn ?? []) refs.add(d);
        const c = newer(refs);
        if (c.length) throw conflict(c);
      }
      const idSeed = randomBytes(5).toString('hex');
      let applied;
      try {
        applied = applyTransaction(doc, req.ops, { idSeed, actor: req.actor, allowInternal: req.allowInternal });
      } catch (e) {
        if (e instanceof OpError) throw new ApiError(e.code === 'forbidden_op' ? 403 : e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
        throw e;
      }
      const changes = diffEntities(doc, applied.doc);
      if (stale) {
        const c = newer(changes.map((x) => x.id));
        if (c.length) throw conflict(c);
      }
      req.guard?.({ changes, before: doc, after: applied.doc });
      const privacy = !req.dryRun && changes.length > 0 && privacyChanged(changes, doc, applied.doc);
      const affectedIds = [...new Set([...applied.affectedIds, ...changes.map((c) => c.id)])];
      const base = { affectedIds, summary: applied.summary, results: applied.results, warnings: [] as string[], ...(req.kind && req.kind !== 'edit' ? { kind: req.kind, undoes: req.undoes } : {}), ...(stale ? { rebasedFrom: req.baseRevision } : {}) };
      if (req.dryRun) return { ...base, transactionId: null, revision, committed: false, replayed: false };
      if (changes.length === 0) return { ...base, transactionId: null, revision, committed: false, replayed: false, warnings: ['no_change'] };
      const txId = id('tx');
      const next = revision + 1;
      const at = now();
      this.db.prepare('UPDATE projects SET doc = ?, revision = ?, updated_at = ? WHERE id = ? AND revision = ?').run(JSON.stringify(applied.doc), next, at, req.projectId, revision);
      this.db
        .prepare('INSERT INTO transactions (project_id, revision, id, actor, label, idempotency_key, request_id, id_seed, allow_internal, ops, result, created_at, kind, undoes, changes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(req.projectId, next, txId, req.actor, req.label ?? null, req.idempotencyKey ?? null, req.requestId ?? null, idSeed, req.allowInternal ? 1 : 0, JSON.stringify(req.ops), JSON.stringify(base), at, req.kind ?? 'edit', req.undoes ?? null, JSON.stringify(changes));
      if (req.undoes) this.db.prepare('UPDATE transactions SET undone_by = ? WHERE project_id = ? AND id = ?').run(txId, req.projectId, req.undoes);
      const setVersion = this.db.prepare('INSERT INTO entity_versions (project_id, entity_id, revision, deleted, actor) VALUES (?,?,?,?,?) ON CONFLICT(project_id, entity_id) DO UPDATE SET revision = excluded.revision, deleted = excluded.deleted, actor = excluded.actor');
      for (const c of changes) setVersion.run(req.projectId, c.id, next, c.after ? 0 : 1, req.actor);
      const event: Omit<RevisionEvent, 'seq'> = { projectId: req.projectId, revision: next, transactionId: txId, actor: req.actor, label: req.label ?? null, summary: applied.summary, affectedIds, at, kind: req.kind ?? 'edit', ops: [...new Set(req.ops.map((o) => o.op))], undoes: req.undoes ?? null, undoneBy: null };
      const seq = Number(this.db.prepare('INSERT INTO outbox (project_id, kind, payload, created_at) VALUES (?, ?, ?, ?)').run(req.projectId, 'revision', JSON.stringify(event), at).lastInsertRowid);
      live = { seq, changes };
      return { ...base, transactionId: txId, revision: next, committed: true, replayed: false, ...(privacy ? { privacyChanged: true } : {}) };
    });
    const { privacyChanged: purge, ...result } = run.immediate();
    // Only once the transaction is durable: the event published for this row carries the states it left (liveChanges).
    if (live) { const { seq, changes } = live as { seq: number; changes: EntityChange[] }; if (this.liveBySeq.size > 64) this.liveBySeq.clear(); this.liveBySeq.set(seq, changes); }
    // Picture search (wave 7): content hashes that left this project's document go to the listeners (addAssetsGoneListener)
    if (live && this.assetsGoneListeners.length) {
      const gone = new Set<string>();
      for (const c of (live as { changes: EntityChange[] }).changes) {
        const before = c.before?.kind === 'asset' ? c.before.asset.contentHash : null;
        const after = c.after?.kind === 'asset' ? c.after.asset.contentHash : null;
        if (before && before !== after) gone.add(before);
      }
      if (gone.size) for (const fn of this.assetsGoneListeners) { try { fn(req.projectId, [...gone]); } catch (e) { console.error('an assets-gone listener failed', e); } }
    }
    // In the same commit path, before anyone is told of the revision: pictures rendered before the change may show what is now hidden.
    if (purge && this.onPrivacyChange) {
      try { this.onPrivacyChange(req.projectId, result.revision); } catch (e) { console.error('privacy purge of the render cache failed', e); }
    }
    if (result.committed && !result.replayed) this.drainOutbox();
    return result;
  }

  /** Revision at which an entity last changed (and whether that change deleted it). null = unchanged since creation. */
  entityVersion(projectId: string, entityId: string): { revision: number; deleted: boolean; actor: string } | null {
    const r = this.db.prepare('SELECT revision, deleted, actor FROM entity_versions WHERE project_id = ? AND entity_id = ?').get(projectId, entityId) as any;
    return r ? { revision: r.revision, deleted: !!r.deleted, actor: r.actor } : null;
  }

  /**
   * Undo/redo as a compensating transaction (SPEC §6). Per-actor stack. The target's entities are
   * restored only if each is still exactly as the target left it; otherwise the undo is refused with
   * the list of conflicts, and unrelated later edits by anyone are never touched.
   */
  undo(projectId: string, actor: string, mode: 'undo' | 'redo', transactionId?: string, guard?: CommitRequest['guard'], anyActor = false): CommitResult {
    const run = this.db.transaction((): CommitRequest => {
      const { doc } = this.wholeProject(projectId); // the stored states are compared with the whole document
      const kinds = mode === 'undo' ? "('edit','redo')" : "('undo')";
      const target = (transactionId
        ? (anyActor ? this.db.prepare(`SELECT * FROM transactions WHERE project_id = ? AND id = ?`).get(projectId, transactionId) : this.db.prepare(`SELECT * FROM transactions WHERE project_id = ? AND id = ? AND actor = ?`).get(projectId, transactionId, actor))
        : this.db.prepare(`SELECT * FROM transactions WHERE project_id = ? AND actor = ? AND kind IN ${kinds} AND undone_by IS NULL ORDER BY revision DESC LIMIT 1`).get(projectId, actor)) as any;
      if (!target) throw new ApiError(409, mode === 'undo' ? 'nothing_to_undo' : 'nothing_to_redo', `no transaction of yours is available to ${mode}`);
      if (target.undone_by) throw new ApiError(409, 'already_undone', `transaction ${target.id} was already reversed by ${target.undone_by}`);
      if (mode === 'redo') {
        if (target.kind !== 'undo') throw new ApiError(409, 'not_redoable', 'only an undo can be redone');
        // A new edit by the same actor after the undo abandons the redo branch (standard stack semantics).
        const later = this.db.prepare("SELECT 1 FROM transactions WHERE project_id = ? AND actor = ? AND kind = 'edit' AND revision > ?").get(projectId, target.actor, target.revision);
        if (later) throw new ApiError(409, 'nothing_to_redo', 'you edited after undoing; that redo is no longer available');
      }
      const changes: EntityChange[] = JSON.parse(target.changes);
      const live = entityMap(doc);
      const conflicts = changes.filter((c) => !sameEntity(live.get(c.id) ?? null, c.after)).map((c) => ({ entityId: c.id, ...(this.entityVersion(projectId, c.id) ?? {}) }));
      if (conflicts.length) throw new ApiError(409, 'undo_conflict', `cannot ${mode}: ${conflicts.length} item(s) were changed afterwards`, { transactionId: target.id, conflicts }, 'Those later changes are kept. Undo them first, or edit manually.');
      const label = `${mode === 'undo' ? 'Undo' : 'Redo'}: ${target.label ?? JSON.parse(target.result).summary}`.slice(0, 200);
      return { projectId, actor, label, allowInternal: true, kind: mode, undoes: target.id, ops: [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }] };
    });
    const req = run.immediate();
    try {
      return this.commit({ ...req, guard });
    } catch (e) {
      // Restoring would produce an invalid timeline (e.g. the space is now occupied): a conflict, not a server error.
      if (e instanceof ApiError && e.code === 'invalid_result') throw new ApiError(409, 'undo_conflict', `cannot ${mode}: ${e.message}`, { transactionId: req.undoes });
      throw e;
    }
  }

  /** Publish committed-but-unpublished outbox rows in order. Safe to call any time, including after a crash. */
  drainOutbox(): number {
    const rows = this.db.prepare('SELECT seq, kind, payload FROM outbox WHERE published_at IS NULL ORDER BY seq').all() as any[];
    for (const r of rows) {
      const e = { seq: r.seq, ...JSON.parse(r.payload) };
      const changes = this.liveBySeq.get(r.seq);
      if (changes) { this.liveBySeq.delete(r.seq); this.liveOf.set(e, changes); }
      this.events.emit(r.kind, e);
      this.db.prepare('UPDATE outbox SET published_at = ? WHERE seq = ?').run(now(), r.seq);
    }
    return rows.length;
  }
  /**
   * The entity states a live revision event's transaction left, by entity id (null = removed): the transaction's own diff
   * (diffEntities, the same changes stored for undo), handed to the event stream so that a reader with the whole document at the
   * revision before can apply it instead of reading the whole document again (apps/web/src/editor/sync.ts). Kept in memory for
   * the event object published right after the commit only: replayed events, events published after a restart and events
   * of other kinds have none, and the reader reads the whole document as before. Never stored, never sent to a reader without
   * the people scope (they may not read entity states whole: apps/server/src/http.ts).
   */
  liveChanges(e: object): readonly EntityChange[] | undefined { return this.liveOf.get(e); }
  private readonly liveBySeq = new Map<number, EntityChange[]>();
  private readonly liveOf = new WeakMap<object, EntityChange[]>();
  /** Committed revision events after `sinceRevision`, for reconnect/resync. */
  eventsSince(projectId: string, sinceRevision: number): RevisionEvent[] {
    return (this.db.prepare('SELECT revision, id, actor, label, result, created_at, kind, ops, undoes, undone_by FROM transactions WHERE project_id = ? AND revision > ? ORDER BY revision').all(projectId, sinceRevision) as any[]).map((t) => {
      const r = JSON.parse(t.result);
      return { seq: 0, projectId, revision: t.revision, transactionId: t.id, actor: t.actor, label: t.label, summary: r.summary, affectedIds: r.affectedIds, at: t.created_at, kind: t.kind, ops: [...new Set((JSON.parse(t.ops) as { op: string }[]).map((o) => o.op))], undoes: t.undoes ?? null, undoneBy: t.undone_by ?? null };
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

  /**
   * Run a write that removes private words from rows so that they also leave the FILES: inside one transaction with SQLite's
   * secure_delete on (freed bytes of the changed rows are overwritten with zeros, not left in the page), and with the write-ahead
   * log folded into the database and cut to nothing afterwards (the log held the earlier versions of those pages). A backup
   * made after this holds none of them. The checkpoint is best effort: a reader in another connection can hold it back until
   * the next one. Not promised: what a filesystem or a disk keeps of blocks it has freed.
   */
  erasing<R>(write: () => R): R {
    const was = this.db.pragma('secure_delete', { simple: true });
    this.db.pragma('secure_delete = ON');
    try { return this.db.transaction(write)(); }
    finally {
      this.db.pragma(`secure_delete = ${was === 2 ? 'FAST' : was ? 'ON' : 'OFF'}`);
      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* another connection reads: the next checkpoint folds it */ }
    }
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
