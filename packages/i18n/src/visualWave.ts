/**
 * Interface strings of the visual wave (time effects, overlays, the date stamp, beat on a parameter; ADR-0011), spread into
 * `he` and `en` (index.ts). Hebrew first; the English dictionary must cover the same keys. Used by the look panel
 * (apps/web/src/editor/LookPanel.tsx).
 */
export const VISUAL_WAVE_HE = {
  'look.time.first': 'אפקט זמן תמיד ראשון; האפקטים שאחריו חלים על התמונה הממוזגת',
  'look.time.cost': 'תמונות לכל פריים (בווידאו כל אחת מפוענחת בנפרד):',
  'look.time.shutterNote': 'מטשטש תנועה שנוצרה בעורך (מפתחות, תנועות מוכנות, כותרות), לא תנועה שצולמה',
  'look.time.stutterNote': 'הצליל ממשיך לנגן; רק התמונה מוחזקת',
  'look.beat.toggle': 'פעימה על', 'look.beat.every': 'כל כמה פעימות', 'look.beat.depth': 'עומק', 'look.beat.decay': 'דעיכה', 'look.beat.remove': 'בלי פעימה',
  'look.beat.note': 'הפרמטר קופץ בכל פעימה שנבחרה וחוזר לערכו; עומק שלילי מוריד אותו, ודעיכה גבוהה מחזירה אותו מהר יותר.',
  'look.beat.noMusic': 'פעימה על פרמטר (♪) פועלת כשמתחת לקליפ מתנגנת מוזיקה עם פעימות מזוהות. מנתחים פעימות בלשונית קליפ ← ניתוח, כשקליפ המוזיקה נבחר.',
  'look.stamp.hint': "ספרות, רווח ו־ . : ' / -", 'look.stamp.today': 'תאריך היום',
} as const;
export const VISUAL_WAVE_EN: Record<keyof typeof VISUAL_WAVE_HE, string> = {
  'look.time.first': 'A time effect is always first; the effects after it apply to the merged picture',
  'look.time.cost': 'Pictures per frame (on video each is decoded separately):',
  'look.time.shutterNote': 'Blurs movement made in the editor (keyframes, motion presets, titles), not movement filmed in the video',
  'look.time.stutterNote': 'The sound plays on; only the picture is held',
  'look.beat.toggle': 'Beat on', 'look.beat.every': 'Every how many beats', 'look.beat.depth': 'Depth', 'look.beat.decay': 'Settling', 'look.beat.remove': 'No beat',
  'look.beat.note': 'The parameter kicks on every chosen beat and settles back; a negative depth lowers it, and a higher settling brings it back faster.',
  'look.beat.noMusic': 'Beat on a parameter (♪) works where music with detected beats plays under the clip. Detect beats in the Clip tab → Analysis with the music clip selected.',
  'look.stamp.hint': "Digits, space and . : ' / -", 'look.stamp.today': "Today's date",
};
