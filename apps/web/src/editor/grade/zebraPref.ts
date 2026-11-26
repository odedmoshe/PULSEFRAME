/**
 * Zebra on or off, per browser (a per-viewer convenience in localStorage, every access in try/catch; wave 8 grade). Shared by the
 * toggle in Scopes.tsx and ExposureOverlay.tsx. W3 builds it; until then zebra is off.
 */
export const ZEBRA_STORAGE_KEY = 'pf.zebra.v1';
export const readZebra = (): boolean => false;
export function writeZebra(on: boolean): void { void on; }
/** Calls `fn` when the setting changes in this tab; returns the unsubscribe. */
export function subscribeZebra(fn: (on: boolean) => void): () => void { void fn; return () => {}; }
