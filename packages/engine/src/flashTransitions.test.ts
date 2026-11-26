/**
 * Which transitions are themselves a general flash (ADR-0009 amendment, 2026-11-26): measured, not named. Each transition is
 * drawn on FLAT GREY on both sides (outgoing and incoming the same picture), so whatever the analyser sees is the
 * transition's own light or dark, not a change of picture. Kernels that only move, warp, mask or mix the two pictures return
 * a mix or a selection of samples of the two pictures, which on a flat picture is that picture: nothing to measure. The
 * kernels that add colour, light or shade of their own are modelled here per pixel from their code (TEST STAND-IN for the
 * WebGPU and Canvas2D passes; gpu.ts TRANSITION_WGSL and canvasTransitions.ts, cited per model) and fed to the export's
 * FlashAnalyser at 30 fps, 10- and 30-frame transitions, on greys 64, 128 and 192.
 *
 * A transition is a flash when, on some grey, more than a quarter of a 10-degree window changes by a flash's worth (two
 * transitions) — areaPeak ≥ 1 flash. Those carry `flashes` (the most measured, up to a whole flash) in the registry and take
 * that many places in the light plan.
 */
import { describe, expect, it } from 'vitest';
import { TRANSITIONS, transitionProgress } from '@pulseframe/core';
import { FlashAnalyser, flashCells } from './flashAnalysis.ts';
import { blockColors, blockSpans } from './canvasTransitions.ts';

const W = 160, H = 90;
type Model = (x: number, y: number, g: number, p: number, l: number, n: number) => number; // grey value 0..1 (sRGB) of the pixel
const smoothstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hex = (c: string) => { const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(c)!; return [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255] as const; };
/** Luminance-preserving stand-in: the models return RGB; flashCells takes the colour as given. */
type ModelRGB = (x: number, y: number, g: number, p: number, l: number, n: number) => readonly [number, number, number];
const grey = (f: Model): ModelRGB => (x, y, g, p, l, n) => { const v = f(x, y, g, p, l, n); return [v, v, v]; };

/** Kernels with light, dark or colour of their own. */
const MODELS: Record<string, ModelRGB> = {
  // gpu.ts flash: mix(O, I, …) + sin²(πp) white, clamped
  flash: grey((_x, _y, g, p) => Math.min(1, g + Math.sin(p * Math.PI) ** 2)),
  // canvasTransitions.ts dip: the side shown, then a fill of black or white at alpha 2p (first half) or 2(1 − p)
  'dip-black': grey((_x, _y, g, p) => { const a = p < 0.5 ? p * 2 : (1 - p) * 2; return g * (1 - a); }),
  'dip-white': grey((_x, _y, g, p) => { const a = p < 0.5 ? p * 2 : (1 - p) * 2; return g * (1 - a) + a; }),
  // canvasTransitions.ts block (v0 = −1: from the right edge): three bars c, 0.8c, 0.6c, bar 0 at the bottom
  'block-left': (x, _y, g, p, l, n) => {
    const spans = blockSpans(p, l, n), colors = blockColors('#3DE0C8');
    let c: readonly [number, number, number] = [g, g, g];
    for (const i of [0, 1, 2]) { const [a, b] = spans[i]!; const x0 = W * (1 - b), x1 = W * (1 - a); if (b > a && x + 0.5 >= x0 && x + 0.5 < x1) c = hex(colors[i]!); }
    return c;
  },
  // gpu.ts page (va.x < 0: page-turn-left): the curl shaded by at most 0.3, the back of the page 25% toward white, the shadow on the incoming picture
  'page-turn-left': grey((x, _y, g, p) => {
    const r = 0.12, pi = Math.PI, f = 1 + r + (-r - (1 + r)) * p, s = (x + 0.5) / W; // left: s = uv.x
    const edge = f + r * Math.sin(Math.min(Math.max(1 - f, 0) / r, 0.5 * pi));
    if (s > edge) return g * (1 - 0.25 * Math.exp(-(s - edge) / 0.04));
    if (s > f) {
      const a = Math.asin(Math.min(1, Math.max(0, (s - f) / r))), up = f + r * (pi - a), shade = 1 - 0.3 * Math.min(1, Math.max(0, (s - f) / r));
      return up <= 1 ? (g * 0.75 + 0.25) * shade : g * shade;
    }
    const top = 2 * f + pi * r - s;
    return top <= 1 ? g * 0.75 + 0.25 : g;
  }),
};

/** The analyser's most flashes a second over the area, for one transition of n frames between 15 and 30 frames of the same grey. */
function measure(model: ModelRGB, g255: number, n: number) {
  const a = new FlashAnalyser(30), g = g255 / 255, rgba = new Uint8ClampedArray(W * H * 4);
  const flat = () => { for (let i = 0; i < W * H; i++) rgba.set([g255, g255, g255, 255], i * 4); };
  for (let k = 0; k < 15; k++) { flat(); a.push(flashCells(rgba, W, H)); }
  for (let l = 0; l < n; l++) {
    const p = transitionProgress(l, n, null);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, gg, b] = model(x, y, g, p, l, n); rgba.set([Math.round(255 * r), Math.round(255 * gg), Math.round(255 * b), 255], (y * W + x) * 4); }
    a.push(flashCells(rgba, W, H));
  }
  for (let k = 0; k < 30; k++) { flat(); a.push(flashCells(rgba, W, H)); }
  return a.report().areaPeak.general;
}

describe('transitions that are a general flash of their own (measured on flat grey)', () => {
  it('flash, dip to black and dip to white flash once over the area, the colour blocks and the page turn up to twice; the registry marks exactly those', () => {
    const got: Record<string, number> = {};
    for (const [id, model] of Object.entries(MODELS)) got[id] = Math.max(...[64, 128, 192].flatMap((g) => [10, 30].map((n) => measure(model, g, n))));
    // the most flashes over the area on any grey and either length (the page turn: three changes on the light grey)
    expect(got).toEqual({ flash: 1, 'dip-black': 1, 'dip-white': 1, 'block-left': 2, 'page-turn-left': 1.5 });
    // the registry marks exactly those (and their mirror images, the same kernel the other way), with the measured count up to whole flashes
    const marked = Object.fromEntries(TRANSITIONS.filter((t) => 'flashes' in t && t.flashes).map((t) => [t.id, (t as { flashes: number }).flashes]));
    expect(marked).toEqual({ flash: 1, 'dip-black': 1, 'dip-white': 1, 'block-left': 2, 'block-right': 2, 'page-turn-left': 2, 'page-turn-right': 2 });
    for (const [id, m] of Object.entries(got)) expect(marked[id]).toBe(Math.ceil(m));
    // the light transitions keep their own place in the plan (held when too close), they are not marked
    expect(TRANSITIONS.filter((t) => 'light' in t && t.light && 'flashes' in t)).toEqual([]);
  }, 60_000);
});
