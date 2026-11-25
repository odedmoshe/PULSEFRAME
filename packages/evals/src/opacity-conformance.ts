/**
 * conformance:opacity: a picture clip's opacity and blend mode through real stills (GET /projects/:id/frame, the render page in
 * headless Chromium: the same evaluate + compositor as preview and export, ADR-0005).
 *
 * Bottom clip: a 256×256 picture whose R is x and G is y; top clip above it: R is y and G is x. One still at scale 1 puts every
 * (backdrop d, source s) byte pair through the composite twice. Each byte is compared with exact compositing, real-valued:
 * (1 − α)·d + α·B(d, s) (W3C Compositing, opaque backdrop), at α itself and at α quantized to the canvas's 8-bit alpha
 * aq = round(255·α)/255, the nearest opacity a Canvas2D buffer holds.
 *
 *  1. Sanity: the bottom clip alone and the top clip at opacity 1 are byte-identical to their files.
 *  2. Normal blend at the 99 opacities 0.01…0.99: every byte within 1 of round(exact at aq). Before the fix (the picture drawn
 *     onto the frame with globalAlpha) 57752 bytes at 44 opacities were 2 off, and the frame was on average 0.49 of a level low.
 *  3. multiply, screen, overlay, soft-light, darken, lighten and add at 14 opacities: the same bound. Before the fix (placed
 *     with globalAlpha into the scratch buffer) multiply, overlay, darken and lighten had bytes 2 off.
 *  4. The dissolve transition (21 frames, so 21 progress values p from the real evaluate, one of them exactly 0.5): between two
 *     clips (the first picture outgoing, the second incoming), every byte within 1 of round(out·(1 − pq) + in·pq),
 *     pq = round(255·p)/255, and a byte that is the same in both pictures unchanged; revealing the second picture over the
 *     first on the track below, the first bound. Before the fix (both pictures drawn with globalAlpha into the mix buffer, 20
 *     frames) 1604 bytes at 6 progress values were 2 off between two clips, and 38096 bytes at 16 when revealing, with the frame
 *     on average 0.44 of a level low.
 * Draft quality (DrawOptions, ADR-0005 amendment of 2026-11-24): drawn only by the player while it plays, so these frames come
 * from the lab page (lab.html?bench=opacity), which draws the same pictures with the same evaluate + drawGraph in the same
 * headless Chromium, once in 'draft' and once in 'full'.
 *  5. Draft, a faded picture with the normal blend at the 99 opacities: every byte within 2 of round(exact at α), the mean
 *     signed error within ±0.1 of a level; the share of bytes 2 off is reported. With multiply … add (14 opacities each) draft
 *     keeps the exact fill: byte-identical to full (the copied form's mean error was up to +0.28 there, add).
 *  6. Draft, the dissolve (between two clips and revealing) at its 21 progress values: the same bounds; and between two clips
 *     a byte that is the same in both pictures unchanged.
 *  7. Draft against full, byte by byte, on all the frames of 5 and 6: at most 2 apart (the amendment's bound). The full frames of
 *     the lab equal the stills of checks 2 to 4 (the same compositor; compared here for the normal blend).
 *  8. The full picture's fill limited to the faded picture's placed box equals the fill of the whole buffer, byte for byte:
 *     9 placements (scaled, moved, half off the frame, larger than it, rotated by 17°, 45°, 90° and −33.3°, at fractional
 *     positions, one with a blend, a blur and a mask after the fade) × 2 opacities × 3 frame sizes (640×360, 360×640, 1920×1080).
 * Recorded, not gated: the mean signed error per mode and opacity, bytes 2 off round(exact at α) (those come from α between two
 * 8-bit levels), hard-light, difference, exclusion, color-dodge and color-burn, whose own 8-bit maths in Chromium is more
 * than 1 off even at opacity 1 (exclusion) or ill-conditioned (dodge, burn), and the dip to black and to white (already within 1
 * at the nearest 8-bit alpha, on average 0.40 and 0.23 of a level low).
 * MEASUREMENTS (checks 9 to 13, opacity-measure.ts, drawn by the product's own evaluate + drawGraph in headless Chromium in the full
 * quality and, separately, in the draft quality): what was left on the old path (globalAlpha) or never measured. Each reports the
 * maximum deviation in 8-bit levels, the mean signed deviation (bias) and the bytes more than 1 level off an exact mix computed
 * in this process from independently recomputed pictures; the tolerances gate regressions and claim nothing new.
 *  9. A title (text clip) at 11 opacities incl. 0, 0.5 and 1, without and with a fade-in half way: against the exact mix of the
 *     title's own opaque rendering over the picture below at the nearest 8-bit alpha; solid, antialiased-edge and outside pixels
 *     apart. A stroked title is recorded, not gated: its stroke shows through its fill by design.
 * 10. Time-effect taps (echo, 2 to 5 taps, decay 0.6 and 0.9, opacities 1, 0.75, 0.5, 0.25; lighten and trail at 1).
 * 11. The zoom transition (between two clips, revealing) at 9 progress values, against the exact mix of the outgoing picture and
 *     the scaled incoming one.
 * 12. The blur dissolve, against the exact mix of the two blurred pictures (the kernel's own blur recipe for both).
 * 13. The punch-in's smear (four quarter-strength scaled copies added), against the mean of the four copies.
 *
 *   pnpm build && pnpm conformance:opacity
 * Writes docs/evidence/opacity-conformance.json. Synthetic pictures only.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import * as T from '@pulseframe/time';
import { startServer } from '@pulseframe/server';
import { evaluate } from '@pulseframe/engine';
import { chromium } from 'playwright';
import { measureAll, openMeasurePage } from './opacity-measure.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const dir = path.join(root, '.artifacts/opacity-conformance');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
if (!fs.existsSync(path.join(root, 'apps/web/dist/render.html'))) throw new Error('web bundle missing: run `pnpm build` first');
const N = 256, R = { num: 30, den: 1 }, f = (n: number) => T.frameTime(n, R);
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(file: string, px: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc(N * (1 + 3 * N));
  for (let y = 0; y < N; y++) { raw[y * (1 + 3 * N)] = 0; for (let x = 0; x < N; x++) raw.set(px(x, y), y * (1 + 3 * N) + 1 + 3 * x); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  return file;
}
const bottomPx = (x: number, y: number): [number, number, number] => [x, y, (x * 7 + y * 13) & 255];
const topPx = (x: number, y: number): [number, number, number] => [y, x, (x * 11 + y * 5) & 255];
const rgb = (b: Buffer) => { const r = execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: b, maxBuffer: 1 << 28 }); if (r.length !== N * N * 3) throw new Error('size'); return r; };
const BL: Record<string, (d: number, s: number) => number> = {
  normal: (_d, s) => s, multiply: (d, s) => d * s, screen: (d, s) => d + s - d * s,
  overlay: (d, s) => (d <= 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)), 'hard-light': (d, s) => (s <= 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d)),
  'soft-light': (d, s) => { if (s <= 0.5) return d - (1 - 2 * s) * d * (1 - d); const D = d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d); return d + (2 * s - 1) * (D - d); },
  darken: Math.min, lighten: Math.max, difference: (d, s) => Math.abs(d - s), exclusion: (d, s) => d + s - 2 * d * s,
  'color-dodge': (d, s) => (d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s))), 'color-burn': (d, s) => (d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s)),
};
const exactOf = (mode: string, a: number, d: number, s: number) => mode === 'add' ? Math.min(255, d + a * s) : 255 * ((1 - a) * (d / 255) + a * BL[mode]!(d / 255, s / 255));

const s = await startServer({ port: 8961, dataDir: path.join(dir, 'data') });
const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
const call = async (p: string, body?: unknown) => { const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any }; };
const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(JSON.stringify(r.body).slice(0, 300)); return r.body; };
const still = async (pid: string, index = 5) => { const r = await call(`/projects/${pid}/frame?index=${index}`); if (r.status !== 200) throw new Error(JSON.stringify(r.body).slice(0, 300)); return rgb(r.body); };
const results: { mode: string; opacity: number; meanSignedError: number; worstAbs: number; bytesOff2: number; meanSignedErrorQ: number; worstAbsQ: number; bytesOff2Q: number; bytesEqualRounded: number; bytes: number }[] = [];
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => { checks.push({ name, ok, detail }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`); };
const GATED = ['multiply', 'screen', 'overlay', 'soft-light', 'darken', 'lighten', 'add'];
let failed = false;
try {
  const pid = (await call('/projects', { name: 'opacity-measure', width: N, height: N })).body.project.id as string;
  const up = async (file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${pid}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
  const bottomId = await up(png(path.join(dir, 'bottom.png'), bottomPx)), topId = await up(png(path.join(dir, 'top.png'), topPx));
  await tx(pid, [{ op: 'add_clip', args: { assetId: bottomId, start: f(0), duration: f(10) } }]);
  const D = await still(pid);
  let dOff = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const e = bottomPx(x, y); for (let c = 0; c < 3; c++) if (D[(y * N + x) * 3 + c] !== e[c]) dOff++; }
  const trackId = (await tx(pid, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId as string;
  const clipId = (await tx(pid, [{ op: 'add_clip', args: { assetId: topId, trackId, start: f(0), duration: f(10) } }])).results[0].output.clipId as string;
  const S = await still(pid);
  let sOff = 0; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const e = topPx(x, y); for (let c = 0; c < 3; c++) if (S[(y * N + x) * 3 + c] !== e[c]) sOff++; }
  check('1. The bottom clip alone and the top clip at opacity 1 are byte-identical to their files', dOff === 0 && sOff === 0, { bottomAloneBytesOff: dOff, topAtOpacity1BytesOff: sOff });
  const all = Array.from({ length: 99 }, (_, i) => (i + 1) / 100).concat([1]);
  const some = [0.01, 0.1, 0.2, 0.25, 0.3, 1 / 3, 0.4, 0.5, 0.6, 2 / 3, 0.75, 0.8, 0.9, 0.99, 1];
  const modes = ['normal', ...GATED, 'hard-light', 'difference', 'exclusion', 'color-dodge', 'color-burn'];
  for (const mode of modes) {
    await tx(pid, [{ op: 'set_clip_blend', args: { clipId, mode } }]);
    for (const a of mode === 'normal' ? all : some) {
      await tx(pid, [{ op: 'set_clip_transform', args: { clipId, transform: { opacity: a } } }]);
      const O = await still(pid);
      const aq = Math.round(255 * a) / 255;
      let worst = 0, worstQ = 0, sum = 0, sumQ = 0, off2 = 0, off2Q = 0, exact = 0;
      for (let i = 0; i < O.length; i++) {
        const e = exactOf(mode, a, D[i]!, S0(i)), eq = exactOf(mode, aq, D[i]!, S0(i));
        const err = O[i]! - e, errQ = O[i]! - eq;
        sum += err; sumQ += errQ; worst = Math.max(worst, Math.abs(err)); worstQ = Math.max(worstQ, Math.abs(errQ));
        if (Math.abs(O[i]! - Math.round(e)) >= 2) off2++;
        if (Math.abs(O[i]! - Math.round(eq)) >= 2) off2Q++;
        if (O[i] === Math.round(e)) exact++;
      }
      const r = { mode, opacity: +a.toFixed(4), meanSignedError: +(sum / O.length).toFixed(4), worstAbs: +worst.toFixed(3), bytesOff2: off2, meanSignedErrorQ: +(sumQ / O.length).toFixed(4), worstAbsQ: +worstQ.toFixed(3), bytesOff2Q: off2Q, bytesEqualRounded: exact, bytes: O.length };
      results.push(r);
    }
  }
  const below = (xs: typeof results) => xs.filter((x) => x.opacity < 1);
  const summary = (xs: typeof results) => ({ opacities: xs.length, bytesOff2AtAq: xs.reduce((t, x) => t + x.bytesOff2Q, 0), opacitiesWithBytesOff2AtAq: xs.filter((x) => x.bytesOff2Q).map((x) => x.opacity), worstAbsAtAq: Math.max(...xs.map((x) => x.worstAbsQ)), meanSignedError: +(xs.reduce((t, x) => t + x.meanSignedError, 0) / xs.length).toFixed(3), bytesOff2AtAlpha: xs.reduce((t, x) => t + x.bytesOff2, 0) });
  const normal = below(results.filter((x) => x.mode === 'normal'));
  check('2. Normal blend, opacities 0.01…0.99: every byte within 1 of round(exact at round(255·α)/255)', normal.length === 99 && normal.every((x) => x.bytesOff2Q === 0), summary(normal));
  const gated = Object.fromEntries(GATED.map((m) => [m, summary(below(results.filter((x) => x.mode === m)))]));
  check(`3. ${GATED.join(', ')} at 14 opacities: every byte within 1 of round(exact at round(255·α)/255)`, GATED.every((m) => gated[m]!.opacities === 14 && gated[m]!.bytesOff2AtAq === 0), gated);
  const recorded: Record<string, unknown> = Object.fromEntries(['hard-light', 'difference', 'exclusion', 'color-dodge', 'color-burn'].map((m) => [m, { ...summary(below(results.filter((x) => x.mode === m))), atOpacity1: results.find((x) => x.mode === m && x.opacity === 1) }]));
  // ---------- 4. transitions: the dissolve (gated) and the dips (recorded) ----------
  const transitions: { type: string; frame: number; progress: number; meanSignedError: number; worstAbs: number; bytesOff2: number; worstAbsQ: number; bytesOff2Q: number; sameValueBytesChanged: number }[] = [];
  for (const [type, reveal] of [['dissolve', false], ['dissolve', true], ['dip-black', false], ['dip-white', false]] as const) {
    const tp = (await call('/projects', { name: `${type}${reveal ? '-reveal' : ''}`, width: N, height: N })).body.project.id as string;
    const upT = async (file: string) => ((await (await fetch(`${s.url}/api/v1/projects/${tp}/assets`, { method: 'POST', headers: { ...h, 'x-filename': path.basename(file) }, body: fs.readFileSync(file) })).json()) as any).assetId as string;
    const A = await upT(path.join(dir, 'bottom.png')), B = await upT(path.join(dir, 'top.png'));
    let inId: string;
    if (!reveal) {
      await tx(tp, [{ op: 'add_clip', args: { assetId: A, start: f(0), duration: f(30) } }]);
      inId = (await tx(tp, [{ op: 'add_clip', args: { assetId: B, start: f(30), duration: f(30) } }])).results[0].output.clipId;
    } else {
      await tx(tp, [{ op: 'add_clip', args: { assetId: A, start: f(0), duration: f(60) } }]);
      const tr = (await tx(tp, [{ op: 'add_track', args: { kind: 'video' } }])).results[0].output.trackId;
      inId = (await tx(tp, [{ op: 'add_clip', args: { assetId: B, trackId: tr, start: f(30), duration: f(30) } }])).results[0].output.clipId;
    }
    await tx(tp, [{ op: 'set_transition', args: { clipId: inId, type, frames: 21 } }]);
    const doc = (await call(`/projects/${tp}`)).body.project;
    for (let F = 30; F < 51; F++) {
      const layer = evaluate(doc, f(F)).layers.find((l) => l.kind !== 'caption' && l.kind !== 'adjust' && l.transition?.role === 'in');
      if (!layer || layer.kind === 'caption' || layer.kind === 'adjust') throw new Error(`${type}: no incoming layer at frame ${F}`);
      const p = layer.transition!.progress;
      // weights of the first picture (outgoing, or below), of the second (incoming) and of the dip colour, at progress w
      const weights = (quantized: boolean) => {
        const q8 = (x: number) => (quantized ? Math.round(255 * x) / 255 : x);
        if (type === 'dissolve') return { wa: 1 - q8(p), wb: q8(p), wc: 0 };
        const q = q8(p < 0.5 ? 2 * p : 2 * (1 - p));
        return p < 0.5 ? { wa: 1 - q, wb: 0, wc: q } : { wa: 0, wb: 1 - q, wc: q };
      };
      const c = type === 'dip-white' ? 255 : 0, ex = weights(false), eq = weights(true);
      const O = await still(tp, F);
      let worst = 0, worstQ = 0, sum = 0, off2 = 0, off2Q = 0, same = 0;
      for (let i = 0; i < O.length; i++) {
        const a = D[i]!, b = S0(i), e = ex.wa * a + ex.wb * b + ex.wc * c, e2 = eq.wa * a + eq.wb * b + eq.wc * c;
        sum += O[i]! - e; worst = Math.max(worst, Math.abs(O[i]! - e)); worstQ = Math.max(worstQ, Math.abs(O[i]! - e2));
        if (Math.abs(O[i]! - Math.round(e)) >= 2) off2++;
        if (Math.abs(O[i]! - Math.round(e2)) >= 2) off2Q++;
        if (type === 'dissolve' && a === b && O[i] !== a) same++;
      }
      transitions.push({ type: reveal ? 'dissolve (reveal over the track below)' : type, frame: F, progress: +p.toFixed(4), meanSignedError: +(sum / O.length).toFixed(3), worstAbs: +worst.toFixed(3), bytesOff2: off2, worstAbsQ: +worstQ.toFixed(3), bytesOff2Q: off2Q, sameValueBytesChanged: same });
    }
  }
  const tsum = (t: string) => { const xs = transitions.filter((x) => x.type === t); return { progressValues: xs.length, bytesOff2AtPq: xs.reduce((u, x) => u + x.bytesOff2Q, 0), progressWithBytesOff2AtPq: xs.filter((x) => x.bytesOff2Q).map((x) => x.progress), worstAbsAtPq: Math.max(...xs.map((x) => x.worstAbsQ)), meanSignedError: +(xs.reduce((u, x) => u + x.meanSignedError, 0) / xs.length).toFixed(3), bytesOff2AtP: xs.reduce((u, x) => u + x.bytesOff2, 0), sameValueBytesChanged: xs.reduce((u, x) => u + x.sameValueBytesChanged, 0), atHalf: xs.find((x) => x.progress === 0.5) ?? null }; };
  const dissolves = { dissolve: tsum('dissolve'), 'dissolve (reveal over the track below)': tsum('dissolve (reveal over the track below)') };
  check('4. Dissolve at 21 progress values (one of them 0.5), between two clips and revealing over the track below: every byte within 1 of round(exact at round(255·p)/255); between two clips a byte that is the same in both pictures is unchanged', Object.values(dissolves).every((x) => x.progressValues === 21 && x.bytesOff2AtPq === 0 && x.atHalf !== null) && dissolves.dissolve.sameValueBytesChanged === 0, dissolves);
  Object.assign(recorded, { 'dip-black': tsum('dip-black'), 'dip-white': tsum('dip-white') });
  // ---------- 5–8. draft quality and the fill area, in the lab page ----------
  const browser = await chromium.launch();
  let draft: Record<string, unknown> = {};
  try {
    const page = await browser.newPage();
    await page.goto(`${s.url}/lab.html?bench=opacity`);
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    const frame = async (kind: string, value: number, quality: 'draft' | 'full') => {
      const r = await page.evaluate(([k, v, q]) => (window as unknown as { __pfLabOpacity: { frame(k: string, v: number, q: string): Promise<{ rgb: string; progress?: number }> } }).__pfLabOpacity.frame(k, v, q), [kind, value, quality] as [string, number, string]);
      return { rgb: Buffer.from(r.rgb, 'base64'), progress: r.progress };
    };
    type Stat = { n: number; sum: number; worst: number; off2: number; off3: number; same: number; draftVsFullWorst: number; draftVsFullSum: number; fullVsStill?: number };
    const stat = (): Stat => ({ n: 0, sum: 0, worst: 0, off2: 0, off3: 0, same: 0, draftVsFullWorst: 0, draftVsFullSum: 0 });
    const add = (st: Stat, O: Buffer, F: Buffer, exact: (i: number) => number, sameCheck: boolean) => {
      for (let i = 0; i < O.length; i++) {
        const e = exact(i), d = Math.abs(O[i]! - Math.round(e));
        st.n++; st.sum += O[i]! - e; st.worst = Math.max(st.worst, d); if (d >= 2) st.off2++; if (d >= 3) st.off3++;
        if (sameCheck && D[i] === S0(i) && O[i] !== D[i]) st.same++;
        const df = Math.abs(O[i]! - F[i]!); st.draftVsFullWorst = Math.max(st.draftVsFullWorst, df); st.draftVsFullSum += df;
      }
    };
    const fin = (st: Stat) => ({ bytes: st.n, worstOffRounded: st.worst, meanSignedError: +(st.sum / st.n).toFixed(4), shareOff2: +(st.off2 / st.n).toFixed(5), bytesOff3: st.off3, draftVsFullWorst: st.draftVsFullWorst, draftVsFullMeanAbs: +(st.draftVsFullSum / st.n).toFixed(4), ...(st.same ? { sameValueBytesChanged: st.same } : {}) });
    const opacityStats: Record<string, ReturnType<typeof fin>> = {};
    let labFullVsStill = 0;
    for (const mode of ['normal', ...GATED]) {
      const st = stat();
      for (const a of mode === 'normal' ? all.slice(0, 99) : some.slice(0, 14)) {
        const d = await frame(`opacity:${mode}`, a, 'draft'), fu = await frame(`opacity:${mode}`, a, 'full');
        add(st, d.rgb, fu.rgb, (i) => exactOf(mode, a, D[i]!, S0(i)), false);
      }
      opacityStats[mode] = fin(st);
    }
    // the lab's full picture is the still's: compare one opacity byte for byte
    { await tx(pid, [{ op: 'set_clip_blend', args: { clipId, mode: 'normal' } }, { op: 'set_clip_transform', args: { clipId, transform: { opacity: 0.37 } } }]); const st = await still(pid); const lab = (await frame('opacity:normal', 0.37, 'full')).rgb; for (let i = 0; i < st.length; i++) if (st[i] !== lab[i]) labFullVsStill++; }
    const dissolveStats: Record<string, ReturnType<typeof fin>> = {};
    for (const kind of ['dissolve', 'dissolve-reveal']) {
      const st = stat();
      for (let F = 30; F < 51; F++) {
        const d = await frame(kind, F, 'draft'), fu = await frame(kind, F, 'full');
        const p = d.progress!;
        add(st, d.rgb, fu.rgb, (i) => D[i]! * (1 - p) + S0(i) * p, kind === 'dissolve');
      }
      dissolveStats[kind] = fin(st);
    }
    const n5 = opacityStats.normal!, blended = GATED.map((m) => opacityStats[m]!);
    check('5. Draft, a faded picture: normal blend at 99 opacities every byte within 2 of round(exact at α), mean signed error within ±0.1; with multiply … add (14 opacities each) byte-identical to full', n5.worstOffRounded <= 2 && Math.abs(n5.meanSignedError) <= 0.1 && blended.every((x) => x.draftVsFullWorst === 0), opacityStats);
    check('6. Draft, the dissolve at 21 progress values (between two clips, revealing): every byte within 2 of round(exact at p), mean within ±0.1; between two clips same-value bytes unchanged', Object.values(dissolveStats).every((x) => x.worstOffRounded <= 2 && Math.abs(x.meanSignedError) <= 0.1) && !('sameValueBytesChanged' in dissolveStats.dissolve!), dissolveStats);
    const vsFull = [...Object.values(opacityStats), ...Object.values(dissolveStats)];
    check('7. Draft against full on all those frames: at most 2 apart byte by byte; the lab\'s full frame equals the still (normal blend, opacity 0.37)', vsFull.every((x) => x.draftVsFullWorst <= 2) && labFullVsStill === 0, { worst: Math.max(...vsFull.map((x) => x.draftVsFullWorst)), labFullVsStillBytesDiffering: labFullVsStill });
    const areas = await page.evaluate(() => (window as unknown as { __pfLabOpacity: { fadeArea(): Promise<{ placement: string; size: string; bytes: number; differing: number; filledShare: number }[]> } }).__pfLabOpacity.fadeArea());
    check(`8. The fill limited to the faded picture's placed box equals the fill of the whole buffer byte for byte (${areas.length} drawings: 9 placements × 2 opacities × 3 frame sizes)`, areas.length === 54 && areas.every((x) => x.differing === 0), { differingBytes: areas.reduce((u, x) => u + x.differing, 0), comparedBytes: areas.reduce((u, x) => u + x.bytes, 0), drawings: areas });
    draft = { opacity: opacityStats, dissolve: dissolveStats, fadeArea: areas };
  } finally { await browser.close(); }
  // ---------- 9–13. measurements (opacity-measure.ts) ----------
  let measurements: Record<string, unknown> = {};
  {
    const mBrowser = await chromium.launch();
    try {
      const mPage = await mBrowser.newPage();
      await openMeasurePage(mPage, root);
      const mm = await measureAll(mPage);
      for (const c of mm.checks) check(c.name, c.ok, c.detail);
      measurements = { ...mm.evidence, above2Levels: mm.above2 };
      console.log(`  --   measurements took ${mm.seconds} s; cases above 2 levels (a stroked title's fill is by design): ${mm.above2.length}`);
    } finally { await mBrowser.close(); }
  }
  console.log(`  --   recorded, not gated: ${JSON.stringify(recorded)}`);
  failed = checks.some((c) => !c.ok);
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/opacity-conformance.json'), JSON.stringify({ when: new Date().toISOString(), checks, recorded, results, transitions, draft, measurements }, null, 1) + '\n');
  function S0(i: number) { const p = Math.floor(i / 3), c = i % 3; return topPx(p % N, Math.floor(p / N))[c]!; }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await s.close();
}
console.log(failed ? 'conformance:opacity FAILED' : `conformance:opacity passed (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
