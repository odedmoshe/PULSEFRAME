/**
 * Ready-made caption looks: one tap sets the word-timing behaviour, font, colours, outline and placement together.
 * Only bundled fonts and weights (see fonts.ts) are used. Every look is readable on its own: light text sits on a dark
 * plate or a dark outline (or the reverse), and the highlight colour differs visibly from the base colour.
 * `direction` and `marginFrac` are left out on purpose, so they keep the user's value.
 */
import type { CaptionStyle } from './schema.ts';
import { PACKS } from './packs/index.ts';

export interface CaptionLook {
  id: string;
  name: { he: string; en: string };
  /** one line: what the viewer sees */
  hint: { he: string; en: string };
  /** fields of the caption style this look sets; fields it leaves out keep the track's current value */
  style: Partial<CaptionStyle>;
  /** true when the look needs word-level timing to show its effect */
  needsWordTiming: boolean;
}

type Family = 'Heebo' | 'Rubik' | 'Assistant' | 'Frank Ruhl Libre' | 'Secular One';
interface Spec {
  preset: CaptionStyle['preset'];
  font: Family;
  weight: 400 | 700;
  size: number;
  color: string;
  hl: string;
  bg: string | null;
  stroke: string | null;
  strokeFrac: number;
  position?: CaptionStyle['position'];
  lines?: number;
  chars?: number;
  entrance?: 'none' | 'fade' | 'pop';
}

const look = (slug: string, he: string, en: string, hintHe: string, hintEn: string, p: Spec): CaptionLook => {
  const style: Partial<CaptionStyle> = {
    preset: p.preset, fontFamily: p.font, fontWeight: p.weight, sizeFrac: p.size, color: p.color, highlightColor: p.hl,
    background: p.bg, stroke: p.stroke, strokeFrac: p.strokeFrac, position: p.position ?? 'bottom', maxLines: p.lines ?? 2, maxCharsPerLine: p.chars ?? 32,
  };
  if (p.entrance) style.wordEntrance = p.entrance;
  const needsWordTiming = p.preset !== 'classic' || (style.wordEntrance !== undefined && style.wordEntrance !== 'none');
  return { id: `caption.${slug}`, name: { he, en }, hint: { he: hintHe, en: hintEn }, style, needsWordTiming };
};

const W = '#FFFFFF', K = '#000000', Y = '#FFE600';
const PLATE = '#000000B3', PLATE_DEEP = '#000000E6';

/** The forty caption looks of this file. */
export const BUILTIN_CAPTION_LOOKS: readonly CaptionLook[] = [
  // clean subtitles
  look('clean-plate', 'כתובית נקייה על פס כהה', 'Clean on dark plate', 'טקסט לבן על פס שחור שקוף למחצה', 'White text on a translucent black plate',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.045, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  look('black-on-white', 'שחור על לבן', 'Black on white', 'טקסט שחור על פס לבן', 'Black text on a white plate',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.045, color: K, hl: '#E11D48', bg: '#FFFFFFEB', stroke: null, strokeFrac: 0.08 }),
  look('outline-only', 'מסגרת בלבד', 'Outline only', 'טקסט לבן עם קו מתאר שחור, בלי רקע', 'White text with a black outline, no plate',
    { preset: 'classic', font: 'Rubik', weight: 700, size: 0.05, color: W, hl: '#FF4FA3', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('documentary', 'דוקומנטרי, שתי שורות', 'Documentary, two lines', 'שתי שורות רחבות בכתב סריף על פס כהה', 'Two wide lines in serif on a dark plate',
    { preset: 'classic', font: 'Frank Ruhl Libre', weight: 400, size: 0.042, color: W, hl: '#F5B942', bg: PLATE, stroke: null, strokeFrac: 0.08, lines: 2, chars: 46 }),
  look('documentary-bold', 'דוקומנטרי מודגש', 'Documentary, bold serif', 'סריף עבה על פס כהה עמוק', 'Bold serif on a deep dark plate',
    { preset: 'classic', font: 'Frank Ruhl Libre', weight: 700, size: 0.046, color: W, hl: '#F5B942', bg: PLATE_DEEP, stroke: null, strokeFrac: 0.08, lines: 2, chars: 42 }),
  look('minimal-light', 'מינימלי ודק', 'Minimal, light weight', 'כתב דק וקטן עם מתאר עדין', 'Small light type with a thin outline',
    { preset: 'classic', font: 'Assistant', weight: 400, size: 0.036, color: W, hl: '#3DE0C8', bg: null, stroke: K, strokeFrac: 0.07, chars: 38 }),
  look('top-banner', 'בראש המסך', 'Top of frame', 'כתובית בחלק העליון על פס כהה', 'Caption at the top on a dark plate',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.042, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08, position: 'top' }),
  look('quote-center', 'ציטוט במרכז', 'Centred quote', 'טקסט גדול במרכז המסך, עד שלוש שורות', 'Large text in the middle, up to three lines',
    { preset: 'classic', font: 'Frank Ruhl Libre', weight: 700, size: 0.07, color: W, hl: '#F5B942', bg: null, stroke: K, strokeFrac: 0.09, position: 'center', lines: 3, chars: 22 }),
  look('quote-plate', 'ציטוט על לוח', 'Quote on a plate', 'טקסט גדול במרכז על לוח כהה', 'Large centred text on a dark plate',
    { preset: 'classic', font: 'Assistant', weight: 700, size: 0.064, color: W, hl: '#3DE0C8', bg: PLATE_DEEP, stroke: null, strokeFrac: 0.08, position: 'center', lines: 3, chars: 24 }),
  look('fade-in', 'כניסה עדינה', 'Soft fade-in', 'כל מילה מתגלה בהדרגה', 'Each word fades in as it is spoken',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.046, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08, entrance: 'fade' }),
  // accessibility
  look('access-yellow-black', 'נגיש: צהוב על שחור', 'Accessible, yellow on black', 'צהוב בולט על פס שחור כמעט אטום', 'Bold yellow on a near-opaque black plate',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.055, color: Y, hl: W, bg: '#000000F2', stroke: null, strokeFrac: 0.08 }),
  look('access-white-black', 'נגיש: לבן על שחור', 'Accessible, white on black', 'לבן על שחור מלא, ניגודיות מרבית', 'White on solid black for maximum contrast',
    { preset: 'classic', font: 'Assistant', weight: 700, size: 0.055, color: W, hl: Y, bg: '#000000FF', stroke: null, strokeFrac: 0.08 }),
  look('access-large', 'נגיש: גדול במיוחד', 'Accessible, extra large', 'כתב גדול מאוד, שלוש שורות קצרות', 'Very large type, three short lines',
    { preset: 'classic', font: 'Rubik', weight: 700, size: 0.075, color: Y, hl: W, bg: '#000000F2', stroke: null, strokeFrac: 0.08, lines: 3, chars: 20 }),
  look('access-outline', 'נגיש: מתאר עבה', 'Accessible, heavy outline', 'צהוב עם מתאר שחור עבה, בלי רקע', 'Yellow with a heavy black outline, no plate',
    { preset: 'classic', font: 'Heebo', weight: 700, size: 0.06, color: Y, hl: W, bg: null, stroke: K, strokeFrac: 0.14 }),
  // karaoke sweeps
  look('karaoke-yellow', 'קריוקי צהוב', 'Karaoke yellow', 'המילים הנאמרות נצבעות בזהב', 'Spoken words turn gold',
    { preset: 'karaoke', font: 'Heebo', weight: 700, size: 0.05, color: W, hl: '#FFC400', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('karaoke-green', 'קריוקי ירוק', 'Karaoke green', 'המילים הנאמרות נצבעות בירוק', 'Spoken words turn green',
    { preset: 'karaoke', font: 'Rubik', weight: 700, size: 0.05, color: W, hl: '#00C853', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('karaoke-pink', 'קריוקי ורוד', 'Karaoke pink', 'המילים הנאמרות נצבעות בוורוד', 'Spoken words turn pink',
    { preset: 'karaoke', font: 'Rubik', weight: 700, size: 0.05, color: W, hl: '#FF4FA3', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  look('karaoke-cyan', 'קריוקי תכלת', 'Karaoke cyan', 'המילים הנאמרות נצבעות בתכלת', 'Spoken words turn cyan',
    { preset: 'karaoke', font: 'Assistant', weight: 700, size: 0.05, color: W, hl: '#00B8D4', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('karaoke-orange', 'קריוקי כתום', 'Karaoke orange', 'המילים הנאמרות נצבעות בכתום', 'Spoken words turn orange',
    { preset: 'karaoke', font: 'Secular One', weight: 400, size: 0.052, color: W, hl: '#FF8A00', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('karaoke-plate', 'קריוקי על פס', 'Karaoke on plate', 'צבע טורקיז על פס כהה', 'Turquoise sweep on a dark plate',
    { preset: 'karaoke', font: 'Heebo', weight: 700, size: 0.046, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08, entrance: 'fade' }),
  // the one karaoke look in dark ink on a light plate: serif type on warm paper, the spoken word in crimson (also legible on the plate)
  look('karaoke-paper', 'קריוקי על נייר', 'Karaoke on paper', 'דיו כהה בכתב סריף על פס בהיר, המילה הנאמרת באדום', 'Dark serif ink on a light paper plate; the spoken word turns crimson',
    { preset: 'karaoke', font: 'Frank Ruhl Libre', weight: 700, size: 0.048, color: '#1C1A17', hl: '#C8102E', bg: '#FFF8E7EB', stroke: null, strokeFrac: 0.08, chars: 30 }),
  // word pop
  look('pop-heavy', 'מילה אחר מילה, מודגש', 'One word at a time, heavy', 'מילה גדולה אחת, עם קפיצה קלה', 'One large word, with a small pop',
    { preset: 'word-pop', font: 'Secular One', weight: 400, size: 0.09, color: W, hl: '#FFC400', bg: null, stroke: K, strokeFrac: 0.16, position: 'center', lines: 1, chars: 12, entrance: 'pop' }),
  look('pop-yellow', 'מילה בודדת צהובה', 'Single word, yellow', 'מילה צהובה גדולה עם מתאר שחור עבה', 'Big yellow word with a thick black outline',
    { preset: 'word-pop', font: 'Heebo', weight: 700, size: 0.085, color: Y, hl: '#FF4FA3', bg: null, stroke: K, strokeFrac: 0.15, position: 'center', lines: 1, chars: 12, entrance: 'pop' }),
  look('pop-white-box', 'מילה בודדת על לוח', 'Single word on plate', 'מילה לבנה גדולה על לוח כהה', 'Big white word on a dark plate',
    { preset: 'word-pop', font: 'Rubik', weight: 700, size: 0.08, color: W, hl: '#FF4FA3', bg: PLATE_DEEP, stroke: null, strokeFrac: 0.08, position: 'center', lines: 1, chars: 12, entrance: 'pop' }),
  look('pop-lower', 'מילה בודדת למטה', 'Single word, lower third', 'מילה אחת בתחתית המסך, כניסה רכה', 'One word near the bottom, soft entrance',
    { preset: 'word-pop', font: 'Assistant', weight: 700, size: 0.07, color: W, hl: '#3DE0C8', bg: null, stroke: K, strokeFrac: 0.13, lines: 1, chars: 14, entrance: 'fade' }),
  look('pop-green', 'מילה בודדת ירוקה', 'Single word, green', 'מילה ירוקה זוהרת, קפיצה בכל מילה', 'Bright green word, pops with each word',
    { preset: 'word-pop', font: 'Rubik', weight: 700, size: 0.085, color: '#7CFF6B', hl: '#FF4FA3', bg: null, stroke: K, strokeFrac: 0.15, position: 'center', lines: 1, chars: 12, entrance: 'pop' }),
  // box highlight
  look('box-marker', 'סימון במרקר', 'Highlighter marker', 'מרקר צהוב על המילה הנאמרת', 'Yellow marker behind the spoken word',
    { preset: 'box-highlight', font: 'Heebo', weight: 700, size: 0.048, color: K, hl: Y, bg: null, stroke: W, strokeFrac: 0.07 }),
  look('box-red', 'לוח אדום, טקסט לבן', 'Red box, white text', 'לוח אדום מאחורי המילה הנאמרת', 'Red box behind the spoken word',
    { preset: 'box-highlight', font: 'Rubik', weight: 700, size: 0.048, color: W, hl: '#D90429', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('box-turquoise', 'לוח טורקיז', 'Brand turquoise box', 'לוח טורקיז מאחורי המילה הנאמרת', 'Turquoise box behind the spoken word',
    { preset: 'box-highlight', font: 'Heebo', weight: 700, size: 0.048, color: K, hl: '#3DE0C8', bg: null, stroke: W, strokeFrac: 0.07, entrance: 'fade' }),
  look('box-pink', 'לוח ורוד', 'Pink box', 'לוח ורוד בוהק על המילה הנאמרת', 'Hot pink box on the spoken word',
    { preset: 'box-highlight', font: 'Secular One', weight: 400, size: 0.05, color: W, hl: '#E5006E', bg: null, stroke: K, strokeFrac: 0.1, entrance: 'pop' }),
  look('box-dark-plate', 'לוח על פס כהה', 'Box over dark plate', 'לוח אדום כהה על המילה, מעל פס כהה', 'Dark red word box over a dark plate',
    { preset: 'box-highlight', font: 'Assistant', weight: 700, size: 0.046, color: W, hl: '#B00020', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  // reveal
  look('reveal-type', 'מכונת כתיבה', 'Typewriter reveal', 'מילים מופיעות בזו אחר זו, בלי לזוז', 'Words appear one after another, without the line moving',
    { preset: 'reveal', font: 'Heebo', weight: 700, size: 0.046, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  look('reveal-outline', 'חשיפה עם מתאר', 'Reveal, outlined', 'מילים נחשפות עם מתאר שחור', 'Words appear with a black outline',
    { preset: 'reveal', font: 'Rubik', weight: 700, size: 0.05, color: W, hl: '#FF4FA3', bg: null, stroke: K, strokeFrac: 0.1, entrance: 'fade' }),
  look('reveal-serif', 'חשיפה בסריף', 'Reveal, serif', 'חשיפה איטית בכתב סריף על פס כהה', 'Slow serif reveal on a dark plate',
    { preset: 'reveal', font: 'Frank Ruhl Libre', weight: 700, size: 0.05, color: W, hl: '#F5B942', bg: PLATE_DEEP, stroke: null, strokeFrac: 0.08, entrance: 'fade' }),
  // underline
  look('underline-turquoise', 'קו תחתון טורקיז', 'Turquoise underline', 'פס טורקיז מתחת למילה הנאמרת', 'Turquoise bar under the spoken word',
    { preset: 'underline', font: 'Heebo', weight: 700, size: 0.046, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  look('underline-yellow', 'קו תחתון צהוב', 'Yellow underline', 'פס צהוב מתחת למילה, בלי רקע', 'Yellow bar under the word, no plate',
    { preset: 'underline', font: 'Rubik', weight: 700, size: 0.05, color: W, hl: '#FFC400', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('underline-light', 'קו תחתון עדין', 'Light underline', 'כתב דק עם קו תחתון אדום', 'Light type with a red underline',
    { preset: 'underline', font: 'Assistant', weight: 400, size: 0.04, color: W, hl: '#FF4D4D', bg: null, stroke: K, strokeFrac: 0.08, entrance: 'fade' }),
  // dim ahead
  look('dim-ahead-plate', 'מילים עמומות מראש', 'Dim ahead', 'מילים שטרם נאמרו עמומות', 'Words not yet spoken are faint',
    { preset: 'dim-ahead', font: 'Heebo', weight: 700, size: 0.048, color: W, hl: '#3DE0C8', bg: PLATE, stroke: null, strokeFrac: 0.08 }),
  look('dim-ahead-outline', 'עמום עם מתאר', 'Dim ahead, outlined', 'מילים עתידיות עמומות, מתאר שחור', 'Upcoming words faint, black outline',
    { preset: 'dim-ahead', font: 'Rubik', weight: 700, size: 0.052, color: W, hl: '#FFC400', bg: null, stroke: K, strokeFrac: 0.1 }),
  look('dim-ahead-center', 'עמום במרכז', 'Dim ahead, centred', 'שלוש שורות במרכז, מילים עתידיות עמומות', 'Three centred lines, upcoming words faint',
    { preset: 'dim-ahead', font: 'Assistant', weight: 700, size: 0.06, color: W, hl: '#FF4FA3', bg: null, stroke: K, strokeFrac: 0.11, position: 'center', lines: 3, chars: 24, entrance: 'fade' }),
];

/** Every caption look of the build: the built-ins, then the looks the content packs bring (ADR-0022; packs/index.ts), in pack order. */
export const CAPTION_LOOKS: readonly CaptionLook[] = [...BUILTIN_CAPTION_LOOKS, ...PACKS.flatMap((p) => p.captionLooks)];
export const CAPTION_LOOK_IDS = CAPTION_LOOKS.map((l) => l.id) as [string, ...string[]];
export const findCaptionLook = (id: string): CaptionLook | undefined => CAPTION_LOOKS.find((l) => l.id === id);
