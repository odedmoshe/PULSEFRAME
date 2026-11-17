/**
 * Strings of the adjustment layer controls and of "replace media" (ADR-0016), kept here so the shared dictionaries keep only
 * what other surfaces use (the track label 'track.adjustment' and the palette commands are in packages/i18n/src/templates.ts).
 * Hebrew first; the English entries must cover the same keys.
 */
export const ADJUST_STRINGS = {
  he: {
    applyTo: 'החל על',
    applyToClip: 'קליפ זה',
    applyToEdit: 'כל העריכה',
    applyToEditNote: 'אפקט או מראה שנבחרים כאן נוספים לשכבת התאמה שמעל כל העריכה (היא נוצרת אם אין עדיין). שכבת ההתאמה חלה על כל מה שמתחתיה; כותרות ברצועה גבוהה ממנה וכתוביות לא מושפעות.',
    adjustNote: 'שכבת התאמה: אין לה תמונה משלה. האפקטים, המסכה, האטימות ומצב המיזוג שלה חלים על כל מה שמתחתיה בזמן הזה. כתוביות לעולם לא מושפעות.',
    maskNote: 'המסכה של שכבת התאמה נמדדת ביחס לכל הפריים: מחוץ לה התמונה נשארת כמו שהיא.',
    opacity: 'אטימות',
    coverEdit: 'כסה את כל העריכה',
    coverEditHint: 'מותח או מקצר את שכבת ההתאמה כך שתתחיל ב־0 ותסתיים בסוף התמונה או הכותרת האחרונה.',
    coverEditDone: 'השכבה כבר מכסה את כל העריכה.',
    notOnAdjustment: 'לא בשכבת התאמה',
    showAdjustment: 'בחירת שכבת ההתאמה של כל העריכה',
    appliedToEdit: 'נוסף לשכבת ההתאמה של כל העריכה.',
    replaceMedia: 'החלפת מדיה…',
    replaceMediaTitle: 'בחירת קובץ אחר לקליפ הזה',
    replaceMediaNote: 'הקליפ שומר את מקומו, אורכו, האפקטים, התנועה והמעבר; רק הקובץ מתחלף.',
    replaceMediaNone: 'אין בספרייה קובץ אחר שמתאים לרצועה הזו.',
    replaceDetach: 'בלי קול: הקול המקושר יישאר כמו שהוא, מנותק',
    replaceCurrent: 'הקובץ הנוכחי',
    video: 'וידאו', image: 'תמונה', audio: 'קול',
  },
  en: {
    applyTo: 'Apply to',
    applyToClip: 'This clip',
    applyToEdit: 'The whole edit',
    applyToEditNote: 'An effect or look picked here goes on an adjustment layer over the whole edit (made if there is none yet). The adjustment layer acts on everything below it; titles on a higher track and captions are not affected.',
    adjustNote: 'Adjustment layer: it has no picture of its own. Its effects, mask, opacity and blend mode act on everything below it for its time. Captions are never affected.',
    maskNote: 'The mask of an adjustment layer is measured on the whole frame: outside it the picture stays as it is.',
    opacity: 'Opacity',
    coverEdit: 'Cover the whole edit',
    coverEditHint: 'Lengthens or shortens the adjustment layer so it starts at 0 and ends where the last picture or title ends.',
    coverEditDone: 'The layer already covers the whole edit.',
    notOnAdjustment: 'not on an adjustment layer',
    showAdjustment: 'Select the whole-edit adjustment layer',
    appliedToEdit: 'Added to the adjustment layer over the whole edit.',
    replaceMedia: 'Replace media…',
    replaceMediaTitle: 'Choose another file for this clip',
    replaceMediaNote: 'The clip keeps its place, length, effects, motion and transition; only the file changes.',
    replaceMediaNone: 'The library has no other file that suits this track.',
    replaceDetach: 'no sound: the linked sound stays as it is, unlinked',
    replaceCurrent: 'the current file',
    video: 'video', image: 'picture', audio: 'sound',
  },
} as const satisfies Record<'he' | 'en', Record<string, string>>;
export type AdjustStrings = (typeof ADJUST_STRINGS)['he'];
