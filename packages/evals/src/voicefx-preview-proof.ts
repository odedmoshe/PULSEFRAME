/**
 * Sound effects in the editor preview, their cost, and the kernels across runtimes (ADR-0010 plan section 9: checks D, K, X).
 *   D  preview through the measurement tap against the server export: onsets, 50 ms levels, a seek into a reverb tail, priming
 *   K  cost: each voice in Node, four effect clips playing 30 s in the preview, main-thread long tasks against a bypassed baseline
 *   X  each kernel in Chromium (selftest.html, window.__pfFxRun) against Node on the same fixture
 * Needs `pnpm build` (the server serves the built editor), FFmpeg and Playwright's Chromium; CPU only.
 *   pnpm build && tsx packages/evals/src/voicefx-preview-proof.ts      (the second step of pnpm proof:voicefx)
 * Nobody has listened to these effects yet: every check here is a measurement, none says the sound is right.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { AUDIO_EFFECTS, audioEffectParams, type AudioFxParams, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, fillPlayingOrder, openClipVoice, soundEnd } from '@pulseframe/engine';
import { fxFixture, renderFx } from '@pulseframe/engine/audiofx/kernels/index.ts';
import { startServer } from '@pulseframe/server';
import { makeFxFixtures, onsets, readStereo } from './voicefx-fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/voicefx-preview');
const SR = 48000, FPS = 30;
const sec = (s: number) => T.frameTime(Math.round(s * FPS), { num: FPS, den: 1 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 600)}` : ''}`); };
const measurements: Record<string, unknown> = {};
/** The golden-hash variants of kernels.test.ts: a second, harder parameter set per effect for the runtime comparison. */
const VARIANTS: Record<string, AudioFxParams> = {
  'tone.bassboost': { gainDb: 15, freqHz: 150 },
  'voice.telephone': { grit: 1, hiss: 1 },
  'voice.megaphone': { drive: 1, amount: 0.7 },
  'voice.radio': { noise: 1 },
  'voice.robot': { pitchHz: 200, metal: 1 },
  'texture.8bit': { bits: 3, rateKhz: 3 },
  'space.echo': { pingPong: true, tone: 0.6, repeats: 8, delayMs: 120 },
  'space.reverb': { room: 'cave', decaySeconds: 3, damping: 1, spread: 0.3, predelayMs: 100, amount: 1 },
  'utility.width': { stereoWidth: 0 },
};
/** Peak of both channels of interleaved stereo over [from, to) seconds. */
const peakOver = (pcm: Float32Array, from: number, to: number) => { let p = 0; for (let i = Math.max(0, Math.round(from * SR)); i < Math.min(pcm.length / 2, Math.round(to * SR)); i++) p = Math.max(p, Math.abs(pcm[i * 2]!), Math.abs(pcm[i * 2 + 1]!)); return p; };
const db = (v: number) => 20 * Math.log10(Math.max(v, 1e-9));

interface PreviewRun { stats: any; longTasks: { start: number; ms: number }[]; wallMs: number }

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fx = await makeFxFixtures(path.join(art, 'fixtures'));
  const speech30 = path.join(art, 'fixtures', 'speech30.wav');
  execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-stream_loop', '2', '-i', fx.speechLike, '-t', '30', '-c:a', 'pcm_f32le', speech30]);
  const s = await startServer({ port: 8857, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const exportWav = async (pid: string, name: string) => {
    const jobId = (await call(`/projects/${pid}/exports`, { format: 'wav' })).body.jobId;
    let job: any;
    for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${jobId}/output`)).body);
    return readStereo(file, SR);
  };
  /** A project of sound clips: each entry is one clip on its own audio track with its effects; `extendTo` adds a muted clip so the programme (and the tails) run on to that second. */
  const project = async (name: string, clips: { file: string; at: number; seconds?: number; effects: { type: string; params?: AudioFxParams }[] }[], extendTo?: number) => {
    const pid = (await call('/projects', { name, width: 640, height: 360 })).body.project.id as string;
    const upload = async (file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json() as any).assetId as string;
    const ids: string[] = [];
    for (const c of clips) {
      const assetId = await upload(c.file);
      const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'audio' } }])).results[0].output.trackId;
      const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, trackId, start: sec(c.at), ...(c.seconds ? { duration: sec(c.seconds) } : {}) } }])).results[0].output.clipId as string;
      for (const e of c.effects) await tx(pid, [{ op: 'add_audio_effect', args: { clipId, type: e.type, ...(e.params ? { params: e.params } : {}) } }]);
      ids.push(clipId);
    }
    if (extendTo !== undefined) {
      const assetId = await upload(fx.impulse);
      const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'audio' } }])).results[0].output.trackId;
      await tx(pid, [{ op: 'add_clip', args: { assetId, trackId, start: sec(extendTo - 8), duration: sec(8) } }, { op: 'update_track', args: { trackId, muted: true } }]);
    }
    return { pid, ids, doc: async () => (await call(`/projects/${pid}`)).body.project as ProjectDocument };
  };

  const browser: Browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const errors: string[] = [];
  const openEditor = async (pid: string): Promise<Page> => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      (window as any).__pfAudioTap = true;
      (window as any).__pfLongTasks = [];
      try { new PerformanceObserver((list) => { for (const e of list.getEntries()) (window as any).__pfLongTasks.push({ start: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* no long-task timing in this browser */ }
    });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
    await page.waitForFunction(() => !!(window as any).__pfPlayer?.doc, undefined, { timeout: 30000 });
    return page;
  };
  /** Play the preview from `from` seconds for `seconds`, through the editor's own player (window.__pfPlayer, present with the tap on). */
  const playFor = (page: Page, from: number, seconds: number, bypass = false): Promise<PreviewRun> => page.evaluate(async ({ from, seconds, bypass, fps }) => {
    const p = (window as any).__pfPlayer;
    p.setBypassAudioFx(bypass);
    p.seek(Math.round(from * fps));
    (window as any).__pfLongTasks.length = 0;
    const t = performance.now();
    await p.play();
    await new Promise((r) => setTimeout(r, seconds * 1000));
    const stats = p.syncStats();
    p.pause();
    return { stats, longTasks: [...(window as any).__pfLongTasks], wallMs: performance.now() - t };
  }, { from, seconds, bypass, fps: FPS });
  const effectsRan = (run: PreviewRun, voices: number) => run.stats.clock === 'audio' && run.stats.fxVoices === voices && Object.keys(run.stats.unavailableAudioFx ?? {}).length === 0;

  try {
    console.log('# D: preview against the server export');
    // D1: beep onsets through telephone + echo
    const p1 = await project('fx onsets', [{ file: fx.beeps, at: 0, effects: [{ type: 'voice.telephone', params: { hiss: 0 } }, { type: 'space.echo' }] }]);
    const exp1 = await exportWav(p1.pid, 'onsets.wav');
    const wantOnsets = onsets(exp1, SR, 0.15, 0.3).map(r3);
    const page1 = await openEditor(p1.pid);
    const run1 = await playFor(page1, 0, 12.3);
    await page1.close();
    const gotOnsets: number[] = (run1.stats.audioOnsetsTimelineSeconds ?? []).map(r3);
    const pairs = wantOnsets.map((w) => { const g = gotOnsets.reduce((b, x) => (Math.abs(x - w) < Math.abs(b - w) ? x : b), Infinity); return { export: w, preview: g, ms: r3((g - w) * 1000) }; });
    measurements.onsets = { pairs, previewOnsets: gotOnsets, clock: run1.stats.clock, fxPrimeMs: run1.stats.fxPrimeMs, unavailable: run1.stats.unavailableAudioFx };
    check('D1 telephone + echo on 1 kHz beeps: every onset of the server export is heard in the preview within one frame (and 50 ms), on the audio clock, with the effects running in the browser', effectsRan(run1, 1) && wantOnsets.length === 6 && gotOnsets.length === wantOnsets.length && pairs.every((x) => Math.abs(x.preview - x.export) <= Math.min(0.05, 1 / FPS)), measurements.onsets);

    // D2: 50 ms window levels of a sweep through bass boost + hall reverb, ringing on past the clip
    const p2 = await project('fx levels', [{ file: fx.sweep, at: 0, effects: [{ type: 'tone.bassboost' }, { type: 'space.reverb' }] }], 12);
    const exp2 = await exportWav(p2.pid, 'levels.wav');
    const page2 = await openEditor(p2.pid);
    const run2 = await playFor(page2, 0, 10.5);
    await page2.close();
    const levels: { t: number; peak: number }[] = run2.stats.audioLevels ?? [];
    const points = Array.from({ length: 10 }, (_, i) => 0.5 + i).map((target) => { const w = levels.find((l) => l.t >= target); return w ? { t: w.t, preview: w.peak, export: r3(peakOver(exp2, w.t, w.t + 0.05)) } : { t: target, preview: NaN, export: NaN }; });
    measurements.levels = { points, windows: levels.length };
    check('D2 bass boost + hall reverb on a sweep: at 10 points (0.5 s to 9.5 s, through the reverb tail) the preview\'s 50 ms peak is within 0.04 of full scale of the export\'s', effectsRan(run2, 1) && points.every((p) => Math.abs(p.preview - p.export) <= 0.04), measurements.levels);

    // D3: seek into a reverb tail, then play
    const p3 = await project('fx tail', [{ file: fx.speechLike, at: 0, seconds: 2, effects: [{ type: 'space.reverb', params: { room: 'cave', decaySeconds: 3, amount: 0.5 } }] }], 12);
    const exp3 = await exportWav(p3.pid, 'tail.wav');
    const page3 = await openEditor(p3.pid);
    const run3 = await playFor(page3, 2.5, 2.2); // half a second after the clip's end: the tail falls about 20 dB a second
    await page3.close();
    const tail = (run3.stats.audioLevels ?? []).filter((l: { t: number }) => l.t >= 2.6 && l.t <= 4.6).map((l: { t: number; peak: number }) => ({ t: l.t, previewDb: r3(db(l.peak)), exportDb: r3(db(peakOver(exp3, l.t, l.t + 0.05))) })).filter((x: { exportDb: number }) => x.exportDb > -60);
    measurements.tailAfterSeek = { windows: tail.length, worstDb: tail.reduce((m: number, x: { previewDb: number; exportDb: number }) => Math.max(m, Math.abs(x.previewDb - x.exportDb)), 0), sample: tail.filter((_: unknown, i: number) => i % 10 === 0) };
    check('D3 after a seek to 0.5 s past the end of a clip with a cave reverb, playing gives the reverb tail at the export\'s level within 2 dB in every 50 ms window above -60 dBFS', effectsRan(run3, 1) && tail.length >= 20 && tail.every((x: { previewDb: number; exportDb: number }) => Math.abs(x.previewDb - x.exportDb) <= 2), measurements.tailAfterSeek);

    // D4: priming a 3 s hall from the middle of a 30 s clip (the longest warm-up)
    const p4 = await project('fx prime', [{ file: speech30, at: 0, effects: [{ type: 'space.reverb', params: { room: 'hall', decaySeconds: 3 } }] }]);
    const page4 = await openEditor(p4.pid);
    const run4 = await playFor(page4, 20, 1.5);
    await page4.close();
    const doc4 = await p4.doc();
    const c4 = audioPlan(doc4).clips[0]!;
    measurements.priming = { fxPrimeMs: run4.stats.fxPrimeMs, fxLateStarts: run4.stats.fxLateStarts, warmUpSeconds: c4.voice ? r3((c4.voice.warmRing + c4.voice.warmWindow) / SR) : null };
    check('D4 starting the preview 20 s into a clip with a 3 s hall reverb: the effects are rendered ahead (their whole warm-up) in at most 500 ms, and the first sound is on time', effectsRan(run4, 1) && run4.stats.fxPrimeMs <= 500 && run4.stats.fxLateStarts === 0, measurements.priming);

    console.log('# K: cost');
    // K1: every voice through the shared runtime in Node, on 30 s of speech-like sound
    const pk = await project('fx cost node', AUDIO_EFFECTS.map((e) => ({ file: speech30, at: 0, effects: [{ type: e.id }] })));
    const planK = audioPlan(await pk.doc());
    const native = readStereo(speech30, SR);
    const nodeCost: { type: string; realtime: number; kernelRealtime: number }[] = [];
    for (const c of planK.clips) {
      if (!c.voice) continue;
      const type = c.voice.chain[0]!.type;
      const t = performance.now();
      const v = openClipVoice(c, SR, c.voice.sourceRate, 0, soundEnd(c) - c.at);
      const P = new Float32Array((v.input.last - v.input.first) * 2);
      fillPlayingOrder(P, v.input.first, v.input, { start: 0, data: native });
      let out = 0;
      for (let i = 0; i < P.length; i += 8192) out += v.push(P.subarray(i, Math.min(P.length, i + 8192))).length >> 1;
      out += v.finish().length >> 1;
      const wall = (performance.now() - t) / 1000;
      const k0 = performance.now();
      renderFx(type, audioEffectParams(type, {}), native, { sampleRate: SR });
      nodeCost.push({ type, realtime: Math.round(out / SR / wall), kernelRealtime: Math.round(30 / ((performance.now() - k0) / 1000)) });
    }
    measurements.nodeCost = nodeCost;
    check('K1 every one of the 9 voices runs at least 20 times faster than real time in Node (whole voice: time map, effect, gains), on 30 s of sound', nodeCost.length === AUDIO_EFFECTS.length && nodeCost.every((x) => x.realtime >= 20), nodeCost);

    // K2 + K3: four effect clips playing 30 s in the preview, then the same bypassed as the baseline
    const p5 = await project('fx cost preview', [
      { file: speech30, at: 0, effects: [{ type: 'space.reverb', params: { room: 'hall', decaySeconds: 1.8, amount: 0.3 } }] },
      { file: speech30, at: 0, effects: [{ type: 'voice.telephone' }] },
      { file: speech30, at: 0, effects: [{ type: 'space.echo' }] },
      { file: speech30, at: 0, effects: [{ type: 'tone.bassboost' }] },
    ]);
    const page5 = await openEditor(p5.pid);
    const withFx = await playFor(page5, 0, 29.5);
    const baseline = await playFor(page5, 0, 29.5, true);
    await page5.close();
    const total = (r: PreviewRun) => Math.round(r.longTasks.reduce((a, x) => a + x.ms, 0));
    measurements.previewCost = { withEffects: { fxVoices: withFx.stats.fxVoices, fxPrimeMs: withFx.stats.fxPrimeMs, fxLateStarts: withFx.stats.fxLateStarts, fxLateSkips: withFx.stats.fxLateSkips, audioScheduledAheadMaxMs: withFx.stats.audioScheduledAheadMaxMs, longTasks: withFx.longTasks.length, longTaskMs: total(withFx), longestTaskMs: Math.round(Math.max(0, ...withFx.longTasks.map((x) => x.ms))), paintLatenessMs: withFx.stats.paintLatenessMs }, baseline: { fxVoices: baseline.stats.fxVoices, longTasks: baseline.longTasks.length, longTaskMs: total(baseline), audioScheduledAheadMaxMs: baseline.stats.audioScheduledAheadMaxMs } };
    check('K2 hall + telephone + echo + bass boost on four clips play 30 s in the preview with no voice starting late, no late part skipped, and sound scheduled at least 0.5 s ahead', effectsRan(withFx, 4) && withFx.stats.fxLateStarts === 0 && withFx.stats.fxLateSkips === 0 && withFx.stats.audioScheduledAheadMaxMs >= 500, measurements.previewCost);
    check('K3 main-thread long tasks while those four effect clips play: at most twice the time of the same playback with the effects bypassed (with 100 ms allowed over a near-zero baseline)', baseline.stats.fxVoices === 0 && total(withFx) <= Math.max(2 * total(baseline), total(baseline) + 100), measurements.previewCost);

    console.log('# X: kernels in Chromium against Node');
    const st = await browser.newPage();
    await st.goto(`${s.url}/selftest.html`);
    await st.waitForFunction(() => document.body.dataset.ready === '1' && typeof (window as any).__pfFxRun === 'function', undefined, { timeout: 60000 });
    const input = fxFixture(SR);
    const runtimes: { type: string; params: string; maxAbsDiff: number; bitEqual: boolean; chromiumMs: number }[] = [];
    for (const e of AUDIO_EFFECTS) for (const params of [{}, VARIANTS[e.id] ?? {}]) {
      const r: { base64: string; ms: number } = await st.evaluate(([type, p]) => (window as any).__pfFxRun(type, p), [e.id, params] as const);
      const buf = Buffer.from(r.base64, 'base64');
      const chrome = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
      const node = renderFx(e.id, audioEffectParams(e.id, params), input, { sampleRate: SR });
      let diff = chrome.length === node.length ? 0 : Infinity;
      if (diff === 0) for (let i = 0; i < node.length; i++) diff = Math.max(diff, Math.abs(chrome[i]! - node[i]!));
      runtimes.push({ type: e.id, params: JSON.stringify(params), maxAbsDiff: diff, bitEqual: diff === 0 && Buffer.from(node.buffer, node.byteOffset, node.byteLength).equals(buf), chromiumMs: r.ms });
    }
    await st.close();
    measurements.runtimes = runtimes;
    check('X every kernel (defaults and a harder parameter set) gives the same output in Chromium as in Node within 1e-6 on the fixed 3 s fixture (bit equality reported per kernel, not promised)', runtimes.length === 2 * AUDIO_EFFECTS.length && runtimes.every((x) => x.maxAbsDiff <= 1e-6), { bitEqual: runtimes.filter((x) => x.bitEqual).length, of: runtimes.length, worst: runtimes.reduce((m, x) => Math.max(m, x.maxAbsDiff), 0) });

    check('no page errors in any preview or self-test page', errors.length === 0, errors.slice(0, 5));
  } catch (e) {
    console.error(e);
    check('run completed', false, String((e as Error)?.stack ?? e).slice(0, 800));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = {
      ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
      machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, gpu: 'none' },
      scope: 'Synthetic fixtures only (ffmpeg lavfi beeps, sweep, speech-like pulse trains, impulse), 48 kHz projects, headless Chromium with its own audio clock. Preview levels come from the measurement tap (50 ms window peaks), not from a listener: nobody has listened to these effects yet. Not covered: 44.1 kHz devices, real speech, real-time audio devices, other browsers, the wave-2 worker host.',
      passed: checks.length - failed.length, total: checks.length, checks, measurements,
    };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/voicefx-preview-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSound effects preview proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
