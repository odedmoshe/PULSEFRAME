/**
 * The synthetic pictures of the opacity MEASUREMENTS (opacity-measure.ts, drawn in the browser by opacity-measure-page.ts and
 * recomputed here, independently, for the references). 640×360, the frame size of the scenes. Plain functions of (x, y).
 */
export const MW = 640, MH = 360;
export type Px = (x: number, y: number) => [number, number, number];
const rx = (x: number) => Math.floor((x * 255) / (MW - 1)), ry = (y: number) => Math.floor((y * 255) / (MH - 1));
/** Picture A: red ramps with x, green with y, blue is a fine diagonal texture (so resampling and blurring have something to do). */
export const picA: Px = (x, y) => [rx(x), ry(y), (x * 7 + y * 13) & 255];
/** Picture B: the same ramps swapped, another texture. */
export const picB: Px = (x, y) => [ry(y), rx(x), (x * 11 + y * 5) & 255];
/** The video frame `fr` of the tap scenes: every frame is another picture, far from the others in every channel. */
export const picF = (fr: number): Px => (x, y) => [(rx(x) + fr * 40) & 255, (ry(y) + fr * 70) & 255, ((x + y) * 3 + fr * 90) & 255];
export const rgbOfPx = (p: Px): Uint8Array => { const o = new Uint8Array(MW * MH * 3); for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) o.set(p(x, y), (y * MW + x) * 3); return o; };
/** Title fill colour of the title measurements. */
export const TITLE_RGB: [number, number, number] = [210, 105, 42];
