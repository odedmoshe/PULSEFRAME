/**
 * View state of the life-line screens that is not project state (ADR-0021): which view of the media drawer is shown, and
 * whether the people sheet is open (and which person to focus). Per viewer, in memory. The chosen library view is the one
 * thing of the life line kept in browser storage (every access guarded); nothing here is a project edit.
 */
import { useSyncExternalStore } from 'react';
import { readLifeView, writeLifeView, type LifeView } from './lifeLibrary.logic.ts';

interface Ui { view: LifeView; peopleOpen: boolean; peopleFocus: string | null; /** an event to bring into view in the events list (a request counter makes each one new) */ showEvent: { eventId: string; n: number } | null }
let state: Ui = { view: readLifeView(), peopleOpen: false, peopleFocus: null, showEvent: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<Ui>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
let requests = 0;

export const useLifeUi = (): Ui => useSyncExternalStore(subscribe, () => state, () => state);
export const getLifeUi = (): Ui => state;
export function setLifeView(view: LifeView): void { writeLifeView(view); set({ view }); }
export function openPeople(focusPersonId: string | null = null): void { set({ peopleOpen: true, peopleFocus: focusPersonId }); }
export function closePeople(): void { set({ peopleOpen: false, peopleFocus: null }); }
/** Bring an event into view: the media drawer shows the events view and the row scrolls to the middle and takes the focus. */
export function showEvent(eventId: string): void { setLifeView('events'); set({ showEvent: { eventId, n: ++requests } }); }
