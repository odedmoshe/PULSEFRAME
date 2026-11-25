/**
 * The strings of «כלים מוקלטים» in the editor (wave 7 instruments track). Builder W3 owns this file. The words live in
 * packages/i18n/src/instruments.ts (`instruments.*`, Hebrew first); `instrumentsT` reads them for the interface language and fills the
 * {placeholders}. A missing key shows the key, never nothing. No string says a recorded kit sounds better, real, warm or natural.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';

export type InstrumentsT = (key: string, vars?: Record<string, string | number>) => string;
export function instrumentsT(lang: Lang): InstrumentsT {
  const d = dictionaries[lang] as Record<string, string>;
  return (key, vars = {}) => (d[`instruments.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
