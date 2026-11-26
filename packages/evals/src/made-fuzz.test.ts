/**
 * Fuzz of «קליפ מקוד»'s internal op apply_made_clip through the real store (wave 8 motioncode; ops-fuzz.gen.ts genMade), mixed with
 * the shared random public operations, committed as the made routes commit it (allowInternal). Oracles now (pre-pass): every call is
 * refused with a typed OpError (made_not_built) and changes nothing. W2, with the body: an accepted call leaves a valid document
 * that passes the schema and can be evaluated, adds exactly one asset (or reuses it by hash) and at most one track; a refusal is
 * typed and changes nothing; undo everything, redo everything and replay from revision 0 reproduce the recorded documents.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creativeProjection, MADE_BUILT, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_MADE_FUZZ_SEEDS ?? 6));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('apply_made_clip fuzz (pre-pass: refused, nothing changes)', () => {
  it.skipIf(MADE_BUILT.op)('every call is refused with made_not_built and changes nothing', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-madefuzz-')); dirs.push(dir);
      const s = new Store(dir);
      try {
        const fz = createFuzz(seed + 7000);
        const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
        s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
        s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
        for (let step = 0; step < 20; step++) {
          const doc = s.getProject(pid).doc;
          const call: OpCall = step % 2 === 0 ? fz.genMade(doc) : fz.gen(doc);
          const before = creativeProjection(doc);
          try { s.commit({ projectId: pid, actor: 'agent:fuzz', allowInternal: true, ops: [call] }); } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            if (call.op === 'apply_made_clip') expect(JSON.stringify(e.toJSON())).toContain('made_not_built');
            expect(creativeProjection(s.getProject(pid).doc)).toEqual(before);
            continue;
          }
          expect(call.op, 'apply_made_clip is never accepted before W2 builds it').not.toBe('apply_made_clip');
        }
      } finally { s.close(); }
    }
  });
  it.todo('W2: accepted calls leave a valid, evaluable document; one asset (dedup by hash), at most one track; undo/redo/replay exact');
});
