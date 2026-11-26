/**
 * W1 (wave 8 cover): rankStills and rangeOfClip, pure. These are the checks of the contract test's W1 todo rows
 * (stillsContracts.test.ts): the median over every frame, local maxima, the order (sharp desc, motion asc with null last, frame
 * asc), one second apart at the file's own rate, at most three, an incomplete range gives no candidates; manyClipped, the ratio,
 * time = sourceTimeOfFrame; rangeOfClip with speed, reverse and freeze, a 60 fps file in a 30 fps project, over 600 refused.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, sourceTimeOfFrame, StillsRefusal, type MediaClip, type OpCall, type ProjectDocument, type StillMeasure } from './index.ts';
import { rangeOfClip, rankStills, stillsMedian, stillsSeparationFrames } from './stillsRank.ts';

const R30 = { num: 30, den: 1 };
const rec = (frame: number, sharp: number, extra: Partial<StillMeasure> = {}): StillMeasure => ({ frame, sobel: sharp + 10, sigma100: 200, sharp, motion: frame === 0 ? null : 5, hi: 0, lo: 0, ...extra });
const series = (from: number, sharps: number[], extra: (f: number) => Partial<StillMeasure> = () => ({})) => sharps.map((s, i) => rec(from + i, s, extra(from + i)));
const vid = (rate = R30, startTime?: T.RationalTime) => ({ video: { width: 1920, height: 1080, frameRate: rate, codec: 'h264', rotation: 0, frameCount: 1200, ...(startTime ? { startTime } : {}) } });
const refusedCode = (f: () => unknown): string => { try { f(); } catch (e) { expect(e).toBeInstanceOf(StillsRefusal); return (e as StillsRefusal).code; } throw new Error('not refused'); };

describe('rankStills', () => {
  it('an incomplete range gives no median and no candidates', () => {
    const m = series(0, [1, 2, 3, 4]);
    expect(rankStills(vid(), m.filter((x) => x.frame !== 2), 0, 4)).toEqual({ median: null, candidates: [] });
    expect(rankStills(vid(), m, 0, 5)).toEqual({ median: null, candidates: [] });
    expect(rankStills(vid(), m, 2, 2)).toEqual({ median: null, candidates: [] });
  });
  it('the median is over every frame of the range (the lower median), not over the peaks; records outside the range are ignored', () => {
    expect(stillsMedian([5, 1, 9, 3])).toBe(3);
    expect(stillsMedian([5, 1, 9])).toBe(5);
    const m = series(10, [100, 900, 100, 100, 100, 100]);
    const r = rankStills(vid(), [rec(9, 99_999), ...m, rec(16, 99_999)], 10, 16);
    expect(r.median).toBe(100);
    expect(r.candidates.map((c) => [c.frame, c.sharpRatioPermille])).toEqual([[11, 9000]]);
  });
  it('local maxima only; a plateau gives its last frame; the range edges compare their one neighbour inside', () => {
    //            0   1   2   3   4   5   6   7
    const s = [50, 40, 60, 60, 30, 10, 20, 70];
    const r = rankStills(vid({ num: 1, den: 1 }), series(0, s), 0, s.length); // rate 1: separation 1 frame, so every peak can be picked
    expect(r.candidates.map((c) => c.frame)).toEqual([7, 3, 0]);
  });
  it('order: sharp desc, then motion asc (null last), then frame asc; greedy at least ceil(1 s · rate) frames apart; at most 3', () => {
    expect(stillsSeparationFrames(R30)).toBe(30);
    expect(stillsSeparationFrames({ num: 30000, den: 1001 })).toBe(30);
    expect(stillsSeparationFrames({ num: 60, den: 1 })).toBe(60);
    // rate 1 fps, separation 1: equal sharp peaks at 0 (motion null), 2 (motion 9), 4 (motion 3), 6 (motion 3)
    const s = [500, 1, 500, 1, 500, 1, 500, 1];
    const m = series(0, s, (f) => (f === 0 ? { motion: null } : f === 2 ? { motion: 9 } : { motion: 3 }));
    expect(rankStills(vid({ num: 1, den: 1 }), m, 0, 8).candidates.map((c) => c.frame)).toEqual([4, 6, 2]);
    // 30 fps: two peaks 10 frames apart → only the higher; a third 40 frames away is kept
    const t = new Array(90).fill(10);
    t[20] = 300; t[30] = 400; t[70] = 200;
    const r = rankStills(vid(), series(0, t), 0, 90);
    expect(r.candidates.map((c) => c.frame)).toEqual([30, 70]); // 20 is within 30 frames of 30; «נמצאו 2»
  });
  it('manyClipped above 50‰ white; ratio = round(1000·sharp/max(1, median)); time = sourceTimeOfFrame (start offset included)', () => {
    const a = vid(R30, T.rt(1, 10)); // picture starts 3 frames after the file's start
    const m = [rec(0, 0, { hi: 51 }), rec(1, 7, { hi: 51 }), rec(2, 0, { hi: 50 })];
    const r = rankStills(a, m, 0, 3);
    expect(r.median).toBe(0);
    const c = r.candidates[0]!;
    expect([c.frame, c.sharpRatioPermille, c.manyClipped]).toEqual([1, 7000, true]);
    expect(T.eq(c.time, sourceTimeOfFrame(a, 1))).toBe(true);
    expect(T.eq(c.time, T.frameTime(4, R30))).toBe(true);
    const r2 = rankStills(a, [rec(0, 3, { hi: 50 })], 0, 1);
    expect(r2.candidates[0]!.manyClipped).toBe(false);
    expect(r2.candidates[0]).toMatchObject({ sobel: 13, sigma100: 200, motion: null, lo: 0 });
  });
  it('the same records give the same ranking (pure, deterministic)', () => {
    const t = Array.from({ length: 200 }, (_, i) => (i * 7919) % 211);
    const a = rankStills(vid(), series(0, t), 0, 200), b = rankStills(vid(), series(0, t).reverse(), 0, 200);
    expect(a).toEqual(b);
  });
});

let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `st${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
function project(fileRate = R30, frames = 1200) {
  const video = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'d'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, fileRate), video: { width: 1920, height: 1080, frameRate: fileRate, codec: 'h264', rotation: 0, frameCount: frames }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
  const image = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'e'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.rt(5, 1), image: { width: 100, height: 100, codec: 'png', hasAlpha: false }, provenance: prov };
  let r = tx(createProject({ id: 'prj_r', name: 'R', frameRate: R30 }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: image } }], true);
  const assetId = r.results[0]!.output!.assetId as string, imageId = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: T.ZERO, duration: T.frameTime(60, R30), sourceIn: T.rt(10, 1) } }, { op: 'add_clip', args: { assetId: imageId, start: T.frameTime(300, R30) } }]);
  return { doc: r.doc, assetId, clipId: r.results[0]!.output!.clipId as string, imageClip: r.results[1]!.output!.clipId as string };
}
const withClip = (doc: ProjectDocument, clipId: string, patch: Partial<MediaClip>): ProjectDocument => {
  const d = structuredClone(doc);
  Object.assign(findClip(d, clipId)!.clip, patch);
  return d;
};

describe('rangeOfClip', () => {
  it('a plain clip: the source frames shown at its first and last project frame, half-open', () => {
    const { doc, assetId, clipId } = project();
    expect(rangeOfClip(doc, clipId)).toEqual({ assetId, from: 300, to: 360 });
  });
  it('a 60 fps file in a 30 fps project counts every source frame (not every other)', () => {
    const { doc, clipId } = project({ num: 60, den: 1 }, 2400);
    // 60 project frames = 2 s; first shows source frame 600, last (59/30 s later) 600 + 118
    expect(rangeOfClip(doc, clipId)).toMatchObject({ from: 600, to: 719 });
  });
  it('speed 2 and speed ½: the stretch the clip plays', () => {
    const { doc, clipId } = project();
    expect(rangeOfClip(withClip(doc, clipId, { speed: { num: 2, den: 1 } }), clipId)).toMatchObject({ from: 300, to: 419 });
    expect(rangeOfClip(withClip(doc, clipId, { speed: { num: 1, den: 2 } }), clipId)).toMatchObject({ from: 300, to: 330 });
  });
  it('reverse: the same frames, whichever way they play; freeze: one frame', () => {
    const { doc, clipId } = project();
    expect(rangeOfClip(withClip(doc, clipId, { reverse: true }), clipId)).toMatchObject({ from: 300, to: 360 });
    expect(rangeOfClip(withClip(doc, clipId, { freeze: true }), clipId)).toMatchObject({ from: 300, to: 301 });
  });
  it('a speed ramp: the ends come from speed.ts (the evaluator\'s rule)', () => {
    const { doc, clipId } = project();
    const ramp = rangeOfClip(withClip(doc, clipId, { speed: { num: 1, den: 1 }, speedEnd: { num: 3, den: 1 } }), clipId);
    expect(ramp.from).toBe(300);
    expect(ramp.to).toBeGreaterThan(360);
    expect(ramp.to).toBeLessThan(300 + 2 * 60);
  });
  it('over 600 frames is stills_range_too_long; an unknown clip, a picture-file clip and a sound-only placement are incompatible', () => {
    const { doc, clipId, imageClip } = project();
    const long = withClip(doc, clipId, { duration: T.frameTime(601, R30) });
    expect(refusedCode(() => rangeOfClip(long, clipId))).toBe('stills_range_too_long');
    expect(rangeOfClip(withClip(doc, clipId, { duration: T.frameTime(600, R30) }), clipId)).toMatchObject({ from: 300, to: 900 });
    expect(refusedCode(() => rangeOfClip(doc, 'clip_none'))).toBe('incompatible');
    expect(refusedCode(() => rangeOfClip(doc, imageClip))).toBe('incompatible');
    const linked = Object.values(doc.sequences)[0]!.tracks.find((t) => t.kind === 'audio')?.clips[0];
    if (linked) expect(refusedCode(() => rangeOfClip(doc, linked.id))).toBe('incompatible');
  });
});
