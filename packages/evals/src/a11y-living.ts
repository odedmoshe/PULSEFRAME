/**
 * The accessibility audit scenarios of «תמונה חיה» (wave 8 living track): the block offered (before «הפכו לתמונה חיה»), the block on
 * (move chips, amount slider, lines), and the depth dialog open (modal). Each PREPARES the page and says whether the state is shown
 * (and whether it is modal); a11y-audit.ts runs its heuristic on it in both themes and languages (the lead wires it in).
 * The photo is a SYNTHETIC 64×36 PNG built here from raw bytes (zlib), in its own project; the states come from the real editor. The
 * living picture is made through the same route the editor's «שמירה» uses (set_living_picture with the depth). Where depthGrid is not
 * built (W1 unmerged) the dialog reports not shown, and the block "on" state is not made: honest, never faked.
 */
import zlib from 'node:zlib';
import type { Page } from 'playwright';

export interface LivingA11yCtx { page: Page; lang: 'he' | 'en'; pid?: string }
export interface LivingA11yScenario {
  id: string;
  prepare(ctx: LivingA11yCtx): Promise<{ shown: boolean; modal: boolean; detail?: Record<string, unknown> }>;
  leave?(ctx: LivingA11yCtx): Promise<void>;
}

const rt = (n: number) => ({ value: String(n), timescale: 30 });
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
}
/** A synthetic gradient photo, w×h, RGB. */
export function syntheticPng(w = 64, h = 36): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 4) & 255; raw[o + 1] = (y * 7) & 255; raw[o + 2] = 90; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let made: { origin: string; pid: string; clipId: string } | null = null;
async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer, filename?: string): Promise<any> {
  const origin = new URL(page.url()).origin;
  const r = await page.context().request.fetch(`${origin}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': filename ?? 'f.png' } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
async function ensureClip(page: Page): Promise<{ pid: string; clipId: string }> {
  const origin = new URL(page.url()).origin;
  if (made && made.origin === origin) return made;
  const pid = (await api(page, 'POST', '/projects', { name: 'a11y-living', width: 640, height: 360 })).body.project.id as string;
  const up = await api(page, 'POST', `/projects/${pid}/assets`, undefined, syntheticPng(), 'photo.png');
  const tx = await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.body.assetId, start: rt(0), sourceIn: rt(0), duration: rt(150), withLinkedAudio: false } }] });
  made = { origin, pid, clipId: tx.body.results[0].output.clipId as string };
  return made;
}
async function openBlock(ctx: LivingA11yCtx): Promise<{ pid: string; clipId: string }> {
  const { page, lang } = ctx;
  const m = await ensureClip(page);
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/?project=${m.pid}`);
  await page.getByTestId('timecode').waitFor();
  if ((await page.evaluate(() => document.documentElement.lang)) !== lang) await page.locator('[data-testid=lang-toggle]').click().catch(() => {});
  await page.locator(`.clip[data-clip-id="${m.clipId}"]`).click({ position: { x: 4, y: 4 } });
  await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
  const sec = page.getByTestId('section-living');
  await sec.waitFor({ timeout: 8000 });
  if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
  await page.getByTestId('living-block').waitFor({ timeout: 8000 });
  return m;
}
const blockState = (page: Page) => page.getByTestId('living-block').getAttribute('data-state', { timeout: 3000 }).catch(() => null);

export const livingA11yScenarios: LivingA11yScenario[] = [
  {
    id: 'living-block',
    async prepare(ctx) {
      await openBlock(ctx);
      const st = await blockState(ctx.page);
      return { shown: st === 'offer' && (await ctx.page.getByTestId('living-apply').count()) === 1, modal: false, detail: { blockState: st } };
    },
  },
  {
    id: 'living-block-on',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      const r = await api(ctx.page, 'POST', `/projects/${m.pid}/transactions`, { ops: [{ op: 'set_living_picture', args: { clipId: m.clipId, depth: { v: 1, base: { kind: 'ramp', horizon: 450 }, strokes: [] } } }] });
      if (r.status >= 300) return { shown: false, modal: false, detail: { notMade: 'set_living_picture was refused (not built in this build?)', status: r.status } };
      await ctx.page.getByTestId('living-block').and(ctx.page.locator('[data-state=on]')).waitFor({ timeout: 8000 }).catch(() => {});
      const st = await blockState(ctx.page);
      return { shown: st === 'on' && (await ctx.page.getByTestId('living-amount').count()) === 1 && (await ctx.page.getByTestId('living-move-push').getAttribute('role')) === 'radio', modal: false, detail: { blockState: st } };
    },
    async leave(ctx) { if (made) await api(ctx.page, 'POST', `/projects/${made.pid}/transactions`, { ops: [{ op: 'set_living_picture', args: { clipId: made.clipId, remove: true } }] }); },
  },
  {
    id: 'depth-dialog',
    async prepare(ctx) {
      const m = await openBlock(ctx);
      void m;
      const st = await blockState(ctx.page);
      const open = st === 'offer' ? ctx.page.getByTestId('living-apply') : ctx.page.getByTestId('living-depth-open');
      await open.click();
      await ctx.page.getByTestId('depth-dialog').waitFor({ timeout: 8000 }).catch(() => {});
      const shown = (await ctx.page.getByTestId('depth-dialog').count()) === 1 && (await ctx.page.getByTestId('depth-save').count()) === 1;
      return { shown, modal: true, detail: { blockState: st, canvas: await ctx.page.getByTestId('depth-canvas').count() } };
    },
    async leave(ctx) { if ((await ctx.page.getByTestId('depth-dialog').count()) > 0) await ctx.page.keyboard.press('Escape'); },
  },
];
