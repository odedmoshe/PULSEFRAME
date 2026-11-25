/**
 * Per-viewer conveniences of the send components (localStorage, every access guarded: it can be empty or throw in a private
 * window). Only the last target size is kept, and it is never preselected: the sheet offers it as one more choice.
 */
const KEY = 'pf.send.lastTargetBytes';
export function readLastTarget(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isInteger(n) && n >= 1_000_000 && n <= 4_000_000_000 ? n : null;
  } catch { return null; }
}
export function writeLastTarget(bytes: number | null): void {
  try { if (bytes === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(bytes)); } catch { /* the choice is only a convenience */ }
}
