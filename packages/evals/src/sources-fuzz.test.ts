/**
 * Fuzz of the internal op use_source_item through the real store (wave 8 `sources`; ops-fuzz.gen.ts genSource), mixed with the
 * shared random public operations, committed as the source_fetch job commits it (allowInternal). Oracles now (pre-pass): every call
 * is refused with a typed OpError (sources_not_built) and changes nothing. W1, with the body: an accepted call leaves a valid
 * document; one asset added or an existing one given the record (dedup by hash, a library copy kept); a refusal is one of the data
 * facts of SOURCE_OP_REFUSALS (never a licence finding) and changes nothing; undo everything, redo everything and replay from
 * revision 0 reproduce the recorded documents.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { creativeProjection, SOURCES_BUILT, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_SOURCES_FUZZ_SEEDS ?? 6));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('use_source_item fuzz (pre-pass: refused, nothing changes)', () => {
  it.skipIf(SOURCES_BUILT.op)('every call is refused with sources_not_built and changes nothing', () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-srcfuzz-')); dirs.push(dir);
      const s = new Store(dir);
      try {
        const fz = createFuzz(seed + 8000);
        const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
        s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
        s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
        for (let step = 0; step < 20; step++) {
          const doc = s.getProject(pid).doc;
          const call: OpCall = step % 2 === 0 ? fz.genSource() : fz.gen(doc);
          const before = creativeProjection(doc);
          try { s.commit({ projectId: pid, actor: 'agent:fuzz', allowInternal: true, ops: [call] }); } catch (e) {
            if (!(e instanceof ApiError)) throw e;
            if (call.op === 'use_source_item') expect(JSON.stringify(e.toJSON())).toContain('sources_not_built');
            expect(creativeProjection(s.getProject(pid).doc)).toEqual(before);
            continue;
          }
          expect(call.op, 'use_source_item is never accepted before W1 builds it').not.toBe('use_source_item');
        }
      } finally { s.close(); }
    }
  }, 60_000);
  it.todo('W1: accepted calls leave a valid document; one asset added or the record attached (library copy kept); refusals are data facts only; undo/redo/replay exact');
  it.todo('W1: a CC BY-SA, CC BY-ND, provider: or unknown licence is never refused; its warning is in output.warnings');
});
