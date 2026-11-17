import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MOTION_PRESETS, motionKeys, previousMotion, type MotionContext, type MotionKey, type MotionPreset, type MotionProperty } from './motionPresets.ts';
import { applyTransaction, createProject, findClip, validateProject, type OpCall, type ProjectDocument } from './index.ts';
import * as T from '@pulseframe/time';
import { sampleKeyframes } from './animation.ts';

type Rest = MotionContext['rest'];
const RANGE: Record<MotionProperty, [number, number]> = { x: [-4, 4], y: [-4, 4], scale: [0.01, 20], rotation: [-3600, 3600], opacity: [0, 1] };
const PROPS = Object.keys(RANGE) as MotionProperty[];
const EASINGS = ['linear', 'hold', 'ease-in', 'ease-out', 'ease-in-out'];

function checkRules(p: MotionPreset, ctx: MotionContext): void {
  const out = motionKeys(p.id, ctx);
  const total = ctx.totalFrames;
  const n = Math.max(1, Math.min(total, ctx.frames ?? p.defaultFrames));
  const names = Object.keys(out) as MotionProperty[];
  expect(names.length).toBeGreaterThan(0);
  for (const prop of names) {
    expect(p.properties).toContain(prop);
    const keys = out[prop] as MotionKey[];
    expect(keys.length).toBeGreaterThanOrEqual(2);
    keys.forEach((k, i) => {
      expect(Number.isInteger(k.frame)).toBe(true);
      expect(k.frame).toBeGreaterThanOrEqual(0);
      expect(k.frame).toBeLessThanOrEqual(total);
      expect(Number.isFinite(k.value)).toBe(true);
      expect(k.value).toBeGreaterThanOrEqual(RANGE[prop][0]);
      expect(k.value).toBeLessThanOrEqual(RANGE[prop][1]);
      expect(EASINGS).toContain(k.easing);
      if (i > 0) expect(k.frame).toBeGreaterThan(keys[i - 1]!.frame);
    });
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    if (p.kind === 'in') {
      expect(first.frame).toBe(0);
      expect(last.frame).toBe(n);
      expect(last.value + 0).toBe(ctx.rest[prop] + 0);
    } else if (p.kind === 'out') {
      expect(first.frame).toBe(total - n);
      expect(first.value + 0).toBe(ctx.rest[prop] + 0);
      expect(last.frame).toBe(total);
    } else {
      expect(first.frame).toBe(0);
      expect(last.frame).toBe(total);
      if (p.kind === 'loop') expect(first.value + 0).toBe(ctx.rest[prop] + 0);
    }
  }
  for (const prop of p.properties) expect(out[prop]).toBeDefined();
}

const RESTS: Rest[] = [
  { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
  { x: 3.9, y: -3.9, scale: 0.02, rotation: 3500, opacity: 0 },
  { x: -3.9, y: 3.9, scale: 19, rotation: -3500, opacity: 1 },
  { x: 0.25, y: -0.1, scale: 1.3, rotation: 12.5, opacity: 0.5 },
];

describe('motion preset catalogue', () => {
  it('has unique kebab-case ids and non-empty names', () => {
    expect(MOTION_PRESETS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MOTION_PRESETS.map((p) => p.id)).size).toBe(MOTION_PRESETS.length);
    for (const p of MOTION_PRESETS) {
      expect(p.id).toMatch(/^motion\.(in|out|loop|move)\.[a-z]+(-[a-z]+)*$/);
      expect(p.id.split('.')[1]).toBe(p.kind);
      expect(p.name.he.trim().length).toBeGreaterThan(0);
      expect(p.name.en.trim().length).toBeGreaterThan(0);
      expect(p.name.he).toMatch(/[֐-׿]/);
      expect(p.properties.length).toBeGreaterThan(0);
      if (p.kind === 'move') expect(p.defaultFrames).toBe(0);
      else expect(p.defaultFrames).toBeGreaterThan(0);
    }
  });
  it('has enough presets per kind', () => {
    const count = (k: string) => MOTION_PRESETS.filter((p) => p.kind === k).length;
    expect(count('in')).toBeGreaterThanOrEqual(14);
    expect(count('out')).toBeGreaterThanOrEqual(12);
    expect(count('loop')).toBeGreaterThanOrEqual(8);
    expect(count('move')).toBeGreaterThanOrEqual(6);
  });
  it('throws for an unknown id', () => {
    expect(() => motionKeys('motion.in.nope', { totalFrames: 30, rest: RESTS[0]! })).toThrow('unknown motion preset: motion.in.nope');
  });
});

describe('motionKeys rules', () => {
  it('holds for every preset, length, rest and amount', () => {
    for (const p of MOTION_PRESETS)
      for (const totalFrames of [2, 3, 7, 12, 30, 90, 300, 1800])
        for (const rest of RESTS)
          for (const amount of [0, 0.5, 1, 2]) checkRules(p, { totalFrames, rest, amount });
  }, 60_000); // about 5 s alone; the suite runs many files at once
  it('holds with explicit frames, including tiny and oversize values', () => {
    for (const p of MOTION_PRESETS)
      for (const frames of [1, 2, 5, 40, 5000]) checkRules(p, { totalFrames: 37, frames, rest: RESTS[3]! });
  });
  it('holds for random contexts (property test)', () => {
    const rest = fc.record({
      x: fc.double({ min: -3.9, max: 3.9, noNaN: true }),
      y: fc.double({ min: -3.9, max: 3.9, noNaN: true }),
      scale: fc.double({ min: 0.01, max: 20, noNaN: true }),
      rotation: fc.double({ min: -3600, max: 3600, noNaN: true }),
      opacity: fc.double({ min: 0, max: 1, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.constantFrom(...MOTION_PRESETS),
        fc.integer({ min: 2, max: 2000 }),
        fc.option(fc.integer({ min: 1, max: 400 }), { nil: undefined }),
        rest,
        fc.option(fc.double({ min: 0, max: 2, noNaN: true }), { nil: undefined }),
        (p, totalFrames, frames, r, amount) => {
          checkRules(p, { totalFrames, frames, rest: r, amount });
        },
      ),
      { numRuns: 300 },
    );
  });
  it('is deterministic', () => {
    for (const p of MOTION_PRESETS) {
      const ctx: MotionContext = { totalFrames: 120, rest: RESTS[3]!, amount: 1.3 };
      expect(motionKeys(p.id, ctx)).toEqual(motionKeys(p.id, ctx));
    }
  });
});

describe('loop.spin keeps turning', () => {
  const rate = { num: 30, den: 1 };
  /** The rotation the keyframe sampler plays at a whole frame. */
  const play = (keys: MotionKey[], frame: number) => sampleKeyframes(keys.map((k) => ({ time: T.frameTime(k.frame, rate), value: k.value, easing: k.easing })), T.frameTime(frame, rate));
  /** Distance between two angles, in degrees, whole turns apart counting as the same angle. */
  const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

  it('past ten turns, from any resting angle, the sampled rotation is the right angle at every frame and no key leaves the range', () => {
    for (const [rest, totalFrames, frames, amount] of [
      [0, 1800, 90, 1],      // 20 turns: the old keys stopped at 3600 degrees after 900 frames
      [0, 5400, 90, 1],      // 60 turns
      [3500, 600, 90, 1],    // starts 100 degrees below the top of the range: leaves it inside the first turn
      [3600, 300, 90, 1],    // starts at the top of the range
      [-3500, 4000, 30, 1],
      [12.5, 2000, 7, 2],    // two turns per period
      [0, 700, 1, 1],        // a turn per frame
      [45, 1000, 90, 0.5],
    ] as const) {
      const keys = motionKeys('motion.loop.spin', { totalFrames, frames, amount, rest: { x: 0, y: 0, scale: 1, rotation: rest, opacity: 1 } }).rotation!;
      const label = `rest ${rest}, ${totalFrames} frames, period ${frames}, amount ${amount}`;
      expect(keys[0]).toMatchObject({ frame: 0, value: rest });
      expect(keys[keys.length - 1]!.frame, label).toBe(totalFrames);
      keys.forEach((k, i) => {
        expect(k.value, label).toBeGreaterThanOrEqual(-3600);
        expect(k.value, label).toBeLessThanOrEqual(3600);
        if (i > 0) expect(k.frame, label).toBeGreaterThan(keys[i - 1]!.frame);
      });
      const step = (360 * amount) / frames;
      for (let g = 0; g <= totalFrames; g++) {
        const got = play(keys, g);
        if (apart(got, rest + step * g) > 1e-6) throw new Error(`${label}: frame ${g} plays ${got}, expected an angle equal to ${rest + step * g}`);
      }
      // a few keys only: one per period plus two per restart
      expect(keys.length, label).toBeLessThanOrEqual(Math.ceil(totalFrames / frames) + 2 + 2 * Math.ceil((step * totalFrames) / 3240));
    }
  });

  it('a spin that stays inside the range is written as before: one key per period, no holds', () => {
    const keys = motionKeys('motion.loop.spin', { totalFrames: 300, rest: { x: 0, y: 0, scale: 1, rotation: 10, opacity: 1 } }).rotation!;
    expect(keys).toEqual([0, 90, 180, 270, 300].map((frame) => ({ frame, value: 10 + frame * 4, easing: 'linear' })));
  });
});

describe('apply_motion_preset: a new entrance replaces the previous entrance, a new exit the previous exit', () => {
  const rate = { num: 30, den: 1 };
  const f = (n: number) => T.frameTime(n, rate);
  let seq = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `m${seq++}_`, actor: 'test' });
  function title(frames = 120, transform: Record<string, number> = {}) {
    const r = tx(createProject({ id: 'prj_m', name: 'M' }), [{ op: 'add_text', args: { text: 'title', start: f(0), duration: f(frames), transform } }]);
    return { doc: r.doc, clipId: r.results[0]!.output!.clipId as string };
  }
  const motion = (doc: ProjectDocument, clipId: string, presetId: string, extra: Record<string, number> = {}) => tx(doc, [{ op: 'apply_motion_preset', args: { clipId, presetId, ...extra } }]).doc;
  /** The clip's keys as [frame, value, easing] per property. */
  const keysOf = (doc: ProjectDocument, clipId: string) => {
    const out: Record<string, [number, number, string][]> = {};
    for (const [p, keys] of Object.entries(findClip(doc, clipId)!.clip.keyframes ?? {})) out[p] = keys.map((k) => [T.frameIndexAt(k.time, rate), k.value, k.easing]);
    return out;
  };
  const ins = MOTION_PRESETS.filter((p) => p.kind === 'in'), outs = MOTION_PRESETS.filter((p) => p.kind === 'out');

  it('a different entrance leaves nothing of the first one, on any property', () => {
    const { doc, clipId } = title();
    // spin (rotation, scale, opacity; 24 frames) then fade (opacity; 15 frames): only the fade is left
    const d = motion(motion(doc, clipId, 'motion.in.spin'), clipId, 'motion.in.fade');
    expect(keysOf(d, clipId)).toEqual({ opacity: [[0, 0, 'linear'], [15, 1, 'linear']] });
    // elastic (30 frames) then pop (18 frames): no key of the elastic after frame 18
    const e = motion(motion(doc, clipId, 'motion.in.elastic'), clipId, 'motion.in.pop');
    expect(keysOf(e, clipId)).toEqual(keysOf(motion(doc, clipId, 'motion.in.pop'), clipId));
    expect(validateProject(e)).toEqual([]);
  });

  it('every pair of entrances and every pair of exits: the second alone is what is left, whatever else is on the clip', () => {
    for (const transform of [{}, { x: 0.25, y: -0.1, scale: 1.3, rotation: 12.5, opacity: 0.5 }] as Record<string, number>[]) {
      const { doc, clipId } = title(120, transform);
      const exit = motion(doc, clipId, 'motion.out.spin'), entrance = motion(doc, clipId, 'motion.in.spin');
      for (const [set, other] of [[ins, exit], [outs, entrance]] as const) {
        for (const b of set) {
          const alone = keysOf(motion(doc, clipId, b.id), clipId), withOther = keysOf(motion(other, clipId, b.id), clipId);
          for (const a of set) {
            for (const extra of [{}, { frames: 40 }, { amount: 0.5 }] as Record<string, number>[]) {
              expect(keysOf(motion(motion(doc, clipId, a.id, extra), clipId, b.id), clipId), `${a.id} then ${b.id}`).toEqual(alone);
              // with an exit (or an entrance) on the clip as well: it stays, and the first motion still goes
              expect(keysOf(motion(motion(other, clipId, a.id, extra), clipId, b.id), clipId), `${a.id} then ${b.id}, next to the other end`).toEqual(withOther);
            }
          }
        }
      }
    }
  }, 120_000);

  it('an entrance and an exit still combine, and each can be changed without touching the other', () => {
    const { doc, clipId } = title();
    const both = motion(motion(doc, clipId, 'motion.in.zoom-in'), clipId, 'motion.out.fade');
    expect(keysOf(both, clipId)).toEqual({
      scale: [[0, 0.6, 'ease-out'], [18, 1, 'linear']],
      opacity: [[0, 0, 'linear'], [7, 1, 'linear'], [18, 1, 'linear'], [105, 1, 'linear'], [120, 0, 'linear']],
    });
    const newExit = keysOf(motion(both, clipId, 'motion.out.slide-left'), clipId);
    expect(newExit.scale).toEqual([[0, 0.6, 'ease-out'], [18, 1, 'linear']]);
    expect(newExit.opacity!.slice(0, 3)).toEqual([[0, 0, 'linear'], [7, 1, 'linear'], [18, 1, 'linear']]);
    expect(newExit.x!.map((k) => k[0])).toEqual([102, 120]);
    const newEntrance = keysOf(motion(both, clipId, 'motion.in.fade'), clipId);
    expect(newEntrance).toEqual({ opacity: [[0, 0, 'linear'], [15, 1, 'linear'], [105, 1, 'linear'], [120, 0, 'linear']] });
    // an entrance fade of 12 frames and an exit that starts at frame 30 look, on opacity alone, like the three keys of a zoom's fade; the exit must survive
    const short = title(45);
    const mixed = motion(motion(short.doc, short.clipId, 'motion.in.fade', { frames: 12 }), short.clipId, 'motion.out.fade');
    expect(keysOf(mixed, short.clipId).opacity).toEqual([[0, 0, 'linear'], [12, 1, 'linear'], [30, 1, 'linear'], [45, 0, 'linear']]);
    expect(keysOf(motion(mixed, short.clipId, 'motion.in.rise'), short.clipId).opacity).toEqual([[0, 0, 'linear'], [18, 1, 'linear'], [30, 1, 'linear'], [45, 0, 'linear']]);
  });

  it('an exit made before the clip got longer is replaced, not left behind in the middle', () => {
    const { doc, clipId } = title(100);
    const withExit = motion(doc, clipId, 'motion.out.spin'); // keys at 76..100
    const longer = tx(withExit, [{ op: 'trim_clip', args: { clipId, edge: 'end', to: f(160) } }]).doc;
    const again = keysOf(motion(longer, clipId, 'motion.out.fade'), clipId);
    expect(again).toEqual({ opacity: [[145, 1, 'linear'], [160, 0, 'linear']] });
  });

  it('loops, whole-clip moves and hand-made keys are not mistaken for an entrance or an exit', () => {
    const { doc, clipId } = title(300);
    for (const p of MOTION_PRESETS.filter((x) => x.kind === 'loop' || x.kind === 'move')) {
      const base = motion(doc, clipId, p.id);
      const before = keysOf(base, clipId);
      for (const edge of ['motion.in.fade', 'motion.out.fade', 'motion.in.spin', 'motion.out.spin', 'motion.in.bounce-drop', 'motion.out.shrink-pop', 'motion.in.whip-left', 'motion.out.whip-left']) {
        const after = keysOf(motion(base, clipId, edge), clipId);
        const used = MOTION_PRESETS.find((x) => x.id === edge)!.properties as readonly string[];
        for (const prop of Object.keys(before)) if (!used.includes(prop)) expect(after[prop], `${p.id} then ${edge}: ${prop}`).toEqual(before[prop]);
      }
    }
    // hand-made keys on a property the new entrance does not use stay exactly as they were
    const hand = tx(doc, [
      { op: 'set_keyframe', args: { clipId, property: 'rotation', time: f(0), value: -20 } }, { op: 'set_keyframe', args: { clipId, property: 'rotation', time: f(24), value: 0 } },
      { op: 'set_keyframe', args: { clipId, property: 'x', time: f(10), value: 0.2, easing: 'ease-in-out' } }, { op: 'set_keyframe', args: { clipId, property: 'x', time: f(40), value: 0 } },
    ]).doc;
    const kept = keysOf(motion(motion(hand, clipId, 'motion.in.fade'), clipId, 'motion.out.fade'), clipId);
    expect(kept.rotation).toEqual(keysOf(hand, clipId).rotation);
    expect(kept.x).toEqual(keysOf(hand, clipId).x);
  });

  it('previousMotion recognises its own kind whole and nothing else: an entrance is never read as an exit, nor a move or a loop as either (but for the tail of an opacity loop)', () => {
    const placed = (keys: Partial<Record<MotionProperty, MotionKey[]>>) => keys;
    for (const p of MOTION_PRESETS)
      for (const totalFrames of [2, 3, 5, 12, 30, 45, 90, 240])
        for (const frames of [undefined, 1, 2, 3, 7, 40])
          for (const [rest, amount] of [[RESTS[0]!, 1], [RESTS[3]!, 0.5], [RESTS[3]!, 2]] as const) {
            const keys = placed(motionKeys(p.id, { totalFrames, rest, amount, ...(frames ? { frames } : {}) }));
            const label = `${p.id}, ${totalFrames} frames, length ${frames ?? 'default'}, amount ${amount}`;
            if (p.kind !== 'in') expect(previousMotion('in', keys), label).toEqual({});
            // the one known look-alike: the unfinished last cycle of an opacity loop ends in two linear keys going down, like a fade out
            if (p.kind !== 'out' && !(p.kind === 'loop' && p.properties.includes('opacity'))) expect(previousMotion('out', keys), label).toEqual({});
            if (p.kind === 'in' || p.kind === 'out') expect(previousMotion(p.kind, keys), label).toEqual(Object.fromEntries(Object.entries(keys).map(([prop, k]) => [prop, k.length])));
          }
  });
});
