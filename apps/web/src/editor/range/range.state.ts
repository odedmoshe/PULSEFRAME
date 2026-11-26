/**
 * The range marks of the open project (wave 8D P5 b): view state of this tab only, never stored in the project and never
 * committed. A different project starts without marks.
 */
import { useSyncExternalStore } from 'react';
import { NO_RANGE, type RangeMarks } from './range.logic.ts';

let marks: RangeMarks = NO_RANGE;
let owner: string | null = null;
const listeners = new Set<() => void>();

export const rangeStore = {
  /** The marks of project `projectId` (none when the marks belong to another project). */
  get(projectId: string | null | undefined): RangeMarks { return projectId && owner === projectId ? marks : NO_RANGE; },
  set(projectId: string, next: RangeMarks) {
    if (owner === projectId && next.in === marks.in && next.out === marks.out) return;
    owner = projectId; marks = next;
    for (const l of [...listeners]) l();
  },
  clear() { if (marks === NO_RANGE) return; marks = NO_RANGE; for (const l of [...listeners]) l(); },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

/** The marks of the project shown, re-rendering when they change. */
export function useRange(projectId: string | null | undefined): RangeMarks {
  return useSyncExternalStore(rangeStore.subscribe, () => rangeStore.get(projectId));
}
