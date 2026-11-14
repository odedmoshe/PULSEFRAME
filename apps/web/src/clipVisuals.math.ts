/** Pure math for clip filmstrips and waveforms. No DOM. Times stay rational; only pixel positions are floats. */
import type { RationalTime, Rate } from '@pulseframe/time';

export interface WaveformLevel { samplesPerBucket: number; buckets: number; byteOffset: number }

const PPM = 1_000_000n;
const floorDiv = (a: bigint, b: bigint) => {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
};

/**
 * Source time at a pixel position within a clip: sourceIn + (px / widthPx) * duration.
 * The pixel fraction is quantised to 1e-6, then everything else is exact bigint arithmetic.
 * Returned as the numerator/denominator pair `n / d` seconds (d > 0).
 */
function sourceTimeAt(sourceIn: RationalTime, duration: RationalTime, widthPx: number, px: number): { n: bigint; d: bigint } {
  const frac = widthPx > 0 ? px / widthPx : 0;
  const ppm = BigInt(Math.round(Math.min(Math.max(frac, 0), 1) * 1e6));
  const sv = BigInt(sourceIn.value), st = BigInt(sourceIn.timescale);
  const dv = BigInt(duration.value), dt = BigInt(duration.timescale);
  return { n: sv * dt * PPM + dv * ppm * st, d: st * dt * PPM };
}

/** Index into `frameIndices` of the thumbnail nearest (by source frame) to the slot centre; ties go to the lower. */
export function thumbnailIndexForSlot(p: {
  sourceIn: RationalTime; duration: RationalTime; widthPx: number; slotCentrePx: number; frameRate: Rate; frameIndices: readonly number[];
}): number {
  if (p.frameIndices.length === 0) return 0;
  const t = sourceTimeAt(p.sourceIn, p.duration, p.widthPx, p.slotCentrePx);
  const frame = Number(floorDiv(t.n * BigInt(p.frameRate.num), t.d * BigInt(p.frameRate.den)));
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < p.frameIndices.length; i++) {
    const dist = Math.abs(p.frameIndices[i]! - frame);
    if (dist < bestDist || (dist === bestDist && p.frameIndices[i]! < p.frameIndices[best]!)) { best = i; bestDist = dist; }
  }
  return best;
}

/** Coarsest level whose bucket still gives >= 1 bucket per device pixel; the finest level if none does. */
export function pickWaveformLevel(levels: readonly WaveformLevel[], samplesInRange: number, devicePixels: number): WaveformLevel {
  const sorted = [...levels].sort((a, b) => a.samplesPerBucket - b.samplesPerBucket);
  const perPixel = samplesInRange / Math.max(1, devicePixels);
  let pick = sorted[0]!;
  for (const l of sorted) if (l.samplesPerBucket <= perPixel) pick = l;
  return pick;
}

/**
 * (min,max) Int16 pairs per column over samples [firstSample, firstSample+sampleCount) at the display sample rate.
 * Buckets overlapping a column's sample range are folded (min of mins, max of maxes); a partially covered
 * bucket counts whole (peaks are not resolvable below bucket size). Columns with no buckets yield (0,0).
 * `view` holds little-endian Int16 (min,max) pairs; the level's `byteOffset` is relative to the view start.
 */
export function peaksForColumns(p: { view: DataView; level: WaveformLevel; firstSample: number; sampleCount: number; columns: number }): Int16Array {
  const { view, level, firstSample, sampleCount, columns } = p;
  const out = new Int16Array(Math.max(0, columns) * 2);
  const spb = level.samplesPerBucket;
  for (let i = 0; i < columns; i++) {
    const s0 = firstSample + Math.floor((i * sampleCount) / columns);
    const s1 = firstSample + Math.floor(((i + 1) * sampleCount) / columns);
    if (s1 <= 0 && s0 < 0) continue;
    const b0 = Math.max(0, Math.floor(s0 / spb));
    const b1 = Math.min(level.buckets, Math.max(Math.ceil(s1 / spb), Math.floor(s0 / spb) + 1));
    if (b0 >= b1) continue;
    let lo = 32767, hi = -32768;
    for (let b = b0; b < b1; b++) {
      const o = level.byteOffset + b * 4;
      if (o + 4 > view.byteLength) break;
      const mn = view.getInt16(o, true), mx = view.getInt16(o + 2, true);
      if (mn < lo) lo = mn;
      if (mx > hi) hi = mx;
    }
    if (hi < lo) continue;
    out[i * 2] = lo;
    out[i * 2 + 1] = hi;
  }
  return out;
}

/** Exact sample index nearest to `t` at `sampleRate` (half rounds up), from the rational time. */
export function sampleIndexNearest(t: RationalTime, sampleRate: number): number {
  const num = BigInt(t.value) * BigInt(sampleRate);
  const den = BigInt(t.timescale);
  return Number(floorDiv(2n * num + den, 2n * den));
}
