/**
 * Strings and fixed data-testids of the colour match panel «התאמת צבע» (ADR-0014), mounted in LookPanel (W3). Hebrew first;
 * English covers the same keys (cleanup.strings.test.ts). `{n}`, `{name}` and `{reason}` are replaced. The data-testids are fixed by
 * the lead's contracts pass: the proofs and the accessibility audit find the panel by them. W3 owns this file and may add keys; it
 * may not rename these. Nothing here claims a perfect match: nobody has compared the results by eye on real footage yet.
 */
export const COLOUR_MATCH_TESTIDS = {
  panel: 'colour-match', setReference: 'colour-match-set-reference', scope: 'colour-match-scope', method: 'colour-match-method',
  amount: 'colour-match-amount', measure: 'colour-match-measure', progress: 'colour-match-progress', results: 'colour-match-results',
  apply: 'colour-match-apply', unavailable: 'colour-match-unavailable',
  // added by W3
  reference: 'colour-match-reference', cancel: 'colour-match-cancel', status: 'colour-match-status', unlooked: 'colour-match-unlooked',
  tile: 'colour-match-tile', row: 'colour-match-row',
} as const;
export const COLOUR_MATCH_STRINGS = {
  he: {
    title: 'התאמת צבע', setReference: 'קבע כייחוס', scope: 'היקף', scopeClip: 'הקטע הנבחר', scopeTrack: 'כל הקטעים במסלול', scopeAll: 'כל קטעי התמונה',
    method: 'שיטה', methodMatch: 'התאמה לקטע ייחוס', methodBalance: 'איזון צבע אוטומטי', amount: 'עוצמה', measure: 'מדוד', applyN: 'החל על {n} קטעים',
    intro: 'מקרב את הבהירות והצבע של קטעים לקטע ייחוס, או מאזן את הצבע בלי ייחוס. התוצאה היא תיקון צבע רגיל, שאפשר לשנות כל ערך שלו.',
    referenceNone: 'לא נקבע קטע ייחוס', referenceIs: 'קטע ייחוס: {name}', referenceThis: 'הקטע הזה הוא קטע הייחוס',
    measuring: 'מודד את הקטעים בשרת. עם כמה קטעים זה לוקח זמן.', cancel: 'בטל מדידה', canceled: 'המדידה בוטלה.', failed: 'המדידה נכשלה: {reason}',
    gpuChecking: 'בודק אם יש כרטיס מסך בדפדפן הזה…', unavailable: 'התאמת צבע דורשת כרטיס מסך, והוא אינו זמין בדפדפן הזה:',
    needReference: 'קבע קודם קטע ייחוס: בחר קטע ולחץ «קבע כייחוס».', referenceIsTarget: 'הקטע הנבחר הוא קטע הייחוס: בחר קטע אחר, היקף אחר או איזון אוטומטי.',
    noTargets: 'אין במסלול הזה קטעי תמונה אחרים להתאים.',
    resultsCaption: 'תוצאות המדידה. התמונות קבועות: לפני, אחרי וקטע הייחוס.', colClip: 'קטע', colBefore: 'לפני', colAfter: 'אחרי', colReference: 'ייחוס', colResult: 'תוצאה',
    verdictClose: 'קרוב מאוד', verdictNoticeable: 'עדיין נשאר הבדל קטן', verdictPartial: 'מתקרב רק בחלקו',
    residual: 'הבדל שנמדד בעיבוד: {n}', residualModel: 'הבדל מחושב: {n}, לא נבדק בעיבוד', limit: 'הגיע לקצה הטווח: {name}',
    warnChanges: 'המראה משתנה בתוך הקטע, ותיקון אחד לא יתאים לכולו.', warnNotVerified: 'לא נבדק בעיבוד אמיתי: לשרת אין כרטיס מסך.',
    warnReplaces: 'יחליף את תיקון הצבע או את המראה שכבר יש לקטע.', warnAnimated: 'תיקון הצבע של הקטע מונפש בנקודות מפתח, ולכן הקטע לא ייכלל.',
    applyNone: 'אין מה להחיל', stale: 'הפרויקט השתנה מאז המדידה. מדוד שוב לפני שמחילים.', applied: 'הוחל על {n} קטעים. אפשר לבטל ב־Ctrl+Z.',
    unlooked: 'טרם נבדק בעין על צילום אמיתי', statsNote: 'ההתאמה נעשית לפי סטטיסטיקה של התמונה (בהירות וצבע ממוצע), לא לפי מה שמופיע בה: שטח גדול בצבע אחד מושך אליו.',
    tileBefore: 'לפני: {name}', tileAfter: 'אחרי: {name}', tileReference: 'ייחוס: {name}', tileMissing: 'אין תמונה', tileNone: 'אין ייחוס באיזון',
    unverified: 'לא אומת: {reason}', amountValue: 'עוצמה {n}%',
  },
  en: {
    title: 'Colour match', setReference: 'Set as reference', scope: 'Scope', scopeClip: 'The selected clip', scopeTrack: 'Every clip on the track', scopeAll: 'Every picture clip',
    method: 'Method', methodMatch: 'Match to a reference clip', methodBalance: 'Automatic colour balance', amount: 'Amount', measure: 'Measure', applyN: 'Apply to {n} clips',
    intro: 'Brings the lightness and colour of clips close to a reference clip, or balances the colour without one. The result is an ordinary colour grade; every value can be changed.',
    referenceNone: 'No reference clip set', referenceIs: 'Reference clip: {name}', referenceThis: 'This clip is the reference clip',
    measuring: 'Measuring the clips on the server. With several clips this takes a while.', cancel: 'Cancel measuring', canceled: 'Measuring was cancelled.', failed: 'Measuring failed: {reason}',
    gpuChecking: 'Checking whether this browser has a graphics adapter…', unavailable: 'Colour match needs a graphics adapter, which is not available in this browser:',
    needReference: 'Set a reference clip first: select a clip and press “Set as reference”.', referenceIsTarget: 'The selected clip is the reference clip: choose another clip, another scope or automatic balance.',
    noTargets: 'There are no other picture clips on this track to match.',
    resultsCaption: 'Measured results. The pictures are still: before, after and the reference clip.', colClip: 'Clip', colBefore: 'Before', colAfter: 'After', colReference: 'Reference', colResult: 'Result',
    verdictClose: 'Very close', verdictNoticeable: 'A small difference remains', verdictPartial: 'Only partly closer',
    residual: 'Difference measured in a render: {n}', residualModel: 'Computed difference: {n}, not checked in a render', limit: 'Reached the end of its range: {name}',
    warnChanges: 'The look changes inside this clip, so one grade will not suit all of it.', warnNotVerified: 'Not checked in a real render: the server has no graphics adapter.',
    warnReplaces: 'Replaces the colour grade or look this clip already has.', warnAnimated: 'This clip’s colour grade is animated with keyframes, so the clip is left out.',
    applyNone: 'Nothing to apply', stale: 'The project changed since measuring. Measure again before applying.', applied: 'Applied to {n} clips. Ctrl+Z undoes it.',
    unlooked: 'Not yet checked by eye on real footage', statsNote: 'The match follows picture statistics (lightness and average colour), not what the picture shows: a large area of one colour pulls it.',
    tileBefore: 'Before: {name}', tileAfter: 'After: {name}', tileReference: 'Reference: {name}', tileMissing: 'No picture', tileNone: 'No reference in a balance',
    unverified: 'Not verified: {reason}', amountValue: 'Amount {n}%',
  },
} as const;
export type ColourMatchStrings = Record<keyof (typeof COLOUR_MATCH_STRINGS)['he'], string>;
/** A string with its placeholders filled. */
export const fill = (s: string, values: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
