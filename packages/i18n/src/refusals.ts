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
];
/** The refusal's detail in the interface language when it is one of the common ones, else undefined (show the server's own text). */
export function translateRefusal(lang: 'he' | 'en', message: string): string | undefined {
  if (lang !== 'he') return undefined;
  for (const [re, say] of HE) { const m = re.exec(message); if (m) return say(m); }
  return undefined;
}
/** The patterns, for the test that keeps them in step with the server's wording. */
export const REFUSAL_PATTERNS: readonly RegExp[] = HE.map(([re]) => re);
