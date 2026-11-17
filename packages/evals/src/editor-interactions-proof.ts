/**
 * Editor interactions that were built but not yet exercised in a real browser (listed as unverified in docs/PROGRESS.md):
 * canvas drag that creates a format-only override, hide-in-format, clip moves snapping to beats, manual beat edits at the
 * playhead, the batch-export job list, and the level meter during playback. The visual wave's look panel (ADR-0011): the ♪
 * beat toggle with its fieldset and undo, the date-stamp field with its inline refusal, and the time-first separator.
 * Adjustment layers and templates (ADR-0016): the FX track, "apply to: the whole edit", the opacity-only inspector and
 * "cover the whole edit", "Replace media…", the Templates drawer and a keyboard-only template flow with Shuffle and undo.
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
import { dictionaries, effectParamLabel, translateRefusal } from '../../i18n/src/index.ts';
import { creativeProjection } from '@pulseframe/core';
import { TEMPLATE_TESTIDS } from '../../../apps/web/src/editor/templates.testids.ts';

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

    console.log('\n# title wording for one format only');
    const frameBytes = async (variant?: string) => Buffer.from(await (await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=20${variant ? `&variant=${variant}` : ''}`, { headers: h })).arrayBuffer());
    const sq = Object.values((await doc()).variants as Record<string, any>).find((v: any) => v.name === 'Square').id as string;
    const wBefore = { master: await frameBytes(), tall: await frameBytes(tall), sq: await frameBytes(sq) };
    await page.locator(`.clip[data-clip-id="${title}"]`).click();
    await page.getByTestId('format-switch').selectOption(tall);
    await page.getByTestId('text-format-note').waitFor();
    const hintBefore = (await page.getByTestId('text-format-reset').count()) === 0;
    await page.getByTestId('text-content').fill('קצר');
    await page.getByTestId('text-content').blur();
    const wordingSet = await until((x2) => x2.variants[tall].overrides[title]?.text === 'קצר' && clipOf(x2, title).text === 'כותרת');
    await page.getByTestId('text-format-reset').waitFor();
    const wAfter = { master: await frameBytes(), tall: await frameBytes(tall), sq: await frameBytes(sq) };
    await page.getByTestId('format-switch').selectOption('');
    const masterField = await page.getByTestId('text-content').inputValue();
    await page.getByTestId('format-switch').selectOption(tall);
    const tallField = await page.getByTestId('text-content').inputValue();
    await page.getByTestId('text-format-reset').click();
    const wordingCleared = await until((x2) => !x2.variants[tall].overrides[title]);
    await page.waitForFunction(() => (document.querySelector('[data-testid=text-content]') as HTMLTextAreaElement | null)?.value === 'כותרת', undefined, { timeout: 5000 }).catch(() => {});
    const fieldBack = await page.getByTestId('text-content').inputValue();
    const wRestored = await frameBytes(tall);
    await page.getByTestId('format-switch').selectOption('');
    check('while a format is viewed, editing the title text changes the wording in that format only: the rendered frame of that format changes, the master and another format render byte-identically, the field shows each wording in its own view, and "back to the master text" restores it', hintBefore && wordingSet && !wAfter.tall.equals(wBefore.tall) && wAfter.master.equals(wBefore.master) && wAfter.sq.equals(wBefore.sq) && masterField === 'כותרת' && tallField === 'קצר' && wordingCleared && fieldBack === 'כותרת' && wRestored.equals(wBefore.tall), { hintBefore, wordingSet, tallChanged: !wAfter.tall.equals(wBefore.tall), masterSame: wAfter.master.equals(wBefore.master), squareSame: wAfter.sq.equals(wBefore.sq), masterField, tallField, wordingCleared, fieldBack, restoredSame: wRestored.equals(wBefore.tall) });

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

    console.log('\n# volume line on the clip');
    const vline = page.getByTestId(`volume-line-${musicClip}`), vkeysEl = page.getByTestId('volume-line-key');
    await vkeysEl.first().waitFor({ timeout: 5000 });
    const lineBox = (await vline.boundingBox())!;
    const k0 = (await vkeysEl.first().boundingBox())!;
    const handleAt = Math.abs(k0.x + k0.width / 2 - (lineBox.x + 30 * 3)) < 1.5; // the key at clip frame 30 sits 90 px into the clip
    const tcBefore = (await page.getByTestId('timecode').textContent()) ?? '';
    // drag the handle 30 px right (10 frames) and 13 px up (+1.0 on the 0..2 scale)
    await page.mouse.move(k0.x + k0.width / 2, k0.y + k0.height / 2);
    await page.mouse.down();
    await page.mouse.move(k0.x + k0.width / 2 + 15, k0.y + k0.height / 2 - 6, { steps: 3 });
    await page.mouse.move(k0.x + k0.width / 2 + 30, k0.y + k0.height / 2 - 13, { steps: 3 });
    await page.mouse.up();
    const vl1 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[40, 1.5]]));
    // double-click on the line at clip frame 80 (the level there is held at 1.5): a key appears
    await page.waitForFunction(() => document.querySelector('[data-testid=volume-line-key]')?.getAttribute('data-frame') === '40', undefined, { timeout: 5000 }).catch(() => {});
    await page.mouse.dblclick(lineBox.x + 80 * 3, lineBox.y + 10.5);
    const vl2 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[40, 1.5], [80, 1.5]]));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=volume-line-key]').length === 2, undefined, { timeout: 5000 }).catch(() => {});
    // keyboard on the handle: down twice, left once; the playhead and the clip are not affected
    await vkeysEl.nth(1).focus();
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    const vl3a = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[40, 1.5], [80, 1.4]]));
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=volume-line-key]')[1]?.getAttribute('data-value') === '1.4', undefined, { timeout: 5000 }).catch(() => {});
    await vkeysEl.nth(1).focus();
    await page.keyboard.press('ArrowLeft');
    const vl3 = vl3a && await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[40, 1.5], [79, 1.4]]));
    const namedKey = (await vkeysEl.nth(1).getAttribute('aria-label')) ?? '';
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=volume-line-key]')[1]?.getAttribute('data-frame') === '79', undefined, { timeout: 5000 }).catch(() => {});
    await vkeysEl.nth(1).focus();
    await page.keyboard.press('Delete');
    const vl4 = await until((x2) => JSON.stringify(volKeys(x2)) === JSON.stringify([[40, 1.5]])) && !!clipOf(await doc(), musicClip);
    const tcAfter = (await page.getByTestId('timecode').textContent()) ?? '';
    // a drag that starts on the line moves the clip, as a drag on the clip does (then undone)
    const startWas = fr(clipOf(await doc(), musicClip).start);
    await page.mouse.move(lineBox.x + 200, lineBox.y + 10.5);
    await page.mouse.down();
    await page.mouse.move(lineBox.x + 215, lineBox.y + 10.5, { steps: 3 });
    await page.mouse.move(lineBox.x + 230, lineBox.y + 10.5, { steps: 3 });
    await page.mouse.up();
    const vl5 = await until((x2) => fr(clipOf(x2, musicClip).start) === startWas + 10, 4000);
    if (vl5) { await page.keyboard.press('Control+z'); await until((x2) => fr(clipOf(x2, musicClip).start) === startWas); }
    check('volume line: the key is drawn at its frame; dragging it changes time and level in one edit (30→40, 0.5→1.5); a double-click on the line adds a key at the level there; arrow keys nudge the focused key without moving the playhead; Delete removes the key, not the clip; the key is named for assistive technology; a drag on the line moves the clip', handleAt && vl1 && vl2 && vl3 && vl4 && tcBefore === tcAfter && /\d+%/.test(namedKey) && vl5, { handleAt, vl1, vl2, vl3, vl4, vl5, tcBefore, tcAfter, namedKey, keys: volKeys(await doc()) });
    // smooth stretch and freehand drawing on the same line (keys now: 0.5 at clip frame 40 after the checks above → set a known pair first)
    await txs(pid, [{ op: 'delete_volume_keyframe', args: { clipId: musicClip } }, { op: 'set_volume_keyframe', args: { clipId: musicClip, time: f(30), value: 0.5 } }, { op: 'set_volume_keyframe', args: { clipId: musicClip, time: f(90), value: 1.2 } }]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=volume-line-key]').length === 2, undefined, { timeout: 8000 }).catch(() => {});
    await vkeysEl.first().focus();
    await page.keyboard.press('s');
    const smoothSet = await until((x2) => clipOf(x2, musicClip).volume?.[0]?.curve === 'smooth');
    await page.waitForFunction(() => document.querySelector('[data-testid=volume-line-key]')?.getAttribute('data-curve') === 'smooth', undefined, { timeout: 5000 }).catch(() => {});
    const musicStart = fr(clipOf(await doc(), musicClip).start);
    await page.mouse.click(rb.x + (musicStart + 45) * 3 + 0.5, rb.y + 5); // a quarter of the way along the stretch
    await page.waitForFunction(() => (document.querySelector('[data-testid=volume-level]') as HTMLInputElement)?.value === '0.609', undefined, { timeout: 5000 }).catch(() => {});
    const quarterShown = await page.getByTestId('volume-level').inputValue(); // 0.5 + 0.7 × (3·0.25² − 2·0.25³) = 0.609; a straight line gives 0.675
    // freehand: Alt + drag from the line at clip frame 110 (level 1.2, held after the last key) down to about 0.4 at frame 170
    const lb2 = (await vline.boundingBox())!;
    const yOf = (v: number) => lb2.y + 34 - 4 - (v / 2) * 26;
    const revBeforeDraw = (await call(`/projects/${pid}`)).body.revision as number;
    await page.keyboard.down('Alt');
    await page.mouse.move(lb2.x + 110 * 3, yOf(1.2));
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(lb2.x + (110 + i * 6) * 3, yOf(1.2 - 0.08 * i));
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const drew = await until((x2) => (clipOf(x2, musicClip).volume?.length ?? 0) > 6);
    const afterDraw = (await call(`/projects/${pid}`)).body;
    const drawnKeys = volKeys(afterDraw.project).filter((k: number[]) => k[0]! >= 100);
    check('volume line: S on a key makes the stretch to the next key smooth (the level a quarter of the way is 0.609, not the straight line\'s 0.675); Alt + drag draws the level — one edit replaces the keys under the stroke with keys along it (from frame 110 at 1.2 down to 170 at about 0.4), the earlier keys stay',
      smoothSet && quarterShown === '0.609' && drew && afterDraw.revision === revBeforeDraw + 1 && drawnKeys.length >= 8 && drawnKeys[0][0] === 110 && Math.abs(drawnKeys[0][1] - 1.2) < 0.06 && drawnKeys.at(-1)[0] === 170 && Math.abs(drawnKeys.at(-1)[1] - 0.4) < 0.06 && drawnKeys.every((k: number[], i: number) => i === 0 || k[1]! <= drawnKeys[i - 1][1] + 0.02) && JSON.stringify(volKeys(afterDraw.project).slice(0, 2)) === JSON.stringify([[30, 0.5], [90, 1.2]]),
      { smoothSet, quarterShown, revisions: afterDraw.revision - revBeforeDraw, drawnKeys });
    // back to the state the following sections were written against
    await txs(pid, [{ op: 'delete_volume_keyframe', args: { clipId: musicClip } }, { op: 'set_volume_keyframe', args: { clipId: musicClip, time: f(30), value: 0.5 } }]);

    console.log('\n# fit music to the picture');
    const fm0 = await doc();
    const music0 = clipOf(fm0, musicClip);
    const pictureEnd = Math.max(...fm0.sequences.seq_main.tracks.filter((t: any) => t.kind !== 'audio').flatMap((t: any) => t.clips).map((c: any) => fr(c.start) + fr(c.duration)));
    const beatsNow: number[] = ((await call(`/projects/${pid}/timeline`)).body.markers.beatSeconds as number[]).map((sec) => Math.floor(sec * 30 + 1e-6)); // the op takes each beat down to a whole frame
    const wantEnd = Math.max(...beatsNow.filter((b) => b > fr(music0.start) && b <= pictureEnd));
    await page.locator(`.clip[data-clip-id="${musicClip}"]`).click();
    await page.getByTestId('sound-fit-music').click();
    const fitted = await until((x2) => fr(clipOf(x2, musicClip).start) + fr(clipOf(x2, musicClip).duration) !== fr(music0.start) + fr(music0.duration) || !!clipOf(x2, musicClip).fadeOut);
    const music1 = clipOf(await doc(), musicClip);
    const gotEnd = fr(music1.start) + fr(music1.duration);
    await page.keyboard.press('Control+z');
    const fitUndone = await until((x2) => fr(clipOf(x2, musicClip).duration) === fr(music0.duration) && !clipOf(x2, musicClip).fadeOut);
    check('Sound tab: "end the music with the picture" trims the music to the last detected beat before the picture ends and gives it a fade-out, in one transaction; undo restores it', fitted && gotEnd === wantEnd && gotEnd <= pictureEnd && fr(music1.fadeOut) > 0 && fitUndone, { pictureEnd, wantEnd, gotEnd, fadeOutFrames: music1.fadeOut ? fr(music1.fadeOut) : 0, fitUndone });

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
    await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'true', undefined, { timeout: 5000 });
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
    const sh4 = await shuttleText(), still = (await tcFrame()) === stoppedAt, pausedIcon = (await page.getByTestId('play').getAttribute('data-playing')) === 'false';
    // K stops a shuttle and holds the frame
    await page.keyboard.press('l'); await page.keyboard.press('l');
    await page.getByTestId('shuttle').waitFor();
    await page.keyboard.press('k');
    const kAt = await tcFrame();
    await sleep(300);
    const kStops = (await shuttleText()) === '' && (await tcFrame()) === kAt && (await page.getByTestId('play').getAttribute('data-playing')) === 'false';
    await page.mouse.click(rb.x + 60.5, rb.y + 5); // frame 20
    for (let i = 0; i < 3; i++) await page.keyboard.press('j'); // ×4 backwards: reaches the start within a fraction of a second
    await page.waitForFunction(() => !document.querySelector('[data-testid=shuttle]') && document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'false', undefined, { timeout: 5000 }).catch(() => {});
    const atStart = await tcFrame(), shEnd = await shuttleText();
    check('shuttle: K stops it and the frame holds', kStops);
    check('shuttle: L plays, L again goes to 2× (indicator shown, measured speed about 2×); J goes backwards at 1× and J again at 2×; Space stops and the frame holds; shuttling backwards stops at the first frame', sh0 === '' && /▶▶ ×2/.test(sh1) && fwd2 > 1.5 && fwd2 < 2.5 && /◀◀ ×1/.test(sh2) && back1 < -0.6 && back1 > -1.4 && /◀◀ ×2/.test(sh3) && sh4 === '' && still && pausedIcon && atStart === 0 && shEnd === '', { sh0, sh1, fwd2: +fwd2.toFixed(2), sh2, back1: +back1.toFixed(2), sh3, sh4, still, pausedIcon, atStart, shEnd });

    console.log('\n# playback continues when the project changes');
    await page.mouse.click(rb.x + 30.5, rb.y + 5); // frame 10
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('[data-testid=play]')?.getAttribute('data-playing') === 'true', undefined, { timeout: 5000 });
    const revPlay0 = (await call(`/projects/${pid}`)).body.revision;
    await txs(pid, [{ op: 'add_marker', args: { time: f(300), label: 'while playing' } }]); // another participant edits during playback
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=user-marker]').length === 3, undefined, { timeout: 8000 });
    await sleep(500);
    const keptPlaying = (await page.getByTestId('play').getAttribute('data-playing')) === 'true';
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
    const staysPaused = (await page.getByTestId('play').getAttribute('data-playing')) === 'false' && (await tcFrame()) === 0;
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
    console.log('\n# removing a clip: action bar, right-click menu, clip panel');
    {
      const dp = (await call('/projects', { name: 'delete', width: 640, height: 360 })).body.project.id as string;
      const da = await upload(dp, picFile);
      const mk = async (frame: number) => (await call(`/projects/${dp}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: da.assetId ?? da, start: T.frameTime(frame, { num: 30, den: 1 }), duration: T.frameTime(30, { num: 30, den: 1 }) } }] })).body.results[0].output.clipId as string;
      const c1 = await mk(0), c2 = await mk(40), c3 = await mk(80);
      const page3 = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      await page3.goto(`${s.ownerUrl}&project=${dp}`);
      const has = async (id: string) => (await page3.locator(`.clip[data-clip-id="${id}"]`).count()) === 1;
      await page3.locator(`.clip[data-clip-id="${c1}"]`).waitFor();
      const idle = await page3.getByTestId('bar-delete').isDisabled();
      await page3.locator(`.clip[data-clip-id="${c1}"]`).click();
      const armed = await page3.getByTestId('bar-delete').isEnabled();
      await page3.getByTestId('bar-delete').click();
      await page3.locator(`.clip[data-clip-id="${c1}"]`).waitFor({ state: 'detached' });
      await page3.locator(`.clip[data-clip-id="${c2}"]`).click({ button: 'right' });
      await page3.getByTestId('clip-menu').waitFor();
      const focused = await page3.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      await page3.getByTestId('menu-delete').click();
      await page3.locator(`.clip[data-clip-id="${c2}"]`).waitFor({ state: 'detached' });
      const menuClosed = (await page3.getByTestId('clip-menu').count()) === 0;
      await page3.locator(`.clip[data-clip-id="${c3}"]`).click();
      await page3.getByTestId('inspector-tab-clip').click();
      await page3.getByTestId('clip-delete').click();
      await page3.locator(`.clip[data-clip-id="${c3}"]`).waitFor({ state: 'detached' });
      await page3.getByTestId('undo').click();
      await page3.locator(`.clip[data-clip-id="${c3}"]`).waitFor();
      check('a clip is removed from the timeline in one step three ways: the action bar above the tracks (disabled until a clip is selected), the right-click menu (opens with the keyboard focus inside and closes after use), and a button in the clip panel; undo brings it back', idle && armed && !(await has(c1)) && !(await has(c2)) && (await has(c3)) && menuClosed && !!focused?.startsWith('menu-'), { idle, armed, focused, menuClosed });
      await page3.close();
    }

    console.log('\n# visual wave (ADR-0011): beat on a parameter, the date stamp, the time-first rule');
    {
      // A clip under analysed music with a gaussian blur, whose radius may follow the beat (core MODULATABLE). Hebrew interface.
      const vp = (await call('/projects', { name: 'visual', width: 640, height: 360 })).body.project.id as string;
      const vm = await upload(vp, musicFile), vpic = await upload(vp, picFile);
      await txs(vp, [{ op: 'add_clip', args: { assetId: vm.assetId, start: f(0) } }]);
      const analysed = await call(`/projects/${vp}/assets/${vm.assetId}/analyze`, { kind: 'beats' });
      const vclip = (await txs(vp, [{ op: 'add_clip', args: { assetId: vpic.assetId, start: f(0), duration: f(90), withLinkedAudio: false } }])).results[0].output.clipId as string;
      await txs(vp, [{ op: 'add_effect', args: { clipId: vclip, type: 'blur.gaussian', params: { radius: 0.01 } } }]);
      const vclipNow = async () => clipOf((await call(`/projects/${vp}`)).body.project, vclip);
      const vuntil = async (pred: (c: any) => boolean, ms = 8000) => { const t0 = Date.now(); for (;;) { const c = await vclipNow(); if (c && pred(c)) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } };
      const vctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await vctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'clip'); } catch { /* storage unavailable */ } });
      const vpage = await vctx.newPage();
      const vErrors: string[] = [];
      vpage.on('pageerror', (e) => vErrors.push(String(e)));
      await vpage.goto(`${s.ownerUrl}&project=${vp}`);
      await vpage.locator(`.clip[data-clip-id="${vclip}"]`).click();

      // ♪: on commits set_effect_modulator (every 2 by default); the fieldset changes it; undo takes each step back
      const toggle = vpage.locator('[data-testid=beat-toggle][data-param=radius]');
      await toggle.waitFor({ timeout: 10000 });
      await vpage.waitForFunction(() => document.querySelector('[data-testid=beat-toggle][data-param=radius]')?.hasAttribute('disabled') === false, undefined, { timeout: 10000 }).catch(() => {});
      const plainClip = await vclipNow();
      const toggleName = await toggle.getAttribute('aria-label');
      await toggle.click();
      const on = await vuntil((c) => c.effects[0].modulate?.radius?.every === 2 && c.effects[0].modulate.radius.depth > 0);
      await vpage.getByTestId('beat-fieldset').waitFor({ timeout: 5000 }).catch(() => {});
      const pressedOn = await toggle.getAttribute('aria-pressed');
      const legend = ((await vpage.locator('[data-testid=beat-fieldset] legend').textContent().catch(() => '')) ?? '').trim();
      await vpage.getByTestId('beat-every').selectOption('4');
      const every4 = await vuntil((c) => c.effects[0].modulate?.radius?.every === 4);
      await vpage.getByTestId('undo').click();
      const undo1 = await vuntil((c) => c.effects[0].modulate?.radius?.every === 2);
      await vpage.getByTestId('undo').click();
      const undo2 = await vuntil((c) => JSON.stringify(c) === JSON.stringify(plainClip));
      await vpage.getByTestId('beat-fieldset').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const pressedOff = await toggle.getAttribute('aria-pressed');
      const wantName = `פעימה על ${effectParamLabel('radius', 'he', 'blur.gaussian')}`;
      check('♪ on the blur radius (music with detected beats under the clip): it is named "פעימה על <label>", turning it on commits set_effect_modulator (every second beat) and opens its fieldset; choosing every 4 commits that; one undo takes back the change, a second the modulator, and the clip is as before', analysed.status === 200 && toggleName === wantName && on && pressedOn === 'true' && legend.includes('פעימה על') && every4 && undo1 && undo2 && pressedOff === 'false', { toggleName, wantName, on, pressedOn, legend, every4, undo1, undo2, pressedOff });

      // the date stamp: added from the select, its text committed on Enter; bad text is refused by the op and the refusal shown under the field, in Hebrew
      await vpage.getByTestId('effect-add').selectOption('stylize.date-stamp');
      const stampAdded = await vuntil((c) => c.effects.some((e: any) => e.type === 'stylize.date-stamp'));
      const stampText = async () => (await vclipNow()).effects.find((e: any) => e.type === 'stylize.date-stamp')?.params.text;
      const field = vpage.getByTestId('effect-stamp');
      await field.waitFor({ timeout: 5000 });
      const fieldDir = await field.getAttribute('dir');
      await field.fill("'26 1 2");
      await field.press('Enter');
      const typed = await vuntil((c) => c.effects.find((e: any) => e.type === 'stylize.date-stamp')?.params.text === "'26 1 2");
      await field.fill('12/AB');
      await field.blur();
      await vpage.getByTestId('effect-stamp-refusal').waitFor({ timeout: 8000 }).catch(() => {});
      const refusal = ((await vpage.getByTestId('effect-stamp-refusal').textContent().catch(() => '')) ?? '').trim();
      const wantRefusal = translateRefusal('he', 'invalid parameters for stylize.date-stamp: text') ?? '(no Hebrew wording)';
      const invalid = await field.getAttribute('aria-invalid');
      const kept = (await stampText()) === "'26 1 2";
      await vpage.getByTestId('effect-stamp-today').click();
      const d0 = new Date(), today = `'${String(d0.getFullYear() % 100).padStart(2, '0')} ${d0.getMonth() + 1} ${d0.getDate()}`;
      const todaySet = await vuntil((c) => c.effects.find((e: any) => e.type === 'stylize.date-stamp')?.params.text === today);
      await vpage.getByTestId('effect-stamp-refusal').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const refusalGone = (await vpage.getByTestId('effect-stamp-refusal').count()) === 0;
      check('date stamp: its text field reads left to right; typed text is committed on Enter; letters are refused by the op and the refusal is shown under the field in Hebrew (the field marked invalid, the stored text kept); "תאריך היום" commits today as \'YY M D and the refusal goes', stampAdded && fieldDir === 'ltr' && typed && refusal.includes(wantRefusal) && /[א-ת]/.test(refusal) && invalid === 'true' && kept && todaySet && refusalGone, { fieldDir, typed, refusal, wantRefusal, invalid, kept, today, todaySet, refusalGone });

      // the time-first rule: echo added from the select goes first; a separator named by the rule follows it; the moves that
      // would put an effect above it are aria-disabled and do nothing; a second time effect is refused, the refusal shown in the panel
      await vpage.getByTestId('effect-add').selectOption('time.echo');
      const echoFirst = await vuntil((c) => c.effects[0]?.type === 'time.echo' && c.effects.length === 3);
      await vpage.getByTestId('time-separator').waitFor({ timeout: 5000 }).catch(() => {});
      const rows = vpage.getByTestId('effect-row');
      await vpage.waitForFunction(() => document.querySelector('[data-testid=effect-row]')?.getAttribute('data-effect-type') === 'time.echo', undefined, { timeout: 5000 }).catch(() => {});
      const sep = vpage.getByTestId('time-separator');
      const sepInfo = { count: await sep.count(), role: await sep.getAttribute('role').catch(() => null), name: await sep.getAttribute('aria-label').catch(() => null), inFirstRow: await rows.first().getByTestId('time-separator').count() };
      const upSecond = rows.nth(1).getByTestId('effect-up'), downTime = rows.first().getByTestId('effect-down');
      const blocked = { up: await upSecond.getAttribute('aria-disabled'), down: await downTime.getAttribute('aria-disabled'), otherDown: await rows.nth(1).getByTestId('effect-down').getAttribute('aria-disabled') };
      const order0 = (await vclipNow()).effects.map((e: any) => e.type), rev0 = (await call(`/projects/${vp}`)).body.revision as number;
      await upSecond.click({ force: true }); // aria-disabled: still reachable, does nothing
      await downTime.click({ force: true });
      await sleep(700);
      const order1 = (await vclipNow()).effects.map((e: any) => e.type), rev1 = (await call(`/projects/${vp}`)).body.revision as number;
      const cost = ((await rows.first().getByTestId('time-cost').textContent().catch(() => '')) ?? '').trim();
      await vpage.getByTestId('effect-add').selectOption('time.split');
      await vpage.getByTestId('look-refusal').waitFor({ timeout: 8000 }).catch(() => {});
      const panelRefusal = ((await vpage.getByTestId('look-refusal').textContent().catch(() => '')) ?? '').trim();
      const wantTime = translateRefusal('he', 'a clip can carry one time effect (echo, time split, shutter or stutter)') ?? '(no Hebrew wording)';
      const stillOne = (await vclipNow()).effects.filter((e: any) => e.type.startsWith('time.')).length === 1;
      check('time effect first: echo added after two effects is placed first; a separator (role separator, named by the rule) closes its row; moving the next effect up and the echo down are aria-disabled and change nothing; the cost line counts its pictures; a second time effect is refused and the refusal is shown in the panel in Hebrew', echoFirst && sepInfo.count === 1 && sepInfo.role === 'separator' && sepInfo.inFirstRow === 1 && !!sepInfo.name && blocked.up === 'true' && blocked.down === 'true' && blocked.otherDown === null && JSON.stringify(order1) === JSON.stringify(order0) && rev1 === rev0 && /4/.test(cost) && panelRefusal.includes(wantTime) && stillOne, { order0, order1, revisions: [rev0, rev1], separator: sepInfo, blocked, cost, panelRefusal, wantTime });
      check('no uncaught errors in the page with the visual-wave controls', vErrors.length === 0, vErrors.slice(0, 4));
      await vctx.close();
    }

    console.log('\n# adjustment layers and templates (ADR-0016)');
    {
      const TID = TEMPLATE_TESTIDS;
      const tp = (await call('/projects', { name: 'adjust-and-templates', width: 640, height: 360 })).body.project.id as string;
      const stills: string[] = [];
      for (const [i, c] of ['0x4a6f8c', '0x8c5a4a', '0x5a8c6a', '0x7a5a8c'].entries()) { const file = path.join(art, `still-${i}.png`); ff(['-f', 'lavfi', '-i', `color=c=${c}:s=640x360,drawbox=x=${60 + i * 100}:y=90:w=120:h=180:color=0xc0b07a:t=fill`, '-frames:v', '1', file]); stills.push(file); }
      const tvid = await upload(tp, picFile);
      const timgs: string[] = [];
      for (const file of stills) timgs.push((await upload(tp, file)).assetId as string);
      const tmusic = await upload(tp, musicFile);
      const measured = await call(`/projects/${tp}/assets/${tmusic.assetId}/analyze`, { kind: 'beats' });
      const vclip = (await txs(tp, [{ op: 'add_clip', args: { assetId: tvid.assetId, start: f(0), duration: f(90), withLinkedAudio: false } }])).results[0].output.clipId as string;
      const tdoc = async () => (await call(`/projects/${tp}`)).body as { project: any; revision: number };
      const tuntil = async (pred: (d: any) => boolean, ms = 10000) => { const t0 = Date.now(); for (;;) { const d = await tdoc(); if (pred(d.project)) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } };
      const opsSince = async (rev: number) => ((await call(`/projects/${tp}/history?since=${rev}`)).body.events as any[]).filter((e) => e.revision > rev).map((e) => e.ops);
      const adjOf = (d: any) => d.sequences.seq_main.tracks.filter((t: any) => t.kind === 'adjustment').flatMap((t: any) => t.clips);
      const tctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await tctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'clip'); } catch { /* storage unavailable */ } });
      const tpage = await tctx.newPage();
      const tErrors: string[] = [];
      tpage.on('pageerror', (e) => tErrors.push(String(e)));
      await tpage.goto(`${s.ownerUrl}&project=${tp}`);
      await tpage.locator(`.clip[data-clip-id="${vclip}"]`).waitFor();
      const truler = (await tpage.getByTestId('ruler').boundingBox())!;

      // an FX track from the timeline's add-track buttons
      const r0 = (await tdoc()).revision;
      await tpage.getByTestId(TID.addTrackAdjustment).click();
      const fxTrack = await tuntil((d) => d.sequences.seq_main.tracks.some((t: any) => t.kind === 'adjustment'));
      await tpage.locator('.track.adjustment').first().waitFor({ timeout: 5000 }).catch(() => {});
      const fxLabel = await tpage.locator('.track.adjustment').first().getAttribute('aria-label').catch(() => null);
      check('adjustment layers: the timeline\'s add-track button adds an FX track in one transaction, shown as an adjustment track («התאמה»)', fxTrack && (await tdoc()).revision === r0 + 1 && /התאמה/.test(fxLabel ?? ''), { fxLabel });

      // "apply to: the whole edit" in the Look panel
      await tpage.locator(`.clip[data-clip-id="${vclip}"]`).click();
      await tpage.getByTestId(TID.applyToEdit).check();
      const r1 = (await tdoc()).revision;
      await tpage.getByTestId('effect-add').selectOption('color.grayscale');
      const made = await tuntil((d) => adjOf(d).length === 1 && adjOf(d)[0].effects?.[0]?.type === 'color.grayscale');
      const after1 = await tdoc();
      const ops1 = await opsSince(r1);
      const layer = adjOf(after1.project)[0];
      const covers = !!layer && fr(layer.start) === 0 && fr(layer.duration) === 90;
      const clipUntouched = !(clipOf(after1.project, vclip).effects?.length);
      await tpage.waitForFunction(() => !!document.querySelector('[data-testid=adjust-select]'), undefined, { timeout: 5000 }).catch(() => {});
      await tpage.getByTestId('effect-add').selectOption('light.vignette');
      const second = await tuntil((d) => adjOf(d).length === 1 && adjOf(d)[0].effects?.length === 2);
      const ops2 = await opsSince(after1.revision);
      check('"apply to: the whole edit" (Look panel): exactly 1 transaction containing add_adjustment over the whole edit with the effect on it, the clip itself untouched; a second effect joins the same layer (add_effect)', made && after1.revision === r1 + 1 && JSON.stringify(ops1) === '[["add_adjustment"]]' && covers && clipUntouched && second && JSON.stringify(ops2) === '[["add_effect"]]', { ops1, ops2, covers, clipUntouched });

      // the inspector of an adjustment clip: opacity only, mask, and "cover the whole edit"
      const adjId = adjOf((await tdoc()).project)[0].id as string;
      await tpage.locator(`.clip[data-clip-id="${adjId}"]`).click();
      await tpage.mouse.click(truler.x + 30.5, truler.y + 5); // frame 10, inside the layer
      await tpage.getByTestId(TID.adjustOpacity).waitFor({ timeout: 8000 });
      const panel = { opacity: await tpage.getByTestId(TID.adjustOpacity).count(), placeOrSize: await tpage.locator('[data-testid=transform-x], [data-testid=transform-y], [data-testid=transform-scale], [data-testid=transform-rotation]').count(), look: await tpage.getByTestId('look-panel').count(), mask: await tpage.getByTestId('mask-controls').count(), note: await tpage.getByTestId('adjust-note').count() };
      const before3 = adjOf((await tdoc()).project)[0];
      const r3 = (await tdoc()).revision;
      await tpage.getByTestId(TID.adjustOpacity).fill('0.5');
      await tpage.getByTestId(TID.adjustOpacity).dispatchEvent('pointerup');
      const op3 = await tuntil((d) => adjOf(d)[0]?.transform.opacity === 0.5);
      const after3 = adjOf((await tdoc()).project)[0];
      const ops3 = await opsSince(r3);
      const onlyOpacity = JSON.stringify({ ...before3, transform: { ...before3.transform, opacity: 0.5 } }) === JSON.stringify(after3);
      check('an adjustment clip\'s inspector offers its opacity (no place, size or turn), the Look panel and the mask; moving the opacity commits one opacity-only change (set_clip_transform; nothing else on the clip changes)', panel.opacity === 1 && panel.placeOrSize === 0 && panel.look === 1 && panel.mask === 1 && panel.note === 1 && op3 && onlyOpacity && JSON.stringify(ops3) === '[["set_clip_transform"]]', { panel, ops3, transform: after3?.transform });
      await txs(tp, [{ op: 'add_text', args: { text: 'סוף', start: f(90), duration: f(30) } }]); // the edit now ends at frame 120
      await tpage.waitForFunction(() => (document.querySelector('[data-testid=adjust-cover-edit]') as HTMLButtonElement | null)?.disabled === false, undefined, { timeout: 8000 }).catch(() => {});
      const r4 = (await tdoc()).revision;
      await tpage.getByTestId(TID.adjustCoverEdit).click();
      const coveredAll = await tuntil((d) => fr(adjOf(d)[0].start) === 0 && fr(adjOf(d)[0].duration) === 120);
      check('"cover the whole edit" stretches the layer to the new end of the edit (frame 120) in one transaction of trim_clip', coveredAll && JSON.stringify(await opsSince(r4)) === '[["trim_clip"]]', { ops: await opsSince(r4) });

      // replace media keeps the clip
      await tpage.locator(`.clip[data-clip-id="${vclip}"]`).click();
      const before5 = clipOf((await tdoc()).project, vclip);
      await tpage.getByTestId(TID.replaceMedia).click();
      const r5 = (await tdoc()).revision;
      await tpage.locator(`[data-testid=${TID.replaceMediaOption}][data-asset-id="${timgs[0]}"]`).click();
      const replaced = await tuntil((d) => clipOf(d, vclip)?.assetId === timgs[0]);
      const after5 = clipOf((await tdoc()).project, vclip);
      check('"Replace media…" commits replace_clip_media: the same clip id, place and length, now showing the chosen file', replaced && !!after5 && fr(after5.start) === fr(before5.start) && fr(after5.duration) === fr(before5.duration) && JSON.stringify(await opsSince(r5)) === '[["replace_clip_media"]]', { ops: await opsSince(r5) });

      // the Templates drawer
      const list = (await call('/templates')).body?.templates as any[] | undefined;
      await tpage.getByTestId('templates-toggle').click();
      await tpage.locator(`[data-testid=${TID.card}]`).first().waitFor({ timeout: 10000 }).catch(() => {});
      const cards = await tpage.locator(`[data-testid=${TID.card}]`).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-template-id'), available: e.getAttribute('data-available') === 'true', reason: e.querySelector('[data-testid=template-unavailable-reason]')?.textContent ?? null })));
      const he = dictionaries.he as Record<string, string>;
      const gatedOk = cards.filter((c) => !c.available).every((c) => { const model = list?.find((t) => t.id === c.id)?.needs?.model; return !!model && c.reason === he[`template.unavailable.${model}`]; });
      check('the Templates drawer lists 8 cards: the 6 built-ins, available, then Text-Behind-Subject and 3D-Zoom, unavailable with their Hebrew reason (template.unavailable.<model>)', cards.length === 8 && cards.filter((c) => c.available).length === 6 && cards.filter((c) => !c.available).map((c) => c.id).sort().join() === 'tpl.3d-zoom,tpl.text-behind-subject' && gatedOk, { cards });
      const chip = tpage.locator(`[data-testid=${TID.genreChip}]`).first();
      const genre = await chip.getAttribute('data-genre');
      await chip.click();
      const filtered = await tpage.locator(`[data-testid=${TID.card}]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-genre')));
      const pressed = await chip.getAttribute('aria-pressed');
      await chip.click();
      const unfiltered = await tpage.locator(`[data-testid=${TID.card}]`).count();
      check('a genre chip is an aria-pressed toggle that narrows the cards to its kind and, pressed again, shows them all', pressed === 'true' && filtered.length > 0 && filtered.every((g) => g === genre) && unfiltered === cards.length, { genre, filtered: filtered.length, unfiltered });

      // the keyboard-only flow: pick → order → music → Hebrew text → plan → use
      const pick = list?.find((t) => t.available && t.texts.length > 0 && t.needs.music !== 'none' && t.slots.every((x: any) => x.accept !== 'video')) ?? list?.find((t) => t.available && t.texts.length > 0) ?? list?.find((t) => t.available);
      const card = tpage.locator(`[data-testid=${TID.card}][data-template-id="${pick?.id}"]`);
      await card.focus();
      await tpage.keyboard.press('Enter');
      await tpage.getByTestId(TID.dialog).waitFor({ timeout: 8000 });
      const startsInside = await tpage.evaluate(() => !!document.querySelector('[data-testid=template-dialog]')?.contains(document.activeElement));
      await tpage.keyboard.press('Escape');
      await tpage.getByTestId(TID.dialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await sleep(100);
      const focusBack = await tpage.evaluate((id) => document.activeElement?.getAttribute('data-template-id') === id, pick?.id ?? '');
      const rf0 = (await tdoc()).revision;
      const projectionBefore = creativeProjection((await tdoc()).project);
      await card.focus();
      await tpage.keyboard.press('Enter');
      await tpage.getByTestId(TID.dialog).waitFor({ timeout: 8000 });
      const item = (id: string) => tpage.locator(`[data-testid=${TID.media}][data-asset-id="${id}"]`);
      const orderNow = () => tpage.locator(`[data-testid=${TID.media}]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-asset-id')));
      const order0 = await orderNow();
      await item(tvid.assetId).locator('input[type=checkbox]').focus();
      await tpage.keyboard.press('Space'); // the 4-second video stays out: still pictures only
      await item(timgs[2]!).getByTestId(TID.mediaEarlier).focus();
      await tpage.keyboard.press('Enter');
      await tpage.waitForFunction((id) => [...document.querySelectorAll('[data-testid=template-media]')].findIndex((e) => e.getAttribute('data-asset-id') === id) === 2, timgs[2], { timeout: 5000 }).catch(() => {});
      await tpage.keyboard.press('Enter'); // the focus stayed on the moved picture's button
      await tpage.waitForFunction((id) => [...document.querySelectorAll('[data-testid=template-media]')].findIndex((e) => e.getAttribute('data-asset-id') === id) === 1, timgs[2], { timeout: 5000 }).catch(() => {});
      const order1 = await orderNow();
      const videoOut = (await item(tvid.assetId).getAttribute('data-included')) === 'false';
      const next = async () => { await tpage.getByTestId('template-next').focus(); await tpage.keyboard.press('Enter'); };
      await next();
      const musicRadio = tpage.locator(`[data-testid=${TID.music}][data-asset-id="${tmusic.assetId}"]`);
      await musicRadio.waitFor({ timeout: 5000 }).catch(() => {});
      if (await musicRadio.count()) { await musicRadio.focus(); await tpage.keyboard.press('Space'); }
      const musicChosen = (await musicRadio.count()) ? await musicRadio.isChecked() : pick?.needs.music === 'none';
      await next();
      const firstText = tpage.getByTestId(TID.text).first();
      let textKey: string | null = null, counted: string | null = null;
      if (await firstText.count()) {
        await firstText.focus();
        await tpage.keyboard.type('יום הולדת שמח');
        textKey = await firstText.getAttribute('data-key');
        counted = await tpage.locator(`[data-testid=${TID.textCount}][data-key="${textKey}"]`).getAttribute('data-used');
      }
      await next();
      await tpage.waitForFunction(() => !!document.querySelector('[data-testid=template-plan-summary]') || !!document.querySelector('[data-testid=template-error]'), undefined, { timeout: 30000 }).catch(() => {});
      const planned = { summary: await tpage.getByTestId('template-plan-summary').count(), blocking: await tpage.getByTestId(TID.blocking).count(), error: (await tpage.getByTestId('template-error').count()) ? await tpage.getByTestId('template-error').textContent() : null, live: await tpage.getByTestId(TID.plan).getAttribute('aria-live') };
      await tpage.getByTestId(TID.use).focus();
      await tpage.keyboard.press('Enter');
      await tpage.getByTestId(TID.applied).waitFor({ timeout: 30000 }).catch(() => {});
      const appliedShown = (await tpage.getByTestId(TID.applied).count()) === 1 && (await tpage.getByTestId(TID.dialog).count()) === 0;
      await sleep(300);
      const afterApply = await tdoc();
      const applyOps = await opsSince(rf0);
      const hebrewOnTitle = afterApply.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).some((c: any) => c.type === 'text' && c.text.includes('יום הולדת שמח'));
      check('keyboard only, in Hebrew: a card opens the template dialog (focus inside), Escape closes it and the focus is back on the card; then pick → leave the video out and move a picture earlier → music → a Hebrew text (its counter counts it) → plan (a polite live region, nothing blocking) → Use adds exactly 1 revision (apply_template) with that text on a title, and the post-apply bar appears',
        !!pick && startsInside && focusBack && JSON.stringify(order1) === JSON.stringify([order0[0], timgs[2], ...order0.slice(1).filter((x) => x !== timgs[2])]) && videoOut && musicChosen && (textKey === null || counted === '13') && planned.summary === 1 && planned.blocking === 0 && planned.live === 'polite' && appliedShown && afterApply.revision === rf0 + 1 && JSON.stringify(applyOps) === '[["apply_template"]]' && (textKey === null || hebrewOnTitle),
        { template: pick?.id, order0, order1, videoOut, musicChosen, textKey, counted, planned, applyOps, hebrewOnTitle, beats: measured.body?.beats ?? null });
      const projectionApplied = creativeProjection(afterApply.project);
      await tpage.getByTestId(TID.shuffle).focus();
      await tpage.keyboard.press('Enter');
      const revisionReaches = async (want: number, ms = 20000) => { const t0 = Date.now(); for (;;) { if ((await tdoc()).revision >= want) return true; if (Date.now() - t0 > ms) return false; await sleep(150); } };
      const shuffled = await revisionReaches(afterApply.revision + 1);
      await sleep(300);
      const afterShuffle = await tdoc();
      check('Shuffle on the post-apply bar (regenerate with the next seed, shuffled) adds exactly 1 revision', shuffled && afterShuffle.revision === afterApply.revision + 1, { ops: await opsSince(afterApply.revision) });
      await tpage.getByTestId('template-undo').click();
      const undoShuffle = await tuntil((d) => creativeProjection(d) === projectionApplied, 10000);
      await tpage.getByTestId('undo').click();
      const undoApply = await tuntil((d) => creativeProjection(d) === projectionBefore, 10000);
      check('undo restores an equal creativeProjection: once after Shuffle (the applied template), once more after Use (the project before the template)', undoShuffle && undoApply, { undoShuffle, undoApply });

      // Welcome: a fourth way in
      const wp = (await call('/projects', { name: 'welcome', width: 640, height: 360 })).body.project.id as string;
      await tpage.goto(`${s.ownerUrl}&project=${wp}`);
      await tpage.getByTestId(TID.welcomeTemplate).waitFor({ timeout: 10000 });
      await tpage.getByTestId(TID.welcomeTemplate).click();
      await tpage.locator(`[data-testid=${TID.card}]`).first().waitFor({ timeout: 10000 }).catch(() => {});
      const opened = (await tpage.getByTestId('templates-toggle').getAttribute('aria-expanded')) === 'true';
      await sleep(100);
      const cardFocused = await tpage.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'template-card');
      check('Welcome (an empty project) offers «התחל מתבנית», which opens the Templates drawer with the focus on its first card', opened && cardFocused, { opened, cardFocused });
      check('no uncaught errors in the page with the adjustment and template controls', tErrors.length === 0, tErrors.slice(0, 4));
      await tctx.close();
    }

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
