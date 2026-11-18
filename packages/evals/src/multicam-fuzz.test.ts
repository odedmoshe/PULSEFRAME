/**
 * The multicam rows of the operations fuzz (ADR-0020; ops-fuzz.gen.ts genMulticam): they reach all eight public operations and
 * every call they make fits its operation's argument schema, so a refusal the fuzz sees later comes from the body, not from a
 * malformed call. ops-fuzz.test.ts draws them among the others now that W1 has built the bodies (MULTICAM_OPS_BUILT); the last
 * test here runs them, mostly on their own, against the built bodies (validation, schema, evaluation, undo after every step).
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, creativeProjection, diffEntities, getOp, MULTICAM_OPS_BUILT, OpError, ProjectSchema, restoreEntities, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz, MULTICAM_FUZZ_OPS } from './ops-fuzz.gen.ts';

describe('multicam fuzz rows', () => {
  it('reach every public multicam operation with calls that fit its argument schema', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3]) {
      const fz = createFuzz(seed);
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_mf', name: 'mf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, { idSeed: `mf${seed}_`, actor: 'fuzz', allowInternal: true }).doc;
      doc = applyTransaction(doc, fz.setup(doc), { idSeed: `mf${seed}s_`, actor: 'fuzz' }).doc;
      for (let i = 0; i < 200; i++) {
        const call = fz.genMulticam(doc);
        seen.add(call.op);
        const parsed = getOp(call.op)!.args.safeParse(call.args);
        expect(parsed.success, `${call.op} ${JSON.stringify(call.args).slice(0, 200)}`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...MULTICAM_FUZZ_OPS].sort());
  });
  it('W1: against the built bodies every accepted step validates, parses, evaluates and undoes exactly; every operation of the rows is accepted', () => {
    expect(MULTICAM_OPS_BUILT).toBe(true);
    const tally: Record<string, [number, number]> = {};
    for (let seed = 1; seed <= 8; seed++) {
      const fz = createFuzz(seed);
      let n = 0;
      const ctx = (allowInternal = false) => ({ idSeed: `mz${seed}_${n++}_`, actor: 'fuzz', allowInternal });
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_mf', name: 'mf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
      doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
      for (let step = 0; step < 160; step++) {
        const call = step % 4 === 3 ? fz.gen(doc) : fz.genMulticam(doc);
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
    for (const op of MULTICAM_FUZZ_OPS) expect(tally[op]?.[0] ?? 0, `${op} accepted ${JSON.stringify(tally[op])}`).toBeGreaterThan(0);
    console.log(`multicam fuzz rows (accepted/attempted): ${MULTICAM_FUZZ_OPS.map((op) => `${op} ${tally[op]?.[0] ?? 0}/${(tally[op]?.[0] ?? 0) + (tally[op]?.[1] ?? 0)}`).join(', ')}`);
  }, 120_000);
});
