/**
 * «תמונה חיה» proof checks 14, 15, 16 and 18 (wave 8 living track, in the editor; numbering as living-proof.ts LIVING_CHECKS).
 * `runLivingUi(ctx)` drives the real editor page with the keyboard and reads the document back from the server; it never decides
 * for the caller: each check returns {id, ok, detail}, and `blocked` names a reason when the editor cannot take the step
 * (e.g. set_living_picture not built). Fixtures: the synthetic PNG of a11y-living.ts. Nothing here says how anything looks.
 * 14 needs a page whose browser has no WebGPU: the caller passes it as `ctx.noGpuPage` (the still's refusal with PF_RENDER_GPU=off is the
 * entry point's). 15, 16 and 18 read the server's history and document: one transaction per Save, and an undo that restores the
 * sequences exactly (JSON with sorted keys).
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
const doc = async (page: Page, pid: string) => (await api(page, 'GET', `/projects/${pid}`)).body.project;
/** JSON with sorted keys: two documents are the same when this is (key order is not meaning). */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
const clipOf = (d: any, clipId: string) => { for (const sq of Object.values<any>(d?.sequences ?? {})) for (const t of sq.tracks) for (const c of t.clips) if (c.id === clipId) return c; return null; };
const lastRevision = async (page: Page, pid: string) => { const ev = (await history(page, pid)).events as { revision: number }[]; return ev.length ? ev[ev.length - 1]!.revision : 0; };
const txSince = async (page: Page, pid: string, rev: number) => ((await api(page, 'GET', `/projects/${pid}/history?since=${rev}`)).body.events as { ops: string[]; kind?: string; undoes?: string | null }[]);
/** The editor's undo from the keyboard (Ctrl+Z, focus on the page body), then wait for the server's document to change. */
async function undo(page: Page, pid: string): Promise<void> {
  const rev = await lastRevision(page, pid);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+z');
  for (let i = 0; i < 100 && (await lastRevision(page, pid)) === rev; i++) await page.waitForTimeout(100);
}
/** The preview canvas as RGB once it holds still (two reads 300 ms apart equal), at most ~10 s. */
async function stablePreview(page: Page): Promise<Buffer> {
  const read = async () => Buffer.from(await page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; const o: number[] = []; for (let i = 0; i < d.length; i += 4) o.push(d[i]!, d[i + 1]!, d[i + 2]!); return o; }));
  let a = await read();
  for (let i = 0; i < 33; i++) { await page.waitForTimeout(300); const b = await read(); if (b.equals(a)) return b; a = b; }
  return a;
}
/** What the page and the server show when the block did not turn on after «שמירה» (a failure, with what is known). */
async function notOn(page: Page, pid: string, since: number): Promise<Record<string, unknown>> {
  return { notOnAfter30s: true, blockState: await page.getByTestId('living-block').getAttribute('data-state').catch(() => null), dialogOpen: await page.getByTestId('depth-dialog').count(),
    saveDisabled: await page.getByTestId('depth-save').isDisabled({ timeout: 1000 }).catch(() => null), refusal: await page.getByTestId('living-refusal').textContent({ timeout: 1000 }).catch(() => null),
    transactionsSince: (await txSince(page, pid, since)).map((t) => t.ops) };
}
async function seek(page: Page, frame: number): Promise<boolean> {
  const rb = (await page.getByTestId('ruler').boundingBox())!;
  await page.mouse.click(rb.x + frame * 3 + 0.5, rb.y + rb.height / 2); // 90 px/s = 3 px a frame at 30 fps (keyframes-proof.ts)
  return page.waitForFunction((f0) => document.querySelector('[data-testid=playhead]')?.getAttribute('data-frame') === String(f0), frame, { timeout: 5000 }).then(() => true, () => false);
}

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
  const before = await doc(page, pid);
  const r0 = await lastRevision(page, pid);
  const apply = page.getByTestId('living-apply');
  await apply.focus(); await page.keyboard.press('Enter');
  await page.getByTestId('depth-dialog').waitFor({ timeout: 8000 });
  const startRamp = await page.getByTestId('depth-canvas').getAttribute('aria-valuenow');
  await page.waitForFunction(() => !(document.querySelector('[data-testid=depth-save]') as HTMLButtonElement | null)?.disabled, null, { timeout: 15_000 }).catch(() => {});
  await page.getByTestId('depth-save').focus(); await page.keyboard.press('Enter');
  const done = await page.waitForFunction(() => !!document.querySelector('[data-testid=living-block][data-state=on]'), null, { timeout: 30_000 }).then(() => true, () => false);
  if (!done) return { id: 15, ok: false, detail: { ramp: startRamp, ...(await notOn(page, pid, r0)) } };
  const blockVisible = await page.getByTestId('living-block').isVisible().catch(() => null);
  const applied = await txSince(page, pid, r0);
  const afterApply = await doc(page, pid);
  const r1 = await lastRevision(page, pid);
  // arrow to «גלישה הצידה» (the radio group moves and selects with the arrow keys)
  await page.getByTestId('living-move-push').focus();
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('[data-testid=living-move-slide]')?.getAttribute('aria-checked') === 'true', null, { timeout: 8000 }).catch(() => {});
  const slide = await page.getByTestId('living-move-slide').getAttribute('aria-checked');
  for (let i = 0; i < 50 && (await lastRevision(page, pid)) === r1; i++) await page.waitForTimeout(100);
  const afterSlide = await doc(page, pid);
  // the preview at frames 0 and 89
  const seeks = [await seek(page, 0)]; const p0 = await stablePreview(page);
  seeks.push(await seek(page, 89)); const p89 = await stablePreview(page);
  // any byte: the preview is drawn deterministically, and on this smooth 64×36 gradient a slide at amount 0.5 changes a pixel by at most
  // about 2 of 255 (the largest relative shift is 2.7 px at 0.4 levels a pixel), so a tolerance would hide the move itself
  let differing = 0; for (let i = 0; i < p0.length; i++) if (p0[i] !== p89[i]) differing++;
  // one Ctrl+Z undoes the move change exactly; a second undoes the living picture with its depth exactly (one step)
  await undo(page, pid);
  const undo1 = await doc(page, pid);
  await undo(page, pid);
  const undo2 = await doc(page, pid);
  const fx = clipOf(afterApply, clipId)?.effects?.find((e: any) => e.type === 'depth.living');
  const ok = startRamp === '450' && applied.length === 1 && canon(applied[0]!.ops) === canon(['set_living_picture']) && !!clipOf(afterApply, clipId)?.depth && !!fx
    && slide === 'true' && clipOf(afterSlide, clipId)?.effects?.find((e: any) => e.type === 'depth.living')?.params?.move === 'slide' && seeks.every(Boolean) && differing > 0
    && canon(undo1.sequences) === canon(afterApply.sequences) && canon(undo2.sequences) === canon(before.sequences);
  return { id: 15, ok, detail: { blockVisible, rampHorizon: startRamp, transactionsOnSave: applied.map((t) => t.ops), depthStored: !!clipOf(afterApply, clipId)?.depth, slideChecked: slide, previewBytesDifferingFrame0vs89: differing, seeked: seeks,
    firstUndoEqualsAfterSave: canon(undo1.sequences) === canon(afterApply.sequences), secondUndoEqualsBefore: canon(undo2.sequences) === canon(before.sequences) } };
}

export async function check16(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const { page } = ctx;
  const { pid, clipId } = await project(page);
  const made = await api(page, 'POST', `/projects/${pid}/transactions`, { ops: [{ op: 'set_living_picture', args: { clipId, depth: { v: 1, base: { kind: 'ramp', horizon: 450 }, strokes: [] } } }] });
  if (made.status !== 200) return { id: 16, ok: false, blocked: 'set_living_picture was refused (not built?)', detail: { status: made.status } };
  await open(page, pid, clipId);
  const r0 = await lastRevision(page, pid);
  await page.getByTestId('living-depth-open').click();
  const canvas = page.getByTestId('depth-canvas');
  await canvas.waitFor({ timeout: 8000 });
  await canvas.focus(); await page.keyboard.press('ArrowDown');
  const h = await canvas.getAttribute('aria-valuenow');
  await page.getByTestId('depth-tool-near').click();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 10, { steps: 4 }); await page.mouse.up();
  await page.getByTestId('depth-save').click();
  await page.getByTestId('depth-dialog').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 50 && (await lastRevision(page, pid)) === r0; i++) await page.waitForTimeout(100);
  const saved = await txSince(page, pid, r0);
  const depth = clipOf(await doc(page, pid), clipId)?.depth;
  // a second open closed with Escape: nothing is saved and focus returns to «ציירו עומק»
  const r1 = await lastRevision(page, pid);
  await page.getByTestId('living-depth-open').click();
  await page.getByTestId('depth-dialog').waitFor({ timeout: 8000 });
  await page.keyboard.press('Escape');
  await page.getByTestId('depth-dialog').waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  await page.waitForTimeout(500);
  const afterEscape = await txSince(page, pid, r1);
  const ok = h === '460' && saved.length === 1 && canon(saved[0]!.ops) === canon(['set_clip_depth']) && depth?.base?.horizon === 460 && depth?.strokes?.length === 1 && depth.strokes[0].layer === 'near'
    && afterEscape.length === 0 && focused === 'living-depth-open';
  return { id: 16, ok, detail: { horizonAfterKey: h, transactionsOnSave: saved.map((t) => t.ops), storedHorizon: depth?.base?.horizon, storedStrokes: depth?.strokes?.map((x: any) => [x.layer, x.pts.length]), transactionsAfterEscape: afterEscape.length, focusAfterEscape: focused } };
}

export async function check18(ctx: LivingUiCtx): Promise<LivingUiResult> {
  const { page } = ctx;
  const { pid, clipId } = await project(page, true);
  const before = await doc(page, pid);
  const kbKeys = Object.keys(clipOf(before, clipId)?.keyframes ?? {}).filter((k) => /^(scale|x|y|rotation)$/.test(k));
  await open(page, pid, clipId);
  const r0 = await lastRevision(page, pid);
  await page.getByTestId('living-apply').click();
  await page.getByTestId('depth-save').click();
  const done = await page.waitForFunction(() => !!document.querySelector('[data-testid=living-block][data-state=on]'), null, { timeout: 30_000 }).then(() => true, () => false);
  if (!done) return { id: 18, ok: false, detail: await notOn(page, pid, r0) };
  const line = await page.getByText(/התנועה הקודמת הוחלפה|previous move was replaced/).count();
  const applied = await txSince(page, pid, r0);
  const after = await doc(page, pid);
  const leftKeys = Object.keys(clipOf(after, clipId)?.keyframes ?? {}).filter((k) => kbKeys.includes(k) && (clipOf(after, clipId).keyframes[k]?.length ?? 0) > 0);
  await undo(page, pid);
  const back = await doc(page, pid);
  const ok = kbKeys.length > 0 && line > 0 && applied.length === 1 && leftKeys.length === 0 && !!clipOf(after, clipId)?.effects?.some((e: any) => e.type === 'depth.living') && canon(back.sequences) === canon(before.sequences);
  return { id: 18, ok, detail: { kenBurnsKeys: kbKeys, replacedLine: line, transactions: applied.map((t) => t.ops), moveKeysLeft: leftKeys, oneUndoRestoresBoth: canon(back.sequences) === canon(before.sequences) } };
}

export async function runLivingUi(ctx: LivingUiCtx): Promise<LivingUiResult[]> {
  const out: LivingUiResult[] = [];
  for (const f of [check14, check15, check16, check18]) out.push(await f(ctx).catch((e) => ({ id: Number(f.name.slice(5)), ok: false, blocked: `the step threw: ${(e as Error).message}`, detail: {} })));
  return out;
}
