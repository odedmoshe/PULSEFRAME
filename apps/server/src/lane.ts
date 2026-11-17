/**
 * The compute lane (ADR-0017): one heavy holder at a time on this machine, first come first served. Speech recognition, narration,
 * local tools and each ComfyUI chunk of a frame job take it; a chunked job takes it again for every chunk, so other work can run
 * between chunks. Before each heavy holder starts, the registered hooks run (they release kept speech and tool workers, which hold
 * 2–4 GB each). While a server export runs, frame jobs dispatch no new chunk (they wait at the chunk boundary; see waitForExportIdle).
 */
import type { ComputeLane } from './aiContracts.ts';

type Hook = (label: string) => Promise<void> | void;
interface Waiter { label: string; grant: (release: () => void) => void; fail: (e: unknown) => void; signal?: AbortSignal; onAbort?: () => void }

export class FifoComputeLane implements ComputeLane {
  private holder: string | null = null;
  private waiting: Waiter[] = [];
  private hooks: Hook[] = [];
  private exports = 0;
  private exportIdle: (() => void)[] = [];

  /**
   * Resolves with a release function once the caller holds the lane. The release is idempotent. An aborted signal removes a
   * waiter from the queue (rejecting with the signal's reason) without disturbing the order of the others.
   */
  acquire(label: string, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason ?? new Error('aborted'));
    return new Promise<() => void>((resolve, reject) => {
      const w: Waiter = { label, grant: resolve, fail: reject, signal };
      if (signal) {
        w.onAbort = () => {
          const i = this.waiting.indexOf(w);
          if (i >= 0) { this.waiting.splice(i, 1); reject(signal.reason ?? new Error('aborted')); }
        };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this.waiting.push(w);
      if (this.holder === null) void this.next();
    });
  }
  /**
   * Runs before each heavy holder starts, in registration order. The hook receives the label of the holder about to start, so a
   * component can keep its own kept worker when it is the one starting. A failing hook never blocks the lane.
   */
  onBeforeHeavy(fn: Hook): void {
    this.hooks.push(fn);
  }
  busy(): { holder: string | null; waiting: number } {
    return { holder: this.holder, waiting: this.waiting.length };
  }
  /** Called around every server export (paired true/false; overlapping exports are counted). */
  setExportActive(active: boolean): void {
    this.exports = Math.max(0, this.exports + (active ? 1 : -1));
    if (this.exports === 0) for (const f of this.exportIdle.splice(0)) f();
  }
  exportActive(): boolean {
    return this.exports > 0;
  }
  /** Resolves when no server export is running (immediately when none is). Frame jobs await it before each chunk. */
  waitForExportIdle(signal?: AbortSignal): Promise<void> {
    if (this.exports === 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
      const abort = () => { const i = this.exportIdle.indexOf(done); if (i >= 0) this.exportIdle.splice(i, 1); reject(signal!.reason ?? new Error('aborted')); };
      signal?.addEventListener('abort', abort, { once: true });
      this.exportIdle.push(done);
    });
  }

  private async next(): Promise<void> {
    const w = this.waiting.shift();
    if (!w) { this.holder = null; return; }
    this.holder = w.label;
    if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
    for (const h of this.hooks) {
      try { await h(w.label); } catch { /* a hook that fails (a worker already gone) must not hold the lane */ }
    }
    let released = false;
    w.grant(() => {
      if (released) return;
      released = true;
      this.holder = null;
      void this.next();
    });
  }
}
