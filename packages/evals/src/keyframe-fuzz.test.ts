/**
 * The fuzz rows of keyframe curves (ADR-0019; ops-fuzz.gen.ts genKeyframes): every call they draw has arguments its operation's
 * schema accepts, so what is refused is refused by the operation, and every operation of the rows is drawn with every easing.
 * ops-fuzz.test.ts draws these rows among the others once W1 has built the bodies (KEYFRAME_OPS_BUILT); the run of the rows
 * against the built bodies (validation, schema, undo after every step) is W1's to switch on.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, EASINGS, getOp, KEYFRAME_OPS_BUILT } from '@pulseframe/core';
import { createFuzz, KEYFRAME_FUZZ_OPS } from './ops-fuzz.gen.ts';

describe('keyframe curve fuzz rows', () => {
  it('draw every operation and every easing, each call with arguments its schema accepts', () => {
    const seen = new Set<string>(), easings = new Set<string>();
    for (let seed = 1; seed <= 5; seed++) {
      const fz = createFuzz(seed);
      let doc = applyTransaction(createProject({ id: 'prj_kf', name: 'kf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, { idSeed: `kf${seed}_`, actor: 'fuzz', allowInternal: true }).doc;
      doc = applyTransaction(doc, fz.setup(doc), { idSeed: `kg${seed}_`, actor: 'fuzz' }).doc;
      doc = applyTransaction(doc, [{ op: 'add_text', args: { text: 'א', start: fz.f(0), duration: fz.f(90) } }], { idSeed: `kh${seed}_`, actor: 'fuzz' }).doc;
      for (let i = 0; i < 300; i++) {
        const call = fz.genKeyframes(doc);
        seen.add(call.op);
        const e = (call.args as { easing?: string }).easing;
        if (e) easings.add(e);
        const parsed = getOp(call.op)!.args.safeParse(call.args);
        expect(parsed.success, `${JSON.stringify(call).slice(0, 300)}`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...KEYFRAME_FUZZ_OPS].sort());
    expect([...easings].sort()).toEqual([...EASINGS].sort());
  });
  it.todo(`W1: with the bodies built (KEYFRAME_OPS_BUILT is ${KEYFRAME_OPS_BUILT} in this tree), ops-fuzz.test.ts draws these rows: every accepted step validates, parses and undoes exactly; replaying the seeded corpus without the new curves gives byte-identical documents`);
});
