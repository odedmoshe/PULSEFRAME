/**
 * use_source_item (internal, v1; wave 8 `sources`; sourcesContract.ts). Registered on import (index.ts). Issued by the server's
 * source_fetch job after the bytes were downloaded, stored by the import queue and checked (never from caller-supplied bytes),
 * committed as the credential that asked: one transaction, generic undo.
 *
 * The body W1 builds (plan §3.2 with verify C5, C14):
 * - refuse notSourceAsset without provenance.source; hashMismatch when origin 'upload' and 'sha256:'+sha256 is not
 *   conform?.originalContentHash ?? contentHash; the first sourceRecordProblems entry (creditMissing / recordWeaker). Nothing else:
 *   a licence finding is a warning in output.warnings (sourceDuties), never a refusal;
 * - the same bytes already present (contentHash, origin 'upload'): a LIBRARY copy keeps its library record and gets nothing
 *   (libraryKept, C5.1); a copy whose source record has the same sourceRecordKey → deduplicated, no change; otherwise the record is
 *   attached (an upload record gives way, as use_library_item does) → recordAttached; none → add the asset.
 * (Before W1 it refused with SOURCE_OP_REFUSALS.notBuilt; the row stays for older servers' wording.)
 */
import { z } from 'zod';
import { defineOp, OpError, type OpContext, type OpErrorCode } from './ops.ts';
import { AssetSchema, type Asset, type ProjectDocument } from './schema.ts';
import { SOURCE_OP, SOURCE_OP_REFUSALS, sourceRecordKey, UseSourceItemArgsSchema, type SourceRow, type UseSourceItemArgs, type UseSourceItemOutput } from './sourcesContract.ts';
import { sourceDuties, sourceRecordProblems } from './sourceDuties.ts';

/** A refusal of use_source_item: the row's code, its sentence and next step; details.why names the case. */
export function sourceRefusal<K extends keyof typeof SOURCE_OP_REFUSALS>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof SOURCE_OP_REFUSALS)[K]['message']>): OpError {
  const r = SOURCE_OP_REFUSALS[key] as SourceRow<unknown[]>;
  return new OpError(r.code as OpErrorCode, r.message(...values), { ...details, why: r.why }, r.hint);
}

const AssetArgSchema = AssetSchema.omit({ id: true });
/** use_source_item's body (see the header). Refuses data facts only; a licence finding is a warning in output.warnings. */
function useSourceItem(d: ProjectDocument, a: UseSourceItemArgs, ctx: OpContext) {
  const raw = a.asset as { provenance?: { source?: unknown } };
  if (!raw || typeof raw !== 'object' || !raw.provenance || typeof raw.provenance !== 'object' || raw.provenance.source === undefined) throw sourceRefusal('notSourceAsset', {});
  const parsed = AssetArgSchema.safeParse(a.asset);
  if (!parsed.success) throw new OpError('invalid_args', `invalid arguments for ${SOURCE_OP}: ${z.prettifyError(parsed.error)}`, { issues: parsed.error.issues });
  const asset = parsed.data;
  const record = asset.provenance.source!;
  const details = { provider: record.provider, itemId: record.itemId, licenceId: record.licence.id };
  // the bytes exactly as fetched: the original's hash (a conformed copy keeps it in conform.originalContentHash), for a fetched file
  if (asset.provenance.origin === 'upload' && `sha256:${record.sha256}` !== (asset.conform?.originalContentHash ?? asset.contentHash)) throw sourceRefusal('hashMismatch', { ...details, sha256: record.sha256, contentHash: asset.contentHash });
  const problem = sourceRecordProblems(record)[0];
  if (problem) {
    if (problem.key === 'recordWeaker') throw sourceRefusal('recordWeaker', { ...details, missing: problem.what }, problem.what);
    throw sourceRefusal('creditMissing', details);
  }
  const title = record.title || asset.name;
  const warnings = sourceDuties(record, title);
  const out = (o: Omit<UseSourceItemOutput, 'warnings'>, w = warnings): Record<string, unknown> => ({ ...o, warnings: w.map((x) => ({ ...x, assetId: o.assetId })) });
  const existing = Object.values(d.assets).find((x): x is Asset => x.contentHash === asset.contentHash && x.provenance.origin === 'upload');
  if (!existing) {
    const id = ctx.newId('ast');
    d.assets[id] = { id, ...asset };
    return { affectedIds: [id], summary: `Added "${title}" from ${record.provider} (${record.licence.id})${warnings.length ? `; ${warnings.length} licence or term note(s)` : ''}`.slice(0, 200), output: out({ assetId: id, deduplicated: false, recordAttached: false, libraryKept: false }) };
  }
  // C5.1: a library copy keeps its library record; the source record is not attached (one file, one record)
  if (existing.provenance.library) return { affectedIds: [], summary: `"${existing.name}" is already in the project as a library copy; it keeps its library record (${existing.provenance.library.licence.id})`.slice(0, 200), output: out({ assetId: existing.id, deduplicated: true, recordAttached: false, libraryKept: true }, []) };
  const before = existing.provenance.source;
  if (before && sourceRecordKey(before) === sourceRecordKey(record)) return { affectedIds: [], summary: `"${existing.name}" is already in the project with this source record`.slice(0, 200), output: out({ assetId: existing.id, deduplicated: true, recordAttached: false, libraryKept: false }) };
  const { upload, ...provenance } = existing.provenance;
  existing.provenance = { ...provenance, source: record };
  const was = before ? 'its earlier source record was replaced by the one from this fetch' : upload ? 'its upload record was replaced by the source record' : 'it now carries its source record';
  return { affectedIds: [existing.id], summary: `"${existing.name}" was already in the project; ${was} (${record.licence.id})`.slice(0, 200), output: out({ assetId: existing.id, deduplicated: true, recordAttached: true, libraryKept: false }) };
}

defineOp({
  name: SOURCE_OP,
  version: 1,
  internal: true,
  description: 'Add a file fetched from a stock source or a direct link to the project library with its source record (provenance.source: service, item, licence verbatim, credit, fetch time, hash), deduplicated by content; an earlier copy of the same bytes gets the record, a library copy keeps its own. Licence findings are warnings in the output, never refusals. Issued only by the server after it stored and checked the bytes (POST …/sources/import, …/sources/link).',
  args: UseSourceItemArgsSchema,
  apply: useSourceItem,
});
