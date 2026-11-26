/**
 * The content-pack rows of the operations fuzz (ADR-0022) with the oracles of ops-fuzz.test.ts: random public operations
 * (one-step titles among them) mixed with random add_builtin_music calls committed as the server commits them
 * (allowInternal), some placed, some the same track again, some malformed. An accepted step leaves a valid document that passes
 * the schema and can be evaluated; a refusal is typed and changes nothing; the step's entity changes undo it exactly. Built-in
 * music grids stay known: a track that was added keeps method MUSIC_METHOD unless a person corrected it.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, MUSIC_METHOD, OpError, ProjectSchema, restoreEntities, timeline, validateProject, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_PACK_FUZZ_SEEDS ?? 12));
const STEPS = Math.max(1, Number(process.env.PF_PACK_FUZZ_STEPS ?? 60));
const tally: Record<string, [number, number]> = {};

function run(seed: number) {
  const fz = createFuzz(seed + 5000);
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `pk${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_pk', name: 'pk', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  for (let step = 0; step < STEPS; step++) {
    const internal = step % 3 === 0;
    const call = internal ? fz.genMusic() : step % 2 ? fz.genFocused(doc, ['add_text', 'edit_analysis', 'delete_clip', 'move_clip', 'trim_clip']) : fz.gen(doc);
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
    for (const a of Object.values(next.assets)) if (a.provenance.procedural?.id.startsWith('music.')) {
      const beats = next.analyses[a.id]?.beats;
      expect(beats, where).toBeDefined();
      if (!beats!.origin.edited) expect(beats!.origin.method, where).toBe(MUSIC_METHOD);
    }
    const back = structuredClone(next);
    restoreEntities(back, diffEntities(before, next).map((c) => ({ id: c.id, state: c.before })));
    if (creativeProjection(back) !== creativeProjection(before)) throw new Error(`${where}\n  undoing the step does not restore the previous document`);
    doc = next;
  }
}

describe('fuzz: content packs and built-in music (ADR-0022)', () => {
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed));
  it('add_builtin_music and add_text were each accepted and refused', () => {
    for (const op of ['add_builtin_music', 'add_text']) {
      const [ok, no] = tally[op] ?? [0, 0];
      expect(ok, `${op} accepted`).toBeGreaterThan(0);
      if (SEEDS >= 12) expect(no, `${op} refused`).toBeGreaterThan(0);
    }
  });
});
