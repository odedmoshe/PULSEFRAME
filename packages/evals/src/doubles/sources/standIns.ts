/**
 * LABELLED STAND-IN for W1's body of `use_source_item` (core sourceOps.ts), for tests and the proof of W2/W3 while that body is not
 * merged (SOURCES_BUILT.op false). It follows the op's contract in sourceOps.ts' header and nothing more: refuse notSourceAsset,
 * hashMismatch and the first sourceRecordProblems entry; the same bytes as a LIBRARY copy keep their record (libraryKept); the same
 * record (sourceRecordKey) is deduplicated; another copy of the bytes gets the record (an upload record gives way); else the asset
 * is added. `warnings` is always [] here (sourceDuties is W1's). Once SOURCES_BUILT.op is true this installs nothing.
 */
import { listOps, SOURCE_OP, SOURCES_BUILT, sourceRecordKey, sourceRecordProblems, sourceRefusal, type Asset, type ProjectDocument, type SourceRecord } from '@pulseframe/core';

export const USE_SOURCE_ITEM_STAND_IN = 'stand-in: use_source_item (W1 body not merged; tests and proof only)';

/** Installs the stand-in on the registered op; returns the function that puts the original back. */
export function installUseSourceItemStandIn(): () => void {
  if (SOURCES_BUILT.op) return () => {};
  const def = listOps().find((d) => d.name === SOURCE_OP);
  if (!def) throw new Error('use_source_item is not registered');
  const original = def.apply;
  def.apply = (d: ProjectDocument, a: { asset: Record<string, unknown> }, ctx) => {
    const asset = a.asset as unknown as Omit<Asset, 'id'>;
    const record = asset.provenance?.source as SourceRecord | undefined;
    if (!record) throw sourceRefusal('notSourceAsset', {});
    if (asset.provenance.origin === 'upload' && `sha256:${record.sha256}` !== (asset.conform?.originalContentHash ?? asset.contentHash)) throw sourceRefusal('hashMismatch', {});
    const problem = sourceRecordProblems(record)[0];
    if (problem) { if (problem.key === 'recordWeaker') throw sourceRefusal('recordWeaker', { missing: problem.what }, problem.what); throw sourceRefusal('creditMissing', {}); }
    const existing = Object.values(d.assets).find((x) => x.contentHash === asset.contentHash && x.provenance.origin === 'upload');
    const out = (assetId: string, deduplicated: boolean, recordAttached: boolean, libraryKept: boolean) => ({ assetId, deduplicated, recordAttached, libraryKept, warnings: [] });
    if (!existing) {
      const id = ctx.newId('ast');
      d.assets[id] = { id, ...asset } as Asset;
      return { affectedIds: [id], summary: `Added "${record.title || asset.name}" from ${record.provider} (${record.licence.id}) [${USE_SOURCE_ITEM_STAND_IN}]`, output: out(id, false, false, false) };
    }
    if (existing.provenance.library) return { affectedIds: [], summary: `"${existing.name}" is a library copy and keeps its record`, output: out(existing.id, true, false, true) };
    if (existing.provenance.source && sourceRecordKey(existing.provenance.source) === sourceRecordKey(record)) return { affectedIds: [], summary: `"${existing.name}" is already in the project with this source record`, output: out(existing.id, true, false, false) };
    const { upload: _u, ...provenance } = existing.provenance;
    existing.provenance = { ...provenance, source: record } as Asset['provenance'];
    return { affectedIds: [existing.id], summary: `"${existing.name}" was already in the project; it now carries its source record`, output: out(existing.id, true, true, false) };
  };
  return () => { def.apply = original; };
}
