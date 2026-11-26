/**
 * proof:living's engine fixtures must be ones the product accepts: set_living_picture refuses a move faster than the comfort rule of
 * thumb (core livingMaxAmount, verifier C1), so a slide at amount 1 needs a clip long enough for it. The first integration run of the
 * proof failed every engine check on a 90-frame clip (max 0.32); this keeps the fixture and the rule in step.
 */
import { describe, expect, it } from 'vitest';
import { livingMaxAmount } from '@pulseframe/core';
import { LIVING_ENGINE_FIXTURE } from './living-proof.engine.ts';

describe('living proof fixtures', () => {
  it('the engine part\'s clip takes a slide at amount 1 with ease-in-out, and is the shortest that does (from 90 frames up)', () => {
    const { frames, fps } = LIVING_ENGINE_FIXTURE;
    expect(livingMaxAmount(frames, fps, 'slide', 'ease-in-out')).toBeGreaterThanOrEqual(1);
    expect(frames === 90 || livingMaxAmount(frames - 1, fps, 'slide', 'ease-in-out') < 1).toBe(true);
    expect(LIVING_ENGINE_FIXTURE.sample).toEqual({ mid: Math.round((frames - 1) / 2), last: frames - 1, quarters: [0, 1, 2, 3, 4].map((k) => Math.round((k * (frames - 1)) / 4)) });
  });
});

describe('check 3\'s band (living-proof.engine.ts livingBand)', () => {
  it('a soft edge moved by its own nearness is not a band; the far side stretched across the gap is, and is counted', async () => {
    const { livingBand } = await import('./living-proof.engine.ts');
    const d = 10, f = 0.5;
    // a soft edge: nearness rises 0 → 1 over 40 px, every pixel shows the source its own nearness puts it at
    const soft = Array.from({ length: 60 }, (_, i) => { const near = Math.min(1, Math.max(0, (i - 10) / 40)); return { got: i + (f - near) * d, rest: i, near }; });
    expect(livingBand(soft, d, f)).toEqual({ longest: 0, fromInside: 0 });
    // a gap: 8 pixels at x = 12 … 19 all repeat the source at photo x 5 (nearness 0 there): stretched, a run of 8
    const gap = soft.map((p, i) => (i >= 12 && i < 20 ? { got: 5, rest: i, near: 0 } : p));
    expect(livingBand(gap, d, f)).toEqual({ longest: 8, fromInside: 0 });
    expect(livingBand([{ got: 0, rest: 0, near: 0.9 }], d, f)).toEqual({ longest: 1, fromInside: 1 });
    expect(livingBand([{ got: 0, rest: 0, near: 0.9 }, null, { got: 0, rest: 0, near: 0.9 }], d, f).longest).toBe(1);
  });
});

describe('the coordinate photo\'s decoder (living-proof.engine.ts decode)', () => {
  it('a pixel the model places within 2 px of a wrap column or row is skipped (a sample there blends both sides: run 2 read x 591 for 511.69)', async () => {
    const { decode } = await import('./living-proof.engine.ts');
    const W = 640, img = Buffer.alloc(W * 2 * 3);
    img.set([79, 100, 108], 0); // a bilinear sample between photo x 511 (r 255, b 64) and 512 (r 0, b 128)
    expect(decode(img, 0, 0, [511.69, 100])).toBeNull();
    img.set([79, 100, 0], 3);
    expect(decode(img, 1, 0, [79.2, 100])).toEqual([79, 100]);
    img.set([80, 1, 0], 6); // a row near y 256
    expect(decode(img, 2, 0, [80, 255.4])).toBeNull();
  });
});
