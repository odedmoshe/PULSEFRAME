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
 * Refusals of the motion tracking operations («מעקב תנועה», ADR-0015): motion tracks, following them and privacy regions.
 * Their own list, so the inventory of the list above stays as it is; packages/evals/src/refusal-wording.test.ts provokes
 * every one of them in a case of its own. A motion track is «מסלול מעקב» (a timeline track stays «רצועה»).
 */
const TIME_EFFECTS_HE = '(הד, פיצול זמן, צמצם או קפיצות פריים)';
const HE_TRACKING: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^motion track \S+ not found$/, () => 'מסלול המעקב לא נמצא'],
  [/^track \S+ not found$/, () => 'הרצועה לא נמצאה'],
  [/^a motion track follows something in a video; this file has no video$/, () => 'מסלול מעקב עוקב אחרי משהו בתוך וידאו, ולקובץ הזה אין וידאו'],
  [/^frame (\d+) is past the last frame of the video \((\d+)\)$/, (m) => `הפריים ${m[1]} נמצא אחרי הפריים האחרון של הווידאו (${m[2]})`],
  [/^the samples reach past the last frame of the video \((\d+)\)$/, (m) => `הדגימות מגיעות אל מעבר לפריים האחרון של הווידאו (${m[1]})`],
  [/^a region track needs the size of its box \(w and h\)$/, () => 'מעקב אחרי אזור צריך את גודל המסגרת שלו (רוחב וגובה)'],
  [/^a point track has no box: w and h belong to region tracks$/, () => 'למעקב אחרי נקודה אין מסגרת: רוחב וגובה שייכים למעקב אחרי אזור'],
  [/^a region track needs sizes \(s\)$/, () => 'במעקב אחרי אזור חסרים הגדלים של הדגימות'],
  [/^a point track has no sizes \(s\)$/, () => 'למעקב אחרי נקודה אין גודל'],
  [/^x, y, s, q and st must have the same length$/, () => 'עמודות הדגימות שהתקבלו אינן באותו אורך'],
  [/^measured samples cannot be marked manual$/, () => 'דגימות שנמדדו אינן יכולות להיות מסומנות כמיקום שנקבע ביד'],
  [/^a project can hold at most (\d+) motion tracks$/, (m) => `בפרויקט יכולים להיות עד ${m[1]} מסלולי מעקב. אפשר למחוק מסלול שכבר אינו בשימוש`],
  [/^a motion track can hold at most (\d+) samples; this edit would make (\d+)$/, (m) => `מסלול מעקב יכול להכיל עד ${m[1]} דגימות, והעריכה הזו הייתה מגיעה ל־${m[2]}. אפשר לעקוב אחרי קטע קצר יותר`],
  [/^the motion tracks of a project can hold at most (\d+) samples in all; this edit would make (\d+)$/, (m) => `כל מסלולי המעקב בפרויקט יחד יכולים להכיל עד ${m[1]} דגימות, והעריכה הזו הייתה מגיעה ל־${m[2]}. אפשר למחוק מסלול שכבר אינו בשימוש`],
  [/^nothing to change: give name, set, markLost or interpolate$/, () => 'לא צוין מה לשנות במסלול המעקב'],
  [/^frame (\d+) is set twice$/, (m) => `הפריים ${m[1]} נקבע פעמיים באותה עריכה`],
  [/^(markLost|interpolate): the stretch must end after it starts \(to is one past its last frame\)$/, () => 'הקטע חייב להסתיים אחרי שהוא מתחיל'],
  [/^(markLost|interpolate): the stretch must lie inside the track \(source frames (\d+) to (\d+)\)$/, (m) => `הקטע חייב להיות בתוך מסלול המעקב (פריימי מקור ${m[2]} עד ${m[3]})`],
  [/^filling in needs a usable sample before the stretch and another after it$/, () => 'כדי להשלים קטע צריך מיקום אמין לפניו ומיקום אמין אחריו. אפשר לסמן מיקום ביד בכל צד'],
  [/^(\d+) clip\(s\) follow this motion track or hide a region with it$/, (m) => `${m[1]} קליפים עוקבים אחרי מסלול המעקב הזה או מסתירים אזור בעזרתו; יש לנתק אותם קודם, או למחוק עם ניתוק`],
  [/^(\d+) clip\(s\) still follow a motion track of this file or hide a region with one$/, (m) => `${m[1]} קליפים עדיין עוקבים אחרי מסלול מעקב של הקובץ הזה או מסתירים אזור בעזרתו; יש לנתק אותם קודם`],
  [/^only a title, or a picture on a video track, can follow a motion track$/, () => 'רק כותרת, או תמונה ברצועת וידאו, יכולות לעקוב אחרי מסלול מעקב'],
  [/^a clip follows a picture on a video track; track \S+ is a \S+ track$/, () => 'קליפ עוקב אחרי תמונה ברצועת וידאו, והרצועה שנבחרה אינה רצועת וידאו'],
  [/^a clip cannot follow the picture on its own track$/, () => 'קליפ אינו יכול לעקוב אחרי התמונה שברצועה שלו עצמו; אפשר להעביר אותו לרצועה שמעליה'],
  [/^a clip with a time effect \(echo, time split, shutter or stutter\) cannot follow a motion track yet$/, () => `קליפ עם אפקט זמן ${TIME_EFFECTS_HE} עדיין אינו יכול לעקוב אחרי מסלול מעקב`],
  [/^clip \S+ on that track follows a motion track itself; follows cannot be chained$/, () => 'קליפ ברצועה שנבחרה עוקב בעצמו אחרי מסלול מעקב, ואי אפשר לשרשר מעקבים; אפשר לעקוב ישירות אחרי אותו מסלול'],
  [/^clip \S+ follows the picture on this clip's track; follows cannot be chained$/, () => 'קליפ אחר עוקב אחרי התמונה שברצועה של הקליפ הזה, ואי אפשר לשרשר מעקבים'],
  [/^privacy regions apply to video clips on video tracks$/, () => 'אזורי פרטיות חלים על קליפי וידאו ברצועות וידאו'],
  [/^privacy regions are drawn on video pictures only; this clip shows a still image$/, () => 'אזורי פרטיות מצוירים רק על וידאו, והקליפ הזה מציג תמונה סטטית. לתמונה סטטית אפשר לשים עותק שלה ברצועה שמעליה עם אפקט טשטוש ומסכה'],
  [/^name the region to delete \(regionId\)$/, () => 'יש לציין איזה אזור פרטיות למחוק'],
  [/^region \S+ not found on clip \S+$/, () => 'אזור הפרטיות לא נמצא בקליפ הזה'],
  [/^a clip can carry at most (\d+) privacy regions$/, (m) => `לקליפ אפשר להוסיף עד ${m[1]} אזורי פרטיות`],
  [/^a privacy region follows a motion track of the clip's own video file$/, () => 'אזור פרטיות יכול לעקוב רק אחרי מסלול מעקב של קובץ הווידאו של הקליפ עצמו'],
];
/** The refusal's detail in the interface language when it is one of the common ones, else undefined (show the server's own text). */
export function translateRefusal(lang: 'he' | 'en', message: string): string | undefined {
  if (lang !== 'he') return undefined;
  for (const [re, say] of [...HE, ...HE_AUDIO_FX, ...HE_TRACKING]) { const m = re.exec(message); if (m) return say(m); }
  return undefined;
}
/** The patterns, for the test that keeps them in step with the server's wording. */
export const REFUSAL_PATTERNS: readonly RegExp[] = HE.map(([re]) => re);
/** The sound-effect patterns, for their own test. */
export const AUDIO_FX_REFUSAL_PATTERNS: readonly RegExp[] = HE_AUDIO_FX.map(([re]) => re);
/** The motion tracking patterns (ADR-0015), for their own case of refusal-wording.test.ts. */
export const TRACKING_REFUSAL_PATTERNS: readonly RegExp[] = HE_TRACKING.map(([re]) => re);
