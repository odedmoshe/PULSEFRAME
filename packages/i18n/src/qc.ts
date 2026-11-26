/**
 * Strings of «בדיקה לפני ייצוא» (wave 8 qc; .artifacts/wave8/qc-plan.md as corrected by qc-verify.md, decisions.md "Batch C … qc").
 * Spread into `he` and `en` (index.ts); Hebrew first, the English dictionary covers the same keys. The owner is addressed in the
 * plural or not at all, never in a gendered form (verifier C13: «דעיכה לשחור שבעריכה», not «שעשיתם»). Nothing here says the film
 * is fine, passed or clean (C7): a quiet section names the rules with their numbers; every rule is labelled a rule of thumb.
 * Numbers and times are put in <bdi dir="ltr"> by the interface. Reused, not repeated: `send.jump` «מעבר לקטע», `send.find.*`.
 * Placeholders: {n} {s} {db} {fps} — filled by the interface with the numbers of qcContract.ts QC_LIMITS and core CHECK_LIMITS.
 * The headline/detail/fix rows of the five new codes live in the sheet's issue table (apps/web exportSheet.strings.ts `issue`).
 */
export const QC_HE = {
  // the count line at the top of the section (B2's PreflightSummary); neutral forms, the number after the colon
  'qc.summary.blockers': 'חוסמים: {n}', 'qc.summary.warnings': 'לתשומת לב: {n}', 'qc.summary.notes': 'הערות: {n}', 'qc.summary.sound': 'בדיקת הקול: {n}',
  'qc.summary.soundMeasuring': 'בדיקת הקול: מודדים…', 'qc.summary.soundNone': 'בדיקת הקול: אין שמע',
  // the quiet state (never an all-clear, never a check icon: C7)
  'qc.quiet': 'לא נמצא דבר לפי הבדיקות האלה', 'qc.ruleOfThumb': 'כלל אצבע',
  'qc.rule.flash_clip': 'קליפ שמוצג פחות מ־{n} פריימים', 'qc.rule.held_past_picture': 'תמונה שנשארת כי הקול בקובץ ארוך ממנה',
  'qc.rule.title_hidden': 'כותרת שתמונה מלאה מכסה לכל אורכה', 'qc.rule.ends_mid_word': 'סוף הסרט באמצע מילה, לפי זמני המילים בתמליל',
  'qc.rule.cut_mid_word': 'חיתוך לפחות {n} פריים בתוך מילה, לפי זמני המילים בתמליל',
  'qc.rule.silence': 'שקט מתחת ל־{db} dBFS במשך {s} שניות לפחות', 'qc.rule.clipped': 'לפחות {n} דגימות בעוצמה מלאה בעשירית שנייה',
  'qc.rule.wordsOnlyTimed': 'בדיקת מילים רק בקליפים עם תמליל שיש בו זמני מילים',
  // row details the sheet adds from `measured`
  'qc.flash.ignore': 'אם זה בכוונה, אפשר להתעלם', 'qc.held.end': 'הקול בקובץ ממשיך אחרי התמונה, והתמונה האחרונה נשארת',
  'qc.held.start': 'התמונה בקובץ מתחילה אחרי הקול, והתמונה הראשונה נשארת', 'qc.held.noFix': 'אין כאן תיקון אוטומטי: הקול הוא מה שמאריך את הקובץ',
  'qc.word.approximate': 'זמני המילים משוערים', 'qc.word.skippedSegment': 'בתמליל של הקליפ הזה אין זמני מילים, ולכן הוא לא נבדק',
  'qc.frames': '{n} פריימים',
  // the sound findings shown before export (measured on the chosen output, C2)
  'qc.sound.title': 'בדיקת הקול', 'qc.sound.leadOnly': 'נמדד רק הפורמט הראשון שנבחר',
  // the flash row, renamed: these run at the end of the export (C7: no shield icon, no «עבר»)
  'qc.atExport': 'בדיקות בזמן הייצוא: הבהובים, תמונה שחורה, תמונה קפואה', 'qc.atExportNote': 'ירוצו בסוף הייצוא ויוצגו בכרטיס הקובץ, עם מעבר לקטע',
  // the file card: findings the edit explains, folded (C13: not «מוסבר במסמך»)
  'qc.explained.title': 'יש לזה הסבר בעריכה ({n})',
  'qc.explained.dip_transition': 'מעבר דרך שחור שבעריכה', 'qc.explained.fade_edge': 'דעיכה לשחור שבעריכה',
  'qc.explained.freeze_hold': 'עצירת תמונה שבעריכה: הקול שותק בזמן העצירה', 'qc.explained.picture_ends': 'הקול בקובץ ממשיך אחרי התמונה, והתמונה האחרונה נשארת',
  'qc.explained.slow_speed': 'הילוך איטי מאוד: כל פריים מהקובץ נשאר לפחות {s} שניות', 'qc.explained.still_source': 'הסרטון נעשה מתמונה אחת, ולכן התמונה לא זזה',
} as const;
export const QC_EN: Record<keyof typeof QC_HE, string> = {
  'qc.summary.blockers': 'Blocking: {n}', 'qc.summary.warnings': 'Heads up: {n}', 'qc.summary.notes': 'Notes: {n}', 'qc.summary.sound': 'Sound check: {n}',
  'qc.summary.soundMeasuring': 'Sound check: measuring…', 'qc.summary.soundNone': 'Sound check: no sound',
  'qc.quiet': 'Nothing found by these checks', 'qc.ruleOfThumb': 'Rule of thumb',
  'qc.rule.flash_clip': 'A clip shown for fewer than {n} frames', 'qc.rule.held_past_picture': 'A picture that stays because the file\'s sound is longer than it',
  'qc.rule.title_hidden': 'A title covered by a full picture for its whole length', 'qc.rule.ends_mid_word': 'The film ending inside a word, by the transcript\'s word times',
  'qc.rule.cut_mid_word': 'A cut at least {n} frame inside a word, by the transcript\'s word times',
  'qc.rule.silence': 'Sound under {db} dBFS for at least {s} seconds', 'qc.rule.clipped': 'At least {n} samples at full scale in a tenth of a second',
  'qc.rule.wordsOnlyTimed': 'Words are checked only in clips whose transcript has word times',
  'qc.flash.ignore': 'If this is on purpose, it can be ignored', 'qc.held.end': 'The sound in the file goes on after the picture, and the last picture stays',
  'qc.held.start': 'The picture in the file starts after the sound, and the first picture stays', 'qc.held.noFix': 'No automatic fix here: the sound is what makes the file long',
  'qc.word.approximate': 'The word times are estimated', 'qc.word.skippedSegment': 'This clip\'s transcript has no word times, so it was not checked',
  'qc.frames': '{n} frames',
  'qc.sound.title': 'Sound check', 'qc.sound.leadOnly': 'Only the first chosen format is measured',
  'qc.atExport': 'Checks during the export: flashing, black picture, frozen picture', 'qc.atExportNote': 'They run at the end of the export and show on the file card, with a jump to the stretch',
  'qc.explained.title': 'The edit explains these ({n})',
  'qc.explained.dip_transition': 'A dip-to-black transition in the edit', 'qc.explained.fade_edge': 'A fade to black in the edit',
  'qc.explained.freeze_hold': 'A freeze frame in the edit: the sound is silent while it holds', 'qc.explained.picture_ends': 'The sound in the file goes on after the picture, and the last picture stays',
  'qc.explained.slow_speed': 'Very slow motion: each frame of the file stays at least {s} seconds', 'qc.explained.still_source': 'The video was made from a single picture, so it does not move',
};
