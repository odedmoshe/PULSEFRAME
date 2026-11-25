/**
 * The pearls surfaces' strings (wave 7 pearls track). Builder C owns this file. The words live in packages/i18n/src/pearls.ts
 * (`pearl.*`, Hebrew first); this reads them for the interface language and fills the {placeholders}. Numbers are drawn in
 * <bdi dir="ltr"> by the components; labels with dir="auto".
 *
 * PEARLS_EXTRA: the few sentences the pre-pass dictionary did not hold (the interface needed them after it landed). They sit here
 * because packages/i18n belongs to the pre-pass; the integration step may move them into pearls.ts (same keys, `pearl.<key>`), after
 * which the dictionary wins and these are never read. Same rule as the dictionary: no word judges a cut (pearls-wording.test.ts).
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const PEARLS_EXTRA: Record<Lang, Record<string, string>> = {
  he: {
    formSave: 'שמירה', stripLabel: 'פנינים שמורות וקטעים שכבר בשימוש', stripPearl: 'פנינה שמורה', stripUsed: 'בשימוש בסרט', stripNone: 'עוד אין פנינות שמורות בקובץ הזה',
    whoHint: 'סמנו מי מופיע בקליפ. זה תיוג ידני, בלי זיהוי פנים', whoNoPeople: 'עוד אין אנשים בפרויקט. אפשר להוסיף אותם ברשימת האנשים', whoOpenPeople: 'פתיחת רשימת האנשים',
    whoSaved: 'התיוג נשמר', whoCleared: 'התיוג הוסר', whoTitle: 'מי בקליפ?', whoOwnerOnly: 'רק בעל הפרויקט מתייג אנשים, מהחלון שלו',
    colWho: 'מי', colTime: 'זמן על המסך', colShare: 'חלק מזמן התמונה', screenNone: 'עוד אין קליפים על הציר', screenSeconds: '{seconds} שנ׳',
    filmPearlsNote: 'מכל קובץ נכנסת פנינה אחת: הראשונה שסימנתם בו', filmPearlsLegend: 'פנינים בסרט',
    shortMade: 'השורט נוצר מהפנינה', loading: 'טוען את הפנינים…',
  },
  en: {
    formSave: 'Save', stripLabel: 'Saved pearls and stretches already in use', stripPearl: 'Saved pearl', stripUsed: 'Used in the film', stripNone: 'No saved pearls in this file yet',
    whoHint: 'Mark who appears in the clip. This is a manual tag, no face recognition', whoNoPeople: 'There are no people in the project yet. Add them in the people list', whoOpenPeople: 'Open the people list',
    whoSaved: 'The tag was saved', whoCleared: 'The tag was removed', whoTitle: 'Who is in the clip?', whoOwnerOnly: 'Only the project owner tags people, from their own session',
    colWho: 'Who', colTime: 'Time on screen', colShare: 'Share of the picture time', screenNone: 'There are no clips on the timeline yet', screenSeconds: '{seconds} s',
    filmPearlsNote: 'One pearl of each file goes in: the first one you marked in it', filmPearlsLegend: 'Pearls in the film',
    shortMade: 'The short was made from the pearl', loading: 'Loading the pearls…',
  },
};

export function pearlsT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`pearl.${key}`] ?? PEARLS_EXTRA[lang][key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
