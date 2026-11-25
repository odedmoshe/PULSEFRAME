/**
 * Which craft surface is open (wave 7 craft). Kept outside the editor store so no shared file changes: a tiny subscribable value
 * the commands set and CraftHost reads (useSyncExternalStore). Never persisted. `serial` grows with every set, so a surface that is
 * already open (the find panel, when Ctrl+F is pressed again) can take the focus back.
 */
export type CraftSurface = null | { kind: 'time'; target: 'goto' | 'duration' } | { kind: 'paste' } | { kind: 'find' } | { kind: 'versions' } | { kind: 'saveVersion' };
let current: CraftSurface = null;
let serial = 0;
const listeners = new Set<() => void>();
export const craftSurface = {
  get: (): CraftSurface => current,
  get serial(): number { return serial; },
  set(next: CraftSurface): void { current = next; serial++; for (const l of listeners) l(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
};
