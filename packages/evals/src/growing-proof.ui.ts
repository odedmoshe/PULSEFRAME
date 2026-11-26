/**
 * proof:growing, the interface part (W3): U1–U4 of growing-proof.ts, in headless Chromium against one in-process server on its own
 * port. Fixtures are SYNTHETIC and made here by ffmpeg (a beige disc with two 6x6 #FF00FF eye squares at known places, on 640x480
 * stills and one 2 s video), in a temporary folder deleted at exit. Eye squares sit at multiples of ten picture pixels from the
 * centre so that the keyboard (Shift+arrow = ten pixels) reaches them exactly. A check returns true or the sentence that says why not;
 * "BLOCKED: …" when it cannot run here and "waits for W1/W2: …" while a body it needs is not built: neither is a pass.
 * Written against the real routes by W3; run first at integration. Integration changes: the dialog is reached as the owner does it, from
 * the start hub's card of an empty project (the card chooses the files, the dialog opens on them once they are in), so the stills are
 * JPEGs carrying an EXIF DateTimeOriginal (Pillow) and the capture order comes from ingest; the server listens on a free port; U5 is
 * a full sitting (mark, preview, «צרו», rebuild, restore) followed by the end-to-end privacy check.
 * Not provable here: real photos, how precisely a person clicks eyes, the Hebrew read by a person, a screen reader.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { GROWING_BUILT } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { GROWING_TESTIDS as ID } from '../../../apps/web/src/editor/growing/growing.testids.ts';
import { growingStrings } from '../../../apps/web/src/editor/growing/growing.strings.ts';
import type { GrowingProofPart } from './growing-proof.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/growing-proof-ui');
const W = 640, H = 480;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 28 });
type Lang = 'he' | 'en';
/** Eye squares: offset from the centre in picture pixels (multiples of ten), per picture. */
const EYES = [[[-60, -40], [60, -40]], [[-50, -30], [70, -30]], [[-70, -50], [50, -50]], [[-40, -20], [80, -20]]] as const;

interface Env { s: RunningServer; files: string[]; video: string; call(p: string, body?: unknown): Promise<{ status: number; body: any }>; owner(p: string): Promise<{ status: number; body: any }> }
let envPromise: Promise<Env> | null = null;
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) throw new Error('BLOCKED: the web bundle is missing (run `pnpm build`)');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const face = (eyes: readonly (readonly [number, number])[]) => ['drawbox=x=170:y=90:w=300:h=300:c=0xe8d4b0:t=fill', ...eyes.map(([dx, dy]) => `drawbox=x=${W / 2 + dx - 3}:y=${H / 2 + dy - 3}:w=6:h=6:c=0xff00ff:t=fill`)].join(',');
  const years = ['2019', '2021', '2023'];
  const files = EYES.slice(0, 3).map((e, i) => {
    const png = path.join(art, `face${i}.png`), out = path.join(art, `face${i}.jpg`);
    ff(['-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:d=1`, '-vf', face(e), '-frames:v', '1', png]);
    // a JPEG with the capture date in EXIF (DateTimeOriginal), so ingest dates it as a camera would
    execFileSync('python3', ['-I', '-c', "import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB'); ex=Image.Exif(); ex.get_ifd(0x8769)[0x9003]=sys.argv[3]; im.save(sys.argv[2],'JPEG',quality=95,subsampling=0,exif=ex)", png, out, `${years[i]}:05:04 10:00:00`]);
    fs.rmSync(png);
    return out;
  });
  const video = path.join(art, 'face-video.mp4');
  ff(['-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=30:d=2`, '-vf', face(EYES[3]), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video]);
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist'), homeZone: 'Asia/Jerusalem' });
  process.once('beforeExit', () => { void s.close(); });
  const call: Env['call'] = async (p, body) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close', authorization: `Bearer ${s.auth.tokens.agent}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };
  const cookie = (await fetch(`${s.url}/api/v1/session`, { headers: { origin: s.url, connection: 'close', 'x-pf-owner-key': s.auth.tokens.owner } })).headers.get('set-cookie')!.split(';')[0]!;
  const owner: Env['owner'] = async (p) => { const r = await fetch(`${s.url}/api/v1${p}`, { headers: { connection: 'close', origin: s.url, cookie } }); return { status: r.status, body: await r.json() }; };
  return { s, files, video, call, owner };
}
/** An empty project (the start hub shows on it). */
async function project(e: Env, name: string): Promise<{ pid: string }> {
  return { pid: (await e.call('/projects', { name, width: W, height: H, frameRate: { num: 30, den: 1 } })).body.project.id as string };
}
const INIT = (lang: Lang) => `globalThis.__name = (f) => f; try { localStorage.setItem('pf.lang', '${lang}'); } catch {}`;
async function openEditor(b: Browser, e: Env, pid: string, lang: Lang): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(INIT(lang));
  const page = await ctx.newPage();
  await page.goto(`${e.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return { ctx, page };
}
const press = async (page: Page, key: string, n: number) => { for (let i = 0; i < n; i++) await page.keyboard.press(key); };
/** Keyboard: the cross-hair starts at the centre; Shift+arrows move ten picture pixels. Marks the point at the offset (multiples of ten). */
async function markByKeys(page: Page, from: [number, number], to: [number, number]): Promise<[number, number]> {
  const dx = (to[0] - from[0]) / 10, dy = (to[1] - from[1]) / 10;
  await press(page, dx < 0 ? 'Shift+ArrowLeft' : 'Shift+ArrowRight', Math.abs(dx));
  await press(page, dy < 0 ? 'Shift+ArrowUp' : 'Shift+ArrowDown', Math.abs(dy));
  await page.keyboard.press('Enter');
  return to;
}
const stage = (page: Page) => page.getByTestId(ID.markView).locator('.pf-growing-stage');
/** The two eyes of the picture on screen: click each by mouse (the picture is drawn at the canvas's own proportions). */
async function clickEye(page: Page, off: readonly [number, number]): Promise<void> {
  const box = (await stage(page).boundingBox())!;
  await page.mouse.click(box.x + ((W / 2 + off[0]) / W) * box.width, box.y + ((H / 2 + off[1]) / H) * box.height);
}
async function ready(page: Page): Promise<string | null> {
  if (!GROWING_BUILT) return 'waits for W1: GROWING_BUILT is false (the planner is not built)';
  try { await page.getByTestId(ID.open).waitFor({ timeout: 10000 }); } catch { return 'the start-hub card is not shown (owner session, built flags, hub visible?)'; }
  return null;
}
/**
 * The card with the keyboard only: Enter opens the file chooser (the project is empty), the files go in, the dialog opens on them
 * once they are all in; then the first `n` pictures of the list (capture order) are ticked with Space. Returns the list's ids.
 */
const tries: string[] = [];
async function openAndTick(page: Page, files: string[], n: number): Promise<string[]> {
  let chooser: import('playwright').FileChooser | null = null;
  for (let attempt = 1; attempt <= 4 && !chooser; attempt++) {
    await page.getByTestId(ID.open).focus();
    const on = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, ID.open);
    if (!on) { tries.push(`attempt ${attempt}: the focus was not on the card`); await page.waitForTimeout(500); continue; }
    await page.evaluate((id) => { const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement & { __clicks?: number }; el.__clicks = 0; el.addEventListener('click', () => { el.__clicks!++; }); }, ID.open);
    const wait = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await page.keyboard.press('Enter');
    chooser = await wait;
    if (!chooser) tries.push(`attempt ${attempt}: Enter on the card opened no file chooser (clicks seen on the card: ${await page.evaluate((id) => (document.querySelector(`[data-testid="${id}"]`) as unknown as { __clicks?: number } | null)?.__clicks ?? 'card gone', ID.open)})`);
  }
  if (!chooser) throw new Error(`no file chooser: ${tries.join('; ')}`);
  await chooser.setFiles(files);
  if (tries.length) { console.log(`  the card needed more than one try: ${tries.join('; ')}`); tries.length = 0; }
  await page.getByTestId(ID.dialog).waitFor({ timeout: 60000 });
  await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel as string).length >= (k as number), [`[data-testid="${ID.pickItem}"]`, files.length] as const, { timeout: 30000 });
  const ids = await page.getByTestId(ID.pickItem).evaluateAll((els) => els.map((el) => el.getAttribute('data-asset-id') ?? ''));
  for (const id of ids.slice(0, n)) { await page.locator(`[data-testid="${ID.pickItem}"][data-asset-id="${id}"] input`).focus(); await page.keyboard.press('Space'); }
  return ids;
}
const withBrowser = async (lang: Lang, body: (b: Browser, e: Env) => Promise<true | string>): Promise<true | string> => {
  let e: Env;
  try { e = await env(); } catch (x) { return (x as Error).message.startsWith('BLOCKED') ? (x as Error).message : `BLOCKED: ${(x as Error).message}`; }
  let b: Browser;
  try { b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); } catch (x) { return `BLOCKED: Chromium could not start: ${(x as Error).message}`; }
  try { return await body(b, e); } catch (x) { return `error: ${(x as Error).message.split('\n')[0]}`; } finally { await b.close(); }
};

const U1 = () => withBrowser('he', async (b, e) => {
  const { pid } = await project(e, 'u1');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    const ids = await openAndTick(page, [e.video, ...e.files], 4);
    const names = await page.getByTestId(ID.pickItem).evaluateAll((els) => els.map((el) => [el.textContent ?? '', el.getAttribute('data-state')]));
    if (JSON.stringify(names.map((x) => x[1])) !== JSON.stringify(['dated', 'dated', 'dated', 'undated'])) return `the list is not in capture order with the undated video last: ${JSON.stringify(names)}`;
    if (ids.length !== 4) return `${ids.length} pictures in the list`;
    await page.getByTestId(ID.pickNext).focus(); await page.keyboard.press('Enter');
    // pictures in capture order: the three dated stills, then the video (undated, after)
    let off: [number, number] = [0, 0];
    for (let i = 0; i < 3; i++) {
      const eyes = EYES[i]!;
      if (i === 2) { await stage(page).focus(); await clickEye(page, eyes[0]); await clickEye(page, eyes[1]); } // one by mouse
      else { await stage(page).focus(); off = [0, 0]; off = await markByKeys(page, off, [eyes[0][0], eyes[0][1]]); off = await markByKeys(page, off, [eyes[1][0], eyes[1][1]]); }
      await page.keyboard.press('PageDown');
    }
    // the video: choose the frame first (a few frames on), then mark by keys
    const frameRow = page.getByTestId(ID.markFrame);
    await frameRow.waitFor({ timeout: 5000 });
    await frameRow.focus(); await press(page, 'ArrowRight', 3);
    if ((await frameRow.getAttribute('data-frame')) !== '3') return `the video frame did not step to 3 (${await frameRow.getAttribute('data-frame')})`;
    await stage(page).focus(); off = [0, 0]; off = await markByKeys(page, off, [EYES[3][0][0], EYES[3][0][1]]); await markByKeys(page, off, [EYES[3][1][0], EYES[3][1][1]]);
    const count = await page.getByTestId(ID.markCount).innerText();
    if (!/4/.test(count)) return `the count does not say 4 marked: «${count}»`;
    const before = (await e.call(`/projects/${pid}`)).body.project?.revision ?? null;
    await page.getByRole('button', { name: growingStrings('he').next }).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.create).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.bar).waitFor({ timeout: 30000 });
    const doc = (await e.call(`/projects/${pid}`)).body.project;
    const clips = Object.values(doc?.sequences ?? {}).flatMap((s: any) => s.tracks.flatMap((t: any) => t.clips)).length;
    const runs = Object.values(doc?.recipeRuns ?? {}).filter((r: any) => r.recipeId === 'template:tpl.growing').length;
    if (clips < 4) return `the timeline holds ${clips} clips, expected at least 4 (revision before ${before})`;
    return runs === 1 ? true : `${runs} growing runs in the document, expected 1`;
  } finally { await ctx.close(); }
});

const U2 = () => withBrowser('he', async (b, e) => {
  const { pid } = await project(e, 'u2');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, e.files, 3);
    const rev0 = (await e.call(`/projects/${pid}`)).body.project?.revision;
    await page.getByTestId(ID.pickNext).click();
    await stage(page).focus(); await clickEye(page, EYES[0]![0]);
    if (await page.getByTestId(ID.preview).count()) return 'a preview is shown after one point';
    await clickEye(page, EYES[0]![1]);
    if (await page.getByTestId(ID.preview).count()) return 'a preview is shown after one picture (it needs the second)';
    await page.keyboard.press('PageDown');
    await clickEye(page, EYES[1]![0]); await clickEye(page, EYES[1]![1]);
    await page.getByTestId(ID.preview).waitFor({ timeout: 10000 });
    const label = (await page.getByTestId(ID.previewLabel).innerText()).trim();
    if (label !== growingStrings('he').preview) return `the label is «${label}»`;
    const rev1 = (await e.call(`/projects/${pid}`)).body.project?.revision;
    const runs = Object.values((await e.call(`/projects/${pid}`)).body.project?.recipeRuns ?? {}).length;
    return rev0 === rev1 && runs === 0 ? true : `something was stored before «צרו» (revision ${rev0} -> ${rev1}, runs ${runs})`;
  } finally { await ctx.close(); }
});

const U3 = () => withBrowser('he', async (b, e) => {
  const { pid } = await project(e, 'u3');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, e.files.slice(0, 2), 2);
    await page.getByTestId(ID.pickNext).click();
    for (let i = 0; i < 2; i++) { await stage(page).focus(); await clickEye(page, EYES[i]![0]); await clickEye(page, EYES[i]![1]); if (i === 0) await page.keyboard.press('PageDown'); }
    await page.getByTestId(ID.preview).waitFor({ timeout: 10000 });
    const left = () => page.getByTestId(ID.markPoint).evaluateAll((els) => els.map((el) => [el.getAttribute('data-state'), (el as HTMLElement).style.left]));
    const snap = () => page.getByTestId(ID.preview).locator('canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    const p0 = await left(), s0 = await snap();
    await stage(page).focus(); await page.keyboard.press('s');
    let s1 = s0;
    for (let k = 0; k < 25 && s1 === s0; k++) { await page.waitForTimeout(200); s1 = await snap(); }
    const p1 = await left();
    if (JSON.stringify(p0.map((x) => x[1])) === JSON.stringify(p1.map((x) => x[1]))) return 'S did not swap the two points';
    if (s0 === s1) return 'the preview did not follow the swap (canvas unchanged)';
    // C8: no storage holds a mark (the u of a point as a number)
    const dump = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const us = (p0 as string[][]).map((x) => parseFloat(x[1]!) / 100).filter((u) => u > 0).map((u) => String(u).slice(0, 5));
    for (const u of us) if (dump.includes(u)) return `a storage value contains ${u}`;
    if (/growing|eye/i.test(dump.replace(/pf\.lang/g, ''))) return `a storage key mentions growing: ${dump.slice(0, 200)}`;
    // closing with marks asks first
    await page.keyboard.press('Escape');
    await page.getByTestId(ID.closeAsk).waitFor({ timeout: 4000 });
    await page.getByTestId(ID.closeKeep).click();
    if (!(await page.getByTestId(ID.dialog).count())) return 'the dialog closed although the ask was answered with «keep»';
    await page.keyboard.press('Escape');
    await page.getByTestId(ID.closeConfirm).click();
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 4000 });
    // the project has pictures now, so the hub and its card are gone: nothing reopens the dialog here; the marks lived in the
    // dialog's state, which is unmounted with it (the unit test of the folder pins that no storage is written)
    return true;
  } finally { await ctx.close(); }
});

const U4 = () => withBrowser('he', async (b, e) => {
  const { pid } = await project(e, 'u4');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, e.files.slice(0, 2), 2);
    const dir = await page.getByTestId(ID.dialog).locator('.pf-growing-body').getAttribute('dir');
    if (dir !== 'rtl') return `the dialog body is dir=${dir}`;
    await page.getByTestId(ID.pickNext).click();
    const mv = await page.getByTestId(ID.markView).getAttribute('dir');
    if (mv !== 'ltr') return `the marking view is dir=${mv}`;
    for (let i = 0; i < 2; i++) { await stage(page).focus(); await clickEye(page, EYES[i]![0]); await clickEye(page, EYES[i]![1]); if (i === 0) await page.keyboard.press('PageDown'); }
    await page.getByRole('button', { name: growingStrings('he').next }).click();
    const privacy = (await page.getByTestId(ID.privacy).innerText()).trim();
    if (privacy !== growingStrings('he').privacy) return `the privacy sentence is «${privacy}»`;
    // Escape asks (marks exist); confirm closes. The card that opened it left with the hub when the files came in, so the focus
    // return to the opener is checked in U5, where the bar's «החזרת החלקים שנמחקו» opens the dialog and stays.
    await page.keyboard.press('Escape');
    await page.getByTestId(ID.closeConfirm).click();
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 4000 });
    return true;
  } finally { await ctx.close(); }
});

/**
 * U5 (integration): the first minute and a whole sitting, then the privacy rule end to end (C8). Two pictures from the card, both
 * marked by keyboard at known places; the aligned preview appears and PLAYS (its canvas changes while it plays); «צרו» from two
 * pictures; «בנו מחדש»; one picture deleted by hand; «החזרת החלקים שנמחקו» opens the dialog (Escape closes it and the focus is back
 * on that button), the deleted picture is marked again and made again. Then: localStorage, sessionStorage, the URL and every console
 * line of the page hold none of the marked coordinates (as the decimals JavaScript writes and rounded to 6 and 4 places), and the
 * project document fetched as the owner holds none of them outside the clips' ordinary `transform` (C7: those do give the eyes back,
 * and the dialog says so), and no key named like an eye mark.
 */
const U5 = () => withBrowser('he', async (b, e) => {
  const { pid } = await project(e, 'u5');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  const consoleLines: string[] = [];
  page.on('console', (m) => consoleLines.push(m.text()));
  page.on('pageerror', (x) => consoleLines.push(String(x)));
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, e.files.slice(0, 2), 2);
    await page.getByTestId(ID.pickNext).focus(); await page.keyboard.press('Enter');
    const marked: number[] = [];
    for (let i = 0; i < 2; i++) {
      const eyes = EYES[i]!;
      await stage(page).focus();
      let off: [number, number] = [0, 0];
      off = await markByKeys(page, off, [eyes[0][0], eyes[0][1]]); await markByKeys(page, off, [eyes[1][0], eyes[1][1]]);
      for (const [dx, dy] of eyes) marked.push((W / 2 + dx) / W, (H / 2 + dy) / H);
      if (i === 0) await page.keyboard.press('PageDown');
    }
    await page.getByTestId(ID.preview).waitFor({ timeout: 10000 });
    const snap = () => page.getByTestId(ID.preview).locator('canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    const before = await snap();
    await page.getByTestId(ID.preview).getByRole('button', { name: growingStrings('he').playPreview }).click();
    let plays = false;
    for (let k = 0; k < 20 && !plays; k++) { await page.waitForTimeout(150); plays = (await snap()) !== before; }
    if (!plays) return 'the preview did not play (its canvas did not change in 3 s after «play»)';
    await page.getByRole('button', { name: growingStrings('he').next }).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.create).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.bar).waitFor({ timeout: 30000 });
    const doc1 = (await e.call(`/projects/${pid}`)).body.project;
    const run = Object.values(doc1.recipeRuns ?? {}).find((r: any) => r.recipeId === 'template:tpl.growing') as any;
    if (!run) return 'no growing run after «צרו» from two pictures';
    const rev1 = (await e.call(`/projects/${pid}`)).body.revision;
    await page.getByTestId(ID.barRebuild).click();
    for (let k = 0; k < 50; k++) { if ((await e.call(`/projects/${pid}`)).body.revision > rev1) break; await page.waitForTimeout(200); }
    if (!((await e.call(`/projects/${pid}`)).body.revision > rev1)) return '«בנו מחדש» committed nothing';
    // delete one picture by hand (as an edit would), then bring it back through the bar
    const doc2 = (await e.call(`/projects/${pid}`)).body.project;
    const run2 = doc2.recipeRuns[run.id];
    const slot = run2.slots.find((x: any) => x.kind === 'picture');
    const del = await e.call(`/projects/${pid}/transactions`, { ops: [{ op: 'delete_clip', args: { clipId: slot.clipId } }] });
    if (del.status >= 300) return `the delete was refused: ${del.status}`;
    await page.getByTestId(ID.barRestore).waitFor({ timeout: 15000 });
    await page.getByTestId(ID.barRestore).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.dialog).waitFor({ timeout: 8000 });
    await page.keyboard.press('Escape');
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 4000 });
    const back = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, ID.barRestore);
    if (!back) return 'closing the restore dialog did not put the focus back on «החזרת החלקים שנמחקו»';
    await page.keyboard.press('Enter');
    await page.getByTestId(ID.dialog).waitFor({ timeout: 8000 });
    // the deleted clip's file is face<i>.jpg: its eyes are EYES[i]
    const deletedAsset = (Object.values(doc2.sequences).flatMap((q: any) => q.tracks).flatMap((t: any) => t.clips).find((c: any) => c.id === slot.clipId) as any)?.assetId;
    const which = Number(/face(\d)\.jpg$/.exec(doc2.assets[deletedAsset]?.name ?? '')?.[1] ?? NaN);
    if (!(which === 0 || which === 1)) return `cannot tell which picture was deleted (${doc2.assets[deletedAsset]?.name})`;
    const eyes = EYES[which]!;
    await stage(page).focus();
    let off: [number, number] = [0, 0];
    off = await markByKeys(page, off, [eyes[0][0], eyes[0][1]]); await markByKeys(page, off, [eyes[1][0], eyes[1][1]]);
    await page.getByTestId(ID.create).click();
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 30000 });
    const doc3 = (await e.call(`/projects/${pid}`)).body.project;
    const back3 = doc3.recipeRuns[run.id].slots.filter((x: any) => x.kind === 'picture').every((x: any) => Object.values(doc3.sequences).flatMap((q: any) => q.tracks).some((t: any) => t.clips.some((c: any) => c.id === x.clipId)));
    if (!back3) return `the deleted picture did not come back: ${JSON.stringify(doc3.recipeRuns[run.id].params).slice(0, 300)}`;
    // ---- the privacy rule end to end ----
    const forms = [...new Set(marked.flatMap((x) => [String(x), x.toFixed(6), x.toFixed(4)]))];
    const local = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
    const places: [string, string][] = [['storage', local], ['the URL', page.url()], ['the console', consoleLines.join('\n')]];
    const found = places.flatMap(([where, text]) => forms.filter((f) => text.includes(f)).map((f) => `${where} holds ${f}`));
    const ownerDoc = (await e.owner(`/projects/${pid}`)).body;
    const outside: string[] = [];
    const walk = (v: unknown, at: string) => {
      if (typeof v === 'number') { if (!/\.transform\./.test(at) && marked.some((m) => Math.abs(m - v) < 1e-7)) outside.push(`${at} = ${v}`); return; }
      if (typeof v === 'string') { if (forms.some((f) => f.length >= 6 && v.includes(f))) outside.push(`${at} = "${v.slice(0, 60)}"`); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
      if (v && typeof v === 'object') for (const [key, x] of Object.entries(v)) { if (/^eye(s|Marks?)?$/i.test(key)) outside.push(`${at}.${key} (a key named like a mark)`); walk(x, `${at}.${key}`); }
    };
    walk(ownerDoc, 'project');
    const all = [...found, ...outside];
    console.log(`  U5 privacy: searched ${forms.length} written forms of ${marked.length} coordinates in storage (${local.length} chars), the URL, ${consoleLines.length} console lines, and the owner's document (${JSON.stringify(ownerDoc).length} chars)`);
    return all.length ? `the marks were found: ${all.slice(0, 6).join('; ')}` : true;
  } finally { await ctx.close(); }
});

export const GROWING_PROOF_UI: GrowingProofPart = { built: true, checks: { U1, U2, U3, U4, U5 } };
