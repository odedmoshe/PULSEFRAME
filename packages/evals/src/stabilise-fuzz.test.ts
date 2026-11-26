/**
 * The stabilisation rows of the operations fuzz (wave 7 stabilise track) with the oracles of ops-fuzz.test.ts: random public
 * operations mixed with random attach_camera_motion calls committed as the stabilise job commits them (allowInternal) and random
 * set_clip_stabilise / remove_camera_motion calls. An accepted step leaves a valid document that passes the schema and can be
 * evaluated; a refusal is typed and changes nothing; the step's entity changes undo it exactly. attach_camera_motion is lead-built:
 * it must be accepted and refused at least once now. Before W2 builds the two public bodies every call of theirs is refused
 * (notBuilt); once STEADY_OPS_BUILT, each must be accepted at least once and refused at least once.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, STEADY_OPS_BUILT, OpError, ProjectSchema, restoreEntities, timeline, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_STEADY_FUZZ_SEEDS ?? 10));
const STEPS = Math.max(1, Number(process.env.PF_STEADY_FUZZ_STEPS ?? 60));
const tally: Record<string, [number, number]> = {};

function run(seed: number) {
  const fz = createFuzz(seed + 7100);
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `sb${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_sb', name: 'sb', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  for (let step = 0; step < STEPS; step++) {
    const internal = step % 3 === 0;
    const call = internal ? fz.genCameraMotion(doc) : step % 3 === 1 ? fz.genStabilise(doc) : fz.genFocused(doc, ['add_clip', 'delete_clip', 'split_clip', 'trim_clip', 'freeze_frame', 'replace_clip_media', 'create_motion_track']);
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

describe('fuzz: the stabilise operations among the others', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed));
  it('attach_camera_motion was accepted and refused; before the bodies every public call was refused, after them each was accepted and refused', () => {
    const [aok, ano] = tally.attach_camera_motion ?? [0, 0];
    expect({ accepted: aok > 0, refused: ano > 0 }).toEqual({ accepted: true, refused: true });
    for (const op of ['set_clip_stabilise', 'remove_camera_motion']) {
      const [ok, no] = tally[op] ?? [0, 0];
      expect({ op, drawn: ok + no > 0 }).toEqual({ op, drawn: true });
      if (STEADY_OPS_BUILT) expect({ op, accepted: ok > 0, refused: no > 0 }).toEqual({ op, accepted: true, refused: true });
      else expect({ op, accepted: ok }).toEqual({ op, accepted: 0 });
    }
  });
});
