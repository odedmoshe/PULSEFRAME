/**
 * Shared interface strings of perform mode (ADR-0025; the workspace «הופעה», "Perform"): the operation's name (`op.*`,
 * op-wording.test.ts), the fixed product wording the lead decided (wave5-decisions.md), the labels of the contract's codes
 * (core performContract.ts HELD_REASONS, CAMERA_REFUSALS, SNAP_MODES, TEMPO_MODES) and the route's error headlines. Spread into
 * `he` and `en` (index.ts); Hebrew first, and the English dictionary covers the same keys. The view's own words (buttons,
 * counts, the calibration dialog) are W3's, in apps/web/src/editor/perform/perform.strings.ts; numbers go in <bdi dir="ltr">.
 * Until the owner runs the tap calibration on the laptop, nothing calls a take "in sync" (perform.notCalibrated); latency is
 * not checked (perform-wording.test.ts keeps "in sync" and «מסונכרן» out of these strings).
 * Also here: the Hebrew wording of every perform refusal (HE_PERFORM; core performRefusals.ts), which refusals.ts adds to
 * translateRefusal.
 */
const ltr = (s: string) => `⁦${s}⁩`;

export const PERFORM_HE = {
  'op.apply_take': 'הקלטת הופעה',
  // the workspace and the decided wording
  'perform.mode': 'הופעה', 'perform.title': 'הופעה', 'perform.camera': 'צלם',
  'perform.notCalibrated': 'לא כויל', 'perform.calibrate': 'כיול הקשה',
  'perform.needsGpu': 'דורש כרטיס מסך', 'perform.gpuExportNote': 'ייצוא בשרת צריך כרטיס מסך; הייצוא בדפדפן עובד',
  'perform.beatStrobe': 'הבזק על הפעימה', 'perform.beatStrobeNeedsMusic': 'הבזק על הפעימה זמין רק כשיש מוזיקה שהפעימות שלה נמדדו',
  'perform.addToLibrary': 'הוסיפו לספרייה',
  'perform.ghostBanner': 'תצוגה מקדימה של ההופעה — עדיין לא נשמר',
  'perform.masterOnly': 'ההופעה נעשית על הגרסה הראשית. הפורמטים המקושרים יקבלו אותה מהגרסה הראשית',
  'perform.linkedFormats': 'בפורמטים המקושרים המסגור יהיה שונה',
  'perform.multicamDigits': 'כאן מקשי המספרים מחליפים זוויות של המולטיקאם. אפשר להפעיל את הלחצנים בעכבר או במגע',
  'perform.noFlashes': 'בלי הבזקים', 'perform.shiftBeat': 'הזזת פעימה',
  'perform.oneUndo': 'כל ההופעה נשמרת בצעד אחד, ואפשר לבטל אותה בבת אחת',
  'perform.bank.canvas': 'לחצנים רגילים', 'perform.bank.gpu': 'לחצנים לכרטיס מסך',
  'perform.recipe': 'הופעה',
  'perform.notBuilt': 'מצב הופעה עוד לא נבנה בגרסה הזו. שום דבר לא ישתנה כאן',
  // snap, tempo
  'perform.snap.off': 'חופשי', 'perform.snap.beat': 'על הפעימה', 'perform.snap.half': 'חצי פעימה', 'perform.strength': 'עוצמת יישור',
  'perform.tempo.half': 'חצי קצב (÷2)', 'perform.tempo.normal': 'קצב רגיל (×1)', 'perform.tempo.double': 'קצב כפול (×2)',
  // why a hit was not kept (core HELD_REASONS): words, never colour alone
  'perform.held.flash_limit': 'לא יוצג: פחות משליש שנייה אחרי שינוי האור הקודם (מגבלת בטיחות)',
  'perform.held.needs_gpu': 'לא יוצג: הלחצן הזה דורש כרטיס מסך',
  'perform.held.no_music': 'לא יוצג: אין מוזיקה שהפעימות שלה נמדדו',
  'perform.held.no_picture': 'לא יוצג: אין תמונה ברגע הזה',
  'perform.held.has_motion': 'לא יוצג: הקליפ כבר זז או משנה גודל ברגע הזה',
  'perform.held.locked': 'לא יוצג: הרצועה נעולה',
  'perform.held.follows_track': 'לא יוצג: הקליפ עוקב אחרי תנועה',
  'perform.held.crosses_cut': 'לא יוצג: הלחיצה עוברת את סוף הקליפ',
  'perform.held.too_many_keys': 'לא יוצג: בקליפ יש כבר יותר מדי נקודות מפתח',
  'perform.held.too_many_sounds': 'לא יוצג: יותר מארבעה צלילים בבת אחת',
  'perform.held.sound_too_short': 'לא יוצג: לא נשאר מקום לצליל לפני הסוף',
  'perform.held.missing_asset': 'לא יוצג: הצליל או המדבקה עוד לא בספרייה',
  'perform.held.take_full': 'לא יוצג: ההופעה מלאה (עד 200 לחיצות)',
  'perform.held.outside_edit': 'לא יוצג: אחרי סוף העריכה',
  // why a camera take was refused (core CAMERA_REFUSALS)
  'perform.camera.not_picture': 'אפשר לצלם רק קליפ עם תמונה', 'perform.camera.adjustment': 'אי אפשר לצלם שכבת התאמה',
  'perform.camera.locked': 'הרצועה נעולה', 'perform.camera.rotated': 'הקליפ מסובב; אפשר לבטל את הסיבוב ולצלם',
  'perform.camera.follows_track': 'הקליפ עוקב אחרי תנועה', 'perform.camera.no_room': 'התמונה אינה ממלאת את המסגרת, ולכן אין לאן לזוז',
  'perform.camera.no_samples': 'לא נרשמה תנועה של הסמן', 'perform.camera.not_full_frame': 'הקליפ קטן מהמסגרת (תמונה בתוך תמונה)',
  'perform.camera.too_many_keys': 'בקליפ יהיו יותר מדי נקודות מפתח; אפשר לצלם קטע קצר יותר',
  'perform.camera.overTolerance': 'הקטע ארוך מדי לדיוק הנדרש; אפשר לצלם קטע קצר יותר',
  // route error headlines
  'error.code.take_not_built': 'הקלטת הופעה עדיין לא נבנתה', 'error.code.take_empty': 'שום לחיצה בהופעה לא נשמרה',
};
export const PERFORM_EN: Record<keyof typeof PERFORM_HE, string> = {
  'op.apply_take': 'Record a performance',
  'perform.mode': 'Perform', 'perform.title': 'Perform', 'perform.camera': 'Camera',
  'perform.notCalibrated': 'Not calibrated', 'perform.calibrate': 'Calibrate tapping',
  'perform.needsGpu': 'Needs a graphics card', 'perform.gpuExportNote': 'A server export needs a graphics card; the browser export works',
  'perform.beatStrobe': 'Flash on the beat', 'perform.beatStrobeNeedsMusic': 'Flash on the beat is available only with music whose beats were measured',
  'perform.addToLibrary': 'Add to the library',
  'perform.ghostBanner': 'Preview of the take — not saved yet',
  'perform.masterOnly': 'Takes are performed on the main edit. Linked formats get them from it',
  'perform.linkedFormats': 'Linked formats will be framed differently',
  'perform.multicamDigits': 'Here the number keys switch multicam angles. The pads work with a pointer or touch',
  'perform.noFlashes': 'No flashes', 'perform.shiftBeat': 'Shift the beat',
  'perform.oneUndo': 'The whole take is saved as one step and undone at once',
  'perform.bank.canvas': 'Standard pads', 'perform.bank.gpu': 'Graphics-card pads',
  'perform.recipe': 'Performance',
  'perform.notBuilt': 'Perform mode is not built in this version yet. Nothing changes here',
  'perform.snap.off': 'Free', 'perform.snap.beat': 'On the beat', 'perform.snap.half': 'Half beat', 'perform.strength': 'Snap strength',
  'perform.tempo.half': 'Half tempo (÷2)', 'perform.tempo.normal': 'Normal tempo (×1)', 'perform.tempo.double': 'Double tempo (×2)',
  'perform.held.flash_limit': 'Not shown: less than a third of a second after the previous change of light (safety limit)',
  'perform.held.needs_gpu': 'Not shown: this pad needs a graphics card',
  'perform.held.no_music': 'Not shown: no music with measured beats',
  'perform.held.no_picture': 'Not shown: no picture at this moment',
  'perform.held.has_motion': 'Not shown: the clip already moves or changes size here',
  'perform.held.locked': 'Not shown: the track is locked',
  'perform.held.follows_track': 'Not shown: the clip follows a motion track',
  'perform.held.crosses_cut': 'Not shown: the tap runs past the end of the clip',
  'perform.held.too_many_keys': 'Not shown: the clip already has too many keyframes',
  'perform.held.too_many_sounds': 'Not shown: more than four sounds at once',
  'perform.held.sound_too_short': 'Not shown: no room left for the sound before the end',
  'perform.held.missing_asset': 'Not shown: the sound or sticker is not in the library yet',
  'perform.held.take_full': 'Not shown: the take is full (200 taps at most)',
  'perform.held.outside_edit': 'Not shown: after the end of the edit',
  'perform.camera.not_picture': 'Only a clip with a picture can be filmed', 'perform.camera.adjustment': 'An adjustment layer cannot be filmed',
  'perform.camera.locked': 'The track is locked', 'perform.camera.rotated': 'The clip is rotated; remove the rotation to film it',
  'perform.camera.follows_track': 'The clip follows a motion track', 'perform.camera.no_room': 'The picture does not fill the frame, so there is no room to move',
  'perform.camera.no_samples': 'No pointer movement was recorded', 'perform.camera.not_full_frame': 'The clip is smaller than the frame (picture in picture)',
  'perform.camera.too_many_keys': 'The clip would have too many keyframes; film a shorter stretch',
  'perform.camera.overTolerance': 'The stretch is too long for the accuracy needed; film a shorter stretch',
  'error.code.take_not_built': 'Performance takes are not built yet', 'error.code.take_empty': 'No tap of the take was kept',
};

/** Hebrew wording of every perform refusal (core performRefusals.ts PERFORM_REFUSALS and PERFORM_API_REFUSALS). */
const TAKE_FAULT_HE = 'שום דבר לא נשמר. אם זה חוזר, זו תקלה בגרסה הזו';
export const HE_PERFORM: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^take step \d+ uses ".*", which a take may not run$/, () => `ההופעה ביקשה פעולה שאינה מותרת לה, ולכן לא נשמרה. ${TAKE_FAULT_HE}`],
  [/^take step \d+: the bind name ".*" is used twice$/, () => `אחד השלבים של ההופעה אינו תקין, ולכן לא נשמרה. ${TAKE_FAULT_HE}`],
  [/^take step \d+: a take carries no media of its own, so "\$asset" cannot be used$/, () => 'הופעה אינה מביאה קבצים משלה. אפשר להוסיף קודם את הצליל או המדבקה לספרייה, ואז להקליט שוב'],
  [/^take step \d+ \(\S+\): [\s\S]+$/, () => `אחד השלבים של ההופעה אינו תקין, ולכן לא נשמרה. ${TAKE_FAULT_HE}`],
  [/^a take adds at most (\d+) tracks; this one adds (\d+)$/, (m) => `הופעה מוסיפה עד ${ltr(m[1]!)} רצועות, וזו הייתה מוסיפה ${ltr(m[2]!)}. אפשר להשתמש בפחות צלילים בבת אחת`],
  [/^the change of light this take makes at frame (\d+) comes (\d+) frames after another; changes of light must be at least (\d+) frames apart \(flash safety\)$/, (m) => `שינוי האור בפריים ${ltr(m[1]!)} בא ${ltr(m[2]!)} פריימים אחרי שינוי אחר; צריך לפחות ${ltr(m[3]!)} פריימים ביניהם (מגבלת בטיחות להבהובים). אפשר להקיש פחות מהר, או להשאיר שליש שנייה בין לחצנים שמשנים אור`],
  [/^the change of light this take makes at frame (\d+) is within (\d+) frames of a strobe or a light transition \(flash safety\)$/, (m) => `שינוי האור בפריים ${ltr(m[1]!)} קרוב מדי (פחות מ־${ltr(m[2]!)} פריימים) להבזק או למעבר אור (מגבלת בטיחות להבהובים). אפשר להרחיק את הלחיצה, או להסיר אחד מהם`],
  [/^the picture, title or change of light this take makes at frame (\d+) lasts (\d+) frames; it must last at least (\d+) \(flash safety\)$/, (m) => `מה שנוסף בפריים ${ltr(m[1]!)} נמשך ${ltr(m[2]!)} פריימים, וצריך לפחות ${ltr(m[3]!)} (מגבלת בטיחות להבהובים). אפשר להחזיק את הלחצן מעט יותר`],
  [/^performance takes are not built in this version yet$/, () => 'הקלטת הופעה עדיין לא נבנתה בגרסה הזו. שום דבר לא השתנה'],
  [/^none of the (\d+) taps of this take could be kept$/, (m) => `אף אחת מ־${ltr(m[1]!)} הלחיצות של ההופעה לא נשמרה. ליד כל לחיצה כתוב למה; שום דבר לא השתנה`],
  [/^this credential may only propose edits, and a performance take cannot be proposed: it is applied through an internal step that a proposal does not carry$/, () => 'ההרשאה הזו מאפשרת רק להציע עריכות, והופעה אינה יכולה להיות הצעה. אפשר לבקש מבעל/ת הפרויקט להקליט אותה, או הרשאת עריכה'],
];
