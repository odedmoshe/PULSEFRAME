/**
 * Interface strings of the visual wave (time effects, overlays, the date stamp, beat on a parameter), spread into `he` and
 * `en` (index.ts). Hebrew first; the English dictionary must cover the same keys.
 */
export const VISUAL_WAVE_HE = {
  'look.time.first': 'אפקט זמן תמיד ראשון; האפקטים שאחריו חלים על התמונה הממוזגת',
  'look.time.cost': 'תמונות לכל פריים (בווידאו כל אחת מפוענחת בנפרד):',
  'look.time.shutterNote': 'מטשטש תנועה שנוצרה בעורך (מפתחות, תנועות מוכנות, כותרות), לא תנועה שצולמה',
  'look.time.stutterNote': 'הצליל ממשיך לנגן; רק התמונה מוחזקת',
  'look.beat.toggle': 'פעימה על', 'look.beat.every': 'כל כמה פעימות', 'look.beat.depth': 'עומק', 'look.beat.decay': 'דעיכה', 'look.beat.remove': 'בלי פעימה',
  'look.stamp.hint': "ספרות, רווח ו־ . : ' / -", 'look.stamp.today': 'תאריך היום',
} as const;
export const VISUAL_WAVE_EN: Record<keyof typeof VISUAL_WAVE_HE, string> = {
  'look.time.first': 'A time effect is always first; the effects after it apply to the merged picture',
  'look.time.cost': 'Pictures per frame (on video each is decoded separately):',
  'look.time.shutterNote': 'Blurs movement made in the editor (keyframes, motion presets, titles), not movement filmed in the video',
  'look.time.stutterNote': 'The sound plays on; only the picture is held',
  'look.beat.toggle': 'Beat on', 'look.beat.every': 'Every how many beats', 'look.beat.depth': 'Depth', 'look.beat.decay': 'Settling', 'look.beat.remove': 'No beat',
  'look.stamp.hint': "Digits, space and . : ' / -", 'look.stamp.today': "Today's date",
};
