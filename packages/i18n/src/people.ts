/**
 * Shared interface strings of the people of a project (ADR-0021, people section): the names of the three operations
 * (`op.*`, op-wording.test.ts), the three new reasons an age field has no words (the third for an age format stored before the formats were fixed) (`life.missing.*`, core fields.ts
 * MISSING_REASONS) and the palette command that opens the people sheet. Spread into `he` and `en` (index.ts); Hebrew first,
 * and the English dictionary must cover the same keys. The sheet's own strings live next to it
 * (apps/web/src/editor/lifeline/people.strings.ts).
 * Also here: the Hebrew wording of every refusal of the people operations (HE_PEOPLE), which refusals.ts adds to
 * translateRefusal; packages/evals/src/people-wording.test.ts keeps it in step with core peopleOps.ts PEOPLE_REFUSALS.
 * No string here, and no refusal, ever holds a birth date.
 */
export const PEOPLE_HE = {
  'op.add_person': 'הוספת אדם', 'op.update_person': 'עדכון פרטי אדם', 'op.remove_person': 'הסרת אדם',
  'life.missing.no_birth_date': 'אין תאריך לידה לאדם הזה', 'life.missing.before_birth': 'התמונה צולמה לפני שהאדם הזה נולד',
  'life.missing.unknown_age_format': 'צורת הגיל בשדה הזה אינה קיימת. אפשר לכתוב את השדה מחדש',
  'cmd.people': 'אנשים…',
} as const;
export const PEOPLE_EN: Record<keyof typeof PEOPLE_HE, string> = {
  'op.add_person': 'Added a person', 'op.update_person': 'Changed a person\'s details', 'op.remove_person': 'Removed a person',
  'life.missing.no_birth_date': 'This person has no birth date', 'life.missing.before_birth': 'The picture was taken before this person was born',
  'life.missing.unknown_age_format': 'This age field has a format that does not exist. Write the field again',
  'cmd.people': 'People…',
};

/** A left-to-right run (brace groups, ids) isolated inside the Hebrew sentence, so its braces and order survive. */
const ltr = (s: string) => `⁦${s}⁩`;
/** A name inside a sentence, isolated so that a name in another script does not reorder the words around it. */
const named = (s: string) => `⁨${s}⁩`;
/**
 * Hebrew wording of the refusals of the people operations (core peopleOps.ts PEOPLE_REFUSALS), recognised by their shape
 * like the other tables in refusals.ts. One row per refusal, in the order of PEOPLE_REFUSALS.
 */
export const HE_PEOPLE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^person \S+ not found$/, () => 'האדם לא נמצא בפרויקט'],
  [/^a name cannot hold braces, a colon, a bar or a line break$/, () => 'שם אינו יכול להכיל סוגריים מסולסלים, נקודתיים, קו אנכי או ירידת שורה'],
  [/^a name needs at least one character that is not a space$/, () => 'צריך לכתוב שם'],
  [/^a birth date must be a day that exists in the calendar$/, () => 'תאריך הלידה הזה אינו קיים בלוח השנה'],
  [/^a birth date lies between (\d+) and (\d+)$/, (m) => `תאריך לידה יכול להיות בין השנים ${m[1]} ל־${m[2]}`],
  [/^another person in this project is already called "([\s\S]+)"$/, (m) => `כבר יש בפרויקט אדם בשם ${named(m[1]!)}. כדאי לבחור שם שמבדיל ביניהם`],
  [/^a project holds at most (\d+) people$/, (m) => `בפרויקט יכולים להיות עד ${m[1]} אנשים`],
  [/^nothing to change: give name, birthDate or form$/, () => 'לא נבחר שום שינוי בפרטי האדם'],
  [/^the person already has these details$/, () => 'אלה כבר הפרטים של האדם הזה'],
  [/^(\d+) title\(s\) hold a field for this person$/, (m) => `${m[1]} כותרות מציגות שדה של האדם הזה. אפשר לקבוע אותן כטקסט רגיל, או למחוק מהן את השדות, ואז להסיר את האדם`],
  [/^these fields name a person who is not in this project: ([\s\S]+)$/, (m) => `השדות האלה מפנים לאדם שאינו בפרויקט: ${ltr(m[1]!)}. אפשר להוסיף את האדם, או למחוק את השדות מהטקסט`],
];
