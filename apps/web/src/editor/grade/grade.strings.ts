/**
 * The curves block's and the scope additions' strings (wave 8 grade). The words live in packages/i18n/src/grade.ts (`grade.*`, Hebrew
 * first, plural address); this reads them for the interface language and fills the {placeholders}. The preset names come from core
 * GRADE_CURVE_PRESETS (he/en). Numbers are drawn in <bdi dir="ltr"> by the components. W2 and W3 read; the lead owns this file.
 */
import { dictionaries, type Lang } from '@pulseframe/i18n';
import { GRADE_CURVE_PRESETS, type GradeCurveChannel, type GradeCurvePresetId } from '@pulseframe/core';

export function gradeT(lang: Lang) {
  const d = dictionaries[lang] as Record<string, string>;
  return (key: string, vars: Record<string, string | number> = {}): string => (d[`grade.${key}`] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}
/** «נקודה 2 מתוך 4 בעקומה הכללית» / "Point 2 of 4 on the master curve" (n is 1-based). */
export const pointLabel = (lang: Lang, channel: GradeCurveChannel, n: number, of: number) => gradeT(lang)('point', { n, of, curveOf: gradeT(lang)(`curveOf.${channel}`) });
/** «כניסה 64, יציאה 80» / "in 64, out 80": the point's aria-valuetext and the visible status line. */
export const pointValueText = (lang: Lang, input: number, output: number) => gradeT(lang)('valuetext', { in: input, out: output });
export const presetName = (lang: Lang, id: GradeCurvePresetId) => GRADE_CURVE_PRESETS.find((p) => p.id === id)![lang];
