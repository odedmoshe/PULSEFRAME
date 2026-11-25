/**
 * Strings of the editing craft track (wave 7; .artifacts/wave7/craft-decisions.md). Spread into `he` and `en` (index.ts); Hebrew
 * first, the English dictionary covers the same keys.
 * Namespaces: `op.*` (the three operations, op-wording.test.ts), `cmd.*` (the command labels, commands.ts CRAFT_COMMANDS),
 * `error.code.*` (the server's codes, apps/server/src/craft/contract.ts CRAFT_SERVER_REFUSALS), `craft.group.*` (paste groups),
 * `craft.skip.*` (why a paste row is left out), `craft.time.*` (why a typed time is refused). The panels' own strings are
 * apps/web/src/editor/craft/craft.strings.ts.
 * Also here: HE_CRAFT, the Hebrew of every refusal of the craft operations (core craftContract.ts CRAFT_REFUSALS) and routes,
 * each with the next step; packages/evals/src/craft-wording.test.ts keeps it in step.
 */
export const CRAFT_HE = {
  'op.ripple_trim': 'חיתוך וסגירת רווח', 'op.paste_attributes': 'הדבקת מאפיינים', 'op.replace_text': 'החלפת טקסט',
  'cmd.rippleTrimStart': 'חיתוך ההתחלה עד הסמן', 'cmd.rippleTrimEnd': 'חיתוך הסוף עד הסמן', 'cmd.gotoTime': 'מעבר לזמן',
  'cmd.setDuration': 'משך הקליפ', 'cmd.pasteAttributes': 'הדבקת מאפיינים', 'cmd.findReplace': 'חיפוש והחלפה',
  'cmd.saveVersion': 'שמירת גרסה', 'cmd.versions': 'גרסאות',
  'error.code.craft_not_built': 'גרסאות וחיפוש עוד לא נבנו בגרסה הזו', 'error.code.version_not_found': 'הגרסה לא נמצאה',
  'error.code.version_limit': 'יש כבר יותר מדי גרסאות שמורות', 'error.code.version_limit_agents': 'נשמרו יותר מדי גרסאות על ידי סוכנים',
  'error.code.version_privacy_changed': 'הגרסה נשמרה לפני שינוי באזורי הפרטיות', 'error.code.nothing_to_restore': 'אין מה לשחזר',
  'error.code.restore_too_large': 'השחזור גדול מדי לצעד אחד', 'error.code.version_conflict': 'אי אפשר לשחזר את הגרסה הזו',
  'error.code.restore_needs_confirmation': 'השחזור משנה אזורי פרטיות — צריך אישור', 'error.code.version_frame_out_of_range': 'בגרסה הזו אין פריים כזה',
  'craft.group.colour': 'צבע', 'craft.group.effects': 'אפקטים', 'craft.group.transform': 'מיקום וגודל', 'craft.group.animation': 'אנימציה',
  'craft.group.sound': 'קול', 'craft.group.titleStyle': 'עיצוב כותרת',
  'craft.skip.source_empty': 'בקליפ המקור אין מה להעתיק בקבוצה הזו', 'craft.skip.target_animated': 'לקליפ יש אנימציה במיקום — סמנו גם «אנימציה»',
  'craft.time.unreadable': 'לא הצלחנו לקרוא את הזמן', 'craft.time.negative': 'הזמן יוצא לפני תחילת ציר הזמן',
  'craft.time.not_whole_frames': 'אפשר להקליד רק פריימים שלמים', 'craft.time.too_large': 'הזמן ארוך מ־24 שעות',
} as const;
export const CRAFT_EN: Record<keyof typeof CRAFT_HE, string> = {
  'op.ripple_trim': 'Ripple trim', 'op.paste_attributes': 'Paste attributes', 'op.replace_text': 'Replace text',
  'cmd.rippleTrimStart': 'Trim start to playhead and close the gap', 'cmd.rippleTrimEnd': 'Trim end to playhead and close the gap', 'cmd.gotoTime': 'Go to time',
  'cmd.setDuration': 'Clip duration', 'cmd.pasteAttributes': 'Paste attributes', 'cmd.findReplace': 'Find and replace',
  'cmd.saveVersion': 'Save version', 'cmd.versions': 'Versions',
  'error.code.craft_not_built': 'Versions and find are not built in this version yet', 'error.code.version_not_found': 'The version was not found',
  'error.code.version_limit': 'There are too many saved versions', 'error.code.version_limit_agents': 'Agents have saved too many versions',
  'error.code.version_privacy_changed': 'The version was saved before the privacy regions changed', 'error.code.nothing_to_restore': 'Nothing to restore',
  'error.code.restore_too_large': 'The restore is too large for one step', 'error.code.version_conflict': 'This version cannot be restored',
  'error.code.restore_needs_confirmation': 'The restore changes privacy regions — confirmation needed', 'error.code.version_frame_out_of_range': 'This version has no such frame',
  'craft.group.colour': 'Colour', 'craft.group.effects': 'Effects', 'craft.group.transform': 'Position and size', 'craft.group.animation': 'Animation',
  'craft.group.sound': 'Sound', 'craft.group.titleStyle': 'Title style',
  'craft.skip.source_empty': 'The source clip has nothing in this group', 'craft.skip.target_animated': 'The clip is animated in position — tick «Animation» as well',
  'craft.time.unreadable': 'The time could not be read', 'craft.time.negative': 'The time falls before the start of the timeline',
  'craft.time.not_whole_frames': 'Only whole frames can be typed', 'craft.time.too_large': 'The time is longer than 24 hours',
};

const ltr = (s: string) => `⁦${s}⁩`;
/**
 * Hebrew of the craft refusals, by shape: the operations (core craftContract.ts CRAFT_REFUSALS, in its order) and the routes
 * (apps/server/src/craft/contract.ts CRAFT_SERVER_REFUSALS, in its order). Each sentence says what to do next.
 */
export const HE_CRAFT: [RegExp, (m: RegExpExecArray) => string][] = [
  // CRAFT_REFUSALS
  [/^(ripple_trim|paste_attributes|replace_text) is not built in this build yet$/, () => 'הפעולה הזו עוד לא נבנתה בגרסה הזו. אפשר לעדכן את התוכנה ולנסות שוב'],
  [/^a ripple trim can only shorten the start of a clip$/, () => 'חיתוך עם סגירת רווח רק מקצר את תחילת הקליפ. כדי להאריך, גררו את הקצה בלי סגירת רווח'],
  [/^the clip already starts or ends there; nothing to trim$/, () => 'הקליפ כבר מתחיל או נגמר שם — אין מה לחתוך. אפשר להזיז את הסמן ולנסות שוב'],
  [/^ripple trim would move linked clips \S+ and \S+ by different amounts$/, () => `שני קליפים מקושרים היו צריכים לזוז בכמות שונה, ולכן לא נחתך. אפשר לנתק את הקישור ביניהם, או לחתוך בלי סגירת רווח (${ltr('[')} או ${ltr(']')})`],
  [/^ripple trim would place clip \S+ before 0$/, () => `החיתוך היה מזיז צליל מקושר אל לפני תחילת ציר הזמן. אפשר לחתוך בלי סגירת רווח (${ltr('[')} או ${ltr(']')})`],
  [/^ripple trim would put clip \S+ over clip \S+ on track \S+$/, () => 'החיתוך היה מניח קליפ על קליפ אחר שנשאר במקומו. אפשר להזיז קודם את הקליפ שמפריע, או לחתוך בלי סגירת רווח'],
  [/^the clip to copy from cannot also be a clip to paste onto$/, () => 'הקליפ שממנו מעתיקים לא יכול להיות גם יעד. אפשר לבחור קליפים אחרים'],
  [/^nothing here can be pasted onto the chosen clips$/, () => 'אין מה להדביק על הקליפים שנבחרו. אפשר לבחור קבוצה אחרת או קליפים אחרים'],
  [/^the text changed since the search; search again$/, () => 'הטקסט השתנה מאז החיפוש — חפשו שוב'],
  [/^the replacement would leave a text empty$/, () => 'ההחלפה הייתה משאירה טקסט ריק. אפשר לבטל את הסימון של השורה הזו'],
  [/^the replacement would change the live fields of a title; leave the \{…\} fields as they are$/, () => 'ההחלפה הייתה משנה שדה חי בכותרת. השאירו את השדות שבסוגריים {…} כפי שהם'],
  [/^the text would be (\d+) characters long; this place holds at most (\d+)$/, (m) => `הטקסט היה מגיע ל־${m[1]} תווים, וכאן נכנסים עד ${m[2]}. אפשר לקצר את ההחלפה`],
  [/^there is no longer a text at this place: .+$/, () => 'הטקסט כבר לא נמצא במקום הזה — חפשו שוב'],
  [/^the same text is named twice in one replacement$/, () => 'אותו טקסט מופיע פעמיים בהחלפה אחת — חפשו שוב'],
  // CRAFT_SERVER_REFUSALS
  [/^saved versions and find are not built in this build yet$/, () => 'גרסאות שמורות וחיפוש עוד לא נבנו בגרסה הזו. בינתיים אפשר לבטל פעולות ולעיין ב«פעילות»'],
  [/^this saved version does not exist; it may have been deleted$/, () => 'הגרסה לא נמצאה — ייתכן שנמחקה. אפשר לפתוח שוב את רשימת הגרסאות'],
  [/^the project already holds (\d+) saved versions; delete one to save a new one$/, (m) => `יש כבר ${m[1]} גרסאות שמורות. מחקו גרסה כדי לשמור חדשה`],
  [/^agents may keep at most (\d+) saved versions in a project$/, (m) => `סוכנים יכולים לשמור עד ${m[1]} גרסאות בפרויקט. אפשר לבקש מבעל הפרויקט למחוק אחת או לשמור בעצמו`],
  [/^this version was saved before the privacy regions changed; only the project owner can view it$/, () => 'הגרסה נשמרה לפני שינוי באזורי הפרטיות; רק בעל הפרויקט יכול להציג אותה. בעל הפרויקט יכול לפתוח אותה בחלון «גרסאות»'],
  [/^the project already equals this version; nothing to restore$/, () => 'הפרויקט כבר זהה לגרסה הזו — אין מה לשחזר'],
  [/^restoring this version would change (\d+) items; one step changes at most (\d+)$/, (m) => `שחזור הגרסה היה משנה ${m[1]} פריטים, וצעד אחד משנה עד ${m[2]}. אפשר לשחזר גרסה חדשה יותר, או לבטל צעד אחר צעד`],
  [/^restoring this version would make the project invalid: .+$/, () => 'שחזור הגרסה הזו היה משאיר את הפרויקט במצב לא תקין, ולכן לא שונה דבר. אפשר לשחזר גרסה אחרת'],
  [/^restoring this version removes or changes (\d+) privacy regions; confirm to go on$/, (m) => `השחזור יסיר או ישנה ${m[1]} אזורי פרטיות. כדי להמשיך צריך לאשר שוב`],
  [/^this version has no frame (\d+); it is shorter$/, () => 'בגרסה הזו אין פריים כזה — היא קצרה יותר. אפשר לבחור פריים מוקדם יותר'],
  [/^the project changed since this was read \(it is now at revision (\d+)\)$/, () => 'הפרויקט השתנה מאז שנפתחה הרשימה. בדקו שוב את הגרסאות ואז שחזרו'],
  [/^saved versions are renamed and deleted from the owner's own session$/, () => 'שינוי שם ומחיקה של גרסאות נעשים רק מהחלון של בעל הפרויקט. אפשר לבקש ממנו'],
  [/^this credential may only propose edits, and saving or restoring a version cannot be proposed$/, () => 'להרשאה הזו מותר רק להציע עריכות, ואי אפשר להציע שמירה או שחזור של גרסה. אפשר לבקש מבעל הפרויקט'],
];
