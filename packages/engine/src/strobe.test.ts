/**
 * The strobe's safety rule: never more than three flashes in any one-second period (faster flashing is a seizure risk).
 * Everything here goes through the functions the renderer calls: `evaluate` (beat position, effect parameters at the
 * frame) and the strobe's own `params` in gpu.ts, whose fourth number is the strength of the flash mixed into the picture.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, effectParamsAt, findClip, OpError, validateProject, animatableParams, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, GPU_EFFECTS } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const ms = (n: number) => T.rt(Math.round(n), 1000);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `s${seed++}_`, actor: 'test', allowInternal });
const song = (name: string, seconds: number) => ({ kind: 'audio' as const, name, contentHash: `sha256:${(name.length % 10).toString().repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' } });

/** A project with one piece of analysed music (beat times in milliseconds of the file; `meter` > 0 marks every meter-th beat as a bar start). */
function withMusic(beatsMs: number[], meter = 0, seconds = 600) {
  let r = tx(createProject({ id: 'prj_s', name: 'S' }), [{ op: 'import_asset', args: { asset: song('song.wav', seconds) } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const times = beatsMs.map(ms);
  r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times, bpm: 120, ...(meter ? { downbeats: times.filter((_, i) => i % meter === 0), meter } : {}) } }], true);
  return { doc: r.doc, assetId };
}
const every = (stepMs: number, count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i * stepMs);
/** Put a title with a strobe over frames [0, frames) and return the document and the title's id. */
function withStrobe(doc: ProjectDocument, params: Record<string, unknown>, frames = 600, startFrame = 0) {
  let r = tx(doc, [{ op: 'add_text', args: { text: 'X', start: f(startFrame), duration: f(frames) } }]);
  const titleId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId: titleId, type: 'light.strobe', params: { amount: 1, ...params } } }]);
  return { doc: r.doc, titleId, effectId: r.results[0]!.output!.effectId as string };
}
/** The strength of the flash at a moment, computed exactly as the compositor does for a frame at that time (0 when the title is not there). */
function flashAt(doc: ProjectDocument, time: T.RationalTime): number {
  const g = evaluate(doc, time);
  const layer = g.layers.find((l) => l.kind === 'text');
  const fx = layer?.effects?.find((e) => e.type === 'light.strobe');
  if (!fx) return 0;
  return GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: g.beat ?? null })[3]!;
}
/** The strength of the flash on a grid of `perSecond` samples from frame `fromFrame` for `seconds`. */
const strengths = (doc: ProjectDocument, seconds: number, perSecond = 240, fromFrame = 0): number[] =>
  Array.from({ length: seconds * perSecond }, (_, i) => flashAt(doc, T.add(T.rt(i, perSecond), f(fromFrame))));
/** Sample numbers of the flash onsets: the strength rises through half of `amount`. `before` is the strength before the first sample (0 = nothing was flashing). */
function onsetsOf(samples: number[], amount = 1, before = 0): number[] {
  const out: number[] = [];
  samples.forEach((now, i) => { if (before < amount / 2 && now >= amount / 2) out.push(i); before = now; });
  return out;
}
const onsets = (doc: ProjectDocument, seconds: number, perSecond = 240, fromFrame = 0, amount = 1) => onsetsOf(strengths(doc, seconds, perSecond, fromFrame), amount);
/** The largest number of onsets inside any window of one second (`perSecond` consecutive samples). */
function mostInOneSecond(at: number[], perSecond = 240): number {
  let most = 0;
  for (let i = 0, j = 0; i < at.length; i++) { while (at[i]! - at[j]! >= perSecond) j++; most = Math.max(most, i - j + 1); }
  return most;
}

describe('strobe: at most three flashes in any one second', () => {
  it('ordinary music: a flash on every beat (120 beats a minute), on every second beat with every = 2', () => {
    const { doc, assetId } = withMusic(every(500, 60, 1000), 4);
    const placed = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]).doc;
    const all = onsets(withStrobe(placed, { follow: 'music' }).doc, 10);
    expect(all.map((i) => i / 240)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5]);
    expect(onsets(withStrobe(placed, { follow: 'music', every: 2 }).doc, 10).map((i) => i / 240)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('reported: music with four-beat bars played three times as fast (the thinned count used to restart at every bar)', () => {
    // 128 beats a minute at three times the speed: 6.4 beats a second
    const { doc, assetId } = withMusic(every(60000 / 128, 400), 4);
    let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]);
    r = tx(r.doc, [{ op: 'set_clip_speed', args: { clipId: r.results[0]!.output!.clipId as string, speed: 3 } }]);
    const at = onsets(withStrobe(r.doc, { follow: 'music' }).doc, 20);
    expect(at.length).toBeGreaterThan(20); // it does flash
    expect(mostInOneSecond(at)).toBeLessThanOrEqual(3);
    // three-beat bars at double speed, every second beat
    const waltz = withMusic(every(400, 400), 3);
    r = tx(waltz.doc, [{ op: 'add_clip', args: { assetId: waltz.assetId, start: f(0) } }]);
    r = tx(r.doc, [{ op: 'set_clip_speed', args: { clipId: r.results[0]!.output!.clipId as string, speed: 2 } }]);
    expect(mostInOneSecond(onsets(withStrobe(r.doc, { follow: 'music', every: 2 }).doc, 20))).toBeLessThanOrEqual(3);
  });

  it('reported: every = 8 on music with four-beat bars hits every eighth beat, as it does without bars', () => {
    const run = (meter: number) => {
      const { doc, assetId } = withMusic(every(500, 80, 1000), meter);
      return onsets(withStrobe(tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]).doc, { follow: 'music', every: 8 }).doc, 20).map((i) => i / 240);
    };
    expect(run(4)).toEqual([1, 5, 9, 13, 17]);
    expect(run(0)).toEqual([1, 5, 9, 13, 17]);
  });

  it('reported: a gradual speed change that was trimmed or split (the beat spacing used to be taken from the wrong place in the change)', () => {
    for (const curve of ['even', 'smooth'] as const) for (const how of ['trim', 'split'] as const) {
      const { doc, assetId } = withMusic(every(500, 240), 4, 120);
      let r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(1800) } }]);
      const clipId = r.results[0]!.output!.clipId as string;
      r = tx(r.doc, [{ op: 'set_clip_speed_ramp', args: { clipId, from: 1, to: 4, curve } }]); // 60 s of source in 24 s
      r = tx(r.doc, [how === 'trim' ? { op: 'trim_clip', args: { clipId, edge: 'start', to: f(360) } } : { op: 'split_clip', args: { clipId, at: f(360) } }]);
      const at = onsets(withStrobe(r.doc, { follow: 'music' }, 720).doc, 12, 240, 360);
      expect(at.length, `${curve} ${how}`).toBeGreaterThan(10);
      expect(mostInOneSecond(at), `${curve} ${how}`).toBeLessThanOrEqual(3);
    }
  });

  it('reported: the rate of a steady strobe cannot be animated, and keys that a document carries anyway are not used', () => {
    const made = withStrobe(createProject({ id: 'prj_k', name: 'K' }), { rate: 1 }, 120, 210);
    for (const param of ['rate', 'every', 'amount'])
      expect(() => tx(made.doc, [{ op: 'set_effect_keyframe', args: { clipId: made.titleId, effectId: made.effectId, param, time: f(0), value: 1 } }]), param).toThrow(OpError);
    expect(animatableParams('light.strobe')).toEqual([]);
    // a document that already holds such keys: "a strobe that speeds up", rate keyed 1 at the start and 3 at the end of a title at second 7
    const doc = structuredClone(made.doc);
    const fx = findClip(doc, made.titleId)!.clip.effects![0]!;
    fx.keyframes = { rate: [{ time: f(0), value: 1, easing: 'linear' }, { time: f(119), value: 3, easing: 'linear' }], amount: [{ time: f(0), value: 0, easing: 'hold' }, { time: f(1), value: 1, easing: 'hold' }] };
    expect(effectParamsAt(fx, f(60))).toEqual(fx.params);
    const at = onsets(doc, 4, 240, 210);
    expect(at.map((i) => i / 240)).toEqual([0, 1, 2, 3]); // one flash a second, at seconds 7, 8, 9 and 10, as without the keys
    expect(validateProject(doc).map((i) => i.code)).toEqual(['effect_keyframes', 'effect_keyframes']); // and the document is reported as invalid
  });
});

/**
 * The property itself. The strength is sampled 240 times a second from the first frame of the title; that first frame is
 * the starting point, not a flash start (a clip can begin while a flash that fell before it is still fading: see gpu.ts).
 * Required: no window of one second holds more than three flash starts, and the strength never goes up anywhere else.
 */
function expectSafe(doc: ProjectDocument, titleStartFrame: number, seconds: number, amount = 1): number {
  const samples = strengths(doc, seconds, 240, titleStartFrame);
  const starts = onsetsOf(samples, amount, samples[0]!);
  expect(mostInOneSecond(starts)).toBeLessThanOrEqual(3);
  const isStart = new Set(starts);
  for (let i = 1; i < samples.length; i++) if (samples[i]! > samples[i - 1]! + 1e-9 && !isStart.has(i)) expect.fail(`the strength rises from ${samples[i - 1]} to ${samples[i]} at sample ${i} without a flash start`);
  return starts.length;
}

// Random cases per property. STROBE_RUNS=1500 is a longer hunt (about three minutes). A failure prints its seed and is not shrunk: one case takes a tenth of a second.
const RUNS = Number(process.env.STROBE_RUNS ?? 60);

describe('strobe: the three-a-second limit as a property', () => {
  // beat lists: uneven gaps of 0.05 s to 2 s, runs of quick beats, and an almost even quick grid
  const gapsMs = fc.oneof(
    fc.array(fc.oneof({ weight: 3, arbitrary: fc.integer({ min: 50, max: 2000 }) }, { weight: 2, arbitrary: fc.integer({ min: 50, max: 400 }) }), { minLength: 80, maxLength: 400 }),
    fc.tuple(fc.integer({ min: 50, max: 700 }), fc.integer({ min: 0, max: 25 }), fc.array(fc.integer({ min: -1000, max: 1000 }), { minLength: 150, maxLength: 600 })).map(([step, jitter, js]) => js.map((j) => Math.max(50, step + Math.round((j * jitter) / 1000)))),
  );
  const speed = fc.oneof(
    fc.constant(null),
    fc.integer({ min: 100, max: 8000 }).map((x) => ({ speed: x / 1000 })),
    fc.tuple(fc.integer({ min: 100, max: 8000 }), fc.integer({ min: 100, max: 8000 }), fc.constantFrom('even' as const, 'smooth' as const)).filter(([a, b]) => a !== b).map(([a, b, curve]) => ({ from: a / 1000, to: b / 1000, curve })),
  );
  const music = fc.record({
    firstBeatMs: fc.integer({ min: 0, max: 3000 }), gaps: gapsMs, meter: fc.constantFrom(0, 0, 2, 3, 4, 4, 5, 7), barFrom: fc.integer({ min: 0, max: 6 }),
    every: fc.oneof({ weight: 3, arbitrary: fc.constantFrom(1, 1, 2, 3, 4) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 16 }) }),
    startFrame: fc.integer({ min: 0, max: 120 }), sourceInMs: fc.integer({ min: 0, max: 4000 }), frames: fc.integer({ min: 400, max: 900 }), speed,
    trimStart: fc.option(fc.integer({ min: 1, max: 200 })), trimEnd: fc.option(fc.integer({ min: 1, max: 200 })), splitAt: fc.option(fc.integer({ min: 1, max: 600 })),
    // a second stretch of the same music on another sound track, listed before or after the first: the music that is followed changes on the way
    second: fc.option(fc.record({ first: fc.boolean(), startFrame: fc.integer({ min: 0, max: 600 }), sourceInMs: fc.integer({ min: 0, max: 20000 }), frames: fc.integer({ min: 20, max: 400 }), speed })),
    titleStart: fc.integer({ min: 0, max: 90 }), rate: fc.integer({ min: 0, max: 3000 }),
  });
  /** Apply an edit if the document allows it (a trim or split outside the clip is refused, and then simply not made). */
  const attempt = (doc: ProjectDocument, ops: OpCall[]): ProjectDocument => { try { return tx(doc, ops).doc; } catch (e) { if (e instanceof OpError) return doc; throw e; } };

  it('following the music: any beats, bars, every, speed, gradual speed change, trim, split and second piece of music', () => {
    let flashes = 0, runs = 0;
    fc.assert(fc.property(music, (m) => {
      const beats: number[] = [];
      let t = m.firstBeatMs;
      for (const g of [0, ...m.gaps]) beats.push((t += g));
      let doc = createProject({ id: 'prj_p', name: 'P' });
      let r = tx(doc, [{ op: 'import_asset', args: { asset: song('song.wav', 3600) } }], true);
      const assetId = r.results[0]!.output!.assetId as string;
      const times = beats.map(ms);
      r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times, bpm: null, ...(m.meter ? { downbeats: times.filter((_, i) => i >= m.barFrom && (i - m.barFrom) % m.meter === 0), meter: m.meter } : {}) } }], true);
      r = tx(r.doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
      const extraTrack = r.results[0]!.output!.trackId as string;
      const place = (d: ProjectDocument, c: { startFrame: number; sourceInMs: number; frames: number; speed: typeof m.speed }, trackId?: string): { doc: ProjectDocument; clipId: string } => {
        // the clip is placed long enough that it still covers `frames` frames once it plays faster
        const factor = c.speed === null ? 1 : 'speed' in c.speed ? c.speed.speed : (c.speed.from + c.speed.to) / 2;
        const made = tx(d, [{ op: 'add_clip', args: { assetId, start: f(c.startFrame), sourceIn: ms(c.sourceInMs), duration: f(Math.max(2, Math.round(c.frames * factor))), ...(trackId ? { trackId } : {}) } }]);
        const clipId = made.results[0]!.output!.clipId as string;
        return { clipId, doc: c.speed === null ? made.doc : attempt(made.doc, ['speed' in c.speed ? { op: 'set_clip_speed', args: { clipId, speed: c.speed.speed } } : { op: 'set_clip_speed_ramp', args: { clipId, from: c.speed.from, to: c.speed.to, curve: c.speed.curve } }]) };
      };
      // tracks are followed in their order: the piece placed on the track that came first is the one preferred
      const main = place(r.doc, m, m.second && m.second.first ? extraTrack : undefined);
      doc = main.doc;
      if (m.second) doc = place(doc, m.second, m.second.first ? undefined : extraTrack).doc;
      if (m.trimStart) doc = attempt(doc, [{ op: 'trim_clip', args: { clipId: main.clipId, edge: 'start', to: f(m.startFrame + m.trimStart) } }]);
      if (m.trimEnd) { const c = findClip(doc, main.clipId)!.clip; doc = attempt(doc, [{ op: 'trim_clip', args: { clipId: main.clipId, edge: 'end', to: T.sub(T.add(c.start, c.duration), f(m.trimEnd)) } }]); }
      if (m.splitAt) doc = attempt(doc, [{ op: 'split_clip', args: { clipId: main.clipId, at: f(m.startFrame + (m.trimStart ?? 0) + m.splitAt) } }]);
      expect(validateProject(doc)).toEqual([]);
      doc = withStrobe(doc, { follow: 'music', every: m.every, rate: m.rate / 1000 }, 600, m.titleStart).doc;
      flashes += expectSafe(doc, m.titleStart, 20);
      runs++;
    }), { numRuns: RUNS, endOnFailure: true });
    expect(flashes / runs).toBeGreaterThan(10); // the property is not satisfied by never flashing
  }, 60_000 + RUNS * 1000);

  it('steady: any rate the schema allows, any place on the timeline, with or without music under it', () => {
    const rate = fc.oneof(fc.integer({ min: 0, max: 3000 }).map((x) => x / 1000), fc.constantFrom(3, 2.999, 2.93, 2.5, 1, 0.01, 0), fc.double({ min: 0, max: 3, noNaN: true }));
    fc.assert(fc.property(rate, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 1, max: 100 }), fc.boolean(), fc.integer({ min: 1, max: 16 }), (rateValue, start, amountPct, musicUnder, everyN) => {
      let doc = createProject({ id: 'prj_q', name: 'Q' });
      if (musicUnder) { const m = withMusic(every(137, 2000), 4); doc = tx(m.doc, [{ op: 'add_clip', args: { assetId: m.assetId, start: f(0) } }]).doc; }
      const made = withStrobe(doc, { rate: rateValue, amount: amountPct / 100, every: everyN }, 360, start);
      const count = expectSafe(made.doc, start, 12, amountPct / 100);
      expect(count).toBeLessThanOrEqual(Math.floor(12 * rateValue) + 1);
      if (rateValue >= 0.5) expect(count).toBeGreaterThanOrEqual(Math.floor(12 * rateValue) - 1); // and it does flash at its rate
    }), { numRuns: RUNS, endOnFailure: true });
    // the schema refuses a faster rate
    expect(() => withStrobe(createProject({ id: 'prj_r', name: 'R' }), { rate: 3.01 })).toThrow(OpError);
  }, 60_000 + RUNS * 1000);

  it('following the music where no analysed music plays there is no flash, and none right after the music changes', () => {
    // music from second 2 to second 6 (beats every half second), then nothing
    const { doc, assetId } = withMusic(every(500, 100), 4);
    const one = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(60), duration: f(120) } }]);
    const strobe = withStrobe(one.doc, { follow: 'music', rate: 3 }, 600).doc;
    expect(onsets(strobe, 10).map((i) => i / 240)).toEqual([2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
    expect(Math.max(...strengths(strobe, 2), ...strengths(strobe, 3, 240, 210))).toBe(0);
    // the same music cut at 4.1 s into two pieces that play one after the other: the second piece's first beat (4.5 s) is 0.4 s after the cut and flashes
    const cut = tx(one.doc, [{ op: 'split_clip', args: { clipId: one.results[0]!.output!.clipId as string, at: f(123) } }]).doc;
    expect(onsets(withStrobe(cut, { follow: 'music' }, 600).doc, 10).map((i) => i / 240)).toEqual([2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
    const cutLate = tx(one.doc, [{ op: 'split_clip', args: { clipId: one.results[0]!.output!.clipId as string, at: f(132) } }]).doc; // cut at 4.4 s: the beat at 4.5 s is too close after it
    expect(onsets(withStrobe(cutLate, { follow: 'music' }, 600).doc, 10).map((i) => i / 240)).toEqual([2, 2.5, 3, 3.5, 4, 5, 5.5]);
  });
});
