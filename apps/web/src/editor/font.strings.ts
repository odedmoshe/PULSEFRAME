/**
 * Strings of the font picker (ADR-0022). Hebrew first; English covers the same keys (fontPicker.logic.test.ts checks it).
 * Category names, tags, the badge «ניקוד נבדק» and «מתאים עם» are the shared i18n entries (packages/i18n/src/packs.ts, font.*),
 * so the inspector and the picker say them in one voice.
 */
import { dictionaries } from '@pulseframe/i18n';

const d = dictionaries;
interface FontStrings {
  categories: string; all: string; list: string; weights: string; weight: Record<number, string>; weightOther: (w: number) => string;
  nikud: string; nikudTitle: string; pairsWith: string; pairsNone: string; pairUse: (family: string) => string; headingRole: string; bodyRole: string; noneInCategory: string;
  category: Record<'sans' | 'serif' | 'display' | 'handwriting', string>;
  tag: Record<'rounded' | 'classic' | 'condensed' | 'playful' | 'cursive' | 'bold', string>;
  optionLabel: (family: string, weight: number, nikud: boolean) => string;
}
const he: FontStrings = {
  categories: 'קטגוריות גופנים',
  all: 'הכול',
  list: 'גופנים',
  weights: 'עובי',
  weight: { 400: 'רגיל', 700: 'עבה' },
  weightOther: (w: number) => `עובי ${w}`,
  nikud: d.he['font.nikudChecked'],
  nikudTitle: 'ניקוד נבדק: האותיות והנקודות של הגופן נמדדו, והנקודות מוצבות מתחת לאות ומעליה',
  pairsWith: `${d.he['font.pairsWith']}…`,
  pairsNone: 'אין עדיין צמד מומלץ לגופן הזה.',
  pairUse: (family: string) => `בחירת ${family}`,
  headingRole: 'כותרת',
  bodyRole: 'טקסט',
  noneInCategory: 'אין גופנים בקטגוריה שנבחרה.',
  category: { sans: d.he['font.category.sans'], serif: d.he['font.category.serif'], display: d.he['font.category.display'], handwriting: d.he['font.category.handwriting'] },
  tag: { rounded: d.he['font.tag.rounded'], classic: d.he['font.tag.classic'], condensed: d.he['font.tag.condensed'], playful: d.he['font.tag.playful'], cursive: d.he['font.tag.cursive'], bold: d.he['font.tag.bold'] },
  optionLabel: (family: string, weight: number, nikud: boolean) => `${family}, עובי ${weight}${nikud ? ', ניקוד נבדק' : ''}`,
};
const en: FontStrings = {
  categories: 'Font categories',
  all: 'All',
  list: 'Fonts',
  weights: 'Weight',
  weight: { 400: 'Regular', 700: 'Bold' },
  weightOther: (w) => `Weight ${w}`,
  nikud: d.en['font.nikudChecked'],
  nikudTitle: 'Vowel points checked: the font\'s letters and points were measured, and the points sit under or over their letter',
  pairsWith: `${d.en['font.pairsWith']}…`,
  pairsNone: 'No pairing is recommended for this font yet.',
  pairUse: (family) => `Use ${family}`,
  headingRole: 'Heading',
  bodyRole: 'Body',
  noneInCategory: 'No fonts in the chosen category.',
  category: { sans: d.en['font.category.sans'], serif: d.en['font.category.serif'], display: d.en['font.category.display'], handwriting: d.en['font.category.handwriting'] },
  tag: { rounded: d.en['font.tag.rounded'], classic: d.en['font.tag.classic'], condensed: d.en['font.tag.condensed'], playful: d.en['font.tag.playful'], cursive: d.en['font.tag.cursive'], bold: d.en['font.tag.bold'] },
  optionLabel: (family, weight, nikud) => `${family}, weight ${weight}${nikud ? ', vowel points checked' : ''}`,
};
export const FONT_STRINGS = { he, en } as const;
