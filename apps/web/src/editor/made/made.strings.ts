/**
 * The words of «קליפ מקוד» in the interface (wave 8 motioncode, W3). The shared words live in packages/i18n/src/made.ts (`made.*`; read
 * only here); the few interface words that file does not have are the `ui.*` rows below, Hebrew and English with the same keys (plural
 * Hebrew address, no gendered forms). Nothing here calls a clip good, sharp or safe: nobody has watched a made clip.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const MADE_UI_HE = {
  'ui.loading': 'טוענים את הדפים המוכנים…',
  'ui.loadFailed': 'אי אפשר לטעון את הדפים המוכנים. בדקו שהעורך מחובר לשרת ונסו שוב',
  'ui.noTemplates': 'אין דפים מוכנים בגרסה הזו. אפשר להדביק דף בחלק «הדבקת דף (מתקדם)»',
  'ui.fields': 'שדות הדף',
  'ui.pasteLabel': 'דף HTML',
  'ui.pasteWarnings': 'הערות על הדף',
  'ui.pasteOverrides': 'כשיש כאן דף, הוא מצויר במקום הדף המוכן שנבחר',
  'ui.editHint': 'הדף והערכים נטענו מהקליפ שבציר. האורך נשאר כמו של הקליפ',
  'ui.pageLoading': 'טוענים את הדף של הקליפ…',
  'ui.starting': 'מתחילים לצייר…',
  'ui.stopYes': 'עצירה',
  'ui.stopNo': 'המשך לצייר',
  'ui.failedTitle': 'הציור לא הצליח',
  'ui.checks': 'מה נמדד',
  'ui.warnings': 'הערות',
  'ui.stills': 'שלושה פריימים מהקליפ: ראשון, אמצעי ואחרון',
  'ui.stillAlt': 'פריים {k} מתוך 3',
  'ui.videoAlt': 'הקליפ, על רקע משובץ שמראה את השקיפות',
  'ui.working': 'עובדים על זה…',
  'ui.nameFallback': 'קליפ מקוד',
  'ui.invalid': 'הערך בשדה «{label}» לא תקין: {why}',
  'ui.invalidColour': 'צבע בצורת #rrggbb',
  'ui.invalidNumber': 'מספר בין {min} ל־{max}',
  'ui.invalidLong': 'עד {max} תווים',
  'ui.noProject': 'אין פרויקט פתוח. פתחו פרויקט ונסו שוב',
  'ui.editFailed': 'אי אפשר לפתוח את הקליפ לעריכה',
  'ui.flashInspector': 'הקליפ מהבהב {rate} פעמים בשנייה (נמדד על {on})',
} as const;

export const MADE_UI_EN: Record<keyof typeof MADE_UI_HE, string> = {
  'ui.loading': 'Loading the ready pages…',
  'ui.loadFailed': 'The ready pages could not be loaded. Check that the editor is connected to the server and try again',
  'ui.noTemplates': 'There are no ready pages in this version. You can paste a page under "Paste a page (advanced)"',
  'ui.fields': 'Page fields',
  'ui.pasteLabel': 'HTML page',
  'ui.pasteWarnings': 'Notes about the page',
  'ui.pasteOverrides': 'When a page is here, it is drawn instead of the ready page you chose',
  'ui.editHint': 'The page and its values were loaded from the clip on the timeline. The length stays the clip\'s',
  'ui.pageLoading': 'Loading the clip\'s page…',
  'ui.starting': 'Starting to draw…',
  'ui.stopYes': 'Stop',
  'ui.stopNo': 'Keep drawing',
  'ui.failedTitle': 'Drawing did not succeed',
  'ui.checks': 'What was measured',
  'ui.warnings': 'Notes',
  'ui.stills': 'Three frames from the clip: first, middle and last',
  'ui.stillAlt': 'Frame {k} of 3',
  'ui.videoAlt': 'The clip, on a checkerboard that shows the transparency',
  'ui.working': 'Working on it…',
  'ui.nameFallback': 'Clip from code',
  'ui.invalid': 'The value in "{label}" is not valid: {why}',
  'ui.invalidColour': 'a colour like #rrggbb',
  'ui.invalidNumber': 'a number from {min} to {max}',
  'ui.invalidLong': 'up to {max} characters',
  'ui.noProject': 'No project is open. Open a project and try again',
  'ui.editFailed': 'The clip could not be opened for editing',
  'ui.flashInspector': 'The clip flashes {rate} times a second (measured on {on})',
};

export type MadeVars = Record<string, string | number>;
export type MadeT = (key: string, vars?: MadeVars) => string;

/** The `made.*` words of the shared dictionary plus the `ui.*` rows above, for one language; {name} placeholders filled from `vars`. */
export function madeT(lang: Lang): MadeT {
  const d = dictionaries[lang] as Record<string, string>;
  const ui = (lang === 'he' ? MADE_UI_HE : MADE_UI_EN) as Record<string, string>;
  return (key, vars = {}) => (ui[key] ?? d[`made.${key}`] ?? d[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** A template with its {placeholders} split into text and value parts, so a component can draw each value in <bdi dir="ltr">. */
export type Part = { text: string } | { num: string };
export function madeParts(lang: Lang, key: string, vars: MadeVars): Part[] {
  const ui = (lang === 'he' ? MADE_UI_HE : MADE_UI_EN) as Record<string, string>;
  const d = dictionaries[lang] as Record<string, string>;
  const tpl = ui[key] ?? d[`made.${key}`] ?? d[key] ?? key;
  const out: Part[] = [];
  let last = 0;
  for (const m of tpl.matchAll(/\{(\w+)\}/g)) {
    if (m.index > last) out.push({ text: tpl.slice(last, m.index) });
    out.push({ num: String(vars[m[1]!] ?? m[0]) });
    last = m.index + m[0].length;
  }
  if (last < tpl.length) out.push({ text: tpl.slice(last) });
  return out;
}
