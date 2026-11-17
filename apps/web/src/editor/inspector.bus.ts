/**
 * View state the stage and the inspector share and the editor store does not hold yet: which cut is chosen (a cut is the
 * start of a picture clip that follows another one directly), whether the cut loupe is shown in the viewer, a tab another
 * part of the editor asks the inspector to open, and a short note for the stage. None of it is project state: nothing here
 * is saved or sent, and no edit depends on it (edits go through the store as registered operations).
 *
 * Interface for the timeline's cut chips and the gallery: `selectCut(clipId)` after selecting the clip that starts at the
 * cut; `openInspectorTab('effects')` after applying an effect. The lead may move these fields into the store later.
 */
import { useSyncExternalStore } from 'react';
import type { ObjectTab } from './inspector.model.ts';

export interface InspectorView {
  /** the id of the clip whose start is the chosen cut, or null */
  cutClipId: string | null;
  /** the two-up of the frames around the chosen cut is shown in the viewer */
  loupe: boolean;
  /** a tab asked for from outside the inspector; `n` makes each request new */
  tabRequest: { tab: ObjectTab; n: number } | null;
  /** a quiet line over the viewer ("the playhead moved into the title"), with the time it was said */
  stageNote: { text: string; at: number } | null;
}
let view: InspectorView = { cutClipId: null, loupe: false, tabRequest: null, stageNote: null };
const listeners = new Set<() => void>();
const emit = (patch: Partial<InspectorView>) => { view = { ...view, ...patch }; listeners.forEach((l) => l()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const getInspectorView = () => view;
export const useInspectorView = (): InspectorView => useSyncExternalStore(subscribe, getInspectorView, getInspectorView);

/** Choose the cut at the start of `clipId` (the clip must be the selection), or clear it with null. Choosing a cut shows the loupe. */
export function selectCut(clipId: string | null, opts: { loupe?: boolean } = {}) {
  if (view.cutClipId === clipId && (opts.loupe === undefined || opts.loupe === view.loupe)) return;
  emit({ cutClipId: clipId, loupe: clipId ? opts.loupe ?? true : false });
}
export function setLoupe(on: boolean) { if (view.loupe !== on) emit({ loupe: on }); }
let requests = 0;
/** Ask the inspector to show a tab of the selected object (it ignores a tab the object does not have). */
export function openInspectorTab(tab: ObjectTab) { emit({ tabRequest: { tab, n: ++requests } }); }
export function sayOnStage(text: string | null) { emit({ stageNote: text ? { text, at: Date.now() } : null }); }
