/**
 * The ingest derivatives the timeline clips draw from (the filmstrip sprite of a video, the waveform of a sound), held once per
 * file and shared by every clip that shows it. No DOM and no React: network, decoding and timers are handed in, so the rules
 * below can be tested (clipVisuals.cache.test.ts). The media library cards follow the same rules per card (editor/mediaThumb.ts).
 *
 * - A derivative is keyed by project, asset, content hash and kind. Once it is ready it does not change, so it is downloaded
 *   and decoded once: more clips of the same file, an edit, a re-render, playback, a remount of a clip ask the server nothing.
 * - While a derivative is being made (or its last look failed) the entry waits. It looks again when the server announces a
 *   change for its asset (`changed`, from the editor's 'derivative' events), and, while it is being made, a bounded number of
 *   times on a timer. An announcement for another asset costs it nothing.
 * - Entries that no clip shows any more are kept, up to `limit` of them, so a clip that comes back (an undo, a move to another
 *   track) finds its picture; beyond that the least recently used are dropped and their pictures closed. An entry that a clip
 *   shows is never dropped, so a timeline with many files does not download them again and again.
 * - Nothing is invented: a derivative that is not ready is shown as being made, failed or not applicable, as the server says.
 */
import { DERIVATIVE_RETRY_MS, type DerivativeKind, type ThumbMeta, type WaveMeta } from './editor/mediaThumb.ts';

export type { DerivativeKind, ThumbMeta, WaveMeta };
export interface ClipDerivativeKey { projectId: string; assetId: string; contentHash: string; kind: DerivativeKind }
export type ClipDerivative<P> =
  | { state: 'processing' }
  | { state: 'failed' }
  | { state: 'none' }
  | { state: 'ready'; kind: 'thumbnails'; bitmap: P; meta: ThumbMeta }
  | { state: 'ready'; kind: 'waveform'; buffer: ArrayBuffer; meta: WaveMeta };

interface Reply { ok: boolean; status?: number; json(): Promise<unknown>; blob(): Promise<Blob>; arrayBuffer(): Promise<ArrayBuffer> }
export interface ClipDerivativeDeps<P> {
  /** GET with the session's credentials; rejects when the signal aborts. */
  fetch(url: string, signal: AbortSignal): Promise<Reply>;
  /** Decodes the filmstrip sprite. The cache closes every picture this returns, when its entry is dropped. */
  decode(blob: Blob): Promise<P>;
  /** Entries no clip shows that are kept (default 24). */
  limit?: number;
  retryMs?: readonly number[];
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
}

export const isThumbMeta = (m: any): m is ThumbMeta =>
  !!m && [m.tileWidth, m.tileHeight, m.columns, m.rows].every((n) => Number.isInteger(n) && n > 0) && Array.isArray(m.frameIndices) && m.frameIndices.length > 0 && m.frameIndices.every(Number.isInteger);
export const isWaveMeta = (m: any): m is WaveMeta =>
  !!m && Number.isInteger(m.sampleRate) && m.sampleRate > 0 && Number.isInteger(m.totalSamples) && Array.isArray(m.levels) && m.levels.length > 0 &&
  m.levels.every((l: any) => Number.isInteger(l?.samplesPerBucket) && l.samplesPerBucket > 0 && Number.isInteger(l.buckets) && Number.isInteger(l.byteOffset));

export const clipDerivativeKey = (k: ClipDerivativeKey) => JSON.stringify([k.projectId, k.assetId, k.contentHash, k.kind]);

interface Entry<P> {
  key: ClipDerivativeKey;
  value: ClipDerivative<P> | undefined;
  users: number;
  /** When the last clip stopped showing it (for dropping the least recently used). */
  idleSince: number;
  busy: boolean;
  /** A change was announced while a look was in flight: look once more if that look ends without the derivative. */
  again: boolean;
  timer: unknown;
  tries: number;
  abort: AbortController | null;
  dropped: boolean;
}
const PROCESSING = { state: 'processing' } as const, FAILED = { state: 'failed' } as const, NONE = { state: 'none' } as const;

export class ClipDerivativeCache<P extends { close(): void }> {
  private entries = new Map<string, Entry<P>>();
  private listeners = new Set<() => void>();
  private clock = 0;
  private readonly limit: number;
  private readonly retryMs: readonly number[];

  constructor(private deps: ClipDerivativeDeps<P>) {
    this.limit = deps.limit ?? 24;
    this.retryMs = deps.retryMs ?? DERIVATIVE_RETRY_MS;
  }

  /** What the clips of this derivative show now; undefined until the first look has answered. Stable until it changes. */
  peek(id: string): ClipDerivative<P> | undefined { return this.entries.get(id)?.value; }

  /** Called whenever an entry changes (for useSyncExternalStore). */
  subscribe = (fn: () => void): (() => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };

  /**
   * A clip shows this derivative. It is loaded when nothing is held or on its way, and looked at again when its last look
   * failed; otherwise this asks nothing. Returns the function that ends this use.
   */
  use(key: ClipDerivativeKey): () => void {
    const id = clipDerivativeKey(key);
    let e = this.entries.get(id);
    if (!e) { e = { key: { ...key }, value: undefined, users: 0, idleSince: 0, busy: false, again: false, timer: undefined, tries: 0, abort: null, dropped: false }; this.entries.set(id, e); }
    e.users++;
    if (!e.busy && (e.value === undefined || e.value.state === 'failed')) this.look(e);
    let ended = false;
    const entry = e;
    return () => {
      if (ended) return;
      ended = true;
      entry.users--;
      if (entry.users === 0) { entry.idleSince = ++this.clock; this.trim(); }
    };
  }

  /**
   * The server announced that a derivative of this asset changed state. Entries of that asset (and of other assets with the
   * same file, which share its derivatives on the server) that are still waiting look again; entries that hold their
   * derivative, or know it does not apply, ask nothing. With `kind`, only entries of that kind (a proxy file being made
   * concerns no clip visual).
   */
  changed(projectId: string, assetId: string, kind?: string): void {
    const hashes = new Set<string>();
    for (const e of this.entries.values()) if (e.key.projectId === projectId && e.key.assetId === assetId) hashes.add(e.key.contentHash);
    for (const e of this.entries.values()) {
      if (e.key.projectId !== projectId || (e.key.assetId !== assetId && !hashes.has(e.key.contentHash)) || (kind !== undefined && kind !== e.key.kind)) continue;
      if (e.value?.state === 'ready' || e.value?.state === 'none') continue;
      if (e.busy) { e.again = true; continue; }
      this.stopTimer(e);
      e.tries = 0;
      this.look(e);
    }
  }

  /** Drops everything (the editor went away): aborts what is in flight and closes every picture. */
  clear(): void {
    for (const e of [...this.entries.values()]) this.drop(e);
  }

  /** Entries held now, for tests. */
  get size(): number { return this.entries.size; }

  private emit() { for (const fn of [...this.listeners]) fn(); }
  private set(e: Entry<P>, value: ClipDerivative<P>) {
    if (e.dropped || e.value === value) return;
    e.value = value;
    this.emit();
  }
  private stopTimer(e: Entry<P>) {
    if (e.timer === undefined) return;
    (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(e.timer);
    e.timer = undefined;
  }
  private drop(e: Entry<P>) {
    e.dropped = true;
    this.stopTimer(e);
    e.abort?.abort();
    e.abort = null;
    e.busy = false;
    this.entries.delete(clipDerivativeKey(e.key));
    if (e.value?.state === 'ready' && e.value.kind === 'thumbnails') e.value.bitmap.close();
  }
  /** Keeps at most `limit` entries that no clip shows; the ones idle longest go first. */
  private trim() {
    const idle = [...this.entries.values()].filter((e) => e.users === 0).sort((a, b) => a.idleSince - b.idleSince);
    for (let i = 0; i < idle.length - this.limit; i++) this.drop(idle[i]!);
  }

  private look(e: Entry<P>): void {
    e.busy = true;
    e.again = false;
    const ac = (e.abort = new AbortController());
    const k = e.key;
    const base = `/api/v1/projects/${encodeURIComponent(k.projectId)}/assets/${encodeURIComponent(k.assetId)}/derivatives`;
    const once = async (): Promise<'settled' | 'processing' | 'failed'> => {
      const r = await this.deps.fetch(base, ac.signal);
      if (!r.ok) throw new Error(`derivatives ${r.status}`);
      const row = ((await r.json()) as { derivatives?: { kind: string; status: string; meta: unknown }[] }).derivatives?.find((d) => d.kind === k.kind);
      if (e.dropped) return 'settled';
      if (!row || row.status === 'not-applicable') { this.set(e, NONE); return 'settled'; }
      if (row.status === 'queued' || row.status === 'running') { this.set(e, PROCESSING); return 'processing'; }
      if (row.status !== 'ready' || !(k.kind === 'thumbnails' ? isThumbMeta(row.meta) : isWaveMeta(row.meta))) { this.set(e, FAILED); return 'failed'; }
      const b = await this.deps.fetch(`${base}/${k.kind}`, ac.signal);
      if (!b.ok) throw new Error(`derivative ${k.kind} ${b.status}`);
      if (k.kind === 'thumbnails') {
        const bitmap = await this.deps.decode(await b.blob());
        if (e.dropped) { bitmap.close(); return 'settled'; } // decoded for an entry that went away meanwhile
        this.set(e, { state: 'ready', kind: 'thumbnails', bitmap, meta: row.meta as ThumbMeta });
      } else {
        const buffer = await b.arrayBuffer();
        if (e.dropped) return 'settled';
        this.set(e, { state: 'ready', kind: 'waveform', buffer, meta: row.meta as WaveMeta });
      }
      return 'settled';
    };
    void once().catch(() => {
      if (!e.dropped && !ac.signal.aborted) this.set(e, FAILED);
      return 'failed' as const;
    }).then((step) => {
      if (e.dropped || e.abort !== ac) return;
      e.busy = false;
      e.abort = null;
      if (step === 'settled') return;
      if (e.again) { this.look(e); return; }
      // being made: look again a few times while no announcement comes; a failure waits for one (or for a clip to come back)
      if (step === 'processing' && e.tries < this.retryMs.length) {
        const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
        e.timer = set(() => { e.timer = undefined; if (!e.dropped && !e.busy) this.look(e); }, this.retryMs[e.tries++]!);
      }
    });
  }
}

/** The one cache of the timeline in this page: clips draw from it (ClipVisuals.tsx), the editor tells it about derivative events (store.ts). */
export const timelineDerivatives = new ClipDerivativeCache<ImageBitmap>({
  fetch: (url, signal) => fetch(url, { credentials: 'same-origin', signal }),
  decode: (blob) => createImageBitmap(blob),
});
