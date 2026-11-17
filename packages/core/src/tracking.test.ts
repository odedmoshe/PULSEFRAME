/**
 * Motion track samples (ADR-0015): the sample functions of tracking.ts, the caps, and hand edits through edit_motion_track.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, DEFAULT_REDACT_REGION, lossFlags, lossHalfWidth, MAX_PROJECT_TRACK_SAMPLES, MAX_TRACK_SAMPLES, OpError, regionGeometry, ST, trackSampleAt, trackSummary,
  type MotionTrack, type OpCall, type ProjectDocument, type RedactRegion,
} from './index.ts';

const R = { num: 30, den: 1 };
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `t${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const videoAsset = (frames: number) => ({ kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${String(frames % 10).repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R), video: { width: 1280, height: 720, frameRate: R, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov });
function project(frames = 240) {
  const r = tx(createProject({ id: 'prj_s', name: 'S', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: videoAsset(frames) } }], true);
  return { doc: r.doc, assetId: r.results[0]!.output!.assetId as string };
}
const create = (doc: ProjectDocument, args: Record<string, unknown>) => { const r = tx(doc, [{ op: 'create_motion_track', args }]); return { doc: r.doc, id: r.results[0]!.output!.motionTrackId as string }; };
const attach = (doc: ProjectDocument, motionTrackId: string, from: number, cols: { x: number[]; y: number[]; s?: number[]; q: number[]; st: number[] }) =>
  tx(doc, [{ op: 'attach_motion_track', args: { motionTrackId, from, ...cols, method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z' } }], true).doc;
const refusal = (fn: () => unknown): OpError => { try { fn(); } catch (e) { if (e instanceof OpError) return e; throw e; } throw new Error('not refused'); };
function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** A hand-built track (the functions under test never look at the document). */
const track = (from: number, st: number[], extra: Partial<MotionTrack> = {}): MotionTrack => ({
  id: 'mtk_x', assetId: 'ast_x', name: 'x', kind: 'point', from, x: st.map((_, i) => 1000 + i * 10), y: st.map((_, i) => 2000 - i), q: st.map(() => 80), st,
  origin: { method: 'test', params: {}, createdAt: 'op', createdBy: 'test', edited: false }, ...extra,
});

describe('motion tracks: caps', () => {
  it(`a track of ${MAX_TRACK_SAMPLES + 1} samples is refused, and so is a project over ${MAX_PROJECT_TRACK_SAMPLES} samples`, () => {
    const { doc, assetId } = project(20_000);
    const t = create(doc, { assetId, kind: 'point', frame: 0, x: 5000, y: 5000 });
    const full = (k: number) => ({ x: Array(k).fill(5000), y: Array(k).fill(5000), q: Array(k).fill(90), st: Array(k).fill(ST.tracked) });
    // one stretch too long for the arguments, and a second stretch that would grow the track past the cap
    expect(refusal(() => attach(t.doc, t.id, 0, full(MAX_TRACK_SAMPLES + 1))).code).toBe('invalid_args');
    const at = attach(t.doc, t.id, 0, full(MAX_TRACK_SAMPLES));
    expect(at.motionTracks[t.id]!.x.length).toBe(MAX_TRACK_SAMPLES);
    const grow = refusal(() => attach(at, t.id, MAX_TRACK_SAMPLES, full(1)));
    expect([grow.code, grow.message]).toEqual(['out_of_bounds', `a motion track can hold at most ${MAX_TRACK_SAMPLES} samples; this edit would make ${MAX_TRACK_SAMPLES + 1}`]);
    expect(refusal(() => tx(at, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, set: [{ frame: MAX_TRACK_SAMPLES, x: 1, y: 1 }] } }])).code).toBe('out_of_bounds');
    // four full tracks fill the project exactly; a fifth sample anywhere is refused
    let d = at;
    for (let k = 0; k < 3; k++) { const c = create(d, { assetId, kind: 'point', frame: 0, x: 1, y: 1 }); d = attach(c.doc, c.id, 0, full(MAX_TRACK_SAMPLES)); }
    expect(Object.values(d.motionTracks).reduce((s, m) => s + m.x.length, 0)).toBe(MAX_PROJECT_TRACK_SAMPLES);
    const fifth = refusal(() => create(d, { assetId, kind: 'point', frame: 0, x: 1, y: 1 }));
    expect([fifth.code, fifth.message]).toEqual(['out_of_bounds', `the motion tracks of a project can hold at most ${MAX_PROJECT_TRACK_SAMPLES} samples in all; this edit would make ${MAX_PROJECT_TRACK_SAMPLES + 1}`]);
  });
});

describe('motion tracks: sampling', () => {
  it('outside the track: the nearest end sample, raw, with outside=true', () => {
    const t = track(10, [ST.tracked, ST.tracked, ST.lost, ST.tracked]);
    expect(trackSampleAt(t, 9)).toEqual({ x: 1000, y: 2000, s: 1000, q: 80, st: ST.tracked, outside: true });
    expect(trackSampleAt(t, 0, 5)).toEqual({ x: 1000, y: 2000, s: 1000, q: 80, st: ST.tracked, outside: true });
    expect(trackSampleAt(t, 14)).toEqual({ x: 1030, y: 1997, s: 1000, q: 80, st: ST.tracked, outside: true });
    expect(trackSampleAt(t, 13)).toEqual({ x: 1030, y: 1997, s: 1000, q: 80, st: ST.tracked, outside: false });
    // a region track reports its size; a point track always SIZE_UNIT
    const r = track(0, [ST.tracked, ST.tracked], { kind: 'region', box: { w: 1000, h: 2000 }, s: [900, 1100] });
    expect(trackSampleAt(r, 1).s).toBe(1100);
    expect(trackSampleAt(r, 5).s).toBe(1100);
  });
  it('smoothing averages only usable samples (round half up), returns a manual sample exactly, and falls back to the raw sample', () => {
    const t = track(0, [ST.tracked, ST.lost, ST.tracked, ST.weak, ST.tracked, ST.manual, ST.unknown], { x: [100, 9999, 103, 9999, 106, 500, 9999], y: [-7, 0, -8, 0, -8, 0, 0], kind: 'region', box: { w: 100, h: 100 }, s: [1000, 5000, 1001, 5000, 1001, 2000, 5000] });
    // frame 2, ±2: usable 0, 2, 4 → x (100+103+106)/3 = 103, y −23/3 = −7.67 → −8, s 3002/3 = 1000.67 → 1001; q and st stay its own
    expect(trackSampleAt(t, 2, 2)).toEqual({ x: 103, y: -8, s: 1001, q: 80, st: ST.tracked, outside: false });
    // frame 1 (lost), ±1: usable 0 and 2 → x 101.5 → 102 (half up), y −7.5 → −7 (half up)
    expect(trackSampleAt(t, 1, 1)).toEqual({ x: 102, y: -7, s: 1001, q: 80, st: ST.lost, outside: false });
    // a manual sample is returned bit-exactly whatever is around it
    expect(trackSampleAt(t, 5, 3)).toEqual({ x: 500, y: 0, s: 2000, q: 80, st: ST.manual, outside: false });
    // no usable sample in the window: the raw one
    const lost = track(0, [ST.lost, ST.weak, ST.unknown], { x: [1, 2, 3] });
    expect(trackSampleAt(lost, 1, 1)).toEqual({ x: 2, y: 1999, s: 1000, q: 80, st: ST.weak, outside: false });
  });
  it('region geometry: fixed, a region track (its own box and size), a point track (the region\'s size), with padding', () => {
    const r: RedactRegion = { ...DEFAULT_REDACT_REGION, id: 'rgn_a', motionTrackId: null, x: 0.1, y: -0.2, width: 0.2, height: 0.4, pad: 0.5 };
    expect(regionGeometry(r, null, null)).toEqual({ x: 0.1, y: -0.2, width: 0.30000000000000004, height: 0.6000000000000001 });
    const region = track(0, [ST.tracked], { kind: 'region', box: { w: 2000, h: 4000 }, s: [1500], x: [7500], y: [2500] });
    const s = trackSampleAt(region, 0);
    const g = regionGeometry({ ...r, motionTrackId: region.id }, region, s);
    expect(g.x).toBeCloseTo(0.35, 12); expect(g.y).toBeCloseTo(-0.45, 12);
    expect(g.width).toBeCloseTo(0.2 * 1.5 * 1.5, 12); expect(g.height).toBeCloseTo(0.4 * 1.5 * 1.5, 12);
    const point = track(0, [ST.tracked], { x: [5000], y: [5000] });
    expect(regionGeometry({ ...r, motionTrackId: point.id }, point, trackSampleAt(point, 0))).toEqual({ x: 0.1, y: -0.2, width: 0.30000000000000004, height: 0.6000000000000001 });
  });
  it('the summary counts states and lists the stretches to review in source frames, [from, to)', () => {
    const t = track(100, [ST.manual, ST.tracked, ST.weak, ST.weak, ST.lost, ST.lost, ST.lost, ST.reacquired, ST.tracked, ST.unknown, ST.interpolated]);
    const sum = trackSummary(t);
    expect(sum.samples).toBe(11);
    expect(sum.counts).toEqual({ unknown: 1, tracked: 2, weak: 2, lost: 3, manual: 1, interpolated: 1, reacquired: 1 });
    expect(sum.problems).toEqual([{ from: 102, to: 104, state: 'weak' }, { from: 104, to: 107, state: 'lost' }, { from: 107, to: 108, state: 'reacquired' }, { from: 109, to: 110, state: 'unknown' }]);
  });
});

describe('motion tracks: hand edits', () => {
  it('interpolation is an integer straight line between the usable samples on either side (three pinned values)', () => {
    const { doc, assetId } = project();
    const t = create(doc, { assetId, kind: 'point', frame: 10, x: 1000, y: 2000 });
    let d = attach(t.doc, t.id, 11, { x: Array(9).fill(4000), y: Array(9).fill(4000), q: [90, 90, 90, 40, 40, 40, 40, 90, 90], st: Array(9).fill(ST.weak) });
    d = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, set: [{ frame: 20, x: 1007, y: 1995 }], interpolate: { from: 11, to: 20 } } }]).doc;
    const m = d.motionTracks[t.id]!;
    const at = (f: number) => [m.x[f - m.from], m.y[f - m.from], m.q[f - m.from], m.st[f - m.from]];
    // x: 1000 + 7·k/10, y: 2000 − 5·k/10, each rounded half up
    expect(at(11)).toEqual([1001, 2000, 100, ST.interpolated]);
    expect(at(13)).toEqual([1002, 1999, 100, ST.interpolated]);
    expect(at(15)).toEqual([1004, 1998, 100, ST.interpolated]);
    expect(at(20)).toEqual([1007, 1995, 100, ST.manual]);
    expect(m.origin.edited).toBe(true);
    // a hand-placed sample inside the stretch is kept, and the line runs through it
    const e = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, set: [{ frame: 15, x: 3000, y: 3000 }], interpolate: { from: 11, to: 20 } } }]).doc.motionTracks[t.id]!;
    expect([e.x[15 - e.from], e.x[13 - e.from], e.x[17 - e.from]]).toEqual([3000, 1000 + Math.floor((2 * 2000 * 3 + 5) / 10), 3000 + Math.floor((2 * -1993 * 2 + 5) / 10)]);
  });
  it('marking a stretch lost holds the last usable position before it (else the first after); set outside the track extends it with unknown frames', () => {
    const { doc, assetId } = project();
    const t = create(doc, { assetId, kind: 'region', frame: 50, x: 5000, y: 5000, w: 1000, h: 1000 });
    let d = attach(t.doc, t.id, 51, { x: [5100, 5200, 5300, 5400], y: [5000, 5000, 5000, 5000], s: [1000, 1010, 1020, 1030], q: [90, 90, 90, 90], st: [ST.tracked, ST.tracked, ST.tracked, ST.tracked] });
    d = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, markLost: { from: 53, to: 55 } } }]).doc;
    let m = d.motionTracks[t.id]!;
    expect([m.x.slice(3), m.s!.slice(3), m.st.slice(3), m.q.slice(3)]).toEqual([[5200, 5200], [1010, 1010], [ST.lost, ST.lost], [0, 0]]);
    // nothing usable before: the first usable after
    d = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, markLost: { from: 50, to: 52 } } }]).doc;
    m = d.motionTracks[t.id]!;
    expect([m.x.slice(0, 2), m.st.slice(0, 2)]).toEqual([[5200, 5200], [ST.lost, ST.lost]]);
    // a sample placed after the end: the frames between are unknown, at the nearest known position
    d = tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, set: [{ frame: 60, x: 9000, y: 1000, s: 2000 }] } }]).doc;
    m = d.motionTracks[t.id]!;
    expect([m.from, m.x.length, m.st.slice(5), m.x.slice(5)]).toEqual([50, 11, [ST.unknown, ST.unknown, ST.unknown, ST.unknown, ST.unknown, ST.manual], [5200, 5200, 5200, 9000, 9000, 9000]]);
    expect(refusal(() => tx(d, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, interpolate: { from: 40, to: 52 } } }])).code).toBe('out_of_bounds');
  });
  it('a tracking run keeps hand-placed samples, and only clears "edited" when it measured over every hand edit', () => {
    const { doc, assetId } = project();
    const t = create(doc, { assetId, kind: 'point', frame: 20, x: 5000, y: 5000 });
    let d = tx(t.doc, [{ op: 'edit_motion_track', args: { motionTrackId: t.id, set: [{ frame: 30, x: 6000, y: 6000 }] } }]).doc;
    expect(d.motionTracks[t.id]!.origin.edited).toBe(true);
    const cols = (k: number) => ({ x: Array(k).fill(1), y: Array(k).fill(2), q: Array(k).fill(90), st: Array(k).fill(ST.tracked) });
    let a = attach(d, t.id, 25, cols(10));
    expect(a.motionTracks[t.id]!.origin.edited).toBe(true); // frames 20..24 were not measured again
    expect(a.motionTracks[t.id]!.x[10]).toBe(6000); // the manual sample at 30 stays
    a = attach(d, t.id, 0, cols(100));
    const m = a.motionTracks[t.id]!;
    expect([m.from, m.x.length, m.origin.edited, m.origin.method, m.st[20], m.x[20], m.st[30], m.x[30], m.x[21]]).toEqual([0, 100, false, 'test', ST.manual, 5000, ST.manual, 6000, 1]);
    // a gap between the old and the new stretch: unknown, at the nearest known sample
    const g = attach(t.doc, t.id, 26, cols(2)).motionTracks[t.id]!;
    expect([g.from, g.st, g.x]).toEqual([20, [ST.manual, ST.unknown, ST.unknown, ST.unknown, ST.unknown, ST.unknown, ST.tracked, ST.tracked], [5000, 5000, 5000, 5000, 1, 1, 1, 1]]);
  });
});

describe('motion tracks: the loss filter (closing, in source frames)', () => {
  /** Runs of equal flags: [value, start, length]. */
  const runs = (f: Uint8Array) => { const out: [number, number, number][] = []; for (let i = 0; i < f.length; ) { let j = i; while (j < f.length && f[j] === f[i]) j++; out.push([f[i]!, i, j - i]); i = j; } return out; };
  it('over 500 seeded random state arrays at 24, 30 and 60 fps: bad is flagged, bad runs and good runs are never shorter than the filter allows', () => {
    const rnd = mulberry32(15);
    for (let k = 0; k < 500; k++) {
      const fps = [24, 30, 60][k % 3]!, H = lossHalfWidth(fps);
      expect(H).toBe(Math.ceil(fps / 3));
      const len = 1 + Math.floor(rnd() * 400);
      const st: number[] = [];
      // runs of a state, mostly tracked, so that good and bad stretches of every length occur
      while (st.length < len) { const s = rnd() < 0.55 ? ST.tracked : [ST.unknown, ST.weak, ST.lost, ST.manual, ST.interpolated, ST.reacquired][Math.floor(rnd() * 6)]!; const r = 1 + Math.floor(rnd() * (rnd() < 0.5 ? 4 : 40)); for (let i = 0; i < r && st.length < len; i++) st.push(s); }
      const weakIsLost = rnd() < 0.5;
      const t = track(0, st);
      const f = lossFlags(t, fps, weakIsLost);
      const bad = st.map((s) => s === ST.unknown || s === ST.lost || (weakIsLost && s === ST.weak));
      const where = `case ${k}: fps ${fps} weakIsLost ${weakIsLost} states ${st.join('')}`;
      bad.forEach((b, i) => { if (b && !f[i]) throw new Error(`${where}: bad sample ${i} not flagged`); });
      for (const [v, start, length] of runs(f)) {
        const interior = start > 0 && start + length < f.length;
        if (v === 1 && interior && length < H) throw new Error(`${where}: interior bad run at ${start} has ${length} < ${H}`);
        if (v === 0 && length < H + 1) throw new Error(`${where}: good run at ${start} has ${length} < ${H + 1}`);
      }
      // and nothing else is flagged: a flagged sample is within H of a bad one, or in a good stretch too short to keep
      const near = st.map((_, i) => bad.some((b, j) => b && Math.abs(i - j) <= H));
      for (let i = 0; i < st.length; ) {
        if (near[i]) { i++; continue; }
        let j = i; while (j < st.length && !near[j]) j++;
        for (let x = i; x < j; x++) if (!!f[x] !== (j - i < H + 1)) throw new Error(`${where}: sample ${x} flagged ${f[x]} although its good stretch has ${j - i}`);
        i = j;
      }
      expect(lossFlags(t, fps, weakIsLost)).toBe(f); // cached per track object
    }
  });
  it('a fully usable track is never flagged; weak counts only when weakIsLost', () => {
    expect([...lossFlags(track(0, Array(40).fill(ST.tracked)), 30, true)].every((v) => v === 0)).toBe(true);
    const w = track(0, [...Array(30).fill(ST.tracked), ST.weak, ...Array(30).fill(ST.tracked)]);
    expect(lossFlags(w, 30, false).some((v) => v === 1)).toBe(false);
    expect([...lossFlags(w, 30, true)].map((v, i) => (v ? i : -1)).filter((i) => i >= 0)).toEqual(Array.from({ length: 21 }, (_, i) => 20 + i));
  });
});
