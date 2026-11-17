/**
 * Voice cleanup «ניקוי קול» (ADR-0013): the noise-profile codec shared by the cleanup.denoise kernel, the voice measurement
 * (measure_voice) and the clean_voice operation, and the strength table that turns one strength into the three cleanup effects.
 * Pure, model-free, no I/O. The kernels themselves are packages/engine/src/audiofx/kernels/{dehum,denoise,speech}.ts.
 */
import type { AudioFxParams } from './audioEffects.ts';

export const NOISE_BANDS = 24;
/** ERB-spaced band edges, 50 Hz to 20 kHz: band j covers [edge j, edge j+1). */
export const NOISE_BAND_EDGES_HZ: readonly number[] = [50, 104, 170, 248, 341, 452, 585, 744, 934, 1161, 1433, 1758, 2146, 2610, 3165, 3828, 4621, 5569, 6702, 8057, 9676, 11612, 13926, 16693, 20000];
export const NOISE_PROFILE_PATTERN = /^[A-Za-z0-9_-]{48}$/;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Largest code the encoder writes: −140 dB. */
const MAX_CODE = 2800;

/**
 * Band j level in dB = 10·log10(24000 × mean PSD over [edge j, edge j+1)). PSD is per channel (mean of L and R), in
 * full-scale² per Hz, measured on the SOURCE at speed 1: the level of 48 kHz white noise with that density. A kernel at rate sr
 * expects bin power λ_k = 10^(b(f_k/speed)/10) · (sr/48000) · Σw² / speed. Encoding: code = clamp(round(−db·20), 0, 2800),
 * two base64url characters (alphabet A–Z a–z 0–9 - _), high 6 bits first.
 */
export function encodeNoiseProfile(bandsDb: readonly number[]): string {
  if (bandsDb.length !== NOISE_BANDS) throw new RangeError(`a noise profile has ${NOISE_BANDS} bands, not ${bandsDb.length}`);
  let out = '';
  for (const db of bandsDb) {
    if (!Number.isFinite(db)) throw new RangeError('a noise profile band level must be a finite number of dB');
    const code = Math.min(MAX_CODE, Math.max(0, Math.round(-db * 20)));
    out += ALPHABET[code >> 6]! + ALPHABET[code & 63]!;
  }
  return out;
}
/**
 * The 24 band levels in dB (0.05 dB steps) of a profile string; throws on a string that is not a profile. A code above 2800 (which
 * the encoder never writes) is read as written, below −140 dB.
 */
export function decodeNoiseProfile(profile: string): number[] {
  if (typeof profile !== 'string' || !NOISE_PROFILE_PATTERN.test(profile)) throw new RangeError('not a noise profile: 48 characters of A–Z a–z 0–9 - _ expected');
  const out: number[] = [];
  for (let j = 0; j < NOISE_BANDS; j++) {
    const code = ALPHABET.indexOf(profile[j * 2]!) * 64 + ALPHABET.indexOf(profile[j * 2 + 1]!);
    out.push(code === 0 ? 0 : -code / 20);
  }
  return out;
}
/** A generic quiet floor (−70 dB in every band): the denoise default before anything was measured. */
export const GENERIC_NOISE_PROFILE: string = encodeNoiseProfile(Array<number>(NOISE_BANDS).fill(-70));

/** The cleanup effects, in registry (= processing) order. */
export const CLEANUP_TYPES = ['cleanup.dehum', 'cleanup.denoise', 'cleanup.speech'] as const;
export type CleanupType = (typeof CLEANUP_TYPES)[number];
export const isCleanupType = (type: string): type is CleanupType => (CLEANUP_TYPES as readonly string[]).includes(type);

export interface CleanVoiceChoice { strength: number; profile?: string; source?: string; mainsHz?: '50' | '60' | null; denoise?: boolean; speech?: boolean }
const r1 = (x: number) => Math.round(x * 10) / 10 + 0; // + 0: never −0
const r2 = (x: number) => Math.round(x * 100) / 100 + 0;
/**
 * Pure. Monotone in strength; 0 gives []. Strength table, with s = strength:
 *  - dehum (only if mainsHz): { amount 1, mainsHz, harmonics: s > 0.75 ? 6 : 4, width 0.5 }
 *  - denoise (unless denoise === false): { amount 1, reductionDb: r1(6 + 14s), sensitivityDb: r1(-3 + 6s),
 *    profile: profile ?? GENERIC_NOISE_PROFILE, source: source ?? '' }
 *  - speech (unless speech === false): { amount 1, lowCutHz 80, presence: r2(0.2 + 0.5s), levelDb: r1(3 + 9s), targetDb -20, ceilingDb -1 }
 *  r1 and r2 round to 1 and 2 decimals.
 */
export function cleanVoiceEffects(c: CleanVoiceChoice): { type: CleanupType; params: AudioFxParams }[] {
  const s = c.strength;
  if (!(s >= 0 && s <= 1)) throw new RangeError('strength is a number from 0 to 1');
  if (s === 0) return [];
  const out: { type: CleanupType; params: AudioFxParams }[] = [];
  if (c.mainsHz) out.push({ type: 'cleanup.dehum', params: { amount: 1, mainsHz: c.mainsHz, harmonics: s > 0.75 ? 6 : 4, width: 0.5 } });
  if (c.denoise !== false) out.push({ type: 'cleanup.denoise', params: { amount: 1, reductionDb: r1(6 + 14 * s), sensitivityDb: r1(-3 + 6 * s), profile: c.profile ?? GENERIC_NOISE_PROFILE, source: c.source ?? '' } });
  if (c.speech !== false) out.push({ type: 'cleanup.speech', params: { amount: 1, lowCutHz: 80, presence: r2(0.2 + 0.5 * s), levelDb: r1(3 + 9 * s), targetDb: -20, ceilingDb: -1 } });
  return out;
}
