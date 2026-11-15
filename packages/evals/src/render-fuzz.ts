/**
 * Render fuzz: random editing sessions (the generator of ops-fuzz) on a live server with real media, then every
 * resulting project must render — an export that succeeds, decodes without errors and has exactly the timeline's frames,
 * stills at three frames, a sound-only export, and a preflight report. A project the editor accepts must be exportable.
 *   pnpm build && pnpm conformance:render-fuzz        (PF_RENDER_FUZZ_SEEDS=10, PF_RENDER_FUZZ_STEPS=160 by default; about ten minutes)
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { createFuzz } from './ops-fuzz.gen.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/render-fuzz');
const SEEDS = Math.max(1, Number(process.env.PF_RENDER_FUZZ_SEEDS ?? 10));
const STEPS = Math.max(1, Number(process.env.PF_RENDER_FUZZ_STEPS ?? 160)); // short sessions leave thin projects (few clips, no effects)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  // real files in the order the generator expects: video with sound, sound only, still picture, video whose picture starts late
  const video = (await generateBarcodeFixture({ out: path.join(art, 'v.mp4'), frames: 240 })).file;
  const sound = path.join(art, 'm.wav'), picture = path.join(art, 'p.png'), late = path.join(art, 'late.mkv');
  ff(['-f', 'lavfi', '-t', '10', '-i', 'sine=f=330:r=48000', '-af', 'volume=0.4', '-ac', '1', '-c:a', 'pcm_s16le', sound]);
  ff(['-f', 'lavfi', '-i', 'testsrc2=s=800x600', '-frames:v', '1', picture]);
  const short = (await generateBarcodeFixture({ out: path.join(art, 'short.mp4'), frames: 120 })).file;
  ff(['-itsoffset', '0.5', '-i', short, '-i', short, '-map', '0:v', '-map', '1:a', '-c', 'copy', late]);
  const files = [video, sound, picture, late];

  const s = await startServer({ port: 8827, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } };
  const rows: any[] = [];
  try {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const fz = createFuzz(seed);
      const rate = fz.rate;
      const row: any = { seed, rate: `${rate.num}/${rate.den}` };
      rows.push(row);
      const pid = (await call('/projects', { name: `render-fuzz-${seed}`, width: 640, height: 360, frameRate: rate })).body.project.id;
      for (const file of files) await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json();
      const doc = async () => (await call(`/projects/${pid}`)).body.project;
      const setup = await call(`/projects/${pid}/transactions`, { ops: fz.setup(await doc()) });
      if (setup.status !== 200) throw new Error(`seed ${seed}: set-up failed: ${JSON.stringify(setup.body).slice(0, 300)}`);
      let accepted = 0, refused = 0;
      const ops: string[] = [];
      for (let step = 0; step < STEPS; step++) {
        const op = fz.gen(await doc());
        const r = await call(`/projects/${pid}/transactions`, { ops: [op] });
        if (r.status === 200) { accepted++; ops.push(op.op); }
        else if (r.status >= 500) throw new Error(`seed ${seed} step ${step}: server error on ${JSON.stringify(op).slice(0, 200)}: ${JSON.stringify(r.body).slice(0, 200)}`);
        else refused++;
      }
      const d = await doc();
      const tl = (await call(`/projects/${pid}/timeline`)).body;
      const frames = T.frameIndexAt(tl.duration, rate);
      const clips = d.sequences.seq_main.tracks.flatMap((t: any) => t.clips);
      row.session = { accepted, refused, clips: clips.length, frames, seconds: Number(T.toSeconds(tl.duration).toFixed(2)), formats: Object.keys(d.variants ?? {}).length, effects: clips.reduce((n: number, c: any) => n + (c.effects?.length ?? 0), 0), freezes: clips.filter((c: any) => c.freeze).length, sped: clips.filter((c: any) => c.speed).length, transitions: clips.filter((c: any) => c.transition).length };
      const problems: string[] = [];
      if (frames < 1) { row.outcome = 'empty-timeline (nothing to render)'; continue; }
      // 1. preflight answers
      const pre = await call(`/projects/${pid}/preflight`);
      if (pre.status !== 200) problems.push(`preflight ${pre.status}`);
      row.preflight = pre.status === 200 ? { blockers: pre.body.blockers, warnings: pre.body.warnings } : null;
      // 2. stills at the first, a middle and the last frame
      for (const i of [0, Math.floor(frames / 2), frames - 1]) { const st = await call(`/projects/${pid}/frame?index=${i}`); if (st.status !== 200) problems.push(`still ${i}: ${st.body?.error?.code ?? st.status}`); }
      // 3. picture + sound export: succeeds, decodes without errors, has exactly the timeline's frames
      const started = await call(`/projects/${pid}/exports`, { quality: 'draft' });
      if (started.status >= 400) problems.push(`export refused: ${started.body?.error?.code}`);
      else {
        const job = await waitJob(started.body.jobId);
        if (job.status !== 'succeeded') problems.push(`export ${job.status}: ${String(job.error?.message ?? job.error?.code).slice(0, 160)}`);
        else {
          const out = path.join(art, `seed-${seed}.mp4`);
          fs.writeFileSync(out, (await call(`/jobs/${job.id}/output`)).body);
          let decodeError = '';
          try { execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', out, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e: any) { decodeError = String(e.stderr ?? e).slice(0, 160); }
          const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_packets', out], { encoding: 'utf8' }));
          const vs = probe.streams.find((x: any) => x.codec_type === 'video'), as = probe.streams.find((x: any) => x.codec_type === 'audio');
          row.export = { frames: Number(vs?.nb_read_packets), rate: vs?.r_frame_rate, videoSeconds: Number(Number(vs?.duration).toFixed(3)), audioSeconds: as ? Number(Number(as.duration).toFixed(3)) : null, bytes: fs.statSync(out).size };
          if (decodeError) problems.push(`exported file does not decode cleanly: ${decodeError}`);
          if (Number(vs?.nb_read_packets) !== frames) problems.push(`frame count ${vs?.nb_read_packets} ≠ timeline ${frames}`);
          const [rn, rd] = String(vs?.r_frame_rate).split('/').map(Number);
          if (rn! * rate.den !== rd! * rate.num) problems.push(`frame rate ${vs?.r_frame_rate}`);
          if (as && Math.abs(Number(as.duration) - Number(vs.duration)) > rate.den / rate.num + 0.03) problems.push(`picture ${vs.duration}s and sound ${as.duration}s differ in length`);
          fs.rmSync(out);
        }
      }
      // 4. sound-only export
      const wj = await call(`/projects/${pid}/exports`, { format: 'wav' });
      if (wj.status < 400) { const j = await waitJob(wj.body.jobId); if (j.status !== 'succeeded') problems.push(`sound export ${j.status}: ${String(j.error?.message ?? j.error?.code).slice(0, 120)}`); }
      else problems.push(`sound export refused: ${wj.body?.error?.code}`);
      // 5. every linked format renders a still
      for (const v of Object.keys(d.variants ?? {})) { const st = await call(`/projects/${pid}/frame?index=${Math.floor(frames / 2)}&variant=${v}`); if (st.status !== 200) problems.push(`format ${v} still: ${st.body?.error?.code ?? st.status}`); }
      row.outcome = problems.length ? `FAILED (${problems.length})` : 'renders';
      if (problems.length) { row.problems = problems; row.ops = ops; }
      console.log(`seed ${String(seed).padStart(2)} ${row.rate.padEnd(11)} ${String(row.outcome).padEnd(12)} ${JSON.stringify(row.session)}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`);
    }
    const bad = rows.filter((r) => /^FAILED/.test(String(r.outcome)));
    const rendered = rows.filter((r) => r.outcome === 'renders');
    check(`every project produced by a random editing session renders: stills, picture+sound export with exactly the timeline's frames, sound-only export, preflight, linked formats (${rendered.length} of ${rows.length} sessions rendered; ${rows.length - rendered.length - bad.length} had an empty timeline)`, bad.length === 0 && rendered.length > 0, bad.map((r) => ({ seed: r.seed, rate: r.rate, problems: r.problems, session: r.session })));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: `${SEEDS} random sessions of ${STEPS} steps each, at five frame rates, on synthetic media. Checks that rendering succeeds and has the right shape (frame count, rate, clean decode, equal picture and sound length); it does NOT check that the pictures or the sound are the right ones.`, passed: checks.length - failed.length, total: checks.length, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/render-fuzz.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nRender fuzz ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
