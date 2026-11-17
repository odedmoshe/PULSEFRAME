/** Strings of the effects gallery (kept here so the shared dictionaries stay untouched). */
export type GalleryLang = 'he' | 'en';
export const GALLERY_STRINGS = {
  he: {
    open: 'גלריית אפקטים', title: 'גלריית אפקטים', close: 'סגירת הגלריה', search: 'חיפוש לפי שם', searchPlaceholder: 'חיפוש…',
    tabs: 'סוגי מראה', effects: 'אפקטים', looks: 'מראות צבע', transitions: 'מעברים', text: 'סגנונות טקסט', motion: 'תנועה',
    motionGroups: { in: 'כניסה', out: 'יציאה', loop: 'לולאה', move: 'תנועה לאורך הקליפ' },
    motionNote: 'אפשר לשלב כניסה ויציאה. לולאה או תנועה לאורך הקליפ מחליפות את המפתחות של המאפיינים שבהם הן משתמשות.',
    needsGpu: 'דורש כרטיס מסך', empty: 'אין תוצאות', noFrame: 'אין תמונה בתצוגה המקדימה, לכן אין תמונות ממוזערות.', rendering: 'מצייר תמונות ממוזערות…',
    thumbNote: 'התמונות הממוזערות מצוירות מהפריים המוצג עכשיו, באותו מַרכֵּב של התצוגה והייצוא.', sample: 'אבג Abc',
    applied: (name: string) => `הוחל: ${name}`, refused: (name: string) => `${name} לא הוחל.`,
    alreadyOn: (name: string) => `${name} כבר נמצא על הקליפ, ולכן לא נוסף שוב. אפשר לכוון או להסיר אותו ברשימת האפקטים של הקליפ.`,
    conflict: 'מישהו אחר שינה את הפרויקט באותו רגע, והפרויקט נטען מחדש. אפשר לבחור שוב.', noReason: 'העורך לא מסר סיבה.',
    appliedShort: (name: string, n: number, byPrevious: boolean) => byPrevious ? `הוחל: ${name}, באורך ${n} פריימים, כי זה כל החומר שנשאר אחרי סוף הקליפ הקודם.` : `הוחל: ${name}, באורך ${n} פריימים, כאורך הקליפ הזה.`,
    noHandle: 'הקליפ הקודם מנגן את הקובץ שלו עד הסוף, ולכן אין חומר שהמעבר יכול לשלב: כדי לפנות חומר, מקצרים מעט את סוף הקליפ הקודם, מצמידים אליו שוב את הקליפ הזה ובוחרים שוב את המעבר.',
    noRoom: 'אין מקום למעבר בתחילת הקליפ הזה.',
  },
  en: {
    open: 'Effects gallery', title: 'Effects gallery', close: 'Close gallery', search: 'Search by name', searchPlaceholder: 'Search…',
    tabs: 'Kinds of look', effects: 'Effects', looks: 'Colour looks', transitions: 'Transitions', text: 'Text styles', motion: 'Motion',
    motionGroups: { in: 'Entrances', out: 'Exits', loop: 'Loops', move: 'Whole-clip moves' },
    motionNote: 'Entrances and exits can be combined. A loop or a move replaces the keys of the properties it uses.',
    needsGpu: 'needs a graphics adapter', empty: 'No results', noFrame: 'The preview shows no picture, so there are no thumbnails.', rendering: 'Drawing thumbnails…',
    thumbNote: 'Thumbnails are drawn from the frame on screen, by the same compositor as preview and export.', sample: 'אבג Abc',
    applied: (name: string) => `Applied: ${name}`, refused: (name: string) => `${name} was not applied.`,
    alreadyOn: (name: string) => `${name} is already on this clip, so it was not added again. Adjust or remove it in the clip's Effects list.`,
    conflict: 'Someone else changed the project at the same moment, and it was reloaded. Pick again.', noReason: 'The editor gave no reason.',
    appliedShort: (name: string, n: number, byPrevious: boolean) => byPrevious ? `Applied: ${name}, ${n} frames long, which is all the material left after the end of the previous clip.` : `Applied: ${name}, ${n} frames long, as long as this clip.`,
    noHandle: 'The previous clip plays its file to the very end, so there is no material for the transition to blend: trim a little off the end of the previous clip, move this clip back against it, and pick the transition again.',
    noRoom: 'There is no room for a transition at the start of this clip.',
  },
} as const;
