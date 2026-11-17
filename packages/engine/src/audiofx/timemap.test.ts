import { describe, expect, it } from 'vitest';
import { PhaseCursor, positionAt, SourceTimeMap, sincTable, timeMapOrigin, type TimeMapSpec } from './timemap.ts';
import { fillPlayingOrder } from './voice.ts';

const rt = (value: number | bigint, timescale: number) => ({ value: String(value), timescale });
const spec = (s: Partial<TimeMapSpec>): TimeMapSpec => ({ sourceIn: rt(0, 1), sourceEnd: rt(10, 1), speed: { num: 1, den: 1 }, reverse: false, sourceRate: 48000, planRate: 48000, ...s });
const stereoOf = (mono: Float64Array) => { const o = new Float32Array(mono.length * 2); for (let i = 0; i < mono.length; i++) { o[i * 2] = mono[i]!; o[i * 2 + 1] = mono[i]!; } return o; };
/** Output samples [0, n) of a map over a playing-order source P that starts at P index 0. */
function renderAll(map: SourceTimeMap, P: Float32Array, n: number) {
  const out = new Float32Array(n * 2);
  map.render(P, 0, out, n);
  return out;
}
/** Source long enough for `n` outputs of the map, with the taps before index 0 padded: returns [P, first]. */
function sourceFor(map: SourceTimeMap, n: number, fn: (k: number) => number): [Float32Array, number] {
  const first = map.firstInput(0), end = map.endInput(n - 1);
  const m = new Float64Array(end - first);
  for (let k = first; k < end; k++) m[k - first] = fn(k);
  return [stereoOf(m), first];
}

// in-test FFT (radix 2) for the spectral checks
function fftMag(x: Float64Array): Float64Array {
  const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const a = i + k, b = a + len / 2;
      const tr = re[b]! * wr - im[b]! * wi, ti = re[b]! * wi + im[b]! * wr;
      re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
    }
  }
  const mag = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) mag[i] = Math.hypot(re[i]!, im[i]!);
  return mag;
}
/** Largest spectral line other than the wanted one (and DC), in dB relative to the wanted one, of one channel of `out`. */
function spuriousDb(out: Float32Array, wantCyclesPerSample: number): number {
  const n = 1 << 15;
  const x = new Float64Array(n);
  const off = 4096; // skip the start
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / (n - 1);
    const w = 0.35875 - 0.48829 * Math.cos(t) + 0.14128 * Math.cos(2 * t) - 0.01168 * Math.cos(3 * t); // Blackman-Harris, sidelobes < -92 dB
    x[i] = out[(off + i) * 2]! * w;
  }
  const mag = fftMag(x);
  const bin = Math.round(wantCyclesPerSample * n);
  let peak = 0;
  for (let k = bin - 3; k <= bin + 3; k++) peak = Math.max(peak, mag[k]!);
  let spur = 0;
  for (let k = 8; k < n / 2; k++) if (Math.abs(k - bin) > 10) spur = Math.max(spur, mag[k]!);
  return 20 * Math.log10(spur / peak);
}

describe('engine time map (ADR-0010)', () => {
  it('identity: step 1 and phase 0 copy the source exactly', () => {
    const o = timeMapOrigin(spec({ sourceIn: rt(3, 2) }));
    expect(o.origin).toBe(72000);
    expect(o.phase0).toEqual([0n, 1n]);
    const map = new SourceTimeMap(o, 0);
    expect(map.identity).toBe(true);
    const n = 5000;
    const P = new Float32Array(n * 2);
    for (let i = 0; i < P.length; i++) P[i] = Math.sin(i * 0.37) * 0.9 + 1e-30 * i;
    const out = renderAll(map, P, n);
    for (let i = 0; i < P.length; i++) expect(Object.is(out[i], P[i])).toBe(true);
    // the same from any start: output i always reads P[i]
    const late = new SourceTimeMap(o, 1234);
    expect(late.firstInput(1234)).toBe(1234);
    const part = new Float32Array(100 * 2);
    late.render(P, 0, part, 100);
    expect(Array.from(part)).toEqual(Array.from(P.subarray(1234 * 2, 1334 * 2)));
  });

  it('44.1 kHz to 48 kHz keeps a 1 kHz tone at 1000 ± 0.1 Hz', () => {
    const o = timeMapOrigin(spec({ sourceRate: 44100, planRate: 48000 }));
    expect(o.step).toEqual([147n, 160n]);
    const map = new SourceTimeMap(o, 0);
    expect(map.identity).toBe(false);
    const n = 48000 * 3;
    const [P, first] = sourceFor(map, n, (k) => 0.5 * Math.sin((2 * Math.PI * 1000 * k) / 44100));
    const out = new Float32Array(n * 2);
    map.render(P, first, out, n);
    // frequency from the first and last upward zero crossings between 0.5 s and 2.5 s (linear interpolation between samples)
    const ups: number[] = [];
    for (let i = 24000; i < 120000; i++) { const a = out[(i - 1) * 2]!, b = out[i * 2]!; if (a < 0 && b >= 0) ups.push(i - 1 + a / (a - b)); }
    const hz = ((ups.length - 1) / (ups.at(-1)! - ups[0]!)) * 48000;
    expect(Math.abs(hz - 1000)).toBeLessThan(0.1);
    // and the level is unchanged in the passband (within 0.05 dB)
    let peak = 0;
    for (let i = 24000; i < 120000; i++) peak = Math.max(peak, Math.abs(out[i * 2]!));
    expect(Math.abs(20 * Math.log10(peak / 0.5))).toBeLessThan(0.05);
  });

  it('images and aliases are at least 80 dB down for steps 0.5 to 2', () => {
    const cases: { name: string; s: Partial<TimeMapSpec>; tone: number }[] = [
      { name: 'step 0.5', s: { sourceRate: 24000 }, tone: 0.11 },
      { name: 'step 0.5, high tone', s: { sourceRate: 24000 }, tone: 0.31 },
      { name: '44.1 -> 48 kHz', s: { sourceRate: 44100 }, tone: 1000 / 44100 },
      { name: 'step 1, fractional start', s: { sourceIn: rt(1001, 30000) }, tone: 0.07 },
      { name: '48 -> 44.1 kHz', s: { planRate: 44100 }, tone: 0.04 },
      { name: 'speed 1.5', s: { speed: { num: 3, den: 2 } }, tone: 0.05 },
      { name: 'speed 2', s: { speed: { num: 2, den: 1 } }, tone: 0.09 },
    ];
    const results: Record<string, number> = {};
    for (const c of cases) {
      const o = timeMapOrigin(spec(c.s));
      const step = Number(o.step[0]) / Number(o.step[1]);
      const map = new SourceTimeMap(o, 0);
      const n = (1 << 15) + 8192;
      const [P, first] = sourceFor(map, n, (k) => 0.5 * Math.sin(2 * Math.PI * c.tone * k + 0.3));
      const out = new Float32Array(n * 2);
      map.render(P, first, out, n);
      results[c.name] = spuriousDb(out, c.tone * step);
    }
    for (const [name, db] of Object.entries(results)) expect(db, name).toBeLessThan(-80);
    // downsampling: a tone above the new Nyquist frequency is removed, not folded back
    for (const [num, den, tone] of [[2, 1, 0.4], [3, 2, 0.42]] as const) {
      const o = timeMapOrigin(spec({ speed: { num, den } }));
      const map = new SourceTimeMap(o, 0);
      const n = 1 << 15;
      const [P, first] = sourceFor(map, n, (k) => 0.5 * Math.sin(2 * Math.PI * tone * k));
      const out = new Float32Array(n * 2);
      map.render(P, first, out, n);
      let peak = 0;
      for (let i = 2000; i < n; i++) peak = Math.max(peak, Math.abs(out[i * 2]!));
      expect(20 * Math.log10(peak / 0.5 + 1e-12), `stopband tone at speed ${num}/${den}`).toBeLessThan(-80);
    }
  });

  it('the filter: 32·ceil(step) taps, cutoff 0.45·min(1, 1/step), 257 rows that each sum to 1', () => {
    for (const [step, taps, cutoff] of [[0.5, 32, 0.45], [1.25, 64, 0.36], [2, 64, 0.225], [3.5, 128, 0.45 / 3.5]] as const) {
      const t = sincTable(step);
      expect([t.taps, t.half]).toEqual([taps, taps / 2]);
      expect(t.cutoff).toBeCloseTo(cutoff, 12);
      expect(t.coef.length).toBe(257 * taps);
      for (let p = 0; p <= 256; p += 37) { let s = 0; for (let k = 0; k < taps; k++) s += t.coef[p * taps + k]!; expect(s).toBeCloseTo(1, 12); }
    }
  });

  it('positions are exact: stepping with integers reaches i = 10^9 exactly as the BigInt closed form, also with a huge denominator', () => {
    for (const s of [
      spec({ sourceIn: rt(1001, 30000), speed: { num: 1001, den: 1000 }, sourceRate: 44100 }),
      spec({ sourceIn: rt(123456789, 35_280_000), speed: { num: 7919, den: 7907 }, sourceRate: 44100, planRate: 48000 }),
    ]) {
      const o = timeMapOrigin(s);
      const target = 1_000_000_000, steps = 1_000_000;
      const c = new PhaseCursor(o.phase0, o.step, target - steps);
      for (let k = 0; k < steps; k++) c.next();
      expect(c.exact()).toEqual(positionAt(o.phase0, o.step, target));
      // and the cursor opened directly there agrees
      expect(new PhaseCursor(o.phase0, o.step, target).exact()).toEqual(positionAt(o.phase0, o.step, target));
    }
    // closed form by hand: u(i) = phase0 + i·step
    const o = timeMapOrigin(spec({ sourceIn: rt(1, 3), sourceRate: 44100, planRate: 48000 })); // S = 14700 exactly
    expect([o.origin, o.phase0]).toEqual([14700, [0n, 1n]]);
    const p = positionAt(o.phase0, o.step, 10n ** 9n);
    expect(p.ip * p.q + p.fr).toBe((10n ** 9n * 147n * p.q) / 160n);
  });

  it('forward output 0 reads native position S; reversed output 0 reads native position E − 1', () => {
    const native = (j: number) => (j >= 0 && j < 480000 ? j / 1e6 : 0);
    const nativePiece = (start: number, n: number) => { const d = new Float32Array(n * 2); for (let i = 0; i < n; i++) { d[i * 2] = native(start + i); d[i * 2 + 1] = -native(start + i); } return { start, data: d }; };
    const run = (s: TimeMapSpec, n: number) => {
      const o = timeMapOrigin(s);
      const map = new SourceTimeMap(o, 0);
      const first = map.firstInput(0), end = map.endInput(n - 1);
      const P = new Float32Array((end - first) * 2);
      // the decoder's pieces, in any order and size
      for (const [a, b] of [[0, 70000], [70000, 200000], [200000, 480000]] as const) fillPlayingOrder(P, first, { origin: o.origin, first, last: end, reverse: s.reverse }, nativePiece(a, b - a));
      const out = new Float32Array(n * 2);
      map.render(P, first, out, n);
      return { o, out };
    };
    // forward, sample aligned: identity, output i = native[S + i]
    const f = run(spec({ sourceIn: rt(1, 2) }), 100);
    expect(f.o.origin).toBe(24000);
    expect([f.out[0], f.out[1], f.out[99 * 2]]).toEqual([Math.fround(native(24000)), -Math.fround(native(24000)), Math.fround(native(24099))]);
    // reversed, sample aligned: E = 72000, output 0 = native[71999], output i = native[71999 − i]
    const r = run(spec({ sourceIn: rt(1, 2), sourceEnd: rt(3, 2), reverse: true }), 100);
    expect([r.o.origin, r.o.phase0]).toEqual([72000, [0n, 1n]]);
    expect([r.out[0], r.out[1], r.out[50 * 2]]).toEqual([Math.fround(native(71999)), -Math.fround(native(71999)), Math.fround(native(71949))]);
    // reversed, not sample aligned (E = 72000.5 at 48 kHz): output 0 reads 71999.5 (between the two samples on this straight line)
    const h = run(spec({ sourceIn: rt(0, 1), sourceEnd: rt(144001, 96000), reverse: true }), 100);
    expect([h.o.origin, h.o.phase0]).toEqual([72001, [1n, 2n]]);
    expect(h.out[0]).toBeCloseTo(71999.5 / 1e6, 6);
    expect(h.out[40 * 2]).toBeCloseTo(71959.5 / 1e6, 6);
  });
});
