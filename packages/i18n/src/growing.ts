/**
 * Strings of «גדלים מול העיניים» (wave 8 growing track; .artifacts/wave8/growing-verify.md wins over the plan). Spread into `he`
 * and `en` (index.ts); Hebrew first, plural and ungendered; the English dictionary covers the same keys. Namespaces: `growing.*`
 * (fixed lines every surface shares: the name, the privacy sentence of verifier C7, the preview label of C13, the not-built
 * state), `cmd.openGrowing`, `error.code.*` of the growing calls. The dialog's and bar's own strings are
 * apps/web/src/editor/growing/growing.strings.ts (W3).
 * Also here: HE_GROWING, the Hebrew of every refusal of the planner (core growingContract.ts GROWING_REFUSALS) and of the server
 * (apps/server/src/growing.ts GROWING_API_ERRORS), each with the next step; growing-wording.test.ts keeps them in step.
 * Nothing is called sharp, aligned perfectly, right or AI: the alignment is arithmetic on two points the owner placed, and how it
 * looks is unknown until the owner looks.
 */
export const GROWING_HE = {
  'growing.name': 'גדלים מול העיניים',
  /** C7: the honest privacy sentence (dialog and ADR). Never say the positions "never reach an agent". */
  'growing.privacy': 'מיקום התמונות בסרט נשמר כמו כל עריכה, ואפשר לחשב ממנו היכן היו העיניים. הסימונים עצמם לא נשמרים.',
  /** C8: the marks live in the dialog only; asked before closing. */
  'growing.closeLosesMarks': 'הסימונים של תמונות שעוד לא נוצרו יימחקו',
  /** C8: a picture deleted by hand comes back only when marked again. */
  'growing.deletedNeedsMarks': 'תמונה שנמחקה צריכה סימון מחדש כדי לחזור',
  /** C13: the live preview after the second picture. */
  'growing.preview': 'תצוגה מקדימה — עוד לא נוצר',
  /** C4: EXIF orientation outside JPEG is not verified. */
  'growing.orientationLimit': 'בתמונות PNG ו־WebP עם סימון סיבוב, הסיבוב לא נבדק: ייתכן שהסימון ינחת במקום אחר',
  /** C12: preflight has no flash check yet; the report comes after export. */
  'growing.flashAfterExport': 'בדיקת ההבהובים נעשית אחרי הייצוא; כל תמונה מוחזקת לפחות שליש שנייה',
  'growing.method': 'יישור לפי שתי נקודות שסימנתם (חשבון מדויק), בלי זיהוי פנים ובלי מודל',
  'growing.notBuilt': 'גדלים מול העיניים עדיין לא נבנה בגרסה הזו',
  'cmd.openGrowing': 'גדלים מול העיניים',
  'error.code.growing_not_built': 'גדלים מול העיניים עדיין לא נבנה',
} as const;
export const GROWING_EN: Record<keyof typeof GROWING_HE, string> = {
  'growing.name': 'Growing up before your eyes',
  'growing.privacy': 'Where the pictures sit in the film is saved like any edit, and where the eyes were can be worked out from it. The marks themselves are not saved.',
  'growing.closeLosesMarks': 'The marks of pictures not made yet will be lost',
  'growing.deletedNeedsMarks': 'A deleted picture needs marking again to come back',
  'growing.preview': 'Preview — not made yet',
  'growing.orientationLimit': 'For PNG and WebP pictures with a rotation tag the rotation has not been checked here: a mark may land elsewhere',
  'growing.flashAfterExport': 'The flash check runs after export; every picture is held at least a third of a second',
  'growing.method': 'Lined up from two points you placed (exact arithmetic), no face detection, no model',
  'growing.notBuilt': 'Growing up before your eyes is not built in this version yet',
  'cmd.openGrowing': 'Growing up before your eyes',
  'error.code.growing_not_built': 'Growing up before your eyes is not built yet',
};

type Say = [RegExp, (m: RegExpExecArray) => string][];
/** The Hebrew of every growing refusal, each with the next step. */
export const HE_GROWING: Say = [
  // core GROWING_REFUSALS
  [/^the growing parameters are not valid: (.+)$/, (m) => `ההגדרות של גדלים מול העיניים אינן תקינות (${m[1]}). פתחו את החלון מחדש ונסו שוב`],
  [/^at least two pictures are needed$/, () => 'צריך לפחות שתי תמונות. בחרו עוד תמונה וסמנו בה את העיניים'],
  [/^a chosen picture is not in this project$/, () => 'אחת התמונות שנבחרו כבר לא בפרויקט. הסירו אותה מהרשימה'],
  [/^a chosen file has no picture$/, () => 'לאחד הקבצים שנבחרו אין תמונה. בחרו תמונה או סרטון'],
  [/^a still picture has no frame number$/, () => 'לתמונה אין מספר פריים. בחרו אותה שוב מהרשימה'],
  [/^a video needs the number of the frame to hold$/, () => 'בסרטון צריך לבחור את הפריים שיוחזק. בחרו פריים וסמנו בו את העיניים'],
  [/^the video has no such frame$/, () => 'אין בסרטון פריים כזה. בחרו פריים אחר'],
  [/^the same picture is chosen twice$/, () => 'אותה תמונה נבחרה פעמיים. הסירו אחת מהן'],
  [/^the two eye marks are too close together$/, () => 'שני הסימונים קרובים מדי זה לזה. סמנו את שתי העיניים'],
  [/^a picture has no eye marks$/, () => 'באחת התמונות אין סימון עיניים. סמנו אותה מחדש, או הסירו אותה'],
  [/^each picture must stay at least (\d+) frames, so that the film does not flash$/, (m) => `כל תמונה צריכה להישאר לפחות ${m[1]} פריימים (שליש שנייה), כדי שהסרט לא יהבהב. בחרו זמן ארוך יותר`],
  [/^the person for the age caption is not in the people sheet$/, () => 'האדם שגילו מוצג בכיתוב כבר לא בדף האנשים. בחרו אדם אחר או כבו את הגיל'],
  [/^growing up before your eyes is not built in this version yet$/, () => 'גדלים מול העיניים עדיין לא נבנה בגרסה הזו. שום דבר לא השתנה'],
  // the server (apps/server/src/growing.ts GROWING_API_ERRORS)
  [/^growing up before your eyes is made from the owner's own session only$/, () => 'גדלים מול העיניים נעשה רק מהחיבור של בעלי הפרויקט. פתחו את העורך במחשב הזה'],
  [/^growing run (\S+) not found$/, () => 'הסרט הזה כבר לא קיים בפרויקט. צרו אותו מחדש'],
];
