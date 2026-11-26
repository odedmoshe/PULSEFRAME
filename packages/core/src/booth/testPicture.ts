/**
 * The booth's two built-in test pictures (wave 8 booth; verify C6). BUILDER W1. Pure: the same RGBA bytes in Node and Chromium, no
 * canvas, no text (nothing on the server draws a letter, so there is no Hebrew letter in them), no randomness.
 *
 * What they hold, and why:
 * - A: a soft horizontal gradient (slate blue to grey green), a large arrow pointing RIGHT with its tail low, three muted patches and a
 *   notch cut out of the TOP-LEFT corner. A mirrored drawing points left; an upside-down one has the notch at the bottom.
 * - B: a soft vertical gradient (sand to olive), three rings, an arrow pointing UP with its tail to the right, and a notch cut out of
 *   the BOTTOM-RIGHT corner. A transition that swaps or flips the pictures shows it.
 * - For the flash check (ADR-0009): no saturated red anywhere (the linear red share stays far below 0.8; the test pins < 0.5), no
 *   fine high-contrast grid (every edge is a large shape), and the two mean luminances are within a moderate gap (the test pins it).
 * Raise BOOTH_SCENE_VERSION (scene.ts) whenever these bytes change: every picture item's recipe hashes them.
 */
import { BOOTH_SCENE_H, BOOTH_SCENE_W } from './scene.ts';

export type BoothPictureWhich = 'a' | 'b';
export const BOOTH_PICTURES: readonly BoothPictureWhich[] = ['a', 'b'];

type RGB = readonly [number, number, number];
const mixc = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Is (x, y) inside the polygon (even-odd rule)? Coordinates in pixels. */
function inPoly(x: number, y: number, pts: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]!, [xj, yj] = pts[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const W = BOOTH_SCENE_W, H = BOOTH_SCENE_H;
// shapes in pixels of the 640×360 picture
const ARROW_RIGHT: readonly (readonly [number, number])[] = [[110, 150], [330, 150], [330, 95], [470, 190], [330, 285], [330, 230], [110, 230], [110, 290], [70, 290], [70, 150]];
const ARROW_UP: readonly (readonly [number, number])[] = [[280, 300], [280, 140], [230, 140], [320, 40], [410, 140], [360, 140], [360, 260], [430, 260], [430, 300]];
const NOTCH = 70; // the cut corner's leg

/** RGBA (straight alpha, all opaque) of test picture a or b at BOOTH_SCENE_W × BOOTH_SCENE_H. */
export function boothTestPictureRgba(which: BoothPictureWhich): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c: RGB;
      if (which === 'a') {
        c = mixc([70, 96, 132], [104, 128, 112], x / (W - 1));
        if (x + y < NOTCH) c = [36, 40, 48];
        else if (inPoly(x + 0.5, y + 0.5, ARROW_RIGHT)) c = [226, 220, 196];
        else if ((x - 560) ** 2 + (y - 80) ** 2 < 34 ** 2) c = [180, 164, 112];
        else if (x >= 500 && x < 600 && y >= 250 && y < 320) c = [96, 150, 120];
        else if (x >= 30 && x < 70 && y >= 40 && y < 110 && x + y >= NOTCH + 10) c = [150, 120, 170];
      } else {
        c = mixc([182, 168, 132], [118, 128, 86], y / (H - 1));
        if (W - 1 - x + (H - 1 - y) < NOTCH) c = [44, 42, 36];
        else if (inPoly(x + 0.5, y + 0.5, ARROW_UP)) c = [46, 62, 86];
        else {
          const ring = (cx: number, cy: number, r: number) => { const d = Math.hypot(x - cx, y - cy); return d < r && d > r - 14; };
          if (ring(120, 110, 60)) c = [236, 232, 214];
          else if (ring(130, 270, 44)) c = [84, 110, 150];
          else if (ring(540, 110, 50)) c = [150, 104, 128];
        }
      }
      const i = (y * W + x) * 4;
      out[i] = Math.round(c[0]); out[i + 1] = Math.round(c[1]); out[i + 2] = Math.round(c[2]); out[i + 3] = 255;
    }
  }
  return out;
}
