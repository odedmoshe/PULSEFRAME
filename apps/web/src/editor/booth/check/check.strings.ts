/**
 * Page-only words of the browser-side cards of «תא הבדיקה» (wave 8 booth, builder W2): what the picture card, the export strip and the
 * microphone card say that the shared dictionary (packages/i18n/src/booth.ts) has no key for. Hebrew first, plural address, English
 * beside it. Nothing here says good, right, sharp, safe or verified; the cards show what was drawn and measured, not a verdict.
 */
import type { Lang } from '@pulseframe/i18n';

export interface BoothPageStrings {
  pictureLoading: string; pictureFailed: string; pictureNoSceneKind: string;
  stillFirst: string; stillMid: string; stillLast: string; playing: string; playbackHeld: (n: number) => string;
  stripRun: string; stripRunning: (done: number, total: number) => string; stripFailed: string; stripBusy: string; stripEmpty: string;
  stripDone: string; stripAdapter: (a: string) => string; stripSoftware: string; stripItemFailed: string; stripSeenNote: string;
  adapterLine: (a: string) => string;
  micIdleHint: string; micAsking: string; micRecording: (s: number, max: number) => string; micStopped: (s: number) => string; micLimit: string;
  micDenied: string; micNoDevice: string; micUnsupported: string; micSilent: string; micStop: string; micPlaying: string; micAgain: string; micDropped: string;
  micLevelsLabel: string; micAudioLabel: string;
}
const clock = (s: number) => `${Math.floor(s)}.${Math.floor((s % 1) * 10)}`;
export const BOOTH_PAGE_STRINGS: Record<Lang, BoothPageStrings> = {
  he: {
    pictureLoading: 'טוענים את תמונות הבדיקה…', pictureFailed: 'תמונות הבדיקה לא נטענו. טענו את תא הבדיקה מחדש; אפשר גם לדלג על הפריט',
    pictureNoSceneKind: 'הפריט הזה אינו ציור של שתי תמונות; אי אפשר להציג אותו כאן',
    stillFirst: 'תחילת החלון', stillMid: 'אמצע', stillLast: 'סוף החלון', playing: 'מנגנים פעם אחת…',
    playbackHeld: (n) => `${n} הבהובים הוחזקו כדי להישאר בגבול של שלושה בשנייה`,
    stripRun: 'הצגת שבע התמונות מהייצוא', stripRunning: (d, t) => `מציירים בייצוא: ${d} מתוך ${t}`,
    stripFailed: 'תמונת הייצוא לא התקבלה. אפשר לנסות שוב מאוחר יותר או לדלג', stripBusy: 'ייצוא או עבודה אחרת רצים עכשיו. חכו שיסתיימו והפעילו שוב',
    stripEmpty: 'אין כאן מעברים לשורה הזו', stripDone: 'התמונות מוצגות. השוו בעין; שום מספר כאן לא אומר שהן זהות',
    stripAdapter: (a) => `כרטיס המסך בייצוא: ${a}`, stripSoftware: 'צויר בייצוא במתאם תוכנה — לא נחשב בדיקה על כרטיס המסך', stripItemFailed: 'לא התקבלה תמונה',
    stripSeenNote: 'כל תמונה מאמצע המעבר, מהייצוא',
    adapterLine: (a) => `כרטיס המסך בדפדפן: ${a}`,
    micIdleHint: 'לחצו «הקלטה», אמרו כמה מילים ושמעו אותן בחזרה',
    micAsking: 'מבקשים גישה למיקרופון…', micRecording: (s, m) => `מקליטים… ${clock(s)} מתוך ${clock(m)} שניות`, micStopped: (s) => `ההקלטה נעצרה אחרי ${clock(s)} שניות`,
    micLimit: 'ההקלטה נעצרה אחרי חמש שניות',
    micDenied: 'אין הרשאה למיקרופון — אפשרו אותה בהגדרות האתר של Chrome (סמל המנעול ליד הכתובת) וטענו מחדש',
    micNoDevice: 'לא נמצא מיקרופון. חברו מיקרופון או סמנו «דלגו»',
    micUnsupported: 'הדפדפן הזה לא מאפשר הקלטה. סמנו «דלגו»',
    micSilent: 'לא נקלט קול בכלל (שקט דיגיטלי)',
    micStop: 'עצירה', micPlaying: 'משמיעים מהזיכרון…', micAgain: 'הקלטה מחדש', micDropped: 'ההקלטה נמחקת מהזיכרון כשסוגרים את הכרטיס',
    micLevelsLabel: 'מדידות ההקלטה', micAudioLabel: 'ההקלטה, מהזיכרון',
  },
  en: {
    pictureLoading: 'Loading the test pictures…', pictureFailed: 'The test pictures did not load. Reload the review booth; you can also skip this item',
    pictureNoSceneKind: 'This item is not a drawing of two pictures; it cannot be shown here',
    stillFirst: 'Start of the window', stillMid: 'Middle', stillLast: 'End of the window', playing: 'Playing once…',
    playbackHeld: (n) => `${n} flashes were held back to stay within three a second`,
    stripRun: 'Show the seven pictures from the export', stripRunning: (d, t) => `Drawing in the export: ${d} of ${t}`,
    stripFailed: 'The export picture did not arrive. Try again later or skip', stripBusy: 'An export or other work is running now. Wait until it finishes, then run it again',
    stripEmpty: 'There are no transitions for this row', stripDone: 'The pictures are shown. Compare by eye; no number here says they are the same',
    stripAdapter: (a) => `Graphics card in the export: ${a}`, stripSoftware: 'Drawn in the export on a software adapter — not a check of the graphics card', stripItemFailed: 'No picture arrived',
    stripSeenNote: 'Each picture is the middle of the transition, from the export',
    adapterLine: (a) => `Graphics card in the browser: ${a}`,
    micIdleHint: 'Press «Record», say a few words and hear them back',
    micAsking: 'Asking for the microphone…', micRecording: (s, m) => `Recording… ${clock(s)} of ${clock(m)} seconds`, micStopped: (s) => `The recording stopped after ${clock(s)} seconds`,
    micLimit: 'The recording stopped after five seconds',
    micDenied: 'The microphone is not allowed — allow it in Chrome\'s site settings (the lock icon beside the address) and reload',
    micNoDevice: 'No microphone was found. Plug one in or mark «Skip»',
    micUnsupported: 'This browser cannot record. Mark «Skip»',
    micSilent: 'No sound was picked up at all (digital silence)',
    micStop: 'Stop', micPlaying: 'Playing from memory…', micAgain: 'Record again', micDropped: 'The recording is dropped from memory when you close the card',
    micLevelsLabel: 'Measurements of the recording', micAudioLabel: 'The recording, from memory',
  },
};
export const boothPageStrings = (lang: Lang): BoothPageStrings => BOOTH_PAGE_STRINGS[lang];
