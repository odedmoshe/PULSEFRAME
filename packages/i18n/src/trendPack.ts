/**
 * Interface strings of the trend pack (ADR-0012): transition categories, the transition options panel (beat lock, velocity
 * ramp, colour, seed, the light status line) and the wording of set_transition_options. Spread into `he` and `en`
 * (index.ts); Hebrew first, and the English dictionary must cover the same keys. The title effects panel keeps its own
 * local STR table (apps/web/src/editor/TextEffectsField.tsx), as the text animation panel does.
 * `{name}` marks a value the panel fills in with `fillIn`.
 */
export const TREND_PACK_HE = {
  'look.trcat.basic': 'בסיסי', 'look.trcat.wipe': 'ניגוב', 'look.trcat.slide': 'החלקה', 'look.trcat.camera': 'מצלמה', 'look.trcat.blur': 'טשטוש', 'look.trcat.distort': 'עיוות',
  'look.trcat.glitch': 'גליץ׳', 'look.trcat.light': 'אור', 'look.trcat.mask': 'מסכה', 'look.trcat.mg': 'מושן גרפיקס', 'look.trcat.paper': 'נייר',
  'look.transition.options': 'אפשרויות מעבר',
  'look.transition.sync': 'נעילה לפעימה',
  'look.transition.sync.locked': 'הפעימה בפריים {frame} ({time})',
  'look.transition.sync.none': 'אין פעימות מנותחות בחלון המעבר — המעבר יתנהג כרגיל',
  'look.transition.velocity': 'רמפת מהירות',
  'look.transition.velocity.off': 'בלי',
  'look.transition.velocity.need': 'נדרשים {out} פריימים אחרי הקליפ הקודם ו־{head} לפני תחילת הקליפ',
  'look.transition.color': 'צבע',
  'look.transition.seed': 'וריאציה',
  'look.transition.shuffle': 'ערבוב',
  'look.transition.light.kept': 'האור של המעבר מוצג',
  'look.transition.light.held': 'האור של המעבר מוחזק: {s} שנ׳ אחרי הבזק אחר',
  'op.set_transition_options': 'אפשרויות מעבר',
} as const;
export const TREND_PACK_EN: Record<keyof typeof TREND_PACK_HE, string> = {
  'look.trcat.basic': 'Basic', 'look.trcat.wipe': 'Wipe', 'look.trcat.slide': 'Slide', 'look.trcat.camera': 'Camera', 'look.trcat.blur': 'Blur', 'look.trcat.distort': 'Distort',
  'look.trcat.glitch': 'Glitch', 'look.trcat.light': 'Light', 'look.trcat.mask': 'Mask', 'look.trcat.mg': 'Motion graphics', 'look.trcat.paper': 'Paper',
  'look.transition.options': 'Transition options',
  'look.transition.sync': 'Lock to the beat',
  'look.transition.sync.locked': 'The beat is on frame {frame} ({time})',
  'look.transition.sync.none': 'No analysed beat falls in the transition window — it plays as usual',
  'look.transition.velocity': 'Velocity ramp',
  'look.transition.velocity.off': 'Off',
  'look.transition.velocity.need': 'Needs {out} frames after the previous clip and {head} before the clip starts',
  'look.transition.color': 'Colour',
  'look.transition.seed': 'Variation',
  'look.transition.shuffle': 'Shuffle',
  'look.transition.light.kept': "The transition's light is shown",
  'look.transition.light.held': "The transition's light is held back: {s} s after another flash",
  'op.set_transition_options': 'Transition options',
};
/** A string with its `{name}` marks replaced by the values given (marks without a value stay as they are). */
export const fillIn = (s: string, values: Readonly<Record<string, string | number>>): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.hasOwn(values, k) ? String(values[k]) : m));
