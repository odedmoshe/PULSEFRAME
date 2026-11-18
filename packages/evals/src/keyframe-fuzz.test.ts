/**
 * The fuzz rows of keyframe curves (ADR-0019; ops-fuzz.gen.ts genKeyframes): every call they draw has arguments its operation's
 * schema accepts, so what is refused is refused by the operation, and every operation of the rows is drawn with every easing.
 * ops-fuzz.test.ts draws these rows among the others now that W1 has built the bodies (KEYFRAME_OPS_BUILT); the last test here
 * runs them, mostly on their own, against the built bodies (validation, schema, evaluation, undo after every step).
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, creativeProjection, diffEntities, EASINGS, getOp, KEYFRAME_OPS_BUILT, OpError, ProjectSchema, restoreEntities, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
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
  it('W1: against the built bodies every accepted step validates, parses, evaluates and undoes exactly; every operation of the rows is accepted', () => {
    expect(KEYFRAME_OPS_BUILT).toBe(true);
    const tally: Record<string, [number, number]> = {};
    for (let seed = 1; seed <= 8; seed++) {
      const fz = createFuzz(seed);
      let n = 0;
      const ctx = (allowInternal = false) => ({ idSeed: `kz${seed}_${n++}_`, actor: 'fuzz', allowInternal });
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_kf', name: 'kf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
      doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
      doc = applyTransaction(doc, [{ op: 'add_text', args: { text: 'א', start: fz.f(0), duration: fz.f(90) } }, { op: 'add_adjustment', args: { span: { start: fz.f(0), duration: fz.f(60) }, effects: [{ type: 'blur.gaussian' }, { type: 'color.grade' }] } }], ctx()).doc;
      for (let step = 0; step < 160; step++) {
        const call = step % 4 === 3 ? fz.gen(doc) : fz.genKeyframes(doc);
        const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
        const t = (tally[call.op] ??= [0, 0]);
        let next: ProjectDocument;
        try { next = applyTransaction(doc, [call], ctx()).doc; } catch (e) {
          if (!(e instanceof OpError)) throw new Error(`${where}\n  not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
          t[1]++;
          continue;
        }
        t[0]++;
        expect(validateProject(next), where).toEqual([]);
        expect(ProjectSchema.safeParse(next).success, where).toBe(true);
        evaluate(next, fz.f(step % 90));
        const back = structuredClone(next);
        restoreEntities(back, diffEntities(doc, next).map((c) => ({ id: c.id, state: c.before })));
        expect(creativeProjection(back) === creativeProjection(doc), `${where}\n  undo`).toBe(true);
        doc = next;
      }
    }
    for (const op of KEYFRAME_FUZZ_OPS) expect(tally[op]?.[0] ?? 0, `${op} accepted ${JSON.stringify(tally[op])}`).toBeGreaterThan(0);
    console.log(`keyframe fuzz rows (accepted/attempted): ${KEYFRAME_FUZZ_OPS.map((op) => `${op} ${tally[op]?.[0] ?? 0}/${(tally[op]?.[0] ?? 0) + (tally[op]?.[1] ?? 0)}`).join(', ')}`);
  }, 120_000);
  // replaying the seeded corpus without the new curves gives byte-identical documents: keyframe-replay.test.ts
});
