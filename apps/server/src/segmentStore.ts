/**
 * The render cache's segment store (ADR-0024, plan §6 with the verifier's corrections): content-addressed H.264 segments in
 * `<dataDir>/render-cache/<key[0..2]>/<key>.mp4` with a sidecar `<key>.side` (magic 'PFSEG1\n', u32le header length, SegmentMeta
 * JSON, cells blob from cellsCodec.ts), indexed in its OWN SQLite file `<dataDir>/render-cache/index.sqlite` (tables
 * render_segments, render_segment_projects, render_cache_meta, created by the store itself; nothing in store.ts). A restored
 * backup therefore starts with an empty, consistent cache: backups copy blobs and out only.
 *
 * Counted against the storage ceiling because dataDirBytes walks the data directory. Least-recently-used eviction; pinned keys
 * (this export's reused and freshly put segments) are never evicted or cleared.
 *
 * LEAD STUBS, final signatures. W2 (server) owns the bodies; the lead registers the store with storage.ts setStorageHooks
 * (reclaim = trim, purgeProject, status) when it wires the route.
 */
import type { EngineFingerprint, RenderCacheStatus } from '@pulseframe/core';
import type { FlashCells } from '@pulseframe/engine';

export const RENDER_CACHE_DIR = 'render-cache';
export const SEGMENT_SIDECAR_MAGIC = 'PFSEG1\n';

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

const notBuilt = (what: string): never => { throw new Error(`SegmentStore.${what}: not built yet (segment cache W2)`); };

export class SegmentStore {
  constructor(opts: SegmentStoreOptions) {
    void opts;
    notBuilt('constructor');
  }
  /** usedBytes, segments, cap, high-water mark (bytes), autoClear, minFreeBytes; `enabled` = capBytes > 0. */
  status(): RenderCacheStatus { return notBuilt('status'); }
  has(key: string): boolean { void key; return notBuilt('has'); }
  /** verify: re-hash the video against the sidecar and check the header key, sizes and frame count; a damaged entry is dropped and null returned. */
  open(key: string, opts: { verify: boolean }): Promise<SegmentHandle | null> { void key; void opts; return notBuilt('open'); }
  readCells(key: string): Promise<FlashCells[]> { void key; return notBuilt('readCells'); }
  /**
   * Stores the segment and adds its key to `pin`. Returns null — never throws for lack of room — when no room can be made within
   * the cap, the ceiling and the minimum-free rule: the caller then joins from its work directory and counts it in notStored.
   */
  put(key: string, input: SegmentPutInput, pin: SegmentPin): Promise<SegmentHandle | null> { void key; void input; void pin; return notBuilt('put'); }
  /** Marks the keys used now (LRU) and referenced by this project. */
  touch(keys: readonly string[], projectId: string): void { void keys; void projectId; notBuilt('touch'); }
  markVerified(keys: readonly string[]): void { void keys; notBuilt('markVerified'); }
  /** Keys in the order they should be self-checked: least recently verified first, ties by key. */
  verifyOrder(keys: readonly string[]): string[] { void keys; return notBuilt('verifyOrder'); }
  pin(keys: readonly string[]): SegmentPin { void keys; return notBuilt('pin'); }
  drop(keys: readonly string[]): { removed: number; bytes: number } { void keys; return notBuilt('drop'); }
  /** Evict least-recently-used unpinned entries until bytes <= max(pinned, min(cap, quota - other - reserve, autoClear ? bytes + free - minFree : ∞)). */
  trim(reserveBytes: number): { evicted: number; bytes: number } { void reserveBytes; return notBuilt('trim'); }
  /** The owner's «ניקוי מטמון הרינדור»: everything except pinned keys (an export running now). */
  clear(): { removed: number; bytes: number; keptPinned: number } { return notBuilt('clear'); }
  /** Remove segments referenced by this project only. */
  purgeProject(projectId: string): { removed: number; bytes: number } { void projectId; return notBuilt('purgeProject'); }
  /** Files without rows, rows without files, stale temp files; run at construction. */
  reconcile(): { orphanFiles: number; orphanRows: number } { return notBuilt('reconcile'); }
  /** Median render milliseconds per frame over the 50 newest entries of this size; null with fewer than 3. */
  medianRenderMsPerFrame(width: number, height: number): number | null { void width; void height; return notBuilt('medianRenderMsPerFrame'); }
  /** Clean incremental exports with THIS engine fingerprint (bundle + browser); `auto` self-check samples only from core AUTO_SELF_CHECK_CLEAN_EXPORTS on. */
  cleanSelfChecks(engine: EngineFingerprint): number { void engine; return notBuilt('cleanSelfChecks'); }
  noteCleanSelfCheck(engine: EngineFingerprint): void { void engine; notBuilt('noteCleanSelfCheck'); }
  /** Any self-check failure sets the counter of that fingerprint back to 0. */
  resetCleanSelfChecks(engine: EngineFingerprint): void { void engine; notBuilt('resetCleanSelfChecks'); }
  close(): void { notBuilt('close'); }
}
