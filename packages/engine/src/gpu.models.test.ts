/**
 * The JavaScript models of the wave-1 GPU passes (ADR-0011) and their registration. The passes themselves are WGSL only
 * (ADR-0008 decision 2) and are checked against these models on a real adapter by `pnpm proof:gpu`; here the models' own
 * properties, the numbers each pass receives (at most eight, CRT without time) and the transition table are checked in Node.
 * The trend pack (ADR-0012) adds the transition uniform v2 (twelve numbers), the light colours' red share and the geometry
 * models of film-burn, brush and page-turn (checked on an adapter by `pnpm proof:trend-light`).
 */
import { describe, expect, it } from 'vitest';
import { EFFECTS, effectParams, GPU_TRANSITION_IDS, TRANSITIONS, transitionDef } from '@pulseframe/core';
import { brushFront, burnThreshold, crtMap, digicamTick, digicamTone, GPU_EFFECTS, GPU_TRANSITIONS, hash32, PAGE_RADIUS, pageFold, pageTurnSource, transitionUniforms, unit32, LIVING_PASS_BUILT, LivingPassNotBuilt, livingModel, livingVisibleRect } from './gpu.ts';

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
  it('every effect of cost gpu has a pass, and every pass gets at most eight numbers (twelve for a wide pass)', () => {
    // depth.living («תמונה חיה», wave 8): its pass is W2's; until LIVING_PASS_BUILT it has none and is reported unavailable
    for (const e of EFFECTS.filter((x) => x.cost === 'gpu' && !(x.id === 'depth.living' && !LIVING_PASS_BUILT))) {
      expect(GPU_EFFECTS[e.id], e.id).toBeDefined();
      expect(GPU_EFFECTS[e.id]!.params(defaults(e.id), env(1)).length, e.id).toBeLessThanOrEqual(GPU_EFFECTS[e.id]!.wide ? 12 : 8);
    }
    expect(!!GPU_EFFECTS['depth.living']).toBe(LIVING_PASS_BUILT);
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
  it('46 GPU transitions, the same as core lists; whip and spin with their directions', () => {
    expect(Object.keys(GPU_TRANSITIONS).sort()).toEqual([...GPU_TRANSITION_IDS].sort());
    expect(GPU_TRANSITION_IDS.length).toBe(46);
    expect(Object.fromEntries(['whip-left', 'whip-right', 'whip-up', 'whip-down', 'spin-cw', 'spin-ccw'].map((id) => [id, GPU_TRANSITIONS[id]]))).toEqual({
      'whip-left': { kernel: 'whip', v: [-1, 0, 0] }, 'whip-right': { kernel: 'whip', v: [1, 0, 0] }, 'whip-up': { kernel: 'whip', v: [0, -1, 0] }, 'whip-down': { kernel: 'whip', v: [0, 1, 0] },
      'spin-cw': { kernel: 'spin', v: [1, 0, 0] }, 'spin-ccw': { kernel: 'spin', v: [-1, 0, 0] },
    });
  });
});

describe('trend-pack transitions (ADR-0012)', () => {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  it('transitionUniforms packs twelve numbers in order: p, v0..v2, W/H, W, H, light, tint r, g, b, seed', () => {
    expect(transitionUniforms({ type: 'brush-left', progress: 0.25, light: 0.75, color: '#FF8000', seed: 42 }, 1080, 1920)).toEqual([0.25, -1, 0, 0, 1080 / 1920, 1080, 1920, 0.75, 1, 128 / 255, 0, 42]);
    // a legacy kernel: light 0, white, seed 0, so the 39 legacy passes read what they always read in a and b
    expect(transitionUniforms({ type: 'soft-wipe-down-left', progress: 0.5 }, 640, 360)).toEqual([0.5, -1, 1, 0, 640 / 360, 640, 360, 0, 1, 1, 1, 0]);
    expect(transitionUniforms({ type: 'film-burn', progress: 1, color: 'orange' }, 2, 1).slice(8, 11)).toEqual([1, 1, 1]); // malformed colour: white
    for (const id of Object.keys(GPU_TRANSITIONS)) expect(transitionUniforms({ type: id, progress: 0 }, 360, 640)).toHaveLength(12);
    expect(() => transitionUniforms({ type: 'dissolve', progress: 0 }, 360, 640)).toThrow(/no GPU transition/);
  });
  it('the seven GPU ids and their variants; every light transition is a GPU id with a colour', () => {
    expect(Object.fromEntries(['film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right'].map((id) => [id, GPU_TRANSITIONS[id]]))).toEqual({
      'film-burn': { kernel: 'burn', v: [0, 0, 0] }, 'light-leak': { kernel: 'leak', v: [0, 0, 0] }, 'ink-bleed': { kernel: 'ink', v: [0, 0, 0] },
      'brush-left': { kernel: 'brush', v: [-1, 0, 0] }, 'brush-right': { kernel: 'brush', v: [1, 0, 0] },
      'page-turn-left': { kernel: 'page', v: [-1, 0, 0] }, 'page-turn-right': { kernel: 'page', v: [1, 0, 0] },
    });
    const lights = TRANSITIONS.filter((t) => transitionDef(t.id)?.light).map((t) => t.id);
    expect(lights.sort()).toEqual(['film-burn', 'light-leak']);
    for (const id of lights) { expect(GPU_TRANSITIONS[id], id).toBeDefined(); expect(transitionDef(id)!.options).toContain('color'); }
  });
  it('the default light colours keep a linear red share of at most 0.75 (the analyser calls 0.8 saturated red)', () => {
    for (const t of TRANSITIONS.map((x) => transitionDef(x.id)!).filter((x) => x.light)) {
      const c = t.defaults!.color!, rgb = [1, 3, 5].map((i) => lin(parseInt(c.slice(i, i + 2), 16)));
      const share = rgb[0]! / (rgb[0]! + rgb[1]! + rgb[2]!);
      expect(share, `${t.id} ${c}`).toBeLessThanOrEqual(0.75);
      expect(share, `${t.id} ${c}: still a warm light`).toBeGreaterThan(0.5);
    }
  });
  it('burnThreshold sweeps from below every noise level (nothing burnt) to above every one (all burnt), evenly', () => {
    expect(burnThreshold(0)).toBeLessThan(0);
    expect(burnThreshold(1)).toBeGreaterThan(1);
    expect(burnThreshold(0.5)).toBeCloseTo(0.525, 12);
    for (let i = 1; i <= 100; i++) expect(burnThreshold(i / 100)).toBeGreaterThan(burnThreshold((i - 1) / 100));
  });
  it('brushFront: each band starts at most a quarter late, every band is done by the end, and the bands follow the shader\'s seeded delays', () => {
    for (const seed of [0, 1, 77, 9999]) for (let band = 0; band < 4; band++) {
      expect(brushFront(0, band, seed)).toBeLessThanOrEqual(0);
      expect(brushFront(0, band, seed)).toBeGreaterThan(-0.25);
      expect(brushFront(1, band, seed) - 0.08 - 0.01, 'past the far edge with the bristle and the soft edge').toBeGreaterThan(1);
      expect(brushFront(0.5, band, seed)).toBeCloseTo(0.75 - unit32(hash32(band + seed)) * 0.25, 12);
    }
    // the seed changes the delays
    expect([0, 1, 2, 3].map((b) => brushFront(0.5, b, 1))).not.toEqual([0, 1, 2, 3].map((b) => brushFront(0.5, b, 2)));
  });
  it('pageFold and pageTurnSource: all page at the start, all incoming at the end, nothing ever goes back, and the flat back mirrors about pageFold().mirror', () => {
    expect(pageFold(0).fold).toBeCloseTo(1 + PAGE_RADIUS, 12);
    expect(pageFold(1).fold).toBeCloseTo(-PAGE_RADIUS, 12);
    const S = Array.from({ length: 400 }, (_, i) => (i + 0.5) / 400); // pixel centres
    expect(S.every((s) => pageTurnSource(s, 0).face === 'front' && pageTurnSource(s, 0).at === s)).toBe(true);
    expect(S.every((s) => pageTurnSource(s, 1).face === 'incoming')).toBe(true);
    let was = S.map(() => false);
    for (let k = 0; k <= 200; k++) {
      const p = k / 200, now = S.map((s) => pageTurnSource(s, p).face === 'incoming');
      now.forEach((inc, i) => { if (was[i]) expect(inc, `s=${S[i]} p=${p}`).toBe(true); });
      was = now;
      const { fold, edge, mirror } = pageFold(p);
      expect(edge).toBeGreaterThanOrEqual(fold);
      expect(edge).toBeLessThanOrEqual(fold + PAGE_RADIUS + 1e-12);
      // the flat back of the page (left of the fold): the outgoing picture's s' = 2·mirror − s, and only paper that exists (s' <= 1)
      for (const s of S) { const r = pageTurnSource(s, p); if (s <= fold && r.face === 'back') { expect(r.at).toBeCloseTo(2 * mirror - s, 12); expect(r.at).toBeLessThanOrEqual(1); } }
    }
    // half-way: the far side has gone, the near side is still the page, and the band just before the fold shows its back
    const mid = pageFold(0.5);
    expect(pageTurnSource(0.95, 0.5).face).toBe('incoming');
    expect(pageTurnSource(0.05, 0.5)).toEqual({ face: 'front', at: 0.05 });
    expect(pageTurnSource(mid.fold - 0.05, 0.5).face).toBe('back');
  });
});

describe('depth.living («תמונה חיה», wave 8 living): the pass contract (W2)', () => {
  it('until W2 builds it, the pass, its geometry and its model are typed stubs that say so', () => {
    expect(LIVING_PASS_BUILT).toBe(false);
    expect(() => livingModel([0.5, 0.5], [], { width: 1, height: 1, data: new Uint8Array(1) })).toThrow(LivingPassNotBuilt);
    expect(() => livingVisibleRect({ cx: 0, cy: 0, w: 1, h: 1, rotation: 0, scale: 1 }, { width: 1, height: 1 }, { width: 1, height: 1 })).toThrow(LivingPassNotBuilt);
  });
  it.todo('W2 the pass is wide (12 numbers) and samples the depth at binding 3; its shader passes checkWgsl (gpu.validation.test.ts loop)');
  it.todo('W2 livingVisibleRect: the picture rectangle cut to the frame, inset half a texel; a photo at Ken Burns scale 1.18 clamps inside the frame (C2)');
  it.todo('W2 the step count comes from the depth grid (core livingSteps): the same numbers at 640×360, 1280×720 and 1920×1080 (C7)');
  it.todo('W2 livingModel: a flat depth with one near dab moves the dab by the expected shift and leaves the far plane (push: still; slide: −f·d)');
  it.todo('W2 evaluate copies clip.depth into the ImageLayer, so the frame key covers every stroke: a changed stroke changes the key, an equal record keeps it (frameKey tests)');
  it.todo('W2 with no depth or rotated (core livingUnavailable) the effect is recorded unavailable with the reason, never drawn flat (C6)');
});
