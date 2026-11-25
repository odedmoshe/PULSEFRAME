/**
 * The credits of a project's sequence (wave 7 library track): GET /api/v1/projects/:id/credits and MCP get_credits answer exactly
 * this, and the export job's output.licence and its <name>.credits.txt sidecar are built from the same core collectCredits over the
 * job's immutable snapshot. WORKER B builds it: read the document through the store as the credential may read it
 * (reader-document), run core collectCredits, answer CreditsView with descriptionText in `lang` (default he). Until then: 501.
 */
import type { CreditsView } from '@pulseframe/core';
import type { Principal } from '../auth.ts';
import type { Store } from '../store.ts';
import { libraryError } from './contract.ts';

export function creditsFor(store: Store, principal: Principal, projectId: string, q: { sequenceId?: string | undefined; lang?: 'he' | 'en' | undefined }): CreditsView {
  void principal; void q;
  store.getProject(projectId); // 404 project_not_found first, as every project route
  throw libraryError('notBuilt');
}
