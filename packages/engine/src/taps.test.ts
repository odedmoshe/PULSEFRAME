/**
 * Time effects on the shared evaluator (ADR-0011): tap times, weights and the integer merge (taps.ts), the stutter's shown
 * frame, planned beat steps, and the layers `evaluate` builds for them. Node only: the merge is checked on synthetic
 * arrays, the rest on the render graph, never on a canvas.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, flashGapFrames, TAP_WEIGHT_TOTAL, type OpCall, type ProjectDocument, type Track } from '@pulseframe/core';
import { evaluate, describeMoment, type ImageLayer, type Layer, type TextLayer, type VideoLayer } from './evaluate.ts';
import { beatStepFrames, maxDecodeLanes, pieceAt, runStart, stutterFrame, tapMerger, tapOffsets, tapWeights } from './taps.ts';

const R = { num: 30, den: 1 };
const f = (n: number, rate = R) => T.frameTime(n, rate);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false, idSeed = `tp${n++}_`) => applyTransaction(doc, ops, { idSeed, actor: 'test', allowInternal });
const video = (frameRate = R) => ({
  kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'7'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate, codec: 'h264', rotation: 0, frameCount: 8 * (frameRate.num / frameRate.den) }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' },
  provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
});
const song = { kind: 'audio' as const, name: 'song.wav', contentHash: `sha256:${'8'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(60, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' } };

/**
 * A 30 fps project with one 120-frame video clip from source second 1, moving right by 4 px a frame, with one effect.
 * The ids are the same in every project made here, so two of them can be compared directly.
 */
function project(type: string, params: Record<string, unknown> = {}, clip: Record<string, unknown> = {}) {
  let r = tx(createProject({ id: 'prj_tp', name: 'TP' }), [{ op: 'import_asset', args: { asset: video() } }], true, 'P1_');
  const assetId = r.results[0]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId, start: f(0), sourceIn: T.rt(1, 1), duration: f(120), ...clip } }], false, 'P2_');
  const clipId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [
    { op: 'set_keyframe', args: { clipId, property: 'x', time: f(0), value: 0 } },
    { op: 'set_keyframe', args: { clipId, property: 'x', time: f(100), value: 0.625 } },
    { op: 'add_effect', args: { clipId, type, params } },
  ], false, 'P3_');
  return { doc: r.doc, clipId, assetId, effectId: r.results[2]!.output!.effectId as string };
}
const videoTrack = (doc: ProjectDocument): Track => doc.sequences[doc.mainSequenceId]!.tracks.find((t) => t.kind === 'video')!;
const layerAt = (doc: ProjectDocument, frame: number) => evaluate(doc, f(frame)).layers.find((l) => l.kind === 'video' || l.kind === 'image' || l.kind === 'text') as VideoLayer | ImageLayer | TextLayer;
/** What a tap shows: the source picture and where it is placed. */
const shown = (l: Layer) => ({ assetId: 'assetId' in l ? l.assetId : null, sourceFrameIndex: l.kind === 'video' ? l.sourceFrameIndex : null, transform: 'transform' in l ? l.transform : null });

describe('tap times and weights', () => {
  it('echo and split read whole frames back from the frame time, exactly on the frame grid (also at 29.97)', () => {
    for (const rate of [R, { num: 30000, den: 1001 }, { num: 24, den: 1 }]) {
      const echo = tapOffsets('time.echo', { count: 5, delay: 3 }, rate);
      expect(echo).toEqual([0, -3, -6, -9, -12].map((k) => T.frameTime(k, rate)));
      for (const t of echo) expect(T.isFrameAligned(t, rate)).toBe(true);
      expect(tapOffsets('time.split', { lag: 4 }, rate)).toEqual([0, -4, -8].map((k) => T.frameTime(k, rate)));
      // a tap time of a frame-aligned frame is itself a frame start
      for (const t of echo) expect(T.isFrameAligned(T.add(f(77, rate), t), rate)).toBe(true);
    }
  });
  it('shutter samples: centred offsets sum to exactly 0 and are symmetric; trailing ones all lie before the frame time; both in time order within angle/360 of a frame', () => {
    for (const rate of [R, { num: 30000, den: 1001 }]) for (const S of [2, 3, 8, 16]) for (const angle of [0, 90, 180, 360, 720]) {
      const c = tapOffsets('time.shutter', { samples: S, angle, timing: 'centred' }, rate);
      expect(c.length).toBe(S);
      expect(T.isZero(c.reduce((s, x) => T.add(s, x), T.ZERO))).toBe(true);
      c.forEach((x, j) => expect(T.eq(x, T.sub(T.ZERO, c[S - 1 - j]!))).toBe(true));
      const tr = tapOffsets('time.shutter', { samples: S, angle, timing: 'trailing' }, rate);
      const span = T.rt(angle * rate.den, 360 * rate.num); // angle/360 of a frame
      for (const xs of [c, tr]) for (let j = 1; j < S; j++) expect(T.lte(xs[j - 1]!, xs[j]!)).toBe(true);
      for (const x of tr) { expect(T.lte(x, T.ZERO)).toBe(true); expect(T.lte(T.sub(T.ZERO, span), x)).toBe(true); }
      if (angle > 0) expect(T.lt(tr[S - 1]!, T.ZERO)).toBe(true);
      // the samples are evenly spaced, (angle/360)/S of a frame apart
      for (let j = 1; j < S; j++) expect(T.eq(T.sub(c[j]!, c[j - 1]!), T.rt(angle * rate.den, 360 * S * rate.num))).toBe(true);
    }
    expect(tapOffsets('time.shutter', { samples: 8, angle: 0 }, R).every((x) => T.isZero(x))).toBe(true);
  });
  it('integer weights add up to 4096 (largest remainder, ties to the lower picture); split weighs nothing', () => {
    expect(TAP_WEIGHT_TOTAL).toBe(4096);
    for (const count of [2, 3, 4, 5]) for (const decay of [0.05, 0.3, 0.6, 0.999, 1]) {
      const w = tapWeights('time.echo', { count, decay }, count);
      expect(w.reduce((s, v) => s + v, 0)).toBe(4096);
      for (const v of w) expect(Number.isInteger(v)).toBe(true);
      for (let k = 1; k < count; k++) expect(w[k]!).toBeLessThanOrEqual(w[k - 1]!); // older is never heavier
    }
    expect(tapWeights('time.shutter', {}, 3)).toEqual([1366, 1365, 1365]);
    expect(tapWeights('time.shutter', {}, 8)).toEqual(Array(8).fill(512));
    expect(tapWeights('time.echo', { decay: 1 }, 3)).toEqual([1366, 1365, 1365]);
    expect(tapWeights('time.split', {}, 3)).toEqual([0, 0, 0]);
  });
});

describe('the merge (exact integer arithmetic on straight-alpha RGBA8)', () => {
  const px = (...v: number[]) => Uint8ClampedArray.from(v);
  const merge = (type: string, params: Record<string, unknown>, weights: number[], pics: Uint8ClampedArray[]) => {
    const m = tapMerger(type, params as never, weights, pics[0]!.length / 4);
    pics.forEach((p, k) => m.add(k, p));
    const out = new Uint8ClampedArray(pics[0]!.length);
    m.finish(out);
    return Array.from(out);
  };
  const premul = (c: number, a: number) => Math.floor((c * a + 127) / 255);
  const unpremul = (q: number, a: number) => (a ? Math.min(255, Math.floor((q * 255 + (a >> 1)) / a)) : 0);
  /** Pseudo-random opaque and translucent pixels. */
  const noise = (seed: number, count: number, opaque: boolean) => { let s = seed; const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16) & 255; return Uint8ClampedArray.from({ length: count * 4 }, (_, i) => (i % 4 === 3 ? (opaque ? 255 : r()) : r())); };

  it('blend: (ΣW·P + 2048) >> 12 per premultiplied channel, back to straight alpha; opaque pixels match the formula exactly', () => {
    const w = tapWeights('time.echo', { decay: 0.6 }, 4);
    const pics = [0, 1, 2, 3].map((k) => noise(11 + k, 64, true));
    const out = merge('time.echo', { mode: 'blend', decay: 0.6 }, w, pics);
    for (let i = 0; i < out.length; i++) expect(out[i]).toBe(i % 4 === 3 ? 255 : (w.reduce((s, wk, k) => s + wk * pics[k]![i]!, 0) + 2048) >> 12);
    // translucent: the formulas, step by step
    const tp = [0, 1, 2].map((k) => noise(40 + k, 64, false));
    const w3 = tapWeights('time.echo', { decay: 0.5 }, 3);
    const o3 = merge('time.echo', { mode: 'blend', decay: 0.5 }, w3, tp);
    for (let p = 0; p < 64; p++) {
      const a = (w3.reduce((s, wk, k) => s + wk * tp[k]![p * 4 + 3]!, 0) + 2048) >> 12;
      expect(o3[p * 4 + 3]).toBe(a);
      for (let c = 0; c < 3; c++) expect(o3[p * 4 + c]).toBe(unpremul((w3.reduce((s, wk, k) => s + wk * premul(tp[k]![p * 4 + c]!, tp[k]![p * 4 + 3]!), 0) + 2048) >> 12, a));
    }
  });
  it('identical pictures give the picture back (opaque, and translucent values as an 8-bit premultiplied canvas reads them back)', () => {
    const opaque = noise(3, 256, true);
    for (const [type, params] of [['time.echo', { mode: 'blend', decay: 0.6 }], ['time.shutter', {}], ['time.echo', { mode: 'lighten', decay: 0.6 }], ['time.echo', { mode: 'trail', decay: 1 }], ['time.split', { order: 'red-now' }], ['time.split', { order: 'blue-now' }]] as const) {
      const k = type === 'time.split' ? 3 : 5;
      expect(merge(type, params, tapWeights(type, params, k), Array(k).fill(opaque))).toEqual(Array.from(opaque));
    }
    // a translucent value that came from premultiplied storage survives: c = unpremul(P, a) for any P ≤ a
    const canonical = Uint8ClampedArray.from({ length: 256 * 4 }, (_, i) => { const p = i >> 2, a = (p * 37) % 256, P = (p * 11) % (a + 1); return i % 4 === 3 ? a : unpremul(P, a); });
    expect(merge('time.shutter', {}, tapWeights('time.shutter', {}, 8), Array(8).fill(canonical))).toEqual(Array.from(canonical));
  });
  it('a fully transparent picture adds no colour: blend lowers only the opacity, split keeps the other channels, trail shows the past alone', () => {
    const clear = new Uint8ClampedArray(4 * 4);
    const red = Uint8ClampedArray.from([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255]);
    const out = merge('time.echo', { mode: 'blend', decay: 1 }, [2048, 2048], [red, clear]);
    expect(out.slice(0, 4)).toEqual([255, 0, 0, 128]); // the colour stays pure red, half covered
    expect(merge('time.echo', { mode: 'blend', decay: 1 }, [2048, 2048], [clear, clear])).toEqual(Array(16).fill(0));
    expect(merge('time.split', { order: 'red-now' }, [0, 0, 0], [red, clear, clear]).slice(0, 4)).toEqual([255, 0, 0, 255]);
    // trail: the newest picture over its fading past; with a transparent newest picture only the past shows, at strength decay
    const t = merge('time.echo', { mode: 'trail', decay: 0.5 }, tapWeights('time.echo', { decay: 0.5 }, 2), [clear, red]);
    expect(t.slice(0, 4)).toEqual([255, 0, 0, (Math.round(4096 * 0.5) * 255 + 2048) >> 12]);
  });
  it('split: red now, green a moment ago, blue before that (and the other way round); alpha is the most opaque', () => {
    const a = px(10, 20, 30, 255), b = px(40, 50, 60, 255), c = px(70, 80, 90, 255);
    expect(merge('time.split', { order: 'red-now' }, [0, 0, 0], [a, b, c])).toEqual([10, 50, 90, 255]);
    expect(merge('time.split', { order: 'blue-now' }, [0, 0, 0], [a, b, c])).toEqual([70, 50, 30, 255]);
  });
  it('lighten: the brightest of the weighted pictures per channel; trail: P0 + (255 − a0)·B / 255 with the past at strength decay', () => {
    const dark = px(10, 200, 10, 255), light = px(250, 100, 250, 255);
    const G1 = Math.round(4096 * 0.6);
    expect(merge('time.echo', { mode: 'lighten', decay: 0.6 }, [1, 1], [dark, light])).toEqual([Math.max(10, (G1 * 250 + 2048) >> 12), 200, Math.max(10, (G1 * 250 + 2048) >> 12), 255]);
    // an opaque newest picture hides its past entirely
    expect(merge('time.echo', { mode: 'trail', decay: 0.6 }, tapWeights('time.echo', { decay: 0.6 }, 3), [dark, light, light])).toEqual([10, 200, 10, 255]);
    // a half-transparent newest picture over its past
    const half = px(200, 0, 0, 128), past = px(0, 0, 200, 255);
    const P0 = premul(200, 128), B = (Math.round(4096 * 0.6) * premul(200, 255) + 2048) >> 12, Ba = (Math.round(4096 * 0.6) * 255 + 2048) >> 12;
    const A = 128 + Math.floor(((255 - 128) * Ba + 127) / 255);
    expect(merge('time.echo', { mode: 'trail', decay: 0.6 }, tapWeights('time.echo', { decay: 0.6 }, 2), [half, past])).toEqual([unpremul(P0, A), 0, unpremul(Math.floor(((255 - 128) * B + 127) / 255), A), A]);
  });
  it('refuses a picture of the wrong size', () => {
    expect(() => tapMerger('time.echo', {}, [4096], 2).add(0, new Uint8ClampedArray(4))).toThrow(RangeError);
  });
});

describe('the time taps evaluate builds', () => {
  it('echo: the clip is drawn from its own picture and the pictures 3, 6, 9 frames earlier; the effect is taken out of the effect list; lanes 0–3 on the carrier', () => {
    const { doc, clipId, assetId, effectId } = project('time.echo', { count: 4, delay: 3 });
    const l = layerAt(doc, 60) as VideoLayer;
    expect(l.effects).toBeUndefined();
    expect(l.time!.type).toBe('time.echo');
    expect(l.time!.taps.map((t) => t.time)).toEqual([60, 57, 54, 51].map((k) => f(k)));
    expect(l.time!.taps.map((t) => t.lane)).toEqual([0, 1, 2, 3]);
    expect(l.time!.taps.map((t) => (t.layer as VideoLayer).lane)).toEqual([undefined, 1, 2, 3]);
    expect(l.time!.taps.every((t) => t.layer.clipId === clipId && (t.layer as VideoLayer).assetId === assetId)).toBe(true);
    expect(l.time!.taps.map((t) => t.weight).reduce((s, v) => s + v, 0)).toBe(4096);
    // each tap is the clip as drawn at its own time, without a look
    for (const tap of l.time!.taps) {
      const plain = evaluate(project('blur.gaussian').doc, tap.time).layers[0] as VideoLayer;
      expect(shown(tap.layer)).toEqual(shown(plain));
      expect(tap.layer.effects).toBeUndefined();
      expect(tap.layer.time).toBeUndefined();
    }
    // the clip's source runs from second 1: frame 60 shows source frame 90, its taps 87, 84, 81
    expect(l.time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex)).toEqual([90, 87, 84, 81]);
    // the effects after the time effect stay, in order
    const withMore = tx(doc, [{ op: 'add_effect', args: { clipId, type: 'blur.gaussian' } }, { op: 'add_effect', args: { clipId, type: 'color.grayscale' } }]).doc;
    expect(layerAt(withMore, 60).effects!.map((e) => e.type)).toEqual(['blur.gaussian', 'color.grayscale']);
    // a disabled time effect is no time effect
    const off = tx(doc, [{ op: 'update_effect', args: { clipId, effectId, enabled: false } }]).doc;
    expect(layerAt(off, 60).time).toBeUndefined();
  });
  it('tap times are clamped to the start of the clip (the run start): never a picture from before it', () => {
    const { doc } = project('time.echo', { count: 5, delay: 4 });
    const l = layerAt(doc, 6);
    expect(l.time!.taps.map((t) => t.time)).toEqual([6, 2, 0, 0, 0].map((k) => f(k)));
    expect(l.time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex)).toEqual([36, 32, 30, 30, 30]);
  });
  it('a cut does not change what the taps show: the pieces of a split clip read back into the earlier piece (frames 37–50 equal the unsplit clip)', () => {
    for (const [type, params] of [['time.echo', { count: 5, delay: 3 }], ['time.split', { lag: 6 }], ['time.shutter', { angle: 360, samples: 6 }], ['time.echo', { count: 5, delay: 15 }]] as const) {
      const { doc, clipId, effectId } = project(type, params);
      const cut = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(37) } }]).doc;
      const right = videoTrack(cut).clips.find((c) => c.id !== clipId)!;
      expect(T.eq(runStart(videoTrack(cut), right, effectId), f(0))).toBe(true);
      expect(pieceAt(videoTrack(cut), right, effectId, f(36))!.id).toBe(clipId);
      expect(pieceAt(videoTrack(cut), right, effectId, f(37))!.id).toBe(right.id);
      for (let frame = 37; frame <= 50; frame++) {
        const a = layerAt(doc, frame), b = layerAt(cut, frame);
        expect(b.clipId).toBe(right.id);
        expect(b.time!.taps.map((t) => ({ ...shown(t.layer), time: t.time, lane: t.lane, weight: t.weight }))).toEqual(a.time!.taps.map((t) => ({ ...shown(t.layer), time: t.time, lane: t.lane, weight: t.weight })));
        // the decoder of each lane is the carrier's own, on both sides of the cut
        expect(new Set(b.time!.taps.map((t) => t.layer.clipId))).toEqual(new Set([right.id]));
      }
    }
  });
  it('a clip next to another clip without the same effect starts its own run', () => {
    const { doc, clipId, assetId } = project('time.echo', { count: 5, delay: 3 });
    const two = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(120), sourceIn: T.rt(1, 1), duration: f(60), trackId: videoTrack(doc).id } }]).doc;
    const second = videoTrack(two).clips.find((c) => c.id !== clipId)!;
    const withEcho = tx(two, [{ op: 'add_effect', args: { clipId: second.id, type: 'time.echo', params: { count: 5, delay: 3 } } }]).doc;
    expect(layerAt(withEcho, 121).time!.taps.map((t) => t.time)).toEqual([121, 120, 120, 120, 120].map((k) => f(k)));
  });
  it('reverse, a freeze frame and speed 2 choose the source frames the clip itself shows at the tap times', () => {
    // speed 2: frame 30 shows source 30 + 2·30 = 90; its taps 3 frames apart are 6 source frames apart
    const fast = project('time.echo', { count: 3, delay: 3 });
    const fastDoc = tx(fast.doc, [{ op: 'set_clip_speed', args: { clipId: fast.clipId, speed: 2 } }]).doc;
    expect(layerAt(fastDoc, 30).time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex)).toEqual([90, 84, 78]);
    // reverse: the clip plays its source backwards, so earlier frames of the clip show LATER source frames
    const back = project('time.echo', { count: 3, delay: 3 });
    const backDoc = tx(back.doc, [{ op: 'set_clip_reverse', args: { clipId: back.clipId, reverse: true } }]).doc;
    // the clip shows source frames 30…149; backwards, its frame i shows 149 − i: frame 30 shows 119, its taps 122 and 125
    const rev = layerAt(backDoc, 30).time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex);
    expect(rev).toEqual([119, 122, 125]);
    expect(rev).toEqual([30, 27, 24].map((k) => (layerAt(backDoc, k) as VideoLayer).sourceFrameIndex));
    // a freeze frame shows one picture whatever the time
    const still = project('time.echo', { count: 4, delay: 2 });
    const frozen = tx(still.doc, [{ op: 'freeze_frame', args: { clipId: still.clipId, at: f(40), duration: f(30) } }]).doc;
    const hold = videoTrack(frozen).clips.find((c) => c.type === 'media' && c.freeze)!;
    expect(hold.type !== 'caption' && hold.effects?.[0]?.type).toBe('time.echo'); // the held picture keeps the clip's effects
    const taps = layerAt(frozen, 60).time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex);
    expect(new Set(taps).size).toBe(1);
    expect(taps[0]).toBe((layerAt(still.doc, 40) as VideoLayer).sourceFrameIndex);
  });
  it('shutter: every sample shows the source frame of the frame time (no extra decode, lane 0) placed where the clip is at the sub-frame time', () => {
    const { doc } = project('time.shutter', { angle: 180, samples: 4, timing: 'centred' });
    const l = layerAt(doc, 50) as VideoLayer;
    const plain = layerAt(project('blur.gaussian').doc, 50) as VideoLayer;
    expect(l.time!.taps.map((t) => (t.layer as VideoLayer).sourceFrameIndex)).toEqual(Array(4).fill(plain.sourceFrameIndex));
    expect(l.time!.taps.map((t) => t.lane)).toEqual([0, 0, 0, 0]);
    // x moves 0.00625 a frame; the samples sit at ±1/16 and ±3/16 of a frame
    expect(l.time!.taps.map((t) => t.layer.transform.x)).toEqual([-3, -1, 1, 3].map((j) => expect.closeTo(0.00625 * (50 + j / 16), 12)));
    expect(maxDecodeLanes(doc).lanes).toBe(1);
    // angle 0: every sample is the frame itself
    const zero = layerAt(project('time.shutter', { angle: 0 }).doc, 50);
    for (const tap of zero.time!.taps) expect(shown(tap.layer)).toEqual(shown(plain));
  });
  it('titles: echo and shutter taps are the title at the tap time (transform and letter animation)', () => {
    let r = tx(createProject({ id: 'prj_tt', name: 'TT' }), [{ op: 'add_text', args: { text: 'שלום', start: f(10), duration: f(60) } }]);
    const textId = r.results[0]!.output!.clipId as string;
    r = tx(r.doc, [
      { op: 'set_keyframe', args: { clipId: textId, property: 'y', time: f(0), value: 0.3 } },
      { op: 'set_keyframe', args: { clipId: textId, property: 'y', time: f(30), value: -0.3 } },
      { op: 'add_effect', args: { clipId: textId, type: 'time.shutter', params: { angle: 360, samples: 2 } } },
    ]);
    const l = evaluate(r.doc, f(25)).layers[0] as TextLayer;
    expect(l.kind).toBe('text');
    expect(l.time!.taps.map((t) => t.layer.kind)).toEqual(['text', 'text']);
    expect(l.time!.taps.map((t) => t.layer.transform.y)).toEqual([-1, 1].map((s) => expect.closeTo(0.3 - (0.6 * (15 + s / 4)) / 30, 12)));
    expect(maxDecodeLanes(r.doc).lanes).toBe(0);
  });
  it('the outgoing side of a transition gets its own taps', () => {
    const { doc, clipId, assetId } = project('time.echo', { count: 5, delay: 2 }, { duration: f(60) });
    let d = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(60), sourceIn: T.rt(4, 1), duration: f(60), trackId: videoTrack(doc).id } }]).doc;
    const second = videoTrack(d).clips.find((c) => c.id !== clipId)!;
    d = tx(d, [{ op: 'add_effect', args: { clipId: second.id, type: 'time.echo', params: { count: 5, delay: 2 } } }, { op: 'set_transition', args: { clipId: second.id, type: 'dissolve', frames: 15 } }]).doc;
    const g = evaluate(d, f(64));
    const [out, inc] = g.layers as VideoLayer[];
    expect([out!.transition?.role, inc!.transition?.role]).toEqual(['out', 'in']);
    expect(out!.time!.taps.map((t) => t.time)).toEqual([64, 62, 60, 58, 56].map((k) => f(k))); // the first clip plays on past its end
    expect(out!.time!.taps.every((t) => t.layer.clipId === clipId)).toBe(true);
    expect(inc!.time!.taps.map((t) => t.time)).toEqual([64, 62, 60, 60, 60].map((k) => f(k)));
    expect(maxDecodeLanes(d)).toEqual({ lanes: 10, fromFrame: 60, toFrame: 75 });
  });
});

describe('stutter (remap)', () => {
  it('steady: the picture of F − F mod hold is shown, never more than hold − 1 frames old, never going back, the same after a cut; effects after it stay at the frame time', () => {
    for (const hold of [2, 3, 5, 12]) {
      const { doc, clipId, effectId } = project('time.stutter', { hold });
      const cut = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(37) } }]).doc;
      let last = -1;
      for (let F = 0; F < 120; F++) {
        const Fh = stutterFrame(doc, doc.mainSequenceId, videoTrack(doc), videoTrack(doc).clips[0]!, effectId, { hold }, F);
        expect(Fh).toBe(F - (F % hold));
        expect(F - Fh).toBeLessThan(hold);
        expect(Fh).toBeGreaterThanOrEqual(last);
        last = Fh;
        const a = layerAt(doc, F) as VideoLayer, b = layerAt(cut, F) as VideoLayer;
        expect(a.remap).toEqual({ type: 'time.stutter', shownFrame: Fh });
        expect(b.remap).toEqual(a.remap);
        expect(shown(b)).toEqual(shown(a));
        expect(shown(a)).toEqual(shown(layerAt(project('blur.gaussian').doc, Fh)));
        expect(a.effects).toBeUndefined();
      }
    }
  });
  it('a run that starts mid-step holds its first frame until the next step; motion=live keeps keyframed movement at the frame time', () => {
    const { doc, clipId } = project('time.stutter', { hold: 4, motion: 'live' }, { start: f(6) });
    const l = layerAt(doc, 7) as VideoLayer;
    expect(l.remap!.shownFrame).toBe(6);
    expect(l.clipId).toBe(clipId);
    expect(l.transform.x).toBeCloseTo(0.00625, 12); // one frame into the move: live
    const held = layerAt(project('time.stutter', { hold: 4, motion: 'held' }, { start: f(6) }).doc, 7);
    expect(held.transform.x).toBe(0);
  });
  it('with the music: steps on planned beat frames only, at least flashGapFrames apart, and back to steady steps without music', () => {
    const { doc, clipId, effectId } = project('time.stutter', { hold: 3, follow: 'music', every: 1 });
    let r = tx(doc, [{ op: 'import_asset', args: { asset: song } }], true);
    const songId = r.results[0]!.output!.assetId as string;
    // a beat every 150 ms: faster than a third of a second, so the planned steps are thinned and spaced
    const beats = Array.from({ length: 30 }, (_, i) => T.rt(150 * i, 1000));
    r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId: songId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', times: beats, bpm: 400 } }, { op: 'add_clip', args: { assetId: songId, start: f(0) } }], true);
    const steps = beatStepFrames(r.doc, r.doc.mainSequenceId, 1);
    expect(steps.length).toBeGreaterThan(3);
    for (let i = 1; i < steps.length; i++) expect(steps[i]! - steps[i - 1]!).toBeGreaterThanOrEqual(flashGapFrames(30));
    expect(beatStepFrames(r.doc, r.doc.mainSequenceId, 1)).toBe(steps); // cached per document
    const plan = new Set(steps);
    let prev = -1;
    for (let F = 0; F < 120; F++) {
      const Fh = (layerAt(r.doc, F) as VideoLayer).remap!.shownFrame;
      if (F > 0 && Fh !== prev) expect(plan.has(Fh) && Fh === F).toBe(true); // the picture changes only on a planned beat frame
      prev = Fh;
    }
    // freeze: the picture stops for `hold` frames on each planned beat and plays on between
    const frozen = tx(r.doc, [{ op: 'update_effect', args: { clipId, effectId, params: { pattern: 'freeze' } } }]).doc;
    for (let F = 0; F < 120; F++) {
      const Fh = (layerAt(frozen, F) as VideoLayer).remap!.shownFrame;
      const b = [...steps].filter((x) => x <= F).pop();
      expect(Fh).toBe(b !== undefined && F - b < 3 ? b : F);
    }
    // without analysed music the steady steps apply
    for (let F = 0; F < 30; F++) expect((layerAt(doc, F) as VideoLayer).remap!.shownFrame).toBe(F - (F % 3));
  });
});

describe('decode lanes', () => {
  it('maxDecodeLanes counts every picture a frame decodes, and where the most are needed', () => {
    const { doc, clipId, assetId } = project('time.echo', { count: 5 }, { duration: f(60) });
    expect(maxDecodeLanes(doc)).toEqual({ lanes: 5, fromFrame: 0, toFrame: 60 });
    expect(maxDecodeLanes(project('time.split').doc).lanes).toBe(3);
    expect(maxDecodeLanes(project('time.stutter').doc).lanes).toBe(1);
    expect(maxDecodeLanes(project('blur.gaussian').doc).lanes).toBe(1);
    // three overlapping echo-5 clips on three tracks: 15 decoders where all three play
    let d = doc;
    for (const start of [20, 30]) {
      const r = tx(d, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(20), withLinkedAudio: false } }]);
      d = tx(r.doc, [{ op: 'add_effect', args: { clipId: r.results[0]!.output!.clipId as string, type: 'time.echo', params: { count: 5 } } }]).doc;
    }
    expect(maxDecodeLanes(d)).toEqual({ lanes: 15, fromFrame: 30, toFrame: 40 });
    expect(evaluate(d, f(35)).layers.filter((l) => l.kind === 'video').length).toBe(3);
    // a hidden track decodes nothing
    const top = d.sequences[d.mainSequenceId]!.tracks.filter((t) => t.kind === 'video').pop()!;
    expect(maxDecodeLanes(tx(d, [{ op: 'update_track', args: { trackId: top.id, hidden: true } }]).doc).lanes).toBe(10);
    expect(clipId).toBeTruthy();
    expect(maxDecodeLanes(createProject({ id: 'prj_e', name: 'E' }))).toEqual({ lanes: 0, fromFrame: 0, toFrame: 0 });
  });
});

describe('seek equals sequential', () => {
  it('500 frames evaluated in random order deep-equal the same frames evaluated in order (echo with a cut, stutter on the music, shutter on a title)', () => {
    const { doc, clipId } = project('time.echo', { count: 5, delay: 2 }, { duration: f(200), sourceIn: T.rt(0, 1) });
    let d = tx(doc, [{ op: 'split_clip', args: { clipId, at: f(91) } }]).doc;
    let r = tx(d, [{ op: 'import_asset', args: { asset: song } }, { op: 'add_text', args: { text: 'X', start: f(0), duration: f(500) } }], true);
    const songId = r.results[0]!.output!.assetId as string, textId = r.results[1]!.output!.clipId as string;
    r = tx(r.doc, [
      { op: 'attach_analysis', args: { assetId: songId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-17T00:00:00Z', times: Array.from({ length: 40 }, (_, i) => T.rt(400 * i, 1000)), bpm: 150 } },
      { op: 'add_clip', args: { assetId: songId, start: f(0) } },
      { op: 'add_effect', args: { clipId: textId, type: 'time.stutter', params: { follow: 'music', hold: 4 } } },
      { op: 'set_keyframe', args: { clipId: textId, property: 'x', time: f(0), value: -0.4 } },
      { op: 'set_keyframe', args: { clipId: textId, property: 'x', time: f(499), value: 0.4 } },
    ], true);
    d = r.doc;
    const frames = Array.from({ length: 500 }, (_, i) => i);
    const inOrder = frames.map((i) => JSON.stringify(evaluate(d, f(i))));
    let s = 7;
    const shuffled = [...frames].sort(() => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) & 1024 ? 1 : -1));
    // a fresh copy of the document: nothing cached from the sequential pass can be what makes them agree
    const fresh = structuredClone(d);
    for (const i of shuffled) expect(JSON.stringify(evaluate(fresh, f(i)))).toBe(inOrder[i]);
  });
});

describe('describeMoment', () => {
  it('reports the taps (lane, source frame, weight) and the shown frame of a stutter', () => {
    const { doc } = project('time.echo', { count: 3, delay: 3 });
    const m = describeMoment(doc, f(30));
    expect(m.layers[0]).toMatchObject({ time: { type: 'time.echo', taps: [{ lane: 0, sourceFrameIndex: 60 }, { lane: 1, sourceFrameIndex: 57 }, { lane: 2, sourceFrameIndex: 54 }] } });
    expect((m.layers[0] as { time: { taps: { weight: number }[] } }).time.taps.reduce((s, t) => s + t.weight, 0)).toBe(4096);
    expect(describeMoment(project('time.stutter', { hold: 4 }).doc, f(31)).layers[0]).toMatchObject({ remap: { type: 'time.stutter', shownFrame: 28 } });
  });
  it('names the modulated parameters of each effect with their values at that moment', () => {
    const { doc, clipId } = project('blur.gaussian', { radius: 0.01 });
    const fxId = (videoTrack(doc).clips[0] as { effects: { id: string }[] }).effects[0]!.id;
    const d = tx(doc, [{ op: 'set_effect_modulator', args: { clipId, effectId: fxId, param: 'radius', modulator: { depth: 0.01 } } }]).doc;
    const m = describeMoment(d, f(10)).layers[0] as { modulated?: { effect: string; index: number; params: Record<string, unknown> }[] };
    expect(m.modulated).toEqual([{ effect: 'blur.gaussian', index: 0, params: { radius: expect.any(Number) } }]);
  });
});
