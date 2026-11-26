/**
 * Media seek conformance (SPEC Appendix C3 "Media conformance").
 * Fixtures carry a 16-bit frame-index barcode. For each fixture a project is built from N single-frame
 * clips showing seeded-random source frames; the real export render worker (same decoder path as preview)
 * has to seek for every clip. The exported MP4 is decoded and every frame's barcode is compared with the
 * source frame that was asked for. A sequential control (one long clip) checks frame k == source frame k.
 *
 *   pnpm build && pnpm conformance:seek      (env: PF_SEEKS=1000, PF_SEED=1)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture, readBarcode, type BarcodeFixtureOptions } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/conformance');
const SEEKS = Number(process.env.PF_SEEKS ?? 1000);
const SEED = Number(process.env.PF_SEED ?? 1);
const FRAMES = 300;

type Rate = { num: number; den: number };
interface Spec { name: string; codec: 'h264' | 'vp9' | 'av1'; container: 'mp4' | 'webm'; fps: Rate; projectFps: Rate; bframes: number | null; gop: number }
const specs: Spec[] = [
  { name: 'h264-mp4-30-bf2-gop30', codec: 'h264', container: 'mp4', fps: { num: 30, den: 1 }, projectFps: { num: 30, den: 1 }, bframes: 2, gop: 30 },
  { name: 'h264-mp4-30-bf3-gop250', codec: 'h264', container: 'mp4', fps: { num: 30, den: 1 }, projectFps: { num: 30, den: 1 }, bframes: 3, gop: 250 },
  { name: 'h264-mp4-29.97-bf2', codec: 'h264', container: 'mp4', fps: { num: 30000, den: 1001 }, projectFps: { num: 30000, den: 1001 }, bframes: 2, gop: 30 },
  { name: 'h264-mp4-60-in-30fps-project', codec: 'h264', container: 'mp4', fps: { num: 60, den: 1 }, projectFps: { num: 30, den: 1 }, bframes: 2, gop: 60 },
  { name: 'vp9-webm-30', codec: 'vp9', container: 'webm', fps: { num: 30, den: 1 }, projectFps: { num: 30, den: 1 }, bframes: null, gop: 30 },
  { name: 'av1-mp4-30', codec: 'av1', container: 'mp4', fps: { num: 30, den: 1 }, projectFps: { num: 30, den: 1 }, bframes: null, gop: 30 },
  { name: 'h264-mp4-25', codec: 'h264', container: 'mp4', fps: { num: 25, den: 1 }, projectFps: { num: 25, den: 1 }, bframes: 2, gop: 25 },
];

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 640;
const H = 360;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Phase { checked: number; mismatches: number; first: { timelineFrame: number; expected: number; got: number }[]; unsupported?: string; wallSeconds: number }

async function main() {
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const dataDir = fs.mkdtempSync(path.join(art, 'data-'));
  const server = await startServer({ port: 0, dataDir });
  const tok = server.auth.tokens.agent;
  const rest = (p: string, init: RequestInit = {}) => fetch(`${server.url}/api/v1${p}`, { ...init, headers: { authorization: `Bearer ${tok}`, ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } });
  const json = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as any });

  const ffmpegVersion = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0]!;
  let chromium: string | null = null;
  const results: any[] = [];
  const tAll = Date.now();

  /** Export a project, decode the MP4, return frame barcodes. */
  async function exportAndRead(projectId: string, label: string, outBase: string): Promise<{ codes: number[]; wall: number } | { unsupported: string; wall: number }> {
    const t0 = Date.now();
    const start = await json(await rest(`/projects/${projectId}/exports`, { method: 'POST', body: '{}' }));
    if (start.status !== 202) return { unsupported: `export request ${start.status}: ${JSON.stringify(start.body)}`, wall: 0 };
    let job: any;
    for (;;) {
      job = (await json(await rest(`/jobs/${start.body.jobId}`))).body;
      if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'canceled') break;
      await sleep(500);
    }
    const wall = (Date.now() - t0) / 1000;
    chromium ??= job.output?.chromium ?? job.output?.browser ?? null;
    if (job.status !== 'succeeded') return { unsupported: `export job ${job.status}: ${typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}`, wall };
    const mp4 = path.join(art, `${outBase}-${label}.mp4`);
    fs.writeFileSync(mp4, Buffer.from(await (await rest(`/jobs/${job.id}/output`)).arrayBuffer()));
    const raw = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2 ** 31 });
    const fb = W * H * 3;
    const n = Math.floor(raw.length / fb);
    const codes: number[] = [];
    for (let i = 0; i < n; i++) codes.push(readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H }));
    return { codes, wall };
  }

  for (const spec of specs) {
    const fixtureOpts: BarcodeFixtureOptions = { out: path.join(art, `${spec.name}.${spec.container}`), width: W, height: H, fps: spec.fps, frames: FRAMES, codec: spec.codec, container: spec.container, gop: spec.gop, ...(spec.bframes !== null ? { bframes: spec.bframes } : {}) };
    const rec: any = { name: spec.name, codec: spec.codec, container: spec.container, fps: `${spec.fps.num}/${spec.fps.den}`, projectFps: `${spec.projectFps.num}/${spec.projectFps.den}`, bframes: spec.bframes, gop: spec.gop, status: 'pass', randomSeeks: { checked: 0, mismatches: 0 }, sequential: { checked: 0, mismatches: 0 }, exportWallSeconds: 0, detail: {} as any };
    results.push(rec);
    try {
      await generateBarcodeFixture(fixtureOpts);
    } catch (e) {
      rec.status = 'unsupported';
      rec.detail.fixture = `fixture could not be generated: ${(e as Error).message}`;
      console.log(`${rec.name}: unsupported (fixture generation) ${(e as Error).message.slice(0, 200)}`);
      continue;
    }
    const mkProject = async (name: string) => {
      const r = await json(await rest('/projects', { method: 'POST', body: JSON.stringify({ name, width: W, height: H, frameRate: spec.projectFps }) }));
      if (r.status !== 201) throw new Error(`create project ${r.status}`);
      return r.body.project.id as string;
    };
    const projectFor = async (name: string) => {
      const id = await mkProject(name);
      const up = await json(await rest(`/projects/${id}/assets`, { method: 'POST', body: fs.readFileSync(fixtureOpts.out), headers: { 'x-filename': encodeURIComponent(path.basename(fixtureOpts.out)), 'content-type': 'application/octet-stream' } }));
      return { id, up };
    };
    const commitOps = async (id: string, ops: any[]) => {
      for (let i = 0; i < ops.length; i += 200) {
        const r = await json(await rest(`/projects/${id}/transactions`, { method: 'POST', body: JSON.stringify({ ops: ops.slice(i, i + 200) }) }));
        if (r.status !== 200) throw new Error(`commit ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`);
      }
    };

    // ----- random seeks -----
    const rnd = await projectFor(`${spec.name}-random`);
    if (rnd.up.status !== 201) {
      rec.status = 'unsupported';
      rec.detail.ingest = `HTTP ${rnd.up.status} ${JSON.stringify(rnd.up.body)}`;
      console.log(`${rec.name}: unsupported at ingest: ${rec.detail.ingest.slice(0, 250)}`);
      continue;
    }
    const asset = rnd.up.body.asset;
    const assetRate: Rate = asset.video.frameRate;
    rec.detail.asset = { codec: asset.video.codec, frameCount: asset.video.frameCount, frameRate: assetRate, duration: asset.duration };
    const prng = mulberry32(SEED + spec.name.length * 1009);
    // A clip lasts one project frame, i.e. srcRate/projRate source frames: it must fit inside the source.
    const pickable = FRAMES - Math.max(0, Math.ceil((spec.fps.num * spec.projectFps.den) / (spec.fps.den * spec.projectFps.num)) - 1);
    const picks: number[] = [];
    const ops: any[] = [];
    for (let i = 0; i < SEEKS; i++) {
      const s = Math.floor(prng() * pickable);
      picks.push(s);
      ops.push({ op: 'add_clip', args: { assetId: asset.id, trackId: 'trk_video', start: T.frameTime(i, spec.projectFps), sourceIn: T.frameTime(s, assetRate), duration: T.frameTime(1, spec.projectFps), withLinkedAudio: false } });
    }
    await commitOps(rnd.id, ops);
    const run1 = await exportAndRead(rnd.id, 'random', spec.name);
    const phaseR: Phase = { checked: 0, mismatches: 0, first: [], wallSeconds: 0 };
    if ('unsupported' in run1) {
      phaseR.unsupported = run1.unsupported;
      phaseR.wallSeconds = run1.wall;
    } else {
      phaseR.checked = SEEKS;
      if (run1.codes.length !== SEEKS) { phaseR.mismatches++; phaseR.first.push({ timelineFrame: -1, expected: SEEKS, got: run1.codes.length }); }
      for (let i = 0; i < SEEKS; i++) {
        const got = run1.codes[i] ?? -1;
        if (got !== picks[i]) { phaseR.mismatches++; if (phaseR.first.length < 10) phaseR.first.push({ timelineFrame: i, expected: picks[i]!, got }); }
      }
    }
    rec.randomSeeks = { checked: phaseR.checked, mismatches: phaseR.mismatches };

    // ----- sequential control: whole source in one clip -----
    const seq = await projectFor(`${spec.name}-sequential`);
    await commitOps(seq.id, [{ op: 'add_clip', args: { assetId: seq.up.body.asset.id, trackId: 'trk_video', start: T.frameTime(0, spec.projectFps), sourceIn: T.frameTime(0, assetRate), duration: T.frameTime(spec.fps.num === spec.projectFps.num && spec.fps.den === spec.projectFps.den ? FRAMES : Math.round(FRAMES * (spec.projectFps.num / spec.projectFps.den) / (spec.fps.num / spec.fps.den)), spec.projectFps), withLinkedAudio: false } }]);
    const run2 = await exportAndRead(seq.id, 'sequential', spec.name);
    const phaseS: Phase = { checked: 0, mismatches: 0, first: [], wallSeconds: 0 };
    // Source frame expected at output frame k: floor-free exact mapping k * srcRate / projRate (integers only for the cases used here).
    const ratio = (spec.fps.num * spec.projectFps.den) / (spec.fps.den * spec.projectFps.num);
    if ('unsupported' in run2) phaseS.unsupported = run2.unsupported;
    else {
      const expectedCount = Math.round(FRAMES / ratio);
      phaseS.checked = expectedCount;
      if (run2.codes.length !== expectedCount) { phaseS.mismatches++; phaseS.first.push({ timelineFrame: -1, expected: expectedCount, got: run2.codes.length }); }
      for (let k = 0; k < expectedCount; k++) {
        const exp = Math.round(k * ratio);
        const got = run2.codes[k] ?? -1;
        if (got !== exp) { phaseS.mismatches++; if (phaseS.first.length < 10) phaseS.first.push({ timelineFrame: k, expected: exp, got }); }
      }
    }
    rec.sequential = { checked: phaseS.checked, mismatches: phaseS.mismatches };
    rec.detail.randomFirstMismatches = phaseR.first;
    rec.detail.sequentialFirstMismatches = phaseS.first;
    if (phaseR.unsupported) rec.detail.randomUnsupported = phaseR.unsupported;
    if (phaseS.unsupported) rec.detail.sequentialUnsupported = phaseS.unsupported;
    rec.exportWallSeconds = Number(run1.wall.toFixed(1));
    rec.status = phaseR.mismatches + phaseS.mismatches > 0 ? 'fail' : phaseR.unsupported || phaseS.unsupported ? 'unsupported' : 'pass';
    console.log(`${rec.name}: ${rec.status}  random ${rec.randomSeeks.mismatches}/${rec.randomSeeks.checked} bad, sequential ${rec.sequential.mismatches}/${rec.sequential.checked} bad, random-export ${rec.exportWallSeconds}s${phaseR.unsupported ? `  [${phaseR.unsupported.slice(0, 200)}]` : ''}`);
    if (phaseR.first.length) console.log('   first random mismatches:', JSON.stringify(phaseR.first));
    if (phaseS.first.length) console.log('   first sequential mismatches:', JSON.stringify(phaseS.first));
  }

  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  const report = {
    ranAt: new Date().toISOString(),
    machine: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length },
    chromium,
    ffmpeg: ffmpegVersion,
    seed: SEED,
    seeksPerFixture: SEEKS,
    totalWallSeconds: Number(((Date.now() - tAll) / 1000).toFixed(1)),
    fixtures: results,
  };
  fs.writeFileSync(path.join(art, 'seek-conformance.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`report: ${path.relative(root, path.join(art, 'seek-conformance.json'))}, total ${report.totalWallSeconds}s`);
  if (results.some((r) => r.status === 'fail')) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
