/**
 * Shared strings of «שליחה ושמירה» (wave 7, track send): op names (`op.*`, op-wording.test.ts), the fixed product wording the
 * lead decided (send-decisions.md), finding names and the error headlines of the new codes. Spread into `he` and `en`
 * (index.ts); Hebrew first, and the English dictionary covers the same keys. Component words are worker C's
 * (apps/web/src/editor/send/send.strings.ts); numbers go in <bdi dir="ltr">.
 * Nothing here calls a file good, fine or safe for an app: only its bytes are promised (send-wording.test.ts keeps «תקין»,
 * «ווטסאפ» and "WhatsApp" out of these strings).
 * Also here: the Hebrew wording of every send refusal (HE_SEND; core sendContract.ts SEND_REFUSALS, SEND_API_REFUSALS), which
 * refusals.ts adds to translateRefusal.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const SEND_HE = {
  'op.set_master_limiter': 'מגביל ראשי', 'op.match_clip_loudness': 'השוואת עוצמה',
  // the decided wording
  'send.tile': 'מתאים לשליחה', 'send.targetSize': 'גודל יעד', 'send.megabyte': 'מ״ב', 'send.megabyteIs': '1 מ״ב = 1,000,000 בתים',
  'send.notVerified': 'לא אומת', 'send.onlyBytes': 'הגדלים האלה לא אומתו מול אף אפליקציה. מובטח רק גודל הקובץ.',
  'send.chooseSize': 'בחרו גודל יעד',
  'send.checks': 'בדיקות הקובץ', 'send.jump': 'מעבר לקטע', 'send.heuristic': 'הערכה לפי כלל קבוע, לא בדיקה של כל פיקסל',
  'send.find.black': 'תמונה שחורה', 'send.find.frozen': 'תמונה קפואה', 'send.find.silence': 'שקט ארוך', 'send.find.clipped': 'קול חתוך',
  'send.limiter': 'מגביל ראשי', 'send.limiterOff': 'מגביל ראשי כבוי', 'send.ceiling': 'תקרה',
  'send.beforeExportGain': 'לפני הגברת הייצוא',
  'send.match': 'השוואת עוצמה', 'send.matchTrack': 'השוואת כל הקליפים ברצועה', 'send.limitedByPeak': 'הוגבל בגלל שיא', 'send.limitedByRange': 'הוגבל בגלל טווח העוצמה',
  'send.lufsNote': 'עוצמה נמדדת (LUFS) אינה בהכרח איך שזה נשמע לאוזן',
  'send.notBuilt': 'החלק הזה עוד לא נבנה בגרסה הזו. שום דבר לא ישתנה כאן',
  // error headlines of the new codes
  'error.code.size_fit_not_built': 'ייצוא בגודל יעד עוד לא נבנה', 'error.code.size_fit_format': 'גודל יעד רק ב־MP4',
  'error.code.size_fit_too_small': 'גודל היעד קטן מדי', 'error.code.size_fit_missed': 'הקובץ יצא גדול מהיעד',
};
export const SEND_EN: Record<keyof typeof SEND_HE, string> = {
  'op.set_master_limiter': 'Master limiter', 'op.match_clip_loudness': 'Match loudness',
  'send.tile': 'Fits to send', 'send.targetSize': 'Target size', 'send.megabyte': 'MB', 'send.megabyteIs': '1 MB = 1,000,000 bytes',
  'send.notVerified': 'Not verified', 'send.onlyBytes': 'These sizes were not checked against any app. Only the file size is promised.',
  'send.chooseSize': 'Choose a target size',
  'send.checks': 'File checks', 'send.jump': 'Go to the stretch', 'send.heuristic': 'An estimate by a fixed rule, not a check of every pixel',
  'send.find.black': 'Black picture', 'send.find.frozen': 'Frozen picture', 'send.find.silence': 'Long silence', 'send.find.clipped': 'Clipped sound',
  'send.limiter': 'Master limiter', 'send.limiterOff': 'Master limiter off', 'send.ceiling': 'Ceiling',
  'send.beforeExportGain': 'Before the export gain',
  'send.match': 'Match loudness', 'send.matchTrack': 'Match every clip on the track', 'send.limitedByPeak': 'Limited by a peak', 'send.limitedByRange': 'Limited by the gain range',
  'send.lufsNote': 'Measured loudness (LUFS) is not always how loud it sounds',
  'send.notBuilt': 'This part is not built in this version yet. Nothing changes here',
  'error.code.size_fit_not_built': 'Target size is not built yet', 'error.code.size_fit_format': 'Target size works for MP4 only',
  'error.code.size_fit_too_small': 'The target size is too small', 'error.code.size_fit_missed': 'The file came out over the target',
};

/** Hebrew wording of every send refusal (core sendContract.ts); each keeps its numbers and the way forward. */
export const HE_SEND: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^clip \S+ is listed twice$/, () => 'הקליפ מופיע פעמיים ברשימה. כל קליפ נמדד ומושווה פעם אחת'],
  [/^clip \S+ is not a sound clip on a sound track$/, () => 'אפשר להשוות רק קליפים עם קול שנמצאים ברצועת קול. בחרו את קליפ הקול ומדדו שוב'],
  [/^the level of clip \S+ changed since it was measured$/, () => 'העוצמה של הקליפ השתנתה מאז המדידה. מדדו שוב ואז השוו'],
  [/^measuring the loudness of single clips is not built in this version yet$/, () => 'מדידת עוצמה של קליפים בודדים עוד לא נבנתה בגרסה הזו. שום דבר לא השתנה; אפשר עדיין למדוד את עוצמת הסרט כולו'],
  [/^sending at a target size is not built in this version yet$/, () => 'ייצוא בגודל יעד עוד לא נבנה בגרסה הזו. אפשר לייצא בלי גודל יעד'],
  [/^a target size works for MP4 files only, not (\S+)$/, (m) => `גודל יעד אפשרי רק בקובץ MP4 ולא ב־${ltr(m[1]!)}. בחרו MP4 או ייצאו בלי גודל יעד`],
  [/^a target of (\d+) bytes is too small for this film; the smallest that works is (\d+) bytes$/, (m) => `יעד של ${ltr(m[1]!)} בתים קטן מדי לסרט הזה. הקטן ביותר שאפשר: ${ltr(m[2]!)} בתים. בחרו יעד גדול יותר או קטע קצר יותר`],
  [/^the file came out at (\d+) bytes, over the target of (\d+) bytes, on both attempts$/, (m) => `הקובץ יצא ${ltr(m[1]!)} בתים, יותר מהיעד של ${ltr(m[2]!)}, גם בניסיון השני. לא נשמר קובץ. נסו יעד גדול מעט או סרט קצר יותר`],
  [/^the browser export route cannot fit a target size or run the master limiter$/, () => 'הייצוא בדפדפן לא יכול להתאים לגודל יעד או להפעיל את המגביל הראשי. ייצאו בשרת, או בלי גודל יעד ובלי מגביל'],
];
