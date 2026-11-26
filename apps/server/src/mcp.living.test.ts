/**
 * get_summary and describe_moment name each living picture in one line (wave 8 living; mcp.ts livingSummary, withLivingLines; core
 * livingSummaryLine). The functions the two tools call, on a document built through the operations; synthetic files only.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, summarize, type ClipDepth, type OpCall, type ProjectDocument } from '@pulseframe/core';
import { describeMoment } from '@pulseframe/engine';
import { livingSummary, withLivingLines } from './mcp.ts';

const R = { num: 30, den: 1 };
const f = (k: number) => T.frameTime(k, R);
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[]) => applyTransaction(doc, ops, { idSeed: `mcl${n++}_`, actor: 'test', allowInternal: true });
const prov = { origin: 'fixture' as const, importedAt: '2026-11-26T00:00:00Z', importedBy: 'test' };
const photo = (hex: string) => ({ kind: 'image' as const, name: `${hex}.png`, contentHash: `sha256:${hex.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: prov });
const STROKE = { layer: 'near' as const, size: 100, pts: [500, 600] };
const DEPTH: ClipDepth = { v: 1, base: { kind: 'ramp', horizon: 450 }, strokes: [STROKE, STROKE, STROKE] };

describe('living lines for agents', () => {
  it('get_summary: livingPictures only when there is one; describe_moment: `living` on that layer only', () => {
    let r = tx(createProject({ id: 'prj_mcl', name: 'P', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: photo('a') } }, { op: 'import_asset', args: { asset: photo('b') } }]);
    const [a, b] = r.results.map((x) => x.output!.assetId as string);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: a!, start: f(0), duration: f(150) } }, { op: 'add_clip', args: { assetId: b!, start: f(150), duration: f(90) } }]);
    const [one, two] = r.results.map((x) => x.output!.clipId as string);
    expect(livingSummary(r.doc)).toEqual({});
    const before = summarize(r.doc);
    const d = tx(r.doc, [{ op: 'set_living_picture', args: { clipId: one!, depth: DEPTH } }]).doc;
    expect(livingSummary(d)).toEqual({ livingPictures: [{ clipId: one, line: 'living picture: push, amount 0.5; depth: drawn (3 strokes, horizon 450/1000)' }] });
    // core summarize carries the lines (get_summary, REST /summary and the summary resource share it); without one it is unchanged
    expect(summarize(d).livingPictures).toEqual(livingSummary(d).livingPictures);
    expect(Object.keys(summarize(d))).toEqual([...Object.keys(before), 'livingPictures']);
    expect('livingPictures' in before).toBe(false);
    const at10 = withLivingLines(d, describeMoment(d, f(10)));
    expect(at10.layers.map((l) => (l as { living?: string }).living)).toEqual(['living picture: push, amount 0.5; depth: drawn (3 strokes, horizon 450/1000)']);
    const at200 = withLivingLines(d, describeMoment(d, f(200)));
    expect(at200.layers.map((l) => [(l as { clipId?: string }).clipId, 'living' in l])).toEqual([[two, false]]);
  });
});
