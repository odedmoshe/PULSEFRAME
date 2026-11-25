/**
 * The content-library rows of the operations fuzz (wave 7 library track) with the oracles of ops-fuzz.test.ts: random public
 * operations mixed with random use_library_item calls committed as the server commits them (allowInternal) and add_credits_card
 * calls. An accepted step leaves a valid document that passes the schema and can be evaluated; a refusal is typed and changes
 * nothing; the step's entity changes undo it exactly. Before worker B builds the bodies every library call is refused (notBuilt),
 * which this checks too; once LIBRARY_OPS_BUILT, both operations must be accepted at least once and refused at least once.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, LIBRARY_OPS_BUILT, OpError, ProjectSchema, restoreEntities, timeline, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_LIBRARY_FUZZ_SEEDS ?? 10));
const STEPS = Math.max(1, Number(process.env.PF_LIBRARY_FUZZ_STEPS ?? 60));
const tally: Record<string, [number, number]> = {};

function run(seed: number) {
  const fz = createFuzz(seed + 7000);
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `lb${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_lb', name: 'lb', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  for (let step = 0; step < STEPS; step++) {
    const internal = step % 3 === 0;
    const call = internal ? fz.genLibraryUse() : step % 3 === 1 ? fz.genLibrary(doc) : fz.genFocused(doc, ['add_text', 'add_clip', 'delete_clip', 'move_clip', 'trim_clip', 'set_track_lock']);
    const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
    const t = (tally[call.op] ??= [0, 0]);
    const before = doc, beforeJson = JSON.stringify(doc);
    let next: ProjectDocument;
    try { next = applyTransaction(doc, [call], ctx(internal)).doc; } catch (e) {
      if (!(e instanceof OpError)) throw new Error(`${where}\n  threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
      if (JSON.stringify(doc) !== beforeJson) throw new Error(`${where}\n  a refused operation changed the document`);
      t[1]++;
      continue;
    }
    t[0]++;
    const issues = validateProject(next);
    if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
    const parsed = ProjectSchema.safeParse(next);
    if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
    const total = T.frameIndexAt(timeline(next)!.duration, fz.rate);
    for (const i of [0, Math.max(0, total - 1)]) evaluate(next, fz.f(i));
    const changes = diffEntities(before, next);
    const back = structuredClone(next);
    restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
    if (creativeProjection(back) !== creativeProjection(before)) throw new Error(`${where}\n  undoing the step does not restore the previous document`);
    doc = next;
  }
}

describe('fuzz: the content-library operations among the others', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed));
  it('both library operations were drawn; before the bodies every call was refused, after them each was accepted and refused', () => {
    for (const op of ['use_library_item', 'add_credits_card']) {
      const [ok, no] = tally[op] ?? [0, 0];
      expect({ op, drawn: ok + no > 0 }).toEqual({ op, drawn: true });
      if (LIBRARY_OPS_BUILT) expect({ op, accepted: ok > 0, refused: no > 0 }).toEqual({ op, accepted: true, refused: true });
      else expect({ op, accepted: ok }).toEqual({ op, accepted: 0 });
    }
  });
});
