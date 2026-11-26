/**
 * The trip map's web contract (wave 8 tripmap pre-pass): test ids are unique and namespaced, the strings read in both languages, the
 * label joins the shown names as typed in travel order, the panel registers with the carrier, and nothing is offered before it is built.
 */
import { describe, expect, it } from 'vitest';
import type { MapPayload } from '@pulseframe/core';
import { drawnPanel } from '../drawnPanels.tsx';
import './register.ts';
import { TRIPMAP_TESTIDS } from './tripMap.testids.ts';
import { tripMapLabel, tripMapT } from './tripMap.strings.ts';
import { TRIPMAP_ENTRY_SHOWN, TRIPMAP_UI_BUILT } from './TripMapDialog.tsx';
import { MAP_OPS_BUILT } from '@pulseframe/core';
import { MAP_PAINTER_BUILT } from '@pulseframe/engine';

const map: MapPayload = {
  kind: 'map', v: 1, look: 'paper', camera: 'whole', timing: 'even',
  stops: [
    { id: 'a', name: 'תל אביב', lon: 34_770_000, lat: 32_080_000, at: 30 },
    { id: 'b', name: '', hidden: true, lon: 34_900_000, lat: 30_600_000, at: 60, via: 'road' },
    { id: 'c', name: 'אילת', lon: 34_950_000, lat: 29_560_000, at: 120, via: 'road' },
  ],
};
describe('trip map web contract', () => {
  it('test ids are unique and all start with trip-map-', () => {
    const ids = Object.values(TRIPMAP_TESTIDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^trip-map(-[a-z]+)+$/);
  });
  it('strings and the label in both languages (hidden via-points left out)', () => {
    expect(tripMapT('he')('new')).toBe('מפת טיול חדשה');
    expect(tripMapT('en')('new')).toBe('New trip map');
    expect(tripMapLabel(map, 'he')).toBe('מפה: תל אביב ← אילת');
    expect(tripMapLabel(map, 'en')).toBe('Map: תל אביב → אילת');
  });
  it('the panel is registered with the carrier; the entry is offered once the dialog is built', () => {
    expect(drawnPanel('map')).toBeTruthy();
    expect(TRIPMAP_UI_BUILT).toBe(true);
    // the entry needs all three parts: never shown before the painter draws
    expect(TRIPMAP_ENTRY_SHOWN).toBe(TRIPMAP_UI_BUILT && MAP_OPS_BUILT && MAP_PAINTER_BUILT);
    expect(TRIPMAP_ENTRY_SHOWN).toBe(true);
  });
});
