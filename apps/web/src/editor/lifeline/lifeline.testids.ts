/**
 * Fixed data-testids of the life-line UI (ADR-0021), shared by the editor components and the proofs (lifeline-ui-proof.ts,
 * a11y-audit.ts). Lead contracts commit: W3 puts exactly these on the elements named here.
 * People (the people sheet, the family option of the archive) are not part of this build and have no ids.
 */
/** A field as it is stored (`{date:numeric}`) as a test id part: braces dropped, the colon a dash (`date-numeric`). */
export const fieldSlug = (token: string): string => token.replace(/[{}]/g, '').replace(/:/g, '-');
export const LIFE_TESTIDS = {
  // media drawer: the view switch (a radio group) and its three options (all / date / events)
  view: 'life-view', viewOption: (view: 'all' | 'date' | 'events') => `life-view-${view}`,
  // by date: a year header, a month group (m is 1..12), the group of files without a date and its "read dates from the files" action
  year: (y: number) => `life-year-${y}`, month: (y: number, m: number) => `life-month-${y}-${m}`, undated: 'life-undated', readDates: 'life-read-dates',
  // events: "arrange by events", an event row, its name, its before/after-sunset radio group (never preselected), "add the event to the timeline"
  cluster: 'life-cluster', event: (id: string) => `life-event-${id}`, eventName: (id: string) => `life-event-name-${id}`, sunset: (id: string) => `life-sunset-${id}`, eventAdd: (id: string) => `life-event-add-${id}`,
  // media card: the date badge; the capture date editor and its save button; the multi-file clock shift
  dateBadge: (assetId: string) => `life-date-${assetId}`, captureEdit: 'life-capture-edit', captureSave: 'life-capture-save', shiftClock: 'life-shift-clock',
  // start hub: the "on this day" card and its open button
  onThisDay: 'life-on-this-day', onThisDayOpen: 'life-on-this-day-open',
  // title inspector: the "add field" menu, an item of it (by fieldSlug), the live line (aria-live), "make it plain text"
  fieldAdd: 'field-add', fieldItem: (token: string) => `field-item-${fieldSlug(token)}`, fieldLive: 'field-live', fieldFreeze: 'field-freeze',
  // look panel, date stamp: text / from the capture date, the clock switch, the date order
  stampSource: 'stamp-source', stampClock: 'stamp-clock', stampOrder: 'stamp-order',
} as const;
