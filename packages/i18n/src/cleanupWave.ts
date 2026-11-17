/**
 * Interface strings of voice cleanup «ניקוי קול» (ADR-0013) and colour match «התאמת צבע» (ADR-0014), spread into `he` and `en`
 * (index.ts). Hebrew first; the English dictionary must cover the same keys. Shared keys of these two features are namespaced
 * `cleanup.*` and `colour.*` (wave-3 decisions); the operation names are `op.*`, as for every operation (op-wording.test.ts).
 * The panels' own strings live next to them (apps/web/src/editor/voiceClean.strings.ts, colourMatch.strings.ts).
 */
export const CLEANUP_WAVE_HE = {
  'op.clean_voice': 'ניקוי קול', 'op.set_colour_grade': 'קביעת תיקון צבע',
} as const;
export const CLEANUP_WAVE_EN: Record<keyof typeof CLEANUP_WAVE_HE, string> = {
  'op.clean_voice': 'Voice cleanup', 'op.set_colour_grade': 'Set colour grade',
};
