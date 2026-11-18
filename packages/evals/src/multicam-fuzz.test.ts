/**
 * The multicam rows of the operations fuzz (ADR-0020; ops-fuzz.gen.ts genMulticam): they reach all eight public operations and
 * every call they make fits its operation's argument schema, so a refusal the fuzz sees later comes from the body, not from a
 * malformed call. ops-fuzz.test.ts draws them once W1 sets MULTICAM_OPS_BUILT.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, getOp, MULTICAM_OPS_BUILT, type ProjectDocument } from '@pulseframe/core';
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
  it.todo(`ops-fuzz.test.ts accepts every multicam operation at least once (W1 sets MULTICAM_OPS_BUILT; now ${MULTICAM_OPS_BUILT})`);
});
