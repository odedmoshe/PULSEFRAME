/**
 * Multicam on the server (ADR-0020 plan §4): sync by sound (model-free), the group view and the level envelope.
 *
 * SYNC BY SOUND, per file ("piece") of the group other than the reference angle's piece 0 (whose source time IS group time):
 * 1. Envelopes (envelope.ts): spectral flux at 100 frames a second, from the on-demand 'envelope' derivative.
 * 2. Coarse: GCC-PHAT-β (β 0.75) of the piece's zero-mean, clipped flux against a group-axis BED of flux: the reference piece 0
 *    plus every already placed piece, mapped through its sync. Lags need ≥ minOverlapSeconds (20) of overlap and
 *    |lag| ≤ maxOffsetSeconds. peakZ = (c1 − median)/(1.4826·MAD) over the allowed lags; peakRatio = c1 / the best peak more
 *    than 1 s away; the top-3 candidates (1 s apart) are kept. Capture-time priors (multicamPrior.ts) widen the search to cover
 *    them and order near-equal candidates (within 5 %) by distance from them; they are reported, never attached.
 * 3. Fine: K = clamp(overlap/60 s, 3, 12) windows of 2^17 samples at group.sampleRate, spread over the overlap, cut from ONE
 *    streaming decode of the piece (no input seek; ffmpeg stops after the last window) and one of each bed file they meet.
 *    Windows below −50 dBFS on either side are skipped. GCC-PHAT-β within ±50 ms of the lag predicted by the windows already
 *    measured (the coarse lag for the middle window; windows are measured from the middle outward, so up to 200 ppm of drift
 *    stays inside the search); the integer peak on |R|, so an inverted polarity is still found. A window whose peak is not
 *    at least 2× every other value more than 1 ms away counts as rejected.
 * 4. Fit: Theil–Sen through (piece sample, group sample), anchors more than 2 ms off dropped and the line fitted again.
 *    Drift ≤ 1 ms over the overlap: one anchor (pure offset). Line residual ≤ 2 ms: two anchors. Otherwise piecewise anchors
 *    (≤ 64), at most 'check'.
 * 5. Verdicts (SYNC_THRESHOLDS, recorded in params): no-shared-sound when peakZ < 6; ambiguous when peakRatio < 1.2;
 *    inconsistent when the residual after drops is > 5 ms or more than a quarter of the measured windows disagree with the fit
 *    (dropped or without a distinct peak: a recording that paused inside); confident: peakZ ≥ 10, peakRatio ≥ 1.5,
 *    ≥ min(3, K) anchors used and residual ≤ 1 ms; check: peakRatio ≥ 1.2, ≥ 2 anchors, residual ≤ 5 ms. The last three
 *    without a placement attach NO anchors. A file with no sound, or less overlap than the minimum, is reported and not attached.
 * 6. Chaining: pieces that did not place are tried again (up to 3 rounds) against a bed grown by the pieces placed in the
 *    round before (chainDepth = the round), so camera restarts and card changes chain through each other.
 *
 * COMMIT: gov.assertMayAct(edit), assertUnrestricted, refuse a hand-synced piece without overwrite (409 would_discard_edits),
 * measure, re-check the group (its pieces' files and the hand-synced rule), then ONE store.commit with allowInternal and ONE
 * attach_multicam_sync. dryRun commits nothing and needs only 'observe'. Background: a durable 'analysis' job with input.kind
 * MULTICAM_SYNC_KIND, stage text from multicamSyncStage, cancel checked between pieces, recovered by recoverAnalysisJobs.
 * Thresholds are tuned on synthetic speech only (wave4-decisions.md).
 */
import { spawn } from 'node:child_process';
import * as T from '@pulseframe/time';
import {
  capturePriors, MULTICAM_SYNC_KIND, MULTICAM_SYNC_METHOD, MULTICAM_REFUSALS, multicamGroupOf, multicamSyncStage, segmentSyncOffset, SYNC_THRESHOLDS, isPlacedVerdict, timeOriginSeconds,
  MAX_ANCHORS_PER_PIECE, MAX_SYNC_CANDIDATES,
  type Asset, type MulticamGroup, type MulticamPieceReport, type MulticamPieceWhy, type MulticamSyncReport, type MulticamSyncRequest, type MulticamView, type ProjectDocument, type SyncAnchor, type SyncQuality, type SyncVerdict,
} from '@pulseframe/core';
import { heavy } from './analysis.ts';
import type { Principal } from './auth.ts';
import type { Derivatives } from './derive.ts';
import { ANALYSIS_TIMEOUT_MS, fftMag } from './dsp.ts';
import { EnvelopeAbandoned, envelopeOf, envelopeStatus } from './envelope.ts';
import type { Governance } from './governance.ts';
import { ApiError, type JobRow, type Store } from './store.ts';

// ---------- the derivative store (set by createApp, so recovered jobs have it too) ----------
let derivativeStore: Derivatives | null = null;
export function setMulticamDerivatives(d: Derivatives | null): void { derivativeStore = d; }

// ---------- parameters ----------
export const SYNC_BETA = 0.75;
const FRAME_RATE = 100; // envelope frames per second
const WINDOW = 1 << SYNC_THRESHOLDS.fineWindowSamplesLog2;
const DRIFT_ALLOWANCE_PPM = 200;
const WINDOW_PSR_MIN = 2;
const WINDOW_SILENT_DBFS = -50;
const REJECTED_SHARE_MAX = 0.25;
const NEAR_EQUAL = 0.95;
export const MULTICAM_SYNC_VERSION = 1;
const METHOD = `${MULTICAM_SYNC_METHOD} v${MULTICAM_SYNC_VERSION}`;
const NOTE = 'Measured from the sound of the files, no model. Thresholds are tuned on synthetic speech only: check the verdicts, and review files marked check, ambiguous, no-shared-sound or inconsistent by ear. Capture times are a prior, never a sync.';
/** Everything the verdicts used, as recorded in group.origin.params. */
export const SYNC_PARAMS = {
  version: MULTICAM_SYNC_VERSION, beta: SYNC_BETA, envelopeRate: FRAME_RATE, fineWindowSamples: WINDOW, fineSearchMs: SYNC_THRESHOLDS.fineSearchMs,
  confidentPeakZ: SYNC_THRESHOLDS.confident.peakZ, confidentPeakRatio: SYNC_THRESHOLDS.confident.peakRatio, confidentMinAnchors: SYNC_THRESHOLDS.confident.minAnchors, confidentResidualMs: SYNC_THRESHOLDS.confident.residualMs,
  checkPeakRatio: SYNC_THRESHOLDS.check.peakRatio, checkMinAnchors: SYNC_THRESHOLDS.check.minAnchors, checkResidualMs: SYNC_THRESHOLDS.check.residualMs,
  ambiguousBelowPeakRatio: SYNC_THRESHOLDS.ambiguousBelowPeakRatio, noSharedSoundBelowPeakZ: SYNC_THRESHOLDS.noSharedSoundBelowPeakZ, inconsistentAboveResidualMs: SYNC_THRESHOLDS.inconsistentAboveResidualMs,
  inconsistentAboveRejectedShare: REJECTED_SHARE_MAX, dropAnchorsOffMs: SYNC_THRESHOLDS.dropAnchorsOffMs, windowPeakRatioMin: WINDOW_PSR_MIN, windowSilentDbfs: WINDOW_SILENT_DBFS, driftAllowancePpm: DRIFT_ALLOWANCE_PPM, maxRounds: 3,
} as const;

// ---------- pure DSP (exported for the unit tests) ----------
const pow2 = (n: number) => { let p = 1; while (p < n) p <<= 1; return p; };
/** Circular cross-correlation r[k] = Σ a[i]·b[i+k] (k mod N), PHAT-β weighted: R = conj(A)·B / |conj(A)·B|^β. N ≥ a.length + b.length. */
export function gccPhat(a: ArrayLike<number>, b: ArrayLike<number>, beta: number): { r: Float64Array; n: number } {
  const n = pow2(a.length + b.length);
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  for (let i = 0; i < a.length; i++) ar[i] = a[i]!;
  for (let i = 0; i < b.length; i++) br[i] = b[i]!;
  fftMag(ar, ai); fftMag(br, bi);
  // C = conj(A)·B, weighted; then the inverse FFT as conj(FFT(conj(C)))/n
  let peak = 0;
  for (let k = 0; k < n; k++) { const cr = ar[k]! * br[k]! + ai[k]! * bi[k]!, ci = ar[k]! * bi[k]! - ai[k]! * br[k]!; ar[k] = cr; ai[k] = ci; const m = Math.hypot(cr, ci); if (m > peak) peak = m; }
  const floor = peak * 1e-12 + 1e-300;
  for (let k = 0; k < n; k++) { const w = Math.pow(Math.hypot(ar[k]!, ai[k]!) + floor, beta); ar[k] = ar[k]! / w; ai[k] = -ai[k]! / w; }
  fftMag(ar, ai);
  for (let k = 0; k < n; k++) ar[k] = ar[k]! / n;
  return { r: ar, n };
}
const median = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : 0; };
/** Zero-mean flux, clipped at its 99th percentile, over the frames where `covered` (all when absent); 0 elsewhere. */
export function prepFlux(x: ArrayLike<number>, covered?: Uint8Array): Float64Array {
  const vals: number[] = [];
  for (let i = 0; i < x.length; i++) if (!covered || covered[i]) vals.push(x[i]!);
  const out = new Float64Array(x.length);
  if (!vals.length) return out;
  vals.sort((a, b) => a - b);
  const clip = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.99))]!;
  let sum = 0;
  for (const v of vals) sum += Math.min(v, clip);
  const mean = sum / vals.length;
  for (let i = 0; i < x.length; i++) if (!covered || covered[i]) out[i] = Math.min(x[i]!, clip) - mean;
  return out;
}
const cap = (x: number, c = 1000) => (Number.isFinite(x) ? Math.max(-c, Math.min(c, x)) : x > 0 ? c : -c);
const r3 = (x: number) => Number(cap(x).toFixed(3));

/** The group-axis bed: flux at 100 frames a second, frame j = group frame start + j. */
export interface Bed { start: number; values: Float64Array; covered: Uint8Array }
export interface CoarseResult { lagFrames: number | null; peakZ: number | null; peakRatio: number | null; overlapFrames: number; candidates: { lagFrames: number; score: number }[] }
/**
 * The coarse lag of a piece against the bed (lag L: piece frame s plays at group frame s + L). `prior` (frames) orders
 * near-equal candidates; null lag when no lag has the minimum overlap.
 */
export function coarseMatch(pieceFlux: ArrayLike<number>, bed: Bed, o: { minOverlapFrames: number; maxOffsetFrames: number; priorFrames?: number | null; beta?: number }): CoarseResult {
  const p = prepFlux(pieceFlux), b = prepFlux(bed.values, bed.covered);
  const P = p.length, B = b.length;
  const none: CoarseResult = { lagFrames: null, peakZ: null, peakRatio: null, overlapFrames: 0, candidates: [] };
  if (!P || !B) return none;
  const pre = new Int32Array(B + 1);
  for (let j = 0; j < B; j++) pre[j + 1] = pre[j]! + (bed.covered[j] ? 1 : 0);
  const covered = (lo: number, hi: number) => { lo = Math.max(0, lo); hi = Math.min(B, hi); return hi > lo ? pre[hi]! - pre[lo]! : 0; };
  const { r, n } = gccPhat(p, b, o.beta ?? SYNC_BETA);
  // k = L − bed.start, from −(P−1) to B−1
  const lags: number[] = [], scores: number[] = [];
  for (let k = -(P - 1); k <= B - 1; k++) {
    const L = k + bed.start;
    if (Math.abs(L) > o.maxOffsetFrames) continue;
    if (covered(k, k + P) < o.minOverlapFrames) continue;
    lags.push(L); scores.push(r[((k % n) + n) % n]!);
  }
  if (!lags.length) return none;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i]! > scores[best]!) best = i;
  const c1 = scores[best]!, L1 = lags[best]!;
  const med = median(scores), mad = median(scores.map((s) => Math.abs(s - med)));
  const peakZ = mad > 0 ? (c1 - med) / (1.4826 * mad) : c1 > med ? Infinity : 0;
  let c2 = -Infinity;
  for (let i = 0; i < scores.length; i++) if (Math.abs(lags[i]! - L1) > FRAME_RATE && scores[i]! > c2) c2 = scores[i]!;
  const peakRatio = c2 > 0 ? c1 / c2 : Infinity;
  // top candidates, at least 1 s apart
  const cands: { lagFrames: number; score: number }[] = [];
  const taken = (L: number) => cands.some((c) => Math.abs(c.lagFrames - L) <= FRAME_RATE);
  const order = scores.map((_, i) => i).sort((x, y) => scores[y]! - scores[x]! || lags[x]! - lags[y]!);
  for (const i of order) { if (cands.length >= MAX_SYNC_CANDIDATES) break; if (!taken(lags[i]!)) cands.push({ lagFrames: lags[i]!, score: scores[i]! }); }
  if (o.priorFrames !== undefined && o.priorFrames !== null) {
    const prior = o.priorFrames, top = cands[0]!.score;
    const near = cands.filter((c) => c.score >= NEAR_EQUAL * top).sort((x, y) => Math.abs(x.lagFrames - prior) - Math.abs(y.lagFrames - prior));
    cands.splice(0, near.length, ...near);
  }
  return { lagFrames: L1, peakZ: r3(peakZ), peakRatio: r3(peakRatio), overlapFrames: covered(L1 - bed.start, L1 - bed.start + P), candidates: cands.map((c) => ({ lagFrames: c.lagFrames, score: r3(c.score / (c1 || 1)) })) };
}

const dbfs = (x: ArrayLike<number>) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]! * x[i]!; return s > 0 ? 10 * Math.log10(s / x.length) : -Infinity; };
/**
 * The fine lag of window `a` in `b` (b = a's span plus `margin` samples each side; lag d: a[i] matches b[i + margin + d]).
 * Searched in [predicted − search, predicted + search] ∩ [−margin, margin]; the peak on |R|. Null when either side is silent.
 */
export function fineLag(a: Float32Array, b: Float32Array, margin: number, predicted: number, search: number, beta = SYNC_BETA): { lag: number; sign: 1 | -1; psr: number } | 'silent' {
  if (dbfs(a) < WINDOW_SILENT_DBFS || dbfs(b.subarray(margin, margin + a.length)) < WINDOW_SILENT_DBFS) return 'silent';
  const { r, n } = gccPhat(a, b, beta);
  const lo = Math.max(-margin, predicted - search), hi = Math.min(margin, predicted + search);
  const at = (d: number) => r[(((d + margin) % n) + n) % n]!;
  let bestD = lo, best = -1;
  for (let d = lo; d <= hi; d++) { const v = Math.abs(at(d)); if (v > best) { best = v; bestD = d; } }
  const guard = Math.max(8, Math.round(search / 50)); // 1 ms at 48 kHz with the ±50 ms search
  let other = 0;
  for (let d = lo; d <= hi; d++) if (Math.abs(d - bestD) > guard) other = Math.max(other, Math.abs(at(d)));
  return { lag: bestD, sign: at(bestD) < 0 ? -1 : 1, psr: other > 0 ? best / other : Infinity };
}

/** `b` read at slope m about its centre (linear interpolation): out[k] = b(C + (k − C)·m), C the centre index. */
export function stretch(b: Float32Array, m: number): Float32Array {
  const out = new Float32Array(b.length), C = (b.length - 1) / 2;
  for (let k = 0; k < b.length; k++) {
    const x = C + (k - C) * m, i = Math.floor(x), f = x - i;
    const a0 = i >= 0 && i < b.length ? b[i]! : 0, a1 = i + 1 >= 0 && i + 1 < b.length ? b[i + 1]! : 0;
    out[k] = a0 + (a1 - a0) * f;
  }
  return out;
}
export interface SyncPoint { x: number; y: number } // piece sample → group sample
export interface FitResult { anchors: SyncPoint[]; slope: number; residualSamples: number; kept: number; dropped: number; model: 'offset' | 'line' | 'piecewise' }
/** Theil–Sen line through the points, anchors more than dropOff samples off dropped, then the model of plan §4. */
export function fitSync(points: SyncPoint[], dropOff: number, oneMs: number, overlapSamples: number): FitResult | null {
  if (!points.length) return null;
  const pts = points.slice().sort((p, q) => p.x - q.x);
  const theilSen = (ps: SyncPoint[]) => {
    const slopes: number[] = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) if (ps[j]!.x !== ps[i]!.x) slopes.push((ps[j]!.y - ps[i]!.y) / (ps[j]!.x - ps[i]!.x));
    const m = slopes.length ? median(slopes) : 1;
    const b = median(ps.map((p) => p.y - m * p.x));
    return { m, b };
  };
  let { m, b } = theilSen(pts);
  const kept = pts.filter((p) => Math.abs(p.y - (m * p.x + b)) <= dropOff);
  const dropped = pts.length - kept.length;
  if (!kept.length) return { anchors: [], slope: m, residualSamples: Infinity, kept: 0, dropped, model: 'offset' };
  ({ m, b } = theilSen(kept));
  const resid = (f: (x: number) => number) => Math.max(...kept.map((p) => Math.abs(p.y - f(p.x))));
  const drift = Math.abs(m - 1) * overlapSamples;
  if (kept.length === 1 || drift <= oneMs) {
    const off = Math.round(median(kept.map((p) => p.y - p.x)));
    return { anchors: [{ x: 0, y: off }], slope: kept.length > 1 ? m : 1, residualSamples: Math.round(resid((x) => x + off)), kept: kept.length, dropped, model: 'offset' };
  }
  const line = (x: number) => m * x + b;
  const lineRes = resid(line);
  if (lineRes <= 2 * oneMs) {
    const x0 = kept[0]!.x, x1 = kept[kept.length - 1]!.x;
    return { anchors: [{ x: x0, y: Math.round(line(x0)) }, { x: x1, y: Math.round(line(x1)) }], slope: m, residualSamples: Math.round(lineRes), kept: kept.length, dropped, model: 'line' };
  }
  const anchors = kept.slice(0, MAX_ANCHORS_PER_PIECE).map((p) => ({ x: p.x, y: Math.round(p.y) })).filter((p, i, a) => i === 0 || (p.x > a[i - 1]!.x && p.y > a[i - 1]!.y));
  return { anchors, slope: m, residualSamples: Math.round(lineRes), kept: kept.length, dropped, model: 'piecewise' };
}

export interface VerdictInput { peakZ: number | null; peakRatio: number | null; fit: FitResult | null; windows: number; measured: number; rejected: number; oneMs: number }
/** The verdict of plan §4 (starting thresholds; recorded in params). */
export function verdictOf(v: VerdictInput): Exclude<SyncVerdict, 'reference' | 'manual' | 'unsynced'> {
  const th = SYNC_THRESHOLDS;
  if (v.peakZ === null || v.peakZ < th.noSharedSoundBelowPeakZ) return 'no-shared-sound';
  if (v.peakRatio === null || v.peakRatio < th.ambiguousBelowPeakRatio) return 'ambiguous';
  if (!v.fit || v.measured < 2) return 'no-shared-sound';
  const resMs = v.fit.residualSamples / v.oneMs;
  if (resMs > th.inconsistentAboveResidualMs || (v.fit.dropped + v.rejected) > REJECTED_SHARE_MAX * v.measured) return 'inconsistent';
  if (v.fit.model !== 'piecewise' && v.peakZ >= th.confident.peakZ && v.peakRatio >= th.confident.peakRatio && v.fit.kept >= Math.min(th.confident.minAnchors, v.windows) && resMs <= th.confident.residualMs) return 'confident';
  if (v.peakRatio >= th.check.peakRatio && v.fit.kept >= th.check.minAnchors && resMs <= th.check.residualMs) return 'check';
  return 'inconsistent';
}

// ---------- maps in samples (floats only inside the measurement; anchors are written as exact sample rationals) ----------
type Map = { s: number; g: number }[]; // source sample → group sample anchors
const mapOf = (anchors: SyncAnchor[], sr: number): Map => anchors.map((a) => ({ s: T.nearestSampleIndex(a.source, sr), g: T.nearestSampleIndex(a.group, sr) }));
function seg(m: Map, x: number, key: 's' | 'g'): [{ s: number; g: number }, number] {
  if (m.length === 1) return [m[0]!, 1];
  let i = 0;
  while (i < m.length - 2 && x >= m[i + 1]![key]) i++;
  const a = m[i]!, b = m[i + 1]!;
  return [a, (b.g - a.g) / (b.s - a.s)];
}
const toGroup = (m: Map, s: number) => { const [a, k] = seg(m, s, 's'); return a.g + (s - a.s) * k; };
const fromGroup = (m: Map, g: number) => { const [a, k] = seg(m, g, 'g'); return a.s + (g - a.g) / k; };

// ---------- decoding ----------
interface WindowReq { start: number; length: number; out: Float32Array }
/** One streaming decode of `asset` (mono mix at `sr`, on the file's own clock) filling each window; stops after the last one. */
function decodeWindows(store: Store, asset: Asset, sr: number, windows: WindowReq[], abandoned: () => boolean): Promise<void> {
  const end = Math.max(0, ...windows.map((w) => w.start + w.length));
  if (end <= 0) return Promise.resolve();
  const first = Math.round(timeOriginSeconds(asset) * (asset.audio?.sampleRate || sr)); // first_pts counts input samples (envelope.ts)
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-copyts', '-i', store.blobPath(asset.contentHash), '-map', '0:a:0', '-af', `aresample=${sr}:first_pts=${first}`, '-ac', '1', '-ar', String(sr), '-f', 'f32le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: ANALYSIS_TIMEOUT_MS, killSignal: 'SIGKILL' });
    let pos = 0, carry: Buffer | null = null, done = false, gaveUp = false, err = '';
    p.stderr.on('data', (d) => { err = (err + d).slice(-600); });
    p.stdout.on('data', (chunk: Buffer) => {
      if (done) return;
      if (abandoned()) { gaveUp = done = true; p.kill('SIGKILL'); return; }
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const whole = buf.length - (buf.length % 4);
      carry = whole < buf.length ? Buffer.from(buf.subarray(whole)) : null;
      const n = whole / 4;
      for (const w of windows) {
        const lo = Math.max(pos, w.start), hi = Math.min(pos + n, w.start + w.length);
        for (let i = lo; i < hi; i++) w.out[i - w.start] = buf.readFloatLE((i - pos) * 4);
      }
      pos += n;
      if (pos >= end) { done = true; p.kill('SIGKILL'); }
    });
    p.on('error', (e) => reject(new ApiError(503, 'analysis_unavailable', `ffmpeg could not be started: ${e.message}`)));
    p.on('close', (code) => {
      if (gaveUp) return reject(new EnvelopeAbandoned());
      if (!done && code !== 0) return reject(new ApiError(422, 'analysis_failed', 'the sound of this file could not be decoded', { assetId: asset.id, tail: err.slice(-300) }));
      resolve();
    });
  });
}

// ---------- the measurement ----------
interface PieceRef { angleId: string; label: string; pieceIndex: number; assetId: string }
interface Contributor extends PieceRef { asset: Asset; map: Map; depth: number; reference: boolean }
interface Measured extends PieceRef {
  verdict: SyncVerdict; why: MulticamPieceWhy; anchors: SyncAnchor[]; quality: SyncQuality; offsetSamples: number | null; captureOffsetSeconds: number | null; attach: boolean;
}
export class SyncAbandoned extends Error { constructor() { super('the multicam sync was canceled'); } }

function quality(v: Partial<SyncQuality> & { verdict: SyncVerdict }): SyncQuality {
  return { peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null, ...v };
}

async function measureGroup(store: Store, doc: ProjectDocument, group: MulticamGroup, body: MulticamSyncRequest, o: { jobId: string | null; abandoned: () => boolean; stage: (s: string) => void }): Promise<{ results: Measured[]; reference: PieceRef; timingsMs: { envelope: number; coarse: number; fine: number } }> {
  const sr = group.sampleRate, oneMs = sr / 1000, hop = sr / FRAME_RATE;
  const angleIds = body.angleIds ?? group.angles.map((a) => a.id);
  const refAngle = group.angles.find((a) => a.id === group.referenceAngleId)!;
  const reference: PieceRef = { angleId: refAngle.id, label: refAngle.label, pieceIndex: 0, assetId: refAngle.pieces[0]!.assetId };
  const targets: PieceRef[] = [];
  const contributors: Contributor[] = [];
  const assetOf = (id: string) => (Object.hasOwn(doc.assets, id) ? doc.assets[id]! : undefined);
  for (const angle of group.angles) angle.pieces.forEach((piece, pieceIndex) => {
    const ref = { angleId: angle.id, label: angle.label, pieceIndex, assetId: piece.assetId };
    const isRef = angle.id === refAngle.id && pieceIndex === 0;
    if (!isRef && angleIds.includes(angle.id)) { targets.push(ref); return; }
    const asset = assetOf(piece.assetId);
    if (asset?.audio && piece.anchors.length && isPlacedVerdict(piece.quality.verdict)) contributors.push({ ...ref, asset, map: mapOf(piece.anchors, sr), depth: isRef ? 0 : piece.quality.chainDepth, reference: isRef });
  });
  const priors = body.useCapturePriors === false ? [] : capturePriors(doc, group);
  const priorOf = (t: PieceRef) => priors.find((p) => p.angleId === t.angleId && p.pieceIndex === t.pieceIndex)?.offsetSeconds ?? null;
  const minOverlapFrames = Math.round((body.minOverlapSeconds ?? SYNC_THRESHOLDS.minOverlapSeconds) * FRAME_RATE);
  const baseMaxOffset = (body.maxOffsetSeconds ?? 14400) * FRAME_RATE;

  // 1. envelopes
  const t0 = Date.now();
  const flux = new Map<string, Float32Array>();
  const needs = [...new Set([...contributors.map((c) => c.assetId), ...targets.map((t) => t.assetId)])].filter((id) => assetOf(id)?.audio);
  for (let i = 0; i < needs.length; i++) {
    if (o.abandoned()) throw new SyncAbandoned();
    o.stage(multicamSyncStage('measuring sound', i, needs.length));
    try { flux.set(needs[i]!, (await envelopeOf(store, derivativeStore, assetOf(needs[i]!)!, o.abandoned)).flux); }
    catch (e) { if (e instanceof EnvelopeAbandoned) throw new SyncAbandoned(); throw e; }
  }
  const timings = { envelope: Date.now() - t0, coarse: 0, fine: 0 };

  const results = new Map<string, Measured>();
  const key = (t: PieceRef) => `${t.angleId}#${t.pieceIndex}`;
  for (const t of targets) {
    const asset = assetOf(t.assetId);
    const captureOffsetSeconds = priorOf(t);
    if (!asset?.audio) results.set(key(t), { ...t, verdict: 'unsynced', why: 'no_audio', anchors: [], quality: quality({ verdict: 'unsynced', jobId: o.jobId }), offsetSamples: null, captureOffsetSeconds, attach: false });
  }
  let pending = targets.filter((t) => !results.has(key(t)));
  for (let round = 0; round < SYNC_PARAMS.maxRounds && pending.length; round++) {
    o.stage(multicamSyncStage('matching angles', 0, pending.length));
    // the bed of this round: every contributor's flux on the group axis (the reference first wins where two overlap)
    const ordered = contributors.slice().sort((a, b) => Number(b.reference) - Number(a.reference) || a.depth - b.depth);
    let lo = Infinity, hiF = -Infinity;
    for (const c of ordered) { const f = flux.get(c.assetId)!; lo = Math.min(lo, Math.floor(toGroup(c.map, 0) / hop)); hiF = Math.max(hiF, Math.ceil(toGroup(c.map, f.length * hop) / hop)); }
    if (!Number.isFinite(lo)) break;
    const bed: Bed = { start: lo, values: new Float64Array(hiF - lo), covered: new Uint8Array(hiF - lo) };
    for (const c of ordered) {
      const f = flux.get(c.assetId)!;
      for (let s = 0; s < f.length; s++) { const j = Math.round(toGroup(c.map, s * hop) / hop) - lo; if (j >= 0 && j < bed.values.length && !bed.covered[j]) { bed.values[j] = f[s]!; bed.covered[j] = 1; } }
    }
    const placedNow: Contributor[] = [];
    for (let i = 0; i < pending.length; i++) {
      if (o.abandoned()) throw new SyncAbandoned();
      const t = pending[i]!, asset = assetOf(t.assetId)!, f = flux.get(t.assetId)!;
      o.stage(multicamSyncStage('matching angles', i, pending.length));
      const prior = priorOf(t);
      const tc = Date.now();
      const coarse = coarseMatch(f, bed, { minOverlapFrames, maxOffsetFrames: Math.max(baseMaxOffset, prior !== null ? Math.abs(prior) * FRAME_RATE + 10 * FRAME_RATE : 0), priorFrames: prior !== null ? prior * FRAME_RATE : null });
      timings.coarse += Date.now() - tc;
      const candidates = coarse.candidates.map((c) => ({ offset: T.rt(c.lagFrames, FRAME_RATE), score: c.score }));
      const base = { ...t, captureOffsetSeconds: prior };
      if (coarse.lagFrames === null) { results.set(key(t), { ...base, verdict: 'unsynced', why: 'too_short', anchors: [], quality: quality({ verdict: 'unsynced', jobId: o.jobId, chainDepth: round }), offsetSamples: null, attach: false }); continue; }
      const overlapSeconds = r3(coarse.overlapFrames / FRAME_RATE);
      const common = { peakZ: coarse.peakZ, peakRatio: coarse.peakRatio, overlapSeconds, candidates, chainDepth: round, jobId: o.jobId };
      const early = coarse.peakZ! < SYNC_THRESHOLDS.noSharedSoundBelowPeakZ ? 'no-shared-sound' : coarse.peakRatio! < SYNC_THRESHOLDS.ambiguousBelowPeakRatio ? 'ambiguous' : null;
      if (early) { results.set(key(t), { ...base, verdict: early, why: early === 'ambiguous' ? 'ambiguous' : 'no_shared_sound', anchors: [], quality: quality({ verdict: early, ...common }), offsetSamples: null, attach: true }); continue; }
      // 3. fine
      o.stage(multicamSyncStage('fitting sync', i, pending.length));
      const tf = Date.now();
      const L = coarse.lagFrames * hop;
      const fileSamples = f.length * hop;
      const sA = Math.max(0, (bed.start - coarse.lagFrames) * hop), sB = Math.min(fileSamples, (bed.start + bed.values.length - coarse.lagFrames) * hop);
      const span = Math.max(0, sB - sA);
      const K = Math.max(3, Math.min(12, Math.floor(span / sr / 60)));
      const mid = (sA + sB) / 2, search = Math.round(SYNC_THRESHOLDS.fineSearchMs * oneMs);
      type Win = { c: number; a: WindowReq; b: WindowReq; margin: number; contributor: Contributor; gc: number };
      const wins: Win[] = [];
      for (let k = 0; k < K; k++) {
        const c = Math.round(sA + ((k + 0.5) * span) / K);
        const g = c + L;
        const who = ordered.find((x) => { const s = fromGroup(x.map, g); return s >= WINDOW / 2 && s <= flux.get(x.assetId)!.length * hop - WINDOW / 2; }) ?? ordered.find((x) => { const s = fromGroup(x.map, g); return s >= 0 && s <= flux.get(x.assetId)!.length * hop; });
        if (!who) continue;
        const cs = Math.round(fromGroup(who.map, g));
        const margin = search + Math.ceil((DRIFT_ALLOWANCE_PPM * 1e-6) * Math.abs(c - mid)) + search;
        wins.push({ c, gc: toGroup(who.map, cs), margin, contributor: who, a: { start: c - WINDOW / 2, length: WINDOW, out: new Float32Array(WINDOW) }, b: { start: cs - WINDOW / 2 - margin, length: WINDOW + 2 * margin, out: new Float32Array(WINDOW + 2 * margin) } });
      }
      const byAsset = new Map<string, WindowReq[]>();
      const req = (id: string, w: WindowReq) => { const l = byAsset.get(id) ?? []; l.push(w); byAsset.set(id, l); };
      for (const w of wins) { req(t.assetId, w.a); req(w.contributor.assetId, w.b); }
      try { for (const [id, ws] of byAsset) await heavy(() => decodeWindows(store, assetOf(id)!, sr, ws, o.abandoned)); }
      catch (e) { if (e instanceof EnvelopeAbandoned) throw new SyncAbandoned(); throw e; }
      // from the middle outward, each window searched around the lag the measured ones predict
      const order = wins.map((_, k) => k).sort((x, y) => Math.abs(wins[x]!.c - mid) - Math.abs(wins[y]!.c - mid) || x - y);
      const points: SyncPoint[] = [];
      let rejected = 0, measured = 0;
      const byX = new Map<number, number>();
      for (const k of order) {
        const w = wins[k]!;
        const predictedY = points.length >= 2 ? (() => { const p0 = points[0]!, p1 = points[points.length - 1]!; return p0.y + (w.c - p0.x) * ((p1.y - p0.y) / (p1.x - p0.x)); })()
          : points.length === 1 ? points[0]!.y + (w.c - points[0]!.x) : w.c + L;
        const predicted = Math.round(predictedY - w.gc);
        const r = fineLag(w.a.out, w.b.out, w.margin, predicted, search);
        if (r === 'silent') continue;
        measured++;
        if (r.psr < WINDOW_PSR_MIN) { rejected++; continue; }
        points.push({ x: w.c, y: w.gc + r.lag });
        byX.set(w.c, k);
        points.sort((p, q) => p.x - q.x);
      }
      // a drifting clock smears each window's peak (100 ppm is 13 samples over 2^17): measure once more with the bed window
      // stretched by the fitted slope about its centre, so every window is read at its own centre lag
      const first = fitSync(points, SYNC_THRESHOLDS.dropAnchorsOffMs * oneMs, oneMs, span);
      if (first && points.length >= 2 && Math.abs(first.slope - 1) * WINDOW > 2) {
        for (const pt of points) {
          const w = wins[byX.get(pt.x)!]!;
          const r = fineLag(w.a.out, stretch(w.b.out, first.slope), w.margin, Math.round(pt.y - w.gc), Math.round(4 * oneMs));
          if (r !== 'silent' && r.psr >= WINDOW_PSR_MIN) pt.y = w.gc + r.lag;
        }
      }
      timings.fine += Date.now() - tf;
      const fit = fitSync(points, SYNC_THRESHOLDS.dropAnchorsOffMs * oneMs, oneMs, span);
      const verdict = verdictOf({ peakZ: coarse.peakZ, peakRatio: coarse.peakRatio, fit, windows: K, measured, rejected, oneMs });
      const placed = isPlacedVerdict(verdict) && !!fit && fit.anchors.length > 0;
      const anchors: SyncAnchor[] = placed ? fit!.anchors.map((p) => ({ group: T.rt(p.y, sr), source: T.rt(p.x, sr) })) : [];
      const q = quality({
        verdict, ...common, anchorsUsed: Math.min(MAX_ANCHORS_PER_PIECE, fit?.kept ?? 0), anchorsRejected: (fit?.dropped ?? 0) + rejected,
        residualSamples: fit && Number.isFinite(fit.residualSamples) ? Math.min(2 ** 31 - 1, fit.residualSamples) : null,
        driftPpm: fit ? Number(Math.max(-2000, Math.min(2000, (fit.slope - 1) * 1e6)).toFixed(2)) : null,
      });
      const why: MulticamPieceWhy = verdict === 'inconsistent' ? 'inconsistent' : verdict === 'no-shared-sound' ? 'no_shared_sound' : null;
      const m: Measured = { ...base, verdict, why, anchors, quality: q, offsetSamples: placed ? Math.round(toGroup(mapOf(anchors, sr), 0)) : null, attach: true };
      results.set(key(t), m);
      if (placed) placedNow.push({ ...t, asset, map: mapOf(anchors, sr), depth: round + 1, reference: false });
    }
    if (!placedNow.length) break;
    contributors.push(...placedNow);
    pending = pending.filter((t) => !isPlacedVerdict(results.get(key(t))!.verdict));
  }
  return { results: targets.map((t) => results.get(key(t))!), reference, timingsMs: timings };
}

// ---------- checks, commit and report ----------
function manualPieces(group: MulticamGroup, angleIds: string[] | undefined): string[] {
  const out: string[] = [];
  for (const a of group.angles) a.pieces.forEach((p, i) => { if ((!angleIds || angleIds.includes(a.id)) && !(a.id === group.referenceAngleId && i === 0) && p.quality.verdict === 'manual') out.push(a.label); });
  return [...new Set(out)];
}
/** Everything refused before measuring: the group, unknown angle ids, and a hand-synced file without overwrite (409). */
function precheck(store: Store, projectId: string, groupId: string, body: MulticamSyncRequest): { doc: ProjectDocument; group: MulticamGroup } {
  const doc = store.getProject(projectId).doc;
  const group = multicamGroupOf(doc, groupId);
  if (!group) throw new ApiError(404, 'not_found', MULTICAM_REFUSALS.groupNotFound.message(groupId), { groupId }, MULTICAM_REFUSALS.groupNotFound.hint);
  for (const id of body.angleIds ?? []) if (!group.angles.some((a) => a.id === id)) throw new ApiError(404, 'not_found', MULTICAM_REFUSALS.angleNotFound.message(id, groupId), { groupId, angleId: id }, MULTICAM_REFUSALS.angleNotFound.hint);
  const manual = manualPieces(group, body.angleIds);
  if (manual.length && !body.overwrite && !body.dryRun) throw new ApiError(409, 'would_discard_edits', MULTICAM_REFUSALS.wouldDiscardManual.message(manual[0]!), { groupId, why: 'would_discard_edits', angles: manual }, MULTICAM_REFUSALS.wouldDiscardManual.hint);
  return { doc, group };
}
const pieceReport = (m: Measured, sr: number): MulticamPieceReport => ({
  angleId: m.angleId, pieceIndex: m.pieceIndex, assetId: m.assetId, verdict: m.verdict, offsetSeconds: m.offsetSamples === null ? null : Number((m.offsetSamples / sr).toFixed(6)),
  driftPpm: m.quality.driftPpm, peakZ: m.quality.peakZ, peakRatio: m.quality.peakRatio, residualMs: m.quality.residualSamples === null ? null : Number((m.quality.residualSamples / (sr / 1000)).toFixed(3)),
  anchors: m.anchors.length, chainDepth: m.quality.chainDepth, candidates: m.quality.candidates.map((c) => ({ offsetSeconds: Number(T.toSeconds(c.offset).toFixed(3)), score: c.score })), captureOffsetSeconds: m.captureOffsetSeconds, why: m.why,
});

async function runSync(store: Store, actor: string, projectId: string, groupId: string, body: MulticamSyncRequest, o: { jobId: string | null; abandoned: () => boolean; stage: (s: string) => void }): Promise<MulticamSyncReport> {
  const { doc, group } = precheck(store, projectId, groupId, body);
  const { results, reference, timingsMs } = await measureGroup(store, doc, group, body, o);
  if (o.abandoned()) throw new SyncAbandoned();
  const refRow: MulticamPieceReport = { angleId: reference.angleId, pieceIndex: 0, assetId: reference.assetId, verdict: 'reference', offsetSeconds: 0, driftPpm: 0, peakZ: null, peakRatio: null, residualMs: 0, anchors: 1, chainDepth: 0, candidates: [], captureOffsetSeconds: 0, why: null };
  const pieces = [refRow, ...results.map((m) => pieceReport(m, group.sampleRate))];
  const attach = results.filter((m) => m.attach);
  const p = store.getProject(projectId);
  if (body.dryRun || !attach.length) return { revision: p.revision, groupId, committed: false, pieces, method: METHOD, note: NOTE, timingsMs };
  // measuring took a while: the group must still hold the same files, and hand corrections made meanwhile are not discarded
  o.stage(multicamSyncStage('saving sync'));
  const now = precheck(store, projectId, groupId, body).group;
  for (const m of attach) {
    const piece = now.angles.find((a) => a.id === m.angleId)?.pieces[m.pieceIndex];
    if (!piece || piece.assetId !== m.assetId || now.sampleRate !== group.sampleRate) throw new ApiError(409, 'group_changed', 'the multicam group changed while it was being measured; nothing was attached', { groupId, angleId: m.angleId, pieceIndex: m.pieceIndex }, 'Sync again.');
  }
  const params: Record<string, number | string> = { ...SYNC_PARAMS, minOverlapSeconds: body.minOverlapSeconds ?? SYNC_THRESHOLDS.minOverlapSeconds, maxOffsetSeconds: body.maxOffsetSeconds ?? 14400, capturePriors: body.useCapturePriors === false ? 'off' : 'on' };
  const r = store.commit({
    projectId, actor, label: 'Sync multicam by sound', allowInternal: true,
    ops: [{ op: 'attach_multicam_sync', args: { groupId, createdAt: new Date().toISOString(), method: METHOD, params, pieces: attach.map((m) => ({ angleId: m.angleId, pieceIndex: m.pieceIndex, anchors: m.anchors, quality: m.quality })), ...(body.overwrite ? { overwrite: true } : {}) } }],
  });
  return { revision: r.revision, groupId, committed: true, pieces, method: METHOD, note: NOTE, timingsMs };
}

/** POST /projects/:id/multicam/:groupId/sync: the report (in-request) or { jobId, status } (background). The route checked the scope. */
export async function syncMulticam(store: Store, gov: Governance, principal: Principal, projectId: string, groupId: string, body: MulticamSyncRequest): Promise<MulticamSyncReport | { jobId: string; status: string }> {
  if (body.dryRun) gov.assertMayAct(principal, projectId, 'observe');
  else { gov.assertMayAct(principal, projectId, 'edit'); gov.assertUnrestricted(principal, 'change multicam sync'); }
  precheck(store, projectId, groupId, body);
  if (body.background) {
    const job = store.createJob(projectId, 'analysis', principal.actor, { kind: MULTICAM_SYNC_KIND, groupId, options: body, projectRevision: store.getProject(projectId).revision });
    void runMulticamSyncJob(store, job.id);
    const j = store.getJob(job.id);
    return { jobId: j.id, status: j.status };
  }
  return runSync(store, principal.actor, projectId, groupId, body, { jobId: null, abandoned: () => false, stage: () => {} });
}

/** The durable job (input.kind MULTICAM_SYNC_KIND); http.ts runAnalysisJob hands such jobs here, so recoverAnalysisJobs recovers them. */
export async function runMulticamSyncJob(store: Store, jobId: string): Promise<void> {
  if (store.getJob(jobId).status !== 'queued') return;
  store.updateJob(jobId, { status: 'running', stage: multicamSyncStage('measuring sound') });
  const j: JobRow = store.getJob(jobId);
  const canceled = () => store.updateJob(jobId, { status: 'canceled', stage: null, error: { code: 'canceled', message: 'canceled while measuring; nothing was attached' } });
  try {
    const abandoned = () => store.getJob(jobId).status === 'cancel-requested';
    const report = await runSync(store, j.actor, j.projectId, String(j.input.groupId), j.input.options as MulticamSyncRequest, { jobId, abandoned, stage: (stage) => { if (!abandoned()) store.updateJob(jobId, { stage }); } });
    if (abandoned()) return canceled();
    const group = multicamGroupOf(store.getProject(j.projectId).doc, String(j.input.groupId));
    const labels = new Map(group?.angles.map((a) => [a.id, a.label]) ?? []);
    store.updateJob(jobId, { status: 'succeeded', stage: null, output: { kind: MULTICAM_SYNC_KIND, groupId: j.input.groupId, revision: report.revision, committed: report.committed, angles: report.pieces.map((p) => ({ angleId: p.angleId, label: labels.get(p.angleId) ?? null, pieceIndex: p.pieceIndex, verdict: p.verdict, why: p.why })), report } });
  } catch (e) {
    if (e instanceof SyncAbandoned) return canceled();
    if (!(e instanceof ApiError)) console.error(e);
    store.updateJob(jobId, { status: 'failed', stage: null, error: e instanceof ApiError ? e.toJSON().error : { code: 'internal_error', message: 'multicam sync failed unexpectedly' } });
  }
}

/** GET /projects/:id/multicam/:groupId. */
export function multicamView(store: Store, projectId: string, groupId: string): MulticamView {
  const p = store.getProject(projectId);
  const group = multicamGroupOf(p.doc, groupId);
  if (!group) throw new ApiError(404, 'not_found', MULTICAM_REFUSALS.groupNotFound.message(groupId), { groupId }, MULTICAM_REFUSALS.groupNotFound.hint);
  const sr = group.sampleRate;
  const coverage: MulticamView['coverage'] = [];
  const envelopes: MulticamView['envelopes'] = [];
  for (const a of group.angles) a.pieces.forEach((piece, pieceIndex) => {
    const asset = Object.hasOwn(p.doc.assets, piece.assetId) ? p.doc.assets[piece.assetId] : undefined;
    if (asset && piece.anchors.length) {
      const m = mapOf(piece.anchors, sr);
      coverage.push({ angleId: a.id, pieceIndex, startSeconds: Number((toGroup(m, 0) / sr).toFixed(6)), endSeconds: Number((toGroup(m, T.toSeconds(asset.duration) * sr) / sr).toFixed(6)) });
    }
    if (asset && !envelopes.some((e) => e.assetId === asset.id)) envelopes.push({ assetId: asset.id, status: asset.audio ? envelopeStatus(derivativeStore, asset) : 'missing' });
  });
  const programTracks: MulticamView['programTracks'] = [];
  const outOfSync: MulticamView['outOfSync'] = [];
  for (const [sequenceId, s] of Object.entries(p.doc.sequences)) for (const track of s.tracks) {
    const segs = track.clips.filter((c) => c.type === 'media' && c.multicam?.groupId === groupId);
    if (!segs.length) continue;
    programTracks.push({ sequenceId, trackId: track.id, segments: segs.length });
    if (track.kind !== 'video') continue;
    for (const c of segs) { const off = segmentSyncOffset(p.doc, c.id); if (off && (Math.abs(off.startFrames) > 0.5 || Math.abs(off.endFrames) > 0.5)) outOfSync.push({ clipId: c.id, startFrames: off.startFrames, endFrames: off.endFrames }); }
  }
  const capturePriorRows = capturePriors(p.doc, group).map((c) => ({ angleId: c.angleId, pieceIndex: c.pieceIndex, offsetSeconds: c.offsetSeconds, uncertaintySeconds: c.uncertaintySeconds, why: c.why }));
  return { revision: p.revision, group, coverage, programTracks, outOfSync, envelopes, capturePriors: capturePriorRows };
}

/** POST /projects/:id/assets/:assetId/derivatives/envelope: the derivative row, built on demand. */
export async function envelopeDerivative(store: Store, projectId: string, assetId: string): Promise<Record<string, unknown>> {
  const doc = store.getProject(projectId).doc;
  const asset = Object.hasOwn(doc.assets, assetId) ? doc.assets[assetId]! : undefined;
  if (!asset) throw new ApiError(404, 'not_found', `asset ${assetId} not found`, { assetId });
  if (!asset.audio) throw new ApiError(422, 'no_audio', `file ${assetId} has no sound to measure`, { assetId }, 'A level envelope is made from sound only.');
  if (!derivativeStore) throw new ApiError(503, 'unavailable', 'this process has no derivative store', {}, 'Run the full server.');
  const e = await envelopeOf(store, derivativeStore, asset);
  const row = derivativeStore.get(asset.contentHash, 'envelope');
  return { assetId, ...(row ?? {}), frames: e.frames, channels: e.channels.length };
}
