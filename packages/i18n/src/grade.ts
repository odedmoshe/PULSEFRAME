/**
 * Strings of colour curves «עקומות» and the scope additions (wave 8 `grade`; grade-plan.md §3.7 as corrected by grade-verify.md
 * C7, C9, C11, C12). Spread into `he` and `en` (index.ts); Hebrew first, plural address, no gendered forms; the English dictionary
 * covers the same keys (grade-wording.test.ts). Namespaces: `op.*`, `error.code.*`, `grade.*` (the interface reads them through
 * apps/web/src/editor/grade/grade.strings.ts). Nothing here calls a curve, a look or a picture good, right or checked; the skin-tone
 * line is a convention of video scopes and the note says it judges nobody; the ready-made curves say that nobody has tried them on
 * real footage. Also here: HE_GRADE, the Hebrew of every refusal of set_grade_curves and of the pass's not-built reason, each with
 * the next step.
 */
const GRADE_HE_BASE = {
  'op.set_grade_curves': 'קביעת עקומות צבע',
  'error.code.grade_curves_not_built': 'עקומות הצבע עוד לא נבנו בגרסה הזו של העורך',
} as const;
const GRADE_EN_BASE: Record<keyof typeof GRADE_HE_BASE, string> = {
  'op.set_grade_curves': 'Set colour curves',
  'error.code.grade_curves_not_built': 'Colour curves are not built in this build yet',
};
/** `grade.<key>`; {placeholders} are filled by grade.strings.ts. Numbers are drawn in <bdi dir="ltr"> by the components. */
export const GRADE_EXTRA = {
  he: {
    // the curves block (under «כיוון ידני»)
    'curves': 'עקומות', 'tab.master': 'כללי', 'tab.r': 'אדום', 'tab.g': 'ירוק', 'tab.b': 'כחול',
    'curveOf.master': 'הכללית', 'curveOf.r': 'האדומה', 'curveOf.g': 'הירוקה', 'curveOf.b': 'הכחולה',
    'graph': 'עקומת {channel}: ציר אופקי — הערך שנכנס, ציר אנכי — הערך שיוצא',
    'point': 'נקודה {n} מתוך {of} בעקומה {curveOf}', 'valuetext': 'כניסה {in}, יציאה {out}',
    'in': 'כניסה', 'out': 'יציאה',
    'help': 'העקומה משנה את ערכי הצבע השמורים בתמונה (0–255) אחרי המחוונים שלמעלה ולפני טבלת צבע שבהמשך הרשימה. זה לא אור ולא HDR. קודם העקומה של כל ערוץ, ואחר כך העקומה הכללית. עקומה תלולה מגדילה מדרגות בצבע. בחרו נקודה והזיזו אותה בחיצים: למעלה ולמטה משנים את היציאה, ימינה ושמאלה את הכניסה (הגרף תמיד משמאל לימין, גם בעברית); עם Shift בצעדים של 8. Enter מוסיף נקודה ו־Delete מוחק. אפשר גם לגרור נקודה, או לכתוב את המספרים בשדות «כניסה» ו«יציאה».',
    'presets': 'עקומות מוכנות', 'presetsUnseen': 'את העקומות המוכנות האלה איש עוד לא בדק על צילום אמיתי.',
    'reset': 'איפוס העקומות',
    'endPoint': 'אי אפשר למחוק נקודת קצה. אפשר להזיז אותה למעלה או למטה',
    'noRoom': 'אין כאן מקום לנקודה נוספת: בין שתי נקודות צריך לפחות 8. בחרו נקודה אחרת',
    'full': 'בעקומה כבר יש 12 נקודות. מחקו נקודה כדי להוסיף אחרת',
    'lookKeepsCurves': 'העקומות של הקליפ נשארות',
    'matchKeepsCurves': 'מחליף את ערכי המחוונים; העקומות נשארות',
    // scopes (Scopes.tsx) and zebra (ExposureOverlay.tsx)
    'parade': 'מצעד RGB', 'parade.label': 'מצעד RGB: שלוש צורות גל זו לצד זו — אדום, ירוק, כחול — כל אחת משמאל לימין כמו בתמונה',
    'parade.r': 'אדום', 'parade.g': 'ירוק', 'parade.b': 'כחול', 'parade.min': 'נמוך ביותר', 'parade.max': 'גבוה ביותר', 'parade.mean': 'ממוצע',
    'targets': 'יעדי 75% (פסי צבע)', 'targets.legend': 'R אדום · Yl צהוב · G ירוק · Cy טורקיז · B כחול · Mg מג׳נטה',
    'skin': 'קו גווני עור (מוסכמה)',
    'skinNote': 'הקו הוא מוסכמה של מדי וידאו: כיוון שבו נופלים גוונים רבים של עור במדים כאלה. זו מדידה של צבע בתמונה ולא שיפוט של אדם או של עורו; עור אמיתי נופל גם רחוק מהקו.',
    'playing': 'בזמן ניגון: נמדד כל פריים שישי, מהתמונה המהירה של התצוגה.',
    'verdict': 'מדידות, לא ציון.',
    'zebra': 'זברה', 'zebraNote': 'זברה: סימון על התצוגה בלבד, לא נכנס לייצוא', 'zebraLegend': 'פסים = בהירות 251 ומעלה · נקודות = 4 ומטה',
    'zebraPaused': 'זברה מוצגת כשהניגון עוצר',
    'notBuilt': 'עקומות הצבע עוד לא נבנו בגרסה הזו של העורך',
  },
  en: {
    'curves': 'Curves', 'tab.master': 'Master', 'tab.r': 'Red', 'tab.g': 'Green', 'tab.b': 'Blue',
    'curveOf.master': 'master', 'curveOf.r': 'red', 'curveOf.g': 'green', 'curveOf.b': 'blue',
    'graph': '{channel} curve: across — the value going in, up — the value coming out',
    'point': 'Point {n} of {of} on the {curveOf} curve', 'valuetext': 'in {in}, out {out}',
    'in': 'In', 'out': 'Out',
    'help': 'A curve changes the colour values stored in the picture (0–255) after the sliders above and before a colour table further down the list. It is not light and not HDR. Each channel\'s curve comes first, then the master curve. A steep curve makes colour steps larger. Choose a point and move it with the arrows: up and down change the output, left and right the input (the graph always runs left to right, in Hebrew too); with Shift in steps of 8. Enter adds a point and Delete removes one. You can also drag a point, or type the numbers in the In and Out fields.',
    'presets': 'Ready-made curves', 'presetsUnseen': 'Nobody has yet tried these ready-made curves on real footage.',
    'reset': 'Reset the curves',
    'endPoint': 'End points cannot be deleted. You can move them up or down',
    'noRoom': 'No room for another point here: two points need at least 8 between them. Choose another point',
    'full': 'The curve already has 12 points. Delete one to add another',
    'lookKeepsCurves': 'The clip\'s curves stay',
    'matchKeepsCurves': 'replaces the slider values; the curves stay',
    'parade': 'RGB parade', 'parade.label': 'RGB parade: three waveforms side by side — red, green, blue — each left to right as in the picture',
    'parade.r': 'Red', 'parade.g': 'Green', 'parade.b': 'Blue', 'parade.min': 'Lowest', 'parade.max': 'Highest', 'parade.mean': 'Mean',
    'targets': '75% targets (colour bars)', 'targets.legend': 'R red · Yl yellow · G green · Cy cyan · B blue · Mg magenta',
    'skin': 'Skin-tone line (a convention)',
    'skinNote': 'The line is a video-scope convention: a direction where many skin tones fall on such scopes. It measures colour in the picture; it is not a judgement of anyone or of their skin, and real skin also falls away from it.',
    'playing': 'While playing: every 6th frame is measured, from the viewer\'s fast picture.',
    'verdict': 'Measurements, not a verdict.',
    'zebra': 'Zebra', 'zebraNote': 'Zebra: marked on the viewer only, never in an export', 'zebraLegend': 'Stripes = luma 251 and above · dots = 4 and below',
    'zebraPaused': 'Zebra is shown when playback stops',
    'notBuilt': 'Colour curves are not built in this build yet',
  },
} as const;
type Prefixed<O> = { readonly [K in keyof O & string as `grade.${K}`]: O[K] };
const prefixed = <O extends Record<string, string>>(o: O): Prefixed<O> => Object.fromEntries(Object.entries(o).map(([k, v]) => [`grade.${k}`, v])) as Prefixed<O>;
export const GRADE_HE = { ...GRADE_HE_BASE, ...prefixed(GRADE_EXTRA.he) };
export const GRADE_EN: Record<keyof typeof GRADE_HE, string> = { ...GRADE_EN_BASE, ...prefixed(GRADE_EXTRA.en) };

const CHANNEL_HE: Record<string, string> = { master: 'הכללית', r: 'האדומה', g: 'הירוקה', b: 'הכחולה' };
const ch = (m: RegExpExecArray) => CHANNEL_HE[m[1]!] ?? m[1]!;
/** The Hebrew of every set_grade_curves refusal (core gradeCurvesOps.ts GRADE_CURVE_MESSAGES) and of the pass's not-built reason, each with the next step. */
export const HE_GRADE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the (master|r|g|b) curve needs 2 to 12 points$/, (m) => `בעקומה ${ch(m)} צריכות להיות בין 2 ל־12 נקודות. מחקו נקודה או הוסיפו אחת`],
  [/^every value of the (master|r|g|b) curve must be a whole number from 0 to 255$/, (m) => `כל ערך בעקומה ${ch(m)} הוא מספר שלם בין 0 ל־255. עגלו את הערכים ונסו שוב`],
  [/^the (master|r|g|b) curve must start at input 0 and end at input 255, with points left to right at least 4 apart$/, (m) => `בעקומה ${ch(m)} הנקודה הראשונה ב־0 והאחרונה ב־255 בציר האופקי, והנקודות מסודרות משמאל לימין במרחק 4 לפחות זו מזו. סדרו את הנקודות ונסו שוב`],
  [/^a clip can carry at most 16 effects$/, () => 'לקליפ יכולים להיות עד 16 אפקטים. הסירו אפקט שאינו נחוץ ונסו שוב'],
  [/^(\S+): colour curves are not built in this build yet$/, () => 'עקומות הצבע עוד לא נבנו בגרסה הזו של העורך, ולכן הקליפ מוצג בלי תיקון הצבע שלו. אפשר להסיר את העקומות («איפוס העקומות») או לעדכן את העורך'],
];
