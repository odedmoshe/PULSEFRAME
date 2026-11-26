/**
 * apply_made_clip (internal, v1; «קליפ מקוד», wave 8 `motioncode`; madeContract.ts). Registered on import (index.ts).
 * Issued by the server's made routes from a FINISHED render job (never from caller-supplied pixels), committed as the credential
 * that asked (open semantics, decisions.md motioncode 2): one transaction, one undo, through the generic entity diff.
 *
 * The body W2 builds (plan §3.2, verify C8):
 * - import `asset` with import_asset's deduplication by contentHash (ops.ts import_asset); refuse noRecord without provenance.made,
 *   notVideo unless kind 'video';
 * - place: without trackId, add_track at the top of the sequence, then add_clip (withLinkedAudio false), both through getOp(..).apply
 *   as apply_take does (takeOps.ts);
 * - replaceAssetId: replace_clip_media { clipId, assetId, linked: 'detach' } on every media clip in every sequence that shows it;
 *   its out_of_bounds becomes tooShort with the clip id; none → replaceUnused;
 * - both place and replaceAssetId → placeAndReplace; neither → library only.
 * Until then it refuses with MADE_OP_REFUSALS.notBuilt and changes nothing.
 */
import { defineOp, OpError, type OpErrorCode } from './ops.ts';
import { ApplyMadeClipArgsSchema, MADE_BUILT, MADE_OP, MADE_OP_REFUSALS, type MadeRow } from './madeContract.ts';

/** A refusal of apply_made_clip: the row's code, its sentence and next step; details.why names the case. */
export function madeRefusal<K extends keyof typeof MADE_OP_REFUSALS>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MADE_OP_REFUSALS)[K]['message']>): OpError {
  const r = MADE_OP_REFUSALS[key] as MadeRow<unknown[]>;
  return new OpError(r.code as OpErrorCode, r.message(...values), { ...details, why: r.why }, r.hint);
}

defineOp({
  name: MADE_OP,
  version: 1,
  internal: true,
  description: 'Bring a clip made by a page («קליפ מקוד») into the project: import the rendered transparent video (with its made record) and place it on a new top track, replace it in every clip that shows an earlier version, or keep it in the library only. Issued by the server from a finished render job (POST …/made/render, POST …/made/jobs/:jobId/apply); one undo.',
  args: ApplyMadeClipArgsSchema,
  apply(_d, a) {
    throw madeRefusal('notBuilt', { built: MADE_BUILT.op, ...(a.replaceAssetId ? { replaceAssetId: a.replaceAssetId } : {}) });
  },
});
