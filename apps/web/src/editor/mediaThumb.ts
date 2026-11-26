/**
 * The picture of a media library card: which tile of the filmstrip to show, and when to load the ingest derivative.
 * No DOM and no React: network, decoding and timers are handed in, so the rules below can be tested.
 *
 * Loading rules (one loader per card):
 * - a card loads its derivative once. A derivative is keyed by content hash and does not change once it is ready, so a card
 *   that holds it (or was told it does not apply) asks the server nothing more, however many derivative events arrive;
 * - a derivative event anywhere in the project (`poke`) only makes a card that is still waiting look at the state of its
 *   OWN asset; the filmstrip itself is downloaded only when that state is "ready";
 * - while waiting without events it looks again a bounded number of times;
 * - every decoded picture is closed when it is replaced and when the card goes away, and work that is no longer wanted is aborted.
 */
export interface ThumbMeta { tileWidth: number; tileHeight: number; columns: number; rows: number; frameIndices: number[] }
export interface WaveLevel { samplesPerBucket: number; buckets: number; byteOffset: number }
export interface WaveMeta { sampleRate: number; totalSamples: number; levels: WaveLevel[] }
export type DerivativeKind = 'thumbnails' | 'waveform';
export interface DerivativeIdentity { projectId: string; assetId: string; contentHash: string; kind: DerivativeKind }
export type LoadedDerivative<P> = { kind: 'thumbnails'; bitmap: P; meta: ThumbMeta } | { kind: 'waveform'; buffer: ArrayBuffer; meta: WaveMeta };

/**
 * The tile of the filmstrip sprite to show for a pointer position across the card (0 = its left edge, 1 = its right edge).
 * `width` × `height` is the size of one tile, which has the aspect of the video itself (a portrait video gives a portrait
 * tile): the card canvas takes exactly this size and is fitted into the 16:9 box with `object-fit: contain`, never stretched.
 */
export function thumbTileAt(meta: ThumbMeta, frac: number): { index: number; sx: number; sy: number; width: number; height: number } {
  const n = Math.max(1, meta.frameIndices.length);
  const index = Math.min(n - 1, Math.max(0, Math.floor((Number.isFinite(frac) ? frac : 0) * n)));
  return { index, sx: (index % meta.columns) * meta.tileWidth, sy: Math.floor(index / meta.columns) * meta.tileHeight, width: meta.tileWidth, height: meta.tileHeight };
}

/** What a derivative row of the server means for a card that is waiting for it. */
export function derivativeStep(status: string | undefined): 'load' | 'never' | 'wait' {
  return status === 'ready' ? 'load' : status === 'not-applicable' ? 'never' : 'wait';
}

interface Reply { ok: boolean; json(): Promise<unknown>; blob(): Promise<Blob>; arrayBuffer(): Promise<ArrayBuffer> }
export interface DerivativeLoaderDeps<P> {
  /** GET with the session's credentials; rejects when the signal aborts. */
  fetch(url: string, signal: AbortSignal): Promise<Reply>;
  /** Decodes the filmstrip sprite. The loader closes every picture this returns. */
  decode(blob: Blob): Promise<P>;
  /** Called with what the card should show now. A replaced picture is closed only AFTER this call, so the receiver never holds a closed one. */
  onChange(value: LoadedDerivative<P> | null): void;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Waits between looks while the derivative is being made and no event arrives. */
  retryMs?: readonly number[];
}
export const DERIVATIVE_RETRY_MS: readonly number[] = [1000, 3000, 8000];
const sameIdentity = (a: DerivativeIdentity | null, b: DerivativeIdentity | null) =>
  a === b || (!!a && !!b && a.projectId === b.projectId && a.assetId === b.assetId && a.contentHash === b.contentHash && a.kind === b.kind);

export class DerivativeLoader<P extends { close(): void }> {
  private id: DerivativeIdentity | null = null;
  private held: LoadedDerivative<P> | null = null;
  private delivered = 0;
  /** Nothing more to ask the server for this identity: the derivative is held, or it does not apply. */
  private settled = false;
  /** Bumped whenever the work in flight stops being wanted (another file, or the card went away). */
  private run = 0;
  private busy = false;
  /** An event arrived while a look was in flight: look once more if that look ends without the derivative. */
  private again = false;
  private timer: unknown;
  private abort: AbortController | null = null;
  private disposed = false;
  private readonly retryMs: readonly number[];

  constructor(private deps: DerivativeLoaderDeps<P>) { this.retryMs = deps.retryMs ?? DERIVATIVE_RETRY_MS; }

  /** What the card shows now. */
  get current(): LoadedDerivative<P> | null { return this.held; }
  /**
   * How many times this card was handed a downloaded derivative: 1 for a card that loaded once, whatever events arrived since.
   * The card shows it as `data-loads`, so a reload can be seen on the card itself (the timeline asks the same addresses).
   */
  get loads(): number { return this.delivered; }

  /** The derivative this card should show (null: none). The same identity again changes nothing and asks nothing. */
  show(id: DerivativeIdentity | null): void {
    if (this.disposed || sameIdentity(this.id, id)) return;
    this.cancel();
    this.id = id ? { ...id } : null;
    this.settled = false;
    this.replace(null);
    if (id) this.look(0, this.run);
  }

  /** A derivative of some asset of the project changed state. Only a card that is still waiting looks at its own asset. */
  poke(): void {
    if (this.disposed || !this.id || this.settled) return;
    if (this.busy) { this.again = true; return; }
    this.stopTimer();
    this.look(0, this.run);
  }

  /** The card went away: abort what is in flight and close what is held. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    const old = this.held;
    this.held = null;
    if (old?.kind === 'thumbnails') old.bitmap.close();
  }

  private cancel() {
    this.run++;
    this.busy = false;
    this.again = false;
    this.stopTimer();
    this.abort?.abort();
    this.abort = null;
  }
  private stopTimer() {
    if (this.timer === undefined) return;
    (this.deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = undefined;
  }
  private replace(next: LoadedDerivative<P> | null) {
    const old = this.held;
    if (old === next) return;
    this.held = next;
    if (next) this.delivered++;
    this.deps.onChange(next);
    if (old?.kind === 'thumbnails') old.bitmap.close();
  }

  private look(n: number, run: number): void {
    const id = this.id;
    if (!id) return;
    this.busy = true;
    this.again = false;
    const ac = (this.abort = new AbortController());
    const stale = () => run !== this.run;
    const base = `/api/v1/projects/${encodeURIComponent(id.projectId)}/assets/${encodeURIComponent(id.assetId)}/derivatives`;
    const once = async (): Promise<'load' | 'never' | 'wait'> => {
      const r = await this.deps.fetch(base, ac.signal);
      if (stale() || !r.ok) return 'wait';
      const row = ((await r.json()) as { derivatives?: { kind: string; status: string; meta: unknown }[] }).derivatives?.find((d) => d.kind === id.kind);
      const step = derivativeStep(row?.status);
      if (stale() || step !== 'load') return step;
      const b = await this.deps.fetch(`${base}/${id.kind}`, ac.signal);
      if (stale() || !b.ok) return 'wait';
      if (id.kind === 'thumbnails') {
        const bitmap = await this.deps.decode(await b.blob());
        if (stale()) { bitmap.close(); return 'wait'; } // decoded for a card that no longer wants it
        this.replace({ kind: 'thumbnails', bitmap, meta: row!.meta as ThumbMeta });
      } else {
        const buffer = await b.arrayBuffer();
        if (stale()) return 'wait';
        this.replace({ kind: 'waveform', buffer, meta: row!.meta as WaveMeta });
      }
      return 'load';
    };
    void once().catch(() => 'wait' as const).then((step) => {
      if (stale()) return;
      this.busy = false;
      this.abort = null;
      if (step !== 'wait') { this.settled = true; return; }
      if (this.again) { this.look(0, run); return; }
      if (n < this.retryMs.length) {
        const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
        this.timer = set(() => { this.timer = undefined; if (!stale()) this.look(n + 1, run); }, this.retryMs[n]!);
      }
    });
  }
}
