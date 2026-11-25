/**
 * The craft surfaces' own strings (wave 7 craft; W3 owns and extends this file). Hebrew first; the English covers the same keys
 * (craft.strings.test.ts). Shared words (operation names, groups, refusals) are in packages/i18n/src/craft.ts.
 */
export const CRAFT_STRINGS = {
  he: {
    timeAfterEnter: 'אחרי Enter', rounded: 'עוגל לפריים הקרוב', frame: 'פריים', moveToTimeHint: 'הקלידו זמן: 00:00:05:00, 1:10, 5s, 90f, 3 שניות',
    pasteTitle: 'הדבקת מאפיינים', pasteFrom: 'מעתיקים מ־', pasteApply: 'הדבקה', pasteSkipped: 'ידולג', pasteNotInFormat: 'כשמוצג פורמט אחר אפשר להדביק רק בגרסה הראשית',
    find: 'חיפוש', replaceWith: 'החלפה ב־', wholeWord: 'מילה שלמה', ignoreMarks: 'התעלמות מניקוד', finalsEqual: 'אותיות סופיות כרגילות', ignoreCase: 'התעלמות מאותיות גדולות',
    where: 'היכן', wholeProject: 'כל הפרויקט', selectedClips: 'הקליפים שנבחרו', formats: 'פורמטים', allFormats: 'כולם', masterOnly: 'הראשי בלבד', viewedFormat: 'המוצג',
    replaceAll: 'החלפת הכול', projectChanged: 'הפרויקט השתנה — בדקו שוב', presentationFormsNote: 'אותיות בצורות תצוגה מיוחדות לא מושוות לאותיות רגילות',
    versions: 'גרסאות', saveVersion: 'שמירת גרסה', compare: 'השוואה', whatChanged: 'מה השתנה', restore: 'שחזור לגרסה הזו', current: 'המצב הנוכחי',
    sameAsCurrent: 'זהה למצב הנוכחי', mediaNotCopied: 'המדיה לא מועתקת', privacyLabel: 'נשמרה לפני שינוי באזורי הפרטיות', notRestored: 'לא ישוחזר — נשאר כמו עכשיו',
    restoreKeeps: 'הספרייה, התמלולים והאנשים נשארים כפי שהם', noSuchFrame: 'בגרסה הזו אין פריים כזה — היא קצרה יותר', upTo200: 'עד 200 קליפים בבת אחת',
  },
  en: {
    timeAfterEnter: 'After Enter', rounded: 'Rounded to the nearest frame', frame: 'frame', moveToTimeHint: 'Type a time: 00:00:05:00, 1:10, 5s, 90f, 3 seconds',
    pasteTitle: 'Paste attributes', pasteFrom: 'Copying from', pasteApply: 'Paste', pasteSkipped: 'skipped', pasteNotInFormat: 'While another format is shown, paste works on the main version only',
    find: 'Find', replaceWith: 'Replace with', wholeWord: 'Whole word', ignoreMarks: 'Ignore points', finalsEqual: 'Final letters as regular', ignoreCase: 'Ignore case',
    where: 'Where', wholeProject: 'Whole project', selectedClips: 'Selected clips', formats: 'Formats', allFormats: 'All', masterOnly: 'Main only', viewedFormat: 'The one shown',
    replaceAll: 'Replace all', projectChanged: 'The project changed — check again', presentationFormsNote: 'Letters in special presentation forms are not matched with regular letters',
    versions: 'Versions', saveVersion: 'Save version', compare: 'Compare', whatChanged: 'What changed', restore: 'Restore this version', current: 'Current state',
    sameAsCurrent: 'Same as now', mediaNotCopied: 'Media is not copied', privacyLabel: 'Saved before a change to privacy regions', notRestored: 'Not restored — stays as it is now',
    restoreKeeps: 'The library, transcripts and people stay as they are', noSuchFrame: 'This version has no such frame — it is shorter', upTo200: 'Up to 200 clips at once',
  },
} as const;
export const craftStrings = (lang: 'he' | 'en') => CRAFT_STRINGS[lang];
