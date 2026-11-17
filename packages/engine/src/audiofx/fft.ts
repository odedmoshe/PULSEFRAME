/**
 * Radix-2 complex FFT for the voice cleanup (ADR-0013): the cleanup.denoise kernel and the voice measurement (voiceMeasure.ts)
 * frame their input with it. In place, iterative, on Float64Array pairs (real, imaginary).
 *
 * Determinism (ADR-0010 D6): the bit-reversal and twiddle tables are made once per size with + − × ÷ and a Taylor series only
 * (sinPi below, as timemap.ts does for its sinc table), so every JavaScript engine builds the same tables bit for bit and the
 * transform does the same arithmetic everywhere. transform() allocates nothing.
 */

const PI = 3.141592653589793;
/** sin(t) and cos(t) for |t| ≤ π/4 by their Taylor series (|error| below 1e-16). */
function sinSeries(t: number): number {
  const t2 = t * t;
  let term = t, sum = t;
  for (let n = 1; n < 12; n++) { term = (-term * t2) / ((2 * n) * (2 * n + 1)); sum += term; }
  return sum;
}
function cosSeries(t: number): number {
  const t2 = t * t;
  let term = 1, sum = 1;
  for (let n = 1; n < 12; n++) { term = (-term * t2) / ((2 * n - 1) * (2 * n)); sum += term; }
  return sum;
}
/** sin(π·x) with + − × ÷ only: range reduction to an octant, then a Taylor series (|error| below 2e-16). */
export function sinPi(x: number): number {
  let r = x - 2 * Math.round(x / 2); // [-1, 1]
  let sign = 1;
  if (r < 0) { r = -r; sign = -1; }
  if (r > 0.5) r = 1 - r; // sin(π(1 − r)) = sin(πr), r in [0, 0.5]
  const v = r <= 0.25 ? sinSeries(PI * r) : cosSeries(PI * (0.5 - r));
  return sign * v;
}
/** cos(π·x) with + − × ÷ only. */
export const cosPi = (x: number): number => sinPi(x + 0.5);

/** The bit-reversal permutation and the twiddles cos(2πj/N), sin(2πj/N) for j < N/2 of one size. */
export interface FftTables { n: number; rev: Int32Array; cos: Float64Array; sin: Float64Array }
/**
 * Builds the tables of size n (a power of two from 2 to 65536). The twiddles are computed in the first octant by series and
 * mirrored (cos(π/2 − x) = sin(x), cos(π − x) = −cos(x)), so the symmetric values are exactly equal and the quarter points exact.
 */
export function fftTables(n: number): FftTables {
  if (!Number.isInteger(n) || n < 2 || n > 65536 || (n & (n - 1)) !== 0) throw new RangeError(`FFT size ${n}: a power of two from 2 to 65536 expected`);
  let bits = 0;
  while (1 << bits < n) bits++;
  const rev = new Int32Array(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
  const half = n >> 1, q = n >> 2, cos = new Float64Array(half), sin = new Float64Array(half);
  if (n === 2) { cos[0] = 1; sin[0] = 0; return { n, rev, cos, sin }; }
  // j in [0, N/8]: series at t = 2πj/N ≤ π/4
  const eighth = n >> 3;
  for (let j = 0; j <= eighth; j++) { const t = (2 * PI * j) / n; cos[j] = cosSeries(t); sin[j] = sinSeries(t); }
  // (N/8, N/4]: cos(2πj/N) = sin(2π(N/4 − j)/N)
  for (let j = eighth + 1; j <= q; j++) { cos[j] = sin[q - j]!; sin[j] = cos[q - j]!; }
  // (N/4, N/2): cos(2πj/N) = −cos(2π(N/2 − j)/N), sin(2πj/N) = sin(2π(N/2 − j)/N)
  for (let j = q + 1; j < half; j++) { cos[j] = -cos[half - j]!; sin[j] = sin[half - j]!; }
  return { n, rev, cos, sin };
}

/** In-place complex FFT of one size: X_k = Σ x_n·e^(−2πikn/N) forward; the inverse includes the factor 1/N. */
export class Fft {
  readonly n: number;
  readonly tables: FftTables;
  private readonly invN: number;
  constructor(n: number, tables = fftTables(n)) {
    this.n = n;
    this.tables = tables;
    this.invN = 1 / n;
  }
  forward(re: Float64Array, im: Float64Array): void { this.run(re, im, -1); }
  /** Inverse transform WITHOUT the factor 1/N (callers fold it into a window). */
  backward(re: Float64Array, im: Float64Array): void { this.run(re, im, 1); }
  /** Inverse transform, scaled by 1/N (exact: N is a power of two). */
  inverse(re: Float64Array, im: Float64Array): void {
    this.run(re, im, 1);
    const s = this.invN, n = this.n;
    for (let i = 0; i < n; i++) { re[i] = re[i]! * s; im[i] = im[i]! * s; }
  }
  private run(re: Float64Array, im: Float64Array, sign: number): void {
    const n = this.n, { rev, cos, sin } = this.tables;
    for (let i = 0; i < n; i++) {
      const j = rev[i]!;
      if (j > i) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; }
    }
    // size-2 butterflies (twiddle 1)
    for (let a = 0; a < n; a += 2) {
      const b = a + 1, tr = re[b]!, ti = im[b]!;
      re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
    }
    for (let size = 4; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step]!, wi = sign * sin[j * step]!;
        for (let a = j; a < n; a += size) {
          const b = a + half, xr = re[b]!, xi = im[b]!;
          const tr = wr * xr - wi * xi, ti = wr * xi + wi * xr;
          re[b] = re[a]! - tr; im[b] = im[a]! - ti;
          re[a] = re[a]! + tr; im[a] = im[a]! + ti;
        }
      }
    }
  }
}
const cache = new Map<number, Fft>();
/** The shared transform of size n (tables built once per size). */
export function fftOf(n: number): Fft {
  let f = cache.get(n);
  if (!f) { f = new Fft(n); cache.set(n, f); }
  return f;
}

/**
 * STFT size of the cleanup at a sample rate: 1024 at 44.1 and 48 kHz, 2048 at 88.2 and 96 kHz (about 47 Hz per bin at each).
 * Precisely: the largest power of two N from 256 to 4096 whose look-ahead N + N/4 − 1 stays within 50 ms (25·N ≤ sr + 20), so
 * cleanup.denoise keeps its catalogue look-ahead (aheadMs 50) at any project rate from 8 to 192 kHz; the switch from 1024 to
 * 2048 falls at 51.18 kHz.
 */
export function stftSize(sampleRate: number): number {
  let n = 256;
  while (n < 4096 && 25 * (n * 2) <= sampleRate + 20) n *= 2;
  return n;
}
/** Periodic square-root Hann (sine) window w[i] = sin(πi/N): the analysis and synthesis window of the cleanup STFT. */
export function sqrtHann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = sinPi(i / n);
  return w;
}
