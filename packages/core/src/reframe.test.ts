/**
 * planReframe (ADR-0018, plan §4.5): 500 seeded random subject paths reframed from 1920×1080 into 1080×1920 at framing 1 and
 * 1.3. At every frame the keyed x keeps the frame covered, moves at most maxSpeed per second, and stays within ε of the
 * per-frame camera path. Plus the dead zone, held frames, the key cap, backdropScale, and reframeOps on a short.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, backdropScale, cameraPath, coverLimit, createProject, fitScale, placed, planReframe, REFRAME_DEFAULTS, reframeOps, sampleKeyframes, ShortsError, sourceToFrame, TRACK_UNIT,
  type OpCall, type ProjectDocument, type ReframeInput, type ReframeSample,
} from './index.ts';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const RATES = [{ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 50, den: 1 }, { num: 60, den: 1 }];
const FRAME = { width: 1080, height: 1920 }, SRC = { width: 1920, height: 1080 };

/** A subject wandering across the picture: smooth drift, sudden jumps, jitter and lost stretches. */
function subject(seed: number, n: number): ReframeSample[] {
  const rnd = mulberry32(seed);
  let u = 0.2 + rnd() * 0.6, v = 0, lost = 0;
  return Array.from({ length: n }, () => {
    if (lost > 0) { lost--; return { u: null, conf: 0 }; }
    if (rnd() < 0.01) lost = 1 + Math.floor(rnd() * 40);
    if (rnd() < 0.01) u = rnd(); // a cut-like jump
    v = v * 0.9 + (rnd() - 0.5) * 0.004;
    u = Math.min(1, Math.max(0, u + v + (rnd() - 0.5) * 0.01));
    return { u, conf: 0.9 };
  });
}
const valueAt = (r: { x: number; keys: { time: T.RationalTime; value: number; easing: 'linear' | 'hold' | 'ease-in' | 'ease-out' | 'ease-in-out' }[] | null }, j: number, rate: { num: number; den: number }) => (r.keys ? sampleKeyframes(r.keys, T.frameTime(j, rate)) : r.x);

describe('planReframe: 500 random subject paths, 1920×1080 into 1080×1920', () => {
  it('coverage, speed limit, ε bound, whole-frame linear keys and the key cap hold at every frame', () => {
    let moving = 0;
    const bad: string[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const rate = RATES[seed % RATES.length]!, fps = rate.num / rate.den;
      const framing = seed % 2 ? 1 : 1.3;
      const n = 30 + Math.floor(mulberry32(seed * 7)() * 900);
      const input: ReframeInput = { frame: FRAME, source: SRC, framing, rate, samples: subject(seed, n) };
      const r = planReframe(input);
      const { path } = cameraPath(input);
      const limit = coverLimit(FRAME.width, SRC.width, fitScale(FRAME.width, FRAME.height, SRC.width, SRC.height, 'cover'), framing);
      expect(r.limit).toBeCloseTo(limit, 12);
      if (r.keys) {
        moving++;
        expect(r.keys.length).toBeLessThanOrEqual(REFRAME_DEFAULTS.maxKeys);
        expect(r.keys[0]!.value).toBe(r.x);
        for (const [i, k] of r.keys.entries()) {
          expect(T.isFrameAligned(k.time, rate)).toBe(true);
          expect(k.easing).toBe('linear');
          if (i) expect(T.lt(r.keys[i - 1]!.time, k.time)).toBe(true);
        }
        expect(T.eq(r.keys.at(-1)!.time, T.frameTime(n - 1, rate))).toBe(true);
      }
      // per-frame checks counted, not asserted one by one (500 paths × up to 930 frames)
      let prev = valueAt(r, 0, rate);
      for (let j = 0; j < n; j++) {
        const x = valueAt(r, j, rate);
        if (Math.abs(x) > limit + 1e-9) bad.push(`seed ${seed} frame ${j}: |x| ${x} over the clamp ${limit}`);
        if (j && Math.abs(x - prev) > REFRAME_DEFAULTS.maxSpeed / fps + 1e-9) bad.push(`seed ${seed} frame ${j}: moved ${x - prev}`);
        if (Math.abs(x - path[j]!) > r.epsilon + 1e-9) bad.push(`seed ${seed} frame ${j}: ${x} is ${x - path[j]!} off the path`);
        // the four source corners lie outside or on the frame: no uncovered edge
        const p = placed(FRAME.width, FRAME.height, 'cover', SRC.width, SRC.height, { x, y: 0, scale: framing, rotation: 0 });
        const corners = [sourceToFrame(p, 0, 0), sourceToFrame(p, 1, 0), sourceToFrame(p, 0, 1), sourceToFrame(p, 1, 1)];
        const minX = Math.min(...corners.map((c) => c.px)), maxX = Math.max(...corners.map((c) => c.px)), minY = Math.min(...corners.map((c) => c.py)), maxY = Math.max(...corners.map((c) => c.py));
        if (minX > 1e-6 || minY > 1e-6 || maxX < FRAME.width - 1e-6 || maxY < FRAME.height - 1e-6) bad.push(`seed ${seed} frame ${j}: an edge of the frame is uncovered`);
        prev = x;
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(moving).toBeGreaterThan(400); // most random subjects do make the camera move
  }, 120_000);
  it('jitter inside the dead zone gives no keys and a static x', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const rnd = mulberry32(seed);
      const centre = 0.3 + rnd() * 0.4;
      const samples = Array.from({ length: 300 }, () => ({ u: centre + (rnd() - 0.5) * 0.016, conf: 1 }));
      for (const framing of [1, 1.3]) {
        const r = planReframe({ frame: FRAME, source: SRC, framing, rate: { num: 30, den: 1 }, samples });
        expect(r.keys).toBeNull();
        expect(Math.abs(r.x)).toBeLessThanOrEqual(r.limit + 1e-12);
      }
    }
  });
  it('the centre gives x = 0 and no keys', () => {
    const r = planReframe({ frame: FRAME, source: SRC, framing: 1, rate: { num: 25, den: 1 }, samples: Array.from({ length: 100 }, () => ({ u: 0.5, conf: 1 })) });
    expect(r).toMatchObject({ x: 0, keys: null, heldFrames: 0 });
  });
  it('unusable samples hold the last value and count as held', () => {
    const rate = { num: 30, den: 1 }, fps = 30;
    const r = Math.round(REFRAME_DEFAULTS.smoothSeconds * fps);
    const samples: ReframeSample[] = Array.from({ length: 400 }, (_, j) => (j < 100 ? { u: 0.1 + j * 0.006, conf: 1 } : { u: null, conf: 0 }));
    const { path, heldFrames } = cameraPath({ frame: FRAME, source: SRC, framing: 1, rate, samples });
    // frame j still sees a usable sample while j − r ≤ 99
    for (let j = 100 + r; j < 400; j++) expect(path[j]).toBe(path[j - 1]);
    expect(heldFrames).toBe(400 - (100 + r));
    expect(planReframe({ frame: FRAME, source: SRC, framing: 1, rate, samples }).heldFrames).toBe(heldFrames);
    // no usable sample at all: the centre, held throughout
    expect(planReframe({ frame: FRAME, source: SRC, framing: 1, rate, samples: Array.from({ length: 50 }, () => ({ u: null, conf: 0 })) })).toMatchObject({ x: 0, keys: null, heldFrames: 50 });
  });
  it('ε doubles until at most 2000 keys, and the reported ε bounds the deviation', () => {
    const rate = { num: 60, den: 1 };
    const samples = Array.from({ length: 30000 }, (_, j) => ({ u: Math.floor(j / 7) % 2 ? 0.05 : 0.95, conf: 1 }));
    const input: ReframeInput = { frame: FRAME, source: SRC, framing: 1.3, rate, samples, smoothSeconds: 0 };
    const r = planReframe(input);
    expect(r.keys!.length).toBeLessThanOrEqual(2000);
    expect(r.epsilon).toBeGreaterThan(REFRAME_DEFAULTS.epsilon);
    expect(Math.log2(r.epsilon / REFRAME_DEFAULTS.epsilon) % 1).toBe(0);
    const { path } = cameraPath(input);
    for (let j = 0; j < samples.length; j += 13) expect(Math.abs(valueAt(r, j, rate) - path[j]!)).toBeLessThanOrEqual(r.epsilon + 1e-9);
  });
  it('backdropScale(1080×1920, 1920×1080) === 0.31640625; coverLimit', () => {
    expect(backdropScale(FRAME, SRC)).toBe(0.31640625);
    expect(backdropScale({ width: 1920, height: 1080 }, SRC)).toBe(1);
    expect(coverLimit(1080, 1920, 1920 / 1080, 1)).toBeCloseTo((1920 * (1920 / 1080) / 1080 - 1) / 2, 12);
    expect(coverLimit(1920, 1920, 1, 1)).toBe(0);
  });
});

describe('reframeOps', () => {
  const R = { num: 30, den: 1 };
  const f = (k: number) => T.frameTime(k, R);
  const tx = (doc: ProjectDocument, ops: OpCall[], seed: string) => applyTransaction(doc, ops, { idSeed: seed, actor: 'test', allowInternal: true });
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
  const VIDEO = { kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 1920, height: 1080, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
  function short() {
    let doc = tx(createProject({ id: 'prj_rf', name: 'R', width: 1920, height: 1080, frameRate: R }), [{ op: 'import_asset', args: { asset: VIDEO } }], 'a_').doc;
    const asset = Object.keys(doc.assets)[0]!;
    const s = tx(doc, [{ op: 'add_sequence', args: { name: 'S', format: { width: 720, height: 1280, fit: 'cover', profileId: null, safeArea: null } } }], 'b_');
    const seqId = (s.results[0]!.output as { sequenceId: string }).sequenceId;
    const v = (s.results[0]!.output as { videoTrackId: string }).videoTrackId;
    const c = tx(s.doc, [{ op: 'add_clip', args: { sequenceId: seqId, assetId: asset, trackId: v, start: f(0), sourceIn: f(30), duration: f(120) } }, { op: 'create_motion_track', args: { assetId: asset, kind: 'point', frame: 0, x: 2000, y: 5000, name: 'subject' } }], 'c_');
    doc = c.doc;
    const mt = Object.keys(doc.motionTracks)[0]!;
    // measured samples: the subject walks from the left third to the right third across source frames 1..299
    const k = 299;
    doc = tx(doc, [{ op: 'attach_motion_track', args: { motionTrackId: mt, from: 1, x: Array.from({ length: k }, (_, i) => 2000 + i * 20), y: Array.from({ length: k }, () => 5000), q: Array.from({ length: k }, () => 90), st: Array.from({ length: k }, () => 1), method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z' } }], 'd_').doc;
    return { doc, seqId, clipId: (c.results[0]!.output as { clipId: string }).clipId, mt, asset };
  }
  it('a motion track gives x keys that apply cleanly and follow the subject', () => {
    const { doc, seqId, clipId, mt } = short();
    const r = reframeOps(doc, seqId, { source: 'auto', motionTrackId: mt, framing: 1 });
    expect(r.shots).toEqual([{ clipId, source: 'track', keys: expect.any(Number), heldFrames: 0 }]);
    expect(r.ops[0]!.op).toBe('replace_clip_keyframes');
    const applied = tx(doc, r.ops, 'e_').doc;
    const clip = applied.sequences[seqId]!.tracks[0]!.clips[0]!;
    const xs = clip.keyframes!.x!;
    expect(xs[0]!.value).toBeGreaterThan(0); // subject left of centre: the picture moves right
    expect(xs.at(-1)!.value).toBeLessThan(xs[0]!.value);
    // the clip starts at source frame 30, where the subject is at u = (2000 + 29·20) / TRACK_UNIT = 0.258: the start value is
    // the median target of the first half second, near −(0.258 − ½)·k with k = 1920·(1280/1080)/720
    const k = (1920 * (1280 / 1080)) / 720, u0 = (2000 + 29 * 20) / TRACK_UNIT;
    expect(xs[0]!.value).toBeGreaterThan(-(u0 + 0.1 - 0.5) * k);
    expect(xs[0]!.value).toBeLessThanOrEqual(-(u0 - 0.5) * k + 1e-9);
  });
  it('the centre gives a static x and the framing scale; the refusals are honest', () => {
    const { doc, seqId, clipId, mt } = short();
    const r = reframeOps(doc, seqId, { source: 'centre', framing: 1.2 });
    expect(r.ops).toEqual([{ op: 'set_clip_transform', args: { clipId, transform: { x: 0, scale: 1.2 } } }]);
    const err = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof ShortsError) return e; throw e; } throw new Error('not refused'); };
    expect(err(() => reframeOps(doc, 'seq_none', { source: 'centre', framing: 1 })).code).toBe('not_found');
    expect(err(() => reframeOps(doc, seqId, { source: 'track', framing: 1 })).code).toBe('not_found');
    const turned = tx(doc, [{ op: 'set_clip_transform', args: { clipId, transform: { rotation: 10 } } }], 'f_').doc;
    expect(err(() => reframeOps(turned, seqId, { source: 'track', motionTrackId: mt, framing: 1 })).code).toBe('tracking_not_available');
  });
});
