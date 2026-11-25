/**
 * Session state shared by the pearls surfaces (wave 7 pearls track): what the list shows when another surface sends the user there
 * («פנינים שלא בשימוש של …» in the screen-time table opens the list filtered). View state only — never project state, never stored.
 */
import { useSyncExternalStore } from 'react';
import { setRail } from '../chromeState.ts';
import { setLifeView } from '../lifeline/lifeUi.ts';
import type { PearlFilter } from './pearls.logic.ts';

export interface PearlsUi { filter: PearlFilter; personId: string | null; /** raised on every request so the list takes it once */ n: number }
let state: PearlsUi = { filter: 'all', personId: null, n: 0 };
const subs = new Set<() => void>();
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const set = (next: Partial<PearlsUi>) => { state = { ...state, ...next }; for (const f of subs) f(); };
export const usePearlsUi = (): PearlsUi => useSyncExternalStore(subscribe, () => state, () => state);
export const getPearlsUi = (): PearlsUi => state;
/** Open the media drawer on «פנינים», optionally filtered to the unused pearls of one person. */
export function showPearls(filter: { unused?: boolean; personId?: string | null } = {}): void {
  setRail('media'); setLifeView('pearls');
  set({ filter: filter.unused ? 'unused' : 'all', personId: filter.personId ?? null, n: state.n + 1 });
}
