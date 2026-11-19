/**
 * The P6 alignment checks of music-proof.ts on signals built here (deterministic noise standing in for the track): the check
 * passes a track at the expected sample and fails one a frame late, and the CONTROL passes exactly when the track moved by one
 * frame. Before this test the CONTROL searched only ±800 samples around the start while asking for a lag 1600 samples later
 * (one frame at 30 fps), so it could never pass and proof:music always failed.
 */
import { describe, expect, it } from 'vitest';
import { alignment, control } from './music-proof-lag.ts';

const SR = 48000;
const FRAME_30 = SR / 30; // 1600 samples
const N = SR / 2; // half a second of correlation window keeps the test fast

/** Deterministic noise (a small LCG), the stand-in for the synthesised track. */
function noise(len: number, seed = 7): Float32Array {
  const out = new Float32Array(len);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out[i] = s / 2 ** 31 - 1; }
  return out;
}
/** An "export": silence with `ref` placed at sample `at`. */
function placed(ref: Float32Array, at: number, total: number): Float32Array {
  const x = new Float32Array(total);
  x.set(ref.subarray(0, Math.max(0, Math.min(ref.length, total - at))), at);
  return x;
}

describe('music proof P6 alignment and its CONTROL', () => {
  const ref = noise(2 * SR);
  for (const start of [0, 4800]) {
    it(`start at sample ${start}: the check passes in place and fails one frame late`, () => {
      expect(alignment(placed(ref, start, 3 * SR), ref, start, N).ok).toBe(true);
      expect(alignment(placed(ref, start + FRAME_30, 3 * SR), ref, start, N).ok).toBe(false);
    });
    it(`start at sample ${start}: the CONTROL passes when the clip is one frame late (30 fps)`, () => {
      const c = control(placed(ref, start + FRAME_30, 3 * SR), ref, start, FRAME_30, N);
      expect(c.ok).toBe(true);
    });
    it(`start at sample ${start}: the CONTROL fails when the clip did not move, or moved by some other amount`, () => {
      expect(control(placed(ref, start, 3 * SR), ref, start, FRAME_30, N).ok).toBe(false);
      expect(control(placed(ref, start + FRAME_30 / 2, 3 * SR), ref, start, FRAME_30, N).ok).toBe(false);
      expect(control(placed(ref, start + 2 * FRAME_30, 3 * SR), ref, start, FRAME_30, N).ok).toBe(false);
    });
  }
});
