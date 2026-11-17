/**
 * Motion tracking in the evaluator (ADR-0015). The key property, over 200 seeded random documents: a follower reads the
 * sample of exactly the source frame the target picture shows, and lands exactly where that tracked point is drawn, through
 * every kind of edit (trims, cuts, speed, ramps, reverse, slips, freeze frames, stutter, echo, transition handles) and in
 * contain, cover and a linked 9:16 format. The expected position is worked out here from the placement rules written out
 * on their own (not through core geometry.ts), and the expected sample from the track's arrays.
 * Privacy regions: present on every picture (the layer, each echo tap, the outgoing side of a transition), each resolved at
 * that picture's own source frame, and covering the whole picture exactly on the frames the loss filter marks.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, createProject, findClip, lossFlags, projectVariant, ST,
  type MediaClip, type MotionTrack, type OpCall, type ProjectDocument, type RedactRegion, type ResolvedRegion,
} from '@pulseframe/core';
import { describeMoment, evaluate, type Layer, type RenderGraph, type TextLayer, type VideoLayer } from './index.ts';

function mulberry32(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const SRC = { num: 30, den: 1 };
const prov = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
const videoAsset = (hash: string, width: number, height: number) => ({ kind: 'video' as const, name: `${hash}.mp4`, contentHash: `sha256:${hash.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.frameTime(240, SRC), video: { width, height, frameRate: SRC, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: prov });

const EDITS = ['trim-start', 'trim-end', 'split', 'speed-half', 'speed-2', 'ramp', 'reverse', 'slip', 'freeze', 'stutter', 'transition', 'echo'] as const;
const FORMATS = ['contain', 'cover', '9:16'] as const;
type Edit = (typeof EDITS)[number];

/** A random document: a target clip of file A on V1 (with a privacy region on a track of A and a fixed one), a title following that track, one edit and one format. */
function build(seed: number) {
  const rnd = mulberry32(seed * 7919 + 13);
  const int = (n: number) => Math.floor(rnd() * n);
  const num = (lo: number, hi: number) => Number((lo + rnd() * (hi - lo)).toFixed(4));
  const edit: Edit = EDITS[seed % EDITS.length]!, format = FORMATS[Math.floor(seed / EDITS.length) % FORMATS.length]!;
  const rate = [{ num: 30, den: 1 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }][seed % 3]!;
  const f = (k: number) => T.frameTime(k, rate);
  let k = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(doc, ops, { idSeed: `s${seed}_${k++}_`, actor: 'test', allowInternal: internal });
  const [w, h] = ([[1280, 720], [720, 1280], [640, 480]] as const)[int(3)]!;
  let r = tx(createProject({ id: 'prj_f', name: 'F', width: 1920, height: 1080, frameRate: rate }), [{ op: 'import_asset', args: { asset: videoAsset('a', w, h) } }, { op: 'import_asset', args: { asset: videoAsset('b', 640, 360) } }], true);
  const A = r.results[0]!.output!.assetId as string, B = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: A, start: f(0), sourceIn: T.frameTime(30, SRC), duration: f(90) } }, { op: 'add_text', args: { text: 'מעקב', start: f(0), duration: f(150) } }]);
  const clip = r.results[0]!.output!.clipId as string, V1 = r.results[0]!.output!.trackId as string, title = r.results[1]!.output!.clipId as string;
  // a region track on A: a manual seed, then measured samples with stretches of every state
  const from = int(30), len = 150 + int(240 - from - 150 + 1);
  r = tx(r.doc, [{ op: 'create_motion_track', args: { assetId: A, kind: 'region', frame: from, x: 5000, y: 5000, w: 500 + int(3000), h: 500 + int(3000) } }]);
  const mtk = r.results[0]!.output!.motionTrackId as string;
  const xs: number[] = [], ys: number[] = [], ss: number[] = [], qs: number[] = [], sts: number[] = [];
  let x = 2000 + int(6000), y = 2000 + int(6000), s = 1000;
  while (xs.length < len - 1) {
    const state = rnd() < 0.7 ? ST.tracked : [ST.unknown, ST.weak, ST.lost, ST.interpolated, ST.reacquired][int(5)]!;
    for (let run = 1 + int(rnd() < 0.5 ? 3 : 25); run > 0 && xs.length < len - 1; run--) {
      x = Math.max(-4000, Math.min(14000, x + int(301) - 150)); y = Math.max(-4000, Math.min(14000, y + int(301) - 150)); s = Math.max(500, Math.min(2000, s + int(41) - 20));
      xs.push(x); ys.push(y); ss.push(s); qs.push(int(101)); sts.push(state);
    }
  }
  if (xs.length) r = tx(r.doc, [{ op: 'attach_motion_track', args: { motionTrackId: mtk, from: from + 1, x: xs, y: ys, s: ss, q: qs, st: sts, method: 'test', params: {}, createdAt: 'test' } }], true);
  const weakIsLost = rnd() < 0.5;
  const scale = rnd() < 0.6;
  r = tx(r.doc, [
    { op: 'set_clip_transform', args: { clipId: clip, transform: { x: num(-0.2, 0.2), y: num(-0.2, 0.2), scale: num(0.6, 1.6), rotation: num(-35, 35) } } },
    { op: 'set_clip_transform', args: { clipId: title, transform: { x: num(-0.2, 0.2), y: num(-0.2, 0.2), scale: num(0.5, 2), rotation: num(-20, 20) } } },
    { op: 'set_redact_region', args: { clipId: clip, region: { motionTrackId: mtk, x: num(-0.05, 0.05), y: num(-0.05, 0.05), weakIsLost, style: (['blur', 'pixelate', 'fill'] as const)[int(3)] } } },
    { op: 'set_redact_region', args: { clipId: clip, region: { motionTrackId: null, shape: 'rect', x: 0.3, y: 0.3, width: 0.1, height: 0.2, onLoss: 'hold' } } },
    { op: 'set_clip_follow', args: { clipId: title, follow: { motionTrackId: mtk, targetTrackId: V1, scale, smooth: rnd() < 0.5 ? 0 : 1 + int(4) } } },
  ]);
  let doc = r.doc;
  const ops: Record<Edit, () => OpCall[]> = {
    'trim-start': () => [{ op: 'trim_clip', args: { clipId: clip, edge: 'start', to: f(5 + int(30)) } }],
    'trim-end': () => [{ op: 'trim_clip', args: { clipId: clip, edge: 'end', to: f(40 + int(40)) } }],
    split: () => [{ op: 'split_clip', args: { clipId: clip, at: f(20 + int(50)) } }],
    'speed-half': () => [{ op: 'set_clip_speed', args: { clipId: clip, speed: 0.5 } }],
    'speed-2': () => [{ op: 'set_clip_speed', args: { clipId: clip, speed: 2 } }],
    ramp: () => [{ op: 'set_clip_speed_ramp', args: { clipId: clip, from: 0.5, to: 2, ...(rnd() < 0.5 ? { curve: 'smooth' } : {}) } }],
    reverse: () => [{ op: 'set_clip_reverse', args: { clipId: clip, reverse: true } }],
    slip: () => [{ op: 'slip_clip', args: { clipId: clip, by: rnd() < 0.5 ? T.frameTime(1 + int(25), rate) : T.sub(T.ZERO, T.frameTime(1 + int(25), rate)) } }],
    freeze: () => [{ op: 'freeze_frame', args: { clipId: clip, at: f(10 + int(60)), duration: f(5 + int(20)) } }],
    stutter: () => [{ op: 'add_effect', args: { clipId: clip, type: 'time.stutter' } }],
    // the next clip on V1 is of file B: during the transition A plays on from its handle (the outgoing side), then it is absent
    transition: () => [{ op: 'add_clip', args: { assetId: B, start: f(90), sourceIn: T.ZERO, duration: f(60), trackId: V1 } }],
    echo: () => [{ op: 'add_effect', args: { clipId: clip, type: 'time.echo', params: { count: 2 + int(4), delay: 1 + int(8) } } }],
  };
  doc = tx(doc, ops[edit]()).doc;
  if (edit === 'transition') { const second = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === V1)!.clips.find((c) => c.type === 'media' && c.assetId === B)!; doc = tx(doc, [{ op: 'set_transition', args: { clipId: second.id, type: 'dissolve', frames: 6 + int(10) } }]).doc; }
  if (format === 'cover') doc = tx(doc, [{ op: 'set_project_format', args: { fit: 'cover' } }]).doc;
  if (format === '9:16') { const v = tx(doc, [{ op: 'add_variant', args: { profileId: 'vertical-9x16' } }]); doc = projectVariant(v.doc, v.results[0]!.output!.variantId as string); }
  return { doc, rate, f, A, V1, title, mtk, edit, format };
}

/** The sample a follower should read, from the arrays: the nearest end outside the track; otherwise the rounded mean of usable samples in the window (a manual one exactly). */
function refSample(t: MotionTrack, frame: number, smooth: number) {
  const n = t.x.length, raw = frame - t.from, outside = raw < 0 || raw >= n, i = Math.min(n - 1, Math.max(0, raw));
  const own = { x: t.x[i]!, y: t.y[i]!, s: t.s![i]!, outside };
  if (outside || smooth === 0 || t.st[i] === ST.manual) return own;
  const usable = (st: number) => st === ST.tracked || st === ST.manual || st === ST.interpolated || st === ST.reacquired;
  const idx = Array.from({ length: 2 * smooth + 1 }, (_, k) => i - smooth + k).filter((k) => k >= 0 && k < n && usable(t.st[k]!));
  if (!idx.length) return own;
  const mean = (a: number[]) => Math.round(idx.reduce((sum, k) => sum + a[k]!, 0) / idx.length);
  return { x: mean(t.x), y: mean(t.y), s: mean(t.s!), outside };
}
/** Where source point (u, v) of a placed picture lands in the frame, written out: fit, then translate, rotate clockwise, scale (compositor2d.ts withTransform). */
function pointInFrame(g: RenderGraph, l: VideoLayer, u: number, v: number) {
  const fit = g.fit === 'cover' ? Math.max(g.width / l.sourceWidth, g.height / l.sourceHeight) : Math.min(g.width / l.sourceWidth, g.height / l.sourceHeight);
  const t = l.transform, a = (t.rotation * Math.PI) / 180;
  const lx = (u - 0.5) * l.sourceWidth * fit * t.scale, ly = (v - 0.5) * l.sourceHeight * fit * t.scale;
  return { x: g.width / 2 + t.x * g.width + Math.cos(a) * lx - Math.sin(a) * ly, y: g.height / 2 + t.y * g.height + Math.sin(a) * lx + Math.cos(a) * ly };
}
/** The target picture as the resolver's rule 1 finds it: a picture of A on V1, the incoming side before the outgoing one. */
const drawnTarget = (g: RenderGraph, V1: string, A: string): VideoLayer | undefined => {
  const all = g.layers.filter((l): l is VideoLayer => l.kind === 'video' && l.trackId === V1 && l.assetId === A);
  return all.find((l) => l.transition?.role !== 'out') ?? all[0];
};
const pictures = (g: RenderGraph): VideoLayer[] => g.layers.flatMap((l) => (l.kind === 'video' ? [l, ...(l.time?.taps ?? []).flatMap((tp) => (tp.layer.kind === 'video' ? [tp.layer] : []))] : []));

describe('follow: the key property over 200 seeded random documents', () => {
  it('the follower reads the target picture\'s own source frame and lands exactly on the tracked point; regions sit on every picture at its own frame', () => {
    const seen = new Map<string, number>();
    let frames = 0, absent = 0, wholes = 0, taps = 0, outs = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const b = build(seed);
      const { doc, f, A, V1, edit, format } = b;
      seen.set(`${edit}/${format}`, (seen.get(`${edit}/${format}`) ?? 0) + 1);
      const titleClip = findClip(doc, b.title)!.clip;
      const own = titleClip.transform;
      const follow = titleClip.follow!;
      const mt = doc.motionTracks[b.mtk]!;
      const fps = 30;
      const first = T.frameIndexAt(titleClip.start, b.rate), count = T.frameIndexAt(titleClip.duration, b.rate);
      const ofA = doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.id === V1)!.clips.filter((c): c is MediaClip => c.type === 'media' && c.assetId === A);
      const sequential: RenderGraph[] = [];
      for (let i = first; i < first + count; i++) {
        const where = `seed ${seed} (${edit}, ${format}) frame ${i}`;
        const g = evaluate(doc, f(i));
        sequential.push(g);
        frames++;
        const text = g.layers.find((l): l is TextLayer => l.kind === 'text' && l.clipId === b.title)!;
        expect(text.follow, where).toBeDefined();
        let target = drawnTarget(g, V1, A);
        if (target) expect(text.follow!.state, where).not.toMatch(/^target-/);
        else {
          // no picture of A on V1 here: the nearest clip of A, held at its first or last frame
          absent++;
          expect(text.follow!.state, where).toBe('target-absent');
          const near = ofA.map((c) => { const s = T.frameIndexAt(c.start, b.rate), e = s + T.frameIndexAt(c.duration, b.rate) - 1, at = i < s ? s : e; return { at, d: Math.abs(i - at) }; }).sort((p, q) => p.d - q.d || p.at - q.at)[0]!;
          target = drawnTarget(evaluate(doc, f(near.at)), V1, A)!;
        }
        if (target.transition?.role === 'out') outs++;
        expect(text.follow!.sourceFrame, where).toBe(target.sourceFrameIndex);
        expect(text.follow!.targetClipId, where).toBe(target.clipId);
        const smp = refSample(mt, target.sourceFrameIndex, follow.smooth);
        if (smp.outside && text.follow!.state !== 'target-absent') expect(text.follow!.state, where).toBe('outside');
        const P = pointInFrame(g, target, smp.x / 10_000, smp.y / 10_000);
        const m = follow.scale ? (smp.s / 1000) * target.transform.scale : 1;
        expect(Math.abs(g.width / 2 + text.transform.x * g.width - (P.x + own.x * g.width * m)), where).toBeLessThan(1e-9);
        expect(Math.abs(g.height / 2 + text.transform.y * g.height - (P.y + own.y * g.height * m)), where).toBeLessThan(1e-9);
        expect(Math.abs(text.transform.scale - own.scale * m), where).toBeLessThan(1e-12);
        expect([text.transform.rotation, text.transform.opacity], where).toEqual([own.rotation, own.opacity]);
        // privacy regions: on every picture of A (the layer, each echo tap, the outgoing side), resolved at that picture's own frame
        for (const pic of pictures(g)) {
          if (pic.assetId !== A || pic.trackId !== V1) continue;
          const clip = findClip(doc, pic.clipId)!.clip as MediaClip;
          if (!clip.redact) { expect(pic.regions, where).toBeUndefined(); continue; }
          if (pic !== target && pic.lane) taps++;
          const [tracked, fixed] = pic.regions! as [ResolvedRegion, ResolvedRegion];
          expect([tracked.sourceFrame, fixed.sourceFrame], where).toEqual([pic.sourceFrameIndex, pic.sourceFrameIndex]);
          const region = clip.redact[0]! as RedactRegion;
          const raw = pic.sourceFrameIndex - mt.from, outside = raw < 0 || raw >= mt.x.length;
          const whole = outside || lossFlags(mt, fps, region.weakIsLost)[raw] === 1;
          expect(tracked.whole, where).toBe(whole);
          if (whole) { wholes++; expect([tracked.style, tracked.strength >= 0.6], where).toEqual(['blur', true]); }
          else {
            const s0 = refSample(mt, pic.sourceFrameIndex, 0), k = 1 + region.pad;
            expect(tracked.x, where).toBeCloseTo(s0.x / 10_000 - 0.5 + region.x, 12);
            expect(tracked.y, where).toBeCloseTo(s0.y / 10_000 - 0.5 + region.y, 12);
            expect(tracked.height, where).toBeCloseTo((mt.box!.h / 10_000) * (s0.s / 1000) * k, 12);
          }
          expect(fixed, where).toMatchObject({ state: 'fixed', whole: false, x: 0.3, y: 0.3, shape: 'rect' });
          expect(fixed.height, where).toBeCloseTo(0.2 * 1.15, 12);
        }
      }
      // at half speed each source frame is shown twice: the two frames of each held pair are the same for the follower
      if (edit === 'speed-half') {
        for (let i = 1; i < sequential.length; i++) {
          const [a, c] = [sequential[i - 1]!, sequential[i]!];
          const ta = drawnTarget(a, V1, A), tc = drawnTarget(c, V1, A);
          if (!ta || !tc || ta.sourceFrameIndex !== tc.sourceFrameIndex) continue;
          const fa = a.layers.find((l) => l.kind === 'text')!, fc = c.layers.find((l) => l.kind === 'text')!;
          expect(fc.transform, `seed ${seed} held pair at ${first + i}`).toEqual(fa.transform);
        }
      }
      // any order of evaluation gives the same frames (pure; the loss filter is cached per track object)
      const order = Array.from({ length: count }, (_, j) => j), shuffle = mulberry32(seed);
      for (let j = order.length - 1; j > 0; j--) { const q = Math.floor(shuffle() * (j + 1)); [order[j], order[q]] = [order[q]!, order[j]!]; }
      for (const j of order) expect(evaluate(doc, f(first + j)), `seed ${seed} frame ${first + j} out of order`).toEqual(sequential[j]);
    }
    // every edit was seen in every format, and the special cases happened
    expect(seen.size).toBe(EDITS.length * FORMATS.length);
    expect([frames > 10_000, absent > 0, wholes > 0, taps > 0, outs > 0]).toEqual([true, true, true, true, true]);
  }, 300_000);
});

describe('follow: targets that are hidden, missing or gone', () => {
  const R = { num: 30, den: 1 };
  const f = (k: number) => T.frameTime(k, R);
  let k = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], internal = false) => applyTransaction(doc, ops, { idSeed: `h${k++}_`, actor: 'test', allowInternal: internal });
  function setup() {
    let r = tx(createProject({ id: 'prj_h', name: 'H', width: 1920, height: 1080 }), [{ op: 'import_asset', args: { asset: videoAsset('a', 1280, 720) } }], true);
    const A = r.results[0]!.output!.assetId as string;
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: A, start: f(0), duration: f(60) } }, { op: 'add_text', args: { text: 'x', start: f(0), duration: f(60) } }, { op: 'create_motion_track', args: { assetId: A, kind: 'point', frame: 0, x: 2500, y: 7500 } }]);
    const clip = r.results[0]!.output!.clipId as string, V1 = r.results[0]!.output!.trackId as string, title = r.results[1]!.output!.clipId as string, mtk = r.results[2]!.output!.motionTrackId as string;
    r = tx(r.doc, [{ op: 'set_clip_follow', args: { clipId: title, follow: { motionTrackId: mtk, targetTrackId: V1, scale: false, smooth: 0 }, offset: { x: 0, y: -0.05 } } }]);
    return { doc: r.doc, A, clip, V1, title, mtk };
  }
  const titleAt = (doc: ProjectDocument, frame: number) => evaluate(doc, f(frame)).layers.find((l): l is TextLayer => l.kind === 'text')!;
  it('a hidden target track still guides the follower, exactly as when it is shown', () => {
    const s = setup();
    const shown = titleAt(s.doc, 10);
    // the point (0.25, 0.75) of a 1280×720 picture contained in 1920×1080: (480, 810); the offset −0.05 of the height above it
    expect(shown.transform.x * 1920 + 960).toBeCloseTo(480, 9);
    expect(shown.transform.y * 1080 + 540).toBeCloseTo(810 - 0.05 * 1080, 9);
    // the track holds one sample (source frame 0): frame 10 is outside it, so the end sample is used and reported as such
    expect(shown.follow).toEqual({ motionTrackId: s.mtk, state: 'outside', sourceFrame: 10, confidence: 0, targetClipId: s.clip });
    expect(titleAt(s.doc, 0).follow).toEqual({ motionTrackId: s.mtk, state: 'manual', sourceFrame: 0, confidence: 100, targetClipId: s.clip });
    const hidden = tx(s.doc, [{ op: 'update_track', args: { trackId: s.V1, hidden: true } }]).doc;
    expect(evaluate(hidden, f(10)).layers.some((l) => l.kind === 'video')).toBe(false);
    expect(titleAt(hidden, 10)).toEqual(shown);
  });
  it('with no clip of the file on the target track, or no such track, the follower keeps its own place and says why', () => {
    const s = setup();
    const gone = tx(s.doc, [{ op: 'delete_clip', args: { clipId: s.clip } }]).doc;
    const t = titleAt(gone, 10);
    expect(t.follow).toEqual({ motionTrackId: s.mtk, state: 'target-missing', sourceFrame: null, confidence: 0, targetClipId: null });
    expect(t.transform).toEqual(findClip(gone, s.title)!.clip.transform);
    const dangling = structuredClone(s.doc);
    findClip(dangling, s.title)!.clip.follow!.targetTrackId = 'trk_gone';
    expect(titleAt(dangling, 10).follow!.state).toBe('target-missing');
  });
  it('a still picture on a video track above follows the same point as a title with the same offset', () => {
    const s = setup();
    const still = { kind: 'image' as const, name: 'sticker.png', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 200, height: 200, codec: 'png', hasAlpha: true }, provenance: prov };
    let r = tx(s.doc, [{ op: 'import_asset', args: { asset: still } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), duration: f(60) } }]);
    const sticker = r.results[0]!.output!.clipId as string;
    const d = tx(r.doc, [{ op: 'set_clip_follow', args: { clipId: sticker, follow: { motionTrackId: s.mtk, targetTrackId: s.V1, scale: false, smooth: 0 }, offset: { x: 0, y: -0.05 } } }]).doc;
    const g = evaluate(d, f(0));
    const img = g.layers.find((l) => l.kind === 'image')!, text = g.layers.find((l) => l.kind === 'text')!;
    expect([img.transform.x, img.transform.y, img.follow?.state]).toEqual([text.transform.x, text.transform.y, 'manual']);
  });
  it('describe_moment reports the follow and the privacy regions', () => {
    const s = setup();
    const d = tx(s.doc, [{ op: 'set_redact_region', args: { clipId: s.clip, region: { motionTrackId: s.mtk } } }]).doc;
    const m = describeMoment(d, f(0));
    const v = m.layers.find((l) => l.kind === 'video') as { regions?: unknown[] };
    // the track has one sample (frame 0): a usable stretch of one frame is shorter than the loss filter keeps, so the whole picture is blurred
    expect(v.regions).toEqual([{ id: expect.any(String), state: 'manual', whole: true, style: 'blur', sourceFrame: 0 }]);
    const t = m.layers.find((l) => l.kind === 'text') as { follow?: { state: string; sourceFrame: number } };
    expect(t.follow).toMatchObject({ state: 'manual', sourceFrame: 0 });
    const later = describeMoment(d, f(20)).layers.find((l) => l.kind === 'video') as { regions?: { state: string; whole: boolean }[] };
    expect(later.regions![0]).toMatchObject({ state: 'outside', whole: true });
  });
  it('evaluating a document without tracking is unchanged: no follow, no regions on any layer', () => {
    let r = tx(createProject({ id: 'prj_n', name: 'N' }), [{ op: 'import_asset', args: { asset: videoAsset('a', 640, 360) } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(0), duration: f(30) } }, { op: 'add_text', args: { text: 'x', start: f(0), duration: f(30) } }]);
    for (const l of evaluate(r.doc, f(5)).layers as Layer[]) { expect('follow' in l).toBe(false); expect('regions' in l).toBe(false); }
  });
});
