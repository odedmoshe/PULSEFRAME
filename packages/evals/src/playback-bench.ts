/**
 * What the picture of a playing frame costs in the editor preview on CPU canvases, and where the time goes: the lab page
 * (lab.html?bench=playback) in headless Chromium, with the same evaluate + drawGraph and the same draw-then-copy as the
 * player's pump (apps/web/src/player.ts), at the size the player's rule gives (apps/web/src/pictureSize.ts) and at other sizes.
 *
 *   pnpm bench:playback [--label <name>] [--samples 3] [--frames 20] [--no-profile] [--editor]     (needs `pnpm build`; --samples 0: the editor part alone)
 *
 * Scenes: three clips at full opacity; one clip at opacity 0.6 over one at full opacity; three clips at opacity 0.6. Every clip
 * is fitted to the frame, one per track. For a 1920×1080 project (proxies 960×540) and a 1080×1920 project (proxies 304×540),
 * with the pictures given as I420 video frames (what the decoder gives for a proxy) and as bitmaps (what a photo is).
 * Sizes: 'sharper' is the playing size until 2026-11-24 (height at most 960), now the viewer's choice «חד יותר»; 'rule' is the
 * size pictureSize gives by default («חלק»); the others are alternatives that were measured. The last project is the vertical
 * one with proxies sized by the short side (540×960), which the server does not make: what such a proxy rule would change. Every sample visits every cell once, so before and after see the same load;
 * the load average is recorded with each sample.
 * Profile (once per run): `layers` drawImage calls alone, by smoothing quality, source size and target size.
 * With `--editor`, also the editor itself: a server on a new data directory, a 1920×1080 and a 1080×1920 project of three
 * stacked H.264 clips of the project's size (so their proxies are 960×540 and 304×540), played for 4.5 s in the editor with
 * the three clips opaque and then at opacity 0.6. Recorded from the player's own report (syncStats): the canvas size and
 * quality while playing, how many of the frames of the played span were painted, and how late they were painted.
 * PF_WEB_DIST=<dir> measures another build of the web bundle (the editor part of a build from before a change).
 * Results: docs/evidence/playback-bench.json under the label, beside other labels. One machine; no gate.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const LABEL = opt('--label', 'tree');
const SAMPLES = Number(opt('--samples', '3'));
const FRAMES = Number(opt('--frames', '20'));
const PROFILE = !args.includes('--no-profile');
const EDITOR = args.includes('--editor');
const root = path.resolve(import.meta.dirname, '../../..');
const dist = path.resolve(process.env.PF_WEB_DIST ?? path.join(root, 'apps/web/dist'));
const OUT = path.join(root, 'docs/evidence/playback-bench.json');
if (!fs.existsSync(path.join(dist, 'lab.html'))) throw new Error('web bundle missing: run `pnpm build` first');
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');

type Size = [number, number];
type Source = 'video' | 'bitmap';
interface Timing { size: string; frames: number; medianMs: number; minMs: number; maxMs: number }
interface Lab {
  frames(spec: { project: Size; size?: Size; source: Source; sourceSize: Size; opaque: number; faded: number; quality?: 'draft' | 'full'; frames?: number }): Promise<Timing & { quality: string }>;
  raw(spec: { size: Size; source: Source; sourceSize: Size; layers: number; smoothing: string; frames?: number }): Promise<Timing>;
}

const SCENES = [{ name: 'three opaque clips', opaque: 3, faded: 0 }, { name: 'one faded clip over one opaque', opaque: 1, faded: 1 }, { name: 'three faded clips', opaque: 0, faded: 3 }] as const;
/** Per project: its proxies' size, and the sizes to composite at (undefined: the player's rule). */
const PROJECTS: { name: string; project: Size; proxy: Size; sizes: { name: string; size?: Size }[] }[] = [
  { name: '1920x1080', project: [1920, 1080], proxy: [960, 540], sizes: [{ name: 'sharper (height 960, the rule before)', size: [1707, 960] }, { name: 'alternative (height 720)', size: [1280, 720] }, { name: 'rule' }] },
  { name: '1080x1920', project: [1080, 1920], proxy: [304, 540], sizes: [{ name: 'sharper (height 960, the rule before)', size: [540, 960] }, { name: 'rule' }, { name: 'alternative (the proxy\'s own 304x540)', size: [304, 540] }] },
  { name: '1080x1920 if proxies were 540x960', project: [1080, 1920], proxy: [540, 960], sizes: [{ name: 'rule' }] },
];

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
const server = http.createServer((req, res) => {
  const file = path.join(dist, path.normalize(decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)));
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch();

/** The editor playing real projects (see the head of this file). */
async function playInEditor() {
  const T = await import('@pulseframe/time');
  const { startServer } = await import('@pulseframe/server');
  const dir = path.join(root, '.artifacts/playback-bench');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = await startServer({ port: 0, dataDir: path.join(dir, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: (await r.json()) as any }; };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(JSON.stringify(r.body).slice(0, 300)); return r.body; };
  const rows: Record<string, unknown>[] = [];
  try {
    console.log('\n# the editor playing three stacked clips for 4.5 s');
    for (const [name, W, H] of [['1920x1080', 1920, 1080], ['1080x1920', 1080, 1920]] as const) {
      const pid = (await call('/projects', { name: `playback-${name}`, width: W, height: H, frameRate: R })).body.project.id as string;
      const clips: string[] = [];
      for (const [k, src] of ['testsrc2', 'mandelbrot', 'smptehdbars'].entries()) {
        const file = path.join(dir, `${name}-${k}.mp4`);
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-t', '6', '-i', `${src}=s=${W}x${H}:r=30`, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', file]);
        const assetId = ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as { assetId: string }).assetId;
        for (let i = 0; ; i++) { const p = (await call(`/projects/${pid}/assets/${assetId}/derivatives`)).body.derivatives?.find((x: { kind: string }) => x.kind === 'proxy'); if (p?.status === 'ready') break; if (p?.status === 'failed' || i > 600) throw new Error(`the proxy of ${path.basename(file)} is not ready`); await sleep(250); }
        const trackId = k === 0 ? undefined : (await tx(pid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId;
        clips.push((await tx(pid, [{ op: 'add_clip', args: { assetId, ...(trackId ? { trackId } : {}), start: f(0), duration: f(170), withLinkedAudio: false } }])).results[0].output.clipId);
      }
      for (const scene of ['three opaque clips', 'three faded clips']) {
        if (scene === 'three faded clips') await tx(pid, clips.map((clipId) => ({ op: 'set_clip_transform', args: { clipId, transform: { opacity: 0.6 } } })));
        const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
        await page.goto(`${s.ownerUrl}&project=${pid}`);
        const canvas = () => page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return `${c.width}x${c.height} ${c.dataset.quality}`; });
        await page.waitForFunction(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === '0' && c.dataset.quality === 'full'; }, undefined, { timeout: 60_000 });
        await sleep(1500);
        const loadBefore = load();
        await page.getByTestId('play').click();
        const playing = new Set<string>();
        for (const t0 = Date.now(); Date.now() - t0 < 4500; await sleep(300)) playing.add(await canvas());
        await page.getByTestId('play').click();
        const st = await page.evaluate(() => { const x = (window as unknown as { __pfSync(): { clock: string; framesPainted: number; paintLatenessMs: unknown; paintLatenessByFrameMs: [number, number][] } }).__pfSync(); return { clock: x.clock, framesPainted: x.framesPainted, framesInSpan: x.paintLatenessByFrameMs.length ? x.paintLatenessByFrameMs.at(-1)![0] - x.paintLatenessByFrameMs[0]![0] + 1 : 0, paintLatenessMs: x.paintLatenessMs }; });
        await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement).dataset.quality === 'full', undefined, { timeout: 30_000 });
        const row = { project: name, scene, loadBefore, loadAfter: load(), whilePlaying: [...playing].filter((x) => x.endsWith('draft')), paused: await canvas(), ...st };
        rows.push(row);
        console.log(`${name} ${scene.padEnd(18)} load ${loadBefore.split(' ')[0]} | playing ${row.whilePlaying.join(', ')} | painted ${st.framesPainted} of ${st.framesInSpan} | late ${JSON.stringify(st.paintLatenessMs)}`);
        await page.context().close();
      }
    }
  } finally { await s.close(); }
  return rows;
}

try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${url}/lab.html?bench=playback`);
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  const frames = (spec: Parameters<Lab['frames']>[0]) => page.evaluate((s) => (window as unknown as { __pfLabPlayback: Lab }).__pfLabPlayback.frames(s), spec);
  const raw = (spec: Parameters<Lab['raw']>[0]) => page.evaluate((s) => (window as unknown as { __pfLabPlayback: Lab }).__pfLabPlayback.raw(s), spec);

  // ---- profile: the drawImage calls alone ----
  const profile: { from: string; to: string; source: Source; smoothing: string; layers: number; medianMs: number }[] = [];
  if (PROFILE) {
    console.log(`# profile: drawImage alone, median ms per frame (load ${load()})`);
    const CASES: [Size, Size, Source[]][] = [
      [[960, 540], [1707, 960], ['video', 'bitmap']], [[960, 540], [1280, 720], ['video', 'bitmap']], [[960, 540], [960, 540], ['video', 'bitmap']],
      [[304, 540], [540, 960], ['video', 'bitmap']], [[304, 540], [304, 540], ['video', 'bitmap']],
      [[1920, 1080], [1707, 960], ['video']], [[1920, 1080], [960, 540], ['video', 'bitmap']], [[4000, 3000], [1707, 960], ['bitmap']], [[4000, 3000], [960, 540], ['bitmap']],
    ];
    for (const [from, to, sources] of CASES) for (const source of sources) {
      const row: string[] = [];
      for (const smoothing of ['high', 'medium', 'low', 'off']) for (const layers of [1, 3]) {
        const t = await raw({ size: to, source, sourceSize: from, layers, smoothing });
        profile.push({ from: from.join('x'), to: to.join('x'), source, smoothing, layers, medianMs: t.medianMs });
        row.push(`${smoothing}/${layers}: ${t.medianMs}`);
      }
      console.log(`${from.join('x')} -> ${to.join('x')} ${source.padEnd(6)} | ${row.join(' | ')}`);
    }
    console.log(`(load ${load()})`);
  }

  // ---- the playing frame: evaluate + drawGraph (draft) + copy ----
  const samples: { loadBefore: string; loadAfter: string; cells: { project: string; source: Source; scene: string; at: string; size: string; medianMs: number; minMs: number; maxMs: number }[] }[] = [];
  for (let k = 0; k < SAMPLES; k++) {
    const loadBefore = load();
    const cells: (typeof samples)[number]['cells'] = [];
    for (const p of PROJECTS) for (const source of ['video', 'bitmap'] as const) for (const sc of SCENES) for (const at of p.sizes) {
      const t = await frames({ project: p.project, ...(at.size ? { size: at.size } : {}), source, sourceSize: p.proxy, opaque: sc.opaque, faded: sc.faded, quality: 'draft', frames: FRAMES });
      cells.push({ project: p.name, source, scene: sc.name, at: at.name, size: t.size, medianMs: t.medianMs, minMs: t.minMs, maxMs: t.maxMs });
    }
    samples.push({ loadBefore, loadAfter: load(), cells });
    console.log(`# sample ${k + 1}: load ${loadBefore} -> ${samples[k]!.loadAfter}`);
  }
  if (samples.length) console.log('\n# a playing frame (draft): median ms per frame, one figure per sample');
  const first = samples[0]?.cells ?? [];
  for (const [i, c] of first.entries()) console.log(`${c.project.padEnd(33)} ${c.source.padEnd(6)} ${c.scene.padEnd(31)} ${c.at.padEnd(38)} ${c.size.padEnd(9)} ${samples.map((s) => s.cells[i]!.medianMs.toFixed(1).padStart(5)).join(' ')}`);
  if (errors.length) throw new Error(`page errors: ${errors.slice(0, 3).join('; ')}`);
  await page.context().close();
  const editor = EDITOR ? await playInEditor() : undefined;

  const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
  all[LABEL] = {
    ranAt: new Date().toISOString(), cpus: os.cpus().length, chromium: browser.version(), framesPerCell: FRAMES,
    how: 'lab.html?bench=playback: evaluate + drawGraph (draft) on an off-screen { alpha: false } canvas, one copy to the visible canvas, a one-pixel read-back; pictures at the proxy size, a new I420 VideoFrame per frame and layer (video) or an ImageBitmap (bitmap); the first 3 frames of a cell are not counted',
    ...(process.env.PF_WEB_DIST ? { bundle: 'another build of the web bundle (PF_WEB_DIST), named by the label' } : {}), ...(PROFILE ? { profile } : {}), samples, ...(editor ? { editor } : {}),
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(all, null, 1)}\n`);
  console.log(`\nwritten: docs/evidence/playback-bench.json [${LABEL}]`);
} finally {
  await browser.close();
  server.close();
}

process.exit(0);
