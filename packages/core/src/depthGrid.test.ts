/**
 * depthGrid (wave 8 living, W1): the integer rasteriser of a drawn depth. Golden SHA-256 digests recorded from this build's Node run
 * (the proof's check 9 compares the page's digest with Node's); the numbers below that are not digests are computed by hand from the
 * contract's rules. Synthetic depths only; nobody has looked at a grid.
 */
import { createHash } from 'node:crypto';
import { loadavg } from 'node:os';
import { describe, expect, it } from 'vitest';
import { DEPTH_FALLOFF, depthGrid, depthGridSize, MAX_DEPTH_NUMBERS, MAX_DEPTH_STROKES, MAX_STROKE_NUMBERS, type ClipDepth } from './index.ts';

const sha = (g: { data: Uint8Array }) => createHash('sha256').update(g.data).digest('hex');
const HD = { width: 1920, height: 1080 };
const RAMP: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 400 }, strokes: [] };
const DAB: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 300, pts: [500, 500] }] };
/** 64 strokes of 64 points (8192 numbers), the largest brush, zig-zagging across the whole picture: the worst case. */
const CAPS: ClipDepth = {
  v: 1, base: { kind: 'ramp', horizon: 300 },
  strokes: Array.from({ length: MAX_DEPTH_STROKES }, (_, s) => ({
    layer: s % 2 ? 'far' as const : 'near' as const, size: 300,
    pts: Array.from({ length: MAX_DEPTH_NUMBERS / MAX_DEPTH_STROKES }, (_, k) => (k % 2 ? ((k * 37 + s * 101) % 1001) : (k % 4 === 0 ? 0 : 1000))),
  })),
};

describe('depthGrid', () => {
  it('the grid has depthGridSize cells, one byte each', () => {
    for (const shown of [HD, { width: 1080, height: 1920 }, { width: 640, height: 480 }, { width: 5000, height: 100 }]) {
      const g = depthGrid(RAMP, shown);
      expect([g.width, g.height]).toEqual([depthGridSize(shown).width, depthGridSize(shown).height]);
      expect(g.data).toBeInstanceOf(Uint8Array);
      expect(g.data.length).toBe(g.width * g.height);
    }
  });
  it('the ramp: 0 down to the horizon, then round half up of 255·(yc − h)/(1000 − h) at the integer row centre; every row even', () => {
    const g = depthGrid(RAMP, HD); // 256 × 144
    const at = (x: number, y: number) => g.data[y * g.width + x]!;
    // row 57: yc = round((115·1000)/288) = round(399.3) = 399 ≤ 400 → 0; row 58: yc = round(117000/288) = round(406.25) = 406 → round(255·6/600) = round(2.55) = 3
    expect([at(0, 57), at(255, 57), at(0, 58), at(200, 58)]).toEqual([0, 0, 3, 3]);
    // last row: yc = round(287000/288) = round(996.53) = 997 → round(255·597/600) = round(253.725) = 254
    expect(at(10, 143)).toBe(254);
    for (let y = 0; y < g.height; y++) for (let x = 1; x < g.width; x++) if (at(x, y) !== at(0, y)) throw new Error(`row ${y} not even`);
    for (let y = 1; y < g.height; y++) expect(at(0, y)).toBeGreaterThanOrEqual(at(0, y - 1));
  });
  it('a flat base with one near dab: 255 inside half the radius, the frozen falloff steps beyond, 0 at the radius and outside', () => {
    const g = depthGrid(DAB, HD); // radius 300/1000 of 144 = 43.2 cells around (128, 72)
    const at = (x: number, y: number) => g.data[y * g.width + x]!;
    expect(at(128, 72)).toBe(255);
    expect(at(127, 72)).toBe(255);
    expect(at(128 + 21, 72)).toBe(255); // centre distance 21.5 cells ≤ 21.6
    expect(at(0, 0)).toBe(0);
    expect(at(128 + 44, 72)).toBe(0); // 44.5 cells ≥ 43.2
    // between: each value is (0·(256 − w) + 255·w + 128) >> 8 for a weight w of the table
    const allowed = new Set(DEPTH_FALLOFF.map((w) => (255 * w + 128) >> 8));
    for (const v of g.data) expect(allowed.has(v)).toBe(true);
    // symmetric about the dab's centre cell pair (the dab sits on a cell edge: x 128000 = between cells 127 and 128)
    for (let d = 0; d < 50; d++) expect(at(128 + d, 72)).toBe(at(127 - d, 72));
    // monotone outward
    for (let d = 1; d < 50; d++) expect(at(128 + d, 72)).toBeLessThanOrEqual(at(128 + d - 1, 72));
  });
  it('strokes: swept along segments, later over earlier, far paints toward 0 over a ramp', () => {
    const line: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 20, pts: [100, 500, 900, 500] }] };
    const g = depthGrid(line, HD);
    const row = 72;
    for (const x of [26, 64, 128, 200, 229]) expect(g.data[row * 256 + x]).toBe(255); // along the whole segment
    expect(g.data[10 * 256 + 128]).toBe(0);
    const over: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 0 }, strokes: [...line.strokes, { layer: 'far', size: 20, pts: [500, 500] }] };
    const o = depthGrid(over, HD);
    expect(o.data[row * 256 + 128]).toBe(0); // the far dab, laid last, wins at its centre
    expect(o.data[row * 256 + 40]).toBe(255);
    expect(o.data[140 * 256 + 128]).toBeGreaterThan(200); // the ramp below
  });
  it('golden SHA-256 (this build, Node): the ramp at 16:9, the flat base with one dab, 64 strokes at the caps; the same bytes twice', () => {
    expect(CAPS.strokes.every((s) => s.pts.length <= MAX_STROKE_NUMBERS)).toBe(true);
    expect(CAPS.strokes.reduce((n, s) => n + s.pts.length, 0)).toBe(MAX_DEPTH_NUMBERS);
    const digests = { ramp: sha(depthGrid(RAMP, HD)), dab: sha(depthGrid(DAB, HD)), caps: sha(depthGrid(CAPS, HD)) };
    expect(digests).toEqual(GOLDEN);
    expect(sha(depthGrid(CAPS, HD))).toBe(digests.caps);
    expect(sha(depthGrid(structuredClone(DAB), { width: 3840, height: 2160 }))).toBe(digests.dab); // only the aspect counts
  }, 60_000);
  it('the worst case (64 strokes × 64 points, largest brush, zig-zag across) once: under 3 s of this process\'s CPU time, wall time printed beside it (one sample on a machine shared by many agents)', () => {
    const t0 = performance.now(), c0 = process.cpuUsage();
    depthGrid(CAPS, HD);
    const cpu = process.cpuUsage(c0), ms = performance.now() - t0, cpuMs = (cpu.user + cpu.system) / 1000;
    console.log(`depthGrid worst case: ${cpuMs.toFixed(0)} ms CPU, ${ms.toFixed(0)} ms wall (one sample; load average ${loadavg()[0]!.toFixed(1)})`);
    expect(cpuMs).toBeLessThan(3000);
  }, 20_000);
});

/**
 * A slow reference of the same rules, written apart from depthGrid.ts: every cell of the grid against every segment, no bounding.
 * It checks that the row bounds the fast version uses never leave out a cell that the integer rule would paint.
 */
function reference(depth: ClipDepth, shown: { width: number; height: number }): Uint8Array {
  const { width: W, height: H } = depthGridSize(shown), S = Math.min(W, H);
  const rnd = (a: number, b: number) => Math.floor((2 * a + b) / (2 * b));
  const out = new Uint8Array(W * H);
  if (depth.base.kind === 'ramp') for (let y = 0; y < H; y++) { const yc = rnd((2 * y + 1) * 1000, 2 * H), h = depth.base.horizon; out.fill(yc <= h ? 0 : rnd(255 * (yc - h), 1000 - h), y * W, (y + 1) * W); }
  for (const s of depth.strokes) {
    const R = s.size * S, v = s.layer === 'near' ? 255 : 0, n = s.pts.length / 2;
    const P = Array.from({ length: n }, (_, k) => [s.pts[2 * k]! * W, s.pts[2 * k + 1]! * H] as const);
    const segs: [readonly [number, number], readonly [number, number]][] = n === 1 ? [[P[0]!, P[0]!]] : P.slice(1).map((b, k) => [P[k]!, b]);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let best = 0;
      for (const [[ax, ay], [bx, by]] of segs) {
        const px = (2 * i + 1) * 500 - ax, py = (2 * j + 1) * 500 - ay, ux = bx - ax, uy = by - ay, L2 = ux * ux + uy * uy;
        const dot = px * ux + py * uy;
        const t = L2 === 0 || dot <= 0 ? 0 : dot >= L2 ? 4096 : Math.floor((dot * 4096) / L2);
        const dx = px - Math.floor((ux * t + 2048) / 4096), dy = py - Math.floor((uy * t + 2048) / 4096), d2 = dx * dx + dy * dy;
        let w = 0;
        if (4 * d2 <= R * R) w = 256;
        else if (d2 < R * R) { let k = 0; while (k < 15 && 1024 * d2 >= (17 + k) * (17 + k) * R * R) k++; w = DEPTH_FALLOFF[k]!; }
        best = Math.max(best, w);
      }
      if (best) out[j * W + i] = (out[j * W + i]! * (256 - best) + v * best + 128) >> 8;
    }
  }
  return out;
}

describe('depthGrid against a slow reference', () => {
  it('random strokes of every size and direction (dabs, horizontal, vertical, diagonal, back on themselves): the same bytes', () => {
    let seed = 7;
    const r = (n: number) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % n; };
    for (let trial = 0; trial < 12; trial++) {
      const strokes = Array.from({ length: 1 + r(4) }, () => {
        const kind = r(5), k = 1 + r(5), x = r(1001), y = r(1001);
        const pts = Array.from({ length: k }, (_, q) => kind === 0 ? [x, y] : kind === 1 ? [r(1001), y] : kind === 2 ? [x, r(1001)] : kind === 3 ? [q % 2 ? x : 1000 - x, q % 2 ? y : 1000 - y] : [r(1001), r(1001)]).flat();
        return { layer: r(2) ? 'near' as const : 'far' as const, size: 5 + r(296), pts };
      });
      const depth: ClipDepth = { v: 1, base: r(2) ? { kind: 'ramp', horizon: r(1000) } : { kind: 'flat' }, strokes };
      const shown = [HD, { width: 1080, height: 1920 }, { width: 400, height: 300 }][trial % 3]!;
      expect(Buffer.from(depthGrid(depth, shown).data).equals(Buffer.from(reference(depth, shown))), `trial ${trial}`).toBe(true);
    }
  }, 120_000);
});

const GOLDEN = {
  ramp: '0bb59c59848eb069230a956ca93e2fb0de8209676fc37ea25fd2403b20b6fdb8',
  dab: '2d696fdca3d467dc5b3eaa0a8a1f74fc052ea78500e3afa6c53c6c0445948cb4',
  caps: '1c0273095382988333e2f2b5ae487cea460737ed9be65cbad9c5de537f95bf75',
};
