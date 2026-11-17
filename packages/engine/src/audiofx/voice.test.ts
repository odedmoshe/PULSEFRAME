/**
 * The voice runtime (ADR-0010 D3) with TEST kernels registered here (labelled `test.*`; the real kernels are tested in kernels.test.ts).
 * The test kernels cover the shapes that matter for seeking: a decaying IIR window stage, a finite-memory sample-and-hold anchored
 * to the timeline with seeded noise, a decaying feedback comb as the ring stage, and a stateless stereo stage.
 */
import { describe, expect, it } from 'vitest';
import { mixClip, type PlannedAudioClip, type PlannedFx } from '../audio.ts';
import type { FxKernel } from './kernel.ts';
import { chainReach, registerKernel } from './registry.ts';
import { timeMapOrigin } from './timemap.ts';
import { fillPlayingOrder, openClipVoice, VOICE_BLOCK } from './voice.ts';

const EPS = 2 ** -24;
const hash = (seed: number, t: number, ch: number) => { let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(t, 0xc2b2ae35) ^ Math.imul(ch + 1, 0x27d4eb2f); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) / 4294967296) - 0.5; };
const ceilLog = (g: number) => { let w = 0, x = 1; while (x > EPS) { x *= g; w++; } return w; }; // smallest W with g^W <= EPS

/** test.lp: one-pole low pass y += a·(x − y), pole 0.95 (Σ_{k≥W}|h| = 0.95^W). */
const lp: FxKernel = { type: 'test.lp', version: 1, stage: 3, reach: () => ({ warm: ceilLog(0.95), tail: 0 }), create: () => {
  let l = 0, r = 0;
  return { process(buf, frames) { for (let f = 0; f < frames; f++) { l += 0.05 * (buf[f * 2]! - l); r += 0.05 * (buf[f * 2 + 1]! - r); buf[f * 2] = l; buf[f * 2 + 1] = r; } } };
} };
/** test.hold: sample-and-hold every 5 timeline samples (finite memory 4) plus seeded noise keyed on the timeline sample. */
const hold: FxKernel = { type: 'test.hold', version: 1, stage: 3, reach: () => ({ warm: 4, tail: 0 }), create: (_p, ctx) => {
  let hl = 0, hr = 0;
  return { process(buf, frames, n0) { for (let f = 0; f < frames; f++) { const t = ctx.at + n0 + f; if (((t % 5) + 5) % 5 === 0) { hl = buf[f * 2]!; hr = buf[f * 2 + 1]!; } buf[f * 2] = hl + 1e-3 * hash(ctx.seed, t, 0); buf[f * 2 + 1] = hr + 1e-3 * hash(ctx.seed, t, 1); } } };
} };
/** test.comb: y = x + Σ_{j≥1} 0.5^j·x[n − 100j] (feedback comb, linear, decaying). */
const D = 100;
const comb: FxKernel = { type: 'test.comb', version: 1, stage: 4, reach: () => ({ warm: D * (ceilLog(0.5) + 1), tail: D * (ceilLog(0.5) + 1) }), create: () => {
  const line = new Float64Array(D * 2); let pos = 0;
  return { process(buf, frames) { for (let f = 0; f < frames; f++) { const wl = line[pos * 2]!, wr = line[pos * 2 + 1]!; const xl = buf[f * 2]!, xr = buf[f * 2 + 1]!; line[pos * 2] = 0.5 * (xl + wl); line[pos * 2 + 1] = 0.5 * (xr + wr); pos = (pos + 1) % D; buf[f * 2] = xl + wl; buf[f * 2 + 1] = xr + wr; } } };
} };
/** test.width: stateless mid/side at width 0.5. */
const width: FxKernel = { type: 'test.width', version: 1, stage: 6, reach: () => ({ warm: 0, tail: 0 }), create: () => ({ process(buf, frames) { for (let f = 0; f < frames; f++) { const m = (buf[f * 2]! + buf[f * 2 + 1]!) / 2, s = (0.5 * (buf[f * 2]! - buf[f * 2 + 1]!)) / 2; buf[f * 2] = m + s; buf[f * 2 + 1] = m - s; } } }) };
/** test.unity: a ring stage that changes nothing. */
const unity: FxKernel = { type: 'test.unity', version: 1, stage: 4, reach: () => ({ warm: 0, tail: 0 }), create: () => ({ process() {} }) };
for (const k of [lp, hold, comb, width, unity]) registerKernel(k);
const fx = (k: FxKernel, seed = 0): PlannedFx => ({ id: `fx_${k.type}`, type: k.type, version: k.version, stage: k.stage, params: {}, seed });
const FULL = [fx(lp), fx(hold, 77), fx(comb), fx(width)];

const SR = 48000, FILE = 48000 * 3; // the source file: 3 s, silence outside
/** A rich native signal: two tones, a click every 997 samples and a little seeded noise; L and R differ. */
const native = (j: number, ch: number) => (j < 0 || j >= FILE ? 0 : 0.4 * Math.sin(j * (ch ? 0.031 : 0.023)) + 0.2 * Math.sin(j * 0.71 + ch) + (j % 997 === 0 ? 0.3 : 0) + 0.01 * hash(5, j, ch));
const rt = (value: number, timescale: number) => ({ value: String(value), timescale });

interface Cfg { at: number; length: number; sourceIn: [number, number]; sourceRate?: number; speed?: [number, number]; reverse?: boolean; chain?: PlannedFx[]; fadeIn?: number; fadeOut?: number; tail?: number; cutFrom?: number }
function clipOf(c: Cfg): PlannedAudioClip {
  const chain = c.chain ?? FULL;
  const reach = chainReach(chain, SR);
  const speed = c.speed ?? [1, 1];
  const tail = c.tail ?? reach.tail;
  const srcEnd = (c.sourceIn[0] * speed[1] * SR + c.length * speed[0] * c.sourceIn[1]) ; // sourceIn + length·speed/SR, over sourceIn[1]·speed[1]·SR
  const fin = c.fadeIn ?? 300, fout = c.fadeOut ?? 400;
  return {
    clipId: 'c', trackId: 't', assetId: 'a', at: c.at, length: c.length, source: 0, speed: speed[0] / speed[1], gain: 0.8, pan: 0.25,
    fade: [{ s: 0, g: fin ? 0 : 1 }, ...(fin ? [{ s: fin, g: 1 }] : []), ...(fout ? [{ s: c.length - fout, g: 1 }] : []), { s: c.length, g: fout ? 0 : 1 }],
    vol: [{ s: 0, g: 1 }, { s: Math.round(c.length / 3), g: 0.5 }, { s: c.length, g: 0.75 }],
    duck: [{ s: 0, g: 1 }, { s: 2000, g: 1 }, { s: 2600, g: 0.3 }, { s: c.length + 500, g: 0.3 }, { s: c.length + tail, g: 0.9 }],
    voice: { chain, sourceIn: rt(c.sourceIn[0], c.sourceIn[1]), sourceEnd: rt(srcEnd, c.sourceIn[1] * speed[1] * SR), speed: { num: speed[0], den: speed[1] }, reverse: !!c.reverse, sourceRate: c.sourceRate ?? SR, warmWindow: reach.warmWindow, warmRing: reach.warmRing, tail, ...(c.cutFrom !== undefined ? { cutFrom: c.cutFrom } : {}) },
  };
}
/** The playing-order source P[first, last) of a voice, from the native signal (sample j of the file at its own rate). */
function playingOrder(v: ReturnType<typeof openClipVoice>) {
  const { origin, first, last, reverse } = v.input;
  const P = new Float32Array(Math.max(0, last - first) * 2);
  for (let k = first; k < last; k++) { const j = reverse ? origin - 1 - k : origin + k; P[(k - first) * 2] = native(j, 0); P[(k - first) * 2 + 1] = native(j, 1); }
  return P;
}
let rng = 12345;
const rand = (n: number) => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng % n; };
/** Render [from, to) of a clip, feeding P in pieces of the given sizes (cycled), then finishing. */
function render(clip: PlannedAudioClip, from: number, to: number, sizes: () => number = () => 1 << 30) {
  const v = openClipVoice(clip, SR, clip.voice!.sourceRate, from, to);
  const P = playingOrder(v);
  const parts: Float32Array[] = [];
  for (let o = 0; o < P.length / 2;) { const n = Math.max(1, sizes()); parts.push(v.push(P.subarray(o * 2, Math.min(P.length / 2, o + n) * 2))); o += n; }
  parts.push(v.finish());
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return { v, out };
}
const peakOf = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

const CONFIGS: Record<string, Cfg> = {
  'same rate': { at: 4800, length: 30000, sourceIn: [12, 10] },
  '44.1 kHz source': { at: 4800, length: 30000, sourceIn: [12, 10], sourceRate: 44100 },
  'speed 3/2, reversed': { at: 4800, length: 30000, sourceIn: [11, 10], speed: [3, 2], reverse: true },
  'fractional start, speed 1': { at: 4799, length: 30000, sourceIn: [1001, 900] },
};

describe('clip voice runtime (ADR-0010 D3)', () => {
  it('the input it asks for: from the warm-up start to the last tap of the clip body, in playing order', () => {
    const clip = clipOf(CONFIGS['same rate']!);
    const v = openClipVoice(clip, SR, SR, 0, Infinity);
    const o = timeMapOrigin({ ...clip.voice!, sourceRate: SR, planRate: SR });
    expect(v.input).toEqual({ origin: o.origin, first: -clip.voice!.warmWindow, last: clip.length, reverse: false });
    expect([v.from, v.end]).toEqual([0, clip.length + clip.voice!.tail]);
    // a range that starts deep in the tail needs no source at all
    const t = openClipVoice(clip, SR, SR, clip.length + clip.voice!.warmRing + 5, Infinity);
    expect(t.input.last - t.input.first).toBe(0);
  });

  for (const [name, cfg] of Object.entries(CONFIGS)) {
    it(`${name}: any push sizes give per-sample identical output, and nothing is produced after end`, () => {
      const clip = clipOf(cfg);
      const whole = render(clip, 0, Infinity);
      expect(whole.out.length).toBe((clip.length + clip.voice!.tail) * 2);
      expect(peakOf(whole.out)).toBeGreaterThan(0.1);
      for (const sizes of [() => 1 + rand(5000), () => 1 + rand(3), () => VOICE_BLOCK, () => 1 + rand(70000)]) {
        const again = render(clip, 0, Infinity, sizes);
        expect(again.out.length).toBe(whole.out.length);
        let same = true;
        for (let i = 0; i < whole.out.length; i++) if (!Object.is(whole.out[i], again.out[i])) { same = false; break; }
        expect(same).toBe(true);
      }
      for (const to of [1, 777, clip.length, clip.length + 1, clip.length + clip.voice!.tail - 1, clip.length + clip.voice!.tail + 999]) {
        const r = render(clip, 0, to);
        expect(r.v.end).toBe(Math.min(to, clip.length + clip.voice!.tail));
        expect(r.out.length).toBe(r.v.end * 2);
      }
    });

    it(`${name}: opening at any sample is bit-exact within the ring warm-up, else within 2^-17 of the peak`, () => {
      const clip = clipOf(cfg);
      const whole = render(clip, 0, Infinity).out;
      const peak = peakOf(whole), warm = clip.voice!.warmRing, E = clip.length + clip.voice!.tail;
      const froms = [1, 333, warm - 1, warm, warm + 1, 7001, 12345, clip.length - 1, clip.length, clip.length + 17, E - 3];
      for (let k = 0; k < 6; k++) froms.push(rand(E));
      for (const from of froms) {
        const to = Math.min(E, from + 1 + rand(9000));
        const part = render(clip, from, to, () => 1 + rand(4000)).out;
        expect(part.length, `from ${from}`).toBe((to - from) * 2);
        let worst = 0, exact = true;
        for (let i = 0; i < part.length; i++) { const d = Math.abs(part[i]! - whole[from * 2 + i]!); worst = Math.max(worst, d); if (!Object.is(part[i], whole[from * 2 + i])) exact = false; }
        if (from <= warm) expect(exact, `from ${from} <= warmRing ${warm} is bit-exact`).toBe(true);
        else expect(worst, `from ${from}`).toBeLessThanOrEqual(2 ** -17 * peak);
      }
    });
  }

  it('a cut clip: the two parts (each with its own warm-up and tail) sum to the whole within 2^-17 of the peak', () => {
    const L = 30000, c = 13001, at = 4800;
    for (const sourceRate of [SR, 44100]) {
      const whole = clipOf({ at, length: L, sourceIn: [12, 10], sourceRate });
      // the parts: fades on the outer edges only, volume keys and ducking sliced, source of the second part starts c samples later
      const a = clipOf({ at, length: c, sourceIn: [12, 10], sourceRate, fadeOut: 0 });
      const b = clipOf({ at: at + c, length: L - c, sourceIn: [12 * SR + 10 * c, 10 * SR], sourceRate, fadeIn: 0 });
      a.fade = [{ s: 0, g: 0 }, { s: 300, g: 1 }, { s: c, g: 1 }];
      b.fade = [{ s: 0, g: 1 }, { s: L - c - 400, g: 1 }, { s: L - c, g: 0 }];
      const slice = (env: { s: number; g: number }[], from: number, len: number) => { const g = (s: number) => { for (let i = 1; i < env.length; i++) if (s <= env[i]!.s) { const p = env[i - 1]!, q = env[i]!; return q.s === p.s ? q.g : p.g + ((q.g - p.g) * (s - p.s)) / (q.s - p.s); } return env.at(-1)!.g; }; return [{ s: 0, g: g(from) }, ...env.filter((p) => p.s > from && p.s < from + len).map((p) => ({ s: p.s - from, g: p.g })), { s: len, g: g(from + len) }]; };
      a.vol = slice(whole.vol!, 0, c); b.vol = slice(whole.vol!, c, L - c);
      a.duck = slice(whole.duck, 0, c + a.voice!.tail); b.duck = slice(whole.duck, c, L - c + b.voice!.tail);
      const w = render(whole, 0, Infinity).out, pa = render(a, 0, Infinity).out, pb = render(b, 0, Infinity).out;
      const sum = new Float32Array(w.length);
      for (let i = 0; i < pa.length; i++) sum[i] = sum[i]! + pa[i]!;
      for (let i = 0; i < pb.length; i++) sum[c * 2 + i] = sum[c * 2 + i]! + pb[i]!;
      const peak = peakOf(w);
      let worst = 0;
      for (let i = 0; i < w.length; i++) worst = Math.max(worst, Math.abs(sum[i]! - w[i]!));
      expect(worst, `source rate ${sourceRate}`).toBeLessThanOrEqual(2 ** -17 * peak);
      expect(pa.length).toBe((c + a.voice!.tail) * 2); // the first part rings on past the cut
    }
  });

  it('the tail cut: a linear fade to zero over [cutFrom, length + tail)', () => {
    const clip = clipOf({ at: 4800, length: 20000, sourceIn: [12, 10], tail: 1000, cutFrom: 20520 });
    const uncut = clipOf({ at: 4800, length: 20000, sourceIn: [12, 10], tail: 1000 });
    const a = render(clip, 0, Infinity).out, b = render(uncut, 0, Infinity).out;
    expect(a.length).toBe(21000 * 2);
    for (let i = 0; i < 20520 * 2; i++) expect(a[i]).toBe(b[i]);
    for (const i of [20520, 20700, 20999]) expect(a[i * 2]).toBeCloseTo(b[i * 2]! * ((21000 - i) / 480), 6);
  });

  it('an identity chain is the plain mix: equal to mixClip within 1e-6', () => {
    const clip = clipOf({ at: 4800, length: 30000, sourceIn: [12, 10], chain: [fx(unity)] });
    expect(clip.voice!.tail).toBe(0);
    clip.duck = [{ s: 0, g: 1 }, { s: 2000, g: 1 }, { s: 2600, g: 0.3 }, { s: clip.length, g: 0.3 }];
    const y = render(clip, 0, Infinity).out;
    const S = Math.round(1.2 * SR);
    const pcm = new Float32Array(clip.length * 2);
    for (let i = 0; i < clip.length; i++) { pcm[i * 2] = native(S + i, 0); pcm[i * 2 + 1] = native(S + i, 1); }
    const ref = new Float32Array((clip.at + clip.length) * 2);
    mixClip(ref, 0, clip, pcm, 0);
    let worst = 0;
    for (let i = 0; i < clip.length * 2; i++) worst = Math.max(worst, Math.abs(y[i]! - ref[clip.at * 2 + i]!));
    expect(worst).toBeLessThan(1e-6);
    expect(peakOf(y)).toBeGreaterThan(0.1);
  });

  it('fillPlayingOrder places decoded pieces of any size, forwards and reversed', () => {
    for (const reverse of [false, true]) {
      const input = { origin: 5000, first: -300, last: 4000, reverse };
      const want = new Float32Array((input.last - input.first) * 2);
      for (let k = input.first; k < input.last; k++) { const j = reverse ? input.origin - 1 - k : input.origin + k; want[(k - input.first) * 2] = native(j, 0); want[(k - input.first) * 2 + 1] = native(j, 1); }
      const got = new Float32Array(want.length);
      for (let start = 0; start < FILE;) {
        const n = 1 + rand(3000);
        const data = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) { data[i * 2] = native(start + i, 0); data[i * 2 + 1] = native(start + i, 1); }
        fillPlayingOrder(got, input.first, input, { start, data });
        start += n;
      }
      expect(Array.from(got)).toEqual(Array.from(want));
    }
  });
});
