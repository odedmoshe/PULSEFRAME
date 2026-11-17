import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, findClip, OpError, projectVariant, TRANSITIONS, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { isOn, pickCall, pickRefusal, thumbSize } from './gallery.pick.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `g${n++}_`, actor: 'test', allowInternal });
const video = (c: string) => ({
  kind: 'video' as const, name: `${c}.mp4`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(5, 1),
  video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 150 },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' },
});
/** Two whole five-second video files back to back on the first video track. */
function project() {
  let r = tx(createProject({ id: 'prj_g', name: 'G', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: video('a') } }, { op: 'import_asset', args: { asset: video('b') } }], true);
  const [a, b] = r.results.map((x) => x.output!.assetId as string);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(150), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: b, start: f(150), duration: f(150), withLinkedAudio: false } }]);
  const [first, second] = r.results.map((x) => x.output!.clipId as string);
  return { doc: r.doc, first: first!, second: second! };
}
const clipOf = (d: ProjectDocument, id: string): Clip => findClip(d, id)!.clip;
const effectsOf = (d: ProjectDocument, id: string) => { const c = clipOf(d, id); return c.type === 'caption' ? [] : c.effects ?? []; };

describe('gallery picks', () => {
  it('an effect tile adds its effect once: picking a tile that is already on the clip commits nothing', () => {
    const p = project();
    const tile = { kind: 'effect' as const, id: 'color.sepia' };
    expect(isOn(clipOf(p.doc, p.first), tile)).toBe(false);
    const call = pickCall(clipOf(p.doc, p.first), tile);
    expect(call).toEqual({ op: 'add_effect', args: { clipId: p.first, type: 'color.sepia' } });
    const doc = tx(p.doc, [call!]).doc;
    expect(isOn(clipOf(doc, p.first), tile)).toBe(true);
    expect(pickCall(clipOf(doc, p.first), tile)).toBeNull(); // the second activation (and the second half of a double-click)
    expect(effectsOf(doc, p.first).filter((e) => e.type === 'color.sepia').length).toBe(1);
    // another effect is still offered, and the other clip is not affected
    expect(pickCall(clipOf(doc, p.first), { kind: 'effect', id: 'color.invert' })).not.toBeNull();
    expect(pickCall(clipOf(doc, p.second), tile)).not.toBeNull();
    // what used to happen: the op itself accepts a second copy, so the tile must not send it
    expect(effectsOf(tx(doc, [call!]).doc, p.first).filter((e) => e.type === 'color.sepia').length).toBe(2);
  });

  it('looks, transitions, motions and text styles replace what the clip has, so a pressed tile still commits its op', () => {
    const p = project();
    const look = COLOR_LOOKS[0]!;
    const doc = tx(p.doc, [pickCall(clipOf(p.doc, p.first), { kind: 'look', id: look.id })!]).doc;
    expect(isOn(clipOf(doc, p.first), { kind: 'look', id: look.id })).toBe(true);
    const again = tx(doc, [pickCall(clipOf(doc, p.first), { kind: 'look', id: look.id })!]).doc;
    expect(effectsOf(again, p.first).filter((e) => e.type === 'color.grade').length).toBe(1);
    expect(pickCall(clipOf(doc, p.first), { kind: 'motion', id: 'm' })).toEqual({ op: 'apply_motion_preset', args: { clipId: p.first, presetId: 'm' } });
    expect(pickCall(clipOf(doc, p.first), { kind: 'text', id: 't' })).toEqual({ op: 'apply_text_preset', args: { clipId: p.first, presetId: 't' } });
    expect(isOn(clipOf(doc, p.first), { kind: 'look', id: 'no-such-look' })).toBe(false);
  });

  it('a transition between two untrimmed clips is refused by the op with a reason the gallery can show', () => {
    const p = project();
    const call = pickCall(clipOf(p.doc, p.second), { kind: 'transition', id: TRANSITIONS[0]!.id })!;
    expect(call).toEqual({ op: 'set_transition', args: { clipId: p.second, type: TRANSITIONS[0]!.id } });
    let refusal: unknown;
    try { tx(p.doc, [call]); } catch (e) { refusal = e; }
    expect(refusal).toBeInstanceOf(OpError);
    expect((refusal as OpError).code).toBe('out_of_bounds');
    expect((refusal as OpError).message).toMatch(/previous clip has only 0 unused source frames/);
    expect(isOn(clipOf(p.doc, p.second), { kind: 'transition', id: TRANSITIONS[0]!.id })).toBe(false);
  });

  it('pickRefusal reads the reason the editor recorded, and tells a conflict from a refusal', () => {
    expect(pickRefusal({ error: 'Out of range: the previous clip has only 0 unused source frames after its end; the transition needs 15', save: 'save.saved' }))
      .toEqual({ reason: 'Out of range: the previous clip has only 0 unused source frames after its end; the transition needs 15', conflict: false });
    expect(pickRefusal({ error: null, save: 'save.conflict' })).toEqual({ reason: null, conflict: true });
    expect(pickRefusal({ error: null, save: 'save.saved' })).toEqual({ reason: null, conflict: false });
  });
});

describe('gallery thumbnails', () => {
  it('take the shape of the format', () => {
    expect(thumbSize(1920, 1080)).toEqual([180, 101]);
    expect(thumbSize(1080, 1920)).toEqual([101, 180]);
    expect(thumbSize(1080, 1080)).toEqual([180, 180]);
    expect(thumbSize(8192, 16)).toEqual([180, 16]);
    expect(thumbSize(0, 0)).toEqual([180, 101]);
  });
  it('follow the viewed linked format, not the master: the snapshot comes from the preview of the viewed format', () => {
    const p = project();
    const r = tx(p.doc, [{ op: 'add_variant', args: { width: 1080, height: 1920 } }]);
    const view = projectVariant(r.doc, r.results[0]!.output!.variantId as string); // what Editor.viewDoc gives while that format is viewed
    expect(thumbSize(r.doc.settings.width, r.doc.settings.height)).toEqual([180, 101]); // the master: what the gallery used before
    expect(thumbSize(view.settings.width, view.settings.height)).toEqual([101, 180]);
  });
});
