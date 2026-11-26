/**
 * Fuzz of «קליפ מקוד»'s internal op apply_made_clip through the real store (wave 8 motioncode; ops-fuzz.gen.ts genMade), mixed with
 * the shared random public operations, committed as the made routes commit it (allowInternal, as the credential). Oracles: an
 * accepted call leaves a valid document that passes the schema and can be evaluated, adds at most one asset (none when the bytes
 * are already there: dedup by hash) and at most one track, places at most one clip, and a replace keeps the ids, places and lengths
 * of the clips it touches; a refusal is a typed ApiError (made_* refusals carry details.why) and changes nothing; at the end, undo
 * everything step by step, redo everything and replay the log from revision 0, each reproducing the recorded documents exactly.
 * Deterministic: seeds 1..PF_MADE_FUZZ_SEEDS (default 6), 24 steps each.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { creativeProjection, getOp, ProjectSchema, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { ApiError, Store } from '../../../apps/server/src/store.ts';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_MADE_FUZZ_SEEDS ?? 6));
const STEPS = 24;
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
const tally = { accepted: 0, refused: 0, placed: 0, replaced: 0, dedup: 0, whys: {} as Record<string, number> };

const clipsOf = (d: ProjectDocument) => new Map(Object.values(d.sequences).flatMap((s) => s.tracks.flatMap((t) => t.clips.map((c) => [c.id, c] as const))));
const trackCount = (d: ProjectDocument) => Object.values(d.sequences).reduce((n, s) => n + s.tracks.length, 0);

function run(seed: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-madefuzz-'));
  dirs.push(dir);
  const s = new Store(dir);
  try {
    const fz = createFuzz(seed + 7000);
    const pid = s.createProject({ name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }).doc.id;
    s.commit({ projectId: pid, actor: 'system', allowInternal: true, ops: fz.importOps });
    s.commit({ projectId: pid, actor: 'system', ops: fz.setup(s.getProject(pid).doc) });
    const proj = () => creativeProjection(s.getProject(pid).doc);
    const states = [proj()];
    for (let step = 0; step < STEPS; step++) {
      const doc = s.getProject(pid).doc;
      const isMade = step % 2 === 0;
      const call: OpCall = isMade ? fz.genMade(doc) : fz.gen(doc);
      const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
      try {
        const r = s.commit({ projectId: pid, actor: 'agent:fuzz', ops: [call], ...(isMade ? { allowInternal: true } : {}) });
        if (!r.committed) continue;
        const next = s.getProject(pid).doc;
        if (isMade) {
          tally.accepted++;
          const out = r.results?.[0]?.output as { assetId: string; deduplicated: boolean; clipId?: string; replacedClipIds?: string[] } | undefined;
          const added = Object.keys(next.assets).length - Object.keys(doc.assets).length;
          expect(added, where).toBe(out && out.deduplicated ? 0 : 1);
          if (out?.deduplicated) tally.dedup++;
          expect(next.assets[out!.assetId]?.provenance.made, where).toBeTruthy();
          expect(trackCount(next) - trackCount(doc), where).toBeLessThanOrEqual(1);
          const before = clipsOf(doc), after = clipsOf(next);
          const newClips = [...after.keys()].filter((id) => !before.has(id));
          expect(newClips.length, where).toBeLessThanOrEqual(1);
          if (out?.clipId) { tally.placed++; expect(newClips, where).toEqual([out.clipId]); }
          for (const id of out?.replacedClipIds ?? []) {
            tally.replaced++;
            const a = before.get(id)!, b = after.get(id)!;
            expect({ start: b.start, duration: b.duration, assetId: (b as { assetId?: string }).assetId }, where).toEqual({ start: a.start, duration: a.duration, assetId: out!.assetId });
          }
        }
        states.push(proj());
        const issues = validateProject(next);
        if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
        const parsed = ProjectSchema.safeParse(next);
        if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
        for (const k of [0, 30, 120]) evaluate(next, T.frameTime(k, fz.rate));
      } catch (e) {
        if (!(e instanceof ApiError)) throw e instanceof Error && e.message.startsWith('seed ') ? e : new Error(`${where}\n  not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
        if (isMade) {
          tally.refused++;
          const why = String((e.details as { why?: string })?.why ?? e.code);
          tally.whys[why] = (tally.whys[why] ?? 0) + 1;
          expect(why, where).not.toBe('made_not_built');
        }
        if (proj() !== states.at(-1)) throw new Error(`${where}\n  a refused commit changed the project`);
      }
    }
    for (let i = states.length - 2; i >= 0; i--) {
      s.undo(pid, 'agent:fuzz', 'undo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: undo ${i + 1} does not restore the document recorded before it`);
    }
    for (let i = 1; i < states.length; i++) {
      s.undo(pid, 'agent:fuzz', 'redo');
      if (proj() !== states[i]) throw new Error(`seed ${seed}: redo ${i} does not restore the document recorded after it`);
    }
    if (JSON.stringify(s.replay(pid).doc) !== JSON.stringify(s.getProject(pid).doc)) throw new Error(`seed ${seed}: replaying the log does not reproduce the stored document`);
  } finally { s.close(); }
}

describe('fuzz: apply_made_clip through the store (undo all, redo all, replay)', () => {
  it('every generated call fits apply_made_clip\'s argument schema (refusals then come from the body)', () => {
    const fz = createFuzz(71);
    const doc = { sequences: {}, assets: {} } as unknown as ProjectDocument;
    for (let i = 0; i < 200; i++) { const c = fz.genMade(doc); expect(getOp('apply_made_clip')!.args.safeParse(c.args).success, JSON.stringify(c).slice(0, 300)).toBe(true); }
  });
  for (let seed = 1; seed <= SEEDS; seed++) it(`seed ${seed}`, () => run(seed), 90_000);
  it('calls were accepted (placed, replaced) and refused', () => {
    console.log(`made fuzz: ${JSON.stringify(tally)}`);
    if (SEEDS < 6) return;
    expect(tally.accepted).toBeGreaterThan(0);
    expect(tally.refused).toBeGreaterThan(0);
    expect(tally.placed).toBeGreaterThan(0);
  });
});
