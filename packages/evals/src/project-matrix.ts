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
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/project-matrix');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ffraw = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };

interface Case { name: string; width: number; height: number; num: number; den: number; /** also run the browser export and the editor preview */ browser?: boolean }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'base.mp4') }); // 640×360, 30 fps, 120 frames, beeps at 0, 1, 2, 3 s
  const cases: Case[] = [
    { name: '30 fps 640×360 (control)', width: 640, height: 360, num: 30, den: 1 },
    { name: '24 fps', width: 640, height: 360, num: 24, den: 1 },
    { name: '23.976 fps (24000/1001)', width: 640, height: 360, num: 24000, den: 1001, browser: true },
    { name: '25 fps', width: 640, height: 360, num: 25, den: 1, browser: true },
    { name: '29.97 fps (30000/1001)', width: 640, height: 360, num: 30000, den: 1001, browser: true },
    { name: '50 fps', width: 640, height: 360, num: 50, den: 1 },
    { name: '59.94 fps (60000/1001)', width: 640, height: 360, num: 60000, den: 1001, browser: true },
    { name: '60 fps', width: 640, height: 360, num: 60, den: 1 },
    { name: '12 fps', width: 640, height: 360, num: 12, den: 1, browser: true },
    { name: '1280×720 at 30 fps', width: 1280, height: 720, num: 30, den: 1 },
    { name: '1920×1080 at 25 fps', width: 1920, height: 1080, num: 25, den: 1 },
    { name: '1080×1920 (vertical) at 30 fps', width: 1080, height: 1920, num: 30, den: 1, browser: true },
    { name: '1080×1080 (square) at 29.97 fps', width: 1080, height: 1080, num: 30000, den: 1001 },
    { name: 'odd size 641×361 at 30 fps', width: 641, height: 361, num: 30, den: 1, browser: true },
    { name: 'small 160×90 at 30 fps', width: 160, height: 90, num: 30, den: 1 },
  ];
  const s = await startServer({ port: 8825, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const rows: any[] = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const exportPage = await context.newPage();
  await exportPage.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
  await exportPage.evaluate(() => (window as any).__pfBrowserExport.ready);
  /** Frames (by barcode) and beep onsets of an exported file. */
  const read = (file: string) => {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-count_packets', file], { encoding: 'utf8' }));
    const vs = probe.streams.find((x: any) => x.codec_type === 'video');
    const fb = vs.width * vs.height * 3;
    const raw = ffraw(['-i', file, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fit = Math.min(vs.width / 640, vs.height / 360);
    const rect = { x: (vs.width - 640 * fit) / 2, y: (vs.height - 360 * fit) / 2, w: 640 * fit, h: 360 * fit };
    const frames = Array.from({ length: Math.floor(raw.length / fb) }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), vs.width, 3, rect));
    const pcm = ffraw(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-']);
    const x = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const onsets: number[] = [];
    for (let i = 0, quiet = 0; i < x.length; i++) if (i >= quiet && Math.abs(x[i]!) > 0.1) { onsets.push(Number((i / 48000).toFixed(3))); quiet = i + 48000 * 0.3; }
    return { vs, frames, onsets };
  };
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
      if (!c.browser) continue;
      const wantFrame = (i: number) => Math.min(119, Math.floor((i * 30 * c.den) / c.num));
      // --- browser export of the same project
      const rb: any = {};
      row.browser = rb;
      const r: any = await exportPage.evaluate(([p]) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'high' }), [pid] as const).catch((e) => ({ ok: false, code: 'page_error', message: String(e) }));
      if (!r.ok) { rb.outcome = 'BROWSER-EXPORT-FAILED'; rb.detail = `${r.code}: ${String(r.message).slice(0, 160)}`; }
      else {
        const bf = path.join(art, `browser-${rows.length}.${r.result.container}`);
        fs.writeFileSync(bf, Buffer.from(r.result.base64, 'base64'));
        const got = read(bf);
        const bad = got.frames.map((g, i) => (g === wantFrame(i) ? -1 : i)).filter((i) => i >= 0);
        const [bn, bd] = String(got.vs.avg_frame_rate).split('/').map(Number);
        const fps = bn! / bd!, wantFps = c.num / c.den;
        const snd = [0, 1, 2, 3].filter((t) => t < row.timeline.seconds - 0.06);
        rb.file = { size: `${got.vs.width}x${got.vs.height}`, averageRate: got.vs.avg_frame_rate, frames: got.frames.length, wrongFrames: bad.length, firstWrong: bad.length ? { at: bad[0], shows: got.frames[bad[0]!], want: wantFrame(bad[0]!) } : null, onsets: got.onsets };
        const bp: string[] = [];
        if (got.frames.length !== frames) bp.push('frame count');
        if (bad.length) bp.push('picture');
        if (Math.abs(fps - wantFps) / wantFps > 0.002) bp.push('frame rate');
        if (got.onsets.length !== snd.length || got.onsets.some((g, i) => Math.abs(g - snd[i]!) > 1 / 30)) bp.push('sound');
        rb.outcome = bp.length ? `WRONG (${bp.join(', ')})` : 'correct';
      }
      // --- editor preview: paused frames across the timeline, then the sound of one playback
      const rp: any = {};
      row.preview = rp;
      const ep = await context.newPage();
      const errs: string[] = [];
      ep.on('pageerror', (e) => errs.push(String(e)));
      try {
        await ep.addInitScript(() => { (window as any).__pfAudioTap = true; });
        await ep.goto(`${s.url}/?project=${pid}`);
        await ep.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
        const pps = 90, seen: Record<number, number> = {}, wantSeen: Record<number, number> = {};
        for (const target of [0, 1, 2, Math.floor(frames / 3), Math.floor(frames / 2), frames - 2, frames - 1]) {
          // click the ruler just inside the start of the target frame (the ruler rounds to the nearest frame)
          const xpx = ((target * c.den) / c.num) * pps + 0.5;
          await ep.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const rr = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rr.left + x, clientY: rr.top + 5, bubbles: true })); }, xpx);
          await ep.waitForFunction((t) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, target, { timeout: 15000 }).catch(() => {});
          const shot = await ep.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const fit = Math.min(cv.width / 640, cv.height / 360); const y = Math.round((cv.height - 360 * fit) / 2 + (360 * fit) / 12); return { w: cv.width, h: cv.height, frame: Number(cv.dataset.frame), data: Array.from(cv.getContext('2d')!.getImageData(0, y, cv.width, 1).data.filter((_, i) => i % 4 !== 3)) }; });
          const fit = Math.min(shot.w / 640, shot.h / 360);
          seen[target] = shot.frame === target ? readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: (shot.w - 640 * fit) / 2, y: 0, w: 640 * fit, h: 0 }) : -1;
          wantSeen[target] = wantFrame(target);
        }
        rp.frames = { seen, want: wantSeen };
        const pp: string[] = [];
        if (JSON.stringify(seen) !== JSON.stringify(wantSeen)) pp.push('picture');
        await ep.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const rr = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: rr.left + x, clientY: rr.top + 5, bubbles: true })); }, 0.5);
        await ep.getByTestId('play').click();
        await ep.waitForFunction(() => (window as any).__pfSync().framesPainted > 10 && !document.querySelector('[data-testid=play]')?.textContent?.includes('❚'), undefined, { timeout: 40000 }).catch(() => {});
        const sync = await ep.evaluate(() => (window as any).__pfSync());
        const got = (sync.audioOnsetsTimelineSeconds ?? []).map((v: number) => Number(v.toFixed(3)));
        const snd = [0, 1, 2, 3].filter((t) => t < row.timeline.seconds - 0.35);
        rp.sound = { clock: sync.clock, got, want: snd };
        if (sync.clock !== 'audio' || got.length < snd.length || snd.some((t, i) => Math.abs((got[i] ?? 99) - t) > 1 / 30)) pp.push('sound');
        if (errs.length) { pp.push('page error'); rp.errors = errs.slice(0, 2); }
        rp.outcome = pp.length ? `WRONG (${pp.join(', ')})` : 'correct';
      } catch (e) { rp.outcome = 'PREVIEW-FAILED'; rp.detail = String(e).slice(0, 160); }
      finally { await ep.close(); }
    }
    for (const r of rows) console.log(`${String(r.outcome).padEnd(30)} ${r.case}${r.detail ? `  — ${r.detail}` : ''}${r.outcome !== 'exports-correctly' && r.file ? `  — timeline ${JSON.stringify(r.timeline)} file ${JSON.stringify(r.file)} picture ${JSON.stringify(r.picture)} sound ${JSON.stringify(r.sound)}` : ''}`);
    console.log('\nbrowser export and editor preview (non-integer and extreme rates, vertical, odd size):');
    for (const r of rows) if (r.browser) console.log(`  browser ${String(r.browser.outcome).padEnd(26)} preview ${String(r.preview?.outcome).padEnd(26)} ${r.case}${r.browser.outcome !== 'correct' ? `  — browser ${JSON.stringify(r.browser.file ?? r.browser.detail)}` : ''}${r.preview?.outcome !== 'correct' ? `  — preview ${JSON.stringify({ frames: r.preview?.frames, sound: r.preview?.sound, detail: r.preview?.detail, errors: r.preview?.errors })}` : ''}`);
    const bad = rows.filter((r) => !['exports-correctly', 'refused-at-creation'].includes(r.outcome));
    check(`a project is either refused when it is created or exports with the right size, rate, frames and sound (${rows.length} project settings tried)`, bad.length === 0, bad.map((r) => ({ case: r.case, outcome: r.outcome, detail: r.detail, file: r.file, picture: r.picture, sound: r.sound })));
    const sub = rows.filter((r) => r.browser);
    check(`the browser export and the editor preview agree with the same rule at the non-integer and extreme settings (${sub.length} projects: frames, frame count, average rate, sound)`, sub.length > 0 && sub.every((r) => r.browser.outcome === 'correct' && r.preview?.outcome === 'correct'), sub.filter((r) => r.browser.outcome !== 'correct' || r.preview?.outcome !== 'correct').map((r) => ({ case: r.case, browser: r.browser, preview: r.preview })));
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const tally: Record<string, number> = {};
    for (const r of rows) { const k = String(r.outcome).replace(/ \(.*\)$/, ''); tally[k] = (tally[k] ?? 0) + 1; }
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'One synthetic 4-second 30 fps source in projects with different frame rates and sizes; server export route for all; browser export and editor preview for the non-integer and extreme rates, the vertical and the odd size. Every exported frame is read from its barcode; sound by beep onsets (±12 ms on the server route, one frame on the browser routes). Not covered: sources at other rates in these projects, captions and effects at non-integer rates, long timelines at 29.97 fps (timecode drift).', passed: checks.length - failed.length, total: checks.length, tally, rows, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/project-matrix.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nProject matrix ${report.result}: ${report.passed}/${report.total}  ${JSON.stringify(tally)}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
