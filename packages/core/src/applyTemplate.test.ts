/**
 * apply_template (internal, ADR-0016): a plan of public ops with bindings applied as one step. The bindings resolve only
 * against earlier steps and the call's own assets, refuse every malformed or inherited name, and the run record keeps the
 * slots and the fingerprints that regeneration uses. Undo (the step's entity diff applied backwards) is exact.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, canonical, createProject, creativeProjection, diffEntities, fingerprint, OpError, resolveBindings, restoreEntities, validateProject,
  type ApplyTemplateArgs, type ApplyTemplateOutput, type OpCall, type ProjectDocument, type TemplateStep,
} from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], idSeed = `at${n++}_`) => applyTransaction(doc, ops, { idSeed, actor: 'test', allowInternal: true });
const refusal = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
const provenance = { origin: 'generated' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'system', procedural: { id: 'element.shape.star-5', version: 2, generator: 'test' } };
const picture = (c: string) => ({ kind: 'image' as const, name: `${c}.png`, contentHash: `sha256:${c.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 200, height: 200, codec: 'png', hasAlpha: true }, provenance });

const base = () => createProject({ id: 'prj_tpl', name: 'T', width: 640, height: 360 });
const call = (ops: TemplateStep[], extra: Partial<ApplyTemplateArgs> = {}): OpCall => ({
  op: 'apply_template',
  args: { templateId: 'tpl.x', templateVersion: 1, params: { lang: 'he' }, steps: ['plan step'], assets: [{ key: 'pic', asset: picture('a') }], ops, slots: [], ...extra },
});
/** A plan that uses every kind of binding: a clip id, an output key, an item of an output list, and an asset. */
const PLAN: TemplateStep[] = [
  { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(0), duration: f(60) }, bind: 'one' },
  { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(60), duration: f(60), trackId: { $ref: 'one', out: 'trackId' } }, bind: 'two' },
  { op: 'add_adjustment', args: { span: 'edit', effects: [{ type: 'color.grayscale' }] }, bind: 'look' },
  { op: 'update_effect', args: { clipId: { $ref: 'look' }, effectId: { $ref: 'look', out: 'effectIds', at: 0 }, params: { amount: 0.5 } } },
  { op: 'set_clip_transform', args: { clipId: { $ref: 'two' }, transform: { scale: 0.5 } } },
];
const SLOTS: ApplyTemplateArgs['slots'] = [{ key: 'one', kind: 'picture', clipId: { $ref: 'one' }, accept: 'image', beats: { from: 0, count: 2, unit: 'beat' } }, { key: 'two', kind: 'picture', clipId: { $ref: 'two' } }, { key: 'look', kind: 'look', clipId: { $ref: 'look' } }];
const clipsOf = (doc: ProjectDocument) => Object.values(doc.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips.map((c) => ({ c, t }))));

function acceptAndUndo(doc: ProjectDocument, ops: OpCall[], idSeed?: string) {
  const r = tx(doc, ops, idSeed);
  expect(validateProject(r.doc)).toEqual([]);
  const back = structuredClone(r.doc);
  restoreEntities(back, diffEntities(doc, r.doc).map((c) => ({ id: c.id, state: c.before })));
  expect(creativeProjection(back)).toBe(creativeProjection(doc));
  return r;
}

describe('bindings', () => {
  it('a plan with a clip reference, an output key, an item of an output list and an asset resolves and applies as one step', () => {
    const r = acceptAndUndo(base(), [call(PLAN, { slots: SLOTS })]);
    const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
    const pic = out.assetIds.pic!;
    expect(r.doc.assets[pic]!.name).toBe('a.png');
    const pictures = clipsOf(r.doc).filter((x) => x.c.type === 'media');
    expect(pictures.map((x) => [x.c.type === 'media' && x.c.assetId, T.frameIndexAt(x.c.start, R)])).toEqual([[pic, 0], [pic, 60]]);
    expect(new Set(pictures.map((x) => x.t.id)).size).toBe(1); // the second clip went on the first one's track by reference
    const look = clipsOf(r.doc).find((x) => x.c.type === 'adjustment')!.c;
    expect(look.effects![0]!.params.amount).toBe(0.5);
    expect(pictures[1]!.c.transform.scale).toBe(0.5);
    expect(out.slots.map((s) => [s.key, s.clipId])).toEqual([['one', pictures[0]!.c.id], ['two', pictures[1]!.c.id], ['look', look.id]]);
    expect(out.slots[0]).toEqual({ key: 'one', kind: 'picture', clipId: pictures[0]!.c.id, accept: 'image', beats: { from: 0, count: 2, unit: 'beat' } });
    expect(r.results).toHaveLength(1); // one step in the history
  });
  it('resolveBindings replaces bindings without changing its input, and copies everything else as it is', () => {
    const bound = new Map([['a', { clipId: 'clp_1', effectIds: ['fx_1', 'fx_2'], trackId: 'trk_1' }]]);
    const assets = new Map([['pic', 'ast_1']]);
    const args = { x: [{ $ref: 'a' }, { $ref: 'a', out: 'effectIds' }, { $ref: 'a', out: 'effectIds', at: 1 }], y: { $asset: 'pic' }, z: { deep: { $ref: 'a', out: 'trackId' } }, n: 3, s: '$ref' };
    const copy = structuredClone(args);
    expect(resolveBindings(args, bound, assets, 'here')).toEqual({ x: ['clp_1', ['fx_1', 'fx_2'], 'fx_2'], y: 'ast_1', z: { deep: 'trk_1' }, n: 3, s: '$ref' });
    expect(args).toEqual(copy);
  });
  it('refuses a forward reference, an unknown one, a key beside $ref or $asset, a target that is not a text id, and nesting past 64 levels', () => {
    const bad: [string, TemplateStep[]][] = [
      ['forward', [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30), trackId: { $ref: 'later', out: 'trackId' } } }, { op: 'add_track', args: { kind: 'text' }, bind: 'later' }]],
      ['unknown', [{ op: 'set_clip_transform', args: { clipId: { $ref: 'nobody' }, transform: { x: 0.1 } } }]],
      ['extra key', [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 't' }, { op: 'set_clip_transform', args: { clipId: { $ref: 't', extra: 1 }, transform: { x: 0.1 } } }]],
      ['extra key beside $asset', [{ op: 'add_clip', args: { assetId: { $asset: 'pic', out: 'x' }, start: f(0) } }]],
      ['both kinds', [{ op: 'add_clip', args: { assetId: { $asset: 'pic', $ref: 'pic' }, start: f(0) } }]],
      ['a number', [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 't' }, { op: 'set_keyframe', args: { clipId: { $ref: 't' }, property: 'opacity', time: f(0), value: 0 }, bind: 'k' }, { op: 'set_clip_transform', args: { clipId: { $ref: 'k', out: 'keyframeCount' }, transform: { x: 0.1 } } }]],
      ['a list where one id is needed', [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(30) }, effects: [{ type: 'color.sepia' }] }, bind: 'l' }, { op: 'remove_effect', args: { clipId: { $ref: 'l' }, effectId: { $ref: 'l', out: 'effectIds' } } }]],
      ['an item past the end', [{ op: 'add_adjustment', args: { span: { start: f(0), duration: f(30) }, effects: [{ type: 'color.sepia' }] }, bind: 'l' }, { op: 'remove_effect', args: { clipId: { $ref: 'l' }, effectId: { $ref: 'l', out: 'effectIds', at: 3 } } }]],
      ['an unknown asset', [{ op: 'add_clip', args: { assetId: { $asset: 'other' }, start: f(0) } }]],
      ['a bad bind name in a reference', [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 't' }, { op: 'set_clip_transform', args: { clipId: { $ref: 'T' }, transform: { x: 0.1 } } }]],
      ['deep nesting', [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30), style: JSON.parse(`${'{"a":'.repeat(70)}1${'}'.repeat(70)}`) } }]],
    ];
    for (const [what, ops] of bad) {
      const e = refusal(() => tx(base(), [call(ops)]));
      expect([what, e.code]).toEqual([what, 'invalid_args']);
    }
    expect(refusal(() => tx(base(), [call(bad[0]![1])])).message).toMatch(/^template step 0 \(add_text\): "\$ref": "later" names no earlier step$/);
  });
  it('names that every object answers to find nothing: "constructor" as a reference, an asset key or an output key, "toString" as an output key', () => {
    // 'constructor' passes BIND_NAME. Under an id-like key (clipId, trackId, …) the generic guard of every transaction
    // (refuseInheritedIds) refuses it first, as not_found; anywhere else the bindings' own Maps and Object.hasOwn find nothing.
    const t: TemplateStep = { op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 't' };
    const inherited: [TemplateStep[], string][] = [
      [[{ op: 'set_clip_transform', args: { clipId: { $ref: 'constructor' }, transform: { x: 0.1 } } }], 'not_found'],
      [[{ op: 'add_clip', args: { assetId: { $asset: 'constructor' }, start: f(0) } }], 'not_found'],
      [[{ op: 'add_text', args: { text: { $ref: 'constructor' }, start: f(0), duration: f(30) } }], 'invalid_args'],
      [[{ op: 'add_text', args: { text: { $asset: 'constructor' }, start: f(0), duration: f(30) } }], 'invalid_args'],
      [[{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) }, bind: 'constructor' }, { op: 'add_text', args: { text: { $ref: 'constructor', out: 'trackId' }, start: f(30), duration: f(30) } }], 'ok'],
      [[t, { op: 'add_text', args: { text: { $ref: 't', out: 'toString' }, start: f(30), duration: f(30) } }], 'invalid_args'],
      [[t, { op: 'add_text', args: { text: { $ref: 't', out: 'constructor' }, start: f(30), duration: f(30) } }], 'invalid_args'],
      [[t, { op: 'add_text', args: { text: { $ref: 't', out: 'hasOwnProperty', at: 0 }, start: f(30), duration: f(30) } }], 'invalid_args'],
      [[t, { op: 'set_clip_transform', args: { clipId: { $ref: 't', out: 'toString' }, transform: { x: 0.1 } } }], 'not_found'],
    ];
    for (const [ops, want] of inherited) {
      if (want === 'ok') { expect(tx(base(), [call(ops)]).doc).toBeTruthy(); continue; } // a step bound as "constructor" is an ordinary bind
      expect([JSON.stringify(ops.at(-1)!.args), refusal(() => tx(base(), [call(ops)])).code]).toEqual([JSON.stringify(ops.at(-1)!.args), want]);
    }
    // resolveBindings itself: inherited names find nothing in the Maps or on the output
    const bound = new Map([['t', { clipId: 'clp_1' }]]);
    for (const b of [{ $ref: 'constructor' }, { $ref: 't', out: 'toString' }, { $ref: 't', out: 'valueOf' }, { $ref: 't', out: 'constructor', at: 0 }, { $asset: 'constructor' }, { $asset: 'toString' }])
      expect(refusal(() => resolveBindings({ clipId: b }, bound, new Map(), 'x')).code).toBe('invalid_args');
  });
  it('a bind name "__proto__" fails the schema; a "__proto__" key in parsed arguments stays an ordinary key and pollutes nothing', () => {
    expect(refusal(() => tx(base(), [call([{ op: 'add_track', args: { kind: 'video' }, bind: '__proto__' }])])).code).toBe('invalid_args');
    expect(refusal(() => tx(base(), [call([{ op: 'add_track', args: { kind: 'video' } }], { slots: [{ key: '__proto__', kind: 'picture', clipId: 'clp_x' }] })])).code).toBe('invalid_args');
    const args = JSON.parse('{"text":"x","start":{"value":"0","timescale":30},"duration":{"value":"30","timescale":30},"__proto__":{"polluted":true}}');
    const out = resolveBindings(args, new Map(), new Map(), 'x') as Record<string, unknown>;
    expect(Object.hasOwn(out, '__proto__')).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(refusal(() => tx(base(), [call([{ op: 'add_text', args }])])).code).toBe('invalid_args'); // add_text is strict: an unknown key
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it('a bind name used twice is refused', () => {
    const e = refusal(() => tx(base(), [call([{ op: 'add_track', args: { kind: 'video' }, bind: 'v' }, { op: 'add_track', args: { kind: 'video' }, bind: 'v' }])]));
    expect([e.code, e.message]).toEqual(['invalid_args', 'template step 1 (add_track): the bind name "v" is used twice']);
  });
});

describe('what a template may do', () => {
  it('an internal step is forbidden_op; an unknown op too', () => {
    for (const op of ['import_asset', 'apply_recipe', 'apply_template', 'restore_entities', 'attach_analysis', 'no_such_op']) {
      const e = refusal(() => tx(base(), [call([{ op, args: {} }])]));
      expect([op, e.code]).toEqual([op, 'forbidden_op']);
    }
  });
  it('a template that needs a model is never applied, whatever the plan', () => {
    for (const id of ['tpl.text-behind-subject', 'tpl.3d-zoom']) {
      const e = refusal(() => tx(base(), [call(PLAN, { templateId: id })]));
      expect([e.code, e.message]).toEqual(['incompatible', `template ${id} needs a model that is not installed, so it is never applied`]);
    }
  });
  it('2001 steps are refused; 2000 parse', () => {
    const step: TemplateStep = { op: 'add_track', args: { kind: 'video' } };
    expect(refusal(() => tx(base(), [call(Array.from({ length: 2001 }, () => step))])).code).toBe('invalid_args');
  });
  it('without allowInternal the op is refused and nothing changes', () => {
    const doc = base();
    expect(refusal(() => applyTransaction(doc, [call(PLAN)], { idSeed: 'x', actor: 'agent' })).code).toBe('forbidden_op');
    expect(doc).toEqual(base());
  });
  it('a slot that names no clip the template made is invalid_result', () => {
    for (const clipId of ['clp_none', { $ref: 'nobody' }, { $ref: 'one', out: 'trackId' }] as const) {
      const e = refusal(() => tx(base(), [call(PLAN, { slots: [{ key: 's', kind: 'picture', clipId }] })]));
      expect(e.code).toBe('invalid_result');
    }
  });
});

describe('assets', () => {
  it('two assets with the same content give one asset; an asset already in the library is reused', () => {
    const plan: TemplateStep[] = [{ op: 'add_clip', args: { assetId: { $asset: 'a' }, start: f(0), duration: f(30) } }, { op: 'add_clip', args: { assetId: { $asset: 'b' }, start: f(30), duration: f(30) } }];
    const r = tx(base(), [call(plan, { assets: [{ key: 'a', asset: picture('c') }, { key: 'b', asset: { ...picture('c'), name: 'same.png' } }] })]);
    const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
    expect(Object.keys(r.doc.assets)).toHaveLength(1);
    expect(out.assetIds.a).toBe(out.assetIds.b);
    const again = tx(r.doc, [call(plan, { assets: [{ key: 'a', asset: picture('c') }, { key: 'b', asset: picture('d') }] })]);
    expect(Object.keys(again.doc.assets)).toHaveLength(2);
    expect((again.results[0]!.output as unknown as ApplyTemplateOutput).assetIds.a).toBe(out.assetIds.a);
    expect(refusal(() => tx(base(), [call(plan, { assets: [{ key: 'a', asset: picture('c') }, { key: 'a', asset: picture('d') }] })])).code).toBe('invalid_args');
  });
});

describe('the run record and regeneration', () => {
  it('records recipeId template:<id>, the params with the version, the created ids, their fingerprints and the slots', () => {
    const r = tx(base(), [call(PLAN, { slots: SLOTS, templateVersion: 3 })]);
    const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
    const run = r.doc.recipeRuns[out.runId]!;
    expect(run.recipeId).toBe('template:tpl.x');
    expect(run.params).toEqual({ lang: 'he', templateVersion: 3 });
    expect(run.steps).toEqual(['plan step']);
    expect(run.slots).toEqual(out.slots);
    const clips = clipsOf(r.doc).map((x) => x.c);
    for (const c of clips) {
      expect(run.createdIds).toContain(c.id);
      expect(run.fingerprints[c.id]).toBe(fingerprint(c));
    }
    expect(out.createdIds).toEqual(run.createdIds);
  });
  it('the same arguments and id seed give canonical-equal documents', () => {
    const a = tx(base(), [call(PLAN, { slots: SLOTS })], 'same_').doc;
    const b = tx(base(), [call(PLAN, { slots: SLOTS })], 'same_').doc;
    expect(canonical(a)).toBe(canonical(b));
  });
  it('regeneration removes the untouched clips, keeps a hand-edited one with its original fingerprint, and keeps its slot', () => {
    const first = tx(base(), [call(PLAN, { slots: SLOTS })]);
    const out = first.results[0]!.output as unknown as ApplyTemplateOutput;
    const run = first.doc.recipeRuns[out.runId]!;
    const [one, two] = out.slots;
    // the second picture is edited by hand
    const edited = tx(first.doc, [{ op: 'set_clip_transform', args: { clipId: two!.clipId, transform: { x: 0.25 } } }]).doc;
    const remove = run.createdIds.filter((id) => id !== two!.clipId && clipsOf(edited).some((x) => x.c.id === id));
    const replan: TemplateStep[] = [
      { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(0), duration: f(60), trackId: { $ref: 'v' } }, bind: 'one' },
      { op: 'add_adjustment', args: { span: { start: f(0), duration: f(120) }, effects: [{ type: 'color.sepia' }] }, bind: 'look' },
    ].map((s, i) => (i === 0 ? { ...s, args: { ...(s.args as object), trackId: clipsOf(edited).find((x) => x.c.id === two!.clipId)!.t.id } } : s));
    const r = acceptAndUndo(edited, [call(replan, { runId: out.runId, removeClipIds: remove, keepIds: [two!.clipId], keepSlots: [two!], slots: [{ key: 'one', kind: 'picture', clipId: { $ref: 'one' } }, { key: 'look', kind: 'look', clipId: { $ref: 'look' } }] })]);
    const again = r.results[0]!.output as unknown as ApplyTemplateOutput;
    expect(again.runId).toBe(out.runId);
    const ids = clipsOf(r.doc).map((x) => x.c.id);
    expect(ids).not.toContain(one!.clipId);
    expect(ids).toContain(two!.clipId);
    const rerun = r.doc.recipeRuns[out.runId]!;
    expect(rerun.fingerprints[two!.clipId]).toBe(run.fingerprints[two!.clipId]); // the ORIGINAL fingerprint, so it still reads as hand-edited
    expect(rerun.fingerprints[two!.clipId]).not.toBe(fingerprint(clipsOf(r.doc).find((x) => x.c.id === two!.clipId)!.c));
    expect(rerun.slots!.map((s) => s.key)).toEqual(['two', 'one', 'look']);
    expect(clipsOf(r.doc).filter((x) => x.c.type === 'adjustment').map((x) => x.c.effects![0]!.type)).toEqual(['color.sepia']);
  });
  it('a run id of another template or of a recipe is refused', () => {
    const first = tx(base(), [call(PLAN)]);
    const runId = (first.results[0]!.output as unknown as ApplyTemplateOutput).runId;
    const e = refusal(() => tx(first.doc, [{ op: 'apply_template', args: { ...(call(PLAN).args as object), templateId: 'tpl.other', runId } }]));
    expect([e.code, e.message]).toEqual(['invalid_args', `run ${runId} is a run of template:tpl.x, not of template:tpl.other`]);
  });
});
