/**
 * proof:living, part «engine» (W2: checks 1–7, 9, 12, 17, 19 of living-proof.ts LIVING_CHECKS). The lead's entry point starts the
 * server and a Chromium launched with --enable-unsafe-webgpu, exits 2 when that browser gives no adapter (gpu-proof.ts:62-77), and
 * calls `runLivingEngine(ctx)`; it deletes `ctx.art` at the end. Everything here is a measurement against core and the JavaScript
 * model of the pass (livingModel); nothing says how anything looks. One sample per timing, and every timing is said to be one.
 *
 * Fixtures are synthetic, made here with ffmpeg from raw bytes: the coordinate photo 640×360 (R = x mod 256, G = y mod 256,
 * B = 64·⌊x/256⌋): the source position each output pixel came from is decoded without ambiguity, since every displacement is under
 * 128 px; pixels within 2 px of a wrap column (or row) are skipped. Depths: a hand disc (base flat, one near dab of size 300 at the
 * centre) and a ramp (horizon 400). Project 640×360 at 30 fps, the photo on LIVING_ENGINE_FIXTURE.frames (271: the shortest clip a slide at amount 1 fits).
 *
 * Needs W1 (set_living_picture and core depthGrid): until LIVING_BUILT is true the part reports every check as not run (blocked),
 * never as a pass.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import * as T from '@pulseframe/time';
import { depthGrid, fitScale, LIVING_BUILT, LIVING_MAX_SHIFT, livingMaxAmount, type ClipDepth, type ProjectDocument } from '@pulseframe/core';
import { evaluate, livingModel, livingParams, type ImageLayer } from '@pulseframe/engine';

export interface LivingEngineCtx {
  /** The running server (startServer): `url`, `ownerUrl` (the editor with the owner's session) and the agent token. */
  url: string; ownerUrl: string; agentToken: string;
  /** Chromium launched with --enable-unsafe-webgpu (the entry point has already seen it give an adapter). */
  browser: Browser;
  /** A folder for this part's fixtures; the entry point deletes it. */
  art: string;
  check(id: number, name: string, ok: boolean, detail?: unknown): void;
}
export const LIVING_PROOF_ENGINE = { built: true as boolean, checks: [1, 2, 3, 4, 5, 6, 7, 9, 12, 17, 19] as const };

const W = 640, H = 360, FPS = { num: 30, den: 1 };
/**
 * The clip length: the shortest (from 90 frames up) on which a slide at amount 1 with ease-in-out fits the comfort rule of thumb
 * (core livingMaxAmount; set_living_picture refuses a faster move, verifier C1): 271 frames at 30 fps. The sampled frames are the
 * middle, the last and the quarters of the clip (the plan's 45, 89 and 0/22/45/67/89 on its 90-frame clip).
 */
const FRAMES = (() => { let n = 90; while (livingMaxAmount(n, FPS, 'slide', 'ease-in-out') < 1) n++; return n; })();
const MID = Math.round((FRAMES - 1) / 2), LAST = FRAMES - 1, QUARTERS = [0, 1, 2, 3, 4].map((k) => Math.round((k * (FRAMES - 1)) / 4));
export const LIVING_ENGINE_FIXTURE = { frames: FRAMES, fps: FPS, sample: { mid: MID, last: LAST, quarters: QUARTERS } } as const;
const DISC: ClipDepth = { v: 1, base: { kind: 'flat' }, strokes: [{ layer: 'near', size: 300, pts: [500, 500] }] };
const RAMP: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 400 }, strokes: [] };
const A_PX = (amount: number) => amount * LIVING_MAX_SHIFT * H; // the largest relative shift in frame px (3% of the height at amount 1)
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const pngToRgb = (png: Buffer): Buffer => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; } const mse = s / a.length; return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse); };

/** The coordinate photo, raw rgb24 → PNG with ffmpeg. */
function coordinatePhoto(file: string) {
  const raw = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = x % 256; raw[i + 1] = y % 256; raw[i + 2] = 64 * Math.floor(x / 256); }
  ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', file], raw);
}
/**
 * The photo position (px, continuous) an rgb24 pixel shows, unwrapped near `near` (the model's prediction); null near a wrap: where
 * the model puts the source within 2 px of a wrap column or row (x or y a multiple of 256), whose sample blends both sides, or where
 * the colour itself is at a wrap.
 */
export function decode(img: Buffer, x: number, y: number, near: [number, number]): [number, number] | null {
  const i = (y * W + x) * 3, r = img[i]!, g = img[i + 1]!, b = img[i + 2]!;
  const sx = r + 256 * Math.round(b / 64), sy = g + 256 * Math.round((near[1] - g) / 256);
  const wrapDist = (v: number) => { const m = ((v % 256) + 256) % 256; return Math.min(m, 256 - m); };
  if (r < 2 || r > 253 || g < 2 || g > 253 || wrapDist(near[0]) < 2 || wrapDist(near[1]) < 2) return null;
  return [sx, sy];
}

/** One decoded pixel of a row: the photo x it shows, its place at rest (no move) and the nearness 0..1 at that photo point; null = outside the picture. */
export type LivingBandPixel = { got: number; rest: number; near: number } | null;
/**
 * The longest run of band pixels in a row, and how many band pixels show a source inside the near shape (nearness > 0.5). A band pixel
 * shows a source more than 1 px from where its own nearness puts it (rest + (f − n)·d, d the signed full shift in px): the far side
 * stretched across the gap the near shape leaves. A pixel outside the picture ends a run.
 */
export function livingBand(row: readonly LivingBandPixel[], d: number, f: number): { longest: number; fromInside: number } {
  let run = 0, longest = 0, fromInside = 0;
  for (const p of row) {
    if (!p) { run = 0; continue; }
    const band = Math.abs(p.got - (p.rest + (f - p.near) * d)) > 1;
    run = band ? run + 1 : 0; longest = Math.max(longest, run);
    if (band && p.near > 0.5) fromInside++;
  }
  return { longest, fromInside };
}
/** Nearness 0..1 at photo pixel (sx, sy) of a w×h photo: bilinear over the grid's texel centres, edges clamped (as the pass reads it). */
export function nearBilinear(grid: { width: number; height: number; data: Uint8Array }, sx: number, sy: number, w: number, h: number): number {
  const gx = Math.min(grid.width - 1, Math.max(0, ((sx + 0.5) / w) * grid.width - 0.5)), gy = Math.min(grid.height - 1, Math.max(0, ((sy + 0.5) / h) * grid.height - 0.5));
  const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(grid.width - 1, x0 + 1), y1 = Math.min(grid.height - 1, y0 + 1), tx = gx - x0, ty = gy - y0;
  const v = (x: number, y: number) => grid.data[y * grid.width + x]! / 255;
  return (v(x0, y0) * (1 - tx) + v(x1, y0) * tx) * (1 - ty) + (v(x0, y1) * (1 - tx) + v(x1, y1) * tx) * ty;
}

export async function runLivingEngine(ctx: LivingEngineCtx): Promise<void> {
  const ids = LIVING_PROOF_ENGINE.checks;
  if (!LIVING_BUILT) { for (const id of ids) ctx.check(id, 'not run: set_living_picture and depthGrid are not built in this build (W1)', false, { blocked: true }); return; }
  const h = { authorization: `Bearer ${ctx.agentToken}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${ctx.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const still = async (pid: string, index: number, q = '') => { const r = await call(`/projects/${pid}/frame?index=${index}${q}`); if (r.status !== 200) throw Object.assign(new Error(`still failed: ${String(r.body?.error?.message ?? r.body).slice(0, 300)}`), { response: r }); return pngToRgb(r.body); };
  const docOf = async (pid: string) => (await call(`/projects/${pid}`)).body.project as ProjectDocument;
  const photoFile = path.join(ctx.art, 'coord.png');
  coordinatePhoto(photoFile);
  const newPhotoProject = async (name: string) => {
    const pid = (await call('/projects', { name, width: W, height: H, frameRate: FPS })).body.project.id as string;
    const assetId = ((await (await fetch(`${ctx.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'coord.png' }, body: fs.readFileSync(photoFile) })).json()) as any).assetId as string;
    const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1), duration: T.frameTime(FRAMES, FPS) } }])).results[0].output.clipId as string;
    return { pid, clipId };
  };
  const living = async (pid: string, clipId: string, args: Record<string, unknown>) => (await tx(pid, [{ op: 'set_living_picture', args: { clipId, ...args } }])).results[0].output as { effectId: string };
  /** What the pass is given at a frame, computed in Node from the stored document exactly as the compositor computes it. */
  const modelAt = (doc: ProjectDocument, frame: number, out = { width: W, height: H }) => {
    const g = evaluate(doc, T.frameTime(frame, doc.settings.frameRate));
    const layer = g.layers.find((l) => l.kind === 'image') as ImageLayer;
    const fit = fitScale(out.width, out.height, layer.sourceWidth, layer.sourceHeight, g.fit);
    const box = { cx: out.width / 2 + layer.transform.x * out.width, cy: out.height / 2 + layer.transform.y * out.height, w: layer.sourceWidth * fit, h: layer.sourceHeight * fit, rotation: layer.transform.rotation, scale: layer.transform.scale };
    const grid = depthGrid(layer.depth!, { width: layer.sourceWidth, height: layer.sourceHeight });
    const fx = layer.effects!.find((e) => e.type === 'depth.living')!;
    const numbers = livingParams(fx.params, { width: out.width, height: out.height, box, depth: { key: 'depth:proof', width: grid.width, height: grid.height, data: new Uint8Array(0) } });
    /** The photo px the model says output pixel (x, y) shows (through the box), or null outside the picture. */
    const source = (x: number, y: number): [number, number] | null => {
      const m = livingModel([(x + 0.5) / out.width, (y + 0.5) / out.height], numbers, grid);
      if (!m) return null;
      const lx = m[0] * out.width, ly = m[1] * out.height; // layer px (continuous)
      return [(lx - (box.cx - (box.w * box.scale) / 2)) / box.scale / fit - 0.5, (ly - (box.cy - (box.h * box.scale) / 2)) / box.scale / fit - 0.5];
    };
    const nearAt = (sx: number, sy: number) => grid.data[Math.min(grid.height - 1, Math.max(0, Math.floor((sy / layer.sourceHeight) * grid.height))) * grid.width + Math.min(grid.width - 1, Math.max(0, Math.floor((sx / layer.sourceWidth) * grid.width)))]!;
    return { numbers, grid, box, source, nearAt, travel: Number(fx.params.travel) };
  };
  /** Within ⌈A⌉ + 2 px of a depth edge (C14 e): the nearness around the photo point is not flat. */
  const nearEdge = (m: ReturnType<typeof modelAt>, sx: number, sy: number, amount: number) => {
    const r = Math.ceil(A_PX(amount)) + 2; let lo = 255, hi = 0;
    for (let dy = -r; dy <= r; dy += 2) for (let dx = -r; dx <= r; dx += 2) { const v = m.nearAt(sx + dx, sy + dy); lo = Math.min(lo, v); hi = Math.max(hi, v); }
    return hi - lo > 8;
  };
  const compare = (img: Buffer, m: ReturnType<typeof modelAt>, pts: [number, number][], amount: number, skipEdges: boolean) => {
    let n = 0, ok = 0, max = 0, skipped = 0; const worst: unknown[] = [];
    for (const [x, y] of pts) {
      const want = m.source(x, y); if (!want) { skipped++; continue; }
      if (skipEdges && nearEdge(m, want[0], want[1], amount)) { skipped++; continue; }
      const got = decode(img, x, y, want); if (!got) { skipped++; continue; }
      const e = Math.max(Math.abs(got[0] - want[0]), Math.abs(got[1] - want[1]));
      n++; if (e <= 1) ok++; max = Math.max(max, e); if (e > 1 && worst.length < 4) worst.push({ x, y, got, want: want.map((v) => Number(v.toFixed(2))) });
    }
    return { compared: n, within1px: ok, maxPx: Number(max.toFixed(2)), skipped, worst };
  };

  // ---------- 1 and 3: slide, amount 1, the still at the last frame (disc) ----------
  const disc = await newPhotoProject('living-disc');
  const fxDisc = await living(disc.pid, disc.clipId, { depth: DISC, move: 'slide', amount: 1, curve: 'ease-in-out' });
  const docDisc = await docOf(disc.pid);
  const last = await still(disc.pid, FRAMES - 1);
  const mLast = modelAt(docDisc, FRAMES - 1);
  {
    const inside: [number, number][] = [], outside: [number, number][] = [];
    for (let y = 8; y < H - 8; y += 4) for (let x = 8; x < W - 8; x += 4) { const s = mLast.source(x, y); if (!s) continue; const v = mLast.nearAt(s[0], s[1]); if (v === 255) inside.push([x, y]); else if (v === 0) outside.push([x, y]); }
    const a = compare(last, mLast, outside, 1, true), b = compare(last, mLast, inside, 1, true);
    ctx.check(1, `slide, amount 1, the still at the last frame (${LAST}): pixels well outside the disc (m = −f) and well inside it (m = 1 − f) decode to livingModel's source within 1 px`, a.compared > 500 && b.compared > 50 && a.within1px === a.compared && b.within1px === b.compared, { outside: a, inside: b, travel: mLast.travel, numbers: mLast.numbers });
  }
  {
    // the middle row across the disc: a band pixel shows a source whose own nearness does not explain its shift (the far side
    // stretched across the gap); a pixel on the disc's soft edge (DEPTH_FALLOFF, half the radius wide) moved by its own nearness is
    // not one. The nearness at the source is read bilinearly, as the pass reads it.
    const A = A_PX(1), y = H / 2; let transparent = 0;
    const lastPng = (await call(`/projects/${disc.pid}/frame?index=${FRAMES - 1}`)).body as Buffer;
    const rgba = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], lastPng);
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] === 0) transparent++;
    const S = mLast.numbers[11]!, cv = (mLast.numbers[4]! + mLast.numbers[6]!) / 2, d = mLast.numbers[8]! * W, f = mLast.numbers[9]!;
    const row: LivingBandPixel[] = [];
    for (let x = 0; x < W; x++) {
      const s = mLast.source(x, y); if (!s) { row.push(null); continue; }
      const got = decode(last, x, y, s); if (!got) continue;
      row.push({ got: got[0], rest: (cv + ((x + 0.5) / W - cv) / S) * W - 0.5, near: nearBilinear(mLast.grid, got[0], got[1], W, H) });
    }
    const { longest, fromInside: intoDisc } = livingBand(row, d, f);
    ctx.check(3, `the band beside the disc's trailing edge is at most ⌈A⌉ + 2 = ${Math.ceil(A) + 2} px wide, its pixels come from outside the disc, and no pixel of the picture is transparent`, longest <= Math.ceil(A) + 2 && intoDisc === 0 && transparent === 0, { longestBandPx: longest, bandPixelsFromInsideTheDisc: intoDisc, transparentPixels: transparent });
  }

  // ---------- 2: 300 random pixels at the middle frame; the ramp's rows ----------
  {
    const mid = await still(disc.pid, MID), m = modelAt(docDisc, MID);
    let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const pts: [number, number][] = Array.from({ length: 300 }, () => [Math.floor(rnd() * W), Math.floor(rnd() * H)]);
    const a = compare(mid, m, pts, 1, true);
    const ramp = await newPhotoProject('living-ramp');
    await living(ramp.pid, ramp.clipId, { depth: RAMP, move: 'slide', amount: 1 });
    const rampDoc = await docOf(ramp.pid), rLast = await still(ramp.pid, FRAMES - 1), mr = modelAt(rampDoc, FRAMES - 1);
    const rows: [number, number][] = []; for (let y = 4; y < H - 4; y += 6) for (const x of [100, 320, 540]) rows.push([x, y]);
    const b = compare(rLast, mr, rows, 1, false);
    // each row's shift against the far plane is proportional to its nearness (y − h)/(1 − h) below the horizon
    let worstRow = 0; const d = mr.numbers[8]! * W;
    for (let y = 8; y < H - 8; y += 8) {
      const s = mr.source(320, y); if (!s) continue; const got = decode(rLast, 320, y, s); if (!got) continue;
      const yc = (y + 0.5) / H * 1000, n = yc <= 400 ? 0 : (yc - 400) / 600;
      const S = mr.numbers[11]!, cv = (mr.numbers[4]! + mr.numbers[6]!) / 2, rest = (cv + (320.5 / W - cv) / S) * W - 0.5;
      worstRow = Math.max(worstRow, Math.abs((rest - got[0]) - (n - 0.5) * d));
    }
    ctx.check(2, `300 random pixels of the still at the middle frame (${MID}) decode to livingModel within 1 px (pixels near a depth edge skipped, C14 e); the ramp's rows follow livingModel and shift in proportion to (y − h)/(1 − h) within 1 px`, a.within1px === a.compared && a.compared >= 150 && b.within1px === b.compared && worstRow <= 1 + 1 / 255 * Math.abs(d), { random: a, ramp: b, worstRowPx: Number(worstRow.toFixed(2)) });
  }

  // ---------- 4: rotation ----------
  {
    const rot = await newPhotoProject('living-rotated');
    await tx(rot.pid, [{ op: 'set_clip_transform', args: { clipId: rot.clipId, transform: { rotation: 10 } } }]);
    const refused = await call(`/projects/${rot.pid}/transactions`, { ops: [{ op: 'set_living_picture', args: { clipId: rot.clipId, depth: DISC } }] });
    await tx(rot.pid, [{ op: 'set_clip_transform', args: { clipId: rot.clipId, transform: { rotation: 0 } } }]);
    await living(rot.pid, rot.clipId, { depth: DISC, move: 'slide', amount: 1 });
    await tx(rot.pid, [{ op: 'set_clip_transform', args: { clipId: rot.clipId, transform: { rotation: 10 } } }]);
    const after = await call(`/projects/${rot.pid}/frame?index=${MID}`);
    const text = JSON.stringify(after.body);
    ctx.check(4, 'a rotated photo: set_living_picture refuses living_rotated; a living picture rotated afterwards is refused as a still, naming the effect and the rotation (never drawn flat)', refused.status !== 200 && JSON.stringify(refused.body).includes('living_rotated') && after.status !== 200 && /depth\.living/.test(text) && /rotated/i.test(text), { refusal: refused.status, refusalWhy: refused.body?.error?.details?.why, still: after.status, stillMessage: text.slice(0, 300) });
  }

  // ---------- 5: disabled ----------
  {
    const plain = await newPhotoProject('living-plain');
    const ref = await still(plain.pid, MID);
    const off = await newPhotoProject('living-off');
    const o = await living(off.pid, off.clipId, { depth: DISC, move: 'slide', amount: 1 });
    await tx(off.pid, [{ op: 'update_effect', args: { clipId: off.clipId, effectId: o.effectId, enabled: false } }]);
    const got = await still(off.pid, MID);
    ctx.check(5, 'the living picture disabled: the still equals the still of the same photo without it, byte for byte', sha(got) === sha(ref), { equal: sha(got) === sha(ref) });
  }

  // ---------- 6 and 19 (preview part): the paused editor preview against render_frame ----------
  const page: Page = await ctx.browser.newPage({ viewport: { width: 1500, height: 950 } });
  const kPreview: number[] = [];
  try {
    await page.goto(`${ctx.ownerUrl}&project=${disc.pid}`);
    await page.locator('.clip').first().waitFor();
    const seek = async (frame: number) => {
      const rb = (await page.getByTestId('ruler').boundingBox())!;
      await page.mouse.click(rb.x + frame * 3 + 0.5, rb.y + rb.height / 2); // 90 px/s = 3 px a frame (keyframes-proof.ts)
      await page.waitForFunction((f0) => document.querySelector('[data-testid=playhead]')?.getAttribute('data-frame') === String(f0), frame, { timeout: 5000 }).catch(() => {});
    };
    const preview = async (): Promise<Buffer> => Buffer.from(await page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; const o: number[] = []; for (let i = 0; i < d.length; i += 4) o.push(d[i]!, d[i + 1]!, d[i + 2]!); return o; }));
    const rows: unknown[] = []; let same = true;
    for (const frame of [0, MID, LAST]) {
      await seek(frame);
      const ref = await still(disc.pid, frame);
      let got = await preview();
      for (let i = 0; i < 100 && sha(got) !== sha(ref); i++) { await new Promise((r) => setTimeout(r, 100)); got = await preview(); }
      let diff = 0; for (let i = 0; i < got.length; i++) if (got[i] !== ref[i]) diff++;
      rows.push({ frame, differingBytes: diff }); if (diff) same = false;
    }
    for (const nums of (await page.evaluate(() => (globalThis as { __pfLivingNumbers?: () => number[][] }).__pfLivingNumbers?.() ?? [])) as number[][]) kPreview.push(nums[10]!);
    ctx.check(6, `the paused editor preview equals render_frame byte for byte at frames 0, ${MID} and ${LAST}`, same, rows);
  } finally { await page.close(); }

  // ---------- 7: export ----------
  {
    const job0 = (await call(`/projects/${disc.pid}/exports`, {})).body.jobId as string;
    let job: any; const t0 = Date.now();
    for (;;) { job = (await call(`/jobs/${job0}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await new Promise((r) => setTimeout(r, 300)); }
    if (job.status !== 'succeeded') ctx.check(7, 'export (MP4) of the living picture', false, { status: job.status, error: job.error });
    else {
      const out = path.join(ctx.art, 'living.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
      const all = ff(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const frameBytes = W * H * 3, n = all.length / frameBytes;
      // the disc's centre (output pixel at the photo's centre at rest): its decoded source against the ease-in-out keys (livingModel)
      const centre: unknown[] = []; let worstCentre = 0;
      for (const f of QUARTERS) {
        const img = all.subarray(f * frameBytes, (f + 1) * frameBytes) as Buffer, m = modelAt(docDisc, f);
        const want = m.source(W / 2, H / 2)!, got = decode(img, W / 2, H / 2, want);
        const e = got ? Math.abs(got[0] - want[0]) : Infinity; worstCentre = Math.max(worstCentre, e); centre.push({ frame: f, travel: m.travel, got: got?.[0], want: Number(want[0].toFixed(2)) });
      }
      let worstPsnr = Infinity;
      for (let f = 0; f < n; f++) worstPsnr = Math.min(worstPsnr, psnr(all.subarray(f * frameBytes, (f + 1) * frameBytes) as Buffer, await still(disc.pid, f)));
      // for the reader only (not part of the pass condition): the same photo WITHOUT the effect, its first 30 frames exported the
      // same way, against its own stills — what the encoder alone costs on this coordinate photo
      const base = await newPhotoProject('living-export-baseline');
      const bj0 = (await call(`/projects/${base.pid}/exports`, { range: { startFrame: 0, endFrame: 30 } })).body.jobId as string | undefined;
      let baseline: unknown = null;
      if (bj0) {
        let bj: any; for (;;) { bj = (await call(`/jobs/${bj0}`)).body; if (['succeeded', 'failed', 'canceled'].includes(bj.status)) break; await new Promise((r) => setTimeout(r, 300)); }
        if (bj.status === 'succeeded') {
          const bout = path.join(ctx.art, 'baseline.mp4'); fs.writeFileSync(bout, (await call(`/jobs/${bj.id}/output`)).body);
          const ball = ff(['-i', bout, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const bn = ball.length / frameBytes; let bw = Infinity;
          for (let f = 0; f < bn; f++) bw = Math.min(bw, psnr(ball.subarray(f * frameBytes, (f + 1) * frameBytes) as Buffer, await still(base.pid, f)));
          const c0 = decode(ball.subarray(0, frameBytes) as Buffer, W / 2, H / 2, [W / 2 - 0.5, H / 2 - 0.5]);
          baseline = { frames: bn, worstPsnrDb: Number(bw.toFixed(2)), centreDecodedX: c0?.[0] ?? null, centreAtRestX: W / 2 - 0.5 };
        } else baseline = { status: bj.status };
      }
      ctx.check(7, `export (MP4): the disc's decoded centre at frames ${QUARTERS.join(', ')} follows the ease-in-out keys within 1.5 px; every exported frame within 36 dB PSNR of its still`, n === FRAMES && worstCentre <= 1.5 && worstPsnr >= 36, { frames: n, centre, worstCentrePx: Number(worstCentre.toFixed(2)), worstPsnrDb: Number(worstPsnr.toFixed(2)), exportSecondsOneSample: Math.round((Date.now() - t0) / 100) / 10, withoutTheEffectForReference: baseline });
    }
  }

  // ---------- 9 and 19 (render part): core in a Chromium page ----------
  {
    // the page runs the same core and engine sources, bundled here with esbuild (the editor's bundle exposes no module)
    const dir = path.join(ctx.art, 'page'); fs.mkdirSync(dir, { recursive: true });
    const entry = path.join(dir, 'entry.ts');
    const root = path.resolve(import.meta.dirname, '../../..');
    fs.writeFileSync(entry, `import { depthGrid } from '${root}/packages/core/src/index.ts';\nimport { livingParams } from '${root}/packages/engine/src/gpu.ts';\n(window as any).__grid = (d: any, w: number, h: number) => Array.from(depthGrid(d, { width: w, height: h }).data);\n(window as any).__params = livingParams;\n`);
    // esbuild is not a dependency of this package; it is the one tsx (which runs every proof) brings, pinned by the lockfile
    const esbuild = createRequire(createRequire(import.meta.url).resolve('tsx'))('esbuild') as { build(o: Record<string, unknown>): Promise<unknown> };
    await esbuild.build({ entryPoints: [entry], bundle: true, format: 'iife', outfile: path.join(dir, 'entry.js'), logLevel: 'error' });
    const p = await ctx.browser.newPage();
    try {
      await p.setContent('<!doctype html><meta charset="utf-8">');
      await p.addScriptTag({ path: path.join(dir, 'entry.js') });
      const rows = [] as unknown[]; let same = true;
      for (const [name, d] of [['hand disc', DISC], ['ramp', RAMP]] as const) {
        const inPage = sha(Uint8Array.from(await p.evaluate(([dd]) => (window as any).__grid(dd, 640, 360), [d] as const)));
        const inNode = sha(depthGrid(d, { width: W, height: H }).data);
        rows.push({ name, page: inPage.slice(0, 16), node: inNode.slice(0, 16) }); if (inPage !== inNode) same = false;
      }
      ctx.check(9, 'the page\'s depthGrid digest equals Node\'s for the hand disc and the ramp', same, rows);
      // 19: the step count of a still at 1280×720 and of the export at 640×360, from the numbers the pass would be sent there,
      // against what the paused preview at 640×360 sent (read back from the editor page above)
      const at = (out: { width: number; height: number }) => modelAt(docDisc, MID, out).numbers[10]!;
      const kStill = at({ width: 1280, height: 720 }), kExport = at({ width: W, height: H });
      ctx.check(19, 'C7: the pass\'s step count K is the same for the paused preview at 640×360 (read back from the editor page), a still at 1280×720 and the export at 640×360', kPreview.length > 0 && kPreview.every((k) => k === kStill && k === kExport), { preview: [...new Set(kPreview)], still1280: kStill, export640: kExport });
    } finally { await p.close(); }
  }

  // ---------- 12: the calm audience version ----------
  {
    const v = (await tx(disc.pid, [{ op: 'add_audience_version', args: { profile: 'calm' } }])).results[0].output.variantId as string;
    const master = await still(disc.pid, LAST), calm = await still(disc.pid, LAST, `&variant=${v}`);
    ctx.check(12, `the calm audience version: the still at the last frame (${LAST}) equals the master's (stir none, C12)`, sha(master) === sha(calm), { equal: sha(master) === sha(calm) });
  }

  // ---------- 17: Ken Burns scale 1.18 ----------
  {
    const kb = await newPhotoProject('living-kenburns');
    await tx(kb.pid, [{ op: 'set_clip_transform', args: { clipId: kb.clipId, transform: { scale: 1.18, x: 0.02, y: -0.01 } } }]);
    await living(kb.pid, kb.clipId, { depth: DISC, move: 'slide', amount: 1 });
    const kdoc = await docOf(kb.pid), img = await still(kb.pid, FRAMES - 1), m = modelAt(kdoc, FRAMES - 1);
    const edge: [number, number][] = []; const bw = Math.ceil(0.02 * W), bh = Math.ceil(0.02 * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x < bw || x >= W - bw || y < bh || y >= H - bh) if ((x + y) % 3 === 0) edge.push([x, y]);
    const c = compare(img, m, edge, 1, true);
    // every model sample point lies inside the frame: the photo point maps back to a frame pixel inside it
    const fit = m.box.w / W; let outsideFrame = 0;
    for (const [x, y] of edge) { const s = m.source(x, y); if (!s) continue; const fx0 = m.box.cx - (m.box.w * m.box.scale) / 2 + (s[0] + 0.5) * fit * m.box.scale, fy0 = m.box.cy - (m.box.h * m.box.scale) / 2 + (s[1] + 0.5) * fit * m.box.scale; if (fx0 < 0 || fx0 > W || fy0 < 0 || fy0 > H) outsideFrame++; }
    ctx.check(17, 'C2: a photo at scale 1.18 (larger than the frame): the outer 2% of rows and columns decode to livingModel\'s sources, all inside the frame (no edge smear)', c.within1px === c.compared && c.compared > 1000 && outsideFrame === 0, { ...c, modelPointsOutsideTheFrame: outsideFrame });
  }
  void fxDisc;
}
