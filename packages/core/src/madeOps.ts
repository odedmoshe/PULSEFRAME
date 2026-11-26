/**
 * apply_made_clip (internal, v1; «קליפ מקוד», wave 8 `motioncode`; madeContract.ts). Registered on import (index.ts).
 * Issued by the server's made routes from a FINISHED render job (never from caller-supplied pixels), committed as the credential
 * that asked (open semantics, decisions.md motioncode 2): one transaction, one undo, through the generic entity diff.
 *
 * The body (plan §3.2, verify C8):
 * - `asset` is parsed as AssetSchema without its id; refused with noRecord without provenance.made and notVideo unless kind 'video';
 *   then imported with import_asset's own deduplication by contentHash (the public op is called through getOp(..).apply, so the
 *   two cannot drift);
 * - place: without trackId, add_track (video) on the sequence — new picture tracks go on top of the picture tracks (ops.ts newTrack)
 *   — then add_clip with withLinkedAudio false, both through getOp(..).apply as apply_take does (takeOps.ts); add_clip's own
 *   refusals (start not on a frame, a busy or non-picture track) pass on in their own words;
 * - replaceAssetId: replace_clip_media { clipId, assetId, linked: 'detach' } on every media clip on a picture track, in every
 *   sequence, that shows it (the clip keeps its id, place, length, transform, keyframes and effects); its out_of_bounds becomes
 *   tooShort with the clip id and the frames it needs (at the project rate, rounded up); none shows it → replaceUnused. When the
 *   rendered file is the same bytes as the one it replaces (dedup gives the same asset), nothing is replaced and the output says so
 *   (replacedClipIds empty);
 * - both place and replaceAssetId → placeAndReplace; neither → library only.
 * The made record is checked against the file by validateProject at the end of the transaction (validate.ts made_provenance:
 * frames, transparency, values) — a mismatch is refused as invalid_result, a fact about the file.
 */
import * as T from '@pulseframe/time';
import { defineOp, findClip, getOp, OpError, type OpContext, type OpErrorCode, type OpResult } from './ops.ts';
import { AssetSchema, type ProjectDocument } from './schema.ts';
import { ApplyMadeClipArgsSchema, MADE_OP, MADE_OP_REFUSALS, type ApplyMadeClipOutput, type MadeRow } from './madeContract.ts';

/** A refusal of apply_made_clip: the row's code, its sentence and next step; details.why names the case. */
export function madeRefusal<K extends keyof typeof MADE_OP_REFUSALS>(key: K, details: Record<string, unknown>, ...values: Parameters<(typeof MADE_OP_REFUSALS)[K]['message']>): OpError {
  const r = MADE_OP_REFUSALS[key] as MadeRow<unknown[]>;
  return new OpError(r.code as OpErrorCode, r.message(...values), { ...details, why: r.why }, r.hint);
}

const MadeAssetSchema = AssetSchema.omit({ id: true });

/** Run a public op as a step of this one (parsed by its own schema, so its refusals are its own). */
function step(d: ProjectDocument, op: string, args: Record<string, unknown>, ctx: OpContext): OpResult {
  const def = getOp(op);
  if (!def) throw new OpError('unknown_op', `apply_made_clip: the operation ${op} is not registered`, { op });
  const parsed = def.args.safeParse(args);
  if (!parsed.success) throw new OpError('invalid_args', `apply_made_clip: invalid arguments for ${op}`, { op, issues: parsed.error.issues });
  return def.apply(d, parsed.data, ctx);
}
const isRT = (x: unknown): x is T.RationalTime => T.isRationalTime(x);
/** Whole frames at `rate` that cover `t` (rounded up). */
const framesUp = (t: T.RationalTime, rate: { num: number; den: number }) => { const n = T.frameCount(t, rate); return T.lt(T.frameTime(n, rate), t) ? n + 1 : n; };

defineOp({
  name: MADE_OP,
  version: 1,
  internal: true,
  description: 'Bring a clip made by a page («קליפ מקוד») into the project: import the rendered transparent video (with its made record) and place it on a new top track, replace it in every clip that shows an earlier version, or keep it in the library only. Issued by the server from a finished render job (POST …/made/render, POST …/made/jobs/:jobId/apply); one undo.',
  args: ApplyMadeClipArgsSchema,
  apply(d, a, ctx) {
    if (a.place && a.replaceAssetId !== undefined) throw madeRefusal('placeAndReplace', { replaceAssetId: a.replaceAssetId });
    const parsed = MadeAssetSchema.safeParse(a.asset);
    if (!parsed.success) throw new OpError('invalid_args', 'apply_made_clip: the asset is not a valid library file', { issues: parsed.error.issues.slice(0, 20) });
    const asset = parsed.data;
    if (!asset.provenance.made) throw madeRefusal('noRecord', { contentHash: asset.contentHash });
    if (asset.kind !== 'video' || !asset.video) throw madeRefusal('notVideo', { kind: asset.kind });
    const sequenceId = a.sequenceId ?? d.mainSequenceId;
    if (!Object.hasOwn(d.sequences, sequenceId)) throw new OpError('not_found', `sequence ${sequenceId} not found`, { sequenceId });
    // the old file is looked up before the import, so a replace of an unknown id changes nothing
    const replaced = a.replaceAssetId;
    const users = replaced === undefined ? [] : Object.values(d.sequences).flatMap((sq) => sq.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips))
      .filter((c) => c.type === 'media' && c.assetId === replaced).map((c) => c.id);
    if (replaced !== undefined && users.length === 0) throw madeRefusal('replaceUnused', { replaceAssetId: replaced }, replaced);

    const affected = new Set<string>();
    const imp = step(d, 'import_asset', { asset }, ctx);
    for (const id of imp.affectedIds) affected.add(id);
    const assetId = imp.output!.assetId as string;
    const out: ApplyMadeClipOutput = { assetId, deduplicated: imp.output!.deduplicated === true };
    const parts: string[] = [imp.summary];

    if (a.place) {
      let trackId = a.place.trackId;
      if (trackId === undefined) {
        const t = step(d, 'add_track', { sequenceId, kind: 'video' }, ctx);
        for (const id of t.affectedIds) affected.add(id);
        trackId = t.output!.trackId as string;
      }
      const c = step(d, 'add_clip', { sequenceId, assetId, trackId, start: a.place.start, withLinkedAudio: false }, ctx);
      for (const id of c.affectedIds) affected.add(id);
      out.trackId = c.output!.trackId as string;
      out.clipId = c.output!.clipId as string;
      parts.push(c.summary);
    } else if (replaced !== undefined) {
      const done: string[] = [];
      if (replaced !== assetId) for (const clipId of users) {
        let r: OpResult;
        try { r = step(d, 'replace_clip_media', { clipId, assetId, linked: 'detach' }, ctx); } catch (e) {
          if (e instanceof OpError && e.code === 'out_of_bounds') {
            const clip = findClip(d, clipId)!.clip;
            const rate = d.settings.frameRate;
            const span = isRT(e.details.needed) ? e.details.needed : clip.duration;
            const spare = typeof e.details.nextClipId === 'string' ? (findClip(d, e.details.nextClipId)?.clip as { transition?: { frames: number } } | undefined)?.transition?.frames ?? 0 : 0;
            const frames = framesUp(span, rate) + spare;
            throw madeRefusal('tooShort', { clipId, replaceAssetId: replaced, frames, cause: e.message }, clipId, frames);
          }
          throw e;
        }
        for (const id of r.affectedIds) affected.add(id);
        done.push(clipId);
      }
      out.replacedClipIds = done;
      parts.push(done.length ? `replaced the file in ${done.length} clip(s)` : 'the new file is the same as the old one; nothing replaced');
    }
    return { affectedIds: [...affected], summary: `Clip made by a page: ${parts.join('; ')}`, output: { ...out } };
  },
});
