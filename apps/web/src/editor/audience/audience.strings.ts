/**
 * The audiences surfaces' strings (wave 8 audiences track). W3 owns this file. The words live in packages/i18n/src/audiences.ts
 * (`audience.*`, Hebrew first, plural address); this reads them for the interface language and fills the {placeholders}. Times and dB
 * are drawn in <bdi dir="ltr"> by the components.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function audienceT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`audience.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
