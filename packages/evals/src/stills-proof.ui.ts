/**
 * proof:stills — the browser part U1–U5 (wave 8 cover, builder W3): the editor's «הפריים הכי חד» block and «שמירת התמונה» dialog in
 * Chromium, against the REAL routes of the server (POST/GET …/stills, POST …/exports with `still`, GET /jobs/:id/output). Needs
 * `pnpm build` (the server serves apps/web/dist) and W1's and W2's bodies; until those are merged the checks answer with the server's
 * own 501 / still_not_built, which this part reports as a failure, never as a pass. Imported by stills-proof.ts at integration; run
 * alone (`tsx packages/evals/src/stills-proof.ui.ts`) it prints each check.
 *
 * Fixtures are SYNTHETIC (ffmpeg testsrc2, made here in a temp dir, deleted on exit): 640x360 at 30 fps for U1–U4 (the tile and the
 * server still are both 640x360, so U4 can compare every byte), and 1920x1080 / 600 frames for the one timing sample of U5.
 * Nobody here has looked at a picture: every check is a count, an attribute, a word, a focus or a byte comparison.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { STILLS_LABEL } from '@pulseframe/core';
import { startServer, type RunningServer } from '@pulseframe/server';
import { coverT } from '../../../apps/web/src/editor/cover/cover.strings.ts';

export interface StillsProofPart { built: boolean; checks: Record<string, () => Promise<true | string>>; details: Record<string, unknown> }

const art = fs.mkdtempSync(path.join(os.tmpdir(), `pf-stills-ui-${process.pid}-`));
process.once('exit', () => { try { fs.rmSync(art, { recursive: true, force: true }); } catch { /* best effort */ } });
const rt = (n: number) => ({ value: String(n), timescale: 30 });

let server: RunningServer | null = null, browser: Browser | null = null;
const details: Record<string, unknown> = {};
interface Made { pid: string; longClip: string; shortClip: string; assetId: string }
let small: Promise<Made> | null = null;

function makeVideo(file: string, size: string, frames: number) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${frames / 30}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '10', '-pix_fmt', 'yuv420p', '-g', '15', '-an', file]);
}
async function rest(method: string, p: string, body?: unknown, raw?: Buffer): Promise<{ status: number; body: any }> {
  const r = await fetch(`${server!.url}/api/v1${p}`, { method, headers: { authorization: `Bearer ${server!.auth.tokens.agent}`, ...(raw ? { 'x-filename': 'proof.mp4' } : body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(raw ? { body: new Uint8Array(raw) } : body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  try { return { status: r.status, body: JSON.parse(text) }; } catch { return { status: r.status, body: text }; }
}
async function project(name: string, file: string, clips: number[]): Promise<{ pid: string; assetId: string; clipIds: string[] }> {
  const pid = (await rest('POST', '/projects', { name, width: 640, height: 360 })).body.project.id as string;
  const up = await rest('POST', `/projects/${pid}/assets`, undefined, fs.readFileSync(file));
  if (typeof up.body?.assetId !== 'string') throw new Error(`upload refused ${up.status}: ${JSON.stringify(up.body).slice(0, 300)}`);
  const assetId = up.body.assetId as string;
  const clipIds: string[] = [];
  let at = 0;
  for (const n of clips) {
    const tx = await rest('POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: rt(at), sourceIn: rt(0), duration: rt(n), withLinkedAudio: false } }] });
    if (!tx.body?.results) throw new Error(`add_clip refused ${tx.status}: ${JSON.stringify(tx.body).slice(0, 300)}`);
    clipIds.push(tx.body.results[0].output.clipId as string); at += n;
  }
  return { pid, assetId, clipIds };
}
async function makeSmall(): Promise<Made> {
  if (!small) small = (async () => {
    const f = path.join(art, 'small.mp4'); makeVideo(f, '640x360', 150);
    const p = await project('stills-ui', f, [90, 45]);
    return { pid: p.pid, assetId: p.assetId, longClip: p.clipIds[0]!, shortClip: p.clipIds[1]! };
  })();
  return small;
}
async function openBlock(lang: 'he' | 'en', pid: string, clipId: string): Promise<Page> {
  const ctx = await browser!.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addInitScript('globalThis.__name = (f) => f');
  await ctx.addInitScript(([l]) => { try { localStorage.setItem('pf.lang', l!); localStorage.setItem('pf.theme', 'dark'); } catch { /* storage unavailable */ } }, [lang] as const);
  const page = await ctx.newPage();
  await page.goto(`${server!.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.getByTestId('lang-toggle').click();
  await page.locator(`.clip[data-clip-id="${clipId}"]`).click({ position: { x: 4, y: 4 } });
  await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
  const sec = page.getByTestId('section-sharpest');
  await sec.waitFor({ timeout: 10000 });
  if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
  await page.getByTestId('sharp-panel').waitFor({ timeout: 8000 });
  return page;
}
const waitState = (page: Page, states: string[], timeout = 120_000) => page.waitForFunction((want) => want.includes(document.querySelector('[data-testid=sharp-panel]')?.getAttribute('data-state') ?? ''), states, { timeout }).then(() => true, () => false);
async function measure(page: Page): Promise<string> {
  if ((await page.getByTestId('sharp-panel').getAttribute('data-state')) === 'found') return 'found';
  await page.getByTestId('sharp-measure').click();
  await waitState(page, ['found', 'refused']);
  return (await page.getByTestId('sharp-panel').getAttribute('data-state')) ?? 'none';
}
const says = async (page: Page, id: string) => ((await page.getByTestId(id).first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
const FORBIDDEN = /הכי טוב|★|⭐|מושלם|\bbest\b|\bperfect\b/i;

async function u1(): Promise<true | string> {
  const m = await makeSmall(), bad: string[] = [];
  const page = await openBlock('he', m.pid, m.longClip);
  const st = await measure(page);
  if (st !== 'found') return `the block did not reach «found» (state ${st}; ${await says(page, 'sharp-status')})`;
  const tiles = page.getByTestId('sharp-tile'), n = await tiles.count();
  if (n < 1 || n > 3) bad.push(`${n} tiles (want 1..3)`);
  for (let i = 0; i < n; i++) {
    const nums = tiles.nth(i).getByTestId('sharp-numbers');
    for (const a of ['data-sharp', 'data-sigma100', 'data-hi', 'data-lo']) if (!(await nums.getAttribute(a))) bad.push(`tile ${i + 1} has no ${a}`);
    if (!(await tiles.nth(i).getByTestId('sharp-label').textContent())?.includes(STILLS_LABEL.he)) bad.push(`tile ${i + 1}: the heuristic label is missing`);
    if (!(await tiles.nth(i).textContent())?.includes('לא נבדק בעין')) bad.push(`tile ${i + 1}: «לא נבדק בעין» is missing`);
    if (!(await tiles.nth(i).locator('bdi[dir=ltr]').count())) bad.push(`tile ${i + 1}: numbers are not in LTR isolates`);
  }
  if (FORBIDDEN.test(await page.getByTestId('sharp-panel').innerText())) bad.push('a verdict word or a star is on the block');
  const first = await page.getByTestId('sharp-panel').innerText();
  if (!first.includes(coverT('he')('found', { n }))) bad.push(`«${coverT('he')('found', { n })}» is not said`);
  // a clip of 1.5 s cannot hold three candidates one second apart
  const short = await openBlock('he', m.pid, m.shortClip);
  const st2 = await measure(short);
  const n2 = st2 === 'found' ? await short.getByTestId('sharp-tile').count() : -1;
  if (st2 !== 'found' || n2 < 1 || n2 > 2) bad.push(`short clip: state ${st2}, ${n2} tiles (want 1 or 2)`);
  else if (!(await short.getByTestId('sharp-panel').innerText()).includes(coverT('he')('found', { n: n2 }))) bad.push('short clip: «נמצאו {n}» is not said');
  await page.context().close(); await short.context().close();
  return bad.length ? bad.join('; ') : true;
}

async function u2(): Promise<true | string> {
  const m = await makeSmall(), bad: string[] = [];
  const page = await openBlock('he', m.pid, m.longClip);
  if ((await measure(page)) !== 'found') return 'not found';
  const tile = page.getByTestId('sharp-tile').first();
  await tile.focus();
  const f0 = Number(await tile.getAttribute('data-frame'));
  await page.keyboard.press('ArrowRight');
  if (Number(await tile.getAttribute('data-frame')) !== f0 + 1) bad.push('→ did not go one source frame later');
  if (Number(await tile.getByTestId('sharp-numbers').getAttribute('data-frame')) !== f0 + 1) bad.push('the numbers did not follow the frame');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  if (Number(await tile.getAttribute('data-frame')) !== f0 - 1 && f0 > 0) bad.push('← did not go one frame earlier');
  const before = Number(await tile.getAttribute('data-frame'));
  await page.keyboard.press('Shift+ArrowRight');
  if (Number(await tile.getAttribute('data-frame')) !== Math.min(149, before + 30)) bad.push('Shift+→ is not one second of the file (30 frames)');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight'); // past the clip's 90 frames: no record
  const nums = tile.getByTestId('sharp-numbers');
  if ((await nums.getAttribute('data-sharp')) !== null || !(await nums.textContent())?.includes(coverT('he')('notMeasured'))) bad.push('a frame outside the measured stretch must say «לא נמדד» and carry no number');
  if (await page.evaluate(() => document.activeElement?.getAttribute('data-testid')) !== 'sharp-tile') bad.push('the focus left the tile while stepping');
  await page.context().close();
  return bad.length ? bad.join('; ') : true;
}

async function dialogPass(lang: 'he' | 'en'): Promise<string[]> {
  const m = await makeSmall(), bad: string[] = [], t = coverT(lang);
  const page = await openBlock(lang, m.pid, m.longClip);
  if ((await measure(page)) !== 'found') return [`${lang}: not found`];
  const tile = page.getByTestId('sharp-tile').first();
  await tile.focus();
  await page.keyboard.press('Enter');
  const dlg = page.getByTestId('still-dialog');
  await dlg.waitFor({ timeout: 8000 });
  if ((await dlg.getAttribute('role')) !== 'dialog') bad.push(`${lang}: not role=dialog`);
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid=still-dialog]'));
  if (!(await inside())) bad.push(`${lang}: focus is not inside the dialog`);
  for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await inside())) { bad.push(`${lang}: Tab left the dialog`); break; } }
  // paper by keyboard: focus the radio and press Space
  await page.getByTestId('still-paper-10x15').focus(); await page.keyboard.press('Space');
  const crop = page.getByTestId('still-crop');
  await crop.waitFor({ timeout: 5000 });
  const ppiOf = async () => Number(await page.locator('[data-testid=still-ppi][data-paper=a4]').getAttribute('data-ppi'));
  if ((await page.getByTestId('still-ppi').count()) !== 3) bad.push(`${lang}: want one ppi line per paper`);
  if (!(await page.getByTestId('still-rule').textContent())?.includes(t('rule'))) bad.push(`${lang}: the rule-of-thumb line is missing`);
  await crop.focus();
  const x0 = Number(await crop.getAttribute('data-x')), w0 = Number(await crop.getAttribute('data-w')), p0 = await ppiOf();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Shift+ArrowLeft');
  const x1 = Number(await crop.getAttribute('data-x'));
  if (x1 === x0) bad.push(`${lang}: the arrows did not move the crop frame`);
  await page.keyboard.press('-');
  const w1 = Number(await crop.getAttribute('data-w')), p1 = await ppiOf();
  if (!(w1 < w0)) bad.push(`${lang}: «-» did not shrink the frame`);
  if (!(p1 < p0)) bad.push(`${lang}: the ppi line did not follow the crop (${p0} -> ${p1})`);
  // the lines do not overlap and the page has no sideways overflow in the dialog
  const boxes = await page.locator('[data-testid=still-ppi]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.top, r.bottom]; }));
  for (let i = 1; i < boxes.length; i++) if (boxes[i]![0]! < boxes[i - 1]![1]! - 0.5) bad.push(`${lang}: ppi lines overlap`);
  const dir = await page.evaluate(() => getComputedStyle(document.documentElement).direction);
  if (dir !== (lang === 'he' ? 'rtl' : 'ltr')) bad.push(`${lang}: direction ${dir}`);
  if (!(await page.getByTestId('still-note').allTextContents()).join(' ').includes(t('browserReading'))) bad.push(`${lang}: the browser-reading note is missing`);
  await page.keyboard.press('Escape');
  if ((await page.getByTestId('still-dialog').count()) !== 0) bad.push(`${lang}: Escape did not close the dialog`);
  if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) !== 'still-save') bad.push(`${lang}: Escape did not return the focus to still-save`);
  await page.context().close();
  return bad;
}
async function u3(): Promise<true | string> { const bad = [...(await dialogPass('he')), ...(await dialogPass('en'))]; return bad.length ? bad.join('; ') : true; }

async function u4(): Promise<true | string> {
  const m = await makeSmall();
  const page = await openBlock('he', m.pid, m.longClip);
  if ((await measure(page)) !== 'found') return 'not found';
  const tile = page.getByTestId('sharp-tile').first();
  const frame = Number(await tile.getAttribute('data-frame'));
  await page.waitForTimeout(1500); // the paused player has drawn
  await tile.getByTestId('still-save').click();
  await page.getByTestId('still-dialog').waitFor({ timeout: 8000 });
  await page.getByTestId('still-run').click();
  const link = page.getByTestId('still-download');
  await link.waitFor({ timeout: 120_000 }).catch(() => undefined);
  if (!(await link.count())) return `the saved picture did not finish: ${await says(page, 'still-job')}`;
  const href = await link.getAttribute('href');
  const r = await page.evaluate(async ({ href, frame }) => {
    const blob = await (await fetch(href!)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d')!; ctx.drawImage(bmp, 0, 0);
    const server = ctx.getImageData(0, 0, c.width, c.height).data;
    // the tile's own canvas (it is behind the dialog; same document, same frame)
    const tc = document.querySelector<HTMLCanvasElement>(`[data-testid=sharp-tile][data-frame="${frame}"] canvas`);
    const tileError = document.querySelector(`[data-testid=sharp-tile][data-frame="${frame}"] [data-still-error]`)?.textContent ?? null;
    if (!tc) return { error: 'no tile canvas' };
    const tctx = tc.getContext('2d');
    if (!tctx) return { error: 'tile canvas has no 2d context' };
    if (tc.width !== c.width || tc.height !== c.height) return { error: `sizes differ: tile ${tc.width}x${tc.height}, still ${c.width}x${c.height}` };
    const t = tctx.getImageData(0, 0, tc.width, tc.height).data;
    let diff = 0, max = 0, sum = 0; for (let i = 0; i < t.length; i++) { const d = Math.abs(t[i]! - server[i]!); if (d) { diff++; sum += d; if (d > max) max = d; } }
    const toUrl = (cv: HTMLCanvasElement) => cv.toDataURL('image/png');
    return { diff, bytes: t.length, maxDiff: max, meanAbs: +(sum / t.length).toFixed(3), tile: { ...tc.dataset, error: tileError }, tilePng: diff ? toUrl(tc) : '', stillPng: diff ? toUrl(c) : '' };
  }, { href, frame });
  await page.context().close();
  if ('error' in r) return r.error as string;
  if (process.env.PF_STILLS_UI_DUMP && r.diff) for (const k of ['tilePng', 'stillPng'] as const) fs.writeFileSync(path.join(process.env.PF_STILLS_UI_DUMP, `${k}.png`), Buffer.from(r[k].split(',')[1]!, 'base64'));
  const { tilePng: _t, stillPng: _s, ...kept } = r;
  details.u4 = { frame, ...kept };
  return r.diff === 0 ? true : `the tile and the server still differ in ${r.diff} of ${r.bytes} bytes (frame ${frame})`;
}

async function u5(): Promise<true | string> {
  const f = path.join(art, 'big.mp4'); makeVideo(f, '1920x1080', 600);
  const p = await project('stills-ui-timing', f, [600]);
  const page = await openBlock('he', p.pid, p.clipIds[0]!);
  const t0 = Date.now(), stages: { ms: number; stage: string }[] = [];
  await page.getByTestId('sharp-measure').click();
  let last = '';
  for (;;) {
    const st = await page.getByTestId('sharp-panel').getAttribute('data-state');
    const stage = st === 'measuring' ? await page.locator('[data-testid=sharp-panel] [role=progressbar]').getAttribute('aria-valuetext').catch(() => '') : st;
    if ((stage ?? '') !== last) { last = stage ?? ''; stages.push({ ms: Date.now() - t0, stage: last }); }
    if (st === 'found' || st === 'refused' || Date.now() - t0 > 600_000) break;
    await page.waitForTimeout(250);
  }
  details.u5 = { label: 'one sample, this container', wallMs: Date.now() - t0, stages: stages.slice(0, 40), finalState: await page.getByTestId('sharp-panel').getAttribute('data-state') };
  await page.context().close();
  return (details.u5 as { finalState: string }).finalState === 'found' ? true : `the 600-frame stretch ended in ${(details.u5 as { finalState: string }).finalState}`;
}

export async function startUi(): Promise<void> {
  if (server) return;
  server = await startServer({ port: 0, host: '127.0.0.1', dataDir: path.join(art, 'data'), backupDir: null, libraryDir: null });
  browser = await chromium.launch();
}
export async function stopUi(): Promise<void> { await browser?.close().catch(() => {}); await server?.close().catch(() => {}); browser = null; server = null; }

/** Each check starts the shared server on first use; `finish` stops it. */
const lazy = (f: () => Promise<true | string>) => async () => { await startUi(); try { return await f(); } catch (e) { return `threw: ${String((e as Error).message ?? e).split('\n')[0]}`; } };
export const STILLS_UI_PART: StillsProofPart = {
  built: true,
  checks: { U1: lazy(u1), U2: lazy(u2), U3: lazy(u3), U4: lazy(u4), U5: lazy(u5) },
  details,
};

if (process.argv[1]?.endsWith('stills-proof.ui.ts')) {
  void (async () => {
    let failed = 0;
    for (const [id, f] of Object.entries(STILLS_UI_PART.checks)) { const r = await f(); if (r !== true) failed++; console.log(`${r === true ? 'PASS' : 'FAIL'} ${id}${r === true ? '' : `: ${r}`}`); }
    console.log(JSON.stringify(details));
    await stopUi();
    process.exit(failed ? 1 : 0);
  })();
}
