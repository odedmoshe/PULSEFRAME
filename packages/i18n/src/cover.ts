/**
 * Strings of «הפריים הכי חד» and «שמירת התמונה» (wave 8 cover, version 1; .artifacts/wave8/decisions.md "cover", cover-verify.md).
 * Spread into `he` and `en` (index.ts); Hebrew first, the English dictionary covers the same keys. The owner is addressed in the
 * plural, never in a gendered form. Nothing here calls a frame or a print good, right, sharp or safe: every number is shown, every
 * heuristic says it is one, and the pixels-per-inch tiers are a rule of thumb from the pixel count only.
 * Namespaces: `cover.*` (the inspector block and the save dialog; W3's cover.strings.ts reads them), `error.code.*` (the new codes),
 * and HE_COVER, the Hebrew of every refusal of core stillsContract.ts STILLS_REFUSALS, each with the next step
 * (packages/evals/src/cover-wording.test.ts keeps it in step). Numbers go in <bdi dir="ltr"> in the interface.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const COVER_HE = {
  // the inspector block
  'cover.title': 'הפריים הכי חד', 'cover.measure': 'מצאו את הפריים הכי חד בקטע', 'cover.stop': 'עצירה',
  'cover.stage': 'מדידה {done}/{total}', 'cover.found': 'נמצאו {n}', 'cover.foundNone': 'לא נמצא פריים שבולט בקטע הזה',
  'cover.label': 'היוריסטיקה: מדידה של חדות, רעש, תזוזה ואזורים שרופים. בלי בינה מלאכותית ובלי זיהוי פנים. לא נבדק בעין',
  'cover.notByEye': 'לא נבדק בעין', 'cover.oneClip': 'המספרים משווים פריימים של הקליפ הזה בלבד, לא בין קליפים',
  'cover.line.sharp': 'חדות ×{r} מהחציון', 'cover.line.noise': 'רעש {sigma}', 'cover.line.motion': 'תזוזה {m}%',
  'cover.line.hi': 'לבן שרוף {h}%', 'cover.line.lo': 'שחור חנוק {l}%', 'cover.line.frame': 'פריים {n} · {t}',
  'cover.manyClipped': 'הרבה לבן שרוף', 'cover.notMeasured': 'לא נמדד', 'cover.firstFrame': 'פריים ראשון בקובץ: אין תזוזה למדוד',
  'cover.keyHint': 'חצים: פריים אחד ({later} מאוחר יותר) · Shift עם חץ: שנייה אחת · Enter: בחירת הפריים',
  'cover.rateDiffers': 'הקובץ ב־{fps} פריימים לשנייה: יש כאן פריימים שהסרט לא מציג',
  'cover.picture': 'בתמונה יש פריים אחד, אין מה למדוד. אפשר לשמור אותה', 'cover.method': 'איך זה נמדד',
  'cover.methodLong': 'כל פריים בקטע נקרא מהקובץ השמור (לא מהעותק לעריכה), באפור, בצד ארוך של 960 פיקסלים. החדות היא אנרגיית השיפוע (סובל) פחות הערכה של רעש החיישן (שיטת אימרקר, 1.5 σ²), ביחס לחציון של הקטע. התזוזה היא ההפרש הממוצע מהפריים הקודם; לבן שרוף ושחור חנוק הם החלק של האפור ב־250 ומעלה וב־5 ומטה. כללים קבועים, בלי מודל; פנים לא נבדקות. מגבלות: הערכת הרעש סופרת גם מרקם עדין; המספרים משווים פריימים של קליפ אחד בלבד; פריימי מפתח של קובץ דחוס נמדדים לרוב חדים יותר מהשכנים שלהם וזה לא מתוקן; הספים נקבעו על סרטוני בדיקה מלאכותיים בלבד; איש לא בדק את התוצאות בעין.',
  // saving the picture
  'cover.save': 'שמירת התמונה', 'cover.saveRun': 'שמרו את התמונה', 'cover.download': 'הורדת התמונה', 'cover.saving': 'שומרים את התמונה',
  'cover.whole': 'כל הפריים', 'cover.paper': 'גודל נייר', 'cover.portrait': 'לאורך', 'cover.landscape': 'לרוחב',
  'cover.paper.10x15': '10×15 ס״מ', 'cover.paper.13x18': '13×18 ס״מ', 'cover.paper.a4': 'נייר A4',
  'cover.cropHint': 'חצים מזיזים את המסגרת (Shift: צעד גדול); + ו־− משנים את הגודל בלי לשנות את הצורה',
  'cover.ppi': '{ppi} פיקסלים לאינץ׳ ב־{paper}',
  'cover.tier.dense': 'צפיפות גבוהה', 'cover.tier.usual': 'צפיפות מקובלת להדפסה', 'cover.tier.borderline': 'גבולי — ייראה רך מקרוב', 'cover.tier.soft': 'רך בגודל הזה',
  'cover.rule': 'כלל אצבע לפי מספר הפיקסלים בלבד; טשטוש, רעש ודחיסה לא נכללים',
  'cover.fileSize': 'בגודל הפיקסלים של הקובץ השמור', 'cover.browserReading': 'התמונה היא הקריאה של הדפדפן לקובץ השמור',
  'cover.conformed': 'הקובץ הומר בייבוא ({reasons}): התמונה היא מההעתק המומר, לא מהמקור', 'cover.conformedHdr': 'הומר מ־HDR',
  'cover.ownColours': 'בצבעים של הקובץ, בלי תיקוני הצבע של הסרט', 'cover.noDate': 'בלי תאריך ובלי פרטי מצלמה בקובץ',
  'cover.format': 'סוג הקובץ', 'cover.png': 'PNG (בלי דחיסה מאבדת)', 'cover.jpeg': 'JPEG (קובץ קטן יותר)',
  'cover.untriedSize': 'תמונה של יותר מ־24 מגה־פיקסל: לא נוסתה כאן', 'cover.ownerOnly': 'שמירת תמונה בגודל המלא — רק בחשבון של בעלי הפרויקט',
  // error headlines of the new codes
  'error.code.stills_not_built': 'מציאת הפריים הכי חד עוד לא נבנתה', 'error.code.stills_range_too_long': 'הקטע ארוך מדי למדידה פריים־פריים',
  'error.code.stills_in_progress': 'המדידה כבר רצה', 'error.code.grey_check_failed': 'ffmpeg קורא את רמות האפור אחרת מהצפוי',
  'error.code.still_not_built': 'שמירת תמונה מקובץ עוד לא נבנתה', 'error.code.still_options': 'אי אפשר לשלב את האפשרויות האלה בשמירת תמונה',
  'error.code.still_too_large': 'התמונה גדולה מדי לשמירה בגודל המלא', 'error.code.still_no_picture': 'אין בקובץ תמונה לשמור',
  'error.code.still_tags': 'בתמונה השמורה היו פרטים שאסור שיהיו בה',
  'error.code.invalid_range': 'הקטע שנבחר לא מתאים', 'error.code.unsupported_in_browser_export': 'הייצוא בדפדפן לא יכול לעשות את זה',
} as const;
export const COVER_EN: Record<keyof typeof COVER_HE, string> = {
  'cover.title': 'The sharpest frame', 'cover.measure': 'Find the sharpest frame in this stretch', 'cover.stop': 'Stop',
  'cover.stage': 'Measuring {done}/{total}', 'cover.found': '{n} found', 'cover.foundNone': 'No frame stands out in this stretch',
  'cover.label': 'Heuristic: measured sharpness, noise, movement and clipped areas. No AI model, no face detection. Not checked by eye',
  'cover.notByEye': 'Not checked by eye', 'cover.oneClip': 'The numbers compare frames of this clip only, never two clips',
  'cover.line.sharp': 'sharpness ×{r} of the median', 'cover.line.noise': 'noise {sigma}', 'cover.line.motion': 'movement {m}%',
  'cover.line.hi': 'clipped white {h}%', 'cover.line.lo': 'crushed black {l}%', 'cover.line.frame': 'frame {n} · {t}',
  'cover.manyClipped': 'Much clipped white', 'cover.notMeasured': 'Not measured', 'cover.firstFrame': 'First frame of the file: no movement to measure',
  'cover.keyHint': 'Arrows: one frame ({later} is later) · Shift with an arrow: one second · Enter: choose the frame',
  'cover.rateDiffers': 'The file runs at {fps} frames a second: some frames here are not shown in the film',
  'cover.picture': 'A picture has one frame, so there is nothing to measure. It can be saved', 'cover.method': 'How this is measured',
  'cover.methodLong': 'Every frame of the stretch is read from the stored file (not the editing copy), in grey at a long side of 960 pixels. Sharpness is the gradient energy (Sobel) minus an estimate of the sensor noise (Immerkaer\'s method, 1.5 σ²), compared with the median of the stretch. Movement is the mean difference to the previous frame; clipped white and crushed black are the shares of grey at or above 250 and at or below 5. Fixed rules, no model; faces are not looked at. Limits: the noise estimate also counts fine texture; the numbers compare frames of one clip only; key frames of a compressed file often measure sharper than their neighbours and this is not corrected; the thresholds were set on synthetic test videos only; nobody has checked the results by eye.',
  'cover.save': 'Save the picture', 'cover.saveRun': 'Save the picture', 'cover.download': 'Download the picture', 'cover.saving': 'Saving the picture',
  'cover.whole': 'The whole frame', 'cover.paper': 'Paper size', 'cover.portrait': 'Portrait', 'cover.landscape': 'Landscape',
  'cover.paper.10x15': '10×15 cm', 'cover.paper.13x18': '13×18 cm', 'cover.paper.a4': 'A4 paper',
  'cover.cropHint': 'Arrows move the frame (Shift: a large step); + and − change its size and keep its shape',
  'cover.ppi': '{ppi} pixels per inch at {paper}',
  'cover.tier.dense': 'High density', 'cover.tier.usual': 'A usual density for prints', 'cover.tier.borderline': 'Borderline — looks soft up close', 'cover.tier.soft': 'Soft at this size',
  'cover.rule': 'A rule of thumb from the pixel count only; blur, noise and compression are not counted',
  'cover.fileSize': 'At the pixel size of the stored file', 'cover.browserReading': 'The picture is the browser\'s reading of the stored file',
  'cover.conformed': 'The file was converted on import ({reasons}): the picture comes from the converted copy, not the original', 'cover.conformedHdr': 'Converted from HDR',
  'cover.ownColours': 'In the file\'s own colours, without the film\'s colour corrections', 'cover.noDate': 'No date and no camera details in the file',
  'cover.format': 'File type', 'cover.png': 'PNG (no lossy compression)', 'cover.jpeg': 'JPEG (a smaller file)',
  'cover.untriedSize': 'A picture over 24 megapixels: not tried here', 'cover.ownerOnly': 'Saving a full-size picture — the project owner\'s own session only',
  'error.code.stills_not_built': 'Finding the sharpest frame is not built yet', 'error.code.stills_range_too_long': 'Too long to measure frame by frame',
  'error.code.stills_in_progress': 'The measurement is already running', 'error.code.grey_check_failed': 'ffmpeg reads grey levels differently than expected',
  'error.code.still_not_built': 'Saving a picture from a file is not built yet', 'error.code.still_options': 'These options cannot be combined with saving a picture',
  'error.code.still_too_large': 'The picture is too large to save at full size', 'error.code.still_no_picture': 'The file has no picture to save',
  'error.code.still_tags': 'The saved picture carried details it must not',
  'error.code.invalid_range': 'The chosen stretch does not fit', 'error.code.unsupported_in_browser_export': 'The browser export cannot do this',
};

/** The Hebrew of every cover refusal (core stillsContract.ts STILLS_REFUSALS); each keeps its numbers and the way forward. */
export const HE_COVER: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^finding the sharpest frame is not built in this version yet$/, () => 'מציאת הפריים הכי חד עוד לא נבנתה בגרסה הזו. לא נמדד דבר; אפשר לעבור בין הפריימים ביד בצופה'],
  [/^too long to measure frame by frame: the stretch has (\d+) frames, at most (\d+)$/, (m) => `הקטע ארוך מדי למדידה פריים־פריים: ${ltr(m[1]!)} פריימים. קצרו אותו עד ${ltr(m[2]!)} פריימים`],
  [/^the stretch \[(\d+), (\d+)\) holds no frame$/, (m) => `בקטע ${ltr(`[${m[1]}, ${m[2]})`)} אין אף פריים. בחרו קטע שסופו אחרי תחילתו`],
  [/^the stretch \[(\d+), (\d+)\) is outside the file's (\d+) frames$/, (m) => `הקטע ${ltr(`[${m[1]}, ${m[2]})`)} מחוץ ל־${ltr(m[3]!)} הפריימים של הקובץ. בחרו פריימים בתוך הקובץ`],
  [/^file \S+ has no moving picture to measure frame by frame$/, () => 'בקובץ אין תמונה נעה למדידה פריים־פריים. בתמונה יש פריים אחד: שמרו אותה ב«שמירת התמונה»'],
  [/^clip \S+ does not show a video file$/, () => 'הקליפ לא מציג קובץ וידאו. בחרו קליפ וידאו אחד ונסו שוב'],
  [/^clip \S+ does not show file \S+$/, () => 'הקליפ מציג קובץ אחר. שלחו את הקובץ שהקליפ מציג, או בלי קליפ ועם קטע'],
  [/^the sharpest frame is already being measured in this project$/, () => 'הפריים הכי חד כבר נמדד עכשיו בפרויקט הזה. חכו שהמדידה תסתיים, או עצרו אותה, ונסו שוב'],
  [/^(\d+) measurements are already running on this computer$/, (m) => `${ltr(m[1]!)} מדידות כבר רצות במחשב הזה. נסו שוב כשאחת מהן תסתיים`],
  [/^the file delivered (\d+) of the (\d+) frames asked for; nothing was saved$/, (m) => `הקובץ מסר ${ltr(m[1]!)} מתוך ${ltr(m[2]!)} הפריימים שהתבקשו; לא נשמר דבר. ייתכן שהקובץ פגום או חריג: נסו קטע קצר יותר או ייבאו אותו שוב`],
  [/^this ffmpeg reads grey levels outside the expected range \(white (\d+), black (\d+)\); nothing was measured$/, (m) => `ffmpeg במחשב הזה קורא את רמות האפור מחוץ לטווח הצפוי (לבן ${ltr(m[1]!)}, שחור ${ltr(m[2]!)}); לא נמדד דבר. השתמשו ב־ffmpeg שמגיע עם התוכנה ומדדו שוב`],
  [/^saving a picture from a file is not built in this version yet$/, () => 'שמירת תמונה מקובץ עוד לא נבנתה בגרסה הזו. בינתיים אפשר לייצא פריים מהסרט כ־PNG'],
  [/^a picture is saved on its own: (\w+) cannot be combined with it$/, (m) => `תמונה נשמרת לבדה: אי אפשר לשלב איתה את ${ltr(m[1]!)}. השאירו בחוץ פריים, טווח, רצף, פורמט מקושר, גודל יעד וייצוא מהיר`],
  [/^a picture is saved as PNG or JPEG, not (\S+)$/, (m) => `תמונה נשמרת כ־PNG או כ־JPEG, לא כ־${ltr(m[1]!)}. בחרו PNG או JPEG`],
  [/^JPEG is only for saving a picture from a file$/, () => 'JPEG מיועד רק לשמירת תמונה מקובץ. בחרו את התמונה לשמירה, או ייצאו את הפריים כ־PNG'],
  [/^a picture is saved at the stored file's own size, so scale cannot be changed$/, () => 'תמונה נשמרת בגודל של הקובץ השמור, ולכן אי אפשר לשנות את קנה המידה. השאירו אותו בחוץ'],
  [/^file \S+ has no picture to save$/, () => 'בקובץ אין תמונה לשמור. בחרו קובץ וידאו או תמונה'],
  [/^frame (\d+) is outside the file's (\d+) frames$/, (m) => `הפריים ${ltr(m[1]!)} מחוץ ל־${ltr(m[2]!)} הפריימים של הקובץ. בחרו פריים בתוך הקובץ`],
  [/^the picture is (\d+)x(\d+), larger than 8192 pixels on a side; it cannot be saved at full size$/, (m) => `התמונה גדולה מ־8192 פיקסלים בצד (${ltr(`${m[1]}×${m[2]}`)}): אי אפשר לשמור אותה בגודל המלא. לא נשמר דבר; אפשר עדיין לייצא פריים מהסרט בגודל הסרט`],
  [/^the crop must lie inside the picture of (\d+)x(\d+) pixels and be at least 16 pixels on each side$/, (m) => `המסגרת צריכה להיות בתוך התמונה של ${ltr(`${m[1]}×${m[2]}`)} פיקסלים, ולפחות 16 פיקסלים בכל צד. הזיזו או הקטינו אותה`],
  [/^the crop does not have the shape of paper (\S+) \((portrait|landscape)\) within one pixel$/, () => 'למסגרת אין צורת הנייר שנבחר. בחרו שוב את הנייר כדי שהמסגרת תקבל את צורתו, או שמרו את כל הפריים'],
  [/^saving a full-size picture is for the project owner's own session only$/, () => 'שמירת תמונה בגודל המלא — רק בחשבון של בעלי הפרויקט. סוכנים מקבלים את המספרים בלבד; את התמונה שומרים בעורך'],
  [/^the browser export route cannot save a picture from a file$/, () => 'הייצוא בדפדפן לא שומר תמונה מקובץ. השתמשו בייצוא בשרת'],
  [/^the saved picture carried tags it must not \((.+)\); nothing was saved$/, (m) => `בתמונה השמורה היו פרטים שאסור שיהיו בה (${ltr(m[1]!)}); לא נשמר דבר. זו תקלה בתוכנה: דווחו עליה, ובינתיים נסו PNG`],
];
