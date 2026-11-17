/**
 * Adjustment layers in the evaluator and the compositor (ADR-0016). An adjustment clip has no picture of its own: its
 * effects, mask, opacity and blend act on everything drawn before it in the graph (the tracks below it), and captions,
 * drawn last, are never affected. Strobes on an adjustment join the one flash schedule of the timeline (ADR-0009).
 *
 * The drawing checks run the real drawGraph in Node on stand-in canvases that only record the calls (TEST STAND-IN: no
 * pixels; OffscreenCanvas is stubbed for the scratch buffers). They show what is drawn, in which order, from which buffer
 * and with which opacity and composite operation, not what a browser makes of it (proof:adjust measures the pixels).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type Clip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { ADJUST_PASS_SLOT, describeMoment, evaluate, type AdjustLayer, type Layer, type RenderGraph } from './evaluate.ts';
import { drawGraph, frameDecoders, type Ctx2D, type FrameProvider } from './compositor2d.ts';
import { FlashGuard, flashGapFrames, flashSchedule } from './strobeSchedule.ts';
import { FLASH_SINCE } from './gpu.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `adj${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };

/** Video on V1 (0–90), a title on T1 (0–90), a caption cue (0–90). */
function base() {
  let r = tx(createProject({ id: 'prj_adj', name: 'Adj', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  const videoId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: videoId, start: f(0), duration: f(90), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_text', args: { text: 'Title', start: f(0), duration: f(90) } }]);
  const titleId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }]);
  const captionTrackId = r.results[0]!.output!.trackId as string;
  r = tx(r.doc, [{ op: 'add_cue', args: { trackId: captionTrackId, start: f(0), duration: f(90), text: 'שלום עולם' } }]);
  return { doc: r.doc, videoId, stillId, clipId, titleId, captionTrackId };
}
/** add_adjustment and the new clip's id and track. */
function adjust(doc: ProjectDocument, args: Record<string, unknown>) {
  const r = tx(doc, [{ op: 'add_adjustment', args }]);
  return { doc: r.doc, adjId: r.results[0]!.output!.clipId as string, fxTrackId: r.results[0]!.output!.trackId as string };
}
const seqOf = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!;
/** A copy of the document with one clip changed directly (evaluate is pure over any valid document). */
function withClip(doc: ProjectDocument, clipId: string, change: (c: Clip) => void): ProjectDocument {
  const out = structuredClone(doc);
  for (const t of seqOf(out).tracks) for (const c of t.clips) if (c.id === clipId) change(c);
  return out;
}
const kinds = (g: RenderGraph) => g.layers.map((l) => l.kind);
const adjustOf = (g: RenderGraph) => g.layers.find((l): l is AdjustLayer => l.kind === 'adjust');

describe('adjustment layers in the evaluator (ADR-0016)', () => {
  it('the adjust layer sits in track order: above the pictures, below the titles of a higher track, always before the captions', () => {
    const b = base();
    const { doc, adjId, fxTrackId } = adjust(b.doc, { span: 'edit', effects: [{ type: 'color.grayscale' }] });
    // new FX tracks go above the picture tracks and below the title tracks
    expect(seqOf(doc).tracks.map((t) => t.kind)).toEqual(['video', 'adjustment', 'text', 'caption', 'audio']);
    const g = evaluate(doc, f(10));
    expect(kinds(g)).toEqual(['video', 'adjust', 'text', 'caption']);
    expect(adjustOf(g)).toMatchObject({ kind: 'adjust', clipId: adjId, trackId: fxTrackId, opacity: 1, effects: [{ type: 'color.grayscale' }] });
    // moved above the title track, the look covers the title too; captions stay last whatever the order
    const moved = tx(doc, [{ op: 'move_track', args: { trackId: fxTrackId, toIndex: 2 } }]).doc;
    expect(kinds(evaluate(moved, f(10)))).toEqual(['video', 'text', 'adjust', 'caption']);
    const top = tx(doc, [{ op: 'move_track', args: { trackId: fxTrackId, toIndex: 3 } }]).doc;
    expect(seqOf(top).tracks.map((t) => t.kind)).toEqual(['video', 'text', 'caption', 'adjustment', 'audio']);
    expect(kinds(evaluate(top, f(10)))).toEqual(['video', 'text', 'adjust', 'caption']);
  });
  it('active on its span only (half-open), with span "edit" ending at the last picture or title', () => {
    const b = base();
    const { doc } = adjust(b.doc, { span: { start: f(30), duration: f(15) }, effects: [{ type: 'color.invert' }] });
    expect(adjustOf(evaluate(doc, f(29)))).toBeUndefined();
    expect(adjustOf(evaluate(doc, f(30)))).toBeDefined();
    expect(adjustOf(evaluate(doc, f(44)))).toBeDefined();
    expect(adjustOf(evaluate(doc, f(45)))).toBeUndefined();
    const whole = adjust(b.doc, { span: 'edit', effects: [{ type: 'color.invert' }] }).doc;
    expect(adjustOf(evaluate(whole, f(0)))).toBeDefined();
    expect(adjustOf(evaluate(whole, f(89)))).toBeDefined();
    expect(adjustOf(evaluate(whole, f(90)))).toBeUndefined();
  });
  it('a hidden FX track gives no layer', () => {
    const { doc, fxTrackId } = adjust(base().doc, { span: 'edit', effects: [{ type: 'color.grayscale' }] });
    const hidden = tx(doc, [{ op: 'update_track', args: { trackId: fxTrackId, hidden: true } }]).doc;
    expect(kinds(evaluate(hidden, f(10)))).toEqual(['video', 'text', 'caption']);
  });
  it('opacity 0, or no effects, no mask and the normal blend, gives no layer; a disabled effect does not count', () => {
    const b = base();
    expect(adjustOf(evaluate(adjust(b.doc, { span: 'edit', effects: [{ type: 'color.grayscale' }], opacity: 0 }).doc, f(10)))).toBeUndefined();
    const bare = adjust(b.doc, { span: 'edit' });
    expect(adjustOf(evaluate(bare.doc, f(10)))).toBeUndefined();
    const disabled = structuredClone(adjust(b.doc, { span: 'edit', effects: [{ type: 'color.grayscale' }] }).doc);
    for (const t of seqOf(disabled).tracks) for (const c of t.clips) if (c.type === 'adjustment') c.effects = c.effects!.map((e) => ({ ...e, enabled: false }));
    expect(adjustOf(evaluate(disabled, f(10)))).toBeUndefined();
    // a mask alone, or a blend mode alone, is a pass (the blend of the frame with itself is a look of its own)
    const masked = withClip(bare.doc, bare.adjId, (c) => { if (c.type === 'adjustment') c.mask = { shape: 'ellipse', x: 0, y: 0, width: 0.5, height: 0.5, radius: 0, feather: 0, invert: false }; });
    expect(adjustOf(evaluate(masked, f(10)))).toMatchObject({ mask: { shape: 'ellipse' } });
    const blended = withClip(bare.doc, bare.adjId, (c) => { c.blend = 'multiply'; });
    expect(adjustOf(evaluate(blended, f(10)))).toMatchObject({ blend: 'multiply' });
    expect(adjustOf(evaluate(withClip(bare.doc, bare.adjId, (c) => { c.blend = 'normal'; }), f(10)))).toBeUndefined();
  });
  it('opacity is the clip\'s own at the frame, keyframes included; at 0 on a keyframe the layer is left out', () => {
    const { doc, adjId } = adjust(base().doc, { span: 'edit', effects: [{ type: 'color.sepia' }] });
    const faded = withClip(doc, adjId, (c) => { c.keyframes = { opacity: [{ time: f(0), value: 0, easing: 'linear' }, { time: f(30), value: 1, easing: 'linear' }] }; });
    expect(adjustOf(evaluate(faded, f(0)))).toBeUndefined();
    expect(adjustOf(evaluate(faded, f(15)))!.opacity).toBeCloseTo(0.5, 10);
    expect(adjustOf(evaluate(faded, f(45)))!.opacity).toBe(1);
  });
  it('a time effect found on an adjustment (an older document; validation refuses it) is left out of the pass', () => {
    const { doc, adjId } = adjust(base().doc, { span: 'edit', effects: [{ type: 'color.grayscale' }] });
    const old = withClip(doc, adjId, (c) => { if (c.type === 'adjustment') c.effects = [{ id: 'fx_t', type: 'time.echo', enabled: true, params: { count: 4, delay: 3, decay: 0.6, mode: 'blend' } }, ...c.effects!]; });
    expect(adjustOf(evaluate(old, f(10)))!.effects!.map((e) => e.type)).toEqual(['color.grayscale']);
  });
  it('lattice overlays on an adjustment get the held parameters, exactly as on a clip (holdOverlays)', () => {
    const b = base();
    const onAdj = adjust(b.doc, { span: 'edit', effects: [{ type: 'overlay.snow' }] }).doc;
    const onClip = tx(b.doc, [{ op: 'add_effect', args: { clipId: b.clipId, type: 'overlay.snow' } }]).doc;
    const a = adjustOf(evaluate(onAdj, f(10)))!.effects![0]!;
    const c = (evaluate(onClip, f(10)).layers[0] as Exclude<Layer, { kind: 'caption' }>).effects![0]!;
    expect(a.type).toBe('overlay.snow');
    expect(a.params).toEqual(c.params);
  });
  it('frameDecoders(g).count is equal with and without the adjustment (it decodes nothing)', () => {
    const b = base();
    const { doc } = adjust(b.doc, { span: 'edit', effects: [{ type: 'blur.gaussian', params: { radius: 0.01 } }] });
    for (const F of [0, 10, 45, 89]) {
      expect(frameDecoders(evaluate(doc, f(F)))).toEqual(frameDecoders(evaluate(b.doc, f(F))));
      expect(frameDecoders(evaluate(doc, f(F))).count).toBe(1);
    }
  });
  it('light.strobe on an adjustment takes its flashes from the one schedule, shared with a strobe on a clip: starts at least flashGapFrames apart', () => {
    const b = base();
    let { doc, adjId } = adjust(b.doc, { span: 'edit', effects: [{ type: 'light.strobe', params: { rate: 3, amount: 0.8 } }] });
    doc = tx(doc, [{ op: 'add_effect', args: { clipId: b.clipId, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]).doc;
    const schedule = flashSchedule(doc);
    const adjFx = seqOf(doc).tracks.flatMap((t) => t.clips).find((c) => c.id === adjId)!;
    const fxId = adjFx.type === 'adjustment' ? adjFx.effects![0]!.id : '';
    const own = schedule.shown.get(`${adjId}\n${fxId}`);
    expect(own && own.length).toBeGreaterThan(0);
    // flashes wanted on the same frame are one flash (kept for both strobes): the distinct start frames of the timeline
    const all = [...new Set([...schedule.shown.values()].flatMap((x) => [...x]))].sort((p, q) => p - q);
    expect([...schedule.shown.keys()].length).toBe(2); // the clip's strobe kept starts too
    const gap = flashGapFrames(30);
    for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(gap);
    // the evaluator hands the adjustment's strobe the seconds since its own last scheduled start
    const first = own![0]!;
    const at = adjustOf(evaluate(doc, f(first)))!.effects![0]!;
    expect(at.params[FLASH_SINCE]).toBe(0);
    expect(adjustOf(evaluate(doc, f(first + 3)))!.effects![0]!.params[FLASH_SINCE]).toBeCloseTo(0.1, 10);
  });
  it('FlashGuard holds back a strobe rise on an adjustment that comes too soon in real time (the preview guard sees adjust layers)', () => {
    const { doc } = adjust(base().doc, { span: 'edit', effects: [{ type: 'light.strobe', params: { rate: 3, amount: 1 } }] });
    const own = [...flashSchedule(doc).shown.values()][0]!;
    const guard = new FlashGuard();
    // two scheduled flash starts shown 0.1 s apart (a shuttle): the second is not let through
    const g1 = guard.apply(evaluate(doc, f(own[0]!)), 0);
    expect(adjustOf(g1)!.effects![0]!.params[FLASH_SINCE]).toBe(0);
    guard.apply(evaluate(doc, f(own[0]! + 6)), 0.05); // faded: the fall
    const g2 = guard.apply(evaluate(doc, f(own[1]!)), 0.1);
    expect(adjustOf(g2)!.effects![0]!.params[FLASH_SINCE]).toBe(Infinity);
    expect(guard.leftOut).toBe(1);
  });
  it('describeMoment lists the adjustment with its effects, opacity, mask and blend', () => {
    const { doc, adjId } = adjust(base().doc, { span: 'edit', effects: [{ type: 'color.grayscale' }, { type: 'blur.gaussian' }], opacity: 0.5 });
    const shaped = withClip(doc, adjId, (c) => { c.blend = 'screen'; if (c.type === 'adjustment') c.mask = { shape: 'rect', x: 0, y: 0, width: 0.5, height: 0.5, radius: 0, feather: 0, invert: true }; });
    const m = describeMoment(shaped, f(10));
    expect(m.layers.map((l) => l.kind)).toEqual(['video', 'adjust', 'text', 'caption']);
    expect(m.layers[1]).toEqual({ kind: 'adjust', clipId: adjId, effects: ['color.grayscale', 'blur.gaussian'], opacity: 0.5, mask: 'rect', blend: 'screen' });
  });
});

// ---------- drawing, on recording stand-ins ----------
interface Ev { on: string; op: string; alpha?: unknown; gco?: unknown; filter?: unknown; src?: string; text?: string }
const log: Ev[] = [];
let canvasNo = 0;
/** A stand-in 2D context that records draws with the state they were made in (labelled TEST STAND-IN). */
function recorder(name: string, canvas: object): Ctx2D {
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', direction: 'ltr' };
  const stack: Record<string, unknown>[] = [];
  const nameOf = (x: unknown) => (x && typeof x === 'object' && 'label' in x ? String((x as { label: string }).label) : 'other');
  const api: Record<string, unknown> = {
    canvas,
    save: () => stack.push({ ...state }), restore: () => Object.assign(state, stack.pop()),
    drawImage: (src: unknown) => log.push({ on: name, op: 'drawImage', src: nameOf(src), alpha: state.globalAlpha, gco: state.globalCompositeOperation, filter: state.filter }),
    fillText: (text: string) => log.push({ on: name, op: 'fillText', text, alpha: state.globalAlpha, gco: state.globalCompositeOperation }),
    strokeText: () => {},
    measureText: (text: string) => ({ width: text.length * 10 }),
    getTransform: () => ({ a: 1, b: 0 }),
  };
  return new Proxy(api, { get: (t, k: string) => (k in t ? t[k] : k in state ? state[k] : () => {}), set: (_t, k: string, v) => { state[k] = v; return true; } }) as unknown as Ctx2D;
}
class StubCanvas {
  readonly label = `scratch#${++canvasNo}`;
  private readonly ctx = recorder(this.label, this);
  constructor(public width: number, public height: number) {}
  getContext() { return this.ctx; }
}
beforeAll(() => { vi.stubGlobal('OffscreenCanvas', StubCanvas); });
afterAll(() => { vi.unstubAllGlobals(); });

/** Draw frame F with a spy frame provider: what was asked for, and the recorded draws of the frame's own canvas. */
async function draw(doc: ProjectDocument, F: number) {
  log.length = 0;
  const asked: string[] = [];
  const frames: FrameProvider = async (l) => { asked.push(l.kind); return { draw: () => log.push({ on: 'main', op: 'picture' }) }; };
  const main = recorder('main', { label: 'main-canvas' });
  const result = await drawGraph(main, evaluate(doc, f(F)), frames);
  return { asked, result, events: [...log] };
}

describe('the adjustment pass in drawGraph (ADR-0016)', () => {
  it('a spy frame provider is never asked for the adjustment; only the clip\'s picture is', async () => {
    const b = base();
    const plain = await draw(b.doc, 10);
    const { doc } = adjust(b.doc, { span: 'edit', effects: [{ type: 'color.grayscale' }] });
    const withAdj = await draw(doc, 10);
    expect(plain.asked).toEqual(['video']);
    expect(withAdj.asked).toEqual(['video']);
    expect(withAdj.result.missing).toEqual([]);
    expect(withAdj.result.unavailableEffects).toEqual([]);
  });
  it('copies the frame so far, runs the effects, and composites back with the clip\'s opacity and blend, after the picture and the title below it and before the caption', async () => {
    const b = base();
    const { doc, adjId } = adjust(b.doc, { span: 'edit', effects: [{ type: 'color.grayscale' }], opacity: 0.5 });
    const shaped = withClip(doc, adjId, (c) => { c.blend = 'multiply'; });
    // the FX track above the title: the order is picture, title, adjustment, caption
    const fxTrackId = seqOf(shaped).tracks.find((t) => t.kind === 'adjustment')!.id;
    const top = tx(shaped, [{ op: 'move_track', args: { trackId: fxTrackId, toIndex: 2 } }]).doc;
    const { events } = await draw(top, 10);
    const main = events.filter((e) => e.on === 'main');
    const picture = main.findIndex((e) => e.op === 'picture');
    const title = main.findIndex((e) => e.op === 'fillText' && e.text === 'Title');
    const back = main.findIndex((e) => e.op === 'drawImage' && e.src !== 'other' && e.src!.startsWith('scratch#'));
    const caption = main.findIndex((e) => e.op === 'fillText' && e.text !== 'Title');
    expect(picture).toBeGreaterThanOrEqual(0);
    expect([picture < title, title < back, back < caption]).toEqual([true, true, true]);
    expect(main[back]).toMatchObject({ alpha: 0.5, gco: 'multiply' });
    expect(main[caption]).toMatchObject({ alpha: 1, gco: 'source-over' }); // the caption is drawn plainly after the pass
    // the snapshot: a scratch canvas drew the frame's own canvas; the effect ran as a filter from it into another scratch canvas
    const snap = events.find((e) => e.op === 'drawImage' && e.src === 'main-canvas');
    expect(snap).toBeDefined();
    const filtered = events.find((e) => e.op === 'drawImage' && e.on !== 'main' && e.src === snap!.on);
    expect(filtered).toMatchObject({ filter: expect.stringContaining('grayscale') });
    expect(main[back]!.src).toBe(filtered!.on);
  });
  it('the scratch slot of the pass is the one allocated to this track (wave 3: 14)', () => {
    expect(ADJUST_PASS_SLOT).toBe(14);
  });
  it('the normal blend at full opacity composites with source-over; a mask leaves the frame copy masked before it goes back', async () => {
    const b = base();
    const { doc, adjId } = adjust(b.doc, { span: 'edit', effects: [{ type: 'color.invert' }] });
    const masked = withClip(doc, adjId, (c) => { if (c.type === 'adjustment') c.mask = { shape: 'rect', x: 0, y: 0, width: 0.5, height: 0.5, radius: 0, feather: 0, invert: false }; });
    const { events } = await draw(masked, 10);
    const back = events.filter((e) => e.on === 'main' && e.op === 'drawImage' && e.src!.startsWith('scratch#'));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ alpha: 1, gco: 'source-over' });
    // the mask is applied to the adjusted copy (destination-in) before it is composited back
    const maskDraw = events.findIndex((e) => e.on === back[0]!.src && e.op === 'drawImage' && e.gco === 'destination-in');
    expect(maskDraw).toBeGreaterThanOrEqual(0);
    expect(maskDraw).toBeLessThan(events.indexOf(back[0]!));
  });
  it('without an adjustment the frame draws exactly as before: no frame copy, no extra composite', async () => {
    const { events } = await draw(base().doc, 10);
    expect(events.some((e) => e.src === 'main-canvas')).toBe(false);
    expect(events.filter((e) => e.on === 'main' && e.op === 'drawImage')).toEqual([]);
  });
});
