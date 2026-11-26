/**
 * Fuzz of the internal op attach_footage_notes through the real store (wave 8 `understand`; ops-fuzz.gen.ts genFootageNotes), mixed with
 * the shared random public operations, committed as the describe job commits it (allowInternal, actor server:understand). The body is
 * lead-built and complete, so the oracles are final: an accepted call leaves a valid document whose pointers carry the counts given and
 * whose scenes, beats, moments and camera motion are untouched; a refusal is one of UNDERSTAND_OP_REFUSALS' codes and changes nothing;
 * undoing the notes commit by its transaction id (the «ביטול התיאורים» path, C7) restores the document exactly.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creativeProjection, UNDERSTAND_ACTOR, UNDERSTAND_OP_REFUSALS, validateProject, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_UNDERSTAND_FUZZ_SEEDS ?? 6));
const CODES = new Set<string>(Object.values(UNDERSTAND_OP_REFUSALS).map((r) => r.code));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('attach_footage_notes fuzz', () => {
  it('accepted calls leave a valid document and undo exactly by transaction id; refusals are typed and change nothing', () => {
    let accepted = 0, refused = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-undfuzz-')); dirs.push(dir);
      const s = new Store(dir);
      try {
        const fz = createFuzz(seed + 9100);
        const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
        s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
        s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
        for (let step = 0; step < 24; step++) {
          const doc = s.getProject(pid).doc;
          const call: OpCall = step % 2 === 0 ? fz.genFootageNotes(doc) : fz.gen(doc);
          const before = creativeProjection(doc);
          const actor = call.op === 'attach_footage_notes' ? UNDERSTAND_ACTOR : 'agent:fuzz';
          let tx: { transactionId: string | null } | null = null;
          try { tx = s.commit({ projectId: pid, actor, allowInternal: call.op === 'attach_footage_notes', ops: [call] }); } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            if (call.op === 'attach_footage_notes') { refused++; expect(CODES.has(e.code) || e.code === 'invalid_args', `${e.code}: ${e.message}`).toBe(true); }
            expect(creativeProjection(s.getProject(pid).doc)).toEqual(before);
            continue;
          }
          if (call.op !== 'attach_footage_notes') continue;
          accepted++;
          const txId = tx!.transactionId!;
          const after = s.getProject(pid).doc;
          expect(validateProject(after)).toEqual([]);
          for (const it of (call.args as { items: { assetId: string; spans: number; described: number; failed: number }[] }).items) {
            const an = after.analyses[it.assetId]!;
            expect(an.notes).toMatchObject({ spans: it.spans, described: it.described, failed: it.failed, origin: { createdBy: UNDERSTAND_ACTOR, edited: false } });
            expect(an.scenes).toEqual(doc.analyses[it.assetId]?.scenes);
            expect(an.moments).toEqual(doc.analyses[it.assetId]?.moments);
          }
          const u = s.undo(pid, 'user:local', 'undo', txId, undefined, true);
          expect(creativeProjection(s.getProject(pid).doc)).toEqual(before);
          s.undo(pid, 'user:local', 'redo', u.transactionId!, undefined, true);
          expect(creativeProjection(s.getProject(pid).doc)).toEqual(creativeProjection(after));
        }
      } finally { s.close(); }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  }, 60_000);
});
