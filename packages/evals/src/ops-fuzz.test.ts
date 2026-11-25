/**
 * Fuzz of the editing operations as a whole (SPEC §6, Appendix C3 "Model"): random sequences drawn from 45 operations,
 * at five project frame rates, with these oracles after every step:
 *  - an accepted transaction yields a document that passes validation and the schema, and did not mutate its input;
 *  - a refusal is a typed OpError and leaves the document unchanged; nothing else may be thrown;
 *  - the document can be evaluated (picture graph, audio plan, timeline and summary queries, every linked format);
 *  - the entity diff of the step, applied backwards, restores the previous document exactly (the undo path).
 * Deterministic: seeds 1..PF_FUZZ_SEEDS (default 60), PF_FUZZ_STEPS steps each (default 90). A failure names seed, step and op.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, creativeProjection, diffEntities, LIBRARY_OPS_BUILT, MUSICFIT_OPS_BUILT, STEADY_OPS_BUILT, SST, OpError, ProjectSchema, projectVariant, restoreEntities, summarize, timeline, validateProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { audioPlan, evaluate } from '@pulseframe/engine';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = Math.max(1, Number(process.env.PF_FUZZ_SEEDS ?? 60));
const STEPS = Math.max(1, Number(process.env.PF_FUZZ_STEPS ?? 90));

function run(seed: number, focus: () => string[] = () => []) {
  const fz = createFuzz(seed);
  const { rate, f, int } = fz;
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `z${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc = applyTransaction(createProject({ id: 'prj_fuzz', name: 'fuzz', width: 640, height: 360, frameRate: rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  doc = applyTransaction(doc, fz.aiSetup(doc), ctx(true)).doc; // ADR-0017 fixtures: derived copies and a translation (internal operations)
  { const ops = fz.setupInternal(doc); if (ops.length) doc = applyTransaction(doc, ops, ctx(true)).doc; } // ADR-0015: measured samples for the motion track (an internal operation)
  // the content library (wave 7): one CC BY sound from the library on the timeline, so add_credits_card has a credit to card
  if (LIBRARY_OPS_BUILT) {
    const library = { itemId: 'synthetic/fuzz.wav', sourceId: 'synthetic', kind: 'sound' as const, title: 'Fuzz', sourceSha256: '5'.repeat(64), ledger: { item: 'synthetic' }, licence: { id: 'CC-BY-4.0' }, credit: { text: 'Fuzz by Synthetic (example.invalid)', placement: 'on_screen' as const }, flags: {} };
    const asset = { kind: 'audio' as const, name: 'lib.wav', contentHash: `sha256:${'5'.repeat(64)}`, byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(3, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: { origin: 'upload' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'fuzz', library } };
    const used = applyTransaction(doc, [{ op: 'use_library_item', args: { asset } }], ctx(true));
    doc = applyTransaction(used.doc, [{ op: 'add_clip', args: { assetId: used.results[0]!.output!.assetId as string, start: f(0), duration: f(30) } }], ctx()).doc;
  }
  // stabilisation (wave 7): camera motion of the first video, as the stabilise job attaches it (an internal operation), so
  // set_clip_stabilise and remove_camera_motion have a measurement to work on; fixed numbers, no draw from the random stream
  if (STEADY_OPS_BUILT) {
    const vid = Object.values(doc.assets).find((a) => a.video);
    if (vid) {
      const k = Math.min(120, vid.video!.frameCount ?? 120);
      const col = (m: number, amp: number) => Array.from({ length: k }, (_, i) => ((i * m) % (2 * amp + 1)) - amp);
      doc = applyTransaction(doc, [{ op: 'attach_camera_motion', args: { assetId: vid.id, from: 0, dx: col(37, 200), dy: col(53, 150), dr: col(71, 900), dz: col(29, 120), st: Array.from({ length: k }, (_, i) => (i === 0 ? SST.start : SST.ok)), method: 'fuzz', params: { algo: 1, input: 'proxy' }, createdAt: '2026-11-25T00:00:00Z' } }], ctx(true)).doc;
    }
  }
  // two caption cues, one after the other, so merge_cues (which needs a cue with a following cue) does not depend on two rare
  // add_cue draws landing in the same run; fixed numbers, no draw from the random stream
  doc = applyTransaction(doc, [{ op: 'add_caption_track', args: { mode: 'manual' } }], ctx()).doc;
  doc = applyTransaction(doc, [{ op: 'add_cue', args: { start: f(30), duration: f(20), text: 'first' } }, { op: 'add_cue', args: { start: f(50), duration: f(20), text: 'second' } }], ctx()).doc;
  // music that fits the film (wave 7): the measured music under a picture clip near the start, so sync_impact meets beats under a
  // shown moment (the random draws rarely put the two together); fixed numbers, no draw from the random stream
  if (MUSICFIT_OPS_BUILT) {
    const [v, m] = Object.keys(doc.assets) as [string, string];
    doc = applyTransaction(doc, [{ op: 'add_clip', args: { assetId: m, start: f(0), withLinkedAudio: false } }, { op: 'add_clip', args: { assetId: v, start: f(0), sourceIn: f(30), duration: f(90), withLinkedAudio: false } }], ctx()).doc;
  }
  // Every sixth step draws among the operations no earlier step of the run has seen accepted (the menu grows with every
  // feature, so plain draws can miss one by chance after an unrelated row changes the stream); every other step draws as before.
  const gen = (step: number) => { const f = step % 6 === 5 ? focus() : []; return f.length ? fz.genFocused(doc, f) : fz.gen(doc); };

  const stats = { accepted: 0, refused: 0, byOp: {} as Record<string, [number, number]> };
  for (let step = 0; step < STEPS; step++) {
    const call = gen(step);
    const where = `seed ${seed} (${rate.num}/${rate.den}) step ${step}: ${JSON.stringify(call).slice(0, 300)}`;
    const before = doc;
    const beforeJson = JSON.stringify(doc);
    const tally = (stats.byOp[call.op] ??= [0, 0]);
    let next: ProjectDocument;
    try {
      next = applyTransaction(doc, [call], ctx()).doc;
    } catch (e) {
      if (!(e instanceof OpError)) throw new Error(`${where}\n  threw something that is not a typed refusal: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
      if (JSON.stringify(doc) !== beforeJson) throw new Error(`${where}\n  a refused operation changed the document`);
      stats.refused++; tally[1]++;
      continue;
    }
    stats.accepted++; tally[0]++;
    if (JSON.stringify(before) !== beforeJson) throw new Error(`${where}\n  the operation mutated its input document`);
    const issues = validateProject(next);
    if (issues.length) throw new Error(`${where}\n  accepted, but the document is invalid: ${JSON.stringify(issues.slice(0, 3))}`);
    const parsed = ProjectSchema.safeParse(next);
    if (!parsed.success) throw new Error(`${where}\n  accepted, but the document fails the schema: ${JSON.stringify(parsed.error.issues.slice(0, 2))}`);
    try {
      const total = T.frameIndexAt(timeline(next)!.duration, rate);
      for (const i of [0, int(Math.max(1, total)), Math.max(0, total - 1)]) evaluate(next, f(i));
      const plan = audioPlan(next);
      for (const c of plan.clips) {
        if (!(c.length > 0) || !Number.isFinite(c.gain) || !(c.speed > 0)) throw new Error(`audio plan clip ${c.clipId} has length ${c.length}, gain ${c.gain}, speed ${c.speed}`);
        for (const env of [c.fade, c.duck, c.vol ?? []]) for (let k = 1; k < env.length; k++) if (env[k]!.s < env[k - 1]!.s || !Number.isFinite(env[k]!.g)) throw new Error(`audio plan clip ${c.clipId} has a non-monotonic or non-finite envelope`);
      }
      summarize(next);
      for (const v of Object.keys(next.variants ?? {})) { const pv = projectVariant(next, v); const vi = validateProject(pv); if (vi.length) throw new Error(`format ${v} projects to an invalid document: ${JSON.stringify(vi.slice(0, 2))}`); evaluate(pv, f(0)); }
    } catch (e) { throw new Error(`${where}\n  accepted, but the document cannot be used: ${String((e as Error)?.stack ?? e).slice(0, 700)}`); }
    // undo path: the step's entity changes, applied backwards, restore the previous document
    const changes = diffEntities(before, next);
    const back = structuredClone(next);
    try { restoreEntities(back, changes.map((c) => ({ id: c.id, state: c.before }))); } catch (e) { throw new Error(`${where}\n  the step could not be undone: ${String(e).slice(0, 300)}`); }
    if (creativeProjection(back) !== creativeProjection(before)) throw new Error(`${where}\n  undoing the step does not restore the previous document (entities changed: ${changes.map((c) => c.id).slice(0, 8).join(', ')})`);
    doc = next;
  }
  return stats;
}

describe('fuzz: all editing operations, five frame rates', () => {
  const total = { accepted: 0, refused: 0, byOp: {} as Record<string, [number, number]> };
  for (let seed = 1; seed <= SEEDS; seed++) {
    it(`seed ${seed}`, () => {
      const s = run(seed, () => Object.entries(total.byOp).filter(([, [a]]) => a === 0).map(([k]) => k));
      total.accepted += s.accepted; total.refused += s.refused;
      for (const [k, [a, r]] of Object.entries(s.byOp)) { const t = (total.byOp[k] ??= [0, 0]); t[0] += a; t[1] += r; }
    });
  }
  it('the fuzz exercised every operation it knows, and each was accepted at least once', () => {
    const never = Object.entries(total.byOp).filter(([, [a]]) => a === 0).map(([k]) => k);
    console.log(`fuzz totals: ${total.accepted} accepted, ${total.refused} refused over ${SEEDS} seeds × ${STEPS} steps; never accepted: ${never.join(', ') || 'none'}`);
    console.log(`fuzz per operation (accepted/attempted): ${Object.entries(total.byOp).sort((x, y) => x[1][0] / (x[1][0] + x[1][1]) - y[1][0] / (y[1][0] + y[1][1])).map(([k, [ok, no]]) => `${k} ${ok}/${ok + no}`).join(', ')}`);
    expect(Object.keys(total.byOp).length).toBeGreaterThanOrEqual(40);
    if (SEEDS >= 40) expect(never).toEqual([]);
  });
});
