/**
 * WebGPU effect passes (ADR-0008): the adapter check, two effects (chroma key, wave) checked by pixel in the editor preview,
 * in a still and in an export, agreement between those three, repeatability, and the refusals when no adapter is available.
 *
 *   pnpm build && pnpm proof:gpu
 * Exits 2 (blocked) when this machine's browser gives no WebGPU adapter even with WebGPU enabled.
 * Here that adapter is a software one: this proves the passes are correct, not that they are fast.
 */
import { execFileSync } from 'node:child_process';
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

  process.env.PF_RENDER_GPU = 'auto';
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
      scope: 'Two effects on two synthetic still images at 360x640, on a software WebGPU adapter. Correctness of the passes and of the refusals only: no speed claim, no real footage, no hardware adapter, nobody looked at the pictures.',
      measurements, checks,
    };
    fs.writeFileSync(path.join(root, 'docs/evidence/gpu-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nGPU proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
