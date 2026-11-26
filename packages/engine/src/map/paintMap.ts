/**
 * The trip map's painter (wave 8 tripmap; core mapContract.ts; carrier engine drawnPainters.ts). Registered on import of the engine index
 * (register.ts) with the `ready` hook that loads the outline chunk. What it cannot draw (no Path2D, the core map functions not built,
 * the label font not loaded yet) it reports as drawn.map with the reason, so a preview says so and a still or an export refuses.
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
import { cameraAt, isMapPayload, MAP_LABEL_FADE_SECONDS, MAP_LOOK_COLOURS, MAP_RING_SECONDS, mapFrames, progressAt, type MapCamera, type MapPayload, type MapSize, type MercPoint } from '@pulseframe/core';
import type { Ctx2D } from '../compositor2d.ts';
import type { DrawnPaintEnv, DrawnPainter } from '../drawnPainters.ts';
import { latOfMercY, mapLevelFor, type OutlineData, type OutlineLevel } from './outlines.ts';
import { mapOutlines } from './mapData.ts';
import { groupPaths, type PathFactory, type PathSink } from './pathCache.ts';
import { cachedLabelLayout, isRtlName, labelBoxAt, labelFont, labelFontReady, snapPx, storeLabelLayout, toPixels } from './labels.ts';
import { routeOf, routePointAt, routeUpTo } from './route.ts';

export const MAP_PAINTER_BUILT = true;
/** Why the map is not drawn when a part it needs is missing (the carrier reports it under drawn.map). */
export const MAP_NOT_BUILT_WHY = 'trip maps are not drawn in this build yet';

/** Sizes as fractions of the output height (one unit = one output pixel; 2 px coast at 1080p). */
export const MAP_SIZES = { coast: 2 / 1080, route: 5 / 1080, dot: 9 / 1080, marker: 14 / 1080, outline: 3 / 1080, ring: 4 / 1080 } as const;
/** Coast line joins. Round is the default; proof check 19 records one sample of round against bevel. */
export const MAP_COAST_JOIN: CanvasLineJoin = 'round';

/** What one frame drew (tests and the proof). */
export interface MapFrameInfo { level: OutlineLevel['id']; copies: number[]; groups: number; camera: MapCamera; marker: { x: number; y: number }; labels: { stopId: string; box: { x: number; y: number; w: number; h: number } | null; alpha: number }[] }
let lastInfo: MapFrameInfo | null = null;
/** The last frame's numbers in this page (tests and the proof; never read by drawing). */
export const lastMapFrame = (): MapFrameInfo | null => lastInfo;

const pathFactory = (): PathFactory | null => {
  const P = (globalThis as { Path2D?: new () => PathSink }).Path2D;
  return P ? () => new P() : null;
};

/** The view rectangle [minX, minY, maxX, maxY] in Mercator units, and its span in degrees of latitude. */
export function viewOf(cam: MapCamera, size: MapSize): { view: [number, number, number, number]; spanLatDeg: number } {
  const hh = cam.spanY / 2, hw = (cam.spanY * size.width) / size.height / 2;
  return { view: [cam.cx - hw, cam.cy - hh, cam.cx + hw, cam.cy + hh], spanLatDeg: latOfMercY(cam.cy + hh) - latOfMercY(cam.cy - hh) };
}
/** The world copies (multiples of 360°) a view overlaps: the data spans −180…180, so a view across ±180 needs ±360 too. */
export function copiesFor(view: readonly [number, number, number, number]): number[] {
  const out: number[] = [];
  for (let k = Math.floor((view[0] + 180) / 360); k <= Math.floor((view[2] + 180) / 360); k++) out.push(360 * k);
  return out;
}
/** The level for a view; the detail box test is made on the view moved into −180…180. */
export function levelForView(data: OutlineData, view: readonly [number, number, number, number], spanLatDeg: number): OutlineLevel {
  const shift = 360 * Math.round(((view[0] + view[2]) / 2) / 360);
  return mapLevelFor(data, [view[0] - shift, view[1], view[2] - shift, view[3]], spanLatDeg);
}

/** The groups of one level a view needs, per world copy, with their cached paths (built here, before anything is drawn). */
function visibleGroups(data: OutlineData, level: OutlineLevel, view: readonly [number, number, number, number], copies: number[], make: PathFactory) {
  const out: { off: number; layer: 'land' | 'lakes'; paths: { fill: PathSink; stroke: PathSink } }[] = [];
  for (const off of copies) for (const layer of ['land', 'lakes'] as const) level[layer].forEach((g, i) => {
    const [x0, y0, x1, y1] = g.bbox;
    if (x0 * level.q + off > view[2] || x1 * level.q + off < view[0] || y0 * level.q > view[3] || y1 * level.q < view[1]) return;
    out.push({ off, layer, paths: groupPaths(data, level, layer, i, make) });
  });
  return out;
}
/** Land, lakes and coasts, in anchor coordinates (the frame centre is 0,0): one transform per world copy, filled even-odd. */
function drawOutlines(ctx: Ctx2D, level: OutlineLevel, cam: MapCamera, size: MapSize, copies: number[], visible: ReturnType<typeof visibleGroups>, colours: (typeof MAP_LOOK_COLOURS)['paper']): void {
  const k = size.height / cam.spanY, a = level.q * k;
  const pass = (fn: (p: { fill: PathSink; stroke: PathSink }) => void, which: 'land' | 'lakes' | 'both') => {
    for (const off of copies) {
      const rows = visible.filter((v) => v.off === off && (which === 'both' || v.layer === which));
      if (!rows.length) continue;
      ctx.save();
      ctx.transform(a, 0, 0, -a, snapPx((off - cam.cx) * k), snapPx(cam.cy * k));
      for (const v of rows) fn(v.paths);
      ctx.restore();
    }
  };
  ctx.fillStyle = colours.land;
  pass((p) => ctx.fill(p.fill as Path2D, 'evenodd'), 'land');
  ctx.fillStyle = colours.lake;
  pass((p) => ctx.fill(p.fill as Path2D, 'evenodd'), 'lakes');
  ctx.strokeStyle = colours.coast;
  ctx.lineWidth = (MAP_SIZES.coast * size.height) / a;
  ctx.lineJoin = MAP_COAST_JOIN;
  ctx.lineCap = 'round';
  pass((p) => ctx.stroke(p.stroke as Path2D), 'both');
}

const disc = (ctx: Ctx2D, x: number, y: number, r: number, fill: string, ring: string, ringW: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = ringW;
  ctx.strokeStyle = ring;
  ctx.stroke();
};

function paint(ctx: Ctx2D, p: MapPayload, env: DrawnPaintEnv, data: OutlineData, make: PathFactory): void {
  const size: MapSize = { width: env.width, height: env.height }, W = env.width, H = env.height, f = env.localFrame;
  const colours = MAP_LOOK_COLOURS[p.look];
  // everything that can refuse (the core map functions, the data) is computed before the first save, so a refusal leaves the context as it was
  const cam = cameraAt(p, f, size);
  const { view, spanLatDeg } = viewOf(cam, size);
  const level = levelForView(data, view, spanLatDeg), copies = copiesFor(view);
  const visible = visibleGroups(data, level, view, copies, make);
  const route = routeOf(p), prog = progressAt(p, f), n = p.stops.length;
  const travelled = p.stops.slice(1).map((s, i) => (i + 1 < prog.leg ? routeUpTo(route.legs[i]!, 1) : i + 1 === prog.leg ? routeUpTo(route.legs[i]!, prog.s) : []));
  const markerAt = prog.leg === 0 ? route.stops[0]! : routePointAt(route.legs[Math.min(prog.leg, n - 1) - 1]!, prog.s);
  const font = labelFont(H), fontReady = labelFontReady(font);
  let layout = fontReady ? cachedLabelLayout(p, size) : null;
  if (fontReady && !layout) {
    ctx.save();
    ctx.font = font;
    try { layout = storeLabelLayout(p, size, (name, rtl) => { ctx.direction = rtl ? 'rtl' : 'ltr'; return ctx.measureText(name).width; }); } finally { ctx.restore(); }
  }
  // anchor coordinates: output pixel (x, y) is (x − W/2, y − H/2)
  const px = (pt: MercPoint) => { const q = toPixels(pt, cam, size); return { x: q.x - W / 2, y: q.y - H / 2 }; };

  ctx.save();
  ctx.beginPath();
  ctx.rect(-W / 2, -H / 2, W, H);
  ctx.clip();
  ctx.fillStyle = colours.sea;
  ctx.fillRect(-W / 2, -H / 2, W, H);
  drawOutlines(ctx, level, cam, size, copies, visible, colours);

  // route: whole legs before the marker's leg, then the travelled part of its leg
  const legW = MAP_SIZES.route * H;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = legW;
  ctx.strokeStyle = colours.route;
  travelled.forEach((pts, i) => {
    if (pts.length < 2) return;
    ctx.setLineDash(p.stops[i + 1]!.via === 'boat' ? [0, 2.4 * legW] : []);
    ctx.beginPath();
    pts.forEach((pt, j) => { const q = px(pt); if (j === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // dots of the stops reached (stop 0 always), then the arrival rings, then the marker
  const outlineW = MAP_SIZES.outline * H;
  p.stops.forEach((s, i) => { if (s.hidden || (i > 0 && f < s.at)) return; const q = px(route.stops[i]!); disc(ctx, q.x, q.y, MAP_SIZES.dot * H, colours.route, colours.labelOutline, outlineW); });
  const ringF = Math.max(1, mapFrames(MAP_RING_SECONDS, env.fps)), markerR = MAP_SIZES.marker * H;
  for (let i = 1; i < n; i++) {
    const age = f - p.stops[i]!.at;
    if (age < 0 || age >= ringF) continue;
    const t = age / ringF, q = px(route.stops[i]!);
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.beginPath();
    ctx.arc(q.x, q.y, markerR * (1 + 2 * t), 0, 2 * Math.PI);
    ctx.lineWidth = MAP_SIZES.ring * H;
    ctx.strokeStyle = colours.marker;
    ctx.stroke();
    ctx.restore();
  }
  const m = px(markerAt);
  disc(ctx, m.x, m.y, markerR, colours.marker, colours.labelOutline, outlineW);

  // labels: measured only once the font is ready (C10); placement cached by (payload, output size) and kept on every frame
  const labels: MapFrameInfo['labels'] = [];
  if (!layout) env.note('drawn.map', `the label font (${font}) is not loaded in this page yet, so the names of the stops cannot be measured`);
  else {
    const fadeF = Math.max(1, mapFrames(MAP_LABEL_FADE_SECONDS, env.fps));
    ctx.font = font;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.18 * layout.px;
    p.stops.forEach((s, i) => {
      if (s.hidden) return;
      const box = labelBoxAt(layout, i, toPixels(route.stops[i]!, cam, size));
      const from = i === 0 ? s.at - fadeF : s.at;
      const alpha = Math.min(1, Math.max(0, (f - from) / fadeF));
      labels.push({ stopId: s.id, box, alpha });
      if (!box || alpha <= 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.direction = isRtlName(s.name) ? 'rtl' : 'ltr';
      const x = box.x - W / 2, y = box.y + box.h / 2 - H / 2;
      ctx.strokeStyle = colours.labelOutline;
      ctx.strokeText(s.name, x, y);
      ctx.fillStyle = colours.label;
      ctx.fillText(s.name, x, y);
      ctx.restore();
    });
  }
  ctx.restore();
  lastInfo = { level: level.id, copies, groups: visible.length, camera: cam, marker: { x: m.x + W / 2, y: m.y + H / 2 }, labels };
}

/**
 * The painter. Reads the payload, env.width/height/localFrame/fps and the loaded outline data only: never env.clipTime, the clip's
 * start or its length (C4).
 */
export const paintMap: DrawnPainter = (ctx, payload, env) => {
  if (!isMapPayload(payload)) { env.note('drawn.map', 'this drawn clip does not hold a trip map payload'); return; }
  const data = mapOutlines();
  if (!data) { env.note('drawn.map', 'the trip map outline data is not loaded in this page'); return; }
  const make = pathFactory();
  if (!make) { env.note('drawn.map', "this browser's canvas has no Path2D, so the coastlines cannot be drawn"); return; }
  try {
    paint(ctx, payload, env, data, make);
  } catch (e) {
    // the core map functions of a build without them (MapNotBuiltError) or a payload they refuse: reported, never a blank sea passed as a map
    env.note('drawn.map', (e as { code?: string })?.code === 'map_not_built' ? MAP_NOT_BUILT_WHY : `the trip map could not be drawn: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
  }
};
