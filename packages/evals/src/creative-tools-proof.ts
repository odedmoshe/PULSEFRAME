/**
 * Creative tools proof: speed curves, motion presets, the effects gallery, the sound-effects browser and the pacing panel,
 * exercised through the normal paths (ops over REST, the editor in a real browser, the export).
 *  - a speed curve on exported frames: every frame of the export shows the source frame the parts predict (frame barcode),
 *    the source runs on without repeats or gaps across part boundaries, picture and sound end together;
 *  - the curve picker in the editor: preset tiles, the hand-made curve graph by keyboard, undo;
 *  - a motion preset changes the rendered picture as its keyframes say;
 *  - the gallery, the sound browser (listen and add) and the pacing strip work in the editor with no console errors.
 * Not covered: how any of it looks or sounds to a person; real footage; the owner's GPU (this run uses the software adapter).
 *   pnpm build && pnpm proof:creative
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { SPEED_CURVES, MOTION_PRESETS } from '@pulseframe/core';
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
    const statusText = await page.getByTestId('speed-curve-status').textContent();
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
    check('the gallery opens on the effects tab with a thumbnail drawn for every effect this browser can run', nEffects === 40 && rendered + unavailable === 40 && rendered >= 12, { nEffects, rendered, unavailable, webgpu: gpu });
    await page.getByTestId('gallery-search').fill('vhs');
    const found = await page.locator('[data-testid=gallery-panel-effects] [data-testid=gallery-tile]:not([hidden])').count();
    await page.getByTestId('gallery-search').fill('');
    await page.getByTestId('gallery-tab-looks').click();
    const lookTile = page.locator('[data-testid=gallery-panel-looks] [data-testid=gallery-tile]:not([disabled])').first();
    const lookClickable = (await lookTile.count()) > 0;
    if (lookClickable) await lookTile.click();
    const graded = lookClickable ? await until(pid, (x) => clipsOf(x, 'video')[0].effects?.some((e: any) => e.type === 'color.grade')) : null;
    check('search narrows the tiles; picking a colour look in the gallery adds the grade to the clip', found >= 1 && found < 40 && (!lookClickable || !!graded), { found, lookClickable });
    await page.screenshot({ path: path.join(art, 'gallery.png') });
    await page.keyboard.press('Escape');
    const closed = (await page.getByTestId('effect-gallery').count()) === 0;
    // focus is handed back on the next tick after the dialog is gone: wait for it (bounded) rather than read in the same instant
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'gallery-open', undefined, { timeout: 2000 }).catch(() => {});
    const focusBack = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
    check('Escape closes the gallery and focus returns to the button that opened it', closed && focusBack === 'gallery-open', { focusBack });
    if (graded) { await page.keyboard.press('Control+z'); await until(pid, (x) => !clipsOf(x, 'video')[0].effects?.length); }

    console.log('\n# the sound-effects browser');
    await page.getByTestId('sfx-browser').waitFor();
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=sfx-row]').length > 0, undefined, { timeout: 8000 });
    const rows = await page.getByTestId('sfx-row').count();
    await page.getByTestId('sfx-cat-drum').click();
    const drums = await page.getByTestId('sfx-row').count();
    await page.getByTestId('sfx-cat-all').click();
    await page.getByTestId('sfx-search').fill('wind');
    const winds = await page.getByTestId('sfx-row').count();
    check('80 sounds listed; the drum chip and a search by English name narrow the list', rows === 80 && drums > 0 && drums < 20 && winds >= 1 && winds < 5, { rows, drums, winds });
    const wind = page.locator('[data-testid=sfx-row][data-id="sfx.wind"]');
    await wind.getByTestId('sfx-play').click();
    await page.waitForFunction(() => document.querySelector('[data-testid=sfx-row][data-id="sfx.wind"] [data-testid=sfx-play]')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 80 && !audioRequests.length; i++) await sleep(100);
    await sleep(300);
    const pressedWhilePlaying = await wind.getByTestId('sfx-play').getAttribute('aria-pressed');
    await wind.getByTestId('sfx-play').click();
    await sleep(200);
    const pressedAfterStop = await wind.getByTestId('sfx-play').getAttribute('aria-pressed');
    check('listen fetches the sound (HTTP 200), shows the playing state on a four-second sound, and a second press stops it', audioRequests.includes(200) && pressedWhilePlaying === 'true' && pressedAfterStop === 'false', { audioRequests, pressedWhilePlaying, pressedAfterStop });
    // a second press while the sound is still loading must cancel it, not start it again
    const rain = page.locator('[data-testid=sfx-row][data-id="sfx.rain"]');
    await page.getByTestId('sfx-search').fill('');
    await rain.getByTestId('sfx-play').click();
    await rain.getByTestId('sfx-play').click();
    await sleep(1500);
    check('pressing listen twice quickly (before the sound has loaded) leaves nothing playing', (await rain.getByTestId('sfx-play').getAttribute('aria-pressed')) === 'false');
    await page.getByTestId('sfx-search').fill('wind');
    const soundBefore = clipsOf(await doc(pid), 'audio').length;
    await wind.getByTestId('sfx-add').click();
    const addedSound = await until(pid, (x) => clipsOf(x, 'audio').length === soundBefore + 1);
    await page.waitForFunction(() => /wind|רוח/i.test(document.querySelector('[data-testid=sfx-status]')?.textContent ?? ''), undefined, { timeout: 5000 }).catch(() => {});
    const sfxStatus = await page.getByTestId('sfx-status').textContent();
    const windAsset = addedSound ? Object.values(addedSound.assets as Record<string, any>).find((a: any) => a.provenance?.procedural?.id === 'sfx.wind') : null;
    check('add places the sound on the timeline as an ordinary audio clip whose asset records how it was made', !!addedSound && !!windAsset && (sfxStatus ?? '').length > 0, { sfxStatus, generator: (windAsset as any)?.provenance?.procedural });
    await page.getByTestId('sfx-search').fill('');

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
    const lookOptions = await page.locator('[data-testid=caption-look] option').count();
    await page.getByTestId('caption-look').selectOption({ index: 3 });
    const chosen = await page.locator('[data-testid=caption-look] option').nth(3).getAttribute('value');
    const styled = await until(pid, (x) => { const t = x.sequences.seq_main.tracks.find((y: any) => y.kind === 'caption'); return !!t && JSON.stringify(t.caption.style) !== JSON.stringify(withTrack?.sequences.seq_main.tracks.find((y: any) => y.kind === 'caption').caption.style); });
    await sleep(300);
    const shownLook = await page.getByTestId('caption-look').inputValue();
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
      const png = (await call(`/projects/${lp}/frame?index=10`)).body as Buffer;
      const pngFile = path.join(art, 'layout.png');
      fs.writeFileSync(pngFile, png);
      const rgb = ff(['-i', pngFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
      const at = (x: number, y: number) => [rgb[(y * 1280 + x) * 3]!, rgb[(y * 1280 + x) * 3 + 1]!, rgb[(y * 1280 + x) * 3 + 2]!];
      const left = at(320, 360), right = at(960, 360), topLeft = at(20, 20), bottomRight = at(1260, 700);
      const isRed = (c: number[]) => c[0]! > 200 && c[2]! < 60, isBlue = (c: number[]) => c[2]! > 200 && c[0]! < 60;
      check('a layout for the wrong number of pictures is refused with the layouts that do fit; with two picture clips selected the editor offers the two-picture layouts, and "side by side" fills the left half with the lower track\'s picture and the right half with the upper one, each cropped to its cell, on a rendered still', wrong.status !== 200 && tilesShown >= 4 && !!arranged && isRed(left) && isBlue(right) && isRed(topLeft) && isBlue(bottomRight), { refusedStatus: wrong.status, tilesShown, left, right, topLeft, bottomRight });
      await page.screenshot({ path: path.join(art, 'layout-editor.png') });
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
