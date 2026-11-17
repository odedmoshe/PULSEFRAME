/** Strings of the empty-project start panel (kept here so the shared dictionaries stay untouched). */
export type WelcomeLang = 'he' | 'en';
export const WELCOME_STRINGS = {
  he: {
    region: 'התחלה מהירה', title: 'מתחילים', lead: 'שלושה צעדים קצרים ויש לכם סרטון.',
    drop: 'גררו לכאן סרטונים, תמונות או מוזיקה', pick: 'בחירת קבצים מהמחשב', uploading: 'מעלה קבצים…',
    stepsLabel: 'דרכים להתחיל',
    s1: 'ייבוא קבצים', s2: 'גרירה לציר הזמן וחיתוך', s3: 'כתוביות, אפקטים וייצוא',
    s4: 'התחל מתבנית', s4Hint: 'או עריכה מוכנה: תמונות, מוזיקה וטקסט מסודרים בקצב',
    hintPlay: 'הפעלה ועצירה', hintSplit: 'חיתוך הקליפ בנקודה הנוכחית', hintPalette: 'חיפוש פעולות', space: 'רווח',
  },
  en: {
    region: 'Quick start', title: "Let's start", lead: 'Three short steps and you have a video.',
    drop: 'Drop videos, pictures or music here', pick: 'Choose files from your computer', uploading: 'Uploading files…',
    stepsLabel: 'Ways to start',
    s1: 'Import files', s2: 'Drag to the timeline and trim', s3: 'Captions, effects and export',
    s4: 'Start from a template', s4Hint: 'or a ready edit: pictures, music and text laid out on the beat',
    hintPlay: 'Play / pause', hintSplit: 'Cut the clip at the playhead', hintPalette: 'Search for actions', space: 'Space',
  },
} as const;
