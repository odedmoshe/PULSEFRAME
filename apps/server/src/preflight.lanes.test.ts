/**
 * Preflight warns when some frames need more video pictures decoded at once than the renderer opens decoders for
 * (decode_budget, ADR-0011): time effects such as echo decode each earlier picture separately, and a picture that several
 * layers or taps of a frame show is decoded once, so only the frames that really need more are named.
 * The exporter is a stub (labelled as such): only its plan is read here, and it reports nothing.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { decodeOverBudget, maxDecodeLanes } from '@pulseframe/engine';
import type { Exporter } from './export.ts';
import { preflight } from './preflight.ts';

const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pl${n++}_`, actor: 'test', allowInternal });
const stubExporter = { plan: () => ({ blockers: [], warnings: [] }) } as unknown as Exporter;
const asset = {
  kind: 'video' as const, name: 'v.mp4', contentHash: `sha256:${'9'.repeat(64)}`, byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(8, 1),
  video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 240 }, provenance: { origin: 'fixture' as const, importedAt: '2026-11-17T00:00:00Z', importedBy: 'test' },
};
/** Echo video clips (count 5, delay 3 unless given) starting at the given frames, 40 frames long unless given, each on the first free video track. */
function clips(starts: number[], each: (k: number) => { sourceIn?: number; duration?: number; speed?: number; delay?: number } = () => ({})) {
  let r = tx(createProject({ id: 'prj_pl', name: 'PL' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  let doc = r.doc;
  const ids: string[] = [];
  starts.forEach((start, k) => {
    const o = each(k);
    r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(o.duration ?? 40), ...(o.sourceIn ? { sourceIn: f(o.sourceIn) } : {}) } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    ids.push(clipId);
    doc = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'time.echo', params: { count: 5, ...(o.delay ? { delay: o.delay } : {}) } } }, ...(o.speed ? [{ op: 'set_clip_speed', args: { clipId, speed: o.speed } }] : [])]).doc;
  });
  return { doc, ids };
}
const budgetIssues = (doc: ProjectDocument) => preflight(stubExporter, doc, 1).issues.filter((i) => i.code === 'decode_budget');

describe('preflight: video decoders needed at once', () => {
  it('three overlapping echo-5 clips: exactly the frames that need more than 12 are named (24–39, up to 15), with the clips', () => {
    const { doc, ids } = clips([0, 10, 20]);
    // all three play from frame 20, but until frame 24 the newest one's taps still share pictures (held at its start), so 20–23 fit
    expect(decodeOverBudget(doc, 12).map((s) => [s.fromFrame, s.toFrame])).toEqual([[24, 40]]);
    const [issue, ...more] = budgetIssues(doc);
    expect(more).toEqual([]);
    expect(issue).toMatchObject({ severity: 'warning', range: { startFrame: 24, endFrame: 40 } });
    expect(issue!.ids.sort()).toEqual([...ids].sort());
    expect(issue!.message).toMatch(/^on frames 24–39, more video pictures must be decoded at once than the 12 the renderer can open \(up to 15\); those frames would be refused/);
  });
  it('three echo-5 copies stacked at frame 0 show the same pictures: 7 decoders, no warning (the per-clip bound says 15)', () => {
    const { doc } = clips([0, 0, 0]);
    expect(maxDecodeLanes(doc).lanes).toBe(15);
    expect(budgetIssues(doc)).toEqual([]);
  });
  it('a still image drawn in that stretch decodes nothing and is not named', () => {
    const { doc, ids } = clips([0, 10, 20]);
    const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: asset.provenance };
    let r = tx(doc, [{ op: 'import_asset', args: { asset: still } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(25), duration: f(10) } }]);
    const [issue] = budgetIssues(r.doc);
    expect(issue!.ids.sort()).toEqual([...ids].sort());
  });
  it('two of them (10 pictures) fit', () => {
    expect(budgetIssues(clips([0, 10]).doc)).toEqual([]);
  });
  it('stretches far apart are separate issues; a count that wavers around 12 (slow motion) is one issue saying how many of its frames are refused', () => {
    const far = clips([0, 10, 20, 100, 110, 120]);
    expect(budgetIssues(far.doc).map((i) => i.range)).toEqual([{ startFrame: 24, endFrame: 40 }, { startFrame: 124, endFrame: 140 }]);
    // two echo-5 clips of different source frames (5 + 5) and one at 0.4× speed whose neighbouring taps often share a frame (2 or 3)
    const waver = clips([0, 0, 0], (k) => [{ duration: 120 }, { duration: 120, sourceIn: 120 }, { duration: 40, sourceIn: 200, delay: 1, speed: 0.4 }][k]!);
    const stretches = decodeOverBudget(waver.doc, 12);
    expect(stretches.length).toBeGreaterThan(5);
    const refused = stretches.reduce((k, s) => k + s.toFrame - s.fromFrame, 0);
    const from = stretches[0]!.fromFrame, to = stretches.at(-1)!.toFrame;
    expect(refused).toBeLessThan(to - from);
    const [issue, ...more] = budgetIssues(waver.doc);
    expect(more).toEqual([]);
    expect(issue!.range).toEqual({ startFrame: from, endFrame: to });
    expect(issue!.message).toMatch(new RegExp(`^on ${refused} of the frames ${from}–${to - 1}, more video pictures must be decoded at once than the 12 the renderer can open \\(up to 13\\)`));
    expect(issue!.ids.sort()).toEqual([...waver.ids].sort());
  });
});
