/**
 * The title effects panel (TextEffectsField.tsx, ADR-0012) decides without a browser which operations its checkboxes and
 * its "remove all" commit. They are run here through the real operation registry: on the master (update_text) and in a
 * format view (set_variant_override), with exact undo by the entity diff, so the panel never sends what the server refuses.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, findClip, projectVariant, TEXT_LOOK_FIELDS, TextStyleSchema, type ProjectDocument } from '@pulseframe/core';
import { LOOK_DEFAULTS, lookOps, REMOVE_ALL, toggleValue } from './TextEffectsField.tsx';

let n = 0;
const tx = (doc: ProjectDocument, ops: Parameters<typeof applyTransaction>[1], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `fx${n++}`, actor: 'test', allowInternal });
function title() {
  let doc = createProject({ id: 'p', name: 'p' });
  const r = tx(doc, [{ op: 'add_text', args: { text: 'שלום עולם', start: T.rt(0, 1), duration: T.rt(2, 1) } }, { op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
  doc = r.doc;
  return { doc, clipId: r.results[0]!.output!.clipId as string, variantId: r.results[1]!.output!.variantId as string };
}
const style = (doc: ProjectDocument, clipId: string) => (findClip(doc, clipId)!.clip as { style: Record<string, unknown> }).style;

describe('title effects panel', () => {
  it('every starting value is a valid look field', () => {
    for (const k of TEXT_LOOK_FIELDS) expect(() => TextStyleSchema.partial().strict().parse({ [k]: LOOK_DEFAULTS[k] }), k).not.toThrow();
  });
  it('turning an effect on in the master commits update_text with its starting value; one undo restores the title exactly', () => {
    const { doc, clipId } = title();
    for (const k of TEXT_LOOK_FIELDS) {
      const ops = lookOps(clipId, null, { [k]: toggleValue(style(doc, clipId), k, true) });
      expect(ops.map((o) => o.op)).toEqual(['update_text']);
      const after = tx(doc, ops).doc;
      expect(style(after, clipId)[k], k).toEqual(LOOK_DEFAULTS[k]);
      // the undo the server runs: the entity diff of the commit, restored by restore_entities
      const undone = tx(after, [{ op: 'restore_entities', args: { targets: diffEntities(doc, after).map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
      expect(undone.sequences, k).toEqual(doc.sequences);
      // off again: removed from the master, stored like a title that never had it
      const off = tx(after, lookOps(clipId, null, { [k]: toggleValue(style(after, clipId), k, false) })).doc;
      expect(k in style(off, clipId), k).toBe(false);
    }
  });
  it('in a format view the change is set_variant_override: a null there turns the master\'s effect off in that format only, and turning it back on copies the master\'s value', () => {
    let { doc, clipId, variantId } = title();
    doc = tx(doc, lookOps(clipId, null, { glow: { color: '#00E5FF', radiusFrac: 0.6, intensity: 0.9 } })).doc;
    const off = tx(doc, lookOps(clipId, variantId, { glow: toggleValue(style(doc, clipId), 'glow', false) }));
    expect(off.results.length).toBe(1);
    const inFormat = (d: ProjectDocument) => style(projectVariant(d, variantId), clipId);
    expect(inFormat(off.doc).glow).toBeNull(); // off in the format
    expect(style(off.doc, clipId).glow).toEqual({ color: '#00E5FF', radiusFrac: 0.6, intensity: 0.9 }); // the master keeps it
    const back = tx(off.doc, lookOps(clipId, variantId, { glow: toggleValue(style(off.doc, clipId), 'glow', true) })).doc;
    expect(inFormat(back).glow).toEqual({ color: '#00E5FF', radiusFrac: 0.6, intensity: 0.9 });
    // a field the master does not have starts from its starting value
    const ext = tx(back, lookOps(clipId, variantId, { extrude: toggleValue(style(back, clipId), 'extrude', true) })).doc;
    expect(inFormat(ext).extrude).toEqual(LOOK_DEFAULTS.extrude);
    expect(style(ext, clipId).extrude).toBeUndefined();
  });
  it('"remove all effects" sends the six fields as null: the master is stored as if it never had them; a format turns them all off', () => {
    let { doc, clipId, variantId } = title();
    doc = tx(doc, [{ op: 'apply_text_preset', args: { clipId, presetId: 'gradient-gold' } }, ...lookOps(clipId, null, { glow: LOOK_DEFAULTS.glow, tracking: 0.2 })]).doc;
    const masterOff = tx(doc, lookOps(clipId, null, REMOVE_ALL)).doc;
    for (const k of TEXT_LOOK_FIELDS) expect(k in style(masterOff, clipId), k).toBe(false);
    const formatOff = tx(doc, lookOps(clipId, variantId, REMOVE_ALL)).doc;
    const shown = style(projectVariant(formatOff, variantId), clipId);
    for (const k of TEXT_LOOK_FIELDS) expect(shown[k], k).toBeNull();
    expect(style(formatOff, clipId).gradient).toBeTruthy();
  });
});
