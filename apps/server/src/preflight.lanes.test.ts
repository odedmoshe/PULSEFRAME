/**
 * Preflight warns when some frames need more video pictures decoded at once than the renderer opens decoders for
 * (decode_budget, ADR-0011): time effects such as echo decode each earlier picture separately.
 * The exporter is a stub (labelled as such): only its plan is read here, and it reports nothing.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, type OpCall, type ProjectDocument } from '@pulseframe/core';
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
/** Echo-5 video clips starting at the given frames, 40 frames long, each on the first free video track. */
function clips(starts: number[]) {
  let r = tx(createProject({ id: 'prj_pl', name: 'PL' }), [{ op: 'import_asset', args: { asset } }], true);
  const assetId = r.results[0]!.output!.assetId as string;
  let doc = r.doc;
  const ids: string[] = [];
  for (const start of starts) {
    r = tx(doc, [{ op: 'add_clip', args: { assetId, start: f(start), duration: f(40) } }]);
    const clipId = r.results[0]!.output!.clipId as string;
    ids.push(clipId);
    doc = tx(r.doc, [{ op: 'add_effect', args: { clipId, type: 'time.echo', params: { count: 5 } } }]).doc;
  }
  return { doc, ids };
}

describe('preflight: video decoders needed at once', () => {
  it('three overlapping echo-5 clips (15 pictures) are named, with the frames where they overlap', () => {
    const { doc, ids } = clips([0, 10, 20]);
    const issue = preflight(stubExporter, doc, 1).issues.find((i) => i.code === 'decode_budget');
    expect(issue).toMatchObject({ severity: 'warning', range: { startFrame: 20, endFrame: 40 } });
    expect(issue!.ids.sort()).toEqual([...ids].sort());
    expect(issue!.message).toMatch(/15 video pictures decoded at once, more than the 12/);
  });
  it('a still image drawn in that stretch decodes nothing and is not named', () => {
    const { doc, ids } = clips([0, 10, 20]);
    const still = { kind: 'image' as const, name: 'p.png', contentHash: `sha256:${'a'.repeat(64)}`, byteSize: 1, container: 'png', mimeType: 'image/png', duration: T.ZERO, image: { width: 640, height: 360, codec: 'png', hasAlpha: false }, provenance: asset.provenance };
    let r = tx(doc, [{ op: 'import_asset', args: { asset: still } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId as string, start: f(25), duration: f(10) } }]);
    const issue = preflight(stubExporter, r.doc, 1).issues.find((i) => i.code === 'decode_budget');
    expect(issue!.ids.sort()).toEqual([...ids].sort());
  });
  it('two of them (10 pictures) fit', () => {
    expect(preflight(stubExporter, clips([0, 10]).doc, 1).issues.some((i) => i.code === 'decode_budget')).toBe(false);
  });
});
