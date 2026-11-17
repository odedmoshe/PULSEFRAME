/**
 * Interface strings of the life line (ADR-0021): capture dates, events, live title fields and the capture-sourced date stamp.
 * Spread into `he` and `en` (index.ts); Hebrew first, and the English dictionary must cover the same keys.
 * Here: the operation names (`op.*`, op-wording.test.ts), the headlines of the export preflight codes (`preflight.*`; the
 * server's own English sentence is the detail), and the namespace `life.*`, reserved for this track: why a field has no words
 * (`life.missing.<reason>`, core fields.ts MISSING_REASONS) and where a capture date came from (`life.capture.source.*`).
 * The panels' own strings live next to them (apps/web/src/editor/lifeline/lifeline.strings.ts).
 * Also here: the Hebrew wording of every refusal of the life-line operations (HE_LIFE), which refusals.ts adds to
 * translateRefusal; packages/evals/src/lifeline-wording.test.ts keeps it in step with core lifeOps.ts LIFE_REFUSALS.
 * People (names, ages) are not part of this build and have no strings.
 */
export const LIFELINE_HE = {
  'op.set_asset_capture': 'קביעת תאריך צילום', 'op.shift_asset_captures': 'הזזת השעון של קבצים', 'op.attach_asset_capture': 'קריאת תאריך צילום מהקובץ',
  'op.set_text_fields': 'שדות בכותרת', 'op.cluster_events': 'סידור לפי אירועים', 'op.add_event': 'אירוע חדש', 'op.update_event': 'שינוי אירוע', 'op.remove_event': 'הסרת קיבוץ האירוע',
  'preflight.field_no_data': 'שדה ללא נתון', 'preflight.field_sunset_undecided': 'התאריך העברי תלוי בשקיעה', 'preflight.capture_estimated': 'תאריך משוער משם הקובץ', 'preflight.stamp_no_date': 'חותמת תאריך בלי תאריך צילום',
  'life.missing.no_date': 'אין תאריך לקליפ שמתחת לכותרת', 'life.missing.sunset_undecided': 'התאריך העברי תלוי בשאלה אם צולם אחרי השקיעה', 'life.missing.no_event_name': 'הקליפ שמתחת לכותרת אינו באירוע שיש לו שם', 'life.missing.unknown_person': 'השדה מפנה לאדם שאינו בפרויקט',
  'life.capture.source.container': 'נקרא מהקובץ', 'life.capture.source.exif': 'נקרא מנתוני התמונה', 'life.capture.source.filename': 'משוער משם הקובץ', 'life.capture.source.manual': 'נקבע ידנית',
} as const;
export const LIFELINE_EN: Record<keyof typeof LIFELINE_HE, string> = {
  'op.set_asset_capture': 'Set capture date', 'op.shift_asset_captures': 'Shifted the clock of files', 'op.attach_asset_capture': 'Read capture date from the file',
  'op.set_text_fields': 'Title fields', 'op.cluster_events': 'Arranged by events', 'op.add_event': 'New event', 'op.update_event': 'Changed event', 'op.remove_event': 'Removed event grouping',
  'preflight.field_no_data': 'A field has no data', 'preflight.field_sunset_undecided': 'The Hebrew date depends on sunset', 'preflight.capture_estimated': 'Date estimated from the file name', 'preflight.stamp_no_date': 'Date stamp without a capture date',
  'life.missing.no_date': 'The clip under the title has no date', 'life.missing.sunset_undecided': 'The Hebrew date depends on whether it was filmed after sunset', 'life.missing.no_event_name': 'The clip under the title is in no event with a name', 'life.missing.unknown_person': 'The field names a person who is not in the project',
  'life.capture.source.container': 'Read from the file', 'life.capture.source.exif': 'Read from the picture\'s own data', 'life.capture.source.filename': 'Estimated from the file name', 'life.capture.source.manual': 'Set by hand',
};

/** A left-to-right run (brace groups, ids) isolated inside the Hebrew sentence, so its braces and order survive. */
const ltr = (s: string) => `⁦${s}⁩`;
/**
 * Hebrew wording of the refusals of the life-line operations (core lifeOps.ts LIFE_REFUSALS), recognised by their shape
 * like the other tables in refusals.ts. One row per refusal, in the order of LIFE_REFUSALS.
 */
export const HE_LIFE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^asset \S+ not found$/, () => 'הקובץ לא נמצא בספרייה'],
  [/^event \S+ not found$/, () => 'האירוע לא נמצא'],
  [/^a colour table \(LUT\) has no capture date$/, () => 'לטבלת צבע (LUT) אין תאריך צילום'],
  [/^that day does not exist in the calendar$/, () => 'התאריך הזה אינו קיים בלוח השנה'],
  [/^a capture date lies between (\d+) and (\d+)$/, (m) => `תאריך צילום יכול להיות בין השנים ${m[1]} ל־${m[2]}`],
  [/^the file already has this capture date$/, () => 'לקובץ כבר יש תאריך הצילום הזה'],
  [/^the file has no capture date of its own to remove$/, () => 'לקובץ אין תאריך צילום משלו שאפשר להסיר'],
  [/^a file is listed more than once$/, () => 'קובץ מופיע ברשימה יותר מפעם אחת'],
  [/^(\d+) of the listed file\(s\) have no capture date$/, (m) => `ל־${m[1]} מהקבצים שנבחרו אין תאריך צילום. אפשר לקבוע להם תאריך או להוציא אותם מהבחירה`],
  [/^(\d+) of the listed file\(s\) have a date without a time, which moves by whole days only$/, (m) => `ל־${m[1]} מהקבצים שנבחרו יש תאריך בלי שעה, ולכן אפשר להזיז אותם רק בימים שלמים`],
  [/^(\d+) of the listed file\(s\) take their date from the file they were made from$/, (m) => `${m[1]} מהקבצים שנבחרו מקבלים את התאריך מהקובץ שממנו נוצרו; יש להזיז את השעון של קובץ המקור`],
  [/^only a title can hold live fields$/, () => 'רק כותרת יכולה להכיל שדות'],
  [/^live fields are already (on|off) for this title$/, (m) => (m[1] === 'on' ? 'השדות בכותרת הזו כבר פעילים' : 'השדות בכותרת הזו כבר כבויים')],
  [/^these brace groups are not fields: ([\s\S]+)$/, (m) => `הסוגריים המסולסלים האלה אינם שדות: ${ltr(m[1]!)}. כדי שסוגריים מסולסלים יוצגו כמו שהם יש לכפול אותם`],
  [/^these fields name a person, and this project holds no people: ([\s\S]+)$/, (m) => `השדות האלה מפנים לאדם, ובפרויקט אין אנשים: ${ltr(m[1]!)}. יש למחוק אותם מהטקסט`],
  [/^this title still holds fields, so turning live fields off would show their names instead of their values$/, () => 'בכותרת עדיין יש שדות, וכיבוי השדות היה מציג את שמותיהם במקום את הערכים. אפשר לקבוע אותה כטקסט רגיל, או למחוק את השדות מהטקסט'],
  [/^no picture or video in the library has a capture date$/, () => 'לאף תמונה או סרטון בספרייה אין תאריך צילום. אפשר לקבוע תאריכים ידנית או לקרוא אותם מהקבצים'],
  [/^a project holds at most (\d+) events$/, (m) => `בפרויקט יכולים להיות עד ${m[1]} אירועים`],
  [/^an event holds pictures and videos only$/, () => 'אירוע מכיל תמונות וסרטונים בלבד'],
  [/^an event keeps at least one file$/, () => 'באירוע חייב להישאר קובץ אחד לפחות. אפשר להסיר את האירוע עצמו; הקבצים יישארו בספרייה'],
  [/^nothing to change: give name, afterSunset, addAssetIds or removeAssetIds$/, () => 'לא נבחר שום שינוי באירוע'],
  [/^a file to remove is not in this event$/, () => 'קובץ שנבחר להסרה אינו באירוע הזה'],
  [/^a file is listed both to add and to remove$/, () => 'קובץ מופיע גם ברשימת ההוספה וגם ברשימת ההסרה'],
];
