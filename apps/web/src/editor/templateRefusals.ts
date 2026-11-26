/**
 * Refusals met in the template dialog and the post-apply bar (ADR-0016), worded in the interface language like the editor's
 * own refusal path (store.ts `fail`): the headline of the code from the dictionary, then the detail. The detail goes through
 * the editor's common table first (translateRefusal: the operations' refusals, apply_template's among them), then through
 * this track's table of the planner's and the template routes' refusals (packages/core/src/templatePlan.ts,
 * apps/server/src/templates.ts). Hints written for API callers ("POST …", "Pass media: …") are reworded for a person in both
 * languages. Anything not recognised is shown as the server wrote it.
 */
import { dictionaries, translateRefusal } from '@pulseframe/i18n';
import { ApiFailure } from '../api.ts';
import { TEMPLATE_STRINGS } from './templates.strings.ts';

export interface Failure { code: string | null; message: string; hint?: string }
type Lang = 'he' | 'en';
/** A left-to-right run (keys, ids) isolated inside the Hebrew sentence. */
const ltr = (s: string) => `⁦${s}⁩`;

/** The planner's and the template routes' refusals in Hebrew (the English is the server's own sentence). */
const DETAIL_HE: [RegExp, (m: RegExpExecArray, details: unknown) => string][] = [
  [/^the music has no beat analysis yet$/, () => 'למוזיקה עדיין אין מדידת קצב'],
  [/^the beat analysis of this music has no bar starts, and this template counts in bars$/, () => 'במדידת הקצב של המוזיקה אין תחילות של תיבות, והתבנית הזו סופרת בתיבות'],
  [/^fewer than two measured beats lie after the music's start$/, () => 'אחרי נקודת ההתחלה של המוזיקה יש פחות משתי פעימות מדודות'],
  [/^template \S+ cuts on the beats of music: choose a music file$/, () => 'התבנית הזו חותכת על הפעימות של מוזיקה, ולכן צריך לבחור קובץ מוזיקה'],
  [/^music asset \S+ is not in this project$/, () => 'קובץ המוזיקה שנבחר אינו נמצא בפרויקט'],
  [/^asset \S+ is not a sound file$/, () => 'הקובץ שנבחר כמוזיקה אינו קובץ קול'],
  [/^choose at least one picture or video$/, () => 'צריך לבחור לפחות תמונה אחת או סרטון אחד'],
  [/^asset \S+ is not in this project$/, () => 'אחד הקבצים שנבחרו אינו נמצא בפרויקט'],
  [/^asset \S+ has no picture$/, () => 'לאחד הקבצים שנבחרו אין תמונה'],
  [/^template \S+ has no text "(.*)"$/, (m) => `לתבנית אין טקסט בשם ${ltr(m[1]!)}`],
  [/^the music ends before the first slot of this template does$/, () => 'המוזיקה נגמרת לפני שהמשבצת הראשונה של התבנית נגמרת'],
  [/^the slots of this template would be shorter than one frame here$/, () => 'המשבצות של התבנית היו קצרות כאן מפריים אחד'],
  [/^every item of this template was edited by hand since the last run; there is nothing to make again$/, () => 'כל הפריטים של התבנית נערכו ביד מאז ההחלה האחרונה, ולכן אין מה ליצור מחדש'],
  [/^every item of this template was edited or deleted by hand since the last run; there is nothing to make again$/, () => 'כל הפריטים של התבנית נערכו או נמחקו ביד מאז ההחלה האחרונה, ולכן אין מה ליצור מחדש'],
  [/^this plan would need (\d+) operations; at most (\d+) fit in one step$/, (m) => `התכנון היה צריך ${m[1]} פעולות, ובצעד אחד נכנסות לכל היותר ${m[2]}`],
  [/^this plan would record (\d+) slots; a run holds at most (\d+)$/, (m) => `התכנון היה רושם ${m[1]} משבצות, ובהחלה אחת יכולות להיות לכל היותר ${m[2]}`],
  [/^template \S+ places graphic elements, which this machine cannot draw: its ffmpeg has no SVG decoder \(librsvg\)$/, () => 'התבנית מציבה אלמנטים גרפיים, והמחשב הזה אינו יכול לצייר אותם: ל־ffmpeg שלו אין מפענח SVG ‏(librsvg)'],
  [/^the template cannot apply like this: /, (_m, details) => {
    const code = (details as { blocking?: { code?: string }[] } | undefined)?.blocking?.[0]?.code;
    return (code && (TEMPLATE_STRINGS.he.warning as Record<string, string>)[code]) || 'פריט בתכנון מונע את ההחלה (ראו את התכנון)';
  }],
  [/^the template cannot regenerate like this: slot\(s\) .+ were edited by hand and are kept where they are, but no longer lie exactly on the range this plan gives them, so the new pictures would leave frames without a picture$/,
    () => 'פריטים שנערכו ביד נשמרים במקומם, אבל הם כבר אינם נמצאים בדיוק בטווח שהתכנון החדש נותן להם, ולכן היו נשארים פריימים בלי תמונה'],
  [/^this credential may only propose edits, and a template cannot be proposed: it is applied through an internal step that a proposal does not carry$/, () => 'ההרשאה הזו מאפשרת רק להציע עריכות, ואי אפשר להציע תבנית: היא מוחלת בצעד פנימי שהצעה אינה נושאת'],
  [/^template "\S+" does not exist$/, () => 'התבנית הזו אינה קיימת בגרסה הזו'],
  // a template saved from a film that this computer does not have (wave 8 owntemplate, C10; core OWN_TEMPLATE_REFUSALS.notOnThisComputer;
  // translateRefusal words it first through i18n HE_OWNTEMPLATE, this row keeps the template table complete): never "does not exist"
  [/^the template "tpl\.own-[0-9a-f]+" is not saved on this computer; undo still works and every clip stays editable$/, () => 'התבנית הזו לא שמורה במחשב הזה; ביטול הפעולה עובד וכל קטע נשאר לעריכה'],
  [/^template run \S+ not found$/, () => 'ההחלה הקודמת של התבנית כבר אינה קיימת'],
];

/** Hints: [server hint, Hebrew, English for a person (undefined = the server's own)]. */
const HINTS: [RegExp, (m: RegExpExecArray) => string, ((m: RegExpExecArray) => string) | undefined][] = [
  [/^Measure the beat of the music first\b/, () => TEMPLATE_STRINGS.he.needsAnalysis, () => TEMPLATE_STRINGS.en.needsAnalysis],
  [/^Mark the bar starts with edit_analysis \(downbeats\), or measure the beat again\.$/, () => 'אפשר לסמן את תחילות התיבות במדידת הקצב, או למדוד את הקצב שוב.', () => 'Mark the bar starts in the beat analysis, or measure the beat again.'],
  [/^Pass musicAssetId: a sound file whose beats were measured\.$/, () => 'יש לבחור בשלב המוזיקה קובץ קול שהקצב שלו נמדד.', () => 'In the music step, choose a sound file whose beat was measured.'],
  [/^Choose a sound-only file as the music\.$/, () => 'יש לבחור כמוזיקה קובץ של קול בלבד.', undefined],
  [/^Pass media: asset ids of pictures or videos, in order\.$/, () => 'יש לסמן תמונות או סרטונים בשלב הראשון.', () => 'Tick pictures or videos in the first step.'],
  [/^Choose pictures or videos for the slots\.$/, () => 'יש לבחור תמונות או סרטונים למשבצות.', undefined],
  [/^Its texts are: (.*)\.$/, (m) => `הטקסטים של התבנית: ${ltr(m[1]!)}.`, undefined],
  [/^Choose longer music, or start it earlier \(at\)\.$/, () => 'אפשר לבחור מוזיקה ארוכה יותר, או להתחיל אותה מוקדם יותר.', () => 'Choose longer music, or start it earlier.'],
  [/^Choose another tempo or other music\.$/, () => 'אפשר לבחור קצב אחר או מוזיקה אחרת.', undefined],
  [/^Use fewer media or a shorter template\.$/, () => 'אפשר לבחור פחות קבצים, או תבנית קצרה יותר.', undefined],
  [/^Install an ffmpeg build with librsvg and restart the server, or choose a template without elements\.$/, () => 'אפשר להתקין גרסת ffmpeg עם librsvg ולהפעיל מחדש את השרת, או לבחור תבנית בלי אלמנטים.', undefined],
  [/^Choose longer media for that slot, another tempo, or fewer slots \(see the plan\)\.$/, () => 'אפשר לבחור קובץ ארוך יותר למשבצת, קצב אחר או פחות משבצות (ראו את התכנון).', undefined],
  // a kept picture off its slot (apps/server/src/templates.ts refuseMovedKeptPictures): the server offers the run's tempo only when
  // another one was asked for; a request that was already a restore is told to delete that clip as well and restore again; for an
  // older run whose places cannot be worked out again it adds a sentence saying so (its technical reason is left to the API)
  [/^(?:Regenerate with the run's tempo \((normal|half|double)\), )?[Uu]ndo the hand edit that moved or trimmed slot\(s\) .+?, or delete that clip (as well )?and regenerate with restoreRemoved: true (?:again so the template makes it again too|so the template fills the slot again)\.( This run was made before places were recorded, and where it placed its clips cannot be worked out again: .+ So a clip that was only moved counts as edited\.)?$/,
    (m) => `אפשר ${[...(m[1] ? [`ליצור מחדש בקצב של ההחלה (${TEMPLATE_STRINGS.he.tempoNames[m[1] as 'normal']})`] : []), 'לבטל את העריכה ביד שהזיזה או קיצרה את המשבצות', m[2] ? `או למחוק גם את הקליפ הזה וללחוץ שוב על «${TEMPLATE_STRINGS.he.restoreRemoved}» כדי שהתבנית תיצור גם אותו מחדש` : `או למחוק את הקליפ וליצור מחדש עם «${TEMPLATE_STRINGS.he.restoreRemoved}» כדי שהתבנית תמלא את המשבצת שוב`].join(', ')}.${m[3] ? ' ההחלה הזו נוצרה בגרסה קודמת שלא רשמה איפה הונח כל קליפ, ואי אפשר לשחזר את זה עכשיו, ולכן קליפ שרק זז נחשב כאן לקליפ שנערך.' : ''}`,
    (m) => { const said = `${[...(m[1] ? [`regenerate with the run's tempo (${TEMPLATE_STRINGS.en.tempoNames[m[1] as 'normal']})`] : []), 'undo the hand edit that moved or trimmed the slots', m[2] ? `or delete that clip as well and press “${TEMPLATE_STRINGS.en.restoreRemoved}” again so the template makes it again too` : `or delete that clip and regenerate with “${TEMPLATE_STRINGS.en.restoreRemoved}” so the template fills the slot again`].join(', ')}.`; return said[0]!.toUpperCase() + said.slice(1) + (m[3] ? ' This run was made by an earlier version that did not record where it placed each clip, and that cannot be worked out again now, so a clip that was only moved counts as edited here.' : ''); }],
  [/^Regenerate with restoreRemoved: true to make the deleted items again\.$/, () => `אפשר ליצור מחדש עם «${TEMPLATE_STRINGS.he.restoreRemoved}» כדי שהפריטים שנמחקו ייווצרו שוב.`, () => `Regenerate with “${TEMPLATE_STRINGS.en.restoreRemoved}” to make the deleted items again.`],
  [/^Ask the project owner to apply the template, or for a grant in edit mode\.( plan_template still shows what it would do\.)?$/, () => 'אפשר לבקש מבעל/ת הפרויקט להחיל את התבנית, או לבקש הרשאה במצב עריכה.', () => 'Ask the project owner to apply the template, or for a grant in edit mode.'],
  [/^Choose one of the available templates \(GET \/api\/v1\/templates\)\.$|^Available: .* \(GET \/api\/v1\/templates\)\.$/, () => 'אפשר לבחור אחת מהתבניות הזמינות.', () => 'Choose one of the available templates.'],
  [/^Undo still works and every clip stays editable\.$/, () => 'אפשר לבטל את הפעולה, וכל קטע נשאר לעריכה ביד.', () => 'Undo still works, and every clip stays editable by hand.'],
  [/^A template run id is returned by apply \(runId\)\.$/, () => 'אפשר להחיל את התבנית שוב.', () => 'Apply the template again.'],
  // the planner's built-in-music refusals (templatePlan.ts; their details are worded in i18n HE_PACKS)
  [/^Send musicAssetId: null together with builtinMusic, and builtinMusic: null together with musicAssetId/, () => 'יש לבחור מקור מוזיקה אחד: קובץ מהספרייה או מוזיקה מובנית.', () => 'Choose one source of music: a file from the library or built-in music.'],
  [/^The styles are: .* \(GET \/api\/v1\/music\)\.$/, () => 'אפשר לבחור אחד מסגנונות המוזיקה המובנית שברשימה.', () => 'Choose one of the built-in music styles in the list.'],
  [/^Use fewer or shorter slots \(tempo: double\), or choose a music file instead \(musicAssetId\)\.$/, () => 'אפשר לבחור קצב כפול או פחות קבצים, או לבחור קובץ מוזיקה מהספרייה.', () => 'Choose double tempo or fewer files, or a music file from the library.'],
];

/** The hint for a person in the interface language; the server's own when it is not one of the above. */
export function templateHint(lang: Lang, hint: string): string {
  for (const [re, he, en] of HINTS) { const m = re.exec(hint); if (m) return lang === 'he' ? he(m) : en ? en(m) : hint; }
  return hint;
}
/** The detail in the interface language when it is known (the common table, then this one), else undefined. */
export function templateDetail(lang: Lang, message: string, details?: unknown): string | undefined {
  const common = translateRefusal(lang, message);
  if (common !== undefined || lang !== 'he') return common;
  for (const [re, say] of DETAIL_HE) { const m = re.exec(message); if (m) return say(m, details); }
  return undefined;
}
/** A refusal (or any other error) as the dialog and the post-apply bar show it. */
export function templateRefusal(lang: Lang, e: unknown): Failure {
  if (!(e instanceof ApiFailure)) return { code: null, message: e instanceof Error ? e.message : String(e) };
  const headline = (dictionaries[lang] as Record<string, string>)[`error.code.${e.code}`];
  const detail = templateDetail(lang, e.message, e.details) ?? e.message;
  return { code: e.code, message: headline ? `${headline}: ${detail}` : detail, ...(e.hint ? { hint: templateHint(lang, e.hint) } : {}) };
}
