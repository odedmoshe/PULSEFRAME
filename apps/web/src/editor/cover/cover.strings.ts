/**
 * The block's strings (wave 8 cover). W3 owns this file after the pre-pass. The words live in packages/i18n/src/cover.ts (`cover.*`,
 * Hebrew first, both languages with the same keys); this reads them for the interface language and fills the {placeholders}.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function coverT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`cover.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
