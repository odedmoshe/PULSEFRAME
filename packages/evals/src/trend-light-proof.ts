/**
 * Trend pack (ADR-0012): the seven WGSL transitions (film-burn, light-leak, ink-bleed, brush-left/right, page-turn-left/right)
 * and the light plan (light transitions join the one flash schedule, amending ADR-0009 decision 1), on the server's render
 * worker, the path of every still and export (ADR-0005).
 *
 *   pnpm build && pnpm proof:trend-light
 *
 * L0  trend-baseline --check: the 51 legacy transitions (and the legacy titles) are byte-identical after uniform v2.
 * L1  blue fixture: the 7 new ids early/late/monotone (light ids with their light held by a strobe flash 4 frames before),
 *     repeatable middle frames, 46 distinct GPU middle frames.
 * L2  geometry: brush sides, page-turn back face against the JavaScript model (pageTurnSource) and its far corner, ink area,
 *     seed repeatability and seed difference.
 * L3  flat grey: the added light follows lightEnvelope (Pearson r), nothing outside its window, linear red share <= 0.75.
 * L4  a strobe flash 4 frames before film-burn's light start holds the light (kept false, since 4, no light drawn); 12 frames
 *     later it is kept.
 * L5  server exports: 60 back-to-back film-burns at 60 fps pass the export's flash check (the legacy flash fails, the
 *     contrast); each new id at its defaults on three fixtures passes with peak().general <= 3 per instance.
 * L6  PF_RENDER_GPU=off: a still of each new id is refused, naming the transition.
 * L7  time per pass at 1080x1920 (an estimate on the software adapter: no speed claim).
 *
 * Exits 2 (blocked) when this machine's browser gives no WebGPU adapter. Writes docs/evidence/trend-light-proof.json.
 * Nothing here was measured on a hardware adapter: the GPU ids count as verified only after the owner's run (ADR-0011:85).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { lightEnvelope, lightStartFrame, switchFrame, transitionProgress } from '@pulseframe/core';
import { FlashAnalyser, flashCells, flashSchedule } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import { pageFold, pageTurnSource } from '../../engine/src/gpu.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/trend-light');
const PORT = 8893, PORT_OFF = 8894;
const W = 360, H = 640;
const R30 = { num: 30, den: 1 }, R60 = { num: 60, den: 1 };
const NEW_IDS = ['film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right'] as const;
const LIGHT_IDS = ['film-burn', 'light-leak'] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
type Img = Buffer; // rgb24, W x H unless said otherwise
const pngToRgb = (png: Buffer): Img => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const px = (b: Img, x: number, y: number, w = W) => { const i = (Math.round(y) * w + Math.round(x)) * 3; return [b[i]!, b[i + 1]!, b[i + 2]!]; };
const blueMean = (img: Img) => { let t = 0; for (let i = 2; i < img.length; i += 3) t += img[i]!; return t / (img.length / 3); };
const maxDiff = (a: Img, b: Img) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const round = (x: number, d = 3) => Number(x.toFixed(d));
const pearson = (a: number[], b: number[]) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += (a[i]! - ma) * (b[i]! - mb); aa += (a[i]! - ma) ** 2; bb += (b[i]! - mb) ** 2; }
  return ab / Math.sqrt(aa * bb);
};
/** A still picture file: rgb24 painted by `paint(x, y)`. */
function picture(name: string, w: number, h: number, paint: (x: number, y: number) => [number, number, number]): string {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(paint(x, y), (y * w + x) * 3);
  const f = path.join(art, name);
  ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-y', f], raw);
  return f;
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const measurements: Record<string, unknown> = {};
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();

  // ---------- L0: the legacy transitions and titles are byte-identical (its own script, its own server) ----------
  {
    let out = '', ok = false;
    try { out = execFileSync('pnpm', ['-s', 'proof:trend-baseline', '--check'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }); ok = true; } catch (e) { out = String((e as { stdout?: string }).stdout ?? e); }
    const last = out.trim().split('\n').filter((l) => l.includes('trend baseline --check')).pop() ?? out.trim().split('\n').pop() ?? '';
    let report: { result?: string; compared?: unknown; differences?: unknown[] } = {};
    try { report = JSON.parse(fs.readFileSync(path.join(root, '.artifacts/trend-baseline/check.json'), 'utf8')); } catch { /* reported as missing below */ }
    measurements.baseline = { line: last, compared: report.compared, differences: report.differences?.length ?? null };
    check('L0 trend-baseline --check: the 51 legacy transitions × 3 frames × 2 shapes (and the legacy titles) are byte-identical after uniform v2', ok && report.result === 'PASSED' && (report.differences?.length ?? 1) === 0, measurements.baseline);
  }

  delete process.env.PF_RENDER_GPU; // as gpu-proof: the render host finds a launch mode that gives a graphics device, if this machine has one
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  {
    const b = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
    const p = await b.newPage();
    await p.goto(`${s.url}/gpu.html`);
    const has = await p.evaluate(async () => !!(await (navigator as any).gpu?.requestAdapter()));
    await b.close();
    if (!has) { await s.close(); console.error('BLOCKED: the browser gives no WebGPU adapter on this machine, even with WebGPU enabled (see `pnpm probe:gpu`)'); process.exit(2); }
  }
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  const still = async (pid: string, index: number) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw Object.assign(new Error(`still failed: ${JSON.stringify(r.body).slice(0, 300)}`), { response: r }); return pngToRgb(r.body); };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const waitJob = async (jobId: string) => { for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(250); } };
  /** Two picture clips, the outgoing one at 0–`cut` and the incoming one at `cut`–`cut + inFrames`; returns the incoming clip. */
  const pair = async (pid: string, out: string, inn: string, cut: number, rate = R30, inFrames = 60) => {
    await tx(pid, [{ op: 'add_clip', args: { assetId: out, start: T.rt(0, 1), duration: T.frameTime(cut, rate) } }]);
    return (await tx(pid, [{ op: 'add_clip', args: { assetId: inn, start: T.frameTime(cut, rate), duration: T.frameTime(inFrames, rate) } }])).results[0].output.clipId as string;
  };
  /** A title shown on frames [from, from + 5) whose steady strobe flashes once, on frame `from` (rate 30/from a second). */
  const strobeAt = async (pid: string, from: number) => {
    const title = (await tx(pid, [{ op: 'add_text', args: { text: '.', start: T.frameTime(from, R30), duration: T.frameTime(5, R30) } }])).results[0].output.clipId as string;
    await tx(pid, [{ op: 'add_effect', args: { clipId: title, type: 'light.strobe', params: { amount: 1, rate: 30 / from } } }]);
    return title;
  };

  try {
    // ---------- L1: the blue fixture (gpu-proof.ts): red = column, green = row, blue 0 outgoing / 255 incoming ----------
    const tp = (await call('/projects', { name: 'trend-light blue', width: W, height: H })).body.project.id as string;
    const fixture = (blue: number) => (x: number, y: number): [number, number, number] => [Math.round((255 * x) / (W - 1)), Math.round((255 * y) / (H - 1)), blue];
    const inClip = await pair(tp, await upload(tp, picture('out.png', W, H, fixture(0))), await upload(tp, picture('in.png', W, H, fixture(255))), 60);
    const catalog = (await call('/catalog')).body.transitions as { id: string; gpu: boolean; light?: boolean }[];
    const gpuIds = catalog.filter((t) => t.gpu).map((t) => t.id);
    const mids: Record<string, Img> = {};
    const rows: Record<string, unknown>[] = [];
    let endsOk = true, repeatOk = true;
    for (const id of gpuIds) {
      await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
      mids[id] = await still(tp, 74);
      if (!(NEW_IDS as readonly string[]).includes(id)) continue;
      const b = [blueMean(await still(tp, 61)), blueMean(mids[id]!), blueMean(await still(tp, 87))];
      const repeat = maxDiff(mids[id]!, await still(tp, 74)) === 0;
      const monotone = b[0]! <= b[1]! + 1 && b[1]! <= b[2]! + 1;
      const ok = b[0]! < 70 && b[2]! > 185 && ((LIGHT_IDS as readonly string[]).includes(id) || monotone);
      endsOk &&= ok; repeatOk &&= repeat;
      rows.push({ id, incomingShare: b.map((x) => round(x / 255, 2)), monotone, repeat, ok });
    }
    check('L1 the 7 new GPU ids on the blue fixture: early blue below 70, late above 185, and (all but the 2 light ids, whose middle frame is lit) never backwards', endsOk && rows.length === 7, rows);
    check('L1 the middle frame of each new id is identical when rendered again', repeatOk);
    const distinct = new Set(Object.values(mids).map(sha)).size;
    check('L1 46 GPU transitions, 46 distinct middle frames', gpuIds.length === 46 && distinct === 46, { gpuTransitions: gpuIds.length, distinctMiddleFrames: distinct });
    {
      // the light ids with their light held: a strobe flash on frame 65, their light would start on 60 + 9 = 69
      const title = await strobeAt(tp, 65);
      const held: Record<string, unknown>[] = [];
      let ok = true;
      for (const id of LIGHT_IDS) {
        await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
        const plan = flashSchedule(await doc(tp)).lights.get(inClip);
        const b = [blueMean(await still(tp, 61)), blueMean(await still(tp, 74)), blueMean(await still(tp, 87))];
        const one = !!plan && !plan.kept && plan.since === 4 && b[0]! < 70 && b[2]! > 185 && b[0]! <= b[1]! + 1 && b[1]! <= b[2]! + 1;
        ok &&= one;
        held.push({ id, plan, incomingShare: b.map((x) => round(x / 255, 2)), ok: one });
      }
      check('L1 the light ids with their light held by a kept strobe flash 4 frames earlier: early/late as above and never backwards', ok, held);
      await tx(tp, [{ op: 'delete_clip', args: { clipId: title } }]);
    }

    // ---------- L2: geometry ----------
    {
      const isIn = (img: Img, x: number, y: number) => px(img, x, y)[2]! > 200, isOut = (img: Img, x: number, y: number) => px(img, x, y)[2]! < 55;
      const ys = Array.from({ length: 15 }, (_, i) => 20 + i * 43);
      const bl = mids['brush-left']!, br = mids['brush-right']!;
      const brushOk = ys.every((y) => isIn(bl, 0.85 * W, y) && isOut(bl, 0.1 * W, y) && isOut(br, 0.85 * W, y) && isIn(br, 0.1 * W, y));
      check('L2 brush-left half-way: the right side shows the incoming picture and the left side the outgoing one; brush-right the opposite (15 rows)', brushOk, { rows: ys.length });

      // page-turn half-way: the flat back of the page shows the outgoing picture mirrored about pageFold().mirror, 25% toward white
      const p = transitionProgress(14, 29, null), fold = pageFold(p);
      const pageRows: unknown[] = [];
      let pageOk = true, measured = 0, worst = 0;
      for (const id of ['page-turn-left', 'page-turn-right'] as const) {
        const img = mids[id]!, left = id === 'page-turn-left';
        for (let x = 0; x < W; x += 2) {
          const u = (x + 0.5) / W, sx = left ? u : 1 - u, src = pageTurnSource(sx, p);
          if (src.face !== 'back' || sx > fold.fold - 3 / W || sx < 2 * fold.mirror - 1 + 3 / W) continue; // the flat back, away from its edges
          const red = px(img, x, H / 2)[0]!, fromRed = ((red - 63.75) / 0.75 / 255) * (W - 1); // the column the outgoing picture's red names
          const model = (left ? src.at : 1 - src.at) * W - 0.5;
          worst = Math.max(worst, Math.abs(fromRed - model)); measured++;
          pageOk &&= Math.abs(fromRed - model) <= 3;
        }
        const far = left ? [W - 6, 6] : [6, 6], near = left ? [6, 6] : [W - 6, 6];
        const corners = { farIncoming: isIn(img, far[0]!, far[1]!) && isIn(img, far[0]!, H - 6), nearOutgoing: isOut(img, near[0]!, near[1]!) && isOut(img, near[0]!, H - 6) };
        pageOk &&= corners.farIncoming && corners.nearOutgoing;
        pageRows.push({ id, corners });
      }
      measurements.pageTurn = { progress: round(p, 4), fold: round(fold.fold, 4), mirror: round(fold.mirror, 4), columnsMeasured: measured, worstPixels: round(worst, 2), rows: pageRows };
      check('L2 page-turn half-way: the back of the page shows the outgoing picture mirrored about the model fold (within 3 px), the corners on the side the page left are incoming and the others still outgoing', pageOk && measured >= 20, measurements.pageTurn);

      // ink: the incoming area grows on every frame; one seed always draws the same; seeds 1 and 2 differ
      await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: 'ink-bleed', frames: 29 } }]);
      const area: number[] = [];
      for (let f = 60; f < 89; f++) { const img = await still(tp, f); let n = 0; for (let i = 2; i < img.length; i += 3) if (img[i]! > 127) n++; area.push(n / (W * H)); }
      const grows = area.every((a, i) => i === 0 || a >= area[i - 1]!);
      await tx(tp, [{ op: 'set_transition_options', args: { clipId: inClip, seed: 1 } }]);
      const s1 = await still(tp, 74);
      await tx(tp, [{ op: 'set_transition_options', args: { clipId: inClip, seed: 2 } }]);
      const s2 = await still(tp, 74);
      await tx(tp, [{ op: 'set_transition_options', args: { clipId: inClip, seed: 1 } }]);
      const s1again = await still(tp, 74);
      let differ = 0;
      for (let i = 2; i < s1.length; i += 3) if ((s1[i]! > 127) !== (s2[i]! > 127)) differ++;
      measurements.ink = { incomingArea: area.map((a) => round(a, 3)), seedsDifferIn: round(differ / (W * H), 3) };
      check('L2 ink-bleed: the incoming area never shrinks; seed 1 draws the same frame again after seed 2; seeds 1 and 2 differ in at least 20% of the pixels', grows && area[0]! < 0.05 && area[28]! > 0.95 && maxDiff(s1, s1again) === 0 && differ / (W * H) >= 0.2, measurements.ink);
      await tx(tp, [{ op: 'set_transition_options', args: { clipId: inClip, seed: null } }]);
    }

    // ---------- L3: flat grey 128: the light alone ----------
    const gp = (await call('/projects', { name: 'trend-light grey', width: W, height: H })).body.project.id as string;
    const greyFile = picture('grey.png', W, H, () => [128, 128, 128]);
    const grey = await upload(gp, greyFile);
    const gIn = await pair(gp, grey, await upload(gp, greyFile), 60);
    {
      const rowsL: Record<string, unknown>[] = [];
      let ok = true;
      for (const id of LIGHT_IDS) {
        await tx(gp, [{ op: 'set_transition', args: { clipId: gIn, type: id, frames: 29 } }]);
        const plan = flashSchedule(await doc(gp)).lights.get(gIn);
        const added: number[] = [], env: number[] = [];
        let outside = 0, R = 0, G = 0, B = 0;
        for (let l = 0; l < 29; l++) {
          const img = await still(gp, 60 + l), e = lightEnvelope(29, 30, switchFrame(29, null), l);
          let sum = 0;
          for (let i = 0; i < img.length; i += 3) { sum += (img[i]! + img[i + 1]! + img[i + 2]!) / 3 - 128; R += lin(img[i]!) - lin(128); G += lin(img[i + 1]!) - lin(128); B += lin(img[i + 2]!) - lin(128); }
          const mean = sum / (W * H);
          added.push(mean); env.push(e);
          if (e === 0) outside = Math.max(outside, Math.abs(mean));
        }
        const r = pearson(added, env), share = R / (R + G + B);
        const one = !!plan?.kept && r >= 0.98 && outside <= 0.5 && share <= 0.75 && Math.max(...added) > 10;
        ok &&= one;
        rowsL.push({ id, kept: plan?.kept, pearson: round(r, 4), outsideWindow: round(outside, 3), linearRedShare: round(share, 3), peakMeanAdded: round(Math.max(...added), 1), ok: one });
      }
      measurements.lightOnGrey = rowsL;
      check('L3 on flat grey 128 (light kept): the mean added light per frame follows lightEnvelope (Pearson r >= 0.98), at most 0.5/255 outside its window, linear red share of the added light <= 0.75', ok, rowsL);
    }

    // ---------- L4: a strobe at 3 a second; film-burn's light 4 frames after its last kept flash is held, 12 frames later kept ----------
    {
      const at = async (cut: number) => {
        const pid = (await call('/projects', { name: `trend-light hold ${cut}`, width: W, height: H })).body.project.id as string;
        const g = await upload(pid, greyFile);
        const inId = await pair(pid, g, await upload(pid, greyFile), cut);
        await tx(pid, [{ op: 'set_transition', args: { clipId: inId, type: 'film-burn', frames: 29 } }]);
        // a steady strobe at 3 a second (the schedule's even 30/11: frames 0, 11, …, 66) on a title over frames 0–67
        const title = (await tx(pid, [{ op: 'add_text', args: { text: '.', start: T.rt(0, 1), duration: T.frameTime(68, R30) } }])).results[0].output.clipId as string;
        await tx(pid, [{ op: 'add_effect', args: { clipId: title, type: 'light.strobe', params: { amount: 1, rate: 3 } } }]);
        const plan = flashSchedule(await doc(pid)).lights.get(inId);
        // the light the burn shows on the frames after the title (the title's own glyph is not light): the most a frame's mean departs from grey
        let most = 0;
        for (let f = 68; f < cut + 29; f++) { const img = await still(pid, f); let sum = 0; for (let i = 0; i < img.length; i++) sum += Math.abs(img[i]! - 128); most = Math.max(most, sum / img.length); }
        return { plan, mostMeanLight: round(most, 3) };
      };
      const start = lightStartFrame(29, 30, switchFrame(29, null))!; // 9
      const heldCase = await at(70 - start), keptCase = await at(70 - start + 12);
      measurements.hold = { lightStartsAt: { held: 70, kept: 82 }, held: heldCase, kept: keptCase };
      check('L4 film-burn whose light would start 4 frames after a kept strobe flash (frame 66): held (kept false, since 4) and it shows at most 0.5/255 of light; moved 12 frames later it is kept and lights', !!heldCase.plan && heldCase.plan.kept === false && heldCase.plan.since === 4 && heldCase.mostMeanLight <= 0.5 && !!keptCase.plan && keptCase.plan.kept === true && keptCase.mostMeanLight > 5, measurements.hold);
    }

    // ---------- L5: server exports and their flash check ----------
    const exportFrames = async (pid: string, name: string, w: number, hh: number) => {
      const job = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
      if (job.status !== 'succeeded') return { job, frames: [] as Buffer[] };
      const file = path.join(art, `${name}.mp4`);
      fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
      const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), size = w * hh * 4, frames: Buffer[] = [];
      for (let o = 0; o + size <= raw.length; o += size) frames.push(raw.subarray(o, o + size));
      return { job, frames };
    };
    const analyse = (frames: Buffer[], w: number, hh: number, fps: number) => { const a = new FlashAnalyser(fps); for (const f of frames) a.push(flashCells(f, w, hh)); return { verdict: a.report().verdict, peak: a.peak(), ranges: a.report().ranges.length }; };
    {
      // 60 back-to-back clips of 15 frames at 60 fps, alternating two greys that differ by less than a flash, all with film-burn
      const run = async (type: string) => {
        const pid = (await call('/projects', { name: `trend-light 60x ${type}`, width: W, height: H, frameRate: R60 })).body.project.id as string;
        const a = await upload(pid, picture('g100.png', W, H, () => [100, 100, 100])), b = await upload(pid, picture('g120.png', W, H, () => [120, 120, 120]));
        const made = await tx(pid, Array.from({ length: 60 }, (_, k) => ({ op: 'add_clip', args: { assetId: k % 2 ? b : a, start: T.frameTime(15 * k, R60), duration: T.frameTime(15, R60) } })));
        const ids = made.results.map((r: any) => r.output.clipId as string);
        await tx(pid, ids.slice(1).map((clipId: string) => ({ op: 'set_transition', args: { clipId, type, frames: 15 } })));
        const sch = flashSchedule(await doc(pid));
        const kept = [...sch.lights.values()].filter((x) => x.kept).map((x) => x.frame).sort((x, y) => x - y);
        let most = 0; for (let i = 0, j = 0; i < kept.length; i++) { while (kept[i]! - kept[j]! >= 60) j++; most = Math.max(most, i - j + 1); }
        const { job, frames } = await exportFrames(pid, `sixty-${type}`, W, H);
        return { status: job.status, manifest: job.output?.photosensitivity ? { verdict: job.output.photosensitivity.verdict, ranges: job.output.photosensitivity.ranges.length } : null, lights: sch.lights.size, keptLights: kept.length, mostKeptStartsInASecond: most, local: frames.length ? analyse(frames, W, H, 60) : null, frames: frames.length };
      };
      const burn = await run('film-burn'), flash = await run('flash');
      measurements.backToBack = { burn, flash };
      check('L5 60 back-to-back 15-frame clips at 60 fps, all film-burn: the export passes its flash check and the schedule keeps at most 3 light starts in any second', burn.status === 'succeeded' && burn.manifest?.verdict === 'pass' && burn.mostKeptStartsInASecond <= 3 && burn.keptLights > 0 && burn.local?.verdict === 'pass', burn);
      check('L5 contrast: the same timeline with the legacy flash transition (outside the schedule, ADR-0011) fails the flash check', flash.status === 'succeeded' && flash.manifest?.verdict === 'fail', flash);
    }
    {
      // each new id at its defaults (15 frames, its default colour and seed) on three fixtures in one export at 30 fps:
      // black|white halves, a 3×3 checker and red|green, each going to its inverse; analysed per instance
      const fixtures: [string, (x: number, y: number) => [number, number, number]][] = [
        ['halves', (x) => (x < W / 2 ? [0, 0, 0] : [255, 255, 255])],
        ['checker', (x, y) => ((Math.floor((3 * x) / W) + Math.floor((3 * y) / H)) % 2 ? [255, 255, 255] : [0, 0, 0])],
        ['red-green', (x) => (x < W / 2 ? [255, 0, 0] : [0, 255, 0])],
      ];
      const inverse = (p: (x: number, y: number) => [number, number, number]) => (x: number, y: number): [number, number, number] => { const c = p(x, y); return c[0] === 255 && c[1] === 0 ? [0, 255, 0] : c[1] === 255 && c[0] === 0 && c[2] === 0 ? [255, 0, 0] : [255 - c[0], 255 - c[1], 255 - c[2]]; };
      const files = fixtures.map(([name, paint]) => [picture(`${name}-a.png`, W, H, paint), picture(`${name}-b.png`, W, H, inverse(paint))] as const);
      const perId: Record<string, unknown> = {};
      let ok = true;
      for (const id of NEW_IDS) {
        const pid = (await call('/projects', { name: `trend-light defaults ${id}`, width: W, height: H })).body.project.id as string;
        const ops: unknown[] = [];
        for (const [k, [fa, fb]] of files.entries()) {
          const a = await upload(pid, fa), b = await upload(pid, fb);
          ops.push({ op: 'add_clip', args: { assetId: a, start: T.frameTime(60 * k, R30), duration: T.frameTime(30, R30) } }, { op: 'add_clip', args: { assetId: b, start: T.frameTime(60 * k + 30, R30), duration: T.frameTime(30, R30) } });
        }
        const made = await tx(pid, ops);
        const incoming = made.results.filter((_: unknown, i: number) => i % 2 === 1).map((r: any) => r.output.clipId as string);
        await tx(pid, incoming.map((clipId: string) => ({ op: 'set_transition', args: { clipId, type: id } }))); // frames and options at their defaults
        const { job, frames } = await exportFrames(pid, `defaults-${id}`, W, H);
        const instances = fixtures.map(([name], k) => ({ fixture: name, ...analyse(frames.slice(60 * k, 60 * k + 60), W, H, 30) }));
        const one = job.status === 'succeeded' && job.output?.photosensitivity?.verdict === 'pass' && frames.length === 180 && instances.every((x) => x.verdict === 'pass' && x.peak.general <= 3);
        ok &&= one;
        perId[id] = { status: job.status, exportVerdict: job.output?.photosensitivity?.verdict, frames: frames.length, instances, ok: one };
      }
      measurements.defaults = perId;
      check('L5 each new GPU id at its defaults on black|white halves, a 3×3 checker and red|green (each to its inverse) at 30 fps: the export passes its flash check, and every instance passes with peak().general <= 3', ok, perId);
    }

    // ---------- L7: time per pass at 1080x1920 (still with the transition minus the same still as a plain cut) ----------
    {
      const BW = 1080, BH = 1920;
      const pid = (await call('/projects', { name: 'trend-light timing', width: BW, height: BH })).body.project.id as string;
      const big = (blue: number) => (x: number, y: number): [number, number, number] => [Math.round((255 * x) / (BW - 1)), Math.round((255 * y) / (BH - 1)), blue];
      const inId = await pair(pid, await upload(pid, picture('big-out.png', BW, BH, big(0))), await upload(pid, picture('big-in.png', BW, BH, big(255))), 60);
      const timeStill = async () => { const t: number[] = []; for (let k = 0; k < 3; k++) { const t0 = performance.now(); const r = await call(`/projects/${pid}/frame?index=74`); if (r.status !== 200) throw new Error(`timing still: ${r.status}`); t.push(performance.now() - t0); } return t.sort((a, b) => a - b)[1]!; };
      const plain = await timeStill();
      const timing: Record<string, unknown> = { plainStillMs: Math.round(plain) };
      for (const id of NEW_IDS) {
        await tx(pid, [{ op: 'set_transition', args: { clipId: inId, type: id, frames: 29 } }]);
        await call(`/projects/${pid}/frame?index=74`); // the pipeline is compiled on first use
        const ms = await timeStill();
        timing[id] = { stillMs: Math.round(ms), passMsEstimate: Math.round(ms - plain) };
        await tx(pid, [{ op: 'set_transition', args: { clipId: inId, type: null } }]);
      }
      measurements.timing1080x1920 = timing;
      check('L7 time per pass at 1080x1920 recorded for each kernel (median of 3 still round trips with the transition, minus the same still without one; software adapter, no speed claim)', NEW_IDS.every((id) => typeof (timing[id] as { stillMs?: number } | undefined)?.stillMs === 'number'), timing);
    }
  } finally {
    await s.close();
  }

  // ---------- L6: no adapter in the render worker: a still of each new id is refused, naming it ----------
  process.env.PF_RENDER_GPU = 'off';
  const s2 = await startServer({ port: PORT_OFF, dataDir: path.join(art, 'data') });
  try {
    const h2 = { authorization: `Bearer ${s2.auth.tokens.agent}`, connection: 'close' };
    const pid = ((await (await fetch(`${s2.url}/api/v1/projects`, { headers: h2 })).json()) as any).projects.find((p: any) => p.name === 'trend-light blue').id as string;
    const project = ((await (await fetch(`${s2.url}/api/v1/projects/${pid}`, { headers: h2 })).json()) as any).project;
    const inClip = project.sequences[project.mainSequenceId].tracks.flatMap((t: any) => t.clips).find((c: any) => c.type === 'media' && c.start && T.eq(c.start, T.frameTime(60, R30))).id as string;
    const refusals: Record<string, unknown> = {};
    let ok = true;
    for (const id of NEW_IDS) {
      const t = await fetch(`${s2.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: { ...h2, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }] }) });
      if (t.status !== 200) { ok = false; refusals[id] = { transaction: t.status }; continue; }
      const r = await fetch(`${s2.url}/api/v1/projects/${pid}/frame?index=74`, { headers: h2 });
      const body = r.headers.get('content-type')?.includes('json') ? ((await r.json()) as any) : null;
      const message = JSON.stringify(body ?? {});
      const one = r.status >= 400 && /gpu_effect_unavailable|graphics adapter/.test(message) && message.includes(id);
      ok &&= one;
      refusals[id] = { status: r.status, names: message.includes(id), error: String(body?.error?.message ?? '').slice(0, 160) };
    }
    check('L6 with PF_RENDER_GPU=off a still of each new GPU id is refused, naming the transition (never drawn as a cut)', ok, refusals);
  } finally {
    await s2.close();
    delete process.env.PF_RENDER_GPU;
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), commit, result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none: the WebGPU adapter here is a software one' },
      scope: 'The seven trend-pack WGSL transitions and the light plan (ADR-0012) on synthetic still pictures at 360x640 (timing at 1080x1920), through the server API and its render worker on a software WebGPU adapter. Correctness of the passes, of the flash schedule and of the export flash check only: no speed claim, no real footage, no hardware adapter (the owner\'s run is still needed, ADR-0011:85), nobody looked at the pictures.',
      measurements, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/trend-light-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\ntrend-light proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
