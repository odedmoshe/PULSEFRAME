/**
 * Preflight's multicam_out_of_sync (ADR-0020 plan §7): a program segment slipped off the master sound warns (never blocks) with
 * a slip fix that works; an untouched program gives no warning. The exporter is a stub (labelled as such): only its plan is
 * read, and it reports nothing. The segment cases need the multicam operations and maths (W1) and run once they are built.
 */
import { describe, expect, it } from 'vitest';
import * as T from '@pulseframe/time';
import { applyTransaction, createProject, MULTICAM_OPS_BUILT, MULTICAM_PREFLIGHT_CODE, type Asset, type OpCall, type ProjectDocument } from '@pulseframe/core';
import type { Exporter } from './export.ts';
import { multicamIssues, preflight } from './preflight.ts';

const stubExporter = { plan: () => ({ blockers: [], warnings: [] }) } as unknown as Exporter;
const R = { num: 30, den: 1 };
const f = (n: number) => T.frameTime(n, R);
const prov = { origin: 'fixture' as const, importedAt: '2026-11-18T00:00:00Z', importedBy: 'test' };
/** A content hash for a one-letter name: the import_asset schema wants 64 lowercase hex digits. */
const hashOf = (c: string) => `sha256:${c.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`;
const cam = (c: string): Omit<Asset, 'id'> => ({ kind: 'video', name: `${c}.mp4`, contentHash: hashOf(c), byteSize: 1, container: 'mp4', mimeType: 'video/mp4', duration: T.rt(60, 1), video: { width: 640, height: 360, frameRate: R, codec: 'h264', rotation: 0, frameCount: 1800 }, provenance: prov });
const rec = (c: string): Omit<Asset, 'id'> => ({ kind: 'audio', name: `${c}.wav`, contentHash: hashOf(c), byteSize: 1, container: 'wav', mimeType: 'audio/wav', duration: T.rt(62, 1), audio: { sampleRate: 48000, channels: 1, codec: 'pcm_s16le' }, provenance: prov });
let n = 0;
const tx = (doc: ProjectDocument, ops: OpCall[], allowInternal = false) => applyTransaction(doc, ops, { idSeed: `pfm${n++}_`, actor: 'test', allowInternal });
const mc = (doc: ProjectDocument) => preflight(stubExporter, doc, 1).issues.filter((i) => i.code === MULTICAM_PREFLIGHT_CODE);

describe('preflight: multicam segments out of step with the master sound', () => {
  it('a project without multicam groups gets no multicam issue', () => {
    let r = tx(createProject({ id: 'prj_pf', name: 'p', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: cam('a') } }], true);
    r = tx(r.doc, [{ op: 'add_clip', args: { assetId: r.results[0]!.output!.assetId, start: f(0), duration: f(90) } }]);
    expect(mc(r.doc)).toEqual([]);
    expect(multicamIssues(r.doc, r.doc.mainSequenceId)).toEqual([]);
    expect(preflight(stubExporter, r.doc, 1).scope).toMatch(/multicam segments out of step/);
  });
  it.skipIf(!MULTICAM_OPS_BUILT)('a slip of 3 frames warns at about 100 ms (30 fps) and its fix brings the segment back; an untouched program has no warning', () => {
    let r = tx(createProject({ id: 'prj_pf2', name: 'p', width: 640, height: 360, frameRate: R }), [{ op: 'import_asset', args: { asset: rec('m') } }, { op: 'import_asset', args: { asset: cam('w') } }], true);
    const [MIC, W] = r.results.map((x) => x.output!.assetId as string) as [string, string];
    r = tx(r.doc, [{ op: 'create_multicam', args: { name: 'g', angles: [{ kind: 'sound', assetIds: [MIC] }, { assetIds: [W] }] } }]);
    const { groupId, angleIds } = r.results[0]!.output as { groupId: string; angleIds: string[] };
    r = tx(r.doc, [{ op: 'set_multicam_sync', args: { groupId, angleId: angleIds[1]!, pieceIndex: 0, offset: T.rt(1, 1) } }]);
    r = tx(r.doc, [{ op: 'place_multicam', args: { groupId, at: f(0), angleId: angleIds[1]!, range: { from: T.rt(2, 1), to: T.rt(40, 1) } } }]);
    expect(mc(r.doc)).toEqual([]);
    const seg = (r.results[0]!.output as { createdClipIds: string[] }).createdClipIds.find((id) => r.doc.sequences[r.doc.mainSequenceId]!.tracks.some((t) => t.kind === 'video' && t.clips.some((c) => c.id === id)))!;
    const slipped = tx(r.doc, [{ op: 'slip_clip', args: { clipId: seg, by: f(3), includeLinked: false } }]).doc;
    const issues = mc(slipped);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.ids).toEqual([seg]);
    expect(issues[0]!.message).toMatch(/\b100 ms\b/);
    expect(preflight(stubExporter, slipped, 1).blockers).toBe(0);
    const fixed = tx(slipped, issues[0]!.fix!.ops).doc;
    expect(mc(fixed)).toEqual([]);
  });
});
