/**
 * Captions that show the transcript, in the real editor (owner report 2026-11-26: a transcript in «תמלול», a look picked in
 * «כתוביות», and nothing on the picture or on the caption lane). A 1080×1920 project at 30 fps in the Hebrew UI, one synthetic
 * clip with its own sound (made at test time), a Hebrew transcript with word timing set through the product's own op
 * (set_transcript; no speech engine is needed). Two orders:
 *   A  the caption track is added BEFORE any transcript exists (it is then a manual track with no cues), the transcript
 *      arrives, a look is picked;
 *   B  the transcript first, then «הוספת רצועת כתוביות», then a look.
 * For each: the caption layer in the evaluated frame at a time inside a phrase, whether it is drawn (the preview canvas and one
 * render_frame against the same frame before any caption track existed), and what the caption lane shows. Then the repair
 * button of order A («הצגת התמלול ככתוביות»: one commit, one undo, the look kept) and the one-press button of the «תמלול» tab.
 *
 *   pnpm build && pnpm proof:captions-source
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { evaluate, type CaptionLayer } from '@pulseframe/engine';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';
import { setWorkspace } from './editor-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/captions-source-proof');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const W = 1080, H = 1920;
const FRAME = 45; // 1.5 s: inside the first phrase (0..4 s), on its second word
const LOOK = 'caption.outline-only'; // Rubik, white with a black outline, no plate: unlike the default style, so a kept look can be seen
const WORDS = ['שלום', 'לכולם', 'זה', 'הטיול', 'שלנו', 'לים', 'המלח', 'היום'];
const word = (k: number) => ({ text: WORDS[k]!, start: T.rt(k * 1000, 1000), duration: T.rt(700, 1000) });
const SEGMENTS = [
  { start: T.rt(0, 1), duration: T.rt(4, 1), text: WORDS.slice(0, 4).join(' '), words: [0, 1, 2, 3].map(word) },
  { start: T.rt(4, 1), duration: T.rt(4, 1), text: WORDS.slice(4).join(' '), words: [4, 5, 6, 7].map(word) },
];
const rgb = (png: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: png, maxBuffer: 1 << 30 });
const diffPixels = (a: Buffer, b: Buffer) => { let n = 0; for (let i = 0; i < Math.min(a.length, b.length); i += 3) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 24) n++; return n; };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'clip.mp4'), frames: 240 });
  const s = await startServer({ port: Number(process.env.PF_CAPSRC_PORT ?? 8947), dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project;
  const renderFrame = async (pid: string) => rgb((await call(`/projects/${pid}/frame?index=${FRAME}`)).body);
  const captionTracks = (d: any) => d.sequences[d.mainSequenceId].tracks.filter((t: any) => t.kind === 'caption');
  const layerAt = (d: any) => evaluate(d, f(FRAME)).layers.find((l) => l.kind === 'caption') as CaptionLayer | undefined;
  const newProject = async (name: string, withTranscript: boolean) => {
    const pid = (await call('/projects', { name, width: W, height: H, frameRate: R })).body.project.id as string;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'clip.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const placed = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }] });
    if (withTranscript) await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId: up.assetId, language: 'he', segments: SEGMENTS } }] });
    return { pid, assetId: up.assetId as string, clipId: placed.body.results[0].output.clipId as string };
  };
  const browser = await chromium.launch();
  const errors: string[] = [];
  const open = async (pid: string): Promise<Page> => {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, reducedMotion: 'reduce' })).newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.locator('.clip').first().waitFor();
    return page;
  };
  /** The playhead to FRAME through «מעבר לזמן», then the painted frame. */
  const seek = async (page: Page) => {
    await page.getByTestId('timecode').click();
    await page.getByTestId('craft-time-input').fill('00:00:01:15');
    await page.getByTestId('craft-time-input').press('Enter');
    await page.waitForFunction((n) => document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') === String(n), FRAME, { timeout: 15_000 });
  };
  /** Keeps the preview's pixels in the page, to compare later frames against. */
  const keepPreview = (page: Page) => page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!; (window as any).__capBase = { w: c.width, h: c.height, d: c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.slice() }; });
  /** Pixels of the preview that differ from the kept ones, and their box as fractions of the frame. Polled for a few seconds WITHOUT moving the playhead. */
  const previewDiff = async (page: Page, wantChange: boolean) => {
    let last: { changed: number; box: number[] | null } = { changed: 0, box: null };
    for (let i = 0; i < 20; i++) {
      last = await page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!; const b = (window as any).__capBase;
        if (c.width !== b.w || c.height !== b.h) return { changed: -1, box: null };
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0, x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
        for (let k = 0; k < d.length; k += 4) if (Math.abs(d[k]! - b.d[k]) + Math.abs(d[k + 1]! - b.d[k + 1]) + Math.abs(d[k + 2]! - b.d[k + 2]) > 24) { n++; const p = k / 4, x = p % c.width, y = Math.floor(p / c.width); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        return { changed: n, box: n ? [x0 / c.width, y0 / c.height, (x1 + 1) / c.width, (y1 + 1) / c.height].map((v) => Number(v.toFixed(3))) : null };
      });
      if ((last.changed > 0) === wantChange) break;
      await sleep(250);
    }
    return last;
  };
  const lane = async (page: Page, trackId: string) => ({
    autoCues: await page.locator(`.track[data-track-id="${trackId}"] [data-testid=cue-auto]`).count(),
    cueClips: await page.locator(`.track[data-track-id="${trackId}"] .clip`).count(),
    texts: await page.locator(`.track[data-track-id="${trackId}"] [data-testid=cue-auto]`).evaluateAll((els) => els.map((e) => e.textContent ?? '')),
  });
  const pickLook = async (page: Page, pid: string) => {
    const offered = await page.locator('[data-testid=caption-look] [data-value]').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')));
    if (!offered.includes(LOOK)) throw new Error(`look ${LOOK} is not offered; offered: ${offered.slice(0, 12).join(', ')}`);
    await page.locator(`[data-testid=caption-look] [data-value="${LOOK}"]`).click();
    await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/projects/${id}`)).json()).project.sequences.seq_main.tracks.some((t: any) => t.kind === 'caption' && t.caption?.style.fontFamily === 'Rubik' && t.caption?.style.background === null), pid, { timeout: 10_000 });
  };
  const measure = async (page: Page, pid: string, base: Buffer) => {
    const d = await doc(pid);
    const tr = captionTracks(d)[0];
    const layer = layerAt(d);
    const preview = await previewDiff(page, true);
    const still = diffPixels(await renderFrame(pid), base);
    return { mode: tr?.caption?.mode, linked: tr?.caption?.linkedTrackId ?? null, cues: tr?.clips.length, layerWords: layer?.words.map((w) => w.text).join(' ') ?? null, previewChanged: preview.changed, previewBox: preview.box, renderFrameChanged: still, lane: tr ? await lane(page, tr.id) : null, trackId: tr?.id as string | undefined };
  };

  const report: Record<string, unknown> = {};
  try {
    console.log('\n# order A: caption track before the transcript');
    {
      const { pid, assetId } = await newProject('order A', false);
      const base = await renderFrame(pid);
      const page = await open(pid);
      await setWorkspace(page, 'captions');
      await seek(page);
      await keepPreview(page);
      await page.locator('button[role=tab][data-testid="inspector-tab-captions"]').click();
      await page.getByTestId('caption-add').click();
      await page.getByTestId('caption-look').waitFor();
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'set_transcript', args: { assetId, language: 'he', segments: SEGMENTS } }] });
      await page.waitForFunction(async (id) => Object.keys((await (await fetch(`/api/v1/projects/${id}`)).json()).project.transcripts).length === 1, pid);
      await pickLook(page, pid);
      const a = await measure(page, pid, base);
      report.orderA = a;
      check('A (before the repair): the track made before the transcript is a manual track with no cues; nothing is in the evaluated frame, nothing is drawn, the lane is empty', a.mode === 'manual' && a.cues === 0 && a.layerWords === null && a.previewChanged === 0 && a.renderFrameChanged === 0 && a.lane?.autoCues === 0, a);
      // the repair
      const notice = page.getByTestId('caption-unlinked');
      const shown = await notice.waitFor({ timeout: 5000 }).then(() => true, () => false);
      const noticeText = shown ? (await notice.textContent()) ?? '' : '';
      check('A: the «כתוביות» tab says the caption track is not connected to the transcript and offers ONE primary button', shown && /התמלול/.test(noticeText) && (await page.getByTestId('caption-show-transcript').count()) === 1, { noticeText });
      const revOf = async () => (await call(`/projects/${pid}`)).body.revision as number;
      const revBefore = await revOf();
      if (shown) await page.getByTestId('caption-show-transcript').click();
      await page.waitForFunction(async ([id, rev]) => (await (await fetch(`/api/v1/projects/${id}`)).json()).revision > rev, [pid, revBefore] as const, { timeout: 10_000 }).catch(() => {});
      const d1 = await doc(pid);
      const revAfter = await revOf();
      const t1 = captionTracks(d1);
      const fixedA = await measure(page, pid, base);
      report.orderAFixed = { ...fixedA, revisions: revAfter - revBefore, tracks: t1.length, name: t1[0]?.name, look: t1[0]?.caption?.style.fontFamily };
      check('A: one press, one commit: one caption track, transcript mode, the same name and the look kept; the caption is in the frame and drawn in the preview (without moving the playhead) and in render_frame; the lane shows the phrase', revAfter === revBefore + 1 && t1.length === 1 && t1[0].caption.mode === 'transcript' && t1[0].name === 'C1' && t1[0].caption.style.background === null && t1[0].caption.style.fontFamily === 'Rubik' && fixedA.layerWords === 'שלום לכולם זה הטיול' && fixedA.previewChanged > 0 && fixedA.renderFrameChanged > 0 && (fixedA.lane?.autoCues ?? 0) >= 2, report.orderAFixed);
      const src = await page.getByTestId('caption-source').textContent({ timeout: 5000 }).catch(() => null);
      check('A: the «כתוביות» tab says where the captions come from («מקור: התמלול»)', /מקור: התמלול/.test(src ?? ''), { src });
      await page.keyboard.press('Control+z');
      await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/projects/${id}`)).json()).project.sequences.seq_main.tracks.some((t: any) => t.caption?.mode === 'manual'), pid, { timeout: 10_000 }).catch(() => {});
      const d2 = await doc(pid);
      check('A: one undo brings back the manual track as it was', captionTracks(d2).length === 1 && captionTracks(d2)[0].caption.mode === 'manual' && captionTracks(d2)[0].caption.style.fontFamily === 'Rubik', { tracks: captionTracks(d2).map((t: any) => t.caption.mode) });
      await page.screenshot({ path: path.join(art, 'order-a.png') });
      await page.close();
    }

    console.log('\n# order B: transcript first, then «הוספת רצועת כתוביות»');
    {
      const { pid } = await newProject('order B', true);
      const base = await renderFrame(pid);
      const page = await open(pid);
      await setWorkspace(page, 'captions');
      await seek(page);
      await keepPreview(page);
      await page.locator('button[role=tab][data-testid="inspector-tab-captions"]').click();
      await page.getByTestId('caption-add').click();
      await page.getByTestId('caption-look').waitFor();
      const added = await measure(page, pid, base);
      report.orderBAdded = added;
      check('B: after «הוספת רצועת כתוביות» (default look) the caption is in the frame and drawn in the preview without moving the playhead', added.mode === 'transcript' && added.layerWords === 'שלום לכולם זה הטיול' && added.previewChanged > 0 && added.renderFrameChanged > 0, added);
      await keepPreview(page);
      await pickLook(page, pid);
      const b = await measure(page, pid, base);
      report.orderB = b;
      const box = b.previewBox;
      check('B: after the look the caption is in the frame, drawn inside the portrait frame (box within 0..1, not zero-sized) and in render_frame', b.mode === 'transcript' && b.layerWords === 'שלום לכולם זה הטיול' && b.renderFrameChanged > 0 && !!box && box[0]! >= 0 && box[2]! <= 1 && box[1]! >= 0 && box[3]! <= 1 && box[2]! > box[0]! && box[3]! > box[1]!, b);
      check('B: the caption lane of a transcript track with no linked track shows the phrases (it was empty before)', (b.lane?.autoCues ?? 0) >= 2 && b.lane!.texts.some((x) => x.includes('שלום')), b.lane);
      const src = await page.getByTestId('caption-source').textContent({ timeout: 5000 }).catch(() => null);
      check('B: the tab says «מקור: התמלול»', /מקור: התמלול/.test(src ?? ''), { src });
      await page.screenshot({ path: path.join(art, 'order-b.png') });
      await page.close();
    }

    console.log('\n# the «תמלול» tab: one press shows the transcript as captions');
    {
      const { pid, clipId } = await newProject('speech tab', true);
      const base = await renderFrame(pid);
      const page = await open(pid);
      await setWorkspace(page, 'captions');
      await seek(page);
      await keepPreview(page);
      await page.locator(`.clip[data-clip-id="${clipId}"]`).click();
      await page.locator('button[role=tab][data-testid="inspector-tab-speech"]').click();
      await page.locator('[data-testid=transcript-panel][data-state=ready]').waitFor();
      const btn = page.getByTestId('transcript-show-captions');
      const has = (await btn.count()) === 1;
      const label = has ? (await btn.textContent()) ?? '' : '';
      if (has) await btn.click();
      await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/projects/${id}`)).json()).project.sequences.seq_main.tracks.some((t: any) => t.caption?.mode === 'transcript'), pid, { timeout: 10_000 }).catch(() => {});
      const frame = Number(await page.locator('canvas[data-testid=preview]').getAttribute('data-frame'));
      const m = await measure(page, pid, base);
      report.speechTab = { label, frame, ...m };
      check('«תמלול» tab: «הצגה ככתוביות על הסרטון» is offered while no caption track shows the transcript; one press puts the caption on the picture at the playhead', has && /הצגה ככתוביות על הסרטון/.test(label) && frame === FRAME && m.mode === 'transcript' && m.layerWords === 'שלום לכולם זה הטיול' && m.previewChanged > 0, report.speechTab);
      check('«תמלול» tab: the button is gone once the captions show the transcript', has && (await page.getByTestId('transcript-show-captions').count()) === 0);
      await page.close();
    }
    check('no uncaught page errors', errors.length === 0, errors.slice(0, 3));
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((c) => !c.ok);
    const out = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, load: os.loadavg().map((x) => Number(x.toFixed(1))) }, scope: 'Synthetic clip and a typed Hebrew transcript with word timing; Chromium on Linux. Not the owner\'s project or Windows.', report, checks };
    fs.writeFileSync(path.join(art, 'report.json'), JSON.stringify(out, null, 2) + '\n');
    console.log(`\n${out.result}: ${checks.length - failed.length}/${checks.length} checks. Evidence: .artifacts/captions-source-proof/report.json`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
