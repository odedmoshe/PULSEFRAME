/**
 * «גדלים מול העיניים» — the dialog's and bar's own strings (wave 8 growing), Hebrew first, plural and ungendered («בחרו», «סמנו»).
 * LEAD seed of the pre-pass: the names of the feature, its steps and main controls, every warning and exclusion code, and the fixed
 * shared lines re-exported from packages/i18n/src/growing.ts (the C7 privacy sentence, the C13 preview label, the C8 lines about
 * marks that are never stored). W3 owns this file after the pre-pass and may add keys (both languages; growing.strings.test.ts keeps
 * them in step). Nothing here calls the result sharp, aligned perfectly or right, or calls it AI: it is arithmetic on two points the
 * owner placed, and nobody has looked at it yet. Numbers are plain digits drawn in <bdi> by the components.
 */
import { GROWING_EN, GROWING_HE } from '@pulseframe/i18n';
import type { GrowingExclusionCode, GrowingWarningCode } from '@pulseframe/core';

export interface GrowingStrings {
  name: string; close: string; cancel: string;
  // the steps
  stepPick: string; stepMark: string; stepSettings: string; next: string; back: string;
  // «בחרו תמונות»
  undated: string; ticked(n: number): string;
  // «סמנו עיניים»
  firstEye: string; secondEye: string; swap: string; clearMark: string; prevPicture: string; nextPicture: string; frameOf(frame: number, last: number): string;
  marked(n: number, of: number): string;
  // the live preview (C13)
  preview: string;
  // «איך זה ייראה»
  hold: string; holdSeconds(seconds: string): string; dissolve: string; dissolveNone: string; dissolveShort: string; dissolveLong: string;
  faceSize: string; faceSuggest(percent: number): string; caption: string; captionDate: string; captionAge: string; noBirthDate: string; create: string;
  // fixed shared lines (i18n growing.ts)
  privacy: string; closeLosesMarks: string; deletedNeedsMarks: string; orientationLimit: string; flashAfterExport: string; method: string; notBuilt: string;
  // notes
  warning: Record<GrowingWarningCode, string>;
  excluded: Record<GrowingExclusionCode, string>;
  // the bar
  made: string; notWatched: string; undo: string; rebuild: string; restoreRemoved: string; why: string;
}

const shared = (d: typeof GROWING_HE | typeof GROWING_EN) => ({
  privacy: d['growing.privacy'], closeLosesMarks: d['growing.closeLosesMarks'], deletedNeedsMarks: d['growing.deletedNeedsMarks'], preview: d['growing.preview'],
  orientationLimit: d['growing.orientationLimit'], flashAfterExport: d['growing.flashAfterExport'], method: d['growing.method'], notBuilt: d['growing.notBuilt'], name: d['growing.name'],
});

const HE: GrowingStrings = {
  ...shared(GROWING_HE),
  close: 'סגירה', cancel: 'ביטול',
  stepPick: 'בחרו תמונות', stepMark: 'סמנו עיניים', stepSettings: 'איך זה ייראה', next: 'המשך', back: 'חזרה',
  undated: 'בלי תאריך', ticked: (n) => `נבחרו ${n}`,
  firstEye: 'עין ראשונה — זו שמשמאל בתמונה', secondEye: 'עין שנייה', swap: 'החליפו בין העיניים (S)', clearMark: 'מחקו סימון', prevPicture: 'התמונה הקודמת', nextPicture: 'התמונה הבאה',
  frameOf: (frame, last) => `פריים ${frame} מתוך ${last}`,
  marked: (n, of) => `סומנו ${n} מתוך ${of}`,
  hold: 'כמה זמן כל תמונה', holdSeconds: (s) => `${s} שניות`, dissolve: 'מעבר רך', dissolveNone: 'בלי', dissolveShort: 'קצר', dissolveLong: 'ארוך',
  faceSize: 'גודל הפנים', faceSuggest: (p) => `בלי פינות ריקות: ${p}%`, caption: 'כיתוב', captionDate: 'תאריך', captionAge: 'גיל', noBirthDate: 'לא נרשם תאריך לידה בדף האנשים', create: 'צרו',
  warning: {
    enlarged: 'התמונה מוגדלת (היוריסטיקה, המספר מוצג) — ייתכן שתיראה רכה',
    uncovered_corners: 'בחלק מהתמונות נשארות פינות ריקות בצבע הרקע (נמדד על רשת נקודות)',
    cannot_cover_all: 'אין גודל פנים שבו כל התמונות ממלאות את הפריים',
    before_birth: 'תמונה שצולמה לפני תאריך הלידה: הכיתוב שלה בלי גיל',
    undated_no_caption: 'לתמונה בלי תאריך אין כיתוב',
    no_birth_date: 'לא נרשם תאריך לידה, לכן אין גיל בכיתוב',
    other_formats_not_aligned: 'בפורמטים האחרים של הפרויקט העיניים לא מיושרות',
    orientation_unverified: 'הסיבוב של התמונה הזאת לא נבדק כאן (PNG או WebP)',
    kept_by_hand: 'תמונה ששיניתם ביד נשארה כמו שהיא',
    removed_by_hand: 'תמונה שמחקתם לא נוצרה מחדש',
    moved_back: 'תמונה שהוזזה בזמן חזרה למקומה',
    flash_checked_after_export: 'בדיקת ההבהובים נעשית אחרי הייצוא',
  },
  excluded: {
    outside_transform_range: 'העיניים קטנות מדי בתמונה הזאת לגודל הפנים שנבחר',
    needs_marks: 'תמונה שנמחקה צריכה סימון מחדש כדי לחזור',
    kept_by_hand: 'נשארה כמו ששיניתם אותה',
    removed_by_hand: 'נמחקה ביד',
  },
  made: 'גדלים מול העיניים נוצר', notWatched: 'עוד לא נצפה', undo: 'ביטול', rebuild: 'בנו מחדש', restoreRemoved: 'החזרת החלקים שנמחקו', why: 'למה?',
};

const EN: GrowingStrings = {
  ...shared(GROWING_EN),
  close: 'Close', cancel: 'Cancel',
  stepPick: 'Choose pictures', stepMark: 'Mark the eyes', stepSettings: 'How it will look', next: 'Next', back: 'Back',
  undated: 'No date', ticked: (n) => `${n} chosen`,
  firstEye: 'First eye — the one on the left of the picture', secondEye: 'Second eye', swap: 'Swap the eyes (S)', clearMark: 'Clear the marks', prevPicture: 'Previous picture', nextPicture: 'Next picture',
  frameOf: (frame, last) => `Frame ${frame} of ${last}`,
  marked: (n, of) => `${n} of ${of} marked`,
  hold: 'How long each picture', holdSeconds: (s) => `${s} seconds`, dissolve: 'Soft transition', dissolveNone: 'None', dissolveShort: 'Short', dissolveLong: 'Long',
  faceSize: 'Face size', faceSuggest: (p) => `No empty corners: ${p}%`, caption: 'Caption', captionDate: 'Date', captionAge: 'Age', noBirthDate: 'No birth date in the people sheet', create: 'Create',
  warning: {
    enlarged: 'The picture is enlarged (heuristic, the number is shown) — it may look soft',
    uncovered_corners: 'Some pictures leave empty corners in the background colour (measured on a grid of points)',
    cannot_cover_all: 'No face size makes every picture fill the frame',
    before_birth: 'A picture taken before the birth date: its caption has no age',
    undated_no_caption: 'A picture without a date has no caption',
    no_birth_date: 'No birth date is recorded, so the caption has no age',
    other_formats_not_aligned: 'In the project\'s other formats the eyes are not lined up',
    orientation_unverified: 'The rotation of this picture has not been checked here (PNG or WebP)',
    kept_by_hand: 'A picture you changed by hand was kept as it is',
    removed_by_hand: 'A picture you deleted was not made again',
    moved_back: 'A picture moved in time went back to its place',
    flash_checked_after_export: 'The flash check runs after export',
  },
  excluded: {
    outside_transform_range: 'The eyes are too small in this picture for the chosen face size',
    needs_marks: 'A deleted picture needs marking again to come back',
    kept_by_hand: 'Kept as you changed it',
    removed_by_hand: 'Deleted by hand',
  },
  made: 'Growing up before your eyes made', notWatched: 'not watched yet', undo: 'Undo', rebuild: 'Rebuild', restoreRemoved: 'Bring back the deleted parts', why: 'Why?',
};

export const growingStrings = (lang: 'he' | 'en'): GrowingStrings => (lang === 'he' ? HE : EN);
