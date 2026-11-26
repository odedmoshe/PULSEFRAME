/**
 * «תמונה חיה» (wave 8 living, W2) in the evaluator and the compositor: evaluate copies the clip's drawn depth into the photo layer
 * (so the frame key covers every stroke), and drawPinned asks the view for the depth of every layer with an enabled living picture,
 * handing the pass the strip, or null with the reason (no depth, rotated, a view without depth, a depth that could not be made):
 * the effect is then reported unavailable, never drawn flat (verifier C6).
 *
 * TEST STAND-INS, labelled: (1) the living picture is put on the clip by writing the document directly (`withLiving`), because
 * set_living_picture's body is W1's and is built in a sibling worktree; the record is exactly what the op stores (one depth.living
 * instance, travel keyed, clip.depth). (2) OffscreenCanvas is a recording stub (no pixels). (3) gpu.ts's gpuEffect is replaced by
 * a spy that records the env it is handed and answers "not drawn", so these rows say what the pass is GIVEN, not what it draws;
 * the pass itself is checked against livingModel on the software adapter (W2 report) and by gpu.models.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, depthKey, type ClipDepth, type OpCall, type ProjectDocument } from '@pulseframe/core';

const seen: { type: string; env: Record<string, unknown> }[] = [];
vi.mock('./gpu.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('./gpu.ts')>();
  return { ...real, gpuEffect: async (type: string, _p: unknown, _s: unknown, _d: unknown, env: Record<string, unknown>) => { seen.push({ type, env }); return false; } };
});
const { evaluate } = await import('./evaluate.ts');
const { drawGraph, livingLayerUnavailable } = await import('./compositor2d.ts');
const { frameKeyOfGraph } = await import('./frameKey.ts');
const { ctxFor } = await import('./frameKey.testDocs.ts');
const { LIVING_UNAVAILABLE_WHY } = await import('./gpu.ts');
type FrameProvider = import('./compositor2d.ts').FrameProvider;

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `lv${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };
const DAB: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 300, pts: [500, 500] }] };

function photo(): { doc: ProjectDocument; clipId: string } {
  let r = tx(createProject({ id: 'prj_lv', name: 'Living', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: still } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(90) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string };
}
/** STAND-IN for set_living_picture (W1): the record the op stores, written directly. */
function withLiving(doc: ProjectDocument, clipId: string, o: { depth?: ClipDepth | null; rotation?: number; enabled?: boolean } = {}): ProjectDocument {
  const d = structuredClone(doc);
  const clip = d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)! as Extract<ProjectDocument['sequences'][string]['tracks'][number]['clips'][number], { type: 'media' }>;
  if (o.depth !== null) clip.depth = o.depth ?? DAB;
  if (o.rotation) clip.transform = { ...clip.transform, rotation: o.rotation };
  clip.effects = [...(clip.effects ?? []), { id: 'fx_living', type: 'depth.living', enabled: o.enabled ?? true, params: { move: 'slide', amount: 0.5, travel: 0 }, keyframes: { travel: [{ time: f(0), value: 0, easing: 'ease-in-out' }, { time: f(89), value: 1, easing: 'linear' }] } }];
  return d;
}

class StubCanvas {
  constructor(public width: number, public height: number) {}
  getContext() { return new Proxy({ canvas: this } as Record<string, unknown>, { get: (t, k: string) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k: string, v) => { t[k] = v; return true; } }); }
}
beforeAll(() => { vi.stubGlobal('OffscreenCanvas', StubCanvas); });
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => { seen.length = 0; });
const target = () => new StubCanvas(640, 360).getContext() as unknown as Parameters<typeof drawGraph>[0];
const picture = { draw: () => {} };
function provider(depth?: (l: unknown) => Promise<unknown>): FrameProvider & { asked: unknown[] } {
  const asked: unknown[] = [];
  const p = Object.assign(async () => picture, depth ? { depth: (l: unknown) => { asked.push(l); return depth(l); } } : {}, { asked });
  return p as unknown as FrameProvider & { asked: unknown[] };
}
const strip = { key: depthKey(DAB), width: 256, height: 144, data: new Uint8Array(256 * 144 * 4) };

describe('evaluate: the drawn depth rides on the photo layer (W2)', () => {
  it('copies clip.depth as stored; a photo without a depth has none (every graph without a depth is unchanged)', () => {
    const { doc, clipId } = photo();
    const plain = evaluate(doc, f(10)).layers[0]!;
    expect('depth' in plain).toBe(false);
    const layer = evaluate(withLiving(doc, clipId), f(10)).layers[0]! as { kind: string; depth?: ClipDepth };
    expect(layer.kind).toBe('image');
    expect(layer.depth).toEqual(DAB);
  });
  it('the frame key covers every stroke: a changed stroke changes it, an equal record keeps it, and without the effect the depth still counts', () => {
    const { doc, clipId } = photo();
    const ctx = (d: ProjectDocument) => ({ ...ctxFor(d), gpu: { adapter: 'swiftshader|test', software: true } });
    const key = (d: ProjectDocument) => frameKeyOfGraph(d, evaluate(d, f(10)), ctx(d));
    const a = withLiving(doc, clipId), same = withLiving(doc, clipId, { depth: structuredClone(DAB) });
    const moved = withLiving(doc, clipId, { depth: { ...DAB, strokes: [{ layer: 'near', size: 300, pts: [501, 500] }] } });
    const far = withLiving(doc, clipId, { depth: { ...DAB, strokes: [{ layer: 'far', size: 300, pts: [500, 500] }] } });
    expect(key(same)).toBe(key(a));
    expect(key(moved)).not.toBe(key(a));
    expect(key(far)).not.toBe(key(a));
    expect(key(withLiving(doc, clipId, { depth: null }))).not.toBe(key(a));
  });
});

describe('drawPinned: the depth of a living picture (W2, C6)', () => {
  it('asks the view for the depth once per layer, with the layer that carries it, and hands the pass the strip and the box', async () => {
    const { doc, clipId } = photo();
    const p = provider(async () => strip);
    const res = await drawGraph(target(), evaluate(withLiving(doc, clipId), f(45)), p);
    expect(p.asked).toHaveLength(1);
    expect((p.asked[0] as { depth: ClipDepth }).depth).toEqual(DAB);
    expect(seen.map((s) => s.type)).toEqual(['depth.living']);
    expect(seen[0]!.env.depth).toBe(strip);
    expect(seen[0]!.env.depthReason).toBeUndefined();
    expect(seen[0]!.env.box).toMatchObject({ cx: 320, cy: 180, w: 640, h: 360, rotation: 0, scale: 1 });
    expect(res.missing).toEqual([]);
  });
  it('a photo with no depth: the view is not asked, the pass gets null with the no-depth reason', async () => {
    const { doc, clipId } = photo();
    const p = provider(async () => strip);
    await drawGraph(target(), evaluate(withLiving(doc, clipId, { depth: null }), f(45)), p);
    expect(p.asked).toHaveLength(0);
    expect(seen[0]!.env).toMatchObject({ depth: null, depthReason: LIVING_UNAVAILABLE_WHY.no_depth });
  });
  it('a rotated photo: null with the rotated reason (rotated picture-in-picture is cut)', async () => {
    const { doc, clipId } = photo();
    const p = provider(async () => strip);
    await drawGraph(target(), evaluate(withLiving(doc, clipId, { rotation: 10 }), f(45)), p);
    expect(p.asked).toHaveLength(0);
    expect(seen[0]!.env).toMatchObject({ depth: null, depthReason: LIVING_UNAVAILABLE_WHY.rotated });
  });
  it('a view without depth, a view that gives null and a view that fails: null, each with its reason', async () => {
    const { doc, clipId } = photo();
    const g = evaluate(withLiving(doc, clipId), f(45));
    await drawGraph(target(), g, provider());
    expect(seen.at(-1)!.env).toMatchObject({ depth: null, depthReason: LIVING_UNAVAILABLE_WHY.no_provider });
    await drawGraph(target(), g, provider(async () => null));
    expect(seen.at(-1)!.env).toMatchObject({ depth: null, depthReason: LIVING_UNAVAILABLE_WHY.no_depth });
    await drawGraph(target(), g, provider(async () => { throw new Error('depthGrid: not built'); }));
    expect(seen.at(-1)!.env).toMatchObject({ depth: null, depthReason: 'the drawn depth could not be made: depthGrid: not built' });
  });
  it('a disabled living picture asks for nothing and runs no pass; other layers get no depth at all', async () => {
    const { doc, clipId } = photo();
    const p = provider(async () => strip);
    await drawGraph(target(), evaluate(withLiving(doc, clipId, { enabled: false }), f(45)), p);
    expect(p.asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });
  it('livingLayerUnavailable reads core livingUnavailable on the layer: no depth, rotated, or drawable', () => {
    const t = { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
    expect(livingLayerUnavailable({ kind: 'image', transform: t, depth: DAB })).toBeNull();
    expect(livingLayerUnavailable({ kind: 'image', transform: t })).toBe('no_depth');
    expect(livingLayerUnavailable({ kind: 'video', transform: t, depth: DAB })).toBe('no_depth');
    expect(livingLayerUnavailable({ kind: 'image', transform: { ...t, rotation: 5 }, depth: DAB })).toBe('rotated');
  });
});
