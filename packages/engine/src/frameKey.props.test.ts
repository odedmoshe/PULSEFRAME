/**
 * Edit properties of the frame key (ADR-0024 plan §2 and §9, verifier note C; lead: "the key must change whenever anything that
 * affects the frames of the range changes, and must NOT change for edits outside it"). Both directions, over the rich test
 * document (frameKey.testDocs.ts) edited through the registered operations:
 *
 * - SENSITIVITY: an edit that changes what a frame shows changes that frame's key. Each named property edits one thing a frame
 *   reads (a file, a colour table, a font, an effect parameter or version, a title, a keyframe, the output size, a caption word,
 *   a motion-track sample behind a follow and behind a redaction region, the beat grid, the earlier picture an echo tap reads,
 *   the outgoing clip of a transition, the adapter of a GPU pass, live fields: a capture date, a person's birth date and name,
 *   an event name; a time-split lag, a stutter hold) and checks a random frame that reads it.
 * - INSENSITIVITY: an edit that cannot reach a frame leaves its key equal (sound gain, sound effects that ring on past their
 *   clip, names, an edit to a clip outside the frame and its time-effect or transition reach, the adapter on a frame with no GPU
 *   pass, the hash of a font the frame does not use).
 * - RANDOM: random documents (transition length, echo count and delay, cut point, split lag, birth date) and a random edit from
 *   the whole catalogue: every frame the edit must reach changes key, every frame it cannot reach keeps it, and on every checked
 *   frame "same key" holds exactly when the pictures (graph at the output size without sound, plus the inputs) are deep-equal,
 *   an oracle that does not use canonicalJson.
 *
 * Where an edit reaches is written here from the timeline semantics (clip spans, the transition's frames, the echo's
 * (count − 1) · delay frames into the next cut piece, the picture under a live-field title), not taken from the code under test.
 * The beat grid is in every graph where analysed music plays, so moving it reaches every frame under the music: stated limit (b).
 */
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import type { OpCall, ProjectDocument } from '@pulseframe/core';
import { evaluate } from './evaluate.ts';
import { frameInputs, frameKey } from './frameKey.ts';
import { baseEnv, ctxFor, DEFAULT_SHAPE, f, richDoc, tx, type Rich, type Shape, type TestEnv } from './frameKey.testDocs.ts';

const RUNS = 200;
const TIMEOUT = 300_000;
const TOTAL = 300;
type Span = readonly [number, number];
interface Edit { doc?: ProjectDocument; env?: TestEnv }
/** One kind of edit: random values, how to make it on a rich document, the frames it must change and the frames it may change. */
interface Entry<V = unknown> { name: string; arb: fc.Arbitrary<V>; apply(r: Rich, v: V): Edit; must(s: Shape, v: V): Span[]; may(s: Shape, v: V): Span[] }
const entry = <V,>(e: Entry<V>): Entry => e as unknown as Entry;

const clip = (spans: Span[]): Span[] => spans.map(([a, b]) => [Math.max(0, a), Math.min(TOTAL, b)] as const).filter(([a, b]) => a < b);
const inSpans = (spans: Span[], frame: number) => spans.some(([a, b]) => frame >= a && frame < b);
const complement = (spans: Span[]): Span[] => { const out: Span[] = []; let at = 0; for (const [a, b] of [...clip(spans)].sort((x, y) => x[0] - y[0])) { if (a > at) out.push([at, a]); at = Math.max(at, b); } if (at < TOTAL) out.push([at, TOTAL]); return out; };
/** A random frame inside these spans. */
const frameIn = (spans: Span[]) => { const s = clip(spans); const n = s.reduce((t, [a, b]) => t + b - a, 0); return fc.integer({ min: 0, max: n - 1 }).map((i) => { for (const [a, b] of s) { if (i < b - a) return a + i; i -= b - a; } throw new Error('unreachable'); }); };
const ops = (r: Rich, calls: OpCall[], internal = false): Edit => ({ doc: tx(r.doc, calls, internal).doc });
const withEnv = (change: (e: TestEnv) => void): Edit => { const e = baseEnv(); change(e); return { env: e }; };
const keyOf = (r: Rich, e: Edit, frame: number) => { const doc = e.doc ?? r.doc; return frameKey(doc, frame, ctxFor(doc, e.env ?? baseEnv())); };
const hex64 = fc.stringMatching(/^[0-9a-f]{64}$/);
const word = fc.stringMatching(/^[a-zא-ת]{1,8}( [a-zא-ת]{1,8}){0,2}$/);
const day = fc.record({ y: fc.integer({ min: 2000, max: 2015 }), m: fc.integer({ min: 1, max: 12 }), d: fc.integer({ min: 1, max: 28 }) }).map(({ y, m, d }) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
/** The x of a motion-track sample of the rich document at source frame k (attached as 4000 + 7·(k − 31) from frame 31). */
const sampleX = (r: Rich, k: number) => { const t = r.doc.motionTracks[r.motionTrack]!; return t.x[k - t.from]!; };

// ---------- the catalogue of edits, with where each one reaches ----------
const EFFECT_SPANS: Record<string, Span[]> = {
  'color.lut': [[0, 60]], 'distort.wave': [[0, 60]], 'blur.gaussian': [[20, 70]], 'time.split': [[60, 120]], 'time.stutter': [[120, 180]], 'stylize.grain': [[120, 180]],
  'overlay.snow': [[120, 180]], 'light.strobe': [[150, 210]], 'time.echo': [[180, 300]], 'color.adjust': [[200, 260]],
};
const echoReach = (s: Shape): Span => [180, s.cutAt + (s.echoCount - 1) * s.echoDelay];
/** Frames that show a picture of file A, B: A1 with its transition handle, E, C; B1 and D. */
const framesOfA = (s: Shape): Span[] => [[0, 90 + s.trFrames], [60, 120], [180, 300]];
const transform = (name: string, pick: (r: Rich) => string, reach: (s: Shape) => Span[]) => entry({
  name, arb: fc.double({ min: -1, max: 1, noNaN: true }).filter((x) => Math.abs(x) > 1e-6),
  apply: (r, x) => ops(r, [{ op: 'set_clip_transform', args: { clipId: pick(r), transform: { x } } }]), must: reach, may: reach,
});
const trackSample = (name: string, from: number, to: number) => entry({
  // a sample at source frame k of file A: A1 shows source frame 30 + t at timeline frame t (also on its transition handle)
  name, arb: fc.record({ k: fc.integer({ min: from, max: to - 1 }), dx: fc.integer({ min: 1, max: 900 }), dy: fc.integer({ min: -900, max: 900 }) }),
  apply: (r, { k, dx, dy }) => ops(r, [{ op: 'edit_motion_track', args: { motionTrackId: r.motionTrack, set: [{ frame: k, x: sampleX(r, k) + dx, y: 5000 + dy }] } }]),
  must: (s, { k }) => (k - 30 < 90 + s.trFrames ? [[k - 30, k - 29]] : []), may: (s) => [[0, 90 + s.trFrames]],
});
const beatShift = (name: string) => entry({
  name, arb: fc.integer({ min: 1, max: 499 }),
  apply: (r, ms) => { const times = Array.from({ length: 50 }, (_, i) => T.rt(250 + ms + i * 500, 1000)); return ops(r, [{ op: 'attach_analysis', args: { assetId: r.assets.SONG, kind: 'beats', method: 'test', params: {}, createdAt: '2026-11-18T00:00:00Z', times, bpm: 120, downbeats: times.filter((_, i) => i % 4 === 0), meter: 4 } }], true); },
  must: () => [[0, TOTAL]], may: () => [[0, TOTAL]],
});

const E = {
  assetA: entry({ name: 'asset hash of file A', arb: hex64, apply: (r, h) => withEnv((e) => { e.assetOverride[r.assets.A] = `sha256:${h}`; }), must: framesOfA, may: framesOfA }),
  assetB: entry({ name: 'asset hash of file B', arb: hex64, apply: (r, h) => withEnv((e) => { e.assetOverride[r.assets.B] = `sha256:${h}`; }), must: () => [[90, 180]], may: () => [[90, 180]] }),
  lut: entry({ name: 'LUT hash', arb: hex64, apply: (r, h) => withEnv((e) => { e.assetOverride[r.assets.LUT] = `sha256:${h}`; }), must: () => [[0, 60]], may: () => [[0, 60]] }),
  font: entry({ name: 'font hash of the family the titles and captions use', arb: hex64, apply: (_r, h) => withEnv((e) => { e.fonts.Heebo = h; }), must: () => [[20, 210]], may: () => [[20, 210]] }),
  unusedFont: entry({ name: 'font hash of a family no frame uses', arb: hex64, apply: (_r, h) => withEnv((e) => { e.fonts['David Libre'] = h; }), must: () => [], may: () => [] }),
  effectParam: entry({ name: 'effect parameter (the beat-following blur of T1)', arb: fc.double({ min: 0, max: 0.2, noNaN: true }).filter((x) => Math.abs(x - 0.01) > 1e-9), apply: (r, radius) => ops(r, [{ op: 'update_effect', args: { clipId: r.clips.T1, effectId: r.effects.T1blur, params: { radius } } }]), must: () => [[20, 70]], may: () => [[20, 70]] }),
  effectVersion: entry({ name: 'effect version', arb: fc.record({ type: fc.constantFrom(...Object.keys(EFFECT_SPANS)), v: fc.integer({ min: 2, max: 99 }) }), apply: (_r, { type, v }) => withEnv((e) => { e.versions[type] = v; }), must: (_s, { type }) => EFFECT_SPANS[type]!, may: (_s, { type }) => EFFECT_SPANS[type]! }),
  titleText: entry({ name: 'title text', arb: word.filter((w) => w !== 'שלום'), apply: (r, text) => ops(r, [{ op: 'update_text', args: { clipId: r.clips.T1, text } }]), must: () => [[20, 70]], may: () => [[20, 70]] }),
  keyframe: entry({ name: 'a transform keyframe value', arb: fc.double({ min: -1, max: 1, noNaN: true }).filter((x) => Math.abs(x - 0.2) > 1e-6), apply: (r, value) => ops(r, [{ op: 'set_keyframe', args: { clipId: r.clips.T1, property: 'x', time: f(40), value } }]), must: () => [[21, 70]], may: () => [[20, 70]] }),
  output: entry({ name: 'output width/height', arb: fc.record({ width: fc.integer({ min: 8, max: 2048 }).map((x) => 2 * x), height: fc.integer({ min: 8, max: 2048 }).map((x) => 2 * x) }).filter(({ width, height }) => width !== 640 || height !== 360), apply: (_r, o) => withEnv((e) => { e.output = o; }), must: () => [[0, TOTAL]], may: () => [[0, TOTAL]] }),
  cue: entry({ name: 'caption word text', arb: word.filter((w) => w.split(' ').join(' ') !== 'שלום עולם'), apply: (r, text) => ops(r, [{ op: 'update_cue', args: { clipId: r.clips.cue, text } }]), must: () => [[40, 130]], may: () => [[40, 130]] }),
  sampleFollow: trackSample('a motion-track sample behind a follow', 60, 110),
  sampleRedact: trackSample('a motion-track sample behind a redaction region', 30, 60),
  sampleAny: trackSample('a motion-track sample anywhere on the track', 31, 431),
  beatUnderMusicEffect: beatShift('the beat grid under an effect with follow=music'),
  echoEarlier: entry({ name: 'the earlier source frame read by a time.echo tap (a slip of the first cut piece)', arb: fc.integer({ min: -30, max: 30 }).filter((k) => k !== 0), apply: (r, k) => ops(r, [{ op: 'slip_clip', args: { clipId: r.clips.C1, by: k > 0 ? f(k) : T.sub(T.ZERO, f(-k)) } }]), must: (s) => [echoReach(s)], may: (s) => [echoReach(s)] }),
  outgoing: transform('the outgoing clip of a transition (A1 moved)', (r) => r.clips.A1, (s) => [[0, 90 + s.trFrames]]),
  gpuAdapter: entry({ name: 'gpuAdapter', arb: fc.stringMatching(/^[a-z]{1,10}\|[a-z0-9]{1,10}$/).filter((a) => a !== 'swiftshader|test'), apply: (_r, adapter) => withEnv((e) => { e.gpu = { adapter, software: true }; }), must: () => [[0, 60], [150, 210]], may: () => [[0, 60], [150, 210]] }),
  split: entry({ name: 'time.split lag', arb: fc.integer({ min: 1, max: 15 }), apply: (r, lag) => ops(r, [{ op: 'update_effect', args: { clipId: r.clips.E, effectId: r.effects.Esplit, params: { lag } } }]), must: (s, lag) => (lag === s.lag ? [] : [[60, 120]]), may: () => [[60, 120]] }),
  stutter: entry({ name: 'stutter hold', arb: fc.integer({ min: 2, max: 12 }), apply: (r, hold) => ops(r, [{ op: 'update_effect', args: { clipId: r.clips.D, effectId: r.effects.Dstutter, params: { hold } } }]), must: () => [], may: () => [[120, 180]] }),
  capture: entry({ name: 'capture date of file B (a live {date} field)', arb: day, apply: (r, at) => ops(r, [{ op: 'set_asset_capture', args: { assetId: r.assets.B, capture: { at } } }]), must: () => [[120, 160]], may: () => [[100, 160]] }),
  birthDate: entry({ name: 'a person\'s birth date (an {age} field)', arb: day, apply: (r, birthDate) => ops(r, [{ op: 'update_person', args: { personId: r.person, birthDate } }]), must: () => [[100, 160]], may: () => [[100, 160]] }),
  personName: entry({ name: 'a person\'s name (a {name} field)', arb: fc.stringMatching(/^[א-ת]{2,8}$/).filter((n) => n !== 'נועה'), apply: (r, name) => ops(r, [{ op: 'update_person', args: { personId: r.person, name } }]), must: () => [[100, 160]], may: () => [[100, 160]] }),
  eventName: entry({ name: 'event name (an {event} field)', arb: fc.stringMatching(/^[א-ת]{2,8}( [א-ת]{2,8})?$/), apply: (r, name) => ops(r, [{ op: 'update_event', args: { eventId: 'evt_b', name } }]), must: () => [[120, 160]], may: () => [[100, 160]] }),
  transition: entry({ name: 'transition length', arb: fc.integer({ min: 1, max: 30 }), apply: (r, frames) => ops(r, [{ op: 'set_transition', args: { clipId: r.clips.B1, type: 'dissolve', frames } }]), must: (s, n) => (n === s.trFrames ? [] : [[90, 90 + Math.min(n, s.trFrames)]]), may: (s, n) => [[90, 90 + Math.max(n, s.trFrames)]] }),
  echoParams: entry({ name: 'echo delay of the first cut piece', arb: fc.integer({ min: 1, max: 12 }), apply: (r, delay) => ops(r, [{ op: 'update_effect', args: { clipId: r.clips.C1, effectId: r.effects.C1echo, params: { delay } } }]), must: (s, d) => (d === s.echoDelay ? [] : [[180, s.cutAt]]), may: (s) => [[180, s.cutAt]] }),
  strobeRate: entry({ name: 'strobe rate', arb: fc.double({ min: 0, max: 3, noNaN: true }), apply: (r, rate) => ops(r, [{ op: 'update_effect', args: { clipId: r.clips.T4, effectId: r.effects.T4strobe, params: { rate } } }]), must: () => [], may: () => [[150, 210]] }),
  grayD: entry({ name: 'an effect added to D', arb: fc.double({ min: 0.01, max: 1, noNaN: true }), apply: (r, amount) => ops(r, [{ op: 'add_effect', args: { clipId: r.clips.D, type: 'color.grayscale', params: { amount } } }]), must: () => [[120, 180]], may: () => [[120, 180]] }),
  moveA1: transform('A1 moved', (r) => r.clips.A1, (s) => [[0, 90 + s.trFrames]]),
  moveB1: transform('B1 moved', (r) => r.clips.B1, () => [[90, 180]]),
  moveC1: transform('C1 (first cut piece of the echo clip) moved', (r) => r.clips.C1, (s) => [echoReach(s)]),
  moveC2: transform('C2 (second cut piece) moved', (r) => r.clips.C2, (s) => [[s.cutAt, TOTAL]]),
  moveE: transform('E (time-split) moved', (r) => r.clips.E, () => [[60, 120]]),
  moveD: transform('D (stutter) moved', (r) => r.clips.D, () => [[120, 180]]),
  moveT4: transform('T4 (strobe title) moved', (r) => r.clips.T4, () => [[150, 210]]),
  // reach nothing: sound is mixed whole for every export and the compositor never reads graph.audio; names are not drawn
  gain: entry({ name: 'audio clip gain', arb: fc.double({ min: 0, max: 8, noNaN: true }).filter((g) => g !== 1), apply: (r, gain) => ops(r, [{ op: 'set_clip_gain', args: { clipId: r.clips.music, gain } }]), must: () => [], may: () => [] }),
  soundTail: entry({ name: 'a sound effect that rings on past its clip (sound tail)', arb: fc.record({ delayMs: fc.integer({ min: 50, max: 1000 }), repeats: fc.integer({ min: 1, max: 8 }) }), apply: (r, params) => ops(r, [{ op: 'update_audio_effect', args: { clipId: r.clips.sfx, effectId: r.effects.sfxEcho, params } }]), must: () => [], may: () => [] }),
  names: entry({
    name: 'asset/clip/project names', arb: fc.record({ which: fc.constantFrom('asset', 'project', 'track', 'adjustment label', 'marker'), name: word }),
    apply: (r, { which, name }) => {
      if (which === 'asset') return ops(r, [{ op: 'rename_asset', args: { assetId: r.assets.A, name: `${name}.mp4` } }]);
      if (which === 'project') return ops(r, [{ op: 'rename_project', args: { name } }]);
      if (which === 'track') return ops(r, [{ op: 'update_track', args: { trackId: r.tracks.V1, name } }]);
      if (which === 'marker') return ops(r, [{ op: 'add_marker', args: { time: f(100), label: name } }]);
      // the only clips with a name are adjustment clips (label); no operation renames one, so it is written here directly
      const doc = structuredClone(r.doc);
      for (const t of doc.sequences[doc.mainSequenceId]!.tracks) for (const c of t.clips) if (c.id === r.clips.ADJ && c.type === 'adjustment') c.label = name;
      return { doc };
    },
    must: () => [], may: () => [],
  }),
};

// ---------- named properties ----------
const RICH = richDoc();
const BASE_KEYS = Array.from({ length: TOTAL }, (_, i) => keyOf(RICH, {}, i));

/** The key of a random frame in `frames` changes under every random edit of this kind. */
function changes(e: Entry, frames: Span[]) {
  fc.assert(fc.property(e.arb, frameIn(frames), (v, frame) => {
    const k = keyOf(RICH, e.apply(RICH, v), frame);
    expect(k, `${e.name} must change frame ${frame} (value ${JSON.stringify(v)})`).not.toBe(BASE_KEYS[frame]);
  }), { numRuns: RUNS });
}
/** The key of a random frame outside `reach` (default: where the edit may reach) stays equal under every random edit of this kind. */
function keeps(e: Entry, reach?: Span[]) {
  fc.assert(fc.property(e.arb, fc.nat({ max: TOTAL - 1 }), (v, n) => {
    const outside = complement(reach ?? e.may(DEFAULT_SHAPE, v));
    if (!outside.length) return;
    let frame = n;
    if (!inSpans(outside, frame)) { const [a, b] = outside[n % outside.length]!; frame = a + (n % (b - a)); }
    const k = keyOf(RICH, e.apply(RICH, v), frame);
    expect(k, `${e.name} must not change frame ${frame} (value ${JSON.stringify(v)})`).toBe(BASE_KEYS[frame]);
  }), { numRuns: RUNS });
}

describe('sensitivity: an edit that changes what a frame shows changes its key (fast-check, 200 runs each)', () => {
  it('asset hash', () => { changes(E.assetA, [[0, 120], [180, 300]]); changes(E.assetB, [[90, 180]]); }, TIMEOUT);
  it('LUT hash', () => changes(E.lut, [[0, 60]]), TIMEOUT);
  it('font hash', () => changes(E.font, [[20, 210]]), TIMEOUT);
  it('effect parameter', () => changes(E.effectParam, [[20, 70]]), TIMEOUT);
  it('effect version', () => {
    fc.assert(fc.property(E.effectVersion.arb, fc.nat(), (v, n) => {
      const [[a, b]] = E.effectVersion.must(DEFAULT_SHAPE, v) as [Span];
      const frame = a + (n % (b - a));
      expect(keyOf(RICH, E.effectVersion.apply(RICH, v), frame), `${JSON.stringify(v)} frame ${frame}`).not.toBe(BASE_KEYS[frame]);
    }), { numRuns: RUNS });
  }, TIMEOUT);
  it('title text', () => changes(E.titleText, [[20, 70]]), TIMEOUT);
  it('a transform keyframe value', () => changes(E.keyframe, [[21, 70]]), TIMEOUT);
  it('output width/height', () => changes(E.output, [[0, TOTAL]]), TIMEOUT);
  it('caption word text', () => changes(E.cue, [[40, 130]]), TIMEOUT);
  it('a motion-track sample behind a follow', () => {
    // T3 (frames 30–79) follows the track on V1, where A1 shows source frame 30 + t: edit exactly the sample frame t reads
    fc.assert(fc.property(E.sampleFollow.arb, (v) => {
      const { k } = v as { k: number };
      const frame = k - 30;
      expect(keyOf(RICH, E.sampleFollow.apply(RICH, v), frame), `sample ${k}`).not.toBe(BASE_KEYS[frame]);
    }), { numRuns: RUNS });
  }, TIMEOUT);
  it('a motion-track sample behind a redaction region', () => {
    // frames 0–29: A1's region (no follower yet) reads the sample of source frame 30 + t
    fc.assert(fc.property(E.sampleRedact.arb, (v) => {
      const { k } = v as { k: number };
      const frame = k - 30;
      expect(keyOf(RICH, E.sampleRedact.apply(RICH, v), frame), `sample ${k}`).not.toBe(BASE_KEYS[frame]);
    }), { numRuns: RUNS });
  }, TIMEOUT);
  it('the beat grid under an effect with follow=music', () => changes(E.beatUnderMusicEffect, [[20, 70]]), TIMEOUT);
  it('the key changes when the beat grid under the frame moves, even with no beat-following effect (stated limit (b), not a bug)', () => {
    // frames 210–299: only the echo clip and the adjustment, neither follows the music; `beat` is in the graph all the same
    for (let frame = 210; frame < 300; frame++) for (const l of evaluate(RICH.doc, f(frame)).layers) expect(JSON.stringify(l)).not.toMatch(/"modulate"|"follow":"music"/);
    changes(E.beatUnderMusicEffect, [[210, 300]]);
  }, TIMEOUT);
  it('the earlier source frame read by a time.echo tap', () => {
    // C2's frames cutAt … cutAt + (count − 1)·delay − 1 read C1 (the piece before the cut) through their taps
    const [, end] = echoReach(DEFAULT_SHAPE);
    changes(E.echoEarlier, [[DEFAULT_SHAPE.cutAt, end]]);
  }, TIMEOUT);
  it('the outgoing clip of a transition', () => changes(E.outgoing, [[90, 90 + DEFAULT_SHAPE.trFrames]]), TIMEOUT);
  it('gpuAdapter on a GPU frame', () => changes(E.gpuAdapter, [[0, 60], [150, 210]]), TIMEOUT);
  it('time-split: its lag', () => changes({ ...E.split, arb: E.split.arb.filter((l) => l !== DEFAULT_SHAPE.lag) }, [[60, 120]]), TIMEOUT);
  it('stutter: a hold that shows another picture', () => {
    fc.assert(fc.property(E.stutter.arb.filter((h) => h !== 3), (hold) => {
      const edited = E.stutter.apply(RICH, hold);
      let changed = 0;
      for (let frame = 120; frame < 180; frame++) {
        const shown = (doc: ProjectDocument) => JSON.stringify(evaluate(doc, f(frame)).layers.find((l) => l.kind === 'video' && l.clipId === RICH.clips.D));
        const k = keyOf(RICH, edited, frame);
        if (k !== BASE_KEYS[frame]) changed++;
        // the key follows the picture shown: equal exactly when the stutter shows the same picture there
        expect(k === BASE_KEYS[frame], `hold ${hold} frame ${frame}`).toBe(shown(edited.doc!) === shown(RICH.doc));
      }
      expect(changed).toBeGreaterThan(0);
    }), { numRuns: RUNS });
  }, TIMEOUT);
  it('live fields: the capture date of the picture under the title', () => changes(E.capture, [[120, 160]]), TIMEOUT);
  it('people ages: a birth date', () => changes(E.birthDate, [[100, 160]]), TIMEOUT);
  it('people names and event names', () => { changes(E.personName, [[100, 160]]); changes(E.eventName, [[120, 160]]); }, TIMEOUT);
});

describe('insensitivity: an edit that cannot reach a frame leaves its key equal (fast-check, 200 runs each)', () => {
  it('audio clip gain', () => keeps(E.gain, []), TIMEOUT);
  it('sound tails: a sound effect that rings on past its clip', () => keeps(E.soundTail, []), TIMEOUT);
  it('asset/clip/project names', () => keeps(E.names, []), TIMEOUT);
  it('an edit to a clip wholly outside the segment\'s frames and outside any time-effect or transition reach', () => {
    const edits = [E.moveA1, E.moveB1, E.moveC1, E.moveC2, E.moveE, E.moveD, E.moveT4, E.titleText, E.cue, E.grayD, E.transition, E.echoParams, E.split, E.stutter, E.strobeRate, E.capture, E.birthDate, E.eventName, E.sampleAny];
    fc.assert(fc.property(fc.constantFrom(...edits.keys()), fc.nat({ max: TOTAL - 1 }), fc.integer(), (i, n, s) => {
      const e = edits[i]!;
      const v = fc.sample(e.arb, { numRuns: 1, seed: s })[0];
      const outside = complement(e.may(DEFAULT_SHAPE, v));
      const [a, b] = outside[n % outside.length]!;
      const frame = a + (n % (b - a));
      expect(keyOf(RICH, e.apply(RICH, v), frame), `${e.name} ${JSON.stringify(v)} frame ${frame}`).toBe(BASE_KEYS[frame]);
    }), { numRuns: RUNS });
    // and each of them once more at every frame outside its reach
    for (const e of edits) {
      const v = fc.sample(e.arb, { numRuns: 1, seed: 7 })[0];
      const edited = e.apply(RICH, v);
      for (const [a, b] of complement(e.may(DEFAULT_SHAPE, v))) for (let frame = a; frame < b; frame++) expect(keyOf(RICH, edited, frame), `${e.name} frame ${frame}`).toBe(BASE_KEYS[frame]);
    }
  }, TIMEOUT);
  it('gpuAdapter on a frame with no GPU pass', () => keeps(E.gpuAdapter), TIMEOUT);
  it('fontHash of a family the frame does not use', () => { keeps(E.unusedFont, []); keeps(E.font, [[20, 210]]); }, TIMEOUT);
});

// ---------- random documents and random edits, both directions, with a deep-equality oracle ----------
/** The picture a frame shows as the render page draws it, with undefined members dropped: the oracle compares these with isDeepStrictEqual (Object.is on numbers). */
function pictureOf(doc: ProjectDocument, frame: number, env: TestEnv) {
  const g = evaluate(doc, f(frame));
  const { audio: _sound, ...p } = g;
  const plain = (v: unknown): unknown => (Array.isArray(v) ? v.map(plain) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, plain(x)])) : v);
  return { g: plain({ ...p, width: env.output.width, height: env.output.height }), in: frameInputs(doc, g, ctxFor(doc, env)) };
}
const SHAPE = fc.record({
  trFrames: fc.integer({ min: 2, max: 20 }), echoCount: fc.integer({ min: 2, max: 5 }), echoDelay: fc.integer({ min: 1, max: 8 }),
  cutAt: fc.integer({ min: 200, max: 280 }), lag: fc.integer({ min: 1, max: 15 }), birthDate: day,
});
const CATALOGUE = Object.values(E);

describe('random documents and random edits (both directions)', () => {
  it('every frame an edit must reach changes key, every frame it cannot reach keeps it, and equal keys mean deep-equal pictures', () => {
    const docs = new Map<string, { rich: Rich; keys: Map<number, string> }>();
    let checkedFrames = 0, changedFrames = 0;
    fc.assert(fc.property(SHAPE, fc.nat({ max: CATALOGUE.length - 1 }), fc.integer(), fc.array(fc.nat({ max: TOTAL - 1 }), { minLength: 8, maxLength: 8 }), (shape, i, seed, extra) => {
      const id = JSON.stringify(shape);
      let base = docs.get(id);
      if (!base) { base = { rich: richDoc(shape), keys: new Map() }; docs.set(id, base); }
      const { rich } = base;
      const e = CATALOGUE[i]!;
      const v = fc.sample(e.arb, { numRuns: 1, seed })[0];
      const edit = e.apply(rich, v);
      const must = clip(e.must(shape, v)), may = clip(e.may(shape, v));
      // the frames to check: both sides of every edge of the reach, and random ones
      const frames = new Set(extra);
      for (const [a, b] of [...must, ...may]) for (const x of [a - 1, a, b - 1, b]) if (x >= 0 && x < TOTAL) frames.add(x);
      for (const frame of frames) {
        let before = base.keys.get(frame);
        if (before === undefined) { before = keyOf(rich, {}, frame); base.keys.set(frame, before); }
        const after = keyOf(rich, edit, frame);
        const label = `${e.name} ${JSON.stringify(v)} on ${id}, frame ${frame}`;
        if (inSpans(must, frame)) expect(after, `${label}: must change`).not.toBe(before);
        if (!inSpans(may, frame)) expect(after, `${label}: cannot be reached`).toBe(before);
        const same = isDeepStrictEqual(pictureOf(rich.doc, frame, baseEnv()), pictureOf(edit.doc ?? rich.doc, frame, edit.env ?? baseEnv()));
        expect(after === before, `${label}: the key agrees with the deep-equality oracle`).toBe(same);
        checkedFrames++;
        if (after !== before) changedFrames++;
      }
    }), { numRuns: RUNS });
    console.log(`[frame key, random edits] ${RUNS} random edits on ${docs.size} random documents: ${checkedFrames} frames checked, ${changedFrames} changed key`);
    expect(changedFrames).toBeGreaterThan(0);
    expect(changedFrames).toBeLessThan(checkedFrames);
  }, TIMEOUT);
});
