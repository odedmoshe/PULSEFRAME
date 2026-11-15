/**
 * Phase 3 gate (SPEC Appendix D): keyboard-only import/arrange/trim/split/keyframe workflow, direct
 * manipulation, command palette, remappable shortcuts, presence without stealing control, visual baselines.
 * Real server, real browser, real MCP client.   pnpm build && pnpm proof:phase3
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { transformAt, type ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture, readBarcode } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase3');
const ev = path.join(root, 'docs/evidence');
const base = path.join(ev, 'baselines');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const R = { num: 30, den: 1 };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  fs.mkdirSync(base, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4') });
  const s = await startServer({ port: 8794, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const browser = await chromium.launch();
  // Reduced motion: deterministic screenshots (no mid-animation frames) and it exercises that preference.
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  try {
    await page.goto(s.ownerUrl);
    await page.waitForFunction(() => document.querySelector('[data-testid=project-name]')?.textContent === 'הפרויקט שלי');
    const pid: string = (await (await fetch(`${s.url}/api/v1/projects`, { headers: h })).json()).projects[0].id;
    const getDoc = async () => (await (await fetch(`${s.url}/api/v1/projects/${pid}`, { headers: h })).json()) as { project: ProjectDocument; revision: number };
    const rev = async () => Number((await page.getByTestId('revision').textContent())!.replace(/\D+/g, ''));
    const waitRev = (r: number) => page.waitForFunction((x) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) >= x, r);
    const tc = () => page.getByTestId('timecode').textContent();
    const key = async (k: string, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
    const clips = async (kind: string) => (await getDoc()).project.sequences.seq_main!.tracks.filter((t) => t.kind === kind).flatMap((t) => t.clips);
    /** Press a key that should commit exactly one transaction. */
    const edit = async (k: string) => { const r = await rev(); await key(k); await waitRev(r + 1); return (await rev()) - r; };

    console.log('\n# keyboard-only workflow (no pointer input in this section)');
    // Import: reach the file control by Tab, then choose a file (the OS file dialog itself cannot be driven headlessly).
    let tabs = 0;
    while (tabs++ < 40 && !(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.testid === 'file-input'))) await key('Tab');
    check('import control is reachable with Tab and shows a visible focus ring', tabs <= 40 && (await page.evaluate(() => getComputedStyle(document.activeElement!.closest('label')!).outlineStyle !== 'none')), { tabs });
    await page.getByTestId('file-input').setInputFiles(fixture.file);
    await page.locator('.assets li').first().waitFor();
    tabs = 0;
    while (tabs++ < 10 && !(await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset?.testid?.startsWith('add-ast')))) await key('Tab');
    let r0 = await rev();
    await key('Enter');
    await waitRev(r0 + 1);
    check('arrange: "add to timeline" activated with Enter creates the linked clips', (await clips('video')).length === 1 && (await clips('audio')).length === 1);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await key('Alt+ArrowDown');
    check('select next clip from the keyboard', (await page.locator('.clip.selected').count()) === 1);
    await key('Shift+ArrowRight', 3);
    check('split with S at the playhead (frame 30): one transaction', (await edit('KeyS')) === 1 && (await clips('video')).length === 2 && (await tc()) === '00:00:01:00');
    // Select the right-hand video clip, trim its start 10 frames in, then nudge it one frame later.
    const [, right] = await clips('video');
    for (let i = 0; i < 8 && (await page.locator('.clip.selected').getAttribute('data-clip-id')) !== right!.id; i++) await key('Alt+ArrowDown');
    await key('Shift+ArrowRight');
    await edit('BracketLeft');
    let v = await clips('video');
    check('trim start with [ : clip now starts at frame 40 and its source in-point advanced with it', T.frameIndexAt(v[1]!.start, R) === 40 && v[1]!.type === 'media' && T.frameIndexAt(v[1]!.sourceIn, R) === 40);
    await edit('Alt+ArrowRight');
    v = await clips('video');
    const a = await clips('audio');
    check('nudge with Alt+→ moves the clip and its linked audio by exactly one frame', T.frameIndexAt(v[1]!.start, R) === 41 && T.frameIndexAt(a[1]!.start, R) === 41);
    // Keyframes: add text (T), key it (K), move 20 frames, change vertical position from the keyboard, step between keys.
    await key('Home');
    r0 = await rev();
    await key('KeyT');
    await waitRev(r0 + 1);
    await edit('KeyK');
    await key('Shift+ArrowRight', 2);
    await page.getByTestId('transform-y').focus();
    r0 = await rev();
    await key('ArrowRight');
    await waitRev(r0 + 1);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    const text = (await clips('text'))[0]!;
    const ys = text.keyframes?.y ?? [];
    check('keyframe workflow: K sets keys at the playhead; changing an animated property 20 frames later adds a second key', ys.length === 2 && T.frameIndexAt(ys[0]!.time, R) === 0 && T.frameIndexAt(ys[1]!.time, R) === 20 && ys[1]!.value !== ys[0]!.value, ys.map((k) => [T.frameIndexAt(k.time, R), k.value]));
    const mid = transformAt(text, T.frameTime(10, R)).y;
    check('the property interpolates between the two keys', mid > Math.min(ys[0]!.value, ys[1]!.value) && mid < Math.max(ys[0]!.value, ys[1]!.value), { at10: mid });
    await key('Comma');
    const atPrev = await tc();
    await key('Period');
    check('previous/next keyframe navigation ( , and . )', atPrev === '00:00:00:00' && (await tc()) === '00:00:00:20' && (await page.locator('.clip.selected .kf').count()) >= 2);
    r0 = await rev();
    await key('Control+KeyZ');
    await waitRev(r0 + 1);
    check('undo from the keyboard removes the second keyframe', ((await clips('text'))[0]!.keyframes?.y ?? []).length === 1);

    console.log('\n# command palette and remappable shortcuts');
    await key('Control+KeyK');
    await page.getByTestId('palette-dialog').waitFor();
    check('Ctrl+K opens a modal dialog and focuses the search field', (await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.testid)) === 'palette-input' && (await page.getByTestId('palette-dialog').getAttribute('aria-modal')) === 'true');
    const before = await tc();
    await key('ArrowRight');
    check('editing shortcuts are inert while the palette is open', (await tc()) === before);
    await page.getByTestId('palette-input').fill('redo');
    const firstEn = await page.getByTestId('palette-option').first().getAttribute('data-command-id');
    await page.getByTestId('palette-input').fill('פיצול');
    const firstHe = await page.getByTestId('palette-option').first().getAttribute('data-command-id');
    check('search finds commands in either language regardless of the interface language', firstEn === 'history.redo' && firstHe === 'edit.split', { firstEn, firstHe });
    await page.getByTestId('palette-input').fill('ביצוע מחדש');
    r0 = await rev();
    await key('Enter');
    await waitRev(r0 + 1);
    check('Enter runs the command (redo) and closes the palette', (await page.getByTestId('palette-dialog').count()) === 0 && ((await clips('text'))[0]!.keyframes?.y ?? []).length === 2);
    // Rebind split from S to X.
    await key('Control+KeyK');
    await page.getByTestId('palette-shortcuts').click();
    await page.getByTestId('shortcut-table').waitFor();
    await page.locator('[data-testid=shortcut-table] [data-command-id="edit.split"] button').first().click();
    await key('KeyX');
    await key('Escape');
    if (await page.getByTestId('palette-dialog').count()) await key('Escape');
    await page.getByTestId('preview').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 8 && (await page.locator('.clip.selected').getAttribute('data-track-kind')) !== 'video'; i++) await key('Alt+ArrowDown');
    await key('Home');
    await key('Shift+ArrowRight');
    const nBefore = (await clips('video')).length;
    r0 = await rev();
    await key('KeyS');
    await page.waitForTimeout(300);
    const sStill = (await rev()) === r0;
    await key('KeyX');
    await waitRev(r0 + 1);
    check('remapped shortcut: split now runs on X and no longer on S; the setting is personal (localStorage), not in the project', sStill && (await clips('video')).length === nBefore + 1 && (await page.evaluate(() => localStorage.getItem('pf.keymap.v1')))!.includes('KeyX') && !JSON.stringify((await getDoc()).project).includes('KeyX'));

    console.log('\n# direct manipulation: one gesture = one transaction');
    const firstClip = page.locator('[data-track-kind=video]').first();
    const idMoved = await firstClip.getAttribute('data-clip-id');
    const box0 = (await firstClip.boundingBox())!;
    // The first video clip is [0,10) after the split; drag the LAST video clip instead to free space on the right.
    const last = page.locator('[data-track-kind=video]').last();
    const lastId = await last.getAttribute('data-clip-id');
    const lb = (await last.boundingBox())!;
    const startBefore = T.frameIndexAt((await clips('video')).find((c) => c.id === lastId)!.start, R);
    r0 = await rev();
    await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb.x + lb.width / 2 + 60, lb.y + lb.height / 2, { steps: 6 });
    const ghostSeen = (await page.getByTestId('clip-ghost').count()) === 1;
    const midRev = await rev();
    await page.mouse.move(lb.x + lb.width / 2 + 180, lb.y + lb.height / 2, { steps: 6 });
    await page.mouse.up();
    await waitRev(r0 + 1);
    await page.waitForTimeout(200);
    const startAfter = T.frameIndexAt((await clips('video')).find((c) => c.id === lastId)!.start, R);
    check('drag to move: a ghost previews the move, nothing is committed mid-drag, release commits exactly one transaction on a frame boundary', ghostSeen && midRev === r0 && (await rev()) === r0 + 1 && startAfter - startBefore === 60, { startBefore, startAfter, idMoved: idMoved === lastId ? 'same' : 'other', firstWidth: Math.round(box0.width) });
    const lb2 = (await last.boundingBox())!;
    const durBefore = T.frameIndexAt((await clips('video')).find((c) => c.id === lastId)!.duration, R);
    r0 = await rev();
    await page.mouse.move(lb2.x + lb2.width - 2, lb2.y + lb2.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb2.x + lb2.width - 62, lb2.y + lb2.height / 2, { steps: 6 });
    await page.mouse.up();
    await waitRev(r0 + 1);
    const durAfter = T.frameIndexAt((await clips('video')).find((c) => c.id === lastId)!.duration, R);
    check('drag the right edge to trim: one transaction, duration shortened by the dragged distance (20 frames at 90 px/s)', (await rev()) === r0 + 1 && durBefore - durAfter === 20, { durBefore, durAfter });
    r0 = await rev();
    await last.click();
    await page.waitForTimeout(150);
    check('a plain click selects without committing anything', (await rev()) === r0 && (await page.locator('.clip.selected').getAttribute('data-clip-id')) === lastId);
    // Canvas handles on the text layer.
    await page.locator('[data-track-kind=text]').first().click();
    await key('Home');
    await key('Shift+ArrowRight');
    await page.getByTestId('canvas-handles').waitFor();
    const mv = page.locator('[data-testid=canvas-handles] [data-handle=move]');
    const mb = (await mv.boundingBox())!;
    const cb = (await page.getByTestId('preview').boundingBox())!;
    const xBefore = transformAt((await clips('text'))[0]!, T.frameTime(10, R)).x;
    r0 = await rev();
    await page.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await page.mouse.down();
    await page.mouse.move(mb.x + mb.width / 2 + 40, mb.y + mb.height / 2 + 2, { steps: 5 });
    await page.mouse.up();
    await waitRev(r0 + 1);
    const xAfter = transformAt((await clips('text'))[0]!, T.frameTime(10, R)).x;
    check('canvas handle: dragging the layer moves it by the dragged fraction of the frame in one transaction', (await rev()) === r0 + 1 && Math.abs(xAfter - xBefore - 40 / cb.width) < 0.01 && String(xAfter).length <= 7, { xBefore, xAfter, expectedDelta: +(40 / cb.width).toFixed(4) });
    const rot = page.locator('[data-testid=canvas-handles] [data-handle=rotate]');
    await rot.focus();
    r0 = await rev();
    await key('Shift+ArrowRight');
    await waitRev(r0 + 1);
    check('canvas handle keyboard equivalent: Shift+→ on the rotation handle rotates by 15°', Math.abs(transformAt((await clips('text'))[0]!, T.frameTime(10, R)).rotation - 15) < 1e-9);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());

    console.log('\n# presence: the agent is visible, and never takes the view unless followed');
    const mcp = new Client({ name: 'phase3-agent', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${s.auth.tokens.agent}` } } }));
    const view = (frame: number, selection: string[] = []) => mcp.callTool({ name: 'set_view', arguments: { projectId: pid, frame, selection, label: 'בודק מעבר' } });
    const mine = await tc();
    const mySel = await page.locator('.clip.selected').getAttribute('data-clip-id');
    const r1 = await rev();
    await view(72, [lastId!]);
    await page.locator('[data-testid=ghost-playhead][data-frame="72"]').waitFor();
    check('agent ghost: labelled marker and dashed outline appear; my playhead, selection and the revision are untouched', (await tc()) === mine && (await page.locator('.clip.selected').getAttribute('data-clip-id')) === mySel && (await page.locator('.clip.ghost-selected').getAttribute('data-clip-id')) === lastId && (await rev()) === r1 && (await page.getByTestId('ghost-playhead').textContent())!.includes('בודק מעבר'));
    await page.getByTestId('follow-agent').check();
    await view(48);
    await page.waitForFunction(() => document.querySelector('[data-testid=timecode]')?.textContent === '00:00:01:18');
    check('Follow Agent (opt-in): my playhead follows the agent', true);
    await page.getByTestId('preview').click({ position: { x: 5, y: 5 } });
    await key('ArrowRight');
    const afterManual = await tc();
    await view(5);
    await page.locator('[data-testid=ghost-playhead][data-frame="5"]').waitFor();
    await page.waitForTimeout(200);
    check('a manual seek ends Follow Agent; later agent moves no longer move my view', !(await page.getByTestId('follow-agent').isChecked()) && (await tc()) === afterManual && afterManual === '00:00:01:19');
    await mcp.close();

    console.log('\n# bilingual layout and visual baselines');
    await key('Home');
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); });
    const shots: Record<string, string> = {};
    const shoot = async (name: string) => { const f = path.join(art, `${name}.png`); await page.screenshot({ path: f }); shots[name] = f; };
    await shoot('editor-he');
    await page.getByTestId('lang-toggle').click();
    await page.waitForFunction(() => document.documentElement.dir === 'ltr');
    const order = await page.evaluate(() => { const l = document.querySelector('.library')!.getBoundingClientRect().left; const i = document.querySelector('.inspector')!.getBoundingClientRect().left; return { libraryLeft: l, inspectorLeft: i, timelineDir: document.querySelector('.timeline')!.getAttribute('dir') }; });
    await shoot('editor-en');
    check('English: library on the left, inspector on the right; timeline stays LTR in both languages', order.libraryLeft < order.inspectorLeft && order.timelineDir === 'ltr', order);
    await key('Control+KeyK');
    await page.getByTestId('palette-dialog').waitFor();
    await shoot('palette-en');
    await key('Escape');
    await page.getByTestId('lang-toggle').click();
    const baselines: Record<string, unknown> = {};
    for (const [name, file] of Object.entries(shots)) {
      const ref = path.join(base, `phase3-${name}.png`);
      if (!fs.existsSync(ref) || process.env.PF_UPDATE_BASELINES === '1') { fs.copyFileSync(file, ref); baselines[name] = 'baseline written'; continue; }
      const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-i', ref, '-lavfi', 'ssim', '-f', 'null', '-'], { encoding: 'utf8' });
      baselines[name] = Number(/All:([\d.]+)/.exec(r.stderr)?.[1]);
    }
    const feed = await page.locator('[data-testid=activity] li').first().textContent();
    check('activity feed is written in the interface language (Hebrew), not in server English', /[\u0590-\u05FF]/.test(feed ?? '') && !/Keyframe|Moved|Trimmed/.test(feed ?? ''), feed);
    check('visual baselines: screenshots match the committed baselines (SSIM ≥ 0.98), or were written on first run', Object.values(baselines).every((b) => b === 'baseline written' || (typeof b === 'number' && b >= 0.98)), baselines);

    console.log('\n# source viewer');
    const svBefore = await getDoc();
    const assetId = Object.values(svBefore.project.assets).find((a) => a.kind === 'video')!.id;
    const clipsBefore = svBefore.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).length;
    const srcCode = async () => {
      const shot = await page.evaluate(() => { const cv = document.querySelector('[data-testid=source-canvas]') as HTMLCanvasElement; return { w: cv.width, frame: cv.dataset.frame, quality: cv.dataset.quality, data: Array.from(cv.getContext('2d')!.getImageData(0, Math.round(cv.height / 12), cv.width, 1).data.filter((_, i) => i % 4 !== 3)) }; });
      return { code: readBarcode(Uint8Array.from(shot.data), shot.w, 3, { x: 0, y: 0, w: shot.w, h: 0 }), frame: Number(shot.frame) };
    };
    const srcAt = async (f: number) => { await page.waitForFunction((t) => { const cv = document.querySelector('[data-testid=source-canvas]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, f, { timeout: 15000 }); return (await srcCode()).code; };
    await page.getByTestId(`view-${assetId}`).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('source-viewer').waitFor();
    const svFirst = await srcAt(0);
    await page.getByTestId('source-scrub').fill('30');
    const at30 = await srcAt(30);
    await page.keyboard.press('i'); // mark in at frame 30
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight'); // +40
    await page.keyboard.press('ArrowRight'); // 71
    const at71 = await srcAt(71);
    await page.keyboard.press('o'); // frame 71 is the last one included
    const svRange = await page.getByTestId('source-range').evaluate((el) => ({ in: Number((el as HTMLElement).dataset.in), out: Number((el as HTMLElement).dataset.out) }));
    // shortcuts pressed in the dialog must not reach the timeline behind it
    const playheadBefore = await page.getByTestId('timecode').textContent();
    await page.keyboard.press('Home');
    await page.keyboard.press('m');
    const untouched = (await page.getByTestId('timecode').textContent()) === playheadBefore && (await getDoc()).revision === svBefore.revision;
    await page.getByTestId('source-play').click();
    await page.waitForFunction(() => Number((document.querySelector('[data-testid=source-canvas]') as HTMLCanvasElement)?.dataset.frame) > 80, undefined, { timeout: 8000 }).catch(() => {});
    const svPlayed = (await srcCode()).frame > 80;
    await page.getByTestId('source-add').click();
    await page.getByTestId('source-viewer').waitFor({ state: 'detached' });
    const focusBack = await page.evaluate((id) => (document.activeElement as HTMLElement | null)?.dataset?.testid === `view-${id}`, assetId);
    let svAfter = await getDoc();
    for (let i = 0; i < 50 && svAfter.revision === svBefore.revision; i++) { await new Promise((r) => setTimeout(r, 100)); svAfter = await getDoc(); }
    const svAdded = svAfter.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).filter((c) => !svBefore.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).some((o) => o.id === c.id));
    const pic = svAdded.find((c) => c.type === 'media' && svAfter.project.sequences.seq_main!.tracks.find((tr) => tr.clips.includes(c))!.kind === 'video') as any;
    // the timeline shows source frame 30 at the new clip's svFirst frame and 71 at its last
    const startFrame = pic ? T.frameIndexAt(pic.start, R) : -1;
    const stillCode = async (index: number) => {
      const png = Buffer.from(await (await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=${index}`, { headers: h })).arrayBuffer());
      const r = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'image2pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 1 << 28 });
      const w = svAfter.project.settings.width, hgt = svAfter.project.settings.height;
      // the 16:9 picture is fitted into the project frame: find its rectangle
      const ph = Math.round((w * 360) / 640), py = Math.round((hgt - ph) / 2);
      return readBarcode(new Uint8Array(r.stdout), w, 3, { x: 0, y: py, w, h: ph });
    };
    const shownFirst = pic ? await stillCode(startFrame) : -1, shownLast = pic ? await stillCode(startFrame + 41) : -1;
    check('source viewer: opens from the library by keyboard, shows the file\'s own frames (0, 30, 71 by barcode), plays; I and O mark a range of 42 frames; "add" places exactly that range at the end of the timeline as one transaction (picture + linked sound) and the timeline then shows source frames 30 and 71 at its first and last frame; shortcuts typed in the viewer do not move the timeline behind it; focus returns to the button', svFirst === 0 && at30 === 30 && at71 === 71 && svRange.in === 30 && svRange.out === 72 && untouched && svPlayed && focusBack && svAfter.revision === svBefore.revision + 1 && svAdded.length === 2 && !!pic && T.frameIndexAt(pic.sourceIn, R) === 30 && T.frameIndexAt(pic.duration, R) === 42 && shownFirst === 30 && shownLast === 71, { svFirst, at30, at71, svRange, untouched, svPlayed, focusBack, revisions: [svBefore.revision, svAfter.revision], svAdded: svAdded.length, clipsBefore, sourceIn: pic && T.frameIndexAt(pic.sourceIn, R), frames: pic && T.frameIndexAt(pic.duration, R), shownFirst, shownLast });

    console.log('\n# insert at the playhead');
    const ib = await getDoc();
    const vTrack = (d: ProjectDocument) => d.sequences.seq_main!.tracks.find((tr) => tr.clips.some((c) => c.id === pic.id))!;
    const startOf = T.frameIndexAt(pic.start, R);
    // put the playhead 10 frames into the clip added above, then insert source frames 100..119 there
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Home');
    for (let i = 0; i < Math.floor((startOf + 10) / 10); i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < (startOf + 10) % 10; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction((t) => document.querySelector('[data-testid=preview]')?.getAttribute('data-frame') === String(t), startOf + 10, { timeout: 10000 }).catch(() => {});
    const atFrame = Number(await page.getByTestId('preview').getAttribute('data-frame'));
    await page.getByTestId(`view-${assetId}`).click();
    await page.getByTestId('source-viewer').waitFor();
    await page.getByTestId('source-scrub').fill('100');
    await srcAt(100);
    await page.keyboard.press('i');
    await page.getByTestId('source-scrub').fill('119');
    await srcAt(119);
    await page.keyboard.press('o');
    await page.getByTestId('source-insert').click();
    await page.getByTestId('source-viewer').waitFor({ state: 'detached' });
    let ia = await getDoc();
    for (let i = 0; i < 50 && ia.revision === ib.revision; i++) { await new Promise((r) => setTimeout(r, 100)); ia = await getDoc(); }
    const row = vTrack(ia.project).clips.filter((c) => T.frameIndexAt(c.start, R) >= startOf).sort((a, b) => T.cmp(a.start, b.start)).map((c: any) => [T.frameIndexAt(c.start, R) - startOf, T.frameIndexAt(c.duration, R), T.frameIndexAt(c.sourceIn, R)]);
    const k = atFrame - startOf;
    const shown = [await stillCode(atFrame - 1), await stillCode(atFrame), await stillCode(atFrame + 19), await stillCode(atFrame + 20), await stillCode(startOf + 41 + 20)];
    const lenBefore = T.frameIndexAt(ib.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).reduce((m, c) => T.max(m, T.add(c.start, c.duration)), T.ZERO), R);
    const lenAfter = T.frameIndexAt(ia.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).reduce((m, c) => T.max(m, T.add(c.start, c.duration)), T.ZERO), R);
    check('"insert at the playhead" from the source viewer is one transaction: the clip under the playhead is split there, the 20-frame range sits in the gap, everything later moves 20 frames, and the timeline shows the frames in order (…, before the cut, the inserted 100–119, then the continuation)', atFrame === startOf + 10 && ia.revision === ib.revision + 1 && JSON.stringify(row) === JSON.stringify([[0, k, 30], [k, 20, 100], [k + 20, 42 - k, 30 + k]]) && JSON.stringify(shown) === JSON.stringify([30 + k - 1, 100, 119, 30 + k, 71]) && lenAfter === lenBefore + 20, { atFrame, startOf, row, shown, lenBefore, lenAfter, revisions: [ib.revision, ia.revision] });

    console.log('\n# overwrite at the playhead');
    // the playhead is still at atFrame (start of the inserted 100–119 range): overwrite its first 10 frames with source 60–69
    const ob = await getDoc();
    await page.getByTestId(`view-${assetId}`).click();
    await page.getByTestId('source-viewer').waitFor();
    await page.getByTestId('source-scrub').fill('60');
    await srcAt(60);
    await page.keyboard.press('i');
    await page.getByTestId('source-scrub').fill('69');
    await srcAt(69);
    await page.keyboard.press('o');
    await page.getByTestId('source-overwrite').click();
    await page.getByTestId('source-viewer').waitFor({ state: 'detached' });
    let oa = await getDoc();
    for (let i = 0; i < 50 && oa.revision === ob.revision; i++) { await new Promise((r) => setTimeout(r, 100)); oa = await getDoc(); }
    const endOf = (d: ProjectDocument) => T.frameIndexAt(d.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).reduce((m, c) => T.max(m, T.add(c.start, c.duration)), T.ZERO), R);
    const oShown = [await stillCode(atFrame - 1), await stillCode(atFrame), await stillCode(atFrame + 9), await stillCode(atFrame + 10), await stillCode(atFrame + 19), await stillCode(atFrame + 20)];
    const overlaps = oa.project.sequences.seq_main!.tracks.some((tr) => [...tr.clips].sort((a, b) => T.cmp(a.start, b.start)).some((c, i, arr) => i > 0 && T.lt(c.start, T.add(arr[i - 1]!.start, arr[i - 1]!.duration))));
    check('"overwrite at the playhead" replaces exactly the range\'s length on the picture and sound tracks in one transaction: the timeline keeps its length, nothing later moves, and it shows the new frames 60–69 followed by what was already there (110–119, then the continuation)', oa.revision === ob.revision + 1 && endOf(oa.project) === endOf(ob.project) && !overlaps && JSON.stringify(oShown) === JSON.stringify([30 + k - 1, 60, 69, 110, 119, 30 + k]), { oShown, lengths: [endOf(ob.project), endOf(oa.project)], overlaps, revisions: [ob.revision, oa.revision] });

    console.log('\n# slip');
    const sb = await getDoc();
    const slipClip = sb.project.sequences.seq_main!.tracks.filter((tr) => tr.kind === 'video').flatMap((tr) => tr.clips).find((c) => T.frameIndexAt(c.start, R) === atFrame)!;
    await page.locator(`.clip[data-clip-id="${slipClip.id}"]`).click();
    for (let i = 0; i < 3; i++) await key('Control+Alt+ArrowRight');
    await key('Control+Alt+Shift+ArrowRight');
    let sa = await getDoc();
    for (let i = 0; i < 50 && sa.revision < sb.revision + 4; i++) { await new Promise((r) => setTimeout(r, 100)); sa = await getDoc(); }
    const slipped = sa.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).find((c) => c.id === slipClip.id) as any;
    const slipShown = [await stillCode(atFrame - 1), await stillCode(atFrame), await stillCode(atFrame + 9), await stillCode(atFrame + 10)];
    check('slip by keyboard (three single frames and one step of ten): the selected clip keeps its place and length and now shows source 73–82; its neighbours are unchanged', sa.revision === sb.revision + 4 && T.eq(slipped.start, slipClip.start) && T.eq(slipped.duration, slipClip.duration) && T.frameIndexAt(slipped.sourceIn, R) === 73 && JSON.stringify(slipShown) === JSON.stringify([30 + k - 1, 73, 82, 110]), { slipShown, sourceIn: T.frameIndexAt(slipped.sourceIn, R), revisions: [sb.revision, sa.revision] });

    console.log('\n# reverse');
    const rb0 = await getDoc();
    await page.locator(`.clip[data-clip-id="${slipClip.id}"]`).click(); // the clip showing source 73–82 at atFrame..atFrame+9
    await page.getByTestId('reverse-toggle').click();
    let ra = await getDoc();
    for (let i = 0; i < 50 && ra.revision === rb0.revision; i++) { await new Promise((r) => setTimeout(r, 100)); ra = await getDoc(); }
    const revShown: number[] = []; for (let i = -1; i <= 10; i++) revShown.push(await stillCode(atFrame + i));
    const revClip = ra.project.sequences.seq_main!.tracks.flatMap((tr) => tr.clips).find((c) => c.id === slipClip.id) as any;
    // the paused preview draws the same frame as the still (focus first leaves the checkbox: shortcuts are off while a field has focus)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Home');
    for (let i = 0; i < Math.floor((atFrame + 2) / 10); i++) await page.keyboard.press('Shift+ArrowRight');
    for (let i = 0; i < (atFrame + 2) % 10; i++) await page.keyboard.press('ArrowRight');
    await page.waitForFunction((t) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(t) && cv?.dataset.quality === 'full'; }, atFrame + 2, { timeout: 15000 }).catch(() => {});
    const previewFrame = Number(await page.getByTestId('preview').getAttribute('data-frame'));
    const previewCode = await page.evaluate(() => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const ph = (cv.width * 360) / 640, py = (cv.height - ph) / 2; const row = cv.getContext('2d')!.getImageData(0, Math.round(py + ph / 12), cv.width, 1).data; return { w: cv.width, data: Array.from(row.filter((_, k) => k % 4 !== 3)) }; }).then((x) => readBarcode(Uint8Array.from(x.data), x.w, 3, { x: 0, y: 0, w: x.w, h: 0 }));
    // the exported file shows the same order (server export of just this stretch, read by barcode)
    const exJob = (await (await fetch(`${s.url}/api/v1/projects/${pid}/exports`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ range: { startFrame: atFrame - 1, endFrame: atFrame + 11 }, quality: 'high' }) })).json()) as any;
    let exStatus = '';
    for (let i = 0; i < 600; i++) { exStatus = ((await (await fetch(`${s.url}/api/v1/jobs/${exJob.jobId}`, { headers: h })).json()) as any).status; if (['succeeded', 'failed', 'canceled'].includes(exStatus)) break; await new Promise((r) => setTimeout(r, 200)); }
    const exFile = path.join(art, 'reverse-range.mp4');
    fs.writeFileSync(exFile, Buffer.from(await (await fetch(`${s.url}/api/v1/jobs/${exJob.jobId}/output`, { headers: h })).arrayBuffer()));
    const exRaw = spawnSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', exFile, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 }).stdout;
    const ew = ra.project.settings.width, eh = ra.project.settings.height, eph = Math.round((ew * 360) / 640), epy = Math.round((eh - eph) / 2), efb = ew * eh * 3;
    const exported = Array.from({ length: Math.floor(exRaw.length / efb) }, (_, i) => readBarcode(new Uint8Array(exRaw.buffer, exRaw.byteOffset + i * efb, efb), ew, 3, { x: 0, y: epy, w: ew, h: eph }));
    const marked = await page.locator(`.clip[data-clip-id="${slipClip.id}"]`).getAttribute('data-reverse');
    await page.locator(`.clip[data-clip-id="${slipClip.id}"]`).click();
    await page.getByTestId('reverse-toggle').click();
    for (let i = 0; i < 50 && ra.revision !== rb0.revision + 2; i++) { await new Promise((r) => setTimeout(r, 100)); ra = await getDoc(); }
    const fwdAgain = [await stillCode(atFrame), await stillCode(atFrame + 9)];
    check('"play backwards" in the Inspector: the clip keeps its place and length and its ten frames now show source 82 down to 73 on server stills (neighbours unchanged), the paused preview shows the same frame as the still, an exported file of that stretch shows the same twelve frames in the same order, the clip is marked on the timeline, and unchecking restores 73…82', JSON.stringify(revShown) === JSON.stringify([30 + k - 1, 82, 81, 80, 79, 78, 77, 76, 75, 74, 73, 110]) && revClip.reverse === true && T.eq(revClip.start, slipClip.start) && T.eq(revClip.duration, slipClip.duration) && previewFrame === atFrame + 2 && previewCode === 80 && exStatus === 'succeeded' && JSON.stringify(exported) === JSON.stringify(revShown) && marked === 'true' && JSON.stringify(fwdAgain) === JSON.stringify([73, 82]), { revShown, exported, exStatus, previewFrame, previewCode, marked, fwdAgain });

    console.log('\n# close gaps');
    const gb = await getDoc();
    const gEnd = endOf(gb.project);
    await fetch(`${s.url}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ op: 'add_text', args: { text: 'far', start: T.frameTime(gEnd + 90, R), duration: T.frameTime(30, R) } }] }) });
    await page.waitForFunction((n) => Number(document.querySelector('[data-testid=revision]')?.textContent?.replace(/\D+/g, '')) > n, gb.revision, { timeout: 8000 }).catch(() => {});
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await key('Control+KeyK');
    await page.getByTestId('palette-input').fill('close empty gaps');
    const gapCmd = await page.getByTestId('palette-option').first().getAttribute('data-command-id');
    await key('Enter');
    let ga = await getDoc();
    /** Frames covered by at least one clip on any track. */
    const covered = (d: ProjectDocument) => { const on = new Set<number>(); for (const tr of d.sequences.seq_main!.tracks) for (const c of tr.clips) for (let i = T.frameIndexAt(c.start, R), e = i + T.frameIndexAt(c.duration, R); i < e; i++) on.add(i); return on.size; };
    const wantEnd = covered(gb.project) + 30; // everything that was covered, plus the late title
    for (let i = 0; i < 50 && endOf(ga.project) !== wantEnd; i++) { await new Promise((r) => setTimeout(r, 100)); ga = await getDoc(); }
    check('"close empty gaps" from the command palette removes all time that was empty on every track (including the 90 frames before a late title) in one transaction: the timeline is exactly as long as its covered frames, and nothing covered was lost', gapCmd === 'edit.closeGaps' && endOf(ga.project) === wantEnd && covered(ga.project) === wantEnd && ga.revision === gb.revision + 2, { gapCmd, endBefore: gEnd, coveredBefore: covered(gb.project), endAfter: endOf(ga.project), coveredAfter: covered(ga.project), revisions: [gb.revision, ga.revision] });

    console.log('\n# frames during playback');
    // While playing, read the barcode straight off the preview canvas together with the frame number the player says it drew,
    // then compare with the server still of that same frame. (Paused frames are compared elsewhere; this is the moving picture.)
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Home');
    await page.keyboard.press('Space');
    const samples: { frame: number; code: number; quality: string }[] = [];
    for (let i = 0; i < 40; i++) {
      const smp = await page.evaluate(() => {
        const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        const ph = (cv.width * 360) / 640, py = (cv.height - ph) / 2;
        const row = cv.getContext('2d')!.getImageData(0, Math.round(py + ph / 12), cv.width, 1).data;
        return { frame: Number(cv.dataset.frame), quality: cv.dataset.quality ?? '', w: cv.width, data: Array.from(row.filter((_, k) => k % 4 !== 3)) };
      });
      samples.push({ frame: smp.frame, quality: smp.quality, code: readBarcode(Uint8Array.from(smp.data), smp.w, 3, { x: 0, y: 0, w: smp.w, h: 0 }) });
      await new Promise((r) => setTimeout(r, 90));
    }
    await page.keyboard.press('Space');
    const moving = samples.filter((x) => x.quality === 'draft');
    const distinct = [...new Map(moving.map((x) => [x.frame, x])).values()];
    const mismatches: unknown[] = [];
    for (const x of distinct) { const want = await stillCode(x.frame); if (want !== x.code) mismatches.push({ frame: x.frame, playback: x.code, still: want }); }
    check('during playback the preview draws, for every frame it reports, the same source frame as the server still of that timeline frame (read by barcode from the moving canvas)', distinct.length >= 15 && mismatches.length === 0 && new Set(distinct.map((x) => x.code)).size >= 10, { sampled: samples.length, movingFramesCompared: distinct.length, differentSourceFrames: new Set(distinct.map((x) => x.code)).size, firstFrames: distinct.slice(0, 6), mismatches: mismatches.slice(0, 5) });

    console.log('\n# workspaces');
    const wb = await getDoc();
    const tabsShown = async () => page.locator('[role=tab]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace('inspector-tab-', '')));
    const panelsShown = async () => page.locator('.inspector-panel:not([hidden])').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid!.replace('inspector-panel-', '')));
    const proTabs = await tabsShown();
    await page.getByTestId('workspace-switch').selectOption('quick');
    const quick = { tabs: await tabsShown(), panels: await panelsShown() };
    await page.getByTestId('workspace-switch').selectOption('sound');
    const sound = { tabs: await tabsShown(), panels: await panelsShown() };
    await page.reload();
    await page.getByTestId('timecode').waitFor();
    const afterReload = { ws: await page.getByTestId('workspace-switch').inputValue(), tabs: await tabsShown() };
    await page.getByTestId('workspace-switch').selectOption('pro');
    const back = await tabsShown();
    const wa = await getDoc();
    check('workspaces: Quick offers recipes, speech, captions and deliver and shows the recipes panel; Sound offers sound and clip; the choice survives a reload; Pro offers every panel again; the project is not changed by any of it', proTabs.length === 8 && JSON.stringify(quick.tabs) === JSON.stringify(['recipes', 'speech', 'captions', 'deliver']) && JSON.stringify(quick.panels) === JSON.stringify(['recipes']) && JSON.stringify(sound.tabs) === JSON.stringify(['sound', 'clip']) && JSON.stringify(sound.panels) === JSON.stringify(['sound']) && afterReload.ws === 'sound' && JSON.stringify(afterReload.tabs) === JSON.stringify(['sound', 'clip']) && back.length === 8 && wa.revision === wb.revision && JSON.stringify(wa.project) === JSON.stringify(wb.project), { proTabs: proTabs.length, quick, sound, afterReload, back: back.length });
    check('no uncaught errors in the editor page', errors.length === 0, errors.slice(0, 4));
  } catch (e) {
    // A crash must never look like a pass: record it as a failed check so the report says FAILED.
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, notDone: ['automated accessibility audit (no axe run)', 'screen-reader walkthrough', 'pointer drag across tracks', 'multi-select and marquee', 'source viewer', 'minimap and loop range'], checks };
    fs.writeFileSync(path.join(ev, 'phase3-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\n${report.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: docs/evidence/phase3-proof.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
