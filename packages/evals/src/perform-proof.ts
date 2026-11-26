/**
 * pnpm proof:perform — perform mode end to end (ADR-0025; .artifacts/stage-plan.md "PROOF (lead)" as corrected by its verifier,
 * and the lead's decisions in .artifacts/wave5-decisions.md), through the real server (REST, render_frame, export, flash check)
 * and the editor in headless Chromium, after `pnpm build`. Writes docs/evidence/perform-proof.json (every number with its
 * budget) and screenshots in .artifacts/perform/proof. Its own port: 8996.
 *
 * Checks (CPU unless said):
 *  Q1 quantise: 64 taps at beat ± U(−60, 60) ms (seeded, mulberry32) over a 120 BPM drum loop whose beats come from the real
 *     beat analysis: every chip lands on frameOfSeconds(beat), computed here from the analysed beats (followedBeats) and not by
 *     the planner's grid; repeated for half beat, ÷2 and ×2 (the midpoints and the kept parity are computed here). Both in the
 *     browser (window.__pfPerform.injectTaps, the view's planner) and on the server (POST /takes dryRun).
 *  F1 flash: one take alternating two colour pads (grey, invert) at 20 taps a second on a saturated red picture. Its export
 *     passes the export's flash check; the same taps with the flash rule switched off (each hit realised as an ordinary public
 *     add_adjustment, merging only same-pad overlaps as rule 3 does) fail it (control).
 *  F2 the same with the strobe pad («הבזק על הפעימה», follows the analysed music) alternating with the colour pads. light.strobe
 *     is a GPU effect: it runs under the software WebGPU adapter launch of proof:gpu (--enable-unsafe-webgpu, the render host's
 *     own GPU search) and is labelled so; without an adapter it is BLOCKED (exit 2), never a pass.
 *  B1 barcode: 8 punch taps on beats over the barcode fixture, through the editor (inject, accept). Exported frames are named
 *     by their position in the file (k = timeline frame k; the barcode is read back on unzoomed frames to show it): the first
 *     zoomed frame is the hit frame for all 8 and the frame before it is unzoomed. On lossless stills (render_frame PNG) the
 *     zoom measured from the strip's lower edge and from the box is 1.18 ± 0.02, and the frame before the hit and the frame
 *     after the release are byte-identical to the stills before the take.
 *  C1 camera: a sine pointer path on a UV-ramp card (16:9 in a 9:16 frame, the clip starting at frame 15, project background
 *     magenta): stills' centre pixel within 0.01 (in source units) of the dense spring path, the export within 0.03, no
 *     background pixel on 12 stills; a partial retake keeps the keys outside its range and every frame outside it.
 *  D1 determinism: SHA-256 of the canonical apply_take args equal across two server runs (POST /takes dryRun) and the browser.
 *  U1 undo: document hash after undo equals before the take; redo equals after; Store.replay (GET ?revision) equals the stored document.
 *  N1 nothing committed while playing: revision unchanged through a recorded take, +1 on accept, one history entry; the sound
 *     session (Player.origin, the AudioContext) is the same object before and after 50 injected taps while playing and pause()
 *     was not called; the live path (plan + apply in memory) for 200 hits under one frame period (33.3 ms) — PASS OR FAIL on
 *     the slowest of 10 runs after one warm-up.
 *  K1 keyboard take: wiring only — the tap the capture recorded for a real key press is within 30 ms of the audio clock read in
 *     a keydown handler of the same event. Latency: NOT CHECKED (no claim of sync is made anywhere). Shift+1…7 are ignored
 *     while recording (no tap, no mode change).
 *  P1 the preview equals the stills on the hit frames (ghost under review and the committed take);
 *  S1 sound hits (the impact pad, added to the library from the pad) start within one frame of their hit frames in the exported sound;
 *  A1 a keyboard-only take (Shift+7, R, digits, Space, Enter: one history entry); pads carry aria-pressed and aria-keyshortcuts;
 *     no unnamed control in the view; the full page audit is pnpm audit:a11y (states perform-*).
 * Exit codes: 0 every check passed; 1 a check failed; 2 nothing failed but a part is blocked (named, with its reason).
 *   pnpm build && pnpm proof:perform
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import {
  canonical, cameraLimits, defaultBank, DEFAULT_CAMERA, flashClassOf, flashGapFrames, followedBeats, MOVES, PERFORM_PLANNER_BUILT, planCamera, poseToClip,
  quantiseTaps, springPath, transformAt, type CameraGeometry, type CameraSample, type MoveSpec, type PadBank, type ProjectDocument, type Tap,
} from '@pulseframe/core';
import { BARCODE, generateBarcodeFixture, mulberry32, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';
import { resolvePadAssets } from '../../../apps/web/src/editor/perform/capture.ts';
import { PERFORM_TESTIDS as ID } from '../../../apps/web/src/editor/perform/perform.testids.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/perform/proof');
const OUT = path.join(root, 'docs/evidence/perform-proof.json');
const R = { num: 30, den: 1 };
const FPS = 30;
const W = 640, H = 360;
const f = (n: number) => T.frameTime(n, R);
type Status = 'pass' | 'fail' | 'blocked';
const checks: { id: string; name: string; status: Status; detail?: unknown }[] = [];
const check = (id: string, name: string, ok: boolean | 'blocked', detail?: unknown) => {
  const status: Status = ok === 'blocked' ? 'blocked' : ok ? 'pass' : 'fail';
  checks.push({ id, name, status, ...(detail !== undefined ? { detail } : {}) });
  console.log(`${status === 'pass' ? '  ok  ' : status === 'fail' ? ' FAIL ' : ' BLKD '} ${id} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
};
const measurements: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const sha = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
/** frameOfSeconds written out here (nearest frame of the absolute time, ties up), not imported from the planner. */
const frameOf = (s: number) => Math.floor(Number(s.toFixed(6)) * FPS + 0.5);
interface Img { w: number; h: number; rgb: Buffer }
const decodePng = (png: Buffer): Img => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
const lumaAt = (im: Img, x: number, y: number) => { const i = (y * im.w + x) * 3; return 0.299 * im.rgb[i]! + 0.587 * im.rgb[i + 1]! + 0.114 * im.rgb[i + 2]!; };

// ---------------------------------------------------------------- barcode-frame measures (independent of the engine)
/** The strip's lower edge (continuous y) in columns 90..110, where the barcode's top cells are dark: Σ dark coverage over rows 0..99. */
function stripEdge(im: Img): number {
  let sum = 0, n = 0;
  for (let x = 90; x <= 110; x++) {
    const bg = lumaAt(im, x, 120), dark = 16;
    if (bg - dark < 25) continue;
    let e = 0;
    for (let y = 0; y < 100; y++) e += Math.min(1, Math.max(0, (bg - lumaAt(im, x, y)) / (bg - dark)));
    sum += e; n++;
  }
  return n ? sum / n : NaN;
}
/** The white box's height in the column through its centre (zoom `z` about the frame centre), rows 100..330: Σ white coverage. */
function boxHeight(im: Img, index: number, z: number): number {
  const box = Math.round(H / 6), bx = Math.round((index * 9) % (W - box));
  const X = Math.round(W / 2 + (bx + box / 2 - W / 2) * z);
  if (X < 2 || X > W - 3) return NaN;
  let sum = 0, n = 0;
  for (let x = X - 2; x <= X + 2; x++) {
    const bg = lumaAt(im, x, 110);
    let e = 0;
    for (let y = 100; y < 330; y++) e += Math.min(1, Math.max(0, (lumaAt(im, x, y) - bg) / (235 - bg)));
    sum += e; n++;
  }
  return sum / n;
}

const blockedParts: { part: string; why: string }[] = [];
const blockAll = (why: string): never => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), result: 'BLOCKED', why }, null, 2) + '\n');
  console.error(`perform-proof: blocked: ${why}`);
  process.exit(2);
};

async function main() {
  if (!PERFORM_PLANNER_BUILT) blockAll('the perform planner is not built in this checkout (core PERFORM_PLANNER_BUILT is false)');
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) blockAll('web bundle missing: run `pnpm build` first');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });

  // ---- fixtures: the barcode picture (40 s), a 120 BPM drum loop (40 s), a red card, a UV-ramp card
  const SECONDS = 40;
  const barcode = path.join(art, 'barcode.mp4');
  await generateBarcodeFixture({ out: barcode, width: W, height: H, fps: R, frames: SECONDS * FPS });
  const loop = drumLoop(() => 120, SECONDS, 0.5, 9, 4);
  const rawLoop = path.join(art, 'loop.f32');
  fs.writeFileSync(rawLoop, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength));
  const music = path.join(art, 'music.wav');
  ff(['-y', '-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', rawLoop, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', music]);
  const red = path.join(art, 'red.png');
  ff(['-y', '-f', 'lavfi', '-i', `color=c=0xFF0000:s=${W}x${H}`, '-frames:v', '1', red]);
  const ramp = path.join(art, 'uv.png');
  // R = u (x / (w − 1)), G = v (y / (h − 1)), B = 0: the centre pixel names the source point; magenta (B high) is never the card
  ff(['-y', '-f', 'lavfi', '-i', 'color=c=black:s=1280x720', '-vf', "format=rgb24,geq=r='X/(W-1)*255':g='Y/(H-1)*255':b='0'", '-frames:v', '1', ramp]);

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as { assetId: string }).assetId;
  const getDoc = async (pid: string) => (await call(`/projects/${pid}`)).body as { project: ProjectDocument; revision: number };
  const history = async (pid: string) => ((await call(`/projects/${pid}/history?since=0`)).body.events as { ops: string[] }[]);
  const still = async (pid: string, k: number) => { const r = await call(`/projects/${pid}/frame?index=${k}`); if (r.status !== 200) throw new Error(`still ${k}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`); return r.body as Buffer; };
  const waitJob = async (id: string, ms = 900_000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; if (Date.now() - t0 > ms) throw new Error(`job ${id} did not finish`); await sleep(200); } };
  const exportOf = async (pid: string, name: string, body: Record<string, unknown> = {}) => {
    const st = await call(`/projects/${pid}/exports`, body);
    if (st.status !== 202) throw new Error(`export refused ${st.status}: ${JSON.stringify(st.body).slice(0, 300)}`);
    const job = await waitJob(st.body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error).slice(0, 400)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return { file, job };
  };
  const newProject = async (name: string, width = W, height = H) => (await call('/projects', { name, width, height })).body.project.id as string;
  const placeMusic = async (pid: string, until = SECONDS) => {
    const m = await upload(pid, music);
    await txs(pid, [{ op: 'add_clip', args: { assetId: m, start: f(0), duration: f(until * FPS) } }]);
    const a = await call(`/projects/${pid}/assets/${m}/analyze`, { kind: 'beats' });
    if (a.status !== 200) throw new Error(`beat analysis ${a.status}: ${JSON.stringify(a.body).slice(0, 200)}`);
    return m;
  };
  const takeReq = (taps: Tap[], bank: PadBank, assets: (string | null)[], settings: Record<string, unknown>, gpu = false, dryRun = false, expectedRevision?: number) =>
    ({ taps, bank: [...bank], assets, settings: { snap: 'beat', tempo: 'normal', strength: 1, parity: 0, ...settings }, gpu, ...(dryRun ? { dryRun: true } : {}), ...(expectedRevision !== undefined ? { expectedRevision } : {}) });

  // the adapter question first (it decides whether F2 can run here at all)
  let adapter = false;
  {
    const b = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
    const p = await b.newPage();
    await p.goto(`${s.url}/gpu.html`).catch(() => {});
    adapter = await p.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter())).catch(() => false);
    await b.close();
  }
  measurements.webgpuAdapter = adapter ? 'present (on this Linux container it is a software adapter, as in proof:gpu)' : 'none';

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ================================================================ the main project: barcode picture + 120 BPM music
    const pid = await newProject('perform-main');
    const pic = await upload(pid, barcode);
    await txs(pid, [{ op: 'add_clip', args: { assetId: pic, start: f(0), withLinkedAudio: false } }]);
    await placeMusic(pid);
    let d0 = (await getDoc(pid)).project;
    const beats = followedBeats(d0, 0, SECONDS - 1e-9);
    const truth = loop.beats;
    const beatErr = beats.length ? Math.max(...beats.slice(0, Math.min(beats.length, truth.length)).map((b) => Math.min(...truth.map((t) => Math.abs(t - b.t))))) : NaN;
    measurements.beatAnalysis = { analysedBeats: beats.length, generatedBeats: truth.length, bpm: d0.analyses?.[Object.keys(d0.analyses ?? {})[0]!]?.beats?.bpm ?? null, worstDistanceToAGeneratedBeatSeconds: +beatErr.toFixed(4) };
    if (beats.length < 70) throw new Error(`the beat analysis found ${beats.length} beats in 40 s of a 120 BPM loop`);

    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    await ctx.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
    await ctx.addInitScript(() => { (globalThis as any).__pfPerformProof = true; (globalThis as any).__pfAudioTap = true; try { localStorage.setItem('pf.lang', 'he'); localStorage.removeItem('pf.perform.v1'); } catch { /* storage unavailable */ } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('project-name').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !!(window as any).__pfPlayer, undefined, { timeout: 30000 });
    // A1 (part): the mode is entered from the keyboard
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Shift+Digit7');
    const entered = await page.getByTestId(ID.view).waitFor({ timeout: 10000 }).then(() => true, () => false);
    await page.waitForFunction(() => !!(window as any).__pfPerform, undefined, { timeout: 10000 });
    const pstate = () => page.evaluate(() => (window as any).__pfPerform.state()) as Promise<{ phase: string; taps: Tap[]; chips: any[]; args: any; grid: number }>;
    const inject = (taps: Tap[]) => page.evaluate((t) => (window as any).__pfPerform.injectTaps(t), taps) as Promise<number>;
    const discard = async () => { if ((await pstate()).phase !== 'idle') { await page.getByTestId(ID.discard).click(); await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'idle'); } };
    const seg = async (tid: string, i: number) => { await page.locator(`[data-testid=${tid}] .pf-seg-btn`).nth(i).click(); };
    const bankC = defaultBank('canvas');
    const assets0 = resolvePadAssets(d0, bankC);

    // ================================================================ Q1 quantise
    const rnd = mulberry32(25);
    const jitter = () => (rnd() * 2 - 1) * 0.06;
    const rows: Record<string, unknown> = {};
    const q1case = async (name: string, targets: number[], settings: { snap: 'beat' | 'half'; tempo: 'half' | 'normal' | 'double' }, segs: [number, number]) => {
      await discard();
      await seg(ID.snap, settings.snap === 'beat' ? 1 : 2);
      await seg(ID.tempo, settings.tempo === 'half' ? 0 : settings.tempo === 'normal' ? 1 : 2);
      void segs;
      const taps: Tap[] = targets.map((t) => { const down = Math.max(0, t + jitter()); return { pad: 0, down, up: down + 0.05 }; });
      await inject(taps);
      await page.waitForFunction((n) => (window as any).__pfPerform.state().chips.length === n, taps.length, { timeout: 20000 });
      const st = await pstate();
      const want = targets.map(frameOf);
      const browserFrames = taps.map((_, i) => st.chips.find((c) => c.tap === i)?.frame ?? null);
      const server = await call(`/projects/${pid}/takes`, takeReq(taps, bankC, assets0, settings, false, true));
      const serverFrames = taps.map((_, i) => (server.body.chips as any[] | undefined)?.find((c) => c.tap === i)?.frame ?? null);
      const okB = browserFrames.filter((x, i) => x === want[i]).length, okS = serverFrames.filter((x, i) => x === want[i]).length;
      rows[name] = { taps: taps.length, browserOnTarget: okB, serverOnTarget: okS, misses: want.flatMap((w, i) => (browserFrames[i] !== w || serverFrames[i] !== w ? [{ tap: i, want: w, browser: browserFrames[i], server: serverFrames[i] }] : [])).slice(0, 6) };
      check('Q1', `quantise (${name}): ${taps.length} taps at the target ± U(−60, 60) ms land on frameOfSeconds(target), in the browser view and on the server`, server.status === 200 && okB === taps.length && okS === taps.length, rows[name]);
      return taps;
    };
    const bt = beats.map((b) => b.t).filter((t) => t >= 1 && t <= 34);
    const q1beat = bt.slice(0, 64);
    await q1case('nearest beat, ×1', q1beat, { snap: 'beat', tempo: 'normal' }, [1, 1]);
    // half beat: the midpoints between neighbouring analysed beats (the beats are 0.5 s apart, so all neighbours qualify)
    const mids: number[] = [];
    for (let i = 0; i + 1 < beats.length; i++) mids.push((beats[i]!.t + beats[i + 1]!.t) / 2);
    await q1case('half beat, ×1', mids.filter((t) => t >= 1 && t <= 34).slice(0, 64), { snap: 'half', tempo: 'normal' }, [2, 1]);
    // ÷2: every other beat by the running index (parity 0 keeps the even ones)
    await q1case('nearest beat, ÷2', beats.filter((b) => b.index % 2 === 0 && b.t >= 1).map((b) => b.t).slice(0, 32), { snap: 'beat', tempo: 'half' }, [1, 0]);
    // ×2: the beats and the midpoints
    await q1case('nearest beat, ×2', mids.filter((t) => t >= 1 && t <= 20).slice(0, 32).concat(bt.slice(0, 32)).sort((a, b) => a - b), { snap: 'beat', tempo: 'double' }, [1, 2]);
    await discard();
    await seg(ID.snap, 1); await seg(ID.tempo, 1);
    measurements.q1 = rows;

    // ================================================================ B1 / D1 / P1 / U1: 8 punch taps on beats, through the editor
    const hitBeats = bt.filter((t) => t > 2).filter((_, i) => i % 3 === 0).slice(0, 8);
    const b1taps: Tap[] = hitBeats.map((t) => { const down = t + jitter(); return { pad: 0, down, up: down + 0.2 }; });
    const hitFrames = hitBeats.map(frameOf);
    // the punch (move.punch): scale 1.18; release 0.12 s = 4 frames; a 0.2 s tap = 6 frames (the end snaps only when held ≥ 0.75 beat)
    const punch = MOVES.find((m) => m.id === 'move.punch') as Extract<MoveSpec, { kind: 'punch' }>;
    const pre: Record<number, Buffer> = {};
    for (const a of hitFrames) for (const k of [a - 1, a, a + 6]) pre[k] = await still(pid, k);
    await inject(b1taps);
    await page.waitForFunction((n) => (window as any).__pfPerform.state().chips.length === n, b1taps.length, { timeout: 20000 });
    const stB = await pstate();
    const chipEnds = stB.chips.map((c) => ({ frame: c.frame, frames: c.frames, state: c.state }));
    check('B1', 'the 8 punch taps are kept on their beat frames', stB.chips.length === 8 && stB.chips.every((c) => c.state === 'kept' && c.frame === hitFrames[c.tap] && c.frames === 6), { hitFrames, chips: chipEnds });
    // D1: the browser's args against two server dry runs
    const dry1 = await call(`/projects/${pid}/takes`, takeReq(b1taps, bankC, assets0, {}, false, true));
    const dry2 = await call(`/projects/${pid}/takes`, takeReq(b1taps, bankC, assets0, {}, false, true));
    const hashes = { browser: stB.args ? sha(stB.args) : null, server1: dry1.body.args ? sha(dry1.body.args) : null, server2: dry2.body.args ? sha(dry2.body.args) : null };
    check('D1', 'SHA-256 of the canonical apply_take args: equal across two server dry runs and the browser view', !!hashes.browser && hashes.browser === hashes.server1 && hashes.server1 === hashes.server2, hashes);
    // P1 (ghost): the preview of the take under review, on the hit frames
    const previewAt = async (k: number) => {
      await page.evaluate((x) => (window as any).__pfPlayer.seek(x), k);
      await page.waitForFunction((x) => (window as any).__pfPlayer.painted === x && (document.querySelector('[data-testid=preview]') as HTMLElement | null)?.dataset.quality === 'full', k, { timeout: 15000 }).catch(() => {});
      await sleep(60);
      return page.evaluate(() => { const c = document.querySelector('canvas[data-testid=preview]') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; const out: number[] = []; for (let i = 0; i < d.length; i += 4) out.push(d[i]!, d[i + 1]!, d[i + 2]!); return { w: c.width, h: c.height, rgb: out }; });
    };
    const ghostPx: Record<number, { w: number; h: number; rgb: number[] }> = {};
    for (const a of hitFrames.slice(0, 4)) ghostPx[a] = await previewAt(a);
    await page.screenshot({ path: path.join(art, 'review-he.png') });
    // U1: hashes around the take
    const before = await getDoc(pid);
    const hBefore = sha(before.project);
    const hist0 = (await history(pid)).length;
    await page.getByTestId(ID.accept).click();
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'idle', undefined, { timeout: 30000 });
    const after = await getDoc(pid);
    const hAfter = sha(after.project);
    const hist1 = await history(pid);
    check('N1', 'accept: the revision moves by exactly 1 and there is exactly one new history entry, an apply_take', after.revision === before.revision + 1 && hist1.length === hist0 + 1 && hist1.at(-1)!.ops.join() === 'apply_take', { revisions: after.revision - before.revision, newEntries: hist1.length - hist0, ops: hist1.at(-1)?.ops });
    const replayed = await call(`/projects/${pid}?revision=${after.revision}`);
    // undo and redo as the owner does it, in the editor (an agent's credential may only reverse the agent's own transactions)
    const waitRev = async (n: number) => { for (const t0 = Date.now(); Date.now() - t0 < 20000; await sleep(100)) if ((await getDoc(pid)).revision === n) return true; return false; };
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Control+z');
    const undid = await waitRev(after.revision + 1);
    const hUndone = sha((await getDoc(pid)).project);
    await page.keyboard.press('Control+Shift+z');
    const redid = await waitRev(after.revision + 2);
    const hRedone = sha((await getDoc(pid)).project);
    check('U1', 'undo (Ctrl+Z in the editor): the document hash equals the one before the take; redo (Ctrl+Shift+Z) equals the one after; Store.replay of that revision equals the stored document', undid && redid && hUndone === hBefore && hRedone === hAfter && replayed.status === 200 && sha(replayed.body.project) === hAfter, { before: hBefore.slice(0, 16), after: hAfter.slice(0, 16), undone: hUndone.slice(0, 16), redone: hRedone.slice(0, 16), replay: replayed.status === 200 ? sha(replayed.body.project).slice(0, 16) : replayed.status });
    await sleep(800); // the editor reloads on the revision events

    // B1 on lossless stills
    const b1rows: unknown[] = [];
    let b1ok = true, b1ident = true;
    for (const a of hitFrames) {
      const s0 = decodePng(pre[a]!), s1 = decodePng(await still(pid, a)), s1b = decodePng(await still(pid, a + 1));
      const e0 = stripEdge(s0), e1 = stripEdge(s1), e1b = stripEdge(s1b);
      const zEdge = (H / 2 - e1) / (H / 2 - e0), zEdgeB = (H / 2 - e1b) / (H / 2 - e0);
      const h0 = boxHeight(s0, a, 1), h1 = boxHeight(s1, a, punch.scale);
      const zBox = h1 / h0;
      const beforeSame = Buffer.compare(await still(pid, a - 1), pre[a - 1]!) === 0;
      const afterSame = Buffer.compare(await still(pid, a + 6), pre[a + 6]!) === 0;
      const ok = Math.abs(zEdge - punch.scale) <= 0.02 && Math.abs(zEdgeB - punch.scale) <= 0.02 && Number.isFinite(zBox) && Math.abs(zBox - punch.scale) <= 0.02;
      b1ok &&= ok; b1ident &&= beforeSame && afterSame;
      b1rows.push({ hit: a, edgeBefore: +e0.toFixed(3), zoomFromEdge: +zEdge.toFixed(4), zoomFromEdgeNextFrame: +zEdgeB.toFixed(4), zoomFromBox: Number.isFinite(zBox) ? +zBox.toFixed(4) : null, frameBeforeIdentical: beforeSame, frameAfterReleaseIdentical: afterSame });
    }
    measurements.b1Stills = b1rows;
    check('B1', 'lossless stills: the zoom measured from the strip\'s lower edge and from the box is 1.18 ± 0.02 on every hit frame (and the next)', b1ok, b1rows);
    check('B1', 'lossless stills: the frame before each hit and the frame after its release are byte-identical to the stills before the take', b1ident, b1rows.map((r: any) => ({ hit: r.hit, before: r.frameBeforeIdentical, after: r.frameAfterReleaseIdentical })));
    // P1: the preview equals the stills on the hit frames (the ghost under review and the committed take)
    const p1: unknown[] = [];
    let p1ok = true;
    const diffStat = (a: { w: number; h: number; rgb: number[] | Buffer }, b: Img) => { if (a.w !== b.w || a.h !== b.h) return { max: Infinity, mean: Infinity }; let m = 0, sum = 0; for (let i = 0; i < b.rgb.length; i++) { const dlt = Math.abs((a.rgb[i] as number) - b.rgb[i]!); sum += dlt; if (dlt > m) m = dlt; } return { max: m, mean: +(sum / b.rgb.length).toFixed(4) }; };
    for (const a of hitFrames.slice(0, 4)) {
      const st = decodePng(await still(pid, a));
      const now = await previewAt(a);
      const g = diffStat(ghostPx[a]!, st), c = diffStat(now, st);
      const ok = g.max === 0 && c.max === 0;
      p1ok &&= ok;
      p1.push({ frame: a, ghostVsStill: g, committedPreviewVsStill: c, canvas: `${now.w}x${now.h}` });
    }
    measurements.p1 = p1;
    check('P1', 'the preview canvas equals the render_frame still pixel for pixel on 4 hit frames, for the ghost under review and for the committed take', p1ok, p1);
    await page.evaluate(() => (window as any).__pfPlayer.seek(0));

    // B1 on the export: frames by their position in the file
    const ex = await exportOf(pid, 'b1.mp4', { range: { startFrame: 0, endFrame: Math.max(...hitFrames) + 30 } });
    const exRaw = ff(['-i', ex.file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = W * H * 3, exFrames = exRaw.length / fb;
    const exImg = (k: number): Img => ({ w: W, h: H, rgb: exRaw.subarray(k * fb, (k + 1) * fb) });
    const e0x = stripEdge(exImg(Math.max(0, hitFrames[0]! - 3)));
    const zoomOf = (k: number) => (H / 2 - stripEdge(exImg(k))) / (H / 2 - e0x);
    const exRows = hitFrames.map((a) => ({ hit: a, zoomBefore: +zoomOf(a - 1).toFixed(3), zoomAtHit: +zoomOf(a).toFixed(3), barcodeBefore: readBarcode(exImg(a - 1).rgb, W, 3, { x: 0, y: 0, w: W, h: H }) }));
    const exOk = exFrames > Math.max(...hitFrames) && exRows.every((r) => r.zoomBefore < 1.05 && r.zoomAtHit > 1.12 && r.barcodeBefore === r.hit - 1);
    measurements.b1Export = { frames: exFrames, rows: exRows, threshold: 'unzoomed < 1.05, zoomed > 1.12 (strip-edge zoom; the export is lossy, the 1.18 ± 0.02 measure is on the stills)' };
    check('B1', 'export: for all 8 hits the first zoomed frame (by position in the file) is the hit frame and the frame before is unzoomed; the barcode read on that frame names its own position', exOk, exRows);
    void BARCODE;

    // ================================================================ N1 / K1: a recorded take, the music playing
    await page.evaluate(() => { const w = window as any, p = w.__pfPlayer, orig = p.pause.bind(p); w.__pauses = 0; p.pause = () => { w.__pauses++; return orig(); }; });
    const revRec0 = (await getDoc(pid)).revision, histRec0 = (await history(pid)).length;
    await page.evaluate(() => (window as any).__pfPlayer.seek(30));
    await page.getByTestId(ID.record).click();
    await page.waitForFunction(() => (window as any).__pfPlayer.playing && (window as any).__pfPerform.state().phase === 'recording', undefined, { timeout: 15000 });
    await sleep(400);
    const sess0 = await page.evaluate(() => { const w = window as any, p = w.__pfPlayer; w.__origin0 = p.origin; w.__actx0 = p.actx; w.__pauses = 0; return { clock: p.clock, painted: p.painted }; });
    // 50 injected taps while playing (the canvas pads, sound pad excluded from the live picture by construction)
    const live50: Tap[] = Array.from({ length: 50 }, (_, i) => ({ pad: [0, 1, 2, 3, 5][i % 5]!, down: 1.2 + i * 0.13, up: 1.3 + i * 0.13 }));
    await page.evaluate((t) => (window as any).__pfPerform.injectTaps(t), live50);
    await sleep(700);
    const sess1 = await page.evaluate(() => { const w = window as any, p = w.__pfPlayer; return { sameOrigin: p.origin === w.__origin0, sameContext: p.actx === w.__actx0, pauses: w.__pauses as number, playing: p.playing as boolean }; });
    const revDuring = (await getDoc(pid)).revision;
    check('N1', 'while playing: the sound session (Player.origin and the AudioContext) is the same object before and after 50 injected taps, pause() was not called, and the revision did not move', sess1.sameOrigin && sess1.sameContext && sess1.pauses === 0 && sess1.playing && revDuring === revRec0, { ...sess1, clock: sess0.clock, revisionMoved: revDuring - revRec0 });
    // K1: real key presses; the clock read in a keydown handler of the same event
    await page.evaluate(() => { const w = window as any; w.__keyReads = []; window.addEventListener('keydown', (e) => { if (/^Digit[1-8]$/.test(e.code) && !e.shiftKey) w.__keyReads.push({ code: e.code, clock: w.__pfPlayer.timelineSecondsAt(performance.now()), stamp: e.timeStamp }); }, true); });
    const tapsBeforeKeys = (await pstate()).taps.length;
    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit6']) { await page.keyboard.down(code); await sleep(90); await page.keyboard.up(code); await sleep(160); }
    // Shift+1…7 while recording: ignored (no tap, no mode change)
    for (let i = 1; i <= 7; i++) await page.keyboard.press(`Shift+Digit${i}`);
    await sleep(150);
    const recState = await pstate();
    const reads = (await page.evaluate(() => (window as any).__keyReads)) as { code: string; clock: number | null }[];
    const keyTaps = recState.taps.slice(tapsBeforeKeys);
    const k1 = keyTaps.map((t, i) => ({ pad: t.pad, down: +t.down.toFixed(4), clock: reads[i]?.clock ?? null, diffMs: reads[i]?.clock != null ? +((t.down - reads[i]!.clock!) * 1000).toFixed(2) : null }));
    const stillPerform = await page.getByTestId(ID.view).count() === 1 && (await page.locator('[data-testid=workspace-perform][aria-checked=true]').count()) === 1;
    check('K1', 'keyboard take (WIRING ONLY, not latency): each of 5 real key presses made one tap on its pad, within 30 ms of the audio clock read in a keydown handler of the same event (calibration offset 0: not calibrated)', keyTaps.length === 5 && keyTaps.map((t) => t.pad).join() === '0,1,2,3,5' && k1.every((r) => r.diffMs !== null && Math.abs(r.diffMs) <= 30), { clock: sess0.clock, rows: k1 });
    check('K1', 'Shift+1…7 while recording: no tap and no change of mode (the take is still recording in perform)', recState.taps.length === tapsBeforeKeys + 5 && recState.phase === 'recording' && stillPerform, { taps: recState.taps.length - tapsBeforeKeys, phase: recState.phase, stillPerform });
    measurements.latency = 'not checked: key-to-picture and key-to-sound latency are not measured here (headless, no audio device; the owner\'s tap calibration on the laptop is still open)';
    // N1: the live path's cost for 200 hits (plan + apply in memory, as the view does once per animation frame)
    const t200: Tap[] = Array.from({ length: 200 }, (_, i) => ({ pad: [0, 1, 2, 3, 4, 5][i % 6]!, down: 1 + i * 0.16, up: 1.05 + i * 0.16 }));
    const times = (await page.evaluate((t) => (window as any).__pfPerform.timeLive(t, 11), t200)) as number[];
    const timed = times.slice(1);
    const slowest = Math.max(...timed);
    measurements.n1LivePath = { hits: 200, runsMs: timed.map((x) => +x.toFixed(2)), warmupMs: +times[0]!.toFixed(2), slowestMs: +slowest.toFixed(2), budgetMs: +(1000 / FPS).toFixed(2), machine: `${os.cpus()[0]?.model} ×${os.cpus().length}`, note: 'one sample of this machine, under whatever else ran on it; not a general claim' };
    check('N1', 'the live path (raw taps planned and applied in memory) for 200 hits takes under one frame period (33.3 ms) on the slowest of 10 runs after a warm-up', timed.length === 10 && slowest < 1000 / FPS, measurements.n1LivePath);
    // stop with Space, accept with Enter: +1, one entry
    await page.keyboard.press('Space');
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'review', undefined, { timeout: 15000 });
    const revReview = (await getDoc(pid)).revision;
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'idle', undefined, { timeout: 30000 });
    const revRec1 = (await getDoc(pid)).revision, histRec1 = await history(pid);
    check('N1', 'a recorded take: the revision is unchanged through recording and review, +1 on accept, exactly one new history entry', revReview === revRec0 && revRec1 === revRec0 + 1 && histRec1.length === histRec0 + 1 && histRec1.at(-1)!.ops.join() === 'apply_take', { duringReview: revReview - revRec0, onAccept: revRec1 - revRec0, newEntries: histRec1.length - histRec0 });

    // ================================================================ A1: a keyboard-only take and the view's names
    await sleep(500);
    const histA0 = (await history(pid)).length;
    await page.evaluate(() => (window as any).__pfPlayer.seek(400));
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('KeyR');
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'recording' && (window as any).__pfPlayer.playing, undefined, { timeout: 15000 });
    await sleep(300);
    for (const code of ['Digit2', 'Digit4']) { await page.keyboard.press(code); await sleep(500); }
    await page.keyboard.press('Space');
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'review', undefined, { timeout: 15000 });
    const aState = await pstate();
    const names = await page.getByTestId(ID.view).evaluate((root) => {
      const unnamed = [...root.querySelectorAll('button, input, select, [role=slider], [role=switch], [role=radio], [role=tab]')].filter((e) => !(e.getAttribute('aria-label') || (e.textContent ?? '').trim() || (e as HTMLInputElement).labels?.length || e.getAttribute('aria-labelledby'))).map((e) => e.outerHTML.slice(0, 100));
      const pads = [...root.querySelectorAll('[data-testid=perform-pad]')].map((e) => ({ pressed: e.getAttribute('aria-pressed'), keys: e.getAttribute('aria-keyshortcuts'), name: e.getAttribute('aria-label') }));
      const text = (root as HTMLElement).innerText;
      return { unnamed, pads, inSyncWords: /in sync|מסונכרנ/i.test(text), live: root.querySelector('[data-testid=perform-live]')?.textContent ?? '' };
    });
    await page.screenshot({ path: path.join(art, 'keyboard-take-review-he.png') });
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as any).__pfPerform.state().phase === 'idle', undefined, { timeout: 30000 });
    const histA1 = await history(pid);
    check('A1', 'a keyboard-only take (Shift+7 entered the mode; R, 2, 4, Space, Enter): two taps on pads 2 and 4, exactly one new history entry', entered && aState.taps.length === 2 && aState.taps.map((t) => t.pad).join() === '1,3' && histA1.length === histA0 + 1, { entered, taps: aState.taps.map((t) => t.pad), newEntries: histA1.length - histA0 });
    check('A1', 'the view: every control has a name; the 8 pads carry aria-pressed and aria-keyshortcuts 1…8; the live region spoke; no text calls a take in sync', names.unnamed.length === 0 && names.pads.length === 8 && names.pads.every((p, i) => p.pressed !== null && p.keys === String(i + 1) && !!p.name) && !names.inSyncWords && names.live.trim().length > 0, names);
    check('run', 'no page errors during the editor run', errors.length === 0, errors.slice(0, 4));
    await ctx.close();

    // ================================================================ S1: sound hits in the exported sound
    {
      const sp = await newProject('perform-sound');
      const sPic = await upload(sp, barcode);
      await txs(sp, [{ op: 'add_clip', args: { assetId: sPic, start: f(0), duration: f(240), withLinkedAudio: false } }]);
      const sctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
      await sctx.addInitScript('globalThis.__name = (f) => f');
      await sctx.addInitScript(() => { (globalThis as any).__pfPerformProof = true; (globalThis as any).__pfAudioTap = true; try { localStorage.setItem('pf.lang', 'en'); localStorage.setItem('pf.workspace.v1', 'perform'); localStorage.removeItem('pf.perform.v1'); } catch { /* storage unavailable */ } });
      const sPage = await sctx.newPage();
      await sPage.goto(`${s.ownerUrl}&project=${sp}`);
      await sPage.getByTestId(ID.view).waitFor({ timeout: 30000 });
      await sPage.waitForFunction(() => !!(window as any).__pfPerform, undefined, { timeout: 10000 });
      const soundPad = bankC.findIndex((m) => m?.kind === 'sound');
      // snap off: there is no music; the pad is added to the library from the pad itself (an ordinary import, before any take)
      await sPage.locator(`[data-testid=${ID.snap}] .pf-seg-btn`).nth(0).click();
      const histS0 = (await history(sp)).length;
      await sPage.locator(`[data-testid=${ID.padAddToLibrary}][data-pad="${soundPad}"]`).click();
      await sPage.waitForFunction((i) => document.querySelector(`[data-testid=perform-pad][data-pad="${i}"]`)?.getAttribute('data-state') === 'ready', soundPad, { timeout: 30000 });
      const histS1 = (await history(sp)).length;
      const times = [1.0, 2.37, 3.71, 5.05, 6.6];
      await sPage.evaluate((t) => (window as any).__pfPerform.injectTaps(t), times.map((t) => ({ pad: soundPad, down: t, up: t + 0.05 })));
      await sPage.waitForFunction((n) => (window as any).__pfPerform.state().chips.length === n, times.length, { timeout: 20000 });
      const sChips = (await sPage.evaluate(() => (window as any).__pfPerform.state().chips)) as any[];
      await sPage.getByTestId(ID.accept).click();
      await sPage.waitForFunction(() => (window as any).__pfPerform.state().phase === 'idle', undefined, { timeout: 30000 });
      await sctx.close();
      const wav = await exportOf(sp, 's1.wav', { format: 'wav' });
      const pcm = ff(['-i', wav.file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
      const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 4);
      const onset = (t: number) => { for (let i = Math.max(0, Math.floor((t - 0.1) * 48000)); i < Math.min(x.length, (t + 0.2) * 48000); i++) if (Math.abs(x[i]!) > 0.02) return i / 48000; return null; };
      const sRows = sChips.map((c) => { const at = c.frame / FPS, o = onset(at); return { hitFrame: c.frame, state: c.state, onsetSeconds: o === null ? null : +o.toFixed(4), offsetMs: o === null ? null : +((o - at) * 1000).toFixed(2) }; });
      const silentBefore = (() => { let m = 0; for (let i = 0; i < 0.9 * 48000; i++) m = Math.max(m, Math.abs(x[i]!)); return m; })();
      check('S1', 'the impact pad is added to the library from the pad (one ordinary import entry, before any take); its 5 hits start within one frame (33.3 ms) of their hit frames in the exported sound', histS1 === histS0 + 1 && sRows.length === 5 && sRows.every((r) => r.state === 'kept' && r.offsetMs !== null && r.offsetMs >= -1000 / FPS && r.offsetMs <= 1000 / FPS) && silentBefore < 0.02, { importEntries: histS1 - histS0, rows: sRows, peakBeforeFirstHit: +silentBefore.toFixed(4) });
    }

    // ================================================================ F1 / F2: flash, with the rule and with it switched off
    const grey: MoveSpec = { id: 'move.proof-grey', kind: 'adjust', minSeconds: 0.05, effects: [{ type: 'color.grayscale', params: { amount: 1 } }], fadeOutSeconds: 0 };
    const invert: MoveSpec = { id: 'move.proof-invert', kind: 'adjust', minSeconds: 0.05, effects: [{ type: 'color.invert', params: { amount: 1 } }], fadeOutSeconds: 0 };
    const strobe = MOVES.find((m) => m.id === 'move.beat-strobe')!;
    const precondition = flashClassOf([{ type: 'color.grayscale' }]) === 'colour' && flashClassOf([{ type: 'color.invert' }]) === 'colour' && flashClassOf([{ type: 'light.strobe' }]) === 'light';
    const flashCase = async (id: 'F1' | 'F2', label: string, bank: PadBank, taps: Tap[], gpu: boolean, withMusic: boolean) => {
      const mk = async (name: string) => {
        const p = await newProject(name);
        const card = await upload(p, red);
        await txs(p, [{ op: 'add_clip', args: { assetId: card, start: f(0), duration: f(180) } }]);
        if (withMusic) await placeMusic(p, 6);
        return p;
      };
      const on = await mk(`${id}-rule-on`);
      const settings = { snap: 'off', strength: 0 } as const;
      const take = await call(`/projects/${on}/takes`, takeReq(taps, bank, Array(8).fill(null), settings, gpu));
      const chips = (take.body.chips ?? []) as any[];
      const kept = chips.filter((c) => c.state === 'kept').map((c) => ({ pad: c.pad, frame: c.frame, frames: c.frames }));
      const held = chips.filter((c) => c.state === 'held').length;
      const exOn = take.status === 200 ? await exportOf(on, `${id}-on.mp4`) : null;
      // the control: the same taps realised with the flash rule switched off (no gap, no light ranges, no minimum length)
      const off = await mk(`${id}-rule-off`);
      const dOff = (await getDoc(off)).project;
      const hits = quantiseTaps(taps, [], { snap: 'off', tempo: 'normal', strength: 0, parity: 0 }, dOff.settings.frameRate, bank);
      const merged: { pad: number; a: number; b: number }[] = [];
      const last = new Map<number, { pad: number; a: number; b: number }>();
      for (const hh of hits) {
        const p = last.get(hh.pad);
        if (p && hh.frame <= p.b) { p.b = Math.max(p.b, hh.frame + hh.frames); continue; }
        const e = { pad: hh.pad, a: hh.frame, b: hh.frame + hh.frames };
        merged.push(e); last.set(hh.pad, e);
      }
      const ops = merged.map((m) => { const spec = bank[m.pad] as Extract<MoveSpec, { kind: 'adjust' }>; return { op: 'add_adjustment', args: { span: { start: f(m.a), duration: f(Math.min(m.b, 180) - m.a) }, effects: spec.effects.map((e) => ({ type: e.type, ...(e.params ? { params: e.params } : {}) })) } }; });
      for (let i = 0; i < ops.length; i += 150) await txs(off, ops.slice(i, i + 150));
      const exOff = await exportOf(off, `${id}-off.mp4`);
      const vOn = exOn?.job.output?.photosensitivity, vOff = exOff.job.output?.photosensitivity;
      const detail = { label, takeStatus: take.status, taps: taps.length, kept: kept.length, held, keptStarts: kept.map((k) => k.frame), ruleOn: vOn ? { verdict: vOn.verdict, ranges: vOn.ranges.length } : null, ruleOff: vOff ? { verdict: vOff.verdict, ranges: vOff.ranges.length, adjustments: ops.length } : null };
      measurements[id] = detail;
      check(id, `${label}: the take's export passes the export's flash check, and the same taps with the flash rule switched off fail it (control)`, precondition && take.status === 200 && kept.length > 0 && vOn?.verdict === 'pass' && vOff?.verdict === 'fail', detail);
    };
    const f1taps: Tap[] = Array.from({ length: 60 }, (_, i) => ({ pad: i % 2, down: 1 + i * 0.05, up: 1.03 + i * 0.05 }));
    await flashCase('F1', 'two colour pads (grey, invert) alternating at 20 taps a second on a saturated red card', [grey, invert, null, null, null, null, null, null], f1taps, false, false);
    if (!adapter) {
      blockedParts.push({ part: 'F2', why: 'no WebGPU adapter in this browser even with --enable-unsafe-webgpu (the strobe pad is a GPU effect); see pnpm probe:gpu' });
      check('F2', 'the strobe pad alternating with two colour pads (needs a WebGPU adapter)', 'blocked', blockedParts.at(-1));
    } else {
      const f2taps: Tap[] = Array.from({ length: 60 }, (_, i) => ({ pad: i % 3, down: 1 + i * 0.05, up: 1.03 + i * 0.05 }));
      await flashCase('F2', 'the strobe pad («הבזק על הפעימה», follows the analysed 120 BPM music) alternating with two colour pads at 20 taps a second — on the SOFTWARE WebGPU adapter launch of proof:gpu', [strobe, grey, invert, null, null, null, null, null], f2taps, true, true);
    }

    // ================================================================ C1: the virtual camera
    {
      const cp = await newProject('perform-camera', 360, 640);
      await txs(cp, [{ op: 'set_project_format', args: { background: '#FF00FF' } }]);
      const card = await upload(cp, ramp);
      const clipId = (await txs(cp, [{ op: 'add_clip', args: { assetId: card, start: f(15), duration: f(120) } }])).results[0].output.clipId as string;
      const cd = (await getDoc(cp)).project;
      const g: CameraGeometry = { frameW: 360, frameH: 640, srcW: 1280, srcH: 720, fit: cd.settings.fit ?? 'contain' };
      const lim = cameraLimits(g);
      // a sine pointer path, in timeline frames (the contract's basis), over the whole clip
      const sine = (k: number): CameraSample => ({ frame: 15 + k, u: 0.5 + 0.28 * Math.sin((2 * Math.PI * k) / 90), v: 0.5 + 0.12 * Math.sin((2 * Math.PI * k) / 60), zoom: 1.25 + 0.2 * Math.sin((2 * Math.PI * k) / 120) });
      const samples = Array.from({ length: 120 }, (_, k) => sine(k));
      const plan = planCamera(cd, { clipId, from: 0, to: 119, samples, settings: DEFAULT_CAMERA });
      if ('refused' in plan) throw new Error(`planCamera refused: ${plan.refused}`);
      const dense = springPath(samples, 15, 134, g, DEFAULT_CAMERA, FPS);
      await txs(cp, plan.ops);
      const frames12 = Array.from({ length: 12 }, (_, i) => 15 + Math.round((i * 119) / 11));
      const cRows: unknown[] = [];
      let stillOk = true, noBg = true;
      for (const k of frames12) {
        const im = decodePng(await still(cp, k));
        const i0 = ((im.h / 2) * im.w + im.w / 2) * 3;
        const u = im.rgb[i0]! / 255, v = im.rgb[i0 + 1]! / 255, P = dense[k - 15]!;
        let bg = 0;
        for (let i = 0; i < im.rgb.length; i += 3) if (im.rgb[i + 2]! > 100) bg++;
        const err = Math.max(Math.abs(u - P.u), Math.abs(v - P.v));
        stillOk &&= err <= 0.01; noBg &&= bg === 0;
        cRows.push({ frame: k, u: +u.toFixed(4), v: +v.toFixed(4), denseU: +P.u.toFixed(4), denseV: +P.v.toFixed(4), err: +err.toFixed(4), backgroundPixels: bg });
      }
      measurements.c1 = { keys: plan.keys.length, residual: plan.residual, overTolerance: plan.overTolerance, maxZoom: lim.maxZoom, rows: cRows };
      check('C1', 'camera stills: the centre pixel on 12 frames is within 0.01 (source units) of the dense spring path, and no pixel of the magenta project background shows', stillOk && noBg && !plan.overTolerance, { keys: plan.keys.length, residual: +plan.residual.toFixed(5), rows: cRows });
      const cex = await exportOf(cp, 'c1.mp4');
      const craw = ff(['-i', cex.file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const cfb = 360 * 640 * 3;
      const exRowsC = frames12.map((k) => {
        const o = k * cfb; let su = 0, sv = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = o + ((320 + dy) * 360 + 180 + dx) * 3; su += craw[i]!; sv += craw[i + 1]!; }
        const u = su / 9 / 255, v = sv / 9 / 255, P = dense[k - 15]!;
        return { frame: k, err: +Math.max(Math.abs(u - P.u), Math.abs(v - P.v)).toFixed(4) };
      });
      check('C1', 'camera export: the centre (3×3 mean) on the same 12 frames is within 0.03 of the dense path', craw.length / cfb >= 135 && exRowsC.every((r) => r.err <= 0.03), exRowsC);
      // a partial retake over clip-local frames 40..80: keys outside stay, and so does every frame outside
      const before = (await getDoc(cp)).project;
      const clipOf = (d: ProjectDocument) => d.sequences[d.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)! as any;
      const outside = (keys: { time: T.RationalTime }[] | undefined) => (keys ?? []).filter((k) => { const fr = T.frameIndexAt(k.time, R); return fr < 40 || fr > 80; });
      const re = Array.from({ length: 41 }, (_, k) => ({ frame: 15 + 40 + k, u: 0.3, v: 0.45, zoom: 1.6 }));
      const plan2 = planCamera(before, { clipId, from: 40, to: 80, samples: re, settings: DEFAULT_CAMERA });
      if ('refused' in plan2) throw new Error(`retake refused: ${plan2.refused}`);
      await txs(cp, plan2.ops);
      const afterRe = (await getDoc(cp)).project;
      const keysKept = (['x', 'y', 'scale'] as const).every((p) => canonical(outside(clipOf(before).keyframes?.[p])) === canonical(outside(clipOf(afterRe).keyframes?.[p])));
      let framesKept = true; const moved: number[] = [];
      for (let k = 0; k < 120; k++) { if (k >= 40 && k <= 80) continue; const a = transformAt(clipOf(before), f(15 + k)), b = transformAt(clipOf(afterRe), f(15 + k)); if (canonical(a) !== canonical(b)) { framesKept = false; moved.push(k); } }
      const insideChanged = canonical(transformAt(clipOf(before), f(15 + 60))) !== canonical(transformAt(clipOf(afterRe), f(15 + 60)));
      check('C1', 'a partial camera retake (clip-local 40..80) keeps the x/y/scale keys outside its range, every frame outside it samples the same, and the inside changed', keysKept && framesKept && insideChanged, { replacedKeys: plan2.replacedKeys, keysKept, framesOutsideMoved: moved.slice(0, 10), insideChanged });

      // a retake on a clip with NO keys (the lead's decision): every frame outside the range is unchanged, on stills
      const clip2 = (await txs(cp, [{ op: 'add_clip', args: { assetId: card, start: f(140), duration: f(120) } }])).results[0].output.clipId as string;
      const outsideFrames = [140, 141, 160, 175, 179, 221, 222, 240, 259]; // clip-local 0, 1, 20, 35, 39 | 81, 82, 100, 119
      const pre2: Record<number, Buffer> = {};
      for (const k of outsideFrames) pre2[k] = await still(cp, k);
      const d2 = (await getDoc(cp)).project;
      const re2 = Array.from({ length: 41 }, (_, k) => ({ frame: 140 + 40 + k, u: 0.35 + k * 0.004, v: 0.5, zoom: 1.5 }));
      const plan3 = planCamera(d2, { clipId: clip2, from: 40, to: 80, samples: re2, settings: DEFAULT_CAMERA });
      if ('refused' in plan3) throw new Error(`no-key retake refused: ${plan3.refused}`);
      await txs(cp, plan3.ops);
      const same2 = await Promise.all(outsideFrames.map(async (k) => ({ frame: k, identical: Buffer.compare(await still(cp, k), pre2[k]!) === 0 })));
      const mid2 = Buffer.compare(await still(cp, 200), pre2[140]!) !== 0;
      check('C1', 'a camera retake (clip-local 40..80) on a clip with NO keys: every sampled frame outside the range is byte-identical on stills to before the take, and the inside moved', same2.every((x) => x.identical) && mid2, { replacedKeys: plan3.replacedKeys, keys: plan3.keys.length, warnings: plan3.warnings, frames: same2 });

      // the camera overlay in the editor, from the keyboard, on the clip that starts at frame 15 (samples are timeline frames)
      const cctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
      await cctx.addInitScript('globalThis.__name = (f) => f');
      await cctx.addInitScript(() => { (globalThis as any).__pfPerformProof = true; (globalThis as any).__pfAudioTap = true; try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.workspace.v1', 'perform'); localStorage.removeItem('pf.perform.v1'); } catch { /* storage unavailable */ } });
      const cPage = await cctx.newPage();
      const cErrors: string[] = [];
      cPage.on('pageerror', (e) => cErrors.push(String(e)));
      await cPage.goto(`${s.ownerUrl}&project=${cp}`);
      await cPage.getByTestId(ID.view).waitFor({ timeout: 30000 });
      await cPage.waitForFunction(() => !!(window as any).__pfPlayer, undefined, { timeout: 30000 });
      await cPage.locator(`[data-clip-id="${clipId}"]`).first().click();
      await cPage.getByTestId(ID.camera).click();
      await cPage.getByTestId(ID.cameraCrop).waitFor({ timeout: 15000 });
      await cPage.evaluate(() => (window as any).__pfPlayer.seek(30));
      await sleep(300);
      const revC0 = (await getDoc(cp)).revision;
      const crop = cPage.getByTestId(ID.cameraCrop).locator('xpath=..');
      await crop.focus();
      await cPage.keyboard.press('Equal'); await cPage.keyboard.press('Equal'); await cPage.keyboard.press('Equal');
      await cPage.keyboard.press('Enter');
      await cPage.waitForFunction(() => (document.querySelector('[data-testid=perform-camera-overlay]') as HTMLElement | null)?.dataset.phase === 'filming', undefined, { timeout: 10000 });
      for (let i = 0; i < 8; i++) { await cPage.keyboard.press('Shift+ArrowRight'); await sleep(150); }
      await cPage.keyboard.press('Enter');
      const reviewed = await cPage.getByTestId(ID.cameraConfirm).waitFor({ timeout: 15000 }).then(() => true, () => false);
      const confirm = reviewed ? (await cPage.getByTestId(ID.cameraConfirm).textContent()) ?? '' : '';
      const revDuring = (await getDoc(cp)).revision;
      await cPage.screenshot({ path: path.join(art, 'camera-review-he.png') });
      if (reviewed) await cPage.getByTestId(ID.accept).click();
      let revC1 = revC0;
      for (const t0 = Date.now(); Date.now() - t0 < 15000 && revC1 === revC0; await sleep(150)) revC1 = (await getDoc(cp)).revision;
      const dc = (await getDoc(cp)).project;
      const c1 = dc.sequences[dc.mainSequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId)! as any;
      const ui = (['x', 'y', 'scale'] as const).map((p) => ({ p, keys: (c1.keyframes?.[p] ?? []).length }));
      const lastTx = (await history(cp)).at(-1);
      check('C1', 'the camera overlay from the keyboard (+ to zoom, Enter, Shift+→ while filming at half speed, Enter): a review with the confirm saying the framing outside the range stays, nothing written while filming, accept = one transaction (history lists its op once: replace_clip_keyframes) that keyed x, y and scale', reviewed && /מחוץ לטווח נשאר/.test(confirm) && revDuring === revC0 && revC1 === revC0 + 1 && lastTx?.ops.join() === 'replace_clip_keyframes' && ui.every((x) => x.keys >= 2) && cErrors.length === 0, { confirm, revisions: revC1 - revC0, ops: lastTx?.ops, keys: ui, errors: cErrors.slice(0, 3) });
      await cctx.close();
    }
  } catch (e) {
    console.error(e);
    check('run', 'the proof ran to completion', false, String(e instanceof Error ? e.stack ?? e.message : e).slice(0, 800));
  } finally {
    await browser.close();
    await s.close();
  }
  const failed = checks.filter((c) => c.status === 'fail'), blocked = checks.filter((c) => c.status === 'blocked');
  const result = failed.length ? 'FAIL' : blocked.length ? 'BLOCKED-PART' : 'PASS';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    ranAt: new Date().toISOString(), result, passed: checks.filter((c) => c.status === 'pass').length, failed: failed.length, blocked: blocked.length, total: checks.length,
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, webgpu: measurements.webgpuAdapter },
    scope: 'Perform mode (ADR-0025) through the real server and the editor in headless Chromium. Not checked: key-to-picture and key-to-sound latency (nothing is called in sync), a hardware graphics adapter (F2 ran on the software adapter when present), and how a take feels on the owner\'s laptop. Timings are one sample of this machine.',
    blockedParts, checks, measurements,
  }, null, 2) + '\n');
  console.log(`perform-proof: ${result}: ${checks.filter((c) => c.status === 'pass').length} passed, ${failed.length} failed, ${blocked.length} blocked; ${OUT}`);
  process.exitCode = failed.length ? 1 : blocked.length ? 2 : 0;
}
main().catch((e) => { console.error(e); process.exit(1); });
export type { Page };
