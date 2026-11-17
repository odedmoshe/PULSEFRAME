import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, findFont, hasTextLook, lookParams, TEXT_LOOK_FIELDS, TEXT_PRESETS, TextStyleSchema, TREND_TEXT_PRESET_IDS, type ProjectDocument } from './index.ts';

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
  it('there are 50, distinct, valid as text style, using only bundled fonts and weights', () => {
    expect(TEXT_PRESETS).toHaveLength(50);
    expect(new Set(TEXT_PRESETS.map((p) => p.id)).size).toBe(50);
    expect(new Set(TEXT_PRESETS.map((p) => JSON.stringify([p.style, p.shadow]))).size).toBe(50);
    for (const p of TEXT_PRESETS) {
      expect(() => TextStyleSchema.partial().strict().parse(p.style)).not.toThrow();
      const font = findFont(p.style.fontFamily);
      expect(font, p.id).toBeTruthy();
      expect(font!.weights, p.id).toContain(p.style.fontWeight);
      expect(p.name.he).toMatch(/[֐-׿]/);
    }
  });
  it('the trend-pack styles (ADR-0012) are the last ten, each with a look field and no shadow effect; the forty before them have none', () => {
    expect(TEXT_PRESETS.slice(40).map((p) => p.id)).toEqual([...TREND_TEXT_PRESET_IDS]);
    for (const p of TEXT_PRESETS.slice(40)) { expect(hasTextLook(p.style), p.id).toBe(true); expect(p.shadow, p.id).toBeNull(); }
    for (const p of TEXT_PRESETS.slice(0, 40)) expect(TEXT_LOOK_FIELDS.some((k) => k in p.style), p.id).toBe(false);
    // the flat long shadow's colour keeps its red share of the light low (a 30% black), and no glow is near the saturated-red flash rule
    const lin = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    for (const p of TEXT_PRESETS.slice(40)) if (p.style.glow) { const n = parseInt(p.style.glow.color.slice(1, 7), 16), [r, g, b] = [lin(n >> 16), lin((n >> 8) & 255), lin(n & 255)]; expect(r / (r + g + b), p.id).toBeLessThan(0.8); }
  });
  it('a style owns the look fields: applying another clears the ones it does not set', () => {
    let doc: ProjectDocument = createProject({ id: 'p', name: 'p' });
    const add = applyTransaction(doc, [{ op: 'add_text', args: { text: 'שלום', start: T.rt(0, 1), duration: T.rt(2, 1) } }], ctxOf());
    doc = add.doc;
    const clipId = add.results[0]!.output!.clipId as string;
    const style = () => (Object.values(doc.sequences)[0]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)! as any).style;
    doc = applyTransaction(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'extrude-retro' } }], ctxOf()).doc;
    expect(style().extrude).toEqual({ color: '#3A0CA3', depthFrac: 0.18, angle: 45, shade: 0.5 });
    doc = applyTransaction(doc, [{ op: 'update_text', args: { clipId, style: { tracking: 0.1 } } }, { op: 'apply_text_preset', args: { clipId, presetId: 'gradient-gold' } }], ctxOf()).doc;
    expect(style().extrude).toBeUndefined(); expect(style().tracking).toBeUndefined(); // cleared, not stacked
    expect(style().gradient).toEqual({ colors: ['#FFF3B0', '#D4A017', '#8C6A00'], angle: 90 });
    doc = applyTransaction(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'classic-outline' } }], ctxOf()).doc;
    expect(hasTextLook(style())).toBe(false);
    for (const k of TEXT_LOOK_FIELDS) expect(k in style(), k).toBe(false); // stored like a title from before the look fields
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
