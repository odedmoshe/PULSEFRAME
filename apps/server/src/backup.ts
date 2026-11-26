/**
 * Backup of a data directory that is safe while the server is running.
 * The database is copied with SQLite's online backup (a consistent snapshot, including writes still in the WAL);
 * media and finished exports are immutable files, copied if missing or different in size. Scratch files are skipped.
 * Restore = start a server with PF_DATA_DIR pointing at the copy (or copy it back while the server is stopped).
 */
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { OWN_TEMPLATE_STORE } from '@pulseframe/core';
import { CONNECTORS_FILE } from './connectors/keys.ts';

/** The owner's own templates file (apps/server/src/ownTemplates.ts OWN_TEMPLATES_FILE; core OWN_TEMPLATE_STORE.file). */
const OWN_TEMPLATES_FILE = OWN_TEMPLATE_STORE.file;
/** The owner's rows of the agent's model table (agent/keys.ts AGENT_OWNER_MODELS_FILE; agentKeys.test.ts keeps them equal). */
export const AGENT_OWNER_MODELS_FILE = 'agent-models.json';

/**
 * Files of the data directory a backup never holds: the assistant's key and its config (assistant/contract.ts ASSISTANT_KEY_FILE,
 * ASSISTANT_CONFIG_FILE); the library folder setting and the library's derived index (library/contract.ts LIBRARY_CONFIG_FILE,
 * LIBRARY_INDEX_FILE): after a restore the state is «הספרייה לא מוגדרת»; the owner's review-booth answers (booth/contract.ts
 * OWNER_REVIEW_FILE: machine state of this computer, never carried to another); the in-editor agent's folder (agent/contract.ts
 * AGENT_DIR: provider keys, provider settings and the owner's model rows; wave 8 autonomy decision 3), a DIRECTORY, removed recursively;
 * the outside services' keys (connectors/keys.ts CONNECTORS_DIR: the Pixabay key, Openverse's client, Wikimedia's contact line; wave 8
 * sources C1), a DIRECTORY too.
 */
export const NEVER_BACKED_UP = ['assistant.key', 'assistant.json', 'library.json', 'library-index.sqlite', 'owner-review.json', 'agent', 'connectors'] as const;
export interface BackupResult { dest: string; /** Projects in the verified database copy. */ projects: number; databaseBytes: number; filesCopied: number; /** Newly copied media files whose content hash was checked against their name. */ filesVerified: number; filesSkipped: number; bytesCopied: number }

const sha256File = (file: string) => new Promise<string>((resolve, reject) => {
  const h = createHash('sha256');
  fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});

/**
 * Copy what is missing or different in size, without blocking the server (asynchronous copy and hashing).
 * A stored media file is named by the SHA-256 of its content, so every newly copied one is hashed and must match its name:
 * a file damaged at the source or in transit fails the backup instead of being kept as a good copy.
 */
async function copyTree(src: string, dest: string, r: BackupResult, root = src) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) { await copyTree(a, b, r, root); continue; }
    if (!e.isFile()) continue;
    const size = fs.statSync(a).size;
    if (fs.existsSync(b) && fs.statSync(b).size === size) { r.filesSkipped++; continue; } // content-addressed / finished files do not change
    const part = `${b}.part`;
    await fs.promises.copyFile(a, part);
    try {
      if (fs.statSync(part).size !== size) throw new Error(`short copy of ${path.relative(root, a)}`);
      if (/^[0-9a-f]{64}$/.test(e.name)) {
        const got = await sha256File(part);
        if (got !== e.name) throw new Error(`${path.relative(root, a)} does not match its content hash (the file is damaged at the source or was damaged while copying)`);
        r.filesVerified++;
      }
    } catch (err) { fs.rmSync(part, { force: true }); throw err; }
    fs.renameSync(part, b);
    r.filesCopied++; r.bytesCopied += size;
  }
}

export async function backupDataDir(src: string, dest: string): Promise<BackupResult> {
  const dbFile = path.join(src, 'pulseframe.sqlite');
  if (!fs.existsSync(dbFile)) throw new Error(`${src} is not a PULSEFRAME data directory (no pulseframe.sqlite)`);
  if (path.resolve(dest) === path.resolve(src) || path.resolve(dest).startsWith(path.resolve(src) + path.sep)) throw new Error('the backup destination must be outside the data directory');
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const r: BackupResult = { dest: path.resolve(dest), projects: 0, databaseBytes: 0, filesCopied: 0, filesVerified: 0, filesSkipped: 0, bytesCopied: 0 };
  // 1. database first: everything it refers to already exists on disk, and files are never modified afterwards
  const out = path.join(dest, 'pulseframe.sqlite');
  for (const stale of [out, `${out}-wal`, `${out}-shm`]) fs.rmSync(stale, { force: true });
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try { await db.backup(out); } finally { db.close(); }
  r.databaseBytes = fs.statSync(out).size;
  // Read the copy back: a backup that cannot be opened or fails SQLite's own integrity check is reported as a failure, not kept as if good.
  const copy = new Database(out, { readonly: true, fileMustExist: true });
  try {
    const verdict = copy.pragma('integrity_check', { simple: true });
    if (verdict !== 'ok') throw new Error(`the database copy failed its integrity check: ${String(verdict).slice(0, 200)}`);
    r.projects = (copy.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
  } finally { copy.close(); }
  // 2. media (and their derivatives) and finished exports
  for (const d of ['blobs', 'out']) await copyTree(path.join(src, d), path.join(dest, d), r);
  // 3. credentials
  const tokens = path.join(src, 'tokens.json');
  if (fs.existsSync(tokens)) { fs.copyFileSync(tokens, path.join(dest, 'tokens.json')); fs.chmodSync(path.join(dest, 'tokens.json'), 0o600); }
  // 3b. the owner's templates saved from their films (wave 8 owntemplate, verifier C1): owner work, nothing private by construction
  //     (built by whitelist). Copied EVERY time (tmp + rename), never by copyTree's size test: the file is rewritten in place and
  //     may keep its length. A destination copy is removed when the source has none, so a restore never brings back deleted ones.
  const own = path.join(src, OWN_TEMPLATES_FILE), ownOut = path.join(dest, OWN_TEMPLATES_FILE);
  if (fs.existsSync(own)) {
    const part = `${ownOut}.part`;
    fs.copyFileSync(own, part);
    try { fs.chmodSync(part, 0o600); } catch { /* Windows */ }
    fs.renameSync(part, ownOut);
  } else fs.rmSync(ownOut, { force: true });
  // 3c. the owner's rows of the agent's model table (wave 8 agent, lead's answer 5): the owner's edits, nothing secret; copied the
  //     same way. The keys and provider settings under agent/ are NOT copied (NEVER_BACKED_UP below).
  const models = path.join(src, AGENT_OWNER_MODELS_FILE), modelsOut = path.join(dest, AGENT_OWNER_MODELS_FILE);
  if (fs.existsSync(models)) { fs.copyFileSync(models, `${modelsOut}.part`); try { fs.chmodSync(`${modelsOut}.part`, 0o600); } catch { /* Windows */ } fs.renameSync(`${modelsOut}.part`, modelsOut); } else fs.rmSync(modelsOut, { force: true });
  // 3d. the outside services' settings (wave 8 sources, D8: connectors/keys.ts CONNECTORS_FILE; the download limit, no secret): copied
  //     every time like 3b (rewritten in place); removed from the destination when the source has none. Its keys are never copied (4).
  const con = path.join(src, CONNECTORS_FILE), conOut = path.join(dest, CONNECTORS_FILE);
  if (fs.existsSync(con)) {
    const part = `${conOut}.part`;
    fs.copyFileSync(con, part);
    try { fs.chmodSync(part, 0o600); } catch { /* Windows */ }
    fs.renameSync(part, conOut);
  } else fs.rmSync(conOut, { force: true });
  // 4. never: the language assistant's key and config (ADR-0027, lead decision 9) — the owner enters them again after a restore.
  //    Nothing above copies them; a copy left in the destination by hand is removed so a backup never holds one.
  for (const name of NEVER_BACKED_UP) fs.rmSync(path.join(dest, name), { force: true, recursive: true }); // 'agent' and 'connectors' are folders (C12; sources C1)
  return r;
}

export interface VerifyResult { dir: string; databases: { file: string; ok: boolean; projects: number | null; error?: string }[]; mediaChecked: number; mediaDamaged: string[]; mediaMissing: string[]; ok: boolean }

/**
 * Check an existing backup without changing it: every database in it (the current one and each dated snapshot) must open and
 * pass SQLite's integrity check; every stored media file must match the content hash it is named by; and every media file the
 * current database refers to must be present. This re-reads all media, so it takes as long as hashing the whole backup.
 */
export async function verifyBackup(dir: string): Promise<VerifyResult> {
  const main = path.join(dir, 'pulseframe.sqlite');
  if (!fs.existsSync(main)) throw new Error(`${dir} is not a PULSEFRAME backup (no pulseframe.sqlite)`);
  const r: VerifyResult = { dir: path.resolve(dir), databases: [], mediaChecked: 0, mediaDamaged: [], mediaMissing: [], ok: false };
  const referenced = new Set<string>();
  for (const file of [main, ...listSnapshots(dir).map((n) => path.join(dir, 'snapshots', n))]) {
    const rel = path.relative(dir, file);
    try {
      const db = new Database(file, { readonly: true, fileMustExist: true });
      try {
        const verdict = db.pragma('integrity_check', { simple: true });
        if (verdict !== 'ok') throw new Error(`integrity check: ${String(verdict).slice(0, 160)}`);
        const projects = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
        if (file === main) for (const row of db.prepare('SELECT hash FROM blobs').all() as { hash: string }[]) referenced.add(row.hash.replace(/^sha256:/, ''));
        r.databases.push({ file: rel, ok: true, projects });
      } finally { db.close(); }
    } catch (e) { r.databases.push({ file: rel, ok: false, projects: null, error: String(e instanceof Error ? e.message : e).slice(0, 200) }); }
  }
  const blobs = path.join(dir, 'blobs');
  const present = new Set<string>();
  if (fs.existsSync(blobs))
    for (const e of fs.readdirSync(blobs, { withFileTypes: true })) {
      if (!e.isFile() || !/^[0-9a-f]{64}$/.test(e.name)) continue;
      present.add(e.name);
      r.mediaChecked++;
      if ((await sha256File(path.join(blobs, e.name))) !== e.name) r.mediaDamaged.push(e.name);
    }
  for (const h of referenced) if (!present.has(h)) r.mediaMissing.push(h);
  r.ok = r.databases.every((d) => d.ok) && r.mediaDamaged.length === 0 && r.mediaMissing.length === 0;
  return r;
}

export interface PruneResult { dir: string; kept: number; unreferenced: { files: number; bytes: number }; removed: boolean }

/**
 * Media in a backup that no database in it knows about any more (not the current one, not any retained snapshot): files left
 * behind after storage clean-up on the live installation and after old snapshots were dropped. Reports them; removes them only
 * with `apply`. A file is kept if ANY database in the backup lists it, so every retained snapshot stays restorable.
 * Refuses to act when a database in the backup cannot be read (it could not tell what that database needs).
 */
export function pruneBackup(dir: string, apply = false): PruneResult {
  const main = path.join(dir, 'pulseframe.sqlite');
  if (!fs.existsSync(main)) throw new Error(`${dir} is not a PULSEFRAME backup (no pulseframe.sqlite)`);
  const needed = new Set<string>();
  for (const file of [main, ...listSnapshots(dir).map((n) => path.join(dir, 'snapshots', n))]) {
    let db: Database.Database;
    try { db = new Database(file, { readonly: true, fileMustExist: true }); } catch (e) { throw new Error(`${path.relative(dir, file)} cannot be opened, so nothing was removed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`); }
    try { for (const row of db.prepare('SELECT hash FROM blobs').all() as { hash: string }[]) needed.add(row.hash.replace(/^sha256:/, '')); }
    catch (e) { throw new Error(`${path.relative(dir, file)} cannot be read, so nothing was removed: ${String(e instanceof Error ? e.message : e).slice(0, 160)}`); }
    finally { db.close(); }
  }
  const blobs = path.join(dir, 'blobs');
  const r: PruneResult = { dir: path.resolve(dir), kept: 0, unreferenced: { files: 0, bytes: 0 }, removed: false };
  if (!fs.existsSync(blobs)) return r;
  const extra: string[] = [];
  for (const e of fs.readdirSync(blobs, { withFileTypes: true })) {
    if (!e.isFile() || !/^[0-9a-f]{64}$/.test(e.name)) continue;
    if (needed.has(e.name)) { r.kept++; continue; }
    r.unreferenced.files++; r.unreferenced.bytes += fs.statSync(path.join(blobs, e.name)).size;
    extra.push(e.name);
  }
  if (apply) { for (const n of extra) fs.rmSync(path.join(blobs, n), { force: true }); r.removed = true; }
  return r;
}

/** Name of a dated database snapshot; sorts by time. */
const snapName = (at: number) => `pulseframe-${new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.sqlite`;
const SNAP_RE = /^pulseframe-\d{8}T\d{6}Z\.sqlite$/;
export const listSnapshots = (dest: string): string[] => {
  const d = path.join(dest, 'snapshots');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((n) => SNAP_RE.test(n)).sort() : [];
};

/**
 * A backup with history: the destination is a restorable data directory (as `backupDataDir` leaves it) plus
 * `snapshots/pulseframe-<UTC time>.sqlite`, one database per run, of which the newest `keep` are retained.
 * Media and exports in the destination are never deleted by this, so every retained snapshot finds its files.
 * To go back to an older state: stop the server and copy that snapshot over `pulseframe.sqlite` in the copy.
 */
export async function backupWithHistory(src: string, dest: string, keep: number, now = Date.now()): Promise<BackupResult & { snapshot: string; snapshots: string[]; removed: string[] }> {
  const r = await backupDataDir(src, dest);
  const dir = path.join(dest, 'snapshots');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const snapshot = snapName(now);
  fs.copyFileSync(path.join(dest, 'pulseframe.sqlite'), path.join(dir, `${snapshot}.part`));
  fs.renameSync(path.join(dir, `${snapshot}.part`), path.join(dir, snapshot));
  const all = listSnapshots(dest);
  const removed = all.slice(0, Math.max(0, all.length - Math.max(1, Math.floor(keep))));
  for (const n of removed) fs.rmSync(path.join(dir, n), { force: true });
  return { ...r, snapshot, snapshots: listSnapshots(dest), removed };
}

export interface BackupStatus { enabled: boolean; everyHours: number; keep: number; lastAt: number | null; lastOk: boolean | null; lastError: string | null; nextAt: number | null; snapshots: number; running: boolean }

/** Runs `backupWithHistory` on an interval while the server is up. A failed run is recorded and retried at the next interval; it never stops the server. */
export class BackupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;
  private last: { at: number; ok: boolean; error: string | null } | null = null;
  private nextAt: number | null = null;
  constructor(private src: string, private dest: string | null, private everyHours: number, private keep: number, private log: (m: string) => void = (m) => console.error(m)) {
    if (dest) { // refuse a bad destination at start, not at the first run hours later
      const s = path.resolve(src), d = path.resolve(dest);
      if (d === s || d.startsWith(s + path.sep)) throw new Error('PF_BACKUP_DIR must be outside the data directory');
    }
  }
  get enabled() { return !!this.dest && this.everyHours > 0; }
  start() {
    if (!this.enabled || this.timer) return;
    const ms = this.everyHours * 3600_000;
    // the first run is due one interval after the newest existing snapshot (immediately if there is none or it is older)
    const newest = listSnapshots(this.dest!).at(-1);
    const m = newest?.match(/^pulseframe-(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/);
    const newestAt = m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : 0;
    const schedule = (delay: number) => {
      this.nextAt = Date.now() + delay;
      this.timer = setTimeout(() => { void this.runNow().finally(() => { if (this.timer) schedule(ms); }); }, delay);
      this.timer.unref();
    };
    schedule(Math.min(ms, Math.max(1000, newestAt + ms - Date.now())));
  }
  /** Run a backup now (also used by the timer). Concurrent calls share one run. */
  runNow(): Promise<void> {
    if (!this.dest) return Promise.reject(new Error('no backup destination is configured (PF_BACKUP_DIR)'));
    this.current ??= backupWithHistory(this.src, this.dest, this.keep).then(
      () => { this.last = { at: Date.now(), ok: true, error: null }; },
      (e) => { this.last = { at: Date.now(), ok: false, error: String(e instanceof Error ? e.message : e) }; this.log(`[backup] failed: ${this.last.error}`); },
    ).finally(() => { this.current = null; });
    return this.current;
  }
  status(): BackupStatus {
    return { enabled: this.enabled, everyHours: this.everyHours, keep: this.keep, lastAt: this.last?.at ?? null, lastOk: this.last?.ok ?? null, lastError: this.last?.error ?? null, nextAt: this.timer ? this.nextAt : null, snapshots: this.dest ? listSnapshots(this.dest).length : 0, running: !!this.current };
  }
  async stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; await this.current; }
}
