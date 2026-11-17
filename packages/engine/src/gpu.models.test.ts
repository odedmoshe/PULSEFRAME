/**
 * The JavaScript models of the wave-1 GPU passes (ADR-0011) and their registration. The passes themselves are WGSL only
 * (ADR-0008 decision 2) and are checked against these models on a real adapter by `pnpm proof:gpu`; here the models' own
 * properties, the numbers each pass receives (at most eight, CRT without time) and the transition table are checked in Node.
 */
import { describe, expect, it } from 'vitest';
import { EFFECTS, effectParams, GPU_TRANSITION_IDS } from '@pulseframe/core';
import { crtMap, digicamTick, digicamTone, GPU_EFFECTS, GPU_TRANSITIONS } from './gpu.ts';

const defaults = (type: string) => effectParams(type, {}) as Record<string, unknown>;
const env = (seconds: number) => ({ width: 360, height: 640, seconds, beat: null });

describe('digicamTick', () => {
  it('counts 15 ticks a second and changes exactly on the frame boundaries of a 30 fps timeline every second frame', () => {
    expect([0, 1 / 15 - 1e-4, 1 / 15, 0.5, 1, 3600].map(digicamTick)).toEqual([0, 0, 1, 7, 15, 54000]);
    const ticks = Array.from({ length: 60 }, (_, f) => digicamTick(f / 30));
    expect(ticks).toEqual(Array.from({ length: 60 }, (_, f) => Math.floor(f / 2)));
  });
});

describe('digicamTone (the pass on a flat patch)', () => {
  const grey: [number, number, number] = [0.5, 0.5, 0.5];
  it('is the input at amount 0', () => {
    for (const c of [grey, [0.9, 0.95, 0.99], [0.1, 0.6, 0.3]] as [number, number, number][]) expect(digicamTone(c, { ...defaults('stylize.digicam'), amount: 0 })).toEqual(c);
  });
  it('on mid grey with the defaults: the white balance only (no bloom below luma 0.8, the block colour is the patch\'s own), mixed by the amount', () => {
    const p = defaults('stylize.digicam');
    const cool = p.cool as number, amount = p.amount as number;
    const wb = [1 - 0.05 * cool, 1 + 0.01 * cool, 1 + 0.08 * cool];
    digicamTone(grey, p).forEach((v, i) => expect(v).toBeCloseTo(0.5 * (1 - amount) + 0.5 * wb[i]! * amount, 12));
  });
  it('cool is bluer, warm is redder, and the luma of the patch moves by less than 2%', () => {
    const cool = digicamTone(grey, { amount: 1, bloom: 0, cool: 1 }), warm = digicamTone(grey, { amount: 1, bloom: 0, cool: -1 });
    expect(cool[2]).toBeGreaterThan(cool[0]); expect(warm[0]).toBeGreaterThan(warm[2]);
    const l = (c: number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(Math.abs(l(cool) - 0.5)).toBeLessThan(0.01); expect(Math.abs(l(warm) - 0.5)).toBeLessThan(0.01);
  });
  it('highlights bloom: a bright patch gets brighter with bloom and a dark one does not; the result stays in 0..1', () => {
    const bright: [number, number, number] = [0.9, 0.9, 0.85], dark: [number, number, number] = [0.3, 0.3, 0.3];
    const on = digicamTone(bright, { amount: 1, bloom: 1, cool: 0 }), off = digicamTone(bright, { amount: 1, bloom: 0, cool: 0 });
    expect(on[2]).toBeGreaterThan(off[2] + 0.01);
    expect(digicamTone(dark, { amount: 1, bloom: 1, cool: 0 })).toEqual(digicamTone(dark, { amount: 1, bloom: 0, cool: 0 }));
    for (let i = 0; i < 200; i++) {
      const c: [number, number, number] = [(i * 37) % 101 / 100, (i * 53) % 101 / 100, (i * 71) % 101 / 100];
      for (const v of digicamTone(c, { amount: 1, bloom: 1, cool: i % 2 ? 1 : -1 })) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
    }
  });
});

describe('crtMap (the curved glass)', () => {
  const aspect = 360 / 640;
  it('is the identity with no curvature, everywhere in the frame', () => {
    for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) {
      const u = (i + 0.5) / 21, v = (j + 0.5) / 21, m = crtMap(u, v, { curvature: 0 }, aspect)!;
      expect(m[0]).toBeCloseTo(u, 12); expect(m[1]).toBeCloseTo(v, 12);
    }
  });
  it('keeps the centre, bends outward (barrel), is symmetric and keeps rows in order', () => {
    const p = { curvature: 0.2 };
    expect(crtMap(0.5, 0.5, p, aspect)).toEqual([0.5, 0.5]);
    const a = crtMap(0.8, 0.3, p, aspect)!, b = crtMap(0.2, 0.7, p, aspect)!;
    expect(a[0]).toBeGreaterThan(0.8); expect(a[1]).toBeLessThan(0.3);
    expect(a[0] + b[0]).toBeCloseTo(1, 12); expect(a[1] + b[1]).toBeCloseTo(1, 12);
    let last = -Infinity;
    for (let x = 0; x < 360; x++) { const m = crtMap((x + 0.5) / 360, 0.4, p, aspect); if (m) { expect(m[0]).toBeGreaterThan(last); last = m[0]; } }
  });
  it('is null outside the glass: past the edges and in the rounded corners, never at the centre', () => {
    const p = { curvature: 0.3 };
    expect(crtMap(0.001, 0.001, p, aspect)).toBeNull();
    expect(crtMap(0.5, 0.999, p, aspect)).toBeNull();
    expect(crtMap(0.5, 0.6, p, aspect)).not.toBeNull();
  });
});

describe('registration', () => {
  it('every effect of cost gpu has a pass, and every pass gets at most eight numbers', () => {
    for (const e of EFFECTS.filter((x) => x.cost === 'gpu')) {
      expect(GPU_EFFECTS[e.id], e.id).toBeDefined();
      expect(GPU_EFFECTS[e.id]!.params(defaults(e.id), env(1)).length, e.id).toBeLessThanOrEqual(8);
    }
  });
  it('digicam: the eight numbers in the documented order, the tick computed here; the noise changes only from one tick to the next', () => {
    const p = { amount: 0.8, sharpen: 0.7, noise: 0.3, bloom: 0.35, cool: 0.4, seed: 9 };
    expect(GPU_EFFECTS['stylize.digicam']!.params(p, env(2.5))).toEqual([0.8, 0.7, 0.3, 0.35, 0.4, 9, 37, 0]);
    expect(GPU_EFFECTS['stylize.digicam']!.params(p, env(2.5))).toEqual(GPU_EFFECTS['stylize.digicam']!.params(p, env(2.5 + 1 / 30 - 1e-3)));
  });
  it('crt: the numbers do not depend on the time (it cannot flicker); the phosphor kind and the pitch in pixels', () => {
    const fx = GPU_EFFECTS['stylize.crt']!, p = defaults('stylize.crt');
    expect(fx.params(p, env(0))).toEqual(fx.params(p, env(1234.567)));
    expect(fx.params({ ...p, phosphor: 'dots', pitch: 0.01 }, env(0)).slice(0, 3)).toEqual([p.curvature, 1, 6.4]);
    expect(fx.params({ ...p, phosphor: 'slot' }, env(0))[1]).toBe(2);
    expect(fx.params(p, env(0))[6]).toBeCloseTo(360 / 640, 12);
  });
  it('the WGSL of every pass has balanced brackets', () => {
    for (const [id, fx] of Object.entries(GPU_EFFECTS)) {
      let depth = 0;
      for (const ch of fx.wgsl) { if ('({['.includes(ch)) depth++; if (')}]'.includes(ch)) depth--; expect(depth, id).toBeGreaterThanOrEqual(0); }
      expect(depth, id).toBe(0);
    }
  });
  it('39 GPU transitions, the same as core lists; whip and spin with their directions', () => {
    expect(Object.keys(GPU_TRANSITIONS).sort()).toEqual([...GPU_TRANSITION_IDS].sort());
    expect(GPU_TRANSITION_IDS.length).toBe(39);
    expect(Object.fromEntries(['whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw'].map((id) => [id, GPU_TRANSITIONS[id]]))).toEqual({
      'whip-left': { kernel: 'whip', v: [-1, 0, 0] }, 'whip-right': { kernel: 'whip', v: [1, 0, 0] }, 'whip-up': { kernel: 'whip', v: [0, -1, 0] }, 'whip-down': { kernel: 'whip', v: [0, 1, 0] },
      'spin-cw': { kernel: 'spin', v: [1, 0, 0] }, 'spin-ccw': { kernel: 'spin', v: [-1, 0, 0] },
    });
  });
});
