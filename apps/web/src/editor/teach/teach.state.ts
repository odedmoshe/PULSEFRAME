/**
 * Whether the teach dialog is open, and for which clip (wave 8 teach). Kept outside the editor store so no shared file changes: a
 * tiny subscribable value the chip and the palette command set and TeachHost reads (useSyncExternalStore), as craft.state.ts does.
 * Never persisted. Close it through craft.state.ts closeSurface's rule (focus back to the opener first, in the same task).
 */
export type TeachSurface = null | { clipId: string };
let current: TeachSurface = null;
const listeners = new Set<() => void>();
export const teachSurface = {
  get: (): TeachSurface => current,
  set(next: TeachSurface): void { current = next; for (const l of listeners) l(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
};
