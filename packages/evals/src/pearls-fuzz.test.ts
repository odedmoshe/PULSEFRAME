/**
 * The marked-range rows of the operations fuzz (wave 7 pearls track) with the oracles of ops-fuzz.test.ts: random public operations
 * mixed with random add_source_range / update_source_range / remove_source_range calls (and remove_asset / remove_person, whose
 * cascades take ranges along) on a project with two people. An accepted step leaves a valid document that passes the schema and can
 * be evaluated; a refusal is typed and changes nothing; the step's entity changes undo it exactly. Before builder A builds the bodies
 * every call of theirs is refused (notBuilt); once SOURCE_RANGE_OPS_BUILT, each must be accepted at least once and refused at least
 * once. Builder A owns this file after the pre-pass.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, SOURCE_RANGE_OPS, SOURCE_RANGE_OPS_BUILT, OpError, ProjectSchema, restoreEntities, timeline, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_PEARLS_FUZZ_SEEDS ?? 10));
const STEPS = Math.max(1, Number(process.env.PF_PEARLS_FUZZ_STEPS ?? 60));
const tally: Record<string, [number, number]> = {};

function run(seed: number) {
  const fz = createFuzz(seed + 7300);
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `pf${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_pf', name: 'pf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, [...fz.setup(doc), { op: 'add_person', args: { name: 'אלף' } }, { op: 'add_person', args: { name: 'Gimel' } }], ctx()).doc;
  for (let step = 0; step < STEPS; step++) {
    const call = step % 2 === 0 ? fz.genPearls(doc) : fz.genFocused(doc, ['add_clip', 'delete_clip', 'trim_clip', 'remove_asset', 'remove_person', 'set_clip_speed', 'freeze_frame']);
    const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
    const t = (tally[call.op] ??= [0, 0]);
    const before = doc, beforeJson = JSON.stringify(doc);
    let next: ProjectDocument;
    try { next = applyTransaction(doc, [call], ctx()).doc; } catch (e) {
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
    if (!next.sourceRanges && back.sourceRanges) throw new Error(`${where}\n  undo left an empty sourceRanges map`);
    doc = next;
  }
}

describe('fuzz: the marked-range operations among the others', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed));
  it('before the bodies every call was refused; after them each was accepted and refused', () => {
    for (const op of SOURCE_RANGE_OPS) {
      const [ok, no] = tally[op] ?? [0, 0];
      if (op !== 'add_source_range' && !SOURCE_RANGE_OPS_BUILT) continue; // with no range, update and remove are drawn only once some exist
      expect({ op, drawn: ok + no > 0 }).toEqual({ op, drawn: true });
      if (SOURCE_RANGE_OPS_BUILT) expect({ op, accepted: ok > 0, refused: no > 0 }).toEqual({ op, accepted: true, refused: true });
      else expect({ op, accepted: ok }).toEqual({ op, accepted: 0 });
    }
  });
});
