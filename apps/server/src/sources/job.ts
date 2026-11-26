/**
 * The durable job `source_fetch` (wave 8 `sources`, plan §3.4 with verify C6, C7, C11; core SourceJobInput / SourceJobProgress).
 *
 *   resolving    provider route: the service is asked for the item AGAIN (licence and author from that fresh answer, never from
 *                the client); link route: the full link is read from the 0600 sidecar `<tmp>/src_<jobId>.link` (C11)
 *   downloading  into `<tmp>/src_<jobId>.part` through the safe downloader: free space checked before and every 64 MiB against the
 *                reserve and the expected size (download_disk_full); bytes capped while streaming (download_too_large); Content-Type
 *                and magic bytes (download_not_media); a cut connection resumes with Range + If-Range (validators kept in the
 *                stage JSON; a 200 answer to a Range restarts at 0); a restart continues the same way
 *   importing    imports.receive with `source: { record, expect: { sha256 }, fetchJobId }` (the import queue commits use_source_item
 *                as the job's actor, importQueue.ts SOURCE BRANCH); the import job's id is kept in the stage JSON, so a restart
 *                waits for it instead of sending the bytes again
 *   placing      add_clip, tried on the current project first, then committed as the credential that asked (governance commitAs)
 * The job succeeds only when the import succeeded and the asset holds the downloaded bytes. `.part` and `.link` are deleted on
 * success, cancel and failure (and by the import queue's recovery when the job is gone or finished). The stage column holds the
 * SourceJobProgress JSON. Nothing a job stores holds a key or the full link; errors name a host at most.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { applyTransaction, OpError, SOURCE_JOB_FAILURES, SOURCES_LIMITS, type Asset, type OpCall, type SourceJobFailure, type SourceJobInput, type SourceJobProgress, type SourceRecord, type SourceWarning, type SearchableSourceId } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Config } from '../config.ts';
import { contentTypeVerdict, FetchRefusal, safeOpen, sniffMedia } from '../connectors/fetch.ts';
import type { Governance } from '../governance.ts';
import { IMPORT_JOB_TYPE, type ImportQueue } from '../importContracts.ts';
import { removeSourceTemp } from '../importQueue.ts';
import { ApiError, type JobRow, type Store } from '../store.ts';
import type { AddressPolicy } from './contract.ts';
import { flagsFor, recordOf, warningsOf, type ServiceItem } from './service.ts';

/** The job row's input: core SourceJobInput (it carries the key a repeat names and the grant, for a restart's placement). */
export type StoredSourceInput = SourceJobInput;
/** What a finished job answers (job.output). */
export interface SourceJobOutput {
  assetId: string; revision: number; importJobId: string; deduplicated: boolean; recordAttached: boolean; libraryKept: boolean;
  placed: Record<string, unknown> | null; placeRefusal?: { code: string; message: string; hint?: string };
  warnings: SourceWarning[]; terms: string[]; bytes: number; route: 'provider' | 'direct';
}
const OPEN = new Set(['queued', 'running', 'cancel-requested']);
const FINISHED = new Set(['succeeded', 'failed', 'canceled']);
/** Automatic resumes after a cut connection, per run. */
export const DOWNLOAD_RESUMES = 3;
/** The stage JSON is written at most this often while bytes arrive. */
export const PROGRESS_MS = 1000;

export const partPath = (store: Store, jobId: string) => path.join(store.tmpDir, `src_${jobId}.part`);
export const linkPath = (store: Store, jobId: string) => path.join(store.tmpDir, `src_${jobId}.link`);

/** A failure of the job, from the core table (facts with their next step). */
export class SourceJobError extends Error {
  constructor(readonly code: string, message: string, readonly hint: string, readonly details: Record<string, unknown> = {}, readonly retryable = false) { super(message); }
  static of<K extends SourceJobFailure>(key: K, details: Record<string, unknown>, ...a: Parameters<(typeof SOURCE_JOB_FAILURES)[K]['message']>): SourceJobError {
    const r = SOURCE_JOB_FAILURES[key] as { code: string; message: (...x: unknown[]) => string; hint: string };
    return new SourceJobError(r.code, r.message(...a), r.hint, details, key === 'stalled' || key === 'rateLimited' || key === 'diskFull');
  }
}
/** An ApiError of a service call (key missing, rate limited…) as the job's failure. */
function fromApi(e: ApiError): SourceJobError {
  const d = e.details ?? {};
  if (e.code === 'provider_rate_limited') return SourceJobError.of('rateLimited', d, Number(d.retryAfterSeconds ?? 60));
  if (e.code === 'provider_key_rejected') return SourceJobError.of('keyRejected', d);
  if (e.code === 'provider_key_missing' || e.code === 'provider_contact_missing') return new SourceJobError(e.code, e.message, e.hint ?? '', d);
  if (e.code === 'source_not_found') return SourceJobError.of('sourceNotFound', d);
  return new SourceJobError(e.code, e.message, e.hint ?? 'Try again in a few minutes.', d, e.status >= 500);
}

export interface JobEnv {
  cfg: Config; store: Store; gov: Governance; imports: ImportQueue;
  policy: AddressPolicy;
  /** the service context and adapter of a provider route (throws provider_key_missing… as an ApiError) */
  resolveItem(provider: SearchableSourceId, itemId: string, signal: AbortSignal): Promise<ServiceItem | null>;
  userAgentFor(provider: string): string;
  freeBytes(dir: string): number | null;
  reserveBytes: number;
  timeouts: { headerMs: number; idleMs: number };
  principals: Map<string, Principal>;
  now(): number;
}

const parseProgress = (stage: string | null): SourceJobProgress | null => { try { const p = stage ? JSON.parse(stage) : null; return p && typeof p === 'object' && typeof p.stage === 'string' ? p as SourceJobProgress : null; } catch { return null; } };
export const progressOf = (row: JobRow): SourceJobProgress => parseProgress(row.stage) ?? { stage: 'resolving', bytes: 0, total: null, etag: null, lastModified: null, importJobId: null };

const EXT_OF_TYPE: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/tiff': 'tif', 'application/ogg': 'ogg' };

/** One run of a job: from where its stage JSON says, to a final state (or left running for recovery when the server stops). */
export class SourceJobRunner {
  private controls = new Map<string, AbortController>();
  private tasks = new Set<Promise<void>>();
  private stopping = false;
  constructor(private env: JobEnv) {}

  running(jobId: string): boolean { return this.controls.has(jobId); }
  start(jobId: string): void {
    if (this.stopping || this.controls.has(jobId)) return;
    const ac = new AbortController();
    this.controls.set(jobId, ac);
    const t = this.run(jobId, ac).finally(() => { this.controls.delete(jobId); this.env.principals.delete(jobId); });
    this.tasks.add(t);
    void t.finally(() => this.tasks.delete(t));
  }
  /** cancel: a running job is stopped at its next step (its import too); a waiting one ends here. */
  cancel(job: JobRow, by: string): { jobId: string; status: string; outcome: string } {
    if (FINISHED.has(job.status)) return { jobId: job.id, status: job.status, outcome: 'already-finished' };
    const ac = this.controls.get(job.id);
    const importJobId = progressOf(job).importJobId;
    if (importJobId) { try { this.env.imports.cancel(importJobId, by); } catch { /* finished already */ } }
    if (!ac) { this.finish(job.id, 'canceled', null, SourceJobError.of('canceled', { by })); return { jobId: job.id, status: 'canceled', outcome: 'removed-from-queue' }; }
    this.env.store.updateJob(job.id, { status: 'cancel-requested' });
    ac.abort();
    return { jobId: job.id, status: 'cancel-requested', outcome: 'stopping' };
  }
  async stop(): Promise<void> {
    this.stopping = true;
    for (const ac of this.controls.values()) ac.abort();
    await Promise.race([Promise.allSettled([...this.tasks]), new Promise((r) => setTimeout(r, 15_000).unref())]);
  }

  private job(jobId: string): JobRow | null { try { return this.env.store.getJob(jobId); } catch { return null; } }
  private save(jobId: string, p: SourceJobProgress): void { const j = this.job(jobId); if (j && OPEN.has(j.status)) this.env.store.updateJob(jobId, { stage: JSON.stringify(p) }); }
  private finish(jobId: string, status: 'succeeded' | 'failed' | 'canceled', output: SourceJobOutput | null, err: SourceJobError | null): void {
    const j = this.job(jobId);
    if (!j || FINISHED.has(j.status)) return;
    removeSourceTemp(this.env.store.tmpDir, jobId);
    const p = progressOf(j);
    this.env.store.updateJob(jobId, {
      status, stage: JSON.stringify({ ...p, stage: status === 'succeeded' ? 'done' : p.stage }),
      ...(output ? { output } : {}),
      ...(err ? { error: { code: err.code, message: err.message, hint: err.hint, retryable: err.retryable, ...(Object.keys(err.details).length ? { details: err.details } : {}) } } : {}),
    });
  }

  private async run(jobId: string, ac: AbortController): Promise<void> {
    const { store, imports } = this.env;
    const row0 = this.job(jobId);
    if (!row0 || !OPEN.has(row0.status)) return;
    if (row0.status === 'cancel-requested') return this.finish(jobId, 'canceled', null, SourceJobError.of('canceled', {}));
    store.updateJob(jobId, { status: 'running', attempt: (row0.attempt ?? 0) + 1 });
    const input = row0.input as StoredSourceInput;
    // null = no byte limit of its own (open mode with no upload limit set, core sourcesMaxBytes): the disk reserve still holds
    const maxBytes = input.maxBytes ?? Number.POSITIVE_INFINITY;
    let p = progressOf(row0);
    const warnings: SourceWarning[] = [];
    try {
      // a restart while importing waits for that import; one started just before a crash is found by its fetchJobId
      let importJobId = p.importJobId ?? this.importOf(jobId);
      let bytes = p.bytes;
      if (!importJobId) {
        p = { ...p, stage: 'resolving' }; this.save(jobId, p);
        let item: ServiceItem | null = null, url: string, name: string, userAgent: string;
        if (input.route === 'provider') {
          item = await this.env.resolveItem(input.provider as SearchableSourceId, input.itemId, ac.signal);
          if (!item) throw SourceJobError.of('sourceNotFound', { provider: input.provider });
          const r = item.renditions.find((x) => x.id === input.rendition) ?? defaultRendition(item, maxBytes);
          url = r.url;
          name = `${item.title || `${item.provider} ${item.itemId}`}`.slice(0, 200);
          userAgent = this.env.userAgentFor(input.provider);
        } else {
          let held: { url?: unknown } | null = null;
          try { held = JSON.parse(fs.readFileSync(linkPath(store, jobId), 'utf8')); } catch { /* gone */ }
          if (!held || typeof held.url !== 'string') throw new SourceJobError('source_not_found', 'the link of this import is no longer kept on this computer', 'Paste the link again.');
          url = held.url;
          name = linkName(url);
          userAgent = this.env.userAgentFor('link');
        }
        if (ac.signal.aborted) throw new SourceJobError('canceled', '', '');
        p = { ...p, stage: 'downloading' }; this.save(jobId, p);
        const dl = await this.download(jobId, url, userAgent, maxBytes, p, ac.signal, (np) => { p = np; });
        for (const w of dl.warnings) warnings.push({ code: w, termIds: [], message: input.route === 'direct' ? `the link leads to a home-network address (${input.host ?? 'its host'})` : 'a file of this item is on a home-network address' });
        bytes = dl.size;
        const fetchedAt = new Date(this.env.now()).toISOString();
        const record: SourceRecord = item ? recordOf(item, { sha256: dl.sha256, byteSize: dl.size, fetchedAt }) : linkRecord(input, url, name, dl, fetchedAt);
        const ext = item?.ext ?? extOf(url) ?? EXT_OF_TYPE[dl.contentType] ?? null;
        const fileName = ext && !name.toLowerCase().endsWith(`.${ext}`) ? `${name}.${ext}` : name;
        if (ac.signal.aborted) throw new SourceJobError('canceled', '', '');
        p = { ...p, stage: 'importing' }; this.save(jobId, p);
        const job = this.job(jobId)!;
        const imp = await imports.receive({ projectId: job.projectId, actor: job.actor, body: fs.createReadStream(partPath(store, jobId)), name: fileName, via: 'browser', declaredBytes: dl.size, maxBytes, commitKind: 'background', source: { record, expect: { sha256: dl.sha256 }, fetchJobId: jobId } });
        importJobId = imp.id;
        p = { ...p, importJobId }; this.save(jobId, p);
        fs.rmSync(partPath(store, jobId), { force: true }); // the bytes are in the blob store now
      }
      const onAbort = () => { try { imports.cancel(importJobId!, 'source_fetch'); } catch { /* finished */ } };
      ac.signal.addEventListener('abort', onAbort, { once: true });
      let done: JobRow;
      try { done = await imports.wait(importJobId); } finally { ac.signal.removeEventListener('abort', onAbort); }
      if (this.stopping) return;
      if (this.job(jobId)?.status === 'cancel-requested' || done.status === 'canceled') return this.finish(jobId, 'canceled', null, SourceJobError.of('canceled', {}));
      if (done.status !== 'succeeded') {
        const e = (done.error ?? {}) as { code?: string; message?: string; hint?: string; details?: Record<string, unknown> };
        throw new SourceJobError(e.code ?? 'internal_error', `the file could not be added to the project: ${e.message ?? done.status}`, e.hint ?? 'Import it again.', { ...(e.details ?? {}), importJobId });
      }
      const out = done.output as { assetId: string; revision: number; deduplicated?: boolean; recordAttached?: boolean; libraryKept?: boolean; warnings?: SourceWarning[] };
      const expected = (done.input as { source?: { expect?: { sha256?: string } } }).source?.expect?.sha256;
      const whole = store.wholeProject(done.projectId);
      const asset = whole.doc.assets[out.assetId] as Asset | undefined;
      if (!asset || !expected || ((asset.conform?.originalContentHash ?? asset.contentHash) !== `sha256:${expected}` && asset.contentHash !== `sha256:${expected}`))
        throw new SourceJobError('internal_error', 'the imported file is not in the project with the downloaded bytes', 'Import it again.', { importJobId });
      for (const w of out.warnings ?? []) warnings.push(w);
      // placing
      let placed: Record<string, unknown> | null = null, placeRefusal: SourceJobOutput['placeRefusal'];
      let revision = out.revision;
      if (input.place && !this.stopping) {
        p = { ...p, stage: 'placing' }; this.save(jobId, p);
        const r = this.place(jobId, done.projectId, out.assetId, input, fileNameOf(asset));
        placed = r.placed; placeRefusal = r.refusal; revision = r.revision ?? revision;
      }
      this.finish(jobId, 'succeeded', {
        assetId: out.assetId, revision, importJobId, deduplicated: !!out.deduplicated, recordAttached: !!out.recordAttached, libraryKept: !!out.libraryKept,
        placed, ...(placeRefusal ? { placeRefusal } : {}), warnings, terms: asset.provenance.source?.terms ?? [], bytes, route: input.route,
      }, null);
    } catch (e) {
      if (this.stopping) return; // the row stays running; recover() continues from the .part
      if (ac.signal.aborted || this.job(jobId)?.status === 'cancel-requested') return this.finish(jobId, 'canceled', null, SourceJobError.of('canceled', {}));
      const err = e instanceof SourceJobError ? e : e instanceof ApiError ? fromApi(e) : new SourceJobError('internal_error', `the download stopped on a server error: ${String((e as Error)?.message ?? e).slice(0, 200)}`, 'Import it again.', {}, true);
      this.finish(jobId, 'failed', null, err);
    }
  }

  /** An import job this fetch started before a crash that came ahead of recording it. */
  private importOf(jobId: string): string | null {
    const r = this.env.store.db.prepare("SELECT id FROM jobs WHERE type = ? AND json_extract(input, '$.source.fetchJobId') = ? ORDER BY created_at DESC LIMIT 1").get(IMPORT_JOB_TYPE, jobId) as { id: string } | undefined;
    return r?.id ?? null;
  }

  /** add_clip tried on the current project, then committed as the credential that asked (a refusal is said, the import stays). */
  private place(jobId: string, projectId: string, assetId: string, input: StoredSourceInput, name: string): { placed: Record<string, unknown> | null; refusal?: SourceJobOutput['placeRefusal']; revision?: number } {
    const pl = input.place!;
    const op: OpCall = { op: 'add_clip', args: { assetId, start: pl.start, ...(pl.trackId ? { trackId: pl.trackId } : {}), ...(pl.sequenceId ? { sequenceId: pl.sequenceId } : {}) } };
    const job = this.job(jobId)!;
    try {
      const principal = this.env.principals.get(jobId) ?? principalOf(this.env.gov, job.actor, input.grantId);
      try { applyTransaction(this.env.store.getProject(projectId).doc, [op], { idSeed: 'dryrun-src-place', actor: job.actor }); } catch (e) {
        if (e instanceof OpError) throw new ApiError(e.code === 'not_found' ? 404 : 422, e.code, e.message, e.details, e.hint);
        throw e;
      }
      const r = this.env.gov.commitAs(principal, { projectId, ops: [op], label: `Place ${name}` }) as { revision?: number; results?: { output?: Record<string, unknown> }[] };
      return { placed: r.results?.[0]?.output ?? null, ...(r.revision !== undefined ? { revision: r.revision } : {}) };
    } catch (e) {
      if (e instanceof ApiError) return { placed: null, refusal: { code: e.code, message: `the file was imported and not placed: ${e.message}`, ...(e.hint ? { hint: e.hint } : {}) } };
      throw e;
    }
  }

  /** The download (see the header). Returns the hash, size, media kind and type of the bytes in the .part. */
  private async download(jobId: string, url: string, userAgent: string, maxBytes: number, p0: SourceJobProgress, signal: AbortSignal, onProgress: (p: SourceJobProgress) => void): Promise<{ sha256: string; size: number; kind: 'video' | 'audio' | 'image'; contentType: string; warnings: Set<'link_private_network'> }> {
    const { store } = this.env;
    const file = partPath(store, jobId);
    fs.mkdirSync(store.tmpDir, { recursive: true });
    let p = p0;
    const warnings = new Set<'link_private_network'>();
    let resumes = 0;
    let contentType = '';
    const disk = (needed: number) => {
      const free = this.env.freeBytes(store.dataDir);
      if (free !== null && Number.isFinite(free) && free - this.env.reserveBytes < Math.max(0, needed)) throw SourceJobError.of('diskFull', { freeBytes: free, reserveBytes: this.env.reserveBytes, neededBytes: Math.max(0, needed) });
    };
    for (;;) {
      let have = 0;
      try { have = fs.statSync(file).size; } catch { /* none yet */ }
      const validator = p.etag ?? p.lastModified;
      if (have > 0 && !validator) { fs.truncateSync(file, 0); have = 0; }
      disk((p.total ?? 0) - have);
      const headers: Record<string, string> = have > 0 ? { range: `bytes=${have}-`, 'if-range': validator! } : {};
      let res;
      try {
        res = await safeOpen(url, { userAgent, policy: this.env.policy, headers, signal, headerTimeoutMs: this.env.timeouts.headerMs, idleTimeoutMs: this.env.timeouts.idleMs });
      } catch (e) {
        if (e instanceof FetchRefusal) {
          if (e.code === 'link_address_refused') throw SourceJobError.of('addressRefused', { host: e.host }, e.host ?? 'the link');
          if (e.code === 'canceled') throw e;
          if ((e.code === 'network' || e.code === 'header_timeout') && resumes++ < DOWNLOAD_RESUMES && !signal.aborted) continue;
          if (e.code === 'header_timeout') throw SourceJobError.of('stalled', { host: e.host }, Math.round(this.env.timeouts.headerMs / 1000));
          throw new SourceJobError('download_failed', e.message, 'Check the link, then import it again.', { host: e.host, reason: e.code }, true);
        }
        throw e;
      }
      for (const w of res.warnings) warnings.add(w);
      const status = res.status;
      if (status === 404 || status === 410) { res.body.destroy(); throw SourceJobError.of('sourceNotFound', { status }); }
      if (status === 416 && have > 0) { res.body.destroy(); fs.truncateSync(file, 0); p = { ...p, bytes: 0, etag: null, lastModified: null }; onProgress(p); continue; }
      if (status !== 200 && status !== 206) { res.body.destroy(); throw new SourceJobError('download_failed', `the server answered ${status}`, 'Check the link, then import it again.', { status }); }
      const ct = String(res.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
      if (contentTypeVerdict(ct) === 'not-media') { res.body.destroy(); throw SourceJobError.of('notMedia', { contentType: ct.slice(0, 80) }, ct.slice(0, 80) || 'no type'); }
      contentType = ct;
      let start = 0, total: number | null = null;
      if (status === 206) {
        const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(res.headers['content-range'] ?? ''));
        if (!m || Number(m[1]) !== have) { res.body.destroy(); fs.truncateSync(file, 0); p = { ...p, bytes: 0, etag: null, lastModified: null }; onProgress(p); continue; }
        start = have; total = m[3] === '*' ? null : Number(m[3]);
      } else {
        if (have > 0) fs.truncateSync(file, 0); // a 200 to a Range (a changed file or a server without ranges): from the start
        const len = Number(res.headers['content-length']);
        total = Number.isFinite(len) && len >= 0 ? len : null;
        const etag = typeof res.headers.etag === 'string' && !res.headers.etag.startsWith('W/') ? res.headers.etag : null;
        const lm = typeof res.headers['last-modified'] === 'string' ? res.headers['last-modified'] : null;
        p = { ...p, etag, lastModified: lm };
      }
      if (total !== null && total > maxBytes) { res.body.destroy(); fs.rmSync(file, { force: true }); throw SourceJobError.of('tooLarge', { maxBytes, declaredBytes: total }, maxBytes); }
      p = { ...p, bytes: start, total }; onProgress(p); this.save(jobId, p);
      try { disk((total ?? 0) - start); } catch (e) { res.body.destroy(); throw e; }
      try {
        await this.stream(jobId, res.body, file, start, maxBytes, total, signal, (n) => { p = { ...p, bytes: n }; onProgress(p); }, disk);
      } catch (e) {
        if (e instanceof FetchRefusal && (e.code === 'network' || e.code === 'stalled') && !signal.aborted) {
          if (resumes++ < DOWNLOAD_RESUMES) { this.save(jobId, p); continue; }
          if (e.code === 'stalled') throw SourceJobError.of('stalled', {}, Math.round(this.env.timeouts.idleMs / 1000));
          throw new SourceJobError('download_failed', 'the connection ended before the whole file arrived', 'Import it again; it continues where it stopped when the server allows it.', {}, true);
        }
        throw e;
      }
      const size = fs.statSync(file).size;
      if (total !== null && size !== total) { if (resumes++ < DOWNLOAD_RESUMES) { this.save(jobId, p); continue; } throw new SourceJobError('download_failed', `the file ended after ${size} of ${total} bytes`, 'Import it again.', { bytes: size, total }, true); }
      const head = Buffer.alloc(Math.min(size, 512));
      const fd = fs.openSync(file, 'r');
      try { fs.readSync(fd, head, 0, head.length, 0); } finally { fs.closeSync(fd); }
      const kind = sniffMedia(head);
      if (!kind) { fs.rmSync(file, { force: true }); throw SourceJobError.of('notMedia', { contentType }, `${contentType || 'a file'} whose bytes are not a known video, sound or picture`); }
      const sha256 = await hashFile(file);
      p = { ...p, bytes: size, total: size }; onProgress(p); this.save(jobId, p);
      return { sha256, size, kind, contentType, warnings };
    }
  }

  private async stream(jobId: string, body: NodeJS.ReadableStream & { destroy(e?: Error): void }, file: string, start: number, maxBytes: number, total: number | null, signal: AbortSignal, progress: (n: number) => void, disk: (needed: number) => void): Promise<void> {
    const fd = fs.openSync(file, start > 0 ? 'a' : 'w', 0o600);
    let n = start, lastSave = 0, nextDisk = start + SOURCES_LIMITS.diskCheckEveryBytes;
    const onAbort = () => body.destroy(new FetchRefusal('canceled', 'the download was stopped'));
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      for await (const chunk of body as AsyncIterable<Buffer>) {
        if (n + chunk.length > maxBytes) { body.destroy(); fs.closeSync(fd); fs.rmSync(file, { force: true }); throw SourceJobError.of('tooLarge', { maxBytes }, maxBytes); }
        fs.writeSync(fd, chunk);
        n += chunk.length;
        if (n >= nextDisk) { nextDisk = n + SOURCES_LIMITS.diskCheckEveryBytes; disk((total ?? n) - n); }
        const t = this.env.now();
        if (t - lastSave >= PROGRESS_MS) { lastSave = t; progress(n); this.save(jobId, { ...progressOf(this.job(jobId)!), bytes: n }); }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      try { fs.closeSync(fd); } catch { /* closed above */ }
      progress(n);
    }
  }
}

/** The default rendition: the largest one the download limit admits when sizes are known, else the first. */
export function defaultRendition(item: ServiceItem, maxBytes: number): ServiceItem['renditions'][number] {
  return item.renditions.find((r) => r.bytes !== null && r.bytes <= maxBytes) ?? item.renditions[0]!;
}
async function hashFile(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const c of fs.createReadStream(file)) h.update(c as Buffer);
  return h.digest('hex');
}
const extOf = (url: string): string | null => { try { const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname); return m ? m[1]!.toLowerCase() : null; } catch { return null; } };
/** The file name a link names (its last path segment), never its query. */
function linkName(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).pop() ?? '';
    let name = seg; try { name = decodeURIComponent(seg); } catch { /* keep as is */ }
    return (name.trim() || 'link').slice(0, 200);
  } catch { return 'link'; }
}
const fileNameOf = (a: Asset) => a.name;
/** The record of a pasted link: no licence is stated (licence `unknown`, from `none`); how it was fetched (`direct`). */
function linkRecord(input: StoredSourceInput, url: string, name: string, dl: { sha256: string; size: number; kind: 'video' | 'audio' | 'image' }, fetchedAt: string): SourceRecord {
  let pageUrl: string | undefined;
  try { const u = new URL(url); pageUrl = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`.slice(0, 500); } catch { /* none */ }
  return {
    provider: 'link', itemId: input.itemId, kind: dl.kind === 'video' ? 'video' : dl.kind === 'audio' ? 'sound' : 'photo', title: name.slice(0, 200),
    ...(pageUrl ? { pageUrl } : {}), fetchedAt, sha256: dl.sha256, byteSize: dl.size,
    licence: { id: 'unknown', name: '', from: 'none' }, flags: flagsFor('unknown'),
    link: { via: 'direct', host: (input.host ?? '').slice(0, 253) },
  };
}
/** The credential of a job after a restart (its grant, read again: a revoked grant places nothing). */
export function principalOf(gov: Governance, actor: string, grantId: string | undefined): Principal {
  if (grantId) {
    const g = gov.getGrant(grantId);
    if (g.revokedAt || (g.expiresAt && Date.parse(g.expiresAt) <= Date.now())) throw new ApiError(401, 'grant_revoked', 'the credential that asked for this import was revoked or expired; the file was imported and not placed', { grantId }, 'Place it from the media panel.');
    return { actor, kind: 'agent', scopes: g.mode === 'observe' || g.mode === 'propose' ? ['observe'] : ['observe', 'edit'], mode: g.mode, grant: g };
  }
  return actor.startsWith('agent:') ? { actor, kind: 'agent', scopes: ['observe', 'edit'] } : { actor, kind: 'user', scopes: ['observe', 'edit'] };
}
export { warningsOf };
