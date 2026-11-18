import { effectParamLabel } from './effectParams.ts';
import { HE_LIFE } from './lifeline.ts';
import { HE_PACKS } from './packs.ts';
import { HE_PEOPLE, HE_PEOPLE_SERVER } from './people.ts';
import { HE_RENDER_CACHE, HE_RENDER_CACHE_PURGE } from './renderCache.ts';
import { HE_IMPORT_QUEUE } from './phoneDrop.ts';
import { HE_FAMILY_FILM } from './familyFilm.ts';
import { HE_SHORTS } from './shorts.ts';

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
  [/^transaction would produce an invalid project: title \S+ has live fields, and these brace groups in it are not fields: (.+)$/, (m) => `בכותרת עם שדות חיים יש סוגריים מסולסלים שאינם שדה: ${m[1]}. אפשר לבחור שדה מהתפריט, או להכפיל את הסוגריים כדי שיופיעו כטקסט`],
  [/^transaction would produce an invalid project: title \S+ has live fields, and these brace groups in its wording for format \S+ are not fields: (.+)$/, (m) => `בנוסח של הכותרת לפורמט הזה יש סוגריים מסולסלים שאינם שדה: ${m[1]}. אפשר לבחור שדה מהתפריט, או להכפיל את הסוגריים כדי שיופיעו כטקסט`],
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
  // [\s\S]: a step whose arguments fail its operation's schema is worded by z.prettifyError over more than one line
  [/^template step \d+ \(\S+\): [\s\S]+$/, () => `אחד השלבים של התבנית אינו תקין, ולכן היא לא הוחלה. ${TEMPLATE_FAULT_HE}`],
  [/^template step \d+ uses ".*", which is not a public operation$/, () => `התבנית ביקשה פעולה שאינה מותרת לה, ולכן היא לא הוחלה. ${TEMPLATE_FAULT_HE}`],
  [/^slot \d+ \(\S+\) names no clip the template made$/, () => `משבצת בתבנית אינה מצביעה על קליפ שהתבנית יצרה. ${TEMPLATE_FAULT_HE}`],
  [/^asset key ".*" is given twice$/, () => `קובץ של התבנית מופיע פעמיים. ${TEMPLATE_FAULT_HE}`],
  [/^a template run holds at most (\d+) slots; this one would hold (\d+)$/, (m) => `בהחלת תבנית יכולות להיות עד ${m[1]} משבצות, וכאן היו ${m[2]}`],
  [/^run \S+ is a run of \S+, not of \S+$/, () => 'ההחלה הקודמת שייכת לתבנית אחרת, ולכן אי אפשר ליצור אותה מחדש בתבנית הזו'],
  [/^template \S+ needs a model that is not installed, so it is never applied$/, () => 'התבנית הזו צריכה מודל שאינו מותקן במחשב הזה, ולכן היא לעולם אינה מוחלת. תבנית לעולם אינה מורידה מודלים'],
];
/**
 * Refusals of the timeline-behaviour operations (UX redesign wave A: set_timeline_behaviour, ripple_delete_clips), with their own
 * case in packages/evals/src/refusal-wording.test.ts, which provokes each of them. Refusals they share with other edits (a locked
 * track, a linked clip on a locked track) are worded in the tables above.
 */
const HE_TIMELINE: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^nothing to change: give mainMagnet or rippleDelete$/, () => 'לא צוין מה לשנות בהתנהגות ציר הזמן'],
  [/^clip \S+ not found$/, () => 'הקליפ לא נמצא; ייתכן שכבר נמחק'],
  [/^linked clips \S+ and \S+ would move by different amounts$/, () => 'שני קליפים מקושרים היו צריכים לזוז בכמות שונה, ולכן הרווח לא נסגר. אפשר למחוק קליפים מרצועה אחת בכל פעם, או לנתק את הקישור ביניהם'],
  [/^closing the gap would place clip \S+ before 0$/, () => `סגירת הרווח הייתה מזיזה קליפ מקושר אל לפני תחילת ציר הזמן (צליל שמתחיל לפני התמונה שלו). אפשר למחוק ולהשאיר את הרווח (${ltr('Shift+Delete')}), או לקצר קודם את תחילת הצליל הזה`],
  [/^closing the gap would put clip \S+ over clip \S+ on track \S+$/, () => `סגירת הרווח הייתה מניחה קליפ על קליפ אחר שנשאר במקומו. אפשר למחוק ולהשאיר את הרווח (${ltr('Shift+Delete')}), או להזיז קודם את הקליפ שמפריע`],
  [/^clip \S+ on locked track \S+ is linked to a clip this edit removes or divides, and would be left linked to nothing$/, () => 'קליפ ברצועה נעולה מקושר לקליפ שהפעולה מוחקת או מחלקת, והקישור שלו היה נשאר בלי בן זוג. יש לבטל קודם את נעילת הרצועה'],
];
/** The refusal's detail in the interface language when it is one of the common ones, else undefined (show the server's own text). */
export function translateRefusal(lang: 'he' | 'en', message: string): string | undefined {
  if (lang !== 'he') return undefined;
  for (const [re, say] of [...HE, ...HE_AUDIO_FX, ...HE_AI, ...HE_TREND, ...HE_PORTRAIT, ...HE_TRACKING, ...HE_TEMPLATES, ...HE_LIFE, ...HE_PACKS, ...HE_PEOPLE, ...HE_TIMELINE, ...HE_RENDER_CACHE, ...HE_RENDER_CACHE_PURGE, ...HE_IMPORT_QUEUE, ...HE_FAMILY_FILM, ...HE_SHORTS]) { const m = re.exec(message); if (m) return say(m); }
  for (const [re, say] of HE_PEOPLE_SERVER) { const m = re.exec(message); if (m) return say(m, (inner) => translateRefusal('he', inner)); }
  // The export routes wrap the first blocker (Exporter.start, the browser export): worded only when the blocker itself is.
  const start = /^export cannot start: ([\s\S]+)$/.exec(message);
  if (start) { const inner = translateRefusal('he', start[1]!); if (inner) return `אי אפשר להתחיל את הייצוא: ${inner}`; }
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
/** The motion tracking patterns (ADR-0015), for their own case of refusal-wording.test.ts. */
export const TRACKING_REFUSAL_PATTERNS: readonly RegExp[] = HE_TRACKING.map(([re]) => re);
/** The patterns of adjustment layers, replacing media and templates (ADR-0016), for their own test. */
export const TEMPLATE_REFUSAL_PATTERNS: readonly RegExp[] = HE_TEMPLATES.map(([re]) => re);
/** The life-line patterns (ADR-0021; the table is in lifeline.ts), for their own test (packages/evals/src/lifeline-wording.test.ts). */
export const LIFE_REFUSAL_PATTERNS: readonly RegExp[] = HE_LIFE.map(([re]) => re);
/** The patterns of the content packs and built-in music (ADR-0022; the table is in packs.ts), for their own test (packages/evals/src/packs-wording.test.ts). */
export const PACK_REFUSAL_PATTERNS: readonly RegExp[] = HE_PACKS.map(([re]) => re);
/** The patterns of the people operations (ADR-0021, people section; the table is in people.ts), for packages/evals/src/people-wording.test.ts. */
export const PEOPLE_REFUSAL_PATTERNS: readonly RegExp[] = HE_PEOPLE.map(([re]) => re);
/** The server's people refusals (peoplePrivacy.ts), for packages/evals/src/people-wording.test.ts. */
export const PEOPLE_SERVER_REFUSAL_PATTERNS: readonly RegExp[] = HE_PEOPLE_SERVER.map(([re]) => re);
/** The patterns of the timeline-behaviour operations (set_timeline_behaviour, ripple_delete_clips), for their own case of refusal-wording.test.ts. */
export const TIMELINE_REFUSAL_PATTERNS: readonly RegExp[] = HE_TIMELINE.map(([re]) => re);
/** The fast export's blockers and job failures (ADR-0024; the table is in renderCache.ts), for packages/evals/src/render-cache-wording.test.ts. */
export const RENDER_CACHE_REFUSAL_PATTERNS: readonly RegExp[] = HE_RENDER_CACHE.map(([re]) => re);
/** The privacy purge's sentences (ADR-0024) and the import queue's own (ADR-0023), for packages/evals/src/wave5-wording.test.ts. */
export const WAVE5_REFUSAL_PATTERNS: readonly RegExp[] = [...HE_RENDER_CACHE_PURGE, ...HE_IMPORT_QUEUE].map(([re]) => re);
/** The family film's and measured moments' patterns (familyFilm.ts HE_FAMILY_FILM), for family-film-wording.test.ts. */
export const FAMILY_FILM_REFUSAL_PATTERNS: readonly RegExp[] = HE_FAMILY_FILM.map(([re]) => re);
/** The shorts patterns (ADR-0018: sequence operations and shorts routes), for packages/evals/src/shorts-wording.test.ts. */
export const SHORTS_REFUSAL_PATTERNS: readonly RegExp[] = HE_SHORTS.map(([re]) => re);
