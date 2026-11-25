/**
 * The strobe's safety rule: never more than three flashes in any one-second period (faster flashing is a seizure risk).
 * Everything here goes through the functions the renderer calls: `evaluate` (beat position, effect parameters at the
 * frame) and the strobe's own `params` in gpu.ts, whose fourth number is the strength of the flash mixed into the picture.
 *
 * The rule is kept for the timeline as a whole: every flash start of every strobe comes from one schedule
 * (strobeSchedule.ts) in which two starts are never fewer than `flashGapFrames` frames apart, whichever strobes they
 * belong to. The tests below sample what the renderer receives and count flash starts in every one-second period.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, effectParamsAt, findClip, OpError, validateProject, animatableParams, SPEED_CURVE_IDS, beatSwitchFrame, followedBeats, lightStartFrame, switchFrame, transitionDef, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate, GPU_EFFECTS } from './index.ts';
import { FLASH_SINCE, thinnedHits } from './gpu.ts';
import { flashGapFrames, flashSchedule, type FlashSchedule } from './strobeSchedule.ts';
/** The most flashes a second a steady strobe can show at a frame rate: one every `flashGapFrames` frames. */
const maxRate = (rate: Rate) => rate.num / rate.den / flashGapFrames(rate.num / rate.den);

type Rate = { num: number; den: number };
const R: Rate = { num: 30, den: 1 };
const f = (n: number, rate: Rate = R) => T.frameTime(n, rate);
const ms = (n: number) => T.rt(Math.round(n), 1000);
let seed = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `s${seed++}_`, actor: 'test', allowInternal });
/** Apply an edit if the document allows it (a trim or split outside the clip is refused, and then simply not made). */
const attempt = (doc: ProjectDocument, ops: OpCall[]): ProjectDocument => { try { return tx(doc, ops).doc; } catch (e) { if (e instanceof OpError) return doc; throw e; } };
const song = (name: string, seconds: number) => ({ kind: 'audio' as const, name, contentHash: `sha256:${(name.length % 10).toString().repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(seconds, 1), audio: { sampleRate: 48000, channels: 2, codec: 'pcm_s16le' }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-16T00:00:00Z', importedBy: 'test' } });

/** A project with one piece of analysed music (beat times in milliseconds of the file; `meter` > 0 marks every meter-th beat as a bar start). */
function withMusic(beatsMs: number[], meter = 0, seconds = 600, rate: Rate = R) {
  let r = tx(createProject({ id: 'prj_s', name: 'S', frameRate: rate }), [{ op: 'import_asset', args: { asset: song('song.wav', seconds) } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  const times = beatsMs.map(ms);
  r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times, bpm: 120, ...(meter ? { downbeats: times.filter((_, i) => i % meter === 0), meter } : {}) } }], true);
  return { doc: r.doc, assetId };
}
const every = (stepMs: number, count: number, from = 0) => Array.from({ length: count }, (_, i) => from + i * stepMs);
/** Put a title with a strobe over frames [startFrame, startFrame + frames) and return the document and the title's id. */
function withStrobe(doc: ProjectDocument, params: Record<string, unknown>, frames = 600, startFrame = 0) {
  const rate = doc.settings.frameRate;
  let r = tx(doc, [{ op: 'add_text', args: { text: 'X', start: f(startFrame, rate), duration: f(frames, rate) } }]);
  const titleId = r.results[0]!.output!.clipId as string;
  r = tx(r.doc, [{ op: 'add_effect', args: { clipId: titleId, type: 'light.strobe', params: { amount: 1, ...params } } }]);
  return { doc: r.doc, titleId, effectId: r.results[0]!.output!.effectId as string };
}
/** Cut the title that covers each of these frames at that frame (both pieces keep the strobe); a cut that is refused is not made. */
function cutTitle(doc: ProjectDocument, frames: number[]): ProjectDocument {
  for (const frame of frames) {
    const at = f(frame, doc.settings.frameRate);
    const title = Object.values(doc.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).find((c) => c.type === 'text' && T.lt(c.start, at) && T.lt(at, T.add(c.start, c.duration)));
    if (title) doc = attempt(doc, [{ op: 'split_clip', args: { clipId: title.id, at } }]);
  }
  return doc;
}
/** The strongest strobe flash in the picture at a moment, computed exactly as the compositor does for a frame at that time: over every strobe on every layer (0 when there is none). */
function flashAt(doc: ProjectDocument, time: T.RationalTime): number {
  const g = evaluate(doc, time);
  let most = 0;
  for (const layer of g.layers) for (const fx of (layer as { effects?: { type: string; params: Record<string, unknown> }[] }).effects ?? [])
    if (fx.type === 'light.strobe') most = Math.max(most, GPU_EFFECTS['light.strobe']!.params(fx.params, { width: g.width, height: g.height, seconds: T.toSeconds(g.time), beat: g.beat ?? null })[3]!);
  return most;
}
/** The strength of the flash on a grid of `perSecond` samples from frame `fromFrame` for `seconds`. */
const strengths = (doc: ProjectDocument, seconds: number, perSecond = 240, fromFrame = 0): number[] =>
  Array.from({ length: seconds * perSecond }, (_, i) => flashAt(doc, T.add(T.rt(i, perSecond), f(fromFrame, doc.settings.frameRate))));
/** The strength of the flash on each rendered frame, from frame `fromFrame` for `seconds`. */
const frameStrengths = (doc: ProjectDocument, seconds: number, fromFrame = 0): number[] =>
  Array.from({ length: Math.floor((seconds * doc.settings.frameRate.num) / doc.settings.frameRate.den) }, (_, i) => flashAt(doc, f(fromFrame + i, doc.settings.frameRate)));
/**
 * Sample numbers of the flash onsets: the strength rises through half of `amount`. `before` is the strength before the
 * first sample: 0, nothing was flashing, so a clip whose first frame is already bright starts a flash there.
 */
function onsetsOf(samples: number[], amount = 1, before = 0): number[] {
  const out: number[] = [];
  samples.forEach((now, i) => { if (before < amount / 2 && now >= amount / 2) out.push(i); before = now; });
  return out;
}
const onsets = (doc: ProjectDocument, seconds: number, perSecond = 240, fromFrame = 0, amount = 1) => onsetsOf(strengths(doc, seconds, perSecond, fromFrame), amount);
/** The largest number of onsets inside any period of one second: `perSecond` samples (a number with a fraction for frame rates such as 29.97), the first included and the last not. */
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
    // such a document stays valid, so it can still be edited (the keys are inert; no op adds new ones) …
    expect(validateProject(doc)).toEqual([]);
    const edited = tx(doc, [{ op: 'update_effect', args: { clipId: made.titleId, effectId: made.effectId, params: { color: '#FF0000' } } }]).doc;
    expect(onsets(edited, 4, 240, 210).map((i) => i / 240)).toEqual([0, 1, 2, 3]);
    // … while keys on a parameter that never existed are still refused
    const bad = structuredClone(doc);
    findClip(bad, made.titleId)!.clip.effects![0]!.keyframes = { nothing: [{ time: f(0), value: 1, easing: 'linear' }] };
    expect(validateProject(bad).map((i) => i.code)).toEqual(['effect_keyframes']);
  });

  it('reported: a clip that begins just after a flash time does not show the rest of that flash; flashes start inside the clip only', () => {
    const R60: Rate = { num: 60, den: 1 };
    // steady, 60 frames a second, the fastest rate the schema allows: the title begins one or two frames after a flash time of the steady grid
    for (const rate of [3, 2.99, 2.5]) {
      const effective = Math.min(rate, maxRate(R60));
      let found = 0;
      for (let start = 1; start < 4000 && found < 3; start++) {
        const sinceFlash = ((start / 60) * effective) % 1 / effective; // seconds from the last time of the steady grid to the title's first frame
        if (sinceFlash < 1e-6 || sinceFlash > 2.5 / 60) continue;
        found++;
        const made = withStrobe(createProject({ id: 'prj_f', name: 'F', frameRate: R60 }), { rate }, 240, start);
        const frames = frameStrengths(made.doc, 4, start);
        expect(frames[0], `rate ${rate} from frame ${start}`).toBe(0); // it used to be the bright rest of a flash from before the clip
        expect(mostInOneSecond(onsetsOf(frames), 60), `rate ${rate} from frame ${start}`).toBeLessThanOrEqual(3);
      }
      expect(found).toBe(3);
    }
    // following music with beats 0.338 s apart, the title begins two frames after a beat: nothing on its first frame, and never more than three a second
    const { doc, assetId } = withMusic(every(338, 200, 1000), 0, 600, R60);
    const music = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0, R60) } }]).doc;
    const frames = frameStrengths(withStrobe(music, { follow: 'music' }, 240, 62).doc, 4, 62);
    expect(frames[0]).toBe(0);
    expect(mostInOneSecond(onsetsOf(frames), 60)).toBeLessThanOrEqual(3);
    // what makes it hold: flash starts are a third of a second, rounded up to whole frames, plus one frame apart
    for (const fps of [10, 12, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]) expect(flashGapFrames(fps) / fps).toBeGreaterThan(1 / 3);
    // a steady strobe set to 3 a second flashes once every 11 frames at 30 frames a second
    expect(onsets(withStrobe(createProject({ id: 'prj_g', name: 'G' }), { rate: 3 }).doc, 20).length).toBe(Math.floor((20 * 30 - 1) / 11) + 1);
  });

  it('reported: music in several pieces (cuts, a speed change in steps, a speed curve) keeps its flashes; the pieces of a cut clip flash exactly like the clip', () => {
    const beats = every(500, 400); // 120 beats a minute, bars of four
    const flashes = (edit: (doc: ProjectDocument, clipId: string) => ProjectDocument) => {
      const { doc, assetId } = withMusic(beats, 4, 3600);
      const made = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0), duration: f(600) } }]);
      const at = onsets(withStrobe(edit(made.doc, made.results[0]!.output!.clipId as string), { follow: 'music' }, 900).doc, 10);
      expect(mostInOneSecond(at)).toBeLessThanOrEqual(3);
      return at;
    };
    const pieceAt = (doc: ProjectDocument, frame: number) => doc.sequences[doc.mainSequenceId]!.tracks.flatMap((t) => (t.kind === 'audio' ? t.clips : [])).find((c) => T.lt(c.start, f(frame)) && T.lt(f(frame), T.add(c.start, c.duration)))!.id;
    const whole = flashes((d) => d);
    expect(whole).toHaveLength(20);
    // cut at 3.33 s, 6.67 s and 8.33 s (not on beats): the same flashes (two were missing: 3.5 s and 8.5 s, each less than a third of a second after a cut)
    expect(flashes((d) => { for (const at of [100, 200, 250]) d = tx(d, [{ op: 'split_clip', args: { clipId: pieceAt(d, at), at: f(at) } }]).doc; return d; })).toEqual(whole);
    // speed 1 to 3 in 24 steps: 35 beats in the first ten seconds, at most 23 of them a third of a second after the one before (6 used to flash)
    expect(flashes((d, clipId) => tx(d, [{ op: 'speed_ramp', args: { clipId, from: 1, to: 3, steps: 24 } }]).doc).length).toBeGreaterThanOrEqual(20);
    expect(flashes((d, clipId) => tx(d, [{ op: 'speed_ramp', args: { clipId, from: 1, to: 3, steps: 12 } }]).doc).length).toBeGreaterThanOrEqual(20); // was 15
    // the "surge" curve, 15 pieces (11 used to flash)
    expect(flashes((d, clipId) => tx(d, [{ op: 'apply_speed_curve', args: { clipId, preset: 'surge' } }]).doc).length).toBeGreaterThanOrEqual(18);
  });

  it('a title cut into pieces flashes exactly like the title in one piece (each piece carries a copy of the strobe)', () => {
    const { doc, assetId } = withMusic(every(410, 400), 4);
    const music = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]).doc;
    for (const params of [{ rate: 2.9 }, { rate: 1.3 }, { follow: 'music' }, { follow: 'music', every: 3 }]) {
      const one = withStrobe(music, params, 300, 17).doc, pieces = cutTitle(one, [40, 41, 77, 150, 233]);
      expect(evaluate(pieces, f(41)).layers.find((l) => l.kind === 'text')).not.toEqual(evaluate(one, f(41)).layers.find((l) => l.kind === 'text')); // another clip
      expect(strengths(pieces, 10, 240, 17)).toEqual(strengths(one, 10, 240, 17));
    }
  });

  it('reported (property seed 1786843907): a flash time inside the last frame before a cut is shown on the cut frame, as in the uncut title', () => {
    // 24 fps, gap 9 frames, steady 2.646 a second (one every 9.07 frames). Title on frames 4990 … 5301, cut at 5026, 5062 and 5180.
    // Flash 558 (558 / 2.646 s = timeline frame 5061.22) and flash 571 (frame 5179.14) are shown on frames 5062 and 5180 uncut;
    // cut there, the piece before the cut ended on that frame and the piece after began after the flash time: both were dropped (29 of 31).
    const R24: Rate = { num: 24, den: 1 };
    const one = withStrobe(createProject({ id: 'prj_c', name: 'C', frameRate: R24 }), { rate: 2.646 }, 312, 4990).doc;
    const pieces = cutTitle(one, [5026, 5062, 5180]);
    const starts = (d: ProjectDocument) => onsetsOf(frameStrengths(d, 12, 4990)).map((i) => 4990 + i);
    expect(starts(one)).toHaveLength(31);
    expect(starts(one)).toEqual(expect.arrayContaining([5062, 5180]));
    expect(starts(pieces)).toEqual(starts(one));
    expect(strengths(pieces, 12, 240, 4990)).toEqual(strengths(one, 12, 240, 4990));
    // the same for a strobe that follows the music: a beat at 2.49 s (frame 74.7 at 30 fps) is shown on frame 75; cut the title there
    const { doc, assetId } = withMusic(every(500, 400, 990), 4);
    const music = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0) } }]).doc;
    const follow = withStrobe(music, { follow: 'music' }, 300).doc;
    expect(onsetsOf(frameStrengths(follow, 4))).toContain(75);
    expect(strengths(cutTitle(follow, [75]), 10)).toEqual(strengths(follow, 10));
  });

  it('exhaustive near a cut: a cut title starts exactly the flashes of the uncut title, never one more, and starts stay a gap apart', () => {
    // Every frame rate the properties use, rates at and around the limit and with flash times close to frame edges, every
    // third start within two gaps, one cut at every frame of the first three gaps (and a second cut a frame or a gap later).
    const all = (s: FlashSchedule) => [...s.shown.values()].flatMap((a) => [...a]).sort((a, b) => a - b);
    const big = process.env.STROBE_EXHAUSTIVE === '1';
    const rates = big ? Array.from({ length: 301 }, (_, i) => i / 100) : [3, 2.999, 2.97, 2.9, 2.646, 2.5, 2.4, 1.7, 1.01, 0.77];
    let cases = 0;
    for (const frameRate of [R, { num: 24, den: 1 }, { num: 25, den: 1 }, { num: 60, den: 1 }, { num: 30000, den: 1001 }, { num: 24000, den: 1001 }, { num: 60000, den: 1001 }]) {
      const fpsN = frameRate.num / frameRate.den, gap = flashGapFrames(fpsN), length = 4 * gap;
      for (const rate of rates) for (let start = 1000; start < 1000 + 2 * gap; start += 3) {
        const one = withStrobe(createProject({ id: 'prj_e', name: 'E', frameRate }), { rate }, length, start).doc;
        const want = all(flashSchedule(one));
        for (let i = 1; i < want.length; i++) expect(want[i]! - want[i - 1]!).toBeGreaterThanOrEqual(gap);
        for (let c = 1; c < 3 * gap; c++) for (const second of [0, 1, gap]) {
          const cuts = second && c + second < length ? [start + c, start + c + second] : [start + c];
          const got = all(flashSchedule(cutTitle(one, cuts)));
          expect(got, `${fpsN} fps, rate ${rate}, title from ${start}, cut at ${cuts}`).toEqual(want);
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  }, process.env.STROBE_EXHAUSTIVE === '1' ? 3_600_000 : 120_000);
});

/**
 * The property itself. The strength is sampled 240 times a second from the first frame of the title, and once per rendered
 * frame of the project. Required of both: no period of one second holds more than three flash starts, the first sample
 * included (a clip can begin while a flash that fell just before it is still bright: that is a flash start too). Required
 * of the fine samples: the strength never goes up anywhere else after the first sample.
 */
function expectSafe(doc: ProjectDocument, titleStartFrame: number, seconds: number, amount = 1): number {
  const samples = strengths(doc, seconds, 240, titleStartFrame);
  const starts = onsetsOf(samples, amount);
  expect(mostInOneSecond(starts)).toBeLessThanOrEqual(3);
  const isStart = new Set(starts);
  for (let i = 1; i < samples.length; i++) if (samples[i]! > samples[i - 1]! + 1e-9 && !isStart.has(i)) expect.fail(`the strength rises from ${samples[i - 1]} to ${samples[i]} at sample ${i} without a flash start`);
  const rate = doc.settings.frameRate;
  expect(mostInOneSecond(onsetsOf(frameStrengths(doc, seconds, titleStartFrame), amount), rate.num / rate.den)).toBeLessThanOrEqual(3);
  return starts.length;
}

// Random cases per property. STROBE_RUNS=1500 is a longer hunt (some minutes). A failure prints its seed and is not shrunk: one case takes a tenth of a second.
const RUNS = Number(process.env.STROBE_RUNS ?? 60);
// STROBE_SEED=<seed> replays a reported failure (with -t naming its property: the seed belongs to one property's run).
const REPLAY = process.env.STROBE_SEED ? { seed: Number(process.env.STROBE_SEED) } : {};

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
  // frames per second of the project: whole numbers and the broadcast rates that are not
  const fps = fc.constantFrom<Rate>(R, R, { num: 24, den: 1 }, { num: 25, den: 1 }, { num: 60, den: 1 }, { num: 30000, den: 1001 }, { num: 24000, den: 1001 }, { num: 60000, den: 1001 });
  // the title is cut at up to three of its frames; every piece keeps the strobe
  const titleCuts = fc.array(fc.integer({ min: 1, max: 599 }), { maxLength: 3 });
  // the music clip replaced by several clips: cuts, a speed change in steps, a speed curve
  const pieces = fc.oneof(
    fc.record({ cuts: fc.array(fc.integer({ min: 1, max: 700 }), { minLength: 1, maxLength: 8 }) }),
    fc.record({ from: fc.integer({ min: 100, max: 8000 }), to: fc.integer({ min: 100, max: 8000 }), steps: fc.integer({ min: 2, max: 24 }) }),
    fc.record({ preset: fc.constantFrom(...SPEED_CURVE_IDS) }),
  );
  const music = fc.record({
    fps, firstBeatMs: fc.integer({ min: 0, max: 3000 }), gaps: gapsMs, meter: fc.constantFrom(0, 0, 2, 3, 4, 4, 5, 7), barFrom: fc.integer({ min: 0, max: 6 }),
    every: fc.oneof({ weight: 3, arbitrary: fc.constantFrom(1, 1, 2, 3, 4) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 16 }) }),
    startFrame: fc.integer({ min: 0, max: 120 }), sourceInMs: fc.integer({ min: 0, max: 4000 }), frames: fc.integer({ min: 400, max: 900 }), speed,
    trimStart: fc.option(fc.integer({ min: 1, max: 200 })), trimEnd: fc.option(fc.integer({ min: 1, max: 200 })), splitAt: fc.option(fc.integer({ min: 1, max: 600 })), pieces: fc.option(pieces),
    // a second stretch of the same music on another sound track, listed before or after the first: the music that is followed changes on the way
    second: fc.option(fc.record({ first: fc.boolean(), startFrame: fc.integer({ min: 0, max: 600 }), sourceInMs: fc.integer({ min: 0, max: 20000 }), frames: fc.integer({ min: 20, max: 400 }), speed })),
    titleStart: fc.integer({ min: 0, max: 90 }), titleCuts, rate: fc.integer({ min: 0, max: 3000 }),
  });

  it('following the music: any beats, bars, every, speed, gradual speed change, trim, split, music in pieces, second piece of music, frame rate and cuts of the title', () => {
    let flashes = 0, runs = 0;
    fc.assert(fc.property(music, (m) => {
      const F = (n: number) => f(n, m.fps), perSecond = m.fps.num / m.fps.den;
      const beats: number[] = [];
      let t = m.firstBeatMs;
      for (const g of [0, ...m.gaps]) beats.push((t += g));
      let doc = createProject({ id: 'prj_p', name: 'P', frameRate: m.fps });
      let r = tx(doc, [{ op: 'import_asset', args: { asset: song('song.wav', 3600) } }], true);
      const assetId = r.results[0]!.output!.assetId as string;
      const times = beats.map(ms);
      r = tx(r.doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times, bpm: null, ...(m.meter ? { downbeats: times.filter((_, i) => i >= m.barFrom && (i - m.barFrom) % m.meter === 0), meter: m.meter } : {}) } }], true);
      r = tx(r.doc, [{ op: 'add_track', args: { kind: 'audio' } }]);
      const extraTrack = r.results[0]!.output!.trackId as string;
      const place = (d: ProjectDocument, c: { startFrame: number; sourceInMs: number; frames: number; speed: typeof m.speed }, trackId?: string): { doc: ProjectDocument; clipId: string } => {
        // the clip is placed long enough that it still covers `frames` thirtieths of a second once it plays faster
        const factor = c.speed === null ? 1 : 'speed' in c.speed ? c.speed.speed : (c.speed.from + c.speed.to) / 2;
        const made = tx(d, [{ op: 'add_clip', args: { assetId, start: F(c.startFrame), sourceIn: ms(c.sourceInMs), duration: F(Math.max(2, Math.round((c.frames * factor * perSecond) / 30))), ...(trackId ? { trackId } : {}) } }]);
        const clipId = made.results[0]!.output!.clipId as string;
        return { clipId, doc: c.speed === null ? made.doc : attempt(made.doc, ['speed' in c.speed ? { op: 'set_clip_speed', args: { clipId, speed: c.speed.speed } } : { op: 'set_clip_speed_ramp', args: { clipId, from: c.speed.from, to: c.speed.to, curve: c.speed.curve } }]) };
      };
      // tracks are followed in their order: the piece placed on the track that came first is the one preferred
      const main = place(r.doc, m, m.second && m.second.first ? extraTrack : undefined);
      doc = main.doc;
      if (m.second) doc = place(doc, m.second, m.second.first ? undefined : extraTrack).doc;
      if (m.trimStart) doc = attempt(doc, [{ op: 'trim_clip', args: { clipId: main.clipId, edge: 'start', to: F(m.startFrame + m.trimStart) } }]);
      if (m.trimEnd) { const c = findClip(doc, main.clipId)!.clip; doc = attempt(doc, [{ op: 'trim_clip', args: { clipId: main.clipId, edge: 'end', to: T.sub(T.add(c.start, c.duration), F(m.trimEnd)) } }]); }
      if (m.splitAt) doc = attempt(doc, [{ op: 'split_clip', args: { clipId: main.clipId, at: F(m.startFrame + (m.trimStart ?? 0) + m.splitAt) } }]);
      if (m.pieces) {
        if ('cuts' in m.pieces) for (const cut of m.pieces.cuts) {
          const at = F(m.startFrame + cut), piece = doc.sequences[doc.mainSequenceId]!.tracks.flatMap((k) => (k.kind === 'audio' ? k.clips : [])).find((c) => T.lt(c.start, at) && T.lt(at, T.add(c.start, c.duration)));
          if (piece) doc = attempt(doc, [{ op: 'split_clip', args: { clipId: piece.id, at } }]);
        } else doc = attempt(doc, ['preset' in m.pieces ? { op: 'apply_speed_curve', args: { clipId: main.clipId, preset: m.pieces.preset, ripple: false } } : { op: 'speed_ramp', args: { clipId: main.clipId, from: m.pieces.from / 1000, to: m.pieces.to / 1000, steps: m.pieces.steps } }]);
      }
      expect(validateProject(doc)).toEqual([]);
      doc = cutTitle(withStrobe(doc, { follow: 'music', every: m.every, rate: m.rate / 1000 }, Math.ceil(21 * perSecond), m.titleStart).doc, m.titleCuts.map((c) => m.titleStart + c));
      flashes += expectSafe(doc, m.titleStart, 20);
      runs++;
    }), { numRuns: RUNS, endOnFailure: true, ...REPLAY });
    // the property is not satisfied by never flashing: on average a run flashes many times (about 9 to 15 over random seeds; 8.8 was seen once, so the floor is set well under that)
    expect(flashes / runs).toBeGreaterThan(5);
  }, 60_000 + RUNS * 2000);

  it('steady: any rate the schema allows, any place on the timeline, any frame rate, cuts of the title, with or without music under it', () => {
    const rate = fc.oneof(fc.integer({ min: 0, max: 3000 }).map((x) => x / 1000), fc.constantFrom(3, 2.999, 2.99, 2.93, 2.5, 1, 0.01, 0), fc.double({ min: 0, max: 3, noNaN: true }));
    fc.assert(fc.property(rate, fps, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 1, max: 100 }), fc.boolean(), fc.integer({ min: 1, max: 16 }), titleCuts, (rateValue, frameRate, start, amountPct, musicUnder, everyN, cuts) => {
      let doc = createProject({ id: 'prj_q', name: 'Q', frameRate });
      if (musicUnder) { const m = withMusic(every(137, 2000), 4, 600, frameRate); doc = tx(m.doc, [{ op: 'add_clip', args: { assetId: m.assetId, start: f(0, frameRate) } }]).doc; }
      const made = withStrobe(doc, { rate: rateValue, amount: amountPct / 100, every: everyN }, Math.ceil((13 * frameRate.num) / frameRate.den), start);
      const count = expectSafe(cutTitle(made.doc, cuts.map((c) => start + c)), start, 12, amountPct / 100);
      const flashesPerSecond = Math.min(rateValue, maxRate(frameRate));
      expect(count).toBeLessThanOrEqual(Math.floor(12 * flashesPerSecond) + 2); // one more for a first frame that is still bright
      if (rateValue >= 0.5) expect(count).toBeGreaterThanOrEqual(Math.floor(12 * flashesPerSecond) - 1); // and it does flash at its rate
    }), {
      numRuns: RUNS, endOnFailure: true, ...REPLAY,
      // seed 1786843907: two flash times fell in the frame before a cut and were dropped by both pieces (29 flashes, not 31)
      examples: [[2.646, { num: 24, den: 1 }, 4990, 2, true, 6, [72, 36, 190]]],
    });
    // the schema refuses a faster rate
    expect(() => withStrobe(createProject({ id: 'prj_r', name: 'R' }), { rate: 3.01 })).toThrow(OpError);
  }, 60_000 + RUNS * 2000);

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
    // (reported) cut at 4.4 s instead: the beat at 4.5 s is half a second after the one before it, in whichever piece that was, and flashes.
    // It used to be left out: every cut of the music silenced the third of a second after it.
    const cutLate = tx(one.doc, [{ op: 'split_clip', args: { clipId: one.results[0]!.output!.clipId as string, at: f(132) } }]).doc;
    expect(onsets(withStrobe(cutLate, { follow: 'music' }, 600).doc, 10).map((i) => i / 240)).toEqual([2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5]);
  });

  it('reported: two steady strobes at 3 and 2.5 a second on one title, and a title cut in two with rates 3 and 2.9, used to start six flashes in a second', () => {
    let two = withStrobe(createProject({ id: 'prj_m', name: 'M' }), { rate: 3 }, 300);
    two = { ...two, doc: tx(two.doc, [{ op: 'add_effect', args: { clipId: two.titleId, type: 'light.strobe', params: { amount: 1, rate: 2.5 } } }]).doc };
    expect(mostInOneSecond(onsetsOf(frameStrengths(two.doc, 10)), 30)).toBeLessThanOrEqual(3);
    const cut = withStrobe(createProject({ id: 'prj_n', name: 'N' }), { rate: 3 }, 300);
    let d = tx(cut.doc, [{ op: 'split_clip', args: { clipId: cut.titleId, at: f(151) } }]).doc;
    const second = Object.values(d.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).find((c) => c.type === 'text' && c.id !== cut.titleId)!;
    d = tx(d, [{ op: 'update_effect', args: { clipId: second.id, effectId: (second as { effects: { id: string }[] }).effects[0]!.id, params: { rate: 2.9 } } }]).doc;
    expect(mostInOneSecond(onsetsOf(frameStrengths(d, 10)), 30)).toBeLessThanOrEqual(3);
  });

  it('reported: pieces of one strobe whose later piece is brighter (or another colour) do not flash as one run: the light never rises at a cut without a scheduled start', () => {
    // a title cut a few frames after each flash; the pieces alternate between a faint and a full flash
    const made = withStrobe(createProject({ id: 'prj_c', name: 'C' }), { rate: 2.5, amount: 0.3 }, 300);
    let d = cutTitle(made.doc, Array.from({ length: 24 }, (_, i) => 3 + i * 12));
    const pieces = Object.values(d.sequences).flatMap((q) => q.tracks).flatMap((t) => t.clips).filter((c) => c.type === 'text').sort((a, b) => T.cmp(a.start, b.start));
    expect(pieces.length).toBeGreaterThan(10);
    pieces.forEach((p, i) => { d = tx(d, [{ op: 'update_effect', args: { clipId: p.id, effectId: (p as { effects: { id: string }[] }).effects[0]!.id, params: { amount: i % 2 ? 1 : 0.1, ...(i % 4 === 3 ? { color: '#FF00FF' } : {}) } } }]).doc; });
    const frames = frameStrengths(d, 10);
    expect(mostInOneSecond(onsetsOf(frames), 30)).toBeLessThanOrEqual(3);
    const scheduled = new Set([...flashSchedule(d).shown.values()].flatMap((x) => [...x]));
    for (let i = 1; i < frames.length; i++) if (frames[i]! > frames[i - 1]! + 1e-9) expect(scheduled.has(i), `rise on frame ${i}`).toBe(true);
  });

  it('several strobes with different settings, on one clip, on clips that overlap on several tracks, on clips that follow one another and on cut clips, start at most three flashes a second between them', () => {
    const strobe = fc.oneof(
      fc.record({ rate: fc.oneof(fc.integer({ min: 0, max: 3000 }).map((x) => x / 1000), fc.constantFrom(3, 2.999, 2.9, 2.5, 1.7)) }),
      fc.record({ follow: fc.constant('music'), every: fc.integer({ min: 1, max: 6 }) }),
    );
    const title = fc.record({ start: fc.integer({ min: 0, max: 400 }), frames: fc.integer({ min: 2, max: 500 }), strobes: fc.array(strobe, { minLength: 1, maxLength: 3 }), cuts: fc.array(fc.integer({ min: 1, max: 499 }), { maxLength: 3 }), disableFirst: fc.boolean() });
    fc.assert(fc.property(fps, fc.array(title, { minLength: 1, maxLength: 5 }), fc.option(fc.record({ step: fc.integer({ min: 60, max: 900 }), meter: fc.constantFrom(0, 3, 4), speed: fc.constantFrom(1, 1, 0.5, 2, 3.7) })), (frameRate, titles, music) => {
      let doc = createProject({ id: 'prj_v', name: 'V', frameRate });
      if (music) {
        const m = withMusic(every(music.step, 600), music.meter, 900, frameRate);
        const added = tx(m.doc, [{ op: 'add_clip', args: { assetId: m.assetId, start: f(0, frameRate) } }]);
        doc = music.speed === 1 ? added.doc : attempt(added.doc, [{ op: 'set_clip_speed', args: { clipId: added.results[0]!.output!.clipId as string, speed: music.speed } }]);
      }
      for (const t of titles) {
        // a title on any free text track (titles may overlap in time on different tracks, or lie back to back on one)
        const r = tx(doc, [{ op: 'add_text', args: { text: 'X', start: f(t.start, frameRate), duration: f(t.frames, frameRate) } }]);
        doc = r.doc;
        const id = r.results[0]!.output!.clipId as string;
        let firstFx: string | null = null;
        for (const p of t.strobes) { const a = tx(doc, [{ op: 'add_effect', args: { clipId: id, type: 'light.strobe', params: { amount: 1, ...p } } }]); doc = a.doc; firstFx ??= a.results[0]!.output!.effectId as string; }
        if (t.disableFirst && t.strobes.length > 1) doc = tx(doc, [{ op: 'update_effect', args: { clipId: id, effectId: firstFx!, enabled: false } }]).doc;
        doc = cutTitle(doc, t.cuts.map((c) => t.start + c).filter((c) => c < t.start + t.frames));
      }
      const perSecond = frameRate.num / frameRate.den, seconds = 20;
      // what the renderer receives on every frame: the strongest flash on screen
      const frames = frameStrengths(doc, seconds, 0);
      const starts = onsetsOf(frames);
      expect(mostInOneSecond(starts, perSecond)).toBeLessThanOrEqual(3);
      // between flash starts the brightness only falls, or the layer that carried it is gone
      const isStart = new Set(starts);
      for (let i = 1; i < frames.length; i++) if (frames[i]! > frames[i - 1]! + 1e-9 && !isStart.has(i)) expect.fail(`the strength rises from ${frames[i - 1]} to ${frames[i]} on frame ${i} without a flash start`);
      // and the schedule itself: every flash start of every strobe, together, is at least the gap from the one before
      const s = flashSchedule(doc);
      const all = [...new Set([...s.shown.values()].flatMap((x) => [...x]))].sort((a, b) => a - b);
      for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(s.gapFrames);
    }), { numRuns: RUNS, endOnFailure: true, ...REPLAY });
  }, 60_000 + RUNS * 3000);
});

describe('light transitions in the one flash schedule (ADR-0012, amending ADR-0009 decision 1)', () => {
  const provenance = { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' };
  const picture = (k: number) => ({ kind: 'image' as const, name: `p${k}.png`, contentHash: `sha256:${String(k % 10).repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 64, height: 64, codec: 'png', hasAlpha: false }, provenance });
  /**
   * The walk as it was before ADR-0012 (strobeSchedule.ts at c09eed4), strobes only, kept here unchanged as the oracle for
   * documents with no light transition: their schedules must be exactly what they were.
   */
  function scheduleBeforeLights(doc: ProjectDocument): Pick<FlashSchedule, 'shown' | 'runOf'> {
    const keyOf = (clipId: string, effectId: string) => `${clipId}\n${effectId}`;
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
    const firstFrameAt = (t: T.RationalTime, rate: T.Rate) => { const i = T.frameIndexAt(t, rate); return T.isFrameAligned(t, rate) ? i : i + 1; };
    const rate = doc.settings.frameRate, fps = rate.num / rate.den, gapFrames = flashGapFrames(fps), sequenceId = doc.mainSequenceId;
    const schedule = { shown: new Map<string, Float64Array>(), runOf: new Map<string, string>() };
    const seq = doc.sequences[sequenceId]!;
    const wanted: { frame: number; key: string }[] = [];
    let beats: { t: number; index: number }[] | null = null;
    const thinned = new Map<number, number[]>();
    for (const track of seq.tracks) {
      if (track.hidden || track.kind === 'audio' || track.kind === 'caption') continue;
      const open = new Map<string, { key: string; end: number; settings: string }>();
      for (const clip of [...track.clips].sort((a, b) => T.cmp(a.start, b.start))) {
        for (const fx of clip.type === 'caption' ? [] : clip.effects ?? []) {
          if (fx.type !== 'light.strobe' || !fx.enabled) continue;
          const first = firstFrameAt(clip.start, rate), end = firstFrameAt(T.add(clip.start, clip.duration), rate);
          const from = T.toSeconds(clip.start), to = T.toSeconds(T.add(clip.start, clip.duration));
          let times: number[];
          if (fx.params.follow === 'music') {
            if (!beats) { let last = 0; for (const tr of seq.tracks) for (const c of tr.clips) last = Math.max(last, T.toSeconds(T.add(c.start, c.duration))); beats = followedBeats(doc, 0, last, sequenceId); }
            const step = Math.max(1, Math.round(num(fx.params.every, 1)));
            let all = thinned.get(step);
            if (!all) thinned.set(step, (all = thinnedHits(beats, step, gapFrames / fps)));
            times = all.filter((t) => t >= from && t < to);
          } else {
            const r = Math.min(fps / gapFrames, Math.max(0, num(fx.params.rate, 2)));
            times = [];
            if (r > 0) for (let k = Math.ceil(from * r - 1e-9); k / r < to; k++) if (k / r > from - 1e-6) times.push(k / r);
          }
          const settings = JSON.stringify([fx.params.amount, fx.params.color, fx.params.rate, fx.params.follow, fx.params.every]);
          const run = open.get(fx.id);
          const key = run && run.end === first && run.settings === settings ? run.key : keyOf(clip.id, fx.id);
          open.set(fx.id, { key, end, settings });
          schedule.runOf.set(keyOf(clip.id, fx.id), key);
          for (const t of times) { const frame = Math.max(first, Math.ceil(t * fps - 1e-6)); if (frame < end) wanted.push({ frame, key }); }
        }
      }
    }
    wanted.sort((a, b) => a.frame - b.frame);
    const kept = new Map<string, number[]>();
    let last = -Infinity;
    for (let i = 0; i < wanted.length; ) {
      const frame = wanted[i]!.frame;
      const keep = frame - last >= gapFrames;
      for (; i < wanted.length && wanted[i]!.frame === frame; i++) if (keep) { const k = wanted[i]!.key; let list = kept.get(k); if (!list) kept.set(k, (list = [])); if (list[list.length - 1] !== frame) list.push(frame); }
      if (keep) last = frame;
    }
    for (const [k, frames] of kept) schedule.shown.set(k, Float64Array.from(frames));
    return schedule;
  }

  type Built = { doc: ProjectDocument; lightClips: string[]; seconds: number };
  const transition = fc.record({ type: fc.constantFrom('film-burn', 'light-leak', 'film-burn', 'light-leak', 'dissolve', 'flash', 'ink-bleed', 'wipe-left'), frames: fc.integer({ min: 1, max: 30 }), sync: fc.boolean() });
  const clip = fc.record({ gap: fc.oneof({ weight: 4, arbitrary: fc.constant(0) }, { weight: 1, arbitrary: fc.integer({ min: 1, max: 20 }) }), frames: fc.integer({ min: 2, max: 40 }), transition: fc.option(transition, { freq: 4 }) });
  const track = fc.record({ hidden: fc.oneof({ weight: 5, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }), clips: fc.array(clip, { minLength: 1, maxLength: 14 }) });
  const strobe = fc.record({ start: fc.integer({ min: 0, max: 400 }), frames: fc.integer({ min: 2, max: 400 }), params: fc.oneof(fc.record({ rate: fc.constantFrom(3, 2.9, 2.5, 1.7, 1, 0.4) }), fc.record({ follow: fc.constant('music'), every: fc.integer({ min: 1, max: 4 }) })) });
  const LIGHT_DOC = fc.record({
    fps: fc.constantFrom<Rate>({ num: 24, den: 1 }, { num: 25, den: 1 }, { num: 30, den: 1 }, { num: 50, den: 1 }, { num: 60, den: 1 }),
    tracks: fc.array(track, { minLength: 1, maxLength: 3 }),
    strobes: fc.array(strobe, { maxLength: 3 }),
    beatMs: fc.option(fc.integer({ min: 120, max: 900 })),
  });
  type LightDoc = typeof LIGHT_DOC extends fc.Arbitrary<infer X> ? X : never;
  /** Picture clips (stills) on 1–3 video tracks, with transitions among them light ones, strobes on titles, and music with beats for the beat lock. */
  function build(m: LightDoc, lights = true): Built {
    let doc = createProject({ id: 'prj_l', name: 'L', frameRate: m.fps });
    let r = tx(doc, [{ op: 'import_asset', args: { asset: picture(1) } }, { op: 'import_asset', args: { asset: picture(2) } }], true);
    const pics = [r.results[0]!.output!.assetId as string, r.results[1]!.output!.assetId as string];
    doc = r.doc;
    if (m.beatMs) {
      const s = tx(doc, [{ op: 'import_asset', args: { asset: song('song.wav', 300) } }], true);
      const assetId = s.results[0]!.output!.assetId as string, times = every(m.beatMs, 200).map(ms);
      doc = s.doc;
      doc = tx(doc, [{ op: 'attach_analysis', args: { assetId, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-16T00:00:00Z', times, bpm: null } }], true).doc;
      doc = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(0, m.fps) } }]).doc;
    }
    const lightClips: string[] = [];
    let end = 0;
    m.tracks.forEach((t, ti) => {
      let trackId = 'trk_video';
      if (ti > 0) { const a = tx(doc, [{ op: 'add_track', args: { kind: 'video' } }]); doc = a.doc; trackId = a.results[0]!.output!.trackId as string; }
      let at = 0;
      t.clips.forEach((c, ci) => {
        at += c.gap;
        const a = tx(doc, [{ op: 'add_clip', args: { assetId: pics[ci % 2]!, trackId, start: f(at, m.fps), duration: f(c.frames, m.fps) } }]);
        doc = a.doc;
        const clipId = a.results[0]!.output!.clipId as string;
        at += c.frames;
        if (c.transition) {
          const type = lights ? c.transition.type : transitionDef(c.transition.type)!.light ? 'dissolve' : c.transition.type;
          const n = Math.min(c.transition.frames, c.frames);
          doc = tx(doc, [{ op: 'set_transition', args: { clipId, type, frames: n } }, ...(c.transition.sync && n >= 3 ? [{ op: 'set_transition_options', args: { clipId, sync: 'beat' } }] : [])]).doc;
          if (transitionDef(type)!.light && !t.hidden) lightClips.push(clipId);
        }
      });
      if (t.hidden) doc = tx(doc, [{ op: 'update_track', args: { trackId, hidden: true } }]).doc;
      end = Math.max(end, at);
    });
    for (const s of m.strobes) {
      const a = tx(doc, [{ op: 'add_text', args: { text: 'X', start: f(s.start, m.fps), duration: f(s.frames, m.fps) } }]);
      doc = tx(a.doc, [{ op: 'add_effect', args: { clipId: a.results[0]!.output!.clipId as string, type: 'light.strobe', params: { amount: 1, ...s.params } } }]).doc;
      end = Math.max(end, s.start + s.frames);
    }
    expect(validateProject(doc)).toEqual([]);
    return { doc, lightClips, seconds: Math.ceil(end / (m.fps.num / m.fps.den)) };
  }
  /** Every kept start of the schedule (strobes and light transitions), distinct and in order. */
  const keptStarts = (s: FlashSchedule) => [...new Set([...[...s.shown.values()].flatMap((x) => [...x]), ...[...s.lights.values()].filter((l) => l.kept).map((l) => l.frame)])].sort((a, b) => a - b);

  it('any mix of strobes and light transitions on several tracks at 24, 25, 30, 50 and 60 fps: kept starts are a gap apart, at most three in any second, each light kept or held by the rule, and what is drawn follows it (property)', () => {
    let lights = 0, held = 0;
    fc.assert(fc.property(LIGHT_DOC, (m) => {
      const { doc, lightClips, seconds } = build(m);
      const s = flashSchedule(doc), perSecond = s.fps, gap = s.gapFrames;
      expect(gap).toBe(flashGapFrames(perSecond));
      const starts = keptStarts(s);
      for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!, `kept starts ${starts[i - 1]} and ${starts[i]}`).toBeGreaterThanOrEqual(gap);
      for (let i = 0, j = 0; i < starts.length; i++) { while (starts[i]! - starts[j]! >= perSecond) j++; expect(i - j + 1, `kept starts in the second before frame ${starts[i]}`).toBeLessThanOrEqual(3); }
      // every visible light transition is planned where it starts to light, and kept exactly when no kept start lies less than the gap before it
      expect([...s.lights.keys()].sort()).toEqual([...lightClips].sort());
      for (const id of lightClips) {
        const c = findClip(doc, id)!.clip as Extract<ProjectDocument['sequences'][string]['tracks'][number]['clips'][number], { type: 'media' }>;
        const n = c.transition!.frames, plan = s.lights.get(id)!;
        expect(plan.frame).toBe(T.frameIndexAt(c.start, doc.settings.frameRate) + lightStartFrame(n, perSecond, switchFrame(n, beatSwitchFrame(doc, c)))!);
        const before = starts.filter((x) => x < plan.frame);
        const since = before.length ? plan.frame - before[before.length - 1]! : Infinity;
        expect(plan.kept, `light of ${id} at ${plan.frame}, ${since} frames after a kept start`).toBe(since >= gap);
        expect(plan.since).toBe(plan.kept ? null : since);
        lights++; if (!plan.kept) held++;
      }
      // the drawn frames: a light rises from nothing only on a kept start, and a strobe flash starts only on one
      const kept = new Set(starts);
      const was = new Map<string, number>();
      for (let F = 0; F < seconds * perSecond; F++) {
        const g = evaluate(doc, f(F, doc.settings.frameRate));
        for (const l of g.layers) {
          for (const fx of ('effects' in l ? l.effects ?? [] : [])) if (fx.type === 'light.strobe' && fx.params[FLASH_SINCE] === 0) expect(kept.has(F), `strobe flash on frame ${F}`).toBe(true);
          if ('transition' in l && l.transition?.role === 'in') {
            const light = l.transition.light ?? 0, prev = was.get(l.clipId) ?? 0;
            if (light > 0 && prev === 0) expect(kept.has(F), `transition light of ${l.clipId} rises on frame ${F}`).toBe(true);
            if (light > 0) expect(s.lights.get(l.clipId)?.kept).toBe(true);
            was.set(l.clipId, light);
          }
        }
      }
    }), { numRuns: RUNS, endOnFailure: true, ...REPLAY });
    // the property is not met by never lighting or never holding: over the runs both happen often
    expect(lights).toBeGreaterThan(RUNS);
    expect(held).toBeGreaterThan(RUNS / 4);
  }, 120_000 + RUNS * 4000);

  it('documents with no light transition get exactly the schedule they had before light transitions joined it (property)', () => {
    fc.assert(fc.property(LIGHT_DOC, (m) => {
      const { doc } = build(m, false);
      const now = flashSchedule(doc), before = scheduleBeforeLights(doc);
      expect(now.lights.size).toBe(0);
      expect(now.shown).toEqual(before.shown);
      expect(now.runOf).toEqual(before.runOf);
    }), { numRuns: RUNS, endOnFailure: true, ...REPLAY });
  }, 60_000 + RUNS * 2000);

  it('a light transition 4 frames after a kept strobe flash is held with since 4 (and draws no light); 12 frames later it is kept', () => {
    // 30 fps: the gap is 11 frames. A steady strobe flashes at 1/rate s; film-burn of 29 frames lights from its frame 9.
    const R30 = { num: 30, den: 1 };
    let doc = createProject({ id: 'prj_h', name: 'H', frameRate: R30 });
    let r = tx(doc, [{ op: 'import_asset', args: { asset: picture(1) } }, { op: 'import_asset', args: { asset: picture(2) } }], true);
    const [a, b] = [r.results[0]!.output!.assetId as string, r.results[1]!.output!.assetId as string];
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a, start: f(0), duration: f(60) } }, { op: 'add_clip', args: { assetId: b, start: f(60), duration: f(60) } }]);
    const inClip = r.results[1]!.output!.clipId as string;
    r = tx(r.doc, [{ op: 'set_transition', args: { clipId: inClip, type: 'film-burn', frames: 29 } }]);
    const lightFrame = 60 + lightStartFrame(29, 30, switchFrame(29, null))!;
    expect(lightFrame).toBe(69);
    expect(flashSchedule(r.doc).lights.get(inClip)).toEqual({ frame: 69, kept: true, since: null }); // alone, it is kept
    const withStrobeAt = (frame: number) => { const t = tx(r.doc, [{ op: 'add_text', args: { text: '.', start: f(frame), duration: f(5) } }]); return tx(t.doc, [{ op: 'add_effect', args: { clipId: t.results[0]!.output!.clipId as string, type: 'light.strobe', params: { amount: 1, rate: 30 / frame } } }]).doc; };
    doc = withStrobeAt(65);
    expect([...flashSchedule(doc).shown.values()].flatMap((x) => [...x])).toEqual([65]);
    expect(flashSchedule(doc).lights.get(inClip)).toEqual({ frame: 69, kept: false, since: 4 });
    for (let l = 0; l < 29; l++) expect((evaluate(doc, f(60 + l)).layers.find((x) => 'transition' in x && x.transition?.role === 'in') as { transition: { light: number } }).transition.light).toBe(0);
    // the same transition 12 frames later (both clips moved): 16 frames after the flash, kept
    const later = tx(doc, [{ op: 'move_clip', args: { clipId: inClip, start: f(72) } }]).doc;
    const plan = flashSchedule(later).lights.get(inClip)!;
    expect(plan).toEqual({ frame: 81, kept: true, since: null });
  });
});

