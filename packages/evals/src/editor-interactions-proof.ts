/**
 * Editor interactions that were built but not yet exercised in a real browser (listed as unverified in docs/PROGRESS.md):
 * canvas drag that creates a format-only override, hide-in-format, clip moves snapping to beats, manual beat edits at the
 * playhead, the batch-export job list, and the level meter during playback.
 * Still not covered here: audible fades/ducking during live playback (only the offline WebAudio chain is measured).
 *   pnpm build && pnpm proof:editor-interactions
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/editor-interactions');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const fr = (t: any) => T.frameIndexAt(t, R);
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 28 });

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const { x } = drumLoop(() => 120, 12, 0.5, 9);
  const raw = path.join(art, 'm.f32');
  fs.writeFileSync(raw, Buffer.from(x.buffer, x.byteOffset, x.byteLength));
  const musicFile = path.join(art, 'music.wav');
  ff(['-f', 'f32le', '-ar', String(BEAT_SR), '-ac', '1', '-i', raw, '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', musicFile]);
  const picFile = path.join(art, 'pic.mp4');
  ff(['-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', picFile]);
  const s = await startServer({ port: 8805, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any;
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'interactions', width: 640, height: 360 })).body.project.id;
    const music = await upload(pid, musicFile), pic = await upload(pid, picFile);
    const mres = (await txs(pid, [{ op: 'add_clip', args: { assetId: music.assetId, start: f(0) } }])).results[0].output;
    const musicClip = mres.audioClipId ?? mres.clipId;
    const picClip = (await txs(pid, [{ op: 'add_clip', args: { assetId: pic.assetId, start: f(7), duration: f(45), withLinkedAudio: false } }])).results[0].output.clipId;
    const title = (await txs(pid, [{ op: 'add_text', args: { text: 'כותרת', start: f(0), duration: f(150) } }])).results[0].output.clipId;
    const vres = await txs(pid, [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640, fit: 'cover' } }, { op: 'add_variant', args: { name: 'Square', width: 360, height: 360 } }]);
    const tall = vres.results[0].output.variantId;
    await call(`/projects/${pid}/assets/${music.assetId}/analyze`, { kind: 'beats' });
    const doc = async () => (await call(`/projects/${pid}`)).body.project;
    const clipOf = (d: any, id: string) => d.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const until = async (pred: (d: any) => boolean, ms = 8000) => { const t = Date.now(); for (;;) { const d = await doc(); if (pred(d)) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

    const page = await (await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('deliver-panel').waitFor();

    console.log('\n# format-only override by dragging on the canvas; hide in format');
    await page.getByTestId('format-switch').selectOption(tall);
    await page.getByTestId('format-badge').waitFor();
    await page.locator(`.clip[data-clip-id="${title}"]`).click();
    await page.getByTestId('canvas-handles').waitFor();
    const mv = page.locator('[data-testid=canvas-handles] [data-handle=move]');
    const mb = (await mv.boundingBox())!;
    const cb = (await page.getByTestId('preview').boundingBox())!;
    const masterBefore = clipOf(await doc(), title).transform;
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.down();
    await page.mouse.move(mb.x + mb.width / 2 + 30, mb.y + mb.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    const dragged = await until((d) => !!d.variants[tall].overrides[title]?.transform);
    let d = await doc();
    const ov = d.variants[tall].overrides[title]?.transform ?? {};
    const masterAfter = clipOf(d, title).transform;
    check('dragging the title on the canvas while viewing a format writes a format-only override by the dragged fraction of that format\'s frame; the master position is untouched', dragged && Math.abs((ov.x ?? 0) - masterBefore.x - 30 / cb.width) < 0.02 && Math.abs((ov.y ?? 0) - masterBefore.y - 60 / cb.height) < 0.02 && JSON.stringify(masterAfter) === JSON.stringify(masterBefore), { override: ov, expected: { dx: Number((30 / cb.width).toFixed(3)), dy: Number((60 / cb.height).toFixed(3)) }, canvas: [Math.round(cb.width), Math.round(cb.height)] });
    await page.getByTestId('format-hide-clip').click();
    const hidden = await until((x2) => x2.variants[tall].overrides[title]?.hidden === true);
    await page.getByTestId('format-clear-override').click();
    const cleared = await until((x2) => !x2.variants[tall].overrides[title]);
    check('"hide in this format" hides the clip there only; "clear override" removes the override', hidden && cleared);
    await page.getByTestId('format-switch').selectOption('');

    console.log('\n# clip moves snap to beats');
    d = await doc();
    const beatFrames: number[] = (await call(`/projects/${pid}/timeline`)).body.markers.beatSeconds.map((x2: number) => Math.round(x2 * 30));
    const dragClip = async (dx: number) => {
      const el = page.locator(`.clip[data-clip-id="${picClip}"]`);
      const b = (await el.boundingBox())!;
      const before = fr(clipOf(await doc(), picClip).start);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + dx / 2, b.y + b.height / 2, { steps: 4 });
      await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 4 });
      await page.mouse.up();
      await until((x2) => fr(clipOf(x2, picClip).start) !== before, 4000);
      return fr(clipOf(await doc(), picClip).start);
    };
    const snapOn = await page.getByTestId('snap-beats').isChecked();
    const afterSnap = await dragClip(21); // 7 px = 2.3 frames at 90 px/s: lands near frame 14, one frame from the beat at 15
    await page.getByTestId('snap-beats').click();
    const afterFree = await dragClip(21);
    await page.getByTestId('snap-beats').click();
    check('with snapping on, a clip dropped near a beat lands exactly on it; with snapping off the same drag lands on a plain frame', snapOn && beatFrames.includes(afterSnap) && !beatFrames.includes(afterFree) && afterFree !== afterSnap, { beatFrames: beatFrames.slice(0, 5), afterSnap, afterFree });

    console.log('\n# manual beat edits at the playhead');
    await page.locator(`.clip[data-clip-id="${musicClip}"]`).click();
    await page.getByTestId('analysis-panel').waitFor();
    const rb = (await page.getByTestId('ruler').boundingBox())!;
    await page.mouse.click(rb.x + 77, rb.y + rb.height / 2); // somewhere between beats
    const n0 = (await doc()).analyses[music.assetId].beats.beats.length;
    await page.getByTestId('analysis-add-beat').click();
    const added = await until((x2) => x2.analyses[music.assetId].beats.beats.length === n0 + 1);
    const editedFlag = (await doc()).analyses[music.assetId].beats.origin.edited;
    await page.getByTestId('analysis-remove-beat').click();
    const removed = await until((x2) => x2.analyses[music.assetId].beats.beats.length === n0);
    check('"add beat at playhead" and "remove nearest beat" change the stored beat grid and mark it as corrected by hand', added && editedFlag === true && removed, { beats: n0 });

    console.log('\n# level meter during playback');
    await page.mouse.click(rb.x + 2, rb.y + rb.height / 2);
    await page.getByTestId('play').click();
    let peak = -Infinity;
    for (let i = 0; i < 40; i++) { const v = Number(await page.getByTestId('sound-meter').getAttribute('aria-valuenow')); if (Number.isFinite(v)) peak = Math.max(peak, v); await sleep(75); }
    await page.getByTestId('play').click();
    check('while the drum loop plays, the meter shows a real level (above -40 dB and not above 0)', peak > -40 && peak <= 0, { peakDbShown: peak });

    console.log('\n# batch export from the editor');
    await page.getByTestId('deliver-export-all').click();
    await page.locator('[data-testid=deliver-job]').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=deliver-job-download]').length === 2, undefined, { timeout: 120000 });
    const links = await page.locator('[data-testid=deliver-job-download]').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href')));
    const sizes: string[] = [];
    for (const href of links) {
      const buf = Buffer.from(await (await fetch(`${s.url}${href}`, { headers: h })).arrayBuffer());
      const file = path.join(art, `out-${sizes.length}.mp4`);
      fs.writeFileSync(file, buf);
      const st = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file], { encoding: 'utf8' })).streams.find((x2: any) => x2.codec_type === 'video');
      sizes.push(`${st.width}x${st.height}`);
    }
    await page.screenshot({ path: path.join(art, 'editor.png') });
    check('"export all formats" lists one job per format and each finishes with a download of the right size', links.length === 2 && JSON.stringify(sizes.sort()) === JSON.stringify(['360x360', '360x640']), { sizes });
    console.log('\n# copy / paste / duplicate; Inspector values follow the viewed format');
    await page.locator(`.clip[data-clip-id="${picClip}"]`).click();
    const srcClip = clipOf(await doc(), picClip);
    await page.keyboard.press('Control+c');
    await page.mouse.click(rb.x + 600, rb.y + rb.height / 2); // playhead to 6.67 s = frame 200 (90 px/s)
    const countVideo = async () => (await doc()).sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).length;
    const v0 = await countVideo();
    await page.keyboard.press('Control+v');
    const pasted = await until((x2) => x2.sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).length === v0 + 1);
    const copies = (await doc()).sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).filter((c: any) => c.id !== picClip && c.assetId === srcClip.assetId);
    const paste = copies.find((c: any) => fr(c.start) === 200);
    await page.keyboard.press('Control+d');
    const duplicated = await until((x2) => x2.sequences.seq_main.tracks.filter((t: any) => t.kind === 'video').flatMap((t: any) => t.clips).length === v0 + 2);
    check('Ctrl+C then Ctrl+V pastes a full copy at the playhead (same source, trim and length) and selects it; Ctrl+D duplicates the selection right after itself', pasted && !!paste && fr(paste.duration) === fr(srcClip.duration) && fr(paste.sourceIn) === fr(srcClip.sourceIn) && duplicated, { pastedAtFrame: paste ? fr(paste.start) : null });
    await page.getByTestId('format-switch').selectOption(tall);
    await page.locator(`.clip[data-clip-id="${title}"]`).click();
    await page.mouse.click(rb.x + 30, rb.y + rb.height / 2); // playhead inside the title: the sliders are enabled only while the clip is on screen
    await page.locator('[data-testid=transform-scope][data-scope=format]').waitFor();
    const masterScale = clipOf(await doc(), title).transform.scale;
    await page.getByTestId('transform-scale').fill('1.5');
    await page.getByTestId('transform-scale').dispatchEvent('pointerup');
    const sliderOverride = await until((x2) => x2.variants[tall].overrides[title]?.transform?.scale === 1.5);
    const masterKept = clipOf(await doc(), title).transform.scale === masterScale;
    const kfDisabled = await page.getByTestId('keyframe-add').isDisabled();
    await page.getByTestId('transform-reset-format').click();
    const resetOk = await until((x2) => !x2.variants[tall].overrides[title]);
    await page.getByTestId('format-switch').selectOption('');
    const scopeMaster = (await page.locator('[data-testid=transform-scope]').getAttribute('data-scope')) === 'master';
    check('while a format is viewed, the Inspector scale slider writes a format-only override (master unchanged), keyframe buttons are disabled, and "reset to master" removes the override; back on the master the controls edit the master again', sliderOverride && masterKept && kfDisabled && resetOk && scopeMaster, { sliderOverride, masterKept, kfDisabled, resetOk, scopeMaster });

    console.log('\n# effect parameter keyframes; cut and paste');
    await page.locator(`.clip[data-clip-id="${picClip}"]`).click();
    const pc0 = clipOf(await doc(), picClip);
    const px0 = rb.x + (fr(pc0.start) + 5) * 3; // 90 px/s = 3 px per frame: five frames into the clip
    await page.mouse.click(px0, rb.y + rb.height / 2);
    await page.getByTestId('effect-add').selectOption('blur.gaussian');
    await until((x2) => clipOf(x2, picClip).effects?.length === 1);
    await page.locator('[data-testid=effect-key][data-param=radius]').click();
    const firstKey = await until((x2) => clipOf(x2, picClip).effects?.[0]?.keyframes?.radius?.length === 1);
    await page.mouse.click(px0 + 60, rb.y + rb.height / 2); // 20 frames later
    await page.locator('[data-testid=effect-param][data-param=radius]').fill('0.1');
    await page.locator('[data-testid=effect-param][data-param=radius]').dispatchEvent('pointerup');
    const secondKey = await until((x2) => clipOf(x2, picClip).effects?.[0]?.keyframes?.radius?.length === 2);
    const keys = clipOf(await doc(), picClip).effects[0].keyframes?.radius ?? [];
    check('effect keyframes in the editor: the ◆ button sets a key at the playhead; moving the playhead and changing the slider adds a second key 20 frames later instead of changing the static value', firstKey && secondKey && fr(keys[1]?.time ?? f(0)) - fr(keys[0]?.time ?? f(0)) === 20 && Math.abs((keys[1]?.value ?? 0) - 0.1) < 1e-6, { keys: keys.map((k: any) => [fr(k.time), k.value]) });
    const revOf = async () => (await call(`/projects/${pid}`)).body.revision as number;
    const r1 = await revOf();
    await page.locator(`.clip[data-clip-id="${picClip}"]`).click();
    await page.keyboard.press('Control+x');
    const pending = await page.locator(`.clip.cut-pending[data-clip-id="${picClip}"]`).count();
    const r2 = await revOf();
    await page.mouse.click(rb.x + 900, rb.y + rb.height / 2); // frame 300
    await page.keyboard.press('Control+v');
    const moved = await until((x2) => !clipOf(x2, picClip));
    const dAfter = await doc();
    const landed = dAfter.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.assetId === pc0.assetId && fr(c.start) === 300);
    const r3b = await revOf();
    await page.keyboard.press('Control+z');
    const restored = await until((x2) => !!clipOf(x2, picClip));
    check('cut then paste moves the clip in one transaction (effects and keyframes come along); nothing is committed by the cut itself; one undo puts it back', pending === 1 && r2 === r1 && moved && !!landed && landed.effects?.[0]?.keyframes?.radius?.length === 2 && r3b === r1 + 1 && restored, { pending, revisions: [r1, r2, r3b], landedAt: landed ? fr(landed.start) : null });

    console.log('\n# project archive from the editor');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('archive-download').click()]);
    const arcFile = path.join(art, 'project.tar');
    await download.saveAs(arcFile);
    const before = await doc();
    await page.getByTestId('archive-import').setInputFiles(arcFile);
    await page.waitForFunction((old) => new URLSearchParams(location.search).get('project') !== old && !!new URLSearchParams(location.search).get('project'), pid, { timeout: 30000 });
    await page.getByTestId('timecode').waitFor();
    const newId = new URL(page.url()).searchParams.get('project')!;
    const imported = (await call(`/projects/${newId}`)).body.project;
    check('download the project archive in the editor, import it back, and the editor opens a new project with the same content', newId !== pid && /\.pulseframe\.tar$/.test(download.suggestedFilename()) && JSON.stringify({ ...imported, id: before.id }) === JSON.stringify(before), { file: download.suggestedFilename(), bytes: fs.statSync(arcFile).size });
    check('no uncaught errors in the page during these interactions', errors.length === 0, errors.slice(0, 4));
    await page.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x2) => !x2.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Browser interactions previously listed as unverified. Headless Chromium only. Audible fades and ducking during live playback are still not measured.', passed: checks.length - failed.length, total: checks.length, checks };
    fs.writeFileSync(path.join(root, 'docs/evidence/editor-interactions-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nEditor interactions proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
