/**
 * The four bars around a candidate join, as WAV (wave 7 musicfit; built by builder A). Called by routes.ts musicJoinPreviewFor after
 * the observe check. `from`, `to` and `startAt` are JSON rational times (source clock); from and to must be bar starts of the song's
 * CURRENT analysis (else 409 fit_stale). Rendered by the same splice code that makes the file (splice.ts spliceRange): the samples
 * are the made file's samples from two bar starts before the join to two after it. The decode runs in the one-at-a-time lane of
 * features.ts and stops when the request is aborted; nothing is stored.
 */
import * as T from '@pulseframe/time';
import { ownBeats, RationalTimeSchema } from '@pulseframe/core';
import { writeWav } from '../music/wav.ts';
import { ApiError, type Store } from '../store.ts';
import { decodeSong, usableEndFrames } from './features.ts';
import { assertRemovalCurrent, crossfadeFrames, previewWindow, spliceRange, spliceSpec } from './splice.ts';
import { musicFitApiError } from './routes.ts';

const timeParam = (name: string, raw: string): T.RationalTime => {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const r = RationalTimeSchema.safeParse(parsed);
  if (!r.success) throw new ApiError(400, 'invalid_option', `${name} is a rational time written as JSON, for example {"value":"8","timescale":1}`, { [name]: raw.slice(0, 80) }, 'Take from and to from a candidate of the plan (removal).');
  return r.data;
};

export async function renderJoinPreview(store: Store, projectId: string, q: { assetId: string; from: string; to: string; startAt?: string }, signal?: AbortSignal): Promise<Buffer> {
  const doc = store.getProject(projectId).doc;
  const asset = Object.hasOwn(doc.assets, q.assetId) ? doc.assets[q.assetId]! : null;
  if (!asset || !asset.audio) throw new ApiError(404, 'not_found', `asset ${q.assetId} not found`, { assetId: q.assetId }, 'get_summary lists the library files.');
  const removal = { from: timeParam('from', q.from), to: timeParam('to', q.to) };
  const startAt = q.startAt ? timeParam('startAt', q.startAt) : T.ZERO;
  assertRemovalCurrent(doc, q.assetId, removal);
  const own = ownBeats(doc, q.assetId)!;
  const song = await decodeSong(store, asset, signal);
  const spec = spliceSpec(startAt, removal, usableEndFrames(song), crossfadeFrames(own.beats, removal.to));
  if (!spec) throw musicFitApiError('noJoin', { assetId: q.assetId, from: removal.from, to: removal.to });
  const w = previewWindow(own.downbeats, startAt, removal, spec);
  return writeWav(spliceRange(song.pcm, spec, w.from, w.to));
}
