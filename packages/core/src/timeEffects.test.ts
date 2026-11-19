/**
 * Time effects (echo, time split, shutter, stutter) in the registry and the ops: at most one per clip, always first in its
 * effect list (ops.ts effectSlot), and validation that reports a document breaking either rule (ADR-0011).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, COLOR_LOOKS, createProject, describeCatalog, EFFECTS, findClip, GPU_TRANSITION_IDS, isTimeEffect, NOT_ANIMATABLE, OpError, temporalOf, TRANSITIONS, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `t${n++}_`, actor: 'test', allowInternal });
const failure = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('expected an OpError'); };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }, { op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(60) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string, textId: r.results[1]!.output!.clipId as string };
}
const types = (doc: ProjectDocument, clipId: string) => (findClip(doc, clipId)!.clip.effects ?? []).map((e) => e.type);
const TIME = ['time.echo', 'time.split', 'time.shutter', 'time.stutter'];

describe('time effects in the registry', () => {
  it('are the four time.* effects, evaluated by the evaluator without a graphics adapter, with bounded windows in whole frames', () => {
    expect(EFFECTS.filter((e) => isTimeEffect(e.id)).map((e) => e.id).sort()).toEqual([...TIME].sort());
    const cat = describeCatalog().effects;
    for (const id of TIME) {
      const e = cat.find((x) => x.id === id)!;
      expect([e.category, e.cost, e.implementation]).toEqual(['time', 'time', 'evaluator time taps + canvas2d (no graphics adapter)']);
      expect(e.temporal).toEqual(temporalOf(id));
      expect(e.temporal).not.toBe(false);
      // the numbers that decide which pictures are read are whole and may not be animated
      expect(NOT_ANIMATABLE[id]!.length).toBeGreaterThan(0);
    }
    expect(temporalOf('time.stutter')).toEqual({ kind: 'remap', pastFrames: 60, followsBeats: true });
    expect(temporalOf('time.echo')).toMatchObject({ kind: 'taps', maxTaps: 5, decodes: true });
    expect(temporalOf('time.shutter')).toMatchObject({ kind: 'taps', maxTaps: 16, decodes: false });
    expect(temporalOf('blur.gaussian')).toBe(false);
    expect(temporalOf('nope.nothing')).toBe(false);
    expect(isTimeEffect('blur.gaussian')).toBe(false);
  });
  it('the catalog names each effect\'s implementation by its cost, and lists the new overlays, stamp, GPU looks and transitions', () => {
    const cat = describeCatalog();
    for (const e of cat.effects) expect(e.implementation).toBe(e.cost === 'gpu' ? 'webgpu pass (needs a graphics adapter)' : e.cost === 'time' ? 'evaluator time taps + canvas2d (no graphics adapter)' : 'canvas2d');
    expect(cat.effects.filter((e) => e.category === 'overlay').map((e) => e.id).sort()).toEqual(['overlay.bokeh', 'overlay.confetti', 'overlay.hearts', 'overlay.snow', 'overlay.speed-lines']);
    expect(cat.effects.filter((e) => e.category === 'overlay').every((e) => e.cost === 'layer' && e.seeded)).toBe(true);
    expect(cat.effects.find((e) => e.id === 'stylize.date-stamp')).toMatchObject({ cost: 'layer', implementation: 'canvas2d', defaults: { text: "'05 7 14" } });
    expect(cat.effects.filter((e) => e.id === 'stylize.digicam' || e.id === 'stylize.crt').map((e) => e.cost)).toEqual(['gpu', 'gpu']);
    for (const id of ['whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw']) {
      expect(TRANSITIONS.find((t) => t.id === id)).toMatchObject({ gpu: true, usesOutgoing: true });
      expect(GPU_TRANSITION_IDS).toContain(id);
    }
  });
});

describe('time effect ops', () => {
  it('a time effect is inserted first whatever index is asked, on a picture clip and on a title', () => {
    const { doc, clipId, textId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.grayscale' } }, { op: 'add_effect', args: { clipId, type: 'time.echo', index: 2 } }]);
    expect(types(a.doc, clipId)).toEqual(['time.echo', 'blur.gaussian', 'color.grayscale']);
    expect(findClip(a.doc, clipId)!.clip.effects![0]!.params).toEqual({ count: 4, delay: 3, decay: 0.6, mode: 'blend' });
    const t = tx(a.doc, [{ op: 'add_effect', args: { clipId: textId, type: 'time.shutter' } }]);
    expect(types(t.doc, textId)).toEqual(['time.shutter']);
    expect(validateProject(t.doc)).toEqual([]);
  });
  it('a second time effect is refused as incompatible, even when the first is bypassed', () => {
    const { doc, clipId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'time.stutter' } }]);
    const fxId = a.results[0]!.output!.effectId as string;
    for (const d of [a.doc, tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, enabled: false } }]).doc]) {
      const e = failure(() => tx(d, [{ op: 'add_effect', args: { clipId, type: 'time.split' } }]));
      expect(e.code).toBe('incompatible');
      expect(e.message).toBe('a clip can carry one time effect (echo, time split, shutter or stutter)');
      expect(e.details).toMatchObject({ op: 'add_effect', effects: ['time.stutter'] });
      expect(e.hint).toBeTruthy();
    }
  });
  it('other effects go after it: add_effect at 0, apply_look (first) and apply_lut (last)', () => {
    const { doc, clipId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'time.split' } }, { op: 'add_effect', args: { clipId, type: 'blur.gaussian', index: 0 } }]);
    expect(types(a.doc, clipId)).toEqual(['time.split', 'blur.gaussian']);
    const look = tx(a.doc, [{ op: 'apply_look', args: { clipId, lookId: COLOR_LOOKS[0]!.id } }]);
    expect(types(look.doc, clipId)).toEqual(['time.split', 'color.grade', 'blur.gaussian']);
    expect(validateProject(look.doc)).toEqual([]);
    // without a time effect, a look still goes first
    const plain = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'apply_look', args: { clipId, lookId: COLOR_LOOKS[0]!.id } }]);
    expect(types(plain.doc, clipId)).toEqual(['color.grade', 'blur.gaussian']);
  });
  it('apply_lut on a clip with only a time effect adds the table after it', () => {
    const { doc, clipId } = project();
    const lutAsset = { kind: 'lut' as const, name: 'film.cube', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 100, container: 'cube', mimeType: 'text/plain', duration: T.ZERO, lut: { size: 17, title: null }, provenance: { origin: 'upload' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
    const r = tx(doc, [{ op: 'import_asset', args: { asset: lutAsset } }], true);
    const lutId = r.results[0]!.output!.assetId as string;
    const d = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'time.shutter' } }, { op: 'apply_lut', args: { clipId, assetId: lutId } }]).doc;
    expect(types(d, clipId)).toEqual(['time.shutter', 'color.lut']);
  });
  it('update_effect cannot move an effect above the time effect, and the time effect itself stays first', () => {
    const { doc, clipId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.grayscale' } }, { op: 'add_effect', args: { clipId, type: 'time.echo' } }]);
    const [blur, gray, echo] = a.results.map((x) => x.output!.effectId as string);
    const up = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: gray!, index: 0 } }]).doc;
    expect(types(up, clipId)).toEqual(['time.echo', 'color.grayscale', 'blur.gaussian']);
    const moved = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: echo!, index: 2, params: { count: 3 } } }]).doc;
    expect(types(moved, clipId)).toEqual(['time.echo', 'blur.gaussian', 'color.grayscale']);
    expect(findClip(moved, clipId)!.clip.effects![0]!.params.count).toBe(3);
    // a change that names no index leaves every effect where it is
    const same = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: blur!, enabled: false } }]).doc;
    expect(types(same, clipId)).toEqual(['time.echo', 'blur.gaussian', 'color.grayscale']);
    // once the time effect is removed, any order is allowed again
    const freed = tx(a.doc, [{ op: 'remove_effect', args: { clipId, effectId: echo! } }, { op: 'update_effect', args: { clipId, effectId: gray!, index: 0 } }]).doc;
    expect(types(freed, clipId)).toEqual(['color.grayscale', 'blur.gaussian']);
  });
  it('the whole-number windows of time effects cannot be keyframed', () => {
    const { doc, clipId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'time.echo' } }]);
    const fxId = a.results[0]!.output!.effectId as string;
    for (const param of ['count', 'delay']) expect(failure(() => tx(a.doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param, time: f(0), value: 3 } }])).code).toBe('invalid_args');
    expect(() => tx(a.doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'decay', time: f(0), value: 0.3 } }])).not.toThrow();
    expect(failure(() => tx(doc, [{ op: 'add_effect', args: { clipId, type: 'time.echo', params: { delay: 1.5 } } }])).code).toBe('invalid_args');
  });
  it('validation reports a stored document that breaks the rules: time_effect_order and time_effect_count', () => {
    const { doc, clipId } = project();
    const ok = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'time.echo' } }]).doc;
    expect(validateProject(ok)).toEqual([]);
    const late = structuredClone(ok);
    findClip(late, clipId)!.clip.effects!.reverse();
    expect(validateProject(late).map((i) => i.code)).toEqual(['time_effect_order']);
    const two = structuredClone(ok);
    findClip(two, clipId)!.clip.effects!.push({ id: 'fx_second', type: 'time.split', enabled: true, params: { lag: 4, order: 'red-now' } });
    expect(validateProject(two).map((i) => i.code).sort()).toEqual(['time_effect_count', 'time_effect_order']);
    // a transaction that would leave such a document is refused as a whole
    const e = failure(() => tx(late, [{ op: 'set_clip_blend', args: { clipId, mode: 'screen' } }]));
    expect(e.code).toBe('invalid_result');
    // an edit of the effect list puts the time effect back in its place
    const repaired = tx(late, [{ op: 'update_effect', args: { clipId, effectId: findClip(late, clipId)!.clip.effects![0]!.id, enabled: false } }]).doc;
    expect(types(repaired, clipId)).toEqual(['time.echo', 'blur.gaussian']);
    expect(validateProject(repaired)).toEqual([]);
  });
});
