/**
 * The scan job of picture search (wave 7 search track; decisions §4 "Job search-index"). A durable row of type SEARCH_INDEX_JOB_TYPE,
 * input {assetIds, embedderId} (never a query), progress {unit: 'frames', done, total}.
 *
 * - Per file: the sampled frames (core sampleFrameTargets on the proxy when it maps frames 1:1, else the original) are decoded in
 *   batches of ≤ FOOTAGE_LIMITS.batchFrames (frames.ts); before each batch the job waits while a server export runs and then holds the
 *   compute lane under searchLaneLabel(projectId) for the embedding only. Every batch's vectors are validated (count × dim, finite, unit
 *   length; else the job fails search_engine_failed and the file gets nothing), quantised (core quantiseInt8) and kept in memory; the file
 *   is written in ONE transaction by SearchIndexDb.replaceFile with stillWanted checked inside it. The written frames are read back and
 *   must equal the targets (validated before success).
 * - Skips, recorded by count only: removed (the asset left the project, or its file left every project during the scan),
 *   decode_failed (ffmpeg delivered another count), no_picture (not a video, or no frame).
 * - Cancel stops at a batch boundary: the batch being embedded finishes, nothing of the unfinished file is written. A restart resumes at
 *   the first file without a complete row (complete files are not embedded again). Shutdown leaves the row running for recovery.
 * - Storage: samples × FOOTAGE_LIMITS.bytesPerSample through assertStorageRoom before the job and before each file.
 * - One open scan per project (409 search_scan_in_progress).
 */
import { FOOTAGE_LIMITS, type StartScanBody } from '@pulseframe/core';
import type { Principal } from '../governance.ts';
import type { FifoComputeLane } from '../lane.ts';
import { assertStorageRoom } from '../storage.ts';
import { ApiError, type JobRow, type Store } from '../store.ts';
import { frameSource, type TrackingDeps } from '../tracking.ts';
import { validateVectors, type FootageCore } from './answer.ts';
import { SEARCH_INDEX_JOB_TYPE, searchError, searchLaneLabel, type Embedder } from './contract.ts';
import { sampledFrames } from './frames.ts';
import type { Sample, SearchIndexDb } from './indexDb.ts';

export interface ScanJobInput { assetIds: string[]; embedderId: string }
export interface ScanJobOutput {
  progress: { unit: 'frames'; done: number; total: number };
  files: { scanned: number; alreadyScanned: number; skipped: { removed: number; decode_failed: number; no_picture: number } };
  embedder: string;
}
export interface ScanContext {
  store: Store;
  lane: FifoComputeLane;
  core: FootageCore;
  derivatives: TrackingDeps['derivatives'];
  /** the embedder of a ready setup, or throws 409 picture_search_not_ready */
  embedder(): Promise<Embedder>;
  /** the index, created when absent */
  index(): SearchIndexDb;
  /** some current project holds this content hash (synchronous: called inside the write transaction) */
  held(contentHash: string): boolean;
}

class ScanCanceled extends Error { constructor() { super('canceled'); this.name = 'ScanCanceled'; } }
interface Running { projectId: string; wait: AbortController; hard: AbortController; canceled: boolean; shutdown: boolean; done: Promise<void> }
const FINISHED = ['succeeded', 'failed', 'canceled'];
const STAGE_EVERY_MS = 500;

/** The frames a video is sampled at, from the source the job would decode (empty: no picture). */
function targetsOf(ctx: ScanContext, asset: Parameters<typeof frameSource>[2]) {
  const src = frameSource(ctx.store, ctx.derivatives, asset, 'proxy');
  return { src, targets: src.frameCount > 0 ? ctx.core.sampleFrameTargets(src.rate, src.frameCount) : [] };
}

export class ScanJobs {
  private running = new Map<string, Running>();
  constructor(private ctx: ScanContext) {}

  /** The open scan of a project, if any. */
  openFor(projectId: string): JobRow | undefined {
    return this.ctx.store.openJobs(SEARCH_INDEX_JOB_TYPE).find((j) => j.projectId === projectId);
  }

  /** POST …/search/index (the owner's own session; the route checked it). */
  async start(p: Principal, projectId: string, body: StartScanBody): Promise<{ jobId: string; status: string }> {
    const { store } = this.ctx;
    const emb = await this.ctx.embedder();
    const open = this.openFor(projectId);
    if (open) throw searchError('scanRunning', { jobId: open.id, status: open.status });
    const { doc } = store.wholeProject(projectId);
    let assetIds: string[];
    if (body.assetIds) {
      const unknown = body.assetIds.filter((id) => !Object.hasOwn(doc.assets, id));
      if (unknown.length) throw new ApiError(404, 'not_found', `${unknown.length} of the asset ids are not in this project`, { unknown: unknown.slice(0, 20) }, 'Call list_assets for the current ids.');
      assetIds = [...new Set(body.assetIds)];
    } else assetIds = Object.keys(doc.assets).sort();
    // videos only, and only those not complete for this embedder (the same file and embedder give the same rows: nothing to redo)
    const idx = this.ctx.index();
    assetIds = assetIds.filter((id) => { const a = doc.assets[id]!; return a.kind === 'video' && !!a.video && !idx.hasFile(a.contentHash, emb.id); });
    if (!assetIds.length) throw searchError('nothingToScan');
    let samples = 0;
    for (const id of assetIds) samples += targetsOf(this.ctx, doc.assets[id]!).targets.length;
    assertStorageRoom(store, samples * FOOTAGE_LIMITS.bytesPerSample, 'scan footage for picture search');
    const input: ScanJobInput = { assetIds, embedderId: emb.id };
    const job = store.createJob(projectId, SEARCH_INDEX_JOB_TYPE, p.actor, input);
    this.run(job.id);
    return { jobId: job.id, status: store.getJob(job.id).status };
  }

  /** Cancel (assertMayCancel ran): a queued scan is removed; a running one stops at the next batch boundary and writes nothing more. */
  cancel(jobId: string, actor: string): { jobId: string; status: string; outcome: string } {
    const { store } = this.ctx;
    const j = store.getJob(jobId);
    if (FINISHED.includes(j.status)) return { jobId, status: j.status, outcome: 'already-finished' };
    const run = this.running.get(jobId);
    if (j.status === 'queued' || !run) {
      store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: `canceled by ${actor}; files already scanned stay in the index, the unfinished file got nothing` } });
      if (run) { run.canceled = true; run.wait.abort(); }
      return { jobId, status: 'canceled', outcome: j.status === 'queued' ? 'removed-from-queue' : 'stopped' };
    }
    store.updateJob(jobId, { status: 'cancel-requested' });
    run.canceled = true;
    run.wait.abort();
    return { jobId, status: 'cancel-requested', outcome: 'stopping' };
  }

  /** After a restart: a cancel asked before it is honoured; scans left running resume at the first incomplete file. */
  recover(): number {
    const { store } = this.ctx;
    for (const j of store.openJobs(SEARCH_INDEX_JOB_TYPE)) if (j.status === 'cancel-requested') store.updateJob(j.id, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; the unfinished file got nothing' } });
    const jobs = store.recoverJobs(SEARCH_INDEX_JOB_TYPE);
    for (const j of jobs) this.run(j.id);
    return jobs.length;
  }

  /** Stop and wait for the scans of a project (null: all) before forgetting: nothing is written after this resolves. */
  async abortScans(projectId: string | null, actor: string): Promise<void> {
    const mine = [...this.running.entries()].filter(([, r]) => projectId === null || r.projectId === projectId);
    for (const [id, r] of mine) { this.cancel(id, actor); r.hard.abort(); }
    await Promise.all(mine.map(([, r]) => r.done.catch(() => {})));
  }

  /** Server shutdown: the rows stay running and are resumed after the restart. */
  async stop(): Promise<void> {
    const all = [...this.running.values()];
    for (const r of all) { r.shutdown = true; r.wait.abort(); r.hard.abort(); }
    await Promise.all(all.map((r) => r.done.catch(() => {})));
  }

  /** Resolves when the job's run ends (tests and the proof). */
  settled(jobId: string): Promise<void> {
    return this.running.get(jobId)?.done ?? Promise.resolve();
  }

  private run(jobId: string): void {
    if (this.running.has(jobId)) return;
    const { store } = this.ctx;
    const r: Running = { projectId: store.getJob(jobId).projectId, wait: new AbortController(), hard: new AbortController(), canceled: false, shutdown: false, done: Promise.resolve() };
    this.running.set(jobId, r);
    r.done = (async () => {
      try { await this.work(jobId, r); }
      catch (e) {
        if (r.shutdown) return;
        try {
          if (FINISHED.includes(store.getJob(jobId).status)) return;
          if (e instanceof ScanCanceled || r.canceled || store.getJob(jobId).status === 'cancel-requested') store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled; files already scanned stay in the index, the unfinished file got nothing' } });
          else {
            if (!(e instanceof ApiError)) console.error('picture search scan failed unexpectedly', e instanceof Error ? e.name : 'error');
            store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'the scan failed unexpectedly' } });
          }
        } catch (e2) { console.error('picture search scan: the job row could not be updated', e2 instanceof Error ? e2.message : ''); }
      } finally { this.running.delete(jobId); }
    })();
  }

  private async work(jobId: string, r: Running): Promise<void> {
    const { store, lane, core } = this.ctx;
    const job = store.getJob(jobId);
    if (job.status !== 'queued') return;
    const input = job.input as ScanJobInput;
    const check = () => {
      if (r.canceled || r.wait.signal.aborted || r.hard.signal.aborted) throw new ScanCanceled();
      const st = store.getJob(jobId).status;
      if (st !== 'queued' && st !== 'running') throw new ScanCanceled();
    };
    store.updateJob(jobId, { status: 'running', stage: 'scanning' });
    const emb = await this.ctx.embedder();
    if (emb.id !== input.embedderId) throw searchError('notReady', { setup: 'embedder_changed', embedder: emb.id }, 'embedder_changed');
    const idx = this.ctx.index();
    // progress totals: the targets of every file still in the project; files already complete count as done (resume)
    const start = store.wholeProject(job.projectId).doc;
    let total = 0, done = 0;
    for (const id of input.assetIds) {
      const a = Object.hasOwn(start.assets, id) ? start.assets[id]! : null;
      if (!a || a.kind !== 'video' || !a.video) continue;
      const n = targetsOf(this.ctx, a).targets.length;
      total += n;
      if (idx.hasFile(a.contentHash, emb.id)) done += n;
    }
    const out: ScanJobOutput = { progress: { unit: 'frames', done, total }, files: { scanned: 0, alreadyScanned: 0, skipped: { removed: 0, decode_failed: 0, no_picture: 0 } }, embedder: emb.id };
    let last = 0;
    const progress = (force = false) => {
      const now = performance.now();
      if (!force && now - last < STAGE_EVERY_MS) return;
      last = now;
      check();
      store.updateJob(jobId, { status: 'running', stage: `scanning ${out.progress.done}/${out.progress.total} frames`, output: out });
    };
    progress(true);
    for (const assetId of input.assetIds) {
      check();
      const doc = store.wholeProject(job.projectId).doc;
      const a = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : null;
      if (!a) { out.files.skipped.removed++; continue; }
      if (a.kind !== 'video' || !a.video) { out.files.skipped.no_picture++; continue; }
      if (idx.hasFile(a.contentHash, emb.id)) { out.files.alreadyScanned++; continue; }
      const { src, targets } = targetsOf(this.ctx, a);
      if (!targets.length) { out.files.skipped.no_picture++; continue; }
      assertStorageRoom(store, targets.length * FOOTAGE_LIMITS.bytesPerSample, 'scan footage for picture search');
      const samples: Sample[] = [];
      try {
        for await (const batch of sampledFrames(src, targets, r.wait.signal)) {
          check();
          await lane.waitForExportIdle(r.wait.signal);
          check();
          const release = await lane.acquire(searchLaneLabel(job.projectId), r.wait.signal);
          let vec: Float32Array;
          try { vec = await emb.embedImages(batch.rgb, batch.frames.length, r.hard.signal); } finally { release(); }
          try { validateVectors(vec, batch.frames.length, emb.dim); } catch (e) { if (e instanceof ApiError) e.details = { ...e.details, assetId }; throw e; }
          batch.frames.forEach((frame, k) => {
            const { scale, q } = core.quantiseInt8(vec.slice(k * emb.dim, (k + 1) * emb.dim));
            samples.push({ frame, scale, q });
          });
          out.progress.done += batch.frames.length;
          progress();
        }
      } catch (e) {
        if (e instanceof ApiError && e.code === 'decode_failed' && !r.wait.signal.aborted) { out.files.skipped.decode_failed++; continue; }
        if (r.wait.signal.aborted || r.hard.signal.aborted) throw new ScanCanceled();
        throw e;
      }
      check();
      // ONE transaction; stillWanted runs inside it (no await between the check and the write)
      // (check() above ran synchronously before this line: a cancel or a forget cannot land between them)
      const wrote = idx.replaceFile({ contentHash: a.contentHash, embedder: emb.id, source: src.kind, frameCount: src.frameCount, rate: src.rate }, samples, (h) => this.ctx.held(h));
      if (!wrote) { out.files.skipped.removed++; continue; }
      const stored = idx.framesOf(a.contentHash, emb.id);
      if (stored.length !== targets.length || stored.some((f, i) => f !== targets[i])) {
        idx.deleteHashes([a.contentHash]);
        throw searchError('engineFailed', { check: 'stored_frames', assetId });
      }
      out.files.scanned++;
      progress(true);
    }
    check();
    store.updateJob(jobId, { status: 'succeeded', stage: null, output: out });
  }
}
