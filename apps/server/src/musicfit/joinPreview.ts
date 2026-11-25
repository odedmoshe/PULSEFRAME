/**
 * The four bars around a candidate join, as WAV (wave 7 musicfit; BUILDER A). Called by routes.ts musicJoinPreviewFor after the observe
 * check. Body rule: from and to are JSON rational times that must be bar starts of the song's CURRENT analysis (else 409 fit_stale);
 * rendered by the same splice code that makes the file (splice.ts), in the music queue's preview lane with its cancel rule
 * (music.ts), nothing stored. Until built: 501.
 */
import type { Store } from '../store.ts';
import { musicFitApiError } from './routes.ts';

export async function renderJoinPreview(store: Store, projectId: string, q: { assetId: string; from: string; to: string; startAt?: string }, signal?: AbortSignal): Promise<Buffer> {
  void store; void projectId; void signal;
  throw musicFitApiError('notBuilt', { assetId: q.assetId });
}
