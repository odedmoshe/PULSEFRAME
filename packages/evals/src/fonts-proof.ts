/**
 * `pnpm build && pnpm proof:fonts` — the bundled Hebrew fonts (ADR-0022) in headless Chromium through the server's still route
 * and the editor's preview. Evidence: docs/evidence/fonts-proof.json and docs/evidence/fonts-golden.json.
 *
 * Every picture is made by the render worker (ADR-0005): the same evaluate and compositor as the editor's preview and the export.
 * One project, 1920 x 1080, white title on black, no outline, no shadow, no look.
 *
 * What it checks, and what each check is able to fail for:
 * - F1 placement, for every family and every weight of FONT_CATALOG: for each of the 16 vowel points, the letter with the point
 *   and the letter alone are drawn at 200 px; the pixels that changed are the point. Their horizontal centre must lie within 40 % of
 *   the letter's own width of its middle (and inside its ink box ± 10 % of the em; a holam ± 20 % on its left, see Zone); the
 *   below-points (U+05B0–05B8, U+05BB, U+05C7) must lie below the letter's ink in the columns they cover (a handwriting letter
 *   whose tail reaches lower elsewhere, as Gveret Levin's bet does, is judged where the point is, not by its tail);
 *   holam (U+05B9, and U+05BA) in the upper part of the letter; dagesh (U+05BC) inside the ink box; the shin dot (U+05C1) in the
 *   upper right half and the sin dot (U+05C2) in the upper left half of a shin. A point that draws nothing fails (a fallback font
 *   or a missing glyph). The width rule of the plan (pointed width = unpointed width) is not used: a mark has no advance wherever
 *   it is drawn, so it cannot fail for a misplaced mark. Controls (first weight of each family, three points): deliberate
 *   mutations of the face's own pictures. The point's own pixels (pointed minus alone) are moved (moveMark) and the check runs
 *   on the result: 0.55 em to the right and to the left (both must be rejected), up until it is wholly above the letter and down
 *   until it is wholly below it, CONTROL_GAP_EM clear of the letter's ink box (at least one must be rejected; a move by a fixed
 *   0.6 em hid a patah inside the bet's ink in five faces, where nothing can be measured), and with the point's centre on the
 *   letter's right and left edge, the pen-origin failure of an unpositioned mark (rejected by the horizontal rule, except on the
 *   edge where the point belongs). Each mutation must have drawn the point: a
 *   check that cannot reject these proves nothing. (The earlier controls drew the point as a title of its own on a no-break
 *   space; several faces draw nothing for a mark on a no-break space, so those controls proved nothing.)
 *   The thresholds are constants below; the evidence records every measured margin, so a threshold can be tuned from numbers.
 * - F2 goldens: one pointed line per family and weight, starting and ending with an unpointed wide letter; SHA-256 of the decoded
 *   pixels, all pairwise different (so no family fell back to another face), compared with docs/evidence/fonts-golden.json for
 *   the Chromium that ran. A first recording proves nothing by itself: it is written down and flagged, and the next run on the same
 *   Chromium is the first real comparison. A second run that differs is a failure.
 * - F3 preview = still = export for one family per category: the paused editor preview canvas is byte-identical to the worker's
 *   still, and the first frame of the export, in its own planes (H.264 4:2:0, BT.709, limited range), is within 50 dB of the still
 *   converted to them. Controls: the export against another family's still is below 50 dB.
 * - F4 cost: the time the browser takes to load every face of the catalogue (the work of ensureFonts), the woff2 bytes the build
 *   emitted for the title families and the bundle total with the woff fallbacks, each file emitted once.
 * Exits 0 when every check passes, 1 when one fails, 2 when it cannot run (no build, no ffmpeg).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Page } from 'playwright';
import * as T from '@pulseframe/time';
import { FONT_CATALOG, type FontEntry } from '@pulseframe/core';

const root = path.resolve(import.meta.dirname, '../../..');
const art = path.join(root, '.artifacts/fonts-proof');
const evidenceFile = path.join(root, 'docs/evidence/fonts-proof.json');
const goldenFile = path.join(root, 'docs/evidence/fonts-golden.json');
const PORT = 8897;
const W = 1920, H = 1080;
const R30 = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R30);

// ---------------------------------------------------------------- the data of the checks
export const EM = 200;
/** The golden line: starts and ends with an unpointed wide letter (a pointed first or last letter would hide a missing mark at the edge). */
export const GOLDEN_LINE = 'ש שָׁלוֹם, יְלָדִים! חֲנֻכָּה שְׂמֵחָה — תשפ״ז ש';
/** The line the task names; it is inside the golden line. */
export const TASK_LINE = 'שָׁלוֹם, יְלָדִים! חֲנֻכָּה שְׂמֵחָה — תשפ״ז';
export const BET = 'ב', SHIN = 'ש';
export const MARKS: { cp: number; name: string; base: string; zone: Zone }[] = [
  { cp: 0x5b0, name: 'sheva', base: BET, zone: 'below' }, { cp: 0x5b1, name: 'hataf segol', base: BET, zone: 'below' }, { cp: 0x5b2, name: 'hataf patah', base: BET, zone: 'below' },
  { cp: 0x5b3, name: 'hataf qamats', base: BET, zone: 'below' }, { cp: 0x5b4, name: 'hiriq', base: BET, zone: 'below' }, { cp: 0x5b5, name: 'tsere', base: BET, zone: 'below' },
  { cp: 0x5b6, name: 'segol', base: BET, zone: 'below' }, { cp: 0x5b7, name: 'patah', base: BET, zone: 'below' }, { cp: 0x5b8, name: 'qamats', base: BET, zone: 'below' },
  { cp: 0x5b9, name: 'holam', base: BET, zone: 'holam' }, { cp: 0x5ba, name: 'holam haser for vav', base: BET, zone: 'holam' }, { cp: 0x5bb, name: 'qubuts', base: BET, zone: 'below' },
  { cp: 0x5bc, name: 'dagesh', base: BET, zone: 'inside' }, { cp: 0x5c1, name: 'shin dot', base: SHIN, zone: 'shin' }, { cp: 0x5c2, name: 'sin dot', base: SHIN, zone: 'sin' },
  { cp: 0x5c7, name: 'qamats qatan', base: BET, zone: 'below' },
];
/**
 * Where a point belongs: under the letter, above it, inside it, or (holam, and the dots of shin and sin) above it on one side.
 * A holam on a letter other than vav sits at the letter's upper left corner, by Hebrew convention: its centre lies on the left
 * edge of the letter (measured: 0.24–0.33 em left of the middle in every catalogue face), so it is judged by side, like the sin
 * dot, and not by the distance of its centre from the middle (which every correctly drawn holam broke). Some faces hang it past
 * the corner, between the letter and the next one (Rubik: centre 0.10 em left of the bet's ink, looked at at 648 px on
 * 2026-11-18), so on its left side a holam's centre may lie up to holamLeftSlack outside the ink box; on the right the ordinary
 * slack holds, and the side rule rejects a holam right of the middle.
 */
export type Zone = 'below' | 'above' | 'inside' | 'shin' | 'sin' | 'holam';
/** The thresholds, in em (200 px). Written down here and in the header; the evidence records the measured margins. */
export const RULES = { centreSlack: 0.10, holamLeftSlack: 0.20, centreFrac: 0.40, belowSlack: 0.04, aboveShare: 0.30, insideSlack: 0.02, halfSlack: 0.03, minChanged: 30, changedThreshold: 24 } as const;
/** The weights the controls run at: the first weight of each family only (the controls are about the check, not the font). */
export const CONTROL_MARKS = [0x5b7, 0x5b9, 0x5c1];
export const CONTROL_SIDE_EM = 0.55, CONTROL_GAP_EM = 0.1;
/**
 * The lowest row of the letter's ink in the columns x0..x1 (brightest channel over the threshold), or -1 when it has no ink there.
 * A below-point is judged against this row, not against the lowest row of the whole letter.
 */
export function lowestInkIn(m: Img, x0: number, x1: number, t = 24): number {
  let low = -1;
  for (let x = Math.max(0, x0); x <= Math.min(m.w - 1, x1); x++) for (let y = m.h - 1; y > low; y--) {
    const i = (y * m.w + x) * 4;
    if (Math.max(m.d[i]!, m.d[i + 1]!, m.d[i + 2]!) > t) { low = y; break; }
  }
  return low;
}
/**
 * A deliberate mutation for the controls: the point's own pixels (where `pointed` differs from `alone` by more than the
 * threshold) moved by (dx, dy) px and drawn over the letter alone (light on dark: the brighter value wins). Pure.
 */
export function moveMark(alone: Img, pointed: Img, dx: number, dy: number, t = RULES.changedThreshold): Img {
  const out: Img = { w: alone.w, h: alone.h, d: alone.d.slice() };
  dx = Math.round(dx); dy = Math.round(dy);
  for (let y = 0; y < alone.h; y++) for (let x = 0; x < alone.w; x++) {
    const i = idx(alone, x, y);
    if (!(Math.abs(alone.d[i]! - pointed.d[i]!) > t || Math.abs(alone.d[i + 1]! - pointed.d[i + 1]!) > t || Math.abs(alone.d[i + 2]! - pointed.d[i + 2]!) > t)) continue;
    const X = x + dx, Y = y + dy;
    if (X < 0 || Y < 0 || X >= alone.w || Y >= alone.h) continue;
    const j = idx(alone, X, Y);
    for (let c = 0; c < 4; c++) out.d[j + c] = Math.max(out.d[j + c]!, pointed.d[i + c]!);
  }
  return out;
}

// ---------------------------------------------------------------- pictures
export interface Img { w: number; h: number; d: Uint8Array }
const idx = (m: Img, x: number, y: number) => (y * m.w + x) * 4;
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** Ink box of a picture: pixels whose brightest channel is over the threshold. Infinity box when empty. */
export function inkBox(m: Img, t = 24): Box & { count: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    const i = idx(m, x, y);
    if (Math.max(m.d[i]!, m.d[i + 1]!, m.d[i + 2]!) > t) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1, count };
}
/** Bounding box and count of the pixels that differ between two pictures of one size by more than the threshold in any channel. */
export function changedBox(a: Img, b: Img, t = RULES.changedThreshold): Box & { count: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, count = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) {
    const i = idx(a, x, y);
    if (Math.abs(a.d[i]! - b.d[i]!) > t || Math.abs(a.d[i + 1]! - b.d[i + 1]!) > t || Math.abs(a.d[i + 2]! - b.d[i + 2]!) > t) { count++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1, count };
}
export interface MarkResult {
  cp: number; name: string; zone: Zone; pass: boolean; reasons: string[];
  changed: number; centreOffsetEm: number | null;
  /** px of room each rule left (negative = broken): the numbers a threshold is tuned from */
  margins: Record<string, number>;
}
/**
 * The zone check of one point: `alone` is the letter alone and `pointed` the same letter with the point, both at EM px. A point
 * that changed fewer than minChanged pixels is not drawn. Pure: the proof's unit test (fonts-proof.test.ts) runs it on drawn
 * rectangles, including the cases that must fail.
 */
export function checkMark(alone: Img, pointed: Img, mark: { cp: number; name: string; zone: Zone }): MarkResult {
  const box = inkBox(alone), ch = changedBox(alone, pointed);
  const r: MarkResult = { cp: mark.cp, name: mark.name, zone: mark.zone, pass: true, reasons: [], changed: ch.count, centreOffsetEm: null, margins: {} };
  const fail = (why: string) => { r.pass = false; r.reasons.push(why); };
  if (box.count === 0) { fail('the letter alone drew nothing'); return r; }
  if (ch.count < RULES.minChanged) { fail(`the point drew ${ch.count} changed pixels (fewer than ${RULES.minChanged}): not drawn`); return r; }
  const h = box.y1 - box.y0 + 1, cx = (box.x0 + box.x1) / 2, cxm = (ch.x0 + ch.x1) / 2;
  r.centreOffsetEm = Number(((cxm - cx) / EM).toFixed(3));
  const slack = RULES.centreSlack * EM, leftSlack = (mark.zone === 'holam' ? RULES.holamLeftSlack : RULES.centreSlack) * EM;
  r.margins.centreLeft = Number((cxm - (box.x0 - leftSlack)).toFixed(1));
  r.margins.centreRight = Number(((box.x1 + slack) - cxm).toFixed(1));
  // the centre lies in the middle of the letter: within centreFrac of the letter's own width of its middle (a point hanging off an edge, which is
  // what a point drawn at the pen origin looks like, has its centre at the edge = 0.5 of the width from the middle, and is rejected)
  const bw = box.x1 - box.x0 + 1, frac = Math.abs(cxm - cx) / bw;
  // points that belong on one side (holam, shin dot, sin dot) are judged by their side rule below, not by their distance from the middle
  const sided = mark.zone === 'shin' || mark.zone === 'sin' || mark.zone === 'holam';
  if (!sided) r.margins.centreFrac = Number((RULES.centreFrac - frac).toFixed(3));
  if (!sided && frac > RULES.centreFrac) fail(`the point's horizontal centre ${cxm.toFixed(1)} is ${(frac * 100).toFixed(0)} % of the letter's width from its middle ${cx.toFixed(1)} (limit ${RULES.centreFrac * 100} %)`);
  if (cxm < box.x0 - leftSlack || cxm > box.x1 + slack) fail(`the point's horizontal centre ${cxm.toFixed(1)} is outside the letter's ink box ${box.x0}..${box.x1} (− ${leftSlack} / + ${slack} px)`);
  switch (mark.zone) {
    case 'below': {
      // the letter's lowest ink in the columns the point covers; where the letter has none there, its lowest row overall
      const local = lowestInkIn(alone, ch.x0, ch.x1), base = local >= 0 ? local : box.y1;
      r.margins.belowBaseline = ch.y0 - (base - RULES.belowSlack * EM);
      if (ch.y0 < base - RULES.belowSlack * EM) fail(`a changed pixel at row ${ch.y0} is above the letter's lowest ink ${base} in the point's columns ${ch.x0}..${ch.x1} (slack ${RULES.belowSlack * EM} px)`);
      break;
    }
    case 'above': {
      const row = box.y0 + RULES.aboveShare * h;
      r.margins.aboveRow = row - ch.y1;
      if (ch.y1 > row) fail(`a changed pixel at row ${ch.y1} is below the upper ${RULES.aboveShare * 100} % of the letter (row ${row.toFixed(1)})`);
      break;
    }
    case 'inside': {
      const s = RULES.insideSlack * EM;
      r.margins.insideLeft = ch.x0 - (box.x0 - s); r.margins.insideRight = (box.x1 + s) - ch.x1; r.margins.insideTop = ch.y0 - (box.y0 - s); r.margins.insideBottom = (box.y1 + s) - ch.y1;
      if (ch.x0 < box.x0 - s || ch.x1 > box.x1 + s || ch.y0 < box.y0 - s || ch.y1 > box.y1 + s) fail(`the dagesh (${ch.x0},${ch.y0})..(${ch.x1},${ch.y1}) is not inside the ink box (${box.x0},${box.y0})..(${box.x1},${box.y1})`);
      break;
    }
    case 'shin': case 'sin': case 'holam': {
      const s = RULES.halfSlack * EM, row = box.y0 + RULES.aboveShare * h;
      r.margins.halfSide = mark.zone === 'shin' ? ch.x0 - (cx - s) : (cx + s) - ch.x1;
      r.margins.aboveRow = row - ch.y1;
      if (mark.zone === 'shin' && ch.x0 < cx - s) fail(`the shin dot starts at column ${ch.x0}, left of the letter's middle ${cx.toFixed(1)}`);
      if (mark.zone === 'sin' && ch.x1 > cx + s) fail(`the sin dot ends at column ${ch.x1}, right of the letter's middle ${cx.toFixed(1)}`);
      if (mark.zone === 'holam' && ch.x1 > cx + s) fail(`the holam ends at column ${ch.x1}, right of the letter's middle ${cx.toFixed(1)}`);
      if (ch.y1 > row) fail(`the dot reaches row ${ch.y1}, below the upper ${RULES.aboveShare * 100} % of the letter (row ${row.toFixed(1)})`);
      break;
    }
  }
  return r;
}
/**
 * The control: the point moved away from its place (moveMark). `right` and `left` are the pictures with it 0.55 em to each side, `up`
 * and `down` with it wholly above and wholly below the letter. The check is able to fail when it rejects both sideways ones and at least one
 * vertical one, and each of those drew the point (a vertical move that hides the point inside the letter's ink counts as not drawn,
 * so the other one must then be drawn and rejected).
 */
export function controlRejects(alone: Img, right: Img, left: Img, up: Img, down: Img, mark: { cp: number; name: string; zone: Zone }): { ok: boolean; sidewaysRejected: boolean; verticalRejected: boolean; drawn: boolean } {
  const [rr, rl, ru, rd] = [right, left, up, down].map((p) => checkMark(alone, p, mark)) as [MarkResult, MarkResult, MarkResult, MarkResult];
  const seen = (x: MarkResult) => x.changed >= RULES.minChanged;
  const drawn = seen(rr) && seen(rl) && (seen(ru) || seen(rd));
  const sidewaysRejected = !rr.pass && !rl.pass, verticalRejected = (seen(ru) && !ru.pass) || (seen(rd) && !rd.pass);
  return { ok: drawn && sidewaysRejected && verticalRejected, sidewaysRejected, verticalRejected, drawn };
}

/**
 * The control the contract named: the point drawn at the pen origin, i.e. with its centre on the edge of its letter (`atRight` and
 * `atLeft`: the pictures with the point's centre moved onto the letter's right and left edge, moveMark). The check must reject both on the
 * horizontal rule, and each must have drawn the point.
 */
export function penOriginRejects(alone: Img, atRight: Img, atLeft: Img, mark: { cp: number; name: string; zone: Zone }): { ok: boolean; rightRejected: boolean; leftRejected: boolean; drawn: boolean } {
  const rr = checkMark(alone, atRight, mark), rl = checkMark(alone, atLeft, mark);
  const horizontal = (x: MarkResult) => !x.pass && x.reasons.some((w) => w.includes('horizontal centre') || w.includes('of the letter\'s middle'));
  const drawn = rr.changed >= RULES.minChanged && rl.changed >= RULES.minChanged;
  const rightRejected = horizontal(rr), leftRejected = horizontal(rl);
  // a point that belongs on one edge (a holam and the sin dot on the left, the shin dot on the right) is drawn there correctly:
  // only the pen origin on the other edge is a misplacement the check must reject
  const needRight = mark.zone !== 'shin', needLeft = mark.zone !== 'holam' && mark.zone !== 'sin';
  return { ok: drawn && (!needRight || rightRejected) && (!needLeft || leftRejected), rightRejected, leftRejected, drawn };
}

// ---------------------------------------------------------------- goldens
export const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export interface GoldenRecording { recordedAt: string; commit: string; runs: number; hashes: Record<string, string> }
export interface GoldenFile { schema: 1; line: string; note: string; em: number; size: { w: number; h: number }; recordings: Record<string, GoldenRecording> }
export const goldenKey = (family: string, weight: number) => `${family}|${weight}`;
/** The keys that are not unique: two faces that drew the same pixels means one of them was not drawn. */
export function duplicateHashes(hashes: Record<string, string>): string[][] {
  const by = new Map<string, string[]>();
  for (const [k, h] of Object.entries(hashes)) by.set(h, [...(by.get(h) ?? []), k]);
  return [...by.values()].filter((g) => g.length > 1);
}
/** Compare hashes with a recording: the keys that differ or are missing on either side. */
export function compareGolden(recorded: Record<string, string>, now: Record<string, string>): { differ: string[]; missing: string[]; extra: string[] } {
  return {
    differ: Object.keys(now).filter((k) => k in recorded && recorded[k] !== now[k]),
    missing: Object.keys(recorded).filter((k) => !(k in now)),
    extra: Object.keys(now).filter((k) => !(k in recorded)),
  };
}

// ---------------------------------------------------------------- ffmpeg
const ff = (args: string[], input?: Buffer) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', ...args], { maxBuffer: 1 << 30, ...(input ? { input } : {}) });
const rgbaOfPng = (png: Buffer, w = W, h = H): Img => ({ w, h, d: new Uint8Array(ff(['-f', 'png_pipe', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], png)) });
const TO_EXPORT_PLANES = 'scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p';
const planesOfRgba = (rgba: Uint8Array, w = W, h = H) => ff(['-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${w}x${h}`, '-i', 'pipe:0', '-vf', TO_EXPORT_PLANES, '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-'], Buffer.from(rgba));
function planePsnr(a: Buffer, b: Buffer, w = W, h = H) {
  const n = w * h, q = (w / 2) * (h / 2);
  if (a.length !== n + 2 * q || b.length !== n + 2 * q) return { y: 0, u: 0, v: 0, min: 0 };
  const db = (from: number, len: number) => { let s = 0; for (let i = from; i < from + len; i++) { const e = a[i]! - b[i]!; s += e * e; } return s === 0 ? 99 : Number((10 * Math.log10((255 * 255) / (s / len))).toFixed(2)); };
  const y = db(0, n), u = db(n, q), v = db(n + q, q);
  return { y, u, v, min: Math.min(y, u, v) };
}
const maxDiff = (a: Img, b: Img) => { let m = 0; for (let i = 0; i < a.d.length; i++) m = Math.max(m, Math.abs(a.d[i]! - b.d[i]!)); return m; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- the build
const FONT_FILE = (slug: string) => new RegExp(`(^|/)${slug}-(hebrew|latin)-(\\d+)-normal[^/]*\\.(woff2?)$`);
/** The font files the build emitted (apps/web/dist/assets): by family, the woff2 and woff files and their sizes; each (family, subset, weight, format) should be there once. */
function bundleOf(entries: readonly FontEntry[]) {
  const dist = path.join(root, 'apps/web/dist');
  const files: string[] = [];
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
  if (fs.existsSync(dist)) walk(dist);
  const req = createRequire(import.meta.url);
  const rows = entries.map((fam) => {
    const emitted = files.filter((p) => FONT_FILE(fam.slug).test(p.replaceAll(path.sep, '/')) && (/-(hebrew|latin)-/.test(p)));
    const want = fam.weights.flatMap((w) => ['hebrew', 'latin'].flatMap((s) => ['woff2', 'woff'].map((fmt) => ({ s, w, fmt }))));
    const have = (s: string, w: number, fmt: string) => emitted.filter((p) => p.includes(`${fam.slug}-${s}-${w}-normal`) && p.endsWith(`.${fmt}`));
    const onceEach = want.every(({ s, w, fmt }) => have(s, w, fmt).length === 1);
    const pkgDir = path.dirname(req.resolve(`${fam.package}/package.json`, { paths: [path.join(root, 'apps/web')] }));
    const size = (fmt: string) => fam.weights.flatMap((w) => ['hebrew', 'latin'].map((s) => fs.statSync(path.join(pkgDir, 'files', `${fam.slug}-${s}-${w}-normal.${fmt}`)).size)).reduce((a, b) => a + b, 0);
    const emittedSize = (fmt: string) => emitted.filter((p) => p.endsWith(`.${fmt}`)).reduce((a, p) => a + fs.statSync(p).size, 0);
    return { family: fam.family, woff2: size('woff2'), woff: size('woff'), emittedWoff2: emittedSize('woff2'), emittedWoff: emittedSize('woff'), onceEach, built: emitted.length > 0 };
  });
  return { dist: fs.existsSync(dist), rows };
}

// ---------------------------------------------------------------- the proof
export const HELD_BACK_NOTE = 'Alef and Varela Round are not in this build (held for the owner: reserved font names), so the plan\'s 374,552 bytes of woff2 for eight families does not apply; the figure below is for the families that are.';

async function main() {
  if (!fs.existsSync(path.join(root, 'apps/web/dist/index.html'))) { console.error('proof:fonts needs `pnpm build` first (apps/web/dist is missing). Nothing was checked.'); process.exit(2); }
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { console.error('proof:fonts needs ffmpeg on the PATH. Nothing was checked.'); process.exit(2); }
  const { chromium } = await import('playwright');
  const { startServer } = await import('@pulseframe/server');
  fs.rmSync(art, { recursive: true, force: true });
  fs.mkdirSync(art, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim();
  const checks: { id: string; name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (id: string, name: string, ok: boolean, detail?: unknown) => { checks.push({ id, name, ok, ...(detail !== undefined ? { detail } : {}) }); console.log(`${ok ? '  ok  ' : ' FAIL '} ${id} ${name}${detail !== undefined ? `  ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };
  const measurements: Record<string, unknown> = {};
  const started = Date.now();
  const lap = (what: string) => console.log(`  … ${what} (${((Date.now() - started) / 1000).toFixed(0)} s)`);

  delete process.env.PF_RENDER_GPU;
  const s = await startServer({ port: PORT, dataDir: path.join(art, 'data') });
  const hdr = { authorization: `Bearer ${s.auth.tokens.agent}`, connection: 'close' };
  const call = async (p: string, body?: unknown) => {
    const r = await fetch(`${s.url}/api/v1${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { ...hdr, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) } as { status: number; body: any };
  };
  const tx = async (pid: string, ops: unknown[]) => { const r = await call(`/projects/${pid}/transactions`, { ops }); if (r.status !== 200) throw new Error(`tx failed: ${JSON.stringify(r.body).slice(0, 300)}`); return r.body; };
  const project = async (name: string) => (await call('/projects', { name, width: W, height: H })).body.project.id as string;
  const still = async (pid: string, index = 0): Promise<Img> => {
    const r = await call(`/projects/${pid}/frame?index=${index}`);
    if (r.status !== 200 || !Buffer.isBuffer(r.body)) throw new Error(`still ${index} refused: ${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 300)}`);
    return rgbaOfPng(r.body);
  };
  const STYLE = { color: '#FFFFFF', background: null, stroke: null, strokeFrac: 0, align: 'center', direction: 'rtl' } as const;
  const addTitle = async (pid: string, text: string, family: string, weight: number, sizeFrac: number, transform?: { x: number; y: number }) =>
    (await tx(pid, [{ op: 'add_text', args: { text, start: f(0), duration: f(30), style: { ...STYLE, fontFamily: family, fontWeight: weight, sizeFrac }, ...(transform ? { transform } : {}) } }])).results[0].output.clipId as string;
  const setTitle = (pid: string, clipId: string, text: string, family?: string, weight?: number) =>
    tx(pid, [{ op: 'update_text', args: { clipId, text, ...(family ? { style: { fontFamily: family, fontWeight: weight } } : {}) } }]);
  const waitJob = async (jobId: string) => { for (;;) { const j = (await call(`/jobs/${jobId}`)).body; if (['succeeded', 'failed', 'canceled'].includes(j.status)) return j; await sleep(250); } };
  const exportFile = async (pid: string, name: string): Promise<string | { error: unknown }> => {
    const j = await waitJob((await call(`/projects/${pid}/exports`, {})).body.jobId);
    if (j.status !== 'succeeded') return { error: { status: j.status, error: j.error } };
    const out = path.join(art, name);
    fs.writeFileSync(out, (await call(`/jobs/${j.id}/output`)).body);
    return out;
  };

  const browser = await chromium.launch();
  const chromiumVersion = browser.version();
  const combos = FONT_CATALOG.flatMap((fam) => fam.weights.map((w) => ({ fam, w, key: goldenKey(fam.family, w) })));
  const SIZE_FRAC = EM / H;
  try {
    // ======================================================== F1 placement of every point, with the controls
    console.log(`\n# F1 the vowel points sit where they belong (${combos.length} faces x ${MARKS.length} points) with controls`);
    const placement: Record<string, { marks: MarkResult[]; control: { cp: number; name: string; ok: boolean; sidewaysRejected: boolean; verticalRejected: boolean; drawn: boolean; penOrigin: { ok: boolean; rightRejected: boolean; leftRejected: boolean; drawn: boolean } }[] | null }> = {};
    {
      const pid = await project('f1 placement');
      const clip = await addTitle(pid, BET, 'Heebo', 400, SIZE_FRAC);
      let done = 0;
      for (const { fam, w, key } of combos) {
        await setTitle(pid, clip, BET, fam.family, w);
        const aloneBet = await still(pid);
        await setTitle(pid, clip, SHIN);
        const aloneShin = await still(pid);
        const marks: MarkResult[] = [];
        const pointedOf = new Map<number, Img>();
        for (const m of MARKS) {
          const base = m.base === BET ? BET : SHIN;
          await setTitle(pid, clip, base + String.fromCodePoint(m.cp));
          const pointed = await still(pid);
          if (CONTROL_MARKS.includes(m.cp)) pointedOf.set(m.cp, pointed);
          marks.push(checkMark(base === BET ? aloneBet : aloneShin, pointed, m));
        }
        // controls, at the first weight of the family: deliberate mutations of this face's own pictures (moveMark)
        let control: (typeof placement)[string]['control'] = null;
        if (w === fam.weights[0]) {
          control = [];
          for (const cp of CONTROL_MARKS) {
            const m = MARKS.find((x) => x.cp === cp)!;
            const alone = m.base === BET ? aloneBet : aloneShin, pointed = pointedOf.get(cp)!;
            const side = CONTROL_SIDE_EM * EM, gap = CONTROL_GAP_EM * EM;
            const moved = (dx: number, dy: number) => moveMark(alone, pointed, dx, dy);
            const lb = inkBox(alone), pb = changedBox(alone, pointed);
            // up: the point's lowest row `gap` above the letter's top row; down: its top row `gap` below the letter's lowest row
            const rejects = controlRejects(alone, moved(side, 0), moved(-side, 0), moved(0, lb.y0 - gap - pb.y1), moved(0, lb.y1 + gap - pb.y0), m);
            // the pen-origin control: the point's centre moved onto the right and onto the left edge of its letter
            // a point that drew nothing (or a letter that drew nothing) gives nothing to move: recorded as failed (drawn: false), never skipped
            if (!lb.count || !pb.count) { control.push({ cp, name: m.name, ...rejects, penOrigin: { ok: false, rightRejected: false, leftRejected: false, drawn: false } }); continue; }
            const cx0 = (pb.x0 + pb.x1) / 2;
            control.push({ cp, name: m.name, ...rejects, penOrigin: penOriginRejects(alone, moved(lb.x1 - cx0, 0), moved(lb.x0 - cx0, 0), m) });
          }
        }
        placement[key] = { marks, control };
        done++;
        if (done % 5 === 0) lap(`F1 ${done}/${combos.length} faces`);
      }
      const failing = Object.entries(placement).flatMap(([k, v]) => v.marks.filter((m) => !m.pass).map((m) => ({ face: k, mark: m.name, why: m.reasons })));
      measurements.placement = { rules: RULES, em: EM, faces: placement };
      check('F1', `every one of the ${MARKS.length} vowel points of every face (${combos.length} family and weight pairs) is drawn and sits in its zone`, failing.length === 0, failing.slice(0, 8));
      const badControl = Object.entries(placement).flatMap(([k, v]) => (v.control ?? []).filter((c) => !c.ok || !c.penOrigin.ok).map((c) => ({ face: k, mark: c.name, ...c })));
      const controlCount = Object.values(placement).reduce((n, v) => n + (v.control?.length ?? 0), 0);
      check('F1', `controls (the face's own point moved): with its centre on the edge of its letter (the pen origin) it is rejected by the horizontal rule, 0.55 em to the right and to the left it is rejected, and moved wholly above or wholly below its letter it is rejected on one side, for ${controlCount} (face, point) cases`, controlCount === FONT_CATALOG.length * CONTROL_MARKS.length && badControl.length === 0, badControl.slice(0, 6));
    }

    // ======================================================== F2 goldens
    console.log('\n# F2 one pointed line per family and weight: goldens and pairwise different');
    const hashes: Record<string, string> = {};
    {
      const pid = await project('f2 goldens');
      const clip = await addTitle(pid, GOLDEN_LINE, 'Heebo', 400, 0.06);
      for (const { fam, w, key } of combos) {
        await setTitle(pid, clip, GOLDEN_LINE, fam.family, w);
        const img = await still(pid);
        hashes[key] = sha(img.d);
        if (combos.indexOf(combos.find((c) => c.key === key)!) % 6 === 0) fs.writeFileSync(path.join(art, `golden-${fam.slug}-${w}.rgba.sha`), `${hashes[key]}\n`);
      }
      const dupes = duplicateHashes(hashes);
      check('F2', `${combos.length} goldens, all pairwise different (no family fell back to another face)`, dupes.length === 0 && Object.keys(hashes).length === combos.length, dupes);
      const gold: GoldenFile = fs.existsSync(goldenFile) ? (JSON.parse(fs.readFileSync(goldenFile, 'utf8')) as GoldenFile) : { schema: 1, line: GOLDEN_LINE, note: '', em: EM, size: { w: W, h: H }, recordings: {} };
      const lineChanged = gold.line !== GOLDEN_LINE;
      gold.schema = 1; gold.line = GOLDEN_LINE; gold.em = EM; gold.size = { w: W, h: H };
      gold.note = 'SHA-256 of the decoded RGBA pixels of the golden line, one per family and weight, per Chromium version. A first recording proves nothing by itself: it only fixes the numbers. A later run on the same Chromium that matches is the first real comparison (runs counts the matches); one that differs fails. Recorded by `pnpm proof:fonts`.';
      const prior = gold.recordings[chromiumVersion];
      let verdict: string;
      if (!prior || lineChanged) {
        gold.recordings[chromiumVersion] = { recordedAt: new Date().toISOString(), commit, runs: 0, hashes: { ...hashes } };
        verdict = 'first recording on this Chromium: nothing was compared, so this proves nothing by itself; run the proof again on the same Chromium';
        measurements.goldens = { chromium: chromiumVersion, firstRecording: true, count: Object.keys(hashes).length };
        check('F2', `goldens recorded for Chromium ${chromiumVersion} (FLAGGED: a first recording proves nothing; the next run on this Chromium is the first comparison)`, true, { recordedIn: 'docs/evidence/fonts-golden.json' });
      } else {
        const cmp = compareGolden(prior.hashes, hashes);
        const ok = cmp.differ.length === 0 && cmp.missing.length === 0 && cmp.extra.length === 0;
        if (ok) prior.runs += 1;
        verdict = ok ? `matches the recording of ${prior.recordedAt} (comparison ${prior.runs})` : 'differs from the recording';
        measurements.goldens = { chromium: chromiumVersion, firstRecording: false, compared: Object.keys(hashes).length, ...cmp, runs: prior.runs };
        check('F2', `the ${Object.keys(hashes).length} goldens equal the recording for Chromium ${chromiumVersion}`, ok, cmp);
      }
      fs.writeFileSync(goldenFile, `${JSON.stringify(gold, null, 2)}\n`);
      (measurements.goldens as Record<string, unknown>).verdict = verdict;
      check('F2', 'the golden line starts and ends with an unpointed wide letter and holds the line of the task', /^ש /.test(GOLDEN_LINE) && / ש$/.test(GOLDEN_LINE) && GOLDEN_LINE.includes(TASK_LINE));
      lap('F2');
    }

    // ======================================================== F3 preview = still = export, one family per category
    console.log('\n# F3 the editor preview, the worker still and the exported frame are the same picture (one family per category)');
    {
      const PICK = (cat: FontEntry['category']) => FONT_CATALOG.find((x) => x.category === cat);
      const chosen = (['sans', 'serif', 'display', 'handwriting'] as const).map((c) => ({ cat: c, fam: PICK(c) })).filter((x): x is { cat: FontEntry['category']; fam: FontEntry } => !!x.fam);
      // sans: prefer a title family (Fredoka) over the first catalogue row so the new files are the ones tested
      const picks = chosen.map((x) => ({ cat: x.cat, fam: x.cat === 'sans' ? (FONT_CATALOG.find((y) => y.family === 'Fredoka') ?? x.fam) : x.fam }));
      const pid = await project('f3 parity');
      const clip = await addTitle(pid, GOLDEN_LINE, 'Heebo', 400, 0.06);
      const page: Page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${s.ownerUrl}&project=${pid}`);
      await page.locator('canvas[data-testid=preview]').waitFor();
      const previewRgba = async (): Promise<Img | null> => {
        const got: string = await page.evaluate(() => {
          const c = document.querySelector<HTMLCanvasElement>('canvas[data-testid=preview]');
          if (!c) return '';
          const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
          let str = ''; for (let i = 0; i < d.length; i += 0x8000) str += String.fromCharCode(...d.subarray(i, i + 0x8000));
          return `${c.width}x${c.height}:${btoa(str)}`;
        });
        if (!got) return null;
        const [size, data] = got.split(':');
        const [w, h] = size!.split('x').map(Number);
        return { w: w!, h: h!, d: new Uint8Array(Buffer.from(data!, 'base64')) };
      };
      const BAR = 50;
      const rows: { category: string; family: string; weight: number; previewIdentical: boolean; maxDifference: number | null; planePsnr: ReturnType<typeof planePsnr> | null; exportError?: unknown }[] = [];
      const stills: Record<string, Img> = {}, expPlanes: Record<string, Buffer> = {}, refPlanes: Record<string, Buffer> = {};
      for (const { cat, fam } of picks) {
        const w = fam.weights[fam.weights.length - 1]!;
        await setTitle(pid, clip, GOLDEN_LINE, fam.family, w);
        const ref = await still(pid);
        stills[fam.family] = ref;
        let prev: Img | null = null, same = false;
        for (let i = 0; i < 200 && !same; i++) { await sleep(100); prev = await previewRgba(); same = !!prev && prev.w === W && prev.h === H && maxDiff(prev, ref) === 0; }
        refPlanes[fam.family] = planesOfRgba(ref.d);
        const out = await exportFile(pid, `f3-${fam.slug}.mp4`);
        let planes: ReturnType<typeof planePsnr> | null = null;
        if (typeof out === 'string') {
          expPlanes[fam.family] = ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-']);
          planes = planePsnr(expPlanes[fam.family]!, refPlanes[fam.family]!);
        }
        rows.push({ category: cat, family: fam.family, weight: w, previewIdentical: same, maxDifference: prev && prev.w === W && prev.h === H ? maxDiff(prev, ref) : null, planePsnr: planes, ...(typeof out === 'string' ? {} : { exportError: out.error }) });
      }
      await page.close();
      const wrong = picks.map(({ fam }, i) => { const other = picks[(i + 1) % picks.length]!.fam; return { export: fam.family, stillOf: other.family, planePsnr: expPlanes[fam.family] ? planePsnr(expPlanes[fam.family]!, refPlanes[other.family]!) : null }; });
      measurements.parity = { rows, barDb: BAR, pageErrors: errors.slice(0, 5), controls: wrong, method: `the first frame of the export decoded to its own planes (yuv420p) against the still converted to them (${TO_EXPORT_PLANES}); per plane, 255 as the peak` };
      check('F3', `the paused editor preview is byte-identical to the worker's still for ${picks.map((p) => p.fam.family).join(', ')} (one family per category)`, picks.length === 4 && rows.every((r) => r.previewIdentical), rows.map((r) => ({ f: r.family, same: r.previewIdentical, max: r.maxDifference })));
      check('F3', `and the exported frame is the still in the export's own planes: Y, U and V each at least ${BAR} dB`, picks.length === 4 && rows.every((r) => r.planePsnr !== null && r.planePsnr.min >= BAR), rows.map((r) => ({ f: r.family, psnr: r.planePsnr?.min ?? r.exportError })));
      check('F3', `control: each export is under ${BAR} dB against another family's still`, wrong.every((r) => r.planePsnr !== null && r.planePsnr.min < BAR), wrong);
      lap('F3');
    }

    // ======================================================== F4 cost
    console.log('\n# F4 what the fonts cost: load time and bytes');
    {
      const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
      const page = await ctx.newPage();
      await page.goto(s.ownerUrl);
      await page.waitForLoadState('networkidle');
      const faces = FONT_CATALOG.flatMap((fam) => fam.weights.map((w) => ({ spec: `${w} 32px "${fam.family}"`, hebrew: fam.hebrew })));
      const timing = await page.evaluate(async (list) => {
        const t0 = performance.now();
        const missing: string[] = [];
        await Promise.all(list.map(async (x) => {
          const [he, la] = await Promise.all([document.fonts.load(x.spec, 'אבג שָׁלוֹם'), document.fonts.load(x.spec, 'ABC abc 0123')]);
          if ((x.hebrew && he.length === 0) || la.length === 0) missing.push(x.spec);
        }));
        const ms = performance.now() - t0;
        const files = performance.getEntriesByType('resource').filter((e) => /\.woff2?($|\?)/.test(e.name)).map((e) => ({ name: e.name.split('/').pop()!, bytes: (e as PerformanceResourceTiming).encodedBodySize }));
        return { ms, missing, files };
      }, faces);
      await ctx.close();
      const bundle = bundleOf(FONT_CATALOG);
      const sum = (k: 'woff2' | 'woff' | 'emittedWoff2' | 'emittedWoff', rows = bundle.rows) => rows.reduce((n, r) => n + r[k], 0);
      const titleRows = bundle.rows.filter((r) => ['Suez One', 'David Libre', 'Karantina', 'Amatic SC', 'Fredoka', 'Gveret Levin'].includes(r.family));
      const uiCss = fs.readFileSync(path.join(root, 'apps/web/src/ds/uiFonts.css'), 'utf8');
      const alreadyInUi = titleRows.filter((r) => uiCss.includes(`@fontsource/${FONT_CATALOG.find((x) => x.family === r.family)!.slug}/`));
      measurements.cost = {
        ensureFontsLikeMs: Number(timing.ms.toFixed(0)), faces: faces.length, missing: timing.missing, loadedFontFiles: timing.files.length, loadedWoff2Bytes: timing.files.filter((x) => x.name.endsWith('.woff2')).reduce((n, x) => n + x.bytes, 0),
        note: 'ensureFontsLikeMs: the browser loading every face of FONT_CATALOG for Hebrew and Latin samples from a page that has not used them yet (the work of ensureFonts, apps/web/src/fonts.ts), on this machine over loopback.',
        bundle: {
          builtFrom: bundle.dist ? 'apps/web/dist' : 'missing',
          catalogueWoff2Bytes: sum('woff2'), catalogueWoffBytes: sum('woff'), catalogueWoff2PlusWoffBytes: sum('woff2') + sum('woff'),
          titleFamiliesWoff2Bytes: sum('woff2', titleRows), titleFamiliesWoff2PlusWoffBytes: sum('woff2', titleRows) + sum('woff', titleRows),
          karantinaAlreadyInInterfaceBytes: sum('woff2', alreadyInUi), titleFamiliesNewWoff2Bytes: sum('woff2', titleRows) - sum('woff2', alreadyInUi),
          emittedWoff2Bytes: sum('emittedWoff2'), emittedWoff2PlusWoffBytes: sum('emittedWoff2') + sum('emittedWoff'),
          perFamily: bundle.rows, planExpected: 374552, note: HELD_BACK_NOTE,
        },
      };
      check('F4', `every face of the catalogue (${faces.length}) loads in the browser for Hebrew and Latin (ensureFonts would not throw); ${timing.ms.toFixed(0)} ms`, timing.missing.length === 0, timing.missing);
      check('F4', 'the build emitted every catalogue file exactly once (woff2 and woff, hebrew and latin, each weight)', bundle.dist && bundle.rows.every((r) => r.built && r.onceEach), bundle.rows.filter((r) => !r.onceEach || !r.built).map((r) => r.family));
      check('F4', `bundle: woff2 ${sum('woff2')} bytes for the catalogue, ${sum('woff2', titleRows)} for the six title families (${sum('woff2', titleRows) - sum('woff2', alreadyInUi)} not already in the interface), woff2 + woff ${sum('woff2') + sum('woff')}`, true);
      lap('F4');
    }
  } finally {
    await browser.close();
    await s.close();
  }

  const failed = checks.filter((c) => !c.ok);
  const doc = {
    proof: 'fonts (ADR-0022)', commit, chromium: chromiumVersion, at: new Date().toISOString(), size: { w: W, h: H }, families: FONT_CATALOG.map((x) => ({ family: x.family, weights: x.weights, category: x.category })),
    checks, measurements, passed: failed.length === 0, seconds: Math.round((Date.now() - started) / 1000),
    note: 'Goldens are recorded in docs/evidence/fonts-golden.json. A first recording of goldens proves nothing by itself.',
  };
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} proof:fonts: ${checks.length - failed.length}/${checks.length} checks`);
  if (failed.length) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
