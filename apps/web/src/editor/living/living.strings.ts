/**
 * The «תמונה חיה» surfaces' strings (wave 8 living track). W3 owns this file. The words live in packages/i18n/src/living.ts
 * (`living.*`, `depth.*`; Hebrew first, plural address); this reads them for the interface language and fills the {placeholders}.
 * Numbers are drawn in <bdi dir="ltr"> by the components.
 * Every key is in the dictionary (the W3 local lines moved there at integration; living.strings.test.ts keeps it so).
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';
import { LIVING_UNAVAILABLE_WHY } from '@pulseframe/engine';

export function livingT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

/** The compositor's reason a living picture is not drawn (engine LIVING_UNAVAILABLE_WHY, or "the drawn depth could not be made: …") in the interface language; any other reason unchanged. */
export function livingReasonText(reason: string, lang: Lang): string {
  const t = livingT(lang);
  if (reason === LIVING_UNAVAILABLE_WHY.no_depth) return t('living.unavailable.no_depth');
  if (reason === LIVING_UNAVAILABLE_WHY.rotated) return t('living.unavailable.rotated');
  if (reason === LIVING_UNAVAILABLE_WHY.no_provider) return t('living.unavailable.no_provider');
  if (reason.startsWith('the drawn depth could not be made')) return t('living.unavailable.depth_failed');
  return reason;
}
