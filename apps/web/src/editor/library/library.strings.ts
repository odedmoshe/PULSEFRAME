/**
 * The words of the library panels, Settings section, credits panel and archive choice (wave 7 library track), Hebrew first and
 * English with the same keys (library.strings.test.ts keeps parity). The fixed product wording shared with the server (states,
 * kinds, badges, unusable reasons, export and archive lines, refusals) is packages/i18n/src/library.ts and is read through
 * `libText`. Placeholders are {name}. No string calls an item cleared, safe or verified: the editor states the duty and what it
 * could not check.
 */
import { dictionaries, type Key, type Lang } from '@pulseframe/i18n';

export const LIBRARY_UI_HE = {
  audioTab: 'מהספרייה', elementsBuiltin: 'מובנים', elementsLibrary: 'מהספרייה',
  search: 'חיפוש בספרייה', searchHint: 'למשל «רגוע פסנתר» או «חנוכיה»',
  genre: 'ז׳אנר', mood: 'מצב רוח', tempo: 'קצב', length: 'אורך', noCredit: 'בלי קרדיט', commercial: 'מותר גם מסחרית',
  play: 'האזנה', stop: 'עצירה', use: 'שימוש בפרויקט', useAtPlayhead: 'הוספה במיקום הסמן', licence: 'טקסט הרישיון', colour: 'צבע',
  bytesToCopy: '{size} יועתקו לפרויקט', prefixHeuristic: 'חיפוש גם בלי ה׳ ו׳ ב׳ ל׳ מ׳ ש׳ כ׳ בתחילת מילה (ניחוש)',
  notConfigured: 'הספרייה לא מוגדרת', openSettings: 'פתיחת ההגדרות', indexing: 'סורקים את הספרייה… {rows} פריטים עד כה',
  noMusic: 'אין עדיין מוזיקה בספרייה', empty: 'לא נמצא דבר', notBuilt: 'הספרייה עוד לא נבנתה בגרסה הזו',
  soft3d: '256 פיקסלים — רך מעל רבע מהמסך',
  settingsTitle: 'הספרייה שלי', root: 'תיקיית הספרייה', rootHint: 'התיקייה שכלי ההורדה מילא (זו שיש בה _manifests)', save: 'שמירה', reindex: 'סריקה מחדש',
  verifiedNever: 'לא אומת מאז ההורדה', counts: '{n} פריטים',
  creditsTitle: 'קרדיטים', creditsNone: 'אין בסרטון חומר שדורש קרדיט', copyCredits: 'העתקת קרדיטים לתיאור', copied: 'הועתק',
  creditsCard: 'כרטיס קרדיטים', creditsCardNote: 'הכרטיס מתעדכן בכל לחיצה, ושינויים ידניים בו יוחלפו',
  missingOnScreen: 'קרדיט שחייב להופיע בסרטון לא מופיע בו',
  pasteNote: 'הדביקו את הטקסט בתיאור בזמן ההעלאה. תביעת זכויות על המוזיקה משתחררת רק כשהקרדיט כתוב בתיאור; את זה אי אפשר לבדוק מכאן',
  archiveTitle: 'קבצים מהספרייה בארכיון', archiveStrip: 'ארכיון לשיתוף', archiveStripNote: 'בלי קבצים שאסור להעביר לאחרים',
  archiveKeep: 'ארכיון לעצמי', archiveKeepNote: 'למחשבים שלך בלבד — כולל קבצים שאסור להעביר לאחרים',
  nonCommercialLine: 'לשימוש לא מסחרי בלבד: {titles}',
} as const;
export const LIBRARY_UI_EN: Record<keyof typeof LIBRARY_UI_HE, string> = {
  audioTab: 'From the library', elementsBuiltin: 'Built-in', elementsLibrary: 'From the library',
  search: 'Search the library', searchHint: 'For example "calm piano" or "menorah"',
  genre: 'Genre', mood: 'Mood', tempo: 'Tempo', length: 'Length', noCredit: 'No credit', commercial: 'Commercial use allowed',
  play: 'Listen', stop: 'Stop', use: 'Use in project', useAtPlayhead: 'Add at the playhead', licence: 'Licence text', colour: 'Colour',
  bytesToCopy: '{size} will be copied into the project', prefixHeuristic: 'Also searches Hebrew words without a leading ה ו ב ל מ ש כ (a guess)',
  notConfigured: 'The library is not set up', openSettings: 'Open Settings', indexing: 'Scanning the library… {rows} items so far',
  noMusic: 'No music in the library yet', empty: 'Nothing found', notBuilt: 'The library is not built in this version yet',
  soft3d: '256 pixels — soft above a quarter of the screen',
  settingsTitle: 'My library', root: 'Library folder', rootHint: 'The folder the download tool filled (the one with _manifests)', save: 'Save', reindex: 'Scan again',
  verifiedNever: 'Not verified since download', counts: '{n} items',
  creditsTitle: 'Credits', creditsNone: 'Nothing in the video needs a credit', copyCredits: 'Copy credits for the description', copied: 'Copied',
  creditsCard: 'Credits card', creditsCardNote: 'The card is remade each time; hand edits to it are replaced',
  missingOnScreen: 'A credit that must appear in the video does not',
  pasteNote: 'Paste the text into the description when you upload. A music claim is released only when the credit is in the description; that cannot be checked from here',
  archiveTitle: 'Library files in the archive', archiveStrip: 'Archive to share', archiveStripNote: 'Without files that may not be passed on',
  archiveKeep: 'Archive for yourself', archiveKeepNote: 'For your own computers only — holds files that may not be passed on',
  nonCommercialLine: 'Non-commercial use only: {titles}',
};
export const LIBRARY_UI_STRINGS = { he: LIBRARY_UI_HE, en: LIBRARY_UI_EN } as const;
export const fillLib = (s: string, vars: Record<string, string | number> = {}): string => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
/** The shared product wording (packages/i18n/src/library.ts) in the interface language. */
export const libText = (lang: Lang, key: Key & `library.${string}`): string => dictionaries[lang][key];
