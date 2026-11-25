/**
 * Browser side of the opacity MEASUREMENTS (opacity-measure.ts): bundled by esbuild into a script the evals page loads into
 * headless Chromium (nothing under apps/ is touched). It draws with the product's own evaluate + drawGraph in either quality
 * and returns packed RGB frames (base64) plus, for the transitions, the pictures the references are mixed from, made with the
 * same canvas operations as the kernels (scaled about the frame centre, the product's own blur recipe).
 * Diagnostics only: nothing is stored.
 */
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate, unitPose, type FrameProvider } from '@pulseframe/engine';
import { scratch } from '../../engine/src/look.ts';
import { blurRadius, punchScale } from '../../engine/src/canvasTransitions.ts';
import { MW as W, MH as H, picA, picB, picF, TITLE_RGB, type Px } from './opacity-measure-patterns.ts';

const R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R);
let seq = 0;
const step = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => {
  const r = applyTransaction(doc, ops, { idSeed: `m${seq++}_`, actor: 'measure', allowInternal });
  return { doc: r.doc, out: r.results.map((x) => x.output ?? {}) as Record<string, any>[] };
};
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'measure' };
const imageAsset = (name: string, h: string) => ({ kind: 'image' as const, name, contentHash: `sha256:${h.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: W, height: H, codec: 'png', hasAlpha: false }, provenance });
const videoAsset = { kind: 'video' as const, name: 'm.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1), video: { width: W, height: H, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance };

const bitmaps = new Map<Px, OffscreenCanvas>();
const canvasOf = (p: Px) => {
  let c = bitmaps.get(p);
  if (!c) { c = new OffscreenCanvas(W, H); const id = new ImageData(W, H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, v = p(x, y); id.data[i] = v[0]; id.data[i + 1] = v[1]; id.data[i + 2] = v[2]; id.data[i + 3] = 255; } c.getContext('2d')!.putImageData(id, 0, 0); if (bitmaps.size > 40) bitmaps.clear(); bitmaps.set(p, c); }
  return c;
};
const assets = new Map<string, Px | 'video'>();
const provider: FrameProvider = async (l) => {
  const a = assets.get(l.assetId);
  if (!a) return null;
  const px = a === 'video' ? picF((l as { sourceFrameIndex: number }).sourceFrameIndex) : a;
  const c = canvasOf(px);
  return { draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(c, dx, dy, dw, dh) };
};
const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false, colorSpace: 'srgb' })!;
const b64 = (d: Uint8ClampedArray | Uint8Array, stride: number) => {
  const n = d.length / stride, out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) { out[i * 3] = d[i * stride]!; out[i * 3 + 1] = d[i * stride + 1]!; out[i * 3 + 2] = d[i * stride + 2]!; }
  let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
};
const read = (c: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) => b64(c.getImageData(0, 0, W, H).data, 4);
async function draw(doc: ProjectDocument, frame: number, quality: 'draft' | 'full') {
  const g = evaluate(doc, f(frame));
  const r = await drawGraph(ctx, g, provider, { quality });
  if (r.missing.length || r.unavailableEffects.length) throw new Error(`frame ${frame}: could not be drawn ${JSON.stringify(r)}`);
  return { g, rgb: read(ctx) };
}
/** Project with two pictures (A, B) as image assets and optionally the video asset. */
function base(video = false) {
  const s0 = step(createProject({ id: 'prj_measure', name: 'Measure', width: W, height: H, frameRate: R }), [{ op: 'import_asset', args: { asset: imageAsset('m-a', 'c') } }, { op: 'import_asset', args: { asset: imageAsset('m-b', 'd') } }, ...(video ? [{ op: 'import_asset', args: { asset: videoAsset } } as OpCall] : [])], true);
  const [a, b] = [s0.out[0]!.assetId as string, s0.out[1]!.assetId as string];
  assets.set(a, picA); assets.set(b, picB);
  const v = video ? (s0.out[2]!.assetId as string) : null;
  if (v) assets.set(v, 'video');
  return { doc: s0.doc, a, b, v, v1: s0.doc.sequences[s0.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id };
}
const clip = (assetId: string, trackId: string, start: number, dur: number): OpCall => ({ op: 'add_clip', args: { assetId, trackId, start: f(start), duration: f(dur), withLinkedAudio: false } });

const scenes = new Map<string, { doc: ProjectDocument; clipId: string }>();
function titleScene(stroke: boolean, anim: boolean) {
  const key = `title:${stroke}:${anim}`;
  let sc = scenes.get(key);
  if (!sc) {
    const p = base();
    const s1 = step(p.doc, [clip(p.a, p.v1, 0, 90)]);
    const hex = '#' + TITLE_RGB.map((c) => c.toString(16).padStart(2, '0')).join('');
    const s2 = step(s1.doc, [{ op: 'add_text', args: { text: 'PULSE', start: f(0), duration: f(90), style: { fontFamily: 'sans-serif', fontWeight: 800, sizeFrac: 0.42, color: hex, background: null, stroke: stroke ? '#000000' : null, strokeFrac: stroke ? 0.05 : 0 }, ...(anim ? { animation: { by: 'line', in: 'fade', out: null, loop: null, inFrames: 20 } } : {}) } }]);
    sc = { doc: s2.doc, clipId: s2.out[0]!.clipId as string };
    scenes.set(key, sc);
  }
  return sc;
}
function tapScene(p: { count: number; delay: number; decay: number; mode: string }) {
  const key = `taps:${JSON.stringify(p)}`;
  let sc = scenes.get(key);
  if (!sc) {
    const b = base(true);
    const s1 = step(b.doc, [clip(b.a, b.v1, 0, 90), { op: 'add_track', args: { kind: 'video' } }]);
    const s2 = step(s1.doc, [clip(b.v!, s1.out[1]!.trackId as string, 0, 90)]);
    const clipId = s2.out[0]!.clipId as string;
    sc = { doc: step(s2.doc, [{ op: 'add_effect', args: { clipId, type: 'time.echo', params: p } }]).doc, clipId };
    scenes.set(key, sc);
  }
  return sc;
}
function transScene(type: string, reveal: boolean) {
  const key = `tr:${type}:${reveal}`;
  let sc = scenes.get(key);
  if (!sc) {
    const p = base();
    const s1 = step(p.doc, [clip(p.a, p.v1, 0, reveal ? 60 : 30), ...(reveal ? [{ op: 'add_track', args: { kind: 'video' } } as OpCall] : [])]);
    const s2 = step(s1.doc, [clip(p.b, reveal ? (s1.out[1]!.trackId as string) : p.v1, 30, 30)]);
    const clipId = s2.out[0]!.clipId as string;
    sc = { doc: step(s2.doc, [{ op: 'set_transition', args: { clipId, type, frames: 21 } }]).doc, clipId };
    scenes.set(key, sc);
  }
  return sc;
}
const withOpacity = (sc: { doc: ProjectDocument; clipId: string }, o: number) => step(sc.doc, [{ op: 'set_clip_transform', args: { clipId: sc.clipId, transform: { opacity: o } } }]).doc;

/** The product's own blur recipe for one side of the blur dissolve (canvasTransitions.ts blurDissolve.soft). */
function soft(src: OffscreenCanvas, r: number, slot: number) {
  const b = scratch(slot, W, H);
  b.ctx.drawImage(src, 0, 0);
  if (r >= 0.5) { b.ctx.filter = `blur(${r.toFixed(3)}px)`; b.ctx.drawImage(src, 0, 0); b.ctx.filter = 'none'; }
  return b;
}
/** The picture scaled by s about the frame centre (canvasTransitions.ts drawScaled; the zoom's translate-scale-translate is the same matrix). */
function scaled(src: OffscreenCanvas, s: number, slot: number) {
  const b = scratch(slot, W, H);
  b.ctx.setTransform(s, 0, 0, s, (W / 2) * (1 - s), (H / 2) * (1 - s));
  b.ctx.drawImage(src, 0, 0);
  b.ctx.setTransform(1, 0, 0, 1, 0, 0);
  return b;
}

const api = {
  /** A title over picture A: opacity o, optionally mid-way through a 20-frame fade-in (frame `animFrame`), with or without a stroke. */
  async title(o: number, animFrame: number | null, stroke: boolean, quality: 'draft' | 'full') {
    const sc = titleScene(stroke, animFrame !== null);
    const r = await draw(withOpacity(sc, o), animFrame ?? 45, quality);
    const tl = r.g.layers.find((l) => l.kind === 'text');
    const u = tl && tl.kind === 'text' && tl.animation ? unitPose(tl.animation, 0, 1, false).alpha : 1;
    return { rgb: r.rgb, u };
  },
  /** An echo (time.echo) on a video clip above picture A, at frame 20; returns the taps' source frames and integer weights. */
  async taps(p: { count: number; delay: number; decay: number; mode: string }, o: number, quality: 'draft' | 'full') {
    const sc = tapScene(p);
    const r = await draw(withOpacity(sc, o), 20, quality);
    const l = r.g.layers.find((x) => x.kind !== 'caption' && x.kind !== 'adjust' && x.time);
    const taps = l && l.kind !== 'caption' && l.kind !== 'adjust' && l.time ? l.time.taps.map((t) => ({ frame: t.layer.kind === 'video' ? t.layer.sourceFrameIndex : -1, weight: t.weight })) : [];
    return { rgb: r.rgb, taps };
  },
  /** Frame F of a 21-frame transition from picture A to picture B (two clips, or B revealed over A on the track below). */
  async transition(type: string, reveal: boolean, F: number, quality: 'draft' | 'full', parts: boolean) {
    const sc = transScene(type, reveal);
    const r = await draw(sc.doc, F, quality);
    const inc = r.g.layers.find((l) => l.kind !== 'caption' && l.kind !== 'adjust' && l.transition?.role === 'in');
    if (!inc || inc.kind === 'caption' || inc.kind === 'adjust' || !inc.transition) throw new Error(`${type}: no incoming layer at ${F}`);
    const p = inc.transition.progress;
    const out: { rgb: string; progress: number; parts?: Record<string, string> } = { rgb: r.rgb, progress: p };
    if (parts) {
      const A = canvasOf(picA), B = canvasOf(picB), P: Record<string, string> = {};
      const rd = (b: { ctx: OffscreenCanvasRenderingContext2D }) => read(b.ctx);
      if (type === 'zoom') P.scaledB = rd(scaled(B, 1.3 - 0.3 * p, 20));
      else if (type === 'blur-dissolve') { const rad = blurRadius(p, H); P.softA = rd(soft(A, rad, 20)); P.softB = rd(soft(B, rad, 21)); }
      else if (type === 'punch-in') {
        const first = p < 0.5, u = first ? 2 * p : 2 * (1 - p), s = punchScale(p, 1), side = first ? A : B;
        for (let j = 0; j < 4; j++) P[`copy${j}`] = rd(scaled(side, s * (1 + 0.025 * j * u * u), 20 + j));
      }
      out.parts = P;
    }
    return out;
  },
};
(window as unknown as { __pfMeasure: typeof api }).__pfMeasure = api;
document.body.dataset.ready = '1';
export type MeasurePage = typeof api;
