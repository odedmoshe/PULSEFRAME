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
 * Until then it refuses with SOURCE_OP_REFUSALS.notBuilt and changes nothing.
 */
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { SOURCE_OP, SOURCE_OP_REFUSALS, SOURCES_BUILT, UseSourceItemArgsSchema, type SourceRow } from './sourcesContract.ts';

/** A refusal of use_source_item: the row's code, its sentence and next step; details.why names the case. */
export function sourceRefusal<K extends keyof typeof SOURCE_OP_REFUSALS>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof SOURCE_OP_REFUSALS)[K]['message']>): OpError {
  const r = SOURCE_OP_REFUSALS[key] as SourceRow<unknown[]>;
  return new OpError(r.code as OpErrorCode, r.message(...values), { ...details, why: r.why }, r.hint);
}

defineOp({
  name: SOURCE_OP,
  version: 1,
  internal: true,
  description: 'Add a file fetched from a stock source or a direct link to the project library with its source record (provenance.source: service, item, licence verbatim, credit, fetch time, hash), deduplicated by content; an earlier copy of the same bytes gets the record, a library copy keeps its own. Licence findings are warnings in the output, never refusals. Issued only by the server after it stored and checked the bytes (POST …/sources/import, …/sources/link).',
  args: UseSourceItemArgsSchema,
  apply() {
    throw sourceRefusal('notBuilt', { built: SOURCES_BUILT.op });
  },
});
