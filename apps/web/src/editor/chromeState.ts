/**
 * View state of the chrome that is not project state: which rail category the browser drawer shows, whether the settings
 * dialog is open, whether the start hub was set aside, and a request to open the palette on its shortcuts page. Per viewer,
 * in memory; the rail category is also remembered in this browser (localStorage, every access guarded). Nothing here is a
 * project edit, so nothing here goes through Store.commit.
 */
import { useSyncExternalStore } from 'react';

export const RAIL_CATEGORIES = ['media', 'audio', 'text', 'captions', 'effects', 'transitions', 'looks', 'elements', 'templates', 'ai'] as const;
export type RailCategory = (typeof RAIL_CATEGORIES)[number];
const KEY = 'pf.rail';

interface Chrome { rail: RailCategory; settingsOpen: boolean; hubSetAside: boolean; paletteView: 'palette' | 'shortcuts' }
const read = (): RailCategory => {
  try { const v = localStorage.getItem(KEY); return (RAIL_CATEGORIES as readonly string[]).includes(v ?? '') ? (v as RailCategory) : 'media'; } catch { return 'media'; }
};
let state: Chrome = { rail: read(), settingsOpen: false, hubSetAside: false, paletteView: 'palette' };
const listeners = new Set<() => void>();
const set = (patch: Partial<Chrome>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const useChrome = (): Chrome => useSyncExternalStore(subscribe, () => state, () => state);
export const getChrome = (): Chrome => state;
export function setRail(rail: RailCategory) {
  try { localStorage.setItem(KEY, rail); } catch { /* private window: the choice lasts for this visit only */ }
  set({ rail });
}
export const setSettingsOpen = (settingsOpen: boolean) => set({ settingsOpen });
export const setHubSetAside = (hubSetAside: boolean) => set({ hubSetAside });
export const setPaletteView = (paletteView: Chrome['paletteView']) => set({ paletteView });
