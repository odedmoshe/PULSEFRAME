import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, findClip, NO_RANGE, OpError, sampleKeyframes, transformAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';

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

describe('animation survives trims and splits exactly (property)', () => {
  it('for every frame that remains visible, the animated transform is identical before and after', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 89 }), fc.integer({ min: -100, max: 100 }), fc.constantFrom('linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out')), { minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 88 }), fc.constantFrom('split', 'trim-start', 'trim-end'), (keys, cut, action) => {
        const { doc, clipId } = withText();
        let d = tx(doc, keys.map(([fr, v, e]) => kf(clipId, 'x', fr, v / 100, e))).doc;
        const before = (frame: number) => transformAt(findClip(d, clipId)!.clip, f(frame)).x;
        const expected = Array.from({ length: 90 }, (_, i) => before(30 + i));
        const r = action === 'split' ? tx(d, [{ op: 'split_clip', args: { clipId, at: f(30 + cut) } }]) : tx(d, [{ op: 'trim_clip', args: { clipId, edge: action === 'trim-start' ? 'start' : 'end', to: f(30 + cut) } }]);
        d = r.doc;
        if (validateProject(d).length) return false;
        const clips = d.sequences.seq_main!.tracks.find((t) => t.kind === 'text')!.clips;
        for (const c of clips)
          for (let fr = T.frameIndexAt(c.start, R); fr < T.frameIndexAt(T.add(c.start, c.duration), R); fr++)
            if (Math.abs(transformAt(c, f(fr)).x - expected[fr - 30]!) > 1e-12) return false;
        return true;
      }),
      { numRuns: 200 },
    );
  });
});
