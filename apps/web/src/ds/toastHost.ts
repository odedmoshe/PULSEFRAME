/**
 * Where the toast region lives. A modal dialog makes the rest of the page inert (Dialog.tsx), and an inert subtree is neither
 * focusable nor in the accessibility tree: a toast left under it could not be reached or announced. While a modal is open the
 * region is therefore rendered inside it (WAI-ARIA dialog pattern: everything the user may need while the modal is open belongs
 * to the modal), and returns to the page when the modal closes. The open modal registers a host element; the newest one wins
 * (a dialog opened from another dialog takes the region until it closes). Pure stack + listeners: no DOM access here.
 */
export interface HostStack<T> {
  /** Register a host; returns its release (idempotent). */
  claim(el: T): () => void;
  current(): T | null;
  subscribe(listener: () => void): () => void;
}
export function createHostStack<T>(): HostStack<T> {
  const hosts: { el: T }[] = [];
  const listeners = new Set<() => void>();
  const emit = () => { for (const l of [...listeners]) l(); };
  return {
    claim(el) {
      const entry = { el };
      hosts.push(entry);
      emit();
      return () => { const i = hosts.indexOf(entry); if (i < 0) return; hosts.splice(i, 1); emit(); };
    },
    current: () => hosts.at(-1)?.el ?? null,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/**
 * How much of each toast's time is left. A toast is drawn by the page region or, while a modal is open, by that modal's slot; the
 * view is a new element each time the region moves, so the time left lives here, by toast id, and not in the view: moving the
 * region neither restarts the timer nor refills its bar.
 */
export interface ToastClock {
  /** Milliseconds left for the toast (its full time when it has never been shown). */
  left(id: string, ttl: number): number;
  save(id: string, left: number): void;
  /** Forget every toast that is no longer in the queue. */
  keepOnly(ids: string[]): void;
}
export function createToastClock(): ToastClock {
  const m = new Map<string, number>();
  return {
    left: (id, ttl) => m.get(id) ?? ttl,
    save: (id, left) => { m.set(id, left); },
    keepOnly(ids) { const keep = new Set(ids); for (const k of [...m.keys()]) if (!keep.has(k)) m.delete(k); },
  };
}
