/**
 * Time effects on the shared evaluator (ADR-0011): echo, time split, shutter and stutter checked on real output, on the
 * CPU only (no graphics adapter is used or needed: the render worker is started without WebGPU).
 *
 *  1. split: one frame-index barcode per colour channel on stills and on every frame of an export, 0 errors; a cut does not
 *     change a still;
 *  2. echo: on a flat-grey lossless fixture each still equals (ΣW_k·g(F−k·d) + 2048) >> 12 exactly (g read from stills of
 *     the same frames without the effect), lighten its own formula; the export within ±3 of the formula;
 *  3. seek equals sequential: 120 stills rendered in a shuffled order are byte-identical to the same stills in order;
 *  4. shutter: angle 0 is byte-identical to no effect; a moving white bar matches the box-filter model within 3/255;
 *  5. stutter: export barcodes equal F − F mod hold, the same with a cut at frame 37; following analysed music the picture
 *     changes only on planned beat frames, at least flashGapFrames apart;
 *  6. decode lanes: two echo-5 clips under a 15-frame transition export every frame within 12 decoders (server and browser
 *     export); three overlapping echo-5 clips: the still refuses with effect_unavailable … decode_budget and preflight
 *     lists decode_budget;
 *  7. agreement: paused editor preview vs still (mean difference < 0.5 of 255), export vs still (PSNR ≥ 36 dB);
 *  8. flash safety (ADR-0009): the FlashAnalyser verdict is `pass` on an export of each time effect at its defaults;
 *  9. recorded, not gated: milliseconds per frame of echo-5 at 1080×1920, and decoder counts.
 *
 *   pnpm build && pnpm proof:time
 * Writes docs/evidence/time-proof.json. Synthetic fixtures only; nobody looked at the pictures.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import * as T from '@pulseframe/time';
import { beatStepFrames, FlashAnalyser, flashCells, flashGapFrames, maxDecodeLanes, tapWeights } from '@pulseframe/engine';
import type { ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture, generateGreyFixture, greyLevel, readBarcode, readBarcodeChannel } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/time-proof');
const PORT = 8877;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const W = 640, H = 360, GW = 320, GH = 180;
const full = { x: 0, y: 0, w: W, h: H };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const pngToRgb = (png: Buffer): Buffer => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const meanDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; };
const maxDiff = (a: Buffer, b: Buffer) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; } const mse = s / a.length; return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse); };
/** The value of a flat grey still and how many of its channel values differ from it (0 for a flat picture). */
const flat = (rgb: Buffer) => { const v = rgb[0]!; let off = 0; for (let i = 0; i < rgb.length; i++) if (rgb[i] !== v) off++; return { v, off }; };
/** A deterministic shuffle. */
const shuffle = <X>(xs: X[], seed: number) => { const a = [...xs]; let s = seed; for (let i = a.length - 1; i > 0; i--) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; const j = (s >>> 8) % (i + 1); [a[i], a[j]] = [a[j]!, a[i]!]; } return a; };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  // ---------- fixtures ----------
  const barcode = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_8s.mp4'), frames: 240 });
  const grey = await generateGreyFixture({ out: path.join(art, 'grey_320x180_30fps_4s.mp4'), frames: 120, width: GW, height: GH });
  const bar = path.join(art, 'bar.png'), scene = path.join(art, 'scene.png');
  ff(['-f', 'lavfi', '-i', 'color=c=white:s=20x360', '-frames:v', '1', '-y', bar]);
  ff(['-f', 'lavfi', '-i', `color=c=0x1d3557:s=${W}x${H},drawbox=x=260:y=120:w=120:h=120:color=0xf1faee:t=fill,drawbox=x=100:y=60:w=60:h=240:color=0xe63946:t=fill,drawbox=x=460:y=200:w=90:h=40:color=0xa8dadc:t=fill`, '-frames:v', '1', '-y', scene]);
  // a click track at 200 beats a minute: faster than three a second, so the planned steps are thinned and spaced
  const loop = drumLoop(() => 200, 5, 0.37, 7);
  const rawLoop = path.join(art, 'loop.f32'), loopFile = path.join(art, 'clicks.wav');
  fs.writeFileSync(rawLoop, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength));
  ff(['-y', '-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', rawLoop, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', loopFile]);

  // The render worker without WebGPU: everything here must work on the CPU alone.
  const hadGpuMode = process.env.PF_RENDER_GPU;
  process.env.PF_RENDER_GPU = 'off';
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  const docOf = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const newProject = async (name: string, width = W, height = H) => (await call('/projects', { name, width, height })).body.project.id as string;
  const stillPng = async (pid: string, index: number) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw Object.assign(new Error(`still ${index} failed: ${JSON.stringify(r.body).slice(0, 300)}`), { response: r }); return r.body as Buffer; };
  const still = async (pid: string, index: number) => pngToRgb(await stillPng(pid, index));
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  let outputs = 0;
  /** Export [start, end) and decode it: the job and the frames as packed RGB (or RGBA). */
  const exportFrames = async (pid: string, start: number, end: number, pixFmt: 'rgb24' | 'rgba' = 'rgb24', width = W, height = H) => {
    const job = await waitJob((await call(`/projects/${pid}/exports`, { range: { startFrame: start, endFrame: end } })).body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error).slice(0, 400)}`);
    const file = path.join(art, `out-${++outputs}.mp4`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', pixFmt, '-']);
    const fb = width * height * (pixFmt === 'rgba' ? 4 : 3);
    return { job, file, frames: Array.from({ length: raw.length / fb }, (_, i) => raw.subarray(i * fb, (i + 1) * fb)) };
  };
  const clipOn = async (pid: string, assetId: string, start: number, duration: number, extra: Record<string, unknown> = {}) => (await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(duration), ...extra } }])).results[0].output.clipId as string;
  const addEffect = async (pid: string, clipId: string, type: string, params: Record<string, unknown> = {}) => (await tx(pid, [{ op: 'add_effect', args: { clipId, type, params } }])).results[0].output.effectId as string;

  const measurements: Record<string, unknown> = {};
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch();

    // ---------- 1 + 3. time split: per-channel barcodes; seek equals sequential ----------
    {
      const pid = await newProject('split');
      const assetId = await upload(pid, barcode.file);
      const clipId = await clipOn(pid, assetId, 0, 240);
      await addEffect(pid, clipId, 'time.split', { lag: 4, order: 'red-now' });
      const expect = (F: number) => [F, Math.max(0, F - 4), Math.max(0, F - 8)];
      const frames = Array.from({ length: 120 }, (_, i) => i);
      const inOrder = new Map<number, Buffer>();
      const t0 = Date.now();
      for (const F of frames) inOrder.set(F, await stillPng(pid, F));
      measurements.stillMs = Math.round((Date.now() - t0) / frames.length);
      const order = shuffle(frames, 11);
      const wrong: unknown[] = [];
      let differ = 0;
      for (const F of order) {
        const png = await stillPng(pid, F);
        if (!png.equals(inOrder.get(F)!)) differ++;
        const rgb = pngToRgb(png);
        const got = [0, 1, 2].map((c) => readBarcodeChannel(rgb, W, 3, full, c as 0 | 1 | 2));
        if (got.join() !== expect(F).join()) wrong.push({ F, got, expected: expect(F) });
      }
      check('time.split (stills): red shows frame F, green F − 4, blue F − 8 (never before the clip start), read as one barcode per channel on 120 stills in a shuffled order: 0 errors', wrong.length === 0, { stills: order.length, wrong: wrong.slice(0, 5) });
      check('Seek equals sequential: the same 120 stills rendered in a shuffled order are byte-identical to those rendered in order', differ === 0, { stills: 120, different: differ });
      const exp = await exportFrames(pid, 0, 90);
      const ewrong = exp.frames.flatMap((rgb, F) => { const got = [0, 1, 2].map((c) => readBarcodeChannel(rgb, W, 3, full, c as 0 | 1 | 2)); return got.join() === expect(F).join() ? [] : [{ F, got, expected: expect(F) }]; });
      check('time.split (export): every frame of a 90-frame export carries the three barcodes, 0 errors', exp.frames.length === 90 && ewrong.length === 0, { frames: exp.frames.length, wrong: ewrong.slice(0, 5) });
      // a cut inside the clip: the pieces read back across it, so nothing changes
      await tx(pid, [{ op: 'split_clip', args: { clipId, at: f(37) } }]);
      let cutDiffer = 0;
      for (let F = 37; F <= 45; F++) if (!(await stillPng(pid, F)).equals(inOrder.get(F)!)) cutDiffer++;
      check('time.split across a cut at frame 37: stills of frames 37–45 are byte-identical to those of the uncut clip', cutDiffer === 0, { different: cutDiffer });
    }

    // ---------- 2. echo on the flat-grey fixture ----------
    {
      const pid = await newProject('echo-grey', GW, GH);
      const assetId = await upload(pid, grey.file);
      const clipId = await clipOn(pid, assetId, 0, 120);
      const sample = [2, 7, 20, 33, 47, 61, 88, 119];
      const params = { count: 4, delay: 3, decay: 0.6 }; // the defaults
      const tapsOf = (F: number) => [0, 1, 2, 3].map((k) => Math.max(0, F - k * params.delay));
      const needed = [...new Set(sample.flatMap(tapsOf))].sort((a, b) => a - b);
      const g = new Map<number, number>();
      let unflat = 0;
      for (const F of needed) { const x = flat(await still(pid, F)); g.set(F, x.v); unflat += x.off; }
      measurements.greyDecoded = { frames: needed.length, differentFromEncodedLevel: needed.filter((F) => g.get(F) !== greyLevel(F)).length };
      check('Grey fixture: every frame decodes to one flat grey (the reference levels g(F) for the echo checks)', unflat === 0, { frames: needed.length, offPixels: unflat });
      const fxId = await addEffect(pid, clipId, 'time.echo', {});
      const w = tapWeights('time.echo', params, 4);
      const rows: unknown[] = [];
      let exact = true;
      for (const F of sample) {
        const x = flat(await still(pid, F));
        const want = (tapsOf(F).reduce((sum, at, k) => sum + w[k]! * g.get(at)!, 0) + 2048) >> 12;
        if (x.v !== want || x.off) exact = false;
        rows.push({ F, got: x.v, expected: want, offPixels: x.off });
      }
      check('time.echo blend (stills, defaults): each still equals (ΣW_k·g(F − 3k) + 2048) >> 12 exactly, with W from tapWeights (sum 4096) and clamped at the clip start', exact, { weights: w, rows });
      const exp = await exportFrames(pid, 0, 120, 'rgb24', GW, GH);
      const errs = exp.frames.map((rgb, F) => { const want = (tapsOf(F).reduce((sum, at, k) => sum + w[k]! * greyLevel(at), 0) + 2048) >> 12; let m = 0; for (let i = 0; i < rgb.length; i++) m = Math.max(m, Math.abs(rgb[i]! - want)); return m; });
      check('time.echo blend (export): every frame of the export is within ±3 of the formula on the encoded levels', exp.frames.length === 120 && Math.max(...errs) <= 3, { frames: exp.frames.length, worst: Math.max(...errs) });
      await tx(pid, [{ op: 'update_effect', args: { clipId, effectId: fxId, params: { mode: 'lighten' } } }]);
      const G = [0, 1, 2, 3].map((k) => Math.round(4096 * params.decay ** k));
      const lrows: unknown[] = [];
      let lexact = true;
      for (const F of sample) {
        const x = flat(await still(pid, F));
        const want = Math.max(...tapsOf(F).map((at, k) => (G[k]! * g.get(at)! + 2048) >> 12));
        if (x.v !== want || x.off) lexact = false;
        lrows.push({ F, got: x.v, expected: want });
      }
      check('time.echo lighten (stills): each still equals max_k ((G_k·g(F − 3k) + 2048) >> 12), G_k = round(4096·0.6^k)', lexact, lrows);
    }

    // ---------- 4. shutter ----------
    {
      // a white bar 20 px wide moving right 16 px a frame (x from −0.2 to 0.2 over 16 frames): at whole-pixel places on frames
      const pid = await newProject('shutter-bar');
      const assetId = await upload(pid, bar);
      const clipId = await clipOn(pid, assetId, 0, 60);
      await tx(pid, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: -0.2 } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(16), value: 0.2 } }]);
      const F = 8, row = 180;
      const plain = await still(pid, F);
      const fxId = await addEffect(pid, clipId, 'time.shutter', { angle: 360, samples: 8, timing: 'centred' });
      const blurred = await still(pid, F);
      // the box-filter model: the plain picture shifted by the eight sample places (−7, −5 … +7 px: 16 px a frame, samples
      // at (2j − 7)/16 of a frame), averaged as the merge averages (weights 512 each, rounded)
      const at = (img: Buffer, x: number, c: number) => (x < 0 || x >= W ? 0 : img[(row * W + x) * 3 + c]!);
      let worst = 0;
      const profile: number[][] = [];
      for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let j = 0; j < 8; j++) sum += 512 * at(plain, x - (2 * j - 7), c);
        const model = (sum + 2048) >> 12;
        worst = Math.max(worst, Math.abs(model - at(blurred, x, c)));
        if (c === 0 && x >= 160 && x <= 230 && x % 2 === 0) profile.push([x, at(blurred, x, 0), model]);
      }
      const smeared = [...Array(W).keys()].filter((x) => at(blurred, x, 0) > 0 && at(blurred, x, 0) < 255).length;
      check('time.shutter at 360°: a bar moving 16 px a frame is smeared into the box-filter model (eight places one frame wide), within 3 of 255 on every pixel of the row', worst <= 3 && smeared >= 12, { worstDifference: worst, partlyLitPixels: smeared, profile: profile.slice(0, 12) });
      await tx(pid, [{ op: 'update_effect', args: { clipId, effectId: fxId, params: { angle: 0 } } }]);
      const zero = await still(pid, F);
      check('time.shutter at 0°: byte-identical to the clip without the effect (moving bar)', maxDiff(zero, plain) === 0, { maxDifference: maxDiff(zero, plain) });
      // the same on a video clip (every sample of the frame's own picture: no extra decode)
      const vid = await newProject('shutter-video');
      const vAsset = await upload(vid, barcode.file);
      const vClip = await clipOn(vid, vAsset, 0, 120);
      const before = [await still(vid, 10), await still(vid, 77)];
      await addEffect(vid, vClip, 'time.shutter', { angle: 0 });
      const after = [await still(vid, 10), await still(vid, 77)];
      check('time.shutter at 0°: byte-identical to no effect on a video clip (frames 10 and 77)', after.every((a, i) => maxDiff(a, before[i]!) === 0), after.map((a, i) => maxDiff(a, before[i]!)));
    }

    // ---------- 5. stutter ----------
    {
      const pid = await newProject('stutter');
      const assetId = await upload(pid, barcode.file);
      const clipId = await clipOn(pid, assetId, 0, 120);
      await addEffect(pid, clipId, 'time.stutter', { hold: 3 });
      const read = (frames: Buffer[]) => frames.map((rgb) => readBarcode(rgb, W, 3, full));
      const want = (F: number) => F - (F % 3);
      const a = read((await exportFrames(pid, 0, 90)).frames);
      const aw = a.flatMap((v, F) => (v === want(F) ? [] : [{ F, got: v, expected: want(F) }]));
      check('time.stutter (export, hold 3): every frame shows the picture of F − F mod 3', a.length === 90 && aw.length === 0, { frames: a.length, wrong: aw.slice(0, 5) });
      await tx(pid, [{ op: 'split_clip', args: { clipId, at: f(37) } }]);
      const b = read((await exportFrames(pid, 0, 90)).frames);
      check('time.stutter with a cut at frame 37: the same frames as without the cut', b.length === 90 && b.every((v, F) => v === a[F]), { different: b.flatMap((v, F) => (v === a[F] ? [] : [F])).slice(0, 5) });

      // following the music: the beats of a 200 bpm click track, analysed by the product
      const mp = await newProject('stutter-music');
      const mAsset = await upload(mp, barcode.file);
      const mClip = await clipOn(mp, mAsset, 0, 120, { withLinkedAudio: false });
      const clicks = await upload(mp, loopFile);
      const analysed = await call(`/projects/${mp}/assets/${clicks}/analyze`, { kind: 'beats' });
      await tx(mp, [{ op: 'add_clip', args: { assetId: clicks, start: f(0) } }]);
      await addEffect(mp, mClip, 'time.stutter', { hold: 3, follow: 'music' });
      const doc = await docOf(mp);
      const plan = Array.from(beatStepFrames(doc, doc.mainSequenceId, 1));
      const gap = flashGapFrames(30);
      const shown = read((await exportFrames(mp, 0, 120)).frames);
      const expected = (F: number) => { const bs = plan.filter((x) => x <= F); const bt = bs[bs.length - 1]; return bt !== undefined && F - bt <= 60 ? bt : F - (F % 3); };
      const wrong = shown.flatMap((v, F) => (v === expected(F) ? [] : [{ F, got: v, expected: expected(F) }]));
      const firstBeat = plan[0] ?? Infinity;
      const changes = shown.flatMap((v, F) => (F > 0 && v !== shown[F - 1] ? [F] : []));
      const offPlan = changes.filter((F) => F >= firstBeat && !plan.includes(F));
      const spacing = changes.filter((F) => F >= firstBeat).map((F, i, xs) => (i ? F - xs[i - 1]! : Infinity));
      measurements.stutterMusic = { analysedBeats: analysed.body?.beats ?? analysed.body?.result?.beats ?? null, plannedFrames: plan, changes, flashGapFrames: gap };
      check('time.stutter following the music (export): the picture changes only on planned beat frames (thinned, at least flashGapFrames apart) and shows the frame of the latest one; steady steps before the first beat', analysed.status === 200 && plan.length >= 3 && wrong.length === 0 && offPlan.length === 0 && spacing.every((d) => d >= gap) && plan.every((x, i) => i === 0 || x - plan[i - 1]! >= gap), { planned: plan.length, wrong: wrong.slice(0, 5), offPlan, smallestSpacing: Math.min(...spacing) });
    }

    // ---------- 6. decode lanes ----------
    {
      // two echo-5 clips joined by a 15-frame dissolve: 10 pictures decoded at once during the transition
      const pid = await newProject('lanes-transition');
      const assetId = await upload(pid, barcode.file);
      const a = await clipOn(pid, assetId, 0, 60);
      const b = await clipOn(pid, assetId, 60, 60, { sourceIn: f(100) });
      await addEffect(pid, a, 'time.echo', { count: 5 });
      await addEffect(pid, b, 'time.echo', { count: 5 });
      await tx(pid, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 15 } }]);
      const lanes = maxDecodeLanes(await docOf(pid));
      const exp = await exportFrames(pid, 0, 120);
      check('Decode lanes: two echo-5 clips under a 15-frame transition need 10 decoders at once and export every frame within the worker\'s 12 (a frame that needed more would have been refused)', lanes.lanes === 10 && exp.frames.length === 120, { maxDecodeLanes: lanes, frames: exp.frames.length, renderStageMs: exp.job.output?.renderStageMs });
      const page = await browser.newPage();
      await page.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
      await page.evaluate(() => (window as any).__pfBrowserExport.ready);
      const run: any = await page.evaluate(([p]) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'high' }), [pid] as const);
      await page.close();
      const dec = run.ok ? run.result.decoders : null;
      measurements.browserExportDecoders = run.ok ? { ...dec, wallMs: Math.round(run.result.wallMs), frames: run.result.frames } : { error: run.code, message: String(run.message).slice(0, 300) };
      check('Decode lanes (browser export): the same project exports with at most 12 decoders open at once and none refused', run.ok && dec.peak <= 12 && dec.max === 12 && dec.refused === 0 && run.result.frames === 120, measurements.browserExportDecoders);

      // three overlapping echo-5 clips: 15 pictures at once
      const over = await newProject('lanes-overlap');
      const oAsset = await upload(over, barcode.file);
      for (const start of [0, 10, 20]) { const c = await clipOn(over, oAsset, start, 40, { withLinkedAudio: false }); await addEffect(over, c, 'time.echo', { count: 5 }); }
      const r = await call(`/projects/${over}/frame?index=30`);
      const message = JSON.stringify(r.body);
      check('Decode lanes: three overlapping echo-5 clips (15 pictures): the still is refused with effect_unavailable naming decode_budget, never delivered without the effect', r.status >= 400 && /effect_unavailable/.test(message) && /decode_budget/.test(message) && /time\.echo/.test(message), { status: r.status, error: (r.body?.error?.message ?? message).slice(0, 300) });
      const pre = (await call(`/projects/${over}/preflight`)).body;
      const issue = pre.issues?.find((i: any) => i.code === 'decode_budget');
      check('Decode lanes: preflight lists decode_budget with the frames where the three overlap', !!issue && issue.range?.startFrame === 20 && issue.range?.endFrame === 40 && issue.ids?.length === 3, issue ?? pre);
    }

    // ---------- 7. agreement: editor preview, still and export ----------
    {
      const pid = await newProject('echo-video');
      const assetId = await upload(pid, barcode.file);
      const clipId = await clipOn(pid, assetId, 0, 90);
      await tx(pid, [{ op: 'set_keyframe', args: { clipId, property: 'scale', time: f(0), value: 1 } }, { op: 'set_keyframe', args: { clipId, property: 'scale', time: f(60), value: 0.6 } }]);
      await addEffect(pid, clipId, 'time.echo', {});
      const F = 20;
      const st = await still(pid, F);
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator('.clip').first().waitFor();
      await page.waitForFunction(() => Number(document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') ?? -1) >= 0, undefined, { timeout: 30_000 });
      const ruler = (await page.getByTestId('ruler').boundingBox())!;
      await page.mouse.click(ruler.x + 3, ruler.y + 5); // the keys go to the editor
      await page.keyboard.press('Home');
      for (let i = 0; i < F; i++) { await page.keyboard.press('ArrowRight'); await sleep(40); } // frame by frame: the preview's decoders move forward
      await page.waitForFunction((n) => { const c = document.querySelector('canvas[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(n) && c.dataset.quality === 'full'; }, F, { timeout: 30_000 });
      await sleep(500);
      const b64: string = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        const out = new Uint8Array((d.length / 4) * 3);
        for (let i = 0, k = 0; i < d.length; i += 4) { out[k++] = d[i]!; out[k++] = d[i + 1]!; out[k++] = d[i + 2]!; }
        let s2 = ''; for (let i = 0; i < out.length; i += 0x8000) s2 += String.fromCharCode(...out.subarray(i, i + 0x8000));
        return `${c.width}x${c.height}:${btoa(s2)}`;
      });
      await page.close();
      const [size, data] = b64.split(':');
      const prev = Buffer.from(data ?? '', 'base64');
      measurements.previewVsStill = size === `${W}x${H}` ? { frame: F, meanDifference: Number(meanDiff(prev, st).toFixed(4)), maxDifference: maxDiff(prev, st) } : { size };
      check('Agreement: the paused editor preview of an echo frame (stepped to frame by frame) matches the still (mean difference under 0.5 of 255)', size === `${W}x${H}` && meanDiff(prev, st) < 0.5 && errors.length === 0, { ...(measurements.previewVsStill as object), pageErrors: errors.slice(0, 3) });
      const exp = await exportFrames(pid, 0, 60);
      const p20 = psnr(exp.frames[F]!, st), p45 = psnr(exp.frames[45]!, await still(pid, 45));
      measurements.exportVsStillPsnr = { frame20: Number(p20.toFixed(2)), frame45: Number(p45.toFixed(2)) };
      check('Agreement: the export matches the still (PSNR at least 36 dB, frames 20 and 45)', p20 >= 36 && p45 >= 36, measurements.exportVsStillPsnr);
    }

    // ---------- 8. flash safety at the defaults ----------
    {
      const verdicts: Record<string, unknown> = {};
      const run = async (type: string | null) => {
        const pid = await newProject(`flash-${type ?? 'none'}`);
        const assetId = await upload(pid, scene);
        const clipId = await clipOn(pid, assetId, 0, 90);
        await tx(pid, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: -0.25 } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(89), value: 0.25 } }]);
        if (type) await addEffect(pid, clipId, type, {});
        const exp = await exportFrames(pid, 0, 90, 'rgba');
        const fa = new FlashAnalyser(30);
        for (const rgba of exp.frames) fa.push(flashCells(rgba, W, H));
        const rep = fa.report();
        verdicts[type ?? 'no effect'] = { verdict: rep.verdict, frames: rep.frames, ranges: rep.ranges };
        return rep;
      };
      await run(null);
      const reps = [];
      for (const type of ['time.echo', 'time.split', 'time.shutter', 'time.stutter']) reps.push({ type, rep: await run(type) });
      measurements.flash = verdicts;
      check('Flash safety (ADR-0009): the FlashAnalyser verdict is pass on a 3-second export of each time effect at its defaults (a moving picture)', reps.every((x) => x.rep.verdict === 'pass' && x.rep.frames === 90), verdicts);
    }

    // ---------- 9. cost, recorded ----------
    {
      const PW = 1080, PH = 1920;
      const pid = await newProject('cost-portrait', PW, PH);
      const assetId = await upload(pid, barcode.file);
      const clipId = await clipOn(pid, assetId, 0, 30);
      const plain = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
      await addEffect(pid, clipId, 'time.echo', { count: 5 });
      const echo = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
      const per = (j: any) => (j.status === 'succeeded' && j.output?.renderStageMs ? Number((j.output.renderStageMs.draw / 30).toFixed(1)) : null);
      measurements.cost = { size: `${PW}x${PH}`, frames: 30, drawMsPerFrame: { noEffect: per(plain), echo5: per(echo) }, wallSeconds: { noEffect: plain.output?.wallSeconds ?? null, echo5: echo.output?.wallSeconds ?? null }, note: 'server export, software canvas, one run on this machine; not a target' };
      check('Recorded (not gated): milliseconds per frame of echo-5 at 1080×1920 on the CPU, against the same clip without the effect', plain.status === 'succeeded' && echo.status === 'succeeded', measurements.cost);
    }
  } finally {
    await browser?.close().catch(() => {});
    await s.close();
    if (hadGpuMode === undefined) delete process.env.PF_RENDER_GPU; else process.env.PF_RENDER_GPU = hadGpuMode;
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length || checks.length === 0 ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none used: the render worker ran without WebGPU (PF_RENDER_GPU=off)', node: process.version, ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0] },
      scope: 'Time effects (echo, time split, shutter, stutter) on synthetic fixtures: a 640x360 frame-barcode video, a 320x180 flat-grey lossless video, a white bar and a coloured still image, a generated click track; server stills and exports, one browser export, the paused editor preview. Correctness, agreement, decoder budget and flash safety at defaults; one cost sample. Not covered: real footage, playback frame rate in the editor, a hardware graphics adapter, the owner\'s laptop.',
      measurements, checks,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/time-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nTime proof ${report.result}: ${report.passed}/${report.total}`);
    if (report.result !== 'PASSED') process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
