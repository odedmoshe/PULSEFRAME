/**
 * Phase 9 gate, model-free part (SPEC §19): scene-cut detection and beat tracking as measured, editable,
 * source-linked analysis data. Reports results on small SYNTHETIC corpora built here (known ground truth).
 * Not covered: anything that needs a model (reframe, segmentation, pose/tracking, depth, semantic search) and
 * real footage or real music (no licensed corpus is available in this environment).
 *   pnpm build && pnpm proof:phase9
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { beatF1, drumLoop } from '../../../apps/server/src/beats.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase9');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });
const measurements: Record<string, unknown> = {};
const r3 = (x: number) => Number(x.toFixed(3));

function wavFile(file: string, x: Float32Array) {
  const raw = `${file}.f32`;
  fs.writeFileSync(raw, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  ff(['-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', file]);
  fs.rmSync(raw);
}
const V = 'scale=640:360,fps=30,format=yuv420p,setsar=1';
const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-g', '30', '-bf', '2', '-pix_fmt', 'yuv420p'];

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  // --- scene corpus: six different sources joined by hard cuts at known frames
  const segs: [string, number][] = [['testsrc2=s=640x360:r=30', 60], ['smptebars=s=640x360:r=30', 45], ['mandelbrot=s=640x360:r=30', 60], ['rgbtestsrc=s=640x360:r=30', 30], ['testsrc=s=640x360:r=30', 75], ['cellauto=s=640x360:r=30', 30]];
  const cutsTruth: number[] = [];
  let acc = 0;
  for (const [, n] of segs.slice(0, -1)) { acc += n; cutsTruth.push(acc); }
  const cutsFile = path.join(art, 'cuts.mp4');
  ff([...segs.flatMap(([src, n]) => ['-f', 'lavfi', '-t', String(n / 30), '-i', src]), '-f', 'lavfi', '-t', '10', '-i', 'sine=f=330:r=48000', '-filter_complex', `${segs.map((_, i) => `[${i}:v]${V}[v${i}]`).join(';')};${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[v]`, '-map', '[v]', '-map', `${segs.length}:a`, ...enc, '-c:a', 'aac', '-shortest', cutsFile]);
  const noCutFile = path.join(art, 'nocut.mp4');
  ff(['-f', 'lavfi', '-t', '6', '-i', 'testsrc2=s=640x360:r=30', '-vf', V, ...enc, noCutFile]);
  const dissolveFile = path.join(art, 'dissolve.mp4');
  ff(['-f', 'lavfi', '-t', '3', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '3', '-i', 'mandelbrot=s=640x360:r=30', '-filter_complex', `[0:v]${V}[a];[1:v]${V}[b];[a][b]xfade=transition=fade:duration=1:offset=2[v]`, '-map', '[v]', ...enc, dissolveFile]);

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const bearer = (t: string) => ({ authorization: `Bearer ${t}`, connection: 'close' });
  const h = bearer(s.auth.tokens.agent);
  const call = async (p: string, body?: unknown, headers: Record<string, string> = h) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'phase9', width: 640, height: 360 })).body.project.id;

    console.log('\n# scene cuts (synthetic corpus, exact ground truth)');
    const cutsAsset = await upload(pid, cutsFile), noCut = await upload(pid, noCutFile), dissolve = await upload(pid, dissolveFile);
    const t0 = Date.now();
    const sc = await call(`/projects/${pid}/assets/${cutsAsset.assetId}/analyze`, { kind: 'scenes' });
    const sceneMs = Date.now() - t0;
    const found = (sc.body.scenes.cutSeconds as number[]).map((x) => Math.round(x * 30));
    const tp = found.filter((x) => cutsTruth.includes(x)).length;
    measurements.scenes = { truthFrames: cutsTruth, foundFrames: found, precision: r3(tp / Math.max(1, found.length)), recall: r3(tp / cutsTruth.length), analysisMs: sceneMs, clipSeconds: 10, note: 'one synthetic clip with 5 hard cuts between very different pictures; H.264 with B-frames' };
    check('hard cuts: all 5 found on the exact frame, no false cuts', sc.status === 200 && JSON.stringify(found) === JSON.stringify(cutsTruth), measurements.scenes);
    const none = await call(`/projects/${pid}/assets/${noCut.assetId}/analyze`, { kind: 'scenes' });
    const dis = await call(`/projects/${pid}/assets/${dissolve.assetId}/analyze`, { kind: 'scenes' });
    measurements.sceneLimits = { continuousShotFalseCuts: none.body.scenes.count, dissolveDetected: dis.body.scenes.count };
    check('a continuous moving shot gives no cuts; a one-second dissolve is NOT detected (stated limit of this method)', none.body.scenes.count === 0 && dis.body.scenes.count === 0, measurements.sceneLimits);

    console.log('\n# beats (synthetic drum-loop corpus, known beat times)');
    const corpus: { name: string; bpm: (t: number) => number; nominal: number }[] = [
      { name: '90', bpm: () => 90, nominal: 90 }, { name: '100', bpm: () => 100, nominal: 100 }, { name: '120', bpm: () => 120, nominal: 120 },
      { name: '128', bpm: () => 128, nominal: 128 }, { name: '140', bpm: () => 140, nominal: 140 }, { name: 'drift-120-127', bpm: (t) => 120 + (7 * t) / 24, nominal: 123.5 },
    ];
    const rows: any[] = [];
    let beatAsset = '', beatTruth: number[] = [];
    for (const [i, c] of corpus.entries()) {
      const { x, beats } = drumLoop(c.bpm, 24, 0.37, i + 1);
      const file = path.join(art, `loop-${c.name}.wav`);
      wavFile(file, x);
      const up = await upload(pid, file);
      const t1 = Date.now();
      const r = await call(`/projects/${pid}/assets/${up.assetId}/analyze`, { kind: 'beats' });
      const sc2 = beatF1(r.body.beats.beatSeconds, beats);
      const errs = beats.map((b) => Math.min(...(r.body.beats.beatSeconds as number[]).map((q) => Math.abs(q - b)))).sort((a, b) => a - b);
      rows.push({ loop: c.name, bpmFound: r.body.beats.bpm, bpmError: r3(Math.abs(r.body.beats.bpm - c.nominal)), f1: r3(sc2.f1), medianErrorMs: r3(errs[errs.length >> 1]! * 1000), p95ErrorMs: r3(errs[Math.floor(errs.length * 0.95)]! * 1000), confidence: r.body.beats.confidence, analysisMs: Date.now() - t1 });
      if (c.name === '120') { beatAsset = up.assetId; beatTruth = beats; }
    }
    measurements.beats = { tolerance: '±70 ms', rows, note: '24 s synthetic loops (kick with attack click on the beat, quieter hat off the beat, bass tone, noise). Not real music.' };
    check('beat corpus: F1 ≥ 0.92 on all six loops, tempo within 1.5 BPM on the five steady ones', rows.every((r) => r.f1 >= 0.92) && rows.slice(0, 5).every((r) => r.bpmError < 1.5), rows);
    // bars: loops with an accent on the first beat of each bar (a louder kick and a noise burst); found bar starts against the known ones
    const barRows: any[] = [];
    for (const [name, bpm, meter, first] of [['4-120', 120, 4, 0.37], ['4-96', 96, 4, 0.2], ['3-132', 132, 3, 0.3]] as const) {
      const { x, downbeats } = drumLoop(() => bpm, 30, first, 7, meter);
      const file = path.join(art, `bars-${name}.wav`);
      wavFile(file, x);
      const r = await call(`/projects/${pid}/assets/${(await upload(pid, file)).assetId}/analyze`, { kind: 'beats' });
      const found: number[] = r.body.beats.downbeatSeconds ?? [];
      const hit = found.filter((q) => downbeats.some((b) => Math.abs(b - q) <= 0.07)).length;
      barRows.push({ loop: name, meterFound: r.body.beats.meter ?? null, meter, bars: found.length, precision: found.length ? r3(hit / found.length) : 0, recall: r3(hit / downbeats.length) });
    }
    // the plain 120 BPM loop analysed above has no accent
    const plain = (await doc(pid)).analyses[beatAsset]?.beats;
    measurements.bars = { tolerance: '±70 ms', rows: barRows, plainLoopBars: plain?.downbeats?.length ?? 0, note: '30 s synthetic loops with an accented first beat. Not real music: real accents are subtler and often on other beats.' };
    check('bar starts on the accented corpus: the right number of beats to the bar on all three loops, precision ≥ 0.95 and recall ≥ 0.85; the loop without an accent gets no bars', barRows.every((r) => r.meterFound === r.meter && r.precision >= 0.95 && r.recall >= 0.85) && !!plain && !plain.downbeats, measurements.bars);
    const noiseFile = path.join(art, 'noise.wav');
    ff(['-f', 'lavfi', '-t', '20', '-i', 'anoisesrc=c=pink:r=48000:a=0.3:seed=3', '-ac', '2', '-c:a', 'pcm_s16le', noiseFile]);
    const noise = await call(`/projects/${pid}/assets/${(await upload(pid, noiseFile)).assetId}/analyze`, { kind: 'beats' });
    measurements.beatLimits = { steadyNoiseConfidence: noise.body.beats.confidence, loopConfidences: rows.map((r) => r.confidence) };
    check('material without a pulse (steady noise) is reported with much lower confidence than every loop, so the UI can warn', noise.body.beats.confidence < Math.min(...rows.map((r) => r.confidence)) * 0.5, measurements.beatLimits);

    console.log('\n# analysis is source-linked, editable data');
    const clip = (await txs(pid, [{ op: 'add_clip', args: { assetId: cutsAsset.assetId, start: f(0) } }])).results[0].output;
    const split = await txs(pid, [{ op: 'split_at_scenes', args: { clipId: clip.clipId } }]);
    let d = await doc(pid);
    const starts = (kind: string) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === kind).flatMap((t: any) => t.clips).map((c: any) => T.frameIndexAt(c.start, R)).sort((a: number, b: number) => a - b);
    check('split_at_scenes: one transaction turns the clip into 6 shots (picture and linked sound) starting exactly on the cuts', split.results[0].output.createdClipIds.length === 10 && JSON.stringify(starts('video')) === JSON.stringify([0, ...cutsTruth]) && JSON.stringify(starts('audio')) === JSON.stringify([0, ...cutsTruth]), { videoStarts: starts('video') });
    await call(`/projects/${pid}/undo`, {});
    d = await doc(pid);
    check('one undo puts the single clip back; the analysis data stays', starts('video').length === 1 && d.analyses[cutsAsset.assetId].scenes.cuts.length === 5);
    // markers follow edits: trim 1 s off the start and move the clip to 2 s -> cuts shift by +30 frames
    await txs(pid, [{ op: 'trim_clip', args: { clipId: clip.clipId, edge: 'start', to: f(30) } }, { op: 'move_clip', args: { clipId: clip.clipId, start: f(60) } }]);
    const tl = (await call(`/projects/${pid}/timeline`)).body;
    check('timeline markers are derived through the current clips: after a trim and a move every cut marker moved with the picture', JSON.stringify(tl.markers.sceneCutSeconds.map((x: number) => Math.round(x * 30))) === JSON.stringify(cutsTruth.map((c) => c + 30)), tl.markers.sceneCutSeconds);
    const ed = await txs(pid, [{ op: 'edit_analysis', args: { assetId: cutsAsset.assetId, kind: 'scenes', remove: [f(cutsTruth[0]!)], add: [f(10)] } }]);
    d = await doc(pid);
    const re = await call(`/projects/${pid}/assets/${cutsAsset.assetId}/analyze`, { kind: 'scenes' });
    const re2 = await call(`/projects/${pid}/assets/${cutsAsset.assetId}/analyze`, { kind: 'scenes', overwrite: true });
    check('manual correction: remove a cut and add one, marked as edited; analysing again refuses to discard the corrections unless overwrite is given', ed.results[0].summary.includes('5') && d.analyses[cutsAsset.assetId].scenes.origin.edited === true && T.frameIndexAt(d.analyses[cutsAsset.assetId].scenes.cuts[0], R) === 10 && re.status === 409 && re.body.error.code === 'would_discard_edits' && re2.status === 200 && re2.body.scenes.edited === false, { refusal: re.body.error?.message });
    const obs = await call(`/projects/${pid}/assets/${cutsAsset.assetId}/analyze`, { kind: 'scenes', overwrite: true }, bearer(s.auth.tokens.observer));
    const wrong = await call(`/projects/${pid}/assets/${noCut.assetId}/analyze`, { kind: 'beats' });
    check('observer cannot run an analysis; beats on a file without sound is a clear 422', obs.status === 403 && wrong.status === 422 && wrong.body.error.code === 'no_audio');

    console.log('\n# cutting on the beat (agent, MCP)');
    const c = new Client({ name: 'phase9-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const bp = (await call('/projects', { name: 'phase9-beats', width: 640, height: 360 })).body.project.id;
    const music = await upload(bp, path.join(art, 'loop-120.wav'));
    const picture = await upload(bp, cutsFile);
    void beatAsset;
    const an = await tool('analyze_asset', { projectId: bp, assetId: music.assetId, kind: 'beats' });
    await tool('add_clip', { projectId: bp, assetId: music.assetId, start: f(0) });
    const tl2 = await tool('get_timeline', { projectId: bp });
    const beatSec: number[] = tl2.data.markers.beatSeconds;
    // every 4th beat becomes a picture cut: place 1-bar pieces of the picture between consecutive bar lines
    const bars = beatSec.filter((_, i) => i % 4 === 0).map((x) => Math.round(x * 30));
    const ops: any[] = [];
    for (let i = 0; i + 1 < Math.min(bars.length, 7); i++) ops.push({ op: 'add_clip', args: { assetId: picture.assetId, start: f(bars[i]!), sourceIn: f(i * 40), duration: f(bars[i + 1]! - bars[i]!), withLinkedAudio: false } });
    const placed = await tool('apply_transaction', { projectId: bp, ops });
    const bd = await doc(bp);
    const vStarts = bd.sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).map((x: any) => T.toSeconds(x.start));
    const worst = Math.max(...vStarts.map((v: number) => Math.min(...beatTruth.map((b) => Math.abs(b - v)))));
    measurements.cutOnBeat = { cuts: vStarts.length, worstDistanceToTrueBeatMs: r3(worst * 1000), frameMs: 33.3 };
    check('agent analyses the music, reads beat markers from the timeline and places picture cuts on bar lines: every cut is within one frame of a true beat', !an.isError && !placed.isError && vStarts.length >= 5 && worst <= 1 / 30 + 0.012, { ...(measurements.cutOnBeat as object), error: placed.isError ? JSON.stringify(placed.data).slice(0, 300) : undefined });
    const ga = await tool('get_analysis', { projectId: bp, assetId: music.assetId });
    check('get_analysis returns tempo, confidence and method for the agent', Math.abs(ga.data.beats.bpm - 120) < 1.5 && /no model/.test(ga.data.beats.method));
    await c.close();

    console.log('\n# editor: analysis panel and timeline markers');
    const ep = (await call('/projects', { name: 'phase9-editor', width: 640, height: 360 })).body.project.id;
    const ea = await upload(ep, cutsFile);
    const ec = (await txs(ep, [{ op: 'add_clip', args: { assetId: ea.assetId, start: f(0) } }])).results[0].output.clipId;
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 2400 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${ep}`);
    await page.locator(`.clip[data-clip-id="${ec}"]`).click();
    await page.getByTestId('analysis-panel').waitFor();
    const noMarkers = await page.getByTestId('scene-marker').count();
    await page.getByTestId('analysis-run-scenes').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=scene-marker]').length === 5, undefined, { timeout: 60000 });
    const markerFrames = await page.locator('[data-testid=scene-marker]').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.frame)).sort((a, b) => a - b));
    await page.getByTestId('analysis-run-beats').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=beat-marker]').length > 3, undefined, { timeout: 60000 }).catch(() => {});
    const beatMarkers = await page.getByTestId('beat-marker').count();
    await page.getByTestId('analysis-split-scenes').click();
    let shots = 0;
    for (let i = 0; i < 100 && shots !== 6; i++) { shots = (await doc(ep)).sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).length; if (shots !== 6) await sleep(100); }
    await page.screenshot({ path: path.join(art, 'editor-analysis.png') });
    check('editor: "find scene cuts" draws 5 markers on the exact frames; "split into shots" makes 6 clips; no page errors', noMarkers === 0 && JSON.stringify(markerFrames) === JSON.stringify(cutsTruth) && shots === 6 && errors.length === 0, { markerFrames, shots, beatMarkersOnASineTone: beatMarkers, errors: errors.slice(0, 3) });
    // bars in the editor: an accented loop analysed through the API appears with taller markers on its bar starts, and the panel says how many
    const loop = await upload(ep, path.join(art, 'bars-4-120.wav'));
    const lc = (await txs(ep, [{ op: 'add_clip', args: { assetId: loop.assetId, start: f(600) } }])).results[0].output.clipId;
    const la = await call(`/projects/${ep}/assets/${loop.assetId}/analyze`, { kind: 'beats' });
    const wantBars = la.body.beats.barCount as number;
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid=beat-marker][data-bar=true]').length === n, wantBars, { timeout: 15000 }).catch(() => {});
    const barMarkers = await page.locator('[data-testid=beat-marker][data-bar=true]').count();
    const firstBarFrame = await page.locator('[data-testid=beat-marker][data-bar=true]').first().getAttribute('data-frame');
    await page.locator(`.clip[data-clip-id="${lc}"]`).click();
    await page.getByTestId('analysis-bars').waitFor({ timeout: 8000 }).catch(() => {});
    const panelBars = await page.getByTestId('analysis-bars').textContent().catch(() => null);
    const summary = (await call(`/projects/${ep}/summary`)).body;
    check('editor: bar starts of an analysed loop are drawn as taller beat markers at their timeline frames (the clip starts at frame 600) and the analysis panel shows their number; the project summary reports bars and beats to the bar',
      wantBars >= 10 && barMarkers === wantBars && Number(firstBarFrame) === 600 + Math.round(la.body.beats.downbeatSeconds[0] * 30) && panelBars === String(wantBars) && summary.analyses?.some((a: any) => a.assetId === loop.assetId && a.bars === wantBars && a.meter === 4),
      { wantBars, barMarkers, firstBarFrame, panelBars, summary: summary.analyses?.find((a: any) => a.assetId === loop.assetId) });
    await page.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Model-free analysis on synthetic corpora with known ground truth. Real footage, real music and all model-based analysis are not exercised.', measurements, passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase9-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 9 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
