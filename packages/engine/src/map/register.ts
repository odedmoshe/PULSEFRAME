/**
 * Registers the trip map's painter with the carrier (engine drawnPainters.ts) once per page, on import of the engine index. The `ready`
 * hook loads the outline chunk before the first frame that holds a map (a failed load is reported as drawn.map; nothing is drawn).
 */
import { drawnPainter, registerDrawnPainter } from '../drawnPainters.ts';
import { loadOutlines, type OutlineData } from './outlines.ts';
import { paintMap } from './paintMap.ts';

let data: OutlineData | null = null;
/** The loaded outline data, or null before the ready hook finished (the painter only runs after it). */
export const mapOutlines = (): OutlineData | null => data;
if (!drawnPainter('map')) registerDrawnPainter('map', paintMap, { ready: async () => { data = await loadOutlines(); } });
