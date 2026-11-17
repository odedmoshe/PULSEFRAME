/**
 * The media drawer by capture date and by event (life line, ADR-0021; plan §7): the view switch «הכול · לפי תאריך · אירועים»
 * (a radio group; the choice is the one thing kept in browser storage), years with sticky headers and months
 * («מרץ 2024 · אדר ב׳ תשפ״ד») with counts, the group of files without a date with «קריאת תאריכים מהקבצים», and the list of
 * events (EventRow) with «סידור לפי אירועים». Data: core calendarGroups, eventSpan, eventDisplayName.
 *
 * CONTRACT FILE (lead pre-pass): the exports and their props are fixed; W3 builds the bodies with the redesign's primitives
 * and mounts them in the media drawer. Until then nothing is drawn.
 */
import type { ReactElement } from 'react';
import { LIFE_TESTIDS } from './lifeline.testids.ts';

/** The three views of the media drawer; 'all' is the library as it was. */
export const LIFE_VIEWS = ['all', 'date', 'events'] as const;
export type LifeView = (typeof LIFE_VIEWS)[number];
/** Where the chosen view is remembered (browser storage; nothing else of the life line is kept there). */
export const LIFE_VIEW_STORAGE_KEY = 'pf.life.view';

/** The view switch under the filter chips of the media drawer. data-testid LIFE_TESTIDS.view; options LIFE_TESTIDS.viewOption(view). */
export function LifeViewSwitch(_props: { view: LifeView; onChange: (view: LifeView) => void }): ReactElement | null {
  void LIFE_TESTIDS.view;
  return null;
}
/** The body of the media drawer for the views 'date' and 'events' (the view 'all' stays the existing library). */
export function LifeLibrary(_props: { view: Exclude<LifeView, 'all'> }): ReactElement | null {
  return null;
}
