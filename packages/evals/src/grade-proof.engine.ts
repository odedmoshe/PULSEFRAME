/**
 * proof:grade, part «engine» (W1: G1–G10; grade-proof.ts GRADE_CHECKS is the list). Every check is a measurement; the model
 * tolerances come ONLY from grade-proof.tolerance.ts (slope-aware, C6) and are never changed here.
 *
 * Runs against its own server (port 8907, its own data folder under .artifacts/grade-proof) and a headless Chromium with WebGPU
 * enabled; all GPU checks run on whatever adapter that gives (in the container: a software one), and the adapter is recorded.
 * Fixtures are synthetic, 512×320, made at proof time as raw bytes turned into PNGs with `ffmpeg -f rawvideo` (exact), deleted at
 * the end. F1 (the ramp): five 64-row bands, each code value 2 columns wide: grey; red only; green only; blue only; grey at alpha 128.
 *
 *   pnpm build && tsx packages/evals/src/grade-proof.engine.ts     this part alone (the whole proof waits for the other two parts)
 *
 * G9 runs the two regression proofs it names (`proof:trend-baseline --check`, `proof:gpu`) as child processes. proof:gpu's
 * 8× shuttle check is load-dependent on this shared machine (its verdict is "blocked" under load; PROGRESS: "waits for a quiet
 * machine"): it failed on the pre-pass tree too (91/92, recorded before W1 touched gpu.ts), so G9 compares with that baseline:
 * every other check must pass, and that one may only fail with its own "blocked" verdict. That exception is named in the result.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import {
  GRADE_CURVE_PRESETS, gradeCurvePreset, gradeCurveTable, gradeCurveTables, gradeCurveTablesDigest, OpError, type GradeCurvePoint, type GradeCurves, type GradeCurveTables,
} from '@pulseframe/core';
import { translateRefusal } from '../../i18n/src/index.ts';
import { startServer } from '@pulseframe/server';
import { curvePixel, gradePixel, GRADE_DEFAULTS, type GradeParams } from '../../engine/src/colourMatch.ts';
import { describeMoment } from '../../engine/src/evaluate.ts';
import { frameKey } from '../../engine/src/frameKey.ts';
import { ctxFor, richDoc, tx as fkTx } from '../../engine/src/frameKey.testDocs.ts';
import { clipOf, curvedArgs, gradeOf, project, refusal, tx as ctx, undone } from '../../core/src/gradeCurves.testFixture.ts';
import { podcast, tx as mtx } from '../../core/src/multicam.testFixture.ts';
import { curveTolerance, localStep, maxStep, NEUTRAL_OPAQUE_CODES, straightFromPremultiplied, GENTLE_STEP_MAX, STEEP_STEP_MIN } from './grade-proof.tolerance.ts';
import type { GradeProofPart } from './grade-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/grade-proof');
const W = 512, H = 320, BAND = 64;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).slice(0, 300)}`);
  return r.stdout as Buffer;
};
const pngToRgb = (png: Buffer) => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const px = (b: Buffer, x: number, y: number) => { const i = (y * W + x) * 3; return [b[i]!, b[i + 1]!, b[i + 2]!] as [number, number, number]; };
const meanDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return Number((s / a.length).toFixed(3)); };
const r3 = (v: number) => Number(v.toFixed(3));
/** Numbers of every check, printed after it (pass or fail) and written to .artifacts/grade-proof/engine-measurements.json. */
export const engineMeasurements: Record<string, unknown> = {};
const note = (id: string, numbers: unknown) => { engineMeasurements[id] = numbers; console.log(`  ${id} numbers: ${JSON.stringify(numbers).slice(0, 1200)}`); };

// ---------------------------------------------------------------------------------------------------------------------------
// The 40 point sets of G1/G2: the presets' curves, the identity, and 37 from a fixed integer generator (an LCG; every third monotone)
// ---------------------------------------------------------------------------------------------------------------------------
export function generatedCurves(count = 37, seed = 20261126): GradeCurvePoint[][] {
  let st = seed >>> 0;
  const next = (mod: number) => { st = (Math.imul(st, 1103515245) + 12345) >>> 0; return (st >>> 8) % mod; };
  const out: GradeCurvePoint[][] = [];
  for (let s = 0; out.length < count; s++) {
    const n = 2 + next(11);
    const xs = new Set<number>([0, 255]);
    while (xs.size < n) xs.add(4 + next(248));
    const x = [...xs].sort((a, b) => a - b);
    if (x.some((v, k) => k > 0 && v - x[k - 1]! < 4)) continue;
    let y = x.map(() => next(256));
    if (s % 3 === 0) y = [...y].sort((a, b) => a - b);
    out.push(x.map((v, k) => [v, y[k]!] as GradeCurvePoint));
  }
  return out;
}
/**
 * The 40 curves values of G1: the three presets, the identity, and 36 generated curves, each on a rotating channel. (GRADE_CHECKS
 * says "40 … the presets, the identity, 37 from a fixed integer generator": 3 + 1 + 37 is 41, so the total of 40 is kept and the
 * generator gives 36 here; the core unit test runs all 37.)
 */
export function proofCurveSets(): GradeCurves[] {
  const ch = ['master', 'r', 'g', 'b'] as const;
  return [
    ...GRADE_CURVE_PRESETS.map((p) => gradeCurvePreset(p.id)),
    { master: [[0, 0], [255, 255]] },
    ...generatedCurves(36).map((c, i) => ({ [ch[i % 4]!]: c }) as GradeCurves),
  ];
}

// ---------------------------------------------------------------------------------------------------------------------------
// Shared context: one server, one browser, the F1 project (made on first use, closed after the last check)
// ---------------------------------------------------------------------------------------------------------------------------
type Server = Awaited<ReturnType<typeof startServer>>;
interface Ctx {
  s: Server; browser: Browser;
  call: (p: string, body?: unknown, method?: string) => Promise<{ status: number; body: any }>;
  tx: (pid: string, ops: unknown[]) => Promise<any>;
  still: (pid: string, index?: number) => Promise<Buffer>;
  waitJob: (id: string) => Promise<any>;
  f1: { pid: string; clipId: string; plain: Buffer };
  adapter: unknown;
}
let ctxP: Promise<Ctx> | null = null;
function context(): Promise<Ctx> {
  ctxP ??= (async () => {
    fs.rmSync(art, { recursive: true, force: true });
    fs.mkdirSync(art, { recursive: true });
    // F1: the ramp, rgba so the fifth band can be translucent
    const raw = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const v = x >> 1, band = Math.floor(y / BAND), o = (y * W + x) * 4;
      const rgb = band === 1 ? [v, 0, 0] : band === 2 ? [0, v, 0] : band === 3 ? [0, 0, v] : [v, v, v];
      raw.set([...rgb, band === 4 ? 128 : 255], o);
    }
    const f1File = path.join(art, 'f1-ramp.png');
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-pix_fmt', 'rgba', '-y', f1File], raw);
    delete process.env.PF_RENDER_GPU; // the render host finds a launch mode that gives a graphics device
    const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
    const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
    const probe = await browser.newPage();
    await probe.goto(`${s.url}/gpu.html`);
    const adapter = await probe.evaluate(async () => { const a = await (navigator as any).gpu?.requestAdapter(); return a ? { vendor: a.info?.vendor ?? null, architecture: a.info?.architecture ?? null, description: a.info?.description ?? null, fallback: !!(a.isFallbackAdapter ?? a.info?.isFallbackAdapter) } : null; });
    await probe.close();
    if (!adapter) { await browser.close(); await s.close(); throw new Error('BLOCKED: the browser gives no WebGPU adapter on this machine, even with WebGPU enabled (see `pnpm probe:gpu`)'); }
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
    const call = async (p: string, body?: unknown, method?: string) => {
      const r = await fetch(`${s.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
    };
    const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction refused: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
    const still = async (pid: string, index = 0) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw new Error(`still refused (${r.status}): ${JSON.stringify(r.body?.error ?? r.body).slice(0, 400)}`); return pngToRgb(r.body); };
    const waitJob = async (id: string) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > 15 * 60_000) throw new Error(`job ${id} still ${j.status}`); await sleep(300); } };
    const pid = (await call('/projects', { name: 'grade-f1', width: W, height: H })).body.project.id as string;
    const up = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'f1-ramp.png' }, body: fs.readFileSync(f1File) });
    const assetId = ((await up.json()) as any).assetId as string;
    const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.rt(2, 1) } }])).results[0].output.clipId as string;
    const plain = await still(pid);
    return { s, browser, call, tx, still, waitJob, f1: { pid, clipId, plain }, adapter };
  })();
  return ctxP;
}
async function closeContext() {
  if (!ctxP) return;
  const c = await ctxP.catch(() => null);
  ctxP = null;
  if (c) { await c.browser.close().catch(() => {}); await c.s.close().catch(() => {}); }
  try { fs.writeFileSync(path.join(art, 'engine-measurements.json'), JSON.stringify(engineMeasurements, null, 2)); } catch { /* the folder is gone */ }
  for (const f of ['f1-ramp.png']) fs.rmSync(path.join(art, f), { force: true });
  fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------------------------------------------------------
// F1 helpers: what the model expects at each sample point
// ---------------------------------------------------------------------------------------------------------------------------
/** The sample row of a band (its middle) and every column. */
const rowOf = (band: number) => band * BAND + BAND / 2;
/** Sets the clip's grade: sliders (replace) and curves (null removes). */
async function setGrade(c: Ctx, params: Partial<GradeParams>, curves: GradeCurves | null) {
  await c.tx(c.f1.pid, [{ op: 'set_colour_grade', args: { clipId: c.f1.clipId, params, mode: 'replace' } }, { op: 'set_grade_curves', args: { clipId: c.f1.clipId, curves } }]);
}
/** Worst |pass − model| in codes over the opaque bands, the model being gradePixel of the plain still's pixel (and its curve step). */
function opaqueWorst(img: Buffer, plain: Buffer, p: GradeParams, tables?: GradeCurveTables) {
  let worst = 0, at: unknown = null;
  for (let band = 0; band < 4; band++) for (let x = 0; x < W; x++) {
    const y = rowOf(band), src = px(plain, x, y), got = px(img, x, y);
    const want = gradePixel([src[0] / 255, src[1] / 255, src[2] / 255], p, tables);
    for (let ch = 0; ch < 3; ch++) { const d = Math.abs(got[ch]! - want[ch]! * 255); if (d > worst) { worst = d; at = { x, y, ch, src, got, want: r3(want[ch]! * 255) }; } }
  }
  return { worst: r3(worst), at };
}
const GENTLE_FOUR: GradeCurves = { master: [[0, 8], [128, 132], [255, 248]], r: [[0, 0], [96, 104], [255, 255]], g: [[0, 4], [160, 150], [255, 250]], b: [[0, 10], [128, 120], [255, 240]] };
const STEEP: GradeCurves = { master: [[0, 0], [124, 0], [128, 255], [255, 255]] };
const SLIDERS: GradeParams = { ...GRADE_DEFAULTS, exposure: 0.5, temperature: 0.3, contrast: 1.2 };
let delta0: number | null = null;
/** δ₀: the worst |model − pass| of SLIDERS without curves, measured in this run (G6 measures it first; G6b reuses it). */
async function measureDelta0(c: Ctx) {
  if (delta0 !== null) return delta0;
  await setGrade(c, SLIDERS, null);
  const img = await c.still(c.f1.pid);
  delta0 = opaqueWorst(img, c.f1.plain, SLIDERS).worst;
  return delta0;
}
/** The frame keys of two frameKey.testDocs documents WITHOUT curves, computed on the base commit 2dcd371 (before the grade pre-pass, 68ab868^) with the same script (W1, 2026-11-26). */
const BASE_KEYS: Record<string, string> = { 'rich@0': 'cd086965cccdc43d57407ea374fb23ab1a0e3319b1c6ed010bdfe9289d5942f8', 'rich@30': '4225b866631ec25b95066067ac9ebc684840e333cb1761a63e217912ecceed50', 'rich@60': '612b5f00848b5c2f6687f956f079be806e99238fae8c491ea71944e0eb3fe01f', 'rich@120': 'a6011dc4c4ac2e3551528988afbc70dee8da452771bf8d4ac2522d95df26a16d', 'rich@230': '7e1d10ab53c029e246582231802c2a1168f477dd0ce549205f924eb9d079e62f', 'rich@300': 'dd7050a103ea88ebfc0deb525b1396b37e0b303551a5673fc9c5db987ef3219b', 'rich-short@60': '38d6dd6808a9bc66549a57791e0ba96e179a3dc0af160e9004125a5723e28d70' };

// ---------------------------------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------------------------------
const checks: GradeProofPart['checks'] = {
  async G1() {
    const c = await context();
    const sets = proofCurveSets();
    const node = sets.map((x) => gradeCurveTablesDigest(gradeCurveTables(x)));
    const page = await c.browser.newPage();
    try {
      await page.goto(`${c.s.url}/selftest.html`);
      await page.waitForFunction(() => typeof (window as any).__pfGradeCurveHash === 'function', undefined, { timeout: 30_000 });
      const chromium = await page.evaluate((x) => (window as any).__pfGradeCurveHash(x), sets) as { built: boolean; digests: string[]; ms: number };
      const differing = node.flatMap((d, i) => (chromium.digests[i] === d ? [] : [i]));
      note('G1', { sets: sets.length, distinctDigests: new Set(node).size, chromiumBuilt: chromium.built, chromiumMs: chromium.ms, differing, sample: node.slice(0, 4) });
      return sets.length === 40 && chromium.built && chromium.digests.length === 40 && differing.length === 0 ? true : `Node and Chromium differ (or the page has no tables): built ${chromium.built}, ${chromium.digests.length} digests, differing at ${JSON.stringify(differing)}`;
    } finally { await page.close(); }
  },

  async G2() {
    const curves = proofCurveSets().flatMap((s) => Object.values(s) as GradeCurvePoint[][]);
    let knots = 0, monotone = 0;
    const faults: unknown[] = [];
    for (const pts of curves) {
      const t = gradeCurveTable(pts);
      for (const [x, y] of pts) { knots++; if (t[x] !== y) faults.push({ pts, x, want: y, got: t[x] }); }
      if (pts.every((q, k) => k === 0 || q[1] >= pts[k - 1]![1])) {
        monotone++;
        for (let v = 1; v < 256; v++) if (t[v]! < t[v - 1]!) faults.push({ pts, nonDecreasingAt: v });
        for (let k = 0; k + 1 < pts.length; k++) {
          const lo = Math.min(pts[k]![1], pts[k + 1]![1]), hi = Math.max(pts[k]![1], pts[k + 1]![1]);
          for (let v = pts[k]![0]; v <= pts[k + 1]![0]; v++) if (t[v]! < lo || t[v]! > hi) faults.push({ pts, outsideKnotsAt: v, got: t[v] });
        }
      }
    }
    const id = gradeCurveTable([[0, 0], [255, 255]]);
    const identityOk = id.every((v, i) => v === i);
    note('G2', { curves: curves.length, knots, monotoneCurves: monotone, identityOk, faults: faults.slice(0, 5), faultCount: faults.length });
    return faults.length === 0 && identityOk && monotone >= 10 ? true : `${faults.length} faults (first: ${JSON.stringify(faults[0])}); identity ${identityOk}; monotone curves ${monotone}`;
  },

  async G3() {
    const p = project();
    const he = (e: OpError) => translateRefusal('he', e.message);
    const rows: { case: string; code?: string; reason?: unknown; en: string; he?: string; hint?: string }[] = [];
    const refuse = (name: string, args: unknown) => { const e = refusal(() => ctx(p.doc, [{ op: 'set_grade_curves', args: args as never }])); rows.push({ case: name, code: e.code, reason: (e.details as { reason?: unknown } | undefined)?.reason, en: e.message, he: he(e), hint: e.hint }); return e; };
    refuse('unordered points', { clipId: p.picture, curves: { master: [[0, 0], [128, 9], [100, 50], [255, 255]] } });
    refuse('gap below 4', { clipId: p.picture, curves: { r: [[0, 0], [100, 9], [103, 9], [255, 255]] } });
    refuse('missing end point', { clipId: p.picture, curves: { g: [[0, 0], [200, 255]] } });
    refuse('13 points', { clipId: p.picture, curves: { b: Array.from({ length: 13 }, (_, i) => [Math.round((i * 255) / 12), i * 10]) } });
    refuse('value 256', { clipId: p.picture, curves: { master: [[0, 0], [255, 256]] } });
    refuse('value 0.5', { clipId: p.picture, curves: { master: [[0, 0.5], [255, 255]] } });
    refuse('caption clip', { clipId: p.cue, curves: curvedArgs() });
    refuse('sound clip', { clipId: p.sound, curves: curvedArgs() });
    refuse('locked track', { clipId: p.lockedClip, curves: curvedArgs() });
    const unworded = rows.filter((r) => !r.code || !r.en || !r.he || !/[א-ת]/.test(r.he));
    // there is no merge mode (C10a): an argument `mode` is refused by the strict argument schema (the generic typed refusal, no new words)
    const merge = refusal(() => ctx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs(), mode: 'merge' } as never }]));
    const noMerge = merge.code === 'invalid_args' && /"mode"/.test(merge.message);
    // identity channels dropped; null removes; nothing added without a grade when there is nothing to set (C10b)
    const set = ctx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: { master: [[0, 0], [255, 255]], r: [[0, 10], [255, 250]] } } }]).doc;
    const dropped = JSON.stringify(gradeOf(set, p.picture)?.curves) === JSON.stringify({ r: [[0, 10], [255, 250]] });
    const removed = ctx(set, [{ op: 'set_grade_curves', args: { clipId: p.picture, curves: null } }]).doc;
    const nullRemoves = gradeOf(removed, p.picture) !== undefined && !('curves' in gradeOf(removed, p.picture)!);
    const nothing = ctx(p.doc, [{ op: 'set_grade_curves', args: { clipId: p.title, curves: null } }]).doc;
    const nothingAdded = JSON.stringify(nothing) === JSON.stringify(p.doc);
    const coreUndo = JSON.stringify(undone(p.doc, set)) === JSON.stringify(p.doc);
    // one undo through the server restores the stored document byte for byte
    const c = await context();
    const before = (await c.call(`/projects/${c.f1.pid}`)).body.project;
    await c.tx(c.f1.pid, [{ op: 'set_grade_curves', args: { clipId: c.f1.clipId, curves: curvedArgs() } }]);
    const mid = (await c.call(`/projects/${c.f1.pid}`)).body.project;
    const undo = await c.call(`/projects/${c.f1.pid}/undo`, {});
    const after = (await c.call(`/projects/${c.f1.pid}`)).body.project;
    const serverUndo = undo.status === 200 && JSON.stringify(after) === JSON.stringify(before) && JSON.stringify(mid) !== JSON.stringify(before);
    note('G3', { noMerge: { code: merge.code, message: merge.message }, refusals: rows.map((r) => ({ case: r.case, code: r.code, reason: r.reason, en: r.en.slice(0, 90), he: r.he?.slice(0, 60) })), dropped, nullRemoves, nothingAdded, coreUndo, serverUndo, undoStatus: undo.status });
    return rows.length === 9 && unworded.length === 0 && noMerge && dropped && nullRemoves && nothingAdded && coreUndo && serverUndo ? true : `unworded refusals ${JSON.stringify(unworded.map((r) => r.case))}; merge refused ${noMerge}; dropped ${dropped}; null removes ${nullRemoves}; nothing added ${nothingAdded}; undo core ${coreUndo} server ${serverUndo}`;
  },

  async G4() {
    const p = project();
    const doc = ctx(p.doc, [{ op: 'set_colour_grade', args: { clipId: p.picture, params: { exposure: 0.3 } } }, { op: 'set_grade_curves', args: { clipId: p.picture, curves: curvedArgs() } }]).doc;
    const want = JSON.stringify(curvedArgs());
    const id = gradeOf(doc, p.picture)!.id;
    const kept: Record<string, boolean> = {};
    for (const [name, step] of [
      ['set_colour_grade replace', { op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 } } }],
      ['set_colour_grade merge', { op: 'set_colour_grade', args: { clipId: p.picture, params: { tint: 0.1 }, mode: 'merge' } }],
      ['apply_look', { op: 'apply_look', args: { clipId: p.picture, lookId: 'warm-sun' } }],
      ['update_effect', { op: 'update_effect', args: { clipId: p.picture, effectId: id, params: { saturation: 1.2 } } }],
    ] as const) kept[name] = JSON.stringify(gradeOf(ctx(doc, [step as never]).doc, p.picture)?.curves) === want;
    const removedDoc = ctx(doc, [{ op: 'remove_effect', args: { clipId: p.picture, effectId: id } }]).doc;
    const removeTakes = gradeOf(removedDoc, p.picture) === undefined;
    const undoBrings = JSON.stringify(gradeOf(undone(doc, removedDoc), p.picture)?.curves) === want;
    const pasted = ctx(doc, [{ op: 'paste_attributes', args: { fromClipId: p.picture, toClipIds: [p.title], groups: ['colour'] } }]).doc;
    const pasteCarries = JSON.stringify(gradeOf(pasted, p.title)?.curves) === want;
    // set_angle_look unedited keeps a segment whose only change is its curves (C4)
    const pod = podcast();
    let d = mtx(pod.doc, [{ op: 'place_multicam', args: { groupId: pod.groupId, at: T.ZERO, angleId: pod.camA, range: { from: T.rt(10, 1), to: T.rt(400, 1) } } }]).doc;
    const sw = mtx(d, [{ op: 'switch_angles', args: { groupId: pod.groupId, cuts: [{ at: T.frameTime(300, { num: 30, den: 1 }), angleId: pod.camB }, { at: T.frameTime(600, { num: 30, den: 1 }), angleId: pod.camA }, { at: T.frameTime(900, { num: 30, den: 1 }), angleId: pod.camB }] } }]);
    const [s1, s2] = (sw.results[0]!.output as { switchedClipIds: string[] }).switchedClipIds as [string, string];
    d = mtx(sw.doc, [{ op: 'set_colour_grade', args: { clipId: s1, params: { exposure: 0.2 } } }, { op: 'set_grade_curves', args: { clipId: s1, curves: curvedArgs() } }]).doc;
    d = mtx(d, [{ op: 'set_angle_look', args: { groupId: pod.groupId, angleId: pod.camB, fromClipId: s1 } }]).doc;
    d = mtx(d, [{ op: 'set_grade_curves', args: { clipId: s2, curves: { r: [[0, 30], [255, 255]] } } }]).doc;
    const angled = mtx(d, [{ op: 'set_angle_look', args: { groupId: pod.groupId, angleId: pod.camB, fromClipId: s1 } }]);
    const angleKeeps = (angled.results[0]!.output as { keptClipIds: string[] }).keptClipIds.includes(s2) && JSON.stringify(gradeOf(angled.doc, s2)?.curves) === JSON.stringify({ r: [[0, 30], [255, 255]] });
    // colour match (balance) on the curved F1 clip through the server: its ops set the sliders; the curves stay; the note says so
    const c = await context();
    await setGrade(c, { exposure: 0.2 }, curvedArgs() as GradeCurves);
    const r = await c.call(`/projects/${c.f1.pid}/analysis/colour-match`, { method: 'balance', targetClipIds: [c.f1.clipId], background: true });
    let matchKeeps = false, matchNote = '', warnings: unknown = null, matchStatus: unknown = r.status;
    if (r.status === 202) {
      const j = await c.waitJob(r.body.jobId);
      matchStatus = j.status;
      if (j.status === 'succeeded') {
        const m = j.output.result as { ops: unknown[]; note: string; targets: { warnings: string[] }[] };
        matchNote = m.note; warnings = m.targets[0]?.warnings;
        await c.tx(c.f1.pid, m.ops);
        const fx = ((await c.call(`/projects/${c.f1.pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === c.f1.clipId).effects as any[]).find((e) => e.type === 'color.grade');
        matchKeeps = m.ops.length === 1 && JSON.stringify(fx?.curves) === want;
      }
    }
    const worded = /the curves stay/.test(matchNote) && Array.isArray(warnings) && (warnings as string[]).includes('replaces_grade');
    note('G4', { kept, removeTakes, undoBrings, pasteCarries, angleKeeps, colourMatch: { status: matchStatus, keepsCurves: matchKeeps, warnings, noteWorded: worded } });
    void clipOf;
    return Object.values(kept).every(Boolean) && removeTakes && undoBrings && pasteCarries && angleKeeps && matchKeeps && worded ? true : `kept ${JSON.stringify(kept)}; remove ${removeTakes}; undo ${undoBrings}; paste ${pasteCarries}; angle ${angleKeeps}; colour match keeps ${matchKeeps} (status ${matchStatus}), worded ${worded}`;
  },

  async G5() {
    const c = await context();
    const curves = gradeCurvePreset('film'), tables = gradeCurveTables(curves);
    const S = Math.max(maxStep(tables.r), maxStep(tables.g), maxStep(tables.b));
    const tolT = curveTolerance('gentle-translucent', S);
    await setGrade(c, {}, curves);
    const img = await c.still(c.f1.pid);
    let exactCols = 0, cols = 0, worstOpaque = 0, worstTrans = 0, transAt: unknown = null;
    for (let band = 0; band < 4; band++) for (let x = 0; x < W; x++) {
      const y = rowOf(band), src = px(c.f1.plain, x, y), got = px(img, x, y);
      const want = [tables.r[src[0]]!, tables.g[src[1]]!, tables.b[src[2]]!];
      cols++;
      if (got.every((v, ch) => v === want[ch])) exactCols++;
      for (let ch = 0; ch < 3; ch++) worstOpaque = Math.max(worstOpaque, Math.abs(got[ch]! - want[ch]!));
    }
    const a = 128;
    for (let x = 0; x < W; x++) {
      const y = rowOf(4), pre = px(c.f1.plain, x, y), got = px(img, x, y);
      const o = [0, 1, 2].map((ch) => straightFromPremultiplied(pre[ch]!, a)) as [number, number, number];
      const want = curvePixel(o, tables).map((v) => v * 255 * (a / 255));
      for (let ch = 0; ch < 3; ch++) { const d = Math.abs(got[ch]! - want[ch]!); if (d > worstTrans) { worstTrans = d; transAt = { x, ch, pre, got, want: r3(want[ch]!) }; } }
    }
    const changed = meanDiff(img, c.f1.plain);
    const share = exactCols / cols;
    note('G5', { S, exactShare: r3(share), worstOpaque, neutralOpaqueTolerance: NEUTRAL_OPAQUE_CODES, worstTranslucent: r3(worstTrans), translucentTolerance: tolT, translucentAt: transAt, meanChange: changed });
    return S <= GENTLE_STEP_MAX && share >= 0.99 && worstOpaque <= NEUTRAL_OPAQUE_CODES && worstTrans <= tolT && changed > 5 ? true : `exact on ${r3(share * 100)} % of columns, worst opaque ${worstOpaque} (≤ ${NEUTRAL_OPAQUE_CODES}), worst translucent ${r3(worstTrans)} (≤ ${tolT}) at ${JSON.stringify(transAt)}, mean change ${changed}`;
  },

  async G6() {
    const c = await context();
    const d0 = await measureDelta0(c);
    const tables = gradeCurveTables(GENTLE_FOUR);
    const S = Math.max(maxStep(tables.r), maxStep(tables.g), maxStep(tables.b));
    const tol = curveTolerance('gentle-opaque', S);
    await setGrade(c, SLIDERS, GENTLE_FOUR);
    const img = await c.still(c.f1.pid);
    const r = opaqueWorst(img, c.f1.plain, SLIDERS, tables);
    note('G6', { adapter: c.adapter, S, tolerance: tol, worst: r.worst, at: r.at, delta0: d0, pixels: 4 * W });
    return r.worst <= tol ? true : `worst ${r.worst} codes > ${tol} at ${JSON.stringify(r.at)} (adapter ${JSON.stringify(c.adapter)}, S ${S}, δ₀ ${d0})`;
  },

  async G6b() {
    const c = await context();
    const d0 = await measureDelta0(c);
    const tables = gradeCurveTables(STEEP);
    await setGrade(c, SLIDERS, STEEP);
    const img = await c.still(c.f1.pid);
    let checked = 0, worst = 0, worstS = 0, worstTol = 0, worstAt: unknown = null, failures = 0;
    const T3 = [tables.r, tables.g, tables.b];
    for (let band = 0; band < 4; band++) for (let x = 0; x < W; x++) {
      const y = rowOf(band), src = px(c.f1.plain, x, y), got = px(img, x, y);
      const o = gradePixel([src[0] / 255, src[1] / 255, src[2] / 255], SLIDERS);
      const want = curvePixel(o, tables);
      for (let ch = 0; ch < 3; ch++) {
        const S = localStep(T3[ch]!, o[ch]!);
        if (S < STEEP_STEP_MIN) continue; // not a check of G6b (3 < S < 40 and the flat parts belong to no band): never counted
        const tol = curveTolerance('steep-opaque', S, d0), dlt = Math.abs(got[ch]! - want[ch]! * 255);
        checked++;
        if (dlt > tol) failures++;
        if (dlt - tol > worst - worstTol || worstAt === null) { worst = dlt; worstS = S; worstTol = tol; worstAt = { x, y, ch, src, got: got[ch], want: r3(want[ch]! * 255), o: r3(o[ch]! * 255) }; }
      }
    }
    note('G6b', { adapter: c.adapter, checkedChannelValues: checked, worst: r3(worst), S: worstS, tolerance: r3(worstTol), delta0: d0, at: worstAt, failures });
    return checked >= 6 && failures === 0 ? true : `${failures} of ${checked} steep values outside 0.5 + S·δ₀; worst ${r3(worst)} at S ${worstS} (tolerance ${r3(worstTol)}, δ₀ ${d0}, adapter ${JSON.stringify(c.adapter)}) at ${JSON.stringify(worstAt)}`;
  },

  async G7() {
    const c = await context();
    await setGrade(c, SLIDERS, GENTLE_FOUR);
    const still = await c.still(c.f1.pid);
    // the editor, paused at frame 0
    const page: Page = await c.browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let previewMean: number | null = null, canvas: string | null = null;
    try {
      await page.goto(`${c.s.ownerUrl}&project=${c.f1.pid}`);
      await page.locator('.clip').first().waitFor({ timeout: 60_000 });
      for (let i = 0; i < 150; i++) {
        const shot = await page.evaluate(() => {
          const el = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
          if (!el) return null;
          const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data;
          const out = new Uint8Array((d.length / 4) * 3);
          for (let k = 0, j = 0; k < d.length; k += 4) { out[j++] = d[k]!; out[j++] = d[k + 1]!; out[j++] = d[k + 2]!; }
          let s = ''; for (let k = 0; k < out.length; k += 0x8000) s += String.fromCharCode(...out.subarray(k, k + 0x8000));
          return { size: `${el.width}x${el.height}`, b64: btoa(s) };
        });
        if (shot) {
          canvas = shot.size;
          if (shot.size === `${W}x${H}`) { previewMean = meanDiff(Buffer.from(shot.b64, 'base64'), still); if (previewMean < 0.5) break; }
        }
        await sleep(200);
      }
    } finally { await page.close(); }
    // the PNG export equals render_frame byte for byte (decoded pixels)
    const pj = await c.waitJob((await c.call(`/projects/${c.f1.pid}/exports`, { format: 'png', frame: 0 })).body.jobId);
    const pngEqual = pj.status === 'succeeded' ? Buffer.compare(pngToRgb((await c.call(`/jobs/${pj.id}/output`)).body), still) === 0 : false;
    // an MP4 frame: the opaque bands within 12
    const mj = await c.waitJob((await c.call(`/projects/${c.f1.pid}/exports`, {})).body.jobId);
    let mp4Worst: number | null = null;
    if (mj.status === 'succeeded') {
      const file = path.join(art, 'g7.mp4');
      fs.writeFileSync(file, (await c.call(`/jobs/${mj.id}/output`)).body);
      const frame = ff(['-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      fs.rmSync(file, { force: true });
      mp4Worst = 0;
      for (let band = 0; band < 4; band++) for (let x = 4; x < W - 4; x++) { const a = px(frame, x, rowOf(band)), b = px(still, x, rowOf(band)); for (let ch = 0; ch < 3; ch++) mp4Worst = Math.max(mp4Worst, Math.abs(a[ch]! - b[ch]!)); }
    }
    // the worker: PF_RENDER_GPU (unset here: the render host searches the launch modes) and what the render cache's fingerprint names
    const cacheStatus = (await c.call('/storage/render-cache')).body as Record<string, unknown>;
    const worker = { mode: process.env.PF_RENDER_GPU ?? 'unset (the render host chose)', renderCache: JSON.stringify(cacheStatus).slice(0, 400) };
    note('G7', { adapter: c.adapter, worker, previewCanvas: canvas, previewMeanDifference: previewMean, pngJob: pj.status, pngEqual, mp4Job: mj.status, mp4WorstOpaque: mp4Worst, pageErrors: errors });
    return previewMean !== null && previewMean < 0.5 && pngEqual && mp4Worst !== null && mp4Worst <= 12 && errors.length === 0 ? true : `preview mean ${previewMean} (canvas ${canvas}); png equal ${pngEqual} (${pj.status}); mp4 worst ${mp4Worst} (${mj.status}); page errors ${errors.length}`;
  },

  async G8() {
    const rich = richDoc();
    const CURVES = { master: [[0, 0], [64, 40], [192, 210], [255, 255]] as [number, number][] };
    const d1 = fkTx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: CURVES } }]).doc;
    const raised = structuredClone(CURVES); raised.master[1]![1] = 41;
    const d2 = fkTx(rich.doc, [{ op: 'set_grade_curves', args: { clipId: rich.clips.A1, curves: raised } }]).doc;
    const k1 = frameKey(d1, 30, ctxFor(d1)), k1b = frameKey(d1, 30, ctxFor(d1)), k2 = frameKey(d2, 30, ctxFor(d2));
    const now: Record<string, string> = {};
    const short = richDoc({ trFrames: 6, lag: 5 });
    for (const fr of [0, 30, 60, 120, 230, 300]) now[`rich@${fr}`] = frameKey(rich.doc, fr, ctxFor(rich.doc));
    now['rich-short@60'] = frameKey(short.doc, 60, ctxFor(short.doc));
    const baseDiffers = Object.keys(BASE_KEYS).filter((k) => now[k] !== BASE_KEYS[k]);
    // the render cache: after a segmented export the plan says cached; a curve point raised by 1 makes it render; undo makes it cached again
    const c = await context();
    const INC = { format: 'mp4-h264-aac', mode: 'incremental', quality: 'standard', selfCheck: 'every-segment' };
    await setGrade(c, SLIDERS, GENTLE_FOUR);
    const plan = async () => { const r = await c.call(`/projects/${c.f1.pid}/exports/segments/plan`, INC); return r.status === 200 ? (r.body.segments as { cached: number; render: number; uncacheable?: number }) : { error: r.body?.error ?? r.status }; };
    const ej = await c.waitJob((await c.call(`/projects/${c.f1.pid}/exports`, INC)).body.jobId);
    const afterExport = await plan();
    const g4 = structuredClone(GENTLE_FOUR) as { master: [number, number][] };
    g4.master[1]![1] += 1;
    await c.tx(c.f1.pid, [{ op: 'set_grade_curves', args: { clipId: c.f1.clipId, curves: g4 } }]);
    const afterEdit = await plan();
    await c.call(`/projects/${c.f1.pid}/undo`, {});
    const afterUndo = await plan();
    const cacheOk = ej.status === 'succeeded' && (afterExport as any).cached >= 1 && (afterExport as any).render === 0 && (afterEdit as any).render >= 1 && (afterEdit as any).cached === 0 && (afterUndo as any).cached === (afterExport as any).cached;
    note('G8', { keyChangesWithPoint: k2 !== k1, sameDocSameKey: k1 === k1b, baseKeysCompared: Object.keys(BASE_KEYS).length, baseDiffers, renderCache: { exportJob: ej.status, exportSegments: ej.output?.segments && { total: ej.output.segments.total, rendered: ej.output.segments.rendered, reused: ej.output.segments.reused }, afterExport, afterEdit, afterUndo } });
    return k2 !== k1 && k1 === k1b && baseDiffers.length === 0 && cacheOk ? true : `key changes ${k2 !== k1}, stable ${k1 === k1b}, base keys differing ${JSON.stringify(baseDiffers)}, render cache ${cacheOk} (${JSON.stringify({ export: ej.status, afterExport, afterEdit, afterUndo })})`;
  },

  async G9() {
    const run = (script: string, args: string[] = []) => {
      const t0 = Date.now();
      const r = spawnSync('pnpm', ['exec', 'tsx', path.join(root, 'packages/evals/src', script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env } });
      return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, seconds: Math.round((Date.now() - t0) / 1000) };
    };
    const trend = run('trend-baseline.ts', ['--check']);
    const gpu = run('gpu-proof.ts');
    const fails = gpu.out.split('\n').filter((l) => /^\s*FAIL\s/.test(l));
    const total = /GPU proof (?:FAILED|passed)[^0-9]*(\d+)\/(\d+)/.exec(gpu.out);
    const SHUTTLE = /^\s*FAIL\s+Strobes together, in the editor shuttled at 8x/;
    const onlyShuttleBlocked = fails.every((l) => SHUTTLE.test(l) && /"verdict":"blocked"/.test(l));
    const gpuOk = gpu.code === 0 || (fails.length > 0 && onlyShuttleBlocked);
    note('G9', { trendBaseline: { exit: trend.code, seconds: trend.seconds, tail: trend.out.trim().split('\n').slice(-2) }, proofGpu: { exit: gpu.code, seconds: gpu.seconds, counted: total ? `${total[1]}/${total[2]}` : null, failing: fails.map((l) => l.trim().slice(0, 140)), exceptionUsed: gpu.code !== 0 && onlyShuttleBlocked ? 'the load-dependent 8× shuttle check, verdict blocked, as on the pre-pass tree (91/92)' : null } });
    return trend.code === 0 && gpuOk ? true : `trend-baseline --check exit ${trend.code}; proof:gpu exit ${gpu.code} with ${fails.length} failing: ${fails.map((l) => l.trim().slice(0, 100)).join(' | ')}`;
  },

  async G10() {
    try {
      const c = await context();
      const curves = gradeCurvePreset('film');
      await setGrade(c, { exposure: 0.25 }, curves);
      const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
      const mcp = new Client({ name: 'grade-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } } as never);
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${c.s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${c.s.auth.tokens.agent}` } } }));
      const r = await mcp.callTool({ name: 'describe_moment', arguments: { projectId: c.f1.pid, frameIndex: 10 } }) as { content: { type: string; text: string }[]; structuredContent?: any };
      await mcp.close();
      const body = r.structuredContent ?? JSON.parse(r.content.find((x) => x.type === 'text')!.text);
      const layer = (body.layers as any[]).find((l) => l.clipId === c.f1.clipId);
      const grade = layer?.grade;
      // the same answer as the engine's describeMoment over the stored document (the function the tool runs)
      const doc = (await c.call(`/projects/${c.f1.pid}`)).body.project;
      const local = (describeMoment(doc, T.frameTime(10, doc.settings.frameRate)).layers as any[]).find((l) => l.clipId === c.f1.clipId)?.grade;
      const ok = !!grade && grade.params?.exposure === 0.25 && JSON.stringify(grade.curves) === JSON.stringify(curves) && !/samples/.test(JSON.stringify(grade)) && JSON.stringify(local) === JSON.stringify(grade);
      note('G10', { grade, sameAsEngine: JSON.stringify(local) === JSON.stringify(grade) });
      return ok ? true : `describe_moment grade ${JSON.stringify(grade)?.slice(0, 300)}`;
    } finally { await closeContext(); }
  },
};

export const GRADE_PROOF_ENGINE: GradeProofPart = { built: true, checks };

// This part alone: `tsx packages/evals/src/grade-proof.engine.ts [G5 G6 …]` (no ids: all of them, in order).
if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  // grade-proof.ts (the check list) exits 2 on import until every part is built, so this runner names the checks by id only
  const only = process.argv.slice(2);
  let failed = 0;
  for (const [id, run] of Object.entries(checks)) {
    if (only.length && !only.includes(id)) continue;
    const r = await run().catch((e: unknown) => `threw: ${String((e as Error)?.message ?? e)}`);
    if (r === true) console.log(`PASS ${id}`); else { failed++; console.log(`FAIL ${id}: ${r}`); }
  }
  await closeContext();
  console.log(failed ? `grade-proof engine: ${failed} failed` : 'grade-proof engine: all passed');
  process.exit(failed ? 1 : 0);
}
