import { describe, expect, it } from 'vitest';
import { describeCatalog } from '@pulseframe/core';
import { EFFECT_OPTION_LABELS, EFFECT_PARAM_LABELS, EFFECT_PARAM_LABELS_BY_EFFECT, effectParamLabel } from '../../i18n/src/index.ts';

describe('effect parameter names', () => {
  it('every parameter and every option of every registered effect has a name in Hebrew and in English', () => {
    const missing: string[] = [];
    for (const e of describeCatalog().effects) {
      const props = (e.paramsSchema as { properties: Record<string, { enum?: string[] }> }).properties;
      for (const [name, prop] of Object.entries(props)) {
        const l = EFFECT_PARAM_LABELS[name];
        if (!l?.he || !l.en) missing.push(`${e.id}.${name}`);
        for (const o of prop.enum ?? []) { const ol = EFFECT_OPTION_LABELS[o]; if (!ol?.he || !ol.en) missing.push(`${e.id}.${name}=${o}`); }
      }
    }
    expect(missing).toEqual([]);
  });
  it('Hebrew names are Hebrew', () => {
    const overrides = Object.values(EFFECT_PARAM_LABELS_BY_EFFECT).flatMap((m) => Object.values(m));
    for (const l of [...Object.values(EFFECT_PARAM_LABELS), ...Object.values(EFFECT_OPTION_LABELS), ...overrides] as { he: string }[]) expect(l.he).toMatch(/[֐-׿]/);
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
