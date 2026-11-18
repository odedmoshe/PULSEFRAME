/**
 * Perform mode's virtual camera (ADR-0025, W2; cameraPath.ts): the spring against its closed form, settling, the sine response,
 * the clamp inside the picture on every dense AND every interpolated frame for three aspect cases, the zoom ceiling against the
 * schema's |x|, |y| ≤ 4, simplification and its residual, the seeded sway, every refusal, the three range-form
 * replace_clip_keyframes calls applied through applyTransaction (a partial retake), and byte-identical ops.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, CAMERA_REFUSALS, CAMERA_SETTLE_K, CAMERA_TOLERANCE, cameraLimits, createProject, DEFAULT_CAMERA, fitScale, MAX_CAMERA_KEYS, placed, planCamera, poseToClip,
  sampleKeyframes, simplifyPath, sourceToFrame, springPath, transformAt, TRANSFORM_RANGE, validateProject,
  type CameraGeometry, type CameraPlan, type CameraRefusal, type CameraSample, type CameraSettings, type Clip, type ClipPose, type MediaClip, type OpCall, type ProjectDocument,
} from './index.ts';

const RATES = [{ num: 12, den: 1 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
const R30 = { num: 30, den: 1 };
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const G169: CameraGeometry = { frameW: 1920, frameH: 1080, srcW: 1920, srcH: 1080, fit: 'cover' };
/** The aspect cases of the brief: 16:9 in a 9:16 cover frame, 9:16 in a 16:9 contain frame, 16:9 in a 1:1 frame. */
const CASES: { name: string; frame: [number, number]; src: [number, number]; fit: 'contain' | 'cover' }[] = [
  { name: '16:9 in 9:16 cover', frame: [1080, 1920], src: [1920, 1080], fit: 'cover' },
  { name: '9:16 in 16:9 contain', frame: [1920, 1080], src: [1080, 1920], fit: 'contain' },
  { name: '16:9 in 1:1 contain', frame: [1080, 1080], src: [1920, 1080], fit: 'contain' },
];
const still = (s: CameraSettings = DEFAULT_CAMERA) => s;
const omegaOf = (s: CameraSettings) => CAMERA_SETTLE_K / s.settleSeconds;
const shiftOf = (s: CameraSettings, fps: number) => Math.round((2 / omegaOf(s) + s.leadSeconds) * fps);

/** True when the picture covers the frame (every edge at or past the frame's edge, to a millionth of a pixel). */
function covers(g: CameraGeometry, t: { x: number; y: number; scale: number }): boolean {
  const p = placed(g.frameW, g.frameH, g.fit, g.srcW, g.srcH, { ...t, rotation: 0 });
  const tl = sourceToFrame(p, 0, 0), br = sourceToFrame(p, 1, 1), eps = 1e-6;
  return tl.px <= eps && tl.py <= eps && br.px >= g.frameW - eps && br.py >= g.frameH - eps;
}
/** A wandering pointer: drift, jumps, off-picture excursions, and zoom from 0.5 to 6 (past the ceiling). */
function wander(seed: number, from: number, to: number): CameraSample[] {
  const rnd = mulberry32(seed);
  let u = 0.5, v = 0.5, z = 1.5;
  const out: CameraSample[] = [];
  for (let f = from; f <= to; f++) {
    if (rnd() < 0.03) { u = rnd() * 1.4 - 0.2; v = rnd() * 1.4 - 0.2; }
    if (rnd() < 0.03) z = 0.5 + rnd() * 5.5;
    u += (rnd() - 0.5) * 0.02; v += (rnd() - 0.5) * 0.02;
    if (rnd() < 0.8) out.push({ frame: f, u, v, zoom: z }); // gaps are filled by interpolation
  }
  return out;
}

// ---------- documents ----------
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
const video = (w: number, h: number, seconds = 120) => ({ kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(seconds, 1), video: { width: w, height: h, frameRate: R30, codec: 'h264', rotation: 0, frameCount: seconds * 30 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov });
const picture = (w: number, h: number) => ({ kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: w, height: h, codec: 'png', hasAlpha: false }, provenance: prov });
let seedN = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `c${seedN++}_`, actor: 'user:owner', allowInternal: true });
function project(o: { frame?: [number, number]; src?: [number, number]; fit?: 'contain' | 'cover'; frames?: number; startFrame?: number; image?: boolean } = {}) {
  const [W, H] = o.frame ?? [640, 360], [sw, sh] = o.src ?? [1920, 1080];
  const d0 = createProject({ id: 'prj_cam', name: 'camera', width: W, height: H, frameRate: R30 });
  d0.settings.fit = o.fit ?? 'contain';
  const a = tx(d0, [{ op: 'import_asset', args: { asset: o.image ? picture(sw, sh) : video(sw, sh) } }]);
  const assetId = Object.keys(a.doc.assets)[0]!;
  const trackId = a.doc.sequences[a.doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!.id;
  const c = tx(a.doc, [{ op: 'add_clip', args: { assetId, trackId, start: T.frameTime(o.startFrame ?? 0, R30), duration: T.frameTime(o.frames ?? 300, R30) } }]);
  const clipId = (c.results[0]!.output as { clipId: string }).clipId;
  return { doc: c.doc, clipId, trackId, assetId };
}
const clipOf = (doc: ProjectDocument, id: string): Clip => { for (const s of Object.values(doc.sequences)) for (const t of s.tracks) for (const c of t.clips) if (c.id === id) return c; throw new Error(id); };
const geometryOf = (doc: ProjectDocument, clipId: string): CameraGeometry => {
  const a = doc.assets[(clipOf(doc, clipId) as MediaClip).assetId]!, size = (a.video ?? a.image)!;
  return { frameW: doc.settings.width, frameH: doc.settings.height, srcW: size.width, srcH: size.height, fit: doc.settings.fit ?? 'contain' };
};
const isPlan = (r: CameraPlan | { refused: CameraRefusal }): r is CameraPlan => !('refused' in r);
const plan = (doc: ProjectDocument, input: Parameters<typeof planCamera>[1]): CameraPlan => { const r = planCamera(doc, input); if (!isPlan(r)) throw new Error(`refused ${r.refused}`); return r; };

describe('geometry: fill, the zoom ceiling and the transform', () => {
  it('cameraLimits: fill 1 under cover, contain/cover under contain; the ceiling from |x|, |y| ≤ 4 (2.85 for 16:9 in 9:16)', () => {
    const a = cameraLimits({ frameW: 1080, frameH: 1920, srcW: 1920, srcH: 1080, fit: 'cover' });
    expect(a.fill).toBe(1);
    expect(a.maxZoom).toBeCloseTo((9 * 1080) / (1920 * (1920 / 1080)), 12);
    expect(a.maxZoom).toBeCloseTo(2.8477, 3);
    const b = cameraLimits({ frameW: 1920, frameH: 1080, srcW: 1080, srcH: 1920, fit: 'contain' });
    expect(b.fill).toBeCloseTo((1920 * 1920) / (1080 * 1080), 12);
    expect(b.maxZoom).toBeCloseTo(2.8477, 3);
    expect(cameraLimits(G169)).toEqual({ fill: 1, maxZoom: 4 });
    // the fill scale covers exactly: at zoom 1 and the centre, the picture's edges are the frame's edges on the tight axis
    for (const c of CASES) {
      const g: CameraGeometry = { frameW: c.frame[0], frameH: c.frame[1], srcW: c.src[0], srcH: c.src[1], fit: c.fit };
      expect(covers(g, poseToClip(g, { u: 0.5, v: 0.5, zoom: 1 }))).toBe(true);
      expect(covers(g, { x: 0, y: 0, scale: cameraLimits(g).fill * 0.999 })).toBe(false);
    }
  });
  it('poseToClip puts source point (u, v) at the frame centre, as geometry.ts placed/sourceToFrame draw it', () => {
    const rnd = mulberry32(3);
    for (const c of CASES) {
      const g: CameraGeometry = { frameW: c.frame[0], frameH: c.frame[1], srcW: c.src[0], srcH: c.src[1], fit: c.fit };
      for (let i = 0; i < 50; i++) {
        const pose = { u: rnd(), v: rnd(), zoom: 1 + rnd() * 2 };
        const t = poseToClip(g, pose);
        expect(t.scale).toBeCloseTo(cameraLimits(g).fill * pose.zoom, 12);
        const p = sourceToFrame(placed(g.frameW, g.frameH, g.fit, g.srcW, g.srcH, { ...t, rotation: 0 }), pose.u, pose.v);
        expect(p.px).toBeCloseTo(g.frameW / 2, 6);
        expect(p.py).toBeCloseTo(g.frameH / 2, 6);
      }
    }
  });
});

describe('springPath: the critically damped spring', () => {
  const g = G169;
  it('one step equals the closed form p = g + (d + (v + ωd)h)e^(−ωh) to 1e-12 (u, v and ln zoom), at 12, 30 and 60 fps', () => {
    for (const rate of RATES) {
      const fps = rate.num, s = still({ ...DEFAULT_CAMERA, leadSeconds: 0.05 }), k = shiftOf(s, fps);
      // the target of frame 0 is the sample at k (a), the target of frame 1 the sample at k + 1 (b): one step from rest
      const a = { u: 0.4, v: 0.45, zoom: 2 }, b = { u: 0.6, v: 0.55, zoom: 3 };
      const samples: CameraSample[] = [{ frame: k, ...a }, { frame: k + 1, ...b }];
      const [p0, p1] = springPath(samples, 0, 1, g, s, fps);
      const w = omegaOf(s), h = 1 / fps;
      const closed = (from: number, to: number) => to + (from - to) * (1 + w * h) * Math.exp(-w * h); // v0 = 0
      expect(p0).toEqual({ u: a.u, v: a.v, zoom: expect.closeTo(a.zoom, 12) });
      expect(Math.abs(p1!.u - closed(a.u, b.u))).toBeLessThan(1e-12);
      expect(Math.abs(p1!.v - closed(a.v, b.v))).toBeLessThan(1e-12);
      expect(Math.abs(Math.log(p1!.zoom) - closed(Math.log(a.zoom), Math.log(b.zoom)))).toBeLessThan(1e-12);
      // and a second step carries the velocity exactly: v1 = −(ωd)ωh·e, p2 = g + (d1 + (v1 + ωd1)h)e
      const p2 = springPath([...samples, { frame: k + 2, ...b }], 0, 2, g, s, fps)[2]!;
      const e = Math.exp(-w * h), d0 = a.u - b.u, v1 = -(w * d0) * w * h * e, d1 = p1!.u - b.u;
      expect(Math.abs(p2.u - (b.u + (d1 + (v1 + w * d1) * h) * e))).toBeLessThan(1e-12);
    }
  });
  it('a constant target is reached within 2 % settleSeconds after it changes, without overshoot, at 12, 30 and 60 fps', () => {
    for (const rate of RATES) for (const settle of [0.3, 0.6, 1.2]) {
      const fps = rate.num, s = { ...DEFAULT_CAMERA, settleSeconds: settle }, k = shiftOf(s, fps);
      const change = 10; // the target of frames ≥ 10 is b
      const samples: CameraSample[] = [{ frame: change + k - 1, u: 0.3, v: 0.5, zoom: 2 }, { frame: change + k, u: 0.7, v: 0.5, zoom: 2 }];
      const path = springPath(samples, 0, change + Math.ceil(settle * fps) + 10, g, s, fps);
      const at = change + Math.ceil(settle * fps);
      expect(Math.abs(path[at]!.u - 0.7) / 0.4, `${fps} fps, settle ${settle}`).toBeLessThanOrEqual(0.02);
      for (let j = 1; j < path.length; j++) { expect(path[j]!.u).toBeLessThanOrEqual(0.7 + 1e-12); expect(path[j]!.u).toBeGreaterThanOrEqual(path[j - 1]!.u - 1e-12); }
    }
  });
  it('a 0.25 Hz sine: amplitude ω²/(ω² + Ω²) within 1 %, and the pose leads the pointer by `lead` within one frame', () => {
    for (const rate of RATES) {
      const fps = rate.num, s = DEFAULT_CAMERA, W = 2 * Math.PI * 0.25, A = 0.2, n = 24 * fps;
      const samples = Array.from({ length: n + 1 }, (_, f) => ({ frame: f, u: 0.5 + A * Math.sin((W * f) / fps), v: 0.5, zoom: 2 }));
      const path = springPath(samples, 0, n, g, s, fps);
      // project frames 4 s … 20 s (four whole periods) on sin and cos
      let a = 0, b = 0, m = 0;
      for (let f = 4 * fps; f < 20 * fps; f++) { const t = f / fps; a += (path[f]!.u - 0.5) * Math.sin(W * t); b += (path[f]!.u - 0.5) * Math.cos(W * t); m++; }
      a *= 2 / m; b *= 2 / m;
      const w = omegaOf(s), amp = Math.hypot(a, b) / A, want = (w * w) / (w * w + W * W);
      expect(Math.abs(amp / want - 1), `${fps} fps amplitude ${amp} vs ${want}`).toBeLessThan(0.01);
      const leadSeconds = Math.atan2(b, a) / W; // > 0: the pose shows the pointer's future
      expect(Math.abs(leadSeconds - s.leadSeconds), `${fps} fps lead ${leadSeconds}`).toBeLessThanOrEqual(1 / fps);
    }
  });
  it('the clamp: every pose keeps its window inside the picture, the zoom in [1, ceiling], for wild pointers in three aspect cases', () => {
    for (const [ci, c] of CASES.entries()) for (const fps of [12, 30, 60]) {
      const g2: CameraGeometry = { frameW: c.frame[0], frameH: c.frame[1], srcW: c.src[0], srcH: c.src[1], fit: c.fit };
      const { fill, maxZoom } = cameraLimits(g2);
      for (const sway of [0, 1]) {
        const path = springPath(wander(ci * 10 + fps + sway, 0, 20 * fps), 0, 20 * fps, g2, { ...DEFAULT_CAMERA, settleSeconds: 0.2, sway }, fps);
        for (const p of path) {
          expect(p.zoom).toBeGreaterThanOrEqual(1 - 1e-12);
          expect(p.zoom).toBeLessThanOrEqual(maxZoom + 1e-12);
          const t = poseToClip(g2, p);
          expect(t.scale).toBeCloseTo(fill * p.zoom, 9);
          expect(covers(g2, t)).toBe(true);
          expect(Math.abs(t.x)).toBeLessThanOrEqual(4 + 1e-12);
          expect(Math.abs(t.y)).toBeLessThanOrEqual(4 + 1e-12);
        }
      }
    }
  });
  it('gaps between samples are interpolated, and before the first / after the last sample the pointer holds', () => {
    const s = { ...DEFAULT_CAMERA, leadSeconds: 0, settleSeconds: 0.01 }; // a very stiff spring follows the target
    const k = shiftOf(s, 30);
    const path = springPath([{ frame: k + 10, u: 0.3, v: 0.5, zoom: 2 }, { frame: k + 20, u: 0.7, v: 0.5, zoom: 2 }], 0, 30, G169, s, 30);
    expect(path[0]!.u).toBeCloseTo(0.3, 9);
    expect(path[15]!.u).toBeCloseTo(0.5, 6);
    expect(path[30]!.u).toBeCloseTo(0.7, 9);
  });
});

describe('handheld sway', () => {
  const samples = Array.from({ length: 301 }, (_, f) => ({ frame: f, u: 0.5, v: 0.5, zoom: 2 }));
  const run = (sway: number, seed: number) => springPath(samples, 0, 300, G169, { ...DEFAULT_CAMERA, sway, seed }, 30);
  it('the same seed gives the same sway, seed + 1 another; sway 0 is still; at most 2 % of the visible window', () => {
    expect(JSON.stringify(run(1, 7))).toBe(JSON.stringify(run(1, 7)));
    expect(JSON.stringify(run(1, 8))).not.toBe(JSON.stringify(run(1, 7)));
    for (const p of run(0, 7)) expect(p).toEqual({ u: 0.5, v: 0.5, zoom: expect.closeTo(2, 12) });
    const window = 0.5; // zoom 2 on a same-shape picture
    let most = 0;
    for (const p of run(1, 7)) most = Math.max(most, Math.abs(p.u - 0.5), Math.abs(p.v - 0.5));
    expect(most).toBeGreaterThan(0.002);
    expect(most).toBeLessThanOrEqual(0.02 * window + 1e-12);
    // half the dial, half the sway
    const half = run(0.5, 7), full = run(1, 7);
    for (let j = 0; j < half.length; j++) expect(half[j]!.u - 0.5).toBeCloseTo((full[j]!.u - 0.5) / 2, 12);
  });
});

describe('simplifyPath', () => {
  const dense = (fn: (j: number) => ClipPose, n: number) => Array.from({ length: n }, (_, j) => fn(j));
  const errorAt = (d: readonly ClipPose[], keep: number[], j: number) => {
    let k = 0;
    while (k + 1 < keep.length && keep[k + 1]! < j) k++;
    const a = keep[k]!, b = keep[Math.min(k + 1, keep.length - 1)]!, t = b > a ? (j - a) / (b - a) : 0;
    const A = d[a]!, B = d[b]!, P = d[j]!;
    return Math.max(Math.abs(A.x + (B.x - A.x) * t - P.x), Math.abs(A.y + (B.y - A.y) * t - P.y), Math.abs(A.scale + (B.scale - A.scale) * t - P.scale) / P.scale / 2);
  };
  it('the sine take: at most 40 key times, residual ≤ 0.005 and equal to the largest error found on any frame', () => {
    const s = DEFAULT_CAMERA, fps = 30, W = 2 * Math.PI * 0.25, n = 4 * fps; // one period of the pointer
    const samples = Array.from({ length: n + 1 }, (_, f) => ({ frame: f, u: 0.5 + 0.2 * Math.sin((W * f) / fps), v: 0.5 + 0.1 * Math.cos((W * f) / fps), zoom: 2 + 0.5 * Math.sin((W * f) / fps) }));
    const d = springPath(samples, 0, n, G169, s, fps).map((p) => poseToClip(G169, p));
    const r = simplifyPath(d, CAMERA_TOLERANCE, MAX_CAMERA_KEYS);
    expect(r.keep.length).toBeLessThanOrEqual(40);
    expect(r.keep[0]).toBe(0);
    expect(r.keep.at(-1)).toBe(n);
    expect(r.residual).toBeLessThanOrEqual(CAMERA_TOLERANCE);
    let worst = 0;
    for (let j = 0; j < n; j++) worst = Math.max(worst, errorAt(d, r.keep, j));
    expect(worst).toBeCloseTo(r.residual, 12);
  });
  it('stops at maxKeys and reports the residual left; the error counts half the relative scale change', () => {
    const d = dense((j) => ({ x: 0.3 * Math.sin(j / 5), y: 0, scale: 1 }), 400);
    const r = simplifyPath(d, CAMERA_TOLERANCE, 6);
    expect(r.keep.length).toBe(6);
    expect(r.residual).toBeGreaterThan(CAMERA_TOLERANCE);
    // a bump in scale alone: 2 % up is an error of |ΔS/S|/2 with S the dense value
    const b = simplifyPath(dense((j) => ({ x: 0, y: 0, scale: j === 5 ? 1.02 : 1 }), 11), 1, 2);
    expect(b.residual).toBeCloseTo(0.02 / 1.02 / 2, 12);
  });
  it('largest error first, ties to the earliest frame; straight lines need two keys; one frame needs one', () => {
    // two equal bumps: the first split is the earlier one
    const d = dense((j) => ({ x: j === 3 || j === 7 ? 0.1 : 0, y: 0, scale: 1 }), 11);
    expect(simplifyPath(d, 0, 3).keep).toEqual([0, 3, 10]);
    // a bigger bump later goes first
    const e = dense((j) => ({ x: j === 3 ? 0.1 : j === 7 ? 0.2 : 0, y: 0, scale: 1 }), 11);
    expect(simplifyPath(e, 0, 3).keep).toEqual([0, 7, 10]);
    expect(simplifyPath(dense((j) => ({ x: j / 100, y: -j / 50, scale: 1 + j / 10 }), 50), 1e-9, 600)).toEqual({ keep: [0, 49], residual: expect.any(Number) });
    expect(simplifyPath([{ x: 0, y: 0, scale: 1 }], CAMERA_TOLERANCE, 600)).toEqual({ keep: [0], residual: 0 });
  });
});

describe('planCamera: keys, the cover on every frame, the partial retake', () => {
  it('on every frame of the applied clip, dense and interpolated, the picture covers the frame (rounded keys, three aspect cases)', () => {
    for (const [ci, c] of CASES.entries()) for (const image of [false, true]) {
      const p = project({ frame: c.frame, src: c.src, fit: c.fit, frames: 450, image });
      const g = geometryOf(p.doc, p.clipId);
      const r = plan(p.doc, { clipId: p.clipId, from: 0, to: 449, samples: wander(100 + ci, 0, 449), settings: { ...DEFAULT_CAMERA, settleSeconds: 0.25, sway: 0.7, seed: ci } });
      expect(r.ops.map((o) => [o.op, (o.args as { property: string }).property])).toEqual([['replace_clip_keyframes', 'x'], ['replace_clip_keyframes', 'y'], ['replace_clip_keyframes', 'scale']]);
      for (const k of r.keys) expect(covers(g, k), `${c.name} key ${k.frame}`).toBe(true);
      const after = tx(p.doc, r.ops).doc;
      expect(validateProject(after)).toEqual([]);
      const clip = clipOf(after, p.clipId);
      for (let j = 0; j < 450; j++) {
        const t = transformAt(clip, T.add(clip.start, T.frameTime(j, R30)));
        expect(covers(g, t), `${c.name} frame ${j}`).toBe(true);
      }
      // the residual is measured on the rounded keys against the dense path
      expect(r.residual).toBeLessThanOrEqual(CAMERA_TOLERANCE);
      expect(r.overTolerance).toBe(false);
    }
  });
  it('the zoom ceiling keeps |x| and |y| at most 4 (16:9 in 9:16, pointer in the corners at zoom 10), and the schema takes the keys', () => {
    const p = project({ frame: [1080, 1920], src: [1920, 1080], fit: 'cover', frames: 240 });
    const samples = Array.from({ length: 240 }, (_, f) => ({ frame: f, u: f < 120 ? -1 : 2, v: f < 120 ? 2 : -1, zoom: 10 }));
    const r = plan(p.doc, { clipId: p.clipId, from: 0, to: 239, samples, settings: DEFAULT_CAMERA });
    const xs = r.keys.map((k) => Math.abs(k.x));
    expect(Math.max(...xs)).toBeGreaterThan(3.99);
    for (const k of r.keys) { expect(Math.abs(k.x)).toBeLessThanOrEqual(4); expect(Math.abs(k.y)).toBeLessThanOrEqual(4); expect(k.scale).toBeLessThanOrEqual(20); }
    expect(() => tx(p.doc, r.ops)).not.toThrow();
  });
  it('rounding: scale up to 1e-4, x and y toward zero to 1e-5', () => {
    const p = project({ frames: 120 });
    const r = plan(p.doc, { clipId: p.clipId, from: 0, to: 119, samples: wander(9, 0, 119), settings: DEFAULT_CAMERA });
    const g = geometryOf(p.doc, p.clipId);
    const dense = springPath(wander(9, 0, 119), 0, 119, g, DEFAULT_CAMERA, 30).map((q) => poseToClip(g, q));
    for (const k of r.keys) {
      const d = dense[k.frame]!;
      expect(Math.abs(k.x * 1e5 - Math.round(k.x * 1e5))).toBeLessThan(1e-6);
      expect(Math.abs(k.scale * 1e4 - Math.round(k.scale * 1e4))).toBeLessThan(1e-6);
      expect(k.scale).toBeGreaterThanOrEqual(d.scale - 1e-9);
      expect(Math.abs(k.x)).toBeLessThanOrEqual(Math.abs(d.x) + 1e-12);
      expect(Math.abs(k.y)).toBeLessThanOrEqual(Math.abs(d.y) + 1e-12);
      expect(Math.abs(k.x - d.x)).toBeLessThanOrEqual(1e-5 + 1e-12);
      expect(Object.is(k.x, -0) || Object.is(k.y, -0)).toBe(false);
    }
  });
  it('the ops applied with applyTransaction reproduce the keys through sampleKeyframes; one transaction; identical input gives byte-identical ops', () => {
    const p = project({ frames: 300 });
    const input = { clipId: p.clipId, from: 0, to: 299, samples: wander(5, 0, 299), settings: { ...DEFAULT_CAMERA, sway: 0.5, seed: 3 } };
    const r = plan(p.doc, input);
    expect(JSON.stringify(planCamera(structuredClone(p.doc), structuredClone(input)))).toBe(JSON.stringify(r));
    const after = tx(p.doc, r.ops);
    expect(after.results).toHaveLength(3);
    const clip = clipOf(after.doc, p.clipId);
    for (const prop of ['x', 'y', 'scale'] as const) {
      expect(clip.keyframes![prop]!.map((k) => [k.time, k.easing])).toEqual(r.keys.map((k) => [T.frameTime(k.frame, R30), 'linear']));
      for (const k of r.keys) expect(sampleKeyframes(clip.keyframes![prop]!, T.frameTime(k.frame, R30), TRANSFORM_RANGE[prop])).toBe(k[prop]);
    }
    expect(r.range).toEqual({ from: T.frameTime(0, R30), to: T.frameTime(299, R30) });
    expect(r.replacedKeys).toBe(0);
  });
  it('a partial retake: only keys inside [from, to] go (counted), keys outside stay; a second take of the same input is stable', () => {
    const p = project({ frames: 300 });
    const first = tx(p.doc, plan(p.doc, { clipId: p.clipId, from: 0, to: 299, samples: wander(1, 0, 299), settings: DEFAULT_CAMERA }).ops).doc;
    const before = clipOf(first, p.clipId).keyframes!;
    const lo = T.frameTime(100, R30), hi = T.frameTime(199, R30);
    const inside = (t: T.RationalTime) => T.lte(lo, t) && T.lte(t, hi);
    const r = plan(first, { clipId: p.clipId, from: 100, to: 199, samples: wander(2, 100, 199), settings: DEFAULT_CAMERA });
    expect(r.replacedKeys).toBe((['x', 'y', 'scale'] as const).reduce((n, q) => n + before[q]!.filter((k) => inside(k.time)).length, 0));
    expect(r.keys[0]!.frame).toBe(100);
    expect(r.keys.at(-1)!.frame).toBe(199);
    const after = clipOf(tx(first, r.ops).doc, p.clipId).keyframes!;
    for (const q of ['x', 'y', 'scale'] as const) {
      expect(after[q]!.filter((k) => !inside(k.time))).toEqual(before[q]!.filter((k) => !inside(k.time)));
      expect(after[q]!.filter((k) => inside(k.time)).map((k) => k.value)).toEqual(r.keys.map((k) => k[q]));
    }
  });
  it('samples are TIMELINE frames: a clip starting at frame 60 reads the samples 60 frames later; samples outside the range are ignored', () => {
    const a = project({ frames: 200 }), b = project({ frames: 200, startFrame: 60 });
    const samples = wander(4, 0, 199);
    const ra = plan(a.doc, { clipId: a.clipId, from: 20, to: 150, samples, settings: DEFAULT_CAMERA });
    const shifted = samples.map((x) => ({ ...x, frame: x.frame + 60 }));
    const rb = plan(b.doc, { clipId: b.clipId, from: 20, to: 150, samples: [...shifted, { frame: 10, u: 0, v: 0, zoom: 4 }, { frame: 300, u: 1, v: 1, zoom: 4 }], settings: DEFAULT_CAMERA });
    // the sway is read at timeline time, and is off here, so the two plans are the same keys
    expect(rb.keys).toEqual(ra.keys);
    // the range is clamped to the clip's frames
    const rc = plan(a.doc, { clipId: a.clipId, from: -50, to: 5000, samples, settings: DEFAULT_CAMERA });
    expect([rc.keys[0]!.frame, rc.keys.at(-1)!.frame]).toEqual([0, 199]);
  });
  it('a long, restless take at the key cap is planned with overTolerance and its residual, never trimmed silently', () => {
    const n = 3600; // two minutes at 30 fps
    const p = project({ frames: n });
    const rnd = mulberry32(77);
    const samples = Array.from({ length: n }, (_, f) => ({ frame: f, u: 0.2 + 0.6 * rnd(), v: 0.2 + 0.6 * rnd(), zoom: 1.5 + rnd() * 2 })).filter((_, f) => f % 4 === 0);
    const r = plan(p.doc, { clipId: p.clipId, from: 0, to: n - 1, samples, settings: { ...DEFAULT_CAMERA, settleSeconds: 0.05 } });
    expect(r.keys).toHaveLength(MAX_CAMERA_KEYS);
    expect(r.overTolerance).toBe(true);
    expect(r.residual).toBeGreaterThan(CAMERA_TOLERANCE);
    expect(() => tx(p.doc, r.ops)).not.toThrow(); // the plan is real; the editor withholds accept
  });
  it('privacy regions are kept (they follow the source), and a linked format without its own framing warns linked_formats', () => {
    const p = project({ frames: 120 });
    let doc = tx(p.doc, [{ op: 'set_redact_region', args: { clipId: p.clipId, region: { shape: 'rect', x: 0.1, y: 0.1 } } }]).doc;
    const regions = (clipOf(doc, p.clipId) as MediaClip).redact;
    expect(regions).toHaveLength(1);
    const r = plan(doc, { clipId: p.clipId, from: 0, to: 119, samples: wander(6, 0, 119), settings: DEFAULT_CAMERA });
    expect(r.warnings).toEqual([]);
    expect((clipOf(tx(doc, r.ops).doc, p.clipId) as MediaClip).redact).toEqual(regions);
    const v = tx(doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]);
    doc = v.doc;
    const variantId = (v.results[0]!.output as { variantId: string }).variantId;
    expect(plan(doc, { clipId: p.clipId, from: 0, to: 119, samples: wander(6, 0, 119), settings: DEFAULT_CAMERA }).warnings).toEqual(['linked_formats']);
    const x = tx(doc, [{ op: 'set_variant_override', args: { variantId, clipId: p.clipId, transform: { x: 0, scale: 1 } } }]).doc;
    expect(plan(x, { clipId: p.clipId, from: 0, to: 119, samples: wander(6, 0, 119), settings: DEFAULT_CAMERA }).warnings).toEqual(['linked_formats']);
    const full = tx(doc, [{ op: 'set_variant_override', args: { variantId, clipId: p.clipId, transform: { x: 0, y: 0, scale: 1 } } }]).doc;
    expect(plan(full, { clipId: p.clipId, from: 0, to: 119, samples: wander(6, 0, 119), settings: DEFAULT_CAMERA }).warnings).toEqual([]);
  });
});

describe('planCamera refusals (each one)', () => {
  const samples = wander(11, 0, 119);
  const ask = (doc: ProjectDocument, clipId: string, over: Partial<Parameters<typeof planCamera>[1]> = {}) => planCamera(doc, { clipId, from: 0, to: 119, samples, settings: DEFAULT_CAMERA, ...over });
  const seen = new Set<CameraRefusal>();
  const expectRefused = (r: ReturnType<typeof planCamera>, why: CameraRefusal) => { expect(r).toEqual({ refused: why }); seen.add(why); };
  it('not_picture: a title, a sound clip, an unknown clip', () => {
    const p = project({ frames: 120 });
    const t = tx(p.doc, [{ op: 'add_text', args: { text: 'כותרת', start: T.ZERO, duration: T.frameTime(60, R30) } }]);
    expectRefused(ask(t.doc, (t.results[0]!.output as { clipId: string }).clipId), 'not_picture');
    const audio = t.doc.sequences[t.doc.mainSequenceId]!.tracks.find((x) => x.kind === 'audio')!.clips[0]!;
    expect(audio.type).toBe('media');
    expectRefused(ask(t.doc, audio.id), 'not_picture');
    expectRefused(ask(p.doc, 'clp_nope'), 'not_picture');
  });
  it('adjustment', () => {
    const p = project({ frames: 120 });
    const a = tx(p.doc, [{ op: 'add_adjustment', args: { span: { start: T.ZERO, duration: T.frameTime(60, R30) }, effects: [{ type: 'color.grayscale' }] } }]);
    const id = Object.values(a.doc.sequences[a.doc.mainSequenceId]!.tracks).flatMap((x) => x.clips).find((c) => c.type === 'adjustment')!.id;
    expectRefused(ask(a.doc, id), 'adjustment');
  });
  it('locked, rotated (value or keys), follows_track', () => {
    const p = project({ frames: 120 });
    expectRefused(ask(tx(p.doc, [{ op: 'update_track', args: { trackId: p.trackId, locked: true } }]).doc, p.clipId), 'locked');
    expectRefused(ask(tx(p.doc, [{ op: 'set_clip_transform', args: { clipId: p.clipId, transform: { rotation: 5 } } }]).doc, p.clipId), 'rotated');
    expectRefused(ask(tx(p.doc, [{ op: 'replace_clip_keyframes', args: { clipId: p.clipId, property: 'rotation', keys: [{ time: T.ZERO, value: 0, easing: 'linear' }] } }]).doc, p.clipId), 'rotated');
    const f = structuredClone(p.doc);
    (clipOf(f, p.clipId) as MediaClip).follow = { motionTrackId: 'mt_x', targetTrackId: 'tt_x', scale: false, smooth: 0 } as unknown as MediaClip['follow'];
    expectRefused(ask(f, p.clipId), 'follows_track');
  });
  it('no_room: a 13:1 strip cannot cover a 9:16 frame within |x| ≤ 4', () => {
    const p = project({ frame: [1080, 1920], src: [4000, 300], fit: 'cover', frames: 120, image: true });
    expect(cameraLimits(geometryOf(p.doc, p.clipId)).maxZoom).toBeLessThan(1);
    expectRefused(ask(p.doc, p.clipId), 'no_room');
  });
  it('no_samples: none in the range, or a range outside the clip', () => {
    const p = project({ frames: 120 });
    expectRefused(ask(p.doc, p.clipId, { samples: [] }), 'no_samples');
    expectRefused(ask(p.doc, p.clipId, { samples: [{ frame: 500, u: 0.5, v: 0.5, zoom: 1 }] }), 'no_samples');
    expectRefused(ask(p.doc, p.clipId, { samples: [{ frame: 10, u: Number.NaN, v: 0.5, zoom: 1 }] }), 'no_samples');
    expectRefused(ask(p.doc, p.clipId, { from: 200, to: 300 }), 'no_samples');
  });
  it('not_full_frame: a picture in picture (scale below its own fit), static or keyed inside the range', () => {
    const p = project({ frames: 120 });
    expectRefused(ask(tx(p.doc, [{ op: 'set_clip_transform', args: { clipId: p.clipId, transform: { scale: 0.5 } } }]).doc, p.clipId), 'not_full_frame');
    const keyed = tx(p.doc, [{ op: 'replace_clip_keyframes', args: { clipId: p.clipId, property: 'scale', keys: [{ time: T.frameTime(50, R30), value: 1, easing: 'linear' }, { time: T.frameTime(100, R30), value: 0.4, easing: 'linear' }] } }]).doc;
    expectRefused(ask(keyed, p.clipId), 'not_full_frame');
    expect(isPlan(ask(keyed, p.clipId, { to: 10 }))).toBe(true); // the shrink starts after a short range: still over 1 there
  });
  it('too_many_keys: kept keys outside the range plus the new ones would pass 2000', () => {
    const p = project({ frames: 2100 });
    const keys = Array.from({ length: 2000 }, (_, j) => ({ time: T.frameTime(j, R30), value: 0, easing: 'linear' as const }));
    const d = tx(p.doc, [{ op: 'replace_clip_keyframes', args: { clipId: p.clipId, property: 'x', keys } }]).doc;
    expectRefused(ask(d, p.clipId, { from: 2010, to: 2090, samples: wander(12, 2010, 2090) }), 'too_many_keys');
    // the same take over keys it replaces is fine
    expect(isPlan(ask(d, p.clipId, { from: 1900, to: 2090, samples: wander(12, 1900, 2090) }))).toBe(true);
  });
  it('every refusal of CAMERA_REFUSALS is covered above', () => {
    expect([...seen].sort()).toEqual([...CAMERA_REFUSALS].sort());
  });
});

it('fitScale agrees with the geometry the camera uses (guard for the fill formula)', () => {
  for (const c of CASES) {
    const k = fitScale(c.frame[0], c.frame[1], c.src[0], c.src[1], c.fit);
    const fill = Math.max(c.frame[0] / (c.src[0] * k), c.frame[1] / (c.src[1] * k));
    expect(cameraLimits({ frameW: c.frame[0], frameH: c.frame[1], srcW: c.src[0], srcH: c.src[1], fit: c.fit }).fill).toBeCloseTo(fill, 12);
  }
});
