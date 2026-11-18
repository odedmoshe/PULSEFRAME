/**
 * Interface strings of the family film maker («סרט משפחתי בלחיצה», ADR-0026) and of measured moments. Spread into `he` and `en`
 * (index.ts); Hebrew first, and the English dictionary covers the same keys. Namespaces of this track: `film.*` (fixed lines
 * every surface shares: the recipe's name, the draft label, the heuristic and faces notes, the palette command) and `moments.*`
 * (the measurement's label and states), the operation name (`op.attach_moments`, op-wording.test.ts) and the error codes of the
 * film and moments routes (`error.code.*`). The job stage word 'measuring moments' is in effectParams.ts STAGE_WORDS.
 * The dialog's, bar's and inspector section's own strings — the reason, exclusion and warning wording with their numbers — are
 * apps/web/src/editor/familyFilm.strings.ts (W3), with numbers in <bdi>.
 * Also here: the Hebrew wording of the refusals of attach_moments (core momentsOps.ts MOMENTS_REFUSALS) and of the film and
 * moments routes (apps/server/src/familyFilm.ts FILM_API_ERRORS, moments.ts momentsNotBuilt) — HE_FAMILY_FILM, which
 * refusals.ts adds to translateRefusal; packages/evals/src/family-film-wording.test.ts keeps them in step and provokes each.
 * No string here says best, score, quality or viral, or calls the film AI: it is a heuristic first draft (a strings test checks).
 */
export const FAMILY_FILM_HE = {
  'op.attach_moments': 'מדידת רגעים',
  'film.name': 'סרט משפחתי בלחיצה',
  'film.draft': 'טיוטה ראשונה שנבנתה ממדידות ומכללים (היוריסטיקה), לא בינה מלאכותית',
  'film.faces': 'פנים לא נבדקות: אין מודל פנים מאושר',
  'film.heuristic': 'היוריסטיקה',
  'film.notBuilt': 'יצירת סרט משפחתי עדיין לא נבנתה בגרסה הזו',
  'cmd.openFamilyFilm': 'סרט משפחתי בלחיצה',
  'moments.label': 'היוריסטיקה: מדידות של תנועה, חדות, בהירות ועוצמת קול. בלי בינה מלאכותית',
  'moments.measuring': 'מודד רגעים',
  'moments.notMeasured': 'לא נמדד',
  'moments.notBuilt': 'מדידת רגעים עדיין לא נבנתה בגרסה הזו',
  'error.code.film_not_built': 'יצירת סרט משפחתי עדיין לא נבנתה', 'error.code.film_blocked': 'הסרט אינו יכול להיווצר כך',
  'error.code.moments_not_built': 'מדידת רגעים עדיין לא נבנתה', 'error.code.moments_in_progress': 'הרגעים כבר נמדדים',
  'error.code.busy': 'המחשב עסוק כרגע; אפשר לנסות שוב בעוד רגע',
  // the generic code of a malformed request (a film's title text or parameters); no dictionary had it yet
  'error.code.invalid_request': 'הבקשה אינה בצורה הנכונה',
} as const;
export const FAMILY_FILM_EN: Record<keyof typeof FAMILY_FILM_HE, string> = {
  'op.attach_moments': 'Measured moments',
  'film.name': 'Family film in one click',
  'film.draft': 'A first draft built from measurements and rules (heuristic), not an AI model',
  'film.faces': 'Faces are not checked: no face model is approved',
  'film.heuristic': 'Heuristic',
  'film.notBuilt': 'Making a family film is not built in this version yet',
  'cmd.openFamilyFilm': 'Family film in one click',
  'moments.label': 'Heuristic: measured motion, sharpness, brightness and sound level. No AI model',
  'moments.measuring': 'Measuring moments',
  'moments.notMeasured': 'Not measured',
  'moments.notBuilt': 'Measuring moments is not built in this version yet',
  'error.code.film_not_built': 'Making a family film is not built yet', 'error.code.film_blocked': 'The film cannot be made like this',
  'error.code.moments_not_built': 'Measuring moments is not built yet', 'error.code.moments_in_progress': 'The moments are already being measured',
  'error.code.busy': 'The computer is busy; try again in a moment',
  'error.code.invalid_request': 'The request is not in the right form',
};

type Say = [RegExp, (m: RegExpExecArray) => string][];
/** attach_moments (momentsOps.ts MOMENTS_REFUSALS) and the film and moments routes (FILM_API_ERRORS, momentsNotBuilt). */
export const HE_FAMILY_FILM: Say = [
  [/^asset \S+ has no moving picture, so it has no moments to measure$/, () => 'לקובץ הזה אין תמונה נעה, ולכן אין בו רגעים למדוד. תמונה סטטית מוצגת בשלמותה'],
  [/^asset \S+ is listed twice$/, () => 'אותו קובץ מופיע פעמיים ברשימה'],
  [/^the moments of asset \S+ do not fit the file: (.+)$/, () => 'הרגעים שנמדדו אינם מתאימים לקובץ. זו תקלה במדידה, לא בפרויקט; שום דבר לא צורף'],
  [/^the family film maker is not built in this version yet$/, () => 'יצירת סרט משפחתי עדיין לא נבנתה בגרסה הזו. שום דבר לא השתנה; המתכונים והתבניות עובדים כרגיל'],
  [/^measuring moments is not built in this version yet$/, () => 'מדידת רגעים עדיין לא נבנתה בגרסה הזו. שום דבר לא נמדד; אפשר לתכנן סרט, וקליפ שלא נמדד ייקח את אמצע הקובץ ויגיד זאת'],
  [/^this credential may only propose edits, and a family film cannot be proposed: it is applied through an internal step that a proposal does not carry$/, () => 'ההרשאה הזו מאפשרת רק להציע עריכות, ואת הסרט אי אפשר להציע: הוא נוצר בצעד פנימי שהצעה אינה נושאת. אפשר לבקש מבעל/ת הפרויקט ליצור את הסרט'],
  [/^this credential may not make a film whose titles show an age: an age is computed from a birth date$/, () => 'ההרשאה הזו אינה מאפשרת סרט שהכותרות שלו מציגות גיל, כי גיל מחושב מתאריך לידה. אפשר להשמיט את שדה הגיל (שם מותר), או לבקש מבעל/ת הפרויקט'],
  [/^the title text has brace groups that are not fields: (.+)$/, (m) => `בטקסט הכותרת יש סוגריים מסולסלים שאינם שדה: ⁦${m[1]}⁩. אפשר לבחור שדה כמו תאריך עברי, או להכפיל את הסוגריים כדי שיופיעו כטקסט`],
  [/^the film cannot be made like this: (.+)$/, () => 'הסרט אינו יכול להיווצר כך. אפשר לבחור אורך אחר, מוזיקה אחרת או קליפים אחרים (ראו בתוכנית)'],
  [/^family film run \S+ not found$/, () => 'הסרט הזה כבר אינו בפרויקט'],
  [/^params must be an object of family film parameters to change$/, () => 'השינויים לסרט אינם בצורה הנכונה'],
];
