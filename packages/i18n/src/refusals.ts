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
  // set_colour_grade (colour match, ADR-0014): a fixed value would be ignored where the value is animated
  [/^these colour values are animated with keyframes, so a fixed setting would be ignored$/, () => 'ערכי הצבע האלה מונפשים בנקודות מפתח, ולכן ערך קבוע לא ישפיע עליהם. אפשר להחליף את ההנפשה בערך הזה או לשנות את נקודות המפתח'],
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
 * Refusals of the AI-model wave's operations (ADR-0017): a derived copy in place of a clip's file, and machine-translated language
 * formats. Their own list with their own test (packages/evals/src/ai-refusal-wording.test.ts provokes each).
 */
const HE_AI: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^only a picture or sound clip shows a file$/, () => 'רק לקליפ של תמונה או של קול יש קובץ'],
  [/^a freeze frame cannot be given another file$/, () => 'אי אפשר להחליף את הקובץ של פריים קפוא. אפשר להחליף את הקובץ קודם, ואז ליצור את הפריים הקפוא'],
  [/^a clip that plays backwards cannot be given another file$/, () => 'אי אפשר להחליף את הקובץ של קליפ שמתנגן לאחור. אפשר להחזיר אותו לניגון קדימה, להחליף את הקובץ ולהפוך אותו שוב'],
  [/^the clip already shows this file$/, () => 'הקליפ כבר מציג את הקובץ הזה'],
  [/^the new file was not made from the file this clip shows$/, () => 'הקובץ החדש לא נוצר מהקובץ שהקליפ מציג'],
  [/^the new file has no picture$/, () => 'בקובץ החדש אין תמונה'],
  [/^the new file has no sound$/, () => 'בקובץ החדש אין קול'],
  [/^a still picture and a moving picture cannot stand in for each other$/, () => 'תמונה סטטית ווידאו אינם יכולים להחליף זה את זה'],
  [/^the new file does not keep the timing of the file this clip shows$/, () => 'הקובץ החדש אינו שומר על התזמון של הקובץ שהקליפ מציג, ולכן הקליפ היה מציג רגעים אחרים. אפשר להניח אותו ברצועה משלו'],
  [/^the new file covers (-?[\d.]+)s–(-?[\d.]+)s of the original; the clip needs (-?[\d.]+)s–(-?[\d.]+)s$/, (m) => `הקובץ החדש מכסה את השניות ${ltr(`${m[1]}–${m[2]}`)} של המקור, והקליפ צריך את השניות ${ltr(`${m[3]}–${m[4]}`)}`],
  [/^this format is not a translation$/, () => 'הפורמט הזה אינו תרגום'],
  [/^the translation is already marked as reviewed$/, () => 'התרגום כבר מסומן כנבדק'],
  [/^the translation is already marked as needing review$/, () => 'התרגום כבר מסומן כממתין לבדיקה'],
  [/^phrase \S+ not found in any transcript$/, () => 'המשפט שתורגם כבר לא נמצא בתמלול (ייתכן שנמחק בזמן התרגום)'],
  [/^caption cue \S+ not found$/, () => 'הכתובית שתורגמה כבר לא נמצאת (ייתכן שנמחקה בזמן התרגום)'],
  [/^only cues of a manual caption track are translated as cues$/, () => 'רק כתוביות של רצועת כתוביות ידנית מתורגמות ככתוביות'],
];
/**
 * Refusals of the transition options (ADR-0012: set_transition_options, and set_transition when it keeps an option). Kept as
 * their own list, provoked one by one in packages/evals/src/refusal-wording.test.ts, so the inventory of the list above stays as it is.
 */
const HE_TREND: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^the previous clip has only (\d+) unused source frames after its end; the transition at velocity ×(\d) needs (\d+)$/, (m) => `לקליפ הקודם נשארו רק ${m[1]} פריימים של חומר מקור אחרי סופו; מעבר עם רמפת מהירות ${ltr(`×${m[2]}`)} צריך ${m[3]}`],
  [/^the clip has only (\d+) source frames before its start; the transition at velocity ×(\d) needs (\d+)$/, (m) => `לקליפ נשארו רק ${m[1]} פריימים של חומר מקור לפני תחילתו; מעבר עם רמפת מהירות ${ltr(`×${m[2]}`)} צריך ${m[3]}`],
  [/^a velocity ramp cannot remap a clip that plays backwards or is a freeze frame$/, () => 'רמפת מהירות אינה אפשרית כשאחד הקליפים מתנגן לאחור או הוא פריים קפוא'],
  [/^a velocity ramp cannot remap a clip whose first effect is a time effect$/, () => 'רמפת מהירות אינה אפשרית כשהאפקט הראשון של אחד הקליפים הוא אפקט זמן'],
  [/^a velocity ramp needs a video on at least one side of the transition$/, () => 'רמפת מהירות צריכה וידאו לפחות בצד אחד של המעבר; בתמונה סטטית אין תנועה להאיץ'],
  [/^a transition locked to the beat needs at least 3 frames; this one has (\d+)$/, (m) => `מעבר שננעל לפעימה צריך לפחות 3 פריימים; במעבר הזה יש ${m[1]}`],
  [/^the \S+ transition has no (color|seed) option$/, (m) => (m[1] === 'color' ? 'לסוג המעבר הזה אין בחירת צבע' : 'לסוג המעבר הזה אין וריאציות')],
  [/^clip \S+ has no transition$/, () => 'אין מעבר בתחילת הקליפ הזה; יש לבחור קודם סוג מעבר'],
];
/**
 * Refusals of portrait blur («טשטוש רקע לתמונה», ADR-0017; packages/core/src/recipes.ts). Their own list, provoked one by one in
 * packages/core/src/recipes.test.ts, so the AI list above keeps its own inventory test.
 */
const HE_PORTRAIT: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^portrait blur works on a still picture clip$/, () => 'טשטוש רקע פועל על קליפ של תמונה סטטית; לווידאו צריך חיתוך של כל פריים, ואת זה הגרסה הזו לא עושה'],
  [/^the cut-out \S+ is not in the project$/, () => 'החיתוך (התמונה בלי הרקע) כבר לא נמצא בפרויקט. אפשר להריץ שוב את הסרת הרקע על התמונה'],
  [/^the cut-out was not made from the picture this clip shows$/, () => 'החיתוך לא נוצר מהתמונה שהקליפ מציג. יש להריץ את הסרת הרקע על התמונה של הקליפ הזה'],
  [/^remove the transition into the next clip first$/, () => 'יש להסיר קודם את המעבר אל הקליפ הבא'],
];
/** The refusal's detail in the interface language when it is one of the common ones, else undefined (show the server's own text). */
export function translateRefusal(lang: 'he' | 'en', message: string): string | undefined {
  if (lang !== 'he') return undefined;
  for (const [re, say] of [...HE, ...HE_AUDIO_FX, ...HE_AI, ...HE_TREND, ...HE_PORTRAIT]) { const m = re.exec(message); if (m) return say(m); }
  return undefined;
}
/** The patterns, for the test that keeps them in step with the server's wording. */
export const REFUSAL_PATTERNS: readonly RegExp[] = HE.map(([re]) => re);
/** The sound-effect patterns, for their own test. */
export const AUDIO_FX_REFUSAL_PATTERNS: readonly RegExp[] = HE_AUDIO_FX.map(([re]) => re);
/** The AI-model wave patterns (ADR-0017), for their own test. */
export const AI_REFUSAL_PATTERNS: readonly RegExp[] = HE_AI.map(([re]) => re);
/** The transition-option patterns (ADR-0012), for their own test. */
export const TREND_REFUSAL_PATTERNS: readonly RegExp[] = HE_TREND.map(([re]) => re);
/** The portrait-blur patterns (ADR-0017), for their own test (packages/core/src/recipes.test.ts). */
export const PORTRAIT_REFUSAL_PATTERNS: readonly RegExp[] = HE_PORTRAIT.map(([re]) => re);
