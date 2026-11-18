/**
 * The editor's side of the import queue (ADR-0023): files this tab is uploading, merged with the server's import jobs, as one
 * list the cards draw. The lead constructs one ImportsStore in the editor store (store.ts) with an ImportsHost built on
 * imports.api.ts and Editor.dropAsset, and forwards every SSE `job` event whose type is 'import'.
 *
 * LEAD STUB (wave 5 pre-pass): the signatures are the contract; W3 writes the store (sequential XHR uploads through host.upload,
 * the merge of local entries with server jobs by jobId, a refetch on an unknown job id debounced 250 ms and when a job enters
 * converting, the placement chain through host.place in order, provideLocal for unconverted files). Until then the state is
 * empty and every action refuses: nothing is uploaded or shown as uploading.
 *
 * Rules the lead's wiring keeps (verifier corrections):
 * - Editor.importFile(file): Promise<assetId | null> stays: it resolves when the job succeeded AND the document holding the
 *   asset is loaded. A `.cube` keeps the synchronous POST …/assets (the look panel awaits its asset id).
 * - state.uploading stays true while this tab has a local upload in flight (labels only; the picker is never disabled by it).
 * - host.place awaits the document load before Editor.dropAsset (dropAsset returns null for an asset not yet in state.doc).
 * - Phone files are never placed on the timeline; only files dropped on the timeline by this tab are, in order.
 */
import type { ImportJobView, ImportRoom } from '@pulseframe/core';

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
const notBuilt = (what: string) => new Error(`${what}: the import cards are not built yet (ADR-0023, W3); nothing was uploaded`);

export class ImportsStore {
  private listeners = new Set<() => void>();
  constructor(private host: ImportsHost) {}
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  snapshot(): ImportsState { return EMPTY; }
  /** Uploads one after another; with `place`, the first finished file goes there and each next one follows the previous clip. */
  enqueueLocal(files: File[], opts: { via: 'browser' | 'folder'; place?: { frame: number; trackId: string | null } }): void {
    throw notBuilt(`enqueueLocal(${files.length} files, ${opts.via}, project ${this.host.projectId() ?? 'none'})`);
  }
  /** Called by the editor store for every SSE `job` event whose type is 'import'. */
  onJobEvent(e: ImportJobEvent): void { throw notBuilt(`onJobEvent(${e.type})`); }
  refresh(): Promise<void> { return Promise.reject(notBuilt('refresh')); }
  retry(jobId: string): Promise<void> { return Promise.reject(notBuilt(`retry(${jobId.length})`)); }
  cancel(jobId: string): Promise<void> { return Promise.reject(notBuilt(`cancel(${jobId.length})`)); }
  dismiss(jobId: string): Promise<void> { return Promise.reject(notBuilt(`dismiss(${jobId.length})`)); }
  reset(): void { /* nothing is held yet */ }
}
