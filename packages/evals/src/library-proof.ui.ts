/**
 * pnpm proof:library, part ui (worker C): check 17 of library-proof.ts, plus `libraryPanelsProbe`, which the editor-interactions
 * proof and the a11y audit share. Check 17 drives the editor (he and en; 1280 and 1440) against a server whose library the proof
 * sets up through the Settings flow itself, over a SYNTHETIC library folder it makes with the server track's library-fixtures.ts
 * (outside the data directory; removed afterwards). It never needs the owner's library.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { fileURLToPath } from 'node:url';
import { startServer } from '@pulseframe/server';
import { closeLibraryService } from '../../../apps/server/src/library/index.ts';
import { LIBRARY_TESTIDS as TID } from '../../../apps/web/src/editor/library/library.testids.ts';
import type { LibraryProofPart } from './library-proof.ts';
import { makeLibraryFixture } from './library-fixtures.ts';

/** Every fixed id that is a plain string (the row and kind ids are per element). */
const FIXED_IDS: string[] = (Object.values(TID) as unknown[]).filter((v): v is string => typeof v === 'string');

/** What a library panel shows right now: which honest state, how many rows, and the boxes of the library ids that are on screen. */
export async function libraryPanelsProbe(page: Page): Promise<{ state: 'not_built' | 'not_configured' | 'indexing' | 'error' | 'empty' | 'list' | 'none'; rows: number; overlaps: string[]; visible: string[] }> {
  return page.evaluate((ids) => {
    const q = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
    const empty = q('library-empty')[0];
    const state = q('library-not-configured').length ? 'not_configured' : q('library-indexing').length ? 'indexing' : empty ? ((empty.dataset.state as 'not_built' | 'error' | 'empty') ?? 'empty') : q('library-list').length ? 'list' : 'none';
    // overlap: two visible leaf controls whose boxes cross (a container and its own descendants are not an overlap)
    const els = ids.flatMap((id) => q(id).map((el) => ({ id, el }))).filter(({ el }) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; });
    const overlaps: string[] = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i]!, b = els[j]!;
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x = a.el.getBoundingClientRect(), y = b.el.getBoundingClientRect();
      if (x.left < y.right - 1 && y.left < x.right - 1 && x.top < y.bottom - 1 && y.top < x.bottom - 1) overlaps.push(`${a.id} x ${b.id}`);
    }
    return { state: state as never, rows: q('library-row').length, overlaps, visible: [...new Set(els.map((e) => e.id))] };
  }, FIXED_IDS);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check17(): Promise<true | string> {
  if (!fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/web/dist/index.html'))) return 'BLOCKED: web bundle missing (run `pnpm build`), the editor cannot be opened';
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-library-ui-'));
  const root = (await makeLibraryFixture(path.join(base, 'fixture'))).root;
  const dataDir = path.join(base, 'data');
  fs.mkdirSync(dataDir);
  const s = await startServer({ port: 8817, dataDir, libraryDir: null });
  const browser = await chromium.launch();
  const problems: string[] = [];
  try {
    const h = { authorization: `Bearer ${s.auth.tokens.agent}`, 'content-type': 'application/json' };
    const api = async (p: string) => { const r = await fetch(`${s.url}/api/v1${p}`, { headers: h }); return { status: r.status, body: await r.json().catch(() => null) as any }; };
    const pid = (await (await fetch(`${s.url}/api/v1/projects`, { method: 'POST', headers: h, body: JSON.stringify({ name: 'library-ui', width: 640, height: 360 }) })).json() as any).project.id as string;
    let first = true;
    for (const [lang, width] of [['he', 1280], ['he', 1440], ['en', 1280], ['en', 1440]] as const) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
      await ctx.addInitScript(`globalThis.__name = (f) => f; try { localStorage.setItem('pf.lang', '${lang}'); } catch {}`);
      const page = await ctx.newPage();
      const tag = `${lang}@${width}`;
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.getByTestId('timecode').waitFor({ timeout: 30000 });
      // 1: nothing is set up yet (first run only): the tab says so, and «פתיחת ההגדרות» opens Settings where the folder is set
      await page.getByTestId('rail-audio').click();
      await page.getByTestId(TID.audioTab).click();
      await page.getByTestId(TID.audioPanel).waitFor({ timeout: 8000 });
      if (first) {
        await page.getByTestId(TID.notConfigured).waitFor({ timeout: 8000 }).catch(() => {});
        if (!(await page.getByTestId(TID.notConfigured).count())) problems.push(`${tag}: no «הספרייה לא מוגדרת» state before a folder is set (${JSON.stringify(await libraryPanelsProbe(page))})`);
        await page.getByTestId(TID.openSettings).click();
        await page.getByTestId(TID.settingsRoot).fill(root);
        await page.getByTestId(TID.settingsSave).click();
        const ready = await page.waitForFunction((id) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)?.dataset.state === 'ready', TID.settingsState, { timeout: 60000 }).then(() => true, () => false);
        if (!ready) problems.push(`${tag}: the Settings flow did not bring the library to ready`);
        await page.keyboard.press('Escape');
        first = false;
      } else { await page.waitForTimeout(500); }
      // 2: rows, audition aria-pressed true while playing, false after Escape
      await page.getByTestId(TID.row).first().waitFor({ timeout: 15000 }).catch(() => {});
      const play = page.getByTestId(TID.play).first();
      if (await play.count()) {
        await play.click();
        const on = await play.getAttribute('aria-pressed');
        await page.keyboard.press('Escape');
        await sleep(150);
        const off = await play.getAttribute('aria-pressed');
        if (on !== 'true' || off !== 'false') problems.push(`${tag}: audition aria-pressed ${on} then ${off} (wanted true then false)`);
      } else problems.push(`${tag}: no audition button on any row`);
      // 3: zero overlapping boxes among the library ids; the elements drawer's library tab too
      const probeA = await libraryPanelsProbe(page);
      if (probeA.overlaps.length) problems.push(`${tag}: overlapping boxes in the sound tab ${probeA.overlaps.join(', ')}`);
      await page.getByTestId('rail-elements').click();
      await page.getByTestId(TID.elementsTabLibrary).click();
      await page.getByTestId(TID.elementsPanelLibrary).waitFor({ timeout: 8000 });
      await sleep(600);
      const probeE = await libraryPanelsProbe(page);
      if (probeE.overlaps.length) problems.push(`${tag}: overlapping boxes in the elements tab ${probeE.overlaps.join(', ')}`);
      // 4: use a track, then the credits panel's copy button puts descriptionText of the interface language on the clipboard
      await page.getByTestId('rail-audio').click();
      await page.getByTestId(TID.audioTab).click();
      await page.getByTestId(TID.use).first().click().catch(() => {});
      await sleep(1500);
      await page.getByTestId('export').click().catch(() => {});
      const copy = page.getByTestId(TID.creditsCopy);
      if (await copy.count()) {
        await copy.click();
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        const want = (await api(`/projects/${pid}/credits?lang=${lang}`)).body?.descriptionText;
        if (clip !== want) problems.push(`${tag}: clipboard differs from descriptionText(${lang})`);
      }
      await ctx.close();
    }
    return problems.length ? problems.join('; ') : true;
  } finally { await browser.close(); await s.close(); closeLibraryService(dataDir); fs.rmSync(base, { recursive: true, force: true }); }
}

export const LIBRARY_PROOF_UI: LibraryProofPart = { built: true, checks: { 17: check17 } };
