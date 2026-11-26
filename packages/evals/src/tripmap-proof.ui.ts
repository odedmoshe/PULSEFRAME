/**
 * pnpm proof:tripmap, part ui (W3): checks 5 and 15 of tripmap-proof.ts, in the pinned headless Chromium against the REAL server and the
 * BUILT web app (`pnpm build` first). SYNTHETIC only: stops typed as coordinates, a silent 1280x720 project at 30 fps, no owner media.
 * Not verified on the laptop (C12): headless Chromium only. Nobody here can look: every check is a measurement or a count.
 *  5. the paused editor preview equals the server still byte for byte at 3 frames; an exported frame is within PSNR 40 dB of the still.
 * 15. editor, keyboard only: Text rail, «מפת טיול חדשה», a listed name + Enter, an unlisted name + Enter opens the picker, arrows + Enter place
 *     it, «יצירה»: the clip is on the timeline at the playhead; «עריכת המפה», change the look, save: one undo restores the document.
 * Until the painter (engine map/) and the ops (MAP_OPS_BUILT) are built in the checkout it runs in, a check says so and fails; it never passes
 * around them. Each check returns true, or a sentence.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { canonical, type ProjectDocument } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { TRIPMAP_TESTIDS as TID } from '../../../apps/web/src/editor/tripMap/tripMap.testids.ts';
import { CRAFT_TESTIDS } from '../../../apps/web/src/editor/craft/craft.testids.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const psnr = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; s += d * d; } const mse = s / a.length; return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse); };

interface Ctx { s: RunningServer; browser: Browser; art: string; h: Record<string, string> }
let ctxP: Promise<Ctx> | null = null;
function setup(): Promise<Ctx> {
  ctxP ??= (async () => {
    if (!fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) throw new Error('the web bundle (apps/web/dist) is not built: run `pnpm build` first');
    const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tripmap-ui-'));
    const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
    const browser = await chromium.launch();
    return { s, browser, art, h: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } };
  })();
  return ctxP;
}
async function teardown() {
  if (!ctxP) return;
  const c = await ctxP; ctxP = null;
  await c.browser.close().catch(() => undefined);
  await c.s.close().catch(() => undefined);
  fs.rmSync(c.art, { recursive: true, force: true }); // synthetic and deleted
}
const call = async (c: Ctx, method: string, p: string, body?: unknown) => {
  const r = await fetch(`${c.s.url}/api/v1${p}`, { method, headers: { ...c.h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, body: ct.includes('json') ? ((await r.json()) as any) : Buffer.from(await r.arrayBuffer()) };
};
const tx = async (c: Ctx, pid: string, ops: unknown[]) => { const r = await call(c, 'POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const docOf = async (c: Ctx, pid: string): Promise<ProjectDocument> => (await call(c, 'GET', `/projects/${pid}`)).body.project;
const hash = async (c: Ctx, pid: string) => canonical(await docOf(c, pid));
const until = async (get: () => Promise<boolean>, ms = 8000) => { const t0 = Date.now(); for (;;) { if (await get()) return true; if (Date.now() - t0 > ms) return false; await sleep(100); } };
const mapClips = (d: ProjectDocument) => Object.values(d.sequences).flatMap((q) => q.tracks.flatMap((t) => t.clips)).filter((c) => c.type === 'drawn' && (c as any).drawn?.kind === 'map') as any[];
const STOPS = [
  { name: 'תל אביב', lon: 34_770_000, lat: 32_080_000 },
  { name: 'אילת', lon: 34_950_000, lat: 29_560_000, via: 'road' },
  { name: 'לונדון', lon: -120_000, lat: 51_510_000, via: 'flight' },
];

async function openEditor(c: Ctx, pid: string, lang: 'he' | 'en'): Promise<{ page: Page; close(): Promise<void> }> {
  const ctx = await c.browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(({ l }) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, { l: lang });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)));
  await page.goto(`${c.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  return { page, close: () => ctx.close() };
}

// ---------------------------------------------------------------- 5
async function check5(): Promise<true | string> {
  const c = await setup();
  const pid = (await call(c, 'POST', '/projects', { name: 'tripmap-5', width: 1280, height: 720, frameRate: R })).body.project.id as string;
  const added = await call(c, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_trip_map', args: { start: f(0), duration: f(240), stops: STOPS } }] });
  if (added.status !== 200) return `add_trip_map was refused: ${JSON.stringify(added.body).slice(0, 300)}`;
  const { page, close } = await openEditor(c, pid, 'he');
  try {
    const frames = [20, 100, 200];
    const stills = new Map<number, Buffer>();
    for (const n of frames) {
      const r = await call(c, 'GET', `/projects/${pid}/frame?index=${n}`);
      if (r.status !== 200) return `the still of frame ${n} answered ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`;
      stills.set(n, r.body as Buffer);
    }
    for (const n of frames) {
      await page.keyboard.press('KeyG');
      await page.getByTestId(CRAFT_TESTIDS.timeInput).fill(String(n));
      await page.keyboard.press('Enter');
      const painted = await page.waitForFunction((fr) => { const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement | null; return cv?.dataset.frame === String(fr) && cv.dataset.quality === 'full'; }, n, { timeout: 20000 }).then(() => true, () => false);
      if (!painted) return `the paused preview did not paint frame ${n} at full quality`;
      const same = await page.evaluate(async ({ pid: p, n: fr }) => {
        const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        const bmp = await createImageBitmap(await (await fetch(`/api/v1/projects/${p}/frame?index=${fr}`)).blob());
        if (bmp.width !== cv.width || bmp.height !== cv.height) return { size: `${bmp.width}x${bmp.height} vs ${cv.width}x${cv.height}`, diff: -1 };
        const o = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d')!;
        o.drawImage(bmp, 0, 0);
        const a = o.getImageData(0, 0, bmp.width, bmp.height).data, b = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        let diff = 0;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
        return { size: '', diff };
      }, { pid, n });
      if (same.diff !== 0) return `preview and still differ at frame ${n}: ${same.diff < 0 ? same.size : `${same.diff} bytes`}`;
    }
    // an exported frame against the still (PSNR), Chromium only
    const ex = await call(c, 'POST', `/projects/${pid}/exports`, { range: { startFrame: 100, endFrame: 101 } });
    if (ex.status !== 202 && ex.status !== 200) return `the export was refused: ${JSON.stringify(ex.body).slice(0, 300)}`;
    let job: any;
    for (;;) { job = (await call(c, 'GET', `/jobs/${ex.body.jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(job.status)) break; await sleep(200); }
    if (job.status !== 'succeeded') return `the export ${job.status}: ${JSON.stringify(job.error).slice(0, 300)}`;
    const file = path.join(c.art, 'out.mp4');
    fs.writeFileSync(file, (await call(c, 'GET', `/jobs/${job.id}/output`)).body as Buffer);
    const raw = ff(['-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const ref = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stills.get(100)!);
    if (raw.length !== ref.length) return `the exported frame has ${raw.length} bytes, the still ${ref.length}`;
    const p = psnr(raw, ref);
    if (!(p >= 40)) return `the exported frame is ${p.toFixed(2)} dB from the still (needs 40)`;
    return true;
  } finally { await close(); }
}

// ---------------------------------------------------------------- 15
async function check15(): Promise<true | string> {
  const c = await setup();
  const pid = (await call(c, 'POST', '/projects', { name: 'tripmap-15', width: 1280, height: 720, frameRate: R })).body.project.id as string;
  const { page, close } = await openEditor(c, pid, 'he');
  try {
    const type = async (text: string) => { await page.getByTestId(TID.search).fill(text); };
    await page.getByTestId('rail-text').click();
    const entry = page.getByTestId(TID.newButton);
    if (!(await entry.count())) return '«מפת טיול חדשה» is not in the Text pane';
    // keyboard from here: focus the button, Enter opens the dialog
    await entry.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.dialog).waitFor({ timeout: 10000 });
    if ((await page.getByTestId(TID.dialog).getAttribute('data-mode')) !== 'create') return 'the dialog is not in create mode';
    // a listed name: type it, the list offers it, Enter adds it with the typed text as the name
    await page.getByTestId(TID.search).focus();
    await type('ירושלים');
    if (!(await page.getByTestId(TID.suggestion).count())) return 'the list offered nothing for «ירושלים»';
    if ((await page.getByTestId(TID.suggestion).count()) > 8) return 'more than 8 suggestions';
    await page.keyboard.press('Enter');
    if ((await page.getByTestId(TID.stopRow).count()) !== 1) return 'Enter on a listed name did not add one stop';
    if ((await page.getByTestId(TID.stopName).first().inputValue()) !== 'ירושלים') return 'the stop is not named as typed';
    // an unlisted name: nothing to choose, the line is shown, Enter opens the picker
    await type('פטרה');
    if ((await page.getByTestId(TID.suggestion).count()) !== 0) return '«פטרה» is not in the list, yet a suggestion was offered';
    if (!(await page.getByTestId(TID.notInList).count())) return 'the «not in the list» line is missing';
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.picker).waitFor({ timeout: 5000 });
    if (!(await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, TID.picker))) return 'the picker did not take the keyboard focus';
    const before = await page.getByTestId(TID.crosshair).evaluate((e) => `${e.getAttribute('data-lon')},${e.getAttribute('data-lat')}`);
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Shift+ArrowDown');
    const after = await page.getByTestId(TID.crosshair).evaluate((e) => `${e.getAttribute('data-lon')},${e.getAttribute('data-lat')}`);
    const [l0, a0] = before.split(',').map(Number), [l1, a1] = after.split(',').map(Number);
    if (l1! - l0! !== -300_000 || a1! - a0! !== -1_000_000) return `the crosshair moved ${l1! - l0!}, ${a1! - a0!} micro-degrees, not -300000, -1000000`;
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.picker).waitFor({ state: 'detached' });
    if ((await page.getByTestId(TID.stopRow).count()) !== 2) return 'Enter in the picker did not add the second stop';
    if ((await page.getByTestId(TID.stopName).nth(1).inputValue()) !== 'פטרה') return 'the picked stop is not named as typed';
    await page.getByTestId(TID.create).focus();
    const hashBefore = await hash(c, pid);
    await page.keyboard.press('Enter');
    if (!(await until(async () => mapClips(await docOf(c, pid)).length === 1))) return `«יצירה» did not put a map clip on the timeline: ${(await page.getByRole('alert').allInnerTexts()).join(' | ')}`;
    const d1 = await docOf(c, pid);
    const clip = mapClips(d1)[0];
    if (T.frameIndexAt(clip.start, R) !== 0) return `the clip starts at frame ${T.frameIndexAt(clip.start, R)}, not at the playhead`;
    if (clip.drawn.stops.map((s: any) => s.name).join(',') !== 'ירושלים,פטרה') return `the stops are ${clip.drawn.stops.map((s: any) => s.name).join(',')}`;
    if (clip.drawn.stops.some((s: any) => s.lon % 10_000 !== 0 || s.lat % 10_000 !== 0)) return 'a stored coordinate is not at 0.01°';
    // edit: select the clip, open «עריכת המפה», change the look, save: one undo restores the document
    await page.locator(`.clip[data-clip-id="${clip.id}"]`).click({ position: { x: 4, y: 4 } });
    const edit = page.getByTestId(TID.edit);
    await edit.waitFor({ timeout: 10000 });
    const hashCreated = await hash(c, pid);
    await edit.focus();
    await page.keyboard.press('Enter');
    await page.getByTestId(TID.dialog).waitFor();
    if ((await page.getByTestId(TID.dialog).getAttribute('data-mode')) !== 'edit') return 'the dialog is not in edit mode';
    await page.getByTestId(TID.look).getByRole('radio', { name: 'לילה' }).click();
    await page.getByTestId(TID.create).focus();
    await page.keyboard.press('Enter');
    if (!(await until(async () => mapClips(await docOf(c, pid))[0]?.drawn.look === 'night'))) return 'saving did not change the look to night';
    await page.keyboard.press('Control+z');
    if (!(await until(async () => (await hash(c, pid)) === hashCreated))) return 'one undo did not restore the document before the edit';
    void hashBefore;
    return true;
  } finally { await close(); }
}

const wrap = (fn: () => Promise<true | string>) => async (): Promise<true | string> => { try { return await fn(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 500)}`; } };
export const TRIPMAP_PROOF_UI = { built: true as const, checks: { 5: wrap(check5), 15: wrap(check15) } };
/** Runs checks 5 and 15 one at a time and closes the server and the browser; each result is true or a sentence. */
export async function runTripmapUi(): Promise<Record<number, true | string>> {
  const out: Record<number, true | string> = {};
  try { for (const [k, fn] of Object.entries(TRIPMAP_PROOF_UI.checks)) out[Number(k)] = await fn(); } finally { await teardown(); }
  return out;
}
