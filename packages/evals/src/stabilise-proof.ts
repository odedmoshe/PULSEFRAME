/**
 * pnpm proof:stabilise — stabilisation, model-free (wave 7 stabilise track; .artifacts/wave7/stabilise-decisions.md §4). Needs
 * `pnpm build` first (stills and the editor come from the built web bundle). Exit 0 = every check passed, 1 = a check failed,
 * 2 = a check could not run (blocked); a check that did not run is never counted as passed.
 * Fixtures are SYNTHETIC only, made here with packages/fixtures/src/steady.ts and FFmpeg: 1280×720, 30 fps, 180 frames, a world with
 * its own texture and five ringed discs seen through a known camera path (slow pan + band-limited shake). No owner clip is used.
 * Thresholds are the designer's; the measured value of every check is printed and written to docs/evidence/stabilise-proof.json.
 * One timing is one sample. PF_STAB_ONLY=S1,S10 runs the named checks only (development; the evidence file is then not written).
 *
 * Fixtures: F1 plain · F2 a foreground block with its own motion over 25 % · F3 the block over 65 % · F4 flat grey with faint noise ·
 * F5 a hard cut at frame 90 to a world ≥ 40 grey levels apart · F7 a steady pan, no shake · F8 a portrait picture in the landscape
 * project · F9 a picture-in-picture clip.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import {
  cropAreaPercent, expm, limitToCover, neededZoom, planStabilise, SST, STEADY_ALGO, steadyHalfWindow, steadyPose, steadyPoseDigest, sinCos, stretchEnd,
  type CameraMotion, type MediaClip, type ProjectDocument,
} from '@pulseframe/core';
import { describeMoment } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import { steadyFixture, writeSteadyFixture, type SteadyFixture, type SteadyVariant } from '../../fixtures/src/steady.ts';

export const STABILISE_PROOF_BUILT = true;
export const STABILISE_CHECKS: Readonly<Record<string, string>> = {
  S1: 'kernel on F1: every frame after the first is ok; translation error p95 ≤ 0.3 source px, rotation p95 ≤ 0.02° (measured values reported)',
  S2: 'kernel on F2: the same bounds as S1 (the block\'s points are rejected)',
  S3: 'F3: at least 80 % of the frames with the block are weak, none ok (competing motions at ≥ 24 points and ≥ 40 % support; both ratios reported)',
  S4: 'F4: under 50 % measured; set_clip_stabilise refused with tooLittle; the document unchanged',
  S5: 'F5: frame 90 is start, 89 and 91 ok; the poses of 89 and 90 use no sample across the cut',
  S6: 'F7: zoomPm 1000 and an identity pose on every frame, edges included, at strengths 1, 50 and 100',
  S7: 'steadyPose digest over F1 at strengths 1, 50, 100 is identical in Node and in headless Chromium (window.__pfSteadyHash)',
  S8: 'sinCos and expm are within 1e-12 of Math.sin, Math.cos, Math.exp over their ranges',
  S9: '2,000 seeded poses and zooms: limitToCover returns a pose that covers; neededZoom covers and 0.999 of it does not',
  S10: 'export of F1 at strength 50: disc-centroid acceleration RMS ≤ 1/10 of the unstabilised export; each centroid within 0.5 px of the prediction',
  S11: 'no background pixel on ≥ 30 lossless render_frame stills per variant (automatic zoom, and zoomPm 1010 where the frames are listed limited), and on the export within a stated colour tolerance',
  S12: 'areaPercent equals 100·(1 − 10⁶/zoomPm²); zoomPm is within 0.5 % above the zoom the truth needs',
  S13: 'five frames as render_frame stills, decoded from the export and read from the editor preview agree within the parity tolerances',
  S14: 'the still of a source frame is byte-identical before and after split_clip, slip_clip, set_clip_speed 2 and 0.5, set_clip_reverse; the freeze frame equals its frame',
  S15: 'echo taps and a velocity ramp carry the pose of their own source frame (describe_moment); cover holds; ramp-only limits say reach',
  S16: 'a tracked region on a disc, stabilised: ≥ 80 % Laplacian loss on every exported frame; its centre within 1.5 px of the disc',
  S17: 'a sticker that follows a disc is within 1.5 px of its centroid in the stabilised export',
  S18: 'F8: no content outside its own rectangle on any frame',
  S19: 'after the job one undo returns the document hash from before the press; redo returns the stabilised hash',
  S20: 'F9 with a covering privacy region at its edge, and in the whole-picture fallback: no changed pixel outside its own rectangle',
  S21: 'a strength change is one commit, no job, no decode; the crop line equals the operation\'s output',
  S22: 'the slider at 100 on a clip measured at 50 starts no job and lists no outside frame',
  S23: 'a second clip of the same file stabilised: the still of a frame of the first clip is byte-identical',
  S24: 'cancel mid-run: status canceled, FFmpeg gone, the document unchanged',
  S25: 'the clip deleted while the job runs: the job fails clip_changed, the document unchanged',
  S26: 'a measurement that would pass 43,200 shared samples is refused with budget before 202; nothing attached',
  S27: 'preflight lists stabilise_limited and stabilise_unmeasured at the right timeline ranges at speed 1 and 2; warnings only',
  S28: 'recorded, not gated (one run): frames a second, event-loop lag p50/p99, commit delta at 10,800 camera samples, planStabilise time at 1,800 frames',
};

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/stabilise-proof');
const ONLY = process.env.PF_STAB_ONLY ? new Set(process.env.PF_STAB_ONLY.split(',')) : null;
type Verdict = { id: string; status: 'passed' | 'failed' | 'blocked'; detail: unknown };
const verdicts: Verdict[] = [];
const measurements: Record<string, unknown> = {};
const record = (id: string, status: Verdict['status'], detail: unknown) => { verdicts.push({ id, status, detail }); console.log(`${status === 'passed' ? '  ok  ' : status === 'failed' ? ' FAIL ' : 'BLOCK '} ${id} ${STABILISE_CHECKS[id]?.slice(0, 70) ?? ''}\n         ${JSON.stringify(detail)}`); };
/** Run one check: it returns {ok, detail} (or {blocked}); an exception is a failure with its message. */
async function check(id: string, fn: () => Promise<{ ok: boolean; detail: unknown } | { blocked: string }>): Promise<void> {
  if (ONLY && !ONLY.has(id)) return;
  try {
    const r = await fn();
    if ('blocked' in r) record(id, 'blocked', r.blocked);
    else record(id, r.ok ? 'passed' : 'failed', r.detail);
  } catch (e) { record(id, 'failed', { exception: String((e as Error).stack ?? e).slice(0, 700) }); }
}
const want = (...ids: string[]) => !ONLY || ids.some((i) => ONLY.has(i));

// ---------------------------------------------------------------- small helpers ----------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R30 = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R30);
const W = 1280, H = 720, HH = 9 / 32;
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const pct = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const r3 = (v: number) => Number(v.toFixed(3));
const r4 = (v: number) => Number(v.toFixed(4));
interface Rgb { w: number; h: number; rgb: Buffer }
const decodePng = (png: Buffer): Rgb => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
/** Pixels that are not grey: the project's background (magenta) shows through where the picture does not cover. tol = the largest channel spread still counted as grey. */
function nonGrey(p: Rgb, tol: number, inside?: { x0: number; y0: number; x1: number; y1: number }): number {
  let n = 0;
  for (let y = 0, i = 0; y < p.h; y++) for (let x = 0; x < p.w; x++, i += 3) {
    if (inside && (x < inside.x0 || x >= inside.x1 || y < inside.y0 || y >= inside.y1)) continue;
    const r = p.rgb[i]!, g = p.rgb[i + 1]!, b = p.rgb[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > tol) n++;
  }
  return n;
}
const lum = (rgb: Buffer, i: number) => 0.299 * rgb[i]! + 0.587 * rgb[i + 1]! + 0.114 * rgb[i + 2]!;
/** The centre of a ringed disc near (x0, y0) (frame px, continuous coordinates): the centroid of (L − 128)² inside a circle of radius `r`, re-centred until it settles. The ring pattern is 128 + 100·cos(2π·d/16), so (L − 128)² is zero at d = 20: a radius of 20 (times the picture's scale) cuts no ring in half, which a radius of 24 does (that biased the centre by 4 px). */
function discCentre(p: Rgb, x0: number, y0: number, r = 20): { x: number; y: number; weight: number } | null {
  let cx = x0, cy = y0, weight = 0;
  for (let it = 0; it < 12; it++) {
    let sx = 0, sy = 0, sw = 0;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(p.h - 1, Math.ceil(cy + r)); y++) for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(p.w - 1, Math.ceil(cx + r)); x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
      const v = lum(p.rgb, (y * p.w + x) * 3) - 128, w = v * v;
      sx += w * (x + 0.5); sy += w * (y + 0.5); sw += w;
    }
    if (sw === 0) return null;
    const nx = sx / sw, ny = sy / sw;
    weight = sw;
    if (Math.hypot(nx - cx, ny - cy) < 0.002) { cx = nx; cy = ny; break; }
    cx = nx; cy = ny;
  }
  return { x: cx, y: cy, weight };
}
/** Centre of the magenta pixels (the sticker), continuous coordinates. */
function magenta(p: Rgb): { x: number; y: number; n: number } | null {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0, i = 0; y < p.h; y++) for (let x = 0; x < p.w; x++, i += 3) if (p.rgb[i]! > 200 && p.rgb[i + 2]! > 200 && p.rgb[i + 1]! < 80) { n++; sx += x + 0.5; sy += y + 0.5; }
  return n ? { x: sx / n, y: sy / n, n } : null;
}
/** Mean |Laplacian| of the luminance inside a circle (frame px). */
function circleEnergy(p: Rgb, cx: number, cy: number, r: number): number {
  const L = (x: number, y: number) => lum(p.rgb, (y * p.w + x) * 3);
  let s = 0, n = 0;
  for (let y = Math.max(1, Math.floor(cy - r)); y <= Math.min(p.h - 2, Math.ceil(cy + r)); y++) for (let x = Math.max(1, Math.floor(cx - r)); x <= Math.min(p.w - 2, Math.ceil(cx + r)); x++)
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) { s += Math.abs(4 * L(x, y) - L(x - 1, y) - L(x + 1, y) - L(x, y - 1) - L(x, y + 1)); n++; }
  return n ? s / n : 0;
}
const luma = (b: Buffer, w: number, h: number) => { const y = new Float32Array(w * h); for (let p = 0; p < w * h; p++) y[p] = 0.2126 * b[p * 3]! + 0.7152 * b[p * 3 + 1]! + 0.0722 * b[p * 3 + 2]!; return y; };
/** Mean SSIM over 8×8 windows, stride 4, BT.709 luma (as the parity suite). */
function ssim(a: Buffer, b: Buffer, w: number, h: number): number {
  const ya = luma(a, w, h), yb = luma(b, w, h), C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  let sum = 0, n = 0;
  for (let y0 = 0; y0 + 8 <= h; y0 += 4) for (let x0 = 0; x0 + 8 <= w; x0 += 4) {
    let ma = 0, mb = 0, saa = 0, sbb = 0, sab = 0;
    for (let y = y0; y < y0 + 8; y++) for (let x = x0; x < x0 + 8; x++) { const va = ya[y * w + x]!, vb = yb[y * w + x]!; ma += va; mb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; }
    ma /= 64; mb /= 64;
    const va = saa / 64 - ma * ma, vb = sbb / 64 - mb * mb, cv = sab / 64 - ma * mb;
    sum += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); n++;
  }
  return sum / n;
}
function psnr(a: Buffer, b: Buffer): number {
  let se = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; se += d * d; }
  const mse = se / a.length;
  return mse === 0 ? 99 : Math.min(99, 10 * Math.log10((255 * 255) / mse));
}
/** An independent coverage test (Math functions; core steady.ts uses none): all four window corners map back inside the content. */
function covers(p: { r: number; l: number; tx: number; ty: number }, Z: number, hh: number, slack = 1e-9): boolean {
  const c = Math.cos(-p.r), s = Math.sin(-p.r), e = Math.exp(-p.l);
  for (const cx of [-0.5, 0.5]) for (const cy of [-hh, hh]) {
    const ux = cx / Z - p.tx, uy = cy / Z - p.ty;
    const qx = e * (c * ux - s * uy), qy = e * (s * ux + c * uy);
    if (Math.abs(qx) > 0.5 + slack || Math.abs(qy) > hh + slack) return false;
  }
  return true;
}
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
const origin = (m: string) => ({ method: m, params: { algo: STEADY_ALGO, input: 'original' }, createdAt: '2026-11-25T00:00:00Z', createdBy: 'proof' });
/** The truth of a fixture as a stored camera motion over [from, to). */
const truthMotion = (fx: SteadyFixture, from = 0, to = fx.frames): CameraMotion => ({ stretches: [{ ...fx.columns(from, to), origin: origin('truth') }] });
const docHashOf = (d: ProjectDocument) => createHash('sha256').update(JSON.stringify(d)).digest('hex');
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'proof' };

/** Where source point (px, py) of the picture (frame-sized, centred) lands after the correction `pose` at `zoom`: written out by hand (Math functions), the clip at its own placement. */
function predict(pose: { r: number; l: number; tx: number; ty: number }, zoom: number, px: number, py: number, w = W, h = H): { x: number; y: number } {
  const e = Math.exp(pose.l) * zoom, c = Math.cos(pose.r), s = Math.sin(pose.r), dx = px - w / 2, dy = py - h / 2;
  return { x: w / 2 + zoom * pose.tx * w + e * (c * dx - s * dy), y: h / 2 + zoom * pose.ty * w + e * (s * dx + c * dy) };
}

async function main() {
  // development runs (PF_STAB_ONLY) keep the fixture files of an earlier run; a full run starts clean
  if (!ONLY) fs.rmSync(art, { recursive: true, force: true });
  fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const evidenceDir = path.join(root, 'docs/evidence');

  // ---------- fixtures ----------
  const t0 = Date.now();
  const fxs: Partial<Record<SteadyVariant, SteadyFixture>> = {};
  const files: Partial<Record<SteadyVariant, string>> = {};
  const need = (...v: SteadyVariant[]) => v.filter((x) => !fxs[x]);
  const makeFx = async (v: SteadyVariant) => { const fx = steadyFixture({ variant: v }); fxs[v] = fx; files[v] = path.join(art, `${v}.mp4`); if (!(ONLY && fs.existsSync(files[v]!))) await writeSteadyFixture(fx, files[v]!); };
  const all: SteadyVariant[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F7', 'F8', 'F9'];
  for (const v of all) await makeFx(v);
  void need;
  const longFx = steadyFixture({ variant: 'F1', frames: 900 });
  const longFile = path.join(art, 'long.mp4');
  if (!(ONLY && fs.existsSync(longFile))) await writeSteadyFixture(longFx, longFile, { width: 640, height: 360 });
  console.log(`fixtures: ${all.length} × 180 frames at 1280×720 and one of 900 frames at 640×360, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const F = (v: SteadyVariant) => fxs[v]!;

  // ---------- the server ----------
  const dataDir = path.join(art, 'data');
  const s = await startServer({ port: 8851, dataDir });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 500)}`); return r.body; };
  const tryTx = (pid: string, ops: unknown[]) => call(`/projects/${pid}/transactions`, { ops });
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const doc = (pid: string): ProjectDocument => s.store.getProject(pid).doc;
  const waitJob = async (id: string, ms = 600_000) => { const t = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t > ms) throw new Error(`job ${id} did not finish`); await sleep(100); } };
  const waitProxy = async (pid: string, assetId: string) => { for (let i = 0; i < 1200; i++) { const d = (await call(`/projects/${pid}/assets/${assetId}/derivatives`)).body; const p = d.derivatives?.find((x: any) => x.kind === 'proxy'); if (p?.status === 'ready') return true; if (p?.status === 'failed') return false; await sleep(250); } return false; };
  const stillPng = async (pid: string, index: number) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw new Error(`still ${index} failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body as Buffer; };
  const still = async (pid: string, index: number) => decodePng(await stillPng(pid, index));
  let exports = 0;
  const exportRaw = async (pid: string, frames: number, w = W, h2 = H): Promise<{ raw: Buffer; file: string; frame: (k: number) => Rgb }> => {
    const st = await call(`/projects/${pid}/exports`, {});
    if (st.status !== 202) throw new Error(`export refused: ${JSON.stringify(st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `export-${++exports}.mp4`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', file, '-frames:v', String(frames), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = w * h2 * 3;
    return { raw, file, frame: (k) => ({ w, h: h2, rgb: raw.subarray(k * fb, (k + 1) * fb) }) };
  };
  const ffmpegOn = (file: string) => fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d)).filter((pid) => { try { const c = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); return c.startsWith('ffmpeg') && c.includes(file); } catch { return false; } });
  const jobsOf = () => s.store.openJobs('stabilise').length;
  const allJobs = (pid: string) => (s.store as any).db?.prepare?.('select count(*) as n from jobs where project_id = ? and type = ?').get(pid, 'stabilise')?.n as number | undefined;
  void allJobs;

  /** A project (1280×720, magenta background) with one clip of a fixture file: source frames [from, from+n) at timeline 0. */
  async function makeProject(name: string, file: string, o: { from?: number; n?: number; w?: number; h?: number; proxy?: boolean } = {}) {
    const pid = (await call('/projects', { name, width: o.w ?? W, height: o.h ?? H })).body.project.id as string;
    await txs(pid, [{ op: 'set_project_format', args: { background: '#ff00ff' } }]);
    const up = await upload(pid, file);
    const assetId = up.assetId as string;
    if (o.proxy !== false) await waitProxy(pid, assetId);
    const added = await txs(pid, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: f(o.from ?? 0), duration: f(o.n ?? 180), withLinkedAudio: false } }]);
    return { pid, assetId, clipId: added.results[0].output.clipId as string, trackId: added.results[0].output.trackId as string };
  }
  const clipOf = (d: ProjectDocument, id: string) => Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).find((c) => c.id === id) as MediaClip;
  /** Run the job for a clip and wait for it. */
  const stabilise = async (pid: string, clipId: string, body: Record<string, unknown> = {}) => {
    const r = await call(`/projects/${pid}/clips/${clipId}/stabilise`, body);
    if (r.status !== 202) return { status: 'refused', httpStatus: r.status, error: r.body.error, output: null, id: '' } as any;
    return waitJob(r.body.jobId);
  };
  /** Write a camera motion through the internal operation (what a finished job would leave), for the checks that are not about the kernel. */
  const attach = (pid: string, assetId: string, motion: CameraMotion) => {
    for (const st of motion.stretches) s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'attach_camera_motion', args: { assetId, from: st.from, dx: st.dx, dy: st.dy, dr: st.dr, dz: st.dz, st: st.st, method: st.origin.method, params: st.origin.params, createdAt: st.origin.createdAt } }] });
  };
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' });
  const bootPage = async (pid: string, lang: 'he' | 'en' = 'he'): Promise<{ page: Page; errors: string[] }> => {
    const page = await ctx.newPage();
    await page.addInitScript((l) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, lang);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('timecode').waitFor();
    return { page, errors };
  };

  const jp1: { pid: string; assetId: string; clipId: string } = { pid: '', assetId: '', clipId: '' };
  try {
    // ================================================================ pure maths: S8, S9 ================================================================
    await check('S8', async () => {
      let sc = 0;
      for (let x = -100; x <= 100; x += 0.00731) { const [sn, cs] = sinCos(x); sc = Math.max(sc, Math.abs(sn - Math.sin(x)), Math.abs(cs - Math.cos(x))); }
      let rel = 0;
      for (let x = -1; x <= 1; x += 0.000173) rel = Math.max(rel, Math.abs(expm(x) / Math.exp(x) - 1));
      measurements.S8 = { sinCosMaxAbs: sc, expmMaxRel: rel };
      return { ok: sc < 1e-12 && rel < 1e-12, detail: { sinCosMaxAbs: sc, expmMaxRel: rel, ranges: '|x| ≤ 100 (sin, cos, step 0.00731); |x| ≤ 1 (exp, relative, step 0.000173)' } };
    });
    await check('S9', async () => {
      const r = rng(20261125);
      let coverFails = 0, needFails = 0, notTightFails = 0, limited = 0, finite = 0;
      for (let i = 0; i < 2000; i++) {
        const hh = [HH, 9 / 32, 16 / 9 / 2, 0.4][i % 4]!;
        const pose = { r: (r() - 0.5) * 0.12, l: (r() - 0.5) * 0.12, tx: (r() - 0.5) * 0.1, ty: (r() - 0.5) * 0.1 };
        const Z = 1 + r() * 0.3;
        const lim = limitToCover(pose, Z, hh);
        if (lim.limited) limited++;
        if (!covers(lim.pose, Z, hh)) coverFails++;
        const need = neededZoom(pose, hh);
        if (Number.isFinite(need)) { finite++; if (!covers(pose, need, hh)) needFails++; if (covers(pose, need * 0.999, hh, 0)) notTightFails++; }
      }
      return { ok: coverFails === 0 && needFails === 0 && notTightFails === 0 && finite > 1500 && limited > 100, detail: { poses: 2000, finiteNeed: finite, limited, limitToCoverFailures: coverFails, neededZoomNotCovering: needFails, neededZoomNotTight: notTightFails } };
    });

    // ================================================================ S7 the browser digest ================================================================
    await check('S7', async () => {
      const fx = F('F1');
      const motion = truthMotion(fx);
      const node = steadyPoseDigest(motion, [1, 50, 100], R30);
      const page = await ctx.newPage();
      await page.goto(`${s.url}/selftest.html`);
      await page.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 120_000 });
      const has = await page.evaluate(() => typeof (window as any).__pfSteadyHash === 'function');
      if (!has) { await page.close(); return { blocked: 'window.__pfSteadyHash is absent from this build of the selftest page' }; }
      const own = await page.evaluate(() => (window as any).__pfSteadyHash());
      const browserHash = await page.evaluate((m) => (window as any).__pfSteadyHash(m, [1, 50, 100], { num: 30, den: 1 }), motion as any);
      await page.close();
      measurements.S7 = { node, chromium: browserHash.digest, selftest: own };
      return { ok: browserHash.digest === node && own.ok === true, detail: { node, chromium: browserHash.digest, frames: motion.stretches[0]!.st.length, frozenSelftestDigestOk: own.ok, ms: browserHash.ms } };
    });

    // ================================================================ F1 through the job: S1, S12, S11, S22, S10, S13, S19, S21 ================================================================
    if (want('S1', 'S10', 'S11', 'S12', 'S13', 'S21', 'S22', 'S27')) {
      const fx = F('F1');
      const p = await makeProject('stab-f1', files.F1!, { from: 30, n: 120 });
      Object.assign(jp1, p);
      // the unstabilised export first (the reference of S10)
      const base = await exportRaw(p.pid, 120);
      const lag = monitorEventLoopDelay({ resolution: 10 });
      lag.enable();
      const job = await stabilise(p.pid, p.clipId);
      lag.disable();
      measurements.job = { status: job.status, output: job.output, error: job.error, eventLoopMs: { p50: r3(lag.percentile(50) / 1e6), p99: r3(lag.percentile(99) / 1e6) } };
      const d = doc(p.pid);
      const motion = d.analyses[p.assetId]?.cameraMotion;
      await check('S1', async () => {
        if (job.status !== 'succeeded' || !motion) return { ok: false, detail: { job: job.status, error: job.error } };
        const st = motion.stretches[0]!;
        const errT: number[] = [], errR: number[] = [];
        let notOk = 0;
        for (let k = 1; k < fx.frames; k++) {
          const i = k - st.from;
          if (i < 0 || i >= st.st.length) { notOk++; continue; }
          if (st.st[i] !== SST.ok) notOk++;
          const tr = fx.truth[k]!;
          errT.push(Math.hypot(st.dx[i]! / 1e5 * W - tr.tx * W, st.dy[i]! / 1e5 * W - tr.ty * W));
          errR.push(Math.abs(st.dr[i]! / 1e6 - tr.r) * 180 / Math.PI);
        }
        const detail = { stretches: motion.stretches.length, framesAfterFirst: fx.frames - 1, notOk, input: st.origin.params.input, translationPx: { median: r4(pct(errT, 50)), p95: r4(pct(errT, 95)), max: r4(Math.max(...errT)) }, rotationDeg: { median: r4(pct(errR, 50)), p95: r4(pct(errR, 95)), max: r4(Math.max(...errR)) } };
        measurements.S1 = detail;
        return { ok: notOk === 0 && pct(errT, 95) <= 0.3 && pct(errR, 95) <= 0.02, detail };
      });
      const clip = clipOf(d, p.clipId);
      const stab = clip.stabilise;
      await check('S12', async () => {
        if (!stab || !motion) return { ok: false, detail: 'the job left no stabilisation' };
        const plan = planStabilise(d, clip, { strength: stab.strength, zoomPm: stab.zoomPm });
        const want100 = Math.round(1000 * (100 * (1 - 1_000_000 / (stab.zoomPm * stab.zoomPm)))) / 1000;
        const out = (job.output as any)?.crop;
        // the zoom the TRUTH needs at the stored strength: the largest neededZoom over the clip's frames and its reach
        const tm = truthMotion(fx);
        let need = 1;
        for (let k = 0; k < 180; k++) { const z = neededZoom(steadyPose(tm, k, stab.strength, R30), HH); if (z > need) need = z; }
        const ratio = stab.zoomPm / 1000 / need;
        const detail = { strength: stab.strength, zoomPm: stab.zoomPm, areaPercentStored: out?.areaPercent, areaPercentFormula: r3(want100 / 1), cropAreaPercent: cropAreaPercent(stab.zoomPm), truthNeed: r4(need), zoomOverTruth: r4(ratio), strengthLowered: (job.output as any)?.strengthLowered, plan: { zoomPm: plan.zoomPm, limited: plan.limitedFrames.length } };
        const formulaOk = Math.abs((out?.areaPercent ?? NaN) - Math.round(want100 * 10 / 1000 * 1000) / 10) < 1e-9 || Math.abs((out?.areaPercent ?? NaN) - want100) <= 0.05;
        // within 0.5 % above the truth's need; the kernel's own error (a few thousandths of a pixel of pose) allows 0.2 % below it
        return { ok: formulaOk && ratio <= 1.005 && ratio >= 0.998, detail };
      });
      await check('S22', async () => {
        const before = jobsOf(), rev = s.store.getProject(p.pid).revision;
        const r = await tryTx(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 100 } } }]);
        const out = r.body.results?.[0]?.output;
        const d2 = doc(p.pid);
        let outside = 0;
        for (let t = 0; t < 120; t++) { const m = describeMoment(d2, f(t)); const l = (m.layers as any[]).find((x) => x.kind === 'video'); if (l?.steady?.state === 'outside') outside++; }
        const detail = { status: r.status, revisionAfter: s.store.getProject(p.pid).revision - rev, jobsOpenAfter: jobsOf() - before, measured: out?.measured, outsideFrames: outside, zoomPm: out?.stabilise?.zoomPm };
        await call(`/projects/${p.pid}/undo`, {}); // back to the job's strength for the checks that follow
        return { ok: r.status === 200 && out?.measured?.outside === 0 && outside === 0 && detail.jobsOpenAfter === 0 && detail.revisionAfter === 1, detail };
      });
      // S10: the stabilised export against the unstabilised one and against the prediction
      await check('S10', async () => {
        const exp = await exportRaw(p.pid, 120);
        const centre = (src: ReturnType<typeof exportRaw> extends Promise<infer U> ? U : never, k: number, x0: number, y0: number, rad = 20) => discCentre(src.frame(k), x0, y0, rad);
        const plain: { x: number; y: number }[] = [], steady: { x: number; y: number }[] = [], err: number[] = [];
        const tm = truthMotion(fx);
        let missing = 0;
        for (let k = 0; k < 120; k++) {
          const sf = k + 30, dc = fx.discAt(sf, 2)!;
          const x0 = dc.x + 0.5, y0 = dc.y + 0.5;
          const a = centre(base, k, x0, y0);
          const pose = limitToCover(steadyPose(tm, sf, stab!.strength, R30), stab!.zoomPm / 1000, HH).pose;
          const pr = predict(pose, stab!.zoomPm / 1000, x0, y0);
          const b = centre(exp, k, pr.x, pr.y, 20 * (stab!.zoomPm / 1000) * Math.exp(pose.l));
          if (!a || !b) { missing++; plain.push({ x: NaN, y: NaN }); steady.push({ x: NaN, y: NaN }); continue; }
          plain.push(a); steady.push(b);
          err.push(Math.hypot(b.x - pr.x, b.y - pr.y));
        }
        const accRms = (v: { x: number; y: number }[]) => { let s2 = 0, n = 0; for (let k = 1; k + 1 < v.length; k++) { const ax = v[k + 1]!.x - 2 * v[k]!.x + v[k - 1]!.x, ay = v[k + 1]!.y - 2 * v[k]!.y + v[k - 1]!.y; s2 += ax * ax + ay * ay; n++; } return Math.sqrt(s2 / n); };
        const a0 = accRms(plain), a1 = accRms(steady);
        const detail = { frames: 120, missing, accelerationRmsPx: { unstabilised: r3(a0), stabilised: r3(a1), ratio: r4(a1 / a0) }, centroidErrorVsPredictionPx: { median: r3(pct(err, 50)), p95: r3(pct(err, 95)), max: r3(Math.max(...err)) } };
        measurements.S10 = detail;
        return { ok: missing === 0 && a1 <= a0 / 10 && Math.max(...err) <= 0.5, detail };
      });
      await check('S11', async () => {
        const rows: Record<string, unknown> = {};
        let ok = true;
        const probe = async (label: string) => {
          const idx = Array.from({ length: 30 }, (_, k) => k * 4);
          let worst = 0, n = 0;
          for (const t of idx) { const bad = nonGrey(await still(p.pid, t), 8); worst = Math.max(worst, bad); n++; }
          const exp = await exportRaw(p.pid, 120);
          let worstExp = 0;
          // colour tolerance of the export: a pixel counts as background when its red and blue are both at least 40 above its green (magenta is 255, 0, 255; grey and H.264 chroma noise never get there)
          for (let k = 0; k < 120; k++) { const fr = exp.frame(k); let bad = 0; for (let i = 0; i < fr.rgb.length; i += 3) if (fr.rgb[i]! - fr.rgb[i + 1]! > 40 && fr.rgb[i + 2]! - fr.rgb[i + 1]! > 40) bad++; worstExp = Math.max(worstExp, bad); }
          rows[label] = { stills: n, worstNonGreyPixelsOnAStill: worst, exportFrames: 120, worstBackgroundPixelsOnAnExportFrame: worstExp };
          if (worst !== 0 || worstExp !== 0) ok = false;
        };
        await probe('automatic zoom');
        const r = await tryTx(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 50, zoomPm: 1010 } } }]);
        const out = r.body.results?.[0]?.output;
        const limitedRuns = out?.limitedFrames ?? [];
        const limitedCount = limitedRuns.reduce((n: number, x: any) => n + x.to - x.from, 0);
        const pf = (await call(`/projects/${p.pid}/preflight`)).body;
        const listed = (pf.issues as any[]).filter((x) => x.code === 'stabilise_limited').length;
        await probe('zoomPm 1010 (the limit engages)');
        rows['zoomPm 1010'] = { ...(rows['zoomPm 1010 (the limit engages)'] as object), limitedSourceFrames: limitedCount, limitedRuns: limitedRuns.length, preflightStabiliseLimitedIssues: listed };
        await call(`/projects/${p.pid}/undo`, {});
        return { ok: ok && limitedCount > 0 && listed > 0, detail: rows };
      });
      await check('S21', async () => {
        const rev = s.store.getProject(p.pid).revision, jobs0 = jobsOf();
        const before = doc(p.pid);
        const r = await tryTx(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 70 } } }]);
        const out = r.body.results?.[0]?.output;
        const after = s.store.getProject(p.pid).revision;
        const proc = ffmpegOn(path.basename(files.F1!));
        void before;
        // in the editor: the crop line of the block equals what the operation stored, and one key press is one commit
        const { page, errors } = await bootPage(p.pid);
        await page.locator(`.clip[data-clip-id="${p.clipId}"]`).click({ position: { x: 4, y: 4 } });
        await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
        const sec = page.getByTestId('section-stabilise');
        await sec.waitFor({ timeout: 8000 });
        if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
        await page.getByTestId('stab-crop').waitFor({ timeout: 8000 });
        const shownZoom = Number(await page.getByTestId('stab-crop').getAttribute('data-zoom-pm'));
        const shownArea = Number(await page.getByTestId('stab-crop').getAttribute('data-area-percent'));
        const rev2 = s.store.getProject(p.pid).revision;
        await page.getByTestId('stab-strength').focus();
        await page.keyboard.press('End');
        await page.keyboard.press('Tab'); // leaving the slider ends the change: one commit
        await page.waitForFunction(() => document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state') === 'on', undefined, { timeout: 8000 });
        for (let i = 0; i < 60 && s.store.getProject(p.pid).revision === rev2; i++) await sleep(100);
        const rev3 = s.store.getProject(p.pid).revision;
        const c2 = clipOf(doc(p.pid), p.clipId).stabilise!;
        await page.waitForFunction((z) => Number(document.querySelector('[data-testid=stab-crop]')?.getAttribute('data-zoom-pm')) === z, c2.zoomPm, { timeout: 8000 }).catch(() => {});
        const shownAfter = { zoom: Number(await page.getByTestId('stab-crop').getAttribute('data-zoom-pm')), area: Number(await page.getByTestId('stab-crop').getAttribute('data-area-percent')) };
        const hasText = ((await page.getByTestId('stab-crop').textContent()) ?? '');
        await page.close();
        const detail = { restCommits: after - rev, restJobs: jobsOf() - jobs0, ffmpegRunning: proc.length, opCrop: out?.crop, blockBefore: { zoomPm: shownZoom, areaPercent: shownArea }, uiCommits: rev3 - rev2, storedAfterEnd: c2, blockAfter: shownAfter, line: hasText.trim(), pageErrors: errors.slice(0, 3) };
        return { ok: after - rev === 1 && jobsOf() === jobs0 && proc.length === 0 && rev3 - rev2 === 1 && shownAfter.zoom === c2.zoomPm && c2.strength === 100 && shownZoom === out?.crop?.zoomPm && shownArea === out?.crop?.areaPercent && errors.length === 0, detail };
      });
    }

    // the stills / export / preview parity (S13) reads the project of the job again
    await check('S13', async () => {
      if (!jp1.pid) return { blocked: 'the F1 job project was not built in this run' };
      const idx = [10, 35, 60, 85, 110];
      const exp = await exportRaw(jp1.pid, 120);
      const rows: any[] = [];
      const { page, errors } = await bootPage(jp1.pid);
      for (const k of idx) {
        const st = await still(jp1.pid, k), ex = exp.frame(k);
        await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const b = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: b.left + x, clientY: b.top + 5, bubbles: true })); }, (k / 30) * 90 + 0.5);
        await page.waitForFunction((t) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(t) && c?.dataset.quality === 'full'; }, k, { timeout: 15000 }).catch(() => {});
        const pv = await page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, data: Array.from(px) }; }).catch(() => null);
        const dc = fxs.F1!.discAt(k + 30, 2)!;
        const tm = truthMotion(F('F1')), stab = clipOf(doc(jp1.pid), jp1.clipId).stabilise!;
        const pose = limitToCover(steadyPose(tm, k + 30, stab.strength, R30), stab.zoomPm / 1000, HH).pose;
        const pr = predict(pose, stab.zoomPm / 1000, dc.x + 0.5, dc.y + 0.5);
        const rad = 20 * (stab.zoomPm / 1000) * Math.exp(pose.l);
        const cs = discCentre(st, pr.x, pr.y, rad), ce = discCentre(ex, pr.x, pr.y, rad);
        let cp: { x: number; y: number } | null = null;
        if (pv) {
          const sc = 1280 / pv.w, rgb = Buffer.alloc(pv.w * pv.h * 3);
          for (let i = 0, j = 0; i < pv.data.length; i += 4, j += 3) { rgb[j] = pv.data[i]!; rgb[j + 1] = pv.data[i + 1]!; rgb[j + 2] = pv.data[i + 2]!; }
          const c = discCentre({ w: pv.w, h: pv.h, rgb }, pr.x / sc, pr.y / sc, rad / sc);
          cp = c && { x: c.x * sc, y: c.y * sc };
        }
        rows.push({ frame: k, stillVsExport: { psnr: r3(psnr(st.rgb, ex.rgb)), ssim: r4(ssim(st.rgb, ex.rgb, W, H)) }, centroidStillVsExportPx: cs && ce ? r3(Math.hypot(cs.x - ce.x, cs.y - ce.y)) : null, centroidPreviewVsStillPx: cs && cp ? r3(Math.hypot(cs.x - cp.x, cs.y - cp.y)) : null, previewSize: pv ? `${pv.w}×${pv.h}` : null });
      }
      await page.close();
      const ok = rows.every((r) => r.stillVsExport.psnr >= 36 && r.stillVsExport.ssim >= 0.985 && r.centroidStillVsExportPx !== null && r.centroidStillVsExportPx <= 1 && r.centroidPreviewVsStillPx !== null && r.centroidPreviewVsStillPx <= 1) && errors.length === 0;
      return { ok, detail: { tolerances: 'still vs export PSNR ≥ 36 dB and SSIM ≥ 0.985 (the parity suite); disc centroid within 1 px (preview vs still, still vs export)', rows, pageErrors: errors.slice(0, 3) } };
    });

    // ================================================================ kernel on the other fixtures: S2 S3 S4 S5 ================================================================
    const kernelRun = async (v: SteadyVariant, body: Record<string, unknown> = {}) => {
      const p = await makeProject(`stab-${v}`, files[v]!, { from: 0, n: 180 });
      const before = docHashOf(doc(p.pid));
      const job = await stabilise(p.pid, p.clipId, body);
      return { ...p, job, before, motion: doc(p.pid).analyses[p.assetId]?.cameraMotion };
    };
    const errorsOf = (fx: SteadyFixture, st: CameraMotion['stretches'][number], ks: number[]) => {
      const eT: number[] = [], eR: number[] = [];
      for (const k of ks) { const i = k - st.from, tr = fx.truth[k]!; if (i < 0 || i >= st.st.length) continue; eT.push(Math.hypot(st.dx[i]! / 1e5 * W - tr.tx * W, st.dy[i]! / 1e5 * W - tr.ty * W)); eR.push(Math.abs(st.dr[i]! / 1e6 - tr.r) * 180 / Math.PI); }
      return { eT, eR };
    };
    await check('S2', async () => {
      const k = await kernelRun('F2');
      if (k.job.status !== 'succeeded' || !k.motion) return { ok: false, detail: { job: k.job.status, error: k.job.error } };
      const st = k.motion.stretches[0]!, fx = F('F2');
      const ks = Array.from({ length: 179 }, (_, i) => i + 1);
      const { eT, eR } = errorsOf(fx, st, ks);
      const notOk = ks.filter((x) => st.st[x - st.from] !== SST.ok).length;
      const detail = { block: fx.block && { areaShare: r3(fx.block.area) }, notOk, translationPx: { median: r4(pct(eT, 50)), p95: r4(pct(eT, 95)), max: r4(Math.max(...eT)) }, rotationDeg: { median: r4(pct(eR, 50)), p95: r4(pct(eR, 95)), max: r4(Math.max(...eR)) } };
      measurements.S2 = detail;
      return { ok: notOk === 0 && pct(eT, 95) <= 0.3 && pct(eR, 95) <= 0.02, detail };
    });
    await check('S3', async () => {
      const k = await kernelRun('F3');
      // the job's own verdict is the operation's; the measurement is read from a truth-free run: attach nothing here, read what the job stored when it succeeded, else rerun without the switch
      let motion = k.motion;
      if (!motion) {
        // the operation refused (too little measured): the kernel's samples are not stored then; measure the same fixture on a file that passes by reading the job's refusal counts
        return { ok: false, detail: { job: k.job.status, error: k.job.error, note: 'the job stores nothing when the operation refuses, so the per-frame states cannot be read' } };
      }
      const st = motion.stretches[0]!, fx = F('F3');
      let weak = 0, okN = 0, other = 0;
      for (let i = 1; i < st.st.length; i++) { const v = st.st[i]; if (v === SST.weak) weak++; else if (v === SST.ok) okN++; else other++; }
      const n = st.st.length - 1;
      const detail = { block: fx.block && { areaShare: r3(fx.block.area) }, frames: n, weak, ok: okN, other, weakShare: r3(weak / n) };
      measurements.S3 = detail;
      return { ok: weak / n >= 0.8 && okN === 0, detail };
    });
    await check('S4', async () => {
      const k = await kernelRun('F4');
      const msg = String(k.job.error?.message ?? '');
      const m = /^only (\d+)% of this clip's frames could be measured/.exec(msg);
      const after = docHashOf(doc(k.pid));
      const detail = { job: k.job.status, error: k.job.error && { code: k.job.error.code, message: msg }, measuredPercent: m ? Number(m[1]) : null, documentUnchanged: after === k.before, cameraMotionStored: !!k.motion };
      return { ok: k.job.status === 'failed' && !!m && Number(m[1]) < 50 && after === k.before && !k.motion, detail };
    });
    await check('S5', async () => {
      const k = await kernelRun('F5');
      if (k.job.status !== 'succeeded' || !k.motion) return { ok: false, detail: { job: k.job.status, error: k.job.error } };
      const st = k.motion.stretches[0]!;
      const code = (i: number) => st.st[i - st.from];
      // the poses of 89 and 90 use no sample across the cut: replace every sample on the other side by wild values and compare bit for bit
      const wild = (m: CameraMotion, keep: (frame: number) => boolean): CameraMotion => {
        const s0 = m.stretches[0]!;
        const mk = (col: number[], v: number) => col.map((x, i) => (keep(s0.from + i) || s0.st[i] === SST.start ? x : v));
        return { stretches: [{ ...s0, dx: mk(s0.dx, 190000), dy: mk(s0.dy, -190000), dr: mk(s0.dr, 400000), dz: mk(s0.dz, 250000) }] };
      };
      const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
      const rows: Record<string, boolean> = {};
      for (const strength of [1, 50, 100]) {
        rows[`89@${strength}`] = same(steadyPose(k.motion, 89, strength, R30), steadyPose(wild(k.motion, (fr) => fr <= 89), 89, strength, R30));
        rows[`90@${strength}`] = same(steadyPose(k.motion, 90, strength, R30), steadyPose(wild(k.motion, (fr) => fr >= 90), 90, strength, R30));
      }
      const detail = { states: { 88: code(88), 89: code(89), 90: code(90), 91: code(91), 92: code(92) }, expect: 'ok ok start ok', poseIgnoresOtherSide: rows, otherStarts: st.st.map((v, i) => (v === SST.start ? i + st.from : -1)).filter((x) => x >= 0) };
      return { ok: code(90) === SST.start && code(89) === SST.ok && code(91) === SST.ok && Object.values(rows).every(Boolean), detail };
    });

    // ================================================================ S6 a steady pan ================================================================
    await check('S6', async () => {
      const fx = F('F7');
      const p = await makeProject('stab-f7', files.F7!, { from: 0, n: 180, proxy: false });
      attach(p.pid, p.assetId, truthMotion(fx));
      const tm = doc(p.pid).analyses[p.assetId]!.cameraMotion!;
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const strength of [1, 50, 100]) {
        const r = await tryTx(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength } } }]);
        const out = r.body.results?.[0]?.output;
        let worst = 0;
        for (let k = 0; k < 180; k++) { const q = steadyPose(tm, k, strength, R30); worst = Math.max(worst, Math.abs(q.r), Math.abs(q.l), Math.abs(q.tx), Math.abs(q.ty)); }
        const zoomPm = out?.stabilise?.zoomPm;
        rows[`strength ${strength}`] = { status: r.status, zoomPm, worstPoseComponent: worst, edgesIncluded: '0..179' };
        if (r.status !== 200 || zoomPm !== 1000 || !(worst <= 1e-9)) ok = false;
      }
      return { ok, detail: rows };
    });

    // ================================================================ the truth-attached project: S14 S15 S16 S17 ================================================================
    const tp = await (async () => {
      if (!want('S14', 'S15', 'S16', 'S17', 'S27')) return null;
      const p = await makeProject('stab-truth', files.F1!, { from: 30, n: 120, proxy: false });
      attach(p.pid, p.assetId, truthMotion(F('F1')));
      await txs(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 50 } } }]);
      return p;
    })();
    const showing = (d: ProjectDocument, sf: number, upto: number): number | null => {
      for (let t = 0; t < upto; t++) { const m = describeMoment(d, f(t)); const l = (m.layers as any[]).find((x) => x.kind === 'video'); if (l && l.sourceFrameIndex === sf) return t; }
      return null;
    };
    await check('S14', async () => {
      if (!tp) return { blocked: 'no truth project' };
      const sample = [46, 60, 100]; // even offsets: at speed 2 the clip shows every second source frame
      const base = new Map<number, Buffer>();
      for (const sf of sample) base.set(sf, await stillPng(tp.pid, sf - 30));
      const rows: Record<string, unknown> = {};
      let ok = true;
      const edits: { name: string; ops: unknown[] }[] = [
        { name: 'split_clip', ops: [{ op: 'split_clip', args: { clipId: tp.clipId, at: f(20) } }] },
        { name: 'slip_clip', ops: [{ op: 'slip_clip', args: { clipId: tp.clipId, by: f(10) } }] },
        { name: 'set_clip_speed 2', ops: [{ op: 'set_clip_speed', args: { clipId: tp.clipId, speed: 2 } }] },
        { name: 'set_clip_speed 0.5', ops: [{ op: 'set_clip_speed', args: { clipId: tp.clipId, speed: 0.5 } }] },
        { name: 'set_clip_reverse', ops: [{ op: 'set_clip_reverse', args: { clipId: tp.clipId, reverse: true } }] },
      ];
      for (const e of edits) {
        const r = await tryTx(tp.pid, e.ops);
        if (r.status !== 200) { rows[e.name] = { refused: r.body?.error?.message }; ok = false; continue; }
        const d = doc(tp.pid);
        const res: Record<number, string> = {};
        for (const sf of sample) {
          const t = showing(d, sf, 260);
          if (t === null) { res[sf] = 'not shown'; ok = false; continue; }
          const png = await stillPng(tp.pid, t);
          res[sf] = png.equals(base.get(sf)!) ? `identical (timeline frame ${t})` : `DIFFERENT (timeline frame ${t})`;
          if (!png.equals(base.get(sf)!)) ok = false;
        }
        rows[e.name] = res;
        await call(`/projects/${tp.pid}/undo`, {});
      }
      // the freeze frame: hold the picture of source frame 60 (timeline 30) for 20 frames; the held frames equal that frame
      const fr = await tryTx(tp.pid, [{ op: 'freeze_frame', args: { clipId: tp.clipId, at: f(30), duration: f(20) } }]);
      if (fr.status !== 200) { rows['freeze_frame'] = { refused: fr.body?.error?.message }; ok = false; }
      else {
        const held = [30, 38, 49].map(async (t) => (await stillPng(tp.pid, t)).equals(base.get(60)!));
        const eq = await Promise.all(held);
        rows['freeze_frame'] = { heldFramesEqualSourceFrame60: eq };
        if (!eq.every(Boolean)) ok = false;
        await call(`/projects/${tp.pid}/undo`, {});
      }
      return { ok, detail: rows };
    });
    await check('S15', async () => {
      if (!tp) return { blocked: 'no truth project' };
      const fx = F('F1'), tm = truthMotion(fx);
      const expectedSteady = (c: MediaClip, sf: number) => { const pose = steadyPose(tm, sf, c.stabilise!.strength, R30), lim = limitToCover(pose, c.stabilise!.zoomPm / 1000, HH); return { state: pose.state, limited: lim.limited, pose: lim.pose, zoom: c.stabilise!.zoomPm / 1000 }; };
      const rows: Record<string, unknown> = {};
      let ok = true;
      // echo taps
      await txs(tp.pid, [{ op: 'add_effect', args: { clipId: tp.clipId, type: 'time.echo' } }]);
      let d = doc(tp.pid);
      const c = clipOf(d, tp.clipId);
      const tapRows: unknown[] = [];
      for (const t of [30, 60, 90]) {
        const m = describeMoment(d, f(t));
        const l = (m.layers as any[]).find((x) => x.kind === 'video');
        for (const tap of l.time.taps as any[]) {
          if (!tap.steady) { ok = false; tapRows.push({ t, tap: tap.lane, steady: 'missing' }); continue; }
          const e = expectedSteady(c, tap.sourceFrameIndex);
          const same = ['r', 'l', 'tx', 'ty'].every((k) => tap.steady.pose[k] === (e.pose as any)[k]) && tap.steady.zoom === e.zoom && tap.steady.limited === (e.limited ? 'clip' : false);
          const cov = covers(tap.steady.pose, tap.steady.zoom, HH);
          if (!same || !cov) ok = false;
          tapRows.push({ t, sourceFrame: tap.sourceFrameIndex, ownPose: same, covers: cov });
        }
      }
      rows['echo'] = { taps: tapRows.length, bad: tapRows.filter((x: any) => x.steady || !x.ownPose || !x.covers).length };
      await call(`/projects/${tp.pid}/undo`, {});
      // a velocity ramp: a second clip whose transition (velocity 4) reads frames before its start; no crop at all so every shaken frame is limited
      const added = await txs(tp.pid, [{ op: 'add_clip', args: { assetId: tp.assetId, start: f(120), sourceIn: f(100), duration: f(40), withLinkedAudio: false } }]);
      const b = added.results[0].output.clipId as string;
      await txs(tp.pid, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 12 } }, { op: 'set_transition_options', args: { clipId: b, velocity: 4 } }]);
      await txs(tp.pid, [{ op: 'set_clip_stabilise', args: { clipId: b, stabilise: { strength: 100, zoomPm: 1000 } } }]);
      d = doc(tp.pid);
      const cb = clipOf(d, b);
      const first = describeMoment(d, f(120));
      const inn = (first.layers as any[]).find((x) => x.kind === 'video' && x.clipId === b);
      const own = (first.layers as any[]).find((x) => x.kind === 'video' && x.clipId === tp.clipId);
      const inE = expectedSteady(cb, inn.sourceFrameIndex);
      const rampOk = inn.sourceFrameIndex < 100 && inn.steady.limited === 'reach' && ['r', 'l', 'tx', 'ty'].every((k) => inn.steady.pose[k] === (inE.pose as any)[k]) && covers(inn.steady.pose, inn.steady.zoom, HH);
      const ownE = own ? expectedSteady(c, own.sourceFrameIndex) : null;
      const handleOk = !own || (ownE !== null && ['r', 'l', 'tx', 'ty'].every((k) => own.steady.pose[k] === (ownE.pose as any)[k]) && covers(own.steady.pose, own.steady.zoom, HH));
      // every frame of the ramp and its neighbours: cover holds
      let uncovered = 0;
      for (let t = 118; t < 140; t++) for (const l of (describeMoment(d, f(t)).layers as any[]).filter((x) => x.kind === 'video' && x.steady)) if (!covers(l.steady.pose, l.steady.zoom, HH)) uncovered++;
      rows['ramp'] = { incomingSourceFrame: inn.sourceFrameIndex, clipStartsAtSource: 100, limited: inn.steady.limited, ownPose: rampOk, outgoingHandleSourceFrame: own?.sourceFrameIndex ?? null, outgoingOwnPose: handleOk, uncoveredLayers: uncovered };
      if (!rampOk || !handleOk || uncovered > 0) ok = false;
      return { ok, detail: rows };
    });

    // ================================================================ privacy and follow: S16 S17 ================================================================
    const discTrack = async (pid: string, assetId: string, kind: 'point' | 'region', k0 = 0, k1 = 180) => {
      const fx = F('F1'), dc0 = fx.discAt(k0, 2)!;
      const seedX = Math.round(((dc0.x + 0.5) / W) * 1e4), seedY = Math.round(((dc0.y + 0.5) / H) * 1e4);
      const seed: Record<string, unknown> = { assetId, kind, frame: k0, x: seedX, y: seedY, name: `disc ${kind}` };
      if (kind === 'region') { seed.w = Math.round(((2 * fx.discRadius * W) / W) * 1e4); seed.h = Math.round(((2 * fx.discRadius * W) / H) * 1e4); }
      const id = (await txs(pid, [{ op: 'create_motion_track', args: seed }])).results[0].output.motionTrackId as string;
      const set = Array.from({ length: k1 - k0 - 1 }, (_, i) => { const k = k0 + i + 1, dc = fx.discAt(k, 2)!; return { frame: k, x: Math.round(((dc.x + 0.5) / W) * 1e4), y: Math.round(((dc.y + 0.5) / H) * 1e4), ...(kind === 'region' ? { s: 1000 } : {}) }; });
      await txs(pid, [{ op: 'edit_motion_track', args: { motionTrackId: id, set } }]);
      return id;
    };
    await check('S16', async () => {
      if (!tp) return { blocked: 'no truth project' };
      const fx = F('F1'), tm = truthMotion(fx), stab = clipOf(doc(tp.pid), tp.clipId).stabilise!;
      const plain = await exportRaw(tp.pid, 120);
      const mt = await discTrack(tp.pid, tp.assetId, 'region', 30, 150);
      await txs(tp.pid, [{ op: 'set_redact_region', args: { clipId: tp.clipId, region: { motionTrackId: mt } } }]);
      const red = await exportRaw(tp.pid, 120);
      const drops: number[] = [], centre: number[] = [];
      for (let k = 0; k < 120; k++) {
        const sf = k + 30, dc = fx.discAt(sf, 2)!, x0 = dc.x + 0.5, y0 = dc.y + 0.5;
        const pose = limitToCover(steadyPose(tm, sf, stab.strength, R30), stab.zoomPm / 1000, HH).pose;
        const pr = predict(pose, stab.zoomPm / 1000, x0, y0), rad = 0.85 * fx.discRadius * W * (stab.zoomPm / 1000) * Math.exp(pose.l);
        const a = circleEnergy(plain.frame(k), pr.x, pr.y, rad), b = circleEnergy(red.frame(k), pr.x, pr.y, rad);
        drops.push(1 - b / a);
        // the centre of what the region changed: the centroid of |plain − redacted| inside a window around the disc
        const A = plain.frame(k), B = red.frame(k);
        let sx = 0, sy = 0, sw = 0;
        for (let y = Math.max(0, Math.floor(pr.y - 50)); y < Math.min(H, Math.ceil(pr.y + 50)); y++) for (let x = Math.max(0, Math.floor(pr.x - 50)); x < Math.min(W, Math.ceil(pr.x + 50)); x++) { const i = (y * W + x) * 3, dd = Math.abs(lum(A.rgb, i) - lum(B.rgb, i)); sx += dd * (x + 0.5); sy += dd * (y + 0.5); sw += dd; }
        centre.push(sw ? Math.hypot(sx / sw - pr.x, sy / sw - pr.y) : Infinity);
      }
      const detail = { frames: 120, lossMin: r3(Math.min(...drops)), lossMedian: r3(pct(drops, 50)), centreOffsetPx: { median: r3(pct(centre, 50)), p95: r3(pct(centre, 95)), max: r3(Math.max(...centre)) } };
      measurements.S16 = detail;
      return { ok: Math.min(...drops) >= 0.8 && Math.max(...centre) <= 1.5, detail };
    });
    await check('S17', async () => {
      if (!tp) return { blocked: 'no truth project' };
      const fx = F('F1'), tm = truthMotion(fx), stab = clipOf(doc(tp.pid), tp.clipId).stabilise!;
      // the region of S16 stays; the sticker is a 32×32 magenta picture that follows a point track on the disc
      const sticker = path.join(art, 'sticker.png');
      ff(['-y', '-f', 'lavfi', '-i', 'color=c=0xff00ff:s=32x32', '-frames:v', '1', sticker]);
      const stickerAsset = (await upload(tp.pid, sticker)).assetId as string;
      const st = await txs(tp.pid, [{ op: 'add_clip', args: { assetId: stickerAsset, start: f(0), duration: f(120) } }]);
      const sc = st.results[0].output.clipId as string;
      const mt = await discTrack(tp.pid, tp.assetId, 'point', 30, 150);
      await txs(tp.pid, [{ op: 'set_clip_transform', args: { clipId: sc, transform: { scale: 0.04 } } }, { op: 'set_clip_follow', args: { clipId: sc, follow: { motionTrackId: mt, targetTrackId: tp.trackId, scale: false, smooth: 0 }, offset: { x: 0, y: 0 } } }]);
      const exp = await exportRaw(tp.pid, 120);
      const errs: number[] = [];
      let missing = 0;
      for (let k = 0; k < 120; k++) {
        const sf = k + 30, dc = fx.discAt(sf, 2)!;
        const pose = limitToCover(steadyPose(tm, sf, stab.strength, R30), stab.zoomPm / 1000, HH).pose;
        const pr = predict(pose, stab.zoomPm / 1000, dc.x + 0.5, dc.y + 0.5);
        const m = magenta(exp.frame(k));
        if (!m) { missing++; continue; }
        errs.push(Math.hypot(m.x - pr.x, m.y - pr.y));
      }
      const detail = { frames: 120, stickerMissing: missing, distanceToDiscPx: { median: r3(pct(errs, 50)), p95: r3(pct(errs, 95)), max: r3(Math.max(...errs)) }, note: 'the disc position is the truth and the same smoothing, written out by hand (Math functions)' };
      measurements.S17 = detail;
      return { ok: missing === 0 && Math.max(...errs) <= 1.5, detail };
    });

    // ================================================================ S18 the portrait picture; S20 the picture in picture ================================================================
    await check('S18', async () => {
      const fx = F('F8');
      const p = await makeProject('stab-f8', files.F8!, { from: 0, n: 180, proxy: false });
      attach(p.pid, p.assetId, truthMotion(fx));
      const r = await tryTx(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 100 } } }]);
      const out = r.body.results?.[0]?.output;
      // the own rectangle: 720×1280 fitted into 1280×720 (contain): 405 × 720, centred
      const rw = 720 * (720 / 1280), x0 = (W - rw) / 2, x1 = x0 + rw;
      let worst = 0, inside = 0, frames = 0, corner: number[] = [];
      for (let t = 0; t < 180; t += 6) {
        const st = await still(p.pid, t);
        if (frames === 0) corner = [st.rgb[0]!, st.rgb[1]!, st.rgb[2]!];
        // the pixels outside must be exactly the project's background: count those that are not
        let off = 0;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { if (x >= Math.floor(x0) - 1 && x <= Math.ceil(x1) + 1) continue; const i = (y * W + x) * 3; if (st.rgb[i] !== 255 || st.rgb[i + 1] !== 0 || st.rgb[i + 2] !== 255) off++; }
        worst = Math.max(worst, off);
        inside += nonGrey(st, 0, { x0: Math.ceil(x0) + 2, y0: 0, x1: Math.floor(x1) - 2, y1: H });
        frames++;
      }
      return { ok: r.status === 200 && worst === 0 && inside === 0 && frames >= 30, detail: { cornerPixel: corner, stabilised: out?.stabilise, rect: `x ${x0.toFixed(1)}..${x1.toFixed(1)} of ${W}`, framesLooked: frames, worstPixelsOutsideTheRectangleThatAreNotTheBackground: worst, greyOrBackgroundTintInsideTheRectangle: inside } };
    });
    await check('S20', async () => {
      const fx9 = F('F9'), fx1 = F('F1');
      const pid = (await call('/projects', { name: 'stab-pip', width: W, height: H })).body.project.id as string;
      await txs(pid, [{ op: 'set_project_format', args: { background: '#ff00ff' } }]);
      const a1 = (await upload(pid, files.F1!)).assetId as string, a9 = (await upload(pid, files.F9!)).assetId as string;
      await txs(pid, [{ op: 'add_clip', args: { assetId: a1, start: f(0), sourceIn: f(0), duration: f(120), withLinkedAudio: false } }]);
      const c9 = (await txs(pid, [{ op: 'add_clip', args: { assetId: a9, start: f(0), sourceIn: f(0), duration: f(120), withLinkedAudio: false } }])).results[0].output.clipId as string;
      await txs(pid, [{ op: 'set_clip_transform', args: { clipId: c9, transform: { x: 0.2, y: -0.2, scale: 0.5 } } }]);
      attach(pid, a9, truthMotion(fx9));
      await txs(pid, [{ op: 'set_clip_stabilise', args: { clipId: c9, stabilise: { strength: 100 } } }]);
      void fx1;
      // own rectangle on the screen: 640×360 centred at (640 + 0.2·1280, 360 − 0.2·720)
      const cx = 640 + 0.2 * W, cy = 360 - 0.2 * H, rect = { x0: cx - 320, y0: cy - 180, x1: cx + 320, y1: cy + 180 };
      const frames = [5, 25, 45, 65, 85, 105];
      const plain: Record<number, Rgb> = {};
      for (const t of frames) plain[t] = await still(pid, t);
      const diffOutside = (a: Rgb, b: Rgb) => { let out = 0, inn = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (a.rgb[i] === b.rgb[i] && a.rgb[i + 1] === b.rgb[i + 1] && a.rgb[i + 2] === b.rgb[i + 2]) continue; if (x >= rect.x0 - 2 && x < rect.x1 + 2 && y >= rect.y0 - 2 && y < rect.y1 + 2) inn++; else out++; } return { outside: out, inside: inn }; };
      const rows: Record<string, unknown> = {};
      let ok = true;
      // (a) a covering region at the edge: a track on a box that straddles the clip's left edge in file coordinates, drawn full cover
      const seed = { assetId: a9, name: 'edge', kind: 'region', frame: 0, x: 200, y: 5000, w: 1500, h: 4000 };
      const mtEdge = (await txs(pid, [{ op: 'create_motion_track', args: seed }])).results[0].output.motionTrackId as string;
      await txs(pid, [{ op: 'edit_motion_track', args: { motionTrackId: mtEdge, set: Array.from({ length: 119 }, (_, i) => ({ frame: i + 1, x: 200, y: 5000, s: 1000 })) } }]);
      const reg = await txs(pid, [{ op: 'set_redact_region', args: { clipId: c9, region: { motionTrackId: mtEdge, style: 'fill', color: '#00c800' } } }]);
      void reg;
      const withEdge: { frame: number; outside: number; inside: number }[] = [];
      for (const t of frames) withEdge.push({ frame: t, ...diffOutside(plain[t]!, await still(pid, t)) });
      rows['covering region at the edge'] = { framesLooked: frames.length, pixelsChangedOutsideTheRectangle: Math.max(...withEdge.map((x) => x.outside)), pixelsChangedInside: Math.min(...withEdge.map((x) => x.inside)) };
      if (withEdge.some((x) => x.outside !== 0 || x.inside === 0)) ok = false;
      // (b) the whole-picture fallback: a region track that was never tracked (its seed frame only), so every later frame is lost and the whole picture is blurred
      await txs(pid, [{ op: 'set_redact_region', args: { clipId: c9, region: null, regionId: (clipOf(doc(pid), c9) as any).redact[0].id } }]);
      const lone = (await txs(pid, [{ op: 'create_motion_track', args: { assetId: a9, name: 'lone', kind: 'region', frame: 0, x: 5000, y: 5000, w: 1000, h: 1000 } }])).results[0].output.motionTrackId as string;
      await txs(pid, [{ op: 'set_redact_region', args: { clipId: c9, region: { motionTrackId: lone } } }]);
      const fall: { frame: number; outside: number; inside: number }[] = [];
      for (const t of frames.slice(1)) fall.push({ frame: t, ...diffOutside(plain[t]!, await still(pid, t)) });
      rows['whole-picture fallback'] = { framesLooked: fall.length, pixelsChangedOutsideTheRectangle: Math.max(...fall.map((x) => x.outside)), pixelsChangedInside: Math.min(...fall.map((x) => x.inside)) };
      if (fall.some((x) => x.outside !== 0 || x.inside === 0)) ok = false;
      void fx9;
      return { ok, detail: rows };
    });

    // ================================================================ S19, S23: the job twice in one project ================================================================
    if (want('S19', 'S23')) {
      const p = await makeProject('stab-two', files.F1!, { from: 30, n: 60 });
      const before = docHashOf(doc(p.pid));
      const job = await stabilise(p.pid, p.clipId);
      const after = docHashOf(doc(p.pid));
      await check('S19', async () => {
        if (job.status !== 'succeeded') return { ok: false, detail: { job: job.status, error: job.error } };
        const u = await call(`/projects/${p.pid}/undo`, {});
        const undone = docHashOf(doc(p.pid));
        const rd = await call(`/projects/${p.pid}/redo`, {});
        const redone = docHashOf(doc(p.pid));
        return { ok: u.status === 200 && rd.status === 200 && undone === before && redone === after && after !== before, detail: { undoStatus: u.status, redoStatus: rd.status, undoEqualsBefore: undone === before, redoEqualsStabilised: redone === after, changedByJob: after !== before } };
      });
      await check('S23', async () => {
        if (job.status !== 'succeeded') return { ok: false, detail: { job: job.status } };
        const frames = [5, 25, 45];
        const stillsA = await Promise.all(frames.map((t) => stillPng(p.pid, t)));
        const stretchesBefore = doc(p.pid).analyses[p.assetId]!.cameraMotion!.stretches.map((x) => [x.from, x.st.length]);
        const added = await txs(p.pid, [{ op: 'add_clip', args: { assetId: p.assetId, start: f(100), sourceIn: f(120), duration: f(50), withLinkedAudio: false } }]);
        const b = added.results[0].output.clipId as string;
        const jb = await stabilise(p.pid, b);
        const stillsB = await Promise.all(frames.map((t) => stillPng(p.pid, t)));
        const d = doc(p.pid);
        const rows = frames.map((t, i) => stillsA[i]!.equals(stillsB[i]!));
        return { ok: jb.status === 'succeeded' && rows.every(Boolean) && !!clipOf(d, b).stabilise, detail: { secondJob: jb.status, error: jb.error, firstClipStillsIdentical: rows, stretchesBefore, stretchesAfter: d.analyses[p.assetId]!.cameraMotion!.stretches.map((x) => [x.from, x.st.length]) } };
      });
    }

    // ================================================================ S24 S25 the job while it runs (the long fixture) ================================================================
    const runningJob = async (name: string, act: (p: { pid: string; assetId: string; clipId: string }, jobId: string) => Promise<void>) => {
      const p = await makeProject(name, longFile, { from: 0, n: 900, w: 640, h: 360 });
      const before = docHashOf(doc(p.pid));
      const r = await call(`/projects/${p.pid}/clips/${p.clipId}/stabilise`, {});
      if (r.status !== 202) throw new Error(`the job was refused: ${JSON.stringify(r.body).slice(0, 300)}`);
      for (let i = 0; i < 2000; i++) { const j = (await call(`/jobs/${r.body.jobId}`)).body; if (String(j.stage ?? '').startsWith('measuring')) break; if (['succeeded', 'failed', 'canceled'].includes(j.status)) throw new Error(`the job ended before the check could act: ${j.status}`); await sleep(5); }
      await act(p, r.body.jobId);
      const end = await waitJob(r.body.jobId);
      return { p, end, before };
    };
    await check('S24', async () => {
      const t = { start: 0 };
      const { p, end, before } = await runningJob('stab-cancel', async (pr, id) => { t.start = Date.now(); const c = await call(`/jobs/${id}/cancel`, {}); if (c.status !== 200) throw new Error(`cancel: ${c.status}`); void pr; });
      const ms = Date.now() - t.start;
      const left = ffmpegOn(path.basename(longFile));
      const detail = { status: end.status, afterMs: ms, ffmpegLeft: left.length, documentUnchanged: docHashOf(doc(p.pid)) === before };
      return { ok: end.status === 'canceled' && left.length === 0 && detail.documentUnchanged && ms <= 5000, detail };
    });
    await check('S25', async () => {
      const { p, end } = await runningJob('stab-deleted', async (pr) => { await txs(pr.pid, [{ op: 'delete_clip', args: { clipId: pr.clipId } }]); });
      const hash = docHashOf(doc(p.pid));
      const again = docHashOf(doc(p.pid));
      const d = doc(p.pid);
      const detail = { status: end.status, error: end.error && { code: end.error.code, message: end.error.message }, cameraMotionStored: !!d.analyses[p.assetId]?.cameraMotion, clipsLeft: Object.values(d.sequences).reduce((n, q) => n + q.tracks.reduce((m, t) => m + t.clips.length, 0), 0), stable: hash === again };
      return { ok: end.status === 'failed' && end.error?.code === 'clip_changed' && !detail.cameraMotionStored && detail.clipsLeft === 0, detail };
    });

    // ================================================================ S26 the shared budget ================================================================
    await check('S26', async () => {
      const pid = (await call('/projects', { name: 'stab-budget', width: W, height: H })).body.project.id as string;
      const fake = (k: number, frames: number) => s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'video' as const, name: `fake${k}.mp4`, contentHash: `sha256:${k.toString(16).padStart(64, 'e')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30), video: { width: W, height: H, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov } } }] }).results[0]!.output!.assetId as string;
      for (let k = 1; k <= 4; k++) { const a = fake(k, 10_800), n = 10_800, z = new Array(n).fill(0); attach(pid, a, { stretches: [{ from: 0, dx: z, dy: z, dr: z, dz: z, st: [SST.start, ...new Array(n - 1).fill(SST.ok)], origin: origin('seed') }] }); }
      const p = await makeProject('stab-budget-clip', files.F1!, { from: 30, n: 60, proxy: false });
      // the F1 clip lives in its own project, so move the 43,200 samples there too: the budget is per project
      for (let k = 1; k <= 4; k++) { const a = s.store.commit({ projectId: p.pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'video' as const, name: `fake${k}.mp4`, contentHash: `sha256:${k.toString(16).padStart(64, 'd')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(10_800, R30), video: { width: W, height: H, frameRate: R30, codec: 'h264', rotation: 0, frameCount: 10_800 }, provenance: prov } } }] }).results[0]!.output!.assetId as string; const z = new Array(10_800).fill(0); attach(p.pid, a, { stretches: [{ from: 0, dx: z, dy: z, dr: z, dz: z, st: [SST.start, ...new Array(10_799).fill(SST.ok)], origin: origin('seed') }] }); }
      const before = docHashOf(doc(p.pid)), jobs0 = jobsOf();
      const r = await call(`/projects/${p.pid}/clips/${p.clipId}/stabilise`, {});
      const detail = { httpStatus: r.status, code: r.body?.error?.code, message: r.body?.error?.message, documentUnchanged: docHashOf(doc(p.pid)) === before, jobsStarted: jobsOf() - jobs0, cameraMotionOfTheClipFile: !!doc(p.pid).analyses[p.assetId]?.cameraMotion };
      return { ok: r.status === 422 && /at most 43200 samples/.test(String(r.body?.error?.message)) && detail.documentUnchanged && detail.jobsStarted === 0 && !detail.cameraMotionOfTheClipFile, detail };
    });

    // ================================================================ S27 preflight ================================================================
    await check('S27', async () => {
      const fx = F('F1'), tm = truthMotion(fx, 0, 150);
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const speed of [1, 2]) {
        const p = await makeProject(`stab-pf-${speed}`, files.F1!, { from: 30, n: 45, proxy: false });
        attach(p.pid, p.assetId, tm); // measured: source frames [0, 150)
        await txs(p.pid, [{ op: 'set_clip_stabilise', args: { clipId: p.clipId, stabilise: { strength: 100, zoomPm: 1010 } } }]);
        // slipped onto frames the measurement does not hold, and sped up: shown source frames s(t) = 30 + slip + speed·t
        if (speed === 2) await txs(p.pid, [{ op: 'set_clip_speed', args: { clipId: p.clipId, speed: 2 } }]);
        // slip it later, as far as the file allows, so its last frames lie past the measured part [0, 150) of the file
        let slipped = 0;
        for (const by of speed === 1 ? [100, 80, 60] : [50, 40, 30]) { const r = await tryTx(p.pid, [{ op: 'slip_clip', args: { clipId: p.clipId, by: f(by) } }]); if (r.status === 200) { slipped = by; break; } }
        rows[`speed ${speed} slip`] = slipped;
        const d = doc(p.pid), c = clipOf(d, p.clipId);
        const n = Math.round(T.toSeconds(c.duration) * 30);
        const pf = (await call(`/projects/${p.pid}/preflight`)).body;
        const issue = (code: string) => [...new Set((pf.issues as any[]).filter((x) => x.code === code && x.range).flatMap((x) => Array.from({ length: x.range.endFrame - x.range.startFrame }, (_, k) => x.range.startFrame + k)))].sort((a, b) => a - b);
        // expected: the source frame the evaluator shows at timeline frame t (describe_moment), then limited / unmeasured by an independent cover test
        const srcAt = (t: number) => (describeMoment(d, f(t)).layers as any[]).find((x) => x.kind === 'video').sourceFrameIndex as number;
        const expLimited: number[] = [], expUnmeasured: number[] = [];
        for (let t = 0; t < n; t++) {
          const sf = srcAt(t);
          if (sf >= 150) { expUnmeasured.push(t); continue; }
          const pose = steadyPose(tm, sf, 100, R30);
          if (!covers(pose, 1.01, HH, 0)) expLimited.push(t);
        }
        const gotL = issue('stabilise_limited'), gotU = issue('stabilise_unmeasured');
        const sev = (pf.issues as any[]).filter((x) => x.code === 'stabilise_limited' || x.code === 'stabilise_unmeasured').map((x) => x.severity);
        const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);
        const runs = (v: number[]) => { const out: [number, number][] = []; for (const x of v) { const l = out.at(-1); if (l && l[1] === x) l[1] = x + 1; else out.push([x, x + 1]); } return out; };
        rows[`speed ${speed}`] = { clipFrames: n, limited: { got: runs(gotL), want: runs(expLimited) }, unmeasured: { got: runs(gotU), want: runs(expUnmeasured) }, severities: [...new Set(sev)], blocking: (pf.issues as any[]).some((x) => (x.code === 'stabilise_limited' || x.code === 'stabilise_unmeasured') && x.severity === 'error') };
        if (!same(gotL, expLimited) || !same(gotU, expUnmeasured) || expLimited.length === 0 || expUnmeasured.length === 0 || sev.some((x) => x !== 'warning')) ok = false;
      }
      return { ok, detail: rows };
    });

    // ================================================================ S28 recorded, not gated ================================================================
    await check('S28', async () => {
      const job = measurements.job as any;
      const out = job?.output;
      // commit delta at 10,800 camera samples (one file's cap): 30 small commits without and with the measurement, p95
      const pid = (await call('/projects', { name: 'stab-bench', width: W, height: H })).body.project.id as string;
      const asset = (k: number, frames: number) => s.store.commit({ projectId: pid, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'video' as const, name: `bench${k}.mp4`, contentHash: `sha256:${k.toString(16).padStart(64, 'c')}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30), video: { width: W, height: H, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov } } }] }).results[0]!.output!.assetId as string;
      const a = asset(1, 10_800);
      const time = () => { const ms: number[] = []; for (let i = 0; i < 30; i++) { const t = performance.now(); s.store.commit({ projectId: pid, actor: 'user:local', ops: [{ op: 'rename_asset', args: { assetId: a, name: `n${i}-${Math.random()}` } }] }); ms.push(performance.now() - t); } return ms; };
      const baseline = time();
      const n = 10_800, rr = rng(5);
      const col = () => Array.from({ length: n }, () => Math.round((rr() - 0.5) * 600));
      attach(pid, a, { stretches: [{ from: 0, dx: col(), dy: col(), dr: col(), dz: col(), st: [SST.start, ...new Array(n - 1).fill(SST.ok)], origin: origin('bench') }] });
      const withSamples = time();
      // planStabilise at 1,800 frames: a 1,800-frame clip of a 2,100-frame file, strength 50 with the 15 % crop limit (the bisection)
      const big = (await call('/projects', { name: 'stab-plan', width: W, height: H })).body.project.id as string;
      const ba = s.store.commit({ projectId: big, actor: 'user:local', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { kind: 'video' as const, name: 'plan.mp4', contentHash: `sha256:${'b'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(2100, R30), video: { width: W, height: H, frameRate: R30, codec: 'h264', rotation: 0, frameCount: 2100 }, provenance: prov } } }] }).results[0]!.output!.assetId as string;
      const m2 = 2100, c2 = () => Array.from({ length: m2 }, () => Math.round((rr() - 0.5) * 900));
      attach(big, ba, { stretches: [{ from: 0, dx: c2(), dy: c2(), dr: c2(), dz: c2(), st: [SST.start, ...new Array(m2 - 1).fill(SST.ok)], origin: origin('bench') }] });
      const bc = (await txs(big, [{ op: 'add_clip', args: { assetId: ba, start: f(0), sourceIn: f(150), duration: f(1800), withLinkedAudio: false } }])).results[0].output.clipId as string;
      const bd = doc(big);
      const t1 = performance.now();
      const plan = planStabilise(bd, clipOf(bd, bc), { strength: 50, maxCrop: 15 });
      const planMs = performance.now() - t1;
      const t2 = performance.now();
      planStabilise(bd, clipOf(bd, bc), { strength: 51 });
      const planWarmMs = performance.now() - t2;
      const detail = {
        job: out ? { framesPerSecond: out.measuringFps, measuredFrames: out.measuredFrames } : null, eventLoopLagMs: job?.eventLoopMs, jobStatus: job?.status,
        commitMs: { baselineP95: r3(pct(baseline, 95)), with10800SamplesP95: r3(pct(withSamples, 95)), deltaP95: r3(pct(withSamples, 95) - pct(baseline, 95)) },
        planStabilise1800Frames: { coldMs: r3(planMs), afterPoseCacheMs: r3(planWarmMs), strengthStored: plan.strength, zoomPm: plan.zoomPm, lowered: plan.strengthLowered },
        note: 'one sample each, recorded, not gated',
      };
      measurements.S28 = detail;
      return { ok: true, detail };
    });
  } finally {
    await browser.close().catch(() => {});
    await s.close();
  }

  // ---------- the verdict ----------
  const failed = verdicts.filter((v) => v.status === 'failed'), blocked = verdicts.filter((v) => v.status === 'blocked');
  const passed = verdicts.filter((v) => v.status === 'passed');
  console.log(`\nstabilise proof: ${passed.length} passed, ${failed.length} failed, ${blocked.length} blocked of ${verdicts.length} run (${Object.keys(STABILISE_CHECKS).length} defined)`);
  if (!ONLY) {
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : blocked.length ? 'BLOCKED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' },
      scope: 'Model-free picture stabilisation on synthetic fixtures only (a textured world with five ringed discs seen through a known shaky camera path; no real footage, no person). Stills through render_frame, exports decoded with ffmpeg, the editor in headless Chromium. S28 is recorded, not gated. Not covered: real phone footage, rolling shutter, whether the result looks steady to a person, speed on the owner\'s laptop.',
      fixtures: { width: W, height: H, frames: 180, fps: 30, long: '900 frames at 640×360 (S24, S25)' },
      checks: STABILISE_CHECKS, passed: passed.length, failed: failed.length, blocked: blocked.length, verdicts, measurements,
    };
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'stabilise-proof.json'), JSON.stringify(report, null, 2) + '\n');
  }
  if (failed.length) process.exitCode = 1;
  else if (blocked.length) process.exitCode = 2;
}
main().catch((e) => { console.error(e); process.exit(1); });
