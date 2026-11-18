/**
 * `pnpm proof:keyframes` — the end-to-end proof of keyframe curves and motion paths (ADR-0019, keyframes-plan.md §6), through
 * the real server (REST, MCP, render_frame, export) and the editor in headless Chromium, after `pnpm build`. Evidence:
 * docs/evidence/keyframes-proof.json (every measured number with its budget and pass or fail) and he/en screenshots in
 * .artifacts/keyframes-proof. Exit codes: 0 = every check passed; 1 = a check failed (its numbers are in the evidence, never
 * relaxed); 2 = blocked (a part is not built on this tree, or the web bundle is missing; listed with its reason).
 *
 * The references are written out here, never taken from core: the cubic-bezier curves by Cardano's closed form for X(s) = u
 * (two Newton steps polish the root; independent of core's 48-step bisection), 'smooth' between two resting keys as
 * smoothstep (Steffen's slopes are 0 at the end keys), positions on the stage as centre + (x · width, y · height).
 * - P1 keyboard picker → Overshoot on x: one revision; frames 0..30 within 1e-12 of the closed form.
 * - P2 the custom curve through the four inputs is stored exactly and renders within 1e-12.
 * - P3 S and L on a middle key set both sides (on the keyframe strip and on a path vertex); after S the slope is continuous
 *   (one-sided second-order differences, 1e-4 relative).
 * - P4 the path overlay's points within 0.5 px of the mapped transformAt on every frame, and the layer box centre on the path
 *   at the playhead (motion-path-he.png, motion-path-en.png).
 * - P5 a 40 px vertex drag is one revision; Δx = 40/rect.width ± 1e-4; the untouched axis is exact at every frame, and the
 *   axis keyed by the drag keeps its static value exactly outside the two segments around the vertex. The untouched y key at
 *   the vertex is off the 1e-4 grid (a value set over REST), so a move that rounded both axes would rewrite it; then
 *   ArrowRight on the vertex is one more revision, Δx = 0.01 ± 1e-4, and y is still exact on every frame.
 * - P6 the bend grip inserts at the middle frame, smooth on both sides, within 1 px of the pointer (before/after screenshots).
 * - P7 keyboard walk (Alt+K, Comma/Period, ←/→ one revision each, Delete); clip count and clip start unchanged.
 * - P8 copy and paste keys to a second clip at exact offsets, one revision.
 * - P9 in a format view the path is read-only: 0 revisions after a drag, arrow keys, a bend and Delete.
 * - P10 the opacity picker disables the turn-back tiles; REST and MCP refuse with the curve-flash refusal, which has its
 *   Hebrew wording.
 * - P11 export 60 frames 640×360 (white square on black, x overshoot, y smooth), ffmpeg-decoded centroid within 0.5 px of the
 *   closed form on every frame; render_frame at 5 frames meets the same bound.
 * - P12 Chromium __pfCurveHash equals the Node hash of the same samples (apps/web/src/curveHash.ts) for every curve of
 *   ADR-0019, bit for bit; the five v1 easings differ by at most 1 ulp per sample (V8 `**`; measured over the full set).
 * - P13 a follower's path is hidden with its reason.
 * Recorded with budgets: the sampler's ns/sample in Chromium and Node (≤ 2 µs), pathPoints ms for 600 points (≤ 16 ms), and the
 * commit p95 of a 2000-key replace against a 1-key replace with the document size (≤ +15 ms).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { CURVES_BUILT, EASINGS, KEYFRAME_OPS_BUILT, KEYFRAME_REFUSALS, NAMED_BEZIER, V1_EASINGS, TRANSFORM_RANGE, transformAt, type Clip, type ProjectDocument } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { translateRefusal } from '../../i18n/src/index.ts';
import { KF_TESTIDS } from '../../../apps/web/src/editor/keyframes.testids.ts';
import { curveHash, curveSamples, pathPointsMs, ulpDistance } from '../../../apps/web/src/curveHash.ts';
import { chooseFormat } from './editor-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/keyframes-proof');
const evidenceFile = path.join(root, 'docs/evidence/keyframes-proof.json');
const checks: { id: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${id} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const measurements: Record<string, { value: number | null; budget: string; ok: boolean | null; gated: boolean; detail?: unknown }> = {};
/** A measured number against its budget. `gated` false: recorded, not gated (a miss is reported, not a failure; the budget stays). */
const measure = (name: string, value: number | null, budget: string, ok: boolean | null, detail?: unknown, gated = true) => { measurements[name] = { value, budget, ok, gated, ...(detail !== undefined ? { detail } : {}) }; console.log(`  ··  ${name} = ${value} (${budget}) ${ok === null ? '' : ok ? 'within' : gated ? 'OVER' : 'OVER (recorded, not gated)'}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fr = (t: T.RationalTime) => T.frameIndexAt(t, R);
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const pct = (v: number[], p: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const W0 = 640, H0 = 360;

// ---------------------------------------------------------------- closed-form references (independent of core) --
type Quad = readonly [number, number, number, number];
/** The root s in [0, 1] of a·s³ + b·s² + c·s + d = 0 (Cardano / the trigonometric form), polished by two Newton steps. */
function cubicRoot01(a: number, b: number, c: number, d: number): number {
  const cands: number[] = [];
  if (Math.abs(a) < 1e-14) {
    if (Math.abs(b) < 1e-14) cands.push(-d / c);
    else { const disc = c * c - 4 * b * d, r = Math.sqrt(Math.max(0, disc)); cands.push((-c + r) / (2 * b), (-c - r) / (2 * b)); }
  } else {
    const p = (3 * a * c - b * b) / (3 * a * a), q = (2 * b * b * b - 9 * a * b * c + 27 * a * a * d) / (27 * a * a * a), shift = -b / (3 * a);
    const disc = (q * q) / 4 + (p * p * p) / 27;
    if (disc >= 0) { const sq = Math.sqrt(disc); cands.push(Math.cbrt(-q / 2 + sq) + Math.cbrt(-q / 2 - sq) + shift); }
    else { const r = 2 * Math.sqrt(-p / 3), phi = Math.acos(Math.max(-1, Math.min(1, (3 * q) / (p * r)))) / 3; for (let k = 0; k < 3; k++) cands.push(r * Math.cos(phi - (2 * Math.PI * k) / 3) + shift); }
  }
  let s = cands.find((x) => x >= -1e-9 && x <= 1 + 1e-9) ?? cands[0]!;
  for (let i = 0; i < 2; i++) { const fx = ((a * s + b) * s + c) * s + d, dfx = (3 * a * s + 2 * b) * s + c; if (dfx !== 0) s -= fx / dfx; }
  return Math.min(1, Math.max(0, s));
}
/** CSS cubic-bezier shape at u: Y(s) where X(s) = u, X and Y in Bernstein form. */
function bezierClosed(h: Quad, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = h;
  const s = cubicRoot01(1 + 3 * x1 - 3 * x2, 3 * x2 - 6 * x1, 3 * x1, -u);
  const m = 1 - s;
  return 3 * m * m * s * y1 + 3 * m * s * s * y2 + s * s * s;
}
const smoothstep = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const clampX = (v: number) => Math.min(TRANSFORM_RANGE.x.max, Math.max(TRANSFORM_RANGE.x.min, v));
const clampY = (v: number) => Math.min(TRANSFORM_RANGE.y.max, Math.max(TRANSFORM_RANGE.y.min, v));
/** A segment a → b with curve h at clip-local frame k, clamped to the channel range as the new curves are. */
const segValue = (a: { f: number; v: number }, b: { f: number; v: number }, k: number, shape: (u: number) => number, clamp: (v: number) => number) =>
  k <= a.f ? a.v : k >= b.f ? b.v : clamp(a.v + (b.v - a.v) * shape((k - a.f) / (b.f - a.f)));

// ---------------------------------------------------------------- pictures --
interface Grey { w: number; h: number; y: Buffer }
const decodePngGrey = (png: Buffer): Grey => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), y: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], png) });
/** Intensity-weighted centroid of the bright pixels (pixel centres at x + 0.5), the dark floor removed. */
function centroid(g: Grey, offset = 0): { x: number; y: number; n: number } | null {
  let s = 0, sx = 0, sy = 0, n = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const v = g.y[offset + y * g.w + x]!;
    const wgt = v > 40 ? v - 16 : 0;
    if (!wgt) continue;
    s += wgt; sx += wgt * (x + 0.5); sy += wgt * (y + 0.5); n++;
  }
  return s ? { x: sx / s, y: sy / s, n } : null;
}

async function main() {
  const blockedBy: string[] = [];
  if (!CURVES_BUILT) blockedBy.push('the curve maths (core curves.ts CURVES_BUILT, keyframe W1)');
  if (!KEYFRAME_OPS_BUILT) blockedBy.push('the keyframe operations (core keyframeOps.ts KEYFRAME_OPS_BUILT, keyframe W1)');
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html')) || !fs.existsSync(path.join(root, 'apps/web/dist/selftest.html'))) blockedBy.push('the web bundle (apps/web/dist): run `pnpm build` first');
  if (blockedBy.length) {
    const report = { proof: 'keyframes', result: 'BLOCKED', ranAt: new Date().toISOString(), blockedBy, checks: [] };
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const squarePng = path.join(art, 'square.png');
  ff(['-y', '-f', 'lavfi', '-i', `color=c=black:s=${W0}x${H0}`, '-vf', `drawbox=x=${W0 / 2 - 20}:y=${H0 / 2 - 20}:w=40:h=40:color=white:t=fill`, '-frames:v', '1', squarePng]);
  const videoFile = path.join(art, 'pic.mp4');
  ff(['-y', '-f', 'lavfi', '-t', '4', '-i', `testsrc2=s=${W0}x${H0}:r=30`, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', videoFile]);

  const s = await startServer({ port: 8836, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const get = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: ProjectDocument; revision: number };
  const waitJob = async (id: string, ms = 600_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(150); } };
  const clipIn = (d: ProjectDocument, id: string): Clip | undefined => Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).find((c) => c.id === id);
  const allClips = (d: ProjectDocument) => Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips));
  const at = (c: Clip, k: number) => transformAt(c, T.add(c.start, f(k)));
  const untilRev = async (pid: string, rev: number, ms = 10_000) => { const t0 = Date.now(); for (;;) { const g = await get(pid); if (g.revision >= rev) return g; if (Date.now() - t0 > ms) return g; await sleep(120); } };
  const textClip = async (pid: string, start: number, frames: number, transform: Record<string, number>, keys: [string, number, number, string][]) => {
    const id = (await txs(pid, [{ op: 'add_text', args: { text: 'מסלול', start: f(start), duration: f(frames), transform } }])).results[0].output.clipId as string;
    if (keys.length) await txs(pid, keys.map(([property, k, value, easing]) => ({ op: 'set_keyframe', args: { clipId: id, property, time: f(k), value, easing } })));
    return id;
  };

  const browser = await chromium.launch();
  const conn: { mcp: Client | null } = { mcp: null };
  try {
    // ---------- the editor project: one title per check, one after another on the text track ----------
    const pid = (await call('/projects', { name: 'keyframes', width: W0, height: H0 })).body.project.id as string;
    const A = await textClip(pid, 0, 60, { x: 0, y: 0 }, [['x', 0, -0.3, 'linear'], ['x', 30, 0.3, 'linear']]);
    const B = await textClip(pid, 60, 60, { x: 0.1, y: 0 }, [['y', 0, -0.2, 'linear'], ['y', 15, 0.0987654321, 'linear'], ['y', 30, -0.1, 'linear']]);
    const C = await textClip(pid, 120, 60, { x: 0, y: 0 }, [['x', 0, -0.3, 'linear'], ['x', 40, 0.3, 'linear']]);
    const D = await textClip(pid, 180, 60, { x: 0, y: 0 }, [['x', 0, -0.2, 'ease-in'], ['x', 10, 0.1, 'ease-out'], ['x', 20, 0.25, 'linear'], ['y', 10, 0.05, 'linear']]);
    const E = await textClip(pid, 240, 60, { x: 0, y: 0 }, [['x', 0, 0, 'linear']]);
    const F = await textClip(pid, 300, 60, { x: 0, y: 0, opacity: 1 }, [['opacity', 0, 0, 'linear'], ['opacity', 30, 1, 'linear']]);
    const M = await textClip(pid, 360, 60, { x: 0, y: 0 }, [['x', 0, -0.3, 'linear'], ['x', 15, 0.1, 'linear'], ['x', 30, 0.3, 'linear']]);
    const tall = (await txs(pid, [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640, fit: 'cover' } }])).results[0].output.variantId as string;

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1600 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.motionPath', '1'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('ruler').waitFor();
    const blur = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seek = async (frame: number) => {
      const rb = (await page.getByTestId('ruler').boundingBox())!;
      await page.mouse.click(rb.x + frame * 3 + 0.5, rb.y + rb.height / 2); // 90 px/s = 3 px a frame
      await page.waitForFunction((fr0) => document.querySelector('[data-testid=playhead]')?.getAttribute('data-frame') === String(fr0), frame, { timeout: 5000 }).catch(() => {});
    };
    /** Select a clip, then put the playhead on timeline frame `frame` (inside the clip, so the canvas handles and the path show). */
    const select = async (id: string, frame: number) => {
      await page.locator(`.clip[data-clip-id="${id}"]`).click({ position: { x: 4, y: 4 } });
      await seek(frame);
      await blur();
    };
    const pathBox = async () => (await page.getByTestId(KF_TESTIDS.path).boundingBox())!;
    const vertex = (frame: number) => page.locator(`[data-testid=${KF_TESTIDS.pathPoint}][data-frame="${frame}"]`);
    const stripKey = (frame: number) => page.locator(`[data-testid=${KF_TESTIDS.key}][data-frame="${frame}"]`);
    const run = async (id: string, fn: () => Promise<void>) => { try { await fn(); } catch (e) { check(id, 'ran to completion', false, String(e).slice(0, 500)); } };

    console.log('\n# P1 keyboard picker → Overshoot on x');
    await run('P1', async () => {
      await select(A, 0);
      const r0 = (await get(pid)).revision;
      await page.getByTestId(KF_TESTIDS.chip('x')).focus();
      await page.keyboard.press('Enter');
      await page.getByTestId(KF_TESTIDS.picker).waitFor({ timeout: 5000 });
      await page.getByTestId(KF_TESTIDS.tile('overshoot')).focus();
      await page.keyboard.press('Enter');
      const g = await untilRev(pid, r0 + 1);
      await sleep(400);
      const after = await get(pid);
      const c = clipIn(after.project, A)!;
      const k0 = c.keyframes?.x?.[0];
      let worst = 0;
      for (let k = 0; k <= 30; k++) worst = Math.max(worst, Math.abs(at(c, k).x - segValue({ f: 0, v: -0.3 }, { f: 30, v: 0.3 }, k, (u) => bezierClosed(NAMED_BEZIER.overshoot, u), clampX)));
      check('P1', 'the keyboard-only picker sets Overshoot on x in one revision; frames 0..30 within 1e-12 of the Cardano closed form', g.revision === r0 + 1 && after.revision === r0 + 1 && k0?.easing === 'overshoot' && worst <= 1e-12, { revisions: after.revision - r0, easing: k0?.easing, maxError: worst });
      await page.keyboard.press('Escape');
    });

    console.log('\n# P2 the custom curve through the four inputs');
    await run('P2', async () => {
      await select(A, 0);
      await page.getByTestId(KF_TESTIDS.chip('x')).focus();
      await page.keyboard.press('Enter');
      await page.getByTestId(KF_TESTIDS.picker).waitFor({ timeout: 5000 });
      const want: Quad = [0.2, -0.3, 0.6, 1.4];
      for (const i of [0, 1, 2, 3] as const) {
        const input = page.getByTestId(KF_TESTIDS.customInput(i));
        await input.focus();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type(String(want[i]));
      }
      await page.keyboard.press('Enter');
      const ok = async () => { const c = clipIn((await get(pid)).project, A)!; const k0 = c.keyframes!.x![0]!; return k0.easing === 'bezier' && JSON.stringify(k0.bezier) === JSON.stringify(want); };
      for (let i = 0; i < 40 && !(await ok()); i++) await sleep(150);
      const c = clipIn((await get(pid)).project, A)!;
      let worst = 0;
      for (let k = 0; k <= 30; k++) worst = Math.max(worst, Math.abs(at(c, k).x - segValue({ f: 0, v: -0.3 }, { f: 30, v: 0.3 }, k, (u) => bezierClosed(want, u), clampX)));
      check('P2', 'the custom curve typed into the four inputs is stored exactly and renders within 1e-12 of the closed form', (await ok()) && worst <= 1e-12, { stored: c.keyframes!.x![0], maxError: worst });
      await page.keyboard.press('Escape');
    });

    console.log('\n# P3 S and L on a middle key set both sides; after S the slope is continuous');
    await run('P3', async () => {
      const slopes = (c: Clip, k: number) => {
        const hh = T.rt(1, 10000), t0 = T.add(c.start, f(k)), v = (t: T.RationalTime) => transformAt(c, t).x, dt = 1 / 10000;
        const left = (3 * v(t0) - 4 * v(T.sub(t0, hh)) + v(T.sub(t0, T.add(hh, hh)))) / (2 * dt);
        const right = (-3 * v(t0) + 4 * v(T.add(t0, hh)) - v(T.add(t0, T.add(hh, hh)))) / (2 * dt);
        return { left, right, rel: Math.abs(left - right) / Math.max(1e-12, Math.abs(left), Math.abs(right)) };
      };
      const easingsAt = (c: Clip) => (c.keyframes?.x ?? []).map((k) => [fr(k.time), k.easing]);
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const via of ['strip', 'path'] as const) {
        await txs(pid, [{ op: 'replace_clip_keyframes', args: { clipId: M, property: 'x', keys: [{ time: f(0), value: -0.3, easing: 'linear' }, { time: f(15), value: 0.1, easing: 'linear' }, { time: f(30), value: 0.3, easing: 'linear' }] } }]);
        await select(M, 360);
        const target = via === 'strip' ? stripKey(15) : vertex(15);
        await target.waitFor({ timeout: 5000 });
        const r0 = (await get(pid)).revision;
        await target.focus();
        await page.keyboard.press('KeyS');
        await untilRev(pid, r0 + 1);
        const cs = clipIn((await get(pid)).project, M)!;
        const afterS = easingsAt(cs), sl = slopes(cs, 15);
        await target.focus();
        await page.keyboard.press('KeyL');
        const gL = await untilRev(pid, r0 + 2);
        const afterL = easingsAt(clipIn(gL.project, M)!);
        const both = (e: unknown[][], want: string) => e[0]?.[1] === want && e[1]?.[1] === want;
        const good = both(afterS, 'smooth') && sl.rel <= 1e-4 && both(afterL, 'linear') && gL.revision === r0 + 2;
        ok &&= good;
        rows[via] = { afterS, slope: { left: sl.left, right: sl.right, relative: sl.rel }, afterL, revisions: gL.revision - r0, good };
      }
      check('P3', 'S then L on the middle key (keyframe strip and path vertex) set the curve on both sides of it, one revision each; after S the slope is continuous at the key (≤ 1e-4 relative)', ok, rows);
    });

    console.log('\n# P4 the path overlay on the mapped transformAt (he and en)');
    await run('P4', async () => {
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const lang of ['he', 'en'] as const) {
        await page.evaluate((l) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
        await page.reload();
        await page.getByTestId('ruler').waitFor();
        await select(D, 185);
        await page.getByTestId(KF_TESTIDS.path).waitFor({ timeout: 5000 });
        const box = await pathBox();
        const pts = JSON.parse((await page.getByTestId(KF_TESTIDS.path).getAttribute('data-points')) ?? '[]') as [number, number, number][];
        const c = clipIn((await get(pid)).project, D)!;
        let worst = 0;
        for (const [k, x, y] of pts) { const tr = at(c, k); worst = Math.max(worst, Math.hypot(x - (box.width / 2 + tr.x * box.width), y - (box.height / 2 + tr.y * box.height))); }
        // the layer's box at the playhead sits on the path point of that frame
        const chBox = await page.locator('[data-testid=canvas-handles] .ch-box').boundingBox();
        const p5 = pts.find((p) => p[0] === 5); // the playhead is on frame 5 of the clip
        const centreErr = chBox && p5 ? Math.hypot(chBox.x + chBox.width / 2 - box.x - p5[1], chBox.y + chBox.height / 2 - box.y - p5[2]) : Infinity;
        const good = pts.length === 60 && worst <= 0.5 && centreErr <= 0.5;
        ok &&= good;
        rows[lang] = { points: pts.length, maxPx: Number(worst.toFixed(4)), boxCentrePx: Number(centreErr.toFixed(4)), vertices: await page.getByTestId(KF_TESTIDS.pathPoint).count() };
        await page.screenshot({ path: path.join(art, `motion-path-${lang}.png`) });
      }
      await page.evaluate(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      await page.reload();
      await page.getByTestId('ruler').waitFor();
      check('P4', 'the overlay\'s points are within 0.5 px of transformAt mapped onto the viewer on every frame, and the layer box centre is on the path at the playhead (he and en; motion-path-he.png, motion-path-en.png)', ok, rows);
    });

    console.log('\n# P5 a 40 px vertex drag');
    await run('P5', async () => {
      await select(B, 60);
      const before = clipIn((await get(pid)).project, B)!;
      const r0 = (await get(pid)).revision;
      const vb = (await vertex(15).boundingBox())!;
      const box = await pathBox();
      const x0 = vb.x + vb.width / 2, y0 = vb.y + vb.height / 2;
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 10, y0, { steps: 3 });
      await page.mouse.move(x0 + 40, y0, { steps: 6 });
      await page.mouse.up();
      const g = await untilRev(pid, r0 + 1);
      await sleep(400);
      const after = (await get(pid));
      const c = clipIn(after.project, B)!;
      const dx = at(c, 15).x - at(before, 15).x;
      let yExact = true, xOutside = true;
      for (let k = 0; k < 60; k++) {
        if (!Object.is(at(c, k).y, at(before, k).y)) yExact = false;
        if ((k <= 0 || k >= 30) && !Object.is(at(c, k).x, at(before, k).x)) xOutside = false;
      }
      check('P5', 'a 40 px vertex drag is one revision; Δx = 40 / rect.width ± 1e-4; y (untouched, its key at the vertex off the 1e-4 grid) is unchanged on every frame, and x (keyed by the drag) keeps its static value outside the two segments around the vertex', g.revision === r0 + 1 && after.revision === r0 + 1 && Math.abs(dx - 40 / box.width) <= 1e-4 && yExact && xOutside, { revisions: after.revision - r0, dx, want: 40 / box.width, yExact, xOutside, xKeys: (c.keyframes?.x ?? []).map((k) => [fr(k.time), k.value, k.easing]), yKeys: (c.keyframes?.y ?? []).map((k) => [fr(k.time), k.value, k.easing]) });
      await vertex(15).focus();
      await page.keyboard.press('ArrowRight');
      const g2 = await untilRev(pid, r0 + 2);
      await sleep(400);
      const after2 = await get(pid);
      const c2 = clipIn(after2.project, B)!;
      const nx = at(c2, 15).x - at(c, 15).x;
      let yExact2 = true;
      for (let k = 0; k < 60; k++) if (!Object.is(at(c2, k).y, at(before, k).y)) yExact2 = false;
      check('P5', 'ArrowRight on the vertex is one revision; Δx = 0.01 ± 1e-4; y (untouched) is still unchanged on every frame, so no op was made for it', g2.revision === r0 + 2 && after2.revision === r0 + 2 && Math.abs(nx - 0.01) <= 1e-4 && yExact2, { revisions: after2.revision - r0, nx, yExact: yExact2, yKeys: (c2.keyframes?.y ?? []).map((k) => [fr(k.time), k.value, k.easing]) });
    });

    console.log('\n# P6 the bend grip');
    await run('P6', async () => {
      await select(C, 120);
      const r0 = (await get(pid)).revision;
      await page.screenshot({ path: path.join(art, 'bend-before.png') });
      const grip = page.locator(`[data-testid=${KF_TESTIDS.bend}][data-from="0"][data-to="40"]`);
      const gb = (await grip.boundingBox())!;
      const box = await pathBox();
      const gx = gb.x + gb.width / 2, gy = gb.y + gb.height / 2, px = gx + 12, py = gy - 60;
      await page.mouse.move(gx, gy);
      await page.mouse.down();
      await page.mouse.move(gx + 5, gy - 20, { steps: 3 });
      await page.mouse.move(px, py, { steps: 6 });
      await page.mouse.up();
      const g = await untilRev(pid, r0 + 1);
      await sleep(400);
      await page.screenshot({ path: path.join(art, 'bend-after.png') });
      const c = clipIn(g.project, C)!;
      const p20 = at(c, 20);
      const sx = box.x + box.width / 2 + p20.x * box.width, sy = box.y + box.height / 2 + p20.y * box.height;
      const err = Math.hypot(sx - px, sy - py);
      const ease = (p: 'x' | 'y', k: number) => c.keyframes?.[p]?.find((q) => fr(q.time) === k)?.easing;
      const smooth = (['x', 'y'] as const).every((p) => ease(p, 20) === 'smooth' && ease(p, 0) === 'smooth');
      const note = (await page.getByTestId(KF_TESTIDS.pathNote).textContent()) ?? '';
      check('P6', 'the bend grip inserts an x+y vertex at the middle frame (20), smooth on both sides, within 1 px of the pointer, in one revision (bend-before.png, bend-after.png)', g.revision === r0 + 1 && smooth && err <= 1, { revisions: g.revision - r0, pointerErrorPx: Number(err.toFixed(4)), x: (c.keyframes?.x ?? []).map((k) => [fr(k.time), k.easing]), y: (c.keyframes?.y ?? []).map((k) => [fr(k.time), k.easing]), note });
    });

    console.log('\n# P7 keyboard walk on the keyframe strip');
    await run('P7', async () => {
      await select(D, 180);
      const d0 = (await get(pid));
      const c0 = clipIn(d0.project, D)!;
      const count0 = allClips(d0.project).length;
      await page.keyboard.press('Alt+KeyK');
      const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
      const head = async () => Number(await page.getByTestId('playhead').getAttribute('data-frame'));
      await page.keyboard.press('Period');
      await sleep(200);
      const afterPeriod = await head();
      await page.keyboard.press('Comma');
      await sleep(200);
      const afterComma = await head();
      await stripKey(0).focus();
      const revs: number[] = [d0.revision];
      for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
        // the key's button is re-made at its new frame: focus the selected one again (as a person tabbing back would)
        if (revs.length > 1) await page.locator(`[data-testid=${KF_TESTIDS.key}][aria-pressed=true]`).first().focus();
        await page.keyboard.press(key); revs.push((await untilRev(pid, revs.at(-1)! + 1)).revision); await sleep(150); }
      const moved = (clipIn((await get(pid)).project, D)!.keyframes?.x ?? []).map((k) => fr(k.time));
      await page.locator(`[data-testid=${KF_TESTIDS.key}][aria-pressed=true]`).first().focus();
      await page.keyboard.press('Delete');
      const gDel = await untilRev(pid, revs.at(-1)! + 1);
      const c1 = clipIn(gDel.project, D)!;
      const xs = (c1.keyframes?.x ?? []).map((k) => fr(k.time));
      const startFrame = fr(c0.start);
      const ok = focused === KF_TESTIDS.key && afterPeriod === startFrame + 10 && afterComma === startFrame && revs.every((r, i) => i === 0 || r === revs[i - 1]! + 1) && JSON.stringify(moved) === JSON.stringify([1, 10, 20]) && gDel.revision === revs.at(-1)! + 1 && JSON.stringify(xs) === JSON.stringify([10, 20]) && allClips(gDel.project).length === count0 && T.eq(c1.start, c0.start);
      check('P7', 'keyboard walk: Alt+K focuses the strip, Period/Comma visit the keys, → → ← move the key one frame each in one revision each, Delete removes it; the clip count and clip start are unchanged', ok, { focused, afterPeriod, afterComma, revisions: revs.map((r) => r - d0.revision), moved, afterDelete: xs, clips: [count0, allClips(gDel.project).length] });
      await txs(pid, [{ op: 'replace_clip_keyframes', args: { clipId: D, property: 'x', keys: [{ time: f(0), value: -0.2, easing: 'ease-in' }, { time: f(10), value: 0.1, easing: 'ease-out' }, { time: f(20), value: 0.25, easing: 'linear' }] } }]);
    });

    console.log('\n# P8 copy and paste keys to a second clip');
    await run('P8', async () => {
      await select(D, 180);
      await stripKey(0).focus();
      await page.keyboard.press('ControlOrMeta+KeyA');
      await page.keyboard.press('ControlOrMeta+KeyC');
      await select(E, 245);
      const r0 = (await get(pid)).revision;
      await stripKey(0).focus();
      await page.keyboard.press('ControlOrMeta+KeyV');
      const g = await untilRev(pid, r0 + 1);
      await sleep(400);
      const after = await get(pid);
      const src = clipIn(after.project, D)!, dst = clipIn(after.project, E)!;
      const exact = (['x', 'y'] as const).every((p) => (src.keyframes?.[p] ?? []).every((k) => {
        const q = dst.keyframes?.[p]?.find((z) => fr(z.time) === fr(k.time) + 5);
        return !!q && Object.is(q.value, k.value) && q.easing === k.easing;
      }));
      check('P8', 'copied keys (x and y of clip D) paste onto clip E at the playhead offset (+5 frames) with exact values and curves, in one revision', g.revision === r0 + 1 && after.revision === r0 + 1 && exact, { revisions: after.revision - r0, x: (dst.keyframes?.x ?? []).map((k) => [fr(k.time), k.value, k.easing]), y: (dst.keyframes?.y ?? []).map((k) => [fr(k.time), k.value, k.easing]) });
    });

    console.log('\n# P9 a format view: the path is read-only');
    await run('P9', async () => {
      await chooseFormat(page, tall);
      await select(M, 360);
      await page.getByTestId(KF_TESTIDS.path).waitFor({ timeout: 5000 });
      const r0 = (await get(pid)).revision;
      const editable = await page.getByTestId(KF_TESTIDS.path).getAttribute('data-editable');
      const reason = await page.locator(`[data-testid=${KF_TESTIDS.pathReason}][data-reason=format]`).count();
      const v = vertex(15);
      const vb = (await v.boundingBox())!;
      await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2);
      await page.mouse.down();
      await page.mouse.move(vb.x + vb.width / 2 + 40, vb.y + vb.height / 2 + 10, { steps: 6 });
      await page.mouse.up();
      await v.focus();
      for (const key of ['ArrowRight', 'ArrowUp', 'Delete', 'KeyS']) await page.keyboard.press(key);
      const grip = page.getByTestId(KF_TESTIDS.bend).first();
      if (await grip.count()) { await grip.focus(); await page.keyboard.press('Enter'); }
      await sleep(1500);
      const after = (await get(pid)).revision;
      const disabled = await v.getAttribute('aria-disabled');
      await chooseFormat(page, '');
      check('P9', 'in a format view the path is drawn read-only (aria-disabled vertices, the stated reason): a drag, arrow keys, S, Delete and a bend make 0 revisions', after === r0 && editable === 'false' && reason === 1 && disabled === 'true', { revisions: after - r0, editable, reason, disabled });
    });

    console.log('\n# P10 the opacity picker and the flash rule over REST and MCP');
    await run('P10', async () => {
      await select(F, 300);
      await page.getByTestId(KF_TESTIDS.chip('opacity')).focus();
      await page.keyboard.press('Enter');
      await page.getByTestId(KF_TESTIDS.picker).waitFor({ timeout: 5000 });
      const tiles: Record<string, string | null> = {};
      for (const id of ['overshoot', 'anticipate', 'bounce', 'spring', 'gentle', 'smooth', 'sharp']) tiles[id] = await page.getByTestId(KF_TESTIDS.tile(id)).getAttribute('aria-disabled');
      await page.keyboard.press('Escape');
      const want = KEYFRAME_REFUSALS.curveFlash.message('overshoot', 'opacity');
      const body = { clipId: F, channels: [{ property: 'opacity' }], times: [f(0)], side: 'after', easing: 'overshoot' };
      const rest = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_keyframe_curve', args: body }] });
      const mcp = new Client({ name: 'keyframes-proof', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
      conn.mcp = mcp;
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
      const r: any = await mcp.callTool({ name: 'set_keyframe_curve', arguments: { projectId: pid, ...body } });
      const mcpData = r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}');
      const mcpMsg = mcpData?.error?.message ?? mcpData?.message;
      const he = translateRefusal('he', want);
      const turnBackOff = ['overshoot', 'anticipate', 'bounce', 'spring'].every((id) => tiles[id] === 'true') && ['gentle', 'smooth', 'sharp'].every((id) => tiles[id] !== 'true');
      check('P10', 'the opacity picker disables the turn-back tiles (overshoot, anticipate, bounce, spring) and leaves the others; REST and MCP refuse Overshoot on opacity with the curve-flash refusal, which has its Hebrew wording', turnBackOff && rest.status >= 400 && rest.body?.error?.code === KEYFRAME_REFUSALS.curveFlash.code && rest.body?.error?.message === want && !!r.isError && mcpMsg === want && !!he && /[֐-׿]/.test(he), { tiles, rest: { status: rest.status, code: rest.body?.error?.code, message: rest.body?.error?.message }, mcp: { isError: !!r.isError, message: mcpMsg }, hebrew: he });
    });

    console.log('\n# P13 a follower\'s path is hidden with its reason');
    await run('P13', async () => {
      const up = await upload(pid, videoFile);
      const added = await txs(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(420), duration: f(60), withLinkedAudio: false } }]);
      const vTrack = added.results[0].output.trackId as string;
      const mt = (await txs(pid, [{ op: 'create_motion_track', args: { assetId: up.assetId, kind: 'point', frame: 0, x: 5000, y: 5000, name: 'P13' } }])).results[0].output.motionTrackId as string;
      const Fo = await textClip(pid, 420, 60, { x: 0, y: 0 }, [['x', 0, -0.1, 'linear'], ['x', 30, 0.1, 'linear']]);
      await txs(pid, [{ op: 'set_clip_follow', args: { clipId: Fo, follow: { motionTrackId: mt, targetTrackId: vTrack, scale: false, smooth: 0 } } }]);
      await select(Fo, 425);
      const reason = page.locator(`[data-testid=${KF_TESTIDS.pathReason}][data-reason=follower]`);
      await reason.waitFor({ timeout: 5000 }).catch(() => {});
      const text = (await reason.count()) ? await reason.textContent() : null;
      const drawn = await page.getByTestId(KF_TESTIDS.path).count();
      check('P13', 'a clip that follows a motion track shows no path, and says why (keys.path.follower)', drawn === 0 && !!text && /[֐-׿]/.test(text), { drawn, text });
    });

    console.log('\n# P12 the cross-host curve hash; sampler and pathPoints cost');
    await run('P12', async () => {
      const node = await curveHash();
      const nodePath = pathPointsMs();
      const st = await ctx.newPage();
      await st.goto(`${s.url}/selftest.html`);
      await st.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 120_000 });
      const chromiumHash = await st.evaluate(() => (window as unknown as { __pfCurveHash: () => Promise<{ sha256: string; samples: number; nsPerSample: number; byEasing?: Record<string, string> }> }).__pfCurveHash());
      const chromiumPath = await st.evaluate(() => (window as unknown as { __pfPathPointsMs: () => { ms: number; points: number } }).__pfPathPointsMs());
      const chromiumSamples = await st.evaluate(() => (window as unknown as { __pfCurveSamples: () => number[] }).__pfCurveSamples());
      const nodeSamples = curveSamples();
      await st.close();
      // the whole hash and, to say which curve a difference is in, one hash per easing; the v1 easings are checked on their own
      // (they are kept bit-identical with keys-baseline.json, which is Node's arithmetic), with the same strictness
      const differ = EASINGS.filter((e) => chromiumHash.byEasing?.[e] !== node.byEasing[e]);
      const v1 = new Set<string>(V1_EASINGS);
      // the whole-set hash cannot be equal while the v1 easings may differ by an ulp (below); it is recorded beside this check
      check('P12', 'the curves of ADR-0019 (named, smooth, bounce, spring, custom) sample to the same bits in Chromium and Node, each easing hashed alone (100 000 samples, shutter taps)', chromiumHash.samples === 100_000 && differ.filter((e) => !v1.has(e)).length === 0, { differ: differ.filter((e) => !v1.has(e)), wholeSet: { node: node.sha256, chromium: chromiumHash.sha256 } });
      // The v1 easings keep their arithmetic (`**` in ease-out and ease-in-out) so old projects sample exactly as before on the
      // host they always rendered on (keys-baseline.json, the v1 replay). V8's `**` gives a different last bit for some
      // arguments in Node 22 and in Chromium 153; pixels come from one host, the Chromium renderer, for preview, still and export.
      // So for v1 only, the bound is at most 1 ulp on every sample, measured over the full sample set (lead decision 2026-11-18).
      const cSamples = chromiumSamples;
      let maxUlp = 0, differing = 0, worst: unknown = null, maxAbs = 0;
      const ulpHist: Record<number, number> = {};
      for (let i = 0; i < nodeSamples.length; i++) {
        if (!v1.has(EASINGS[i % EASINGS.length]!)) continue;
        const u = ulpDistance(nodeSamples[i]!, cSamples[i]!);
        if (u) { differing++; ulpHist[u] = (ulpHist[u] ?? 0) + 1; maxAbs = Math.max(maxAbs, Math.abs(nodeSamples[i]! - cSamples[i]!)); if (u > maxUlp) { maxUlp = u; worst = { sample: i, easing: EASINGS[i % EASINGS.length], node: nodeSamples[i], chromium: cSamples[i] }; } }
      }
      const v1Count = nodeSamples.filter((_, i) => v1.has(EASINGS[i % EASINGS.length]!)).length;
      check('P12', 'the v1 easings (linear, hold, ease-in, ease-out, ease-in-out) differ between Chromium and Node by at most 1 ulp on every sample (the full sample set); the difference is measured and reported', cSamples.length === nodeSamples.length && maxUlp <= 1, { maxUlp, differingSamples: differing, v1Samples: v1Count, ulpHistogram: ulpHist, maxAbsoluteDifference: maxAbs, note: 'ulps of the sample: a 1-ulp difference of the easing shape near 1 becomes several ulps of a sample whose value is near 0 (the segment value a + (b − a)·shape)', easingsThatDiffer: differ.filter((e) => v1.has(e)), worst, why: 'V8 `**` (ease-out, ease-in-out) differs in the last bit between Node 22 and Chromium 153; the v1 arithmetic is kept so old projects sample exactly as before on the host they always rendered on; pixels come from one host (the Chromium renderer) for preview, still and export' });
      measure('sampler ns/sample (Chromium)', chromiumHash.nsPerSample, '≤ 2000 ns', chromiumHash.nsPerSample <= 2000);
      measure('sampler ns/sample (Node)', node.nsPerSample, '≤ 2000 ns', node.nsPerSample <= 2000);
      measure('pathPoints ms for 600 points (Chromium, median of 15)', chromiumPath.ms, '≤ 16 ms', chromiumPath.ms <= 16 && chromiumPath.points === 600, { points: chromiumPath.points });
      measure('pathPoints ms for 600 points (Node, median of 15)', nodePath.ms, '≤ 16 ms', nodePath.ms <= 16 && nodePath.points === 600, { points: nodePath.points });
    });

    console.log('\n# recorded: commit p95 of a 2000-key replace against a 1-key replace');
    await run('commit', async () => {
      const G = await textClip(pid, 600, 2000, { x: 0, y: 0 }, []);
      const time = async (keys: number, n: number) => {
        const out: number[] = [];
        for (let i = 0; i < n; i++) {
          const ks = Array.from({ length: keys }, (_, k) => ({ time: f(k), value: Number((((k * 37 + i * 11) % 200) / 1000 - 0.1).toFixed(4)), easing: k % 3 === 0 ? 'smooth' : k % 3 === 1 ? 'overshoot' : 'linear' }));
          const t0 = performance.now();
          await txs(pid, [{ op: 'replace_clip_keyframes', args: { clipId: G, property: 'x', keys: ks } }]);
          out.push(performance.now() - t0);
        }
        return out;
      };
      await time(1, 3); // warm up
      const one = await time(1, 20), big = await time(2000, 20);
      const size = JSON.stringify((await get(pid)).project).length;
      const delta = pct(big, 95) - pct(one, 95);
      // recorded, not gated (the tracking proof's P13 precedent; lead decision 2026-11-18): a CPU profile of Store.commit at 2000
      // keys finds the time in per-commit work over the whole document (JSON parse and schema migration of the stored document,
      // applyTransaction, structuredClone, the entity diff, the SQLite write), which grows with the document's size; nothing in it
      // is specific to keyframes
      measure('replace_clip_keyframes commit p95: 2000 keys minus 1 key (ms)', Number(delta.toFixed(2)), '≤ +15 ms', delta <= 15, { p95_1key: Number(pct(one, 95).toFixed(2)), p95_2000keys: Number(pct(big, 95).toFixed(2)), documentBytes: size, finding: 'per-commit cost over the whole document (parse + migrate, applyTransaction, structuredClone, entity diff, SQLite write), growing with document size; not keyframe-specific (CPU profile of Store.commit with 2000 keys)', label: 'recorded, not gated' }, false);
    });
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
    await ctx.close();

    console.log('\n# P11 export and render_frame against the closed form');
    await run('P11', async () => {
      const pid2 = (await call('/projects', { name: 'keyframes-export', width: W0, height: H0 })).body.project.id as string;
      const up = await upload(pid2, squarePng);
      const sq = (await txs(pid2, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0), duration: f(60), withLinkedAudio: false } }])).results[0].output.clipId as string;
      await txs(pid2, [
        { op: 'set_keyframe', args: { clipId: sq, property: 'x', time: f(0), value: -0.25, easing: 'overshoot' } },
        { op: 'set_keyframe', args: { clipId: sq, property: 'x', time: f(59), value: 0.25, easing: 'linear' } },
        { op: 'set_keyframe', args: { clipId: sq, property: 'y', time: f(0), value: -0.2, easing: 'smooth' } },
        { op: 'set_keyframe', args: { clipId: sq, property: 'y', time: f(59), value: 0.2, easing: 'linear' } },
      ]);
      const truth = (k: number) => ({
        x: W0 / 2 + segValue({ f: 0, v: -0.25 }, { f: 59, v: 0.25 }, k, (u) => bezierClosed(NAMED_BEZIER.overshoot, u), clampX) * W0,
        y: H0 / 2 + segValue({ f: 0, v: -0.2 }, { f: 59, v: 0.2 }, k, smoothstep, clampY) * H0,
      });
      const st = await call(`/projects/${pid2}/exports`, {});
      if (st.status !== 202) throw new Error(`export refused: ${JSON.stringify(st.body).slice(0, 300)}`);
      const job = await waitJob(st.body.jobId);
      if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
      const file = path.join(art, 'export.mp4');
      fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
      const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
      const frames = raw.length / (W0 * H0);
      const errs: number[] = [];
      for (let k = 0; k < Math.min(60, frames); k++) { const c = centroid({ w: W0, h: H0, y: raw }, k * W0 * H0); const t = truth(k); errs.push(c ? Math.hypot(c.x - t.x, c.y - t.y) : Infinity); }
      const stills: Record<number, number> = {};
      for (const k of [0, 12, 25, 40, 59]) {
        const r = await call(`/projects/${pid2}/frame?index=${k}`);
        if (r.status !== 200) { stills[k] = Infinity; continue; }
        const g = decodePngGrey(r.body as Buffer);
        const c = centroid(g), t = truth(k);
        stills[k] = c ? Number(Math.hypot(c.x - t.x, c.y - t.y).toFixed(4)) : Infinity;
      }
      const worst = Math.max(...errs);
      check('P11', 'export of 60 frames 640×360 (x overshoot, y smooth): the white square\'s centroid on every decoded frame is within 0.5 px of the closed form; render_frame at 5 frames meets the same bound', frames >= 60 && errs.length === 60 && worst <= 0.5 && Object.values(stills).every((e) => e <= 0.5), { frames, maxPx: Number(worst.toFixed(4)), worstFrame: errs.indexOf(worst), stills });
    });
  } catch (e) {
    console.error(e);
    check('run', 'proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await conn.mcp?.close().catch(() => {});
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const overBudget = Object.entries(measurements).filter(([, m]) => m.ok === false && m.gated).map(([k]) => k);
    const recordedMisses = Object.entries(measurements).filter(([, m]) => m.ok === false && !m.gated).map(([k]) => k);
    const ids = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13'];
    const missing = ids.filter((id) => !checks.some((c) => c.id === id));
    const result = failed.length || overBudget.length || missing.length ? 'FAILED' : 'PASSED';
    const report = {
      proof: 'keyframes', adr: 'ADR-0019', ranAt: new Date().toISOString(), result,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, node: process.version },
      scope: 'Keyframe curves and motion paths, wave 1: the curve picker, the keyframe strip and the motion path in headless Chromium, REST and MCP refusals, stills (render_frame) and an mp4 export decoded with ffmpeg, against closed forms written out in this proof. Synthetic titles and a synthetic white square only; nobody looked at the pictures.',
      passed: checks.length - failed.length, total: checks.length, missing, overBudget, recordedNotGated: recordedMisses, measurements, checks,
    };
    fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
    fs.writeFileSync(evidenceFile, JSON.stringify(report, null, 2) + '\n');
    console.log(`\nKeyframes proof ${result}: ${report.passed}/${report.total}${missing.length ? `, missing ${missing.join(' ')}` : ''}${overBudget.length ? `, over budget: ${overBudget.join('; ')}` : ''}${recordedMisses.length ? `; recorded, not gated, over its budget: ${recordedMisses.join('; ')}` : ''}`);
    if (result !== 'PASSED') process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
