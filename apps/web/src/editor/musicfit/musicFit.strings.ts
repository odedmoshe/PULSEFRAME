/**
 * The musicfit surfaces' strings (wave 7 musicfit track). Builder C owns this file. The words that the lead's pre-pass fixed live in
 * packages/i18n/src/musicFit.ts (`musicfit.*`, Hebrew first); `musicFitT` reads them for the interface language and fills the
 * {placeholders}. The sentences the surfaces need beyond those (the notes of a plan by code, the swap dialog, the join row, the
 * impact result, the accessible names) were builder C's `EXTRA`; at integration they moved into i18n (MUSICFIT_EXTRA, `musicfit.<key>`). Numbers, frames and times are drawn in <bdi dir="ltr"> by
 * the components; the timeline stays left-to-right, so "earlier" is always left.
 * No string says that an ending or a join sounds good: nobody has listened (core MUSICFIT_FORBIDDEN_WORDS; musicFit.logic.test.ts).
 */
import { dictionaries, MUSICFIT_EXTRA, type Lang } from '@pulseframe/i18n';

/** Builder C's sentences, now in packages/i18n/src/musicFit.ts (MUSICFIT_EXTRA, served as `musicfit.<key>`); re-exported for the tests. */
export const EXTRA = MUSICFIT_EXTRA;
export type ExtraKey = keyof (typeof EXTRA)['he'];

export type MusicFitT = (key: string, vars?: Record<string, string | number>) => string;
/** The interface strings: `musicfit.*` of the shared dictionary (builder C's sentences included). A missing key shows the key, never nothing. */
export function musicFitT(lang: Lang): MusicFitT {
  const d = dictionaries[lang] as Record<string, string>;
  return (key, vars = {}) => (d[`musicfit.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
