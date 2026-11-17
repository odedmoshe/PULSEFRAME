/**
 * WebGPU effect passes (ADR-0008): the adapter check, two effects (chroma key, wave) checked by pixel in the editor preview,
 * in a still and in an export, agreement between those three, repeatability, and the refusals when no adapter is available.
 * Wave 1 of the visual effects (ADR-0011) adds the old-digicam and CRT looks, checked against their JavaScript models
 * (digicamTone, crtMap), the digicam noise ticks and a flash check of a digicam export, and the whip and spin transitions.
 * The trend pack (ADR-0012) brings the GPU transitions to 46; its own proof is `pnpm proof:trend-light`. Here the two light
 * transitions (film-burn, light-leak) are checked at their ends only, as the flash transition is, and then again with their
 * light held by the flash schedule (a strobe flash 4 frames before the light's start), where they must not go backwards.
 *
 *   pnpm build && pnpm proof:gpu
 * Exits 2 (blocked) when this machine's browser gives no WebGPU adapter even with WebGPU enabled.
 * Here that adapter is a software one: this proves the passes are correct, not that they are fast.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { beatPositionAt, identityLut, lutStrip, sampleLut, sampleStrip, serializeCube, type Lut3D, type ProjectDocument } from '@pulseframe/core';
import { crtMap, digicamTick, digicamTone, FlashAnalyser, flashCells, flashSchedule, hash32, motionAt, unit32 } from '@pulseframe/engine';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';
import { startServer } from '@pulseframe/server';
import { shuttleAt8 } from './shuttle-flash.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/gpu-proof');
const W = 360, H = 640;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
type Img = Buffer;
const px = (b: Img, x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 3; return [b[i]!, b[i + 1]!, b[i + 2]!]; };
const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]!) <= tol);
const meanDiff = (a: Img, b: Img) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return Number((s / a.length).toFixed(3)); };
const maxDiff = (a: Img, b: Img) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };
const pngToRgb = (png: Buffer): Img => ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png);
/** Horizontal centre of the bright pixels of one row (the white stripe), or null when the row has none. */
const stripeAt = (b: Img, y: number) => { let s = 0, n = 0; for (let x = 0; x < W; x++) { const v = px(b, x, y)[0]!; if (v > 128) { s += x; n++; } } return n ? s / n : null; };

async function previewRgb(page: Page): Promise<Img> {
  const b64: string = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array((d.length / 4) * 3);
    for (let i = 0, k = 0; i < d.length; i += 4) { out[k++] = d[i]!; out[k++] = d[i + 1]!; out[k++] = d[i + 2]!; }
    let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return `${c.width}x${c.height}:${btoa(s)}`;
  });
  const [size, data] = b64.split(':');
  if (size !== `${W}x${H}`) throw new Error(`preview canvas is ${size}, expected ${W}x${H}`);
  return Buffer.from(data!, 'base64');
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const GPU_ARGS = ['--enable-unsafe-webgpu'];
  // fixtures: a red square on a green screen; a white vertical stripe on black
  const green = path.join(art, 'green.png'), stripe = path.join(art, 'stripe.png');
  ff(['-f', 'lavfi', '-i', `color=c=0x00FF00:s=${W}x${H},drawbox=x=130:y=270:w=100:h=100:color=0xFF0000:t=fill`, '-frames:v', '1', '-y', green]);
  ff(['-f', 'lavfi', '-i', `color=c=black:s=${W}x${H},drawbox=x=170:y=0:w=20:h=${H}:color=white:t=fill`, '-frames:v', '1', '-y', stripe]);

  delete process.env.PF_RENDER_GPU; // unset: the render host itself finds a launch mode that gives a graphics device
  const s = await startServer({ port: 8861, dataDir: path.join(art, 'data') });
  // Is there an adapter at all on this machine? (WebGPU exists only on a secure origin, so this needs the running server.)
  {
    const b = await chromium.launch({ args: GPU_ARGS });
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
  const still = async (pid: string, index = 0) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw Object.assign(new Error('still failed'), { response: r }); return pngToRgb(r.body); };
  const waitJob = async (jobId: string) => { for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(200); } };
  const newProject = async (name: string, file: string) => {
    const pid = (await call('/projects', { name, width: W, height: H })).body.project.id as string;
    const assetId = await upload(pid, file);
    const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: T.rt(0, 1) } }])).results[0].output.clipId as string;
    return { pid, clipId };
  };
  const browser = await chromium.launch({ args: GPU_ARGS });
  const plain = await chromium.launch(); // a browser without WebGPU enabled, as an owner's browser without an adapter would be
  const measurements: Record<string, unknown> = {};
  try {
    // ---------- chroma key ----------
    const key = await newProject('key', green);
    const before = await still(key.pid);
    check('Fixture as imported: green background, red square in the middle', near(px(before, 20, 20), [0, 255, 0], 12) && near(px(before, 180, 320), [255, 0, 0], 12), { corner: px(before, 20, 20), centre: px(before, 180, 320) });
    const fxId = (await tx(key.pid, [{ op: 'add_effect', args: { clipId: key.clipId, type: 'key.chroma' } }])).results[0].output.effectId as string;
    const keyed = await still(key.pid);
    check('key.chroma (still): the green background is gone (the black project background shows) and the red square is untouched', near(px(keyed, 20, 20), [0, 0, 0], 6) && near(px(keyed, 340, 620), [0, 0, 0], 6) && near(px(keyed, 180, 320), [255, 0, 0], 12), { corner: px(keyed, 20, 20), centre: px(keyed, 180, 320) });
    const again = await still(key.pid);
    check('The same still rendered twice is identical', maxDiff(keyed, again) === 0, { maxDifference: maxDiff(keyed, again) });
    await tx(key.pid, [{ op: 'update_effect', args: { clipId: key.clipId, effectId: fxId, params: { color: '#FF0000' } } }]);
    const keyedRed = await still(key.pid);
    check('key.chroma follows its parameters: keying red instead removes the square and keeps the green', near(px(keyedRed, 180, 320), [0, 0, 0], 6) && px(keyedRed, 20, 20)[1]! > 150, { corner: px(keyedRed, 20, 20), centre: px(keyedRed, 180, 320) });
    await tx(key.pid, [{ op: 'update_effect', args: { clipId: key.clipId, effectId: fxId, params: { color: '#00FF00' } } }]);

    // preview in the editor
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${key.pid}`);
    await page.locator('.clip').first().waitFor();
    let prev: Img = await previewRgb(page);
    // wait for the picture to be decoded and the adapter check to finish: the square is there and the green is gone
    for (let i = 0; i < 150 && !(near(px(prev, 20, 20), [0, 0, 0], 6) && px(prev, 180, 320)[0]! > 200); i++) { await sleep(100); prev = await previewRgb(page); }
    check('key.chroma (editor preview): same result on the preview canvas', near(px(prev, 20, 20), [0, 0, 0], 6) && near(px(prev, 180, 320), [255, 0, 0], 12), { corner: px(prev, 20, 20), centre: px(prev, 180, 320) });
    measurements.previewVsStill = { meanDifference: meanDiff(prev, keyed), maxDifference: maxDiff(prev, keyed) };
    check('Preview and still agree (mean difference under 0.5 of 255)', meanDiff(prev, keyed) < 0.5, measurements.previewVsStill);

    // export
    const job = await waitJob((await call(`/projects/${key.pid}/exports`, {})).body.jobId);
    if (job.status !== 'succeeded') check('key.chroma (export)', false, { status: job.status, error: job.error });
    else {
      const out = path.join(art, 'key.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
      const exp = ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      check('key.chroma (export): the exported frame shows the same (within video compression)', near(px(exp, 20, 20), [0, 0, 0], 12) && px(exp, 180, 320)[0]! > 200 && px(exp, 180, 320)[1]! < 40, { corner: px(exp, 20, 20), centre: px(exp, 180, 320), meanDifferenceFromStill: meanDiff(exp, keyed) });
    }

    // ---------- wave ----------
    const wave = await newProject('wave', stripe);
    const flat = await still(wave.pid);
    const amplitude = 0.05, wavelength = 0.5;
    await tx(wave.pid, [{ op: 'add_effect', args: { clipId: wave.clipId, type: 'distort.wave', params: { amplitude, wavelength, phase: 0, direction: 'horizontal' } } }]);
    const bent = await still(wave.pid);
    // A pixel at row y shows the source at x + amplitude*H*sin(2*pi*y/(wavelength*H)), so the stripe appears shifted the other way.
    const rows = [40, 80, 160, 240, 320, 400, 480, 560, 600];
    const expected = (y: number) => 179.5 - amplitude * H * Math.sin((2 * Math.PI * ((y + 0.5) / H)) / wavelength);
    const got = rows.map((y) => ({ y, measured: stripeAt(bent, y), expected: Number(expected(y).toFixed(2)) }));
    check('distort.wave: before the effect the stripe is straight', rows.every((y) => Math.abs(stripeAt(flat, y)! - 179.5) < 0.6), { centre: stripeAt(flat, 320) });
    check('distort.wave: each row of the stripe is displaced by the sine the parameters describe (within 1 pixel)', got.every((g) => g.measured !== null && Math.abs(g.measured - g.expected) <= 1), got);
    // the wave travels: half a second later, at 0.5 waves per second, it has moved a quarter of a wave (90 degrees)
    const later = await still(wave.pid, 15);
    const expectedAt = (y: number, turns: number) => 179.5 - amplitude * H * Math.sin((2 * Math.PI * ((y + 0.5) / H)) / wavelength + 2 * Math.PI * turns);
    const moved = rows.map((y) => ({ y, measured: stripeAt(later, y), expected: Number(expectedAt(y, 0.25).toFixed(2)) }));
    check('distort.wave travels by itself: 0.5 s later the stripe is where a quarter-wave shift puts it (within 1 pixel), and that frame alone gives the same picture again', moved.every((g) => g.measured !== null && Math.abs(g.measured - g.expected) <= 1) && maxDiff(later, await still(wave.pid, 15)) === 0, moved);
    const waveFx = (await call(`/projects/${wave.pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === wave.clipId).effects[0].id as string;
    await tx(wave.pid, [{ op: 'update_effect', args: { clipId: wave.clipId, effectId: waveFx, params: { speed: 0 } } }]);
    check('distort.wave with speed 0 stays still', maxDiff(await still(wave.pid, 15), bent) === 0);
    await tx(wave.pid, [{ op: 'update_effect', args: { clipId: wave.clipId, effectId: waveFx, params: { speed: 0.5 } } }]);
    await page.goto(`${s.ownerUrl}&project=${wave.pid}`);
    await page.locator('.clip').first().waitFor();
    let wprev: Img = await previewRgb(page);
    for (let i = 0; i < 100 && Math.abs((stripeAt(wprev, 80) ?? 179.5) - expected(80)) > 1; i++) { await sleep(100); wprev = await previewRgb(page); }
    check('distort.wave: preview and still agree (mean difference under 0.5 of 255)', meanDiff(wprev, bent) < 0.5, { meanDifference: meanDiff(wprev, bent), maxDifference: maxDiff(wprev, bent) });
    check('No uncaught errors in the editor page', errors.length === 0, errors);

    // ---------- the distortion, blur, stylize and glitch passes, against their own formulas ----------
    // Fixture: red encodes the column and green the row of every pixel, so a still tells where each output pixel was taken from.
    const rampFile = path.join(art, 'ramp.png');
    const rampRaw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rampRaw[i] = Math.round((255 * x) / (W - 1)); rampRaw[i + 1] = Math.round((255 * y) / (H - 1)); rampRaw[i + 2] = 128; }
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', rampFile], rampRaw);
    const ramp = await newProject('ramp', rampFile);
    const plainRamp = await still(ramp.pid);
    const withEffect = async (type: string, params: Record<string, unknown>, index = 0) => {
      const id = (await tx(ramp.pid, [{ op: 'add_effect', args: { clipId: ramp.clipId, type, params } }])).results[0].output.effectId as string;
      const img = await still(ramp.pid, index);
      return { img, remove: () => tx(ramp.pid, [{ op: 'remove_effect', args: { clipId: ramp.clipId, effectId: id } }]), id };
    };
    /** Where output pixel (x, y) says it came from, in source pixels. */
    const from = (img: Img, x: number, y: number) => { const c = px(img, x, y); return { x: (c[0]! / 255) * (W - 1), y: (c[1]! / 255) * (H - 1) }; };
    const grid: [number, number][] = [];
    for (let y = 40; y < H; y += 80) for (let x = 30; x < W; x += 60) grid.push([x, y]);
    /** Largest distance, in source pixels, between where the still says pixels came from and where `map` says they should. */
    const worst = (img: Img, map: (u: number, v: number) => [number, number] | null) => {
      let m = 0, n = 0;
      for (const [x, y] of grid) {
        const at = map((x + 0.5) / W, (y + 0.5) / H);
        if (!at || at[0] < 0.01 || at[0] > 0.99 || at[1] < 0.01 || at[1] > 0.99) continue;
        const f = from(img, x, y);
        m = Math.max(m, Math.abs(f.x - (at[0] * W - 0.5)), Math.abs(f.y - (at[1] * H - 0.5))); n++;
      }
      return { worstPixels: Number(m.toFixed(2)), points: n };
    };
    const asp = W / H;
    check('Ramp fixture reads back as itself (the measuring stick: within 1.5 pixels)', worst(plainRamp, (u, v) => [u, v]).worstPixels < 1.5, worst(plainRamp, (u, v) => [u, v]));

    let fx = await withEffect('distort.bulge', { amount: 0.5, radius: 0.35, x: 0.5, y: 0.5 });
    let w1 = worst(fx.img, (u, v) => { const dx = (u - 0.5) * asp, dy = v - 0.5, k = Math.hypot(dx, dy) / 0.35; if (k >= 1) return [u, v]; const s = Math.pow(Math.max(k, 1e-5), 0.5); return [0.5 + (dx * s) / asp, 0.5 + dy * s]; });
    check('distort.bulge: every sampled pixel comes from where the formula says (within 2.5 pixels), and differs from the plain picture', w1.worstPixels < 2.5 && maxDiff(fx.img, plainRamp) > 20, w1);
    await fx.remove();

    fx = await withEffect('distort.swirl', { angle: 180, radius: 0.4, x: 0.5, y: 0.5 });
    w1 = worst(fx.img, (u, v) => { const dx = (u - 0.5) * asp, dy = v - 0.5, k = Math.hypot(dx, dy) / 0.4; if (k >= 1) return [u, v]; const t = Math.PI * (1 - k) * (1 - k); return [0.5 + (dx * Math.cos(t) - dy * Math.sin(t)) / asp, 0.5 + dx * Math.sin(t) + dy * Math.cos(t)]; });
    check('distort.swirl: matches its formula (within 2.5 pixels)', w1.worstPixels < 2.5 && maxDiff(fx.img, plainRamp) > 20, w1);
    await fx.remove();

    fx = await withEffect('distort.mirror', { keep: 'left' });
    w1 = worst(fx.img, (u, v) => [u > 0.5 ? 1 - u : u, v]);
    check('distort.mirror: the right half shows the left half mirrored (within 1.5 pixels)', w1.worstPixels < 1.5 && Math.abs(from(fx.img, 300, 320).x - 59) < 1.5, { ...w1, at300: from(fx.img, 300, 320).x });
    await fx.remove();

    fx = await withEffect('blur.zoom', { amount: 0.3, x: 0.5, y: 0.5 });
    // on a linear ramp the average of the 16 samples is the sample half-way along the streak
    w1 = worst(fx.img, (u, v) => [0.5 + (u - 0.5) * (1 - 0.15), 0.5 + (v - 0.5) * (1 - 0.15)]);
    check('blur.zoom: each pixel is the average along its streak toward the centre (within 2.5 pixels on a linear ramp)', w1.worstPixels < 2.5, w1);
    await fx.remove();

    fx = await withEffect('stylize.posterize', { levels: 4 });
    const seen = new Set<number>();
    for (let i = 0; i < fx.img.length; i += 3) { seen.add(fx.img[i]!); seen.add(fx.img[i + 1]!); }
    check('stylize.posterize with 4 levels leaves only four values per channel', [...seen].every((v) => [0, 85, 170, 255].some((l) => Math.abs(v - l) <= 1)) && seen.size >= 4, { values: [...seen].sort((a, b) => a - b).slice(0, 12) });
    await fx.remove();

    // glitch: the pattern is an integer hash, reproduced here
    const hash = (x: number) => { const v = (Math.imul(x >>> 0, 747796405) + 2891336453) >>> 0; const w2 = Math.imul(((v >>> ((v >>> 28) + 4)) ^ v) >>> 0, 277803737) >>> 0; return ((w2 >>> 22) ^ w2) >>> 0; };
    const unit = (x: number) => (x >>> 8) / 16777216;
    const G = { amount: 0.1, bands: 16, density: 0.5, seed: 3, speed: 10, split: 0 };
    fx = await withEffect('digital.glitch', G);
    const shiftOf = (band: number, tick: number) => { const key = (hash((Math.imul(band, 7919) + Math.imul(G.seed, 104729)) >>> 0) ^ hash(tick + 1)) >>> 0; return unit(key) < G.density ? (unit(hash(key)) - 0.5) * 2 * G.amount : 0; };
    let jumped = 0, worstG = 0, rowsMoved = 0;
    for (let band = 0; band < G.bands; band++) {
      const y = Math.round(((band + 0.5) / G.bands) * H), sh = shiftOf(band, 0);
      if (sh !== 0) jumped++;
      for (const x of [60, 150, 240]) {
        const u = ((x + 0.5) / W + sh + 1) % 1;
        if (u < 0.03 || u > 0.97) continue; // next to the wrap-around the sampler blends both ends
        worstG = Math.max(worstG, Math.abs(from(fx.img, x, y).x - (u * W - 0.5)));
      }
      rowsMoved = Math.max(rowsMoved, Math.abs(from(fx.img, 150, y).y - from(plainRamp, 150, y).y));
    }
    const g0again = await still(ramp.pid, 0), g15 = await still(ramp.pid, 15);
    check('digital.glitch: each band jumps sideways by exactly what the integer hash gives (within 1.5 pixels), some bands jump and some do not, rows never move up or down', worstG < 1.5 && jumped > 2 && jumped < G.bands - 2 && rowsMoved < 1.5, { worstPixels: Number(worstG.toFixed(2)), bandsThatJump: jumped, of: G.bands });
    check('digital.glitch: the same frame is identical when rendered again; half a second later the pattern is another one', maxDiff(fx.img, g0again) === 0 && maxDiff(fx.img, g15) > 20);
    await fx.remove();

    // ---------- second batch: lens, kaleidoscope, grade, looks ----------
    fx = await withEffect('distort.fisheye', { amount: 0.4 });
    w1 = worst(fx.img, (u, v) => { const dx = (u - 0.5) * asp, dy = v - 0.5, k = 1 + 0.4 * (dx * dx + dy * dy) * 2; return [0.5 + (dx * k) / asp, 0.5 + dy * k]; });
    check('distort.fisheye: matches its formula (within 2.5 pixels)', w1.worstPixels < 2.5 && maxDiff(fx.img, plainRamp) > 10, w1);
    await fx.remove();

    fx = await withEffect('distort.kaleidoscope', { segments: 6, angle: 0, x: 0.5, y: 0.5 });
    const fold = (z: number) => 1 - Math.abs((((z * 0.5 + 0.5) % 1) + 1) % 1 * 2 - 1);
    w1 = worst(fx.img, (u, v) => {
      const dx = (u - 0.5) * asp, dy = v - 0.5, wedge = (2 * Math.PI) / 6;
      let t = Math.atan2(dy, dx); t -= wedge * Math.floor(t / wedge);
      // next to a fold the sampler mixes both sides: leave those points out
      if (Math.min(t, Math.abs(t - wedge / 2), wedge - t) < 0.06) return null;
      if (t > wedge / 2) t = wedge - t;
      const r = Math.hypot(dx, dy);
      return [fold(0.5 + (r * Math.cos(t)) / asp), fold(0.5 + r * Math.sin(t))];
    });
    check('distort.kaleidoscope: every wedge shows the first half-wedge, mirrored (within 2.5 pixels away from the folds)', w1.worstPixels < 2.5 && w1.points > 15, w1);
    await fx.remove();

    fx = await withEffect('color.grade', { saturation: 0 });
    let grey = 0;
    for (const [x, y] of grid) { const c = px(fx.img, x, y), src = px(plainRamp, x, y); grey = Math.max(grey, Math.abs(c[0]! - c[1]!), Math.abs(c[1]! - c[2]!), Math.abs(c[0]! - (0.2126 * src[0]! + 0.7152 * src[1]! + 0.0722 * src[2]!))); }
    check('color.grade, saturation 0: every pixel is the grey of its own brightness (within 2 of 255)', grey <= 2, { worst: Number(grey.toFixed(2)) });
    await tx(ramp.pid, [{ op: 'update_effect', args: { clipId: ramp.clipId, effectId: fx.id, params: { saturation: 1, exposure: 1 } } }]);
    const bright = await still(ramp.pid);
    await tx(ramp.pid, [{ op: 'update_effect', args: { clipId: ramp.clipId, effectId: fx.id, params: { exposure: 0, temperature: 0.5 } } }]);
    const warm = await still(ramp.pid);
    const p0 = px(plainRamp, 90, 160), pb = px(bright, 90, 160), pw = px(warm, 90, 160);
    check('color.grade: one stop of exposure doubles the values; a warmer temperature raises red by a tenth and lowers blue by a tenth', near(pb, [p0[0]! * 2, p0[1]! * 2, 255], 3) && Math.abs(pw[0]! - p0[0]! * 1.1) <= 2 && Math.abs(pw[2]! - p0[2]! * 0.9) <= 2 && Math.abs(pw[1]! - p0[1]!) <= 1, { plain: p0, plusOneStop: pb, warm: pw });
    await fx.remove();

    const cat = (await call('/catalog')).body;
    const lookA = await tx(ramp.pid, [{ op: 'apply_look', args: { clipId: ramp.clipId, lookId: 'noir' } }]);
    const noir = await still(ramp.pid);
    const lookB = await tx(ramp.pid, [{ op: 'apply_look', args: { clipId: ramp.clipId, lookId: 'teal-orange' } }]);
    const teal = await still(ramp.pid);
    const fxList = (await call(`/projects/${ramp.pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === ramp.clipId).effects;
    const bad = await call(`/projects/${ramp.pid}/transactions`, { ops: [{ op: 'apply_look', args: { clipId: ramp.clipId, lookId: 'no-such-look' } }] });
    const isGrey = grid.every(([x, y]) => { const c = px(noir, x, y); return Math.abs(c[0]! - c[1]!) <= 1 && Math.abs(c[1]! - c[2]!) <= 1; });
    check('Colour looks: 40 are listed; applying one sets the clip\'s colour grade (noir is black and white), applying another replaces it instead of stacking, an unknown look is refused', cat.looks?.length === 40 && new Set(cat.looks.map((l: any) => l.id)).size === 40 && isGrey && maxDiff(noir, teal) > 20 && fxList.length === 1 && fxList[0].type === 'color.grade' && lookA.results[0].output.effectId === lookB.results[0].output.effectId && bad.status >= 400, { looks: cat.looks?.length, effectsOnClip: fxList.length, unknown: bad.status });
    await tx(ramp.pid, [{ op: 'remove_effect', args: { clipId: ramp.clipId, effectId: fxList[0].id } }]);

    fx = await withEffect('stylize.halftone', { spacing: 0.02, angle: 45 });
    const meanAround = (img: Img, x0: number, y0: number) => { let t = 0, k = 0; for (let y = y0; y < y0 + 60; y++) for (let x = x0; x < x0 + 60; x++) { const c = px(img, x, y); t += c[0]! + c[1]! + c[2]!; k += 3; } return t / k; };
    const paper = [...Array(W * H).keys()].filter((i) => fx.img[i * 3]! > 245 && fx.img[i * 3 + 1]! > 245 && fx.img[i * 3 + 2]! > 245).length / (W * H);
    check('stylize.halftone: white paper shows between the dots, the dark corner is darker than the bright corner, and the same frame is identical again', paper > 0.05 && paper < 0.95 && meanAround(fx.img, 10, 10) < meanAround(fx.img, 290, 570) - 20 && maxDiff(fx.img, await still(ramp.pid)) === 0, { paperShare: Number(paper.toFixed(3)), darkCorner: Math.round(meanAround(fx.img, 10, 10)), brightCorner: Math.round(meanAround(fx.img, 290, 570)) });
    await fx.remove();

    fx = await withEffect('stylize.vhs', { amount: 0, speed: 24, seed: 5 });
    const vhs0 = fx.img;
    await tx(ramp.pid, [{ op: 'update_effect', args: { clipId: ramp.clipId, effectId: fx.id, params: { amount: 0.6 } } }]);
    const vhsA = await still(ramp.pid, 0), vhsA2 = await still(ramp.pid, 0), vhsB = await still(ramp.pid, 15);
    check('stylize.vhs: at amount 0 the picture is unchanged; at 0.6 it changes, the same frame is identical again, and another frame has another pattern', maxDiff(vhs0, plainRamp) <= 1 && meanDiff(vhsA, plainRamp) > 1 && maxDiff(vhsA, vhsA2) === 0 && meanDiff(vhsA, vhsB) > 0.5, { amount0: maxDiff(vhs0, plainRamp), changed: meanDiff(vhsA, plainRamp), nextFrame: meanDiff(vhsA, vhsB) });
    await fx.remove();

    // ---------- on the stripe: blurs, glow, duotone, scanlines ----------
    const onStripe = async (type: string, params: Record<string, unknown>) => {
      const id = (await tx(wave.pid, [{ op: 'add_effect', args: { clipId: wave.clipId, type, params } }])).results[0].output.effectId as string;
      const img = await still(wave.pid, 0);
      await tx(wave.pid, [{ op: 'remove_effect', args: { clipId: wave.clipId, effectId: id } }]);
      return img;
    };
    await tx(wave.pid, [{ op: 'remove_effect', args: { clipId: wave.clipId, effectId: waveFx } }]);
    const sharp = await still(wave.pid, 0);
    const mb = await onStripe('blur.directional', { amount: 0.1, angle: 0 });
    const lit = (x: number) => { let k = 0; for (let i = 0; i < 17; i++) { const xs = x + 0.5 + 64 * (i / 16 - 0.5); if (xs >= 170 && xs < 190) k++; } return (255 * k) / 17; };
    const mbv = await onStripe('blur.directional', { amount: 0.1, angle: 90 });
    check('blur.directional: sideways, pixels near the stripe take the share of the 17 samples that fall on it; along the stripe, nothing changes', [150, 160, 180, 200, 215].every((x) => Math.abs(px(mb, x, 320)[0]! - lit(x)) <= 20) && px(mb, 100, 320)[0]! <= 1 && maxDiff(mbv, sharp) <= 2, { measured: [150, 160, 180, 200, 215].map((x) => px(mb, x, 320)[0]), expected: [150, 160, 180, 200, 215].map((x) => Math.round(lit(x))), alongStripe: maxDiff(mbv, sharp) });
    const ts = await onStripe('blur.tilt-shift', { position: 0.5, width: 0.2, amount: 0.05 });
    check('blur.tilt-shift: the band stays sharp, far rows are blurred', px(ts, 165, 320)[0]! === 0 && px(ts, 180, 320)[0]! >= 254 && px(ts, 165, 40)[0]! > 10 && px(ts, 180, 40)[0]! < 250, { bandOutside: px(ts, 165, 320)[0], bandInside: px(ts, 180, 320)[0], farOutside: px(ts, 165, 40)[0], farInside: px(ts, 180, 40)[0] });
    const gl = await onStripe('light.glow', { threshold: 0.7, radius: 0.05, amount: 1.5 });
    check('light.glow: light spills next to the bright stripe, not far from it, and the stripe itself stays', px(gl, 160, 320)[0]! > 10 && px(gl, 60, 320)[0]! <= 1 && px(gl, 180, 320)[0]! >= 254, { near: px(gl, 160, 320)[0], far: px(gl, 60, 320)[0], stripe: px(gl, 180, 320)[0] });
    const du = await onStripe('stylize.duotone', { dark: '#1B1464', light: '#FFD166', amount: 1 });
    check('stylize.duotone: black becomes the dark colour and white the light colour', near(px(du, 60, 320), [27, 20, 100], 2) && near(px(du, 180, 320), [255, 209, 102], 2), { black: px(du, 60, 320), white: px(du, 180, 320) });
    const sl = await onStripe('stylize.scanlines', { lines: 64, amount: 0.5 });
    check('stylize.scanlines: every other line of the 64 is darkened by the amount', px(sl, 180, 5)[0]! >= 254 && Math.abs(px(sl, 180, 15)[0]! - 127.5) <= 2 && px(sl, 180, 25)[0]! >= 254, { line0: px(sl, 180, 5)[0], line1: px(sl, 180, 15)[0], line2: px(sl, 180, 25)[0] });
    const sp = await onStripe('light.sparkle', { threshold: 0.8, length: 0.08, amount: 2 });
    check('light.sparkle: a streak reaches sideways from the bright stripe, fading with distance, and nothing appears far away', px(sp, 160, 320)[0]! > px(sp, 140, 320)[0]! && px(sp, 140, 320)[0]! > 0 && px(sp, 60, 320)[0]! <= 1 && px(sp, 180, 320)[0]! >= 254, { near: px(sp, 160, 320)[0], farther: px(sp, 140, 320)[0], far: px(sp, 60, 320)[0] });

    // ---------- movement and light that depend on time ----------
    // The motion effects are a transform computed in JavaScript (motionAt) and applied by one shader: the still must agree with those numbers.
    const xf = (m: { scale: number; rotation: number; dx: number; dy: number }) => (u: number, v: number): [number, number] => {
      const dx = (u - 0.5) * asp - m.dx, dy = v - 0.5 - m.dy;
      const rx = (dx * Math.cos(m.rotation) + dy * Math.sin(m.rotation)) / m.scale, ry = (-dx * Math.sin(m.rotation) + dy * Math.cos(m.rotation)) / m.scale;
      const fold2 = (z: number) => 1 - Math.abs((((z * 0.5 + 0.5) % 1) + 1) % 1 * 2 - 1);
      return [fold2(0.5 + rx / asp), fold2(0.5 + ry)];
    };
    const motions: [string, Record<string, unknown>][] = [['motion.shake', { amount: 0.03, speed: 8, seed: 4 }], ['motion.pulse', { amount: 0.2, bpm: 120, offset: 0, decay: 6 }], ['motion.sway', { amount: 0.1, speed: 0.5 }], ['motion.spin', { rate: 90, zoom: 1.2 }]];
    const motionRows: unknown[] = [];
    let motionOk = true;
    for (const [type, params] of motions) {
      fx = await withEffect(type, params, 7); // frame 7 = 7/30 s
      const m = motionAt(type, params, 7 / 30);
      const w7 = worst(fx.img, xf(m));
      const later = await still(ramp.pid, 19), again = await still(ramp.pid, 7); // 19/30 s is at another point of the beat and of every cycle here
      const ok = w7.worstPixels < 3 && maxDiff(fx.img, again) === 0 && maxDiff(fx.img, later) > 2;
      motionOk &&= ok;
      motionRows.push({ type, at: { scale: Number(m.scale.toFixed(3)), rotation: Number(m.rotation.toFixed(3)), dx: Number(m.dx.toFixed(4)), dy: Number(m.dy.toFixed(4)) }, ...w7, ok });
      await fx.remove();
    }
    check('motion.shake, pulse, sway and spin: the still at 7/30 s matches the transform the same code computes (within 3 pixels), is identical when rendered again, and differs at another moment', motionOk, motionRows);
    const onBeat = motionAt('motion.pulse', { amount: 0.2, bpm: 120, decay: 6 }, 0.5).scale, between = motionAt('motion.pulse', { amount: 0.2, bpm: 120, decay: 6 }, 0.95).scale;
    check('motion.pulse is largest exactly on the beat (every half second at 120 beats per minute) and has settled before the next one', Math.abs(onBeat - 1.2) < 1e-6 && between < 1.02, { onBeat, justBeforeNext: Number(between.toFixed(4)) });

    // Following the music: the beats come from the real beat analysis of a generated drum loop (94 beats per minute, so no
    // beat falls on a frame of the 30 fps grid by design); the still must show the pulse that the beat position predicts.
    {
      const loop = drumLoop(() => 94, 6, 0.41, 5);
      const rawLoop = path.join(art, 'loop.f32');
      fs.writeFileSync(rawLoop, Buffer.from(loop.x.buffer, loop.x.byteOffset, loop.x.byteLength));
      const loopFile = path.join(art, 'loop.wav');
      ff(['-y', '-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', rawLoop, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', loopFile]);
      const musicAsset = await upload(ramp.pid, loopFile);
      const analysed = await call(`/projects/${ramp.pid}/assets/${musicAsset}/analyze`, { kind: 'beats' });
      const placed = (await tx(ramp.pid, [{ op: 'add_clip', args: { assetId: musicAsset, start: T.frameTime(0, { num: 30, den: 1 }) } }])).results[0].output;
      const musicTrack = (await call(`/projects/${ramp.pid}`)).body.project.sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === (placed.audioClipId ?? placed.clipId))).id as string;
      const params = { amount: 0.2, bpm: 77, offset: 0, decay: 6, follow: 'music' };
      const follow = await withEffect('motion.pulse', params, 0);
      const docNow = (await call(`/projects/${ramp.pid}`)).body.project;
      const frames = Array.from({ length: 55 }, (_, k) => k + 3).map((k) => ({ k, beat: beatPositionAt(docNow, T.frameTime(k, { num: 30, den: 1 })) })).filter((x) => x.beat);
      const frac = (x: number) => x - Math.floor(x);
      const onBeatFrame = frames.reduce((a, b) => (frac(b.beat!.sinceBar) < frac(a.beat!.sinceBar) ? b : a), frames[0]!);
      const lateFrame = frames.reduce((a, b) => (frac(b.beat!.sinceBar) > frac(a.beat!.sinceBar) ? b : a), frames[0]!);
      const rows: unknown[] = [];
      let ok = frames.length > 40 && analysed.status === 200;
      for (const fr of [onBeatFrame, lateFrame]) {
        const m = motionAt('motion.pulse', params, fr.k / 30, fr.beat);
        const w = worst(await still(ramp.pid, fr.k), xf(m));
        ok &&= w.worstPixels < 3;
        rows.push({ frame: fr.k, beatsIntoBar: Number(fr.beat!.sinceBar.toFixed(3)), scale: Number(m.scale.toFixed(4)), ...w });
      }
      const sOn = motionAt('motion.pulse', params, onBeatFrame.k / 30, onBeatFrame.beat).scale, sLate = motionAt('motion.pulse', params, lateFrame.k / 30, lateFrame.beat).scale;
      check('motion.pulse set to follow the music: on a clip under a drum loop whose beats were detected by the analysis, the stills at the frame soonest after a beat and at the frame latest in a beat match the pulse computed from the detected beats (within 3 pixels); the picture is larger near the beat', ok && sOn > sLate + 0.05, { detectedBeats: docNow.analyses[musicAsset]?.beats?.beats?.length, detectedBpm: docNow.analyses[musicAsset]?.beats?.bpm, rows });
      // muting the music track: nothing to follow, so the effect falls back to its own tempo (77 beats per minute)
      await tx(ramp.pid, [{ op: 'update_track', args: { trackId: musicTrack, muted: true } }]);
      const fb = motionAt('motion.pulse', params, onBeatFrame.k / 30, null);
      const wFb = worst(await still(ramp.pid, onBeatFrame.k), xf(fb));
      check('with the music track muted the same effect falls back to its own tempo setting', wFb.worstPixels < 3 && Math.abs(fb.scale - sOn) > 0.01, { frame: onBeatFrame.k, scale: Number(fb.scale.toFixed(4)), ...wFb });
      await follow.remove();
      await tx(ramp.pid, [{ op: 'remove_track', args: { trackId: musicTrack } }]).catch(async () => { await tx(ramp.pid, [{ op: 'delete_clip', args: { clipId: placed.audioClipId ?? placed.clipId } }]); });
    }

    fx = await withEffect('light.leak', { amount: 0, speed: 0.3, seed: 2, color: '#FF7A2F' });
    const leak0 = fx.img;
    await tx(ramp.pid, [{ op: 'update_effect', args: { clipId: ramp.clipId, effectId: fx.id, params: { amount: 1 } } }]);
    const leakA = await still(ramp.pid, 0), leakB = await still(ramp.pid, 60);
    let darker = 0;
    for (let i = 0; i < leakA.length; i++) if (leakA[i]! < plainRamp[i]! - 1) darker++;
    check('light.leak: nothing at amount 0; otherwise it only ever adds light, and the light has moved two seconds later', maxDiff(leak0, plainRamp) <= 1 && darker === 0 && meanDiff(leakA, plainRamp) > 2 && meanDiff(leakA, leakB) > 0.5, { added: meanDiff(leakA, plainRamp), moved: meanDiff(leakA, leakB), darkerPixels: darker });
    await fx.remove();

    fx = await withEffect('light.strobe', { rate: 2, amount: 0.8, color: '#FFFFFF' }, 0);
    const flashOn = fx.img, flashOff = await still(ramp.pid, 12); // 0.4 s into a 0.5 s cycle
    const tooFast = await call(`/projects/${ramp.pid}/transactions`, { ops: [{ op: 'update_effect', args: { clipId: ramp.clipId, effectId: fx.id, params: { rate: 5 } } }] });
    check('light.strobe: brightest at the start of each cycle and nearly gone before the next; a rate above three flashes per second is refused', meanDiff(flashOn, plainRamp) > 60 && meanDiff(flashOff, plainRamp) < 6 && tooFast.status >= 400, { atFlash: meanDiff(flashOn, plainRamp), before_next: meanDiff(flashOff, plainRamp), fivePerSecond: tooFast.status });
    await fx.remove();

    // SAFETY RULE across strobes, end to end: two steady strobes on the picture (3 and 2.5 a second) and a title above it
    // with its own strobe (3 a second, starting off the others' grid). Each alone may flash up to three times a second;
    // together they must still start at most three flashes in any second of the exported file.
    {
      const sp = await newProject('strobes', rampFile);
      await tx(sp.pid, [{ op: 'add_effect', args: { clipId: sp.clipId, type: 'light.strobe', params: { rate: 3, amount: 0.8 } } }, { op: 'add_effect', args: { clipId: sp.clipId, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]);
      const clipLen = (await call(`/projects/${sp.pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === sp.clipId).duration;
      const title = (await tx(sp.pid, [{ op: 'add_text', args: { text: 'FLASH', start: T.frameTime(5, { num: 30, den: 1 }), duration: T.sub(clipLen, T.frameTime(5, { num: 30, den: 1 })) } }])).results[0].output.clipId as string;
      await tx(sp.pid, [{ op: 'add_effect', args: { clipId: title, type: 'light.strobe', params: { rate: 3, amount: 1 } } }]);
      const sj = await waitJob((await call(`/projects/${sp.pid}/exports`, {})).body.jobId);
      if (sj.status !== 'succeeded') check('Strobes together (export)', false, { status: sj.status, error: sj.error });
      else {
        const out = path.join(art, 'strobes.mp4');
        fs.writeFileSync(out, (await call(`/jobs/${sj.id}/output`)).body);
        const grey = ff(['-i', out, '-vf', 'scale=16:16', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
        const means: number[] = [];
        for (let k = 0; k + 256 <= grey.length; k += 256) { let sum = 0; for (let i = k; i < k + 256; i++) sum += grey[i]!; means.push(sum / 256); }
        const starts = means.flatMap((m, i) => (i > 0 && m - means[i - 1]! > 8) || (i === 0 && m > means[means.length - 1]! + 8) ? [i] : []);
        let most = 0;
        for (let i = 0; i < starts.length; i++) { let j = i; while (j + 1 < starts.length && starts[j + 1]! - starts[i]! < 30) j++; most = Math.max(most, j - i + 1); }
        const seconds = means.length / 30;
        check('Strobes together, on an exported file: two strobes on a picture and a strobing title over it start at most three flashes in any one second (30 frames), and do keep flashing (at least 2.4 starts a second on average)', means.length > 60 && most <= 3 && starts.length >= Math.floor(2.4 * seconds), { frames: means.length, flashStarts: starts, mostInOneSecond: most, perSecond: Number((starts.length / seconds).toFixed(2)) });
      }
      // The same strobes in the editor, shuttled at 8x (L four times): the timeline passes eight times faster than real
      // time, so without the player's guard its flashes would be eight times as frequent on screen. The measurement and its
      // verdict are in shuttle-flash.ts: the preview canvas is sampled on every animation frame with its real time; a flash
      // is a rise of its mean brightness by more than 8 of 255 above the lowest since the last fall, a fall the same below
      // the highest since the rise. That the guard was needed is measured too, not assumed: the frames that were on screen
      // are evaluated again without the guard, and must there rise more than three times in some second.
      // The editor has to paint more than six frames a second for that (a rise needs a darker frame and a brighter one). On
      // a busy machine the software adapter paints fewer, the guard has nothing to hold, and a fixed 2.5 s window said
      // nothing about it (the check failed with 0 frames held at 4 to 6 paints a second). So the shuttle goes on until the
      // guard was needed, at least 2.5 s and at most 55 s; if it never was, the check fails as "blocked by load".
      // An 8-minute timeline (at 8x the shuttle needs 60 s to cross it): the picture with two strobes and a strobing title over it.
      const LONG = 14_400;
      const long = (await call('/projects', { name: 'strobes-shuttle', width: W, height: H })).body.project.id as string;
      const longAsset = await upload(long, rampFile);
      const R30 = { num: 30, den: 1 };
      const longClip = (await tx(long, [{ op: 'add_clip', args: { assetId: longAsset, start: T.rt(0, 1), duration: T.frameTime(LONG, R30) } }])).results[0].output.clipId as string;
      await tx(long, [{ op: 'add_effect', args: { clipId: longClip, type: 'light.strobe', params: { rate: 3, amount: 0.8 } } }, { op: 'add_effect', args: { clipId: longClip, type: 'light.strobe', params: { rate: 2.5, amount: 0.8 } } }]);
      const longTitle = (await tx(long, [{ op: 'add_text', args: { text: 'FLASH', start: T.frameTime(5, R30), duration: T.frameTime(LONG - 5, R30) } }])).results[0].output.clipId as string;
      await tx(long, [{ op: 'add_effect', args: { clipId: longTitle, type: 'light.strobe', params: { rate: 3, amount: 1 } } }]);
      const longDoc = (await call(`/projects/${long}`)).body.project as ProjectDocument;
      const sp8 = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      await sp8.goto(`${s.ownerUrl}&project=${long}`);
      await sp8.locator('.clip').first().waitFor();
      await sp8.waitForFunction(() => Number(document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') ?? -1) >= 0, undefined, { timeout: 30_000 });
      const run8 = await shuttleAt8(sp8, longDoc, { minMs: 2500, deadlineMs: 55_000 });
      check('Strobes together, in the editor shuttled at 8x: the preview keeps flashing but shows at most three flashes in any second of real time (sampled on every animation frame); the frames it showed would have flashed more than three times in a second without the player\'s safety guard, and the guard held flashes back', run8.verdict === 'ok', { verdict: run8.verdict, shuttle: run8.shuttle, seconds: run8.seconds, ...run8.measure, framesHeldBack: run8.held, load1: Number(os.loadavg()[0]!.toFixed(2)), ...(run8.blockedByLoad ? { blockedByLoad: run8.blockedByLoad } : {}) });
      fs.writeFileSync(path.join(art, 'shuttle-samples.json'), JSON.stringify(run8.samples.map(([t, m, f]) => [Number(t.toFixed(3)), Math.round(m), f])));
      await sp8.close();
    }

    fx = await withEffect('stylize.film', { amount: 0.8, seed: 3 }, 0);
    check('stylize.film: changes the picture, is identical for the same frame, and differs on another frame', meanDiff(fx.img, plainRamp) > 2 && maxDiff(fx.img, await still(ramp.pid, 0)) === 0 && meanDiff(fx.img, await still(ramp.pid, 15)) > 0.2, { changed: meanDiff(fx.img, plainRamp) });
    await fx.remove();

    // the split of each step is seeded: reproduce it, pick a step whose split is clearly sideways (red encodes the column), and check red moved by that much
    const RS = { amount: 0.05, speed: 14, seed: 2 };
    const splitAt = (frame: number) => { const tick = Math.floor((frame / 30) * RS.speed + 1e-6); const ang = unit32(hash32(RS.seed * 131 + tick)) * 2 * Math.PI, k = RS.amount * unit32(hash32(RS.seed * 977 + tick + 3)); return { x: Math.cos(ang) * k * H, y: Math.sin(ang) * k * H, tick }; };
    const pick = [...Array(30).keys()].find((f) => Math.abs(splitAt(f).x) > 6)!;
    const other = [...Array(30).keys()].find((f) => splitAt(f).tick !== splitAt(pick).tick && Math.abs(splitAt(f).x - splitAt(pick).x) > 3)!;
    fx = await withEffect('digital.rgb-shake', RS, pick);
    let greenMoved = 0, redOff = 0;
    for (const [x, y] of grid) {
      greenMoved = Math.max(greenMoved, Math.abs(px(fx.img, x, y)[1]! - px(plainRamp, x, y)[1]!));
      if (x + splitAt(pick).x > 4 && x + splitAt(pick).x < W - 4) redOff = Math.max(redOff, Math.abs(from(fx.img, x, y).x - (x + splitAt(pick).x)));
    }
    check('digital.rgb-shake: red is taken from exactly the seeded offset (within 1.5 pixels), green stays where it is, another step has another offset, and a frame is identical when rendered again', greenMoved <= 1 && redOff < 1.5 && maxDiff(fx.img, await still(ramp.pid, other)) > 2 && maxDiff(fx.img, await still(ramp.pid, pick)) === 0, { frame: pick, sidewaysPixels: Number(splitAt(pick).x.toFixed(2)), redOff: Number(redOff.toFixed(2)), greenMoved });
    await fx.remove();

    // ---------- transitions over two pictures ----------
    // Both pictures carry the column in red and the row in green; blue is 0 in the outgoing one and 255 in the incoming one,
    // so blue says how much of each a pixel shows and red/green say where it was taken from.
    const mk = (name: string, blue: number) => { const raw = Buffer.alloc(W * H * 3); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[i] = Math.round((255 * x) / (W - 1)); raw[i + 1] = Math.round((255 * y) / (H - 1)); raw[i + 2] = blue; } const f = path.join(art, name); ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', f], raw); return f; };
    const tp = (await call('/projects', { name: 'transitions', width: W, height: H })).body.project.id as string;
    const aOut = await upload(tp, mk('out.png', 0)), aIn = await upload(tp, mk('in.png', 255));
    const R30 = { num: 30, den: 1 };
    await tx(tp, [{ op: 'add_clip', args: { assetId: aOut, start: T.rt(0, 1), duration: T.frameTime(60, R30) } }]);
    const inClip = (await tx(tp, [{ op: 'add_clip', args: { assetId: aIn, start: T.frameTime(60, R30), duration: T.frameTime(60, R30) } }])).results[0].output.clipId as string;
    const blueMean = (img: Img) => { let t = 0; for (let i = 2; i < img.length; i += 3) t += img[i]!; return t / (img.length / 3); };
    const catalogTransitions = (await call('/catalog')).body.transitions as { id: string; gpu: boolean; light?: boolean }[];
    const gpuTransitions = catalogTransitions.filter((t) => t.gpu).map((t) => t.id);
    // light transitions (ADR-0012) add light around their middle frame, which can make it brighter in blue than the last one
    const lightIds = catalogTransitions.filter((t) => t.gpu && t.light).map((t) => t.id);
    const rowsT: Record<string, unknown>[] = [];
    let allOrdered = true, allRepeat = true;
    const mids: Record<string, Img> = {};
    for (const id of gpuTransitions) {
      await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
      // frames 60..88 are the transition; 61, 74 (the middle) and 87 are early, half-way and late
      const early = await still(tp, 61), mid = await still(tp, 74), late = await still(tp, 87);
      mids[id] = mid;
      const b = [blueMean(early), blueMean(mid), blueMean(late)];
      const ordered = id === 'flash' ? b[0]! < 110 && b[2]! > 145 : lightIds.includes(id) ? b[0]! < 70 && b[2]! > 185 : b[0]! < 70 && b[2]! > 185 && b[0]! <= b[1]! + 1 && b[1]! <= b[2]! + 1;
      const repeat = maxDiff(mid, await still(tp, 74)) === 0;
      allOrdered &&= ordered; allRepeat &&= repeat;
      rowsT.push({ id, incomingShare: b.map((x) => Number((x / 255).toFixed(2))), ordered, repeat });
    }
    check(`All ${gpuTransitions.length} GPU transitions start mostly on the outgoing picture, end mostly on the incoming one and never go backwards in between (the flash and the ${lightIds.length} light transitions are checked at their ends only here)`, gpuTransitions.length === 46 && lightIds.length === 2 && allOrdered, rowsT.filter((r) => !r.ordered).length ? rowsT.filter((r) => !r.ordered) : { transitions: gpuTransitions.length, light: lightIds });
    {
      // The light ids with their light held by the flash schedule (ADR-0012): a steady strobe on a title shown on frames 65–69
      // flashes on frame 65 (rate 30/65 a second: its flash time 65/30 s); the light of a 29-frame transition at frame 60 would
      // start on frame 69, 4 frames later, under the 11-frame gap, so it is held and the transition draws no light at all.
      const title = (await tx(tp, [{ op: 'add_text', args: { text: '.', start: T.frameTime(65, R30), duration: T.frameTime(5, R30) } }])).results[0].output.clipId as string;
      await tx(tp, [{ op: 'add_effect', args: { clipId: title, type: 'light.strobe', params: { amount: 1, rate: 30 / 65 } } }]);
      const rowsL: Record<string, unknown>[] = [];
      let heldOk = true;
      for (const id of lightIds) {
        await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
        const plan = flashSchedule((await call(`/projects/${tp}`)).body.project).lights.get(inClip);
        const b = [blueMean(await still(tp, 61)), blueMean(await still(tp, 74)), blueMean(await still(tp, 87))];
        const ok = !!plan && !plan.kept && plan.frame === 69 && plan.since === 4 && b[0]! < 70 && b[2]! > 185 && b[0]! <= b[1]! + 1 && b[1]! <= b[2]! + 1;
        heldOk &&= ok;
        rowsL.push({ id, plan, incomingShare: b.map((x) => Number((x / 255).toFixed(2))), ok });
      }
      check('The light transitions with their light held by the flash schedule (a strobe flash 4 frames before): start on the outgoing picture, end on the incoming one, never go backwards', lightIds.length === 2 && heldOk, rowsL);
      await tx(tp, [{ op: 'delete_clip', args: { clipId: title } }]);
    }
    check('Every GPU transition gives the identical middle frame when rendered again, and no two of them give the same middle frame', allRepeat && new Set(Object.values(mids).map((m) => createHash('sha256').update(m).digest('hex'))).size === gpuTransitions.length, { repeatable: allRepeat, distinctMiddleFrames: new Set(Object.values(mids).map((m) => createHash('sha256').update(m).digest('hex'))).size });
    const isIn = (img: Img, x: number, y: number) => px(img, x, y)[2]! > 200, isOut = (img: Img, x: number, y: number) => px(img, x, y)[2]! < 55;
    check('Soft wipe right, half-way: the left side already shows the incoming picture and the right side still the outgoing one; wipe left is the opposite', isIn(mids['soft-wipe-right']!, 40, 320) && isOut(mids['soft-wipe-right']!, 320, 320) && isOut(mids['soft-wipe-left']!, 40, 320) && isIn(mids['soft-wipe-left']!, 320, 320));
    check('Iris open, half-way: the centre shows the incoming picture and the corners the outgoing one; iris close is the opposite', isIn(mids['iris-open']!, 180, 320) && isOut(mids['iris-open']!, 8, 8) && isOut(mids['iris-close']!, 180, 320) && isIn(mids['iris-close']!, 8, 8));
    check('Clock wipe, half-way: the right half is the incoming picture and the left half the outgoing one; reversed is the opposite', isIn(mids['clock-cw']!, 300, 320) && isOut(mids['clock-cw']!, 60, 320) && isOut(mids['clock-ccw']!, 300, 320) && isIn(mids['clock-ccw']!, 60, 320));
    const sq = mids['squeeze-h']!;
    // half-way, the outgoing picture is squeezed into the left half and the incoming one into the right half: columns map at twice the rate
    check('Squeeze, half-way: each picture is squeezed into its half, with columns taken from twice as far (within 3 pixels)', isOut(sq, 60, 320) && isIn(sq, 300, 320) && Math.abs(from(sq, 60, 320).x - (((60.5 / W) / 0.5) * W - 0.5)) < 3 && Math.abs(from(sq, 300, 320).x - ((((300.5 / W) - 0.5) / 0.5) * W - 0.5)) < 3, { leftFrom: Number(from(sq, 60, 320).x.toFixed(1)), rightFrom: Number(from(sq, 300, 320).x.toFixed(1)) });
    const bl = mids['blinds-h']!;
    const stripT = [...Array(9).keys()].map((k) => [isIn(bl, 180, Math.round(((k + 0.2) / 9) * H)), isOut(bl, 180, Math.round(((k + 0.8) / 9) * H))]);
    check('Blinds, half-way: in each of the nine slats the first half shows the incoming picture and the second half the outgoing one', stripT.every(([a2, b2]) => a2 && b2));

    // ---------- whip and spin (ADR-0011) ----------
    // Progress of transition frame k of 29 (evaluate.ts): smooth((k + 1) / 30); frame 73 is local 13, frame 75 local 15.
    const progressAt = (frame: number) => { const u = (frame - 60 + 1) / 30; return u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2; };
    {
      // spin turns about the centre, so the centre pixel shows the outgoing picture up to p 0.45 and the incoming one from 0.55
      const rowsS: unknown[] = [];
      let spinOk = true;
      for (const id of ['spin-cw', 'spin-ccw']) {
        await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
        const before = px(await still(tp, 73), 180, 320)[2]!, after = px(await still(tp, 75), 180, 320)[2]!;
        spinOk &&= before < 55 && after > 200;
        rowsS.push({ id, [`centreBlueAtP${progressAt(73).toFixed(3)}`]: before, [`centreBlueAtP${progressAt(75).toFixed(3)}`]: after });
      }
      check('Spin (both directions): the centre of the frame shows the outgoing picture before progress 0.45 and the incoming one after 0.55 (blue 0 = outgoing, 255 = incoming)', spinOk && progressAt(73) < 0.45 && progressAt(75) > 0.55, rowsS);

      // whip: the spread of one bright dot of the outgoing picture on the middle frame (p = 0.5, the longest blur). Along the
      // move it is smeared over 45% of the frame; across it, it keeps the dot's own size. The variance of the dot's light
      // along the move must be at least 4 times the variance across it, and the streak must lie where the strip has moved
      // it (a quarter of the frame from the edge the picture leaves by).
      const dots = Buffer.alloc(W * H * 3);
      const dotAt = [[90, 320], [270, 320], [180, 160], [180, 480]] as const; // uv (0.25, 0.5), (0.75, 0.5), (0.5, 0.25), (0.5, 0.75)
      for (const [cx, cy] of dotAt) for (let y = cy - 3; y < cy + 3; y++) for (let x = cx - 3; x < cx + 3; x++) dots.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3);
      const dotsFile = path.join(art, 'dots.png'), blackFile = path.join(art, 'black.png');
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', dotsFile], dots);
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', blackFile], Buffer.alloc(W * H * 3));
      const wp = (await call('/projects', { name: 'whip', width: W, height: H })).body.project.id as string;
      await tx(wp, [{ op: 'add_clip', args: { assetId: await upload(wp, dotsFile), start: T.rt(0, 1), duration: T.frameTime(60, R30) } }]);
      const wIn = (await tx(wp, [{ op: 'add_clip', args: { assetId: await upload(wp, blackFile), start: T.frameTime(60, R30), duration: T.frameTime(60, R30) } }])).results[0].output.clipId as string;
      /** Light-weighted centroid and variance of x and y over a band of the frame. */
      const spread = (img: Img, x0: number, x1: number, y0: number, y1: number) => {
        let s0 = 0, sx = 0, sy = 0, sxx = 0, syy = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const c = px(img, x, y), v = (c[0]! + c[1]! + c[2]!) / 3; s0 += v; sx += v * (x + 0.5); sy += v * (y + 0.5); sxx += v * (x + 0.5) ** 2; syy += v * (y + 0.5) ** 2; }
        const mx = sx / s0, my = sy / s0;
        return { light: Math.round(s0), x: Number(mx.toFixed(2)), y: Number(my.toFixed(2)), varX: Number((sxx / s0 - mx * mx).toFixed(1)), varY: Number((syy / s0 - my * my).toFixed(1)) };
      };
      // [id, horizontal?, where the streak's centre must be along the move]
      const whips: [string, boolean, number][] = [['whip-right', true, 90], ['whip-left', true, 270], ['whip-down', false, 160], ['whip-up', false, 480]];
      const rowsW: unknown[] = [];
      let whipOk = true;
      for (const [id, horizontal, centre] of whips) {
        await tx(wp, [{ op: 'set_transition', args: { clipId: wIn, type: id, frames: 29 } }]);
        const mid = await still(wp, 74);
        const sp = horizontal ? spread(mid, 0, W, 256, 384) : spread(mid, 144, 216, 0, H);
        const along = horizontal ? sp.varX : sp.varY, across = horizontal ? sp.varY : sp.varX, at = horizontal ? sp.x : sp.y;
        const ok = sp.light > 1000 && along >= 4 * across && Math.abs(at - centre) <= 4;
        whipOk &&= ok;
        rowsW.push({ id, ...sp, alongOverAcross: Number((along / Math.max(across, 1e-9)).toFixed(1)), expectedCentre: centre, ok });
      }
      measurements.whip = rowsW;
      check('Whip (four directions), middle frame: a dot of the outgoing picture is smeared along the move (variance along at least 4 times across) and lies where the moving strip puts it (within 4 pixels)', whipOk, rowsW);
    }
    await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: 'iris-open', frames: 29 } }]);
    const trJob = await waitJob((await call(`/projects/${tp}/exports`, {})).body.jobId);
    if (trJob.status === 'succeeded') {
      const out = path.join(art, 'transition.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${trJob.id}/output`)).body);
      const f74 = ff(['-i', out, '-vf', 'select=eq(n\\,74)', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      check('A GPU transition in an export: the half-way frame of the file shows the iris as the still does', px(f74, 180, 320)[2]! > 190 && px(f74, 8, 8)[2]! < 70, { centreBlue: px(f74, 180, 320)[2], cornerBlue: px(f74, 8, 8)[2] });
    } else check('A GPU transition in an export', false, { status: trJob.status, error: trJob.error });

    // edges, on the square: bright along its border, dark inside flat areas
    const edgeP = await newProject('edges', green);
    await tx(edgeP.pid, [{ op: 'add_effect', args: { clipId: edgeP.clipId, type: 'stylize.edges', params: { amount: 1, strength: 2 } } }]);
    const edges = await still(edgeP.pid);
    check('stylize.edges: the border of the square is bright and the flat areas are dark', px(edges, 130, 320)[0]! > 150 && px(edges, 180, 270)[0]! > 150 && near(px(edges, 180, 320), [0, 0, 0], 8) && near(px(edges, 40, 100), [0, 0, 0], 8), { leftBorder: px(edges, 130, 320), topBorder: px(edges, 180, 270), inside: px(edges, 180, 320), background: px(edges, 40, 100) });

    // the editor says what it has
    await page.locator('.clip').first().click();
    await page.getByTestId('inspector-tab-clip').click().catch(() => {});
    const offered = await page.evaluate(() => { const o = [...document.querySelectorAll<HTMLOptionElement>('[data-testid=effect-add] option')].find((x) => x.value === 'key.chroma'); return o ? { disabled: o.disabled, text: o.textContent } : null; });
    check('Editor with an adapter: the GPU effects are offered and no warning is shown', !!offered && offered.disabled === false && (await page.getByTestId('gpu-unavailable').count()) === 0, offered);

    // ---------- color.lut: an imported .cube colour table, against core's model of the pass ----------
    // Fixture: like the ramp (red = column, green = row), but blue varies too: it climbs four times across the width, so the
    // grid below meets many combinations of the three channels and the blue slices 0..15 of the table's 17 (blue is at most
    // 227 of 255 on the grid, and every pixel is opaque). The top of each channel, the last slice as the lower tap and pixels
    // that are not opaque are checked further down on a second fixture (ramp4).
    const ramp3File = path.join(art, 'ramp3.png');
    const ramp3Raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; ramp3Raw[i] = Math.round((255 * x) / (W - 1)); ramp3Raw[i + 1] = Math.round((255 * y) / (H - 1)); ramp3Raw[i + 2] = Math.round((255 * ((x * 4) % W)) / (W - 1)); }
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', ramp3File], ramp3Raw);
    const lutPid = (await call('/projects', { name: 'lut', width: W, height: H })).body.project.id as string;
    const lutClip = (await tx(lutPid, [{ op: 'add_clip', args: { assetId: await upload(lutPid, ramp3File), start: T.rt(0, 1), duration: T.rt(1, 1) } }])).results[0].output.clipId as string;
    const plainLut = await still(lutPid);
    const uploadRaw = async (name: string, bytes: Uint8Array<ArrayBuffer>, pid = lutPid) => { const r = await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': encodeURIComponent(name) }, body: bytes }); return { status: r.status, body: (await r.json()) as any }; };
    /** A table of the given size and input domain from a function of the (domain-normalised) input colour. */
    const tableOf = (size: number, fn: (r: number, g: number, b: number) => [number, number, number], lo = 0, hi = 1, title = 'proof'): Lut3D => {
      const t = identityLut(size);
      for (let i = 0; i < size ** 3; i++) { const o = fn(t.data[i * 3]!, t.data[i * 3 + 1]!, t.data[i * 3 + 2]!); t.data[i * 3] = o[0]; t.data[i * 3 + 1] = o[1]; t.data[i * 3 + 2] = o[2]; }
      return { ...t, title, domainMin: [lo, lo, lo], domainMax: [hi, hi, hi] };
    };
    // Not separable: the channels are rotated, each with its own curve, and the new blue also depends on a product of two inputs.
    // A wrong axis order, a wrong slice or a missing half-texel inset all show.
    const rotated = (r: number, g: number, b: number): [number, number, number] => [Math.pow(b, 1 / 1.8), Math.pow(r, 1.6), 0.7 * g + 0.3 * r * b];
    const cubeText = serializeCube(tableOf(17, rotated));
    const up = await uploadRaw('test.cube', Buffer.from(cubeText, 'utf8'));
    const tableId = up.body.assetId as string;
    const junk = await uploadRaw('junk.cube', Buffer.alloc(4000, 7));
    const oneD = await uploadRaw('curve.cube', Buffer.from('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n'));
    const assetsNow = Object.values((await call(`/projects/${lutPid}`)).body.project.assets) as any[];
    check('A .cube file uploaded through the asset route becomes a library entry of kind lut with its size; a junk file and a 1D table named .cube are refused with a typed error and add nothing', up.status === 201 && up.body.asset?.kind === 'lut' && up.body.asset?.lut?.size === 17 && junk.status === 415 && junk.body.error?.code === 'unsupported_media' && oneD.status === 415 && oneD.body.error?.details?.lut?.code === 'unsupported' && assetsNow.length === 2, { upload: up.status, kind: up.body.asset?.kind, size: up.body.asset?.lut?.size, junk: junk.status, junkCode: junk.body.error?.code, oneD: oneD.status, assets: assetsNow.length });

    const lutGrid: [number, number][] = [];
    for (let y = 20; y < H; y += 40) for (let x = 10; x < W; x += 20) lutGrid.push([x, y]);
    /** Largest difference, over the grid, between a still and what the strip model predicts from the plain still's pixel there. */
    const worstFromModel = (img: Img, text: string, intensity: number) => {
      const strip = lutStrip(text);
      let m = 0;
      for (const [x, y] of lutGrid) {
        const src = px(plainLut, x, y), got = px(img, x, y);
        const o = sampleStrip(strip, strip.size, [src[0]! / 255, src[1]! / 255, src[2]! / 255]);
        for (let c = 0; c < 3; c++) m = Math.max(m, Math.abs(got[c]! - (src[c]! + (o[c]! * 255 - src[c]!) * intensity)));
      }
      return Number(m.toFixed(2));
    };
    const fxOfLutClip = async () => ((await call(`/projects/${lutPid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === lutClip).effects ?? []) as any[];

    // no table chosen yet: the effect with its default parameters is the picture itself, and is not refused
    const emptyFx = (await tx(lutPid, [{ op: 'add_effect', args: { clipId: lutClip, type: 'color.lut' } }])).results[0].output.effectId as string;
    const untouched = await still(lutPid);
    check('color.lut with no table chosen: the still is delivered and is exactly the plain picture', maxDiff(untouched, plainLut) === 0, { maxDifference: maxDiff(untouched, plainLut) });
    await tx(lutPid, [{ op: 'remove_effect', args: { clipId: lutClip, effectId: emptyFx } }]);

    const applied = await tx(lutPid, [{ op: 'apply_lut', args: { clipId: lutClip, assetId: tableId } }]);
    const lutFx = applied.results[0].output.effectId as string;
    const graded = await still(lutPid);
    const wFull = worstFromModel(graded, cubeText, 1);
    measurements.lut = { gridPoints: lutGrid.length, worstFromModel: wFull, meanChange: meanDiff(graded, plainLut) };
    check('color.lut, intensity 1: every grid pixel of the still is what core sampleStrip gives for the plain still\'s pixel (within 3 of 255), and the picture did change', wFull <= 3 && meanDiff(graded, plainLut) > 20 && lutGrid.length >= 200, measurements.lut);
    check('color.lut: the same still rendered again is identical', maxDiff(graded, await still(lutPid)) === 0);

    const half = await tx(lutPid, [{ op: 'apply_lut', args: { clipId: lutClip, assetId: tableId, intensity: 0.5 } }]);
    const halfStill = await still(lutPid);
    const wHalf = worstFromModel(halfStill, cubeText, 0.5);
    const fxAfterHalf = await fxOfLutClip();
    check('color.lut, intensity 0.5: every grid pixel lies half-way between the plain picture and the table (within 3 of 255); apply_lut replaced the effect instead of stacking a second one', wHalf <= 3 && fxAfterHalf.length === 1 && half.results[0].output.effectId === lutFx, { worstFromModel: wHalf, effectsOnClip: fxAfterHalf.length });
    await tx(lutPid, [{ op: 'update_effect', args: { clipId: lutClip, effectId: lutFx, params: { intensity: 0 } } }]);
    const zero = await still(lutPid);
    check('color.lut, intensity 0: the plain picture (largest difference 1 of 255)', maxDiff(zero, plainLut) <= 1, { maxDifference: maxDiff(zero, plainLut) });
    await tx(lutPid, [{ op: 'update_effect', args: { clipId: lutClip, effectId: lutFx, params: { intensity: 1 } } }]);

    // refusals while the table is in use, and what happens when its bytes cannot be had
    const removeUsed = await call(`/projects/${lutPid}/transactions`, { ops: [{ op: 'remove_asset', args: { assetId: tableId } }] });
    const placeTable = await call(`/projects/${lutPid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: tableId, start: T.rt(2, 1) } }] });
    const unknownTable = await call(`/projects/${lutPid}/transactions`, { ops: [{ op: 'apply_lut', args: { clipId: lutClip, assetId: 'ast_nope' } }] });
    check('Removing the table while the effect uses it is refused, so is placing a table on the timeline, and so is naming a table that does not exist (the refusal lists the tables there are)', removeUsed.status !== 200 && removeUsed.body.error?.code === 'incompatible' && placeTable.status !== 200 && unknownTable.status === 404 && unknownTable.body.error?.details?.available?.[0]?.id === tableId, { remove: removeUsed.status, removeCode: removeUsed.body.error?.code, place: placeTable.status, unknown: unknownTable.status });
    {
      const blob = path.join(art, 'data', 'blobs', String(up.body.asset.contentHash).replace('sha256:', ''));
      const original = fs.readFileSync(blob);
      let unreadable: any, gone: any, back: Img | null = null;
      // an editor opened meanwhile (its own browser profile, so nothing of the table is cached there)
      const ed = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const edErrors: string[] = [];
      ed.on('pageerror', (e) => edErrors.push(String(e)));
      let notice: string | null = null, shown: Img | null = null;
      try {
        fs.writeFileSync(blob, Buffer.alloc(original.length, 0x23)); // same length, not a table: the worker receives it and cannot read it
        await ed.goto(`${s.ownerUrl}&project=${lutPid}`);
        await ed.locator('.clip').first().waitFor();
        await ed.getByTestId('effect-unavailable').waitFor({ timeout: 20_000 }).catch(() => {});
        notice = await ed.getByTestId('effect-unavailable').textContent().catch(() => null);
        shown = await previewRgb(ed);
        for (let i = 0; i < 100 && meanDiff(shown, plainLut) >= 0.5; i++) { await sleep(100); shown = await previewRgb(ed); }
        unreadable = await call(`/projects/${lutPid}/frame?index=0`);
        fs.rmSync(blob); // not there at all: known before any worker starts
        gone = await call(`/projects/${lutPid}/frame?index=0`);
      } finally { fs.writeFileSync(blob, original); }
      back = await still(lutPid);
      const said = JSON.stringify(unreadable.body?.error ?? '');
      check('A table that cannot be read is not rendered around: the still is refused and the reason names the colour table, not a missing graphics adapter; a table whose bytes are gone blocks the render up front; with the bytes back the still is as before', unreadable.status >= 400 && /colour table/.test(said) && !/graphics adapter/.test(said) && gone.status === 422 && gone.body.error?.details?.blockers?.[0]?.code === 'missing_media' && maxDiff(back, graded) === 0, { unreadable: unreadable.status, reason: said.slice(0, 260), gone: gone.status, blocker: gone.body.error?.details?.blockers?.[0]?.code });
      check('Editor while the table cannot be read: the preview shows the plain picture and a notice over it names the effect and the colour table, not a missing graphics adapter', !!notice && /colour table/.test(notice) && !/graphics adapter/.test(notice) && (await ed.getByTestId('gpu-unavailable').count()) === 0 && !!shown && meanDiff(shown, plainLut) < 0.5, { notice: notice?.slice(0, 300) ?? null, previewVsPlain: shown ? meanDiff(shown, plainLut) : null });
      // the bytes are back: the paused preview draws the table by itself (no seek, no edit, no reload), although the browser had cached the unreadable bytes
      const t0 = Date.now();
      let healed: Img = await previewRgb(ed);
      for (let i = 0; i < 450 && (meanDiff(healed, graded) >= 0.5 || (await ed.getByTestId('effect-unavailable').count()) > 0); i++) { await sleep(100); healed = await previewRgb(ed); }
      measurements.lutPreviewRecovery = { seconds: Number(((Date.now() - t0) / 1000).toFixed(1)), meanDifferenceFromStill: meanDiff(healed, graded) };
      check('Editor after the table\'s bytes are back: without any action the paused preview becomes the graded picture and the notice goes away', meanDiff(healed, graded) < 0.5 && (await ed.getByTestId('effect-unavailable').count()) === 0 && edErrors.length === 0, { ...(measurements.lutPreviewRecovery as object), errors: edErrors });
      await ed.close();
    }

    // the editor preview draws it through the same path; the panel and the library show the table
    await page.goto(`${s.ownerUrl}&project=${lutPid}`);
    await page.locator('.clip').first().waitFor();
    let lprev: Img = await previewRgb(page);
    for (let i = 0; i < 150 && meanDiff(lprev, graded) >= 0.5; i++) { await sleep(100); lprev = await previewRgb(page); }
    measurements.lutPreviewVsStill = { meanDifference: meanDiff(lprev, graded), maxDifference: maxDiff(lprev, graded) };
    check('color.lut: the editor preview and the still agree (mean difference under 0.5 of 255)', meanDiff(lprev, graded) < 0.5, measurements.lutPreviewVsStill);
    await page.locator('.clip').first().click();
    await page.getByTestId('inspector-tab-clip').click().catch(() => {});
    await page.getByTestId('effect-lut').waitFor({ timeout: 10_000 }).catch(() => {});
    const panel = await page.evaluate((id) => {
      const sel = document.querySelector<HTMLSelectElement>('[data-testid=effect-lut]');
      return { value: sel?.value ?? null, options: sel ? [...sel.options].map((o) => o.value) : [], badge: document.querySelector(`[data-testid="lut-size-${id}"]`)?.textContent ?? null, addButtons: document.querySelectorAll(`[data-testid="add-${id}"], [data-testid="view-${id}"]`).length, removeDisabled: document.querySelector<HTMLButtonElement>(`[data-testid="remove-${id}"]`)?.disabled ?? null, used: document.querySelectorAll(`[data-testid="used-${id}"]`).length, intensity: !!document.querySelector('[data-testid=effect-param][data-param=intensity]') };
    }, tableId);
    check('Editor: the effect shows a chooser with "none" and the project\'s table, selected; intensity keeps its slider; the library card of the table shows its size, is marked as in use, cannot be removed, and has no add-to-timeline or view button', panel.value === tableId && panel.options.length === 2 && panel.options[0] === '' && panel.intensity && panel.badge === '17³' && panel.addButtons === 0 && panel.removeDisabled === true && panel.used === 1, panel);
    // import a second table from the panel: an identity table, which the effect then points at
    const identityText = serializeCube(identityLut(9));
    await page.getByTestId('effect-lut-import').setInputFiles({ name: 'identity.cube', mimeType: 'application/octet-stream', buffer: Buffer.from(identityText, 'utf8') });
    let chosen: any = null;
    for (let i = 0; i < 100; i++) { const fx = (await fxOfLutClip())[0]; if (fx?.params?.lut && fx.params.lut !== tableId) { chosen = fx; break; } await sleep(100); }
    const identityAsset = chosen ? (await call(`/projects/${lutPid}`)).body.project.assets[chosen.params.lut] : null;
    const same = chosen ? await still(lutPid) : null;
    const wIdentity = same ? worstFromModel(same, identityText, 1) : null;
    check('Editor: "import .cube" on the effect uploads the file into the library and selects it for that effect; an identity table changes nothing beyond 2 of 255', !!chosen && chosen.id === lutFx && identityAsset?.kind === 'lut' && identityAsset?.lut?.size === 9 && identityAsset?.name === 'identity.cube' && !!same && maxDiff(same, plainLut) <= 2 && wIdentity !== null && wIdentity <= 3, { selected: chosen?.params?.lut ?? null, kind: identityAsset?.kind, maxDifferenceFromPlain: same ? maxDiff(same, plainLut) : null, worstFromModel: wIdentity });
    const removeFree = await call(`/projects/${lutPid}/transactions`, { ops: [{ op: 'remove_asset', args: { assetId: tableId } }] });
    const undoRemove = await call(`/projects/${lutPid}/undo`, {});
    check('Once no effect refers to it, the first table can be removed (and the removal undone)', removeFree.status === 200 && undoRemove.status === 200 && !!(await call(`/projects/${lutPid}`)).body.project.assets[tableId], { remove: removeFree.status, undo: undoRemove.status });

    // a table whose file declares another input domain (0..2): honoured, not sampled as if it were 0..1
    const wide = tableOf(17, rotated, 0, 2, 'wide domain');
    const wideText = serializeCube(wide);
    const wideUp = await uploadRaw('wide.cube', Buffer.from(wideText, 'utf8'));
    await tx(lutPid, [{ op: 'apply_lut', args: { clipId: lutClip, assetId: wideUp.body.assetId } }]);
    const wideStill = await still(lutPid);
    let wRef = 0;
    for (const [x, y] of lutGrid) { const src = px(plainLut, x, y), got = px(wideStill, x, y), o = sampleLut(wide, [src[0]! / 255, src[1]! / 255, src[2]! / 255]); for (let c = 0; c < 3; c++) wRef = Math.max(wRef, Math.abs(got[c]! - o[c]! * 255)); }
    const wWide = worstFromModel(wideStill, wideText, 1);
    check('color.lut with a table declared over the domain 0..2: the still follows the strip model (within 3 of 255) and the file\'s own definition, core sampleLut (within 4 of 255)', wideUp.status === 201 && wWide <= 3 && wRef <= 4, { worstFromModel: wWide, worstFromDefinition: Number(wRef.toFixed(2)) });

    // input domains that do not line up with the file's grid: 0..1.5 at size 17 is resampled without loss onto 33 entries per
    // axis; 0.0625..0.9375 (video range) fits no grid up to 65 and is approximated on 65. Both against the file's own definition.
    {
      const out: Record<string, unknown> = {};
      let ok = true;
      for (const [name, lo, hi, grid, limit] of [['range.cube', 0, 1.5, 33, 3], ['video.cube', 0.0625, 0.9375, 65, 4]] as const) {
        const table = tableOf(17, rotated, lo, hi, name);
        const text = serializeCube(table);
        const u = await uploadRaw(name, Buffer.from(text, 'utf8'));
        await tx(lutPid, [{ op: 'apply_lut', args: { clipId: lutClip, assetId: u.body.assetId } }]);
        const img = await still(lutPid);
        let def = 0;
        for (const [x, y] of lutGrid) { const src = px(plainLut, x, y), got = px(img, x, y), o = sampleLut(table, [src[0]! / 255, src[1]! / 255, src[2]! / 255]); for (let c = 0; c < 3; c++) def = Math.max(def, Math.abs(got[c]! - o[c]! * 255)); }
        const model = worstFromModel(img, text, 1);
        out[`${lo}..${hi}`] = { fileSize: u.body.asset?.lut?.size, stripSize: lutStrip(text).size, worstFromModel: model, worstFromDefinition: Number(def.toFixed(2)), limit };
        ok &&= u.status === 201 && u.body.asset?.lut?.size === 17 && lutStrip(text).size === grid && model <= 3 && def <= limit;
      }
      measurements.lutUnalignedDomains = out;
      check('color.lut with input domains that do not line up with the table\'s grid (0..1.5, and video range 0.0625..0.9375): the still follows the file\'s own definition, core sampleLut, within 3 of 255 where a finer grid holds every entry and within 4 where none up to 65 does', ok, out);
    }

    // ---------- color.lut on pixels that are not opaque, and at the top of every channel ----------
    // Fixture ramp4: red, green and blue each reach 255 on grid points (blue on a plateau, three times across the width, so the
    // last blue slice is met as the lower tap, with red = green = blue = 255 in one corner), and the lower half is translucent
    // (alpha 230, 153 and 77 of 255 in three bands) over the black project background. There the pass must take the colour out
    // of its premultiplied form before the lookup and put it back after: looking up the premultiplied colour gives another picture.
    {
      const src4 = (x: number, y: number) => [Math.min(255, Math.round((255 * x) / 340)), Math.min(255, Math.round((255 * y) / 600)), Math.min(255, Math.round((255 * (x % 120)) / 100)), y < H / 2 ? 255 : [230, 153, 77][Math.floor(x / 120)]!] as const;
      const ramp4File = path.join(art, 'ramp4.png');
      const ramp4Raw = Buffer.alloc(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp4Raw.set(src4(x, y), (y * W + x) * 4);
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-pix_fmt', 'rgba', '-y', ramp4File], ramp4Raw);
      const aPid = (await call('/projects', { name: 'lut-alpha', width: W, height: H })).body.project.id as string;
      const aClip = (await tx(aPid, [{ op: 'add_clip', args: { assetId: await upload(aPid, ramp4File), start: T.rt(0, 1), duration: T.rt(1, 1) } }])).results[0].output.clipId as string;
      const plainA = await still(aPid);
      // as imported: over black, each pixel is its colour times its alpha
      let asImported = 0;
      const seen = { points: lutGrid.length, translucent: 0, blueTop: 0, allTop: 0, translucentBlueTop: 0 };
      for (const [x, y] of lutGrid) {
        const c = src4(x, y), got = px(plainA, x, y);
        for (let k = 0; k < 3; k++) asImported = Math.max(asImported, Math.abs(got[k]! - (c[k]! * c[3]) / 255));
        if (c[3] < 255) seen.translucent++;
        if (c[2] === 255) seen.blueTop++;
        if (c[2] === 255 && c[3] < 255) seen.translucentBlueTop++;
        if (c[0] === 255 && c[1] === 255 && c[2] === 255) seen.allTop++;
      }
      check('Fixture with translucent pixels, as imported: over the black background every grid pixel is its colour times its alpha (within 1 of 255); the grid has translucent pixels, pixels with blue = 255 (also translucent ones) and the corner where all three channels are 255', asImported <= 1 && seen.translucent >= 100 && seen.blueTop >= 40 && seen.translucentBlueTop >= 20 && seen.allTop >= 1, { worst: Number(asImported.toFixed(2)), ...seen });
      const aTable = (await uploadRaw('test.cube', Buffer.from(cubeText, 'utf8'), aPid)).body.assetId as string;
      const aFx = (await tx(aPid, [{ op: 'apply_lut', args: { clipId: aClip, assetId: aTable } }])).results[0].output.effectId as string;
      const gradedA = await still(aPid);
      const strip = lutStrip(cubeText);
      // The pass sees the premultiplied pixel the plain still shows (the background is black) and the fixture's alpha.
      const worst = { opaque: 0, translucent: 0, blueTop: 0, withoutUnpremultiply: 0 };
      let wrongKept = 0, wrongScaled = 0; // the two ways a pass could leave the step out: alpha kept as it is, or multiplied in again
      for (const [x, y] of lutGrid) {
        const c = src4(x, y), a = c[3] / 255, pre = px(plainA, x, y), got = px(gradedA, x, y);
        const straight = pre.map((v) => Math.min(1, v / 255 / a)) as [number, number, number];
        const o = sampleStrip(strip, strip.size, straight);
        const wrong = sampleStrip(strip, strip.size, [pre[0]! / 255, pre[1]! / 255, pre[2]! / 255]); // a pass that looks up the premultiplied colour
        for (let k = 0; k < 3; k++) {
          const d = Math.abs(got[k]! - o[k]! * a * 255);
          if (a < 1) worst.translucent = Math.max(worst.translucent, d); else worst.opaque = Math.max(worst.opaque, d);
          if (c[2] === 255) worst.blueTop = Math.max(worst.blueTop, d);
          if (a < 1) { wrongKept = Math.max(wrongKept, Math.abs(got[k]! - wrong[k]! * 255)); wrongScaled = Math.max(wrongScaled, Math.abs(got[k]! - wrong[k]! * a * 255)); }
        }
      }
      worst.withoutUnpremultiply = Math.min(wrongKept, wrongScaled);
      for (const k of Object.keys(worst) as (keyof typeof worst)[]) worst[k] = Number(worst[k].toFixed(2));
      measurements.lutAlpha = { grid: seen, worstOf255: worst };
      check('color.lut on translucent pixels and at the top of every channel: every grid pixel is the table\'s answer for the straight colour, times the pixel\'s alpha (within 3 of 255), also where blue is 255 (the last slice of the table); a lookup of the premultiplied colour would be far off', worst.opaque <= 3 && worst.translucent <= 3 && worst.blueTop <= 3 && worst.withoutUnpremultiply > 20, measurements.lutAlpha);
      await tx(aPid, [{ op: 'update_effect', args: { clipId: aClip, effectId: aFx, params: { intensity: 0 } } }]);
      const zeroA = await still(aPid);
      check('color.lut, intensity 0, on translucent pixels: the plain picture (largest difference 1 of 255), so taking the colour out of its premultiplied form and putting it back loses nothing', maxDiff(zeroA, plainA) <= 1, { maxDifference: maxDiff(zeroA, plainA) });
    }

    // export: the worker draws the table too
    await tx(lutPid, [{ op: 'apply_lut', args: { clipId: lutClip, assetId: tableId } }]);
    const lutJob = await waitJob((await call(`/projects/${lutPid}/exports`, {})).body.jobId);
    if (lutJob.status !== 'succeeded') check('color.lut (export)', false, { status: lutJob.status, error: lutJob.error });
    else {
      const out = path.join(art, 'lut.mp4');
      fs.writeFileSync(out, (await call(`/jobs/${lutJob.id}/output`)).body);
      const exp = ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      measurements.lutExportVsStill = { meanDifferenceFromStill: meanDiff(exp, graded), meanDifferenceFromPlain: meanDiff(exp, plainLut) };
      check('color.lut (export): the exported frame is the graded picture (within video compression), far from the plain one', meanDiff(exp, graded) < 4 && meanDiff(exp, plainLut) > 20, measurements.lutExportVsStill);
    }
    check('No uncaught errors in the editor page with a colour table', errors.length === 0, errors);

    // ---------- stylize.digicam (ADR-0011): against digicamTone, the noise ticks, and the flash check ----------
    // Fixture: four flat quadrants, mid grey, a skin tone, a near-white that blooms (luma above 0.8) and a saturated blue.
    // Their centres lie 90 pixels from any edge, beyond the reach of the sharpening, the bloom and the 8 x 8 colour blocks.
    const quadColours = [[128, 128, 128], [205, 150, 120], [240, 236, 225], [40, 70, 200]] as const;
    const quadRaw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) quadRaw.set(quadColours[(y < H / 2 ? 0 : 2) + (x < W / 2 ? 0 : 1)]!, (y * W + x) * 3);
    const quadFile = path.join(art, 'quad.png');
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', quadFile], quadRaw);
    const dc = await newProject('digicam', quadFile);
    const plainQ = await still(dc.pid);
    const centres = [[90, 160], [270, 160], [90, 480], [270, 480]] as const;
    const DC = { amount: 0.8, sharpen: 0.7, noise: 0, bloom: 0.6, cool: 0.4, seed: 7 };
    const dcFx = (await tx(dc.pid, [{ op: 'add_effect', args: { clipId: dc.clipId, type: 'stylize.digicam', params: DC } }])).results[0].output.effectId as string;
    const tone0 = await still(dc.pid);
    {
      let worstTone = 0;
      const rows: unknown[] = [];
      for (const [cx, cy] of centres) {
        const src = px(plainQ, cx, cy), model = digicamTone([src[0]! / 255, src[1]! / 255, src[2]! / 255], DC).map((v) => v * 255);
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) { const got = px(tone0, x, y); for (let c = 0; c < 3; c++) worstTone = Math.max(worstTone, Math.abs(got[c]! - model[c]!)); }
        rows.push({ at: [cx, cy], plain: src, still: px(tone0, cx, cy), model: model.map((v) => Number(v.toFixed(1))) });
      }
      measurements.digicamTone = { worstOf255: Number(worstTone.toFixed(2)), rows };
      check('stylize.digicam, noise 0: on every flat patch (grey, skin, a near-white that blooms, blue) each pixel is what digicamTone gives for the plain pixel (within 2 of 255), and the picture did change', worstTone <= 2 && meanDiff(tone0, plainQ) > 2, measurements.digicamTone);
    }
    await tx(dc.pid, [{ op: 'update_effect', args: { clipId: dc.clipId, effectId: dcFx, params: { amount: 0, noise: 1 } } }]);
    const dcZero = await still(dc.pid);
    check('stylize.digicam, amount 0 (with the noise at 1): the plain picture (largest difference 1 of 255)', maxDiff(dcZero, plainQ) <= 1, { maxDifference: maxDiff(dcZero, plainQ) });
    await tx(dc.pid, [{ op: 'update_effect', args: { clipId: dc.clipId, effectId: dcFx, params: { amount: 1, noise: 0 } } }]);
    const quiet = await still(dc.pid);
    await tx(dc.pid, [{ op: 'update_effect', args: { clipId: dc.clipId, effectId: dcFx, params: { noise: 1 } } }]);
    const noisy: Img[] = [];
    for (let f = 0; f < 9; f++) noisy.push(await still(dc.pid, f));
    {
      // the noise over a 2 x 2-aligned area of the grey and the skin patches (no channel near 0 or 255, so nothing is clipped)
      const area = (x0: number, y0: number) => { let d: number[] = [0, 0, 0], abs = 0, most = 0, k = 0; for (let y = y0; y < y0 + 120; y++) for (let x = x0; x < x0 + 100; x++) { const a = px(noisy[0]!, x, y), b = px(quiet, x, y); for (let c = 0; c < 3; c++) { const v = a[c]! - b[c]!; d[c] = d[c]! + v; abs += Math.abs(v); most = Math.max(most, Math.abs(v)); } k++; } d = d.map((v) => Number((v / k).toFixed(3))); return { meanOffset: d, meanSize: Number((abs / (3 * k)).toFixed(2)), largest: most }; };
      const grey = area(40, 100), skin = area(220, 100);
      const ok = [grey, skin].every((a) => a.meanOffset.every((v) => Math.abs(v) <= 0.5) && a.meanSize > 1 && a.largest <= Math.ceil(0.03 * 255) + 1);
      measurements.digicamNoise = { grey, skin };
      check('stylize.digicam noise at 1: it is there (mean size over 1 of 255), no channel moves by more than 0.03 of the range (+1 for rounding), and over the area its mean is zero (within 0.5 of 255): it adds no brightness', ok, measurements.digicamNoise);
      const same: unknown[] = [];
      let ticksOk = maxDiff(noisy[0]!, await still(dc.pid, 0)) === 0;
      for (let f = 0; f < 8; f++) {
        const sameTick = digicamTick(f / 30) === digicamTick((f + 1) / 30), identical = maxDiff(noisy[f]!, noisy[f + 1]!) === 0;
        ticksOk &&= sameTick === identical && (identical || meanDiff(noisy[f]!, noisy[f + 1]!) > 0.5);
        same.push({ frames: [f, f + 1], ticks: [digicamTick(f / 30), digicamTick((f + 1) / 30)], identical });
      }
      check('stylize.digicam: the same tick gives the identical picture (also rendered again), and the noise changes exactly where digicamTick changes (15 times a second: every second frame at 30 fps)', ticksOk, same);
    }
    // preview vs still, in the editor (paused on frame 0)
    await page.goto(`${s.ownerUrl}&project=${dc.pid}`);
    await page.locator('.clip').first().waitFor();
    let dprev: Img = await previewRgb(page);
    for (let i = 0; i < 150 && meanDiff(dprev, noisy[0]!) >= 0.5; i++) { await sleep(100); dprev = await previewRgb(page); }
    measurements.digicamPreviewVsStill = { meanDifference: meanDiff(dprev, noisy[0]!), maxDifference: maxDiff(dprev, noisy[0]!) };
    check('stylize.digicam: the editor preview and the still agree (mean difference under 0.5 of 255)', meanDiff(dprev, noisy[0]!) < 0.5, measurements.digicamPreviewVsStill);
    // flash check (ADR-0009) on an export at noise 1 and full amount: every frame of the file through the FlashAnalyser
    {
      const dj = await waitJob((await call(`/projects/${dc.pid}/exports`, {})).body.jobId);
      if (dj.status !== 'succeeded') check('stylize.digicam (export)', false, { status: dj.status, error: dj.error });
      else {
        const out = path.join(art, 'digicam.mp4');
        fs.writeFileSync(out, (await call(`/jobs/${dj.id}/output`)).body);
        const frames = ff(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
        const fa = new FlashAnalyser(30), size = W * H * 4;
        for (let k = 0; k + size <= frames.length; k += size) fa.push(flashCells(frames.subarray(k, k + size), W, H));
        const rep = fa.report();
        measurements.digicamFlash = { frames: rep.frames, verdict: rep.verdict, ranges: rep.ranges };
        check('stylize.digicam at noise 1 and amount 1, exported: the FlashAnalyser reads every frame of the file and its verdict is pass', rep.frames >= 120 && rep.verdict === 'pass', measurements.digicamFlash);
      }
    }

    // ---------- stylize.crt (ADR-0011): the phosphor mask period, the curve against crtMap, no time ----------
    const greyRaw = Buffer.alloc(W * H * 3, 128);
    const greyFile = path.join(art, 'grey.png');
    ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', greyFile], greyRaw);
    const cr = await newProject('crt', greyFile);
    const crFx = (await tx(cr.pid, [{ op: 'add_effect', args: { clipId: cr.clipId, type: 'stylize.crt', params: { curvature: 0, phosphor: 'grille', pitch: 0.01, lines: 120, amount: 1, glow: 0 } } }])).results[0].output.effectId as string;
    {
      /** The strongest period of the red channel along some rows (mean removed): a fine scan of the Fourier amplitude between 2 and 24 pixels. */
      const periodOf = (img: Img, rows: number[]) => {
        const amp = (P: number) => { let t = 0; for (const y of rows) { let m = 0; for (let x = 0; x < W; x++) m += px(img, x, y)[0]!; m /= W; let re = 0, im = 0; for (let x = 0; x < W; x++) { const v = px(img, x, y)[0]! - m, a = (2 * Math.PI * (x + 0.5)) / P; re += v * Math.cos(a); im += v * Math.sin(a); } t += Math.hypot(re, im); } return t; };
        let best = 2, bestA = -1;
        for (let P = 2; P <= 24; P += 0.01) { const a = amp(P); if (a > bestA) { bestA = a; best = P; } }
        for (let P = best - 0.02; P <= best + 0.02; P += 0.0005) { const a = amp(P); if (a > bestA) { bestA = a; best = P; } }
        return best;
      };
      const rows = [100, 220, 340, 460, 580];
      const p10 = periodOf(await still(cr.pid), rows);
      await tx(cr.pid, [{ op: 'update_effect', args: { clipId: cr.clipId, effectId: crFx, params: { pitch: 0.007 } } }]);
      const p7 = periodOf(await still(cr.pid), rows);
      measurements.crtMaskPeriod = { pitch0010: { expected: 0.01 * H, measured: Number(p10.toFixed(3)) }, pitch0007: { expected: 0.007 * H, measured: Number(p7.toFixed(3)) } };
      check('stylize.crt: along a row the phosphor mask repeats every pitch x frame height pixels (within 0.1 pixel; pitch 0.01 and 0.007 on a 640-pixel-high frame)', Math.abs(p10 - 0.01 * H) <= 0.1 && Math.abs(p7 - 0.007 * H) <= 0.1, measurements.crtMaskPeriod);
      // the defaults (curvature, beam lines, glow): no input is the time, so another moment is the same picture; outside the glass is black
      await tx(cr.pid, [{ op: 'update_effect', args: { clipId: cr.clipId, effectId: crFx, params: { curvature: 0.2, pitch: 0.0028, lines: 480, amount: 0.8, glow: 0.3 } } }]);
      const c0 = await still(cr.pid, 0), c15 = await still(cr.pid, 15), c90 = await still(cr.pid, 90);
      check('stylize.crt reads no time: frames 0, 15 and 90 are identical; the corner outside the curved glass is black and the centre is not', maxDiff(c0, c15) === 0 && maxDiff(c0, c90) === 0 && near(px(c0, 1, 1), [0, 0, 0], 1) && px(c0, 180, 320)[0]! > 40, { frames15: maxDiff(c0, c15), frames90: maxDiff(c0, c90), corner: px(c0, 1, 1), centre: px(c0, 180, 320) });
    }
    {
      // The curve: a grid of white lines 3 pixels wide on black (columns 60, 120, … 300, rows 80, 160, … 560), with the
      // curvature at 0.2 and amount 0 (the curved picture alone). Each line's centre is measured across it (light-weighted, in
      // a 15-pixel window that must be dark at its ends) on rows and columns half-way between the lines, and compared with
      // where crtMap puts it (solved for the output position by bisection).
      const gridRaw = Buffer.alloc(W * H * 3);
      const vLines = [60, 120, 180, 240, 300], hLines = [80, 160, 240, 320, 400, 480, 560];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (vLines.some((c) => Math.abs(x - c) <= 1) || hLines.some((r) => Math.abs(y - r) <= 1)) gridRaw.fill(255, (y * W + x) * 3, (y * W + x) * 3 + 3);
      const gridFile = path.join(art, 'crt-grid.png');
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', gridFile], gridRaw);
      const cg = await newProject('crt-grid', gridFile);
      const gridPlain = await still(cg.pid);
      const cgFx = (await tx(cg.pid, [{ op: 'add_effect', args: { clipId: cg.clipId, type: 'stylize.crt', params: { curvature: 0, amount: 0 } } }])).results[0].output.effectId as string;
      const flat = await still(cg.pid);
      await tx(cg.pid, [{ op: 'update_effect', args: { clipId: cg.clipId, effectId: cgFx, params: { curvature: 0.2 } } }]);
      const curved = await still(cg.pid);
      const CP = { curvature: 0.2 }, aspect = W / H;
      /** Output position (continuous pixels) along one axis whose source position is `target`, the other coordinate fixed. */
      const solve = (target: number, fixed: number, horizontal: boolean) => {
        const at = (z: number) => { const m = horizontal ? crtMap(z / W, fixed / H, CP, aspect) : crtMap(fixed / W, z / H, CP, aspect); return m ? (horizontal ? m[0] * W : m[1] * H) : null; };
        const span = horizontal ? W : H;
        let lo = 0, hi = span;
        // outside the glass (null) lies beyond the ends of the row or column: past the middle it is too far on, before it too far back
        for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2, v = at(mid); if (v === null ? mid > span / 2 : v >= target) hi = mid; else lo = mid; }
        const z = (lo + hi) / 2;
        // only well inside the glass: crtMap must hold 8 pixels around the point too
        return at(z - 8) !== null && at(z + 8) !== null ? z : null;
      };
      let worstCurve = 0, points = 0, moved = 0;
      const measure = (horizontal: boolean, fixedPx: number, line: number) => {
        const z = solve(line + 0.5, fixedPx + 0.5, horizontal);
        if (z === null) return;
        const c = Math.round(z - 0.5), val = (k: number) => { const q = horizontal ? px(curved, k, fixedPx) : px(curved, fixedPx, k); return q[0]!; };
        if (c - 7 < 0 || c + 7 >= (horizontal ? W : H) || val(c - 7) > 20 || val(c + 7) > 20) return;
        let s0 = 0, s1 = 0;
        for (let k = c - 7; k <= c + 7; k++) { s0 += val(k); s1 += val(k) * (k + 0.5); }
        if (s0 < 200) return;
        worstCurve = Math.max(worstCurve, Math.abs(s1 / s0 - z)); points++; moved = Math.max(moved, Math.abs(z - (line + 0.5)));
      };
      for (let k = 0; k <= hLines.length; k++) for (const x of vLines) measure(true, 40 + 80 * k, x);
      for (let k = 0; k <= vLines.length; k++) for (const y of hLines) measure(false, 30 + 60 * k, y);
      measurements.crtCurve = { worstPixels: Number(worstCurve.toFixed(2)), points, largestDisplacement: Number(moved.toFixed(1)), flatVsPlain: maxDiff(flat, gridPlain) };
      check('stylize.crt: with no curvature and amount 0 the picture is unchanged (largest difference 1); at curvature 0.2 every measured line lies where crtMap puts it (within 1.5 pixels) on at least 30 points, and lines near the edge moved by more than 3 pixels', maxDiff(flat, gridPlain) <= 1 && worstCurve <= 1.5 && points >= 30 && moved > 3, measurements.crtCurve);
    }
    check('No uncaught errors in the editor page with the digicam preview', errors.length === 0, errors);

    // ---------- M1 (colour match, ADR-0014): color.grade against its model gradePixel on a 9×9×9 colour grid ----------
    // Colour match fits grade values with gradePixel (engine colourMatch.ts), so the model must be the pass. Fixture: 729 flat
    // patches, every combination of 9 levels per channel (0, 32, 64 … 255), 27 × 27 patches of 13 × 23 pixels. Six seeded sets of
    // all eight values (wider than a match ever proposes); each patch's centre in the still, against gradePixel of the same pixel
    // in the plain still (so decoding is the same on both sides). The pass runs in f32 and stores 8 bits: within 2 of 255.
    {
      const { gradePixel } = await import('@pulseframe/engine');
      const LV = 9, PW = Math.floor(W / 27), PH = Math.floor(H / 27), level = (i: number) => Math.round((255 * i) / (LV - 1));
      const gridRaw = Buffer.alloc(W * H * 3);
      const patches: [number, number][] = [];
      for (let k = 0; k < LV; k++) for (let j = 0; j < LV; j++) for (let i = 0; i < LV; i++) {
        const col = i + LV * (k % 3), row = j + LV * Math.floor(k / 3);
        patches.push([col * PW + Math.floor(PW / 2), row * PH + Math.floor(PH / 2)]);
        for (let y = row * PH; y < (row + 1) * PH; y++) for (let x = col * PW; x < (col + 1) * PW; x++) { const o = (y * W + x) * 3; gridRaw[o] = level(i); gridRaw[o + 1] = level(j); gridRaw[o + 2] = level(k); }
      }
      const gridFile = path.join(art, 'grade-grid.png');
      ff(['-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', 'pipe:0', '-frames:v', '1', '-y', gridFile], gridRaw);
      const gp = await newProject('grade-grid', gridFile);
      const plainGrid = await still(gp.pid);
      // seeded sets (mulberry32, seed 20261117), rounded to 0.001 like every fitted value
      let seed = 20261117 >>> 0;
      const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
      const r3 = (v: number) => Math.round(v * 1000) / 1000;
      const sets = Array.from({ length: 6 }, () => ({ exposure: r3((rnd() * 2 - 1) * 1.5), temperature: r3(rnd() * 2 - 1), tint: r3(rnd() * 2 - 1), contrast: r3(0.3 + rnd() * 1.4), saturation: r3(rnd() * 2), shadows: r3(rnd() * 2 - 1), highlights: r3(rnd() * 2 - 1), fade: r3(rnd()) }));
      const gradeFx = (await tx(gp.pid, [{ op: 'add_effect', args: { clipId: gp.clipId, type: 'color.grade' } }])).results[0].output.effectId as string;
      const perSet: { params: Record<string, number>; worst: number; changed: number }[] = [];
      for (const p of sets) {
        await tx(gp.pid, [{ op: 'update_effect', args: { clipId: gp.clipId, effectId: gradeFx, params: p } }]);
        const img = await still(gp.pid);
        let worst = 0;
        for (const [x, y] of patches) {
          const src = px(plainGrid, x, y), got = px(img, x, y), want = gradePixel([src[0]! / 255, src[1]! / 255, src[2]! / 255], p);
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c]! - want[c]! * 255));
        }
        perSet.push({ params: p, worst: Number(worst.toFixed(2)), changed: meanDiff(img, plainGrid) });
      }
      const worstAll = Math.max(...perSet.map((x) => x.worst));
      measurements.gradeGrid = { patches: patches.length, sets: perSet };
      check('M1 color.grade against gradePixel: a 9×9×9 colour grid at 6 seeded sets of all eight values, every patch within 2 of 255, and every set changed the picture', patches.length === 729 && perSet.length === 6 && worstAll <= 2 && perSet.every((x) => x.changed > 1), { worst: worstAll, perSet: perSet.map((x) => x.worst) });
    }

    // ---------- no adapter in the browser ----------
    const p2 = await plain.newPage({ viewport: { width: 1500, height: 950 } });
    await p2.goto(`${s.ownerUrl}&project=${key.pid}`);
    await p2.locator('.clip').first().waitFor();
    await sleep(1500);
    const raw = await previewRgb(p2);
    await p2.locator('.clip').first().click();
    await p2.getByTestId('inspector-tab-clip').click().catch(() => {});
    const warned = await p2.getByTestId('gpu-unavailable').count();
    const off2 = await p2.evaluate(() => { const o = [...document.querySelectorAll<HTMLOptionElement>('[data-testid=effect-add] option')].find((x) => x.value === 'key.chroma'); return o ? { disabled: o.disabled, text: o.textContent } : null; });
    check('Editor without an adapter: the clip is shown WITHOUT the effect (green still there), a warning says why, and the effect cannot be added', near(px(raw, 20, 20), [0, 255, 0], 12) && warned === 1 && !!off2 && off2.disabled === true, { corner: px(raw, 20, 20), warned, option: off2 });
  } finally {
    await browser.close().catch(() => {});
    await plain.close().catch(() => {});
    await s.close();
  }

  // ---------- no adapter in the render worker ----------
  process.env.PF_RENDER_GPU = 'off';
  const s2 = await startServer({ port: 8862, dataDir: path.join(art, 'data') });
  try {
    const h = { authorization: `Bearer ${s2.auth.tokens.agent}`, connection: 'close' };
    const pid = ((await (await fetch(`${s2.url}/api/v1/projects`, { headers: h })).json()) as any).projects.find((p: any) => p.name === 'key').id as string;
    const r = await fetch(`${s2.url}/api/v1/projects/${pid}/frame?index=0`, { headers: h });
    const body = r.headers.get('content-type')?.includes('json') ? ((await r.json()) as any) : null;
    check('Worker without an adapter: a still is refused with the reason, not delivered without the effect', r.status >= 400 && /gpu_effect_unavailable|graphics adapter/.test(JSON.stringify(body)), { status: r.status, error: body?.error?.message?.slice(0, 200) });
    const j0 = (await (await fetch(`${s2.url}/api/v1/projects/${pid}/exports`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: '{}' })).json()) as any;
    let job: any;
    for (;;) { job = await (await fetch(`${s2.url}/api/v1/jobs/${j0.jobId}`, { headers: h })).json(); if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(200); }
    check('Worker without an adapter: the export fails with the reason', job.status === 'failed' && /gpu_effect_unavailable|graphics adapter/.test(JSON.stringify(job.error)), { status: job.status, error: JSON.stringify(job.error).slice(0, 240) });
  } finally {
    await s2.close();
    delete process.env.PF_RENDER_GPU;
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', passed: checks.length - failed.length, total: checks.length,
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none: the WebGPU adapter here is a software one' },
      scope: 'Thirty-one effects (one of them a .cube colour table, imported through the upload route and through the editor), the colour looks and forty-six transitions (the seven of the trend pack, ADR-0012, included; their own proof is proof:trend-light) on synthetic still images at 360x640, on a software WebGPU adapter. Correctness of the passes and of the refusals only: no speed claim, no real footage, no hardware adapter, nobody looked at the pictures.',
      measurements, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/gpu-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nGPU proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
