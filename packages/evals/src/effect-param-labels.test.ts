import { describe, expect, it } from 'vitest';
import { describeAudioCatalog, describeCatalog } from '@pulseframe/core';
import { AUDIO_FX_OPTION_LABELS, AUDIO_FX_PARAM_LABELS, AUDIO_FX_PARAM_UNITS, EFFECT_OPTION_LABELS, EFFECT_PARAM_LABELS, EFFECT_PARAM_LABELS_BY_EFFECT, effectParamLabel } from '../../i18n/src/index.ts';

type L = { he: string; en: string };
/** Every parameter of every entry, and every option of an enum parameter, without a name in both languages. */
function missingNames(entries: { id: string; paramsSchema: unknown }[], params: Record<string, L>, options: Record<string, L>) {
  const missing: string[] = [];
  for (const e of entries) {
    const props = (e.paramsSchema as { properties: Record<string, { enum?: string[] }> }).properties;
    for (const [name, prop] of Object.entries(props)) {
      const l = params[name];
      if (!l?.he || !l.en) missing.push(`${e.id}.${name}`);
      for (const o of prop.enum ?? []) { const ol = options[o]; if (!ol?.he || !ol.en) missing.push(`${e.id}.${name}=${o}`); }
    }
  }
  return missing;
}

describe('effect parameter names', () => {
  it('every parameter and every option of every registered effect has a name in Hebrew and in English', () => {
    expect(missingNames(describeCatalog().effects, EFFECT_PARAM_LABELS, EFFECT_OPTION_LABELS)).toEqual([]);
  });
  it('every parameter and every option of every sound effect has a name of its own in Hebrew and in English (ADR-0010)', () => {
    expect(missingNames(describeAudioCatalog().audioEffects, AUDIO_FX_PARAM_LABELS, AUDIO_FX_OPTION_LABELS)).toEqual([]);
    // every unit word belongs to a sound-effect parameter that exists, and parameters measured in units have one
    const names = new Set(describeAudioCatalog().audioEffects.flatMap((e) => Object.keys((e.paramsSchema as { properties: object }).properties)));
    expect(Object.keys(AUDIO_FX_PARAM_UNITS).filter((k) => !names.has(k))).toEqual([]);
    expect([...names].filter((k) => /(Db|Hz|Khz|Ms|Seconds)$/.test(k) && !AUDIO_FX_PARAM_UNITS[k])).toEqual([]);
  });
  it('Hebrew names are Hebrew', () => {
    const overrides = Object.values(EFFECT_PARAM_LABELS_BY_EFFECT).flatMap((m) => Object.values(m));
    for (const l of [...Object.values(EFFECT_PARAM_LABELS), ...Object.values(EFFECT_OPTION_LABELS), ...Object.values(AUDIO_FX_PARAM_LABELS), ...Object.values(AUDIO_FX_OPTION_LABELS), ...Object.values(AUDIO_FX_PARAM_UNITS), ...overrides] as { he: string }[]) expect(l.he).toMatch(/[֐-׿]/);
  });
  it('per-effect names name a parameter that effect has, in both languages, and win over the shared name', () => {
    const effects = new Map(describeCatalog().effects.map((e) => [e.id, Object.keys((e.paramsSchema as { properties: Record<string, unknown> }).properties)]));
    const wrong: string[] = [];
    for (const [id, names] of Object.entries(EFFECT_PARAM_LABELS_BY_EFFECT))
      for (const [name, l] of Object.entries(names)) {
        if (!effects.get(id)?.includes(name) || !l.he || !l.en) wrong.push(`${id}.${name}`);
        for (const lang of ['he', 'en'] as const) expect(effectParamLabel(name, lang, id)).toBe(l[lang]);
      }
    expect(wrong).toEqual([]);
    // without an effect, or for an effect without its own name, the shared name
    expect(effectParamLabel('size', 'en')).toBe(EFFECT_PARAM_LABELS.size!.en);
    expect(effectParamLabel('size', 'en', 'light.vignette')).toBe(EFFECT_PARAM_LABELS.size!.en);
    expect(effectParamLabel('nope', 'he', 'overlay.snow')).toBe('nope');
  });
});
