/**
 * closedGapOnly (templateOps.ts; the family film and the beat montage, ADR-0026): a gone clip of the run was deleted with its gap
 * closed (Delete) or kept (Shift+Delete), and the document does not say which. One reading per track is chosen, the one most of
 * the track's clips agree with, and only the clips that moved by exactly that reading's amount are "moved by a delete".
 * The run is a plain apply_template with recordRanges: pictures in a row on one track, lengths in frames.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, closedGapOnly, createProject, findClip, MAX_GAP_AMOUNTS, type ApplyTemplateArgs, type ApplyTemplateOutput, type OpCall, type ProjectDocument, type TemplateStep } from './index.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `cg${n++}_`, actor: 'test', allowInternal: true }).doc;
const picture = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-25T00:00:00Z', importedBy: 'test' } };

/** A run of pictures p0, p1, … of the given lengths (frames), one after another from frame 0 on one track. */
function row(lengths: readonly number[]) {
  let at = 0;
  const ops: TemplateStep[] = lengths.map((len, i) => { const step = { op: 'add_clip', args: { assetId: { $asset: 'pic' }, start: f(at), duration: f(len), ...(i ? { trackId: { $ref: 'p0', out: 'trackId' } } : {}) }, bind: `p${i}` }; at += len; return step; });
  const slots: ApplyTemplateArgs['slots'] = lengths.map((_, i) => ({ key: `p${i}`, kind: 'picture' as const, clipId: { $ref: `p${i}` } }));
  const r = applyTransaction(createProject({ id: 'prj_cg', name: 'CG', width: 640, height: 360, frameRate: R }), [{ op: 'apply_template', args: { templateId: 'tpl.row', templateVersion: 1, params: {}, steps: ['p'], recordRanges: true, assets: [{ key: 'pic', asset: picture }], ops, slots } }], { idSeed: `cg${n++}_`, actor: 'test', allowInternal: true });
  const out = r.results[0]!.output as unknown as ApplyTemplateOutput;
  const id = (i: number) => out.slots.find((s) => s.key === `p${i}`)!.clipId;
  /** The clips named, as their numbers. */
  const named = (doc: ProjectDocument) => closedGapOnly(doc, doc.recipeRuns[out.runId]!, out.createdIds.filter((x) => !!findClip(doc, x))).map((x) => lengths.findIndex((_, i) => id(i) === x)).sort((a, b) => a - b);
  const startOf = (doc: ProjectDocument, i: number) => T.nearestFrameIndex(findClip(doc, id(i))!.clip.start, R);
  return { doc: r.doc, id, named, startOf };
}
const keepGap = (id: string): OpCall => ({ op: 'delete_clip', args: { clipId: id } });
const closeGap = (id: string): OpCall => ({ op: 'ripple_delete_clips', args: { clipIds: [id] } });
const drag = (id: string, to: number): OpCall => ({ op: 'move_clip', args: { clipId: id, start: f(to) } });

describe('closedGapOnly: each gone clip closed its gap or kept it', () => {
  it('Shift+Delete then Delete, and Delete then Shift+Delete, before the same clips: they moved by the one closed length and are named', () => {
    const a = row([30, 30, 30, 30, 30]);
    const keptThenClosed = tx(a.doc, [keepGap(a.id(0)), closeGap(a.id(1))]);
    expect([2, 3, 4].map((i) => a.startOf(keptThenClosed, i))).toEqual([30, 60, 90]); // moved by one length, two gone before them
    expect(a.named(keptThenClosed)).toEqual([2, 3, 4]);
    const closedThenKept = tx(a.doc, [closeGap(a.id(0)), keepGap(a.id(1))]);
    expect([2, 3, 4].map((i) => a.startOf(closedThenKept, i))).toEqual([30, 60, 90]);
    expect(a.named(closedThenKept)).toEqual([2, 3, 4]);
    // the clip between a kept gap and a closed one did not move and is not named; the ones after the closed gap are
    const between = tx(a.doc, [keepGap(a.id(1)), closeGap(a.id(3))]);
    expect([a.startOf(between, 2), a.startOf(between, 4), a.named(between)]).toEqual([60, 90, [4]]);
    // only kept gaps: nothing moved, nothing named
    expect(a.named(tx(a.doc, [keepGap(a.id(0)), keepGap(a.id(2))]))).toEqual([]);
  });

  it('gone clips of different lengths: the clips after them are named whichever of them closed its gap (exact rational sums)', () => {
    const a = row([20, 30, 50, 40, 40]);
    for (const [closed, shift] of [[[0], 20], [[1], 30], [[2], 50], [[0, 1], 50], [[0, 2], 70], [[1, 2], 80], [[0, 1, 2], 100]] as const) {
      // gaps kept first (nothing moves), then the closing deletes
      const doc = tx(a.doc, [...[0, 1, 2].filter((i) => !closed.includes(i as never)).map((i) => keepGap(a.id(i))), ...closed.map((i) => closeGap(a.id(i)))]);
      expect([a.startOf(doc, 3), a.named(doc)], `closed ${closed.join('+')}`).toEqual([100 - shift, [3, 4]]);
    }
  });

  it('a hand drag after a delete is still kept: by an amount no reading gives, and by one the rest of the track contradicts', () => {
    const a = row([30, 30, 30, 30, 30]);
    // Delete closes the first gap, then the fourth clip is dragged on by hand: not named; the clips the delete moved still are
    const draggedOn = tx(a.doc, [closeGap(a.id(0)), drag(a.id(4), 135)]);
    expect(a.named(draggedOn)).toEqual([1, 2, 3]);
    // Shift+Delete keeps the gap, then the next clip is dragged into it by exactly the deleted length (it snaps there): the
    // clips after it did not move, so the gap was kept and the drag is a drag
    const intoGap = tx(a.doc, [keepGap(a.id(0)), drag(a.id(1), 0)]);
    expect([a.startOf(intoGap, 1), a.named(intoGap)]).toEqual([0, []]);
    // the same with a real gap-closing delete further on: the clip that delete moved is named, the dragged one is not (the
    // untouched clip beside it says the first gap was kept)
    const both = tx(a.doc, [keepGap(a.id(0)), closeGap(a.id(3)), drag(a.id(1), 0)]);
    expect([a.startOf(both, 2), a.startOf(both, 4), a.named(both)]).toEqual([60, 90, [4]]);
    // one clip against one clip is a doubt, and in doubt the moved clip stays kept
    const b = row([30, 30, 30]);
    expect(b.named(tx(b.doc, [keepGap(b.id(0)), drag(b.id(1), 0)]))).toEqual([]);
  });

  it('what it cannot tell (stated in the rule): the last clip pulled by hand into the gap a Shift+Delete left is the document a Delete leaves, and is named', () => {
    const a = row([30, 30, 30]);
    const pulled = tx(a.doc, [keepGap(a.id(1)), drag(a.id(2), 30)]);
    const deleted = tx(a.doc, [closeGap(a.id(1))]);
    expect(JSON.stringify(pulled.sequences)).toBe(JSON.stringify(deleted.sequences));
    expect([a.named(pulled), a.named(deleted)]).toEqual([[2], [2]]);
  });

  it(`follows at most ${MAX_GAP_AMOUNTS} amounts per track; beyond that the track is judged by the full sum (every gone clip counted as closed)`, () => {
    // lengths 1, 2, 4, … frames: every subset of the gone clips gives a different amount
    const lengths = (gone: number) => [...Array.from({ length: gone }, (_, i) => 2 ** i), 30];
    // 12 gone clips: 4096 amounts, inside the bound: one kept gap among closed ones is told
    const a = row(lengths(12));
    const mixed12 = tx(a.doc, [keepGap(a.id(3)), ...Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== 3).map((i) => closeGap(a.id(i)))]);
    expect([a.startOf(mixed12, 12), a.named(mixed12)]).toEqual([8, [12]]);
    // 13 gone clips: 8192 amounts, beyond the bound: all gaps closed is still told (the full sum) …
    const b = row(lengths(13));
    const all13 = tx(b.doc, Array.from({ length: 13 }, (_, i) => closeGap(b.id(i))));
    expect([b.startOf(all13, 13), b.named(all13)]).toEqual([0, [13]]);
    // … and a kept gap among them is not: the clip stays kept by hand, the answer from before this rule
    const mixed13 = tx(b.doc, [keepGap(b.id(3)), ...Array.from({ length: 13 }, (_, i) => i).filter((i) => i !== 3).map((i) => closeGap(b.id(i)))]);
    expect([b.startOf(mixed13, 13), b.named(mixed13)]).toEqual([8, []]);
  });
});
