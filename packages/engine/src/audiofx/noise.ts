/**
 * Seeded, random-access noise for the sound effects (ADR-0010 D6).
 * Integer hashing with Math.imul only, keyed on (seed, timeline sample, lane): the value at a sample never depends on where a
 * render started or how it was cut into blocks, so a range of an export hears exactly the noise of the whole export.
 */

/** murmur3's 32-bit finaliser: a bijective, well-mixing step on unsigned 32-bit integers. */
const fmix = (h: number): number => {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
};

/** The part of the hash shared by every lane of one sample (compute once per sample, then call hashLane per lane). */
export const hashBase = (seed: number, t: number): number => fmix(fmix((seed ^ 0x9e3779b9) >>> 0) ^ (t >>> 0));
/** Lane `lane` of the hash of sample `t` (t is a timeline sample: any integer with |t| < 2^53, negative included). */
export const hashLane = (base: number, t: number, lane: number): number => fmix((base ^ (Math.floor(t / 4294967296) | 0) ^ Math.imul((lane | 0) + 1, 0x27d4eb2f)) >>> 0);
/** 32 well-mixed bits for (seed, timeline sample t, channel or lane). */
export const hash32 = (seed: number, t: number, ch: number): number => hashLane(hashBase(seed, t), t, ch);

/** Uniform value in [0, 1) from a hash (24 bits, exact in Float32). */
export const uniform = (h: number): number => (h >>> 8) * 5.9604644775390625e-8; // 2^-24
const SQRT3 = 1.7320508075688772;
/** Approximately Gaussian, zero mean, unit variance: the sum of four uniforms (lanes 0-3 of the sample), centred and scaled. */
export const gauss = (seed: number, t: number): number => gaussOf(hashBase(seed, t), t);
/** gauss() from an already computed hashBase(seed, t), so other lanes (4 and up) of the same sample stay free for other uses. */
export const gaussOf = (b: number, t: number): number => (uniform(hashLane(b, t, 0)) + uniform(hashLane(b, t, 1)) + uniform(hashLane(b, t, 2)) + uniform(hashLane(b, t, 3)) - 2) * SQRT3; // variance 4 × 1/12 = 1/3 before scaling
