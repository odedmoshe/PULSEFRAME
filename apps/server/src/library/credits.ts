/**
 * The credits of a project's sequence (wave 7 library track): GET /api/v1/projects/:id/credits and MCP get_credits answer exactly
 * this, and the export job's output.licence and its <jobId>.credits.txt sidecar are built from the same core collectCredits over the
 * job's immutable snapshot (export.ts). The document is read through the store as the credential may read it (reader-document;
 * store.getProject answers 404 project_not_found first, as every project route), then core collectCredits answers CreditsView with
 * descriptionText in `lang` (default he). Read-only; nothing is stored.
 */
import { collectCredits, creditsView, type CreditsView } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import { ApiError, type Store } from '../store.ts';

export function creditsFor(store: Store, principal: Principal, projectId: string, q: { sequenceId?: string | undefined; lang?: 'he' | 'en' | undefined }): CreditsView {
  void principal; // the store reads the document as the calling credential may (request context)
  const { doc } = store.getProject(projectId);
  const sequenceId = q.sequenceId ?? doc.mainSequenceId;
  if (!Object.hasOwn(doc.sequences, sequenceId)) throw new ApiError(404, 'not_found', `sequence ${sequenceId.slice(0, 64)} not found`, { sequenceId: sequenceId.slice(0, 64) }, 'list_sequences lists the sequences of the project.');
  return creditsView(collectCredits(doc, { sequenceId }), q.lang ?? 'he');
}
