/**
 * «תמונה חיה» (wave 8 living, verifier C4): every list a person picks an effect from offers what core PICKABLE_EFFECTS holds — every
 * row but the ones only their own op adds — and the places that commit add_effect from a pick or a drop refuse such a type. A new list
 * of effects joins this table. (The Lab keeps every row and tiles the living picture through its own op: lab.ts.)
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { adjustmentRefusal, EFFECTS, LIVING_EFFECT, opOnlyEffect, PICKABLE_EFFECTS } from '@pulseframe/core';

const src = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
describe('the effect lists of the editor', () => {
  it('PICKABLE_EFFECTS is the registry minus depth.living, in registry order', () => {
    expect(PICKABLE_EFFECTS.map((e) => e.id)).toEqual(EFFECTS.map((e) => e.id).filter((id) => id !== LIVING_EFFECT));
  });
  it.each([
    ['EffectGallery.tsx', '...PICKABLE_EFFECTS.map((e) => ({ key: `effect:'],
    ['Library.tsx', "effects: { kind: 'effect', items: () => PICKABLE_EFFECTS.map("],
    ['CommandPalette.tsx', '...PICKABLE_EFFECTS.map((e) => ({ key: `effect:'],
    ['LookPanel.tsx', '{PICKABLE_EFFECTS.filter((e) => e.category === c).map('],
  ])('%s lists PICKABLE_EFFECTS', (file, line) => {
    const text = src(file);
    expect(text.includes(line), file).toBe(true);
    expect(/\.\.\.EFFECTS\.map\(\(e\) => \(\{ key: `effect:|EFFECTS\.filter\(\(e\) => e\.category === c\)|items: \(\) => EFFECTS\.map/.test(text.replace(/PICKABLE_EFFECTS/g, 'P')), file).toBe(false);
  });
  it('a drop on the timeline and a gallery pick never commit add_effect of an op-only type', () => {
    expect(src('Timeline.tsx')).toContain("if (item.kind === 'effect' && opOnlyEffect(item.id)) return;");
    expect(src('gallery.pick.ts')).toContain('opOnlyEffect(it.id) ? null');
    expect(opOnlyEffect(LIVING_EFFECT)).toBe(true);
  });
  it('"apply to the whole edit" offers nothing for it (an adjustment clip has no picture of its own)', () => {
    expect(src('commands.ts')).toContain('if (adjustmentRefusal(pick.type)) return null;');
    expect(adjustmentRefusal(LIVING_EFFECT)).toBe('a living picture needs a photo of its own; an adjustment clip has none');
  });
});
