/**
 * What a seek costs in the preview decoder, and what the frames after it cost: the editor's MediaPool (apps/web/src/media.ts)
 * in headless Chromium, on a barcode fixture (H.264 in MP4, B-frames 2, key frames at most 30 frames apart by default: x264
 * also starts a group where it sees a scene change, so the groups are uneven; where each target lies in its group is recorded).
 *
 *   pnpm bench:seek [--before <git ref>] [--label <name>] [--rounds 5] [--follow 5] [--gaps 0,33] [--scrub-gaps 0,16] [--size 1280x720] [--gop 30]
 *
 * One measurement: on an open decoder, ask for a frame far from the last one (a seek), then for the next `--follow` frames one
 * by one, `gap` milliseconds apart (0: at once, as scrubbing does; 33: as playing on after a jump does). Timed: each request
 * until its picture is there. Counted: the chunks given to VideoDecoder.decode until the last picture is there, and 150 ms later.
 * A second measurement, scrubbing: the same targets asked for one after the other, `--scrub-gaps` milliseconds apart (0: the
 * next seek starts in the same task the picture arrived in, so nothing else runs in between; 16: a pointer move a frame later).
 * A third, play after scrubbing: the targets one after the other with no gap, then the `--follow` frames after the last one.
 * Every picture is drawn and hashed outside the timing.
 * With `--before <ref>` the same page also holds the media.ts of that commit (bundled against this tree's packages) and the two
 * take turns, target by target, so both see the same load; their pictures' hashes are compared frame by frame.
 * Results: docs/evidence/seek-bench.json under the label, beside other labels. One machine, one sample of it; no gate.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { generateBarcodeFixture } from '@pulseframe/fixtures';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d);
const BEFORE = args.includes('--before') ? opt('--before', '') : null;
const LABEL = opt('--label', BEFORE ? `${BEFORE}..tree` : 'tree');
const ROUNDS = Number(opt('--rounds', '5'));
const FOLLOW = Number(opt('--follow', '5'));
const GAPS = opt('--gaps', '0,33').split(',').map(Number);
const SCRUB_GAPS = opt('--scrub-gaps', '0,16').split(',').map(Number);
const [W, H] = opt('--size', '1280x720').split('x').map(Number) as [number, number];
const GOP = Number(opt('--gop', '30'));
const FRAMES = 300;
/** Seek targets (source frames): each is behind the one before it or more than half a second ahead, so every one is a seek. */
const TARGETS = [45, 130, 14, 89, 263, 59, 172];
const root = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(root, 'docs/evidence/seek-bench.json');
const MEDIA = path.join(root, 'apps/web/src/media.ts');
const load = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
const r1 = (x: number) => Math.round(x * 10) / 10;

/** The page's side of one variant: a pool over the local file, one clip, and the timed run. Bundled once per variant. */
const PAGE = `
import { MediaPool } from 'pf-media';
const pool = new MediaPool({ assetUrl: () => { throw new Error('bench: the asset is local'); } });
const canvas = new OffscreenCanvas(${W}, ${H});
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const layer = (frame) => ({ kind: 'video', clipId: 'clp_bench', trackId: 'trk', assetId: 'ast_bench', sourceFrameIndex: frame, sourceSeekSeconds: (frame + 0.5) / 30 });
const hash = (img) => { img.draw(ctx, 0, 0, ${W}, ${H}); const d = new Uint32Array(ctx.getImageData(0, 0, ${W}, ${H}).data.buffer); let h = 2166136261; for (let i = 0; i < d.length; i += 7) h = Math.imul(h ^ d[i], 16777619); return h >>> 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function provide(blob) { pool.provideLocal('ast_bench', blob); }
export async function scrub(targets, gap, follow = 0) {
  const ms = [], hashes = [];
  const c0 = globalThis.__decodes;
  const frames = [...targets];
  for (let i = 1; i <= follow; i++) frames.push(targets.at(-1) + i); // play on from where the scrub stopped
  for (const f of frames) {
    if (ms.length && gap) await sleep(gap);
    const token = pool.frames.begin();
    const t0 = performance.now();
    const img = await pool.frames(layer(f));
    ms.push(performance.now() - t0);
    if (!img) throw new Error('bench: no picture for frame ' + f);
    hashes.push(hash(img));
    pool.frames.end(token);
  }
  const chunks = globalThis.__decodes - c0;
  await sleep(150);
  return { ms, hashes, chunks, chunksSettled: globalThis.__decodes - c0 };
}
export async function run(target, follow, gap) {
  const ms = [], hashes = [];
  const c0 = globalThis.__decodes;
  for (let f = target; f <= target + follow; f++) {
    if (f > target && gap) await sleep(gap);
    const token = pool.frames.begin();
    const t0 = performance.now();
    const img = await pool.frames(layer(f));
    ms.push(performance.now() - t0);
    if (!img) throw new Error('bench: no picture for frame ' + f);
    hashes.push(hash(img));
    pool.frames.end(token);
  }
  const chunks = globalThis.__decodes - c0;
  await sleep(150);
  return { ms, hashes, chunks, chunksSettled: globalThis.__decodes - c0 };
}
`;

/** The part of esbuild's API used here (its types are not resolvable from this package). */
interface EsbuildPluginBuild {
  onResolve(o: { filter: RegExp }, cb: () => { path: string; namespace: string }): void;
  onLoad(o: { filter: RegExp; namespace: string }, cb: () => { contents: string; loader: string; resolveDir: string }): void;
}
interface Esbuild { build(o: Record<string, unknown> & { plugins: { name: string; setup(b: EsbuildPluginBuild): void }[] }): Promise<{ outputFiles: { text: string }[] }> }

async function bundle(name: string, mediaSource: string | null): Promise<string> {
  // esbuild is not a dependency of this package: it is the one tsx (which runs this script) uses. Nothing is installed.
  const esbuild = createRequire(createRequire(import.meta.url).resolve('tsx/package.json'))('esbuild') as Esbuild;
  const web = path.dirname(MEDIA);
  const r = await esbuild.build({
    stdin: { contents: PAGE, resolveDir: web, loader: 'js' },
    bundle: true, write: false, format: 'iife', globalName: `__seekBench_${name}`, platform: 'browser', target: 'es2023', logLevel: 'silent',
    plugins: [{
      name: 'pf-media',
      setup(b) {
        b.onResolve({ filter: /^pf-media$/ }, () => ({ path: MEDIA, namespace: mediaSource === null ? 'file' : 'pf-media-ref' }));
        b.onLoad({ filter: /.*/, namespace: 'pf-media-ref' }, () => ({ contents: mediaSource!, loader: 'ts', resolveDir: web }));
      },
    }],
  });
  return r.outputFiles[0]!.text;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-seekbench-'));
  const fixture = await generateBarcodeFixture({ out: path.join(tmp, 'fixture.mp4'), width: W, height: H, fps: { num: 30, den: 1 }, frames: FRAMES, codec: 'h264', container: 'mp4', gop: GOP, bframes: 2 });
  const keys = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', fixture.file], { encoding: 'utf8' })
    .split('\n').filter((l) => l.includes('K')).map((l) => Math.round(Number(l.split(',')[0]) * 30)).sort((a, b) => a - b);
  const variants: { name: string; what: string; js: string }[] = [];
  if (BEFORE) {
    const commit = execFileSync('git', ['rev-parse', '--short', BEFORE], { cwd: root, encoding: 'utf8' }).trim();
    variants.push({ name: 'before', what: `apps/web/src/media.ts at ${commit} (${BEFORE})`, js: await bundle('before', execFileSync('git', ['show', `${BEFORE}:apps/web/src/media.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 })) });
  }
  const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain', '--', 'apps/web/src/media.ts'], { cwd: root, encoding: 'utf8' }).trim() !== '';
  variants.push({ name: 'tree', what: `apps/web/src/media.ts of the working tree (${head}${dirty ? ', with uncommitted changes' : ''})`, js: await bundle('tree', null) });

  const files: Record<string, { type: string; body: Buffer }> = {
    '/': { type: 'text/html', body: Buffer.from(`<!doctype html><meta charset="utf-8"><script>globalThis.__decodes = 0; { const d = VideoDecoder.prototype.decode; VideoDecoder.prototype.decode = function (c) { globalThis.__decodes++; return d.call(this, c); }; }</script>${variants.map((v) => `<script src="/${v.name}.js"></script>`).join('')}`) },
    '/fixture.mp4': { type: 'video/mp4', body: fs.readFileSync(fixture.file) },
    ...Object.fromEntries(variants.map((v) => [`/${v.name}.js`, { type: 'text/javascript', body: Buffer.from(v.js) }])),
  };
  const server = http.createServer((req, res) => {
    const f = files[req.url ?? ''];
    if (!f) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': f.type, 'content-length': f.body.length }).end(f.body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  const browser = await chromium.launch();
  const loadStart = load();
  type Run = { ms: number[]; hashes: number[]; chunks: number; chunksSettled: number };
  const samples: Record<string, Record<string, Record<string, Run[]>>> = {}; // gap → variant → target → runs
  const scrubs: Record<string, Record<string, Run[]>> = {}; // gap → variant → runs
  const scrubPlay: Record<string, Run[]> = Object.fromEntries(variants.map((v) => [v.name, []]));
  let hashMismatches = 0, hashCompared = 0;
  const compare = (got: Run[]) => { if (got.length === 2) for (let i = 0; i < got[0]!.hashes.length; i++) { hashCompared++; if (got[0]!.hashes[i] !== got[1]!.hashes[i]) hashMismatches++; } };
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => { throw e; });
    await page.goto(url);
    await page.evaluate(async (names) => {
      const blob = await (await fetch('/fixture.mp4')).blob();
      for (const n of names) { (globalThis as any)[`__seekBench_${n}`].provide(blob); await (globalThis as any)[`__seekBench_${n}`].run(250, 1, 0); } // opens the decoder; not recorded
    }, variants.map((v) => v.name));
    for (const gap of GAPS) {
      const g = (samples[String(gap)] = Object.fromEntries(variants.map((v) => [v.name, {} as Record<string, Run[]>])));
      for (let round = 0; round < ROUNDS; round++) {
        for (const target of TARGETS) {
          const order = round % 2 ? [...variants].reverse() : variants;
          const got: Run[] = [];
          for (const v of order) {
            const run = await page.evaluate(([n, t, f, gp]) => (globalThis as any)[`__seekBench_${n}`].run(t, f, gp), [v.name, target, FOLLOW, gap] as const) as Run;
            (g[v.name]![String(target)] ??= []).push(run);
            got.push(run);
          }
          compare(got);
        }
      }
    }
    for (const gap of SCRUB_GAPS) {
      const g = (scrubs[String(gap)] = Object.fromEntries(variants.map((v) => [v.name, [] as Run[]])));
      for (let round = 0; round < ROUNDS; round++) {
        const got: Run[] = [];
        for (const v of round % 2 ? [...variants].reverse() : variants) {
          const run = await page.evaluate(([n, t, gp]) => (globalThis as any)[`__seekBench_${n}`].scrub(t, gp), [v.name, TARGETS, gap] as const) as Run;
          g[v.name]!.push(run);
          got.push(run);
        }
        compare(got);
      }
    }
    for (let round = 0; round < ROUNDS; round++) {
      const got: Run[] = [];
      for (const v of round % 2 ? [...variants].reverse() : variants) {
        const run = await page.evaluate(([n, t, f]) => (globalThis as any)[`__seekBench_${n}`].scrub(t, 0, f), [v.name, TARGETS, FOLLOW] as const) as Run;
        scrubPlay[v.name]!.push(run);
        got.push(run);
      }
      compare(got);
    }
  } finally {
    await browser.close();
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const summary: Record<string, unknown> = {};
  for (const [gap, byVariant] of Object.entries(samples)) {
    for (const [name, byTarget] of Object.entries(byVariant)) {
      const runs = Object.values(byTarget).flat();
      summary[`gap ${gap} ms, ${name}`] = {
        seekMsMedian: r1(median(runs.map((r) => r.ms[0]!))),
        nextFrameMsMedian: r1(median(runs.map((r) => r.ms[1]!))),
        seekAndFollowingMsMedian: r1(median(runs.map((r) => r.ms.reduce((a, b) => a + b, 0)))),
        chunksDecodedMedian: median(runs.map((r) => r.chunks)),
        chunksDecodedSettledMedian: median(runs.map((r) => r.chunksSettled)),
        runs: runs.length,
      };
    }
  }
  for (const [gap, byVariant] of Object.entries(scrubs)) for (const [name, runs] of Object.entries(byVariant)) {
    summary[`scrubbing, gap ${gap} ms, ${name}`] = { seekMsMedian: r1(median(runs.flatMap((r) => r.ms))), allSeeksMsMedian: r1(median(runs.map((r) => r.ms.reduce((a, b) => a + b, 0)))), chunksDecodedMedian: median(runs.map((r) => r.chunks)), chunksDecodedSettledMedian: median(runs.map((r) => r.chunksSettled)), runs: runs.length };
  }
  const N = TARGETS.length;
  for (const [name, runs] of Object.entries(scrubPlay)) {
    summary[`play after scrubbing, ${name}`] = {
      scrubSeekMsMedian: r1(median(runs.flatMap((r) => r.ms.slice(0, N)))),
      firstFrameAfterMsMedian: r1(median(runs.map((r) => r.ms[N]!))),
      framesAfterMsMedian: r1(median(runs.map((r) => r.ms.slice(N).reduce((a, b) => a + b, 0)))),
      allMsMedian: r1(median(runs.map((r) => r.ms.reduce((a, b) => a + b, 0)))),
      chunksDecodedMedian: median(runs.map((r) => r.chunks)), chunksDecodedSettledMedian: median(runs.map((r) => r.chunksSettled)), runs: runs.length,
    };
  }
  const compact = Object.fromEntries(Object.entries(samples).map(([gap, byVariant]) => [gap, Object.fromEntries(Object.entries(byVariant).map(([name, byTarget]) => [name, Object.fromEntries(Object.entries(byTarget).map(([target, runs]) => [target, {
    seekMs: runs.map((r) => r1(r.ms[0]!)), nextFrameMs: runs.map((r) => r1(r.ms[1]!)), followingMs: runs.map((r) => r.ms.slice(1).map(r1)), chunksDecoded: runs.map((r) => r.chunks), chunksDecodedSettled: runs.map((r) => r.chunksSettled),
  }]))]))]));
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { about: 'pnpm bench:seek (packages/evals/src/seek-bench.ts): a seek in the preview decoder and the frames after it, in headless Chromium. Milliseconds per request; chunks = calls of VideoDecoder.decode. One machine, one sample of it under whatever load is recorded; not a gate.' };
  out[LABEL] = {
    ranAt: new Date().toISOString(),
    machine: `${os.cpus()[0]?.model} ×${os.cpus().length}, node ${process.version}, load at start ${loadStart}, at end ${load()}`,
    browser: `Chromium ${browser.version()} (headless, software decode unless the machine says otherwise)`,
    fixture: `barcode ${W}x${H}, H.264 in MP4, 30 fps, ${FRAMES} frames, B-frames 2, key frames at most ${GOP} apart: at frames ${keys.join(', ')}`,
    variants: Object.fromEntries(variants.map((v) => [v.name, v.what])),
    method: `seek targets ${TARGETS.join(', ')} (${TARGETS.map((t) => t - keys.findLast((k) => k <= t)!).join(', ')} frames after their key frame), then the next ${FOLLOW} frames; ${ROUNDS} rounds; variants take turns per target. Scrubbing: the same targets one after the other, ${ROUNDS} rounds, variants take turns per round. Play after scrubbing: the targets with no gap, then the ${FOLLOW} frames after the last one, ${ROUNDS} rounds`,
    ...(variants.length === 2 ? { pictures: { compared: hashCompared, different: hashMismatches } } : {}),
    summary,
    samples: compact,
    playAfterScrubbing: Object.fromEntries(Object.entries(scrubPlay).map(([name, runs]) => [name, { scrubSeekMs: runs.map((r) => r.ms.slice(0, N).map(r1)), framesAfterMs: runs.map((r) => r.ms.slice(N).map(r1)), chunksDecoded: runs.map((r) => r.chunks), chunksDecodedSettled: runs.map((r) => r.chunksSettled) }])),
    scrubbing: Object.fromEntries(Object.entries(scrubs).map(([gap, byVariant]) => [gap, Object.fromEntries(Object.entries(byVariant).map(([name, runs]) => [name, { seekMs: runs.map((r) => r.ms.map(r1)), chunksDecoded: runs.map((r) => r.chunks), chunksDecodedSettled: runs.map((r) => r.chunksSettled) }]))])),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ label: LABEL, machine: out[LABEL].machine, ...(variants.length === 2 ? { pictures: out[LABEL].pictures } : {}), summary }, null, 2));
  if (hashMismatches) { console.error(`seek-bench: ${hashMismatches} of ${hashCompared} pictures differ between the variants`); process.exit(1); }
}

await main();
