/**
 * pnpm proof:audiences, part ui (W3): checks 20 and 21 of audiences-proof.ts, in headless Chromium against the REAL server and the BUILT
 * web app (`pnpm build` first), on SYNTHETIC fixtures only (a barcode clip by packages/fixtures, one Hebrew title, one shake effect).
 * WRITTEN AGAINST THE REAL ROUTES (add_audience_version, GET …/variants/:id/audience, set_audience_keep) for the integrator: it was NOT
 * run by its author, because W1's and W2's bodies were not in the builder's worktree. Nothing here looks or listens: it measures
 * elements, document hashes, the playhead and which element holds the focus.
 *   20  «+» → «גרסה רגועה» is ONE transaction; a chip with the profile glyph appears and is viewed; the panel lists the changes; the
 *       menu is still there with all four formats added (C14); Ctrl+Z returns the document hash.
 *   21  by keyboard only: Tab reaches a row, Enter moves the playhead to its frame and leaves the focus where it was, «להשאיר כמו במקור»
 *       commits once (one revision); in Hebrew (RTL) and in English.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { canonical, findClip, FORMAT_PROFILES, type ProjectDocument } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer, type RunningServer } from '@pulseframe/server';
import { AUDIENCE_TESTIDS as ID } from '../../../apps/web/src/editor/audience/audience.testids.ts';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx { s: RunningServer; browser: Browser; art: string; closed: boolean; agent: Record<string, string> }
let ctxP: Promise<Ctx> | null = null;
function setup(): Promise<Ctx> {
  ctxP ??= (async () => {
    if (!fs.existsSync(path.join(ROOT, 'apps/web/dist/index.html'))) throw new Error('the web bundle (apps/web/dist) is not built: run `pnpm build` first');
    const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aud-ui-'));
    const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
    await generateBarcodeFixture({ out: path.join(art, 'sea.mp4'), width: 320, height: 180, frames: 90 });
    return { s, browser: await chromium.launch(), art, closed: false, agent: { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' } };
  })();
  return ctxP;
}
async function teardown() {
  if (!ctxP) return;
  const c = await ctxP;
  if (c.closed) return;
  c.closed = true;
  await c.browser.close().catch(() => undefined);
  await c.s.close().catch(() => undefined);
  fs.rmSync(c.art, { recursive: true, force: true });
}
const call = async (c: Ctx, method: string, p: string, body?: unknown) => {
  const r = await fetch(`${c.s.url}/api/v1${p}`, { method, headers: { ...c.agent, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: (r.headers.get('content-type') ?? '').includes('json') ? ((await r.json()) as any) : null };
};
const tx = async (c: Ctx, pid: string, ops: unknown[]) => { const r = await call(c, 'POST', `/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`transaction failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
const getDoc = async (c: Ctx, pid: string): Promise<{ doc: ProjectDocument; revision: number }> => { const r = await call(c, 'GET', `/projects/${pid}`); return { doc: r.body.project, revision: r.body.revision }; };
const until = async (get: () => Promise<boolean>, ms = 8000) => { const t = Date.now(); for (;;) { if (await get()) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

/** Two 60-frame clips back to back, the first with a shake effect, a title; the editor open on it in the Deliver workspace. */
async function open(c: Ctx, lang: 'he' | 'en', name: string, allFormats: boolean) {
  const pid = (await call(c, 'POST', '/projects', { name, width: 320, height: 180, frameRate: R })).body.project.id as string;
  const up = await fetch(`${c.s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...c.agent, 'x-filename': 'sea.mp4' }, body: fs.readFileSync(path.join(c.art, 'sea.mp4')) });
  const asset = ((await up.json()) as any).assetId as string;
  const a = (await tx(c, pid, [{ op: 'add_clip', args: { assetId: asset, start: f(0), duration: f(60), withLinkedAudio: false } }])).results[0].output.clipId as string;
  const trackId = findClip((await getDoc(c, pid)).doc, a)!.track.id;
  await tx(c, pid, [{ op: 'add_clip', args: { assetId: asset, trackId, start: f(60), sourceIn: f(0), duration: f(30), withLinkedAudio: false } }, { op: 'add_effect', args: { clipId: a, type: 'motion.shake' } }, { op: 'add_text', args: { text: 'שלום נעה', start: f(70), duration: f(20) } }]);
  if (allFormats) await tx(c, pid, FORMAT_PROFILES.map((p) => ({ op: 'add_variant', args: { profileId: p.id, name: p.name.en } })));
  const ctx = await c.browser.newContext({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
  await ctx.addInitScript(({ l }) => { try { localStorage.setItem('pf.lang', l); } catch { /* storage unavailable */ } }, { l: lang });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 400)));
  await page.goto(`${c.s.ownerUrl}&project=${pid}`);
  await page.getByTestId('timecode').waitFor({ timeout: 30000 });
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click();
  await page.waitForFunction(() => document.querySelectorAll('.clip').length >= 2, undefined, { timeout: 15000 });
  await page.locator('[data-testid=workspace-switch] [role=radio], [data-testid=workspace-switch] button').nth(4).click(); // «Deliver», the fifth mode (Header.tsx MODES)
  return { pid, page, close: () => ctx.close() };
}
const addVersion = async (page: Page, id: string) => { await page.getByTestId('prism-add').click(); await page.getByTestId(id).click(); };

async function check20(): Promise<true | string> {
  const c = await setup();
  const p = await open(c, 'he', 'aud-20', true);
  try {
    const before = await getDoc(c, p.pid);
    if (Object.keys(before.doc.variants).length !== FORMAT_PROFILES.length) return `expected ${FORMAT_PROFILES.length} formats, found ${Object.keys(before.doc.variants).length}`;
    if (!(await p.page.getByTestId('prism-add').count())) return 'the «+» menu is gone once all four formats exist (C14)';
    await addVersion(p.page, ID.menuCalm);
    if (!(await until(async () => Object.values((await getDoc(c, p.pid)).doc.variants).some((v) => v.audience?.profile === 'calm')))) return 'no calm version was added';
    const after = await getDoc(c, p.pid);
    if (after.revision !== before.revision + 1) return `adding the version took ${after.revision - before.revision} revisions, not one transaction`;
    const v = Object.values(after.doc.variants).find((x) => x.audience)!;
    if (v.name !== 'גרסה רגועה') return `the version is named ${JSON.stringify(v.name)} in Hebrew`;
    if (!(await p.page.locator(`[data-testid=${ID.chipMark}][data-profile=calm]`).count())) return 'no chip with the calm glyph';
    if ((await p.page.getByTestId('format-switch').getAttribute('data-value')) !== v.id) return 'the viewer did not switch to the new version';
    await p.page.getByTestId(ID.panel).waitFor({ timeout: 8000 });
    if (!(await until(async () => (await p.page.getByTestId(ID.panel).getAttribute('data-state')) === 'list'))) return `the panel is ${await p.page.getByTestId(ID.panel).getAttribute('data-state')}, not a list`;
    if (!(await p.page.locator(`[data-testid=${ID.change}][data-rule=effect]`).count())) return 'the shake effect is not listed as a change';
    if ((await p.page.getByTestId(ID.notHandled).count()) < 5) return 'the not-handled sentences are not all shown';
    if (!(await p.page.getByTestId(ID.stageNote).innerText()).includes('לא נצפתה')) return 'the stage note does not say «לא נצפתה»';
    await p.page.keyboard.press('Control+z');
    if (!(await until(async () => sha(canonical((await getDoc(c, p.pid)).doc)) === sha(canonical(before.doc))))) return 'Ctrl+Z did not return the exact document';
    return true;
  } finally { await p.close(); }
}

async function check21Lang(c: Ctx, lang: 'he' | 'en'): Promise<true | string> {
  const p = await open(c, lang, `aud-21-${lang}`, false);
  try {
    await addVersion(p.page, ID.menuCalm);
    await p.page.getByTestId(ID.panel).waitFor({ timeout: 8000 });
    if (!(await until(async () => (await p.page.getByTestId(ID.change).count()) > 0))) return `${lang}: no change rows`;
    if ((await p.page.getByTestId(ID.panel).getAttribute('dir')) !== (lang === 'he' ? 'rtl' : 'ltr')) return `${lang}: the panel has the wrong direction`;
    const row = p.page.locator(`[data-testid=${ID.change}][data-rule=effect]`).first();
    const frame = Number(await row.getAttribute('data-start-frame'));
    // a keyboard-only reach: Tab from the panel heading until a row holds the focus (at most 60 presses)
    await p.page.getByTestId(ID.panel).locator('h4').evaluate((el) => { el.setAttribute('tabindex', '-1'); (el as HTMLElement).focus(); });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) { await p.page.keyboard.press('Tab'); reached = await p.page.evaluate((id) => (document.activeElement as HTMLElement | null)?.dataset.testid === id, ID.change); }
    if (!reached) return `${lang}: Tab never reached a change row`;
    await p.page.keyboard.press('Enter');
    if (!(await until(async () => (await p.page.getByTestId('timecode').innerText()).replace(/[^0-9:;]/g, '') === T.toTimecode(f(frame), R).replace(/[^0-9:;]/g, '')))) return `${lang}: Enter did not move the playhead to frame ${frame}`;
    await sleep(400); // a deferred focus would show up by now
    if (!(await p.page.evaluate((id) => (document.activeElement as HTMLElement | null)?.dataset.testid === id, ID.change))) return `${lang}: the focus left the row after the jump`;
    // keep: the next Tab stop inside the same item is the button
    const rev = (await getDoc(c, p.pid)).revision;
    await p.page.keyboard.press('Tab');
    if (!(await p.page.evaluate((id) => (document.activeElement as HTMLElement | null)?.dataset.testid === id, ID.keep))) return `${lang}: the keep button does not follow its row in the tab order`;
    await p.page.keyboard.press('Enter');
    if (!(await until(async () => (await getDoc(c, p.pid)).revision === rev + 1))) return `${lang}: keeping did not commit one revision`;
    await sleep(500);
    if ((await getDoc(c, p.pid)).revision !== rev + 1) return `${lang}: keeping committed more than once`;
    if (!(await until(async () => (await p.page.locator(`[data-testid=${ID.change}][data-kept=true]`).count()) > 0))) return `${lang}: the row is not marked as kept after the keep`;
    return true;
  } finally { await p.close(); }
}
async function check21(): Promise<true | string> {
  const c = await setup();
  const he = await check21Lang(c, 'he');
  return he !== true ? he : check21Lang(c, 'en');
}

const wrap = (fn: () => Promise<true | string>) => async (): Promise<true | string> => { try { return await fn(); } catch (e) { return `threw: ${String((e as Error)?.stack ?? e).slice(0, 500)}`; } };
/** One part of the proof (the integrator imports it in audiences-proof.ts): checks 20 and 21. NOT run by its author. */
export const AUDIENCES_PROOF_UI = { built: true, teardown, checks: { 20: wrap(check20), 21: wrap(check21) } };
