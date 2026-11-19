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
  // the server's people codes (apps/server/src/peoplePrivacy.ts): the scope rule and the archive «בלי פרטי משפחה»
  'error.code.people_scope_required': 'ההרשאה הזו אינה כוללת פרטי משפחה', 'error.code.title_too_long': 'כותרת ארוכה מדי',
  'error.code.family_free_refused': 'אי אפשר להכין ארכיון בלי פרטי משפחה', 'error.code.family_free_incomplete': 'הארכיון בלי פרטי משפחה לא הושלם',
} as const;
export const PEOPLE_EN: Record<keyof typeof PEOPLE_HE, string> = {
  'op.add_person': 'Added a person', 'op.update_person': 'Changed a person\'s details', 'op.remove_person': 'Removed a person',
  'life.missing.no_birth_date': 'This person has no birth date', 'life.missing.before_birth': 'The picture was taken before this person was born',
  'life.missing.unknown_age_format': 'This age field has a format that does not exist. Write the field again',
  'cmd.people': 'People…',
  'error.code.people_scope_required': 'This credential does not include family details', 'error.code.title_too_long': 'A title is too long',
  'error.code.family_free_refused': 'The archive without family details cannot be made', 'error.code.family_free_incomplete': 'The archive without family details was not completed',
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

/** What a refused credential may not do with a film (peoplePrivacy.ts assertMayTakeRendered, the `what` of each caller). */
const RENDERED_WHAT: Record<string, string> = { 'export this project': 'לייצא את הפרויקט', 'retry this export': 'להפעיל שוב את הייצוא', 'download this export': 'להוריד את הייצוא' };
/** The private details a 'names' credential may not give (peoplePrivacy.ts assertMayWritePeople). */
const PRIVATE_ARG: Record<string, string> = { birthDate: 'תאריך לידה', form: 'המילה שלפני הגיל (בן או בת)' };
/**
 * Hebrew wording of the server's people refusals (apps/server/src/peoplePrivacy.ts): the people scope and the archive
 * «בלי פרטי משפחה». `again` words a refusal quoted inside one (an operation's refusal inside family_free_refused).
 * packages/evals/src/people-wording.test.ts provokes each through the server's own functions.
 */
export const HE_PEOPLE_SERVER: [RegExp, (m: RegExpExecArray, again: (message: string) => string | undefined) => string][] = [
  [/^this credential may give a person's name only, not (birthDate|form)(?: or (birthDate|form))?$/, (m) => `ההרשאה הזו מאפשרת לכתוב רק את שם האדם, לא ${[m[1]!, m[2]].filter(Boolean).map((k) => PRIVATE_ARG[k!]).join(' ולא ')}. את הפרטים האלה מוסיפים בעל/ת הפרויקט בגיליון האנשים`],
  [/^this credential may not (.+?): a title shows a person's age, which is worked out from a birth date$/, (m) => `ההרשאה הזו אינה מאפשרת ${RENDERED_WHAT[m[1]!] ?? 'את הפעולה הזו'}: כותרת מציגה גיל של אדם, והגיל מחושב מתאריך לידה. כותרת שנקבעה כטקסט רגיל כבר אינה נחשבת`],
  [/^(?:a title|(\d+) titles) would pass 2000 characters as plain text, so the archive without family details cannot be written$/, (m) => `${m[1] ? `${m[1]} כותרות היו עוברות` : 'כותרת אחת הייתה עוברת'} 2000 תווים כטקסט רגיל, ולכן אי אפשר לכתוב את הארכיון בלי פרטי משפחה. אפשר לקצר את הכותרת, או לקבוע אותה כטקסט רגיל ולקצר אז`],
  [/^the titles could not be made plain text for the archive without family details: ([\s\S]+)$/, (m, again) => `לא היה אפשר לקבוע את הכותרות כטקסט רגיל לארכיון בלי פרטי משפחה: ${again(m[1]!) ?? m[1]}`],
  [/^the archive without family details came out incomplete, so it is not written$/, () => 'הארכיון בלי פרטי משפחה יצא חסר, ולכן הוא לא נכתב. זו תקלה בגרסה הזו; הפרויקט לא השתנה'],
];
