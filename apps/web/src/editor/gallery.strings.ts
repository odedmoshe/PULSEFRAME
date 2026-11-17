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

/** Words of the catalogue spread (UX_REDESIGN §4.4): sections, filters, notes on tiles and the footer. */
export const SPREAD_STRINGS = {
  he: {
    count: (n: number) => String(n), cutChip: (a: string, b: string, at: string) => `התצוגה המקדימה בחיתוך: ${a} ← ${b} ${at}`, clipChip: (name: string) => `על: ${name}`,
    fitsHere: 'מתאימים לחיתוך הזה', fitsBasis: '(לפי החומר שנשאר בקליפים)', recent: 'השתמשת לאחרונה', all: (what: string, n: number) => `כל ${what} ${n}`,
    allWord: { effects: 'האפקטים', looks: 'המראות', transitions: 'המעברים', text: 'הסגנונות', motion: 'התנועות' },
    filterAll: 'הכול', filterFav: 'מועדפים', favourite: 'הוספה למועדפים', unfavourite: 'הסרה מהמועדפים',
    fits: 'מתאים', shortens: (s: string) => `יקצר ${s} ש׳`, noRoom: 'אין חומר עודף', notSaved: 'לא נשמר', appliedOn: 'מוחל', checkMark: 'הוחל',
    needsGpuTile: 'דורש כרטיס מסך', gpuWhy: 'אין כרטיס מסך מתאים בדפדפן הזה', adjWhy: 'לא על שכבת התאמה',
    loadingTiles: 'מכינים תמונות…', favEmpty: 'עוד אין מועדפים. סמנו כוכב על אריח כדי לשמור אותו כאן.',
    applyAll: (n: number) => (n === 1 ? 'להחיל על החיתוך' : `להחיל על כל ${n} החיתוכים`), applyAllNone: 'אין חיתוכים נוספים', applyAllNeedsPick: 'בחרו קודם מעבר', shuffle: 'ערבוב', shuffleWhy: 'אין חיתוכים לערבב',
    appliedAll: (name: string, n: number) => `${name}: הוחל על ${n} חיתוכים`, shuffled: (n: number) => `ערבוב: הוחלו מעברים שונים על ${n} חיתוכים`, skippedNoRoom: (n: number) => ` · ${n} חיתוכים בלי חומר עודף נשארו כמות שהם`,
    enterApplies: 'החלה', hint: 'בלחיצה על אריח הוא מוחל על הקליפ, ופעולה אחת בטלה בביטול.', hoverNote: 'ריחוף מציג תצוגה בלבד',
    textTitle: 'סגנונות טקסט', textCount: (n: number) => `${n}`, captionLooks: 'מראות כתוביות', captionLooksHint: 'המראות מוצגים על הטקסט האמיתי של הכתוביות', chosen: 'נבחר',
    sampleText: 'סוף שבוע',
  },
  en: {
    count: (n: number) => String(n), cutChip: (a: string, b: string, at: string) => `Previewed on the cut: ${a} ← ${b} ${at}`, clipChip: (name: string) => `On: ${name}`,
    fitsHere: 'Fit this cut', fitsBasis: '(by the material left in the clips)', recent: 'Used recently', all: (what: string, n: number) => `All ${what} ${n}`,
    allWord: { effects: 'effects', looks: 'looks', transitions: 'transitions', text: 'styles', motion: 'motions' },
    filterAll: 'All', filterFav: 'Favourites', favourite: 'Add to favourites', unfavourite: 'Remove from favourites',
    fits: 'Fits', shortens: (s: string) => `Shortens ${s} s`, noRoom: 'No spare material', notSaved: 'Not saved', appliedOn: 'Applied', checkMark: 'Applied',
    needsGpuTile: 'Needs a graphics card', gpuWhy: 'No suitable graphics card in this browser', adjWhy: 'Not on an adjustment layer',
    loadingTiles: 'Preparing pictures…', favEmpty: 'No favourites yet. Star a tile to keep it here.',
    applyAll: (n: number) => (n === 1 ? 'Apply to the cut' : `Apply to all ${n} cuts`), applyAllNone: 'There are no other cuts', applyAllNeedsPick: 'Pick a transition first', shuffle: 'Shuffle', shuffleWhy: 'There are no cuts to shuffle',
    appliedAll: (name: string, n: number) => `${name}: applied to ${n} cuts`, shuffled: (n: number) => `Shuffle: different transitions applied to ${n} cuts`, skippedNoRoom: (n: number) => ` · ${n} cuts with no spare material were left as they are`,
    enterApplies: 'Apply', hint: 'Clicking a tile applies it to the clip; one undo reverts it.', hoverNote: 'Hovering only previews',
    textTitle: 'Text styles', textCount: (n: number) => `${n}`, captionLooks: 'Caption looks', captionLooksHint: 'The looks are drawn on the real caption text', chosen: 'Selected',
    sampleText: 'Weekend',
  },
} as const;
