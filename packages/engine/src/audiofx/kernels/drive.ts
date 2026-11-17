/**
 * Saturation shared by the character voices (ADR-0010 plan section 4): the Padé approximant of tanh,
 * P(v) = v(27 + v²)/(27 + 9v²) for |v| ≤ 3 and ±1 beyond (continuous, slope 1 at 0 and 0 at ±3, odd, never above 1).
 * A drive of strength k computes P(k·x)/√k: small signals rise by √k, the output never exceeds 1/√k, and the Lipschitz constant
 * (which multiplies the warm-up bound of whatever filters come before it) is √k.
 */
import { driveMakeup } from '../design.ts';

export const pade = (v: number): number => (v >= 3 ? 1 : v <= -3 ? -1 : (v * (27 + v * v)) / (27 + 9 * v * v));

export interface Drive { k: number; post: number; lipschitz: number }
export function makeDrive(k: number): Drive {
  const post = driveMakeup(k);
  return { k, post, lipschitz: k * post };
}
/** One driven sample (the kernels inline the same expression). */
export const drive = (d: Drive, x: number): number => pade(d.k * x) * d.post;
