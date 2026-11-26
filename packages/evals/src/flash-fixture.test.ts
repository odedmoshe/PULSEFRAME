/**
 * The audiences proof's master fixture (builder W2, check 15), rebuilt at unit level, and what the export's flash check
 * reads on it. Reported: "14 flashes a second over 0.133–5.8 s for one strobe at rate 3 plus a flash transition".
 *
 * The document is made with the real ops (a 320 × 180, 30 fps barcode video on V1 in two clips 15–90 and 90–165, a 10-frame
 * `flash` transition at 90, an adjustment clip 15–165 with a strobe at rate 3 and full amount); every frame goes through
 * the real `evaluate`, the real light plan and the strobe's real GPU parameters. The pixels are made in JS the way the two
 * GPU passes make them (TEST STAND-IN for the WebGPU compositor: the `flash` kernel of gpu.ts — a crossfade at 0.4–0.6 plus
 * sin²(πp) of white — and the strobe's mix toward white, both on 8-bit values; the title is left out). The barcode
 * picture is the fixture's own `barcodeFrame`. The analyser is the export's FlashAnalyser.
 *
 * What it shows: the "14" was the busiest single cell (the barcode strip, whose low bits change every frame), which on its
 * own covers too little of the frame to fail. The rate over the area that fails is reported apart.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, FlashAnalyser, flashCells, GPU_EFFECTS, type FlashReport } from '@pulseframe/engine';
import { barcodeFrame } from '@pulseframe/fixtures';

const W = 320, H = 180;
type Rate = { num: number; den: number };
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ff${seed++}_`, actor: 'test', allowInternal });
const provenance = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };

export interface FixtureOptions { strobe: boolean; transition: boolean; rate?: Rate; /** frames of each clip (75 in the proof) */ clip?: number; transitionType?: string }
/** The proof's timeline at `rate` (frame numbers as in the proof at 30 fps: clips from 15 for 75 frames each, the adjustment over both). */
export function fixtureDoc(o: FixtureOptions): ProjectDocument {
  const rate = o.rate ?? { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, rate), n = o.clip ?? 75;
  const video = { kind: 'video' as const, name: 'camera.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(600, 1), video: { width: W, height: H, frameRate: rate, codec: 'h264', rotation: 0, frameCount: 100_000 }, provenance };
  let r = tx(createProject({ id: 'prj_ff', name: 'F', width: W, height: H, frameRate: rate }), [{ op: 'import_asset', args: { asset: video } }], true);
  const vid = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(15), sourceIn: f(15), duration: f(n), withLinkedAudio: false } }]);
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: vid, start: f(15 + n), sourceIn: f(15 + n), duration: f(n), withLinkedAudio: false } }]);
  const b = r.results[0]!.output!.clipId as string;
  if (o.transition) r = tx(r.doc, [{ op: 'set_transition', args: { clipId: b, type: o.transitionType ?? 'flash', frames: 10 } }]);
  if (o.strobe) r = tx(r.doc, [{ op: 'add_adjustment', args: { span: { start: f(15), duration: f(2 * n) }, effects: [{ type: 'light.strobe', params: { rate: 3, amount: 1 } }] } }]);
  return r.doc;
}
export type Picture = 'barcode' | 'grey';
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** One frame as RGBA: the picture of the video layer(s), the transition kernel, then the adjustment's strobe over all of it. */
export function frameOf(doc: ProjectDocument, i: number, picture: Picture): { rgba: Uint8ClampedArray; strobe: number; transition: number } {
  const rate = doc.settings.frameRate, g = evaluate(doc, T.frameTime(i, rate));
  const fpsRounded = Math.round(rate.num / rate.den);
  const pic = (src: number) => { const out = new Float32Array(W * H * 3); if (picture === 'barcode') { const b = barcodeFrame(src, W, H, fpsRounded); for (let k = 0; k < out.length; k++) out[k] = b[k]! / 255; } else out.fill(0.35); return out; };
  type V = { kind: string; sourceFrameIndex: number; transition?: { type: string; role: 'in' | 'out'; progress: number } };
  const vids = g.layers.filter((l) => l.kind === 'video') as unknown as V[];
  const inL = vids.find((l) => l.transition?.role === 'in') ?? vids[vids.length - 1];
  let base: Float32Array | null = null, w = 0, strobe = 0;
  if (inL) {
    base = pic(inL.sourceFrameIndex);
    const tr = inL.transition;
    if (tr) {
      const outL = vids.find((l) => l.transition?.role === 'out'), o = outL ? pic(outL.sourceFrameIndex) : base, p = tr.progress;
      if (tr.type === 'flash') { w = Math.sin(p * Math.PI) ** 2; const m = smooth(0.4, 0.6, p); for (let k = 0; k < base.length; k++) base[k] = Math.min(1, o[k]! * (1 - m) + base[k]! * m + w); }
      else throw new Error(`no stand-in for transition ${tr.type}`);
    }
  }
  for (const l of g.layers) if (l.kind === 'adjust') for (const fx of l.effects ?? []) if (fx.type === 'light.strobe') strobe = Math.max(strobe, GPU_EFFECTS['light.strobe']!.params(fx.params, { width: W, height: H, seconds: T.toSeconds(g.time), beat: null })[3]!);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) { for (let c = 0; c < 3; c++) { const v = base ? base[p * 3 + c]! : 0; rgba[p * 4 + c] = Math.round(255 * (v * (1 - strobe) + strobe)); } rgba[p * 4 + 3] = 255; }
  return { rgba, strobe, transition: w };
}
/** The flash check over the first `frames` frames (the proof's export: 180 frames at 30 fps). */
export function check(doc: ProjectDocument, picture: Picture, frames = 180): FlashReport & { peak: { general: number; red: number } } {
  const fps = doc.settings.frameRate.num / doc.settings.frameRate.den, a = new FlashAnalyser(fps);
  for (let i = 0; i < frames; i++) a.push(flashCells(frameOf(doc, i, picture).rgba, W, H));
  return { ...a.report(), peak: a.peak() };
}
const view = (r: FlashReport) => ({ verdict: r.verdict, ranges: r.ranges.map((x) => ({ from: x.from, to: x.to, kind: x.kind, area: x.area })) });

describe('the audiences-proof flash fixture: what the export check counts', () => {
  // verdicts and ranges (frames, inclusive) as the check gave them before the rate over the area was reported; they must not move
  const cases = [
    { name: 'barcode + strobe + flash transition (the proof)', o: { strobe: true, transition: true }, pic: 'barcode', verdict: 'fail', ranges: [{ from: 4, to: 173, kind: 'general', area: 0.993 }], area: 5, busiest: 14, areaPeak: 5 },
    { name: 'barcode alone', o: { strobe: false, transition: false }, pic: 'barcode', verdict: 'pass', ranges: [], areaPeak: 2.5 },
    { name: 'barcode + strobe', o: { strobe: true, transition: false }, pic: 'barcode', verdict: 'fail', ranges: [{ from: 4, to: 173, kind: 'general', area: 0.299 }], area: 5, busiest: 14, areaPeak: 5 },
    { name: 'barcode + flash transition', o: { strobe: false, transition: true }, pic: 'barcode', verdict: 'pass', ranges: [], areaPeak: 2.5 },
    { name: 'flat grey + strobe + flash transition', o: { strobe: true, transition: true }, pic: 'grey', verdict: 'fail', ranges: [{ from: 64, to: 125, kind: 'general', area: 1 }], area: 4, busiest: 4, areaPeak: 4 },
    { name: 'flat grey + strobe', o: { strobe: true, transition: false }, pic: 'grey', verdict: 'pass', ranges: [], areaPeak: 3 },
  ] as const;
  for (const c of cases) {
    it(c.name, () => {
      const r = check(fixtureDoc(c.o), c.pic);
      expect(view(r)).toEqual({ verdict: c.verdict, ranges: c.ranges });
      expect(r.areaPeak.general).toBe(c.areaPeak);
      if ('area' in c) {
        expect(r.ranges[0]!.flashesPerSecond).toBe(c.area); // flashes a second over the failing area
        expect(r.ranges[0]!.busiestCellFlashesPerSecond).toBe(c.busiest); // the old number: one cell
      }
    });
  }
});
