/**
 * Fixed tables of the sound-effect kernels (ADR-0010 D6). Transcendental Math.* may run here and in design.ts only: once, when
 * the module loads or an instance is designed, never per sample.
 */

/** sin(2π·i/4096) for i = 0..4096 (one guard entry, so interpolation never wraps). */
export const SINE_SIZE = 4096;
export const SINE = new Float64Array(SINE_SIZE + 1);
for (let i = 0; i <= SINE_SIZE; i++) SINE[i] = Math.sin((2 * Math.PI * i) / SINE_SIZE);
SINE[0] = 0; SINE[SINE_SIZE / 2] = 0; SINE[SINE_SIZE] = 0; SINE[SINE_SIZE / 4] = 1; SINE[(3 * SINE_SIZE) / 4] = -1; // exact at the quarter points

/** sin(2π·phase) for phase in [0, 1), from the table with linear interpolation (error below 3e-7). Arithmetic only. */
export function sineAt(phase: number): number {
  const x = phase * SINE_SIZE;
  const i = Math.floor(x);
  const a = SINE[i]!;
  return a + (x - i) * (SINE[i + 1]! - a);
}

/** The shape of one radio crackle: 16 samples of a decaying click (its energy lies inside the radio band at 44.1–96 kHz). */
export const CLICK_LENGTH = 16;
export const CLICK = new Float64Array(CLICK_LENGTH);
for (let i = 0; i < CLICK_LENGTH; i++) CLICK[i] = (1 - i / CLICK_LENGTH) ** 2 * Math.cos((Math.PI * i) / 10);

/** Reverb rooms: a size factor for the delay lines and diffusers, and 12 early reflections (whole milliseconds after the predelay; gains left and right). */
export type RoomId = 'room' | 'hall' | 'cave' | 'bathroom';
export interface RoomTable { size: number; erMs: readonly number[]; erL: Float64Array; erR: Float64Array }
const er = (size: number, level: number, ms: number[]): RoomTable => {
  const erL = new Float64Array(12), erR = new Float64Array(12);
  for (let j = 0; j < 12; j++) {
    const g = level * 0.85 ** j * (Math.floor(j / 3) % 2 === 0 ? 1 : -1);
    erL[j] = g * (j % 2 === 0 ? 1 : 0.55);
    erR[j] = g * (j % 2 === 0 ? 0.55 : 1);
  }
  return { size, erMs: ms, erL, erR };
};
export const ROOMS: Readonly<Record<RoomId, RoomTable>> = {
  room: er(0.55, 0.5, [3, 5, 7, 9, 12, 14, 17, 20, 23, 27, 31, 36]),
  hall: er(1, 0.35, [7, 11, 15, 19, 24, 29, 35, 41, 48, 56, 64, 73]),
  cave: er(1.6, 0.4, [13, 19, 26, 33, 41, 50, 60, 71, 83, 96, 110, 125]),
  bathroom: er(0.3, 0.6, [1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 14, 16]),
};
/** Feedback delay network: the eight line lengths at 48 kHz and size 1 (each is then scaled and moved to the next prime). */
export const FDN_BASE = [1031, 1327, 1523, 1789, 2053, 2311, 2593, 2857] as const;
/** The four series all-pass diffusers, lengths at 48 kHz and size 1. */
export const DIFFUSER_BASE = [142, 107, 379, 277] as const;
export const DIFFUSER_GAIN = 0.6;
/** Orthogonal sign patterns (rows of the 8×8 Hadamard matrix): the network's input and its two output taps. */
export const FDN_IN = [1, -1, -1, 1, 1, -1, -1, 1] as const;
export const FDN_OUT_L = [1, -1, 1, -1, 1, -1, 1, -1] as const;
export const FDN_OUT_R = [1, 1, -1, -1, 1, 1, -1, -1] as const;
