/**
 * Named versions on the server (wave 7 craft; craft/contract.ts has the rules; core versionDiff.ts composes and describes).
 * A version is a row beside the history, never an op: saving changes nothing in the project. The row holds a COPY of the document
 * string the store wrote for the current revision, read and inserted in ONE SQLite transaction (so the copy is exactly that
 * revision's document), with its revision, the transaction that made it, a hash of its canonical form, its size, its length in
 * frames and its privacy digest. RESTORE is the edit: one restore_entities transaction through Governance.commitAs (the caller's
 * guard, kind edit, label «שחזור גרסה: <name>»), undoable by the same actor.
 *
 * WHO MAY READ WHAT (reviewed by the lead):
 * - the list (names, sizes, dates, two flags) to every credential that may observe the project; never a document;
 * - a version's content (its still, its diff, restoring it) through mayReadVersionContent below;
 * - every document handed to a credential (the version's copy, the current one) through docForPrincipal: without the people
 *   scope, no birth date and no word choice;
 * - rename and delete: the owner's own session only.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as T from '@pulseframe/time';
import {
  canonical, composeRestore, CRAFT_LIMITS, describeDiff, diffEntities, migrateProject, privacyDigest, sequenceDuration,
  type DiffSummary, type ProjectDocument, type VersionInfo,
} from '@pulseframe/core';
import { isOwnerSession } from '../assistant/contract.ts';
import type { Principal } from '../auth.ts';
import { outputDoc, type Exporter } from '../export.ts';
import type { Governance } from '../governance.ts';
import { docForPrincipal } from '../peoplePrivacy.ts';
import { assertStorageRoom } from '../storage.ts';
import { ApiError, type Store } from '../store.ts';
import { craftError, mayWriteVersions, VERSIONS_TABLE } from './contract.ts';

export interface RestoreResult { revision: number; transactionId: string | null; summary: string; diff: DiffSummary }

/**
 * THE ACCESS RULE of a version's content — its still, its diff, and restoring it.
 * The owner's own session may always. Any other credential (an agent token, a grant, an observer) may only while the version's
 * privacy digest equals the current document's: a version saved before a privacy region was added, removed, moved or changed,
 * or before a person was added or removed (core privacyDigest), is the owner's only, so a stored version never shows (or
 * brings back) a picture that a later region hides or a person removed since.
 */
export function mayReadVersionContent(p: Principal, versionDigest: string, currentDigest: string): boolean {
  return isOwnerSession(p) || versionDigest === currentDigest;
}

interface Row { id: string; project_id: string; name: string; revision: number; transaction_id: string | null; doc: string; doc_hash: string; bytes: number; frames: number; actor: string; privacy_digest: string; created_at: string }
const made = new WeakSet<Store>();
function table(store: Store): Store {
  if (made.has(store)) return store;
  store.db.exec(`CREATE TABLE IF NOT EXISTS ${VERSIONS_TABLE} (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL,
    transaction_id TEXT, doc TEXT NOT NULL, doc_hash TEXT NOT NULL, bytes INTEGER NOT NULL, frames INTEGER NOT NULL, actor TEXT NOT NULL,
    privacy_digest TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS ${VERSIONS_TABLE}_project ON ${VERSIONS_TABLE}(project_id, created_at);`);
  made.add(store);
  return store;
}
const docHash = (doc: ProjectDocument) => createHash('sha256').update(canonical(doc)).digest('hex');
const parse = (json: string): ProjectDocument => migrateProject(JSON.parse(json));
const framesOf = (doc: ProjectDocument) => T.frameCount(sequenceDuration(doc), doc.settings.frameRate);
const isAgentActor = (actor: string) => actor.startsWith('agent:');

function rowOf(store: Store, projectId: string, versionId: string): Row {
  const r = table(store).db.prepare(`SELECT * FROM ${VERSIONS_TABLE} WHERE id = ? AND project_id = ?`).get(versionId, projectId) as Row | undefined;
  if (!r) throw craftError('versionNotFound', { versionId });
  return r;
}
function info(r: Row, current: { hash: string; digest: string }): VersionInfo {
  return { id: r.id, name: r.name, revision: r.revision, createdAt: r.created_at, actor: r.actor, bytes: r.bytes, frames: r.frames, sameAsCurrent: r.doc_hash === current.hash, privacyChanged: r.privacy_digest !== current.digest };
}
function currentOf(store: Store, projectId: string) {
  const whole = store.wholeProject(projectId); // compared only; never put into an answer
  return { whole, hash: docHash(whole.doc), digest: privacyDigest(whole.doc) };
}
/** The row, refused 403 version_privacy_changed when the access rule says no. */
function readableRow(store: Store, p: Principal, projectId: string, versionId: string, currentDigest: string): Row {
  const r = rowOf(store, projectId, versionId);
  if (!mayReadVersionContent(p, r.privacy_digest, currentDigest)) throw craftError('privacyChanged', { versionId });
  return r;
}

export function saveVersion(store: Store, gov: Governance, p: Principal, projectId: string, name: string): VersionInfo {
  mayWriteVersions(gov, p, projectId);
  table(store);
  const probe = store.db.prepare('SELECT doc FROM projects WHERE id = ?').get(projectId) as { doc: string } | undefined;
  if (!probe) store.wholeProject(projectId); // 404 project_not_found
  assertStorageRoom(store, Buffer.byteLength(probe!.doc, 'utf8'), 'save a version');
  const save = store.db.transaction((): Row => {
    // the copy: the document string the store wrote for the current revision, read in this transaction
    const pr = store.db.prepare('SELECT doc, revision FROM projects WHERE id = ?').get(projectId) as { doc: string; revision: number };
    const count = (store.db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONS_TABLE} WHERE project_id = ?`).get(projectId) as { n: number }).n;
    if (count >= CRAFT_LIMITS.versions) throw craftError('versionLimit', { limit: CRAFT_LIMITS.versions }, CRAFT_LIMITS.versions);
    if (p.kind === 'agent') {
      const agents = (store.db.prepare(`SELECT COUNT(*) AS n FROM ${VERSIONS_TABLE} WHERE project_id = ? AND actor LIKE 'agent:%'`).get(projectId) as { n: number }).n;
      if (agents >= CRAFT_LIMITS.agentVersions) throw craftError('agentVersionLimit', { limit: CRAFT_LIMITS.agentVersions }, CRAFT_LIMITS.agentVersions);
    }
    const doc = parse(pr.doc);
    const tx = store.db.prepare('SELECT id FROM transactions WHERE project_id = ? AND revision = ?').get(projectId, pr.revision) as { id: string } | undefined;
    const r: Row = { id: `ver_${randomBytes(6).toString('hex')}`, project_id: projectId, name, revision: pr.revision, transaction_id: tx?.id ?? null, doc: pr.doc, doc_hash: docHash(doc),
      bytes: Buffer.byteLength(pr.doc, 'utf8'), frames: framesOf(doc), actor: p.actor, privacy_digest: privacyDigest(doc), created_at: new Date().toISOString() };
    store.db.prepare(`INSERT INTO ${VERSIONS_TABLE} (id, project_id, name, revision, transaction_id, doc, doc_hash, bytes, frames, actor, privacy_digest, created_at) VALUES (@id, @project_id, @name, @revision, @transaction_id, @doc, @doc_hash, @bytes, @frames, @actor, @privacy_digest, @created_at)`).run(r);
    return r;
  });
  const r = save.immediate();
  return info(r, { hash: r.doc_hash, digest: r.privacy_digest });
}

export function listVersions(store: Store, p: Principal, projectId: string): VersionInfo[] {
  void p; // every credential that may observe the project reads the list (names, sizes, dates); never a document
  const cur = currentOf(store, projectId);
  const rows = table(store).db.prepare(`SELECT * FROM ${VERSIONS_TABLE} WHERE project_id = ? ORDER BY created_at DESC, rowid DESC`).all(projectId) as Row[];
  return rows.map((r) => info(r, cur));
}

export function renameVersion(store: Store, p: Principal, projectId: string, versionId: string, name: string): VersionInfo {
  if (!isOwnerSession(p)) throw craftError('ownerOnly');
  rowOf(store, projectId, versionId);
  store.db.prepare(`UPDATE ${VERSIONS_TABLE} SET name = ? WHERE id = ?`).run(name, versionId);
  return info(rowOf(store, projectId, versionId), currentOf(store, projectId));
}

export function deleteVersion(store: Store, p: Principal, projectId: string, versionId: string): { deleted: string } {
  if (!isOwnerSession(p)) throw craftError('ownerOnly');
  rowOf(store, projectId, versionId);
  // erased from the file, not only from the table (secure_delete, the log folded in): the copy may hold what was removed since
  store.erasing(() => store.db.prepare(`DELETE FROM ${VERSIONS_TABLE} WHERE id = ?`).run(versionId));
  return { deleted: versionId };
}

/** The version's copy as this credential may read it (privacy gate first). */
export function versionDoc(store: Store, p: Principal, projectId: string, versionId: string): ProjectDocument {
  const r = readableRow(store, p, projectId, versionId, currentOf(store, projectId).digest);
  return docForPrincipal(parse(r.doc), p);
}

export function diffVersions(store: Store, p: Principal, projectId: string, versionId: string, against: 'current' | string): DiffSummary {
  const cur = currentOf(store, projectId);
  const from = docForPrincipal(parse(readableRow(store, p, projectId, versionId, cur.digest).doc), p);
  const to = against === 'current' ? docForPrincipal(cur.whole.doc, p) : docForPrincipal(parse(readableRow(store, p, projectId, against, cur.digest).doc), p);
  return describeDiff(from, to);
}

export async function versionStill(store: Store, exporter: Exporter, p: Principal, projectId: string, versionId: string, index: number): Promise<{ png: Buffer; revision: number }> {
  const r = readableRow(store, p, projectId, versionId, currentOf(store, projectId).digest);
  if (!Number.isInteger(index) || index < 0) throw new ApiError(400, 'invalid_request', 'index must be a whole frame number from 0', { index });
  if (index >= Math.max(1, r.frames)) throw craftError('frameOutOfRange', { index, frames: r.frames }, index);
  // drawn from the copy as this credential may read it (age fields empty without the people scope), through the export compositor
  const png = await exporter.renderStill(outputDoc(docForPrincipal(parse(r.doc), p), {}), r.revision, index);
  return { png, revision: r.revision };
}

export function restoreVersion(store: Store, gov: Governance, p: Principal, projectId: string, versionId: string, opts: { expectRevision?: number; confirmPrivacy?: boolean }): RestoreResult {
  mayWriteVersions(gov, p, projectId);
  const cur = currentOf(store, projectId);
  const r = readableRow(store, p, projectId, versionId, cur.digest);
  const now = cur.whole;
  if (opts.expectRevision !== undefined && opts.expectRevision !== now.revision) throw craftError('staleRevision', { expectRevision: opts.expectRevision, currentRevision: now.revision }, now.revision);
  // composed from the WHOLE documents (the library and the people stay exactly as stored); only the answer is the reader's
  const version = parse(r.doc);
  const changes = diffEntities(now.doc, composeRestore(now.doc, version));
  if (!changes.length) throw craftError('nothingToRestore', { versionId });
  if (changes.length > CRAFT_LIMITS.restoreEntities) throw craftError('restoreTooLarge', { changes: changes.length }, changes.length, CRAFT_LIMITS.restoreEntities);
  const { privacy } = describeDiff(version, now.doc);
  const touched = privacy.removed + privacy.changed;
  if (touched > 0 && opts.confirmPrivacy !== true) throw craftError('needsConfirmation', { privacy }, touched);
  const diff = describeDiff(docForPrincipal(version, p), docForPrincipal(now.doc, p));
  let res;
  try {
    res = gov.commitAs(p, { projectId, expectedRevision: now.revision, allowInternal: true, label: `שחזור גרסה: ${r.name}`, ops: [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.after })) } }] });
  } catch (e) {
    if (e instanceof ApiError && e.code === 'invalid_result') throw craftError('versionConflict', { versionId }, e.message.replace(/^(cannot restore: |transaction would produce an invalid project: )/, ''));
    throw e;
  }
  if ('proposed' in res) throw craftError('proposeOnly'); // never reached: mayWriteVersions refuses propose mode first
  return { revision: res.revision, transactionId: res.transactionId, summary: res.summary, diff };
}
