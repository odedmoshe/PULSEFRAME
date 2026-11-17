import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { ANIMATE_CLIP_MOTIONS, animateClipKeys, MOTION_PRESETS, motionKeys, previousMotion, type AnimateClipMotion, type MotionContext, type MotionKey, type MotionPreset, type MotionProperty } from './motionPresets.ts';
import { applyTransaction, createProject, diffEntities, findClip, restoreEntities, transformAt, validateProject, type OpCall, type ProjectDocument } from './index.ts';
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

  it('every pair of entrances and every pair of exits: the second alone is what is left, also with a motion at the other end of the clip', () => {
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
            if (p.kind !== 'in') expect(previousMotion('in', keys, totalFrames, rest), label).toEqual({});
            // the one known look-alike: the unfinished last cycle of an opacity loop ends in two linear keys going down, like a fade out
            if (p.kind !== 'out' && !(p.kind === 'loop' && p.properties.includes('opacity'))) expect(previousMotion('out', keys, totalFrames, rest), label).toEqual({});
            if (p.kind === 'in' || p.kind === 'out') expect(previousMotion(p.kind, keys, totalFrames, rest), label).toEqual(Object.fromEntries(Object.entries(keys).map(([prop, k]) => [prop, k.length])));
          }
  });

  // ---- what a replaced entrance or exit must leave alone ----
  /** The clip's transform at a whole clip-local frame, as the evaluator samples it. */
  const at = (doc: ProjectDocument, clipId: string, frame: number) => transformAt(findClip(doc, clipId)!.clip, f(frame));
  const key = (doc: ProjectDocument, clipId: string, property: string, frame: number, value: number, easing?: string) => tx(doc, [{ op: 'set_keyframe', args: { clipId, property, time: f(frame), value, ...(easing ? { easing } : {}) } }]).doc;
  const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

  it('replacing an entrance keeps the key that later animation on the same property starts from (slow zoom, hand-made move)', () => {
    // a slow zoom over the whole clip, an entrance over its first frames, then a different entrance: the zoom goes on after the entrance
    const a = title(240);
    const zoomed = motion(motion(a.doc, a.clipId, 'motion.move.ken-burns-in'), a.clipId, 'motion.in.zoom-in');
    const faded = motion(zoomed, a.clipId, 'motion.in.fade');
    expect(keysOf(faded, a.clipId).scale).toEqual([[18, 1, 'linear'], [240, 1.18, 'linear']]);
    for (let g = 18; g <= 240; g++) expect(at(faded, a.clipId, g).scale, `frame ${g}`).toBe(at(zoomed, a.clipId, g).scale);
    for (let g = 0; g < 18; g++) expect(at(faded, a.clipId, g).scale, `frame ${g}`).toBe(1); // the old entrance is gone: the title rests until the zoom goes on
    expect(keysOf(faded, a.clipId).opacity).toEqual([[0, 0, 'linear'], [15, 1, 'linear']]);
    // a hand-made grow after the entrance
    const b = title(150);
    const grown = key(motion(b.doc, b.clipId, 'motion.in.zoom-in'), b.clipId, 'scale', 100, 1.5);
    const after = motion(grown, b.clipId, 'motion.in.fade');
    expect(keysOf(after, b.clipId).scale).toEqual([[18, 1, 'linear'], [100, 1.5, 'linear']]);
    for (const g of [18, 20, 60, 100, 149]) expect(at(after, b.clipId, g).scale, `frame ${g}`).toBe(at(grown, b.clipId, g).scale);
    // the same for an exit: a hand-made shrink that ends where the exit starts
    const c = title(150);
    const shrunk = key(key(motion(c.doc, c.clipId, 'motion.out.zoom-out'), c.clipId, 'scale', 40, 1.4), c.clipId, 'scale', 0, 1.4);
    const out = motion(shrunk, c.clipId, 'motion.out.fade');
    expect(keysOf(out, c.clipId).scale).toEqual([[0, 1.4, 'linear'], [40, 1.4, 'linear'], [132, 1, 'linear']]); // the key the shrink ends on stays; the exit's easing on it went with the exit
    for (const g of [0, 40, 90, 132]) expect(at(out, c.clipId, g).scale, `frame ${g}`).toBe(at(shrunk, c.clipId, g).scale);
    for (const g of [133, 140, 150]) expect(at(out, c.clipId, g).scale, `frame ${g}`).toBe(1);
  });

  it('an entrance and an exit that meet: replacing either leaves the other playing, not the title frozen where the replaced one ended', () => {
    const { doc, clipId } = title(48);
    // exit first, then the entrance (they meet at frame 24), then another entrance
    const a = motion(motion(doc, clipId, 'motion.out.spin'), clipId, 'motion.in.spin');
    const a2 = motion(a, clipId, 'motion.in.fade');
    expect(at(a2, clipId, 24)).toMatchObject({ rotation: 0, scale: 1 });
    for (let g = 24; g <= 48; g++) for (const p of PROPS) expect(at(a2, clipId, g)[p], `${p} at ${g}`).toBe(at(a, clipId, g)[p]);
    for (let g = 0; g < 24; g++) expect(at(a2, clipId, g), `frame ${g}`).toMatchObject({ rotation: 0, scale: 1 });
    // entrance first, then the exit, then another exit
    const b = motion(motion(doc, clipId, 'motion.in.spin'), clipId, 'motion.out.spin');
    const b2 = motion(b, clipId, 'motion.out.fade');
    expect(keysOf(b2, clipId).rotation).toEqual(keysOf(motion(doc, clipId, 'motion.in.spin'), clipId).rotation); // the entrance is as it was made, easing of its last key included
    for (let g = 0; g <= 24; g++) for (const p of PROPS) expect(at(b2, clipId, g)[p], `${p} at ${g}`).toBe(at(b, clipId, g)[p]);
    for (let g = 25; g <= 48; g++) expect(at(b2, clipId, g), `frame ${g}`).toMatchObject({ rotation: 0, scale: 1 });
    // and the other two orders
    const a3 = motion(a, clipId, 'motion.out.fade');
    for (let g = 0; g <= 24; g++) for (const p of PROPS) expect(at(a3, clipId, g)[p], `${p} at ${g}`).toBe(at(a, clipId, g)[p]);
    for (let g = 25; g <= 48; g++) expect(at(a3, clipId, g), `frame ${g}`).toMatchObject({ rotation: 0, scale: 1 });
    const b3 = motion(b, clipId, 'motion.in.fade');
    for (let g = 24; g <= 48; g++) for (const p of PROPS) expect(at(b3, clipId, g)[p], `${p} at ${g}`).toBe(at(b, clipId, g)[p]);
    for (let g = 0; g < 24; g++) expect(at(b3, clipId, g), `frame ${g}`).toMatchObject({ rotation: 0, scale: 1 });
  });

  it('on a short title, where the exit touches or overlaps the entrance, a different entrance still leaves nothing of the first one', () => {
    // 36 frames: zoom in (18) and zoom out (18) meet in the middle
    const a = title(36);
    const both = motion(motion(a.doc, a.clipId, 'motion.in.zoom-in'), a.clipId, 'motion.out.zoom-out');
    expect(keysOf(motion(both, a.clipId, 'motion.in.fade'), a.clipId)).toEqual({
      scale: [[18, 1, 'ease-in'], [36, 0.6, 'linear']],
      opacity: [[0, 0, 'linear'], [15, 1, 'linear'], [18, 1, 'linear'], [29, 1, 'linear'], [36, 0, 'linear']],
    });
    // 24 frames: a spin as long as the title, and a fade out that overwrote the end of its opacity
    const b = title(24);
    const spun = motion(motion(b.doc, b.clipId, 'motion.in.spin'), b.clipId, 'motion.out.fade');
    expect(keysOf(motion(spun, b.clipId, 'motion.in.fade'), b.clipId)).toEqual({ opacity: [[0, 0, 'linear'], [15, 1, 'linear'], [24, 0, 'linear']] });
    // 30 frames: zoom in and zoom out overlap on both of their properties
    const c = title(30);
    const over = motion(motion(c.doc, c.clipId, 'motion.in.zoom-in'), c.clipId, 'motion.out.zoom-out');
    expect(keysOf(over, c.clipId).scale).toEqual([[0, 0.6, 'ease-out'], [12, 1, 'ease-in'], [30, 0.6, 'linear']]); // the precondition: the exit took over from frame 12
    const swapped = keysOf(motion(over, c.clipId, 'motion.in.fade', { frames: 10 }), c.clipId);
    expect(swapped.scale).toEqual([[12, 1, 'ease-in'], [30, 0.6, 'linear']]);
    expect(swapped.opacity).toEqual([[0, 0, 'linear'], [10, 1, 'linear'], [12, 1, 'linear'], [23, 1, 'linear'], [30, 0, 'linear']]);
    // 15 frames: the fade out is as long as the title and replaced the spin's opacity altogether
    const e = title(15);
    const whole = motion(motion(e.doc, e.clipId, 'motion.in.spin'), e.clipId, 'motion.out.fade');
    expect(Object.keys(keysOf(motion(whole, e.clipId, 'motion.in.slide-left', { frames: 5 }), e.clipId)).sort()).toEqual(['opacity', 'x']);
    // ... also when the first entrance used one property besides opacity
    const zoom = motion(motion(e.doc, e.clipId, 'motion.in.zoom-in'), e.clipId, 'motion.out.fade');
    expect(keysOf(zoom, e.clipId)).toEqual({ scale: [[0, 0.6, 'ease-out'], [15, 1, 'linear']], opacity: [[0, 1, 'linear'], [15, 0, 'linear']] }); // the precondition
    expect(Object.keys(keysOf(motion(zoom, e.clipId, 'motion.in.slide-left', { frames: 5 }), e.clipId)).sort()).toEqual(['opacity', 'x']);
    // ... but a loop under such an entrance is not taken for part of it, not even when the end of the clip cuts it down to
    // two keys that look like a slide or a zoom: a loop starts from the resting value, an entrance arrives at it
    for (const loop of ['motion.loop.heartbeat', 'motion.loop.pendulum', 'motion.loop.bounce']) {
      for (const frames of [8, 15]) {
        const t = title(frames);
        const under = motion(motion(motion(t.doc, t.clipId, loop), t.clipId, 'motion.in.fade'), t.clipId, 'motion.out.fade');
        const after = keysOf(motion(under, t.clipId, 'motion.in.fade', { frames: 5 }), t.clipId);
        for (const p of ['x', 'y', 'scale', 'rotation']) expect(after[p], `${loop} on ${frames} frames: ${p}`).toEqual(keysOf(under, t.clipId)[p]);
      }
    }
    // and the mirror: an entrance applied after the exit, overlapping it, then a different exit
    const m = title(30);
    const late = motion(motion(m.doc, m.clipId, 'motion.out.spin'), m.clipId, 'motion.in.zoom-in');
    const mirrored = keysOf(motion(late, m.clipId, 'motion.out.fade', { frames: 10 }), m.clipId);
    expect(mirrored.rotation).toBeUndefined();
    expect(mirrored.scale).toEqual([[0, 0.6, 'ease-out'], [18, 1, 'linear']]);
  });

  it('hand-made opacity keys in the middle of the clip are not an entrance or an exit', () => {
    const { doc, clipId } = title(300);
    // a dim from frame 100 to 130, then an exit 150 frames later
    const dim = key(key(doc, clipId, 'opacity', 100, 1), clipId, 'opacity', 130, 0.3);
    const withExit = motion(dim, clipId, 'motion.out.slide-left');
    expect(keysOf(withExit, clipId).opacity).toEqual([[100, 1, 'linear'], [130, 0.3, 'linear'], [282, 1, 'linear'], [293, 1, 'linear'], [300, 0, 'linear']]);
    for (const g of [0, 100, 115, 130]) expect(at(withExit, clipId, g).opacity, `frame ${g}`).toBe(at(dim, clipId, g).opacity);
    // a brighten from frame 100 to 130, then an entrance
    const brighten = key(key(doc, clipId, 'opacity', 100, 0.3), clipId, 'opacity', 130, 1);
    const withEntrance = motion(brighten, clipId, 'motion.in.slide-left');
    expect(keysOf(withEntrance, clipId).opacity).toEqual([[0, 0, 'linear'], [7, 1, 'linear'], [18, 1, 'linear'], [100, 0.3, 'linear'], [130, 1, 'linear']]);
    // the same keys with other motions around them, and replaced twice
    const twice = motion(motion(motion(dim, clipId, 'motion.in.fade'), clipId, 'motion.out.fade'), clipId, 'motion.out.zoom-out');
    expect(keysOf(twice, clipId).opacity!.filter((k) => k[0] === 100 || k[0] === 130)).toEqual([[100, 1, 'linear'], [130, 0.3, 'linear']]);
    // a hand-made fade from the very first frame IS an entrance (it cannot be told from one), and is replaced
    const handIn = key(key(doc, clipId, 'opacity', 0, 0.2), clipId, 'opacity', 20, 1);
    expect(keysOf(motion(handIn, clipId, 'motion.in.slide-left'), clipId).opacity).toEqual([[0, 0, 'linear'], [7, 1, 'linear'], [18, 1, 'linear']]);
  });

  it('an entrance or exit made by animate_clip is replaced as well', () => {
    const { doc, clipId } = title(120);
    for (const name of ['fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right']) {
      for (const frames of [undefined, 30]) {
        const entered = tx(doc, [{ op: 'animate_clip', args: { clipId, in: name, ...(frames ? { inFrames: frames } : {}) } }]).doc;
        expect(keysOf(motion(entered, clipId, 'motion.in.fade'), clipId), `in: ${name}`).toEqual({ opacity: [[0, 0, 'linear'], [15, 1, 'linear']] });
        // (an exit of animate_clip also leaves a resting key on the first frame; it moves nothing, so compare what is played)
        const left = motion(tx(doc, [{ op: 'animate_clip', args: { clipId, out: name, ...(frames ? { outFrames: frames } : {}) } }]).doc, clipId, 'motion.out.fade');
        const fadeOnly = motion(doc, clipId, 'motion.out.fade');
        for (let g = 0; g <= 120; g++) expect(at(left, clipId, g), `out: ${name}, frame ${g}`).toEqual(at(fadeOnly, clipId, g));
        // both at once: each is replaced on its own and the other stays
        const both = tx(doc, [{ op: 'animate_clip', args: { clipId, in: name, out: name } }]).doc;
        const newIn = motion(both, clipId, 'motion.in.fade'), newOut = motion(both, clipId, 'motion.out.fade');
        for (let g = 15; g <= 120; g++) for (const p of PROPS) expect(at(newIn, clipId, g)[p], `${name}: ${p} at ${g}`).toBe(at(both, clipId, g)[p]);
        for (let g = 0; g <= 105; g++) for (const p of PROPS) expect(at(newOut, clipId, g)[p], `${name}: ${p} at ${g}`).toBe(at(both, clipId, g)[p]);
        for (const p of ['x', 'y', 'scale'] as const) {
          for (let g = 0; g <= 15; g++) expect(at(newIn, clipId, g)[p], `${name}: ${p} at ${g}`).toBe(at(doc, clipId, g)[p]);
          for (let g = 105; g <= 120; g++) expect(at(newOut, clipId, g)[p], `${name}: ${p} at ${g}`).toBe(at(doc, clipId, g)[p]);
        }
      }
    }
    // entrance and exit of animate_clip that meet in the middle of a short title
    const short = title(24);
    const met = tx(short.doc, [{ op: 'animate_clip', args: { clipId: short.clipId, in: 'slide-left', out: 'pop' } }]).doc;
    const changed = keysOf(motion(met, short.clipId, 'motion.in.fade', { frames: 6 }), short.clipId);
    expect(changed.x).toBeUndefined();
    expect(changed.scale).toEqual([[12, 1, 'ease-in'], [24, 0.6, 'linear']]);
  });

  it('whatever else is on the clip (a move or loop made before, an exit before or after, hand keys later on): a replaced entrance or exit changes nothing outside its own frames', () => {
    const ins = MOTION_PRESETS.filter((p) => p.kind === 'in'), outs = MOTION_PRESETS.filter((p) => p.kind === 'out'), under = MOTION_PRESETS.filter((p) => p.kind === 'move' || p.kind === 'loop');
    const id = (list: readonly MotionPreset[]) => fc.constantFrom(...list.map((p) => p.id));
    const len = fc.constantFrom(undefined, 5, 10, 40);
    fc.assert(fc.property(
      fc.constantFrom('in' as const, 'out' as const), fc.constantFrom(15, 20, 24, 30, 36, 48, 60, 120, 240),
      fc.option(id(under), { nil: undefined }), fc.constantFrom('none' as const, 'before' as const, 'after' as const),
      fc.integer({ min: 0, max: 40 }), len, fc.integer({ min: 0, max: 40 }), len, fc.integer({ min: 0, max: 40 }), len,
      fc.option(fc.tuple(fc.constantFrom(...PROPS), fc.double({ min: 0.1, max: 0.9, noNaN: true })), { nil: undefined }), fc.constantFrom(1, 0.5),
      (kind, total, base, otherWhen, ai, aLen, bi, bLen, xi, xLen, hand, amount) => {
        const mine = kind === 'in' ? ins : outs, others = kind === 'in' ? outs : ins;
        const A = mine[ai % mine.length]!, B = mine[bi % mine.length]!, X = others[xi % others.length]!;
        const span = (p: MotionPreset, n: number | undefined) => Math.min(total, n ?? p.defaultFrames);
        const nA = span(A, aLen), nB = span(B, bLen), nX = span(X, xLen);
        /** `u` frames in from this motion's own edge of the clip, as a clip-local frame */
        const frame = (u: number) => (kind === 'in' ? u : total - u);
        const { doc, clipId } = title(total, { x: 0.1, y: -0.05, scale: 1.2, rotation: 5, opacity: 0.8 });
        const args = (n: number | undefined) => ({ ...(n ? { frames: n } : {}), amount });
        let d = base ? motion(doc, clipId, base) : doc;
        if (otherWhen === 'before') d = motion(d, clipId, X.id, args(xLen));
        d = motion(d, clipId, A.id, args(aLen));
        if (otherWhen === 'after') d = motion(d, clipId, X.id, args(xLen));
        // a hand-made key further in than the motion (and not inside the motion at the other end: a hand edit there makes
        // that motion unrecognisable, which is a stated limit), on any property
        const reach = otherWhen === 'none' ? total : total - nX; // how far in from this edge the other motion begins
        const handAt = hand ? nA + 1 + Math.floor(hand[1] * (total - nA - 1)) : -1;
        if (hand && handAt > nA && handAt < reach) d = key(d, clipId, hand[0], frame(handAt), hand[0] === 'opacity' ? 0.5 : hand[0] === 'scale' ? 1.7 : hand[0] === 'rotation' ? 40 : 0.3);
        const before = d;
        const after = motion(before, clipId, B.id, args(bLen));
        expect(validateProject(after)).toEqual([]);
        const label = `${total} frames: ${base ?? '-'}, ${X.id} ${otherWhen} (${nX}), ${A.id} (${nA}) -> ${B.id} (${nB})${hand && handAt > nA && handAt < reach ? `, hand ${hand[0]} at ${handAt}` : ''}`;
        for (const p of PROPS) {
          const bUses = B.properties.includes(p), aUsed = A.properties.includes(p), xUses = otherWhen !== 'none' && X.properties.includes(p);
          // (1) further in than the old motion nothing changes, and nowhere at all on a property neither motion uses.
          //     (On its own properties a new motion that is longer than the old one, or that runs into the other end's motion,
          //     overwrites what it covers, as it always did; that case is left out here.)
          const from = !bUses ? (aUsed ? nA : 0) : aUsed && nB <= nA && !(xUses && nB > reach) ? nA : total + 1;
          for (let u = from; u <= total; u++) if (!near(at(after, clipId, frame(u))[p], at(before, clipId, frame(u))[p])) throw new Error(`${label}: ${p} changed at frame ${frame(u)}: ${at(before, clipId, frame(u))[p]} -> ${at(after, clipId, frame(u))[p]}`);
          // (2) where the old motion was and the new one is not, the property rests: nothing of the old motion is left.
          if (!aUsed) continue;
          const cutShort = otherWhen === 'after' && xUses && reach < nA; // the other motion took over from `reach`
          const end = cutShort ? reach : nA, rest = at(before, clipId, frame(end))[p];
          for (let u = bUses ? nB : 0; u <= end; u++) if (!near(at(after, clipId, frame(u))[p], rest)) throw new Error(`${label}: ${p} at frame ${frame(u)} is ${at(after, clipId, frame(u))[p]}, not at rest (${rest}): the old ${kind === 'in' ? 'entrance' : 'exit'} is still there`);
        }
      },
    ), { numRuns: 2000 });
  }, 120_000);

  // ---- animate_clip and the library: whichever runs last owns the entrance (or exit) it writes ----
  const animate = (doc: ProjectDocument, clipId: string, args: Record<string, unknown>) => tx(doc, [{ op: 'animate_clip', args: { clipId, ...args } }]).doc;
  /** Undo as the store does it: the before-states of every entity the transaction changed. */
  const undone = (before: ProjectDocument, after: ProjectDocument) => { const back = structuredClone(after); restoreEntities(back, diffEntities(before, after).map((c) => ({ id: c.id, state: c.before }))); return back; };

  it('animate_clip after a library entrance or exit replaces it on every property it used, and keeps the other end; undo restores it', () => {
    for (const transform of [{}, { x: 0.25, y: -0.1, scale: 1.3, rotation: 12.5, opacity: 0.5 }] as Record<string, number>[]) {
      const { doc, clipId } = title(120, transform);
      const exit = motion(doc, clipId, 'motion.out.spin'), entrance = motion(doc, clipId, 'motion.in.spin');
      for (const [side, set, other] of [['in', ins, exit], ['out', outs, entrance]] as const) {
        for (const name of ANIMATE_CLIP_MOTIONS) {
          const args = side === 'in' ? { in: name } : { out: name };
          const alone = keysOf(animate(doc, clipId, args), clipId), withOther = keysOf(animate(other, clipId, args), clipId);
          for (const lib of set) {
            for (const extra of [{}, { frames: 40 }, { amount: 0.5 }] as Record<string, number>[]) {
              const before = motion(doc, clipId, lib.id, extra);
              const after = animate(before, clipId, args);
              expect(keysOf(after, clipId), `${lib.id} then animate_clip ${side}: ${name}`).toEqual(alone);
              expect(undone(before, after)).toEqual(before);
              expect(keysOf(animate(motion(other, clipId, lib.id, extra), clipId, args), clipId), `${lib.id} then animate_clip ${side}: ${name}, next to the other end`).toEqual(withOther);
            }
          }
        }
      }
    }
  }, 120_000);

  it('a library entrance or exit after animate_clip replaces it on every property it used, and keeps the other end; undo restores it', () => {
    const { doc, clipId } = title(120, { x: -0.2, y: 0.15, scale: 0.9, rotation: -8, opacity: 0.9 });
    for (const [side, set, otherArgs] of [['in', ins, { out: 'pop' }], ['out', outs, { in: 'slide-left' }]] as const) {
      const other = animate(doc, clipId, otherArgs);
      for (const lib of set) {
        const alone = keysOf(motion(doc, clipId, lib.id), clipId), withOther = keysOf(motion(other, clipId, lib.id), clipId);
        for (const name of ANIMATE_CLIP_MOTIONS) {
          for (const frames of [undefined, 30]) {
            const args = side === 'in' ? { in: name, ...(frames ? { inFrames: frames } : {}) } : { out: name, ...(frames ? { outFrames: frames } : {}) };
            const before = animate(doc, clipId, args);
            const after = motion(before, clipId, lib.id);
            expect(keysOf(after, clipId), `animate_clip ${side}: ${name} then ${lib.id}`).toEqual(alone);
            expect(undone(before, after)).toEqual(before);
            expect(keysOf(motion(animate(other, clipId, args), clipId, lib.id), clipId), `animate_clip ${side}: ${name} then ${lib.id}, next to the other end`).toEqual(withOther);
          }
        }
      }
    }
  });

  it('animate_clip after animate_clip: each side replaces its own side only; a side left out stays', () => {
    const { doc, clipId } = title(90);
    for (const a of ANIMATE_CLIP_MOTIONS) {
      for (const b of ANIMATE_CLIP_MOTIONS) {
        // both sides at once, twice: the second is all that is left
        expect(keysOf(animate(animate(doc, clipId, { in: a, out: a }), clipId, { in: b, out: b, inFrames: 20 }), clipId), `${a} then ${b}`).toEqual(keysOf(animate(doc, clipId, { in: b, out: b, inFrames: 20 }), clipId));
        // a new entrance alone keeps the exit made with the first entrance
        expect(keysOf(animate(animate(doc, clipId, { in: a, out: a }), clipId, { in: b }), clipId), `in ${a} + out ${a}, then in ${b}`).toEqual(keysOf(animate(animate(doc, clipId, { out: a }), clipId, { in: b }), clipId));
        expect(keysOf(animate(animate(doc, clipId, { in: a, out: a }), clipId, { out: b }), clipId), `in ${a} + out ${a}, then out ${b}`).toEqual(keysOf(animate(animate(doc, clipId, { in: a }), clipId, { out: b }), clipId));
      }
    }
    // the case of the report: a zoom-in entrance from the library, then a fade entrance from animate_clip: no scale keys of the zoom are left
    const zoomed = motion(doc, clipId, 'motion.in.zoom-in');
    const faded = animate(zoomed, clipId, { in: 'fade' });
    expect(keysOf(faded, clipId)).toEqual({ opacity: [[0, 0, 'ease-out'], [12, 1, 'linear']] });
    for (let g = 0; g <= 90; g++) expect(at(faded, clipId, g).scale, `frame ${g}`).toBe(1);
    // and both ends from the library, then both ends from animate_clip
    const both = motion(motion(doc, clipId, 'motion.in.elastic'), clipId, 'motion.out.spin');
    expect(keysOf(animate(both, clipId, { in: 'pop', out: 'slide-down' }), clipId)).toEqual(keysOf(animate(doc, clipId, { in: 'pop', out: 'slide-down' }), clipId));
  });

  it('animate_clip writes what it always wrote on a clip without animation: the entrance and exit shapes, at the frames asked for', () => {
    const { doc, clipId } = title(60, { y: 0.2 });
    expect(keysOf(animate(doc, clipId, { in: 'pop', out: 'slide-down', inFrames: 10, outFrames: 10 }), clipId)).toEqual({
      y: [[50, 0.2, 'ease-in'], [60, 0.2 - 0.08, 'linear']],
      scale: [[0, 0.6, 'ease-out'], [10, 1, 'linear']],
      opacity: [[0, 0, 'ease-out'], [10, 1, 'linear'], [50, 1, 'ease-in'], [60, 0, 'linear']],
    });
    // entrance and exit that meet: the key between them eases into the exit
    expect(keysOf(animate(doc, clipId, { in: 'fade', out: 'fade', inFrames: 30, outFrames: 30 }), clipId)).toEqual({ opacity: [[0, 0, 'ease-out'], [30, 1, 'ease-in'], [60, 0, 'linear']] });
    // longer together than the clip, or nothing chosen: refused as before
    expect(() => animate(doc, clipId, { in: 'fade', out: 'fade', inFrames: 40, outFrames: 40 })).toThrow();
    expect(() => animate(doc, clipId, { in: 'none' })).toThrow();
    // the shapes are the ones previousMotion recognises
    for (const kind of ['in', 'out'] as const) for (const name of ANIMATE_CLIP_MOTIONS) {
      const keys = animateClipKeys(kind, name, { totalFrames: 60, rest: RESTS[3]!, frames: 12 });
      expect(previousMotion(kind, keys, 60, RESTS[3]!), `${kind} ${name}`).toEqual(Object.fromEntries(Object.entries(keys).map(([p, k]) => [p, k.length])));
    }
  });

  it('property: entrances and exits from either operation, in any order, over moves, loops and hand keys: the last one owns its end of the clip, and undo restores the clip exactly', () => {
    type Entry = { id: string; kind: 'in' | 'out'; properties: readonly MotionProperty[]; defaultFrames: number; anim?: AnimateClipMotion };
    const anim = (kind: 'in' | 'out'): Entry[] => ANIMATE_CLIP_MOTIONS.map((name) => ({ id: `animate_clip.${kind}.${name}`, kind, anim: name, defaultFrames: 12, properties: PROPS.filter((p) => p in animateClipKeys(kind, name, { totalFrames: 100, rest: RESTS[0]! })) }));
    const lib = (kind: 'in' | 'out'): Entry[] => MOTION_PRESETS.filter((p) => p.kind === kind).map((p) => ({ id: p.id, kind, properties: p.properties, defaultFrames: p.defaultFrames }));
    const pools = { in: [...anim('in'), ...lib('in')], out: [...anim('out'), ...lib('out')] };
    const under = MOTION_PRESETS.filter((p) => p.kind === 'move' || p.kind === 'loop');
    const len = fc.constantFrom(undefined, 5, 10, 40);
    fc.assert(fc.property(
      fc.constantFrom('in' as const, 'out' as const), fc.constantFrom(24, 30, 36, 48, 60, 120, 240),
      fc.option(fc.constantFrom(...under.map((p) => p.id)), { nil: undefined }), fc.constantFrom('none' as const, 'before' as const, 'after' as const),
      fc.nat(), len, fc.nat(), len, fc.nat(), len,
      fc.option(fc.tuple(fc.constantFrom(...PROPS), fc.double({ min: 0.1, max: 0.9, noNaN: true })), { nil: undefined }), fc.constantFrom(1, 0.5),
      (kind, total, base, otherWhen, ai, aLen, bi, bLen, xi, xLen, hand, amount) => {
        const mine = pools[kind], others = pools[kind === 'in' ? 'out' : 'in'];
        const A = mine[ai % mine.length]!, B = mine[bi % mine.length]!, X = others[xi % others.length]!;
        const span = (p: Entry, n: number | undefined) => Math.min(total, n ?? p.defaultFrames);
        const nA = span(A, aLen), nB = span(B, bLen), nX = span(X, xLen);
        const frame = (u: number) => (kind === 'in' ? u : total - u);
        const { doc, clipId } = title(total, { x: 0.1, y: -0.05, scale: 1.2, rotation: 5, opacity: 0.8 });
        const put = (d: ProjectDocument, e: Entry, n: number | undefined) => e.anim
          ? animate(d, clipId, e.kind === 'in' ? { in: e.anim, inFrames: span(e, n) } : { out: e.anim, outFrames: span(e, n) })
          : motion(d, clipId, e.id, { ...(n ? { frames: n } : {}), amount });
        let d = base ? motion(doc, clipId, base) : doc;
        if (otherWhen === 'before') d = put(d, X, xLen);
        d = put(d, A, aLen);
        if (otherWhen === 'after') d = put(d, X, xLen);
        const reach = otherWhen === 'none' ? total : total - nX;
        const handAt = hand ? nA + 1 + Math.floor(hand[1] * (total - nA - 1)) : -1;
        if (hand && handAt > nA && handAt < reach) d = key(d, clipId, hand[0], frame(handAt), hand[0] === 'opacity' ? 0.5 : hand[0] === 'scale' ? 1.7 : hand[0] === 'rotation' ? 40 : 0.3);
        const before = d;
        const after = put(before, B, bLen);
        expect(validateProject(after)).toEqual([]);
        expect(undone(before, after)).toEqual(before);
        const label = `${total} frames: ${base ?? '-'}, ${X.id} ${otherWhen} (${nX}), ${A.id} (${nA}) -> ${B.id} (${nB})${hand && handAt > nA && handAt < reach ? `, hand ${hand[0]} at ${handAt}` : ''}`;
        for (const p of PROPS) {
          const bUses = B.properties.includes(p), aUsed = A.properties.includes(p), xUses = otherWhen !== 'none' && X.properties.includes(p);
          // (1) further in than the old motion nothing changes, and nowhere at all on a property neither motion uses
          const from = !bUses ? (aUsed ? nA : 0) : aUsed && nB <= nA && !(xUses && nB > reach) ? nA : total + 1;
          for (let u = from; u <= total; u++) if (!near(at(after, clipId, frame(u))[p], at(before, clipId, frame(u))[p])) throw new Error(`${label}: ${p} changed at frame ${frame(u)}: ${at(before, clipId, frame(u))[p]} -> ${at(after, clipId, frame(u))[p]}`);
          // (2) where the old motion was and the new one is not, the property rests: nothing of the old motion is left
          if (!aUsed) continue;
          const cutShort = otherWhen === 'after' && xUses && reach < nA;
          const end = cutShort ? reach : nA, rest = at(before, clipId, frame(end))[p];
          for (let u = bUses ? nB : 0; u <= end; u++) if (!near(at(after, clipId, frame(u))[p], rest)) throw new Error(`${label}: ${p} at frame ${frame(u)} is ${at(after, clipId, frame(u))[p]}, not at rest (${rest}): the old ${kind === 'in' ? 'entrance' : 'exit'} is still there`);
        }
      },
    ), { numRuns: 1500 });
  }, 180_000);
});
