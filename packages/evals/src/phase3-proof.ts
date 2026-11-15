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
import { generateBarcodeFixture } from '@pulseframe/fixtures';
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
    check('no uncaught errors in the editor page', errors.length === 0, errors.slice(0, 4));
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
