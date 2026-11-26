/**
 * The teach row of the operations fuzz (wave 8; ops-fuzz.gen.ts genLesson): every call it makes fits apply_lesson's argument schema,
 * and validation (lessonValidate.ts) either accepts it or refuses it with an OpError — never another error — so a refusal the fuzz
 * sees later comes from the rules, not from a malformed call. The crafted bad variants (wrong part, literal clip, unknown $-key,
 * a person op) are always refused. Through the op, every call is refused (not built) or accepted, and a refusal changes nothing.
 * W1 owns this file after the pre-pass and adds the run against the built body (undo after every step, plan = commit).
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, canonical, createProject, getOp, OpError, validateLessonArgs, type ProjectDocument } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

describe('teach fuzz row', () => {
  it('fits the schema; validation accepts or refuses with an OpError; the op never changes a document when it refuses', () => {
    let accepted = 0, refused = 0;
    for (const seed of [1, 2, 3, 4]) {
      const fz = createFuzz(seed);
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_tf', name: 'tf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, { idSeed: `tf${seed}_`, actor: 'fuzz', allowInternal: true }).doc;
      doc = applyTransaction(doc, fz.setup(doc), { idSeed: `tf${seed}s_`, actor: 'fuzz' }).doc;
      // some ordinary edits first, so there are clips of every kind to learn from and apply to
      for (let i = 0; i < 60; i++) { try { doc = applyTransaction(doc, [fz.gen(doc)], { idSeed: `tf${seed}g${i}_`, actor: 'fuzz' }).doc; } catch (e) { if (!(e instanceof OpError)) throw e; } }
      const before = canonical(doc);
      for (let i = 0; i < 150; i++) {
        const call = fz.genLesson(doc);
        const where = JSON.stringify(call).slice(0, 300);
        expect(getOp(call.op)!.args.safeParse(call.args).success, where).toBe(true);
        try { validateLessonArgs(call.args); accepted++; } catch (e) { expect(e, where).toBeInstanceOf(OpError); refused++; }
        try { applyTransaction(doc, [call], { idSeed: `tf${seed}_${i}_`, actor: 'fuzz' }); } catch (e) { expect(e, where).toBeInstanceOf(OpError); }
        expect(canonical(doc), where).toBe(before);
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(refused).toBeGreaterThan(10);
  });
});
