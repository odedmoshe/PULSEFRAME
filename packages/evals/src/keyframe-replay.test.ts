/**
 * Old op logs replay byte-identically (ADR-0019 W1, keyframes-plan.md §3a): the seeded operations fuzz WITHOUT the new curves
 * (createFuzz v1Replay: no keyframe-curve rows, no multicam rows) makes, step by step, exactly the documents it made before the
 * keyframe curves were built. keyframe-replay.golden.json holds, per seed, the SHA-256 of every document of the run in order
 * (recorded on the tree before W1 changed set_keyframe, set_effect_keyframe, placeMotion and the sampler).
 *
 * Re-record (only after a deliberate change to an older operation, never to make a keyframe change pass):
 *   PF_RECORD_KEYS_REPLAY=1 pnpm vitest run packages/evals/src/keyframe-replay.test.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, isV1Easing, OpError, type Easing, type ProjectDocument } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = 24, STEPS = 90;
const GOLDEN = new URL('./keyframe-replay.golden.json', import.meta.url);
const RECORD = process.env.PF_RECORD_KEYS_REPLAY === '1';

/** Every easing a document holds (transform and effect keys). */
function easingsOf(doc: ProjectDocument): Set<Easing> {
  const out = new Set<Easing>();
  for (const s of Object.values(doc.sequences)) for (const t of s.tracks) for (const c of t.clips) {
    for (const keys of Object.values(c.keyframes ?? {})) for (const k of keys ?? []) out.add(k.easing);
    for (const fx of c.effects ?? []) for (const keys of Object.values(fx.keyframes ?? {})) for (const k of keys) out.add(k.easing);
  }
  return out;
}

function replay(seed: number): { hashes: string[]; accepted: number; easings: Set<Easing> } {
  const fz = createFuzz(seed, { v1Replay: true });
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `z${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc = applyTransaction(createProject({ id: 'prj_fuzz', name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  doc = applyTransaction(doc, fz.aiSetup(doc), ctx(true)).doc;
  { const ops = fz.setupInternal(doc); if (ops.length) doc = applyTransaction(doc, ops, ctx(true)).doc; }
  const hash = (d: ProjectDocument) => createHash('sha256').update(JSON.stringify(d)).digest('hex').slice(0, 24);
  const hashes = [hash(doc)];
  const easings = new Set<Easing>();
  let accepted = 0;
  for (let step = 0; step < STEPS; step++) {
    const call = fz.gen(doc);
    try { doc = applyTransaction(doc, [call], ctx()).doc; accepted++; } catch (e) {
      if (!(e instanceof OpError)) throw e;
      hashes.push(`refused:${e.code}`);
      continue;
    }
    for (const x of easingsOf(doc)) easings.add(x);
    hashes.push(hash(doc));
  }
  return { hashes, accepted, easings };
}

describe('the seeded fuzz corpus without the new curves replays byte-identically', () => {
  it(`${SEEDS} seeds × ${STEPS} steps: every document (and every refusal code) as recorded before the change`, () => {
    const runs = Object.fromEntries(Array.from({ length: SEEDS }, (_, i) => [String(i + 1), replay(i + 1)]));
    const record = Object.fromEntries(Object.entries(runs).map(([k, r]) => [k, r.hashes]));
    if (RECORD) writeFileSync(GOLDEN, JSON.stringify({ note: 'keyframe-replay.test.ts: per seed, the hash of every document of the v1 fuzz run, recorded before ADR-0019 W1', seeds: record }, null, 1) + '\n');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { seeds: Record<string, string[]> };
    let docs = 0;
    for (const [seed, r] of Object.entries(runs)) {
      for (const e of r.easings) expect(isV1Easing(e), `seed ${seed} drew the new curve ${e}`).toBe(true);
      expect(r.hashes, `seed ${seed}`).toEqual(golden.seeds[seed]);
      docs += r.accepted;
    }
    console.log(`keyframe replay: ${docs} accepted steps over ${SEEDS} seeds, every document byte-identical to the recording`);
    expect(docs).toBeGreaterThan(SEEDS * 20);
  });
});
