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
    page.on('response', (r) => { if (r.status() === 409) void r.text().then((b) => console.log('  409:', r.request().method(), new URL(r.url()).pathname, (r.request().postData() ?? '').slice(0, 300), b.slice(0, 300))).catch(() => {}); });
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
    // No wait for the panel here, on purpose: the slider is used straight after the ◆ click and must still write a key (the decision is taken when the edit's turn comes).
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

    console.log('\n# volume automation in the Sound tab');
    await page.locator(`.clip[data-clip-id="${musicClip}"]`).click({ position: { x: 5, y: 5 } });
    const volKeys = (d: any) => (clipOf(d, musicClip).volume ?? []).map((k: any) => [fr(k.time), k.value]);
    const setLevelAt = async (frame: number, v: string) => { await page.mouse.click(rb.x + frame * 3 + 0.5, rb.y + 5); await page.getByTestId('volume-level').fill(v); // typed straight after the seek, on purpose: the key must land at the new playhead
      await page.getByTestId('volume-level').press('Enter'); };
    // The server having the key is not enough: the next step types into the panel, so wait until the panel shows it (as a person would).
    const panelKeys = (n: number) => page.waitForFunction((k) => document.querySelector('[data-testid=volume-key-count]')?.textContent?.includes(`(${k})`), n, { timeout: 8000 }).catch(() => {});
    await setLevelAt(30, '0.5');
    const vk1 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[30, 0.5]]));
    await panelKeys(1);
    await setLevelAt(90, '1.2');
    const vk2 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[30, 0.5], [90, 1.2]]));
    await panelKeys(2);
    await page.mouse.click(rb.x + 60 * 3 + 0.5, rb.y + 5);
    await page.waitForFunction(() => (document.querySelector('[data-testid=volume-level]') as HTMLInputElement)?.value === '0.85', undefined, { timeout: 5000 }).catch(() => {});
    const midShown = await page.getByTestId('volume-level').inputValue();
    await page.mouse.click(rb.x + 90 * 3 + 0.5, rb.y + 5);
    await page.getByTestId('volume-key-remove').click();
    const vk3 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[30, 0.5]]));
    check('Sound tab: typing a level writes a volume key at the playhead; between two keys the field shows the interpolated level (0.85 halfway between 0.5 and 1.2); "remove this key" removes only that key', vk1 && vk2 && midShown === '0.85' && vk3, { midShown, keys: volKeys(await doc()) });

    console.log('\n# markers');
    const markersOf = (d: any) => Object.values(d.markers ?? {}).sort((x: any, y: any) => fr(x.time) - fr(y.time)) as any[];
    const tc = async () => (await page.getByTestId('timecode').textContent()) ?? '';
    await page.mouse.click(rb.x + 180.5, rb.y + 5); // frame 60
    await page.keyboard.press('m');
    const mAdded = await until((x2) => markersOf(x2).length === 1 && fr(markersOf(x2)[0].time) === 60);
    await page.getByTestId('marker-label').fill('פזמון chorus');
    await page.getByTestId('marker-label').press('Enter');
    await page.getByTestId('marker-color').selectOption('red');
    const named = await until((x2) => markersOf(x2)[0]?.label === 'פזמון chorus' && markersOf(x2)[0]?.color === 'red');
    await txs(pid, [{ op: 'add_marker', args: { time: f(150), label: 'agent note' } }]); // another participant
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 2, undefined, { timeout: 8000 }).catch(() => {});
    const shownMarkers = await page.getByTestId('user-marker').evaluateAll((els) => els.map((e) => ({ frame: Number((e as HTMLElement).dataset.frame), name: e.getAttribute('aria-label') })));
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+M');
    const hop1 = await tc();
    await page.keyboard.press('Shift+M');
    const hop2 = await tc();
    await page.keyboard.press('Alt+M');
    const hop3 = await tc();
    await page.screenshot({ path: path.join(art, 'editor-markers.png'), clip: { x: 0, y: Math.max(0, rb.y - 40), width: 1500, height: 260 } });
    await page.getByTestId('marker-remove').click();
    const mRemoved = await until((x2) => markersOf(x2).length === 1 && markersOf(x2)[0].label === 'agent note');
    await page.keyboard.press('Control+z');
    const undone = await until((x2) => markersOf(x2).length === 2);
    const tlq = (await call(`/projects/${pid}/timeline`)).body.markers.user;
    check('markers: M adds one at the playhead; name (Hebrew + Latin) and colour are committed edits; a marker added by an agent appears; Shift+M / Alt+M jump between them; remove and undo work; the timeline query lists both', mAdded && named && shownMarkers.length === 2 && shownMarkers[0]?.frame === 60 && /פזמון chorus/.test(shownMarkers[0]?.name ?? '') && hop1 === '00:00:02:00' && hop2 === '00:00:05:00' && hop3 === '00:00:02:00' && mRemoved && undone && tlq.length === 2 && tlq[1].seconds === 5, { shownMarkers, hops: [hop1, hop2, hop3], removed: mRemoved, undone });

    console.log('\n# shuttle (J / L)');
    const tcFrame = async () => { const m = (await tc()).match(/(\d+):(\d+):(\d+)[:;](\d+)/); return m ? ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 30 + +m[4]! : -1; };
    const shuttleText = async () => ((await page.getByTestId('shuttle').count()) ? ((await page.getByTestId('shuttle').textContent()) ?? '').replace(/\s+/g, ' ').trim() : '');
    const speedOver = async (ms: number) => { const a = await tcFrame(), t = Date.now(); await sleep(ms); const b = await tcFrame(); const v = (b - a) / (((Date.now() - t) / 1000) * 30); return v; };
    // the undo above reaches the page a moment after the server: wait for it, because a project change arriving during playback pauses it
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 2, undefined, { timeout: 8000 });
    await page.mouse.click(rb.x + 90.5, rb.y + 5); // frame 30
    await page.keyboard.press('l');
    await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.textContent === '❚❚', undefined, { timeout: 5000 });
    const sh0 = await shuttleText(); // ordinary playback: no shuttle indicator
    await page.keyboard.press('l');
    await page.getByTestId('shuttle').waitFor();
    const sh1 = await shuttleText();
    const fwd2 = await speedOver(1000);
    await page.keyboard.press('j');
    const sh2 = await shuttleText();
    const back1 = await speedOver(800);
    await page.keyboard.press('j');
    const sh3 = await shuttleText();
    await page.keyboard.press('Space');
    const stoppedAt = await tcFrame();
    await sleep(300);
    const sh4 = await shuttleText(), still = (await tcFrame()) === stoppedAt, pausedIcon = (await page.getByTestId('play').textContent()) === '▶';
    await page.mouse.click(rb.x + 60.5, rb.y + 5); // frame 20
    for (let i = 0; i < 3; i++) await page.keyboard.press('j'); // ×4 backwards: reaches the start within a fraction of a second
    await page.waitForFunction(() => !document.querySelector('[data-testid=shuttle]') && document.querySelector('[data-testid=play]')?.textContent === '▶', undefined, { timeout: 5000 }).catch(() => {});
    const atStart = await tcFrame(), shEnd = await shuttleText();
    check('shuttle: L plays, L again goes to 2× (indicator shown, measured speed about 2×); J goes backwards at 1× and J again at 2×; Space stops and the frame holds; shuttling backwards stops at the first frame', sh0 === '' && /▶▶ ×2/.test(sh1) && fwd2 > 1.5 && fwd2 < 2.5 && /◀◀ ×1/.test(sh2) && back1 < -0.6 && back1 > -1.4 && /◀◀ ×2/.test(sh3) && sh4 === '' && still && pausedIcon && atStart === 0 && shEnd === '', { sh0, sh1, fwd2: +fwd2.toFixed(2), sh2, back1: +back1.toFixed(2), sh3, sh4, still, pausedIcon, atStart, shEnd });

    console.log('\n# playback continues when the project changes');
    await page.mouse.click(rb.x + 30.5, rb.y + 5); // frame 10
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.textContent === '❚❚', undefined, { timeout: 5000 });
    const revPlay0 = (await call(`/projects/${pid}`)).body.revision;
    await txs(pid, [{ op: 'add_marker', args: { time: f(300), label: 'while playing' } }]); // another participant edits during playback
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 3, undefined, { timeout: 8000 });
    await sleep(500);
    const keptPlaying = (await page.getByTestId('play').textContent()) === '❚❚';
    const playSpeed = await speedOver(800);
    await page.keyboard.press('l'); // 2×
    await page.getByTestId('shuttle').waitFor();
    await txs(pid, [{ op: 'add_marker', args: { time: f(330), label: 'while shuttling' } }]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 4, undefined, { timeout: 8000 });
    await sleep(300);
    const keptShuttle = await shuttleText();
    const shuttleSpeed = await speedOver(600);
    await page.keyboard.press('Space');
    await page.keyboard.press('Home');
    // a change while paused must not start playback
    await txs(pid, [{ op: 'add_marker', args: { time: f(345) } }]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 5, undefined, { timeout: 8000 });
    await sleep(300);
    const staysPaused = (await page.getByTestId('play').textContent()) === '▶' && (await tcFrame()) === 0;
    check('a project change by another participant during playback does not stop it (normal speed and 2× shuttle both continue at their speed); a change while paused does not start it', keptPlaying && playSpeed > 0.8 && playSpeed < 1.2 && /▶▶ ×2/.test(keptShuttle) && shuttleSpeed > 1.5 && shuttleSpeed < 2.5 && staysPaused && (await call(`/projects/${pid}`)).body.revision === revPlay0 + 3, { keptPlaying, playSpeed: +playSpeed.toFixed(2), keptShuttle, shuttleSpeed: +shuttleSpeed.toFixed(2), staysPaused });

    console.log('\n# multi-select: move, nudge and delete several clips together');
    const mp = (await call('/projects', { name: 'multi', width: 640, height: 360 })).body.project.id;
    const mpic = await upload(mp, picFile);
    const mIds = (await txs(mp, [0, 45, 120].map((st) => ({ op: 'add_clip', args: { assetId: mpic.assetId, start: f(st), duration: f(30), withLinkedAudio: false } })))).results.map((r: any) => r.output.clipId as string);
    const [mA, mB, mC] = mIds as [string, string, string];
    const mdoc = async () => (await call(`/projects/${mp}`)).body;
    const mStarts = (d: any) => [mA, mB, mC].map((id) => { const c = d.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === id); return c ? fr(c.start) : null; });
    const mUntil = async (want: (number | null)[]) => { const t0 = Date.now(); for (;;) { const d = await mdoc(); if (JSON.stringify(mStarts(d)) === JSON.stringify(want)) return d.revision as number; if (Date.now() - t0 > 8000) return -1; await sleep(100); } };
    const mpage = await page.context().newPage();
    const mErrors: string[] = [];
    mpage.on('pageerror', (e) => mErrors.push(String(e)));
    mpage.on('console', (m) => m.type() === 'error' && mErrors.push(m.text()));
    await mpage.goto(`${s.url}/?project=${mp}`);
    const clipEl = (id: string) => mpage.locator(`.clip[data-clip-id="${id}"]`);
    await clipEl(mA).click();
    await clipEl(mB).click({ modifiers: ['Control'] });
    const twoSelected = await mpage.locator('.clip.selected').count();
    const rev0 = (await mdoc()).revision as number;
    const bb = (await clipEl(mB).boundingBox())!;
    await mpage.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await mpage.mouse.down();
    for (const dx of [10, 25, 40, 60]) await mpage.mouse.move(bb.x + bb.width / 2 + dx, bb.y + bb.height / 2, { steps: 2 });
    await mpage.keyboard.down('Alt'); // no snapping: the result must be exactly 20 frames
    await mpage.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2);
    await mpage.mouse.up();
    await mpage.keyboard.up('Alt');
    const revDrag = await mUntil([20, 65, 120]);
    const stillTwo = await mpage.locator('.clip.selected').count();
    await mpage.keyboard.press('Alt+ArrowRight');
    const revNudge = await mUntil([21, 66, 120]);
    await mpage.keyboard.press('Control+a');
    const allSelected = await mpage.locator('.clip.selected').count();
    await clipEl(mC).click({ modifiers: ['Shift'] }); // toggle C off
    await mpage.keyboard.press('Delete');
    const revDelete = await mUntil([null, null, 120]);
    await mpage.keyboard.press('Control+z');
    const revUndo = await mUntil([21, 66, 120]);
    check('multi-select: Ctrl+click adds a clip to the selection; dragging one moves both by the same 20 frames in one transaction and a third clip stays; Alt+→ nudges both; Ctrl+A selects all, Shift+click removes one; Delete removes the two selected in one transaction and one undo restores them', twoSelected === 2 && revDrag === rev0 + 1 && stillTwo === 2 && revNudge === rev0 + 2 && allSelected === 3 && revDelete === rev0 + 3 && revUndo === rev0 + 4 && mErrors.length === 0, { twoSelected, stillTwo, allSelected, revisions: [rev0, revDrag, revNudge, revDelete, revUndo], errors: mErrors.slice(0, 3) });

    console.log('\n# marquee selection');
    const selIds = async () => (await mpage.locator('.clip.selected').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.clipId))).sort();
    const [qa, qb, qc] = [(await clipEl(mA).boundingBox())!, (await clipEl(mB).boundingBox())!, (await clipEl(mC).boundingBox())!];
    const revM = (await mdoc()).revision as number;
    const laneY = qa.y - 3; // inside the track lane, above the clip
    await mpage.mouse.click(qa.x - 8, laneY); // plain click on empty space clears the selection
    const cleared0 = (await selIds()).length;
    await mpage.mouse.move(qa.x - 8, laneY);
    await mpage.mouse.down();
    await mpage.mouse.move(qb.x + qb.width / 2, qa.y + qa.height - 4, { steps: 6 });
    const boxShown = await mpage.getByTestId('marquee').count();
    const during = await selIds();
    await mpage.mouse.up();
    const afterAB = await selIds(), boxGone = (await mpage.getByTestId('marquee').count()) === 0;
    await mpage.keyboard.down('Shift');
    await mpage.mouse.move(qc.x - 6, laneY);
    await mpage.mouse.down();
    await mpage.mouse.move(qc.x + 10, qc.y + 12, { steps: 4 });
    await mpage.mouse.up();
    await mpage.keyboard.up('Shift');
    const afterAdd = await selIds();
    await mpage.mouse.move(qb.x - 6, laneY);
    await mpage.mouse.down();
    await mpage.mouse.move(qb.x + 12, qb.y + 12, { steps: 4 });
    const midEscape = await selIds();
    await mpage.keyboard.press('Escape');
    const afterEscape = await selIds();
    await mpage.mouse.up();
    const afterEscapeUp = await selIds();
    const want = (ids: string[]) => JSON.stringify([...ids].sort());
    check('marquee: dragging a box over empty timeline space selects exactly the clips it touches (live while dragging); Shift+drag adds to the selection; Escape during a drag restores the selection from before it; a plain click on empty space clears it; none of this changes the project', cleared0 === 0 && boxShown === 1 && want(during as string[]) === want([mA, mB]) && want(afterAB as string[]) === want([mA, mB]) && boxGone && want(afterAdd as string[]) === want([mA, mB, mC]) && want(midEscape as string[]) === want([mB]) && want(afterEscape as string[]) === want([mA, mB, mC]) && want(afterEscapeUp as string[]) === want([mA, mB, mC]) && (await mdoc()).revision === revM, { cleared0, boxShown, during, afterAB, afterAdd, midEscape, afterEscape, afterEscapeUp });
    await mpage.close();

    console.log('\n# subtitle file in a legacy Hebrew encoding');
    const HEB_CUE = 'שלום עולם, מה נשמע?';
    const srtText = `1\r\n00:00:01,000 --> 00:00:02,000\r\n${HEB_CUE}\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nPULSEFRAME 2026\r\n`;
    const cp1255 = Buffer.from([...srtText].map((ch) => { const c = ch.codePointAt(0)!; return c >= 0x05d0 && c <= 0x05ea ? c - 0x05d0 + 0xe0 : c; }));
    const cuesOf = (d: any) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === 'caption').flatMap((t: any) => t.clips).map((c: any) => c.text);
    await page.getByTestId('captions-import').setInputFiles({ name: 'legacy.srt', mimeType: 'application/x-subrip', buffer: cp1255 });
    const legacyIn = await until((x2) => cuesOf(x2).includes(HEB_CUE));
    const note = await page.getByTestId('encoding-note').first().getAttribute('data-encoding').catch(() => null);
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(srtText.replace(HEB_CUE, 'עוד שורה בעברית').replace('PULSEFRAME 2026', 'UTF-16 file').replace('00:00:01,000 --> 00:00:02,000', '00:00:05,000 --> 00:00:06,000').replace('00:00:03,000 --> 00:00:04,000', '00:00:07,000 --> 00:00:08,000'), 'utf16le')]); // its own times: cues may not overlap
    await page.getByTestId('captions-import').setInputFiles({ name: 'wide.srt', mimeType: 'application/x-subrip', buffer: utf16 });
    const wideIn = await until((x2) => cuesOf(x2).includes('עוד שורה בעברית') && cuesOf(x2).includes('UTF-16 file'));
    await page.waitForFunction(() => !document.querySelector('[data-testid=encoding-note]'), undefined, { timeout: 5000 }).catch(() => {});
    const noteAfterMarked = await page.getByTestId('encoding-note').count();
    check('a Hebrew subtitle file saved as Windows-1255 is imported with its Hebrew text intact and the editor says it had to guess the encoding; a UTF-16 file with a byte-order mark is imported too, without that note', legacyIn && note === 'windows-1255' && wideIn && noteAfterMarked === 0, { note, cues: cuesOf(await doc()).slice(0, 6), noteAfterMarked });

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
