/**
 * The trip map painter's contract (wave 8 tripmap pre-pass; W2 owns this file and builds the todos): registered with the carrier on
 * import of the engine index with a ready hook that loads the committed outline chunk; until MAP_PAINTER_BUILT it draws nothing and
 * reports drawn.map, so a still or an export refuses.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { drawnPainter, drawnUnready, loadOutlines, MAP_NOT_BUILT_WHY, MAP_PAINTER_BUILT, paintMap, prepareDrawn, decodeGroup, mapLevelFor, MapDataNotBuiltError } from '../index.ts';

describe('the map painter as registered', () => {
  it('is the registered painter of kind map; its ready hook loads format 1 data', async () => {
    expect(drawnPainter('map')).toBe(paintMap);
    await prepareDrawn(['map']);
    expect(drawnUnready('map')).toBeNull();
    const d = await loadOutlines();
    expect(d.format).toBe(1);
    expect(d.levels.map((l) => l.id)).toEqual(['coarse', 'world', 'detail']);
  });
  it('until built it reports drawn.map and draws nothing; the reader functions are typed stubs', () => {
    if (MAP_PAINTER_BUILT) return;
    const notes: [string, string][] = [];
    const ctx = new Proxy({}, { get: () => () => { throw new Error('the stub must not draw'); } }) as never;
    paintMap(ctx, { kind: 'map' }, { width: 64, height: 36, clipTime: T.ZERO, localFrame: 0, fps: { num: 30, den: 1 }, note: (id, why) => notes.push([id, why]) });
    expect(notes).toEqual([['drawn.map', MAP_NOT_BUILT_WHY]]);
    expect(() => decodeGroup({ bbox: [0, 0, 0, 0], rings: 0, vertices: 0, cutEdges: 0, data: '' }, 0.01)).toThrow(MapDataNotBuiltError);
  });
  it.todo('W2: decodeGroup agrees with the reference decoder of tools/tripmap/data.test.ts on every committed group');
  it.todo('W2: mapLevelFor — coarse above 30°, world 8°–30°, detail only for a view wholly inside DETAIL_BOX under 8° (a view touching the box edge draws world)');
  it.todo('W2: cut edges are never stroked: a stroke path built from a ring with a cut run has no segment along that run');
  it.todo('W2: flash rule through flashCells (C6): for each look, two-colour synthetic frames of sea/land/lake pairs stay under the 0.1 transition step; coast step ≤ MAP_COAST_MAX_STEP');
  it.todo('W2: the painter reads only env.localFrame and the stops (same picture after split / trim-start at the same timeline time); camera on the 1/64-px grid');
  it.todo('W2: land drawn again at ±360° where the view crosses ±180° (Tokyo → Los Angeles)');
  it.todo('W2: labels measured only after the font is ready; placement cached by (payload, output size); a hidden label is not drawn');
});
