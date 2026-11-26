/**
 * proof:tripmap, the drawing part (wave 8 tripmap W2): checks 2–4, 6, 7, 9–11, 13, 16–19 of TRIPMAP_CHECKS (tripmap-proof.ts), on
 * stills and exports of the pinned Chromium render page through a real server (`startServer({ port: 0 })`). The integrator imports
 * runTripmapDraw() into tripmap-proof.ts; it never exits the process itself.
 *
 * Predictions are made in Node with the SAME pure functions the painter uses (core cameraAt / progressAt / legPath, engine
 * map/labels.ts and map/route.ts), so a check compares the pixels Chromium drew with where the shared code says they go, within a
 * stated tolerance. Fixtures are synthetic (stops typed as coordinates, no media); everything is made in a temp directory and
 * deleted. Nobody has looked at any picture: every check is a measurement, none says how a map looks.
 * Blocked, not failed: when the web bundle is missing, or the server answers add_trip_map with map_not_built (core W1 not in).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import * as T from '@pulseframe/time';
import { cameraAt, MAP_LABEL_FADE_SECONDS, MAP_LOOK_COLOURS, mapFrames, MAX_PAN_RATE, MAX_ZOOM_RATE, progressAt, type MapLook, type MapPayload, type MapSize } from '@pulseframe/core';
import { mapLabelLayout, labelBoxAt, labelFont, stopPoints, toPixels } from '@pulseframe/engine/map/labels.ts';
import { routeOf, routePointAt } from '@pulseframe/engine/map/route.ts';
import { decodeQuanta } from '@pulseframe/engine/map/outlines.ts';
import { MAP_SIZES } from '@pulseframe/engine/map/paintMap.ts';
import OUTLINES from '@pulseframe/engine/map/outlines.data.ts';
import { startServer, type RunningServer } from '@pulseframe/server';

export interface DrawCheck { id: number; name: string; ok: boolean; blocked?: string; detail?: unknown }
export interface DrawResult { checks: DrawCheck[]; measurements: Record<string, unknown> }

const root = path.resolve(import.meta.dirname, '../../..');
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 31, ...(input ? { input } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Img { w: number; h: number; rgb: Buffer }
const pngToRgb = (png: Buffer, w: number, h: number): Img => { const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png); if (rgb.length !== w * h * 3) throw new Error(`still is not ${w}x${h}`); return { w, h, rgb }; };
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
const isCol = (im: Img, x: number, y: number, c: readonly number[], tol: number) => { if (x < 0 || y < 0 || x >= im.w || y >= im.h) return false; const i = (y * im.w + x) * 3; return Math.abs(im.rgb[i]! - c[0]!) <= tol && Math.abs(im.rgb[i + 1]! - c[1]!) <= tol && Math.abs(im.rgb[i + 2]! - c[2]!) <= tol; };
/** Any pixel of colour c within r px (square) of (x, y). */
const near = (im: Img, x: number, y: number, c: readonly number[], r: number, tol = 10) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (isCol(im, Math.round(x) + dx, Math.round(y) + dy, c, tol)) return true; return false; };
const r2 = (v: number) => Math.round(v * 100) / 100;
/** PF_TRIPMAP_SHOTS=<dir>: keep some stills there for a person to look at (nothing is kept otherwise). */
const keepShot = (name: string, png: Buffer) => { const dir = process.env.PF_TRIPMAP_SHOTS; if (dir) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), png); } };

const stop = (id: string, name: string, lon: number, lat: number, at: number, via?: 'road' | 'flight' | 'boat', hidden?: true) => ({ id, name, lon: Math.round(lon * 100) * 10_000, lat: Math.round(lat * 100) * 10_000, at, ...(via ? { via } : {}), ...(hidden ? { hidden } : {}) });

export async function runTripmapDraw(): Promise<DrawResult> {
  const checks: DrawCheck[] = [];
  const measurements: Record<string, unknown> = {};
  const check = (id: number, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${id}. ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`); };
  const MINE = [2, 3, 4, 6, 7, 9, 10, 11, 13, 16, 17, 18, 19];
  const blockRest = (why: string) => { for (const id of MINE) if (!checks.some((c) => c.id === id)) checks.push({ id, name: `check ${id}`, ok: false, blocked: why }); console.log(`  blocked: ${why}`); };
  const webDist = path.join(root, 'apps/web/dist');
  if (!fs.existsSync(path.join(webDist, 'render.html'))) { blockRest('web bundle missing: run `pnpm build` first'); return { checks, measurements }; }
  const art = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tripmap-draw-'));

  // ---------------------------------------------------------------- 16: the bundle and the notices (no server needed)
  const assets = fs.readdirSync(path.join(webDist, 'assets'));
  const chunkName = assets.find((f) => /^outlines\.data.*\.js$/.test(f));
  {
    const text = chunkName ? fs.readFileSync(path.join(webDist, 'assets', chunkName), 'utf8') : '';
    const notices = fs.existsSync(path.join(webDist, 'THIRD_PARTY_NOTICES.txt')) ? fs.readFileSync(path.join(webDist, 'THIRD_PARTY_NOTICES.txt'), 'utf8') : '';
    const levels = OUTLINES.levels.map((l) => ({ id: l.id, keys: Object.keys(l).sort() }));
    const onlyLandLakes = levels.every((l) => l.keys.join() === (l.id === 'detail' ? 'box,id,lakes,land,q,use' : 'id,lakes,land,q,use'));
    check(16, 'the web bundle holds the outline chunk (a separate file); the bundle\'s THIRD_PARTY_NOTICES.txt holds the Natural Earth block; the map data has only land and lakes levels (no border of any kind)',
      !!chunkName && text.includes('f1890d9f152c896d250a77557a5751a93d494776') && !/admin|countries|boundar/i.test(text) && /Natural Earth/.test(notices) && onlyLandLakes,
      { chunk: chunkName ?? null, chunkBytes: text.length, notices: /Natural Earth/.test(notices), levels });
  }

  let s: RunningServer | null = null, s2: RunningServer | null = null;
  const browser = await chromium.launch();
  try {
    s = await startServer({ port: 0, dataDir: path.join(art, 'data'), renderCacheBytes: 0 });
    const srv = s;
    const auth = { authorization: `Bearer ${srv.auth.tokens.agent}`, connection: 'close' };
    const callOn = async (base: string, p: string, body?: unknown) => {
      const r = await fetch(`${base}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
    };
    const call = (p: string, body?: unknown) => callOn(srv.url, p, body);
    const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw Object.assign(new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`), { body: r.body }); return r.body; };
    const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(200); } };
    interface Proj { name: string; pid: string; clipId: string; w: number; h: number; rate: T.Rate; payload: MapPayload; start: number }
    const mapProject = async (name: string, stops: unknown[], o: { w?: number; h?: number; fps?: number; look?: MapLook; start?: number; frames?: number } = {}): Promise<Proj> => {
      const w = o.w ?? 1280, h = o.h ?? 720, rate = { num: o.fps ?? 30, den: 1 }, start = o.start ?? 0;
      const pid = (await call('/projects', { name, width: w, height: h, frameRate: rate })).body.project.id as string;
      const res = await tx(pid, [{ op: 'add_trip_map', args: { start: T.frameTime(start, rate), duration: T.frameTime(o.frames ?? 180, rate), stops, look: o.look ?? 'paper' } }]);
      const clipId = res.results[0].output.clipId as string;
      return { name, pid, clipId, w, h, rate, start, payload: await payloadOf(pid, clipId) };
    };
    const payloadOf = async (pid: string, clipId: string): Promise<MapPayload> => {
      const doc = (await call(`/projects/${pid}`)).body.project;
      for (const seq of Object.values(doc.sequences) as any[]) for (const tr of seq.tracks) for (const c of tr.clips) if (c.id === clipId) return c.drawn as MapPayload;
      throw new Error(`clip ${clipId} not found`);
    };
    const stillOn = async (base: string, p: { pid: string; w: number; h: number }, index: number) => {
      const r = await callOn(base, `/projects/${p.pid}/frame?index=${index}`);
      if (r.status !== 200) throw Object.assign(new Error(`still ${index}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`), { status: r.status, body: r.body });
      return { png: r.body as Buffer, img: pngToRgb(r.body, p.w, p.h) };
    };
    const still = async (p: Proj, index: number) => { const r = await stillOn(srv.url, p, index); if (!/^tripmap-(order|time)/.test(p.name)) keepShot(`${p.name}-f${index}.png`, r.png); return r; };
    const size = (p: Proj): MapSize => ({ width: p.w, height: p.h });
    const predict = (p: Proj, localFrame: number, pt: { x: number; y: number }) => toPixels(pt, cameraAt(p.payload, localFrame, size(p)), size(p));

    // the fixture of checks 2, 3, 6, 7: Tel Aviv → Jerusalem → Eilat by road, legs of 1.5 s
    let israel: Proj;
    try {
      israel = await mapProject('tripmap-israel', [stop('a', 'תל אביב', 34.78, 32.08, 30), stop('b', 'ירושלים', 35.21, 31.77, 75), stop('c', 'אילת', 34.95, 29.56, 120)]);
    } catch (e: any) {
      const reason = e?.body?.error?.details?.reason ?? e?.body?.details?.reason ?? '';
      if (/map_not_built/.test(JSON.stringify(e?.body ?? '')) || reason === 'map_not_built') { blockRest('add_trip_map answers map_not_built: the core map functions (W1) are not in this build'); return { checks, measurements }; }
      throw e;
    }
    const colours = MAP_LOOK_COLOURS.paper, route = routeOf(israel.payload);

    // ---------------------------------------------------------------- 2: the marker at each arrival
    {
      const marker = hex(colours.marker), rows: unknown[] = [];
      let ok = true;
      for (let i = 1; i < israel.payload.stops.length; i++) {
        const at = israel.payload.stops[i]!.at, want = predict(israel, at, route.stops[i]!);
        const { img } = await still(israel, israel.start + at);
        let sx = 0, sy = 0, n = 0;
        for (let y = Math.floor(want.y) - 12; y <= Math.floor(want.y) + 12; y++) for (let x = Math.floor(want.x) - 12; x <= Math.floor(want.x) + 12; x++) if (isCol(img, x, y, marker, 3)) { sx += x + 0.5; sy += y + 0.5; n++; }
        const got = n ? { x: sx / n, y: sy / n } : null, off = got ? Math.hypot(got.x - want.x, got.y - want.y) : Infinity;
        rows.push({ stop: i, frame: at, want: { x: r2(want.x), y: r2(want.y) }, got: got && { x: r2(got.x), y: r2(got.y) }, pixels: n, offPx: r2(off) });
        ok &&= n >= 20 && off <= 1.5;
      }
      check(2, 'at each arrival frame the marker\'s centroid (its look colour, ±3 per channel, in a 24-px window) is within 1.5 px of the position Node predicts with cameraAt + mercator', ok, rows);
    }

    // ---------------------------------------------------------------- 3: the route drawn up to the marker, not after it
    {
      // its own fixture (integration): the Israel fixture's first leg is about 70 px long at 1280×720, so after the marker and dot
      // clearances only 3 of the 10 sampled points remained on each side; Tel Aviv → Eilat by road spans most of the frame height
      const israel = await mapProject('tripmap-route', [stop('a', 'תל אביב', 34.78, 32.08, 30), stop('c', 'אילת', 34.95, 29.56, 120)]);
      const route = routeOf(israel.payload);
      const s0 = israel.payload.stops[0]!.at, s1 = israel.payload.stops[1]!.at;
      let f = s0, best = Infinity;
      for (let k = s0; k <= s1; k++) { const d = Math.abs(progressAt(israel.payload, k).s - 0.5); if (progressAt(israel.payload, k).leg === 1 && d < best) { best = d; f = k; } }
      const sAt = progressAt(israel.payload, f).s, leg = route.legs[0]!;
      const m = predict(israel, f, routePointAt(leg, sAt)), a = predict(israel, f, route.stops[0]!), b = predict(israel, f, route.stops[1]!);
      const { img } = await still(israel, israel.start + f);
      const rc = hex(colours.route), H = israel.h, clear = (MAP_SIZES.marker + MAP_SIZES.outline) * H + 4, dotClear = (MAP_SIZES.dot + MAP_SIZES.outline) * H + 4;
      const pts = (from: number, to: number) => Array.from({ length: 10 }, (_, k) => predict(israel, f, routePointAt(leg, from + ((to - from) * (k + 0.5)) / 10)));
      const before = pts(0, sAt).filter((q) => Math.hypot(q.x - m.x, q.y - m.y) > clear && Math.hypot(q.x - a.x, q.y - a.y) > dotClear);
      const after = pts(sAt, 1).filter((q) => Math.hypot(q.x - m.x, q.y - m.y) > clear && Math.hypot(q.x - b.x, q.y - b.y) > dotClear);
      const present = before.filter((q) => near(img, q.x, q.y, rc, 1)).length, absent = after.filter((q) => !near(img, q.x, q.y, rc, 1)).length;
      check(3, 'at progress 0.5 of leg 1 the route colour is present at the sampled points of the predicted path before the marker and absent at those after it (points within the marker or a dot left out)', before.length >= 6 && after.length >= 6 && present === before.length && absent === after.length, { frame: f, s: r2(sAt), before: before.length, present, after: after.length, absent });
    }

    // ---------------------------------------------------------------- 4: a flight is an arc, not the straight line
    {
      const fl = await mapProject('tripmap-flight', [stop('t', 'תל אביב', 34.78, 32.08, 30), stop('l', 'לונדון', -0.13, 51.51, 120, 'flight')]);
      const leg = routeOf(fl.payload).legs[0]!, f = 150;
      const mid = predict(fl, f, routePointAt(leg, 0.5)), a = predict(fl, f, routeOf(fl.payload).stops[0]!), b = predict(fl, f, routeOf(fl.payload).stops[1]!);
      const straight = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const { img } = await still(fl, fl.start + f);
      const rc = hex(MAP_LOOK_COLOURS.paper.route);
      check(4, 'a flight leg\'s midpoint lies on the lifted great circle (route colour within 2 px of legPath\'s middle sample) and not on the straight line (none within 2 px of the chord\'s middle)', near(img, mid.x, mid.y, rc, 2) && !near(img, straight.x, straight.y, rc, 2) && Math.hypot(mid.x - straight.x, mid.y - straight.y) > 10, { arcMid: { x: r2(mid.x), y: r2(mid.y) }, chordMid: { x: r2(straight.x), y: r2(straight.y) } });
    }

    // ---------------------------------------------------------------- 6: order does not matter
    {
      const frames = Array.from({ length: 20 }, (_, k) => israel.start + 10 + k * 8);
      const inOrder: Buffer[] = [];
      for (const fr of frames) inOrder.push((await still(israel, fr)).img.rgb);
      const shuffled = frames.map((fr, k) => ({ fr, k })).sort((x, y) => ((x.k * 7919) % 20) - ((y.k * 7919) % 20));
      let same = 0;
      for (const { fr, k } of shuffled) if ((await still(israel, fr)).img.rgb.equals(inOrder[k]!)) same++;
      check(6, 'stills of 20 frames rendered in shuffled order are byte-identical (decoded pixels) to the same frames rendered in order', same === 20, { same, of: 20 });
    }

    // ---------------------------------------------------------------- 7: trim and split change nothing at the same timeline times (C4)
    {
      const p7 = await mapProject('tripmap-trim', [stop('a', 'תל אביב', 34.78, 32.08, 60), stop('b', 'ירושלים', 35.21, 31.77, 105), stop('c', 'אילת', 34.95, 29.56, 150)], { start: 30, frames: 210 });
      const times = [60, 75, 95, 120, 150, 181, 200, 230];
      const before = await Promise.all(times.map(async (t) => (await still(p7, t)).img.rgb));
      await tx(p7.pid, [{ op: 'trim_clip', args: { clipId: p7.clipId, edge: 'start', to: T.frameTime(60, p7.rate) } }]);
      const afterTrim = await Promise.all(times.map(async (t) => (await still(p7, t)).img.rgb));
      await tx(p7.pid, [{ op: 'split_clip', args: { clipId: p7.clipId, at: T.frameTime(150, p7.rate) } }]);
      const afterSplit = await Promise.all(times.map(async (t) => (await still(p7, t)).img.rgb));
      const t1 = times.filter((_, k) => before[k]!.equals(afterTrim[k]!)).length, t2 = times.filter((_, k) => before[k]!.equals(afterSplit[k]!)).length;
      check(7, 'trim the clip\'s start by 1 s and split it at its middle: stills at the same timeline times are byte-identical (decoded pixels) to before (nothing drawn reads the clip\'s start or length: C4)', t1 === times.length && t2 === times.length, { times, sameAfterTrim: t1, sameAfterSplit: t2 });
    }

    // ---------------------------------------------------------------- 9: labels, Tel Aviv / Jaffa / Eilat
    {
      const p9 = await mapProject('tripmap-labels', [stop('a', 'תל אביב', 34.78, 32.08, 30), stop('j', 'יפו', 34.75, 32.05, 75), stop('c', 'אילת', 34.95, 29.56, 120)]);
      // widths measured in the pinned Chromium with the bundled font, as the render page loads it (the editor page imports the same fonts.ts)
      const page = await browser.newPage();
      await page.goto(srv.ownerUrl);
      const font = labelFont(p9.h), names = p9.payload.stops.map((x) => x.name);
      const widths: number[] = await page.evaluate(async ([font, names]) => {
        await document.fonts.load(font as string, 'אבג ABC');
        if (!document.fonts.check(font as string, 'אבג ABC')) throw new Error(`font ${font} did not load`);
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.font = font as string;
        return (names as string[]).map((n) => { ctx.direction = /[֐-ۿ]/.test(n) ? 'rtl' : 'ltr'; return ctx.measureText(n).width; });
      }, [font, names] as const);
      await page.close();
      const layout = mapLabelLayout(p9.payload, size(p9), (n) => widths[names.indexOf(n)]!);
      const pts = stopPoints(p9.payload), W = p9.w, H = p9.h;
      let overlaps = 0, outside = 0, moved = 0;
      const offsets = layout.placements.map((pl, i) => pl.box && { dx: pl.box.x - layout.anchors[i]!.x, dy: pl.box.y - layout.anchors[i]!.y });
      for (let f = 0; f < 180; f++) {
        const cam = cameraAt(p9.payload, f, size(p9));
        const boxes = p9.payload.stops.map((st, i) => { const a = toPixels(pts[i]!, cam, size(p9)); const b = labelBoxAt(layout, i, a); const visible = !!b && f >= (i === 0 ? st.at - 12 : st.at); if (b && offsets[i] && (Math.abs(b.x - a.x - offsets[i]!.dx) > 0.02 || Math.abs(b.y - a.y - offsets[i]!.dy) > 0.02)) moved++; return visible ? b : null; }).filter((b): b is NonNullable<typeof b> => !!b);
        for (const b of boxes) if (b.x < 0.05 * W || b.y < 0.05 * H || b.x + b.w > 0.95 * W || b.y + b.h > 0.95 * H) outside++;
        for (let i = 0; i < boxes.length; i++) for (let k = i + 1; k < boxes.length; k++) { const p = boxes[i]!, q = boxes[k]!; if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) overlaps++; }
      }
      // pixels: on frames after every arrival the label colour lies only in visible boxes (grown by the outline), and every visible box holds some
      const lc = hex(colours.label), px = layout.px, grow = 0.1 * px + 3;
      let stray = 0, emptyBoxes = 0;
      const boxPixels: { frame: number; box: number; labelPixels: number }[] = [];
      // the first still is the frame the last label's fade (MAP_LABEL_FADE_SECONDS from its stop's at) has ended: at frame 130 «אילת»
      // (at 120) was still at alpha 10/12, so none of its pixels had the label colour (integration, 2026-11-26)
      const settled = p9.payload.stops.at(-1)!.at + Math.max(1, mapFrames(MAP_LABEL_FADE_SECONDS, p9.rate));
      for (const f of [settled, 150, 179]) {
        const { img, png } = await still(p9, p9.start + f);
        const cam = cameraAt(p9.payload, f, size(p9));
        const boxes = p9.payload.stops.map((_, i) => labelBoxAt(layout, i, toPixels(pts[i]!, cam, size(p9)))).filter((b): b is NonNullable<typeof b> => !!b);
        const inBox = (x: number, y: number, g: number) => boxes.some((b) => x >= b.x - g && x <= b.x + b.w + g && y >= b.y - g && y <= b.y + b.h + g);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (isCol(img, x, y, lc, 6) && !inBox(x + 0.5, y + 0.5, grow)) stray++;
        boxes.forEach((b, i) => { let n = 0; for (let y = Math.floor(b.y); y < b.y + b.h; y++) for (let x = Math.floor(b.x); x < b.x + b.w; x++) if (isCol(img, x, y, lc, 6)) n++; boxPixels.push({ frame: f, box: i, labelPixels: n }); if (n < 20) emptyBoxes++; });
        keepShot(`check9-f${f}.png`, png);
      }
      const jaffa = layout.placements.find((l) => l.stopId === 'j')!;
      check(9, 'labels «תל אביב / יפו / אילת» (widths measured in the pinned Chromium, layout by the painter\'s function): on every frame no two visible boxes overlap, every visible box lies inside the 5 % inset and keeps its side; «יפו» is hidden; on 3 stills after every label has faded in, the label colour lies only inside the visible boxes and each holds some',
        overlaps === 0 && outside === 0 && moved === 0 && jaffa.box === null && stray === 0 && emptyBoxes === 0, { widths: widths.map(r2), placements: layout.placements.map((l) => ({ stop: l.stopId, side: l.side, box: l.box && { x: r2(l.box.x), y: r2(l.box.y), w: r2(l.box.w), h: r2(l.box.h) } })), overlaps, outside, moved, strayLabelPixels: stray, emptyBoxes, boxPixels });
    }

    // ---------------------------------------------------------------- 10: a 9:16 frame shows every stop
    {
      const p10 = await mapProject('tripmap-916', [stop('a', 'תל אביב', 34.78, 32.08, 30), stop('b', 'ירושלים', 35.21, 31.77, 75), stop('c', 'אילת', 34.95, 29.56, 120)], { w: 720, h: 1280 });
      const last = 179, { img } = await still(p10, p10.start + last), rc = hex(MAP_LOOK_COLOURS.paper.route), rt = routeOf(p10.payload);
      const rows = rt.stops.map((pt) => { const q = predict(p10, last, pt); return { x: r2(q.x), y: r2(q.y), inside: q.x >= 0 && q.y >= 0 && q.x < p10.w && q.y < p10.h, dot: near(img, q.x, q.y, rc, 3) || near(img, q.x, q.y, hex(MAP_LOOK_COLOURS.paper.marker), 3) }; });
      check(10, 'a 720×1280 (9:16) project\'s last frame shows every stop inside its frame (predicted position inside, the dot or marker colour within 3 px of it)', rows.every((r) => r.inside && r.dot), rows);
    }

    // ---------------------------------------------------------------- 17: C2, no stroked crop or clip line
    {
      const runOn = (img: Img, y: number, c: readonly number[]) => { let best = 0; for (const yy of [y - 1, y, y + 1]) { let run = 0; for (let x = 0; x < img.w; x++) { if (isCol(img, x, yy, c, 12)) { run++; best = Math.max(best, run); } else run = 0; } } return best; };
      const coast = hex(colours.coast), land = hex(colours.land), rows: unknown[] = [];
      let ok = true;
      for (const [name, stops, lat] of [
        ['detail box edge, lat 36.5', [stop('a', 'א', 35.5, 33.0, 30), stop('b', 'ב', 36.2, 39.6, 120)], 36.5],
        ['north Greenland, lat 80', [stop('a', 'א', -45, 76.0, 30), stop('b', 'ב', -25, 79.9, 120)], 80],
      ] as const) {
        const p = await mapProject(`tripmap-c2-${lat}`, stops as unknown as unknown[]);
        // the ±80° line is the camera's own limit: it lies on the frame's top row before the push-in and above the frame after it
        // (at frame 60 of this fixture it is 10 px above the top), so the Greenland view is measured at stop 0's frame
        const f = lat === 80 ? p.payload.stops[0]!.at : 60, cam = cameraAt(p.payload, f, size(p)), y = Math.round(toPixels({ x: cam.cx, y: (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) }, cam, size(p)).y);
        const { img } = await still(p, p.start + f);
        let landBelow = 0; for (let x = 0; x < img.w; x++) for (const yy of [y + 2, y + 3, y + 4]) if (isCol(img, x, yy, land, 6)) landBelow++;
        const longest = y >= 0 && y < img.h - 2 ? runOn(img, y, coast) : -1; // rows outside the image hold no colour (isCol)
        keepShot(`check17-lat${lat}.png`, (await still(p, p.start + f)).png);
        rows.push({ name, frame: f, row: y, longestCoastRun: longest, landPixelsBelow: landBelow });
        ok &&= longest >= 0 && longest <= 8 && landBelow > 50;
      }
      check(17, 'C2: on a view across the detail box edge (lat 36.5) and on a view of north Greenland (lat 80), the line rows hold no run of coast colour longer than 8 px (a stroked cut line would run along the land)', ok, rows);
    }

    // ---------------------------------------------------------------- 18: the antimeridian
    {
      const p = await mapProject('tripmap-pacific', [stop('t', 'טוקיו', 139.69, 35.69, 30), stop('l', 'לוס אנג\'לס', -118.24, 34.05, 150, 'flight')]);
      const land = hex(colours.land), rows: unknown[] = [];
      let ok = true;
      for (const f of [0, 90, 179]) {
        const cam = cameraAt(p.payload, f, size(p)), x180 = toPixels({ x: 180, y: cam.cy }, cam, size(p)).x;
        const { img } = await still(p, p.start + f);
        let west = 0, east = 0;
        for (let y = 0; y < img.h; y += 2) for (let x = 0; x < img.w; x += 2) if (isCol(img, x, y, land, 6)) { if (x < x180 - 10) west++; else if (x > x180 + 10) east++; }
        rows.push({ frame: f, x180: r2(x180), landWest: west, landEast: east });
        ok &&= west > 200 && east > 200;
      }
      check(18, 'antimeridian: a flight Tokyo → Los Angeles shows land on both sides of 180° on every sampled frame (world copies at ±360°)', ok, rows);
    }

    // ---------------------------------------------------------------- 11: the flash gate per look (C6)
    {
      const rows: unknown[] = [];
      let ok = true;
      const regions = [
        ['narrowest (world level): the Aegean', [stop('a', 'אתונה', 23.73, 37.98, 15), stop('r', 'רודוס', 28.22, 36.43, 45, 'boat'), stop('h', 'הרקליון', 25.13, 35.34, 75, 'flight')]],
        ['widest (coarse level): Athens, Moscow, Cairo', [stop('a', 'אתונה', 23.73, 37.98, 15), stop('m', 'מוסקבה', 37.62, 55.75, 45, 'flight'), stop('c', 'קהיר', 31.24, 30.04, 75, 'flight')]],
      ] as const;
      for (const look of ['paper', 'night'] as const) for (const fps of [30, 60]) for (const [name, stops] of regions) {
        const k = fps / 30, frames = 120 * k;
        const p = await mapProject(`tripmap-flash-${look}-${fps}`, stops.map((x) => ({ ...x, at: x.at * k })), { w: 640, h: 360, fps, look, frames });
        // a pan at MAX_PAN_RATE view heights a second (2 s), then a zoom at MAX_ZOOM_RATE (doubling a second, 2 s), by the clip's own transform keys
        const panW = (MAX_PAN_RATE * p.h) / p.w;
        const keys = [[0, 'x', 0], [60 * k, 'x', 2 * panW], [60 * k, 'scale', 1], [119 * k, 'scale', 2 ** (MAX_ZOOM_RATE * (59 / 30))]] as const;
        await tx(p.pid, keys.map(([t, property, value]) => ({ op: 'set_keyframe', args: { clipId: p.clipId, property, time: T.frameTime(t, p.rate), value } })));
        const job = await waitJob((await call(`/projects/${p.pid}/exports`, { range: { startFrame: 0, endFrame: frames } })).body.jobId);
        const rep = job.output?.photosensitivity;
        rows.push({ look, fps, region: name, export: job.status, verdict: rep?.verdict ?? null, ranges: rep?.ranges?.length ?? null, areaPeak: rep?.areaPeak ?? null, error: job.error ?? undefined });
        ok &&= job.status === 'succeeded' && rep?.verdict === 'pass';
      }
      check(11, 'flash gate per look (C6), paper and night: a pan at MAX_PAN_RATE then a zoom at MAX_ZOOM_RATE (the clip\'s transform keys, on top of the painter\'s push-in) over the Aegean at the world level and over a coarse view, labels and rings on, at 30 and 60 fps, 640×360: the export\'s own photosensitivity check (the analyser on the rendered frames) reports pass; the unit rule is packages/engine/src/map/paintMap.test.ts', ok, rows);
    }

    // ---------------------------------------------------------------- 13: the outline chunk made unloadable
    {
      const okStill = await still(israel, israel.start + 60).then(() => true, () => false);
      let refused: { status?: number; text: string } | null = null;
      if (chunkName) {
        const dist2 = path.join(art, 'dist-without-outlines');
        fs.cpSync(webDist, dist2, { recursive: true });
        fs.rmSync(path.join(dist2, 'assets', chunkName));
        s2 = await startServer({ port: 0, dataDir: path.join(art, 'data2'), webDist: dist2, renderCacheBytes: 0 });
        const base2 = s2.url, auth2 = { authorization: `Bearer ${s2.auth.tokens.agent}`, 'content-type': 'application/json', connection: 'close' };
        const pid = (await (await fetch(`${base2}/api/v1/projects`, { method: 'POST', headers: auth2, body: JSON.stringify({ name: 'no-outlines', width: 1280, height: 720 }) })).json() as any).project.id;
        const r = await fetch(`${base2}/api/v1/projects/${pid}/transactions`, { method: 'POST', headers: auth2, body: JSON.stringify({ ops: [{ op: 'add_trip_map', args: { start: T.frameTime(0, israel.rate), duration: T.frameTime(180, israel.rate), stops: israel.payload.stops.map(({ id, name, lon, lat, at }) => ({ id, name, lon, lat, at })) } }] }) });
        if (r.status !== 200) throw new Error(`check 13 setup: ${r.status}`);
        const st = await fetch(`${base2}/api/v1/projects/${pid}/frame?index=60`, { headers: auth2 });
        refused = { status: st.status, text: st.status === 200 ? '' : (await st.text()).slice(0, 600) };
      }
      check(13, 'with the outline chunk made unloadable (a copy of the web bundle without it, served by a second server), a still is refused naming drawn.map with the reason; with it loadable the same still succeeds', okStill && !!refused && refused.status !== 200 && /drawn\.map/.test(refused.text) && /could not be loaded|not loaded/.test(refused.text), { loadable: okStill, unloadable: refused });
    }

    // ---------------------------------------------------------------- 19: recorded, not gated
    {
      const per: Record<string, unknown> = {};
      for (const [name, stops] of [
        ['Israel view', [stop('a', 'תל אביב', 34.78, 32.08, 15), stop('b', 'אילת', 34.95, 29.56, 50)]],
        ['Europe view', [stop('a', 'לונדון', -0.13, 51.51, 15), stop('b', 'רומא', 12.5, 41.9, 50, 'flight'), stop('c', 'אתונה', 23.73, 37.98, 85, 'flight')]],
      ] as const) {
        const p = await mapProject(`tripmap-time-${name}`, stops as unknown as unknown[], { w: 1920, h: 1080, frames: 120 });
        const job = await waitJob((await call(`/projects/${p.pid}/exports`, { range: { startFrame: 0, endFrame: 120 } })).body.jobId);
        const draw = job.output?.renderStageMs?.draw;
        per[name] = { frames: 120, drawMsPerFrame: typeof draw === 'number' ? r2(draw / 120) : null, export: job.status, note: 'one sample, this container, the whole frame (sea, outlines, route, labels) at 1920×1080 with round joins' };
      }
      // round against bevel: the world level's coast paths of a Europe view, filled and stroked in the pinned Chromium (one sample each)
      const world = OUTLINES.levels.find((l) => l.id === 'world')!;
      const groups = world.land.filter((g) => g.bbox[2] * world.q > -12 && g.bbox[0] * world.q < 40 && g.bbox[3] * world.q > 30 && g.bbox[1] * world.q < 75).map((g) => decodeQuanta(g).map((r) => ({ xy: [...r.xy], cut: [...r.cut] })));
      const page = await browser.newPage();
      await page.evaluate('window.__name = (f) => f'); // tsx compiles named inner functions with an __name() helper the page does not have
      const joins = await page.evaluate(({ groups, q }) => {
        const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        const paths = groups.map((rings) => { const p = new Path2D(); for (const r of rings) { p.moveTo(r.xy[0]!, r.xy[1]!); for (let k = 2; k < r.xy.length; k += 2) p.lineTo(r.xy[k]!, r.xy[k + 1]!); p.closePath(); } return p; });
        const k = 1080 / 50, a = q * k;
        const time = (join: CanvasLineJoin) => { const t0 = performance.now(); for (let rep = 0; rep < 10; rep++) { ctx.setTransform(a, 0, 0, -a, (12 + 960 / k) * k, 52 * k); ctx.fillStyle = '#E9E1CE'; for (const p of paths) ctx.fill(p, 'evenodd'); ctx.lineJoin = join; ctx.lineWidth = 2 / a; ctx.strokeStyle = '#A3B1B4'; for (const p of paths) ctx.stroke(p); } ctx.getImageData(0, 0, 1, 1); return (performance.now() - t0) / 10; };
        time('round');
        return { round: time('round'), bevel: time('bevel') };
      }, { groups, q: world.q });
      await page.close();
      measurements.timing = { ...per, joins: { msPerDraw: { round: r2(joins.round), bevel: r2(joins.bevel) }, groups: groups.length, vertices: groups.reduce((n, g) => n + g.reduce((m, r) => m + r.xy.length / 2, 0), 0), note: 'one sample each, this container: fill + stroke of the world level coasts of a Europe view, 1920×1080, 10 repeats averaged' } };
      check(19, 'recorded, not gated: ms per frame of the painter at 1080p for an Israel view and a Europe view, and round against bevel joins (one sample each)', true, measurements.timing);
    }
  } catch (e) {
    console.error(e);
    blockRest(`the drawing proof did not run to completion: ${String((e as Error)?.message ?? e).slice(0, 400)}`);
    for (const c of checks) if (c.blocked?.startsWith('the drawing proof did not run')) { c.blocked = undefined; c.detail = 'not reached: an earlier step threw'; }
  } finally {
    await browser.close();
    await s?.close();
    await s2?.close();
    fs.rmSync(art, { recursive: true, force: true });
  }
  return { checks, measurements };
}
