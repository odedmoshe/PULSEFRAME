/**
 * Display names for effect parameters and their options, in both interface languages.
 * The registry (packages/core/src/effects.ts) keeps English keys; these are what a person reads in the panel.
 * A test (packages/evals/src/effect-param-labels.test.ts) fails when a registered parameter or option has no name here.
 */
type L = { he: string; en: string };
export const EFFECT_PARAM_LABELS: Record<string, L> = {
  brightness: { he: 'בהירות', en: 'Brightness' }, contrast: { he: 'ניגודיות', en: 'Contrast' }, saturation: { he: 'רוויה', en: 'Saturation' }, hue: { he: 'גוון (מעלות)', en: 'Hue (degrees)' },
  amount: { he: 'עוצמה', en: 'Amount' }, color: { he: 'צבע', en: 'Colour' }, mode: { he: 'אופן שילוב', en: 'Blend mode' }, radius: { he: 'רדיוס', en: 'Radius' }, size: { he: 'גודל המרכז', en: 'Centre size' },
  opacity: { he: 'אטימות', en: 'Opacity' }, blur: { he: 'ריכוך', en: 'Softness' }, x: { he: 'מיקום אופקי', en: 'Horizontal position' }, y: { he: 'מיקום אנכי', en: 'Vertical position' }, seed: { he: 'זרע אקראיות', en: 'Random seed' },
  angle: { he: 'זווית (מעלות)', en: 'Angle (degrees)' }, tolerance: { he: 'סבילות', en: 'Tolerance' }, softness: { he: 'ריכוך הקצה', en: 'Edge softness' }, spill: { he: 'ניקוי שאריות צבע', en: 'Spill removal' },
  amplitude: { he: 'גובה הגל', en: 'Wave height' }, wavelength: { he: 'אורך הגל', en: 'Wave length' }, phase: { he: 'היסט (מעלות)', en: 'Phase (degrees)' }, speed: { he: 'מהירות (לשנייה)', en: 'Speed (per second)' },
  direction: { he: 'כיוון התזוזה', en: 'Direction of movement' }, keep: { he: 'החצי שנשמר', en: 'Half that is kept' }, levels: { he: 'מספר רמות', en: 'Levels' }, strength: { he: 'רגישות', en: 'Sensitivity' },
  bands: { he: 'מספר פסים', en: 'Bands' }, density: { he: 'שיעור הפסים שקופצים', en: 'Share of bands that jump' }, split: { he: 'פיצול צבעים', en: 'Colour split' },
};
export const EFFECT_OPTION_LABELS: Record<string, L> = {
  color: { he: 'צבע', en: 'Colour' }, multiply: { he: 'הכפלה', en: 'Multiply' }, screen: { he: 'מסך', en: 'Screen' }, overlay: { he: 'שכבת־על', en: 'Overlay' }, 'soft-light': { he: 'אור רך', en: 'Soft light' },
  horizontal: { he: 'אופקי', en: 'Horizontal' }, vertical: { he: 'אנכי', en: 'Vertical' }, left: { he: 'שמאל', en: 'Left' }, right: { he: 'ימין', en: 'Right' }, top: { he: 'עליון', en: 'Top' }, bottom: { he: 'תחתון', en: 'Bottom' },
};
/** The name to show for a parameter; the key itself when none is registered (never an empty label). */
export const effectParamLabel = (name: string, lang: 'he' | 'en') => EFFECT_PARAM_LABELS[name]?.[lang] ?? name;
export const effectOptionLabel = (value: string, lang: 'he' | 'en') => EFFECT_OPTION_LABELS[value]?.[lang] ?? value;
