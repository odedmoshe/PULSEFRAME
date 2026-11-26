/**
 * wave 8 qc (B1): the document rules and the explanation pass on random documents from the operations fuzz generator
 * (ops-fuzz.gen.ts): they never throw, say they looked (built: true), keep every range inside the film, never quote a
 * transcript word, and explain only with a reason for the finding kind EXPLAINED_FOR names.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, assembleChecks, createProject, documentChecks, EXPLAINED_FOR, explainFindings, OpError, sequenceDuration, type ExportFinding, type ProjectDocument } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = [11, 12, 13, 14, 15, 16];
const STEPS = 160;

describe('qc rules on fuzzed documents', () => {
  for (const seed of SEEDS) it(`seed ${seed}: never throws, built, ranges inside the film, no word quoted, reasons match kinds`, () => {
    const fz = createFuzz(seed);
    const rate = fz.rate;
    let n = 0;
    const ctx = (allowInternal = false) => ({ idSeed: `qf${seed}_${n++}_`, actor: 'fuzz', allowInternal });
    let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_qcf', name: 'qcf', width: 640, height: 360, frameRate: rate }), fz.importOps, ctx(true)).doc;
    doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
    const words = Object.values(doc.transcripts ?? {}).flatMap((t) => t.segments.flatMap((s) => s.words.map((w) => w.text)));
    for (let step = 0; step < STEPS; step++) {
      try { doc = applyTransaction(doc, [fz.gen(doc)], ctx()).doc; } catch (e) { if (!(e instanceof OpError)) throw e; }
      if (step % 8 !== 7) continue;
      const r = documentChecks(doc);
      expect(r.built).toBe(true);
      const filmFrames = T.frameIndexAt(sequenceDuration(doc), rate);
      for (const i of r.issues) {
        expect(i.range.startFrame).toBeGreaterThanOrEqual(0);
        expect(i.range.endFrame).toBeLessThanOrEqual(filmFrames);
        expect(i.range.endFrame).toBeGreaterThanOrEqual(i.range.startFrame);
        for (const w of words) expect(i.message.includes(w), `${i.code} quotes a word`).toBe(false);
        for (const v of Object.values(i.measured)) expect(Number.isFinite(v)).toBe(true);
      }
      // findings at every quarter of the film, of every kind
      const at = (k: number) => T.frameTime(Math.floor((filmFrames * k) / 4), rate);
      const fs: ExportFinding[] = [0, 1, 2, 3].flatMap((k) => (['black', 'frozen'] as const).map((kind) => ({ kind, from: at(k), to: at(k + 1), measured: { k } })));
      const ss: ExportFinding[] = [0, 1, 2, 3].map((k) => ({ kind: 'silence', from: at(k), to: at(k + 1), soundPlays: false, measured: { k } }));
      const out = explainFindings(doc, 0, assembleChecks({ method: 'm', status: 'measured', findings: fs }, { method: 's', status: 'measured', findings: ss }));
      expect(out.picture.findings).toHaveLength(fs.length);
      for (const x of [...out.picture.findings, ...out.sound.findings]) if (x.explained) expect(EXPLAINED_FOR[x.explained]).toBe(x.kind);
    }
  });
});
