/**
 * Stabilisation in the evaluator and the compositor (wave 7; core steady.ts). Evaluate: each picture carries the correction of its
 * OWN source frame (taps, a ramp's picture, the outgoing handle, speed, reverse, a split), after the cover limit, with the reason
 * of a limit; clips without the switch are evaluated exactly as before (no `steady` key). Follow reads a stabilised target where
 * its content is drawn. describeMoment reports it.
 * The drawing checks run the real drawGraph in Node on stand-in canvases that only record the calls (TEST STAND-IN: no pixels;
 * OffscreenCanvas is stubbed). They show the order of the transforms and the own-rectangle clip and mask, not what a browser
 * makes of it; the pixels are proof:stabilise's (S11, S13, S18, S20).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, clipSourceFrames, contentTransform, createProject, expm, limitToCover, SST, steadyPose, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { describeMoment, evaluate, type VideoLayer } from './evaluate.ts';
import { drawGraph, type Ctx2D, type FrameProvider } from './compositor2d.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sg${n++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(600, R), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, provenance };
function shaky(len: number, seed = 3) {
  let x = seed;
  const r = () => { x = (Math.imul(x, 1103515245) + 12345) >>> 0; return ((x >>> 8) % 2001) - 1000; };
  return { dx: Array.from({ length: len }, () => r()), dy: Array.from({ length: len }, () => r()), dr: Array.from({ length: len }, () => r()), dz: Array.from({ length: len }, () => Math.trunc(r() / 4)), st: [SST.start, ...Array<number>(len - 1).fill(SST.ok)] };
}
const clips = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips);
const clipOf = (doc: ProjectDocument, id: string) => clips(doc).find((c) => c.id === id) as MediaClip;
/** One video clip of source 100..189 at timeline 0..89, its file measured on 0..399. stabilised: switched on at strength 50. */
function scene(stabilised = true, extra: OpCall[] = []) {
  let r = tx(createProject({ id: 'prj_sg', name: 'Sg', width: 640, height: 360 }), [{ op: 'import_asset', args: { asset: video } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(100), duration: f(90), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'attach_camera_motion', args: { assetId, from: 0, ...shaky(400), method: 't', params: { algo: 1, input: 'proxy' }, createdAt: 'x' } }], true);
  if (stabilised) r = tx(r.doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: {} } }]);
  if (extra.length) r = tx(r.doc, extra.map((o) => ({ ...o, args: JSON.parse(JSON.stringify(o.args).replaceAll('$clip', clipId)) })));
  return { doc: r.doc, assetId, clipId };
}
const vid = (doc: ProjectDocument, k: number) => evaluate(doc, f(k)).layers.find((l) => l.kind === 'video') as VideoLayer;
/** What evaluate must carry for source frame `idx` of the clip (the core functions, applied by hand). */
function expected(doc: ProjectDocument, clipId: string, idx: number) {
  const c = clipOf(doc, clipId), m = doc.analyses[c.assetId]!.cameraMotion!, zoom = c.stabilise!.zoomPm / 1000;
  const pose = steadyPose(m, idx, c.stabilise!.strength, R), lim = limitToCover(pose, zoom, 360 / (2 * 640));
  return { v: 1, ...lim.pose, zoom, state: pose.state, limited: lim.limited ? 'x' : false };
}

describe('evaluate', () => {
  it('a clip without the switch is evaluated exactly as before: no steady key on any layer', () => {
    const { doc } = scene(false);
    for (const k of [0, 45, 89]) expect('steady' in vid(doc, k)).toBe(false);
  });
  it('each picture carries the correction of its own source frame, after the cover limit; at its own zoom nothing is limited', () => {
    const { doc, clipId } = scene();
    for (const k of [0, 1, 44, 89]) {
      const l = vid(doc, k);
      expect(l.sourceFrameIndex).toBe(100 + k);
      expect(l.steady).toEqual(expected(doc, clipId, 100 + k));
      expect(l.steady!.limited).toBe(false);
    }
  });
  it('speed 2, reverse and a split: the same source frame gets the same correction (source time, ADR-0005)', () => {
    const { doc, clipId } = scene();
    const by = (d: ProjectDocument) => new Map(Array.from({ length: 90 }, (_, k) => vid(d, k)).filter(Boolean).map((l) => [l.sourceFrameIndex, l.steady]));
    const base = by(doc);
    for (const ops of [[{ op: 'set_clip_speed', args: { clipId, speed: 2 } }], [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }], [{ op: 'split_clip', args: { clipId, at: f(40) } }]] as OpCall[][]) {
      const d = tx(doc, ops).doc;
      for (const [idx, st] of by(d)) if (base.has(idx)) expect({ idx, st }).toEqual({ idx, st: base.get(idx) });
    }
  });
  it('a zoom smaller than the clip needs: the cover limit weakens the pose (limited clip), and it still covers', () => {
    const { doc, clipId } = scene(true, [{ op: 'set_clip_stabilise', args: { clipId: '$clip', stabilise: { strength: 100, zoomPm: 1002 } } }]);
    const limited = Array.from({ length: 90 }, (_, k) => vid(doc, k).steady!).filter((s) => s.limited);
    expect(limited.length).toBeGreaterThan(0);
    expect(limited.every((s) => s.limited === 'clip')).toBe(true);
    void clipId;
  });
  it('a velocity ramp shows frames before the clip\'s start with THEIR correction; a limit there says reach', () => {
    let { doc, clipId: a } = scene();
    const assetId = clipOf(doc, a).assetId;
    let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(90), sourceIn: f(300), duration: f(60), withLinkedAudio: false } }]);
    const b = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 12 } }, { op: 'set_transition_options', args: { clipId: b, velocity: 4 } }]);
    r = tx(r.doc, [{ op: 'set_clip_stabilise', args: { clipId: b, stabilise: { strength: 100, zoomPm: 1000 } } }]); // no crop: every shaken frame is limited
    doc = r.doc;
    const g = evaluate(doc, f(90));
    const inn = g.layers.find((l) => l.kind === 'video' && l.clipId === b) as VideoLayer, out = g.layers.find((l) => l.kind === 'video' && l.clipId === a) as VideoLayer;
    const fb = clipSourceFrames(doc, clipOf(doc, b));
    expect(inn.sourceFrameIndex).toBeLessThan(fb.first); // the ramp reads before the clip's start
    expect(inn.steady!.limited).toBe('reach');
    expect(out.sourceFrameIndex).toBe(190); // the outgoing clip plays on into its handle
    expect({ ...out.steady, limited: out.steady!.limited ? 'x' : false }).toEqual(expected(doc, a, 190));
  });
  it('time taps (echo) carry the correction of their own source frame', () => {
    const { doc, clipId } = scene(true, [{ op: 'add_effect', args: { clipId: '$clip', type: 'time.echo' } }]);
    const l = vid(doc, 60);
    expect(l.time?.taps.length).toBeGreaterThan(1);
    for (const t of l.time!.taps) if (t.layer.kind === 'video') expect(t.layer.steady).toEqual(expected(doc, clipId, t.layer.sourceFrameIndex));
    const d = describeMoment(doc, f(60)).layers.find((x) => x.kind === 'video') as { steady: unknown; time: { taps: { steady: unknown; sourceFrameIndex: number }[] } };
    expect(d.steady).toMatchObject({ state: 'ok', limited: false, zoom: clipOf(doc, clipId).stabilise!.zoomPm / 1000 });
    expect(d.time.taps.every((t) => t.steady)).toBe(true);
  });
  it('a follower reads a stabilised target where its content is drawn (contentTransform)', () => {
    let { doc, clipId, assetId } = scene();
    let r = tx(doc, [{ op: 'create_motion_track', args: { assetId, kind: 'point', frame: 100, x: 4000, y: 6000 } }]);
    const motionTrackId = r.results[0]!.output!.motionTrackId as string;
    const targetTrackId = r.doc.sequences[r.doc.mainSequenceId]!.tracks.find((t) => t.clips.some((c) => c.id === clipId))!.id;
    r = tx(r.doc, [{ op: 'add_text', args: { text: 'Hi', start: f(0), duration: f(90) } }]);
    const textId = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_clip_follow', args: { clipId: textId, follow: { motionTrackId, targetTrackId, scale: false, smooth: 0 } } }]);
    doc = r.doc;
    const g = evaluate(doc, f(0));
    const target = g.layers.find((l) => l.kind === 'video') as VideoLayer, title = g.layers.find((l) => l.kind === 'text')!;
    const ct = contentTransform(target.transform, target.steady!, target.steady!.zoom, 640, 360, g.fit, 640, 360);
    // the tracked point (0.4, 0.6 of the picture) placed with the content's placement
    const a = (ct.rotation * Math.PI) / 180, lx = (0.4 - 0.5) * 640 * ct.scale, ly = (0.6 - 0.5) * 360 * ct.scale;
    expect(title.transform.x).toBeCloseTo((320 + ct.x * 640 + Math.cos(a) * lx - Math.sin(a) * ly - 320) / 640, 12);
    expect(title.transform.y).toBeCloseTo((180 + ct.y * 360 + Math.sin(a) * lx + Math.cos(a) * ly - 180) / 360, 12);
    // without the switch the follower is placed on the own transform, as before
    const off = tx(doc, [{ op: 'set_clip_stabilise', args: { clipId, stabilise: null } }]).doc;
    expect(evaluate(off, f(0)).layers.find((l) => l.kind === 'text')!.transform.x).toBeCloseTo((0.4 - 0.5), 12);
  });
});

// ---------- the compositor (recording stand-ins) ----------
interface Ev { on: string; op: string; args: unknown[]; gco: unknown }
const log: Ev[] = [];
let canvasNo = 0;
function recorder(name: string, canvas: object): Ctx2D {
  const state: Record<string, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', filter: 'none', direction: 'ltr' };
  const stack: Record<string, unknown>[] = [];
  const label = (x: unknown) => (x && typeof x === 'object' && 'label' in x ? String((x as { label: string }).label) : 'other');
  const rec = (op: string) => (...args: unknown[]) => { log.push({ on: name, op, args: op === 'drawImage' ? [label(args[0])] : args, gco: state.globalCompositeOperation }); };
  const api: Record<string, unknown> = {
    canvas,
    save: () => { stack.push({ ...state }); log.push({ on: name, op: 'save', args: [], gco: state.globalCompositeOperation }); },
    restore: () => { Object.assign(state, stack.pop()); log.push({ on: name, op: 'restore', args: [], gco: state.globalCompositeOperation }); },
    drawImage: rec('drawImage'), translate: rec('translate'), rotate: rec('rotate'), scale: rec('scale'), rect: rec('rect'), clip: rec('clip'), beginPath: rec('beginPath'),
    roundRect: rec('roundRect'), fill: rec('fill'), fillRect: rec('fillRect'), setTransform: rec('setTransform'), ellipse: rec('ellipse'),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }), createImageData: () => ({ data: new Uint8ClampedArray(4) }), putImageData: () => {},
    measureText: () => ({ width: 10 }), getTransform: () => ({ a: 1, b: 0 }),
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
async function draw(doc: ProjectDocument, k: number) {
  log.length = 0;
  const frames: FrameProvider = async (l) => ({ draw: (ctx, ...rect) => { ctx.drawImage({ label: `picture:${l.kind}` } as unknown as CanvasImageSource, ...(rect as [number, number, number, number])); } });
  const result = await drawGraph(recorder('main', { label: 'main-canvas' }), evaluate(doc, f(k)), frames);
  expect(result.missing).toEqual([]);
  return [...log];
}
/** The calls on one canvas from the save before a picture's draw up to it. */
const placing = (events: Ev[], canvas: string) => {
  const at = events.findIndex((e) => e.on === canvas && e.op === 'drawImage' && e.args[0] === 'picture:video');
  let from = at; while (from > 0 && !(events[from]!.on === canvas && events[from]!.op === 'save')) from--;
  return events.slice(from, at + 1).filter((e) => e.on === canvas).map((e) => [e.op, ...e.args]);
};

describe('the compositor', () => {
  it('without the switch: the picture is drawn straight with its own transform, no clip (as before)', async () => {
    const ev = await draw(scene(false).doc, 10);
    expect(placing(ev, 'main')).toEqual([['save'], ['translate', 320, 180], ['rotate', 0], ['scale', 1, 1], ['drawImage', 'picture:video']]);
  });
  it('stabilised: own transform → clip to the own rectangle → translate(zoom·t·w) · rotate(r) · scale(zoom·e^l) → draw', async () => {
    const { doc } = scene();
    const s = vid(doc, 10).steady!;
    const ev = await draw(doc, 10);
    expect(placing(ev, 'main')).toEqual([
      ['save'], ['translate', 320, 180], ['rotate', 0], ['scale', 1, 1],
      ['beginPath'], ['rect', -320, -180, 640, 360], ['clip'],
      ['translate', s.zoom * s.tx * 640, s.zoom * s.ty * 640], ['rotate', s.r], ['scale', s.zoom * expm(s.l), s.zoom * expm(s.l)],
      ['drawImage', 'picture:video'],
    ]);
  });
  it('a privacy region on a stabilised picture is drawn with the content\'s box, then the buffer is cut to the own rectangle (destination-in)', async () => {
    const { doc } = scene(true, [{ op: 'set_redact_region', args: { clipId: '$clip', region: { x: 0.45, y: 0.4, width: 0.3, height: 0.3 } } }]);
    const l = vid(doc, 10), ct = contentTransform(l.transform, l.steady!, l.steady!.zoom, 640, 360, 'contain', 640, 360);
    const ev = await draw(doc, 10);
    const buf = ev.find((e) => e.op === 'drawImage' && e.args[0] === 'picture:video')!.on;
    expect(buf).toMatch(/^scratch#/);
    // the region's shape is drawn in the content's placement
    expect(ev.some((e) => e.op === 'translate' && e.on !== buf && e.on !== 'main' && Math.abs((e.args[0] as number) - (320 + ct.x * 640)) < 1e-9 && Math.abs((e.args[1] as number) - (180 + ct.y * 360)) < 1e-9)).toBe(true);
    const onBuf = ev.filter((e) => e.on === buf && e.op === 'drawImage');
    expect(onBuf.map((e) => e.gco)).toEqual(['source-over', 'destination-out', 'lighter', 'destination-in']); // picture, region (erase, add), own rectangle
    // the own rectangle: the mask slot as drawn since it was last taken (scratch resets it with setTransform)
    const maskCanvas = onBuf.at(-1)!.args[0] as string, end = ev.indexOf(onBuf.at(-1)!);
    const mine = ev.slice(0, end).filter((e) => e.on === maskCanvas);
    const since = mine.slice(mine.map((e) => e.op).lastIndexOf('setTransform'));
    expect(since.filter((e) => e.op === 'translate' || e.op === 'roundRect' || e.op === 'rotate').map((e) => [e.op, ...e.args])).toEqual([['translate', 320, 180], ['rotate', 0], ['roundRect', -320, -180, 640, 360, 0]]);
  });
  it('a privacy region on a picture without the switch takes no new step', async () => {
    const { doc } = scene(false, [{ op: 'set_redact_region', args: { clipId: '$clip', region: { x: 0.45, y: 0.4, width: 0.3, height: 0.3 } } }]);
    const ev = await draw(doc, 10);
    const buf = ev.find((e) => e.op === 'drawImage' && e.args[0] === 'picture:video')!.on;
    expect(ev.filter((e) => e.on === buf && e.op === 'drawImage').map((e) => e.gco)).toEqual(['source-over', 'destination-out', 'lighter']);
  });
});
