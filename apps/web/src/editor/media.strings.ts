/** Strings of the media library cards (kept here so the shared dictionaries stay untouched). */
export type MediaLang = 'he' | 'en';
export const MEDIA_STRINGS = {
  he: { inUse: 'בשימוש בציר הזמן', video: 'וידאו', sound: 'סאונד', image: 'תמונה', grid: 'קבצי מדיה', dropHere: 'גררו קבצים לכאן' },
  en: { inUse: 'Used on the timeline', video: 'Video', sound: 'Sound', image: 'Picture', grid: 'Media files', dropHere: 'Drop files here' },
} as const;
