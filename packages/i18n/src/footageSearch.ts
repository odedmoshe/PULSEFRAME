/**
 * Strings of «חיפוש בצילומים» — find it in your footage (wave 7 search track, .artifacts/wave7/search-decisions.md). Spread into `he`
 * and `en` (index.ts); Hebrew first, the English dictionary covers the same keys. Namespaces: `footage.*` (the interface; builder C reads
 * them), `error.code.*`. No string offers a query by example or claims to know who someone is (core FOOTAGE_FORBIDDEN_WORDS, checked by
 * packages/evals/src/footage-wording.test.ts); saying what it does NOT do is wanted.
 * Also here: HE_FOOTAGE, the Hebrew of every refusal of the search routes and tool (core FOOTAGE_REFUSALS), each with the next step.
 */
export const FOOTAGE_HE = {
  'error.code.footage_search_not_built': 'החיפוש בצילומים עוד לא נבנה בגרסה הזו',
  'error.code.search_scan_in_progress': 'סריקה של הפרויקט כבר רצה',
  'error.code.picture_search_not_ready': 'החיפוש בתמונה לא מותקן במחשב הזה',
  'error.code.search_engine_failed': 'מודל החיפוש בתמונה החזיר תשובה פגומה',
  'footage.title': 'חיפוש בצילומים', 'footage.placeholder': 'מה לחפש? שם, תאריך, חג, מילים שנאמרו',
  'footage.sectionExact': 'נמצא בשם, בתאריך ובתמלול', 'footage.sectionPicture': 'לפי מה שרואים בתמונה',
  'footage.src.name': 'בשם הקובץ', 'footage.src.date': 'בתאריך', 'footage.src.event': 'באירוע', 'footage.src.transcript': 'בתמלול', 'footage.src.pearl': 'בפנינה', 'footage.src.person': 'בתיוג', 'footage.src.picture': 'לפי התמונה',
  'footage.view': 'הצג', 'footage.append': 'הוסף בסוף', 'footage.insert': 'הכנס במקום הסמן', 'footage.wholeFile': 'כל הקובץ',
  'footage.modelLabel': 'התאמה לפי מודל — לא נבדק בעברית',
  'footage.hebrewAsTyped': 'חיפשתי בעברית כפי שנכתב. המודל לא נבדק בעברית — אפשר לנסות גם באנגלית',
  'footage.nothing': 'לא נמצא דבר. זה לא אומר שאין — המודל והחיפוש במילים יכולים לפספס',
  'footage.found': 'נמצאו {count} רגעים', 'footage.pressEnter': 'Enter — לחפש גם לפי מה שרואים בתמונה',
  'footage.notInstalled': 'החיפוש בתמונה לא מותקן', 'footage.setupSteps': 'ההוראות להתקנה: docs/INTEGRATIONS.md, «חיפוש בתמונה». החיפוש בשם, בתאריך ובמילים עובד בינתיים',
  'footage.ownerOnly': 'החיפוש בתמונה זמין רק לבעל הפרויקט, מהחלון שלו',
  'footage.notScanned': 'הסרטונים עוד לא נסרקו לחיפוש בתמונה', 'footage.stale': 'צריך לסרוק שוב: המודל או ההגדרות השתנו',
  'footage.scanned': 'נסרקו {files} מתוך {of} סרטונים', 'footage.scan': 'סרוק עכשיו', 'footage.scanning': 'סורק… {done} מתוך {total} תמונות', 'footage.stop': 'עצור',
  'footage.scanNote': 'הסריקה מסתכלת על תמונה שלמה אחת בכל שנייה של כל סרטון, בלי זיהוי פנים ובלי לדעת מי מופיע. מה שנשמר נשאר במחשב הזה, לא נכנס לגיבוי, ונמחק עם הסרטון',
  'footage.scanTime': 'משך הסריקה במחשב הזה עוד לא נמדד',
  'footage.forget': 'מחק את מפתח החיפוש בתמונה', 'footage.forgetConfirm': 'למחוק את מה שנשמר מהסריקה של הפרויקט הזה? אפשר לסרוק שוב אחר כך',
  'footage.forgotten': 'מפתח החיפוש בתמונה נמחק',
  'footage.experimental': 'ניסיוני', 'footage.textOnly': 'מחפשים רק במילים — לא לפי תמונה ולא לפי אדם',
} as const;
export const FOOTAGE_EN: Record<keyof typeof FOOTAGE_HE, string> = {
  'error.code.footage_search_not_built': 'Footage search is not built in this build yet',
  'error.code.search_scan_in_progress': 'A scan of this project is already running',
  'error.code.picture_search_not_ready': 'Picture search is not set up on this computer',
  'error.code.search_engine_failed': 'The picture search model gave a faulty answer',
  'footage.title': 'Find it in your footage', 'footage.placeholder': 'What to find? A name, a date, a holiday, words that were said',
  'footage.sectionExact': 'Found by name, date and transcript', 'footage.sectionPicture': 'By what is in the picture',
  'footage.src.name': 'in the file name', 'footage.src.date': 'by date', 'footage.src.event': 'in an event', 'footage.src.transcript': 'in the transcript', 'footage.src.pearl': 'in a pearl', 'footage.src.person': 'by a tag', 'footage.src.picture': 'by the picture',
  'footage.view': 'Show', 'footage.append': 'Add at the end', 'footage.insert': 'Insert at the playhead', 'footage.wholeFile': 'The whole file',
  'footage.modelLabel': 'A model\'s match — not tested in Hebrew',
  'footage.hebrewAsTyped': 'Searched in Hebrew as typed. The model was not tested in Hebrew — you can also try English',
  'footage.nothing': 'Nothing found. That does not mean there is nothing — the model and the word search can miss things',
  'footage.found': '{count} moments found', 'footage.pressEnter': 'Enter — also search by what is in the picture',
  'footage.notInstalled': 'Picture search is not installed', 'footage.setupSteps': 'Setup steps: docs/INTEGRATIONS.md, "Picture search". Search by name, date and words works meanwhile',
  'footage.ownerOnly': 'Picture search is for the project owner only, from their own session',
  'footage.notScanned': 'The videos have not been scanned for picture search yet', 'footage.stale': 'Scan again: the model or the settings changed',
  'footage.scanned': '{files} of {of} videos scanned', 'footage.scan': 'Scan now', 'footage.scanning': 'Scanning… {done} of {total} pictures', 'footage.stop': 'Stop',
  'footage.scanNote': 'The scan looks at one whole picture per second of each video, with no face recognition and without knowing who appears. What it keeps stays on this computer, is not in backups, and is erased with the video',
  'footage.scanTime': 'How long a scan takes on this computer has not been measured yet',
  'footage.forget': 'Delete the picture search index', 'footage.forgetConfirm': 'Delete what the scan kept for this project? You can scan again later',
  'footage.forgotten': 'The picture search index was deleted',
  'footage.experimental': 'Experimental', 'footage.textOnly': 'Search by words only — not by a picture and not by a person',
};

/** The Hebrew of every refusal of the search routes and tool (core FOOTAGE_REFUSALS), each with the next step. None repeats the query. */
export const HE_FOOTAGE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^footage search is not built in this build yet$/, () => 'החיפוש בצילומים עוד לא נבנה בגרסה הזו. אפשר לעדכן את העורך; בינתיים אפשר לסנן את המדיה לפי שם'],
  [/^only the owner can scan footage, see the picture index or delete it, from their own session$/, () => 'רק בעל הפרויקט יכול לסרוק, לראות את מפתח החיפוש בתמונה או למחוק אותו, מהחלון שלו. הוא עושה זאת במגירת המדיה בעורך'],
  [/^footage search needs a grant without a track or time restriction$/, () => 'חיפוש בצילומים זמין רק להרשאה בלי הגבלת רצועות או טווח. אפשר לבקש מבעל הפרויקט הרשאה כזו'],
  [/^a scan of this project's footage is already running$/, () => 'סריקה של הפרויקט כבר רצה. אפשר לחכות שתסתיים או לעצור אותה ולהתחיל שוב'],
  [/^picture search is not set up on this computer: (\w+)$/, () => 'החיפוש בתמונה לא מותקן במחשב הזה. פעלו לפי ההוראות במגירת המדיה; החיפוש בשם, בתאריך ובמילים עובד בינתיים'],
  [/^there is no video in this project to scan$/, () => 'אין בפרויקט סרטון לסרוק. ייבאו סרטון קודם'],
  [/^a picture search is at most 64 words and signs$/, () => 'חיפוש בתמונה הוא עד 64 מילים וסימנים. קצרו את החיפוש לכמה מילים'],
  [/^the picture search model gave an answer that failed its checks; nothing is shown$/, () => 'מודל החיפוש בתמונה החזיר תשובה שלא עברה את הבדיקות, ולכן לא מוצג דבר. נסו שוב; אם זה חוזר, בדקו את ההתקנה במגירת המדיה'],
];
