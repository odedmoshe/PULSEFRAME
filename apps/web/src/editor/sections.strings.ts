/** Titles of the clip inspector's folding sections (kept here so the shared dictionaries stay untouched). */
export type SectionsLang = 'he' | 'en';
export const SECTION_STRINGS = {
  he: { speed: 'מהירות', transform: 'מיקום וגודל', entrance: 'כניסה ויציאה', look: 'מראה ואפקטים', analysis: 'ניתוח', text: 'טקסט', openAll: 'פתיחת הכול', closeAll: 'סגירת הכול', group: 'מקטעים' },
  en: { speed: 'Speed', transform: 'Position and size', entrance: 'Entrance and exit', look: 'Look and effects', analysis: 'Analysis', text: 'Text', openAll: 'Open all', closeAll: 'Close all', group: 'Sections' },
} as const;
