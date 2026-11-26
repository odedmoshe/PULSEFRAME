/** The outline data once the carrier's ready hook loaded it (register.ts); null before. Kept apart so the painter and the hook share it without an import cycle. */
import type { OutlineData } from './outlines.ts';

let data: OutlineData | null = null;
export const mapOutlines = (): OutlineData | null => data;
export const setMapOutlines = (d: OutlineData | null): void => { data = d; };
