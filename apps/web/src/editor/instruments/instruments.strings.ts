/**
 * The strings of «כלים מוקלטים» in the editor (wave 7 instruments track). Builder W3 owns this file. The shared words live in
 * packages/i18n/src/instruments.ts (`instruments.*`, Hebrew first); the words only this page needs (the next step for every state, the
 * duties said before an add, the blind pair's help and refusals, the owner's mark) live here, in both languages. `instrumentsT` reads
 * this table first and the shared one second, fills the {placeholders}, and shows the key when a word is missing, never nothing.
 * Nobody has listened to any recorded kit: no string says a recorded kit sounds better, real, warm, natural or rich (core
 * INSTRUMENTS_FORBIDDEN_WORDS; instruments.logic.test.ts checks this table against them in both languages).
 * `state.not_calibrated` here says plainly that the instrument set was not downloaded and checked yet (the shared word only says the
 * files were not checked); a lead decision whether the shared key should say the same.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

const HE = {
  // what each choice means
  'soundHelp': '«מסונתז» — המוזיקה נוצרת כמו קודם. «כלים מוקלטים» — חלק מהכלים מנוגנים מקובצי הקלטות בספרייה שלכם; כל החלקים של הערכה מוקלטים, או שהמוזיקה לא נוצרת והסיבה מוצגת.',
  // the state of the kit, in words (the shared `state.*` words cover the rest)
  'state.not_calibrated': 'ערכת הכלים עוד לא הורדה ולא נבדקה במחשב הזה',
  'state.no_kit': 'לסגנון הזה אין כלים מוקלטים בגרסה הזו',
  'state.failed': 'אי אפשר היה לבדוק את הכלים המוקלטים',
  // the next step for every state
  'next.not_built': 'אפשר להמשיך עם «מסונתז» — המוזיקה נוצרת כמו קודם.',
  'next.library_not_set': 'בעל הפרויקט מגדיר את תיקיית הספרייה בהגדרות («הספרייה שלי»). עד אז אפשר לבחור «מסונתז».',
  'next.not_calibrated': 'הערכה לא מוצעת עד שמורידים את הכלים לספרייה ובודקים אותם במחשב הזה. בינתיים אפשר לבחור «מסונתז».',
  'next.item_missing': 'הורידו את הכלים בכלי ההורדה של הספרייה (רשימת האודיו, חלק הכלים) ובדקו שוב.',
  'next.item_version': 'הורידו בכלי ההורדה את הגרסה הקבועה של הכלים ובדקו שוב.',
  'next.licence': 'אפשר לבחור «מסונתז»; הערכה הזו לא תתווסף עם הרישיון הזה.',
  'next.file_missing': 'בדקו את הספרייה בכלי ההורדה (‎--verify), הורידו שוב ובדקו שוב.',
  'next.file_changed': 'בדקו את הספרייה בכלי ההורדה (‎--verify), הורידו שוב ובדקו שוב.',
  'next.unreadable': 'בדקו את הספרייה בכלי ההורדה (‎--verify), הורידו שוב ובדקו שוב.',
  'next.checking': 'ממתינים לתשובה; אפשר להמשיך עם «מסונתז».',
  'next.ready': 'אפשר להקשיב בהשוואה עיוורת לפני שמוסיפים.',
  'next.no_kit': 'אפשר לבחור «מסונתז», או את הסגנון «רגוע ונעים».',
  'next.failed': 'נסו שוב. עד אז אפשר לבחור «מסונתז».',
  'recheck': 'בדיקה מחדש',
  // why a licence was refused
  'licenceSource': 'מקור: {title} — רישיון {licence}',
  'licenceWhy.sa': 'רישיון שמחייב לשתף באותו רישיון. מיקס של הדגימות בקטע הוא יצירה נגזרת, ולכן הערכה לא מתווספת.',
  'licenceWhy.nd': 'רישיון שאוסר יצירות נגזרות. מיקס של הדגימות בקטע הוא יצירה נגזרת, ולכן הערכה לא מתווספת.',
  'licenceWhy.unknown': 'רישיון שיומן הספרייה לא מכיר, ולכן הערכה לא מתווספת.',
  'licenceWhy.other': 'הרישיון ביומן הספרייה לא מתיר שימוש בדגימות בקטע.',
  // what the kit asks of a film, said before it is added
  'parts': '{recorded} מנוגנים מקובצי הספרייה; שאר החלקים מסונתזים',
  'dutiesHeading': 'מה הערכה מחייבת, לפני שמוסיפים',
  'dutyNone': '{title}: אין חובת קרדיט ואין הגבלה לשימוש מסחרי',
  'dutyNonCommercialMore': 'סרט עם הכלים האלה מסומן לשימוש לא מסחרי בלבד, והייצוא מזהיר על כך.',
  'dutyNoSources': 'לא דווחו מקורות לערכה, ולכן החובות שלה לא מוצגות כאן.',
  // the blind pair
  'auditionHelp': 'שתי הגרסאות מושמעות בלי שם, בסדר שלא ידוע לכם. אחרי שהאזנתם לשתיהן אפשר לגלות מה היה מה. שום בחירה לא נשמרת.',
  'auditionLoading': 'מכינים את שתי הגרסאות…',
  'auditionPlay': 'השמעת',
  'auditionStop': 'עצירת',
  'auditionNeedKit': 'ההשוואה אפשרית רק כשהכלים זמינים (ראו למעלה למה לא)',
  'auditionNeedRecorded': 'בחרו קודם «כלים מוקלטים»',
  'auditionNeedBars': 'אין אורך שאפשר להשמיע',
  'auditionNoLevel': 'השרת לא החזיר התאמת עוצמה, ולכן ההשוואה לא מושמעת: בלי התאמה היא לא הוגנת.',
  'auditionWrongVersion': 'השרת החזיר גרסה אחרת מהמבוקשת, ולכן ההשוואה לא מושמעת.',
  'auditionFailed': 'ההשוואה לא נוצרה',
  'auditionPlayFailed': 'ההשמעה נכשלה',
  'revealNeed': 'האזינו קודם ל«א» ול«ב»',
  'auditionClose': 'סגירת ההשוואה',
  // the owner's mark
  'heardHelp': 'הסימון נעשה רק מהחלון של בעל הפרויקט, נשמר במחשב הזה, ורק מתעד שהאזנתם.',
  'heardNeedKit': 'אפשר לסמן רק כשהכלים זמינים ושמעתם אותם',
  'heardFailed': 'הסימון לא נשמר',
  'heardCleared': 'הסימון בוטל',
  // the add and the preview
  'addedRecorded': 'כלים מוקלטים',
  'addNeedsKit': 'כלים מוקלטים לא זמינים עכשיו, ולכן לא נוסף דבר',
  'playNeedsKit': 'כלים מוקלטים לא זמינים עכשיו (ראו למעלה למה)',
} as const;
type Key = keyof typeof HE;
const EN: Record<Key, string> = {
  'soundHelp': '«Synthesised» — the music is made as before. «Recorded instruments» — some instruments play from recording files in your library; every part of the kit is recorded, or the music is not made and the reason is shown.',
  'state.not_calibrated': 'The instrument set has not been downloaded and checked on this computer yet',
  'state.no_kit': 'This style has no recorded instruments in this build',
  'state.failed': 'The recorded instruments could not be checked',
  'next.not_built': 'You can carry on with «Synthesised» — the music is made as before.',
  'next.library_not_set': 'The owner sets the library folder in Settings («My library»). Until then choose «Synthesised».',
  'next.not_calibrated': 'The kit is not offered until the instruments are downloaded to the library and checked on this computer. Meanwhile choose «Synthesised».',
  'next.item_missing': 'Download the instruments with the library download tool (the audio list, the instruments part) and check again.',
  'next.item_version': 'Download the pinned version of the instruments with the download tool and check again.',
  'next.licence': 'You can choose «Synthesised»; this kit will not be added with this licence.',
  'next.file_missing': 'Verify the library with the download tool (--verify), download again and check again.',
  'next.file_changed': 'Verify the library with the download tool (--verify), download again and check again.',
  'next.unreadable': 'Verify the library with the download tool (--verify), download again and check again.',
  'next.checking': 'Waiting for the answer; you can carry on with «Synthesised».',
  'next.ready': 'You can listen in a blind comparison before adding.',
  'next.no_kit': 'Choose «Synthesised», or the style «Calm and pleasant».',
  'next.failed': 'Try again. Until then choose «Synthesised».',
  'recheck': 'Check again',
  'licenceSource': 'Source: {title} — licence {licence}',
  'licenceWhy.sa': 'A licence that requires sharing under the same licence. Mixing the samples into a piece makes a derivative work, so the kit is not added.',
  'licenceWhy.nd': 'A licence that forbids derivative works. Mixing the samples into a piece makes a derivative work, so the kit is not added.',
  'licenceWhy.unknown': 'A licence the library ledger does not know, so the kit is not added.',
  'licenceWhy.other': 'The licence in the library ledger does not allow using the samples in a piece.',
  'parts': '{recorded} play from the library files; the other parts stay synthesised',
  'dutiesHeading': 'What the kit asks of a film, before you add it',
  'dutyNone': '{title}: no credit is required and commercial use is not restricted',
  'dutyNonCommercialMore': 'A film made with these instruments is marked for non-commercial use only, and the export warns about it.',
  'dutyNoSources': 'No sources were reported for the kit, so its duties are not shown here.',
  'auditionHelp': 'Both versions play without a name, in an order you do not know. After you have listened to both you can find out which was which. Nothing you choose is saved.',
  'auditionLoading': 'Preparing both versions…',
  'auditionPlay': 'Play',
  'auditionStop': 'Stop',
  'auditionNeedKit': 'The comparison is possible only when the instruments are available (see above for why not)',
  'auditionNeedRecorded': 'Choose «Recorded instruments» first',
  'auditionNeedBars': 'There is no length to play',
  'auditionNoLevel': 'The server sent no level match, so the comparison is not played: without it the comparison is not fair.',
  'auditionWrongVersion': 'The server sent a different version from the one asked for, so the comparison is not played.',
  'auditionFailed': 'The comparison could not be made',
  'auditionPlayFailed': 'Playback failed',
  'revealNeed': 'Listen to «A» and «B» first',
  'auditionClose': 'Close the comparison',
  'heardHelp': 'The mark is made only from the project owner\'s window, is kept on this computer, and only records that you listened.',
  'heardNeedKit': 'You can mark it only when the instruments are available and you have listened',
  'heardFailed': 'The mark was not saved',
  'heardCleared': 'The mark was removed',
  'addedRecorded': 'recorded instruments',
  'addNeedsKit': 'Recorded instruments are not available now, so nothing was added',
  'playNeedsKit': 'Recorded instruments are not available now (see above for why)',
};
/** The words only this page needs, both languages (tests walk them). */
export const INSTRUMENTS_UI_STRINGS: Readonly<Record<'he' | 'en', Readonly<Record<string, string>>>> = { he: HE, en: EN };

export type InstrumentsT = (key: string, vars?: Record<string, string | number>) => string;
export function instrumentsT(lang: Lang): InstrumentsT {
  const shared = dictionaries[lang] as Record<string, string>;
  const own = INSTRUMENTS_UI_STRINGS[lang === 'he' ? 'he' : 'en'];
  return (key, vars = {}) => (own[key] ?? shared[`instruments.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
