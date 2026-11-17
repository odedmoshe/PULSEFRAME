/**
 * Store-level fuzz: the same random operations as ops-fuzz.test.ts, but committed through the real store
 * (operation log, entity versions, undo and redo as compensating revisions, replay from the log).
 * After a random session by one actor: undo everything step by step, redo everything step by step, and replay the
 * whole log from revision 0 — each must reproduce the recorded documents exactly.
 * Deterministic: seeds 1..PF_STORE_FUZZ_SEEDS (default 25), PF_STORE_FUZZ_STEPS steps each (default 40).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { creativeProjection, validateProject, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_STORE_FUZZ_SEEDS ?? 25));
const STEPS = Math.max(1, Number(process.env.PF_STORE_FUZZ_STEPS ?? 40));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function run(seed: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-storefuzz-'));
  dirs.push(dir);
  const s = new Store(dir);
  try {
    const fz = createFuzz(seed);
    const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
    // imports and set-up belong to another actor, so "undo everything" by the editing actor stops before them
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
    s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.aiSetup(s.getProject(pid).doc) }); // ADR-0017 fixtures (internal operations)
    const proj = () => creativeProjection(s.getProject(pid).doc);
    const states = [proj()];
    const applied: string[] = [];
    for (let step = 0; step < STEPS; step++) {
      const call: OpCall = fz.gen(s.getProject(pid).doc);
      const where = `seed ${seed} (${fz.rate.num}/${fz.rate.den}) step ${step}: ${JSON.stringify(call).slice(0, 260)}`;
      try {
        const r = s.commit({ projectId: pid, actor: 'u', ops: [call] });
        if (r.committed) { states.push(proj()); applied.push(call.op); }
      } catch (e) {
        if (!(e instanceof ApiError)) throw new Error(`${where}\n  the store threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
        if (proj() !== states.at(-1)) throw new Error(`${where}\n  a refused commit changed the project`);
      }
    }
    const issues = validateProject(s.getProject(pid).doc);
    if (issues.length) throw new Error(`seed ${seed}: the final document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
    for (let i = states.length - 2; i >= 0; i--) {
      try { s.undo(pid, 'u', 'undo'); } catch (e) { throw new Error(`seed ${seed}: undo of step ${i + 1} (${applied[i]}) failed: ${String(e).slice(0, 300)}`); }
      if (proj() !== states[i]) throw new Error(`seed ${seed}: undo of step ${i + 1} (${applied[i]}) does not restore the document recorded before it`);
    }
    for (let i = 1; i < states.length; i++) {
      try { s.undo(pid, 'u', 'redo'); } catch (e) { throw new Error(`seed ${seed}: redo of step ${i} (${applied[i - 1]}) failed: ${String(e).slice(0, 300)}`); }
      if (proj() !== states[i]) throw new Error(`seed ${seed}: redo of step ${i} (${applied[i - 1]}) does not restore the document recorded after it`);
    }
    if (JSON.stringify(s.replay(pid).doc) !== JSON.stringify(s.getProject(pid).doc)) throw new Error(`seed ${seed}: replaying the operation log from revision 0 does not reproduce the stored document`);
    return states.length - 1;
  } finally { s.close(); }
}

describe('fuzz: operations through the store (undo all, redo all, replay)', () => {
  let committed = 0;
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => { committed += run(seed); }, 120_000);
  it('reports how much was exercised', () => { console.log(`store fuzz: ${committed} committed steps over ${SEEDS} seeds × ${STEPS} steps, each undone, redone and replayed`); });
});
