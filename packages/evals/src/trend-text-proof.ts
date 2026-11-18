/**
 * Trend pack (ADR-0012): the title look fields, the blur and write-on animations and the ten new text styles (X1–X10).
 *
 *   pnpm build && pnpm proof:trend-text
 *
 * Everything is rendered through the server API and its render worker (stills and exports, ADR-0005), at 1080×1920, with
 * no graphics adapter involved: every look is Canvas2D, no project here uses a GPU effect, and the editor is opened in a
 * browser without WebGPU. The render worker is started as trend-baseline.ts starts it (PF_RENDER_GPU unset), so its
 * text pictures can be compared with the recorded baseline.
 * - X1  the 40 text styles from before the pack and the two 'classic-outline' stills of docs/evidence/trend-baseline.json
 *       are byte-identical (pixel hashes); the text part only, so this proof does not depend on the transition workers.
 * - X2  for each look field, and for the blur and write-on entrances: a title at rest after its entrance is byte-identical
 *       to the same title without animation.
 * - X3  measured: second outline ring widths, gradient ends, glow fall-off, extrusion growth and shading, long shadow
 *       growth (edges at half coverage, with a control one pixel short), colour and gaps, tracking width, niqqud with
 *       tracking, and an Arabic line unchanged by tracking.
 * - X4  blur-in sharpens (Sobel edge energy never falls); write-on starts in the rightmost letter of a Hebrew title and in
 *       the leftmost of an English one, and its ink never shrinks.
 * - X5  during a rise with a gradient, every letter keeps the colours it has at rest.
 * - X6  five looks: the paused editor preview is byte-identical to the worker's still; the exported frame is the still as
 *       the export's format carries it: H.264 4:2:0, BT.709, limited range, and PSNR ≥ 50 dB in each of its Y, U and V
 *       planes against the still converted to those planes. Controls: another style's still, and the same title without
 *       its look, are below that. (The RGB PSNR against the still is recorded with what 4:2:0 alone leaves of it: it
 *       measures the colour detail of the picture, not the export; see the note at X6.)
 * - X7  exports of every new style with blur-in and write-on, at the default length and at one frame: the flash check passes.
 * - X8  time per decorated title per frame (server still minus a plain title's), stated where it is over 25 ms.
 * - X9  'letterSpacing' in the canvas context: in the editor's browser, and in the render worker (a tracked still is
 *       delivered and wider; without letterSpacing the worker refuses it as unavailable).
 * - X10 keyboard only, in the inspector: glow on commits update_text and one undo restores the title; in a format view the
 *       same key commits set_variant_override and leaves the master alone.
 * Writes docs/evidence/trend-text-proof.json. Exits 1 when a check fails.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import * as T from '@pulseframe/time';
import { TEXT_PRESETS } from '@pulseframe/core';
import { FlashAnalyser, flashCells } from '@pulseframe/engine';
import { startServer } from '@pulseframe/server';
import { chooseFormat } from './editor-ui.ts';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/trend-text');
const evidence = path.join(root, 'docs/evidence/trend-text-proof.json');
const baselineFile = path.join(root, 'docs/evidence/trend-baseline.json');
const PORT = 8893;
const W = 1080, H = 1920;
const R30 = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R30);
const SAMPLE = 'שָׁלוֹם עולם 2026';
const NEW_PRESETS = TEXT_PRESETS.slice(40).map((p) => p.id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const checks: { id: string; name: string; ok: boolean; detail?: unknown }[] = [];
const check = (id: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, name, ok, ...(detail !== undefined ? { detail } : {}) }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${id} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 400)}` : ''}`); };
const measurements: Record<string, unknown> = {};

// ---------------------------------------------------------------- pictures
interface Img { w: number; h: number; d: Buffer }
const rgbaOfPng = (png: Buffer, w = W, h = H): Img => ({ w, h, d: ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png) });
/** SHA-256 of the decoded RGBA pixels (as trend-baseline.ts hashes). */
const pixelHash = (img: Img) => sha(img.d);
const idx = (m: Img, x: number, y: number) => (y * m.w + x) * 4;
const px = (m: Img, x: number, y: number) => { const i = idx(m, x, y); return [m.d[i]!, m.d[i + 1]!, m.d[i + 2]!]; };
const inked = (m: Img, x: number, y: number, t = 40) => { const i = idx(m, x, y); return Math.max(m.d[i]!, m.d[i + 1]!, m.d[i + 2]!) > t; };
function inkBox(m: Img, pred: (x: number, y: number) => boolean = (x, y) => inked(m, x, y, 24)) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (pred(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1 };
}
/** Runs of columns with ink, separated by at least `gap` empty columns. */
function columnRuns(m: Img, pred: (x: number, y: number) => boolean = (x, y) => inked(m, x, y), gap = 2): [number, number][] {
  const col = Array.from({ length: m.w }, (_, x) => { for (let y = 0; y < m.h; y++) if (pred(x, y)) return true; return false; });
  const runs: [number, number][] = [];
  let start = -1, last = -10;
  for (let x = 0; x < m.w; x++) if (col[x]) { if (start < 0 || x - last > gap) { if (start >= 0) runs.push([start, last]); start = x; } last = x; }
  if (start >= 0) runs.push([start, last]);
  return runs;
}
const inkArea = (m: Img) => { let n = 0; for (let i = 0; i < m.d.length; i += 4) if (Math.max(m.d[i]!, m.d[i + 1]!, m.d[i + 2]!) > 40) n++; return n; };
function sobelEnergy(m: Img): number {
  const L = new Float32Array(m.w * m.h);
  for (let i = 0, k = 0; i < m.d.length; i += 4, k++) L[k] = 0.299 * m.d[i]! + 0.587 * m.d[i + 1]! + 0.114 * m.d[i + 2]!;
  let e = 0;
  for (let y = 1; y < m.h - 1; y++) for (let x = 1; x < m.w - 1; x++) {
    const k = y * m.w + x, a = L[k - m.w - 1]!, b = L[k - m.w]!, c = L[k - m.w + 1]!, d = L[k - 1]!, g = L[k + 1]!, p = L[k + m.w - 1]!, q = L[k + m.w]!, r = L[k + m.w + 1]!;
    const gx = c + 2 * g + r - a - 2 * d - p, gy = p + 2 * q + r - a - 2 * b - c;
    e += gx * gx + gy * gy;
  }
  return e;
}
function psnr(a: Img, b: Img): number {
  let s = 0, n = 0;
  for (let i = 0; i < a.d.length; i += 4) for (let j = 0; j < 3; j++) { const e = a.d[i + j]! - b.d[i + j]!; s += e * e; n++; }
  return s === 0 ? Infinity : 10 * Math.log10((255 * 255) / (s / n));
}
/**
 * Where a profile of coverage (one value 0…1 per column or row: the largest in it) falls through one half, coming from its
 * far end: the outer edge of the ink to a fraction of a pixel (between pixel centres). An edge found this way is at the
 * same coverage whatever the colour of the ink, which a brightness threshold is not: a pixel a quarter covered is brighter
 * than 24/255 in a white letter and darker than that in a shadow of colour #203040.
 */
function farEdge(profile: ArrayLike<number>): number {
  for (let i = profile.length - 1; i >= 0; i--) if (profile[i]! >= 0.5) { const next = i + 1 < profile.length ? profile[i + 1]! : 0; return i + 0.5 + (profile[i]! - 0.5) / (profile[i]! - next); }
  return NaN;
}
/** The largest coverage in every column and in every row of a picture. */
function coverageProfiles(m: Img, coverage: (i: number) => number) {
  const cols = new Float64Array(m.w), rows = new Float64Array(m.h);
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const c = coverage((y * m.w + x) * 4); if (c > cols[x]!) cols[x] = c; if (c > rows[y]!) rows[y] = c; }
  return { cols, rows };
}
/**
 * The export's picture format (apps/server export.ts): H.264 yuv420p, BT.709, limited range. `planesOfRgba` is a picture as
 * that format carries it (its Y plane, then U and V at half the size each way), by the conversion the export declares.
 */
const EXPORT_FORMAT = { pixFmt: 'yuv420p', range: 'tv', matrix: 'bt709' };
const TO_EXPORT_PLANES = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p';
const planesOfRgba = (rgba: Buffer, w = W, h = H) => ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${w}x${h}`, '-i', 'pipe:0', '-vf', TO_EXPORT_PLANES, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], rgba);
/** Those planes shown again as RGB the way this proof decodes an export (ffmpeg's default conversion): what 4:2:0 alone leaves of a picture, no encoder involved. */
const rgbaOfPlanes = (planes: Buffer, w = W, h = H) => ff(['-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-video_size', `${w}x${h}`, '-i', 'pipe:0', '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgba', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], planes);
/** PSNR of each plane of two yuv420p pictures, and the least of the three (a plane without any difference: 99). */
function planePsnr(a: Buffer, b: Buffer, w = W, h = H) {
  const n = w * h, q = (w / 2) * (h / 2);
  if (a.length !== n + 2 * q || b.length !== n + 2 * q) return { y: 0, u: 0, v: 0, min: 0 };
  const db = (from: number, len: number) => { let s = 0; for (let i = from; i < from + len; i++) { const e = a[i]! - b[i]!; s += e * e; } return s === 0 ? 99 : Number((10 * Math.log10((255 * 255) / (s / len))).toFixed(2)); };
  const y = db(0, n), u = db(n, q), v = db(n + q, q);
  return { y, u, v, min: Math.min(y, u, v) };
}
const maxDiff = (a: Img, b: Img) => { let m = 0; for (let i = 0; i < a.d.length; i++) m = Math.max(m, Math.abs(a.d[i]! - b.d[i]!)); return m; };

async function previewRgba(page: Page): Promise<Img | null> {
  const got: string = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
    if (!c) return '';
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return `${c.width}x${c.height}:${btoa(s)}`;
  });
  if (!got) return null;
  const [size, data] = got.split(':');
  const [w, h] = size!.split('x').map(Number);
  return { w: w!, h: h!, d: Buffer.from(data!, 'base64') };
}

async function main() {
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8')) as { commit: string; text: Record<string, string | { refused: string }> };

  delete process.env.PF_RENDER_GPU; // as trend-baseline.ts: the worker that recorded the baseline
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const h = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 400)}`); return r.body; };
  const project = async (name: string) => (await call('/projects', { name, width: W, height: H })).body.project.id as string;
  const addTitle = async (pid: string, text: string, start: number, frames: number) => (await tx(pid, [{ op: 'add_text', args: { text, start: f(start), duration: f(frames) } }])).results[0].output.clipId as string;
  /** A still: the decoded picture, or the worker's refusal. */
  const still = async (pid: string, index: number): Promise<Img> => {
    const r = await call(`/projects/${pid}/frame?index=${index}`);
    if (r.status !== 200 || !Buffer.isBuffer(r.body)) throw Object.assign(new Error(`still ${index} refused: ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`), { refusal: r.body });
    return rgbaOfPng(r.body);
  };
  const waitJob = async (jobId: string) => { for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(250); } };
  const exportFile = async (pid: string, name: string): Promise<string | { error: unknown }> => {
    const j = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    if (j.status !== 'succeeded') return { error: { status: j.status, error: j.error } };
    const out = path.join(art, name);
    fs.writeFileSync(out, (await call(`/jobs/${j.id}/output`)).body);
    return out;
  };
  const style = (pid: string, clipId: string, st: Record<string, unknown>) => tx(pid, [{ op: 'update_text', args: { clipId, style: st } }]);
  const preset = (pid: string, clipId: string, presetId: string) => tx(pid, [{ op: 'apply_text_preset', args: { clipId, presetId } }]);
  const animate = (pid: string, clipId: string, animation: unknown) => tx(pid, [{ op: 'set_text_animation', args: { clipId, animation } }]);
  const BASE = { fontFamily: 'Heebo', fontWeight: 700, color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0 };
  const started = Date.now();
  const lap = (what: string) => console.log(`  … ${what} (${((Date.now() - started) / 1000).toFixed(0)} s)`);

  const browser = await chromium.launch(); // no WebGPU flags: the editor has no graphics adapter
  try {
    // ======================================================== X1: the text part of the trend baseline
    console.log('\n# X1 the text styles from before the pack, against docs/evidence/trend-baseline.json');
    {
      const pid = await project('x1 legacy titles');
      const title = await addTitle(pid, SAMPLE, 0, 60);
      const differ: string[] = [];
      let compared = 0;
      for (const [key, recorded] of Object.entries(baseline.text)) {
        if (typeof recorded !== 'string') { differ.push(`${key}: recorded as refused`); continue; }
        let now: string;
        if (key.startsWith('classic-outline+')) {
          await preset(pid, title, 'classic-outline');
          await animate(pid, title, key.includes('rise') ? { in: 'rise', by: 'word', inFrames: 20 } : null);
          now = pixelHash(await still(pid, 40));
        } else {
          await animate(pid, title, null);
          await preset(pid, title, key);
          now = pixelHash(await still(pid, 10));
        }
        compared++;
        if (now !== recorded) differ.push(key);
      }
      measurements.x1 = { baselineCommit: baseline.commit, compared, differ };
      check('X1', `the ${compared} text stills of the trend baseline (40 legacy styles and the two classic-outline stills) are byte-identical`, compared === 42 && differ.length === 0, measurements.x1);
      // the ten new styles render (recorded for later comparison; their looks are measured below)
      const fresh: Record<string, string> = {};
      for (const id of NEW_PRESETS) { await preset(pid, title, id); fresh[id] = pixelHash(await still(pid, 10)); }
      measurements.newStyleHashes = fresh;
      check('X1', 'the ten new styles each render a still, all different', new Set(Object.values(fresh)).size === NEW_PRESETS.length && NEW_PRESETS.length === 10);
      lap('X1');
    }

    // ======================================================== X2: at rest an animated title is the still title
    console.log('\n# X2 a title at rest after its entrance is the title without animation');
    const LOOKS: Record<string, unknown> = {
      gradient: { colors: ['#FFD166', '#EF476F'], angle: 90 }, tracking: 0.2, stroke2: { color: '#111111', widthFrac: 0.06 },
      glow: { color: '#FF2BD6', radiusFrac: 0.4, intensity: 0.9 }, extrude: { color: '#3A0CA3', depthFrac: 0.15, angle: 45, shade: 0.5 }, longShadow: { color: '#0000004D', lengthFrac: 1.5, angle: 45 },
    };
    {
      const pid = await project('x2 at rest');
      const title = await addTitle(pid, SAMPLE, 0, 60);
      const rows: { look: string; entrance: string; same: boolean }[] = [];
      for (const look of ['none', ...Object.keys(LOOKS)]) {
        await preset(pid, title, 'classic-outline');
        if (look !== 'none') await style(pid, title, { [look]: LOOKS[look] });
        await animate(pid, title, null);
        const plain = pixelHash(await still(pid, 40));
        for (const entrance of ['blur', 'write']) {
          await animate(pid, title, { in: entrance, by: 'letter', inFrames: 20 });
          rows.push({ look, entrance, same: pixelHash(await still(pid, 40)) === plain });
        }
      }
      measurements.x2 = rows;
      check('X2', 'for each look field (and none), with the blur and the write-on entrance by letter: at frame 40 (at rest) the still is byte-identical to the title without animation', rows.length === 14 && rows.every((r) => r.same), rows.filter((r) => !r.same));
      lap('X2');
    }

    // ======================================================== X3: measurements
    console.log('\n# X3 the looks, measured');
    const x3: Record<string, unknown> = {};
    const solo = async (name: string, text: string, st: Record<string, unknown>) => { const pid = await project(name); const clip = await addTitle(pid, text, 0, 30); await style(pid, clip, st); return { pid, clip }; };
    const PX = 0.2 * H; // font size of the measured titles, px
    /** The fill of a white title: the stem of ו, its rows and its middle on a scan row 65% down its ink. */
    const stemRow = (m: Img, isFill: (x: number, y: number) => boolean) => {
      const b = inkBox(m, isFill);
      const y = Math.round(b.y0 + 0.65 * (b.y1 - b.y0));
      let a = -1, z = -1;
      for (let x = 0; x < m.w; x++) if (isFill(x, y)) { if (a < 0) a = x; z = x; }
      return { y, a, z, mid: Math.round((a + z) / 2), box: b };
    };
    {
      // second outline: white letter, red outline (strokeFrac 0.08), blue second outline (widthFrac 0.06)
      const { pid } = await solo('x3 stroke2', 'ו', { ...BASE, sizeFrac: 0.2, stroke: '#FF0000', strokeFrac: 0.08, stroke2: { color: '#0000FF', widthFrac: 0.06 } });
      const m = await still(pid, 0);
      const st = stemRow(m, (x, y) => m.d[idx(m, x, y) + 1]! > 128); // green comes only from the white fill
      const ring = (from: number, to: number) => { let red = 0, blue = 0; for (let x = from; x < to; x++) { const [r, g, b] = px(m, x, st.y); red += (r! - g!) / 255; blue += (b! - g!) / 255; } return { red: Number(red.toFixed(2)), blue: Number(blue.toFixed(2)) }; };
      const left = ring(0, st.mid), right = ring(st.mid, m.w);
      const want = { red: Number((0.08 * PX).toFixed(2)), blue: Number((0.06 * PX).toFixed(2)) };
      x3.stroke2 = { scanRow: st.y, left, right, expected: want };
      check('X3', 'stroke2: on a scanline through the stem of ו the outline ring is strokeFrac·px and the second ring widthFrac·px wide, ±1 px, on both sides', [left, right].every((r) => Math.abs(r.red - want.red) <= 1 && Math.abs(r.blue - want.blue) <= 1), x3.stroke2);
    }
    {
      // gradient at 90°: the top and bottom ink rows carry the two stops; the rows between move monotonically from one to the other
      const stops = [[255, 209, 102], [58, 91, 255]];
      const g = await solo('x3 gradient', 'שלום', { ...BASE, sizeFrac: 0.2, gradient: { colors: ['#FFD166', '#3A5BFF'], angle: 90 } });
      const twin = await solo('x3 gradient twin', 'שלום', { ...BASE, sizeFrac: 0.2 });
      const m = await still(g.pid, 0), t = await still(twin.pid, 0);
      const rows: { y: number; c: number[] }[] = [];
      for (let y = 0; y < H; y++) {
        let n = 0; const sum = [0, 0, 0];
        for (let x = 0; x < W; x++) if (t.d[idx(t, x, y)]! >= 254) { n++; const c = px(m, x, y); for (let j = 0; j < 3; j++) sum[j]! += c[j]!; }
        if (n) rows.push({ y, c: sum.map((v) => v / n) });
      }
      const top = rows[0]!, bottom = rows.at(-1)!;
      const near = (c: number[], s: number[]) => c.every((v, j) => Math.abs(v - s[j]!) <= 3);
      let backwards = 0;
      for (let i = 1; i < rows.length; i++) for (let j = 0; j < 3; j++) { const dir = Math.sign(stops[1]![j]! - stops[0]![j]!), step = rows[i]!.c[j]! - rows[i - 1]!.c[j]!; if (dir !== 0 && step * dir < -1) backwards++; }
      x3.gradient = { topRow: top.y, top: top.c.map((v) => Number(v.toFixed(1))), bottomRow: bottom.y, bottom: bottom.c.map((v) => Number(v.toFixed(1))), stops, rowsMeasured: rows.length, stepsAgainstTheDirection: backwards };
      check('X3', 'gradient 90°: the top and bottom ink rows (fully covered pixels) are within 3/255 of the two stops, and every row between moves toward the bottom stop', near(top.c, stops[0]!) && near(bottom.c, stops[1]!) && backwards === 0, x3.gradient);
    }
    {
      // glow: white ו with a cyan glow, radius 0.15 font sizes (R = 57.6 px), intensity 0.9: the light left of the stem
      const R = 0.15 * PX;
      const { pid } = await solo('x3 glow', 'ו', { ...BASE, sizeFrac: 0.2, glow: { color: '#00E5FF', radiusFrac: 0.15, intensity: 0.9 } });
      const m = await still(pid, 0);
      const st = stemRow(m, (x, y) => m.d[idx(m, x, y)]! > 128); // red comes only from the white letter
      const profile = Array.from({ length: Math.ceil(2.2 * R) }, (_, d) => (st.a - 1 - d >= 0 ? m.d[idx(m, st.a - 1 - d, st.y) + 2]! : 0)); // blue, d+1 px from the edge
      const rises = profile.filter((v, i) => i > 0 && v > profile[i - 1]! + 1).length;
      const atHalf = profile[Math.round(R / 2) - 1]!, beyond = Math.max(...profile.slice(Math.ceil(1.6 * R) - 1));
      x3.glow = { R: Number(R.toFixed(1)), scanRow: st.y, edgeX: st.a, atHalfR: atHalf, maxBeyond16R: beyond, risesAlongTheProfile: rises, profileEvery8px: profile.filter((_, i) => i % 8 === 0) };
      check('X3', 'glow: from the letter\'s edge the light falls monotonically (±1), is above 8/255 at R/2 and at most 2/255 beyond 1.6R', rises === 0 && atHalf > 8 && beyond <= 2, x3.glow);
    }
    {
      // extrusion: depth 0.1 font sizes toward 45°, shade 0.6
      const depth = 0.1 * PX, dx = depth * Math.SQRT1_2;
      const e = await solo('x3 extrude', 'ו', { ...BASE, sizeFrac: 0.2, extrude: { color: '#C86432', depthFrac: 0.1, angle: 45, shade: 0.6 } });
      const twin = await solo('x3 extrude twin', 'ו', { ...BASE, sizeFrac: 0.2 });
      const m = await still(e.pid, 0), t = await still(twin.pid, 0);
      const a = inkBox(t), b = inkBox(m);
      const grow = { left: a.x0 - b.x0, top: a.y0 - b.y0, right: b.x1 - a.x1, bottom: b.y1 - a.y1 };
      // the side, walked from the stem's right edge along the extrusion: it gets darker with depth
      const st = stemRow(m, (x, y) => { const [r, g, bl] = px(m, x, y); return r! > 245 && g! > 245 && bl! > 245; });
      const side: number[] = [];
      for (let k = 1; k < depth * 2; k++) { const x = st.z + k, y = st.y + k; if (x >= W || y >= H) break; const [r, g, bl] = px(m, x, y); if (Math.max(r!, g!, bl!) < 24) break; if (!(r! > 245 && g! > 245 && bl! > 245)) side.push(r!); }
      const brighter = side.filter((v, i) => i > 0 && v > side[i - 1]! + 1).length;
      x3.extrude = { depthPx: Number(depth.toFixed(1)), expectedGrowth: Number(dx.toFixed(2)), grow, sideRed: side.filter((_, i) => i % 4 === 0), brighterSteps: brighter };
      check('X3', 'extrude: the ink box grows by depth·(cos, sin) toward 45° (±1 px) and not elsewhere; the side darkens monotonically with depth', Math.abs(grow.right - dx) <= 1 && Math.abs(grow.bottom - dx) <= 1 && Math.abs(grow.left) <= 1 && Math.abs(grow.top) <= 1 && brighter === 0 && side.length > 5 && side[0]! - side.at(-1)! > 20, x3.extrude);
    }
    {
      // long shadow: opaque #203040, 0.8 font sizes toward 45°
      const L = 0.8 * PX, dx = L * Math.SQRT1_2, C = [0x20, 0x30, 0x40];
      const ls = await solo('x3 long shadow', 'ו', { ...BASE, sizeFrac: 0.2, longShadow: { color: '#203040', lengthFrac: 0.8, angle: 45 } });
      const twin = await solo('x3 long shadow twin', 'ו', { ...BASE, sizeFrac: 0.2 });
      const m = await still(ls.pid, 0), t = await still(twin.pid, 0);
      const a = inkBox(t);
      // The growth toward the shadow: the far edges of the ink at half coverage, of the letter in the twin (white: red/255)
      // and of the shadow in the title (the colour's blue is 64: blue/64, the letter itself counting as covered). Up and to
      // the left nothing may be added at all: there the boxes of everything that is not black are compared.
      const lit = (im: Img) => (x: number, y: number) => { const i = idx(im, x, y); return Math.max(im.d[i]!, im.d[i + 1]!, im.d[i + 2]!) > 3; };
      const reach = (im: Img, coverage: (i: number) => number) => { const p = coverageProfiles(im, coverage); return { right: farEdge(p.cols), bottom: farEdge(p.rows) }; };
      const shadowed = (im: Img) => reach(im, (i) => Math.min(1, im.d[i + 2]! / C[2]!));
      const letter = reach(t, (i) => t.d[i]! / 255), far = shadowed(m), la = inkBox(t, lit(t)), lb = inkBox(m, lit(m));
      const grow = { left: la.x0 - lb.x0, top: la.y0 - lb.y0, right: Number((far.right - letter.right).toFixed(2)), bottom: Number((far.bottom - letter.bottom).toFixed(2)) };
      const b = lb;
      const kind = (x: number, y: number) => { const [r, g, bl] = px(m, x, y); if (r === C[0] && g === C[1] && bl === C[2]) return 'shadow'; if (Math.max(r!, g!, bl!) <= 3) return 'black'; if (r! > 245 && g! > 245 && bl! > 245) return 'text'; return 'edge'; };
      let exact = 0, inner = 0;
      // a pixel that is neither the colour, the letter nor the background must be an edge: within 2 px of the background or the letter
      const nearEdge = (x: number, y: number) => { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= W || Y >= H) return true; const q = kind(X, Y); if (q === 'black' || q === 'text') return true; } return false; };
      for (let y = Math.max(0, b.y0); y <= Math.min(H - 1, b.y1); y++) for (let x = Math.max(0, b.x0); x <= Math.min(W - 1, b.x1); x++) {
        const k = kind(x, y);
        if (k === 'shadow') exact++;
        else if (k === 'edge' && !nearEdge(x, y)) inner++;
      }
      // no gap: along the shadow's direction from every letter pixel, nothing of the background lies between two shadow pixels
      let gaps = 0, walks = 0;
      for (let y = a.y0; y <= a.y1; y += 3) for (let x = a.x0; x <= a.x1; x += 3) {
        if (kind(x, y) !== 'text') continue;
        walks++;
        let seenShadow = false, holeAfterShadow = false;
        for (let k = 1; k < dx + 4; k++) { const X = x + k, Y = y + k; if (X >= W || Y >= H) break; const q = kind(X, Y); if (q === 'shadow') { if (holeAfterShadow) { gaps++; break; } seenShadow = true; } else if (q === 'black' && seenShadow) holeAfterShadow = true; }
      }
      const within = (g: { left: number; top: number; right: number; bottom: number }) => Math.abs(g.right - dx) <= 1 && Math.abs(g.bottom - dx) <= 1 && Math.abs(g.left) <= 1 && Math.abs(g.top) <= 1;
      x3.longShadow = { lengthPx: Number(L.toFixed(1)), expectedGrowth: Number(dx.toFixed(2)), grow, edges: 'right and bottom: where the largest coverage of a column or row falls through one half (letter: red/255; shadow: blue/64), to a fraction of a pixel; left and top: the box of everything brighter than 3/255', exactColourPixels: exact, notTheColourInside: inner, walks, gaps };
      check('X3', 'longShadow: the ink grows by L toward 45° (±1 px, the edges of the letter and of the shadow taken at the same coverage, one half) and not at all up or left; every shadow pixel off the edges is exactly the colour; 0 gaps along its direction', within(grow) && inner === 0 && exact > 10000 && gaps === 0 && walks > 50, x3.longShadow);
      // control: the same title with a shadow one pixel shorter along each axis must fall outside the ±1 px of L
      const shortFrac = (dx - 1) / Math.SQRT1_2 / PX;
      const short = await solo('x3 long shadow one pixel short', 'ו', { ...BASE, sizeFrac: 0.2, longShadow: { color: '#203040', lengthFrac: shortFrac, angle: 45 } });
      const ms = await still(short.pid, 0), farShort = shadowed(ms), lc = inkBox(ms, lit(ms));
      const growShort = { left: la.x0 - lc.x0, top: la.y0 - lc.y0, right: Number((farShort.right - letter.right).toFixed(2)), bottom: Number((farShort.bottom - letter.bottom).toFixed(2)) };
      x3.longShadowOnePixelShort = { lengthFrac: Number(shortFrac.toFixed(5)), lengthPx: Number((shortFrac * PX).toFixed(2)), perAxisPx: Number((shortFrac * PX * Math.SQRT1_2).toFixed(2)), grow: growShort, expectedGrowthOfTheFullLength: Number(dx.toFixed(2)) };
      check('X3', 'longShadow control: the same title with a shadow one pixel shorter per axis measures one pixel less and is outside the ±1 px of L', !within(growShort) && Math.abs(grow.right - growShort.right - 1) <= 0.1 && Math.abs(grow.bottom - growShort.bottom - 1) <= 0.1, x3.longShadowOnePixelShort);
    }
    {
      // tracking: the ink of 'שלום עולם' grows by t·px·(graphemes − 1)
      const t = 0.2, size = 0.06, graphemes = [...new Intl.Segmenter('he', { granularity: 'grapheme' }).segment('שלום עולם')].length;
      const plain = await solo('x3 tracking plain', 'שלום עולם', { ...BASE, sizeFrac: size });
      const spaced = await solo('x3 tracking', 'שלום עולם', { ...BASE, sizeFrac: size, tracking: t });
      const ap = inkBox(await still(plain.pid, 0)), as = inkBox(await still(spaced.pid, 0));
      const grew = as.x1 - as.x0 - (ap.x1 - ap.x0), want = t * size * H * (graphemes - 1);
      x3.tracking = { graphemes, inkWidthPlain: ap.x1 - ap.x0, inkWidthSpaced: as.x1 - as.x0, grew, expected: Number(want.toFixed(2)) };
      check('X3', 'tracking: the ink width grows by t·px·(graphemes − 1), ±2 px', Math.abs(grew - want) <= 2, x3.tracking);
      measurements.workerTracking = { delivered: true, grew };
      // niqqud: with wide spacing (0.5 font sizes) every vowel point stays on its letter
      const np = await solo('x3 niqqud plain', 'שלום', { ...BASE, sizeFrac: 0.1, tracking: 0.5 });
      const nq = await solo('x3 niqqud', 'שָׁלוֹם', { ...BASE, sizeFrac: 0.1, tracking: 0.5 });
      const mp = await still(np.pid, 0), mq = await still(nq.pid, 0);
      const runs = columnRuns(mp, undefined, 8), runsQ = columnRuns(mq, undefined, 8), spacingPx = 0.5 * 0.1 * H;
      // the points: ink of the pointed title away from (2 px around) the ink of the plain one, in connected pieces
      const plainNear = (x: number, y: number) => { for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) { const X = x + i, Y = y + j; if (X >= 0 && Y >= 0 && X < W && Y < H && inked(mp, X, Y)) return true; } return false; };
      const box = inkBox(mq), seen = new Uint8Array(W * H), pieces: { x: number; y: number; n: number }[] = [];
      for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
        if (seen[y * W + x] || !inked(mq, x, y) || plainNear(x, y)) continue;
        const stack = [[x, y]]; seen[y * W + x] = 1; let n = 0, sx = 0, sy = 0;
        while (stack.length) { const [cx, cy] = stack.pop()!; n++; sx += cx!; sy += cy!; for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = cx! + i!, Y = cy! + j!; if (X < 0 || Y < 0 || X >= W || Y >= H || seen[Y * W + X] || !inked(mq, X, Y) || plainNear(X, Y)) continue; seen[Y * W + X] = 1; stack.push([X, Y]); } }
        if (n >= 20) pieces.push({ x: Math.round(sx / n), y: Math.round(sy / n), n });
      }
      // a point the spacing had pulled off its letter would sit a whole space (96 px) away; a font's own placement of a point
      // over a corner of its letter is allowed a fifth of that
      const slack = 0.2 * spacingPx;
      const outside = pieces.filter((p) => !runs.some(([x0, x1]) => p.x >= x0 - slack && p.x <= x1 + slack));
      const lettersMoved = runs.filter(([x0, x1]) => !runsQ.some(([q0, q1]) => x0 >= q0 - 3 && x1 <= q1 + 3));
      x3.niqqud = { spacingPx, letters: runs, lettersPointed: runsQ, points: pieces, outside, lettersMoved };
      check('X3', 'tracking 0.5 with niqqud: the four letters stand where the unpointed ones do, and the centroid of every vowel point lies on its letter\'s columns (a fifth of the spacing allowed for the font\'s placement)', runs.length === 4 && lettersMoved.length === 0 && pieces.length >= 2 && outside.length === 0, x3.niqqud);
      // Arabic: tracking is drawn as 0
      const ar0 = await project('x3 arabic');
      const c0 = await addTitle(ar0, 'مرحبا بالعالم', 0, 30);
      await preset(ar0, c0, 'classic-outline');
      const before = pixelHash(await still(ar0, 0));
      await style(ar0, c0, { tracking: 0.25 });
      const after = pixelHash(await still(ar0, 0));
      x3.arabic = { without: before, withTracking025: after };
      check('X3', 'tracking on an Arabic line: the still is SHA-equal to the same title with tracking 0', before === after, x3.arabic);
    }
    measurements.x3 = x3;
    lap('X3');

    // ======================================================== X4: blur-in and write-on
    console.log('\n# X4 blur-in sharpens; write-on starts where reading starts');
    {
      const pid = await project('x4 blur');
      const c = await addTitle(pid, 'שלום עולם', 0, 60);
      await preset(pid, c, 'classic-outline');
      await style(pid, c, { sizeFrac: 0.08 });
      await animate(pid, c, { in: 'blur', by: 'word', inFrames: 20 });
      const energy: number[] = [];
      for (let k = 0; k <= 20; k++) energy.push(sobelEnergy(await still(pid, k)));
      const falls = energy.map((e, i) => (i > 0 && e < energy[i - 1]! * (1 - 1e-4) ? i : -1)).filter((i) => i >= 0);
      measurements.x4blur = { relativeEnergy: energy.map((e) => Number((e / energy[20]!).toFixed(4))), falls };
      check('X4', 'blur-in by word over 20 frames: the Sobel edge energy never falls from one frame to the next, and ends at the still title\'s', falls.length === 0 && energy[0]! < energy[20]! * 0.5, measurements.x4blur);
    }
    {
      const writeOn = async (text: string, name: string) => {
        const pid = await project(name);
        const c = await addTitle(pid, text, 0, 90);
        await preset(pid, c, 'clean-white');
        await style(pid, c, { sizeFrac: 0.08 });
        await animate(pid, c, { in: 'write', by: 'letter', inFrames: 40 });
        const rest = await still(pid, 60);
        const runs = columnRuns(rest);
        const frames: Img[] = [];
        for (let k = 0; k <= 40; k++) frames.push(await still(pid, k));
        return { runs, frames, rest };
      };
      const he = await writeOn('שלום עולם', 'x4 write he'), en = await writeOn('Hello world', 'x4 write en');
      const within = (m: Img, run: [number, number]) => columnRuns(m).every(([x0, x1]) => x0 >= run[0] - 2 && x1 <= run[1] + 2);
      const areaHe = he.frames.map(inkArea), areaEn = en.frames.map(inkArea);
      const shrinks = (a: number[]) => a.filter((v, i) => i > 0 && v < a[i - 1]!).length;
      measurements.x4write = { he: { rightmostLetter: he.runs.at(-1), inkAtFrame3: columnRuns(he.frames[3]!), area: areaHe.filter((_, i) => i % 5 === 0) }, en: { leftmostLetter: en.runs[0], inkAtFrame3: columnRuns(en.frames[3]!) } };
      check('X4', 'write-on \'שלום עולם\' by letter over 40 frames: at frame 3 there is ink, and only in the rightmost letter\'s columns', inkArea(he.frames[3]!) > 0 && within(he.frames[3]!, he.runs.at(-1)!), measurements.x4write);
      check('X4', 'write-on: the ink area never decreases over the entrance, and the title at rest is reached', shrinks(areaHe) === 0 && shrinks(areaEn) === 0 && areaHe.at(-1) === inkArea(he.rest), { shrinksHe: shrinks(areaHe), shrinksEn: shrinks(areaEn) });
      check('X4', 'write-on, English control \'Hello world\': at frame 3 the ink is only in the leftmost letter\'s columns', inkArea(en.frames[3]!) > 0 && within(en.frames[3]!, en.runs[0]!), measurements.x4write);
    }
    lap('X4');

    // ======================================================== X5: rise with a gradient, letter by letter
    console.log('\n# X5 a letter keeps its colours while it rises');
    {
      const anim = { in: 'rise', by: 'letter', inFrames: 20 };
      const g = await solo('x5 rise gradient', 'שלום', { ...BASE, sizeFrac: 0.2, gradient: { colors: ['#FFD166', '#3A5BFF'], angle: 90 } });
      const twin = await solo('x5 rise twin', 'שלום', { ...BASE, sizeFrac: 0.2 });
      await animate(g.pid, g.clip, anim); await animate(twin.pid, twin.clip, anim);
      const restG = await still(g.pid, 25), restT = await still(twin.pid, 25);
      const letters = columnRuns(restT);
      /** A letter's top and bottom fully covered rows and their colours, the title's opacity taken out (gradient ÷ white twin). */
      const ends = (m: Img, t: Img, [x0, x1]: [number, number]) => {
        let max = 0;
        for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) max = Math.max(max, t.d[idx(t, x, y)]!);
        if (max < 128) return null;
        const rows: { y: number; c: number[] }[] = [];
        for (let y = 0; y < H; y++) { let n = 0; const sum = [0, 0, 0]; for (let x = x0; x <= x1; x++) { const v = t.d[idx(t, x, y)]!; if (v >= max - 3) { n++; const c = px(m, x, y); for (let j = 0; j < 3; j++) sum[j]! += (c[j]! * 255) / v; } } if (n) rows.push({ y, c: sum.map((v) => v / n) }); }
        return rows.length ? { alpha: max / 255, top: rows[0]!, bottom: rows.at(-1)! } : null;
      };
      const rest = letters.map((l) => ends(restG, restT, l)!);
      let compared = 0, moved = 0, worst = 0;
      const bad: unknown[] = [];
      for (let k = 0; k < 19; k++) {
        const mg = await still(g.pid, k), mt = await still(twin.pid, k);
        letters.forEach((l, i) => {
          const e = ends(mg, mt, l);
          if (!e || !rest[i]) return;
          compared++;
          if (e.top.y - rest[i]!.top.y >= 2) moved++;
          const d = Math.max(...[0, 1, 2].map((j) => Math.max(Math.abs(e.top.c[j]! - rest[i]!.top.c[j]!), Math.abs(e.bottom.c[j]! - rest[i]!.bottom.c[j]!))));
          worst = Math.max(worst, d);
          if (d > 3) bad.push({ frame: k, letter: i, alpha: Number(e.alpha.toFixed(2)), dy: e.top.y - rest[i]!.top.y, top: e.top.c.map(Math.round), restTop: rest[i]!.top.c.map(Math.round) });
        });
      }
      measurements.x5 = { letters, compared, moved, worstDifference: Number(worst.toFixed(2)), bad: bad.slice(0, 10) };
      check('X5', 'rise by letter with a 90° gradient: on every frame where a letter shows at half opacity or more, its top and bottom colours equal its colours at rest ±3/255 (also while it is moved down)', letters.length === 4 && compared > 10 && moved > 3 && bad.length === 0, measurements.x5);
    }
    lap('X5');

    // ======================================================== X6: editor preview = worker still; export PSNR
    console.log('\n# X6 the editor preview and the worker\'s still are the same picture; the export is close');
    {
      const pid = await project('x6 editor');
      const c = await addTitle(pid, SAMPLE, 0, 30);
      const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator('canvas[data-testid=preview]').waitFor();
      measurements.editorCanvas = await page.evaluate(() => {
        const c2 = document.createElement('canvas').getContext('2d')!, off = new OffscreenCanvas(1, 1).getContext('2d')!;
        return { letterSpacing: 'letterSpacing' in c2 && 'letterSpacing' in off, filter: 'filter' in c2 && 'filter' in off, webgpu: !!(navigator as any).gpu };
      });
      // The export against the still. An export is H.264 in 4:2:0: its colour planes have half the still's resolution each
      // way, so against the still's RGB a title with fine edges between saturated colours loses several dB whatever the
      // encoder does ('extrude-retro', orange on violet: 35.93 dB, where a lossless H.264 encode of the very still, decoded
      // the same way, gives 35.97 dB and the same still in 4:4:4 gives 65.6 dB). That number measures the picture, so the
      // export is compared where it can be the still: in its own planes, against the still converted to them by the
      // conversion the export declares. There only the encoder's loss is left (58 to 62 dB here), and BAR is set where a
      // title that lost its look is caught for every look that shows on black (the least clear case, a missing second
      // outline, is 41.5 dB in the planes, and was 37.75 dB in RGB under the earlier bar of 40).
      const BAR = 50;
      const X6_STYLES = ['neon-tube-pink', 'gradient-sunset', 'double-outline-pop', 'extrude-retro', 'long-shadow-flat'];
      const LOOK_OF: Record<string, string | null> = { 'neon-tube-pink': 'glow', 'gradient-sunset': 'gradient', 'double-outline-pop': 'stroke2', 'extrude-retro': 'extrude', 'long-shadow-flat': null }; // long-shadow-flat: its shadow is black at 30% on the black frame, so it does not show here
      type Row = { preset: string; previewIdentical: boolean; maxDifference: number | null; format: string | null; planePsnr: { y: number; u: number; v: number; min: number } | null; rgbPsnr: number | null; rgbPsnrOfTheStillIn420: number; exportError?: unknown };
      const rows: Row[] = [];
      const refPlanes: Record<string, Buffer> = {}, expPlanes: Record<string, Buffer> = {};
      for (const id of X6_STYLES) {
        await preset(pid, c, id);
        const ref = await still(pid, 0);
        let prev: Img | null = null, same = false;
        for (let i = 0; i < 200 && !same; i++) { await sleep(100); prev = await previewRgba(page); same = !!prev && prev.w === W && prev.h === H && maxDiff(prev, ref) === 0; }
        refPlanes[id] = planesOfRgba(ref.d);
        const out = await exportFile(pid, `x6-${id}.mp4`);
        let p: number | null = null, format: string | null = null, planes: Row['planePsnr'] = null;
        if (typeof out === 'string') {
          format = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,color_range,color_space,width,height', '-of', 'default=nw=1', out]).toString().trim().split('\n').sort().join(' ');
          p = psnr({ w: W, h: H, d: ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']) }, ref);
          expPlanes[id] = ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-']); // the decoded planes as they are: no conversion for a yuv420p stream
          planes = planePsnr(expPlanes[id]!, refPlanes[id]!);
        }
        rows.push({ preset: id, previewIdentical: same, maxDifference: prev && prev.w === W && prev.h === H ? maxDiff(prev, ref) : null, format, planePsnr: planes, rgbPsnr: p === null ? null : Number(p.toFixed(2)), rgbPsnrOfTheStillIn420: Number(psnr({ w: W, h: H, d: rgbaOfPlanes(refPlanes[id]!) }, ref).toFixed(2)), ...(typeof out === 'string' ? {} : { exportError: out.error }) });
      }
      await page.close();
      // controls, on stills only: the same measure must fail for another picture and for a title without its look
      const wrong = X6_STYLES.map((id, i) => { const other = X6_STYLES[(i + 1) % X6_STYLES.length]!; return { export: id, still: other, planePsnr: expPlanes[id] ? planePsnr(expPlanes[id]!, refPlanes[other]!) : null }; });
      const bare: { export: string; stillWithout: string; planePsnr: Row['planePsnr'] }[] = [];
      for (const id of X6_STYLES) {
        const look = LOOK_OF[id];
        if (!look) continue;
        await preset(pid, c, id);
        await style(pid, c, { [look]: null });
        bare.push({ export: id, stillWithout: look, planePsnr: expPlanes[id] ? planePsnr(expPlanes[id]!, planesOfRgba((await still(pid, 0)).d)) : null });
      }
      await preset(pid, c, 'long-shadow-flat');
      await style(pid, c, { longShadow: null });
      const noShadow = expPlanes['long-shadow-flat'] ? planePsnr(expPlanes['long-shadow-flat']!, planesOfRgba((await still(pid, 0)).d)) : null;
      const wantFormat = `codec_name=h264 color_range=${EXPORT_FORMAT.range} color_space=${EXPORT_FORMAT.matrix} height=${H} pix_fmt=${EXPORT_FORMAT.pixFmt} width=${W}`;
      measurements.x6 = {
        rows, pageErrors: errors.slice(0, 5), barDb: BAR, expectedFormat: wantFormat,
        method: `planePsnr: the first frame of the export decoded to its own planes (yuv420p) against the worker's still converted to them (${TO_EXPORT_PLANES}); per plane, 255 as the peak. rgbPsnr: the same frame decoded to RGB against the still, recorded only; rgbPsnrOfTheStillIn420 is the still itself taken to those planes and back with no encoder, i.e. the most any 4:2:0 export can score on rgbPsnr.`,
        controls: { anotherStylesStill: wrong, theTitleWithoutItsLook: bare },
        longShadowNote: { planePsnrAgainstTheStillWithoutTheLongShadow: noShadow, note: "long-shadow-flat's shadow is #0000004D, black at 30%, and the frame behind this title is black: the shadow does not show, so for this style X6 compares the letters only (its shadow is measured in X3, in an opaque colour)" },
      };
      check('X6', 'five looks (glow, gradient, double outline, extrusion, long shadow): the paused editor preview (no graphics adapter) is byte-identical to the worker\'s still', rows.every((r) => r.previewIdentical), rows.map((r) => ({ preset: r.preset, previewIdentical: r.previewIdentical, maxDifference: r.maxDifference })));
      check('X6', `and the exported frame is the still as the export's format carries it: H.264 ${EXPORT_FORMAT.pixFmt}, ${EXPORT_FORMAT.matrix}, limited range, and PSNR ≥ ${BAR} dB in each of its Y, U and V planes against the still converted to those planes`, rows.every((r) => r.format === wantFormat && r.planePsnr !== null && r.planePsnr.min >= BAR), rows.map((r) => ({ preset: r.preset, planePsnr: r.planePsnr, rgbPsnr: r.rgbPsnr, rgbPsnrOfTheStillIn420: r.rgbPsnrOfTheStillIn420, ...(r.format === wantFormat ? {} : { format: r.format }), ...(r.exportError ? { exportError: r.exportError } : {}) })));
      check('X6', `controls: by the same measure each export is under ${BAR} dB against the next style's still, and against the still of its own title without its look (glow, gradient, second outline, extrusion)`, wrong.length === 5 && wrong.every((r) => r.planePsnr !== null && r.planePsnr.min < BAR) && bare.length === 4 && bare.every((r) => r.planePsnr !== null && r.planePsnr.min < BAR), { anotherStylesStill: wrong.map((r) => ({ export: r.export, still: r.still, min: r.planePsnr?.min })), theTitleWithoutItsLook: bare.map((r) => ({ export: r.export, without: r.stillWithout, min: r.planePsnr?.min })) });
    }
    lap('X6');

    // ======================================================== X7 and X8: flash check of exports; time per frame
    console.log('\n# X7 the new styles with blur-in and write-on pass the flash check');
    {
      const rows: unknown[] = [];
      let allPass = true;
      const timing: Record<string, number> = {};
      const median = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]!; };
      const timeStill = async (pid: string, k: number) => { const t0 = performance.now(); await still(pid, k); return performance.now() - t0; };
      // the plain reference for X8: 'clean-white', the same title, frame 40 (at rest)
      const plain = await project('x8 plain');
      const pc = await addTitle(plain, SAMPLE, 15, 30);
      await preset(plain, pc, 'clean-white');
      await timeStill(plain, 40); // the first still of a project warms the worker up: not counted
      const plainMs: number[] = [];
      for (let i = 0; i < 5; i++) plainMs.push(await timeStill(plain, 40));
      timing.plain = median(plainMs);
      for (const id of NEW_PRESETS) {
        // four titles, each 30 frames after 15 black ones: blur-in at the default 20 frames and at 1, write-on the same
        const pid = await project(`x7 ${id}`);
        const kinds = [['blur', 20], ['blur', 1], ['write', 20], ['write', 1]] as const;
        for (const [i, [entrance, n]] of kinds.entries()) {
          const c = await addTitle(pid, SAMPLE, 15 + 45 * i, 30);
          await preset(pid, c, id);
          await animate(pid, c, { in: entrance, inFrames: n });
        }
        await timeStill(pid, 40);
        const ms: number[] = [];
        for (let i = 0; i < 5; i++) ms.push(await timeStill(pid, 40));
        timing[id] = median(ms);
        const out = await exportFile(pid, `x7-${id}.mp4`);
        if (typeof out !== 'string') { allPass = false; rows.push({ preset: id, exportError: out.error }); continue; }
        const small = ff(['-i', out, '-vf', 'scale=270:480:flags=neighbor', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']), size = 270 * 480 * 4;
        const fa = new FlashAnalyser(30);
        for (let k = 0; k + size <= small.length; k += size) fa.push(flashCells(small.subarray(k, k + size), 270, 480));
        const rep = fa.report();
        if (!(rep.verdict === 'pass' && rep.frames >= 180)) allPass = false;
        rows.push({ preset: id, frames: rep.frames, verdict: rep.verdict, ranges: rep.ranges });
      }
      measurements.x7 = { layout: 'per style one export of 180 frames: blur-in 20, blur-in 1, write-on 20, write-on 1 (each title 30 frames after 15 black frames), the sample title at 1080x1920; frames decoded at 270x480 by point sampling for the FlashAnalyser (it samples every 4th pixel of a full frame)', rows };
      check('X7', 'server exports of every new style with blur-in and write-on, at the default length and at one frame: the FlashAnalyser reads every frame and passes each', allPass && rows.length === 10, rows);
      const added = Object.fromEntries(NEW_PRESETS.map((id) => [id, Number((timing[id]! - timing.plain!).toFixed(1))]));
      const over = Object.entries(added).filter(([, v]) => v > 25).map(([k]) => k);
      measurements.x8 = { method: 'median of 5 server stills (frame 40, at rest) of the decorated title, minus the same for a plain clean-white title: render, read-back and PNG included in both', plainStillMs: Number(timing.plain!.toFixed(1)), addedMsPerFrame: added, over25ms: over };
      check('X8', 'time per decorated title per frame is recorded; any style over 25 ms is named in the evidence', true, measurements.x8);
    }
    lap('X7/X8');

    // ======================================================== X9
    console.log('\n# X9 letterSpacing in the canvas context');
    measurements.x9 = { editor: measurements.editorCanvas, worker: { letterSpacing: !!(measurements.workerTracking as { grew?: number } | undefined)?.grew, how: 'a still with tracking 0.2 was delivered and its ink is wider; without letterSpacing the worker reports text.tracking unavailable and refuses the still' } };
    check('X9', '\'letterSpacing\' is in the canvas context of the editor\'s browser and of the render worker', (measurements.editorCanvas as { letterSpacing?: boolean }).letterSpacing === true && (measurements.x9 as { worker: { letterSpacing: boolean } }).worker.letterSpacing, measurements.x9);

    // ======================================================== X10: keyboard only in the inspector
    console.log('\n# X10 the title effects panel by keyboard');
    {
      const pid = await project('x10 keyboard');
      const c = await addTitle(pid, 'שלום', 0, 60);
      const variantId = (await tx(pid, [{ op: 'add_variant', args: { profileId: 'square-1x1' } }])).results[0].output.variantId as string;
      const doc = async () => (await call(`/projects/${pid}`)).body.project;
      const clipOf = (d: any) => d.sequences[d.mainSequenceId].tracks.flatMap((t: any) => t.clips).find((x: any) => x.id === c);
      const lastEvent = async () => { const ev = (await call(`/projects/${pid}/history?since=0`)).body.events; return ev.at(-1); };
      const until = async (pred: (d: any) => boolean, ms = 10000) => { const t0 = Date.now(); for (;;) { const d = await doc(); if (pred(d)) return d; if (Date.now() - t0 > ms) return null; await sleep(100); } };
      const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
      await ctx.addInitScript(() => { try { localStorage.setItem('pf.inspector.tab.v1', 'all'); localStorage.setItem('pf.lang', 'he'); } catch { /* storage unavailable */ } });
      const page = await ctx.newPage();
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator(`.clip[data-clip-id="${c}"]`).click(); // selecting the title (the only pointer step); the panel is then used by keyboard only
      await page.getByTestId('text-effects').waitFor({ timeout: 10000 });
      /** Tab (or Shift+Tab) until the element with this test id has the focus. */
      const tabTo = async (testid: string, back = false) => { for (let i = 0; i < 600; i++) { if (await page.evaluate((id) => (document.activeElement as HTMLElement | null)?.dataset?.testid === id, testid)) return true; await page.keyboard.press(back ? 'Shift+Tab' : 'Tab'); } return false; };
      const before = clipOf(await doc()).style;
      const reached = await tabTo('text-fx-glow');
      await page.keyboard.press('Space');
      const on = await until((d) => !!clipOf(d).style.glow);
      const evOn = await lastEvent();
      const undoReached = await tabTo('undo', true);
      await page.keyboard.press('Enter');
      const undone = await until((d) => JSON.stringify(clipOf(d).style) === JSON.stringify(before));
      const evUndo = await lastEvent();
      measurements.x10master = { reachedByTab: reached, glow: on ? clipOf(on).style.glow : null, op: evOn?.ops, undoReachedByTab: undoReached, undoEvent: evUndo?.kind, restored: !!undone };
      check('X10', 'keyboard only: Tab to the glow checkbox and Space commits update_text with the glow; Tab to undo and Enter restores the title exactly', reached && !!on && JSON.stringify(evOn?.ops) === '["update_text"]' && undoReached && evUndo?.kind === 'undo' && !!undone, measurements.x10master);
      // a format view (switched with the format menu; the panel then by keyboard again)
      await chooseFormat(page, variantId);
      await page.getByTestId('format-badge').waitFor({ timeout: 10000 }).catch(() => {});
      await page.getByTestId('text-effects').waitFor({ timeout: 10000 });
      await page.locator('[data-testid=format-switch] [role=radio][aria-checked=true]').focus(); // the viewed format's chip in the FormatPrism (the old select)
      const reached2 = await tabTo('text-fx-glow');
      await page.keyboard.press('Space');
      const inFormat = await until((d) => !!d.variants?.[variantId]?.overrides?.[c]?.textStyle?.glow);
      const ev2 = await lastEvent();
      measurements.x10format = { reachedByTab: reached2, override: inFormat ? inFormat.variants[variantId].overrides[c].textStyle : null, op: ev2?.ops, masterGlow: inFormat ? clipOf(inFormat).style.glow ?? null : 'not reached' };
      check('X10', 'in a format view the same keys commit set_variant_override with the glow, and the master title keeps no glow', reached2 && !!inFormat && JSON.stringify(ev2?.ops) === '["set_variant_override"]' && clipOf(inFormat).style.glow === undefined, measurements.x10format);
      await ctx.close();
    }
    lap('X10');
  } catch (e) {
    check('run', 'the proof ran to the end', false, String((e as Error)?.stack ?? e).slice(0, 1500));
  } finally {
    await browser.close();
    await s.close();
  }

  const failed = checks.filter((c) => !c.ok);
  const report = {
    ranAt: new Date().toISOString(), commit, baselineCommit: baseline.commit,
    machine: { platform: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model, gpu: 'none used: every title look is Canvas2D; the editor browser has no WebGPU; the render worker started as for the trend baseline (PF_RENDER_GPU unset), and no project here uses a GPU effect' },
    scope: 'Server stills and exports at 1080x1920 through the render worker, and the editor in headless Chromium (Playwright), on this container. X1 compares pixel hashes with docs/evidence/trend-baseline.json, which holds only on the machine and build that recorded it. Nobody has judged the looks on a video by eye.',
    result: failed.length ? 'FAILED' : 'PASSED', checks, measurements,
  };
  fs.writeFileSync(evidence, JSON.stringify(report, null, 1) + '\n');
  console.log(`\ntrend-text proof ${report.result}: ${checks.length - failed.length}/${checks.length} checks -> ${path.relative(root, evidence)}`);
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
