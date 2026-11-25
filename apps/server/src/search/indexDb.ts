/**
 * The picture index of «חיפוש בצילומים» (wave 7 search track; decisions §2, §3 items 14–15). The ONLY place a picture vector is kept:
 * <dataDir>/search/index.sqlite (folder 0700, file 0600, WAL, secure_delete=ON), keyed by (content hash, embedder, frame). Never in
 * pulseframe.sqlite, a backup (backup.ts copies named files only) or an archive.
 *
 * - A file's rows are written in ONE transaction with its `files` row, so a file is either complete or absent (resume = the first file
 *   without a `files` row). replaceFile calls `stillWanted(hash)` synchronously INSIDE that transaction, with no await between the check
 *   and the write: a file removed from every project while its scan ran is never written back (the deletion listener runs on the same
 *   thread, either before the check — then nothing is written — or after the write — then it deletes the rows).
 * - Deleting rows overwrites their bytes (secure_delete) and folds and cuts the write-ahead log afterwards (wal_checkpoint TRUNCATE), so
 *   a planted byte pattern is gone from index.sqlite and its WAL. Not promised: what a filesystem keeps of blocks it has freed.
 * - Nothing here is ever put into an answer, a job, an event or a log: callers get counts, or vectors for ranking inside the process.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SEARCH_INDEX_DIR } from './contract.ts';

export const INDEX_FILE = 'index.sqlite';
export interface FileMeta {
  contentHash: string;
  embedder: string;
  /** the decoded source: the proxy (1:1 frames) or the stored original */
  source: 'proxy' | 'original';
  frameCount: number;
  rate: { num: number; den: number };
}
export interface Sample { frame: number; scale: number; q: Int8Array }
export interface StoredSample { contentHash: string; frame: number; scale: number; q: Int8Array }
export interface FileInfo { contentHash: string; embedder: string; samples: number; bytes: number }

export const indexPathOf = (dataDir: string) => path.join(dataDir, SEARCH_INDEX_DIR, INDEX_FILE);

export class SearchIndexDb {
  readonly file: string;
  private db: Database.Database;
  private constructor(file: string) {
    this.file = file;
    const fresh = !fs.existsSync(file);
    this.db = new Database(file);
    if (fresh) fs.chmodSync(file, 0o600);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.pragma('secure_delete = ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (content_hash TEXT NOT NULL, embedder TEXT NOT NULL, source TEXT NOT NULL, frame_count INTEGER NOT NULL,
        rate_num INTEGER NOT NULL, rate_den INTEGER NOT NULL, samples INTEGER NOT NULL, bytes INTEGER NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (content_hash, embedder));
      CREATE TABLE IF NOT EXISTS samples (content_hash TEXT NOT NULL, embedder TEXT NOT NULL, frame INTEGER NOT NULL, scale REAL NOT NULL, q BLOB NOT NULL,
        PRIMARY KEY (content_hash, embedder, frame));
    `);
    for (const f of [`${file}-wal`, `${file}-shm`]) { try { fs.chmodSync(f, 0o600); } catch { /* not there yet */ } }
  }
  /** Open (creating the folder 0700 and the file 0600). */
  static open(dataDir: string): SearchIndexDb {
    const dir = path.join(dataDir, SEARCH_INDEX_DIR);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    return new SearchIndexDb(path.join(dir, INDEX_FILE));
  }
  /** Open only when the file exists (readers and deleters never create it). */
  static openIfExists(dataDir: string): SearchIndexDb | null {
    return fs.existsSync(indexPathOf(dataDir)) ? SearchIndexDb.open(dataDir) : null;
  }

  /**
   * Write one complete file (its earlier rows for this embedder replaced) IF `stillWanted(contentHash)` is true at the moment of the
   * write. The callback runs synchronously inside the write transaction (no await between check and write). Returns whether it wrote;
   * when it did not, any earlier rows of the hash are deleted too (the file left every project).
   */
  replaceFile(meta: FileMeta, samples: readonly Sample[], stillWanted: (contentHash: string) => boolean): boolean {
    let wrote = false;
    this.db.transaction(() => {
      if (!stillWanted(meta.contentHash)) {
        this.db.prepare('DELETE FROM samples WHERE content_hash = ?').run(meta.contentHash);
        this.db.prepare('DELETE FROM files WHERE content_hash = ?').run(meta.contentHash);
        return;
      }
      this.db.prepare('DELETE FROM samples WHERE content_hash = ? AND embedder = ?').run(meta.contentHash, meta.embedder);
      const ins = this.db.prepare('INSERT INTO samples (content_hash, embedder, frame, scale, q) VALUES (?,?,?,?,?)');
      let bytes = 0;
      for (const s of samples) {
        ins.run(meta.contentHash, meta.embedder, s.frame, s.scale, Buffer.from(s.q.buffer, s.q.byteOffset, s.q.byteLength));
        bytes += s.q.byteLength + 8;
      }
      this.db.prepare(`INSERT INTO files (content_hash, embedder, source, frame_count, rate_num, rate_den, samples, bytes, created_at) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(content_hash, embedder) DO UPDATE SET source = excluded.source, frame_count = excluded.frame_count, rate_num = excluded.rate_num,
        rate_den = excluded.rate_den, samples = excluded.samples, bytes = excluded.bytes, created_at = excluded.created_at`)
        .run(meta.contentHash, meta.embedder, meta.source, meta.frameCount, meta.rate.num, meta.rate.den, samples.length, bytes, new Date().toISOString());
      wrote = true;
    })();
    return wrote;
  }

  /** Complete files of these hashes (every embedder). */
  files(hashes: readonly string[]): FileInfo[] {
    if (!hashes.length) return [];
    const out: FileInfo[] = [];
    const st = this.db.prepare('SELECT content_hash, embedder, samples, bytes FROM files WHERE content_hash = ?');
    for (const h of new Set(hashes)) for (const r of st.all(h) as { content_hash: string; embedder: string; samples: number; bytes: number }[]) out.push({ contentHash: r.content_hash, embedder: r.embedder, samples: r.samples, bytes: r.bytes });
    return out;
  }
  hasFile(contentHash: string, embedder: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM files WHERE content_hash = ? AND embedder = ?').get(contentHash, embedder);
  }
  /** The stored frame indices of a complete file, ascending (checks: they equal the sampled targets). */
  framesOf(contentHash: string, embedder: string): number[] {
    return (this.db.prepare('SELECT frame FROM samples WHERE content_hash = ? AND embedder = ? ORDER BY frame').all(contentHash, embedder) as { frame: number }[]).map((r) => r.frame);
  }
  /** Sample rows of any state for a hash (the "no partial rows" checks count them). */
  sampleCount(contentHash: string): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM samples WHERE content_hash = ?').get(contentHash) as { n: number }).n;
  }
  /** Vectors of complete files for ranking, inside the process only. */
  vectors(hashes: readonly string[], embedder: string): StoredSample[] {
    const out: StoredSample[] = [];
    const st = this.db.prepare('SELECT s.frame, s.scale, s.q FROM samples s JOIN files f ON f.content_hash = s.content_hash AND f.embedder = s.embedder WHERE s.content_hash = ? AND s.embedder = ? ORDER BY s.frame');
    for (const h of new Set(hashes))
      for (const r of st.all(h, embedder) as { frame: number; scale: number; q: Buffer }[]) out.push({ contentHash: h, frame: r.frame, scale: r.scale, q: new Int8Array(r.q.buffer, r.q.byteOffset, r.q.byteLength) });
    return out;
  }
  /** Delete every row of these hashes (all embedders); the freed bytes are overwritten and the WAL cut. */
  deleteHashes(hashes: readonly string[]): { files: number; bytes: number } {
    const uniq = [...new Set(hashes)];
    if (!uniq.length) return { files: 0, bytes: 0 };
    const res = { files: 0, bytes: 0 };
    this.db.transaction(() => {
      for (const h of uniq) {
        const r = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM files WHERE content_hash = ?').get(h) as { n: number; b: number };
        res.files += r.n; res.bytes += r.b;
        this.db.prepare('DELETE FROM samples WHERE content_hash = ?').run(h);
        this.db.prepare('DELETE FROM files WHERE content_hash = ?').run(h);
      }
    })();
    this.checkpoint();
    return res;
  }
  /** Counts of everything (for forgetting all). */
  totals(): { files: number; bytes: number } {
    const r = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b FROM files').get() as { n: number; b: number };
    return { files: r.n, bytes: r.b };
  }
  checkpoint(): void {
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort: the next one folds it */ }
  }
  close(): void {
    this.checkpoint();
    this.db.close();
  }
}

/** Remove the index files outright (forget everything): the database, its WAL and shared memory. */
export function removeIndexFiles(dataDir: string): void {
  const f = indexPathOf(dataDir);
  for (const x of [f, `${f}-wal`, `${f}-shm`, `${f}-journal`]) fs.rmSync(x, { force: true });
}
