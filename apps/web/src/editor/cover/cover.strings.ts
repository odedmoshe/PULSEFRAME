/**
 * The block's strings (wave 8 cover). W3 owns this file after the pre-pass. The words live in packages/i18n/src/cover.ts (`cover.*`,
 * Hebrew first); this reads them for the interface language and fills the {placeholders}. A sentence the shared table does not
 * have goes in EXTRA (Hebrew first, both languages, plural address) for the lead to move into i18n.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export const EXTRA = { he: {}, en: {} } as const satisfies Record<'he' | 'en', Record<string, string>>;

export function coverT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  const extra = EXTRA[lang === 'he' ? 'he' : 'en'] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`cover.${key}`] ?? extra[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
