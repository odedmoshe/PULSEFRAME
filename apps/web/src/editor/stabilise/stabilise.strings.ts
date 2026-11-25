/**
 * The block's strings (wave 7 stabilise track). W3 owns this file. The words themselves live in packages/i18n/src/stabilise.ts
 * (`stab.*`, Hebrew first); this file reads them for the interface language and fills the {placeholders}.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export function stabiliseT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`stab.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
