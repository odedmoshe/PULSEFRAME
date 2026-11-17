/**
 * Strings of the people UI (ADR-0021, people section): the people sheet, its privacy line, and the archive option
 * «בלי פרטי משפחה». Kept apart from lifeline.strings.ts (that file's test checks that the life-line strings do not speak of
 * people). The shared strings (operation names, the reasons an age has no words, the palette command) are in
 * packages/i18n/src/people.ts. Hebrew first; English covers the same keys with the same `{name}` marks
 * (people.strings.test.ts). Lead contracts commit: the wording the contract fixes; W3 adds keys beside these as the screens
 * need them, and never changes `privacy` without changing what the server does (apps/server/src/peopleSurfaces.ts).
 *
 * `privacy` is the one sentence about what connected agents see. It must stay exactly true:
 * - names and birth dates are in the project file on this machine (core schema.ts PersonSchema; the archive carries them
 *   unless «בלי פרטי משפחה» is chosen);
 * - a credential without the people scope (every agent, unless the owner granted people: 'full') gets ids and names only:
 *   no birth date, no word choice, no age worked out from them (the evaluator runs on the document without birth dates for
 *   it, so age fields are drawn empty), and no export of a project whose titles show an age (apps/server/src/peoplePrivacy.ts);
 * - an age made plain text, or typed by hand, is ordinary text, visible like any other.
 */
import { fill } from './lifeline.strings.ts';
export type PeopleLang = 'he' | 'en';
export const PEOPLE_STRINGS = {
  he: {
    sheetTitle: 'אנשים', personAdd: 'הוספת אדם', name: 'שם', birthDate: 'תאריך לידה', birthDateHebrew: 'בלוח העברי: {date}', noBirthDate: 'בלי תאריך לידה, הגיל לא יוצג',
    formLabel: 'המילה לפני הגיל', formM: 'בן', formF: 'בת', formNone: '— (גיל)',
    remove: 'הסרה', removeInUse: 'אי אפשר להסיר: {n} כותרות מציגות שדה של האדם הזה. אפשר לקבוע אותן כטקסט רגיל קודם',
    copy: 'העתקה מפרויקט אחר', copyNone: 'אין אנשים בפרויקטים האחרים', copyFrom: 'מתוך {project}',
    privacy: 'השמות ותאריכי הלידה נשמרים בקובץ הפרויקט, במחשב הזה. מפרטי האנשים, סוכן מחובר מקבל את השמות בלבד: לא את תאריכי הלידה ולא את הגילים שמחושבים מהם (בכותרות הם מוצגים לו ריקים, וייצוא שמציג גיל נחסם בפניו), אלא אם נתת לו הרשאה לתאריכי לידה. גיל שנקבע כטקסט רגיל, או שהוקלד בכותרת או בשם של אירוע, גלוי לו כמו כל טקסט אחר.',
    archiveFamily: 'בלי פרטי משפחה',
    archiveFamilyNote: 'הארכיון ייכתב בלי האנשים: שדות של שם וגיל ייקבעו כטקסט רגיל, כפי שהם מוצגים כעת. קובצי המדיה עצמם לא משתנים.',
    archiveFamilyVarying: 'הכותרות האלה משתנות לאורכן, ויישמרו עם הערך שבתחילתן:', archiveFamilyEmpty: 'בכותרות האלה יש שדה בלי נתון, והוא יישאר ריק:',
  },
  en: {
    sheetTitle: 'People', personAdd: 'Add a person', name: 'Name', birthDate: 'Birth date', birthDateHebrew: 'Hebrew calendar: {date}', noBirthDate: 'Without a birth date the age is not shown',
    formLabel: 'Hebrew word before the age', formM: 'בן', formF: 'בת', formNone: '— (גיל)',
    remove: 'Remove', removeInUse: 'Cannot remove: {n} titles show a field for this person. Make them plain text first',
    copy: 'Copy from another project', copyNone: 'No people in the other projects', copyFrom: 'From {project}',
    privacy: 'Names and birth dates are kept in the project file, on this computer. Of these details, a connected agent gets the names only: not the birth dates and not the ages worked out from them (titles show them empty to it, and exports that show an age are refused to it), unless you gave it access to birth dates. An age made plain text, or typed into a title or an event name, is visible to it like any other text.',
    archiveFamily: 'Without family details',
    archiveFamilyNote: 'The archive is written without the people: name and age fields become plain text, as they show now. The media files themselves are not changed.',
    archiveFamilyVarying: 'These titles change along their length and keep the value at their start:', archiveFamilyEmpty: 'These titles hold a field without data, which stays empty:',
  },
} as const satisfies Record<PeopleLang, Record<string, string>>;
export type PeopleKey = keyof typeof PEOPLE_STRINGS.he;
/** A string in the interface language; `{name}` marks are filled with `fill` (lifeline.strings.ts). */
export const peopleT = (lang: PeopleLang) => (key: PeopleKey): string => PEOPLE_STRINGS[lang][key];
export { fill };
