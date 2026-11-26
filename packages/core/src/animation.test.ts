import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, EASINGS, effectParamsAt, findClip, NO_RANGE, OpError, paramRange, sampleKeyframes, TRANSFORM_RANGE, transformAt, V1_EASINGS, validateProject, type CurveHandles, type EffectInstance, type Keyframe, type OpCall, type ProjectDocument, type V1Easing } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `k${n++}_`, actor: 't' });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof OpError ? e.code : String(e); } return 'ok'; };
function withText() {
  const r = tx(createProject({ id: 'p', name: 'p' }), [{ op: 'add_text', args: { text: 'כותרת', start: f(30), duration: f(90) } }]);
  return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string };
}
const kf = (clipId: string, property: string, frame: number, value: number, easing?: string): OpCall => ({ op: 'set_keyframe', args: { clipId, property, time: f(frame), value, ...(easing ? { easing } : {}) } });

describe('keyframes', () => {
  it('interpolates exactly at keys, linearly between them, and holds outside the keyed range', () => {
    const { doc, clipId } = withText();
    const d = tx(doc, [kf(clipId, 'x', 0, -0.2), kf(clipId, 'x', 60, 0.4), kf(clipId, 'opacity', 30, 1, 'hold'), kf(clipId, 'opacity', 60, 0)]).doc;
    const clip = findClip(d, clipId)!.clip;
    const at = (frame: number) => transformAt(clip, f(30 + frame));
    expect(at(0).x).toBeCloseTo(-0.2, 12);
    expect(at(30).x).toBeCloseTo(0.1, 12);
    expect(at(60).x).toBeCloseTo(0.4, 12);
    expect(at(89).x).toBeCloseTo(0.4, 12); // after last key
    expect(at(10).opacity).toBe(1); // before first key: first value
    expect(at(59).opacity).toBe(1); // hold segment
    expect(at(60).opacity).toBe(0);
    expect(at(45).y).toBe(clip.transform.y); // un-keyed property stays static
    expect(validateProject(d)).toEqual([]);
  });
  it('easings start and end on the key values and are monotonic', () => {
    for (const easing of ['ease-in', 'ease-out', 'ease-in-out'] as const) {
      const keys = [{ time: f(0), value: 10, easing }, { time: f(100), value: 20, easing: 'linear' as const }];
      let prev = 10;
      for (let i = 0; i <= 100; i++) { const v = sampleKeyframes(keys, f(i), NO_RANGE); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
      expect(sampleKeyframes(keys, f(0), NO_RANGE)).toBe(10);
      expect(sampleKeyframes(keys, f(100), NO_RANGE)).toBe(20);
      expect(sampleKeyframes(keys, f(50), NO_RANGE)).toBeCloseTo(easing === 'ease-in' ? 11.25 : easing === 'ease-out' ? 18.75 : 15, 10);
    }
  });
  it('upsert replaces a key at the same time; delete freezes the last value; clear samples at the given time', () => {
    const { doc, clipId } = withText();
    let d = tx(doc, [kf(clipId, 'scale', 0, 1), kf(clipId, 'scale', 30, 2), kf(clipId, 'scale', 30, 3, 'ease-out')]).doc;
    expect(findClip(d, clipId)!.clip.keyframes!.scale).toEqual([{ time: f(0), value: 1, easing: 'linear' }, { time: f(30), value: 3, easing: 'ease-out' }]);
    d = tx(d, [{ op: 'delete_keyframe', args: { clipId, property: 'scale', time: f(0) } }, { op: 'delete_keyframe', args: { clipId, property: 'scale', time: f(30) } }]).doc;
    const c = findClip(d, clipId)!.clip;
    expect(c.keyframes).toBeUndefined();
    expect(c.transform.scale).toBe(3);
    d = tx(d, [kf(clipId, 'rotation', 0, 0), kf(clipId, 'rotation', 60, 90)]).doc;
    d = tx(d, [{ op: 'clear_keyframes', args: { clipId, at: f(20) } }]).doc;
    expect(findClip(d, clipId)!.clip.transform.rotation).toBeCloseTo(30, 10);
    expect(code(() => tx(d, [{ op: 'delete_keyframe', args: { clipId, property: 'x', time: f(1) } }]))).toBe('not_found');
    expect(code(() => tx(d, [kf(clipId, 'opacity', 0, 1.5)]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'set_keyframe', args: { clipId, property: 'x', time: T.rt(1, 7), value: 0 } }]))).toBe('invalid_args');
    expect(code(() => tx(d, [{ op: 'set_keyframe', args: { clipId, property: 'color', time: f(0), value: 0 } }]))).toBe('invalid_args');
  });
});

describe('animation survives trims and splits exactly (property, U8)', () => {
  const easing = fc.constantFrom(...EASINGS);
  const handles = fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -1, max: 2, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: -1, max: 2, noNaN: true }));
  it('for every frame that remains visible, the animated transform is Object.is-identical before and after (all 13 easings, random handles)', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 89 }), fc.integer({ min: -100, max: 100 }), easing, handles), { minLength: 1, maxLength: 6, selector: (k) => k[0] }), fc.integer({ min: 1, max: 88 }), fc.constantFrom('split', 'trim-start', 'trim-end'), fc.constantFrom('x', 'scale', 'rotation'), (keys, cut, action, property) => {
        const { doc, clipId } = withText();
        const value = (v: number) => (property === 'scale' ? 1 + v / 200 : property === 'rotation' ? v : v / 100);
        let d = tx(doc, keys.map(([fr, v, e, h]) => ({ op: 'set_keyframe', args: { clipId, property, time: f(fr), value: value(v), easing: e, ...(e === 'bezier' ? { bezier: h } : {}) } }))).doc;
        const before = (frame: number) => transformAt(findClip(d, clipId)!.clip, f(frame))[property];
        const expected = Array.from({ length: 90 }, (_, i) => before(30 + i));
        const r = action === 'split' ? tx(d, [{ op: 'split_clip', args: { clipId, at: f(30 + cut) } }]) : tx(d, [{ op: 'trim_clip', args: { clipId, edge: action === 'trim-start' ? 'start' : 'end', to: f(30 + cut) } }]);
        d = r.doc;
        if (validateProject(d).length) return false;
        const clips = d.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips;
        for (const c of clips)
          for (let fr = T.frameIndexAt(c.start, R); fr < T.frameIndexAt(T.add(c.start, c.duration), R); fr++)
            if (!Object.is(transformAt(c, f(fr))[property], expected[fr - 30]!)) return false;
        return true;
      }),
      { numRuns: 300 },
    );
  });
});

/** The sampler as it was before ADR-0019 (641b238 animation.ts), verbatim apart from its name and the key type. */
const OLD_EASE: Record<V1Easing, (u: number) => number> = {
  linear: (u) => u,
  hold: () => 0,
  'ease-in': (u) => u * u * u,
  'ease-out': (u) => 1 - (1 - u) ** 3,
  'ease-in-out': (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};
function oldSampleKeyframes(keys: (Keyframe & { easing: V1Easing })[], t: T.RationalTime): number {
  if (T.lte(t, keys[0]!.time)) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (T.lte(last.time, t)) return last.value;
  // binary search for the segment [a, b) containing t
  let lo = 0;
  let hi = keys.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T.lte(keys[mid]!.time, t)) lo = mid; else hi = mid; }
  const a = keys[lo]!;
  const b = keys[hi]!;
  // Exact rational position inside the segment, converted to a float only for the blend itself.
  const u = T.toSeconds(T.sub(t, a.time)) / T.toSeconds(T.sub(b.time, a.time));
  return a.value + (b.value - a.value) * OLD_EASE[a.easing](u);
}
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('the v1 easings are sampled exactly as before (oracle)', () => {
  it('1e5 random v1-only key lists at random rational times: every sample Object.is-equal to the old sampler, whatever the range', () => {
    const r = rng(41);
    const RATES = [{ num: 24000, den: 1001 }, { num: 25, den: 1 }, { num: 30000, den: 1001 }, { num: 30, den: 1 }, { num: 60, den: 1 }];
    const RANGES = [NO_RANGE, TRANSFORM_RANGE.x, TRANSFORM_RANGE.opacity, { min: -0.1, max: 0.1 }];
    let mismatches = 0;
    for (let i = 0; i < 1e5; i++) {
      const rate = RATES[Math.floor(r() * RATES.length)]!;
      const n = 1 + Math.floor(r() * 6);
      let fr = Math.floor(r() * 20) - 10;
      const keys = Array.from({ length: n }, () => { const k = { time: T.frameTime(fr, rate), value: (r() * 8 - 4) * (r() < 0.1 ? 1000 : 1), easing: V1_EASINGS[Math.floor(r() * 5)]! }; fr += 1 + Math.floor(r() * 30); return k; });
      const t = T.rt(Math.floor(r() * 40_000) - 12_000, [997, 1000, 30, 48000, 240][Math.floor(r() * 5)]!);
      const range = RANGES[Math.floor(r() * RANGES.length)]!;
      if (!Object.is(sampleKeyframes(keys, t, range), oldSampleKeyframes(keys, t))) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('U6: the new curves are clamped to the channel range; the v1 easings are not', () => {
  it('TRANSFORM_RANGE: overshoot on scale stops at 20, anticipate on opacity at 0, spring on rotation at 3600', () => {
    const over: Keyframe[] = [{ time: f(0), value: 10, easing: 'overshoot' }, { time: f(30), value: 20, easing: 'linear' }];
    let max = -Infinity;
    for (let i = 0; i <= 30; i++) max = Math.max(max, sampleKeyframes(over, f(i), TRANSFORM_RANGE.scale));
    expect(max).toBe(20);
    expect(sampleKeyframes(over, f(17), NO_RANGE)).toBeGreaterThan(20);
    const ant: Keyframe[] = [{ time: f(0), value: 0, easing: 'anticipate' }, { time: f(30), value: 1, easing: 'linear' }];
    for (let i = 0; i <= 30; i++) expect(sampleKeyframes(ant, f(i), TRANSFORM_RANGE.opacity)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...Array.from({ length: 31 }, (_, i) => sampleKeyframes(ant, f(i), NO_RANGE)))).toBeLessThan(0);
    const spr: Keyframe[] = [{ time: f(0), value: 0, easing: 'spring' }, { time: f(30), value: 3600, easing: 'linear' }];
    for (let i = 0; i <= 30; i++) expect(sampleKeyframes(spr, f(i), TRANSFORM_RANGE.rotation)).toBeLessThanOrEqual(3600);
    expect(TRANSFORM_RANGE).toEqual({ x: { min: -4, max: 4 }, y: { min: -4, max: 4 }, scale: { min: 0.01, max: 20 }, rotation: { min: -3600, max: 3600 }, opacity: { min: 0, max: 1 } });
  });
  it('paramRange: effectParamsAt clamps a bounce on blur.gaussian radius to its declared maximum', () => {
    const r = paramRange('blur.gaussian', 'radius')!;
    const fx: EffectInstance = { id: 'fx1', type: 'blur.gaussian', enabled: true, params: {}, keyframes: { radius: [{ time: f(0), value: r.max - (r.max - r.min) / 2, easing: 'spring' }, { time: f(30), value: r.max, easing: 'linear' }] } };
    let max = -Infinity;
    for (let i = 0; i <= 30; i++) max = Math.max(max, effectParamsAt(fx, f(i)).radius as number);
    expect(max).toBe(r.max);
  });
});

describe('sampler cost (printed)', () => {
  it('ns per sample in Node, per easing', () => {
    const N = 200_000;
    const keys = (e: (typeof EASINGS)[number], h?: CurveHandles): Keyframe[] => Array.from({ length: 12 }, (_, i) => ({ time: f(i * 10), value: (i % 3) * 0.3, easing: e, ...(h ? { bezier: h } : {}) }));
    const times = Array.from({ length: 1024 }, (_, i) => T.rt(i * 113, 1000));
    const out: string[] = [];
    let sink = 0;
    for (const e of EASINGS) {
      const ks = keys(e, e === 'bezier' ? [0.2, -0.3, 0.6, 1.4] : undefined);
      for (let i = 0; i < 2000; i++) sink += sampleKeyframes(ks, times[i & 1023]!, TRANSFORM_RANGE.x);
      const t0 = performance.now();
      for (let i = 0; i < N; i++) sink += sampleKeyframes(ks, times[i & 1023]!, TRANSFORM_RANGE.x);
      out.push(`${e} ${(((performance.now() - t0) * 1e6) / N).toFixed(0)}`);
    }
    console.log(`sampler ns/sample (Node, 12 keys, rational times, includes the rational search): ${out.join(', ')}`);
    expect(Number.isFinite(sink)).toBe(true);
  }, 120_000);
});
