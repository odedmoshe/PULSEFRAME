/**
 * View state of «תא הבדיקה» that is not project state (wave 8 booth, builder W3): whether the dialog is open (in memory, per viewer;
 * the rail button and the palette command both set it), the self-check rows this browser got (kept in localStorage so that closing
 * every Chrome window, which the Windows graphics step asks for, does not lose them) and the booth volume. Every localStorage access
 * is guarded: without storage everything works for this visit only. The answers themselves live on the server (owner-review.json).
 */
import { useSyncExternalStore } from 'react';
import type { BoothCheckRow } from '@pulseframe/core';
import { clampVolume, parseRows, type StoredRows } from './booth.logic.ts';

export const BOOTH_ROWS_KEY = 'pf.booth.rows';
export const BOOTH_VOLUME_KEY = 'pf.booth.volume';

let open = false;
const listeners = new Set<() => void>();
const set = (v: boolean) => { if (open === v) return; open = v; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const useBoothOpen = (): boolean => useSyncExternalStore(subscribe, () => open, () => open);
export const isBoothOpen = (): boolean => open;
export const openBooth = () => set(true);
export const closeBooth = () => set(false);

export function readRows(): StoredRows {
  try { return parseRows(localStorage.getItem(BOOTH_ROWS_KEY)); } catch { return {}; }
}
export function writeRow(row: BoothCheckRow): StoredRows {
  const next = { ...readRows(), [row.id]: row };
  try { localStorage.setItem(BOOTH_ROWS_KEY, JSON.stringify(next)); } catch { /* private window or blocked storage: the rows last for this visit only */ }
  return next;
}
export function readVolume(): number {
  try { return clampVolume(Number(localStorage.getItem(BOOTH_VOLUME_KEY))); } catch { return clampVolume(Number.NaN); }
}
export function writeVolume(v: number): void {
  try { localStorage.setItem(BOOTH_VOLUME_KEY, String(clampVolume(v))); } catch { /* the volume lasts for this visit only */ }
}
