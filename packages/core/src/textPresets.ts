/**
 * Named text styles (SPEC Appendix A: text presets). A preset is ordinary data: font, weight, size, colours, optional box and
 * outline, and optionally a drop shadow or glow (the Canvas2D `stylize.shadow` effect, so presets need no graphics adapter).
 * Applying one keeps the text, its position, alignment and direction; every value stays editable afterwards.
 * Only the bundled fonts are used. The styles were written from descriptions; nobody has judged them on a video yet.
 */
import type { TextLookField, TextStyle } from './schema.ts';

/**
 * A preset owns the look fields (ADR-0012, schema.ts TEXT_LOOK_FIELDS): apply_text_preset clears every look field of the
 * title and then sets the ones the preset lists, so a look from an earlier preset never survives.
 */
export interface TextPreset {
  id: string; name: { he: string; en: string };
  style: { fontFamily: string; fontWeight: number; sizeFrac: number; color: string; background: string | null; stroke: string | null; strokeFrac: number } & Partial<Pick<TextStyle, TextLookField>>;
  shadow: { color: string; opacity: number; blur: number; x: number; y: number } | null;
}
export const TEXT_PRESETS: readonly TextPreset[] = [
  { id: 'clean-white', name: { he: "לבן נקי", en: "Clean white" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.06, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'classic-outline', name: { he: "קלאסי עם קו מתאר", en: "Classic outline" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.06, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.08 }, shadow: null },
  { id: 'bold-shadow', name: { he: "מודגש עם צל", en: "Bold with shadow" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.07, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.7, blur: 0.012, x: 0.004, y: 0.004 } },
  { id: 'yellow-pop', name: { he: "צהוב בולט", en: "Yellow pop" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#FFE600', background: null, stroke: '#000000', strokeFrac: 0.1 }, shadow: null },
  { id: 'black-box', name: { he: "תיבה שחורה", en: "Black box" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#000000', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'white-box', name: { he: "תיבה לבנה", en: "White box" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.05, color: '#111111', background: '#FFFFFF', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'yellow-box', name: { he: "תיבה צהובה", en: "Yellow box" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.05, color: '#111111', background: '#FFE600', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'red-alert', name: { he: "אדום התראה", en: "Red alert" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#FFFFFF', background: '#E10600', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'news-lower', name: { he: "כותרת חדשות", en: "News lower third" }, style: { fontFamily: 'Assistant', fontWeight: 700, sizeFrac: 0.045, color: '#FFFFFF', background: '#0B3D91', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'subtitle-soft', name: { he: "כתובית רכה", en: "Soft subtitle" }, style: { fontFamily: 'Assistant', fontWeight: 400, sizeFrac: 0.045, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.85, blur: 0.008, x: 0, y: 0.002 } },
  { id: 'headline-serif', name: { he: "כותרת סריף", en: "Serif headline" }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 700, sizeFrac: 0.08, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.5, blur: 0.015, x: 0, y: 0.005 } },
  { id: 'elegant-serif', name: { he: "סריף אלגנטי", en: "Elegant serif" }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 400, sizeFrac: 0.06, color: '#F5E9D0', background: null, stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'book-quote', name: { he: "ציטוט", en: "Quote" }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 400, sizeFrac: 0.055, color: '#FFFFFF', background: '#1F1F1F', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'display-big', name: { he: "כותרת ענק", en: "Big display" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.11, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.06 }, shadow: null },
  { id: 'display-yellow', name: { he: "כותרת ענק צהובה", en: "Big yellow display" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.11, color: '#FFD400', background: null, stroke: '#000000', strokeFrac: 0.08 }, shadow: null },
  { id: 'neon-pink', name: { he: "ניאון ורוד", en: "Neon pink" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#FF4FD8', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#FF4FD8', opacity: 0.9, blur: 0.03, x: 0, y: 0 } },
  { id: 'neon-cyan', name: { he: "ניאון טורקיז", en: "Neon cyan" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#3DF5FF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#3DF5FF', opacity: 0.9, blur: 0.03, x: 0, y: 0 } },
  { id: 'neon-green', name: { he: "ניאון ירוק", en: "Neon green" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#5CFF6A', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#5CFF6A', opacity: 0.9, blur: 0.03, x: 0, y: 0 } },
  { id: 'gold', name: { he: "זהב", en: "Gold" }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 700, sizeFrac: 0.075, color: '#F2C94C', background: null, stroke: '#5C4300', strokeFrac: 0.05 }, shadow: { color: '#000000', opacity: 0.6, blur: 0.012, x: 0, y: 0.004 } },
  { id: 'comic', name: { he: "קומיקס", en: "Comic" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.08, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.16 }, shadow: null },
  { id: 'comic-yellow', name: { he: "קומיקס צהוב", en: "Comic yellow" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.08, color: '#FFE600', background: null, stroke: '#000000', strokeFrac: 0.16 }, shadow: null },
  { id: 'sticker-white', name: { he: "מדבקה לבנה", en: "White sticker" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#111111', background: null, stroke: '#FFFFFF', strokeFrac: 0.3 }, shadow: null },
  { id: 'sticker-black', name: { he: "מדבקה שחורה", en: "Black sticker" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.3 }, shadow: null },
  { id: 'minimal-small', name: { he: "מינימלי קטן", en: "Minimal small" }, style: { fontFamily: 'Assistant', fontWeight: 400, sizeFrac: 0.035, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'minimal-grey', name: { he: "מינימלי אפור", en: "Minimal grey" }, style: { fontFamily: 'Assistant', fontWeight: 400, sizeFrac: 0.04, color: '#D0D0D0', background: null, stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'caption-tiktok', name: { he: "כתובית רשתות", en: "Social caption" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.055, color: '#FFFFFF', background: null, stroke: '#000000', strokeFrac: 0.14 }, shadow: null },
  { id: 'caption-highlight', name: { he: "כתובית מודגשת", en: "Highlighted caption" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.055, color: '#111111', background: '#3DF5FF', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'pink-box', name: { he: "תיבה ורודה", en: "Pink box" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#E0218A', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'green-box', name: { he: "תיבה ירוקה", en: "Green box" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#128A3A', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'purple-box', name: { he: "תיבה סגולה", en: "Purple box" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.05, color: '#FFFFFF', background: '#5B2BE0', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'orange-pop', name: { he: "כתום בולט", en: "Orange pop" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.07, color: '#FF8A00', background: null, stroke: '#2B1400', strokeFrac: 0.08 }, shadow: null },
  { id: 'sky', name: { he: "תכלת", en: "Sky" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.065, color: '#9ADFFF', background: null, stroke: '#06324A', strokeFrac: 0.07 }, shadow: null },
  { id: 'mint', name: { he: "מנטה", en: "Mint" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.065, color: '#A8F5D0', background: null, stroke: '#083D2A', strokeFrac: 0.07 }, shadow: null },
  { id: 'rose-gold', name: { he: "רוז גולד", en: "Rose gold" }, style: { fontFamily: 'Frank Ruhl Libre', fontWeight: 700, sizeFrac: 0.07, color: '#F4B6A6', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.5, blur: 0.012, x: 0, y: 0.004 } },
  { id: 'title-card', name: { he: "שקופית פתיחה", en: "Title card" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.09, color: '#111111', background: '#FFFFFF', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'end-card', name: { he: "שקופית סיום", en: "End card" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.07, color: '#FFFFFF', background: '#111111', stroke: null, strokeFrac: 0 }, shadow: null },
  { id: 'price-tag', name: { he: "תג מחיר", en: "Price tag" }, style: { fontFamily: 'Rubik', fontWeight: 700, sizeFrac: 0.08, color: '#FFFFFF', background: '#E10600', stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.5, blur: 0.01, x: 0.003, y: 0.003 } },
  { id: 'whisper', name: { he: "לחישה", en: "Whisper" }, style: { fontFamily: 'Assistant', fontWeight: 400, sizeFrac: 0.04, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 }, shadow: { color: '#000000', opacity: 0.6, blur: 0.02, x: 0, y: 0 } },
  { id: 'retro', name: { he: "רטרו", en: "Retro" }, style: { fontFamily: 'Secular One', fontWeight: 400, sizeFrac: 0.085, color: '#FFB703', background: null, stroke: '#6A040F', strokeFrac: 0.1 }, shadow: { color: '#6A040F', opacity: 0.9, blur: 0.0, x: 0.006, y: 0.006 } },
  { id: 'ghost', name: { he: "שקוף למחצה", en: "Ghost outline" }, style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac: 0.08, color: '#FFFFFF', background: null, stroke: '#FFFFFF', strokeFrac: 0.02 }, shadow: { color: '#000000', opacity: 0.4, blur: 0.02, x: 0, y: 0 } },
];
export const findTextPreset = (id: string) => TEXT_PRESETS.find((p) => p.id === id);
