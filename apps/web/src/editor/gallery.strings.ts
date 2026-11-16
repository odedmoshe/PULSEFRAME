/** Strings of the effects gallery (kept here so the shared dictionaries stay untouched). */
export type GalleryLang = 'he' | 'en';
export const GALLERY_STRINGS = {
  he: {
    open: 'גלריית אפקטים', title: 'גלריית אפקטים', close: 'סגירת הגלריה', search: 'חיפוש לפי שם', searchPlaceholder: 'חיפוש…',
    tabs: 'סוגי מראה', effects: 'אפקטים', looks: 'מראות צבע', transitions: 'מעברים', text: 'סגנונות טקסט',
    needsGpu: 'דורש כרטיס מסך', empty: 'אין תוצאות', noFrame: 'אין תמונה בתצוגה המקדימה, לכן אין תמונות ממוזערות.', rendering: 'מצייר תמונות ממוזערות…',
    thumbNote: 'התמונות הממוזערות מצוירות מהפריים המוצג עכשיו, באותו מַרכֵּב של התצוגה והייצוא.', sample: 'אבג Abc',
  },
  en: {
    open: 'Effects gallery', title: 'Effects gallery', close: 'Close gallery', search: 'Search by name', searchPlaceholder: 'Search…',
    tabs: 'Kinds of look', effects: 'Effects', looks: 'Colour looks', transitions: 'Transitions', text: 'Text styles',
    needsGpu: 'needs a graphics adapter', empty: 'No results', noFrame: 'The preview shows no picture, so there are no thumbnails.', rendering: 'Drawing thumbnails…',
    thumbNote: 'Thumbnails are drawn from the frame on screen, by the same compositor as preview and export.', sample: 'אבג Abc',
  },
} as const;
