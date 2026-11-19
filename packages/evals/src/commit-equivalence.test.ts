/**
 * The faster edit path gives byte-identical results (2026-11-19 commit-cost work; docs/evidence/commit-bench.json). Two changes
 * sit under every commit: rational time's small-number fast paths (packages/time index.ts, BigInt reference in exact.ts) and
 * cloneDocument instead of structuredClone in applyTransaction (packages/core clone.ts). Both keep their old path behind a test
 * switch (TIME_REFERENCE, REFERENCE_PATH), and this file runs every corpus twice, once on each path, and compares everything:
 *
 * A. the ops-fuzz corpus in memory (createFuzz: every generator, internal operations and perform takes included): per step the
 *    call, the outcome (document JSON, op results and outputs, affected ids, summary; or the typed refusal with its details),
 *    the entity diff (the undo record), the validation of the result and the document after undoing the step;
 * B. the perform fuzz through the real Store (takes and public operations alternating, then undo everything, redo everything and
 *    replay the log): every row of every table (documents, op log, results, entity changes, outbox), every event emitted, the
 *    document after each commit, undo and redo, and the replayed document. randomBytes and the clock are made deterministic
 *    here so that the two runs can be compared byte for byte.
 * The keyframe-replay golden (keyframe-replay.test.ts) compares the fast path against hashes recorded before this change.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TIME_REFERENCE } from '@pulseframe/time';
import { applyTransaction, createProject, diffEntities, OpError, REFERENCE_PATH, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const rng = vi.hoisted(() => ({ n: 0 }));
vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  const randomBytes = (size: number) => { const b = Buffer.alloc(size); b.writeUInt32BE(rng.n++ >>> 0, Math.max(0, size - 4)); return b; };
  return { ...real, default: { ...real, randomBytes }, randomBytes };
});

const SEEDS = Math.max(1, Number(process.env.PF_EQ_SEEDS ?? 30));
const STEPS = Math.max(1, Number(process.env.PF_EQ_STEPS ?? 90));
const STORE_SEEDS = Math.max(1, Number(process.env.PF_EQ_STORE_SEEDS ?? 12));
const STORE_STEPS = 30;

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 32);
function onPath<R>(reference: boolean, fn: () => R): R {
  TIME_REFERENCE.on = reference; REFERENCE_PATH.on = reference;
  try { return fn(); } finally { TIME_REFERENCE.on = false; REFERENCE_PATH.on = false; }
}
const refusal = (e: unknown) => {
  if (e instanceof OpError || e instanceof ApiError) return { refused: e.code, message: e.message, details: e.details, hint: e.hint ?? null };
  throw e;
};
const corpus = { steps: 0, accepted: 0, refused: 0, takes: 0, storeCommits: 0 };

/** A: the ops-fuzz corpus, in memory. One record (hashed) per step. */
function fuzzRun(seed: number): { records: string[]; accepted: number; refused: number; takes: number } {
  const fz = createFuzz(seed);
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `q${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc = applyTransaction(createProject({ id: 'prj_eq', name: 'eq', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  doc = applyTransaction(doc, fz.aiSetup(doc), ctx(true)).doc;
  { const ops = fz.setupInternal(doc); if (ops.length) doc = applyTransaction(doc, ops, ctx(true)).doc; }
  const records = [sha(JSON.stringify(doc))];
  const seen = new Map<string, number>();
  let accepted = 0, refused = 0, takes = 0;
  for (let step = 0; step < STEPS; step++) {
    const kind = step % 10;
    const focus = [...seen].filter(([, a]) => a === 0).map(([k]) => k);
    const [call, internal]: [OpCall, boolean] =
      kind === 3 ? [fz.genTake(doc), true] : kind === 7 ? [fz.genInternal(doc), true] : kind === 5 ? [fz.genKeyframes(doc), false] : kind === 9 ? [fz.genSequence(doc), false]
      : kind === 1 && focus.length ? [fz.genFocused(doc, focus), false] : kind === 8 ? [fz.genMulticam(doc), false] : [fz.gen(doc), false];
    if (call.op === 'apply_take') takes++;
    let record: unknown;
    try {
      const r = applyTransaction(doc, [call], ctx(internal));
      const changes = diffEntities(doc, r.doc);
      let undone: unknown;
      try { undone = sha(JSON.stringify(applyTransaction(r.doc, [{ op: 'restore_entities', args: { targets: changes.map((c) => ({ id: c.id, state: c.before })) } }], ctx(true)).doc)); } catch (e) { undone = refusal(e); }
      record = { call, doc: JSON.stringify(r.doc), results: r.results, affectedIds: r.affectedIds, summary: r.summary, changes, issues: validateProject(r.doc), undone };
      doc = r.doc;
      accepted++;
      seen.set(call.op, (seen.get(call.op) ?? 0) + 1);
    } catch (e) {
      record = { call, ...refusal(e) };
      refused++;
      if (!seen.has(call.op)) seen.set(call.op, 0);
    }
    records.push(sha(JSON.stringify(record)));
  }
  return { records, accepted, refused, takes };
}

/** B: the perform fuzz through the real Store, everything it wrote and emitted. */
function storeRun(seed: number): string[] {
  rng.n = 0;
  vi.setSystemTime(new Date('2026-11-19T00:00:00.000Z'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-eq-'));
  const s = new Store(dir);
  const out: string[] = [];
  s.events.on('revision', (e) => out.push(`event ${JSON.stringify(e)}`));
  try {
    const fz = createFuzz(seed + 3000);
    const pid = s.createProject({ name: 'eq', width: 640, height: 360, frameRate: fz.rate }).doc.id;
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
    s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
    const snap = (what: string) => out.push(`${what} ${JSON.stringify(s.getProject(pid))}`);
    let commits = 0;
    for (let step = 0; step < STORE_STEPS; step++) {
      const doc = s.getProject(pid).doc;
      const isTake = step % 2 === 0;
      const call: OpCall = isTake ? fz.genTake(doc) : fz.gen(doc);
      try {
        const r = s.commit({ projectId: pid, actor: 'u', ops: [call], ...(isTake ? { allowInternal: true } : {}) });
        out.push(`commit ${JSON.stringify(r)}`);
        if (r.committed) commits++;
      } catch (e) { out.push(`refused ${JSON.stringify(refusal(e))}`); }
      snap('doc');
    }
    for (const mode of ['undo', 'redo'] as const)
      for (let i = 0; i < commits; i++) {
        try { out.push(`${mode} ${JSON.stringify(s.undo(pid, 'u', mode))}`); } catch (e) { out.push(`${mode} refused ${JSON.stringify(refusal(e))}`); }
        snap(mode);
      }
    out.push(`replay ${JSON.stringify(s.replay(pid))}`);
    for (const table of ['projects', 'transactions', 'outbox', 'entity_versions'])
      out.push(`${table} ${JSON.stringify(s.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())}`);
    corpus.storeCommits += commits;
  } finally { s.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  return out;
}

const firstDifference = (a: string[], b: string[]) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i; return -1; };

describe('the faster edit path gives exactly the results of the reference path', () => {
  beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); });
  afterAll(() => { vi.useRealTimers(); });
  for (let seed = 1; seed <= SEEDS; seed++)
    it(`ops-fuzz seed ${seed}: documents, outputs, refusals, entity diffs, validation and undo`, () => {
      const fast = onPath(false, () => fuzzRun(seed));
      const ref = onPath(true, () => fuzzRun(seed));
      expect(firstDifference(fast.records, ref.records), `seed ${seed}: first differing step`).toBe(-1);
      corpus.steps += STEPS; corpus.accepted += fast.accepted; corpus.refused += fast.refused; corpus.takes += fast.takes;
    }, 120_000);
  for (let seed = 1; seed <= STORE_SEEDS; seed++)
    it(`store seed ${seed}: perform takes and edits, undo all, redo all, replay; every table row and event`, () => {
      const fast = onPath(false, () => storeRun(seed));
      const ref = onPath(true, () => storeRun(seed));
      const i = firstDifference(fast, ref);
      expect(i, `seed ${seed}: first difference:\n fast ${fast[i]?.slice(0, 400)}\n ref  ${ref[i]?.slice(0, 400)}`).toBe(-1);
    }, 120_000);
  it('the corpus was what it says', () => {
    console.log(`commit equivalence corpus: ops-fuzz ${SEEDS} seeds × ${STEPS} steps = ${corpus.steps} steps (${corpus.accepted} accepted, ${corpus.refused} refused, ${corpus.takes} takes); store: perform fuzz ${STORE_SEEDS} seeds × ${STORE_STEPS} steps, ${corpus.storeCommits} commits, each undone, redone and replayed`);
    expect(corpus.steps).toBe(SEEDS * STEPS);
    expect(corpus.accepted).toBeGreaterThan(corpus.steps / 4);
    expect(corpus.takes).toBeGreaterThan(0);
    expect(corpus.storeCommits).toBeGreaterThan(0);
  });
  it('the reference switch really takes the old copy (structuredClone) and the fast path does not', () => {
    const doc = applyTransaction(createProject({ id: 'prj_sw', name: 'sw', width: 640, height: 360, frameRate: { num: 30, den: 1 } }), [], { idSeed: 's', actor: 't' }).doc;
    const spy = vi.spyOn(globalThis, 'structuredClone');
    try {
      onPath(false, () => applyTransaction(doc, [], { idSeed: 's', actor: 't' }));
      expect(spy).not.toHaveBeenCalled();
      onPath(true, () => applyTransaction(doc, [], { idSeed: 's', actor: 't' }));
      expect(spy).toHaveBeenCalledWith(doc);
    } finally { spy.mockRestore(); }
    expect(TIME_REFERENCE.on || REFERENCE_PATH.on).toBe(false);
  });
});
