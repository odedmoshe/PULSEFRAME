/**
 * The import queue (ADR-0023): every upload of a media file (the editor's picker, a dropped folder, a phone drop, the
 * synchronous POST …/assets) is received, hashed and stored, then probed, converted when it must be, and committed by a durable
 * job of type 'import' that survives a restart. One conversion at a time on the compute lane, yielding to exports; files that
 * need no conversion overtake. The contract, with the verifier's corrections, is importContracts.ts.
 *
 * How a job moves (stages of core IMPORT_STAGE; the card of each is core importCardState):
 *   receive()  stream → fsync → putBlob + createJob in one synchronous step → event 'job'      status queued
 *   probe      (pool of 2) step 0: the job's own commit already exists (crash between commit and job update) → finish from it;
 *              project gone / original gone; duplicate in the project; .cube, as-is and still files committed here;
 *              a video to convert: conform reuse (same original and CONFORM_RECIPE) or back to queued with output {reasons}
 *   convert    (one at a time) waiting-export → waiting-compute → lane taken per file → duplicate and reuse checked again →
 *              space check → converting:N (at most once a second, never 100) → lane released → commit
 *   commit     store.commit({ actor: job.actor, allowInternal, kind: input.commitKind, idempotencyKey: 'import:<jobId>' }),
 *              then derivatives.ensure                                                                      status succeeded
 * Every op argument is a pure function of the job input and the stored blobs (importedAt = input.receivedAt; the capture date
 * read from the ORIGINAL blob by the life line's readCapture with now = receivedAt), so a replay after a crash is byte-equal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { LibraryRecordSchema, SOURCE_OP, SourceRecordSchema, IMPORT_STAGE, convertingStage, importCardState, importErrorRetryable, LUT_MAX_TEXT_LENGTH, type Asset, type ImportErrorCode, type ImportJobView, type ImportRoom } from '@pulseframe/core';
import { readCapture } from './captureMeta.ts';
import { CONFORM_RECIPE, diskReserveRefuses, IMPORT_JOB_TYPE, importIdempotencyKey, importTempName, type ImportJobError, type ImportJobInput, type ImportJobOutput, type ImportQueue, type ImportQueueDeps, type LibraryJobInput, type ReceiveRequest } from './importContracts.ts';
import { libraryError } from './library/contract.ts';
import { buildImportedAsset, cleanRelativePath, cleanUploadName, ConformError, conformExtension, conformRecord, conformVideo, describeMedia, NeedsConform, prepareWithoutConform, receiveOriginal, type MediaMeta } from './ingest.ts';
import { assertStorageRoom, dataDirBytes, freeDiskBytes, UploadLedger } from './storage.ts';
import { ApiError, type JobRow } from './store.ts';

/** Probes (and still copies) run two at a time, outside the compute lane. */
export const IMPORT_PROBE_POOL = 2;
/** A conversion's stage is written at most this often. */
export const IMPORT_PROGRESS_MS = 1000;
const OPEN = new Set(['queued', 'running', 'cancel-requested']);
const FINISHED = new Set(['succeeded', 'failed', 'canceled']);

/** Space a conversion needs (plan §4): the larger of 1.5 × the original and an estimate of the CRF-15 copy plus its sound. */
export function conformNeedBytes(originalBytes: number, needs: NeedsConform): number {
  const o = needs.original;
  const seconds = Number.isFinite(o.durationSeconds) ? Math.max(0, o.durationSeconds) : 0;
  const fps = needs.targetRate.num / needs.targetRate.den;
  return Math.ceil(Math.max(1.5 * originalBytes, (o.width * o.height * fps * seconds * 0.6) / 8 + 24_000 * seconds));
}

/** What the queue keeps beside the shared job output: the recipe a converted result was made by (conform reuse is keyed by it). */
type StoredOutput = ImportJobOutput & { recipe?: string; /** LIBRARY BRANCH (worker A): use_library_item wrote its record onto an asset that existed */ recordAttached?: boolean; /** SOURCE BRANCH (wave 8 sources): use_source_item's answer */ libraryKept?: boolean; warnings?: unknown[] };

export function createImportQueue(deps: ImportQueueDeps): ImportQueue {
  const { store, lane, derivatives } = deps;
  const now = deps.now ?? Date.now;
  const freeBytes = deps.freeBytes ?? freeDiskBytes;
  const spawn = deps.spawnFfmpeg;
  const probeQueue: string[] = [];
  const convertQueue: { jobId: string; needs: NeedsConform }[] = [];
  let probing = 0;
  let converting: string | null = null;
  /** Jobs a worker is busy with: aborting stops whatever it waits for or runs (ffmpeg is killed). */
  const controls = new Map<string, AbortController>();
  const waiters = new Map<string, { resolve: (row: JobRow) => void; reject: (e: unknown) => void }[]>();
  const receives = new Set<{ ac: AbortController }>();
  const tasks = new Set<Promise<void>>();
  /** Uploads still arriving, counted against the storage ceiling as their bytes arrive (a stream of unknown size included). */
  const ledger = new UploadLedger(store);
  let stopped = false;
  let pumpScheduled = false;

  const jobOf = (jobId: string): JobRow | null => { try { return store.getJob(jobId); } catch { return null; } };
  const inputOf = (job: JobRow) => job.input as ImportJobInput;
  const statusOf = (jobId: string) => jobOf(jobId)?.status ?? null;
  const emit = (row: JobRow) => store.events.emit('job', row);

  const settle = (jobId: string) => {
    const row = jobOf(jobId);
    if (!row || !FINISHED.has(row.status)) return;
    // SOURCE BRANCH (wave 8 sources): the bytes are in the blob store or gone; the fetch job's download and link sidecar go now
    const src = (row.input as ImportJobInput | null)?.source;
    if (src) removeSourceTemp(store.tmpDir, src.fetchJobId);
    for (const w of waiters.get(jobId) ?? []) w.resolve(row);
    waiters.delete(jobId);
  };
  const track = (p: Promise<void>) => { tasks.add(p); void p.finally(() => tasks.delete(p)); };
  /** Workers start on a later turn of the event loop, never inside receive(): the caller always gets the row first. */
  const schedule = () => {
    if (pumpScheduled || stopped) return;
    pumpScheduled = true;
    setImmediate(() => { pumpScheduled = false; pump(); });
  };
  const pump = () => {
    if (stopped) return;
    while (probing < IMPORT_PROBE_POOL && probeQueue.length) {
      const id = probeQueue.shift()!;
      probing++;
      track(guarded(id, () => probeJob(id)).finally(() => { probing--; schedule(); }));
    }
    if (!converting && convertQueue.length) {
      const next = convertQueue.shift()!;
      converting = next.jobId;
      track(guarded(next.jobId, () => convertJob(next.jobId, next.needs)).finally(() => { converting = null; schedule(); }));
    }
  };
  /** A fault of the server itself fails the job honestly (internal_error, retryable) instead of leaving it open. */
  const guarded = async (jobId: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch (e: any) {
      if (stopped) return;
      const job = jobOf(jobId);
      if (job && OPEN.has(job.status)) fail(job, 'internal_error', `the import stopped on a server error: ${String(e?.message ?? e).slice(0, 300)}`, 500);
    } finally {
      controls.delete(jobId);
    }
  };

  // ---------- finishing a job ----------
  const errorOf = (job: JobRow, code: ImportErrorCode, message: string, status: number, details?: Record<string, unknown>, hint?: string): ImportJobError => ({
    code, message, status, retryable: importErrorRetryable(code), ...(details ? { details } : {}), ...(hint ? { hint } : {}),
    // The synchronous route already answered with this error: its card would only repeat it.
    ...(inputOf(job).commitKind === 'edit' ? { dismissed: true as const } : {}),
  });
  function fail(job: JobRow, code: ImportErrorCode, message: string, status: number, details?: Record<string, unknown>, hint?: string) {
    store.updateJob(job.id, { status: 'failed', stage: null, error: errorOf(job, code, message, status, details, hint) });
    // A file that could not be read or converted fails the same way again: its bytes go at once unless something else uses them.
    if (code === 'unsupported_media' || code === 'conform_failed') dropOriginalIfUnused(job);
    settle(job.id);
  }
  /**
   * ffmpeg timed out, was ended by the system (the out-of-memory killer) or is not installed: a fault of the machine or its setup,
   * not of the file. internal_error (retryable); the original is kept, so a retry needs nothing from the phone.
   */
  function machineFault(job: JobRow, e: ConformError, what: string, details: Record<string, unknown> = {}) {
    const hint = e.kind === 'no_ffmpeg' ? 'Install ffmpeg on this computer, then retry the file.'
      : e.kind === 'timeout' ? 'Retry the file when the computer is less busy.'
      : 'Close other programs to free memory, then retry the file.';
    fail(job, 'internal_error', `this computer could not ${what}: ${e.message}`, e.kind === 'no_ffmpeg' ? 503 : 500, { ...details, ffmpeg: e.kind }, hint);
  }
  function finishCanceled(job: JobRow, by: string) {
    store.updateJob(job.id, { status: 'canceled', stage: null, error: errorOf(job, 'canceled', `the import was canceled${by ? ` by ${by}` : ''}`, 409) });
    settle(job.id);
  }
  /** The worker's checkpoint: a cancel that arrived meanwhile ends the job here. */
  function canceledMeanwhile(job: JobRow): boolean {
    if (statusOf(job.id) !== 'cancel-requested') return false;
    finishCanceled(job, '');
    return true;
  }
  /** Deletes the original blob when no project (document or history), proposal or other job mentions its hash. */
  function dropOriginalIfUnused(job: JobRow) {
    try {
      const hash = inputOf(job).originalHash;
      const hex = hash.replace(/^sha256:/, '');
      if (!/^[0-9a-f]{64}$/.test(hex)) return;
      const like = `%${hex}%`;
      const has = (table: string) => !!store.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      const any = (sql: string, ...args: unknown[]) => !!store.db.prepare(sql).get(...args);
      if (any('SELECT 1 FROM projects WHERE doc LIKE ? OR initial_doc LIKE ? LIMIT 1', like, like)) return;
      if (any('SELECT 1 FROM transactions WHERE ops LIKE ? LIMIT 1', like)) return;
      if (any('SELECT 1 FROM jobs WHERE id <> ? AND (input LIKE ? OR output LIKE ?) LIMIT 1', job.id, like, like)) return;
      if (has('proposals') && any('SELECT 1 FROM proposals WHERE ops LIKE ? OR changes LIKE ? LIMIT 1', like, like)) return;
      fs.rmSync(store.blobPath(hash), { force: true });
      store.db.prepare('DELETE FROM blobs WHERE hash IN (?, ?)').run(hash, hex);
      if (has('derivatives')) store.db.prepare('DELETE FROM derivatives WHERE asset_hash IN (?, ?)').run(hash, hex);
    } catch { /* clean-up is best effort; the storage clean-up finds what is left */ }
  }
  const succeed = (job: JobRow, output: StoredOutput) => {
    store.updateJob(job.id, { status: 'succeeded', stage: null, output });
    settle(job.id);
  };

  /** Commits the asset under the job's idempotency key (kind 'background' keeps it off the same actor's default Ctrl+Z). */
  function commitAsset(job: JobRow, asset: Omit<Asset, 'id'>, extra: { converted: boolean; reusedConform: boolean; conformSeconds: number | null; reasons: ImportJobOutput['reasons']; recipe?: string }) {
    if (canceledMeanwhile(job)) return;
    const input = inputOf(job);
    let r;
    try {
      // LIBRARY BRANCH (worker A): a library copy is committed by use_library_item (which deduplicates and attaches the record)
      // SOURCE BRANCH (wave 8 sources): a fetched file is committed by use_source_item (which deduplicates and attaches its record)
      const op = input.library ? { op: 'use_library_item', args: { asset } } : input.source ? { op: SOURCE_OP, args: { asset } } : { op: 'import_asset', args: { asset } };
      r = store.commit({ projectId: job.projectId, actor: job.actor, allowInternal: true, kind: input.commitKind, idempotencyKey: importIdempotencyKey(job.id), label: `${input.library ? 'Add from the library' : input.source ? 'Add from a source' : 'Import'} ${asset.name}`, ops: [op] });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'project_not_found') return fail(job, 'project_gone', 'the project was deleted before the file arrived in it', 404, { projectId: job.projectId });
      if (e instanceof ApiError && e.code === 'idempotency_key_reused') return fail(job, 'internal_error', 'another change already used this import\'s commit key; send the file again', 409, { transactionId: e.details.transactionId });
      // LIBRARY BRANCH (worker A): a refusal of the library record is the caller's to see, with its own code
      if (e instanceof ApiError && (input.library || input.source) && e.status < 500 && e.code !== 'unknown_op') return fail(job, 'internal_error', `the file could not be added to the project: ${e.message}`, e.status, { refusal: e.code, ...e.details }, e.hint);
      if (e instanceof ApiError) return fail(job, 'internal_error', `the file could not be added to the project: ${e.message}`, 500, { refusal: e.code });
      throw e;
    }
    const out = r.results[0]?.output as { assetId: string; deduplicated: boolean; recordAttached?: boolean; libraryKept?: boolean; warnings?: unknown[] } | undefined;
    if (!out?.assetId) return fail(job, 'internal_error', 'the import operation gave no asset', 500);
    succeed(job, { assetId: out.assetId, revision: r.revision, deduplicated: !!out.deduplicated, converted: extra.converted, reusedConform: extra.reusedConform, reasons: extra.reasons, contentHash: asset.contentHash, conformSeconds: extra.conformSeconds, ...(extra.recipe ? { recipe: extra.recipe } : {}), ...(input.library ? { recordAttached: !!out.recordAttached } : {}), ...(input.source ? { recordAttached: !!out.recordAttached, libraryKept: !!out.libraryKept, warnings: Array.isArray(out.warnings) ? out.warnings : [] } : {}) });
    ensureDerivatives(job.projectId, out.assetId);
  }
  function ensureDerivatives(projectId: string, assetId: string) {
    try {
      const a = store.wholeProject(projectId).doc.assets[assetId];
      if (a) derivatives.ensure(a);
    } catch { /* thumbnails are progressive; their absence never fails an import */ }
  }
  const provenanceOf = (job: JobRow): Asset['provenance'] => {
    const i = inputOf(job);
    // LIBRARY BRANCH (worker A): a library copy carries its licence record and no upload record (validate.ts library_provenance)
    if (i.library) return { origin: 'upload', importedAt: i.receivedAt, importedBy: job.actor, library: i.library.record } as Asset['provenance'];
    // SOURCE BRANCH (wave 8 sources): a fetched file carries its source record and no upload record (validate.ts source_provenance)
    if (i.source) return { origin: 'upload', importedAt: i.receivedAt, importedBy: job.actor, source: i.source.record } as Asset['provenance'];
    return { origin: 'upload', importedAt: i.receivedAt, importedBy: job.actor, upload: { via: i.via, jobId: job.id, ...(i.dropId ? { dropId: i.dropId } : {}), ...(i.relativePath && i.via === 'folder' ? { relativePath: i.relativePath } : {}) } } as Asset['provenance'];
  };
  const captureOf = (job: JobRow) => readCapture(store.blobPath(inputOf(job).originalHash), inputOf(job).name, { homeZone: deps.homeZone, now: new Date(inputOf(job).receivedAt) });

  // ---------- the checks a probe and a conversion share ----------
  /**
   * Recovery step 0: this job's own commit, made before a crash that came ahead of the job update. It counts only when it is the
   * queue's: the same actor (the store keys idempotency per actor), an internal transaction (no client can commit one), and
   * exactly one import_asset of this job's original naming this job. Anything else under the key is not a recovery.
   */
  function ownCommit(job: JobRow): { kind: 'own'; transactionId: string; revision: number; asset: Omit<Asset, 'id'>; assetId: string } | { kind: 'foreign'; transactionId: string } | null {
    const row = store.db.prepare('SELECT id, revision, actor, allow_internal, ops, result FROM transactions WHERE project_id = ? AND actor = ? AND idempotency_key = ?').get(job.projectId, job.actor, importIdempotencyKey(job.id)) as { id: string; revision: number; actor: string; allow_internal: number; ops: string; result: string } | undefined;
    if (!row) return null;
    try {
      const ops = JSON.parse(row.ops) as { op: string; args: { asset?: any } }[];
      const asset = ops[0]?.args?.asset;
      const assetId = JSON.parse(row.result)?.results?.[0]?.output?.assetId;
      const h = inputOf(job).originalHash;
      const lib = inputOf(job).library; // LIBRARY BRANCH (worker A): the library commit names its record, not the job
      const src = inputOf(job).source; // SOURCE BRANCH (wave 8 sources): the commit names its service and item, not the job
      const mine = lib ? ops[0]!.op === 'use_library_item' && asset?.provenance?.library?.itemId === lib.record.itemId
        : src ? ops[0]!.op === SOURCE_OP && asset?.provenance?.source?.provider === src.record.provider && asset?.provenance?.source?.itemId === src.record.itemId
        : ops[0]!.op === 'import_asset' && asset?.provenance?.upload?.jobId === job.id;
      if (row.actor === job.actor && row.allow_internal === 1 && ops.length === 1 && mine && (asset.contentHash === h || asset.conform?.originalContentHash === h) && typeof assetId === 'string')
        return { kind: 'own', transactionId: row.id, revision: row.revision, asset, assetId };
    } catch { /* not ours */ }
    return { kind: 'foreign', transactionId: row.id };
  }
  /** An asset of this project made from these bytes (stored as they are, or converted from them). */
  function duplicateIn(projectId: string, originalHash: string): { asset: Asset; revision: number } | null {
    const p = store.wholeProject(projectId);
    const a = Object.values(p.doc.assets).find((x) => x.contentHash === originalHash || x.conform?.originalContentHash === originalHash);
    return a ? { asset: a, revision: p.revision } : null;
  }
  /** A conversion of the same original by the same recipe whose result is still stored. */
  function reusable(originalHash: string): string | null {
    const rows = store.db.prepare("SELECT output FROM jobs WHERE type = ? AND status = 'succeeded' AND json_extract(input, '$.originalHash') = ? AND json_extract(output, '$.recipe') = ? AND json_extract(output, '$.converted') = 1 ORDER BY updated_at DESC").all(IMPORT_JOB_TYPE, originalHash, CONFORM_RECIPE) as { output: string }[];
    for (const r of rows) {
      try {
        const h = JSON.parse(r.output).contentHash as string;
        if (h && fs.existsSync(store.blobPath(h))) return h;
      } catch { /* a row that does not parse is skipped */ }
    }
    return null;
  }
  /** Ends a job early when it needs no work of its own. True when the job is finished. */
  async function shortcut(job: JobRow, needs: NeedsConform | null): Promise<boolean> {
    const input = inputOf(job);
    // LIBRARY BRANCH (worker A): no short-cut for a library copy; use_library_item finds the duplicate and attaches the record
    // SOURCE BRANCH (wave 8 sources): no short-cut for a fetched file either; use_source_item finds the duplicate and attaches the record
    const dup = input.library || input.source ? null : duplicateIn(job.projectId, input.originalHash);
    if (dup) {
      succeed(job, { assetId: dup.asset.id, revision: dup.revision, deduplicated: true, converted: !!dup.asset.conform, reusedConform: false, reasons: dup.asset.conform?.reasons ?? [], contentHash: dup.asset.contentHash, conformSeconds: null });
      return true;
    }
    if (!needs) return false;
    const reuse = reusable(input.originalHash);
    if (!reuse) return false;
    let meta: MediaMeta;
    try { meta = await describeMedia(store.blobPath(reuse)); } catch { return false; } // not readable any more: convert again
    if (needs.alpha && !meta.video?.hasAlpha) return false; // an earlier conversion (before wave 8 G2) dropped the alpha: convert again
    const capture = await captureOf(job);
    const asset = buildImportedAsset({ meta, name: input.name, contentHash: reuse, byteSize: fs.statSync(store.blobPath(reuse)).size, provenance: provenanceOf(job), capture, conform: conformRecord(needs, input.originalHash, input.byteSize) });
    commitAsset(job, asset, { converted: true, reusedConform: true, conformSeconds: null, reasons: needs.reasons, recipe: CONFORM_RECIPE });
    return true;
  }

  // ---------- the probe (pool of two) ----------
  async function probeJob(jobId: string): Promise<void> {
    const job0 = jobOf(jobId);
    if (!job0 || job0.status !== 'queued' || job0.type !== IMPORT_JOB_TYPE) return;
    const ac = new AbortController();
    controls.set(jobId, ac);
    const attempt = (job0.attempt ?? 0) + 1;
    store.updateJob(jobId, { status: 'running', stage: IMPORT_STAGE.probing, attempt });
    const job = jobOf(jobId)!;
    const input = inputOf(job);
    // Step 0: a commit made before a crash; nothing is probed or converted again.
    const own = ownCommit(job);
    if (own?.kind === 'own') {
      succeed(job, { assetId: own.assetId, revision: own.revision, deduplicated: false, converted: !!own.asset.conform, reusedConform: false, reasons: own.asset.conform?.reasons ?? [], contentHash: own.asset.contentHash, conformSeconds: null, ...(own.asset.conform && !own.asset.conform.reasons.includes('still-format') ? { recipe: CONFORM_RECIPE } : {}) });
      ensureDerivatives(job.projectId, own.assetId);
      return;
    }
    if (own?.kind === 'foreign') return fail(job, 'internal_error', 'another change already used this import\'s commit key; send the file again', 409, { transactionId: own.transactionId });
    if (!store.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(job.projectId)) return fail(job, 'project_gone', 'the project was deleted before the file arrived in it', 404, { projectId: job.projectId });
    const blob = store.blobPath(input.originalHash);
    let size = -1;
    try { size = fs.statSync(blob).size; } catch { /* gone */ }
    if (size !== input.byteSize) return fail(job, 'original_gone', 'the received file is no longer stored (storage clean-up removed it); send it again', 410, { byteSize: input.byteSize });
    if (canceledMeanwhile(job)) return;
    if (await shortcut(job, null)) return;
    const isCube = /\.cube$/i.test(input.name);
    let prepared;
    try {
      prepared = await prepareWithoutConform(blob, { isCube, workBase: path.join(store.tmpDir, importTempName(job.id, attempt, randomBytes(4).toString('hex'))), spawn, signal: ac.signal, machineFaults: 'throw' });
    } catch (e) {
      if (stopped) return;
      if (e instanceof ConformError && e.kind === 'canceled') return void finishCanceled(job, '');
      if (e instanceof ConformError && e.machineFault) return machineFault(job, e, 'make an editable copy of this picture');
      if (e instanceof ApiError && e.code === 'disk_full') return fail(job, 'disk_full', e.message, 507, undefined, e.hint);
      if (e instanceof ApiError && e.status === 415) return fail(job, 'unsupported_media', e.message, 415, e.details, e.hint);
      throw e;
    }
    if (stopped) { if (prepared.route === 'still') fs.rmSync(prepared.file, { force: true }); return; }
    if (canceledMeanwhile(job)) { if (prepared.route === 'still') fs.rmSync(prepared.file, { force: true }); return; }
    if (prepared.route === 'lut') {
      const asset = buildImportedAsset({ meta: prepared.meta, name: input.name, contentHash: input.originalHash, byteSize: input.byteSize, provenance: provenanceOf(job), capture: null });
      return commitAsset(job, asset, { converted: false, reusedConform: false, conformSeconds: null, reasons: [] });
    }
    if (prepared.route === 'as-is') {
      store.db.prepare('UPDATE blobs SET mime = ? WHERE hash = ?').run(prepared.meta.mimeType, input.originalHash); // as the synchronous ingest records it
      const asset = buildImportedAsset({ meta: prepared.meta, name: input.name, contentHash: input.originalHash, byteSize: input.byteSize, provenance: provenanceOf(job), capture: await captureOf(job) });
      return commitAsset(job, asset, { converted: false, reusedConform: false, conformSeconds: null, reasons: [] });
    }
    if (prepared.route === 'still') {
      store.putBlob(prepared.contentHash, prepared.file, prepared.byteSize, prepared.meta.mimeType);
      const asset = buildImportedAsset({ meta: prepared.meta, name: input.name, contentHash: prepared.contentHash, byteSize: prepared.byteSize, provenance: provenanceOf(job), capture: await captureOf(job), conform: conformRecord(prepared.needs, input.originalHash, input.byteSize) });
      return commitAsset(job, asset, { converted: true, reusedConform: false, conformSeconds: null, reasons: prepared.needs.reasons });
    }
    if (await shortcut(job, prepared.needs)) return;
    if (canceledMeanwhile(job)) return;
    // Its turn among the conversions: back to queued, with why it is converted (the card shows the reasons while it waits).
    store.updateJob(jobId, { status: 'queued', stage: null, output: { reasons: prepared.needs.reasons } });
    convertQueue.push({ jobId, needs: prepared.needs });
  }

  // ---------- the conversion (one at a time, on the compute lane) ----------
  async function convertJob(jobId: string, needs: NeedsConform): Promise<void> {
    const job = jobOf(jobId);
    if (!job || job.status !== 'queued') return;
    const input = inputOf(job);
    const ac = new AbortController();
    controls.set(jobId, ac);
    let release: (() => void) | null = null;
    const out = path.join(store.tmpDir, `${importTempName(job.id, Math.max(1, job.attempt), randomBytes(4).toString('hex'))}.conform.${conformExtension(needs)}`);
    try {
      try {
        // A running server export goes first; then the lane, once per file (a speech or AI job waits for at most one conversion).
        // Exports never take the lane, so one that began while this file waited for it is waited for too (as framejobs does).
        for (;;) {
          if (lane.exportActive()) {
            store.updateJob(jobId, { status: 'running', stage: IMPORT_STAGE.waitingExport });
            await lane.waitForExportIdle(ac.signal);
          }
          const busy = lane.busy();
          if (busy.holder !== null || busy.waiting > 0) store.updateJob(jobId, { status: 'running', stage: IMPORT_STAGE.waitingCompute });
          release = await lane.acquire(`import ${input.name} (${jobId})`, ac.signal);
          if (!lane.exportActive()) break;
          release(); release = null; // an export began meanwhile: give the lane back and wait for it
        }
      } catch (e) {
        if (stopped) return;
        if (ac.signal.aborted) return void finishCanceled(job, '');
        throw e;
      }
      if (canceledMeanwhile(job)) return;
      // Another job may have brought the same bytes in while this one waited.
      if (await shortcut(job, needs)) return;
      const need = conformNeedBytes(input.byteSize, needs);
      const free = freeBytes(store.dataDir);
      if (free !== null && free - deps.reserveBytes < need) return fail(job, 'disk_full', 'there is not enough free disk space to convert this file', 507, { needBytes: need, freeBytes: free, reserveBytes: deps.reserveBytes }, 'Free some disk space, then retry the file.');
      let last = 0;
      let lastAt = now();
      store.updateJob(jobId, { status: 'running', stage: convertingStage(0) });
      const started = now();
      let c;
      try {
        c = await conformVideo(store.blobPath(input.originalHash), needs, out, {
          spawn, signal: ac.signal,
          onProgress: (pct) => {
            const t = now();
            if (pct <= last || t - lastAt < IMPORT_PROGRESS_MS || stopped || ac.signal.aborted) return;
            last = pct; lastAt = t;
            store.updateJob(jobId, { stage: convertingStage(pct) });
          },
        });
      } catch (e) {
        if (stopped) return;
        if (e instanceof ConformError) {
          if (e.kind === 'canceled') return void finishCanceled(job, '');
          if (e.kind === 'disk_full') return fail(job, 'disk_full', 'the disk filled up while converting this file', 507, { reasons: needs.reasons }, 'Free some disk space, then retry the file.');
          if (e.kind === 'not_editable') return fail(job, 'conform_failed', e.message, 415, { reasons: needs.reasons });
          if (e.machineFault) return machineFault(job, e, 'convert this file', { reasons: needs.reasons });
          // ffmpeg ran and reported an error: a fault of the file.
          return fail(job, 'conform_failed', `the file needs conforming (${needs.reasons.join(', ')}) and ffmpeg could not convert it: ${e.message}`, 415, { reasons: needs.reasons });
        }
        throw e;
      }
      const conformSeconds = Math.round((now() - started) / 100) / 10;
      store.putBlob(c.contentHash, out, c.byteSize, c.meta.mimeType);
      release?.(); release = null;
      if (canceledMeanwhile(job)) return;
      const asset = buildImportedAsset({ meta: c.meta, name: input.name, contentHash: c.contentHash, byteSize: c.byteSize, provenance: provenanceOf(job), capture: await captureOf(job), conform: conformRecord(needs, input.originalHash, input.byteSize) });
      commitAsset(job, asset, { converted: true, reusedConform: false, conformSeconds, reasons: needs.reasons, recipe: CONFORM_RECIPE });
    } finally {
      release?.();
      try { fs.rmSync(out, { force: true }); } catch { /* a busy file (Windows): recovery removes it */ }
    }
  }

  // ---------- the interface ----------
  const queue: ImportQueue = {
    async receive(req: ReceiveRequest): Promise<JobRow> {
      if (stopped) throw new ApiError(503, 'shutting_down', 'the server is stopping; send the file again once it is back');
      // ---- LIBRARY BRANCH (wave 7 library track, worker A; library/contract.ts) ----
      // A copy from the library folder (library/routes.ts, which already checked the file at its source): the record must be a
      // valid LibraryRecord and `expect` well formed; after the bytes are received, they must equal `expect` (libraryExpectFails,
      // below) or nothing is stored. The job keeps input.library; its commit is use_library_item (commitAsset), its provenance
      // provenance.library without provenance.upload (provenanceOf); a duplicate is not short-cut, so the op can attach the record.
      if (req.library) {
        const r = LibraryRecordSchema.safeParse(req.library.record);
        const x = req.library.expect as Record<string, unknown>;
        const okExpect = typeof x?.sha256 === 'string' ? /^[0-9a-f]{64}$/.test(x.sha256) : Number.isInteger(x?.bytes) && Number.isFinite(x?.mtimeMs);
        if (!r.success || !okExpect || req.via !== 'browser') throw new ApiError(400, 'invalid_request', 'a library copy needs a valid record and expectation', {});
      }
      // ---- end of the library branch ----
      // ---- SOURCE BRANCH (wave 8 sources; sources/job.ts): a file a source_fetch job downloaded. The record must be a valid
      // SourceRecord naming the expected bytes, never beside a library part; after the bytes are received they must hash to
      // `expect.sha256` or nothing is stored (sourceExpectFails, below). The job keeps input.source; its commit is use_source_item.
      if (req.source) {
        const r = SourceRecordSchema.safeParse(req.source.record);
        const hex = req.source.expect?.sha256;
        if (!r.success || typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex) || r.data.sha256 !== hex || req.library || req.via !== 'browser' || typeof req.source.fetchJobId !== 'string' || !/^job_[A-Za-z0-9_-]{1,64}$/.test(req.source.fetchJobId))
          throw new ApiError(400, 'invalid_request', 'a fetched file needs a valid source record naming its bytes', {});
      }
      // ---- end of the source branch ----
      if (!store.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(req.projectId)) throw new ApiError(404, 'project_not_found', `project ${req.projectId} not found`, { projectId: req.projectId }, 'Call list_projects.');
      const { name, isCube } = cleanUploadName(req.name);
      const relativePath = req.via === 'folder' ? cleanRelativePath(req.relativePath) : undefined;
      const declared = req.declaredBytes !== null && Number.isFinite(req.declaredBytes) && req.declaredBytes >= 0 ? req.declaredBytes : null;
      let cap = Math.max(0, Math.min(req.maxBytes, deps.maxUploadBytes));
      if (!Number.isFinite(cap)) {
        // I9, open mode with no cap set (importContracts.ts uploadCapFor): a declared size meets the disk reserve below; one of unknown
        // size is cut at the free room minus the reserve (the check that already exists for declared sizes)
        const free = declared === null ? freeBytes(store.dataDir) : null;
        cap = free === null || !Number.isFinite(free) ? Number.MAX_SAFE_INTEGER : Math.max(0, free - deps.reserveBytes);
      }
      if (declared !== null && isCube && declared > LUT_MAX_TEXT_LENGTH) throw new ApiError(413, 'upload_too_large', `a colour table (.cube) file can be at most ${LUT_MAX_TEXT_LENGTH} bytes`, { maxBytes: LUT_MAX_TEXT_LENGTH });
      if (declared !== null && declared > cap) throw new ApiError(413, 'upload_too_large', `upload exceeds ${cap} bytes`, { maxBytes: cap });
      // The ceiling counts what is already arriving (reserved and not yet on disk); this upload reserves its declared size, or,
      // of unknown size, grows its reservation as its bytes arrive and is cut off as soon as the ceiling would be passed.
      assertStorageRoom(store, (declared ?? 1) + ledger.outstanding(), 'store this upload');
      if (diskReserveRefuses(freeBytes(store.dataDir), deps.reserveBytes, declared)) throw new ApiError(507, 'disk_full', 'there is not enough free disk space for this file', { declaredBytes: declared, reserveBytes: deps.reserveBytes }, 'Free some disk space, then send the file again.');
      const tmpName = `up_${randomBytes(8).toString('hex')}`;
      const reservation = ledger.open(path.join(store.tmpDir, tmpName), declared);
      const entry = { ac: new AbortController() };
      const onAbort = () => entry.ac.abort();
      if (req.signal?.aborted) entry.ac.abort(); else req.signal?.addEventListener('abort', onAbort, { once: true });
      receives.add(entry);
      let rec;
      try {
        rec = await receiveOriginal(store, req.body, { maxBytes: cap, isCube, reserve: (size) => ledger.grow(reservation, size), signal: entry.ac.signal, fsync: true, tmpName });
      } catch (e) {
        ledger.close(reservation); // the partial file is gone: its room is free again
        throw e;
      } finally {
        receives.delete(entry);
        req.signal?.removeEventListener('abort', onAbort);
      }
      // From here the bytes are on disk (then in the blob store, or removed): the reservation ends with this step either way.
      try {
        if (declared !== null && rec.size !== declared) { fs.rmSync(rec.tmp, { force: true }); throw new ApiError(400, 'upload_incomplete', `the upload ended after ${rec.size} of ${declared} bytes; nothing was stored`, { receivedBytes: rec.size, declaredBytes: declared }); }
        if (stopped) { fs.rmSync(rec.tmp, { force: true }); throw new ApiError(503, 'shutting_down', 'the server is stopping; send the file again once it is back'); }
        // ---- LIBRARY BRANCH (worker A): the received bytes must be the bytes the library route checked; nothing is stored otherwise ----
        const libFail = req.library ? libraryExpectFails(req.library.expect, rec) : null;
        if (libFail) { fs.rmSync(rec.tmp, { force: true }); throw libFail; }
        // ---- end of the library branch ----
        const srcFail = req.source ? sourceExpectFails(req.source.expect, rec) : null; // SOURCE BRANCH (wave 8 sources)
        if (srcFail) { fs.rmSync(rec.tmp, { force: true }); throw srcFail; }
        const input: ImportJobInput = {
          originalHash: rec.hash, byteSize: rec.size, name, via: req.via,
          ...(req.via === 'phone' && req.dropId ? { dropId: req.dropId } : {}),
          ...(req.issuedBy ? { issuedBy: req.issuedBy } : {}),
          ...(relativePath ? { relativePath } : {}),
          ...(req.declaredLastModified ? { declaredLastModified: req.declaredLastModified } : {}),
          receivedAt: new Date(now()).toISOString(), commitKind: req.commitKind,
          ...(req.batchId ? { batchId: req.batchId } : {}),
          retryOf: null,
          ...(req.library ? { library: req.library } : {}), // LIBRARY BRANCH (worker A)
          ...(req.source ? { source: { record: req.source.record, expect: { sha256: req.source.expect.sha256 }, fetchJobId: req.source.fetchJobId } } : {}), // SOURCE BRANCH (wave 8 sources)
        };
        // Stored and enqueued in one synchronous step: no job without its bytes, no bytes without a job.
        const row = store.db.transaction(() => {
          store.putBlob(rec.hash, rec.tmp, rec.size, isCube ? 'text/plain' : 'application/octet-stream');
          return store.createJob(req.projectId, IMPORT_JOB_TYPE, req.actor, input);
        })();
        emit(row);
        probeQueue.push(row.id);
        schedule();
        return row;
      } finally {
        ledger.close(reservation);
      }
    },

    wait(jobId: string): Promise<JobRow> {
      const job = jobOf(jobId);
      if (!job || job.type !== IMPORT_JOB_TYPE) return Promise.reject(new ApiError(404, 'job_not_found', `import job ${jobId} not found`, { jobId }));
      if (FINISHED.has(job.status)) return Promise.resolve(job);
      if (stopped) return Promise.reject(new ApiError(503, 'shutting_down', 'the server is stopping; the import continues after it restarts'));
      return new Promise((resolve, reject) => { const list = waiters.get(jobId) ?? []; list.push({ resolve, reject }); waiters.set(jobId, list); });
    },

    list(projectId: string): ImportJobView[] {
      const ids = store.db.prepare(`SELECT id FROM jobs WHERE project_id = ? AND type = ? AND (status IN ('queued','running','cancel-requested')
        OR (status IN ('failed','canceled') AND json_extract(error, '$.dismissed') IS NULL AND json_extract(output, '$.dismissed') IS NULL)) ORDER BY created_at, rowid`).all(projectId, IMPORT_JOB_TYPE) as { id: string }[];
      return ids.map((r) => jobOf(r.id)).filter((j): j is JobRow => !!j).map((j) => queue.view(j));
    },

    view(job: JobRow): ImportJobView {
      const input = inputOf(job);
      const card = importCardState(job);
      const ci = convertQueue.findIndex((c) => c.jobId === job.id);
      const output = (job.output ?? null) as Partial<ImportJobOutput> | null;
      const error = (job.error ?? null) as ImportJobError | null;
      return {
        jobId: job.id, projectId: job.projectId, name: input.name, byteSize: input.byteSize, via: input.via,
        state: card.state, waitingFor: card.waitingFor, percent: card.percent,
        queuePosition: card.state === 'waiting' && card.waitingFor === 'turn' && ci >= 0 ? ci + (converting ? 1 : 0) : null,
        reasons: Array.isArray(output?.reasons) ? output!.reasons! : [],
        assetId: typeof output?.assetId === 'string' ? output.assetId : null, deduplicated: output?.deduplicated === true,
        error: error && job.status !== 'succeeded' ? { code: error.code, message: error.message, retryable: error.retryable } : null,
        batchId: input.batchId ?? null, dropId: input.dropId ?? null, retryOf: input.retryOf ?? null, attempt: job.attempt,
        createdAt: job.createdAt, updatedAt: job.updatedAt,
      };
    },

    room(): ImportRoom {
      const quota = store.maxStorageBytes;
      return { ceilingRoomBytes: quota ? Math.max(0, quota - dataDirBytes(store.dataDir)) : null, freeDiskBytes: freeBytes(store.dataDir), reserveBytes: deps.reserveBytes, maxFileBytes: deps.maxUploadBytes };
    },

    cancel(jobId: string, actor: string) {
      const job = store.getJob(jobId);
      if (job.type !== IMPORT_JOB_TYPE) throw new ApiError(409, 'not_an_import', `job ${job.id} is not an import`, { jobId: job.id, type: job.type });
      if (FINISHED.has(job.status)) return { jobId, status: job.status, outcome: 'already-finished' as const };
      const ctl = controls.get(jobId);
      if (!ctl) {
        // Waiting for its turn (or left open by a stop): nothing runs for it, so it ends here.
        const pi = probeQueue.indexOf(jobId); if (pi >= 0) probeQueue.splice(pi, 1);
        const ci = convertQueue.findIndex((c) => c.jobId === jobId); if (ci >= 0) convertQueue.splice(ci, 1);
        finishCanceled(job, actor);
        return { jobId, status: 'canceled', outcome: 'removed-from-queue' as const };
      }
      store.updateJob(jobId, { status: 'cancel-requested' });
      ctl.abort();
      return { jobId, status: 'cancel-requested', outcome: 'stopping' as const };
    },

    retry(jobId: string, actor: string): JobRow {
      const job = store.getJob(jobId);
      if (job.type !== IMPORT_JOB_TYPE) throw new ApiError(409, 'not_an_import', `job ${job.id} is not an import`, { jobId: job.id, type: job.type });
      if (job.status !== 'failed' && job.status !== 'canceled') throw new ApiError(409, 'import_not_finished', 'only a failed or canceled import can be retried', { jobId, status: job.status });
      if (stopped) throw new ApiError(503, 'shutting_down', 'the server is stopping; retry once it is back');
      const input = inputOf(job);
      let size = -1;
      try { size = fs.statSync(store.blobPath(input.originalHash)).size; } catch { /* gone */ }
      if (size !== input.byteSize) throw new ApiError(409, 'original_gone', 'the received file is no longer stored (it was cleaned up); send it again', { jobId });
      // The retry is the retrier's act: its actor, a background commit; via, dropId and issuedBy are kept for the card.
      const next: ImportJobInput = { ...input, commitKind: 'background', retryOf: job.id };
      const row = store.db.transaction(() => {
        store.updateJob(job.id, { error: { ...(job.error ?? { code: job.status === 'canceled' ? 'canceled' : 'internal_error', message: '', status: 409, retryable: true }), dismissed: true } });
        return store.createJob(job.projectId, IMPORT_JOB_TYPE, actor, next);
      })();
      emit(row);
      probeQueue.push(row.id);
      schedule();
      return row;
    },

    dismiss(jobId: string, _actor: string): void {
      const job = store.getJob(jobId);
      if (job.type !== IMPORT_JOB_TYPE) throw new ApiError(409, 'not_an_import', `job ${job.id} is not an import`, { jobId: job.id, type: job.type });
      if (job.status !== 'failed' && job.status !== 'canceled') throw new ApiError(409, 'import_not_finished', 'only a failed or canceled import can be dismissed', { jobId, status: job.status });
      if ((job.error as ImportJobError | null)?.dismissed) return;
      store.updateJob(jobId, { error: { ...(job.error ?? { code: job.status === 'canceled' ? 'canceled' : 'internal_error', message: '', status: 409, retryable: true }), dismissed: true } });
    },

    recover(): number {
      // A cancel that was asked for before the restart is honoured, not run again.
      for (const j of store.openJobs(IMPORT_JOB_TYPE)) if (j.status === 'cancel-requested') finishCanceled(j, '');
      // Working files of conversions and receives the process was killed in. A busy file (Windows) never stops start-up.
      try {
        for (const f of fs.readdirSync(store.tmpDir)) if (/^(imp|up)_/.test(f)) { try { fs.rmSync(path.join(store.tmpDir, f), { force: true, recursive: true }); } catch { /* busy: next start */ } }
        // SOURCE BRANCH (wave 8 sources): a download or link sidecar whose source_fetch job is gone or finished; an open job keeps
        // its .part (it resumes with Range) and its .link
        for (const f of fs.readdirSync(store.tmpDir)) {
          const m = /^src_(.+)\.(part|link)$/.exec(f);
          if (!m) continue;
          const st = jobOf(m[1]!)?.status;
          if (!st || FINISHED.has(st)) { try { fs.rmSync(path.join(store.tmpDir, f), { force: true }); } catch { /* busy: next start */ } }
        }
      } catch { /* no tmp directory */ }
      const rows = store.recoverJobs(IMPORT_JOB_TYPE);
      for (const r of rows) if (!probeQueue.includes(r.id) && !controls.has(r.id) && !convertQueue.some((c) => c.jobId === r.id)) probeQueue.push(r.id);
      schedule();
      return rows.length;
    },

    async stop(): Promise<void> {
      stopped = true;
      for (const r of receives) r.ac.abort();
      for (const c of controls.values()) c.abort(); // ffmpeg is killed; the rows stay running for recover()
      probeQueue.length = 0;
      convertQueue.length = 0;
      for (const [, list] of waiters) for (const w of list) w.reject(new ApiError(503, 'shutting_down', 'the server stopped; the import continues after it restarts'));
      waiters.clear();
      await Promise.race([Promise.allSettled([...tasks]), new Promise((r) => setTimeout(r, 15_000).unref())]);
    },
  };
  return queue;
}

// ---- LIBRARY BRANCH (wave 7 library track, worker A) ----
/** Why received library bytes are not the ones the library route checked (409, nothing stored), or null when they are. */
export function libraryExpectFails(expect: LibraryJobInput['expect'], rec: { hash: string; size: number }): ApiError | null {
  if ('sha256' in expect) return rec.hash === `sha256:${expect.sha256}` ? null : libraryError('hashMismatch', { sha256: rec.hash.replace(/^sha256:/, ''), expected: expect.sha256 });
  return rec.size === expect.bytes ? null : libraryError('changedSinceIndex', { bytes: rec.size, indexedBytes: expect.bytes });
}
// ---- end of the library branch ----

// ---- SOURCE BRANCH (wave 8 sources) ----
/** Why received bytes are not the ones the source_fetch job downloaded (409 source_hash_mismatch, nothing stored), or null. */
export function sourceExpectFails(expect: { sha256: string }, rec: { hash: string }): ApiError | null {
  return rec.hash === `sha256:${expect.sha256}` ? null : new ApiError(409, 'source_hash_mismatch', 'the received bytes are not the ones the download stored', { sha256: rec.hash.replace(/^sha256:/, ''), expected: expect.sha256 }, 'Import the item again.');
}
/** The temp files of a source_fetch job (`<tmp>/src_<jobId>.part` and `.link`). Best effort: a busy file goes at the next start. */
export function removeSourceTemp(tmpDir: string, fetchJobId: string): void {
  if (!/^job_[A-Za-z0-9_-]{1,64}$/.test(fetchJobId)) return;
  for (const ext of ['part', 'link']) { try { fs.rmSync(path.join(tmpDir, `src_${fetchJobId}.${ext}`), { force: true }); } catch { /* busy */ } }
}
// ---- end of the source branch ----
