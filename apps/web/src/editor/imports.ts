/**
 * The editor's side of the import queue (ADR-0023): files this tab is uploading, merged with the server's import jobs, as one
 * list the cards draw. The lead constructs one ImportsStore in the editor store (store.ts) with an ImportsHost built on
 * imports.api.ts and Editor.dropAsset, and forwards every SSE `job` event whose type is 'import'.
 *
 * Built by W3: sequential XHR uploads through host.upload (one at a time), the merge of local entries with server jobs by jobId
 * (a local entry is dropped once its upload returned a job; the job takes over the card), a refetch on an unknown job id
 * debounced 250 ms and when a job enters converting, the placement chain through host.place in order (imports.logic.ts), and
 * provideLocal for files the server stored unconverted (event output.converted === false).
 *
 * Rules the lead's wiring keeps (verifier corrections):
 * - Editor.importFile(file): Promise<assetId | null> stays: it resolves when the job succeeded AND the document holding the
 *   asset is loaded. A `.cube` keeps the synchronous POST …/assets (the look panel awaits its asset id).
 * - state.uploading stays true while this tab has a local upload in flight (labels only; the picker is never disabled by it).
 * - host.place awaits the document load before Editor.dropAsset (dropAsset returns null for an asset not yet in state.doc).
 * - Phone files are never placed on the timeline; only files dropped on the timeline by this tab are, in order.
 */
import { importCardState, type ImportJobView, type ImportRoom } from '@pulseframe/core';
import { placementStep, planFolderImport, skippedOf, startPlacement, withQueuePositions, type PlacementEvent, type PlacementState } from './imports.logic.ts';

export interface LocalImport {
  localId: string; name: string; byteSize: number; via: 'browser' | 'folder';
  /** 'uploading' with percent; 'pending-upload' behind the one upload in flight; 'not-uploaded' when the upload failed or was canceled (reason says why). */
  state: 'uploading' | 'pending-upload' | 'not-uploaded';
  percent: number; jobId: string | null; reason: string | null;
}
export interface ImportsState {
  local: LocalImport[];
  jobs: ImportJobView[];
  room: ImportRoom | null;
  skipped: { count: number; reason: 'not-media' | 'too-many' } | null;
}
export interface ImportsHost {
  projectId(): string | null;
  /** XMLHttpRequest upload to POST …/imports with progress; abort() cancels it (imports.api.ts uploadImport). */
  upload(projectId: string, file: File, meta: { via: 'browser' | 'folder'; relativePath?: string; batchId: string }, onProgress: (sent: number, total: number) => void): { done: Promise<{ job: ImportJobView }>; abort(): void };
  list(projectId: string): Promise<{ imports: ImportJobView[]; room: ImportRoom }>;
  retry(jobId: string): Promise<unknown>;
  cancel(jobId: string): Promise<unknown>;
  dismiss(jobId: string): Promise<unknown>;
  /** Places a finished file on the timeline through the existing dropAsset, after the document holding it is loaded; resolves to the frame after the new clip, or null when nothing was placed. */
  place(assetId: string, frame: number, trackId: string | null): Promise<number | null>;
  /** The local file is byte-identical to the stored asset (not converted): let the media pool use it. */
  provideLocal(assetId: string, file: File): void;
}
/** A job event as the editor's SSE stream delivers it (apps/server/src/http.ts: no input, output and error as stored). */
export interface ImportJobEvent { id: string; type: string; status: string; stage: string | null; output: unknown; error: unknown }

const EMPTY: ImportsState = Object.freeze({ local: [], jobs: [], room: null, skipped: null }) as ImportsState;
/** A finished card stays this long before the real asset card takes its place. */
export const READY_LINGER_MS = 2000;
/** A job event for a job this tab does not know, or one that entered converting: the list is refetched after this quiet time. */
export const REFETCH_DEBOUNCE_MS = 250;

const RELATIVE_PATHS = new WeakMap<File, string>();
/** Remembers where a file sat inside a dropped folder (a File from a drop has no webkitRelativePath). */
export function setRelativePath(file: File, path: string): void { RELATIVE_PATHS.set(file, path); }
const pathOf = (f: File): string | undefined => RELATIVE_PATHS.get(f) ?? ((f as { webkitRelativePath?: string }).webkitRelativePath || undefined);
const codeOf = (e: unknown): string => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : 'network_error');
let counter = 0;
const newId = (p: string) => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

interface Pending { localId: string; file: File; via: 'browser' | 'folder'; relativePath?: string; batchId: string }

export class ImportsStore {
  private listeners = new Set<() => void>();
  private local: LocalImport[] = [];
  private jobs: ImportJobView[] = [];
  private room: ImportRoom | null = null;
  private skipped: ImportsState['skipped'] = null;
  private state: ImportsState = EMPTY;
  private queue: Pending[] = [];
  private current: { localId: string; abort(): void } | null = null;
  /** The file this tab sent for a job, until the job ends: placement and provideLocal need it. */
  private sent = new Map<string, { file: File; localId: string }>();
  private placement: PlacementState | null = null;
  private placementLocal = new Map<string, string>(); // jobId -> localId
  private refetchTimer: ReturnType<typeof setTimeout> | null = null;
  private lingerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private epoch = 0;
  constructor(private host: ImportsHost) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  snapshot(): ImportsState { return this.state; }
  private emit(): void {
    this.state = { local: this.local.map((l) => ({ ...l })), jobs: withQueuePositions(this.jobs), room: this.room, skipped: this.skipped };
    for (const fn of [...this.listeners]) fn();
  }
  /** True while this tab has an upload in flight or waiting (the editor's `uploading` label; never disables a picker). */
  get uploading(): boolean { return this.current !== null || this.queue.length > 0; }

  /** Uploads one after another; with `place`, the first finished file goes there and each next one follows the previous clip. */
  enqueueLocal(files: File[], opts: { via: 'browser' | 'folder'; place?: { frame: number; trackId: string | null } }): void {
    this.skipped = null;
    const batchId = newId('b');
    const projectId = this.host.projectId();
    const added: Pending[] = files.map((file) => ({ localId: newId('l'), file, via: opts.via, ...(opts.via === 'folder' && pathOf(file) ? { relativePath: pathOf(file)! } : {}), batchId }));
    if (opts.place && added.length) this.placement = startPlacement(added.map((p) => p.localId), opts.place);
    if (projectId === null) {
      for (const p of added) this.local.push({ localId: p.localId, name: p.file.name, byteSize: p.file.size, via: p.via, state: 'not-uploaded', percent: 0, jobId: null, reason: 'no_project' });
      for (const p of added) this.settlePlacement(p.localId, null);
      this.emit();
      return;
    }
    for (const p of added) this.local.push({ localId: p.localId, name: p.file.name, byteSize: p.file.size, via: p.via, state: 'pending-upload', percent: 0, jobId: null, reason: null });
    this.queue.push(...added);
    this.emit();
    this.pump();
  }
  /** A dropped or picked folder: media only, in natural order, at most 500; what was left out is counted in `skipped`. */
  enqueueFolder(entries: { file: File; relativePath: string }[]): void {
    const plan = planFolderImport(entries.map((e) => ({ ...e, name: e.file.name, size: e.file.size })));
    for (const e of plan.files) setRelativePath(e.file, e.relativePath);
    this.enqueueLocal(plan.files.map((e) => e.file), { via: 'folder' });
    this.skipped = skippedOf(plan);
    this.emit();
  }
  clearSkipped(): void { if (this.skipped) { this.skipped = null; this.emit(); } }

  private pump(): void {
    if (this.current) return;
    const next = this.queue.shift();
    if (!next) return;
    const projectId = this.host.projectId();
    const entry = this.local.find((l) => l.localId === next.localId);
    if (!entry) { this.pump(); return; } // removed while waiting
    if (projectId === null) { this.failLocal(next.localId, 'no_project'); this.pump(); return; }
    entry.state = 'uploading'; entry.percent = 0;
    const epoch = this.epoch;
    let handle: ReturnType<ImportsHost['upload']>;
    try {
      handle = this.host.upload(projectId, next.file, { via: next.via, ...(next.relativePath ? { relativePath: next.relativePath } : {}), batchId: next.batchId }, (sent, total) => {
        if (epoch !== this.epoch) return;
        const pct = total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 0;
        if (pct !== entry.percent) { entry.percent = pct; this.emit(); }
      });
    } catch (e) { this.failLocal(next.localId, codeOf(e)); this.pump(); return; }
    this.current = { localId: next.localId, abort: handle.abort };
    this.emit();
    handle.done.then(
      ({ job }) => {
        if (epoch !== this.epoch) return;
        this.current = null;
        this.local = this.local.filter((l) => l.localId !== next.localId);
        this.sent.set(job.jobId, { file: next.file, localId: next.localId });
        this.placementLocal.set(job.jobId, next.localId);
        this.upsertJob(job);
        this.emit();
        this.afterJob(job);
        this.pump();
      },
      (e) => {
        if (epoch !== this.epoch) return;
        this.current = null;
        this.failLocal(next.localId, codeOf(e));
        this.pump();
      });
  }
  private failLocal(localId: string, reason: string): void {
    const l = this.local.find((x) => x.localId === localId);
    if (l) { l.state = 'not-uploaded'; l.reason = reason; l.percent = 0; }
    this.settlePlacement(localId, null);
    this.emit();
  }
  /** Stops a local upload before it has a job, or removes one that did not upload. */
  cancelLocal(localId: string): void {
    const l = this.local.find((x) => x.localId === localId);
    if (!l) return;
    if (this.current?.localId === localId) { this.current.abort(); return; } // its rejection marks it 'canceled'
    this.queue = this.queue.filter((p) => p.localId !== localId);
    this.local = this.local.filter((x) => x.localId !== localId);
    this.settlePlacement(localId, null);
    this.emit();
  }

  private mergeJob(old: ImportJobView | undefined, next: ImportJobView): ImportJobView {
    const done = (j: ImportJobView) => j.state === 'ready' || j.state === 'failed' || j.state === 'canceled';
    return old && done(old) && !done(next) && old.attempt >= next.attempt ? old : next;
  }
  private upsertJob(job: ImportJobView): void {
    const at = this.jobs.findIndex((j) => j.jobId === job.jobId);
    if (at < 0) this.jobs = [...this.jobs, job];
    else this.jobs = this.jobs.map((j, i) => (i === at ? this.mergeJob(j, job) : j));
  }

  /** Called by the editor store for every SSE `job` event whose type is 'import'. */
  onJobEvent(e: ImportJobEvent): void {
    if (e.type !== 'import') return;
    const old = this.jobs.find((j) => j.jobId === e.id);
    if (!old) { this.refreshSoon(); return; }
    const card = importCardState({ status: e.status, stage: e.stage });
    const out = (e.output && typeof e.output === 'object' ? e.output : {}) as { assetId?: unknown; deduplicated?: unknown; converted?: unknown; reasons?: unknown };
    const err = (e.error && typeof e.error === 'object' ? e.error : null) as { code?: unknown; message?: unknown; retryable?: unknown } | null;
    const next: ImportJobView = {
      ...old, ...card,
      queuePosition: card.waitingFor === 'turn' ? old.queuePosition : null,
      reasons: Array.isArray(out.reasons) ? (out.reasons as ImportJobView['reasons']) : old.reasons,
      assetId: typeof out.assetId === 'string' ? out.assetId : old.assetId,
      deduplicated: typeof out.deduplicated === 'boolean' ? out.deduplicated : old.deduplicated,
      error: card.state === 'failed' || card.state === 'canceled'
        ? (err && typeof err.code === 'string' ? { code: err.code as never, message: typeof err.message === 'string' ? err.message : '', retryable: err.retryable === true } : old.error)
        : null,
    };
    const merged = this.mergeJob(old, next);
    if (merged === old) return;
    this.jobs = this.jobs.map((j) => (j.jobId === old.jobId ? merged : j));
    if (card.state === 'converting' && old.state !== 'converting') this.refreshSoon(); // fresh reasons and queue positions
    if (card.state === 'ready' && !merged.assetId) this.refreshSoon();
    this.emit();
    this.afterJob(merged, out.converted);
  }
  /** What a job reaching an end means for this tab: placement, the local file for the media pool, the linger timer. */
  private afterJob(job: ImportJobView, converted?: unknown): void {
    if (job.state === 'ready') {
      const mine = this.sent.get(job.jobId);
      if (mine && job.assetId) {
        if (converted === false) { try { this.host.provideLocal(job.assetId, mine.file); } catch { /* the pool is a convenience */ } }
      }
      this.settlePlacement(this.placementLocal.get(job.jobId), job.assetId);
      this.sent.delete(job.jobId);
      if (!this.lingerTimers.has(job.jobId)) {
        const epoch = this.epoch;
        this.lingerTimers.set(job.jobId, setTimeout(() => {
          this.lingerTimers.delete(job.jobId);
          if (epoch !== this.epoch) return;
          this.jobs = this.jobs.filter((j) => !(j.jobId === job.jobId && j.state === 'ready'));
          this.emit();
        }, READY_LINGER_MS));
      }
    } else if (job.state === 'failed' || job.state === 'canceled') {
      this.settlePlacement(this.placementLocal.get(job.jobId), null);
      this.sent.delete(job.jobId);
    }
  }
  private settlePlacement(localId: string | undefined, assetId: string | null): void {
    if (!localId || !this.placement) return;
    this.runPlacement({ kind: 'finished', localId, assetId });
  }
  private runPlacement(ev: PlacementEvent): void {
    if (!this.placement) return;
    const { state, place } = placementStep(this.placement, ev);
    this.placement = state;
    if (place) {
      const epoch = this.epoch;
      Promise.resolve().then(() => this.host.place(place.assetId, place.frame, place.trackId)).then((n) => n, () => null).then((nextFrame) => {
        if (epoch !== this.epoch) return;
        this.runPlacement({ kind: 'placed', nextFrame });
      });
    } else if (state.nextIndex >= state.order.length) this.placement = null;
  }

  private refreshSoon(): void {
    if (this.refetchTimer) clearTimeout(this.refetchTimer);
    this.refetchTimer = setTimeout(() => { this.refetchTimer = null; void this.refresh().catch(() => undefined); }, REFETCH_DEBOUNCE_MS);
  }
  async refresh(): Promise<void> {
    const projectId = this.host.projectId();
    if (projectId === null) return;
    const epoch = this.epoch;
    const { imports, room } = await this.host.list(projectId);
    if (epoch !== this.epoch) return;
    // The server lists open jobs and failed or canceled ones not yet dismissed; a finished one this tab still shows stays for its linger.
    const keepReady = this.jobs.filter((j) => j.state === 'ready' && !imports.some((s) => s.jobId === j.jobId));
    const known = new Map(this.jobs.map((j) => [j.jobId, j] as const));
    const fresh = imports.map((s) => this.mergeJob(known.get(s.jobId), s));
    this.jobs = [...fresh, ...keepReady];
    this.room = room;
    this.emit();
    for (const j of fresh) if (j.state === 'failed' || j.state === 'canceled') this.afterJob(j);
  }
  async retry(jobId: string): Promise<void> { await this.host.retry(jobId); await this.refresh(); }
  async cancel(jobId: string): Promise<void> { await this.host.cancel(jobId); await this.refresh(); }
  async dismiss(jobId: string): Promise<void> {
    await this.host.dismiss(jobId);
    this.jobs = this.jobs.filter((j) => j.jobId !== jobId);
    this.sent.delete(jobId);
    this.emit();
  }
  /** The project changed or the editor closed: aborts the upload in flight and forgets everything. */
  reset(): void {
    this.epoch++;
    try { this.current?.abort(); } catch { /* already finished */ }
    this.current = null;
    this.queue = []; this.local = []; this.jobs = []; this.room = null; this.skipped = null;
    this.sent.clear(); this.placement = null; this.placementLocal.clear();
    if (this.refetchTimer) { clearTimeout(this.refetchTimer); this.refetchTimer = null; }
    for (const t of this.lingerTimers.values()) clearTimeout(t);
    this.lingerTimers.clear();
    this.emit();
  }
}
