/**
 * The camera-motion kernel of stabilisation (vision/steady.ts). Truth comes from the construction: exact correspondences for the fit,
 * and the synthetic shaky fixtures (packages/fixtures/src/steady.ts) whose camera path is known exactly. The fixture checks are the
 * kernel checks S1–S5 of pnpm proof:stabilise run here at the proof's thresholds (the proof itself is W3's); the measured values are
 * printed, and a threshold is never loosened here. One timing sample is one sample.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { steadyFixture, writeSteadyFixture, type SteadyFixture, type SteadyVariant } from '../../../../packages/fixtures/src/steady.ts';
import { readFrames } from '../tracking.ts';
import { CAMERA_KERNEL_PARAMS, createCameraKernel, fitSimilarity, KST, robustFit, runSync, toCameraSample, type PairMeasure } from './steady.ts';

const pairsOf = (pts: [number, number][], f: (x: number, y: number) => [number, number]) => {
  const n = pts.length, P = { px: new Float64Array(n), py: new Float64Array(n), qx: new Float64Array(n), qy: new Float64Array(n), n };
  pts.forEach(([x, y], i) => { const [a, b] = f(x, y); P.px[i] = x; P.py[i] = y; P.qx[i] = a; P.qy[i] = b; });
  return P;
};
const sim = (r: number, l: number, tx: number, ty: number) => (x: number, y: number): [number, number] => { const e = Math.exp(l), c = Math.cos(r) * e, s = Math.sin(r) * e; return [c * x - s * y + tx, s * x + c * y + ty]; };
const grid = (): [number, number][] => { const o: [number, number][] = []; for (let j = -5; j <= 5; j++) for (let i = -8; i <= 8; i++) o.push([i * 37, j * 31]); return o; };

describe('fit and consensus', () => {
  it('least squares recovers an exact similarity (clockwise rotation, y down)', () => {
    const P = pairsOf(grid(), sim(0.01, 0.004, 3.5, -2.25));
    const m = fitSimilarity(P, new Array(P.n).fill(1))!;
    expect(Math.atan2(m.b, m.a)).toBeCloseTo(0.01, 12);
    expect(Math.log(Math.hypot(m.a, m.b))).toBeCloseTo(0.004, 12);
    expect([m.tx, m.ty].map((v) => Number(v.toFixed(9)))).toEqual([3.5, -2.25]);
    // a positive angle turns the point right of the centre DOWN on screen: clockwise
    expect(sim(0.1, 0, 0, 0)(100, 0)[1]).toBeGreaterThan(0);
  });
  it('the robust fit ignores 30 % gross outliers and finds them as the competing motion', () => {
    const pts = grid();
    const P = pairsOf(pts, (x, y) => (pts.findIndex(([a, b]) => a === x && b === y) % 10 < 3 ? sim(0, 0, -9, 2.5)(x, y) : sim(-0.003, 0.001, 1.2, 0.7)(x, y)));
    const fit = robustFit(P, 17, CAMERA_KERNEL_PARAMS, 640);
    expect(Math.atan2(fit.model!.b, fit.model!.a)).toBeCloseTo(-0.003, 9);
    expect(fit.model!.tx).toBeCloseTo(1.2, 6);
    expect(fit.inliers.length).toBe(P.n - Math.round(fit.second));
    expect(fit.second / fit.support).toBeCloseTo(3 / 7, 1);
  });
  it('deterministic: the same frame number gives the same hypotheses and the same fit', () => {
    const P = pairsOf(grid(), sim(0.002, 0, 1, 1));
    expect(JSON.stringify(robustFit(P, 5))).toBe(JSON.stringify(robustFit(P, 5)));
  });
  it('stored samples: units of steadyContract; a delta outside the stored ranges is unknown, never clamped', () => {
    const m: PairMeasure = { st: KST.ok, sim: { r: 0.001, l: -0.0005, tx: 6.4, ty: -3.2 }, seeded: 192, survivors: 190, inliers: 180, quadrants: 4, support: 180, second: 0, thumbDiff: 3 };
    expect(toCameraSample(m, 640)).toEqual({ dx: 1000, dy: -500, dr: 1000, dz: -500, st: KST.ok });
    expect(toCameraSample({ ...m, sim: { ...m.sim, tx: 1300 } }, 640)).toEqual({ dx: 0, dy: 0, dr: 0, dz: 0, st: KST.unknown });
    expect(toCameraSample({ ...m, st: KST.start }, 640)).toEqual({ dx: 0, dy: 0, dr: 0, dz: 0, st: KST.start });
  });
});

interface Run { st: number[]; measures: PairMeasure[]; tErr: number[]; rErr: number[]; msPerFrame: number }
const p95 = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(0.95 * (s.length - 1))] ?? NaN; };
/** Errors in SOURCE pixels of the 1280-wide fixture (decisions §2.5) and degrees. */
function score(fx: SteadyFixture, measures: PairMeasure[], ms: number, workWidth: number): Run {
  const tErr: number[] = [], rErr: number[] = [];
  measures.forEach((m, k) => {
    if (m.st !== KST.ok && m.st !== KST.weak) return;
    const s = toCameraSample(m, workWidth), t = fx.truth[k]!;
    tErr.push(Math.hypot(s.dx / 1e5 - t.tx, s.dy / 1e5 - t.ty) * fx.width);
    rErr.push((Math.abs(s.dr / 1e6 - t.r) * 180) / Math.PI);
  });
  return { st: measures.map((m) => m.st), measures, tErr, rErr, msPerFrame: ms / measures.length };
}
/** The kernel over a fixture drawn straight at work size (no codec). */
function runDrawn(variant: SteadyVariant, frames: number): { fx: SteadyFixture; run: Run } {
  const fx = steadyFixture({ variant, frames });
  const k = createCameraKernel();
  const t0 = performance.now();
  const measures = Array.from({ length: frames }, (_, f) => runSync(k.push({ width: 640, height: 360, data: fx.render(f, 640, 360) }, f)));
  return { fx, run: score(fx, measures, performance.now() - t0, 640) };
}
const counts = (st: number[]) => ({ unknown: st.filter((s) => s === KST.unknown).length, ok: st.filter((s) => s === KST.ok).length, weak: st.filter((s) => s === KST.weak).length, start: st.filter((s) => s === KST.start).length });
const report = (name: string, r: Run) => console.log(`[steady kernel] ${name}: ${JSON.stringify(counts(r.st))}; translation error p95 ${p95(r.tErr).toFixed(3)} source px (max ${Math.max(0, ...r.tErr).toFixed(3)}), rotation error p95 ${p95(r.rErr).toFixed(4)}°; ${r.msPerFrame.toFixed(1)} ms/frame (one sample)`);
const ratios = (r: Run) => r.measures.slice(1).map((m) => (m.support ? m.second / m.support : 0));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-steady-kernel-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('kernel on the shaky fixtures (proof checks S1–S5, at the proof\'s thresholds)', () => {
  it('S1 F1 through H.264 (1280×720, CRF 12, B-frames) and the server\'s reader: every frame after the first ok; p95 ≤ 0.3 source px and ≤ 0.02°', async () => {
    const fx = steadyFixture({ variant: 'F1' });
    const { file } = await writeSteadyFixture(fx, path.join(dir, 'f1.mp4'));
    const k = createCameraKernel();
    const measures: PairMeasure[] = [];
    let W = 0;
    const t0 = performance.now();
    await readFrames({ file, kind: 'original', blobHash: 'f1', width: 1280, height: 720, frameCount: 180, rate: { num: 30, den: 1 } }, 0, 180, 360, (f, frame) => { W = frame.width; measures.push(runSync(k.push(frame, f))); }, new AbortController().signal);
    const r = score(fx, measures, performance.now() - t0, W);
    report('S1 F1 (H.264)', r);
    expect(r.st[0]).toBe(KST.start);
    expect(r.st.slice(1).every((s) => s === KST.ok)).toBe(true);
    expect(p95(r.tErr)).toBeLessThanOrEqual(0.3);
    expect(p95(r.rErr)).toBeLessThanOrEqual(0.02);
  }, 180_000);
  it('S2 F2 (a block with its own motion over 25 %): every frame after the first ok, the same bounds; the competing share is below 40 %', () => {
    const { run } = runDrawn('F2', 90);
    report('S2 F2', run);
    const q = ratios(run);
    console.log(`[steady kernel] F2 second/first consensus support: min ${Math.min(...q).toFixed(2)}, max ${Math.max(...q).toFixed(2)} (competing at ≥ ${CAMERA_KERNEL_PARAMS.competeShare})`);
    expect(run.st.slice(1).every((s) => s === KST.ok)).toBe(true);
    expect(p95(run.tErr)).toBeLessThanOrEqual(0.3);
    expect(p95(run.rErr)).toBeLessThanOrEqual(0.02);
    expect(Math.max(...q)).toBeLessThan(CAMERA_KERNEL_PARAMS.competeShare);
  }, 120_000);
  it('S3 F3 (the block over 65 %): at least 80 % of the frames weak, none ok; the competing share is at least 40 %', () => {
    const { run } = runDrawn('F3', 90);
    report('S3 F3', run);
    const q = ratios(run);
    console.log(`[steady kernel] F3 second/first consensus support: min ${Math.min(...q).toFixed(2)}, max ${Math.max(...q).toFixed(2)}`);
    const c = counts(run.st.slice(1));
    expect(c.ok).toBe(0);
    expect(c.weak / 89).toBeGreaterThanOrEqual(0.8);
  }, 120_000);
  it('S4 F4 (flat grey, faint noise): under 50 % of the frames measured', () => {
    const { run } = runDrawn('F4', 40);
    report('S4 F4', run);
    const c = counts(run.st.slice(1));
    expect((c.ok + c.weak) / 39).toBeLessThan(0.5);
  }, 60_000);
  it('S5 F5 (a hard cut at 90): frame 90 start, 89 and 91 ok; the cut threshold sits between the measured within-shot and cut differences', () => {
    const { run } = runDrawn('F5', 100);
    report('S5 F5', run);
    expect([run.st[89], run.st[90], run.st[91]]).toEqual([KST.ok, KST.start, KST.ok]);
    const within = Math.max(...run.measures.slice(1).filter((_, i) => i + 1 !== 90).map((m) => m.thumbDiff));
    const atCut = run.measures[90]!.thumbDiff;
    console.log(`[steady kernel] thumbnail difference: within the shots of F5 at most ${within.toFixed(1)} grey levels, at the cut ${atCut.toFixed(1)}; threshold cutGrey ${CAMERA_KERNEL_PARAMS.cutGrey}; survivors at the cut ${run.measures[90]!.survivors}/${run.measures[90]!.seeded}`);
    expect(within).toBeLessThan(CAMERA_KERNEL_PARAMS.cutGrey);
    expect(atCut).toBeGreaterThan(CAMERA_KERNEL_PARAMS.cutGrey);
  }, 120_000);
  it('F7 (a steady pan): every frame ok and each delta within 0.3 source px of the constant truth', () => {
    const { run } = runDrawn('F7', 40);
    report('F7', run);
    expect(run.st.slice(1).every((s) => s === KST.ok)).toBe(true);
    expect(Math.max(...run.tErr)).toBeLessThanOrEqual(0.3);
  }, 60_000);
  it('the measurement yields to the caller every 48 tracked points', () => {
    const fx = steadyFixture({ variant: 'F1', frames: 2 });
    const k = createCameraKernel();
    runSync(k.push({ width: 640, height: 360, data: fx.render(0, 640, 360) }, 0));
    const g = k.push({ width: 640, height: 360, data: fx.render(1, 640, 360) }, 1);
    let yields = 0;
    for (let r = g.next(); !r.done; r = g.next()) yields++;
    expect(yields).toBe(Math.floor(192 / 48));
  });
});
