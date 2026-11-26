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

/**
 * Close the open surface and give the focus back, in that one task and focus first: the focus is on `back` before the surface (and the
 * field that had the focus) is gone, so the next key typed goes there. A focus() deferred to a timer left the focus on the page body
 * between the unmount and the timer, where a key went to the page instead (craft proof U1, 2026-11-26: «the focus did not return to
 * the timecode» read right after the time field closed). `back` null, or not in the page any more: the surface closes, focus untouched.
 */
export function closeSurface(back: HTMLElement | null | undefined): void {
  if (back && back.isConnected) back.focus();
  craftSurface.set(null);
}
