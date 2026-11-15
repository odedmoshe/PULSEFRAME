/**
 * Backup of a data directory that is safe while the server is running.
 * The database is copied with SQLite's online backup (a consistent snapshot, including writes still in the WAL);
 * media and finished exports are immutable files, copied if missing or different in size. Scratch files are skipped.
 * Restore = start a server with PF_DATA_DIR pointing at the copy (or copy it back while the server is stopped).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export interface BackupResult { dest: string; databaseBytes: number; filesCopied: number; filesSkipped: number; bytesCopied: number }

function copyTree(src: string, dest: string, r: BackupResult) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dest, e.name);
    if (e.isDirectory()) { copyTree(a, b, r); continue; }
    if (!e.isFile()) continue;
    const size = fs.statSync(a).size;
    if (fs.existsSync(b) && fs.statSync(b).size === size) { r.filesSkipped++; continue; } // content-addressed / finished files do not change
    fs.copyFileSync(a, `${b}.part`);
    fs.renameSync(`${b}.part`, b);
    r.filesCopied++; r.bytesCopied += size;
  }
}

export async function backupDataDir(src: string, dest: string): Promise<BackupResult> {
  const dbFile = path.join(src, 'pulseframe.sqlite');
  if (!fs.existsSync(dbFile)) throw new Error(`${src} is not a PULSEFRAME data directory (no pulseframe.sqlite)`);
  if (path.resolve(dest) === path.resolve(src) || path.resolve(dest).startsWith(path.resolve(src) + path.sep)) throw new Error('the backup destination must be outside the data directory');
  fs.mkdirSync(dest, { recursive: true, mode: 0o700 });
  const r: BackupResult = { dest: path.resolve(dest), databaseBytes: 0, filesCopied: 0, filesSkipped: 0, bytesCopied: 0 };
  // 1. database first: everything it refers to already exists on disk, and files are never modified afterwards
  const out = path.join(dest, 'pulseframe.sqlite');
  for (const stale of [out, `${out}-wal`, `${out}-shm`]) fs.rmSync(stale, { force: true });
  const db = new Database(dbFile, { readonly: true, fileMustExist: true });
  try { await db.backup(out); } finally { db.close(); }
  r.databaseBytes = fs.statSync(out).size;
  // 2. media (and their derivatives) and finished exports
  for (const d of ['blobs', 'out']) copyTree(path.join(src, d), path.join(dest, d), r);
  // 3. credentials
  const tokens = path.join(src, 'tokens.json');
  if (fs.existsSync(tokens)) { fs.copyFileSync(tokens, path.join(dest, 'tokens.json')); fs.chmodSync(path.join(dest, 'tokens.json'), 0o600); }
  return r;
}
