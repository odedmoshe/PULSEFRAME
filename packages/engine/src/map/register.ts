/**
 * Registers the trip map's painter with the carrier (engine drawnPainters.ts) once per page, on import of the engine index. The `ready`
 * hook loads the outline chunk before the first frame that holds a map (a failed load is reported as drawn.map; nothing is drawn).
 * No test switch lives here: proof check 13 makes the chunk unloadable by serving a copy of the web bundle without it.
 */
import { drawnPainter, registerDrawnPainter } from '../drawnPainters.ts';
import { loadOutlines } from './outlines.ts';
import { setMapOutlines } from './mapData.ts';
import { paintMap } from './paintMap.ts';

export { mapOutlines } from './mapData.ts';
if (!drawnPainter('map')) registerDrawnPainter('map', paintMap, { ready: async () => { setMapOutlines(await loadOutlines()); } });
