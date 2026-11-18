/**
 * The render cache's segment store (ADR-0024, plan §6 with the verifier's corrections): content-addressed H.264 segments in
 * `<dataDir>/render-cache/<key[0..2]>/<key>.mp4` with a sidecar `<key>.side` (magic 'PFSEG1\n', u32le header length, SegmentMeta
 * JSON, cells blob from cellsCodec.ts), indexed in its OWN SQLite file `<dataDir>/render-cache/index.sqlite` (tables
 * render_segments, render_segment_projects, render_cache_meta, created by the store itself; nothing in store.ts). A restored
 * backup therefore starts with an empty, consistent cache: backups copy blobs and out only.
 *
 * Counted against the storage ceiling because dataDirBytes walks the data directory. Least-recently-used eviction; pinned keys
 * (this export's reused and freshly put segments) are never evicted or cleared. `usedBytes` counts the segment files (video and
 * sidecar) only; the small index file is outside it, so `quota().otherBytes` should be the data directory's bytes minus
 * `status().usedBytes` (the index then counts as other bytes and nothing is counted twice or missed).
 *
 * Writes are crash-safe in this order: temp name inside the store directory, fsync, rename, then the index row in one SQLite
 * transaction. A crash between them leaves files without a row, which reconcile() (run at construction) removes.
 *
 * The lead registers the store with storage.ts setStorageHooks (reclaim = trim, purgeProject, status) when it wires the route.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { EngineFingerprint, RenderCacheStatus } from '@pulseframe/core';
import type { FlashCells } from '@pulseframe/engine';
import { decodeCells, encodeCells } from './cellsCodec.ts';

export const RENDER_CACHE_DIR = 'render-cache';
export const SEGMENT_SIDECAR_MAGIC = 'PFSEG1\n';
const INDEX_FILE = 'index.sqlite';
const TMP_PREFIX = '.tmp-';
const KEY_RE = /^[0-9a-f]{64}$/;

export interface SegmentMeta {
  v: 1;
  key: string;
  frames: number;
  width: number;
  height: number;
  videoBytes: number;
  videoSha256: string;
  /** SHA-256 of each frame's raw RGBA as the page delivered it, in order (the self-check compares against these). */
  rgbaSha256: string[];
  /** First video packet's PTS − DTS in track ticks: every segment joined into one file must have the same (verifier: 1–2 frame segments differ). */
  ptsOffsetTicks: number;
  cellsBytes: number;
  createdAt: number;
  renderMs: number;
}
export interface SegmentHandle { key: string; videoPath: string; meta: SegmentMeta }
/** Keys held for one export: never evicted or cleared until released. `put` adds the keys it stores to the caller's pin. */
export interface SegmentPin { readonly keys: ReadonlySet<string>; add(key: string): void; release(): void }

export interface SegmentStoreOptions {
  /** `<dataDir>/render-cache`; created when missing. The index lives in `<dir>/index.sqlite`. */
  dir: string;
  capBytes: number;
  autoClear: boolean;
  minFreeBytes: number;
  /** quotaBytes: the data-directory ceiling (0 = none); otherBytes: bytes in the data directory outside this store. */
  quota(): { quotaBytes: number; otherBytes: number };
  /** Free bytes on the disk that holds `dir`; default fs.statfsSync. */
  freeDiskBytes?(): number;
  now?(): number;
}
export interface SegmentPutInput {
  /** The encoded segment, in the job's work directory; moved in atomically (temp name inside the store, fsync, rename). */
  videoFile: string;
  frames: number;
  width: number;
  height: number;
  rgbaSha256: string[];
  ptsOffsetTicks: number;
  cells: FlashCells[];
  renderMs: number;
  projectId: string;
}

interface Row { key: string; bytes: number; frames: number; width: number; height: number; created_at: number; last_used_at: number; verified_at: number; render_ms: number }

const sha256File = (file: string): Promise<string> => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
});
function fsyncPath(p: string, dir = false) {
  let fd: number | null = null;
  try { fd = fs.openSync(p, dir ? 'r' : 'r+'); fs.fsyncSync(fd); } catch { /* a directory fsync is best effort (not every platform allows it) */ } finally { if (fd !== null) fs.closeSync(fd); }
}
/** Sidecar bytes: magic, u32le header length, SegmentMeta JSON, cells blob. */
function sidecarBytes(meta: SegmentMeta, cells: Uint8Array): Buffer {
  const json = Buffer.from(JSON.stringify(meta), 'utf8');
  const len = Buffer.alloc(4); len.writeUInt32LE(json.length, 0);
  return Buffer.concat([Buffer.from(SEGMENT_SIDECAR_MAGIC, 'latin1'), len, json, cells]);
}
function parseSidecar(b: Buffer): { meta: SegmentMeta; cells: Buffer } {
  const m = SEGMENT_SIDECAR_MAGIC.length;
  if (b.length < m + 4 || b.toString('latin1', 0, m) !== SEGMENT_SIDECAR_MAGIC) throw new Error('not a segment sidecar');
  const n = b.readUInt32LE(m);
  if (m + 4 + n > b.length) throw new Error('sidecar header runs past the file');
  const meta = JSON.parse(b.toString('utf8', m + 4, m + 4 + n)) as SegmentMeta;
  return { meta, cells: b.subarray(m + 4 + n) };
}

export class SegmentStore {
  private readonly opts: SegmentStoreOptions;
  private readonly db: Database.Database;
  /** key -> number of live pins holding it. */
  private readonly pins = new Map<string, number>();
  private highWater = 0;
  private readonly now: () => number;

  constructor(opts: SegmentStoreOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
    fs.mkdirSync(opts.dir, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(opts.dir, INDEX_FILE));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = FULL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS render_segments (key TEXT PRIMARY KEY, bytes INTEGER NOT NULL, frames INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
        created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, verified_at INTEGER NOT NULL, render_ms INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS render_segments_lru ON render_segments(last_used_at, created_at, key);
      CREATE TABLE IF NOT EXISTS render_segment_projects (key TEXT NOT NULL, project_id TEXT NOT NULL, PRIMARY KEY (key, project_id));
      CREATE INDEX IF NOT EXISTS render_segment_projects_project ON render_segment_projects(project_id);
      CREATE TABLE IF NOT EXISTS render_cache_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.reconcile();
    this.highWater = this.usedBytes();
  }

  // ---------- paths ----------
  private subdir(key: string) { return path.join(this.opts.dir, key.slice(0, 2)); }
  videoPath(key: string) { return path.join(this.subdir(key), `${key}.mp4`); }
  private sidePath(key: string) { return path.join(this.subdir(key), `${key}.side`); }
  private row(key: string): Row | undefined { return this.db.prepare('SELECT * FROM render_segments WHERE key = ?').get(key) as Row | undefined; }
  private usedBytes(): number { return (this.db.prepare('SELECT COALESCE(SUM(bytes), 0) AS n FROM render_segments').get() as { n: number }).n; }
  private pinnedBytes(): number {
    let n = 0;
    for (const k of this.pins.keys()) n += this.row(k)?.bytes ?? 0;
    return n;
  }
  private freeDisk(): number {
    if (this.opts.freeDiskBytes) return this.opts.freeDiskBytes();
    try { const s = fs.statfsSync(this.opts.dir); return Number(s.bavail) * Number(s.bsize); } catch { return Infinity; }
  }
  /**
   * The most bytes the store may hold now, keeping `reserveBytes` free for other work: min(cap, ceiling − other − reserve,
   * autoClear ? bytes + free − minFree : ∞). Without a ceiling (quotaBytes 0) its term is ∞, so an ordinary machine with no
   * ceiling keeps everything up to the cap.
   */
  private limit(reserveBytes: number, used: number): number {
    const { quotaBytes, otherBytes } = this.opts.quota();
    const ceiling = quotaBytes > 0 ? quotaBytes - otherBytes - reserveBytes : Infinity;
    const disk = this.opts.autoClear ? used + this.freeDisk() - this.opts.minFreeBytes : Infinity;
    return Math.min(this.opts.capBytes, ceiling, disk);
  }
  /** Removes files and rows of these keys (pinned or not: callers decide). */
  private remove(keys: readonly string[]): { removed: number; bytes: number } {
    let removed = 0, bytes = 0;
    for (const key of keys) {
      const r = this.row(key);
      for (const f of [this.videoPath(key), this.sidePath(key)]) fs.rmSync(f, { force: true });
      if (!r) continue;
      this.db.transaction(() => {
        this.db.prepare('DELETE FROM render_segments WHERE key = ?').run(key);
        this.db.prepare('DELETE FROM render_segment_projects WHERE key = ?').run(key);
      })();
      removed++; bytes += r.bytes;
    }
    return { removed, bytes };
  }
  /** Evict unpinned entries, least recently used first, until the store holds at most `target` bytes. */
  private evictTo(target: number): { evicted: number; bytes: number } {
    let used = this.usedBytes();
    let evicted = 0, bytes = 0;
    if (used <= target) return { evicted, bytes };
    for (const r of this.db.prepare('SELECT key, bytes FROM render_segments ORDER BY last_used_at, created_at, key').all() as Pick<Row, 'key' | 'bytes'>[]) {
      if (used <= target) break;
      if (this.pins.has(r.key)) continue;
      const x = this.remove([r.key]);
      evicted += x.removed; bytes += x.bytes; used -= x.bytes;
    }
    return { evicted, bytes };
  }

  /** usedBytes, segments, cap, high-water mark (bytes), autoClear, minFreeBytes; `enabled` = capBytes > 0. */
  status(): RenderCacheStatus {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM render_segments').get() as { n: number };
    const usedBytes = this.usedBytes();
    this.highWater = Math.max(this.highWater, usedBytes);
    return { enabled: this.opts.capBytes > 0, capBytes: this.opts.capBytes, usedBytes, segments: n, highWaterBytes: this.highWater, autoClear: this.opts.autoClear, minFreeBytes: this.opts.minFreeBytes };
  }
  has(key: string): boolean { return KEY_RE.test(key) && !!this.row(key); }

  /** Reads and checks the sidecar against the row; null when anything disagrees. */
  private readEntry(key: string): { row: Row; meta: SegmentMeta; cells: Buffer } | null {
    const row = this.row(key);
    if (!row) return null;
    try {
      const { meta, cells } = parseSidecar(fs.readFileSync(this.sidePath(key)));
      const videoBytes = fs.statSync(this.videoPath(key)).size;
      const sideBytes = fs.statSync(this.sidePath(key)).size;
      const ok = meta.v === 1 && meta.key === key && meta.frames === row.frames && meta.width === row.width && meta.height === row.height
        && meta.videoBytes === videoBytes && videoBytes + sideBytes === row.bytes && Array.isArray(meta.rgbaSha256) && meta.rgbaSha256.length === meta.frames
        && meta.cellsBytes === cells.length && Number.isInteger(meta.ptsOffsetTicks);
      return ok ? { row, meta, cells } : null;
    } catch {
      return null;
    }
  }
  /**
   * verify: re-hash the video against the sidecar and check the header key, sizes and frame count, and that the cells decode
   * to one grid per frame; a damaged entry is dropped and null returned. An unknown key is null (a miss), never an error.
   */
  async open(key: string, opts: { verify: boolean }): Promise<SegmentHandle | null> {
    if (!this.has(key)) return null;
    const e = this.readEntry(key);
    let ok = !!e;
    if (e && opts.verify) {
      try {
        ok = (await sha256File(this.videoPath(key))) === e.meta.videoSha256 && decodeCells(e.cells).length === e.meta.frames;
      } catch { ok = false; }
    }
    if (!ok || !e) { if (this.row(key)) this.remove([key]); return null; }
    return { key, videoPath: this.videoPath(key), meta: e.meta };
  }
  readCellsSync(key: string): FlashCells[] {
    const e = this.readEntry(key);
    if (!e) throw new Error(`render cache: segment ${key} is missing or damaged`);
    const cells = decodeCells(e.cells);
    if (cells.length !== e.meta.frames) throw new Error(`render cache: segment ${key} has cells for ${cells.length} of ${e.meta.frames} frames`);
    return cells;
  }
  async readCells(key: string): Promise<FlashCells[]> { return this.readCellsSync(key); }

  /**
   * Stores the segment and adds its key to `pin`. Returns null — never throws for lack of room — when no room can be made within
   * the cap, the ceiling and the minimum-free rule: the caller then joins from its work directory and counts it in notStored.
   * The room check counts the whole entry (video and sidecar) as new bytes on the disk and under the ceiling, which is
   * conservative: the video is renamed from the work directory, so it may already be counted there.
   * The minimum-free rule always holds for a put; auto-clear decides only whether other entries are evicted to keep it.
   */
  async put(key: string, input: SegmentPutInput, pin: SegmentPin): Promise<SegmentHandle | null> {
    if (!KEY_RE.test(key)) throw new Error(`render cache: bad segment key ${key}`);
    if (input.rgbaSha256.length !== input.frames || input.cells.length !== input.frames) throw new Error(`render cache: segment ${key} has ${input.rgbaSha256.length} hashes and ${input.cells.length} cell grids for ${input.frames} frames`);
    if (this.has(key)) {
      // Content-addressed: the same key holds the same frames. Keep the stored one.
      const h = await this.open(key, { verify: false });
      if (h) {
        pin.add(key);
        this.db.prepare('INSERT OR IGNORE INTO render_segment_projects (key, project_id) VALUES (?, ?)').run(key, input.projectId);
        return h;
      }
    }
    if (this.opts.capBytes <= 0) return null;
    const videoBytes = fs.statSync(input.videoFile).size;
    const videoSha256 = await sha256File(input.videoFile);
    const cellsBlob = encodeCells(input.cells);
    const createdAt = this.now();
    const meta: SegmentMeta = { v: 1, key, frames: input.frames, width: input.width, height: input.height, videoBytes, videoSha256, rgbaSha256: input.rgbaSha256, ptsOffsetTicks: input.ptsOffsetTicks, cellsBytes: cellsBlob.length, createdAt, renderMs: Math.round(input.renderMs) };
    const side = sidecarBytes(meta, cellsBlob);
    const need = videoBytes + side.length;
    // Room: after evicting unpinned entries, bytes + need must stay within the cap, the ceiling (other + bytes + need <= quota)
    // and, with auto-clear, the free disk (free + evicted − need >= minFree, i.e. bytes + need <= bytes now + free − minFree).
    // Refuse (null) when the pinned entries alone leave no room.
    const used = this.usedBytes();
    const { quotaBytes, otherBytes } = this.opts.quota();
    const free = this.freeDisk();
    const maxAfter = Math.min(
      this.opts.capBytes,
      quotaBytes > 0 ? quotaBytes - otherBytes : Infinity,
      this.opts.autoClear ? used + free - this.opts.minFreeBytes : Infinity,
    );
    if (!this.opts.autoClear && free - need < this.opts.minFreeBytes) return null;
    if (this.pinnedBytes() + need > maxAfter) return null;
    this.evictTo(maxAfter - need);
    if (this.usedBytes() + need > maxAfter) return null;

    const sub = this.subdir(key);
    fs.mkdirSync(sub, { recursive: true, mode: 0o700 });
    const tag = randomBytes(6).toString('hex');
    const tmpVideo = path.join(sub, `${TMP_PREFIX}${tag}.mp4`), tmpSide = path.join(sub, `${TMP_PREFIX}${tag}.side`);
    try {
      try { fs.renameSync(input.videoFile, tmpVideo); } catch (e: any) { if (e?.code !== 'EXDEV') throw e; fs.copyFileSync(input.videoFile, tmpVideo); fs.rmSync(input.videoFile, { force: true }); }
      fsyncPath(tmpVideo);
      fs.writeFileSync(tmpSide, side);
      fsyncPath(tmpSide);
      fs.renameSync(tmpVideo, this.videoPath(key));
      fs.renameSync(tmpSide, this.sidePath(key));
      fsyncPath(sub, true);
    } catch (e) {
      // Give the caller its file back when it was moved, so the export can still join from the work directory.
      if (!fs.existsSync(input.videoFile)) for (const f of [tmpVideo, this.videoPath(key)]) if (fs.existsSync(f)) { try { fs.renameSync(f, input.videoFile); break; } catch { /* left for reconcile */ } }
      for (const f of [tmpVideo, tmpSide]) fs.rmSync(f, { force: true });
      throw e;
    }
    const t = this.now();
    this.db.transaction(() => {
      this.db.prepare('INSERT OR REPLACE INTO render_segments (key, bytes, frames, width, height, created_at, last_used_at, verified_at, render_ms) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)')
        .run(key, need, input.frames, input.width, input.height, createdAt, t, Math.round(input.renderMs));
      this.db.prepare('INSERT OR IGNORE INTO render_segment_projects (key, project_id) VALUES (?, ?)').run(key, input.projectId);
    })();
    pin.add(key);
    this.highWater = Math.max(this.highWater, this.usedBytes());
    return { key, videoPath: this.videoPath(key), meta };
  }
  /** Marks the keys used now (LRU) and referenced by this project. */
  touch(keys: readonly string[], projectId: string): void {
    const t = this.now();
    this.db.transaction(() => {
      for (const k of keys) {
        if (!this.row(k)) continue;
        this.db.prepare('UPDATE render_segments SET last_used_at = ? WHERE key = ?').run(t, k);
        this.db.prepare('INSERT OR IGNORE INTO render_segment_projects (key, project_id) VALUES (?, ?)').run(k, projectId);
      }
    })();
  }
  markVerified(keys: readonly string[]): void {
    const t = this.now();
    const st = this.db.prepare('UPDATE render_segments SET verified_at = ? WHERE key = ?');
    this.db.transaction(() => { for (const k of keys) st.run(t, k); })();
  }
  /** Keys in the order they should be self-checked: least recently verified first, ties by key. Keys not in the store come first. */
  verifyOrder(keys: readonly string[]): string[] {
    const at = (k: string) => this.row(k)?.verified_at ?? -1;
    return [...new Set(keys)].map((k) => [k, at(k)] as const).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k]) => k);
  }
  pin(keys: readonly string[]): SegmentPin {
    const held = new Set<string>();
    let released = false;
    const add = (k: string) => {
      if (released || held.has(k)) return;
      held.add(k);
      this.pins.set(k, (this.pins.get(k) ?? 0) + 1);
    };
    for (const k of keys) add(k);
    return {
      keys: held,
      add,
      release: () => {
        if (released) return;
        released = true;
        for (const k of held) { const n = (this.pins.get(k) ?? 1) - 1; if (n > 0) this.pins.set(k, n); else this.pins.delete(k); }
      },
    };
  }
  /** Removes these keys now, pinned or not (a failed self-check purges what its own export pinned). */
  drop(keys: readonly string[]): { removed: number; bytes: number } { return this.remove(keys); }
  /**
   * Evict least-recently-used unpinned entries until bytes <= max(pinned, min(cap, quota ? quota − other − reserve : ∞,
   * autoClear ? bytes + free − minFree : ∞)). A quota of 0 means no ceiling (∞), never a negative limit. storage.ts calls it as
   * the reclaimer with the bytes another writer needs.
   */
  trim(reserveBytes: number): { evicted: number; bytes: number } {
    const used = this.usedBytes();
    const target = Math.max(this.pinnedBytes(), this.limit(Math.max(0, reserveBytes), used));
    const r = this.evictTo(target);
    return r;
  }
  /** The owner's «ניקוי מטמון הרינדור»: everything except pinned keys (an export running now). */
  clear(): { removed: number; bytes: number; keptPinned: number } {
    const keys = (this.db.prepare('SELECT key FROM render_segments').all() as { key: string }[]).map((r) => r.key);
    const free = keys.filter((k) => !this.pins.has(k));
    const r = this.remove(free);
    return { ...r, keptPinned: keys.length - free.length };
  }
  /**
   * Remove segments referenced by this project only (deleted project, or a privacy region added or changed: privacy over speed,
   * pinned or not). Segments another project also references stay, without this project's reference.
   */
  purgeProject(projectId: string): { removed: number; bytes: number } {
    const only = (this.db.prepare(`SELECT p.key FROM render_segment_projects p WHERE p.project_id = ?
      AND NOT EXISTS (SELECT 1 FROM render_segment_projects q WHERE q.key = p.key AND q.project_id <> p.project_id)`).all(projectId) as { key: string }[]).map((r) => r.key);
    const r = this.remove(only);
    this.db.prepare('DELETE FROM render_segment_projects WHERE project_id = ?').run(projectId);
    return r;
  }
  /** Files without rows, rows without files (or with files of the wrong size), stale temp files; run at construction. */
  reconcile(): { orphanFiles: number; orphanRows: number } {
    let orphanFiles = 0, orphanRows = 0;
    const rows = new Map((this.db.prepare('SELECT key, bytes FROM render_segments').all() as Pick<Row, 'key' | 'bytes'>[]).map((r) => [r.key, r.bytes]));
    const seen = new Map<string, { video: number | null; side: number | null }>();
    for (const e of fs.readdirSync(this.opts.dir, { withFileTypes: true })) {
      if (!e.isDirectory() || !/^[0-9a-f]{2}$/.test(e.name)) continue;
      const sub = path.join(this.opts.dir, e.name);
      for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
        const p = path.join(sub, f.name);
        const m = /^([0-9a-f]{64})\.(mp4|side)$/.exec(f.name);
        const key = m?.[1];
        if (!f.isFile() || !m || !key || key.slice(0, 2) !== e.name || !rows.has(key)) { fs.rmSync(p, { recursive: true, force: true }); orphanFiles++; continue; }
        const s = seen.get(key) ?? { video: null, side: null };
        s[m[2] === 'mp4' ? 'video' : 'side'] = fs.statSync(p).size;
        seen.set(key, s);
      }
    }
    for (const [key, bytes] of rows) {
      const s = seen.get(key);
      if (s && s.video !== null && s.side !== null && s.video + s.side === bytes) continue;
      orphanRows++;
      if (s) orphanFiles += (s.video !== null ? 1 : 0) + (s.side !== null ? 1 : 0);
      this.remove([key]);
    }
    return { orphanFiles, orphanRows };
  }
  /** Median render milliseconds per frame over the 50 newest entries of this size; null with fewer than 3. */
  medianRenderMsPerFrame(width: number, height: number): number | null {
    return this.median(width, height, (r) => r.render_ms / r.frames);
  }
  /** Median stored bytes per frame over the 50 newest entries of this size; null with fewer than 3 (the plan's bytesToStore). */
  medianBytesPerFrame(width: number, height: number): number | null {
    return this.median(width, height, (r) => r.bytes / r.frames);
  }
  private median(width: number, height: number, f: (r: Row) => number): number | null {
    const rows = this.db.prepare('SELECT * FROM render_segments WHERE width = ? AND height = ? AND frames > 0 ORDER BY created_at DESC, key LIMIT 50').all(width, height) as Row[];
    if (rows.length < 3) return null;
    const v = rows.map(f).sort((a, b) => a - b);
    const mid = v.length >> 1;
    return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
  }
  private counterName(engine: EngineFingerprint) { return `clean:${createHash('sha256').update(`${engine.bundle}\n${engine.browser}\n${engine.schemaVersion}`).digest('hex')}`; }
  /** Clean incremental exports with THIS engine fingerprint (bundle + browser); `auto` self-check samples only from core AUTO_SELF_CHECK_CLEAN_EXPORTS on. */
  cleanSelfChecks(engine: EngineFingerprint): number {
    const r = this.db.prepare('SELECT value FROM render_cache_meta WHERE name = ?').get(this.counterName(engine)) as { value: string } | undefined;
    const n = Number(r?.value ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }
  noteCleanSelfCheck(engine: EngineFingerprint): void {
    this.db.prepare('INSERT INTO render_cache_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(this.counterName(engine), String(this.cleanSelfChecks(engine) + 1));
  }
  /** Any self-check failure sets the counter of that fingerprint back to 0. */
  resetCleanSelfChecks(engine: EngineFingerprint): void {
    this.db.prepare('INSERT INTO render_cache_meta (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value').run(this.counterName(engine), '0');
  }
  /**
   * Room for `neededBytes` more under the data-directory ceiling (the joined file of a segmented export), after evicting unpinned
   * entries for it. True without a ceiling.
   */
  roomFor(neededBytes: number): boolean {
    const { quotaBytes } = this.opts.quota();
    if (quotaBytes <= 0) return true;
    this.trim(neededBytes);
    const q = this.opts.quota();
    return q.otherBytes + this.usedBytes() + neededBytes <= q.quotaBytes;
  }
  close(): void { this.db.close(); }
}
