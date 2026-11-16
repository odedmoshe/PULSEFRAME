/** Strings of the timeline zoom control (kept here so the shared dictionaries stay untouched). */
export const ZOOM_STRINGS = {
  he: {
    group: 'זום בציר הזמן', out: 'התרחקות', in: 'התקרבות', fit: 'התאמה לרוחב', fitTitle: 'כל הציר על המסך', slider: 'רמת זום בציר הזמן',
    value: (pps: number) => `${Math.round(pps)} פיקסלים לשנייה`,
  },
  en: {
    group: 'Timeline zoom', out: 'Zoom out', in: 'Zoom in', fit: 'Fit', fitTitle: 'Fit the whole timeline on screen', slider: 'Timeline zoom level',
    value: (pps: number) => `${Math.round(pps)} pixels per second`,
  },
} as const;
