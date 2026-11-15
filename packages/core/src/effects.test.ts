import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, describeCatalog, EFFECTS, effectParams, findClip, migrateProject, OpError, validateProject, type OpCall, type ProjectDocument } from './index.ts';

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
