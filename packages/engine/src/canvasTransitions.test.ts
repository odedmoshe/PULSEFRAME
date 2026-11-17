/**
 * Canvas2D transition dispatch (ADR-0012): every non-GPU transition id has a kernel, chosen by the registry's kernel name,
 * so no id can fall through to a silent cut. The geometry of the trend-pack kernels is W1's (the todos below).
 */
import { describe, expect, it } from 'vitest';
import { TRANSITIONS, type TransitionDef } from '@pulseframe/core';
import { CANVAS_KERNELS, CANVAS_TRANSITIONS } from './canvasTransitions.ts';
import { GPU_TRANSITIONS } from './gpu.ts';

const rows = TRANSITIONS as readonly TransitionDef[];

describe('Canvas2D transition dispatch', () => {
  it('the keys of CANVAS_TRANSITIONS are exactly the non-GPU ids, each with the kernel its registry row names', () => {
    expect(Object.keys(CANVAS_TRANSITIONS).sort()).toEqual(rows.filter((t) => !t.gpu).map((t) => t.id).sort());
    for (const t of rows.filter((x) => !x.gpu)) expect(CANVAS_TRANSITIONS[t.id]!.kernel, t.id).toBe(t.kernel);
    // and no id is both: a GPU id never reaches compositeLayer with a transition
    for (const id of Object.keys(CANVAS_TRANSITIONS)) expect(id in GPU_TRANSITIONS, id).toBe(false);
  });
  it('every kernel name has code', () => {
    for (const [id, c] of Object.entries(CANVAS_TRANSITIONS)) expect(typeof CANVAS_KERNELS[c.kernel], id).toBe('function');
  });
  it('the legacy variants carry what the id named before: dip-white v0 = 1, wipe and push their direction', () => {
    expect(CANVAS_TRANSITIONS['dip-black']!.v).toEqual([0, 0, 0]);
    expect(CANVAS_TRANSITIONS['dip-white']!.v).toEqual([1, 0, 0]);
    for (const kind of ['wipe', 'push'] as const) {
      expect(CANVAS_TRANSITIONS[`${kind}-left`]!.v).toEqual([-1, 0, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-right`]!.v).toEqual([1, 0, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-up`]!.v).toEqual([0, -1, 0]);
      expect(CANVAS_TRANSITIONS[`${kind}-down`]!.v).toEqual([0, 1, 0]);
    }
  });
  it.todo('no placeholder remains: every trend-pack kernel (punch, blur, split, shape, block, slices) is its own code (W1)');
  it.todo('coverScale contains the 4 corners at 16:9 and 9:16 (W1)');
  it.todo('scaled hearts and stars are nested: s1 < s2 means inside, on 10k sample points (W1)');
  it.todo('block covers the whole frame on the switch frame for n = 1..150, and nothing at p >= 0.92 (W1)');
  it.todo('slices: t_b lies in [0.2, 0.8]; the same seed gives the same offsets; seeds 1 and 2 differ (W1)');
});
