/**
 * The words of «ציור חי» in the editor (wave 8 ink). W3 owns this file after the pre-pass. The words live in packages/i18n/src/ink.ts
 * (`ink.*`, Hebrew first); this reads them for the interface language and fills {placeholders}. A sentence the shared table does not
 * have goes in EXTRA (Hebrew first, both languages, plural address) for the lead to move into i18n.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const EXTRA = { he: {}, en: {} } as const satisfies Record<'he' | 'en', Record<string, string>>;

export function inkT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  const extra = EXTRA[lang === 'he' ? 'he' : 'en'] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`ink.${key}`] ?? extra[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
