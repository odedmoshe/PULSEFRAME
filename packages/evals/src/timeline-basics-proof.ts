/**
 * pnpm proof:timeline-basics — the timeline basics of wave 8D P5, each seen once in a real browser (Chromium, the built editor):
 *  a1 the playhead dragged by its cap (grab area ≥ 24 px; the picture follows; no commit while dragging; over the lanes a click
 *     at the playhead still reaches the clip under it), a2 a press on the ruler jumps and goes on as a drag, a3 snapping to a cut
 *     within 6 px and none with Alt, a4 scrub latency over a 5 s drag (pointer move → painted frame; one sample, no claim beyond
 *     it), b1 I and O on the timeline: flags «התחלה»/«סוף», the tint, a flag dragged, Escape clears; b2 the source viewer keeps
 *     its own I (the timeline's marks unchanged), c1 X cuts the range in ONE commit and one undo restores the document,
 *     c2 a locked track: refused in words, nothing changes, d1 a video clip with sound shows its waveform under the filmstrip
 *     from the import's peaks (one waveform request for the file, shared with its sound clip).
 * Wave 8D integration: b3 the toolbar's range buttons run the range commands and light up with the marks; e1/e2 a clip dragged
 * onto another track of its kind (one move_clip with trackId), refused in words on a locked track or a track of another kind;
 * a5 a 1080p film scrubbed with the draft picture while dragging and the full frame on release (before/after latency).
 * The zoom is read from the timeline (data-pps): a short film is fitted to the ruler when it opens.
 * Fixture: SYNTHETIC, made here by ffmpeg lavfi (testsrc2 640×360 30 fps, 8 s, a keyframe every second as the house fixtures have, with a 440 Hz tone that beeps); deleted with the
 * folder at the next run. The server listens on port 0.
 *   pnpm build && pnpm proof:timeline-basics
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { RANGE_STRINGS } from '../../../apps/web/src/editor/range/range.strings.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/timeline-basics');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const ff = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { maxBuffer: 1 << 26 });
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : NaN; };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const pic = path.join(art, 'pic.mp4');
  ff(['-f', 'lavfi', '-t', '8', '-i', 'testsrc2=s=640x360:r=30', '-f', 'lavfi', '-t', '8', '-i', 'sine=f=440:beep_factor=6:r=48000', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-g', '30', '-bf', '2', '-c:a', 'aac', '-shortest', pic]);
  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (r.headers.get('content-type')?.includes('json') ? await r.json() : null) as any };
  };
  const browser = await chromium.launch();
  try {
    const pid = (await call('/projects', { name: 'timeline basics', width: 640, height: 360 })).body.project.id;
    const up = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'pic.mp4' }, body: fs.readFileSync(pic) })).json() as any;
    const add = await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: up.assetId, start: T.ZERO } }] });
    const { clipId: videoClip, audioClipId } = add.body.results[0].output;
    // a title over 0–100 gives the film a cut inside it, at frame 100 (the clips' end, 240, is past the last frame, 239)
    await call(`/projects/${pid}/transactions`, { ops: [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(100, R) } }] });
    const doc = async () => { const b = (await call(`/projects/${pid}`)).body; return { ...b.project, revision: b.revision as number }; };
    const rev = async () => (await doc()).revision;
    const clips = (d: any) => d.sequences[d.mainSequenceId].tracks.flatMap((t: any) => t.clips);
    const clipOf = (d: any, id: string) => clips(d).find((c: any) => c.id === id);

    const page = await (await browser.newContext({ viewport: { width: 1908, height: 876 } })).newPage();
    await page.addInitScript('globalThis.__name = (f) => f');
    await page.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let posts = 0, waveReqs = 0;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/transactions$/.test(new URL(r.url()).pathname)) posts++;
      if (new URL(r.url()).pathname.endsWith(`/assets/${up.assetId}/derivatives/waveform`)) waveReqs++;
    });
    await page.goto(`${s.ownerUrl}&project=${pid}`);
    await page.getByTestId('ruler').waitFor();
    await page.locator(`.clip[data-clip-id="${videoClip}"] [data-testid=clip-visual][data-drawn]`).first().waitFor({ timeout: 30000 });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid=preview]')?.getAttribute('data-frame') ?? -1) >= 0, undefined, { timeout: 30000 });
    // the zoom the editor opened at: a film under 3 minutes is fitted to the ruler on open (wave 8D WP1), so it is read, not assumed
    const pps = Number(await page.locator('.tl-inner').getAttribute('data-pps'));
    const fr = (px: number) => Math.round((px * 30) / pps); // frames in a horizontal distance at this zoom
    const ruler = (await page.getByTestId('ruler').boundingBox())!;
    const xAt = (frame: number) => ruler.x + (frame / 30) * pps;
    const frameNow = async () => Number(await page.getByTestId('playhead').getAttribute('data-frame'));
    const painted = async () => Number(await page.getByTestId('preview').getAttribute('data-frame'));
    const laneY = async (id: string) => { const b = (await page.locator(`.clip[data-clip-id="${id}"]`).boundingBox())!; return b.y + b.height / 2; };
    const vy = await laneY(videoClip);
    const d0 = await doc();
    void d0;
    const vEnd = 100;

    {
      // the playhead's time label sits on the ruler, whether or not the beat row is drawn (this film has no analysed beat)
      const cap = (await page.locator('.playhead-cap .num').boundingBox())!;
      const onRuler = cap.y >= ruler.y - 1 && cap.y + cap.height <= ruler.y + ruler.height + 1;
      check('a0 with no analysed beat (no beat row) the playhead\'s time label sits on the ruler, not over the first lane', onRuler, { cap: [Math.round(cap.y), Math.round(cap.height)], ruler: [Math.round(ruler.y), Math.round(ruler.height)] });
    }
    console.log('\n# a: dragging the playhead');
    {
      const grab = page.getByTestId('playhead-grab-cap');
      const gb = (await grab.boundingBox())!;
      const gy = gb.y + 8; // on the pulse strip row, above the ruler
      const r0 = await rev(), p0 = posts;
      await page.mouse.move(gb.x + gb.width / 2 + 4, gy); // 4 px beside the line: inside the grab area, no jump
      await page.mouse.down();
      const mid: number[] = [];
      for (let i = 1; i <= 12; i++) { await page.mouse.move(gb.x + gb.width / 2 + 4 + i * 15, gy); await sleep(40); mid.push(await frameNow()); }
      await page.mouse.up();
      await sleep(300);
      const end = await frameNow(), pic = await painted();
      // over the lanes the line takes no press: a click on the clip right under the playhead selects it
      const lx = (await page.getByTestId('playhead').boundingBox())!.x + 1;
      const under = await page.evaluate(([x, y]) => (document.elementFromPoint(x!, y!) as HTMLElement | null)?.closest('.clip')?.getAttribute('data-clip-id') ?? null, [lx, vy]);
      await page.mouse.click(lx, vy);
      await sleep(250);
      const selected = await page.locator(`.clip[data-clip-id="${videoClip}"]`).getAttribute('aria-pressed');
      check(`a1 the playhead drags by its cap: grab area ≥ 24 px; the playhead follows the pointer frame by frame (180 px at ${Math.round(pps)} px/s = ${fr(180)} frames), the picture shows the frame it ends on, no transaction is posted and the revision is unchanged; over the lanes a click at the playhead reaches the clip under it and selects it`,
        gb.width >= 24 && Math.abs(end - fr(180)) <= 1 && new Set(mid).size >= 8 && pic === end && posts === p0 && (await rev()) === r0 && under === videoClip && selected === 'true',
        { pps, grabWidth: gb.width, mid, end, painted: pic, posts: posts - p0, revision: [r0, await rev()], hitAtPlayhead: under, selected });
    }
    {
      const p0 = posts;
      await page.mouse.move(xAt(45), ruler.y + ruler.height / 2);
      await page.mouse.down();
      await sleep(150);
      const jumped = await frameNow();
      await page.mouse.move(xAt(105), ruler.y + ruler.height / 2, { steps: 12 });
      await sleep(100);
      const dragging = await frameNow();
      await page.mouse.up();
      check('a2 a press on the ruler jumps there (frame 45) and goes on as a drag (frame 105) without a release; nothing posted', jumped === 45 && dragging === 105 && posts === p0, { jumped, dragging, posts: posts - p0 });
    }
    {
      const grab = page.getByTestId('playhead-grab-cap');
      const drag = async (toX: number, alt: boolean) => {
        const gb = (await grab.boundingBox())!;
        const cx = gb.x + gb.width / 2, gy = gb.y + 8;
        if (alt) await page.keyboard.down('Alt');
        await page.mouse.move(cx, gy); await page.mouse.down();
        await page.mouse.move(cx + (toX - cx) / 2, gy, { steps: 3 }); await page.mouse.move(toX, gy, { steps: 3 });
        await sleep(100);
        const f = await frameNow();
        await page.mouse.up();
        if (alt) await page.keyboard.up('Alt');
        return f;
      };
      const snapped = await drag(xAt(vEnd) + 5, false);
      await sleep(150);
      const free = await drag(xAt(vEnd) + 5, true);
      check(`a3 near the title's end (frame ${vEnd}) the playhead sticks to it within 6 px; with Alt held it does not (5 px = frame ${vEnd + fr(5)})`, snapped === vEnd && free === vEnd + fr(5) && fr(5) >= 1, { cut: vEnd, snapped, free });
    }
    {
      // a4: a 5 s drag back and forth over the clip; every pointer move recorded with the frame it asked for, every paint timed
      await page.evaluate(() => {
        (globalThis as any).__pfScrubProbe = [];
        const paints: { t: number; frame: number }[] = ((globalThis as any).__pfPaints = []);
        const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
        new MutationObserver(() => { const frame = Number(cv.dataset.frame); requestAnimationFrame(() => paints.push({ t: performance.now(), frame })); }).observe(cv, { attributes: true, attributeFilter: ['data-frame'] });
      });
      const p0 = posts;
      await page.mouse.move(xAt(10), ruler.y + ruler.height / 2);
      await page.mouse.down();
      const t0 = Date.now();
      for (;;) {
        const e = Date.now() - t0;
        if (e > 5000) break;
        const phase = e / 2500, k = phase <= 1 ? phase : 2 - phase;
        await page.mouse.move(xAt(10) + k * 600, ruler.y + ruler.height / 2);
        await sleep(12);
      }
      await page.mouse.up();
      await sleep(600);
      const { moves, paints } = await page.evaluate(() => ({ moves: (globalThis as any).__pfScrubProbe as { t: number; frame: number }[], paints: (globalThis as any).__pfPaints as { t: number; frame: number }[] }));
      // a paint answers the latest move that asked for its frame before it; every earlier unanswered move is answered by it too
      const lat: number[] = [];
      let next = 0, lastK = -1, backwards = 0;
      for (const p of paints) {
        let k = -1;
        for (let j = moves.length - 1; j >= 0; j--) if (moves[j]!.t <= p.t && moves[j]!.frame === p.frame) { k = j; break; }
        if (k < 0) continue;
        if (k < lastK) backwards++;
        lastK = Math.max(lastK, k);
        for (; next <= k; next++) lat.push(p.t - moves[next]!.t);
      }
      const med = median(lat), worst = lat.length ? Math.max(...lat) : NaN;
      const sorted = [...lat].sort((a, b) => a - b), pct = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10;
      const sample = { p90Ms: pct(0.9), firstMs: Math.round((lat[0] ?? NaN) * 10) / 10, moves: moves.length, paints: paints.length, answered: lat.length, medianMs: Math.round(med * 10) / 10, worstMs: Math.round(worst * 10) / 10, paintsGoingBack: backwards, posts: posts - p0 };
      fs.writeFileSync(path.join(art, 'scrub-latency.json'), JSON.stringify({ ...sample, note: 'one sample on this machine (shared CPUs); pointer move timeStamp → the animation frame after the preview canvas reported the frame' }, null, 2));
      check('a4 scrub latency over a 5 s drag (one sample; pointer move → painted frame): every move answered by a paint, no paint of a superseded position after a newer one, nothing posted', lat.length === moves.length && moves.length >= 50 && backwards === 0 && posts === p0, sample);
    }

    console.log('\n# b: range marks');
    const S = RANGE_STRINGS.he;
    const seekTo = async (frame: number) => { await page.mouse.click(xAt(frame), ruler.y + ruler.height / 2); await sleep(150); };
    {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const r0 = await rev();
      await seekTo(30); await page.keyboard.press('KeyI');
      await seekTo(89); await page.keyboard.press('KeyO');
      await sleep(150);
      const flags = { in: await page.getByTestId('range-in').getAttribute('data-frame'), out: await page.getByTestId('range-out').getAttribute('data-frame'), inText: await page.getByTestId('range-in').innerText(), outText: await page.getByTestId('range-out').innerText() };
      const tint = { in: await page.getByTestId('range-tint').getAttribute('data-in'), out: await page.getByTestId('range-tint').getAttribute('data-out') };
      const tb = (await page.getByTestId('range-tint').boundingBox())!;
      const lanes = await page.locator('.track').evaluateAll((els) => els.map((e) => { const b = e.getBoundingClientRect(); return [b.top, b.bottom]; }));
      const covers = lanes.every(([t, b]) => tb.y <= t! + 1 && tb.y + tb.height >= b! - 1);
      // drag the end flag 45 px later (15 frames) with Alt (no snapping)
      const ob = (await page.getByTestId('range-out').boundingBox())!;
      await page.keyboard.down('Alt');
      await page.mouse.move(ob.x + ob.width - 3, ob.y + ob.height / 2); await page.mouse.down(); await page.mouse.move(ob.x + ob.width - 3 + 45, ob.y + ob.height / 2, { steps: 5 }); await page.mouse.up();
      await page.keyboard.up('Alt');
      await sleep(150);
      const dragged = await page.getByTestId('range-out').getAttribute('data-frame');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
      await sleep(150);
      const cleared = await page.locator('[data-testid^=range-]').count();
      check(`b1 I at frame 30 and O on frame 89 put «התחלה» at 30 and «סוף» at 90 on the ruler, the tint covers [30, 90) on every lane, the end flag drags (+45 px = ${90 + fr(45)}), Escape clears them; no revision`,
        flags.in === '30' && flags.out === '90' && flags.inText === S.in && flags.outText === S.out && tint.in === '30' && tint.out === '90' && covers && dragged === String(90 + fr(45)) && cleared === 0 && (await rev()) === r0,
        { flags, tint, tintCoversLanes: covers, dragged, afterEscape: cleared });
    }
    {
      // b3: the toolbar's range buttons (WP1) run the range commands (P5) and follow the marks as they change
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const dis = async (id: string) => (await page.getByTestId(id).getAttribute('aria-disabled')) === 'true';
      const before = { in: await dis('tl-range-in'), out: await dis('tl-range-out'), cut: await dis('tl-range-cut') };
      await seekTo(40); await page.getByTestId('tl-range-in').click();
      await seekTo(70); await page.getByTestId('tl-range-out').click();
      await sleep(150);
      const flags = { in: await page.getByTestId('range-in').getAttribute('data-frame'), out: await page.getByTestId('range-out').getAttribute('data-frame') };
      const cutLit = !(await dis('tl-range-cut'));
      // marks set by the KEYS light the cut button too (the marks are outside the editor's store)
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape'); await sleep(100);
      const cutDark = await dis('tl-range-cut');
      await seekTo(40); await page.keyboard.press('KeyI'); await seekTo(70); await page.keyboard.press('KeyO');
      await sleep(150);
      const cutLitByKeys = !(await dis('tl-range-cut'));
      const tip = await page.getByTestId('tl-range-cut').evaluate((el) => el.closest('[data-tooltip], .pf-tip-host')?.textContent ?? null).catch(() => null);
      check('b3 the toolbar\'s «תחילת טווח» and «סוף טווח» buttons set the marks (40, 71); «חיתוך טווח» is dark without both marks and lights up once they are set, by the buttons or by I and O',
        !before.in && !before.out && before.cut && flags.in === '40' && flags.out === '71' && cutLit && cutDark && cutLitByKeys, { before, flags, cutLit, cutDarkAfterEscape: cutDark, cutLitByKeys, tip });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
    }
    {
      await seekTo(20); await page.keyboard.press('KeyI');
      await page.getByTestId('rail-media').click().catch(() => {});
      await page.getByTestId(`more-${up.assetId}`).click();
      await page.getByTestId(`view-${up.assetId}`).click();
      await page.getByTestId('source-viewer').waitFor({ timeout: 15000 });
      await sleep(400);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      await page.keyboard.press('KeyI');
      await sleep(200);
      const srcIn = await page.getByTestId('source-range').getAttribute('data-in');
      const tl = await page.getByTestId('range-in').getAttribute('data-frame');
      const outFlags = await page.getByTestId('range-out').count();
      await page.getByTestId('source-close').click();
      await sleep(200);
      check('b2 in the source viewer I marks the source range (its own in at frame 3) and leaves the timeline\'s marks as they were (start 20, no end)', srcIn === '3' && tl === '20' && outFlags === 0, { sourceIn: srcIn, timelineIn: tl, timelineOutFlags: outFlags });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.keyboard.press('Escape');
    }

    console.log('\n# c: range cut');
    {
      const before = await doc();
      const r0 = before.revision, p0 = posts;
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await seekTo(30); await page.keyboard.press('KeyI');
      await seekTo(89); await page.keyboard.press('KeyO');
      await page.keyboard.press('KeyX');
      let after = before;
      for (let i = 0; i < 50 && after.revision === r0; i++) { await sleep(100); after = await doc(); }
      const len = (d: any, id: string) => T.frameIndexAt(clipOf(d, id)?.duration ?? T.ZERO, R);
      const total = (d: any) => Math.max(...clips(d).map((c: any) => T.frameIndexAt(T.add(c.start, c.duration), R)));
      const hist = (await call(`/projects/${pid}/history?limit=3`)).body;
      // the marks go when the editor's commit returns (after the server's answer reaches the page): waited for, and the wait recorded
      const tGone = Date.now();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid^=range-]').length === 0, undefined, { timeout: 5000 }).catch(() => {});
      const flagsGone = await page.locator('[data-testid^=range-]').count(), flagsGoneMs = Date.now() - tGone;
      const head = await frameNow();
      const cutOk = after.revision === r0 + 1 && posts - p0 === 1 && total(before) - total(after) === 60 && flagsGone === 0 && head === 30;
      await page.keyboard.press('Control+KeyZ');
      let undone = after;
      for (let i = 0; i < 50 && undone.revision === after.revision; i++) { await sleep(100); undone = await doc(); }
      const same = JSON.stringify(undone.sequences) === JSON.stringify(before.sequences);
      check('c1 X cuts [30, 90) from every track in ONE commit (one POST, revision +1, the film 60 frames shorter, the marks gone, the playhead at 30); one Ctrl+Z gives back exactly the sequences of before',
        cutOk && same, { revisions: [r0, after.revision, undone.revision], posts: posts - p0, length: [total(before), total(after)], clipLengths: [len(before, videoClip), len(after, videoClip)], flagsGone, flagsGoneMs, head, undoExact: same, history: Array.isArray(hist?.entries) ? hist.entries.slice(0, 2).map((e: any) => e.label ?? e.summary) : undefined });
    }
    {
      const audioTrack = (await doc()).sequences[(await doc()).mainSequenceId].tracks.find((t: any) => t.clips.some((c: any) => c.id === audioClipId));
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: audioTrack.id, locked: true } }] });
      await sleep(500);
      const r0 = await rev(), p0 = posts;
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await seekTo(30); await page.keyboard.press('KeyI');
      await seekTo(59); await page.keyboard.press('KeyO');
      await page.keyboard.press('KeyX');
      await sleep(600);
      const toast = await page.getByTestId('toasts').first().innerText().catch(() => '');
      const said = toast.includes(S.locked(audioTrack.name).split(':')[0]!) && toast.includes('בטלו את הנעילה');
      check('c2 with a locked track X refuses in words (why and what to do), posts nothing and the revision is unchanged; the marks stay', said && posts === p0 && (await rev()) === r0 && (await page.getByTestId('range-in').count()) === 1,
        { toast: toast.slice(0, 160), posts: posts - p0 });
      await page.screenshot({ path: path.join(art, 'timeline-basics.png') }); // the marks, the tint and the waveform under the filmstrip
      await page.keyboard.press('Escape');
    }

    console.log('\n# d: the sound of a video clip under its filmstrip');
    {
      const wave = page.locator(`.clip[data-clip-id="${videoClip}"] [data-testid=clip-own-sound] [data-testid=clip-visual][data-kind=audio]`);
      await wave.first().waitFor({ timeout: 15000 });
      await page.waitForFunction((id) => !!document.querySelector(`.clip[data-clip-id="${id}"] [data-testid=clip-own-sound] [data-drawn]`), videoClip, { timeout: 15000 });
      const band = (await page.locator(`.clip[data-clip-id="${videoClip}"] [data-testid=clip-own-sound]`).boundingBox())!;
      const clip = (await page.locator(`.clip[data-clip-id="${videoClip}"]`).boundingBox())!;
      const lane = (await page.locator(`.clip[data-clip-id="${videoClip}"]`).evaluate((el) => (el.closest('.track') as HTMLElement).getBoundingClientRect().height));
      const lit = await page.locator(`.clip[data-clip-id="${videoClip}"] [data-testid=clip-own-sound] canvas`).evaluate((c: HTMLCanvasElement) => { const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++; return n / (c.width * c.height); });
      check('d1 the video clip (lane ≥ 56 px) shows its waveform in a band at the bottom of the clip, drawn from the import\'s peaks: the waveform of the file was asked for once, shared with its sound clip',
        lane >= 56 && Math.abs(band.y + band.height - (clip.y + clip.height)) <= 1 && band.height < clip.height / 2 + 1 && lit > 0.02 && waveReqs === 1,
        { laneHeight: lane, band: { top: Math.round(band.y - clip.y), height: band.height }, clipHeight: clip.height, inkedShare: Math.round(lit * 1000) / 1000, waveformRequests: waveReqs });
    }
    console.log('\n# e: a clip dragged onto another track of its kind');
    {
      const d1 = await doc();
      const seq = (d: any) => d.sequences[d.mainSequenceId];
      const audioTrack = seq(d1).tracks.find((t: any) => t.clips.some((c: any) => c.id === audioClipId));
      const v1 = seq(d1).tracks.find((t: any) => t.clips.some((c: any) => c.id === videoClip));
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: audioTrack.id, locked: false } }, { op: 'add_track', args: { kind: 'video' } }] });
      let d2 = await doc();
      for (let i = 0; i < 30 && seq(d2).tracks.length === seq(d1).tracks.length; i++) { await sleep(100); d2 = await doc(); }
      const v2 = seq(d2).tracks.find((t: any) => t.kind === 'video' && t.id !== v1.id && !seq(d1).tracks.some((o: any) => o.id === t.id));
      await page.locator(`.track[data-track-id="${v2.id}"]`).waitFor();
      await sleep(400);
      const lane = async (id: string) => (await page.locator(`.track[data-track-id="${id}"] .track-lane`).boundingBox())!;
      const cb = (await page.locator(`.clip[data-clip-id="${videoClip}"]`).boundingBox())!;
      const r0 = (await doc()).revision, p0 = posts;
      const sx = cb.x + cb.width / 2, sy = cb.y + cb.height / 2;
      await page.mouse.move(sx, sy); await page.mouse.down();
      const l2 = await lane(v2.id);
      await page.mouse.move(sx, (sy + l2.y + l2.height / 2) / 2, { steps: 3 });
      await page.mouse.move(sx, l2.y + l2.height / 2, { steps: 3 });
      await sleep(150);
      const ghostOn = await page.getByTestId('clip-ghost').getAttribute('data-track-id').catch(() => null);
      await page.mouse.up();
      let d3 = await doc();
      for (let i = 0; i < 50 && d3.revision === r0; i++) { await sleep(100); d3 = await doc(); }
      const onV2 = seq(d3).tracks.find((t: any) => t.id === v2.id).clips.map((c: any) => c.id);
      const sameStart = T.eq(clipOf(d3, videoClip).start, clipOf(d1, videoClip).start);
      const audioStays = seq(d3).tracks.find((t: any) => t.id === audioTrack.id).clips.some((c: any) => c.id === audioClipId);
      check('e1 a video clip dragged straight up onto V2 (a video track): the ghost is on V2 while dragging; ONE transaction (revision +1, one POST) puts it on V2 at the same start; its sound stays on its sound track',
        ghostOn === v2.id && d3.revision === r0 + 1 && posts - p0 === 1 && onV2.includes(videoClip) && sameStart && audioStays, { ghostOn, v2: v2.id, revisions: [r0, d3.revision], posts: posts - p0, onV2, sameStart, audioStays });
      // refusals: V1 locked, and a title dragged onto a video lane
      await call(`/projects/${pid}/transactions`, { ops: [{ op: 'update_track', args: { trackId: v1.id, locked: true } }] });
      await sleep(500);
      const tryDrag = async (clipId: string, toTrack: string) => {
        const b = (await page.locator(`.clip[data-clip-id="${clipId}"]`).boundingBox())!;
        const x = b.x + Math.min(b.width / 2, 60), y = b.y + b.height / 2;
        await page.mouse.move(x, y); await page.mouse.down();
        const l = await lane(toTrack);
        await page.mouse.move(x, (y + l.y + l.height / 2) / 2, { steps: 3 });
        await page.mouse.move(x, l.y + l.height / 2, { steps: 3 });
        await sleep(150);
        const words = await page.getByTestId('clip-ghost-refusal').innerText().catch(() => '');
        const ghostTrack = await page.getByTestId('clip-ghost').getAttribute('data-track-id').catch(() => null);
        await page.mouse.up();
        await sleep(500);
        return { words, ghostTrack };
      };
      const r1 = (await doc()).revision, p1 = posts;
      const locked = await tryDrag(videoClip, v1.id);
      const titleId = clips(await doc()).find((c: any) => c.type === 'text').id;
      const kind = await tryDrag(titleId, v2.id);
      const toast = await page.getByTestId('toasts').first().innerText().catch(() => '');
      check('e2 onto a locked track and onto a track of another kind the ghost says why in words (the locked track named and what to do; «קליפ טקסט נכנס רק לרצועת טקסט…»), the release posts nothing and the revision is unchanged',
        /נעולה/.test(locked.words) && /בטלו את הנעילה/.test(locked.words) && locked.ghostTrack === v1.id && /טקסט/.test(kind.words) && /גררו/.test(kind.words) && posts === p1 && (await rev()) === r1,
        { locked, kind, toast: toast.slice(0, 160), posts: posts - p1 });
      await page.screenshot({ path: path.join(art, 'track-move.png') });
    }

    console.log('\n# a5: scrubbing a 1080p film: the drag draws the draft picture, the release the full one');
    {
      const big = path.join(art, 'big.mp4');
      ff(['-f', 'lavfi', '-t', '6', '-i', 'testsrc2=s=1920x1080:r=30', '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-g', '30', '-bf', '2', big]);
      const bid = (await call('/projects', { name: 'scrub 1080p', width: 1920, height: 1080 })).body.project.id;
      const bu = await (await fetch(`${s.url}/api/v1/projects/${bid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'big.mp4' }, body: fs.readFileSync(big) })).json() as any;
      await call(`/projects/${bid}/transactions`, { ops: [{ op: 'add_clip', args: { assetId: bu.assetId, start: T.ZERO } }] });
      const pg = await (await browser.newContext({ viewport: { width: 1908, height: 876 } })).newPage();
      await pg.addInitScript('globalThis.__name = (f) => f');
      // __pfAudioTap exposes the player as __pfPlayer (measurement only, player.ts); nothing plays here, so no sound is tapped
      await pg.addInitScript(() => { try { localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } (globalThis as any).__pfAudioTap = true; });
      pg.on('pageerror', (e) => errors.push(String(e)));
      await pg.goto(`${s.ownerUrl}&project=${bid}`);
      await pg.getByTestId('ruler').waitFor();
      await pg.waitForFunction(() => Number(document.querySelector('[data-testid=preview]')?.getAttribute('data-frame') ?? -1) >= 0, undefined, { timeout: 30000 });
      await sleep(1500);
      const bpps = Number(await pg.locator('.tl-inner').getAttribute('data-pps'));
      const br = (await pg.getByTestId('ruler').boundingBox())!;
      const bx = (f: number) => br.x + (f / 30) * bpps;
      const drag = async (label: string) => {
        await pg.evaluate(() => {
          (globalThis as any).__pfScrubProbe = [];
          const paints: { t: number; frame: number; q: string }[] = ((globalThis as any).__pfPaints = []);
          const cv = document.querySelector('[data-testid=preview]') as HTMLCanvasElement;
          (globalThis as any).__pfObs?.disconnect();
          (globalThis as any).__pfObs = new MutationObserver(() => { const frame = Number(cv.dataset.frame), q = cv.dataset.quality ?? ''; requestAnimationFrame(() => paints.push({ t: performance.now(), frame, q })); });
          (globalThis as any).__pfObs.observe(cv, { attributes: true, attributeFilter: ['data-frame', 'data-quality'] });
        });
        await pg.mouse.move(bx(10), br.y + br.height / 2); await pg.mouse.down();
        const t0 = Date.now();
        for (;;) { const e = Date.now() - t0; if (e > 5000) break; const ph = e / 2500, k = ph <= 1 ? ph : 2 - ph; await pg.mouse.move(bx(10) + k * Math.min(600, bpps * 4.5), br.y + br.height / 2); await sleep(12); }
        await pg.mouse.up();
        await sleep(1500);
        const { moves, paints } = await pg.evaluate(() => ({ moves: (globalThis as any).__pfScrubProbe as { t: number; frame: number }[], paints: (globalThis as any).__pfPaints as { t: number; frame: number; q: string }[] }));
        const lat: number[] = []; let next = 0;
        for (const p of paints) { let k = -1; for (let j = moves.length - 1; j >= 0; j--) if (moves[j]!.t <= p.t && moves[j]!.frame === p.frame) { k = j; break; } if (k < 0) continue; for (; next <= k; next++) lat.push(p.t - moves[next]!.t); }
        const q = (x: number) => { const so = [...lat].sort((a, b) => a - b); return so.length ? Math.round(so[Math.min(so.length - 1, Math.floor(x * so.length))]! * 10) / 10 : NaN; };
        const endFrame = Number(await pg.getByTestId('playhead').getAttribute('data-frame'));
        const cv = await pg.getByTestId('preview').evaluate((c: HTMLCanvasElement) => ({ frame: Number(c.dataset.frame), quality: c.dataset.quality, w: c.width, h: c.height }));
        const during = [...new Set(paints.slice(0, -1).map((p) => p.q))];
        return { label, moves: moves.length, answered: lat.length, medianMs: q(0.5), p90Ms: q(0.9), worstMs: lat.length ? Math.round(Math.max(...lat) * 10) / 10 : NaN, qualitiesWhileDragging: during, released: cv, endFrame };
      };
      // the same fixture, the same drag: first as before this change (the player told nothing: full quality while paused), then as now
      await pg.evaluate(() => { const p = (globalThis as any).__pfPlayer; (globalThis as any).__pfScrubKeep = p.setScrubbing; p.setScrubbing = () => {}; });
      const before = await drag('full while dragging (before)');
      await pg.evaluate(() => { const p = (globalThis as any).__pfPlayer; p.setScrubbing = (globalThis as any).__pfScrubKeep; });
      const after = await drag('draft while dragging (after)');
      fs.writeFileSync(path.join(art, 'scrub-1080.json'), JSON.stringify({ pps: bpps, before, after, note: 'one sample each on this machine (shared CPUs)' }, null, 2));
      check('a5 a 1080p film scrubbed for 5 s: while dragging the frames are drawn as draft (the playing picture), and the frame the release stands on is drawn again FULL at 1920×1080, the playhead\'s frame (the paused picture = the still); before/after latency recorded (one sample each)',
        after.qualitiesWhileDragging.includes('draft') && after.released.quality === 'full' && after.released.w === 1920 && after.released.h === 1080 && after.released.frame === after.endFrame && before.qualitiesWhileDragging.every((x) => x === 'full'),
        { before, after });
      await pg.close();
    }
    check('no page errors', errors.length === 0, errors.slice(0, 3));
  } finally {
    await browser.close();
    await s.close?.();
  }
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  fs.writeFileSync(path.join(art, 'result.json'), JSON.stringify(checks, null, 2));
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
