import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { boxToScreen, edgeProxies, handlePoints, layerBox, overlapsOnTrack, pxToFrameTime, rotationFromDrag, scaleFromDrag, screenDeltaToFrameFraction, snapTime, markerSnapCandidates, type LayerBox, type ViewRect } from './interactions.math.ts';
import { barGrid, barLabelEvery, beatSnapTargets, CATALOG_DRAG_PREFIX, catalogDragFrom, catalogDragType, cutsOf, laneOrder, rulerLabel, rulerStep, signedTimecode, snapToTargets, splitterHeight } from './interactions.math.ts';
import { capPlacement, cutRoom, labelsUnder, pickSpoken, SPOKEN_CHIP_PAD_PX, TL_USUAL_SOUND } from './interactions.math.ts';

const s = (v: number) => T.rt(v, 1);

describe('snapTime', () => {
  const candidates = [s(0), s(2), s(4)];
  it('returns the exact candidate within threshold', () => {
    const r = snapTime({ time: T.rt(1990, 1000), candidates, pxPerSecond: 100, thresholdPx: 8 });
    expect(r).toEqual({ time: s(2), snapped: true, index: 1 });
  });
  it('does not snap outside the threshold', () => {
    const t = T.rt(3, 2);
    expect(snapTime({ time: t, candidates, pxPerSecond: 100, thresholdPx: 8 })).toEqual({ time: t, snapped: false, index: -1 });
  });
  it('ties go to the earlier candidate', () => {
    expect(snapTime({ time: s(1), candidates: [s(0), s(2)], pxPerSecond: 4, thresholdPx: 8 }).index).toBe(0);
  });
  it('threshold scales with zoom', () => {
    expect(snapTime({ time: T.rt(1, 10), candidates: [s(0)], pxPerSecond: 90, thresholdPx: 8 }).snapped).toBe(false);
    expect(snapTime({ time: T.rt(1, 10), candidates: [s(0)], pxPerSecond: 80, thresholdPx: 8 }).snapped).toBe(true);
  });
});

describe('pxToFrameTime', () => {
  it('rounds to the nearest frame at 30 fps', () => {
    expect(pxToFrameTime(45, 90, { num: 30, den: 1 })).toEqual(T.frameTime(15, { num: 30, den: 1 }));
    expect(T.eq(pxToFrameTime(46, 90, { num: 30, den: 1 }), T.rt(1, 2))).toBe(true);
  });
  it('is exact at 30000/1001', () => {
    const r = pxToFrameTime(90, 90, { num: 30000, den: 1001 });
    expect(r).toEqual({ value: '1001', timescale: 1000 });
    expect(T.isFrameAligned(r, { num: 30000, den: 1001 })).toBe(true);
  });
  it('handles negative offsets', () => {
    expect(T.eq(pxToFrameTime(-90, 90, { num: 30, den: 1 }), T.rt(-1, 1))).toBe(true);
  });
});

describe('layerBox / boxToScreen', () => {
  it('contain-fits a 4:3 picture into a 1920x1080 frame', () => {
    const b = layerBox({ frameW: 1920, frameH: 1080, naturalW: 400, naturalH: 300, transform: { x: 0, y: 0, scale: 1, rotation: 0 } });
    expect(b).toEqual({ cx: 960, cy: 540, w: 1440, h: 1080, rotationDeg: 0 });
  });
  it('applies offset, scale and rotation', () => {
    const b = layerBox({ frameW: 1000, frameH: 500, naturalW: 1000, naturalH: 500, transform: { x: 0.1, y: -0.2, scale: 0.5, rotation: 30 } });
    expect(b).toEqual({ cx: 600, cy: 150, w: 500, h: 250, rotationDeg: 30 });
  });
  it('uses text size as is with fit:false', () => {
    const b = layerBox({ frameW: 1000, frameH: 500, naturalW: 800, naturalH: 60, transform: { x: 0, y: 0, scale: 2, rotation: 0 }, fit: false });
    expect(b.w).toBe(1600);
    expect(b.h).toBe(120);
  });
  it('maps to screen pixels', () => {
    expect(boxToScreen({ cx: 960, cy: 540, w: 1440, h: 1080, rotationDeg: 5 }, 480, 1920)).toEqual({ cx: 240, cy: 135, w: 360, h: 270, rotationDeg: 5 });
  });
  it('maps screen deltas to frame fractions', () => {
    expect(screenDeltaToFrameFraction(48, -27, 480, 270)).toEqual({ dx: 0.1, dy: -0.1 });
  });
});

describe('scaleFromDrag', () => {
  it('scales by distance ratio', () => expect(scaleFromDrag(100, 150, 2)).toBe(3));
  it('clamps to schema range', () => {
    expect(scaleFromDrag(100, 0, 1)).toBe(0.01);
    expect(scaleFromDrag(1, 1000, 1)).toBe(20);
  });
  it('ignores a degenerate start', () => expect(scaleFromDrag(0, 50, 1.5)).toBe(1.5));
});

describe('rotationFromDrag', () => {
  const c = { x: 0, y: 0 };
  it('quarter turn clockwise on screen', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: 0, y: 1 }, 10, false)).toBeCloseTo(100, 9);
  });
  it('wraps across +-180 without a jump', () => {
    expect(rotationFromDrag(c, { x: -1, y: 1 }, { x: -1, y: -1 }, 0, false)).toBeCloseTo(90, 9);
    expect(rotationFromDrag(c, { x: -1, y: -1 }, { x: -1, y: 1 }, 0, false)).toBeCloseTo(-90, 9);
  });
  it('snaps to 15 degrees', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: Math.cos(0.3), y: Math.sin(0.3) }, 0, true)).toBe(15);
  });
  it('clamps to the schema range', () => {
    expect(rotationFromDrag(c, { x: 1, y: 0 }, { x: 0, y: 1 }, 3590, false)).toBe(3600);
  });
});

describe('overlapsOnTrack', () => {
  const clips = [
    { id: 'a', start: s(0), duration: s(2) },
    { id: 'b', start: s(3), duration: s(2) },
  ];
  it('detects overlap, treating intervals as half-open', () => {
    expect(overlapsOnTrack(clips, ['a'], s(2), s(4))).toBe(true);
    expect(overlapsOnTrack(clips, ['a'], s(2), s(3))).toBe(false);
    expect(overlapsOnTrack(clips, ['a'], s(5), s(7))).toBe(false);
  });
  it('ignores moving clips', () => {
    expect(overlapsOnTrack(clips, ['a', 'b'], s(0), s(10))).toBe(false);
    expect(overlapsOnTrack(clips, ['b'], s(1), s(2))).toBe(true);
  });
});

describe('markerSnapCandidates', () => {
  const rate = { num: 30, den: 1 };
  it('moves markers to the nearest frame', () => {
    const c = markerSnapCandidates([T.rt(1, 3), T.rt(5, 1)], rate);
    expect(c.every((t) => T.isFrameAligned(t, rate))).toBe(true);
    expect(T.eq(c[0]!, T.rt(10, 30))).toBe(true);
  });
  it('a snapped time is frame-aligned and exact', () => {
    const c = markerSnapCandidates([T.rt(1003, 1000)], rate);
    const r = snapTime({ time: T.rt(1, 1), candidates: c, pxPerSecond: 100, thresholdPx: 8 });
    expect(r.snapped).toBe(true);
    expect(T.isFrameAligned(r.time, rate)).toBe(true);
  });
});

describe('canvas handles outside the viewer', () => {
  // A 640 x 360 canvas centred in a 720 x 440 viewer: the viewer reaches 40 px beyond the canvas on every side.
  const view: ViewRect = { left: -40, top: -40, right: 680, bottom: 400 };
  const opts = { view, margin: 6, gap: 16 };
  const at = (b: LayerBox) => Object.fromEntries(handlePoints(b).map((p) => [p.id, [Math.round(p.x), Math.round(p.y)]]));
  const inView = (p: { x: number; y: number }) => p.x >= view.left + 6 && p.x <= view.right - 6 && p.y >= view.top + 6 && p.y <= view.bottom - 6;

  it('handle points follow the box, its rotation, and the rotate handle 28 px above the top edge', () => {
    const b: LayerBox = { cx: 320, cy: 180, w: 640, h: 360, rotationDeg: 0 };
    expect(at(b)).toEqual({ n: [320, 0], ne: [640, 0], e: [640, 180], se: [640, 360], s: [320, 360], sw: [0, 360], w: [0, 180], nw: [0, 0], rotate: [320, -28] });
    // turned a quarter clockwise (screen y down): the top edge now faces right
    expect(at({ ...b, rotationDeg: 90 })).toMatchObject({ n: [500, 180], e: [320, 500], rotate: [528, 180] });
  });

  it('a clip that fits the viewer needs no stand-in', () => {
    expect(edgeProxies({ box: { cx: 320, cy: 180, w: 640, h: 360, rotationDeg: 0 }, ...opts })).toEqual([]);
  });

  it('a clip that fills the canvas in a viewer with no room above: only the rotate handle gets a stand-in, at the top edge, clear of the n handle', () => {
    const tight: ViewRect = { left: -30, top: -4, right: 670, bottom: 364 };
    const p = edgeProxies({ box: { cx: 320, cy: 180, w: 640, h: 360, rotationDeg: 0 }, view: tight, margin: 6, gap: 16 });
    expect(p.map((x) => x.id)).toEqual(['rotate']);
    expect(p[0]!.y).toBe(2); // pulled to the top edge, a half handle inside
    // the n handle (320, 0) shows (most of it) 2 px away: the stand-in slides along the edge until it is a grip's gap away
    expect(Math.hypot(p[0]!.x - 320, p[0]!.y - 0)).toBeGreaterThanOrEqual(16);
    expect(Math.abs(p[0]!.x - 320)).toBe(16);
  });

  it('a clip scaled three times: every handle is outside, so one scale stand-in and the rotate stand-in, both inside the viewer and apart', () => {
    const p = edgeProxies({ box: { cx: 320, cy: 180, w: 1920, h: 1080, rotationDeg: 0 }, ...opts });
    expect(p.map((x) => x.id).sort()).toEqual(['n', 'rotate']); // n, e, s and w are the nearest to the viewer, and n comes first on a tie
    for (const x of p) expect(inView(x), x.id).toBe(true);
    expect(Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y)).toBeGreaterThanOrEqual(16);
    expect(p.every((x) => !x.mirror)).toBe(true);
    // no move stand-in: the box covers the viewer, so its move handle is under the pointer anywhere in it
    expect(p.some((x) => x.id === 'move')).toBe(false);
  });

  it('a clip moved wholly out of the viewer gets a move stand-in at the edge, and scale and rotate ones', () => {
    const p = edgeProxies({ box: { cx: 1400, cy: 180, w: 320, h: 180, rotationDeg: 0 }, ...opts });
    expect(p.map((x) => x.id).sort()).toEqual(['move', 'rotate', 'w']);
    for (const x of p) { expect(inView(x), x.id).toBe(true); expect(x.x).toBe(674); } // all on the right edge
    const ys = p.map((x) => x.y).sort((a, b) => a - b);
    expect(ys[1]! - ys[0]!).toBeGreaterThanOrEqual(16);
    expect(ys[2]! - ys[1]!).toBeGreaterThanOrEqual(16);
  });

  it('a handle that has the keyboard focus but lies outside is mirrored first, with its ring; a visible one is not', () => {
    const big: LayerBox = { cx: 320, cy: 180, w: 1920, h: 1080, rotationDeg: 0 };
    const p = edgeProxies({ box: big, ...opts, focused: 'se' });
    expect(p[0]).toMatchObject({ id: 'se', mirror: true, x: 674, y: 394 });
    expect(p.filter((x) => x.id !== 'rotate' && x.id !== 'se')).toEqual([]); // the mirrored scale handle is the scale grip
    // the move handle of a box that covers the viewer has no visible ring: it is mirrored at the centre
    expect(edgeProxies({ box: big, ...opts, focused: 'move' })[0]).toMatchObject({ id: 'move', mirror: true, x: 320, y: 180 });
    // a focused handle that is inside the viewer shows its own ring
    expect(edgeProxies({ box: { cx: 320, cy: 180, w: 640, h: 360, rotationDeg: 0 }, ...opts, focused: 'se' })).toEqual([]);
  });

  it('a viewer too small for a handle, or a box that is not a number, gives no stand-ins', () => {
    expect(edgeProxies({ box: { cx: 0, cy: 0, w: 10, h: 10, rotationDeg: 0 }, view: { left: 0, top: 0, right: 8, bottom: 8 }, margin: 6, gap: 16 })).toEqual([]);
    expect(edgeProxies({ box: { cx: Number.NaN, cy: 0, w: 10, h: 10, rotationDeg: 0 }, ...opts })).toEqual([]);
  });
});

// ---- the timeline of the redesign: lanes, cuts, bars and beats, snapping, the ruler, drags, the splitter ----
const rate = { num: 30, den: 1 };
describe('laneOrder', () => {
  const tr = (id: string, kind: string) => ({ id, kind });
  it('shows titles, captions, the picture stack front-most first (main track last), then sound in list order', () => {
    // the project lists picture tracks bottom-most first: V1, V2, FX1, T1, C1, then sound
    const lanes = laneOrder([tr('v1', 'video'), tr('v2', 'video'), tr('fx', 'adjustment'), tr('t1', 'text'), tr('c1', 'caption'), tr('a1', 'audio'), tr('a2', 'audio'), tr('a3', 'audio'), tr('a4', 'audio')]);
    expect(lanes.map((l) => l.track.id)).toEqual(['t1', 'c1', 'fx', 'v2', 'v1', 'a1', 'a2', 'a3', 'a4']);
    expect(lanes.map((l) => l.role)).toEqual(['t', 'c', 'fx', 'v2', 'v1', 'a1', 'a2', 'a3', 'a3']);
    expect(lanes.map((l) => l.code)).toEqual(['T1', 'C1', 'FX1', 'V2', 'V1', 'A1', 'A2', 'A3', 'A4']);
  });
  it('keeps an adjustment layer where it acts: one moved between two video tracks is shown between them', () => {
    const lanes = laneOrder([tr('v1', 'video'), tr('fx', 'adjustment'), tr('v2', 'video')]);
    expect(lanes.map((l) => l.track.id)).toEqual(['v2', 'fx', 'v1']);
    expect(lanes.find((l) => l.track.id === 'v1')!.role).toBe('v1');
  });
  it('the main track is the bottom-most video track, wherever sound and titles are listed', () => {
    const lanes = laneOrder([tr('a1', 'audio'), tr('t1', 'text'), tr('v1', 'video'), tr('v2', 'video')]);
    expect(lanes.map((l) => `${l.track.id}:${l.role}`)).toEqual(['t1:t', 'v2:v2', 'v1:v1', 'a1:a1']);
  });
  it('an empty project has no lanes', () => { expect(laneOrder([])).toEqual([]); });
});

describe('cutsOf', () => {
  const clip = (id: string, start: number, frames: number) => ({ id, start: T.frameTime(start, rate), duration: T.frameTime(frames, rate) });
  it('finds the clips that touch, in time order, and not the ones with a gap between them', () => {
    const cuts = cutsOf([clip('c', 100, 20), clip('a', 0, 40), clip('b', 40, 30), clip('d', 121, 10)]);
    expect(cuts.map((c) => `${c.before.id}>${c.after.id}@${T.frameIndexAt(c.at, rate)}`)).toEqual(['a>b@40']);
  });
  it('compares exact times: a clip that starts one tick late is not a cut', () => {
    const late = { id: 'b', start: T.add(T.frameTime(40, rate), T.rt(1, 90000)), duration: T.frameTime(10, rate) };
    expect(cutsOf([clip('a', 0, 40), late])).toEqual([]);
  });
});

describe('barGrid', () => {
  // 120 BPM at 30 fps: a beat every 15 frames, four beats in a bar, the first bar starts on the second beat
  const beats = Array.from({ length: 17 }, (_, i) => 10 + i * 15);
  const bars = beats.filter((_, i) => i % 4 === 1);
  const grid = barGrid(beats, bars);
  it('counts the bar and the beat a frame falls in, and says when it is exactly on one', () => {
    expect(grid.at(25)).toEqual({ bar: 1, beat: 1, onBeat: true, onBar: true });
    expect(grid.at(26)).toEqual({ bar: 1, beat: 1, onBeat: false, onBar: false });
    expect(grid.at(40)).toEqual({ bar: 1, beat: 2, onBeat: true, onBar: false });
    expect(grid.at(85)).toEqual({ bar: 2, beat: 1, onBeat: true, onBar: true });
    expect(grid.at(84)).toEqual({ bar: 1, beat: 4, onBeat: false, onBar: false });
  });
  it('makes no claim before the first bar start or past the analysed grid', () => {
    expect(grid.at(10)).toBeNull();
    expect(grid.at(24)).toBeNull();
    expect(grid.at(beats[beats.length - 1]! + 14)).not.toBeNull();
    expect(grid.at(beats[beats.length - 1]! + 16)).toBeNull();
    expect(barGrid(beats, []).at(40)).toBeNull();
  });
  it('finds the nearest beat (the earlier one on a tie)', () => {
    expect(grid.nearestBeat(0)).toBe(10);
    expect(grid.nearestBeat(31)).toBe(25);
    expect(grid.nearestBeat(33)).toBe(40);
    expect(grid.nearestBeat(1000)).toBe(beats[beats.length - 1]);
    expect(barGrid([], []).nearestBeat(5)).toBeNull();
    expect(barGrid([10, 20], []).nearestBeat(15)).toBe(10);
  });
  it('names a length in whole bars or beats only when it is one', () => {
    expect(grid.lengthIn(120)).toEqual({ unit: 'bar', count: 2 });
    expect(grid.lengthIn(60)).toEqual({ unit: 'bar', count: 1 });
    expect(grid.lengthIn(45)).toEqual({ unit: 'beat', count: 3 });
    expect(grid.lengthIn(61)).toEqual({ unit: 'bar', count: 1 }); // within a frame of two bars' worth of beats
    expect(grid.lengthIn(52)).toBeNull();
    expect(grid.lengthIn(4)).toBeNull();
    expect(barGrid(beats, []).lengthIn(120)).toEqual({ unit: 'beat', count: 8 }); // no bar starts known: beats only
    expect(barGrid([10, 25], []).lengthIn(15)).toBeNull(); // too little to measure a beat from
  });
});

describe('snapToTargets and beatSnapTargets', () => {
  const at = (frame: number) => T.frameTime(frame, rate);
  const pps = 90; // 3 px per frame
  it('snaps to the nearest target inside the threshold and names its kind', () => {
    const targets = [{ time: at(100), kind: 'beat' as const }, { time: at(120), kind: 'clip-edge' as const }];
    expect(snapToTargets({ time: at(102), targets, pxPerSecond: pps, thresholdPx: 8 })).toEqual({ time: at(100), kind: 'beat' });
    expect(snapToTargets({ time: at(118), targets, pxPerSecond: pps, thresholdPx: 8 })).toEqual({ time: at(120), kind: 'clip-edge' });
    expect(snapToTargets({ time: at(110), targets, pxPerSecond: pps, thresholdPx: 8 })).toBeNull();
    expect(snapToTargets({ time: at(110), targets: [], pxPerSecond: pps, thresholdPx: 8 })).toBeNull();
  });
  it('at one time, the playhead and a cut name the snap before a bar start, a bar start before a beat, a beat before a marker', () => {
    const here = at(60);
    const kindOf = (kinds: ('playhead' | 'clip-edge' | 'bar' | 'beat' | 'marker' | 'scene')[]) => snapToTargets({ time: at(61), targets: kinds.map((kind) => ({ time: here, kind })), pxPerSecond: pps, thresholdPx: 8 })!.kind;
    expect(kindOf(['beat', 'bar'])).toBe('bar');
    expect(kindOf(['marker', 'beat', 'scene'])).toBe('beat');
    expect(kindOf(['bar', 'clip-edge', 'beat'])).toBe('clip-edge');
    expect(kindOf(['clip-edge', 'playhead'])).toBe('playhead');
  });
  it('a nearer beat wins over a farther cut', () => {
    const r = snapToTargets({ time: at(101), targets: [{ time: at(103), kind: 'clip-edge' }, { time: at(100), kind: 'beat' }], pxPerSecond: pps, thresholdPx: 8 });
    expect(r).toEqual({ time: at(100), kind: 'beat' });
  });
  it('turns analysed beats into frame-aligned targets and tells bar starts from beats', () => {
    const beats = [T.fromSeconds(0.505), T.fromSeconds(1.004), T.fromSeconds(1.504)];
    const targets = beatSnapTargets(beats, [beats[1]!], rate);
    expect(targets.map((t) => t.kind)).toEqual(['beat', 'bar', 'beat']);
    expect(targets.map((t) => T.frameIndexAt(t.time, rate))).toEqual([15, 30, 45]);
    for (const t of targets) expect(T.isFrameAligned(t.time, rate)).toBe(true);
  });
  it('snapping to a beat scales with the zoom: the same 3 frames are inside the threshold at 90 px/s and outside it at 360', () => {
    const targets = [{ time: at(100), kind: 'beat' as const }];
    expect(snapToTargets({ time: at(103), targets, pxPerSecond: 60, thresholdPx: 8 })).not.toBeNull();
    expect(snapToTargets({ time: at(103), targets, pxPerSecond: 360, thresholdPx: 8 })).toBeNull();
  });
});

describe('ruler and trim chip text', () => {
  it('picks the label step from a fixed ladder so labels stay apart', () => {
    expect(rulerStep(90)).toBe(1);
    expect(rulerStep(45)).toBe(2);
    expect(rulerStep(720)).toBe(0.1);
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(0.01)).toBe(600);
  });
  it('writes labels as m:ss, with tenths below a second', () => {
    expect(rulerLabel(0, 1)).toBe('0:00');
    expect(rulerLabel(75, 5)).toBe('1:15');
    expect(rulerLabel(1.5, 0.5)).toBe('0:01.5');
    expect(rulerLabel(0.30000000000000004, 0.1)).toBe('0:00.3');
  });
  it('numbers every bar, or every 2nd, 4th… when they are close together', () => {
    expect(barLabelEvery(90)).toBe(1);
    expect(barLabelEvery(20)).toBe(2);
    expect(barLabelEvery(5)).toBe(8);
  });
  it('writes a signed length with frames', () => {
    expect(signedTimecode(3, rate)).toBe('+0:00.03');
    expect(signedTimecode(-42, rate)).toBe('−0:01.12');
    expect(signedTimecode(0, rate)).toBe('+0:00.00');
    expect(signedTimecode(1830, rate)).toBe('+1:01.00');
  });
});

describe('catalogue drag type', () => {
  it('carries the kind, id and name through a lower-cased type string', () => {
    const item = { kind: 'transition' as const, id: 'light-leak', name: 'דליפת אור' };
    const type = catalogDragType(item);
    expect(type).toBe(type.toLowerCase());
    expect(catalogDragFrom(['text/plain', type])).toEqual(item);
  });
  it('keeps ids with upper case and names with punctuation', () => {
    const item = { kind: 'look' as const, id: 'Warm.Sun_2', name: 'Golden hour; "soft" = 50%' };
    expect(catalogDragFrom([catalogDragType(item).toLowerCase()])).toEqual(item);
  });
  it('is null for other drags and for a malformed type', () => {
    expect(catalogDragFrom(['Files', 'application/x-pulseframe-asset'])).toBeNull();
    expect(catalogDragFrom([`${CATALOG_DRAG_PREFIX}k=sticker;i=6162;n=6162`])).toBeNull();
    expect(catalogDragFrom([`${CATALOG_DRAG_PREFIX}k=effect;i=zz;n=6162`])).toBeNull();
    expect(catalogDragFrom([`${CATALOG_DRAG_PREFIX}k=effect;i=;n=6162`])).toBeNull();
    expect(catalogDragFrom([`${CATALOG_DRAG_PREFIX}k=effect;i=6162;n=ff`])).toEqual({ kind: 'effect', id: 'ab', name: '' }); // a name that is not text is dropped, the item stays
  });
});

describe('splitterHeight', () => {
  const lim = { min: 200, available: 900, keepAbove: 260 };
  it('keeps the timeline between its least height and what the window leaves above it', () => {
    expect(splitterHeight(342.4, lim)).toBe(342);
    expect(splitterHeight(50, lim)).toBe(200);
    expect(splitterHeight(5000, lim)).toBe(640);
  });
  it('a window too small for both keeps the least height', () => { expect(splitterHeight(400, { min: 200, available: 380, keepAbove: 260 })).toBe(200); });
});

describe('cut controls never cover a short clip', () => {
  it('the "+" needs room on both sides; a cut with nothing before it has none', () => {
    expect(cutRoom(14, 14)).toEqual({ add: false, chip: false }); // a beat cut at the whole-edit zoom
    expect(cutRoom(200, 20)).toEqual({ add: false, chip: false });
    expect(cutRoom(40, 300)).toEqual({ add: false, chip: true });
    expect(cutRoom(48, 48)).toEqual({ add: true, chip: true });
    expect(cutRoom(null, 300)).toEqual({ add: false, chip: true });
  });
});

describe('spoken chips: whole words or shortened phrases, never a word cut mid-way', () => {
  const w = (text: string, left: number, width: number) => ({ key: text, left, width, text });
  const px7 = (t: string) => t.length * 7;
  it('word by word when the words fit, dropping a word that does not', () => {
    const words = [w('כשהייתי', 0, 70), w('ילדה', 70, 50), w('קטנה', 120, 50), w('היינו', 170, 30), w('קופצים', 200, 70)];
    const r = pickSpoken(words, [w('כשהייתי ילדה קטנה היינו קופצים', 0, 270)], px7);
    expect(r.mode).toBe('word');
    expect(r.chips.map((c) => c.text)).toEqual(['כשהייתי', 'ילדה', 'קטנה', 'קופצים']);
    for (const c of r.chips) expect(c.width - SPOKEN_CHIP_PAD_PX).toBeGreaterThanOrEqual(px7(c.text));
  });
  it('phrases (with an ellipsis) when most words would be cut; a phrase too short for a letter is left out', () => {
    const words = [w('קופצים', 0, 26), w('המזח', 26, 26), w('הקיץ', 52, 26), w('שלנו', 78, 26)];
    const r = pickSpoken(words, [w('קופצים מהמזח', 0, 52), w('כל הקיץ שלנו', 52, 52), w('כן', 104, 20)], px7);
    expect(r.mode).toBe('phrase');
    expect(r.chips.map((c) => c.text)).toEqual(['קופצים מהמזח', 'כל הקיץ שלנו']);
  });
});

describe('the playhead timecode on the ruler', () => {
  it('is centred on the line, starts at it near the origin, and ends at it on a marker (the flag runs right)', () => {
    expect(capPlacement(300, 60, false)).toBe('centre');
    expect(capPlacement(10, 60, false)).toBe('start');
    expect(capPlacement(300, 60, true)).toBe('end');
    expect(capPlacement(10, 60, true)).toBe('start');
  });
  it('names the ruler labels it covers, so none shows a stray digit', () => {
    const labels = [{ left: 0, width: 30 }, { left: 65, width: 30 }, { left: 130, width: 30 }];
    expect(labelsUnder(labels, 70, 120)).toEqual([1]);
    expect(labelsUnder(labels, 90, 140)).toEqual([1, 2]);
    expect(labelsUnder(labels, 31, 64)).toEqual([]);
  });
});

describe('the timeline in Sound mode', () => {
  it('is never shorter than its lanes (the last sound lane was cut at 1440x900), and leaves the viewer its room', () => {
    expect(TL_USUAL_SOUND).toMatch(/max\(52dvh, var\(--pf-tl-natural/);
    expect(TL_USUAL_SOUND).toMatch(/calc\(100dvh - 260px\)\)$/);
  });
});
