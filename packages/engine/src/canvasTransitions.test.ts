/**
 * Canvas2D transition dispatch (ADR-0012): every non-GPU transition id has a kernel, chosen by the registry's kernel name,
 * so no id can fall through to a silent cut; and the geometry of the trend-pack kernels (shapes, colour blocks, slices).
 *
 * The pixels themselves are checked in a real browser by `pnpm proof:trend-transitions` (T1–T8). Here, the kernels run once
 * against a RECORDING TEST DOUBLE of the 2D canvas (labelled MOCK below: it draws nothing, it lists the calls), which shows
 * what each kernel draws from, into which scratch slots, and that it is not the old placeholder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { switchFrame, transitionProgress, TRANSITIONS, type TransitionDef } from '@pulseframe/core';
import { BLOCK_ORDER, blockColors, blockSpans, CANVAS_KERNELS, CANVAS_TRANSITION_SLOT, CANVAS_TRANSITIONS, coverScale, insidePolygon, punchScale, SHAPES, shapeScale, sliceBands, SLICE_BANDS, type CanvasTransitionArgs, type RevealShape } from './canvasTransitions.ts';
import { GPU_TRANSITIONS } from './gpu.ts';
import { scratch, type Buf } from './look.ts';

const rows = TRANSITIONS as readonly TransitionDef[];
const TREND_KERNELS = ['punch', 'blur', 'split', 'shape', 'block', 'slices'] as const;

describe('Canvas2D transition dispatch', () => {
  it('the keys of CANVAS_TRANSITIONS are exactly the non-GPU ids, each with the kernel its registry row names', () => {
    expect(Object.keys(CANVAS_TRANSITIONS).sort()).toEqual(rows.filter((t) => !t.gpu).map((t) => t.id).sort());
    for (const t of rows.filter((x) => !x.gpu)) expect(CANVAS_TRANSITIONS[t.id]!.kernel, t.id).toBe(t.kernel);
    // and no id is both: a GPU id never reaches compositeLayer with a transition
    for (const id of Object.keys(CANVAS_TRANSITIONS)) expect(id in GPU_TRANSITIONS, id).toBe(false);
  });
  it('every kernel name has code', () => {
    for (const [id, c] of Object.entries(CANVAS_TRANSITIONS)) expect(typeof CANVAS_KERNELS[c.kernel], id).toBe('function');
  });
  it('the legacy variants carry what the id named before: dip-white v0 = 1, wipe and push their direction', () => {
    expect(CANVAS_TRANSITIONS['dip-black']!.v).toEqual([0, 0, 0]);
    expect(CANVAS_TRANSITIONS['dip-white']!.v).toEqual([1, 0, 0]);
    for (const kind of ['wipe', 'push'] as const) {
      expect(CANVAS_TRANSITIONS[`${kind}-left`]!.v).toEqual([-1, 0, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-right`]!.v).toEqual([1, 0, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-up`]!.v).toEqual([0, -1, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-down`]!.v).toEqual([0, 1, 0]);
    }
  });
});

// ---------- MOCK: a recording test double of the 2D canvas (no pixels; it lists the calls) ----------
type Call = [string, unknown[]];
class FakeCanvas {
  static made: FakeCanvas[] = [];
  readonly log: Call[] = [];
  private readonly c: Record<string, unknown>;
  constructor(public width: number, public height: number) {
    FakeCanvas.made.push(this);
    const log = this.log, state: Record<string, unknown> = { canvas: this };
    this.c = new Proxy(state, {
      get: (t, k) => (k in t ? t[k as string] : (...args: unknown[]) => { log.push([String(k), args]); }),
      set: (t, k, v) => { t[k as string] = v; log.push([`=${String(k)}`, [v]]); return true; },
    });
  }
  getContext() { return this.c; }
}
class FakePath { readonly points: [number, number][] = []; moveTo(x: number, y: number) { this.points.push([x, y]); } lineTo(x: number, y: number) { this.points.push([x, y]); } closePath() {} }
const draws = (log: Call[]) => log.filter(([op]) => op === 'drawImage').map(([, a]) => a[0]);

describe('the trend-pack kernels (run against the recording MOCK)', () => {
  beforeAll(() => { vi.stubGlobal('OffscreenCanvas', FakeCanvas); vi.stubGlobal('Path2D', FakePath); });
  afterAll(() => { vi.unstubAllGlobals(); });
  let size = 40;
  /** One kernel run on a frame size no earlier run used, so the scratch buffers it creates are its own. */
  function run(id: string, progress: number, withOutgoing = true, extra: Partial<CanvasTransitionArgs['t']> = {}) {
    const W = size++, H = 2 * W;
    const frame = new FakeCanvas(W, H), incoming = new FakeCanvas(W, H), outgoing = new FakeCanvas(W, H);
    const before = FakeCanvas.made.length;
    const c = CANVAS_TRANSITIONS[id]!;
    CANVAS_KERNELS[c.kernel]!({
      ctx: frame.getContext() as unknown as OffscreenCanvasRenderingContext2D,
      incoming: { canvas: incoming, ctx: incoming.getContext() } as unknown as Buf,
      outgoing: withOutgoing ? ({ canvas: outgoing, ctx: outgoing.getContext() } as unknown as Buf) : null,
      t: { type: id as never, progress, role: 'in', light: 0, color: null, seed: 0, frame: 7, frames: 15, fps: 30, ...extra }, v: c.v, W, H,
    });
    const created = FakeCanvas.made.slice(before);
    // the slots the kernel used: scratch() hands back the same buffer for the same slot and size
    const slot6 = scratch(6, W, H).canvas as unknown as FakeCanvas, slot13 = scratch(CANVAS_TRANSITION_SLOT, W, H).canvas as unknown as FakeCanvas;
    return { frame, incoming, outgoing, created, slot6, slot13 };
  }

  it('no placeholder remains: every trend-pack kernel is its own code, mixes in slot 6, draws onto the frame once, and uses no slot but 6 and 13', () => {
    const fns = TREND_KERNELS.map((k) => CANVAS_KERNELS[k]);
    expect(new Set(fns).size).toBe(TREND_KERNELS.length);
    for (const legacy of ['dissolve', 'zoom', 'dip', 'wipe', 'push']) expect(fns).not.toContain(CANVAS_KERNELS[legacy]);
    for (const id of Object.keys(CANVAS_TRANSITIONS).filter((x) => (TREND_KERNELS as readonly string[]).includes(CANVAS_TRANSITIONS[x]!.kernel))) {
      for (const p of [0.2, 0.5, 0.8]) {
        const r = run(id, p);
        // the old placeholder drew the incoming picture straight onto the frame; every kernel now draws its mix (slot 6) once
        expect(draws(r.frame.log), `${id} p=${p}`).toEqual([r.slot6]);
        for (const c of r.created) expect([r.slot6, r.slot13], `${id} p=${p}: a scratch slot other than 6 and 13`).toContain(c);
        expect(r.slot6.log.some(([op]) => op === 'drawImage' || op === 'fillRect'), `${id} p=${p}`).toBe(true);
      }
    }
  });

  it('each kernel draws from the side its rule names', () => {
    // punch: the outgoing picture before the switch, the incoming one from it on; four smear copies added up in slot 13
    for (const [p, side] of [[0.3, 'outgoing'], [0.5, 'incoming'], [0.7, 'incoming']] as const) {
      const r = run('punch-in', p);
      expect(draws(r.slot13.log)).toEqual(Array(4).fill(r[side]));
      const upToDraw = r.slot13.log.slice(0, r.slot13.log.findIndex(([op]) => op === 'drawImage'));
      expect(upToDraw.filter(([op]) => op === '=globalCompositeOperation').at(-1)![1]).toEqual(['lighter']); // added up, not painted over
      expect(upToDraw.filter(([op]) => op === '=globalAlpha').at(-1)![1]).toEqual([0.25]);
    }
    // punch-out: the blurred full-size copy behind (in slot 6), then the smear
    const out = run('punch-out', 0.3);
    expect(draws(out.slot6.log)).toEqual([out.outgoing, out.outgoing, out.slot13]);
    expect(out.slot6.log.some(([op, a]) => op === '=filter' && String(a[0]).startsWith('blur('))).toBe(true);
    // no previous clip: nothing until the switch (the layers below show), then the incoming picture
    expect(draws(run('punch-in', 0.3, false).frame.log)).toEqual([]);
    // blur dissolve: both sides, sharp then blurred, mixed by alpha
    const b = run('blur-dissolve', 0.5);
    expect(draws(b.slot13.log)).toEqual([b.outgoing, b.outgoing, b.incoming, b.incoming]); // each side: sharp, then blurred over it
    expect(b.slot13.log.filter(([op, a]) => op === '=filter' && String(a[0]).startsWith('blur(')).length).toBe(2);
    expect(draws(b.slot6.log)).toEqual([b.slot13, b.slot13]);
    const mixed = b.slot6.log.slice(b.slot6.log.findIndex(([op]) => op === 'clearRect') + 1);
    expect(mixed.filter(([op]) => op === '=globalAlpha').map(([, a]) => a[0]).slice(0, 2)).toEqual([0.5, 0.5]); // (1 − p) and p
    // split: the incoming picture, then the two halves of the outgoing one
    const s = run('split-open-h', 0.5);
    expect(draws(s.slot6.log)).toEqual([s.incoming, s.outgoing, s.outgoing]);
    // blocks: the outgoing picture before the switch, the incoming one from it on, and the bars over it
    const early = run('block-left', 0.3);
    expect(draws(early.slot6.log)).toEqual([early.outgoing]);
    const k = run('block-right', 0.5);
    expect(draws(k.slot6.log)).toEqual([k.incoming]);
    expect(k.slot6.log.filter(([op]) => op === 'fillRect').length).toBe(3);
    // shape: the outgoing picture, the incoming one inside the clip, and a rim only when a colour is set
    const h = run('shape-heart', 0.5);
    expect(draws(h.slot6.log)).toEqual([h.outgoing, h.incoming]);
    expect(h.slot6.log.some(([op]) => op === 'clip')).toBe(true);
    expect(h.slot6.log.some(([op]) => op === 'stroke')).toBe(false);
    expect(run('shape-star', 0.5, true, { color: '#FFFFFF' }).slot6.log.some(([op]) => op === 'stroke')).toBe(true);
    // slices: 12 bands, each from one side (a shifted band is drawn twice, wrapped around)
    const sl = run('slices-v', 0.5);
    const bands = draws(sl.slot6.log);
    expect(bands.length >= SLICE_BANDS && bands.length <= 2 * SLICE_BANDS).toBe(true);
    expect(bands.every((x) => x === sl.incoming || x === sl.outgoing)).toBe(true);
  });
});

// ---------- geometry ----------
const SHAPE_NAMES: RevealShape[] = ['heart', 'star'];
/** A deterministic stream of numbers in [0, 1) (mulberry32). */
const rng = (a: number) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

describe('reveal shapes', () => {
  it('each shape is star-shaped about its centre: the centre lies on the inner side of every edge (the polygon kernel)', () => {
    for (const name of SHAPE_NAMES) {
      const pts = SHAPES[name].points;
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!; area += x0 * y1 - x1 * y0; }
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0] = pts[i]!, [x1, y1] = pts[(i + 1) % pts.length]!;
        // the signed distance of the centre (0, 0) from the edge's line, on the polygon's inner side
        const inner = (Math.sign(area) * ((x1 - x0) * (0 - y0) - (y1 - y0) * (0 - x0))) / Math.hypot(x1 - x0, y1 - y0);
        expect(inner, `${name} edge ${i}`).toBeGreaterThan(0.1);
      }
      expect(insidePolygon(pts, 0, 0)).toBe(true);
    }
    expect(SHAPES.heart.points.length).toBe(128);
    expect(SHAPES.star.points.length).toBe(10);
    // upright: the heart's notch and the star's top point are straight above the centre
    expect(SHAPES.heart.notch![0]).toBeCloseTo(0, 12);
    expect(SHAPES.heart.notch![1]).toBeLessThan(0);
    expect(SHAPES.star.points[0]![0]).toBeCloseTo(0, 12);
    expect(SHAPES.star.points[0]![1]).toBeLessThan(0);
    // just above the heart's notch, between its lobes, is outside; just below it is inside
    expect(insidePolygon(SHAPES.heart.points, 0, SHAPES.heart.notch![1] - 3)).toBe(false);
    expect(insidePolygon(SHAPES.heart.points, 0, SHAPES.heart.notch![1] + 0.5)).toBe(true);
  });

  it('coverScale contains the 4 corners at 16:9 and 9:16, and is the least scale that does', () => {
    for (const name of SHAPE_NAMES) for (const [W, H] of [[1920, 1080], [1080, 1920], [640, 360], [360, 640], [180, 101], [101, 180], [500, 500]] as const) {
      const s = coverScale(name, W, H), pts = SHAPES[name].points;
      const corners = (k: number) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => insidePolygon(pts, (x! * W) / 2 / k, (y! * H) / 2 / k));
      expect(corners(s), `${name} ${W}x${H}`).toEqual([true, true, true, true]);
      expect(corners(s * 0.999).includes(false), `${name} ${W}x${H}: not the least`).toBe(true);
      expect(coverScale(name, W, H)).toBe(s); // cached
      // drawn at 1.04·p·coverScale, the shape covers the frame from p = 1/1.04 on, and leaves the corners out at the middle
      expect(shapeScale(name, 1 / 1.04, W, H)).toBeCloseTo(s, 9);
      expect(corners(shapeScale(name, 0.5, W, H))).toEqual([false, false, false, false]);
    }
  });

  it('scaled hearts and stars are nested: s1 < s2 means inside, checked on 10k sample points', () => {
    for (const name of SHAPE_NAMES) {
      const pts = SHAPES[name].points, next = rng(name === 'heart' ? 7 : 11), R = name === 'heart' ? 16 : 1;
      let insideSmall = 0;
      for (let i = 0; i < 10000; i++) {
        const x = (next() * 2 - 1) * R, y = (next() * 2 - 1) * R;
        const a = 0.5 + next(), b = a * (1 + 1e-6 + next()); // s1 = a < s2 = b
        if (insidePolygon(pts, x / a, y / a)) { insideSmall++; expect(insidePolygon(pts, x / b, y / b), `${name} (${x}, ${y}) ${a} < ${b}`).toBe(true); }
      }
      expect(insideSmall).toBeGreaterThan(1000); // the sample really tests the claim
    }
  });
});

describe('colour blocks', () => {
  const covered = (spans: [number, number][]) => {
    // length of the union of the bars on [0, 1]
    const s = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let total = 0, end = -Infinity;
    for (const [a, b] of s) { if (b > end) { total += b - Math.max(a, end); end = b; } }
    return total;
  };
  it('block covers the whole frame on the switch frame for n = 1..150 (with and without a beat lock), and nothing at p >= 0.92', () => {
    const bad: string[] = [];
    for (let n = 1; n <= 150; n++) for (let k: number | null = null; k === null || k <= n - 1; k = k === null ? (n >= 3 ? 1 : n) : k + 1) {
      const sw = switchFrame(n, k);
      const at = (l: number) => blockSpans(transitionProgress(l, n, k), l, n);
      if (covered(at(sw)) !== 1) bad.push(`switch not covered: n=${n} k=${k}`);
      // before the switch the bars only grow, after it they only shrink, and every bar leaves by p = 0.92
      let prev = -1;
      for (let l = 0; l < n; l++) {
        const p = transitionProgress(l, n, k), c = covered(at(l));
        if (l <= sw ? c < prev - 1e-12 : c > prev + 1e-12) bad.push(`not monotone: n=${n} k=${k} l=${l}`);
        if (p >= 0.92 && c !== 0) bad.push(`still covering at p=${p}: n=${n} k=${k} l=${l}`);
        prev = c;
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
    for (let i = 0; i <= 100; i++) {
      const p = 0.92 + (0.08 * i) / 100;
      for (const [frame, frames] of [[undefined, undefined], [3, 7], [20, 30], [1, 2]] as const) expect(covered(blockSpans(p, frame, frames)), `p=${p}`).toBe(0);
    }
  });
  it('every bar colour shows: bar 0 (in front) is drawn at the bottom, each later bar over it, and each is visible somewhere while the bars cross', () => {
    // the colour on top at q: the last bar in drawing order whose span holds q
    const topAt = (spans: [number, number][], q: number) => { let top = -1; for (const i of BLOCK_ORDER) { const [a, b] = spans[i]!; if (q >= a && q <= b) top = i; } return top; };
    const shown = new Set<number>();
    for (let l = 0; l < 29; l++) { const s = blockSpans(transitionProgress(l, 29, null), l, 29); for (let q = 0; q <= 1; q += 0.01) shown.add(topAt(s, q)); }
    expect([...shown].filter((i) => i >= 0).sort()).toEqual([0, 1, 2]);
    // entering at p = 0.3: from the start side, c·0.6 (bar 2), then c·0.8, then c at the front edge
    const s = blockSpans(0.3, 9, 29);
    expect([topAt(s, 0.1), topAt(s, 0.5), topAt(s, 0.58), topAt(s, 0.7)]).toEqual([2, 1, 0, -1]);
  });
  it('the plan\'s edges where the switch lands on 0.5: bar i leads from p = 0.06·i, trails from 0.5 + 0.06·(2 − i), and the front bar is the colour itself', () => {
    // an odd length without a beat lock switches exactly on 0.5: the edges are the plan's formula
    const p = 0.3, s = blockSpans(p, 3, 29);
    for (let i = 0; i < 3; i++) expect(s[i]![1]).toBeCloseTo(Math.min(1, Math.max(0, (p - 0.06 * i) / (0.5 - 0.06 * i))), 12);
    const q = 0.75, t = blockSpans(q, 20, 29);
    for (let i = 0; i < 3; i++) expect(t[i]![0]).toBeCloseTo(Math.min(1, Math.max(0, (q - 0.5 - 0.06 * (2 - i)) / (0.42 - 0.06 * (2 - i)))), 12);
    expect(blockColors('#3DE0C8')).toEqual(['rgb(61,224,200)', 'rgb(49,179,160)', 'rgb(37,134,120)']);
  });
});

describe('velocity slices', () => {
  it('t_b lies in [0.2, 0.8]; the same seed gives the same offsets; seeds 1 and 2 differ', () => {
    for (let seed = 0; seed <= 9999; seed += 37) {
      const bands = sliceBands(seed);
      expect(bands.length).toBe(12);
      for (const b of bands) { expect(b.at >= 0.2 && b.at <= 0.8, `seed ${seed}`).toBe(true); expect(Math.abs(b.offset) <= 0.175, `seed ${seed}`).toBe(true); }
    }
    expect(sliceBands(9999)).toEqual(sliceBands(9999));
    expect(sliceBands(1)).toEqual(sliceBands(1));
    const one = sliceBands(1), two = sliceBands(2);
    expect(one.filter((b, i) => b.offset !== two[i]!.offset).length).toBeGreaterThan(9);
    expect(one.filter((b, i) => b.at !== two[i]!.at).length).toBeGreaterThan(9);
    // the hash is the twin of the WGSL one (gpu.ts `fn hash`, `fn unit`): checked against an independent u32 implementation in BigInt
    const M = 0xffffffffn;
    const wgslHash = (x: bigint) => { const v = (x * 747796405n + 2891336453n) & M; const w = (((v >> ((v >> 28n) + 4n)) ^ v) * 277803737n) & M; return (w >> 22n) ^ w; };
    const wgslUnit = (x: bigint) => Number(x >> 8n) / 16777216;
    for (const seed of [0, 1, 2, 777, 9999]) sliceBands(seed).forEach((band, b) => {
      expect(band.offset).toBe((wgslUnit(wgslHash((BigInt(b) * 7919n + 13n + BigInt(seed) * 104729n) & M)) - 0.5) * 0.35);
      expect(band.at).toBe(0.2 + 0.6 * wgslUnit(wgslHash((BigInt(b) * 31n + 7n + BigInt(seed) * 130363n) & M)));
    });
  });
  it('punch: the picture grows to 1.18× into the switch and settles from 1.22× (in); shrinks to 0.85× and returns from 0.82× (out)', () => {
    expect(punchScale(0.5 - 1e-12, 1)).toBeCloseTo(1.18, 9);
    expect(punchScale(0.5, 1)).toBeCloseTo(1.22, 12);
    expect(punchScale(0.5 - 1e-12, -1)).toBeCloseTo(0.85, 9);
    expect(punchScale(0.5, -1)).toBeCloseTo(0.82, 12);
    expect(punchScale(1e-9, 1)).toBeCloseTo(1, 9);
    expect(punchScale(1 - 1e-9, -1)).toBeCloseTo(1, 9);
  });
});
