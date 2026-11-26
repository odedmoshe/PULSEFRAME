/**
 * Fuzz of the internal op use_source_item through the real store (wave 8 `sources`; ops-fuzz.gen.ts genSource), mixed with the
 * shared random public operations, committed as the source_fetch job commits it (allowInternal). Oracles now (pre-pass): every call
 * was refused with a typed OpError (sources_not_built) and changed nothing (kept, skipped once built). W1, with the body: an accepted call leaves a valid
 * document; one asset added or an existing one given the record (dedup by hash, a library copy kept); a refusal is one of the data
 * facts of SOURCE_OP_REFUSALS (never a licence finding) and changes nothing; undo everything, redo everything and replay from
 * revision 0 reproduce the recorded documents.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyTransaction, createProject, creativeProjection, OpError, validateProject, type OpCall } from '@pulseframe/core';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_SOURCES_FUZZ_SEEDS ?? 6));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('use_source_item fuzz', () => {
  it('W1: accepted calls leave a valid document; one asset added or the record attached (a library copy kept); refusals are data facts only and change nothing; undo all, redo all and replay reproduce the recorded documents', () => {
    const tally = { accepted: 0, added: 0, attached: 0, dedup: 0, refused: 0, warned: 0 };
    const FACTS = ['source_no_record', 'source_hash_mismatch', 'source_record_weaker', 'source_credit_missing'];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-srcfuzz-')); dirs.push(dir);
      const s = new Store(dir);
      try {
        const fz = createFuzz(seed + 8000);
        const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
        s.commit({ projectId: pid, actor: 'agent:fuzz', allowInternal: true, ops: fz.importOps });
        s.commit({ projectId: pid, actor: 'agent:fuzz', ops: fz.setup(s.getProject(pid).doc) });
        const proj = () => creativeProjection(s.getProject(pid).doc);
        const states = [proj()];
        for (let step = 0; step < 30; step++) {
          const doc = s.getProject(pid).doc;
          const call: OpCall = step % 2 === 0 ? fz.genSource() : fz.gen(doc);
          const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
          const before = proj();
          let r;
          try { r = s.commit({ projectId: pid, actor: 'agent:fuzz', allowInternal: true, ops: [call] }); } catch (e) {
            if (!(e instanceof ApiError)) throw new Error(`${where}\n  not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 400)}`);
            expect(proj(), where).toBe(before);
            if (call.op === 'use_source_item') {
              tally.refused++;
              const text = JSON.stringify(e.toJSON());
              // a data fact of SOURCE_OP_REFUSALS, or the validation fact of a link record on a non-link provider; never a licence finding
              const fact = FACTS.some((w) => text.includes(w)) || (e.code === 'invalid_result' && text.includes('a link records how it was fetched'));
              expect(fact, `${where}\n  ${text.slice(0, 400)}`).toBe(true);
              expect(text, where).not.toMatch(/licence_(no_derivatives|share_alike|unknown|unconfirmed)/);
            }
            continue;
          }
          if (call.op === 'use_source_item') {
            tally.accepted++;
            const o = r.results[0]!.output as { assetId: string; deduplicated: boolean; recordAttached: boolean; libraryKept: boolean; warnings: { code: string }[] };
            const a = (call.args as { asset: { contentHash: string; provenance: { source: { licence: { id: string } } } } }).asset;
            const after = s.getProject(pid).doc;
            const was = Object.keys(doc.assets).length, now = Object.keys(after.assets).length;
            if (!o.deduplicated) { tally.added++; expect([now, after.assets[o.assetId]!.contentHash], where).toEqual([was + 1, a.contentHash]); }
            else {
              expect(now, where).toBe(was);
              if (o.recordAttached) tally.attached++; else tally.dedup++;
            }
            if (!o.libraryKept) expect(after.assets[o.assetId]!.provenance.source?.licence.id, where).toBe(a.provenance.source.licence.id);
            if (o.warnings.length) tally.warned++;
          }
          if (r.committed) states.push(proj());
          const next = s.getProject(pid).doc;
          expect(validateProject(next), where).toEqual([]);
        }
        for (let i = states.length - 2; i >= 0; i--) { s.undo(pid, 'agent:fuzz', 'undo'); expect(proj(), `seed ${seed}: undo ${i + 1}`).toBe(states[i]); }
        for (let i = 1; i < states.length; i++) { s.undo(pid, 'agent:fuzz', 'redo'); expect(proj(), `seed ${seed}: redo ${i}`).toBe(states[i]); }
        expect(JSON.stringify(s.replay(pid).doc), `seed ${seed}: replay`).toBe(JSON.stringify(s.getProject(pid).doc));
      } finally { s.close(); }
    }
    expect({ accepted: tally.accepted > 0, added: tally.added > 0, refused: tally.refused > 0, warned: tally.warned > 0 }, JSON.stringify(tally)).toEqual({ accepted: true, added: true, refused: true, warned: true });
  }, 240_000);
  it('W1: a CC BY-SA, CC BY-ND, provider: or unknown licence is never refused; its warning is in output.warnings', () => {
    const fz = createFuzz(8999);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const call = fz.genSource();
      const a = (call.args as { asset: { contentHash: string; provenance: { source?: { sha256: string; provider: string; link?: unknown; licence: { id: string }; flags: Record<string, unknown>; credit?: unknown } } } }).asset;
      const src = a.provenance.source;
      if (!src || a.contentHash !== `sha256:${src.sha256}` || (src.provider === 'link') !== (src.link !== undefined)) continue;
      const id = src.licence.id;
      if (!['CC-BY-SA-4.0', 'CC-BY-ND-4.0', 'provider:pixabay', 'unknown'].includes(id)) continue;
      const doc = createProject({ id: 'prj_f', name: 'f', width: 640, height: 360 });
      let out: { warnings: { code: string }[] };
      try { out = applyTransaction(doc, [call], { idSeed: 'f_', actor: 'agent:fuzz', allowInternal: true }).results[0]!.output as unknown as { warnings: { code: string }[] }; } catch (e) {
        // the generator's "unknown" row carries no licenceUnconfirmed mark: a record weaker than its own id is a data fact
        expect([id, e instanceof OpError && (e.details as { why?: string }).why]).toEqual(['unknown', 'source_record_weaker']);
        continue;
      }
      const want = { 'CC-BY-SA-4.0': 'licence_share_alike', 'CC-BY-ND-4.0': 'licence_no_derivatives', 'provider:pixabay': 'licence_unconfirmed', unknown: 'licence_unknown' }[id]!;
      expect(out.warnings.map((w) => w.code), id).toContain(want);
      seen.add(id);
    }
    expect([...seen].sort()).toEqual(['CC-BY-ND-4.0', 'CC-BY-SA-4.0', 'provider:pixabay']);
  });
});
