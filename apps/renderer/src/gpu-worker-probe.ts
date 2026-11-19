/**
 * Which launch settings give the RENDER WORKER's browser a WebGPU adapter on this machine, and whether what it renders
 * matches the reference pixels. The editor runs in the owner's own browser (see /gpu.html); the worker that renders stills
 * and exports is a separate, normally headless Chromium, and whether it can use WebGPU has to be measured per machine.
 *
 *   pnpm probe:gpu            prints a table and writes .artifacts/worker-gpu-probe.json
 *
 * Each variant renders one fixed fragment shader at 1080x1920 and reads two pixels back. The same shader on any correct
 * implementation gives the same two pixels; a variant that gives others is noted. Timings are one sample each.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

interface Variant { name: string; args: string[]; headless: boolean; channel?: string }
const VARIANTS: Variant[] = [
  { name: 'default headless', args: [], headless: true },
  { name: 'headless + software adapter (SwiftShader)', args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'], headless: true },
  { name: 'headless + webgpu enabled', args: ['--enable-unsafe-webgpu'], headless: true },
  { name: 'headless + gpu enabled', args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'], headless: true },
  { name: 'headless + gpu enabled + D3D11', args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'], headless: true },
  { name: 'headless + gpu enabled + high-performance GPU', args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'], headless: true },
  { name: 'window off-screen (not headless)', args: ['--enable-unsafe-webgpu', '--window-position=-32000,-32000', '--window-size=320,240'], headless: false },
  { name: 'window off-screen + high-performance GPU', args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu', '--window-position=-32000,-32000', '--window-size=320,240'], headless: false },
  { name: 'installed Chrome, headless + gpu enabled', args: ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist'], headless: true, channel: 'chrome' },
];
/** The pixels the fixed shader must give at (0,0) and at the middle of the frame. */
const EXPECTED = { first: [133, 133, 138, 255], middle: [116, 128, 133, 255] };

async function inPage() {
  const gpu = (navigator as any).gpu;
  if (!gpu) return { api: false };
  const a = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!a) return { api: true, adapter: null };
  const info = a.info ?? {};
  const out: any = { api: true, adapter: { vendor: info.vendor ?? null, architecture: info.architecture ?? null, description: info.description ?? null, isFallbackAdapter: a.isFallbackAdapter ?? info.isFallbackAdapter ?? null, float32Filterable: a.features.has('float32-filterable'), maxTextureDimension2D: a.limits.maxTextureDimension2D } };
  const d = await a.requestDevice();
  const W = 1080, H = 1920, format = 'rgba8unorm';
  d.pushErrorScope('validation');
  const tex = d.createTexture({ size: [W, H], format, usage: 0x10 | 0x01 });
  const mod = d.createShaderModule({ code: `
    @vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(p[i], 0, 1); }
    @fragment fn f(@builtin(position) p: vec4f) -> @location(0) vec4f { var c = vec3f(0); for (var k = 0; k < 16; k++) { c += 0.0625 * (0.5 + 0.5 * sin(vec3f(p.x, p.y, p.x + p.y) * 0.01 * f32(k + 1))); } return vec4f(c, 1); }` });
  const pipe = d.createRenderPipeline({ layout: 'auto', vertex: { module: mod, entryPoint: 'v' }, fragment: { module: mod, entryPoint: 'f', targets: [{ format }] } });
  const frame = () => { const e = d.createCommandEncoder(); const p = e.beginRenderPass({ colorAttachments: [{ view: tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] }); p.setPipeline(pipe); p.draw(3); p.end(); d.queue.submit([e.finish()]); };
  frame(); await d.queue.onSubmittedWorkDone();
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) frame();
  await d.queue.onSubmittedWorkDone();
  const t1 = performance.now();
  const stride = Math.ceil((W * 4) / 256) * 256;
  const buf = d.createBuffer({ size: stride * H, usage: 0x01 | 0x08 });
  const e = d.createCommandEncoder(); e.copyTextureToBuffer({ texture: tex }, { buffer: buf, bytesPerRow: stride }, [W, H]); d.queue.submit([e.finish()]);
  await buf.mapAsync(0x01);
  const bytes = new Uint8Array(buf.getMappedRange());
  const at = (x: number, y: number) => Array.from(bytes.slice(stride * y + x * 4, stride * y + x * 4 + 4));
  out.first = at(0, 0); out.middle = at(W >> 1, H >> 1);
  out.msPerFrame = Number(((t1 - t0) / 60).toFixed(2));
  out.readbackMs = Number((performance.now() - t1).toFixed(1));
  out.validationError = (await d.popErrorScope())?.message ?? null;
  d.destroy();
  return out;
}

async function run(v: Variant) {
  const srv = http.createServer((_q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>gpu worker probe</title>'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ args: v.args, headless: v.headless, ...(v.channel ? { channel: v.channel } : {}), timeout: 30_000 });
    const page = await browser.newPage();
    await page.addInitScript('globalThis.__name = (f) => f');
    await page.goto(`http://127.0.0.1:${(srv.address() as any).port}/`);
    const r: any = await Promise.race([page.evaluate(inPage), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 60 s')), 60_000))]);
    const same = (a?: number[], b?: number[]) => !!a && !!b && a.every((x, i) => Math.abs(x - b[i]!) <= 1);
    return { variant: v.name, launch: { args: v.args, headless: v.headless, channel: v.channel ?? 'bundled Chromium' }, browser: browser.version(), ...r, ...(r.first ? { pixelsMatchReference: same(r.first, EXPECTED.first) && same(r.middle, EXPECTED.middle) } : {}) };
  } catch (e: any) {
    return { variant: v.name, launch: { args: v.args, headless: v.headless, channel: v.channel ?? 'bundled Chromium' }, error: String(e?.message ?? e).split('\n')[0]!.slice(0, 200) };
  } finally {
    await browser?.close().catch(() => {});
    srv.close();
  }
}

const results = [];
for (const v of VARIANTS) {
  const r: any = await run(v);
  results.push(r);
  const a = r.adapter;
  console.log(`${r.error ? 'error   ' : a ? (a.isFallbackAdapter ? 'software' : 'hardware') : 'none    '}  ${v.name.padEnd(48)} ${r.error ?? (a ? `${a.vendor ?? '?'} ${a.architecture ?? ''}  ${r.msPerFrame} ms/frame  pixels ${r.pixelsMatchReference ? 'match' : `DIFFER ${JSON.stringify(r.middle)}`}${r.validationError ? `  validation: ${r.validationError}` : ''}` : 'no adapter')}`);
}
const report = { probedAt: new Date().toISOString(), note: 'One run on this machine. Timings are one sample of one simple workload: not performance figures.', system: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length }, expectedPixels: EXPECTED, results };
const outFile = path.resolve(process.argv[2] ?? '.artifacts/worker-gpu-probe.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(report, null, 1) + '\n');
console.log(`\nwrote ${outFile}`);
