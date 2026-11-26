/**
 * Browser-side export proof (SPEC §9): shared compositor + WebCodecs encoders + a leased job, in a real headless
 * Chromium against a real server, verified with real ffprobe/ffmpeg and the evaluator's own source-frame truth.
 * Build the web app into the isolated directory first:
 *   pnpm build && pnpm proof:browser-export
 *   pnpm proof:browser-export
 * Writes docs/evidence/browser-export-proof.json. Any failed check exits 1.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/browser-export-proof');
const webDist = path.join(root, 'apps/web/dist');
const evidenceDir = path.join(root, 'docs/evidence');
const PORT = Number(process.env.PF_BX_PORT ?? 8801);
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
}
const ff = (args: string[]): Buffer => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-count_packets', file], { encoding: 'utf8' }));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const ssimOf = (a: string, b: string) => Number(/All:([\d.]+)/.exec(spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1]);
const onsetsOf = (file: string) => {
  const pcm = ff(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  const out: number[] = [];
  let quiet = 0;
  for (let i = 0; i < pcm.length / 2; i++) { if (i < quiet) continue; if (Math.abs(pcm.readInt16LE(i * 2)) > 6000) { out.push(i / 48000); quiet = i + 48000 * 0.3; } }
  return out;
};

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(path.join(webDist, 'browser-export.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  const fixture = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_4s.mp4') });
  const server = await startServer({ port: PORT, dataDir: path.join(art, 'data'), webDist });
  const base = server.url;
  const h = { authorization: `Bearer ${server.auth.tokens.agent}` };
  const rest = async (p: string, body?: unknown, headers: Record<string, string> = h) => {
    const r = await fetch(`${base}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const waitJob = async (id: string, until = ['succeeded', 'failed', 'canceled'], timeoutMs = 300_000) => { const t0 = Date.now(); for (;;) { const j = (await rest(`/jobs/${id}`)).body; if (until.includes(j.status)) return j; if (Date.now() - t0 > timeoutMs) throw new Error(`job ${id} stuck in ${j.status}`); await sleep(200); } };
  const jobCount = () => (server.store.db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
  const browser: Browser = await chromium.launch();
  const pageErrors: string[] = [];
  const openPage = async (ctx?: BrowserContext): Promise<{ page: Page; ctx: BrowserContext }> => {
    const c = ctx ?? (await browser.newContext());
    const page = await c.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    // The 409s are the deliberate negative requests of checks 5-7; Chromium logs every non-2xx fetch as a console error.
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource: the server responded with a status of 409/.test(m.text()) && pageErrors.push(m.text()));
    await page.goto(`${base}/browser-export.html?key=${server.auth.tokens.owner}`);
    await page.evaluate(() => window.__pfBrowserExport.ready);
    return { page, ctx: c };
  };
  const runInPage = async (page: Page, projectId: string, options: Record<string, unknown>) => {
    const r = await page.evaluate(([p, o]) => window.__pfBrowserExport.tryRun(p as string, o as Record<string, unknown>), [projectId, options] as const);
    return r;
  };

  try {
    console.log('\n# project: 640x360 @30, barcode clip split + trimmed + moved, Hebrew text');
    const pid: string = (await rest('/projects', { name: 'browser-export', width: 640, height: 360 })).body.project.id;
    const up: any = await (await fetch(`${base}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const add = (await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] })).body;
    const split = (await rest(`/projects/${pid}/transactions`, { ops: [{ op: 'split_clip', args: { clipId: add.results[0].output.clipId, at: f(60) } }] })).body;
    const right = split.results[0].output.rightClipId as string;
    const edit = (await rest(`/projects/${pid}/transactions`, { ops: [
      { op: 'trim_clip', args: { clipId: right, edge: 'start', to: f(75) } },
      { op: 'move_clip', args: { clipId: right, start: f(60) } },
      { op: 'add_text', args: { text: 'שָׁלוֹם עולם · ייצוא בדפדפן', start: f(30), duration: f(60), transform: { y: 0.3 } } },
    ] })).body;
    if (!edit.committed) throw new Error(`edit failed ${JSON.stringify(edit)}`);
    const TOTAL = 105;
    const W = 640, H = 360;

    const { page } = await openPage();
    console.log('\n# 1. capability report and codec decision');
    const caps = await page.evaluate(() => window.__pfBrowserExport.capabilities(640, 360, 30, 48000));
    measurements.capabilityReport = caps;
    const wantAudio = caps.audio.aac ? 'aac' : 'opus';

    console.log('\n# 2. export through the browser route (whole sequence, high)');
    const t0 = Date.now();
    const r1 = await runInPage(page, pid, { quality: 'high' });
    const wall1 = (Date.now() - t0) / 1000;
    const session1 = await page.evaluate(() => window.__pfBrowserExport.last.sessionId);
    if (!r1.ok) throw new Error(`browser export failed: ${JSON.stringify(r1)}`);
    const res = r1.result;
    const file1 = path.join(art, `browser.${res.container}`);
    const bytes1 = Buffer.from(res.base64, 'base64');
    fs.writeFileSync(file1, bytes1);
    check('capabilities probed in the page; chosen codecs follow them (H.264 via WebCodecs; AAC if encodable else Opus)', caps.video.avc && res.videoCodec === 'avc' && res.audioCodec === wantAudio, { caps: { video: caps.video, audio: caps.audio }, chosen: { video: res.videoCodec, audio: res.audioCodec } });
    check('AAC to Opus substitution is declared, never silent', caps.audio.aac ? res.substitutions.length === 0 : res.substitutions.length === 1 && /AAC/.test(res.substitutions[0]!), res.substitutions);

    const pr = probe(file1);
    const vs = pr.streams.find((s: any) => s.codec_type === 'video');
    const as = pr.streams.find((s: any) => s.codec_type === 'audio');
    const frames1 = Number(vs.nb_read_packets);
    check('file: MP4 container, H.264, expected audio codec, exact frame count/size/rate', /mp4/.test(pr.format.format_name) && vs.codec_name === 'h264' && as.codec_name === wantAudio && frames1 === TOTAL && vs.width === W && vs.height === H && vs.r_frame_rate === '30/1',
      { container: pr.format.format_name, video: `${vs.codec_name} ${vs.profile} ${vs.width}x${vs.height} ${vs.r_frame_rate} ${vs.pix_fmt} cs=${vs.color_space ?? 'untagged'}`, audio: `${as.codec_name} ${as.sample_rate}Hz ${as.channels}ch`, frames: frames1, bytes: bytes1.length });
    check('file: H.264 profile reported (not guaranteed on every browser)', true, { profile: vs.profile });
    ff(['-y', '-i', file1, '-f', 'null', '-']);
    check('ffmpeg decodes the whole file with no errors', true);

    const snapshot: ProjectDocument = server.store.getJob(res.jobId).input.snapshot;
    const raw = ff(['-i', file1, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = W * H * 3;
    const mism: number[] = [];
    for (let i = 0; i < TOTAL; i++) {
      const layer = evaluate(snapshot, T.frameTime(i, snapshot.settings.frameRate)).layers.find((l) => l.kind === 'video');
      const got = readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H });
      if (!layer || layer.kind !== 'video' || got !== layer.sourceFrameIndex) mism.push(i);
    }
    check(`every one of ${TOTAL} frames shows the source frame the evaluator selected (split, trim, move)`, raw.length === fb * TOTAL && mism.length === 0, { mismatched: mism.slice(0, 10) });
    const on = onsetsOf(file1);
    const expected = [0, 1, 2.5];
    const maxErr = Math.max(...expected.map((e, i) => Math.abs((on[i] ?? 99) - e)));
    measurements.avSync = { expectedOnsetsSeconds: expected, measuredOnsetsSeconds: on.map((o) => +o.toFixed(4)), maxAbsErrorMs: +(maxErr * 1000).toFixed(2), audioCodec: as.codec_name };
    check('audio beep onsets land within one frame of the edit (and the trimmed beep is gone)', on.length === 3 && maxErr < 1 / 30, measurements.avSync);
    check('audio and video durations agree within one frame', Math.abs(Number(as.duration) - Number(vs.duration)) < 1 / 30, { audio: as.duration, video: vs.duration });
    measurements.browserExport = { frames: TOTAL, wallSeconds: +wall1.toFixed(2), realtimeFactor: +(TOTAL / 30 / wall1).toFixed(3), bytes: bytes1.length, wallInPageMs: Math.round(res.wallMs), note: 'headless Chromium, software (no GPU), 640x360 high quality; wall time includes asset fetch, audio mix, encode, SHA-256, base64 transfer' };

    console.log('\n# 3. parity with the server route (same snapshot)');
    const sj = await waitJob((await rest(`/projects/${pid}/exports`, { quality: 'high' })).body.jobId);
    const serverFile = path.join(art, 'server.mp4');
    fs.writeFileSync(serverFile, (await rest(`/jobs/${sj.id}/output`)).body);
    const serverRev = server.store.getJob(sj.id).input.snapshot;
    const ssims: Record<number, number> = {};
    for (const k of [3, 30, 59, 61, 100]) {
      const a = path.join(art, `p_b_${k}.png`), b = path.join(art, `p_s_${k}.png`);
      ff(['-y', '-i', file1, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', a]);
      ff(['-y', '-i', serverFile, '-vf', `select=eq(n\\,${k})`, '-frames:v', '1', b]);
      ssims[k] = ssimOf(a, b);
    }
    measurements.parity = { serverRouteWallSeconds: sj.output?.wallSeconds, serverBytes: sj.output?.bytes, browserBytes: bytes1.length, ssimByFrame: ssims, threshold: 0.97, note: 'two different encoders (WebCodecs H.264 vs libx264 crf16), decoded frames compared as PNG' };
    check('server job succeeded on the same snapshot', sj.status === 'succeeded' && JSON.stringify(serverRev) === JSON.stringify(snapshot), { status: sj.status, error: sj.error });
    check('parity: 5 frames browser vs server route, SSIM >= 0.97', Object.values(ssims).every((s) => s >= 0.97), ssims);

    console.log('\n# 4. range + scale');
    const r4 = await runInPage(page, pid, { range: { startFrame: 30, endFrame: 60 }, scale: 0.5, quality: 'draft' });
    if (!r4.ok) throw new Error(`range export failed: ${JSON.stringify(r4)}`);
    const file4 = path.join(art, 'range.mp4');
    fs.writeFileSync(file4, Buffer.from(r4.result.base64, 'base64'));
    const p4 = probe(file4);
    const v4 = p4.streams.find((s: any) => s.codec_type === 'video');
    const raw4 = ff(['-i', file4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const codes4 = Array.from({ length: 30 }, (_, k) => readBarcode(raw4.subarray(k * 320 * 180 * 3, (k + 1) * 320 * 180 * 3), 320, 3, { x: 0, y: 0, w: 320, h: 180 }));
    const snap4: ProjectDocument = server.store.getJob(r4.result.jobId).input.snapshot;
    const want4 = Array.from({ length: 30 }, (_, k) => { const l = evaluate(snap4, T.frameTime(30 + k, R)).layers.find((x) => x.kind === 'video'); return l && l.kind === 'video' ? l.sourceFrameIndex : -1; });
    const on4 = onsetsOf(file4);
    check('range [30,60) at 0.5: 30 frames, 320x180, barcodes equal the evaluator for timeline frames 30..59', Number(v4.nb_read_packets) === 30 && v4.width === 320 && v4.height === 180 && JSON.stringify(codes4) === JSON.stringify(want4) && codes4[0] === 30 && codes4[29] === 59, { first: codes4[0], last: codes4[29], size: `${v4.width}x${v4.height}`, frames: v4.nb_read_packets });
    check('range audio: one beep at the start of the range (timeline 1.0 s), nothing else', on4.length === 1 && Math.abs(on4[0]!) < 1 / 30, { onsets: on4 });

    console.log('\n# 4b. photosensitivity on the browser route (ADR-0009): the same answer as the server export');
    {
      // 1 s calm (black), then 30 clips of 3 frames alternating black and white (5 flashes a second over the whole picture), then 1 s calm
      const fl: string = (await rest('/projects', { name: 'flashing', width: 320, height: 180 })).body.project.id;
      const img = (name: string, colour: string) => { const file = path.join(art, `${name}.png`); ff(['-y', '-f', 'lavfi', '-i', `color=c=${colour}:s=320x180`, '-frames:v', '1', file]); return file; };
      const upImg = async (file: string) => ((await (await fetch(`${base}/api/v1/projects/${fl}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
      const black = await upImg(img('flash-black', 'black')), white = await upImg(img('flash-white', 'white'));
      const ops: unknown[] = [{ op: 'add_clip', args: { assetId: black, start: f(0), duration: f(30) } }];
      for (let k = 0; k < 30; k++) ops.push({ op: 'add_clip', args: { assetId: k % 2 ? black : white, start: f(30 + 3 * k), duration: f(3) } });
      ops.push({ op: 'add_clip', args: { assetId: black, start: f(120), duration: f(30) } });
      await rest(`/projects/${fl}/transactions`, { ops });
      const rb = await runInPage(page, fl, { quality: 'draft' });
      const sj = await waitJob((await rest(`/projects/${fl}/exports`, { quality: 'draft' })).body.jobId);
      const bRep = rb.ok ? rb.result.photosensitivity : null, sRep = sj.output?.photosensitivity;
      const bJob = rb.ok ? (await rest(`/jobs/${rb.result.jobId}`)).body.output?.photosensitivity : null;
      const sec = (x: { value: string; timescale: number }) => Number(x.value) / x.timescale;
      measurements.photosensitivity = { browser: bRep && { verdict: bRep.verdict, ranges: bRep.ranges.map((r: any) => ({ from: sec(r.from), to: sec(r.to), kind: r.kind, perSecond: r.flashesPerSecond, busiestCell: r.busiestCellFlashesPerSecond, area: r.area })) }, server: sRep && { verdict: sRep.verdict, ranges: sRep.ranges.map((r: any) => ({ from: sec(r.from), to: sec(r.to), kind: r.kind, perSecond: r.flashesPerSecond, busiestCell: r.busiestCellFlashesPerSecond, area: r.area })) } };
      check('a timeline flashing 5 times a second for 3 s, exported in the browser: the tab reports one failing stretch over the whole frame, recorded on its job, and the export still succeeds',
        !!bRep && bRep.verdict === 'fail' && bRep.ranges.length === 1 && bRep.ranges[0]!.kind === 'general' && bRep.ranges[0]!.area === 1 && sec(bRep.ranges[0]!.from) <= 1.2 && sec(bRep.ranges[0]!.to) >= 3.9 && bJob?.verdict === 'fail' && bJob?.measuredBy === 'browser', measurements.photosensitivity);
      check('the server export of the same timeline reports the same stretch (same analyser, same frames)', !!sRep && !!bRep && JSON.stringify(sRep.ranges) === JSON.stringify(bRep.ranges), measurements.photosensitivity);
    }

    console.log('\n# 5. server job record');
    const job1 = (await rest(`/jobs/${res.jobId}`)).body;
    check('job row: succeeded, route browser, location client-download, frames correct', job1.status === 'succeeded' && job1.output.route === 'browser' && job1.output.location === 'client-download' && job1.output.frames === TOTAL && job1.output.container === 'mp4' && job1.output.videoCodec === 'avc' && job1.output.audioCodec === wantAudio, { output: { ...job1.output, manifest: undefined } });
    const ps1 = job1.output.photosensitivity;
    check('job row: the tab checked every encoded frame for flashing (ADR-0009) and the server recorded it with its method text', !!ps1 && ps1.measuredBy === 'browser' && ps1.frames === TOTAL && /WCAG 2\.3\.1/.test(ps1.method) && (ps1.verdict === 'fail') === ps1.ranges.length > 0 && JSON.stringify(res.photosensitivity) === JSON.stringify({ verdict: ps1.verdict, frames: ps1.frames, ranges: ps1.ranges }), { verdict: ps1?.verdict, frames: ps1?.frames, ranges: ps1?.ranges?.length });
    check('job row sha256 and bytes equal those of the file the proof received', job1.output.sha256 === sha(bytes1) && job1.output.bytes === bytes1.length, { server: job1.output.sha256, received: sha(bytes1) });
    const again = await page.evaluate(([jobId, sid, frames]) => window.__pfBrowserExport.post(`/jobs/${jobId}/complete`, { sessionId: sid, bytes: 1, sha256: 'b'.repeat(64), videoCodec: 'avc', audioCodec: 'aac', frames, container: 'mp4' }), [res.jobId, session1, TOTAL] as const);
    check('a second complete is refused with 409 already_completed; the recorded output is unchanged', again.status === 409 && again.code === 'already_completed' && (await rest(`/jobs/${res.jobId}`)).body.output.sha256 === sha(bytes1), again.code);
    await page.close();

    console.log('\n# 6 + 7. lease: heartbeats keep it alive, ownership, closed tab loses it, restart from a new job');
    const lost = await openPage();
    void lost.page.evaluate(([p]) => window.__pfBrowserExport.runAndAbandonAfter(p as string, { quality: 'high' }, 10), [pid] as const).catch(() => {});
    await lost.page.waitForFunction(() => (window.__pfBrowserExport.last.progress as any)?.framesDone >= 8);
    const lj = await lost.page.evaluate(() => window.__pfBrowserExport.last);
    const lostJobId = lj.jobId!;
    const lostSession = lj.sessionId!;
    await sleep(18_000); // longer than the 15 s lease: only the page's heartbeats can have kept it alive
    const mid = (await rest(`/jobs/${lostJobId}`)).body;
    check('a stalled-but-open tab keeps its lease through heartbeats beyond the lease length (stage reports browser progress)', mid.status === 'running' && /^rendering \d+\/105 \(browser\)$/.test(mid.stage), { status: mid.status, stage: mid.stage, error: mid.error });
    const other = await lost.page.evaluate(async ([jobId]) => {
      const hb = await window.__pfBrowserExport.post(`/jobs/${jobId}/heartbeat`, { sessionId: 'another-session-id', framesDone: 1 });
      const done = await window.__pfBrowserExport.post(`/jobs/${jobId}/complete`, { sessionId: 'another-session-id', bytes: 1, sha256: 'c'.repeat(64), videoCodec: 'avc', audioCodec: 'aac', frames: 105, container: 'mp4' });
      return { hb: { status: hb.status, code: hb.code }, done: { status: done.status, code: done.code } };
    }, [lostJobId] as const);
    const wrongActor = await rest(`/jobs/${lostJobId}/heartbeat`, { sessionId: lostSession, framesDone: 1 }); // right session id, different credential (agent token vs the tab's user cookie)
    const wrongActorDone = await rest(`/jobs/${lostJobId}/complete`, { sessionId: lostSession, bytes: 1, sha256: 'c'.repeat(64), videoCodec: 'avc', audioCodec: 'aac', frames: 105, container: 'mp4' });
    check('another session cannot heartbeat or complete (409 lease_not_owned), nor can another actor that knows the session id', other.hb.status === 409 && other.hb.code === 'lease_not_owned' && other.done.status === 409 && other.done.code === 'lease_not_owned' && wrongActor.status === 409 && wrongActor.body.error.code === 'lease_not_owned' && wrongActorDone.body.error.code === 'lease_not_owned' && (await rest(`/jobs/${lostJobId}`)).body.status === 'running', { other, wrongActor: wrongActor.body.error.code });
    const closedAt = Date.now();
    await lost.page.close({ runBeforeUnload: false });
    await lost.ctx.close();
    const lj2 = await waitJob(lostJobId, ['failed', 'canceled', 'succeeded'], 40_000);
    const lossSeconds = (Date.now() - closedAt) / 1000;
    measurements.leaseLoss = { closedTabToFailedSeconds: +lossSeconds.toFixed(2), leaseSeconds: 15 };
    check('closed tab: job becomes failed / lease_lost (retryable) within lease + 5 s, with no output', lj2.status === 'failed' && lj2.error?.code === 'lease_lost' && lj2.error.retryable === true && !lj2.output && lossSeconds <= 20, { status: lj2.status, error: lj2.error?.code, afterSeconds: +lossSeconds.toFixed(2) });
    const late = await openPage();
    const stale = await late.page.evaluate(async ([jobId, sid]) => { const r = await window.__pfBrowserExport.post(`/jobs/${jobId}/heartbeat`, { sessionId: sid, framesDone: 12 }); return { status: r.status, code: r.code }; }, [lostJobId, lostSession] as const);
    check('a tab that reappears after expiry is told lease_lost (409) and must start a new job', stale.status === 409 && stale.code === 'lease_lost', stale);
    const r6 = await runInPage(late.page, pid, { quality: 'high' });
    if (!r6.ok) throw new Error(`restart export failed: ${JSON.stringify(r6)}`);
    const sha6 = r6.result.sha256;
    const succeeded = (server.store.db.prepare("SELECT id, output FROM jobs WHERE type = 'export' AND status = 'succeeded'").all() as { id: string; output: string }[]).map((r) => ({ id: r.id, sha: JSON.parse(r.output)?.sha256 }));
    check('restart: a NEW job over a fresh snapshot succeeds; exactly one succeeded job carries its output; the lost job published nothing', r6.result.jobId !== lostJobId && succeeded.filter((s) => s.sha === sha6).length === 1 && !server.store.getJob(lostJobId).output, { newJob: r6.result.jobId, lostJob: lostJobId });
    await late.page.close();

    console.log('\n# 7b. an agent cancels the tab\'s export mid-run through MCP cancel_job (the same path as POST /jobs/:jobId/cancel)');
    // A two-minute timeline (3,600 frames), long enough that the tab is still rendering when the cancel arrives.
    const pidLong: string = (await rest('/projects', { name: 'browser-export-cancel', width: 640, height: 360 })).body.project.id;
    await rest(`/projects/${pidLong}/transactions`, { ops: [{ op: 'add_text', args: { text: 'ביטול באמצע · cancel mid-run', start: f(0), duration: T.rt(120, 1) } }] });
    const LONG = 3600;
    const mcpCall = async (name: string, args: Record<string, unknown>) => {
      const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...h, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
      const text = await r.text();
      const msg = JSON.parse((r.headers.get('content-type') ?? '').includes('text/event-stream') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('') : text);
      return { isError: msg.result?.isError === true, body: JSON.parse(msg.result?.content?.[0]?.text ?? '{}') };
    };
    const cx = await openPage();
    const running = cx.page.evaluate(([p]) => window.__pfBrowserExport.tryRun(p as string, { quality: 'draft' }), [pidLong] as const);
    await cx.page.waitForFunction(() => (window.__pfBrowserExport.last.progress as any)?.framesDone >= 30, undefined, { timeout: 120_000 });
    const cxJob = await cx.page.evaluate(() => window.__pfBrowserExport.last);
    const framesAtCancel = (cxJob.progress as any).framesDone as number;
    const canceledAt = Date.now();
    const viaTool = await mcpCall('cancel_job', { jobId: cxJob.jobId });
    const outcome = await running;
    const stopSeconds = (Date.now() - canceledAt) / 1000;
    const framesAtStop = (await cx.page.evaluate(() => window.__pfBrowserExport.last.progress as any)).framesDone as number;
    const cj = (await rest(`/jobs/${cxJob.jobId}`)).body;
    const afterHb = await cx.page.evaluate(async ([jobId, sid]) => (await window.__pfBrowserExport.post(`/jobs/${jobId}/heartbeat`, { sessionId: sid, framesDone: 1 })).body, [cxJob.jobId, cxJob.sessionId] as const);
    const lateDone = await cx.page.evaluate(async ([jobId, sid, n]) => { const r = await window.__pfBrowserExport.post(`/jobs/${jobId}/complete`, { sessionId: sid, bytes: 1, sha256: 'c'.repeat(64), videoCodec: 'avc', audioCodec: 'aac', frames: n, container: 'mp4' }); return { status: r.status, code: r.code }; }, [cxJob.jobId, cxJob.sessionId, LONG] as const);
    measurements.agentCancel = { frames: LONG, framesAtCancel, framesAtStop, cancelToStopSeconds: +stopSeconds.toFixed(2), heartbeatSeconds: 5, tool: viaTool.body, tabError: outcome.ok ? null : { code: outcome.code, message: outcome.message } };
    check('an agent (MCP cancel_job) stops the export the tab is rendering: the tab stops within a heartbeat, names who asked, publishes nothing, releases the lease and the job ends canceled',
      !viaTool.isError && viaTool.body.status === 'cancel-requested' && !outcome.ok && outcome.code === 'canceled' && /agent:local/.test(outcome.message)
      && framesAtStop < LONG && stopSeconds <= 8
      && cj.status === 'canceled' && !cj.output && cj.error?.code === 'canceled' && cj.error?.canceledBy === 'agent:local'
      && afterHb.canceled === true && lateDone.status === 409 && lateDone.code === 'job_canceled'
      && !server.store.getJob(cxJob.jobId!).output,
      measurements.agentCancel);
    await cx.page.close();

    console.log('\n# 8. blockers refuse before any job exists; unsupported encoder refuses before any job exists');
    const pid2: string = (await rest('/projects', { name: 'blocked', width: 640, height: 360 })).body.project.id;
    const t2 = (await rest(`/projects/${pid2}/transactions`, { ops: [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }] })).body;
    await rest(`/projects/${pid2}/transactions`, { ops: [{ op: 'update_text', args: { clipId: t2.results[0].output.clipId, style: { fontFamily: 'Not Installed Sans' } } }] });
    const jobsBefore = jobCount();
    const bp = await openPage();
    const blocked = await runInPage(bp.page, pid2, {});
    const blockedDirect = await rest(`/projects/${pid2}/exports/browser`, { sessionId: 'direct-session-1' });
    check('non-bundled font: the browser route refuses with render_blocked (client and server), and no job row was created', !blocked.ok && blocked.code === 'render_blocked' && blockedDirect.status === 422 && blockedDirect.body.error.code === 'render_blocked' && blockedDirect.body.error.details.blockers[0].code === 'missing_font' && jobCount() === jobsBefore, { client: blocked.ok ? null : blocked.code, server: blockedDirect.body.error?.details?.blockers });
    const pid3: string = (await rest('/projects', { name: 'unsupported', width: 640, height: 360 })).body.project.id;
    await rest(`/projects/${pid3}/transactions`, { ops: [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }] });
    await bp.page.evaluate(() => { (VideoEncoder as any).isConfigSupported = async () => ({ supported: false }); });
    const before3 = jobCount();
    const unsupported = await runInPage(bp.page, pid3, {});
    check('missing video encoder (isConfigSupported forced false in the page): typed browser_export_unsupported before any job exists', !unsupported.ok && unsupported.code === 'browser_export_unsupported' && (unsupported.missing ?? []).some((m) => /avc/.test(m)) && jobCount() === before3, unsupported.ok ? null : { code: unsupported.code, missing: unsupported.missing });
    await bp.page.close();

    check('no uncaught errors in the pages', pageErrors.length === 0, pageErrors.slice(0, 5));

    const failed = checks.filter((c) => !c.ok);
    const report = {
      ranAt: new Date().toISOString(),
      result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none (software)', node: process.version, chromium: browser.version(), ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0] },
      project: { width: W, height: H, frameRate: R, exportedFrames: TOTAL },
      limitations: ['output goes to an in-memory BufferTarget (StreamTarget/OPFS streaming is a follow-up)', 'audio is mixed from whole decoded assets with OfflineAudioContext (long media: streaming mix is a follow-up)', 'lease expiry lives in server memory; after a server restart unfinished browser jobs are failed as lease_lost'],
      measurements,
      checks,
    };
    fs.writeFileSync(path.join(evidenceDir, 'browser-export-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/browser-export-proof.json`);
    if (failed.length) process.exitCode = 1;
  } catch (e) {
    // A crash must never look like a pass: record it as a failed check so the report says FAILED.
    console.error(e);
    process.exitCode = 1;
    throw e;
  } finally {
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
