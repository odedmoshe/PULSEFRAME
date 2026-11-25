/**
 * The two internal operations of a shortened song (wave 7 musicfit track; .artifacts/wave7/musicfit-decisions.md). Registered on import
 * (index.ts). The lead fixed names, versions, descriptions and argument schemas (musicFitContract.ts); BUILDER A wrote the bodies.
 *
 * RULES OF A's BODIES:
 * - add_fitted_music (the server only, after it made and verified the bytes; precedent packOps.ts add_builtin_music): refuse in this
 *   order: fittedNotSound (kind audio with sound, no picture, provenance.origin 'derived' with provenance.fitted); fittedSourceMissing
 *   (fitted.sourceAssetId in the library NOW); the licence rule fitLicenceProblem(doc, sourceAssetId) → fitLicenceRefusal (fail-closed:
 *   checked again here, whatever the server checked); the made asset's provenance.library must EQUAL fittedLibraryRecord(doc, source)
 *   (or both absent) — else licenceUnknown; fittedGrid (beats and downbeats strictly ascending, every downbeat a beat, all in
 *   [0, duration)); removalNotBars (removed.from and removed.to are downbeats of the source's beatsFor analysis, on its clock).
 *   Into the library deduplicated by content; the grid written as analyses[id].beats with origin.method FIT_GRID_METHOD, edited false,
 *   never over a hand-corrected grid; place through add_clip's own body as add_builtin_music does.
 * - mark_join_heard: joinNotFitted unless the asset has provenance.fitted; heard true sets {by: ctx.actor, at}, false deletes it.
 *   The route is owner-session only (apps/server/src/musicfit/routes.ts); the op itself trusts its caller (internal).
 */
import { z } from 'zod';
import * as T from '@pulseframe/time';
import { defineOp, getOp, OpError } from './ops.ts';
import { analysisEntityId } from './entities.ts';
import { ownBeats } from './lineage.ts';
import { AddFittedMusicArgsSchema, fitLicenceProblem, fitLicenceRefusal, fittedLibraryRecord, MarkJoinHeardArgsSchema, musicFitRefusal, type AddFittedMusicOutput, type FittedGrid } from './musicFitContract.ts';
import type { ProjectDocument } from './schema.ts';

/** True once builder A has built the four bodies (impactOps.ts and this file); turns their fuzz rows on. */
export const MUSICFIT_OPS_BUILT = true;

/** Deep equality of two JSON values (the library record a made file carries against the one its source gives). */
const sameJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined).sort(), kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && sameJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
};
const ascending = (list: readonly T.RationalTime[]) => list.every((t, i) => i === 0 || T.lt(list[i - 1]!, t));
const sameTimes = (a: readonly T.RationalTime[], b: readonly T.RationalTime[]) => a.length === b.length && a.every((t, i) => T.eq(t, b[i]!));
/**
 * Write the made file's grid as its beat analysis (never over a grid corrected by hand; not again when the same grid is there).
 * createdAt is the made file's importedAt (the server's clock when it was made), so the op stays a pure function of its arguments.
 */
function attachFittedGrid(d: ProjectDocument, assetId: string, grid: FittedGrid, sourceAssetId: string, createdAt: string, actor: string): boolean {
  const cur = Object.hasOwn(d.analyses, assetId) ? d.analyses[assetId]! : { assetId };
  const had = cur.beats;
  if (had?.origin.edited) return false;
  if (had && had.origin.method === grid.method && had.bpm === grid.bpm && (had.meter ?? null) === grid.meter && sameTimes(had.beats, grid.beats) && sameTimes(had.downbeats ?? [], grid.downbeats)) return false;
  d.analyses[assetId] = { ...cur, beats: { origin: { method: grid.method, params: { sourceAssetId }, createdAt, createdBy: actor, edited: false }, bpm: grid.bpm, confidence: grid.confidence, beats: [...grid.beats], downbeats: [...grid.downbeats], meter: grid.meter } };
  return true;
}
defineOp({
  name: 'add_fitted_music',
  version: 1,
  internal: true,
  description: 'Add a song the server shortened by removing whole bars from its middle (one join, measured and not heard) to the library with its beats, derived exactly from the source song\'s measured beats, and optionally place it, as one step. A file made from a library song carries that song\'s licence record (credit, non-commercial mark, archive rule); a licence that forbids changes is refused.',
  args: AddFittedMusicArgsSchema,
  apply(d, a, ctx) {
    const made = a.asset, fitted = made.provenance.fitted;
    if (made.kind !== 'audio' || !made.audio || made.video || made.image || made.provenance.origin !== 'derived' || !fitted) throw musicFitRefusal('fittedNotSound', { kind: made.kind, origin: made.provenance.origin, fitted: !!fitted });
    const src = fitted.sourceAssetId;
    if (!Object.hasOwn(d.assets, src)) throw musicFitRefusal('fittedSourceMissing', { assetId: src }, src);
    // the licence rule again, whatever the server checked (fail-closed)
    const problem = fitLicenceProblem(d, src);
    if (problem) throw fitLicenceRefusal(problem, src);
    const record = fittedLibraryRecord(d, src);
    if (!sameJson(made.provenance.library ?? null, record)) throw musicFitRefusal('licenceUnknown', { assetId: src, licenceId: made.provenance.library?.licence.id ?? record?.licence.id ?? null, reason: 'the made file does not carry the record of the song it came from' }, made.provenance.library?.licence.id ?? record?.licence.id ?? '');
    const g = a.grid;
    const inside = (t: T.RationalTime) => !T.isNegative(t) && T.lt(t, made.duration);
    if (!ascending(g.beats) || !ascending(g.downbeats) || !g.downbeats.every((b) => g.beats.some((x) => T.eq(x, b))) || ![...g.beats, ...g.downbeats].every(inside)) throw musicFitRefusal('fittedGrid', { beats: g.beats.length, downbeats: g.downbeats.length, duration: made.duration });
    const own = ownBeats(d, src);
    const isBar = (t: T.RationalTime) => !!own && own.downbeats.some((b) => T.eq(b, t));
    if (!isBar(fitted.removed.from) || !isBar(fitted.removed.to)) throw musicFitRefusal('removalNotBars', { assetId: src, from: fitted.removed.from, to: fitted.removed.to });
    const affected: string[] = [];
    const existing = Object.values(d.assets).find((x) => x.contentHash === made.contentHash);
    const assetId = existing?.id ?? ctx.newId('ast');
    if (!existing) { d.assets[assetId] = { id: assetId, ...made }; affected.push(assetId); }
    const analysisAttached = attachFittedGrid(d, assetId, g, src, made.provenance.importedAt, ctx.actor);
    if (analysisAttached) affected.push(analysisEntityId(assetId));
    const output: AddFittedMusicOutput = { assetId, deduplicated: !!existing, analysisAttached };
    if (a.place) {
      const addClip = getOp('add_clip')!;
      const parsed = addClip.args.safeParse({ assetId, start: a.place.start, withLinkedAudio: false, ...(a.place.trackId !== undefined ? { trackId: a.place.trackId } : {}), ...(a.place.sequenceId !== undefined ? { sequenceId: a.place.sequenceId } : {}) });
      if (!parsed.success) throw new OpError('invalid_args', z.prettifyError(parsed.error), { place: a.place });
      const placed = addClip.apply(d, parsed.data, ctx);
      affected.push(...placed.affectedIds);
      const out = placed.output ?? {};
      if (typeof out.clipId === 'string') output.clipId = out.clipId;
      if (typeof out.trackId === 'string') output.trackId = out.trackId;
    }
    const srcName = d.assets[src]!.name;
    return { affectedIds: affected, summary: `${existing ? 'Shortened song already in the library' : 'Added a song shortened from'} ${srcName} (one join, not heard; ${g.beats.length} beats derived)${output.clipId ? ', placed on the timeline' : ''}`.slice(0, 200), output: output as unknown as Record<string, unknown> };
  },
});
defineOp({
  name: 'mark_join_heard',
  version: 1,
  internal: true,
  description: 'Mark the join of a shortened song as heard by the project owner, or clear the mark. Only the owner\'s own session reaches it.',
  args: MarkJoinHeardArgsSchema,
  apply(d, a, ctx) {
    const asset = Object.hasOwn(d.assets, a.assetId) ? d.assets[a.assetId] : undefined;
    const fitted = asset?.provenance.fitted;
    if (!asset || !fitted) throw musicFitRefusal('joinNotFitted', { assetId: a.assetId }, a.assetId);
    if (a.heard) fitted.heard = { by: ctx.actor, at: a.at };
    else delete fitted.heard;
    return { affectedIds: [asset.id], summary: `${a.heard ? 'Marked the join of' : 'Cleared the heard mark of'} ${asset.name}${a.heard ? ' as heard' : ''}`.slice(0, 200), output: { assetId: asset.id, heard: a.heard } };
  },
});
