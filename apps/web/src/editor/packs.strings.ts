/**
 * Strings of the pack shelf, the pack page and the pack fields (ADR-0022). Hebrew first; English covers the same keys
 * (packs.logic.test.ts checks it). The field labels, the candle-lighting switch and the source line are the shared i18n
 * entries (packages/i18n/src/packs.ts, pack.*), so the dialog and the pages say them in one voice. A pack's own words (its
 * name, hint, titles, the suggestion reason) come from the pack data and are shown as they are.
 */
import { dictionaries, type Key } from '@pulseframe/i18n';
import type { PackTab } from './packs.testids.ts';

const d = dictionaries;
export interface PackStrings {
  shelfTitle: string; shelfIntro: string; shelfEmpty: string;
  templates: (n: number) => string; elements: (n: number) => string;
  open: (name: string) => string; dismiss: string; dismissFor: (name: string) => string; suggestedLabel: string;
  back: string; tabsLabel: string; tab: Record<PackTab, string>;
  panelEmpty: string; seconds: (s: number) => string;
  openTemplate: string; addTitle: string; applyLook: string; applyCaption: string; addElement: string; addSound: string;
  motionNone: string; oneUndo: string; libraryNote: string;
  added: (what: string) => string; failed: string; working: string;
  noCaptionTrack: string; captionTrack: string; captionNeedsWords: string;
  titleFieldsNote: string; titleDatedNote: string;
  musicTitle: string; musicNote: string; musicUnheard: string; soundsTitle: string;
  lookNote: string;
  source: string;
  fields: {
    legend: string; label: Record<'name' | 'name2' | 'age' | 'night' | 'place' | 'when' | 'date', string>; atLighting: string; atLightingHint: string;
    candleGroup: string; clearCandle: string; candle: (n: number) => string; candleDerived: (n: number) => string; notHanukkah: string; candleNone: string;
    hebrewDate: string; hebrewDateAtEvening: (next: string) => string; invalidDate: string; tooLong: string; ageOnly: string;
  };
}
const he: PackStrings = {
  shelfTitle: 'חבילות',
  shelfIntro: 'חבילות מוכנות לחג ולאירוע: תבניות, כותרות, אלמנטים, מראה וצליל. הכול נוצר בתוכנה הזו ונשאר עריך.',
  shelfEmpty: 'אין עדיין חבילות בגרסה הזו.',
  templates: (n) => (n === 1 ? 'תבנית אחת' : `${n} תבניות`),
  elements: (n) => (n === 1 ? 'אלמנט אחד' : `${n} אלמנטים`),
  open: (name) => `פתיחת החבילה ${name}`,
  dismiss: 'לא עכשיו',
  dismissFor: (name) => `הסתרת ההצעה לחבילה ${name}`,
  suggestedLabel: 'מוצע לפי התאריך',
  back: 'חזרה לחבילות',
  tabsLabel: 'חלקי החבילה',
  tab: { templates: 'תבניות', titles: 'כותרות', elements: 'אלמנטים', looks: 'מראה', captions: 'כתוביות', sound: 'צליל' },
  panelEmpty: 'אין כאן עדיין פריטים.',
  seconds: (s) => `${s} ש׳`,
  openTemplate: 'פתיחת התבנית',
  addTitle: 'הוספת כותרת',
  motionNone: 'כותרת בלי תנועה (ללא הנפשה)',
  applyLook: 'החלת המראה',
  applyCaption: 'החלת הסגנון',
  addElement: 'הוספת אלמנט',
  addSound: 'הוספת צליל',
  oneUndo: 'כל הוספה היא פעולה אחת: ביטול אחד מחזיר אותה.',
  libraryNote: 'אלמנט או צליל נכנסים לספרייה ולציר הזמן. ביטול מסיר את הקליפ, והקובץ נשאר בספרייה.',
  added: (what) => `נוסף: ${what}`,
  failed: 'הפעולה לא הושלמה',
  working: 'מוסיף…',
  noCaptionTrack: 'אין רצועת כתוביות בפרויקט. אפשר ליצור כתוביות בלשונית הכתוביות.',
  captionTrack: 'רצועת כתוביות',
  captionNeedsWords: 'הסגנון מתאים לכתוביות עם תזמון מילים',
  titleFieldsNote: 'שדה ריק משאיר בכותרת את הנוסח החלופי שלה.',
  titleDatedNote: 'כותרת עם תאריך חי תציג את הנוסח החלופי שלה עד שיונחו תחתיה תמונות עם תאריך צילום.',
  musicTitle: 'מוזיקה מובנית שמתאימה',
  musicNote: 'מוסיפים מוזיקה מובנית מדפדפן המוזיקה או מתוך תבנית, באורך שנבחר.',
  musicUnheard: d.he['music.unheard'],
  soundsTitle: 'אפקטים קוליים',
  lookNote: 'המראה נכנס כשכבת התאמה על כל העריכה, ואפשר להסיר אותה בנפרד.',
  source: d.he['pack.source'],
  fields: {
    legend: d.he['pack.fields'],
    label: { name: d.he['pack.field.name'], name2: d.he['pack.field.name2'], age: d.he['pack.field.age'], night: d.he['pack.field.night'], place: d.he['pack.field.place'], when: d.he['pack.field.when'], date: d.he['pack.field.date'] },
    atLighting: d.he['pack.field.atLighting'],
    atLightingHint: 'כשהצילום בהדלקת הנרות, נחשב היום העברי שמתחיל באותו ערב.',
    candleGroup: 'מספר הנר',
    clearCandle: 'בלי נר',
    candle: (n) => `נר ${n}`,
    candleDerived: (n) => `חושב מהתאריך: נר ${n}`,
    notHanukkah: 'התאריך הזה אינו בחנוכה, ולכן הנר לא חושב. אפשר לבחור נר ידנית.',
    candleNone: 'בלי נר: הכותרת תציג את הנוסח החלופי שלה',
    hebrewDate: 'התאריך העברי',
    hebrewDateAtEvening: (next) => `בערב: ${next}`,
    invalidDate: 'תאריך לא תקין',
    tooLong: 'עד 80 תווים',
    ageOnly: 'ספרות בלבד',
  },
};
const en: PackStrings = {
  shelfTitle: 'Packs',
  shelfIntro: 'Ready-made packs for a holiday or an occasion: templates, titles, elements, looks and sounds. Everything is made in this program and stays editable.',
  shelfEmpty: 'There are no packs in this build yet.',
  templates: (n) => (n === 1 ? '1 template' : `${n} templates`),
  elements: (n) => (n === 1 ? '1 element' : `${n} elements`),
  open: (name) => `Open the ${name} pack`,
  dismiss: 'Not now',
  dismissFor: (name) => `Hide the suggestion of the ${name} pack`,
  suggestedLabel: 'Suggested for this date',
  back: 'Back to packs',
  tabsLabel: 'Parts of the pack',
  tab: { templates: 'Templates', titles: 'Titles', elements: 'Elements', looks: 'Looks', captions: 'Captions', sound: 'Sound' },
  panelEmpty: 'Nothing here yet.',
  seconds: (s) => `${s} s`,
  openTemplate: 'Open the template',
  addTitle: 'Add title',
  motionNone: 'Title without animation',
  applyLook: 'Apply the look',
  applyCaption: 'Apply the style',
  addElement: 'Add element',
  addSound: 'Add sound',
  oneUndo: 'Each addition is one action: one undo takes it back.',
  libraryNote: 'An element or a sound goes into the library and onto the timeline. Undo removes the clip and the file stays in the library.',
  added: (what) => `Added: ${what}`,
  failed: 'The action did not complete',
  working: 'Adding…',
  noCaptionTrack: 'The project has no caption track. Captions can be made in the Captions tab.',
  captionTrack: 'Caption track',
  captionNeedsWords: 'The style suits captions with word timing',
  titleFieldsNote: 'A field left empty leaves the title\'s fallback words.',
  titleDatedNote: 'A title with a live date shows its fallback words until pictures with a capture date lie under it.',
  musicTitle: 'Built-in music that suits it',
  musicNote: 'Add built-in music from the music browser or from inside a template, at the length you choose.',
  musicUnheard: d.en['music.unheard'],
  soundsTitle: 'Sound effects',
  lookNote: 'The look goes in as an adjustment layer over the whole edit, and it can be removed on its own.',
  source: d.en['pack.source'],
  fields: {
    legend: d.en['pack.fields'],
    label: { name: d.en['pack.field.name'], name2: d.en['pack.field.name2'], age: d.en['pack.field.age'], night: d.en['pack.field.night'], place: d.en['pack.field.place'], when: d.en['pack.field.when'], date: d.en['pack.field.date'] },
    atLighting: d.en['pack.field.atLighting'],
    atLightingHint: 'When it was filmed at the candle lighting, the Hebrew day that begins that evening counts.',
    candleGroup: 'Candle number',
    clearCandle: 'No candle',
    candle: (n) => `Candle ${n}`,
    candleDerived: (n) => `Worked out from the date: candle ${n}`,
    notHanukkah: 'This date is not in Hanukkah, so no candle is worked out. A candle can be chosen by hand.',
    candleNone: 'No candle: the title shows its fallback words',
    hebrewDate: 'Hebrew date',
    hebrewDateAtEvening: (next) => `In the evening: ${next}`,
    invalidDate: 'Not a valid date',
    tooLong: 'Up to 80 characters',
    ageOnly: 'Digits only',
  },
};
export const PACK_STRINGS = { he, en } as const;
/** The i18n keys this file leans on (a test keeps them present). */
export const PACK_I18N_KEYS: readonly Key[] = ['pack.fields', 'pack.field.name', 'pack.field.name2', 'pack.field.age', 'pack.field.night', 'pack.field.place', 'pack.field.when', 'pack.field.date', 'pack.field.atLighting', 'pack.source', 'music.unheard'];
