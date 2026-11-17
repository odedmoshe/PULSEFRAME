/**
 * Trend pack (ADR-0012): the new transitions, the beat lock and the velocity ramp, checked on real output (T1–T8).
 *
 *  T1. /catalog lists the 69 transitions with category and options; every new id's middle frame differs from both sides.
 *  T2. On the blue fixture (red = column, green = row, blue 0 outgoing and 255 incoming) at 360×640 and 640×360, frames
 *      60..88 of a 29-frame transition, for every single-crossing id that can render: at most 0.1 % of the pixels lose more
 *      than 6/255 of blue from one frame to the next, the blue mean is below 70 on frame 61 and above 185 on frame 87.
 *      Blue is the incoming share wherever the outgoing side is the outgoing picture itself. Page turn is the one kernel that
 *      repaints it: the back of the page is the outgoing picture 25 % toward white (blue 64), shaded by the curl down to
 *      0.7 of that, and the incoming picture under the curl's shadow is never below 0.75 (blue 191). There a pixel shows
 *      the incoming picture when its blue is at least 128, and the check is on that: at most 0.1 % of the pixels go back
 *      from incoming to the page or lose more than 6/255 while incoming, at most 0.1 % lie between the two (66..189), the
 *      page loses at most 20/255 a frame (the curl's shade, 0.3 · 64), and the incoming region is the model's
 *      s > pageFold(p).edge to within half a percent of the pixels.
 *  T3. Geometry at the middle frame (74): heart and star (centre incoming, the 4 corners outgoing, the heart's notch
 *      outgoing), split open (centre column incoming, the side columns outgoing), the colour blocks (the switch frame within
 *      ±2 of a block colour, nothing of them on frame 88), slices (one seed renders the same twice, seeds 1 and 2 differ in
 *      at least 10 % of the pixels), blur dissolve (the centre's blue is 255·p ± 3 on frames 61, 74 and 87).
 *  T4. Beat lock on punch-in and dissolve with beats set by edit_analysis at frames 70, 75 and 80: the first frame past half
 *      blue is 75; the beats moved by +1 give 76 and by +2 give 72 (72 and 77 are equally near the window's middle, and the
 *      contract takes the earlier one); with no beats, sync on renders SHA-identical to sync off.
 *  T5. Velocity ×2, ×3, ×4 at n = 15 and 29 on the frame-barcode video: in the regions a wipe gives each side, the outgoing
 *      picture shows its frame end + l + out(l) and the incoming one sourceIn + l − in(l), with 0 errors on stills and on a
 *      server export (wipe-left reads the incoming side's low bits, wipe-right the outgoing side's); the refusals carry
 *      maxVelocity at 21/22, 28/29 and 35/36 frames of handle for n = 15.
 *  T6. A server export of each new transition (Canvas2D and, where the render worker has an adapter, GPU) at its defaults
 *      between six back-to-back 1-second clips, with dark/bright and with equal-luminance pictures: the FlashAnalyser verdict.
 *      Canvas2D: a gate. The colour blocks (and dip, for comparison) between 4-frame clips: recorded, not a gate.
 *  T7. punch-in, shape-heart, blur-dissolve and slices-h: the paused editor preview is byte-identical to the still, and the
 *      export reaches PSNR ≥ 40 dB against the stills.
 *  T8. Recorded: the median milliseconds per frame of each new Canvas2D id at 1080×1920 (lab.html?bench=transitions, the
 *      render page's CPU raster path), against the same frames without a transition; anything over 60 ms is named.
 *
 *   pnpm build && pnpm proof:trend-transitions
 * Writes docs/evidence/trend-transitions-proof.json. Synthetic fixtures only; nobody looked at the pictures.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { beatSwitchFrame, TRANSITION_CATEGORIES, TRANSITIONS, transitionProgress, velocityNeeds, velocityOffsets, type MediaClip, type ProjectDocument, type TransitionDef } from '@pulseframe/core';
import { FlashAnalyser, flashCells } from '@pulseframe/engine';
import { blockColors, blockSpans, SHAPES, shapeScale } from '@pulseframe/engine/canvasTransitions.ts';
import { GPU_TRANSITIONS, pageFold } from '@pulseframe/engine/gpu.ts';
import { BARCODE, generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/trend-transitions');
const evidence = path.join(root, 'docs/evidence/trend-transitions-proof.json');
const PORT = 8887;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 1500)}` : ''}`); };
const measurements: Record<string, unknown> = {};

/** A picture as packed RGB with its size. */
interface Img { w: number; h: number; rgb: Buffer }
const pngToImg = (png: Buffer, w: number, h: number): Img => ({ w, h, rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
const at = (img: Img, x: number, y: number) => { const i = (Math.round(y) * img.w + Math.round(x)) * 3; return [img.rgb[i]!, img.rgb[i + 1]!, img.rgb[i + 2]!] as const; };
const blueMean = (img: Img, x0 = 0, y0 = 0, x1 = img.w, y1 = img.h) => { let t = 0, n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t += img.rgb[(y * img.w + x) * 3 + 2]!; n++; } return t / n; };
const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; } const mse = s / a.length; return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse); };
const diffStats = (a: Buffer, b: Buffer) => { let max = 0, sum = 0, n = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]! - b[i]!); if (d) n++; if (d > max) max = d; sum += d; } return { identical: a.length === b.length && n === 0, differingValues: n, maxDifference: max, meanDifference: Number((sum / Math.max(1, a.length)).toFixed(4)) }; };
/** Share of pixels (any channel differs). */
const pixelsDiffer = (a: Img, b: Img) => { let n = 0; for (let i = 0; i < a.rgb.length; i += 3) if (a.rgb[i] !== b.rgb[i] || a.rgb[i + 1] !== b.rgb[i + 1] || a.rgb[i + 2] !== b.rgb[i + 2]) n++; return n / (a.w * a.h); };
const toLinear = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]: readonly [number, number, number]) => 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
const hex = ([r, g, b]: readonly [number, number, number]) => `0x${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

const ROWS = TRANSITIONS as readonly TransitionDef[];
/** The 18 transitions the trend pack added (registry order after the 51 legacy ones). */
const NEW_IDS = ['punch-in', 'punch-out', 'blur-dissolve', 'split-open-h', 'split-open-v', 'shape-heart', 'shape-star', 'block-left', 'block-right', 'slices-h', 'slices-v', 'film-burn', 'light-leak', 'ink-bleed', 'brush-left', 'brush-right', 'page-turn-left', 'page-turn-right'] as const;
const rowOf = (id: string) => ROWS.find((t) => t.id === id)!;
const NEW_CANVAS = NEW_IDS.filter((id) => !rowOf(id).gpu);
const SHAPES_WH = [[360, 640], [640, 360]] as const;
/** Frames 60..88 are the 29-frame transition; 61, 74 and 87 are early, the middle and late. */
const N = 29, FIRST = 60;

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  // ---------- fixtures ----------
  const barcode = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_8s.mp4'), frames: 240 });
  const png = (name: string, w: number, h: number, raw: Buffer) => { const file = path.join(art, name); ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${w}x${h}`, '-i', 'pipe:0', '-frames:v', '1', '-y', file], raw); return file; };
  /** The gpu-proof blue fixture: red = column, green = row, blue 0 (outgoing) or 255 (incoming). */
  const bluePng = (w: number, h: number, blue: number) => { const raw = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = Math.round((255 * x) / (w - 1)); raw[i + 1] = Math.round((255 * y) / (h - 1)); raw[i + 2] = blue; } return png(`blue-${w}x${h}-${blue}.png`, w, h, raw); };
  const flatPng = (name: string, c: readonly [number, number, number], w = 640, h = 360) => { const raw = Buffer.alloc(w * h * 3); for (let i = 0; i < w * h; i++) { raw[i * 3] = c[0]; raw[i * 3 + 1] = c[1]; raw[i * 3 + 2] = c[2]; } return png(name, w, h, raw); };
  // two pictures of equal luminance and different hue (neither a saturated red): the blue-green one is scaled to the warm one's luminance
  const warm = [196, 116, 64] as const, Lw = luminance(warm);
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (luminance([Math.round(40 * m * 2), Math.round(150 * m * 2), Math.round(210 * m * 2)].map((v) => Math.min(255, v)) as unknown as [number, number, number]) < Lw) lo = m; else hi = m; }
  const cool = [40, 150, 210].map((v) => Math.min(255, Math.round(v * hi * 2))) as unknown as [number, number, number];
  const PICS = {
    'dark/bright': [flatPng('dark.png', [16, 16, 18]), flatPng('bright.png', [232, 232, 228])],
    'equal luminance': [flatPng('warm.png', warm), flatPng('cool.png', cool)],
  } as const;
  measurements.flashPictures = { 'dark/bright': ['0x101012', '0xe8e8e4'], 'equal luminance': [hex(warm), hex(cool)], luminance: { warm: Number(Lw.toFixed(4)), cool: Number(luminance(cool).toFixed(4)) } };
  const song = path.join(art, 'tone.wav');
  ff(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-y', song]);

  // as gpu-proof: the render host finds a launch mode that gives a graphics device, if this machine has one (GPU ids that
  // cannot render here are listed as such, never counted as passing)
  const hadGpuMode = process.env.PF_RENDER_GPU;
  delete process.env.PF_RENDER_GPU;
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txRaw = (pid: string, ops: unknown[]) => call(`/projects/${pid}/transactions`, { ops });
  const tx = async (pid: string, ops: unknown[]) => { const r = await txRaw(pid, ops); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  const newProject = async (name: string, w = 640, hgt = 360) => (await call('/projects', { name, width: w, height: hgt })).body.project.id as string;
  const docOf = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const clipOf = (d: ProjectDocument, id: string) => Object.values(d.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).find((c) => c.id === id) as MediaClip;
  /** A still as PNG, or the worker's refusal. */
  const stillPng = async (pid: string, index: number): Promise<{ png: Buffer } | { refused: string }> => {
    const r = await call(`/projects/${pid}/frame?index=${index}`);
    if (r.status === 200 && Buffer.isBuffer(r.body)) return { png: r.body };
    return { refused: `${r.status} ${r.body?.error?.code ?? 'unknown'}: ${String(r.body?.error?.message ?? '').slice(0, 160)}` };
  };
  const still = async (pid: string, index: number, w: number, hgt: number): Promise<Img> => { const r = await stillPng(pid, index); if ('refused' in r) throw new Error(`still ${index}: ${r.refused}`); return pngToImg(r.png, w, hgt); };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  let outputs = 0;
  /** Export [start, end) at high quality and decode it. */
  const exportFrames = async (pid: string, start: number, end: number, w: number, hgt: number, pixFmt: 'rgb24' | 'rgba' = 'rgb24') => {
    const job = await waitJob((await call(`/projects/${pid}/exports`, { range: { startFrame: start, endFrame: end }, quality: 'high' })).body.jobId);
    if (job.status !== 'succeeded') return { job, frames: [] as Buffer[] };
    const file = path.join(art, `out-${++outputs}.mp4`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', pixFmt, '-']);
    const fb = w * hgt * (pixFmt === 'rgba' ? 4 : 3);
    return { job, frames: Array.from({ length: Math.floor(raw.length / fb) }, (_, i) => raw.subarray(i * fb, (i + 1) * fb)) };
  };
  /** The blue fixture project of one shape: outgoing picture at 0–60, incoming at 60–120. */
  const blueProject = async (w: number, hgt: number) => {
    const pid = await newProject(`blue ${w}x${hgt}`, w, hgt);
    const aOut = await upload(pid, bluePng(w, hgt, 0)), aIn = await upload(pid, bluePng(w, hgt, 255));
    await tx(pid, [{ op: 'add_clip', args: { assetId: aOut, start: f(0), duration: f(60) } }]);
    const inClip = (await tx(pid, [{ op: 'add_clip', args: { assetId: aIn, start: f(60), duration: f(60) } }])).results[0].output.clipId as string;
    return { pid, inClip, w, h: hgt };
  };
  type Blue = Awaited<ReturnType<typeof blueProject>>;
  const setTr = (b: { pid: string; inClip: string }, type: string | null, frames = N, options: Record<string, unknown> = {}) =>
    tx(b.pid, [{ op: 'set_transition', args: { clipId: b.inClip, type, frames } }, ...(type && Object.keys(options).length ? [{ op: 'set_transition_options', args: { clipId: b.inClip, ...options } }] : [])]);
  /** Stills of the whole window 60..88 (null with the reason when the worker refuses, as for a GPU id without an adapter). */
  const windowStills = async (b: Blue): Promise<{ frames: Img[] } | { refused: string }> => {
    const frames: Img[] = [];
    for (let k = FIRST; k < FIRST + N; k++) { const r = await stillPng(b.pid, k); if ('refused' in r) return { refused: r.refused }; frames.push(pngToImg(r.png, b.w, b.h)); }
    return { frames };
  };

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] });
    const blue: Record<string, Blue> = {};
    for (const [w, hgt] of SHAPES_WH) blue[`${w}x${hgt}`] = await blueProject(w, hgt);
    const wide = blue['640x360']!;

    // ---------------------------------------------------------------- T1
    console.log('\n# T1 catalogue and middle frames');
    {
      const cat = (await call('/catalog')).body;
      const trs: any[] = cat.transitions ?? [];
      const listed = NEW_IDS.map((id) => trs.find((t) => t.id === id));
      const ok = trs.length === 69 && trs.every((t) => (TRANSITION_CATEGORIES as readonly string[]).includes(t.category) && Array.isArray(t.options) && Array.isArray(t.accepts?.velocity) && t.accepts?.sync?.[0] === 'beat')
        && listed.every((t, i) => t && t.category === rowOf(NEW_IDS[i]!).category && JSON.stringify(t.options) === JSON.stringify(rowOf(NEW_IDS[i]!).options));
      check('T1 /catalog lists 69 transitions, each with its category and options (and what it accepts: sync beat, velocity 2|3|4)', ok, { count: trs.length, newIds: listed.map((t, i) => (t ? `${t.id}:${t.category}:${(t.options as string[]).join('+') || '-'}` : `${NEW_IDS[i]} MISSING`)) });
      await setTr(wide, null);
      const sideA = await still(wide.pid, 59, wide.w, wide.h), sideB = await still(wide.pid, 89, wide.w, wide.h);
      const rows: Record<string, string> = {};
      let allDiffer = true;
      for (const id of NEW_IDS) {
        await setTr(wide, id);
        const r = await stillPng(wide.pid, 74);
        if ('refused' in r) { rows[id] = `cannot render here (${r.refused})`; if (!rowOf(id).gpu) allDiffer = false; continue; }
        const mid = pngToImg(r.png, wide.w, wide.h);
        const differs = !mid.rgb.equals(sideA.rgb) && !mid.rgb.equals(sideB.rgb);
        if (!differs) allDiffer = false;
        rows[id] = differs ? 'differs from both sides' : 'SAME AS A SIDE';
      }
      measurements.middleFrames = rows;
      check('T1 every new id\'s middle frame (74) differs from the outgoing (59) and the incoming (89) picture (a GPU id the render worker cannot run here is listed, not counted)', allDiffer, rows);
    }

    // ---------------------------------------------------------------- T2 + T3 (single-crossing ids, both shapes)
    console.log('\n# T2 single-crossing ids: the incoming share never falls; T3 geometry');
    const singles = NEW_IDS.filter((id) => rowOf(id).singleCrossing);
    const mids: Record<string, Img> = {};
    {
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const id of singles) for (const [w, hgt] of SHAPES_WH) {
        const b = blue[`${w}x${hgt}`]!, key = `${id} ${w}x${hgt}`;
        await setTr(b, id);
        const r = await windowStills(b);
        if ('refused' in r) { rows[key] = `cannot render here (${r.refused})`; if (!rowOf(id).gpu) ok = false; continue; }
        const fr = r.frames;
        mids[key] = fr[74 - FIRST]!;
        let worst = 0;
        for (let k = 1; k < fr.length; k++) {
          let lost = 0;
          for (let i = 2; i < fr[k]!.rgb.length; i += 3) if (fr[k - 1]!.rgb[i]! - fr[k]!.rgb[i]! > 6) lost++;
          worst = Math.max(worst, lost / (w * hgt));
        }
        const b61 = blueMean(fr[61 - FIRST]!), b87 = blueMean(fr[87 - FIRST]!);
        if (GPU_TRANSITIONS[id]?.kernel === 'page') {
          // Page turn repaints the outgoing side (the back of the page: 25 % toward white, shaded by the curl), so blue is not
          // the incoming share there. A pixel shows the incoming picture when blue >= 128: the page is never above 64, the
          // incoming picture under the curl's shadow never below 191 (gpu.ts `page`).
          const px = w * hgt, toward = GPU_TRANSITIONS[id]!.v[0] < 0 ? 'left' : 'right';
          let wentBack = 0, lostWhileIncoming = 0, between = 0, pageLoss = 0, offModel = 0;
          for (let k = 0; k < fr.length; k++) {
            const edge = pageFold(transitionProgress(k, N, null)).edge;
            let back = 0, lost = 0, mid = 0, off = 0;
            for (let i = 2, n = 0; i < fr[k]!.rgb.length; i += 3, n++) {
              const now = fr[k]!.rgb[i]!, incoming = now >= 128;
              if (now > 65 && now < 190) mid++;
              // s: the distance from the edge the page is turned toward, at the pixel's centre (gpu.ts pageFold)
              const u = ((n % w) + 0.5) / w, sAt = toward === 'left' ? u : 1 - u;
              if (incoming !== sAt > edge) off++;
              if (k === 0) continue;
              const was = fr[k - 1]!.rgb[i]!;
              if (was >= 128 && !incoming) back++;
              else if (was >= 128 && was - now > 6) lost++;
              else if (was < 128 && !incoming && was - now > pageLoss) pageLoss = was - now;
            }
            wentBack = Math.max(wentBack, back / px); lostWhileIncoming = Math.max(lostWhileIncoming, lost / px); between = Math.max(between, mid / px); offModel = Math.max(offModel, off / px);
          }
          const good = wentBack <= 0.001 && lostWhileIncoming <= 0.001 && between <= 0.001 && pageLoss <= 20 && offModel <= 0.005 && b61 < 70 && b87 > 185;
          if (!good) ok = false;
          rows[key] = {
            shareGoingBackFromIncoming: Number(wentBack.toFixed(5)), shareLosingBlueWhileIncoming: Number(lostWhileIncoming.toFixed(5)), shareBetweenPageAndIncoming: Number(between.toFixed(5)),
            largestBlueLossOnThePage: pageLoss, shareOffTheModelEdge: Number(offModel.toFixed(5)), shareLosingBlueOnThePagesBack: Number(worst.toFixed(5)),
            blueMean61: Number(b61.toFixed(1)), blueMean87: Number(b87.toFixed(1)), ok: good,
          };
          continue;
        }
        const good = worst <= 0.001 && b61 < 70 && b87 > 185;
        if (!good) ok = false;
        rows[key] = { worstShareLosingBlue: Number(worst.toFixed(5)), blueMean61: Number(b61.toFixed(1)), blueMean87: Number(b87.toFixed(1)), ok: good };
      }
      measurements.singleCrossing = rows;
      const bad = Object.fromEntries(Object.entries(rows).filter(([, r]) => typeof r === 'string' || !(r as { ok: boolean }).ok));
      check(`T2 ${singles.length} single-crossing ids at 360×640 and 640×360, frames 60..88: at most 0.1 % of pixels lose more than 6/255 of blue between frames (page turn, whose page shows its whitened, shaded back: at most 0.1 % go back from the incoming picture, blue >= 128, to the page or lose blue while incoming, the page loses at most 20/255, and the incoming region is s > pageFold(p).edge); blue mean < 70 on frame 61 and > 185 on frame 87`, ok, { notOk: bad, ...rows });
    }
    {
      const p74 = transitionProgress(74 - FIRST, N, null);
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const name of ['heart', 'star'] as const) for (const [w, hgt] of SHAPES_WH) {
        const img = mids[`shape-${name} ${w}x${hgt}`];
        if (!img) { ok = false; rows[`${name} ${w}x${hgt}`] = 'no middle frame'; continue; }
        const centre = blueMean(img, w / 2 - 2, hgt / 2 - 2, w / 2 + 3, hgt / 2 + 3);
        const corners = [[0, 0], [w - 3, 0], [0, hgt - 3], [w - 3, hgt - 3]].map(([x, y]) => blueMean(img, x!, y!, x! + 3, y! + 3));
        let notch: number | null = null;
        if (name === 'heart') {
          // three shape units above the notch, between the lobes (outside the heart: canvasTransitions.test.ts)
          const sc = shapeScale('heart', p74, w, hgt), [nx, ny] = SHAPES.heart.notch!;
          const x = Math.round(w / 2 + sc * nx), y = Math.round(hgt / 2 + sc * (ny - 3));
          notch = blueMean(img, x - 1, y - 1, x + 2, y + 2);
        }
        const good = centre > 200 && corners.every((c) => c < 55) && (notch === null || notch < 55);
        if (!good) ok = false;
        rows[`${name} ${w}x${hgt}`] = { centre: Number(centre.toFixed(1)), corners: corners.map((c) => Number(c.toFixed(1))), ...(notch !== null ? { aboveNotch: Number(notch.toFixed(1)) } : {}), ok: good };
      }
      for (const [w, hgt] of SHAPES_WH) {
        const img = mids[`split-open-h ${w}x${hgt}`];
        if (!img) { ok = false; continue; }
        const col = (x: number) => blueMean(img, x, 0, x + 1, hgt);
        const centre = col(Math.floor(w / 2)), left = col(2), right = col(w - 3);
        const good = centre > 200 && left < 55 && right < 55;
        if (!good) ok = false;
        rows[`split-open-h ${w}x${hgt}`] = { centreColumn: Number(centre.toFixed(1)), x2: Number(left.toFixed(1)), [`x${w - 3}`]: Number(right.toFixed(1)), ok: good };
      }
      measurements.geometry = rows;
      check(`T3 heart and star at the middle frame (p = ${p74}): centre blue > 200, the 4 corners < 55, above the heart's notch < 55; split-open-h: centre column incoming, x = 2 and x = W−3 outgoing`, ok, rows);
    }
    {
      // colour blocks: the switch frame (74 for 29 frames) is all block colour; frame 88 has none of it
      const colours = blockColors(rowOf('block-left').defaults!.color!).map((c) => c.slice(4, -1).split(',').map(Number));
      const nearBlock = (img: Img) => { let n = 0; for (let i = 0; i < img.rgb.length; i += 3) if (colours.some((c) => Math.abs(img.rgb[i]! - c[0]!) <= 2 && Math.abs(img.rgb[i + 1]! - c[1]!) <= 2 && Math.abs(img.rgb[i + 2]! - c[2]!) <= 2)) n++; return n / (img.w * img.h); };
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const id of ['block-left', 'block-right']) for (const [w, hgt] of SHAPES_WH) {
        const b = blue[`${w}x${hgt}`]!;
        await setTr(b, id);
        const sw = await still(b.pid, 74, w, hgt), end = await still(b.pid, 88, w, hgt), before = await still(b.pid, 70, w, hgt);
        const share = { switchFrame: Number(nearBlock(sw).toFixed(4)), frame88: Number(nearBlock(end).toFixed(4)), frame70: Number(nearBlock(before).toFixed(4)) };
        // the model: on frame 70 the bars have entered from the side the id names (a bar's blue is 120…200; the outgoing
        // picture's is 0), and the far side still shows the outgoing picture
        const spans = blockSpans(transitionProgress(70 - FIRST, N, null), 70 - FIRST, N);
        const lead = Math.max(...spans.map(([, l]) => l)), near = Math.round(id === 'block-left' ? w * (1 - lead / 2) : (w * lead) / 2), far = id === 'block-left' ? 2 : w - 3;
        const barBlue = blueMean(before, near, 0, near + 1, hgt), farBlue = blueMean(before, far, 0, far + 1, hgt);
        const entered = barBlue >= 100 && barBlue <= 210 && farBlue < 20;
        const good = share.switchFrame >= 0.995 && share.frame88 <= 0.005 && entered;
        if (!good) ok = false;
        rows[`${id} ${w}x${hgt}`] = { ...share, barEnteredFromItsSide: entered, frame70: { barColumnBlue: Number(barBlue.toFixed(1)), farColumnBlue: Number(farBlue.toFixed(1)) }, ok: good };
      }
      measurements.blocks = rows;
      check('T3 block-left/right: on the switch frame (74) at least 99.5 % of the pixels are within ±2 of a block colour, on frame 88 at most 0.5 %; the bars enter from the side the id names', ok, rows);
    }
    {
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const id of ['slices-h', 'slices-v']) {
        await setTr(wide, id, N, { seed: 1 });
        const one = await still(wide.pid, 74, wide.w, wide.h), again = await still(wide.pid, 74, wide.w, wide.h);
        await setTr(wide, id, N, { seed: 2 });
        const two = await still(wide.pid, 74, wide.w, wide.h);
        const share = pixelsDiffer(one, two), same = one.rgb.equals(again.rgb);
        if (!(same && share >= 0.1)) ok = false;
        rows[id] = { sameSeedIdentical: same, seeds1and2Differ: Number(share.toFixed(4)) };
      }
      await tx(wide.pid, [{ op: 'set_transition_options', args: { clipId: wide.inClip, seed: null } }]);
      measurements.slicesSeeds = rows;
      check('T3 slices: the same seed renders identically twice; seeds 1 and 2 differ in at least 10 % of the pixels (middle frame)', ok, rows);
    }
    {
      await setTr(wide, 'blur-dissolve');
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const k of [61, 74, 87]) {
        const img = await still(wide.pid, k, wide.w, wide.h);
        const p = transitionProgress(k - FIRST, N, null), m = blueMean(img, wide.w / 2 - 40, wide.h / 2 - 40, wide.w / 2 + 40, wide.h / 2 + 40);
        if (Math.abs(m - 255 * p) > 3) ok = false;
        rows[k] = { p: Number(p.toFixed(5)), expected: Number((255 * p).toFixed(2)), centreBlueMean: Number(m.toFixed(2)) };
      }
      measurements.blurDissolve = rows;
      check('T3 blur-dissolve: the blue mean of the centre region is 255·p ± 3 on frames 61, 74 and 87', ok, rows);
    }

    // ---------------------------------------------------------------- T4
    console.log('\n# T4 beat lock');
    {
      const songId = await upload(wide.pid, song);
      await tx(wide.pid, [{ op: 'add_clip', args: { assetId: songId, start: f(0) } }]);
      const setBeats = (frames: number[]) => tx(wide.pid, [{ op: 'edit_analysis', args: { assetId: songId, kind: 'beats', replace: frames.map(f) } }]);
      /** The blue mean of every frame of the window. */
      const means = async () => { const m: number[] = []; for (let k = FIRST; k < FIRST + N; k++) m.push(blueMean(await still(wide.pid, k, wide.w, wide.h))); return m; };
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const id of ['punch-in', 'dissolve']) {
        await setTr(wide, id, N, { sync: 'beat' });
        const cases: Record<string, unknown> = {};
        for (const [label, beats, want] of [['70, 75, 80', [70, 75, 80], 75], ['moved +1', [71, 76, 81], 76], ['moved +2 (a tie)', [72, 77, 82], 72]] as const) {
          await setBeats([...beats]);
          const d = await docOf(wide.pid), k = beatSwitchFrame(d, clipOf(d, wide.inClip));
          const m = await means();
          let good: boolean, seen: Record<string, unknown>;
          if (id === 'punch-in') {
            // a hard switch: the outgoing picture (blue 0) until the beat frame, the incoming one (blue 255) from it on
            const first = m.findIndex((x) => x >= 127);
            good = first >= 0 && FIRST + first === want;
            seen = { firstFrameWithBlueMeanAtLeast127: first >= 0 ? FIRST + first : null };
          } else {
            // a dissolve is 127.4 on the frame before the beat and 127.6 on it, which 8-bit pixels cannot tell apart; so the whole
            // locked curve is checked instead: every frame within ±1.5 of 255·p(l, k), which fixes k (a lock one frame off moves
            // the middle frames by about 7), and far from the unlocked curve somewhere
            const locked = m.map((x, l) => Math.abs(x - 255 * transitionProgress(l, N, want - FIRST)));
            const unlocked = m.map((x, l) => Math.abs(x - 255 * transitionProgress(l, N, null)));
            good = Math.max(...locked) <= 1.5 && Math.max(...unlocked) > 3;
            seen = { worstDistanceFromLockedCurve: Number(Math.max(...locked).toFixed(2)), mostFromUnlockedCurve: Number(Math.max(...unlocked).toFixed(2)) };
          }
          good = good && k !== null && FIRST + k === want;
          if (!good) ok = false;
          cases[label] = { model: k === null ? null : FIRST + k, want, ...seen, ok: good };
        }
        // no beats: sync on draws exactly what sync off draws
        await setBeats([]);
        const on: string[] = [];
        for (let k = FIRST; k < FIRST + N; k++) { const r = await stillPng(wide.pid, k); on.push('png' in r ? sha(pngToImg(r.png, wide.w, wide.h).rgb) : 'refused'); }
        await tx(wide.pid, [{ op: 'set_transition_options', args: { clipId: wide.inClip, sync: null } }]);
        const off: string[] = [];
        for (let k = FIRST; k < FIRST + N; k++) { const r = await stillPng(wide.pid, k); off.push('png' in r ? sha(pngToImg(r.png, wide.w, wide.h).rgb) : 'refused'); }
        const identical = on.every((x, i) => x === off[i] && x !== 'refused');
        if (!identical) ok = false;
        cases['no beats: sync on = sync off'] = identical;
        rows[id] = cases;
      }
      measurements.beatLock = rows;
      check('T4 beat lock with beats set by edit_analysis: the switch is on frame 75 for beats at 70/75/80, 76 when they move +1, 72 when they move +2 (72 and 77 tie, the earlier wins: the done_when\'s 77 contradicts the contract\'s tie rule), as beatSwitchFrame says — punch-in: the first frame with blue mean ≥ 127; dissolve: every frame on the locked curve (±1.5); with no beats sync on is SHA-identical to sync off', ok, rows);
    }

    // ---------------------------------------------------------------- T5
    console.log('\n# T5 velocity ramp on the frame barcode');
    {
      const W = 640, H = 360;
      const vp = await newProject('velocity', W, H);
      const asset = await upload(vp, barcode.file);
      // A shows source 0..59 at frames 0..59 (180 frames after it), B source 100.. at 60.. (100 frames before it)
      const r0 = await tx(vp, [{ op: 'add_clip', args: { assetId: asset, start: f(0), sourceIn: f(0), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: asset, start: f(60), sourceIn: f(100), duration: f(60), withLinkedAudio: false } }]);
      const B = r0.results[1].output.clipId as string;
      const stripY = Math.round((H * BARCODE.stripFrac) / 2);
      const cellX = (i: number) => Math.round(((i + 0.5) * W) / BARCODE.bits);
      const bitOf = (index: number, i: number) => (index >> (BARCODE.bits - 1 - i)) & 1;
      const readBits = (rgb: Buffer, channels: number) => Array.from({ length: BARCODE.bits }, (_, i) => { const o = (stripY * W + cellX(i)) * channels; return (rgb[o]! + rgb[o + 1]! + rgb[o + 2]!) / 3 > 128 ? 1 : 0; });
      /** For frame l of the transition: which side each barcode cell shows, by the wipe's edge, leaving a margin of 12 px. */
      const sideOf = (type: string, n: number, l: number, x: number): 'out' | 'in' | null => {
        const p = transitionProgress(l, n, null), m = 12;
        if (type === 'wipe-left') { const e = W * (1 - p); return x < e - m ? 'out' : x > e + m ? 'in' : null; }
        const e = W * p; return x < e - m ? 'in' : x > e + m ? 'out' : null; // wipe-right reveals from the left edge
      };
      const verify = (type: string, n: number, v: number, l: number, bits: number[]) => {
        const o = velocityOffsets(n, v, l), want = { out: 60 + l + o.out, in: 100 + l - o.in };
        let errors = 0, seen = { out: 0, in: 0 };
        for (let i = 0; i < BARCODE.bits; i++) { const side = sideOf(type, n, l, cellX(i)); if (!side) continue; seen[side]++; if (bits[i] !== bitOf(want[side], i)) errors++; }
        return { errors, seen, want };
      };
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const type of ['wipe-left', 'wipe-right']) for (const n of [15, 29]) for (const v of [2, 3, 4] as const) {
        await tx(vp, [{ op: 'set_transition', args: { clipId: B, type, frames: n } }, { op: 'set_transition_options', args: { clipId: B, velocity: v } }]);
        let stillErrors = 0, stillCells = 0, lsbOf = { out: 0, in: 0 };
        for (let l = 0; l < n; l++) {
          const img = await still(vp, 60 + l, W, H);
          const r = verify(type, n, v, l, readBits(img.rgb, 3));
          if (r.errors) stillErrors++;
          stillCells += r.seen.out + r.seen.in;
          const lsb = sideOf(type, n, l, cellX(BARCODE.bits - 1));
          if (lsb) lsbOf[lsb]++;
        }
        const exp = await exportFrames(vp, 60, 60 + n, W, H);
        let exportErrors = exp.frames.length === n ? 0 : n;
        exp.frames.forEach((fr, l) => { if (verify(type, n, v, l, readBits(fr, 3)).errors) exportErrors++; });
        const good = stillErrors === 0 && exportErrors === 0 && exp.job.status === 'succeeded';
        if (!good) ok = false;
        rows[`${type} n=${n} ×${v}`] = { stillFramesWithErrors: stillErrors, exportFramesWithErrors: exportErrors, cellsRead: stillCells, lowestBitReadOn: lsbOf, needs: velocityNeeds(n, v), export: exp.job.status };
      }
      measurements.velocity = rows;
      check('T5 velocity ×2/×3/×4 at n = 15 and 29: in the regions the wipe gives each side, the outgoing picture shows its frame end + l + out(l) and the incoming one sourceIn + l − in(l): 0 frames with an error, on stills and on a server export (wipe-left reads the incoming side\'s lowest bits, wipe-right the outgoing side\'s)', ok, rows);

      // refusals: the handle after A decides the largest velocity at n = 15 (22, 29 and 36 frames for ×2, ×3, ×4)
      const refusals: Record<string, unknown> = {};
      let rok = true;
      for (const [handle, maxV] of [[21, 1], [22, 2], [28, 2], [29, 3], [35, 3], [36, 4]] as const) {
        const rp = await newProject(`handle ${handle}`, W, H);
        const ra = await upload(rp, barcode.file);
        const total = T.frameIndexAt((await docOf(rp)).assets[ra]!.duration, R); // whole frames of the file as the server measured it
        const rr = await tx(rp, [{ op: 'add_clip', args: { assetId: ra, start: f(0), sourceIn: f(total - 60 - handle), duration: f(60), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: ra, start: f(60), sourceIn: f(100), duration: f(60), withLinkedAudio: false } }]);
        const rb = rr.results[1].output.clipId as string;
        await tx(rp, [{ op: 'set_transition', args: { clipId: rb, type: 'dissolve', frames: 15 } }]);
        const tried: Record<string, unknown> = {};
        for (const v of [2, 3, 4]) {
          const r = await txRaw(rp, [{ op: 'set_transition_options', args: { clipId: rb, velocity: v } }]);
          const accepted = r.status === 200;
          const good = accepted === v <= maxV && (accepted || (r.body?.error?.code === 'out_of_bounds' && r.body?.error?.details?.maxVelocity === maxV));
          if (!good) rok = false;
          tried[`×${v}`] = accepted ? 'accepted' : { code: r.body?.error?.code, maxVelocity: r.body?.error?.details?.maxVelocity };
          if (accepted) await tx(rp, [{ op: 'set_transition_options', args: { clipId: rb, velocity: null } }]);
        }
        refusals[`${handle} frames after the previous clip`] = { expectedMaxVelocity: maxV, ...tried };
      }
      measurements.velocityRefusals = refusals;
      check('T5 refusals at n = 15: with 22, 29 and 36 frames of handle ×2, ×3 and ×4 are accepted; one frame less, the next velocity is refused (out_of_bounds) with maxVelocity one lower', rok, refusals);
    }

    // ---------------------------------------------------------------- T6
    console.log('\n# T6 flash check of exports at the defaults');
    {
      /** Six (or `count`) back-to-back clips of `len` frames alternating two pictures, a transition of `type` on each cut. */
      const flashRun = async (type: string, pics: readonly [string, string], len = 30, count = 6, frames?: number) => {
        const pid = await newProject(`flash ${type}`, 640, 360);
        const ids = [await upload(pid, pics[0]), await upload(pid, pics[1])];
        const clips: string[] = [];
        for (let i = 0; i < count; i++) clips.push((await tx(pid, [{ op: 'add_clip', args: { assetId: ids[i % 2], start: f(i * len), duration: f(len) } }])).results[0].output.clipId as string);
        const set = await txRaw(pid, clips.slice(1).map((clipId) => ({ op: 'set_transition', args: { clipId, type, ...(frames ? { frames } : {}) } })));
        if (set.status !== 200) return { refused: `set_transition: ${JSON.stringify(set.body?.error ?? set.body).slice(0, 200)}` };
        const exp = await exportFrames(pid, 0, len * count, 640, 360, 'rgba');
        if (exp.job.status !== 'succeeded') return { refused: `export ${exp.job.status}: ${JSON.stringify(exp.job.error).slice(0, 200)}` };
        const fa = new FlashAnalyser(30);
        for (const fr of exp.frames) fa.push(flashCells(fr, 640, 360));
        const rep = fa.report();
        return { frames: rep.frames, verdict: rep.verdict, ranges: rep.ranges, server: exp.job.output?.photosensitivity?.verdict ?? null };
      };
      const rows: Record<string, unknown> = {};
      let canvasOk = true, gpuOk = true;
      for (const id of NEW_IDS) for (const [label, pics] of Object.entries(PICS)) {
        const r = await flashRun(id, pics as unknown as readonly [string, string]);
        rows[`${id} ${label}`] = r;
        const passed = 'verdict' in r && r.verdict === 'pass' && r.frames === 180;
        if (!rowOf(id).gpu && !passed) canvasOk = false;
        if (rowOf(id).gpu && 'verdict' in r && !passed) gpuOk = false; // a GPU id that rendered must pass too; one that cannot render here is listed
      }
      measurements.flash = rows;
      check(`T6 FlashAnalyser on a server export of each new Canvas2D transition at its defaults (six back-to-back 1 s clips, dark/bright and equal-luminance pictures): verdict pass`, canvasOk, Object.fromEntries(Object.entries(rows).filter(([k]) => NEW_CANVAS.some((id) => k.startsWith(`${id} `)))));
      check('T6 the same for the new GPU transitions where the render worker could run them (the rest are listed as not rendered here, not as passing)', gpuOk, Object.fromEntries(Object.entries(rows).filter(([k]) => !NEW_CANVAS.some((id) => k.startsWith(`${id} `)))));
      // cover transitions between very short clips: recorded, not a gate (like dip, ADR-0011:80; the preflight cadence warning is wave 2)
      const short: Record<string, unknown> = {};
      for (const id of ['block-left', 'block-right', 'dip-black']) short[id] = await flashRun(id, PICS['dark/bright'] as unknown as readonly [string, string], 4, 15, 4);
      measurements.flashShortClips = { note: 'fifteen 4-frame clips (dark/bright) with a 4-frame transition on every cut; a measurement, not a gate', ...short };
      check('T6 recorded (not a gate): the colour blocks and dip-black between 4-frame dark/bright clips', Object.values(short).every((r: any) => 'verdict' in r), measurements.flashShortClips);
    }

    // ---------------------------------------------------------------- T7
    console.log('\n# T7 preview, still and export agree');
    {
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const previewAt = async (p: Page, frame: number, from: number | null): Promise<Buffer | null> => {
        if (from === null) {
          const ruler = (await p.getByTestId('ruler').boundingBox())!;
          await p.mouse.click(ruler.x + 3, ruler.y + 5); // the keys go to the editor (this moves the playhead too: Home follows)
          await p.keyboard.press('Home');
          from = 0;
        }
        for (let i = from; i < frame; i++) { await p.keyboard.press('ArrowRight'); await sleep(30); }
        await p.waitForFunction((n) => { const c = document.querySelector('canvas[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(n) && c.dataset.quality === 'full'; }, frame, { timeout: 30_000 });
        await sleep(400);
        const b64: string = await p.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!;
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          const out = new Uint8Array((d.length / 4) * 3);
          for (let i = 0, k = 0; i < d.length; i += 4) { out[k++] = d[i]!; out[k++] = d[i + 1]!; out[k++] = d[i + 2]!; }
          let s2 = ''; for (let i = 0; i < out.length; i += 0x8000) s2 += String.fromCharCode(...out.subarray(i, i + 0x8000));
          return `${c.width}x${c.height}:${btoa(s2)}`;
        });
        const [size, data] = b64.split(':');
        return size === `${wide.w}x${wide.h}` ? Buffer.from(data ?? '', 'base64') : null;
      };
      const rows: Record<string, unknown> = {};
      let ok = true;
      for (const id of ['punch-in', 'shape-heart', 'blur-dissolve', 'slices-h']) {
        await setTr(wide, id);
        await page.goto(`${s.ownerUrl}&project=${wide.pid}`);
        await page.locator('.clip').first().waitFor();
        await page.waitForFunction(() => Number(document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') ?? -1) >= 0, undefined, { timeout: 30_000 });
        const agree: Record<string, unknown> = {};
        let last: number | null = null;
        for (const k of [70, 74, 78]) {
          const prev = await previewAt(page, k, last);
          last = k;
          const st = await still(wide.pid, k, wide.w, wide.h);
          const d = prev ? diffStats(prev, st.rgb) : null;
          if (!d?.identical) ok = false;
          agree[k] = d ?? 'preview canvas of another size';
        }
        const exp = await exportFrames(wide.pid, 60, 89, wide.w, wide.h);
        let minPsnr = Infinity;
        for (const k of [61, 66, 70, 74, 78, 82, 87]) minPsnr = Math.min(minPsnr, exp.frames[k - 60] ? psnr(exp.frames[k - 60]!, (await still(wide.pid, k, wide.w, wide.h)).rgb) : 0);
        if (!(exp.job.status === 'succeeded' && minPsnr >= 40)) ok = false;
        rows[id] = { previewVsStill: agree, exportMinPsnrDb: Number(minPsnr.toFixed(2)) };
      }
      await page.close();
      measurements.agreement = rows;
      check('T7 punch-in, shape-heart, blur-dissolve and slices-h: the paused editor preview is byte-identical to the still (frames 70, 74, 78) and the export reaches PSNR ≥ 40 dB against the stills; no page errors', ok && errors.length === 0, { ...rows, pageErrors: errors.slice(0, 3) });
    }

    // ---------------------------------------------------------------- T8
    console.log('\n# T8 cost at 1080×1920 (recorded)');
    {
      const lab = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      const labErrors: string[] = [];
      lab.on('pageerror', (e) => labErrors.push(String(e)));
      await lab.goto(`${s.url}/lab.html?bench=transitions&ids=${[...NEW_CANVAS, 'dissolve'].join(',')}`);
      await lab.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 600_000 });
      const bench = await lab.evaluate(() => (window as unknown as { __pfLabBench?: unknown }).__pfLabBench ?? null) as { size: string; frames: number; raster: string; results: Record<string, { medianMs: number; meanMs: number; maxMs: number }> } | null;
      await lab.close();
      const base = bench?.results.none?.medianMs ?? null;
      const over = bench ? Object.entries(bench.results).filter(([id, r]) => id !== 'none' && r.medianMs > 60).map(([id, r]) => `${id}: ${r.medianMs} ms`) : [];
      measurements.cost = { ...(bench ?? { error: 'no bench result' }), noTransitionMedianMs: base, over60ms: over, note: 'Lab page in the proof\'s headless Chromium, one run on this machine; median of the 29 frames of a 29-frame transition; recorded, not a target', pageErrors: labErrors.slice(0, 3) };
      check(`T8 recorded (not a gate): median ms per frame at 1080×1920 for each new Canvas2D id${over.length ? `; over 60 ms: ${over.join(', ')}` : '; none over 60 ms'}`, !!bench && labErrors.length === 0, measurements.cost);
    }
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser?.close().catch(() => {});
    await s.close();
    if (hadGpuMode === undefined) delete process.env.PF_RENDER_GPU; else process.env.PF_RENDER_GPU = hadGpuMode;
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
      result: failed.length || checks.length === 0 ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, node: process.version },
      scope: 'Trend-pack transitions (ADR-0012) on synthetic fixtures: the blue two-picture fixture at 640x360 and 360x640, a frame-barcode video, flat pictures for the flash check; server stills and exports, the paused editor preview, the Lab bench. The GPU ids count only where this machine\'s render worker could run them, and count as verified only after the owner\'s hardware run (ADR-0011:85). Not covered: real footage, a hardware graphics adapter, playback frame rate in the editor.',
      measurements, checks,
    };
    fs.mkdirSync(path.dirname(evidence), { recursive: true });
    fs.writeFileSync(evidence, JSON.stringify(report, null, 1) + '\n');
    console.log(`\ntrend transitions proof ${report.result}: ${report.passed}/${report.total} -> ${path.relative(root, evidence)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
