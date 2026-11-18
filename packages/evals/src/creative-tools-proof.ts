/**
 * Creative tools proof: speed curves, motion presets, the effects gallery, the sound-effects browser and the pacing panel,
 * exercised through the normal paths (ops over REST, the editor in a real browser, the export).
 *  - a speed curve on exported frames: every frame of the export shows the source frame the parts predict (frame barcode),
 *    the source runs on without repeats or gaps across part boundaries, picture and sound end together;
 *  - the curve picker in the editor: preset tiles, the hand-made curve graph by keyboard, undo;
 *  - a motion preset changes the rendered picture as its keyframes say;
 *  - the gallery, the sound browser (listen and add) and the pacing strip work in the editor with no console errors;
 *  - flash safety in the gallery (ADR-0009): the strobe tile shows its flash; a hovered strobe tile shows at most three rises of
 *    light in any second of real time and the dialog reports what its guard held back; under reduced motion no tile moves.
 * Not covered: how any of it looks or sounds to a person; real footage; the owner's GPU (this run uses the software adapter).
 *   pnpm build && pnpm proof:creative
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { EFFECTS, SPEED_CURVES, MOTION_PRESETS } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/creative-tools');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30 });
const W = 640, H = 360, SR = 48000;
const full = { x: 0, y: 0, w: W, h: H };
const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'];

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'barcode_640x360_30fps_8s.mp4'), frames: 240 });
  const s = await startServer({ port: 8823, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(100); } };
  const clipsOf = (d: any, kind: string) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === kind).flatMap((t: any) => t.clips);
  const until = async (pid: string, pred: (d: any) => boolean, ms = 8000) => { const t = Date.now(); for (;;) { const d = await doc(pid); if (pred(d)) return d; if (Date.now() - t > ms) return null; await sleep(100); } };
  const sourceFrames = fixture.frames;
  const measurements: Record<string, unknown> = {};
  const browser = await chromium.launch({ args: GPU_ARGS });
  try {
    // ---------------------------------------------------------------- speed curve on exported frames
    console.log('\n# a speed curve, checked on every exported frame');
    const pid = (await call('/projects', { name: 'curve', width: W, height: H })).body.project.id;
    const vid = await upload(pid, fixture.file);
    const added = (await txs(pid, [{ op: 'add_clip', args: { assetId: vid.assetId, start: f(0) } }])).results[0].output;
    const clipId = added.clipId as string;
    const hasSound = clipsOf(await doc(pid), 'audio').length > 0;
    const out = (await txs(pid, [{ op: 'apply_speed_curve', args: { clipId, preset: 'hero' } }])).results[0].output as { partClipIds: string[]; durationFrames: number; parts: { frames: number; from: number; to: number }[] };
    const d1 = await doc(pid);
    const parts = clipsOf(d1, 'video');
    check('apply_speed_curve hero: the clip became five parts, the first keeps the id', parts.length === 5 && parts[0].id === clipId && out.partClipIds.length === 5, { frames: out.parts.map((p) => p.frames), total: out.durationFrames });
    const job = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    if (job.status !== 'succeeded') throw new Error(`export failed: ${JSON.stringify(job.error)}`);
    const mp4 = path.join(art, 'curve.mp4');
    fs.writeFileSync(mp4, (await call(`/jobs/${job.id}/output`)).body);
    const raw = ff(['-i', mp4, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const fb = W * H * 3;
    const shown = Array.from({ length: raw.length / fb }, (_, i) => readBarcode(raw.subarray(i * fb, (i + 1) * fb), W, 3, full));
    check('the export has exactly as many frames as the curve says', shown.length === out.durationFrames, { exported: shown.length, expected: out.durationFrames });
    const unread = shown.filter((x) => x === null || x === undefined).length;
    let backwards = 0, biggestStep = 0;
    for (let i = 1; i < shown.length; i++) { const step = (shown[i] as number) - (shown[i - 1] as number); if (step < 0) backwards++; biggestStep = Math.max(biggestStep, step); }
    check('every exported frame is readable and the source never runs backwards; the biggest jump between two frames is what the fastest part plays in a frame', unread === 0 && backwards === 0 && biggestStep <= 3, { unread, backwards, biggestStep });
    // the last part runs at 2.5×: its last frame shows a source frame up to 2.5 before where the part ends, and rounding the part down to whole frames can stop up to another 2.5 short
    check('the curve starts on the first source frame and ends short of the last one by less than the last part plays in two frames (parts are rounded down to whole frames, never past the old end)', shown[0] === 0 && (shown[shown.length - 1] as number) <= sourceFrames - 1 && (shown[shown.length - 1] as number) >= sourceFrames - 1 - 5, { first: shown[0], last: shown[shown.length - 1], sourceFrames });
    // each part: its first frame shows the source frame at its sourceIn; its measured speed is what the part says
    const partReport: unknown[] = [];
    let boundariesOk = true, speedsOk = true, at = 0;
    parts.forEach((p: any, k: number) => {
      const n = T.frameIndexAt(p.duration, R);
      const expectFirst = Math.floor(T.toSeconds(p.sourceIn) * 30 + 1e-6);
      const first = shown[at] as number, last = shown[at + n - 1] as number;
      if (Math.abs(first - expectFirst) > 1) boundariesOk = false;
      const measured = n > 1 ? (last - first) / (n - 1) : NaN;
      const from = p.speed ? p.speed.num / p.speed.den : 1, to = p.speedEnd ? p.speedEnd.num / p.speedEnd.den : from;
      const average = (from + to) / 2;
      // a whole number of source frames over a short part: allow one source frame of error in all
      if (n > 1 && Math.abs(measured - average) > 1.5 / (n - 1) + 0.05) speedsOk = false;
      partReport.push({ part: k + 1, frames: n, from, to, firstShown: first, expectFirst, measuredAverage: Number(measured.toFixed(3)) });
      at += n;
    });
    measurements.heroParts = partReport;
    check('each part starts on the source frame its sourceIn names (within one frame)', boundariesOk, partReport);
    check('each part plays at the average speed it declares (2.5×, eased, 0.4×, eased, 2.5×), measured on the exported frames', speedsOk);
    if (hasSound) {
      const wav = path.join(art, 'curve.wav');
      const wj = await waitJob((await call(`/projects/${pid}/exports`, { format: 'wav' })).body.jobId);
      fs.writeFileSync(wav, (await call(`/jobs/${wj.id}/output`)).body);
      const samples = ff(['-i', wav, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-']).length / 4;
      const soundParts = clipsOf(d1, 'audio');
      check('the linked sound was divided the same way and the exported mix is as long as the picture', soundParts.length === 5 && soundParts.every((c: any, k: number) => T.eq(c.start, parts[k].start) && T.eq(c.duration, parts[k].duration)) && Math.abs(samples / SR - out.durationFrames / 30) < 0.05, { seconds: Number((samples / SR).toFixed(3)), expected: out.durationFrames / 30 });
    } else check('the fixture has no sound: linked-sound check skipped (covered by unit tests)', true);
    const undone = await call(`/projects/${pid}/undo`, {});
    const back = await doc(pid);
    check('undo puts the single clip back', undone.status === 200 && clipsOf(back, 'video').length === 1 && T.eq(clipsOf(back, 'video')[0].duration, f(sourceFrames)), { status: undone.status });

    // all presets through REST on the real document (no export): valid, contiguous
    let allOk = true;
    const lengths: Record<string, number> = {};
    for (const c of SPEED_CURVES) {
      const r = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'apply_speed_curve', args: { clipId, preset: c.id } }] });
      if (r.status !== 200) { allOk = false; lengths[c.id] = -1; continue; }
      lengths[c.id] = r.body.results[0].output.durationFrames;
      const ps = clipsOf(await doc(pid), 'video');
      if (ps.length !== c.segments.length) allOk = false;
      await call(`/projects/${pid}/undo`, {});
    }
    measurements.curveLengthsFrames = lengths;
    check(`all ${SPEED_CURVES.length} presets apply to the same clip through the API and give one part per segment`, allOk, lengths);

    // ---------------------------------------------------------------- motion preset on rendered stills
    console.log('\n# a motion preset on rendered stills');
    const title = (await txs(pid, [{ op: 'add_text', args: { text: 'PULSE', start: f(0), duration: f(60) } }])).results[0].output.clipId as string;
    const png = async (index: number) => (await call(`/projects/${pid}/frame?index=${index}`)).body as Buffer;
    const before = [await png(0), await png(30)];
    const m = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'apply_motion_preset', args: { clipId: title, presetId: 'motion.in.zoom-in' } }] });
    const keyed = (await doc(pid)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === title);
    const after = [await png(0), await png(30)];
    check('motion.in.zoom-in writes keyframes; the first frame of the title changes and a frame after the entrance does not', m.status === 200 && !!keyed.keyframes && !before[0]!.equals(after[0]!) && before[1]!.equals(after[1]!), { properties: Object.keys(keyed.keyframes ?? {}) });
    const m2 = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'apply_motion_preset', args: { clipId: title, presetId: 'motion.out.fade' } }] });
    const both = (await doc(pid)).sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === title);
    const scaleKeys = both.keyframes?.scale?.length ?? 0, opacityKeys = both.keyframes?.opacity ?? [];
    check('an exit added afterwards keeps the entrance: the entrance keys are still there and the last opacity key is 0 at the clip end', m2.status === 200 && scaleKeys >= 2 && opacityKeys.length >= 2 && opacityKeys[opacityKeys.length - 1].value === 0 && T.eq(opacityKeys[opacityKeys.length - 1].time, f(60)), { scaleKeys, opacityKeys: opacityKeys.length });
    let motionsOk = 0;
    for (const p of MOTION_PRESETS) { const r = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'apply_motion_preset', args: { clipId: title, presetId: p.id } }] }); if (r.status === 200) motionsOk++; }
    check(`all ${MOTION_PRESETS.length} motion presets apply through the API on the same clip`, motionsOk === MOTION_PRESETS.length, { applied: motionsOk });
    await txs(pid, [{ op: 'clear_keyframes', args: { clipId: title } }]);

    // ---------------------------------------------------------------- the editor
    console.log('\n# the curve picker in the editor');
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 4200 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
    const audioRequests: number[] = [];
    page.on('response', (r) => { if (/\/sfx\/[^/]+\/audio$/.test(new URL(r.url()).pathname)) audioRequests.push(r.status()); });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('deliver-panel').waitFor();
    await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
    await page.getByTestId('speed-curves').waitFor();
    const tiles = await page.getByTestId('speed-curve').count();
    check(`${SPEED_CURVES.length} curve tiles, each with a drawn line`, tiles === SPEED_CURVES.length && (await page.locator('[data-testid=speed-curve] svg polyline.sc-line').count()) === tiles, { tiles });
    await page.locator('[data-testid=speed-curve][data-id=bullet]').click();
    const five = await until(pid, (x) => clipsOf(x, 'video').length === 5);
    await page.waitForFunction(() => document.querySelectorAll('.clip.selected').length >= 5, undefined, { timeout: 5000 }).catch(() => {});
    const selected = await page.locator('.clip.selected').count();
    // the five parts are selected together, so the inspector shows the shared tab of a multi-selection: the curve's result is
    // said on the stage (stage-note) since the redesign, where the curve panel's own status line is no longer on screen
    await page.waitForFunction(() => /5/.test(document.querySelector('[data-testid=stage-note]')?.textContent ?? ''), undefined, { timeout: 5000 }).catch(() => {});
    const statusText = await page.getByTestId('stage-note').textContent();
    check('clicking the Bullet tile divides the clip into five parts, selects them all, and says so', !!five && selected >= 5 && /5/.test(statusText ?? ''), { selected, statusText });
    await page.keyboard.press('Control+z');
    const one = await until(pid, (x) => clipsOf(x, 'video').length === 1);
    check('Ctrl+Z in the editor puts the single clip back', !!one);
    await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
    await page.getByTestId('speed-curve-custom').locator('summary').click();
    const pts = page.getByTestId('speed-curve-point');
    const applyBtn = page.getByTestId('speed-curve-apply');
    const disabledFlat = await applyBtn.isDisabled();
    await pts.nth(2).focus();
    for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp'); // +1.0 → 2×
    const valueNow = await pts.nth(2).getAttribute('aria-valuenow');
    const lengthNote = await page.getByTestId('speed-curve-length').textContent();
    await applyBtn.click();
    const four = await until(pid, (x) => clipsOf(x, 'video').length === 4);
    const customParts = four ? clipsOf(four, 'video') : [];
    check('the hand-made curve: flat is not offered; raising the middle point by keyboard to 2× and applying gives four parts that speed up to 2× and back', disabledFlat && valueNow === '2' && !!four && customParts[1]?.speedEnd?.num === 2 && customParts[2]?.speed?.num === 2 && !customParts[0]?.speedEnd, { valueNow, lengthNote });
    await page.keyboard.press('Control+z');
    await until(pid, (x) => clipsOf(x, 'video').length === 1);
    await page.screenshot({ path: path.join(art, 'curves.png'), clip: (await page.getByTestId('speed-curves').boundingBox())! });

    console.log('\n# the effects gallery');
    await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
    await page.getByTestId('gallery-open').click();
    await page.getByTestId('effect-gallery').waitFor();
    const gpu = await page.evaluate(() => 'gpu' in navigator);
    const effectTiles = page.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]');
    const nEffects = await effectTiles.count();
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]')]; return t.length > 0 && t.every((x) => x.getAttribute('data-rendered') === '1' || x.getAttribute('data-unavailable') === '1'); }, undefined, { timeout: 60_000 }).catch(() => {});
    const rendered = await page.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-rendered="1"]').count();
    const unavailable = await page.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-unavailable="1"]').count();
    check('the gallery opens on the effects tab with a thumbnail drawn for every effect this browser can run', nEffects === EFFECTS.length && rendered + unavailable === EFFECTS.length && rendered >= 12, { nEffects, rendered, unavailable, webgpu: gpu });
    // the strobe tile is drawn one frame after its first flash, so it shows the light (at frame 12 it had faded): compared with the
    // same snapshot drawn plainly at the tile's size (the gallery's own resize of the preview, which shows the frame it was opened on)
    const strobeTile = await page.evaluate(async () => {
      const tile = document.querySelector<HTMLElement>('[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-id="light.strobe"]');
      const canvas = tile?.querySelector('canvas');
      const preview = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
      if (!tile || !canvas || !preview) return null;
      const w = canvas.width, h = canvas.height;
      const bm = await createImageBitmap(preview, { resizeWidth: w, resizeHeight: h, resizeQuality: 'medium' });
      const plain = new OffscreenCanvas(w, h);
      plain.getContext('2d')!.drawImage(bm, 0, 0);
      const a = canvas.getContext('2d')!.getImageData(0, 0, w, h).data, b = plain.getContext('2d')!.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) sum += (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!)) / 3;
      return { rendered: tile.dataset.rendered === '1', unavailable: tile.dataset.unavailable === '1', meanDifference: Number((sum / (w * h)).toFixed(2)) };
    });
    check('the strobe tile shows its flash: its mean difference from the plain picture at the tile\'s size is more than 20 levels', !!strobeTile && strobeTile.rendered && strobeTile.meanDifference > 20, strobeTile);
    // reduced motion (this page asks for it): hovering tiles that move by themselves animates nothing
    const tileHashes = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]')].map((t) => {
      const c = t.querySelector('canvas')!, d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let hsh = 0;
      for (let i = 0; i < d.length; i += 4) hsh = (hsh * 31 + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7) >>> 0;
      return `${t.dataset.id}:${hsh}`;
    }));
    const still0 = await tileHashes();
    for (const id of ['overlay.snow', 'time.echo', 'light.strobe']) await page.locator(`[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-id="${id}"]`).hover();
    await sleep(1000);
    const still1 = await tileHashes();
    const moved = still1.filter((x, i) => x !== still0[i]);
    check('under reduced motion, hovering the snow, echo and strobe tiles animates nothing: no tile\'s picture changes over a second', still0.length === EFFECTS.length && moved.length === 0, { tiles: still0.length, changed: moved.slice(0, 5) });
    // without reduced motion: a hovered strobe tile animates through the dialog's flash guard (ADR-0009 decision 2)
    {
      const mp = await (await browser.newContext({ viewport: { width: 1500, height: 4200 } })).newPage();
      const mErrors: string[] = [];
      mp.on('pageerror', (e) => mErrors.push(String(e)));
      await mp.goto(`${s.ownerUrl}&project=${pid}`);
      await mp.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await mp.getByTestId('insp-tab-effects').click(); // this page has the tabbed inspector: the gallery button is on the clip's effects tab
      await mp.getByTestId('gallery-open').click();
      await mp.getByTestId('effect-gallery').waitFor();
      await mp.waitForFunction(() => { const t = [...document.querySelectorAll('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]')]; return t.length > 0 && t.every((x) => x.getAttribute('data-rendered') === '1' || x.getAttribute('data-unavailable') === '1'); }, undefined, { timeout: 60_000 }).catch(() => {});
      const tile = mp.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-id="light.strobe"]');
      await tile.scrollIntoViewIfNeeded();
      // (a string, not a function: the TypeScript runner would wrap named functions in a helper the page does not have)
      await mp.evaluate(`(() => {
        const c = document.querySelector('[data-testid=gallery-panel-effects] [data-testid=gallery-tile][data-id="light.strobe"] canvas');
        const small = document.createElement('canvas'); small.width = 16; small.height = 16;
        const sx = small.getContext('2d', { willReadFrequently: true });
        const out = []; window.__pfTileSamples = out;
        const loop = () => { sx.drawImage(c, 0, 0, 16, 16); const d = sx.getImageData(0, 0, 16, 16).data; let m = 0; for (let i = 0; i < d.length; i += 4) m += (d[i] + d[i + 1] + d[i + 2]) / 3; out.push([performance.now() / 1000, m / 256]); if (out.length < 20000) requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      })()`);
      await tile.hover();
      // sample until there are enough frames to see flashes (a software graphics adapter draws the tile slowly), at most 20 s
      for (let waited = 0; waited < 20_000; waited += 500) {
        await sleep(500);
        const n = await mp.evaluate(() => (window as unknown as { __pfTileSamples: unknown[] }).__pfTileSamples.length);
        if (waited >= 2000 && n >= 60) break;
      }
      const samples = await mp.evaluate(() => (window as unknown as { __pfTileSamples: [number, number][] }).__pfTileSamples.splice(0));
      const held = await mp.getByTestId('effect-gallery').getAttribute('data-flashes-held');
      const rises: number[] = [];
      { let rising = false, low = Infinity, high = 0; for (const [t, v] of samples) { if (!rising && v > low + 8) { rises.push(t); rising = true; high = v; } else if (rising && v < high - 8) { rising = false; low = v; } if (rising) high = Math.max(high, v); else low = Math.min(low, v); } }
      let most = 0;
      for (let i = 0, j = 0; i < rises.length; i++) { while (rises[i]! - rises[j]! > 1) j++; most = Math.max(most, i - j + 1); }
      const span = samples.length ? samples[samples.length - 1]![0] - samples[0]![0] : 0;
      measurements.galleryStrobeHover = { samples: samples.length, seconds: Number(span.toFixed(2)), rises: rises.length, mostInOneSecond: most, flashesHeld: held, changes: samples.filter((x, i) => i > 0 && Math.abs(x[1] - samples[i - 1]![1]) > 0.5).length, levels: [Math.round(Math.min(...samples.map((x) => x[1]))), Math.round(Math.max(...samples.map((x) => x[1])))], riseTimes: rises.map((t) => Number((t - (samples[0]?.[0] ?? 0)).toFixed(3))), sampleGapsMs: { median: samples.length > 2 ? Math.round(samples.slice(1).map((x, i) => (x[0] - samples[i]![0]) * 1000).sort((p, q) => p - q)[Math.floor((samples.length - 1) / 2)]!) : null, max: samples.length > 2 ? Math.round(Math.max(...samples.slice(1).map((x, i) => (x[0] - samples[i]![0]) * 1000))) : null } };
      check('a hovered strobe tile animates (its light rises again) but shows at most three rises in any second of real time (sampled on every animation frame for at least 2 s and until 60 samples, at most 20 s), and the dialog carries data-flashes-held from its flash guard', samples.length > 30 && span >= 2 && rises.length >= 2 && most <= 3 && held !== null && Number.isFinite(Number(held)) && mErrors.length === 0, { ...(measurements.galleryStrobeHover as object), errors: mErrors.slice(0, 3) });
      await mp.close();
    }
    await page.getByTestId('gallery-search').fill('vhs');
    const found = await page.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]:not([hidden])').count();
    await page.getByTestId('gallery-search').fill('');
    await page.getByTestId('gallery-tab-looks').click();
    const lookTile = page.locator('[data-testid=gallery-panel-looks] [data-testid=gallery-tile]:not([disabled])').first();
    const lookClickable = (await lookTile.count()) > 0;
    if (lookClickable) await lookTile.click();
    const graded = lookClickable ? await until(pid, (x) => clipsOf(x, 'video')[0].effects?.some((e: any) => e.type === 'color.grade')) : null;
    check('search narrows the tiles; picking a colour look in the gallery adds the grade to the clip', found >= 1 && found < EFFECTS.length && (!lookClickable || !!graded), { found, lookClickable });
    await page.screenshot({ path: path.join(art, 'gallery.png') });
    await page.keyboard.press('Escape');
    const closed = (await page.getByTestId('effect-gallery').count()) === 0;
    // focus is handed back on the next tick after the dialog is gone: wait for it (bounded) rather than read in the same instant
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'gallery-open', undefined, { timeout: 2000 }).catch(() => {});
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check('Escape closes the gallery and focus returns to the button that opened it', closed && focusBack === 'gallery-open', { focusBack });
    if (graded) { await page.keyboard.press('Control+z'); await until(pid, (x) => !clipsOf(x, 'video')[0].effects?.length); }

    console.log('\n# the sound-effects browser');
    // the sound effects are the rail's Audio category (UX_REDESIGN §4.3); the all-tools inspector's mixer has a second copy, so
    // the browser is read in the drawer (data-testid=library)
    await page.getByTestId('rail-audio').click();
    const sfxLib = page.getByTestId('library');
    await sfxLib.getByTestId('sfx-browser').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=library] [data-testid=sfx-row]').length > 0, undefined, { timeout: 8000 });
    const rows = await sfxLib.getByTestId('sfx-row').count();
    await sfxLib.getByTestId('sfx-cat-drum').click();
    const drums = await sfxLib.getByTestId('sfx-row').count();
    await sfxLib.getByTestId('sfx-cat-all').click();
    await sfxLib.getByTestId('sfx-search').fill('wind');
    const winds = await sfxLib.getByTestId('sfx-row').count();
    check('80 sounds listed; the drum chip and a search by English name narrow the list', rows === 80 && drums > 0 && drums < 20 && winds >= 1 && winds < 5, { rows, drums, winds });
    const wind = sfxLib.locator('[data-testid=sfx-row][data-id="sfx.wind"]');
    await wind.getByTestId('sfx-play').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=library] [data-testid=sfx-row][data-id="sfx.wind"] [data-testid=sfx-play]')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 80 && !audioRequests.length; i++) await sleep(100);
    await sleep(300);
    const pressedWhilePlaying = await wind.getByTestId('sfx-play').getAttribute('aria-pressed');
    await wind.getByTestId('sfx-play').click();
    await sleep(200);
    const pressedAfterStop = await wind.getByTestId('sfx-play').getAttribute('aria-pressed');
    check('listen fetches the sound (HTTP 200), shows the playing state on a four-second sound, and a second press stops it', audioRequests.includes(200) && pressedWhilePlaying === 'true' && pressedAfterStop === 'false', { audioRequests, pressedWhilePlaying, pressedAfterStop });
    // a second press while the sound is still loading must cancel it, not start it again
    const rain = sfxLib.locator('[data-testid=sfx-row][data-id="sfx.rain"]');
    await sfxLib.getByTestId('sfx-search').fill('');
    await rain.getByTestId('sfx-play').click();
    await rain.getByTestId('sfx-play').click();
    await sleep(1500);
    check('pressing listen twice quickly (before the sound has loaded) leaves nothing playing', (await rain.getByTestId('sfx-play').getAttribute('aria-pressed')) === 'false');
    await sfxLib.getByTestId('sfx-search').fill('wind');
    const soundBefore = clipsOf(await doc(pid), 'audio').length;
    await wind.getByTestId('sfx-add').click();
    const addedSound = await until(pid, (x) => clipsOf(x, 'audio').length === soundBefore + 1);
    await page.waitForFunction(() => /wind|רוח/i.test(document.querySelector('[data-testid=library] [data-testid=sfx-status]')?.textContent ?? ''), undefined, { timeout: 5000 }).catch(() => {});
    const sfxStatus = await sfxLib.getByTestId('sfx-status').textContent();
    const windAsset = addedSound ? Object.values(addedSound.assets as Record<string, any>).find((a: any) => a.provenance?.procedural?.id === 'sfx.wind') : null;
    check('add places the sound on the timeline as an ordinary audio clip whose asset records how it was made', !!addedSound && !!windAsset && (sfxStatus ?? '').length > 0, { sfxStatus, generator: (windAsset as any)?.provenance?.procedural });
    await sfxLib.getByTestId('sfx-search').fill('');
    await page.getByTestId('rail-media').click();

    console.log('\n# the pacing panel');
    const strip = page.getByTestId('pacing-strip');
    await strip.waitFor();
    const d2 = await doc(pid);
    const totalSeconds = Math.max(...d2.sequences.seq_main.tracks.flatMap((t: any) => t.clips).map((c: any) => T.toSeconds(T.add(c.start, c.duration))));
    const cells = await strip.locator('.pacing-cell').count();
    check('the pacing strip has one cell per five seconds of timeline, and totals are shown', cells === Math.ceil(totalSeconds / 5 - 1e-9) && ((await page.getByTestId('pacing-totals').textContent()) ?? '').length > 0, { cells, totalSeconds });
    const frameBefore = await page.getByTestId('preview').getAttribute('data-frame');
    await strip.locator('.pacing-cell').nth(cells - 1).click();
    await page.waitForFunction((b) => document.querySelector('[data-testid=preview]')?.getAttribute('data-frame') !== b, frameBefore, { timeout: 5000 }).catch(() => {});
    const frameAfter = await page.getByTestId('preview').getAttribute('data-frame');
    check('clicking a cell moves the playhead to the start of that stretch', cells < 2 ? true : frameAfter === String((cells - 1) * 150), { frameBefore, frameAfter });
    const staticIssue = await page.locator('[data-testid=pacing-issues] li[data-code=static_picture]').count();
    check('an eight-second shot with no cut is reported as a long static picture', staticIssue >= 1, { staticIssue });

    console.log('\n# motion tab of the gallery; caption looks');
    await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
    await page.getByTestId('gallery-open').click();
    await page.getByTestId('gallery-tab-motion').click();
    const motionTiles = page.locator('[data-testid=gallery-panel-motion] [data-testid=gallery-tile]');
    await page.waitForFunction(() => { const t = [...document.querySelectorAll('[data-testid=gallery-panel-motion] [data-testid=gallery-tile]')]; return t.length > 0 && t.every((x) => x.getAttribute('data-rendered') === '1'); }, undefined, { timeout: 60_000 }).catch(() => {});
    const nMotion = await motionTiles.count(), motionRendered = await page.locator('[data-testid=gallery-panel-motion] [data-testid=gallery-tile][data-rendered="1"]').count();
    await page.locator('[data-testid=gallery-panel-motion] [data-testid=gallery-tile][data-id="motion.move.ken-burns-in"]').click();
    const kb = await until(pid, (x) => !!clipsOf(x, 'video')[0].keyframes?.scale);
    check(`the motion tab shows all ${MOTION_PRESETS.length} motions with a drawn thumbnail; picking the slow zoom writes scale keyframes on the clip`, nMotion === MOTION_PRESETS.length && motionRendered === nMotion && !!kb, { nMotion, motionRendered });
    await page.screenshot({ path: path.join(art, 'gallery-motion.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    await page.getByTestId('caption-add').click();
    const withTrack = await until(pid, (x) => x.sequences.seq_main.tracks.some((t: any) => t.kind === 'caption'));
    await page.getByTestId('caption-look').waitFor();
    // the looks are a radiogroup of drawn tiles since the redesign (UX_REDESIGN §8): one [role=radio][data-value] per look
    const lookOptions = await page.locator('[data-testid=caption-look] [role=radio]').count();
    await page.locator('[data-testid=caption-look] [role=radio]').nth(3).click();
    const chosen = await page.locator('[data-testid=caption-look] [role=radio]').nth(3).getAttribute('data-value');
    const styled = await until(pid, (x) => { const t = x.sequences.seq_main.tracks.find((y: any) => y.kind === 'caption'); return !!t && JSON.stringify(t.caption.style) !== JSON.stringify(withTrack?.sequences.seq_main.tracks.find((y: any) => y.kind === 'caption').caption.style); });
    await sleep(300);
    const shownLook = await page.locator('[data-testid=caption-look] [role=radio][aria-checked=true]').getAttribute('data-value');
    check('the caption controls list the ready-made looks; choosing one restyles the caption track and the list then shows that look as the current one', lookOptions > 30 && !!styled && shownLook === chosen, { lookOptions, chosen, shownLook });

    console.log('\n# layouts for several pictures');
    {
      const lp = (await call('/projects', { name: 'layouts', width: 1280, height: 720 })).body.project.id as string;
      const mk = (name: string, color: string) => { const file = path.join(art, `${name}.png`); ff(['-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x480`, '-frames:v', '1', file]); return file; };
      const A = await upload(lp, mk('red', 'red')), B = await upload(lp, mk('blue', 'blue'));
      const v1 = (await doc(lp)).sequences.seq_main.tracks.find((t: any) => t.kind === 'video').id;
      const v2 = (await txs(lp, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId;
      const ca = (await txs(lp, [{ op: 'add_clip', args: { assetId: A.assetId, trackId: v1, start: f(0), duration: f(60) } }])).results[0].output.clipId;
      const cb = (await txs(lp, [{ op: 'add_clip', args: { assetId: B.assetId, trackId: v2, start: f(0), duration: f(60) } }])).results[0].output.clipId;
      const wrong = await call(`/projects/${lp}/transactions`, { ops: [{ op: 'apply_layout', args: { layoutId: 'layout.grid-2x2', clipIds: [ca, cb] } }] });
      await page.goto(`${s.ownerUrl}&project=${lp}`);
      await page.locator(`.clip[data-clip-id="${ca}"]`).click();
      await page.locator(`.clip[data-clip-id="${cb}"]`).click({ modifiers: ['Shift'] });
      await page.getByTestId('layout-picker').waitFor();
      const tilesShown = await page.getByTestId('layout-tile').count();
      await page.locator('[data-testid=layout-tile][data-id="layout.side-by-side"]').click();
      const arranged = await until(lp, (x) => clipsOf(x, 'video').every((c: any) => !!c.mask));
      const still = async (name: string) => {
        const pngFile = path.join(art, name);
        fs.writeFileSync(pngFile, (await call(`/projects/${lp}/frame?index=10`)).body as Buffer);
        const rgb = ff(['-i', pngFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        return (x: number, y: number) => [rgb[(y * 1280 + x) * 3]!, rgb[(y * 1280 + x) * 3 + 1]!, rgb[(y * 1280 + x) * 3 + 2]!];
      };
      const at = await still('layout.png');
      // The upper (blue) picture is scaled to cover its cell: 640x480 fitted to the frame is 960x720, centred on the right
      // cell, so without its mask it reaches 160 px into the left half (x 480…640). x = 560 and 620 are inside that overlap.
      const left = at(320, 360), right = at(960, 360), topLeft = at(20, 20), bottomRight = at(1260, 700), nearSeamLeft = at(560, 360), seamLeft = at(620, 360);
      const isRed = (c: number[]) => c[0]! > 200 && c[2]! < 60, isBlue = (c: number[]) => c[2]! > 200 && c[0]! < 60;
      // the same still with the masks taken away: the check must then fail (blue over the left half), or it proves nothing about masks
      await txs(lp, clipsOf(await doc(lp), 'video').map((c: any) => ({ op: 'set_clip_mask', args: { clipId: c.id, mask: null } })));
      const bare = await still('layout-no-masks.png');
      const unmaskedOverflows = isBlue(bare(560, 360)) && isBlue(bare(620, 360));
      await call(`/projects/${lp}/undo`, {});
      const restored = isRed((await still('layout.png'))(560, 360));
      check('a layout for the wrong number of pictures is refused with the layouts that do fit; with two picture clips selected the editor offers the two-picture layouts, and "side by side" fills the left half with the lower track\'s picture and the right half with the upper one, each cropped to its cell by its mask, on a rendered still (without the masks the upper picture covers part of the left half, so this check depends on them)', wrong.status !== 200 && tilesShown >= 4 && !!arranged && isRed(left) && isBlue(right) && isRed(topLeft) && isBlue(bottomRight) && isRed(nearSeamLeft) && isRed(seamLeft) && unmaskedOverflows && restored, { refusedStatus: wrong.status, tilesShown, left, right, topLeft, bottomRight, nearSeamLeft, seamLeft, withoutMasks: [bare(560, 360), bare(620, 360)], restored });
      await page.screenshot({ path: path.join(art, 'layout-editor.png') });
    }

    console.log('\n# text animation by letter and word; timeline zoom control');
    {
      const tp = (await call('/projects', { name: 'titles', width: 640, height: 360 })).body.project.id as string;
      const ink = async (index: number) => {
        const file = path.join(art, 'title.png');
        fs.writeFileSync(file, (await call(`/projects/${tp}/frame?index=${index}`)).body as Buffer);
        const rgb = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
        let count = 0, minX = 640, maxX = -1;
        for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) if (rgb[(y * 640 + x) * 3]! > 128) { count++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
        return { count, minX, maxX, bytes: rgb };
      };
      const plainStyle = { stroke: null, background: null, color: '#FFFFFF', align: 'center' };
      const en = (await txs(tp, [{ op: 'add_text', args: { text: 'ONE TWO THREE', start: f(0), duration: f(90) } }])).results[0].output.clipId as string;
      await txs(tp, [{ op: 'update_text', args: { clipId: en, style: plainStyle } }]);
      const rest = await ink(45);
      await txs(tp, [{ op: 'set_text_animation', args: { clipId: en, animation: { by: 'letter', in: 'typewriter', inFrames: 22 } } }]);
      const steps: ({ k: number } & Awaited<ReturnType<typeof ink>>)[] = [];
      for (const k of [0, 4, 8, 12, 16, 20, 22, 45]) steps.push({ k, ...(await ink(k)) });
      const growing = steps.every((x, i) => i === 0 || x.count >= steps[i - 1]!.count) && steps[0]!.count > 0 && steps[0]!.count < rest.count / 5;
      const leftFirst = steps[0]!.maxX < (rest.minX + rest.maxX) / 2;
      const restSame = steps[steps.length - 1]!.bytes.equals(rest.bytes) && steps[steps.length - 2]!.bytes.equals(rest.bytes);
      check('typewriter by letter on an English title: one letter at the first frame, on the left; more ink at every later sample; from the end of the entrance on, the frame is byte-identical to the same title without animation', growing && leftFirst && restSame, { ink: steps.map((x) => `${x.k}:${x.count}`), restInk: rest.count, firstLetterSpan: [steps[0]!.minX, steps[0]!.maxX], titleSpan: [rest.minX, rest.maxX] });
      await txs(tp, [{ op: 'set_text_animation', args: { clipId: en, animation: { in: null, out: 'fade', outFrames: 20, by: 'word' } } }]);
      const outMid = await ink(80), outEnd = await ink(89), before = await ink(60);
      // word by word, not the whole title at once: during the exit there is a frame on which the first word and the last
      // word have different shares of their ink left (a whole-title fade keeps them equal on every frame)
      const third = Math.floor((rest.maxX - rest.minX) / 3);
      const inkIn = (bytes: Buffer, x0: number, x1: number) => { let c = 0; for (let y = 0; y < 360; y++) for (let x = x0; x < x1; x++) if (bytes[(y * 640 + x) * 3]! > 128) c++; return c; };
      const firstRest = inkIn(rest.bytes, rest.minX, rest.minX + third), lastRest = inkIn(rest.bytes, rest.maxX - third, rest.maxX + 1);
      const shares: { k: number; first: number; last: number }[] = [];
      for (const k of [72, 75, 78, 81, 84, 87]) { const b = (await ink(k)).bytes; shares.push({ k, first: Number((inkIn(b, rest.minX, rest.minX + third) / firstRest).toFixed(2)), last: Number((inkIn(b, rest.maxX - third, rest.maxX + 1) / lastRest).toFixed(2)) }); }
      const staggered = shares.some((x) => Math.abs(x.first - x.last) > 0.3);
      check('fade out by word: unchanged before the exit begins, less ink during it, almost none on the last frame, and the words leave one after another (the first and last word differ in what is left of them during the exit)', before.bytes.equals(rest.bytes) && outMid.count < rest.count && outEnd.count < rest.count / 10 && staggered, { rest: rest.count, during: outMid.count, last: outEnd.count, shares });
      await txs(tp, [{ op: 'set_text_animation', args: { clipId: en, animation: { out: null, loop: 'wave', by: 'letter' } } }]);
      const w1 = await ink(30), w1again = await ink(30), w2 = await ink(37);
      check('a wave loop moves the letters: the same frame is identical when rendered again, differs from another frame and from the title at rest, and keeps about the same amount of ink', w1.bytes.equals(w1again.bytes) && !w1.bytes.equals(w2.bytes) && !w1.bytes.equals(rest.bytes) && Math.abs(w1.count - rest.count) < rest.count * 0.1, { rest: rest.count, wave: w1.count });
      await txs(tp, [{ op: 'delete_clip', args: { clipId: en } }]);
      const he = (await txs(tp, [{ op: 'add_text', args: { text: 'אחת שתיים שלוש', start: f(0), duration: f(90) } }])).results[0].output.clipId as string;
      await txs(tp, [{ op: 'update_text', args: { clipId: he, style: plainStyle } }]);
      const heRest = await ink(45);
      await txs(tp, [{ op: 'set_text_animation', args: { clipId: he, animation: { by: 'letter', in: 'typewriter', inFrames: 24 } } }]);
      const he0 = await ink(0), he12 = await ink(12), heEnd = await ink(30);
      check('the same on a Hebrew title starts from the right: the first letter appears at the right end, half-way the ink is still on the right side, and at rest it is byte-identical to the plain title', he0.count > 0 && he0.minX > (heRest.minX + heRest.maxX) / 2 && he12.minX > heRest.minX + 20 && he12.maxX >= heRest.maxX - 2 && heEnd.bytes.equals(heRest.bytes), { firstLetterSpan: [he0.minX, he0.maxX], halfWaySpan: [he12.minX, he12.maxX], titleSpan: [heRest.minX, heRest.maxX] });
      const tooLong = await call(`/projects/${tp}/transactions`, { ops: [{ op: 'set_text_animation', args: { clipId: he, animation: { in: 'fade', inFrames: 60, out: 'fade', outFrames: 60 } } }] });
      check('an entrance and exit that together are longer than the title are refused', tooLong.status !== 200, { status: tooLong.status });
      await page.goto(`${s.ownerUrl}&project=${tp}`);
      await page.locator(`.clip[data-clip-id="${he}"]`).click();
      await page.getByTestId('text-animation').waitFor();
      await page.getByTestId('text-anim-loop').selectOption('pulse');
      const viaUi = await until(tp, (x) => x.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === he)?.animation?.loop === 'pulse');
      const widthOf = async () => (await page.locator(`.clip[data-clip-id="${he}"]`).boundingBox())!.width;
      const w0 = await widthOf();
      await page.getByTestId('tl-zoom-in').click();
      await sleep(200);
      const wIn = await widthOf();
      await page.getByTestId('tl-zoom-out').click();
      await page.getByTestId('tl-zoom-out').click();
      await sleep(200);
      const wOut = await widthOf();
      // zoom far in first, so that "fit" has to shrink the view, then fit: the whole timeline (the title is all of it) is in view and fills most of it
      for (let i = 0; i < 6; i++) await page.getByTestId('tl-zoom-in').click();
      await sleep(200);
      const wFar = await widthOf();
      await page.getByTestId('tl-zoom-fit').click();
      await sleep(200);
      const fit = await page.evaluate((id) => {
        const c = document.querySelector(`.clip[data-clip-id="${id}"]`)!.getBoundingClientRect(), el = document.querySelector('.tl-scroll')! as HTMLElement, sc = el.getBoundingClientRect();
        return { right: c.right, scrollRight: sc.right, left: c.left, scrollLeft: sc.left, width: c.width, viewWidth: el.clientWidth, scrolledBy: el.scrollLeft, canScroll: el.scrollWidth > el.clientWidth + 1 };
      }, he);
      check('the title panel sets a text animation through the same operation; the timeline zoom buttons change the clip\'s width on screen both ways; after zooming far in, "fit" brings the whole timeline into view and lets it fill at least half of the view', !!viaUi && wIn > w0 * 1.2 && wOut < wIn / 1.2 && wFar > wOut * 2 && fit.right <= fit.scrollRight + 1 && fit.left >= fit.scrollLeft - 1 && fit.width >= fit.viewWidth / 2 && fit.width < wFar, { widthBefore: Math.round(w0), widthAfterZoomIn: Math.round(wIn), widthAfterZoomOut: Math.round(wOut), widthFarIn: Math.round(wFar), fit });
    }

    console.log('\n# graphic elements');
    {
      const ep = (await call('/projects', { name: 'elements', width: 640, height: 360 })).body.project.id as string;
      const status = (await call('/elements')).body;
      const cat = (await call('/catalog')).body;
      const viaApi = await call(`/projects/${ep}/elements`, { elementId: 'element.symbol.check', color: '#FF0000', start: f(0) });
      const d0 = await doc(ep);
      const elClip = clipsOf(d0, 'video')[0];
      const elAsset = d0.assets[viaApi.body.assetId];
      const file = path.join(art, 'element.png');
      fs.writeFileSync(file, (await call(`/projects/${ep}/frame?index=10`)).body as Buffer);
      const rgb = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      let red = 0, other = 0;
      for (let i = 0; i < rgb.length; i += 3) { if (rgb[i]! > 200 && rgb[i + 1]! < 60 && rgb[i + 2]! < 60) red++; else if (rgb[i]! + rgb[i + 1]! + rgb[i + 2]! > 90) other++; }
      const unknown = await call(`/projects/${ep}/elements`, { elementId: 'element.symbol.nope' });
      const badColour = await call(`/projects/${ep}/elements`, { elementId: 'element.symbol.check', color: 'red' });
      check('graphic elements through the API: the catalogue lists them, one is made as a PNG picture asset that records how it was made, placed as a three-second picture clip, and drawn in the asked colour over a transparent background on a rendered still; an unknown element and a colour that is not #RRGGBB are refused', status.available === true && cat.elements.length === status.count && status.count >= 120 && viaApi.status === 201 && elAsset?.kind === 'image' && elAsset?.image?.hasAlpha === true && elAsset?.provenance?.procedural?.id === 'element.symbol.check' && !!elClip && T.frameIndexAt(elClip.duration, R) === 90 && red > 500 && other < red / 20 && unknown.status === 404 && badColour.status === 400, { count: status.count, asset: elAsset?.image, redPixels: red, otherBrightPixels: other, unknown: unknown.status, badColour: badColour.status });
      await page.goto(`${s.ownerUrl}&project=${ep}`);
      await page.getByTestId('rail-elements').click(); // the rail's Elements category
      await page.getByTestId('elements-browser').waitFor();
      const tilesAll = await page.getByTestId('element-tile').count();
      await page.getByTestId('elements-cat-bubble').click();
      const bubbles = await page.getByTestId('element-tile').count();
      const drawn = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('[data-testid=element-tile] img')].slice(0, 8).every((im) => im.complete && im.naturalWidth > 0));
      const clipsBefore = clipsOf(await doc(ep), 'video').length;
      await page.getByTestId('element-tile').first().click();
      const addedEl = await until(ep, (x) => clipsOf(x, 'video').length === clipsBefore + 1);
      await page.waitForFunction(() => (document.querySelector('[data-testid=elements-status]')?.textContent ?? '').length > 3, undefined, { timeout: 5000 }).catch(() => {});
      check('the elements browser in the library shows every element as a drawn thumbnail, filters by category, and a click adds the element at the playhead as a picture clip', tilesAll === status.count && bubbles > 10 && bubbles < 60 && drawn && !!addedEl, { tilesAll, bubbles, statusText: await page.getByTestId('elements-status').textContent() });
      await page.screenshot({ path: path.join(art, 'elements.png') });
    }

    check('no console or page errors during the editor session', errors.length === 0, errors.slice(0, 5));
  } finally {
    await browser.close();
    await s.close();
  }
  const failed = checks.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    profile: { os: `${os.type()} ${os.release()}`, cpu: os.cpus()[0]?.model, note: 'CPU-only container; Chromium with the software WebGPU adapter. Functional checks only; nothing here judges how a curve, motion, thumbnail or sound looks or sounds.' },
    checks, measurements, passed: checks.length - failed.length, failed: failed.length,
  };
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/creative-tools-proof.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`\n${report.passed}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
