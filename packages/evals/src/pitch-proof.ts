/**
 * Clip speed with "keep pitch", and a continuous speed ramp, on the three routes: server export, browser export and editor preview.
 * Fixture: 4 s of frame-barcode video with a 100 ms, 1 kHz beep at each second. At half speed with the pitch kept, the beeps
 * must start at 0, 2, 4 and 6 s and still be 1 kHz (plain speed change would make them 500 Hz); at double speed, at 0, 0.5,
 * 1 and 1.5 s and still 1 kHz (not 2 kHz).
 *   pnpm build && pnpm proof:pitch
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
const art = path.join(root, '.artifacts/pitch');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360, SR = 48000;
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const pcmOf = (file: string) => { const raw = ff(['-i', file, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-']); return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4); };
/** Every stretch of sound louder than the threshold (gaps under 50 ms bridged): start, end, and the frequency of its middle 60 % from zero crossings. */
function beeps(x: Float32Array) {
  const out: { start: number; end: number; hz: number }[] = [];
  const close = (a: number, b: number) => {
    const from = Math.round(a + (b - a) * 0.2), to = Math.round(a + (b - a) * 0.8);
    let z = 0;
    for (let i = from + 1; i < to; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) z++;
    out.push({ start: Number((a / SR).toFixed(4)), end: Number((b / SR).toFixed(4)), hz: Math.round((z / 2 / ((to - from) / SR)) * 10) / 10 });
  };
  let start = -1, last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]!) > 0.1) { if (start < 0) start = i; last = i; }
    else if (start >= 0 && i - last > 2400) { close(start, last + 1); start = -1; }
  }
  if (start >= 0) close(start, last + 1);
  return out;
}

const codesOf = (file: string) => { const raw = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']); const fb = W * H * 3; return Array.from({ length: Math.floor(raw.length / fb) }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, { x: 0, y: 0, w: W, h: H })); };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 8827, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const exportTo = async (pid: string, name: string, options: unknown = {}) => {
    const jobId = (await call(`/projects/${pid}/exports`, options)).body.jobId;
    let job: any;
    for (;;) { job = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(100); }
    if (job.status !== 'succeeded') throw new Error(`export ${job.status}: ${JSON.stringify(job.error)}`);
    const file = path.join(art, name);
    fs.writeFileSync(file, (await call(`/jobs/${jobId}/output`)).body);
    return file;
  };
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const measurements: Record<string, unknown> = {};
  try {
    const pid = (await call('/projects', { name: 'keep pitch', width: W, height: H })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const added = await tx(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }]);
    const clipId = added.results[0].output.clipId as string, audioId = added.results[0].output.audioClipId as string;
    const soundClip = async () => (await call(`/projects/${pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === audioId);
    const starts = (b: { start: number }[], want: number[], tol: number) => b.length === want.length && b.every((x, i) => Math.abs(x.start - want[i]!) <= tol);
    const pitched = (b: { hz: number }[], hz: number, tol: number) => b.every((x) => Math.abs(x.hz - hz) <= tol);

    console.log('# half speed');
    await tx(pid, [{ op: 'set_clip_speed', args: { clipId, speed: 0.5 } }]);
    const plainHalf = beeps(pcmOf(await exportTo(pid, 'half-plain.wav', { format: 'wav' })));
    const set = await tx(pid, [{ op: 'set_clip_pitch', args: { clipId, keepPitch: true } }]); // given the picture clip: applies to its linked sound
    const flagged = (await soundClip()).keepPitch === true && set.results[0].output.clipIds.join() === audioId;
    const fullFile = await exportTo(pid, 'half-kept.wav', { format: 'wav' });
    const keptHalf = beeps(pcmOf(fullFile));
    measurements.halfSpeed = { plain: plainHalf, kept: keptHalf };
    check('half speed, server export: without the option the beeps are 500 Hz; with "keep pitch" (set through the picture clip, stored on its linked sound) they start at 0, 2, 4 and 6 s within 25 ms, are still 1 kHz (±50 Hz) and last about twice as long',
      starts(plainHalf, [0, 2, 4, 6], 0.005) && pitched(plainHalf, 500, 5) && flagged && starts(keptHalf, [0, 2, 4, 6], 0.025) && pitched(keptHalf, 1000, 50) && keptHalf.every((b) => b.end - b.start > 0.16 && b.end - b.start < 0.24), measurements.halfSpeed);

    // a range of the same export: frames 45..135 (1.5 s .. 4.5 s) must be the same samples as that part of the full export
    const part = pcmOf(await exportTo(pid, 'half-kept-range.wav', { format: 'wav', range: { startFrame: 45, endFrame: 135 } }));
    const whole = pcmOf(fullFile);
    let maxDiff = 0;
    for (let i = 0; i < part.length; i++) maxDiff = Math.max(maxDiff, Math.abs(part[i]! - whole[Math.round(1.5 * SR) + i]!));
    measurements.rangeAgainstFull = { samples: part.length, maxDifference: Number(maxDiff.toExponential(2)) };
    check('a frame range of the stretched clip is sample for sample the same sound as that range of the full export (16-bit steps at most)', part.length === 3 * SR && maxDiff <= 2 / 32768, measurements.rangeAgainstFull);

    console.log('# half speed: browser export and preview');
    let browserBeeps: ReturnType<typeof beeps> = [], browserNote = '';
    const bp = await browser.newPage();
    await bp.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
    await bp.evaluate(() => (window as any).__pfBrowserExport.ready);
    const r: any = await bp.evaluate((p) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'draft' }), pid);
    if (r.ok) { const bf = path.join(art, `half-kept-browser.${r.result.container}`); fs.writeFileSync(bf, Buffer.from(r.result.base64, 'base64')); browserBeeps = beeps(pcmOf(bf)); browserNote = `${r.result.container}/${r.result.audioCodec}`; }
    else browserNote = `browser export did not run: ${JSON.stringify(r).slice(0, 200)}`;
    await bp.close();
    measurements.browserExport = { note: browserNote, beeps: browserBeeps };
    check('half speed, browser export: the beeps start within one frame of 0, 2, 4 and 6 s and are still 1 kHz (±50 Hz)', starts(browserBeeps, [0, 2, 4, 6], 1 / 30) && pitched(browserBeeps, 1000, 50), measurements.browserExport);

    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { (window as any).__pfAudioTap = true; try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
    await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
    const boxChecked = await page.getByTestId('clip-keep-pitch').isChecked().catch(() => null);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.getByTestId('play').click();
    await page.waitForFunction(() => (window as any).__pfSync().framesPainted > 10 && document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 60000 }).catch(() => {});
    const sync = await page.evaluate(() => (window as any).__pfSync());
    const onsets: number[] = (sync.audioOnsetsTimelineSeconds ?? []).map((x: number) => Number(x.toFixed(3)));
    // one onset per beep is expected; a stretched beep may register a second onset inside itself, so each expected time needs one onset near it
    const heard = [0, 2, 4, 6].map((w) => onsets.find((o) => Math.abs(o - w) <= 0.05) ?? null);
    measurements.preview = { clock: sync.clock, onsets, heard };
    // unticking the box in the Inspector goes back to plain speed change
    await page.getByTestId('clip-keep-pitch').click(); // the box follows the stored setting, so it changes only once the edit is committed
    let off = false;
    for (let i = 0; i < 80 && !off; i++) { off = !(await soundClip()).keepPitch; if (!off) await sleep(100); }
    await page.close();
    check('half speed, editor preview: played on the audio clock, a beep starts within 50 ms of 0, 2, 4 and 6 s; the Inspector shows "keep pitch" ticked and unticking it clears the setting; no page errors', sync.clock === 'audio' && heard.every((x) => x !== null) && boxChecked === true && off && errors.length === 0, { ...(measurements.preview as object), errors: errors.slice(0, 3) });

    console.log('# double speed, and backwards');
    await tx(pid, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }, { op: 'set_clip_pitch', args: { clipId: audioId, keepPitch: true } }]);
    const keptDouble = beeps(pcmOf(await exportTo(pid, 'double-kept.wav', { format: 'wav' })));
    await tx(pid, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]);
    const keptBack = beeps(pcmOf(await exportTo(pid, 'double-kept-reversed.wav', { format: 'wav' })));
    // forwards the beeps END at 0.05, 0.55, 1.05, 1.55 s of the 2 s clip; backwards they START at 2 s minus those
    measurements.doubleSpeed = { kept: keptDouble, keptReversed: keptBack };
    check('double speed with the pitch kept, server export: beeps at 0, 0.5, 1 and 1.5 s (±25 ms), still 1 kHz (±80 Hz; they are 50 ms long); played backwards as well, they start mirrored (0.45, 0.95, 1.45, 1.95 s ±30 ms) and are still 1 kHz',
      starts(keptDouble, [0, 0.5, 1, 1.5], 0.025) && pitched(keptDouble, 1000, 80) && starts(keptBack, [0.45, 0.95, 1.45, 1.95], 0.03) && pitched(keptBack, 1000, 80), measurements.doubleSpeed);

    console.log('# refusals and speed 1');
    const noSound = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }] });
    const textId = noSound.body.results[0].output.clipId;
    const bad = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_pitch', args: { clipId: textId, keepPitch: true } }] });
    const twice = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_pitch', args: { clipId: audioId, keepPitch: true } }] });
    await tx(pid, [{ op: 'set_clip_reverse', args: { clipId, reverse: false } }, { op: 'set_clip_speed', args: { clipId, speed: 1 } }]);
    const atOne = beeps(pcmOf(await exportTo(pid, 'one-kept.wav', { format: 'wav' })));
    check('a clip without sound is refused, setting the same value twice is refused, and at speed 1 the option changes nothing (beeps at 0, 1, 2, 3 s, 1 kHz, 100 ms)', bad.status >= 400 && twice.status >= 400 && starts(atOne, [0, 1, 2, 3], 0.003) && pitched(atOne, 1000, 15) && atOne.every((b) => Math.abs(b.end - b.start - 0.1) < 0.005), { bad: bad.body?.error?.code, twice: twice.body?.error?.code, atOne });

    console.log('# continuous speed ramp (0.5× → 2× over the clip)');
    // 4 s of source at an average speed of 1.25: 3.2 s (96 frames). After τ seconds, 0.5·τ + 1.5·τ²/6.4 seconds of source have played.
    const rp = (await call('/projects', { name: 'smooth ramp', width: W, height: H })).body.project.id;
    const rup: any = await (await fetch(`${s.url}/api/v1/projects/${rp}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const radd = await tx(rp, [{ op: 'add_clip', args: { assetId: rup.assetId, start: f(0) } }]);
    const rclip = radd.results[0].output.clipId as string;
    const ramped = await tx(rp, [{ op: 'set_clip_speed_ramp', args: { clipId: rclip, from: 0.5, to: 2 } }]);
    const srcAfter = (t: number) => 0.5 * t + (1.5 * t * t) / 6.4;
    const wantFrames = Array.from({ length: 96 }, (_, i) => Math.floor(srcAfter(i / 30) * 30 + 1e-9));
    const speedAt = (t: number) => 0.5 + (1.5 * t) / 3.2;
    const wantBeeps = [0, 1, 2, 3].map((sec) => (-0.5 + Math.sqrt(0.25 + (4 * 1.5 * sec) / 6.4)) / (2 * 1.5 / 6.4)); // when source second `sec` is reached
    const rampFile = await exportTo(rp, 'ramp.mp4');
    const gotFrames = codesOf(rampFile), gotBeeps = beeps(pcmOf(rampFile));
    const wrongFrames = gotFrames.map((g, i) => (g === wantFrames[i] ? -1 : i)).filter((i) => i >= 0);
    const pitchOk = (b: ReturnType<typeof beeps>) => b.every((x) => Math.abs(x.hz / (1000 * speedAt((x.start + x.end) / 2)) - 1) < 0.05);
    measurements.ramp = { clips: (await call(`/projects/${rp}`)).body.project.sequences.seq_main.tracks.map((t: any) => t.clips.length), durationFrames: ramped.results[0].output.durationFrames, wantBeepStarts: wantBeeps.map((x) => Number(x.toFixed(3))), server: gotBeeps, wrongFrames: wrongFrames.slice(0, 5), firstFrames: gotFrames.slice(0, 6), lastFrames: gotFrames.slice(-3) };
    check('smooth ramp, server export: still one picture clip and one sound clip; 96 frames, each showing exactly the source frame the ramp formula gives (never going back, ending on 118–119); the four beeps start where the formula puts them (±5 ms) and each has the pitch of the speed at that moment (1 kHz × speed, within 5 %)',
      JSON.stringify((measurements.ramp as any).clips.filter((n: number) => n > 0)) === '[1,1]' && gotFrames.length === 96 && wrongFrames.length === 0 && gotFrames.every((g, i) => i === 0 || g >= gotFrames[i - 1]!) && gotFrames[95]! >= 118
      && gotBeeps.length === 4 && gotBeeps.every((b, i) => Math.abs(b.start - wantBeeps[i]!) <= 0.005) && pitchOk(gotBeeps), measurements.ramp);
    const rpart = pcmOf(await exportTo(rp, 'ramp-range.wav', { format: 'wav', range: { startFrame: 30, endFrame: 90 } }));
    const rwhole = pcmOf(await exportTo(rp, 'ramp-full.wav', { format: 'wav' }));
    let rdiff = 0;
    for (let i = 0; i < rpart.length; i++) rdiff = Math.max(rdiff, Math.abs(rpart[i]! - rwhole[SR + i]!));
    check('a frame range of the ramped clip is the same sound as that range of the full export', rpart.length === 2 * SR && rdiff <= 2 / 32768, { maxDifference: Number(rdiff.toExponential(2)) });

    let rbFrames: number[] = [], rbBeeps: ReturnType<typeof beeps> = [], rbNote = '';
    const rbp = await browser.newPage();
    await rbp.goto(`${s.url}/browser-export.html?key=${s.auth.tokens.owner}`);
    await rbp.evaluate(() => (window as any).__pfBrowserExport.ready);
    const rr: any = await rbp.evaluate((p) => (window as any).__pfBrowserExport.tryRun(p, { quality: 'high' }), rp);
    if (rr.ok) { const bf = path.join(art, `ramp-browser.${rr.result.container}`); fs.writeFileSync(bf, Buffer.from(rr.result.base64, 'base64')); rbFrames = codesOf(bf); rbBeeps = beeps(pcmOf(bf)); rbNote = `${rr.result.container}/${rr.result.audioCodec}`; }
    else rbNote = `browser export did not run: ${JSON.stringify(rr).slice(0, 200)}`;
    await rbp.close();
    check('smooth ramp, browser export: the same 96 frames, beeps within one frame of the formula and at the pitch of the speed at that moment (within 5 %)', JSON.stringify(rbFrames) === JSON.stringify(wantFrames) && rbBeeps.length === 4 && rbBeeps.every((b, i) => Math.abs(b.start - wantBeeps[i]!) <= 1 / 30) && pitchOk(rbBeeps), { note: rbNote, beeps: rbBeeps, frames: rbFrames.length });

    const rpage = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    const rerrors: string[] = [];
    rpage.on('pageerror', (e) => rerrors.push(String(e)));
    await rpage.addInitScript(() => { (window as any).__pfAudioTap = true; try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    await rpage.goto(`${s.ownerUrl}&project=${rp}`);
    await rpage.waitForFunction(() => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null)?.dataset.frame === '0', undefined, { timeout: 30000 });
    const seen: Record<number, number> = {};
    for (const target of [1, 30, 60, 95]) {
      await rpage.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const q = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: q.left + x, clientY: q.top + 5, bubbles: true })); }, (target / 30) * 90 + 0.5);
      await rpage.waitForFunction((t) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, target, { timeout: 15000 }).catch(() => {});
      const shot = await rpage.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; return { w: cv.width, data: Array.from(cv.getContext('2d')!.getImageData(0, Math.round(cv.height / 12), cv.width, 1).data.filter((_, i) => i % 4 !== 3)) }; });
      seen[target] = readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: 0, y: 0, w: shot.w, h: 0 });
    }
    await rpage.evaluate(() => { const el = document.querySelector('[data-testid=ruler]')!; const q = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: q.left + 0.5, clientY: q.top + 5, bubbles: true })); });
    await rpage.locator(`.clip[data-clip-id="${rclip}"]`).click();
    const marked = await rpage.locator(`.clip[data-clip-id="${rclip}"]`).getAttribute('data-ramp');
    const stateText = ((await rpage.getByTestId('ramp-state').textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    await rpage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await rpage.getByTestId('play').click();
    await rpage.waitForFunction(() => (window as any).__pfSync().framesPainted > 10 && document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 60000 }).catch(() => {});
    const rsync = await rpage.evaluate(() => (window as any).__pfSync());
    const ronsets: number[] = (rsync.audioOnsetsTimelineSeconds ?? []).map((x: number) => Number(x.toFixed(3)));
    const rheard = wantBeeps.map((w) => ronsets.find((o) => Math.abs(o - w) <= 0.05) ?? null);
    // "back to one speed" in the Inspector
    await rpage.getByTestId('ramp-clear').click();
    let cleared = false;
    for (let i = 0; i < 80 && !cleared; i++) { const c = (await call(`/projects/${rp}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === rclip); cleared = !c.speedEnd && c.speed?.num === 1 && c.speed?.den === 2; if (!cleared) await sleep(100); }
    await rpage.close();
    check('smooth ramp, editor: paused frames 1, 30, 60 and 95 show the source frames of the formula; played on the audio clock a beep starts within 50 ms of each expected time; the clip is marked and the Inspector states 0.5× → 2×; "back to one speed" leaves 0.5×; no page errors',
      [1, 30, 60, 95].every((t) => seen[t] === wantFrames[t]) && rsync.clock === 'audio' && rheard.every((x) => x !== null) && marked === 'true' && /0\.5× → 2×/.test(stateText) && cleared && rerrors.length === 0, { seen, want: [1, 30, 60, 95].map((t) => wantFrames[t]), onsets: ronsets, heard: rheard, stateText, errors: rerrors.slice(0, 3) });

    console.log('# a ramped clip cut into parts; an eased ramp');
    const newRamp = async (name: string, curve?: string) => {
      const id = (await call('/projects', { name, width: W, height: H })).body.project.id;
      const up2: any = await (await fetch(`${s.url}/api/v1/projects/${id}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
      const c = (await tx(id, [{ op: 'add_clip', args: { assetId: up2.assetId, start: f(0) } }])).results[0].output.clipId as string;
      await tx(id, [{ op: 'set_clip_speed_ramp', args: { clipId: c, from: 0.5, to: 2, ...(curve ? { curve } : {}) } }]);
      return { id, clip: c };
    };
    const cutP = await newRamp('ramp in parts');
    await tx(cutP.id, [{ op: 'split_clip', args: { clipId: cutP.clip, at: f(30) } }]);
    const second = (await call(`/projects/${cutP.id}`)).body.project.sequences.seq_main.tracks.find((t: any) => t.kind === 'video').clips[1].id;
    await tx(cutP.id, [{ op: 'split_clip', args: { clipId: second, at: f(70) } }]);
    const partsFile = await exportTo(cutP.id, 'ramp-parts.mp4');
    const partFrames = codesOf(partsFile), partBeeps = beeps(pcmOf(partsFile));
    const partsDoc = (await call(`/projects/${cutP.id}`)).body.project;
    const partCounts = partsDoc.sequences.seq_main.tracks.map((t: any) => t.clips.length).filter((n: number) => n > 0);
    // then trim two frames off the start of the last part and close the gap by moving it: the two frames are simply missing
    const lastPart = partsDoc.sequences.seq_main.tracks.find((t: any) => t.kind === 'video').clips[2].id;
    await tx(cutP.id, [{ op: 'trim_clip', args: { clipId: lastPart, edge: 'start', to: f(72) } }, { op: 'move_clip', args: { clipId: lastPart, start: f(70) } }]);
    const trimmedFrames = codesOf(await exportTo(cutP.id, 'ramp-parts-trimmed.mp4'));
    check('a ramped clip split into three parts exports exactly the frames of the undivided clip (all 96) with the beeps where they were (±3 ms) and at the same pitch; trimming two frames off the start of the last part removes exactly those two frames',
      JSON.stringify(partCounts) === '[3,3]' && JSON.stringify(partFrames) === JSON.stringify(wantFrames) && partBeeps.length === 4 && partBeeps.every((b, i) => Math.abs(b.start - gotBeeps[i]!.start) <= 0.003 && Math.abs(b.hz - gotBeeps[i]!.hz) <= 15)
      && JSON.stringify(trimmedFrames) === JSON.stringify([...wantFrames.slice(0, 70), ...wantFrames.slice(72)]), { partCounts, framesEqual: JSON.stringify(partFrames) === JSON.stringify(wantFrames), partBeeps, trimmedCount: trimmedFrames.length });

    const easedP = await newRamp('eased ramp', 'smooth');
    const easedAfter = (t: number) => 0.5 * t + 1.5 * ((t * t * t) / (3.2 * 3.2) - (t * t * t * t) / (2 * 3.2 * 3.2 * 3.2));
    const wantEased = Array.from({ length: 96 }, (_, i) => Math.floor(easedAfter(i / 30) * 30 + 1e-9));
    const easedFile = await exportTo(easedP.id, 'ramp-eased.mp4');
    const easedFrames = codesOf(easedFile), easedBeeps = beeps(pcmOf(easedFile));
    // when the eased ramp reaches source seconds 1, 2 and 3 (found numerically from the same formula)
    const reach = (sec: number) => { let lo = 0, hi = 3.2; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (easedAfter(m) < sec) lo = m; else hi = m; } return (lo + hi) / 2; };
    const wantEasedBeeps = [0, reach(1), reach(2), reach(3)];
    check('an eased ramp (0.5× → 2×, easing in and out): 96 frames, each the source frame its formula gives — it differs from the even ramp in between and ends on the same frame; the beeps start where the formula puts them (±5 ms)',
      JSON.stringify(easedFrames) === JSON.stringify(wantEased) && JSON.stringify(wantEased) !== JSON.stringify(wantFrames) && easedBeeps.length === 4 && easedBeeps.every((b, i) => Math.abs(b.start - wantEasedBeeps[i]!) <= 0.005), { want: wantEasedBeeps.map((x) => Number(x.toFixed(3))), got: easedBeeps, frame48: [easedFrames[48], wantFrames[48]], last: [easedFrames[95], wantFrames[95]] });
  } catch (e) {
    console.error(e);
    check('run completed', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none' }, scope: 'One synthetic 4-second fixture (frame barcode with a 100 ms, 1 kHz beep each second) at half and double speed with the pitch kept. Beep times and frequencies are measured from the exported sound; in the preview only beep onsets are measured (not the frequency). A continuous ramp 0.5× → 2× on the same fixture: every exported frame against the ramp formula, beep times and pitch. No speech, no music, no listening test: this shows timing and pitch are right, not that it sounds good.', passed: checks.length - failed.length, total: checks.length, checks, measurements };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/pitch-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPitch proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
