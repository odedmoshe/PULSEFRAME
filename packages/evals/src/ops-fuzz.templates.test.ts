/**
 * Fuzz of templates and adjustment layers through the real store (ADR-0016): the random public operations of ops-fuzz.gen.ts
 * (adjustment layers, replace media and everything else) mixed with random apply_template calls committed as the server
 * commits them (allowInternal), including malformed plans and regenerations of earlier runs. Oracles: an accepted commit
 * leaves a valid document that passes the schema and can be evaluated; a refusal is typed and changes nothing; at the end,
 * undo everything step by step, redo everything step by step and replay the log from revision 0, each reproducing the
 * recorded documents exactly. Deterministic: seeds 1..PF_TEMPLATE_FUZZ_SEEDS (default 20), PF_TEMPLATE_FUZZ_STEPS steps each
 * (default 40).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { creativeProjection, ProjectSchema, validateProject, type OpCall } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_TEMPLATE_FUZZ_SEEDS ?? 20));
const STEPS = Math.max(1, Number(process.env.PF_TEMPLATE_FUZZ_STEPS ?? 40));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tally: Record<string, [number, number]> = {};

function run(seed: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tplfuzz-'));
  dirs.push(dir);
  const s = new Store(dir);
  try {
    const fz = createFuzz(seed + 1000);
    const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
    s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
    const proj = () => creativeProjection(s.getProject(pid).doc);
    const states = [proj()];
    const applied: string[] = [];
    for (let step = 0; step < STEPS; step++) {
      const doc = s.getProject(pid).doc;
      const internal = step % 3 === 0;
      const call: OpCall = internal ? fz.genInternal(doc) : fz.gen(doc);
      const where = `seed ${seed} (${fz.rate.num}/${fz.rate.den}) step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
      const t = (tally[call.op] ??= [0, 0]);
      try {
        const r = s.commit({ projectId: pid, actor: 'u', ops: [call], ...(internal ? { allowInternal: true } : {}) });
        if (!r.committed) continue;
        t[0]++;
        states.push(proj()); applied.push(call.op);
        const next = s.getProject(pid).doc;
        const issues = validateProject(next);
        if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
        const parsed = ProjectSchema.safeParse(next);
        if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
        for (const k of [0, 30, 120]) evaluate(next, T.frameTime(k, fz.rate));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e instanceof Error && e.message.startsWith('seed ') ? e : new Error(`${where}\n  the store threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
        t[1]++;
        if (proj() !== states.at(-1)) throw new Error(`${where}\n  a refused commit changed the project`);
      }
    }
    for (let i = states.length - 2; i >= 0; i--) {
      s.undo(pid, 'u', 'undo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: undo of step ${i + 1} (${applied[i]}) does not restore the document recorded before it`);
    }
    for (let i = 1; i < states.length; i++) {
      s.undo(pid, 'u', 'redo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: redo of step ${i} (${applied[i - 1]}) does not restore the document recorded after it`);
    }
    if (JSON.stringify(s.replay(pid).doc) !== JSON.stringify(s.getProject(pid).doc)) throw new Error(`seed ${seed}: replaying the operation log from revision 0 does not reproduce the stored document`);
  } finally { s.close(); }
}

describe('fuzz: templates and adjustment layers through the store (undo all, redo all, replay)', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed), 60_000);
  it('apply_template was accepted and refused; the adjustment and replace-media operations were accepted', () => {
    console.log(`template fuzz (accepted/attempted): ${Object.entries(tally).sort().map(([k, [a, r]]) => `${k} ${a}/${a + r}`).join(', ')}`);
    if (SEEDS < 10) return;
    for (const op of ['apply_template', 'add_adjustment', 'replace_clip_media']) expect([op, (tally[op]?.[0] ?? 0) > 0]).toEqual([op, true]);
    expect(tally.apply_template![1]).toBeGreaterThan(0);
  });
});
