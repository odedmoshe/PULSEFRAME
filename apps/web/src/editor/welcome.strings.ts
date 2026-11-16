/** Strings of the empty-project start panel (kept here so the shared dictionaries stay untouched). */
export type WelcomeLang = 'he' | 'en';
export const WELCOME_STRINGS = {
  he: {
    region: 'התחלה מהירה', title: 'מתחילים', lead: 'שלושה צעדים קצרים ויש לכם סרטון.',
    drop: 'גררו לכאן סרטונים, תמונות או מוזיקה', pick: 'בחירת קבצים מהמחשב', uploading: 'מעלה קבצים…',
    stepsLabel: 'שלושה צעדים',
    s1: 'ייבוא קבצים', s2: 'גרירה לציר הזמן וחיתוך', s3: 'כתוביות, אפקטים וייצוא',
    hintPlay: 'הפעלה ועצירה', hintSplit: 'חיתוך הקליפ בנקודה הנוכחית', hintPalette: 'חיפוש פעולות', space: 'רווח',
  },
  en: {
    region: 'Quick start', title: "Let's start", lead: 'Three short steps and you have a video.',
    drop: 'Drop videos, pictures or music here', pick: 'Choose files from your computer', uploading: 'Uploading files…',
    stepsLabel: 'Three steps',
    s1: 'Import files', s2: 'Drag to the timeline and trim', s3: 'Captions, effects and export',
    hintPlay: 'Play / pause', hintSplit: 'Cut the clip at the playhead', hintPalette: 'Search for actions', space: 'Space',
  },
} as const;
