/**
 * Editor interactions that were built but not yet exercised in a real browser (listed as unverified in docs/PROGRESS.md):
 * canvas drag that creates a format-only override, hide-in-format, clip moves snapping to beats, manual beat edits at the
 * playhead, the batch-export job list, and the level meter during playback. The visual wave's look panel (ADR-0011): the ♪
 * beat toggle with its fieldset and undo, the date-stamp field with its inline refusal, and the time-first separator.
 * Motion tracking (ADR-0015): a point picked with the keyboard only, an area picked by dragging, tracking progress that rises
 * and Stop, a title attached to a track without a jump, a handle drag on that follower, and the preview against the still.
 * Adjustment layers and templates (ADR-0016): the FX track, "apply to: the whole edit", the opacity-only inspector and
 * "cover the whole edit", "Replace media…", the Templates drawer and a keyboard-only template flow with Shuffle and undo.
 * The trend pack's transition options (ADR-0012): beat lock and a ×2 velocity ramp set from the keyboard, each one undo step, with the
 * Hebrew status line in a live region and the velocity choices the clips cannot take shown disabled with what they need.
 * Wave 6 notes, each seen in a real browser: the Templates bar's «החזרת החלקים שנמחקו» after a hand delete (left out by a
 * regeneration, made again by the button, each step one exact undo; after a Delete that closes the gap the pictures it moved
 * are made again on their slots and the bar says so), the transcript panel's note that names a clip showing an
 * untimed copy the cut left alone (Hebrew and English), and the archive import's note about cleared review marks (shown once, kept
 * until closed). The untimed copy and the translation are typed fixtures: no provider and no model ran.
 * Still not covered here: audible fades/ducking during live playback (only the offline WebAudio chain is measured).
 *   pnpm build && pnpm proof:editor-interactions
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { generateTrackingFixture, trackingTruth } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { BEAT_SR } from '../../../apps/server/src/beats.ts';
import { drumLoop } from '../../../apps/server/src/beats.fixtures.ts';
import { dictionaries, effectParamLabel, translateRefusal, fillIn, TREND_PACK_HE } from '../../i18n/src/index.ts';
import { creativeProjection, beatSwitchFrame, BUILTIN_TEMPLATES, MODEL_GATED_TEMPLATES, PACKS, removedByHand, sha256Hex, velocityNeeds, type MediaClip, type ProjectDocument } from '@pulseframe/core';
import { TEMPLATE_TESTIDS } from '../../../apps/web/src/editor/templates.testids.ts';
import { chooseFormat, startExport } from './editor-ui.ts';
import { libraryPanelsProbe } from './library-proof.ui.ts';
import { toastAfterModal, toastInOpenModal } from './a11y-lib.ts';
import { generateShortsFixture } from '../../fixtures/src/shorts.ts';
import { SHORTS_TESTIDS } from '../../../apps/web/src/editor/shorts.testids.ts';
import { PERFORM_TESTIDS } from '../../../apps/web/src/editor/perform/perform.testids.ts';
import { PEOPLE_TESTIDS } from '../../../apps/web/src/editor/lifeline/people.testids.ts';
import { TEMPLATE_STRINGS } from '../../../apps/web/src/editor/templates.strings.ts';
import { IMPORTED_REVIEW_CLEARED } from '../../../apps/server/src/archive.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/editor-interactions');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
/**
 * A toast raised while one of the editor's own modals is open (its own focus trap): the modal is open with its focus inside. The toast
 * must be inside the modal and focusable by Tab (toastInOpenModal), and Escape typed on the toast's × closes the modal as it does
 * from anywhere else in it (the design system Dialog's rule), after which the toast region is the page's again.
 */
const modalToastCheck = async (p: Page, what: string, dialogTestId: string) => {
  const lang = (await p.evaluate(() => document.documentElement.lang)) === 'en' ? 'en' : 'he';
  const r = await toastInOpenModal(p, lang, dialogTestId);
  await p.keyboard.press('Escape');
  await p.getByTestId(dialogTestId).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  const closed = (await p.getByTestId(dialogTestId).count()) === 0;
  const after = await toastAfterModal(p);
  check(`a toast raised while ${what} is open is inside it (in its own toast region), one status only, in the accessibility tree and on screen; Tab reaches the toast's action and its × without leaving the modal and wraps back into it; Escape typed on the × closes the modal, and the region is the page's again`,
    r.shown === true && closed && after.toastBackOnPage, { ...r, closed, ...after });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until2 = async (get: () => Promise<any>, pred: (d: any) => boolean, ms = 20000) => { const t0 = Date.now(); for (;;) { if (pred(await get())) return true; if (Date.now() - t0 > ms) return false; await sleep(150); } };
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
    const doc2 = async (id: string) => (await call(`/projects/${id}`)).body.project;
    const clipOf = (d: any, id: string) => d.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((c: any) => c.id === id);
    const until = async (pred: (d: any) => boolean, ms = 8000) => { const t = Date.now(); for (;;) { const d = await doc(); if (pred(d)) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

    const page = await (await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    await page.addInitScript('globalThis.__name = (f) => f');
    await page.addInitScript(() => { (globalThis as { __pfToastProof?: boolean }).__pfToastProof = true; }); // the toast hook (window.__pfToast), as the a11y audit sets it
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() === 409) void r.text().then((b) => console.log('  409:', r.request().method(), new URL(r.url()).pathname, (r.request().postData() ?? '').slice(0, 300), b.slice(0, 300))).catch(() => {}); });
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('deliver-panel').waitFor();

    console.log('\n# format-only override by dragging on the canvas; hide in format');
    await chooseFormat(page, tall);
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
    await chooseFormat(page, '');

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
    await chooseFormat(page, tall);
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
    await chooseFormat(page, '');
    const scopeMaster = (await page.locator('[data-testid=transform-scope]').getAttribute('data-scope')) === 'master';
    check('while a format is viewed, the Inspector scale slider writes a format-only override (master unchanged), keyframe buttons are disabled, and "reset to master" removes the override; back on the master the controls edit the master again', sliderOverride && masterKept && kfDisabled && resetOk && scopeMaster, { sliderOverride, masterKept, kfDisabled, resetOk, scopeMaster });

    console.log('\n# title wording for one format only');
    const frameBytes = async (variant?: string) => Buffer.from(await (await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=20${variant ? `&variant=${variant}` : ''}`, { headers: h })).arrayBuffer());
    const sq = Object.values((await doc()).variants as Record<string, any>).find((v: any) => v.name === 'Square').id as string;
    const wBefore = { master: await frameBytes(), tall: await frameBytes(tall), sq: await frameBytes(sq) };
    await page.locator(`.clip[data-clip-id="${title}"]`).click();
    await chooseFormat(page, tall);
    await page.getByTestId('text-format-note').waitFor();
    const hintBefore = (await page.getByTestId('text-format-reset').count()) === 0;
    await page.getByTestId('text-content').fill('קצר');
    await page.getByTestId('text-content').blur();
    const wordingSet = await until((x2) => x2.variants[tall].overrides[title]?.text === 'קצר' && clipOf(x2, title).text === 'כותרת');
    await page.getByTestId('text-format-reset').waitFor();
    const wAfter = { master: await frameBytes(), tall: await frameBytes(tall), sq: await frameBytes(sq) };
    await chooseFormat(page, '');
    const masterField = await page.getByTestId('text-content').inputValue();
    await chooseFormat(page, tall);
    const tallField = await page.getByTestId('text-content').inputValue();
    await page.getByTestId('text-format-reset').click();
    const wordingCleared = await until((x2) => !x2.variants[tall].overrides[title]);
    await page.waitForFunction(() => (document.querySelector('[data-testid=text-content]') as HTMLTextAreaElement | null)?.value === 'כותרת', undefined, { timeout: 5000 }).catch(() => {});
    const fieldBack = await page.getByTestId('text-content').inputValue();
    const wRestored = await frameBytes(tall);
    await chooseFormat(page, '');
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
    {
      // keyframe curves (ADR-0019): one diamond per distinct key frame, effect keys included, on the keyframe strip of the
      // selected clip and as passive diamonds once it is not selected. x keys: one on the frame of the first radius key, one apart.
      const radiusFrames = keys.map((k: any) => fr(k.time));
      await txs(pid, [{ op: 'set_keyframe', args: { clipId: picClip, property: 'x', time: f(radiusFrames[0] ?? 5), value: 0, easing: 'linear' } }, { op: 'set_keyframe', args: { clipId: picClip, property: 'x', time: f((radiusFrames[0] ?? 5) + 3), value: 0.05, easing: 'linear' } }]);
      const pc = clipOf(await doc(), picClip);
      const len = fr(pc.duration);
      const all = [...Object.values(pc.keyframes ?? {}).flat(), ...(pc.effects ?? []).flatMap((e: any) => Object.values(e.keyframes ?? {}).flat())] as any[];
      const distinct = [...new Set(all.map((k) => fr(k.time)).filter((x) => x >= 0 && x <= len))].sort((a, b) => a - b);
      await page.locator(`.clip[data-clip-id="${picClip}"]`).click();
      await page.locator('[data-testid=key-strip-key]').first().waitFor({ timeout: 5000 }).catch(() => {});
      const stripFrames = (await page.locator('[data-testid=key-strip-key]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-frame'))))).sort((a, b) => a - b);
      // keyboard only: Alt+K puts the focus on the strip, Enter on a key opens the curve picker with the focus inside, Escape closes it
      // and gives the focus back to the same key; nothing is committed on the way
      const focused = () => page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { id: a?.dataset.testid ?? null, frame: a?.dataset.frame ?? null, inPicker: !!a?.closest('[data-testid=curve-picker]') }; });
      const revK = (await call(`/projects/${pid}`)).body.revision as number;
      await page.locator(`.clip[data-clip-id="${picClip}"]`).focus();
      await page.keyboard.press('Alt+KeyK');
      const afterAltK = await focused();
      await page.keyboard.press('Enter');
      await page.getByTestId('curve-picker').waitFor({ timeout: 5000 }).catch(() => {});
      const pickerOpen = (await page.getByTestId('curve-picker').count()) === 1;
      const inPicker = await focused();
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('[data-testid=curve-picker]'), undefined, { timeout: 5000 }).catch(() => {});
      const afterEsc = await focused();
      const revK2 = (await call(`/projects/${pid}`)).body.revision as number;
      check('keyframe strip by keyboard: Alt+K focuses a strip key, Enter opens the curve picker with the focus inside, Escape closes it and the focus is back on the same key; no commit', afterAltK.id === 'key-strip-key' && pickerOpen && inPicker.inPicker && (await page.getByTestId('curve-picker').count()) === 0 && afterEsc.id === 'key-strip-key' && afterEsc.frame === afterAltK.frame && revK2 === revK, { afterAltK, pickerOpen, inPicker, afterEsc, revisions: [revK, revK2] });
      // a toast raised while the curve picker, the effect gallery and the command palette are open
      await page.locator(`.clip[data-clip-id="${picClip}"]`).focus();
      await page.keyboard.press('Alt+KeyK');
      await page.keyboard.press('Enter');
      await page.getByTestId('curve-picker').waitFor({ timeout: 5000 }).catch(() => {});
      await modalToastCheck(page, 'the curve picker', 'curve-picker');
      await page.locator(`.clip[data-clip-id="${picClip}"]`).click();
      await page.getByTestId('gallery-open').click({ timeout: 8000 }).catch(() => {});
      await page.getByTestId('effect-gallery').waitFor({ timeout: 8000 }).catch(() => {});
      await modalToastCheck(page, 'the effect gallery', 'effect-gallery');
      await page.getByTestId('open-palette').click();
      await page.getByTestId('palette-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      await modalToastCheck(page, 'the command palette', 'palette-dialog');
      await page.locator(`.clip[data-clip-id="${title}"]`).click();
      await page.waitForFunction((id) => document.querySelectorAll(`.clip[data-clip-id="${id}"] i.kf`).length > 0, picClip, { timeout: 5000 }).catch(() => {});
      const passive = await page.locator(`.clip[data-clip-id="${picClip}"] i.kf`).count();
      check('keyframe diamonds: the selected clip\'s keyframe strip and its passive diamonds once unselected each show one diamond per distinct key frame, effect keys included (an x key on the frame of a radius key counts once)', distinct.length === 3 && all.length === 4 && JSON.stringify(stripFrames) === JSON.stringify(distinct) && passive === distinct.length, { distinct, keys: all.length, stripFrames, passive });
      await txs(pid, [{ op: 'replace_clip_keyframes', args: { clipId: picClip, property: 'x', keys: null } }]);
    }
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
    // Shift+Delete keeps the gap: a new project ripples on Delete (owner decision 2026-11-17), and this check is about a
    // multi-selection removed in one transaction with the third clip left where it was
    await mpage.keyboard.press('Shift+Delete');
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
      await vctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
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

    console.log('\n# motion tracking (ADR-0015): keyboard pick, box drag, progress and Stop, a title that follows without a jump, a handle drag on it, preview against still');
    {
      // the synthetic tracking fixture (a textured disc; no real face) at speed 2, so timeline frame t shows source frame 2t
      const tfx = await generateTrackingFixture({ out: path.join(art, 'tracking.mp4') });
      const longFile = path.join(art, 'long.mp4');
      ff(['-f', 'lavfi', '-t', '60', '-i', 'testsrc2=s=640x360:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', longFile]);
      const tp = (await call('/projects', { name: 'tracking', width: 1280, height: 720 })).body.project.id as string;
      const ta = await upload(tp, tfx.file);
      const tadd = await txs(tp, [{ op: 'add_clip', args: { assetId: ta.assetId, start: f(0), withLinkedAudio: false } }]);
      const vclip = tadd.results[0].output.clipId as string, vtrack = tadd.results[0].output.trackId as string;
      await txs(tp, [{ op: 'set_clip_speed', args: { clipId: vclip, speed: 2 } }]);
      const tdoc = async () => (await call(`/projects/${tp}`)).body.project;
      const tuntil = async (pred: (d: any) => boolean, ms = 10000) => { const t0 = Date.now(); for (;;) { const d2 = await tdoc(); if (pred(d2)) return d2; if (Date.now() - t0 > ms) return null; await sleep(100); } };
      const tracksNow = (d2: any) => Object.values(d2?.motionTracks ?? {}) as any[];
      const tjob = async (id: string, ms = 120000) => { const t0 = Date.now(); for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status) || Date.now() - t0 > ms) return j; await sleep(100); } };
      const tctx = await browser.newContext({ viewport: { width: 1500, height: 1800 }, reducedMotion: 'reduce' });
      await tctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const tpage = await tctx.newPage();
      const tErrors: string[] = [];
      tpage.on('pageerror', (e) => tErrors.push(String(e)));
      await tpage.goto(`${s.ownerUrl}&project=${tp}`);
      const seek = async (frame: number) => {
        await tpage.evaluate((x) => { const el = document.querySelector('[data-testid=ruler]')!; const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + x, clientY: r.top + 5, bubbles: true })); }, (frame / 30) * 90 + 0.5);
        await tpage.waitForFunction((t) => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return c?.dataset.frame === String(t) && c?.dataset.quality === 'full'; }, frame, { timeout: 15000 }).catch(() => {});
      };
      await tpage.locator(`.clip[data-clip-id="${vclip}"]`).click();
      await seek(30); // source frame 60
      await tpage.getByTestId('mtrack-new-point').waitFor({ timeout: 10000 });

      // 1. a point picked with the keyboard only: the button by Enter, the pick moved by arrows, confirmed by Enter
      await tpage.getByTestId('mtrack-new-point').focus();
      await tpage.keyboard.press('Enter');
      await tpage.getByTestId('track-picker').waitFor({ timeout: 5000 });
      await tpage.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'track-picker', undefined, { timeout: 5000 }).catch(() => {});
      const pickerFocused = await tpage.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'track-picker');
      for (let i = 0; i < 10; i++) await tpage.keyboard.press('Shift+ArrowRight');
      for (let i = 0; i < 5; i++) await tpage.keyboard.press('ArrowDown');
      const said = ((await tpage.getByTestId('track-picker-live').textContent()) ?? '').trim();
      await tpage.keyboard.press('Enter');
      const afterPoint = await tuntil((d2) => tracksNow(d2).length === 1);
      const pt = tracksNow(afterPoint)[0];
      await tpage.getByTestId('track-picker').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await tpage.waitForFunction(() => document.activeElement?.getAttribute('data-testid') === 'mtrack-new-point', undefined, { timeout: 3000 }).catch(() => {});
      const focusBack = await tpage.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null);
      const status = ((await tpage.getByTestId('mtrack-status').textContent().catch(() => '')) ?? '').trim();
      const wantPoint = { kind: 'point', from: 60, x: Math.round((740 / 1280) * 1e4), y: Math.round((365 / 720) * 1e4) };
      check('tracking, keyboard only: the "new point" button opens the picker with the focus on the picture; ten Shift+→ and five ↓ move the pick 100 and 5 frame pixels from the centre, announced in Hebrew; Enter commits create_motion_track at the SOURCE frame the playhead shows (60 at timeline frame 30, speed 2); the focus goes back and the panel says so', pickerFocused && !!pt && pt.kind === wantPoint.kind && pt.from === wantPoint.from && pt.x[0] === wantPoint.x && pt.y[0] === wantPoint.y && /[א-ת]/.test(said) && focusBack === 'mtrack-new-point' && /[א-ת]/.test(status), { got: pt && { kind: pt.kind, from: pt.from, x: pt.x[0], y: pt.y[0] }, want: wantPoint, said, focusBack, status });

      // 2. an area picked by dragging over the disc of source frame 60
      const disc = trackingTruth(60);
      await tpage.getByTestId('mtrack-new-region').click();
      await tpage.getByTestId('track-picker').waitFor({ timeout: 5000 });
      const cb = (await tpage.getByTestId('preview').boundingBox())!;
      const k = cb.width / 1280;
      const A = { x: cb.x + (disc.cx - disc.r) * k, y: cb.y + (disc.cy - disc.r) * k }, B = { x: cb.x + (disc.cx + disc.r) * k, y: cb.y + (disc.cy + disc.r) * k };
      await tpage.mouse.move(A.x, A.y);
      await tpage.mouse.down();
      await tpage.mouse.move((A.x + B.x) / 2, (A.y + B.y) / 2, { steps: 4 });
      await tpage.mouse.move(B.x, B.y, { steps: 4 });
      await tpage.mouse.up();
      const markKind = await tpage.getByTestId('track-picker-mark').getAttribute('data-kind').catch(() => null);
      await tpage.getByTestId('track-picker-confirm').click();
      const afterBox = await tuntil((d2) => tracksNow(d2).length === 2);
      const box = tracksNow(afterBox).find((x) => x.kind === 'region');
      const want = { x: (disc.cx / 1280) * 1e4, y: (disc.cy / 720) * 1e4, w: ((2 * disc.r) / 1280) * 1e4, h: ((2 * disc.r) / 720) * 1e4 };
      const tol = 2 * (1e4 / 720); // two frame pixels
      check('tracking, box drag: dragging over the disc picks an area; confirming commits a region track whose centre and size are the dragged box in 1/10000 of the picture (within 2 frame pixels), on source frame 60', markKind === 'region' && !!box && box.from === 60 && Math.abs(box.x[0] - want.x) <= tol && Math.abs(box.y[0] - want.y) <= tol && Math.abs(box.box?.w - want.w) <= tol && Math.abs(box.box?.h - want.h) <= tol, { got: box && { x: box.x[0], y: box.y[0], box: box.box, from: box.from }, want: { x: Math.round(want.x), y: Math.round(want.y), w: Math.round(want.w), h: Math.round(want.h) }, markKind });

      // 3. progress that rises, then Stop: a minute of moving test picture after the fixture on the same track
      const la = await upload(tp, longFile);
      const lc = (await txs(tp, [{ op: 'add_clip', args: { assetId: la.assetId, start: f(130), trackId: vtrack, withLinkedAudio: false } }])).results[0].output.clipId as string;
      const lt = (await txs(tp, [{ op: 'create_motion_track', args: { assetId: la.assetId, name: 'ארוך', kind: 'region', frame: 0, x: 5000, y: 5000, w: 2000, h: 2000 } }])).results[0].output.motionTrackId as string;
      await tpage.locator(`.clip[data-clip-id="${lc}"]`).click({ position: { x: 20, y: 10 } });
      const item = tpage.locator(`[data-testid=mtrack-item][data-motion-track-id="${lt}"]`);
      await item.waitFor({ timeout: 10000 });
      await item.getByTestId('mtrack-run').click();
      const seen: number[] = [];
      let role: string | null = null, valueText = '';
      for (let t0 = Date.now(); Date.now() - t0 < 30000;) {
        const bar = item.getByTestId('mtrack-progress');
        if (await bar.count()) {
          const v = await bar.getAttribute('aria-valuenow').catch(() => null);
          role = await bar.getAttribute('role').catch(() => role);
          valueText = (await bar.getAttribute('aria-valuetext').catch(() => null)) ?? valueText;
          if (v !== null && Number(v) !== seen.at(-1)) seen.push(Number(v));
          if (seen.length >= 2 && seen.at(-1)! > seen[0]!) break;
        }
        await sleep(100);
      }
      await item.getByTestId('mtrack-stop').click().catch(() => {});
      await tpage.waitForFunction((id) => document.querySelector(`[data-testid=mtrack-item][data-motion-track-id="${id}"] [data-testid=mtrack-job-status]`)?.getAttribute('data-status') === 'canceled', lt, { timeout: 15000 }).catch(() => {});
      const jobStatus = await item.getByTestId('mtrack-job-status').getAttribute('data-status').catch(() => null);
      const ltNow = (await tdoc()).motionTracks?.[lt];
      check('tracking, progress and Stop: "Track" starts the job; the role=progressbar rises (aria-valuenow), its value text is the stage in Hebrew; "Stop" ends it canceled and nothing is attached', role === 'progressbar' && seen.length >= 2 && seen.at(-1)! > seen[0]! && /עוקב|קורא/.test(valueText) && jobStatus === 'canceled' && ltNow?.st.length === 1, { seen, role, valueText, jobStatus, samples: ltNow?.st.length });

      // 4. a magenta title attached to the tracked area without a jump (stills of timeline frame 30, before and after)
      const run = await call(`/projects/${tp}/motion-tracks/${box?.id}/track`, {});
      const tracked = run.status === 202 ? await tjob(run.body.jobId) : { status: `refused ${run.status}` };
      const title = (await txs(tp, [{ op: 'add_text', args: { text: 'מעקב', start: f(0), duration: f(120), style: { color: '#ff00ff', sizeFrac: 0.06, stroke: null, background: null }, transform: { x: 0.1, y: -0.15 } } }])).results[0].output.clipId as string;
      const stillPng = async (index: number) => { const r = await fetch(`${s.url}/api/v1/projects/${tp}/frame?index=${index}`, { headers: h }); return Buffer.from(await r.arrayBuffer()); };
      const magentaOf = (rgb: Uint8Array, w: number, hgt: number, stride = 3) => { let n = 0, sx = 0, sy = 0; for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * stride; if (rgb[i]! > 150 && rgb[i + 2]! > 150 && rgb[i + 1]! < 110) { n++; sx += x + 0.5; sy += y + 0.5; } } return n ? { x: sx / n, y: sy / n } : null; };
      const stillMagenta = async (index: number) => magentaOf(execFileSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: await stillPng(index), maxBuffer: 1 << 26 }), 1280, 720);
      const before = await stillMagenta(30);
      await tpage.locator(`.clip[data-clip-id="${title}"]`).click();
      await seek(30);
      const opt = `${box?.id}|${vtrack}`;
      await tpage.getByTestId('follow-track').waitFor({ timeout: 10000 });
      await tpage.getByTestId('follow-track').selectOption(opt).catch(() => {});
      await tpage.getByTestId('follow-attach').click();
      const attached = await tuntil((d2) => !!d2.sequences.seq_main.tracks.flatMap((t2: any) => t2.clips).find((c: any) => c.id === title)?.follow);
      const after = await stillMagenta(30);
      const jump = before && after ? Math.hypot(after.x - before.x, after.y - before.y) : Infinity;
      check('tracking, follow: after tracking the area, "attach without a jump" on a magenta title commits set_clip_follow with an offset that keeps it where it was: its centre on the still of the same frame moves at most 1 px', tracked.status === 'succeeded' && !!attached && jump <= 1, { tracked: tracked.status, jumpPx: Number(jump.toFixed(3)), before, after });

      // 5. a handle drag on the follower writes its offset (Δ/m, m = 1 here): the still moves by the drag
      await tpage.waitForFunction(() => !!document.querySelector('[data-testid=canvas-handles] [data-handle=move]'), undefined, { timeout: 8000 }).catch(() => {});
      const mv = tpage.locator('[data-testid=canvas-handles] [data-handle=move]');
      const mb = (await mv.boundingBox())!;
      const own0 = attached?.sequences.seq_main.tracks.flatMap((t2: any) => t2.clips).find((c: any) => c.id === title)?.transform;
      await tpage.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
      await tpage.mouse.down();
      await tpage.mouse.move(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 + 30, { steps: 6 });
      await tpage.mouse.up();
      const moved = await tuntil((d2) => { const c = d2.sequences.seq_main.tracks.flatMap((t2: any) => t2.clips).find((x: any) => x.id === title); return !!own0 && !!c && (c.transform.x !== own0.x || c.transform.y !== own0.y); });
      const own1 = moved?.sequences.seq_main.tracks.flatMap((t2: any) => t2.clips).find((c: any) => c.id === title)?.transform;
      const dragged = await stillMagenta(30);
      const shift = after && dragged ? { x: dragged.x - after.x, y: dragged.y - after.y } : null;
      const wantShift = { x: 40 / k, y: 30 / k };
      const stillFollows = !!moved?.sequences.seq_main.tracks.flatMap((t2: any) => t2.clips).find((c: any) => c.id === title)?.follow;
      check('tracking, handle drag on a follower: dragging its move handle by 40×30 screen px changes its own offset by that fraction of the frame and moves it on the still by 40/k × 30/k frame px (within 2 px); it still follows', !!own0 && !!own1 && Math.abs(own1.x - own0.x - 40 / cb.width) < 0.004 && Math.abs(own1.y - own0.y - 30 / cb.height) < 0.004 && !!shift && Math.hypot(shift.x - wantShift.x, shift.y - wantShift.y) <= 2 && stillFollows, { own0: own0 && { x: own0.x, y: own0.y }, own1: own1 && { x: own1.x, y: own1.y }, shift: shift && { x: Number(shift.x.toFixed(2)), y: Number(shift.y.toFixed(2)) }, wantShift: { x: Number(wantShift.x.toFixed(2)), y: Number(wantShift.y.toFixed(2)) } });

      // 6. the editor preview puts the follower where the still does
      await sleep(500);
      await seek(31);
      await seek(30);
      const preview = await tpage.evaluate(() => {
        const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0, sx = 0, sy = 0;
        for (let y = 0, i = 0; y < c.height; y++) for (let x = 0; x < c.width; x++, i += 4) if (d[i]! > 150 && d[i + 2]! > 150 && d[i + 1]! < 110) { n++; sx += x + 0.5; sy += y + 0.5; }
        return n ? { x: (sx / n) * (1280 / c.width), y: (sy / n) * (720 / c.height) } : null;
      });
      const pv = preview && dragged ? Math.hypot(preview.x - dragged.x, preview.y - dragged.y) : Infinity;
      check('tracking, preview: the follower\'s centre in the editor preview is within 2 px of the still of the same frame (one evaluator); no page errors', pv <= 2 && tErrors.length === 0, { px: Number(pv.toFixed(3)), preview, still: dragged, errors: tErrors.slice(0, 3) });
      await tctx.close();
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
      await tctx.addInitScript('globalThis.__name = (f) => f');
      await tctx.addInitScript(() => { (globalThis as { __pfToastProof?: boolean }).__pfToastProof = true; }); // the toast hook (window.__pfToast)
      await tctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
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
      await tpage.getByTestId('rail-templates').click(); // the Templates drawer is mounted in the rail's Templates category (UX_REDESIGN §4.3)
      if ((await tpage.getByTestId('templates-toggle').getAttribute('aria-expanded')) !== 'true') await tpage.getByTestId('templates-toggle').click();
      await tpage.locator(`[data-testid=${TID.card}]`).first().waitFor({ timeout: 10000 }).catch(() => {});
      const cards = await tpage.locator(`[data-testid=${TID.card}]`).evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-template-id'), genre: e.getAttribute('data-genre'), available: e.getAttribute('data-available') === 'true', reason: e.querySelector('[data-testid=template-unavailable-reason]')?.textContent ?? null })));
      const he = dictionaries.he as Record<string, string>;
      const gatedOk = cards.filter((c) => !c.available).every((c) => { const model = list?.find((t) => t.id === c.id)?.needs?.model; return !!model && c.reason === he[`template.unavailable.${model}`]; });
      // what the drawer should list (content-pack plan §UI: the drawer has the pack templates, with the genre chip «חג»): the built-ins, then each
      // pack's own templates in pack order, then the two model-gated ones; ids and genres from core, not counted by hand
      const packTpls = PACKS.flatMap((p) => p.templates.map((t) => ({ id: t.id, genre: t.genre, pack: p.id })));
      const want = [...BUILTIN_TEMPLATES.map((t) => ({ id: t.id, genre: t.genre, available: true })), ...packTpls.map((t) => ({ id: t.id, genre: t.genre, available: true })), ...MODEL_GATED_TEMPLATES.map((t) => ({ id: t.id, genre: t.genre, available: false }))];
      const drawerOk = BUILTIN_TEMPLATES.length === 6 && packTpls.length > 0 && MODEL_GATED_TEMPLATES.map((t) => t.id).sort().join() === 'tpl.3d-zoom,tpl.text-behind-subject'
        && JSON.stringify(cards.map((c) => ({ id: c.id, genre: c.genre, available: c.available }))) === JSON.stringify(want)
        && cards.filter((c) => c.available).every((c) => c.reason === null) && gatedOk;
      check(`the Templates drawer lists ${want.length} cards in order: the 6 built-ins, available, then the content packs' ${packTpls.length} templates (${PACKS.map((p) => p.id).join(', ')}), available, each with its genre from core, then Text-Behind-Subject and 3D-Zoom, unavailable with their Hebrew reason (template.unavailable.<model>)`, drawerOk, { cards, want: want.map((w) => w.id) });
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
      await modalToastCheck(tpage, 'the template dialog', TID.dialog);
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
      // a hand delete survives regeneration, and «החזרת החלקים שנמחקו» is the way back (ADR-0016 decision 6; wave 6)
      {
        const S = TEMPLATE_STRINGS.he;
        const bar = tpage.getByTestId(TID.applied), restoreBtn = tpage.getByTestId('template-restore-removed'), barAlert = bar.locator('[role=alert]');
        const said = async () => ((await bar.locator('[role=status]').textContent()) ?? '').replace(/[⁦-⁩]/g, '');
        const runNow = async () => (await bar.getAttribute('data-run-id')) ?? '';
        const slotsOf = (d: any, runId: string) => (Object.hasOwn(d.recipeRuns ?? {}, runId) ? d.recipeRuns[runId].slots ?? [] : []) as { clipId: string }[];
        const run0 = await runNow();
        const slots0 = slotsOf(afterShuffle.project, run0);
        const pShuffled = creativeProjection(afterShuffle.project);
        // the item deleted by hand: a picture of the run that the timeline shows
        const victim = slots0.map((x) => x.clipId).find((id) => clipOf(afterShuffle.project, id)?.type === 'media') ?? slots0[0]?.clipId ?? '';
        const offeredBefore = await restoreBtn.count();

        // (1) Delete, as a new project has it: the gap is closed (ripple delete), so the later pictures move earlier. A clip whose
        // only change is its place is not edited by hand (ADR-0016 decision 6, amendment of 2026-11-24): the regeneration makes it
        // again on its slot and the bar says so. First Shuffle (the deleted picture left out), then the button (made again).
        type Slot = { key: string; kind: string; clipId: string };
        /** Where each live picture slot of a run lies: key -> [start frame, frames]. */
        const places = (d: any, runId: string) => Object.fromEntries((slotsOf(d, runId) as unknown as Slot[]).filter((x) => x.kind === 'picture' && clipOf(d, x.clipId)).map((x) => [x.key, [fr(clipOf(d, x.clipId).start), fr(clipOf(d, x.clipId).duration)]] as [string, number[]]).sort(([x], [y]) => (x < y ? -1 : 1)));
        const waitSaid = (want: string) => tpage.waitForFunction((w) => (document.querySelector('[data-testid=template-applied] [role=status]')?.textContent ?? '').replace(/[\u2066-\u2069]/g, '').includes(w), want, { timeout: 10000 }).catch(() => {});
        const places0 = places(afterShuffle.project, run0);
        const victimKey = (slots0 as unknown as Slot[]).find((x) => x.clipId === victim)?.key ?? '';
        const rest0 = Object.fromEntries(Object.entries(places0).filter(([k]) => k !== victimKey));
        await tpage.locator(`.clip[data-clip-id="${victim}"]`).click();
        await tpage.keyboard.press('Delete');
        const rDeleted = await tuntil((d) => !clipOf(d, victim));
        await restoreBtn.waitFor({ timeout: 8000 }).catch(() => {});
        const rOffered = { count: await restoreBtn.count(), text: await restoreBtn.textContent().catch(() => null) };
        const afterRipple = await tdoc();
        const rippleOps = await opsSince(afterShuffle.revision);
        const placesRippled = places(afterRipple.project, run0);
        const movedKeys = Object.keys(rest0).filter((k) => JSON.stringify(placesRippled[k]) !== JSON.stringify(rest0[k]));
        // Shuffle: one revision; the deleted picture is left out; the pictures the delete moved are back on their slots; both said
        await tpage.getByTestId(TID.shuffle).click();
        await Promise.race([barAlert.waitFor({ timeout: 15000 }).catch(() => {}), revisionReaches(afterRipple.revision + 1, 15000)]);
        await waitSaid(S.movedBack(movedKeys.length).trim());
        const afterRShuffle = await tdoc();
        const runS = await runNow();
        const rShuffle = { said: await said(), refusal: (await barAlert.count()) ? await barAlert.textContent() : null, ops: await opsSince(afterRipple.revision), places: places(afterRShuffle.project, runS), removed: removedByHand(afterRShuffle.project, slotsOf(afterRShuffle.project, runS) as any).length, offered: await restoreBtn.count() };
        // the button: one revision; the deleted picture is made again; nothing is left moved
        await restoreBtn.click();
        await Promise.race([barAlert.waitFor({ timeout: 15000 }).catch(() => {}), revisionReaches(afterRShuffle.revision + 1, 15000)]);
        await restoreBtn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        await sleep(300);
        const afterRRestore = await tdoc();
        const runR = await runNow();
        const rRestore = { said: await said(), refusal: (await barAlert.count()) ? await barAlert.textContent() : null, ops: await opsSince(afterRShuffle.revision), places: places(afterRRestore.project, runR), removed: removedByHand(afterRRestore.project, slotsOf(afterRRestore.project, runR) as any).length, offered: await restoreBtn.count() };
        // exact undo, one step each: the restore, the shuffle, the delete; the offer goes with the delete
        const pRippled = creativeProjection(afterRipple.project), pRShuffle = creativeProjection(afterRShuffle.project);
        const rSteps: boolean[] = [];
        for (const want of [pRShuffle, pRippled, pShuffled]) { await tpage.getByTestId('undo').click(); rSteps.push(await tuntil((d) => creativeProjection(d) === want, 10000)); }
        await restoreBtn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        const rOfferGone = (await restoreBtn.count()) === 0;
        check('a picture of the applied template deleted with Delete (a new project closes the gap, so the later pictures move earlier): the bar offers «החזרת החלקים שנמחקו» (not before the delete); Shuffle regenerates in 1 revision, leaves the deleted picture out and puts the moved pictures back on their slots, and the bar says both in Hebrew («… פריטים שרק זזו ממקומם חזרו למקומם בתבנית»); the button then makes the deleted picture again in 1 revision and says so; nothing is refused; three undos return exactly, one step each, and the offer is gone',
          slots0.length > 1 && !!victim && !!victimKey && offeredBefore === 0 && rDeleted && JSON.stringify(rippleOps) === '[["ripple_delete_clips"]]' && rOffered.count === 1 && rOffered.text === 'החזרת החלקים שנמחקו' && movedKeys.length > 0
            && afterRShuffle.revision === afterRipple.revision + 1 && JSON.stringify(rShuffle.ops) === '[["apply_template"]]' && rShuffle.refusal === null && JSON.stringify(rShuffle.places) === JSON.stringify(rest0) && rShuffle.removed === 1 && rShuffle.offered === 1
            && rShuffle.said.includes(S.movedBack(movedKeys.length).trim()) && rShuffle.said.includes('שרק ז') && rShuffle.said.includes('בתבנית') && rShuffle.said.includes(S.removedLeftOut(1).trim())
            && afterRRestore.revision === afterRShuffle.revision + 1 && JSON.stringify(rRestore.ops) === '[["apply_template"]]' && rRestore.refusal === null && JSON.stringify(rRestore.places) === JSON.stringify(places0) && rRestore.removed === 0 && rRestore.offered === 0 && rRestore.said.endsWith(S.restored)
            && rSteps.every(Boolean) && rOfferGone,
          { victimKey, deleteOps: rippleOps, places: { before: places0, afterDelete: placesRippled, afterShuffle: rShuffle.places, afterRestore: rRestore.places }, movedKeys, shuffle: { said: rShuffle.said, refusal: rShuffle.refusal, ops: rShuffle.ops, removed: rShuffle.removed }, restore: { said: rRestore.said, refusal: rRestore.refusal, ops: rRestore.ops, removed: rRestore.removed }, undo: rSteps, rOfferGone });

        // (1b) the same Delete, then the button at once (the path that was refused before): the deleted picture is made again and
        // the moved ones return to their slots in ONE revision, said in Hebrew; two undos (the restore, the delete) return exactly
        await tpage.locator(`.clip[data-clip-id="${victim}"]`).click();
        await tpage.keyboard.press('Delete');
        const bDeleted = await tuntil((d) => !clipOf(d, victim));
        await restoreBtn.waitFor({ timeout: 8000 }).catch(() => {});
        const afterB = await tdoc();
        await restoreBtn.click();
        await Promise.race([barAlert.waitFor({ timeout: 15000 }).catch(() => {}), revisionReaches(afterB.revision + 1, 15000)]);
        await restoreBtn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        await waitSaid(S.restored);
        const afterBRestore = await tdoc();
        const runB = await runNow();
        const bRestore = { said: await said(), refusal: (await barAlert.count()) ? await barAlert.textContent() : null, ops: await opsSince(afterB.revision), places: places(afterBRestore.project, runB), removed: removedByHand(afterBRestore.project, slotsOf(afterBRestore.project, runB) as any).length, offered: await restoreBtn.count() };
        const bSteps: boolean[] = [];
        for (const want of [creativeProjection(afterB.project), pShuffled]) { await tpage.getByTestId('undo').click(); bSteps.push(await tuntil((d) => creativeProjection(d) === want, 10000)); }
        await restoreBtn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        check('the same Delete, then «החזרת החלקים שנמחקו» at once: 1 revision (apply_template) makes the deleted picture again and returns the moved pictures to their slots, the bar says so in Hebrew and nothing is refused; two undos (the restore, then the delete) return exactly',
          bDeleted && afterBRestore.revision === afterB.revision + 1 && JSON.stringify(bRestore.ops) === '[["apply_template"]]' && bRestore.refusal === null && JSON.stringify(bRestore.places) === JSON.stringify(places0) && bRestore.removed === 0 && bRestore.offered === 0
            && bRestore.said.includes(S.movedBack(movedKeys.length).trim()) && bRestore.said.endsWith(S.restored) && /[\u0590-\u05FF]/.test(bRestore.said) && !/[A-Za-z]{3,}/.test(bRestore.said) && bSteps.every(Boolean) && (await restoreBtn.count()) === 0,
          { said: bRestore.said, refusal: bRestore.refusal, ops: bRestore.ops, places: bRestore.places, removed: bRestore.removed, undo: bSteps });

        // (2) Shift+Delete keeps the gap: nothing else moves, so the regeneration runs
        await tpage.locator(`.clip[data-clip-id="${victim}"]`).click();
        await tpage.keyboard.press('Shift+Delete');
        const deleted = await tuntil((d) => !clipOf(d, victim));
        await restoreBtn.waitFor({ timeout: 8000 }).catch(() => {});
        const offered = { count: await restoreBtn.count(), text: await restoreBtn.textContent().catch(() => null), visible: await restoreBtn.isVisible().catch(() => false), enabled: await restoreBtn.isEnabled().catch(() => false) };
        const afterDelete = await tdoc();
        const deleteOps = await opsSince(afterDelete.revision - 1);
        // Shuffle regenerates: the deleted item is left out, the bar says so, and the button stays
        await tpage.getByTestId(TID.shuffle).click();
        const regenerated = await revisionReaches(afterDelete.revision + 1);
        await tpage.waitForFunction((want) => (document.querySelector('[data-testid=template-applied] [role=status]')?.textContent ?? '').includes(want), S.removedLeftOut(1).trim(), { timeout: 10000 }).catch(() => {});
        const afterRegen = await tdoc();
        const run1 = await runNow();
        const leftOut = { said: await said(), slots: slotsOf(afterRegen.project, run1).length, removed: removedByHand(afterRegen.project, slotsOf(afterRegen.project, run1) as any).length, stillOffered: await restoreBtn.count(), refused: await barAlert.count() };
        // the button: the deleted item is made again
        await restoreBtn.click();
        const restoredRev = await revisionReaches(afterRegen.revision + 1);
        await restoreBtn.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        await sleep(300);
        const afterRestore = await tdoc();
        const run2 = await runNow();
        const back = { said: await said(), slots: slotsOf(afterRestore.project, run2).length, removed: removedByHand(afterRestore.project, slotsOf(afterRestore.project, run2) as any).length, offered: await restoreBtn.count(), ops: await opsSince(afterRegen.revision) };
        check('the same picture deleted with Shift+Delete (the gap is kept): the bar offers «החזרת החלקים שנמחקו»; Shuffle leaves that item out and says so (1 revision, apply_template); the button makes it again (1 revision), says so, and is gone',
          deleted && JSON.stringify(deleteOps) === '[["delete_clip"]]' && offered.count === 1 && offered.text === S.restoreRemoved && offered.text === 'החזרת החלקים שנמחקו' && offered.visible && offered.enabled
            && regenerated && afterRegen.revision === afterDelete.revision + 1 && leftOut.said.includes(S.removedLeftOut(1).trim()) && leftOut.slots === slots0.length && leftOut.removed === 1 && leftOut.stillOffered === 1 && leftOut.refused === 0
            && restoredRev && afterRestore.revision === afterRegen.revision + 1 && JSON.stringify(back.ops) === '[["apply_template"]]' && back.said.endsWith(S.restored) && back.slots === slots0.length && back.removed === 0 && back.offered === 0,
          { slots: slots0.length, victim, deleted, offered, deleteOps, leftOut, back });
        // exact undo, one step each: the restore, the regeneration, the delete; the project is the shuffled one again
        const pDeleted = creativeProjection(afterDelete.project), pRegen = creativeProjection(afterRegen.project);
        const steps: boolean[] = [];
        for (const want of [pRegen, pDeleted, pShuffled]) { await tpage.getByTestId('undo').click(); steps.push(await tuntil((d) => creativeProjection(d) === want, 10000)); }
        check('undo three times takes back the restore, the regeneration and the hand delete, one step each: an equal creativeProjection at every step, ending at the shuffled template', steps.every(Boolean) && pShuffled !== pDeleted, { steps });
      }
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

    console.log('\n# trend pack (ADR-0012): transition options from the keyboard, in Hebrew');
    {
      // A under analysed music (beats about every 15 frames), B after it with a dissolve of 15 frames. The source left on each
      // side allows ×2 but not ×3: 70 frames after A, 10 before B (×3 at 15 frames needs 29 and 14).
      const tp = (await call('/projects', { name: 'transition options', width: 640, height: 360 })).body.project.id as string;
      const tm = await upload(tp, musicFile), tpic = await upload(tp, picFile);
      await txs(tp, [{ op: 'add_clip', args: { assetId: tm.assetId, start: f(0) } }]);
      const analysedT = await call(`/projects/${tp}/assets/${tm.assetId}/analyze`, { kind: 'beats' });
      const tr = await txs(tp, [
        { op: 'add_clip', args: { assetId: tpic.assetId, start: f(0), sourceIn: f(0), duration: f(50), withLinkedAudio: false } },
        { op: 'add_clip', args: { assetId: tpic.assetId, start: f(50), sourceIn: f(10), duration: f(60), withLinkedAudio: false } },
      ]);
      const tb = tr.results[1].output.clipId as string;
      await txs(tp, [{ op: 'set_transition', args: { clipId: tb, type: 'dissolve', frames: 15 } }]);
      const tdoc = async () => (await call(`/projects/${tp}`)).body as { project: ProjectDocument; revision: number };
      const trOf = async () => (clipOf((await tdoc()).project, tb) as MediaClip).transition;
      const tuntil = async (pred: (t: any) => boolean, ms = 8000) => { const t0 = Date.now(); for (;;) { if (pred(await trOf())) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } };
      const tctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await tctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const tpage = await tctx.newPage();
      const tErrors: string[] = [];
      tpage.on('pageerror', (e) => tErrors.push(String(e)));
      await tpage.goto(`${s.ownerUrl}&project=${tp}`);
      await tpage.locator(`.clip[data-clip-id="${tb}"]`).click(); // selecting the clip is the setup; the options below are set with the keyboard only
      await tpage.getByTestId('transition-options').waitFor({ timeout: 10000 });
      const plain = await trOf(), r0 = (await tdoc()).revision;
      // beat lock: Space on the checkbox
      await tpage.getByTestId('transition-sync').focus();
      await tpage.keyboard.press('Space');
      const locked = await tuntil((t) => t?.sync === 'beat');
      const r1 = (await tdoc()).revision;
      // the status line: a live region (role=status) the checkbox points to, saying in Hebrew what the lock found (the model's frame)
      const d1 = (await tdoc()).project, k = beatSwitchFrame(d1, clipOf(d1, tb) as MediaClip);
      const want = k === null ? TREND_PACK_HE['look.transition.sync.none'] : fillIn(TREND_PACK_HE['look.transition.sync.locked'], { frame: 50 + k, time: `\u2066${T.toTimecode(f(50 + k), R)}\u2069` });
      const statusEl = tpage.getByTestId('transition-sync-status');
      await tpage.waitForFunction((w) => document.querySelector('[data-testid=transition-sync-status]')?.textContent === w, want, { timeout: 8000 }).catch(() => {});
      const statusText = (await statusEl.textContent()) ?? '';
      const statusRole = await statusEl.getAttribute('role');
      const statusId = await statusEl.getAttribute('id');
      const describedBy = (await tpage.getByTestId('transition-sync').getAttribute('aria-describedby')) ?? '';
      const announced = await tpage.getByRole('status').filter({ hasText: statusText.replace(/[\u2066\u2069]/g, '').slice(0, 12) }).count();
      // velocity: Tab reaches the select; ×3 and ×4 are disabled and say what they need; one ArrowDown chooses ×2
      await tpage.keyboard.press('Tab');
      const onVelocity = await tpage.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      const opt3 = await tpage.locator('[data-testid=transition-velocity] option[value="3"]').evaluate((o) => ({ disabled: (o as HTMLOptionElement).disabled, text: o.textContent ?? '' }));
      const need3 = velocityNeeds(15, 3), wantNeed = fillIn(TREND_PACK_HE['look.transition.velocity.need'], { out: need3.outFrames, head: need3.headFrames });
      await tpage.keyboard.press('ArrowDown');
      const ramped = await tuntil((t) => t?.velocity === 2 && t?.sync === 'beat');
      const r2 = (await tdoc()).revision;
      // each is one undo step: the Undo button pressed with Enter
      await tpage.getByTestId('undo').press('Enter');
      const undoVelocity = await tuntil((t) => t?.sync === 'beat' && t?.velocity === undefined);
      await tpage.getByTestId('undo').press('Enter');
      const undoSync = await tuntil((t) => JSON.stringify(t) === JSON.stringify(plain));
      check('trend pack: from the keyboard, Space on "נעילה לפעימה" and ArrowDown on the velocity choice set the beat lock and ×2, each in one transaction and one undo step (Undo with Enter takes back ×2, then the lock); the Hebrew status line is a live region the checkbox points to, saying where the beat is (the model\'s frame); ×3 is disabled and says what it needs', analysedT.status === 200 && locked && r1 === r0 + 1 && statusText === want && /[א-ת]/.test(statusText) && statusRole === 'status' && !!statusId && describedBy.split(' ').includes(statusId) && announced >= 1 && onVelocity === 'transition-velocity' && opt3.disabled && opt3.text.includes(wantNeed) && ramped && r2 === r1 + 1 && undoVelocity && undoSync, { beatFrame: k === null ? null : 50 + k, statusText, want, statusRole, describedBy, announced, onVelocity, opt3, wantNeed, revisions: [r0, r1, r2], locked, ramped, undoVelocity, undoSync });
      check('no uncaught errors in the page with the transition options', tErrors.length === 0, tErrors.slice(0, 4));
      await tctx.close();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // shorts (ADR-0018): a keyboard-only Hebrew run (measure, select 2, plan, create); focus on the first new tab; the 9:16
    // canvas; a title added while the short is active lands in that sequence and the main one is unchanged; [ and ] in the
    // list commit no trim_clip. Needs the shorts bodies (W1 and W2) merged: until then the run stops at the first refusal.
    // ---------------------------------------------------------------------------------------------------------------
    {
      console.log('\n# shorts: keyboard-only run, the active short, [ and ] without a trim');
      const ID = SHORTS_TESTIDS;
      const truth = await generateShortsFixture({ out: path.join(art, 'shorts.mp4') });
      const sp = (await call('/projects', { name: 'shorts-ui', width: 1280, height: 720 })).body.project.id as string;
      const asset = await upload(sp, path.join(art, 'shorts.mp4'));
      await txs(sp, [{ op: 'set_transcript', args: { assetId: asset.assetId, ...truth.transcript } }]);
      const sdoc = async () => (await call(`/projects/${sp}`)).body.project;
      /** The project's revision (the document itself holds none). */
      const srev = async () => (await call(`/projects/${sp}`)).body.revision as number;
      const trims = async () => ((await call(`/projects/${sp}/history?since=0`)).body.events as { ops?: string[] }[]).filter((e) => e.ops?.includes('trim_clip')).length;
      const sctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce', locale: 'he-IL' });
      const sPage = await sctx.newPage();
      const sErrors: string[] = [];
      sPage.on('pageerror', (e) => sErrors.push(String(e)));
      await sPage.goto(`${s.ownerUrl}&project=${sp}`);
      await sPage.getByTestId('timecode').waitFor();
      if ((await sPage.evaluate(() => document.documentElement.lang)) !== 'he') await sPage.locator('[data-testid=lang-toggle]').click().catch(() => {});
      // the mode button takes the focus and Enter opens the panel: no pointer
      await sPage.getByTestId('workspace-shorts').focus();
      await sPage.keyboard.press('Enter');
      await sPage.getByTestId(ID.panel).waitFor({ timeout: 8000 });
      const stepsShown = await sPage.locator(`[data-testid=${ID.step}]`).count();
      await sPage.getByTestId(ID.measure).focus();
      await sPage.keyboard.press('Enter');
      const listed = await sPage.getByTestId(ID.list).waitFor({ timeout: 180000 }).then(() => true, () => false);
      const rows = listed ? await sPage.locator(`[data-testid=${ID.candidate}]`).count() : 0;
      const scoreText = listed ? (await sPage.locator(`[data-testid=${ID.score}]`).first().textContent()) ?? '' : '';
      check('shorts, step 1 to 3 by keyboard: the panel shows its four steps; Enter on «מדוד» lists candidates, each with its relative score «ציון יחסי N (היוריסטיקה)» (no «viral», no prediction)', stepsShown === 4 && rows >= 2 && /^ציון יחסי \u2066?\d+\u2069? \(היוריסטיקה\)$/.test(scoreText.replace(/\s+/g, ' ').trim()) && !/viral|ויראל/i.test(await sPage.getByTestId(ID.panel).innerText()), { stepsShown, rows, scoreText });
      if (listed && rows >= 2) {
        const row = (i: number) => sPage.locator(`[data-testid=${ID.candidate}]`).nth(i);
        // [ ] and Shift+[ ] in a row move edges by statements; Alt by a word; no trim_clip is committed
        const before = await trims();
        const rangeOf = async () => (await row(0).locator('.sh-range').textContent()) ?? '';
        const r0 = await rangeOf();
        await row(0).focus();
        const revBefore = await srev();
        for (const key of ['BracketLeft', 'BracketRight', 'Shift+BracketLeft', 'Shift+BracketRight', 'Alt+BracketRight', 'Alt+Shift+BracketLeft']) await sPage.keyboard.press(key);
        const after = await trims();
        const live = (await sPage.getByTestId(ID.live).textContent()) ?? '';
        const r1 = await rangeOf();
        check('shorts, review keys: [ ] Shift+[ ] and Alt move the edges of the focused candidate (its range changes, a live region names the new edge in Hebrew) and commit NO trim_clip and no revision', before === after && (r0 !== r1 || /אי אפשר להזיז עוד/.test(live)) && /[א-ת]/.test(live) && (await srev()) === revBefore && typeof revBefore === 'number', { trimsBefore: before, trimsAfter: after, r0, r1, live });
        await row(0).focus(); await sPage.keyboard.press('Enter');
        await row(1).focus(); await sPage.keyboard.press('Enter');
        const picked = await sPage.locator(`[data-testid=${ID.candidate}][data-selected=true]`).count();
        await sPage.getByTestId(ID.plan).focus();
        await sPage.keyboard.press('Enter');
        const dialog = await sPage.getByTestId(ID.planDialog).waitFor({ timeout: 30000 }).then(() => true, () => false);
        const planOps = dialog ? Number(((await sPage.getByTestId(ID.planOps).textContent()) ?? '').replace(/\D+/g, '')) : 0;
        const mainBefore = JSON.stringify((await sdoc()).sequences.seq_main);
        const revPre = await srev();
        await sPage.getByTestId(ID.create).focus();
        await sPage.keyboard.press('Enter');
        const made = await until2(sdoc, (d) => Object.keys(d.sequences).length === 3);
        const nd = await sdoc();
        // ONE revision: the document moved by exactly one revision, and that transaction is the plan's one apply_sequence_plan
        const revMade = await srev();
        const lastTx = ((await (await fetch(`${s.url}/api/v1/projects/${nd.id}/history?since=${revPre}`, { headers: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } })).json()) as { events: { ops: string[] }[] }).events;
        const newIds = Object.keys(nd.sequences).filter((id) => id !== 'seq_main');
        await sleep(600);
        const focused = await sPage.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { id: a?.dataset?.testid ?? null, seq: a?.dataset?.sequenceId ?? null, selected: a?.getAttribute('aria-selected') ?? null }; });
        check('shorts, plan and create by keyboard: 2 selected; the plan dialog shows operations; Enter on «צור 2 קטעים» makes 2 sequences as ONE revision; the focus lands on the first new short\'s tab (aria-selected)', picked === 2 && dialog && planOps > 0 && made && newIds.length === 2 && revMade === revPre + 1 && lastTx.length === 1 && lastTx[0]!.ops.includes('apply_sequence_plan') && focused.id === ID.tab && focused.seq === newIds[0] && focused.selected === 'true', { picked, dialog, planOps, newIds, revisions: revMade - revPre, transactions: lastTx.map((e) => e.ops), focused });
        const cb = (await sPage.getByTestId('preview').boundingBox())!;
        check('shorts, the canvas of the active short is 720:1280 (9:16) within 1 px', Math.abs(cb.width - (cb.height * 720) / 1280) <= 1, { w: cb.width, h: cb.height });
        // a title added while the short is active lands in that sequence; the main sequence is unchanged
        await sPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await sPage.keyboard.press('KeyT');
        const landed = await until2(sdoc, (d) => d.sequences[newIds[0]!].tracks.some((t: any) => t.clips.some((c: any) => c.type === 'text')));
        const fin = await sdoc();
        check('shorts, a title added (T) while the short is active lands in that sequence; the main sequence is exactly as before', landed && JSON.stringify(fin.sequences.seq_main) === mainBefore, { landed, mainUnchanged: JSON.stringify(fin.sequences.seq_main) === mainBefore });
        // the sequence tabs by keyboard only: from the short's tab, Home reaches the main tab; the arrow toward the end (RTL: ArrowLeft)
        // goes to the short next to it, and the arrow toward the start (RTL: ArrowRight) comes back to the main tab
        const tabFocus = () => sPage.evaluate(() => { const a = document.activeElement as HTMLElement | null; return { id: a?.dataset?.testid ?? null, seq: a?.dataset?.sequenceId ?? null }; });
        const secondTab = await sPage.locator('[data-testid=sequence-switcher] [role=tab]').nth(1).getAttribute('data-sequence-id');
        await sPage.locator(`[data-testid=${ID.tab}][aria-selected=true]`).focus();
        const rtl = await sPage.evaluate(() => getComputedStyle(document.querySelector('[data-testid=sequence-switcher] [role=tablist]') ?? document.body).direction === 'rtl');
        await sPage.keyboard.press('Home'); await sleep(200);
        const byHome = await tabFocus();
        await sPage.keyboard.press(rtl ? 'ArrowLeft' : 'ArrowRight'); await sleep(200);
        const forward = await tabFocus();
        await sPage.keyboard.press(rtl ? 'ArrowRight' : 'ArrowLeft'); await sleep(200);
        const byArrow = await tabFocus();
        check('shorts, the sequence tabs by keyboard only: Home reaches the main tab; the arrow toward the end goes to the short next to it and the arrow toward the start (RTL: ArrowRight) comes back to the main tab', byHome.id === ID.tabMain && byHome.seq === 'seq_main' && forward.seq === secondTab && !!secondTab && secondTab !== 'seq_main' && byArrow.id === ID.tabMain && byArrow.seq === 'seq_main', { byHome, forward, secondTab, byArrow, rtl });
      }
      check('no uncaught errors in the page with the shorts run', sErrors.length === 0, sErrors.slice(0, 4));
      await sctx.close();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // perform mode (ADR-0025): Shift+7 enters it; the mode bar does not wrap at 1280 px; a keyboard-only take (R, pads, Space,
    // Enter) is ONE history entry; Shift+1…7 are ignored while recording; discard leaves the revision unchanged; Escape closes
    // the pad editor and the calibration dialog and the focus returns to what opened them. The full take proof is proof:perform.
    // ---------------------------------------------------------------------------------------------------------------
    {
      console.log('\n# perform mode (ADR-0025): keyboard paths');
      const PID = PERFORM_TESTIDS;
      const pp = (await call('/projects', { name: 'perform-keys', width: 640, height: 360 })).body.project.id as string;
      const pm = await upload(pp, musicFile), pv = await upload(pp, picFile);
      await txs(pp, [{ op: 'add_clip', args: { assetId: pm.assetId, start: f(0) } }]);
      await txs(pp, [{ op: 'add_clip', args: { assetId: pv.assetId, start: f(0), withLinkedAudio: false } }]);
      await call(`/projects/${pp}/assets/${pm.assetId}/analyze`, { kind: 'beats' });
      const prev = async () => (await call(`/projects/${pp}`)).body.revision as number;
      const phist = async () => ((await call(`/projects/${pp}/history?since=0`)).body.events as { ops: string[] }[]);
      const pctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await pctx.addInitScript(() => { (globalThis as any).__pfPerformProof = true; try { localStorage.setItem('pf.lang', 'he'); localStorage.removeItem('pf.perform.v1'); } catch { /* storage unavailable */ } });
      const ppage = await pctx.newPage();
      const pErrors: string[] = [];
      ppage.on('pageerror', (e) => pErrors.push(String(e)));
      await ppage.goto(`${s.ownerUrl}&project=${pp}`);
      await ppage.getByTestId('project-name').waitFor();
      await ppage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await ppage.keyboard.press('Shift+Digit7');
      const entered = await ppage.getByTestId(PID.view).waitFor({ timeout: 10000 }).then(() => true, () => false);
      const bar = await ppage.locator('[data-testid=workspace-switch] [data-testid^=workspace-]').evaluateAll((els) => els.map((e) => ({ id: (e as HTMLElement).dataset.testid, top: Math.round(e.getBoundingClientRect().top), checked: e.getAttribute('aria-checked') })));
      const oneRow = bar.length === 7 && new Set(bar.map((b) => b.top)).size === 1;
      check('perform: Shift+7 enters the perform mode (its view mounts, its mode button is checked); the 7-button mode bar is one row at 1280 px', entered && bar.find((b) => b.id === 'workspace-perform')?.checked === 'true' && oneRow, { entered, bar });
      // discard: a take recorded and thrown away changes nothing
      const r0 = await prev(), h0 = (await phist()).length;
      await ppage.keyboard.press('KeyR');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'recording', undefined, { timeout: 10000 });
      await sleep(500);
      await ppage.keyboard.press('Digit1'); await sleep(400);
      await ppage.keyboard.press('Space');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'review', undefined, { timeout: 10000 });
      await ppage.keyboard.press('Escape');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'idle', undefined, { timeout: 10000 });
      await sleep(300);
      check('perform: a take recorded with R, a pad and Space, then discarded with Escape, leaves the revision and the history unchanged', (await prev()) === r0 && (await phist()).length === h0, { revisions: (await prev()) - r0, entries: (await phist()).length - h0 });
      // a keyboard-only take: R, pads 1 2 3, Shift+1…7 (ignored while recording), Space, Enter
      await ppage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await ppage.keyboard.press('KeyR');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'recording', undefined, { timeout: 10000 });
      await sleep(400);
      for (const code of ['Digit1', 'Digit2', 'Digit3']) { await ppage.keyboard.press(code); await sleep(450); }
      for (let i = 1; i <= 7; i++) await ppage.keyboard.press(`Shift+Digit${i}`);
      const stillRecording = (await ppage.getByTestId(PID.view).getAttribute('data-phase')) === 'recording' && (await ppage.locator('[data-testid=workspace-perform][aria-checked=true]').count()) === 1;
      const tapsRec = (await ppage.evaluate(() => (window as any).__pfPerform?.state().taps.length)) as number;
      await ppage.keyboard.press('Space');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'review', undefined, { timeout: 10000 });
      const banner = await ppage.getByTestId(PID.ghostBanner).isVisible().catch(() => false);
      const rReview = await prev();
      await ppage.keyboard.press('Enter');
      await ppage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'idle', undefined, { timeout: 30000 });
      await sleep(300);
      const h1 = await phist();
      check('perform: a keyboard-only take (R, 1 2 3, Space, Enter) gives exactly ONE new history entry (apply_take); Shift+1…7 while recording add no tap and leave the mode; the ghost banner shows in review', stillRecording && tapsRec === 3 && banner && rReview === r0 && (await prev()) === r0 + 1 && h1.length === h0 + 1 && h1.at(-1)!.ops.join() === 'apply_take', { stillRecording, tapsRec, banner, entries: h1.length - h0, ops: h1.at(-1)?.ops });
      // Escape and focus return: the pad editor (opened from pad 3's edit button) and the calibration dialog (from its button)
      const edit = ppage.locator('[data-testid=perform-pads] .pf-perform-padcell').nth(2).locator('.pf-perform-padedit');
      await edit.focus(); await ppage.keyboard.press('Enter');
      const peOpen = await ppage.getByTestId(PID.padEditor).waitFor({ timeout: 5000 }).then(() => true, () => false);
      const peFocusInside = await ppage.evaluate(() => !!document.activeElement?.closest('[data-testid=perform-pad-editor]'));
      await ppage.keyboard.press('Escape');
      const peClosed = await ppage.getByTestId(PID.padEditor).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
      const peBack = await ppage.evaluate(() => !!document.activeElement?.classList.contains("pf-perform-padedit") && !!document.activeElement?.getAttribute("aria-label")?.includes("3"));
      const cal = ppage.getByTestId(PID.calibrate);
      await cal.focus(); await ppage.keyboard.press('Enter');
      const calOpen = await ppage.getByTestId(PID.calibrateDialog).waitFor({ timeout: 5000 }).then(() => true, () => false);
      const calFocusInside = await ppage.evaluate(() => !!document.activeElement?.closest('[data-testid=perform-calibrate-dialog]'));
      await ppage.keyboard.press('Escape');
      const calClosed = await ppage.getByTestId(PID.calibrateDialog).waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
      const calBack = await ppage.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.testid === 'perform-calibrate');
      const idle = (await ppage.getByTestId(PID.view).getAttribute('data-phase')) === 'idle';
      check('perform: Escape closes the pad editor and the calibration dialog (the focus was inside each); the focus returns to the button that opened it; nothing was recorded', peOpen && peFocusInside && peClosed && peBack && calOpen && calFocusInside && calClosed && calBack && idle && (await phist()).length === h0 + 1, { peOpen, peFocusInside, peClosed, peBack, calOpen, calFocusInside, calClosed, calBack, idle });
      check('perform: no uncaught errors in the page', pErrors.length === 0, pErrors.slice(0, 4));
      await pctx.close();
      // multicam owns the digits while its program is live (ADR-0020): the pads take none (no aria-keyshortcuts, the view says
      // so); while a take is recorded a digit is neither a tap nor an angle switch; outside a take the digit switches the angle
      {
        const pic2 = path.join(art, 'pic2.mp4');
        ff(['-f', 'lavfi', '-t', '4', '-i', 'smptebars=s=640x360:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', pic2]);
        const mp = (await call('/projects', { name: 'perform-multicam', width: 640, height: 360 })).body.project.id as string;
        const a1 = await upload(mp, picFile), a2 = await upload(mp, pic2);
        const made = (await txs(mp, [{ op: 'create_multicam', args: { name: 'mc', angles: [{ assetIds: [a1.assetId] }, { assetIds: [a2.assetId] }] } }])).results[0].output as { groupId: string; angleIds: string[] };
        await txs(mp, [{ op: 'set_multicam_sync', args: { groupId: made.groupId, angleId: made.angleIds[1], pieceIndex: 0, offset: { value: '0', timescale: 1 } } }]);
        const placed = (await txs(mp, [{ op: 'place_multicam', args: { groupId: made.groupId, at: f(0), angleId: made.angleIds[0] } }])).results[0].output as { videoTrackId: string };
        const mctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await mctx.addInitScript(([id, track]) => { (globalThis as any).__pfPerformProof = true; try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.workspace.v1', 'perform'); localStorage.setItem(`pf.targets.v1.${id}`, JSON.stringify({ video: track, audio: null })); } catch { /* storage unavailable */ } }, [mp, placed.videoTrackId]);
        const mpage = await mctx.newPage();
        const mErrors: string[] = [];
        mpage.on('pageerror', (e) => mErrors.push(String(e)));
        await mpage.goto(`${s.ownerUrl}&project=${mp}`);
        await mpage.getByTestId(PID.view).waitFor({ timeout: 30000 });
        const note = await mpage.getByTestId(PID.multicamDigits).waitFor({ timeout: 10000 }).then(() => true, () => false);
        const keys = await mpage.locator(`[data-testid=${PID.pad}]`).evaluateAll((els) => els.map((e) => e.getAttribute('aria-keyshortcuts')));
        const mh = async () => ((await call(`/projects/${mp}/history?since=0`)).body.events as unknown[]).length;
        const m0 = await mh();
        await mpage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await mpage.keyboard.press('KeyR');
        await mpage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') === 'recording', undefined, { timeout: 10000 });
        await sleep(400);
        await mpage.keyboard.press('Digit2'); await sleep(400);
        const tapsWhile = (await mpage.evaluate(() => (window as any).__pfPerform?.state().taps.length)) as number;
        await mpage.keyboard.press('Space');
        await mpage.waitForFunction(() => document.querySelector('[data-testid=perform-view]')?.getAttribute('data-phase') !== 'recording', undefined, { timeout: 10000 });
        await sleep(400);
        const m1 = await mh();
        await mpage.evaluate(() => (window as any).__pfPlayer?.seek?.(30));
        await mpage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await mpage.keyboard.press('Digit2');
        const switched = await until2(mh, (n) => n === m1 + 1, 8000);
        check('perform: while multicam\'s program is live the pads take no number keys (no aria-keyshortcuts, the view says so); during a take a digit is neither a tap nor an angle switch; outside a take Digit2 switches the angle (one history entry)', note && keys.length === 8 && keys.every((k) => k === null) && tapsWhile === 0 && m1 === m0 && switched && mErrors.length === 0, { note, keys, tapsWhile, entriesDuringTake: m1 - m0, switched, errors: mErrors.slice(0, 3) });
        await mctx.close();
      }
    }

    // the Hebrew command bar (ADR-0027): keyboard paths through the palette's one listbox — the bar's row first and active,
    // the arrows over a question's choices with each choice's own preview, an example row that only fills the input, the
    // assistant's «איך מחברים» into Settings, and a Settings refusal in Hebrew with its next step (the full proof is proof:command-bar)
    {
      console.log('\n# command bar (ADR-0027): keyboard paths');
      const cp = (await call('/projects', { name: 'command-bar-keys', width: 640, height: 360 })).body.project.id as string;
      const ca = await upload(cp, picFile), cm = await upload(cp, musicFile);
      const c1 = (await txs(cp, [{ op: 'add_clip', args: { assetId: ca.assetId, start: f(0), duration: f(60), withLinkedAudio: false } }])).results[0].output.clipId as string;
      await txs(cp, [{ op: 'add_clip', args: { assetId: cm.assetId, start: f(0), duration: f(90) } }]);
      const cctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await cctx.addInitScript('globalThis.__name = (f) => f');
      await cctx.addInitScript(() => { (globalThis as any).__pfAudioTap = true; try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const cpage = await cctx.newPage();
      const cErrors: string[] = [];
      cpage.on('pageerror', (e) => cErrors.push(String(e)));
      await cpage.goto(`${s.ownerUrl}&project=${cp}`);
      await cpage.getByTestId('timecode').waitFor({ timeout: 30000 });
      await cpage.waitForFunction(() => !!(window as any).__pfPlayer, undefined, { timeout: 30000 });
      const crev = async () => (await call(`/projects/${cp}`)).body.revision as number;
      const chist = async () => (await call(`/projects/${cp}/history?since=0`)).body.events as { label: string | null; ops: string[] }[];
      await cpage.locator(`.clip[data-clip-id="${c1}"]`).click({ position: { x: 6, y: 6 } });
      await cpage.evaluate(() => (window as any).__pfPlayer.seek(30));
      const typeBar = async (text: string) => {
        if (!(await cpage.getByTestId('palette-dialog').count())) { await cpage.getByTestId('open-palette').focus(); await cpage.keyboard.press('Control+k'); await cpage.getByTestId('palette-input').waitFor({ timeout: 5000 }); }
        await cpage.getByTestId('palette-input').press('Control+a'); await cpage.keyboard.press('Backspace');
        await cpage.keyboard.type(text);
        await cpage.waitForFunction((q) => document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value === q && !!document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.kind, text, { timeout: 8000 });
        await sleep(150);
      };
      const active = () => cpage.evaluate(() => document.querySelector('[data-testid=palette-input]')?.getAttribute('aria-activedescendant'));
      // 1: «חתוך כאן» — the bar's row is the first option and active; ↓ leaves it, Home comes back; Enter commits one labelled transaction
      const r0 = await crev(), h0 = (await chist()).length;
      await typeBar('חתוך כאן');
      const first = await cpage.evaluate(() => document.querySelector('[role=listbox] [role=option]')?.id);
      const options = await cpage.locator('[role=listbox] [role=option]').count();
      const rowSeen = await cpage.evaluate(() => { const r = document.querySelector('[data-testid=bar-result]')!.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.height >= 30 && !!hit?.closest('[data-testid=bar-result]'); });
      const a0 = await active();
      await cpage.keyboard.press('ArrowDown'); const a1 = await active();
      await cpage.keyboard.press('Home'); const a2 = await active();
      const moved = options > 1 ? a1 !== a0 : a1 === a0; // with one option the cursor wraps onto it
      await cpage.waitForFunction(() => (window as any).__pfBar?.lastPlan?.planHash === document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.planHash, undefined, { timeout: 5000 }).catch(() => {});
      await cpage.keyboard.press('Enter');
      const committed = await until2(crev, (n) => n === r0 + 1, 10000);
      const h1 = await chist();
      check('command bar: «חתוך כאן» — the bar\'s row is on screen (not clipped), the first option and active (aria-activedescendant), ↓ moves to the next option (wraps when it is the only one) and Home back; Enter commits ONE transaction labelled «Command bar: split_here»', rowSeen && first === 'pf-palette-opt-bar' && a0 === 'pf-palette-opt-bar' && moved && a2 === a0 && committed && h1.length === h0 + 1 && h1.at(-1)!.label === 'Command bar: split_here', { rowSeen, first, options, a0, a1, a2, revisions: (await crev()) - r0, label: h1.at(-1)?.label });
      await sleep(400);
      // 2: a question: ↓ to a choice shows that choice's own preview; Enter commits exactly that choice
      await typeBar('הגבר את הקול ב־3 דציבל');
      const kind = await cpage.getByTestId('bar-result').getAttribute('data-kind');
      await cpage.keyboard.press('ArrowDown');
      await sleep(200);
      const choiceActive = await active();
      const stepOp = await cpage.locator('[data-testid=bar-step]').first().getAttribute('data-op').catch(() => null);
      const r1 = await crev();
      await cpage.waitForFunction(() => !!(window as any).__pfBar?.lastPlan, undefined, { timeout: 5000 }).catch(() => {});
      await cpage.keyboard.press('Enter');
      const chose = await until2(crev, (n) => n === r1 + 1, 10000);
      const h2 = await chist();
      check('command bar: «הגבר את הקול ב־3 דציבל» asks; ↓ makes the first choice active with its own preview (a step), Enter commits exactly that choice (one transaction, set_track_audio)', kind === 'ambiguous' && choiceActive === 'pf-palette-opt-bar-choice-0' && stepOp === 'set_track_audio' && chose && h2.at(-1)!.ops.join() === 'set_track_audio' && h2.at(-1)!.label === 'Command bar: gain_change', { kind, choiceActive, stepOp, ops: h2.at(-1)?.ops });
      await sleep(400);
      // 3: an example row under a request the bar did not understand: Enter fills the input, nothing runs
      const r2 = await crev();
      await typeBar('תעשה שמח');
      const examples = await cpage.locator('[data-testid=bar-nearest][data-example=true]').count();
      await cpage.keyboard.press('ArrowDown');
      await sleep(150);
      await cpage.keyboard.press('Enter');
      await sleep(400);
      const filled = await cpage.evaluate(() => ({ value: document.querySelector<HTMLInputElement>('[data-testid=palette-input]')?.value ?? '', kind: document.querySelector<HTMLElement>('[data-testid=bar-result]')?.dataset.kind ?? null, open: !!document.querySelector('[data-testid=palette-dialog]'), focus: document.activeElement?.getAttribute('data-testid') }));
      check('command bar: «תעשה שמח» is not understood and offers example sentences; ↓ and Enter put one in the input (its own preview shows) and nothing is committed', examples > 0 && filled.open && filled.value !== 'תעשה שמח' && filled.value.length > 0 && filled.kind !== 'unknown' && filled.focus === 'palette-input' && (await crev()) === r2, { examples, ...filled, revisions: (await crev()) - r2 });
      // 4: the assistant row: «עוזר השפה לא מחובר», «איך מחברים» opens Settings at the assistant's section (owner session)
      await typeBar('בקשה לעוזר');
      const rowText = await cpage.getByTestId('palette-assistant').textContent();
      const outside = await cpage.evaluate(() => ({ row: !document.querySelector('[role=listbox] [data-testid=palette-assistant]'), preview: !document.querySelector('[role=listbox] #pf-bar-preview'), live: !document.querySelector('[role=listbox] [data-testid=bar-live]'), roles: [...document.querySelectorAll('[role=listbox] [role]')].map((e) => e.getAttribute('role')).filter((r) => r !== 'option' && r !== 'group') }));
      check('command bar: the listbox owns only options and groups — the bar\'s live region and preview and the assistant\'s row are outside it', outside.row && outside.preview && outside.live && outside.roles.length === 0, outside);
      await cpage.getByTestId('bar-assistant-connect').click();
      const settings = await cpage.getByTestId('assistant-settings').waitFor({ timeout: 8000 }).then(() => true, () => false);
      await cpage.getByTestId('assistant-setup').waitFor({ timeout: 8000 }).catch(() => {});
      const setup = await cpage.getByTestId('assistant-setup').getAttribute('data-setup').catch(() => null);
      // 5: a Settings refusal in Hebrew with its next step: this server allows no assistant host, so saving one is refused (409)
      await cpage.getByTestId('assistant-host').fill('api.example.test');
      await cpage.getByTestId('assistant-model').fill('m');
      await cpage.getByTestId('assistant-price-in').fill('300'); await cpage.getByTestId('assistant-price-out').fill('1500');
      await cpage.getByTestId('assistant-monthly-limit').fill('500'); await cpage.getByTestId('assistant-request-cap').fill('50');
      await cpage.locator('[data-testid=assistant-settings] button.pf-btn-primary').first().click();
      const refused = await cpage.getByTestId('assistant-refused').waitFor({ timeout: 8000 }).then(async () => (await cpage.getByTestId('assistant-refused').textContent()) ?? '', () => '');
      check('command bar: the assistant row reads «עוזר השפה לא מחובר»; «איך מחברים» opens Settings at «עוזר השפה» (provider_not_configured); a refused save reads in Hebrew with its next step and without the server\'s English hint', !!rowText?.includes('עוזר השפה לא מחובר') && settings && setup === 'provider_not_configured' && /PF_ASSISTANT_HOSTS/.test(refused) && /[א-ת]/.test(refused) && refused.includes('; ') && !/restart the server/i.test(refused) && !/לא תורגם/.test(refused), { setup, refused });
      check('command bar: no uncaught errors in the page', cErrors.length === 0, cErrors.slice(0, 4));
      await cctx.close();
    }

    console.log('\n# a toast while a modal dialog is open (the people sheet, in Hebrew): inside the modal, announced, reachable by Tab, back on the page after');
    {
      const mctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await mctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const mp = await mctx.newPage();
      const mErrors: string[] = [];
      mp.on('pageerror', (e) => mErrors.push(String(e)));
      await mp.goto(`${s.ownerUrl}&project=${pid}`);
      await mp.getByTestId('timecode').waitFor();
      await mp.getByTestId('open-palette').click();
      await mp.getByTestId('palette-input').fill('אנשים');
      await mp.locator('[data-testid=palette-option][data-command-id="life.people"]').click({ timeout: 8000 });
      const sheet = mp.getByTestId(PEOPLE_TESTIDS.sheet);
      await sheet.waitFor();
      // a person added in the sheet and removed again: the removal is an undo toast, shown while the sheet is still open
      await mp.getByTestId(PEOPLE_TESTIDS.personAdd).click();
      await mp.getByTestId('life-person-new-name').fill('אורחת בדיקה');
      await mp.getByTestId('life-person-new-save').click();
      const personId = await mp.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('[data-person-id]')].find((r) => r.querySelector<HTMLInputElement>('input[type=text]')?.value === 'אורחת בדיקה')?.dataset.personId ?? null, undefined, { timeout: 10000 }).then((h) => h.jsonValue() as Promise<string>);
      await mp.getByTestId(PEOPLE_TESTIDS.personRemove(personId)).click();
      const toastIn = mp.locator(`[data-testid=${PEOPLE_TESTIDS.sheet}] [data-testid=toasts] [role=status]`);
      await toastIn.first().waitFor({ timeout: 8000 }).catch(() => {});
      const where = await mp.evaluate((sheetId) => {
        const region = document.querySelector<HTMLElement>('[data-testid=toasts]');
        const t = region?.querySelector<HTMLElement>('[role=status]');
        return { inSheet: !!t && !!document.querySelector(`[data-testid=${sheetId}]`)?.contains(t), host: region?.dataset.host ?? null, inert: !!t?.closest('[inert]'), regionName: region?.getAttribute('aria-label') ?? null, pageBehindInert: !!document.querySelector('[data-testid=timecode]')?.closest('[inert]'), text: t?.textContent ?? '' };
      }, PEOPLE_TESTIDS.sheet);
      // announced = in the accessibility tree as a live status (an inert subtree is pruned from it); the page behind is the control
      const cdp = await mctx.newCDPSession(mp);
      const axOf = async (selector: string) => {
        const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: 0 });
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector });
        if (!nodeId) return null;
        const { nodes } = await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
        const n = nodes[0] as { ignored?: boolean; role?: { value?: string } } | undefined;
        return n ? { ignored: !!n.ignored, role: n.role?.value ?? null } : null;
      };
      const axToast = await axOf(`[data-testid=${PEOPLE_TESTIDS.sheet}] [data-testid=toasts] [role=status]`);
      const axBehind = await axOf('[data-testid=open-palette]');
      check('a toast that appears while a modal dialog is open is rendered inside it, named «התראות», not inert, and in the accessibility tree as a status (announced), while the page behind stays inert and out of that tree',
        where.inSheet && where.host === 'modal' && !where.inert && where.regionName === 'התראות' && where.pageBehindInert && axToast?.ignored === false && axToast.role === 'status' && axBehind?.ignored === true && where.text.length > 0,
        { ...where, axToast, axBehind });
      // the keyboard: Shift+Tab walks the sheet backwards (the toast region is its last part); focus never leaves the sheet;
      // Enter on «ביטול» undoes exactly the removal (the undo toast lives 6 s and pauses while focused)
      let left = 0, reached = false;
      for (let i = 0; i < 60 && !reached; i++) {
        await mp.keyboard.press('Shift+Tab');
        const at = await mp.evaluate((id) => ({ inSheet: !!document.querySelector(`[data-testid=${id}]`)?.contains(document.activeElement), onUndo: !!document.activeElement?.closest('[data-testid=toasts] [role=status]') && document.activeElement?.tagName === 'BUTTON' && !document.activeElement.classList.contains('pf-toast-x') }), PEOPLE_TESTIDS.sheet);
        if (!at.inSheet) left++;
        reached = at.onUndo;
      }
      const focusedLabel = await mp.evaluate(() => document.activeElement?.textContent ?? '');
      if (reached) await mp.keyboard.press('Enter');
      const restored = await mp.getByTestId(PEOPLE_TESTIDS.personRow(personId)).waitFor({ timeout: 8000 }).then(() => true, () => false);
      check('the keyboard reaches the toast\'s «ביטול» inside the modal\'s focus trap (focus never leaves the sheet); Enter brings the removed person back and the sheet stays open',
        reached && left === 0 && focusedLabel.trim() === 'ביטול' && restored && (await sheet.count()) === 1, { reached, tabStepsThatLeftTheSheet: left, focusedLabel, restored });
      await mp.keyboard.press('Escape');
      await sheet.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await mp.waitForTimeout(150);
      // after the sheet closes the region is the page's again (a child of the body, not inert)
      const after = await mp.evaluate(() => { const r = document.querySelector<HTMLElement>('[data-testid=toasts]'); return { host: r?.dataset.host ?? null, parentIsBody: r?.parentElement === document.body, inert: !!r?.closest('[inert]'), anyInert: !!document.querySelector('[inert]') }; });
      check('after the sheet closes, the toast region is back on the page (a child of the body, not inert) and nothing is left inert; no page errors', after.host === 'page' && after.parentIsBody && !after.inert && !after.anyInert && mErrors.length === 0, { ...after, errors: mErrors.slice(0, 3) });
      await mctx.close();
    }

    console.log('\n# a cut by the transcript beside an untimed copy: the panel names the clip it left alone (Hebrew, then English)');
    {
      const up2 = (await call('/projects', { name: 'untimed copy', width: 640, height: 360 })).body.project.id as string;
      const talkFile = path.join(art, 'talk.mp4'); // a transcript belongs to a file with sound
      ff(['-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', talkFile]);
      const rec = await upload(up2, talkFile);
      // The reversed rendition is a real file made here by ffmpeg. It is stored through a side project (one blob store), then attached
      // to this project by hand as a derived asset with no recorded time mapping (no sourceRangeStart), as a provider's reversed
      // rendition would be. A typed fixture: no provider ran.
      const revFile = path.join(art, 'reversed.mp4');
      ff(['-i', talkFile, '-vf', 'reverse', '-af', 'areverse', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', revFile]);
      const side = (await call('/projects', { name: 'untimed copy (blob side project)', width: 640, height: 360 })).body.project.id as string;
      const sideUp = await upload(side, revFile);
      const { id: _sideId, ...revAsset } = (await call(`/projects/${side}`)).body.project.assets[sideUp.assetId];
      const rev = s.store.commit({ projectId: up2, actor: 'fixture', allowInternal: true, ops: [{ op: 'import_asset', args: { asset: { ...revAsset, name: 'reversed.mp4', provenance: { origin: 'derived', importedAt: new Date().toISOString(), importedBy: 'fixture', derived: { jobId: 'job_fixture', capabilityId: 'comfy.video.reverse', capabilityVersion: '0.1.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [rec.assetId], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' } } } } } }] }).results[0]!.output!.assetId as string;
      // four words of half a second each on the recording; the recording plays on frames 0..60, the reversed rendition after it
      const spoken = ['שלום', 'אממ', 'עולם', 'טוב'];
      await txs(up2, [{ op: 'set_transcript', args: { assetId: rec.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(2, 1), text: spoken.join(' '), words: spoken.map((text, k) => ({ text, start: T.rt(k, 2), duration: T.rt(1, 2) })) }] } }]);
      await txs(up2, [{ op: 'add_clip', args: { assetId: rec.assetId, start: f(0), duration: f(60), withLinkedAudio: false } }]);
      const revClip = (await txs(up2, [{ op: 'add_clip', args: { assetId: rev, start: f(60), duration: f(30), withLinkedAudio: false } }])).results[0].output.clipId as string;
      const udoc = async () => (await call(`/projects/${up2}`)).body.project;
      const mediaOf = (d: any, assetId: string) => d.sequences.seq_main.tracks.flatMap((t: any) => t.clips).filter((c: any) => c.type === 'media' && c.assetId === assetId);
      const revBefore = clipOf(await udoc(), revClip);
      const uctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await uctx.addInitScript(() => { try { if (!localStorage.getItem('pf.lang')) localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const upage = await uctx.newPage();
      const uErrors: string[] = [];
      upage.on('pageerror', (e) => uErrors.push(String(e)));
      await upage.goto(`${s.ownerUrl}&project=${up2}`);
      await upage.locator('[data-testid=transcript-panel][data-state=ready]').waitFor({ timeout: 15000 });
      const note = upage.getByTestId('transcript-skipped-note');
      const noteNow = async () => ({ count: await note.count(), text: (await note.first().textContent().catch(() => null)), role: await note.first().getAttribute('role').catch(() => null), visible: await note.first().isVisible().catch(() => false) });
      const cutWord = async (k: number) => {
        await upage.getByTestId('transcript-word').nth(k).click();
        await upage.getByTestId('transcript-delete').click();
      };
      const noteBefore = await note.count();
      await cutWord(1); // «אממ», 0.5–1.0 s of the recording = frames 15..30
      const cut1 = await until2(udoc, (d) => mediaOf(d, rec.assetId).length === 2);
      await note.first().waitFor({ timeout: 10000 }).catch(() => {});
      const he = await noteNow();
      const d1 = await udoc();
      const rev1 = clipOf(d1, revClip);
      const wantHe = dictionaries.he['transcript.untimedSkipped'].replace('{name}', 'reversed.mp4'), wantEn = dictionaries.en['transcript.untimedSkipped'].replace('{name}', 'reversed.mp4');
      // English: the next cut words its note in the interface language of that moment
      await upage.getByTestId('lang-toggle').click();
      await upage.waitForFunction(() => document.documentElement.lang === 'en', undefined, { timeout: 5000 }).catch(() => {});
      await cutWord(3); // «טוב», 1.5–2.0 s of the recording
      const cut2 = await until2(udoc, (d) => mediaOf(d, rec.assetId).reduce((n: number, c: any) => n + fr(c.duration), 0) === 30);
      await upage.waitForFunction((want) => document.querySelector('[data-testid=transcript-skipped-note]')?.textContent === want, wantEn, { timeout: 10000 }).catch(() => {});
      const en = await noteNow();
      const d2 = await udoc();
      const rev2 = clipOf(d2, revClip);
      const refused = await upage.getByTestId('transcript-error').count();
      const sameCopy = (c: any) => !!c && fr(c.duration) === 30 && JSON.stringify(c.sourceIn) === JSON.stringify(revBefore.sourceIn) && c.assetId === rev;
      check('a word deleted in the transcript panel while another clip shows a reversed copy of the recording: the recording\'s clip is cut, the copy\'s clip is left whole, and the panel says «הקליפ reversed.mp4 לא נחתך לפי ההקלטה…» as one status note; after switching to English the next cut says it in English; nothing is refused',
        noteBefore === 0 && cut1 && he.count === 1 && he.text === wantHe && /^הקליפ reversed\.mp4 לא נחתך לפי ההקלטה/.test(he.text ?? '') && he.role === 'status' && he.visible
          && mediaOf(d1, rec.assetId).reduce((n: number, c: any) => n + fr(c.duration), 0) === 45 && sameCopy(rev1) && fr(rev1.start) === 45 && mediaOf(d1, rev).length === 1
          && cut2 && en.count === 1 && en.text === wantEn && en.role === 'status' && en.visible && sameCopy(rev2) && fr(rev2.start) === 30 && mediaOf(d2, rev).length === 1 && refused === 0 && uErrors.length === 0,
        { noteBefore, he, en, recordingFrames: [mediaOf(d1, rec.assetId).map((c: any) => [fr(c.start), fr(c.duration)]), mediaOf(d2, rec.assetId).map((c: any) => [fr(c.start), fr(c.duration)])], copy: [[fr(rev1?.start), fr(rev1?.duration)], [fr(rev2?.start), fr(rev2?.duration)]], refused, errors: uErrors.slice(0, 3) });
      await uctx.close();
    }

    console.log('\n# beat and scene markers of a clip that shows a derived copy of a measured file (fixtures: no provider ran)');
    {
      // The measured file: 4 s of picture and sound. Its beats (every half second from 0.5 s, 120 BPM) and scene cuts (1 s and 2.5 s) are
      // attached by hand as a typed fixture (no analysis ran). Two real files are made from it by ffmpeg and stored through a side
      // project (one blob store), then attached by hand as derived assets, as a provider's results would be:
      //   graded.mp4   its 1 s .. 3.5 s with the colour changed; recorded as starting at 1 s of the file (keeps its timing)
      //   backwards.mp4  the file reversed; no recorded time mapping
      const filmFile = path.join(art, 'markers-film.mp4'), gradedFile = path.join(art, 'markers-graded.mp4'), backFile = path.join(art, 'markers-backwards.mp4');
      ff(['-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', filmFile]);
      ff(['-ss', '1', '-t', '2.5', '-i', filmFile, '-vf', 'hue=s=0.3,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', gradedFile]);
      ff(['-i', filmFile, '-vf', 'reverse', '-af', 'areverse', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', backFile]);
      const mside = (await call('/projects', { name: 'derived copy markers (blob side project)', width: 640, height: 360 })).body.project.id as string;
      const stored = async (file: string) => { const up = await upload(mside, file); const { id: _id, ...asset } = (await call(`/projects/${mside}`)).body.project.assets[up.assetId]; return asset; };
      const gradedAsset = await stored(gradedFile), backAsset = await stored(backFile);
      const derivedFrom = (src: string, capabilityId: string, extra: Record<string, unknown>) => ({ origin: 'derived', importedAt: new Date().toISOString(), importedBy: 'fixture', derived: { jobId: 'job_fixture', capabilityId, capabilityVersion: '0.1.0', graphDigest: `sha256:${'a'.repeat(64)}`, params: {}, sourceAssetIds: [src], outputName: 'out', outputRole: 'primary', encoding: 'display', provider: { id: 'fixture' }, ...extra } });
      /** A project with the measured file in its library (not on the timeline) and one clip of `copy` of it. */
      const projectWith = async (name: string, copy: 'graded' | 'backwards') => {
        const id = (await call('/projects', { name, width: 640, height: 360 })).body.project.id as string;
        const film = await upload(id, filmFile);
        s.store.commit({ projectId: id, actor: 'fixture', allowInternal: true, ops: [
          { op: 'attach_analysis', args: { assetId: film.assetId, kind: 'beats', method: 'typed fixture (no analysis ran)', params: {}, createdAt: new Date().toISOString(), times: [1, 2, 3, 4, 5, 6, 7].map((k) => T.rt(k, 2)), bpm: 120, confidence: 1 } },
          { op: 'attach_analysis', args: { assetId: film.assetId, kind: 'scenes', method: 'typed fixture (no analysis ran)', params: {}, createdAt: new Date().toISOString(), times: [T.rt(1, 1), T.rt(5, 2)] } },
        ] });
        const asset = copy === 'graded'
          ? { ...gradedAsset, name: 'graded.mp4', provenance: derivedFrom(film.assetId, 'comfy.video.enhance', { sourceRangeStart: T.rt(1, 1), audio: 'source-copied' }) }
          : { ...backAsset, name: 'backwards.mp4', provenance: derivedFrom(film.assetId, 'comfy.video.reverse', {}) };
        const copyId = s.store.commit({ projectId: id, actor: 'fixture', allowInternal: true, ops: [{ op: 'import_asset', args: { asset } }] }).results[0]!.output!.assetId as string;
        // the copy's clip starts at frame 30 and plays the copy from 0.5 s for 1.5 s: for graded.mp4 that is 1.5 s .. 3.0 s of the measured file
        await txs(id, [{ op: 'add_clip', args: { assetId: copyId, start: f(30), sourceIn: f(15), duration: f(45), withLinkedAudio: false } }]);
        return id;
      };
      const gradedPid = await projectWith('markers on a graded copy', 'graded'), backPid = await projectWith('markers on a reversed copy', 'backwards');
      const mctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
      const mpage = await mctx.newPage();
      const mErrors: string[] = [];
      mpage.on('pageerror', (e) => mErrors.push(String(e)));
      const markersOf = async (id: string) => {
        await mpage.goto(`${s.ownerUrl}&project=${id}`);
        await mpage.getByTestId('timecode').waitFor({ timeout: 15000 });
        await mpage.locator('[data-testid=timeline-markers]').waitFor({ state: 'attached', timeout: 15000 });
        await mpage.locator('.clip').first().waitFor({ timeout: 15000 });
        await mpage.waitForTimeout(300);
        const frames = (testid: string) => mpage.locator(`[data-testid=${testid}]`).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-frame'))));
        return { beats: await frames('beat-marker'), scenes: await frames('scene-marker'), bpm: await mpage.getByTestId('tl-bpm').textContent({ timeout: 500 }).catch(() => null), clips: await mpage.locator('.clip').count() };
      };
      const onGraded = await markersOf(gradedPid), onBackwards = await markersOf(backPid);
      await mpage.screenshot({ path: path.join(art, 'markers-reversed-copy.png') }).catch(() => {});
      // the file's beats at 1.5, 2.0 and 2.5 s and its cut at 2.5 s fall inside the clip: frames 30, 45, 60 and 60; the cut at 1 s and the other beats are outside it
      check('a clip that shows a colour-processed copy which keeps the timing of a measured file shows that file\'s beat and scene markers on the timeline, at the frames its own moments play (and its tempo); a clip that shows a reversed copy shows none',
        onGraded.clips === 1 && JSON.stringify(onGraded.beats) === '[30,45,60]' && JSON.stringify(onGraded.scenes) === '[60]' && onGraded.bpm === '120'
          && onBackwards.clips === 1 && onBackwards.beats.length === 0 && onBackwards.scenes.length === 0 && onBackwards.bpm === null && mErrors.length === 0,
        { gradedCopy: onGraded, reversedCopy: onBackwards, errors: mErrors.slice(0, 3) });
      await mctx.close();
    }

    console.log('\n# archive import of a project whose translation was marked reviewed: the new project says once that the mark was cleared');
    {
      const rp = (await call('/projects', { name: 'review marks', width: 640, height: 360 })).body.project.id as string;
      const voice = await upload(rp, musicFile);
      await txs(rp, [{ op: 'add_clip', args: { assetId: voice.assetId, start: f(0), duration: f(90) } }]);
      // a typed Hebrew transcript and its English language format, stored by the op the translation tool commits: no model ran
      await txs(rp, [{ op: 'set_transcript', args: { assetId: voice.assetId, language: 'he', segments: [{ start: T.rt(0, 1), duration: T.rt(1, 1), text: 'שלום לכולם' }, { start: T.rt(1, 1), duration: T.rt(2, 1), text: 'ברוכים הבאים' }] } }]);
      const segs = s.store.getProject(rp).doc.transcripts[voice.assetId]!.segments.map((x) => x.id);
      const variantId = s.store.commit({ projectId: rp, actor: 'fixture', allowInternal: true, ops: [{ op: 'attach_translation', args: { baseVariantId: null, name: 'English', language: 'en', translation: { from: 'he', to: 'en', engine: 'typed fixture (no model ran)', model: 'none', createdAt: new Date().toISOString(), createdBy: 'fixture', sources: { [segs[0]!]: sha256Hex('שלום לכולם'), [segs[1]!]: sha256Hex('ברוכים הבאים') } }, phraseText: { [segs[0]!]: 'Hello everyone', [segs[1]!]: 'Welcome' }, cueText: {} } }] }).results[0]!.output!.variantId as string;
      const rdoc = async (id: string) => (await call(`/projects/${id}`)).body.project;
      const rctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await rctx.addInitScript(() => { try { if (!localStorage.getItem('pf.lang')) localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const rpage = await rctx.newPage();
      const rErrors: string[] = [];
      rpage.on('pageerror', (e) => rErrors.push(String(e)));
      await rpage.goto(`${s.ownerUrl}&project=${rp}`);
      await rpage.getByTestId('timecode').waitFor();
      // the owner marks the translation reviewed in the transcript panel (the server takes the mark from the owner's session only)
      await rpage.getByTestId('translation-mark').click();
      const marked = await until2(() => rdoc(rp), (d) => d.variants[variantId]?.translation?.review === 'reviewed');
      const [rdl] = await Promise.all([rpage.waitForEvent('download'), rpage.getByTestId('archive-download').click()]);
      const rArc = path.join(art, 'review-marks.tar');
      await rdl.saveAs(rArc);
      const plain = (x: string | null) => (x ?? '').replace(/[⁦-⁩‎‏]/g, '');
      const toast = rpage.locator('[data-testid=toasts] [role=status]');
      const importHere = async (from: string) => {
        await rpage.getByTestId('archive-import').setInputFiles(rArc);
        await rpage.waitForFunction((old) => { const now = new URLSearchParams(location.search).get('project'); return !!now && now !== old; }, from, { timeout: 30000 });
        await rpage.getByTestId('timecode').waitFor();
        const id = new URL(rpage.url()).searchParams.get('project')!;
        await toast.first().waitFor({ timeout: 10000 }).catch(() => {});
        return { id, count: await toast.count(), title: plain(await toast.first().locator('b').textContent().catch(() => null)), body: plain(await toast.first().locator('p').textContent().catch(() => null)), visible: await toast.first().isVisible().catch(() => false), timer: await toast.first().locator('.pf-toast-timer').count(), panel: await rpage.getByTestId('translation-review').getAttribute('data-review').catch(() => null), badge: await rpage.getByTestId('translation-unreviewed').count() };
      };
      const he = await importHere(rp);
      const heDoc = await rdoc(he.id);
      const newVariant: any = Object.values(heDoc.variants).find((v: any) => !!v.translation);
      // it stays until the owner closes it (an undo toast would be gone after 6 s); a reload does not say it again
      await sleep(7000);
      const stays = await toast.count();
      await toast.first().locator('.pf-toast-x').click();
      await toast.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      const closed = await toast.count();
      await rpage.reload();
      await rpage.getByTestId('timecode').waitFor();
      await sleep(1000);
      const afterReload = await toast.count();
      // in English: the same archive imported once more, from the project the first import made
      await rpage.getByTestId('lang-toggle').click();
      await rpage.waitForFunction(() => document.documentElement.lang === 'en', undefined, { timeout: 5000 }).catch(() => {});
      const en = await importHere(he.id);
      const source = (await rdoc(rp)).variants[variantId].translation;
      check('an archive of a project whose translation the owner marked reviewed, imported in the editor: the new project opens with one toast «הארכיון יובא» whose text is the server\'s note naming «English» in the singular («התרגום … מסומן», «The translation … needs»), without a timer; the translation there needs review again with its wording kept, the source keeps its mark; the toast stays past 7 s, closes with its ×, and a reload does not show it again; in English the same import says it in English',
        marked && he.id !== rp && he.count === 1 && he.title === 'הארכיון יובא' && he.body === IMPORTED_REVIEW_CLEARED.he(['«English»']) && he.body.includes('התרגום «English» מסומן שוב') && !/התרגומים|מסומנים/.test(he.body) && he.visible && he.timer === 0 && he.panel === 'needed' && he.badge === 1
          && newVariant?.translation?.review === 'needed' && newVariant.translation.reviewedBy === undefined && JSON.stringify(Object.values(newVariant.phraseText ?? {}).sort()) === JSON.stringify(['Hello everyone', 'Welcome']) && source.review === 'reviewed'
          && stays === 1 && closed === 0 && afterReload === 0
          && en.id !== he.id && en.count === 1 && en.title === 'The archive was imported' && en.body === IMPORTED_REVIEW_CLEARED.en(['«English»']) && en.body.includes('The translation «English» needs review again; its wording is kept') && !/translations/.test(en.body) && en.visible && en.timer === 0 && rErrors.length === 0,
        { marked, he, en, imported: { review: newVariant?.translation?.review, reviewedBy: newVariant?.translation?.reviewedBy ?? null, wording: Object.values(newVariant?.phraseText ?? {}) }, sourceReview: source.review, stays, closed, afterReload, errors: rErrors.slice(0, 3) });
      await rctx.close();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // content library (wave 7): the sound drawer's «מהספרייה» tab and the elements drawer's tabs in the state THIS server answers
    // (library_not_built, not set up or ready): keyboard-only tab switch, one honest state with its words, «פתיחת ההגדרות» opens
    // Settings, no overlapping boxes. The full flow with a library on disk is proof:library check 17.
    // ---------------------------------------------------------------------------------------------------------------
    {
      console.log('\n# content library panels');
      const lctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
      await lctx.addInitScript('globalThis.__name = (f) => f');
      await lctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const lpage = await lctx.newPage();
      const lErrors: string[] = [];
      const lFailed: string[] = [];
      lpage.on('console', (m) => m.type() === 'error' && lErrors.push(m.text()));
      lpage.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/v1/library')) lFailed.push(`${r.status()} ${new URL(r.url()).pathname}`); });
      await lpage.goto(`${s.ownerUrl}&project=${pid}`);
      await lpage.getByTestId('timecode').waitFor({ timeout: 30000 });
      await lpage.getByTestId('rail-audio').click();
      const tab = lpage.getByTestId('audio-tab-library');
      await tab.focus();
      await lpage.keyboard.press('Enter');
      await lpage.getByTestId('audio-panel-library').waitFor({ timeout: 8000 }).catch(() => {});
      await lpage.waitForFunction(() => !!document.querySelector('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]'), undefined, { timeout: 8000 }).catch(() => {});
      const st = await libraryPanelsProbe(lpage);
      const text = (await lpage.getByTestId('audio-panel-library').innerText().catch(() => '')).trim();
      const stateWords: Record<string, RegExp> = { not_built: /עוד לא נבנתה/, not_configured: /הספרייה לא מוגדרת/, indexing: /סורקים/, error: /[א-ת]/, empty: /אין עדיין מוזיקה|לא נמצא/, list: /./ };
      check('library: the sound drawer\'s «מהספרייה» tab opens from the keyboard (Enter), shows exactly one honest state in Hebrew (not built, not set up, scanning, error, empty or the list), and its boxes do not overlap', (await tab.getAttribute('aria-selected')) === 'true' && st.state !== 'none' && !!stateWords[st.state]?.test(text) && st.overlaps.length === 0, { state: st.state, rows: st.rows, overlaps: st.overlaps, text: text.slice(0, 120) });
      if (st.state === 'not_configured') {
        await lpage.getByTestId('library-open-settings').focus();
        await lpage.keyboard.press('Enter');
        await lpage.getByTestId('settings-dialog').waitFor({ timeout: 5000 }).catch(() => {});
        const section = await lpage.getByTestId('settings-library').count();
        await lpage.keyboard.press('Escape');
        await lpage.getByTestId('settings-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        check('library: «פתיחת ההגדרות» (Enter) opens Settings at «הספרייה שלי» (the owner\'s own session)', section === 1, { section });
      }
      await lpage.getByTestId('rail-elements').click();
      const etab = lpage.getByTestId('elements-tab-library');
      await etab.focus();
      await lpage.keyboard.press('Enter');
      await lpage.getByTestId('elements-panel-library').waitFor({ timeout: 8000 }).catch(() => {});
      await lpage.waitForFunction(() => !!document.querySelector('[data-testid=library-empty],[data-testid=library-not-configured],[data-testid=library-indexing],[data-testid=library-list]'), undefined, { timeout: 8000 }).catch(() => {});
      const est = await libraryPanelsProbe(lpage);
      await lpage.getByTestId('elements-tab-builtin').focus();
      await lpage.keyboard.press('Enter');
      const builtinBack = await lpage.getByTestId('elements-browser').waitFor({ timeout: 5000 }).then(() => true, () => false);
      // a library that is not set up (a fresh install) is an honest state, not an error: no library request fails, nothing is logged
      check('library: with no library folder set, the panels log no console error and no library request answers an error status', lErrors.length === 0 && lFailed.length === 0, { errors: lErrors.slice(0, 4), failed: lFailed.slice(0, 4) });
      check('library: the elements drawer has «מובנים» (the built-in browser, unchanged) and «מהספרייה» tabs; the library tab shows one honest state; switching back restores the built-in browser', est.state !== 'none' && est.overlaps.length === 0 && builtinBack, { state: est.state, overlaps: est.overlaps, builtinBack });
      await lctx.close();
    }

    // ------------------------------------------------------------------------------------------------------------------
    // «שליחה ושמירה» (wave 7 send), the editor rows of the send proof: S13 (the tile, the fitted size before export, Hebrew stages, the
    // card, the refusal), K6 (the export report, its jump, the ruler marks, a quiet state that never says «תקין») and L7 (the
    // limiter switch and its meter, the note before the export gain, the clip loudness match with its undo). Real exports and a real
    // browser; the numbers shown are read back from the jobs and the project, not from the page.
    console.log('\n# send: the «מתאים לשליחה» tile, the fitted size, the report (S13, K6) and the sound panel (L7)');
    {
      const sendCtx = async (id: string, lang: 'he' | 'en' = 'he') => {
        const ctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
        await ctx.addInitScript(`globalThis.__name = (f) => f`);
        await ctx.addInitScript((l: string) => { try { localStorage.setItem('pf.lang', l); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } }, lang);
        const pg = await ctx.newPage();
        const errs: string[] = [];
        pg.on('pageerror', (e) => errs.push(String(e)));
        pg.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
        await pg.goto(`${s.ownerUrl}&project=${id}`);
        await pg.getByTestId('timecode').waitFor({ timeout: 30000 });
        return { ctx, pg, errs };
      };
      const talk = path.join(art, 'send-talk.mp4');
      ff(['-f', 'lavfi', '-t', '4', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '4', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', talk]);

      // S13 + the quiet report: a noisy 12 s film (its full-quality file is far over 16 MB), fitted to 16 MB with the keyboard
      const noisy = path.join(art, 'send-noisy.mp4');
      ff(['-f', 'lavfi', '-t', '12', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '12', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'noise=alls=60:allf=t,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-c:a', 'aac', '-shortest', noisy]);
      const sa = (await call('/projects', { name: 'send a', width: 640, height: 360 })).body.project.id as string;
      const ta = await upload(sa, noisy);
      await txs(sa, [{ op: 'add_clip', args: { assetId: ta.assetId, start: f(0), duration: f(360) } }]);
      const A = await sendCtx(sa);
      await A.pg.getByTestId('export').click();
      await A.pg.getByTestId('export-sheet').waitFor({ timeout: 15000 });
      const tile = A.pg.locator('[data-testid=export-dest][data-id=whatsapp]');
      const tileText = (await tile.innerText()).trim();
      await tile.focus();
      await A.pg.keyboard.press('Space');
      await A.pg.getByTestId('send-size').waitFor({ timeout: 8000 });
      const startBlocked = (await A.pg.getByTestId('export-start').getAttribute('aria-disabled')) === 'true';
      const choiceMbs = await A.pg.locator('[data-testid=send-size-choice]').evaluateAll((els) => els.map((e) => ({ mb: e.getAttribute('data-mb'), on: e.getAttribute('aria-checked'), text: (e as HTMLElement).innerText })));
      check('S13 the tile is named «מתאים לשליחה» (no app name), is chosen from the keyboard, and the sheet asks for a size first: Export is blocked and none of 16 / 64 / 100 is preselected, each marked «לא אומת»',
        /מתאים לשליחה/.test(tileText) && !/ווטסאפ|WhatsApp/i.test(tileText) && startBlocked && ['16', '64', '100'].every((m) => choiceMbs.some((c) => c.mb === m && c.on === 'false' && /לא אומת/.test(c.text))) && !choiceMbs.some((c) => c.on === 'true'), { tileText, startBlocked, choiceMbs });
      const c16 = A.pg.locator('[data-testid=send-size-choice][data-mb="16"]');
      await c16.focus();
      await A.pg.keyboard.press('Space');
      await A.pg.getByTestId('send-size-fitted').waitFor({ timeout: 15000 });
      const fittedText = (await A.pg.getByTestId('send-size-fitted').innerText()).trim();
      const startOpen = (await A.pg.getByTestId('export-start').getAttribute('aria-disabled')) !== 'true';
      check('S13 picking 16 from the keyboard states the picture size before the export, in Hebrew, with the size as a number; Export opens', /\d+×\d+/.test(fittedText) && /(תוקטן|נשארת)/.test(fittedText) && startOpen, { fittedText, startOpen });
      await A.pg.getByTestId('export-start').focus();
      await A.pg.keyboard.press('Enter');
      const stages = new Set<string>();
      const t0 = Date.now();
      while (Date.now() - t0 < 180000) {
        if ((await A.pg.getByTestId('export-done').count()) > 0) break;
        const st = await A.pg.getByTestId('fit-stage').first().innerText().catch(() => '');
        if (st) stages.add(st.trim());
        await sleep(100);
      }
      const done = (await A.pg.getByTestId('export-done').count()) > 0;
      const jobA = done ? await A.pg.getByTestId('export-file').getAttribute('data-job-id') : null;
      const outA = jobA ? (await call(`/jobs/${jobA}`)).body : null;
      const fitLine = jobA ? ((await A.pg.getByTestId('export-fit-line').innerText().catch(() => '')) ?? '') : '';
      check('S13 the export finishes; the file card says «X מתוך 16 מ״ב · ניסיון N» marked «לא אומת», and the job\'s own bytes are at or under 16,000,000', done && !!outA && outA.status === 'succeeded' && outA.output?.bytes <= 16_000_000 && outA.output?.fit?.result === 'fitted' && /מתוך/.test(fitLine) && /ניסיון/.test(fitLine) && /לא אומת/.test(fitLine) && !/תקין/.test(fitLine), { done, bytes: outA?.output?.bytes, fitLine, attempts: outA?.output?.fit?.attempts?.length });
      check('S13 while it ran, the fit stages were worded in Hebrew (sampled every 100 ms; one sample, so an empty set is reported, not failed on a short film)', [...stages].every((x2) => /[א-ת]/.test(x2) && !/fitting|checking/.test(x2)), { seen: [...stages] });
      const checksText = done ? ((await A.pg.getByTestId('export-checks').innerText().catch(() => '')) ?? '') : '';
      const found = done ? await A.pg.getByTestId('export-checks').getAttribute('data-found').catch(() => null) : null;
      check('K6 a report with nothing found lists what was looked for as «לא נמצאו…», says it is a heuristic, and never says «תקין»', done && !!checksText && !/תקין/.test(checksText) && (found !== '0' || /לא נמצאו/.test(checksText)) && /הערכה/.test(checksText), { found, checksText: checksText.slice(0, 300) });
      await A.ctx.close();

      // S13 refusal: a 20-minute still cannot fit 1 MB; the sheet says the smallest size that works and blocks Export (plan only, no render)
      const sc = (await call('/projects', { name: 'send c', width: 640, height: 360 })).body.project.id as string;
      const stillFile = path.join(art, 'send-still.png');
      ff(['-f', 'lavfi', '-i', 'color=c=0x3366aa:s=640x360', '-frames:v', '1', stillFile]);
      const st = await upload(sc, stillFile);
      await txs(sc, [{ op: 'add_clip', args: { assetId: st.assetId, start: f(0), duration: f(36000) } }]);
      const C = await sendCtx(sc);
      await C.pg.getByTestId('export').click();
      await C.pg.getByTestId('export-sheet').waitFor({ timeout: 15000 });
      await C.pg.locator('[data-testid=export-dest][data-id=whatsapp]').click();
      await C.pg.getByTestId('send-size-input').fill('1');
      await C.pg.getByTestId('send-size-refusal').waitFor({ timeout: 15000 }).catch(() => {});
      const refusal = (await C.pg.getByTestId('send-size-refusal').innerText().catch(() => '')).trim();
      const blockedC = (await C.pg.getByTestId('export-start').getAttribute('aria-disabled')) === 'true';
      check('S13 a target the film cannot fit is refused before any export, in Hebrew, with the smallest size that works (a number) and the way forward; Export stays blocked', /קטן מדי/.test(refusal) && /\d/.test(refusal) && /הקטן ביותר/.test(refusal) && blockedC, { refusal, blockedC });
      await C.ctx.close();

      // K6: a film with a one-second gap: the report lists the black stretch with its time, «מעבר לקטע» lands on it, the ruler and the status bar mark it
      const sg = (await call('/projects', { name: 'send gap', width: 640, height: 360 })).body.project.id as string;
      const tg = await upload(sg, talk);
      await txs(sg, [{ op: 'add_clip', args: { assetId: tg.assetId, start: f(0), duration: f(60) } }]);
      await txs(sg, [{ op: 'add_clip', args: { assetId: tg.assetId, start: f(90), duration: f(60) } }]);
      const G = await sendCtx(sg);
      await startExport(G.pg, { timeout: 30000 });
      await G.pg.getByTestId('export-done').waitFor({ timeout: 180000 });
      const rows = await G.pg.locator('[data-testid=export-checks] [data-testid=export-check-item]').evaluateAll((els) => els.map((e) => ({ kind: e.getAttribute('data-kind'), text: (e as HTMLElement).innerText })));
      const black = rows.find((r) => r.kind === 'black');
      check('K6 the one-second gap is listed as «תמונה שחורה» with its time range, and the card says it is report only', !!black && /תמונה שחורה/.test(black.text) && /0:0[12]/.test(black.text) && /מדווחות בלבד/.test(await G.pg.getByTestId('export-checks').innerText()), { rows });
      const jump = G.pg.locator('[data-testid=export-checks] [data-testid=export-check-item][data-kind=black] [data-testid=export-check-jump]').first();
      const jumpLabel = (await jump.innerText().catch(() => '')).trim();
      await jump.focus();
      await G.pg.keyboard.press('Enter');
      await G.pg.getByTestId('export-sheet').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      const tcJump = ((await G.pg.getByTestId('timecode').textContent()) ?? '').trim();
      check('K6 «מעבר לקטע» (keyboard) closes the sheet and puts the playhead on the first frame of the stretch (2 s = frame 60 of 30 fps)', jumpLabel === 'מעבר לקטע' && /^00:00:02:00$/.test(tcJump), { jumpLabel, tcJump });
      const marks = await G.pg.locator('[data-testid=export-check-mark][data-kind=black]').count();
      const statusRows = await G.pg.locator('[data-testid=export-checks-status] [data-testid=export-check-item]').count();
      check('K6 the black stretch is marked on the ruler and listed in the status bar (report only: the export succeeded and its file is there)', marks >= 1 && statusRows >= 1, { marks, statusRows });
      await G.ctx.close();

      // L7: the sound panel on two clips of different loudness
      const quiet = path.join(art, 'send-quiet.wav'), loud = path.join(art, 'send-loud.wav');
      ff(['-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=220:sample_rate=48000', '-af', 'volume=0.05', '-ac', '2', '-c:a', 'pcm_s16le', quiet]);
      ff(['-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=330:sample_rate=48000', '-af', 'volume=0.4', '-ac', '2', '-c:a', 'pcm_s16le', loud]);
      const sd = (await call('/projects', { name: 'send sound', width: 640, height: 360 })).body.project.id as string;
      const qa = await upload(sd, quiet), la = await upload(sd, loud);
      const qr = (await txs(sd, [{ op: 'add_clip', args: { assetId: qa.assetId, start: f(0) } }])).results[0].output;
      const lr = (await txs(sd, [{ op: 'add_clip', args: { assetId: la.assetId, start: f(200) } }])).results[0].output;
      const qId = (qr.audioClipId ?? qr.clipId) as string, lId = (lr.audioClipId ?? lr.clipId) as string;
      const gainsOf = async () => { const d = (await call(`/projects/${sd}`)).body.project; return [qId, lId].map((id) => clipOf(d, id)?.gain ?? 1); };
      const gain0 = await gainsOf();
      const D2 = await sendCtx(sd);
      const sw = D2.pg.getByTestId('master-limiter-switch');
      await sw.waitFor({ timeout: 15000 });
      const noBarBefore = (await D2.pg.getByTestId('meter-reduction').count()) === 0;
      await sw.focus();
      await D2.pg.keyboard.press('Enter'); // Enter activates the switch (Space would too with keyboard focus: the Space rows below)
      let ceiling: number | null = null;
      for (let i = 0; i < 80 && ceiling === null; i++) { ceiling = (await doc2(sd)).settings.limiter?.ceiling ?? null; if (ceiling === null) await sleep(100); }
      const bar = D2.pg.getByTestId('meter-reduction');
      await bar.waitFor({ timeout: 8000 }).catch(() => {});
      const barState = await bar.getAttribute('data-state').catch(() => null);
      const barText = (await bar.innerText().catch(() => '')).trim();
      check('L7 the limiter switch works from the keyboard (Enter) and commits the ceiling (−1 dB by default); the meter bar appears only after, and says honestly either «on» (idle until it plays) or that the preview plays without it', noBarBefore && ceiling !== null && ceiling >= -9 && ceiling <= 0 && (barState === 'on' || (barState === 'unavailable' && /בלי המגביל/.test(barText))), { noBarBefore, ceiling, barState, barText });
      await txs(sd, [{ op: 'set_loudness_target', args: { target: -14 } }]);
      await D2.pg.getByTestId('meter-before-export-gain').waitFor({ timeout: 8000 }).catch(() => {});
      const noteText = (await D2.pg.getByTestId('meter-before-export-gain').innerText().catch(() => '')).trim();
      check('L7 with a loudness target the meter says «לפני הגברת הייצוא» (the preview is not the export gain)', /לפני הגברת הייצוא/.test(noteText), { noteText });
      await sw.focus();
      await D2.pg.keyboard.press('Enter');
      let gone = false;
      for (let i = 0; i < 80 && !gone; i++) { gone = (await doc2(sd)).settings.limiter === undefined; if (!gone) await sleep(100); }
      // the project changes on the server first; the editor hears it over its event stream, so the bar is read until it goes (8 s)
      const barsOn = () => D2.pg.locator('[data-testid=meter-reduction][data-state=on],[data-testid=meter-reduction][data-state=unavailable]').count();
      let bars = await barsOn();
      for (let i = 0; i < 80 && bars > 0; i++) { await sleep(100); bars = await barsOn(); }
      check('L7 switching it off removes the field from the project and the bar from the meter', gone && bars === 0, { gone, bars });

      // the match: select both clips, measure, see the plan, commit, read the result, undo
      await D2.pg.locator(`.clip[data-clip-id="${qId}"]`).first().click();
      await D2.pg.locator(`.clip[data-clip-id="${lId}"]`).first().click({ modifiers: ['Shift'] });
      const run = D2.pg.getByTestId('loudness-match-run');
      await run.focus();
      await D2.pg.keyboard.press('Enter');
      await D2.pg.getByTestId('loudness-match-plan').waitFor({ timeout: 60000 }).catch(() => {});
      const planRows = await D2.pg.locator('[data-testid=loudness-match-preview] li').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-clip-id'), text: (e as HTMLElement).innerText })));
      const targetShown = await D2.pg.getByTestId('loudness-match-target').inputValue().catch(() => '');
      check('L7 «מדידת הקליפים הנבחרים» (keyboard) measures both clips and shows, before anything changes, the target (their median) and each clip\'s change in dB; the project is untouched', planRows.length === 2 && /\d/.test(targetShown) && JSON.stringify(await gainsOf()) === JSON.stringify(gain0), { planRows, targetShown });
      await D2.pg.getByTestId('loudness-match-apply').click();
      await D2.pg.getByTestId('loudness-match-result').waitFor({ timeout: 15000 }).catch(() => {});
      const resRows = await D2.pg.locator('[data-testid=loudness-match-result] li').evaluateAll((els) => els.map((e) => ({ id: e.getAttribute('data-clip-id'), by: e.getAttribute('data-limited-by') })));
      const gain1 = await gainsOf();
      check('L7 the match is one transaction: the result lists each clip, the quiet clip is raised and the loud one lowered in the project, and the note says LUFS is not the ear', resRows.length === 2 && gain1[0]! > gain0[0]! && gain1[1]! < gain0[1]! && /LUFS/.test(await D2.pg.getByTestId('loudness-match-result').innerText()), { resRows, gain0, gain1 });
      await D2.pg.getByTestId('loudness-match-undo').click();
      let back = false;
      for (let i = 0; i < 80 && !back; i++) { back = JSON.stringify(await gainsOf()) === JSON.stringify(gain0); if (!back) await sleep(100); }
      check('L7 one undo restores both clips\' gains exactly', back, { gain0, now: await gainsOf() });
      check('send: the pages logged no script error', A.errs.length + C.errs.length + G.errs.length + D2.errs.length === 0, { errors: [...A.errs, ...C.errs, ...G.errs, ...D2.errs].slice(0, 4) });
      await D2.ctx.close();
    }

    // ---------------------------------------------------------------------------------------------------------------
    // picture stabilisation (wave 7): the «ייצוב תמונה» block on a shaky SYNTHETIC clip (packages/fixtures steady.ts, F1 at 480×270): not
    // measured → «ייצבו את הקליפ» → measuring with «עצירה» → on with the crop line; the slider from the keyboard (PageUp = +10) is ONE
    // commit and the crop line equals what the operation stored; the switch off and on again (the strength is remembered); one undo.
    // ---------------------------------------------------------------------------------------------------------------
    {
      console.log('\n# stabilisation block');
      const { steadyFixture, writeSteadyFixture } = await import('../../fixtures/src/steady.ts');
      const fx = steadyFixture({ variant: 'F1', frames: 240 });
      const file = path.join(art, 'stabilise-f1.mp4');
      await writeSteadyFixture(fx, file, { width: 480, height: 270 });
      const sp = (await call('/projects', { name: 'stabilise-ui', width: 480, height: 270 })).body.project.id as string;
      const up = await upload(sp, file);
      const clipId = (await txs(sp, [{ op: 'add_clip', args: { assetId: up.assetId, start: T.frameTime(0, { num: 30, den: 1 }), sourceIn: T.frameTime(30, { num: 30, den: 1 }), duration: T.frameTime(150, { num: 30, den: 1 }), withLinkedAudio: false } }])).results[0].output.clipId as string;
      const sctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' });
      await sctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const spage = await sctx.newPage();
      const sErrors: string[] = [];
      spage.on('pageerror', (e) => sErrors.push(String(e)));
      await spage.goto(`${s.ownerUrl}&project=${sp}`);
      await spage.getByTestId('timecode').waitFor({ timeout: 30000 });
      await spage.locator(`.clip[data-clip-id="${clipId}"]`).click({ position: { x: 4, y: 4 } });
      await spage.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
      const sec = spage.getByTestId('section-stabilise');
      await sec.waitFor({ timeout: 8000 });
      if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
      const stateOf = () => spage.getByTestId('stab-panel').getAttribute('data-state');
      await spage.getByTestId('stab-panel').waitFor({ timeout: 8000 });
      const s0 = await stateOf();
      const runVisible = await spage.getByTestId('stab-run').count();
      const rev0 = (await call(`/projects/${sp}`)).body.revision as number;
      await spage.getByTestId('stab-run').click();
      await spage.waitForFunction(() => document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state') === 'measuring', undefined, { timeout: 8000 }).catch(() => {});
      const sMeasuring = await stateOf();
      const stopVisible = await spage.getByTestId('stab-stop').count();
      await spage.waitForFunction(() => { const st = document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state'); return st === 'on' || st === 'limited' || st === 'refused'; }, undefined, { timeout: 120000 });
      const sOn = await stateOf();
      const jobRevisions = ((await call(`/projects/${sp}`)).body.revision as number) - rev0;
      const read = async () => ({ zoomPm: Number(await spage.getByTestId('stab-crop').getAttribute('data-zoom-pm')), area: Number(await spage.getByTestId('stab-crop').getAttribute('data-area-percent')), strength: Number(await spage.getByTestId('stab-strength').inputValue()), text: ((await spage.getByTestId('stab-crop').textContent()) ?? '').trim() });
      const onShown = await read();
      const stored = async () => { const d = (await call(`/projects/${sp}`)).body.project as ProjectDocument; const c = Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).find((x) => x.id === clipId) as MediaClip; return c.stabilise; };
      const st0 = await stored();
      // the slider from the keyboard: PageUp is +10, leaving the slider ends the change
      const rev1 = (await call(`/projects/${sp}`)).body.revision as number;
      await spage.getByTestId('stab-strength').focus();
      await spage.keyboard.press('PageUp');
      const live = Number(await spage.getByTestId('stab-strength').inputValue());
      await spage.keyboard.press('Tab');
      for (let i = 0; i < 80 && ((await call(`/projects/${sp}`)).body.revision as number) === rev1; i++) await sleep(100);
      await sleep(400);
      const rev2 = (await call(`/projects/${sp}`)).body.revision as number;
      const st1 = await stored();
      const afterSlider = await read();
      // the switch: off, then on again with the strength it had
      await spage.getByTestId('stab-toggle').click();
      await spage.waitForFunction(() => document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state') === 'off', undefined, { timeout: 8000 }).catch(() => {});
      const sOff = await stateOf();
      const offChecked = await spage.getByTestId('stab-toggle').getAttribute('aria-checked');
      await spage.getByTestId('stab-toggle').click();
      await spage.waitForFunction(() => { const st = document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state'); return st === 'on' || st === 'limited'; }, undefined, { timeout: 8000 }).catch(() => {});
      const st2 = await stored();
      // one undo returns the switch to off
      await spage.keyboard.press('Control+KeyZ');
      await spage.waitForFunction(() => document.querySelector('[data-testid=stab-panel]')?.getAttribute('data-state') === 'off', undefined, { timeout: 8000 }).catch(() => {});
      const sUndo = await stateOf();
      const rtl = await spage.evaluate(() => getComputedStyle(document.documentElement).direction);
      const standing = (await spage.getByTestId('stab-panel').innerText()).includes('בלי מודל');
      check('stabilisation block: not measured shows «ייצבו את הקליפ»; one press runs the job (measuring, with «עצירה»), the clip ends up on with a crop line, and the whole job is ONE revision', s0 === 'not-measured' && runVisible === 1 && sMeasuring === 'measuring' && stopVisible === 1 && (sOn === 'on') && jobRevisions === 1 && !!st0, { s0, runVisible, sMeasuring, stopVisible, sOn, jobRevisions, stored: st0 });
      check('stabilisation block: the crop line shows the stored zoom and its area (the operation\'s numbers), in Hebrew with the standing «בלי מודל» line', onShown.zoomPm === st0?.zoomPm && Math.abs(onShown.area - Math.round(1000 * (1 - 1e6 / (st0!.zoomPm ** 2))) / 10) < 1e-9 && /חיתוך שוליים/.test(onShown.text) && standing && rtl === 'rtl', { onShown, standing, rtl });
      check('stabilisation block: PageUp on the slider is +10 and leaving it is ONE commit; the crop line then shows the stored zoom', live === (st0?.strength ?? 0) + 10 && rev2 - rev1 === 1 && st1?.strength === live && afterSlider.zoomPm === st1?.zoomPm && afterSlider.strength === live, { live, commits: rev2 - rev1, stored: st1, afterSlider });
      check('stabilisation block: the switch turns it off (aria-checked false, the state «off», the measurement stays) and on again with the strength it had; one undo returns it to off', sOff === 'off' && offChecked === 'false' && st2?.strength === st1?.strength && sUndo === 'off' && sErrors.length === 0, { sOff, offChecked, before: st1?.strength, after: st2?.strength, sUndo, pageErrors: sErrors.slice(0, 3) });
      await sctx.close();
    }

    // editing craft (wave 7): Q with its toast and undo, a paste refused while a format is shown, the find panel's stated rules, and
    // the versions dialog's empty, saved and delete-with-confirmation states, each in the real editor (Hebrew). The owner's laptop
    // still has the real keyboard and the browser's own Ctrl+S / Ctrl+F dialogs.
    {
      console.log('\n# editing craft: Q and its undo toast, paste in a format, find rules, versions dialog');
      const doc0 = async (id: string) => (await call(`/projects/${id}`)).body.project;
      const poll = async (pred: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); for (;;) { if (await pred()) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } };
      const cp = (await call('/projects', { name: 'craft', width: 640, height: 360 })).body.project.id as string;
      const cpic = await upload(cp, picFile);
      const ca = (await txs(cp, [{ op: 'add_clip', args: { assetId: cpic.assetId, start: f(0), duration: f(60), withLinkedAudio: false } }])).results[0].output.clipId as string;
      const cTrack = (await doc0(cp)).sequences.seq_main.tracks.find((t: any) => t.clips.some((c: any) => c.id === ca)).id as string;
      const cb = (await txs(cp, [{ op: 'add_clip', args: { assetId: cpic.assetId, trackId: cTrack, start: f(60), duration: f(30), withLinkedAudio: false } }])).results[0].output.clipId as string;
      await txs(cp, [{ op: 'add_text', args: { text: 'ילדים הילד נעה', start: f(70), duration: f(30) } }]);
      const cvar = (await txs(cp, [{ op: 'add_variant', args: { name: 'Tall', width: 360, height: 640, fit: 'cover' } }])).results[0].output.variantId as string;
      const cctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
      await cctx.addInitScript('globalThis.__name = (f) => f');
      await cctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const cpage = await cctx.newPage();
      const send = (code: string, mods: { ctrl?: boolean; alt?: boolean } = {}) => cpage.evaluate(({ code, mods }) => { (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key: code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, bubbles: true, cancelable: true })); }, { code, mods });
      await cpage.goto(`${s.ownerUrl}&project=${cp}`);
      await cpage.getByTestId('timecode').waitFor({ timeout: 30000 });
      await cpage.waitForFunction(() => document.querySelectorAll('.clip').length >= 3, undefined, { timeout: 15000 });
      const hashOf = async () => sha256Hex(JSON.stringify(await doc0(cp)));
      await cpage.locator(`.clip[data-clip-id="${ca}"]`).click({ position: { x: 4, y: 4 } });
      await cpage.getByTestId('timecode').click();
      await cpage.getByTestId('craft-time-input').fill('20');
      await cpage.keyboard.press('Enter');
      await cpage.getByTestId('craft-time-entry').waitFor({ state: 'detached' });
      const h0 = await hashOf();
      await send('KeyQ');
      const toast = cpage.locator('.pf-toast, [role=status]').filter({ hasText: /נחתכו 20 פריימים/ }).first();
      await toast.waitFor({ timeout: 8000 }).catch(() => {});
      const said = (await toast.innerText().catch(() => '')).replace(/\s+/g, ' ');
      const stayed = (await cpage.getByText(/כותרות, מוזיקה וסמנים שאחרי החיתוך נשארו במקומם/).count()) > 0;
      const shortened = await poll(async () => fr(clipOf(await doc0(cp), ca).duration) === 40);
      await cpage.getByRole('button', { name: 'ביטול' }).first().click().catch(() => {});
      const undone = await poll(async () => (await hashOf()) === h0);
      check('Q (ripple trim): the toast says «נחתכו 20 פריימים» with «קליפ אחד זז», says that titles, music and markers after the cut stayed, and its «ביטול» returns the exact document', shortened && /נחתכו 20 פריימים · קליפ אחד זז/.test(said) && stayed && undone, { said, stayed, shortened, undone });
      await chooseFormat(cpage, cvar);
      await cpage.locator(`.clip[data-clip-id="${cb}"]`).click({ position: { x: 4, y: 4 } });
      await send('KeyV', { ctrl: true, alt: true });
      const said2 = await cpage.getByText('כשמוצג פורמט אחר אפשר להדביק רק בגרסה הראשית').first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      check('Ctrl+Alt+V while a format is shown says why it cannot paste (no dialog opens, nothing is changed)', said2 && (await cpage.getByTestId('craft-paste-dialog').count()) === 0, { said: said2 });
      await chooseFormat(cpage, '');
      await send('KeyF', { ctrl: true });
      await cpage.getByTestId('craft-find-input').fill('ילד');
      await cpage.getByTestId('craft-find-count').waitFor();
      await until2(async () => (await cpage.getByTestId('craft-find-count').getAttribute('data-total')), (v) => v === '1');
      const loose = await cpage.getByTestId('craft-find-count').getAttribute('data-total');
      await cpage.getByTestId('craft-find-option-wholeWord').check();
      await until2(async () => (await cpage.getByTestId('craft-find-count').getAttribute('data-kind')), (v) => v === 'none');
      const whole = await cpage.getByTestId('craft-find-count').getAttribute('data-total');
      const rule = await cpage.getByText('«ילד» לא ימצא «ילדים» ולא «הילד»').count();
      check('find: «ילד» finds the title without «מילה שלמה» (one text) and finds nothing with it; the rule is stated beside the switch (no prefix stripping)', loose === '1' && whole === '0' && rule === 1, { loose, whole, rule });
      await cpage.keyboard.press('Escape');
      await cpage.getByTestId('craft-versions-open').click();
      await cpage.getByTestId('craft-versions-empty').waitFor({ timeout: 8000 }).catch(() => {});
      const empty = await cpage.getByTestId('craft-versions-empty').count();
      await cpage.keyboard.press('Escape');
      await send('KeyS', { ctrl: true });
      await cpage.getByTestId('craft-save-version-input').fill('גרסה לבדיקה');
      await cpage.keyboard.press('Enter');
      await cpage.getByTestId('craft-save-version').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      await cpage.getByTestId('craft-versions-open').click();
      await cpage.getByTestId('craft-version-row-0').waitFor({ timeout: 8000 }).catch(() => {});
      const row = (await cpage.getByTestId('craft-version-row-0').innerText().catch(() => '')).replace(/\s+/g, ' ');
      await cpage.getByTestId('craft-version-row-0').getByTestId('craft-version-delete').click();
      await cpage.getByTestId('craft-version-delete-yes').click();
      await cpage.getByTestId('craft-versions-empty').waitFor({ timeout: 8000 }).catch(() => {});
      check('versions: «גרסאות» says honestly that nothing is saved yet; a saved version lists its name, «המדיה לא מועתקת» and «זהה למצב הנוכחי»; delete asks first and the list is empty again', empty === 1 && /גרסה לבדיקה/.test(row) && /המדיה לא מועתקת/.test(row) && /זהה למצב הנוכחי/.test(row) && (await cpage.getByTestId('craft-versions-empty').count()) === 1, { empty, row });
      await cctx.close();
    }

    // Space on a control (lead decision, wave 7 send integration; shortcutGate.ts spaceBelongsToControl): a button or switch with
    // KEYBOARD focus takes Space (it is pressed); after a mouse click on it, Space still plays and pauses the film, as before.
    console.log('\n# Space: a keyboard-focused control takes it, a mouse-focused one leaves it to play / pause');
    {
      const vid = path.join(art, 'space-key.mp4');
      ff(['-f', 'lavfi', '-t', '6', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '6', '-i', 'sine=frequency=330:sample_rate=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-shortest', vid]);
      const sp = (await call('/projects', { name: 'space key', width: 640, height: 360 })).body.project.id as string;
      const va = await upload(sp, vid);
      await txs(sp, [{ op: 'add_clip', args: { assetId: va.assetId, start: f(0) } }]);
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 3200 }, reducedMotion: 'reduce' });
      await ctx.addInitScript(`globalThis.__name = (f) => f`);
      await ctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
      const pg = await ctx.newPage();
      const errs: string[] = [];
      pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(`${s.ownerUrl}&project=${sp}`);
      await pg.getByTestId('timecode').waitFor({ timeout: 30000 });
      const sw = pg.getByTestId('master-limiter-switch');
      await sw.waitFor({ timeout: 15000 });
      const playing = async () => (await pg.getByTestId('play').getAttribute('data-playing')) === 'true';
      const limiterOf = async () => (await doc2(sp)).settings.limiter?.ceiling ?? null;
      const settle = async (want: number | null) => { for (let i = 0; i < 60; i++) { if ((await limiterOf()) === want) return true; await sleep(100); } return false; };
      // keyboard focus: reach the switch with Tab (one step back with Shift+Tab, one forward with Tab)
      await sw.focus();
      await pg.keyboard.press('Shift+Tab');
      await pg.keyboard.press('Tab');
      const kb = await sw.evaluate((el) => ({ active: document.activeElement === el, visible: el.matches(':focus-visible') }));
      await pg.keyboard.press('Space');
      const pressed = await settle(-1);
      await sleep(400);
      const playedOnKeyboard = await playing();
      check('Space on a switch reached with Tab presses the switch (the limiter is set) and does not play the film', kb.active && kb.visible && pressed && !playedOnKeyboard, { kb, limiter: await limiterOf(), playing: playedOnKeyboard });
      // mouse focus: click the switch (it turns the limiter off and keeps the focus, without :focus-visible), then Space plays
      if (playedOnKeyboard) await pg.keyboard.press('Space');
      // the focus leaves the switch first: Chromium keeps :focus-visible on an element that already had keyboard focus when it is
      // then clicked (the click does not move the focus), so a click on the still-focused switch would not be a mouse focus
      await pg.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await sw.click();
      const off = await settle(null);
      const ms = await sw.evaluate((el) => ({ active: document.activeElement === el, visible: el.matches(':focus-visible') }));
      await pg.keyboard.press('Space');
      let played = false;
      for (let i = 0; i < 40 && !played; i++) { played = await playing(); if (!played) await sleep(100); }
      const stillOff = (await limiterOf()) === null;
      await pg.keyboard.press('Space');
      let paused = false;
      for (let i = 0; i < 40 && !paused; i++) { paused = !(await playing()); if (!paused) await sleep(100); }
      check('after a mouse click on the switch (focus stays, not :focus-visible) Space plays and pauses the film and leaves the switch alone', off && ms.active && !ms.visible && played && paused && stillOff, { ms, off, played, paused, stillOff });
      check('Space rows: the page logged no script error', errs.length === 0, { errors: errs.slice(0, 4) });
      await ctx.close();
    }

    // marked ranges «פנינים» (wave 7 pearls track): marking a pearl with the viewer's form by keyboard, Escape closes only the form,
    // one undo takes the pearl back
    {
      console.log('\n# pearls: the form in the source viewer, Escape, one undo');
      const PID = { save: 'pearl-save', form: 'pearl-form', name: 'pearl-form-name' };
      const pe = (await call('/projects', { name: 'pearls interactions', width: 640, height: 360 })).body.project.id as string;
      const pa = (await upload(pe, picFile)).assetId as string;
      const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
      const ownerTx = async (ops: unknown[]) => { const r = await fetch(`${s.url}/api/v1/projects/${pe}/transactions`, { method: 'POST', headers: { origin: s.url, cookie, connection: 'close', 'content-type': 'application/json' }, body: JSON.stringify({ ops }) }); if (!r.ok) throw new Error(`owner tx: ${r.status} ${(await r.text()).slice(0, 200)}`); return r.json(); };
      await ownerTx([{ op: 'add_person', args: { name: 'אלף' } }]);
      // read as the owner: the agent token reads every pearl's name as '' (labels are family notes, peoplePrivacy.ts)
      const ownerDoc = async () => ((await (await fetch(`${s.url}/api/v1/projects/${pe}`, { headers: { origin: s.url, cookie, connection: 'close' } })).json()) as any).project;
      const rangesOf = async () => Object.values((await ownerDoc()).sourceRanges ?? {}) as any[];
      const revOf = async () => (await call(`/projects/${pe}`)).body.revision as number;
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
      await ctx.addInitScript(`globalThis.__name = (f) => f`);
      await ctx.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const pg = await ctx.newPage();
      const errs: string[] = [];
      pg.on('pageerror', (e) => errs.push(String(e)));
      await pg.goto(`${s.ownerUrl}&project=${pe}`);
      await pg.getByTestId('timecode').waitFor({ timeout: 30000 });
      await pg.getByTestId('rail-media').click();
      await pg.getByTestId(`more-${pa}`).click();
      await pg.getByTestId(`view-${pa}`).click();
      await pg.getByTestId('source-viewer').waitFor({ timeout: 15000 });
      await pg.waitForFunction(() => Number(document.querySelector('[data-testid=source-range]')?.getAttribute('data-out')) > 0, undefined, { timeout: 20000 });
      // In at frame 10, Out on frame 39 (Shift+→ is ten frames)
      await pg.keyboard.press('Shift+ArrowRight'); await sleep(150);
      await pg.keyboard.press('i'); await sleep(100);
      for (let i = 0; i < 3; i++) { await pg.keyboard.press('Shift+ArrowRight'); await sleep(150); }
      await pg.keyboard.press('ArrowLeft'); await sleep(150);
      await pg.keyboard.press('o'); await sleep(150);
      const marks = { in: await pg.getByTestId('source-range').getAttribute('data-in'), out: await pg.getByTestId('source-range').getAttribute('data-out') };
      const rev0 = await revOf();
      await pg.keyboard.press('p');
      await pg.getByTestId(PID.form).waitFor({ timeout: 5000 });
      await pg.getByTestId(PID.name).fill('בדיקה');
      await pg.keyboard.press('Escape');
      await sleep(300);
      const esc = { form: await pg.getByTestId(PID.form).count(), viewer: await pg.getByTestId('source-viewer').count(), focus: await pg.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null), commits: (await revOf()) - rev0 };
      check('pearls: Escape in the pearl form closes the form only (the viewer stays open, the focus is on «שמור כפנינה», nothing is committed)', esc.form === 0 && esc.viewer === 1 && esc.focus === PID.save && esc.commits === 0, { marks, esc });
      await pg.keyboard.press('p');
      await pg.getByTestId(PID.form).waitFor({ timeout: 5000 });
      await pg.getByTestId(PID.name).fill('הצעד הראשון');
      const typed = await pg.waitForFunction((id) => (document.querySelector(`[data-testid="${id}"]`) as HTMLInputElement | null)?.value === 'הצעד הראשון', PID.name, { timeout: 5000 }).then(() => true, () => false);
      await pg.keyboard.press('Enter');
      const saved = await until2(rangesOf, (rs) => rs.length === 1);
      const rs = await rangesOf();
      const commits = (await revOf()) - rev0;
      const span = rs[0]?.span ? [T.frameIndexAt(rs[0].span.start, R), T.frameIndexAt(rs[0].span.end, R)] : null;
      check('pearls: I, O, P, a name and Enter mark one pearl in one commit, its span the marks [10, 40) and its name as typed', saved && rs.length === 1 && commits === 1 && JSON.stringify(span) === '[10,40]' && rs[0].label === 'הצעד הראשון', { marks, typed, commits, span, label: rs[0]?.label });
      await pg.keyboard.press('Escape');
      await pg.getByTestId('source-viewer').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
      await pg.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
      await pg.keyboard.press('Control+z');
      const undone = await until2(rangesOf, (x2) => x2.length === 0);
      const after = await ownerDoc();
      check('pearls: one Ctrl+Z takes the pearl back and the document holds no sourceRanges key again', undone && !Object.hasOwn(after, 'sourceRanges'), { undone, hasKey: Object.hasOwn(after, 'sourceRanges') });
      check('pearls rows: the page logged no script error', errs.length === 0, { errors: errs.slice(0, 4) });
      await ctx.close();
      // «מי בקליפ?» refused in words for a non-owner credential is not driven here: the editor boots only on the owner's session
      // (a page carrying an agent's bearer header stops at «כדי לפתוח את העורך כבעלים…»); the refusal is held by pearls.test.ts
      // (403 human_tag_required for every non-owner credential) and its Hebrew by pearls-wording.test.ts
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
