/**
 * Motion tracking UI arithmetic (ADR-0015): the pick round trip on the monitor, the follow offset that attaches a clip without
 * a jump, progress from the job's stage, and finding a source frame on the timeline.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, placed, sourceFrameIndexAt, sourceToFrame, TRACK_UNIT, type Fit, type MediaClip, type OpCall, type ProjectDocument } from '@pulseframe/core';
import {
  boxToTrackUnits, followCentre, followFactor, followPointFromZero, frameToLayerSource, keepOffset, ownFromResolved, pickToSource, screenToFrame, sourceToScreen, timelineFrameOfSource,
  toTrackUnits, trackingProgress, trackUnitsToFrame, type FrameBox, type LayerPlacement,
} from './tracking.math.ts';

/** Seeded generator (mulberry32), so a failure can be replayed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FRAMES: [number, number][] = [[1920, 1080], [1280, 720], [1080, 1920], [720, 1280]];
const SOURCES: [number, number][] = [[1920, 1080], [1280, 720], [640, 360], [1080, 1920], [720, 720], [4032, 3024]];
function placement(r: () => number, i: number): { frame: FrameBox; layer: LayerPlacement; rectW: number } {
  const [W, H] = FRAMES[i % FRAMES.length]!;
  const [srcW, srcH] = SOURCES[Math.floor(r() * SOURCES.length)]!;
  const fit: Fit = i % 2 ? 'cover' : 'contain';
  const transform = { x: (r() - 0.5) * 1.2, y: (r() - 0.5) * 1.2, scale: 0.1 + r() * 4.9, rotation: (r() - 0.5) * 360 };
  return { frame: { W, H, fit }, layer: { srcW, srcH, transform }, rectW: 200 + r() * 1400 };
}

describe('picking on the monitor', () => {
  it('screen → source → screen comes back within 1e-6 px over 1,000 seeded placements (contain and cover, rotation ±180°, scale 0.1–5, 16:9 and 9:16 frames)', () => {
    const r = rng(20261117);
    let worst = 0, inside = 0;
    for (let i = 0; i < 1000; i++) {
      const p = placement(r, i);
      const rectH = (p.rectW * p.frame.H) / p.frame.W;
      const sx = r() * p.rectW, sy = r() * rectH;
      const { px, py } = screenToFrame(sx, sy, p.rectW, p.frame.W);
      const s = frameToLayerSource(p.frame, p.layer, px, py);
      const back = sourceToScreen({ u: s.u, v: s.v, rectW: p.rectW, frame: p.frame, layer: p.layer });
      worst = Math.max(worst, Math.hypot(back.sx - sx, back.sy - sy));
      const pick = pickToSource({ sx, sy, rectW: p.rectW, frame: p.frame, layer: p.layer });
      const on = s.u >= 0 && s.u <= 1 && s.v >= 0 && s.v <= 1;
      expect(pick === null).toBe(!on); // a pick off the picture is refused
      if (pick) { inside++; expect(pick.u).toBeCloseTo(s.u, 12); expect(pick.v).toBeCloseTo(s.v, 12); }
    }
    expect(worst).toBeLessThan(1e-6);
    expect(inside).toBeGreaterThan(100); // the sample covers picks on the picture, not only refusals
  });

  it('a source point lands where the canvas draws it: translate to the centre, turn clockwise, scale (written out here, not through core geometry)', () => {
    const r = rng(7);
    for (let i = 0; i < 300; i++) {
      const p = placement(r, i);
      const u = r(), v = r();
      const { W, H, fit } = p.frame, { srcW, srcH, transform: t } = p.layer;
      const f = fit === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
      const lx = (u - 0.5) * srcW * f * t.scale, ly = (v - 0.5) * srcH * f * t.scale;
      const a = (t.rotation * Math.PI) / 180;
      const k = p.rectW / W;
      const want = { sx: (W / 2 + t.x * W + Math.cos(a) * lx - Math.sin(a) * ly) * k, sy: (H / 2 + t.y * H + Math.sin(a) * lx + Math.cos(a) * ly) * k };
      const got = sourceToScreen({ u, v, rectW: p.rectW, frame: p.frame, layer: p.layer });
      expect(Math.hypot(got.sx - want.sx, got.sy - want.sy)).toBeLessThan(1e-6);
    }
  });

  it('track units are rounded and clamped; a box keeps its size along the picture\'s own axes and is refused off the picture', () => {
    expect(toTrackUnits(0.5, 0.25)).toEqual({ x: 5000, y: 2500 });
    expect(toTrackUnits(-0.1, 1.3)).toEqual({ x: 0, y: TRACK_UNIT });
    const frame: FrameBox = { W: 1280, H: 720, fit: 'contain' };
    const layer: LayerPlacement = { srcW: 1920, srcH: 1080, transform: { x: 0, y: 0, scale: 1, rotation: 0 } };
    // the 1920×1080 picture fills the 1280×720 frame: a 128×72 box in the middle is a tenth of each side
    expect(boxToTrackUnits(frame, layer, { px: 640, py: 360, w: 128, h: 72 })).toEqual({ x: 5000, y: 5000, w: 1000, h: 1000 });
    // the same picture shown at half size: the same box covers twice as much of it
    expect(boxToTrackUnits(frame, { ...layer, transform: { ...layer.transform, scale: 0.5 } }, { px: 640, py: 360, w: 128, h: 72 })).toEqual({ x: 5000, y: 5000, w: 2000, h: 2000 });
    expect(boxToTrackUnits(frame, layer, { px: 640, py: 360, w: 0, h: 1 })).toMatchObject({ w: 10, h: 14 }); // never below the least box
    expect(boxToTrackUnits(frame, { ...layer, transform: { ...layer.transform, x: 0.6 } }, { px: 10, py: 360, w: 50, h: 50 })).toBeNull();
    const at = trackUnitsToFrame(frame, layer, 2500, 7500);
    expect(at.px).toBeCloseTo(320, 9);
    expect(at.py).toBeCloseTo(540, 9);
  });
});

describe('attaching a follow without a jump', () => {
  /** The resolver of engine follow.ts, written out on its own here: x = (P.x + own.x·W·m − W/2)/W, y likewise. */
  const resolve = (P: { px: number; py: number }, own: { x: number; y: number }, m: number, W: number, H: number) => ({ x: (P.px + own.x * W * m - W / 2) / W, y: (P.py + own.y * H * m - H / 2) / H });

  it('keepOffset leaves the resolved centre where the clip was, within 1e-9, over 1,000 seeded placements and samples', () => {
    const r = rng(99);
    let worst = 0;
    for (let i = 0; i < 1000; i++) {
      const p = placement(r, i);
      const { W, H } = p.frame;
      // the tracked point: a sample of the target picture placed by core geometry, as the resolver places it
      const P = sourceToFrame(placed(W, H, p.frame.fit, p.layer.srcW, p.layer.srcH, p.layer.transform), r(), r());
      const m = i % 3 === 0 ? 1 : 0.2 + r() * 2.8;
      const cur = { x: (r() - 0.5) * 1.6, y: (r() - 0.5) * 1.6 };
      const off = keepOffset({ cur, P, m, W, H });
      const after = resolve(P, off, m, W, H);
      worst = Math.max(worst, Math.abs(after.x - cur.x), Math.abs(after.y - cur.y));
      // followCentre is the same resolver
      const fc = followCentre({ P, own: off, m, W, H });
      expect(Math.abs(fc.x - after.x) + Math.abs(fc.y - after.y)).toBeLessThan(1e-12);
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('P read back from a follower resolved at offset zero gives the same offset as P itself', () => {
    const W = 1080, H = 1920, P = { px: 311.25, py: 1402.5 }, m = 1.7;
    const zero = resolve(P, { x: 0, y: 0 }, m, W, H);
    const P2 = followPointFromZero(zero, W, H);
    expect(P2.px).toBeCloseTo(P.px, 9);
    expect(P2.py).toBeCloseTo(P.py, 9);
    const cur = { x: 0.1, y: -0.2 };
    const a = keepOffset({ cur, P, m, W, H }), b = keepOffset({ cur, P: P2, m, W, H });
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
  });

  it('a move on the monitor moves the offset by Δ/m; a resolved scale s is an own scale of s/m; m comes from the scales', () => {
    const own = { x: 0.1, y: -0.05, scale: 0.5 };
    const m = followFactor(1.5, own.scale);
    expect(m).toBe(3);
    const before = { x: 0.3, y: 0.2, scale: 1.5 };
    const out = ownFromResolved(own, before, { x: 0.36, y: 0.14 }, m);
    expect(out.x).toBeCloseTo(0.12, 12);
    expect(out.y).toBeCloseTo(-0.07, 12);
    expect(out.scale).toBeUndefined();
    expect(ownFromResolved(own, before, { scale: 3 }, m)).toEqual({ scale: 1 });
    // the resolved position after the move is exactly where the pointer took it
    const P = { px: 500, py: 300 }, W = 1000, H = 600;
    const own2 = keepOffset({ cur: before, P, m, W, H });
    const moved = ownFromResolved({ ...own2, scale: 0.5 }, before, { x: 0.36, y: 0.14 }, m);
    const at = resolve(P, { x: moved.x!, y: moved.y! }, m, W, H);
    expect(at.x).toBeCloseTo(0.36, 12);
    expect(at.y).toBeCloseTo(0.14, 12);
    expect(followFactor(1, 0)).toBe(1);
  });
});

describe('tracking progress from the stage', () => {
  it('reads the counted passes; reading is indeterminate; saving is complete', () => {
    expect(trackingProgress(null)).toEqual({ phase: null, done: 0, total: 0, percent: null });
    expect(trackingProgress('reading frames').percent).toBeNull();
    expect(trackingProgress('tracking forward 60/240')).toEqual({ phase: 'forward', done: 60, total: 240, percent: 13 });
    expect(trackingProgress('tracking backward 30/60').percent).toBe(75);
    expect(trackingProgress('tracking forward 30/60', 'forward').percent).toBe(50);
    expect(trackingProgress('tracking forward 0/0').percent).toBe(0);
    expect(trackingProgress('saving track').percent).toBe(100);
    expect(trackingProgress('preparing').phase).toBeNull();
  });
});

describe('source frames on the timeline', () => {
  const R = { num: 30, den: 1 };
  const f = (n: number) => T.frameTime(n, R);
  const asset = {
    kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
    video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 },
    provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
  };
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `t${n++}_`, actor: 'test', allowInternal });
  const base = () => {
    const r = tx(createProject({ id: 'prj_t', name: 'T' }), [{ op: 'import_asset', args: { asset } }], true);
    const assetId = r.results[0]!.output!.assetId as string;
    return { doc: r.doc, assetId };
  };
  const clipsOf = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips) as MediaClip[];

  it('finds the first timeline frame that shows a source frame, at speed 2 and reversed; null when no clip shows it', () => {
    const { doc, assetId } = base();
    // the whole file at speed 2 from timeline frame 30 (120 frames long): source frame s is shown at 30 + s/2
    let d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(30), duration: f(240), withLinkedAudio: false } }]).doc;
    const id = clipsOf(d)[0]!.id;
    d = tx(d, [{ op: 'set_clip_speed', args: { clipId: id, speed: 2 } }]).doc;
    expect(timelineFrameOfSource(d, assetId, 100)).toEqual({ frame: 80, clipId: id });
    expect(timelineFrameOfSource(d, assetId, 101)).toBeNull(); // odd frames are skipped at speed 2
    expect(timelineFrameOfSource(d, assetId, 101, 103)).toEqual({ frame: 81, clipId: id });
    // reversed: the last source frame comes first
    const r2 = tx(d, [{ op: 'set_clip_reverse', args: { clipId: id, reverse: true } }]).doc;
    const c2 = clipsOf(r2)[0]!;
    const got = timelineFrameOfSource(r2, assetId, 200)!;
    expect(sourceFrameIndexAt({ ...asset, video: asset.video }, c2, f(got.frame), R)).toBe(200);
    for (let k = T.frameIndexAt(c2.start, R); k < got.frame; k++) expect(sourceFrameIndexAt({ ...asset, video: asset.video }, c2, f(k), R)).not.toBe(200);
    expect(timelineFrameOfSource(d, 'missing', 0)).toBeNull();
  });
});
