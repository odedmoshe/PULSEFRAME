/**
 * A picture clip's opacity in the compositor. Below 1 it goes into the alpha of a scratch buffer the picture was placed in
 * opaque (one destination-in fill, fadeBuf), and that buffer is composited at full alpha; it is never the globalAlpha of a
 * draw onto the frame. In Chromium's software canvas such a draw truncates: the frame came out on average half a level low
 * and some bytes 2 off the exact mix (conformance:opacity measures it on real stills, all 256×256 byte pairs).
 *
 * The drawing checks run the real drawGraph in Node on stand-in canvases that only record the calls (TEST STAND-IN: no
 * pixels; OffscreenCanvas is stubbed for the scratch buffers). They show on which canvas, with which globalAlpha and composite
 * operation each picture is drawn, not what a browser makes of it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from './evaluate.ts';
import { drawGraph, placedArea, type Ctx2D, type DrawOptions, type FrameProvider } from './compositor2d.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `op${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-24T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance };
const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'6'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance };

/** A video on V1 and a still picture on V2 above it (0–90); optionally a title on top. */
function scene(top: { opacity?: number; blend?: string; scale?: number; x?: number; rotation?: number; transition?: string; strobe?: boolean }, title?: { opacity: number }) {
  let r = tx(createProject({ id: 'prj_op', name: 'Op', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  const videoId = r.results[0]!.output!.assetId as string, stillId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: videoId, start: f(0), duration: f(90), withLinkedAudio: false } }]);
  r = tx(r.doc, [{ op: 'add_track', args: { kind: 'video' } }]);
  const trackId = r.results[0]!.output!.trackId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: stillId, trackId, start: f(0), duration: f(90) } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  if (top.opacity !== undefined || top.scale !== undefined) r = tx(r.doc, [{ op: 'set_clip_transform', args: { clipId, transform: { ...(top.opacity !== undefined ? { opacity: top.opacity } : {}), ...(top.scale !== undefined ? { scale: top.scale } : {}), ...(top.x !== undefined ? { x: top.x } : {}), ...(top.rotation !== undefined ? { rotation: top.rotation } : {}) } } }]);
  if (top.strobe) r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'light.strobe' } }]);
  if (top.blend) r = tx(r.doc, [{ op: 'set_clip_blend', args: { clipId, mode: top.blend } }]);
  if (title) {
    r = tx(r.doc, [{ op: 'add_text', args: { text: 'Title', start: f(0), duration: f(90) } }]);
    r = tx(r.doc, [{ op: 'set_clip_transform', args: { clipId: r.results[0]!.output!.clipId as string, transform: { opacity: title.opacity } } }]);
  }
  return r.doc;
}

// ---------- recording stand-ins ----------
interface Ev { on: string; op: string; alpha?: unknown; gco?: unknown; src?: string; text?: string; rect?: number[] }
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
    drawImage: (src: unknown) => log.push({ on: name, op: 'drawImage', src: nameOf(src), alpha: state.globalAlpha, gco: state.globalCompositeOperation }),
    fillText: (text: string) => log.push({ on: name, op: 'fillText', text, alpha: state.globalAlpha, gco: state.globalCompositeOperation }),
    fillRect: (...rect: number[]) => log.push({ on: name, op: 'fillRect', alpha: state.globalAlpha, gco: state.globalCompositeOperation, rect }),
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

/** Draw frame 10; each picture is drawn as a drawImage of a source labelled by its kind ('picture:video', 'picture:image'). */
async function draw(doc: ProjectDocument, opts?: DrawOptions, F = 10) {
  log.length = 0;
  const frames: FrameProvider = async (l) => ({ draw: (ctx) => ctx.drawImage({ label: `picture:${l.kind}` } as unknown as CanvasImageSource, 0, 0) });
  const main = recorder('main', { label: 'main-canvas' });
  const result = await drawGraph(main, evaluate(doc, f(F)), frames, opts);
  if (!opts) expect(result.missing).toEqual([]);
  return Object.assign([...log], { result });
}
/** The destination-in fills of a drawing (without the rectangle they cover). */
const fades = (events: Ev[]) => events.filter((e) => e.op === 'fillRect' && e.gco === 'destination-in').map(({ rect: _r, ...e }) => e);
const fadeRects = (events: Ev[]) => events.filter((e) => e.op === 'fillRect' && e.gco === 'destination-in').map((e) => e.rect);

describe('a picture clip\'s opacity goes into a scratch buffer\'s alpha, not into a draw onto the frame', () => {
  it('opacity 0.5, normal blend: placed opaque in a scratch buffer, faded there by one destination-in fill at 0.5, composited at full alpha', async () => {
    const events = await draw(scene({ opacity: 0.5 }));
    const placed = events.find((e) => e.src === 'picture:image')!;
    expect(placed.on).toMatch(/^scratch#/);
    expect(placed).toMatchObject({ alpha: 1, gco: 'source-over' });
    expect(fades(events)).toEqual([{ on: placed.on, op: 'fillRect', alpha: 0.5, gco: 'destination-in' }]);
    expect(fadeRects(events)).toEqual([[0, 0, 640, 360]]); // a picture that fills the frame: the whole buffer
    const back = events.find((e) => e.on === 'main' && e.op === 'drawImage' && e.src === placed.on)!;
    expect(back).toMatchObject({ alpha: 1, gco: 'source-over' });
    expect(events.indexOf(placed)).toBeLessThan(events.findIndex((e) => e.op === 'fillRect' && e.gco === 'destination-in'));
    expect(events.findIndex((e) => e.op === 'fillRect' && e.gco === 'destination-in')).toBeLessThan(events.indexOf(back));
    // nothing is drawn onto the frame with an alpha below 1
    expect(events.filter((e) => e.on === 'main' && e.op === 'drawImage' && e.alpha !== 1)).toEqual([]);
  });
  it('the same with a blend mode (multiply): faded in the buffer, composited at full alpha with the blend', async () => {
    const events = await draw(scene({ opacity: 0.3, blend: 'multiply' }));
    const placed = events.find((e) => e.src === 'picture:image')!;
    expect(placed).toMatchObject({ alpha: 1, gco: 'source-over' });
    expect(fades(events)).toEqual([{ on: placed.on, op: 'fillRect', alpha: 0.3, gco: 'destination-in' }]);
    expect(events.find((e) => e.on === 'main' && e.src === placed.on)).toMatchObject({ alpha: 1, gco: 'multiply' });
  });
  it('full opacity draws as before: the picture straight onto the frame, no scratch buffer, no fade', async () => {
    const events = await draw(scene({}));
    expect(events.filter((e) => e.op === 'drawImage')).toEqual([
      { on: 'main', op: 'drawImage', src: 'picture:video', alpha: 1, gco: 'source-over' },
      { on: 'main', op: 'drawImage', src: 'picture:image', alpha: 1, gco: 'source-over' },
    ]);
    expect(fades(events)).toEqual([]);
  });
  it('a title keeps its globalAlpha (its stroke shows through its fill, which fading the whole would change)', async () => {
    const events = await draw(scene({}, { opacity: 0.5 }));
    expect(events.filter((e) => e.op === 'fillText')).toEqual([{ on: 'main', op: 'fillText', text: 'Title', alpha: 0.5, gco: 'source-over' }]);
    expect(fades(events)).toEqual([]);
  });
});

describe('the faded picture\'s fill covers only the pixels the picture can touch (full quality)', () => {
  it('the bounds of the placed box, two pixels wider, within the frame: scaled, moved and rotated pictures', async () => {
    const half = await draw(scene({ opacity: 0.5, scale: 0.5 }));
    expect(fadeRects(half)).toEqual([[158, 88, 324, 184]]); // 320×180 in the middle, ±2
    const moved = await draw(scene({ opacity: 0.5, scale: 0.5, x: 0.4 }));
    expect(fadeRects(moved)).toEqual([[414, 88, 226, 184]]); // the right edge clipped at the frame
    const turned = await draw(scene({ opacity: 0.5, scale: 0.5, rotation: 90 }));
    expect(fadeRects(turned)).toEqual([[228, 18, 184, 324]]); // 180×320 on its side
    expect(fadeRects(await draw(scene({ opacity: 0.5, scale: 0.5 }), { fadeArea: 'frame' }))).toEqual([[0, 0, 640, 360]]); // diagnostics: the whole buffer
  });
  it('placedArea is undefined when the bounds are the whole frame', () => {
    const g = evaluate(scene({ opacity: 0.5, scale: 1.2 }), f(10));
    const top = g.layers.filter((l) => l.kind === 'image')[0]!;
    expect(placedArea(g, top as never)).toBeUndefined();
  });
});

describe('draft quality (playback): no fill, the picture copied in with its opacity; nothing else differs', () => {
  it('a faded picture is copied into the empty buffer with globalAlpha = opacity, and composited at full alpha', async () => {
    const events = await draw(scene({ opacity: 0.4 }), { quality: 'draft' });
    const placed = events.find((e) => e.src === 'picture:image')!;
    expect(placed.on).toMatch(/^scratch#/);
    expect(placed).toMatchObject({ alpha: 0.4, gco: 'copy' });
    expect(fades(events)).toEqual([]);
    expect(events.find((e) => e.on === 'main' && e.src === placed.on)).toMatchObject({ alpha: 1, gco: 'source-over' });
  });
  it('a faded picture with a blend mode keeps the exact fill in draft (the copied form had a mean error up to +0.28 with blends)', async () => {
    const strip = (e: Ev[]) => e.map(({ on, ...x }) => ({ ...x, on: on.startsWith('scratch#') ? 'scratch' : on }));
    const doc = scene({ opacity: 0.4, blend: 'multiply' });
    const d = await draw(doc, { quality: 'draft' });
    expect(fades(d)).toHaveLength(1);
    expect(strip(d)).toEqual(strip(await draw(doc)));
  });
  it('full opacity and titles draw the same in both qualities', async () => {
    const strip = (e: Ev[]) => e.map(({ on, ...x }) => ({ ...x, on: on.startsWith('scratch#') ? 'scratch' : on }));
    for (const doc of [scene({}), scene({}, { opacity: 0.5 }), scene({ blend: 'multiply' })]) expect(strip(await draw(doc, { quality: 'draft' }))).toEqual(strip(await draw(doc)));
  });
  it('what the flash guard is told (pictures missing, effects not drawn) is the same in both: it reads no pixels (layerLights works from the graph)', async () => {
    for (const doc of [scene({ opacity: 0.5, strobe: true }), scene({ opacity: 0.3, blend: 'screen', strobe: true })]) {
      const full = await draw(doc, {}), draftR = await draw(doc, { quality: 'draft' });
      expect(draftR.result).toEqual(full.result);
      expect(full.result.unavailableEffects).toEqual(['light.strobe']); // no GPU in Node: reported the same way by both
    }
  });
});
