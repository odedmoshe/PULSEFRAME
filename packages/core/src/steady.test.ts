/**
 * The frozen smoothing and cover maths of stabilisation (steady.ts, STEADY_MATHS_V1). One test per rule of the file's header; each
 * fails when its rule is broken. Independent checks use Math.sin/cos/exp here (never in steady.ts).
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, cameraMotionSummary, clipSourceFrames, compose, contentTransform, createProject, expm, inverse, limitToCover, neededZoom, planStabilise,
  SST, STEADY_SELFTEST_DIGEST, steadyHalfWindow, steadyPose, steadyPoseDigest, steadySelftest, steadySelftestMotion, sinCos,
  type CameraMotion, type CameraStretch, type MediaClip, type OpCall, type ProjectDocument, type Similarity,
} from './index.ts';

const R30 = { num: 30, den: 1 };
const HH = 9 / 32; // 1280×720
const origin = { method: 't', params: {}, createdAt: 'x', createdBy: 't' };
/** A stretch from columns of plain numbers (deltas in stored units). */
function stretch(from: number, cols: { dx?: number[]; dy?: number[]; dr?: number[]; dz?: number[]; st: number[] }): CameraStretch {
  const z = cols.st.map(() => 0);
  return { from, dx: cols.dx ?? z, dy: cols.dy ?? z, dr: cols.dr ?? z, dz: cols.dz ?? z, st: cols.st, origin };
}
const okRun = (n: number) => [SST.start, ...Array<number>(n - 1).fill(SST.ok)];
const motion = (...s: CameraStretch[]): CameraMotion => ({ stretches: s });
/** A seeded generator (xorshift), for the property rows. */
function rng(seed: number) { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }
/** Where window corner c maps back into the content (independent: Math functions), and whether all four land inside. */
function covers(p: Similarity, Z: number, hh: number, slack = 1e-12): boolean {
  const c = Math.cos(-p.r), s = Math.sin(-p.r), e = Math.exp(-p.l);
  for (const cx of [-0.5, 0.5]) for (const cy of [-hh, hh]) {
    const ux = cx / Z - p.tx, uy = cy / Z - p.ty;
    const qx = e * (c * ux - s * uy), qy = e * (s * ux + c * uy);
    if (Math.abs(qx) > 0.5 + slack || Math.abs(qy) > hh + slack) return false;
  }
  return true;
}
const apply = (a: Similarity, x: number, y: number) => { const e = Math.exp(a.l), c = Math.cos(a.r), s = Math.sin(a.r); return [e * (c * x - s * y) + a.tx, e * (s * x + c * y) + a.ty] as const; };

describe('elementary functions (S8)', () => {
  it('sinCos within 1e-12 of Math over |x| ≤ 100, exact at 0; expm within 1e-12 relative over |x| ≤ 1, exact at 0', () => {
    let worst = 0;
    for (let x = -100; x <= 100; x += 0.00731) { const [s, c] = sinCos(x); worst = Math.max(worst, Math.abs(s - Math.sin(x)), Math.abs(c - Math.cos(x))); }
    expect(worst).toBeLessThan(1e-12);
    let rel = 0;
    for (let x = -1; x <= 1; x += 0.000173) rel = Math.max(rel, Math.abs(expm(x) / Math.exp(x) - 1));
    expect(rel).toBeLessThan(1e-12);
    expect(sinCos(0)).toEqual([0, 1]);
    expect(expm(0)).toBe(1);
    expect([expm(Infinity), expm(-Infinity)]).toEqual([Infinity, 0]);
    expect(Math.abs(expm(5) / Math.exp(5) - 1)).toBeLessThan(1e-12);
  });
});

describe('similarities', () => {
  it('compose applies b then a; inverse undoes; a round trip returns the identity within 1e-15', () => {
    const r = rng(3);
    for (let k = 0; k < 500; k++) {
      const a = { r: r() - 0.5, l: (r() - 0.5) * 0.4, tx: r() - 0.5, ty: r() - 0.5 }, b = { r: r() - 0.5, l: (r() - 0.5) * 0.4, tx: r() - 0.5, ty: r() - 0.5 };
      const ab = compose(a, b), [x, y] = [r() - 0.5, r() - 0.5];
      const want = apply(a, ...apply(b, x, y)), got = apply(ab, x, y);
      expect(Math.abs(want[0] - got[0]) + Math.abs(want[1] - got[1])).toBeLessThan(1e-12);
      const id = compose(inverse(a), a);
      expect(Math.abs(id.r) + Math.abs(id.l) + Math.abs(id.tx) + Math.abs(id.ty)).toBeLessThan(1e-15);
    }
  });
});

describe('smoothing (rules: window, links, correction)', () => {
  it('a steady pan gets the identity on every frame, edges included, at strengths 1, 50 and 100 (exactly, translation pan)', () => {
    const n = 300;
    const pan = motion(stretch(0, { st: okRun(n), dx: Array(n).fill(312), dy: Array(n).fill(-57) }));
    for (const s of [1, 50, 100]) for (let f = 0; f < n; f++) {
      const p = steadyPose(pan, f, s, R30);
      expect([p.r, p.l, p.tx, p.ty].map((v) => v === 0)).toEqual([true, true, true, true]);
      expect(neededZoom(p, HH)).toBe(1);
    }
  });
  it('a pan that also turns and zooms steadily: rotation and scale exactly 0; the translation keeps a second-order residual (parameter-wise mean)', () => {
    // 0.04°/frame turn, −0.03 %/frame zoom and a 0.2 %-of-width/frame pan: measured residual 2.7e-6, 8.2e-5 and 9.7e-4 of the width
    // at strengths 1, 50, 100 (1.25 px at 1280 wide at 100). Recorded for the lead: the decisions fix a parameter-wise mean.
    const n = 200;
    const pan = motion(stretch(0, { st: okRun(n), dx: Array(n).fill(200), dy: Array(n).fill(90), dr: Array(n).fill(700), dz: Array(n).fill(-300) }));
    const bound: Record<number, number> = { 1: 5e-6, 50: 1e-4, 100: 1.2e-3 };
    for (const s of [1, 50, 100]) for (let f = 0; f < n; f++) {
      const p = steadyPose(pan, f, s, R30);
      expect([p.r, p.l]).toEqual([0, 0]);
      expect(Math.abs(p.tx) + Math.abs(p.ty)).toBeLessThan(bound[s]!);
    }
    // a pure turn and zoom about the centre (no translation) is exactly the identity
    const turn = motion(stretch(0, { st: okRun(n), dr: Array(n).fill(700), dz: Array(n).fill(-300) }));
    for (let f = 0; f < n; f++) expect(steadyPose(turn, f, 100, R30)).toMatchObject({ r: 0, l: 0, tx: 0, ty: 0 });
  });
  it('the correction is B(k), not its inverse: a one-frame jolt of +a is drawn back by −a·(1 − w0/Σw)', () => {
    const n = 100, a = 1000, k = 50, dx = Array(n).fill(0);
    dx[k] = a; dx[k + 1] = -a; // the scene sits a further right in frame k only
    const p = steadyPose(motion(stretch(0, { st: okRun(n), dx })), k, 50, R30);
    const R = steadyHalfWindow(50, R30), W = (R + 1) ** 2;
    let sw = W * W; for (let d = 1; d <= R; d++) sw += 2 * (W - d * d) ** 2;
    expect(p.tx).toBeCloseTo((-a / 100_000) * (1 - (W * W) / sw), 15);
    expect(p.tx).toBeLessThan(0);
  });
  it('the window is symmetric and truncated: at a boundary the pose is the identity; nothing across a start is read (S5)', () => {
    const n = 120, r = rng(9);
    const dx = Array.from({ length: n }, () => Math.round((r() - 0.5) * 4000)), st = okRun(n);
    st[60] = SST.start; dx[60] = 0;
    const m = motion(stretch(10, { st, dx }));
    expect(steadyPose(m, 70, 50, R30)).toMatchObject({ r: 0, l: 0, tx: 0, ty: 0, state: 'start', boundary: true }); // frame 60 of the stretch
    expect(steadyPose(m, 10, 50, R30)).toMatchObject({ tx: 0, boundary: true });
    expect(steadyPose(m, 129, 50, R30)).toMatchObject({ tx: 0, boundary: true });
    // frames 69 and 71 (either side of the start): changing every delta on the other side changes nothing
    const before = [steadyPose(m, 69, 100, R30), steadyPose(m, 71, 100, R30)];
    const dx2 = dx.map((v, i) => (i <= 59 ? v : v + 777)), dx3 = dx.map((v, i) => (i >= 61 ? v : v - 555));
    expect(steadyPose(motion(stretch(10, { st, dx: dx2 })), 69, 100, R30)).toEqual(before[0]);
    expect(steadyPose(motion(stretch(10, { st, dx: dx3 })), 71, 100, R30)).toEqual(before[1]);
    // R_eff: frame 69 (sample 59) is the last of its segment → identity; frame 65 (sample 55) reads 4 frames on each side only:
    // samples 52..55 backward and 56..59 forward; every other sample may change
    expect(before[0]).toMatchObject({ tx: 0 });
    const near = steadyPose(m, 65, 100, R30), far = dx.map((v, i) => (i < 52 || i > 59 ? v + 999 : v));
    expect(near.tx).not.toBe(0);
    expect(steadyPose(motion(stretch(10, { st, dx: dx.map((v, i) => (i === 52 ? v + 1 : v)) })), 65, 100, R30)).not.toEqual(near);
    expect(steadyPose(motion(stretch(10, { st, dx: far })), 65, 100, R30)).toEqual(near);
  });
  it('an unknown run of 1–2 samples is bridged with the mean of its neighbours; a run of 3 is a boundary; no measured neighbour is a boundary', () => {
    const n = 80, dx: number[] = Array.from({ length: n }, (_, i) => (i % 2 ? 300 : -100)), st = okRun(n);
    const base = steadyPose(motion(stretch(0, { st, dx: dx.map((v, i) => (i === 40 ? (dx[39]! + dx[41]!) / 2 : v)) })), 38, 50, R30);
    const one = [...st]; one[40] = SST.unknown;
    expect(steadyPose(motion(stretch(0, { st: one, dx: dx.map((v, i) => (i === 40 ? 0 : v)) })), 38, 50, R30)).toEqual(base);
    expect(steadyPose(motion(stretch(0, { st: one, dx })), 40, 50, R30).state).toBe('unknown');
    const three = [...st]; three[40] = three[41] = three[42] = SST.unknown;
    expect(steadyPose(motion(stretch(0, { st: three, dx })), 41, 50, R30)).toMatchObject({ tx: 0, boundary: true });
    expect(steadyPose(motion(stretch(0, { st: three, dx })), 39, 50, R30)).toMatchObject({ tx: 0 }); // last frame before the run
    const lonely = [...st]; lonely[1] = SST.unknown; // neighbours: sample 0 (start) and sample 2 (ok) → bridged with sample 2
    const bridged = steadyPose(motion(stretch(0, { st: lonely, dx })), 3, 50, R30);
    expect(bridged).toEqual(steadyPose(motion(stretch(0, { st, dx: dx.map((v, i) => (i === 1 ? dx[2]! : v)) })), 3, 50, R30));
    const cut = [...st]; cut[1] = SST.unknown; cut[2] = SST.start; // no measured neighbour: frame 1 is cut off
    expect(steadyPose(motion(stretch(0, { st: cut, dx })), 1, 50, R30)).toMatchObject({ tx: 0, boundary: true });
  });
  it('outside every stretch: the nearest measured frame\'s pose, state outside, the earlier one on a tie', () => {
    const r = rng(5), dx = (n: number) => Array.from({ length: n }, () => Math.round((r() - 0.5) * 3000));
    const m = motion(stretch(10, { st: okRun(30), dx: dx(30) }), stretch(61, { st: okRun(30), dx: dx(30) }));
    const same = (a: number, b: number) => expect({ ...steadyPose(m, a, 50, R30), state: 'x' }).toEqual({ ...steadyPose(m, b, 50, R30), state: 'x' });
    expect(steadyPose(m, 2, 50, R30).state).toBe('outside');
    same(2, 10);
    same(49, 39); // 10 from 39, 12 from 61
    same(50, 39); // a tie (11 and 11): the earlier
    same(51, 61);
    same(200, 90);
    expect(steadyPose(m, 39, 50, R30).state).toBe('ok');
  });
  it('the cache never changes a result: poses asked in another order, or from a fresh copy, are equal bit for bit', () => {
    const m = steadySelftestMotion();
    const a = [299, 0, 150, 77, 410, 519].map((f) => steadyPose(m, f, 77, R30));
    const fresh = structuredClone(m);
    const b = [519, 410, 77, 150, 0, 299].map((f) => steadyPose(fresh, f, 77, R30)).reverse();
    expect(b).toEqual(a);
  });
});

describe('cover (S9)', () => {
  it('2,000 seeded poses: neededZoom covers and 0.999 of it does not; limitToCover always covers, unchanged when it already did', () => {
    const r = rng(11);
    let limited = 0;
    for (let k = 0; k < 2000; k++) {
      const p = { r: (r() - 0.5) * 0.2, l: (r() - 0.5) * 0.2, tx: (r() - 0.5) * 0.12, ty: (r() - 0.5) * 0.12 };
      const hh = [HH, 0.5, 1 / 3, 16 / 18][k % 4]!;
      const z = neededZoom(p, hh);
      if (Number.isFinite(z)) {
        expect(covers(p, z, hh)).toBe(true);
        expect(covers(p, z * 0.999, hh, 0)).toBe(false);
      }
      const zoom = 1 + r() * 0.3;
      const lim = limitToCover(p, zoom, hh);
      expect(covers(lim.pose, zoom, hh)).toBe(true);
      expect(lim.limited).toBe(!(z <= zoom));
      if (!lim.limited) expect(lim.pose).toEqual({ r: p.r, l: p.l, tx: p.tx, ty: p.ty });
      if (lim.limited) limited++;
    }
    expect(limited).toBeGreaterThan(100);
    expect(neededZoom({ r: 0, l: 0, tx: 0.5, ty: 0 }, HH)).toBe(Infinity);
    expect(neededZoom({ r: 0, l: 0, tx: 0, ty: 0 }, HH)).toBe(1);
  });
});

describe('contentTransform', () => {
  it('equals nesting the correction inside the own placement (any own rotation, scale, position, fit)', () => {
    const r = rng(21);
    for (let k = 0; k < 200; k++) {
      const own = { x: r() - 0.5, y: r() - 0.5, scale: 0.3 + r(), rotation: (r() - 0.5) * 360, opacity: 1 };
      const pose = { r: (r() - 0.5) * 0.1, l: (r() - 0.5) * 0.1, tx: (r() - 0.5) * 0.05, ty: (r() - 0.5) * 0.05 };
      const zoom = 1 + r() * 0.2, W = 1280, H = 720, fit = k % 2 ? 'cover' as const : 'contain' as const, srcW = k % 3 ? 1920 : 720, srcH = k % 3 ? 1080 : 1280;
      const f = (fit === 'cover' ? Math.max : Math.min)(W / srcW, H / srcH), w = srcW * f;
      // a picture point p (px from the picture centre, before any scale) drawn by the compositor's nesting
      const px = (r() - 0.5) * w, py = (r() - 0.5) * w;
      const th = (own.rotation * Math.PI) / 180, ze = zoom * Math.exp(pose.l);
      const ix = zoom * pose.tx * w + ze * (Math.cos(pose.r) * px - Math.sin(pose.r) * py), iy = zoom * pose.ty * w + ze * (Math.sin(pose.r) * px + Math.cos(pose.r) * py);
      const nx = W / 2 + own.x * W + own.scale * (Math.cos(th) * ix - Math.sin(th) * iy), ny = H / 2 + own.y * H + own.scale * (Math.sin(th) * ix + Math.cos(th) * iy);
      const ct = contentTransform(own, pose, zoom, W, H, fit, srcW, srcH), a = (ct.rotation * Math.PI) / 180;
      const sx = W / 2 + ct.x * W + ct.scale * (Math.cos(a) * px - Math.sin(a) * py), sy = H / 2 + ct.y * H + ct.scale * (Math.sin(a) * px + Math.cos(a) * py);
      expect(Math.abs(sx - nx) + Math.abs(sy - ny)).toBeLessThan(1e-8);
    }
  });
});

describe('summary', () => {
  it('counts per state; runs of weak and unknown and starts inside a stretch', () => {
    const m = motion(stretch(10, { st: [SST.start, SST.ok, SST.weak, SST.weak, SST.ok, SST.unknown, SST.start, SST.ok] }));
    expect(cameraMotionSummary(m)).toEqual({ samples: 8, counts: { unknown: 1, ok: 3, weak: 2, start: 2 }, review: [{ from: 12, to: 14, state: 'weak' }, { from: 15, to: 16, state: 'unknown' }, { from: 16, to: 17, state: 'start' }] });
  });
});

// ---------- the clip ----------
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `sd${n++}_`, actor: 'test', allowInternal });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
const video = (frames: number) => ({ kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'c'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(frames, R30), video: { width: 1280, height: 720, frameRate: R30, codec: 'h264', rotation: 0, frameCount: frames }, provenance: prov });
function project(frames = 600) {
  const r = tx(createProject({ id: 'prj_sd', name: 'S', width: 1280, height: 720 }), [{ op: 'import_asset', args: { asset: video(frames) } }], true);
  return { doc: r.doc, assetId: r.results[0]!.output!.assetId as string };
}
function place(doc: ProjectDocument, assetId: string, sourceIn: number, frames: number, at: number) {
  const before = new Set(clips(doc).map((c) => c.id));
  const d = tx(doc, [{ op: 'add_clip', args: { assetId, start: T.frameTime(at, R30), sourceIn: T.frameTime(sourceIn, R30), duration: T.frameTime(frames, R30) } }]).doc;
  return { doc: d, clipId: clips(d).find((c) => !before.has(c.id) && c.type === 'media' && d.sequences[d.mainSequenceId]!.tracks.some((t) => t.kind === 'video' && t.clips.includes(c)))!.id };
}
const clips = (doc: ProjectDocument) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => t.clips);
const clipOf = (doc: ProjectDocument, id: string) => clips(doc).find((c) => c.id === id) as MediaClip;

describe('clipSourceFrames', () => {
  it('first and last shown source frame at speed 1, 2 and reversed', () => {
    const { doc, assetId } = project();
    const { doc: d, clipId } = place(doc, assetId, 100, 60, 0);
    expect(clipSourceFrames(d, clipOf(d, clipId))).toEqual({ first: 100, last: 159, reach: { first: 100, last: 159 } });
    const fast = tx(d, [{ op: 'set_clip_speed', args: { clipId, speed: 2 } }]).doc;
    expect(clipSourceFrames(fast, clipOf(fast, clipId))).toMatchObject({ first: 100, last: 158 });
    const rev = tx(d, [{ op: 'set_clip_reverse', args: { clipId, reverse: true } }]).doc;
    expect(clipSourceFrames(rev, clipOf(rev, clipId))).toMatchObject({ first: 100, last: 159 });
  });
  it('reach: a velocity ramp reads before the clip\'s start; the clip plays on into its handle while the next clip\'s transition runs', () => {
    const { doc, assetId } = project();
    let { doc: d, clipId: a } = place(doc, assetId, 100, 60, 0);
    const p = place(d, assetId, 300, 60, 60); d = p.doc; const b = p.clipId;
    d = tx(d, [{ op: 'set_transition', args: { clipId: b, type: 'dissolve', frames: 10 } }, { op: 'set_transition_options', args: { clipId: b, velocity: 2 } }]).doc;
    const fa = clipSourceFrames(d, clipOf(d, a)), fb = clipSourceFrames(d, clipOf(d, b));
    expect(fa).toMatchObject({ first: 100, last: 159 });
    expect(fa.reach.first).toBe(100);
    expect(fa.reach.last).toBe(160 + 9 + Math.floor((1 * 9 * 10) / 20)); // handle: local 9 plus the ramp's out offset there
    expect(fb).toMatchObject({ first: 300, last: 359 });
    expect(fb.reach).toEqual({ first: 300 - Math.floor((1 * 9 * 10) / 20), last: 359 });
  });
});

describe('planStabilise', () => {
  const shaky = (frames: number, seed: number, amp = 600) => {
    const r = rng(seed);
    return { st: okRun(frames), dx: Array.from({ length: frames }, () => Math.round((r() - 0.5) * amp)), dy: Array.from({ length: frames }, () => Math.round((r() - 0.5) * amp)), dr: Array.from({ length: frames }, () => Math.round((r() - 0.5) * amp * 2)), dz: Array.from({ length: frames }, () => Math.round((r() - 0.5) * amp * 0.3)) };
  };
  const setup = (amp = 600) => {
    const { doc, assetId } = project();
    const { doc: d, clipId } = place(doc, assetId, 100, 90, 0);
    const a = tx(d, [{ op: 'attach_camera_motion', args: { assetId, from: 25, ...shaky(240, 4, amp), method: 't', params: { algo: 1, input: 'proxy' }, createdAt: 'x' } }], true).doc;
    return { doc: a, clip: clipOf(a, clipId), assetId };
  };
  it('the zoom is the smallest that covers every frame of the reach, rounded up to 1/1000; no frame is limited at it', () => {
    const { doc, clip, assetId } = setup();
    const m = doc.analyses[assetId]!.cameraMotion!;
    const plan = planStabilise(doc, clip, { strength: 50 });
    let need = 1; for (let f = 100; f < 190; f++) need = Math.max(need, neededZoom(steadyPose(m, f, 50, R30), HH));
    expect(plan.zoomPm).toBe(Math.ceil(1000 * need));
    expect(plan.zoomPm).toBeGreaterThan(1000);
    expect(plan.limitedFrames).toEqual([]);
    expect(plan.measured).toEqual({ frames: 90, ok: 90, weak: 0, unknown: 0, outside: 0 });
    expect(plan.areaPercent).toBe(Math.round(1000 * (1 - 1e6 / plan.zoomPm ** 2)) / 10);
    // a smaller given zoom is stored as is and the frames that need more are listed
    const tight = planStabilise(doc, clip, { strength: 50, zoomPm: 1001 });
    expect(tight.zoomPm).toBe(1001);
    expect(tight.limitedFrames.length).toBeGreaterThan(0);
    expect(tight.limitedFrames.every((r) => r.reason === 'clip' && r.from >= 100 && r.to <= 190)).toBe(true);
  });
  it('maxCrop: the asked strength is kept when it fits; otherwise the largest fitting strength by bisection (verified); the floor stores 5 with the crop\'s zoom', () => {
    const { doc, clip } = setup(3000);
    const full = planStabilise(doc, clip, { strength: 100 });
    const crop = (z: number) => 100 * (1 - 1e6 / (z * z));
    expect(planStabilise(doc, clip, { strength: 100, maxCrop: 50 })).toMatchObject({ strength: 100, zoomPm: full.zoomPm, strengthLowered: false });
    const want = Math.max(1, Math.floor(crop(full.zoomPm)) - 1);
    const p = planStabilise(doc, clip, { strength: 100, maxCrop: want });
    expect(p.strengthLowered).toBe(true);
    expect(crop(p.zoomPm)).toBeLessThanOrEqual(want);
    expect(p.zoomPm).toBe(planStabilise(doc, clip, { strength: p.strength }).zoomPm);
    if (p.strength < 99) expect(crop(planStabilise(doc, clip, { strength: p.strength + 1 }).zoomPm)).toBeGreaterThan(want);
    const floor = planStabilise(doc, clip, { strength: 100, maxCrop: 1 });
    expect(floor.strength).toBe(5);
    expect(crop(floor.zoomPm)).toBeLessThanOrEqual(1);
    expect(crop(floor.zoomPm + 1)).toBeGreaterThan(1);
    expect(floor.strengthLowered).toBe(true);
  });
});

describe('the cross-runtime digest (S7)', () => {
  it('is frozen: steadyPoseDigest of the selftest motion at 1, 50 and 100 (the browser selftest compares the same constant)', () => {
    expect(steadySelftest()).toEqual({ digest: STEADY_SELFTEST_DIGEST, expected: STEADY_SELFTEST_DIGEST, ok: true });
    expect(steadyPoseDigest(steadySelftestMotion(), [50], R30)).not.toBe(STEADY_SELFTEST_DIGEST);
  });
});
