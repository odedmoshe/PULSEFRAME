/** Wording of the stage (UX_REDESIGN §4.5): the stage header with the format prism, the transport, the cut loupe and the notes over the viewer. */
export type StageLang = 'he' | 'en';
const he = {
  stageTools: 'כלי התצוגה', view: 'מה מוצג', program: 'עריכה', source: 'מקור', sourceNone: 'בחרו קליפ וידאו או קול כדי לפתוח את קובץ המקור שלו',
  formats: 'פורמטים', master: 'מקור', addFormat: 'הוספת פורמט', addVertical: 'אנכי 9:16', addSquare: 'ריבוע 1:1', addWide: 'רחב 16:9',
  diverged: 'בפורמט הזה יש התאמות משלו', formatNote: 'מה שמזיזים ומגדילים בתצוגה חל רק על הפורמט הזה. עריכות בציר הזמן משנות את כל הפורמטים.',
  viewing: 'מוצג עכשיו',
  safeArea: 'אזור בטוח', safeNone: 'לפורמט הזה לא הוגדר אזור בטוח', fullscreen: 'מסך מלא', exitFullscreen: 'יציאה ממסך מלא', scopes: 'סקופים',
  toStart: 'לתחילת העריכה', toEnd: 'לסוף העריכה', of: 'מתוך',
  bar: 'תיבה', beatChip: (bar: number, beat: number) => `תיבה ${bar}, פעימה ${beat}`,
  movedIntoTitle: 'הסמן עבר לתוך הכותרת כדי שתראו אותה', movedIntoCue: 'הסמן עבר לתוך הכתובית כדי שתראו אותה',
  emptyStage: 'גררו לכאן את הקליפ הראשון', emptyOr: 'או לחצו', emptyKeyHint: 'על קובץ בספרייה',
  loupe: 'לופה של חיתוך', loupeClose: 'סגירת הלופה', lastFrame: 'הפריים האחרון', firstFrame: 'הפריים הראשון', spareEnd: 'חומר עודף בסוף', spareStart: 'חומר עודף בהתחלה',
  loupeLoading: 'מצייר את הפריים…', loupeFailed: 'לא הצלחנו לצייר את הפריים הזה', loupeRetry: 'ניסיון חוזר',
  firstAfter: 'הפריים הראשון אחרי המעבר', loupeWithTransition: (n: number) => `על החיתוך יש מעבר של ${n} פריימים: משמאל הפריים האחרון שלפניו, מימין הפריים הראשון שאחריו. שניהם מצוירים באותו מנוע שמייצא את הסרטון.`,
  loupeHow: 'שני הפריימים מצוירים באותו מנוע שמייצא את הסרטון.',
  rollKeys: 'פריים', toBeat: 'לפעימה הקרובה', still: 'תמונה',
  noticeTitle: 'התצוגה שונה מהסרטון הסופי',
} as const;
const en: { [K in keyof typeof he]: (typeof he)[K] extends (...a: infer A) => string ? (...a: A) => string : string } = {
  stageTools: 'Viewer tools', view: 'What is shown', program: 'Edit', source: 'Source', sourceNone: 'Select a video or sound clip to open its source file',
  formats: 'Formats', master: 'Master', addFormat: 'Add a format', addVertical: 'Vertical 9:16', addSquare: 'Square 1:1', addWide: 'Wide 16:9',
  diverged: 'This format has adjustments of its own', formatNote: 'What you move and scale in the viewer applies to this format only. Timeline edits change every format.',
  viewing: 'Shown now',
  safeArea: 'Safe area', safeNone: 'This format has no safe area', fullscreen: 'Full screen', exitFullscreen: 'Leave full screen', scopes: 'Scopes',
  toStart: 'To the start of the edit', toEnd: 'To the end of the edit', of: 'of',
  bar: 'Bar', beatChip: (bar, beat) => `Bar ${bar}, beat ${beat}`,
  movedIntoTitle: 'The playhead moved into the title so you can see it', movedIntoCue: 'The playhead moved into the caption so you can see it',
  emptyStage: 'Drag the first clip here', emptyOr: 'or press', emptyKeyHint: 'on a file in the library',
  loupe: 'Cut loupe', loupeClose: 'Close the loupe', lastFrame: 'The last frame', firstFrame: 'The first frame', spareEnd: 'Spare material at the end', spareStart: 'Spare material at the start',
  loupeLoading: 'Drawing the frame…', loupeFailed: 'This frame could not be drawn', loupeRetry: 'Try again',
  firstAfter: 'The first frame after the transition', loupeWithTransition: (n) => `The cut carries a transition of ${n} frames: on the left the last frame before it, on the right the first frame after it. Both are drawn by the engine that exports the video.`,
  loupeHow: 'Both frames are drawn by the engine that exports the video.',
  rollKeys: 'frame', toBeat: 'to the nearest beat', still: 'Image',
  noticeTitle: 'The preview differs from the final video',
};
export const STAGE_STRINGS = { he, en } as const;
