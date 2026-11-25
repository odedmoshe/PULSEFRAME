/**
 * Strings of «כלים מוקלטים» — recorded instruments for the built-in music (wave 7 instruments track; .artifacts/wave7/instruments-decisions.md).
 * Spread into `he` and `en` (index.ts); Hebrew first, the English dictionary covers the same keys. Nobody here has listened: no string
 * says a recorded kit sounds better, real, warm or natural (core INSTRUMENTS_FORBIDDEN_WORDS, checked by
 * packages/evals/src/instruments-wording.test.ts). Namespaces: `instruments.*` (the interface; builder W3 reads them through
 * apps/web/src/editor/instruments/instruments.strings.ts) and `error.code.instruments_*`.
 * Also here: HE_INSTRUMENTS, the Hebrew of every refusal of apps/server/src/instruments/contract.ts INSTRUMENTS_SERVER_REFUSALS, each
 * with the next step.
 */
const INSTRUMENTS_HE_BASE = {
  'error.code.instruments_not_built': 'כלים מוקלטים עוד לא נבנו בגרסה הזו', 'error.code.instruments_library_not_set': 'ספריית התוכן לא הוגדרה',
  'error.code.instruments_no_kit': 'לסגנון הזה אין כלים מוקלטים', 'error.code.instruments_kit_not_ready': 'הכלים המוקלטים עוד לא נבדקו',
  'error.code.instruments_item_missing': 'הכלים לא הורדו לספרייה', 'error.code.instruments_item_version': 'בספרייה גרסה אחרת של הכלים',
  'error.code.instruments_licence': 'הרישיון לא מתיר את הכלים כאן', 'error.code.instruments_file_missing': 'קובץ של הכלים חסר',
  'error.code.instruments_file_changed': 'קובץ של הכלים השתנה', 'error.code.instruments_path_escape': 'קובץ מצביע אל מחוץ לתיקייה שלו',
  'error.code.instruments_unreadable': 'אי אפשר לקרוא קובץ של הכלים', 'error.code.instruments_format': 'קובץ בפורמט שעוד לא נתמך',
  'error.code.instruments_range': 'אין הקלטה קרובה מספיק לחלק מהצלילים', 'error.code.instruments_too_large': 'דורש יותר מדי זיכרון',
  'error.code.instruments_not_fittable': 'אי אפשר להתאים לאורך מוזיקה עם כלים מוקלטים',
  'instruments.sound': 'צליל', 'instruments.synth': 'מסונתז', 'instruments.recorded': 'כלים מוקלטים',
  'instruments.unheard': 'כלים מוקלטים — עוד לא הושמעו לאף אחד', 'instruments.heardOn': 'כלים מוקלטים — בעל הפרויקט שמע ({date})',
  'instruments.parts': '{recorded} מהספרייה; {synth} מסונתזים', 'instruments.allOrNothing': 'כל החלקים של הערכה מוקלטים, או שהמוזיקה לא נוצרת והסיבה מוצגת',
  'instruments.state.not_built': 'כלים מוקלטים עוד לא נבנו בגרסה הזו', 'instruments.state.library_not_set': 'ספריית התוכן לא הוגדרה',
  'instruments.state.not_calibrated': 'קובצי ההקלטות של הערכה עוד לא נבדקו במחשב שלכם', 'instruments.state.item_missing': 'הכלים לא נמצאו בספרייה',
  'instruments.state.item_version': 'בספרייה גרסה אחרת של הכלים', 'instruments.state.licence': 'הרישיון ביומן הספרייה לא מתיר את הכלים כאן',
  'instruments.state.file_missing': 'קובץ של הכלים חסר בספרייה', 'instruments.state.file_changed': 'קובץ של הכלים שונה ממה שנבדק',
  'instruments.state.unreadable': 'אי אפשר לקרוא קובץ של הכלים', 'instruments.state.checking': 'בודקים את קובצי הכלים…', 'instruments.state.ready': 'הכלים נמצאו ונבדקו',
  'instruments.audition': 'השוואה עיוורת', 'instruments.auditionA': 'א', 'instruments.auditionB': 'ב', 'instruments.reveal': 'מה היה מה?',
  'instruments.revealed': '«א» היה: {a}. «ב» היה: {b}', 'instruments.levelNote': 'השוואת עוצמה משוערת (RMS, לא עוצמה נשמעת)',
  'instruments.heard': 'שמעתי', 'instruments.heardOwnerOnly': 'סימון «שמעתי» נעשה רק מחלון בעל הפרויקט', 'instruments.heardSaved': 'סומן: שמעתם את הכלים המוקלטים ({date})',
  'instruments.notHeard': 'ביטול הסימון', 'instruments.credits': 'בתיאור הסרטון יופיע: {credit}', 'instruments.nonCommercial': 'לשימוש לא מסחרי בלבד',
  'instruments.addLabel': 'הוספת מוזיקה מובנית {name} (כלים מוקלטים)',
} as const;
const INSTRUMENTS_EN_BASE: Record<keyof typeof INSTRUMENTS_HE_BASE, string> = {
  'error.code.instruments_not_built': 'Recorded instruments are not built in this build yet', 'error.code.instruments_library_not_set': 'The content library is not set up',
  'error.code.instruments_no_kit': 'This style has no recorded instruments', 'error.code.instruments_kit_not_ready': 'The recorded instruments were not checked yet',
  'error.code.instruments_item_missing': 'The instruments are not downloaded to the library', 'error.code.instruments_item_version': 'The library holds another version of the instruments',
  'error.code.instruments_licence': 'The licence does not allow the instruments here', 'error.code.instruments_file_missing': 'An instrument file is missing',
  'error.code.instruments_file_changed': 'An instrument file changed', 'error.code.instruments_path_escape': 'A file points outside its own folder',
  'error.code.instruments_unreadable': 'An instrument file cannot be read', 'error.code.instruments_format': 'A file in a format not supported yet',
  'error.code.instruments_range': 'No recording close enough to some notes', 'error.code.instruments_too_large': 'Needs too much memory',
  'error.code.instruments_not_fittable': 'Music with recorded instruments cannot be fitted to a length',
  'instruments.sound': 'Sound', 'instruments.synth': 'Synthesised', 'instruments.recorded': 'Recorded instruments',
  'instruments.unheard': 'Recorded instruments — nobody has listened yet', 'instruments.heardOn': 'Recorded instruments — the owner listened ({date})',
  'instruments.parts': '{recorded} from the library; {synth} synthesised', 'instruments.allOrNothing': 'Every part of the kit is recorded, or the music is not made and the reason is shown',
  'instruments.state.not_built': 'Recorded instruments are not built in this build yet', 'instruments.state.library_not_set': 'The content library is not set up',
  'instruments.state.not_calibrated': 'The kit\'s recording files have not been checked on your computer yet', 'instruments.state.item_missing': 'The instruments were not found in the library',
  'instruments.state.item_version': 'The library holds another version of the instruments', 'instruments.state.licence': 'The library ledger\'s licence does not allow the instruments here',
  'instruments.state.file_missing': 'An instrument file is missing from the library', 'instruments.state.file_changed': 'An instrument file differs from the one checked',
  'instruments.state.unreadable': 'An instrument file cannot be read', 'instruments.state.checking': 'Checking the instrument files…', 'instruments.state.ready': 'The instruments were found and checked',
  'instruments.audition': 'Blind comparison', 'instruments.auditionA': 'A', 'instruments.auditionB': 'B', 'instruments.reveal': 'Which was which?',
  'instruments.revealed': '«A» was: {a}. «B» was: {b}', 'instruments.levelNote': 'Level matched by RMS, not loudness (an estimate)',
  'instruments.heard': 'I listened', 'instruments.heardOwnerOnly': 'Marking «I listened» is done only from the project owner\'s window', 'instruments.heardSaved': 'Marked: you listened to the recorded instruments ({date})',
  'instruments.notHeard': 'Remove the mark', 'instruments.credits': 'The video description will say: {credit}', 'instruments.nonCommercial': 'For non-commercial use only',
  'instruments.addLabel': 'Add built-in music {name} (recorded instruments)',
};
export const INSTRUMENTS_HE = INSTRUMENTS_HE_BASE;
export const INSTRUMENTS_EN = INSTRUMENTS_EN_BASE;

/** The Hebrew of every refusal of instruments/contract.ts INSTRUMENTS_SERVER_REFUSALS (fixed English shapes), each with the next step. */
export const HE_INSTRUMENTS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^recorded instruments are not built in this build yet$/, () => 'כלים מוקלטים עוד לא נבנו בגרסה הזו. אפשר לבחור «מסונתז» — המוזיקה תיווצר כמו קודם'],
  [/^no library folder is set, so no recorded instrument can be used$/, () => 'ספריית התוכן לא הוגדרה, ולכן אי אפשר להשתמש בכלים מוקלטים. בעל הפרויקט מגדיר אותה בהגדרות; עד אז אפשר לבחור «מסונתז»'],
  [/^the style (\S+) has no recorded kit in this build$/, () => 'לסגנון הזה אין כלים מוקלטים בגרסה הזו. אפשר לבחור «מסונתז», או את הסגנון «רגוע ונעים»'],
  [/^the recorded kit (\S+) has no checked list of sample files in this build yet$/, () => 'קובצי ההקלטות של הערכה עוד לא נבדקו במחשב שלכם, ולכן היא עוד לא מוצעת. בינתיים אפשר לבחור «מסונתז»'],
  [/^the library has no download of (\S+), which this kit needs$/, () => 'הכלים שהערכה צריכה לא הורדו לספרייה. הורידו אותם בכלי ההורדה (רשימת האודיו, חלק הכלים) ונסו שוב'],
  [/^the library holds another version of (\S+) than the one this kit was checked against$/, () => 'בספרייה גרסה אחרת של הכלים מזו שנבדקה. הורידו בכלי ההורדה את הגרסה הקבועה ונסו שוב'],
  [/^the library's licence for (\S+) does not allow it here: (.+)$/, () => 'הרישיון של הכלים ביומן הספרייה לא מתיר אותם כאן. אפשר לבחור «מסונתז»'],
  [/^a sample file of this kit is missing: (.+)$/, () => 'קובץ הקלטה של הערכה חסר בספרייה. בדקו את הספרייה בכלי ההורדה (‎--verify) והורידו שוב'],
  [/^a sample file differs from the one this kit was checked against: (.+)$/, () => 'קובץ הקלטה שונה מזה שנבדק. בדקו את הספרייה בכלי ההורדה (‎--verify) והורידו שוב'],
  [/^an instrument file points outside its own folder; nothing was read$/, () => 'קובץ של הכלים מצביע אל מחוץ לתיקייה שלו, ולכן לא נקרא דבר. בדקו את תיקיית הספרייה בכלי ההורדה'],
  [/^a sample file could not be read: (.+) \((.+)\)$/, () => 'אי אפשר היה לקרוא קובץ הקלטה. בדקו את הספרייה בכלי ההורדה (‎--verify) והורידו שוב'],
  [/^a sample file is in a format this build does not read: (.+) \((.+)\)$/, () => 'קובץ הקלטה בפורמט שהגרסה הזו לא קוראת. אפשר לבחור «מסונתז»'],
  [/^the instrument (\S+) has no recording close enough to some notes of this piece$/, () => 'לכלי אין הקלטה קרובה מספיק לחלק מהצלילים של הקטע. נסו אורך או גרסה אחרים, או «מסונתז»'],
  [/^this piece needs more than (\d+) MB of recorded sound in memory at once$/, (m) => `הקטע דורש יותר מ־${m[1]} מגה־בייט של הקלטות בזיכרון בבת אחת. בקשו פחות תיבות, או «מסונתז»`],
  [/^built-in music made with recorded instruments cannot be fitted to a length in this build yet$/, () => 'אי אפשר עדיין להתאים לאורך מוזיקה מובנית עם כלים מוקלטים. הוסיפו אותה שוב באורך הדרוש, או השתמשו בצלילים המסונתזים'],
  [/^only the owner, from their own session, can mark a recorded kit as heard$/, () => 'רק בעל הפרויקט, מהחלון שלו, יכול לסמן ששמע את הכלים המוקלטים. האזינו בעורך וסמנו שם'],
];
