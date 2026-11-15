/**
 * Project-settings matrix: the same 30 fps source placed in projects with other frame rates and frame sizes, exported
 * through the server route and checked frame by frame and beep by beep.
 * Rule under test (packages/engine/src/evaluate.ts): project frame i is at time i/fps and shows source frame floor(time × 30).
 *   pnpm build && pnpm conformance:projects
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/project-matrix');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffraw = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

interface Case { name: string; width: number; height: number; num: number; den: number }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'base.mp4') }); // 640×360, 30 fps, 120 frames, beeps at 0, 1, 2, 3 s
  const cases: Case[] = [
    { name: '30 fps 640×360 (control)', width: 640, height: 360, num: 30, den: 1 },
    { name: '24 fps', width: 640, height: 360, num: 24, den: 1 },
    { name: '23.976 fps (24000/1001)', width: 640, height: 360, num: 24000, den: 1001 },
    { name: '25 fps', width: 640, height: 360, num: 25, den: 1 },
    { name: '29.97 fps (30000/1001)', width: 640, height: 360, num: 30000, den: 1001 },
    { name: '50 fps', width: 640, height: 360, num: 50, den: 1 },
    { name: '59.94 fps (60000/1001)', width: 640, height: 360, num: 60000, den: 1001 },
    { name: '60 fps', width: 640, height: 360, num: 60, den: 1 },
    { name: '12 fps', width: 640, height: 360, num: 12, den: 1 },
    { name: '1280×720 at 30 fps', width: 1280, height: 720, num: 30, den: 1 },
    { name: '1920×1080 at 25 fps', width: 1920, height: 1080, num: 25, den: 1 },
    { name: '1080×1920 (vertical) at 30 fps', width: 1080, height: 1920, num: 30, den: 1 },
    { name: '1080×1080 (square) at 29.97 fps', width: 1080, height: 1080, num: 30000, den: 1001 },
    { name: 'odd size 641×361 at 30 fps', width: 641, height: 361, num: 30, den: 1 },
    { name: 'small 160×90 at 30 fps', width: 160, height: 90, num: 30, den: 1 },
  ];
  const s = await startServer({ port: 8825, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const rows: any[] = [];
  try {
    for (const c of cases) {
      const row: any = { case: c.name };
      rows.push(row);
      const rate = { num: c.num, den: c.den };
      const created = await call('/projects', { name: c.name, width: c.width, height: c.height, frameRate: rate });
      if (created.status !== 201) { row.outcome = 'refused-at-creation'; row.detail = `${created.body?.error?.code}: ${String(created.body?.error?.message).slice(0, 120)}`; continue; }
      const pid = created.body.project.id;
      const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'base.mp4' }, body: fs.readFileSync(fixture.file) })).json();
      const add = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: T.frameTime(0, rate) } }] });
      if (add.status !== 200) { row.outcome = 'CLIP-COULD-NOT-BE-PLACED'; row.detail = `${add.body?.error?.code}: ${String(add.body?.error?.message).slice(0, 120)}`; continue; }
      const tl = (await call(`/projects/${pid}/timeline`)).body;
      const frames = T.frameIndexAt(tl.duration, rate);
      row.timeline = { frames, seconds: Number(T.toSeconds(tl.duration).toFixed(4)) };
      const started = await call(`/projects/${pid}/exports`, {});
      if (started.status >= 400) { row.outcome = 'EXPORT-REFUSED'; row.detail = `${started.body?.error?.code}: ${String(started.body?.error?.message).slice(0, 140)}`; continue; }
      let job: any;
      for (;;) { job = (await call(`/jobs/${started.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
      if (job.status !== 'succeeded') { row.outcome = 'EXPORT-FAILED'; row.detail = String(job.error?.message ?? job.error?.code).slice(0, 200); continue; }
      const out = path.join(art, `out-${rows.length}.mp4`);
      fs.writeFileSync(out, (await call(`/jobs/${started.body.jobId}/output`)).body);
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', '-count_packets', out], { encoding: 'utf8' }));
      const vs = probe.streams.find((x: any) => x.codec_type === 'video'), as = probe.streams.find((x: any) => x.codec_type === 'audio');
      const problems: string[] = [];
      // 1. container: size, rate, frame count
      const [rn, rd] = String(vs.r_frame_rate).split('/').map(Number);
      const evenW = c.width + (c.width % 2), evenH = c.height + (c.height % 2);
      row.file = { size: `${vs.width}x${vs.height}`, rate: vs.r_frame_rate, frames: Number(vs.nb_read_packets), videoSeconds: Number(Number(vs.duration).toFixed(4)), audioSeconds: as ? Number(Number(as.duration).toFixed(4)) : null };
      if (rn! * c.den !== rd! * c.num) problems.push('frame rate');
      if (Number(vs.nb_read_packets) !== frames) problems.push('frame count');
      if (!((vs.width === c.width && vs.height === c.height) || (vs.width === evenW && vs.height === evenH))) problems.push('frame size');
      // 2. every frame shows the source frame the rule predicts
      const fb = vs.width * vs.height * 3;
      const raw = ffraw(['-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const fit = Math.min(vs.width / 640, vs.height / 360);
      const rect = { x: (vs.width - 640 * fit) / 2, y: (vs.height - 360 * fit) / 2, w: 640 * fit, h: 360 * fit };
      const n = Math.floor(raw.length / fb);
      const wrong: { at: number; shows: number; want: number }[] = [];
      for (let i = 0; i < n; i++) {
        const want = Math.min(119, Math.floor((i * 30 * c.den) / c.num)); // floor(i/fps × 30), in integers
        const got = readBarcode(raw.subarray(i * fb, (i + 1) * fb), vs.width, 3, rect);
        if (got !== want) wrong.push({ at: i, shows: got, want });
      }
      row.picture = { framesChecked: n, wrong: wrong.length, firstWrong: wrong[0] ?? null };
      if (wrong.length) problems.push('picture');
      // 3. beeps at whole seconds
      const pcm = ffraw(['-i', out, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
      const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
      const onsets: number[] = [];
      for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.1) { onsets.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
      const want = [0, 1, 2, 3].filter((t) => t < row.timeline.seconds - 0.06);
      row.sound = { onsets, want };
      if (onsets.length !== want.length || onsets.some((g, i) => Math.abs(g - want[i]!) > 0.012)) problems.push('sound');
      // 4. picture and sound have the same length (within one frame)
      if (as && Math.abs(Number(as.duration) - Number(vs.duration)) > (c.den / c.num) + 0.03) problems.push('picture and sound differ in length');
      row.outcome = problems.length ? `WRONG (${problems.join(', ')})` : 'exports-correctly';
    }
    for (const r of rows) console.log(`${String(r.outcome).padEnd(30)} ${r.case}${r.detail ? `  — ${r.detail}` : ''}${r.outcome !== 'exports-correctly' && r.file ? `  — timeline ${JSON.stringify(r.timeline)} file ${JSON.stringify(r.file)} picture ${JSON.stringify(r.picture)} sound ${JSON.stringify(r.sound)}` : ''}`);
    const bad = rows.filter((r) => !['exports-correctly', 'refused-at-creation'].includes(r.outcome));
    check(`a project is either refused when it is created or exports with the right size, rate, frames and sound (${rows.length} project settings tried)`, bad.length === 0, bad.map((r) => ({ case: r.case, outcome: r.outcome, detail: r.detail, file: r.file, picture: r.picture, sound: r.sound })));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const tally: Record<string, number> = {};
    for (const r of rows) { const k = String(r.outcome).replace(/ \(.*\)$/, ''); tally[k] = (tally[k] ?? 0) + 1; }
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'One synthetic 4-second 30 fps source in projects with different frame rates and sizes; server export route only. Every exported frame is read from its barcode; sound by beep onsets (±12 ms). Not covered: the preview and browser export at these settings, sources at other rates in these projects, captions and effects at non-integer rates, long timelines at 29.97 fps (timecode drift).', passed: checks.length - failed.length, total: checks.length, tally, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/project-matrix.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nProject matrix ${report.result}: ${report.passed}/${report.total}  ${JSON.stringify(tally)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
