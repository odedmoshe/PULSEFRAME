/**
 * proof:growing — the server part (W2): G1–G17 of growing-proof.ts. One server for every check, started in-process on a free port
 * (port 0) in .artifacts/growing-proof (deleted when the process exits), against the REAL planner (core planGrowing, W1): until W1's
 * planner is merged every check that needs it says "waits for W1 (growing_not_built)", never a pass.
 * Fixtures: growing-fixtures.ts (drawn faces with two magenta squares at known positions, an EXIF-6 and an EXIF-3 JPEG, a drifting
 * barcode video, black and white stills), made here and deleted after. Never a photograph.
 * Every expected number is computed here from the fixture's design and this file's own arithmetic (the targets L and R from the
 * face size and eye line; the capture order from the dates typed here; the frames from the hold), never read back from the plan.
 * Stills and exports need the web bundle (render.html) and the headless renderer: without them those checks say BLOCKED.
 * Integration: G2, G5's preview half and G17's browser half open the editor as the owner in headless Chromium (one browser per check):
 * the paused preview canvas is read pixel for pixel and compared with the owner's server still; core's planGrowing, bundled for
 * the browser by the esbuild tsx ships, runs in that Chromium on the very inputs Node's run gets, and the two plans are compared.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { createRequire } from 'node:module';
import { chromium, type Page } from 'playwright';
import { GROWING, GROWING_RECORD_KEYS, growingPickKey, planGrowing, shownCapture, type GrowingPlan, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { translateRefusal } from '../../i18n/src/index.ts';
import { startServer, type RunningServer } from '@pulseframe/server';
import { makeGrowingFixtures, magentaCentroids, type FaceFixture, type GrowingFixtures } from './growing-fixtures.ts';
import type { GrowingProofPart } from './growing-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/growing-proof');
const W = 640, H = 360, R30 = { num: 30, den: 1 };
const PLANTED = 0.123457;
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 30, ...(input ? { input } : {}) });
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const j = (v: unknown) => String(JSON.stringify(v)).slice(0, 600);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r3 = (x: number) => Math.round(x * 1000) / 1000;
/** The two targets in frame px, computed here from the face size and eye line (plan §4.1): eyes on a level line about the centre. */
const targetsOf = (faceSize: number, eyeLine: number) => { const y = H / 2 + eyeLine * H, half = (faceSize * W) / 2; return [{ x: W / 2 - half, y }, { x: W / 2 + half, y }] as const; };
const TARGETS = targetsOf(GROWING.faceSize.default, GROWING.eyeLine.default);
const marksOf = (f: Pick<FaceFixture, 'a' | 'b' | 'width' | 'height'>) => [{ u: f.a.x / f.width, v: f.a.y / f.height }, { u: f.b.x / f.width, v: f.b.y / f.height }];

type Res = { status: number; body: any };
class Fail extends Error { constructor(m: string, public res?: Res) { super(m); } }
interface Env {
  s: RunningServer; fx: GrowingFixtures; rendered: boolean;
  /** As the owner's own session. */ owner(p: string, body?: unknown, method?: string): Promise<Res>;
  /** With a bearer token (the agent's by default). */ call(p: string, body?: unknown, token?: string, method?: string): Promise<Res>;
  mcp(token: string, method: string, params: Record<string, unknown>): Promise<any>;
  grant(mode: string, extra?: Record<string, unknown>): Promise<string>;
}
let envPromise: Promise<Env> | null = null;
let server: RunningServer | null = null;
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  fs.rmSync(art, { recursive: true, force: true });
  const fx = makeGrowingFixtures(path.join(art, 'fixtures'));
  const webDist = process.env.PF_GROWING_WEB_DIST ?? path.join(root, 'apps/web/dist');
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), webDist, homeZone: 'Asia/Jerusalem' });
  server = s;
  process.once('beforeExit', () => { void s.close(); });
  const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const request = async (p: string, headers: Record<string, string>, body?: unknown, method?: string): Promise<Res> => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { connection: 'close', ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const owner: Env['owner'] = (p, body, method) => request(p, { origin: s.url, cookie }, body, method);
  const call: Env['call'] = (p, body, token = s.auth.tokens.agent, method) => request(p, { authorization: `Bearer ${token}` }, body, method);
  let id = 0;
  const mcp: Env['mcp'] = async (token, method, params) => {
    const r = await fetch(`${s.url}/mcp`, { method: 'POST', headers: { connection: 'close', authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const text = await r.text();
    return JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
  };
  const grant: Env['grant'] = async (mode, extra = {}) => { const r = await owner('/grants', { name: `growing-${mode}-${Math.random().toString(36).slice(2, 8)}`, mode, ...extra }); if (r.status !== 201) throw new Error(`grant: ${r.status} ${j(r.body)}`); return r.body.token as string; };
  return { s, fx, rendered: fs.existsSync(path.join(webDist, 'render.html')), owner, call, mcp, grant };
}

// ---------- helpers ----------
const must = (r: Res, what: string, want = [200, 201]) => { if (!want.includes(r.status)) throw new Fail(`${what} → ${r.status} ${j(r.body?.error ?? r.body)}`, r); return r.body; };
const getDoc = async (e: Env, pid: string): Promise<ProjectDocument> => must(await e.owner(`/projects/${pid}`), 'project').project;
const revision = async (e: Env, pid: string): Promise<number> => must(await e.owner(`/projects/${pid}`), 'project').revision;
const docHash = async (e: Env, pid: string) => sha(JSON.stringify(await getDoc(e, pid)));
async function upload(e: Env, pid: string, file: string): Promise<string> {
  const r = await fetch(`${e.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${e.s.auth.tokens.agent}`, connection: 'close', 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${path.basename(file)}: ${r.status} ${j(b)}`);
  return b.assetId as string;
}
const newProject = async (e: Env, name: string) => must(await e.owner('/projects', { name, width: W, height: H, frameRate: R30 }), 'create project').project.id as string;
const tx = async (e: Env, pid: string, ops: unknown[]) => must(await e.owner(`/projects/${pid}/transactions`, { ops }), 'transaction');
const waitJob = async (e: Env, id: string, ms = 900_000) => { const t0 = Date.now(); for (;;) { const job = (await e.call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled', 'refused'].includes(job.status)) return job; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(200); } };
const rgbOfPng = (png: Buffer) => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const stills = new Map<string, Buffer>();
async function still(e: Env, pid: string, n: number): Promise<Buffer> {
  const key = `${pid}:${await revision(e, pid)}:${n}`;
  const had = stills.get(key);
  if (had) return had;
  if (!e.rendered) throw new Fail('BLOCKED: no web bundle (render.html) here, so no still can be rendered; run pnpm build');
  const r = await e.call(`/projects/${pid}/frame?index=${n}`);
  if (r.status !== 200) throw new Fail(`frame ${n} → ${r.status} ${j(r.body?.error ?? '')}`, r);
  const rgb = rgbOfPng(r.body as Buffer);
  stills.set(key, rgb);
  return rgb;
}
async function exportMp4(e: Env, pid: string): Promise<{ file: string; job: any }> {
  if (!e.rendered) throw new Fail('BLOCKED: no web bundle (render.html) here, so nothing can be exported; run pnpm build');
  const st = await e.owner(`/projects/${pid}/exports`, { quality: 'draft' });
  if (st.status !== 202) throw new Fail(`export refused ${st.status}: ${j(st.body?.error ?? st.body)}`, st);
  const job = await waitJob(e, st.body.jobId);
  if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${j(job.error)}`);
  const file = path.join(art, `export-${pid}.mp4`);
  // as the owner: the film carries family fields (the age caption), so an agent may not take the rendered file (assertMayTakeRendered)
  const out = await e.owner(`/jobs/${job.id}/output`);
  if (out.status !== 200 || !Buffer.isBuffer(out.body)) throw new Fail(`export download → ${out.status} ${j(out.body?.error ?? '')}`, out);
  fs.writeFileSync(file, out.body as Buffer);
  return { file, job };
}
const decodeFrames = (file: string, frames: number[]) => { const sel = frames.map((n) => `eq(n\\,${n})`).join('+'); const raw = ff(['-i', file, '-vf', `select='${sel}'`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const per = W * H * 3; return frames.map((_, i) => raw.subarray(i * per, (i + 1) * per)); };
/** The two magenta centroids' distances (px) from the targets in an rgb24 frame, or the reason they could not be measured. */
function centroidError(rgb: Buffer, targets: readonly [{ x: number; y: number }, { x: number; y: number }] = TARGETS): { worst: number; at: string } | string {
  const c = magentaCentroids(rgb, W, H, targets, 40);
  if (!c[0] || !c[1]) return `no magenta found near ${c[0] ? 'R' : 'L'}`;
  const d = [Math.hypot(c[0].x - targets[0].x, c[0].y - targets[0].y), Math.hypot(c[1].x - targets[1].x, c[1].y - targets[1].y)];
  return { worst: Math.max(...d), at: `L (${r3(c[0].x)}, ${r3(c[0].y)}) R (${r3(c[1].x)}, ${r3(c[1].y)})` };
}
/** A planner that is not built yet answers 501 growing_not_built: thrown, so the check says it waits (never a pass, never a fail of the rule). */
const built = (r: Res): Res => { if (r.body?.error?.code === 'growing_not_built') throw new Fail('the planner answered growing_not_built', r); return r; };
const fails = (list: (string | false | null | undefined)[]): true | string => { const f = list.filter((x): x is string => typeof x === 'string'); return f.length ? f.join('; ') : true; };
/** Runs a check; a refusal because a part is not built yet is said as such (it waits for W1), never as a pass. */
async function guarded(fn: (e: Env) => Promise<true | string>): Promise<true | string> {
  let e: Env;
  try { e = await env(); } catch (x) { return `BLOCKED: the proof's server or fixtures could not be made here: ${(x as Error).message}`; }
  try { return await fn(e); } catch (x) {
    const res = x instanceof Fail ? x.res : undefined;
    if (res?.body?.error?.code === 'growing_not_built') return `waits for W1 (growing_not_built: ${j(res.body.error.details ?? {})}): ${(x as Error).message}`;
    return (x as Error).message.startsWith('BLOCKED') ? (x as Error).message : `error: ${(x as Error).message}`;
  }
}

// ---------- the main film: twelve faces and a held video frame, dated, two undated, a person with a birth date ----------
/** Capture days typed here (two faces undated). The order they must come in is worked out from these, not from the plan. */
const DAYS: Record<string, string | null> = { 'f01.png': '2021-03-05', 'f02.png': '2019-06-01', 'f03.png': null, 'f04.png': '2023-01-20', 'f05.png': '2020-02-10', 'f06.png': '2022-08-15', 'f07.png': null, 'f08.png': '2018-11-30', 'f09.png': '2024-05-02', 'f10.png': '2021-12-24', 'exif6.jpg': '2020-07-07', 'exif3.jpg': '2022-02-02', 'video.mp4': '2019-01-15' };
const BIRTH = '2019-03-01';
/** The expected show order: dated ones by day, each undated one right after the pick it followed in the given list (plan §4.7). */
function expectedOrder(given: string[]): string[] {
  const dated = given.filter((n) => DAYS[n]).sort((a, b) => (DAYS[a]! < DAYS[b]! ? -1 : 1));
  const out = [...dated];
  for (const [i, n] of given.entries()) {
    if (DAYS[n]) continue;
    const before = i === 0 ? null : given[i - 1]!;
    out.splice(before === null ? 0 : out.indexOf(before) + 1, 0, n);
  }
  return out;
}
interface Main { pid: string; ids: Record<string, string>; nameOf: (assetId: string) => string; given: string[]; params: Record<string, unknown>; view: any; applied: any; doc: ProjectDocument; personId: string }
let mainPromise: Promise<Main> | null = null;
const main = (e: Env) => (mainPromise ??= makeMain(e));
async function makeMain(e: Env): Promise<Main> {
  const pid = await newProject(e, 'growing main');
  const ids: Record<string, string> = {};
  for (const f of e.fx.faces) ids[f.name] = await upload(e, pid, f.file);
  ids['video.mp4'] = await upload(e, pid, e.fx.video.file);
  // the undated ones are left as they came: drawn files carry no date of their own
  await tx(e, pid, Object.entries(DAYS).filter(([, day]) => day).map(([n, day]) => ({ op: 'set_asset_capture', args: { assetId: ids[n], capture: { at: day } } })));
  const person = await tx(e, pid, [{ op: 'add_person', args: { name: 'Noa', birthDate: BIRTH } }]);
  const personId = person.results?.[0]?.output?.personId as string;
  const given = [...e.fx.faces.map((f) => f.name), 'video.mp4'];
  const picks = given.map((n) => {
    if (n === 'video.mp4') { const v = e.fx.video, m = v.eyesAt(12); return { assetId: ids[n], frame: 12, eyes: marksOf({ ...m, width: v.width, height: v.height }) }; }
    return { assetId: ids[n], frame: null, eyes: marksOf(e.fx.faces.find((f) => f.name === n)!) };
  });
  // one planted coordinate travels in the request (G9): the left eye of the first face is moved to it, and its right eye by as much
  const f1 = e.fx.faces[0]!;
  picks[0]!.eyes = [{ u: PLANTED, v: f1.a.y / f1.height }, { u: PLANTED + (f1.b.x - f1.a.x) / f1.width, v: f1.b.y / f1.height }];
  const params = { picks, holdFrames: 30, dissolve: 'short', caption: { date: true, age: true }, personId };
  const view = must(await e.owner(`/projects/${pid}/recipes/growing/plan`, { params }), 'plan');
  const applied = must(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params }), 'apply');
  const doc = await getDoc(e, pid);
  return { pid, ids, nameOf: (a) => Object.keys(ids).find((k) => ids[k] === a) ?? a, given, params, view, applied, doc, personId };
}
const pickOf = (m: Main, name: string) => m.applied.picks.find((p: any) => m.nameOf(p.assetId) === name);
/** The frame of the middle of a pick's hold. */
const mid = (p: any) => p.startFrame + Math.floor(p.frames / 2);
/** Is frame point (px, py) on the picture of a pick (this file's own inverse of the placement, plan §4.1)? */
function onPicture(p: any, shown: { width: number; height: number }, px: number, py: number): boolean {
  const k = Math.min(W / shown.width, H / shown.height), w = shown.width * k * p.transform.scale, h = shown.height * k * p.transform.scale;
  const cx = W / 2 + p.transform.x * W, cy = H / 2 + p.transform.y * H, a = (-p.transform.rotation * Math.PI) / 180;
  const dx = px - cx, dy = py - cy, lx = Math.cos(a) * dx - Math.sin(a) * dy, ly = Math.sin(a) * dx + Math.cos(a) * dy;
  return Math.abs(lx) < w / 2 && Math.abs(ly) < h / 2;
}
const shownOf = (e: Env, name: string) => (name === 'video.mp4' ? { width: e.fx.video.width, height: e.fx.video.height } : e.fx.faces.find((f) => f.name === name)!);

// ---------- the browser half (integration) ----------
/** The owner's server still (rgb24): the film shows family fields (the age caption), which the owner's editor shows too. */
async function ownerStill(e: Env, pid: string, n: number): Promise<Buffer> {
  if (!e.rendered) throw new Fail('BLOCKED: no web bundle (render.html) here, so no still can be rendered; run pnpm build');
  const r = await e.owner(`/projects/${pid}/frame?index=${n}`);
  if (r.status !== 200) throw new Fail(`owner still ${n} → ${r.status} ${j(r.body?.error ?? '')}`, r);
  return rgbOfPng(r.body as Buffer);
}
/** Opens the editor as the owner on a project in a fresh headless Chromium; `run` gets the page; the browser is closed after. */
async function withEditor<R>(e: Env, pid: string | null, run: (page: Page) => Promise<R>): Promise<R> {
  let browser;
  try { browser = await chromium.launch(); } catch (x) { throw new Fail(`BLOCKED: Chromium could not start: ${(x as Error).message}`); }
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await page.addInitScript('globalThis.__name = (f) => f; try { localStorage.setItem("pf.lang", "en"); } catch {}');
    if (pid) { await page.goto(`${e.s.ownerUrl}&project=${pid}`); await page.getByTestId('timecode').waitFor({ timeout: 60_000 }); }
    return await run(page);
  } finally { await browser.close(); }
}
/** The paused editor preview at `frame` (rgb24, W×H): the editor's «go to frame» entry (G, as craft-proof.ui.ts seeks). */
async function previewAt(page: Page, frame: number, _from: number | null): Promise<Buffer> {
  // G is enabled once the player knows the film's length (craft.commands.ts transport.gotoTime): ask again until the entry opens
  const input = page.getByTestId('craft-time-input');
  let opened = false;
  for (let i = 0; i < 30 && !opened; i++) {
    await page.evaluate(() => { const t = document.activeElement ?? document.body; t.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', bubbles: true, cancelable: true })); });
    opened = await input.waitFor({ timeout: 1000 }).then(() => true, () => false);
  }
  if (!opened) throw new Fail('the «go to frame» entry (G) did not open in 30 s');
  await input.fill(String(frame));
  await page.keyboard.press('Enter');
  await page.getByTestId('craft-time-entry').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined);
  const ok = await page.waitForFunction((n) => { const c = document.querySelector('canvas[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(n) && c.dataset.quality === 'full'; }, frame, { timeout: 60_000 }).then(() => true, () => false);
  if (!ok) {
    const st = await page.evaluate(() => { const c = document.querySelector('canvas[data-testid=preview]') as HTMLCanvasElement | null; return c ? { ...c.dataset } : null; });
    throw new Fail(`the preview did not show frame ${frame} at full quality in 60 s (canvas ${j(st)})`);
  }
  await sleep(300);
  const b64: string = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array((d.length / 4) * 3);
    for (let i = 0, k = 0; i < d.length; i += 4) { out[k++] = d[i]!; out[k++] = d[i + 1]!; out[k++] = d[i + 2]!; }
    let s2 = ''; for (let i = 0; i < out.length; i += 0x8000) s2 += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return `${c.width}x${c.height}:${btoa(s2)}`;
  });
  const [size, data] = b64.split(':');
  if (size !== `${W}x${H}`) throw new Fail(`the preview canvas is ${size}, not ${W}x${H}`);
  return Buffer.from(data ?? '', 'base64');
}
const differing = (a: Buffer, b: Buffer) => { let n = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { n++; if (d > max) max = d; } } return { n, max, same: a.length === b.length && n === 0 }; };
/** Preview against the owner's still at each frame (ascending), in one editor session. */
async function previewVsStill(e: Env, pid: string, frames: number[]): Promise<string[]> {
  const out: string[] = [];
  const sorted = [...new Set(frames)].sort((a, b) => a - b);
  await withEditor(e, pid, async (page) => {
    let at: number | null = null;
    for (const n of sorted) {
      const pv = await previewAt(page, n, at); at = n;
      const d = differing(pv, await ownerStill(e, pid, n));
      if (!d.same) out.push(`frame ${n}: ${d.n} bytes differ (at most ${d.max} levels)`);
    }
  });
  return out;
}
/** core's planGrowing bundled for the browser (the esbuild that tsx ships), as one script. */
let bundle: string | null = null;
async function plannerBundle(): Promise<string> {
  if (bundle) return bundle;
  const esbuild = createRequire(createRequire(import.meta.url).resolve('tsx'))('esbuild') as { build(o: unknown): Promise<{ outputFiles: { text: string }[] }> };
  const r = await esbuild.build({ stdin: { contents: "export { planGrowing } from '@pulseframe/core';", resolveDir: import.meta.dirname, loader: 'ts' }, bundle: true, format: 'iife', globalName: 'PFGrowing', platform: 'browser', write: false, logLevel: 'error' });
  return (bundle = r.outputFiles[0]!.text);
}
/** Every number of two plans, walked together: the largest absolute difference and the first place the shapes differ. */
function compareNumbers(a: unknown, b: unknown, at = 'plan'): { max: number; where: string; shape: string | null } {
  let max = 0, where = '', shape: string | null = null;
  const walk = (x: unknown, y: unknown, p: string) => {
    if (shape) return;
    if (typeof x === 'number' && typeof y === 'number') { const d = Math.abs(x - y); if (d > max) { max = d; where = p; } return; }
    if (typeof x !== typeof y || Array.isArray(x) !== Array.isArray(y)) { shape = p; return; }
    if (Array.isArray(x)) { const ya = y as unknown[]; if (x.length !== ya.length) { shape = `${p} (length)`; return; } x.forEach((v, i) => walk(v, ya[i], `${p}[${i}]`)); return; }
    if (x && typeof x === 'object') { const xo = x as Record<string, unknown>, yo = y as Record<string, unknown>; const keys = Object.keys(xo); if (keys.join() !== Object.keys(yo).join()) { shape = `${p} (keys)`; return; } for (const k of keys) walk(xo[k], yo[k], `${p}.${k}`); return; }
    if (x !== y) shape = `${p} (${String(x).slice(0, 30)} vs ${String(y).slice(0, 30)})`;
  };
  walk(a, b, at);
  return { max, where, shape };
}

export const GROWING_PROOF_SERVER: GrowingProofPart = {
  built: true,
  checks: {
    G1: () => guarded(async (e) => {
      const m = await main(e);
      const out: string[] = [];
      for (const p of m.applied.picks) {
        const name = m.nameOf(p.assetId);
        if (name === 'f01.png') continue; // its marks carry the planted coordinate, not the drawn eye: G9's, not G1's
        const r = centroidError(await still(e, m.pid, mid(p)));
        if (typeof r === 'string') out.push(`${name} at frame ${mid(p)}: ${r}`);
        else if (r.worst > 1.0) out.push(`${name} at frame ${mid(p)}: ${r3(r.worst)} px from the targets (${r.at})`);
      }
      return m.applied.picks.length < 12 ? `only ${m.applied.picks.length} picks placed: ${j(m.applied.excluded)}` : fails(out);
    }),
    G2: () => guarded(async (e) => {
      const m = await main(e);
      const sorted = [...m.applied.picks].sort((a: any, b: any) => a.startFrame - b.startFrame);
      const withDissolve = sorted.find((p: any, i: number) => i > 0 && p.dissolveFrames > 1);
      if (!withDissolve) return 'no dissolve in the film';
      const inside = withDissolve.startFrame + Math.floor(withDissolve.dissolveFrames / 2);
      const frames = [mid(sorted[0]), inside, mid(sorted[1]), mid(sorted[2]), mid(sorted[3]), sorted[3].startFrame + 1];
      const out = await previewVsStill(e, m.pid, frames);
      console.log(`  G2: paused editor preview vs the owner's server still at frames ${[...new Set(frames)].sort((a, b) => a - b).join(', ')} (${inside} inside a dissolve)`);
      return fails(out);
    }),
    G3: () => guarded(async (e) => {
      const m = await main(e);
      const { file } = await exportMp4(e, m.pid);
      const count = Number(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
      const end = Math.max(...m.applied.picks.map((p: any) => p.startFrame + p.frames));
      const picks = m.applied.picks.filter((p: any) => m.nameOf(p.assetId) !== 'f01.png');
      const frames = decodeFrames(file, picks.map(mid));
      const out: (string | false)[] = [count !== end && `the export has ${count} frames, the plan ends at frame ${end}`];
      for (const [i, p] of picks.entries()) { const r = centroidError(frames[i]!); out.push(typeof r === 'string' ? `${m.nameOf(p.assetId)}: ${r}` : r.worst > 2 && `${m.nameOf(p.assetId)}: ${r3(r.worst)} px (${r.at})`); }
      return fails(out);
    }),
    G4: () => guarded(async (e) => {
      const m = await main(e);
      const got = [...m.applied.picks].sort((a: any, b: any) => a.startFrame - b.startFrame).map((p: any) => m.nameOf(p.assetId));
      const want = expectedOrder(m.given);
      return JSON.stringify(got) === JSON.stringify(want) ? true : `order ${j(got)}, expected ${j(want)}`;
    }),
    G5: () => guarded(async (e) => {
      const m = await main(e);
      const p = pickOf(m, 'video.mp4');
      if (!p) return `the video pick was not placed: ${j(m.applied.excluded)}`;
      const clip = Object.values(m.doc.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).find((c: any) => c.type === 'media' && c.assetId === m.ids['video.mp4']) as any;
      const out: (string | false)[] = [!clip?.freeze && 'the video pick is not a held frame (add_clip freeze)'];
      // the eyes drift 2 px a frame in the source: a neighbouring frame would put them about 2·√2·m px off, so 1 px names the frame
      for (const n of [p.startFrame + p.dissolveFrames, mid(p), p.startFrame + p.frames - 1]) { const r = centroidError(await still(e, m.pid, n)); out.push(typeof r === 'string' ? `frame ${n}: ${r}` : r.worst > 1 && `frame ${n}: ${r3(r.worst)} px (${r.at}; magnification ${r3(p.magnification)})`); }
      // the preview half: the paused editor preview at the same frames is the owner's still, byte for byte
      const pv = await previewVsStill(e, m.pid, [p.startFrame + p.dissolveFrames, mid(p), p.startFrame + p.frames - 1]);
      return fails([...out, ...pv.map((x) => `preview ${x}`)]);
    }),
    G6: () => guarded(async (e) => {
      // its own film without captions (integration): the main film's captions cut at the slot boundary while the pictures dissolve,
      // so its frames on either side of a dissolve differ in the caption band by more than any mix
      const pid = await newProject(e, 'G6');
      const v = e.fx.video, face = e.fx.faces.find((f) => f.name === 'f06.png')!;
      const picks = [{ assetId: await upload(e, pid, v.file), frame: 12, eyes: marksOf({ ...v.eyesAt(12), width: v.width, height: v.height }) }, { assetId: await upload(e, pid, face.file), frame: null, eyes: marksOf(face) }];
      const applied = must(built(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params: { picks, sort: 'given', holdFrames: 30, dissolve: 'short', caption: null } })), 'apply');
      const sorted = [...applied.picks].sort((a: any, b: any) => a.startFrame - b.startFrame);
      const next = sorted[1];
      if (sorted.length !== 2 || sorted[0].assetId !== picks[0]!.assetId || !next) return `expected the held frame then the face: ${j(sorted)}`;
      if (!next.dissolveFrames) return `the pick after the held frame has no dissolve (${j(next)})`;
      const s = next.startFrame, D = next.dissolveFrames;
      const [out, inn, mixed] = [await still(e, pid, s - 1), await still(e, pid, s + D), await still(e, pid, s + Math.floor(D / 2))];
      // the progress p is fitted by least squares over every byte (the engine's own p is not read back), then each byte is compared
      let num = 0, den = 0;
      for (let i = 0; i < mixed.length; i++) { const d = inn[i]! - out[i]!; num += (mixed[i]! - out[i]!) * d; den += d * d; }
      const p = den ? num / den : NaN;
      let worst = 0, signed = 0;
      for (let i = 0; i < mixed.length; i++) { const x = mixed[i]! - Math.round(out[i]! + p * (inn[i]! - out[i]!)); worst = Math.max(worst, Math.abs(x)); signed += x; }
      const mean = signed / mixed.length;
      return fails([!(p > 0 && p < 1) && `fitted progress ${p}`, worst > 2 && `a byte is ${worst} levels from round(out·(1−p)+in·p) at p = ${r3(p)}`, Math.abs(mean) > 0.1 && `mean signed deviation ${r3(mean)}`]);
    }),
    G7: () => guarded(async (e) => {
      const m = await main(e);
      const bg = m.doc.settings.background.replace('#', '');
      const bgRgb = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16));
      const pts = [[1, 1], [W - 2, 1], [1, H - 2], [W - 2, H - 2], [W / 2, 1], [W / 2, H - 2], [1, H / 2], [W - 2, H / 2]] as const;
      const out: string[] = [];
      const isBg = (rgb: Buffer, x: number, y: number) => { const i = (Math.floor(y) * W + Math.floor(x)) * 3; return rgb[i] === bgRgb[0] && rgb[i + 1] === bgRgb[1] && rgb[i + 2] === bgRgb[2]; };
      let uncovered = 0;
      for (const p of m.applied.picks) {
        const name = m.nameOf(p.assetId), rgb = await still(e, m.pid, mid(p));
        for (const [x, y] of pts) {
          const on = onPicture(p, shownOf(e, name), x + 0.5, y + 0.5);
          // a point 2 px from the picture's edge can be either: only clear cases are judged
          const clear = on === onPicture(p, shownOf(e, name), x + 2.5, y + 2.5) && on === onPicture(p, shownOf(e, name), x - 1.5, y - 1.5);
          if (!clear) continue;
          if (!on) uncovered++;
          if (on === isBg(rgb, x, y)) out.push(`${name} (${x}, ${y}): ${on ? 'covered but background' : 'uncovered but not exactly the background colour'}`);
        }
      }
      // at the suggested face size no pick leaves a corner uncovered: plan it (read-only) and compare the grid with the geometry here
      const suggested = m.view.suggestedFaceSize;
      if (typeof suggested !== 'number') return fails([...out, `no suggested face size (${j(suggested)}; cannot_cover_all: ${j(m.view.warnings?.filter((w: any) => w.code === 'cannot_cover_all'))})`]);
      const v2 = must(await e.owner(`/projects/${m.pid}/recipes/growing/plan`, { params: { ...m.params, faceSize: suggested, at: T.frameTime(600, R30) } }), 'plan at the suggested face size');
      for (const p of v2.picks) {
        if (p.uncoveredShare !== 0) out.push(`at face size ${suggested}, ${m.nameOf(p.assetId)} leaves ${p.uncoveredShare} of the grid uncovered`);
        for (const [x, y] of pts) if (!onPicture(p, shownOf(e, m.nameOf(p.assetId)), x + 0.5, y + 0.5)) out.push(`at face size ${suggested}, ${m.nameOf(p.assetId)} does not cover (${x}, ${y}) by this file's geometry`);
      }
      return fails([...out, uncovered === 0 && 'no uncovered point at the default face size: the colour-fill half measured nothing']);
    }),
    G8: () => guarded(async (e) => {
      const m = await main(e);
      const doc = await getDoc(e, m.pid);
      const out: string[] = [];
      const run = doc.recipeRuns[m.applied.runId]!;
      const textIds = new Set((run.slots ?? []).filter((x) => x.kind === 'text').map((x) => x.clipId));
      const captions = Object.values(doc.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).filter((c: any) => textIds.has(c.id)) as any[];
      /** The run's caption template on a frame (the text clip of the run under it), and what evaluate resolves there for the owner. */
      const at = (frame: number) => {
        const t = T.frameTime(frame, R30);
        const c = captions.find((x) => T.cmp(x.start, t) <= 0 && T.cmp(t, T.add(x.start, x.duration)) < 0);
        const found: { clipId: string; text: string }[] = [];
        JSON.stringify(evaluate(doc, t), (_k, v) => { if (v && typeof v === 'object' && v.kind === 'text' && typeof v.text === 'string') found.push({ clipId: v.clipId, text: v.text }); return v; });
        return { template: c?.text as string | undefined, shown: c ? found.find((f) => f.clipId === c.id)?.text : undefined };
      };
      for (const p of m.applied.picks) {
        const name = m.nameOf(p.assetId), day = DAYS[name] ?? null;
        // the middle of the hold, and the frame where its dissolve starts (verifier C14: whose date shows while two pictures mix)
        for (const n of [mid(p), p.startFrame]) {
          const c = at(n);
          if (!day) { if (c.template !== undefined) out.push(`${name} is undated but frame ${n} has the caption ${j(c.template)}`); continue; }
          if (c.template === undefined) { out.push(`${name} (${day}) frame ${n}: no caption`); continue; }
          const wantsAge = day >= BIRTH;
          if (!c.template.includes('{date}')) out.push(`${name} frame ${n}: no {date} in ${j(c.template)}`);
          if (wantsAge !== c.template.includes(`{age:${m.personId}`)) out.push(`${name} (${day}, birth ${BIRTH}) frame ${n}: age field ${wantsAge ? 'missing' : 'present before the birth'} in ${j(c.template)}`);
          if (!c.shown || c.shown.includes('{') || !c.shown.includes(day.slice(0, 4))) out.push(`${name} (${day}) frame ${n}: evaluate shows ${j(c.shown)} (want words with ${day.slice(0, 4)})`);
        }
      }
      const pre = must(await e.owner(`/projects/${m.pid}/preflight`), 'preflight');
      const blockers = (pre.issues ?? []).filter((i: any) => i.severity === 'blocker');
      return fails([...out, captions.length === 0 && 'the run made no captions', blockers.length > 0 && `preflight blockers: ${j(blockers.map((b: any) => b.code))}`]);
    }),
    G9: () => guarded(async (e) => {
      const m = await main(e);
      const planted = String(PLANTED);
      const full = await e.grant('edit', { people: 'full' }), names = await e.grant('edit');
      await e.owner(`/projects/${m.pid}/versions`, { name: 'after growing' });
      const out: string[] = [];
      const db = e.s.store.db;
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) {
        const rows = JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all(), (_k, x) => (Buffer.isBuffer(x) ? x.toString('latin1') : x));
        if (rows.includes(planted)) out.push(`table ${name} holds the planted coordinate`);
        if (rows.includes('eyeMarks')) out.push(`table ${name} holds an eyeMarks key`);
      }
      for (const q of ['', '?family=omit', '?library=strip', '?library=keep']) { const r = await e.owner(`/projects/${m.pid}/archive${q}`); if (r.status !== 200) out.push(`archive${q} → ${r.status}`); else if ((r.body as Buffer).toString('latin1').includes(planted)) out.push(`archive${q} holds it`); }
      for (const token of [e.s.auth.tokens.agent, full, names]) {
        for (const p of ['', '/summary', '/timeline', '/history', '/versions', '/proposals']) { const r = await e.call(`/projects/${m.pid}${p}`, undefined, token); if (JSON.stringify(r.body).includes(planted)) out.push(`GET ${p || '/'} holds it`); }
        for (const kind of ['summary', 'timeline']) if (JSON.stringify(await e.mcp(token, 'resources/read', { uri: `pulseframe://projects/${m.pid}/${kind}` })).includes(planted)) out.push(`MCP ${kind} holds it`);
      }
      if (JSON.stringify([m.view, m.applied]).includes(planted)) out.push('the plan or apply answer echoes it');
      // an eyeMarks KEY in the code (a property or a field, not the comments that say there is none); grep exits 1 when it finds nothing
      let code = '';
      try { code = execFileSync('grep', ['-rlE', '--include=*.ts', '--include=*.tsx', `eyeMarks['"]?\\s*[?]?[:=(]`, path.join(root, 'packages'), path.join(root, 'apps')], { encoding: 'utf8' }); } catch { code = ''; }
      if (code.trim()) out.push(`an eyeMarks key in the code: ${code.trim().split('\n').join(', ')}`);
      return fails(out);
    }),
    G10: () => guarded(async (e) => {
      const m = await main(e).catch(() => null);
      const pid = m?.pid ?? await newProject(e, 'G10');
      const runId = m?.applied?.runId ?? 'run_none';
      const params = { picks: [{ assetId: 'a', frame: null, eyes: [{ u: PLANTED, v: 0.4 }, { u: 0.6, v: 0.4 }] }, { assetId: 'b', frame: null }] };
      const tokens: [string, string][] = [['agent', e.s.auth.tokens.agent], ['observer', e.s.auth.tokens.observer], ['edit + people full', await e.grant('edit', { people: 'full' })], ['propose', await e.grant('propose')]];
      const before = await docHash(e, pid);
      const out: string[] = [];
      for (const [who, token] of tokens) {
        for (const [url, body] of [[`/projects/${pid}/recipes/growing/plan`, { params }], [`/projects/${pid}/recipes/growing/apply`, { params }], [`/projects/${pid}/recipe-runs/${runId}/regenerate`, { params }], [`/projects/${pid}/template-runs/${runId}/regenerate`, { params }]] as const) {
          const r = await e.call(url, body, token);
          if (m && (r.status !== 403 || r.body?.error?.code !== 'owner_required')) out.push(`${who} ${url} → ${r.status} ${r.body?.error?.code}`);
        }
        for (const [name, args] of [['plan_recipe', { projectId: pid, recipeId: 'growing', params }], ['apply_recipe', { projectId: pid, recipeId: 'growing', params }], ['regenerate_recipe', { projectId: pid, runId, params }], ['regenerate_template', { projectId: pid, runId, params }]] as const) {
          const r = await e.mcp(token, 'tools/call', { name, arguments: args });
          const text = String(r.result?.content?.[0]?.text ?? '');
          if (!r.result?.isError || (m && !text.includes('owner_required'))) out.push(`${who} MCP ${name}: ${text.slice(0, 120)}`);
        }
      }
      if ((await docHash(e, pid)) !== before) out.push('something was committed');
      return m ? fails(out) : fails([...out, 'waits for W1: no growing run exists to rebuild, so the rebuild routes answered 404 before the owner check']);
    }),
    G11: () => guarded(async (e) => {
      const m = await main(e);
      const run = m.doc.recipeRuns[m.applied.runId] as any;
      const extra = Object.keys(run.params).filter((k) => ![...GROWING_RECORD_KEYS, 'templateVersion'].includes(k));
      const unit: string[] = [];
      const walk = (v: unknown, at: string) => { if (typeof v === 'number' && v >= 0 && v <= 1 && !['faceSize', 'eyeLine'].includes(at)) unit.push(`${at}=${v}`); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, Array.isArray(v) ? at : k); };
      walk(run.params, '');
      // frame numbers and 0/1 are whole; a coordinate is a fraction
      const fractions = unit.filter((s) => !Number.isInteger(Number(s.split('=')[1])));
      return fails([extra.length > 0 && `the run record holds ${j(extra)}`, fractions.length > 0 && `fractions in [0, 1] in the run record: ${j(fractions)}`, JSON.stringify(run.params).includes('"u"') && 'a "u" key in the run record']);
    }),
    G12: () => guarded(async (e) => {
      const fx = e.fx.faces.slice(0, 3);
      const pid = await newProject(e, 'G12');
      const picks = [];
      for (const f of fx) picks.push({ assetId: await upload(e, pid, f.file), frame: null, eyes: marksOf(f) });
      const before = await docHash(e, pid);
      const a = must(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params: { picks, holdFrames: 15 } }), 'apply');
      const after = await docHash(e, pid);
      const tx1 = must(await e.owner(`/projects/${pid}/history`), 'history');
      must(await e.owner(`/projects/${pid}/undo`, {}), 'undo');
      const undone = await docHash(e, pid);
      must(await e.owner(`/projects/${pid}/redo`, {}), 'redo');
      const redone = await docHash(e, pid);
      return fails([undone !== before && 'one undo did not return the document hash to the one before apply', redone !== after && 'redo did not restore it', !a.runId && 'no run id', after === before && 'apply changed nothing', JSON.stringify(tx1).includes(String(PLANTED)) && 'history holds a coordinate']);
    }),
    G13: () => guarded(async (e) => {
      const fx = e.fx.faces.slice(0, 4);
      const pid = await newProject(e, 'G13');
      const ids: string[] = [];
      for (const f of fx) ids.push(await upload(e, pid, f.file));
      const params = { picks: fx.map((f, i) => ({ assetId: ids[i]!, frame: null, eyes: marksOf(f) })), holdFrames: 30, sort: 'given' };
      const a = must(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params }), 'apply');
      const keys = ids.map((id) => growingPickKey(id, null));
      const clipOf = (d: ProjectDocument, key: string) => { const s = (d.recipeRuns[a.runId]!.slots ?? []).find((x) => x.key === key && x.kind === 'picture'); return s ? Object.values(d.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).find((c) => c.id === s.clipId) as any : undefined; };
      const d0 = await getDoc(e, pid);
      const [A, B, C, D] = keys.map((k) => clipOf(d0, k));
      await tx(e, pid, [
        { op: 'set_clip_transform', args: { clipId: A.id, transform: { rotation: A.transform.rotation + 7 } } },
        { op: 'delete_clip', args: { clipId: B.id } },
        { op: 'move_clip', args: { clipId: C.id, start: T.frameTime(900, R30) } },
      ]);
      const r = must(await e.owner(`/projects/${pid}/recipe-runs/${a.runId}/regenerate`, {}), 'rebuild');
      const d1 = await getDoc(e, pid);
      const A1 = clipOf(d1, keys[0]!), C1 = clipOf(d1, keys[2]!), D1 = clipOf(d1, keys[3]!);
      const same = (x: any, y: any) => ['x', 'y', 'scale', 'rotation'].every((k) => Math.abs(x.transform[k] - y.transform[k]) <= GROWING.agreeWithin * 2);
      const out: (string | false)[] = [
        (A1?.id !== A.id || A1.transform.rotation !== A.transform.rotation + 7) && 'the hand-rotated pick was not kept exactly',
        clipOf(d1, keys[1]!) !== undefined && 'the deleted pick came back without being asked',
        !r.removed?.includes(keys[1]) && `the deleted pick is not named (removed ${j(r.removed)})`,
        !(r.movedBack ?? []).includes(keys[2]) && `the moved pick is not named moved_back (${j(r.movedBack)})`,
        (!C1 || !T.eq(C1.start, C.start)) && 'the moved pick did not go back to its place',
        (!D1 || !same(D, D1)) && 'the untouched pick did not keep its transform (eyes through eyesFromTransform)',
      ];
      const r2 = must(await e.owner(`/projects/${pid}/recipe-runs/${a.runId}/regenerate`, { restoreRemoved: true }), 'restore without marks');
      out.push(!(r2.excluded ?? []).some((x: any) => x.key === keys[1] && x.code === 'needs_marks') && `restoreRemoved without marks: not named needs_marks (${j(r2.excluded)})`);
      const back = params.picks.map((p, i) => (i === 1 ? p : { assetId: p.assetId, frame: null }));
      must(await e.owner(`/projects/${pid}/recipe-runs/${a.runId}/regenerate`, { params: { picks: back }, restoreRemoved: true }), 'restore marked again');
      const B3 = clipOf(await getDoc(e, pid), keys[1]!);
      out.push((!B3 || !same(B, B3) || !T.eq(B3.start, B.start)) && 'the deleted pick marked again did not come back as it was');
      return fails(out);
    }),
    G14: () => guarded(async (e) => {
      const min = Math.ceil(30 / 3 - 1e-9) + 1;
      const pid = await newProject(e, 'G14 planner');
      const black = await upload(e, pid, e.fx.black), white = await upload(e, pid, e.fx.white);
      // marks on the targets of a picture the frame's size: the identity transform, so each picture covers the whole frame
      const ident = [{ u: TARGETS[0].x / W, v: TARGETS[0].y / H }, { u: TARGETS[1].x / W, v: TARGETS[1].y / H }];
      const two = must(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params: { picks: [{ assetId: black, frame: null, eyes: ident }, { assetId: white, frame: null, eyes: ident }], holdFrames: min, dissolve: 'none' } }), 'apply');
      // the planner takes one pick per file: the alternation is the run's two picks repeated by hand (the same hold, cut on cut)
      const ops: unknown[] = [];
      for (let k = 2; k < 12; k++) ops.push({ op: 'add_clip', args: { assetId: k % 2 ? white : black, start: T.frameTime(k * min, R30), duration: T.frameTime(min, R30), withLinkedAudio: false } });
      await tx(e, pid, ops);
      const fast = await newProject(e, 'G14 control');
      const b2 = await upload(e, fast, e.fx.black), w2 = await upload(e, fast, e.fx.white);
      await tx(e, fast, Array.from({ length: 30 }, (_, k) => ({ op: 'add_clip', args: { assetId: k % 2 ? w2 : b2, start: T.frameTime(4 * k, R30), duration: T.frameTime(4, R30), withLinkedAudio: false } })));
      const slow = (await exportMp4(e, pid)).job.output?.photosensitivity, ctl = (await exportMp4(e, fast)).job.output?.photosensitivity;
      return fails([!two.runId && 'no run', slow?.verdict === 'fail' && `at the minimum hold (${min} frames) the check reports a failing stretch: ${j(slow?.ranges)}`, !slow && 'no photosensitivity report on the export', ctl?.verdict !== 'fail' && `control at a 4-frame hold is not reported failing (${j(ctl?.verdict)})`]);
    }),
    G15: () => guarded(async (e) => {
      const pid = await newProject(e, 'G15');
      const f = e.fx.faces.slice(0, 2);
      const picks = [];
      for (const x of f) picks.push({ assetId: await upload(e, pid, x.file), frame: null, eyes: marksOf(x) });
      const before = await docHash(e, pid);
      const min = Math.ceil(30 / 3 - 1e-9) + 1;
      const r = built(await e.owner(`/projects/${pid}/recipes/growing/apply`, { params: { picks, holdFrames: min - 1 } }));
      const he = translateRefusal('he', r.body?.error?.message ?? '');
      return fails([r.status !== 422 && `a ${min - 1}-frame hold → ${r.status} ${j(r.body?.error)}`, r.body?.error?.message !== `each picture must stay at least ${min} frames, so that the film does not flash` && `wording: ${j(r.body?.error?.message)}`, !he?.includes(String(min)) && `Hebrew: ${j(he)}`, (await docHash(e, pid)) !== before && 'something was committed (raised instead of refused?)']);
    }),
    G16: () => guarded(async (e) => {
      const pid = await newProject(e, 'G16');
      const still = await upload(e, pid, e.fx.faces[0]!.file), video = await upload(e, pid, e.fx.video.file);
      const out: string[] = [];
      const expect = async (what: string, r: Res, code: string, en: RegExp) => {
        const err = r.body?.error ?? {};
        const he = translateRefusal('he', err.message ?? '');
        if (err.code !== code || !en.test(err.message ?? '') || !he || !/[֐-׿]/.test(he)) out.push(`${what}: ${r.status} ${err.code} ${j(err.message)} he ${j(he)}`);
      };
      const one = (args: Record<string, unknown>) => e.owner(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { start: T.ZERO, duration: T.frameTime(15, R30), ...args } }] });
      await expect('freeze on a still', await one({ assetId: still, freeze: true }), 'incompatible', /a held frame needs a video file/);
      await expect('freeze with linked sound', await one({ assetId: video, freeze: true, withLinkedAudio: true }), 'incompatible', /^a held frame has no sound$/);
      await expect('freeze without a duration', await e.owner(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: video, start: T.ZERO, freeze: true } }] }), 'invalid_args', /^a held frame needs a duration$/);
      const f0 = e.fx.faces[0]!, eyes = marksOf(f0);
      const planned = async (params: Record<string, unknown>) => built(await e.owner(`/projects/${pid}/recipes/growing/plan`, { params }));
      const base = { assetId: still, frame: null, eyes };
      await expect('needs_marks', await planned({ picks: [base, { assetId: video, frame: 3 }] }), 'invalid_request', /^a picture has no eye marks$/);
      await expect('duplicate', await planned({ picks: [base, base] }), 'invalid_request', /^the same picture is chosen twice$/);
      await expect('too close', await planned({ picks: [base, { assetId: video, frame: 3, eyes: [{ u: 0.5, v: 0.5 }, { u: 0.501, v: 0.5 }] }] }), 'invalid_request', /^the two eye marks are too close together$/);
      await expect('frame on a still', await planned({ picks: [{ ...base, frame: 2 }, { assetId: video, frame: 3, eyes }] }), 'invalid_request', /^a still picture has no frame number$/);
      await expect('no frame', await planned({ picks: [base, { assetId: video, frame: null, eyes }] }), 'invalid_request', /^a video needs the number of the frame to hold$/);
      await expect('no such frame', await planned({ picks: [base, { assetId: video, frame: 600, eyes }] }), 'out_of_bounds', /^the video has no such frame$/);
      await expect('missing asset', await planned({ picks: [base, { assetId: 'ast_nope', frame: null, eyes }] }), 'not_found', /^a chosen picture is not in this project$/);
      await expect('too few', await planned({ picks: [base] }), 'invalid_request', /^at least two pictures are needed$/);
      await expect('bad params', await planned({ picks: [base, { assetId: video, frame: 3, eyes }], dissolve: 'sideways' }), 'invalid_request', /^the growing parameters are not valid: /);
      return fails(out);
    }),
    G17: () => guarded(async (e) => {
      const m = await main(e);
      const strip = (v: any) => { const { revision: _r, ...rest } = v; return JSON.stringify(rest); };
      const again = must(await e.owner(`/projects/${m.pid}/recipes/growing/plan`, { params: m.params }), 'plan again');
      const a = sha(strip(again)), b = sha(strip(must(await e.owner(`/projects/${m.pid}/recipes/growing/plan`, { params: m.params }), 'plan a third time')));
      if (a !== b) return `the plan digest differs between two runs (${a.slice(0, 12)} vs ${b.slice(0, 12)})`;
      // across engines: the same planner, the same document, params and context, in Node and in the editor's Chromium
      const doc = await getDoc(e, m.pid);
      const capture: Record<string, string | null> = {};
      for (const p of (m.params.picks as { assetId: string }[])) capture[p.assetId] = shownCapture(doc, p.assetId)?.wall ?? null;
      const ctx = { capture };
      const inNode = JSON.parse(JSON.stringify(planGrowing(doc, m.params, ctx))) as GrowingPlan;
      const code = await plannerBundle();
      const inBrowser = await withEditor(e, null, async (page) => {
        await page.setContent('<!doctype html><meta charset="utf-8"><title>planner</title>');
        await page.addScriptTag({ content: code });
        return await page.evaluate(([d, p, c]) => JSON.parse(JSON.stringify((globalThis as any).PFGrowing.planGrowing(d, p, c))), [doc, m.params, ctx] as const) as GrowingPlan;
      });
      const cmp = compareNumbers(inNode, inBrowser);
      // and the browser's transforms against the server's own answer of the apply (planned before the film existed: other frames, same transforms)
      let vsServer = 0;
      for (const sp of m.applied.picks) { const bp = inBrowser.picks.find((x) => x.key === sp.key); if (!bp) { vsServer = Infinity; break; } for (const k of ['x', 'y', 'scale', 'rotation'] as const) vsServer = Math.max(vsServer, Math.abs(bp.transform[k] - sp.transform[k])); }
      const engine = await withEditor(e, null, async (page) => page.evaluate(() => navigator.userAgent));
      console.log(`  G17: Node ${process.version} vs ${/HeadlessChrome\/[\d.]+|Chrome\/[\d.]+/.exec(engine)?.[0] ?? engine}: largest difference of any number of the plan ${cmp.max}${cmp.where ? ` (${cmp.where})` : ''}; browser transforms vs the server's applied transforms: largest ${vsServer}; digest ${a.slice(0, 12)} twice`);
      return fails([cmp.shape && `the two plans differ in shape at ${cmp.shape}`, cmp.max > GROWING.agreeWithin && `Node and Chromium differ by ${cmp.max} at ${cmp.where} (tolerance ${GROWING.agreeWithin})`, vsServer > GROWING.agreeWithin && `the browser's transforms differ from the server's by ${vsServer}`]);
    }),
  },
};

/** Stops the proof's server (the entry exits the process; a runner that does not can call this). */
export async function stopGrowingProofServer() { if (server) { const s = server; server = null; await s.close(); } }
