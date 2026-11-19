/**
 * Wave 4's one schema bump (ADR-0018): MIGRATIONS[2] is the identity apart from the version. Every stored document and every
 * operation log made before the bump must replay to exactly what it did. Random op logs from the operations fuzz (every
 * operation family it draws: people, life line, packs, music, tracking, templates, adjustment, formats, …) at five frame rates
 * are recorded as a store would keep them (initial document, then per transaction the ops, id seed, actor, allowInternal),
 * stored as version 2, and replayed the way apps/server/src/store.ts replay() does: migrateProject(initial), then
 * applyTransaction per row, then migrateProject of the result. Each step's document must equal, byte for byte apart from the
 * version, the one the log made; and each stored step (as version 2) must read back through migrateProject unchanged.
 */
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, migrateProject, OpError, ProjectSchema, SCHEMA_VERSION, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

interface Row { ops: OpCall[]; idSeed: string; actor: string; allowInternal: boolean }
const SEEDS = 12, STEPS = 60;
/** The document as an older build stored it: JSON with schemaVersion 2. */
const asV2 = (doc: ProjectDocument) => ({ ...JSON.parse(JSON.stringify(doc)), schemaVersion: 2 });
const asCurrent = (doc: ProjectDocument) => JSON.stringify(ProjectSchema.parse(JSON.parse(JSON.stringify(doc))));

function record(seed: number): { initial: ProjectDocument; rows: Row[]; docs: ProjectDocument[] } {
  const fz = createFuzz(seed);
  const initial = createProject({ id: 'prj_replay', name: 'replay', width: 640, height: 360, frameRate: fz.rate });
  const rows: Row[] = [], docs: ProjectDocument[] = [];
  let doc = initial, k = 0;
  const step = (ops: OpCall[], allowInternal: boolean) => {
    if (!ops.length) return;
    const row = { ops, idSeed: `r${seed}_${k++}_`, actor: 'replay', allowInternal };
    try { doc = applyTransaction(doc, ops, row).doc; } catch (e) { if (e instanceof OpError) return; throw e; }
    rows.push(row); docs.push(doc);
  };
  step(fz.importOps, true);
  step(fz.setup(doc), false);
  step(fz.aiSetup(doc), true);
  step(fz.setupInternal(doc), true);
  for (let i = 0; i < STEPS; i++) step([fz.gen(doc)], false);
  for (const g of [fz.genLife, fz.genPeople, () => fz.genMusic(), fz.genInternal]) for (let i = 0; i < 10; i++) step([g(doc)], true);
  return { initial, rows, docs };
}

describe('schema version 3: MIGRATIONS[2] replays every stored document and op log identically', () => {
  it('is the current version', () => expect(SCHEMA_VERSION).toBe(3));
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}: an op log stored at version 2 replays to the same documents`, () => {
      const { initial, rows, docs } = record(seed);
      expect(rows.length).toBeGreaterThan(5);
      let doc = migrateProject(asV2(initial));
      expect(JSON.stringify(doc)).toBe(asCurrent(initial));
      rows.forEach((row, i) => {
        doc = applyTransaction(doc, structuredClone(row.ops), row).doc;
        expect(JSON.stringify(migrateProject(JSON.parse(JSON.stringify(doc))))).toBe(asCurrent(docs[i]!));
        // the same step stored by an older build reads back unchanged apart from the version
        expect(JSON.stringify(migrateProject(asV2(docs[i]!)))).toBe(asCurrent(docs[i]!));
      });
    });
  }
});
