/**
 * Voice measurement for voice cleanup «ניקוי קול» (ADR-0013): background-noise level in the 24 bands of the noise profile
 * (core voiceClean.ts), mains hum, speech level, peak and SNR, from interleaved stereo PCM at 48 kHz. Streaming, pure,
 * deterministic and model-free. Read-only: what it measures is returned as candidate clean_voice operations by measure_voice
 * (apps/server/src/voiceClean.ts), never stored.
 *
 * Two analyses run side by side on what is pushed:
 *  - SHORT frames, the cleanup.denoise kernel's framing at 48 kHz (fft.ts: N = 1024, hop 256, frames from the first sample
 *    pushed; a Hann window): per-frame band powers, the frame energy that finds the pauses, and per-hop sample power.
 *  - LONG frames for the low bands and the hum: the input decimated by 8 to 6 kHz (a 97-tap Kaiser low-pass, flat within 3e-5 to
 *    1.5 kHz, 90 dB down from 4.43 kHz), frames of 2048 (341 ms, 2.93 Hz per bin) every 512, a 4-term Blackman–Harris window.
 *    The 46.9 Hz bins of the short frames are too coarse for the ERB bands below 1.4 kHz (band 0 is 54 Hz wide) and cannot
 *    separate a hum line from the noise beside it.
 *
 * At finish():
 *  - Pauses (auto mode): the frame energy from 585 Hz up (above any hum line and rumble) smoothed over 3 frames; frames within 6 dB of its 5th percentile are
 *    quiet; runs of quiet frames covering at least 0.2 s are the pauses. A pause is "found" only when the rest of the recording is
 *    at least 6 dB louder; otherwise (a steady recording: noise only, a held tone, music without breaks) the levels are those of
 *    the quietest stretches, the warning is 'no_pause_found' and the confidence below 0.03.
 *  - Ranges mode (noiseRanges, seconds from the first frame pushed): the frames inside the given ranges; at least 0.3 s in total,
 *    else 'ranges_too_short' and the automatic search instead.
 *  - Band level = 10·log10 of the plain mean power (unbiased: no log averaging, no frame picked for being quiet within a pause)
 *    over the pause frames, per Hz as the core defines it. Bands 0–9 (below 1433 Hz) come from the long frames that lie wholly
 *    inside a pause when there are at least two of them, with the bins within 14.6 Hz of each of the 8 multiples of the hum left
 *    out when hum was found; else from the short frames.
 *  - Hum: on the mean long-frame spectrum over the pauses (or the whole recording when no long frame fits a pause), the lines at
 *    50·k or 60·k Hz (k ≤ 8) whose peak is at least 10 dB above the bins 6–12 bins away; hum is reported when at least two lines
 *    of one mains frequency stand out (or the fundamental by 20 dB). Level = the summed line power, dBFS RMS.
 *  - Speech: the power outside the pauses (levelDb, dBFS RMS), the sample peak, and the SNR 10·log10((P_rest − P_noise)/P_noise).
 * Memory: about 45 bytes per 48 kHz millisecond-frame of storage, 26 MB for 600 s.
 */
import { encodeNoiseProfile, NOISE_BAND_EDGES_HZ, NOISE_BANDS } from '@pulseframe/core';
import { cosPi, Fft, fftOf, sinPi } from './audiofx/fft.ts';
import { besselI0 } from './audiofx/design.ts';

export const VOICE_MEASURE_RATE = 48000;
export interface VoiceMeasureOptions { /** seconds from the first frame pushed that hold only noise; omitted = find the quietest stretches */ noiseRanges?: readonly { start: number; end: number }[] }
export interface VoiceMeasurement {
  analysedSeconds: number;
  noise: { mode: 'auto' | 'ranges'; bandsDb: number[]; profile: string; quietSeconds: number; confidence: number; ranges: { start: number; end: number }[]; warning: 'no_pause_found' | 'ranges_too_short' | null };
  hum: { hz: 50 | 60; levelDb: number; harmonics: number } | null;
  speech: { levelDb: number | null; peakDb: number; snrDb: number | null };
}
export interface VoiceMeter { push(pcm: Float32Array /* interleaved stereo at 48 kHz; mono as L = R */): void; finish(): VoiceMeasurement }

const SR = VOICE_MEASURE_RATE;
// short frames: the denoise kernel's framing at 48 kHz
const NS = 1024, HS = 256;
// long frames: decimated by 8 to 6 kHz
const DEC = 8, LR = SR / DEC, NL = 2048, HL = 512, DTAPS = 97, DCUT = 3000, DBETA = 9;
const LBINS = 513; // long-frame bins kept: 0 .. 1500 Hz
const LOW_BANDS = 10; // bands 0–9 (upper edge 1433 Hz) from the long frames
/** The frame energy that finds the pauses counts the bands from 585 Hz up: above every hum line (8 × 60 Hz) and rumble, where speech is. */
const ENERGY_FROM_BAND = 6;
const QUIET_MARGIN = Math.pow(10, 6 / 10), QUIET_PERCENTILE = 0.05, MIN_RUN = Math.round(0.2 * SR), MIN_RANGES = 0.3, PAUSE_CONTRAST_DB = 6;
const HUM_LINES = 8, HUM_PEAK = 10, HUM_FUNDAMENTAL = 100, HUM_EXCLUDE_BINS = 5;
const MIN_DB = -140;

/** Rows of `width` Float32 values, stored in chunks so a long recording never copies what it already holds. */
class Rows {
  private chunks: Float32Array[] = [];
  count = 0;
  private static readonly CHUNK = 4096;
  constructor(readonly width: number) {}
  push(row: ArrayLike<number>): void {
    const c = this.count % Rows.CHUNK;
    if (c === 0) this.chunks.push(new Float32Array(Rows.CHUNK * this.width));
    this.chunks[this.chunks.length - 1]!.set(row, c * this.width);
    this.count++;
  }
  row(i: number): Float32Array { const c = this.chunks[Math.floor(i / Rows.CHUNK)]!, o = (i % Rows.CHUNK) * this.width; return c.subarray(o, o + this.width); }
  get bytes(): number { return this.chunks.length * Rows.CHUNK * this.width * 4; }
}

const bandOf = (f: number): number => {
  if (f < NOISE_BAND_EDGES_HZ[0]! || f >= NOISE_BAND_EDGES_HZ[NOISE_BANDS]!) return -1;
  let j = 0;
  while (f >= NOISE_BAND_EDGES_HZ[j + 1]!) j++;
  return j;
};
/** Periodic windows from series (fft.ts), so the measurement is the same on every engine. */
const hann = (n: number) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * cosPi((2 * i) / n));
const blackmanHarris = (n: number) => Float64Array.from({ length: n }, (_, i) => 0.35875 - 0.48829 * cosPi((2 * i) / n) + 0.14128 * cosPi((4 * i) / n) - 0.01168 * cosPi((6 * i) / n));
const sumSq = (w: Float64Array) => w.reduce((s, v) => s + v * v, 0);
/** Kaiser-windowed sinc low-pass at DCUT, DC gain exactly 1. */
function decimationFilter(): Float64Array {
  const h = new Float64Array(DTAPS), mid = (DTAPS - 1) / 2, fc = (2 * DCUT) / SR, i0 = besselI0(DBETA);
  let sum = 0;
  for (let t = 0; t < DTAPS; t++) {
    const x = t - mid, r = x / mid, arg = fc * x;
    h[t] = fc * (arg === 0 ? 1 : sinPi(arg) / (Math.PI * arg)) * (besselI0(DBETA * Math.sqrt(Math.max(0, 1 - r * r))) / i0);
    sum += h[t]!;
  }
  for (let t = 0; t < DTAPS; t++) h[t] = h[t]! / sum;
  return h;
}

const SHORT = (() => {
  const win = hann(NS), w2 = sumSq(win), band = new Int8Array(NS / 2 + 1), count = new Float64Array(NOISE_BANDS);
  for (let k = 0; k <= NS / 2; k++) { band[k] = bandOf((k * SR) / NS); if (band[k]! >= 0) count[band[k]!]!++; }
  return { win, w2, band, count };
})();
const LONG = (() => {
  const win = blackmanHarris(NL), w2 = sumSq(win), df = LR / NL;
  return { win, w2, df, fir: decimationFilter(), /** band level of a long-frame bin power: 24000/(fs/2)/Σw² */ scale: 24000 / (LR / 2) / w2 };
})();

interface Interval { a: number; b: number } // samples [a, b)
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
const r3 = (x: number) => Math.round(x * 1000) / 1000 + 0;
const dbOf = (p: number) => 10 * Math.log10(p);

/** Streaming, pure, deterministic, model-free. Memory ≤ 64 MB for 600 s. */
export function voiceMeter(opts: VoiceMeasureOptions = {}): VoiceMeter {
  const shortFft: Fft = fftOf(NS), longFft: Fft = fftOf(NL);
  const sIn = new Float64Array(NS * 2), sRe = new Float64Array(NS), sIm = new Float64Array(NS);
  const shortRows = new Rows(NOISE_BANDS + 1); // 24 band powers (per Hz, as 10^(b/10)) and the frame energy
  const blocks = new Rows(1); // mean square per hop of 256 samples
  const longRows = new Rows(LBINS);
  const longSum = new Float64Array(LBINS);
  const row = new Float64Array(NOISE_BANDS + 1), lrow = new Float64Array(LBINS);
  const hist = new Float64Array(256 * 2); // decimator input history (L, R), ring of 256
  const dIn = new Float64Array(NL * 2), lRe = new Float64Array(NL), lIm = new Float64Array(NL);
  let n = 0, nd = 0, peak = 0, blockSum = 0;
  let finished: VoiceMeasurement | null = null;

  const shortFrame = () => {
    // frame of samples [n − NS + 1, n]
    const { win, w2, band } = SHORT;
    for (let i = 0; i < NS; i++) { const k = ((n - NS + 1 + i) % NS) * 2; sRe[i] = sIn[k]! * win[i]!; sIm[i] = sIn[k + 1]! * win[i]!; }
    shortFft.forward(sRe, sIm);
    row.fill(0);
    for (let k = 1; k < NS / 2; k++) {
      const j = band[k]!;
      if (j < 0) continue;
      const m = NS - k, p = (sRe[k]! * sRe[k]! + sIm[k]! * sIm[k]! + sRe[m]! * sRe[m]! + sIm[m]! * sIm[m]!) * 0.25;
      row[j] = row[j]! + p;
    }
    let e = 0;
    for (let j = 0; j < NOISE_BANDS; j++) { if (j >= ENERGY_FROM_BAND) e += row[j]!; row[j] = row[j]! / (SHORT.count[j]! * w2); }
    row[NOISE_BANDS] = e / w2;
    shortRows.push(row);
  };
  const longFrame = () => {
    // decimated samples [nd − NL + 1, nd]
    const { win } = LONG;
    for (let i = 0; i < NL; i++) { const k = ((nd - NL + 1 + i) % NL) * 2; lRe[i] = dIn[k]! * win[i]!; lIm[i] = dIn[k + 1]! * win[i]!; }
    longFft.forward(lRe, lIm);
    lrow[0] = (lRe[0]! * lRe[0]! + lIm[0]! * lIm[0]!) * 0.5;
    for (let k = 1; k < LBINS; k++) { const m = NL - k; lrow[k] = (lRe[k]! * lRe[k]! + lIm[k]! * lIm[k]! + lRe[m]! * lRe[m]! + lIm[m]! * lIm[m]!) * 0.25; }
    for (let k = 0; k < LBINS; k++) longSum[k] = longSum[k]! + lrow[k]!;
    longRows.push(lrow);
  };

  return {
    push(pcm: Float32Array): void {
      if (finished) throw new Error('voiceMeter: push after finish');
      const fir = LONG.fir;
      for (let i = 0; i + 1 < pcm.length; i += 2) {
        const l = pcm[i]!, r = pcm[i + 1]!;
        const s = (n % NS) * 2;
        sIn[s] = l; sIn[s + 1] = r;
        const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
        if (al > peak) peak = al;
        if (ar > peak) peak = ar;
        blockSum += (l * l + r * r) * 0.5;
        const hpos = (n & 255) * 2;
        hist[hpos] = l; hist[hpos + 1] = r;
        if (n % DEC === 0) {
          // decimated sample n/8 = Σ h[t]·x[n − t] (x before the first sample = 0)
          let yl = 0, yr = 0;
          for (let t = 0; t < DTAPS && t <= n; t++) { const k = ((n - t) & 255) * 2, c = fir[t]!; yl += c * hist[k]!; yr += c * hist[k + 1]!; }
          nd = n / DEC;
          const d = (nd % NL) * 2;
          dIn[d] = yl; dIn[d + 1] = yr;
          if (nd + 1 >= NL && (nd + 1 - NL) % HL === 0) longFrame();
        }
        if ((n + 1) % HS === 0) { blocks.push([blockSum / HS]); blockSum = 0; }
        if (n + 1 >= NS && (n + 1 - NS) % HS === 0) shortFrame();
        n++;
      }
    },
    finish(): VoiceMeasurement {
      if (finished) return finished;
      finished = analyse({ n, peak, shortRows, blocks, longRows, longSum, opts });
      return finished;
    },
  };
}

/** Short frame k covers samples [k·HS, k·HS + NS); long frame f covers decimated [f·HL, f·HL + NL), i.e. input [8·f·HL − 96, 8·(f·HL + NL − 1) + 1). */
const longSpan = (f: number): Interval => ({ a: DEC * f * HL - (DTAPS - 1), b: DEC * (f * HL + NL - 1) + 1 });
/**
 * Whether `iv` lies wholly inside one interval of `set`. The sets used here are sorted by start with their ends increasing too
 * (runs of frames, merged ranges), so the only candidate is the last interval starting at or before iv.a: a binary search.
 */
function within(iv: Interval, set: readonly Interval[]): boolean {
  let lo = 0, hi = set.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (set[mid]!.a <= iv.a) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at >= 0 && iv.b <= set[at]!.b;
}
function merge(list: Interval[]): Interval[] {
  const s = list.filter((x) => x.b > x.a).sort((x, y) => x.a - y.a), out: Interval[] = [];
  for (const x of s) { const last = out[out.length - 1]; if (last && x.a <= last.b) last.b = Math.max(last.b, x.b); else out.push({ ...x }); }
  return out;
}
const totalOf = (list: readonly Interval[]) => list.reduce((s, x) => s + (x.b - x.a), 0);

function analyse(m: { n: number; peak: number; shortRows: Rows; blocks: Rows; longRows: Rows; longSum: Float64Array; opts: VoiceMeasureOptions }): VoiceMeasurement {
  const { n, shortRows, blocks, longRows } = m, K = shortRows.count;
  const analysedSeconds = r3(n / SR);
  const peakDb = m.peak > 0 ? r2(Math.max(-200, 20 * Math.log10(m.peak))) : -200;
  if (K === 0) {
    const bandsDb = Array<number>(NOISE_BANDS).fill(MIN_DB);
    return { analysedSeconds, noise: { mode: 'auto', bandsDb, profile: encodeNoiseProfile(bandsDb), quietSeconds: 0, confidence: 0, ranges: [], warning: 'no_pause_found' }, hum: null, speech: { levelDb: null, peakDb, snrDb: null } };
  }
  const energy = new Float64Array(K);
  for (let k = 0; k < K; k++) energy[k] = shortRows.row(k)[NOISE_BANDS]!;
  const smooth = new Float64Array(K);
  for (let k = 0; k < K; k++) { const a = energy[Math.max(0, k - 1)]!, c = energy[Math.min(K - 1, k + 1)]!; smooth[k] = (a + energy[k]! + c) / 3; }
  const frameSpan = (k: number): Interval => ({ a: k * HS, b: k * HS + NS });

  // ---- which stretches hold only noise ----
  let mode: 'auto' | 'ranges' = 'auto', warning: VoiceMeasurement['noise']['warning'] = null;
  let selected: Interval[] = [];
  let pauseFound = false;
  const given = m.opts.noiseRanges;
  if (given && given.length) {
    const ivs = merge(given.map((r) => ({ a: Math.max(0, Math.round(r.start * SR)), b: Math.min(n, Math.round(r.end * SR)) })));
    const inside = Array.from({ length: K }, (_, k) => within(frameSpan(k), ivs)).filter(Boolean).length;
    if (totalOf(ivs) >= MIN_RANGES * SR && inside > 0) { mode = 'ranges'; selected = ivs; pauseFound = true; }
    else warning = 'ranges_too_short';
  }
  if (mode === 'auto') {
    const sorted = Float64Array.from(smooth).sort();
    const ref = sorted[Math.min(K - 1, Math.floor(QUIET_PERCENTILE * K))]!, thr = ref * QUIET_MARGIN;
    const quiet: Interval[] = [];
    for (let k = 0; k < K;) {
      if (!(smooth[k]! <= thr)) { k++; continue; }
      let k2 = k;
      while (k2 + 1 < K && smooth[k2 + 1]! <= thr) k2++;
      quiet.push({ a: k * HS, b: k2 * HS + NS });
      k = k2 + 1;
    }
    const runs = quiet.filter((x) => x.b - x.a >= MIN_RUN);
    selected = runs.length ? runs : quiet;
    pauseFound = runs.length > 0;
  }
  const inSel = new Uint8Array(K);
  for (let k = 0; k < K; k++) inSel[k] = within(frameSpan(k), selected) ? 1 : 0;
  let eq = 0, nq = 0, ea = 0, na = 0;
  for (let k = 0; k < K; k++) if (inSel[k]) { eq += energy[k]!; nq++; } else { ea += energy[k]!; na++; }
  const contrastDb = nq && na && eq > 0 ? dbOf((ea / na) / (eq / nq)) : 0;
  // a pause needs the rest of the recording to be louder; ranges_too_short, when set, is kept as the more specific warning
  if (mode === 'auto' && (!pauseFound || contrastDb < PAUSE_CONTRAST_DB)) { pauseFound = false; warning ??= 'no_pause_found'; }

  // ---- hum, from the long frames over the pauses (or over everything) ----
  const longSel: number[] = [];
  for (let f = 0; f < longRows.count; f++) { const s = longSpan(f); if (s.a >= 0 && s.b <= n && within(s, selected)) longSel.push(f); }
  const useLong = longSel.length >= 2;
  const spec = new Float64Array(LBINS);
  if (useLong) { for (const f of longSel) { const r = longRows.row(f); for (let b = 0; b < LBINS; b++) spec[b] = spec[b]! + r[b]!; } for (let b = 0; b < LBINS; b++) spec[b] = spec[b]! / longSel.length; }
  else if (longRows.count) for (let b = 0; b < LBINS; b++) spec[b] = m.longSum[b]! / longRows.count;
  const hum = longRows.count ? findHum(spec) : null;

  // ---- band levels ----
  const bands = new Float64Array(NOISE_BANDS);
  if (nq) {
    for (let k = 0; k < K; k++) if (inSel[k]) { const r = shortRows.row(k); for (let j = 0; j < NOISE_BANDS; j++) bands[j] = bands[j]! + r[j]!; }
    for (let j = 0; j < NOISE_BANDS; j++) bands[j] = bands[j]! / nq;
  }
  if (useLong) {
    const low = longBands(spec, hum?.hz ?? null);
    for (let j = 0; j < LOW_BANDS; j++) if (low[j] !== null) bands[j] = low[j]!;
  }
  const bandsDb = Array.from(bands, (p) => r2(Math.min(0, Math.max(MIN_DB, p > 0 ? dbOf(p) : MIN_DB))));

  // ---- speech level and SNR, per hop block ----
  let pq = 0, cq = 0, pa = 0, ca = 0;
  for (let k = 0; k < blocks.count; k++) {
    const iv = { a: k * HS, b: (k + 1) * HS }, p = blocks.row(k)[0]!;
    if (within(iv, selected)) { pq += p; cq++; } else { pa += p; ca++; }
  }
  const pNoise = cq ? pq / cq : null, pRest = ca ? pa / ca : null;
  const levelDb = pRest !== null && pRest > 0 ? r2(dbOf(pRest)) : null;
  const snrDb = pauseFound && pNoise && pRest !== null && pNoise > 0 ? r2(dbOf(Math.max(pRest - pNoise, pNoise * 1e-3) / pNoise)) : null;

  const quietSeconds = r3(totalOf(selected) / SR);
  const amountFactor = Math.min(1, quietSeconds / 2);
  const contrastFactor = Math.min(1, Math.max(0, (contrastDb - PAUSE_CONTRAST_DB) / 14));
  const confidence = r2(mode === 'ranges' ? amountFactor * (na ? Math.max(0.5, contrastFactor) : 0.5) : pauseFound ? amountFactor * contrastFactor : Math.min(0.02, amountFactor * contrastFactor));
  return {
    analysedSeconds,
    noise: { mode, bandsDb, profile: encodeNoiseProfile(bandsDb), quietSeconds, confidence, ranges: selected.map((x) => ({ start: r3(x.a / SR), end: r3(x.b / SR) })), warning },
    hum,
    speech: { levelDb, peakDb, snrDb },
  };
}

/** Lines at 50·k or 60·k Hz (k ≤ 8) at least 10 dB above the bins 6–12 bins away (not near another line of the same mains). */
function findHum(spec: Float64Array): VoiceMeasurement['hum'] {
  const df = LONG.df;
  let best: { hz: 50 | 60; lines: number[]; power: number } | null = null;
  for (const hz of [50, 60] as const) {
    const lines: number[] = [], ratios: number[] = [];
    let power = 0;
    const centres = Array.from({ length: HUM_LINES }, (_, i) => ((i + 1) * hz) / df);
    for (let i = 0; i < HUM_LINES; i++) {
      const c = centres[i]!, cb = Math.round(c);
      if (cb + 13 >= LBINS) break;
      let pk = 0;
      for (let b = cb - 1; b <= cb + 1; b++) pk = Math.max(pk, spec[b]!);
      let s = 0, cnt = 0;
      for (let b = Math.max(1, cb - 12); b <= cb + 12; b++) {
        if (Math.abs(b - c) < 6 || centres.some((o, j) => j !== i && Math.abs(b - o) < 6)) continue;
        s += spec[b]!; cnt++;
      }
      const floor = cnt ? s / cnt : 0;
      if (!(floor > 0) || !(pk >= HUM_PEAK * floor)) continue;
      lines.push(i + 1); ratios.push(pk / floor);
      // line power (mean square per channel): 2·Σ_lobe (P − floor) / (N·Σw²)
      let lobe = 0;
      for (let b = cb - 4; b <= cb + 4; b++) lobe += Math.max(0, spec[b]! - floor);
      power += (2 * lobe) / (NL * LONG.w2);
    }
    const fundamentalAlone = lines.length === 1 && lines[0] === 1 && ratios[0]! >= HUM_FUNDAMENTAL;
    if (lines.length < 2 && !fundamentalAlone) continue;
    if (!best || lines.length > best.lines.length || (lines.length === best.lines.length && power > best.power)) best = { hz, lines, power };
  }
  if (!best || !(best.power > 0)) return null;
  return { hz: best.hz, levelDb: r2(dbOf(best.power)), harmonics: Math.max(...best.lines) };
}

/** Bands 0–9 from the mean long-frame spectrum, leaving out the bins within HUM_EXCLUDE_BINS of the 8 multiples of the hum; null where no bin is left. */
function longBands(spec: Float64Array, humHz: 50 | 60 | null): (number | null)[] {
  const df = LONG.df, out: (number | null)[] = [];
  for (let j = 0; j < LOW_BANDS; j++) {
    let s = 0, cnt = 0;
    for (let b = 1; b < LBINS; b++) {
      const f = b * df;
      if (f < NOISE_BAND_EDGES_HZ[j]! || f >= NOISE_BAND_EDGES_HZ[j + 1]!) continue;
      if (humHz !== null) { let near = false; for (let k = 1; k <= HUM_LINES; k++) if (Math.abs(f - k * humHz) <= HUM_EXCLUDE_BINS * df) near = true; if (near) continue; }
      s += spec[b]!; cnt++;
    }
    out.push(cnt >= 2 ? (s / cnt) * LONG.scale : null);
  }
  // a band with no bin left takes its nearest neighbour's level
  for (let j = 0; j < LOW_BANDS; j++) if (out[j] === null) { for (let d = 1; d < LOW_BANDS; d++) { const v = out[j - d] ?? out[j + d]; if (v !== undefined && v !== null) { out[j] = v; break; } } }
  return out;
}

/** 0.35 at ≥ 30 dB SNR, falling linearly to 0.85 at ≤ 10 dB; 0.6 when the SNR is unknown. Two decimals. */
export function recommendedStrength(m: VoiceMeasurement): number {
  const snr = m.speech.snrDb;
  if (snr === null || !Number.isFinite(snr)) return 0.6;
  return r2(0.35 + 0.5 * Math.min(1, Math.max(0, (30 - snr) / 20)));
}
