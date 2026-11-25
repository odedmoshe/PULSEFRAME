/**
 * Data lifecycle for the local profile: delete a project, see what the data directory holds, and reclaim media that
 * nothing refers to any more. All three are owner-only. Deleting is permanent; the archive export is the way to keep a copy.
 *
 * Garbage collection is deliberately conservative: a media file is collectable only if its content hash does not appear
 * ANYWHERE in the remaining projects (current documents, initial documents, operation history), jobs or proposals,
 * and it is older than a grace period (so an upload that has not been attached yet is never touched).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { RenderCacheStatus } from '@pulseframe/core';
import type { Principal } from './auth.ts';
import { ApiError, type Store } from './store.ts';

/**
 * Derived data in the data directory that can give room back on demand (the render cache, ADR-0024). Registered once per store
 * by the server; absent in tests and when the cache is off. Every check of the storage ceiling asks it to make room before it
 * refuses, so a full cache is never the reason an upload, an import, a narration, an AI result or an export is refused.
 */
export interface StorageHooks {
  /** Evict unpinned derived data so that `neededBytes` more fit under the ceiling (SegmentStore.trim(neededBytes)). Synchronous. */
  reclaim(neededBytes: number): void;
  /** Remove derived data that only this project referenced (SegmentStore.purgeProject): pictures of a deleted project do not linger. */
  purgeProject(projectId: string): void;
  /** What the owner sees in the storage report. */
  status(): RenderCacheStatus;
}
const hooksOf = new WeakMap<Store, StorageHooks>();
/** Register (or with null, remove) the store's reclaimable derived data. */
export function setStorageHooks(store: Store, hooks: StorageHooks | null): void {
  if (hooks) hooksOf.set(store, hooks);
  else hooksOf.delete(store);
}

/**
 * Picture search (wave 7 search track; search/contract.ts): the index keeps vectors per content hash outside the database. Deleting a
 * project and storage clean-up tell it which hashes may have no project left; it keeps the rows of a hash some current project still
 * holds. A second registry beside StorageHooks (whose one slot is the render cache's). Synchronous; a failure is logged, never fatal.
 */
export interface SearchIndexHooks { hashesMaybeGone(contentHashes: string[]): void }
const searchHooksOf = new WeakMap<Store, SearchIndexHooks>();
export function setSearchIndexHooks(store: Store, hooks: SearchIndexHooks | null): void {
  if (hooks) searchHooksOf.set(store, hooks);
  else searchHooksOf.delete(store);
}
function searchIndexMaybeGone(store: Store, hashes: string[]): void {
  if (!hashes.length) return;
  try { searchHooksOf.get(store)?.hashesMaybeGone(hashes); } catch (e) { console.error('the search index purge failed', e); }
}

const ownerOnly = (p: Principal, what: string) => { if (p.kind !== 'user') throw new ApiError(403, 'owner_required', `only the owner can ${what}`); };
const GRACE_MS = 10 * 60_000;

export function deleteProject(store: Store, by: Principal, projectId: string, confirmName: string) {
  ownerOnly(by, 'delete a project');
  const { doc } = store.getProject(projectId);
  if (confirmName !== doc.name) throw new ApiError(409, 'confirmation_mismatch', 'the confirmation does not match the project name; nothing was deleted', { expected: 'the exact project name' });
  const active = store.db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE project_id = ? AND status IN ('queued','running','cancel-requested')").get(projectId) as { n: number };
  if (active.n > 0) throw new ApiError(409, 'jobs_running', 'this project has jobs that are queued or running; cancel them or wait, then delete', { jobs: active.n });
  const outputs = (store.db.prepare('SELECT output FROM jobs WHERE project_id = ?').all(projectId) as { output: string | null }[]).flatMap((r) => { try { const o = JSON.parse(r.output ?? 'null'); return [o?.file, o?.captions?.file].filter((x): x is string => typeof x === 'string'); } catch { return []; } });
  const has = (table: string) => !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  // A deleted project's rows leave the database FILE too (Store.erasing: freed bytes zeroed, the write-ahead log folded and cut),
  // so a backup made afterwards holds none of them: its history, its proposals and what the language assistant said about it
  // (ADR-0027, note of 2026-11-25: the model's sentence does not outlive its proposal).
  store.erasing(() => {
    for (const t of ['transactions', 'outbox', 'jobs', 'entity_versions', 'proposals', 'approvals', 'project_controls', 'project_versions']) if (has(t)) store.db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
    store.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
  });
  for (const f of outputs) fs.rmSync(path.join(store.outDir, path.basename(f)), { force: true });
  // Rendered segments hold pictures of the project: the ones no other project shares go with it (ADR-0024).
  hooksOf.get(store)?.purgeProject(projectId);
  // Picture search (wave 7): the vectors of its files go too, unless another project still holds the same file
  searchIndexMaybeGone(store, [...new Set(Object.values(doc.assets).map((a) => a.contentHash))]);
  store.events.emit('projects', { projectId, change: 'deleted' });
  return { deleted: { id: projectId, name: doc.name }, exportsRemoved: outputs.length, note: 'Media files are kept until storage clean-up is run, because other projects may use the same files.' };
}

/**
 * A failed or canceled import job (ADR-0023) stops pinning the file it received once it is dismissed or this old: a rejected
 * upload must not hold disk space forever. A retry after the file was cleaned up is refused with original_gone.
 */
export const IMPORT_JOB_PIN_MS = 7 * 24 * 3600_000;
/** Whether this job row still counts as a reference to the hashes it mentions. */
function jobPins(r: { type: string; status: string; output: string | null; error: string | null; updated_at: string }, now: number): boolean {
  if (r.type !== 'import' || (r.status !== 'failed' && r.status !== 'canceled')) return true;
  const parse = (t: string | null) => { try { return JSON.parse(t ?? 'null'); } catch { return null; } };
  if (parse(r.error)?.dismissed === true || parse(r.output)?.dismissed === true) return false;
  const at = Date.parse(r.updated_at);
  return !(Number.isFinite(at) && now - at >= IMPORT_JOB_PIN_MS);
}
/** Free bytes for this process on the volume that holds `dir` (statfs), or null when it cannot be measured here. */
export function freeDiskBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir);
    const n = Number(s.bavail) * Number(s.bsize);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Every 64-hex content hash mentioned by anything that still exists. */
function referencedHashes(store: Store, now = Date.now()): Set<string> {
  const out = new Set<string>();
  const scan = (text: string | null) => { if (text) for (const m of text.matchAll(/[0-9a-f]{64}/g)) out.add(m[0]); };
  const has = (table: string) => !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  for (const r of store.db.prepare('SELECT doc, initial_doc FROM projects').iterate() as Iterable<{ doc: string; initial_doc: string }>) { scan(r.doc); scan(r.initial_doc); }
  for (const r of store.db.prepare('SELECT ops FROM transactions').iterate() as Iterable<{ ops: string }>) scan(r.ops);
  for (const r of store.db.prepare('SELECT type, status, input, output, error, updated_at FROM jobs').iterate() as Iterable<{ type: string; status: string; input: string; output: string | null; error: string | null; updated_at: string }>) if (jobPins(r, now)) { scan(r.input); scan(r.output); }
  if (has('proposals')) for (const r of store.db.prepare('SELECT ops, changes FROM proposals').iterate() as Iterable<{ ops: string; changes: string | null }>) { scan(r.ops); scan(r.changes); }
  // Named versions (wave 7 craft) keep every file their copy names: a restore brings a removed clip's file back.
  if (has('project_versions')) for (const r of store.db.prepare('SELECT doc FROM project_versions').iterate() as Iterable<{ doc: string }>) scan(r.doc);
  // Derivatives (proxies, thumbnails, waveforms) live as long as the media they were made from.
  if (has('derivatives')) for (const r of store.db.prepare('SELECT asset_hash, blob_hash FROM derivatives').iterate() as Iterable<{ asset_hash: string; blob_hash: string | null }>) { const src = r.asset_hash.replace(/^sha256:/, ''); if (out.has(src) && r.blob_hash) out.add(r.blob_hash.replace(/^sha256:/, '')); }
  return out;
}

/** Bytes of every file under the data directory (media, derivatives, exports, temporary files, database). */
export function dataDirBytes(dir: string): number {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    try { n += e.isDirectory() ? dataDirBytes(p) : e.isFile() ? fs.statSync(p).size : 0; } catch { /* a file removed while walking */ }
  }
  return n;
}
/**
 * Refuse work that needs `neededBytes` more when the store's ceiling (`store.maxStorageBytes`) would be passed. No ceiling (0)
 * never refuses. Returns how much room is left (Infinity without a ceiling) so a streaming upload can be cut off at that point.
 * Call it from the function a REST route and its MCP tool both call (Exporter.start, makeElement, makeSfx, Speech.startNarration),
 * not from the route, so the agent tool is held to the same limit.
 */
export function assertStorageRoom(store: Store, neededBytes: number, what: string): number {
  const quotaBytes = store.maxStorageBytes;
  if (!quotaBytes) return Infinity;
  let usedBytes = dataDirBytes(store.dataDir);
  const hooks = hooksOf.get(store);
  // Derived data that can be made again (the render cache) gives room back first; then the directory is measured again.
  if (usedBytes + neededBytes > quotaBytes && hooks) {
    hooks.reclaim(neededBytes);
    usedBytes = dataDirBytes(store.dataDir);
  }
  if (usedBytes + neededBytes > quotaBytes)
    throw new ApiError(507, 'storage_quota_exceeded', `not enough room to ${what}: the storage ceiling is ${quotaBytes} bytes and ${usedBytes} are in use`, { quotaBytes, usedBytes, neededBytes }, 'Delete projects you no longer need and run the storage clean-up (owner: project manager → storage), or raise PF_MAX_STORAGE_BYTES.');
  return quotaBytes - usedBytes;
}
/**
 * The storage ceiling's ledger of uploads still arriving. Each holds a reservation: its declared size, or, for a stream of unknown
 * size (no Content-Length), the bytes received so far, growing as they arrive and refused (receiveOriginal's 507
 * storage_quota_exceeded, the partial file removed) as soon as the ceiling would be passed. The data directory is counted without
 * the uploads' partial files, so no byte is counted twice, and it is measured again whenever an upload starts or ends, so room an
 * upload took (stored, or reserved by one that started later) is never handed out a second time. Derived data that can be made
 * again (the render cache) gives room back before an upload is refused, as in assertStorageRoom.
 */
export class UploadLedger {
  private readonly live = new Set<UploadReservation>();
  /** Bytes under the data directory outside the partial files of live uploads, at the last start or end. */
  private base = 0;
  constructor(private readonly store: Store) {}
  /** Reserved bytes not yet on disk: what assertStorageRoom must add to the directory it measures for an upload that starts now. */
  outstanding(): number {
    let n = 0;
    for (const r of this.live) n += Math.max(0, r.claim - partialBytes(r.tmp));
    return n;
  }
  /** Registers an upload that streams into `tmp`, reserving `declared` bytes (0 for an unknown size: it grows with grow()). */
  open(tmp: string, declared: number | null): UploadReservation {
    const r: UploadReservation = { tmp, declared, claim: declared ?? 0, refused: false };
    this.live.add(r);
    this.measure();
    return r;
  }
  /** The upload has received `size` bytes in all: its reservation grows to them; refused when that would pass the ceiling. */
  grow(r: UploadReservation, size: number): { ok: true } | { ok: false; roomBytes: number } {
    if (r.refused) return { ok: false, roomBytes: 0 };
    const claim = Math.max(r.declared ?? 0, size);
    if (claim <= r.claim) return { ok: true };
    const quota = this.store.maxStorageBytes;
    if (!quota) { r.claim = claim; return { ok: true }; }
    const others = () => { let n = 0; for (const o of this.live) if (o !== r) n += o.claim; return n; };
    if (this.base + others() + claim > quota) {
      hooksOf.get(this.store)?.reclaim(this.base + others() + claim - quota);
      this.measure();
    }
    const room = quota - this.base - others();
    // refused: this upload ends here and its partial file goes, so it holds no room from now on (close() follows)
    if (claim > room) { r.claim = 0; r.declared = null; r.refused = true; return { ok: false, roomBytes: Math.max(0, room) }; }
    r.claim = claim;
    return { ok: true };
  }
  /** The upload ended (stored or refused): its reservation goes, and the directory is measured again with what it left there. */
  close(r: UploadReservation): void {
    this.live.delete(r);
    this.measure();
  }
  private measure() {
    if (!this.store.maxStorageBytes) return;
    // partial files first, the directory after: whatever arrives in between is counted (conservatively) in the base
    let partial = 0;
    for (const r of this.live) partial += partialBytes(r.tmp);
    this.base = Math.max(0, dataDirBytes(this.store.dataDir) - partial);
  }
}
export interface UploadReservation { readonly tmp: string; declared: number | null; claim: number; refused?: boolean }
const partialBytes = (file: string) => { try { return fs.statSync(file).size; } catch { return 0; } };

export function storageReport(store: Store, by: Principal, now = Date.now(), quotaBytes = store.maxStorageBytes) {
  ownerOnly(by, 'inspect storage');
  const refs = referencedHashes(store, now);
  const blobDir = path.join(store.dataDir, 'blobs');
  let used = 0, usedBytes = 0;
  const collectable: { hash: string; bytes: number }[] = [];
  let tooNew = 0;
  for (const name of fs.readdirSync(blobDir)) {
    if (!/^[0-9a-f]{64}$/.test(name)) continue;
    const st = fs.statSync(path.join(blobDir, name));
    if (refs.has(name)) { used++; usedBytes += st.size; }
    else if (now - st.mtimeMs < GRACE_MS) tooNew++;
    else collectable.push({ hash: name, bytes: st.size });
  }
  const dirBytes = (d: string) => (fs.existsSync(d) ? fs.readdirSync(d).reduce((n, f) => n + fs.statSync(path.join(d, f)).size, 0) : 0);
  return {
    projects: (store.db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n,
    databaseBytes: fs.statSync(path.join(store.dataDir, 'pulseframe.sqlite')).size,
    media: { files: used, bytes: usedBytes },
    exportsBytes: dirBytes(store.outDir),
    totalBytes: dataDirBytes(store.dataDir),
    quotaBytes: quotaBytes || null,
    ...(hooksOf.has(store) ? { renderCache: hooksOf.get(store)!.status() } : {}),
    unreferenced: { files: collectable.length, bytes: collectable.reduce((n, b) => n + b.bytes, 0), tooNewToJudge: tooNew, hashes: collectable.map((b) => b.hash) },
    rule: 'A file is unreferenced only if no remaining project (including its history), job or proposal mentions its content hash, and it is older than ten minutes. A failed or canceled import stops counting once it is dismissed or seven days old.',
  };
}

export function collectGarbage(store: Store, by: Principal, apply: boolean, now = Date.now()) {
  const report = storageReport(store, by, now);
  if (!apply) return { applied: false, wouldRemove: report.unreferenced, note: 'Nothing was removed. Send apply=true to remove these files.' };
  const has = !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'derivatives'").get();
  let removed = 0, bytes = 0;
  for (const hash of report.unreferenced.hashes) {
    const file = path.join(store.dataDir, 'blobs', hash);
    const size = fs.statSync(file).size;
    fs.rmSync(file, { force: true });
    store.db.prepare('DELETE FROM blobs WHERE hash IN (?, ?)').run(hash, `sha256:${hash}`);
    if (has) store.db.prepare('DELETE FROM derivatives WHERE asset_hash IN (?, ?) OR blob_hash IN (?, ?)').run(hash, `sha256:${hash}`, hash, `sha256:${hash}`);
    removed++; bytes += size;
  }
  // Picture search (wave 7): no project holds these files any more, so their vectors go too
  searchIndexMaybeGone(store, report.unreferenced.hashes.map((h) => (h.startsWith('sha256:') ? h : `sha256:${h}`)));
  return { applied: true, removed: { files: removed, bytes }, note: 'Removed files cannot be recovered.' };
}
