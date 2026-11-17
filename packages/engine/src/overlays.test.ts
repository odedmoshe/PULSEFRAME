import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findEffect, paramRange, type BeatPosition, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { BURST, CENTRE_GAIN, DEPTHS, JITTER, OVERLAY_TYPES, SWAY, boundRadius, burstParticles, cellSize, latticeSite, latticeSites, overlayParticles, shapeAlpha, speedLines, wedgeCorners, type Particle } from './overlays.ts';
import { FlashAnalyser, flashCells } from './flashAnalysis.ts';
import { evaluate } from './evaluate.ts';

const defaults = (type: string, over: Record<string, unknown> = {}) => findEffect(type)!.params.parse(over) as Record<string, number | string | boolean>;
const W = 1280, H = 720, FPS = 30;
const ALL = [...OVERLAY_TYPES.map((t) => [t, {}] as const), ['overlay.confetti', { mode: 'burst' }] as const, ['overlay.bokeh', { shape: 'hexagon' }] as const];

/** A coarse rasteriser of the model (source-over, or added light for the bokeh) on black, for the flash check. */
function rasterise(parts: readonly Particle[], w: number, h: number, scale: number, add: boolean): Uint8ClampedArray {
  const rgb = new Float64Array(w * h * 3), out = new Uint8ClampedArray(w * h * 4);
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

function inTri(x: number, y: number, [a, b, c]: readonly [number, number][]): boolean {
  if (!a || !b || !c) return false;
  const s = (p: [number, number], q: [number, number]) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
