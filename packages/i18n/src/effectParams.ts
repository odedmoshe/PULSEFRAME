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
  exposure: { he: 'חשיפה (סטופים)', en: 'Exposure (stops)' }, temperature: { he: 'טמפרטורת צבע', en: 'Temperature' }, tint: { he: 'גוון ירוק–מגנטה', en: 'Tint' }, shadows: { he: 'צבע הצללים', en: 'Shadow colour' }, highlights: { he: 'צבע האורות', en: 'Highlight colour' }, fade: { he: 'דהייה', en: 'Fade' },
  dark: { he: 'צבע הכהים', en: 'Dark colour' }, light: { he: 'צבע הבהירים', en: 'Light colour' }, lines: { he: 'מספר קווים', en: 'Lines' }, segments: { he: 'מספר פלחים', en: 'Segments' }, position: { he: 'גובה הרצועה החדה', en: 'Position of the sharp band' }, width: { he: 'רוחב הרצועה החדה', en: 'Width of the sharp band' }, threshold: { he: 'סף בהירות', en: 'Brightness threshold' },
  spacing: { he: 'מרחק בין נקודות', en: 'Dot spacing' },
  lut: { he: 'טבלת צבע', en: 'Colour table' }, intensity: { he: 'עוצמת הטבלה', en: 'Intensity' },
  bpm: { he: 'קצב (פעימות לדקה)', en: 'Tempo (beats per minute)' }, offset: { he: 'הזזת הפעימה', en: 'Beat offset' }, decay: { he: 'מהירות הדעיכה', en: 'Settling speed' }, rate: { he: 'קצב', en: 'Rate' }, zoom: { he: 'גודל', en: 'Size' }, length: { he: 'אורך הקרניים', en: 'Streak length' },
  follow: { he: 'מה מניע את האפקט', en: 'Driven by' }, every: { he: 'פגיעה כל כמה פעימות (בספירה מהתיבה הראשונה של המוזיקה)', en: 'Hit on every Nth beat (counted from the first bar of the music)' },
  bands: { he: 'מספר פסים', en: 'Bands' }, density: { he: 'שיעור הפסים שקופצים', en: 'Share of bands that jump' }, split: { he: 'פיצול צבעים', en: 'Colour split' },
};
export const EFFECT_OPTION_LABELS: Record<string, L> = {
  color: { he: 'צבע', en: 'Colour' }, multiply: { he: 'הכפלה', en: 'Multiply' }, screen: { he: 'מסך', en: 'Screen' }, overlay: { he: 'שכבת־על', en: 'Overlay' }, 'soft-light': { he: 'אור רך', en: 'Soft light' },
  steady: { he: 'קצב קבוע משלו', en: 'Its own steady tempo' }, music: { he: 'פעימות המוזיקה', en: 'The beats of the music' },
  horizontal: { he: 'אופקי', en: 'Horizontal' }, vertical: { he: 'אנכי', en: 'Vertical' }, left: { he: 'שמאל', en: 'Left' }, right: { he: 'ימין', en: 'Right' }, top: { he: 'עליון', en: 'Top' }, bottom: { he: 'תחתון', en: 'Bottom' },
};
/** The name to show for a parameter; the key itself when none is registered (never an empty label). */
export const effectParamLabel = (name: string, lang: 'he' | 'en') => EFFECT_PARAM_LABELS[name]?.[lang] ?? name;
export const effectOptionLabel = (value: string, lang: 'he' | 'en') => EFFECT_OPTION_LABELS[value]?.[lang] ?? value;

/** Stage words a job reports, as shown to a person. The counts after the word ("18/380") are kept as they are. */
const STAGE_WORDS: Record<string, { he: string; en: string }> = {
  preparing: { he: 'מכין', en: 'preparing' }, 'rendering audio': { he: 'מעבד את הקול', en: 'rendering the sound' }, 'rendering still': { he: 'מעבד תמונה', en: 'rendering a still' },
  rendering: { he: 'מעבד פריימים', en: 'rendering frames' }, encoding: { he: 'מקודד', en: 'encoding' }, validating: { he: 'בודק את הקובץ', en: 'checking the file' }, leased: { he: 'מתחיל', en: 'starting' },
  'recovered-after-restart': { he: 'ממשיך אחרי הפעלה מחדש', en: 'resuming after a restart' },
};
export function jobStageLabel(stage: string | null | undefined, lang: 'he' | 'en'): string {
  if (!stage) return '';
  const word = Object.keys(STAGE_WORDS).sort((a, b) => b.length - a.length).find((w) => stage === w || stage.startsWith(`${w} `));
  return word ? `${STAGE_WORDS[word]![lang]}${stage.slice(word.length).replace(' (browser)', '')}` : stage;
}
