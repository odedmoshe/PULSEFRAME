import { describe, expect, it } from 'vitest';
import { describeCatalog } from '@pulseframe/core';
import { EFFECT_OPTION_LABELS, EFFECT_PARAM_LABELS } from '../../i18n/src/index.ts';

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
    for (const l of [...Object.values(EFFECT_PARAM_LABELS), ...Object.values(EFFECT_OPTION_LABELS)] as { he: string }[]) expect(l.he).toMatch(/[֐-׿]/);
  });
});
