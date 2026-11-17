import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeCatalog, diffEntities, EFFECTS, effectParams, effectParamsAt, findClip, GPU_EFFECT_IDS, lutUsers, migrateProject, OpError, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `x${n++}_`, actor: 'test', allowInternal });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : `non-op:${e}`; } return 'ok'; };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'f'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-14T00:00:00Z', importedBy: 'test' },
};
function project() {
  let r = tx(createProject({ id: 'prj_x', name: 'X' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string, audioId: r.results[0]!.output!.audioClipId as string };
}

describe('effect registry', () => {
  it('every effect has a unique id, bilingual name, defaults that satisfy its own schema, and a JSON schema', () => {
    const cat = describeCatalog();
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
    for (const e of cat.effects) {
      expect(e.name.he && e.name.en).toBeTruthy();
      expect(effectParams(e.id, e.defaults)).toEqual(e.defaults);
      expect((e.paramsSchema as any).type).toBe('object');
    }
    expect(() => effectParams('blur.gaussian', { radius: 9 })).toThrow();
    expect(() => effectParams('blur.gaussian', { radiu: 0.1 })).toThrow(); // unknown parameter names are rejected, not ignored
  });
});

describe('look ops', () => {
  it('add / update / reorder / bypass / remove effects; parameters are completed with defaults and validated', () => {
    const { doc, clipId, audioId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.adjust', params: { saturation: 0.2 } } }]);
    const [blur, adj] = a.results.map((r) => r.output!.effectId as string);
    let fx = findClip(a.doc, clipId)!.clip.effects!;
    expect(fx.map((e) => e.type)).toEqual(['blur.gaussian', 'color.adjust']);
    expect(fx[1]!.params).toEqual({ brightness: 1, contrast: 1, saturation: 0.2, hue: 0 });
    const b = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: adj, params: { hue: 90 }, index: 0 } }, { op: 'update_effect', args: { clipId, effectId: blur, enabled: false } }]).doc;
    fx = findClip(b, clipId)!.clip.effects!;
    expect(fx.map((e) => [e.type, e.enabled])).toEqual([['color.adjust', true], ['blur.gaussian', false]]);
    expect(fx[0]!.params).toMatchObject({ saturation: 0.2, hue: 90 });
    expect(validateProject(b)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(b)))).toEqual(b);
    const c = tx(b, [{ op: 'remove_effect', args: { clipId, effectId: adj } }, { op: 'remove_effect', args: { clipId, effectId: blur } }]).doc;
    expect(findClip(c, clipId)!.clip.effects).toBeUndefined();
    expect(code(() => tx(doc, [{ op: 'add_effect', args: { clipId, type: 'glitch.datamosh' } }]))).toBe('not_found');
    expect(code(() => tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 5 } } }]))).toBe('invalid_args');
    expect(code(() => tx(doc, [{ op: 'add_effect', args: { clipId: audioId, type: 'blur.gaussian' } }]))).toBe('incompatible');
    expect(code(() => tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: 'fx_nope', enabled: false } }]))).toBe('not_found');
  });
  it('effect parameters can be keyframed: range-checked, only numeric parameters, attached to the content through trims and splits', () => {
    const { doc, clipId } = project();
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0 } } }]);
    const fxId = a.results[0]!.output!.effectId as string;
    let d = tx(a.doc, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: f(0), value: 0 } }, { op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: f(30), value: 0.06, easing: 'ease-in' } }]).doc;
    expect(validateProject(d)).toEqual([]);
    const fx = () => findClip(d, clipId)!.clip.effects![0]!;
    expect(effectParamsAt(fx(), f(15)).radius).toBeCloseTo(0.03, 9);
    expect(effectParamsAt(fx(), f(45)).radius).toBe(0.06); // holds the last value
    expect(code(() => tx(d, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: f(10), value: 9 } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'nope', time: f(10), value: 0.1 } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'set_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: T.rt(1, 7), value: 0.01 } }]))).toBe('invalid_args');
    // split at frame 20: the right half continues the same curve (its key times shift by -20)
    const s = tx(d, [{ op: 'split_clip', args: { clipId, at: f(20) } }]);
    const right = findClip(s.doc, s.results[0]!.output!.rightClipId as string)!.clip.effects![0]!;
    expect(effectParamsAt(right, f(0)).radius).toBeCloseTo(effectParamsAt(fx(), f(20)).radius as number, 9);
    expect(validateProject(s.doc)).toEqual([]);
    // removing the last key freezes the value it had
    d = tx(d, [{ op: 'delete_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: f(0) } }, { op: 'delete_effect_keyframe', args: { clipId, effectId: fxId, param: 'radius', time: f(30) } }]).doc;
    expect(fx().keyframes).toBeUndefined();
    expect(fx().params.radius).toBe(0.06);
  });
  it('an unknown effect type in a stored document is reported by validation (never silently dropped)', () => {
    const { doc, clipId } = project();
    const bad = structuredClone(doc);
    findClip(bad, clipId)!.clip.effects = [{ id: 'fx1', type: 'future.effect', enabled: true, params: {} }];
    expect(validateProject(bad).map((i) => i.code)).toContain('unknown_effect');
  });
  it('blend and mask: set, partial update, clear', () => {
    const { doc, clipId } = project();
    let d = tx(doc, [{ op: 'set_clip_blend', args: { clipId, mode: 'screen' } }, { op: 'set_clip_mask', args: { clipId, mask: { shape: 'ellipse', feather: 0.02 } } }]).doc;
    expect(findClip(d, clipId)!.clip).toMatchObject({ blend: 'screen', mask: { shape: 'ellipse', width: 0.8, feather: 0.02, invert: false } });
    d = tx(d, [{ op: 'set_clip_mask', args: { clipId, mask: { invert: true } } }]).doc;
    expect((findClip(d, clipId)!.clip as any).mask).toMatchObject({ shape: 'ellipse', invert: true });
    d = tx(d, [{ op: 'set_clip_mask', args: { clipId, mask: null } }, { op: 'set_clip_blend', args: { clipId, mode: 'normal' } }]).doc;
    expect(findClip(d, clipId)!.clip).not.toHaveProperty('mask');
    expect(findClip(d, clipId)!.clip).not.toHaveProperty('blend');
  });
  it('transition needs source handle on the previous clip; split leaves it on the original cut only', () => {
    const { doc, clipId } = project();
    // A = frames 0..59 (source 0..59), B = right half starting at 60 (source 60..) -> A has 180 frames of handle
    const s = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(60) } }]);
    const right = s.results[0]!.output!.rightClipId as string;
    const t = tx(s.doc, [{ op: 'set_transition', args: { clipId: right, type: 'dissolve', frames: 12 } }]);
    expect(t.results[0]!.output!.previousClipId).toBe(clipId);
    expect(validateProject(t.doc)).toEqual([]);
    // the first clip of the track has no previous clip: allowed (reveals over what is below)
    expect(code(() => tx(s.doc, [{ op: 'set_transition', args: { clipId, type: 'wipe-left', frames: 10 } }]))).toBe('ok');
    // no handle: previous clip already uses its source to the end
    const whole = tx(doc, [{ op: 'add_clip', args: { assetId: Object.keys(doc.assets)[0], start: f(240) } }]);
    const second = whole.results[0]!.output!.clipId as string;
    expect(code(() => tx(whole.doc, [{ op: 'set_transition', args: { clipId: second, type: 'dissolve', frames: 10 } }]))).toBe('out_of_bounds');
    expect(code(() => tx(s.doc, [{ op: 'set_transition', args: { clipId: right, type: 'dissolve', frames: 150 } }]))).toBe('ok');
    expect(code(() => tx(s.doc, [{ op: 'set_transition', args: { clipId: right, type: 'star-wipe', frames: 10 } }]))).toBe('invalid_args');
    const split2 = tx(t.doc, [{ op: 'split_clip', args: { clipId: right, at: f(100) } }]);
    expect((findClip(split2.doc, right)!.clip as any).transition).toEqual({ type: 'dissolve', frames: 12 });
    expect((findClip(split2.doc, split2.results[0]!.output!.rightClipId as string)!.clip as any).transition).toBeUndefined();
    const cleared = tx(t.doc, [{ op: 'set_transition', args: { clipId: right, type: null } }]).doc;
    expect(findClip(cleared, right)!.clip).not.toHaveProperty('transition');
  });
});

describe('colour tables (LUT assets) and the color.lut effect', () => {
  const lutAsset = (hex: string, name = 'film.cube') => ({
    kind: 'lut' as const, name, contentHash: `sha256:${hex.repeat(64)}`, byteSize: 100, container: 'cube', mimeType: 'text/plain', duration: T.ZERO,
    lut: { size: 17, title: null }, provenance: { origin: 'upload' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' },
  });
  const failure = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('expected an OpError'); };
  function withLut() {
    const p = project();
    const before = p.doc;
    const r = tx(p.doc, [{ op: 'import_asset', args: { asset: lutAsset('a') } }], true);
    return { ...p, before, doc: r.doc, lutId: r.results[0]!.output!.assetId as string };
  }

  it('is registered as a GPU colour effect whose defaults name no table', () => {
    const e = describeCatalog().effects.find((x) => x.id === 'color.lut')!;
    expect([e.category, e.cost, e.defaults]).toEqual(['color', 'gpu', { lut: '', intensity: 1 }]);
    expect(GPU_EFFECT_IDS).toContain('color.lut');
    expect(() => effectParams('color.lut', { lut: 'x'.repeat(65) })).toThrow();
    expect(() => effectParams('color.lut', { intensity: 1.5 })).toThrow();
  });

  it('a LUT asset parses through the document schema and survives a JSON round trip', () => {
    const { doc, lutId } = withLut();
    expect(doc.assets[lutId]).toMatchObject({ kind: 'lut', lut: { size: 17, title: null } });
    expect(migrateProject(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
    expect(validateProject(doc)).toEqual([]);
  });

  it('add_effect with no table chosen is allowed; an unknown id or a file that is not a table is refused with the list of tables', () => {
    const { doc, clipId, assetId, lutId } = withLut();
    const none = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.lut' } }]);
    expect(findClip(none.doc, clipId)!.clip.effects![0]!.params).toEqual({ lut: '', intensity: 1 });
    expect(validateProject(none.doc)).toEqual([]);
    const unknown = failure(() => tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.lut', params: { lut: 'ast_nope' } } }]));
    expect(unknown.code).toBe('not_found');
    expect(unknown.details).toMatchObject({ lut: 'ast_nope', available: [{ id: lutId, name: 'film.cube' }] });
    expect(unknown.hint).toBeTruthy();
    const video = failure(() => tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.lut', params: { lut: assetId } } }]));
    expect(video.code).toBe('not_found');
    expect(video.details).toMatchObject({ available: [{ id: lutId, name: 'film.cube' }] });
    const ok = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.lut', params: { lut: lutId, intensity: 0.5 } } }]);
    expect(findClip(ok.doc, clipId)!.clip.effects![0]!.params).toEqual({ lut: lutId, intensity: 0.5 });
    // update_effect is checked the same way, and may clear the choice
    const fxId = ok.results[0]!.output!.effectId as string;
    expect(code(() => tx(ok.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, params: { lut: 'ast_nope' } } }]))).toBe('not_found');
    expect(code(() => tx(ok.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, params: { lut: assetId } } }]))).toBe('not_found');
    const cleared = tx(ok.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, params: { lut: '' } } }]).doc;
    expect(findClip(cleared, clipId)!.clip.effects![0]!.params).toEqual({ lut: '', intensity: 0.5 });
    expect(lutUsers(cleared, lutId)).toEqual([]);
  });

  it('add_clip refuses a LUT asset with a message that says how it is applied', () => {
    const { doc, lutId } = withLut();
    const e = failure(() => tx(doc, [{ op: 'add_clip', args: { assetId: lutId, start: f(300) } }]));
    expect(e.code).toBe('incompatible');
    expect(e.message).toMatch(/not placed on the timeline/);
    expect(e.hint).toMatch(/apply_lut/);
  });

  it('remove_asset is refused while an effect refers to the table (enabled or bypassed) and allowed after the effect is removed', () => {
    const { doc, clipId, lutId } = withLut();
    expect(lutUsers(doc, lutId)).toEqual([]);
    const a = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'color.lut', params: { lut: lutId } } }]);
    const fxId = a.results[0]!.output!.effectId as string;
    expect(lutUsers(a.doc, lutId)).toEqual([clipId]);
    const e = failure(() => tx(a.doc, [{ op: 'remove_asset', args: { assetId: lutId } }]));
    expect(e.code).toBe('incompatible');
    expect(e.details).toMatchObject({ assetId: lutId, clipIds: [clipId] });
    const bypassed = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, enabled: false } }]).doc;
    expect(code(() => tx(bypassed, [{ op: 'remove_asset', args: { assetId: lutId } }]))).toBe('incompatible');
    // a split copies the reference: both halves count
    const split = tx(a.doc, [{ op: 'split_clip', args: { clipId, at: f(60) } }]).doc;
    expect(lutUsers(split, lutId)).toHaveLength(2);
    const freed = tx(a.doc, [{ op: 'remove_effect', args: { clipId, effectId: fxId } }]).doc;
    const gone = tx(freed, [{ op: 'remove_asset', args: { assetId: lutId } }]).doc;
    expect(gone.assets[lutId]).toBeUndefined();
    expect(validateProject(gone)).toEqual([]);
  });

  it('an id that is a member of every object ("__proto__", "constructor", "toString") names no table: not_found with the list, by every path, never a crash', () => {
    const { doc, clipId, lutId } = withLut();
    const fxId = tx(doc, [{ op: 'apply_lut', args: { clipId, assetId: lutId } }]);
    const effectId = fxId.results[0]!.output!.effectId as string;
    for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      for (const call of [
        { op: 'add_effect', args: { clipId, type: 'color.lut', params: { lut: id } } },
        { op: 'apply_lut', args: { clipId, assetId: id } },
      ]) {
        const e = failure(() => tx(doc, [call]));
        expect(e).toBeInstanceOf(OpError);
        expect(e.code).toBe('not_found');
        expect(e.message).toBe(`colour table ${id} is not in this project's library`);
        expect(e.details).toMatchObject({ lut: id, available: [{ id: lutId, name: 'film.cube' }] });
      }
      const e = failure(() => tx(fxId.doc, [{ op: 'update_effect', args: { clipId, effectId, params: { lut: id } } }]));
      expect([e.code, e.message]).toEqual(['not_found', `colour table ${id} is not in this project's library`]);
      expect(lutUsers(doc, id)).toEqual([]);
    }
    expect(({} as any).name).toBeUndefined(); // nothing was written to the prototype either
  });

  it('apply_lut sets the single color.lut effect of the clip: adds it, then replaces it instead of stacking, and re-enables it', () => {
    const { doc, clipId, assetId, audioId, lutId } = withLut();
    const second = tx(doc, [{ op: 'import_asset', args: { asset: lutAsset('b', 'other.cube') } }], true);
    const otherId = second.results[0]!.output!.assetId as string;
    const a = tx(second.doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'apply_lut', args: { clipId, assetId: lutId, intensity: 0.4 } }]);
    const fxId = a.results[1]!.output!.effectId as string;
    expect(findClip(a.doc, clipId)!.clip.effects!.map((e) => [e.type, e.params.lut ?? null, e.params.intensity ?? null])).toEqual([['blur.gaussian', null, null], ['color.lut', lutId, 0.4]]);
    const off = tx(a.doc, [{ op: 'update_effect', args: { clipId, effectId: fxId, enabled: false } }]).doc;
    const b = tx(off, [{ op: 'apply_lut', args: { clipId, assetId: otherId } }]);
    const fx = findClip(b.doc, clipId)!.clip.effects!;
    expect(fx.filter((e) => e.type === 'color.lut')).toHaveLength(1);
    expect(fx[1]).toMatchObject({ id: fxId, enabled: true, params: { lut: otherId, intensity: 0.4 } }); // intensity kept when not given
    expect(b.results[0]!.output!.effectId).toBe(fxId);
    expect(lutUsers(b.doc, lutId)).toEqual([]);
    expect(lutUsers(b.doc, otherId)).toEqual([clipId]);
    expect(validateProject(b.doc)).toEqual([]);
    expect(code(() => tx(doc, [{ op: 'apply_lut', args: { clipId, assetId: 'ast_nope' } }]))).toBe('not_found');
    expect(code(() => tx(doc, [{ op: 'apply_lut', args: { clipId, assetId } }]))).toBe('not_found'); // a video file is not a table
    expect(code(() => tx(doc, [{ op: 'apply_lut', args: { clipId: audioId, assetId: lutId } }]))).toBe('incompatible');
    expect(code(() => tx(doc, [{ op: 'apply_lut', args: { clipId, assetId: lutId, intensity: 2 } }]))).toBe('invalid_args');
  });

  it('undoing the import while an effect uses the table is refused by validation; so is any document with a dangling or wrong-kind reference', () => {
    const { before, doc, clipId, assetId, lutId } = withLut();
    const used = tx(doc, [{ op: 'apply_lut', args: { clipId, assetId: lutId } }]).doc;
    // what undo of the import issues: restore the entities the import changed to their earlier state (the asset did not exist)
    const undoImport = diffEntities(before, doc).map((c) => ({ id: c.id, state: c.before }));
    expect(undoImport.map((c) => [c.id, c.state])).toEqual([[lutId, null]]);
    const e = failure(() => tx(used, [{ op: 'restore_entities', args: { targets: undoImport } }], true));
    expect(e.code).toBe('invalid_result');
    expect(JSON.stringify(e.details)).toMatch(/missing_lut/);
    // with no effect using it, the same undo is fine and leaves a valid project
    const undone = tx(doc, [{ op: 'restore_entities', args: { targets: undoImport } }], true).doc;
    expect(undone.assets[lutId]).toBeUndefined();
    expect(validateProject(undone)).toEqual([]);
    const dangling = structuredClone(used);
    delete dangling.assets[lutId];
    expect(validateProject(dangling).map((i) => i.code)).toEqual(['missing_lut']);
    const wrongKind = structuredClone(used);
    findClip(wrongKind, clipId)!.clip.effects![0]!.params.lut = assetId;
    expect(validateProject(wrongKind).map((i) => i.code)).toEqual(['missing_lut']);
  });
});
