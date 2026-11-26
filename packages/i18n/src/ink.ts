/**
 * Strings of «ציור חי» — a live drawing (wave 8 ink track; core inkContract.ts, inkOps.ts). Spread into `he` and `en` (index.ts);
 * HE_INK words every refusal of add_ink / edit_ink in Hebrew with the next step (refusals.ts translateRefusal); kept in step by
 * packages/evals/src/ink-wording.test.ts. Hebrew addresses the owner in the plural, no gendered forms. Namespaces: `op.*`, `ink.*`
 * (the interface; W3 reads them through apps/web/src/editor/ink/ink.strings.ts). Nothing here says how a drawing looks: nobody here
 * has seen one.
 */
export const INK_UI_HE = {
  mode: 'ציור',
  modeHint: 'ציירו על התמונה. לחצו סיום כשגמרתם',
  pausedOnly: 'אפשר לצייר רק כשהסרטון עצור. עצרו ואז לחצו ציור',
  toolbar: 'כלי ציור',
  'brush.marker': 'טוש', 'brush.highlighter': 'מדגש', 'brush.neon': 'ניאון',
  colour: 'צבע',
  width: 'עובי', 'width.thin': 'דק', 'width.medium': 'בינוני', 'width.thick': 'עבה',
  undoStroke: 'בטלו קו',
  nothingToUndo: 'אין קווים לביטול בציור הזה',
  done: 'סיום',
  cancel: 'ביטול',
  discardAsk: 'לבטל את הציור? הקווים שציירתם לא יישמרו',
  discardYes: 'כן, לבטל', discardNo: 'להמשיך לצייר',
  saveAsk: 'לשמור את הציור?',
  spaceInMode: 'כדי לנגן, לחצו קודם סיום או ביטול',
  afterDone: 'הציור מופיע בהדרגה. לחצו רווח כדי לראות',
  strokeSplit: 'הקו היה ארוך, ולכן נשמר כמה קווים',
  panel: 'ציור',
  play: 'הופעה', 'play.drawn': 'כפי שצויר', 'play.all': 'הכול מיד',
  fadeOut: 'היעלמות בסוף',
  follow: 'הצמידו לנקודה שעוקבים אחריה',
  followNone: 'אין עדיין מעקב בקליפ הזה',
  otherFormat: 'בפורמט אחר הציור נשאר באותו מקום במסגרת, לא על אותו דבר בתמונה',
  notEnds: 'הציור לא מסתיים לפני סוף הקליפ',
  neonNeedsBlur: 'הניאון צריך דפדפן שמצייר טשטוש',
  notLooked: 'לא נבדק בעין',
  strokesCount: '{n} קווים',
  noStrokesAgain: 'אי אפשר לשנות את הקווים בגרסה הזו. כדי לצייר מחדש מחקו את הקליפ וציירו שוב',
} as const;
export const INK_UI_EN: Record<keyof typeof INK_UI_HE, string> = {
  mode: 'Draw',
  modeHint: 'Draw on the picture. Press Done when you are finished',
  pausedOnly: 'You can draw only while the film is paused. Pause, then press Draw',
  toolbar: 'Drawing tools',
  'brush.marker': 'Marker', 'brush.highlighter': 'Highlighter', 'brush.neon': 'Neon',
  colour: 'Colour',
  width: 'Width', 'width.thin': 'Thin', 'width.medium': 'Medium', 'width.thick': 'Thick',
  undoStroke: 'Undo stroke',
  nothingToUndo: 'There is no stroke to undo in this drawing',
  done: 'Done',
  cancel: 'Cancel',
  discardAsk: 'Discard the drawing? The strokes you drew will not be kept',
  discardYes: 'Yes, discard', discardNo: 'Keep drawing',
  saveAsk: 'Keep the drawing?',
  spaceInMode: 'To play, press Done or Cancel first',
  afterDone: 'The drawing appears gradually. Press Space to watch it',
  strokeSplit: 'The stroke was long, so it was kept as several strokes',
  panel: 'Drawing',
  play: 'Appears', 'play.drawn': 'As it was drawn', 'play.all': 'All at once',
  fadeOut: 'Fade out at the end',
  follow: 'Pin to a tracked point',
  followNone: 'This clip has no tracking yet',
  otherFormat: 'In another format the drawing stays in the same place in the frame, not on the same thing in the picture',
  notEnds: 'The drawing does not finish before the clip ends',
  neonNeedsBlur: 'Neon needs a browser that draws blur',
  notLooked: 'Not checked by eye',
  strokesCount: '{n} strokes',
  noStrokesAgain: 'Strokes cannot be changed in this version. To draw again, delete the clip and draw anew',
};
type Prefixed<O> = { readonly [K in keyof O & string as `ink.${K}`]: O[K] };
const prefixed = <O extends Record<string, string>>(o: O): Prefixed<O> => Object.fromEntries(Object.entries(o).map(([k, v]) => [`ink.${k}`, v])) as Prefixed<O>;
export const INK_HE = { 'op.add_ink': 'הוספת ציור', 'op.edit_ink': 'שינוי ציור', ...prefixed(INK_UI_HE) } as const;
export const INK_EN: Record<keyof typeof INK_HE, string> = { 'op.add_ink': 'Added a drawing', 'op.edit_ink': 'Changed a drawing', ...prefixed(INK_UI_EN) };

/** The Hebrew of every ink refusal (core INK_REFUSALS), each with the next step. */
export const HE_INK: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^ink stroke (\d+): x, y and t have different lengths$/, (m) => `בקו ${m[1]} מספר ערכי x, y ו־t שונה. תנו x, y ו־t אחד לכל נקודה`],
  [/^ink stroke (\d+): t must start at 0 and never go back$/, (m) => `בקו ${m[1]} הזמנים לא מתחילים ב־0 או חוזרים אחורה. תנו לכל נקודה את האלפיות מתחילת הקו, לפי הסדר`],
  [/^ink stroke (\d+): (\d+) ms between two points; at most (\d+)$/, (m) => `בקו ${m[1]} יש ${m[2]} אלפיות שנייה בין שתי נקודות, ומותר עד ${m[3]}. התחילו קו חדש אחרי הפסקה ארוכה`],
  [/^ink stroke (\d+): a point lies (\d+) units from the frame centre; at most (\d+)$/, (m) => `בקו ${m[1]} נקודה רחוקה ${m[2]} יחידות ממרכז המסגרת, ומותר עד ${m[3]}. השאירו את הנקודות בטווח של כשלושה גובהי מסגרת מהמרכז`],
  [/^the drawing spans (\d+) units; at most (\d+) on each axis$/, (m) => `הציור משתרע על ${m[1]} יחידות, ומותר עד ${m[2]} בכל כיוון. ציירו אותו כשני ציורים`],
  [/^ink stroke (\d+) ends at (\d+) ms; a drawing lasts at most (\d+) ms$/, (m) => `קו ${m[1]} מסתיים אחרי ${m[2]} אלפיות שנייה, וציור נמשך עד ${m[3]}. ציירו ציור קצר יותר, או חלקו אותו לשניים`],
  [/^ink stroke (\d+) has (\d+) points; at most (\d+) in one stroke$/, (m) => `בקו ${m[1]} יש ${m[2]} נקודות, ומותר עד ${m[3]} בקו אחד. חלקו אותו לקווים קצרים יותר (העורך עושה זאת בזמן הציור)`],
  [/^the drawing has (\d+) strokes; at most (\d+)$/, (m) => `בציור ${m[1]} קווים, ומותר עד ${m[2]}. ציירו אותו כשני ציורים`],
  [/^the drawing has (\d+) points; at most (\d+) in one drawing$/, (m) => `הציור גדול מדי: ${m[1]} נקודות, ומותר עד ${m[2]} בציור אחד. ציירו אותו כשני ציורים, או בפחות קווים`],
  [/^the project already holds (\d+) of (\d+) drawing points; this drawing adds (\d+)$/, (m) => `בפרויקט כבר ${m[1]} נקודות ציור מתוך ${m[2]}, והציור הזה מוסיף ${m[3]}. מחקו ציור ישן, או ציירו את הזה בפחות קווים`],
  [/^clip (\S+) is not a drawing$/, () => 'הקליפ הזה אינו ציור. בחרו ציור (קליפ שנוצר בכלי הציור)'],
  [/^edit_ink: nothing to change$/, () => 'לא נבחר שום שינוי בציור. בחרו הופעה, מהירות או היעלמות בסוף'],
];
