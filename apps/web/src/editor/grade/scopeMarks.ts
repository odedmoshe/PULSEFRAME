/**
 * The scope additions' shared numbers (wave 8 grade; grade-plan §4.2 with grade-verify C7, C8, C9): the vectorscope's 75 % targets with
 * their letters, the skin-tone line, the parade, the zebra thresholds and the playing throttle. Pure. W3 owns this file's stubs (paradeOf,
 * zebraCounts, ScopeThrottle) and Scopes.tsx / ExposureOverlay.tsx.
 * Axes: the vectorscope's own BT.709 Cb/Cr on the stored 8-bit values (Scopes.tsx analyse): cb = (b − y) / 1.8556, cr = (r − y) / 1.5748,
 * y = 0.2126 r + 0.7152 g + 0.0722 b; +Cb to the right, +Cr up; angles counter-clockwise from +Cb.
 * The skin-tone line is a CONVENTION of video scopes: the direction of NTSC's I axis (RGB direction 0.956, −0.272, −1.106) on these
 * axes, 130.5° (grade-verify C9; on BT.601 U/V scopes the same axis is drawn at 123°, on BT.601 Cb/Cr at 132.5°). No number is ever
 * computed from it; it is drawn, dashed, with grade.skinNote.
 */
/** Luma at or above this is striped by zebra and counted as clipped (the same threshold as Scopes' «לבן חתוך»). */
export const ZEBRA_CLIPPED_LUMA = 251;
/** Luma at or below this is dotted by zebra and counted as crushed (the same threshold as Scopes' «שחור חתוך»). */
export const ZEBRA_CRUSHED_LUMA = 4;
/** While playing (data-quality = draft) the scopes analyse every Nth CHANGE of the preview's data-frame (C8); paused, every frame. A labelled guess, measured on the laptop (L2). */
export const SCOPE_PLAYING_EVERY = 6;
/** The six 75 % colour-bar targets, in the scope's Latin letters. */
export const VEC_TARGETS = [
  { letter: 'R', rgb: [191, 0, 0] }, { letter: 'Yl', rgb: [191, 191, 0] }, { letter: 'G', rgb: [0, 191, 0] },
  { letter: 'Cy', rgb: [0, 191, 191] }, { letter: 'B', rgb: [0, 0, 191] }, { letter: 'Mg', rgb: [191, 0, 191] },
] as const satisfies readonly { letter: string; rgb: readonly [number, number, number] }[];
/** A target holds the pixels within this normalised radius of it (analyse → targets[6]). */
export const VEC_TARGET_RADIUS = 0.05;
/** The RGB direction of the I axis (YIQ inverse, Q = 0, I > 0). */
export const SKIN_LINE_RGB = [0.956, -0.272, -1.106] as const;
/** The skin-tone line's angle on these axes, in degrees (rounded for display; skinLineDeg() computes it). */
export const SKIN_LINE_DEG = 130.5;

/** Cb and Cr of an RGB value on the vectorscope's axes, each within ±127.5 for 8-bit values (Scopes.tsx analyse, exactly). */
export function chromaOf(r: number, g: number, b: number): { cb: number; cr: number } {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return { cb: (b - y) / 1.8556, cr: (r - y) / 1.5748 };
}
/** Angle (degrees, counter-clockwise from +Cb, −180..180] and radius (0..1 of 127.5) of an RGB value on the vectorscope. */
export function vecPolar(r: number, g: number, b: number): { deg: number; radius: number } {
  const { cb, cr } = chromaOf(r, g, b);
  return { deg: (Math.atan2(cr, cb) * 180) / Math.PI, radius: Math.hypot(cb, cr) / 127.5 };
}
export const skinLineDeg = () => vecPolar(SKIN_LINE_RGB[0], SKIN_LINE_RGB[1], SKIN_LINE_RGB[2]).deg;

export class ScopeAdditionNotBuilt extends Error { constructor(what: string) { super(`${what}: this scope addition is not built in this build yet`); } }
/** W3: the parade's counts, Uint16Array(3·width·256): per channel, per column, how many pixels have each code value (filled in analyse's loop). */
export function paradeOf(data: Uint8ClampedArray, width: number, height: number): Uint16Array {
  void data; void width; void height;
  throw new ScopeAdditionNotBuilt('paradeOf');
}
/** W3: zebra's counts on an RGBA picture: luma (Scopes' rounding) ≥ ZEBRA_CLIPPED_LUMA and ≤ ZEBRA_CRUSHED_LUMA (G15: exact at the picture's own width). */
export function zebraCounts(data: Uint8ClampedArray, width: number, height: number): { clipped: number; crushed: number } {
  void data; void width; void height;
  throw new ScopeAdditionNotBuilt('zebraCounts');
}
/**
 * W3: the throttle (C8). `next(frame, quality)` is called for each MutationObserver record batch with the preview's data-frame and
 * data-quality; it says whether to analyse: always when the quality is not 'draft' (paused: the full picture, never stale) and on the
 * first change; while 'draft', on every SCOPE_PLAYING_EVERY-th change of `frame` (a batch with an unchanged frame does not count).
 * `count` is what Scopes exposes as data-scope-count.
 */
export interface ScopeThrottle { next(frame: string, quality: string): boolean; readonly count: number }
export function scopeThrottle(every = SCOPE_PLAYING_EVERY): ScopeThrottle {
  void every;
  throw new ScopeAdditionNotBuilt('scopeThrottle');
}
