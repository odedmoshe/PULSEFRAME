/**
 * Strings of the local picture-model runtime and of eye suggestions «הציעו עיניים» (wave 8 picmodels; picmodels-verify.md wins over the
 * plan). Spread into `he` and `en` (index.ts); Hebrew first, plural and ungendered; the English dictionary covers the same keys.
 * Namespaces: `picmodels.setup.*` (the setup state of a model in words, each with the next step; `{module}` and `{bytes}` are filled by
 * the interface), `picmodels.output.*`, `error.code.*` of the eyes route. The eyes interface's own sentences are
 * apps/web/src/editor/growing/eyes.strings.ts (W3).
 * Also here: HE_PICMODELS, the Hebrew of every refusal of the eyes route (core PICMODELS_REFUSALS), each with the next step;
 * packages/evals/src/picmodels-wording.test.ts keeps them in step. Nothing is called right, sharp or verified, and nothing claims to
 * know who is in a picture: the model finds where eyes are, and the owner checks.
 */
export const PICMODELS_HE = {
  'picmodels.output.eyes': 'הצעת עיניים', 'picmodels.output.depth': 'מפת עומק', 'picmodels.output.matte': 'הפרדת דמות',
  'picmodels.setup.not_built': 'עוד לא בנוי בגרסה הזו. בינתיים אפשר לסמן ביד',
  'picmodels.setup.licence_blocked': 'הרישיון של המודל לא מאושר בגרסה הזו. בינתיים אפשר לסמן ביד',
  'picmodels.setup.engine_unverified': 'קובץ העבודה של המודלים שונה מהגרסה שנבדקה. התקינו מחדש את העורך',
  'picmodels.setup.engine_not_configured': 'סביבת הכלים לא מוגדרת. הגדירו את PF_TOOLS_PYTHON לפי docs/INTEGRATIONS.md',
  'picmodels.setup.engine_not_working': 'בסביבת הכלים חסר {module}. התקינו את רשימת החבילות של המודלים (requirements-picture-win-cpu.txt)',
  'picmodels.setup.disk_insufficient': 'אין מספיק מקום לקובץ המודל: חסרים {bytes} בתים. פנו מקום, ואז הורידו אותו בכלי הספרייה',
  'picmodels.setup.model_missing': 'קובץ המודל חסר או שונה: חסרים {bytes} בתים. הורידו אותו בכלי הספרייה; העורך לא מוריד בעצמו',
  'picmodels.setup.ready': 'מוכן במחשב הזה, על המעבד',
  'error.code.eyes_not_built': 'הצעת עיניים עוד לא בנויה בגרסה הזו',
  'error.code.eyes_not_ready': 'הצעת עיניים לא מותקנת במחשב הזה',
  'error.code.eyes_busy': 'הצעת עיניים כבר מחושבת',
  'error.code.eyes_engine_failed': 'הצעת העיניים נכשלה',
} as const;
export const PICMODELS_EN: Record<keyof typeof PICMODELS_HE, string> = {
  'picmodels.output.eyes': 'Eye suggestions', 'picmodels.output.depth': 'Depth map', 'picmodels.output.matte': 'Subject cut-out',
  'picmodels.setup.not_built': 'Not built in this version yet. Meanwhile you can mark by hand',
  'picmodels.setup.licence_blocked': 'The model\'s licence is not allowed in this version. Meanwhile you can mark by hand',
  'picmodels.setup.engine_unverified': 'The models\' worker file differs from the reviewed one. Reinstall the editor',
  'picmodels.setup.engine_not_configured': 'The tools environment is not set up. Set PF_TOOLS_PYTHON as docs/INTEGRATIONS.md says',
  'picmodels.setup.engine_not_working': 'The tools environment is missing {module}. Install the models\' package list (requirements-picture-win-cpu.txt)',
  'picmodels.setup.disk_insufficient': 'Not enough room for the model file: {bytes} bytes are missing. Make room, then fetch it with the library tool',
  'picmodels.setup.model_missing': 'The model file is missing or different: {bytes} bytes to fetch. Fetch it with the library tool; the editor never downloads by itself',
  'picmodels.setup.ready': 'Ready on this computer, on the CPU',
  'error.code.eyes_not_built': 'Eye suggestions are not built in this version yet',
  'error.code.eyes_not_ready': 'Eye suggestions are not set up on this computer',
  'error.code.eyes_busy': 'An eye suggestion is already being worked out',
  'error.code.eyes_engine_failed': 'The eye suggestion failed',
};

/** The Hebrew of every refusal of the eyes route (core PICMODELS_REFUSALS), each with the next step. None repeats a coordinate. */
export const HE_PICMODELS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^eye suggestions are for the owner's own session only$/, () => 'הצעת עיניים זמינה רק לבעל הפרויקט, מהחלון שלו. בעל הפרויקט מבקש אותה ב«גדלים מול העיניים» בעורך'],
  [/^eye suggestions are not built in this build yet$/, () => 'הצעת עיניים עוד לא בנויה בגרסה הזו. סמנו את העיניים ביד; אפשר לעדכן את העורך בהמשך'],
  [/^eye suggestions are not set up on this computer: (\w+)$/, () => 'הצעת עיניים לא מותקנת במחשב הזה. פעלו לפי שורת ההתקנה שליד הכפתור; הסימון ביד עובד בינתיים'],
  [/^an eye suggestion is already being worked out$/, () => 'הצעת עיניים כבר מחושבת. חכו לה או עצרו אותה, ואז בקשו שוב'],
  [/^eye suggestions: the picture is not in this project$/, () => 'התמונה לא בפרויקט הזה. בחרו תמונה מהפרויקט'],
  [/^eye suggestions: the file has no picture$/, () => 'בקובץ הזה אין תמונה. בחרו תמונה או סרטון'],
  [/^eye suggestions: a still picture has no frame number$/, () => 'לתמונה אין מספר פריים. שלחו בלי פריים'],
  [/^eye suggestions: a video needs the number of the frame to look at$/, () => 'בסרטון צריך לבחור פריים. בחרו קודם את הפריים'],
  [/^eye suggestions: the video has no such frame$/, () => 'אין בסרטון פריים כזה. בחרו פריים שבתוך הסרטון'],
  [/^the eye model gave an answer that failed its checks; nothing is shown$/, () => 'מודל העיניים החזיר תשובה שלא עברה את הבדיקות, ולכן לא מוצג דבר. סמנו את העיניים ביד; אם זה חוזר, בדקו את שורת ההתקנה'],
];
