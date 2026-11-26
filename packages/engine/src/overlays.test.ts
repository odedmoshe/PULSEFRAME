import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, effectParamsAt, findEffect, paramRange, type BeatPosition, type EffectInstance, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { BURST, CENTRE_GAIN, DEPTHS, JITTER, DISC_LIGHT, FLASH_LIMIT, LATTICE_SIZE, OVERLAY_TYPES, RED_STEP_AS, SHAPE_LIGHT, SPEED_LIMIT, SWAY, boundRadius, burstParticles, cellSize, heldOverlayParams, latticeSite, latticeSites, overlayParticles, shapeAlpha, speedLimit, speedLines, strength, wedgeCorners, type Particle } from './overlays.ts';
import { FlashAnalyser, flashCells } from './flashAnalysis.ts';
import { evaluate } from './evaluate.ts';

const defaults = (type: string, over: Record<string, unknown> = {}) => findEffect(type)!.params.parse(over) as Record<string, number | string | boolean>;
const W = 1280, H = 720, FPS = 30;
const ALL = [...OVERLAY_TYPES.map((t) => [t, {}] as const), ['overlay.confetti', { mode: 'burst' }] as const, ['overlay.bokeh', { shape: 'hexagon' }] as const];

/** A coarse rasteriser of the model (source-over, or added light for the bokeh) on black or on a flat grey `bg` (0…255), for the flash check. */
function rasterise(parts: readonly Particle[], w: number, h: number, scale: number, add: boolean, bg = 0): Uint8ClampedArray {
  const rgb = new Float64Array(w * h * 3).fill(bg), out = new Uint8ClampedArray(w * h * 4);
  for (const q of parts) {
    const R = boundRadius(q) * scale, x0 = Math.max(0, Math.floor(q.x * scale - R)), x1 = Math.min(w - 1, Math.ceil(q.x * scale + R)), y0 = Math.max(0, Math.floor(q.y * scale - R)), y1 = Math.min(h - 1, Math.ceil(q.y * scale + R));
    const col = [parseInt(q.colour.slice(1, 3), 16), parseInt(q.colour.slice(3, 5), 16), parseInt(q.colour.slice(5, 7), 16)];
    const c = Math.cos(-q.rot), s = Math.sin(-q.rot);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5) / scale - q.x, dy = (y + 0.5) / scale - q.y;
      const a = q.alpha * shapeAlpha(q.shape, (dx * c - dy * s) / q.r, (dx * s + dy * c) / q.r);
      if (a <= 0) continue;
      const i = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) rgb[i + k] = add ? rgb[i + k]! + a * col[k]! : rgb[i + k]! * (1 - a) + a * col[k]!;
    }
  }
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) { out[j] = rgb[i]!; out[j + 1] = rgb[i + 1]!; out[j + 2] = rgb[i + 2]!; out[j + 3] = 255; }
  return out;
}
/** FlashAnalyser verdict over `seconds` of the model drawn on black at a small size. */
function flashVerdict(frameAt: (t: number) => Uint8ClampedArray, seconds: number, w: number, h: number) {
  const an = new FlashAnalyser(FPS);
  for (let f = 0; f < seconds * FPS; f++) an.push(flashCells(frameAt(f / FPS), w, h));
  return an.report();
}

describe('overlay model (ADR-0011)', () => {
  it('is pure: the same arguments give the same particles, and nothing depends on what was computed before', () => {
    for (const [type, over] of ALL) {
      const p = defaults(type, over);
      const a = overlayParticles(type, p, W, H, 12.34, 0.5, null);
      overlayParticles(type, p, W, H, 99, 3, null);
      expect(overlayParticles(type, p, W, H, 12.34, 0.5, null)).toEqual(a);
      expect(a.length).toBeGreaterThan(0);
      expect(JSON.stringify(p)).toBe(JSON.stringify(defaults(type, over))); // the parameters are not changed
    }
  });

  it('a particle moves at most v·dt + its sway speed from one frame to the next', () => {
    const dt = 1 / FPS;
    for (const type of OVERLAY_TYPES) for (const over of [{}, { speed: paramRange(type, 'speed')!.max }, ...(type === 'overlay.snow' ? [{ speed: 1, wind: -1 }] : [])]) {
      const p = defaults(type, over);
      for (const t of [0, 1.5, 61.2, 10800]) for (const s of latticeSites(type, p, W, H, t, null).slice(0, 400)) {
        const next = latticeSite(type, p, W, H, s.l, s.i, s.j, t + dt, null)!;
        const v = Number(p.speed) * DEPTHS[s.l] * H, sway = SWAY * s.c * 2 * Math.PI * 0.8; // sway frequency is at most 0.8 Hz
        expect(Math.hypot(next.particle.x - s.particle.x, next.particle.y - s.particle.y)).toBeLessThanOrEqual(v * dt + sway * dt + 1e-6);
      }
    }
  });

  it('every particle stays inside its own cell (so cells that miss the frame can be skipped), each layer at its cell size cap', () => {
    for (const [type, over] of ALL) {
      if ('mode' in over) continue;
      for (const extreme of [false, true]) {
        const p = defaults(type, extreme ? { ...over, size: paramRange(type, 'size')!.max, density: 1 } : over);
        for (const l of [0, 1, 2] as const) {
          const c = cellSize(type, p, H, l), m = type === 'overlay.bokeh' ? 10 : 6;
          expect(c).toBe(Math.max(H / 40, m * Number(p.size) * DEPTHS[l] * H));
        }
        for (const t of [0, 7.77, 10800]) for (const s of latticeSites(type, p, W, H, t, null)) {
          const reach = boundRadius(s.particle);
          expect(reach).toBeLessThanOrEqual(s.c / 6 + 1e-9);
          expect(Math.abs(s.particle.x - s.cx) + reach).toBeLessThan(s.c / 2);
          expect(Math.abs(s.particle.y - s.cy) + reach).toBeLessThan(s.c / 2);
          expect(Math.abs(s.particle.x - s.cx)).toBeLessThanOrEqual((JITTER + SWAY) * s.c + 1e-9);
        }
      }
    }
  });

  it('the cells that meet the frame are all listed: brute force over a wider block of cells finds no other particle that reaches the frame', () => {
    const type = 'overlay.snow', p = defaults(type, { wind: 0.6 }), t = 3.3;
    const listed = new Set(latticeSites(type, p, W, H, t, null).map((s) => `${s.l}:${s.i}:${s.j}`));
    for (const l of [0, 1, 2] as const) {
      const c = cellSize(type, p, H, l), travel = t * Number(p.speed) * DEPTHS[l] * H;
      const ox = travel * (0.6 / Math.hypot(0.6, 1)), oy = travel / Math.hypot(0.6, 1);
      for (let j = Math.floor(-oy / c) - 3; j <= Math.floor((H - oy) / c) + 3; j++) for (let i = Math.floor(-ox / c) - 3; i <= Math.floor((W - ox) / c) + 3; i++) {
        const s = latticeSite(type, p, W, H, l, i, j, t, null);
        if (!s) continue;
        const r = boundRadius(s.particle), x = s.particle.x, y = s.particle.y;
        if (x + r > 0 && x - r < W && y + r > 0 && y - r < H) expect(listed.has(`${l}:${i}:${j}`)).toBe(true);
      }
    }
  });

  it('density decides the share of cells that hold a particle', () => {
    const type = 'overlay.snow';
    const count = (d: number) => latticeSites(type, defaults(type, { density: d }), W, H, 1, null).length;
    expect(count(0)).toBe(0);
    const half = count(0.5), full = count(1);
    expect(half / full).toBeGreaterThan(0.45);
    expect(half / full).toBeLessThan(0.55);
  });

  it('the same seed continues the same snow across a cut: two clips back to back draw from one model of the timeline time', () => {
    let n = 0;
    const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ov${n++}_`, actor: 'test', allowInternal });
    const asset = { kind: 'image' as const, name: 'a.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: W, height: H, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
    let r = tx(createProject({ id: 'p', name: 'p', width: W, height: H, frameRate: { num: FPS, den: 1 } }), [{ op: 'import_asset', args: { asset } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(0, { num: FPS, den: 1 }), duration: T.frameTime(90, { num: FPS, den: 1 }), withLinkedAudio: false } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'overlay.snow', params: { seed: 42 } } }]);
    const whole = r.doc;
    const cut = tx(whole, [{ op: 'split_clip', args: { clipId, at: T.frameTime(40, { num: FPS, den: 1 }) } }]).doc;
    const env = (doc: ProjectDocument, frame: number) => { const g = evaluate(doc, T.frameTime(frame, { num: FPS, den: 1 })); const l = g.layers[0] as { effects: { type: string; params: Record<string, number | string | boolean> }[] }; return { params: l.effects[0]!.params, seconds: T.toSeconds(g.time) }; };
    for (const frame of [39, 40, 41, 75]) {
      const a = env(whole, frame), b = env(cut, frame);
      expect(b.params).toEqual(a.params);
      expect(overlayParticles('overlay.snow', b.params, W, H, b.seconds, 0, null)).toEqual(overlayParticles('overlay.snow', a.params, W, H, a.seconds, 0, null));
    }
    // and across the cut each flake moves on by one frame's worth only
    const before = env(cut, 39), after = env(cut, 40);
    const p = before.params;
    for (const s of latticeSites('overlay.snow', p, W, H, before.seconds, null).slice(0, 300)) {
      const next = latticeSite('overlay.snow', after.params, W, H, s.l, s.i, s.j, after.seconds, null)!;
      expect(Math.hypot(next.particle.x - s.particle.x, next.particle.y - s.particle.y)).toBeLessThan(Number(p.speed) * H / FPS + SWAY * s.c * 2 * Math.PI * 0.8 / FPS + 1e-6);
    }
  });

  it('three hours into the timeline every particle is finite and inside its cell', () => {
    for (const [type, over] of ALL) {
      if ('mode' in over) continue;
      const p = defaults(type, over);
      const sites = latticeSites(type, p, W, H, 3 * 3600 + 0.0333, null);
      expect(sites.length).toBeGreaterThan(0);
      for (const s of sites) {
        for (const v of [s.particle.x, s.particle.y, s.particle.r, s.particle.rot, s.particle.alpha]) expect(Number.isFinite(v)).toBe(true);
        expect(Math.abs(s.particle.x - s.cx) + boundRadius(s.particle)).toBeLessThan(s.c / 2);
        expect(Math.abs(s.particle.y - s.cy) + boundRadius(s.particle)).toBeLessThan(s.c / 2);
        expect(s.particle.x + boundRadius(s.particle)).toBeGreaterThan(-s.c);
        expect(s.particle.x - boundRadius(s.particle)).toBeLessThan(W + s.c);
      }
    }
  });

  it('the confetti burst closed form matches a numerical integration of its motion (drag k, gravity g) within 1e-6 of the frame height', () => {
    const p = defaults('overlay.confetti', { mode: 'burst', seed: 5 });
    const o = { x: 0.5 * W, y: 0.85 * H };
    const start = burstParticles(p, W, H, 0);
    expect(start).toHaveLength(BURST.pieces);
    for (const q of start) { expect(q.x).toBeCloseTo(o.x, 9); expect(q.y).toBeCloseTo(o.y, 9); }
    // initial velocities from the closed form's derivative at 0 (it is v), then RK4 on dv/dt = −k·v + g·ŷ
    const eps = 1e-7, at = burstParticles(p, W, H, eps);
    for (const a of [0.25, 0.5, 1.0, 1.5]) {
      const closed = burstParticles(p, W, H, a);
      start.forEach((q0, n) => {
        let x = q0.x, y = q0.y, vx = (at[n]!.x - q0.x) / eps, vy = (at[n]!.y - q0.y) / eps;
        // the finite difference above carries the gravity term's O(eps) part; remove it exactly: d/da of the gravity term at 0 is 0
        const steps = 1500, h = a / steps, k = BURST.k, g = BURST.g * H;
        const f = (s: number[]) => [s[2]!, s[3]!, -k * s[2]!, -k * s[3]! + g];
        let st = [x, y, vx, vy];
        for (let i = 0; i < steps; i++) {
          const k1 = f(st), k2 = f(st.map((v, j) => v + (h / 2) * k1[j]!)), k3 = f(st.map((v, j) => v + (h / 2) * k2[j]!)), k4 = f(st.map((v, j) => v + h * k3[j]!));
          st = st.map((v, j) => v + (h / 6) * (k1[j]! + 2 * k2[j]! + 2 * k3[j]! + k4[j]!));
        }
        [x, y] = st as [number, number];
        expect(Math.abs(closed[n]!.x - x) / H).toBeLessThan(1e-6);
        expect(Math.abs(closed[n]!.y - y) / H).toBeLessThan(1e-6);
      });
      for (const q of closed) expect(q.alpha).toBeCloseTo(Number(p.amount) * (1 - a / BURST.fadeSeconds), 12);
    }
    expect(burstParticles(p, W, H, BURST.fadeSeconds)).toEqual([]);
    expect(burstParticles(p, W, H, -0.01)).toEqual([]);
    // the burst follows the clip, not the timeline: fall mode ignores the clip-local time, burst mode ignores the timeline time
    expect(overlayParticles('overlay.confetti', p, W, H, 50, 0.4, null)).toEqual(overlayParticles('overlay.confetti', p, W, H, 3, 0.4, null));
  });

  it('hearts swell on the beat only when they follow the music, and fade toward the top of the frame', () => {
    const steady = defaults('overlay.hearts'), music = defaults('overlay.hearts', { follow: 'music' });
    const beat: BeatPosition = { clipId: 'music', beat: 2, sinceBar: 2, period: 0.5, sinceFirstBar: 2, at: 1, hits: [], followedFrom: 0 };
    const a = overlayParticles('overlay.hearts', steady, W, H, 1, 0, beat), b = overlayParticles('overlay.hearts', music, W, H, 1, 0, beat), c = overlayParticles('overlay.hearts', music, W, H, 1, 0, null);
    expect(a.length).toBe(b.length);
    b.forEach((q, i) => expect(q.r / a[i]!.r).toBeCloseTo(1.25, 9)); // on the hit: phase 0
    expect(c).toEqual(a); // no analysed music: as steady
    for (const q of a) { expect(Math.abs(q.rot)).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-12); if (q.y < 0) expect(q.alpha).toBe(0); }
    const high = a.filter((q) => q.y > 0 && q.y < 0.05 * H), mid = a.filter((q) => q.y > 0.4 * H && q.y < 0.8 * H);
    if (high.length && mid.length) expect(Math.max(...high.map((q) => q.alpha))).toBeLessThan(Math.min(...mid.map((q) => q.alpha)));
  });

  it('bokeh twinkles gently: within 0.7…1 of its strength, and slower than once a second', () => {
    const p = defaults('overlay.bokeh');
    const s0 = latticeSites('overlay.bokeh', p, W, H, 0, null);
    for (const s of s0.slice(0, 50)) {
      const series = Array.from({ length: 300 }, (_, f) => latticeSite('overlay.bokeh', p, W, H, s.l, s.i, s.j, f / FPS, null)!.particle.alpha / (Number(p.amount) * (0.4 + 0.6 * DEPTHS[s.l])));
      for (const v of series) { expect(v).toBeGreaterThanOrEqual(0.7 - 1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
      let turns = 0;
      for (let i = 2; i < series.length; i++) if ((series[i]! - series[i - 1]!) * (series[i - 1]! - series[i - 2]!) < -1e-15) turns++;
      expect(turns).toBeLessThanOrEqual(5); // 10 s: at most one change of direction per 2.5 s knot interval
    }
  });

  it('shapes: the brightest point at the centre (rim for ring and hexagon), nothing outside the reach', () => {
    for (const shape of ['disc', 'rect', 'heart', 'ring', 'hexagon'] as const) {
      expect(shapeAlpha(shape, 0, 0)).toBeCloseTo(CENTRE_GAIN[shape], 9);
      const reach = boundRadius({ r: 1, shape });
      for (let a = 0; a < 2 * Math.PI; a += 0.05) expect(shapeAlpha(shape, (reach + 1e-6) * Math.cos(a), (reach + 1e-6) * Math.sin(a))).toBe(0);
    }
    expect(shapeAlpha('ring', 0.85, 0)).toBeGreaterThan(shapeAlpha('ring', 0.2, 0));
    expect(shapeAlpha('heart', 0, 0.9)).toBe(1); // the point
    expect(shapeAlpha('heart', 0, -0.7)).toBe(0); // the dip between the lobes
  });

  it('speed lines: wedges from the wandering tip radius to beyond the farthest corner; they move smoothly and are never re-rolled', () => {
    const p = defaults('overlay.speed-lines');
    const R = Math.hypot(W, H) / 2;
    const a = speedLines(p, W, H, 2), b = speedLines(p, W, H, 2 + 1 / FPS);
    expect(a.lines).toHaveLength(90);
    a.lines.forEach((s, i) => {
      expect(s.r1).toBeCloseTo(1.1 * R, 9);
      expect(s.r0).toBeGreaterThanOrEqual(Number(p.focus) * R - 1e-9);
      expect(s.r0).toBeLessThanOrEqual((Number(p.focus) + Number(p.reach)) * R + 1e-9);
      expect([b.lines[i]!.a0, b.lines[i]!.a1]).toEqual([s.a0, s.a1]); // the angles never change
      // smoothNoise moves at most 1.5·(its range)/knot per unit: |dr0/dt| ≤ reach·R·0.5·2·1.5·rate
      expect(Math.abs(b.lines[i]!.r0 - s.r0)).toBeLessThanOrEqual(Number(p.reach) * R * 1.5 * Number(p.rate) / FPS + 1e-9);
    });
    const [tip] = wedgeCorners(a.cx, a.cy, a.lines[0]!);
    expect(Math.hypot(tip[0] - W / 2, tip[1] - H / 2)).toBeCloseTo(a.lines[0]!.r0, 9);
    const off = speedLines(defaults('overlay.speed-lines', { x: 1, y: 1 }), W, H, 0);
    expect(off.lines[0]!.r1).toBeCloseTo(1.1 * Math.hypot(W, H), 9); // from a corner the lines still reach the far corner
    expect(speedLines(defaults('overlay.speed-lines', { rate: 0 }), W, H, 5)).toEqual(speedLines(defaults('overlay.speed-lines', { rate: 0 }), W, H, 0));
  });

  // flash safety (ADR-0009 decision 3): the model drawn on black at a small size, three seconds at 30 fps
  const scale = 0.225, fw = Math.round(W * scale), fh = Math.round(H * scale);
  for (const [type, over] of ALL) it(`flash safety: ${type} ${JSON.stringify(over)} at its defaults passes the flash analyser`, () => {
    const p = defaults(type, over);
    const report = flashVerdict((t) => rasterise(overlayParticles(type, p, W, H, t, t, null), fw, fh, scale, type === 'overlay.bokeh'), 3, fw, fh);
    expect(report.verdict, JSON.stringify(report.ranges)).toBe('pass');
  }, 120_000);
  it('flash safety harness: it does see flashing (dense large snow shown on every other pair of frames fails)', () => {
    const p = defaults('overlay.snow', { density: 1, size: 0.04, amount: 1 });
    const report = flashVerdict((t) => (Math.round(t * FPS) % 4 < 2 ? rasterise(overlayParticles('overlay.snow', p, W, H, t, t, null), fw, fh, scale, false) : new Uint8ClampedArray(fw * fh * 4).fill(255).map((v, i) => (i % 4 === 3 ? 255 : 0))), 3, fw, fh);
    expect(report.verdict).toBe('fail');
  }, 120_000);
  it('speed limit: far above the default speed of snow, confetti and hearts for every frame shape from 2:1 to 1:2, so the defaults look as they did', () => {
    for (const [type, over] of [['overlay.snow', {}], ['overlay.confetti', {}], ['overlay.confetti', { palette: 'gold' }], ['overlay.hearts', {}], ['overlay.hearts', { follow: 'music' }]] as const) {
      const p = defaults(type, over);
      for (const [w, h] of [[2560, 1280], [2560, 1080], [1920, 1080], [1440, 1080], [1080, 1080], [1080, 1350], [1080, 1920], [1080, 2160], [320, 180], [180, 320]] as const) {
        expect(speedLimit(type, p, w / h), `${type} ${JSON.stringify(over)} ${w}×${h}`).toBeGreaterThan(2 * Number(p.speed));
        // the drawn speed is the asked one: a cell centre moves on by speed·k·H per second along the direction of motion
        const s0 = latticeSites(type, p, w, h, 2, null)[0]!, s1 = latticeSite(type, p, w, h, s0.l, s0.i, s0.j, 3, null)!;
        expect(Math.hypot(s1.cx - s0.cx, s1.cy - s0.cy)).toBeCloseTo(Number(p.speed) * DEPTHS[s0.l] * h, 6);
      }
    }
    // the light of a particle the limit assumes is that of the drawn shape
    for (const shape of ['disc', 'rect', 'heart'] as const) {
      let light = 0;
      const n = 800, span = 1.2;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) light += shapeAlpha(shape, ((x + 0.5) / n - 0.5) * 2 * span, ((y + 0.5) / n - 0.5) * 2 * span) * (2 * span / n) ** 2;
      expect(SHAPE_LIGHT[shape] / light, shape).toBeCloseTo(1, 2);
    }
    expect(SHAPE_LIGHT.disc).toBe(DISC_LIGHT);
    let disc = 0;
    for (let i = 0; i < 20000; i++) { const r = (i + 0.5) / 20000; disc += (shapeAlpha('disc', r, 0) * 2 * Math.PI * r) / 20000; }
    expect(DISC_LIGHT).toBeCloseTo(disc, 6);
    for (const type of ['overlay.snow', 'overlay.confetti', 'overlay.hearts']) {
      expect(speedLimit(type, defaults(type, { density: 0 }), W / H)).toBe(Infinity);
      expect(speedLimit(type, defaults(type, { amount: 0 }), W / H)).toBe(Infinity);
    }
    expect(speedLimit('overlay.bokeh', defaults('overlay.bokeh', { size: 0.15, speed: 0.2, density: 1, amount: 1 }), W / H)).toBe(Infinity);
    expect(speedLimit('overlay.confetti', defaults('overlay.confetti', { mode: 'burst' }), W / H)).toBe(Infinity);
  });

  it('speed limit: below it the particles move as asked, above it at the limit; it falls as they grow brighter, larger or denser, and a red or dark colour counts more', () => {
    const big = defaults('overlay.snow', { size: 0.04, density: 1, amount: 1, speed: 1 });
    const lim = speedLimit('overlay.snow', big, W / H);
    expect(lim).toBeGreaterThan(0);
    expect(lim).toBeLessThan(0.5); // active at the extremes
    // at or above the limit the particles are those at the limit; below it the speed is untouched
    expect(overlayParticles('overlay.snow', big, W, H, 4.2, 0, null)).toEqual(overlayParticles('overlay.snow', { ...big, speed: lim }, W, H, 4.2, 0, null));
    const slow = { ...big, speed: lim / 2 }, s0 = latticeSites('overlay.snow', slow, W, H, 1, null)[0]!, s1 = latticeSite('overlay.snow', slow, W, H, s0.l, s0.i, s0.j, 2, null)!;
    expect(Math.hypot(s1.cx - s0.cx, s1.cy - s0.cy)).toBeCloseTo((lim / 2) * DEPTHS[s0.l] * H, 6);
    // a limit given by the evaluator wins over the one these parameters would give
    const held = latticeSites('overlay.snow', { ...big, [SPEED_LIMIT]: lim / 4 }, W, H, 1, null)[0]!, held1 = latticeSite('overlay.snow', { ...big, [SPEED_LIMIT]: lim / 4 }, W, H, held.l, held.i, held.j, 2, null)!;
    expect(Math.hypot(held1.cx - held.cx, held1.cy - held.cy)).toBeCloseTo((lim / 4) * DEPTHS[held.l] * H, 6);
    // monotone in what makes a particle able to flash
    for (const type of ['overlay.snow', 'overlay.confetti', 'overlay.hearts']) {
      const at = (over: Record<string, unknown>) => speedLimit(type, defaults(type, { speed: paramRange(type, 'speed')!.max, ...over }), W / H);
      expect(at({ density: 1 }), type).toBeLessThan(at({ density: 0.5 }));
      expect(at({ amount: 1, size: 0.02 }), type).toBeLessThan(at({ amount: 0.5, size: 0.02 }));
      expect(at({ size: 0.02 }), type).toBeLessThan(at({ size: 0.01 }));
    }
    expect(speedLimit('overlay.hearts', defaults('overlay.hearts', { size: 0.02, color: '#FF0000' }), W / H)).toBeLessThan(speedLimit('overlay.hearts', defaults('overlay.hearts', { size: 0.02, color: '#FFFFFF' }), W / H));
    expect(speedLimit('overlay.hearts', defaults('overlay.hearts', { size: 0.02, follow: 'music' }), W / H)).toBeLessThan(speedLimit('overlay.hearts', defaults('overlay.hearts', { size: 0.02 }), W / H));
    // strength: white lightens by at most its opacity; saturated red counts by the red rule; black over white darkens more than its opacity
    expect(strength(0.7, '#FFFFFF')).toBe(0.7);
    expect(strength(0.7, '#FF0000')).toBeCloseTo((0.7 * 320 * RED_STEP_AS) / 20, 9); // a red step (20 of 320) weighs RED_STEP_AS
    expect(RED_STEP_AS).toBeGreaterThan(0.1); // more than a general step: a margin for red
    expect(strength(0.7, '#000000')).toBeGreaterThan(0.7);
    expect(strength(0.7, '#4CC9F0')).toBe(0.7);
    // it depends on the frame's shape, not on its size in pixels (the analyser's cells are fractions of the frame)
    expect(overlayParticles('overlay.snow', big, 1920, 1080, 3, 3, null).map((q) => q.y / 1080)).toEqual(overlayParticles('overlay.snow', big, 1280, 720, 3, 3, null).map((q) => expect.closeTo(q.y / 720, 9)));
    // one particle able to flash per cell per second at most: a third of the analyser's limit of three flashes a second
    expect(FLASH_LIMIT.perSecond).toBe(1);
  });

  it('held parameters: an instance without keys gets the limit of its parameters; with keys, the lowest limit any moment of it reaches and the largest size', () => {
    const fx = (type: string, params: Record<string, unknown>, keys: Record<string, [number, number][]> = {}): EffectInstance => ({
      id: 'fx', type, enabled: true, params: defaults(type, params),
      ...(Object.keys(keys).length ? { keyframes: Object.fromEntries(Object.entries(keys).map(([k, ks]) => [k, ks.map(([at, value]) => ({ time: T.frameTime(at * FPS, { num: FPS, den: 1 }), value, easing: 'ease-in-out' as const }))])) } : {}),
    });
    for (const aspect of [16 / 9, 9 / 16, 1]) {
      const still = fx('overlay.snow', { size: 0.03, density: 0.8, speed: 0.5 });
      expect(heldOverlayParams(still, aspect)).toEqual({ [SPEED_LIMIT]: speedLimit('overlay.snow', still.params, aspect), [LATTICE_SIZE]: 0.03 });
      for (const moving of [
        fx('overlay.snow', { speed: 1 }, { size: [[0, 0.004], [2, 0.04], [3, 0.01]], density: [[0, 0.2], [3, 0.9]], wind: [[0, -1], [3, 1]], amount: [[1, 0.2], [2, 1]] }),
        fx('overlay.confetti', { speed: 1, palette: 'single', color: '#FFFFFF' }, { size: [[0, 0.005], [3, 0.05]], density: [[0, 1], [3, 0.1]] }),
        fx('overlay.hearts', { speed: 0.5 }, { size: [[0, 0.1], [3, 0.01]], amount: [[0, 1], [3, 0.5]] }),
      ]) {
        const held = heldOverlayParams(moving, aspect), limit = held[SPEED_LIMIT] as number;
        expect(held[LATTICE_SIZE]).toBe(Math.max(...moving.keyframes!.size!.map((k) => k.value)));
        expect(limit).toBeGreaterThan(0);
        let lowest = Infinity;
        for (let f = 0; f <= 3 * FPS; f++) {
          const p = { ...effectParamsAt(moving, T.frameTime(f, { num: FPS, den: 1 })), [LATTICE_SIZE]: held[LATTICE_SIZE]! };
          lowest = Math.min(lowest, speedLimit(moving.type, p, aspect));
        }
        expect(limit, `${moving.type} ${aspect}`).toBeLessThanOrEqual(lowest * (1 + 1e-9));
      }
    }
    expect(heldOverlayParams(fx('overlay.bokeh', {}), 1)).toEqual({ [SPEED_LIMIT]: Infinity, [LATTICE_SIZE]: 0.06 });
    expect(heldOverlayParams(fx('overlay.speed-lines', {}), 1)).toEqual({});
    expect(heldOverlayParams(fx('color.adjust', {}), 1)).toEqual({});
  });

  it('a lattice made for a larger size keeps every particle in its cell and only changes how large it is drawn', () => {
    for (const type of OVERLAY_TYPES) {
      const p = defaults(type), grown = { ...p, [LATTICE_SIZE]: paramRange(type, 'size')!.max };
      for (const s of latticeSites(type, grown, W, H, 5.5, null)) {
        expect(s.c).toBe(cellSize(type, grown, H, s.l));
        expect(s.c).toBeGreaterThanOrEqual(cellSize(type, p, H, s.l));
        expect(Math.abs(s.particle.x - s.cx) + boundRadius(s.particle)).toBeLessThan(s.c / 2);
        expect(Math.abs(s.particle.y - s.cy) + boundRadius(s.particle)).toBeLessThan(s.c / 2);
      }
      // a smaller value than the size itself is never used: the cells always hold their particles
      expect(cellSize(type, { ...p, [LATTICE_SIZE]: 0 }, H, 2)).toBe(cellSize(type, p, H, 2));
    }
  });

  // ADR-0009: snow is safe at every setting its schema allows. The extremes (largest flakes, top speed, full density and
  // opacity, either wind) and the mid sizes that flashed worst without the limit, in 16:9 and 9:16, on black and on grey
  // (a translucent flake changes a grey pixel's linear luminance more than a black one's).
  const snowExtremes: [number, number, Record<string, unknown>, number][] = [];
  for (const [w, h] of [[W, H], [H, W]] as const) {
    for (const wind of [-1, 0, 1]) for (const bg of [0, 90]) snowExtremes.push([w, h, { size: 0.04, speed: 1, density: 1, amount: 1, wind }, bg]);
    for (const size of [0.008, 0.012, 0.018, 0.025]) snowExtremes.push([w, h, { size, speed: 1, density: 1, amount: 1 }, 90]);
    snowExtremes.push([w, h, { size: 0.04, speed: 1, density: 0.5, amount: 1 }, 0]);
  }
  for (const [w, h, over, bg] of snowExtremes) it(`flash safety: snow ${JSON.stringify(over)} in ${w}×${h} on ${bg ? 'grey' : 'black'} passes the flash analyser`, () => {
    const p = defaults('overlay.snow', over), sc = 162 / Math.min(w, h), sw = Math.round(w * sc), sh = Math.round(h * sc);
    const report = flashVerdict((t) => rasterise(overlayParticles('overlay.snow', p, w, h, t, t, null), sw, sh, sc, false, bg), 3, sw, sh);
    expect(report.verdict, JSON.stringify(report.ranges)).toBe('pass');
  }, 120_000);
  // ADR-0009, plan §0 (extremes where an item has a rate): confetti and hearts are held the same way. Their mid sizes at top
  // speed flashed: hearts in their own red (the red-flash rule), confetti in one colour, white or red, and the party palette in 9:16;
  // a dark colour over a light picture darkens it more than its opacity says. The bokeh is safe at its top speed at every size.
  const fallExtremes: [string, number, number, Record<string, unknown>, number][] = [];
  for (const [w, h] of [[W, H], [H, W]] as const) {
    for (const size of [0.015, 0.02]) fallExtremes.push(['overlay.hearts', w, h, { size, speed: 0.5, density: 1, amount: 1 }, 0]);
    fallExtremes.push(['overlay.hearts', w, h, { size: 0.015, speed: 0.5, density: 1, amount: 1, color: '#FF0000' }, 0]);
    fallExtremes.push(['overlay.hearts', w, h, { size: 0.1, speed: 0.5, density: 1, amount: 1 }, 0]); // every number at its maximum
    for (const color of ['#FFFFFF', '#FF0000']) fallExtremes.push(['overlay.confetti', w, h, { size: 0.02, speed: 1, density: 1, amount: 1, palette: 'single', color }, 0]);
    fallExtremes.push(['overlay.confetti', w, h, { size: 0.025, speed: 1, density: 1, amount: 1 }, 0]);
    fallExtremes.push(['overlay.confetti', w, h, { size: 0.02, speed: 1, density: 1, amount: 1, palette: 'single', color: '#000000' }, 255]);
    fallExtremes.push(['overlay.bokeh', w, h, { size: 0.06, speed: 0.2, density: 1, amount: 1, color: '#FF0000' }, 0]);
  }
  for (const [type, w, h, over, bg] of fallExtremes) it(`flash safety: ${type} ${JSON.stringify(over)} in ${w}×${h} on ${['black', 'grey', 'white'][bg ? (bg === 255 ? 2 : 1) : 0]} passes the flash analyser`, () => {
    const p = defaults(type, over), sc = 162 / Math.min(w, h), sw = Math.round(w * sc), sh = Math.round(h * sc);
    const report = flashVerdict((t) => rasterise(overlayParticles(type, p, w, h, t, t, null), sw, sh, sc, type === 'overlay.bokeh', bg), 3, sw, sh);
    expect(report.verdict, JSON.stringify(report.ranges)).toBe('pass');
  }, 120_000);
  const ext = { amount: 1, lines: 240, thickness: 2, rate: 2, reach: 1 };
  for (const over of [{}, { ...ext, focus: 1, x: 1, y: 1 }, { ...ext, focus: 0 }]) it(`flash safety: speed lines ${JSON.stringify(over)} pass the flash analyser`, () => {
    const p = defaults('overlay.speed-lines', over), sw = 128, sh = 72;
    const frame = (t: number) => {
      const { cx, cy, lines } = speedLines(p, sw, sh, t);
      const n = Math.max(16, Math.min(240, Math.round(Number(p.lines)))), slot = (2 * Math.PI) / n;
      const bySlot = new Map<number, [number, number][]>();
      for (const s of lines) bySlot.set(Math.floor((s.a0 + s.a1) / 2 / slot), wedgeCorners(cx, cy, s));
      const out = new Uint8ClampedArray(sw * sh * 4);
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        let cover = 0;
        for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
          const px = x + (sx + 0.5) / 2, py = y + (sy + 0.5) / 2;
          const at = Math.floor((((Math.atan2(py - cy, px - cx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / slot);
          if ([at - 1, at, at + 1].some((k) => { const tri = bySlot.get(((k % n) + n) % n); return !!tri && inTri(px, py, tri); })) cover++;
        }
        const v = (cover / 4) * Number(p.amount) * 255, i = (y * sw + x) * 4;
        out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
      }
      return out;
    };
    const report = flashVerdict(frame, 3, sw, sh);
    expect(report.verdict, JSON.stringify(report.ranges)).toBe('pass');
  }, 120_000);
});

/**
 * A project of `w` × `h` with one picture clip from `start` for `length` seconds carrying one overlay, plus keys on its
 * parameters: real ops (add_effect, set_effect_keyframe) and the real evaluator, as preview, stills and exports use them.
 */
function overlayDoc(type: string, params: Record<string, unknown>, keys: Record<string, [number, number][]>, start: number, length: number, w = W, h = H) {
  let n = 0;
  const rate = { num: FPS, den: 1 };
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `ok${n++}_`, actor: 'test', allowInternal });
  const asset = { kind: 'image' as const, name: 'a.png', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(7200, 1), image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };
  let r = tx(createProject({ id: 'p', name: 'p', width: w, height: h, frameRate: rate }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(start * FPS, rate), duration: T.frameTime(length * FPS, rate), withLinkedAudio: false } }]);
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId, type, params } }]);
  const effectId = r.results[0]!.output!.effectId as string;
  const ops: OpCall[] = Object.entries(keys).flatMap(([param, ks]) => ks.map(([at, value]) => ({ op: 'set_effect_keyframe', args: { clipId, effectId, param, time: T.frameTime(at * FPS, rate), value } })));
  if (ops.length) r = tx(r.doc, ops);
  return r.doc;
}
/** The evaluated parameters of the clip's first effect at timeline frame `frame`, with its time in seconds. */
function evaluatedAt(doc: ProjectDocument, frame: number) {
  const g = evaluate(doc, T.frameTime(frame, { num: FPS, den: 1 }));
  const l = g.layers[0] as { effects: { type: string; params: Record<string, number | string | boolean> }[] };
  return { params: l.effects[0]!.params, seconds: T.toSeconds(g.time) };
}

describe('overlay motion is one motion for the whole clip (ADR-0011, ADR-0005)', () => {
  // the reviewer's ramps: a heavier snow, larger flakes, a fade in; a heavier and larger confetti; hearts growing
  const ramps: [string, string, Record<string, unknown>, Record<string, [number, number][]>, number][] = [
    ['snow gets heavier', 'overlay.snow', { size: 0.02, speed: 0.2, density: 0.3 }, { density: [[0, 0.3], [10, 1]] }, 60],
    ['snowflakes grow', 'overlay.snow', { size: 0.008, speed: 0.4, density: 0.8 }, { size: [[0, 0.008], [5, 0.03]] }, 30],
    ['snow fades in', 'overlay.snow', { size: 0.03, speed: 0.6, density: 0.7, amount: 0 }, { amount: [[0, 0], [1, 0.9]] }, 60],
    ['confetti gets heavier and larger', 'overlay.confetti', { size: 0.01, speed: 1, density: 0.3, palette: 'single', color: '#FFFFFF' }, { density: [[0, 0.3], [4, 1]], size: [[0, 0.01], [4, 0.03]] }, 45],
    ['hearts grow', 'overlay.hearts', { size: 0.015, speed: 0.5, density: 1, amount: 1 }, { size: [[0, 0.015], [3, 0.05]] }, 20],
  ];
  for (const [what, type, params, keys, start] of ramps) it(`${what}: every cell moves on by the same step each frame, never faster than asked; a particle by at most v·dt + its sway`, () => {
    const length = Math.max(...Object.values(keys).flat().map(([at]) => at)) + 1;
    const doc = overlayDoc(type, params, keys, start, length);
    const speed = Number(findEffect(type)!.params.parse(params).speed), dt = 1 / FPS;
    const steps: number[] = [];
    for (let f = start * FPS; f + 1 < (start + length) * FPS; f++) {
      const a = evaluatedAt(doc, f), b = evaluatedAt(doc, f + 1);
      let step = -1;
      for (const s of latticeSites(type, a.params, W, H, a.seconds, null).slice(0, 200)) {
        const next = latticeSite(type, b.params, W, H, s.l, s.i, s.j, b.seconds, null);
        if (!next) continue; // fewer particles now: this cell is empty
        const v = speed * DEPTHS[s.l] * H, sway = SWAY * Math.max(s.c, next.c) * 2 * Math.PI * 0.8;
        expect(Math.hypot(next.particle.x - s.particle.x, next.particle.y - s.particle.y), `${what}, frame ${f}`).toBeLessThanOrEqual(v * dt + sway * dt + 1e-6);
        step = Math.max(step, Math.hypot(next.cx - s.cx, next.cy - s.cy) / (DEPTHS[s.l] * H * dt)); // frame heights a second
      }
      if (step >= 0) steps.push(step);
    }
    expect(steps.length).toBeGreaterThan(length * FPS / 2);
    for (const s of steps) expect(s).toBeCloseTo(steps[0]!, 6);
    expect(steps[0]!).toBeLessThanOrEqual(speed + 1e-9);
  }, 120_000);

  it('a heavier snow does not flash: the density ramp through the evaluator passes the flash analyser', () => {
    const doc = overlayDoc('overlay.snow', { size: 0.02, speed: 0.2, density: 0.3 }, { density: [[0, 0.3], [10, 1]] }, 60, 11);
    const sc = 162 / H, sw = Math.round(W * sc), sh = Math.round(H * sc), an = new FlashAnalyser(FPS);
    for (let f = 60 * FPS; f < 71 * FPS; f++) { const e = evaluatedAt(doc, f); an.push(flashCells(rasterise(overlayParticles('overlay.snow', e.params, W, H, e.seconds, 0, null), sw, sh, sc, false), sw, sh)); }
    const report = an.report();
    expect(report.verdict, JSON.stringify(report.ranges)).toBe('pass');
  }, 180_000);

  it('preview, stills and an export of another size or a slightly different shape draw the particles in the same places', () => {
    // exports round their size to even numbers (apps/server export.ts), so a scaled export can differ a little in shape
    for (const [[w, h], [ew, eh], over] of [[[1366, 768], [342, 192], { size: 0.03, density: 0.8, speed: 0.5 }], [[1080, 1351], [1080, 1352], { size: 0.03, density: 0.8, speed: 0.5 }], [[1080, 1351], [540, 676], { size: 0.02, speed: 0.5, density: 1, amount: 1, palette: 'single', color: '#FFFFFF' }]] as const) {
      const type = 'color' in over ? 'overlay.confetti' : 'overlay.snow';
      const doc = overlayDoc(type, over, {}, 0, 610, w, h);
      for (const frame of [3 * FPS, 600 * FPS]) {
        const e = evaluatedAt(doc, frame);
        const own = new Map(latticeSites(type, e.params, w, h, e.seconds, null).map((s) => [`${s.l}:${s.i}:${s.j}`, s]));
        let matched = 0;
        for (const s of latticeSites(type, e.params, ew, eh, e.seconds, null)) {
          const o = own.get(`${s.l}:${s.i}:${s.j}`);
          if (!o) continue;
          matched++;
          expect(Math.abs(s.particle.x / eh - o.particle.x / h), `${w}×${h} against ${ew}×${eh} at frame ${frame}`).toBeLessThan(1e-9);
          expect(Math.abs(s.particle.y / eh - o.particle.y / h), `${w}×${h} against ${ew}×${eh} at frame ${frame}`).toBeLessThan(1e-9);
        }
        expect(matched).toBeGreaterThan(own.size * 0.9);
      }
    }
  }, 60_000);
});

function inTri(x: number, y: number, [a, b, c]: readonly [number, number][]): boolean {
  if (!a || !b || !c) return false;
  const s = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
