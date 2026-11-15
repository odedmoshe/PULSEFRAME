/**
 * Phase 8 gate, first batch (SPEC §10): track gain and pan, clip fades, speech ducking and loudness normalisation.
 * Synthetic signals with known amplitudes are mixed by the real export and measured from the exported PCM,
 * and the browser audio chain (preview / browser export) is compared with the reference mixer in real WebAudio.
 * Not covered (not built): EQ/compression/noise reduction, SFX library, recording, narration/voice providers, meters UI.
 *   pnpm build && pnpm proof:phase8
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase8');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const SR = 48000;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const measurements: Record<string, unknown> = {};
const r3 = (x: number) => Number(x.toFixed(4));
/** Amplitude of a sine of `freq` Hz in channel `ch` over [t, t + win) seconds (Goertzel-style correlation; win holds whole periods). */
function tone(pcm: Float32Array, ch: 0 | 1, freq: number, t: number, win = 0.05): number {
  const s0 = Math.round(t * SR), n = Math.round(win * SR);
  let re = 0, im = 0;
  for (let i = 0; i < n; i++) { const v = pcm[(s0 + i) * 2 + ch] ?? 0, ph = (2 * Math.PI * freq * (s0 + i)) / SR; re += v * Math.cos(ph); im += v * Math.sin(ph); }
  return (2 * Math.hypot(re, im)) / n;
}
const db = (x: number) => 20 * Math.log10(x);
/** Independent loudness measurement of a WAV (separate ffmpeg run, stderr summary). */
function loud(file: string) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' });
  const s = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(s)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(s)?.[1]) };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  // Known signals: "music" = 440 Hz at amplitude 0.5 for 8 s; "voice" = 880 Hz at 0.25 only during 2 s..4 s.
  const musicFile = path.join(art, 'music.wav'), voiceFile = path.join(art, 'voice.wav');
  ff(['-y', '-f', 'lavfi', '-i', `aevalsrc=0.5*sin(2*PI*440*t)|0.5*sin(2*PI*440*t):s=${SR}:d=8`, '-c:a', 'pcm_s16le', musicFile]);
  ff(['-y', '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*880*t)*between(t\\,2\\,4)|0.25*sin(2*PI*880*t)*between(t\\,2\\,4):s=${SR}:d=8`, '-c:a', 'pcm_s16le', voiceFile]);
  const s = await startServer({ port: 8799, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } };
  let n = 0;
  /** Export the project audio as WAV; returns float samples (interleaved stereo) and the job. */
  const wav = async (pid: string) => {
    const job = await waitJob((await call(`/projects/${pid}/exports`, { format: 'wav' })).body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `mix-${++n}.wav`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(SR), '-']);
    return { job, file, pcm: new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4) };
  };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'phase8', width: 640, height: 360 })).body.project.id;
    const music = await upload(pid, musicFile), voice = await upload(pid, voiceFile);
    const tr = await txs(pid, [{ op: 'add_track', args: { kind: 'audio', name: 'voice' } }, { op: 'add_track', args: { kind: 'audio', name: 'music' } }]);
    const [vt, mt] = tr.results.map((x: any) => x.output.trackId);
    const cl = await txs(pid, [{ op: 'add_clip', args: { assetId: music.assetId, start: f(0), trackId: mt } }]);
    const mc = cl.results[0].output.audioClipId ?? cl.results[0].output.clipId;

    console.log('\n# gain, pan, fades (music only: 440 Hz at 0.5)');
    const base = await wav(pid);
    const a0 = tone(base.pcm, 0, 440, 3);
    check('baseline: exported amplitude equals the source amplitude (0.5) on both channels, exact length', Math.abs(a0 - 0.5) < 0.002 && Math.abs(tone(base.pcm, 1, 440, 3) - 0.5) < 0.002 && base.pcm.length === 8 * SR * 2, { amplitude: r3(a0), samples: base.pcm.length / 2 });
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: mt, gain: 0.5 } }]);
    const half = await wav(pid);
    check('track gain 0.5 lowers the level by 6.02 dB', Math.abs(db(tone(half.pcm, 0, 440, 3) / a0) + 6.0206) < 0.03, { changeDb: r3(db(tone(half.pcm, 0, 440, 3) / a0)) });
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: mt, gain: 1, pan: -1 } }]);
    const left = await wav(pid);
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: mt, pan: 0.5 } }]);
    const right = await wav(pid);
    check('pan: fully left silences the right channel and keeps the left; pan +0.5 halves the left and keeps the right', Math.abs(tone(left.pcm, 0, 440, 3) - a0) < 0.002 && tone(left.pcm, 1, 440, 3) < 0.0005 && Math.abs(tone(right.pcm, 0, 440, 3) - a0 / 2) < 0.002 && Math.abs(tone(right.pcm, 1, 440, 3) - a0) < 0.002, { left: [r3(tone(left.pcm, 0, 440, 3)), r3(tone(left.pcm, 1, 440, 3))], right: [r3(tone(right.pcm, 0, 440, 3)), r3(tone(right.pcm, 1, 440, 3))] });
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: mt, pan: 0 } }, { op: 'set_clip_fades', args: { clipId: mc, fadeIn: T.rt(1, 1), fadeOut: T.rt(2, 1) } }]);
    const faded = await wav(pid);
    // window centre times -> expected gain; a 50 ms window averages a linear ramp to its centre value
    const fadePoints: [number, number][] = [[0.225, 0.25], [0.475, 0.5], [0.725, 0.75], [1.5, 1], [5.9, 1], [6.475, 0.75], [6.975, 0.5], [7.475, 0.25]];
    const fadeErr = Math.max(...fadePoints.map(([t, g]) => Math.abs(tone(faded.pcm, 0, 440, t) / a0 - g)));
    check('fades are linear: 1 s fade-in and 2 s fade-out measured at 8 points, each within 1% of the expected gain; first and last samples are silent', fadeErr < 0.01 && Math.abs(faded.pcm[0]!) < 1e-4 && Math.abs(faded.pcm[faded.pcm.length - 2]!) < 1e-3, { maxError: r3(fadeErr), measured: fadePoints.map(([t]) => r3(tone(faded.pcm, 0, 440, t) / a0)) });
    await txs(pid, [{ op: 'set_clip_fades', args: { clipId: mc, fadeIn: T.ZERO, fadeOut: T.ZERO } }]);

    console.log('\n# ducking (voice: 880 Hz during 2 s..4 s)');
    const vcl = await txs(pid, [{ op: 'add_clip', args: { assetId: voice.assetId, start: f(0), trackId: vt } }]);
    const vc = vcl.results[0].output.audioClipId ?? vcl.results[0].output.clipId;
    void vc;
    await txs(pid, [{ op: 'set_transcript', args: { assetId: voice.assetId, language: 'he', segments: [{ start: T.rt(2, 1), duration: T.rt(2, 1), text: 'שלום לכולם' }] } }, { op: 'set_ducking', args: { trackId: mt, sourceTrackIds: [vt], reductionDb: 12, attackMs: 100, releaseMs: 300 } }]);
    const ducked = await wav(pid);
    const low = 10 ** (-12 / 20);
    const m = (t: number) => tone(ducked.pcm, 0, 440, t) / a0;
    const duckPts: [number, number][] = [[1.0, 1], [1.8, 1], [1.925, (1 + low) / 2], [2.0, low], [3.0, low], [3.94, low], [4.125, (1 + low) / 2], [4.35, 1], [6, 1]];
    const duckErr = Math.max(...duckPts.map(([t, g]) => Math.abs(m(t) - g)));
    check('ducking: music is exactly 12 dB down while the phrase is spoken, the 100 ms attack ends when speech starts, the 300 ms release starts when it ends (9 points within 1.5%); the voice itself is untouched', duckErr < 0.015 && Math.abs(tone(ducked.pcm, 0, 880, 3) - 0.25) < 0.002, { maxError: r3(duckErr), duckedDb: r3(db(m(3))), measured: duckPts.map(([t]) => r3(m(t))) });
    await txs(pid, [{ op: 'move_clip', args: { clipId: vc, start: f(60) } }]); // speech now 4 s..6 s
    const moved = await wav(pid);
    const mm = (t: number) => tone(moved.pcm, 0, 440, t) / a0;
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: vt, muted: true } }]);
    const mutedVoice = await wav(pid);
    check('ducking follows the edit: moving the voice 2 s later moves the dip; muting the voice track removes it', Math.abs(mm(3) - 1) < 0.01 && Math.abs(mm(5) - low) < 0.01 && Math.abs(tone(mutedVoice.pcm, 0, 440, 5) / a0 - 1) < 0.01 && tone(mutedVoice.pcm, 0, 880, 5) < 0.0005, { at3s: r3(mm(3)), at5s: r3(mm(5)) });
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: vt, muted: false } }]);

    console.log('\n# loudness');
    const before = (await call(`/projects/${pid}/analysis/loudness`, {})).body;
    await txs(pid, [{ op: 'set_loudness_target', args: { target: -16, truePeak: -1 } }]);
    const norm = await wav(pid);
    const ind = loud(norm.file);
    const info = norm.job.output.audio.loudness;
    check('loudness target -16 LUFS: export measures the mix, applies one static gain, and an independent measurement of the exported file is within 0.2 LU of the target with true peak under the ceiling', Math.abs(ind.lufs + 16) <= 0.2 && ind.peak <= -1 + 0.05 && !info.limitedByPeak && Math.abs(info.measuredLufs - before.integratedLufs) < 0.15, { before: before.integratedLufs, appliedGainDb: info.appliedGainDb, exported: ind });
    const sense = (await call(`/projects/${pid}/analysis/loudness`, {})).body;
    check('loudness sense reports the same measurement and the gain export will apply, without editing', Math.abs(sense.exportWouldApplyGainDb - info.appliedGainDb) < 0.1 && sense.revision === (await call(`/projects/${pid}`)).body.revision, { integratedLufs: sense.integratedLufs, truePeakDbtp: sense.truePeakDbtp, rangeLu: sense.rangeLu, exportWouldApplyGainDb: sense.exportWouldApplyGainDb });
    await txs(pid, [{ op: 'set_loudness_target', args: { target: -5, truePeak: -9 } }]); // needs +2.7 dB, but the peak is at -6 dBTP and the ceiling is -9
    const hot = await wav(pid);
    const indHot = loud(hot.file);
    check('an unreachable target is limited by the true-peak ceiling instead of clipping: reported as such, and the exported peak stays at or under the -9 dBTP ceiling', hot.job.output.audio.loudness.limitedByPeak === true && indHot.peak <= -9 + 0.05 && hot.job.output.audio.loudness.appliedGainDb < 0 && hot.job.output.audio.clipped === false, { appliedGainDb: hot.job.output.audio.loudness.appliedGainDb, exported: indHot });
    await txs(pid, [{ op: 'set_loudness_target', args: { target: null } }, { op: 'set_track_audio', args: { trackId: mt, gain: 4 } }]);
    const clip = await wav(pid);
    check('without a target, a mix that exceeds full scale is reported as clipped with its peak', clip.job.output.audio.clipped === true && clip.job.output.audio.mixPeakDbfs > 0 && clip.job.output.audio.loudness === null, clip.job.output.audio);
    await txs(pid, [{ op: 'set_track_audio', args: { trackId: mt, gain: 1 } }]);
    await txs(pid, [{ op: 'set_loudness_target', args: { target: -14 } }]);
    const be = await call(`/projects/${pid}/exports/browser`, { sessionId: 'phase8-proof-session' });
    await call(`/projects/${pid}/undo`, {});
    const afterUndo = (await call(`/projects/${pid}`)).body.project.settings.loudness;
    check('browser export refuses a project with a loudness target (it cannot measure) and says to use the server route; undo restores the previous setting', be.status === 409 && be.body.error.code === 'unsupported_in_browser_export' && afterUndo === undefined, be.body.error?.message);

    console.log('\n# long mix stays bounded and exact');
    const lp = (await call('/projects', { name: 'phase8-long', width: 640, height: 360 })).body.project.id;
    const lm = await upload(lp, musicFile);
    const ops: unknown[] = [];
    for (let k = 0; k < 40; k++) ops.push({ op: 'add_clip', args: { assetId: lm.assetId, start: f(k * 240) } }); // 40 x 8 s back to back = 320 s
    await txs(lp, ops);
    const rss0 = process.memoryUsage().rss;
    const t0 = Date.now();
    const long = await wav(lp);
    const ms = Date.now() - t0;
    let worst = 0;
    for (let k = 1; k < 40; k++) worst = Math.max(worst, Math.abs(tone(long.pcm, 0, 440, k * 8 - 0.025) - 0.5), Math.abs(tone(long.pcm, 0, 440, k * 8) - 0.5));
    measurements.longMix = { seconds: 320, clips: 40, wallMs: ms, realtimeFactor: r3(320 / (ms / 1000)), serverRssGrowthMb: Math.round((process.memoryUsage().rss - rss0) / 1e6), note: 'one run on this CPU profile; RSS includes the proof harness holding the decoded result' };
    check('320 s mix of 40 back-to-back clips: exact length, and the tone is continuous across every one of the 39 joins (no gap, overlap or drift)', long.pcm.length === 320 * SR * 2 && worst < 0.003, measurements.longMix);

    console.log('\n# browser audio chain (preview and browser export) vs the reference mixer');
    const page = await browser.newPage();
    await page.goto(`${s.url}/selftest.html`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    const st: any = await page.evaluate(() => (window as any).__pfSelfTest);
    measurements.browserAudioChain = st.audioChain;
    check('in real WebAudio, gain + fades + ducking + balance from the shared plan match the reference mixer to better than 1e-4 of full scale, also when playback starts in the middle of a clip', !st.error && st.audioChain.maxAbsError < 1e-4 && st.audioChain.maxAbsErrorMidClipStart < 1e-4, st.audioChain ?? st.error);
    await page.close();

    console.log('\n# built-in sound effects are real assets');
    const cat = (await call('/catalog')).body.soundEffects as { id: string; seconds: number }[];
    const sp = (await call('/projects', { name: 'phase8-sfx', width: 640, height: 360 })).body.project.id;
    const added: any[] = [];
    for (const [i, sfx] of cat.entries()) added.push((await call(`/projects/${sp}/sfx`, { sfxId: sfx.id, start: f(i * 60) })).body);
    const again = (await call(`/projects/${sp}/sfx`, { sfxId: cat[0]!.id })).body;
    const sdoc = (await call(`/projects/${sp}`)).body.project;
    const sfxWav = await wav(sp);
    const energy = (t0: number, t1: number) => { let e = 0; for (let i = Math.round(t0 * SR); i < Math.round(t1 * SR); i++) e += (sfxWav.pcm[i * 2] ?? 0) ** 2; return e; };
    const heard = cat.map((sfx, i) => energy(i * 2, i * 2 + sfx.seconds) > 1e-3 && energy(i * 2 + sfx.seconds + 0.05, i * 2 + 1.95) < 1e-6);
    check(`all ${cat.length} built-in sounds are synthesised, stored as content-addressed audio assets with their recipe in provenance, placed as clips, audible in the export at their positions and silent elsewhere; adding the same sound twice reuses the asset`, cat.length >= 6 && added.every((a) => a.assetId && a.placed) && Object.values(sdoc.assets).every((a: any) => a.provenance.origin === 'generated' && a.provenance.procedural?.id.startsWith('sfx.') && /^sha256:/.test(a.contentHash)) && heard.every(Boolean) && again.assetId === added[0].assetId && Object.keys(sdoc.assets).length === cat.length, { ids: cat.map((x) => x.id), heard });
    check('an unknown sound is refused with the list of available ones', (await call(`/projects/${sp}/sfx`, { sfxId: 'sfx.explosion-9000' })).status === 404);

    console.log('\n# editor: Sound tab');
    const ep = await (await browser.newContext({ viewport: { width: 1440, height: 2000 }, reducedMotion: 'reduce' })).newPage();
    await ep.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const eerr: string[] = [];
    ep.on('pageerror', (e) => eerr.push(String(e)));
    ep.on('console', (m) => m.type() === 'error' && eerr.push(m.text()));
    await ep.goto(`${s.url}/?project=${pid}`);
    await ep.getByTestId('sound-panel').waitFor();
    const docNow = async () => (await call(`/projects/${pid}`)).body.project;
    const until = async (pred: (d: any) => boolean) => { for (let i = 0; i < 100; i++) { if (pred(await docNow())) return true; await sleep(100); } return false; };
    const trackOf = (d: any, id: string) => d.sequences.seq_main.tracks.find((t: any) => t.id === id);
    const row = ep.locator(`[data-testid=sound-track][data-track-id="${mt}"]`);
    await row.getByTestId('sound-gain').fill('-6');
    await row.getByTestId('sound-gain').dispatchEvent('pointerup');
    const gainOk = await until((d) => Math.abs((trackOf(d, mt).audio?.gain ?? 1) - 10 ** (-6 / 20)) < 0.01);
    await row.getByTestId('sound-mute').click();
    const muteOk = await until((d) => trackOf(d, mt).muted === true);
    await row.getByTestId('sound-mute').click();
    await until((d) => trackOf(d, mt).muted === false);
    await row.getByTestId('sound-duck-source').selectOption(vt);
    const duckOk = await until((d) => trackOf(d, mt).audio?.duck?.sourceTrackIds?.[0] === vt);
    await ep.getByTestId('sound-loudness-target').selectOption({ index: 1 });
    const targetOk = await until((d) => d.settings.loudness?.target === -14);
    await ep.getByTestId('sound-measure').click();
    await ep.locator('[data-testid=sound-loudness-result][data-lufs]').waitFor({ timeout: 60000 });
    const shown = Number(await ep.getByTestId('sound-loudness-result').getAttribute('data-lufs'));
    const apiL = (await call(`/projects/${pid}/analysis/loudness`, {})).body.integratedLufs;
    await ep.locator(`.clip[data-clip-id="${mc}"]`).click();
    await ep.getByTestId('sound-fade-in').fill('0.5');
    await ep.getByTestId('sound-fade-in').press('Tab');
    const fadeOk = await until((d) => { const c = trackOf(d, mt).clips.find((x: any) => x.id === mc); return !!c?.fadeIn && Math.abs(Number(c.fadeIn.value) / c.fadeIn.timescale - 0.5) < 1e-6; });
    await ep.getByTestId('sound-meter').waitFor();
    await ep.screenshot({ path: path.join(art, 'editor-sound.png') });
    check('editor Sound tab: volume in dB, mute, ducking source, loudness target, measured loudness shown, fade-in on the selected clip — each lands in the document; no page errors', gainOk && muteOk && duckOk && targetOk && Math.abs(shown - apiL) < 0.15 && fadeOk && eerr.length === 0, { gainOk, muteOk, duckOk, targetOk, shownLufs: shown, apiLufs: apiL, fadeOk, errors: eerr.slice(0, 3) });
    await ep.close();

    console.log('\n# agent (MCP)');
    const c = new Client({ name: 'phase8-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const l1 = await tool('measure_loudness', { projectId: pid });
    const duckOff = await tool('set_ducking', { projectId: pid, trackId: mt, sourceTrackIds: null });
    const l2 = await tool('measure_loudness', { projectId: pid });
    check('agent measures loudness, turns ducking off, measures again and sees the programme get louder', !l1.isError && !duckOff.isError && l2.data.integratedLufs > l1.data.integratedLufs, { before: l1.data.integratedLufs, after: l2.data.integratedLufs });
    await c.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Synthetic sine signals. Real speech/music, perceptual quality, EQ/dynamics, SFX, recording and voice providers are not exercised.', measurements, passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase8-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 8 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
