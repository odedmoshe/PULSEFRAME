/**
 * Phase 0 end-to-end proof (SPEC §28, Appendix D phase 0):
 *   import -> edit -> preview -> export -> external-agent (MCP) edit -> live UI update
 * Everything is real: a real server on a fresh data dir, the built web app in a real browser,
 * a real MCP client over HTTP, a real MP4 checked with ffprobe/ffmpeg against fixture truth.
 * Results are written to docs/evidence/phase0-proof.json. Any failed check exits non-zero.
 *
 *   pnpm build && pnpm proof
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import type { ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/proof');
const evidenceDir = path.join(root, 'docs/evidence');
const dataDir = path.join(art, 'data');
const PORT = Number(process.env.PF_PROOF_PORT ?? 8799);

const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const measurements: Record<string, unknown> = {};
function check(name: string, ok: boolean, detail?: unknown) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
}
const ff = (args: string[]): Buffer => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const percentile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');

  console.log('\n# fixture');
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_4s.mp4') });
  check('fixture generated (H.264 High + B-frames + AAC, frame-index barcode, 1 kHz beep each second)', fs.statSync(fixture.file).size > 10_000, { bytes: fs.statSync(fixture.file).size });

  console.log('\n# server');
  let server = await startServer({ port: PORT, dataDir });
  const base = server.url;
  const { agent: agentToken, observer: observerToken } = server.auth.tokens;
  const rest = (p: string, init: RequestInit = {}, token: string | null = agentToken) =>
    fetch(`${base}/api/v1${p}`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } });

  console.log('\n# access control (enforced server-side)');
  check('no credential -> 401', (await rest('/projects', {}, null)).status === 401);
  check('unknown bearer token -> 401', (await rest('/projects', {}, 'pfa_wrong')).status === 401);
  check('observe-only token cannot create a project -> 403', (await rest('/projects', { method: 'POST', body: JSON.stringify({ name: 'x' }) }, observerToken)).status === 403);
  check('cross-origin page cannot obtain a browser session -> 403', (await fetch(`${base}/api/v1/session`, { headers: { origin: 'https://evil.example' } })).status === 403);
  const rebind = await new Promise<number>((resolve) => {
    // fetch() will not let us forge Host, so speak HTTP directly.
    import('node:http').then(({ request }) => request({ host: '127.0.0.1', port: PORT, path: '/api/v1/projects', headers: { host: 'attacker.example', authorization: `Bearer ${agentToken}` } }, (r) => resolve(r.statusCode ?? 0)).end());
  });
  check('foreign Host header (DNS rebinding) -> 403 even with a valid token', rebind === 403);

  console.log('\n# human editor in a real browser');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));
  const tLoad = Date.now();
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('[data-testid=project-name]')?.textContent === 'הפרויקט שלי');
  measurements.editorShellInteractiveMs = Date.now() - tLoad;
  check('UI boots in Hebrew, RTL, and creates the first project itself', (await page.evaluate(() => document.documentElement.dir)) === 'rtl');
  check('timeline stays LTR inside the RTL interface', (await page.locator('.timeline').getAttribute('dir')) === 'ltr');
  const projectId: string = (await (await rest('/projects')).json()).projects[0].id;
  const getDoc = async () => (await (await rest(`/projects/${projectId}`)).json()) as { project: ProjectDocument; revision: number };
  const uiRevision = async () => Number((await page.getByTestId('revision').textContent())!.replace(/\D+/g, ''));
  const waitRevision = (rev: number) => page.waitForFunction((r) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) >= r, rev);
  const waitPainted = (frame: number) => page.waitForFunction((f) => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.frame === String(f), frame);

  // --- import
  await page.getByTestId('file-input').setInputFiles(fixture.file);
  await page.locator('.assets li').first().waitFor();
  let { project: doc } = await getDoc();
  const asset = Object.values(doc.assets)[0]!;
  check('import: server probed the real container/codecs and content-addressed the file', asset.video?.codec === 'h264' && asset.audio?.codec === 'aac' && asset.video.frameCount === 120 && T.eq(asset.duration, T.rt(4, 1)) && /^sha256:[0-9a-f]{64}$/.test(asset.contentHash), { codec: asset.video?.codec, frames: asset.video?.frameCount, duration: asset.duration, audio: asset.audio });
  await page.locator('.assets li button').first().click();
  await page.locator('[data-track-kind=video][data-clip-type=media]').first().waitFor();
  check('edit: add to timeline creates linked picture + audio clips', (await page.locator('[data-track-kind=video]').count()) === 1 && (await page.locator('[data-track-kind=audio]').count()) === 1);

  // --- edit via keyboard (physical key codes; works on a Hebrew layout)
  await page.locator('[data-track-kind=video]').first().click();
  await page.locator('canvas').click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
  await waitPainted(60);
  check('preview: frame-step keyboard navigation paints the exact requested frame', (await page.getByTestId('timecode').textContent()) === '00:00:02:00');
  let rev = await uiRevision();
  await page.keyboard.press('KeyS');
  await waitRevision(rev + 1);
  check('edit: keyboard split (S) at the playhead splits picture and linked audio', (await page.locator('[data-track-kind=video]').count()) === 2 && (await page.locator('[data-track-kind=audio]').count()) === 2);

  // --- Hebrew text
  rev = await uiRevision();
  await page.getByTestId('add-text').click();
  await waitRevision(rev + 1);
  const HEB = 'שָׁלוֹם עולם 2026 PULSEFRAME';
  await page.getByTestId('text-content').fill(HEB);
  await page.getByTestId('text-content').blur();
  await waitRevision(rev + 2);
  ({ project: doc } = await getDoc());
  const textClip = doc.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips[0]!;
  check('edit: Hebrew + niqqud + digits + Latin text stored verbatim', textClip.type === 'text' && textClip.text === HEB);

  // --- preview pixels: the canvas must show the source frame the evaluator selected
  const previewBarcode = async () => {
    return page.evaluate(() => {
      const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      return { w: c.width, h: c.height, frame: Number(c.dataset.frame), data: Array.from(d.data.filter((_, i) => i % 4 !== 3)) };
    });
  };
  const srcRect = (W: number, H: number) => { const fit = Math.min(W / 640, H / 360); return { x: (W - 640 * fit) / 2, y: (H - 360 * fit) / 2, w: 640 * fit, h: 360 * fit }; };
  const pv = await previewBarcode();
  check('preview: canvas shows source frame 60 at timeline frame 60 (barcode read from preview pixels)', readBarcode(Uint8Array.from(pv.data), pv.w, 3, srcRect(pv.w, pv.h)) === 60, { canvas: `${pv.w}x${pv.h}` });

  // --- playback
  await page.keyboard.press('Home');
  await waitPainted(0);
  await page.getByTestId('play').click();
  await page.waitForFunction(() => Number((document.querySelector('[data-testid=preview]') as HTMLCanvasElement).dataset.frame) >= 20, undefined, { timeout: 15_000 });
  await page.getByTestId('play').click();
  check('preview: playback advances and pauses', (await page.getByTestId('timecode').textContent()) !== '00:00:00:00');
  await page.keyboard.press('Home');
  for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowRight');
  await waitPainted(70);
  await page.screenshot({ path: path.join(evidenceDir, 'phase0-editor-he.png') });

  console.log('\n# external agent over MCP (official client SDK, HTTP)');
  // Pin the modern era: connect fails loudly unless the server offers exactly 2026-07-28.
  const mcp = new Client({ name: 'phase0-proof-agent', version: '0.0.0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${agentToken}` } } }));
  measurements.mcp = { negotiatedProtocolVersion: mcp.getNegotiatedProtocolVersion(), server: mcp.getServerVersion() };
  check('MCP: negotiated the 2026-07-28 protocol revision', mcp.getNegotiatedProtocolVersion() === '2026-07-28', measurements.mcp);
  const tools = (await mcp.listTools()).tools.map((t) => t.name);
  check('MCP: tools are generated from the operation registry (internal ops hidden)', ['split_clip', 'trim_clip', 'move_clip', 'add_text', 'update_text', 'apply_transaction', 'render_frame', 'export_project', 'get_timeline', 'describe_ops'].every((t) => tools.includes(t)) && !tools.includes('import_asset'), { count: tools.length });
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await mcp.callTool({ name, arguments: args });
    const text = (r.content as any[]).find((c) => c.type === 'text')?.text;
    return { isError: !!r.isError, data: text ? JSON.parse(text) : undefined, content: r.content as any[] };
  };
  const tl = (await call('get_timeline', { projectId })).data;
  const vClips = tl.tracks.find((t: any) => t.kind === 'video').clips;
  const right = vClips[1];
  check('MCP sense: get_timeline returns exact rational times and ids', vClips.length === 2 && right.start.value === '2' && right.start.timescale === 1, { right: { id: right.id, start: right.start } });

  // The human's local view state before the agent edits.
  const before = { timecode: await page.getByTestId('timecode').textContent(), selected: await page.locator('.clip.selected').getAttribute('data-testid') };
  rev = await uiRevision();
  const f = (n: number) => T.frameTime(n, doc.settings.frameRate);
  const t0 = performance.now();
  const agentTx = await call('apply_transaction', {
    projectId, expectedRevision: rev, idempotencyKey: 'proof-agent-edit-1', label: 'Agent: tighten and retitle',
    ops: [
      { op: 'trim_clip', args: { clipId: right.id, edge: 'start', to: f(75) } },
      { op: 'move_clip', args: { clipId: right.id, start: f(60) } },
      { op: 'update_text', args: { clipId: textClip.id, text: 'נערך ע״י סוכן · Agent edit', style: { background: '#101418CC' } } },
      { op: 'trim_clip', args: { clipId: textClip.id, edge: 'end', to: f(105) } },
    ],
  });
  const commitMs = performance.now() - t0;
  check('agent edit: 4-op transaction committed atomically as one revision', !agentTx.isError && agentTx.data.committed && agentTx.data.revision === rev + 1, agentTx.isError ? agentTx.data : { revision: agentTx.data.revision, summary: agentTx.data.summary });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-track-kind=text] span')].some((s) => s.textContent?.includes('סוכן')));
  await waitRevision(rev + 1);
  const visibleMs = performance.now() - t0;
  measurements.agentEdit = { requestToCommitMs: +commitMs.toFixed(1), requestToVisibleInEditorMs: +visibleMs.toFixed(1), note: 'single sample, loopback, includes Playwright polling overhead' };
  check('live UI update: agent edit appears in the open editor without reload', true, measurements.agentEdit);
  check('live UI update: activity feed attributes the change to the agent (actor from auth)', (await page.locator('[data-testid=activity] li[data-actor="agent:local"]').count()) >= 1);
  const after = { timecode: await page.getByTestId('timecode').textContent(), selected: await page.locator('.clip.selected').getAttribute('data-testid') };
  check('human keeps control: playhead and selection unchanged by the agent edit', before.timecode === after.timecode && before.selected === after.selected, { before, after });

  const replayed = await call('apply_transaction', { projectId, idempotencyKey: 'proof-agent-edit-1', ops: [
    { op: 'trim_clip', args: { clipId: right.id, edge: 'start', to: f(75) } },
    { op: 'move_clip', args: { clipId: right.id, start: f(60) } },
    { op: 'update_text', args: { clipId: textClip.id, text: 'נערך ע״י סוכן · Agent edit', style: { background: '#101418CC' } } },
    { op: 'trim_clip', args: { clipId: textClip.id, edge: 'end', to: f(105) } },
  ] });
  check('idempotency: resending the same key returns the original revision, no second commit', replayed.data.replayed === true && replayed.data.revision === rev + 1);
  const stale = await call('split_clip', { projectId, expectedRevision: rev, clipId: right.id, at: f(70) });
  check('stale expectedRevision is rejected with a typed, actionable error', stale.isError && stale.data.error.code === 'stale_revision', stale.data?.error);
  const bad = await call('split_clip', { projectId, clipId: right.id, at: { value: '1', timescale: 7 } });
  check('off-frame time is rejected and the error offers the nearest valid value', bad.isError && bad.data.error.code === 'invalid_args' && !!bad.data.error.details.nearest, bad.data?.error?.details?.nearest);
  check('rejected edits did not change the revision', (await getDoc()).revision === rev + 1);

  // This client uses the SDK default (2025-era handshake), exercising the server's stateless legacy fallback.
  const observer = new Client({ name: 'phase0-observer', version: '0.0.0' });
  await observer.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${observerToken}` } } }));
  const denied = await observer.callTool({ name: 'delete_clip', arguments: { projectId, clipId: right.id } });
  const obsRead = await observer.callTool({ name: 'get_summary', arguments: { projectId } });
  check('MCP scopes: observe-only agent can read but its mutation is refused server-side', !!denied.isError && /insufficient_scope/.test(JSON.stringify(denied.content)) && !obsRead.isError);
  check('MCP compatibility: a 2025-era client is served by the stateless legacy fallback', observer.getNegotiatedProtocolVersion() === '2025-11-25', { negotiated: observer.getNegotiatedProtocolVersion() });
  await observer.close();
  const noAuth = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  check('MCP without credentials -> 401', noAuth.status === 401);

  // latency sample set for agent edits (REST), honest small-N measurement
  const lat: number[] = [];
  for (let i = 0; i < 30; i++) {
    const s = performance.now();
    const r = await rest(`/projects/${projectId}/transactions`, { method: 'POST', body: JSON.stringify({ ops: [{ op: 'set_clip_transform', args: { clipId: textClip.id, transform: { y: 0.3 + (i % 2) * 0.01 } } }] }) });
    if (!r.ok) throw new Error(`latency sample failed ${r.status}`);
    await r.json();
    lat.push(performance.now() - s);
  }
  measurements.restCommitLatencyMs = { samples: lat.length, median: +percentile(lat, 0.5).toFixed(2), p95: +percentile(lat, 0.95).toFixed(2), max: +Math.max(...lat).toFixed(2) };
  ({ project: doc, revision: rev } = await getDoc());
  await waitRevision(rev);

  console.log('\n# agent sense: render_frame through the export compositor');
  const still = await call('render_frame', { projectId, frameIndex: 70 });
  const png = Buffer.from(still.content.find((c) => c.type === 'image').data, 'base64');
  fs.writeFileSync(path.join(evidenceDir, 'phase0-frame70-compositor.png'), png);
  check('render_frame returns a PNG with revision metadata', png.subarray(1, 4).toString() === 'PNG' && still.data.revision === rev && still.data.frameIndex === 70, still.data);

  console.log('\n# export (started from the UI button)');
  const tExport = Date.now();
  await page.getByTestId('export').click();
  // Editing continues while the export runs: the job must keep its immutable snapshot.
  const snapshotRevision = rev;
  const late = await rest(`/projects/${projectId}/transactions`, { method: 'POST', body: JSON.stringify({ label: 'Edit during export', ops: [{ op: 'update_text', args: { clipId: textClip.id, text: 'EDITED AFTER EXPORT STARTED' } }] }) });
  check('editing continues while the export job runs', late.ok);
  await page.getByTestId('export-download').waitFor({ timeout: 300_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const jobId = href!.split('/').at(-2)!;
  const job = await (await rest(`/jobs/${jobId}`)).json();
  const mp4 = path.join(art, 'phase0-export.mp4');
  fs.writeFileSync(mp4, Buffer.from(await (await rest(`/jobs/${jobId}/output`)).arrayBuffer()));
  measurements.export = { ...job.output, uiWallSeconds: (Date.now() - tExport) / 1000 };
  check('export: durable job succeeded and used the pre-edit snapshot revision', job.status === 'succeeded' && job.revision === snapshotRevision, { status: job.status, revision: job.revision, error: job.error });

  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4], { encoding: 'utf8' }));
  const vs = probe.streams.find((s: any) => s.codec_type === 'video');
  const as = probe.streams.find((s: any) => s.codec_type === 'audio');
  const W = doc.settings.width;
  const H = doc.settings.height;
  const expectedFrames = 105;
  check('export: playable MP4, H.264 + AAC, exact frame count/size/rate, BT.709 tagged', vs.codec_name === 'h264' && as.codec_name === 'aac' && Number(vs.nb_frames) === expectedFrames && vs.width === W && vs.height === H && vs.r_frame_rate === '30/1' && vs.color_space === 'bt709' && vs.pix_fmt === 'yuv420p',
    { video: `${vs.codec_name} ${vs.profile} ${vs.width}x${vs.height} ${vs.r_frame_rate} ${vs.pix_fmt} ${vs.color_space}`, frames: vs.nb_frames, audio: `${as.codec_name} ${as.sample_rate}Hz ${as.channels}ch`, duration: probe.format.duration, bytes: probe.format.size });
  ff(['-y', '-i', mp4, '-f', 'null', '-']); // full decode must succeed without errors
  check('export: decodes end-to-end without errors', true);

  // Frame-exact source mapping, checked on EVERY exported frame against the pure evaluator.
  const snapshot: ProjectDocument = (await (await rest(`/projects/${projectId}?revision=${snapshotRevision}`)).json()).project;
  const raw = ff(['-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const frameBytes = W * H * 3;
  const mism: number[] = [];
  for (let i = 0; i < expectedFrames; i++) {
    const layer = evaluate(snapshot, T.frameTime(i, snapshot.settings.frameRate)).layers.find((l) => l.kind === 'video');
    const got = readBarcode(raw.subarray(i * frameBytes, (i + 1) * frameBytes), W, 3, srcRect(W, H));
    if (!layer || layer.kind !== 'video' || got !== layer.sourceFrameIndex) mism.push(i);
  }
  check(`export: all ${expectedFrames} frames show the exact source frame the evaluator selected (across the split, trim and move)`, raw.length === frameBytes * expectedFrames && mism.length === 0, { mismatchedFrames: mism.slice(0, 10), expectAt60: 75 });

  // Compositor still vs decoded lossy export, same frame.
  const exFrame = path.join(evidenceDir, 'phase0-frame70-export.png');
  ff(['-y', '-i', mp4, '-vf', 'select=eq(n\\,70)', '-frames:v', '1', exFrame]);
  const metric = (filter: string, re: RegExp) => {
    // ffmpeg prints filter statistics on stderr.
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', exFrame, '-i', path.join(evidenceDir, 'phase0-frame70-compositor.png'), '-lavfi', filter, '-f', 'null', '-'], { encoding: 'utf8' });
    return Number(re.exec(r.stderr)?.[1]);
  };
  const psnr = metric('psnr', /average:([\d.]+|inf)/);
  const ssim = metric('ssim', /All:([\d.]+)/);
  measurements.parityFrame70 = { psnrDb: psnr, ssim, targets: { psnrDb: 36, ssim: 0.985 }, note: 'compositor PNG vs decoded H.264 (crf 16, 4:2:0) frame; one frame, not a suite' };
  check('parity: decoded export frame vs compositor still meets the initial lossy targets (PSNR>=36 dB, SSIM>=0.985)', psnr >= 36 && ssim >= 0.985, { psnrDb: psnr, ssim });

  // A/V sync: beep onsets in the exported audio vs where the edit puts them.
  const pcm = ff(['-i', mp4, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', '-']);
  const onsets: number[] = [];
  let quietUntil = 0;
  for (let i = 0; i < pcm.length / 2; i++) {
    if (i < quietUntil) continue;
    if (Math.abs(pcm.readInt16LE(i * 2)) > 6000) { onsets.push(i / 48000); quietUntil = i + 48000 * 0.3; }
  }
  const expectedOnsets = [0, 1, 2.5]; // source beeps at 0,1,2,3 s; source 2.0–2.5 s was trimmed away, so the 3 s beep lands at 2.5 s
  const maxErr = Math.max(...expectedOnsets.map((e, i) => Math.abs((onsets[i] ?? 99) - e)));
  measurements.avSync = { expectedOnsetsSeconds: expectedOnsets, measuredOnsetsSeconds: onsets.map((o) => +o.toFixed(4)), maxAbsErrorMs: +(maxErr * 1000).toFixed(2), frameMs: 33.33 };
  check('audio: beeps land where the edit puts them, within one frame (and the trimmed beep is gone)', onsets.length === 3 && maxErr < 1 / 30, measurements.avSync);
  check('audio: stream duration equals video duration within one frame', Math.abs(Number(as.duration) - Number(vs.duration)) < 1 / 30, { audio: as.duration, video: vs.duration });

  console.log('\n# durability: op-log replay and restart');
  const live = await getDoc();
  const replay = await (await rest(`/projects/${projectId}?revision=${live.revision}`)).json();
  check('replaying the op log from revision 0 reproduces the materialized document exactly', JSON.stringify(replay.project) === JSON.stringify(live.project), { revision: live.revision });
  await page.screenshot({ path: path.join(evidenceDir, 'phase0-editor-after-agent-he.png') });
  await page.getByTestId('lang-toggle').click();
  await page.waitForFunction(() => document.documentElement.dir === 'ltr');
  await page.screenshot({ path: path.join(evidenceDir, 'phase0-editor-en.png') });
  check('language toggle switches to English/LTR without losing the project', (await uiRevision()) === live.revision);
  await mcp.close();
  await browser.close();
  await server.close();
  server = await startServer({ port: PORT, dataDir });
  const afterRestart = await (await fetch(`${base}/api/v1/projects/${projectId}`, { headers: { authorization: `Bearer ${server.auth.tokens.agent}` } })).json();
  const hist = await (await fetch(`${base}/api/v1/projects/${projectId}/history?since=0`, { headers: { authorization: `Bearer ${server.auth.tokens.agent}` } })).json();
  check('restart: project, revision and tokens persist; history is complete and gap-free', afterRestart.revision === live.revision && JSON.stringify(afterRestart.project) === JSON.stringify(live.project) && server.auth.tokens.agent === agentToken && hist.events.length === live.revision && hist.events.every((e: any, i: number) => e.revision === i + 1));
  await server.close();
  check('no uncaught errors in the editor page', pageErrors.length === 0, pageErrors.slice(0, 5));

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ranAt: new Date().toISOString(),
    result: failed.length ? 'FAILED' : 'PASSED',
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1), gpu: 'none (software)', node: process.version, chromium: browser.version(), ffmpeg: execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0] },
    project: { width: W, height: H, frameRate: doc.settings.frameRate, exportedFrames: expectedFrames },
    measurements,
    checks,
  };
  fs.writeFileSync(path.join(evidenceDir, 'phase0-proof.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/phase0-proof.json, export: ${path.relative(root, mp4)}`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
