/**
 * The accessibility audit scenarios of «גדלים מול העיניים» (wave 8 growing; integration): the dialog's three steps (growing-pick with
 * two pictures ticked, growing-mark with both pictures marked so the live preview is up, growing-settings) and the bar after a film
 * was made (growing-bar); a11y-audit.ts runs each in both languages and both themes, with its full heuristic.
 * The dialog is reached as the owner reaches it: the start hub's card of an EMPTY project chooses the files (the file chooser is
 * answered by the audit), and the dialog opens on them once they are in. So each dialog scenario makes its own empty scratch project.
 * Each scenario PREPARES the page and says whether the state is shown; a state that could not be brought up says `shown: false`,
 * which the audit reports as a finding, never as a pass.
 * Synthetic data only: two 640×480 drawn faces (a beige square and two magenta eye squares over ffmpeg's test pattern), made in a
 * temporary folder deleted at exit. Never a photograph.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { GROWING_TESTIDS as ID } from '../../../apps/web/src/editor/growing/growing.testids.ts';
import { growingStrings } from '../../../apps/web/src/editor/growing/growing.strings.ts';

export interface GrowingA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface GrowingA11yScenario {
  id: string;
  prepare(ctx: GrowingA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: GrowingA11yCtx): Promise<void>;
}

const W = 640, H = 480;
/** Eye squares: offset from the centre in picture pixels, per picture. */
const EYES = [[[-60, -40], [60, -40]], [[-50, -30], [70, -30]]] as const;
let files: { dir: string; stills: string[] } | null = null;
process.once('exit', () => { if (files) try { fs.rmSync(files.dir, { recursive: true, force: true }); } catch { /* best effort */ } });
function makeFiles() {
  if (files) return files;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-a11y-growing-'));
  const stills = EYES.map((eyes, i) => {
    const out = path.join(dir, `face-${i}.png`);
    const vf = ['drawbox=x=170:y=90:w=300:h=300:c=0xe8d4b0:t=fill', ...eyes.map(([dx, dy]) => `drawbox=x=${W / 2 + dx - 3}:y=${H / 2 + dy - 3}:w=6:h=6:c=0xff00ff:t=fill`)].join(',');
    execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=s=${W}x${H}:d=1`, '-vf', vf, '-frames:v', '1', out]);
    return out;
  });
  return (files = { dir, stills });
}
async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
async function setLang(page: Page, lang: 'he' | 'en') {
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
}
/** A fresh empty project, its hub's card, the file chooser answered with the two faces: true once the dialog shows both. */
export async function openDialog(ctx: GrowingA11yCtx): Promise<boolean> {
  const { page, lang } = ctx;
  const f = makeFiles();
  const pid = (await api(page, 'POST', '/projects', { name: 'a11y-growing', width: W, height: H, frameRate: { num: 30, den: 1 } })).body?.project?.id as string | undefined;
  if (!pid) return false;
  await page.goto(`${new URL(page.url()).origin}/?project=${pid}`);
  await page.getByTestId('timecode').waitFor();
  await setLang(page, lang);
  if (!(await page.getByTestId(ID.open).waitFor({ timeout: 10000 }).then(() => true, () => false))) return false;
  let chooser = null;
  for (let i = 0; i < 3 && !chooser; i++) {
    const wait = page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
    await page.getByTestId(ID.open).click();
    chooser = await wait;
  }
  if (!chooser) return false;
  await chooser.setFiles(f.stills);
  if (!(await page.getByTestId(ID.dialog).waitFor({ timeout: 60000 }).then(() => true, () => false))) return false;
  return page.waitForFunction((sel) => document.querySelectorAll(sel).length >= 2, `[data-testid="${ID.pickItem}"]`, { timeout: 30000 }).then(() => true, () => false);
}
export async function tickBoth(page: Page) { for (const t of await page.getByTestId(ID.pickTick).all()) if (!(await t.isChecked())) await t.check(); }
/** Both pictures marked by clicking their eyes (the picture fills the stage at its own proportions). */
async function markBoth(page: Page): Promise<boolean> {
  await page.getByTestId(ID.pickNext).click();
  const stage = page.getByTestId(ID.markView).locator('.pf-growing-stage');
  for (let i = 0; i < 2; i++) {
    if (!(await stage.waitFor({ timeout: 8000 }).then(() => true, () => false))) return false;
    const box = (await stage.boundingBox())!;
    for (const [dx, dy] of EYES[i]!) await page.mouse.click(box.x + ((W / 2 + dx) / W) * box.width, box.y + ((H / 2 + dy) / H) * box.height);
    if (i === 0) await page.getByTestId(ID.markNext).click();
  }
  return page.getByTestId(ID.preview).waitFor({ timeout: 15000 }).then(() => true, () => false);
}
/** Close the dialog if it is open (with marks it asks first: «close anyway»). */
export async function closeDialog(page: Page) {
  if (!(await page.getByTestId(ID.dialog).count())) return;
  await page.keyboard.press('Escape');
  if (await page.getByTestId(ID.closeAsk).waitFor({ timeout: 2000 }).then(() => true, () => false)) await page.getByTestId(ID.closeConfirm).click().catch(() => {});
  await page.getByTestId(ID.dialog).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
}
let barProject: { origin: string; pid: string } | null = null;

export const growingA11yScenarios: GrowingA11yScenario[] = [
  {
    id: 'growing-pick',
    async prepare(ctx) {
      const open = await openDialog(ctx);
      if (open) await tickBoth(ctx.page);
      return { shown: open && (await ctx.page.getByTestId(ID.pickTick).evaluateAll((els) => els.filter((e) => (e as HTMLInputElement).checked).length)) === 2, modal: true };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'growing-mark',
    async prepare(ctx) {
      const open = await openDialog(ctx);
      if (open) await tickBoth(ctx.page);
      const marked = open && (await markBoth(ctx.page));
      return { shown: marked && (await ctx.page.getByTestId(ID.markPoint).count()) === 2, modal: true, detail: { preview: marked } };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'growing-settings',
    async prepare(ctx) {
      const open = await openDialog(ctx);
      if (open) await tickBoth(ctx.page);
      const marked = open && (await markBoth(ctx.page));
      if (marked) await ctx.page.getByRole('button', { name: growingStrings(ctx.lang).next, exact: true }).click().catch(() => {});
      const shown = marked && (await ctx.page.getByTestId(ID.privacy).waitFor({ timeout: 8000 }).then(() => true, () => false));
      return { shown: shown && (await ctx.page.getByTestId(ID.create).count()) === 1, modal: true };
    },
    async leave(ctx) { await closeDialog(ctx.page); },
  },
  {
    id: 'growing-bar',
    async prepare(ctx) {
      const { page, lang } = ctx;
      const origin = new URL(page.url()).origin;
      if (!barProject || barProject.origin !== origin) {
        // made once through the dialog (the owner's own session is the only way in): pick, mark, settings, «צרו»
        const open = await openDialog(ctx);
        if (open) await tickBoth(page);
        const marked = open && (await markBoth(page));
        if (marked) await page.getByRole('button', { name: growingStrings(lang).next, exact: true }).click().catch(() => {});
        if (marked) await page.getByTestId(ID.create).click().catch(() => {});
        const made = marked && (await page.getByTestId(ID.bar).waitFor({ timeout: 30000 }).then(() => true, () => false));
        if (!made) return { shown: false, modal: false, detail: { made: false } };
        barProject = { origin, pid: new URL(page.url()).searchParams.get('project') ?? '' };
      }
      await page.goto(`${origin}/?project=${barProject.pid}`);
      await page.getByTestId('timecode').waitFor();
      await setLang(page, lang);
      const bar = await page.getByTestId(ID.bar).waitFor({ timeout: 10000 }).then(() => true, () => false);
      if (bar) await page.getByTestId(ID.barWhy).click().catch(() => {});
      return { shown: bar && (await page.getByTestId(ID.barRebuild).count()) === 1 && (await page.getByTestId(ID.why).count()) === 1, modal: false };
    },
  },
];
