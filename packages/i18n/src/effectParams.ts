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
  // time effects
  count: { he: 'מספר התמונות', en: 'Pictures' }, delay: { he: 'מרווח בין התמונות (פריימים)', en: 'Frames between pictures' }, lag: { he: 'פער בין הצבעים (פריימים)', en: 'Frames between the colours' },
  order: { he: 'סדר הצבעים', en: 'Colour order' }, samples: { he: 'מספר הדגימות', en: 'Samples' }, timing: { he: 'תזמון הצמצם', en: 'Shutter timing' },
  hold: { he: 'פריימים לכל תמונה', en: 'Frames per picture' }, pattern: { he: 'דפוס', en: 'Pattern' }, motion: { he: 'תנועה מהעורך', en: 'Movement made in the editor' },
  // overlays
  wind: { he: 'רוח', en: 'Wind' }, area: { he: 'אזור', en: 'Area' }, palette: { he: 'ערכת צבעים', en: 'Palette' }, shape: { he: 'צורה', en: 'Shape' },
  focus: { he: 'גודל המרכז הנקי', en: 'Clear centre size' }, reach: { he: 'תנודת קצות הקווים', en: 'Line tip wander' }, thickness: { he: 'עובי', en: 'Thickness' },
  // date stamp
  text: { he: 'טקסט', en: 'Text' }, corner: { he: 'פינה', en: 'Corner' }, glow: { he: 'זוהר', en: 'Glow' },
  // old digicam, CRT
  sharpen: { he: 'חידוד', en: 'Sharpening' }, noise: { he: 'רעש צבעוני', en: 'Colour noise' }, bloom: { he: 'זליגת אורות', en: 'Highlight bloom' }, cool: { he: 'גוון קר', en: 'Cool cast' },
  curvature: { he: 'עקמומיות המסך', en: 'Screen curvature' }, phosphor: { he: 'מסכת זרחן', en: 'Phosphor mask' }, pitch: { he: 'רוחב שלישיית הצבעים', en: 'Triad width' },
};
export const EFFECT_OPTION_LABELS: Record<string, L> = {
  color: { he: 'צבע', en: 'Colour' }, multiply: { he: 'הכפלה', en: 'Multiply' }, screen: { he: 'מסך', en: 'Screen' }, overlay: { he: 'שכבת־על', en: 'Overlay' }, 'soft-light': { he: 'אור רך', en: 'Soft light' },
  steady: { he: 'קצב קבוע משלו', en: 'Its own steady tempo' }, music: { he: 'פעימות המוזיקה', en: 'The beats of the music' },
  horizontal: { he: 'אופקי', en: 'Horizontal' }, vertical: { he: 'אנכי', en: 'Vertical' }, left: { he: 'שמאל', en: 'Left' }, right: { he: 'ימין', en: 'Right' }, top: { he: 'עליון', en: 'Top' }, bottom: { he: 'תחתון', en: 'Bottom' },
  // time effects
  blend: { he: 'ממוצע משוקלל', en: 'Weighted average' }, trail: { he: 'שובל מאחור', en: 'Trail behind' }, lighten: { he: 'הבהיר מכולם', en: 'Brightest' },
  'red-now': { he: 'האדום הוא עכשיו', en: 'Red is now' }, 'blue-now': { he: 'הכחול הוא עכשיו', en: 'Blue is now' },
  centred: { he: 'סביב הפריים', en: 'Centred on the frame' }, trailing: { he: 'לפני הפריים', en: 'Trailing the frame' },
  steps: { he: 'צעדים', en: 'Steps' }, freeze: { he: 'עצירה על הפעימה', en: 'Freeze on the beat' }, held: { he: 'מוחזקת עם התמונה', en: 'Held with the picture' }, live: { he: 'רציפה', en: 'Continuous' },
  // overlays
  layer: { he: 'הקליפ בלבד', en: 'This clip only' }, frame: { he: 'כל הפריים', en: 'Whole frame' }, fall: { he: 'נפילה', en: 'Falling' }, burst: { he: 'פיצוץ בתחילת הקליפ', en: 'Burst at the clip start' },
  party: { he: 'מסיבה', en: 'Party' }, gold: { he: 'זהב', en: 'Gold' }, pastel: { he: 'פסטל', en: 'Pastel' }, single: { he: 'צבע אחד', en: 'One colour' },
  circle: { he: 'עיגול', en: 'Circle' }, hexagon: { he: 'משושה', en: 'Hexagon' },
  // date stamp
  'bottom-right': { he: 'למטה מימין', en: 'Bottom right' }, 'bottom-left': { he: 'למטה משמאל', en: 'Bottom left' }, 'top-right': { he: 'למעלה מימין', en: 'Top right' }, 'top-left': { he: 'למעלה משמאל', en: 'Top left' },
  // CRT
  grille: { he: 'סורג אנכי', en: 'Aperture grille' }, dots: { he: 'נקודות', en: 'Dots' }, slot: { he: 'חריצים', en: 'Slot mask' },
};
/** Per-effect names where the shared name would carry another effect's meaning (size = "Centre size", density = "share of bands that jump", …). */
export const EFFECT_PARAM_LABELS_BY_EFFECT: Record<string, Record<string, L>> = {
  'time.echo': { mode: { he: 'אופן המיזוג', en: 'Merge' }, decay: { he: 'משקל כל תמונה קודמת', en: 'Weight of each older picture' } },
  'time.shutter': { angle: { he: 'זווית הצמצם (מעלות)', en: 'Shutter angle (degrees)' } },
  'overlay.snow': { size: { he: 'גודל', en: 'Size' }, density: { he: 'צפיפות', en: 'Density' } },
  'overlay.confetti': { size: { he: 'גודל', en: 'Size' }, density: { he: 'צפיפות', en: 'Density' }, mode: { he: 'תנועה', en: 'Movement' }, x: { he: 'נקודת הפיצוץ (אופקי)', en: 'Burst point (horizontal)' }, y: { he: 'נקודת הפיצוץ (אנכי)', en: 'Burst point (vertical)' } },
  'overlay.hearts': { size: { he: 'גודל', en: 'Size' }, density: { he: 'צפיפות', en: 'Density' } },
  'overlay.bokeh': { size: { he: 'גודל', en: 'Size' }, density: { he: 'צפיפות', en: 'Density' } },
  'stylize.date-stamp': { size: { he: 'גובה הספרות', en: 'Digit height' } },
};
/** The name to show for a parameter (of `effectId` when given); the key itself when none is registered (never an empty label). */
export const effectParamLabel = (name: string, lang: 'he' | 'en', effectId?: string) => (effectId ? EFFECT_PARAM_LABELS_BY_EFFECT[effectId]?.[name]?.[lang] : undefined) ?? EFFECT_PARAM_LABELS[name]?.[lang] ?? name;
export const effectOptionLabel = (value: string, lang: 'he' | 'en') => EFFECT_OPTION_LABELS[value]?.[lang] ?? value;

/**
 * Sound effects («אפקטי קול», packages/core/src/audioEffects.ts) have parameters of their own. They are kept apart from the picture
 * labels above, so a key both registries use (`amount`, `seed`) can be worded for sound without changing the picture panel.
 * Units are words, shown after the number (the number itself sits in a left-to-right isolate); parameters from 0 to 1 have no
 * unit and are shown as a percentage, whole-number counts (the echo's repeats) have none and are shown as the number
 * (AudioFxBlock.tsx showValue; AudioFxBlock.test.ts checks every parameter). effect-param-labels.test.ts fails when a
 * sound-effect parameter or option has no name here.
 */
export const AUDIO_FX_PARAM_LABELS: Record<string, L> = {
  amount: { he: 'עוצמה', en: 'Amount' }, gainDb: { he: 'הגברת הבאס', en: 'Bass gain' }, freqHz: { he: 'תדר הפינה', en: 'Corner frequency' },
  grit: { he: 'חספוס', en: 'Grit' }, hiss: { he: 'רחש הקו', en: 'Line hiss' }, seed: { he: 'דפוס הרעש', en: 'Noise pattern' }, drive: { he: 'עיוות', en: 'Drive' },
  noise: { he: 'רחש וחריקות', en: 'Static and crackle' }, pitchHz: { he: 'גובה הצלצול', en: 'Ring pitch' }, metal: { he: 'צליל מתכתי', en: 'Metal' },
  bits: { he: 'דיוק', en: 'Resolution' }, rateKhz: { he: 'קצב דגימה', en: 'Sample rate' },
  delayMs: { he: 'זמן בין חזרות', en: 'Time between repeats' }, repeats: { he: 'מספר חזרות', en: 'Repeats' }, feedback: { he: 'עוצמת כל חזרה', en: 'Level of each repeat' },
  pingPong: { he: 'החזרות קופצות בין ימין לשמאל', en: 'Repeats bounce between left and right' }, tone: { he: 'כהות החזרות', en: 'Darkness of the repeats' },
  room: { he: 'סוג החלל', en: 'Space' }, decaySeconds: { he: 'זמן דעיכה', en: 'Decay time' }, predelayMs: { he: 'השהיה לפני ההדהוד', en: 'Pre-delay' },
  damping: { he: 'ריכוך הגבוהים', en: 'High damping' }, spread: { he: 'פיזור סטריאו', en: 'Stereo spread' }, stereoWidth: { he: 'רוחב', en: 'Width' },
};
export const AUDIO_FX_OPTION_LABELS: Record<string, L> = {
  room: { he: 'חדר', en: 'Room' }, hall: { he: 'אולם', en: 'Hall' }, cave: { he: 'מערה', en: 'Cave' }, bathroom: { he: 'מקלחת', en: 'Shower' },
};
/** Unit words of the sound-effect parameters that have one. */
export const AUDIO_FX_PARAM_UNITS: Record<string, L> = {
  gainDb: { he: 'דציבל', en: 'dB' }, freqHz: { he: 'הרץ', en: 'Hz' }, pitchHz: { he: 'הרץ', en: 'Hz' }, bits: { he: 'ביט', en: 'bits' }, rateKhz: { he: 'קילוהרץ', en: 'kHz' },
  delayMs: { he: 'אלפיות שנייה', en: 'milliseconds' }, predelayMs: { he: 'אלפיות שנייה', en: 'milliseconds' }, decaySeconds: { he: 'שניות', en: 'seconds' },
};
export const audioFxParamLabel = (name: string, lang: 'he' | 'en') => AUDIO_FX_PARAM_LABELS[name]?.[lang] ?? name;
export const audioFxOptionLabel = (value: string, lang: 'he' | 'en') => AUDIO_FX_OPTION_LABELS[value]?.[lang] ?? value;
export const audioFxParamUnit = (name: string, lang: 'he' | 'en') => AUDIO_FX_PARAM_UNITS[name]?.[lang] ?? '';

/** Stage words a job reports, as shown to a person. The counts after the word ("18/380") are kept as they are. */
const STAGE_WORDS: Record<string, { he: string; en: string }> = {
  preparing: { he: 'מכין', en: 'preparing' }, 'rendering audio': { he: 'מעבד את הקול', en: 'rendering the sound' }, 'rendering still': { he: 'מעבד תמונה', en: 'rendering a still' },
  rendering: { he: 'מעבד פריימים', en: 'rendering frames' }, encoding: { he: 'מקודד', en: 'encoding' }, validating: { he: 'בודק את הקובץ', en: 'checking the file' }, leased: { he: 'מתחיל', en: 'starting' },
  'recovered-after-restart': { he: 'ממשיך אחרי הפעלה מחדש', en: 'resuming after a restart' },
  // motion tracking jobs (core trackingStage, ADR-0015); 'tracking forward 12/240' keeps its count
  'reading frames': { he: 'קורא פריימים', en: 'reading frames' }, 'tracking forward': { he: 'עוקב קדימה', en: 'tracking forward' },
  'tracking backward': { he: 'עוקב אחורה', en: 'tracking backward' }, 'saving track': { he: 'שומר את המסלול', en: 'saving the track' },
};
export function jobStageLabel(stage: string | null | undefined, lang: 'he' | 'en'): string {
  if (!stage) return '';
  const word = Object.keys(STAGE_WORDS).sort((a, b) => b.length - a.length).find((w) => stage === w || stage.startsWith(`${w} `));
  return word ? `${STAGE_WORDS[word]![lang]}${stage.slice(word.length).replace(' (browser)', '')}` : stage;
}
