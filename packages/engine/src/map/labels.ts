/**
 * The trip map's names (plan §4.4 as corrected by tripmap-verify C10). The placement is core placeLabels (a heuristic: W1), decided
 * ONCE per (payload, output size) in the whole-trip view (the camera at stop 0's `at`, before the push-in), from widths measured in
 * the label font only once that font is ready in this page; then cached and kept on every frame: a label's box moves with its stop's
 * anchor and never changes side, so nothing jumps or blinks. A stop whose label does not fit is not drawn and is reported (hidden).
 * The font is the bundled Heebo 700 (MAP_LABEL_FONT, loaded by ensureFonts on every page): nothing font-related is keyed.
 */
import { cameraAt, MAP_LABEL_FONT, MAP_LABEL_SIZE_FRAC, placeLabels, stopPoints as coreStopPoints, toScreen, type LabelPlacement, type MapCamera, type MapPayload, type MapSize, type MercPoint } from '@pulseframe/core';

/** Line height of a label box, as a multiple of the font size. */
export const MAP_LABEL_LINE = 1.25;
/** The label font's size in output pixels and its canvas font string. */
export const labelPx = (height: number): number => MAP_LABEL_SIZE_FRAC * height;
export const labelFont = (height: number): string => `${MAP_LABEL_FONT.weight} ${labelPx(height)}px "${MAP_LABEL_FONT.family}"`;
/** A name reads right to left when its first strong letter is Hebrew or Arabic. */
export const isRtlName = (name: string): boolean => { const m = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿ]/.exec(name); return !!m && /[֐-ۿ]/.test(m[0]); };

/** Pixel snapping of the map (1/MAP_PIXEL_GRID of an output pixel). */
export const snapPx = (v: number): number => Math.round(v * 64) / 64;
/** A stop's position in Mercator units, longitude unwrapped relative to stop 0: core stopPoints (hidden via-points included). */
export const stopPoints = (p: MapPayload): MercPoint[] => coreStopPoints(p);
/** A Mercator point in output pixels (top-left origin) under a camera: core toScreen, snapped to the 1/64-px grid. */
export function toPixels(pt: MercPoint, cam: MapCamera, size: MapSize): { x: number; y: number } {
  const q = toScreen(cam, size, pt);
  return { x: snapPx(q.x), y: snapPx(q.y) };
}

export interface LabelLayout { placements: LabelPlacement[]; /** each stop's anchor in the whole-trip view, output pixels */ anchors: { x: number; y: number }[]; px: number }
/**
 * The layout of a payload's labels at an output size, from the widths `measure` gives in the label font (the painter measures with
 * its canvas after the font is ready; the proof measures in the pinned Chromium and calls this same function). Pure and uncached.
 */
export function mapLabelLayout(p: MapPayload, size: MapSize, measure: (name: string, rtl: boolean) => number): LabelLayout {
  const whole = cameraAt(p, p.stops[0]!.at, size);
  const pts = stopPoints(p);
  const anchors = pts.map((pt) => toPixels(pt, whole, size));
  const px = labelPx(size.height), h = px * MAP_LABEL_LINE;
  const shown = p.stops.map((s, i) => ({ s, i })).filter(({ s }) => !s.hidden);
  const placed = placeLabels(shown.map(({ s, i }) => { const rtl = isRtlName(s.name); return { stopId: s.id, x: anchors[i]!.x, y: anchors[i]!.y, width: measure(s.name, rtl), height: h, rtl }; }), anchors, size); // every stop's dot, hidden via-points included (core placeLabels' reading)
  const byId = new Map(placed.map((l) => [l.stopId, l]));
  return { placements: p.stops.map((s) => byId.get(s.id) ?? { stopId: s.id, box: null, side: null }), anchors, px };
}

const CACHE = new Map<string, LabelLayout>();
const CACHE_MAX = 32;
/** The cached layout, or null when it is not in the cache yet. */
export function cachedLabelLayout(p: MapPayload, size: MapSize): LabelLayout | null { return CACHE.get(`${size.width}x${size.height}|${JSON.stringify(p)}`) ?? null; }
/** Computes and caches the layout (call only once the font is ready: C10). */
export function storeLabelLayout(p: MapPayload, size: MapSize, measure: (name: string, rtl: boolean) => number): LabelLayout {
  const key = `${size.width}x${size.height}|${JSON.stringify(p)}`;
  let l = CACHE.get(key);
  if (!l) {
    l = mapLabelLayout(p, size, measure);
    if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
    CACHE.set(key, l);
  }
  return l;
}
/** Tests only. */
export const clearLabelLayouts = (): void => CACHE.clear();

/** A placed label's box on a frame: the whole-view box moved by its anchor's move (same side, same size, on every frame). */
export function labelBoxAt(layout: LabelLayout, stop: number, anchorNow: { x: number; y: number }): { x: number; y: number; w: number; h: number } | null {
  const b = layout.placements[stop]?.box, a = layout.anchors[stop];
  if (!b || !a) return null;
  return { x: snapPx(b.x + anchorNow.x - a.x), y: snapPx(b.y + anchorNow.y - a.y), w: b.w, h: b.h };
}

type FontSet = { check(font: string, text?: string): boolean };
let fontCheckForTests: ((font: string) => boolean) | null = null;
/** TEST ONLY (labelled stand-in): Node has no FontFaceSet; a unit test says whether the label font counts as loaded. */
export const setLabelFontCheckForTests = (f: ((font: string) => boolean) | null): void => { fontCheckForTests = f; };
/** True when this page has the label font loaded (document.fonts, or the worker's fonts). */
export function labelFontReady(font: string): boolean {
  if (fontCheckForTests) return fontCheckForTests(font);
  const g = globalThis as { document?: { fonts?: FontSet }; fonts?: FontSet };
  const set = g.document?.fonts ?? g.fonts;
  return !!set && set.check(font, 'אבג ABC');
}
