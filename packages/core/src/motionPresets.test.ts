import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { MOTION_PRESETS, motionKeys, type MotionContext, type MotionKey, type MotionPreset, type MotionProperty } from './motionPresets.ts';

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
  });
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
