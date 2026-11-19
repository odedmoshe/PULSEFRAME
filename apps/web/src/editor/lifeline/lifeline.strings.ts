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
    // library views (W3)
    libraryNoDates: 'אין עדיין קבצים עם תאריך צילום. אפשר לקרוא תאריכים מהקבצים או לקבוע אותם ידנית בתפריט הקובץ',
    readDatesBusy: 'קורא תאריכים…', readDatesFailed: 'קריאת התאריכים לא הצליחה: {why}', readDatesUnavailable: 'קריאת תאריכים מהקבצים אינה זמינה בשרת הזה',
    eventsNone: 'עוד אין אירועים. סידור לפי אירועים מקבץ את הקבצים שיש להם תאריך לפי מועד הצילום; אפשר לשנות כל קיבוץ אחר כך',
    eventsNoDated: 'אין בספרייה קבצים עם תאריך צילום, ולכן אין מה לקבץ',
    eventUntitled: 'אירוע בלי תאריך', eventRenameLabel: 'שם האירוע', eventRenameHint: 'השאירו ריק כדי שהאירוע יופיע לפי תאריך או חג', cancel: 'ביטול', eventDerived: 'שם לפי החג',
    eventAdded: 'האירוע נוסף לציר הזמן', eventAddedBody: '{n} קליפים', eventAddNone: 'באירוע אין קבצים להוספה',
    eventMerged: 'האירוע מוזג עם הקודם', eventSplit: 'האירוע פוצל', eventRemoved: 'הקיבוץ הוסר; הקבצים נשארים בספרייה', eventNamed: 'האירוע נקרא {name}', eventSunsetSaved: 'נבחר: {answer}', eventArranged: 'הספרייה סודרה לפי אירועים',
    splitPick: 'פיצול מכאן', splitPickLabel: 'הקובץ שממנו מתחיל האירוע החדש',
    // capture date popover
    captureTitle: 'תאריך צילום', captureEchoLabel: 'היום בשבוע ובלוח העברי', captureSource: 'מקור התאריך: {source}', captureCancel: 'ביטול',
    captureBadDay: 'התאריך אינו קיים בלוח', captureBadTime: 'השעה אינה תקינה', captureOutOfRange: 'תאריך צילום יכול להיות בין 1900 ל־2100', captureEmpty: 'יש לבחור תאריך', captureNone: 'לקובץ אין תאריך צילום',
    captureSaved: 'תאריך הצילום נקבע', captureRemoved: 'תאריך הצילום הוסר', dateBadgeLabel: 'תאריך צילום {date}', dateBadgeCircaLabel: 'תאריך משוער {date}, {source}',
    // clock shift
    shiftTitle: 'הזזת השעון', shiftFiles: 'הקבצים שיוזזו', shiftApply: 'הזזה', shiftDirection: 'כיוון', shiftMinutesUnit: 'דקות',
    shiftZero: 'יש להזין הזזה של דקה אחת לפחות', shiftTooBig: 'ההזזה גדולה מדי בפעם אחת', shiftNoFiles: 'אין קבצים שאפשר להזיז', shiftDone: 'השעון הוזז ב־{n} קבצים',
    shiftBlockNoDate: 'אין תאריך', shiftBlockInherited: 'התאריך נלקח מקובץ המקור; מזיזים את המקור', shiftBlockDayOnly: 'תאריך בלי שעה: מזיזים בימים שלמים בלבד',
    // on this day
    onThisDayFrom: 'מתוך {project}', onThisDayRegion: 'ביום הזה', onThisDayMore: 'ועוד {n}',
    // title fields
    fieldFormatMonthYearEnglish: 'חודש ושנה באנגלית', fieldMenuLabel: 'שדות בכותרת', fieldHint: 'שדה מתמלא מתאריך הצילום של הקליפ שמתחת לכותרת',
    fieldMasterOnly: 'שדות נוספים בנוסח הראשי בלבד. חזרו מתצוגת הפורמט לנוסח הראשי', fieldLiveEmpty: '(ריק)',
    fieldFreezeNone: 'לכותרת אין שדות חיים', fieldFreezeMissing: 'אי אפשר לקבוע כטקסט רגיל כשלשדה אין נתון: {tokens}', fieldFreezeTooLong: 'הטקסט שיתקבל ארוך מדי לכותרת', fieldFreezeFailed: 'לא ניתן לקבוע את הכותרת כטקסט רגיל',
    fieldInsertRefused: 'לא ניתן להוסיף את השדה: {why}', fieldFixArrange: 'סידור לפי אירועים', fieldFixNoEvent: 'הקליפ שמתחת לכותרת אינו באירוע. סידור לפי אירועים יקבץ אותו',
    fieldBoxRefused: 'הכותרת לא נשמרה. הקבוצות האלה אינן שדות: {groups}', fieldBoxHint: 'שדות נכתבים בסוגריים מסולסלים. כדי להציג סוגריים כמו שהם, כתבו אותם כפולים',
    // date stamp
    stampNote: 'כשהחותמת לוקחת את התאריך מהצילום, לא יצויר דבר בקליפ שאין לו תאריך', stampSourceGroup: 'חותמת תאריך',
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
    libraryNoDates: 'No file has a capture date yet. Read the dates from the files, or set them by hand from a file\'s menu',
    readDatesBusy: 'Reading dates…', readDatesFailed: 'Reading the dates failed: {why}', readDatesUnavailable: 'Reading dates from the files is not available on this server',
    eventsNone: 'No events yet. Arranging by events groups the files that have a date by when they were filmed; each grouping can be changed afterwards',
    eventsNoDated: 'No file in the library has a capture date, so there is nothing to group',
    eventUntitled: 'Event without a date', eventRenameLabel: 'Event name', eventRenameHint: 'Leave it empty to show the event by its date or holiday', cancel: 'Cancel', eventDerived: 'Named after the holiday',
    eventAdded: 'The event was added to the timeline', eventAddedBody: '{n} clips', eventAddNone: 'The event has no files to add',
    eventMerged: 'The event was merged with the previous one', eventSplit: 'The event was split', eventRemoved: 'The grouping was removed; the files stay in the library', eventNamed: 'The event is now called {name}', eventSunsetSaved: 'Chosen: {answer}', eventArranged: 'The library was arranged by events',
    splitPick: 'Split from here', splitPickLabel: 'The file where the new event starts',
    captureTitle: 'Capture date', captureEchoLabel: 'Weekday and Hebrew date', captureSource: 'Where the date came from: {source}', captureCancel: 'Cancel',
    captureBadDay: 'That day does not exist in the calendar', captureBadTime: 'That time is not valid', captureOutOfRange: 'A capture date lies between 1900 and 2100', captureEmpty: 'Choose a date', captureNone: 'This file has no capture date',
    captureSaved: 'The capture date was set', captureRemoved: 'The capture date was removed', dateBadgeLabel: 'Capture date {date}', dateBadgeCircaLabel: 'Estimated date {date}, {source}',
    shiftTitle: 'Shift the clock', shiftFiles: 'Files to shift', shiftApply: 'Shift', shiftDirection: 'Direction', shiftMinutesUnit: 'Minutes',
    shiftZero: 'Enter a shift of at least one minute', shiftTooBig: 'That is too far for one step', shiftNoFiles: 'There are no files that can be shifted', shiftDone: 'The clock of {n} files was shifted',
    shiftBlockNoDate: 'No date', shiftBlockInherited: 'The date comes from the source file; shift the source', shiftBlockDayOnly: 'A date without a time moves by whole days only',
    onThisDayFrom: 'From {project}', onThisDayRegion: 'On this day', onThisDayMore: '{n} more',
    fieldFormatMonthYearEnglish: 'Month and year in English', fieldMenuLabel: 'Title fields', fieldHint: 'A field is filled from the capture date of the clip under the title',
    fieldMasterOnly: 'Fields are added to the main wording only. Leave the format view for the main wording', fieldLiveEmpty: '(empty)',
    fieldFreezeNone: 'This title has no live fields', fieldFreezeMissing: 'It cannot be made plain text while a field has no data: {tokens}', fieldFreezeTooLong: 'The resulting text is too long for a title', fieldFreezeFailed: 'The title could not be made plain text',
    fieldInsertRefused: 'The field could not be added: {why}', fieldFixArrange: 'Arrange by events', fieldFixNoEvent: 'The clip under the title is in no event. Arranging by events will group it',
    fieldBoxRefused: 'The title was not saved. These groups are not fields: {groups}', fieldBoxHint: 'Fields are written in curly braces. To show braces as they are, write them twice',
    stampNote: 'When the stamp takes its date from the footage, nothing is drawn on a clip that has no date', stampSourceGroup: 'Date stamp',
  },
} as const satisfies Record<LifeLang, Record<string, string>>;
export type LifeKey = keyof typeof LIFE_STRINGS.he;
/** One language's strings, as the components take them. */
export type LifeWords = Record<LifeKey, string>;
/** A string in the interface language; `{name}` marks are filled with `fill`. */
export const lifeT = (lang: LifeLang) => (key: LifeKey): string => LIFE_STRINGS[lang][key];
/** A string with its `{name}` marks replaced by the values given (a mark without a value stays as it is). */
export const fill = (s: string, values: Readonly<Record<string, string | number>>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(values, k) ? String(values[k]) : m));
