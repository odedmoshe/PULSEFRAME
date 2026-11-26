/**
 * The trip map's painter (wave 8 tripmap; core mapContract.ts; carrier engine drawnPainters.ts). LEAD PRE-PASS: the contract and a stub
 * that draws nothing and reports `drawn.map` (so a preview says so and a still or an export refuses); registered on import of the engine
 * index (register.ts) with the `ready` hook that loads the outline chunk. W2 builds paintMap and sets MAP_PAINTER_BUILT.
 *
 * The painter's contract (beyond the carrier's: opaque, pure, context at the anchor, one unit = one output pixel, env.height pixels):
 * - The map is the WHOLE frame (the kind has no box): it fills env.width × env.height around the anchor with the sea colour, then land,
 *   lakes, coasts, route, marker, rings and labels, all from MAP_LOOK_COLOURS[payload.look].
 * - Time: only env.localFrame and the stops' `at` (integers). Never the clip's start or length (C4); env.clipTime is not read.
 * - Camera from core cameraAt (1/64-px grid), one setTransform per level, Path2D groups cached per page (C5), culled by bbox, filled
 *   even-odd, coast stroked with lineWidth = px / scale; `cut` edges never stroked (C2); land drawn again at ±360° where the view
 *   crosses ±180°.
 * - Labels: font MAP_LABEL_FONT (the bundled canvas font Heebo 700, loaded by ensureFonts on every page; covered by the bundle digest,
 *   so nothing is keyed), size MAP_LABEL_SIZE_FRAC × env.height, direction per label; placement from core placeLabels, cached by
 *   (payload, output size), populated only after the font is ready (C10). A label that does not fit is not drawn.
 * - Flash (C6): the look table's fill rule is a unit test through flashCells; the gate is the proof's analyser sweep per look.
 */
import type { DrawnPainter } from '../drawnPainters.ts';

export const MAP_PAINTER_BUILT = false;
/** Why the map is not drawn in this build (the carrier reports it under drawn.map). */
export const MAP_NOT_BUILT_WHY = 'trip maps are not drawn in this build yet';

export const paintMap: DrawnPainter = (_ctx, _payload, env) => {
  env.note('drawn.map', MAP_NOT_BUILT_WHY);
};
