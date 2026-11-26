/**
 * proof:growing, the interface part (W3): U1–U4 of growing-proof.ts, in headless Chromium against one in-process server on its own
 * port. Fixtures are SYNTHETIC and made here by ffmpeg (a beige disc with two 6x6 #FF00FF eye squares at known places, on 640x480
 * stills and one 2 s video), in a temporary folder deleted at exit. Eye squares sit at multiples of ten picture pixels from the
 * centre so that the keyboard (Shift+arrow = ten pixels) reaches them exactly. A check returns true or the sentence that says why not;
 * "BLOCKED: …" when it cannot run here and "waits for W1/W2: …" while a body it needs is not built: neither is a pass.
 * Written against the real routes for the integrator; NOT RUN by its author (the planner and the server were not in the worktree).
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
const PORT = Number(process.env.PF_GROWING_PROOF_UI_PORT ?? 8992);
const W = 640, H = 480;
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 28 });
type Lang = 'he' | 'en';
/** Eye squares: offset from the centre in picture pixels (multiples of ten), per picture. */
const EYES = [[[-60, -40], [60, -40]], [[-50, -30], [70, -30]], [[-70, -50], [50, -50]], [[-40, -20], [80, -20]]] as const;

interface Env { s: RunningServer; files: string[]; video: string; call(p: string, body?: unknown): Promise<{ status: number; body: any }> }
let envPromise: Promise<Env> | null = null;
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const env = () => (envPromise ??= makeEnv());
async function makeEnv(): Promise<Env> {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) throw new Error('BLOCKED: the web bundle is missing (run `pnpm build`)');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const face = (eyes: readonly (readonly [number, number])[]) => ['drawbox=x=170:y=90:w=300:h=300:c=0xe8d4b0:t=fill', ...eyes.map(([dx, dy]) => `drawbox=x=${W / 2 + dx - 3}:y=${H / 2 + dy - 3}:w=6:h=6:c=0xff00ff:t=fill`)].join(',');
  const files = EYES.slice(0, 3).map((e, i) => {
    const out = path.join(art, `face${i}.png`);
    ff(['-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:d=1`, '-vf', face(e), '-frames:v', '1', out]);
    return out;
  });
  const video = path.join(art, 'face-video.mp4');
  ff(['-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:r=30:d=2`, '-vf', face(EYES[3]), '-pix_fmt', 'yuv420p', '-c:v', 'libx264', video]);
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data'), webDist: path.join(root, 'apps/web/dist'), homeZone: 'Asia/Jerusalem' });
  process.once('beforeExit', () => { void s.close(); });
  const call: Env['call'] = async (p, body) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { connection: 'close', authorization: `Bearer ${s.auth.tokens.agent}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : null };
  };
  return { s, files, video, call };
}
async function upload(e: Env, pid: string, file: string): Promise<string> {
  const r = await fetch(`${e.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { authorization: `Bearer ${e.s.auth.tokens.agent}`, connection: 'close', 'x-filename': encodeURIComponent(path.basename(file)) }, body: new Uint8Array(fs.readFileSync(file)) });
  const b = (await r.json()) as any;
  if (!b.assetId) throw new Error(`upload of ${path.basename(file)}: ${r.status} ${JSON.stringify(b).slice(0, 300)}`);
  return b.assetId as string;
}
/** A project with three dated stills and one undated video. */
async function project(e: Env, name: string): Promise<{ pid: string; ids: string[] }> {
  const pid = (await e.call('/projects', { name, width: W, height: H, frameRate: { num: 30, den: 1 } })).body.project.id as string;
  const ids: string[] = [];
  for (const f of [...e.files, e.video]) ids.push(await upload(e, pid, f));
  const years = ['2019', '2021', '2023'];
  const r = await e.call(`/projects/${pid}/transactions`, { ops: ids.slice(0, 3).map((assetId, i) => ({ op: 'set_asset_capture', args: { assetId, capture: { at: `${years[i]}-05-04T10:00:00` } } })) });
  if (r.status >= 300) throw new Error(`dates: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  return { pid, ids };
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
  const r = await page.getByTestId(ID.open).count();
  return r === 0 ? 'the start-hub card is not shown (owner session, built flags, hub visible?)' : null;
}
/** Opens the dialog from the card with the keyboard only, ticks the named pictures with Space. */
async function openAndTick(page: Page, ids: string[]): Promise<void> {
  await page.getByTestId(ID.open).focus();
  await page.keyboard.press('Enter');
  await page.getByTestId(ID.dialog).waitFor({ timeout: 8000 });
  for (const id of ids) { await page.locator(`[data-testid="${ID.pickItem}"][data-asset-id="${id}"] input`).focus(); await page.keyboard.press('Space'); }
}
const withBrowser = async (lang: Lang, body: (b: Browser, e: Env) => Promise<true | string>): Promise<true | string> => {
  let e: Env;
  try { e = await env(); } catch (x) { return (x as Error).message.startsWith('BLOCKED') ? (x as Error).message : `BLOCKED: ${(x as Error).message}`; }
  let b: Browser;
  try { b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); } catch (x) { return `BLOCKED: Chromium could not start: ${(x as Error).message}`; }
  try { return await body(b, e); } finally { await b.close(); }
};

const U1 = () => withBrowser('he', async (b, e) => {
  const { pid, ids } = await project(e, 'u1');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, ids);
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
  const { pid, ids } = await project(e, 'u2');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    const rev0 = (await e.call(`/projects/${pid}`)).body.project?.revision;
    await openAndTick(page, ids.slice(0, 3));
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
  const { pid, ids } = await project(e, 'u3');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, ids.slice(0, 2));
    await page.getByTestId(ID.pickNext).click();
    for (let i = 0; i < 2; i++) { await stage(page).focus(); await clickEye(page, EYES[i]![0]); await clickEye(page, EYES[i]![1]); if (i === 0) await page.keyboard.press('PageDown'); }
    await page.getByTestId(ID.preview).waitFor({ timeout: 10000 });
    const left = () => page.getByTestId(ID.markPoint).evaluateAll((els) => els.map((el) => [el.getAttribute('data-state'), (el as HTMLElement).style.left]));
    const snap = () => page.getByTestId(ID.preview).locator('canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL());
    const p0 = await left(), s0 = await snap();
    await stage(page).focus(); await page.keyboard.press('s');
    await page.waitForTimeout(800);
    const p1 = await left(), s1 = await snap();
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
    await page.getByTestId(ID.open).focus(); await page.keyboard.press('Enter');
    await page.getByTestId(ID.dialog).waitFor({ timeout: 4000 });
    const ticked = await page.getByTestId(ID.pickTick).evaluateAll((els) => els.filter((el) => (el as HTMLInputElement).checked).length);
    return ticked === 0 ? true : 'the choices of the closed dialog came back';
  } finally { await ctx.close(); }
});

const U4 = () => withBrowser('he', async (b, e) => {
  const { pid, ids } = await project(e, 'u4');
  const { ctx, page } = await openEditor(b, e, pid, 'he');
  try {
    const w = await ready(page); if (w) return w;
    await openAndTick(page, ids.slice(0, 2));
    const dir = await page.getByTestId(ID.dialog).locator('.pf-growing-body').getAttribute('dir');
    if (dir !== 'rtl') return `the dialog body is dir=${dir}`;
    await page.getByTestId(ID.pickNext).click();
    const mv = await page.getByTestId(ID.markView).getAttribute('dir');
    if (mv !== 'ltr') return `the marking view is dir=${mv}`;
    for (let i = 0; i < 2; i++) { await stage(page).focus(); await clickEye(page, EYES[i]![0]); await clickEye(page, EYES[i]![1]); if (i === 0) await page.keyboard.press('PageDown'); }
    await page.getByRole('button', { name: growingStrings('he').next }).click();
    const privacy = (await page.getByTestId(ID.privacy).innerText()).trim();
    if (privacy !== growingStrings('he').privacy) return `the privacy sentence is «${privacy}»`;
    // Escape asks (marks exist); confirm closes; the focus is back on the card in the same task
    await page.keyboard.press('Escape');
    await page.getByTestId(ID.closeConfirm).click();
    await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 4000 });
    const onCard = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, ID.open);
    return onCard ? true : 'the focus did not return to the card that opened the dialog';
  } finally { await ctx.close(); }
});

export const GROWING_PROOF_UI: GrowingProofPart = { built: true, checks: { U1, U2, U3, U4 } };
