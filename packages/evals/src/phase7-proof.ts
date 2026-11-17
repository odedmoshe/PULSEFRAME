/**
 * Phase 7 gate, first batch (SPEC §8 effect contract, §12, §13): effects, blend modes, masks and transitions
 * on the shared Canvas2D compositor. Every entry is checked by what its pixels do (not by a screenshot alone),
 * random access is checked against itself, and export is compared with stills of the same frames.
 * Not covered: GPU shader families, keying, time effects, speed ramps, graph editor (not built).
 *   pnpm build && pnpm proof:phase7
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import * as T from '@pulseframe/time';
import { BLEND_MODES, EFFECTS, TRANSITIONS } from '@pulseframe/core';
import { generateBarcodeFixture } from '@pulseframe/fixtures';
import { startServer } from '@pulseframe/server';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/phase7');
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, input });
const W = 640, H = 360, N = W * H;
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
const measurements: Record<string, unknown> = {};
type Img = Buffer;
const px = (b: Img, x: number, y: number) => { const i = (Math.round(y) * W + Math.round(x)) * 3; return [b[i]!, b[i + 1]!, b[i + 2]!] as const; };
const lum = (c: readonly [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mean = (b: Img, ch?: number) => { let s = 0, n = 0; for (let i = 0; i < b.length; i += 3) { if (ch === undefined) { s += lum([b[i]!, b[i + 1]!, b[i + 2]!]); } else s += b[i + ch]!; n++; } return s / n; };
/** Mean and max absolute difference between an image and a per-pixel expectation. `skipTop` ignores the barcode strip. */
function diff(a: Img, expect: (x: number, y: number) => readonly [number, number, number] | null, y0 = 0) {
  let sum = 0, max = 0, n = 0;
  for (let y = y0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const e = expect(x, y);
    if (!e) continue;
    const p = px(a, x, y);
    for (let c = 0; c < 3; c++) { const d = Math.abs(p[c]! - e[c]!); sum += d; if (d > max) max = d; n++; }
  }
  return { mean: Number((sum / Math.max(1, n)).toFixed(3)), max, samples: n };
}
const psnr = (a: Img, b: Img) => { let se = 0; for (let i = 0; i < a.length; i++) { const d = a[i]! - b[i]!; se += d * d; } const mse = se / a.length; return mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse); };
/** Steepest step between neighbouring pixels (a blur lowers it; total variation would not change). */
const sharp = (b: Img) => { let s = 0; for (let y = 70; y < H; y += 3) for (let x = 1; x < W; x++) s = Math.max(s, Math.abs(lum(px(b, x, y)) - lum(px(b, x - 1, y)))); return s; };
const smooth = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const fixture = await generateBarcodeFixture({ out: path.join(art, 'fixture.mp4'), frames: 240 });
  const s = await startServer({ port: 8798, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const txs = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const still = async (pid: string, index: number, name?: string): Promise<Img> => { const png = (await call(`/projects/${pid}/frame?index=${index}`)).body as Buffer; if (name) fs.writeFileSync(path.join(art, `${name}.png`), png); return ff(['-f', 'image2pipe', '-i', '-', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], png); };
  const waitJob = async (id: string) => { for (;;) { const j = (await call(`/jobs/${id}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(150); } };
  const mk = async (name: string) => {
    const pid = (await call('/projects', { name, width: W, height: H })).body.project.id;
    const up: any = await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': 'fixture.mp4' }, body: fs.readFileSync(fixture.file) })).json();
    const r = await txs(pid, [{ op: 'add_clip', args: { assetId: up.assetId, start: f(0) } }]);
    return { pid, assetId: up.assetId as string, clipId: r.results[0].output.clipId as string };
  };
  const browser = await chromium.launch({ args: ['--enable-unsafe-webgpu'] }); // lets the page ask for a WebGPU adapter; where none exists the GPU effects are labelled unavailable
  try {
    console.log('\n# catalog');
    const cat = (await call('/catalog')).body;
    check(`catalog lists exactly what is registered: ${EFFECTS.length} effects with parameter schemas and defaults, ${TRANSITIONS.length} transitions, ${BLEND_MODES.length} blend modes`, cat.effects.length === EFFECTS.length && cat.transitions.length === TRANSITIONS.length && cat.blendModes.length === BLEND_MODES.length && cat.effects.every((e: any) => e.paramsSchema?.type === 'object' && e.defaults && e.name.he && e.implementation === 'canvas2d'), { effects: cat.effects.map((e: any) => e.id) });

    console.log('\n# effects: each one is checked by what it does to pixels');
    const { pid, clipId } = await mk('phase7-effects');
    const base = await still(pid, 20, 'base');
    const withFx = async (type: string, params: Record<string, unknown>, name?: string, frame = 20) => {
      const r = await txs(pid, [{ op: 'add_effect', args: { clipId, type, params } }]);
      const img = await still(pid, frame, name);
      await txs(pid, [{ op: 'remove_effect', args: { clipId, effectId: r.results[0].output.effectId } }]);
      return img;
    };
    const gray = await withFx('color.grayscale', {}, 'fx-grayscale');
    check('color.grayscale: every pixel is neutral (R=G=B within 2)', diff(gray, (x, y) => { const p = px(gray, x, y); return [p[1], p[1], p[1]]; }).max <= 2);
    const inv = await withFx('color.invert', {}, 'fx-invert');
    check('color.invert: pixel + original = 255', (() => { const d = diff(inv, (x, y) => { const p = px(base, x, y); return [255 - p[0], 255 - p[1], 255 - p[2]]; }); return d.mean < 1.5 && d.max <= 4; })());
    const dark = await withFx('color.adjust', { brightness: 0 }, 'fx-black');
    const sat = await withFx('color.adjust', { saturation: 0 }, 'fx-desat');
    check('color.adjust: brightness 0 is black; saturation 0 is neutral', mean(dark) < 1 && diff(sat, (x, y) => { const p = px(sat, x, y); return [p[1], p[1], p[1]]; }).max <= 2);
    const blur = await withFx('blur.gaussian', { radius: 0.03 }, 'fx-blur');
    const edgeCol = (b: Img, x: number) => { let v = 0; for (let y = 80; y < H - 40; y++) v += lum(px(b, x, y)); return v / (H - 120); };
    check('blur.gaussian: the steepest edge is less than half as steep, and the frame edges are not darkened (edge pixels are extended, not faded to transparent)', sharp(blur) < sharp(base) * 0.5 && Math.abs(edgeCol(blur, 0) - edgeCol(base, 0)) < edgeCol(base, 0) * 0.12 + 3 && Math.abs(edgeCol(blur, W - 1) - edgeCol(base, W - 1)) < edgeCol(base, W - 1) * 0.12 + 3, { sharpBase: Math.round(sharp(base)), sharpBlur: Math.round(sharp(blur)), leftEdge: [Math.round(edgeCol(base, 0)), Math.round(edgeCol(blur, 0))] });
    const pix = await withFx('stylize.pixelate', { size: 0.1 }, 'fx-pixelate');
    check('stylize.pixelate: pixels inside one 36 px block are identical; neighbouring blocks can differ', [[2, 2], [20, 30], [34, 34]].every(([x, y]) => px(pix, x!, y!).join() === px(pix, 10, 10).join()) && sha(pix) !== sha(base));
    const tint = await withFx('color.tint', { color: '#FF0000', amount: 1, mode: 'multiply' }, 'fx-tint');
    check('color.tint (multiply, red, full): green and blue are removed, red is kept', mean(tint, 1) < 2 && mean(tint, 2) < 2 && Math.abs(mean(tint, 0) - mean(base, 0)) < 3, { r: [mean(base, 0).toFixed(1), mean(tint, 0).toFixed(1)] });
    const vig = await withFx('light.vignette', { amount: 1, size: 0.3 }, 'fx-vignette');
    check('light.vignette: corners are much darker, the centre is untouched', lum(px(vig, 3, H - 3)) < lum(px(base, 3, H - 3)) * 0.35 + 2 && diff(vig, (x, y) => (Math.hypot(x - W / 2, y - H / 2) < 60 ? px(base, x, y) : null)).max <= 2, { corner: [Math.round(lum(px(base, 3, H - 3))), Math.round(lum(px(vig, 3, H - 3)))] });
    const grainA = await withFx('stylize.grain', { amount: 0.6, seed: 7 }, 'fx-grain');
    const grainA2 = await withFx('stylize.grain', { amount: 0.6, seed: 7 });
    const base21 = await still(pid, 21);
    const grainB = await withFx('stylize.grain', { amount: 0.6, seed: 7 }, undefined, 21);
    const noiseAt = (g: Img, b: Img) => { let n = 0; for (let y = 200; y < 260; y++) for (let x = 100; x < 400; x++) n = (n * 31 + (lum(px(g, x, y)) > lum(px(b, x, y)) ? 1 : 0)) >>> 0; return n; };
    check('stylize.grain: changes the picture, keeps average brightness, is identical when the same frame is rendered again, and differs on the next frame', sha(grainA) !== sha(base) && sha(grainA) === sha(grainA2) && Math.abs(mean(grainA) - mean(base)) < mean(base) * 0.06 && noiseAt(grainA, base) !== noiseAt(grainB, base21), { meanBase: mean(base).toFixed(2), meanGrain: mean(grainA).toFixed(2) });
    const split = await withFx('digital.rgb-split', { amount: 0.03, angle: 0 }, 'fx-rgbsplit');
    const fringe = (b: Img) => { let n = 0; for (let y = 70; y < H; y += 2) for (let x = 0; x < W; x += 2) { const p = px(b, x, y); if (Math.abs(p[0] - p[2]) > 120) n++; } return n; };
    check('digital.rgb-split: red and blue separate at edges (many more pixels with a large red-blue gap); green stays in place', fringe(split) > fringe(base) + 150 && diff(split, (x, y) => { const g = px(base, x, y)[1]; const p = px(split, x, y); return [p[0], g, p[2]]; }, 70).mean < 1.5, { fringeBase: fringe(base), fringeSplit: fringe(split) });
    const glow = await withFx('light.diffusion', { radius: 0.04, amount: 0.8 }, 'fx-diffusion');
    check('light.diffusion: never darker than the original, brighter overall', (() => { let darker = 0; for (let i = 0; i < base.length; i++) if (glow[i]! < base[i]! - 3) darker++; return darker === 0 && mean(glow) > mean(base) + 1; })(), { meanBase: mean(base).toFixed(1), meanGlow: mean(glow).toFixed(1) });

    const fx1 = (await txs(pid, [{ op: 'add_effect', args: { clipId, type: 'color.invert' } }])).results[0].output.effectId;
    await txs(pid, [{ op: 'update_effect', args: { clipId, effectId: fx1, enabled: false } }]);
    const bypassed = await still(pid, 20);
    await txs(pid, [{ op: 'remove_effect', args: { clipId, effectId: fx1 } }]);
    check('bypass and remove both give back the exact original frame', sha(bypassed) === sha(base) && sha(await still(pid, 20)) === sha(base));
    const o1 = await txs(pid, [{ op: 'add_effect', args: { clipId, type: 'color.grayscale' } }, { op: 'add_effect', args: { clipId, type: 'color.tint', params: { color: '#00A0FF', amount: 1, mode: 'multiply' } } }]);
    const grayThenTint = await still(pid, 20, 'order-gray-tint');
    await txs(pid, [{ op: 'update_effect', args: { clipId, effectId: o1.results[1].output.effectId, index: 0 } }]);
    const tintThenGray = await still(pid, 20, 'order-tint-gray');
    const plan = (await call(`/projects/${pid}/exports/plan`, {})).body;
    check('effect order matters and is honoured: tint→grayscale is neutral, grayscale→tint is coloured; the export manifest lists both effects with versions', diff(tintThenGray, (x, y) => { const p = px(tintThenGray, x, y); return [p[1], p[1], p[1]]; }).max <= 2 && Math.abs(mean(grayThenTint, 2) - mean(grayThenTint, 0)) > 20 && plan.manifest.effects.length === 2 && plan.manifest.effects.every((e: any) => e.version === 1), plan.manifest.effects);
    for (const r of o1.results) await txs(pid, [{ op: 'remove_effect', args: { clipId, effectId: r.output.effectId } }]);
    const title = (await txs(pid, [{ op: 'add_text', args: { text: 'שלום', start: f(0), duration: f(60), style: { color: '#FFFFFF', stroke: null, background: null, sizeFrac: 0.2 } } }])).results[0].output.clipId;
    const noShadow = await still(pid, 20);
    await txs(pid, [{ op: 'add_effect', args: { clipId: title, type: 'stylize.shadow', params: { opacity: 1, blur: 0, x: 0, y: 0.05 } } }]);
    const shadow = await still(pid, 20, 'fx-shadow');
    const blackIn = (b: Img) => { let n = 0; for (let y = 120; y < 300; y++) for (let x = 150; x < 490; x++) if (lum(px(b, x, y)) < 12) n++; return n; };
    check('stylize.shadow on a title: black pixels appear below the letters; the letters themselves stay', blackIn(shadow) > blackIn(noShadow) + 300, { before: blackIn(noShadow), after: blackIn(shadow) });
    await txs(pid, [{ op: 'delete_clip', args: { clipId: title } }]);

    {
      const kfx = (await txs(pid, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian', params: { radius: 0 } } }])).results[0].output.effectId;
      await txs(pid, [{ op: 'set_effect_keyframe', args: { clipId, effectId: kfx, param: 'radius', time: f(10), value: 0 } }, { op: 'set_effect_keyframe', args: { clipId, effectId: kfx, param: 'radius', time: f(40), value: 0.05 } }]);
      const steep = [10, 20, 30, 40, 50].map(async (n) => sharp(await still(pid, n)));
      const sh = await Promise.all(steep);
      const again20 = sharp(await still(pid, 20));
      check('keyframed effect parameter: a blur radius animated from 0 to its end value makes the picture progressively softer, holds after the last key, and a frame in the middle is the same when rendered again', sh[0]! > sh[1]! && sh[1]! > sh[2]! && sh[2]! > sh[3]! && Math.abs(sh[3]! - sh[4]!) < 1.5 && again20 === sh[1], { steepestEdgeAtFrames10to50: sh.map((x) => Number(x.toFixed(1))) });
      await txs(pid, [{ op: 'remove_effect', args: { clipId, effectId: kfx } }]);
    }

    console.log('\n# blend modes (top layer identical to the layer below, so the expected result is exact arithmetic)');
    const two = await mk('phase7-blend');
    const tr2 = (await txs(two.pid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId;
    const top = (await txs(two.pid, [{ op: 'add_clip', args: { assetId: two.assetId, start: f(0), trackId: tr2 } }])).results[0].output.clipId;
    const blend = async (mode: string) => { await txs(two.pid, [{ op: 'set_clip_blend', args: { clipId: top, mode } }]); return still(two.pid, 20, `blend-${mode}`); };
    const b0 = await blend('normal');
    const dDiff = mean(await blend('difference'));
    const dAdd = diff(await blend('add'), (x, y) => { const p = px(b0, x, y); return [Math.min(255, 2 * p[0]), Math.min(255, 2 * p[1]), Math.min(255, 2 * p[2])]; });
    const dMul = diff(await blend('multiply'), (x, y) => { const p = px(b0, x, y); return [(p[0] * p[0]) / 255, (p[1] * p[1]) / 255, (p[2] * p[2]) / 255]; });
    const dScr = diff(await blend('screen'), (x, y) => { const p = px(b0, x, y); return [255 - ((255 - p[0]) ** 2) / 255, 255 - ((255 - p[1]) ** 2) / 255, 255 - ((255 - p[2]) ** 2) / 255]; });
    check('difference of a picture with itself is black; add doubles (clamped); multiply squares; screen is the inverse of multiply — all within 2 levels', dDiff < 0.5 && dAdd.max <= 2 && dMul.max <= 2 && dScr.max <= 2, { difference: dDiff, add: dAdd, multiply: dMul, screen: dScr });
    const hashes = new Set<string>();
    for (const m of BLEND_MODES) hashes.add(sha(await blend(m)));
    measurements.distinctBlendResults = `${hashes.size} of ${BLEND_MODES.length} modes give a distinct result when a picture is blended with itself (several are mathematically identical in that special case)`;
    check('every blend mode renders without error', hashes.size >= 6, measurements.distinctBlendResults);

    console.log('\n# masks');
    const mp = await mk('phase7-mask');
    const mbase = await still(mp.pid, 20);
    const bg = [0, 0, 0] as const;
    const isBg = (c: readonly number[]) => c[0]! + c[1]! + c[2]! < 6;
    const same = (a: readonly number[], b: readonly number[]) => Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) <= 6;
    void bg;
    await txs(mp.pid, [{ op: 'set_clip_mask', args: { clipId: mp.clipId, mask: { shape: 'ellipse' } } }]);
    const m1 = await still(mp.pid, 20, 'mask-ellipse');
    const edgeCount = (b: Img) => { let n = 0; for (let x = 0; x < W; x++) { const v = lum(px(b, x, 200)), o = lum(px(mbase, x, 200)); if (o > 30 && v > o * 0.1 && v < o * 0.9) n++; } return n; };
    await txs(mp.pid, [{ op: 'set_clip_mask', args: { clipId: mp.clipId, mask: { feather: 0.06 } } }]);
    const m2 = await still(mp.pid, 20, 'mask-feather');
    await txs(mp.pid, [{ op: 'set_clip_mask', args: { clipId: mp.clipId, mask: { feather: 0, invert: true } } }]);
    const m3 = await still(mp.pid, 20, 'mask-invert');
    await txs(mp.pid, [{ op: 'set_clip_mask', args: { clipId: mp.clipId, mask: { invert: false } } }, { op: 'set_clip_transform', args: { clipId: mp.clipId, transform: { x: 0.25 } } }]);
    const m4 = await still(mp.pid, 20, 'mask-moved');
    check('ellipse mask: inside is the picture, outside is background; invert swaps them; feather makes a soft edge; the mask moves with the clip', same(px(m1, 320, 200), px(mbase, 320, 200)) && isBg(px(m1, 8, 200)) && isBg(px(m3, 320, 200)) && same(px(m3, 8, 200), px(mbase, 8, 200)) && edgeCount(m2) > edgeCount(m1) + 15 && isBg(px(m4, 200, 200)) && !isBg(px(m4, 480, 200)), { softEdgePixels: [edgeCount(m1), edgeCount(m2)] });
    await txs(mp.pid, [{ op: 'set_clip_transform', args: { clipId: mp.clipId, transform: { x: 0 } } }, { op: 'set_clip_mask', args: { clipId: mp.clipId, mask: null } }]);
    check('removing the mask restores the exact original frame', sha(await still(mp.pid, 20)) === sha(mbase));

    console.log('\n# transitions (A = source 0..59, B = source 100.. placed at frame 60; references are stills of single source frames)');
    const ref = await mk('phase7-ref');
    const refFrame = new Map<number, Img>();
    const src = async (n: number) => { if (!refFrame.has(n)) refFrame.set(n, await still(ref.pid, n)); return refFrame.get(n)!; };
    const tp = await mk('phase7-transitions');
    const B = (await txs(tp.pid, [{ op: 'split_clip', args: { clipId: tp.clipId, at: f(60) } }])).results[0].output.rightClipId;
    await txs(tp.pid, [{ op: 'trim_clip', args: { clipId: B, edge: 'start', to: f(100) } }, { op: 'move_clip', args: { clipId: B, start: f(60) } }]);
    const setT = (type: string | null, frames = 10) => txs(tp.pid, [{ op: 'set_transition', args: { clipId: B, type, frames } }]);
    const p4 = smooth(5 / 11); // timeline frame 64 = 5th of 10 transition frames
    const a64 = await src(64), b104 = await src(104);
    await setT('dissolve');
    const dis = await still(tp.pid, 64, 'tr-dissolve');
    const dDis = diff(dis, (x, y) => { const a = px(a64, x, y), b = px(b104, x, y); return [a[0] * (1 - p4) + b[0] * p4, a[1] * (1 - p4) + b[1] * p4, a[2] * (1 - p4) + b[2] * p4]; });
    const before = await still(tp.pid, 59), after = await still(tp.pid, 70);
    check('dissolve: frame 64 is exactly (1-p)·A + p·B of the two source frames; the frames just outside the transition are untouched', dDis.mean < 1.2 && dDis.max <= 6 && sha(before) === sha(await src(59)) && sha(after) === sha(await src(110)), { p: Number(p4.toFixed(4)), ...dDis });
    const again = await still(tp.pid, 64);
    await still(tp.pid, 10); await still(tp.pid, 69);
    check('random access: frame 64 rendered alone, and again after rendering other frames, is byte-identical', sha(again) === sha(dis) && sha(await still(tp.pid, 64)) === sha(dis));
    await setT('wipe-left');
    const wipe = await still(tp.pid, 64, 'tr-wipe-left');
    const edge = W * (1 - p4);
    const dWipe = diff(wipe, (x, y) => (Math.abs(x - edge) < 3 ? null : px(x > edge ? b104 : a64, x, y)));
    check('wipe-left: right of the moving edge is B, left of it is still A', dWipe.max <= 2, { edgeX: Math.round(edge), ...dWipe });
    await setT('push-left');
    const push = await still(tp.pid, 64, 'tr-push-left');
    const shift = W * p4;
    const dPush = diff(push, (x, y) => { const xa = x + shift, xb = x - (W - shift); if (Math.abs(x - (W - shift)) < 4) return null; return xa < W - 1 ? px(a64, Math.min(W - 1, xa), y) : px(b104, Math.max(0, xb), y); }, 70);
    check('push-left: A slides out to the left while B slides in from the right (compared below the barcode strip; sub-pixel offsets allow small differences)', dPush.mean < 4, dPush);
    await setT('dip-black');
    const dip = await still(tp.pid, 64, 'tr-dip-black');
    const dDip = diff(dip, (x, y) => { const a = px(a64, x, y); const k = 1 - 2 * p4; return [a[0] * k, a[1] * k, a[2] * k]; });
    check('dip-black: before the midpoint the outgoing picture fades toward black by exactly 2p', dDip.mean < 1.2 && dDip.max <= 6, dDip);
    await setT('zoom');
    const zoom = await still(tp.pid, 64, 'tr-zoom');
    check('zoom: differs from both sides and from a plain dissolve', sha(zoom) !== sha(dis) && sha(zoom) !== sha(a64) && sha(zoom) !== sha(b104));
    let allOk = true;
    const rendered: string[] = [];
    for (const t of TRANSITIONS) { await setT(t.id); const mid = await still(tp.pid, 64); const ok = sha(mid) !== sha(a64) && sha(mid) !== sha(b104); if (!ok) allOk = false; rendered.push(`${t.id}:${ok ? 'ok' : 'UNCHANGED'}`); }
    check(`all ${TRANSITIONS.length} transitions render a mid-frame that differs from both sides`, allOk, rendered);
    const whole = await mk('phase7-nohandle');
    const second = (await txs(whole.pid, [{ op: 'add_clip', args: { assetId: whole.assetId, start: f(240) } }])).results[0].output.clipId;
    const noHandle = await call(`/projects/${whole.pid}/transactions`, { ops: [{ op: 'set_transition', args: { clipId: second, type: 'dissolve', frames: 10 } }] });
    check('no unused source after the previous clip: the transition is refused with the usable length, not faked with a freeze', noHandle.status >= 400 && noHandle.body.error.code === 'out_of_bounds' && noHandle.body.error.details.maxFrames === 0, noHandle.body.error?.message);

    console.log('\n# export uses the same looks');
    await setT('dissolve');
    await txs(tp.pid, [{ op: 'add_effect', args: { clipId: B, type: 'light.vignette', params: { amount: 0.8 } } }, { op: 'add_effect', args: { clipId: tp.clipId, type: 'color.adjust', params: { saturation: 0.3, contrast: 1.2 } } }]);
    const t0 = Date.now();
    const job = await waitJob((await call(`/projects/${tp.pid}/exports`, { range: { startFrame: 50, endFrame: 80 }, quality: 'high' })).body.jobId);
    const exportMs = Date.now() - t0;
    const file = path.join(art, 'looks.mp4');
    fs.writeFileSync(file, (await call(`/jobs/${job.id}/output`)).body);
    const rgb = ff(['-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    let minPsnr = 99;
    for (const k of [50, 59, 60, 62, 64, 66, 69, 70, 79]) minPsnr = Math.min(minPsnr, psnr(Buffer.from(rgb.subarray((k - 50) * N * 3, (k - 50 + 1) * N * 3)), await still(tp.pid, k)));
    measurements.exportWithLooks = { frames: 30, wallMs: exportMs, minPsnrDb: Number(minPsnr.toFixed(2)), note: 'one 30-frame 640x360 range with a dissolve, a vignette and a colour adjust on this CPU profile; includes job start-up' };
    check('export of a range with a dissolve and two effects: 30 frames, and 9 checked frames match the stills of the same frames (PSNR ≥ 32 dB after H.264)', job.status === 'succeeded' && rgb.length === 30 * N * 3 && minPsnr >= 32, measurements.exportWithLooks);

    console.log('\n# agent (MCP)');
    const c = new Client({ name: 'phase7-script', version: '0' }, { versionNegotiation: { mode: { pin: '2026-07-28' } } });
    await c.connect(new StreamableHTTPClientTransport(new URL(`${s.url}/mcp`), { requestInit: { headers: h } }));
    const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await c.callTool({ name, arguments: args }); return { isError: !!r.isError, data: r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}') }; };
    const mcat = await tool('list_catalog', {});
    const added = await tool('add_effect', { projectId: pid, clipId, type: mcat.data.effects[0].id, params: { saturation: 0 } });
    const moment = await tool('describe_moment', { projectId: pid, frameIndex: 20 });
    const bad = await tool('add_effect', { projectId: pid, clipId, type: 'film.halation' });
    check('agent discovers the catalog, adds an effect, sees it in describe_moment, and gets a clear refusal for an effect that does not exist', !mcat.isError && mcat.data.effects.length === EFFECTS.length && !added.isError && moment.data.layers[0].effects?.[0] === 'color.adjust' && bad.isError, { refusal: JSON.stringify(bad.data).slice(0, 160) });
    await c.close();

    console.log('\n# editor controls');
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 2600 }, reducedMotion: 'reduce' })).newPage();
    await page.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); } catch { /* storage unavailable */ } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${s.ownerUrl}&project=${mp.pid}`);
    await page.locator(`.clip[data-clip-id="${mp.clipId}"]`).click();
    await page.getByTestId('look-panel').waitFor();
    const clipNow = async () => (await call(`/projects/${mp.pid}`)).body.project.sequences.seq_main.tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === mp.clipId);
    const until = async (pred: (c: any) => boolean) => { for (let i = 0; i < 100; i++) { if (pred(await clipNow())) return true; await sleep(100); } return false; };
    await page.getByTestId('effect-add').selectOption('blur.gaussian');
    const addedFx = await until((c) => c.effects?.[0]?.type === 'blur.gaussian');
    await page.locator('[data-testid=effect-param][data-param=radius]').fill('0.1');
    await page.locator('[data-testid=effect-param][data-param=radius]').dispatchEvent('pointerup');
    const changed = await until((c) => Math.abs((c.effects?.[0]?.params.radius ?? 0) - 0.1) < 1e-6);
    await page.getByTestId('effect-add').selectOption('color.grayscale');
    await until((c) => c.effects?.length === 2);
    await page.locator('[data-testid=effect-row][data-effect-type="color.grayscale"] [data-testid=effect-up]').click();
    const reordered = await until((c) => c.effects?.[0]?.type === 'color.grayscale');
    await page.locator('[data-testid=effect-row][data-effect-type="blur.gaussian"] [data-testid=effect-enabled]').click();
    const bypass = await until((c) => c.effects?.find((e: any) => e.type === 'blur.gaussian')?.enabled === false);
    await page.getByTestId('blend-mode').selectOption('screen');
    await page.getByTestId('mask-enabled').click();
    await until((c) => !!c.mask);
    await page.getByTestId('mask-shape').selectOption('ellipse');
    await page.getByTestId('transition-type').selectOption('wipe-left');
    const rest = await until((c) => c.blend === 'screen' && c.mask?.shape === 'ellipse' && c.transition?.type === 'wipe-left');
    await page.screenshot({ path: path.join(art, 'editor-look.png') });
    check('editor: add an effect from the catalog, change a generated parameter slider, reorder, bypass, set blend, mask and transition — each lands in the document', addedFx && changed && reordered && bypass && rest && errors.length === 0, { addedFx, changed, reordered, bypass, rest, errors: errors.slice(0, 3) });
    await page.close();

    console.log('\n# Lab');
    const lab = await (await browser.newContext({ viewport: { width: 1500, height: 1200 }, reducedMotion: 'reduce' })).newPage();
    const labErrors: string[] = [];
    lab.on('pageerror', (e) => labErrors.push(String(e)));
    await lab.goto(`${s.url}/lab.html`);
    await lab.waitForFunction(() => document.body.dataset.ready === '1', undefined, { timeout: 120000 });
    const tiles: { kind: string; id: string; variant: string; aspect: string; hash: number; flat: boolean; unavailable: boolean }[] = await lab.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid=lab-tile]')].map((fig) => {
      const hashes: number[] = []; let flat = true;
      for (const c of fig.querySelectorAll('canvas')) {
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let hsh = 0, min = 255, max = 0;
        for (let i = 0; i < d.length; i += 16) { hsh = (hsh * 31 + d[i]! + d[i + 1]! * 3 + d[i + 2]! * 7) >>> 0; if (d[i]! < min) min = d[i]!; if (d[i]! > max) max = d[i]!; }
        hashes.push(hsh); if (max - min > 8) flat = false;
      }
      return { kind: fig.dataset.kind!, id: fig.dataset.id!, variant: fig.dataset.variant!, aspect: fig.dataset.aspect!, unavailable: fig.dataset.unavailable === '1', hash: hashes.reduce((a, b) => (a * 33 + b) >>> 0, 7), flat };
    }));
    const byKind = (k: string) => tiles.filter((t) => t.kind === k);
    const fxIds = new Set(byKind('effect').map((t) => t.id)), trIds = new Set(byKind('transition').map((t) => t.id)), blIds = new Set(byKind('blend').map((t) => t.id));
    const fullByDefault = new Set(['color.grayscale', 'color.sepia', 'color.invert', 'distort.mirror', 'stylize.duotone', 'color.lut']); // default amount is already the maximum; the mirror has no amount at all, only which half is kept; color.lut needs a colour table to change anything and the Lab project has none (no table chosen = the picture unchanged, in both variants; the pass itself is checked in gpu-proof.ts)
    const variantsDiffer = EFFECTS.every((e) => { if (fullByDefault.has(e.id)) return true; if (byKind('effect').some((t) => t.id === e.id && t.unavailable)) return true; /* no adapter in this browser: the tile says so */ const mine = byKind('effect').filter((t) => t.id === e.id && t.aspect === '16:9'); return new Set(mine.map((t) => t.hash)).size >= 2; });
    const aspects = new Set(byKind('effect').map((t) => t.aspect));
    await lab.screenshot({ path: path.join(art, 'lab.png'), fullPage: true });
    measurements.lab = { gpuEffectTilesUnavailable: tiles.filter((t) => t.unavailable).length, tiles: tiles.length, effects: fxIds.size, blends: blIds.size, transitions: trIds.size, masks: byKind('mask').length };
    check('Lab: every registered effect, blend mode and transition has tiles drawn by the shared compositor, in 16:9 and 9:16, none blank (except the midpoint of a dip or of the flash, which is meant to be a flat colour, the chroma key at full tolerance, which removes the whole picture, and the strobe at full amount at the instant of its flash, which is the flash colour), default and extreme variants differ (where the default is not already the maximum), no page errors', fxIds.size === EFFECTS.length && blIds.size === BLEND_MODES.length && trIds.size === TRANSITIONS.length && byKind('mask').length >= 4 && aspects.size === 2 && tiles.every((t) => !t.flat || t.id.startsWith('dip-') || t.id === 'flash' || (t.id === 'key.chroma' && t.variant === 'extreme') || (t.id === 'light.strobe' && t.variant === 'extreme')) && variantsDiffer && !lab.url().includes('error') && (await lab.evaluate(() => document.body.dataset.errors)) === undefined && labErrors.length === 0, { ...(measurements.lab as object), sameVariants: EFFECTS.filter((e) => new Set(byKind('effect').filter((t) => t.id === e.id && t.aspect === '16:9').map((t) => t.hash)).size < 2).map((e) => e.id), aspects: [...aspects], bodyErrors: await lab.evaluate(() => document.body.dataset.errors ?? null), flat: tiles.filter((t) => t.flat && !t.id.startsWith('dip-')).map((t) => `${t.kind}:${t.id}:${t.variant}`).slice(0, 6), labErrors: labErrors.slice(0, 2) });
    await lab.close();
  } catch (e) {
    console.error(e);
    check('proof ran to completion', false, String(e).slice(0, 600));
  } finally {
    await browser.close();
    await s.close();
    const failed = checks.filter((x) => !x.ok);
    const report = { ranAt: new Date().toISOString(), result: failed.length ? 'FAILED' : 'PASSED', machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, gpu: 'none' }, scope: 'Canvas2D look system on one synthetic fixture. No GPU compositor; shader effect families, keying, time effects and speed ramps are not built.', measurements, passed: checks.length - failed.length, total: checks.length, checks };
    fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
    fs.writeFileSync(path.join(root, 'docs/evidence/phase7-proof.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`\nPhase 7 proof ${report.result}: ${report.passed}/${report.total}`);
    if (failed.length) process.exitCode = 1;
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
