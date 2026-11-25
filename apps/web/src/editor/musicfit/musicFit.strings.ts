/**
 * The musicfit surfaces' strings (wave 7 musicfit track). Builder C owns this file. The words live in packages/i18n/src/musicFit.ts
 * (`musicfit.*`, Hebrew first); this reads them for the interface language and fills the {placeholders}. Numbers, frames and times
 * are drawn in <bdi dir="ltr"> by the components; the timeline stays left-to-right, so "earlier" is always left.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function musicFitT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`musicfit.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
