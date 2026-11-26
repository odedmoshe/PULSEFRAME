/**
 * «תמונה חיה» proof checks 14, 15, 16 and 18 (wave 8 living track, in the editor; numbering as living-proof.ts LIVING_CHECKS).
 * `runLivingUi(ctx)` drives the real editor page with the keyboard and reads the document back from the server; it never decides
 * for the caller: each check returns {id, ok, detail}, and `blocked` names a reason when the editor cannot take the step
 * (e.g. set_living_picture not built). Fixtures: the synthetic PNG of a11y-living.ts. Nothing here says how anything looks.
 * 14 needs a page whose browser has no GPU (PF_RENDER_GPU=off): the caller passes it as `ctx.noGpuPage`.
 */
import type { Page } from 'playwright';
import { syntheticPng } from './a11y-living.ts';

export interface LivingUiCtx { page: Page; noGpuPage?: Page }
export interface LivingUiResult { id: number; ok: boolean; blocked?: string; detail: Record<string, unknown> }

const rt = (n: number) => ({ value: String(n), timescale: 30 });
const origin = (p: Page) => new URL(p.url()).origin;
async function api(page: Page, method: 'GET' | 'POST', p: string, body?: unknown, raw?: Buffer): Promise<any> {
  const r = await page.context().request.fetch(`${origin(page)}/api/v1${p}`, { method, ...(raw ? { data: raw, headers: { 'x-filename': 'photo.png' } } : body !== undefined ? { data: body, headers: { 'content-type': 'application/json' } } : {}) });
  const text = await r.text();
  try { return { status: r.status(), body: JSON.parse(text) }; } catch { return { status: r.status(), body: text }; }
}
async function project(page: Page, kenBurns = false): Promise<{ pid: string; clipId: string }> {
  const pid = (await api(page, 'POST', '/projects', { name: 'living-ui', width: 640, height: 360 })).body.project.id as string;
  const asset = await api(page, 'POST', `/projects/${pid}/assets`, undefined, syntheticPng());
  const ops: unknown[] = [{ op: 'add_clip', args: { assetId: asset.body.assetId, start: rt(0), sourceIn: rt(0), duration: rt(150), withLinkedAudio: false } }];
  const tx = await api(page, 'POST', `/projects/${pid}/transactions`, { ops });
  const clipId = tx.body.results[0].output.clipId as string;
  if (kenBurns) await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'apply_motion_preset', args: { clipId, presetId: 'motion.move.ken-burns-in' } }] });
  return { pid, clipId };
}
async function open(page: Page, pid: string, clipId: string): Promise<void> {
  await page.goto(`${origin(page)}/?project=${pid}`);
  await page.getByTestId('timecode').waitFor();
  await page.locator(`.clip[data-clip-id="${clipId}"]`).click({ position: { x: 4, y: 4 } });
  await page.getByTestId('insp-tab-motion').click({ timeout: 8000 }).catch(() => {});
  const sec = page.getByTestId('section-living');
  await sec.waitFor({ timeout: 8000 });
  if ((await sec.getAttribute('data-open')) !== 'true') await sec.locator('.pf-section-toggle').click();
  await page.getByTestId('living-block').waitFor({ timeout: 8000 });
}
const history = async (page: Page, pid: string) => (await api(page, 'GET', `/projects/${pid}/history`)).body;
const doc = async (page: Page, pid: string) => (await api(page, 'GET', `/projects/${pid}`)).body;

export async function check14(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const page = ctx.noGpuPage;
  if (!page) return { id: 14, ok: false, blocked: 'no page without a GPU (PF_RENDER_GPU=off) was given', detail: {} };
  const { pid, clipId } = await project(page);
  await open(page, pid, clipId);
  const note = await page.getByTestId('living-gpu-note').count();
  return { id: 14, ok: note === 1, detail: { gpuNote: note, still: 'the still refusal is read by the server half of the proof' } };
}

export async function check15(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const { page } = ctx;
  const { pid, clipId } = await project(page);
  await open(page, pid, clipId);
  const before = JSON.stringify((await doc(page, pid)).sequences ?? null);
  const apply = page.getByTestId('living-apply');
  await apply.focus(); await page.keyboard.press('Enter');
  await page.getByTestId('depth-dialog').waitFor({ timeout: 8000 });
  const startRamp = await page.getByTestId('depth-canvas').getAttribute('aria-valuenow');
  const h0 = (await history(page, pid)) as unknown;
  await page.getByTestId('depth-save').click();
  const done = await page.getByTestId('living-block').and(page.locator('[data-state=on]')).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (!done) return { id: 15, ok: false, blocked: 'set_living_picture did not commit (not built, or refused)', detail: { ramp: startRamp, refusal: await page.getByTestId('living-refusal').textContent().catch(() => null) } };
  const h1 = JSON.stringify(await history(page, pid));
  await page.getByTestId('living-move-slide').focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid=living-move-slide]')?.getAttribute('aria-checked') === 'true', null, { timeout: 8000 }).catch(() => {});
  const slide = await page.getByTestId('living-move-slide').getAttribute('aria-checked');
  void h0; void h1;
  return { id: 15, ok: startRamp === '450' && slide === 'true', detail: { rampHorizon: startRamp, slideChecked: slide, before: before.length, note: 'frames 0 vs 89 and the one-undo entity diff are read by the caller from render_frame and /undo' } };
}

export async function check16(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const { page } = ctx;
  const { pid, clipId } = await project(page);
  await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'set_clip_depth', args: { clipId, depth: { v: 1, base: { kind: 'ramp', horizon: 450 }, strokes: [] } } }] });
  await open(page, pid, clipId);
  // the block is "offer" (no living picture): «ציירו עומק» exists only when on, so open through the apply button
  await page.getByTestId('living-apply').click();
  const canvas = page.getByTestId('depth-canvas');
  await canvas.waitFor({ timeout: 8000 });
  await canvas.focus(); await page.keyboard.press('ArrowDown');
  const h = await canvas.getAttribute('aria-valuenow');
  await page.getByTestId('depth-tool-near').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10); await page.mouse.up();
  const strokes = await page.locator('[data-testid=depth-dialog] .living-row bdi').first().textContent();
  await page.keyboard.press('Escape');
  await page.getByTestId('depth-dialog').waitFor({ state: 'detached', timeout: 5000 });
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  const saved = (await doc(page, pid)).sequences;
  return { id: 16, ok: h === '460' && /^1\//.test(strokes ?? '') && focused === 'living-apply', detail: { horizonAfterKey: h, strokeCounter: strokes, focusAfterEscape: focused, savedByEscape: JSON.stringify(saved).includes('"strokes":[{'), note: 'the Save path (exactly one set_clip_depth) needs a block that is on; read after W1 merges. Escape returns focus to the opener (living-apply here, living-depth-open when the block is on)' } };
}

export async function check18(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const { page } = ctx;
  const { pid, clipId } = await project(page, true);
  await open(page, pid, clipId);
  await page.getByTestId('living-apply').click();
  await page.getByTestId('depth-save').click();
  const done = await page.getByTestId('living-block').and(page.locator('[data-state=on]')).waitFor({ timeout: 10_000 }).then(() => true, () => false);
  if (!done) return { id: 18, ok: false, blocked: 'set_living_picture did not commit (not built, or refused)', detail: {} };
  const line = await page.getByText(/התנועה הקודמת הוחלפה|previous move was replaced/).count();
  return { id: 18, ok: line > 0, detail: { replacedLine: line, note: 'one undo bringing both back is read by the caller (entity diff)' } };
}

export async function runLivingUi(ctx: LivingUiCtx): Promise<LivingUiResult[]> {
  const out: LivingUiResult[] = [];
  for (const f of [check14, check15, check16, check18]) out.push(await f(ctx).catch((e) => ({ id: Number(f.name.slice(5)), ok: false, blocked: `the step threw: ${(e as Error).message}`, detail: {} })));
  return out;
}
