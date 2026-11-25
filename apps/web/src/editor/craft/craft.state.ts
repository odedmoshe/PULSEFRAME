/**
 * Which craft surface is open (wave 7 craft; W3 BUILDS THIS). Kept outside the editor store so no shared file changes: a tiny
 * subscribable value the commands set and CraftHost reads (useSyncExternalStore). Never persisted.
 */
export type CraftSurface = null | { kind: 'time'; target: 'goto' | 'duration' } | { kind: 'paste' } | { kind: 'find' } | { kind: 'versions' } | { kind: 'saveVersion' };
let current: CraftSurface = null;
const listeners = new Set<() => void>();
export const craftSurface = {
  get: (): CraftSurface => current,
  set(next: CraftSurface): void { current = next; for (const l of listeners) l(); },
  subscribe(l: () => void): () => void { listeners.add(l); return () => listeners.delete(l); },
};
