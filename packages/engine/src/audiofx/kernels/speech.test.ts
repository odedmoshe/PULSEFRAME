/**
 * cleanup.speech «שיפור דיבור» (ADR-0013): the limiter's ceiling, the phrase leveller and its gate, the presence EQ and the low cut
 * at 44.1, 48 and 96 kHz, the look-ahead (a click comes out exactly where it went in), exact finite memory, a split clip through
 * the voice runtime (openClipVoice), and the speed of the whole voice. The contract suite (kernels.test.ts) covers block sizes,
 * the impulse, identity, silence and the bound at the corners. Synthetic signals only: nobody has listened to this yet.
 */
import { describe, expect, it } from 'vitest';
import { audioEffectParams, describeAudioCatalog, type AudioFxParams } from '@pulseframe/core';
import { renderFx } from './index.ts';
import { presenceSections, SPEECH, speech, speechDesign } from './speech.ts';
import { butterworth4, type Biquad } from '../design.ts';
import { hash32, uniform } from '../noise.ts';
import { chainReach } from '../registry.ts';
import { openClipVoice } from '../voice.ts';
import type { PlannedAudioClip, PlannedFx } from '../../audio.ts';

const SR = 48000;
const RATES = [44100, 48000, 96000] as const;
const P = (over: AudioFxParams = {}) => audioEffectParams('cleanup.speech', over);
const reach = (p: AudioFxParams, sr = SR) => speech.reach(p, sr);
const db = (v: number) => 20 * Math.log10(v);
/** Seeded noise, uniform in [-amp, amp) (RMS amp/√3), independent on L and R. */
const noise = (frames: number, seed: number, amp: number) => { const x = new Float32Array(frames * 2); for (let i = 0; i < frames * 2; i++) x[i] = amp * (2 * uniform(hash32(seed, i, 7)) - 1); return x; };
/** Uniform noise amplitude for an RMS of `dbfs`. */
const ampFor = (dbfs: number) => Math.sqrt(3) * 10 ** (dbfs / 20);
const rmsDb = (x: Float32Array, from: number, to: number) => { let e = 0; for (let i = from * 2; i < to * 2; i++) e += x[i]! * x[i]!; return 10 * Math.log10(e / ((to - from) * 2)); };
const sine = (f: number, frames: number, amp: number, sr: number) => { const x = new Float32Array(frames * 2); for (let i = 0; i < frames; i++) { const v = amp * Math.sin((2 * Math.PI * f * i) / sr); x[i * 2] = v; x[i * 2 + 1] = v; } return x; };
/** Amplitude of the `f` component of the left channel over [from, from + len) (Hann-windowed Goertzel: a sine of amplitude A gives A). */
function amp(x: Float32Array, f: number, sr: number, from: number, len: number): number {
  const w = (2 * Math.PI * f) / sr, coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < len; i++) { const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (len - 1)); const s0 = x[(from + i) * 2]! * h + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / (len * 0.5);
}
/** Small-signal response at f in dB (a sine at −60 dBFS: under the leveller's gate and far under the ceiling, so only the filters act). */
function responseDb(p: AudioFxParams, f: number, sr: number): number {
  const settle = reach(p, sr).warm + Math.round(0.05 * sr), len = Math.max(Math.round(0.2 * sr), Math.round((40 * sr) / f));
  return db(amp(renderFx('cleanup.speech', p, sine(f, settle + len, 1e-3, sr), { sampleRate: sr }), f, sr, settle, len) / 1e-3);
}
/** |H(f)| in dB of a cascade of designed sections (the design values). */
function designDb(sections: readonly Biquad[], f: number, sr: number): number {
  const w = (2 * Math.PI * f) / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
  let g = 0;
  for (const [b0, b1, b2, a1, a2] of sections as unknown as number[][]) {
    const nr = b0! + b1! * c1 + b2! * c2, ni = -(b1! * s1 + b2! * s2), dr = 1 + a1! * c1 + a2! * c2, di = -(a1! * s1 + a2! * s2);
    g += 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  return g;
}
/** Every combination of the extremes of the parameters (as the contract suite builds them; amount 0 included). */
function corners(): AudioFxParams[] {
  const props = (describeAudioCatalog().audioEffects.find((e) => e.id === 'cleanup.speech')!.paramsSchema as { properties: Record<string, { minimum?: number; maximum?: number }> }).properties;
  let out: AudioFxParams[] = [{}];
  for (const [k, s] of Object.entries(props)) out = out.flatMap((p) => [s.minimum!, s.maximum!].map((v) => ({ ...p, [k]: v })));
  return out.map((p) => P(p));
}
const same = (a: Float32Array, b: Float32Array) => a.length === b.length && Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

describe('cleanup.speech: reach', () => {
  it('ahead ≤ 250 ms (the registry aheadMs) and warm ≤ 1.2 s at every corner and rate; ahead 0, warm 0 and DRY at amount 0', () => {
    let worstAhead = 0, worstWarm = 0;
    for (const sr of RATES) for (const p of corners()) {
      const r = reach(p, sr);
      if (p.amount === 0) { expect(r).toEqual({ warm: 0, tail: 0, ahead: 0 }); continue; }
      worstAhead = Math.max(worstAhead, (r.ahead! * 1000) / sr);
      worstWarm = Math.max(worstWarm, r.warm / sr);
      expect(r.ahead! * 1000 / sr, `${sr} ${JSON.stringify(p)}`).toBeLessThanOrEqual(250);
      expect(r.warm / sr, `${sr} ${JSON.stringify(p)}`).toBeLessThanOrEqual(1.2);
      expect(r.tail).toBe(0);
    }
    console.log(`cleanup.speech reach: look-ahead at most ${worstAhead.toFixed(2)} ms, warm-up at most ${worstWarm.toFixed(3)} s`);
  });
});

describe('cleanup.speech: limiter', () => {
  it('over 200 seeded random signals (noise × gains up to 8, ±1 clicks) at every ceilingDb corner, the peak never exceeds 10^(ceilingDb/20)·(1 + 1e-9)', () => {
    const frames = Math.round(0.3 * SR);
    for (const ceilingDb of [-6, -1, 0]) {
      const c = 10 ** (ceilingDb / 20);
      let worst = 0;
      for (let s = 0; s < 200; s++) {
        const x = new Float32Array(frames * 2);
        for (let i = 0; i < frames; i++) {
          const g = 8 * uniform(hash32(s, Math.floor(i / 2000), 1)); // a new gain every 2000 frames
          for (const ch of [0, 1]) x[i * 2 + ch] = g * (2 * uniform(hash32(s, i, ch + 2)) - 1);
          if (hash32(s, i, 9) % 400 === 0) { const v = hash32(s, i, 10) % 2 ? 1 : -1; x[i * 2] = v; x[i * 2 + 1] = -v; }
        }
        const p = P({ ceilingDb, levelDb: [0, 8, 15][s % 3]!, presence: [0, 0.5, 1][s % 3]!, lowCutHz: [20, 80, 150][(s >> 1) % 3]!, targetDb: s % 2 ? -12 : -30, amount: s % 5 === 0 ? 0.3 : 1 });
        const y = renderFx('cleanup.speech', p, x, { at: hash32(s, 0, 11) % 100000 });
        for (const v of y) { if (!Number.isFinite(v)) throw new Error('not finite'); const a = Math.abs(v); if (a > worst) worst = a; }
      }
      expect(worst, `ceilingDb ${ceilingDb}: peak ${worst}`).toBeLessThanOrEqual(c * (1 + 1e-9));
      expect(worst, 'the signals do reach the ceiling').toBeGreaterThan(c * 0.99);
    }
  }, 120000);
});

describe('cleanup.speech: leveller', () => {
  it('alternating 2 s phrases at −35 and −15 dBFS (levelDb 10, target −20) end within 6 dB of each other after 1 s of settling', () => {
    const p = P({ levelDb: 10, targetDb: -20 }), phrase = 2 * SR, n = 8, x = new Float32Array(phrase * n * 2);
    for (let k = 0; k < n; k++) x.set(noise(phrase, 100 + k, ampFor(k % 2 ? -15 : -35)), k * phrase * 2);
    const y = renderFx('cleanup.speech', p, x);
    const levels: number[] = [];
    for (let k = 0; k < n; k++) levels.push(rmsDb(y, k * phrase + SR, (k + 1) * phrase));
    console.log(`leveller: phrase levels in −35/−15 dBFS → out ${levels.map((v) => v.toFixed(1)).join(', ')} dBFS`);
    for (let k = 1; k < n; k++) expect(Math.abs(levels[k]! - levels[k - 1]!), `phrases ${k - 1} and ${k}`).toBeLessThanOrEqual(6);
    for (let k = 0; k < n; k++) {
      if (k % 2) expect(Math.abs(levels[k]! + 20), `loud phrase ${k} brought to the target`).toBeLessThan(1);
      else expect(levels[k]!, `quiet phrase ${k} raised by about levelDb`).toBeGreaterThan(-35 + 9);
    }
  }, 120000);
  it('noise-only pauses at −60 dBFS are never raised by more than 0.1 dB: a recording of nothing but such noise, and pauses between quiet phrases farther than the hold (130 ms) from speech', () => {
    // the reference is the same effect with levelDb 0 (the leveller at gain 1): the low cut and presence EQ alone
    const loud = P({ levelDb: 15, presence: 0.5 }), flat = P({ levelDb: 0, presence: 0.5 });
    const B = speechDesign(loud, SR).B, warm = reach(loud).warm;
    // (a) nothing but noise
    const quiet = noise(6 * SR, 5, ampFor(-60));
    const ya = renderFx('cleanup.speech', loud, quiet), ra = renderFx('cleanup.speech', flat, quiet);
    let worstA = -Infinity;
    for (let b = Math.ceil(warm / B); (b + 1) * B <= 6 * SR; b++) worstA = Math.max(worstA, rmsDb(ya, b * B, (b + 1) * B) - rmsDb(ra, b * B, (b + 1) * B));
    // (b) phrases at −35 dBFS (they want +15 dB) with 1 s pauses of −60 dBFS noise
    const ph = Math.round(1.5 * SR), pa = SR, cycles = 4, x = noise((ph + pa) * cycles, 6, ampFor(-60));
    const speechAt: [number, number][] = [];
    for (let k = 0; k < cycles; k++) { const s = k * (ph + pa) + pa; x.set(noise(ph, 200 + k, ampFor(-35)), s * 2); speechAt.push([s, s + ph]); }
    const yb = renderFx('cleanup.speech', loud, x), rb = renderFx('cleanup.speech', flat, x);
    const margin = Math.round(0.15 * SR);
    let worstB = -Infinity, nearEdge = -Infinity, checked = 0, phraseGain = Infinity;
    for (let b = Math.ceil(warm / B); (b + 1) * B <= x.length / 2; b++) {
      const lo = b * B, hi = (b + 1) * B, rise = rmsDb(yb, lo, hi) - rmsDb(rb, lo, hi);
      const inSpeech = speechAt.some(([s, e]) => hi > s && lo < e), far = !speechAt.some(([s, e]) => hi > s - margin && lo < e + margin);
      if (far) { worstB = Math.max(worstB, rise); checked++; } else if (!inSpeech) nearEdge = Math.max(nearEdge, rise);
      if (inSpeech && lo > speechAt.find(([s, e]) => lo >= s && lo < e)![0] + 0.5 * SR) phraseGain = Math.min(phraseGain, rise);
    }
    console.log(`pauses: noise only ${worstA.toFixed(3)} dB; pause blocks ≥ 150 ms from speech ${worstB.toFixed(3)} dB (${checked} blocks); within 150 ms of speech up to ${nearEdge.toFixed(2)} dB (the hold); the phrases themselves raised by at least ${phraseGain.toFixed(1)} dB`);
    expect(worstA).toBeLessThanOrEqual(0.1);
    expect(worstB).toBeLessThanOrEqual(0.1);
    expect(checked).toBeGreaterThan(200);
    expect(phraseGain, 'the quiet phrases are raised (the test is not vacuous)').toBeGreaterThan(10);
  }, 120000);
});

describe('cleanup.speech: filters', () => {
  it('presence EQ at 300 Hz, 3.5 kHz and 10 kHz within ±0.3 dB of the design values at presence 0, 0.5 and 1, at 44.1, 48 and 96 kHz (and the design is −2p, +4p near its centres)', () => {
    const rows: string[] = [];
    for (const sr of RATES) for (const presence of [0, 0.5, 1]) {
      const p = P({ presence }), want = [...butterworth4('high', 80, sr), ...presenceSections(presence, sr)];
      for (const f of [300, 3500, 10000]) {
        const got = responseDb(p, f, sr), d = designDb(want, f, sr);
        rows.push(`${sr}/${presence}/${f}: ${got.toFixed(2)} (design ${d.toFixed(2)})`);
        expect(Math.abs(got - d), `${sr} Hz presence ${presence} at ${f} Hz`).toBeLessThanOrEqual(0.3);
      }
      expect(Math.abs(designDb(presenceSections(presence, sr), 300, sr) + 2 * presence)).toBeLessThan(0.1);
      expect(Math.abs(designDb(presenceSections(presence, sr), 3500, sr) - 4 * presence)).toBeLessThan(0.1);
    }
    console.log(`presence EQ: ${rows.join('; ')}`);
  }, 120000);
  it('the lowCutHz −3 dB point is within 2 % at 44.1, 48 and 96 kHz (the response at 0.98·f is below −3 dB, at 1.02·f above)', () => {
    for (const sr of RATES) for (const lowCutHz of [20, 80, 150]) {
      const p = P({ lowCutHz, presence: 0 }), ref = responseDb(p, 1000, sr);
      const below = responseDb(p, 0.98 * lowCutHz, sr) - ref, above = responseDb(p, 1.02 * lowCutHz, sr) - ref;
      expect(below, `${sr} ${lowCutHz}`).toBeLessThan(-3);
      expect(above, `${sr} ${lowCutHz}`).toBeGreaterThan(-3);
    }
  }, 120000);
});

describe('cleanup.speech: look-ahead and exact finite memory', () => {
  it('a click on silence comes out at its own frame (aligned) and exactly `ahead` frames later in the raw in-place output', () => {
    for (const sr of RATES) for (const k of [5000, 33333]) {
      const p = P({ presence: 0 }), ahead = reach(p, sr).ahead!, x = new Float32Array((k + sr) * 2);
      x[k * 2] = 0.5; x[k * 2 + 1] = 0.5;
      const peakAt = (y: Float32Array) => { let m = 0, at = -1; for (let i = 0; i < y.length / 2; i++) if (Math.abs(y[i * 2]!) > m) { m = Math.abs(y[i * 2]!); at = i; } return at; };
      expect(peakAt(renderFx('cleanup.speech', p, x, { sampleRate: sr })), `${sr} aligned`).toBe(k);
      expect(peakAt(renderFx('cleanup.speech', p, x, { sampleRate: sr, align: false })), `${sr} raw`).toBe(k + ahead);
    }
  }, 120000);
  it('histories that agree on the last `warm` samples give EXACTLY equal output (any timeline position, the largest warm-up included)', () => {
    for (const [sr, p] of [[SR, P()], [SR, P({ lowCutHz: 20, presence: 1, levelDb: 15, targetDb: -12, ceilingDb: -6 })], [44100, P({ amount: 0.5, lowCutHz: 150 })], [96000, P({ lowCutHz: 20 })]] as const) {
      const { warm } = reach(p, sr), H = 2401, M = 4800, total = H + warm + M;
      for (const at of [0, 4801, 1_234_567, -999]) {
        const common = noise(total, 5, 0.4);
        for (let i = 0; i < total; i += 977) { common[i * 2] = 1; common[i * 2 + 1] = -1; } // peaks for the limiter
        const a = common.slice(), b = common.slice();
        a.set(noise(H, 6, 0.4)); b.set(noise(H, 7, 0.9));
        const ya = renderFx('cleanup.speech', p, a, { sampleRate: sr, at }), yb = renderFx('cleanup.speech', p, b, { sampleRate: sr, at });
        expect(same(ya.subarray((H + warm) * 2), yb.subarray((H + warm) * 2)), `${sr} at ${at} ${JSON.stringify(p)}`).toBe(true);
        let before = false;
        for (let i = H * 2; i < (H + warm) * 2; i++) if (ya[i] !== yb[i]) { before = true; break; }
        expect(before, 'the histories mattered before that point').toBe(true);
      }
    }
  }, 120000);
});

// ---- through the voice runtime ------------------------------------------------------------------------------------------------
const FILE = SR * 40;
/** A recording (sample j at its own rate): phrases of noise and a tone that come and go, some loud enough for the limiter, over a quiet floor. */
const native = (j: number, ch: number, rate = SR) => {
  if (j < 0 || j >= FILE) return 0;
  const phrase = Math.floor(j / (0.6 * rate)), on = phrase % 3 !== 2, lvl = [0.05, 0.6, 0.02][phrase % 3]!;
  return 0.002 * (uniform(hash32(91, j, ch)) - 0.5) + (on ? lvl * (uniform(hash32(92, j, ch)) - 0.5) + lvl * Math.sin((2 * Math.PI * 220 * j) / rate + ch) : 0);
};
const fx = (params: AudioFxParams = {}): PlannedFx => ({ id: 'fx_speech', type: 'cleanup.speech', version: 1, stage: 2, params: P(params), seed: 0 });
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });
/** A clip with fades on the outer edges only, no volume keys, no ducking, gain 1, centred: its output is the window output exactly. */
function clipOf(at: number, length: number, sourceIn: [number, number], chain: PlannedFx[], sourceRate = SR, edges = { fadeIn: true, fadeOut: true }): PlannedAudioClip {
  const r = chainReach(chain, SR, 1);
  return {
    clipId: 'c', trackId: 't', assetId: 'a', at, length, source: 0, speed: 1, gain: 1, pan: 0,
    fade: [{ s: 0, g: edges.fadeIn ? 0 : 1 }, ...(edges.fadeIn ? [{ s: 300, g: 1 }] : []), ...(edges.fadeOut ? [{ s: length - 400, g: 1 }] : []), { s: length, g: edges.fadeOut ? 0 : 1 }],
    duck: [{ s: 0, g: 1 }, { s: length, g: 1 }],
    voice: { chain, sourceIn: rt(sourceIn[0], sourceIn[1]), sourceEnd: rt(sourceIn[0] * SR + length * sourceIn[1], sourceIn[1] * SR), speed: { num: 1, den: 1 }, reverse: false, sourceRate, warmWindow: r.warmWindow, warmRing: r.warmRing, aheadWindow: r.aheadWindow, tail: 0 },
  };
}
function render(clip: PlannedAudioClip, chunk = 7919): Float32Array {
  const v = openClipVoice(clip, SR, clip.voice!.sourceRate, 0, Infinity), rate = clip.voice!.sourceRate;
  const { origin, first, last } = v.input, parts: Float32Array[] = [], buf = new Float32Array(chunk * 2);
  for (let k = first; k < last; k += chunk) {
    const n = Math.min(chunk, last - k);
    for (let i = 0; i < n; i++) { buf[i * 2] = native(origin + k + i, 0, rate); buf[i * 2 + 1] = native(origin + k + i, 1, rate); }
    parts.push(v.push(buf.subarray(0, n * 2)));
  }
  parts.push(v.finish());
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('cleanup.speech through the voice runtime (openClipVoice)', () => {
  it('a cut at c = 13001 with at = 4800: the parts sum to the whole bit-exactly at sourceRate = planRate, and within 2^-17·peak from a 44.1 kHz source', () => {
    const L = 2 * SR, c = 13001, at = 4800, chain = [fx()];
    for (const sourceRate of [SR, 44100]) {
      const whole = render(clipOf(at, L, [12, 10], chain, sourceRate));
      const a = render(clipOf(at, c, [12, 10], chain, sourceRate, { fadeIn: true, fadeOut: false }));
      const b = render(clipOf(at + c, L - c, [12 * SR + 10 * c, 10 * SR], chain, sourceRate, { fadeIn: false, fadeOut: true }));
      expect([a.length / 2, b.length / 2]).toEqual([c, L - c]);
      const sum = new Float32Array(whole.length);
      sum.set(a); sum.set(b, c * 2);
      let worst = 0, peak = 0;
      for (let i = 0; i < whole.length; i++) { worst = Math.max(worst, Math.abs(sum[i]! - whole[i]!)); peak = Math.max(peak, Math.abs(whole[i]!)); }
      console.log(`split, speech, source ${sourceRate}: exact ${same(sum, whole)}, worst ${worst}, peak ${peak.toFixed(3)}`);
      expect(peak).toBeGreaterThan(0.5);
      if (sourceRate === SR) expect(same(sum, whole)).toBe(true);
      else expect(worst).toBeLessThanOrEqual(2 ** -17 * peak);
    }
  }, 120000);
  it('the whole voice runs at least 40× real time in Node on 30 s of 48 kHz stereo (reported; CPU time of this process, so other work on a shared machine does not count)', () => {
    const seconds = 30, clip = clipOf(0, seconds * SR, [1, 10], [fx()]);
    const v0 = openClipVoice(clip, SR, SR, 0, Infinity), n = v0.input.last - v0.input.first, src = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { src[i * 2] = native(v0.input.origin + v0.input.first + i, 0); src[i * 2 + 1] = native(v0.input.origin + v0.input.first + i, 1); }
    let best = { cpu: 0, wall: 0 };
    for (let k = 0; k < 3; k++) {
      const v = openClipVoice(clip, SR, SR, 0, Infinity), t0 = performance.now(), c0 = process.cpuUsage();
      for (let o = 0; o < n; o += 4096) v.push(src.subarray(o * 2, Math.min(n, o + 4096) * 2));
      v.finish();
      const c = process.cpuUsage(c0), r = { cpu: seconds / ((c.user + c.system) / 1e6), wall: seconds / ((performance.now() - t0) / 1000) };
      if (r.cpu > best.cpu) best = r;
    }
    console.log(`voice speed: speech enhancer ${best.cpu.toFixed(1)}× real time in CPU time (${best.wall.toFixed(1)}× wall), best of 3, 30 s at 48 kHz stereo`);
    expect(best.cpu).toBeGreaterThanOrEqual(40);
  }, 120000);
  it('the design is what the catalogue promises: 10 ms blocks, a 5 ms limiter, a restart warm-up within 2^-20', () => {
    const d = speechDesign(P(), SR);
    expect([d.B, d.M, d.S === d.Wf, SPEECH.restartEps]).toEqual([480, 240, true, 2 ** -20]);
    expect(d.ahead).toBe(24 * 480 + 239);
  });
});
