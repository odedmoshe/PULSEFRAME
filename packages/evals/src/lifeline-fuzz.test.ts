/**
 * The life-line rows of the operations fuzz (ops-fuzz.gen.ts, ADR-0021) as a contract: every call they make names a registered
 * public operation and carries arguments that operation's schema accepts, and all seven operations come up. The rows join the
 * fuzz (ops-fuzz.test.ts, store-fuzz.test.ts) when W1 sets LIFE_OPS_BUILT; this test does not run any operation body.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import {
  applyTransaction, calendarGroups, CaptureSchema, createProject, creativeProjection, diffEntities, eventCandidates, eventDisplayName, eventSpan, fieldSpans, freezeOps, getOp, LIFE_OPS_BUILT, OpError, ProjectSchema, resolveFields, restoreEntities, stampText, summarize, validateProject,
  type OpCall, type ProjectDocument,
} from '@pulseframe/core';
import { evaluate } from '@pulseframe/engine';
import { createFuzz, LIFE_FUZZ_OPS } from './ops-fuzz.gen.ts';

describe('fuzz rows of the life line', () => {
  it('every generated call is well-formed for its operation, and each of the seven public operations is drawn', () => {
    const seen = new Set<string>();
    const steps = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const fz = createFuzz(seed);
      let n = 0;
      const ctx = (allowInternal = false) => ({ idSeed: `lf${seed}_${n++}_`, actor: 'fuzz', allowInternal });
      let doc: ProjectDocument = applyTransaction(createProject({ id: 'prj_lf', name: 'lf', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
      doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
      // a few titles and clips, so rows that aim at them have something to aim at
      doc = applyTransaction(doc, [{ op: 'add_text', args: { text: 'שלום', start: fz.f(0), duration: fz.f(60) } }, { op: 'add_clip', args: { assetId: Object.keys(doc.assets)[0]!, start: fz.f(0), duration: fz.f(60) } }], ctx()).doc;
      for (let i = 0; i < 300; i++) {
        const call = fz.genLife(doc);
        const def = getOp(call.op);
        expect(def, call.op).toBeDefined();
        expect(def!.internal, call.op).toBeFalsy();
        const parsed = def!.args.safeParse(call.args);
        expect(parsed.success, `seed ${seed}: ${JSON.stringify(call)}`).toBe(true);
        seen.add(call.op);
        if (call.op === 'shift_asset_captures') steps.add((call.args as { minutes: number }).minutes);
      }
    }
    for (const op of LIFE_FUZZ_OPS) expect(seen.has(op), op).toBe(true);
    expect([...seen].filter((op) => !(LIFE_FUZZ_OPS as readonly string[]).includes(op))).toEqual(['update_text']);
    // the fuzz moves one file more than once: the total of any two steps it draws (the largest step among them) is one a capture can remember
    expect(steps.has(-5256000)).toBe(true);
    for (const a of steps) for (const b of steps) expect(CaptureSchema.safeParse({ at: '2014-12-28T17:30:00', utcOffsetMinutes: 120, source: 'container', shiftedMinutes: a + b }).success, `${a} then ${b}`).toBe(true);
  });
  // With LIFE_OPS_BUILT the same rows are also drawn inside ops-fuzz.test.ts (among all the other operations) and committed
  // through the real store in store-fuzz.test.ts (undo, redo and replay of its log). Here they run on their own, so every seed
  // spends all its steps on capture dates, events and title fields.
  it('each life-line operation is accepted at least once in a run of its rows, and every accepted step is valid, can be drawn, and survives undo, redo and a replay of the log', () => {
    expect(LIFE_OPS_BUILT).toBe(true);
    const SEEDS = 16, STEPS = 100;
    const accepted: Record<string, number> = {}, refusedCount: Record<string, number> = {};
    let frozen = 0, resolved = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const fz = createFuzz(seed);
      let n = 0;
      const nextSeed = () => `lr${seed}_${n++}_`;
      const log: { ops: OpCall[]; idSeed: string; allowInternal: boolean }[] = [];
      let doc: ProjectDocument = createProject({ id: 'prj_lr', name: 'lr', width: 640, height: 360, frameRate: fz.rate });
      const start = doc;
      const commit = (ops: OpCall[], allowInternal = false) => { const idSeed = nextSeed(); doc = applyTransaction(doc, ops, { idSeed, actor: 'fuzz', allowInternal }).doc; log.push({ ops, idSeed, allowInternal }); };
      commit(fz.importOps, true);
      commit(fz.setup(doc));
      commit(fz.aiSetup(doc), true); // copies that take their date from the dated video
      const [video, , picture, late] = Object.keys(doc.assets) as [string, string, string, string];
      commit([
        { op: 'add_clip', args: { assetId: video, start: fz.f(0), duration: fz.f(90) } }, { op: 'add_clip', args: { assetId: late, start: fz.f(90), duration: fz.f(60) } }, { op: 'add_clip', args: { assetId: picture, start: fz.f(180), duration: fz.f(60) } },
        { op: 'add_text', args: { text: 'שלום', start: fz.f(0), duration: fz.f(120) } }, { op: 'add_text', args: { text: '{date}', start: fz.f(150), duration: fz.f(120) } },
      ]);
      const sequenceId = doc.mainSequenceId;
      for (let step = 0; step < STEPS; step++) {
        const call = fz.genLife(doc);
        const where = `seed ${seed} step ${step}: ${JSON.stringify(call).slice(0, 240)}`;
        const before = doc, beforeJson = JSON.stringify(doc);
        try { commit([call]); } catch (e) {
          if (!(e instanceof OpError)) throw new Error(`${where}\n  threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 500)}`);
          if (JSON.stringify(doc) !== beforeJson) throw new Error(`${where}\n  a refused operation changed the document`);
          refusedCount[call.op] = (refusedCount[call.op] ?? 0) + 1;
          continue;
        }
        accepted[call.op] = (accepted[call.op] ?? 0) + 1;
        if (JSON.stringify(before) !== beforeJson) throw new Error(`${where}\n  the operation changed its input document`);
        const issues = validateProject(doc);
        if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 2))}`);
        if (!ProjectSchema.safeParse(doc).success) throw new Error(`${where}\n  accepted, but the stored format refuses the document`);
        // undo and redo through the entities, as the store does
        const changes = diffEntities(before, doc);
        const back = structuredClone(doc);
        restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before })));
        if (creativeProjection(back) !== creativeProjection(before)) throw new Error(`${where}\n  undo does not restore the document`);
        restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.after })));
        if (creativeProjection(back) !== creativeProjection(doc)) throw new Error(`${where}\n  redo does not restore the document`);
        // everything that reads the life line answers, and what it answers is drawable
        try {
          for (const frame of [0, 45, 100, 170, 200, 269]) evaluate(doc, fz.f(frame));
          summarize(doc);
          calendarGroups(doc);
          for (const e of Object.values(doc.events)) { eventDisplayName(doc, e); eventCandidates(doc, e); eventSpan(doc, e); }
          for (const track of doc.sequences[sequenceId]!.tracks) for (const clip of track.clips) {
            if (clip.type === 'caption') continue;
            for (const style of [{}, { clock: true, dateOrder: 'dmy' as const }]) { const text = stampText(doc, sequenceId, clip, clip.start, style); if (!/^[0-9 .:'\/-]{0,20}$/.test(text)) throw new Error(`a stamp text that is not a stamp: ${JSON.stringify(text)}`); }
            if (clip.type !== 'text') continue;
            const spans = fieldSpans(doc, sequenceId, clip);
            const from = T.frameIndexAt(clip.start, fz.rate), to = T.frameIndexAt(T.add(clip.start, clip.duration), fz.rate);
            if (spans[0]?.startFrame !== from || spans[spans.length - 1]?.endFrame !== to || spans.some((sp, i) => i > 0 && sp.startFrame !== spans[i - 1]!.endFrame)) throw new Error(`the stretches of title ${clip.id} do not cover it: ${JSON.stringify(spans.map((sp) => [sp.startFrame, sp.endFrame]))}`);
            for (const sp of spans) { resolved++; const shown = resolveFields(doc, sequenceId, clip, fz.f(sp.endFrame - 1)); if (shown.text !== sp.resolved.text) throw new Error(`title ${clip.id} shows ${JSON.stringify(shown.text)} at frame ${sp.endFrame - 1}, its stretch says ${JSON.stringify(sp.resolved.text)}`); }
            if (!clip.fields) { if (spans.length !== 1 || spans[0]!.resolved.text !== clip.text) throw new Error(`a plain title does not show its stored text`); continue; }
            // "make it plain text": when nothing stands in the way, the literal operations are accepted and leave a plain title with the same words
            const fr = freezeOps(doc, sequenceId, clip.id);
            if (fr.missing.length || fr.tooLong.length) continue;
            const shown = resolveFields(doc, sequenceId, clip, clip.start).text;
            const plain = applyTransaction(doc, fr.ops, { idSeed: 'fr_', actor: 'fuzz' }).doc;
            const after = plain.sequences[sequenceId]!.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id)!;
            if (after.type !== 'text' || after.fields || after.text !== shown) throw new Error(`freezing title ${clip.id} gave ${JSON.stringify(after.type === 'text' ? after.text : null)}, it showed ${JSON.stringify(shown)}`);
            frozen++;
          }
        } catch (e) { throw new Error(`${where}\n  accepted, but the document cannot be read: ${String((e as Error)?.stack ?? e).slice(0, 700)}`); }
      }
      // replay: the log applied again to the first document gives the same document (ids come from the logged seeds)
      let again = start;
      for (const entry of log) again = applyTransaction(again, entry.ops, { idSeed: entry.idSeed, actor: 'fuzz', allowInternal: entry.allowInternal }).doc;
      expect(JSON.stringify(again), `seed ${seed}: replay`).toBe(JSON.stringify(doc));
    }
    console.log(`life-line rows: accepted/refused per operation: ${[...LIFE_FUZZ_OPS, 'update_text'].map((op) => `${op} ${accepted[op] ?? 0}/${refusedCount[op] ?? 0}`).join(', ')}; ${resolved} stretches resolved, ${frozen} titles frozen`);
    for (const op of LIFE_FUZZ_OPS) {
      expect(accepted[op] ?? 0, `${op} was never accepted`).toBeGreaterThan(0);
      // each is refused sometimes too, so both sides of every operation are walked (the arrangement has no refusal while any file has a date)
      if (op !== 'cluster_events') expect(refusedCount[op] ?? 0, `${op} was never refused`).toBeGreaterThan(0);
    }
    expect(frozen).toBeGreaterThan(0);
  }, 300_000);
});
