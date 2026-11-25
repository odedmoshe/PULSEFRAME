/**
 * Ripple delete is unchanged by the shared shift (wave 7 craft track, craft-plan.md "Corrected" C2): ripple_trim and
 * ripple_delete_clips share one shift routine (core ops.ts shiftClips), extracted from the body of ripple_delete_clips.
 * ripple-delete.golden.json was RECORDED ON THE TREE BEFORE THE EXTRACTION (commit named in its note): for every document of the
 * seeded v1 fuzz run (createFuzz v1Replay, the corpus keyframe-replay.test.ts pins) it tries ripple_delete_clips on a fixed set of
 * calls — each clip alone, each clip without its linked clips, each pair of neighbours on a track, every clip of a track — and holds
 * the hash of the resulting document with the op output, or the refusal's code, message and hint. This test replays them.
 *
 * Re-record (only after a deliberate change to ripple_delete_clips, never to make the shared shift pass):
 *   PF_RECORD_RIPPLE_GOLDEN=1 pnpm vitest run packages/evals/src/ripple-delete-golden.test.ts
 */
import { createHash } from 'node:crypto';
import * as T from '@pulseframe/time';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTransaction, createProject, OpError, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { createFuzz } from './ops-fuzz.gen.ts';

const SEEDS = 24, STEPS = 90, EVERY = 3;
const GOLDEN = new URL('./ripple-delete.golden.json', import.meta.url);
const RECORD = process.env.PF_RECORD_RIPPLE_GOLDEN === '1';
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 24);

/** The fixed ripple calls tried on one document (deterministic: registry order of sequences, tracks and clips). */
function calls(doc: ProjectDocument): OpCall[] {
  const out: OpCall[] = [];
  for (const seq of Object.values(doc.sequences)) for (const t of seq.tracks) {
    const ids = t.clips.map((c) => c.id);
    for (const id of ids) { out.push({ op: 'ripple_delete_clips', args: { clipIds: [id] } }); out.push({ op: 'ripple_delete_clips', args: { clipIds: [id], includeLinked: false } }); }
    for (let i = 0; i + 1 < ids.length; i++) out.push({ op: 'ripple_delete_clips', args: { clipIds: [ids[i]!, ids[i + 1]!] } });
    if (ids.length > 2) out.push({ op: 'ripple_delete_clips', args: { clipIds: ids } });
  }
  return out;
}

function outcomes(seed: number): string[] {
  const fz = createFuzz(seed, { v1Replay: true });
  let n = 0;
  const ctx = (allowInternal = false) => ({ idSeed: `r${seed}_${n++}_`, actor: 'fuzz', allowInternal });
  let doc = applyTransaction(createProject({ id: 'prj_fuzz', name: 'fuzz', width: 640, height: 360, frameRate: fz.rate }), fz.importOps, ctx(true)).doc;
  doc = applyTransaction(doc, fz.setup(doc), ctx()).doc;
  doc = applyTransaction(doc, fz.aiSetup(doc), ctx(true)).doc;
  { const ops = fz.setupInternal(doc); if (ops.length) doc = applyTransaction(doc, ops, ctx(true)).doc; }
  const rows: string[] = [];
  for (let step = 0; step < STEPS; step++) {
    if (step % EVERY === 0) {
      for (const call of calls(doc)) {
        try {
          const r = applyTransaction(doc, [call], { idSeed: 'rg_', actor: 'fuzz' });
          rows.push(`ok:${hash(r.doc)}:${hash(r.results[0]!.output)}:${r.results[0]!.summary}`);
        } catch (e) {
          if (!(e instanceof OpError)) throw e;
          rows.push(`refused:${e.code}:${e.message}:${e.hint ?? ''}`);
        }
      }
    }
    try { doc = applyTransaction(doc, [fz.gen(doc)], ctx()).doc; } catch (e) { if (!(e instanceof OpError)) throw e; }
  }
  return rows;
}

/**
 * Hand-built documents for the refusals the fuzz corpus rarely reaches (it mostly meets `overlap`): a linked partner on a locked
 * track, linked clips that would move by different amounts, and a J-cut sound that would move before 0. Three picture clips with
 * linked sound (V1 V2 V3 at frames 30..90..150..210 on the video track, S1 S2 S3 under them) after a still at 0..30.
 */
function crafted(): string[] {
  const R = { num: 30, den: 1 };
  const f = (k: number) => T.frameTime(k, R);
  let n = 0;
  const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `rc${n++}_`, actor: 'test', allowInternal });
  const prov = { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' };
  const video = { kind: 'video' as const, name: 'a.mp4', contentHash: `sha256:${'1'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(20, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 600 }, audio: { sampleRate: 48000, channels: 2, codec: 'aac' }, provenance: prov };
  const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'2'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov };
  let r = tx(createProject({ id: 'prj_rc', name: 'RC', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: video } }, { op: 'import_asset', args: { asset: still } }], true);
  const v = r.results[0]!.output!.assetId as string, p = r.results[1]!.output!.assetId as string;
  r = tx(r.doc, [{ op: 'add_clip', args: { assetId: p, start: f(0), duration: f(30) } }, ...[30, 90, 150].map((s) => ({ op: 'add_clip', args: { assetId: v, start: f(s), sourceIn: f(60), duration: f(60) } }))]);
  const P = r.results[0]!.output!.clipId as string;
  const V = [1, 2, 3].map((i) => r.results[i]!.output!.clipId as string), S = [1, 2, 3].map((i) => r.results[i]!.output!.audioClipId as string);
  const base = r.doc;
  const audioTrack = Object.values(base.sequences)[0]!.tracks.find((t) => t.kind === 'audio')!.id;
  const locked = tx(base, [{ op: 'update_track', args: { trackId: audioTrack, locked: true } }]).doc;
  const jcut = tx(base, [{ op: 'trim_clip', args: { clipId: S[0]!, edge: 'start', to: f(0), includeLinked: false } }]).doc;
  const cases: [ProjectDocument, Record<string, unknown>][] = [
    [base, { clipIds: [P] }], [base, { clipIds: [V[0]!] }], [base, { clipIds: [V[0]!], includeLinked: false }], [base, { clipIds: [V[1]!, S[2]!], includeLinked: false }],
    [base, { clipIds: [V[0]!, S[2]!], includeLinked: false }], [base, { clipIds: [S[0]!], includeLinked: false }], [base, { clipIds: [P, V[2]!] }],
    [locked, { clipIds: [P] }], [locked, { clipIds: [V[0]!], includeLinked: false }], [jcut, { clipIds: [P] }], [jcut, { clipIds: [V[0]!] }], [jcut, { clipIds: [V[1]!] }],
  ];
  return cases.map(([doc, args]) => {
    try {
      const out = applyTransaction(doc, [{ op: 'ripple_delete_clips', args }], { idSeed: 'rg_', actor: 'test' });
      return `ok:${hash(out.doc)}:${hash(out.results[0]!.output)}:${out.results[0]!.summary}`;
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      return `refused:${e.code}:${e.message}:${e.hint ?? ''}:${hash(e.details)}`;
    }
  });
}

describe('ripple delete is byte-identical to its recording from before the shared shift', () => {
  it(`${SEEDS} seeds × ${STEPS} steps, every ${EVERY}th document, and the hand-built cases: every ripple_delete_clips outcome as recorded`, () => {
    const runs = Object.fromEntries(Array.from({ length: SEEDS }, (_, i) => [String(i + 1), outcomes(i + 1)]));
    const hand = crafted();
    if (RECORD) writeFileSync(GOLDEN, JSON.stringify({ note: 'ripple-delete-golden.test.ts: per seed, every ripple_delete_clips outcome on the v1 fuzz corpus, and the hand-built refusal cases verbatim; recorded on the tree before shiftClips was extracted (wave 7 craft pre-pass)', crafted: hand, seeds: Object.fromEntries(Object.entries(runs).map(([k, rows]) => [k, rows.map((r) => hash(r))])) }, null, 1) + '\n');
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { crafted: string[]; seeds: Record<string, string[]> };
    expect(hand).toEqual(golden.crafted);
    let ok = 0, refused = 0;
    for (const [seed, rows] of Object.entries(runs)) {
      expect(rows.map((r) => hash(r)), `seed ${seed}`).toEqual(golden.seeds[seed]);
      for (const r of rows) r.startsWith('ok:') ? ok++ : refused++;
    }
    console.log(`ripple delete golden: ${ok} accepted and ${refused} refused fuzz calls and ${hand.length} hand-built cases, each identical to the recording`);
    expect(ok).toBeGreaterThan(1000);
    expect(refused).toBeGreaterThan(50);
    // every refusal the shared shift raises is among the hand-built cases
    for (const re of [/^refused:track_locked:linked clip \S+ is on locked track/, /^refused:incompatible:linked clips \S+ and \S+ would move by different amounts/, /^refused:out_of_bounds:closing the gap would place clip \S+ before 0/])
      expect(hand.some((h) => re.test(h)), String(re)).toBe(true);
  });
});
