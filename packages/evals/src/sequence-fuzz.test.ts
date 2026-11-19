/**
 * The fuzz rows of the sequence lifecycle (ADR-0018 shorts; ops-fuzz.gen.ts genSequence): every call they draw has arguments
 * its operation's schema accepts, so what is refused is refused by the operation, and every one of the four operations is
 * drawn. ops-fuzz.test.ts draws these rows among the others once W1 has built the bodies (SEQUENCE_OPS_BUILT); the run of the
 * rows against the built bodies (validation, schema, undo after every step) is W1's to switch on.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, getOp, SEQUENCE_OPS, SEQUENCE_OPS_BUILT } from '@pulseframe/core';
import { createFuzz, SEQUENCE_FUZZ_OPS } from './ops-fuzz.gen.ts';

describe('sequence lifecycle fuzz rows', () => {
  it('draw all four operations, each with arguments its schema accepts', () => {
    expect([...SEQUENCE_FUZZ_OPS]).toEqual([...SEQUENCE_OPS]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 5; seed++) {
      const fz = createFuzz(seed);
      let doc = applyTransaction(createProject({ id: 'prj_sf', name: 'sf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, { idSeed: `sf${seed}_`, actor: 'fuzz', allowInternal: true }).doc;
      doc = applyTransaction(doc, fz.setup(doc), { idSeed: `sg${seed}_`, actor: 'fuzz' }).doc;
      for (let i = 0; i < 200; i++) {
        const call = fz.genSequence(doc);
        seen.add(call.op);
        const parsed = getOp(call.op)!.args.safeParse(call.args);
        expect(parsed.success, `${JSON.stringify(call).slice(0, 300)}`).toBe(true);
      }
    }
    expect([...seen].sort()).toEqual([...SEQUENCE_OPS].sort());
  });
  it.todo(`W1: with the bodies built (SEQUENCE_OPS_BUILT is ${SEQUENCE_OPS_BUILT} in this tree), ops-fuzz.test.ts draws these rows: every accepted step validates, parses and undoes exactly`);
});
