/**
 * Fuzz of perform mode's internal op apply_take through the real store (ADR-0025; ops-fuzz.gen.ts genTake), mixed with the
 * shared random public operations: takes are committed as POST /takes commits them (allowInternal). Oracles: an accepted take
 * leaves a valid document that passes the schema, can be evaluated, records ONE run and keeps the flash rule; a refusal is typed
 * and changes nothing; at the end, undo everything step by step, redo everything and replay the log from revision 0, each
 * reproducing the recorded documents exactly. Deterministic: seeds 1..PF_PERFORM_FUZZ_SEEDS (default 12), 30 steps each.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { creativeProjection, getOp, PERFORM_RECIPE_ID, ProjectSchema, takeFlashBreach, validateProject, type OpCall } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_PERFORM_FUZZ_SEEDS ?? 12));
const STEPS = 30;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tally = { accepted: 0, refused: 0, flash: 0 };

function run(seed: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-perffuzz-'));
  dirs.push(dir);
  const s = new Store(dir);
  try {
    const fz = createFuzz(seed + 3000);
    const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
    s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
    const proj = () => creativeProjection(s.getProject(pid).doc);
    const states = [proj()];
    for (let step = 0; step < STEPS; step++) {
      const doc = s.getProject(pid).doc;
      const isTake = step % 2 === 0;
      const call: OpCall = isTake ? fz.genTake(doc) : fz.gen(doc);
      const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
      try {
        const before = Object.keys(doc.recipeRuns).length;
        const r = s.commit({ projectId: pid, actor: 'u', ops: [call], ...(isTake ? { allowInternal: true } : {}) });
        if (!r.committed) continue;
        const next = s.getProject(pid).doc;
        if (isTake) {
          tally.accepted++;
          const runs = Object.values(next.recipeRuns).filter((x) => x.recipeId === PERFORM_RECIPE_ID);
          expect(Object.keys(next.recipeRuns).length, where).toBe(before + 1);
          const last = runs.find((x) => !doc.recipeRuns[x.id])!;
          expect(takeFlashBreach(next, next.mainSequenceId, last.createdIds), where).toBeNull();
        }
        states.push(proj());
        const issues = validateProject(next);
        if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
        const parsed = ProjectSchema.safeParse(next);
        if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
        for (const k of [0, 30, 120]) evaluate(next, T.frameTime(k, fz.rate));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e instanceof Error && e.message.startsWith('seed ') ? e : new Error(`${where}\n  not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
        if (isTake) { tally.refused++; if ((e.details as { reason?: string })?.reason === 'flash_limit') tally.flash++; }
        if (proj() !== states.at(-1)) throw new Error(`${where}\n  a refused commit changed the project`);
      }
    }
    for (let i = states.length - 2; i >= 0; i--) {
      s.undo(pid, 'u', 'undo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: undo ${i + 1} does not restore the document recorded before it`);
    }
    for (let i = 1; i < states.length; i++) {
      s.undo(pid, 'u', 'redo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: redo ${i} does not restore the document recorded after it`);
    }
    if (JSON.stringify(s.replay(pid).doc) !== JSON.stringify(s.getProject(pid).doc)) throw new Error(`seed ${seed}: replaying the log does not reproduce the stored document`);
  } finally { s.close(); }
}

describe('fuzz: perform takes through the store (undo all, redo all, replay)', () => {
  it('every generated take fits apply_take\'s argument schema (refusals then come from the body)', () => {
    const fz = createFuzz(77);
    const doc = { sequences: {}, recipeRuns: {} } as unknown as Parameters<typeof fz.genTake>[0];
    for (let i = 0; i < 200; i++) { const c = fz.genTake(doc); expect(getOp('apply_take')!.args.safeParse(c.args).success, JSON.stringify(c).slice(0, 300)).toBe(true); }
  });
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed), 60_000);
  it('takes were accepted, refused, and refused by the flash rule', () => {
    console.log(`perform fuzz: ${JSON.stringify(tally)}`);
    if (SEEDS < 8) return;
    expect(tally.accepted).toBeGreaterThan(0);
    expect(tally.refused).toBeGreaterThan(0);
    expect(tally.flash).toBeGreaterThan(0);
  });
});
