/**
 * Clip speed proof (SPEC §14): slow motion and speed-up through the normal op path, checked on real output.
 *  - every exported frame of a 2× and a 0.5× clip shows the source frame the mapping predicts (frame barcode),
 *  - the same in the editor preview and in still renders (one evaluator),
 *  - sound is resampled with the picture: length and pitch measured on the exported mix,
 *  - captions and source-linked markers follow the speed; split and undo behave,
 *  - freeze frame: held picture, inserted time and silent hold checked on exported frames and sound.
 * Not covered: pitch-preserving time stretch (not implemented; sound is varispeed), speed ramps, reverse, real footage.
 *   pnpm build && pnpm proof:speed
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
const art = path.join(root, '.artifacts/speed');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const SR = 48000, W = 640, H = 360;
const full = { x: 0, y: 0, w: W, h: H };

/** Frequency of a steady tone from its zero crossings, and where the sound ends (last sample above the floor). */
function tone(x: Float32Array, fromS: number, toS: number) {
  let z = 0;
  const a = Math.floor(fromS * SR), b = Math.floor(toS * SR);
  for (let i = a + 1; i < b; i++) if ((x[i - 1]! < 0) !== (x[i]! < 0)) z++;
  let last = 0;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]!) > 0.02) { last = i; break; }
  return { hz: z / 2 / (toS - fromS), endS: last / SR };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_4s.mp4') });
  const toneFile = path.join(art, 'tone440.wav');
  ff(['-y', '-f', 'lavfi', '-t', '4', '-i', `sine=f=440:r=${SR}`, '-af', 'volume=0.5', '-ac', '2', '-c:a', 'pcm_s16le', toneFile]);

  const s = await startServer({ port: 8812, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } };
  let n = 0;
  const exportFile = async (pid: string, body: Record<string, unknown>, ext: string) => {
    const job = await waitJob((await call(`/projects/${pid}/exports`, body)).body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const file = path.join(art, `out-${++n}.${ext}`);
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    return file;
  };
  /** Source frame index shown by each exported frame. */
  const exportedFrames = async (pid: string) => {
    const raw = ff(['-i', await exportFile(pid, {}, 'mp4'), '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = W * H * 3;
    return Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, full));
  };
  const mixPcm = async (pid: string) => {
    const raw = ff(['-i', await exportFile(pid, { format: 'wav' }, 'wav'), '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-']);
    return new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
  };
  const clipsOf = (d: any, kind: string) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === kind).flatMap((t: any) => t.clips);
  const measurements: Record<string, unknown> = {};
  const browser = await chromium.launch();
  try {
    console.log('\n# picture: exported frames');
    const pid = (await call('/projects', { name: 'speed', width: W, height: H })).body.project.id;
    const asset = await upload(pid, fixture.file);
    const clip = (await txs(pid, [{ op: 'add_clip', args: { assetId: asset.assetId, start: f(0) } }])).results[0].output.clipId as string;
    const sp2 = await txs(pid, [{ op: 'set_clip_speed', args: { clipId: clip, speed: 2 } }]);
    let d = await doc(pid);
    check('set_clip_speed 2: one transaction halves the clip (120 → 60 frames) and its linked sound together, source span unchanged', sp2.results[0].output.durationFrames === 60 && clipsOf(d, 'video')[0].speed.num === 2 && clipsOf(d, 'audio').every((c: any) => c.speed?.num === 2 && T.frameIndexAt(c.duration, R) === 60), { revision: sp2.revision });
    const fast = await exportedFrames(pid);
    const fastBad = fast.map((g, i) => (g === 2 * i ? -1 : i)).filter((i) => i >= 0);
    check('2×: the export has 60 frames and frame i shows source frame 2i — every frame read from its barcode', fast.length === 60 && fastBad.length === 0, { frames: fast.length, mismatched: fastBad.slice(0, 8), sample: fast.slice(0, 6) });
    await txs(pid, [{ op: 'set_clip_speed', args: { clipId: clip, speed: 0.5 } }]);
    const slow = await exportedFrames(pid);
    const slowBad = slow.map((g, i) => (g === Math.floor(i / 2) ? -1 : i)).filter((i) => i >= 0);
    check('0.5×: the export has 240 frames and frame i shows source frame floor(i/2) (each source frame held for two)', slow.length === 240 && slowBad.length === 0, { frames: slow.length, mismatched: slowBad.slice(0, 8), sample: slow.slice(0, 6) });
    await txs(pid, [{ op: 'set_clip_speed', args: { clipId: clip, speed: 1.5 } }]);
    d = await doc(pid);
    const odd = await exportedFrames(pid);
    const oddBad = odd.map((g, i) => (g === Math.floor((i * 3) / 2) ? -1 : i)).filter((i) => i >= 0);
    check('1.5× (exact ratio 3/2): 80 frames, frame i shows source frame floor(3i/2); no drift at the end of the clip', odd.length === 80 && oddBad.length === 0 && odd[79] === 118, { frames: odd.length, mismatched: oddBad.slice(0, 8), last: odd[79], stored: clipsOf(d, 'video')[0].speed });

    console.log('\n# edits on a sped clip');
    await txs(pid, [{ op: 'set_clip_speed', args: { clipId: clip, speed: 2 } }, { op: 'split_clip', args: { clipId: clip, at: f(30) } }]);
    d = await doc(pid);
    const parts = clipsOf(d, 'video');
    const after = await exportedFrames(pid);
    check('split at timeline frame 30 of the 2× clip: the right half starts at source 2 s, keeps its speed, and the export is unchanged frame for frame', parts.length === 2 && T.eq(parts[1].sourceIn, T.rt(2, 1)) && parts[1].speed.num === 2 && JSON.stringify(after) === JSON.stringify(fast));
    const overlap = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_speed', args: { clipId: parts[0].id, speed: 0.5 } }] });
    check('slowing a clip into its neighbour is refused with a clear error and changes nothing', overlap.status >= 400 && (await doc(pid)).sequences.seq_main.tracks[0].clips.length === parts.length, { status: overlap.status, code: overlap.body?.error?.code });
    const still = await call(`/projects/${pid}/frame?index=45`);
    const stillFile = path.join(art, 'still45.png');
    fs.writeFileSync(stillFile, still.body);
    const stillRaw = ff(['-i', stillFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    check('a still render of timeline frame 45 shows source frame 90 (same evaluator as export)', still.status === 200 && readBarcode(stillRaw, W, 3, full) === 90);
    await call(`/projects/${pid}/undo`, {});
    d = await doc(pid);
    check('undo: speed change and split were one transaction, so one undo returns to the single 1.5× clip of 80 frames', clipsOf(d, 'video').length === 1 && clipsOf(d, 'video')[0].speed.num === 3 && T.frameIndexAt(clipsOf(d, 'video')[0].duration, R) === 80);

    console.log('\n# freeze frame');
    const fp = (await call('/projects', { name: 'freeze', width: W, height: H })).body.project.id;
    const fa = await upload(fp, fixture.file);
    const fclip = (await txs(fp, [{ op: 'add_clip', args: { assetId: fa.assetId, start: f(0) } }, { op: 'add_text', args: { text: 'T', start: f(30), duration: f(30), style: { sizeFrac: 0.03 } } }])).results[0].output.clipId as string;
    const fz = await txs(fp, [{ op: 'freeze_frame', args: { clipId: fclip, at: f(45), duration: f(30) } }]);
    const fd = await doc(fp);
    const frozen = await exportedFrames(fp);
    const want = (i: number) => (i < 45 ? i : i < 75 ? 45 : i - 30);
    const frozenBad = frozen.map((g, i) => (g === want(i) ? -1 : i)).filter((i) => i >= 0);
    const titleClip = fd.sequences.seq_main.tracks.find((t: any) => t.kind === 'text').clips[0];
    check('freeze_frame at timeline frame 45 for 30 frames: the export has 150 frames — 0..44 play, 45..74 all show source frame 45, 75..149 continue from 45 — every frame read from its barcode; a title crossing the point stays up through the hold', frozen.length === 150 && frozenBad.length === 0 && T.frameIndexAt(titleClip.duration, R) === 60 && clipsOf(fd, 'video').filter((c: any) => c.freeze).length === 1, { revision: fz.revision, frames: frozen.length, mismatched: frozenBad.slice(0, 8), around: frozen.slice(43, 47).concat(frozen.slice(73, 77)) });
    // sound: the fixture beeps at each whole source second; with a 1 s hold inserted at 1.5 s the beeps of source 2 s and 3 s are heard at 3 s and 4 s, and the hold itself is silent
    const fpcm = await mixPcm(fp);
    const peakIn = (a: number, b: number) => { let m = 0; for (let i = Math.floor(a * SR); i < Math.floor(b * SR) && i < fpcm.length; i++) m = Math.max(m, Math.abs(fpcm[i]!)); return Number(m.toFixed(3)); };
    const sound = { seconds: Number((fpcm.length / SR).toFixed(3)), beepAt1: peakIn(1.0, 1.05), holdPeak: peakIn(1.5, 2.5), beepAt3: peakIn(3.0, 3.05), noBeepAt2: peakIn(2.0, 2.05), beepAt4: peakIn(4.0, 4.05) };
    measurements.freezeSound = sound;
    check('sound around the hold: 5 s in total, silent during the held second, and the later beeps arrive exactly one second later than before', Math.abs(sound.seconds - 5) < 0.02 && sound.beepAt1 > 0.1 && sound.holdPeak < 0.005 && sound.noBeepAt2 < 0.005 && sound.beepAt3 > 0.1 && sound.beepAt4 > 0.1, sound);
    await call(`/projects/${fp}/undo`, {});
    const fundo = await doc(fp);
    check('one undo removes the hold and rejoins nothing by hand: the timeline is the single 120-frame clip again', clipsOf(fundo, 'video').length === 1 && T.frameIndexAt(clipsOf(fundo, 'video')[0].duration, R) === 120 && clipsOf(fundo, 'audio').length === 1);

    console.log('\n# speed ramp');
    const rp = (await call('/projects', { name: 'ramp', width: W, height: H })).body.project.id;
    const ra: any = await (await fetch(`${s.url}/api/v1/projects/${rp}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'barcode.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const rc = (await txs(rp, [{ op: 'add_clip', args: { assetId: ra.assetId, start: f(0) } }])).results[0].output.clipId as string;
    const ramp = await txs(rp, [{ op: 'speed_ramp', args: { clipId: rc, from: 0.5, to: 2, steps: 4 } }]);
    const rampOut = ramp.results[0].output;
    const rd = await doc(rp);
    const rampFrames = await exportedFrames(rp);
    // expected by arithmetic from the steps as stored: each step shows floor(sourceIn + i × speed) for its frames
    const expectRamp: number[] = [];
    for (const c of clipsOf(rd, 'video')) { const sp = c.speed ? c.speed.num / c.speed.den : 1, n = T.frameIndexAt(c.duration, R), in0 = T.toSeconds(c.sourceIn) * 30; for (let i = 0; i < n; i++) expectRamp.push(Math.floor(in0 + i * sp + 1e-9)); }
    const rampBad = rampFrames.map((g, i) => (g === expectRamp[i] ? -1 : i)).filter((i) => i >= 0);
    check('speed ramp 0.5× → 2× in four steps: one transaction makes four linked picture+sound steps (0.5, 1, 1.5, 2); the export has exactly the planned number of frames, every frame is the one the steps call for (read from its barcode), the picture never goes back, and the last frames reach the end of the source', JSON.stringify(rampOut.speeds) === JSON.stringify([0.5, 1, 1.5, 2]) && clipsOf(rd, 'video').length === 4 && clipsOf(rd, 'audio').length === 4 && rampFrames.length === rampOut.durationFrames && rampBad.length === 0 && rampFrames.every((g, i) => i === 0 || g >= rampFrames[i - 1]!) && rampFrames.at(-1)! >= 112, { speeds: rampOut.speeds, frames: rampFrames.length, planned: rampOut.durationFrames, mismatched: rampBad.slice(0, 6), first: rampFrames.slice(0, 6), last: rampFrames.slice(-4) });
    await call(`/projects/${rp}/undo`, {});
    const rundo = await doc(rp);
    check('one undo of the ramp restores the single 120-frame clip', clipsOf(rundo, 'video').length === 1 && T.frameIndexAt(clipsOf(rundo, 'video')[0].duration, R) === 120 && !clipsOf(rundo, 'video')[0].speed);

    console.log('\n# sound: resampled with the picture');
    const ap = (await call('/projects', { name: 'speed-audio', width: W, height: H })).body.project.id;
    const ta = await upload(ap, toneFile);
    const tc = (await txs(ap, [{ op: 'add_clip', args: { assetId: ta.assetId, start: f(0) } }])).results[0].output;
    const tcId = (tc.audioClipId ?? tc.clipId) as string;
    const rows: any[] = [];
    for (const [speed, hz, len] of [[1, 440, 4], [2, 880, 2], [0.5, 220, 8], [1.25, 550, 3.2]] as const) {
      await txs(ap, [{ op: 'set_clip_speed', args: { clipId: tcId, speed } }]);
      const m = tone(await mixPcm(ap), 0.2, len - 0.2);
      rows.push({ speed, expectedHz: hz, measuredHz: Number(m.hz.toFixed(2)), expectedSeconds: len, soundEndsAt: Number(m.endS.toFixed(3)) });
    }
    measurements.audio = { method: 'zero crossings of the exported WAV mix; 440 Hz source tone of 4 s', rows };
    check('exported sound of a 440 Hz tone at 1×, 2×, 0.5×, 1.25×: pitch within 0.5 Hz of 440×speed and length within one frame of 4/speed (varispeed: pitch follows speed)', rows.every((r) => Math.abs(r.measuredHz - r.expectedHz) < 0.5 && Math.abs(r.soundEndsAt - r.expectedSeconds) < 1 / 30 + 0.005), rows);

    console.log('\n# captions and markers follow the speed');
    const cp = (await call('/projects', { name: 'speed-captions', width: W, height: H })).body.project.id;
    const ca = await upload(cp, fixture.file);
    const cc = (await txs(cp, [
      { op: 'add_clip', args: { assetId: ca.assetId, start: f(0) } },
      { op: 'set_transcript', args: { assetId: ca.assetId, language: 'en', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: 'first half' }, { start: T.rt(2, 1), duration: T.rt(2, 1), text: 'second half' }] } },
      { op: 'add_caption_track', args: { mode: 'transcript' } },
      { op: 'edit_analysis', args: { assetId: ca.assetId, kind: 'scenes', add: [T.rt(3, 1)] } },
    ])).results[0].output.clipId as string;
    const cueTimes = async () => [...String((await call(`/projects/${cp}/captions?format=srt`)).body).matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/g)].map((m) => [Number(m[3]) + Number(m[4]) / 1000, Number(m[7]) + Number(m[8]) / 1000]);
    const base = await cueTimes();
    await txs(cp, [{ op: 'set_clip_speed', args: { clipId: cc, speed: 2 } }]);
    const fastCues = await cueTimes();
    const markers = (await call(`/projects/${cp}/timeline`)).body.markers.sceneCutSeconds;
    check('captions made from the transcript follow the speed: cues at 0–2 s and 2–4 s become 0–1 s and 1–2 s at 2×; a scene marker at source 3 s sits at 1.5 s', JSON.stringify(base) === JSON.stringify([[0, 2], [2, 4]]) && JSON.stringify(fastCues) === JSON.stringify([[0, 1], [1, 2]]) && JSON.stringify(markers) === JSON.stringify([1.5]), { base, fastCues, markers });

    console.log('\n# editor');
    const ep = (await call('/projects', { name: 'speed-editor', width: W, height: H })).body.project.id;
    const ea = await upload(ep, fixture.file);
    const ec = (await txs(ep, [{ op: 'add_clip', args: { assetId: ea.assetId, start: f(0) } }])).results[0].output.clipId as string;
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'clip'); localStorage.setItem('pf.lang', 'en'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${ep}`);
    await page.locator(`.clip[data-clip-id="${ec}"]`).click();
    const widthBefore = (await page.locator(`.clip[data-clip-id="${ec}"]`).boundingBox())!.width;
    await page.getByTestId('clip-speed-2').click();
    let ed: any;
    for (let i = 0; i < 100; i++) { ed = await doc(ep); if (clipsOf(ed, 'video')[0].speed) break; await sleep(100); }
    await sleep(300);
    const widthAfter = (await page.locator(`.clip[data-clip-id="${ec}"]`).boundingBox())!.width;
    const shown = await page.getByTestId('clip-speed').inputValue();
    check('Inspector: the 2× preset commits set_clip_speed; the field shows 2 and the clip on the timeline is half as wide', clipsOf(ed, 'video')[0].speed?.num === 2 && shown === '2' && Math.abs(widthAfter / widthBefore - 0.5) < 0.03, { shown, widthBefore, widthAfter });
    const wrong: { target: number; got: number }[] = [];
    for (const target of [0, 10, 31, 59, 20]) {
      await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (target / 30) * 90 + 0.5);
      await page.waitForFunction((t) => (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.frame === String(t) && (document.querySelector('[data-testid=preview]') as HTMLCanvasElement)?.dataset.quality === 'full', target, { timeout: 15000 }).catch(() => {});
      const shot = await page.evaluate(() => {
        const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        const y = Math.round(c.height / 12);
        return { w: c.width, data: Array.from(c.getContext('2d')!.getImageData(0, y, c.width, 1).data.filter((_, i) => i % 4 !== 3)) };
      });
      const got = readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: 0, y: 0, w: shot.w, h: 0 });
      if (got !== target * 2) wrong.push({ target, got });
    }
    await page.getByTestId('clip-speed').fill('0.75');
    await page.getByTestId('clip-speed').press('Enter');
    for (let i = 0; i < 100; i++) { ed = await doc(ep); if (clipsOf(ed, 'video')[0].speed?.den === 4) break; await sleep(100); }
    const at075 = ed;
    const docAt075 = async () => at075;
    const ratio34Frames = T.frameIndexAt(clipsOf(at075, 'video')[0].duration, R);
    // freeze frame from the Inspector: speed back to 1, playhead to frame 30, hold for 0.5 s
    await page.getByTestId('clip-speed-1').click();
    for (let i = 0; i < 100; i++) { ed = await doc(ep); if (!clipsOf(ed, 'video')[0].speed) break; await sleep(100); }
    await page.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (30 / 30) * 90 + 0.5);
    await page.getByTestId('freeze-seconds').fill('0.5');
    await page.getByTestId('freeze-apply').click();
    let withHold: any;
    for (let i = 0; i < 100; i++) { withHold = await doc(ep); if (clipsOf(withHold, 'video').length === 3) break; await sleep(100); }
    await page.locator('.clip[data-freeze=true]').first().waitFor({ timeout: 8000 }).catch(() => {}); // the server has the hold; wait until the page shows it
    const holdEl = await page.locator('.clip[data-freeze=true]').count();
    const holdClip = clipsOf(withHold, 'video').find((c: any) => c.freeze);
    const uiFreeze = { clips: clipsOf(withHold, 'video').length, holdStart: holdClip ? T.frameIndexAt(holdClip.start, R) : null, holdFrames: holdClip ? T.frameIndexAt(holdClip.duration, R) : null, marked: holdEl };
    await page.keyboard.press('Control+z');
    for (let i = 0; i < 100; i++) { ed = await doc(ep); if (clipsOf(ed, 'video').length === 1) break; await sleep(100); }
    await page.screenshot({ path: path.join(art, 'editor-speed.png') });
    const ratio34 = clipsOf(await docAt075(), 'video')[0];
    check('preview: five seeks on the 2× clip each paint source frame 2×target; typing 0.75 stores the exact ratio 3/4 (160 frames)', wrong.length === 0 && ratio34?.speed?.num === 3 && ratio34?.speed?.den === 4 && ratio34Frames === 160, { wrong });
    check('Inspector: "Freeze frame" at the playhead (frame 30, 0.5 s) makes three picture clips with a 15-frame hold starting at frame 30, marked on the timeline; Ctrl+Z restores the single clip; no page errors in the editor', uiFreeze.clips === 3 && uiFreeze.holdStart === 30 && uiFreeze.holdFrames === 15 && uiFreeze.marked === 1 && clipsOf(ed, 'video').length === 1 && errors.length === 0, { uiFreeze, errors: errors.slice(0, 3) });
    await page.close();
    // A refusal by the server, shown in the Hebrew interface: translated headline, the server's detail after it in its own direction.
    const first = clipsOf(await doc(ep), 'video')[0];
    await txs(ep, [{ op: 'split_clip', args: { clipId: first.id, at: T.add(first.start, f(30)) } }]);
    const beforeRefusal = JSON.stringify(clipsOf(await doc(ep), 'video'));
    const hp = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await hp.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'clip'); localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
    await hp.goto(`${s.ownerUrl}&project=${ep}`);
    await hp.locator(`.clip[data-clip-id="${first.id}"]`).click();
    await hp.getByTestId('clip-speed').fill('0.5'); // twice as long: it would run into the second half
    await hp.getByTestId('clip-speed').press('Enter');
    await hp.getByTestId('error-headline').waitFor({ timeout: 8000 }).catch(() => {});
    const refusal = {
      headline: await hp.getByTestId('error-headline').textContent().catch(() => null),
      detail: await hp.getByTestId('error-detail').textContent().catch(() => null),
      detailDir: await hp.getByTestId('error-detail').evaluate((el) => getComputedStyle(el).direction).catch(() => null),
      pageDir: await hp.evaluate(() => document.documentElement.dir),
      unchanged: JSON.stringify(clipsOf(await doc(ep), 'video')) === beforeRefusal,
    };
    await hp.screenshot({ path: path.join(art, 'refusal-he.png') });
    check('a refused edit in the Hebrew interface: the error bar opens with a Hebrew headline for the kind of refusal, followed by the detail in Hebrew as well (this refusal is one of the common ones worded in Hebrew); nothing changed', !!refusal.headline && /[\u0590-\u05FF]/.test(refusal.headline) && !!refusal.detail && /[\u0590-\u05FF]/.test(refusal.detail) && !/[a-z]{3}/.test(refusal.detail) && refusal.detailDir === 'rtl' && refusal.pageDir === 'rtl' && refusal.unchanged, refusal);
    await hp.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Clip speed on synthetic fixtures (frame-barcode video, sine tone). Sound is varispeed; pitch-preserving stretch and speed ramps are not implemented. Preview playback audio at speed is not measured here.', passed: checks.length - failed.length, total: checks.length, measurements, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/speed-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nSpeed proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
