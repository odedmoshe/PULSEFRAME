/**
 * The trip map surfaces' strings (wave 8 tripmap track). W3 owns this file. The words live in packages/i18n/src/tripMap.ts (`tripMap.*`,
 * Hebrew first, plural address); this reads them for the interface language and fills the {placeholders}. Coordinates, seconds and
 * frame numbers are drawn in <bdi dir="ltr"> by the components.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';
import type { MapPayload } from '@pulseframe/core';

export function tripMapT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`tripMap.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
/** The arrow between stop names in a label: in travel order, pointing the reading direction's way (Hebrew ←, English →). */
export const STOP_ARROW: Readonly<Record<Lang, string>> = { he: ' ← ', en: ' → ' };
/** «מפה: תל אביב ← ירושלים ← לונדון» — the shown stops' names as typed (hidden via-points left out). */
export function tripMapLabel(map: MapPayload, lang: Lang): string {
  return tripMapT(lang)('timelineLabel', { stops: map.stops.filter((s) => !s.hidden).map((s) => s.name).join(STOP_ARROW[lang]) });
}
