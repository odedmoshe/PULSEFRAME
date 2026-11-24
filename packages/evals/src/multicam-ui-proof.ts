/**
 * pnpm proof:multicam-ui — multicam in the editor (ADR-0020, W3), headless Chromium in the editor-interactions style, on the
 * multicam fixture (barcode frames: channel 0 = group frame index, channel 1 = angle index; non-periodic speech sound).
 *   U1  12 scripted digit keydowns at known frames during playback: exactly 1 new history entry holding 12 cuts at the painted
 *       frames (+-0, reaction 0); one undo removes all 12;
 *   U2  Player.pause() is called 0 times during the session; the audio tap's onsets in timeline seconds equal those of an
 *       untouched playback of the same program within 1 ms (a restart would shift them by the audio latency);
 *   U3  the angle viewer's pool peaks at <= 4 decoders and the program pool refused 0 pictures (MediaPool.stats);
 *   U4  program paint lateness at the cut frames, median and p95, recorded against the baseline of docs/PROGRESS.md:74
 *       (budget p95 <= 2 frames; a miss is REPORTED, it does not fail the run), with the prefetch stats (warm decoders taken
 *       over at the cuts) and the machine's load average, since one run on a shared machine is one sample;
 *   U5  a digit while paused: +1 history entry, the segment under the playhead shows the angle, one undo restores it;
 *   U6  the preview canvas barcode equals render_frame (the export compositor) at 5 cut frames;
 *   U7  the 409 path: an agent cut_range during a recording, then stop, lands every cut at its group time (0 lost);
 *   U8  an RTL screenshot of the panel and the tile order; a keyboard-only path from the library multi-select to a placed
 *       program; accessible names on the panel's controls and the modal sync dialog. The scripted page audit (unnamed, contrast,
 *       tab order, focus rings in both languages) is a11y-audit.ts (pnpm audit:a11y; axe-core is not installed in this repo).
 * Writes docs/evidence/multicam-ui-proof.json (screenshots in .artifacts/multicam/ui). Exit codes: 0 all checks pass, 1 a check failed, 2 blocked (the multicam
 * fixture, the server routes or core bodies are not built in this checkout, or no browser). Never a pass when blocked.
 *   pnpm build && pnpm proof:multicam-ui
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { BARCODE, readBarcodeChannel } from '@pulseframe/fixtures';
import { groupTimeAt, MULTICAM_OPS_BUILT } from '@pulseframe/core';
import { startServer } from '@pulseframe/server';
import { generateMulticamFixture } from '../../fixtures/src/multicam.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/multicam/ui');
const OUT = path.join(root, 'docs/evidence/multicam-ui-proof.json'); // screenshots stay in .artifacts/multicam/ui
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const checks: { name: string; ok: boolean | null; detail?: unknown }[] = [];
const check = (name: string, ok: boolean | null, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok === null ? ' n/a  ' : ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`); };
const measurements: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const median = (v: number[]) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.floor((s.length - 1) / 2)]!; };
const pct = (v: number[], p: number) => { if (!v.length) return NaN; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!; };
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const decodePng = (png: Buffer) => ({ w: png.readUInt32BE(16), h: png.readUInt32BE(20), rgb: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png) });
const blocked = (why: string): never => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), result: 'BLOCKED', why }, null, 2) + '\n');
  console.error(`multicam-ui-proof: blocked: ${why}`);
  process.exit(2);
};

async function main() {
  if (!MULTICAM_OPS_BUILT) blocked('the multicam operations are not built in this checkout (core MULTICAM_OPS_BUILT is false)');
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) blocked('web bundle missing: run `pnpm build` first');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  let fixture;
  try { fixture = await generateMulticamFixture({ outDir: path.join(art, 'fixture'), seconds: 40, fps: R, narrationPath: path.join(root, 'docs/demo/narration-sample-he.m4a') }); }
  catch (e) { return blocked(`the multicam fixture generator is not available: ${e instanceof Error ? e.message : String(e)}`); }

  const s = await startServer({ port: 8838, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get('content-type') ?? '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed ${r.status}: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => (await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as { assetId: string };
  const doc = async (pid: string) => (await call(`/projects/${pid}`)).body.project as any;
  const historyCount = async (pid: string) => ((await call(`/projects/${pid}/history?since=0`)).body.events as unknown[]).length;
  const waitFor = async (pred: () => Promise<boolean>, ms = 20000) => { const t = Date.now(); for (;;) { if (await pred()) return true; if (Date.now() - t > ms) return false; await sleep(100); } };

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }).catch((e) => blocked(`no browser: ${e}`));
  try {
    // ---- the project: every file of the fixture, one angle per camera or recorder, synced through the REST route, the program placed ----
    const pid = (await call('/projects', { name: 'multicam-ui', width: 640, height: 360 })).body.project.id as string;
    const angleSpecs: { label: string; kind: 'picture' | 'sound'; assetIds: string[] }[] = [];
    for (const a of fixture.angles) angleSpecs.push({ label: a.label.slice(0, 40), kind: a.kind, assetIds: await Promise.all(a.files.map(async (x) => (await upload(pid, x.path)).assetId)) });
    const made = (await txs(pid, [{ op: 'create_multicam', args: { name: 'UI', angles: angleSpecs } }])).results[0].output as { groupId: string; angleIds: string[]; referenceAngleId: string };
    const sync = await call(`/projects/${pid}/multicam/${made.groupId}/sync`, {});
    if (sync.status !== 200) return blocked(`the sync route answered ${sync.status} (${JSON.stringify(sync.body).slice(0, 200)})`);
    const pictureIds = made.angleIds.filter((_, i) => fixture.angles[i]!.kind === 'picture');
    const placed = (await txs(pid, [{ op: 'place_multicam', args: { groupId: made.groupId, at: T.ZERO, angleId: pictureIds[0] } }])).results[0].output as { videoTrackId: string; sequenceId: string };
    const track = placed.videoTrackId;
    const d0 = await doc(pid);
    const seq = d0.mainSequenceId as string;
    const segs = (d: any) => (d.sequences[seq].tracks.find((t: any) => t.id === track).clips as any[]).filter((c) => c.type === 'media').sort((a, b) => T.toSeconds(a.start) - T.toSeconds(b.start));
    const boundaries = (d: any) => { const out: { frame: number; angleId: string }[] = []; let prev: string | null = null; for (const c of segs(d)) { if (prev !== null && c.multicam.angleId !== prev) out.push({ frame: T.frameIndexAt(c.start, R), angleId: c.multicam.angleId }); prev = c.multicam.angleId; } return out; };
    measurements.sync = (sync.body.pieces as any[]).map((p) => ({ angleId: p.angleId, verdict: p.verdict, offsetSeconds: p.offsetSeconds }));
    const initialSegs = segs(d0).length;
    // place_multicam fills stretches the chosen camera does not cover from another synced camera (fill defaults to true), so the
    // placed program can already hold angle changes; the cuts of the session are counted on top of those, which must lie past the cut range
    const initialB = boundaries(d0);
    measurements.initialBoundaries = initialB;

    // ---- the editor ----
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
    await ctx.addInitScript('globalThis.__name = (f) => f'); // tsx/esbuild helper referenced by functions passed to page.evaluate
    await ctx.addInitScript(([id, trackId]) => { (window as any).__pfAudioTap = true; try { localStorage.setItem('pf.lang', 'he'); localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem(`pf.targets.v1.${id}`, JSON.stringify({ video: trackId, audio: null })); } catch { /* storage unavailable */ } }, [pid, track]);
    const page = await ctx.newPage();
    const errors: string[] = [];
    let conflicts = 0;
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('response', (r) => { if (r.status() === 409 && r.url().endsWith('/transactions')) conflicts++; });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('multicam-panel').waitFor({ timeout: 30000 });
    await page.waitForFunction(() => !!(window as any).__pfPlayer && !!(window as any).__pfViewerMedia, undefined, { timeout: 30000 });
    await page.evaluate(() => {
      const w = window as any;
      // measurement hooks only: count pauses of the program player; press digits at painted frames in the same task as the read
      const p = w.__pfPlayer, orig = p.pause.bind(p);
      w.__pauses = 0; p.pause = () => { w.__pauses++; return orig(); };
      w.__press = (list: { frame: number; digit: number }[]) => new Promise((resolve) => {
        const out: { digit: number; painted: number }[] = []; let k = 0;
        const step = () => {
          for (let it = list[k]; it && p.painted >= it.frame; it = list[k]) { const painted = p.painted; document.body.dispatchEvent(new KeyboardEvent('keydown', { code: `Digit${it.digit}`, key: String(it.digit), bubbles: true })); out.push({ digit: it.digit, painted }); k++; }
          if (k >= list.length) resolve(out); else requestAnimationFrame(step);
        };
        step();
      });
    });
    const painted = () => page.evaluate(() => (window as any).__pfPlayer.painted as number);
    const playing = () => page.evaluate(() => (window as any).__pfPlayer.playing as boolean);
    const seekTo = async (n: number) => { await page.evaluate((x) => (window as any).__pfPlayer.seek(x), n); await page.waitForFunction((x) => (window as any).__pfPlayer.painted === x && (document.querySelector('[data-testid=preview]') as HTMLElement | null)?.dataset.quality === 'full', n, { timeout: 15000 }).catch(() => {}); };
    const waitPainted = (n: number) => page.waitForFunction((x) => (window as any).__pfPlayer.painted >= x, n, { timeout: 60000 });
    const pause = async () => { if (await playing()) await page.getByTestId('play').click(); await page.waitForFunction(() => !(window as any).__pfPlayer.playing); };
    const stats = () => page.evaluate(() => (window as any).__pfSync());

    // ---- baseline: the same program played untouched, from 0 to the end of the cut range ----
    const LAST = 560;
    await seekTo(0);
    await page.getByTestId('play').click();
    await waitPainted(LAST);
    await pause();
    const base = await stats();
    measurements.baseline = { clock: base.clock, onsets: base.audioOnsetsTimelineSeconds.length, paintLatenessMs: base.paintLatenessMs };
    const pausesBefore = await page.evaluate(() => (window as any).__pauses as number);

    // ---- U1 / U2 / U3 / U4: 12 digits during playback ----
    const h0 = await historyCount(pid);
    await seekTo(0);
    await page.evaluate(() => { (window as any).__pauses = 0; });
    await page.getByTestId('multicam-record').click();
    const plan = Array.from({ length: 12 }, (_, i) => ({ frame: 60 + i * 40, digit: [2, 3, 1][i % 3]! })); // each differs from the angle before it
    const pressed = (await page.evaluate((l) => (window as any).__press(l), plan)) as { digit: number; painted: number }[];
    await waitPainted(pressed.at(-1)!.painted + 30);
    await page.getByTestId('multicam-record').click(); // stop: ONE switch_angles
    const committed = await waitFor(async () => (await historyCount(pid)) === h0 + 1);
    const pausesDuring = await page.evaluate(() => (window as any).__pauses as number);
    await waitPainted(LAST);
    await pause();
    const sess = await stats();
    const live = await page.getByTestId('multicam-live').textContent();
    const d1 = await doc(pid);
    const bs = boundaries(d1);
    const expectAngle = (digit: number) => pictureIds[digit - 1];
    const fillOutside = initialB.every((b) => b.frame > LAST);
    const want1 = [...pressed.map((x) => ({ frame: x.painted, angleId: expectAngle(x.digit) })), ...initialB];
    const same = fillOutside && bs.length === want1.length && bs.every((b, i) => b.frame === want1[i]!.frame && b.angleId === want1[i]!.angleId);
    check('U1: 12 digit keydowns during playback give exactly 1 new history entry with 12 cuts at the painted frames (+-0, reaction 0)', committed && same && (await historyCount(pid)) === h0 + 1, { newEntries: (await historyCount(pid)) - h0, cutFrames: bs.map((b) => b.frame), paintedFrames: pressed.map((x) => x.painted), placedBoundaries: initialB.map((b) => b.frame), live });
    // every cut landed, so the live report must say 12 saved and must not call any of them unsaved (a stretch already on the angle is not a lost cut)
    check('U1: the live report says 12 cuts were saved and none was lost', !!live && live.includes('12 חתכים נשמרו') && !live.includes('לא נשמרו'), { live });
    measurements.u1 = { pressed, cuts: bs };
    const wantsAudio = sess.clock === 'audio' && base.clock === 'audio';
    const ons = (x: any) => x.audioOnsetsTimelineSeconds as number[];
    const onsetDiff = wantsAudio && ons(base).length === ons(sess).length ? Math.max(0, ...ons(base).map((v, i) => Math.abs(v - ons(sess)[i]!))) : null;
    check('U2: player.pause() is called 0 times during the session', pausesDuring === 0 && pausesBefore >= 0, { pausesDuring });
    check('U2: the audio tap\'s onsets equal those of an untouched playback (no gap > 1 ms)', wantsAudio ? onsetDiff !== null && onsetDiff <= 0.001 : null, wantsAudio ? { maxDiffSeconds: onsetDiff, onsets: ons(sess).length, baselineOnsets: ons(base).length } : { why: `no audio clock in this browser (clock ${sess.clock}): onsets not measured` });
    const viewer = (await page.evaluate(() => (window as any).__pfViewerMedia())) as { peakDecoders: number; maxDecoders: number; refused: number };
    const program = (await page.evaluate(() => (window as any).__pfMedia())) as { peakDecoders: number; refused: number; warm?: { off: string | null; budgetBytes: number; opened: number; reused: number; adopted: number; evicted: number; gaveRoom?: number } };
    check('U3: the viewer pool peaks at <= 4 decoders and the program pool refused 0 pictures', viewer.peakDecoders <= 4 && program.refused === 0, { viewer, program });
    // U4: lateness at the cut frames (the first frame painted at or after each), against the baseline
    const byFrame = new Map<number, number>((sess.paintLatenessByFrameMs as [number, number][]));
    const atCuts = pressed.flatMap((x) => { for (let k = 0; k < 4; k++) { const v = byFrame.get(x.painted + k); if (v !== undefined) return [v]; } return []; });
    const toFrames = (ms: number) => (ms * R.num) / (1000 * R.den);
    const u4 = { cutFramesMeasured: atCuts.length, medianMs: +median(atCuts).toFixed(2), p95Ms: +pct(atCuts, 95).toFixed(2), medianFrames: +toFrames(median(atCuts)).toFixed(2), p95Frames: +toFrames(pct(atCuts, 95)).toFixed(2), allFrames: sess.paintLatenessMs, baselineRun: base.paintLatenessMs, progressMd74: 'median 5-15 ms, p95 about 21-24 ms after the clock reached the frame (one 3.5 s headless run)', budget: 'p95 <= 2 frames', budgetMet: toFrames(pct(atCuts, 95)) <= 2,
      // prefetch (MediaPool.warm, anglePrefetch.ts): the budget it ran in and how many cut pictures took a warm decoder over
      prefetch: program.warm ? { off: program.warm.off, budgetMB: +(program.warm.budgetBytes / (1 << 20)).toFixed(1), opened: program.warm.opened, reused: program.warm.reused, adopted: program.warm.adopted, evicted: program.warm.evicted, gaveRoom: program.warm.gaveRoom ?? null } : 'not built', loadAverage: os.loadavg().map((x) => +x.toFixed(2)) };
    measurements.u4 = { ...u4, prefetchVerdict: u4.budgetMet ? 'budget met in this run' : `budget missed in this run (prefetch ${program.warm ? (program.warm.off ? `off: ${program.warm.off}` : 'on') : 'not built'})` };
    check('U4: program paint lateness at the cut frames recorded against the baseline (a miss is reported, it decides wave-2 prefetch)', atCuts.length > 0, u4);

    // ---- U6: the preview canvas against render_frame at 5 cut frames ----
    const sample = [bs[0]!, bs[1]!, bs[2]!, bs[6]!, bs[10]!]; // digits 2, 3, 1, 2, 3: every picture angle is sampled
    const u6: unknown[] = [];
    let u6ok = true;
    for (const b of sample) {
      await seekTo(b.frame);
      const px = await page.evaluate(() => { const c = document.querySelector('[data-testid=preview]') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, data: Array.from(d) }; });
      const buf = Buffer.from(px.data);
      const rect = (w: number, h: number) => ({ x: 0, y: 0, w, h });
      const pre = [0, 1].map((c) => readBarcodeChannel(buf, px.w, 4, rect(px.w, px.h), c as 0 | 1));
      const png = (await fetch(`${s.url}/api/v1/projects/${pid}/frame?index=${b.frame}`, { headers: h }).then((r) => r.arrayBuffer()).then((a) => Buffer.from(a)));
      const dec = decodePng(png);
      const ren = [0, 1].map((c) => readBarcodeChannel(dec.rgb, dec.w, 3, rect(dec.w, dec.h), c as 0 | 1));
      const ok = pre.join() === ren.join() && pre[1] === made.angleIds.indexOf(b.angleId); // and the barcode names the angle that was cut to
      u6ok = u6ok && ok;
      u6.push({ frame: b.frame, preview: pre, renderFrame: ren, expectedAngleIndex: made.angleIds.indexOf(b.angleId), ok });
    }
    void BARCODE;
    check('U6: the preview canvas barcode equals render_frame at 5 cut frames (every picture angle) and names the angle cut to', u6ok, u6);

    // ---- U1 (undo): one undo removes all 12 ----
    await page.keyboard.press('Control+z');
    const sameB = (x: { frame: number; angleId: string }[]) => x.length === initialB.length && x.every((b, i) => b.frame === initialB[i]!.frame && b.angleId === initialB[i]!.angleId);
    const undone = await waitFor(async () => { const d = await doc(pid); return sameB(boundaries(d)) && segs(d).length === initialSegs; });
    check('U1: one undo removes all 12 cuts', undone, { segmentsBefore: initialSegs, segmentsAfter: segs(await doc(pid)).length, boundariesAfter: boundaries(await doc(pid)).map((b) => b.frame) });

    // ---- U5: a digit while paused ----
    const f5 = 300;
    await seekTo(f5);
    const h5 = await historyCount(pid);
    await page.keyboard.press('Digit2');
    const switched = await waitFor(async () => (await historyCount(pid)) === h5 + 1);
    const under = (d: any) => segs(d).find((c) => T.frameIndexAt(c.start, R) <= f5 && f5 < T.frameIndexAt(T.add(c.start, c.duration), R));
    const afterDigit = under(await doc(pid));
    await page.keyboard.press('Control+z');
    const restored = await waitFor(async () => under(await doc(pid))?.multicam.angleId === pictureIds[0]);
    check('U5: a digit while paused gives +1 history entry, the segment under the playhead shows the angle, and undo restores it', switched && afterDigit?.multicam.angleId === pictureIds[1] && restored, { angleAfter: afterDigit?.multicam.angleId, expected: pictureIds[1] });

    // ---- U7: the 409 path ----
    const dBefore = await doc(pid);
    const h7 = await historyCount(pid);
    await seekTo(0);
    await page.getByTestId('multicam-record').click();
    const plan7 = [90, 130, 170, 210].map((frame, i) => ({ frame, digit: [2, 3, 2, 3][i]! }));
    const pressed7 = (await page.evaluate((l) => (window as any).__press(l), plan7)) as { digit: number; painted: number }[];
    const conflictsBefore = conflicts;
    await txs(pid, [{ op: 'cut_range', args: { start: f(0), end: f(30) } }]); // an agent ripples the first second out while the recording is open
    await waitPainted(pressed7.at(-1)!.painted + 20);
    await page.getByTestId('multicam-record').click();
    const done7 = await waitFor(async () => (await historyCount(pid)) === h7 + 2);
    const d7 = await doc(pid);
    const found = pressed7.map((x) => {
      const want = groupTimeAt(dBefore, seq, track, f(x.painted))!.g; // the group time that was on screen when the key was pressed
      const at = f(x.painted - 30); // the same moment after the first second was cut out
      const got = groupTimeAt(d7, seq, track, at);
      const angle = segs(d7).find((c) => T.eq(c.start, at))?.multicam?.angleId;
      return { frame: x.painted, groupTimeKept: !!got && T.eq(got.g, want), cutAtMoment: angle === expectAngle(x.digit) };
    });
    const lost = found.filter((x) => !x.groupTimeKept || !x.cutAtMoment).length;
    check('U7: an agent cut_range during recording, then stop, lands the cuts at their group times with 0 lost', done7 && lost === 0, { conflictsSeen: conflicts - conflictsBefore, lost, found });
    await pause();

    // ---- U8: RTL screenshot, tile order, names, the sync dialog, the keyboard-only path ----
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('multicam-panel').waitFor({ timeout: 30000 });
    const panel = page.getByTestId('multicam-panel');
    // the Timeline's multicam badge: every program segment on screen carries «n · label» naming its own angle (no other test renders it)
    const dB = await doc(pid);
    const badges = await page.locator('[data-testid=multicam-badge]').evaluateAll((els) => els.map((e) => ({ clipId: (e.closest('[data-clip-id]') as HTMLElement | null)?.dataset.clipId ?? null, angleId: (e as HTMLElement).dataset.angleId ?? null, text: (e.textContent ?? '').trim(), w: e.getBoundingClientRect().width })));
    const progBadges = segs(dB).map((c) => ({ c, b: badges.find((x) => x.clipId === c.id) }));
    const shownSegs = (await page.locator('[data-clip-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.clipId))).filter((id) => segs(dB).some((c) => c.id === id));
    const badgeOk = shownSegs.length > 0 && progBadges.filter((x) => shownSegs.includes(x.c.id)).every(({ c, b }) => !!b && b.w > 0 && b.angleId === c.multicam.angleId && b.text.startsWith(String(pictureIds.indexOf(c.multicam.angleId) + 1)));
    check('U8: the Timeline shows a multicam badge «n · label» on every program segment on screen, naming its own angle', badgeOk, { shownSegments: shownSegs.length, badges: progBadges.filter((x) => shownSegs.includes(x.c.id)).map(({ c, b }) => ({ angle: c.multicam.angleId, badge: b ?? null })).slice(0, 8) });
    await panel.screenshot({ path: path.join(art, 'panel-rtl.png') });
    const tiles = await page.locator('[data-testid=multicam-tile]').evaluateAll((els) => els.map((e) => ({ n: (e as HTMLElement).dataset.tile, x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y, pressed: e.getAttribute('aria-pressed'), keys: e.getAttribute('aria-keyshortcuts') })));
    const dir = await page.evaluate(() => document.documentElement.dir);
    const rtlOk = dir === 'rtl' && tiles.length >= 2 && tiles[0]!.y === tiles[1]!.y ? tiles[0]!.x > tiles[1]!.x : dir === 'rtl' && tiles.length >= 2;
    const unnamed = await panel.locator('button, input, select, [role=spinbutton], [role=meter]').evaluateAll((els) => els.filter((e) => !(e.getAttribute('aria-label') || (e.textContent ?? '').trim() || (e as HTMLInputElement).labels?.length)).map((e) => e.outerHTML.slice(0, 80)));
    const modalOnPanel = (await panel.getAttribute('aria-modal')) !== null;
    // the viewer canvas must read in the same order as the tile buttons: in Hebrew tile 1's angle is the top-right cell, tile 2's the top-left
    // (barcode channel 1 = the angle's index in the group; read on the canvas pixels at the playhead after the reload)
    // at frame 300 every camera has picture (camera 2 starts late in group time); poll the canvas until both top cells show a barcode
    await seekTo(300);
    const readViewer = async () => {
      const vpx = await page.evaluate(() => { const c = document.querySelector('[data-testid=multicam-viewer] canvas') as HTMLCanvasElement; const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; return { w: c.width, h: c.height, data: Array.from(d) }; });
      const vbuf = Buffer.from(vpx.data);
      const cell = (right: boolean) => readBarcodeChannel(vbuf, vpx.w, 4, { x: right ? vpx.w / 2 : 0, y: 0, w: vpx.w / 2, h: vpx.h / 2 }, 1);
      return { topRight: cell(true), topLeft: cell(false) };
    };
    let vr = await readViewer();
    for (const t = Date.now(); (vr.topRight === 0 || vr.topLeft === 0) && Date.now() - t < 15000; vr = await readViewer()) await sleep(200);
    const viewerOrder = { ...vr, atFrame: 300, tile1Angle: made.angleIds.indexOf(pictureIds[0]!), tile2Angle: made.angleIds.indexOf(pictureIds[1]!) };
    check('U8: the angle viewer canvas reads right to left like the tiles (tile 1\'s angle in the top-right cell, tile 2\'s in the top-left)', viewerOrder.topRight === viewerOrder.tile1Angle && viewerOrder.topLeft === viewerOrder.tile2Angle, viewerOrder);
    await page.getByTestId('multicam-sync-open').click();
    await page.getByTestId('multicam-sync-dialog').waitFor({ timeout: 10000 });
    const rows = await page.locator('[data-testid=multicam-sync-row]').count();
    const verdictsInWords = await page.locator('[data-testid=multicam-verdict]').evaluateAll((els) => els.every((e) => (e.textContent ?? '').trim().length > 3));
    const spin = await page.locator('[data-testid=multicam-nudge-frame]').first().evaluate((e) => ({ role: e.getAttribute('role'), now: e.getAttribute('aria-valuenow'), text: e.getAttribute('aria-valuetext') })).catch(() => null);
    const modal = (await page.getByTestId('multicam-sync-dialog').getAttribute('aria-modal')) === 'true' || (await page.getByTestId('multicam-sync-dialog').locator('[aria-modal=true]').count()) > 0;
    await page.screenshot({ path: path.join(art, 'sync-dialog-rtl.png') });
    await page.keyboard.press('Escape');
    check('U8: RTL tile order (tile 1 first in reading order, right-most in the first row), accessible names, a non-modal panel and a modal sync dialog with verdicts in words and spinbuttons with a value text', rtlOk && unnamed.length === 0 && !modalOnPanel && modal && rows > 0 && verdictsInWords && !!spin?.text, { dir, tiles, unnamed, rows, spin });

    // the keyboard-only path from the library multi-select to a placed program, on a fresh project of the same files
    const lib = (await call('/projects', { name: 'multicam-lib', width: 640, height: 360 })).body.project.id as string;
    for (const a of fixture.angles.slice(0, 3)) await upload(lib, a.files[0]!.path);
    await page.goto(`${s.ownerUrl}&project=${lib}`);
    await page.locator('[data-testid^=pick-]').first().waitFor({ timeout: 30000 });
    const boxes = page.locator('[data-testid^=pick-]');
    const nBoxes = await boxes.count();
    for (let i = 0; i < Math.min(nBoxes, 3); i++) { await boxes.nth(i).focus(); await page.keyboard.press('Space'); }
    await page.getByTestId('multicam-sync-and-cut').focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=multicam-review-stop], [data-testid=multicam-entry] [data-state=done], [data-testid=multicam-entry] [data-state=failed]', { timeout: 120000 });
    const reviewed = (await page.getByTestId('multicam-review-stop').count()) > 0;
    if (reviewed) { await page.getByTestId('multicam-review-stop').getByRole('button').nth(1).focus(); await page.keyboard.press('Enter'); await page.waitForSelector('[data-testid=multicam-entry] [data-state=done], [data-testid=multicam-entry] [data-state=failed]', { timeout: 120000 }); }
    const placedLib = (await doc(lib)) as any;
    const programTracks = placedLib.sequences[placedLib.mainSequenceId].tracks.filter((t: any) => t.clips.some((c: any) => c.type === 'media' && c.multicam));
    check('U8: a keyboard-only path from the library multi-select to a placed program', (await page.locator('[data-testid=multicam-entry] [data-state=done]').count()) === 1 && programTracks.length > 0, { reviewStopShown: reviewed, programTracks: programTracks.length });
    check('no page errors during the run', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    await s.close();
  }
  const failed = checks.filter((c) => c.ok === false);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ ranAt: new Date().toISOString(), result: failed.length ? 'FAIL' : 'PASS', checks, measurements, notMeasured: checks.filter((c) => c.ok === null).map((c) => c.name) }, null, 2) + '\n');
  console.log(`multicam-ui-proof: ${failed.length ? `${failed.length} FAILED` : 'passed'}; ${OUT}`);
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
export type { Page };
