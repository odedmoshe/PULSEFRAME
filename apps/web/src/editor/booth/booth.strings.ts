/**
 * The page-only words of «תא הבדיקה» (wave 8 booth, builder W3): the sentences the dialog needs beyond the shared packages/i18n/src/booth.ts.
 * Hebrew addresses the owner in the plural (no singular imperative, no gendered form); English beside it with the same keys. Nothing
 * here calls anything good, right, sharp, safe or verified: nobody has seen or heard anything. Every refusal pairs its reason with the next step.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';
import type { BoothSay } from '@pulseframe/core';

const HE = {
  'page.loading': 'טוענים את תא הבדיקה…',
  'page.loadFailed': 'תא הבדיקה לא נטען: {why}',
  'page.retry': 'ניסיון חוזר',
  'page.start': 'התחלה', 'page.resume': 'המשך מהכרטיס הבא',
  'page.starting': 'מכינים את הכרטיסים…',
  'page.cardOf': 'כרטיס {n} מתוך {m}', 'page.back': 'חזרה למסך הראשון',
  'page.firstScreenHeading': 'תא הבדיקה: מה עושים עכשיו',
  'page.firstScreenNext': 'לחצו «התחלה» כדי לעבור על הכרטיסים אחד אחד. «הפעלת בדיקת המחשב» לא חובה, והיא עוזרת לסדר את הכרטיסים.',
  'page.save': 'שמירת התשובה', 'page.cancelProblems': 'חזרה בלי לשמור',
  'page.saving': 'שומרים…',
  'page.nextIs': 'נשמר. הכרטיס הבא: {title}', 'page.lastCard': 'נשמר. זה היה הכרטיס האחרון בחלק הזה. אפשר להעתיק את הדוח או לעבור ל«עוד».',
  'page.saveFailed': 'התשובה על «{title}» לא נשמרה: {why}', 'page.backToCard': 'חזרה לכרטיס',
  'page.prevNone': 'זה הכרטיס הראשון', 'page.nextFinish': 'סיום החלק',
  'page.minutes': 'כ־{n} דקות (הערכה)',
  'page.kind.audio': 'צליל', 'page.kind.picture': 'תמונה', 'page.kind.task': 'משימה',
  'page.skipPartNone': 'אין חלק נוסף אחרי הזה',
  'page.windowsNext': 'זה שלב של הגדרה, לא כרטיס עם תשובה. אחרי שניסיתם (או החלטתם לדלג) לחצו «הבא».',
  'page.windowsNotTried': 'לא נוסה: אף אחד עוד לא ניסה את השלב הזה במחשב הזה',
  'page.sound.play': 'הפעלת הצליל', 'page.sound.stop': 'עצירת הצליל',
  'page.sound.idle': 'עוד לא הושמע. לחצו «הפעלה» (או רווח כשהכפתור בפוקוס).', 'page.sound.loading': 'מכינים את הצליל…', 'page.sound.playing': 'מושמע עכשיו', 'page.sound.stopped': 'נעצר', 'page.sound.ended': 'ההשמעה הסתיימה. «שוב» משמיע מההתחלה',
  'page.sound.failed': 'הצליל לא הושמע: {why}. אפשר ללחוץ «הפעלה» שוב או לדלג',
  'page.sound.hashNote': 'הבייטים שהמחשב הזה קיבל נרשמים בדוח כקוד קצר; זו לא בדיקה של איך הצליל נשמע',
  'page.sound.volumeValue': 'עוצמה {n}%',
  'page.names': 'בהערה יש {n} שמות מגיליון האנשים. אפשר למחוק אותם לפני ההעתקה',
  'page.check.notRun': 'עוד לא הופעלה', 'page.check.running': 'בודקים…', 'page.check.invalid': 'השרת החזיר תשובה במבנה שלא מוכר. נסו שוב אחרי טעינה מחדש',
  'page.check.noAnswer': 'אין תשובה מהשרת: {why}',
  'page.check.heavyIdle': 'שורה כבדה: רצה רק מהכפתור שלה',
  'page.check.heavyBusy': 'שורה כבדה אחרת רצה עכשיו. חכו שתסתיים',
  'page.check.runningAll': 'בודקים את השורות הקלות…',
  'page.check.doneAll': 'שורות הבדיקה הקלות הסתיימו',
  'page.copied': 'הועתק', 'page.copyFailed': 'ההעתקה נכשלה. סמנו את הטקסט והעתיקו אותו בעצמכם (Ctrl+C)',
  'page.reportHeading': 'הדוח', 'page.reportHelp': 'הדוח נשלח למפתחים רק על ידיכם: «העתקת הדוח» ואז הדבקה בהודעה. שום דבר לא נשלח מכאן.',
  'page.reportNotBuilt': 'הדוח עוד לא נבנה בגרסה הזו. אין צורך לעשות דבר; אפשר להמשיך לענות, והתשובות נשמרות במחשב.',
  'page.reportFailed': 'הדוח לא נוצר. טענו את תא הבדיקה מחדש ונסו שוב',
  'page.reportSelected': 'הדוח מסומן. לחצו Ctrl+C כדי להעתיק',
  'page.moreHeading': 'פריטים נוספים', 'page.moreOpen': 'עוד', 'page.moreItems': '{n} פריטים', 'page.moreAnswered': '{done} מתוך {n} נענו',
  'page.focusHint': 'המקשים עובדים כשהמיקוד אינו בתוך שדה כתיבה',
  'page.pictureHeading': 'הציור של הדפדפן הזה',
} as const;
const EN: Record<keyof typeof HE, string> = {
  'page.loading': 'Loading the review booth…',
  'page.loadFailed': 'The review booth did not load: {why}',
  'page.retry': 'Try again',
  'page.start': 'Start', 'page.resume': 'Continue from the next card',
  'page.starting': 'Preparing the cards…',
  'page.cardOf': 'Card {n} of {m}', 'page.back': 'Back to the first screen',
  'page.firstScreenHeading': 'Review booth: what to do now',
  'page.firstScreenNext': 'Press «Start» to go through the cards one by one. «Run the computer check» is optional, and it helps order the cards.',
  'page.save': 'Save the answer', 'page.cancelProblems': 'Go back without saving',
  'page.saving': 'Saving…',
  'page.nextIs': 'Saved. The next card: {title}', 'page.lastCard': 'Saved. That was the last card of this part. You can copy the report or go on to «More».',
  'page.saveFailed': 'The answer on «{title}» was not saved: {why}', 'page.backToCard': 'Back to the card',
  'page.prevNone': 'This is the first card', 'page.nextFinish': 'Finish the part',
  'page.minutes': 'About {n} minutes (an estimate)',
  'page.kind.audio': 'Sound', 'page.kind.picture': 'Picture', 'page.kind.task': 'Task',
  'page.skipPartNone': 'There is no part after this one',
  'page.windowsNext': 'This is a setting step, not a card with an answer. After you tried it (or decided to skip it) press «Next».',
  'page.windowsNotTried': 'Not tried: nobody has tried this step on this computer yet',
  'page.sound.play': 'Play the sound', 'page.sound.stop': 'Stop the sound',
  'page.sound.idle': 'Not played yet. Press «Play» (or Space while the button has focus).', 'page.sound.loading': 'Preparing the sound…', 'page.sound.playing': 'Playing now', 'page.sound.stopped': 'Stopped', 'page.sound.ended': 'Playback ended. «Again» plays from the start',
  'page.sound.failed': 'The sound did not play: {why}. You can press «Play» again or skip it',
  'page.sound.hashNote': 'The bytes this computer received are written in the report as a short code; it is not a check of how the sound sounds',
  'page.sound.volumeValue': 'Volume {n}%',
  'page.names': 'A note holds {n} names from the people sheet. You can delete them before copying',
  'page.check.notRun': 'Not run yet', 'page.check.running': 'Checking…', 'page.check.invalid': 'The server answered in a shape that is not known. Reload and try again',
  'page.check.noAnswer': 'No answer from the server: {why}',
  'page.check.heavyIdle': 'A heavy row: it runs only from its own button',
  'page.check.heavyBusy': 'Another heavy row is running. Wait for it to finish',
  'page.check.runningAll': 'Checking the light rows…',
  'page.check.doneAll': 'The light rows of the check have finished',
  'page.copied': 'Copied', 'page.copyFailed': 'Copying failed. Select the text and copy it yourselves (Ctrl+C)',
  'page.reportHeading': 'The report', 'page.reportHelp': 'The report goes to the developers only through you: «Copy the report», then paste it in a message. Nothing is sent from here.',
  'page.reportNotBuilt': 'The report is not built in this build yet. Nothing to do; you can keep answering, and the answers are kept on this computer.',
  'page.reportFailed': 'The report was not made. Reload the review booth and try again',
  'page.reportSelected': 'The report is selected. Press Ctrl+C to copy',
  'page.moreHeading': 'More items', 'page.moreOpen': 'More', 'page.moreItems': '{n} items', 'page.moreAnswered': '{done} of {n} answered',
  'page.focusHint': 'The keys work while the focus is not inside a text field',
  'page.pictureHeading': 'This browser\'s drawing',
};
export const BOOTH_PAGE = { he: HE, en: EN } as const;
export type PageKey = keyof typeof HE;

const fill = (s: string, vars: Record<string, string | number>): string => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
/** The words of the dialog: the page-only strings first, then the shared dictionary (`booth.*`, `error.code.booth_*`). A missing key shows the key, never nothing. */
export function makeSay(lang: Lang): BoothSay {
  const shared = dictionaries[lang] as Record<string, string>;
  const page = BOOTH_PAGE[lang] as Record<string, string>;
  return (key, vars = {}) => fill(page[key] ?? shared[key] ?? key, vars);
}
