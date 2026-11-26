/**
 * The pearls surfaces' strings (wave 7 pearls track). Builder C owns this file. The words live in packages/i18n/src/pearls.ts
 * (`pearl.*`, Hebrew first); this reads them for the interface language and fills the {placeholders}. Numbers are drawn in
 * <bdi dir="ltr"> by the components; labels with dir="auto". Every key is in the dictionary (the wording test checks them all).
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function pearlsT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`pearl.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
