/**
 * Named colour looks (SPEC Appendix A: colour looks). Each is a parameter set of the single `color.grade` pass, so a look is
 * ordinary, editable effect data: applying one sets the clip's colour grade, and every value can be changed afterwards.
 * The values were chosen by description, not graded against reference pictures: nobody has judged them on real footage yet.
 */
import { effectParams } from './effects.ts';

export interface ColorLook { id: string; name: { he: string; en: string }; params: { exposure: number; temperature: number; tint: number; contrast: number; saturation: number; shadows: number; highlights: number; fade: number } }
export const COLOR_LOOKS: readonly ColorLook[] = [
  { id: 'natural-pop', name: { he: "טבעי מודגש", en: "Natural pop" }, params: { exposure: 0.05, temperature: 0.05, tint: 0, contrast: 1.12, saturation: 1.15, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'warm-sun', name: { he: "שמש חמה", en: "Warm sun" }, params: { exposure: 0.1, temperature: 0.45, tint: 0.05, contrast: 1.05, saturation: 1.1, shadows: -0.2, highlights: 0.4, fade: 0 } },
  { id: 'golden-hour', name: { he: "שעת הזהב", en: "Golden hour" }, params: { exposure: 0.12, temperature: 0.6, tint: 0.1, contrast: 1.08, saturation: 1.15, shadows: -0.3, highlights: 0.6, fade: 0.05 } },
  { id: 'cool-morning', name: { he: "בוקר קריר", en: "Cool morning" }, params: { exposure: 0.05, temperature: -0.4, tint: -0.05, contrast: 1.05, saturation: 0.95, shadows: 0.3, highlights: -0.2, fade: 0 } },
  { id: 'ice', name: { he: "קרח", en: "Ice" }, params: { exposure: 0.1, temperature: -0.7, tint: -0.1, contrast: 1.1, saturation: 0.8, shadows: 0.5, highlights: -0.4, fade: 0.05 } },
  { id: 'teal-orange', name: { he: "טורקיז וכתום", en: "Teal & orange" }, params: { exposure: 0, temperature: 0.1, tint: 0, contrast: 1.15, saturation: 1.15, shadows: 0.8, highlights: 0.7, fade: 0 } },
  { id: 'blockbuster', name: { he: "קולנועי", en: "Blockbuster" }, params: { exposure: -0.05, temperature: 0.05, tint: 0, contrast: 1.25, saturation: 1.05, shadows: 1, highlights: 0.5, fade: 0 } },
  { id: 'faded-film', name: { he: "פילם דהוי", en: "Faded film" }, params: { exposure: 0.05, temperature: 0.1, tint: 0.05, contrast: 0.9, saturation: 0.85, shadows: 0.2, highlights: 0.2, fade: 0.6 } },
  { id: 'vintage', name: { he: "וינטג'", en: "Vintage" }, params: { exposure: 0.05, temperature: 0.35, tint: 0.1, contrast: 0.92, saturation: 0.75, shadows: -0.3, highlights: 0.3, fade: 0.45 } },
  { id: 'retro-70s', name: { he: "רטרו שנות ה־70", en: "Retro 70s" }, params: { exposure: 0.08, temperature: 0.5, tint: 0.15, contrast: 0.95, saturation: 0.9, shadows: -0.5, highlights: 0.5, fade: 0.35 } },
  { id: 'polaroid', name: { he: "פולארויד", en: "Polaroid" }, params: { exposure: 0.15, temperature: 0.2, tint: -0.1, contrast: 0.88, saturation: 0.9, shadows: 0.3, highlights: 0.1, fade: 0.5 } },
  { id: 'noir', name: { he: "נואר", en: "Noir" }, params: { exposure: -0.05, temperature: 0, tint: 0, contrast: 1.4, saturation: 0, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'soft-bw', name: { he: "שחור־לבן רך", en: "Soft black & white" }, params: { exposure: 0.1, temperature: 0, tint: 0, contrast: 0.9, saturation: 0, shadows: 0, highlights: 0, fade: 0.3 } },
  { id: 'high-contrast-bw', name: { he: "שחור־לבן חד", en: "High-contrast black & white" }, params: { exposure: 0, temperature: 0, tint: 0, contrast: 1.7, saturation: 0, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'sepia-tone', name: { he: "חום ישן", en: "Sepia tone" }, params: { exposure: 0.05, temperature: 0.8, tint: 0.1, contrast: 1, saturation: 0.25, shadows: -0.4, highlights: 0.4, fade: 0.2 } },
  { id: 'vivid', name: { he: "חי וצבעוני", en: "Vivid" }, params: { exposure: 0.05, temperature: 0, tint: 0, contrast: 1.2, saturation: 1.5, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'candy', name: { he: "סוכרייה", en: "Candy" }, params: { exposure: 0.15, temperature: 0.1, tint: 0.2, contrast: 1.05, saturation: 1.6, shadows: 0.2, highlights: 0.2, fade: 0.1 } },
  { id: 'pastel', name: { he: "פסטל", en: "Pastel" }, params: { exposure: 0.25, temperature: 0.05, tint: 0.05, contrast: 0.8, saturation: 0.8, shadows: 0.1, highlights: 0.1, fade: 0.45 } },
  { id: 'matte', name: { he: "מט", en: "Matte" }, params: { exposure: 0, temperature: 0, tint: 0, contrast: 0.92, saturation: 0.9, shadows: 0, highlights: 0, fade: 0.5 } },
  { id: 'moody', name: { he: "אפלולי", en: "Moody" }, params: { exposure: -0.25, temperature: -0.1, tint: 0, contrast: 1.2, saturation: 0.8, shadows: 0.5, highlights: -0.1, fade: 0.1 } },
  { id: 'night-blue', name: { he: "כחול לילה", en: "Night blue" }, params: { exposure: -0.3, temperature: -0.6, tint: 0, contrast: 1.15, saturation: 0.8, shadows: 0.8, highlights: -0.5, fade: 0 } },
  { id: 'neon-night', name: { he: "לילה ניאון", en: "Neon night" }, params: { exposure: -0.1, temperature: -0.2, tint: 0.35, contrast: 1.3, saturation: 1.5, shadows: 0.6, highlights: -0.3, fade: 0 } },
  { id: 'cyber', name: { he: "סייבר", en: "Cyber" }, params: { exposure: -0.05, temperature: -0.3, tint: 0.4, contrast: 1.25, saturation: 1.3, shadows: 1, highlights: -0.6, fade: 0 } },
  { id: 'forest', name: { he: "יער", en: "Forest" }, params: { exposure: -0.05, temperature: -0.05, tint: -0.45, contrast: 1.1, saturation: 1.1, shadows: 0.2, highlights: 0.1, fade: 0.05 } },
  { id: 'desert', name: { he: "מדבר", en: "Desert" }, params: { exposure: 0.1, temperature: 0.55, tint: 0.05, contrast: 1.1, saturation: 0.9, shadows: -0.6, highlights: 0.5, fade: 0.1 } },
  { id: 'ocean', name: { he: "אוקיינוס", en: "Ocean" }, params: { exposure: 0, temperature: -0.35, tint: -0.1, contrast: 1.1, saturation: 1.15, shadows: 0.9, highlights: -0.2, fade: 0 } },
  { id: 'sunset', name: { he: "שקיעה", en: "Sunset" }, params: { exposure: 0, temperature: 0.5, tint: 0.3, contrast: 1.15, saturation: 1.25, shadows: -0.2, highlights: 0.8, fade: 0 } },
  { id: 'rose', name: { he: "ורוד רך", en: "Rose" }, params: { exposure: 0.1, temperature: 0.15, tint: 0.5, contrast: 0.98, saturation: 1.05, shadows: -0.1, highlights: 0.2, fade: 0.2 } },
  { id: 'clean-bright', name: { he: "נקי ובהיר", en: "Clean & bright" }, params: { exposure: 0.3, temperature: 0, tint: 0, contrast: 1.05, saturation: 1.05, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'airy', name: { he: "אוורירי", en: "Airy" }, params: { exposure: 0.35, temperature: -0.05, tint: 0, contrast: 0.85, saturation: 0.9, shadows: 0.1, highlights: -0.1, fade: 0.3 } },
  { id: 'deep-shadows', name: { he: "צללים עמוקים", en: "Deep shadows" }, params: { exposure: -0.15, temperature: 0, tint: 0, contrast: 1.45, saturation: 1.05, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'bleach', name: { he: "הלבנה", en: "Bleach bypass" }, params: { exposure: 0, temperature: 0, tint: 0, contrast: 1.5, saturation: 0.45, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'cross-process', name: { he: "עיבוד מוצלב", en: "Cross process" }, params: { exposure: 0.05, temperature: 0.1, tint: -0.35, contrast: 1.25, saturation: 1.3, shadows: 1, highlights: 0.9, fade: 0 } },
  { id: 'lomo', name: { he: "לומו", en: "Lomo" }, params: { exposure: 0, temperature: 0.15, tint: -0.1, contrast: 1.35, saturation: 1.4, shadows: 0.5, highlights: 0.3, fade: 0 } },
  { id: 'documentary', name: { he: "דוקומנטרי", en: "Documentary" }, params: { exposure: 0, temperature: 0.05, tint: 0, contrast: 1.08, saturation: 0.85, shadows: 0.1, highlights: 0, fade: 0.1 } },
  { id: 'skin-warm', name: { he: "עור חמים", en: "Warm skin" }, params: { exposure: 0.08, temperature: 0.25, tint: 0.1, contrast: 1.02, saturation: 1.05, shadows: -0.1, highlights: 0.2, fade: 0 } },
  { id: 'food', name: { he: "אוכל", en: "Food" }, params: { exposure: 0.12, temperature: 0.2, tint: 0.05, contrast: 1.12, saturation: 1.3, shadows: -0.1, highlights: 0.3, fade: 0 } },
  { id: 'product-crisp', name: { he: "מוצר חד", en: "Crisp product" }, params: { exposure: 0.15, temperature: -0.05, tint: 0, contrast: 1.22, saturation: 1.1, shadows: 0, highlights: 0, fade: 0 } },
  { id: 'gaming', name: { he: "גיימינג", en: "Gaming" }, params: { exposure: 0, temperature: -0.15, tint: 0.15, contrast: 1.3, saturation: 1.45, shadows: 0.5, highlights: -0.2, fade: 0 } },
  { id: 'dream', name: { he: "חלום", en: "Dream" }, params: { exposure: 0.2, temperature: 0.1, tint: 0.2, contrast: 0.82, saturation: 1.1, shadows: 0.3, highlights: 0.3, fade: 0.35 } },
];
export const findLook = (id: string) => COLOR_LOOKS.find((l) => l.id === id);
/** The complete, validated `color.grade` parameters of a look. */
export const lookParams = (id: string) => { const l = findLook(id); return l ? effectParams('color.grade', l.params) : undefined; };
