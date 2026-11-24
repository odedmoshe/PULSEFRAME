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
