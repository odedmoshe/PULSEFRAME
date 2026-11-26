/**
 * The alignment checks of music-proof.ts (P6), kept apart from the proof so they can be tested on signals built here:
 * a track placed at the expected sample passes, a track placed one frame later fails it, and the CONTROL sees the lag move.
 */

/** Normalised cross-correlation of `x` against `ref` at lags around `expect` (samples), over a window of `n` samples. */
export function bestLag(x: Float32Array, ref: Float32Array, expect: number, span: number, n: number): { lag: number; peak: number } {
  let best = { lag: 0, peak: -Infinity };
  const from = 2400, len = Math.min(n, ref.length - from - span - 1);
  let rr = 0;
  for (let i = 0; i < len; i++) rr += ref[from + i]! ** 2;
  for (let lag = expect - span; lag <= expect + span; lag++) {
    let xy = 0, xx = 0;
    for (let i = 0; i < len; i++) { const a = x[from + i + lag] ?? 0; xy += a * ref[from + i]!; xx += a * a; }
    const p = xy / Math.sqrt(xx * rr || 1);
    if (p > best.peak) best = { lag, peak: p };
  }
  return best;
}

/** The P6 alignment check: best lag within ±1 sample of `expect` and normalised peak >= 0.99 (searched ±`span` samples). */
export function alignment(x: Float32Array, ref: Float32Array, expect: number, n: number, span = 800) {
  const c = bestLag(x, ref, expect, span, n);
  return { ...c, expected: expect, ok: Math.abs(c.lag - expect) <= 1 && c.peak >= 0.99 };
}

/**
 * The P6 CONTROL, on an export whose music clip was moved `frameSamples` later: the original check (searched around
 * `startSamples`) must FAIL, and the same check searched around `startSamples + frameSamples` must PASS, so the best lag moved
 * by exactly one frame. Each search covers ±`span` samples around its own centre; one frame (1600 samples at 30 fps) lies
 * outside the original ±800 window, which is why the moved lag is searched for where it is expected.
 */
export function control(x: Float32Array, ref: Float32Array, startSamples: number, frameSamples: number, n: number, span = 800) {
  const original = alignment(x, ref, startSamples, n, span);
  const moved = alignment(x, ref, startSamples + frameSamples, n, span);
  return { original, moved, ok: !original.ok && moved.ok };
}
