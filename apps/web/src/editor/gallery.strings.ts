/** Strings of the effects gallery (kept here so the shared dictionaries stay untouched). */
export type GalleryLang = 'he' | 'en';
export const GALLERY_STRINGS = {
  he: {
    open: 'גלריית אפקטים', title: 'גלריית אפקטים', close: 'סגירת הגלריה', search: 'חיפוש לפי שם', searchPlaceholder: 'חיפוש…',
    tabs: 'סוגי מראה', effects: 'אפקטים', looks: 'מראות צבע', transitions: 'מעברים', text: 'סגנונות טקסט', motion: 'תנועה',
    motionGroups: { in: 'כניסה', out: 'יציאה', loop: 'לולאה', move: 'תנועה לאורך הקליפ' },
    motionNote: 'אפשר לשלב כניסה ויציאה. לולאה או תנועה לאורך הקליפ מחליפות את המפתחות של המאפיינים שבהם הן משתמשות.',
    needsGpu: 'דורש כרטיס מסך', empty: 'אין תוצאות', noFrame: 'אין תמונה בתצוגה המקדימה, לכן אין תמונות ממוזערות.', rendering: 'מצייר תמונות ממוזערות…',
    thumbNote: 'התמונות הממוזערות מצוירות מהפריים המוצג עכשיו, באותו מַרכֵּב של התצוגה והייצוא.', sample: 'אבג Abc',
  },
  en: {
    open: 'Effects gallery', title: 'Effects gallery', close: 'Close gallery', search: 'Search by name', searchPlaceholder: 'Search…',
    tabs: 'Kinds of look', effects: 'Effects', looks: 'Colour looks', transitions: 'Transitions', text: 'Text styles', motion: 'Motion',
    motionGroups: { in: 'Entrances', out: 'Exits', loop: 'Loops', move: 'Whole-clip moves' },
    motionNote: 'Entrances and exits can be combined. A loop or a move replaces the keys of the properties it uses.',
    needsGpu: 'needs a graphics adapter', empty: 'No results', noFrame: 'The preview shows no picture, so there are no thumbnails.', rendering: 'Drawing thumbnails…',
    thumbNote: 'Thumbnails are drawn from the frame on screen, by the same compositor as preview and export.', sample: 'אבג Abc',
  },
} as const;
