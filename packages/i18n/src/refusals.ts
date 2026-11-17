import { effectParamLabel } from './effectParams.ts';

/**
 * Hebrew wording for the detail text of the refusals a person meets most often in the editor. The server's messages are
 * English sentences built at about two hundred places; this table recognises the common ones by their shape and words
 * them in Hebrew, keeping the numbers. Anything it does not recognise is shown as the server wrote it.
 * `packages/evals/src/refusal-wording.test.ts` provokes each of these refusals for real and fails when the server's
 * wording no longer matches a pattern here.
 */
/** A left-to-right run (a signed number, a row of symbols) isolated inside the Hebrew sentence, so that its minus sign and order survive. */
const ltr = (s: string) => `⁦${s}⁩`;
const HE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^range overlaps clip \S+ on track \S+$/, () => 'הטווח תפוס על ידי קליפ אחר באותה רצועה'],
  [/^track \S+ is locked$/, () => 'הרצועה נעולה; יש לבטל את הנעילה כדי לערוך בה'],
  [/^trim would leave an empty clip( or start before 0)?$/, () => 'הקיצור היה משאיר קליפ ריק'],
  [/^not enough source material after the clip end$/, () => 'אין בקובץ המקור מספיק חומר אחרי סוף הקליפ'],
  [/^not enough source material before the clip start$/, () => 'אין בקובץ המקור מספיק חומר לפני תחילת הקליפ'],
  [/^the source has no material that far$/, () => 'אין בקובץ המקור חומר כל כך רחוק'],
  [/^this clip changes speed gradually over its length, so it cannot be (.+)$/, () => 'המהירות של הקליפ משתנה בהדרגה, ולכן הפעולה הזו אינה אפשרית בו. אפשר להחזיר אותו למהירות אחת, לבצע את הפעולה, ולהחיל שוב את השינוי ההדרגתי'],
  [/^from and to are the same speed$/, () => 'מהירות ההתחלה ומהירות הסיום זהות'],
  [/^a freeze frame has no speed$/, () => 'לפריים קפוא אין מהירות'],
  [/^a still image has no speed$/, () => 'לתמונה סטטית אין מהירות'],
  [/^this clip is already a freeze frame$/, () => 'הקליפ הזה כבר פריים קפוא'],
  [/^the key must lie inside the clip$/, () => 'הנקודה חייבת להיות בתוך הקליפ'],
  [/^the transition \((\d+) frames\) is longer than the clip \((\d+) frames\)$/, (m) => `המעבר (${m[1]} פריימים) ארוך מהקליפ (${m[2]} פריימים)`],
  [/^the previous clip has only (\d+) unused source frames after its end; the transition needs (\d+)$/, (m) => `לקליפ הקודם נשארו רק ${m[1]} פריימים של חומר מקור אחרי סופו; המעבר צריך ${m[2]}`],
  [/^remove the transition at this clip first$/, () => 'יש להסיר קודם את המעבר שבקליפ הזה'],
  [/^the clip already plays (backwards|forwards)$/, (m) => (m[1] === 'backwards' ? 'הקליפ כבר מתנגן לאחור' : 'הקליפ כבר מתנגן קדימה')],
  [/^(\d+) clip\(s\) on the timeline still use this file$/, (m) => `${m[1]} קליפים בציר הזמן עדיין משתמשים בקובץ הזה`],
  [/^this asset has no scene analysis yet$/, () => 'לקובץ הזה עדיין אין ניתוח חיתוכים'],
  [/^there is already a marker on this frame$/, () => 'כבר יש סמן על הפריים הזה'],
  [/^fades must be non-negative and fit inside the clip$/, () => 'הדעיכות חייבות להיכנס באורך הקליפ'],
  [/^no audio clip ends where this one starts on the same track$/, () => 'אין קליפ קול שמסתיים בדיוק היכן שהקליפ הזה מתחיל באותה רצועה'],
  [/^this sound is set to keep its pitch, which works at one speed only$/, () => 'הקול מוגדר לשמור על גובה הצליל, וזה פועל רק במהירות אחת'],
  [/^the sound already (keeps its pitch|follows the speed)$/, (m) => (m[1] === 'keeps its pitch' ? 'הקול כבר שומר על גובה הצליל' : 'גובה הצליל כבר משתנה עם המהירות')],
  [/^a copy would start before 0$/, () => 'העותק היה מתחיל לפני תחילת ציר הזמן'],
  [/^the clip is too short for this change of speed at the end of its source$/, () => 'הקליפ קצר מדי לשינוי המהירות הזה בסוף קובץ המקור'],
  [/^the file could not be read as video, sound or a picture$/, () => 'לא ניתן לקרוא את הקובץ כווידאו, כקול או כתמונה'],
  [/^a clip can carry one time effect \(echo, time split, shutter or stutter\)$/, () => 'לקליפ יכול להיות אפקט זמן אחד בלבד (הד, פיצול זמן, צמצם או קפיצות פריים)'],
  [/^"(.+)" of (\S+) cannot follow the beat$/, (m) => `"${effectParamLabel(m[1]!, 'he', m[2])}" אינו יכול לזוז עם הפעימות: רק פרמטרים של צורה ומרקם יכולים, לא בהירות או צבע`],
  // set_effect_modulator: the message names no effect, so the parameter takes its shared name (the one the look panel shows)
  [/^depth (\S+) is larger than the range of (\S+) \((\S+)…(\S+)\)$/, (m) => `עומק הפעימה ${ltr(m[1]!)} חורג מהטווח כולו של "${effectParamLabel(m[2]!, 'he')}" (${ltr(m[3]!)} עד ${ltr(m[4]!)})`],
  // the date-stamp text (STAMP_TEXT) before the general case
  [/^invalid parameters for stylize\.date-stamp: text$/, () => `בטקסט של חותמת התאריך מותרים רק ספרות, רווחים והסימנים ${ltr(". : ' / -")}, עד 20 תווים`],
  [/^invalid parameters for (\S+)(?:: (.+))?$/, (m) => {
    const names = m[2] ? m[2].split(', ').map((p) => `"${effectParamLabel(p, 'he', m[1])}"`) : [];
    return names.length === 0 ? 'ערכי הפרמטרים של האפקט אינם תקינים' : names.length === 1 ? `הערך של ${names[0]} אינו תקין` : `הערכים של ${names.join(', ')} אינם תקינים`;
  }],
  // from the render worker and the browser export (ADR-0011): a frame needs more video decoders at once than they open
  [/^decode_budget: this frame needs more than (\d+) video decoders$/, (m) => `הפריים הזה צריך יותר מ־${m[1]} מפענחי וידאו בבת אחת`],
];
/**
 * Refusals of the sound-effect operations («אפקטי קול», ADR-0010). Kept as their own list with their own test
 * (packages/evals/src/audiofx-refusal-wording.test.ts provokes each of them), so the inventory of the list above stays as it is.
 */
const HE_AUDIO_FX: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^this clip has no sound clip$/, () => 'לקליפ הזה אין קליפ קול. אפשר לבחור את קליפ הקול, או קליפ תמונה שמקושר לקול'],
  [/^sound effect ".+" does not exist$/, () => 'אפקט הקול הזה לא קיים בגרסה הזו'],
  [/^invalid parameters for sound effect \S+$/, () => 'ההגדרות של אפקט הקול מחוץ לטווח המותר'],
  [/^this clip already has the sound effect \S+$/, () => 'לקליפ כבר יש את אפקט הקול הזה; אפשר לשנות את ההגדרות שלו'],
  [/^this clip already has a character voice \(\S+\)$/, () => 'לקליפ כבר יש דמות קול, ולכל קליפ יש דמות קול אחת בלבד'],
  [/^a clip can carry at most (\d+) sound effects$/, (m) => `אפשר להוסיף לקליפ עד ${m[1]} אפקטי קול`],
  [/^this sound keeps its pitch at another speed or changes speed gradually, so it cannot carry sound effects yet$/, () => 'אפקטי קול עדיין לא פועלים על קול ששומר על גובה הצליל במהירות אחרת, או שהמהירות שלו משתנה בהדרגה'],
  [/^this sound has sound effects, which cannot follow a gradual change of speed or a stretch that keeps the pitch yet$/, () => 'לקול יש אפקטי קול, והם עדיין לא יכולים לעקוב אחרי שינוי מהירות הדרגתי או אחרי שמירה על גובה הצליל. אפשר להסיר אותם או לכבות אותם, לבצע את השינוי ולהוסיף אותם שוב'],
  [/^sound effect \S+ not found on clip \S+$/, () => 'אפקט הקול לא נמצא בקליפ הזה'],
  [/^sound preset ".+" does not exist$/, () => 'המתכון הזה לא קיים'],
  [/^this clip has no sound effects to remove$/, () => 'לקליפ אין אפקטי קול להסרה'],
  [/^the clip to copy from has no sound effects$/, () => 'לקליפ שממנו מעתיקים אין אפקטי קול'],
  [/^a clip cannot take its own sound effects$/, () => 'אי אפשר להעתיק את אפקטי הקול של קליפ אל אותו קליפ'],
  [/^this picture clip is linked to more than one sound clip$/, () => 'קליפ התמונה מקושר ליותר מקליפ קול אחד; יש לבחור את קליפ הקול'],
  [/^give params and\/or enabled$/, () => 'לא צוין מה לשנות באפקט הקול'],
];
/**
 * Refusals of adjustment layers, replacing a clip's media and applying a template («שכבת התאמה», «החלפת מדיה», «תבנית»;
 * ADR-0016), including the two validation codes adjustment_transform and adjustment_effect as an invalid result. Their own
 * list, so the inventory of the list above stays as it is; packages/evals/src/refusal-wording.test.ts provokes every one of
 * them in a case of its own. A refusal of a template step names a fault of the template, not of the person's edit.
 */
const ADJUSTMENT_REASONS_HE: Record<string, string> = {
  "a time effect needs a clip's own source; it cannot act on the picture below": 'אפקט זמן צריך את המקור של הקליפ עצמו, ואינו יכול לפעול על התמונה שמתחת',
  'a chroma key over the whole picture below would cut holes through to the background': 'מסך ירוק על כל התמונה שמתחת היה פותח חורים עד הרקע',
  'a drop shadow has no visible result on a full-frame picture': 'לצל אין תוצאה נראית על תמונה שממלאת את כל הפריים',
};
const adjustmentReasonHe = (why: string) => ADJUSTMENT_REASONS_HE[why] ?? 'הוא אינו מתאים לשכבת התאמה';
const TEMPLATE_FAULT_HE = 'זו תקלה בתבנית, לא בעריכה שלך';
const HE_TEMPLATES: [RegExp, (m: RegExpExecArray) => string][] = [
  // add_adjustment and the adjustment rules of the other operations
  [/^the edit has no picture or title to cover yet$/, () => 'בעריכה עדיין אין תמונה או כותרת ששכבת ההתאמה תכסה. אפשר להוסיף קליפים קודם, או לבחור טווח זמן'],
  [/^(\S+) cannot go on an adjustment: (.+)$/, (m) => `האפקט הזה אינו יכול לחול על שכבת התאמה: ${adjustmentReasonHe(m[2]!)}. אפשר לשים אותו על הקליפ עצמו`],
  [/^an adjustment goes on an adjustment track, not on \S+ track \S+$/, () => 'שכבת התאמה נמצאת רק ברצועת התאמה'],
  [/^start must be >= 0 and duration > 0$/, () => 'ההתחלה אינה יכולה להיות לפני תחילת ציר הזמן, והאורך חייב להיות לפחות פריים אחד'],
  [/^an adjustment clip has no source or picture of its own, so it cannot be (.+)$/, () => 'לשכבת התאמה אין מקור או תמונה משלה, ולכן הפעולה הזו אינה אפשרית בה. אפשר לבצע אותה על הקליפים שמתחתיה'],
  [/^only the opacity of an adjustment clip can be (set|animated): it has no picture of its own to move, scale or turn$/, () => 'בשכבת התאמה אפשר לשנות רק את האטימות: אין לה תמונה משלה להזיז, להגדיל או לסובב. כדי להגביל את המראה לחלק מהפריים אפשר להוסיף לה מסכה'],
  [/^an adjustment clip can only change its opacity; (\S+) also changes (.+)$/, () => 'שכבת התאמה יכולה לשנות רק את האטימות שלה, והתנועה הזו גם מזיזה, מגדילה או מסובבת. אפשר לבחור הופעה או היעלמות בדהייה'],
  [/^only adjustment clips go on adjustment track \S+$/, () => 'ברצועת התאמה יכולות להיות רק שכבות התאמה'],
  [/^masks apply to picture clips on video tracks and to adjustment clips$/, () => 'מסכה חלה על קליפי תמונה ברצועות וידאו ועל שכבות התאמה'],
  [/^effects, blends, masks and transitions apply to picture, title and adjustment clips$/, () => 'אפקטים, מצבי מיזוג, מסכות ומעברים חלים על קליפי תמונה, על כותרות ועל שכבות התאמה'],
  // the validation codes adjustment_transform and adjustment_effect, met as an invalid result
  [/^transaction would produce an invalid project: adjustment clip \S+: only opacity can be set or animated$/, () => 'בשכבת התאמה אפשר לשנות רק את האטימות: אין לה תמונה משלה להזיז, להגדיל או לסובב'],
  [/^transaction would produce an invalid project: adjustment clip \S+: (\S+): (.+)$/, (m) => `אפקט בשכבת ההתאמה אינו יכול לחול עליה: ${adjustmentReasonHe(m[2]!)}`],
  // replace_clip_media
  [/^only clips that play a file can take another file$/, () => 'רק לקליפ שמנגן קובץ אפשר לתת קובץ אחר. כותרת משנים בעריכת הטקסט'],
  [/^a colour table \(LUT\) is not placed on the timeline; it is applied to a clip as an effect$/, () => 'טבלת צבע (LUT) אינה מונחת על ציר הזמן; היא חלה על קליפ כאפקט'],
  [/^this clip (shows a picture|plays sound), and the file has no (picture|sound)$/, (m) => (m[2] === 'picture' ? 'הקליפ הזה מציג תמונה, ולקובץ שנבחר אין תמונה' : 'הקליפ הזה מנגן קול, ולקובץ שנבחר אין קול')],
  [/^the clip linked to this one \(\S+\) (shows a picture|plays sound), and the file has no (picture|sound)$/, (m) => `הקליפ המקושר לקליפ הזה ${m[2] === 'picture' ? 'מציג תמונה, ולקובץ שנבחר אין תמונה' : 'מנגן קול, ולקובץ שנבחר אין קול'}. אפשר לנתק אותו ולהשאיר אותו כמו שהוא`],
  [/^a still picture cannot replace a clip that plays at another speed, backwards, as a freeze frame or with a gradual change of speed$/, () => 'תמונה סטטית אינה יכולה להחליף קליפ שמתנגן במהירות אחרת, לאחור, כפריים קפוא או בשינוי מהירות הדרגתי'],
  [/^this clip has privacy regions, which are drawn on video pictures only$/, () => 'לקליפ הזה יש אזורי פרטיות, והם מצוירים רק על וידאו'],
  [/^a privacy region of this clip follows a motion track of its current file$/, () => 'אזור פרטיות בקליפ הזה עוקב אחרי מסלול מעקב של הקובץ הנוכחי שלו; יש להפוך אותו לקבוע או להסיר אותו קודם'],
  [/^sourceIn is outside the asset$/, () => 'נקודת ההתחלה נמצאת מחוץ לקובץ'],
  [/^the file is too short for this clip from that point$/, () => 'הקובץ קצר מדי לקליפ הזה מהנקודה שנבחרה'],
  [/^the transition into the next clip needs (\d+) spare source frames after this clip, and the file has only (\d+)$/, (m) => `המעבר לקליפ הבא צריך ${m[1]} פריימים של חומר מקור אחרי הקליפ הזה, ובקובץ יש רק ${m[2]}`],
  [/^the clip already plays this file from this point$/, () => 'הקליפ כבר מנגן את הקובץ הזה מהנקודה הזו'],
  [/^linked clip \S+ is on locked track \S+$/, () => 'קליפ מקושר לקליפ הזה נמצא ברצועה נעולה'],
  // apply_template: a plan the server built is wrong
  [/^template step \d+ \(\S+\): .+$/, () => `אחד השלבים של התבנית אינו תקין, ולכן היא לא הוחלה. ${TEMPLATE_FAULT_HE}`],
  [/^template step \d+ uses ".*", which is not a public operation$/, () => `התבנית ביקשה פעולה שאינה מותרת לה, ולכן היא לא הוחלה. ${TEMPLATE_FAULT_HE}`],
  [/^slot \d+ \(\S+\) names no clip the template made$/, () => `משבצת בתבנית אינה מצביעה על קליפ שהתבנית יצרה. ${TEMPLATE_FAULT_HE}`],
  [/^asset key ".*" is given twice$/, () => `קובץ של התבנית מופיע פעמיים. ${TEMPLATE_FAULT_HE}`],
  [/^a template run holds at most (\d+) slots; this one would hold (\d+)$/, (m) => `בהחלת תבנית יכולות להיות עד ${m[1]} משבצות, וכאן היו ${m[2]}`],
  [/^run \S+ is a run of \S+, not of \S+$/, () => 'ההחלה הקודמת שייכת לתבנית אחרת, ולכן אי אפשר ליצור אותה מחדש בתבנית הזו'],
];
/** The refusal's detail in the interface language when it is one of the common ones, else undefined (show the server's own text). */
export function translateRefusal(lang: 'he' | 'en', message: string): string | undefined {
  if (lang !== 'he') return undefined;
  for (const [re, say] of [...HE, ...HE_AUDIO_FX, ...HE_TEMPLATES]) { const m = re.exec(message); if (m) return say(m); }
  return undefined;
}
/** The patterns, for the test that keeps them in step with the server's wording. */
export const REFUSAL_PATTERNS: readonly RegExp[] = HE.map(([re]) => re);
/** The sound-effect patterns, for their own test. */
export const AUDIO_FX_REFUSAL_PATTERNS: readonly RegExp[] = HE_AUDIO_FX.map(([re]) => re);
/** The patterns of adjustment layers, replacing media and templates (ADR-0016), for their own test. */
export const TEMPLATE_REFUSAL_PATTERNS: readonly RegExp[] = HE_TEMPLATES.map(([re]) => re);
