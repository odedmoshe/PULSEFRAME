import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, findFont, lookParams, TEXT_PRESETS, TextStyleSchema, type ProjectDocument } from './index.ts';

let n = 0;
const ctxOf = () => ({ idSeed: `p${n++}`, actor: 'test' });
describe('colour looks', () => {
  it('there are 40, with distinct ids and names in both languages, and each is a valid colour grade', () => {
    expect(COLOR_LOOKS).toHaveLength(40);
    expect(new Set(COLOR_LOOKS.map((l) => l.id)).size).toBe(40);
    expect(new Set(COLOR_LOOKS.map((l) => JSON.stringify(l.params))).size).toBe(40); // no two looks are the same setting
    for (const l of COLOR_LOOKS) { expect(l.name.he).toMatch(/[֐-׿]/); expect(l.name.en).toMatch(/[A-Za-z]/); expect(lookParams(l.id)).toMatchObject(l.params); }
  });
});
describe('text styles', () => {
  it('there are 40, distinct, valid as text style, using only bundled fonts and weights', () => {
    expect(TEXT_PRESETS).toHaveLength(40);
    expect(new Set(TEXT_PRESETS.map((p) => p.id)).size).toBe(40);
    expect(new Set(TEXT_PRESETS.map((p) => JSON.stringify([p.style, p.shadow]))).size).toBe(40);
    for (const p of TEXT_PRESETS) {
      expect(() => TextStyleSchema.partial().strict().parse(p.style)).not.toThrow();
      const font = findFont(p.style.fontFamily);
      expect(font, p.id).toBeTruthy();
      expect(font!.weights, p.id).toContain(p.style.fontWeight);
      expect(p.name.he).toMatch(/[֐-׿]/);
    }
  });
  it('applying a style keeps the text, alignment and direction, owns the shadow, and leaves other effects alone', () => {
    let doc: ProjectDocument = createProject({ id: 'p', name: 'p' });
    const add = applyTransaction(doc, [{ op: 'add_text', args: { text: 'שלום', start: T.rt(0, 1), duration: T.rt(2, 1) } }], ctxOf());
    doc = add.doc;
    const clipId = add.results[0]!.output!.clipId as string;
    doc = applyTransaction(doc, [{ op: 'update_text', args: { clipId, style: { align: 'end', direction: 'rtl' } } }, { op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'apply_text_preset', args: { clipId, presetId: 'neon-pink' } }], ctxOf()).doc;
    const clip = () => Object.values(doc.sequences)[0]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)! as any;
    expect(clip().text).toBe('שלום');
    expect(clip().style).toMatchObject({ align: 'end', direction: 'rtl', color: '#FF4FD8', fontFamily: 'Rubik' });
    expect(clip().effects.map((e: any) => e.type)).toEqual(['blur.gaussian', 'stylize.shadow']);
    doc = applyTransaction(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'gold' } }], ctxOf()).doc;
    expect(clip().effects.map((e: any) => e.type)).toEqual(['blur.gaussian', 'stylize.shadow']); // replaced, not stacked
    doc = applyTransaction(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'clean-white' } }], ctxOf()).doc;
    expect(clip().effects.map((e: any) => e.type)).toEqual(['blur.gaussian']); // a style without a shadow removes it
    expect(() => applyTransaction(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'nope' } }], ctxOf())).toThrow();
  });
});
