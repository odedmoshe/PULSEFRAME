/**
 * The life-line rows of the operations fuzz (ops-fuzz.gen.ts, ADR-0021) as a contract: every call they make names a registered
 * public operation and carries arguments that operation's schema accepts, and all seven operations come up. The rows join the
 * fuzz (ops-fuzz.test.ts, store-fuzz.test.ts) when W1 sets LIFE_OPS_BUILT; this test does not run any operation body.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, getOp, type ProjectDocument } from '@pulseframe/core';
import { createFuzz, LIFE_FUZZ_OPS } from './ops-fuzz.gen.ts';

describe('fuzz rows of the life line', () => {
  it('every generated call is well-formed for its operation, and each of the seven public operations is drawn', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const fz = createFuzz(seed);
      let n = 0;
      const ctx = (allowInternal = false) => ({ idSeed: `lf${seed}_${n++}_`, actor: 'fuzz', allowInternal });
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_lf', name: 'lf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
      doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
      // a few titles and clips, so rows that aim at them have something to aim at
      doc = applyTransaction(doc, [{ op: 'add_text', args: { text: 'שלום', start: fz.f(0), duration: fz.f(60) } }, { op: 'add_clip', args: { assetId: Object.keys(doc.assets)[0]!, start: fz.f(0), duration: fz.f(60) } }], ctx()).doc;
      for (let i = 0; i < 300; i++) {
        const call = fz.genLife(doc);
        const def = getOp(call.op);
        expect(def, call.op).toBeDefined();
        expect(def!.internal, call.op).toBeFalsy();
        const parsed = def!.args.safeParse(call.args);
        expect(parsed.success, `seed ${seed}: ${JSON.stringify(call)}`).toBe(true);
        seen.add(call.op);
      }
    }
    for (const op of LIFE_FUZZ_OPS) expect(seen.has(op), op).toBe(true);
    expect([...seen].filter((op) => !(LIFE_FUZZ_OPS as readonly string[]).includes(op))).toEqual(['update_text']);
  });
  // W1: with LIFE_OPS_BUILT the same rows run inside ops-fuzz.test.ts and store-fuzz.test.ts, where each operation must be accepted at least once
  it.todo('each life-line operation is accepted at least once in the operations fuzz and survives undo, redo and replay in the store fuzz');
});
