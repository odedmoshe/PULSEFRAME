/**
 * Screenshots of the editor for looking at the design (not a proof: nothing is asserted).
 * A small generated project (two portrait clips, music, a title) at two window sizes, in Hebrew and English.
 *   pnpm build && pnpm shots        writes .artifacts/shots/*.png
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/shots');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

async function main() {
  fs.mkdirSync(art, { recursive: true });
  fs.rmSync(path.join(art, 'data'), { recursive: true, force: true });
  const a = path.join(art, 'a.mp4'), b = path.join(art, 'b.mp4'), m = path.join(art, 'music.wav');
  if (!fs.existsSync(a)) ff(['-f', 'lavfi', '-t', '6', '-i', 'mandelbrot=s=1080x1920:r=30:start_scale=2.2:end_scale=0.6', '-f', 'lavfi', '-t', '6', '-i', 'sine=f=220', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', a]);
  if (!fs.existsSync(b)) ff(['-f', 'lavfi', '-t', '5', '-i', 'gradients=s=1080x1920:r=30:c0=0x2a1a5e:c1=0xf5b84b:c2=0x3de0c8:speed=0.02', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', b]);
  if (!fs.existsSync(m)) ff(['-f', 'lavfi', '-t', '12', '-i', 'sine=f=110', '-af', 'tremolo=f=2:d=0.9', '-ac', '2', m]);
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return (await r.json()) as any; };
  const txs = async (pid: string, ops: unknown[]) => call(`/projects/${pid}/transactions`, { ops });
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'] });
  try {
    const empty = (await call('/projects', { name: 'פרויקט חדש', width: 1080, height: 1920 })).project.id;
    const pid = (await call('/projects', { name: 'סרטון לדוגמה', width: 1080, height: 1920 })).project.id;
    const A = await upload(pid, a), B = await upload(pid, b), M = await upload(pid, m);
    const c1 = (await txs(pid, [{ op: 'add_clip', args: { assetId: A.assetId, start: f(0) } }])).results[0].output.clipId;
    await txs(pid, [{ op: 'add_clip', args: { assetId: B.assetId, start: f(180) } }]);
    await txs(pid, [{ op: 'add_clip', args: { assetId: M.assetId, start: f(0) } }]);
    await txs(pid, [{ op: 'add_text', args: { text: 'שלום עולם', start: f(15), duration: f(90) } }]);
    await new Promise((r) => setTimeout(r, 3000)); // thumbnails and waveforms are made in the background
    for (const [name, w, hgt] of [['desktop', 1440, 900], ['laptop', 1280, 720]] as const) {
      const page = await (await browser.newContext({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 })).newPage();
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('deliver-panel').waitFor({ state: 'attached' });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(art, `${name}-he.png`) });
      await page.locator(`.clip[data-clip-id="${c1}"]`).click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(art, `${name}-he-clip.png`) });
      if (name === 'desktop') {
        await page.goto(`${s.ownerUrl}&project=${empty}`);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(art, `${name}-he-empty.png`) });
      }
      await page.close();
    }
  } finally { await browser.close(); await s.close(); }
  console.log(`wrote ${art}/*.png`);
}
main().catch((e) => { console.error(e); process.exit(1); });
