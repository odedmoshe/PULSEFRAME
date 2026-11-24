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
 * Recorded, not gated: the mean signed error per mode and opacity, bytes 2 off round(exact at α) (those come from α between two
 * 8-bit levels), and hard-light, difference, exclusion, color-dodge and color-burn, whose own 8-bit maths in Chromium is more
 * than 1 off even at opacity 1 (exclusion) or ill-conditioned (dodge, burn).
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
const still = async (pid: string) => { const r = await call(`/projects/${pid}/frame?index=5`); if (r.status !== 200) throw new Error(JSON.stringify(r.body).slice(0, 300)); return rgb(r.body); };
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
  const recorded = Object.fromEntries(['hard-light', 'difference', 'exclusion', 'color-dodge', 'color-burn'].map((m) => [m, { ...summary(below(results.filter((x) => x.mode === m))), atOpacity1: results.find((x) => x.mode === m && x.opacity === 1) }]));
  console.log(`  --   recorded, not gated: ${JSON.stringify(recorded)}`);
  failed = checks.some((c) => !c.ok);
  fs.mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/evidence/opacity-conformance.json'), JSON.stringify({ when: new Date().toISOString(), checks, recorded, results }, null, 1) + '\n');
  function S0(i: number) { const p = Math.floor(i / 3), c = i % 3; return topPx(p % N, Math.floor(p / N))[c]!; }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await s.close();
}
console.log(failed ? 'conformance:opacity FAILED' : `conformance:opacity passed (${checks.length} checks)`);
process.exit(failed ? 1 : 0);
