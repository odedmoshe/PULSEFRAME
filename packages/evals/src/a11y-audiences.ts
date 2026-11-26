/**
 * The accessibility audit scenario of «גרסה לכל קהל» (wave 8 audiences, integration): the panel «מה שונה בגרסה הזו» open on a calm
 * version in the Deliver workspace (change rows with jump-to and «להשאיר כמו במקור», the sound rows, the not-handled sentences, the
 * version chip with its profile glyph, the stage note); a11y-audit.ts runs it in both languages and in both themes. The scenario
 * PREPARES the page and says whether the state is shown; a11y-audit.ts then runs its full heuristic on it. A state that could not be
 * brought up says `shown: false`, which the audit reports as a finding, never as a pass.
 * Synthetic data only: a scratch project of its own with one generated 2-second video (ffmpeg testsrc2), a shake effect and a title.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from 'playwright';
import { AUDIENCE_TESTIDS as ID } from '../../../apps/web/src/editor/audience/audience.testids.ts';

export interface AudiencesA11yCtx { page: Page; lang: 'he' | 'en'; pid: string }
export interface AudiencesA11yScenario {
  id: string;
  prepare(ctx: AudiencesA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: AudiencesA11yCtx): Promise<void>;
}

const homes = new WeakMap<Page, string>();
const settle = (page: Page) => page.waitForTimeout(250);
const frame = (n: number) => ({ value: String(n), timescale: 30 });

export const audiencesA11yScenarios: AudiencesA11yScenario[] = [
  {
    id: 'audience-panel',
    async prepare(ctx) {
      const { page } = ctx;
      const home = page.url();
      homes.set(page, home);
      const origin = new URL(home).origin;
      const headers = { origin, 'content-type': 'application/json' };
      const post = async (p: string, data: unknown) => { const r = await page.request.post(`${origin}/api/v1${p}`, { headers, data }); if (!r.ok()) throw new Error(`${p} answered ${r.status()}: ${(await r.text()).slice(0, 200)}`); return (await r.json()) as any; };
      const id = (await post('/projects', { name: 'audiences-a11y', width: 320, height: 180 })).project.id as string;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-aud-a11y-'));
      const mp4 = path.join(dir, 'a.mp4');
      try {
        execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-frames:v', '60', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', mp4]);
        const up = await page.request.post(`${origin}/api/v1/projects/${id}/assets`, { headers: { origin, 'x-filename': 'a.mp4' }, data: fs.readFileSync(mp4) });
        const assetId = ((await up.json()) as { assetId: string }).assetId;
        const r = await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_clip', args: { assetId, start: frame(0), duration: frame(60), withLinkedAudio: false } }] });
        const clipId = r.results[0].output.clipId as string;
        await post(`/projects/${id}/transactions`, { ops: [{ op: 'add_effect', args: { clipId, type: 'motion.shake' } }, { op: 'add_text', args: { text: 'שלום', start: frame(10), duration: frame(30) } }] });
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
      const u = new URL(home);
      u.searchParams.set('project', id);
      await page.goto(u.toString());
      await page.getByTestId('timecode').waitFor({ timeout: 30000 });
      if ((await page.evaluate(() => document.documentElement.lang)) !== ctx.lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => undefined);
      // the Deliver workspace (the fifth mode), then «+» → «גרסה רגועה»: one add_audience_version, and the viewer switches to it
      await page.locator('[data-testid=workspace-switch] [role=radio], [data-testid=workspace-switch] button').nth(4).click();
      await settle(page);
      await page.getByTestId('prism-add').click();
      await page.getByTestId(ID.menuCalm).click();
      await page.getByTestId(ID.panel).waitFor({ timeout: 10000 }).catch(() => undefined);
      await page.waitForFunction((pid) => document.querySelector(`[data-testid=${pid}]`)?.getAttribute('data-state') === 'list', ID.panel, { timeout: 15000 }).catch(() => undefined);
      await settle(page);
      const state = await page.getByTestId(ID.panel).getAttribute('data-state').catch(() => null);
      const rows = await page.getByTestId(ID.change).count();
      const glyph = await page.locator(`[data-testid=${ID.chipMark}][data-profile=calm]`).count();
      await page.getByTestId(ID.panel).scrollIntoViewIfNeeded().catch(() => undefined);
      return { shown: state === 'list' && rows > 0 && glyph === 1, modal: false, detail: { panelState: state, rows, chipGlyph: glyph, fixture: 'synthetic testsrc2 clip with a shake effect and a title; nobody looked at it' } };
    },
    async leave(ctx) {
      const home = homes.get(ctx.page);
      if (!home) return;
      await ctx.page.goto(home); // the page the audit had before this scenario
      await ctx.page.getByTestId('timecode').waitFor({ timeout: 30000 }).catch(() => undefined);
      homes.delete(ctx.page);
    },
  },
];
