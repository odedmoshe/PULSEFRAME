/**
 * WebGPU effect passes (ADR-0008): the adapter check, two effects (chroma key, wave) checked by pixel in the editor preview,
 * in a still and in an export, agreement between those three, repeatability, and the refusals when no adapter is available.
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
import { startServer } from '@pulseframe/server';

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
    const gpuTransitions = (await call('/catalog')).body.transitions.filter((t: any) => t.gpu).map((t: any) => t.id) as string[];
    const rowsT: Record<string, unknown>[] = [];
    let allOrdered = true, allRepeat = true;
    const mids: Record<string, Img> = {};
    for (const id of gpuTransitions) {
      await tx(tp, [{ op: 'set_transition', args: { clipId: inClip, type: id, frames: 29 } }]);
      // frames 60..88 are the transition; 61, 74 (the middle) and 87 are early, half-way and late
      const early = await still(tp, 61), mid = await still(tp, 74), late = await still(tp, 87);
      mids[id] = mid;
      const b = [blueMean(early), blueMean(mid), blueMean(late)];
      const ordered = id === 'flash' ? b[0]! < 110 && b[2]! > 145 : b[0]! < 70 && b[2]! > 185 && b[0]! <= b[1]! + 1 && b[1]! <= b[2]! + 1;
      const repeat = maxDiff(mid, await still(tp, 74)) === 0;
      allOrdered &&= ordered; allRepeat &&= repeat;
      rowsT.push({ id, incomingShare: b.map((x) => Number((x / 255).toFixed(2))), ordered, repeat });
    }
    check(`All ${gpuTransitions.length} GPU transitions start mostly on the outgoing picture, end mostly on the incoming one and never go backwards in between (the flash is checked at its ends only)`, gpuTransitions.length === 33 && allOrdered, rowsT.filter((r) => !r.ordered).length ? rowsT.filter((r) => !r.ordered) : { transitions: gpuTransitions.length });
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
      scope: 'Nineteen effects and the colour looks on synthetic still images at 360x640, on a software WebGPU adapter. Correctness of the passes and of the refusals only: no speed claim, no real footage, no hardware adapter, nobody looked at the pictures.',
      measurements, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/gpu-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nGPU proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
