/**
 * The pure maths of the moments job (wave 5 family film, ADR-0026), exactly as stated in core momentsContract.ts: integer
 * results, a fixed evaluation order, ties to the lowest index, no I/O, no clock, no random source. Heuristic («היוריסטיקה»):
 * measured motion, sharpness, brightness and sound level with fixed rules. No model; faces are not used.
 *
 * Choices this file makes where the contract leaves room (all heuristic, all stated here and in the job's data file):
 * - Percentiles and medians are order statistics of the sorted values (p20 = sorted[floor((n-1)·20/100)], median =
 *   sorted[floor((n-1)/2)]), so every statistic is one of the measured integers.
 * - The z statistics (p20, MAD) are taken over every sample of the file, gated or not.
 * - A picture sample stands for its own source frame k·S and covers [k·S, (k+1)·S); its sound level is the loudest hop whose
 *   time [0.1h, 0.1(h+1)) meets the sample's source time span (core sourceTimeOfFrame, so the start offset counts).
 * - A peak lies on a sample that is not gated and has interest of its own of at least minInterest (so a peak never sits on a still sample next to a
 *   moment, reached only by the smoothing); its clean stretch is the run of ungated samples around it (a hard cut is gated,
 *   so it is never crossed), at most maxStretchSeconds each way.
 * - Window values are taken over the peak ± coreSeconds inside the clean stretch: motion = mean inner, level = mean sample
 *   level minus the file's median hop level (dB, one decimal), sharp = mean sharp / the file's median sharp, luma = mean luma.
 * - A window's basis lists each signal whose share of the peak's smoothed interest is at least minInterest / 2; when neither
 *   reaches that, the larger share (inner motion on a tie).
 */
import { MOMENTS_GATES, MOMENTS_HOP_MS, momentsStep, hopOfBucket, type MOMENT_BASES, type MomentsFile, type MomentWindow, type PictureSeries, type SoundSeries } from '@pulseframe/core';
import type { GreyFrame } from './vision/types.ts';

type MomentBasis = (typeof MOMENT_BASES)[number];
export interface PictureSample { luma: number; sharp: number; inner: number; pan: number; change: number; /** the search could not measure the camera move (a whip pan): the best shift lies on the border of the search, or a nonzero best shift leaves at least 80 % of a clear unshifted difference that reaches 90 % of the detailed box columns and rows */ border: boolean }

const G = MOMENTS_GATES;
/** A 4×4 box sum (0..4080) is full scale at this value. */
const BOX_FULL = 16 * 255;

/** 4×4 box sums of a grey frame (floor(W/4) × floor(H/4)); integers 0..4080. */
export function boxImage(f: GreyFrame): { w: number; h: number; data: Int32Array } {
  const w = Math.floor(f.width / 4), h = Math.floor(f.height / 4), data = new Int32Array(w * h), W = f.width, src = f.data;
  for (let by = 0; by < h; by++)
    for (let bx = 0; bx < w; bx++) {
      let s = 0;
      for (let y = by * 4; y < by * 4 + 4; y++) { const o = y * W + bx * 4; s += src[o]! + src[o + 1]! + src[o + 2]! + src[o + 3]!; }
      data[by * w + bx] = s;
    }
  return { w, h, data };
}

/** The search half-width that fits the box image (MOMENTS_GATES.shiftSearch, smaller only for tiny pictures). */
export const searchOf = (bw: number, bh: number): number => Math.max(0, Math.min(G.shiftSearch, Math.floor((bw - 1) / 2), Math.floor((bh - 1) / 2)));

/**
 * The best whole-picture shift of `cur` against `prev` (box images of the same size): every (dx, dy) in [-s, s]² compared by
 * the sum of |cur(x, y) - prev(x + dx, y + dy)| over the same inner window (margin s); ties to the smallest |d|, then the
 * lowest dy, then the lowest dx. Returns the shift, its SAD, the SAD without a shift (sad0) and the window's pixel count.
 */
export function bestShift(prev: Int32Array, cur: Int32Array, bw: number, bh: number): { dx: number; dy: number; sad: number; sad0: number; n: number; search: number } {
  const s = searchOf(bw, bh);
  const x0 = s, x1 = bw - s, y0 = s, y1 = bh - s, n = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (n === 0) return { dx: 0, dy: 0, sad: 0, sad0: 0, n: 0, search: s };
  const sadAt = (dx: number, dy: number, limit: number) => {
    let sad = 0;
    for (let y = y0; y < y1 && sad <= limit; y++) {
      const oc = y * bw, op = (y + dy) * bw + dx;
      for (let x = x0; x < x1; x++) { const d = cur[oc + x]! - prev[op + x]!; sad += d < 0 ? -d : d; }
    }
    return sad;
  };
  // (0, 0) first: it wins every tie, so a sum that grows past the best so far can stop early without changing the result
  const sad0 = sadAt(0, 0, Infinity);
  let best = sad0, bdx = 0, bdy = 0;
  for (let dy = -s; dy <= s; dy++)
    for (let dx = -s; dx <= s; dx++) {
      if (dx === 0 && dy === 0) continue;
      const sad = sadAt(dx, dy, best);
      if (sad > best) continue;
      if (sad < best || dx * dx + dy * dy < bdx * bdx + bdy * bdy) { best = sad; bdx = dx; bdy = dy; } // a tie: smaller |d| (lower dy, dx are visited first)
    }
  return { dx: bdx, dy: bdy, sad: best, sad0, n, search: s };
}
/** A nonzero best shift that removes less than a fifth of the unshifted difference does not explain the change (see pictureSample). */
export const UNEXPLAINED_SHIFT_RATIO = 0.8;
/**
 * ... when the unshifted difference reaches at least this share of the picture's box columns AND of its box rows, both counted
 * among the lines that have detail (a camera move changes the picture across its whole width and height wherever there is
 * detail to move; a flat band such as a clear sky or the film fixture's barcode strip cannot change and does not count). A
 * subject over a still detailed background changes only what it sweeps, so it trips this only when its swept area spans 90 %
 * of both the width and the height.
 */
export const UNEXPLAINED_EXTENT = 0.9;
/** A box column (row) is reached when at least this share of its box pixels changed, and has detail when at least this share of them has detail. */
export const EXTENT_LINE_SHARE = 0.25;
/** A box pixel counts as changed when its 4×4 sum moves by more than this (8 grey levels on average); it has detail when it differs by more than this from its right or lower neighbour in either frame. */
const SPREAD_BOX_DIFF = 128;
const spans = (e: { cols: number; rows: number }): boolean => e.cols >= UNEXPLAINED_EXTENT && e.rows >= UNEXPLAINED_EXTENT;

/**
 * The shares of the box columns and box rows of the whole box image that the unshifted difference reaches, each among the
 * lines that have detail or are reached (see EXTENT_LINE_SHARE); 0 when no line counts.
 */
export function changedExtent(prev: Int32Array, cur: Int32Array, bw: number, bh: number): { cols: number; rows: number } {
  const colC = new Int32Array(bw), rowC = new Int32Array(bh), colD = new Int32Array(bw), rowD = new Int32Array(bh);
  const far = (a: number, b: number) => a - b > SPREAD_BOX_DIFF || b - a > SPREAD_BOX_DIFF;
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      if (far(cur[i]!, prev[i]!)) { colC[x]!++; rowC[y]!++; }
      const detail = (x + 1 < bw && (far(prev[i]!, prev[i + 1]!) || far(cur[i]!, cur[i + 1]!))) || (y + 1 < bh && (far(prev[i]!, prev[i + bw]!) || far(cur[i]!, cur[i + bw]!)));
      if (detail) { colD[x]!++; rowD[y]!++; }
    }
  const share = (changed: Int32Array, detail: Int32Array, len: number) => {
    let reached = 0, counted = 0;
    for (let k = 0; k < changed.length; k++) {
      const r = changed[k]! >= EXTENT_LINE_SHARE * len;
      if (r) reached++;
      if (r || detail[k]! >= EXTENT_LINE_SHARE * len) counted++;
    }
    return counted ? reached / counted : 0;
  };
  return { cols: share(colC, colD, bh), rows: share(rowC, rowD, bw) };
}

/** Mean Sobel gradient energy (gx² + gy²) over the interior pixels, divided by 16, rounded, capped at 65535. */
export function sharpness(f: GreyFrame): number {
  const W = f.width, H = f.height, p = f.data;
  if (W < 3 || H < 3) return 0;
  let sum = 0;
  for (let y = 1; y < H - 1; y++) {
    const a = (y - 1) * W, b = y * W, c = (y + 1) * W;
    let rowSum = 0;
    for (let x = 1; x < W - 1; x++) {
      const gx = p[a + x + 1]! + 2 * p[b + x + 1]! + p[c + x + 1]! - p[a + x - 1]! - 2 * p[b + x - 1]! - p[c + x - 1]!;
      const gy = p[c + x - 1]! + 2 * p[c + x]! + p[c + x + 1]! - p[a + x - 1]! - 2 * p[a + x]! - p[a + x + 1]!;
      rowSum += gx * gx + gy * gy;
    }
    sum += rowSum; // integers: exact in a double (at most ~2.1e6 per pixel)
  }
  return Math.min(65535, Math.round(sum / ((W - 2) * (H - 2)) / 16));
}

/** Mean grey, rounded (0..255). */
export function meanLuma(f: GreyFrame): number {
  let s = 0;
  for (let i = 0; i < f.data.length; i++) s += f.data[i]!;
  return f.data.length ? Math.round(s / f.data.length) : 0;
}

/** One picture sample against the previous one (null for the first: inner, pan and change are 0). */
export function pictureSample(prev: GreyFrame | null, cur: GreyFrame, samplesPerSecond: number): PictureSample {
  const luma = meanLuma(cur), sharp = sharpness(cur);
  if (!prev) return { luma, sharp, inner: 0, pan: 0, change: 0, border: false };
  if (prev.width !== cur.width || prev.height !== cur.height) throw new RangeError('pictureSample: frames of different sizes');
  const B = boxImage(cur), P = boxImage(prev);
  let diff = 0;
  for (let i = 0; i < B.data.length; i++) { const d = B.data[i]! - P.data[i]!; diff += d < 0 ? -d : d; }
  const change = B.data.length ? Math.min(1000, Math.round((1000 * diff) / (B.data.length * BOX_FULL))) : 0;
  const s = bestShift(P.data, B.data, B.w, B.h);
  if (s.n === 0) return { luma, sharp, inner: change, pan: 0, change, border: false };
  const inner = Math.min(1000, Math.round((1000 * s.sad) / (s.n * BOX_FULL)));
  const pan = Math.min(10000, Math.round((1000 * Math.sqrt(s.dx * s.dx + s.dy * s.dy) * samplesPerSecond) / Math.max(B.w, B.h)));
  // The search could not measure the camera move (gated as a whip pan): its best shift lies on the border of the search, OR
  // (heuristic, added after the film fixture's 1219 permille/s decoy showed the border rule alone misses most of a fast pan)
  // a nonzero best shift explains less than a fifth of a clear unshifted difference that reaches at least 90 % of the
  // box columns and of the box rows that have detail: a move beyond the search makes every shift about equally wrong, so the
  // minimum lands on a random shift, and the picture changed across its whole width and height wherever it has detail (a flat
  // band, such as a clear sky or the film fixture's barcode strip, cannot change and does not count). A subject moving over a
  // still detailed background changes only what it sweeps: unless the swept area spans 90 % of both the width and the height,
  // this rule leaves it alone. (A subject moving faster than the search can still trip the contract's border rule.)
  const onBorder = s.search > 0 && Math.max(Math.abs(s.dx), Math.abs(s.dy)) === s.search;
  const unexplained = (s.dx !== 0 || s.dy !== 0) && Math.round((1000 * s.sad0) / (s.n * BOX_FULL)) >= G.activeMotionPermille && s.sad >= UNEXPLAINED_SHIFT_RATIO * s.sad0 && spans(changedExtent(P.data, B.data, B.w, B.h));
  const border = onBorder || unexplained;
  return { luma, sharp, inner, pan, change, border };
}

/** Level per hop of MOMENTS_HOP_MS from the waveform's level-0 min/max pairs (256 samples each at 48 kHz): dBFS x 10, floor -1000; bucket b belongs to hop hopOfBucket(b). */
export function soundLevels(peaks: Int16Array, totalSamples: number): number[] {
  const buckets = Math.floor(peaks.length / 2);
  const hops = Math.max(0, Math.ceil(totalSamples / ((48000 * MOMENTS_HOP_MS) / 1000)));
  const sum = new Float64Array(hops), count = new Int32Array(hops);
  for (let b = 0; b < buckets; b++) {
    const h = hopOfBucket(b);
    if (h >= hops) break;
    const lo = peaks[2 * b]!, hi = peaks[2 * b + 1]!;
    sum[h] = sum[h]! + Math.max(Math.abs(lo), Math.abs(hi)) / 32768;
    count[h] = count[h]! + 1;
  }
  const out: number[] = [];
  for (let h = 0; h < hops; h++) {
    const mean = count[h]! ? sum[h]! / count[h]! : 0;
    out.push(Math.max(-1000, Math.min(0, Math.round(200 * Math.log10(Math.max(1e-5, mean))))));
  }
  return out;
}

/**
 * The gate series of measured picture samples (1 = gated): dark, blown, whip pan (pan over the threshold OR the search could
 * not measure the move: the sample's border flag, see pictureSample; widened by one sample each side), blur (sharp under blurRatio × the file's median), and hard cut
 * (change and inner both over their thresholds: splits the clean stretch and has zero interest).
 */
export function pictureGates(s: { luma: readonly number[]; sharp: readonly number[]; inner: readonly number[]; pan: readonly number[]; change: readonly number[]; border: readonly boolean[] }): number[] {
  const n = s.luma.length;
  const medSharp = median(s.sharp);
  const whip = Array.from({ length: n }, (_, k) => s.pan[k]! > G.whipPanPermillePerSecond || s.border[k] === true);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const dark = s.luma[k]! < G.darkLuma, blown = s.luma[k]! > G.blownLuma;
    const whipped = whip[k] || (k > 0 && whip[k - 1]!) || (k + 1 < n && whip[k + 1]!);
    const blur = s.sharp[k]! < G.blurRatio * medSharp;
    out.push(dark || blown || whipped || blur || isCut(s.change[k]!, s.inner[k]!) ? 1 : 0);
  }
  return out;
}
export const isCut = (change: number, inner: number): boolean => change > G.cutChangePermille && inner > G.cutInnerPermille;

/** Order statistics (see the file header). */
const sorted = (xs: readonly number[]) => [...xs].sort((a, b) => a - b);
export const median = (xs: readonly number[]): number => (xs.length ? sorted(xs)[Math.floor((xs.length - 1) / 2)]! : 0);
export const percentile = (xs: readonly number[], p: number): number => (xs.length ? sorted(xs)[Math.floor(((xs.length - 1) * p) / 100)]! : 0);
/** Robust z centred on the 20th percentile, clipped to [0, zClip]: (x - p20) / (1.4826·median|x - p20| + madFloorShare·fullScale). */
export function robustZ(xs: readonly number[], fullScale: number): number[] {
  if (!xs.length) return [];
  const c = percentile(xs, G.zCentrePercentile);
  const mad = median(xs.map((x) => Math.abs(x - c)));
  const den = 1.4826 * mad + G.madFloorShare * fullScale;
  return xs.map((x) => Math.min(G.zClip, Math.max(0, (x - c) / den)));
}

/** The source-time span of picture sample k as a range of hops [h0, h1] (inclusive), with the picture's start offset. */
export function hopsOfSample(k: number, step: number, frames: number, rate: { num: number; den: number }, startOffsetFrames: number): [number, number] {
  const f0 = k * step + startOffsetFrames, f1 = Math.min(frames, (k + 1) * step) + startOffsetFrames;
  const perHop = 1000 / MOMENTS_HOP_MS; // hops per second
  const h0 = Math.floor((f0 * rate.den * perHop) / rate.num);
  const h1 = Math.max(h0, Math.ceil((f1 * rate.den * perHop) / rate.num) - 1);
  return [h0, h1];
}
/** The source frame of the video stream shown at the start of hop h (core sourceFrameOfTime, integer arithmetic). */
export const frameOfHop = (h: number, rate: { num: number; den: number }, startOffsetFrames: number): number =>
  Math.max(0, Math.floor((h * rate.num * MOMENTS_HOP_MS) / (1000 * rate.den)) - startOffsetFrames);

/** Candidate moments from the series (gates, robust z centred on the 20th percentile, peaks, clean stretches) and the file-level values. */
export function findMoments(picture: PictureSeries | null, sound: SoundSeries | null, asset: { frames: number; rate: { num: number; den: number }; startOffsetFrames: number }): { flat: boolean; windows: MomentWindow[]; file: MomentsFile } {
  const { frames, rate, startOffsetFrames: off } = asset;
  const step = picture?.step ?? momentsStep(rate);
  const K = picture ? picture.count : Math.ceil(frames / step);
  const sps = rate.num / rate.den / step;
  const file: MomentsFile = { motion: picture && K ? median(picture.inner) : null, level: sound && sound.count ? median(sound.level) : null };
  if (!K || (!picture && !sound)) return { flat: true, windows: [], file };
  // sound level per picture sample: the loudest hop the sample's source time meets (silence past the end of the sound)
  const level: number[] | null = sound ? Array.from({ length: K }, (_, k) => {
    const [h0, h1] = hopsOfSample(k, step, frames, rate, off);
    let m = -1000;
    for (let h = h0; h <= h1 && h < sound.count; h++) if (sound.level[h]! > m) m = sound.level[h]!;
    return m;
  }) : null;
  const gate = picture ? picture.gated.map((g) => (g ? 0 : 1)) : new Array<number>(K).fill(1);
  const zi = picture ? robustZ(picture.inner, 1000) : null, zl = level ? robustZ(level, 1000) : null;
  const wi = zi && zl ? 0.5 : zi ? 1 : 0, wl = zi && zl ? 0.5 : zl ? 1 : 0;
  const partI = Array.from({ length: K }, (_, k) => gate[k]! * wi * (zi?.[k] ?? 0));
  const partL = Array.from({ length: K }, (_, k) => gate[k]! * wl * (zl?.[k] ?? 0));
  const R = Math.round(G.coreSeconds * sps), size = 2 * R + 1;
  const smooth = (xs: number[]) => { const out: number[] = []; for (let k = 0; k < K; k++) { let s = 0; for (let j = Math.max(0, k - R); j <= Math.min(K - 1, k + R); j++) s += xs[j]!; out.push(s / size); } return out; };
  const sI = smooth(partI), sL = smooth(partL);
  const score = sI.map((v, k) => v + sL[k]!);
  const sep = Math.round(G.separationSeconds * sps), maxStretch = Math.round(G.maxStretchSeconds * sps);
  const suppressed = new Uint8Array(K);
  const windows: MomentWindow[] = [];
  const medSharp = picture ? median(picture.sharp) : 0;
  const fileLevel = file.level;
  while (windows.length < 4) {
    let best = -1;
    for (let k = 0; k < K; k++) if (!suppressed[k] && gate[k] && partI[k]! + partL[k]! >= G.minInterest && (best < 0 || score[k]! > score[best]!)) best = k;
    if (best < 0 || !(score[best]! >= G.minInterest)) break;
    for (let j = Math.max(0, best - sep); j <= Math.min(K - 1, best + sep); j++) suppressed[j] = 1;
    let a = best, b = best;
    while (a > 0 && gate[a - 1] && best - (a - 1) <= maxStretch) a--;
    while (b + 1 < K && gate[b + 1] && b + 1 - best <= maxStretch) b++;
    const fromFrame = a * step, toFrame = Math.min(frames, (b + 1) * step), peakFrame = best * step;
    const c0 = Math.max(a, best - R), c1 = Math.min(b, best + R), cn = c1 - c0 + 1;
    const mean = (xs: readonly number[]) => { let s = 0; for (let j = c0; j <= c1; j++) s += xs[j]!; return s / cn; };
    const basis: MomentBasis[] = [];
    const half = G.minInterest / 2;
    if (picture && sI[best]! >= half) basis.push('inner-motion');
    if (sound && sL[best]! >= half) basis.push('sound');
    if (!basis.length) basis.push(picture && (!sound || sI[best]! >= sL[best]!) ? 'inner-motion' : 'sound');
    const w: MomentWindow = {
      peakFrame, fromFrame, toFrame, basis,
      motion: picture ? Math.min(1000, Math.round(mean(picture.inner))) : null,
      level: level && fileLevel !== null ? Math.max(-60, Math.min(60, Math.round(mean(level) - fileLevel) / 10)) : null,
      sharp: picture && medSharp > 0 ? Math.max(0, Math.min(9.99, Math.round((100 * mean(picture.sharp)) / medSharp) / 100)) : null,
      luma: picture ? Math.min(255, Math.round(mean(picture.luma))) : null,
    };
    if (sound && fileLevel !== null) {
      for (let h = 0; h < sound.count; h++) {
        const f = frameOfHop(h, rate, off);
        if (f >= toFrame) break;
        if (f < fromFrame) continue;
        const v = sound.level[h]!;
        if (v >= fileLevel + 10 * G.burstDb && v > 10 * G.burstFloorDbfs) { w.burstFrame = f; break; }
      }
    }
    windows.push(w);
  }
  return { flat: windows.length === 0, windows, file };
}
