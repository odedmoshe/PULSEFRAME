/**
 * Where a title's gradient begins and ends (ADR-0012), checked without a browser: the real `drawGraph` draws a title with
 * a 90° gradient into a stand-in canvas that records the gradient it is given.
 *
 * TEST STAND-IN: the canvas has no glyphs. Its measureText answers for one line whose ink is given in font sizes, and
 * reports that ink the way Chromium 153 was measured to report it (trend-text proof X3, Heebo 700, 'שלום'): rounded
 * outward to whole pixels up to a font size of 256 px, and to steps of 1/64 of the font size above it (at 384 px a descent
 * of 12 px for ink that descends 6.74 px). What it shows is which box the compositor runs the gradient across, not what a
 * browser draws.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { drawGraph, evaluate } from './index.ts';
import type { Ctx2D } from './compositor2d.ts';
import { INK_METRICS_MAX_PX } from './textEffects.ts';

const f = (n: number) => T.frameTime(n, { num: 30, den: 1 });
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `k${seed++}_`, actor: 'test' });

/** The ink of the stand-in's line, in font sizes from its origin (Heebo 700 'שלום' as drawn at 384 px: 288 up, 6.741 down, from 31.12 to 881.25 px). */
const INK = { ascent: 288 / 384, descent: 6.741 / 384, left: -31.12 / 384, right: 881.25 / 384, width: 912.375 / 384 };
const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);

function canvas() {
  const gradients: { x0: number; y0: number; x1: number; y1: number; stops: [number, string][] }[] = [];
  const measured: { size: number; spacing: number }[] = [];
  const fills: { size: number; spacing: number }[] = [];
  const ctx = {
    font: '10px sans-serif', direction: 'ltr', letterSpacing: '0px', globalAlpha: 1, fillStyle: '#000' as unknown, strokeStyle: '#000' as unknown, lineWidth: 1, lineJoin: 'miter', textBaseline: 'alphabetic', textAlign: 'left',
    save() {}, restore() {}, setTransform() {}, translate() {}, scale() {}, rotate() {}, getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    fillRect() {}, clearRect() {}, roundRect() {}, fill() {}, beginPath() {}, rect() {}, clip() {},
    measureText(text: string) {
      const size = sizeOf(ctx.font), spacing = parseFloat(ctx.letterSpacing) || 0, letters = [...text].length;
      measured.push({ size, spacing });
      // the browser's rounding of the ink box: outward, to whole pixels, or to 1/64 of the font size above 256 px
      const step = size > 256 ? size / 64 : 1, out = (v: number) => Math.ceil(v / step - 1e-9) * step;
      return {
        width: INK.width * size + spacing * letters,
        actualBoundingBoxAscent: out(INK.ascent * size), actualBoundingBoxDescent: out(INK.descent * size),
        actualBoundingBoxLeft: out(INK.left * size), actualBoundingBoxRight: out(INK.right * size + spacing * (letters - 1)),
      };
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      const g = { x0, y0, x1, y1, stops: [] as [number, string][] };
      gradients.push(g);
      return { addColorStop: (at: number, colour: string) => { g.stops.push([at, colour]); } };
    },
    fillText() { fills.push({ size: sizeOf(ctx.font), spacing: parseFloat(ctx.letterSpacing) || 0 }); }, strokeText() {},
  };
  return { ctx: ctx as unknown as Ctx2D, gradients, measured, fills };
}
/** Draws a one-line title with a 90° gradient at this font size (a fraction of the 1920 px frame height) and returns what the canvas was asked. */
async function draw(sizeFrac: number, style: Record<string, unknown> = {}) {
  const r = tx(createProject({ id: 'prj_k', name: 'K', width: 1080, height: 1920 }), [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(30), style: { fontFamily: 'Heebo', fontWeight: 700, sizeFrac, stroke: null, strokeFrac: 0, background: null, gradient: { colors: ['#FFD166', '#3A5BFF'], angle: 90 }, ...style } } }]);
  const c = canvas();
  await drawGraph(c.ctx, evaluate(r.doc, f(0)), async () => null);
  return c;
}

describe('the ink box a gradient runs across (ADR-0012)', () => {
  it('a 384 px title: the gradient begins and ends within px/256 of the ink\'s top and bottom, never inside the ink', async () => {
    const px = 0.2 * 1920, c = await draw(0.2);
    expect(c.gradients).toHaveLength(1);
    const g = c.gradients[0]!;
    // one line: its baseline is 0.34 font sizes below the middle of the block (compositor2d lineBaseline)
    const top = px * 0.34 - INK.ascent * px, bottom = px * 0.34 + INK.descent * px, slack = px / INK_METRICS_MAX_PX;
    expect(g.stops).toEqual([[0, '#FFD166'], [1, '#3A5BFF']]);
    expect(g.x0).toBeCloseTo(g.x1, 9); // 90°: straight down
    expect(g.y0).toBeLessThanOrEqual(top + 1e-9); expect(top - g.y0).toBeLessThanOrEqual(slack);
    // measured through the browser's own box at 384 px the gradient ended 5.26 px below the ink: the last colour was never reached
    expect(g.y1).toBeGreaterThanOrEqual(bottom - 1e-9); expect(g.y1 - bottom).toBeLessThanOrEqual(slack);
    // the colour at the ink's last row is the last stop to within 1/255 on a stop difference of 197 (the proof's red channel)
    expect(((g.y1 - bottom) / (g.y1 - g.y0)) * 197).toBeLessThan(1);
    // the line was measured at its own size (its width) and at 256 px (its ink), and is drawn at its own size
    expect(c.measured.map((m) => m.size)).toEqual([px, INK_METRICS_MAX_PX]);
    expect(c.fills.map((d) => d.size)).toEqual([px]);
  });

  it('up to 256 px the line is measured once, at its own size, and the gradient runs across the browser\'s box as before', async () => {
    for (const sizeFrac of [0.08, 256 / 1920]) {
      const px = sizeFrac * 1920, c = await draw(sizeFrac);
      expect(c.measured.map((m) => m.size), `${px} px`).toEqual([px]);
      const g = c.gradients[0]!;
      expect(g.y0).toBeCloseTo(px * 0.34 - Math.ceil(INK.ascent * px - 1e-9), 9);
      expect(g.y1).toBeCloseTo(px * 0.34 + Math.ceil(INK.descent * px - 1e-9), 9);
    }
  });

  it('with space between the letters, the 256 px measurement uses the space scaled to that size, and the title is drawn with its own', async () => {
    const px = 0.2 * 1920, c = await draw(0.2, { tracking: 0.1 });
    expect(c.measured.map((m) => m.size)).toEqual([px, INK_METRICS_MAX_PX]);
    expect(c.measured[0]!.spacing).toBeCloseTo(0.1 * px, 9);
    expect(c.measured[1]!.spacing).toBeCloseTo(0.1 * INK_METRICS_MAX_PX, 9);
    expect(c.fills).toHaveLength(1);
    expect(c.fills[0]!.size).toBe(px);
    expect(c.fills[0]!.spacing).toBeCloseTo(0.1 * px, 9);
    const g = c.gradients[0]!;
    expect(g.y1 - (px * 0.34 + INK.descent * px)).toBeLessThanOrEqual(px / INK_METRICS_MAX_PX);
  });
});
