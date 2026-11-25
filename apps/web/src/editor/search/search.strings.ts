/**
 * The words of «חיפוש בצילומים» in the editor (wave 7 search track, builder C). The shared words live in packages/i18n/src/footageSearch.ts
 * (`footage.*`, Hebrew first); the few sentences only this interface needs (the setup reasons, the forget confirmation, the plural of one)
 * are here, in both languages, so no shared file is touched. No sentence offers a query by example or claims to know who someone is,
 * and none shows a score; search.strings.test.ts checks both. Numbers are drawn by the component in <bdi dir="ltr">.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

const LOCAL = {
  he: {
    'footage.status': 'מצב החיפוש בתמונה',
    'footage.loading': 'בודק את מצב החיפוש בתמונה…',
    'footage.pictureHint': 'ההתאמה לפי מודל מחשב. הסדר הוא עזר בלבד והמודל יכול לטעות או לפספס. המודל לא נבדק בעברית — כתיבה באנגלית עשויה למצוא יותר',
    'footage.notBuilt': 'החיפוש בתמונה עוד לא נבנה בגרסה הזו. החיפוש בשם, בתאריך ובמילים עובד בינתיים',
    'footage.ready': 'החיפוש בתמונה מוכן: נסרקו {files} מתוך {of} סרטונים',
    'footage.partlyScanned': 'נסרקו רק {files} מתוך {of} סרטונים. החיפוש בתמונה יחפש רק בהם',
    'footage.staleDetail': 'חלק מהסרטונים נסרקו עם מודל או הגדרות אחרים: {stale} מתוך {of}',
    'footage.noVideos': 'אין בפרויקט סרטון לסרוק. ייבאו סרטון קודם',
    'footage.setup.engine_not_configured': 'לא הוגדרה סביבת Python לחיפוש בתמונה (PF_TOOLS_PYTHON). השלבים הבאים: ההוראות ב־docs/INTEGRATIONS.md',
    'footage.setup.engine_not_working': 'סביבת ה־Python לחיפוש בתמונה לא עובדת. השלב הבא: להתקין מחדש לפי רשימת החבילות ב־docs/INTEGRATIONS.md',
    'footage.setup.engine_unverified': 'קובץ העובד של החיפוש בתמונה לא אומת, ולכן הוא לא רץ. השלב הבא: לעדכן את העורך',
    'footage.setup.model_missing': 'קבצי המודל לא נמצאו במלואם בתיקיית הספרייה. השלב הבא: להוריד אותם עם כלי ההורדה של הספרייה',
    'footage.setup.licence_blocked': 'הרישיון של המודל לא אושר במחשב הזה, ולכן החיפוש בתמונה כבוי. השלב הבא: לבדוק את ההוראות ב־docs/INTEGRATIONS.md',
    'footage.setup.disk_insufficient': 'אין מספיק מקום בדיסק לחיפוש בתמונה. השלב הבא: לפנות מקום ולנסות שוב',
    'footage.setup.not_built': 'החיפוש בתמונה עוד לא נבנה בגרסה הזו',
    'footage.setupDetail': 'פרט מהמערכת',
    'footage.missingBytes': 'חסרים בערך {size} של קבצי מודל',
    'footage.startedScan': 'הסריקה התחילה',
    'footage.stopping': 'מבקש לעצור… הסריקה נעצרת בסוף האצווה הנוכחית',
    'footage.scanStopped': 'הסריקה נעצרה. מה שכבר נסרק נשמר',
    'footage.scanFailed': 'הסריקה נכשלה',
    'footage.forgetTitle': 'למחוק את מפתח החיפוש בתמונה?',
    'footage.forgetWhat': 'יימחק מהמחשב הזה מה שנשמר מ־{files} סרטונים לצורך החיפוש בתמונה, בערך {size}. הסרטונים עצמם, הפרויקט והחיפוש בשם ובמילים לא ייפגעו. אפשר לסרוק שוב אחר כך',
    'footage.forgetDo': 'מחק',
    'footage.forgetCancel': 'ביטול',
    'footage.forgetCount': 'נמחקו נתונים של {files} סרטונים',
    'footage.foundOne': 'נמצא רגע אחד',
    'footage.foundNone': 'לא נמצא דבר',
    'footage.pictureSearching': 'מחפש לפי מה שרואים בתמונה…',
    'footage.pictureDone': 'החיפוש בתמונה הסתיים: {count} רגעים',
    'footage.pictureDoneOne': 'החיפוש בתמונה הסתיים: רגע אחד',
    'footage.pictureAsk': 'לחצו Enter בתיבה, או על הכפתור, כדי לחפש גם לפי מה שרואים בתמונה',
    'footage.pictureNothing': 'לא נמצא דבר בתמונות. זה לא אומר שאין — המודל יכול לפספס, ואפשר לנסות באנגלית',
    'footage.queryTooLong': 'החיפוש ארוך מדי: עד 200 תווים',
    'footage.listLabel': 'רגעים שנמצאו',
    'footage.keys': 'חיצים לניווט, Enter להצגה, Shift+Enter להכנסה במקום הסמן, Escape חזרה לתיבה',
  },
  en: {
    'footage.status': 'Picture search status',
    'footage.loading': 'Checking the picture search…',
    'footage.pictureHint': 'A model\'s match. The order is only an aid and the model can be wrong or miss things. The model was not tested in Hebrew — typing English may find more',
    'footage.notBuilt': 'Picture search is not built in this build yet. Search by name, date and words works meanwhile',
    'footage.ready': 'Picture search is ready: {files} of {of} videos scanned',
    'footage.partlyScanned': 'Only {files} of {of} videos are scanned. Picture search looks only in those',
    'footage.staleDetail': 'Some videos were scanned with another model or settings: {stale} of {of}',
    'footage.noVideos': 'There is no video in this project to scan. Import a video first',
    'footage.setup.engine_not_configured': 'No Python environment is set for picture search (PF_TOOLS_PYTHON). Next step: the instructions in docs/INTEGRATIONS.md',
    'footage.setup.engine_not_working': 'The Python environment for picture search does not work. Next step: reinstall from the package list in docs/INTEGRATIONS.md',
    'footage.setup.engine_unverified': 'The picture search worker file was not verified, so it does not run. Next step: update the editor',
    'footage.setup.model_missing': 'The model files are not all in the library folder. Next step: fetch them with the library\'s fetcher',
    'footage.setup.licence_blocked': 'The model\'s licence is not approved on this computer, so picture search is off. Next step: see docs/INTEGRATIONS.md',
    'footage.setup.disk_insufficient': 'There is not enough disk space for picture search. Next step: free some space and try again',
    'footage.setup.not_built': 'Picture search is not built in this build yet',
    'footage.setupDetail': 'Detail from the system',
    'footage.missingBytes': 'About {size} of model files are missing',
    'footage.startedScan': 'The scan started',
    'footage.stopping': 'Asking to stop… the scan stops at the end of the current batch',
    'footage.scanStopped': 'The scan stopped. What was already scanned is kept',
    'footage.scanFailed': 'The scan failed',
    'footage.forgetTitle': 'Delete the picture search index?',
    'footage.forgetWhat': 'This deletes from this computer what picture search kept of {files} videos, about {size}. The videos themselves, the project and the search by name and words are not touched. You can scan again later',
    'footage.forgetDo': 'Delete',
    'footage.forgetCancel': 'Cancel',
    'footage.forgetCount': 'Deleted the data of {files} videos',
    'footage.foundOne': 'One moment found',
    'footage.foundNone': 'Nothing found',
    'footage.pictureSearching': 'Searching by what is in the picture…',
    'footage.pictureDone': 'Picture search finished: {count} moments',
    'footage.pictureDoneOne': 'Picture search finished: one moment',
    'footage.pictureAsk': 'Press Enter in the box, or the button, to also search by what is in the picture',
    'footage.pictureNothing': 'Nothing found in the pictures. That does not mean there is nothing — the model can miss things, and you can try English',
    'footage.queryTooLong': 'The search is too long: at most 200 characters',
    'footage.listLabel': 'Moments found',
    'footage.keys': 'Arrows to move, Enter to show, Shift+Enter to insert at the playhead, Escape back to the box',
  },
} as const;

export type FootageKey = keyof typeof LOCAL.he;

/** The reader of a string: the local sentences first, then the shared dictionary; `{name}` placeholders are filled (a value is put in as it is). */
export function footageT(lang: Lang) {
  const shared = dictionaries[lang] as Record<string, string>;
  const mine = LOCAL[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (mine[key] ?? shared[key] ?? key).replace(/\{(\w+)\}/g, (_m, k: string) => (Object.hasOwn(vars, k) ? String(vars[k]) : `{${k}}`));
}
/** Every sentence of this file, for the wording test. */
export const FOOTAGE_LOCAL_STRINGS = LOCAL;
