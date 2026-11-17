/**
 * Strings of the life-line UI (ADR-0021): the library by date and by event, the capture date editor and the clock shift, the
 * "on this day" card, the field menu of a title and the date stamp's source. Kept here so the shared dictionaries keep only
 * what other surfaces use (operation names, preflight headlines and the `life.*` keys are in packages/i18n/src/lifeline.ts).
 * Hebrew first; the English entries must cover the same keys with the same `{name}` marks (lifeline.strings.test.ts).
 * Lead contracts commit: the wording the plan fixes. W3 adds keys beside these as the screens need them.
 * People (names, ages, the people sheet) are not part of this build and have no strings.
 */
export type LifeLang = 'he' | 'en';
export const LIFE_STRINGS = {
  he: {
    // media drawer: views
    viewLabel: 'תצוגת הספרייה', viewAll: 'הכול', viewByDate: 'לפי תאריך', viewEvents: 'אירועים',
    undated: 'בלי תאריך ({n})', readDates: 'קריאת תאריכים מהקבצים', readDatesDone: 'נבדקו {read} קבצים; ל־{dated} נמצא תאריך',
    undatedHeicNote: 'תמונות HEIC (ברירת המחדל באייפון) עדיין אינן נקראות, ולכן הן מופיעות כאן. אפשר לקבוע להן תאריך ידנית.',
    clusterNudge: 'נמצאו {n} קבצים עם תאריך', cluster: 'סידור לפי אירועים',
    // events
    eventFiles: '{n} קבצים', eventMenu: 'פעולות על האירוע', eventRename: 'שינוי שם', eventMergePrev: 'מיזוג עם הקודם', eventSplitHere: 'פיצול מכאן', eventRemove: 'הסרת הקיבוץ', eventAddToTimeline: 'הוספת האירוע לציר הזמן',
    sunsetLegend: 'מתי צולם?', sunsetBefore: 'לפני השקיעה', sunsetAfter: 'אחרי השקיעה',
    sunsetNote: 'התאריך העברי מתחלף בשקיעה. עד שתיבחר תשובה לא יוצגו תאריך עברי ושם חג לקבצים האלה.',
    // capture date
    dateCirca: 'משוער משם הקובץ', captureMenu: 'תאריך צילום…', captureDate: 'תאריך', captureTime: 'שעה (לא חובה)', captureCirca: 'משוער', captureSave: 'שמירה', captureRemove: 'הסרת התאריך',
    captureAssumedZone: 'השעה חושבה לפי אזור הזמן {zone}', captureInherited: 'התאריך נלקח מהקובץ שממנו נוצר הקובץ הזה',
    shiftClock: 'הזזת השעון…', shiftBy: 'כמה להזיז', shiftHours: 'שעות', shiftDays: 'ימים', shiftEarlier: 'אחורה', shiftLater: 'קדימה',
    shiftNote: 'יש מצלמות שרושמות שעה מקומית כאילו הייתה שעון עולמי, ויש שרושמות את סוף הצילום ולא את תחילתו. כאן מתקנים זאת לכמה קבצים יחד.',
    // on this day
    onThisDayYears: 'היום לפני {n} שנים', onThisDayOneYear: 'היום לפני שנה', onThisDayHebrew: '{date} לפני {n} שנים', onThisDayOpen: 'פתיחה',
    // title fields
    fieldAdd: 'הוסף שדה', fieldDate: 'תאריך צילום', fieldHebrewDate: 'תאריך עברי', fieldYear: 'שנה', fieldHebrewYear: 'שנה עברית', fieldEvent: 'שם האירוע',
    fieldFormatLong: 'מלא', fieldFormatNumeric: 'במספרים', fieldFormatMonthYear: 'חודש ושנה', fieldFormatEnglish: 'באנגלית', fieldFormatNoYear: 'בלי שנה',
    fieldNoData: 'אין נתון', fieldLive: 'מוצג כעת: {text}', fieldFreeze: 'קבע כטקסט רגיל', fieldFrozen: 'הכותרת נקבעה כטקסט רגיל',
    fieldVaries: 'הערך משתנה לאורך הכותרת; ייקבע הערך שמוצג כעת', fieldFixDate: 'קביעת תאריך', fieldFixSunset: 'בחירה באירוע', fieldNotAField: 'זה אינו שדה: {group}',
    // date stamp
    stampSourceLabel: 'מקור התאריך', stampSourceText: 'טקסט', stampSourceCapture: 'מתאריך הצילום', stampClock: 'שעון', stampOrderLabel: 'סדר התאריך',
  },
  en: {
    viewLabel: 'Library view', viewAll: 'All', viewByDate: 'By date', viewEvents: 'Events',
    undated: 'No date ({n})', readDates: 'Read dates from the files', readDatesDone: '{read} files checked; {dated} got a date',
    undatedHeicNote: 'HEIC photos (the iPhone default) are not read yet, so they appear here. You can set their date by hand.',
    clusterNudge: '{n} files with a date were found', cluster: 'Arrange by events',
    eventFiles: '{n} files', eventMenu: 'Event actions', eventRename: 'Rename', eventMergePrev: 'Merge with the previous one', eventSplitHere: 'Split from here', eventRemove: 'Remove the grouping', eventAddToTimeline: 'Add the event to the timeline',
    sunsetLegend: 'When was it filmed?', sunsetBefore: 'Before sunset', sunsetAfter: 'After sunset',
    sunsetNote: 'The Hebrew date changes at sunset. Until you answer, no Hebrew date or holiday name is shown for these files.',
    dateCirca: 'Estimated from the file name', captureMenu: 'Capture date…', captureDate: 'Date', captureTime: 'Time (optional)', captureCirca: 'Estimate', captureSave: 'Save', captureRemove: 'Remove the date',
    captureAssumedZone: 'The time was worked out for the time zone {zone}', captureInherited: 'The date comes from the file this one was made from',
    shiftClock: 'Shift the clock…', shiftBy: 'How far', shiftHours: 'hours', shiftDays: 'days', shiftEarlier: 'Earlier', shiftLater: 'Later',
    shiftNote: 'Some cameras write local time as if it were universal time, and some write the end of the recording rather than its start. This corrects several files together.',
    onThisDayYears: 'On this day {n} years ago', onThisDayOneYear: 'On this day a year ago', onThisDayHebrew: '{date}, {n} years ago', onThisDayOpen: 'Open',
    fieldAdd: 'Add field', fieldDate: 'Capture date', fieldHebrewDate: 'Hebrew date', fieldYear: 'Year', fieldHebrewYear: 'Hebrew year', fieldEvent: 'Event name',
    fieldFormatLong: 'Full', fieldFormatNumeric: 'In numbers', fieldFormatMonthYear: 'Month and year', fieldFormatEnglish: 'In English', fieldFormatNoYear: 'Without the year',
    fieldNoData: 'No data', fieldLive: 'Showing now: {text}', fieldFreeze: 'Make it plain text', fieldFrozen: 'The title is now plain text',
    fieldVaries: 'The value changes along the title; the one showing now will be kept', fieldFixDate: 'Set a date', fieldFixSunset: 'Choose in the event', fieldNotAField: 'This is not a field: {group}',
    stampSourceLabel: 'Date from', stampSourceText: 'Text', stampSourceCapture: 'The capture date', stampClock: 'Clock', stampOrderLabel: 'Date order',
  },
} as const satisfies Record<LifeLang, Record<string, string>>;
export type LifeKey = keyof typeof LIFE_STRINGS.he;
/** A string in the interface language; `{name}` marks are filled with `fill`. */
export const lifeT = (lang: LifeLang) => (key: LifeKey): string => LIFE_STRINGS[lang][key];
/** A string with its `{name}` marks replaced by the values given (a mark without a value stays as it is). */
export const fill = (s: string, values: Readonly<Record<string, string | number>>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(values, k) ? String(values[k]) : m));
