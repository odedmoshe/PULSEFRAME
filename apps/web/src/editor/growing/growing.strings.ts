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
  // wave 8 W3 additions
  pickHelp: string; pickEmpty: string; pickLabel: string; dateOf(d: string): string; moveHint: string;
  stateNone: string; stateOne: string; stateDone: string; stateWords(name: string, state: string): string;
  markHelp: string; markHelpVideo: string; tooClose: string; pictureList: string; placed(n: number, x: number, y: number): string; crosshairAt(x: number, y: number): string;
  playPreview: string; pausePreview: string; previewNeedsTwo: string; frameStepper: string;
  blockerFew: string; blockerUnmarked: string; closeKeep: string; closeConfirm: string;
  creating: string; created: string; staleProject: string; failed: string;
  holdFramesText(frames: number, min: number): string; faceSuggestTitle: string; captionNeedsDate: string;
  /** The bar's «ביטול» when the step that made the film is not among the recent actions (its disabled reason). */
  undoUnavailable: string;
  rebuilding: string; rebuilt: string; whyTitle: string; whyRow(name: string, date: string, mag: string, unc: string): string; whyAfterReload: string; noExclusions: string;
  restoreTitle: string; restoreCreate: string; needsMarksList(n: number): string;
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
  pickHelp: 'סמנו בתיבה את התמונות. רווח מסמן. Alt+חץ למעלה או למטה מזיז תמונה בלי תאריך.', pickEmpty: 'אין בספרייה תמונות או סרטונים. הוסיפו קבצים ופתחו שוב.', pickLabel: 'תמונות וסרטונים לפי תאריך צילום',
  dateOf: (d) => `תאריך: ${d}`, moveHint: 'Alt+חץ מזיז',
  stateNone: 'עוד לא סומנה', stateOne: 'סומנה עין אחת', stateDone: 'סומנו שתי עיניים', stateWords: (n, s) => `${n}: ${s}`,
  markHelp: 'לחצו על העין הראשונה (השמאלית בתמונה) ואז על העין השנייה. במקלדת: חצים מזיזים את הצלב (Shift: עשרה פיקסלים), Enter מסמן, S מחליף בין העיניים, Backspace מוחק את הסימון האחרון, PageDown ו־PageUp מחליפים תמונה.',
  markHelpVideo: 'בסרטון בחרו קודם את הפריים: חצים ימינה ושמאלה בשורת הפריים (Shift: שנייה).', tooClose: 'שתי הנקודות קרובות מדי זו לזו. סמנו את העין השנייה במקומה.', pictureList: 'התמונות שנבחרו וסימון כל אחת',
  placed: (n, x, y) => `סומנה נקודה ${n} במקום ${x},${y}`, crosshairAt: (x, y) => `הצלב ב־${x},${y}`,
  playPreview: 'נגנו את התצוגה המקדימה', pausePreview: 'עצרו את התצוגה המקדימה', previewNeedsTwo: 'התצוגה המקדימה מופיעה אחרי שמסמנים עיניים בשתי תמונות.', frameStepper: 'פריים הסרטון',
  blockerFew: 'סמנו שתי עיניים לפחות בשתי תמונות', blockerUnmarked: 'בחלק מהתמונות שבחרתם אין עדיין סימון. סמנו אותן או בטלו את הבחירה שלהן', closeKeep: 'להמשיך לסמן', closeConfirm: 'לסגור בכל זאת',
  creating: 'יוצרים…', created: 'נוצר', staleProject: 'הפרויקט השתנה בינתיים. פתחו את החלון שוב.', failed: 'לא הצלחנו ליצור',
  holdFramesText: (f, m) => `${f} פריימים (המינימום ${m})`, faceSuggestTitle: 'מדידה על רשת נקודות, לא הבטחה', captionNeedsDate: 'הכיתוב מופיע רק בתמונות עם תאריך',
  undoUnavailable: 'הצעד שיצר את הסרט לא נמצא בין הפעולות האחרונות (אולי כבר בוטל, או שהדף נטען מחדש מאז). אפשר למחוק את התמונות שלו מציר הזמן, או לבנות מחדש.',
  rebuilding: 'בונים מחדש…', rebuilt: 'נבנה מחדש', whyTitle: 'מה נעשה בכל תמונה', whyRow: (n, d, m, u) => `${n} · ${d} · הגדלה ${m} · לא מכוסה ${u}%`, whyAfterReload: 'המספרים מוצגים מיד אחרי יצירה או בנייה מחדש.', noExclusions: 'אף תמונה לא הוצאה.',
  restoreTitle: 'סמנו מחדש את התמונות שנמחקו', restoreCreate: 'החזירו', needsMarksList: (n) => `${n} תמונות צריכות סימון מחדש`,
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
  pickHelp: 'Tick the pictures. Space ticks. Alt+Up or Down moves a picture with no date.', pickEmpty: 'The library has no pictures or videos. Add files and open this again.', pickLabel: 'Pictures and videos by date taken',
  dateOf: (d) => `Date: ${d}`, moveHint: 'Alt+arrow moves',
  stateNone: 'not marked yet', stateOne: 'one eye marked', stateDone: 'both eyes marked', stateWords: (n, s) => `${n}: ${s}`,
  markHelp: 'Click the first eye (the one on the left of the picture), then the second. By keyboard: arrows move the cross-hair (Shift: ten pixels), Enter marks, S swaps the eyes, Backspace removes the last mark, PageDown and PageUp change picture.',
  markHelpVideo: 'For a video choose the frame first: left and right arrows on the frame row (Shift: one second).', tooClose: 'The two points are too close together. Mark the second eye in its place.', pictureList: 'The chosen pictures and the marks of each',
  placed: (n, x, y) => `Point ${n} placed at ${x},${y}`, crosshairAt: (x, y) => `Cross-hair at ${x},${y}`,
  playPreview: 'Play the preview', pausePreview: 'Pause the preview', previewNeedsTwo: 'The preview appears once two pictures have both eyes marked.', frameStepper: 'Video frame',
  blockerFew: 'Mark both eyes in at least two pictures', blockerUnmarked: 'Some chosen pictures are not marked yet. Mark them or untick them', closeKeep: 'Keep marking', closeConfirm: 'Close anyway',
  creating: 'Creating…', created: 'Created', staleProject: 'The project changed meanwhile. Open this again.', failed: 'Could not create it',
  holdFramesText: (f, m) => `${f} frames (minimum ${m})`, faceSuggestTitle: 'Measured on a grid of points, not a promise', captionNeedsDate: 'The caption shows only on pictures with a date',
  undoUnavailable: 'The step that made this film is not among the recent actions (it may be undone already, or the page was reloaded since). Delete its pictures on the timeline, or rebuild.',
  rebuilding: 'Rebuilding…', rebuilt: 'Rebuilt', whyTitle: 'What was done with each picture', whyRow: (n, d, m, u) => `${n} · ${d} · magnified ${m} · uncovered ${u}%`, whyAfterReload: 'The numbers are shown right after creating or rebuilding.', noExclusions: 'No picture was left out.',
  restoreTitle: 'Mark the deleted pictures again', restoreCreate: 'Bring back', needsMarksList: (n) => `${n} pictures need marking again`,
};

export const growingStrings = (lang: 'he' | 'en'): GrowingStrings => (lang === 'he' ? HE : EN);
