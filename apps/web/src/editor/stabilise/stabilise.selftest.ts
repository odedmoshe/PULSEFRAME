/**
 * Stabilisation in this browser (wave 7 stabilise track; proof check S7). window.__pfSteadyHash() runs core's frozen maths here:
 *  - with no argument: steadySelftest(), the digest of steadyPose and neededZoom over core's fixed selftest motion at strengths
 *    1, 50 and 100, with the digest frozen in core and whether they are equal;
 *  - with a camera motion (and optionally strengths and a frame rate): steadyPoseDigest over that motion, which the proof passes
 *    from the F1 fixture's truth and compares with Node's value bit for bit.
 * No server, no document, no canvas: this is the same function Node runs, and a difference would be a different float.
 */
import { steadyPoseDigest, steadySelftest, type CameraMotion } from '@pulseframe/core';

export interface SteadyHashResult { digest: string; expected?: string; ok?: boolean; strengths: number[]; ms: number }
export function steadyHash(motion?: CameraMotion, strengths: number[] = [1, 50, 100], rate = { num: 30, den: 1 }): SteadyHashResult {
  const t = performance.now();
  if (!motion) { const s = steadySelftest(); return { digest: s.digest, expected: s.expected, ok: s.ok, strengths: [1, 50, 100], ms: +(performance.now() - t).toFixed(2) }; }
  const digest = steadyPoseDigest(motion, strengths, rate);
  return { digest, strengths, ms: +(performance.now() - t).toFixed(2) };
}
if (typeof window !== 'undefined') (window as unknown as { __pfSteadyHash: typeof steadyHash }).__pfSteadyHash = steadyHash;
