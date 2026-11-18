/**
 * Multicam maths and queries (ADR-0020 W1; multicam.ts): exact sync maps, the one rounding of a switch, coverage, the picture
 * and sound plans with their drift through-edits, looks, and the never-saved angle-viewer document.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  frac, fracCmp, fracSub, fromGroupExact, groupTimeAt, isPlaced, lookOfClip, masterGroupTimeAt, multiviewDocument, pieceCoverage, planPicture, planSound, quantise, remapSource,
  segmentSyncOffset, syncGrid, taggedSegment, timelineAtGroupTime, toGroupExact, validateProject, type Frac, type MediaClip, type MulticamPiece, type SyncAnchor,
} from './index.ts';
import { NTSC, podcast, R30, samples, tx } from './multicam.testFixture.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const quality = { verdict: 'manual' as const, peakZ: null, peakRatio: null, anchorsUsed: 0, anchorsRejected: 0, residualSamples: null, driftPpm: null, overlapSeconds: null, candidates: [], chainDepth: 0, jobId: null };
const piece = (anchors: SyncAnchor[]): MulticamPiece => ({ assetId: 'ast_x', anchors, quality });
const absDiff = (a: Frac, b: Frac) => { const d = fracSub(a, b); return d.n < 0n ? { n: -d.n, d: d.d } : d; };
/** Monotone anchors with |slope − 1| ≤ ppm per piece, sample-aligned at sr. */
function driftAnchors(rnd: () => number, count: number, ppm: number, sr = 48000): SyncAnchor[] {
  const out: SyncAnchor[] = [];
  let g = Math.floor((rnd() - 0.5) * 10 * sr), s = Math.floor(rnd() * 5 * sr);
  for (let i = 0; i < count; i++) {
    out.push({ group: samples(g, sr), source: samples(s, sr) });
    const dg = Math.floor((30 + rnd() * 300) * sr);
    const ds = Math.round(dg * (1 + ((rnd() * 2 - 1) * ppm) / 1e6));
    g += dg; s += ds;
  }
  return out;
}

describe('map maths', () => {
  it('syncGrid(48000, 30000/1001) = 240000', () => {
    expect(syncGrid(48000, NTSC)).toBe(240000);
    expect(syncGrid(48000, R30)).toBe(48000);
  });
  it('10,000 seeded sourceIns at 30000/1001 fps and 48 kHz with offset-only maps: A→B→A is T.eq-exact', () => {
    const rnd = mulberry32(7), grid = syncGrid(48000, NTSC);
    for (let i = 0; i < 10_000; i++) {
      const A = piece([{ group: samples(Math.floor((rnd() - 0.5) * 48000 * 60)), source: T.ZERO }]);
      const B = piece([{ group: samples(Math.floor((rnd() - 0.5) * 48000 * 60)), source: samples(Math.floor(rnd() * 48000 * 5)) }]);
      // a frame boundary, a sample, or any tick of the composed grid
      const k = Math.floor(rnd() * 3);
      const s = k === 0 ? T.frameTime(Math.floor(rnd() * 100_000), NTSC) : k === 1 ? samples(Math.floor(rnd() * 48000 * 3600)) : T.rt(Math.floor(rnd() * grid * 3600), grid);
      const there = remapSource(A, B, s, grid);
      expect(T.eq(remapSource(B, A, there, grid), s)).toBe(true);
    }
  });
  it('±200 ppm maps with 1–6 anchors: the round trip is within 1 grid tick, and the maps are monotone', () => {
    const rnd = mulberry32(11), grid = syncGrid(48000, NTSC), tick: Frac = { n: 1n, d: BigInt(grid) };
    for (let trial = 0; trial < 300; trial++) {
      const A = piece(driftAnchors(rnd, 1 + Math.floor(rnd() * 6), 200)), B = piece(driftAnchors(rnd, 1 + Math.floor(rnd() * 6), 200));
      let prev: Frac | null = null;
      const pts = Array.from({ length: 20 }, () => T.rt(Math.floor(rnd() * grid * 1800), grid)).sort(T.cmp);
      for (const s of pts) {
        const back = remapSource(B, A, remapSource(A, B, s, grid), grid);
        expect(fracCmp(absDiff(frac(back), frac(s)), tick) <= 0).toBe(true);
        const g = toGroupExact(A, s);
        if (prev) expect(fracCmp(prev, g) <= 0).toBe(true);
        prev = g;
        expect(fracCmp(fromGroupExact(A, g), frac(s))).toBe(0); // exact inverse
      }
    }
  });
  it('no RangeError on a 4-hour file at 192 kHz', () => {
    const sr = 192000, grid = syncGrid(sr, NTSC), rnd = mulberry32(3);
    const A = piece(driftAnchors(rnd, 6, 200, sr)), B = piece(driftAnchors(rnd, 6, 200, sr));
    const fourHours = T.rt(4 * 3600, 1);
    expect(() => {
      for (let i = 0; i <= 100; i++) remapSource(A, B, T.rt(Math.floor((i / 100) * 4 * 3600 * grid), grid), grid);
      pieceCoverage(A, fourHours, grid);
      quantise(toGroupExact(B, fourHours), grid);
    }).not.toThrow();
  });
  it('for every anchor, fromGroup(group) equals its source exactly (and toGroup the other way)', () => {
    const rnd = mulberry32(5);
    for (let t = 0; t < 50; t++) {
      const p = piece(driftAnchors(rnd, 1 + Math.floor(rnd() * 6), 1000));
      for (const k of p.anchors) { expect(fracCmp(fromGroupExact(p, k.group), frac(k.source))).toBe(0); expect(fracCmp(toGroupExact(p, k.source), frac(k.group))).toBe(0); }
    }
  });
  it('quantise rounds half up and is the identity on the grid; an unplaced piece has no coverage and no map', () => {
    expect(T.eq(quantise({ n: 1n, d: 96000n }, 48000), samples(1))).toBe(true); // exactly half a tick: up
    expect(T.eq(quantise({ n: -1n, d: 96000n }, 48000), T.ZERO)).toBe(true); // −½ tick rounds up to 0
    expect(T.eq(quantise(samples(12345), 48000), samples(12345))).toBe(true);
    const u = piece([]);
    expect(isPlaced(u)).toBe(false);
    expect(pieceCoverage(u, T.rt(10, 1), 48000)).toBeNull();
    expect(() => toGroupExact(u, T.ZERO)).toThrow(RangeError);
  });
});

describe('group-time queries on a placed program', () => {
  const p = podcast();
  const placed = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA, range: { from: T.rt(10, 1), to: T.rt(500, 1) } } }]);
  const out = placed.results[0]!.output as { sequenceId: string; videoTrackId: string; soundTrackIds: string[]; createdClipIds: string[] };
  const d = placed.doc;
  it('the picture and the master sound show the same group time; timelineAtGroupTime is the inverse on the frame grid', () => {
    for (const sec of [3, 17.5, 200, 480]) {
      const t = T.frameTime(Math.round(sec * 30), R30);
      const pic = groupTimeAt(d, out.sequenceId, out.videoTrackId, t)!;
      const master = masterGroupTimeAt(d, out.sequenceId, p.groupId, t)!;
      expect(T.eq(pic.g, master)).toBe(true);
      expect(T.eq(timelineAtGroupTime(d, out.sequenceId, out.videoTrackId, p.groupId, pic.g)!, t)).toBe(true);
    }
    // a group time the camera never filmed: nowhere on the program
    expect(timelineAtGroupTime(d, out.sequenceId, out.videoTrackId, p.groupId, T.rt(-50, 1))).toBeNull();
  });
  it('taggedSegment names group, angle and file; segmentSyncOffset is 0 in sync and says how far a slip moved it', () => {
    const clipId = out.createdClipIds[0]!;
    const seg = taggedSegment(d, clipId)!;
    expect([seg.group.id, seg.angle.id, seg.pieceIndex, seg.track.id]).toEqual([p.groupId, p.camA, 0, out.videoTrackId]);
    const zero = segmentSyncOffset(d, clipId)!;
    expect([zero.startSeconds, zero.endSeconds]).toEqual([0, 0]);
    expect(T.isZero(zero.slipBy)).toBe(true);
    const slipped = tx(d, [{ op: 'slip_clip', args: { clipId, by: T.frameTime(3, R30) } }]).doc;
    const off = segmentSyncOffset(slipped, clipId)!;
    expect(off.startFrames).toBeCloseTo(-3, 9); // the picture now shows 3 frames later: it is early
    expect(T.eq(off.slipBy, T.frameTime(-3, R30))).toBe(true);
    // the slip it proposes puts it back
    expect(segmentSyncOffset(tx(slipped, [{ op: 'slip_clip', args: { clipId, by: off.slipBy } }]).doc, clipId)!.startSeconds).toBe(0);
    expect(segmentSyncOffset(d, out.createdClipIds.at(-1)!)).toBeNull(); // a sound clip is not a picture segment
  });
});

describe('drift', () => {
  it('100 ppm over 600 s at 30 fps with tol 0.5 frame gives exactly ⌈600·1e-4/(0.5/30)⌉ = 4 picture parts, each re-anchored within 1 tick', () => {
    const fast = [{ group: T.ZERO, source: T.ZERO }, { group: samples(28_800_000), source: samples(28_797_120) }]; // the file's clock runs 100 ppm slow
    const p = podcast({ anchorsA: fast, seconds: 700 });
    const g = p.doc.multicam![p.groupId]!, grid = syncGrid(48000, R30);
    const plan = planPicture(p.doc, g, { angleId: p.camA, at: T.ZERO, g0: T.ZERO, duration: T.rt(600, 1), fill: false, driftToleranceFrames: 0.5 });
    expect(plan.segments.length).toBe(Math.ceil((600 * 1e-4) / (0.5 / 30)));
    expect(plan.segments.map((s) => s.reason)).toEqual(['angle', 'drift', 'drift', 'drift']);
    const piece = g.angles.find((a) => a.id === p.camA)!.pieces[0]!;
    const tick: Frac = { n: 1n, d: BigInt(grid) };
    let at = T.ZERO;
    for (const s of plan.segments) {
      expect(T.eq(s.start, at)).toBe(true); // contiguous, frame-aligned
      expect(T.isFrameAligned(s.duration, R30)).toBe(true);
      expect(fracCmp(absDiff(frac(s.sourceIn), fromGroupExact(piece, s.start)), tick) <= 0).toBe(true);
      // every frame start of the part is within half a frame of where the map puts it
      const last = T.sub(T.add(s.start, s.duration), T.frameTime(1, R30));
      const err = absDiff(fromGroupExact(piece, last), frac(T.add(s.sourceIn, T.sub(last, s.start))));
      expect(fracCmp(err, { n: 1n, d: 60n }) <= 0).toBe(true);
      at = T.add(s.start, s.duration);
    }
    expect(T.eq(at, T.rt(600, 1))).toBe(true);
  });
  it('a 50 ppm sound over 600 s gives chunks whose exact maximum error is ≤ 0.5 ms; every chunk is frame-aligned and overlaps the next by 1 frame', () => {
    const { doc, ids } = (() => { const pc = podcast({ seconds: 650 }); return { doc: pc.doc, ids: pc }; })();
    // a second recorder (the camera B file stands in: its sound) drifting 50 ppm
    const drifting = [{ group: T.ZERO, source: T.ZERO }, { group: samples(28_800_000), source: samples(28_801_440) }];
    const d = tx(doc, [{ op: 'set_multicam_sync', args: { groupId: ids.groupId, angleId: ids.camB, pieceIndex: 0, anchors: drifting } }]).doc;
    const g = d.multicam![ids.groupId]!, piece = g.angles.find((a) => a.id === ids.camB)!.pieces[0]!;
    const plan = planSound(d, g, { angleId: ids.camB, at: T.ZERO, g0: T.ZERO, duration: T.rt(600, 1) });
    expect(plan.clips.length).toBeGreaterThan(50);
    expect(plan.chunks).toBe(plan.clips.length);
    expect(plan.maxErrorSeconds).toBeLessThanOrEqual(0.0005);
    const fl = T.frameTime(1, R30), half: Frac = { n: 1n, d: 2000n };
    plan.clips.forEach((c, i) => {
      expect(T.isFrameAligned(c.start, R30) && T.isFrameAligned(c.duration, R30)).toBe(true);
      expect(T.lte(c.duration, T.rt(60, 1))).toBe(true);
      // the exact error at both ends of the chunk (it is linear in between: one anchor pair)
      for (const off of [T.ZERO, c.duration]) {
        const g0 = T.add(c.start, off);
        expect(fracCmp(absDiff(fromGroupExact(piece, g0), frac(T.add(c.sourceIn, off))), half) <= 0).toBe(true);
      }
      const next = plan.clips[i + 1];
      if (next) { expect(T.eq(next.start, T.sub(T.add(c.start, c.duration), fl))).toBe(true); expect(T.eq(c.fadeOut!, fl) && T.eq(next.fadeIn!, fl)).toBe(true); }
    });
    expect(plan.clips[0]!.fadeIn).toBeUndefined();
    expect(plan.clips.at(-1)!.fadeOut).toBeUndefined();
    expect(T.eq(T.add(plan.clips.at(-1)!.start, plan.clips.at(-1)!.duration), T.rt(600, 1))).toBe(true);
  });
  it('a sound within 1 ms over the range is one clip', () => {
    const p = podcast();
    const g = p.doc.multicam![p.groupId]!;
    const plan = planSound(p.doc, g, { angleId: p.mic, at: T.ZERO, g0: T.ZERO, duration: T.rt(600, 1) });
    expect([plan.clips.length, plan.chunks, plan.maxErrorSeconds]).toEqual([1, 0, 0]);
  });
});

describe('planPicture coverage and fill', () => {
  it('stretches the angle does not cover are filled from another synced camera (reported), and the rest is uncovered', () => {
    const p = podcast();
    const g = p.doc.multicam![p.groupId]!;
    // camera A starts at 1.2 s, camera B at 2.5 s: from group 0, A misses 1.2 s; with fill, nothing else covers it either
    const plan = planPicture(p.doc, g, { angleId: p.camB, at: T.ZERO, g0: T.ZERO, duration: T.rt(10, 1), fill: true, driftToleranceFrames: 0.5 });
    expect(plan.segments.map((s) => [s.angleId, s.reason, T.toSeconds(s.start)])).toEqual([[p.camA, 'fill', 1.2], [p.camB, 'angle', 2.5]]);
    expect(plan.uncovered.map((u) => [T.toSeconds(u.start), T.toSeconds(u.end)])).toEqual([[0, 1.2]]);
    const noFill = planPicture(p.doc, g, { angleId: p.camB, at: T.ZERO, g0: T.ZERO, duration: T.rt(10, 1), fill: false, driftToleranceFrames: 0.5 });
    expect(noFill.segments.map((s) => s.angleId)).toEqual([p.camB]);
    expect(noFill.uncovered.map((u) => T.toSeconds(u.end))).toEqual([2.5]);
  });
});

describe('looks and the angle viewer', () => {
  it('lookOfClip keeps the framing and non-time effects (keys stripped, reported), collects per-format framing, and the privacy regions and follow', () => {
    const p = podcast();
    let r = tx(p.doc, [{ op: 'place_multicam', args: { groupId: p.groupId, at: T.ZERO, angleId: p.camA } }]);
    const clipId = (r.results[0]!.output as { createdClipIds: string[] }).createdClipIds[0]!;
    r = tx(r.doc, [
      { op: 'set_clip_transform', args: { clipId, transform: { scale: 1.4, x: 0.1 } } },
      { op: 'add_effect', args: { clipId, type: 'blur.gaussian' } },
      { op: 'add_effect', args: { clipId, type: 'time.echo' } },
      { op: 'set_keyframe', args: { clipId, property: 'scale', time: T.ZERO, value: 1.2 } },
      { op: 'add_variant', args: { profileId: 'vertical-9x16' } },
    ]);
    const variantId = r.results[4]!.output!.variantId as string;
    r = tx(r.doc, [{ op: 'set_variant_override', args: { variantId, clipId, transform: { x: -0.2 } } }]);
    const clip = taggedSegment(r.doc, clipId)!.clip as MediaClip;
    const { look, dropped } = lookOfClip(r.doc, clip);
    expect([look.transform.scale, look.transform.x]).toEqual([1.4, 0.1]);
    expect(look.effects!.map((e) => e.type)).toEqual(['blur.gaussian']);
    expect(look.variantTransforms).toEqual({ [variantId]: { x: -0.2 } });
    expect(dropped).toEqual(['keyframes']);
  });
  it('multiviewDocument: a valid grid of the live angles, one video track per file, cells and labels, no sound; frame 0 shows g0', () => {
    const p = podcast();
    const g0 = T.rt(30, 1);
    const mv = multiviewDocument(p.doc, p.groupId, { liveAngleIds: [p.camA, p.camB, p.mic], g0, duration: T.rt(20, 1), width: 640, height: 360 });
    expect(validateProject(mv)).toEqual([]);
    const tracks = mv.sequences[mv.mainSequenceId]!.tracks;
    expect(tracks.filter((t) => t.kind === 'video').length).toBe(2); // the sound angle has no tile
    expect(tracks.some((t) => t.kind === 'audio')).toBe(false);
    const labels = tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips);
    expect(labels.map((c) => (c.type === 'text' ? c.text : ''))).toEqual(['מצלמה 1', 'מצלמה 2']);
    const g = p.doc.multicam![p.groupId]!;
    const first = tracks[0]!.clips[0] as MediaClip;
    expect(T.eq(first.sourceIn, quantise(fromGroupExact(g.angles[1]!.pieces[0]!, g0), 48000))).toBe(true);
    expect(first.transform.x).toBeLessThan(0); // the left cell (side by side), cropped to it
    expect(first.mask!.width).toBeLessThan(1);
    expect([mv.settings.width, mv.settings.height]).toEqual([640, 360]);
  });
});
