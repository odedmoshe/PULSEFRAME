/**
 * The boxes the titles of a frame take, measured from the pixels of the still route (ADR-0005: the same evaluate and compositor as
 * the preview, the stills and the export), for proof:packs P13. A title's box is the bounding box of the pixels that change when
 * that one title is hidden (its letters, outline and plate; a soft glow or shadow fainter than the threshold is not counted).
 * Pure; packages/evals/src/titleBoxes.test.ts runs it on drawn rectangles.
 */
export interface Box { x0: number; y0: number; x1: number; y1: number }
/** Pixels whose brightest channel difference is over this count as changed: letters, outlines and plates, not a faint halo. */
export const TITLE_DIFF_THRESHOLD = 64;
/** Bounding box of the pixels that differ between two RGBA pictures of one size, or null when none does. */
export function diffBox(a: Uint8Array, b: Uint8Array, w: number, h: number, t = TITLE_DIFF_THRESHOLD): Box | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(a[i]! - b[i]!) > t || Math.abs(a[i + 1]! - b[i + 1]!) > t || Math.abs(a[i + 2]! - b[i + 2]!) > t) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return x1 >= x0 ? { x0, y0, x1, y1 } : null;
}
/** The pairs of boxes that share at least one pixel. */
export function overlappingPairs(boxes: readonly { key: string; box: Box }[]): [string, string, Box][] {
  const out: [string, string, Box][] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!.box, b = boxes[j]!.box;
    const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
    if (x0 <= x1 && y0 <= y1) out.push([boxes[i]!.key, boxes[j]!.key, { x0, y0, x1, y1 }]);
  }
  return out;
}
