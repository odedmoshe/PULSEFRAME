/**
 * The «תמונה חיה» surfaces' strings (wave 8 living track). W3 owns this file. The words live in packages/i18n/src/living.ts
 * (`living.*`, `depth.*`; Hebrew first, plural address); this reads them for the interface language and fills the {placeholders}.
 * Numbers are drawn in <bdi dir="ltr"> by the components.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function livingT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
