/**
 * Drawn overlays in the evaluator and the Canvas2D compositor (wave 8 carrier), with the TEST-ONLY kind and painter
 * (core drawn.testKind.ts, engine drawnPainters.testKind.ts).
 *
 * The pixel checks run the real evaluate + drawGraph in Node on a PIXEL STAND-IN canvas (TEST STAND-IN, below): exact
 * straight-alpha source-over / destination-in arithmetic in floating point, a pixel covered when its centre lies inside a
 * filled rectangle under the current transform, no antialiasing. It shows which pixels the compositor's calls cover and
 * how they mix, not what Chromium's 8-bit canvas makes of them (conformance:opacity measures that on real stills).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, restoreEntities, sha256Hex, type DrawnClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { registerTestDrawnOp, testDrawn } from '@pulseframe/core/drawn.testKind.ts';
import { describeMoment, evaluate } from './evaluate.ts';
import { drawGraph, type Ctx2D, type FrameProvider } from './compositor2d.ts';
import { unregisterDrawnPainter } from './drawnPainters.ts';
import { paintTestDrawn, registerTestDrawnPainter } from './drawnPainters.testKind.ts';
import { registerDrawnPainter } from './drawnPainters.ts';
import { frameInputs, frameKey, type FrameKeyContext } from './frameKey.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `dl${n++}_`, actor: 'test', allowInternal: true });
const W = 64, H = 36;

// ---------- PIXEL STAND-IN (labelled test double) ----------
type M = [number, number, number, number, number, number];
const mul = (m: M, a: number, b: number, c: number, d: number, e: number, f: number): M => [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
const parseColour = (s: unknown): [number, number, number] => {
  const h = String(s);
  if (/^#[0-9a-f]{3}$/i.test(h)) return [0, 1, 2].map((i) => parseInt(h[i + 1]! + h[i + 1]!, 16) / 255) as [number, number, number];
  return [0, 2, 4].map((i) => parseInt(h.slice(1 + i, 3 + i), 16) / 255) as [number, number, number];
};
class PixelCanvas {
  readonly px: Float64Array;
  readonly ctx: Ctx2D;
  constructor(public width: number, public height: number) {
    this.px = new Float64Array(width * height * 4);
    const canvas = this;
    const st = { m: [1, 0, 0, 1, 0, 0] as M, globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000' as unknown };
    const stack: (typeof st)[] = [];
    const blend = (i: number, r: number, g: number, b: number, a: number) => {
      const d = canvas.px, op = st.globalCompositeOperation;
      if (op === 'destination-in') { d[i + 3] = d[i + 3]! * a; return; }
      if (op !== 'source-over') throw new Error(`stand-in: composite ${op} not modelled`);
      const da = d[i + 3]!, oa = a + da * (1 - a);
      if (oa === 0) { d.fill(0, i, i + 4); return; }
      d[i] = (r * a + d[i]! * da * (1 - a)) / oa; d[i + 1] = (g * a + d[i + 1]! * da * (1 - a)) / oa; d[i + 2] = (b * a + d[i + 2]! * da * (1 - a)) / oa; d[i + 3] = oa;
    };
    const api: Record<string, unknown> = {
      canvas,
      save: () => stack.push({ ...st, m: [...st.m] as M }), restore: () => Object.assign(st, stack.pop()),
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => { st.m = [a, b, c, d, e, f]; },
      translate: (x: number, y: number) => { st.m = mul(st.m, 1, 0, 0, 1, x, y); },
      scale: (x: number, y: number) => { st.m = mul(st.m, x, 0, 0, y, 0, 0); },
      rotate: (r: number) => { const c = Math.cos(r), s = Math.sin(r); st.m = mul(st.m, c, s, -s, c, 0, 0); },
      clearRect: () => canvas.px.fill(0),
      fillRect: (x: number, y: number, w: number, h: number) => {
        const [a, b, c, d, e, f] = st.m, det = a * d - b * c;
        const [r, g, bl] = parseColour(st.fillStyle);
        for (let py = 0; py < canvas.height; py++) for (let qx = 0; qx < canvas.width; qx++) {
          const X = qx + 0.5 - e, Y = py + 0.5 - f, u = (d * X - c * Y) / det, v = (-b * X + a * Y) / det;
          if (u >= Math.min(x, x + w) && u < Math.max(x, x + w) && v >= Math.min(y, y + h) && v < Math.max(y, y + h)) blend((py * canvas.width + qx) * 4, r, g, bl, st.globalAlpha);
        }
      },
      drawImage: (src: PixelCanvas) => {
        if (!(src instanceof PixelCanvas)) throw new Error('stand-in: only stand-in canvases are drawn');
        for (let i = 0; i < src.px.length; i += 4) blend(i, src.px[i]!, src.px[i + 1]!, src.px[i + 2]!, src.px[i + 3]! * st.globalAlpha);
      },
    };
    this.ctx = new Proxy(api, { get: (t, k: string) => (k in t ? t[k] : k in st ? (st as Record<string, unknown>)[k] : () => {}), set: (_t, k: string, v) => { (st as Record<string, unknown>)[k] = v; return true; } }) as unknown as Ctx2D;
  }
  getContext() { return this.ctx; }
  at(x: number, y: number) { const i = (y * this.width + x) * 4; return [...this.px.slice(i, i + 4)].map((v) => Math.round(v * 1e6) / 1e6); }
}
beforeAll(() => { vi.stubGlobal('OffscreenCanvas', PixelCanvas); registerTestDrawnOp(); registerTestDrawnPainter(); });
afterAll(() => { vi.unstubAllGlobals(); });

const noPictures: FrameProvider = async () => null;
async function picture(doc: ProjectDocument, frame: number) {
  const c = new PixelCanvas(W, H);
  const res = await drawGraph(c.ctx, evaluate(doc, f(frame)), noPictures);
  return Object.assign(c, { res });
}

/** A test shape (half sizes 0.3 × 0.2 of the frame height: 21.6 × 14.4 px around the centre, x 21.2…42.8) at 10…70, red. */
function scene(transform: Record<string, number> = {}, offset = 0) {
  let r = tx(createProject({ id: 'prj_dl', name: 'D', width: W, height: H }), [{ op: 'add_test_drawn', args: { start: f(10), duration: f(60), drawn: testDrawn({ color: '#FF0000', w: 3000, h: 2000, offset }), transform } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  return { doc: r.doc, clipId };
}

describe('the compositor paints a drawn layer through its kind\'s painter', () => {
  it('draws at the anchor; nothing outside the clip\'s time; the layer carries the payload and exact local time', async () => {
    const { doc, clipId } = scene();
    const g = evaluate(doc, f(10));
    expect(g.layers).toEqual([expect.objectContaining({ kind: 'drawn', clipId, drawn: testDrawn({ color: '#FF0000', w: 3000, h: 2000 }), clipTime: T.ZERO, localFrame: 0, fps: R })]);
    const p = await picture(doc, 10);
    expect(p.res).toMatchObject({ missing: [], unavailableEffects: [] });
    expect(p.at(32, 18)).toEqual([1, 0, 0, 1]); // centre: red
    expect(p.at(2, 18)).toEqual([0, 0, 0, 1]); // outside the shape: the black background
    expect((await picture(doc, 9)).at(32, 18)).toEqual([0, 0, 0, 1]);
  });
  it('fades through the buffer: at opacity 0.5 the crossing of its two fills is exactly as light as the rest (no darkening)', async () => {
    const { doc } = scene({ opacity: 0.5 });
    const p = await picture(doc, 10);
    const once = p.at(23, 18), twice = p.at(32, 18); // x 23: only the left fill (21.2…28.4); x 32: both
    expect(once).toEqual([0.5, 0, 0, 1]);
    expect(twice).toEqual(once);
    // drawn with globalAlpha as a title is, the crossing comes out 0.75 (checked by making the compositor do that: this test then fails)
  });
  it('moves, scales and fades with the transform and opacity keys', async () => {
    const moved = await picture(scene({ x: 0.25 }).doc, 10);
    expect(moved.at(32 + 16, 18)).toEqual([1, 0, 0, 1]);
    expect(moved.at(32 - 12, 18)).toEqual([0, 0, 0, 1]);
    const small = await picture(scene({ scale: 0.5 }).doc, 10);
    expect(small.at(32 + 7, 18)).toEqual([0, 0, 0, 1]); // half width 5.4 px at scale 0.5
    expect(small.at(32 + 4, 18)).toEqual([1, 0, 0, 1]);
    let { doc, clipId } = scene();
    doc = tx(doc, [{ op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(0), value: 0 } }, { op: 'set_keyframe', args: { clipId, property: 'opacity', time: f(10), value: 1 } }]).doc;
    expect((await picture(doc, 15)).at(32, 18)).toEqual([0.5, 0, 0, 1]);
  });
  it('a kind without a painter draws nothing and is reported, so a still or an export refuses', async () => {
    const { doc } = scene();
    unregisterDrawnPainter('test');
    try {
      const p = await picture(doc, 10);
      expect(p.at(32, 18)).toEqual([0, 0, 0, 1]);
      expect(p.res.unavailableEffects).toEqual(['drawn.test']);
      expect(p.res.unavailableReasons).toEqual({ 'drawn.test': 'this build has no painter for drawn test clips' });
    } finally { registerDrawnPainter('test', paintTestDrawn); }
  });
});

describe('time: split, trim-start, duplicate and undo keep the picture', () => {
  it('split and trim-start: every frame after the cut is the picture it was (the kind\'s shift moves its offset)', async () => {
    const { doc, clipId } = scene();
    const split = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(30) } }]).doc;
    const trimmed = tx(doc, [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(25) } }]).doc;
    for (const frame of [30, 31, 45, 69]) {
      const before = (await picture(doc, frame)).px;
      expect((await picture(split, frame)).px).toEqual(before);
      expect((await picture(trimmed, frame)).px).toEqual(before);
    }
    // without the shift the right half would restart its content: its first frame differs from the unsplit one
    const unshifted = structuredClone(split);
    for (const c of unshifted.sequences[unshifted.mainSequenceId]!.tracks.flatMap((t) => t.clips)) if (c.type === 'drawn') (c as DrawnClip).drawn.offset = 0;
    expect((await picture(unshifted, 30)).px).not.toEqual((await picture(doc, 30)).px);
  });
  it('a duplicate shows the same pictures at its own time; undo of any of these edits restores the same frames', async () => {
    const { doc, clipId } = scene();
    const dup = tx(doc, [{ op: 'duplicate_clips', args: { clipIds: [clipId], at: f(100) } }]).doc;
    expect((await picture(dup, 125)).px).toEqual((await picture(doc, 35)).px);
    for (const ops of [[{ op: 'split_clip', args: { clipId, at: f(30) } }], [{ op: 'trim_clip', args: { clipId, edge: 'start', to: f(25) } }], [{ op: 'duplicate_clips', args: { clipIds: [clipId], at: f(100) } }]] as OpCall[][]) {
      const after = tx(doc, ops).doc;
      const back = structuredClone(after);
      restoreEntities(back, diffEntities(doc, after).map((c) => ({ id: c.id, state: c.before })));
      expect(creativeProjection(back)).toBe(creativeProjection(doc));
      expect(evaluate(back, f(40))).toEqual(evaluate(doc, f(40)));
    }
  });
});

describe('the frame key and what agents see', () => {
  const ctx = (doc: ProjectDocument): FrameKeyContext => ({ digest: (s) => sha256Hex(s), output: { width: W, height: H }, assetHash: () => null, fontHash: () => null, effectVersion: () => 1, gpu: null });
  it('the key holds the payload (another colour, another key) and nothing font-related', () => {
    const { doc, clipId } = scene();
    const blue = structuredClone(doc);
    (blue.sequences[blue.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId) as DrawnClip).drawn.color = '#0000FF';
    expect(frameKey(doc, 10, ctx(doc))).not.toBe(frameKey(blue, 10, ctx(blue)));
    expect(frameKey(doc, 10, ctx(doc))).toBe(frameKey(structuredClone(doc), 10, ctx(doc)));
    expect(frameInputs(doc, evaluate(doc, f(10)), ctx(doc)).fonts).toEqual({}); // fontHash answers null: a font lookup would have thrown
  });
  it('describe_moment names the kind through its summary, not the payload', () => {
    const { doc, clipId } = scene({}, 7);
    const m = describeMoment(doc, f(12));
    expect(m.layers).toEqual([{ kind: 'drawn', clipId, drawn: { kind: 'test', name: { he: 'צורת בדיקה', en: 'Test shape' }, color: '#FF0000', offset: 7 }, localFrame: 2 }]);
  });
});
