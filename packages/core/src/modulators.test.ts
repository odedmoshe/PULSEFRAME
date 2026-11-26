/**
 * Beat modulators on effect parameters (effects.ts ModulatorSchema, MODULATABLE; op set_effect_modulator): default-deny
 * allowlist, depth inside the parameter's range, at most 4 per effect, removal, validation, and an exact undo.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { animatableParams, applyTransaction, createProject, describeCatalog, diffEntities, EffectInstanceSchema, findClip, findEffect, migrateProject, MODULATABLE, modulatableParams, OpError, paramRange, validateProject, type OpCall, type ProjectDocument } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `m${n++}_`, actor: 'test', allowInternal });
const failure = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('expected an OpError'); };
const asset = {
  kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
function withEffect(type: string) {
  let r = tx(createProject({ id: 'prj_m', name: 'M' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type } }]);
  return { doc: r.doc, clipId, effectId: r.results[0]!.output!.effectId as string };
}
const fx = (doc: ProjectDocument, clipId: string) => findClip(doc, clipId)!.clip.effects![0]!;
const mod = (clipId: string, effectId: string, param: string, modulator: unknown): OpCall => ({ op: 'set_effect_modulator', args: { clipId, effectId, param, modulator } });

describe('which parameters may follow the beat', () => {
  it('only listed geometry and texture parameters that exist, are numeric and may be animated; the catalog lists them', () => {
    for (const [type, params] of Object.entries(MODULATABLE)) {
      expect(findEffect(type), type).toBeDefined();
      for (const p of params) expect(animatableParams(type), `${type}.${p}`).toContain(p);
      expect(modulatableParams(type)).toEqual([...params]);
    }
    const cat = describeCatalog().effects;
    expect(cat.find((e) => e.id === 'blur.gaussian')!.modulatable).toEqual(['radius']);
    // brightness, colour and flashes cannot: they are not on the list (default-deny)
    for (const id of ['color.adjust', 'color.grade', 'light.strobe', 'light.glow', 'stylize.vhs', 'time.echo', 'overlay.snow']) expect(cat.find((e) => e.id === id)!.modulatable, id).toEqual([]);
    expect(modulatableParams('nope.nothing')).toEqual([]);
  });
  it('paramRange reads the declared range from the schema, and names no member of every object', () => {
    expect(paramRange('blur.gaussian', 'radius')).toEqual({ min: 0, max: 0.2 });
    expect(paramRange('distort.swirl', 'angle')).toEqual({ min: -1080, max: 1080 });
    expect(paramRange('time.echo', 'count')).toEqual({ min: 2, max: 5 });
    expect(paramRange('time.echo', 'mode')).toBeNull();
    expect(paramRange('blur.gaussian', 'constructor')).toBeNull();
    expect(paramRange('nope.nothing', 'radius')).toBeNull();
  });
});

describe('set_effect_modulator', () => {
  it('sets a modulator with the defaults every=2 and decay=6, changes it, and removes it with null', () => {
    const { doc, clipId, effectId } = withEffect('distort.bulge');
    const a = tx(doc, [mod(clipId, effectId, 'amount', { depth: 0.3 })]);
    expect(fx(a.doc, clipId).modulate).toEqual({ amount: { by: 'beat', every: 2, depth: 0.3, decay: 6 } });
    expect(a.results[0]!.output).toEqual({ modulated: ['amount'] });
    expect(a.results[0]!.summary).toBe('distort.bulge.amount follows the beat');
    const b = tx(a.doc, [mod(clipId, effectId, 'radius', { depth: -0.2, every: 4, decay: 12 }), mod(clipId, effectId, 'amount', { depth: 0.5, every: 1 })]).doc;
    expect(fx(b, clipId).modulate).toEqual({ amount: { by: 'beat', every: 1, depth: 0.5, decay: 6 }, radius: { by: 'beat', every: 4, depth: -0.2, decay: 12 } });
    expect(validateProject(b)).toEqual([]);
    expect(migrateProject(JSON.parse(JSON.stringify(b)))).toEqual(b);
    const c = tx(b, [mod(clipId, effectId, 'amount', null)]);
    expect(fx(c.doc, clipId).modulate).toEqual({ radius: { by: 'beat', every: 4, depth: -0.2, decay: 12 } });
    expect(c.results[0]!.summary).toBe('distort.bulge.amount no longer follows the beat');
    const d = tx(c.doc, [mod(clipId, effectId, 'radius', null)]).doc;
    expect(fx(d, clipId)).not.toHaveProperty('modulate'); // the field goes away with its last modulator
    expect(fx(d, clipId)).toEqual(fx(doc, clipId));
  });
  it('refuses a parameter that is not on the list, by name, with the list', () => {
    const { doc, clipId, effectId } = withEffect('color.adjust');
    const e = failure(() => tx(doc, [mod(clipId, effectId, 'brightness', { depth: 0.5 })]));
    expect([e.code, e.message]).toEqual(['invalid_args', '"brightness" of color.adjust cannot follow the beat']);
    expect(e.details).toMatchObject({ op: 'set_effect_modulator', modulatable: [] });
    expect(e.hint).toMatch(/list_catalog/);
    const blur = withEffect('blur.gaussian');
    for (const param of ['nope', '__proto__', 'constructor', 'seed']) expect(failure(() => tx(blur.doc, [mod(blur.clipId, blur.effectId, param, { depth: 0.01 })])).code, param).toBe('invalid_args');
    expect(({} as Record<string, unknown>).depth).toBeUndefined(); // nothing reached the prototype
  });
  it('refuses a depth larger than the range of the parameter, and bad every/decay', () => {
    const { doc, clipId, effectId } = withEffect('blur.gaussian');
    const e = failure(() => tx(doc, [mod(clipId, effectId, 'radius', { depth: 0.21 })]));
    expect(e.code).toBe('out_of_bounds');
    expect(e.details).toMatchObject({ min: 0, max: 0.2 });
    expect(() => tx(doc, [mod(clipId, effectId, 'radius', { depth: -0.2 })])).not.toThrow();
    for (const m of [{ depth: 0.1, every: 0 }, { depth: 0.1, every: 1.5 }, { depth: 0.1, decay: 0.5 }, { depth: 0.1, decay: 31 }, { depth: 0.1, by: 'beat' }, {}]) expect(failure(() => tx(doc, [mod(clipId, effectId, 'radius', m)])).code, JSON.stringify(m)).toBe('invalid_args');
    expect(failure(() => tx(doc, [mod(clipId, 'fx_nope', 'radius', { depth: 0.1 })])).code).toBe('not_found');
  });
  it('an effect carries at most 4 modulated parameters, and only beat modulators: the document schema says so', () => {
    const m = { by: 'beat', every: 2, depth: 0.01, decay: 6 };
    const base = { id: 'fx1', type: 'blur.gaussian', enabled: true, params: { radius: 0.01 } };
    expect(EffectInstanceSchema.safeParse({ ...base, modulate: { a: m, b: m, c: m, d: m } }).success).toBe(true);
    expect(EffectInstanceSchema.safeParse({ ...base, modulate: { a: m, b: m, c: m, d: m, e: m } }).success).toBe(false);
    expect(EffectInstanceSchema.safeParse({ ...base, modulate: { radius: { ...m, by: 'bar' } } }).success).toBe(false);
  });
  it('validation reports a stored modulator on a parameter off the list (modulator_param) or deeper than its range (modulator_range)', () => {
    const { doc, clipId, effectId } = withEffect('blur.gaussian');
    const ok = tx(doc, [mod(clipId, effectId, 'radius', { depth: 0.1 })]).doc;
    const offList = structuredClone(ok);
    fx(offList, clipId).modulate = { seed: { by: 'beat', every: 2, depth: 1, decay: 6 } };
    expect(validateProject(offList).map((i) => i.code)).toEqual(['modulator_param']);
    const deep = structuredClone(ok);
    fx(deep, clipId).modulate!.radius!.depth = 0.5;
    expect(validateProject(deep).map((i) => i.code)).toEqual(['modulator_range']);
    const unknown = structuredClone(ok);
    fx(unknown, clipId).type = 'future.effect';
    expect(validateProject(unknown).map((i) => i.code).sort()).toEqual(['modulator_param', 'unknown_effect']);
  });
  it('undo through restore_entities gives back the clip exactly', () => {
    const { doc, clipId, effectId } = withEffect('distort.swirl');
    const before = structuredClone(findClip(doc, clipId)!.clip);
    const after = tx(doc, [mod(clipId, effectId, 'angle', { depth: 90, every: 1 })]).doc;
    const changes = diffEntities(doc, after);
    expect(changes.map((c) => c.id)).toEqual([clipId]);
    const undone = tx(after, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], true).doc;
    expect(findClip(undone, clipId)!.clip).toEqual(before);
    const redone = tx(undone, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.after })) } }], true).doc;
    expect(findClip(redone, clipId)!.clip).toEqual(findClip(after, clipId)!.clip);
  });
});
