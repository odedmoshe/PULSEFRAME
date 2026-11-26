/**
 * Overlays and the date stamp (ADR-0011 wave 1) on the shared Canvas2D compositor, checked against their closed-form model:
 *  - every overlay at its defaults on a black picture: at least 99 % of the model's particle centres are lit to at least half
 *    the brightness the model gives them, and at least 99 % of the pixels farther than 2·(largest particle reach) from every
 *    particle are exactly unchanged; speed lines: the pixels inside and outside the model's wedges agree;
 *  - continuity across a cut (a split clip draws the same frames), repeatability, preview against still (SPEC §8 tolerance:
 *    2/255 for 99.9 % of samples), the same three hours into the timeline;
 *  - the confetti burst: centroid within 2 px of the closed form at 0.5 s, nothing left after 1.6 s;
 *  - the date stamp: segment mask IoU ≥ 0.95 against the model polygons at 16:9 and 9:16; text outside its alphabet is refused;
 *  - flash safety (ADR-0009): the flash analyser passes on a 3-second export of every overlay at its defaults, of speed lines
 *    at their extremes, and of snow, confetti and hearts at their extremes and at the mid sizes that flashed at top speed
 *    before their speed limit (overlays.ts speedLimit), and of snow made heavier or larger by keys during the clip (the
 *    limit and the lattice held for the whole clip, overlays.ts heldOverlayParams).
 * CPU only: no graphics adapter is used or needed (these are Canvas2D effects).
 *   pnpm build && pnpm proof:overlays
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { FlashAnalyser, flashCells } from '@pulseframe/engine';
import { CENTRE_GAIN, boundRadius, overlayParticles, shapeAlpha, speedLines, wedgeCorners, type Particle } from '@pulseframe/engine/overlays.ts';
import { stampPolygons } from '@pulseframe/engine/stamp.ts';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/overlays-proof');
const R = { num: 30, den: 1 }, FPS = 30;
const f = (n: number) => T.frameTime(n, R);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 2 ** 31, ...(input ? { input } : {}) });
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const measurements: Record<string, unknown> = {};
type Params = Record<string, number | string | boolean>;
/** An RGB picture of known size. */
export interface Img { w: number; h: number; rgb: Buffer }
const pngToRgb = (png: Buffer, w: number, h: number): Img => { const rgb = ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png); if (rgb.length !== w * h * 3) throw new Error(`still is not ${w}x${h}`); return { w, h, rgb }; };
const at = (im: Img, x: number, y: number) => { const i = (y * im.w + x) * 3; return [im.rgb[i]!, im.rgb[i + 1]!, im.rgb[i + 2]!] as const; };
const hexRgb = (hex: string) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] as const;
const pct = (a: number, b: number) => Number(((100 * a) / Math.max(1, b)).toFixed(3));

/** Model checks of one overlay frame on a black picture: centres lit, far pixels untouched. */
export function particleMatch(img: Img, base: Img, parts: readonly Particle[]) {
  let considered = 0, lit = 0, faint = 0;
  const misses: unknown[] = [];
  for (const q of parts) {
    if (q.x < 1 || q.y < 1 || q.x >= img.w - 1 || q.y >= img.h - 1) continue;
    const expected = 255 * Math.min(1, q.alpha) * CENTRE_GAIN[q.shape] * (Math.max(...hexRgb(q.colour)) / 255);
    if (expected < 8) { faint++; continue; } // too faint to measure on 8-bit pixels
    considered++;
    const v = Math.max(...at(img, Math.floor(q.x), Math.floor(q.y)));
    if (v >= 0.5 * expected) lit++; else if (misses.length < 5) misses.push({ x: Number(q.x.toFixed(2)), y: Number(q.y.toFixed(2)), r: Number(q.r.toFixed(2)), shape: q.shape, expected: Math.round(expected), got: v });
  }
  const rMax = Math.max(0, ...parts.map((q) => boundRadius(q)));
  const near = new Uint8Array(img.w * img.h), reach = 2 * rMax;
  for (const q of parts) {
    for (let y = Math.max(0, Math.floor(q.y - reach)); y <= Math.min(img.h - 1, Math.ceil(q.y + reach)); y++) for (let x = Math.max(0, Math.floor(q.x - reach)); x <= Math.min(img.w - 1, Math.ceil(q.x + reach)); x++) if (Math.hypot(x + 0.5 - q.x, y + 0.5 - q.y) <= reach) near[y * img.w + x] = 1;
  }
  let far = 0, same = 0;
  for (let i = 0; i < near.length; i++) if (!near[i]) { far++; if (img.rgb[i * 3] === base.rgb[i * 3] && img.rgb[i * 3 + 1] === base.rgb[i * 3 + 1] && img.rgb[i * 3 + 2] === base.rgb[i * 3 + 2]) same++; }
  return { particles: parts.length, considered, faint, litPct: pct(lit, considered), farPixels: far, farUnchangedPct: pct(same, far), rMax: Number(rMax.toFixed(2)), misses };
}

/** Speed lines against their model: pixels clearly inside a wedge are lit, pixels clearly outside are untouched. */
export function wedgeMatch(img: Img, base: Img, p: Params, seconds: number) {
  const { cx, cy, lines } = speedLines(p, img.w, img.h, seconds);
  const n = Math.max(16, Math.min(240, Math.round(Number(p.lines)))), slot = (2 * Math.PI) / n;
  const bySlot = new Map<number, [number, number][]>();
  for (const s of lines) bySlot.set(Math.floor((s.a0 + s.a1) / 2 / slot), wedgeCorners(cx, cy, s));
  const segDist = (x: number, y: number, a: [number, number], b: [number, number]) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
  const threshold = 0.5 * Number(p.amount) * Math.max(...hexRgb(String(p.color)));
  let inside = 0, insideLit = 0, outside = 0, outsideSame = 0;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    const px = x + 0.5, py = y + 0.5;
    const k = Math.floor((((Math.atan2(py - cy, px - cx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / slot);
    let into = false, edge = Infinity;
    for (const j of [k - 2, k - 1, k, k + 1, k + 2]) {
      const t = bySlot.get(((j % n) + n) % n);
      if (!t) continue;
      const [a, b, c] = t as [[number, number], [number, number], [number, number]];
      const s1 = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]), s2 = (c[0] - b[0]) * (py - b[1]) - (c[1] - b[1]) * (px - b[0]), s3 = (a[0] - c[0]) * (py - c[1]) - (a[1] - c[1]) * (px - c[0]);
      if (!((s1 < 0 || s2 < 0 || s3 < 0) && (s1 > 0 || s2 > 0 || s3 > 0))) into = true;
      edge = Math.min(edge, segDist(px, py, a, b), segDist(px, py, b, c), segDist(px, py, c, a));
    }
    if (edge < 1.5) continue; // the antialiased edge itself
    const v = Math.max(...at(img, x, y));
    if (into) { inside++; if (v >= threshold) insideLit++; }
    else { outside++; const i = (y * img.w + x) * 3; if (img.rgb[i] === base.rgb[i] && img.rgb[i + 1] === base.rgb[i + 1] && img.rgb[i + 2] === base.rgb[i + 2]) outsideSame++; }
  }
  return { wedges: lines.length, insidePixels: inside, insideLitPct: pct(insideLit, inside), outsidePixels: outside, outsideUnchangedPct: pct(outsideSame, outside) };
}

/** The model of a frame of particles drawn on black in JavaScript (4×4 samples a pixel, source-over), as intensities 0…1. */
export function rasterise(parts: readonly Particle[], w: number, h: number): Float64Array {
  const v = new Float64Array(w * h);
  for (const q of parts) {
    const reach = boundRadius(q) + 1, c = Math.cos(-q.rot), s = Math.sin(-q.rot);
    for (let y = Math.max(0, Math.floor(q.y - reach)); y <= Math.min(h - 1, Math.ceil(q.y + reach)); y++) for (let x = Math.max(0, Math.floor(q.x - reach)); x <= Math.min(w - 1, Math.ceil(q.x + reach)); x++) {
      let a = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const dx = x + (sx + 0.5) / 4 - q.x, dy = y + (sy + 0.5) / 4 - q.y; a += shapeAlpha(q.shape, (dx * c - dy * s) / q.r, (dx * s + dy * c) / q.r); }
      a = (a / 16) * q.alpha;
      v[y * w + x] = v[y * w + x]! * (1 - a) + a;
    }
  }
  return v;
}
export const centroid = (weight: (i: number) => number, w: number, h: number) => { let sx = 0, sy = 0, sw = 0; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = weight(y * w + x); sx += k * (x + 0.5); sy += k * (y + 0.5); sw += k; } return { x: sx / sw, y: sy / sw, weight: sw }; };

/** Pixels inside any polygon (pixel centres, even-odd per polygon, union over polygons). */
export function polygonMask(polys: { x: number; y: number }[][], w: number, h: number): Uint8Array {
  const m = new Uint8Array(w * h);
  for (const poly of polys) {
    const ys = poly.map((p) => p.y), xs = poly.map((p) => p.x);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i]!, b = poly[j]!; if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside; }
      if (inside) m[y * w + x] = 1;
    }
  }
  return m;
}

async function previewRgb(page: Page, w: number, h: number): Promise<Img & { frame: string | null; quality: string | null }> {
  const r: { size: string; data: string; frame: string | null; quality: string | null } = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]')!;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    const out = new Uint8Array((d.length / 4) * 3);
    for (let i = 0, k = 0; i < d.length; i += 4) { out[k++] = d[i]!; out[k++] = d[i + 1]!; out[k++] = d[i + 2]!; }
    let s = ''; for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
    return { size: `${c.width}x${c.height}`, data: btoa(s), frame: c.getAttribute('data-frame'), quality: c.getAttribute('data-quality') };
  });
  if (r.size !== `${w}x${h}`) return { w, h, rgb: Buffer.alloc(0), frame: r.frame, quality: r.quality };
  return { w, h, rgb: Buffer.from(r.data, 'base64'), frame: r.frame, quality: r.quality };
}
const agreement = (a: Img, b: Img) => { if (a.rgb.length !== b.rgb.length || !a.rgb.length) return { within2Pct: 0, max: 255, mean: 255 }; let ok = 0, max = 0, sum = 0; for (let i = 0; i < a.rgb.length; i++) { const d = Math.abs(a.rgb[i]! - b.rgb[i]!); if (d <= 2) ok++; if (d > max) max = d; sum += d; } return { within2Pct: pct(ok, a.rgb.length), max, mean: Number((sum / a.rgb.length).toFixed(4)) }; };

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
  const pic = (name: string, src: string, w: number, h: number) => { const file = path.join(art, `${name}.png`); ff(['-y', '-f', 'lavfi', '-i', `${src}${src.includes('=') ? ':' : '='}s=${w}x${h}`, '-frames:v', '1', file]); return file; };
  const black169 = pic('black-1280x720', 'color=c=black', 1280, 720), black916 = pic('black-720x1280', 'color=c=black', 720, 1280);
  const black360 = pic('black-640x360', 'color=c=black', 640, 360), colour360 = pic('testsrc-640x360', 'testsrc2', 640, 360);

  const s = await startServer({ port: 0, dataDir: path.join(art, 'data') });
  const auth = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const upload = async (pid: string, file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...auth, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  const project = async (name: string, file: string, w: number, h: number, start = 0, frames = 90) => {
    const pid = (await call('/projects', { name, width: w, height: h })).body.project.id as string;
    const assetId = await upload(pid, file);
    const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(frames), withLinkedAudio: false } }])).results[0].output.clipId as string;
    return { pid, assetId, clipId, w, h };
  };
  const still = async (p: { pid: string; w: number; h: number }, index: number, name?: string) => {
    const r = await call(`/projects/${p.pid}/frame?index=${index}`);
    if (r.status !== 200) throw new Error(`still ${index} failed: ${JSON.stringify(r.body).slice(0, 300)}`);
    if (name) fs.writeFileSync(path.join(art, `${name}.png`), r.body);
    return pngToRgb(r.body, p.w, p.h);
  };
  const addFx = async (pid: string, clipId: string, type: string, params: Record<string, unknown> = {}) => (await tx(pid, [{ op: 'add_effect', args: { clipId, type, params } }])).results[0].output as { effectId: string; params: Params };
  const removeFx = (pid: string, clipId: string, effectId: string) => tx(pid, [{ op: 'remove_effect', args: { clipId, effectId } }]);
  const browser = await chromium.launch();
  try {
    // ---------------------------------------------------------------- the model, on stills
    console.log('\n# every overlay at its defaults on a black 1280x720 picture, against the closed-form model (frame 45, 1.5 s)');
    const m = await project('overlays-model', black169, 1280, 720, 0, 120);
    const base45 = await still(m, 45);
    const kinds: [string, Record<string, unknown>][] = [['overlay.snow', {}], ['overlay.confetti', {}], ['overlay.hearts', {}], ['overlay.bokeh', {}], ['overlay.bokeh', { shape: 'hexagon' }]];
    const perKind: Record<string, unknown> = {};
    for (const [type, over] of kinds) {
      const label = `${type}${Object.keys(over).length ? ` ${JSON.stringify(over)}` : ''}`;
      const t0 = Date.now();
      const fx = await addFx(m.pid, m.clipId, type, over);
      const img = await still(m, 45, `model-${type.slice(8)}${over.shape ? `-${over.shape}` : ''}`);
      const ms = Date.now() - t0;
      const again = await still(m, 45);
      await still(m, 12);
      const third = await still(m, 45);
      const res = particleMatch(img, base45, overlayParticles(type, fx.params, 1280, 720, 45 / FPS, 45 / FPS, null));
      perKind[label] = { ...res, msForEditAndStill: ms };
      check(`${label}: ≥ 99 % of the model's particle centres are lit to at least half their model brightness, and ≥ 99 % of the pixels farther than 2·(largest reach) from every particle are unchanged`, res.considered >= 10 && res.litPct >= 99 && res.farPixels > 1000 && res.farUnchangedPct >= 99, res);
      check(`${label}: the same still rendered twice, and again after another frame, is byte-identical`, img.rgb.equals(again.rgb) && img.rgb.equals(third.rgb));
      await removeFx(m.pid, m.clipId, fx.effectId);
    }
    measurements.model = perKind;
    {
      const fx = await addFx(m.pid, m.clipId, 'overlay.speed-lines');
      const img = await still(m, 45, 'model-speed-lines');
      const res = wedgeMatch(img, base45, fx.params, 45 / FPS);
      measurements.speedLines = res;
      check('overlay.speed-lines at its defaults: ≥ 99 % of the pixels inside the model\'s wedges are lit, ≥ 99 % of those outside are unchanged (pixels within 1.5 px of a wedge edge left out)', res.insidePixels > 1000 && res.insideLitPct >= 99 && res.outsideUnchangedPct >= 99, res);
      const later = await still(m, 46);
      check('overlay.speed-lines move: the next frame differs (the tips wander), and the angles stay where they are', !later.rgb.equals(img.rgb));
      await removeFx(m.pid, m.clipId, fx.effectId);
    }
    {
      // area=layer: the overlay stays inside the layer's shape
      await tx(m.pid, [{ op: 'set_clip_transform', args: { clipId: m.clipId, transform: { scale: 0.5 } } }]);
      const fx = await addFx(m.pid, m.clipId, 'overlay.snow', { area: 'layer', density: 1 });
      const img = await still(m, 45, 'snow-area-layer');
      let outside = 0, outsideLit = 0, inside = 0, insideLit = 0;
      for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
        const v = Math.max(...at(img, x, y)), inBox = x >= 320 && x < 960 && y >= 180 && y < 540;
        if (inBox) { inside++; if (v > 20) insideLit++; } else if (x < 316 || x >= 964 || y < 176 || y >= 544) { outside++; if (v > 0) outsideLit++; }
      }
      check('area=layer keeps the snow inside the (half-size) picture: nothing is drawn outside it, flakes are drawn inside it', outsideLit === 0 && insideLit > inside * 0.02, { insideLitPct: pct(insideLit, inside), outsideLitPixels: outsideLit });
      await removeFx(m.pid, m.clipId, fx.effectId);
      await tx(m.pid, [{ op: 'set_clip_transform', args: { clipId: m.clipId, transform: { scale: 1 } } }]);
    }

    console.log('\n# continuity across a cut');
    {
      const c = await project('overlays-cut', black169, 1280, 720, 0, 90);
      await addFx(c.pid, c.clipId, 'overlay.snow', { seed: 42 });
      await addFx(c.pid, c.clipId, 'overlay.bokeh', { seed: 42 });
      const before = await Promise.all([39, 40, 41].map((k) => still(c, k)));
      const right = (await tx(c.pid, [{ op: 'split_clip', args: { clipId: c.clipId, at: f(40) } }])).results[0].output.rightClipId as string;
      const after = [await still(c, 39), await still(c, 40, 'cut-40'), await still(c, 41)];
      const d = (await call(`/projects/${c.pid}`)).body.project;
      const clips = d.sequences[d.mainSequenceId].tracks.flatMap((t: any) => t.clips).filter((x: any) => x.effects?.length);
      check('a clip with snow and bokeh (seed 42) cut at frame 40: two clips with the same seed, and the frames on both sides of the cut are byte-identical to the uncut clip', clips.length === 2 && clips.some((x: any) => x.id === right) && before.every((b, i) => b.rgb.equals(after[i]!.rgb)), { clips: clips.length });
    }

    console.log('\n# three hours into the timeline');
    const farStart = 3 * 3600 * FPS;
    const far = await project('overlays-3h', black169, 1280, 720, farStart, 60);
    const farBase = await still(far, farStart + 30);
    const farFx = await addFx(far.pid, far.clipId, 'overlay.snow');
    const farImg = await still(far, farStart + 30, 'snow-3h');
    const farRes = particleMatch(farImg, farBase, overlayParticles('overlay.snow', farFx.params, 1280, 720, (farStart + 30) / FPS, 1, null));
    measurements.threeHours = farRes;
    check('snow at 3 h + 1 s on the timeline: the same model match (≥ 99 % of centres lit, ≥ 99 % of far pixels unchanged)', farRes.considered >= 10 && farRes.litPct >= 99 && farRes.farUnchangedPct >= 99, farRes);

    console.log('\n# confetti burst');
    {
      const b = await project('overlays-burst', black169, 1280, 720, 0, 90);
      const fx = await addFx(b.pid, b.clipId, 'overlay.confetti', { mode: 'burst', palette: 'single', color: '#FFFFFF', seed: 3 });
      const img = await still(b, 15, 'burst-0.5s');
      const model = rasterise(overlayParticles('overlay.confetti', fx.params, 1280, 720, 0.5, 0.5, null), 1280, 720);
      const got = centroid((i) => (img.rgb[i * 3]! + img.rgb[i * 3 + 1]! + img.rgb[i * 3 + 2]!) / 765, 1280, 720), want = centroid((i) => model[i]!, 1280, 720);
      const off = Math.hypot(got.x - want.x, got.y - want.y);
      measurements.burst = { rendered: { x: Number(got.x.toFixed(2)), y: Number(got.y.toFixed(2)), weight: Math.round(got.weight) }, model: { x: Number(want.x.toFixed(2)), y: Number(want.y.toFixed(2)), weight: Math.round(want.weight) }, offPx: Number(off.toFixed(3)) };
      check('confetti burst (48 pieces at the clip start): 0.5 s in, the brightness-weighted centroid is within 2 px of the closed form\'s, with about the same amount of confetti', off <= 2 && Math.abs(got.weight - want.weight) <= 0.1 * want.weight, measurements.burst);
      const end = await still(b, 50), plain = await (async () => { await removeFx(b.pid, b.clipId, fx.effectId); return still(b, 50); })();
      check('the burst is over after 1.6 s: frame 50 is the plain picture', end.rgb.equals(plain.rgb));
    }

    console.log('\n# date stamp');
    {
      const stampRes: Record<string, unknown> = {};
      let allOk = true;
      for (const [aspect, file, w, h] of [['16:9', black169, 1280, 720], ['9:16', black916, 720, 1280]] as const) {
        const p = await project(`stamp-${aspect.replace(':', 'x')}`, file, w, h, 0, 30);
        for (const text of ["'05 7 14", '12:34']) {
          const fx = await addFx(p.pid, p.clipId, 'stylize.date-stamp', { text, size: 0.1, glow: 0 });
          const img = await still(p, 0, `stamp-${aspect.replace(':', 'x')}-${text.replace(/[^0-9]/g, '')}`);
          const model = polygonMask(stampPolygons(text, 0.1 * h, 'bottom-right', w, h), w, h);
          let inter = 0, uni = 0;
          for (let i = 0; i < w * h; i++) { const r = img.rgb[i * 3]! >= 128 ? 1 : 0; if (r && model[i]) inter++; if (r || model[i]) uni++; }
          const iou = inter / Math.max(1, uni);
          stampRes[`${aspect} ${text}`] = { iou: Number(iou.toFixed(4)), modelPixels: model.reduce((a, v) => a + v, 0) };
          if (!(iou >= 0.95)) allOk = false;
          await removeFx(p.pid, p.clipId, fx.effectId);
        }
        if (aspect === '16:9') {
          const glowFx = await addFx(p.pid, p.clipId, 'stylize.date-stamp', { text: '12:34', size: 0.1 });
          const glowImg = await still(p, 0, 'stamp-glow');
          const model = polygonMask(stampPolygons('12:34', 0.1 * h, 'bottom-right', w, h), w, h);
          let halo = 0;
          for (let i = 0; i < w * h; i++) if (!model[i] && glowImg.rgb[i * 3]! > 8 && glowImg.rgb[i * 3]! < 128) halo++;
          stampRes.glowHaloPixels = halo;
          if (halo < 200) allOk = false;
          const bad = await call(`/projects/${p.pid}/transactions`, { ops: [{ op: 'update_effect', args: { clipId: p.clipId, effectId: glowFx.effectId, params: { text: '12:34 PM' } } }] });
          const bad2 = await call(`/projects/${p.pid}/transactions`, { ops: [{ op: 'add_effect', args: { clipId: p.clipId, type: 'stylize.date-stamp', params: { text: 'שלום' } } }] });
          check('date stamp text outside digits, space and . : \' / - is refused with invalid_args (on add and on update), and the stamp stays as it was', bad.status >= 400 && bad.body?.error?.code === 'invalid_args' && bad2.status >= 400 && bad2.body?.error?.code === 'invalid_args' && (await still(p, 0)).rgb.equals(glowImg.rgb), { update: [bad.status, bad.body?.error?.code], add: [bad2.status, bad2.body?.error?.code] });
        }
      }
      measurements.stamp = stampRes;
      check('date stamp "\'05 7 14" and "12:34" (glow 0): the drawn segments match the model polygons with IoU ≥ 0.95 at 16:9 and 9:16; with the default glow a soft halo surrounds them', allOk, stampRes);
    }

    // ---------------------------------------------------------------- preview against still
    console.log('\n# editor preview against still (SPEC §8: 2/255 for 99.9 % of samples)');
    {
      const all = await project('overlays-preview', colour360, 640, 360, 0, 90);
      for (const [type, over] of [['overlay.bokeh', {}], ['overlay.snow', {}], ['overlay.confetti', {}], ['overlay.hearts', {}], ['overlay.speed-lines', {}], ['stylize.date-stamp', {}]] as const) await addFx(all.pid, all.clipId, type, over);
      const farAll = await project('overlays-preview-3h', colour360, 640, 360, farStart, 60);
      for (const type of ['overlay.snow', 'overlay.bokeh', 'overlay.speed-lines']) await addFx(farAll.pid, farAll.clipId, type);
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      const compare = async (p: { pid: string; w: number; h: number }, frame: number, seek: (() => Promise<void>) | null) => {
        await page.goto(`${s.ownerUrl}&project=${p.pid}`);
        await page.waitForFunction(() => document.querySelector('canvas[data-testid=preview]')?.getAttribute('data-frame') !== null, undefined, { timeout: 60_000 });
        if (seek) await seek();
        const want = await still(p, frame);
        let got = await previewRgb(page, p.w, p.h), a = agreement(got, want);
        for (let i = 0; i < 150 && !(got.frame === String(frame) && got.quality === 'full' && a.within2Pct >= 99.9); i++) { await sleep(100); got = await previewRgb(page, p.w, p.h); a = agreement(got, want); }
        return { ...a, frame: got.frame, quality: got.quality };
      };
      const near = await compare(all, 0, null);
      check('all six (bokeh, snow, confetti, hearts, speed lines, date stamp) on one picture: the paused editor preview at frame 0 matches the still within 2/255 on ≥ 99.9 % of samples', near.frame === '0' && near.within2Pct >= 99.9, near);
      const farFrame = farStart + 59;
      const farCmp = await compare(farAll, farFrame, async () => { await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.()); await page.keyboard.press('End'); });
      check(`three hours in (frame ${farFrame}): the same agreement between preview and still`, farCmp.frame === String(farFrame) && farCmp.within2Pct >= 99.9, farCmp);
      measurements.previewVsStill = { atStart: near, atThreeHours: farCmp };
      check('no page errors in the editor', errors.length === 0, errors.slice(0, 3));
      await page.close();
    }

    // ---------------------------------------------------------------- flash safety on exports
    console.log('\n# flash safety (ADR-0009): the flash analyser on 3-second exports');
    {
      const ext = { amount: 1, lines: 240, thickness: 2, rate: 2, reach: 1 };
      // optional keys: parameter → [clip-local frame, value][]
      const items: [string, string, Record<string, unknown>, Record<string, [number, number][]>?][] = [
        ['snow at defaults', 'overlay.snow', {}], ['confetti at defaults', 'overlay.confetti', {}], ['confetti burst', 'overlay.confetti', { mode: 'burst' }], ['hearts at defaults', 'overlay.hearts', {}],
        ['bokeh at defaults', 'overlay.bokeh', {}], ['speed lines at defaults', 'overlay.speed-lines', {}], ['date stamp at defaults', 'stylize.date-stamp', {}],
        ['speed lines at their extremes (every number at its maximum)', 'overlay.speed-lines', { ...ext, focus: 1, x: 1, y: 1 }], ['speed lines at their extremes, sweeping the whole frame (focus 0)', 'overlay.speed-lines', { ...ext, focus: 0 }],
        // the settings that flashed before the speed limit (overlays.ts speedLimit): the largest particles, and the mid sizes that flashed worst
        ['snow at its extremes (largest flakes, top speed, full density and opacity)', 'overlay.snow', { size: 0.04, speed: 1, density: 1, amount: 1 }],
        ['snow with mid-size flakes at top speed, full density and opacity, wind to the left', 'overlay.snow', { size: 0.018, speed: 1, density: 1, amount: 1, wind: -1 }],
        ['hearts at their extremes (every number at its maximum)', 'overlay.hearts', { size: 0.1, speed: 0.5, density: 1, amount: 1 }],
        ['hearts of mid size at top speed, full density and opacity, in their own red', 'overlay.hearts', { size: 0.02, speed: 0.5, density: 1, amount: 1 }],
        ['pure red hearts of size 0.015 at top speed, full density and opacity', 'overlay.hearts', { size: 0.015, speed: 0.5, density: 1, amount: 1, color: '#FF0000' }],
        ['confetti at its extremes (every number at its maximum)', 'overlay.confetti', { size: 0.05, speed: 1, density: 1, amount: 1 }],
        ['red confetti of mid size at top speed, full density and opacity', 'overlay.confetti', { size: 0.02, speed: 1, density: 1, amount: 1, palette: 'single', color: '#FF0000' }],
        // keys during the clip (late on the timeline, where a changing speed would move the lattice by seconds × the change)
        ['snow getting heavier (density keyed 0.3 → 1 over the clip)', 'overlay.snow', { size: 0.02, speed: 0.2, density: 0.3 }, { density: [[0, 0.3], [89, 1]] }],
        ['snowflakes growing (size keyed 0.008 → 0.03 over the clip)', 'overlay.snow', { size: 0.008, speed: 0.4, density: 0.8 }, { size: [[0, 0.008], [89, 0.03]] }],
      ];
      const pid = (await call('/projects', { name: 'overlays-flash', width: 640, height: 360 })).body.project.id as string;
      const assetId = await upload(pid, black360);
      for (const [k, [, type, params, keys]] of items.entries()) {
        const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId, start: f(k * 90), duration: f(90), withLinkedAudio: false } }])).results[0].output.clipId as string;
        const { effectId } = await addFx(pid, clipId, type, params);
        const keyOps = Object.entries(keys ?? {}).flatMap(([param, ks]) => ks.map(([at, value]) => ({ op: 'set_effect_keyframe', args: { clipId, effectId, param, time: f(at), value } })));
        if (keyOps.length) await tx(pid, keyOps);
      }
      const reports: Record<string, unknown> = {};
      for (const [k, [name]] of items.entries()) {
        const job = await waitJob((await call(`/projects/${pid}/exports`, { range: { startFrame: k * 90, endFrame: (k + 1) * 90 } })).body.jobId);
        if (job.status !== 'succeeded') { reports[name] = { export: job.status, error: job.error }; check(`${name}: 3-second export`, false, job.error); continue; }
        const file = path.join(art, `flash-${k}.mp4`);
        fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
        const rgba = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
        const size = 640 * 360 * 4, frames = rgba.length / size;
        const an = new FlashAnalyser(FPS);
        for (let i = 0; i < frames; i++) an.push(flashCells(rgba.subarray(i * size, (i + 1) * size), 640, 360));
        const rep = an.report();
        reports[name] = { frames, verdict: rep.verdict, ranges: rep.ranges.slice(0, 3) };
        check(`${name}: the flash analyser passes on its 3-second export (${frames} frames)`, frames === 90 && rep.verdict === 'pass', reports[name]);
      }
      measurements.flash = reports;
    }
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
  }
  const failed = checks.filter((c) => !c.ok);
  const report = {
    generatedAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED',
    profile: { os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none used (Canvas2D effects)' },
    scope: 'overlay.snow, confetti, hearts, bokeh, speed-lines and stylize.date-stamp on the shared compositor: stills, the editor preview and exports, checked against the closed-form model (packages/engine/src/overlays.ts, stamp.ts). Not judged: how they look to a person.',
    measurements, passed: checks.length - failed.length, total: checks.length, checks,
  };
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/overlays-proof.json'), JSON.stringify(report, null, 1) + '\n');
  console.log(`\nOverlays proof ${report.result}: ${report.passed}/${report.total}`);
  if (failed.length) process.exit(1);
}
// run when executed (tsx packages/evals/src/overlays-proof.ts); importing it (overlays-proof.test.ts) only loads the checks
if (/overlays-proof\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) main().catch((e) => { console.error(e); process.exit(1); });
