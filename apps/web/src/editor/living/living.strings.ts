/**
 * The «תמונה חיה» surfaces' strings (wave 8 living track). W3 owns this file. The words live in packages/i18n/src/living.ts
 * (`living.*`, `depth.*`; Hebrew first, plural address); this reads them for the interface language and fills the {placeholders}.
 * Numbers are drawn in <bdi dir="ltr"> by the components.
 * LOCAL_HE / LOCAL_EN: the few lines the frozen dictionary does not have (reported to the lead as missing keys, to move into
 * packages/i18n/src/living.ts at integration; until then they are read from here, same key names).
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const LOCAL_HE = {
  'living.pasteLeftOut': 'התמונה החיה לא הועתקה: היא נעשית בלשונית התנועה',
  'living.refused': 'לא נשמר',
  'living.amountValue': 'עוצמה {n}',
  'living.moveGroup': 'סוג התנועה',
  'depth.tools': 'כלים',
  'depth.canvasLabel': 'התמונה עם העומק שצויר עליה',
  'depth.horizonValue': 'קו אופק ב־{n} מתוך 1000 מהגובה',
  'depth.strokes': '{n} משיכות',
  'depth.photoMissing': 'התמונה לא נטענה, אבל אפשר לראות את העומק ולשמור אותו',
  'depth.gridMissing': 'העומק לא הוצג: חישוב הרשת עוד לא זמין בגרסה הזו, ולכן אי אפשר לשמור',
  'depth.keys': 'מקשים: 1 קרוב · 2 רחוק · Ctrl+Z מבטל משיכה',
} as const;
export const LOCAL_EN: Record<keyof typeof LOCAL_HE, string> = {
  'living.pasteLeftOut': 'The living picture was not copied: it is made in the Motion tab',
  'living.refused': 'Not saved',
  'living.amountValue': 'Amount {n}',
  'living.moveGroup': 'Kind of move',
  'depth.tools': 'Tools',
  'depth.canvasLabel': 'The photo with the drawn depth over it',
  'depth.horizonValue': 'Horizon line at {n} of 1000 of the height',
  'depth.strokes': '{n} strokes',
  'depth.photoMissing': 'The photo did not load, but the depth can be seen and saved',
  'depth.gridMissing': 'The depth is not shown: the grid calculation is not available in this version yet, so it cannot be saved',
  'depth.keys': 'Keys: 1 near · 2 far · Ctrl+Z undoes a stroke',
};

export function livingT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  const local = (lang === 'he' ? LOCAL_HE : LOCAL_EN) as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[key] ?? local[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
